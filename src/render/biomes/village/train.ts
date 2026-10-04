import * as THREE from 'three';
import { TRAIN } from '../../../config';
import { Builder, cylTpl, place, Rng, type UVSpec } from './builder';
import { CREST, DOOR, img, sw, WINDOW } from './atlas';
import type { VillageMats } from './mats';
import { woodUV } from './props';
import { BODY_SU, DECAL, decalUV, GRAFFITI, WOOD } from './textures';
import { RAIL_HALF, RAIL_TOP } from './track';

/**
 * 和風木造列車（木板拼成的車廂、略圓弧的木板屋頂、手繪塗鴉）。
 * local 原點在列車前緣（靠玩家那端）中央地面，往 −z 延伸 length 公尺；
 * 一節 TRAIN.carLength 一節組裝，車廂之間有連結器。依 (length, variant, moving) 快取組好的模板，
 * 每次 buildObstacle 只 clone（共用幾何與材質）。
 *
 * 判定一致：寬 TRAIN.width、車頂最高點剛好 TRAIN.height（弧頂中央，玩家跑在上面）、
 * 車頂凸起物（通風口）不超過 0.12；排障器與緩衝器都不超過 z = 0。
 */

/** 半寬、車身牆面半寬（屋簷再外凸到 TRAIN.width / 2） */
const HW = TRAIN.width / 2;
const WALL_HW = HW - 0.045;
/** 車身牆面下緣、上緣 */
const BODY_Y0 = 0.86;
const BODY_Y1 = 2.92;
/** 屋頂弧：最高點 TRAIN.height、兩側 BODY_Y1 */
const ROOF_RISE = TRAIN.height - BODY_Y1;
const ROOF_R = (HW * HW + ROOF_RISE * ROOF_RISE) / (2 * ROOF_RISE);
const ROOF_ALPHA = Math.asin(HW / ROOF_R);
/** 車輪半徑（踩在軌頭上） */
const WHEEL_R = 0.38;
/** 車廂之間的間隙 */
const GAP = 0.5;

/** 弧頂在 x 處的高度 */
function roofY(x: number): number {
  return TRAIN.height - ROOF_R + Math.sqrt(Math.max(0, ROOF_R * ROOF_R - x * x));
}

/** 依配色挑塗鴉（藍車多浪花、綠車多葉子青蛙…） */
const FAVORITE: number[][] = [
  [DECAL.swirl, DECAL.nin, DECAL.ramen, DECAL.stars],
  [DECAL.leaf, DECAL.frog, DECAL.sakura, DECAL.swirl],
  [DECAL.wave, DECAL.stars, DECAL.shuriken, DECAL.wave],
  [DECAL.shuriken, DECAL.kunai, DECAL.logo, DECAL.nin],
];

/** 車身木板牆的四邊形（u 依公尺平鋪；v 佔滿貼圖高） */
function bodyQuad(b: Builder, mat: THREE.Material, a: number[], bq: number[], c: number[], d: number[], uA: number, uB: number): void {
  b.quad(mat, a, bq, c, d, [uA, 0.02, uB, 0.02, uB, 0.98, uA, 0.98]);
}

/** 貼花四邊形（貼在 x = ±wall 的側面上，朝外） */
function decalSide(b: Builder, m: VillageMats, side: number, zc: number, yc: number, w: number, h: number, uv: UVSpec): void {
  const x = side * (WALL_HW + 0.012);
  const za = zc + (side > 0 ? w / 2 : -w / 2);
  const zb = zc - (side > 0 ? w / 2 : -w / 2);
  // 右側（+x）從外面看右手邊是 −z，左側（−x）右手邊是 +z
  b.quadRect(m.decal, [x, yc - h / 2, za], [x, yc - h / 2, zb], [x, yc + h / 2, zb], [x, yc + h / 2, za], uv);
}

