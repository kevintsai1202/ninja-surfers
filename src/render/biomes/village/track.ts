import * as THREE from 'three';
import { CHUNK_LEN, LANE_WIDTH, LANES, SIDE_START_X } from '../../../config';
import { Builder, NX, NZ, place, PX, PZ, Rng, SKIP_BOTTOM, type UVSpec } from './builder';
import type { VillageMats } from './mats';
import { PAVE_SU, PEBBLE_SU, RAIL_UV, SLEEPER_BANDS, tileBand, WALL, WALL_BANDS } from './textures';

/**
 * 三條軌道與地面（跟 seed 無關，整個遊戲只建一次，每段場景用同一份幾何）：
 * 卵石道碴的斷面（每條軌道一個隆起的道床、軌道之間與外側有低窪斜坡）、
 * 紅褐色厚枕木、扣件墊板、工字鋼軌、兩側石砌擋土牆＋壓頂石、石板人行道、後院草地與外圍土坡。
 *
 * 長條幾何沿 z 每 SEG 公尺切一段：地平線下彎是逐頂點計算的，太長的三角形中間會跟彎曲對不上。
 */

/** 人行道（街面）高度：比道碴高一點，擋土牆把軌道框起來 */
export const STREET_Y = 0.45;
/** 枕木頂面高度（玩家跑在這個高度） */
const SLEEPER_TOP = 0;
/** 軌頭頂面高度（列車車輪踩在這裡） */
export const RAIL_TOP = 0.17;
/** 鋼軌中心離車道中心的距離（軌距約 1.44 m） */
export const RAIL_HALF = 0.72;
/** 長條幾何沿 z 的細分長度 */
const SEG = 2.5;
/** 石板路往外鋪到哪裡，之後是草地 */
const PAVE_END_X = 16.6;
/** 外圍土坡的起點、終點與坡頂高度 */
export const BERM_X0 = 31;
export const BERM_X1 = 46;
export const BERM_TOP = 7.5;

/** 道碴斷面（x ≥ 0 的半邊，x 由小到大），之後鏡射成整條 */
const HALF_PROFILE: [number, number][] = [
  [0, -0.06],
  [1.0, -0.06],
  [1.25, -0.17],
  [1.5, -0.06],
  [3.6, -0.06],
  [4.15, -0.3],
  [SIDE_START_X + 0.02, -0.32],
];

/** 建立整條道碴斷面（由 −x 到 +x） */
function fullProfile(): [number, number][] {
  const right = HALF_PROFILE;
  const left = right
    .slice(1)
    .map(([x, y]) => [-x, y] as [number, number])
    .reverse();
  return [...left, ...right];
}

/**
 * 建立軌道與地面的靜態網格（每個材質一個網格）。
 * 呼叫端每段場景用 new Mesh(同一個幾何, 同一個材質) 掛上去即可。
 */
