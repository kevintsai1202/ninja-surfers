import * as THREE from 'three';
import { Builder, coneTpl, cylTpl, icoTpl, place, Rng, SKIP_BOTTOM, sphereTpl, tpl, type UVSpec } from './builder';
import { CREST, img, LANTERN, MISC, sw, VSIGN_BOARDS, VSIGN_FLAGS, type SwatchName } from './atlas';
import type { VillageMats } from './mats';
import { STREET_Y } from './track';
import { tileBand, WALL, WALL_BANDS, WOOD, WOOD_BANDS, WOOD_SU } from './textures';

/**
 * 街道小道具（全部寫進 Builder，最後依材質合併）：
 * 燈籠（搖擺）、電線桿與下垂電線、路燈、盆栽、木箱、木桶、防火水桶、長椅與和傘、郵筒、花箱、
 * 櫻花與松樹、鳥居、石燈籠、屋頂水塔、晾衣竿、幟旗（搖擺）。
 *
 * 座標約定（側邊座標系）：x 往外（離開軌道）為正、建築正面朝 −x，z 沿軌道（0 → −30），y 向上。
 * 左側街景由呼叫端把 Builder.frame 設成「繞 y 轉 180°」的座標系，同一套程式就能畫兩側。
 */

/** 半球模板（水塔圓頂、郵筒頂）：只有上半球，省一半三角形 */
function domeTpl(): THREE.BufferGeometry {
  return tpl('dome|14|4', () => new THREE.SphereGeometry(1, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2));
}

/** 木材平鋪 UV（色帶 i；uo 讓每根木料的木紋位置不同） */
export function woodUV(i: number, uo = 0): UVSpec {
  return { ...tileBand(WOOD_SU, i, WOOD_BANDS), uo };
}

/** 牆面平鋪 UV（色帶 i） */
export function wallUV(i: number, su = 4, uo = 0): UVSpec {
  return { ...tileBand(su, i, WALL_BANDS), uo };
}

/** 圓柱模板的木紋 UV：u 沿高度依公尺平鋪（h 是圓柱高度） */
function woodCylUV(i: number, h: number): UVSpec {
  const t = tileBand(WOOD_SU, i, WOOD_BANDS);
  return { k: 'tile', su: 1 / Math.max(0.01, h / WOOD_SU), v0: t.v0, v1: t.v1 };
}

/** 直立圓柱（底部在 y） */
export function cyl(b: Builder, mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, uv: UVSpec | null, radial = 12): void {
  b.geo(mat, cylTpl(radial), place(x, y + h / 2, z, 0, 0, 0, r, h, r), uv);
}

/** 圓台（底半徑 r、頂半徑 r × top） */
export function cone(b: Builder, mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, top: number, uv: UVSpec | null, radial = 12): void {
  b.geo(mat, coneTpl(top, radial), place(x, y + h / 2, z, 0, 0, 0, r, h, r), uv);
}

/** 沿 x 軸躺著的圓柱（中心點） */
function cylX(b: Builder, mat: THREE.Material, x: number, y: number, z: number, r: number, len: number, uv: UVSpec | null, radial = 10): void {
  b.geo(mat, cylTpl(radial), place(x, y, z, 0, 0, Math.PI / 2, r, len, r), uv);
}

/** 沿 z 軸躺著的圓柱（中心點） */
function cylZ(b: Builder, mat: THREE.Material, x: number, y: number, z: number, r: number, len: number, uv: UVSpec | null, radial = 10): void {
  b.geo(mat, cylTpl(radial), place(x, y, z, 0, Math.PI / 2, 0, r, len, r), uv);
}

/** 拋物線下垂的線（電線、燈籠繩），回傳線上的點 */
function sagPoints(p0: number[], p1: number[], sag: number, segs: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    pts.push([p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s - sag * 4 * s * (1 - s), p0[2] + (p1[2] - p0[2]) * s]);
  }
  return pts;
}

/** 畫一條下垂的線 */
export function wire(b: Builder, mat: THREE.Material, p0: number[], p1: number[], sag: number, w: number, uv: UVSpec, segs = 6): void {
  b.tube(mat, sagPoints(p0, p1, sag, segs), w, uv);
}

