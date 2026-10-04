import * as THREE from 'three';
import { CHUNK_LEN, LANE_WIDTH } from '../../../config';
import { seeded } from '../../proctex';
import { mergeByMaterial } from '../../merge';
import type { ForestAssets } from './assets';
import type { ForestFx } from './fx';
import { Batch, pick, range, subRect, trs, type Rng, type UVRect } from './geom';
import { addBush, addFern, addLog, addMushrooms, addRock, addRoot, addSprout, addTree, type FloraTarget } from './flora';
import { addGround, edgeX, floorHeight, getTrackVariants } from './track';

/**
 * 一段死亡森林（長 CHUNK_LEN）：林道與三條運木軌道、兩側巨樹（近／中／遠三層）、
 * 路肩的樹根蕨類苔蘚石與香菇、林下灌木與倒木、偶爾出現的鐵絲網圍欄與警告牌、林間光束、落葉與螢火蟲。
 * 合併後約 14 個網格（各材質一個＋落葉＋螢火蟲）。
 */

/** 太陽方向（從場景指向太陽）；atmosphere.sunDir 與光束斜射方向共用 */
export const FOREST_SUN: [number, number, number] = [-0.38, 0.8, 0.46];
/** 光束沿太陽方向斜射 */
const SUN_DIR = new THREE.Vector3(...FOREST_SUN).normalize();

/** 一段場景的批次（依材質；樹皮分成投影／不投影兩組） */
interface ChunkBatches {
  path: Batch;
  floor: Batch;
  sleeper: Batch;
  metal: Batch;
  barkNear: Batch;
  barkFar: Batch;
  moss: Batch;
  canopy: Batch;
  plants: Batch;
  props: Batch;
  rock: Batch;
  fx: Batch;
}

/** 一段場景所有網格的保守外框（含伸出段落的光束、坡上遠樹的樹冠），省掉逐頂點算外框 */
const CHUNK_BOUNDS = new THREE.Box3(new THREE.Vector3(-82, -6, -CHUNK_LEN - 20), new THREE.Vector3(82, 70, 22));

/**
 * 暖身：預先組好軌道變化、建一段丟掉的場景（讓 JIT 熱起來、批次陣列長到夠大），
 * 之後每段的建置時間才穩定。在 createKit() 呼叫。
 */
export function warmUpForest(A: ForestAssets, fx: ForestFx): void {
  getTrackVariants(A);
  const g = buildForestChunk(A, fx, 7);
  g.traverse((o) => {
    if (o.userData.forestFx) fx.forget(o);
    const m = o as THREE.Mesh;
    if (m.isMesh && !o.userData.forestFx) m.geometry.dispose();
  });
}

/** 段落批次（模組層級重複使用：每段開始時清空，陣列不必每次重新配置） */
let shared: ChunkBatches | null = null;

/** 取得清空後的段落批次 */
function chunkBatches(): ChunkBatches {
  if (!shared) {
    shared = {
      path: new Batch(512),
      floor: new Batch(8192),
      sleeper: new Batch(16384),
      metal: new Batch(16384),
      barkNear: new Batch(32768),
      barkFar: new Batch(32768),
      moss: new Batch(8192),
      canopy: new Batch(16384),
      plants: new Batch(16384),
      props: new Batch(8192),
      rock: new Batch(2048),
      fx: new Batch(256),
    };
  }
  for (const b of Object.values(shared)) b.reset();
  return shared;
}

/** 林間光束：沿太陽方向斜射的三片交叉光板（上亮下淡） */
export function addBeam(b: Batch, rect: UVRect, x: number, y: number, z: number, len: number, wb: number, wt: number): void {
  const d = SUN_DIR;
  const e1 = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
  const p0 = new THREE.Vector3(x, y, z);
  const p1 = new THREE.Vector3(x, y, z).addScaledVector(d, len);
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const c = new THREE.Vector3();
  const dd = new THREE.Vector3();
  for (let k = 0; k < 3; k++) {
    const th = (k / 3) * Math.PI;
    const w = new THREE.Vector3().addScaledVector(e1, Math.cos(th)).addScaledVector(e2, Math.sin(th));
    a.copy(p0).addScaledVector(w, -wb / 2);
    bb.copy(p0).addScaledVector(w, wb / 2);
    c.copy(p1).addScaledVector(w, wt / 2);
    dd.copy(p1).addScaledVector(w, -wt / 2);
    b.quad(a, bb, c, dd, [rect.u, rect.v], [rect.u + rect.w, rect.v], [rect.u + rect.w, rect.v + rect.h], [rect.u, rect.v + rect.h]);
  }
}

