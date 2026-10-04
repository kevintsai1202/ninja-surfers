import * as THREE from 'three';
import { CHUNK_LEN, LANE_WIDTH, LANES } from '../../../config';
import type { ForestAssets } from './assets';
import { seeded } from '../../proctex';
import { Batch, HIDE_BACK, HIDE_BOTTOM, boxTpl, grid, noise1, noise2, range, smoothstep, trs, type Rng, type Tpl } from './geom';

/**
 * 林道與運木軌道：泥土林道、兩側隆起的森林地面（緩坡往外升高，延伸到 |x| = 78）、
 * 舊枕木（有苔蘚）、鋼軌墊板、鏽色鋼軌與接頭鐵板。
 *
 * 接縫：枕木間距 0.6（50 根剛好 30 m）、貼圖重複單位能整除 30 m、
 * seed 造成的地形起伏乘上 edgeWindow（段落兩端為 0），所以任何兩段都能無縫接起來。
 */

/** 林道泥土的半寬（兩側森林地面從 |x| ≈ 5 開始隆起，蓋住林道邊緣） */
const PATH_HALF = 6.4;
/** 地面延伸到 |x| = 這個值 */
const GROUND_HALF = 78;
/** 鋼軌距車道中心的距離（軌距 1.2 m） */
export const RAIL_OFFSET = 0.6;
/** 枕木間距 */
const SLEEPER_PITCH = 0.6;
/** 鋼軌頂面高度（墊板頂 0.05＋軌高 0.15） */
export const RAIL_TOP = 0.2;

/** 段落邊界的淡化權重：z = 0 與 z = −CHUNK_LEN 為 0、中間為 1 */
function edgeWindow(z: number): number {
  const s = Math.sin((Math.PI * -z) / CHUNK_LEN);
  return s * s;
}

/** 林道邊緣（森林地面開始隆起處）的 |x|，會沿 z 蜿蜒 */
export function edgeX(z: number, side: number, seed: number): number {
  return 5.0 + 0.45 * edgeWindow(z) * (noise1(-z * 0.32 + seed * 0.37, side > 0 ? 11 : 23) - 0.5) * 2;
}

/**
 * 森林地面高度：林道外側先隆起成路肩（約 0.45 m），往外緩緩升高成兩側的坡（|x| = 55 約 7 m），
 * 段落中間再加 seed 決定的小起伏。
 */
export function floorHeight(x: number, z: number, seed: number): number {
  const ax = Math.abs(x);
  const side = x < 0 ? -1 : 1;
  const s = ax - edgeX(z, side, seed);
  let h = s < 0 ? -0.1 : 0.45 * smoothstep(0, 1.3, s);
  h += 7 * Math.pow(smoothstep(9, 56, ax), 1.3) + 3.5 * smoothstep(56, 78, ax);
  h += edgeWindow(z) * smoothstep(7, 13, ax) * 1.8 * (noise2(x * 0.11, z * 0.11, seed & 0xffff) - 0.5);
  return h;
}

/** 林道與森林地面寫進的批次 */
interface GroundTarget {
  path: Batch;
  floor: Batch;
}

/** 森林地面欄位（|x|）：靠近林道密、越往外越疏 */
const FLOOR_COLS = [4.1, 4.6, 5.0, 5.35, 5.8, 6.4, 7.2, 8.3, 9.8, 11.8, 14.5, 18, 22.5, 28, 35, 44, 55, 66, GROUND_HALF];

/** 建立林道（平坦泥土）與兩側森林地面 */
export function addGround(t: GroundTarget, seed: number): void {
  // 林道：|x| ≤ PATH_HALF 的平面（每 3 m 一列，地平線下彎才會平順）
  const pxs = [-PATH_HALF, -3.75, -1.25, 1.25, 3.75, PATH_HALF];
  const rows = CHUNK_LEN / 3;
  grid(t.path, pxs.length - 1, rows, (i, j, out) => {
    const z = -CHUNK_LEN + j * 3;
    out[0] = pxs[i];
    out[1] = 0;
    out[2] = z;
    out[3] = pxs[i] / 3;
    out[4] = z / 3;
  });
  // 兩側森林地面：靠近林道的欄位跟著蜿蜒的邊緣移動（欄位 x 一律由小到大，法線才朝上）
  const zr = CHUNK_LEN / 1.5;
  for (const side of [-1, 1]) {
    const cols = side < 0 ? FLOOR_COLS.map((v) => -v).reverse() : FLOOR_COLS;
    grid(t.floor, cols.length - 1, zr, (i, j, out) => {
      const z = -CHUNK_LEN + j * 1.5;
      const bx = Math.abs(cols[i]);
      const warp = (edgeX(z, side, seed) - 5.0) * (1 - smoothstep(6.4, 9.8, bx));
      const x = side * (bx + warp);
      out[0] = x;
      out[1] = floorHeight(x, z, seed);
      out[2] = z;
      out[3] = x / 5;
      out[4] = z / 5;
    });
  }
}