// ───────────────────────────── 燈籠 ─────────────────────────────

/**
 * 紅燈籠（會搖擺）：樞紐在吊繩頂端。
 * @param yTop 吊點高度
 * @param s 尺寸倍率（1 ≈ 直徑 0.44 m、高 0.6 m）
 */
export function lantern(b: Builder, m: VillageMats, x: number, yTop: number, z: number, kind: number, s: number, rnd: Rng): void {
  const cord = 0.16 * s;
  const ry = 0.3 * s;
  const rr = 0.22 * s;
  b.setSway(x, yTop, z, rnd.range(0.05, 0.1), rnd.range(1.3, 2.1), rnd.range(0, Math.PI * 2));
  const cy = yTop - cord - ry;
  b.box(m.sway, place(x, yTop - cord / 2, z), 0.025, cord, 0.025, sw('black'));
  b.geo(m.sway, sphereTpl(10, 7), place(x, cy, z, 0, 0, 0, rr, ry, rr), img('lantern', kind, 1));
  b.geo(m.sway, cylTpl(8), place(x, cy + ry * 0.9, z, 0, 0, 0, rr * 0.6, 0.07 * s, rr * 0.6), sw('black'));
  b.geo(m.sway, cylTpl(8), place(x, cy - ry * 0.9, z, 0, 0, 0, rr * 0.6, 0.07 * s, rr * 0.6), sw('black'));
  b.box(m.sway, place(x, cy - ry - 0.07 * s, z), 0.05 * s, 0.12 * s, 0.05 * s, sw('gold'));
}

/** 一串燈籠：繩子（靜態）＋等距掛的燈籠 */
export function lanternString(b: Builder, m: VillageMats, p0: number[], p1: number[], sag: number, count: number, rnd: Rng, kind = -1): void {
  const pts = sagPoints(p0, p1, sag, 8);
  b.tube(m.palette, pts, 0.03, sw('charcoal'));
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) / count;
    const x = p0[0] + (p1[0] - p0[0]) * s;
    const y = p0[1] + (p1[1] - p0[1]) * s - sag * 4 * s * (1 - s);
    const z = p0[2] + (p1[2] - p0[2]) * s;
    const k = kind >= 0 ? kind : rnd.chance(0.75) ? LANTERN.matsuri : rnd.int(0, 3);
    lantern(b, m, x, y, z, k, rnd.range(0.85, 1.05), rnd);
  }
}

/** 三角旗串（會搖擺）：沿 x 方向的繩子，旗面朝 +z */
export function bunting(b: Builder, m: VillageMats, p0: number[], p1: number[], sag: number, rnd: Rng): void {
  const pts = sagPoints(p0, p1, sag, 8);
  b.tube(m.palette, pts, 0.025, sw('charcoal'));
  const colors: SwatchName[] = ['clothRed', 'clothYellow', 'clothBlue', 'clothWhite', 'clothGreen', 'orange', 'pink'];
  const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  const n = Math.floor(len / 0.55);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n;
    const x = p0[0] + (p1[0] - p0[0]) * s;
    const y = p0[1] + (p1[1] - p0[1]) * s - sag * 4 * s * (1 - s);
    const z = p0[2] + (p1[2] - p0[2]) * s;
    b.setSway(x, y, z, rnd.range(0.1, 0.18), rnd.range(2, 3), rnd.range(0, 6.28));
    const c = sw(colors[i % colors.length]);
    const uv = c.k === 'pt' ? [c.u, c.v, c.u, c.v, c.u, c.v] : [0, 0, 0, 0, 0, 0];
    // 正反兩面（從前方與後方都看得到）
    b.triangle(m.sway, [x - 0.2, y, z], [x + 0.2, y, z], [x, y - 0.38, z], uv);
    b.triangle(m.sway, [x + 0.2, y, z], [x - 0.2, y, z], [x, y - 0.38, z], uv);
  }
}

// ───────────────────────────── 電線桿 ─────────────────────────────