/** 一個轉向架（兩軸四輪） */
function bogie(b: Builder, m: VillageMats, zc: number): void {
  const wy = RAIL_TOP + WHEEL_R;
  const steel = sw('silver');
  for (const s of [-1, 1]) {
    // 側架
    b.bevel(m.metal, place(s * 0.9, wy + 0.04, zc), 0.12, 0.3, 2.3, 0.04, steel);
    for (const dz of [-0.85, 0.85]) {
      // 車輪（沿 x 軸的圓柱）＋輪轂
      b.geo(m.metal, cylTpl(18), place(s * RAIL_HALF, wy, zc + dz, 0, 0, Math.PI / 2, WHEEL_R, 0.11, WHEEL_R), null);
      b.geo(m.palette, cylTpl(12), place(s * (RAIL_HALF + 0.06), wy, zc + dz, 0, 0, Math.PI / 2, WHEEL_R * 0.55, 0.03, WHEEL_R * 0.55), sw('silver'));
      b.geo(m.palette, cylTpl(8), place(s * (RAIL_HALF + 0.08), wy, zc + dz, 0, 0, Math.PI / 2, 0.08, 0.04, 0.08), sw('red'));
      // 軸箱
      b.box(m.metal, place(s * 0.98, wy, zc + dz), 0.12, 0.2, 0.22, steel);
    }
    // 疊板彈簧
    b.box(m.palette, place(s * 0.9, wy + 0.25, zc), 0.14, 0.08, 1.0, sw('charcoal'));
  }
  // 車軸與枕梁
  for (const dz of [-0.85, 0.85]) b.geo(m.metal, cylTpl(8), place(0, wy, zc + dz, 0, 0, Math.PI / 2, 0.06, RAIL_HALF * 2, 0.06), null);
  b.box(m.metal, place(0, wy + 0.2, zc), 1.9, 0.16, 0.4, steel);
}

/** 車廂一端的緩衝樑、緩衝器、連結器 */
function carEnd(b: Builder, m: VillageMats, z: number, dir: number, coupler: boolean): void {
  // dir：+1 表示這端朝 +z（車頭方向）
  b.bevel(m.wood, place(0, 0.76, z + dir * 0.06), 2.1, 0.26, 0.14, 0.03, woodUV(WOOD.dark));
  for (const s of [-1, 1]) {
    b.geo(m.metal, cylTpl(10), place(s * 0.72, 0.76, z + dir * 0.14, 0, Math.PI / 2, 0, 0.06, 0.16, 0.06), null);
    b.geo(m.palette, cylTpl(12), place(s * 0.72, 0.76, z + dir * 0.215, 0, Math.PI / 2, 0, 0.13, 0.03, 0.13), sw('iron'));
  }
  if (coupler) b.box(m.metal, place(0, 0.74, z + dir * (GAP / 2 + 0.02)), 0.16, 0.14, GAP + 0.1, sw('steel'));
}

