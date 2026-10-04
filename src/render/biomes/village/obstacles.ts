import * as THREE from 'three';
import { BLOCK, HIGH_BAR, HURDLE, RAMP } from '../../../config';
import type { ObstacleOptions } from '../types';
import { Builder, cylTpl, place, Rng, SKIP_BOTTOM, type UVSpec } from './builder';
import { img, imgPart, LANTERN, MISC, NOREN, sw } from './atlas';
import type { VillageMats } from './mats';
import { barrel, cyl, lantern, wallUV, woodUV } from './props';
import { buildTrain } from './train';
import { WALL, WOOD } from './textures';

/**
 * 木葉村的障礙外觀（local 原點：障礙前緣中央地面，往 −z 延伸）。尺寸全部取自 config：
 * - hurdle：紅白條紋木柵（A 字腳），高 HURDLE.height、深 HURDLE.depth
 * - highBar：拉麵攤風格的暖簾橫幅（深藍浪花紋／紅底拉麵），實體只在 HIGH_BAR.bottom～top，下方淨空
 * - block：木箱、木桶、米袋堆，寬高深照 BLOCK
 * - ramp：木板斜坡（防滑條、支架、扶手），從 (z=0, y=0) 到 (z=−RAMP.length, y=RAMP.height)
 * - train：見 train.ts
 * 每種（含外觀變化）只組一次模板，之後 clone（共用幾何與材質）。
 */

/** 模板快取 */
const cache = new Map<string, THREE.Group>();

/** 取得（或建立）模板並 clone */
function cached(key: string, make: (b: Builder) => void): THREE.Object3D {
  let g = cache.get(key);
  if (!g) {
    const b = new Builder();
    make(b);
    g = b.toGroup(`village-${key}`);
    cache.set(key, g);
  }
  return g.clone();
}

/** 取餘數（負數也回傳 0..n−1） */
function mod(v: number, n: number): number {
  return ((Math.round(v) % n) + n) % n;
}

/** 低欄：紅白條紋木板＋木框＋A 字腳（variant 1 多一塊板、沙包、禁止通行牌） */
function hurdle(b: Builder, m: VillageMats, variant: number): void {
  const rnd = new Rng(31 + variant);
  const W = HURDLE.width;
  const H = HURDLE.height;
  const D = HURDLE.depth;
  const zc = -D / 2;
  const legX = W / 2 - 0.1;
  const dw = woodUV(WOOD.dark, rnd.f());
  // A 字腳（每邊兩根斜木＋一根橫木）
  for (const s of [-1, 1]) {
    const x = s * legX;
    const ang = Math.atan2(D / 2 - 0.04, H - 0.04);
    const len = Math.hypot(D / 2 - 0.04, H - 0.04);
    b.box(m.wood, place(x, (H - 0.04) / 2, zc + (D / 2 - 0.04) / 2, 0, -ang, 0), 0.08, len, 0.08, dw);
    b.box(m.wood, place(x, (H - 0.04) / 2, zc - (D / 2 - 0.04) / 2, 0, ang, 0), 0.08, len, 0.08, dw);
    b.box(m.wood, place(x, 0.18, zc), 0.07, 0.07, D - 0.06, dw);
  }
  // 條紋板（正反面貼紅白條紋）
  const boards: [number, number][] = variant === 0 ? [[0.84, 0.28], [0.44, 0.22]] : [[0.86, 0.24], [0.56, 0.2], [0.27, 0.18]];
  const stripes = img('misc', MISC.stripes, 2);
  for (const [yc, h] of boards) {
    b.bevel(m.palette, place(0, yc, zc), W, h, 0.06, 0.02, sw('white'), {
      faces: [undefined, undefined, undefined, undefined, stripes, stripes],
      edge: sw('white'),
    });
    // 板子上下的木框條
    b.box(m.wood, place(0, yc + h / 2 + 0.02, zc), W + 0.04, 0.04, 0.08, dw);
    b.box(m.wood, place(0, yc - h / 2 - 0.02, zc), W + 0.04, 0.04, 0.08, dw);
  }
  // 兩端立柱頂的小紅燈（警示燈）
  for (const s of [-1, 1]) {
    cyl(b, m.wood, s * legX, H - 0.06, zc, 0.06, 0.06, dw, 8);
  }
  if (variant !== 0) {
    // 禁止通行牌（白底紅圈「止」）＋腳邊沙包
    // 牌子貼在最上面那塊板子的正面（不超出高度與深度）
    b.geo(m.palette, cylTplLazy(), place(0, 0.71, zc + 0.045, 0, Math.PI / 2, 0, 0.16, 0.03, 0.16), img('crest', 0, 2));
    for (const s of [-1, 1]) {
      b.bevel(m.palette, place(s * (legX - 0.12), 0.09, zc), 0.4, 0.18, D - 0.04, 0.08, img('misc', MISC.ricebag, 3), { edge: sw('burlap') });
    }
  }
}

