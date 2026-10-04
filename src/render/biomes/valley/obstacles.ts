import * as THREE from 'three';
import { BLOCK, HIGH_BAR, HURDLE, RAMP, TRAIN } from '../../../config';
import { mergeByMaterial } from '../../merge';
import { seeded } from '../../proctex';
import type { ObstacleOptions } from '../types';
import type { ValleyContext } from './context';
import { card, flat, foamRing, foamStrip, rockBlock, ropeTube, wrapPoints } from './geom';

/**
 * 終末之谷的障礙外觀（判定尺寸全部取自 config.ts）：
 * - train：倒在水中的長條石柱（每 TRAIN.carLength 一節，節與節之間是裂縫；三種款式），頂面平坦可跑
 * - train（moving）：以繩綁住的巨木筏（兩列三層原木＋頂層剖半原木當甲板），前端有浪花
 * - ramp：傾斜的大石板，頂面正好從 (z 0, y 0) 到 (z −RAMP.length, y RAMP.height)
 * - hurdle：一排露出水面的岩石／斷裂的石堰
 * - highBar：斷裂的石樑架在兩個石墩上（1.1 m 以下只有車道邊緣的石墩）
 * - block：帶苔蘚與水漬的巨石／綁注連繩的疊石
 * local 原點在障礙前緣（靠玩家那端）中央、水面；往 −z 延伸。
 * 依參數快取合併好的模板，每次回傳 clone（共用幾何與材質）。
 */
export function createObstacleBuilder(ctx: ValleyContext): (o: ObstacleOptions) => THREE.Object3D {
  const cache = new Map<string, THREE.Group>();
  return (o) => {
    const key = cacheKey(o);
    let tpl = cache.get(key);
    if (!tpl) {
      tpl = buildTemplate(ctx, o);
      cache.set(key, tpl);
    }
    return tpl.clone();
  };
}

/** 快取鍵：同參數共用同一個模板 */
function cacheKey(o: ObstacleOptions): string {
  const v = Math.abs(Math.trunc(o.variant));
  switch (o.kind) {
    case 'train':
      return o.moving ? `raft|${o.length}|${v % 2}` : `pillar|${o.length}|${v % 3}`;
    case 'ramp':
      return `ramp|${v % 2}`;
    case 'hurdle':
      return `hurdle|${v % 2}`;
    case 'highBar':
      return `bar|${v % 2}`;
    default:
      return `block|${v % 2}`;
  }
}

/** 組裝用的小工具：往 group 加網格 */
class Assembly {
  readonly root = new THREE.Group();
  constructor(readonly ctx: ValleyContext) {}

  /** 加一個網格（位置、旋轉、縮放），回傳網格 */
  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    cast = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = cast;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  /** 物體底部的浪花圈（hw、hd 是物體在水線的半寬、半深） */
  foam(x: number, z: number, hw: number, hd: number, rc: number, width = 0.75): void {
    this.add(foamRing(hw, hd, rc, width), this.ctx.mats.fx, x, 0, z, [0, 0, 0], [1, 1, 1], false);
  }

  /** 水花卡片（交叉） */
  splash(x: number, z: number, s: number, h = s): void {
    this.add(this.ctx.tpl.splash, this.ctx.mats.fx, x, -0.08, z, [0, x * 1.7 + z, 0], [s, h, s], false);
  }

  /** 合併成模板 */
  done(): THREE.Group {
    return mergeByMaterial(this.root);
  }
}

/** 依種類建立模板 */
function buildTemplate(ctx: ValleyContext, o: ObstacleOptions): THREE.Group {
  const v = Math.abs(Math.trunc(o.variant));
  switch (o.kind) {
    case 'train':
      return o.moving ? logRaft(ctx, o.length, v % 2) : stonePillar(ctx, o.length, v % 3);
    case 'ramp':
      return stoneRamp(ctx, v % 2);
    case 'hurdle':
      return rockRow(ctx, v % 2);
    case 'highBar':
      return brokenBeam(ctx, v % 2);
    default:
      return boulderBlock(ctx, v % 2);
  }
}

/**
 * 倒在水中的長條石柱（train）。
 * 款式 0：刻紋石柱（凸起的環帶＋綁繩）；1：天然層岩（較粗糙、側面有崩落的小石）；2：石造殘骸（上下兩排錯縫石塊）。
 */