/** 電線桿的位置（側邊座標系） */
export const POLE_X = 5.55;
export const POLE_ZS = [-7.5, -22.5];
/** 電線桿頂端高度 */
export const POLE_TOP = STREET_Y + 9.4;
/** 電線掛點（相對於電線桿的 x 偏移、高度） */
export const WIRE_PTS: [number, number][] = [
  [-0.62, POLE_TOP - 0.42],
  [0, POLE_TOP - 0.42],
  [0.62, POLE_TOP - 0.42],
  [0.3, POLE_TOP - 1.55],
];

/** 木造電線桿：桿身、黃黑防撞護套、橫擔、礙子、變壓器、腳踏釘、號碼牌 */
export function pole(b: Builder, m: VillageMats, x: number, z: number, rnd: Rng, transformer: boolean): void {
  const h = POLE_TOP - STREET_Y;
  cone(b, m.wood, x, STREET_Y, z, 0.16, h, 0.75, woodCylUV(WOOD.dark, h), 10);
  // 底部護套（黃底黑環）
  cyl(b, m.palette, x, STREET_Y, z, 0.175, 1.7, sw('hazardYellow'), 10);
  for (const y of [0.45, 1.15]) cyl(b, m.palette, x, STREET_Y + y, z, 0.178, 0.22, sw('black'), 10);
  // 橫擔（沿 x）與礙子
  b.bevel(m.wood, place(x, POLE_TOP - 0.55, z), 1.6, 0.12, 0.12, 0.025, woodUV(WOOD.dark, rnd.f()));
  for (const [dx] of WIRE_PTS.slice(0, 3)) {
    cone(b, m.palette, x + dx, POLE_TOP - 0.49, z, 0.05, 0.13, 0.55, sw('ivory'), 6);
  }
  b.bevel(m.wood, place(x + 0.15, POLE_TOP - 1.62, z), 0.8, 0.1, 0.1, 0.02, woodUV(WOOD.dark, rnd.f()));
  // 斜撐
  b.box(m.wood, place(x - 0.35, POLE_TOP - 0.85, z, 0, 0, 0.75), 0.05, 0.6, 0.05, woodUV(WOOD.dark));
  if (transformer) {
    // 變壓器：灰色圓筒＋上蓋＋兩根套管
    cyl(b, m.palette, x + 0.42, POLE_TOP - 3.1, z, 0.3, 0.75, sw('tankSteel'), 12);
    cone(b, m.palette, x + 0.42, POLE_TOP - 2.35, z, 0.31, 0.1, 0.8, sw('silver'), 12);
    for (const dz of [-0.12, 0.12]) cyl(b, m.palette, x + 0.42, POLE_TOP - 2.25, z + dz, 0.035, 0.14, sw('ivory'), 6);
    b.box(m.palette, place(x + 0.22, POLE_TOP - 2.8, z), 0.12, 0.08, 0.3, sw('iron'));
  }
  // 腳踏釘
  for (let i = 0; i < 4; i++) {
    const y = STREET_Y + 2.4 + i * 0.7;
    const s = i % 2 === 0 ? 1 : -1;
    b.box(m.palette, place(x, y, z + s * 0.2), 0.03, 0.03, 0.22, sw('iron'));
  }
  // 號碼牌
  b.box(m.palette, place(x - 0.17, STREET_Y + 2.0, z), 0.02, 0.36, 0.16, sw('ivory'), { faces: [undefined, sw('blue')] });
}

// ───────────────────────────── 路燈 ─────────────────────────────

/** 和風路燈：黑鐵柱、六角燈籠形燈罩（自發光）、小屋頂 */
export function streetLamp(b: Builder, m: VillageMats, x: number, z: number): void {
  const y0 = STREET_Y;
  cyl(b, m.palette, x, y0, z, 0.14, 0.3, sw('charcoal'), 8);
  cyl(b, m.palette, x, y0 + 0.3, z, 0.06, 3.1, sw('charcoal'), 8);
  // 燈罩（六角柱，亮燈）＋框
  cyl(b, m.palette, x, y0 + 3.4, z, 0.2, 0.42, sw('lampOn'), 6);
  for (const y of [3.38, 3.82]) cyl(b, m.palette, x, y0 + y, z, 0.23, 0.05, sw('charcoal'), 6);
  // 小屋頂與寶珠
  cone(b, m.palette, x, y0 + 3.86, z, 0.34, 0.22, 0.12, sw('charcoal'), 6);
  b.geo(m.palette, sphereTpl(8, 6), place(x, y0 + 4.12, z, 0, 0, 0, 0.06, 0.06, 0.06), sw('gold'));
}

