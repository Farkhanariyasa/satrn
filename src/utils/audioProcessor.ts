/**
 * audioProcessor.ts
 * Decodes a recorded video/audio Blob into a 16kHz mono Float32Array
 * for use with Whisper (Transformers.js) forced alignment.
 */

/**
 * Extracts mono 16kHz audio PCM from a video/audio Blob.
 * Uses browser AudioContext – no server or WASM needed.
 */
export async function extractAudio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    // Mix down all channels to mono
    const numChannels = decoded.numberOfChannels;
    const length = decoded.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < numChannels; ch++) {
      const channel = decoded.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += channel[i];
      }
    }
    if (numChannels > 1) {
      for (let i = 0; i < length; i++) mono[i] /= numChannels;
    }
    return mono;
  } finally {
    await audioCtx.close();
  }
}

/**
 * Computes RMS energy of a PCM window.
 * Used for vowel/sustained-note detection.
 */
export function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  const len = end - start;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / len);
}

/**
 * Simple Voice Activity Detection (VAD) over fixed-size frames.
 * Returns an array of { time, energy } per frame at 16kHz sample rate.
 */
export function computeVAD(
  samples: Float32Array,
  frameSizeMs = 20,
  sampleRate = 16000
): Array<{ time: number; energy: number }> {
  const frameSize = Math.floor((frameSizeMs / 1000) * sampleRate);
  const frames: Array<{ time: number; energy: number }> = [];
  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    const energy = rms(samples, i, i + frameSize);
    frames.push({ time: i / sampleRate, energy });
  }
  return frames;
}
