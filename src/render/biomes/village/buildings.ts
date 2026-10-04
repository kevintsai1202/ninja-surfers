import { Builder, cylTpl, icoTpl, place, Rng, SKIP_BOTTOM, type UVSpec } from './builder';
import { CREST, DOOR, HSIGN_COUNT, img, LANTERN, NOREN, sw, VSIGN_BOARDS, WINDOW, type SwatchName } from './atlas';
import type { VillageMats } from './mats';
import {
  barrel,
  bonsai,
  crate,
  cyl,
  laundry,
  lantern,
  pine,
  sakura,
  stoneLantern,
  torii,
  wallUV,
  waterTank,
  woodUV,
  benchUmbrella,
} from './props';
import { STREET_Y } from './track';
import { band, ROOF_BANDS, ROOF_SEG, ROOF_SU, tileBand, WALL, WALL_BANDS, WALL_SU, WOOD, WOOD_BANDS, WOOD_SU } from './textures';

/**
 * 和風商店街的建築（側邊座標系：x 往外、正面朝 −x、z 沿軌道 0 → −30）：
 * - 前排町家：一樓店面（暖簾、櫃台、商品架、燈籠、招牌）或住家（格子窗、拉門），
 *   二三樓的木格窗／陽台／晾衣竿，庇（一樓上方的小屋簷），山牆瓦屋頂或平屋頂＋水塔。
 * - 後排建築：便宜版（牆、窗圖、屋頂、偶爾水塔），從高處鏡頭看得到屋頂層次。
 * - 空地：小神社（鳥居、石燈籠、祠）、櫻花庭院（長椅和傘）、水井、窄巷。
 * 建築沒有背面牆（遊戲鏡頭永遠在軌道上，看不到），省下三角形。
 */

/** 屋頂斜率（約 26°） */
const PITCH = 0.49;
/** 一樓、樓上的樓高 */
const H_GROUND = 3.2;
const H_UPPER = 2.8;

/** 牆面平鋪的 v 範圍 */
function wallV(i: number): { v0: number; v1: number } {
  return band(i, WALL_BANDS, 0.07);
}

/**
 * 牆面四邊形：a 左下、bq 右下、c 右上、d 左上（從外面看），u 由 uA（左）到 uB（右）。
 */
function wallQuad(b: Builder, m: VillageMats, bandI: number, a: number[], bq: number[], c: number[], d: number[], uA: number, uB: number): void {
  const { v0, v1 } = wallV(bandI);
  b.quad(m.wall, a, bq, c, d, [uA, v0, uB, v0, uB, v1, uA, v1]);
}

/**
 * 瓦屋頂斜面：從屋簷（eL→eR）到屋脊（rL→rR），沿坡長切成每段 ROOF_SEG 公尺的帶子，
 * 每段 v 佔滿一條色帶（4 列瓦）；u 依屋簷方向的世界座標平鋪，相鄰屋頂的瓦欄會對齊。
 */
export function roofPlane(b: Builder, m: VillageMats, roofBand: number, eL: number[], eR: number[], rR: number[], rL: number[]): void {
  const { v0, v1 } = band(roofBand, ROOF_BANDS, 0.04);
  const sl = Math.hypot(rL[0] - eL[0], rL[1] - eL[1], rL[2] - eL[2]);
  const n = Math.max(1, Math.ceil(sl / ROOF_SEG - 0.05));
  const ex = eR[0] - eL[0];
  const ey = eR[1] - eL[1];
  const ez = eR[2] - eL[2];
  const el = Math.hypot(ex, ey, ez) || 1;
  const ux = ex / el;
  const uy = ey / el;
  const uz = ez / el;
  /** 頂點沿屋簷方向的座標 → 貼圖 u（世界座標平鋪，相鄰屋頂的瓦欄會對齊） */
  const uOf = (p: number[]) => (p[0] * ux + p[1] * uy + p[2] * uz) / ROOF_SU;
  /** 兩點之間的線性內插 */
  const lerp = (p: number[], q: number[], t: number) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const segLen = sl / n;
  const vTop = v0 + Math.min(1, segLen / ROOF_SEG) * (v1 - v0);
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const a = lerp(eL, rL, t0);
    const bq = lerp(eR, rR, t0);
    const c = lerp(eR, rR, t1);
    const d = lerp(eL, rL, t1);
    b.quad(m.roof, a, bq, c, d, [uOf(a), v0, uOf(bq), v0, uOf(c), vTop, uOf(d), vTop]);
  }
}

/** 屋瓦色帶裡一個「瓦面」的單點 UV（脊瓦端的鬼瓦、單色零件用） */
function roofPt(roofBand: number): UVSpec {
  const { v0, v1 } = band(roofBand, ROOF_BANDS, 0.04);
  return { k: 'pt', u: 32 / 512, v: v0 + (v1 - v0) * 0.5 };
}

/** 屋瓦平鋪 UV（脊瓦：沿長軸看得到一顆顆瓦） */
function roofTile(roofBand: number): UVSpec {
  return { ...tileBand(ROOF_SU, roofBand, ROOF_BANDS, 0.04) };
}

/** 山牆屋頂的參數 */
interface GableOpts {
  /** 牆頂高度 */
  yTop: number;
  /** 正面、背面 x */
  fx: number;
  bx: number;
  /** 近端、遠端 z（zA > zB） */
  zA: number;
  zB: number;
  /** 屋瓦色帶 */
  roofBand: number;
  /** 山牆三角形的牆面色帶 */
  wallBand: number;
  /** 前後出簷、兩側出簷 */
  ovF: number;
  ovB: number;
  ovS: number;
  /** 細節（封簷板、鬼瓦、簷下）——後排建築可以省略 */
  detail: boolean;
}