// ───────────────────────────── 小道具 ─────────────────────────────

/** 盆栽松（陶盆＋彎曲樹幹＋扁平的雲朵狀樹冠） */
export function bonsai(b: Builder, m: VillageMats, x: number, y: number, z: number, s: number, rnd: Rng): void {
  const pot: SwatchName = rnd.pick(['indigo', 'terracotta', 'teal', 'charcoal']);
  cone(b, m.palette, x, y, z, 0.32 * s, 0.32 * s, 1.18, sw(pot), 8);
  cyl(b, m.palette, x, y + 0.3 * s, z, 0.36 * s, 0.05 * s, sw(pot), 8);
  cyl(b, m.palette, x, y + 0.33 * s, z, 0.33 * s, 0.02, sw('soil'), 8);
  // 樹幹：兩段彎曲
  const lean = rnd.range(-0.4, 0.4);
  b.geo(m.palette, coneTpl(0.6, 6), place(x, y + 0.6 * s, z, 0, 0, lean, 0.07 * s, 0.6 * s, 0.07 * s), sw('bark'));
  b.geo(m.palette, coneTpl(0.6, 6), place(x - Math.sin(lean) * 0.5 * s, y + 1.05 * s, z, 0, 0, -lean * 1.2, 0.05 * s, 0.5 * s, 0.05 * s), sw('bark'));
  const pads = 3 + rnd.int(0, 1);
  for (let i = 0; i < pads; i++) {
    const px = x + rnd.range(-0.35, 0.35) * s;
    const py = y + (0.85 + i * 0.25) * s;
    const pz = z + rnd.range(-0.3, 0.3) * s;
    const r = (0.32 - i * 0.04) * s;
    b.geo(m.palette, icoTpl(0), place(px, py, pz, rnd.f() * 3, 0, 0, r, r * 0.5, r), img('misc', MISC.pine, 3));
  }
}

/** 木箱（倒角、側面印字） */
export function crate(b: Builder, m: VillageMats, x: number, y: number, z: number, s: number, ry: number, rnd: Rng): void {
  const uv = woodUV(WOOD.light, rnd.f());
  b.bevel(m.wood, place(x, y + s / 2, z, ry), s, s, s, 0.05 * s, uv, { skip: SKIP_BOTTOM });
  // 邊框木條（四個直角邊）
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      b.box(m.wood, place(x + (dx * s) / 2 - dx * 0.03 * s, y + s / 2, z + (dz * s) / 2 - dz * 0.03 * s, ry), 0.09 * s, s * 1.002, 0.09 * s, woodUV(WOOD.mid, rnd.f()));
    }
  }
  // 正面印字
  b.box(m.palette, place(x - (s / 2 + 0.004) * Math.cos(ry), y + s / 2, z + (s / 2 + 0.004) * Math.sin(ry), ry), 0.004, s * 0.55, s * 0.75, img('misc', MISC.crate, 3));
}

/** 木桶（木紋圓桶＋三道鐵箍＋桶蓋） */
export function barrel(b: Builder, m: VillageMats, x: number, y: number, z: number, r: number, h: number): void {
  b.geo(m.wood, coneTpl(0.92, 12, true), place(x, y + h * 0.25, z, 0, 0, 0, r * 1.0, h * 0.5, r * 1.0), woodCylUV(WOOD.mid, h * 0.5));
  b.geo(m.wood, coneTpl(1 / 0.92, 12, true), place(x, y + h * 0.75, z, 0, 0, 0, r * 0.92, h * 0.5, r * 0.92), woodCylUV(WOOD.mid, h * 0.5));
  for (const t of [0.14, 0.86]) cyl(b, m.palette, x, y + h * t - 0.04, z, r * 0.975, 0.08, sw('iron'), 12);
  cyl(b, m.wood, x, y + h - 0.02, z, r * 0.92, 0.04, woodUV(WOOD.dark), 12);
}

