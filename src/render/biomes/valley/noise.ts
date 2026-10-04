import { CHUNK_LEN } from '../../../config';

/**
 * 終末之谷的 CPU 端雜訊工具（建模用：岩壁起伏、岩塊表面、擺放位置）。
 * 全部是純函式，同輸入同輸出（同 seed 的場景段落結果相同）。
 */

/**
 * 整數格點雜湊 → 0..1。
 * @param x 格點 x（整數）
 * @param y 格點 y（整數）
 * @param z 格點 z 或種子（整數）
 */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** smoothstep 權重（格點處導數為 0，接縫兩側斜率一致） */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 夾在 lo..hi */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** GLSL 風格 smoothstep */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 3D value noise，值域 0..1 */
function vnoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);
  // 每個 z 平面用不同的雜湊種子做一次 2D 內插，再沿 z 內插
  const plane = (zi: number) => {
    const s = Math.imul(zi, 0x5bd1e995) ^ seed;
    const a = hash3(x0, y0, s);
    const b = hash3(x0 + 1, y0, s);
    const c = hash3(x0, y0 + 1, s);
    const d = hash3(x0 + 1, y0 + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const v0 = plane(z0);
  const v1 = plane(z0 + 1);
  return v0 + (v1 - v0) * fz;
}

/** 3D fbm（多層 value noise），值域約 0..1 */
export function fbm3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise3(x * freq, y * freq, z * freq, seed + o * 17) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / total;
}

/**
 * 段落接縫用的「釘住」雜訊（2D：z 沿跑道、y 任意軸）。
 * 沿 z（0 → −CHUNK_LEN）每 spacingZ 公尺一個格點；頭尾兩排格點（z = 0 與 z = −CHUNK_LEN）
 * 一律用固定種子 fixed 且用同一組索引，所以任意兩段（不同 seed）相接時，接縫兩側的值與斜率都相同。
 * 中間的格點用本段的 seed，每段長得不一樣。
 * @param spacingZ z 方向格距（CHUNK_LEN 必須是它的整數倍）
 * @param spacingY y 方向格距
 * @param seed 本段種子
 * @param fixed 接縫格點用的固定種子
 * @returns 0..1
 */
export function pinned2(z: number, y: number, spacingZ: number, spacingY: number, seed: number, fixed: number): number {
  const n = Math.max(1, Math.round(CHUNK_LEN / spacingZ));
  const t = clamp(-z / spacingZ, 0, n);
  const k0 = Math.min(n - 1, Math.floor(t));
  const fz = fade(t - k0);
  const gy = y / spacingY;
  const y0 = Math.floor(gy);
  const fy = fade(gy - y0);
  // 接縫格點：索引一律當成 0、種子用 fixed → z = 0 與 z = −CHUNK_LEN 兩排完全相同
  const edge0 = k0 === 0;
  const edge1 = k0 + 1 === n;
  const i0 = edge0 ? 0 : k0;
  const i1 = edge1 ? 0 : k0 + 1;
  const s0 = edge0 ? fixed : seed;
  const s1 = edge1 ? fixed : seed;
  const a = hash3(i0, y0, s0);
  const b = hash3(i1, y0, s1);
  const c = hash3(i0, y0 + 1, s0);
  const d = hash3(i1, y0 + 1, s1);
  return a + (b - a) * fz + (c - a) * fy + (a - b - c + d) * fz * fy;
}

/** 1D 版的釘住雜訊（只沿 z），值域 0..1 */
export function pinned1(z: number, spacing: number, seed: number, fixed: number): number {
  return pinned2(z, 0.5, spacing, 1, seed, fixed);
}