function stonePillar(ctx: ValleyContext, length: number, style: number): THREE.Group {
  const k = new Assembly(ctx);
  const { mats, tpl } = ctx;
  const W = TRAIN.width;
  const H = TRAIN.height;
  const seg = TRAIN.carLength;
  const n = Math.max(1, Math.round(length / seg));
  const rnd = seeded(7000 + style * 101 + n);
  const sink = 0.45;
  const gap = 0.16;
  for (let i = 0; i < n; i++) {
    const zc = -(i + 0.5) * seg;
    const L = seg - gap;
    if (style === 2) {
      // 石造殘骸：下排 3 塊、上排 2 塊錯開，接縫清楚
      const lowH = 1.55 + sink;
      let z0 = -i * seg - gap / 2;
      const lows = 3;
      for (let b = 0; b < lows; b++) {
        const bl = L / lows;
        const geo = rockBlock(W, lowH, bl - 0.08, { density: 2, radius: 0.16, amp: 0.05, freq: 1.1, seed: 40 + i * 9 + b, tint: rnd() });
        k.add(geo, mats.stone, 0, lowH / 2 - sink, z0 - bl / 2);
        z0 -= bl;
      }
      // 上排兩塊、長度錯開（接縫不和下排對齊）
      const upH = H - 1.55;
      const upLens = [L * 0.62, L * 0.38];
      let zz = -i * seg - gap / 2;
      upLens.forEach((bl, b) => {
        const geo = rockBlock(W, upH, bl - 0.08, { density: 2, radius: 0.16, amp: 0.04, freq: 1.1, seed: 80 + i * 9 + b, flatTop: true, tint: rnd() });
        k.add(geo, mats.stone, 0, 1.55 + upH / 2, zz - bl / 2);
        zz -= bl;
      });
    } else {
      const geo = rockBlock(W, H + sink, L, {
        density: 2.2,
        radius: style === 0 ? 0.26 : 0.32,
        amp: style === 0 ? 0.06 : 0.13,
        freq: style === 0 ? 0.8 : 1.3,
        seed: 900 + style * 31 + i * 7,
        flatTop: true,
        tint: rnd(),
      });
      k.add(geo, mats.stone, 0, (H + sink) / 2 - sink, zc);
      if (style === 0) {
        // 刻紋環帶（凸出 0.05，頂面只高 0.04，不影響奔跑）
        for (const f of [0.18, 0.5, 0.82]) {
          const ring = rockBlock(W + 0.1, H + sink + 0.04, 0.32, { density: 3, radius: 0.12, amp: 0.02, seed: 70 + i, flatTop: true, tint: 0.2 });
          k.add(ring, mats.stone, 0, (H + sink + 0.04) / 2 - sink, -i * seg - gap / 2 - f * L);
        }
      } else {
        // 天然層岩：側面崩落的小石塊（貼著底部、不超出車道）
        for (let b = 0; b < 3; b++) {
          const s = 0.5 + rnd() * 0.5;
          const sideX = (rnd() < 0.5 ? -1 : 1) * (W / 2 - 0.05);
          k.add(tpl.boulders[(i + b) % tpl.boulders.length], mats.stone, sideX, s * 0.15, zc + (rnd() - 0.5) * (L - 2), [0, rnd() * 3, 0], [s, s * 0.8, s]);
        }
      }
    }
    // 綁繩（款式 0、1）：繞過頂面，凸起 ≤ 0.12
    if (style !== 2) {
      const zr = zc + (rnd() - 0.5) * 3;
      const rope = ropeTube(wrapPoints(W / 2, -0.3, H, 0.03), 0.065, true, 40);
      k.add(rope, mats.rope, 0, 0, zr, [0, 0, 0], [1, 1, 1], false);
    }
    // 側面垂苔與垂藤（貼著側面、往下垂）
    for (const sx of [-1, 1]) {
      for (let h = 0; h < 2; h++) {
        const z = zc + (rnd() - 0.5) * (L - 1.5);
        const geo = rnd() < 0.5 ? tpl.moss : tpl.vine;
        const sy = geo === tpl.vine ? 0.55 + rnd() * 0.3 : 0.9 + rnd() * 0.5;
        k.add(geo, mats.veg, sx * (W / 2 + 0.04), H - 0.02, z, [0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0], [0.8 + rnd() * 0.5, sy, 1], false);
      }
    }
    // 頂面邊緣的小草（高 ≤ 0.1）
    for (let gI = 0; gI < 2; gI++) {
      k.add(tpl.grass, mats.veg, (rnd() < 0.5 ? -1 : 1) * (W / 2 - 0.12), H - 0.04, zc + (rnd() - 0.5) * (L - 1), [0, rnd() * 3, 0], [0.4, 0.13, 0.4], false);
    }
  }
  // 浪花：整列外圍一圈；上游端（−z）水花；下游端（玩家這邊）V 字尾流
  k.foam(0, -length / 2, W / 2, length / 2, 0.3, 0.6);
  k.splash(0, -length - 0.2, 1.8, 1.4);
  k.splash(-(W / 2 - 0.3), -length + 0.4, 1.1, 1.0);
  k.splash(W / 2 - 0.3, -length + 0.4, 1.1, 1.0);
  for (const sx of [-1, 1]) {
    k.add(foamStrip(2.8, 0.55), ctx.mats.fx, sx * (W / 2 - 0.25), 0, 2.4, [0, sx * 0.18, 0], [sx, 1, 1], false);
  }
  return k.done();
}

