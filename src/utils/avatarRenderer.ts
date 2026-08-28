export type AvatarType = 'none' | 'bear' | 'cat' | 'panda' | 'dog' | 'rabbit';
export type BackgroundType = 'camera' | 'sunset' | 'cosmic' | 'mint' | 'office' | 'dark';

export interface FaceData {
  cx: number;            // Center X in pixels
  cy: number;            // Center Y in pixels
  scale: number;         // Scale factor (proportional to face width)
  rotation: number;      // Head roll in radians
  isLeftEyeOpen: boolean;
  isRightEyeOpen: boolean;
  mouthOpenRatio: number; // 0 (closed) to 1 (fully open)
  smileIntensity: number; // 0 to 1
  avgEAR: number;        // Eye Aspect Ratio
  mar: number;           // Mouth Aspect Ratio
}

interface DetectedFeatures {
  eyeL_X: number;
  eyeR_X: number;
  eyeY: number;
  blinkOffsetL_X: number;
  blinkOffsetL_Y: number;
  blinkOffsetR_X: number;
  blinkOffsetR_Y: number;
}

const DEFAULT_COORDS: Record<Exclude<AvatarType, 'none'>, { eyeL_X: number; eyeR_X: number; eyeY: number }> = {
  bear:   { eyeL_X: 365, eyeR_X: 635, eyeY: 480 },
  cat:    { eyeL_X: 350, eyeR_X: 650, eyeY: 480 },
  panda:  { eyeL_X: 360, eyeR_X: 640, eyeY: 480 },
  dog:    { eyeL_X: 370, eyeR_X: 630, eyeY: 470 },
  rabbit: { eyeL_X: 360, eyeR_X: 640, eyeY: 490 },
};

// Client-side image loader that takes the high-quality 3D raster assets,
// keys out the white backgrounds via flood-fill, and caches them for smooth 60fps rendering.
class PuppetAssetGenerator {
  private cache: Record<string, HTMLCanvasElement> = {};
  private loading: Record<string, boolean> = {};
  private featureCache: Record<string, DetectedFeatures> = {};
  private compositorCanvas: HTMLCanvasElement | null = null;
  private tempFeatherCanvas: HTMLCanvasElement | null = null;

  getCompositorCanvas(): HTMLCanvasElement {
    if (!this.compositorCanvas) {
      this.compositorCanvas = document.createElement('canvas');
      this.compositorCanvas.width = 1000;
      this.compositorCanvas.height = 1000;
    }
    return this.compositorCanvas;
  }

  getTempFeatherCanvas(size: number): HTMLCanvasElement {
    if (!this.tempFeatherCanvas) {
      this.tempFeatherCanvas = document.createElement('canvas');
    }
    this.tempFeatherCanvas.width = size;
    this.tempFeatherCanvas.height = size;
    return this.tempFeatherCanvas;
  }

  getFeatures(animal: Exclude<AvatarType, 'none'>): DetectedFeatures {
    if (this.featureCache[animal]) return this.featureCache[animal];

    const normal = this.getLayer(animal, 'normal');
    const blink = this.getLayer(animal, 'blink');

    // Detect pupil centers programmatically if images are fully loaded
    if (normal && blink) {
      const normalL = this.detectEyeCenter(normal, true);
      const normalR = this.detectEyeCenter(normal, false);
      const blinkL = this.detectEyeCenter(blink, true);
      const blinkR = this.detectEyeCenter(blink, false);

      const features: DetectedFeatures = {
        eyeL_X: normalL.x,
        eyeR_X: normalR.x,
        eyeY: (normalL.y + normalR.y) / 2,
        blinkOffsetL_X: blinkL.x - normalL.x,
        blinkOffsetL_Y: blinkL.y - normalL.y,
        blinkOffsetR_X: blinkR.x - normalR.x,
        blinkOffsetR_Y: blinkR.y - normalR.y,
      };
      this.featureCache[animal] = features;
      return features;
    }

    const defaults = DEFAULT_COORDS[animal];
    return {
      eyeL_X: defaults.eyeL_X,
      eyeR_X: defaults.eyeR_X,
      eyeY: defaults.eyeY,
      blinkOffsetL_X: 0,
      blinkOffsetL_Y: 0,
      blinkOffsetR_X: 0,
      blinkOffsetR_Y: 0,
    };
  }