/** 地面光斑（樹葉縫隙透下來的陽光） */
export function addSpot(b: Batch, rect: UVRect, x: number, y: number, z: number, sx: number, sz: number, rot: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  /** 光斑矩形的局部座標 (u, v) → 世界座標（繞 y 轉 rot） */
  const p = (u: number, v: number) => new THREE.Vector3(x + u * c - v * s, y, z + u * s + v * c);
  b.quad(p(-sx / 2, sz / 2), p(sx / 2, sz / 2), p(sx / 2, -sz / 2), p(-sx / 2, -sz / 2), [rect.u, rect.v], [rect.u + rect.w, rect.v], [rect.u + rect.w, rect.v + rect.h], [rect.u, rect.v + rect.h]);
}

/** 森林外圍的鐵絲網圍欄：木樁每 3 m 一根、三股帶刺鐵絲（中間略垂）、掛「危險」「禁止進入」警告牌 */
function addFence(B: ChunkBatches, A: ForestAssets, rnd: Rng, seed: number, side: number): void {
  const x = side * 6.9;
  const z0 = -range(rnd, 0.5, 5);
  const z1 = -range(rnd, 20, CHUNK_LEN - 0.5);
  const posts: [number, number, number][] = [];
  for (let z = z0; z >= z1; z -= 3) {
    const px = x + range(rnd, -0.08, 0.08);
    const gy = floorHeight(px, z, seed);
    const h = range(rnd, 1.5, 1.75);
    posts.push([px, gy, z]);
    B.props.add(A.tpl.box, trs(px, gy + h / 2 - 0.2, z, range(rnd, -0.06, 0.06), rnd() * 3, range(rnd, -0.06, 0.06), 0.14, h, 0.14), A.uv.prop.board, 1, 1, 0.5, 0.5);
  }
  const wire = subRect(A.uv.plant.wire, 0, 0.4, 1, 0.2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < posts.length - 1; i++) {
    if (rnd() < 0.12) continue; // 偶爾斷掉一段
    const [x0, y0, zz0] = posts[i];
    const [x1, y1, zz1] = posts[i + 1];
    for (const hh of [0.45, 0.9, 1.3]) {
      // 兩半段，中間下垂
      const sag = range(rnd, 0.05, 0.16);
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2 + hh - sag;
      const zm = (zz0 + zz1) / 2;
      const hw = 0.05;
      a.set(x0, y0 + hh - hw, zz0);
      b.set(xm, ym - hw, zm);
      c.set(xm, ym + hw, zm);
      d.set(x0, y0 + hh + hw, zz0);
      B.plants.quad(a, b, c, d, [wire.u, wire.v], [wire.u + wire.w * 0.5, wire.v], [wire.u + wire.w * 0.5, wire.v + wire.h], [wire.u, wire.v + wire.h]);
      a.set(xm, ym - hw, zm);
      b.set(x1, y1 + hh - hw, zz1);
      c.set(x1, y1 + hh + hw, zz1);
      d.set(xm, ym + hw, zm);
      B.plants.quad(a, b, c, d, [wire.u + wire.w * 0.5, wire.v], [wire.u + wire.w, wire.v], [wire.u + wire.w, wire.v + wire.h], [wire.u + wire.w * 0.5, wire.v + wire.h]);
    }
  }
  // 警告牌：掛在木樁朝跑道的一面
  const signs = posts.length > 4 ? 2 : 1;
  for (let k = 0; k < signs; k++) {
    const [px, gy, pz] = posts[Math.min(posts.length - 1, 1 + k * 3)];
    const rect = k % 2 === 0 ? A.uv.prop.signDanger : A.uv.prop.signKeepOut;
    B.props.add(A.tpl.box, trs(px - side * 0.1, gy + 1.0, pz, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2, range(rnd, -0.08, 0.08), 0.66, 0.66, 0.05), rect, 1, 1, 0.5, 0.5);
  }
}

