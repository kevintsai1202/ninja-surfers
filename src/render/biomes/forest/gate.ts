import * as THREE from 'three';
import { seeded } from '../../proctex';
import { mergeByMaterial } from '../../merge';
import type { ForestAssets } from './assets';
import { Batch, range, trs, tube } from './geom';
import { addCanopyBlob, addFern, addHanging, addMushrooms, addRock, addTree, type FloraTarget } from './flora';
import { addBeam, addSpot } from './chunk';

/**
 * 死亡森林入口地標：兩棵巨樹在跑道上方交纏成拱門，繫著粗大的注連繩、白色之字形紙垂與稻草穗。
 * 淨空：|x| ≤ 4.5 在 7.5 m 以下沒有任何東西（樹幹、板根、繩、紙垂都在外面或上面）。
 */

/** 樹幹中心離跑道中央的距離 */
const TREE_X = 8.2;
/** 樹幹基部半徑 */
const TREE_R = 2.0;
/** 注連繩兩端高度、中間下垂量 */
const ROPE_Y = 10.4;
const ROPE_SAG = 0.9;

/** 之字形紙垂（前後兩面），上端在 (x, y, z) */
function addShide(b: Batch, rect: { u: number; v: number; w: number; h: number }, x: number, y: number, z: number, ry: number): void {
  const steps = 4;
  const sh = 0.34;
  const sw = 0.27;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  /** 紙垂局部座標 → 世界座標（繞 y 轉 ry） */
  const P = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
  for (let k = 0; k < steps; k++) {
    // 每一段往左右整段錯開，形成閃電狀的之字形
    const x0 = (k % 2 === 0 ? -0.135 : 0.135) - sw / 2;
    const x1 = x0 + sw;
    const y0 = -k * sh;
    const y1 = -(k + 1) * sh + 0.02;
    const uv0: [number, number] = [rect.u, rect.v + rect.h * (1 - (k + 1) / steps)];
    const uv1: [number, number] = [rect.u + rect.w, rect.v + rect.h * (1 - (k + 1) / steps)];
    const uv2: [number, number] = [rect.u + rect.w, rect.v + rect.h * (1 - k / steps)];
    const uv3: [number, number] = [rect.u, rect.v + rect.h * (1 - k / steps)];
    for (const f of [1, -1]) {
      const lz = f * 0.004;
      if (f > 0) b.quad(P(x0, y1, lz), P(x1, y1, lz), P(x1, y0, lz), P(x0, y0, lz), uv0, uv1, uv2, uv3);
      else b.quad(P(x1, y1, lz), P(x0, y1, lz), P(x0, y0, lz), P(x1, y0, lz), uv1, uv0, uv3, uv2);
    }
  }
}

