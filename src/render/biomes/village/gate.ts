import * as THREE from 'three';
import { Builder, cylTpl, place, Rng } from './builder';
import { CREST, DOOR, img, LANTERN, sw } from './atlas';
import { roofPlane } from './buildings';
import type { VillageMats } from './mats';
import { lantern, wallUV, woodUV } from './props';
import { STREET_Y } from './track';
import { ROOF, tileBand, ROOF_BANDS, ROOF_SU, WALL, WOOD } from './textures';

/**
 * 村子大門（入口地標，玩家從底下穿過）：兩根巨大的朱紅木柱（內緣 |x| = 5.05）、
 * 貫與笠木、上方瓦屋頂、正中央寫「火」的匾額、兩扇往村內敞開的綠色鐵釘大門（貼著柱子內側沿 z 擺放）、
 * 柱前掛大燈籠。|x| ≤ 4.5 沒有任何柱子或門板，淨空高度約 7.85 m（≥ 7.5）。
 * local 原點在入口中央地面。
 */

/** 柱子中心 x、柱寬 */
const PILLAR_X = 5.6;
const PILLAR_W = 1.1;
/** 貫（下橫樑）的中心高度與厚度：下緣 = 8.2 − 0.35 = 7.85 */
const NUKI_Y = 8.2;
const NUKI_H = 0.7;
/** 笠木（上橫樑）高度 */
const KASAGI_Y = 10.1;

/** 已建好的模板 */
let tpl: THREE.Group | null = null;

/** 建立村子大門 */
export function buildVillageGate(m: VillageMats): THREE.Object3D {
  if (!tpl) {
    const b = new Builder();
    gate(b, m);
    tpl = b.toGroup('village-gate');
  }
  return tpl.clone();
}