/** 山牆瓦屋頂（屋脊沿 z，屋簷朝軌道），回傳屋脊位置與高度 */
function gableRoof(b: Builder, m: VillageMats, o: GableOpts, rnd: Rng): { xr: number; yR: number } {
  const D = o.bx - o.fx;
  const xr = o.fx + D / 2;
  const y0 = o.yTop + 0.06;
  const yR = y0 + (D / 2) * PITCH;
  const xeF = o.fx - o.ovF;
  const yeF = y0 - o.ovF * PITCH;
  const xeB = o.bx + o.ovB;
  const yeB = y0 - o.ovB * PITCH;
  const zN = o.zA + o.ovS;
  const zF = o.zB - o.ovS;
  // 前後兩個斜面
  roofPlane(b, m, o.roofBand, [xeF, yeF, zF], [xeF, yeF, zN], [xr, yR, zN], [xr, yR, zF]);
  roofPlane(b, m, o.roofBand, [xeB, yeB, zN], [xeB, yeB, zF], [xr, yR, zF], [xr, yR, zN]);
  // 山牆三角形（兩端）
  const { v0, v1 } = wallV(o.wallBand);
  const vt = v0 + (v1 - v0) * Math.min(1, (yR - o.yTop) / 3);
  for (const [z, s] of [[o.zA, 1], [o.zB, -1]] as const) {
    const p0 = [s > 0 ? o.fx : o.bx, o.yTop, z];
    const p1 = [s > 0 ? o.bx : o.fx, o.yTop, z];
    const p2 = [xr, yR - 0.06, z];
    const u0 = p0[0] / WALL_SU;
    const u1 = p1[0] / WALL_SU;
    b.triangle(m.wall, p0, p1, p2, [u0, v0, u1, v0, (u0 + u1) / 2, vt]);
  }
  // 屋脊（看得到一顆顆瓦）＋兩端鬼瓦
  const L = zN - zF;
  b.bevel(m.roof, place(xr, yR + 0.08, (zN + zF) / 2), 0.36, 0.24, L + 0.12, 0.06, roofTile(o.roofBand));
  if (o.detail) {
    for (const z of [zN + 0.08, zF - 0.08]) {
      b.bevel(m.roof, place(xr, yR + 0.2, z), 0.42, 0.5, 0.18, 0.05, roofPt(o.roofBand));
    }
    // 屋簷前緣的厚瓦邊（看得到一顆顆瓦頭）＋下方的封簷板；搏風板（山牆兩側斜邊）
    b.bevel(m.roof, place(xeF + 0.04, yeF + 0.02, (zN + zF) / 2), 0.3, 0.2, L + 0.06, 0.07, roofTile(o.roofBand));
    b.box(m.wood, place(xeF + 0.02, yeF - 0.12, (zN + zF) / 2), 0.09, 0.16, L + 0.02, woodUV(WOOD.dark, rnd.f()));
    const runF = xr - xeF;
    const riseF = yR - yeF;
    const lenF = Math.hypot(runF, riseF);
    const angF = Math.atan2(riseF, runF);
    const runB = xeB - xr;
    const lenB = Math.hypot(runB, yR - yeB);
    for (const z of [zN + 0.02, zF - 0.02]) {
      b.box(m.wood, place(xeF + runF / 2, yeF + riseF / 2 - 0.06, z, 0, 0, angF), lenF, 0.22, 0.08, woodUV(WOOD.dark, rnd.f()));
      b.box(m.wood, place(xr + runB / 2, yeB + (yR - yeB) / 2 - 0.06, z, 0, 0, -angF), lenB, 0.22, 0.08, woodUV(WOOD.dark, rnd.f()));
    }
    // 簷下（從下面看得到的木板天花）：正面與背面
    const { v0: w0, v1: w1 } = band(WOOD.mid, WOOD_BANDS, 0.08);
    b.quad(m.wood, [xeB, yeB - 0.03, zF], [xeB, yeB - 0.03, zN], [o.bx, y0 - 0.02, zN], [o.bx, y0 - 0.02, zF], [
      zF / WOOD_SU,
      w0,
      zN / WOOD_SU,
      w0,
      zN / WOOD_SU,
      w1,
      zF / WOOD_SU,
      w1,
    ]);
    b.quad(m.wood, [xeF, yeF - 0.03, zN], [xeF, yeF - 0.03, zF], [o.fx, y0 - 0.02, zF], [o.fx, y0 - 0.02, zN], [
      zN / WOOD_SU,
      w0,
      zF / WOOD_SU,
      w0,
      zF / WOOD_SU,
      w1,
      zN / WOOD_SU,
      w1,
    ]);
  }
  return { xr, yR };
}

/** 窗戶：圖＋木框＋窗台（正面朝 −x） */
function windowUnit(b: Builder, m: VillageMats, fx: number, yc: number, zc: number, w: number, h: number, kind: number, rnd: Rng, flowerBox: boolean): void {
  const x = fx - 0.012;
  b.quadRect(m.palette, [x, yc - h / 2, zc - w / 2], [x, yc - h / 2, zc + w / 2], [x, yc + h / 2, zc + w / 2], [x, yc + h / 2, zc - w / 2], img('window', kind, 3));
  const fw = woodUV(WOOD.dark, rnd.f());
  const t = 0.08;
  b.box(m.wood, place(fx - 0.03, yc + h / 2 + t / 2, zc), 0.1, t, w + 2 * t, fw);
  b.box(m.wood, place(fx - 0.03, yc - h / 2 - t / 2, zc), 0.1, t, w + 2 * t, fw);
  b.box(m.wood, place(fx - 0.03, yc, zc - w / 2 - t / 2), 0.1, h, t, fw);
  b.box(m.wood, place(fx - 0.03, yc, zc + w / 2 + t / 2), 0.1, h, t, fw);
  // 窗台
  b.box(m.wood, place(fx - 0.09, yc - h / 2 - t - 0.03, zc), 0.22, 0.06, w + 0.3, fw);
  if (flowerBox) {
    const y = yc - h / 2 - t - 0.06;
    b.box(m.wood, place(fx - 0.22, y - 0.14, zc), 0.3, 0.24, w * 0.9, woodUV(WOOD.mid, rnd.f()), { skip: SKIP_BOTTOM });
    const n = Math.max(2, Math.round(w / 0.35));
    const fc = sw(rnd.pick(['flowerRed', 'pink', 'flowerYellow', 'flowerWhite'] as SwatchName[]));
    for (let i = 0; i < n; i++) {
      const zz = zc - (w * 0.9) / 2 + ((i + 0.5) * w * 0.9) / n;
      b.geo(m.palette, icoGeo(), place(fx - 0.22, y + 0.02, zz, rnd.f() * 3, 0, 0, 0.17, 0.13, 0.17), img('misc', 1, 3));
      b.geo(m.palette, icoGeo(0), place(fx - 0.3, y + 0.1, zz + rnd.range(-0.08, 0.08), 0, 0, 0, 0.06, 0.06, 0.06), fc);
    }
  }
}