  // Scanning pupil regions to locate true center of the eyes automatically
  private detectEyeCenter(canvas: HTMLCanvasElement, isLeft: boolean): { x: number; y: number } {
    const ctx = canvas.getContext('2d')!;
    const minX = isLeft ? 260 : 540;
    const maxX = isLeft ? 460 : 740;
    const minY = 400;
    const maxY = 560;

    const imgData = ctx.getImageData(minX, minY, maxX - minX, maxY - minY);
    const data = imgData.data;

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    let minBrightness = 255;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i+3];
      if (a < 200) continue;
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      if (brightness < minBrightness) {
        minBrightness = brightness;
      }
    }

    const threshold = minBrightness + 25;
    const w = maxX - minX;

    for (let y = 0; y < (maxY - minY); y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx+3] < 200) continue;
        const brightness = (data[idx] + data[idx+1] + data[idx+2]) / 3;
        if (brightness <= threshold) {
          sumX += (minX + x);
          sumY += (minY + y);
          count++;
        }
      }
    }

    if (count > 0) {
      return { x: sumX / count, y: sumY / count };
    }
    return { x: isLeft ? 370 : 630, y: 480 };
  }

  getLayer(animal: Exclude<AvatarType, 'none'>, state: string): HTMLCanvasElement | null {
    if (typeof window === 'undefined') return null;
    const key = `${animal}_${state}`;
    if (this.cache[key]) return this.cache[key];
    if (this.loading[key]) return null;

    this.loading[key] = true;

    const img = new Image();
    if (state === 'normal') {
      img.src = `/avatar_${animal}.jpg`;
    } else {
      img.src = `/avatar_${animal}_${state}.jpg`;
    }
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        
        // Remove white background with BFS boundary flood fill
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const width = canvas.width;
        const height = canvas.height;
        const visited = new Uint8Array(width * height);
        const queue: [number, number][] = [];

        const isWhite = (x: number, y: number) => {
          const idx = (y * width + x) * 4;
          return data[idx] > 250 && data[idx+1] > 250 && data[idx+2] > 250;
        };

        const pushPixel = (x: number, y: number) => {
          const idx = y * width + x;
          if (!visited[idx] && isWhite(x, y)) {
            visited[idx] = 1;
            queue.push([x, y]);
          }
        };

        // Initialize borders
        for (let x = 0; x < width; x++) {
          pushPixel(x, 0); pushPixel(x, height - 1);
        }
        for (let y = 0; y < height; y++) {
          pushPixel(0, y); pushPixel(width - 1, y);
        }

        let head = 0;
        while (head < queue.length) {
          const [cx, cy] = queue[head++];
          const idx = (cy * width + cx) * 4;
          data[idx+3] = 0; // Set alpha to transparent

          if (cx > 0) pushPixel(cx - 1, cy);
          if (cx < width - 1) pushPixel(cx + 1, cy);
          if (cy > 0) pushPixel(cx, cy - 1);
          if (cy < height - 1) pushPixel(cx, cy + 1);
        }

        ctx.putImageData(imgData, 0, 0);
        this.cache[key] = canvas;
      }
      this.loading[key] = false;
    };

    img.onerror = () => {
      // Quietly fail or log warning for non-existent states (falls back to dynamic composites)
      this.loading[key] = false;
    };

    return null;
  }

  preloadAll() {
    if (typeof window === 'undefined') return;
    const animals: Exclude<AvatarType, 'none'>[] = ['bear', 'cat', 'panda', 'dog', 'rabbit'];
    const states = ['normal', 'blink', 'talk', 'wink_l', 'blink_talk', 'wink_l_talk'];
    animals.forEach(a => {
      states.forEach(s => {
        this.getLayer(a, s);
      });
    });
  }
}