export function buildTrackMeshes(m: VillageMats): THREE.Mesh[] {
  const b = new Builder();
  const rnd = new Rng(4242);
  const segs = Math.round(CHUNK_LEN / SEG);

  // ── 道碴：斷面沿 z 拉伸，UV 依世界公尺平鋪（30 m 剛好整數個週期） ──
  const prof = fullProfile();
  for (let s = 0; s < segs; s++) {
    const z0 = -s * SEG;
    const z1 = -(s + 1) * SEG;
    for (let i = 0; i + 1 < prof.length; i++) {
      const [xa, ya] = prof[i];
      const [xb, yb] = prof[i + 1];
      // 從 +y 看下去逆時針：a(z0) → b(z0) → b(z1) → a(z1)
      b.quad(m.ballast, [xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1], [
        xa / PEBBLE_SU,
        -z0 / PEBBLE_SU,
        xb / PEBBLE_SU,
        -z0 / PEBBLE_SU,
        xb / PEBBLE_SU,
        -z1 / PEBBLE_SU,
        xa / PEBBLE_SU,
        -z1 / PEBBLE_SU,
      ]);
    }
  }

  // ── 枕木（倒角厚木）與扣件墊板 ──
  const sleepers = 46;
  const pitch = CHUNK_LEN / sleepers;
  const sLen = 2.3;
  const sH = 0.17;
  const sW = 0.3;
  for (const lane of LANES) {
    const cx = lane * LANE_WIDTH;
    for (let k = 0; k < sleepers; k++) {
      const z = -(k + 0.5) * pitch + rnd.range(-0.02, 0.02);
      const yaw = rnd.range(-0.02, 0.02);
      const bandI = rnd.int(0, SLEEPER_BANDS - 1);
      const spec: UVSpec = { ...tileBand(sLen, bandI, SLEEPER_BANDS, 0.04), uo: rnd.f() };
      b.bevel(m.sleeper, place(cx + rnd.range(-0.03, 0.03), SLEEPER_TOP - sH / 2, z, yaw), sLen, sH, sW, 0.04, spec, { skip: SKIP_BOTTOM });
      // 兩條鋼軌下的墊板（上面畫了螺栓；比軌底寬，螺栓露在鋼軌兩側）
      for (const side of [-1, 1]) {
        b.box(m.rail, place(cx + side * RAIL_HALF, SLEEPER_TOP + 0.012, z, yaw), 0.34, 0.024, 0.24, RAIL_UV.dark, {
          faces: [undefined, undefined, RAIL_UV.plate],
          skip: SKIP_BOTTOM,
        });
      }
    }
  }

  // ── 鋼軌：軌底、軌腰、軌頭三段，沿 z 切段 ──
  const foot = { y0: 0.024, y1: 0.044, w: 0.15 };
  const web = { y0: 0.044, y1: 0.125, w: 0.035 };
  const head = { y0: 0.125, y1: RAIL_TOP, w: 0.075 };
  const ends = (1 << PZ) | (1 << NZ) | SKIP_BOTTOM;
  for (const lane of LANES) {
    for (const side of [-1, 1]) {
      const x = lane * LANE_WIDTH + side * RAIL_HALF;
      for (let s = 0; s < segs; s++) {
        const zc = -(s + 0.5) * SEG;
        for (const part of [foot, web, head]) {
          const top = part === head ? RAIL_UV.top : RAIL_UV.side;
          b.box(m.rail, place(x, (part.y0 + part.y1) / 2, zc), part.w, part.y1 - part.y0, SEG, RAIL_UV.side, {
            faces: [undefined, undefined, top],
            skip: ends,
          });
        }
      }
    }
  }

  // ── 兩側石砌擋土牆＋壓頂石 ──
  const stone = tileBand(3.75, WALL.stone, WALL_BANDS);
  for (const side of [-1, 1]) {
    for (let s = 0; s < segs; s++) {
      const zc = -(s + 0.5) * SEG;
      const wx = side * (SIDE_START_X + 0.2);
      const y0 = -0.36;
      const y1 = STREET_Y;
      // u 以世界 z 起算（段的 −z 端），各段與前後兩段場景都能接上
      const uo = (zc - SEG / 2) / 3.75;
      b.box(m.wall, place(wx, (y0 + y1) / 2, zc), 0.4, y1 - y0, SEG, { ...stone, uo }, {
        skip: (1 << PZ) | (1 << NZ) | SKIP_BOTTOM | (1 << (side > 0 ? PX : NX)),
      });
      b.bevel(m.wall, place(side * (SIDE_START_X + 0.22), STREET_Y + 0.07, zc), 0.56, 0.14, SEG + 0.002, 0.04, {
        ...tileBand(1.875, WALL.stone, WALL_BANDS),
        uo: uo * 2,
      }, { skip: (1 << PZ) | (1 << NZ) | SKIP_BOTTOM });
    }
  }

  // ── 石板人行道與後院草地、外圍土坡 ──
  for (const side of [-1, 1]) {
    for (let s = 0; s < segs; s++) {
      const z0 = -s * SEG;
      const z1 = -(s + 1) * SEG;
      // 由內往外的地面帶：[x0, x1, y0, y1, 材質, 平鋪尺寸]
      const strips: [number, number, number, number, THREE.Material, number][] = [
        [SIDE_START_X + 0.4, PAVE_END_X, STREET_Y, STREET_Y, m.street, PAVE_SU],
        [PAVE_END_X, BERM_X0, STREET_Y, STREET_Y, m.grass, 3],
        [BERM_X0, BERM_X1, STREET_Y, BERM_TOP, m.grass, 3],
      ];
      for (const [x0, x1, y0, y1, mat, su] of strips) {
        const xa = side * x0;
        const xb = side * x1;
        const uv = [xa / su, -z0 / su, xb / su, -z0 / su, xb / su, -z1 / su, xa / su, -z1 / su];
        if (side > 0) b.quad(mat, [xa, y0, z0], [xb, y1, z0], [xb, y1, z1], [xa, y0, z1], uv);
        else b.quad(mat, [xb, y1, z0], [xa, y0, z0], [xa, y0, z1], [xb, y1, z1], [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]]);
      }
    }
  }

  const g = b.toGroup('track');
  const meshes = g.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
  for (const mesh of meshes) mesh.name = 'track';
  return meshes;
}