/** 大門本體 */
function gate(b: Builder, m: VillageMats): void {
  const rnd = new Rng(77);
  const red = woodUV(WOOD.vermilion, rnd.f());
  const pillarH = KASAGI_Y + 0.2;
  for (const s of [-1, 1]) {
    const x = s * PILLAR_X;
    // 石台座＋柱身（朱漆）＋黑鐵箍
    b.bevel(m.wall, place(x, 0.3, 0), 1.7, 1.2, 1.7, 0.08, wallUV(WALL.stone, 2));
    b.bevel(m.wood, place(x, 0.9 + (pillarH - 0.9) / 2, 0), PILLAR_W, pillarH - 0.9, PILLAR_W, 0.08, red);
    for (const y of [1.05, 1.35, NUKI_Y - 0.65]) {
      b.bevel(m.palette, place(x, y, 0), PILLAR_W + 0.08, 0.14, PILLAR_W + 0.08, 0.03, sw('charcoal'));
    }
    // 柱前的燈籠托架與大燈籠（|x| > 4.5，不影響淨空）
    b.box(m.palette, place(x, 6.9, 0.95), 0.1, 0.1, 0.8, sw('charcoal'));
    lantern(b, m, x, 6.86, 1.3, LANTERN.fire, 1.9, rnd);
    // 門板：鉸鏈在柱子內緣、往村內（−z）敞開，貼著柱子內側沿 z 擺放
    const dx = s * (PILLAR_X - PILLAR_W / 2 + 0.12);
    const dz0 = -0.6;
    const dLen = 4.4;
    const dH = 7.3;
    b.bevel(m.palette, place(dx, STREET_Y + dH / 2, dz0 - dLen / 2), 0.2, dH, dLen, 0.05, sw('darkGreen'), { edge: sw('darkGreen') });
    // 門板內側（朝軌道）的鐵箍、鉚釘、家徽
    const fx = dx - s * 0.11;
    for (const y of [1.2, 3.0, 4.8, 6.6]) {
      b.box(m.palette, place(fx, STREET_Y + y, dz0 - dLen / 2), 0.04, 0.16, dLen - 0.1, sw('iron'));
      for (let k = 0; k < 7; k++) {
        b.box(m.palette, place(fx - s * 0.02, STREET_Y + y, dz0 - 0.35 - k * 0.62), 0.05, 0.08, 0.08, sw('silver'));
      }
    }
    b.geo(m.palette, cylTpl(24), place(fx, STREET_Y + 3.9, dz0 - dLen / 2, 0, 0, Math.PI / 2, 0.9, 0.04, 0.9), img('crest', CREST.leaf, 2));
  }
  // 貫（下橫樑，兩端穿出柱外）
  b.bevel(m.wood, place(0, NUKI_Y, 0), PILLAR_X * 2 + 2.2, NUKI_H, 0.6, 0.07, red);
  // 匾額與兩側的短柱（束）
  b.bevel(m.wood, place(0, (NUKI_Y + KASAGI_Y) / 2, 0), 0.45, KASAGI_Y - NUKI_Y - 0.2, 0.5, 0.05, red);
  b.bevel(m.palette, place(0, (NUKI_Y + KASAGI_Y) / 2 + 0.05, 0.3), 1.6, 1.25, 0.12, 0.05, sw('gold'), {
    faces: [undefined, undefined, undefined, undefined, img('door', DOOR.plaqueFire, 2), img('door', DOOR.plaqueNin, 2)],
    edge: sw('gold'),
  });
  for (const s of [-1, 1]) {
    b.bevel(m.wood, place(s * 3.2, (NUKI_Y + KASAGI_Y) / 2, 0), 0.32, KASAGI_Y - NUKI_Y - 0.2, 0.4, 0.04, red);
  }
  // 笠木（上橫樑）
  b.bevel(m.wood, place(0, KASAGI_Y, 0), PILLAR_X * 2 + 3.0, 0.5, 0.8, 0.08, red);
  // 瓦屋頂（屋脊沿 x）：前後兩坡＋屋脊＋兩端鬼瓦
  const rb = ROOF.blue;
  const hw = PILLAR_X + 2.0;
  const y0 = KASAGI_Y + 0.3;
  const yR = y0 + 1.25;
  const dep = 1.9;
  roofPlane(b, m, rb, [-hw, y0, dep], [hw, y0, dep], [hw, yR, 0], [-hw, yR, 0]);
  roofPlane(b, m, rb, [hw, y0, -dep], [-hw, y0, -dep], [-hw, yR, 0], [hw, yR, 0]);
  b.bevel(m.roof, place(0, yR + 0.12, 0), hw * 2 + 0.2, 0.32, 0.45, 0.08, { ...tileBand(ROOF_SU, rb, ROOF_BANDS, 0.04) });
  for (const s of [-1, 1]) {
    b.bevel(m.palette, place(s * (hw + 0.1), yR + 0.4, 0), 0.3, 0.75, 0.5, 0.06, sw('charcoal'));
    // 山牆側的三角形（朱漆）與屋簷封簷板
    b.triangle(
      m.wood,
      s > 0 ? [s * hw, y0, dep] : [s * hw, y0, -dep],
      s > 0 ? [s * hw, y0, -dep] : [s * hw, y0, dep],
      [s * hw, yR, 0],
      [0, 0.3, 0.5, 0.3, 0.25, 0.6],
    );
  }
  for (const z of [dep + 0.04, -dep - 0.04]) {
    b.bevel(m.wood, place(0, y0 - 0.08, z), hw * 2 + 0.1, 0.22, 0.1, 0.03, woodUV(WOOD.dark, rnd.f()));
  }
  // 屋簷下的垂木（一排小方木，從正面看得到的細節）
  for (let x = -hw + 0.3; x <= hw - 0.3; x += 0.55) {
    b.box(m.wood, place(x, y0 - 0.14, dep - 0.35), 0.12, 0.12, 0.8, woodUV(WOOD.dark));
  }
  // 柱頂的寶珠裝飾
  for (const s of [-1, 1]) b.geo(m.palette, cylTpl(12), place(s * PILLAR_X, KASAGI_Y + 0.32, 0.45, 0, 0, 0, 0.18, 0.14, 0.18), sw('gold'));
}