/** 圓牌用的圓柱模板 */
function cylTplLazy(): THREE.BufferGeometry {
  return cylTpl(18);
}

/** 高橫樑：兩根木柱、頂樑、四片暖簾（正反面）、兩盞小燈籠；1.1 m 以下淨空 */
function highBar(b: Builder, m: VillageMats, variant: number): void {
  const rnd = new Rng(41 + variant);
  const W = HIGH_BAR.width;
  const y0 = HIGH_BAR.bottom;
  const y1 = HIGH_BAR.top;
  const D = HIGH_BAR.depth;
  const zc = -D / 2;
  const postX = W / 2 - 0.07;
  const dw = woodUV(WOOD.dark, rnd.f());
  for (const s of [-1, 1]) {
    b.bevel(m.wood, place(s * postX, y1 / 2, zc), 0.13, y1, 0.13, 0.03, dw);
    b.bevel(m.wall, place(s * postX, 0.08, zc), 0.2, 0.16, 0.24, 0.04, wallUV(WALL.stone, 1.5));
  }
  // 頂樑（實體上緣剛好 HIGH_BAR.top）
  b.bevel(m.wood, place(0, y1 - 0.08, zc), W, 0.16, 0.2, 0.04, dw);
  // 暖簾：四片，每片稍微前後錯開像布，正反兩面
  const nk = variant === 0 ? NOREN.wave : NOREN.ramen;
  const panels = 4;
  const xa = -postX + 0.08;
  const xb = postX - 0.08;
  const top = y1 - 0.16;
  const bot = y0 + 0.03;
  for (let i = 0; i < panels; i++) {
    const x0 = xa + ((xb - xa) * i) / panels;
    const x1 = xa + ((xb - xa) * (i + 1)) / panels;
    const dz = (i % 2 === 0 ? 1 : -1) * 0.025;
    const z = zc + dz;
    const uvF = imgPart('noren', nk, i / panels + 0.004, 0, (i + 1) / panels - 0.004, 1);
    const uvB = imgPart('noren', nk, (i + 1) / panels - 0.004, 0, i / panels + 0.004, 1);
    // 正面（朝 +z，玩家看到的那面）與背面
    b.quadRect(m.palette, [x0, bot, z + 0.004], [x1 - 0.015, bot, z + 0.004], [x1 - 0.015, top, z + 0.004], [x0, top, z + 0.004], uvF);
    b.quadRect(m.palette, [x1 - 0.015, bot, z - 0.004], [x0, bot, z - 0.004], [x0, top, z - 0.004], [x1 - 0.015, top, z - 0.004], uvB as UVSpec);
  }
  // 暖簾竿
  b.box(m.palette, place(0, top + 0.02, zc), xb - xa + 0.1, 0.04, 0.04, sw('darkWood'));
  // 柱子內側的小燈籠（在 1.1～2.6 之間）
  for (const s of [-1, 1]) {
    lantern(b, m, s * (postX - 0.02), y1 - 0.2, zc, variant === 0 ? LANTERN.matsuri : LANTERN.fire, 0.6, rnd);
  }
}

/** 一個木箱（倒角、邊框木條、正面印字） */
function boxCrate(b: Builder, m: VillageMats, x: number, y: number, z: number, sx: number, sy: number, sz: number, rnd: Rng): void {
  b.bevel(m.wood, place(x, y + sy / 2, z), sx, sy, sz, 0.04, woodUV(WOOD.light, rnd.f()), { skip: SKIP_BOTTOM });
  const bat = woodUV(WOOD.mid, rnd.f());
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) b.box(m.wood, place(x + dx * (sx / 2 - 0.03), y + sy / 2, z + dz * (sz / 2 - 0.03)), 0.08, sy + 0.005, 0.08, bat);
    b.box(m.wood, place(x + dx * (sx / 2 - 0.03), y + sy / 2, z), 0.07, sy * 0.95, sz - 0.1, bat, { skip: (1 << 2) | (1 << 3) });
  }
  // 正面（+z）的對角木條與印字
  b.box(m.palette, place(x, y + sy / 2, z + sz / 2 + 0.003), sx * 0.7, sy * 0.45, 0.006, img('misc', MISC.crate, 3));
}