/** 二十面體模板（樹葉團） */
function icoGeo(detail = 1) {
  return icoTpl(detail);
}

/** 前排町家的外觀參數 */
interface HouseStyle {
  fx: number;
  depth: number;
  floors: number;
  wallBand: number;
  groundBand: number;
  roofBand: number;
  flat: boolean;
  shop: boolean;
  balcony: boolean;
}

/** 隨機產生前排町家的外觀 */
export function randomHouseStyle(rnd: Rng, width: number): HouseStyle {
  const plaster = [WALL.cream, WALL.white, WALL.orange, WALL.salmon, WALL.sage, WALL.blueGray, WALL.cream, WALL.orange];
  const floors = rnd.chance(0.35) ? 3 : 2;
  const flat = floors === 3 ? rnd.chance(0.55) : rnd.chance(0.15);
  const wallBand = rnd.chance(0.15) ? WALL.boards : rnd.pick(plaster);
  return {
    fx: 7.5 + rnd.range(-0.15, 0.35),
    depth: Math.min(6.2, rnd.range(5.0, 6.4)),
    floors,
    wallBand,
    groundBand: rnd.chance(0.35) ? WALL.boards : wallBand,
    roofBand: rnd.pick([0, 0, 1, 1, 1, 2, 3]),
    flat,
    shop: width > 4.2 && rnd.chance(0.72),
    balcony: rnd.chance(0.35),
  };
}

/**
 * 前排町家（店鋪或住家）。
 * @param zA 近端 z、zB 遠端 z（zA > zB）
 */