/**
 * 迎面漂來的巨木筏（moving train）：兩列三層原木以繩綁住，最上層是剖半的原木（平面朝上當甲板，頂面 = TRAIN.height），
 * 前端（z = 0，朝玩家）切面露出年輪，船頭有大片浪花與水花。
 */
function logRaft(ctx: ValleyContext, length: number, style: number): THREE.Group {
  const k = new Assembly(ctx);
  const { mats, tpl } = ctx;
  const W = TRAIN.width;
  const H = TRAIN.height;
  const n = Math.max(1, Math.round(length / TRAIN.carLength));
  const rnd = seeded(8100 + style * 53 + n);
  // 原木：[x, y, 半徑]（三層、每層兩根）
  const rows: [number, number, number][] = [
    [-0.55, 0.12, 0.55],
    [0.55, 0.12, 0.55],
    [-0.54, 1.12, 0.52],
    [0.54, 1.12, 0.52],
    [-0.53, 2.08, 0.5],
    [0.53, 2.08, 0.5],
  ];
  /** 甲板：兩根剖半原木（平面朝上），半徑 = 車寬的四分之一 */
  const deckR = W / 4;
  const deckY = H;
  /** 原木本體（沿 z 的開口圓柱，樹皮 uv 依長度重複） */
  const bodyGeo = (r: number, len: number) => {
    const g = new THREE.CylinderGeometry(r, r * 0.97, len, 14, 1, true);
    g.rotateX(Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * (len / 2.5));
    return flat(g);
  };
  /** 原木切面（圓片，貼年輪） */
  const capGeo = (r: number) => flat(new THREE.CircleGeometry(r, 14));
  /** 剖半原木（下半圓，平面朝上）：theta −π/2～π/2 是 z ≥ 0 那半，rotateX 後變成 y ≤ 0 */
  const halfLog = (r: number, len: number) => {
    const g = new THREE.CylinderGeometry(r, r, len, 12, 1, true, -Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * (len / 2.5));
    return flat(g);
  };
  /** 剖半原木的平面（甲板，貼剖開的木紋） */
  const plankTop = (w: number, len: number) => {
    const g = new THREE.PlaneGeometry(w, len, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * (len / 3));
    return flat(g);
  };
  for (let i = 0; i < n; i++) {
    const z0 = -i * TRAIN.carLength;
    for (const [x, y, r] of rows) {
      const front = i === 0 ? rnd() * 0.25 : 0.05;
      const len = TRAIN.carLength - front - 0.05;
      const zc = z0 - front - len / 2;
      k.add(bodyGeo(r, len), mats.wood, x, y, zc);
      k.add(capGeo(r), mats.endGrain, x, y, z0 - front, [0, 0, rnd() * 3]);
      k.add(capGeo(r), mats.endGrain, x, y, z0 - front - len, [0, Math.PI, rnd() * 3]);
    }
    // 甲板：兩根剖半原木，平面在 y = H
    for (const d of [-0.5, 0.5]) {
      const x = d * (deckR * 2 - 0.01);
      const front = i === 0 ? 0.1 + rnd() * 0.15 : 0.05;
      const len = TRAIN.carLength - front - 0.05;
      const zc = z0 - front - len / 2;
      k.add(halfLog(deckR, len), mats.wood, x, deckY, zc);
      k.add(plankTop(deckR * 2 - 0.02, len), mats.deck, x, deckY - 0.005, zc, [0, 0, 0], [1, 1, 1], false);
      const capF = new THREE.CircleGeometry(deckR, 10, 0, Math.PI);
      capF.rotateZ(Math.PI);
      k.add(flat(capF), mats.endGrain, x, deckY, z0 - front);
    }
    // 中間的填縫原木（從側面看是一捆，不會看穿）
    k.add(bodyGeo(0.36, TRAIN.carLength - 0.4), mats.wood, 0, 1.6, z0 - TRAIN.carLength / 2);
    // 綁繩：每節 2～3 道
    const ropes = 2 + (i % 2);
    for (let rI = 0; rI < ropes; rI++) {
      const zr = z0 - TRAIN.carLength * ((rI + 0.6) / (ropes + 0.2));
      const rope = ropeTube(wrapPoints(W / 2 + 0.04, -0.35, H - 0.05, 0.035), 0.07, true, 40);
      k.add(rope, mats.rope, 0, 0, zr, [0, 0, 0], [1, 1, 1], false);
    }
    // 卡在木頭間的樹枝葉
    for (let b = 0; b < 2; b++) {
      const sx = rnd() < 0.5 ? -1 : 1;
      k.add(tpl.bush, mats.veg, sx * (W / 2 - 0.35), 1.6 + rnd() * 0.8, z0 - 1 - rnd() * 8, [0, rnd() * 3, sx * 0.5], [0.42, 0.45, 0.42], false);
    }
  }
  // 船頭浪花（前端 = z 0，往玩家這邊推出去）
  k.foam(0, -length / 2, W / 2, length / 2, 0.4, 0.65);
  k.splash(0, 0.35, 2.4, 1.9);
  k.splash(-(W / 2 - 0.25), 0.1, 1.25, 1.5);
  k.splash(W / 2 - 0.25, 0.1, 1.25, 1.5);
  for (const sx of [-1, 1]) {
    k.add(foamStrip(3.0, 0.6), mats.fx, sx * (W / 2 - 0.3), 0, 2.9, [0, sx * 0.25, 0], [sx, 1, 1], false);
  }
  return k.done();
}