/** 米袋（圓胖的袋子＋綁繩） */
function riceBag(b: Builder, m: VillageMats, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  b.bevel(m.palette, place(x, y + sy / 2, z), sx, sy, sz, Math.min(sy, sx) * 0.38, sw('burlap'), {
    faces: [undefined, undefined, undefined, undefined, img('misc', MISC.ricebag, 3)],
    edge: sw('burlap'),
  });
  for (const t of [-0.32, 0.32]) b.box(m.palette, place(x + t * sx, y + sy / 2, z), 0.04, sy + 0.02, sz + 0.02, sw('rope'));
}

/** 擋牆：依 variant 換組合（木箱堆／木桶＋木箱／米袋堆） */
function block(b: Builder, m: VillageMats, variant: number): void {
  const rnd = new Rng(51 + variant);
  const W = BLOCK.width;
  const D = BLOCK.depth;
  const zc = -D / 2;
  const half = W / 2;
  if (variant === 0) {
    // 下層兩個大木箱、上層一個木箱＋兩個米袋
    boxCrate(b, m, -half / 2, 0, zc, half - 0.02, 1.2, D - 0.02, rnd);
    boxCrate(b, m, half / 2, 0, zc, half - 0.02, 1.2, D - 0.02, rnd);
    boxCrate(b, m, -0.45, 1.2, zc + 0.02, 1.0, 1.0, 1.0, rnd);
    riceBag(b, m, 0.52, 1.2, zc, 0.95, 0.5, 1.05);
    riceBag(b, m, 0.5, 1.7, zc + 0.04, 0.9, 0.46, 1.0);
    riceBag(b, m, -0.4, 2.2, zc, 0.9, 0.4, 0.95);
  } else if (variant === 1) {
    // 下層兩個大木桶、上層兩個木箱、最上面一個小木箱
    barrel(b, m, -half / 2, 0, zc, half / 2 - 0.02, 1.25);
    barrel(b, m, half / 2, 0, zc, half / 2 - 0.02, 1.25);
    boxCrate(b, m, -half / 2, 1.25, zc, half - 0.04, 0.82, D - 0.08, rnd);
    boxCrate(b, m, half / 2, 1.25, zc, half - 0.04, 0.82, D - 0.08, rnd);
    boxCrate(b, m, 0.1, 2.07, zc, 0.85, 0.53, 0.85, rnd);
  } else {
    // 米袋堆（三層）＋旁邊的木箱
    const rows: [number, number][] = [
      [0.0, 3],
      [0.52, 3],
      [1.04, 2],
      [1.56, 2],
    ];
    for (const [y, n] of rows) {
      for (let i = 0; i < n; i++) {
        const w = (W - 0.05) / n;
        riceBag(b, m, -half + w * (i + 0.5) + (n === 2 ? rnd.range(-0.05, 0.05) : 0), y, zc + rnd.range(-0.04, 0.04), w - 0.02, 0.52, D - 0.06);
      }
    }
    boxCrate(b, m, 0, 2.08, zc, 1.3, 0.52, 1.0, rnd);
  }
}