export function shopHouse(b: Builder, m: VillageMats, rnd: Rng, zA: number, zB: number, st: HouseStyle): void {
  const W = zA - zB;
  const zc = (zA + zB) / 2;
  const fx = st.fx;
  const bx = fx + st.depth;
  const y0 = STREET_Y;
  const floorY: number[] = [y0];
  for (let i = 1; i <= st.floors; i++) floorY.push(floorY[i - 1] + (i === 1 ? H_GROUND : H_UPPER));
  const yTop = floorY[st.floors];
  const darkWood = woodUV(WOOD.dark, rnd.f());

  // ── 牆面：每層一圈（正面＋兩側），一樓店面另外處理 ──
  for (let f = 0; f < st.floors; f++) {
    const ya = floorY[f];
    const yb = floorY[f + 1];
    const bandI = f === 0 ? st.groundBand : st.wallBand;
    if (!(f === 0 && st.shop)) {
      wallQuad(b, m, bandI, [fx, ya, zB], [fx, ya, zA], [fx, yb, zA], [fx, yb, zB], zB / WALL_SU, zA / WALL_SU);
    }
    wallQuad(b, m, bandI, [fx, ya, zA], [bx, ya, zA], [bx, yb, zA], [fx, yb, zA], fx / WALL_SU, bx / WALL_SU);
    wallQuad(b, m, bandI, [bx, ya, zB], [fx, ya, zB], [fx, yb, zB], [bx, yb, zB], bx / WALL_SU, fx / WALL_SU);
    // 背牆（遊戲鏡頭看不到，但從側面鏡頭看過去不會穿幫，只多兩個三角形）
    wallQuad(b, m, bandI, [bx, ya, zA], [bx, ya, zB], [bx, yb, zB], [bx, yb, zA], -zA / WALL_SU, -zB / WALL_SU);
  }
  // 轉角柱（正面兩角＋側牆後角）與樓層橫樑（正面＋兩側牆）
  for (const z of [zA - 0.1, zB + 0.1]) {
    b.bevel(m.wood, place(fx - 0.02, (y0 + yTop) / 2, z), 0.22, yTop - y0, 0.22, 0.04, darkWood);
    b.box(m.wood, place(bx - 0.1, (y0 + yTop) / 2, z + (z > zc ? 0.02 : -0.02)), 0.2, yTop - y0, 0.2, darkWood, { skip: (1 << 2) | (1 << 3) });
  }
  for (let f = 1; f < st.floors; f++) {
    b.bevel(m.wood, place(fx - 0.05, floorY[f], zc), 0.16, 0.22, W + 0.06, 0.04, darkWood);
    for (const z of [zA + 0.03, zB - 0.03]) b.box(m.wood, place((fx + bx) / 2, floorY[f], z), bx - fx, 0.2, 0.1, darkWood);
  }
  b.bevel(m.wood, place(fx - 0.05, yTop - 0.1, zc), 0.16, 0.2, W + 0.06, 0.04, darkWood);
  // 石砌基座（正面與兩側牆的牆腳）
  const stoneUV = wallUV(WALL.stone, 2.5, rnd.f());
  if (!st.shop) b.box(m.wall, place(fx - 0.04, y0 + 0.16, zc), 0.12, 0.32, W, stoneUV, { skip: SKIP_BOTTOM });
  for (const z of [zA + 0.04, zB - 0.04]) b.box(m.wall, place((fx + bx) / 2, y0 + 0.16, z), bx - fx, 0.32, 0.1, stoneUV, { skip: SKIP_BOTTOM });
  // 側牆的窗（從軌道往前看，看得到每棟房子朝向玩家的那面側牆）
  for (let f = 1; f < st.floors; f++) {
    const kind = rnd.pick([WINDOW.shoji, WINDOW.curtain, WINDOW.mushiko, WINDOW.lit]);
    for (const [z, dir] of [[zA, 1], [zB, -1]] as const) {
      if (rnd.chance(0.25)) continue;
      sideWindow(b, m, fx + (bx - fx) * rnd.range(0.38, 0.55), floorY[f] + 1.45, z, dir, 1.0, 1.05, kind, rnd);
    }
  }

  // ── 一樓 ──
  const yG = floorY[1];
  if (st.shop) shopFront(b, m, rnd, fx, zA, zB, yG);
  else houseFront(b, m, rnd, fx, zA, zB);

  // ── 一樓上方：庇（小屋簷）或陽台 ──
  const balcony = st.balcony && st.floors >= 2;
  if (!balcony) {
    const ov = 0.95;
    const yHi = yG + 0.08;
    const yLo = yHi - ov * 0.42;
    roofPlane(b, m, st.roofBand, [fx - ov, yLo, zB - 0.12], [fx - ov, yLo, zA + 0.12], [fx, yHi, zA + 0.12], [fx, yHi, zB - 0.12]);
    b.bevel(m.roof, place(fx - ov + 0.08, yLo + 0.03, zc), 0.26, 0.16, W + 0.3, 0.06, roofTile(st.roofBand));
    const { v0, v1 } = band(WOOD.mid, WOOD_BANDS, 0.08);
    b.quad(m.wood, [fx - ov, yLo - 0.05, zA + 0.12], [fx - ov, yLo - 0.05, zB - 0.12], [fx, yHi - 0.05, zB - 0.12], [fx, yHi - 0.05, zA + 0.12], [
      zA / WOOD_SU,
      v0,
      zB / WOOD_SU,
      v0,
      zB / WOOD_SU,
      v1,
      zA / WOOD_SU,
      v1,
    ]);
    b.box(m.wood, place(fx - ov - 0.02, yLo - 0.06, zc), 0.08, 0.16, W + 0.26, darkWood);
    // 托架
    const nb = Math.max(2, Math.round(W / 2.5));
    for (let i = 0; i < nb; i++) {
      const z = zB + 0.3 + ((W - 0.6) * i) / (nb - 1);
      b.box(m.wood, place(fx - 0.4, yG - 0.32, z, 0, 0, 0.6), 0.07, 0.85, 0.07, darkWood);
    }
    // 屋簷下的燈籠串
    if (st.shop || rnd.chance(0.5)) {
      const n = Math.max(2, Math.round(W / 2.3));
      const kind = rnd.pick([LANTERN.matsuri, LANTERN.matsuri, LANTERN.fire, LANTERN.tea]);
      for (let i = 0; i < n; i++) {
        const z = zB + 0.5 + ((W - 1.0) * (i + 0.5)) / n;
        lantern(b, m, fx - ov + 0.2, yLo - 0.08, z, kind, rnd.range(0.85, 1.0), rnd);
      }
    }
  } else {
    balconyUnit(b, m, rnd, fx, zA, zB, yG, st);
  }

  // ── 樓上的窗 ──
  const winKinds = [WINDOW.shoji, WINDOW.curtain, WINDOW.lit, WINDOW.mushiko, WINDOW.shoji, WINDOW.koshi];
  const wk = rnd.pick(winKinds);
  for (let f = 1; f < st.floors; f++) {
    const ya = floorY[f];
    if (balcony && f === 1) {
      // 陽台後面是拉門
      const nd = Math.max(1, Math.floor((W - 0.8) / 1.5));
      for (let i = 0; i < nd; i++) {
        const z = zB + 0.4 + ((W - 0.8) * (i + 0.5)) / nd;
        b.quadRect(m.palette, [fx - 0.01, ya + 0.1, z - 0.62], [fx - 0.01, ya + 0.1, z + 0.62], [fx - 0.01, ya + 2.1, z + 0.62], [fx - 0.01, ya + 2.1, z - 0.62], img('door', DOOR.slide, 2));
      }
      continue;
    }
    const n = Math.max(1, Math.floor((W - 0.6) / 1.9));
    const ww = Math.min(1.3, (W - 0.8) / n - 0.5);
    for (let i = 0; i < n; i++) {
      const z = zB + 0.3 + ((W - 0.6) * (i + 0.5)) / n;
      windowUnit(b, m, fx, ya + 1.45, z, ww, 1.15, f === st.floors - 1 && rnd.chance(0.3) ? WINDOW.shoji : wk, rnd, rnd.chance(0.22));
    }
    // 窗與窗之間的直柱（町家的木構架）
    for (let i = 1; i < n; i++) {
      const z = zB + 0.3 + ((W - 0.6) * i) / n;
      b.box(m.wood, place(fx - 0.02, ya + H_UPPER / 2, z), 0.12, H_UPPER, 0.14, darkWood, { skip: (1 << 2) | (1 << 3) });
    }
    // 平屋頂的三層樓：每層窗上加一道小瓦簷（地鐵跑酷式的層次）
    if (st.flat && f >= 1) {
      const yh = ya + H_UPPER - 0.12;
      roofPlane(b, m, st.roofBand, [fx - 0.55, yh - 0.25, zB - 0.05], [fx - 0.55, yh - 0.25, zA + 0.05], [fx, yh, zA + 0.05], [fx, yh, zB - 0.05]);
    }
  }
  // 家徽圓牌
  if (rnd.chance(0.3) && st.floors >= 2) {
    const yy = floorY[st.floors] - 1.0;
    const crest = rnd.pick([CREST.fire, CREST.swirl, CREST.leaf, CREST.fire]);
    b.geo(m.palette, cylGeo(20), place(fx - 0.05, yy, zA - 0.75, 0, 0, Math.PI / 2, 0.42, 0.06, 0.42), img('crest', crest, 2));
  }
  // 落水管
  if (rnd.chance(0.5)) cyl(b, m.palette, fx - 0.1, y0, zB + 0.28, 0.05, yTop - y0 - 0.1, sw('iron'), 6);

  // ── 屋頂 ──
  if (st.flat) flatRoof(b, m, rnd, fx, bx, zA, zB, yTop, st);
  else {
    const { xr, yR } = gableRoof(b, m, { yTop, fx, bx, zA, zB, roofBand: st.roofBand, wallBand: st.wallBand, ovF: 0.75, ovB: 0.35, ovS: 0.3, detail: true }, rnd);
    if (rnd.chance(0.3)) {
      // 水塔立在屋脊後方的架子上
      const tx = xr + 1.3;
      const tz = zB + 1.2 + rnd.f() * Math.max(0.1, W - 2.4);
      const roofY = yR - (tx - xr) * PITCH;
      waterTank(b, m, tx, yTop, tz, rnd.range(0.7, 0.9), rnd.range(1.2, 1.6), roofY - yTop + 0.3, rnd);
    }
  }
}

