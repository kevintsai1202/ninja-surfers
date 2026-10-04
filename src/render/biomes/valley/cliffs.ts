import * as THREE from 'three';
import { CHUNK_LEN } from '../../../config';
import { seeded } from '../../proctex';
import { pinned1, pinned2 } from './noise';

/**
 * 峽谷岩壁：一層層堆疊、邊緣圓潤的層狀岩（像一疊厚岩板），每層前緣沿 z 起伏、有垂直的岩塊接縫，
 * 每隔幾層往後退出一道岩架（長植物、垂藤、細瀑布從這裡流下來）。
 *
 * 每一側是一張格網曲面（z 方向 × 高度方向），x = side × 離中心的距離。
 * 無縫：岩層高度表兩側固定、所有段落共用；沿 z 的變化全部用「釘住」雜訊（段落頭尾格點固定），
 * 岩塊接縫也一定落在 z = 0 與 z = −CHUNK_LEN，所以任意兩段相接時岩壁完全吻合。
 */

/** 接縫格點用的固定種子 */
const FIX = 424242;

/** 岩壁腳（水線）離中心的距離 */
const WALL_BASE_X = 16.8;
/** 岩壁每升高 1 m 往後退多少（整體往外傾，從遊戲鏡頭看得到更多岩面） */
const LEAN = 0.24;
/** 格網沿 z 的間距 */
const DZ = CHUNK_LEN / 30;
/** 每一層岩層裡的取樣比例（0 = 層底接縫） */
const LAYER_ROWS = [0, 0.22, 0.5, 0.78];
/** 頂部收邊用的列數 */
const CAP_ROWS = 4;

/** 一層岩層的固定設定 */
interface Layer {
  /** 層底高度 */
  y0: number;
  /** 厚度 */
  t: number;
  /** 累計後退量（岩架） */
  back: number;
  /** 前緣圓凸量 */
  bulge: number;
  /** 色調（寫進 uv.x） */
  tint: number;
  /** 這一層的頂面是不是一道岩架（上一層明顯後退） */
  ledge: boolean;
}

/** 建立一側的岩層表（固定，不隨段落種子變） */
function makeLayers(side: number): Layer[] {
  const rnd = seeded(side < 0 ? 5101 : 7307);
  const out: Layer[] = [];
  let y = -2.5;
  let back = 0;
  let k = 0;
  while (y < 50) {
    const t = k === 0 ? 3.0 : 2.0 + rnd() * 2.6;
    if (k > 0) back += k % 3 === 0 ? 1.3 + rnd() * 1.7 : -0.25 + rnd() * 0.6;
    out.push({ y0: y, t, back, bulge: 0.42 + rnd() * 0.5, tint: 0.15 + rnd() * 0.7, ledge: false });
    y += t;
    k++;
  }
  for (let i = 0; i < out.length - 1; i++) out[i].ledge = out[i + 1].back - out[i].back > 0.9;
  return out;
}

/** 兩側的岩層表 */
const LAYERS: Record<string, Layer[]> = { '-1': makeLayers(-1), '1': makeLayers(1) };

/** 單側岩壁的建模結果（給擺放道具用的查詢函式） */
export interface Wall {
  side: number;
  geometry: THREE.BufferGeometry;
  layers: Layer[];
  /** 岩面在 (z, y) 處離中心的距離（正值） */
  surface(z: number, y: number): number;
  /** 岩壁頂高度 */
  top(z: number): number;
  /** 第 k 層在 z 處的前緣距離 */
  front(k: number, z: number): number;
}

/**
 * 建立一側岩壁（local z ∈ [−CHUNK_LEN, 0]）。
 * @param side −1 左、+1 右
 * @param seed 段落種子
 */
