/**
 * lyricsAligner.ts
 * 
 * Uses Transformers.js v3 (Whisper-tiny) to transcribe audio and
 * produce word-level timestamps, then aligns those timestamps against
 * the user's manually entered lyrics using a sequence alignment algorithm.
 * 
 * Post-processing:
 *  - Gap Filling: closes gaps < 50ms between adjacent words (legato smoothing)
 *  - Vowel Expansion: extends word end_time when RMS energy is high (sustained note)
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { computeVAD } from './audioProcessor';

// Allow remote model downloads and use WASM (no Node.js fs needed in browser)
env.allowRemoteModels = true;
env.allowLocalModels = false;

export interface AlignedWord {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

/** Progress callback to display loading state to user */
export type ProgressCallback = (status: string, progress?: number) => void;

let _pipeline: AutomaticSpeechRecognitionPipeline | null = null;

/**
 * Lazy-load and cache the Whisper ASR pipeline.
 * Model is cached in the browser's Cache Storage after first download.
 */
async function getASRPipeline(onProgress?: ProgressCallback): Promise<AutomaticSpeechRecognitionPipeline> {
  if (_pipeline) return _pipeline;

  onProgress?.('Downloading AI model (first time only)…');

  try {
    _pipeline = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny',
      {
        dtype: 'fp32',
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === 'progress' && p.progress != null) {
            onProgress?.(`Downloading AI model: ${Math.round(p.progress)}%`, p.progress);
          }
        },
      }
    ) as AutomaticSpeechRecognitionPipeline;

    return _pipeline;
  } catch (err) {
    // Clear cache so caller can retry cleanly next time
    _pipeline = null;
    throw err;
  }
}

// LyricsMismatchError removed to allow always fallback to manual adjustment.


/**
 * Levenshtein-based sequence alignment.
 * Returns mapping (ref → hyp index) AND average similarity confidence (0–1).
 */
function alignSequences(
  reference: string[],
  hypothesis: string[]
): { mapping: number[]; confidence: number } {
  const ref = reference.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hyp = hypothesis.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const R = ref.length;
  const H = hyp.length;
  const INF = 1e9;

  function editDist(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0 || b.length === 0) return Math.max(a.length, b.length);
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  /** Similarity score 0–1 for a pair of words (1 = identical). */
  function wordSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - editDist(a, b) / maxLen;
  }

  // Build DTW matrix
  const dtw: number[][] = Array.from({ length: R + 1 }, () => new Array(H + 1).fill(INF));
  dtw[0][0] = 0;
  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= H; j++) {
      const cost = editDist(ref[i - 1], hyp[j - 1]);
      dtw[i][j] = cost + Math.min(dtw[i - 1][j - 1], dtw[i - 1][j], dtw[i][j - 1]);
    }
  }

  // Traceback
  const mapping = new Array(R).fill(0);
  let i = R, j = H;
  while (i > 0 && j > 0) {
    mapping[i - 1] = j - 1;
    const diag = dtw[i - 1][j - 1];
    const up   = dtw[i - 1][j];
    const left = dtw[i][j - 1];
    if (diag <= up && diag <= left) { i--; j--; }
    else if (up <= left)             { i--; }
    else                             { j--; }
  }
  for (let k = 0; k < R; k++) {
    if (mapping[k] === 0 && k > 0) mapping[k] = mapping[k - 1];
  }

  // Compute average per-word similarity across the alignment path
  const totalSim = mapping.reduce((sum, hypIdx, refIdx) => {
    return sum + wordSimilarity(ref[refIdx], hyp[Math.min(hypIdx, H - 1)]);
  }, 0);
  const confidence = R > 0 ? totalSim / R : 0;

  return { mapping, confidence };
}

/**
 * Post-processing step 1: Gap Filling.
 * If the gap between word[i].end and word[i+1].start is < gapThresholdMs,
 * extend word[i].end to word[i+1].start (legato smoothing).
 */
function fillGaps(words: AlignedWord[], gapThresholdMs = 50): AlignedWord[] {
  const result = words.map(w => ({ ...w }));
  for (let i = 0; i < result.length - 1; i++) {
    const gap = (result[i + 1].start - result[i].end) * 1000;
    if (gap > 0 && gap < gapThresholdMs) {
      result[i].end = result[i + 1].start;
    }
  }
  return result;
}

/**
 * Post-processing step 2: Vowel Expansion.
 * Looks at RMS energy after a word's end_time.
 * If energy stays above threshold for some duration, extends end_time
 * to capture sustained vocal notes.
 */
function expandVowels(
  words: AlignedWord[],
  vadFrames: Array<{ time: number; energy: number }>,
  energyThreshold = 0.01,
  maxExtensionMs = 400
): AlignedWord[] {
  return words.map((word, idx) => {
    const nextStart = idx < words.length - 1 ? words[idx + 1].start : Infinity;
    const maxEnd = Math.min(word.end + maxExtensionMs / 1000, nextStart - 0.01);

    let extendedEnd = word.end;
    for (const frame of vadFrames) {
      if (frame.time <= word.end) continue;
      if (frame.time > maxEnd) break;
      if (frame.energy >= energyThreshold) {
        extendedEnd = frame.time + 0.02; // include this 20ms frame
      } else {
        break; // stop at first silent frame
      }
    }
    return { ...word, end: Math.min(extendedEnd, maxEnd) };
  });
}

