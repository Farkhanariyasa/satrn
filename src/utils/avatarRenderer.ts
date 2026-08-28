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
}

// Client-side preloader and flood-fill transparent background keyer
class AvatarImageLoader {
  private cache: Record<string, HTMLCanvasElement> = {};
  private loading: Record<string, boolean> = {};

  getAvatar(type: Exclude<AvatarType, 'none'>): HTMLCanvasElement | null {
    if (typeof window === 'undefined') return null;
    if (this.cache[type]) return this.cache[type];
    if (this.loading[type]) return null;

    this.loading[type] = true;
    const img = new Image();
    img.src = `/avatar_${type}.jpg`;
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        
        const width = canvas.width;
        const height = canvas.height;
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const visited = new Uint8Array(width * height);
        const queue: [number, number][] = [];

        // Strict threshold of 250 to capture the flat white background
        // and stop exactly at the anti-aliased edge of the head outline.
        const isWhiteBackground = (x: number, y: number) => {
          const idx = (y * width + x) * 4;
          return data[idx] > 250 && data[idx+1] > 250 && data[idx+2] > 250;
        };

        const pushPixel = (x: number, y: number) => {
          const idx = y * width + x;
          if (!visited[idx] && isWhiteBackground(x, y)) {
            visited[idx] = 1;
            queue.push([x, y]);
          }
        };

        // Add border pixels to start flood fill
        for (let x = 0; x < width; x++) {
          pushPixel(x, 0);
          pushPixel(x, height - 1);
        }
        for (let y = 0; y < height; y++) {
          pushPixel(0, y);
          pushPixel(width - 1, y);
        }

        // BFS flood fill
        let head = 0;
        while (head < queue.length) {
          const [cx, cy] = queue[head++];
          const idx = (cy * width + cx) * 4;
          data[idx+3] = 0; // Set background to transparent

          if (cx > 0) pushPixel(cx - 1, cy);
          if (cx < width - 1) pushPixel(cx + 1, cy);
          if (cy > 0) pushPixel(cx, cy - 1);
          if (cy < height - 1) pushPixel(cx, cy + 1);
        }

        ctx.putImageData(imgData, 0, 0);
        this.cache[type] = canvas;
      }
      this.loading[type] = false;
    };
    
    img.onerror = () => {
      console.error(`Failed to load avatar graphic: /avatar_${type}.jpg`);
      this.loading[type] = false;
    };
    
    return null;
  }

  preloadAll() {
    if (typeof window === 'undefined') return;
    const types: Exclude<AvatarType, 'none'>[] = ['bear', 'cat', 'panda', 'dog', 'rabbit'];
    types.forEach(t => this.getAvatar(t));
  }
}

export const avatarLoader = new AvatarImageLoader();

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: BackgroundType
) {
  // Silent fallback
}

export function drawCartoonBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  avatarType: AvatarType
) {
  // Silent fallback
}

export function draw2DAvatar(
  ctx: CanvasRenderingContext2D,
  type: AvatarType,
  face: FaceData
) {
  if (type === 'none') return;
  
  const avatarImg = avatarLoader.getAvatar(type);
  if (!avatarImg) return;

  const { cx, cy, scale, rotation } = face;

  ctx.save();
  // Adjust vertical shift anchor slightly upward to cover hair properly
  const verticalOffset = -45 * scale;
  ctx.translate(cx, cy + verticalOffset);
  ctx.rotate(rotation);

  // Sticker size (scaled to 300px base size)
  const size = 300 * scale;
  ctx.drawImage(avatarImg, -size / 2, -size / 2, size, size);

  ctx.restore();
}