/** 防火水桶：紅色水桶疊成金字塔，放在木架上 */
export function fireBuckets(b: Builder, m: VillageMats, x: number, z: number): void {
  const y = STREET_Y;
  b.box(m.wood, place(x, y + 0.2, z), 0.5, 0.4, 0.9, woodUV(WOOD.dark));
  const pos: [number, number, number][] = [
    [0, 0.4, -0.27],
    [0, 0.4, 0],
    [0, 0.4, 0.27],
    [0, 0.68, -0.135],
    [0, 0.68, 0.135],
    [0, 0.96, 0],
  ];
  for (const [dx, dy, dz] of pos) {
    cone(b, m.palette, x + dx, y + dy, z + dz, 0.11, 0.26, 1.3, sw('red'), 8);
  }
}

/** 長椅（縁台：木腳＋紅毯）＋和傘 */
export function benchUmbrella(b: Builder, m: VillageMats, x: number, z: number, rnd: Rng): void {
  const y = STREET_Y;
  b.bevel(m.wood, place(x, y + 0.42, z), 0.8, 0.08, 1.8, 0.02, woodUV(WOOD.mid, rnd.f()));
  for (const dz of [-0.75, 0.75]) for (const dx of [-0.32, 0.32]) b.box(m.wood, place(x + dx, y + 0.2, z + dz), 0.07, 0.4, 0.07, woodUV(WOOD.dark));
  b.box(m.palette, place(x, y + 0.47, z), 0.84, 0.02, 1.4, sw('red'));
  // 和傘：竹柄＋圓錐傘面（紅）＋傘骨環
  const ux = x + 0.15;
  const uz = z + 0.55;
  cyl(b, m.palette, ux, y, uz, 0.025, 2.2, sw('bamboo'), 6);
  cone(b, m.palette, ux, y + 2.05, uz, 1.0, 0.42, 0.04, sw('vermilion'), 16);
  cone(b, m.palette, ux, y + 2.04, uz, 1.02, 0.03, 0.97, sw('cream'), 16);
}

/** 圓筒郵筒（紅色＋圓頂＋投信口） */
export function mailbox(b: Builder, m: VillageMats, x: number, z: number): void {
  const y = STREET_Y;
  cyl(b, m.palette, x, y, z, 0.2, 0.25, sw('charcoal'), 12);
  cyl(b, m.palette, x, y + 0.25, z, 0.24, 0.95, sw('mailRed'), 14);
  b.geo(m.palette, domeTpl(), place(x, y + 1.2, z, 0, 0, 0, 0.26, 0.14, 0.26), sw('mailRed'));
  cyl(b, m.palette, x, y + 1.18, z, 0.27, 0.05, sw('darkRed'), 14);
  b.box(m.palette, place(x - 0.235, y + 1.0, z), 0.02, 0.06, 0.2, sw('black'));
}

/** 花箱（木箱裡種滿綠葉與小花） */
export function planter(b: Builder, m: VillageMats, x: number, z: number, len: number, rnd: Rng): void {
  const y = STREET_Y;
  b.bevel(m.wood, place(x, y + 0.25, z), 0.55, 0.5, len, 0.04, woodUV(WOOD.mid, rnd.f()), { skip: SKIP_BOTTOM });
  const n = Math.max(2, Math.round(len / 0.45));
  for (let i = 0; i < n; i++) {
    const zz = z - len / 2 + ((i + 0.5) * len) / n;
    const r = rnd.range(0.22, 0.3);
    b.geo(m.palette, icoTpl(1), place(x, y + 0.52, zz, rnd.f() * 3, 0, 0, r, r * 0.8, r), img('misc', MISC.leaves, 3));
    const fc = sw(rnd.pick(['flowerRed', 'flowerYellow', 'flowerWhite', 'pink', 'flowerBlue'] as SwatchName[]));
    for (let k = 0; k < 2; k++) {
      b.geo(m.palette, icoTpl(0), place(x + rnd.range(-0.15, 0.15), y + 0.66 + rnd.f() * 0.12, zz + rnd.range(-0.15, 0.15), 0, 0, 0, 0.07, 0.07, 0.07), fc);
    }
  }
}