/** 一節車廂 */
function car(b: Builder, m: VillageMats, k: number, cars: number, variant: number, moving: boolean, rnd: Rng): void {
  const body = m.trainBody[variant];
  const z0 = -k * TRAIN.carLength;
  const z1 = -(k + 1) * TRAIN.carLength;
  const first = k === 0;
  const last = k === cars - 1;
  const zf = z0 - (first ? 0.24 : GAP / 2);
  const zb = z1 + (last ? 0.24 : GAP / 2);
  const zc = (zf + zb) / 2;
  const L = zf - zb;
  const y0 = BODY_Y0;
  const y1 = BODY_Y1;
  const su = BODY_SU;
  const dw = woodUV(WOOD.dark, rnd.f());

  // ── 車身四面木板牆 ──
  bodyQuad(b, body, [WALL_HW, y0, zf], [WALL_HW, y0, zb], [WALL_HW, y1, zb], [WALL_HW, y1, zf], -zf / su, -zb / su);
  bodyQuad(b, body, [-WALL_HW, y0, zb], [-WALL_HW, y0, zf], [-WALL_HW, y1, zf], [-WALL_HW, y1, zb], zb / su, zf / su);
  bodyQuad(b, body, [-WALL_HW, y0, zf], [WALL_HW, y0, zf], [WALL_HW, y1, zf], [-WALL_HW, y1, zf], -WALL_HW / su, WALL_HW / su);
  bodyQuad(b, body, [WALL_HW, y0, zb], [-WALL_HW, y0, zb], [-WALL_HW, y1, zb], [WALL_HW, y1, zb], -WALL_HW / su, WALL_HW / su);
  // 兩端屋頂弧下的半月形山牆（扇形三角形）
  const segs = 10;
  for (const [z, dir] of [[zf, 1], [zb, -1]] as const) {
    for (let i = 0; i < segs; i++) {
      const xa = -WALL_HW + (2 * WALL_HW * i) / segs;
      const xb = -WALL_HW + (2 * WALL_HW * (i + 1)) / segs;
      const pa = [xa, roofY(xa) - 0.02, z];
      const pb = [xb, roofY(xb) - 0.02, z];
      const pc = [0, y1, z];
      const uv = [xa / su, 0.98, xb / su, 0.98, 0, 0.9];
      if (dir > 0) b.triangle(body, pc, pb, pa, [uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]]);
      else b.triangle(body, pc, pa, pb, [uv[4], uv[5], uv[0], uv[1], uv[2], uv[3]]);
    }
  }
  // 車底板（從低角度看不會穿幫）
  b.quadRect(m.metal, [-WALL_HW, y0, zb], [WALL_HW, y0, zb], [WALL_HW, y0, zf], [-WALL_HW, y0, zf], sw('charcoal'));

  // ── 圓弧木板屋頂＋屋簷板＋通風口 ──
  const roofLen = L + 0.16;
  b.geo(
    body,
    tplRoof(),
    place(0, TRAIN.height - ROOF_R, zc, 0, -Math.PI / 2, 0, ROOF_R, roofLen, ROOF_R),
    { k: 'tile', su: su / roofLen, v0: 0.02, v1: 0.98 },
  );
  for (const s of [-1, 1]) {
    b.bevel(m.wood, place(s * (HW - 0.05), y1 - 0.02, zc), 0.1, 0.14, roofLen + 0.04, 0.03, dw);
  }
  for (const dz of [-L * 0.28, L * 0.28]) {
    for (const s of [-1, 1]) {
      const vx = s * 0.55;
      b.bevel(m.palette, place(vx, roofY(vx) + 0.035, zc + dz), 0.32, 0.09, 0.5, 0.03, sw('iron'));
    }
  }

  // ── 木框：四角柱、上下橫樑、側面直撐 ──
  const hpost = y1 - y0 + 0.08;
  for (const s of [-1, 1]) {
    for (const z of [zf - 0.07, zb + 0.07]) b.bevel(m.wood, place(s * (WALL_HW - 0.035), (y0 + y1) / 2, z), 0.16, hpost, 0.16, 0.04, dw);
    b.bevel(m.wood, place(s * (WALL_HW - 0.005), y0 + 0.07, zc), 0.1, 0.16, L, 0.03, dw);
    b.bevel(m.wood, place(s * WALL_HW, y1 - 0.08, zc), 0.08, 0.12, L, 0.03, dw);
    for (const z of [zf - 2.3, zb + 2.3]) b.bevel(m.wood, place(s * (WALL_HW + 0.008), (y0 + y1) / 2, z), 0.07, y1 - y0, 0.12, 0.025, dw);
  }

  // ── 側面：拉門、小窗、塗鴉、車號 ──
  const doorZ = zc + rnd.range(-0.4, 0.4);
  const winKind = rnd.chance(0.35) ? WINDOW.trainNoren : WINDOW.train;
  for (const s of [-1, 1]) {
    const x = s * (WALL_HW + 0.015);
    // 拉門（深色亮光漆木門）＋門框＋門軌
    const dz0 = doorZ - 0.6;
    const dz1 = doorZ + 0.6;
    if (s > 0) b.quadRect(m.palette, [x, y0 + 0.08, dz1], [x, y0 + 0.08, dz0], [x, y0 + 1.82, dz0], [x, y0 + 1.82, dz1], img('door', DOOR.train, 2));
    else b.quadRect(m.palette, [x, y0 + 0.08, dz0], [x, y0 + 0.08, dz1], [x, y0 + 1.82, dz1], [x, y0 + 1.82, dz0], img('door', DOOR.train, 2));
    for (const z of [dz0 - 0.05, dz1 + 0.05]) b.box(m.wood, place(s * (WALL_HW + 0.02), y0 + 0.95, z), 0.05, 1.8, 0.1, dw);
    b.box(m.metal, place(s * (WALL_HW + 0.02), y0 + 1.9, doorZ), 0.05, 0.08, 2.6, sw('steel'));
    // 兩扇小窗
    for (const wz of [zf - 1.25, zb + 1.25]) {
      const ww = 0.8;
      const wy0 = 1.98;
      const wy1 = 2.6;
      const xw = s * (WALL_HW + 0.012);
      if (s > 0) b.quadRect(m.palette, [xw, wy0, wz + ww / 2], [xw, wy0, wz - ww / 2], [xw, wy1, wz - ww / 2], [xw, wy1, wz + ww / 2], img('window', winKind, 3));
      else b.quadRect(m.palette, [xw, wy0, wz - ww / 2], [xw, wy0, wz + ww / 2], [xw, wy1, wz + ww / 2], [xw, wy1, wz - ww / 2], img('window', winKind, 3));
      const fx = s * (WALL_HW + 0.02);
      b.box(m.wood, place(fx, wy1 + 0.04, wz), 0.05, 0.08, ww + 0.16, dw);
      b.box(m.wood, place(fx, wy0 - 0.04, wz), 0.05, 0.08, ww + 0.16, dw);
      for (const dz of [-ww / 2 - 0.04, ww / 2 + 0.04]) b.box(m.wood, place(fx, (wy0 + wy1) / 2, wz + dz), 0.05, wy1 - wy0, 0.08, dw);
    }
    // 塗鴉：門的兩側各一塊（大小、圖案隨機）
    const fav = FAVORITE[variant];
    for (const [za, zb2] of [
      [zf - 0.3, doorZ + 0.75],
      [doorZ - 0.75, zb + 0.3],
    ]) {
      const span = za - zb2;
      if (span < 1.0 || rnd.chance(0.18)) continue;
      const w = Math.min(span - 0.1, rnd.range(1.3, 2.0));
      const zc2 = zb2 + span / 2 + rnd.range(-0.2, 0.2) * Math.max(0, span - w);
      const h = Math.min(1.25, w * rnd.range(0.75, 0.95));
      const pick = rnd.chance(0.7) ? rnd.pick(fav) : rnd.pick(GRAFFITI);
      decalSide(b, m, s, zc2, y0 + 0.2 + h / 2, w, h, decalUV(pick));
    }
    // 車號牌
    decalSide(b, m, s, doorZ + (s > 0 ? -1 : 1) * 0.95, y0 + 1.62, 0.5, 0.36, decalUV(DECAL.numbers, (variant + k) % 4));
  }

  // ── 車底：底樑、設備箱、轉向架 ──
  for (const s of [-1, 1]) b.box(m.metal, place(s * 0.95, y0 - 0.11, zc), 0.1, 0.22, L - 0.2, sw('iron'));
  b.box(m.metal, place(0, y0 - 0.22, zc), 1.3, 0.3, 2.2, sw('iron'));
  bogie(b, m, zf - 2.0);
  bogie(b, m, zb + 2.0);

  // ── 兩端 ──
  carEnd(b, m, zf, 1, !first);
  carEnd(b, m, zb, -1, false);
  if (first) cabFront(b, m, zf, moving, variant);
  if (last) {
    // 車尾：兩盞紅色尾燈
    for (const s of [-1, 1]) b.geo(m.palette, cylTpl(10), place(s * 0.7, 1.3, zb - 0.03, 0, Math.PI / 2, 0, 0.09, 0.06, 0.09), sw('red'));
  }
}

