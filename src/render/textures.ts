import * as THREE from 'three';

/**
 * 程式繪製的貼圖（Canvas 2D → CanvasTexture），全部原創、不用外部圖檔。
 * 臉部貼圖畫在頭部球面的「臉部切片」上，座標換算見 facePoint。
 */

/** 臉部切片涵蓋的水平角度（度），以正面為中心左右各一半 */
export const FACE_PHI_DEG = 120;
/** 臉部切片的上下範圍（球面 theta，弧度）：從頭頂往下量 */
export const FACE_THETA_START = Math.PI * 0.32;
export const FACE_THETA_LENGTH = Math.PI * 0.5;

/** 建立 Canvas 與 2D context 的小工具 */
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return [c, g];
}

/** 把 canvas 包成貼圖（sRGB 色彩空間，否則顏色會偏淡） */
function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * 漫畫風煙霧貼圖：數個白色圓團疊在一起、外圈淡灰描邊（替身術、影分身、通靈的「砰」）。
 */
export function smokeTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(128, 128);
  const blobs: [number, number, number][] = [
    [64, 70, 34], [38, 62, 24], [90, 60, 26], [52, 40, 24], [80, 38, 22], [64, 92, 22], [34, 86, 18], [96, 88, 18],
  ];
  // 先畫外圈描邊，再畫白色填充，讓內部的圓團不會互相描邊
  g.fillStyle = '#9aa0a6';
  for (const [x, y, r] of blobs) {
    g.beginPath();
    g.arc(x, y, r + 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of blobs) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // 下半部一點陰影
  g.fillStyle = 'rgba(160,170,180,0.35)';
  for (const [x, y, r] of blobs) {
    g.beginPath();
    g.arc(x + r * 0.15, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

/**
 * 柔邊圓形光點（查克拉光、閃光、腳底光）：中心白、往外漸透明。
 */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/**
 * 道具徽章貼圖：彩色圓盤＋白色粗體漢字（例如「蛙」「引」「影」）。
 */
export function badgeTexture(kanji: string, color: string, rim = '#fff6d8'): THREE.CanvasTexture {
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = rim;
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 6;
  g.font = "900 72px 'Noto Serif TC', 'Microsoft JhengHei', 'PingFang TC', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeText(kanji, 64, 68);
  g.fillText(kanji, 64, 68);
  return toTexture(c);
}