/** 幟旗（會搖擺）：竹竿＋直式布旗 */
export function nobori(b: Builder, m: VillageMats, x: number, z: number, rnd: Rng): void {
  const y = STREET_Y;
  cyl(b, m.palette, x, y, z, 0.03, 3.2, sw('bamboo'), 6);
  b.box(m.palette, place(x, y + 3.0, z - 0.22), 0.03, 0.03, 0.5, sw('bamboo'));
  const flag = VSIGN_BOARDS + rnd.int(0, VSIGN_FLAGS - 1);
  b.setSway(x, y + 3.0, z - 0.22, rnd.range(0.03, 0.06), rnd.range(1.6, 2.4), rnd.range(0, 6.28));
  // 布旗兩面都貼圖（兩側的人行道都看得到）
  b.box(m.sway, place(x, y + 2.0, z - 0.25), 0.012, 1.95, 0.46, sw('clothWhite'), {
    faces: [img('vsign', flag), img('vsign', flag), undefined, undefined, undefined, undefined],
  });
}

/** 立式看板（A 字型招牌） */
export function standSign(b: Builder, m: VillageMats, x: number, z: number, rnd: Rng): void {
  const y = STREET_Y;
  const k = rnd.int(0, VSIGN_BOARDS - 1);
  b.bevel(m.wood, place(x, y + 0.65, z), 0.08, 1.3, 0.42, 0.02, woodUV(WOOD.dark), {
    faces: [img('vsign', k), img('vsign', k), undefined, undefined, undefined, undefined],
    edge: sw('darkWood'),
  });
  b.box(m.wood, place(x + 0.25, y + 0.6, z, 0, 0, -0.35), 0.05, 1.25, 0.05, woodUV(WOOD.dark));
}

// ───────────────────────────── 樹 ─────────────────────────────

/** 櫻花樹：彎曲樹幹＋分枝＋粉紅花團 */
export function sakura(b: Builder, m: VillageMats, x: number, y: number, z: number, s: number, rnd: Rng): void {
  const lean = rnd.range(-0.2, 0.2);
  b.geo(m.palette, coneTpl(0.7, 8), place(x, y + 1.2 * s, z, 0, 0, lean, 0.2 * s, 2.4 * s, 0.2 * s), sw('darkBark'));
  const top = [x - Math.sin(lean) * 2.3 * s, y + 2.35 * s, z];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd.f();
    b.geo(m.palette, coneTpl(0.5, 6), place(top[0] + Math.cos(a) * 0.5 * s, top[1] + 0.5 * s, top[2] + Math.sin(a) * 0.5 * s, -a, 0, 0.8, 0.09 * s, 1.3 * s, 0.09 * s), sw('darkBark'));
  }
  // 花團：中央兩團大的＋外圈與上層一圈圈較小、高低錯落的花團，讓樹冠輪廓蓬鬆有起伏
  const blobs = 13;
  for (let i = 0; i < blobs; i++) {
    const ring = i < 2 ? 0 : i < 9 ? 1 : 2;
    const a = (i / 7) * Math.PI * 2 + rnd.f() * 0.6;
    const rad = (ring === 0 ? rnd.range(0, 0.4) : ring === 1 ? rnd.range(1.3, 1.9) : rnd.range(0.6, 1.1)) * s;
    const r = (ring === 0 ? rnd.range(1.0, 1.2) : rnd.range(0.55, 0.8)) * s;
    const yy = (ring === 0 ? 1.1 : ring === 1 ? rnd.range(0.5, 1.1) : rnd.range(1.6, 2.0)) * s;
    b.geo(
      m.palette,
      icoTpl(1),
      place(top[0] + Math.cos(a) * rad, top[1] + yy, top[2] + Math.sin(a) * rad, rnd.f() * 6, rnd.f(), 0, r, r * 0.78, r),
      img('misc', MISC.sakura, 3),
    );
  }
}