/** 圓柱模板 */
function cylGeo(radial = 12) {
  return cylTpl(radial);
}

/**
 * 側牆上的窗（朝 ±z）：圖＋上下木框。
 * @param dir +1 表示窗朝 +z（牆在 z = zA）、−1 朝 −z
 */
function sideWindow(b: Builder, m: VillageMats, xc: number, yc: number, z: number, dir: number, w: number, h: number, kind: number, rnd: Rng): void {
  const zz = z + dir * 0.012;
  const xa = xc - (dir > 0 ? w / 2 : -w / 2);
  const xb = xc + (dir > 0 ? w / 2 : -w / 2);
  // 朝 +z 時從外面看右手邊是 +x；朝 −z 時右手邊是 −x
  b.quadRect(m.palette, [xa, yc - h / 2, zz], [xb, yc - h / 2, zz], [xb, yc + h / 2, zz], [xa, yc + h / 2, zz], img('window', kind, 3));
  const fw = woodUV(WOOD.dark, rnd.f());
  b.box(m.wood, place(xc, yc + h / 2 + 0.04, z + dir * 0.03), w + 0.16, 0.08, 0.08, fw);
  b.box(m.wood, place(xc, yc - h / 2 - 0.04, z + dir * 0.03), w + 0.2, 0.08, 0.12, fw);
  for (const s of [-1, 1]) b.box(m.wood, place(xc + s * (w / 2 + 0.04), yc, z + dir * 0.03), 0.08, h, 0.08, fw);
}

/** 一樓店面：內凹的店內（商品架、櫃台、天花）、暖簾、橫招牌、直招牌 */
function shopFront(b: Builder, m: VillageMats, rnd: Rng, fx: number, zA: number, zB: number, yG: number): void {
  const y0 = STREET_Y;
  const W = zA - zB;
  const zc = (zA + zB) / 2;
  const inD = 1.3;
  const top = y0 + 2.95;
  const zi0 = zB + 0.22;
  const zi1 = zA - 0.22;
  // 開口上方的牆
  wallQuad(b, m, WALL.boards, [fx, top, zB], [fx, top, zA], [fx, yG, zA], [fx, yG, zB], zB / WALL_SU, zA / WALL_SU);
  // 店內後牆：商品架圖（每 1.6 m 一張）
  const n = Math.max(1, Math.round((zi1 - zi0) / 1.6));
  for (let i = 0; i < n; i++) {
    const za = zi0 + ((zi1 - zi0) * i) / n;
    const zb = zi0 + ((zi1 - zi0) * (i + 1)) / n;
    b.quadRect(m.palette, [fx + inD, y0, za], [fx + inD, y0, zb], [fx + inD, top, zb], [fx + inD, top, za], img('door', DOOR.shelf, 2));
  }
  // 店內兩側牆與天花板（暖色室內）
  const inner = sw('interiorWarm');
  b.quadRect(m.palette, [fx + inD, y0, zi1], [fx, y0, zi1], [fx, top, zi1], [fx + inD, top, zi1], inner);
  b.quadRect(m.palette, [fx, y0, zi0], [fx + inD, y0, zi0], [fx + inD, top, zi0], [fx, top, zi0], inner);
  b.quadRect(m.palette, [fx, top, zi1], [fx, top, zi0], [fx + inD, top, zi0], [fx + inD, top, zi1], sw('interior'));
  // 櫃台＋台上的商品
  const cw = W - 1.1;
  b.bevel(m.wood, place(fx + 0.45, y0 + 0.47, zc), 0.5, 0.94, cw, 0.04, woodUV(WOOD.mid, rnd.f()));
  b.box(m.wood, place(fx + 0.42, y0 + 0.97, zc), 0.6, 0.06, cw + 0.1, woodUV(WOOD.light, rnd.f()));
  const items = Math.floor(cw / 0.5);
  for (let i = 0; i < items; i++) {
    if (rnd.chance(0.35)) continue;
    const z = zc - cw / 2 + ((i + 0.5) * cw) / items;
    const col = sw(rnd.pick(['red', 'cream', 'indigo', 'yellow', 'green', 'white', 'orange'] as SwatchName[]));
    if (rnd.chance(0.3)) cyl(b, m.palette, fx + 0.42, y0 + 1.0, z, rnd.range(0.12, 0.18), rnd.range(0.08, 0.16), col, 8);
    else b.box(m.palette, place(fx + 0.42, y0 + 1.1, z), 0.25, rnd.range(0.12, 0.3), 0.3, col);
  }
  // 中柱（寬店面）
  if (W > 5.5) b.bevel(m.wood, place(fx - 0.02, (y0 + yG) / 2, zc), 0.18, yG - y0, 0.18, 0.04, woodUV(WOOD.dark));
  // 暖簾＋竿
  const nw = Math.min(2.6, W - 1.2);
  const nz = W > 5.5 ? zc + (rnd.chance(0.5) ? 1 : -1) * (W / 4) : zc;
  const nk = rnd.pick([NOREN.wave, NOREN.ramen, NOREN.tea, NOREN.sake, NOREN.wave]);
  const nx = fx - 0.06;
  b.quadRect(m.palette, [nx, top - 1.05, nz - nw / 2], [nx, top - 1.05, nz + nw / 2], [nx, top, nz + nw / 2], [nx, top, nz - nw / 2], img('noren', nk, 2));
  b.box(m.palette, place(nx - 0.02, top + 0.02, nz), 0.05, 0.05, nw + 0.3, sw('darkWood'));
  // 橫招牌（開口上方）
  const hk = rnd.int(0, HSIGN_COUNT - 1);
  const hw = Math.min(3.0, W - 1.0);
  b.bevel(m.wood, place(fx - 0.08, yG + 0.62, zc), 0.12, 0.62, hw, 0.03, woodUV(WOOD.dark), {
    faces: [undefined, img('hsign', hk === 6 ? 0 : hk, 2)],
    edge: sw('darkWood'),
  });
  // 直招牌（垂直於牆面，兩面都有字，走在軌道上看得到）
  const vk = rnd.int(0, VSIGN_BOARDS - 1);
  const vz = zA - 0.45;
  const vy = yG + 1.55;
  b.bevel(m.wood, place(fx - 0.62, vy, vz), 0.5, 2.0, 0.1, 0.025, woodUV(WOOD.dark), {
    faces: [undefined, undefined, undefined, undefined, img('vsign', vk), img('vsign', vk)],
    edge: sw('darkWood'),
  });
  for (const dy of [-0.8, 0.8]) b.box(m.palette, place(fx - 0.25, vy + dy, vz), 0.5, 0.04, 0.04, sw('iron'));
}

