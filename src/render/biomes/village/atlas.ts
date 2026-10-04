import * as THREE from 'three';
import { seeded } from '../../proctex';
import type { UVSpec } from './builder';

/**
 * 木葉村的「調色盤圖集」（1024×1024）：一張貼圖裡放
 * - 純色色塊（16×16 一格）：純色零件的 UV 全部指到色塊中心，就能用同一個材質畫出上百種顏色；
 * - 小圖：直式招牌、橫式招牌、暖簾、窗、燈籠紙、家徽、門、樹葉、條紋…（UV 映射到矩形）。
 * 另外產生一張同版面的自發光貼圖（512×512），只有燈籠紙、亮著的窗、燈泡會發光。
 * 合併網格只留 position／normal／uv，所以「一個材質＋圖集 UV」是降低 draw call 的關鍵。
 */

/** 圖集寬高（像素） */
const AW = 1024;
const AH = 1024;
/** 自發光貼圖的縮放（512 / 1024） */
const ES = 0.5;

/** 招牌用字型：楷書（毛筆感），最後退回系統襯線字 */
export const FONT_BRUSH = "'DFKai-SB','BiauKai','KaiTi','STKaiti','Kaiti TC','Noto Serif TC','Noto Serif CJK TC',serif";
/** 粗黑體（塗鴉、車號） */
export const FONT_BOLD = "'Microsoft JhengHei','PingFang TC','Noto Sans TC','Noto Sans CJK TC','Heiti TC',sans-serif";

/** 調色盤色塊（名稱 → 顏色） */
const SW = {
  black: 0x1c1a1c,
  ink: 0x2b2731,
  charcoal: 0x3c3a40,
  iron: 0x4b4f57,
  steel: 0x8b939c,
  silver: 0xc9d0d6,
  chrome: 0xe4e9ee,
  darkWood: 0x4b3020,
  wood: 0x7d5233,
  lightWood: 0xb98a52,
  paleWood: 0xdcb87e,
  bamboo: 0xbdb85c,
  bambooDark: 0x7f8c3a,
  vermilion: 0xe2492b,
  red: 0xd02b2b,
  darkRed: 0x921f1c,
  brick: 0xab462e,
  orange: 0xf58b28,
  amber: 0xf4b133,
  yellow: 0xf8d247,
  gold: 0xdcaa3c,
  cream: 0xf6e8c9,
  ivory: 0xfcf7eb,
  white: 0xffffff,
  paper: 0xf9f1dd,
  sand: 0xdbc69c,
  indigo: 0x283a70,
  navy: 0x1d2a4a,
  blue: 0x2f70d4,
  sky: 0x67b7ee,
  teal: 0x1f8b8b,
  aqua: 0x6ccac1,
  green: 0x3f913a,
  leaf: 0x6db34b,
  lime: 0xa8d24a,
  darkGreen: 0x2b5c2e,
  moss: 0x5f7c34,
  pink: 0xf39cb9,
  sakura: 0xf9c7d7,
  magenta: 0xd4487f,
  purple: 0x7b4fa2,
  stone: 0xa9a399,
  lightStone: 0xd2ccc0,
  darkStone: 0x6e6a63,
  concrete: 0xbcb7ad,
  slate: 0x5b6571,
  rust: 0x9c4e2a,
  copper: 0x4f9c85,
  brass: 0xcaa44b,
  terracotta: 0xcb663b,
  clay: 0xb3825f,
  rubber: 0x27282b,
  glassDark: 0x25333f,
  glass: 0x5f88a8,
  tankBlue: 0x5f97d6,
  tankSteel: 0xc3cbd2,
  tankRust: 0xc87b46,
  tankGreen: 0x76ab8b,
  rope: 0xcda873,
  straw: 0xdac27c,
  burlap: 0xcbb07f,
  bark: 0x5e4333,
  darkBark: 0x3f2d23,
  shadow: 0x1b1612,
  interior: 0x2d2119,
  interiorWarm: 0x8c5b33,
  lampOn: 0xfff2cc,
  lanternGlow: 0xff7b3b,
  windowLit: 0xffd992,
  soil: 0x6f5139,
  grassDark: 0x4f8b35,
  flowerRed: 0xe3394b,
  flowerYellow: 0xf7d33b,
  flowerWhite: 0xf9f5ef,
  flowerBlue: 0x6b8be1,
  clothBlue: 0x3b67b2,
  clothRed: 0xd8473b,
  clothWhite: 0xf3f0e7,
  clothYellow: 0xf3c94b,
  clothGreen: 0x509b5b,
  clothPurple: 0x8b5ba9,
  mailRed: 0xd9271f,
  hazardYellow: 0xf6c61a,
} as const;

/** 色塊名稱 */
export type SwatchName = keyof typeof SW;

/** 會發光的色塊與它的自發光顏色 */
const SW_EMISSIVE: Partial<Record<SwatchName, string>> = {
  lampOn: '#fff4d8',
  lanternGlow: '#ff8a40',
  windowLit: '#d8a860',
  interiorWarm: '#4a2a10',
};

/** 色塊索引（依宣告順序） */
const swNames = Object.keys(SW) as SwatchName[];
const swIndex = new Map<SwatchName, number>(swNames.map((n, i) => [n, i]));

/** 色塊格子大小與每列格數 */
const SW_CELL = 16;
const SW_PER_ROW = AW / SW_CELL;

/** 小圖區域：起點、單格大小、格數（每列放不下就換列） */
const REGIONS = {
  door: { x: 0, y: 32, w: 128, h: 96, n: 8 },
  vsign: { x: 0, y: 128, w: 64, h: 256, n: 16 },
  hsign: { x: 0, y: 384, w: 256, h: 64, n: 8 },
  noren: { x: 0, y: 512, w: 256, h: 192, n: 4 },
  window: { x: 0, y: 704, w: 128, h: 128, n: 8 },
  lantern: { x: 0, y: 832, w: 128, h: 128, n: 4 },
  crest: { x: 512, y: 832, w: 128, h: 128, n: 4 },
  misc: { x: 0, y: 960, w: 128, h: 64, n: 8 },
} as const;
type RegionName = keyof typeof REGIONS;