/**
 * 斜坡：傾斜的大石板。石板頂面通過 (z 0, y 0) 與 (z −RAMP.length, y RAMP.height)，底下用碎石墊高。
 */
function stoneRamp(ctx: ValleyContext, style: number): THREE.Group {
  const k = new Assembly(ctx);
  const { mats, tpl } = ctx;
  const th = 0.7;
  const L = Math.hypot(RAMP.length, RAMP.height);
  const ang = Math.atan2(RAMP.height, RAMP.length);
  const slab = rockBlock(RAMP.width, th, L, { density: 2.5, radius: 0.12, amp: 0.05, freq: 1.2, seed: 1200 + style, flatTop: true, tint: 0.3 });
  // 先旋轉：rotateX(ang) 讓 −z 端抬高；再平移讓頂面前緣落在原點
  slab.rotateX(ang);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const ty = -((th / 2) * c - (L / 2) * s);
  const tz = -((th / 2) * s + (L / 2) * c);
  slab.translate(0, ty, tz);
  k.add(slab, mats.stone, 0, 0, 0);
  // 底下的碎石墊（在石板下方、不超出寬度）
  const rnd = seeded(1300 + style);
  for (let i = 0; i < 4; i++) {
    const f = 0.35 + i * 0.18;
    const z = -RAMP.length * f;
    const yTop = RAMP.height * f - 0.5;
    const sc = Math.max(0.6, yTop + 0.4);
    k.add(tpl.boulders[(i + style * 3) % tpl.boulders.length], mats.stone, (rnd() - 0.5) * 0.4, yTop / 2 - 0.1, z, [0, rnd() * 3, 0], [RAMP.width * 0.8, sc, 1.6]);
  }
  // 石板邊緣的小草、側面垂苔
  for (const sx of [-1, 1]) {
    k.add(tpl.moss, mats.veg, sx * (RAMP.width / 2 + 0.03), RAMP.height * 0.75, -RAMP.length * 0.75, [0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0], [0.9, 0.8, 1], false);
  }
  k.foam(0, -RAMP.length * 0.55, RAMP.width / 2, RAMP.length * 0.55, 0.25, 0.55);
  k.splash(0, 0.25, 1.6, 0.9);
  return k.done();
}

/**
 * 低欄：一排露出水面的岩石（款式 0）或斷裂的石堰（款式 1），高 HURDLE.height、深 HURDLE.depth。
 */