/** 建立入口地標 */
export function buildForestGate(A: ForestAssets): THREE.Object3D {
  const rnd = seeded(8800);
  const T: FloraTarget = { bark: new Batch(16384), moss: new Batch(4096), canopy: new Batch(8192), plants: new Batch(4096), props: new Batch(8192), rock: new Batch(1024) };
  const fxB = new Batch(64);
  /** 注連繩（稻草繩材質） */
  const ropeB = new Batch(4096);
  const centers: ((yy: number) => [number, number])[] = [];
  for (const side of [-1, 1]) {
    const x = side * TREE_X;
    centers.push(addTree(T, A, rnd, { x, z: 0, y: 0, r: TREE_R, h: 15, lod: 0, keepOutX: 4.9, reach: -side, canopyY: 18, overTrackMinY: 8.2, crown: false, hiCanopy: true }));
  }

  // 交纏的拱形大樹枝：兩棵樹各伸一根跨過跑道，在中間互相纏繞
  for (const side of [-1, 1]) {
    const [cx, cz] = centers[side < 0 ? 0 : 1](10);
    const p0 = new THREE.Vector3(cx, 9.6, cz);
    const p1 = new THREE.Vector3(-side * 1.5, 17.2, side * 0.2);
    const p2 = new THREE.Vector3(-side * 6.2, 15.2, -side * 0.3);
    const pts: THREE.Vector3[] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const a = (1 - s) * (1 - s);
      const b = 2 * (1 - s) * s;
      const c = s * s;
      // 互相纏繞：中段沿 z 擺動、兩根相位相反
      const twist = Math.sin(s * Math.PI * 3) * 0.55 * Math.sin(s * Math.PI) * side;
      pts.push(new THREE.Vector3(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z + twist));
    }
    tube(T.bark, pts, (tt) => 0.95 * (1 - 0.62 * tt), 12, 3, 2.4);
    // 樹冠
    addCanopyBlob(T, A, rnd, p2.x, p2.y + 2.2, p2.z, 5.5, 3.2, 0, true);
    addCanopyBlob(T, A, rnd, side * TREE_X, 19.5, 0, 6.5, 4, 0, true);
    // 樹枝上垂下的藤蔓與松蘿（在跑道上方的不低於 8.2 m）
    for (let i = 3; i < n; i += 2) {
      const p = pts[i];
      const minY = Math.abs(p.x) < 5 ? 8.2 : 1.2;
      const len = Math.min(p.y - 0.6 - minY, range(rnd, 2.5, 6));
      if (len > 0.8) addHanging(T.plants, rnd() < 0.5 ? A.uv.plant.ivy : A.uv.plant.hangMoss, p.x, p.y - 0.6, p.z, len, 0.7, 1.5, rnd);
    }
  }
  addCanopyBlob(T, A, rnd, 0, 20.5, 0.5, 7.5, 3.8, 0, true);

  // 注連繩：兩股稻草繩絞在一起、中間下垂，兩端各繞樹幹一圈
  const ringR = (side: number) => {
    const [cx] = centers[side < 0 ? 0 : 1](ROPE_Y);
    return cx;
  };
  const endL = new THREE.Vector3(ringR(-1) + 1.75, ROPE_Y, 0.2);
  const endR = new THREE.Vector3(ringR(1) - 1.75, ROPE_Y, 0.2);
  /** 注連繩中心線：s = 0..1 從左到右，中間下垂 */
  const rope = (s: number) => new THREE.Vector3().lerpVectors(endL, endR, s).add(new THREE.Vector3(0, -ROPE_SAG * Math.sin(Math.PI * s), 0));
  for (let k = 0; k < 2; k++) {
    const pts: THREE.Vector3[] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const a = k * Math.PI + s * Math.PI * 2 * 7;
      const thick = 1 - 0.45 * Math.abs(s - 0.5) * 2; // 中間粗、兩端細（注連繩的形狀）
      pts.push(rope(s).add(new THREE.Vector3(0, Math.cos(a) * 0.2 * thick, Math.sin(a) * 0.2 * thick)));
    }
    tube(ropeB, pts, (tt) => 0.25 * (1 - 0.45 * Math.abs(tt - 0.5) * 2), 8, 1, 0.5);
  }
  // 繞樹幹的繩圈
  for (const side of [-1, 1]) {
    const [cx, cz] = centers[side < 0 ? 0 : 1](ROPE_Y);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      ring.push(new THREE.Vector3(cx + Math.cos(a) * 1.72, ROPE_Y + Math.sin(a * 2) * 0.05, cz + Math.sin(a) * 1.72));
    }
    tube(ropeB, ring, () => 0.16, 7, 1, 0.45);
  }
  // 紙垂（白色之字形）與稻草穗（房）
  for (let k = 0; k < 5; k++) {
    const s = 0.14 + k * 0.18;
    const p = rope(s);
    addShide(T.props, A.uv.prop.paper, p.x, p.y - 0.3, p.z + 0.08, range(rnd, -0.25, 0.25));
  }
  for (let k = 0; k < 4; k++) {
    const s = 0.23 + k * 0.18;
    const p = rope(s);
    T.props.add(A.tpl.stem, trs(p.x, p.y - 1.1, p.z, 0, rnd() * 6, 0, 0.2, 0.85, 0.2), A.uv.prop.straw);
  }

  // 樹基：蕨類、苔蘚石、香菇（都在 |x| > 5）
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const x = side * range(rnd, 6.2, 11);
      const z = range(rnd, -4, 4);
      addFern(T, A, rnd, x, 0.1, z, range(rnd, 0.9, 1.5));
    }
    addRock(T, A, rnd, side * 6.5, 0, range(rnd, 1.5, 3), 0.8);
    addMushrooms(T, A, rnd, side * 5.4, 0, -2.2, 4, side < 0 ? 'glow' : 'red', 1.3);
  }
  // 「禁止進入」告示：木樁＋牌子（面向來的方向）
  T.props.add(A.tpl.box, trs(-5.3, 1.0, 2.4, 0, 0.1, 0.03, 0.14, 2.2, 0.14), A.uv.prop.board, 1, 1, 0.5, 0.5);
  T.props.add(A.tpl.box, trs(-5.3, 1.75, 2.48, 0, 0.1, 0.03, 0.75, 0.75, 0.05), A.uv.prop.signKeepOut, 1, 1, 0.5, 0.5);

  // 穿過拱門的光束
  addBeam(fxB, A.uv.beam, 1.5, 0, -4, 30, 3.2, 1.8);
  addSpot(fxB, A.uv.spot, 1.5, 0.05, -4, 4, 5.5, 0.4);

  const root = new THREE.Group();
  /** 把一個批次輸出成網格加進入口地標 */
  const put = (b: Batch, mat: THREE.Material, cast: boolean) => {
    const g = b.geometry();
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    root.add(m);
  };
  put(T.bark, A.mats.bark, true);
  put(T.moss, A.mats.moss, false);
  put(T.canopy, A.mats.canopy, false);
  put(T.plants, A.mats.plants, false);
  put(T.props, A.mats.props, true);
  put(T.rock, A.mats.rock, false);
  put(ropeB, A.mats.ropeStraw, true);
  put(fxB, A.mats.fx, false);
  const merged = mergeByMaterial(root);
  merged.name = 'forest-gate';
  return merged;
}