/** 一側（side = −1 左、+1 右）的森林 */
function addSide(B: ChunkBatches, A: ForestAssets, rnd: Rng, seed: number, side: number, fence: boolean): void {
  const near: FloraTarget = { bark: B.barkNear, moss: B.moss, canopy: B.canopy, plants: B.plants, props: B.props, rock: B.rock };
  const far: FloraTarget = { ...near, bark: B.barkFar };
  /** 已佔用的圓（x, z, 半徑），避免大東西互相穿插 */
  const occ: [number, number, number][] = [];
  /** 圓 (x, z, r) 是否沒有和已佔用的圓重疊 */
  const free = (x: number, z: number, r: number) => occ.every(([ox, oz, or]) => (x - ox) ** 2 + (z - oz) ** 2 > (r + or) ** 2);
  /** 森林地面在 (x, z) 的高度 */
  const gy = (x: number, z: number) => floorHeight(x, z, seed);
  const L = CHUNK_LEN;

  // 近景巨樹：1～2 棵，緊貼路肩外側，往跑道伸出樹枝形成樹冠隧道
  const nNear = rnd() < 0.6 ? 2 : 1;
  for (let k = 0; k < nNear; k++) {
    const r = range(rnd, 1.35, 2.5);
    const x = side * (8.2 + r + rnd() * 1.0);
    const z = nNear === 2 ? (k === 0 ? -range(rnd, 3, 11) : -range(rnd, 17, 26)) : -range(rnd, 8, 22);
    addTree(near, A, rnd, { x, z, y: gy(x, z), r, h: range(rnd, 24, 32), lod: 0, keepOutX: 6.2, reach: -side, canopyY: range(rnd, 15, 19), overTrackMinY: 7.5 });
    occ.push([x, z, r + 2.4]);
  }
  // 中景巨樹：2 棵（直徑 4.4～7 m）
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 8; tries++) {
      const r = range(rnd, 2.2, 3.5);
      const x = side * range(rnd, 16 + r, 25 + r);
      const z = -range(rnd, 1 + k * 15, 14 + k * 15);
      if (!free(x, z, r + 2.5)) continue;
      addTree(far, A, rnd, { x, z, y: gy(x, z), r, h: range(rnd, 28, 36), lod: 1, keepOutX: 8, reach: 0, canopyY: 22, overTrackMinY: 7.5 });
      occ.push([x, z, r + 2.5]);
      break;
    }
  }
  // 遠景巨樹：3 棵（坡上，低細緻度）
  for (let k = 0; k < 3; k++) {
    for (let tries = 0; tries < 8; tries++) {
      const r = range(rnd, 2.5, 4);
      const x = side * range(rnd, 33, 66);
      const z = -range(rnd, k * 10, k * 10 + 10);
      if (!free(x, z, r + 3)) continue;
      addTree(far, A, rnd, { x, z, y: gy(x, z), r, h: range(rnd, 30, 40), lod: 2, keepOutX: 8, reach: 0, canopyY: 25, overTrackMinY: 7.5 });
      occ.push([x, z, r + 3]);
      break;
    }
  }
  // 路肩：拱起的樹根
  for (let k = 0; k < 3; k++) {
    const za = -range(rnd, 1, L - 5);
    const len = range(rnd, 2.2, 4.5);
    const xa = side * range(rnd, 5.3, 6.6);
    const xb = side * range(rnd, 5.1, 6.4);
    addRoot(B.barkNear, xa, za, xb, za - len, gy(xa, za), range(rnd, 0.18, 0.45), range(rnd, 0.1, 0.19), rnd);
  }
  // 路肩：蕨類
  for (let k = 0; k < 9; k++) {
    const z = -range(rnd, 0.5, L - 0.5);
    const x = side * (edgeX(z, side, seed) + range(rnd, 0.35, 3.4));
    if (!free(x, z, 0.3)) continue;
    addFern(near, A, rnd, x, gy(x, z), z, range(rnd, 0.8, 1.5));
  }
  // 路肩：苔蘚石、香菇、小芽
  for (let k = 0; k < 2; k++) {
    const z = -range(rnd, 1, L - 1);
    const x = side * range(rnd, 5.4, 7.5);
    if (!free(x, z, 0.6)) continue;
    addRock(near, A, rnd, x, gy(x, z), z, range(rnd, 0.5, 1.1));
    occ.push([x, z, 0.8]);
  }
  for (let k = 0; k < 2; k++) {
    const z = -range(rnd, 1, L - 1);
    const x = side * range(rnd, 5.0, 6.8);
    const kind = rnd() < 0.45 ? 'red' : rnd() < 0.6 ? 'brown' : 'glow';
    addMushrooms(near, A, rnd, x, gy(x, z), z, 3 + Math.floor(rnd() * 3), kind, range(rnd, 1, 1.6));
  }
  for (let k = 0; k < 5; k++) {
    const z = -range(rnd, 0.5, L - 0.5);
    const x = side * range(rnd, 4.0, 5.2);
    addSprout(near, A, rnd, x, Math.max(0, gy(x, z)), z, range(rnd, 0.3, 0.5), rnd() < 0.5 ? A.uv.plant.grass : A.uv.plant.sprout);
  }
  // 林下：蕨類、灌木、香菇
  for (let k = 0; k < 9; k++) {
    const z = -range(rnd, 0, L);
    const x = side * range(rnd, 7.5, 24);
    if (!free(x, z, 0.8)) continue;
    addFern(near, A, rnd, x, gy(x, z), z, range(rnd, 1.2, 2.3));
  }
  for (let k = 0; k < 3; k++) {
    const z = -range(rnd, 0, L);
    const x = side * range(rnd, 9, 30);
    if (!free(x, z, 1.5)) continue;
    addBush(near, A, rnd, x, gy(x, z), z, range(rnd, 1.1, 2));
  }
  if (rnd() < 0.5) {
    const z = -range(rnd, 2, L - 2);
    const x = side * range(rnd, 8, 14);
    addMushrooms(near, A, rnd, x, gy(x, z), z, 4, pick(rnd, ['red', 'glow', 'brown'] as const), 1.4);
  }
  // 倒木（平行跑道）
  if (rnd() < 0.4) {
    const za = -range(rnd, 2, 12);
    const len = range(rnd, 6, 11);
    const x = side * range(rnd, 7.6, 10);
    if (free(x, za - len / 2, 1.5)) {
      const r = range(rnd, 0.35, 0.6);
      addLog(near, A, rnd, x, gy(x, za) + r * 0.7, za, x + side * range(rnd, -0.8, 0.8), gy(x, za - len) + r * 0.7, za - len, r, true, true);
      addMushrooms(near, A, rnd, x - side * r * 0.9, gy(x, za - 1), za - 1.2, 3, 'brown', 1);
    }
  }
  // 遠處填充：大灌木（遮住坡面，讓遠處不空）
  for (let k = 0; k < 4; k++) {
    const z = -range(rnd, 0, L);
    const x = side * range(rnd, 26, 70);
    if (!free(x, z, 2.5)) continue;
    addBush(far, A, rnd, x, gy(x, z), z, range(rnd, 2.5, 4.2));
  }
  if (fence) addFence(B, A, rnd, seed, side);
}