export function buildWall(side: number, seed: number): Wall {
  const layers = LAYERS[String(side)];
  const salt = side < 0 ? 11 : 29;
  const rnd = seeded(seed * 7919 + salt);
  const nL = layers.length;

  // 每層的岩塊接縫位置：頭尾一定有（接縫對齊），中間 1～3 道隨機
  const joints: number[][] = layers.map(() => {
    const list = [0, -CHUNK_LEN];
    const count = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) list.push(-(4 + rnd() * (CHUNK_LEN - 8)));
    return list;
  });

  /** 第 k 層在 z 處的接縫凹陷量 0..1 */
  const groove = (k: number, z: number): number => {
    let g = 0;
    for (const zj of joints[k]) {
      const d = (z - zj) / 0.55;
      g = Math.max(g, Math.exp(-d * d));
    }
    return g;
  };

  /** 第 k 層前緣（不含接縫凹陷）離中心的距離 */
  const frontBase = (k: number, z: number): number => {
    const L = layers[k];
    const jitter = (pinned1(z, 7.5, seed * 131 + k * 17 + salt, FIX + k * 17 + salt) - 0.5) * 2.2;
    return WALL_BASE_X + LEAN * (L.y0 + L.t / 2) + L.back + jitter;
  };

  /** 第 k 層前緣（最凸處，含岩塊接縫的凹陷）離中心的距離 */
  const front = (k: number, z: number): number => frontBase(k, z) + groove(k, z) * 0.65;

  /** 第 k 層與第 k+1 層之間接縫的凹入位置 */
  const joint = (k: number, z: number): number => {
    if (k < 0) return front(0, z) + 0.3;
    if (k >= nL - 1) return front(nL - 1, z) + 0.3;
    return Math.max(front(k, z), front(k + 1, z)) + 0.45 * (layers[k].bulge + layers[k + 1].bulge);
  };

  /** 找出 y 所在的岩層 */
  const layerAt = (y: number): number => {
    let k = 0;
    while (k < nL - 1 && y >= layers[k + 1].y0) k++;
    return k;
  };

  /** 岩面在 (z, y) 處離中心的距離（擺放道具用的通用版本；建格網時改用每欄預先算好的值） */
  const surface = (z: number, y: number): number => {
    const k = layerAt(y);
    const L = layers[k];
    const f = Math.min(1, Math.max(0, (y - L.y0) / L.t));
    const F = front(k, z);
    const b = Math.sqrt(Math.max(0, 1 - (2 * f - 1) * (2 * f - 1)));
    const J = f < 0.5 ? joint(k - 1, z) : joint(k, z);
    const bump = (pinned2(z, y, 2.5, 1.9, seed * 37 + salt, FIX + 3 + salt) - 0.5) * 0.6;
    return F + (J - F) * (1 - b) + bump;
  };

  /** 岩壁頂高度（26～42 m，沿 z 起伏，段落頭尾固定） */
  const top = (z: number): number => 26 + 16 * pinned1(z, 10, seed * 71 + salt, FIX + 999 + salt);

  // 列：每層 4 列（到 46 m 為止）＋頂部收邊
  const rowY: number[] = [];
  const rowF: number[] = [];
  const rowK: number[] = [];
  const rowB: number[] = [];
  for (let k = 0; k < nL; k++) {
    const L = layers[k];
    if (L.y0 > 46) break;
    for (const f of LAYER_ROWS) {
      rowY.push(L.y0 + f * L.t);
      rowF.push(f);
      rowK.push(k);
      rowB.push(Math.sqrt(Math.max(0, 1 - (2 * f - 1) * (2 * f - 1))));
    }
  }
  const R = rowY.length + CAP_ROWS;
  const C = Math.round(CHUNK_LEN / DZ) + 1;
  const pos = new Float32Array(R * C * 3);
  const uv = new Float32Array(R * C * 2);
  /** 每一欄先算好的各層前緣、接縫凹陷、層間接縫位置（避免逐頂點重算雜訊） */
  const F = new Float32Array(nL);
  const G = new Float32Array(nL);
  const J = new Float32Array(nL);
  for (let j = 0; j < C; j++) {
    const z = -j * DZ;
    const H = top(z);
    for (let k = 0; k < nL; k++) {
      G[k] = groove(k, z);
      F[k] = frontBase(k, z) + G[k] * 0.65;
    }
    for (let k = 0; k < nL - 1; k++) J[k] = Math.max(F[k], F[k + 1]) + 0.45 * (layers[k].bulge + layers[k + 1].bulge);
    J[nL - 1] = F[nL - 1] + 0.3;
    const jBottom = F[0] + 0.3;
    // 收邊從第一個高於（頂 − 0.4）的列開始
    let firstCap = rowY.length;
    for (let r = 0; r < rowY.length; r++) {
      if (rowY[r] >= H - 0.4) {
        firstCap = r;
        break;
      }
    }
    const edgeY = H - 0.4;
    const edgeX = surface(z, edgeY);
    const topK = layerAt(edgeY);
    const cap: [number, number][] = [
      [edgeX, edgeY],
      [edgeX + 0.45, H],
      [edgeX + 2.6, H + 0.2],
      [edgeX + 10, H + 0.5],
    ];
    for (let r = 0; r < R; r++) {
      let x: number;
      let y: number;
      let tint: number;
      let ao: number;
      if (r < firstCap) {
        y = rowY[r];
        const k = rowK[r];
        const b = rowB[r];
        const Jsel = rowF[r] < 0.5 ? (k > 0 ? J[k - 1] : jBottom) : J[k];
        const bump = (pinned2(z, y, 2.5, 1.9, seed * 37 + salt, FIX + 3 + salt) - 0.5) * 0.6;
        x = F[k] + (Jsel - F[k]) * (1 - b) + bump;
        tint = layers[k].tint;
        ao = (0.45 + 0.55 * b) * (1 - 0.4 * G[k]) * (y < 0.3 ? 0.8 : 1);
      } else {
        const c = Math.min(CAP_ROWS - 1, r - firstCap);
        x = cap[c][0];
        y = cap[c][1];
        tint = layers[topK].tint;
        ao = 1;
      }
      const o = (r * C + j) * 3;
      pos[o] = side * x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      uv[(r * C + j) * 2] = tint;
      uv[(r * C + j) * 2 + 1] = ao;
    }
  }
  // 三角形：右側（side = +1）法線朝 −x、左側朝 +x（都面向河道）
  const idx = new Uint16Array((R - 1) * (C - 1) * 6);
  let t = 0;
  for (let r = 0; r < R - 1; r++) {
    for (let j = 0; j < C - 1; j++) {
      const a = r * C + j;
      const b = a + 1;
      const c = a + C;
      const d = c + 1;
      if (side > 0) {
        idx[t++] = a;
        idx[t++] = c;
        idx[t++] = b;
        idx[t++] = b;
        idx[t++] = c;
        idx[t++] = d;
      } else {
        idx[t++] = a;
        idx[t++] = b;
        idx[t++] = c;
        idx[t++] = b;
        idx[t++] = d;
        idx[t++] = c;
      }
    }
  }
  // 法線：直接用格網的中央差分（列方向 × 欄方向），比 computeVertexNormals 快；
  // 收邊重複的頂點（差分為 0）沿用下一列的法線
  const nrm = new Float32Array(R * C * 3);
  for (let r = 0; r < R; r++) {
    const r0 = r > 0 ? r - 1 : 0;
    const r1 = r < R - 1 ? r + 1 : R - 1;
    for (let j = 0; j < C; j++) {
      const j0 = j > 0 ? j - 1 : 0;
      const j1 = j < C - 1 ? j + 1 : C - 1;
      const a = (r1 * C + j) * 3;
      const b = (r0 * C + j) * 3;
      const yx = pos[a] - pos[b];
      const yy = pos[a + 1] - pos[b + 1];
      const yz = pos[a + 2] - pos[b + 2];
      const c = (r * C + j1) * 3;
      const d = (r * C + j0) * 3;
      const zx = pos[c] - pos[d];
      const zy = pos[c + 1] - pos[d + 1];
      const zz = pos[c + 2] - pos[d + 2];
      const nx = (yy * zz - yz * zy) * side;
      const ny = (yz * zx - yx * zz) * side;
      const nz = (yx * zy - yy * zx) * side;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const o = (r * C + j) * 3;
      if (len < 1e-6) {
        if (r > 0) {
          nrm[o] = nrm[o - C * 3];
          nrm[o + 1] = nrm[o - C * 3 + 1];
          nrm[o + 2] = nrm[o - C * 3 + 2];
        } else {
          nrm[o] = -side;
        }
      } else {
        nrm[o] = nx / len;
        nrm[o + 1] = ny / len;
        nrm[o + 2] = nz / len;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return { side, geometry: g, layers, surface, top, front };
}