export const puppetGenerator = new PuppetAssetGenerator();
export const avatarLoader = puppetGenerator;

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: BackgroundType
) {
  if (type === 'camera') return;
  ctx.save();
  if (type === 'sunset') {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#f97316');
    grad.addColorStop(0.5, '#ec4899');
    grad.addColorStop(1, '#6366f1');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (type === 'cosmic') {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(0.5, '#1e1b4b');
    grad.addColorStop(1, '#311042');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (type === 'mint') {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#a7f3d0');
    grad.addColorStop(1, '#064e3b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (type === 'office') {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(width * 0.1, height * 0.1, width * 0.3, height * 0.5);
    ctx.fillRect(width * 0.5, height * 0.1, width * 0.4, height * 0.5);
  } else if (type === 'dark') {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export function drawCartoonBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  avatarType: AvatarType
) {
  if (avatarType === 'none') return;
  ctx.save();
  const size = 300 * scale;
  
  ctx.fillStyle = avatarType === 'bear' ? '#78350f' 
                : avatarType === 'cat' ? '#334155' 
                : avatarType === 'panda' ? '#0f172a' 
                : avatarType === 'dog' ? '#b45309' 
                : '#cbd5e1';
  
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.6, cy + size * 0.8);
  ctx.bezierCurveTo(
    cx - size * 0.5, cy + size * 0.35, 
    cx + size * 0.5, cy + size * 0.35, 
    cx + size * 0.6, cy + size * 0.8
  );
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.15, cy + size * 0.4);
  ctx.lineTo(cx, cy + size * 0.52);
  ctx.lineTo(cx + size * 0.15, cy + size * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Composites the closed winking eye with a feathered radial gradient onto the base canvas.
// This is used as a fallback overlay if specific generated wink/blink-talk assets aren't yet loaded.
function drawFeatheredEye(
  destCtx: CanvasRenderingContext2D,
  blinkCanvas: HTMLCanvasElement,
  features: DetectedFeatures,
  isLeftEye: boolean
) {
  const cx = isLeftEye ? features.eyeL_X : features.eyeR_X;
  const cy = features.eyeY;
  const r = 85;

  const temp = puppetGenerator.getTempFeatherCanvas(r * 2);
  const tempCtx = temp.getContext('2d')!;
  tempCtx.clearRect(0, 0, r * 2, r * 2);

  const offsetX = isLeftEye ? features.blinkOffsetL_X : features.blinkOffsetR_X;
  const offsetY = isLeftEye ? features.blinkOffsetL_Y : features.blinkOffsetR_Y;

  const sx = cx - r + offsetX;
  const sy = cy - r + offsetY;

  tempCtx.drawImage(
    blinkCanvas,
    sx, sy, r * 2, r * 2,
    0, 0, r * 2, r * 2
  );

  tempCtx.globalCompositeOperation = 'destination-in';
  const grad = tempCtx.createRadialGradient(r, r, r * 0.55, r, r, r);
  grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.8, 'rgba(0, 0, 0, 0.9)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  tempCtx.fillStyle = grad;
  tempCtx.beginPath();
  tempCtx.arc(r, r, r, 0, Math.PI * 2);
  tempCtx.fill();

  destCtx.drawImage(temp, cx - r, cy - r);
}

export function draw2DAvatar(
  ctx: CanvasRenderingContext2D,
  type: AvatarType,
  face: FaceData
) {
  if (type === 'none') return;

  const { cx, cy, scale, rotation, isLeftEyeOpen, isRightEyeOpen, mar } = face;

  // 1. Core primary 3D state assets
  const normalCanvas = puppetGenerator.getLayer(type, 'normal');
  const blinkCanvas = puppetGenerator.getLayer(type, 'blink');
  const talkCanvas = puppetGenerator.getLayer(type, 'talk');

  if (!normalCanvas || !blinkCanvas || !talkCanvas) return; // Core assets must be loaded

  const compCanvas = puppetGenerator.getCompositorCanvas();
  const compCtx = compCanvas.getContext('2d')!;
  compCtx.clearRect(0, 0, 1000, 1000);

  const isTalking = mar >= 0.18;

  // 2. Classify state and determine render strategy
  let targetCanvas: HTMLCanvasElement | null = null;
  let isMirrored = false;

  if (isLeftEyeOpen && isRightEyeOpen) {
    // Both eyes open
    targetCanvas = isTalking ? talkCanvas : normalCanvas;
  } else if (!isLeftEyeOpen && !isRightEyeOpen) {
    // Both eyes closed
    targetCanvas = isTalking 
      ? (puppetGenerator.getLayer(type, 'blink_talk') || null) 
      : blinkCanvas;
  } else if (!isLeftEyeOpen && isRightEyeOpen) {
    // Left eye closed, right eye open (wink left)
    targetCanvas = isTalking
      ? (puppetGenerator.getLayer(type, 'wink_l_talk') || null)
      : (puppetGenerator.getLayer(type, 'wink_l') || null);
  } else if (isLeftEyeOpen && !isRightEyeOpen) {
    // Left eye open, right eye closed (wink right - mirrored wink left)
    targetCanvas = isTalking
      ? (puppetGenerator.getLayer(type, 'wink_l_talk') || null)
      : (puppetGenerator.getLayer(type, 'wink_l') || null);
    isMirrored = true;
  }

  // 3. Render directly using the generated state image if available
  if (targetCanvas) {
    if (isMirrored) {
      compCtx.save();
      compCtx.translate(1000, 0);
      compCtx.scale(-1, 1);
      compCtx.drawImage(targetCanvas, 0, 0, 1000, 1000);
      compCtx.restore();
    } else {
      compCtx.drawImage(targetCanvas, 0, 0, 1000, 1000);
    }
  } else {
    // 4. Fallback rendering strategy: Auto-feathered compositor
    const baseCanvas = isTalking ? talkCanvas : normalCanvas;
    compCtx.drawImage(baseCanvas, 0, 0);

    const features = puppetGenerator.getFeatures(type);

    if (!isLeftEyeOpen) {
      drawFeatheredEye(compCtx, blinkCanvas, features, true);
    }
    if (!isRightEyeOpen) {
      drawFeatheredEye(compCtx, blinkCanvas, features, false);
    }
  }

  // 5. Render final composition onto main canvas context
  ctx.save();
  const verticalOffset = -45 * scale;
  ctx.translate(cx, cy + verticalOffset);
  ctx.rotate(rotation);

  const size = 300 * scale;
  ctx.drawImage(compCanvas, -size / 2, -size / 2, size, size);

  ctx.restore();
}