/** 各區域的小圖編號（給呼叫端用名字取圖） */
export const DOOR = { slide: 0, amado: 1, train: 2, studded: 3, plaqueFire: 4, plaqueNin: 5, shelf: 6, bellows: 7 } as const;
export const NOREN = { wave: 0, ramen: 1, tea: 2, sake: 3 } as const;
export const WINDOW = { shoji: 0, koshi: 1, curtain: 2, lit: 3, mushiko: 4, display: 5, train: 6, trainNoren: 7 } as const;
export const LANTERN = { matsuri: 0, fire: 1, ninja: 2, tea: 3 } as const;
export const CREST = { fire: 0, swirl: 1, leaf: 2, nin: 3 } as const;
export const MISC = { sakura: 0, leaves: 1, pine: 2, stripes: 3, ricebag: 4, bamboo: 5, crate: 6, laundry: 7 } as const;
/** 直式招牌與幟旗的數量（0..11 招牌、12..15 幟旗） */
export const VSIGN_BOARDS = 12;
export const VSIGN_FLAGS = 4;
export const HSIGN_COUNT = 8;

/** 像素矩形 */
interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 取某區域第 i 格的像素矩形 */
function slot(region: RegionName, i: number): PxRect {
  const r = REGIONS[region];
  const per = Math.floor((AW - r.x) / r.w);
  const k = ((i % r.n) + r.n) % r.n;
  return { x: r.x + (k % per) * r.w, y: r.y + Math.floor(k / per) * r.h, w: r.w, h: r.h };
}

/** 色塊 UV（指到色塊中心的單點） */
export function sw(name: SwatchName): UVSpec {
  const i = swIndex.get(name) ?? 0;
  const cx = (i % SW_PER_ROW) * SW_CELL + SW_CELL / 2;
  const cy = Math.floor(i / SW_PER_ROW) * SW_CELL + SW_CELL / 2;
  return { k: 'pt', u: cx / AW, v: 1 - cy / AH };
}

/**
 * 小圖 UV（整張圖映射到面上）。CanvasTexture 預設 flipY，所以 v 由下往上。
 * @param inset 內縮像素，避免 mipmap 取樣到隔壁的圖
 */
export function img(region: RegionName, i: number, inset = 2): UVSpec {
  const r = slot(region, i);
  return {
    k: 'rect',
    u0: (r.x + inset) / AW,
    u1: (r.x + r.w - inset) / AW,
    v0: 1 - (r.y + r.h - inset) / AH,
    v1: 1 - (r.y + inset) / AH,
  };
}

/** 取小圖的一部分（fx0..fx1、fy0..fy1 是 0..1 比例，fy 由上往下） */
export function imgPart(region: RegionName, i: number, fx0: number, fy0: number, fx1: number, fy1: number): UVSpec {
  const r = slot(region, i);
  return {
    k: 'rect',
    u0: (r.x + fx0 * r.w) / AW,
    u1: (r.x + fx1 * r.w) / AW,
    v0: 1 - (r.y + fy1 * r.h) / AH,
    v1: 1 - (r.y + fy0 * r.h) / AH,
  };
}

