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

// Client-side image loader that takes the high-quality 3D raster assets,
// keys out the white backgrounds via flood-fill, and caches them for smooth 60fps rendering.
class PuppetAssetGenerator {
  private cache: Record<string, HTMLCanvasElement> = {};
  private loading: Record<string, boolean> = {};

  getLayer(animal: Exclude<AvatarType, 'none'>, state: 'normal' | 'blink' | 'talk'): HTMLCanvasElement | null {
    if (typeof window === 'undefined') return null;
    const key = `${animal}_${state}`;
    if (this.cache[key]) return this.cache[key];
    if (this.loading[key]) return null;

    this.loading[key] = true;

    const img = new Image();
    // normal is /avatar_[animal].jpg, others are /avatar_[animal]_[state].jpg
    img.src = state === 'normal' ? `/avatar_${animal}.jpg` : `/avatar_${animal}_${state}.jpg`;
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
      console.error(`Failed to load 3D asset state: ${img.src}`);
      this.loading[key] = false;
    };

    return null;
  }

  preloadAll() {
    if (typeof window === 'undefined') return;
    const animals: Exclude<AvatarType, 'none'>[] = ['bear', 'cat', 'panda', 'dog', 'rabbit'];
    const states: ('normal' | 'blink' | 'talk')[] = ['normal', 'blink', 'talk'];
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

export function draw2DAvatar(
  ctx: CanvasRenderingContext2D,
  type: AvatarType,
  face: FaceData
) {
  if (type === 'none') return;

  const { cx, cy, scale, rotation, avgEAR, mar } = face;

  // Determine state: blinking, talking (MAR >= 0.18), or normal
  let state: 'normal' | 'blink' | 'talk' = 'normal';
  if (avgEAR < 0.18) {
    state = 'blink';
  } else if (mar >= 0.18) {
    state = 'talk';
  }

  const avatarImg = puppetGenerator.getLayer(type, state);
  if (!avatarImg) return; // Assets still loading

  ctx.save();
  const verticalOffset = -45 * scale;
  ctx.translate(cx, cy + verticalOffset);
  ctx.rotate(rotation);

  // Uniform size scaling matching base scale bounds
  const size = 300 * scale;

  // Render the preloaded 3D state image directly
  ctx.drawImage(avatarImg, -size / 2, -size / 2, size, size);

  ctx.restore();
}