/** 軌道之間與外緣的小芽、小香菇 */
function addTrackside(B: ChunkBatches, A: ForestAssets, rnd: Rng): void {
  const t: FloraTarget = { bark: B.barkNear, moss: B.moss, canopy: B.canopy, plants: B.plants, props: B.props, rock: B.rock };
  for (let k = 0; k < 8; k++) {
    const gap = pick(rnd, [-1.5, -0.5, 0.5, 1.5] as const);
    const x = gap * LANE_WIDTH + range(rnd, -0.08, 0.08);
    const z = -range(rnd, 0.3, CHUNK_LEN - 0.3);
    addSprout(t, A, rnd, x, 0, z, range(rnd, 0.22, 0.38), rnd() < 0.6 ? A.uv.plant.sprout : A.uv.plant.grass);
  }
  if (rnd() < 0.6) {
    const s = rnd() < 0.5 ? -1 : 1;
    addMushrooms(t, A, rnd, s * range(rnd, 3.95, 4.4), 0, -range(rnd, 2, CHUNK_LEN - 2), 2 + Math.floor(rnd() * 2), rnd() < 0.5 ? 'brown' : 'red', 0.8);
  }
}

/** 林間光束：每段 2 道（一道落在跑道上），底部有地面光斑 */
function addBeams(B: ChunkBatches, A: ForestAssets, rnd: Rng, seed: number): void {
  for (let k = 0; k < 2; k++) {
    const onTrack = k === 0;
    const x = onTrack ? range(rnd, -3, 3) : (rnd() < 0.5 ? -1 : 1) * range(rnd, 5, 15);
    const z = -range(rnd, 2 + k * 14, 13 + k * 14);
    const y = onTrack ? 0 : floorHeight(x, z, seed);
    const wb = range(rnd, 2.2, 3.4);
    addBeam(B.fx, A.uv.beam, x, y, z, 32, wb, wb * 0.55);
    addSpot(B.fx, A.uv.spot, x, y + 0.045, z, wb * 1.4, wb * 1.9, rnd() * 3);
  }
}

