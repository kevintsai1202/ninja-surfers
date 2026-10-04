import * as THREE from 'three';
import { TRAIN } from '../../../config';
import { seeded } from '../../proctex';
import type { ForestAssets } from './assets';
import { Batch, boxTpl, range, trs, tube, type Rng } from './geom';
import { faceMatrix } from './flora';
import { RAIL_OFFSET, RAIL_TOP } from './track';

/**
 * 運木台車（列車障礙）：一節 TRAIN.carLength 一節組裝，節與節之間有連結器。
 * 每節：兩組轉向架（輻條鐵輪、側架、彈簧、枕樑）、木製底架與甲板、兩側立柱、
 * 3＋2＋1 金字塔堆疊的巨大原木（兩端年輪切面）、麻繩綑綁、頂部木板平台（頂面正好在 TRAIN.height，平坦好跑）。
 * 迎面駛來的（moving）在車頭掛兩盞亮著的油燈＋光暈。
 * 依 (長度, variant, moving) 快取組好的模板，之後只 clone（共用幾何與材質）。
 */

/** 原木堆疊間距（以 0.34 m 半徑排列） */
const LOG_SP = 0.34;
/** 原木實際半徑（比間距小一點，木頭之間留縫，側面看得出一根一根） */
const LOG_R = 0.322;
/** 甲板頂面高度 */
const DECK_TOP = 1.1;
/** 輪半徑 */
const WHEEL_R = 0.36;

/** 台車的批次（依材質） */
interface CartBatches {
  wood: Batch;
  iron: Batch;
  logs: Batch;
  props: Batch;
  lamp: Batch;
  fx: Batch;
  /** 麻繩（自己的可重複貼圖材質） */
  rope: Batch;
  /** 甲板與頂部平台的木板（原木色） */
  deck: Batch;
}

/** 加一個倒角方塊（尺寸 w×h×d、中心 x,y,z、繞 y 轉 ry） */
function box(b: Batch, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, bevel = 0.03, uvScale = 1, rz = 0): void {
  b.add(boxTpl(w, h, d, bevel, uvScale), trs(x, y, z, 0, ry, rz));
}

/** 一組轉向架：兩軸四輪、側架、彈簧、枕樑 */
function addBogie(B: CartBatches, A: ForestAssets, zc: number): void {
  const wy = RAIL_TOP + WHEEL_R;
  for (const az of [zc + 0.6, zc - 0.6]) {
    for (const s of [-1, 1]) {
      // 鏡像（左輪 x 縮放為負）讓輪緣都朝內側
      B.iron.add(A.tpl.wheel, trs(s * RAIL_OFFSET, wy, az, 0, 0, 0, s * WHEEL_R, WHEEL_R, WHEEL_R));
    }
    // 車軸
    B.iron.add(A.tpl.cyl, trs(-0.78, wy, az, 0, 0, -Math.PI / 2, 0.055, 1.56, 0.055));
  }
  for (const s of [-1, 1]) {
    // 側架（輪子外側）＋軸箱
    box(B.iron, 0.12, 0.2, 1.75, s * 0.84, wy + 0.02, zc, 0, 0.03, 0.5);
    for (const az of [zc + 0.6, zc - 0.6]) box(B.iron, 0.16, 0.22, 0.24, s * 0.86, wy, az, 0, 0.03, 0.5);
    // 彈簧（兩組）
    for (const dz of [-0.18, 0.18]) B.iron.add(A.tpl.cyl, trs(s * 0.84, wy + 0.1, zc + dz, 0, 0, 0, 0.06, 0.18, 0.06));
  }
  // 枕樑
  box(B.wood, 2.0, 0.18, 0.34, 0, wy + 0.32, zc, 0, 0.03, 1);
}

/** 3＋2＋1 堆疊的原木中心（x, y） */
function logCenters(): [number, number][] {
  const r = LOG_SP;
  const y0 = DECK_TOP + LOG_R;
  const dy = r * Math.sqrt(3);
  return [
    [-2 * r, y0],
    [0, y0],
    [2 * r, y0],
    [-r, y0 + dy],
    [r, y0 + dy],
    [0, y0 + 2 * dy],
  ];
}

/** 綁原木的麻繩：從甲板左緣，沿原木堆外緣繞過頂上，到甲板右緣 */
function ropePath(z: number): THREE.Vector3[] {
  const cs = logCenters();
  const R = LOG_SP + 0.04;
  const [bl, , br, , , top] = [cs[0], cs[1], cs[2], cs[3], cs[4], cs[5]];
  const pts: THREE.Vector3[] = [new THREE.Vector3(-1.04, DECK_TOP - 0.02, z)];
  /** 沿某根原木外緣（圓心 c）從角度 a0 到 a1 取 n 段點，加進繩子路徑 */
  const arc = (c: [number, number], a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector3(c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, z));
    }
  };
  const d2r = Math.PI / 180;
  arc(bl, 180 * d2r, 150 * d2r, 2);
  arc(top, 150 * d2r, 30 * d2r, 6);
  arc(br, 30 * d2r, 0, 2);
  pts.push(new THREE.Vector3(1.04, DECK_TOP - 0.02, z));
  return pts;
}