/** 松樹：斜長樹幹＋數層扁平雲朵狀針葉團 */
export function pine(b: Builder, m: VillageMats, x: number, y: number, z: number, s: number, rnd: Rng): void {
  const h = 4.2 * s;
  b.geo(m.palette, coneTpl(0.55, 8), place(x, y + h / 2, z, 0, 0, rnd.range(-0.12, 0.12), 0.2 * s, h, 0.2 * s), sw('bark'));
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = (1.5 - t * 0.85) * s;
    const yy = y + (1.8 + t * 2.6) * s;
    const ox = rnd.range(-0.4, 0.4) * s;
    const oz = rnd.range(-0.4, 0.4) * s;
    b.geo(m.palette, icoTpl(1), place(x + ox, yy, z + oz, rnd.f() * 6, 0, 0, r, r * 0.42, r), img('misc', MISC.pine, 3));
  }
}

/** 遠處的樹（便宜版）：圓錐杉樹或圓球闊葉樹 */
export function farTree(b: Builder, m: VillageMats, x: number, y: number, z: number, s: number, rnd: Rng): void {
  if (rnd.chance(0.55)) {
    cyl(b, m.palette, x, y, z, 0.14 * s, 1.2 * s, sw('bark'), 5);
    b.geo(m.palette, coneTpl(0, 7), place(x, y + 3.0 * s, z, rnd.f() * 6, 0, 0, 1.3 * s, 4.2 * s, 1.3 * s), img('misc', MISC.pine, 3));
  } else {
    cyl(b, m.palette, x, y, z, 0.16 * s, 1.6 * s, sw('bark'), 5);
    const r = rnd.range(1.4, 1.9) * s;
    b.geo(m.palette, icoTpl(0), place(x, y + 1.6 * s + r * 0.8, z, rnd.f() * 6, 0, 0, r, r * 0.9, r), img('misc', MISC.leaves, 3));
  }
}

// ───────────────────────────── 神社 ─────────────────────────────

/** 朱紅鳥居：兩根柱子、上方反翹的笠木、貫、中央額束（家徽） */
export function torii(b: Builder, m: VillageMats, x: number, y: number, z: number, span: number, h: number, rnd: Rng): void {
  const red = woodUV(WOOD.vermilion, rnd.f());
  for (const dz of [-span / 2, span / 2]) {
    b.geo(m.wood, coneTpl(0.85, 12), place(x, y + h / 2, z + dz, 0, 0, 0, 0.17, h, 0.17), woodCylUV(WOOD.vermilion, h));
    cyl(b, m.palette, x, y, z + dz, 0.22, 0.3, sw('charcoal'), 12);
  }
  // 貫（下橫木）
  b.bevel(m.wood, place(x, y + h - 0.85, z), 0.16, 0.2, span + 0.7, 0.03, red);
  // 島木（朱）＋笠木（黑，兩端往上翹：中段＋兩端斜段）
  b.bevel(m.wood, place(x, y + h - 0.1, z), 0.3, 0.2, span + 1.1, 0.04, red);
  b.bevel(m.palette, place(x, y + h + 0.12, z), 0.38, 0.22, span + 0.9, 0.05, sw('black'));
  for (const s2 of [-1, 1]) {
    // 繞 x 軸轉負角時 +z 端會往上；兩端各自朝外翹起
    b.bevel(m.palette, place(x, y + h + 0.2, z + s2 * (span / 2 + 0.72), 0, -s2 * 0.22, 0), 0.38, 0.2, 0.75, 0.05, sw('black'));
  }
  // 額束（中央的牌子）
  b.box(m.wood, place(x, y + h - 0.47, z), 0.12, 0.6, 0.18, red);
  b.box(m.palette, place(x - 0.07, y + h - 0.47, z), 0.02, 0.36, 0.36, img('crest', CREST.fire));
}

/** 石燈籠（台座、竿、火袋、笠、寶珠） */
export function stoneLantern(b: Builder, m: VillageMats, x: number, y: number, z: number, s: number): void {
  const st = wallUV(WALL.stone, 1.5);
  b.bevel(m.wall, place(x, y + 0.1 * s, z), 0.6 * s, 0.2 * s, 0.6 * s, 0.04, st);
  cyl(b, m.wall, x, y + 0.2 * s, z, 0.13 * s, 0.7 * s, st, 8);
  b.bevel(m.wall, place(x, y + 0.95 * s, z), 0.5 * s, 0.1 * s, 0.5 * s, 0.03, st);
  b.box(m.wall, place(x, y + 1.17 * s, z), 0.4 * s, 0.34 * s, 0.4 * s, st);
  b.box(m.palette, place(x - 0.201 * s, y + 1.17 * s, z), 0.004, 0.2 * s, 0.16 * s, sw('lampOn'));
  cone(b, m.wall, x, y + 1.34 * s, z, 0.42 * s, 0.24 * s, 0.25, st, 6);
  b.geo(m.wall, sphereTpl(8, 6), place(x, y + 1.66 * s, z, 0, 0, 0, 0.08 * s, 0.1 * s, 0.08 * s), st);
}

