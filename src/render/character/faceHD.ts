import * as THREE from 'three';
import { FACE_PHI_DEG, FACE_THETA_START, FACE_THETA_LENGTH } from '../textures';

/**
 * 高解析度臉部貼圖（1024×768）：參考 docs/concept/ninja-sheet-*.jpg 的大眼、粗眉、鬍鬚紋、腮紅。
 * 畫在頭部球面的「臉部切片」上，座標換算與 textures.ts 的 facePoint 相同（基準 512×384，再整張放大 2 倍）。
 */

/** 臉部貼圖的基準尺寸（繪圖座標），實際畫布是 SCALE 倍 */
const W = 512;
const H = 384;
const SCALE = 2;

/** 臉部貼圖選項 */
export interface FaceHDOptions {
  /** 虹膜主色（中心偏亮、外圈偏暗由程式產生） */
  iris: string;
  /** 眉毛顏色 */
  brow: string;
  /** 臉頰鬍鬚紋 */
  whiskers?: boolean;
  /** 鼻樑橫疤 */
  noseScar?: boolean;
  /** 腮紅 */
  blush?: boolean;
  /** 嘴型：smile 微笑、grin 咧嘴、shout 大叫、angry 生氣 */
  mouth?: 'smile' | 'grin' | 'shout' | 'angry';
  /** 眉型：up 自信上揚、angry 皺眉 */
  browShape?: 'up' | 'angry';
}

/** 頭部座標 → 貼圖座標（yawDeg：偏離正面的角度，正值往觀看者右邊；yr：高度 / 頭半徑） */
function fp(yawDeg: number, yr: number): [number, number] {
  const x = ((yawDeg + FACE_PHI_DEG / 2) / FACE_PHI_DEG) * W;
  const theta = Math.acos(Math.max(-1, Math.min(1, yr)));
  const y = ((theta - FACE_THETA_START) / FACE_THETA_LENGTH) * H;
  return [x, y];
}

/** 把色碼變亮或變暗（amt：−1..1） */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

/**
 * 畫一隻大眼睛：杏仁形眼白、漸層虹膜、瞳孔、兩個高光、粗上眼線（眼尾上挑）、細下眼線。
 * @param side −1 觀看者左邊、+1 右邊
 */