/** 軌道寫進的批次 */
interface TrackTarget {
  sleeper: Batch;
  metal: Batch;
}

/** 鋼軌截面（x 偏移, y），從左下繞過軌頭到右下；索引 4→5 是被磨亮的軌頭頂面 */
const RAIL_PROFILE: [number, number][] = [
  [-0.068, 0.05],
  [-0.02, 0.074],
  [-0.017, 0.152],
  [-0.035, 0.164],
  [-0.035, RAIL_TOP],
  [0.035, RAIL_TOP],
  [0.035, 0.164],
  [0.017, 0.152],
  [0.02, 0.074],
  [0.068, 0.05],
];

/** 一條鋼軌（沿 z 每 3 m 一段，配合地平線下彎；弦高誤差約 2.5 mm） */
function addRail(b: Batch, x: number): void {
  const segs = CHUNK_LEN / 3;
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < RAIL_PROFILE.length - 1; i++) {
    const [x0, y0] = RAIL_PROFILE[i];
    const [x1, y1] = RAIL_PROFILE[i + 1];
    // 軌頭頂面用鋼面那一條，其他用鏽面
    const u0 = i === 4 ? 0.02 : 0.15 + i * 0.075;
    const u1 = i === 4 ? 0.11 : u0 + 0.06;
    for (let s = 0; s < segs; s++) {
      const z0 = -s * 3;
      const z1 = -(s + 1) * 3;
      a.set(x + x0, y0, z0);
      bb.set(x + x1, y1, z0);
      c.set(x + x1, y1, z1);
      d.set(x + x0, y0, z1);
      b.quad(a, bb, c, d, [u0, z0 / 2], [u1, z0 / 2], [u1, z1 / 2], [u0, z1 / 2]);
    }
  }
}

/** 預先組好的軌道（枕木批次、鐵件批次） */
interface TrackVariant {
  sleeper: Tpl;
  metal: Tpl;
}

/** 軌道變化快取（幾種隨機排列，段落直接整段複製，省下每段重算 450 個小方塊） */
let trackVariants: TrackVariant[] | null = null;

/** 取得預先組好的軌道變化（第一次呼叫時建立） */
export function getTrackVariants(A: ForestAssets): TrackVariant[] {
  if (!trackVariants) {
    trackVariants = [];
    for (let v = 0; v < 4; v++) {
      const t = { sleeper: new Batch(16384), metal: new Batch(16384) };
      addTrack(t, A, seeded(7001 + v * 13));
      trackVariants.push({ sleeper: t.sleeper.snapshot(), metal: t.metal.snapshot() });
    }
  }
  return trackVariants;
}

/**
 * 三條軌道：每條 50 根枕木（位置、角度、下陷略有不同，貼圖偏移讓苔蘚每根不一樣）、
 * 每根枕木兩塊墊板、兩條鋼軌、段落頭與中間的接頭鐵板。
 */
function addTrack(t: TrackTarget, A: ForestAssets, rnd: Rng): void {
  const n = Math.round(CHUNK_LEN / SLEEPER_PITCH);
  for (const lane of LANES) {
    const cx = lane * LANE_WIDTH;
    for (let k = 0; k < n; k++) {
      const z = -(k + 0.5) * SLEEPER_PITCH + range(rnd, -0.035, 0.035);
      const x = cx + range(rnd, -0.05, 0.05);
      const sink = rnd() < 0.15 ? range(rnd, 0.01, 0.03) : 0;
      const yaw = range(rnd, -0.035, 0.035);
      const flip = rnd() < 0.5 ? -1 : 1;
      t.sleeper.add(A.tpl.sleeper, trs(x, -0.06 - sink, z, 0, yaw, range(rnd, -0.01, 0.01)), undefined, flip, 1, 0.5, rnd());
      for (const s of [-1, 1]) {
        const px = cx + s * RAIL_OFFSET;
        t.metal.add(A.tpl.plate, trs(px, 0.035, z, 0, yaw * 0.5, 0), undefined, 0.11, 0.11, 0.9375, 0.0625 + 0.125 * Math.floor(rnd() * 8));
      }
    }
    for (const s of [-1, 1]) {
      const rx = cx + s * RAIL_OFFSET;
      addRail(t.metal, rx);
      // 接頭鐵板（軌腰兩側）
      for (const jz of [0, -CHUNK_LEN / 2]) {
        for (const side of [-1, 1]) {
          t.metal.add(boxTpl(0.018, 0.06, 0.55, 0, 1, HIDE_BOTTOM | HIDE_BACK), trs(rx + side * 0.027, 0.112, jz), undefined, 0.5, 0.5, 0.4, 0.3);
        }
      }
    }
  }
}