/**
 * 建一段森林場景。seed 決定變化；所有批次組好後交給 mergeByMaterial（落葉與螢火蟲保留不合併）。
 */
export function buildForestChunk(A: ForestAssets, fx: ForestFx, seed: number): THREE.Object3D {
  const rnd = seeded((seed * 2654435761) >>> 0 || 1);
  const B = chunkBatches();
  addGround(B, seed);
  const tv = getTrackVariants(A);
  const track = tv[Math.floor(rnd() * tv.length) % tv.length];
  B.sleeper.addRaw(track.sleeper);
  B.metal.addRaw(track.metal);
  addTrackside(B, A, rnd);
  const fenceSide = rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) : 0;
  addSide(B, A, rnd, seed, -1, fenceSide === -1);
  addSide(B, A, rnd, seed, 1, fenceSide === 1);
  addBeams(B, A, rnd, seed);

  const M = A.mats;
  const root = new THREE.Group();
  /** 把一個批次輸出成網格（含投影設定）加進這一段 */
  const put = (b: Batch, mat: THREE.Material, cast: boolean, receive: boolean, name: string) => {
    const g = b.geometry(CHUNK_BOUNDS, true);
    if (!g) return;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.name = name;
    // Batch 已經依（材質, 投影, 接收陰影）合併成一個網格；mergeByMaterial 再複製一次約 8 萬頂點只會多花數十毫秒，
    // 所以標記保留（keep），由它直接收進結果群組
    mesh.userData.forestBatched = true;
    root.add(mesh);
  };
  put(B.path, M.path, false, true, 'path');
  put(B.floor, M.floor, false, true, 'floor');
  put(B.sleeper, M.sleeper, false, true, 'sleepers');
  put(B.metal, M.metal, false, true, 'rails');
  put(B.barkNear, M.bark, true, true, 'bark-near');
  put(B.barkFar, M.bark, false, true, 'bark-far');
  put(B.moss, M.moss, false, true, 'moss');
  put(B.canopy, M.canopy, false, false, 'canopy');
  put(B.plants, M.plants, false, true, 'plants');
  put(B.props, M.props, false, true, 'props');
  put(B.rock, M.rock, false, true, 'rocks');
  put(B.fx, M.fx, false, false, 'beams');
  root.add(fx.makeLeaves(rnd, 22, CHUNK_LEN));
  root.add(fx.makeFireflies(rnd, 16, CHUNK_LEN));
  const merged = mergeByMaterial(root, { keep: (o) => o.userData.forestFx === true || o.userData.forestBatched === true });
  merged.name = 'forest-chunk';
  return merged;
}
