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

// Draw the background preset
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: BackgroundType
) {
  ctx.save();
  if (type === 'camera') {
    // Keep raw camera video feed, do not paint any background color
  } else if (type === 'sunset') {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#ff7e5f');
    grad.addColorStop(0.5, '#feb47b');
    grad.addColorStop(1, '#2c3e50');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (type === 'cosmic') {
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      10,
      width / 2,
      height / 2,
      Math.max(width, height)
    );
    grad.addColorStop(0, '#312e81');
    grad.addColorStop(0.4, '#1e1b4b');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    
    // Draw some subtle stars
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    const starCount = 30;
    const seed = 42; // static seed for stars
    for (let i = 0; i < starCount; i++) {
      const x = ((Math.sin(i * 374.2) + 1) / 2) * width;
      const y = ((Math.cos(i * 852.1) + 1) / 2) * height;
      const r = ((Math.sin(i * 123.4) + 1) / 2) * 1.5 + 0.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'mint') {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#a7f3d0');
    grad.addColorStop(0.6, '#064e3b');
    grad.addColorStop(1, '#022c22');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (type === 'office') {
    // A cozy room background: gradient with a warm light source
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#fef3c7'); // Soft amber light
    grad.addColorStop(0.3, '#d97706'); // Warm wood tones
    grad.addColorStop(1, '#1e293b'); // Dark wall base
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Draw stylized cartoon window
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(width * 0.1, height * 0.1, width * 0.3, height * 0.4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 4;
    ctx.strokeRect(width * 0.1, height * 0.1, width * 0.3, height * 0.4);
    ctx.beginPath();
    ctx.moveTo(width * 0.25, height * 0.1);
    ctx.lineTo(width * 0.25, height * 0.5);
    ctx.moveTo(width * 0.1, height * 0.3);
    ctx.lineTo(width * 0.4, height * 0.3);
    ctx.stroke();
  } else {
    // dark
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

// Draw a stylized cartoon body (neck and shirt torso)
export function drawCartoonBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  avatarType: AvatarType
) {
  if (avatarType === 'none') return;
  
  ctx.save();
  
  // Neck starts at the bottom of the face circle (chin)
  // rFace for all avatars is 85 * scale
  const chinY = cy + 85 * scale;
  
  // Decide body/shirt colors based on avatar
  let shirtColor = '#4f46e5'; // Indigo
  let collarColor = '#3730a3';
  let skinColor = '#d97706'; // Beige
  
  if (avatarType === 'bear') {
    skinColor = '#8b5a2b';
    shirtColor = '#10b981'; // Green
    collarColor = '#047857';
  } else if (avatarType === 'cat') {
    skinColor = '#d1d5db'; // Grey
    shirtColor = '#f43f5e'; // Rose
    collarColor = '#be123c';
  } else if (avatarType === 'panda') {
    skinColor = '#ffffff';
    shirtColor = '#1e293b'; // Slate
    collarColor = '#0f172a';
  } else if (avatarType === 'dog') {
    skinColor = '#eab308'; // Yellow/Cream
    shirtColor = '#a855f7'; // Purple
    collarColor = '#7e22ce';
  } else if (avatarType === 'rabbit') {
    skinColor = '#f3f4f6'; // White/Grey
    shirtColor = '#3b82f6'; // Blue
    collarColor = '#1d4ed8';
  }

  // Widths and coordinates relative to the head size
  const neckWidth = 40 * scale;
  const neckHeight = 60 * scale;
  const torsoWidth = 180 * scale;
  const torsoHeight = 150 * scale;

  // 1. Neck (starts from chin, connects downward to torso)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.rect(cx - neckWidth / 2, chinY, neckWidth, neckHeight);
  ctx.fill();
  
  // Subtle shadow under the chin
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.beginPath();
  ctx.rect(cx - neckWidth / 2, chinY, neckWidth, 15 * scale);
  ctx.fill();

  // 2. Torso (Shoulders)
  const shoulderY = chinY + neckHeight - 10 * scale;
  ctx.fillStyle = shirtColor;
  ctx.beginPath();
  // Round shoulders
  ctx.moveTo(cx - torsoWidth / 2, shoulderY + torsoHeight);
  ctx.lineTo(cx - torsoWidth / 2, shoulderY + 40 * scale);
  ctx.quadraticCurveTo(cx - torsoWidth / 2, shoulderY, cx - neckWidth, shoulderY);
  ctx.lineTo(cx + neckWidth, shoulderY);
  ctx.quadraticCurveTo(cx + torsoWidth / 2, shoulderY, cx + torsoWidth / 2, shoulderY + 40 * scale);
  ctx.lineTo(cx + torsoWidth / 2, shoulderY + torsoHeight);
  ctx.closePath();
  ctx.fill();

  // 3. Collar
  ctx.fillStyle = collarColor;
  ctx.beginPath();
  ctx.moveTo(cx - neckWidth - 5 * scale, shoulderY);
  ctx.lineTo(cx, shoulderY + 25 * scale);
  ctx.lineTo(cx + neckWidth + 5 * scale, shoulderY);
  ctx.lineTo(cx + neckWidth, shoulderY);
  ctx.lineTo(cx, shoulderY + 15 * scale);
  ctx.lineTo(cx - neckWidth, shoulderY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Main 2D avatar drawing routine
export function draw2DAvatar(
  ctx: CanvasRenderingContext2D,
  type: AvatarType,
  face: FaceData
) {
  if (type === 'none') return;

  const { cx, cy, scale, rotation, isLeftEyeOpen, isRightEyeOpen, mouthOpenRatio, smileIntensity } = face;

  ctx.save();
  // Translate to face center and rotate to head roll
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  // All coordinates from now on are drawn relative to (0,0) as the center of the face

  if (type === 'bear') {
    drawBear(ctx, scale, isLeftEyeOpen, isRightEyeOpen, mouthOpenRatio, smileIntensity);
  } else if (type === 'cat') {
    drawCat(ctx, scale, isLeftEyeOpen, isRightEyeOpen, mouthOpenRatio, smileIntensity);
  } else if (type === 'panda') {
    drawPanda(ctx, scale, isLeftEyeOpen, isRightEyeOpen, mouthOpenRatio, smileIntensity);
  } else if (type === 'dog') {
    drawDog(ctx, scale, isLeftEyeOpen, isRightEyeOpen, mouthOpenRatio, smileIntensity);
  } else if (type === 'rabbit') {
    drawRabbit(ctx, scale, isLeftEyeOpen, isRightEyeOpen, mouthOpenRatio, smileIntensity);
  }

  ctx.restore();
}

// Helpers for drawing face parts
function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  isOpen: boolean
) {
  ctx.save();
  if (isOpen) {
    // Open eye
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    
    // Highlight reflection
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Closed eye / Blink
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(3, r * 0.3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Smile shape eyes '^'
    ctx.arc(x, y + r * 0.2, r * 0.9, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMouth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  openRatio: number,
  smileIntensity: number
) {
  ctx.save();
  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#be123c'; // Dark red for inside
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const isMouthOpen = openRatio > 0.15;
  const smileYOffset = smileIntensity * 5;

  if (isMouthOpen) {
    // Open mouth
    const mouthHeight = Math.max(10, openRatio * 35);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - smileYOffset);
    ctx.bezierCurveTo(
      x - w / 4, y + mouthHeight,
      x + w / 4, y + mouthHeight,
      x + w / 2, y - smileYOffset
    );
    ctx.bezierCurveTo(
      x + w / 4, y - smileYOffset - 2,
      x - w / 4, y - smileYOffset - 2,
      x - w / 2, y - smileYOffset
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Tongue
    ctx.fillStyle = '#fb7185'; // Pink
    ctx.beginPath();
    ctx.arc(x, y + mouthHeight - 5, w * 0.3, Math.PI, 0);
    ctx.fill();
  } else {
    // Closed mouth (smiling line)
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - smileYOffset);
    ctx.quadraticCurveTo(x, y + 6 + smileYOffset * 0.8, x + w / 2, y - smileYOffset);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlushCheeks(
  ctx: CanvasRenderingContext2D,
  lx: number,
  rx: number,
  y: number,
  r: number,
  intensity: number
) {
  const alpha = 0.15 + intensity * 0.4;
  ctx.save();
  ctx.fillStyle = `rgba(244, 63, 94, ${alpha})`;
  
  ctx.beginPath();
  ctx.arc(lx, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(rx, y, r, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

// 1. BEAR
function drawBear(
  ctx: CanvasRenderingContext2D,
  s: number,
  leftEyeOpen: boolean,
  rightEyeOpen: boolean,
  mouthOpen: number,
  smile: number
) {
  const rFace = 85 * s;
  
  // Ears
  ctx.fillStyle = '#8b5a2b';
  ctx.beginPath();
  ctx.arc(-65 * s, -65 * s, 30 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(65 * s, -65 * s, 30 * s, 0, Math.PI * 2);
  ctx.fill();

  // Inner ears
  ctx.fillStyle = '#fda4af';
  ctx.beginPath();
  ctx.arc(-65 * s, -65 * s, 18 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(65 * s, -65 * s, 18 * s, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#a05a2c';
  ctx.beginPath();
  ctx.arc(0, 0, rFace, 0, Math.PI * 2);
  ctx.fill();

  // Blush Cheeks
  drawBlushCheeks(ctx, -55 * s, 55 * s, 15 * s, 14 * s, smile);

  // Eyes
  drawEye(ctx, -30 * s, -15 * s, 9 * s, leftEyeOpen);
  drawEye(ctx, 30 * s, -15 * s, 9 * s, rightEyeOpen);

  // Snout (Beige)
  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.ellipse(0, 20 * s, 35 * s, 25 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose (Black)
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 14 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  drawMouth(ctx, 0, 26 * s, 32 * s, mouthOpen, smile);
}

// 2. CAT
function drawCat(
  ctx: CanvasRenderingContext2D,
  s: number,
  leftEyeOpen: boolean,
  rightEyeOpen: boolean,
  mouthOpen: number,
  smile: number
) {
  const rFace = 85 * s;

  // Ears (Pointy)
  ctx.fillStyle = '#9ca3af'; // Grey cat
  ctx.beginPath();
  ctx.moveTo(-75 * s, -35 * s);
  ctx.lineTo(-75 * s, -95 * s);
  ctx.lineTo(-25 * s, -65 * s);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(75 * s, -35 * s);
  ctx.lineTo(75 * s, -95 * s);
  ctx.lineTo(25 * s, -65 * s);
  ctx.closePath();
  ctx.fill();

  // Inner ears
  ctx.fillStyle = '#fda4af';
  ctx.beginPath();
  ctx.moveTo(-70 * s, -40 * s);
  ctx.lineTo(-70 * s, -85 * s);
  ctx.lineTo(-32 * s, -63 * s);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(70 * s, -40 * s);
  ctx.lineTo(70 * s, -85 * s);
  ctx.lineTo(32 * s, -63 * s);
  ctx.closePath();
  ctx.fill();

  // Head
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(0, 0, rFace, 0, Math.PI * 2);
  ctx.fill();

  // Blush Cheeks
  drawBlushCheeks(ctx, -55 * s, 55 * s, 20 * s, 12 * s, smile);

  // Whiskers (Left)
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-50 * s, 15 * s); ctx.lineTo(-95 * s, 10 * s);
  ctx.moveTo(-50 * s, 23 * s); ctx.lineTo(-100 * s, 23 * s);
  ctx.moveTo(-50 * s, 31 * s); ctx.lineTo(-95 * s, 36 * s);
  ctx.stroke();

  // Whiskers (Right)
  ctx.beginPath();
  ctx.moveTo(50 * s, 15 * s); ctx.lineTo(95 * s, 10 * s);
  ctx.moveTo(50 * s, 23 * s); ctx.lineTo(100 * s, 23 * s);
  ctx.moveTo(50 * s, 31 * s); ctx.lineTo(95 * s, 36 * s);
  ctx.stroke();

  // Eyes
  drawEye(ctx, -32 * s, -12 * s, 9 * s, leftEyeOpen);
  drawEye(ctx, 32 * s, -12 * s, 9 * s, rightEyeOpen);

  // Nose (Small pink triangle)
  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.moveTo(0, 2 * s);
  ctx.lineTo(-8 * s, -6 * s);
  ctx.lineTo(8 * s, -6 * s);
  ctx.closePath();
  ctx.fill();

  // Mouth curves
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-8 * s, 5 * s, 8 * s, Math.PI, 0, true);
  ctx.arc(8 * s, 5 * s, 8 * s, Math.PI, 0, true);
  ctx.stroke();

  // Dynamic open mouth
  if (mouthOpen > 0.15) {
    drawMouth(ctx, 0, 10 * s, 24 * s, mouthOpen, smile);
  }
}

// 3. PANDA
function drawPanda(
  ctx: CanvasRenderingContext2D,
  s: number,
  leftEyeOpen: boolean,
  rightEyeOpen: boolean,
  mouthOpen: number,
  smile: number
) {
  const rFace = 85 * s;

  // Black Ears
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(-65 * s, -65 * s, 28 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(65 * s, -65 * s, 28 * s, 0, Math.PI * 2);
  ctx.fill();

  // White Head
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, rFace, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dark Eye Patches (Tilted Ellipses)
  ctx.fillStyle = '#1e293b';
  ctx.save();
  ctx.translate(-30 * s, -12 * s);
  ctx.rotate(0.2);
  ctx.beginPath();
  ctx.ellipse(0, 0, 22 * s, 28 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(30 * s, -12 * s);
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.ellipse(0, 0, 22 * s, 28 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eyes (white inner, black pupil or blink)
  if (leftEyeOpen) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-28 * s, -12 * s, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-26 * s, -12 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Curved white blink line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-28 * s, -8 * s, 7 * s, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }

  if (rightEyeOpen) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(28 * s, -12 * s, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(26 * s, -12 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(28 * s, -8 * s, 7 * s, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }

  // Blush Cheeks (visible over white skin)
  drawBlushCheeks(ctx, -55 * s, 55 * s, 22 * s, 13 * s, smile);

  // Nose (Small black oval)
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(0, 10 * s, 12 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  drawMouth(ctx, 0, 24 * s, 28 * s, mouthOpen, smile);
}

// 4. DOG
function drawDog(
  ctx: CanvasRenderingContext2D,
  s: number,
  leftEyeOpen: boolean,
  rightEyeOpen: boolean,
  mouthOpen: number,
  smile: number
) {
  const rFace = 82 * s;

  // Floppy Ears (drawn hanging down)
  ctx.fillStyle = '#b45309'; // Dark brown ears
  
  // Left Ear
  ctx.beginPath();
  ctx.moveTo(-60 * s, -40 * s);
  ctx.bezierCurveTo(-110 * s, -40 * s, -110 * s, 40 * s, -80 * s, 70 * s);
  ctx.bezierCurveTo(-60 * s, 70 * s, -50 * s, 0 * s, -60 * s, -40 * s);
  ctx.closePath();
  ctx.fill();

  // Right Ear
  ctx.beginPath();
  ctx.moveTo(60 * s, -40 * s);
  ctx.bezierCurveTo(110 * s, -40 * s, 110 * s, 40 * s, 80 * s, 70 * s);
  ctx.bezierCurveTo(60 * s, 70 * s, 50 * s, 0 * s, 60 * s, -40 * s);
  ctx.closePath();
  ctx.fill();

  // Head (Golden cream)
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(0, 0, rFace, 0, Math.PI * 2);
  ctx.fill();

  // White patch on face
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0, 15 * s, 35 * s, 30 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Blush Cheeks
  drawBlushCheeks(ctx, -52 * s, 52 * s, 15 * s, 12 * s, smile);

  // Eyes
  drawEye(ctx, -28 * s, -15 * s, 9 * s, leftEyeOpen);
  drawEye(ctx, 28 * s, -15 * s, 9 * s, rightEyeOpen);

  // Snout nose
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(0, 6 * s, 15 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  drawMouth(ctx, 0, 24 * s, 30 * s, mouthOpen, smile);
}

// 5. RABBIT
function drawRabbit(
  ctx: CanvasRenderingContext2D,
  s: number,
  leftEyeOpen: boolean,
  rightEyeOpen: boolean,
  mouthOpen: number,
  smile: number
) {
  const rFace = 80 * s;

  // Tall Ears
  ctx.fillStyle = '#f3f4f6'; // White ears
  
  // Left Ear
  ctx.beginPath();
  ctx.ellipse(-30 * s, -100 * s, 18 * s, 60 * s, -0.05, 0, Math.PI * 2);
  ctx.fill();
  
  // Right Ear
  ctx.beginPath();
  ctx.ellipse(30 * s, -100 * s, 18 * s, 60 * s, 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Inner ears pink
  ctx.fillStyle = '#fda4af';
  ctx.beginPath();
  ctx.ellipse(-30 * s, -100 * s, 9 * s, 48 * s, -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(30 * s, -100 * s, 9 * s, 48 * s, 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, rFace, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Blush Cheeks
  drawBlushCheeks(ctx, -52 * s, 18 * s, 18 * s, 13 * s, smile);

  // Eyes
  drawEye(ctx, -28 * s, -12 * s, 9 * s, leftEyeOpen);
  drawEye(ctx, 28 * s, -12 * s, 9 * s, rightEyeOpen);

  // Snout (Small pink nose)
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6 * s, -6 * s);
  ctx.lineTo(6 * s, -6 * s);
  ctx.closePath();
  ctx.fill();

  // Rabbit Mouth & Buck teeth
  ctx.save();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-7 * s, 6 * s, 7 * s, Math.PI, 0, true);
  ctx.arc(7 * s, 6 * s, 7 * s, Math.PI, 0, true);
  ctx.stroke();

  // Open mouth
  const isMouthOpen = mouthOpen > 0.15;
  if (isMouthOpen) {
    // Open black gap
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, 10 * s, 12 * s, 0, Math.PI);
    ctx.fill();

    // Draw buck teeth at top of open mouth
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-6 * s, 8 * s, 5 * s, 8 * s);
    ctx.strokeRect(-6 * s, 8 * s, 5 * s, 8 * s);
    ctx.fillRect(1 * s, 8 * s, 5 * s, 8 * s);
    ctx.strokeRect(1 * s, 8 * s, 5 * s, 8 * s);
  } else {
    // Draw teeth resting slightly
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-5 * s, 5 * s, 4 * s, 5 * s);
    ctx.strokeRect(-5 * s, 5 * s, 4 * s, 5 * s);
    ctx.fillRect(1 * s, 5 * s, 4 * s, 5 * s);
    ctx.strokeRect(1 * s, 5 * s, 4 * s, 5 * s);
  }
  ctx.restore();
}