function rockRow(ctx: ValleyContext, style: number): THREE.Group {
  const k = new Assembly(ctx);
  const { mats, tpl } = ctx;
  const D = HURDLE.depth;
  const rnd = seeded(1500 + style);
  if (style === 0) {
    // 四顆圓石排成一列（最高的剛好 HURDLE.height），底部塞碎石
    const xs = [-0.78, -0.27, 0.26, 0.76];
    const hs = [0.86, 1.0, 0.93, 0.8];
    xs.forEach((x, i) => {
      const w = 0.62 + rnd() * 0.08;
      const h = hs[i] + 0.25;
      const geo = rockBlock(w, h, D + 0.08, { density: 7, radius: 0.2, amp: 0.05, freq: 2.2, seed: 1510 + i, tint: rnd() });
      k.add(geo, mats.stone, x, h / 2 - 0.25, -D / 2, [0, 0, (rnd() - 0.5) * 0.15]);
    });
    for (let i = 0; i < 5; i++) {
      const s = 0.28 + rnd() * 0.2;
      k.add(tpl.boulders[i % tpl.boulders.length], mats.stone, -0.95 + i * 0.47, 0.02, -D / 2 + (rnd() - 0.5) * 0.3, [0, rnd() * 3, 0], [s * 1.2, s, s], false);
    }
  } else {
    // 斷裂的石堰：一塊頂緣參差的石板＋兩端的石頭
    const geo = rockBlock(HURDLE.width - 0.2, HURDLE.height + 0.3, D, { density: 5, radius: 0.12, amp: 0.09, freq: 1.8, seed: 1550, tint: 0.7 });
    k.add(geo, mats.stone, 0, (HURDLE.height + 0.3) / 2 - 0.3, -D / 2);
    for (const sx of [-1, 1]) {
      k.add(tpl.boulders[sx > 0 ? 2 : 5], mats.stone, sx * 0.92, 0.2, -D / 2, [0, rnd() * 3, 0], [0.42, 0.75, 0.5]);
    }
    // 頂緣垂苔
    k.add(tpl.moss, mats.veg, 0.2, HURDLE.height - 0.02, 0.02, [0, 0, 0], [0.9, 0.45, 1], false);
  }
  k.foam(0, -D / 2, HURDLE.width / 2, D / 2 + 0.05, 0.2, 0.55);
  k.splash(-0.5, -D - 0.1, 1.1, 0.8);
  k.splash(0.55, -D - 0.1, 1.0, 0.75);
  return k.done();
}

/**
 * 高橫樑：斷裂的石樑（左右兩截、中間裂開）架在車道邊緣的兩個石墩上；石樑只佔 y ∈ [bottom, top]。
 */
function brokenBeam(ctx: ValleyContext, style: number): THREE.Group {
  const k = new Assembly(ctx);
  const { mats, tpl } = ctx;
  const B = HIGH_BAR;
  const D = B.depth;
  const h = B.top - B.bottom;
  const rnd = seeded(1700 + style);
  // 石墩：|x| 約 0.85～1.2（翻滾通道淨空），疊兩塊
  for (const sx of [-1, 1]) {
    const px = sx * 1.02;
    const low = rockBlock(0.4, 0.75, 0.52, { density: 6, radius: 0.1, amp: 0.03, seed: 1710 + sx, tint: 0.4 });
    k.add(low, mats.stone, px, 0.375 - 0.3, -D / 2);
    const up = rockBlock(0.36, B.bottom - 0.45 + 0.02, 0.46, { density: 6, radius: 0.08, amp: 0.025, seed: 1720 + sx, tint: 0.6 });
    k.add(up, mats.stone, px, 0.45 + (B.bottom - 0.45 + 0.02) / 2, -D / 2, [0, 0.08 * sx, 0]);
    k.foam(px, -D / 2, 0.22, 0.28, 0.18, 0.55);
  }
  if (style === 0) {
    // 兩截石樑：左截完整、右截略下沉傾斜，中間 V 形裂口
    const lw = B.width / 2 + 0.02;
    const left = rockBlock(lw, h, D, { density: 5, radius: 0.1, amp: 0.035, freq: 1.4, seed: 1730, tint: 0.35 });
    k.add(left, mats.stone, -B.width / 2 + lw / 2, B.bottom + h / 2, -D / 2, [0, 0, 0.015]);
    const rw = B.width / 2 - 0.04;
    const right = rockBlock(rw, h - 0.04, D * 0.95, { density: 5, radius: 0.1, amp: 0.035, freq: 1.4, seed: 1731, tint: 0.55 });
    k.add(right, mats.stone, B.width / 2 - rw / 2, B.bottom + (h - 0.04) / 2 + 0.02, -D / 2, [0, 0.02, -0.04]);
    // 刻紋（兩道凸起的橫帶）
    for (const yy of [B.bottom + 0.28, B.top - 0.28]) {
      k.add(rockBlock(B.width - 0.1, 0.1, D + 0.06, { density: 4, radius: 0.04, amp: 0.01, seed: 1740, tint: 0.2 }), mats.stone, 0, yy, -D / 2);
    }
  } else {
    // 倒下的方柱橫架，綁一道注連繩、掛紙垂
    const beam = rockBlock(B.width, h, D, { density: 5, radius: 0.16, amp: 0.05, freq: 1.2, seed: 1750, tint: 0.6 });
    k.add(beam, mats.stone, 0, B.bottom + h / 2, -D / 2);
    const rope = ropeTube(
      [new THREE.Vector3(-B.width / 2, B.top - 0.25, 0.04), new THREE.Vector3(0, B.top - 0.45, 0.07), new THREE.Vector3(B.width / 2, B.top - 0.25, 0.04)],
      0.08,
      false,
      24,
    );
    k.add(rope, mats.rope, 0, 0, 0, [0, 0, 0], [1, 1, 1], false);
    for (const x of [-0.6, 0, 0.6]) {
      k.add(card(0.26, 0.5, ctx.atlas.shide), mats.veg, x, B.top - 0.45 - 0.5 + (x === 0 ? -0.18 : -0.08), 0.09, [0, 0, 0], [1, 1, 1], false);
    }
  }
  // 石樑頂的苔蘚與正面垂藤（只在 y ≥ bottom 的範圍）
  k.add(tpl.grass, mats.veg, -0.4 + rnd() * 0.2, B.top - 0.05, -D / 2, [0, rnd() * 3, 0], [0.6, 0.35, 0.5], false);
  k.add(tpl.vine, mats.veg, 0.55, B.top, 0.025, [0, 0, 0], [0.5, (h - 0.1) / 3.2, 1], false);
  return k.done();
}