// ───────────────────────────── 屋頂水塔 ─────────────────────────────

/**
 * 圓筒形屋頂水塔（木葉村的招牌）：木平台＋四腳、金屬圓筒、圓頂蓋、鐵箍、檢修口、往下的水管。
 * @param y 平台腳的底部高度（通常是屋頂牆頂）
 * @param legH 腳的高度（把水塔架高到屋頂上方）
 */
export function waterTank(b: Builder, m: VillageMats, x: number, y: number, z: number, r: number, h: number, legH: number, rnd: Rng): void {
  const col: SwatchName = rnd.pick(['tankBlue', 'tankSteel', 'tankSteel', 'tankRust', 'tankGreen']);
  const py = y + legH;
  // 四隻腳與斜撐
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      b.box(m.wood, place(x + dx * r * 0.7, y + legH / 2, z + dz * r * 0.7), 0.12, legH, 0.12, woodUV(WOOD.dark, rnd.f()));
    }
    b.box(m.wood, place(x + dx * r * 0.7, y + legH * 0.5, z, 0.0, 0.7, 0), 0.06, legH * 1.1, 0.06, woodUV(WOOD.dark));
  }
  b.box(m.wood, place(x, py + 0.06, z), r * 1.9, 0.12, r * 1.9, woodUV(WOOD.mid, rnd.f()));
  // 圓筒＋鐵箍
  cyl(b, m.palette, x, py + 0.12, z, r, h, sw(col), 14);
  for (const t of [0.22, 0.78]) cyl(b, m.palette, x, py + 0.12 + h * t - 0.05, z, r * 1.03, 0.1, sw('iron'), 14);
  // 圓頂＋檢修口
  b.geo(m.palette, domeTpl(), place(x, py + 0.12 + h, z, 0, 0, 0, r, r * 0.38, r), sw(col));
  cyl(b, m.palette, x, py + 0.12 + h + r * 0.3, z, r * 0.22, 0.12, sw('iron'), 8);
  // 水管：從側面往下
  cylX(b, m.palette, x - r - 0.1, py + 0.35, z + r * 0.4, 0.06, 0.25, sw('iron'), 6);
  cyl(b, m.palette, x - r - 0.2, y - 1.2, z + r * 0.4, 0.06, legH + 1.55, sw('iron'), 6);
}

// ───────────────────────────── 晾衣竿 ─────────────────────────────

/** 晾衣竿（竹竿＋幾件彩色衣服，衣服會輕輕擺動） */
export function laundry(b: Builder, m: VillageMats, x: number, y: number, z0: number, z1: number, rnd: Rng): void {
  const len = Math.abs(z1 - z0);
  cylZ(b, m.palette, x, y, (z0 + z1) / 2, 0.025, len, sw('bamboo'), 6);
  const n = Math.max(2, Math.floor(len / 0.7));
  const cloth: SwatchName[] = ['clothWhite', 'clothBlue', 'clothRed', 'clothYellow', 'clothGreen', 'clothPurple'];
  for (let i = 0; i < n; i++) {
    if (rnd.chance(0.25)) continue;
    const z = Math.min(z0, z1) + ((i + 0.5) * len) / n;
    const w = rnd.range(0.4, 0.6);
    const h = rnd.range(0.45, 0.75);
    b.setSway(x, y, z, rnd.range(0.04, 0.08), rnd.range(1.8, 2.6), rnd.range(0, 6.28));
    const uv = rnd.chance(0.3) ? img('misc', MISC.laundry, 3) : sw(rnd.pick(cloth));
    b.box(m.sway, place(x, y - h / 2, z), 0.02, h, w, uv);
  }
}