/** 一樓住家：腰板、格子窗、拉門、門前踏石、盆栽 */
function houseFront(b: Builder, m: VillageMats, rnd: Rng, fx: number, zA: number, zB: number): void {
  const y0 = STREET_Y;
  const W = zA - zB;
  // 腰板（深色木板）
  const { v0, v1 } = band(WOOD.dark, WOOD_BANDS, 0.08);
  b.quad(m.wood, [fx - 0.02, y0, zB + 0.2], [fx - 0.02, y0, zA - 0.2], [fx - 0.02, y0 + 0.85, zA - 0.2], [fx - 0.02, y0 + 0.85, zB + 0.2], [
    zB / WOOD_SU,
    v0,
    zA / WOOD_SU,
    v0,
    zA / WOOD_SU,
    v1,
    zB / WOOD_SU,
    v1,
  ]);
  // 拉門
  const dz = zA - 0.4 - 0.6;
  b.quadRect(m.palette, [fx - 0.03, y0, dz - 0.6], [fx - 0.03, y0, dz + 0.6], [fx - 0.03, y0 + 2.1, dz + 0.6], [fx - 0.03, y0 + 2.1, dz - 0.6], img('door', DOOR.slide, 2));
  b.box(m.wood, place(fx - 0.06, y0 + 2.16, dz), 0.1, 0.12, 1.45, woodUV(WOOD.dark));
  b.bevel(m.wall, place(fx - 0.35, y0 + 0.06, dz), 0.5, 0.12, 0.9, 0.03, wallUV(WALL.stone, 1.5));
  // 格子窗
  if (W > 3.4) {
    const wz = zB + (W - 1.6) / 2 + 0.2;
    windowUnit(b, m, fx, y0 + 1.6, wz, Math.min(1.8, W - 2.4), 1.1, WINDOW.koshi, rnd, false);
  }
  // 門邊的盆栽
  if (rnd.chance(0.6)) bonsai(b, m, fx - 0.45, y0, dz - 0.95, rnd.range(0.7, 0.9), rnd);
}

/** 二樓陽台：木地板、朱色或木色欄杆、晾衣竿 */
function balconyUnit(b: Builder, m: VillageMats, rnd: Rng, fx: number, zA: number, zB: number, yG: number, st: HouseStyle): void {
  const W = zA - zB;
  const zc = (zA + zB) / 2;
  const dep = 0.8;
  const railBand = rnd.chance(0.5) ? WOOD.vermilion : WOOD.dark;
  b.bevel(m.wood, place(fx - dep / 2, yG + 0.02, zc), dep, 0.14, W + 0.1, 0.03, woodUV(WOOD.mid, rnd.f()));
  const rail = woodUV(railBand, rnd.f());
  b.box(m.wood, place(fx - dep + 0.04, yG + 1.0, zc), 0.08, 0.08, W + 0.1, rail);
  b.box(m.wood, place(fx - dep + 0.04, yG + 0.25, zc), 0.06, 0.06, W, rail);
  const n = Math.floor(W / 0.3);
  for (let i = 0; i <= n; i++) {
    const z = zB + 0.05 + ((W - 0.1) * i) / n;
    const post = i === 0 || i === n;
    b.box(m.wood, place(fx - dep + 0.04, yG + 0.55, z), post ? 0.09 : 0.04, post ? 0.95 : 0.7, post ? 0.09 : 0.04, rail);
  }
  // 陽台下方（一樓頂部）也要有遮雨的木板天花
  if (rnd.chance(0.55)) laundry(b, m, fx - 0.5, yG + 1.95, zB + 0.4, zA - 0.4, rnd);
  // 陽台下掛兩盞燈籠
  if (st.shop) {
    for (const z of [zB + 0.6, zA - 0.6]) lantern(b, m, fx - dep + 0.15, yG - 0.06, z, LANTERN.matsuri, 0.9, rnd);
  }
}

/** 平屋頂：屋頂板、女兒牆、水塔、小屋、晾衣、盆栽 */
function flatRoof(b: Builder, m: VillageMats, rnd: Rng, fx: number, bx: number, zA: number, zB: number, yTop: number, st: HouseStyle): void {
  const W = zA - zB;
  const zc = (zA + zB) / 2;
  const D = bx - fx;
  const slab = wallUV(WALL.white, 4, rnd.f());
  b.bevel(m.wall, place(fx + D / 2, yTop + 0.1, zc), D + 0.3, 0.2, W + 0.2, 0.05, slab);
  const par = wallUV(st.wallBand === WALL.boards ? WALL.cream : st.wallBand, 4, rnd.f());
  b.bevel(m.wall, place(fx - 0.08, yTop + 0.45, zc), 0.18, 0.55, W + 0.2, 0.04, par);
  for (const z of [zA + 0.02, zB - 0.02]) b.bevel(m.wall, place(fx + D / 2, yTop + 0.45, z), D + 0.3, 0.55, 0.16, 0.04, par);
  // 女兒牆壓頂（瓦）
  b.bevel(m.roof, place(fx - 0.08, yTop + 0.76, zc), 0.3, 0.1, W + 0.3, 0.03, roofTile(st.roofBand));
  // 水塔 1～2 個
  const tanks = rnd.chance(0.5) ? 2 : 1;
  for (let i = 0; i < tanks; i++) {
    const tz = tanks === 1 ? zc + rnd.range(-W / 4, W / 4) : zB + (W * (i + 0.5)) / 2;
    waterTank(b, m, fx + D * 0.6, yTop + 0.2, tz, rnd.range(0.75, 1.05), rnd.range(1.3, 1.9), rnd.range(0.5, 1.1), rnd);
  }
  // 屋頂小屋（樓梯間）＋小瓦屋頂
  if (rnd.chance(0.6)) {
    const sz = zc + (tanks === 1 ? (rnd.chance(0.5) ? 1 : -1) * W * 0.28 : 0);
    const sx = fx + D * 0.3;
    b.bevel(m.wall, place(sx, yTop + 1.2, sz), 1.6, 2.0, 1.6, 0.05, wallUV(st.wallBand === WALL.boards ? WALL.white : st.wallBand, 4));
    b.quadRect(m.palette, [sx - 0.81, yTop + 0.2, sz - 0.4], [sx - 0.81, yTop + 0.2, sz + 0.4], [sx - 0.81, yTop + 1.9, sz + 0.4], [sx - 0.81, yTop + 1.9, sz - 0.4], img('door', DOOR.studded, 2));
    roofPlane(b, m, st.roofBand, [sx - 1.1, yTop + 2.1, sz - 1.0], [sx - 1.1, yTop + 2.1, sz + 1.0], [sx, yTop + 2.6, sz + 1.0], [sx, yTop + 2.6, sz - 1.0]);
    roofPlane(b, m, st.roofBand, [sx + 1.1, yTop + 2.1, sz + 1.0], [sx + 1.1, yTop + 2.1, sz - 1.0], [sx, yTop + 2.6, sz - 1.0], [sx, yTop + 2.6, sz + 1.0]);
  }
  if (rnd.chance(0.5)) bonsai(b, m, fx + 0.4, yTop + 0.2, zA - 0.6, 0.8, rnd);
  if (rnd.chance(0.4)) laundry(b, m, fx + 0.6, yTop + 1.6, zB + 0.5, zB + Math.min(W - 0.5, 3), rnd);
}