/**
 * Main entry point.
 * 
 * Given:
 *  - audio: 16kHz mono Float32Array
 *  - manualLyrics: string (space-separated or newline-separated words from user)
 *  - vadFrames: energy profile from computeVAD()
 * 
/**
 * Detect language of manual lyrics text using common stopwords.
 * Helps Whisper transcribe in the correct language mode.
 */
function detectLanguageFromLyrics(text: string): string | undefined {
  const cleanText = text.toLowerCase();
  
  // Common Indonesian stopwords
  const indonesianWords = [
    'yang', 'dan', 'di', 'ke', 'dari', 'aku', 'kau', 'kamu', 'bisa', 'tidak', 
    'ada', 'ini', 'itu', 'dengan', 'saya', 'untuk', 'mereka', 'kita', 'kami',
    'satu', 'dua', 'tiga', 'empat', 'lima'
  ];
  // Common Javanese words
  const javaneseWords = [
    'sing', 'lan', 'ning', 'soko', 'kowe', 'ora', 'ono', 'iki', 'iku', 'karo', 
    'kulo', 'dewe', 'sampeyan', 'mase', 'mbake'
  ];

  const words = cleanText.split(/\s+/);
  let idCount = 0;
  let jwCount = 0;

  for (const w of words) {
    const cleanW = w.replace(/[^a-z]/g, '');
    if (indonesianWords.includes(cleanW)) idCount++;
    if (javaneseWords.includes(cleanW)) jwCount++;
  }

  if (jwCount > idCount && jwCount > 0) return 'javanese';
  if (idCount > 0) return 'indonesian';
  
  return undefined;
}

/**
 * Main entry point.
 * 
 * Given:
 *  - audio: 16kHz mono Float32Array
 *  - manualLyrics: string (space-separated or newline-separated words from user)
 *  - vadFrames: energy profile from computeVAD()
 * 
 * Returns: AlignedWord[] with forced-aligned, post-processed word timestamps.
 */
export async function alignLyrics(
  audio: Float32Array,
  manualLyrics: string,
  vadFrames: ReturnType<typeof computeVAD>,
  onProgress?: ProgressCallback
): Promise<{ words: AlignedWord[]; confidence: number }> {
  onProgress?.('Loading AI transcription model…');
  const asr = await getASRPipeline(onProgress);

  onProgress?.('Transcribing audio…');
  const detectedLang = detectLanguageFromLyrics(manualLyrics);
  
  const result = await (asr as any)(audio, {
    return_timestamps: true,
    task: 'transcribe',
    chunk_length_s: 30,
    sampling_rate: 16000,
    ...(detectedLang ? { language: detectedLang } : {}),
  }) as { chunks?: Array<{ text: string; timestamp: [number, number] }> };

  const whisperWords: AlignedWord[] = [];
  for (const chunk of result.chunks ?? []) {
    const chunkStart = chunk.timestamp[0] ?? 0;
    const chunkEnd   = chunk.timestamp[1] ?? chunkStart + 1;
    const chunkDuration = Math.max(chunkEnd - chunkStart, 0.01);
    const words = chunk.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const totalChars = words.reduce((s, w) => s + w.length, 0) || 1;
    let cursor = chunkStart;
    for (const w of words) {
      const frac = w.length / totalChars;
      const wDur = chunkDuration * frac;
      whisperWords.push({ word: w, start: cursor, end: cursor + wDur });
      cursor += wDur;
    }
  }

  onProgress?.('Aligning manual lyrics…');

  const refWords = manualLyrics
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean);

  // If Whisper produced nothing, fall back to uniform distribution with 0 confidence
  if (whisperWords.length === 0) {
    const duration = audio.length / 16000;
    const timePerWord = duration / refWords.length;
    const words = refWords.map((word, i) => ({
      word,
      start: i * timePerWord,
      end: (i + 1) * timePerWord,
    }));
    return { words, confidence: 0 };
  }

  // Align reference lyrics with Whisper hypothesis + compute confidence
  const hypWords = whisperWords.map(w => w.word);
  const { mapping, confidence } = alignSequences(refWords, hypWords);

  let aligned: AlignedWord[] = refWords.map((word, i) => {
    const hypIdx = Math.min(mapping[i], whisperWords.length - 1);
    return {
      word,
      start: whisperWords[hypIdx].start,
      end: whisperWords[hypIdx].end,
    };
  });

  // Ensure monotonically increasing timestamps
  for (let i = 1; i < aligned.length; i++) {
    if (aligned[i].start < aligned[i - 1].end) {
      aligned[i].start = aligned[i - 1].end;
    }
    if (aligned[i].end <= aligned[i].start) {
      aligned[i].end = aligned[i].start + 0.3;
    }
  }

  onProgress?.('Applying vocal smoothing…');
  aligned = fillGaps(aligned, 50);
  aligned = expandVowels(aligned, vadFrames, 0.01, 400);

  onProgress?.(`Done — sync confidence ${Math.round(confidence * 100)}%`);
  return { words: aligned, confidence };
}