/**
 * 擋牆：帶苔蘚與水漬的巨石（款式 0），或兩顆疊起來、綁注連繩的神石（款式 1）。
 */
function boulderBlock(ctx: ValleyContext, style: number): THREE.Group {
  const k = new Assembly(ctx);
  const { mats, tpl } = ctx;
  const W = BLOCK.width;
  const H = BLOCK.height;
  const D = BLOCK.depth;
  if (style === 0) {
    // 寬度先縮一點，留給表面起伏（起伏後仍在 BLOCK.width 內、不超出車道）
    const geo = rockBlock(W - 0.28, H + 0.3, D + 0.05, { density: 5, radius: 0.6, amp: 0.17, freq: 0.95, seed: 1900, tint: 0.45 });
    k.add(geo, mats.stone, 0, (H + 0.3) / 2 - 0.3, -D / 2);
    k.add(tpl.grass, mats.veg, 0.2, H - 0.12, -D / 2, [0, 1, 0], [0.9, 0.6, 0.8], false);
  } else {
    const lowH = 1.5;
    const low = rockBlock(W, lowH + 0.3, D + 0.1, { density: 4, radius: 0.42, amp: 0.1, freq: 1.2, seed: 1910, tint: 0.3 });
    k.add(low, mats.stone, 0, (lowH + 0.3) / 2 - 0.3, -D / 2);
    const upH = H - lowH + 0.15;
    const up = rockBlock(W * 0.8, upH, D * 0.85, { density: 4, radius: 0.38, amp: 0.08, freq: 1.3, seed: 1911, tint: 0.7 });
    k.add(up, mats.stone, 0.05, lowH - 0.12 + upH / 2, -D / 2, [0, 0.12, 0.04]);
    // 注連繩繞上面那顆石頭一圈＋紙垂
    const ry = lowH + upH * 0.45;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * (W * 0.42 + 0.06), ry + Math.sin(a * 2) * 0.03, Math.sin(a) * (D * 0.45 + 0.06) - D / 2));
    }
    k.add(ropeTube(pts, 0.09, true, 36), mats.rope, 0, 0, 0, [0, 0, 0], [1, 1, 1], false);
    for (const x of [-0.45, 0.35]) {
      k.add(card(0.24, 0.46, ctx.atlas.shide), mats.veg, x, ry - 0.5, 0.05 + 0.02, [0, 0, 0], [1, 1, 1], false);
    }
  }
  k.foam(0, -D / 2, W / 2, D / 2, 0.45, 0.6);
  k.splash(0, -D - 0.2, 1.6, 1.2);
  return k.done();
}