/** 後排建築（便宜版）：正面與兩側牆、窗圖、山牆屋頂或平屋頂＋水塔 */
export function backHouse(b: Builder, m: VillageMats, rnd: Rng, zA: number, zB: number, fx: number): void {
  const D = rnd.range(5.5, 7.5);
  const bx = fx + D;
  const floors = rnd.int(2, 4);
  const y0 = STREET_Y;
  const wallBand = rnd.pick([WALL.cream, WALL.white, WALL.orange, WALL.salmon, WALL.sage, WALL.blueGray, WALL.boards]);
  const roofBand = rnd.pick([0, 1, 1, 2, 3]);
  const yTop = y0 + floors * 2.9;
  for (let f = 0; f < floors; f++) {
    const ya = y0 + f * 2.9;
    const yb = ya + 2.9;
    wallQuad(b, m, wallBand, [fx, ya, zB], [fx, ya, zA], [fx, yb, zA], [fx, yb, zB], zB / WALL_SU, zA / WALL_SU);
    wallQuad(b, m, wallBand, [fx, ya, zA], [bx, ya, zA], [bx, yb, zA], [fx, yb, zA], fx / WALL_SU, bx / WALL_SU);
    wallQuad(b, m, wallBand, [bx, ya, zB], [fx, ya, zB], [fx, yb, zB], [bx, yb, zB], bx / WALL_SU, fx / WALL_SU);
    const W = zA - zB;
    const n = Math.max(1, Math.floor(W / 2.2));
    const wk = rnd.pick([WINDOW.shoji, WINDOW.curtain, WINDOW.lit, WINDOW.mushiko, WINDOW.koshi]);
    for (let i = 0; i < n; i++) {
      const z = zB + (W * (i + 0.5)) / n;
      b.quadRect(m.palette, [fx - 0.01, ya + 0.9, z - 0.55], [fx - 0.01, ya + 0.9, z + 0.55], [fx - 0.01, ya + 2.0, z + 0.55], [fx - 0.01, ya + 2.0, z - 0.55], img('window', wk, 3));
    }
  }
  if (rnd.chance(0.35)) {
    const zc = (zA + zB) / 2;
    b.bevel(m.wall, place(fx + D / 2, yTop + 0.1, zc), D + 0.2, 0.2, zA - zB + 0.2, 0.05, wallUV(WALL.white, 4));
    waterTank(b, m, fx + D * 0.5, yTop + 0.2, zc, rnd.range(0.8, 1.1), rnd.range(1.4, 2.0), rnd.range(0.6, 1.2), rnd);
  } else {
    gableRoof(b, m, { yTop, fx, bx, zA, zB, roofBand, wallBand, ovF: 0.6, ovB: 0.3, ovS: 0.25, detail: false }, rnd);
  }
}

/** 低矮圍牆（石基＋灰泥＋瓦頂），沿 z 方向 */
function lowWall(b: Builder, m: VillageMats, x: number, zA: number, zB: number, h: number, roofBand: number, rnd: Rng): void {
  const zc = (zA + zB) / 2;
  const L = zA - zB;
  const y0 = STREET_Y;
  b.box(m.wall, place(x, y0 + 0.2, zc), 0.36, 0.4, L, wallUV(WALL.stone, 3, rnd.f()), { skip: SKIP_BOTTOM });
  b.box(m.wall, place(x, y0 + 0.4 + (h - 0.4) / 2, zc), 0.3, h - 0.4, L, wallUV(WALL.white, 4, rnd.f()));
  const yt = y0 + h;
  roofPlane(b, m, roofBand, [x - 0.3, yt, zB - 0.05], [x - 0.3, yt, zA + 0.05], [x, yt + 0.16, zA + 0.05], [x, yt + 0.16, zB - 0.05]);
  roofPlane(b, m, roofBand, [x + 0.3, yt, zA + 0.05], [x + 0.3, yt, zB - 0.05], [x, yt + 0.16, zB - 0.05], [x, yt + 0.16, zA + 0.05]);
}

