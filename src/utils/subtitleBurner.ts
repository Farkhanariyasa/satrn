/**
 * subtitleBurner.ts
 * 
 * Canvas Compositor Recorder.
 * Burns karaoke subtitle text permanently into a video by:
 *  1. Playing the source video in a hidden <video> element
 *  2. Rendering each frame + subtitle overlay onto a hidden <canvas>
 *  3. Capturing the canvas stream and recording it to a new MP4 blob
 * 
 * No FFmpeg WASM or server required – runs entirely in-browser.
 */

import type { AlignedWord } from './lyricsAligner';

export interface BurnSubtitlesOptions {
  /** The recorded video blob */
  videoBlob: Blob;
  /** Aligned word timestamps */
  words: AlignedWord[];
  /** Canvas width (defaults to video naturalWidth) */
  width?: number;
  /** Canvas height (defaults to video naturalHeight) */
  height?: number;
  /** Recording bitrate in bps (default 6_000_000 = 6Mbps) */
  videoBitsPerSecond?: number;
  /** Progress callback, called with 0–100 */
  onProgress?: (pct: number) => void;
}

/**
 * Renders the active word line with karaoke highlight onto the given canvas context.
 */
function drawKaraokeOverlay(
  ctx: CanvasRenderingContext2D,
  words: AlignedWord[],
  currentTime: number,
  width: number,
  height: number
) {
  // Determine current and upcoming words (show a window of ~6 words to match preview)
  const windowStart = Math.max(0, words.findIndex(w => w.end > currentTime) - 1);
  const window = words.slice(windowStart, windowStart + 6);

  if (window.length === 0) return;

  const baseFontSize = Math.max(20, Math.round(width * 0.038));

  // Target vertical center: exactly 15% from bottom (y = 85% of height)
  const yPos = height * 0.85;
  const maxLineWidth = width * 0.84; // 84% width safe boundary

  // Group words into lines of maximum 3 words to prevent offside
  interface MeasuredWord {
    word: string;
    isActive: boolean;
    width: number;
    fontSize: number;
  }
  const lines: MeasuredWord[][] = [[]];
  let currentLineWidth = 0;

  for (const word of window) {
    const isActive = currentTime >= word.start && currentTime < word.end;
    const fSize = isActive ? Math.round(baseFontSize * 1.1) : baseFontSize;
    ctx.font = `bold ${fSize}px Inter, Arial, sans-serif`;
    
    // Measure word with space to ensure correct spacing
    const wWidth = ctx.measureText(word.word + ' ').width;

    // Wrap if current line has 3 words, or exceeds max width
    if (lines[lines.length - 1].length >= 3 || (currentLineWidth + wWidth > maxLineWidth && lines[lines.length - 1].length > 0)) {
      lines.push([]);
      currentLineWidth = 0;
    }

    lines[lines.length - 1].push({
      word: word.word,
      isActive,
      width: wWidth,
      fontSize: fSize
    });
    currentLineWidth += wWidth;
  }

  const lineHeight = Math.round(baseFontSize * 1.15);
  const totalLines = lines.length;
  const startY = yPos - ((totalLines - 1) * lineHeight) / 2;

  ctx.save();
  ctx.textAlign = 'left'; // Align left for word-by-word offset drawing
  ctx.textBaseline = 'middle';

  for (let lIdx = 0; lIdx < totalLines; lIdx++) {
    const line = lines[lIdx];
    const lineY = startY + lIdx * lineHeight;
    const lineWidth = line.reduce((sum, w) => sum + w.width, 0);
    
    let offsetX = (width - lineWidth) / 2; // Center the line horizontally

    for (const w of line) {
      ctx.font = `bold ${w.fontSize}px Inter, Arial, sans-serif`;
      
      // Thick dark drop shadow for maximum readability on any background
      ctx.shadowColor = 'rgba(0, 0, 0, 1)';
      ctx.shadowBlur = w.isActive ? 12 : 8;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;

      // Active: white; Inactive: white with 60% opacity
      ctx.fillStyle = w.isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.6)';

      // Draw word with a trailing space
      ctx.fillText(w.word + ' ', offsetX, lineY);
      offsetX += w.width;
    }
  }
  ctx.restore();
}

/**
 * Burns subtitles into a video blob using canvas compositing.
 * Returns a new Blob with subtitle text permanently rendered on each frame.
 */
export async function burnSubtitles(options: BurnSubtitlesOptions): Promise<Blob> {
  const {
    videoBlob,
    words,
    videoBitsPerSecond = 6_000_000,
    onProgress,
  } = options;

  return new Promise<Blob>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(videoBlob);

    video.addEventListener('loadedmetadata', () => {
      const width = options.width ?? video.videoWidth;
      const height = options.height ?? video.videoHeight;
      const duration = video.duration;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      const preferredTypes = [
        'video/mp4;codecs=avc1,mp4a',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      let mimeType = '';
      for (const type of preferredTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const canvasStream = canvas.captureStream(30);

      // Extract original audio from playing video element stream
      const videoStream = (video as any).captureStream 
        ? (video as any).captureStream() 
        : (video as any).mozCaptureStream 
          ? (video as any).mozCaptureStream() 
          : null;
      const audioTrack = videoStream ? videoStream.getAudioTracks()[0] : null;

      // Composite stream: Canvas (video) + Video Element (audio)
      const compositeStream = new MediaStream();
      canvasStream.getVideoTracks().forEach(track => compositeStream.addTrack(track));
      if (audioTrack) {
        compositeStream.addTrack(audioTrack);
      }

      const recorder = new MediaRecorder(compositeStream, { 
        mimeType: mimeType || undefined, 
        videoBitsPerSecond 
      });
      const chunks: Blob[] = [];

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        URL.revokeObjectURL(video.src);
        const actualType = mimeType || 'video/mp4';
        resolve(new Blob(chunks, { type: actualType }));
      };
      recorder.onerror = (e) => reject(e);

      // Render loop: draw each video frame + subtitle onto canvas
      const drawFrame = () => {
        if (video.paused || video.ended) {
          recorder.stop();
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(video, 0, 0, width, height);
        drawKaraokeOverlay(ctx, words, video.currentTime, width, height);

        const pct = (video.currentTime / duration) * 100;
        onProgress?.(Math.round(pct));

        requestAnimationFrame(drawFrame);
      };

      recorder.start();
      video.play().then(drawFrame).catch(reject);
    });

    video.addEventListener('error', reject);
    video.load();
  });
}