function drawEye(g: CanvasRenderingContext2D, cx: number, cy: number, side: number, iris: string): void {
  const w = 92;
  const h = 82;
  g.save();
  g.translate(cx, cy);
  // 眼白
  const white = new Path2D();
  white.moveTo(-w / 2, 6);
  white.bezierCurveTo(-w * 0.42, -h * 0.62, w * 0.42, -h * 0.66, w / 2, -2 * side - 2);
  white.bezierCurveTo(w * 0.36, h * 0.5, -w * 0.36, h * 0.52, -w / 2, 6);
  g.fillStyle = '#ffffff';
  g.fill(white);
  g.save();
  g.clip(white);
  // 上眼瞼投在眼白上的淡陰影
  g.fillStyle = 'rgba(120,140,170,0.25)';
  g.fillRect(-w, -h, w * 2, h * 0.45);
  // 虹膜：上暗下亮的放射漸層
  const ix = 2 * side;
  const iy = 2;
  const ir = 29;
  const grad = g.createRadialGradient(ix, iy + 8, 2, ix, iy, ir);
  grad.addColorStop(0, shade(iris, 0.55));
  grad.addColorStop(0.55, iris);
  grad.addColorStop(1, shade(iris, -0.45));
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(ix, iy, ir * 0.9, ir * 1.05, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = shade(iris, -0.6);
  g.lineWidth = 2.5;
  g.stroke();
  // 瞳孔
  g.fillStyle = '#0d1220';
  g.beginPath();
  g.ellipse(ix, iy + 1, 11, 14.5, 0, 0, Math.PI * 2);
  g.fill();
  // 高光：左上大、右下小
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(ix - 10, iy - 12, 9, 10.5, -0.3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(ix + 11, iy + 14, 4, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // 上眼線：粗，外側眼尾上挑
  g.strokeStyle = '#2a1a12';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(-w / 2 - 2 * side, 8);
  g.bezierCurveTo(-w * 0.42, -h * 0.66, w * 0.42, -h * 0.7, w / 2 + 3, -4);
  g.stroke();
  // 眼尾小翹
  g.lineWidth = 5;
  g.beginPath();
  const tailX = side > 0 ? w / 2 + 3 : -w / 2 - 2;
  g.moveTo(tailX, side > 0 ? -4 : 8);
  g.lineTo(tailX + 8 * side, side > 0 ? -10 : 2);
  g.stroke();
  // 下眼線：細
  g.lineWidth = 2.2;
  g.strokeStyle = 'rgba(60,35,25,0.8)';
  g.beginPath();
  g.moveTo(-w * 0.32, h * 0.38);
  g.quadraticCurveTo(0, h * 0.58, w * 0.32, h * 0.36);
  g.stroke();
  g.restore();
}

/**
 * 產生高解析度臉部貼圖（透明底，只有五官）。
 */
export function faceTextureHD(opts: FaceHDOptions): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext('2d')!;
  g.scale(SCALE, SCALE);

  // 腮紅（先畫，在最底層）
  if (opts.blush) {
    for (const side of [-1, 1]) {
      const [bx, by] = fp(33 * side, -0.36);
      const grad = g.createRadialGradient(bx, by, 2, bx, by, 34);
      grad.addColorStop(0, 'rgba(255,130,120,0.35)');
      grad.addColorStop(1, 'rgba(255,130,120,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(bx, by, 36, 22, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 眼睛與眉毛
  for (const side of [-1, 1]) {
    const [ex, ey] = fp(21 * side, -0.13);
    drawEye(g, ex, ey, side, opts.iris);
    // 粗眉：內側低外側高（自信），或內側壓低（生氣）
    const angry = opts.browShape === 'angry';
    const [b1x, b1y] = fp(8 * side, angry ? 0.06 : 0.1);
    const [b2x, b2y] = fp(33 * side, angry ? 0.15 : 0.14);
    g.strokeStyle = shade(opts.brow, -0.35);
    g.lineCap = 'round';
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(b1x, b1y);
    g.quadraticCurveTo((b1x + b2x) / 2, Math.min(b1y, b2y) - 6, b2x, b2y);
    g.stroke();
    g.strokeStyle = opts.brow;
    g.lineWidth = 7;
    g.stroke();
  }

  // 鬍鬚紋：每邊三條，兩端漸細（用填色的細長三角形）
  if (opts.whiskers) {
    g.fillStyle = '#3a2418';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const yr = -0.33 - i * 0.07;
        const [x1, y1] = fp(30 * side, yr + 0.012);
        const [x2, y2] = fp(47 * side, yr - 0.02 - i * 0.008);
        const nx = -(y2 - y1);
        const ny = x2 - x1;
        const len = Math.hypot(nx, ny) || 1;
        const t = 2.2;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo((x1 + x2) / 2 + (nx / len) * t, (y1 + y2) / 2 + (ny / len) * t);
        g.lineTo(x2, y2);
        g.lineTo((x1 + x2) / 2 - (nx / len) * t, (y1 + y2) / 2 - (ny / len) * t);
        g.closePath();
        g.fill();
      }
    }
  }

  // 鼻樑橫疤
  if (opts.noseScar) {
    const [sx1, sy1] = fp(-16, -0.18);
    const [sx2, sy2] = fp(16, -0.17);
    g.strokeStyle = 'rgba(150,80,60,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(sx1, sy1);
    g.lineTo(sx2, sy2);
    g.stroke();
  }

  // 嘴
  const [mx, my] = fp(0, -0.58);
  g.strokeStyle = '#3a1d14';
  g.lineCap = 'round';
  g.lineWidth = 4;
  const mouth = opts.mouth ?? 'smile';
  if (mouth === 'smile') {
    // 一邊嘴角略高的自信微笑
    g.beginPath();
    g.moveTo(mx - 26, my - 6);
    g.quadraticCurveTo(mx - 2, my + 14, mx + 28, my - 10);
    g.stroke();
  } else if (mouth === 'grin') {
    g.beginPath();
    g.moveTo(mx - 30, my - 8);
    g.quadraticCurveTo(mx, my - 3, mx + 30, my - 10);
    g.quadraticCurveTo(mx + 2, my + 30, mx - 30, my - 8);
    g.closePath();
    g.fillStyle = '#8f2a2a';
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#ffffff';
    g.fillRect(mx - 32, my - 14, 64, 11);
    g.restore();
    g.stroke();
  } else if (mouth === 'shout') {
    g.beginPath();
    g.ellipse(mx, my + 2, 18, 20, 0, 0, Math.PI * 2);
    g.fillStyle = '#7a1f1f';
    g.fill();
    g.stroke();
  } else {
    // 生氣：下彎的嘴角
    g.beginPath();
    g.moveTo(mx - 22, my + 6);
    g.quadraticCurveTo(mx, my - 8, mx + 22, my + 6);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 暗部面具（高解析度）：白瓷面具鋪滿臉部切片，紅色貓臉紋、細長的黑色眼洞、淡淡的立體陰影。
 * 原創圖樣，只求「雷同」。
 */
export function anbuMaskHD(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext('2d')!;
  g.scale(SCALE, SCALE);
  // 面具本體：上寬下窄的蛋形，邊緣淡灰陰影
  const [cx, cy] = fp(0, -0.12);
  const shape = new Path2D();
  shape.ellipse(cx, cy, W * 0.37, H * 0.64, 0, 0, Math.PI * 2);
  const grad = g.createRadialGradient(cx - 30, cy - 50, 20, cx, cy, W * 0.42);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.7, '#eeebe4');
  grad.addColorStop(1, '#c9c4ba');
  g.fillStyle = grad;
  g.fill(shape);
  g.strokeStyle = '#a9a398';
  g.lineWidth = 4;
  g.stroke(shape);
  g.save();
  g.clip(shape);
  // 眼洞：細長斜縫
  for (const side of [-1, 1]) {
    const [ex, ey] = fp(20 * side, -0.08);
    g.save();
    g.translate(ex, ey);
    g.rotate(-0.28 * side);
    g.fillStyle = '#121212';
    g.beginPath();
    g.ellipse(0, 0, 30, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 紅色紋路：額頭兩道、臉頰三道（貓臉）
    g.strokeStyle = '#c4252b';
    g.lineCap = 'round';
    g.lineWidth = 9;
    const [f1x, f1y] = fp(9 * side, 0.18);
    const [f2x, f2y] = fp(24 * side, 0.06);
    g.beginPath();
    g.moveTo(f1x, f1y);
    g.lineTo(f2x, f2y);
    g.stroke();
    g.lineWidth = 7;
    for (let i = 0; i < 3; i++) {
      const [k1x, k1y] = fp(27 * side, -0.3 - i * 0.1);
      const [k2x, k2y] = fp(43 * side, -0.35 - i * 0.1);
      g.beginPath();
      g.moveTo(k1x, k1y);
      g.lineTo(k2x, k2y);
      g.stroke();
    }
  }
  // 鼻樑的立體陰影與小小的口部紅點
  const [nx, ny] = fp(0, -0.3);
  g.fillStyle = 'rgba(150,140,130,0.35)';
  g.beginPath();
  g.ellipse(nx + 4, ny, 8, 26, 0, 0, Math.PI * 2);
  g.fill();
  const [mx, my] = fp(0, -0.56);
  g.fillStyle = '#c4252b';
  g.beginPath();
  g.moveTo(mx - 9, my - 5);
  g.lineTo(mx + 9, my - 5);
  g.lineTo(mx, my + 7);
  g.closePath();
  g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