/** 斜坡：木板踏面（一片片板子）、防滑條、兩側縱樑、支柱與斜撐、扶手 */
function ramp(b: Builder, m: VillageMats): void {
  const rnd = new Rng(61);
  const L = RAMP.length;
  const H = RAMP.height;
  const W = RAMP.width;
  const theta = Math.atan2(H, L);
  const S = Math.hypot(L, H);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  /** 斜面上距前緣 s 公尺處、往法線方向 off 的點 */
  const at = (s: number, off: number): [number, number] => [-s * ct - off * st, s * st + off * ct];
  // 踏板：每片 0.3 m，上緣剛好貼齊斜面
  const plank = 0.3;
  const n = Math.floor(S / plank);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * (S / n);
    const [z, y] = at(s, -0.04);
    const band = rnd.chance(0.5) ? WOOD.mid : WOOD.light;
    b.bevel(m.wood, place(0, y, z, 0, theta, 0), W - 0.06, 0.07, S / n - 0.025, 0.015, woodUV(band, rnd.f()));
  }
  // 防滑條（凸出 0.035，遠低於 0.12）
  for (let s = 0.6; s < S - 0.3; s += 0.62) {
    const [z, y] = at(s, 0.017);
    b.box(m.wood, place(0, y, z, 0, theta, 0), W - 0.3, 0.035, 0.05, woodUV(WOOD.dark, rnd.f()));
  }
  // 兩側縱樑（在踏板下方）：從坡長 0.7 m 處開始，前端下緣才不會穿出地面或凸出到 z > 0
  const sA = 0.7;
  for (const sx of [-1, 1]) {
    const [z, y] = at((sA + S) / 2, -0.16);
    b.bevel(m.wood, place(sx * (W / 2 - 0.12), y, z, 0, theta, 0), 0.14, 0.24, S - sA, 0.03, woodUV(WOOD.dark, rnd.f()));
  }
  // 支柱、斜撐（柱腳到下一根柱頂的斜木）、地檻
  const posts = [1.6, 3.3, 5.0, 6.7];
  /** 距前緣 zz 公尺處的支柱頂高（斜面下方留給縱樑的空間） */
  const topAt = (zz: number) => (zz / L) * H - 0.3;
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.12);
    for (const zz of posts) {
      const top = topAt(zz);
      if (top < 0.1) continue;
      b.box(m.wood, place(x, top / 2, -zz), 0.12, top, 0.12, woodUV(WOOD.dark, rnd.f()));
    }
    for (let i = 0; i + 1 < posts.length; i++) {
      const za = posts[i];
      const zb = posts[i + 1];
      const yA = 0.1;
      const yB = topAt(zb) - 0.05;
      const dz = -(zb - za);
      const dy = yB - yA;
      const len = Math.hypot(dz, dy);
      // 局部 +y 轉到 (dy, dz) 方向：繞 x 軸轉 atan2(dz, dy)
      b.box(m.wood, place(x, (yA + yB) / 2, -(za + zb) / 2, 0, Math.atan2(dz, dy), 0), 0.06, len, 0.06, woodUV(WOOD.mid, rnd.f()));
    }
    b.box(m.wood, place(x, 0.05, -L / 2 - 0.4), 0.14, 0.1, L - 0.8, woodUV(WOOD.dark));
  }
  // 扶手：柱子＋沿坡的扶手（在 |x| ≤ 寬/2 之內）
  const rx = W / 2 - 0.04;
  for (const sx of [-1, 1]) {
    // 扶手只做到坡頂前 0.8 m，不伸進後面列車的車頭範圍
    const sEnd = S - 0.8;
    for (let s = 0.4; s <= sEnd + 0.01; s += (sEnd - 0.4) / 4) {
      const [z, y] = at(s, 0.28);
      b.box(m.wood, place(sx * rx, y, z), 0.06, 0.56, 0.06, woodUV(WOOD.dark));
    }
    const [z, y] = at((0.4 + sEnd) / 2, 0.55);
    b.bevel(m.wood, place(sx * rx, y, z, 0, theta, 0), 0.07, 0.07, sEnd - 0.4 + 0.07, 0.02, woodUV(WOOD.vermilion, rnd.f()));
  }
  // 前緣的鐵片
  b.box(m.metal, place(0, 0.012, -0.12), W - 0.1, 0.024, 0.26, sw('iron'));
}

/** 建立障礙外觀 */
export function buildVillageObstacle(m: VillageMats, o: ObstacleOptions): THREE.Object3D {
  switch (o.kind) {
    case 'train':
      return buildTrain(m, o.length, o.variant, o.moving);
    case 'hurdle': {
      const v = mod(o.variant, 2);
      return cached(`hurdle|${v}`, (b) => hurdle(b, m, v));
    }
    case 'highBar': {
      const v = mod(o.variant, 2);
      return cached(`highBar|${v}`, (b) => highBar(b, m, v));
    }
    case 'block': {
      const v = mod(o.variant, 3);
      return cached(`block|${v}`, (b) => block(b, m, v));
    }
    case 'ramp':
    default:
      return cached('ramp', (b) => ramp(b, m));
  }
}
