import * as THREE from 'three';
import { mergeByMaterial } from '../../merge';
import { seeded } from '../../proctex';
import type { ValleyContext } from './context';
import { card, fillUV, flat, foamRing, rockBlock, ropeTube } from './geom';
import { fbm3 } from './noise';
import { carvingTexture } from './textures';

/**
 * 終末之谷入口地標：兩根刻紋巨石柱夾著跑道（柱子內緣 |x| ≥ 4.7），
 * 柱頂之間是斷裂的石拱（拱腹最低處約 12 m），中間掛一條下垂的注連繩與紙垂（最低處 > 8 m）。
 * 柱腳有浪花、崩落的拱石倒在兩側淺灘。local 原點在入口中央水面。
 */

/** 石柱中心離跑道中心的距離 */
const PILLAR_X = 6.75;
/** 柱身半徑 */
const SHAFT_R = 1.45;
/** 柱頂（柱頭上緣）高度 */
const CAP_TOP = 13.2;

/** 刻紋帶材質（灰米色＋刻痕凹凸），只有入口用 */
let carveMat: THREE.MeshStandardMaterial | null = null;

/** 取得刻紋帶材質（第一次呼叫時建立） */
function carvedMaterial(): THREE.MeshStandardMaterial {
  if (!carveMat) {
    const bump = carvingTexture();
    carveMat = new THREE.MeshStandardMaterial({ color: 0xc8bea9, bumpMap: bump, bumpScale: 5, roughness: 0.9 });
  }
  return carveMat;
}

/**
 * 柱身：16 角圓柱＋直向凹槽＋表面起伏（岩石材質用的 uv：色調、遮蔽）。
 */
function shaftGeometry(h: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(SHAFT_R * 0.94, SHAFT_R, h, 24, 12, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const flute = Math.pow(Math.abs(Math.cos(a * 6)), 3) * 0.07;
    const n = (fbm3(x * 0.9, y * 0.5, z * 0.9, seed, 3) - 0.5) * 0.12;
    const s = (r - flute + n) / r;
    p.setXYZ(i, x * s, y, z * s);
  }
  g.computeVertexNormals();
  fillUV(g, 0.45, 1);
  // 遮蔽：凹槽較暗、底部較暗
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const fl = Math.pow(Math.abs(Math.cos(a * 6)), 3);
    uv.setY(i, 0.62 + 0.38 * fl);
  }
  return flat(g);
}

