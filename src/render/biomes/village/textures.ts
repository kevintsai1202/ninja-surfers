import * as THREE from 'three';
import { seeded, tileFbm, tileNoise } from '../../proctex';
import { curlWave, FONT_BOLD, FONT_BRUSH, rrect, spiral, star } from './atlas';
import type { TileUV, UVSpec } from './builder';

/**
 * 木葉村專用的程式貼圖（canvas 產生、全部原創）：
 * 牆面圖集（多色灰泥／木板／石牆色帶）、木材圖集、屋瓦圖集、石板路、卵石道碴、枕木、鋼軌、
 * 列車車身木板（依配色）、塗鴉貼花。全部在 createKit() 時一次建好，建場景時不再產生貼圖。
 * 顏色貼圖用 SRGBColorSpace；凹凸貼圖維持 NoColorSpace。
 */

/** 一組顏色＋凹凸貼圖 */
interface TexPair {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

/** 建立 canvas */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** canvas → 可重複貼圖 */
function wrap(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 由 RGB 陣列與高度陣列產生貼圖組 */
function pair(w: number, h: number, rgb: Float32Array, height: Float32Array): TexPair {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const [bc, bg] = canvas(w, h);
  const bimg = bg.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = rgb[i * 3];
    img.data[i * 4 + 1] = rgb[i * 3 + 1];
    img.data[i * 4 + 2] = rgb[i * 3 + 2];
    img.data[i * 4 + 3] = 255;
    const v = Math.max(0, Math.min(255, height[i] * 255));
    bimg.data[i * 4] = v;
    bimg.data[i * 4 + 1] = v;
    bimg.data[i * 4 + 2] = v;
    bimg.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  bg.putImageData(bimg, 0, 0);
  return { map: wrap(c, true), bump: wrap(bc, false) };
}

/** 寫入一個像素的顏色（底色 × 明暗） */
function put(rgb: Float32Array, i: number, base: number, s: number): void {
  rgb[i * 3] = ((base >> 16) & 255) * s;
  rgb[i * 3 + 1] = ((base >> 8) & 255) * s;
  rgb[i * 3 + 2] = (base & 255) * s;
}

/** 兩色混合後寫入（t = 0 全 a、1 全 b） */
function putMix(rgb: Float32Array, i: number, a: number, b: number, t: number, s: number): void {
  /** 單一色版的線性內插 */
  const m = (x: number, y: number) => x + (y - x) * t;
  rgb[i * 3] = m((a >> 16) & 255, (b >> 16) & 255) * s;
  rgb[i * 3 + 1] = m((a >> 8) & 255, (b >> 8) & 255) * s;
  rgb[i * 3 + 2] = m(a & 255, b & 255) * s;
}

/** 色帶的 v 範圍（canvas 由上往下第 i 條，共 n 條；inset 是內縮比例，避免 mipmap 滲到隔壁色帶） */
export function band(i: number, n: number, inset = 0.07): { v0: number; v1: number } {
  const h = 1 / n;
  const top = 1 - i * h;
  return { v0: top - h + h * inset, v1: top - h * inset };
}

/** 平鋪 UV 規格（u 每 su 公尺重複一次，v 落在第 i 條色帶） */
export function tileBand(su: number, i: number, n: number, inset = 0.07): TileUV {
  const b = band(i, n, inset);
  return { k: 'tile', su, v0: b.v0, v1: b.v1 };
}

// ───────────────────────────── 牆面圖集 ─────────────────────────────

/** 牆面色帶編號 */
export const WALL = { cream: 0, white: 1, orange: 2, salmon: 3, sage: 4, blueGray: 5, boards: 6, stone: 7 } as const;
/** 牆面色帶數 */
export const WALL_BANDS = 8;
/** 牆面貼圖 u 方向代表的公尺數 */
export const WALL_SU = 4;
/** 灰泥色帶的底色 */
const WALL_COLORS = [0xf3e3c0, 0xf6f1e6, 0xf0a65e, 0xeba592, 0xbdd3a3, 0xbccfe4, 0x5e3f2a, 0x9c9586];

/** 牆面圖集（512×1024，8 條色帶，每條代表一層樓高） */
export function wallAtlas(): TexPair {
  const W = 512;
  const BH = 128;
  const H = BH * WALL_BANDS;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const big = tileFbm(W, BH, 4, 3, 11);
  const fine = tileNoise(W, BH, 96, 12);
  const rnd = seeded(13);
  for (let b = 0; b < WALL_BANDS; b++) {
    const base = WALL_COLORS[b];
    if (b === WALL.boards) {
      // 直向木板牆：每片木板明暗不同、木紋、板縫
      const bw = 32;
      const tones = Array.from({ length: W / bw }, () => 0.82 + rnd() * 0.3);
      const gr = tileFbm(W, BH, 2, 4, 15);
      for (let y = 0; y < BH; y++) {
        for (let x = 0; x < W; x++) {
          const i = (b * BH + y) * W + x;
          const j = y * W + x;
          const k = Math.floor(x / bw);
          const lx = x - k * bw;
          const stripe = 0.5 + 0.5 * Math.sin(lx * 0.7 + gr[j] * 16);
          let s = tones[k] * (0.86 + 0.16 * stripe) * (0.95 + 0.1 * fine[j]);
          let h = 0.6 + 0.12 * stripe;
          if (lx < 2 || lx >= bw - 1) {
            s *= 0.45;
            h = 0.1;
          }
          const yy = y / BH;
          if (yy > 0.88) s *= 1 - (yy - 0.88) * 1.6;
          put(rgb, i, base, s);
          hgt[i] = h;
        }
      }
      continue;
    }
    if (b === WALL.stone) {
      // 石牆：兩列錯縫石塊、倒角明暗、灰縫
      const rows = 2;
      const rh = BH / rows;
      const bounds: number[][] = [];
      const tones: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const xs: number[] = [];
        let x = rnd() * 60;
        const start = x;
        while (x < start + W) {
          xs.push(x);
          x += 64 + rnd() * 60;
        }
        // 最後一塊的寬度調到剛好繞回起點
        bounds.push(xs.map((v) => v % W).sort((p, q) => p - q));
        tones.push(xs.map(() => 0.78 + rnd() * 0.34));
      }
      const st = tileFbm(W, BH, 12, 3, 17);
      for (let y = 0; y < BH; y++) {
        const r = Math.min(rows - 1, Math.floor(y / rh));
        const ly = y - r * rh;
        const xs = bounds[r];
        for (let x = 0; x < W; x++) {
          const i = (b * BH + y) * W + x;
          const j = y * W + x;
          // 找出 x 屬於哪一塊石頭（邊界繞回）
          let k = xs.length - 1;
          for (let q = 0; q < xs.length; q++) if (xs[q] <= x) k = q;
          const left = xs[k];
          const right = k + 1 < xs.length ? xs[k + 1] : xs[0] + W;
          const lx = x >= left ? x - left : x + W - left;
          const sw = right - left;
          const edge = Math.min(lx, sw - lx, ly, rh - ly);
          const mortar = edge < 3;
          const bev = Math.min(1, edge / 9);
          // 左上亮、右下暗的倒角
          const light = lx < 9 || ly < 9 ? 1.1 : sw - lx < 9 || rh - ly < 9 ? 0.82 : 1;
          const s = mortar ? 0.5 : tones[r][k % tones[r].length] * (0.82 + 0.18 * bev) * light * (0.88 + 0.24 * st[j]);
          put(rgb, i, base, s);
          hgt[i] = mortar ? 0.05 : 0.45 + 0.45 * bev * (0.7 + 0.3 * st[j]);
        }
      }
      continue;
    }
    // 灰泥：大塊斑駁＋細顆粒，底部一點髒污、頂部一點陰影
    for (let y = 0; y < BH; y++) {
      const yy = y / BH;
      let rowK = 1;
      if (yy > 0.86) rowK = 1 - ((yy - 0.86) / 0.14) * 0.2;
      if (yy < 0.05) rowK = 0.9;
      for (let x = 0; x < W; x++) {
        const i = (b * BH + y) * W + x;
        const j = y * W + x;
        const s = (0.92 + 0.12 * big[j] + 0.07 * (fine[j] - 0.5)) * rowK;
        put(rgb, i, base, s);
        hgt[i] = 0.5 + 0.35 * (fine[j] - 0.5) + 0.2 * (big[j] - 0.5);
      }
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 木材圖集 ─────────────────────────────

/** 木材色帶：深色木（樑柱）、中色木、淺色木（木箱）、朱漆（鳥居、大門） */
export const WOOD = { dark: 0, mid: 1, light: 2, vermilion: 3 } as const;
export const WOOD_BANDS = 4;
/** 木材貼圖 u 方向代表的公尺數 */
export const WOOD_SU = 2;
const WOOD_COLORS = [0x5a3a24, 0x8a5a32, 0xc4945c, 0xdc4a2c];

/** 木材圖集（512×512，4 條色帶，木紋沿 u 方向） */
export function woodAtlas(): TexPair {
  const W = 512;
  const BH = 128;
  const H = BH * WOOD_BANDS;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  for (let b = 0; b < WOOD_BANDS; b++) {
    const base = WOOD_COLORS[b];
    const gr = tileFbm(W, BH, 3, 4, 30 + b);
    const fine = tileNoise(W, BH, 128, 40 + b);
    const rnd = seeded(50 + b);
    const knots = Array.from({ length: 3 }, () => ({ x: rnd() * W, y: 20 + rnd() * (BH - 40), r: 5 + rnd() * 6 }));
    const painted = b === WOOD.vermilion;
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < W; x++) {
        const i = (b * BH + y) * W + x;
        const j = y * W + x;
        const stripe = 0.5 + 0.5 * Math.sin(y * 0.55 + gr[j] * 18);
        let s = (painted ? 0.93 + 0.07 * stripe : 0.8 + 0.24 * stripe) * (0.95 + 0.1 * fine[j]);
        let h = 0.45 + 0.3 * stripe;
        for (const k of knots) {
          const dx = x - k.x;
          const dy = (y - k.y) * 1.6;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < k.r) {
            s *= painted ? 0.95 : 0.72 + 0.28 * (d / k.r);
            h -= 0.2 * (1 - d / k.r);
          }
        }
        // 色帶上下緣（零件的邊）略暗，強調厚度
        const yy = y / BH;
        if (yy < 0.1 || yy > 0.9) s *= 0.9;
        put(rgb, i, base, s);
        hgt[i] = h;
      }
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 屋瓦圖集 ─────────────────────────────

/** 屋瓦色帶：藍、紅、灰、銅綠 */
export const ROOF = { blue: 0, red: 1, gray: 2, green: 3 } as const;
export const ROOF_BANDS = 4;
/** 屋瓦貼圖 u 方向代表的公尺數；每條色帶代表 1 m 的坡長 */
export const ROOF_SU = 2;
export const ROOF_SEG = 1;
const ROOF_COLORS = [0x2f62c4, 0xd8462a, 0x5b636e, 0x2f8f6c];

/** 屋瓦圖集（512×512，4 條色帶；每條 4 列瓦、8 欄圓筒瓦） */
export function roofAtlas(): TexPair {
  const W = 512;
  const BH = 128;
  const H = BH * ROOF_BANDS;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const noise = tileNoise(W, BH, 64, 61);
  const big = tileFbm(W, BH, 3, 3, 62);
  const rnd = seeded(63);
  const colW = 64;
  const rowH = 32;
  for (let b = 0; b < ROOF_BANDS; b++) {
    const base = ROOF_COLORS[b];
    const tones = Array.from({ length: (W / colW) * (BH / rowH) }, () => 0.9 + rnd() * 0.16);
    for (let y = 0; y < BH; y++) {
      const row = Math.floor(y / rowH);
      const ry = (y - row * rowH) / rowH;
      for (let x = 0; x < W; x++) {
        const i = (b * BH + y) * W + x;
        const j = y * W + x;
        const col = Math.floor(x / colW);
        const cx = (x - col * colW) / colW;
        // 圓筒瓦：中間隆起，光從左上來
        const hump = Math.pow(Math.sin(Math.PI * cx), 0.6);
        const slope = Math.cos(Math.PI * cx);
        let s = (0.66 + 0.36 * hump + 0.12 * slope) * tones[row * (W / colW) + col];
        let h = 0.25 + 0.7 * hump;
        if (ry < 0.12) {
          // 上一片瓦的影子
          s *= 0.55 + ry * 2.5;
          h *= 0.6;
        } else if (ry > 0.84) {
          // 瓦片下緣的厚唇：亮邊
          s *= ry > 0.95 ? 0.7 : 1.16;
          h += 0.1;
        }
        s *= 0.92 + 0.1 * noise[j] + 0.08 * (big[j] - 0.5);
        put(rgb, i, base, s);
        hgt[i] = h;
      }
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 石板路 ─────────────────────────────

/** 石板路貼圖代表的公尺數（u、v 各 3.75 m；30 / 3.75 = 8，前後段無接縫） */
export const PAVE_SU = 3.75;

/** 石板路（512×512）：錯縫長方石板、灰縫、偶有青苔 */
export function paving(): TexPair {
  const W = 512;
  const H = 512;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const rnd = seeded(71);
  const fine = tileNoise(W, H, 160, 72);
  const big = tileFbm(W, H, 4, 3, 73);
  const rowH = 64;
  const rows = H / rowH;
  const rowsBounds: number[][] = [];
  const rowsTones: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const xs: number[] = [];
    let x = rnd() * 100;
    const start = x;
    while (x < start + W - 40) {
      xs.push(x % W);
      x += 80 + rnd() * 110;
    }
    xs.sort((p, q) => p - q);
    rowsBounds.push(xs);
    rowsTones.push(xs.map(() => 0.84 + rnd() * 0.24));
  }
  const base = 0xc3b8a2;
  const moss = 0x6d8a3c;
  for (let y = 0; y < H; y++) {
    const r = Math.floor(y / rowH);
    const ly = y - r * rowH;
    const xs = rowsBounds[r];
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let k = xs.length - 1;
      for (let q = 0; q < xs.length; q++) if (xs[q] <= x) k = q;
      const left = xs[k];
      const right = k + 1 < xs.length ? xs[k + 1] : xs[0] + W;
      const lx = x >= left ? x - left : x + W - left;
      const sw = right - left;
      const edge = Math.min(lx, sw - lx, ly, rowH - ly);
      if (edge < 3) {
        // 灰縫（偶爾長青苔）
        const m = big[i] > 0.6 ? 0.8 : 0;
        putMix(rgb, i, 0x6a6052, moss, m, 0.8 + 0.3 * fine[i]);
        hgt[i] = 0.05;
        continue;
      }
      const bev = Math.min(1, edge / 7);
      const light = lx < 7 || ly < 7 ? 1.08 : sw - lx < 7 || rowH - ly < 7 ? 0.86 : 1;
      const s = rowsTones[r][k] * (0.86 + 0.14 * bev) * light * (0.9 + 0.12 * big[i] + 0.08 * (fine[i] - 0.5));
      put(rgb, i, base, s);
      hgt[i] = 0.45 + 0.4 * bev + 0.1 * fine[i];
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 卵石道碴 ─────────────────────────────

/** 道碴貼圖代表的公尺數（要能整除一段場景長 30 m，前後段才不會有接縫） */
export const PEBBLE_SU = 2.5;

/** 卵石道碴（512×512）：一顆顆圓潤的卵石、左上亮右下暗、石縫深褐色 */
export function pebbles(): TexPair {
  const W = 512;
  const H = 512;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H).fill(0);
  const rnd = seeded(81);
  const gap = 0x3e342a;
  for (let i = 0; i < W * H; i++) put(rgb, i, gap, 0.8 + rnd() * 0.3);
  const tones = [0xa8a196, 0xbba98d, 0x8f8375, 0xcbc2b3, 0x9a8a78, 0xb3a493];
  const count = 1250;
  for (let s = 0; s < count; s++) {
    const cx = rnd() * W;
    const cy = rnd() * H;
    const r = 8 + rnd() * 9;
    const rx = r * (0.85 + rnd() * 0.35);
    const ry = r * (0.7 + rnd() * 0.3);
    const rot = rnd() * Math.PI;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const tone = tones[Math.floor(rnd() * tones.length)];
    const k = 0.85 + rnd() * 0.25;
    const R = Math.ceil(Math.max(rx, ry));
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        // 旋轉到卵石自己的座標
        const ux = (dx * cs + dy * sn) / rx;
        const uy = (-dx * sn + dy * cs) / ry;
        const d = ux * ux + uy * uy;
        if (d > 1) continue;
        const h = Math.sqrt(1 - d);
        const x = (Math.floor(cx + dx) + W) % W;
        const y = (Math.floor(cy + dy) + H) % H;
        const i = y * W + x;
        const hh = 0.15 + h * 0.85;
        if (hh <= hgt[i]) continue;
        hgt[i] = hh;
        // 法線近似：(dx, dy) 方向傾斜；光從左上
        const lit = 0.62 + 0.38 * h + 0.22 * (-(dx / R) - (dy / R)) * (1 - h);
        const spec = h > 0.86 && dx < 0 && dy < 0 ? 1.12 : 1;
        put(rgb, i, tone, k * lit * spec);
      }
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 枕木 ─────────────────────────────

/** 枕木貼圖色帶數（每條是一種木色，讓每根枕木看起來不同） */
export const SLEEPER_BANDS = 4;

/** 枕木（512×256）：紅褐色厚木、沿長邊的木紋、裂紋 */
export function sleeperTex(): TexPair {
  const W = 512;
  const BH = 64;
  const H = BH * SLEEPER_BANDS;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const colors = [0x8a5232, 0x7a4a30, 0x93603c, 0x7f5236];
  const rnd = seeded(91);
  for (let b = 0; b < SLEEPER_BANDS; b++) {
    const gr = tileFbm(W, BH, 3, 4, 92 + b);
    const fine = tileNoise(W, BH, 128, 96 + b);
    const cracks = Array.from({ length: 3 }, () => ({ y: 8 + rnd() * (BH - 16), x0: rnd() * W, len: 60 + rnd() * 160 }));
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < W; x++) {
        const i = (b * BH + y) * W + x;
        const j = y * W + x;
        const stripe = 0.5 + 0.5 * Math.sin(y * 0.9 + gr[j] * 14);
        let s = (0.8 + 0.22 * stripe) * (0.93 + 0.12 * fine[j]);
        let h = 0.5 + 0.25 * stripe;
        for (const c of cracks) {
          const dx = (x - c.x0 + W) % W;
          if (dx < c.len && Math.abs(y - c.y - Math.sin(dx * 0.05) * 2) < 1.2) {
            s *= 0.5;
            h = 0.1;
          }
        }
        const yy = y / BH;
        if (yy < 0.12 || yy > 0.88) s *= 0.88;
        put(rgb, i, colors[b], s);
        hgt[i] = h;
      }
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 鋼軌 ─────────────────────────────

/** 鋼軌貼圖的四個區域 UV：亮面軌頭、軌腰、扣件墊板（含螺栓）、深色鋼 */
export const RAIL_UV = {
  top: { k: 'rect', u0: 0.02, v0: 0.52, u1: 0.48, v1: 0.98 } as UVSpec,
  side: { k: 'rect', u0: 0.52, v0: 0.52, u1: 0.98, v1: 0.98 } as UVSpec,
  plate: { k: 'rect', u0: 0.02, v0: 0.02, u1: 0.48, v1: 0.48 } as UVSpec,
  dark: { k: 'pt', u: 0.75, v: 0.25 } as UVSpec,
};

/** 鋼軌貼圖（128×128） */
export function railTex(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  // 軌頭（左上）：磨亮的鋼
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#9aa3ab');
  grd.addColorStop(0.5, '#eef2f5');
  grd.addColorStop(1, '#a8b0b8');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // 軌腰（右上）：深灰帶鏽
  g.fillStyle = '#5d5853';
  g.fillRect(64, 0, 64, 64);
  const rnd = seeded(101);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(130,70,40,0.35)' : 'rgba(40,36,34,0.35)';
    g.fillRect(64 + rnd() * 64, rnd() * 64, 2 + rnd() * 4, 1 + rnd() * 2);
  }
  // 扣件墊板（左下）：深色鋼板、中間直向的軌座、左右兩顆螺栓（鋼軌沿 v 方向壓在中間）
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 64, 64, 64);
  g.fillStyle = '#666a70';
  g.fillRect(3, 67, 58, 58);
  g.fillStyle = '#3a3c40';
  g.fillRect(24, 64, 16, 64);
  for (const x of [10, 54]) {
    for (const y of [80, 112]) {
      g.fillStyle = '#2c2e31';
      g.beginPath();
      g.arc(x, y, 6.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#a3aab1';
      g.beginPath();
      g.arc(x - 1, y - 1, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 深色鋼（右下）
  g.fillStyle = '#3e4146';
  g.fillRect(64, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ───────────────────────────── 列車車身 ─────────────────────────────

/** 列車配色：朱紅、深綠、藍、土黃 */
export const TRAIN_COLORS = [0xd8432a, 0x3c8a3e, 0x2f66c0, 0xd59a2c];
/** 車身貼圖 u 方向代表的公尺數 */
export const BODY_SU = 4.8;

/** 列車車身木板貼圖（512×256）：橫向木板、每片明暗不同、木紋、掉漆露出木頭、釘子 */
export function trainBodyTex(variant: number): TexPair {
  const W = 512;
  const H = 256;
  const base = TRAIN_COLORS[variant];
  const bare = 0xc89a64;
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const rnd = seeded(200 + variant);
  const gr = tileFbm(W, H, 3, 4, 210 + variant);
  const fine = tileNoise(W, H, 128, 220 + variant);
  const chip = tileFbm(W, H, 10, 3, 230 + variant);
  const ph = 23;
  const planks = Math.ceil(H / ph);
  const tones = Array.from({ length: planks }, () => 0.86 + rnd() * 0.22);
  // 每片木板的接縫位置（板材不是一整條）
  const joints = Array.from({ length: planks }, () => [rnd() * W, rnd() * W]);
  for (let y = 0; y < H; y++) {
    const p = Math.floor(y / ph);
    const ly = y - p * ph;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const stripe = 0.5 + 0.5 * Math.sin(y * 0.8 + gr[i] * 16);
      let s = tones[p] * (0.88 + 0.12 * stripe) * (0.95 + 0.08 * fine[i]);
      let h = 0.6 + 0.1 * stripe;
      // 掉漆：雜訊高的地方露出木頭，靠板緣更容易掉
      const edgeK = ly < 4 || ly > ph - 4 ? 0.12 : 0;
      const wear = chip[i] + edgeK > 0.72 ? 1 : 0;
      let gap = false;
      if (ly < 2) gap = true;
      for (const jx of joints[p]) if (Math.abs(x - jx) < 1.2) gap = true;
      if (gap) {
        s = 0.35;
        h = 0.05;
      }
      // 釘子：每 64 像素一排
      if (!gap && x % 64 > 29 && x % 64 < 34 && ly > 9 && ly < 14) {
        put(rgb, i, 0x3a3a3a, 1);
        hgt[i] = 0.9;
        continue;
      }
      if (wear && !gap) putMix(rgb, i, base, bare, 0.85, s);
      else put(rgb, i, base, s * (ly > ph - 5 ? 0.86 : ly < 5 ? 1.1 : 1));
      hgt[i] = h;
    }
  }
  return pair(W, H, rgb, hgt);
}

// ───────────────────────────── 塗鴉貼花 ─────────────────────────────

/** 貼花編號：漩渦、葉子、忍字、手裡劍、青蛙、拉麵碗、車號、忍急標誌、大浪、星星、櫻花、苦無 */
export const DECAL = {
  swirl: 0,
  leaf: 1,
  nin: 2,
  shuriken: 3,
  frog: 4,
  ramen: 5,
  numbers: 6,
  logo: 7,
  wave: 8,
  stars: 9,
  sakura: 10,
  kunai: 11,
} as const;
/** 可以當塗鴉隨機挑的貼花（不含車號） */
export const GRAFFITI = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
/** 貼花圖集的列數（每列 4 格 256×256） */
const DECAL_ROWS = 3;

/** 貼花圖集的 UV（12 格 256×256；車號格再分 4 小格） */
export function decalUV(i: number, sub = -1): UVSpec {
  const col = i % 4;
  const row = Math.floor(i / 4);
  let u0 = col / 4;
  let v1 = 1 - row / DECAL_ROWS;
  let du = 1 / 4;
  let dv = 1 / DECAL_ROWS;
  if (sub >= 0) {
    du /= 2;
    dv /= 2;
    u0 += (sub % 2) * du;
    v1 -= Math.floor(sub / 2) * dv;
  }
  const e = 0.004;
  return { k: 'rect', u0: u0 + e, u1: u0 + du - e, v0: v1 - dv + e, v1: v1 - e };
}

/** 塗鴉貼花圖集（1024×768，透明底） */
export function decalAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256 * DECAL_ROWS);
  g.clearRect(0, 0, 1024, 256 * DECAL_ROWS);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  /** 第 i 格（256×256）的左上角像素座標 */
  const cell = (i: number) => [(i % 4) * 256, Math.floor(i / 4) * 256] as const;

  // 0：橘色胖漩渦＋黑框＋白色亮點
  {
    const [x, y] = cell(0);
    spiral(g, x + 128, y + 128, 92, 2.3, 40, '#141414');
    spiral(g, x + 128, y + 128, 92, 2.3, 28, '#ff8a1f');
    spiral(g, x + 124, y + 124, 92, 2.3, 7, '#ffd25a');
    star(g, x + 210, y + 50, 16, '#ffffff', '#141414', 4);
    star(g, x + 48, y + 210, 11, '#ffffff', '#141414', 3);
  }
  // 1：綠葉＋漩渦＋滴流
  {
    const [x, y] = cell(1);
    /** 葉子外形路徑（先描黑邊、再填綠） */
    const leaf = () => {
      g.beginPath();
      g.moveTo(x + 50, y + 200);
      g.quadraticCurveTo(x + 30, y + 60, x + 200, y + 40);
      g.quadraticCurveTo(x + 220, y + 190, x + 50, y + 200);
      g.closePath();
    };
    leaf();
    g.lineWidth = 16;
    g.strokeStyle = '#141414';
    g.stroke();
    leaf();
    g.fillStyle = '#5fc04a';
    g.fill();
    spiral(g, x + 130, y + 125, 46, 2.2, 10, '#1f5a22');
    g.strokeStyle = '#5fc04a';
    g.lineWidth = 9;
    for (const dx of [70, 110, 160]) {
      g.beginPath();
      g.moveTo(x + dx, y + 196);
      g.lineTo(x + dx, y + 220 + (dx % 3) * 8);
      g.stroke();
    }
  }
  // 2：「忍」泡泡字
  {
    const [x, y] = cell(2);
    g.font = `900 190px ${FONT_BOLD}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillText('忍', x + 136, y + 140);
    g.strokeStyle = '#141414';
    g.lineWidth = 26;
    g.strokeText('忍', x + 128, y + 132);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 12;
    g.strokeText('忍', x + 128, y + 132);
    g.fillStyle = '#e8392f';
    g.fillText('忍', x + 128, y + 132);
    star(g, x + 220, y + 40, 14, '#ffe14a', '#141414', 3);
  }
  // 3：手裡劍＋藍色噴漆＋速度線
  {
    const [x, y] = cell(3);
    g.fillStyle = '#3aa0ff';
    g.beginPath();
    g.ellipse(x + 128, y + 128, 108, 84, -0.3, 0, Math.PI * 2);
    g.fill();
    /** 四角手裡劍外形路徑 */
    const shur = () => {
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + 0.3;
        const rr = k % 2 === 0 ? 92 : 26;
        g.lineTo(x + 128 + Math.cos(a) * rr, y + 128 + Math.sin(a) * rr);
      }
      g.closePath();
    };
    shur();
    g.lineWidth = 14;
    g.strokeStyle = '#141414';
    g.stroke();
    shur();
    const grd = g.createLinearGradient(x + 40, y + 40, x + 210, y + 210);
    grd.addColorStop(0, '#f2f5f8');
    grd.addColorStop(1, '#8a939c');
    g.fillStyle = grd;
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(x + 128, y + 128, 13, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(x + 128, y + 128, 104 + k * 12, 2.4 + k * 0.1, 3.3 + k * 0.1);
      g.stroke();
    }
  }
  // 4：可愛的青蛙臉
  {
    const [x, y] = cell(4);
    /** 青蛙臉外形路徑 */
    const face = () => {
      g.beginPath();
      g.ellipse(x + 128, y + 150, 100, 78, 0, 0, Math.PI * 2);
    };
    face();
    g.lineWidth = 14;
    g.strokeStyle = '#141414';
    g.stroke();
    face();
    g.fillStyle = '#69c24a';
    g.fill();
    for (const dx of [-52, 52]) {
      g.beginPath();
      g.arc(x + 128 + dx, y + 82, 36, 0, Math.PI * 2);
      g.lineWidth = 12;
      g.stroke();
      g.fillStyle = '#69c24a';
      g.fill();
      g.beginPath();
      g.arc(x + 128 + dx, y + 82, 24, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
      g.beginPath();
      g.arc(x + 132 + dx, y + 86, 12, 0, Math.PI * 2);
      g.fillStyle = '#141414';
      g.fill();
      g.beginPath();
      g.arc(x + 127 + dx, y + 80, 4, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
      g.beginPath();
      g.ellipse(x + 128 + dx * 1.25, y + 160, 18, 10, 0, 0, Math.PI * 2);
      g.fillStyle = '#ff8fa8';
      g.fill();
    }
    g.beginPath();
    g.arc(x + 128, y + 150, 46, 0.2, Math.PI - 0.2);
    g.lineWidth = 9;
    g.strokeStyle = '#141414';
    g.stroke();
  }
  // 5：拉麵碗＋筷子＋熱氣
  {
    const [x, y] = cell(5);
    g.strokeStyle = '#141414';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(x + 150, y + 30);
    g.lineTo(x + 100, y + 150);
    g.moveTo(x + 185, y + 36);
    g.lineTo(x + 125, y + 152);
    g.stroke();
    g.strokeStyle = '#c8823a';
    g.lineWidth = 6;
    g.stroke();
    /** 拉麵碗外形路徑 */
    const bowl = () => {
      g.beginPath();
      g.moveTo(x + 30, y + 130);
      g.lineTo(x + 226, y + 130);
      g.quadraticCurveTo(x + 220, y + 230, x + 128, y + 232);
      g.quadraticCurveTo(x + 36, y + 230, x + 30, y + 130);
      g.closePath();
    };
    bowl();
    g.lineWidth = 12;
    g.strokeStyle = '#141414';
    g.stroke();
    bowl();
    g.fillStyle = '#d8392c';
    g.fill();
    g.fillStyle = '#fff3d6';
    g.fillRect(x + 36, y + 124, 184, 14);
    g.fillStyle = '#f6d36a';
    g.beginPath();
    g.ellipse(x + 128, y + 126, 92, 14, 0, Math.PI, 0);
    g.fill();
    g.beginPath();
    g.arc(x + 96, y + 116, 16, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    spiral(g, x + 96, y + 116, 11, 2, 3, '#ff6fa0');
    spiral(g, x + 128, y + 182, 22, 2, 6, '#ffffff');
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    for (const dx of [70, 128, 186]) {
      g.beginPath();
      g.moveTo(x + dx, y + 100);
      g.bezierCurveTo(x + dx - 14, y + 80, x + dx + 14, y + 60, x + dx, y + 40);
      g.stroke();
    }
  }
  // 6：車號牌（四小格）
  {
    const [x, y] = cell(6);
    const nums = ['01', '07', '12', '24'];
    nums.forEach((n, k) => {
      const sx = x + (k % 2) * 128;
      const sy = y + Math.floor(k / 2) * 128;
      rrect(g, sx + 10, sy + 24, 108, 80, 14);
      g.fillStyle = '#f7f3e6';
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = '#1d2a4a';
      g.stroke();
      g.font = `900 58px ${FONT_BOLD}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#1d2a4a';
      g.fillText(n, sx + 64, sy + 66);
    });
  }
  // 7：「忍急」標誌＋苦無
  {
    const [x, y] = cell(7);
    g.save();
    g.translate(x + 128, y + 128);
    g.rotate(-0.12);
    g.fillStyle = '#d8392c';
    g.beginPath();
    g.moveTo(-118, 40);
    g.quadraticCurveTo(0, 70, 118, 30);
    g.lineTo(110, 52);
    g.quadraticCurveTo(0, 92, -112, 60);
    g.closePath();
    g.fill();
    g.font = `900 96px ${FONT_BRUSH}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 16;
    g.strokeStyle = '#141414';
    g.strokeText('忍急', 0, -6);
    g.fillStyle = '#ffd23a';
    g.fillText('忍急', 0, -6);
    g.restore();
    // 苦無
    g.fillStyle = '#141414';
    g.beginPath();
    g.moveTo(x + 40, y + 40);
    g.lineTo(x + 92, y + 58);
    g.lineTo(x + 58, y + 92);
    g.closePath();
    g.fill();
    g.strokeStyle = '#141414';
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(x + 75, y + 75);
    g.lineTo(x + 100, y + 100);
    g.stroke();
    g.beginPath();
    g.arc(x + 106, y + 106, 8, 0, Math.PI * 2);
    g.stroke();
  }
  // 8：藍白大浪（藍色車廂上的浪花塗鴉）
  {
    const [x, y] = cell(8);
    g.fillStyle = '#1f6fc8';
    g.beginPath();
    g.moveTo(x + 10, y + 246);
    g.bezierCurveTo(x + 20, y + 120, x + 120, y + 60, x + 200, y + 90);
    g.bezierCurveTo(x + 250, y + 110, x + 250, y + 180, x + 246, y + 246);
    g.closePath();
    g.fill();
    curlWave(g, x + 128, y + 150, 80, '#ffffff', 11);
    curlWave(g, x + 70, y + 210, 40, '#9fd8ff', 7);
    star(g, x + 210, y + 40, 15, null, '#ffffff', 5);
    star(g, x + 40, y + 60, 10, null, '#9fd8ff', 4);
  }
  // 9：星星群（白、黃）
  {
    const [x, y] = cell(9);
    const pts: [number, number, number, string][] = [
      [70, 80, 34, '#ffe14a'],
      [170, 60, 22, '#ffffff'],
      [150, 160, 40, '#ffffff'],
      [60, 190, 18, '#ffe14a'],
      [210, 200, 14, '#ffe14a'],
    ];
    for (const [sx, sy, r, col] of pts) star(g, x + sx, y + sy, r, col, '#141414', 6);
  }
  // 10：櫻花塗鴉（粉紅五瓣花）
  {
    const [x, y] = cell(10);
    /** 畫一朵五瓣櫻花（中心 cx、cy，半徑 r） */
    const flower = (cx: number, cy: number, r: number) => {
      for (let k = 0; k < 5; k++) {
        const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.5, r * 0.36, a, 0, Math.PI * 2);
        g.lineWidth = 8;
        g.strokeStyle = '#141414';
        g.stroke();
        g.fillStyle = '#ff9ec4';
        g.fill();
      }
      g.beginPath();
      g.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      g.fillStyle = '#ffe14a';
      g.fill();
    };
    flower(x + 100, y + 110, 80);
    flower(x + 200, y + 200, 42);
  }
  // 11：交叉苦無
  {
    const [x, y] = cell(11);
    for (const s of [1, -1]) {
      g.save();
      g.translate(x + 128, y + 128);
      g.rotate((s * Math.PI) / 4);
      g.fillStyle = '#141414';
      g.beginPath();
      g.moveTo(0, -110);
      g.lineTo(26, -30);
      g.lineTo(-26, -30);
      g.closePath();
      g.fill();
      g.fillStyle = '#c9d0d6';
      g.beginPath();
      g.moveTo(0, -98);
      g.lineTo(17, -36);
      g.lineTo(-17, -36);
      g.closePath();
      g.fill();
      g.fillStyle = '#d8392c';
      g.fillRect(-8, -30, 16, 90);
      g.strokeStyle = '#141414';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(0, 76, 16, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