/** 數值顏色 → CSS 字串 */
export function css(c: number, k = 1): string {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

/** 圓角矩形路徑 */
export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

/** 在矩形範圍加上明暗雜訊（讓純色看起來有材質） */
function grain(g: CanvasRenderingContext2D, r: PxRect, amount: number, seed: number, streak = 0): void {
  const img = g.getImageData(r.x, r.y, r.w, r.h);
  const rnd = seeded(seed);
  const rowJit = new Float32Array(r.h).map(() => (rnd() - 0.5) * streak);
  const d = img.data;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      const k = 1 + (rnd() - 0.5) * amount + rowJit[y];
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
  g.putImageData(img, r.x, r.y);
}

/** 置中文字（可描邊） */
function text(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  font: string,
  fill: string,
  stroke?: string,
  strokeW = 0,
): void {
  g.font = `900 ${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (stroke && strokeW > 0) {
    g.lineJoin = 'round';
    g.strokeStyle = stroke;
    g.lineWidth = strokeW;
    g.strokeText(s, x, y);
  }
  g.fillStyle = fill;
  g.fillText(s, x, y);
}

/** 漩渦（阿基米德螺線）描線 */
export function spiral(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, turns: number, width: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  const total = Math.PI * 2 * turns;
  for (let a = 0; a <= total; a += 0.08) {
    const rr = (a / total) * r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

/** 五角星（描邊或填色） */
export function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string | null, stroke: string | null, lw = 2): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.stroke();
  }
}

/** 浪花：一個捲起的浪頭（白色粗線＋浪沫小圓） */
export function curlWave(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, lw: number): void {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  // 浪身：從左下往上捲到浪頭
  g.beginPath();
  g.moveTo(cx - r * 1.3, cy + r * 0.9);
  g.quadraticCurveTo(cx - r * 0.9, cy - r * 0.2, cx, cy - r * 0.55);
  g.quadraticCurveTo(cx + r * 0.9, cy - r * 0.85, cx + r * 0.8, cy + r * 0.05);
  g.stroke();
  // 浪頭的捲曲（螺線）
  const tx = cx + r * 0.28;
  const ty = cy - r * 0.05;
  g.beginPath();
  for (let a = 0; a < Math.PI * 3.2; a += 0.1) {
    const rr = r * 0.5 * (1 - a / (Math.PI * 3.6));
    const x = tx + Math.cos(-a) * rr;
    const y = ty + Math.sin(-a) * rr;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // 內側的兩道弧線
  for (const k of [0.62, 0.38]) {
    g.beginPath();
    g.moveTo(cx - r * 1.3 * k - r * 0.2, cy + r * 0.9);
    g.quadraticCurveTo(cx - r * 0.7 * k, cy, cx + r * 0.1, cy - r * 0.3 * k);
    g.lineWidth = lw * 0.6;
    g.stroke();
  }
  // 浪沫
  g.lineWidth = lw;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(cx + r * (0.95 + i * 0.12), cy - r * (0.55 - i * 0.18), lw * (1.1 - i * 0.18), 0, Math.PI * 2);
    g.fill();
  }
}

/** 青海波（重疊的同心半圓，暖簾下緣的波紋） */
function seigaiha(g: CanvasRenderingContext2D, r: PxRect, cell: number, bg: string, fg: string, lw: number): void {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  const rows = Math.ceil(r.h / (cell * 0.5)) + 2;
  for (let row = 0; row < rows; row++) {
    const y = r.y + row * cell * 0.5;
    const off = row % 2 === 0 ? 0 : cell / 2;
    for (let x = r.x - cell + off; x < r.x + r.w + cell; x += cell) {
      g.beginPath();
      g.arc(x, y, cell / 2, Math.PI, 0);
      g.closePath();
      g.fillStyle = bg;
      g.fill();
      g.strokeStyle = fg;
      g.lineWidth = lw;
      for (const k of [0.5, 0.34, 0.18]) {
        g.beginPath();
        g.arc(x, y, cell * k, Math.PI, 0);
        g.stroke();
      }
    }
  }
  g.restore();
}

/** 木紋矩形：底色＋沿長邊的木紋線 */
function woodRect(g: CanvasRenderingContext2D, r: PxRect, base: number, vertical: boolean, seed: number): void {
  g.fillStyle = css(base);
  g.fillRect(r.x, r.y, r.w, r.h);
  const rnd = seeded(seed);
  g.lineWidth = 1;
  const n = Math.round((vertical ? r.w : r.h) / 3);
  for (let i = 0; i < n; i++) {
    g.strokeStyle = rnd() < 0.5 ? css(base, 0.82) : css(base, 1.12);
    g.globalAlpha = 0.35 + rnd() * 0.4;
    g.beginPath();
    const o = rnd() * (vertical ? r.w : r.h);
    const wob = 1 + rnd() * 2;
    if (vertical) {
      g.moveTo(r.x + o, r.y);
      g.bezierCurveTo(r.x + o + wob, r.y + r.h * 0.3, r.x + o - wob, r.y + r.h * 0.7, r.x + o, r.y + r.h);
    } else {
      g.moveTo(r.x, r.y + o);
      g.bezierCurveTo(r.x + r.w * 0.3, r.y + o + wob, r.x + r.w * 0.7, r.y + o - wob, r.x + r.w, r.y + o);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** 直式招牌與幟旗：[文字, 底色, 字色, 框色, 種類] */
const VSIGN_DEFS: [string, number, number, number, 'board' | 'flag'][] = [
  ['拉麵', 0xd02b2b, 0xfff6e0, 0x5a1a12, 'board'],
  ['茶屋', 0xf3e3c0, 0x2a1a10, 0x6b4a2a, 'board'],
  ['團子', 0x283a70, 0xffffff, 0x14203f, 'board'],
  ['甘味處', 0x1f1b19, 0xeec466, 0x7a5a2a, 'board'],
  ['忍具', 0x4b3020, 0xfff2d0, 0x2a1a10, 'board'],
  ['旅館', 0xf6f1e4, 0x1c1a1c, 0x4b3020, 'board'],
  ['花屋', 0x3f913a, 0xffffff, 0x1e4a1c, 'board'],
  ['書店', 0xd2a468, 0x2b1a10, 0x5b3a20, 'board'],
  ['燒鳥', 0x8f2a1a, 0xfff0d0, 0x3a120c, 'board'],
  ['壽司', 0xfcf7eb, 0xb82020, 0xb82020, 'board'],
  ['藥', 0x1f8b8b, 0xffffff, 0x0f4a4a, 'board'],
  ['酒', 0x1d2a4a, 0xffffff, 0x0c1426, 'board'],
  ['團子', 0xf6f0e0, 0xc8302a, 0xc8302a, 'flag'],
  ['拉麵', 0xd8382c, 0xffffff, 0xf3c94b, 'flag'],
  ['甘味', 0x2f4f9a, 0xffffff, 0xf3f0e7, 'flag'],
  ['祭', 0xf3c230, 0xc8202a, 0xc8202a, 'flag'],
];

/** 橫式招牌：[文字, 底色, 字色, 框色] */
const HSIGN_DEFS: [string, number, number, number][] = [
  ['一番拉麵', 0xd02b2b, 0xffffff, 0x5a1a12],
  ['火之國茶屋', 0xd2a468, 0x2a1a10, 0x5b3a20],
  ['忍具專門', 0x1f1b19, 0xeec466, 0x7a5a2a],
  ['葉隱旅館', 0x283a70, 0xffffff, 0x14203f],
  ['甘味處', 0xf6e8c9, 0x8f2a1a, 0x8f2a1a],
  ['烏龍麵', 0x4b3020, 0xfff2d0, 0x2a1a10],
  ['忍急 木ノ葉行', 0xfcf7eb, 0x1c1a1c, 0xd02b2b],
  ['居酒屋', 0x921f1c, 0xffffff, 0x3a0c0a],
];

/** 畫直式招牌／幟旗 */
function drawVSign(g: CanvasRenderingContext2D, r: PxRect, def: (typeof VSIGN_DEFS)[number], seed: number): void {
  const [chars, bg, fg, frame, kind] = def;
  if (kind === 'board') {
    g.fillStyle = css(frame);
    g.fillRect(r.x, r.y, r.w, r.h);
    woodRect(g, { x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 10 }, bg, true, seed);
    // 上下的木頭端蓋
    g.fillStyle = css(frame, 0.8);
    g.fillRect(r.x, r.y, r.w, 8);
    g.fillRect(r.x, r.y + r.h - 8, r.w, 8);
    const n = chars.length;
    const size = Math.min(r.w - 16, ((r.h - 34) / n) * 0.95);
    for (let i = 0; i < n; i++) {
      text(g, chars[i], r.x + r.w / 2, r.y + 17 + ((r.h - 34) * (i + 0.5)) / n, size, FONT_BRUSH, css(fg), css(bg, 0.55), 3);
    }
  } else {
    // 幟旗：布、上方色帶、左側穿桿的布環
    g.fillStyle = css(bg);
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = css(frame);
    g.fillRect(r.x, r.y, r.w, 22);
    g.fillRect(r.x, r.y + r.h - 12, r.w, 12);
    g.fillStyle = css(0xf3f0e7);
    for (let y = r.y + 30; y < r.y + r.h - 16; y += 30) g.fillRect(r.x, y, 7, 10);
    const n = chars.length;
    const size = Math.min(r.w - 18, ((r.h - 50) / n) * 0.92);
    for (let i = 0; i < n; i++) {
      text(g, chars[i], r.x + r.w / 2 + 3, r.y + 28 + ((r.h - 50) * (i + 0.5)) / n, size, FONT_BRUSH, css(fg));
    }
    grain(g, r, 0.06, seed, 0.03);
  }
}

/** 畫橫式招牌 */
function drawHSign(g: CanvasRenderingContext2D, r: PxRect, def: (typeof HSIGN_DEFS)[number], seed: number): void {
  const [s, bg, fg, frame] = def;
  g.fillStyle = css(frame);
  g.fillRect(r.x, r.y, r.w, r.h);
  woodRect(g, { x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 10 }, bg, false, seed);
  const size = Math.min(40, (r.w - 24) / s.length);
  text(g, s, r.x + r.w / 2, r.y + r.h / 2 + 2, size, FONT_BRUSH, css(fg), css(bg, 0.5), 3);
  // 四角的釘子
  g.fillStyle = css(0xcaa44b);
  for (const [dx, dy] of [[9, 9], [r.w - 9, 9], [9, r.h - 9], [r.w - 9, r.h - 9]]) {
    g.beginPath();
    g.arc(r.x + dx, r.y + dy, 2.5, 0, Math.PI * 2);
    g.fill();
  }
}

/** 畫暖簾（多片布、上方穿桿的布套、下緣） */
function drawNoren(g: CanvasRenderingContext2D, r: PxRect, kind: number): void {
  const colors = [0x1f3566, 0xc8302a, 0x2f5d3a, 0x3a2418];
  const bg = colors[kind];
  const panels = kind === 0 ? 4 : kind === 1 ? 4 : 3;
  const top = 24;
  g.fillStyle = css(0x1b1612);
  g.fillRect(r.x, r.y, r.w, r.h);
  // 布面（每片之間留縫）
  const pw = r.w / panels;
  for (let i = 0; i < panels; i++) {
    const px = r.x + i * pw + 2;
    const grd = g.createLinearGradient(px, 0, px + pw - 4, 0);
    grd.addColorStop(0, css(bg, 0.82));
    grd.addColorStop(0.5, css(bg, 1.08));
    grd.addColorStop(1, css(bg, 0.86));
    g.fillStyle = grd;
    g.fillRect(px, r.y + top - 4, pw - 4, r.h - top + 4);
  }
  // 上方布套
  g.fillStyle = css(bg, 0.7);
  g.fillRect(r.x, r.y, r.w, top);
  g.fillStyle = css(bg, 0.55);
  for (let i = 0; i <= panels; i++) g.fillRect(r.x + i * pw - 2, r.y, 4, top);
  const white = '#f6f2e8';
  g.save();
  g.beginPath();
  for (let i = 0; i < panels; i++) g.rect(r.x + i * pw + 2, r.y + top, pw - 4, r.h - top);
  g.clip();
  if (kind === 0) {
    // 深藍底白浪：下緣青海波、中間捲浪、上方小星星
    seigaiha(g, { x: r.x, y: r.y + r.h - 54, w: r.w, h: 60 }, 22, css(bg), white, 2.2);
    for (let i = 0; i < panels; i++) {
      curlWave(g, r.x + i * pw + pw * 0.42, r.y + r.h - 80, pw * 0.36, white, 4);
      star(g, r.x + i * pw + pw * (i % 2 === 0 ? 0.72 : 0.3), r.y + top + 22, 7, null, white, 2);
      star(g, r.x + i * pw + pw * (i % 2 === 0 ? 0.25 : 0.7), r.y + top + 44, 4.5, white, null);
    }
  } else if (kind === 1) {
    // 紅底「拉麵」＋兩側漩渦紋
    spiral(g, r.x + pw * 0.5, r.y + top + 60, 22, 2.6, 6, white);
    spiral(g, r.x + pw * 3.5, r.y + top + 60, 22, 2.6, 6, white);
    text(g, '拉', r.x + pw * 1.5, r.y + top + 62, 52, FONT_BRUSH, white);
    text(g, '麵', r.x + pw * 2.5, r.y + top + 62, 52, FONT_BRUSH, white);
    g.fillStyle = white;
    g.fillRect(r.x, r.y + r.h - 26, r.w, 8);
    seigaiha(g, { x: r.x, y: r.y + r.h - 18, w: r.w, h: 20 }, 16, css(bg), white, 1.6);
  } else if (kind === 2) {
    // 綠底白圈「茶」
    g.strokeStyle = white;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(r.x + r.w / 2, r.y + top + 70, 46, 0, Math.PI * 2);
    g.stroke();
    text(g, '茶', r.x + r.w / 2, r.y + top + 72, 58, FONT_BRUSH, white);
    g.fillStyle = white;
    g.fillRect(r.x, r.y + r.h - 22, r.w, 6);
  } else {
    // 深褐底「酒」＋橫紋
    g.fillStyle = white;
    g.beginPath();
    g.arc(r.x + r.w / 2, r.y + top + 66, 40, 0, Math.PI * 2);
    g.fill();
    text(g, '酒', r.x + r.w / 2, r.y + top + 68, 56, FONT_BRUSH, css(bg));
    for (let k = 0; k < 3; k++) g.fillRect(r.x, r.y + r.h - 40 + k * 12, r.w, 4);
  }
  g.restore();
  grain(g, { x: r.x, y: r.y + top, w: r.w, h: r.h - top }, 0.07, 300 + kind, 0.04);
}

/** 窗框（外框＋十字或格子） */
function frameRect(g: CanvasRenderingContext2D, r: PxRect, color: string, w: number): void {
  g.fillStyle = color;
  g.fillRect(r.x, r.y, r.w, w);
  g.fillRect(r.x, r.y + r.h - w, r.w, w);
  g.fillRect(r.x, r.y, w, r.h);
  g.fillRect(r.x + r.w - w, r.y, w, r.h);
}

/** 畫窗戶小圖（emit = true 時畫自發光版本） */
function drawWindow(g: CanvasRenderingContext2D, r: PxRect, kind: number, emit: boolean): void {
  const wood = css(0x4b3020);
  const inner: PxRect = { x: r.x + 8, y: r.y + 8, w: r.w - 16, h: r.h - 16 };
  if (emit) {
    g.fillStyle = '#000';
    g.fillRect(r.x, r.y, r.w, r.h);
    if (kind === WINDOW.shoji) {
      g.fillStyle = '#2a2014';
      g.fillRect(inner.x, inner.y, inner.w, inner.h);
    } else if (kind === WINDOW.lit) {
      g.fillStyle = '#b07838';
      g.fillRect(inner.x, inner.y, inner.w, inner.h);
    } else if (kind === WINDOW.display) {
      g.fillStyle = '#6a4a28';
      g.fillRect(inner.x, inner.y, inner.w, inner.h);
    }
    return;
  }
  switch (kind) {
    case WINDOW.shoji: {
      g.fillStyle = css(0xf6eedb);
      g.fillRect(r.x, r.y, r.w, r.h);
      grain(g, inner, 0.05, 41);
      g.fillStyle = css(0x6b4a2e);
      for (let i = 1; i < 4; i++) g.fillRect(inner.x + (inner.w * i) / 4 - 1.5, inner.y, 3, inner.h);
      for (let i = 1; i < 5; i++) g.fillRect(inner.x, inner.y + (inner.h * i) / 5 - 1.5, inner.w, 3);
      frameRect(g, r, wood, 8);
      break;
    }
    case WINDOW.koshi: {
      g.fillStyle = css(0x1e1712);
      g.fillRect(r.x, r.y, r.w, r.h);
      for (let x = inner.x; x < inner.x + inner.w; x += 10) {
        g.fillStyle = css(0x9a6a3e);
        g.fillRect(x, inner.y, 6, inner.h);
        g.fillStyle = css(0xc08a52);
        g.fillRect(x, inner.y, 2, inner.h);
      }
      g.fillStyle = css(0x7d5233);
      g.fillRect(inner.x, inner.y + inner.h * 0.5 - 3, inner.w, 6);
      frameRect(g, r, wood, 8);
      break;
    }
    case WINDOW.curtain:
    case WINDOW.lit:
    case WINDOW.display: {
      const grd = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      if (kind === WINDOW.lit) {
        grd.addColorStop(0, '#ffe2a0');
        grd.addColorStop(1, '#c47a3a');
      } else if (kind === WINDOW.display) {
        grd.addColorStop(0, '#f6e6c6');
        grd.addColorStop(1, '#b9946a');
      } else {
        grd.addColorStop(0, '#8fc3e6');
        grd.addColorStop(1, '#2e4a66');
      }
      g.fillStyle = grd;
      g.fillRect(inner.x, inner.y, inner.w, inner.h);
      if (kind === WINDOW.curtain) {
        // 兩側窗簾
        for (const side of [0, 1]) {
          const cx = side === 0 ? inner.x : inner.x + inner.w - 30;
          g.fillStyle = css(0xd8473b);
          g.fillRect(cx, inner.y, 30, inner.h);
          g.fillStyle = css(0xa8302a);
          for (let k = 0; k < 3; k++) g.fillRect(cx + 5 + k * 9, inner.y, 3, inner.h);
        }
      } else if (kind === WINDOW.lit) {
        // 室內：燈與櫃子剪影
        g.fillStyle = 'rgba(90,50,20,0.55)';
        g.fillRect(inner.x + 10, inner.y + inner.h - 40, 40, 40);
        g.fillRect(inner.x + 62, inner.y + inner.h - 26, 36, 26);
        g.fillStyle = '#fff4d0';
        g.beginPath();
        g.arc(inner.x + inner.w * 0.65, inner.y + 22, 10, 0, Math.PI * 2);
        g.fill();
      } else {
        // 商品架：彩色小盒子
        const rnd = seeded(77);
        const cols = ['#d8473b', '#3b67b2', '#f3c94b', '#509b5b', '#f39cb9', '#ffffff', '#8b5ba9'];
        for (let row = 0; row < 3; row++) {
          const y = inner.y + 12 + row * 32;
          g.fillStyle = css(0x6b4a2e);
          g.fillRect(inner.x, y + 22, inner.w, 4);
          for (let x = inner.x + 3; x < inner.x + inner.w - 10; ) {
            const w = 8 + rnd() * 10;
            const h = 10 + rnd() * 12;
            g.fillStyle = cols[Math.floor(rnd() * cols.length)];
            g.fillRect(x, y + 22 - h, w, h);
            x += w + 2;
          }
        }
      }
      // 玻璃反光
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath();
      g.moveTo(inner.x + inner.w * 0.15, inner.y + inner.h);
      g.lineTo(inner.x + inner.w * 0.45, inner.y);
      g.lineTo(inner.x + inner.w * 0.58, inner.y);
      g.lineTo(inner.x + inner.w * 0.28, inner.y + inner.h);
      g.fill();
      frameRect(g, r, wood, 8);
      g.fillStyle = wood;
      g.fillRect(r.x + r.w / 2 - 3, r.y, 6, r.h);
      break;
    }
    case WINDOW.mushiko: {
      // 蟲籠窗：灰泥牆上的細長直縫
      g.fillStyle = css(0xf1e6cc);
      g.fillRect(r.x, r.y, r.w, r.h);
      grain(g, r, 0.06, 45);
      g.fillStyle = css(0x2a1e16);
      for (let x = inner.x + 4; x < inner.x + inner.w - 6; x += 14) {
        rrect(g, x, inner.y + 6, 7, inner.h - 12, 3.5);
        g.fill();
      }
      frameRect(g, r, css(0x6b4a2e), 6);
      break;
    }
    case WINDOW.train:
    case WINDOW.trainNoren: {
      // 車窗：暗色玻璃、座椅椅背、反光
      const grd = g.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      grd.addColorStop(0, '#3e5a74');
      grd.addColorStop(1, '#141c26');
      g.fillStyle = grd;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle = css(0x9a2a24);
      rrect(g, inner.x + 6, inner.y + inner.h - 34, 44, 40, 8);
      g.fill();
      rrect(g, inner.x + 60, inner.y + inner.h - 34, 44, 40, 8);
      g.fill();
      if (kind === WINDOW.trainNoren) {
        g.fillStyle = css(0x283a70);
        g.fillRect(inner.x, inner.y, inner.w, 34);
        g.fillStyle = css(0x1b1612);
        g.fillRect(inner.x + inner.w / 2 - 2, inner.y + 8, 4, 26);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(inner.x + inner.w * 0.25, inner.y + 18, 7, 0, Math.PI * 2);
        g.fill();
        spiral(g, inner.x + inner.w * 0.75, inner.y + 18, 8, 2, 2, '#ffffff');
      }
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.moveTo(inner.x + 10, inner.y + inner.h);
      g.lineTo(inner.x + 50, inner.y);
      g.lineTo(inner.x + 66, inner.y);
      g.lineTo(inner.x + 26, inner.y + inner.h);
      g.fill();
      frameRect(g, r, css(0xf3e3c3), 7);
      break;
    }
  }
}

/** 燈籠紙（貼在球面上：u 繞一圈、v 由下往上；+z 方向在 u = 0.25） */
function drawLantern(g: CanvasRenderingContext2D, r: PxRect, kind: number, emit: boolean): void {
  const papers = [0xe0302a, 0xd8382c, 0xf6efe0, 0xf2a43a];
  const inks = ['#1c1410', '#1c1410', '#c8202a', '#1c1410'];
  const chars = ['祭', '火', '忍', '茶'];
  const paper = papers[kind];
  const band = 14;
  if (emit) {
    const grd = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    grd.addColorStop(0, '#000');
    grd.addColorStop(0.15, css(paper, 0.35));
    grd.addColorStop(0.5, css(paper, 0.7));
    grd.addColorStop(0.85, css(paper, 0.35));
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#000';
    g.fillRect(r.x, r.y, r.w, band);
    g.fillRect(r.x, r.y + r.h - band, r.w, band);
    return;
  }
  // 紙面：中間亮、上下暗（像裡面點著燈）
  const grd = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  grd.addColorStop(0, css(paper, 0.7));
  grd.addColorStop(0.5, css(paper, 1.1));
  grd.addColorStop(1, css(paper, 0.7));
  g.fillStyle = grd;
  g.fillRect(r.x, r.y, r.w, r.h);
  // 竹骨橫紋
  g.fillStyle = 'rgba(60,20,10,0.28)';
  for (let y = r.y + band + 5; y < r.y + r.h - band; y += 7) g.fillRect(r.x, y, r.w, 1.5);
  // 上下黑色木蓋＋金線
  g.fillStyle = css(0x1c1a1c);
  g.fillRect(r.x, r.y, r.w, band);
  g.fillRect(r.x, r.y + r.h - band, r.w, band);
  g.fillStyle = css(0xdcaa3c);
  g.fillRect(r.x, r.y + band - 3, r.w, 2);
  g.fillRect(r.x, r.y + r.h - band + 1, r.w, 2);
  // 前後兩面的字
  for (const u of [0.25, 0.75]) {
    text(g, chars[kind], r.x + r.w * u, r.y + r.h / 2 + 2, 46, FONT_BRUSH, inks[kind]);
  }
  // 左右兩側的小家徽圈
  g.strokeStyle = inks[kind];
  g.lineWidth = 2.5;
  for (const u of [0, 0.5, 1]) {
    g.beginPath();
    g.arc(r.x + r.w * u, r.y + r.h / 2, 9, 0, Math.PI * 2);
    g.stroke();
  }
}

/** 家徽（圓形，貼在圓盤或方牌上） */
function drawCrest(g: CanvasRenderingContext2D, r: PxRect, kind: number): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R = r.w / 2 - 4;
  const bgs = ['#fbf6ea', '#fbf6ea', '#fbf6ea', '#dcaa3c'];
  g.fillStyle = kind === 3 ? '#7a5a2a' : '#c8302a';
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = bgs[kind];
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  if (kind === 0) {
    g.strokeStyle = '#c8302a';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(cx, cy, R - 8, 0, Math.PI * 2);
    g.stroke();
    text(g, '火', cx, cy + 4, 68, FONT_BOLD, '#c8302a');
  } else if (kind === 1) {
    g.strokeStyle = '#c8302a';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, cy, R - 8, 0, Math.PI * 2);
    g.stroke();
    spiral(g, cx, cy, R - 16, 2.6, 8, '#c8302a');
  } else if (kind === 2) {
    // 原創葉形：葉片＋中央漩渦＋葉柄
    g.fillStyle = '#4f9a3a';
    g.beginPath();
    g.moveTo(cx - 34, cy + 30);
    g.quadraticCurveTo(cx - 40, cy - 30, cx + 30, cy - 38);
    g.quadraticCurveTo(cx + 34, cy + 20, cx - 34, cy + 30);
    g.fill();
    spiral(g, cx - 2, cy - 4, 18, 2, 5, '#fbf6ea');
    g.strokeStyle = '#2b5c2e';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - 34, cy + 30);
    g.lineTo(cx - 46, cy + 42);
    g.stroke();
  } else {
    g.strokeStyle = '#7a5a2a';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy, R - 7, 0, Math.PI * 2);
    g.stroke();
    text(g, '忍', cx, cy + 4, 66, FONT_BRUSH, '#1c1a1c');
  }
}

/** 門與匾額小圖 */
function drawDoor(g: CanvasRenderingContext2D, r: PxRect, kind: number, emit: boolean): void {
  if (emit) {
    g.fillStyle = '#000';
    g.fillRect(r.x, r.y, r.w, r.h);
    if (kind === DOOR.slide) {
      g.fillStyle = '#2a2014';
      g.fillRect(r.x + 10, r.y + 8, r.w - 20, r.h * 0.6);
    }
    return;
  }
  switch (kind) {
    case DOOR.slide: {
      // 格子拉門：上半紙窗、下半木板
      woodRect(g, r, 0x7d5233, true, 51);
      g.fillStyle = css(0xf6eedb);
      g.fillRect(r.x + 10, r.y + 8, r.w - 20, r.h * 0.6);
      g.fillStyle = css(0x5a3a22);
      for (let i = 1; i < 4; i++) g.fillRect(r.x + 10 + ((r.w - 20) * i) / 4 - 1, r.y + 8, 2.5, r.h * 0.6);
      for (let i = 1; i < 3; i++) g.fillRect(r.x + 10, r.y + 8 + (r.h * 0.6 * i) / 3 - 1, r.w - 20, 2.5);
      g.fillRect(r.x + r.w / 2 - 2, r.y, 4, r.h);
      break;
    }
    case DOOR.amado: {
      // 雨戶：橫向木板
      for (let y = r.y; y < r.y + r.h; y += 12) {
        woodRect(g, { x: r.x, y, w: r.w, h: 12 }, 0x6a4a30, false, 60 + y);
        g.fillStyle = css(0x2a1a10);
        g.fillRect(r.x, y + 11, r.w, 1);
      }
      break;
    }
    case DOOR.train: {
      // 車門：深色亮光漆木板、上方小窗、把手
      woodRect(g, r, 0x5a3420, true, 63);
      g.fillStyle = css(0x2a1a10);
      g.fillRect(r.x, r.y, 4, r.h);
      g.fillRect(r.x + r.w - 4, r.y, 4, r.h);
      const grd = g.createLinearGradient(0, r.y + 10, 0, r.y + 46);
      grd.addColorStop(0, '#5a7a96');
      grd.addColorStop(1, '#1c2632');
      g.fillStyle = grd;
      rrect(g, r.x + 30, r.y + 10, r.w - 60, 36, 6);
      g.fill();
      g.strokeStyle = css(0xf3e3c3);
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = css(0xcaa44b);
      g.fillRect(r.x + r.w - 22, r.y + 54, 6, 22);
      break;
    }
    case DOOR.studded: {
      // 鐵釘木門
      woodRect(g, r, 0x6a3a22, true, 67);
      g.fillStyle = css(0x2a2626);
      g.fillRect(r.x, r.y + 14, r.w, 6);
      g.fillRect(r.x, r.y + r.h - 20, r.w, 6);
      for (let x = r.x + 10; x < r.x + r.w; x += 18) {
        for (const y of [r.y + 17, r.y + r.h - 17]) {
          g.beginPath();
          g.arc(x, y, 3, 0, Math.PI * 2);
          g.fillStyle = css(0x8b939c);
          g.fill();
        }
      }
      break;
    }
    case DOOR.plaqueFire:
    case DOOR.plaqueNin: {
      // 大門匾額：黑漆底、金框、金字
      g.fillStyle = css(0xcaa44b);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle = css(0x1f1b19);
      g.fillRect(r.x + 7, r.y + 7, r.w - 14, r.h - 14);
      g.strokeStyle = css(0xe8c060);
      g.lineWidth = 2;
      g.strokeRect(r.x + 12, r.y + 12, r.w - 24, r.h - 24);
      text(g, kind === DOOR.plaqueFire ? '火' : '忍', r.x + r.w / 2, r.y + r.h / 2 + 3, 66, FONT_BRUSH, '#f2cc66', '#5a3a10', 3);
      break;
    }
    case DOOR.shelf: {
      // 店內商品架
      g.fillStyle = css(0x3a2618);
      g.fillRect(r.x, r.y, r.w, r.h);
      const rnd = seeded(91);
      const cols = ['#d8473b', '#3b67b2', '#f3c94b', '#509b5b', '#f39cb9', '#fcf7eb', '#8b5ba9', '#f58b28'];
      for (let row = 0; row < 3; row++) {
        const y = r.y + 8 + row * 30;
        g.fillStyle = css(0x9a6a3e);
        g.fillRect(r.x, y + 22, r.w, 5);
        for (let x = r.x + 4; x < r.x + r.w - 8; ) {
          const w = 7 + rnd() * 12;
          const h = 8 + rnd() * 13;
          g.fillStyle = cols[Math.floor(rnd() * cols.length)];
          if (rnd() < 0.4) {
            g.beginPath();
            g.arc(x + w / 2, y + 22 - w / 2, w / 2, 0, Math.PI * 2);
            g.fill();
          } else g.fillRect(x, y + 22 - h, w, h);
          x += w + 2;
        }
      }
      break;
    }
    case DOOR.bellows: {
      // 車廂之間的蛇腹（橡膠折）
      g.fillStyle = css(0x27282b);
      g.fillRect(r.x, r.y, r.w, r.h);
      for (let x = r.x; x < r.x + r.w; x += 12) {
        g.fillStyle = css(0x3c3d42);
        g.fillRect(x, r.y, 5, r.h);
      }
      break;
    }
  }
}

/** 雜項小圖：樹葉、條紋、米袋、竹籬、木箱字樣、晾衣布 */
function drawMisc(g: CanvasRenderingContext2D, r: PxRect, kind: number): void {
  const rnd = seeded(500 + kind);
  /** 撒圓點 */
  const dots = (n: number, rmin: number, rmax: number, colors: string[]) => {
    for (let i = 0; i < n; i++) {
      const x = r.x + rnd() * r.w;
      const y = r.y + rnd() * r.h;
      const rr = rmin + rnd() * (rmax - rmin);
      g.fillStyle = colors[Math.floor(rnd() * colors.length)];
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }
  };
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  switch (kind) {
    case MISC.sakura:
      g.fillStyle = '#ec8fb0';
      g.fillRect(r.x, r.y, r.w, r.h);
      dots(140, 2.5, 6, ['#d9709a', '#f7b4cc', '#f9c7d7', '#fde6ef']);
      dots(60, 1.5, 3, ['#ffffff', '#fff3f8']);
      break;
    case MISC.leaves:
      g.fillStyle = '#4f9a3a';
      g.fillRect(r.x, r.y, r.w, r.h);
      dots(150, 3, 7, ['#3f8a30', '#62b048', '#78c25a', '#56a03e']);
      dots(40, 2, 3.5, ['#9ad470']);
      break;
    case MISC.pine:
      g.fillStyle = '#2c5e33';
      g.fillRect(r.x, r.y, r.w, r.h);
      g.lineWidth = 1.5;
      for (let i = 0; i < 260; i++) {
        const x = r.x + rnd() * r.w;
        const y = r.y + rnd() * r.h;
        g.strokeStyle = rnd() < 0.5 ? '#3f7a40' : '#1f4a28';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (rnd() - 0.5) * 8, y - 4 - rnd() * 4);
        g.stroke();
      }
      break;
    case MISC.stripes: {
      // 紅白直條紋（低欄）
      const n = 6;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 === 0 ? '#d8282a' : '#f7f3ea';
        g.fillRect(r.x + (r.w * i) / n, r.y, r.w / n + 1, r.h);
      }
      grain(g, r, 0.08, 520, 0.04);
      break;
    }
    case MISC.ricebag:
      g.fillStyle = css(0xd6bf8c);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(120,90,50,0.35)';
      g.lineWidth = 1;
      for (let x = r.x; x < r.x + r.w; x += 3) {
        g.beginPath();
        g.moveTo(x, r.y);
        g.lineTo(x, r.y + r.h);
        g.stroke();
      }
      for (let y = r.y; y < r.y + r.h; y += 3) {
        g.beginPath();
        g.moveTo(r.x, y);
        g.lineTo(r.x + r.w, y);
        g.stroke();
      }
      g.strokeStyle = '#c8302a';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(r.x + r.w / 2, r.y + r.h / 2, 22, 0, Math.PI * 2);
      g.stroke();
      text(g, '米', r.x + r.w / 2, r.y + r.h / 2 + 2, 30, FONT_BRUSH, '#c8302a');
      break;
    case MISC.bamboo:
      g.fillStyle = css(0x4a3a20);
      g.fillRect(r.x, r.y, r.w, r.h);
      for (let x = r.x; x < r.x + r.w; x += 11) {
        const grd = g.createLinearGradient(x, 0, x + 10, 0);
        grd.addColorStop(0, '#8a8a36');
        grd.addColorStop(0.4, '#d6d27a');
        grd.addColorStop(1, '#7a7a2e');
        g.fillStyle = grd;
        g.fillRect(x, r.y, 10, r.h);
        g.fillStyle = 'rgba(70,70,20,0.6)';
        const node = r.y + 10 + rnd() * 20;
        g.fillRect(x, node, 10, 2);
        g.fillRect(x, node + 30, 10, 2);
      }
      g.fillStyle = css(0x3a2a18);
      g.fillRect(r.x, r.y + r.h * 0.3, r.w, 4);
      g.fillRect(r.x, r.y + r.h * 0.72, r.w, 4);
      break;
    case MISC.crate:
      woodRect(g, r, 0xc79a5e, false, 560);
      g.fillStyle = 'rgba(40,25,10,0.8)';
      g.strokeStyle = 'rgba(40,25,10,0.8)';
      g.lineWidth = 3;
      g.strokeRect(r.x + 30, r.y + 10, r.w - 60, r.h - 20);
      text(g, '忍', r.x + r.w / 2, r.y + r.h / 2 + 1, 34, FONT_BRUSH, 'rgba(40,25,10,0.85)');
      break;
    case MISC.laundry:
      for (let y = r.y; y < r.y + r.h; y += 8) {
        g.fillStyle = (y - r.y) % 16 === 0 ? '#3b67b2' : '#f3f0e7';
        g.fillRect(r.x, y, r.w, 8);
      }
      break;
  }
  g.restore();
}

/** 圖集產生結果 */
interface PaletteAtlas {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/** 建立 canvas 與 2D context */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** 產生調色盤圖集（顏色貼圖＋自發光貼圖） */
export function createPaletteAtlas(): PaletteAtlas {
  const [c, g] = canvas(AW, AH);
  const [ec, eg] = canvas(AW * ES, AH * ES);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, AW, AH);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, AW * ES, AH * ES);
  eg.scale(ES, ES);

  // 色塊
  swNames.forEach((name, i) => {
    const x = (i % SW_PER_ROW) * SW_CELL;
    const y = Math.floor(i / SW_PER_ROW) * SW_CELL;
    g.fillStyle = css(SW[name]);
    g.fillRect(x, y, SW_CELL, SW_CELL);
    const em = SW_EMISSIVE[name];
    if (em) {
      eg.fillStyle = em;
      eg.fillRect(x, y, SW_CELL, SW_CELL);
    }
  });
  // 門與匾額
  for (let i = 0; i < REGIONS.door.n; i++) {
    drawDoor(g, slot('door', i), i, false);
    drawDoor(eg, slot('door', i), i, true);
  }
  // 直式招牌與幟旗
  VSIGN_DEFS.forEach((d, i) => drawVSign(g, slot('vsign', i), d, 100 + i));
  // 橫式招牌
  HSIGN_DEFS.forEach((d, i) => drawHSign(g, slot('hsign', i), d, 200 + i));
  // 暖簾
  for (let i = 0; i < REGIONS.noren.n; i++) drawNoren(g, slot('noren', i), i);
  // 窗
  for (let i = 0; i < REGIONS.window.n; i++) {
    drawWindow(g, slot('window', i), i, false);
    drawWindow(eg, slot('window', i), i, true);
  }
  // 燈籠
  for (let i = 0; i < REGIONS.lantern.n; i++) {
    drawLantern(g, slot('lantern', i), i, false);
    drawLantern(eg, slot('lantern', i), i, true);
  }
  // 家徽
  for (let i = 0; i < REGIONS.crest.n; i++) drawCrest(g, slot('crest', i), i);
  // 雜項
  for (let i = 0; i < REGIONS.misc.n; i++) drawMisc(g, slot('misc', i), i);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(ec);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}