/** 車頭（第一節的 +z 端）：頭燈、前窗、目的地牌、家徽、排障器 */
function cabFront(b: Builder, m: VillageMats, zf: number, moving: boolean, variant: number): void {
  const z = zf + 0.01;
  // 兩扇前窗
  for (const s of [-1, 1]) {
    const x0 = s * 0.5 - 0.3;
    const x1 = s * 0.5 + 0.3;
    b.quadRect(m.palette, [x0, 1.98, z], [x1, 1.98, z], [x1, 2.5, z], [x0, 2.5, z], img('window', WINDOW.train, 3));
    b.box(m.wood, place(s * 0.5, 2.54, z + 0.03), 0.72, 0.08, 0.06, woodUV(WOOD.dark));
    b.box(m.wood, place(s * 0.5, 1.94, z + 0.03), 0.72, 0.08, 0.06, woodUV(WOOD.dark));
  }
  // 目的地牌（忍急 木ノ葉行）
  b.quadRect(m.palette, [-0.62, 2.62, z + 0.02], [0.62, 2.62, z + 0.02], [0.62, 2.86, z + 0.02], [-0.62, 2.86, z + 0.02], img('hsign', 6, 2));
  // 家徽
  const crest = [CREST.fire, CREST.leaf, CREST.swirl, CREST.nin][variant];
  b.geo(m.palette, cylTpl(20), place(0, 1.45, z + 0.03, 0, Math.PI / 2, 0, 0.3, 0.05, 0.3), img('crest', crest, 2));
  // 頭燈（兩盞）＋燈框；迎面列車亮燈，另加車頂中央一盞
  const lamp = moving ? m.headOn : m.palette;
  const lampUV = moving ? null : sw('cream');
  for (const s of [-1, 1]) {
    b.geo(m.palette, cylTpl(14), place(s * 0.72, 1.32, z + 0.05, 0, Math.PI / 2, 0, 0.19, 0.1, 0.19), sw('chrome'));
    b.geo(lamp, cylTpl(14), place(s * 0.72, 1.32, z + 0.11, 0, Math.PI / 2, 0, 0.15, 0.03, 0.15), lampUV);
  }
  if (moving) {
    b.geo(m.palette, cylTpl(14), place(0, 2.98, z + 0.04, 0, Math.PI / 2, 0, 0.16, 0.12, 0.16), sw('chrome'));
    b.geo(m.headOn, cylTpl(14), place(0, 2.98, z + 0.11, 0, Math.PI / 2, 0, 0.12, 0.03, 0.12), null);
    // 排障器：V 字形鐵板，尖端在 z ≈ −0.05、兩翼往後到 z ≈ −0.6，不超出列車前緣
    for (const s of [-1, 1]) {
      b.box(m.metal, place(s * 0.5, 0.42, -0.33, s * 0.5, 0, 0), 1.14, 0.42, 0.05, sw('iron'));
      b.box(m.palette, place(s * 0.5, 0.66, -0.33, s * 0.5, 0, 0), 1.14, 0.07, 0.07, sw('red'));
    }
  }
}

/** 屋頂弧的模板（開口圓柱的一段，軸向 y、長 1） */
function tplRoof(): THREE.BufferGeometry {
  return roofGeo ?? (roofGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true, -ROOF_ALPHA, ROOF_ALPHA * 2));
}
let roofGeo: THREE.BufferGeometry | null = null;

/** 已組好的列車模板 */
const trainCache = new Map<string, THREE.Group>();

/** 建立（或從快取複製）一列木造列車 */
export function buildTrain(m: VillageMats, length: number, variant: number, moving: boolean): THREE.Object3D {
  const v = ((variant % 4) + 4) % 4;
  const cars = Math.max(1, Math.round(length / TRAIN.carLength));
  const key = `${cars}|${v}|${moving ? 1 : 0}`;
  let tpl = trainCache.get(key);
  if (!tpl) {
    const b = new Builder();
    const rnd = new Rng(1000 + v * 97 + cars * 13 + (moving ? 7 : 0));
    for (let k = 0; k < cars; k++) car(b, m, k, cars, v, moving, rnd);
    tpl = b.toGroup('village-train');
    trainCache.set(key, tpl);
  }
  return tpl.clone();
}