/** 一節台車（z 從 z0 往 −z 延伸 carLength） */
function addCar(B: CartBatches, A: ForestAssets, z0: number, v: number, rnd: Rng): void {
  const len = TRAIN.carLength;
  const zs = z0 - 0.25;
  const ze = z0 - len + 0.25;
  const bodyLen = zs - ze;
  const zc = (zs + ze) / 2;
  const W = TRAIN.width;
  // 轉向架
  addBogie(B, A, zs - 1.7);
  addBogie(B, A, ze + 1.7);
  // 底架：兩條中樑、兩條側樑（每 3 段，配合地平線下彎）
  const segs = 3;
  const sl = bodyLen / segs;
  for (let i = 0; i < segs; i++) {
    const z = zs - sl * (i + 0.5);
    for (const s of [-1, 1]) {
      box(B.wood, 0.2, 0.24, sl - 0.02, s * 0.5, DECK_TOP - 0.2, z, 0, 0.03, 1);
      box(B.wood, 0.14, 0.3, sl - 0.02, s * (W / 2 - 0.07), DECK_TOP - 0.18, z, 0, 0.04, 1);
    }
  }
  // 端樑（緩衝木）
  for (const z of [zs - 0.08, ze + 0.08]) box(B.wood, W, 0.32, 0.16, 0, DECK_TOP - 0.16, z, 0, 0.04, 1);
  // 甲板：橫向木板（每片 1.58 m 一張木板貼圖 = 4 片板子）
  const dk = 6;
  const dl = bodyLen / dk;
  for (let i = 0; i < dk; i++) {
    B.deck.add(boxTpl(dl - 0.03, 0.08, W - 0.04, 0.02, dl), trs(0, DECK_TOP - 0.04, zs - dl * (i + 0.5), 0, Math.PI / 2, 0));
  }
  // 立柱（每側 4 根）＋鐵箍
  const posts = 4;
  for (let i = 0; i < posts; i++) {
    const z = zs - 0.45 - ((bodyLen - 0.9) * i) / (posts - 1);
    for (const s of [-1, 1]) {
      const h = 3.06 - (DECK_TOP - 0.3);
      box(B.wood, 0.09, h, 0.15, s * (W / 2 - 0.05), DECK_TOP - 0.3 + h / 2, z, 0, 0.025, 1);
      box(B.iron, 0.11, 0.07, 0.17, s * (W / 2 - 0.05), DECK_TOP + 0.25, z, 0, 0.015, 0.4);
      box(B.iron, 0.11, 0.07, 0.17, s * (W / 2 - 0.05), 2.82, z, 0, 0.015, 0.4);
    }
  }
  // 原木（兩端略有長短，切面年輪）
  const rings = v === 1 ? A.uv.prop.ringsOld : A.uv.prop.ringsFresh;
  for (const [x, y] of logCenters()) {
    const a = zs - 0.05 + range(rnd, -0.18, 0.12);
    const b = ze + 0.05 + range(rnd, -0.12, 0.18);
    const pts: THREE.Vector3[] = [];
    const n = 5;
    for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(x, y, a + ((b - a) * i) / n));
    const w = rnd() * 10;
    tube(B.logs, pts, (tt, ang) => LOG_R * (1 + 0.035 * Math.sin(ang * 4 + w) + 0.03 * Math.sin(tt * 14 + ang * 2)), 12, 2, 1.8);
    B.props.add(A.tpl.disc, faceMatrix(x, y, a, 0, 0, 1, rnd() * 6.28, LOG_R * 1.03, LOG_R * 1.03), rings);
    B.props.add(A.tpl.disc, faceMatrix(x, y, b, 0, 0, -1, rnd() * 6.28, LOG_R * 1.03, LOG_R * 1.03), rings);
  }
  // 麻繩綑綁（兩道）
  for (const z of [zc + bodyLen * 0.28, zc - bodyLen * 0.28]) {
    tube(B.rope, ropePath(z), () => 0.035, 6, 1, 0.3);
  }
  // 頂部平台：橫樑＋縱向木板（頂面 = TRAIN.height）
  const top = TRAIN.height;
  const beams = 5;
  for (let i = 0; i < beams; i++) {
    const z = zs - 0.3 - ((bodyLen - 0.6) * i) / (beams - 1);
    box(B.wood, W, 0.1, 0.16, 0, top - 0.19, z, 0, 0.025, 1);
  }
  const pk = 4;
  const pl = bodyLen / pk;
  for (let i = 0; i < pk; i++) {
    B.deck.add(boxTpl(W, 0.14, pl - 0.05, 0.03, 0.55 * 4), trs(0, top - 0.07, zs - pl * (i + 0.5), 0, 0, 0));
  }
}