/** 建立入口地標（合併後的 Group） */
export function buildValleyGate(ctx: ValleyContext): THREE.Group {
  const { mats, tpl } = ctx;
  const root = new THREE.Group();
  const rnd = seeded(4321);
  /** 加網格 */
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0, ry = 0, cast = true, s: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(0, ry, rz);
    m.scale.set(s[0], s[1], s[2]);
    m.castShadow = cast;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  for (const side of [-1, 1]) {
    const x = side * PILLAR_X;
    // 台座（兩段）
    add(rockBlock(4.0, 1.7, 4.0, { density: 2, radius: 0.3, amp: 0.08, seed: 10 + side, tint: 0.3 }), mats.stone, x, 0.35, 0);
    add(rockBlock(3.5, 0.8, 3.5, { density: 2.5, radius: 0.22, amp: 0.05, seed: 12 + side, tint: 0.6 }), mats.stone, x, 1.55, 0);
    // 柱身
    const shaftH = 9.6;
    add(shaftGeometry(shaftH, 20 + side), mats.stone, x, 1.95 + shaftH / 2, 0);
    // 刻紋帶（兩道）＋環帶
    for (const [yc, hh] of [
      [4.6, 1.9],
      [8.8, 1.5],
    ] as [number, number][]) {
      const band = new THREE.CylinderGeometry(SHAFT_R * 1.03, SHAFT_R * 1.03, hh, 32, 1, true);
      const uv = band.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3);
      add(flat(band), carvedMaterial(), x, yc, 0, 0, side * 0.4);
      for (const dy of [-hh / 2 - 0.12, hh / 2 + 0.12]) {
        const ring = new THREE.CylinderGeometry(SHAFT_R * 1.09, SHAFT_R * 1.09, 0.26, 32, 1, false);
        add(flat(fillUV(ring, 0.2, 0.9)), mats.stone, x, yc + dy, 0);
      }
    }
    // 柱頭（三層，往上漸寬）
    add(rockBlock(3.3, 0.6, 3.3, { density: 2.5, radius: 0.2, amp: 0.04, seed: 30 + side, tint: 0.5 }), mats.stone, x, 11.85, 0);
    add(rockBlock(3.9, 0.95, 3.9, { density: 2.5, radius: 0.25, amp: 0.05, seed: 32 + side, tint: 0.7 }), mats.stone, x, CAP_TOP - 0.47, 0);
    // 垂藤（柱頭往下垂）與台座上的草
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      add(tpl.vine, mats.veg, x + Math.cos(a) * 1.98, CAP_TOP - 0.9, Math.sin(a) * 1.98, 0, -a + Math.PI / 2, false, [1.1, 0.8 + rnd() * 0.5, 1]);
    }
    add(tpl.bush, mats.veg, x - side * 1.4, 1.95, 1.3, 0, rnd() * 3, false, [0.9, 0.8, 0.9]);
    add(tpl.grass, mats.veg, x + side * 1.2, 1.95, -1.2, 0, rnd() * 3, false, [1.2, 1, 1.2]);
    // 柱腳浪花
    add(foamRing(2.0, 2.0, 0.5, 1.1), mats.fx, x, 0, 0, 0, 0, false);
    add(tpl.splash, mats.fx, x, -0.1, -2.2, 0, side, false, [2.6, 1.8, 2.6]);
    // 崩落的拱石（倒在外側淺灘）
    add(rockBlock(1.3, 1.5, 2.4, { density: 2.5, radius: 0.18, amp: 0.06, seed: 40 + side, tint: 0.4 }), mats.stone, side * 9.6, 0.25, 2.2, side * 0.6, 0.7, true);
    add(foamRing(0.9, 1.3, 0.4, 0.8), mats.fx, side * 9.6, 0, 2.2, 0, 0.7, false);
  }

  // 斷裂的石拱：節段弧，拱腹最低處 = 柱頂
  const rise = 3.4;
  const R = (PILLAR_X * PILLAR_X + rise * rise) / (2 * rise);
  const cy = CAP_TOP + rise - R;
  const a0 = Math.atan2(CAP_TOP - cy, -PILLAR_X);
  const a1 = Math.atan2(CAP_TOP - cy, PILLAR_X);
  const count = 13;
  // 中間缺 3 塊（左邊多保留一塊，斷口不對稱），斷口旁那塊略為鬆脫傾斜
  const missing = new Set([6, 7, 8]);
  for (let i = 0; i < count; i++) {
    if (missing.has(i)) continue;
    const t = (i + 0.5) / count;
    const a = a0 + (a1 - a0) * t;
    const rr = R + 0.8;
    const bx = Math.cos(a) * rr;
    const by = cy + Math.sin(a) * rr;
    const loose = i === 5 ? 0.08 : i === 9 ? -0.06 : 0;
    const geo = rockBlock(((a0 - a1) / count) * rr * 0.97, 1.6, 2.7, { density: 2.5, radius: 0.14, amp: 0.05, seed: 60 + i, tint: rnd() });
    add(geo, mats.stone, bx, by - (loose ? 0.12 : 0), 0, a - Math.PI / 2 + loose);
  }

  // 注連繩（兩柱之間下垂）＋紙垂
  const ropeY = 10.9;
  const sag = 1.4;
  const rp: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const xx = -PILLAR_X + SHAFT_R * 0.9 + t * (2 * PILLAR_X - SHAFT_R * 1.8);
    rp.push(new THREE.Vector3(xx, ropeY - sag * Math.sin(Math.PI * t), 1.1));
  }
  add(ropeTube(rp, 0.24, false, 64), mats.rope, 0, 0, 0, 0, 0, false);
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const xx = -PILLAR_X + SHAFT_R * 0.9 + t * (2 * PILLAR_X - SHAFT_R * 1.8);
    const yy = ropeY - sag * Math.sin(Math.PI * t) - 0.18;
    add(card(0.5, 1.0, ctx.atlas.shide), mats.veg, xx, yy - 1.0, 1.32, 0, 0, false);
  }
  return mergeByMaterial(root);
}