/** 小神社空地：鳥居、參道石板、石燈籠、祠、注連繩、大樹 */
export function shrineLot(b: Builder, m: VillageMats, rnd: Rng, zA: number, zB: number): void {
  const zc = (zA + zB) / 2;
  const y0 = STREET_Y;
  torii(b, m, 6.4, y0, zc, 2.6, 4.2, rnd);
  // 參道
  for (let x = 6.0; x < 11.2; x += 0.75) {
    b.bevel(m.wall, place(x, y0 + 0.04, zc + rnd.range(-0.05, 0.05)), 0.62, 0.08, 1.1, 0.03, wallUV(WALL.stone, 1.5, rnd.f()));
  }
  stoneLantern(b, m, 8.4, y0, zc - 1.6, 1);
  stoneLantern(b, m, 8.4, y0, zc + 1.6, 1);
  // 祠：石台＋木造小屋＋屋頂
  const sx = 12.0;
  b.bevel(m.wall, place(sx, y0 + 0.4, zc), 2.6, 0.8, 2.6, 0.05, wallUV(WALL.stone, 2));
  b.bevel(m.wood, place(sx, y0 + 1.75, zc), 1.7, 1.9, 1.9, 0.04, woodUV(WOOD.mid, rnd.f()));
  b.quadRect(m.palette, [sx - 0.86, y0 + 0.9, zc - 0.6], [sx - 0.86, y0 + 0.9, zc + 0.6], [sx - 0.86, y0 + 2.4, zc + 0.6], [sx - 0.86, y0 + 2.4, zc - 0.6], img('door', DOOR.slide, 2));
  const rb = rnd.pick([1, 2]);
  roofPlane(b, m, rb, [sx - 1.5, y0 + 2.6, zc - 1.4], [sx - 1.5, y0 + 2.6, zc + 1.4], [sx, y0 + 3.5, zc + 1.4], [sx, y0 + 3.5, zc - 1.4]);
  roofPlane(b, m, rb, [sx + 1.5, y0 + 2.6, zc + 1.4], [sx + 1.5, y0 + 2.6, zc - 1.4], [sx, y0 + 3.5, zc - 1.4], [sx, y0 + 3.5, zc + 1.4]);
  b.bevel(m.roof, place(sx, y0 + 3.55, zc), 0.3, 0.2, 3.0, 0.05, roofTile(rb));
  // 注連繩與紙垂
  b.tube(m.palette, [[sx - 1.0, y0 + 2.55, zc - 1.0], [sx - 1.05, y0 + 2.35, zc], [sx - 1.0, y0 + 2.55, zc + 1.0]], 0.09, sw('straw'));
  for (const dz of [-0.5, 0, 0.5]) b.box(m.palette, place(sx - 1.06, y0 + 2.1, zc + dz), 0.01, 0.35, 0.12, sw('white'));
  // 背後的大樹
  if (rnd.chance(0.5)) sakura(b, m, sx + 1.2, y0, zc + rnd.range(-1.5, 1.5), rnd.range(1.1, 1.3), rnd);
  else pine(b, m, sx + 1.2, y0, zc + rnd.range(-1.5, 1.5), rnd.range(1.1, 1.3), rnd);
  // 兩側矮牆
  lowWall(b, m, 9.0, zA - 0.1, zA - 0.4, 1.3, rb, rnd);
  lowWall(b, m, 9.0, zB + 0.4, zB + 0.1, 1.3, rb, rnd);
}

/** 櫻花庭院：櫻花樹、長椅和傘、石燈籠、竹籬 */
export function gardenLot(b: Builder, m: VillageMats, rnd: Rng, zA: number, zB: number): void {
  const zc = (zA + zB) / 2;
  const y0 = STREET_Y;
  sakura(b, m, 10.5, y0, zc + rnd.range(-1, 1), rnd.range(1.15, 1.4), rnd);
  if (rnd.chance(0.6)) sakura(b, m, 13.0, y0, zc + rnd.range(-1.5, 1.5), rnd.range(0.9, 1.1), rnd);
  benchUmbrella(b, m, 7.6, zc + rnd.range(-0.6, 0.6), rnd);
  if (rnd.chance(0.6)) stoneLantern(b, m, 9.0, y0, zA - 0.7, 0.9);
  // 竹籬（側邊）
  for (const z of [zA - 0.15, zB + 0.15]) {
    b.quadRect(m.palette, [8.0, y0, z], [13.5, y0, z], [13.5, y0 + 1.4, z], [8.0, y0 + 1.4, z], img('misc', 5, 2));
    b.quadRect(m.palette, [13.5, y0, z], [8.0, y0, z], [8.0, y0 + 1.4, z], [13.5, y0 + 1.4, z], img('misc', 5, 2));
  }
}

/** 水井庭院：石井、木架小屋頂、水桶、松樹、木箱木桶 */
export function wellLot(b: Builder, m: VillageMats, rnd: Rng, zA: number, zB: number): void {
  const zc = (zA + zB) / 2;
  const y0 = STREET_Y;
  const wx = 9.2;
  cyl(b, m.wall, wx, y0, zc, 0.75, 0.8, wallUV(WALL.stone, 1.5), 14);
  cyl(b, m.palette, wx, y0 + 0.8, zc, 0.6, 0.02, sw('glassDark'), 14);
  for (const dz of [-0.85, 0.85]) b.box(m.wood, place(wx, y0 + 1.2, zc + dz), 0.12, 2.4, 0.12, woodUV(WOOD.dark));
  b.box(m.wood, place(wx, y0 + 2.3, zc), 0.1, 0.1, 1.9, woodUV(WOOD.dark));
  roofPlane(b, m, 0, [wx - 0.9, y0 + 2.3, zc - 1.2], [wx - 0.9, y0 + 2.3, zc + 1.2], [wx, y0 + 2.75, zc + 1.2], [wx, y0 + 2.75, zc - 1.2]);
  roofPlane(b, m, 0, [wx + 0.9, y0 + 2.3, zc + 1.2], [wx + 0.9, y0 + 2.3, zc - 1.2], [wx, y0 + 2.75, zc - 1.2], [wx, y0 + 2.75, zc + 1.2]);
  cyl(b, m.wood, wx - 0.6, y0 + 0.8, zc + 0.3, 0.16, 0.25, woodUV(WOOD.light), 10);
  pine(b, m, 12.5, y0, zc + rnd.range(-1, 1), rnd.range(1.0, 1.25), rnd);
  for (let i = 0; i < 3; i++) crate(b, m, 7.6 + rnd.f() * 0.6, y0, zA - 0.6 - i * 0.9, rnd.range(0.55, 0.75), rnd.range(-0.3, 0.3), rnd);
  barrel(b, m, 7.7, y0, zB + 0.8, 0.32, 0.8);
}