/** 車頭油燈：鐵支架、燈罩上下蓋、四根細柱、發光燈芯、光暈 */
function addLantern(B: CartBatches, A: ForestAssets, x: number, y: number, z: number): void {
  box(B.iron, 0.05, 0.05, 0.3, x, y + 0.36, z - 0.1, 0, 0.01, 0.3);
  B.iron.add(A.tpl.cyl, trs(x, y + 0.24, z, 0, 0, 0, 0.13, 0.06, 0.13));
  B.iron.add(A.tpl.cyl, trs(x, y + 0.3, z, 0, 0, 0, 0.05, 0.08, 0.05));
  B.iron.add(A.tpl.cyl, trs(x, y - 0.2, z, 0, 0, 0, 0.12, 0.05, 0.12));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    B.iron.add(A.tpl.cyl, trs(x + Math.cos(a) * 0.1, y - 0.16, z + Math.sin(a) * 0.1, 0, 0, 0, 0.012, 0.42, 0.012));
  }
  B.lamp.add(A.tpl.cyl, trs(x, y - 0.15, z, 0, 0, 0, 0.085, 0.36, 0.085));
  const h = A.uv.halo;
  B.fx.add(A.tpl.card, trs(x, y, z + 0.12, 0, 0, 0, 1.1, 1.1, 1), h);
}

/** 模板快取 */
const trainCache = new Map<string, THREE.Group>();

/** 建立（或從快取複製）一列運木台車 */
export function buildLogTrain(A: ForestAssets, length: number, variant: number, moving: boolean): THREE.Object3D {
  const v = ((variant % 3) + 3) % 3;
  const cars = Math.max(1, Math.round(length / TRAIN.carLength));
  const key = `${cars}|${v}|${moving ? 1 : 0}`;
  let tpl = trainCache.get(key);
  if (!tpl) {
    tpl = makeTrain(A, cars, v, moving);
    trainCache.set(key, tpl);
  }
  return tpl.clone();
}

/** 組一列台車並依材質合併 */
function makeTrain(A: ForestAssets, cars: number, v: number, moving: boolean): THREE.Group {
  const rnd = seeded(9100 + cars * 31 + v * 7);
  const B: CartBatches = { wood: new Batch(8192), iron: new Batch(16384), logs: new Batch(8192), props: new Batch(2048), lamp: new Batch(256), fx: new Batch(64), rope: new Batch(2048), deck: new Batch(4096) };
  for (let c = 0; c < cars; c++) addCar(B, A, -c * TRAIN.carLength, v, rnd);
  // 連結器：節與節之間的拉桿＋鉤頭
  for (let c = 1; c < cars; c++) {
    const z = -c * TRAIN.carLength;
    box(B.iron, 0.16, 0.14, 0.9, 0, 0.78, z, 0, 0.03, 0.4);
    box(B.iron, 0.3, 0.22, 0.14, 0, 0.78, z + 0.3, 0, 0.03, 0.4);
    box(B.iron, 0.3, 0.22, 0.14, 0, 0.78, z - 0.3, 0, 0.03, 0.4);
  }
  // 車頭與車尾的鉤頭
  box(B.iron, 0.3, 0.22, 0.24, 0, 0.78, -0.13, 0, 0.03, 0.4);
  box(B.iron, 0.3, 0.22, 0.24, 0, 0.78, -cars * TRAIN.carLength + 0.13, 0, 0.03, 0.4);
  if (moving) {
    addLantern(B, A, -0.62, 2.3, -0.12);
    addLantern(B, A, 0.62, 2.3, -0.12);
  }
  const g = new THREE.Group();
  g.name = `forest-train-${cars}-${v}${moving ? '-moving' : ''}`;
  /** 把一個批次輸出成網格加進列車群組 */
  const put = (b: Batch, mat: THREE.Material, cast: boolean, receive: boolean) => {
    const geo = b.geometry();
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    g.add(m);
  };
  put(B.wood, A.mats.cartWood[v], true, true);
  put(B.deck, A.mats.cartDeck, true, true);
  put(B.iron, A.mats.cartIron, true, true);
  put(B.logs, A.mats.logBark[v], true, true);
  put(B.props, A.mats.props, false, true);
  put(B.rope, A.mats.ropeHemp, false, true);
  put(B.lamp, A.mats.lamp, false, false);
  put(B.fx, A.mats.fx, false, false);
  return g;
}
