import * as THREE from 'three';
import { BLOCK, HIGH_BAR, HURDLE, RAMP } from '../../../config';
import { seeded } from '../../proctex';
import type { ForestAssets } from './assets';
import { Batch, FULL_UV, boxTpl, grid, pick, range, trs, tube, type Rng } from './geom';
import { addFern, addMushrooms, faceMatrix, type FloraTarget } from './flora';

/**
 * 森林障礙（外觀尺寸都對齊 config.ts 的判定盒）：
 * - hurdle 低欄：倒在跑道上的粗樹枝堆（含小枝與葉），高 HURDLE.height、深 HURDLE.depth
 * - highBar 高橫樑：兩側細藤柱撐起、纏滿藤蔓的拱形藤圈＋橫跨的粗藤束（實體只在 1.1～2.6 m，下方淨空）
 * - block 擋牆：大樹樁（年輪切面、樹皮、苔蘚、層孔菌、香菇）或苔蘚巨石＋樹根
 * - ramp 斜坡：斜倒的巨樹幹，頂面削平鋪防滑木條，從 (z=0, y=0) 到 (z=−RAMP.length, y=RAMP.height)
 * 每種外觀依 (種類, variant) 快取一個合併好的模板，之後只 clone。
 */

/** 障礙的批次（依材質） */
interface ObsBatches extends FloraTarget {
  /** 斜坡削平的木頭面 */
  rampTop: Batch;
}

/** 新的一組批次 */
function batches(): ObsBatches {
  return {
    bark: new Batch(4096),
    moss: new Batch(1024),
    canopy: new Batch(256),
    plants: new Batch(1024),
    props: new Batch(1024),
    rock: new Batch(1024),
    rampTop: new Batch(512),
  };
}

/** 一段圓木（樹皮管子＋兩端年輪切面） */
function addBranchLog(T: ObsBatches, A: ForestAssets, a: THREE.Vector3, b: THREE.Vector3, r: number, arch: number, rnd: Rng, caps = true): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const n = 6;
  const w = rnd() * 10;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push(new THREE.Vector3().lerpVectors(a, b, s).add(new THREE.Vector3(0, Math.sin(Math.PI * s) * arch, 0)));
  }
  tube(T.bark, pts, (tt, ang) => r * (1 - 0.12 * tt) * (1 + 0.06 * Math.sin(ang * 3 + tt * 8 + w)), 10, 2, 1.4);
  if (caps) {
    const d0 = new THREE.Vector3().subVectors(pts[0], pts[1]).normalize();
    const d1 = new THREE.Vector3().subVectors(pts[n], pts[n - 1]).normalize();
    T.props.add(A.tpl.disc, faceMatrix(pts[0].x, pts[0].y, pts[0].z, d0.x, d0.y, d0.z, rnd() * 6, r * 1.02, r * 1.02), A.uv.prop.ringsFresh);
    T.props.add(A.tpl.disc, faceMatrix(pts[n].x, pts[n].y, pts[n].z, d1.x, d1.y, d1.z, rnd() * 6, r * 0.9, r * 0.9), A.uv.prop.ringsFresh);
  }
  return pts;
}

/** 細枝（從 a 長到 b，末端尖細） */
function addTwig(T: ObsBatches, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
  const m = new THREE.Vector3().lerpVectors(a, b, 0.5).add(new THREE.Vector3(0, 0.03, 0));
  tube(T.bark, [a, m, b], (tt) => r * (1 - 0.8 * tt), 5, 1, 0.8);
}

/** 葉片卡（盡量面向 ±z，才不會超出障礙深度） */
function addLeafCard(T: ObsBatches, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, size: number, rect = A.uv.plant.twig): void {
  const face = rnd() < 0.5 ? 1 : -1;
  T.plants.add(A.tpl.card, faceMatrix(x, y, z, range(rnd, -0.35, 0.35), range(rnd, 0.1, 0.4), face, range(rnd, -0.3, 0.3), size, size), rect);
}

// ───────────────────────── 低欄 ─────────────────────────

/** 低欄：variant 0 = 兩根圓木堆疊＋小枝葉；variant 1 = 叉枝撐起的粗枝＋斜交的細枝＋葉叢 */
function buildHurdle(A: ForestAssets, v: number): ObsBatches {
  const T = batches();
  const rnd = seeded(7300 + v);
  const W = HURDLE.width / 2 - 0.03;
  const D = HURDLE.depth;
  const zc = -D / 2;
  const top = HURDLE.height;
  if (v === 0) {
    addBranchLog(T, A, new THREE.Vector3(-W, 0.19, zc + 0.01), new THREE.Vector3(W, 0.17, zc - 0.01), 0.19, 0.0, rnd);
    const bp = addBranchLog(T, A, new THREE.Vector3(-W + 0.06, 0.5, zc - 0.02), new THREE.Vector3(W - 0.04, 0.55, zc + 0.02), 0.165, 0.07, rnd);
    for (let k = 0; k < 5; k++) {
      const p = bp[1 + k];
      const tip = new THREE.Vector3(p.x + range(rnd, -0.25, 0.25), range(rnd, 0.82, top - 0.08), zc + range(rnd, -0.1, 0.1));
      addTwig(T, p, tip, 0.035);
      addLeafCard(T, A, rnd, tip.x, Math.min(tip.y - 0.06, top - 0.3), tip.z, range(rnd, 0.44, 0.52));
    }
    // 下層樹枝上的苔蘚
    for (const x of [-0.55, 0.2, 0.7]) T.moss.add(pick(rnd, A.tpl.blobLo), trs(x, 0.33, zc, 0, rnd() * 6, 0, 0.26, 0.08, 0.15), FULL_UV, 0.5, 0.5);
  } else {
    // 叉枝支架
    for (const s of [-1, 1]) {
      const base = new THREE.Vector3(s * (W - 0.12), -0.05, zc);
      const fork = new THREE.Vector3(s * (W - 0.1), 0.48, zc);
      tube(T.bark, [base, fork], (tt) => 0.07 * (1 - 0.3 * tt), 6, 1, 1);
      addTwig(T, fork, new THREE.Vector3(s * (W - 0.02), 0.72, zc + 0.08), 0.045);
      addTwig(T, fork, new THREE.Vector3(s * (W - 0.22), 0.74, zc - 0.08), 0.045);
    }
    const bp = addBranchLog(T, A, new THREE.Vector3(-W, 0.6, zc + 0.02), new THREE.Vector3(W, 0.58, zc - 0.02), 0.18, 0.03, rnd);
    addBranchLog(T, A, new THREE.Vector3(-W + 0.05, 0.12, zc - 0.04), new THREE.Vector3(W - 0.1, 0.38, zc + 0.05), 0.12, 0.02, rnd);
    for (let k = 0; k < 4; k++) {
      const p = bp[1 + k];
      const tip = new THREE.Vector3(p.x + range(rnd, -0.2, 0.2), range(rnd, 0.88, top - 0.06), zc + range(rnd, -0.08, 0.08));
      addTwig(T, p, tip, 0.03);
      addLeafCard(T, A, rnd, tip.x, Math.min(tip.y - 0.06, top - 0.3), tip.z, 0.5);
    }
    T.moss.add(pick(rnd, A.tpl.blobLo), trs(0.1, 0.76, zc, 0, 0, 0, 0.42, 0.07, 0.13), FULL_UV, 0.5, 0.5);
  }
  return T;
}

// ───────────────────────── 高橫樑 ─────────────────────────

/** 沿 x 方向的螺旋股（藤蔓絞在一起） */
function strand(x0: number, x1: number, yAt: (x: number) => number, z: number, rad: number, phase: number, turns: number, n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const x = x0 + (x1 - x0) * s;
    const a = phase + s * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(x, yAt(x) + Math.cos(a) * rad, z + Math.sin(a) * rad));
  }
  return pts;
}

/**
 * 高橫樑：variant 0 = 拱形藤圈＋橫跨的三股絞藤（參考圖）；variant 1 = 長苔的粗樹枝橫樑＋兩側樹根柱＋垂掛松蘿。
 * 實體只在 HIGH_BAR.bottom～top；兩側柱子細、在車道邊緣；垂下的葉子最低 1.15 m。
 */
function buildHighBar(A: ForestAssets, v: number): ObsBatches {
  const T = batches();
  const rnd = seeded(7400 + v);
  const W = HIGH_BAR.width / 2 - 0.03;
  const zc = -HIGH_BAR.depth / 2;
  const lo = HIGH_BAR.bottom;
  const hi = HIGH_BAR.top;
  /** 橫藤中心線在 x 處的高度（中間略下垂） */
  const barY = (x: number) => 1.8 - 0.07 * (1 - (x / W) ** 2);
  if (v === 0) {
    // 兩側細藤柱（從地面長上來、微微扭轉）
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const y = -0.1 + (1.75 * i) / 8;
        pts.push(new THREE.Vector3(s * (W - 0.05) + Math.sin(i * 0.9) * 0.025, y, zc + Math.cos(i * 0.9) * 0.03));
      }
      tube(T.moss, pts, () => 0.055, 6, 1, 0.6);
      tube(T.moss, pts.map((p, i) => new THREE.Vector3(p.x + Math.sin(i * 1.7) * 0.06, p.y, p.z + Math.cos(i * 1.7) * 0.06)), () => 0.03, 5, 1, 0.6);
    }
    // 拱形藤圈（半橢圓，頂端碰到 HIGH_BAR.top）
    const arc: THREE.Vector3[] = [];
    const cy = 1.5;
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI - (Math.PI * i) / 14;
      arc.push(new THREE.Vector3(Math.cos(a) * (W - 0.05), cy + Math.sin(a) * (hi - 0.09 - cy), zc));
    }
    tube(T.moss, arc, () => 0.085, 7, 1, 0.6);
    tube(T.moss, arc.map((p, i) => new THREE.Vector3(p.x, p.y + Math.cos(i * 1.6) * 0.07, p.z + Math.sin(i * 1.6) * 0.07)), () => 0.035, 5, 1, 0.6);
    // 橫跨的三股絞藤
    for (let k = 0; k < 3; k++) {
      tube(T.bark, strand(-W, W, barY, zc, 0.1, (k / 3) * Math.PI * 2, 2.2, 22), () => 0.085, 7, 1, 0.8);
    }
    // 藤圈與粗藤之間的細藤
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(s * 0.15, barY(0.15) + 0.15, zc + 0.04);
      const b = new THREE.Vector3(s * 0.8, 2.25, zc - 0.04);
      tube(T.moss, [a, new THREE.Vector3((a.x + b.x) / 2, 2.15, zc), b], () => 0.03, 5, 1, 0.6);
    }
    // 葉子：沿藤圈、沿橫藤、往下垂的葉束（最低 1.17 m）
    for (let i = 1; i < arc.length - 1; i++) {
      if (rnd() < 0.3) continue;
      const p = arc[i];
      if (Math.abs(p.x) > 0.85) continue;
      addLeafCard(T, A, rnd, p.x, Math.min(p.y, hi - 0.2), zc, range(rnd, 0.32, 0.42), pick(rnd, [A.uv.plant.twig, A.uv.plant.ivy]));
    }
    for (let k = 0; k < 7; k++) {
      const x = range(rnd, -W + 0.15, W - 0.15);
      addLeafCard(T, A, rnd, x, barY(x) + range(rnd, -0.05, 0.12), zc, range(rnd, 0.3, 0.4));
    }
    for (let k = 0; k < 6; k++) {
      const x = -W + 0.2 + ((2 * W - 0.4) * (k + rnd() * 0.6)) / 6;
      const h = range(rnd, 0.32, 0.4);
      const y0 = barY(x) - 0.12;
      T.plants.add(A.tpl.card, trs(x, Math.max(lo + 0.05 + h / 2, y0 - h / 2), zc + range(rnd, -0.08, 0.08), 0, range(rnd, -0.4, 0.4), 0, h * 0.8, h, 1), A.uv.plant.leafBunch);
    }
  } else {
    // 兩側樹根柱
    for (const s of [-1, 1]) {
      const pts = [new THREE.Vector3(s * (W - 0.02), -0.1, zc + 0.05), new THREE.Vector3(s * (W - 0.07), 0.8, zc - 0.03), new THREE.Vector3(s * (W - 0.1), 1.55, zc)];
      tube(T.bark, pts, (tt) => 0.08 * (1 - 0.3 * tt), 6, 1, 1);
    }
    // 長苔的粗樹枝（頂端貼近 top、底部約 1.45）
    const a = new THREE.Vector3(-W, 1.92, zc);
    const b = new THREE.Vector3(W, 1.98, zc);
    addBranchLog(T, A, a, b, 0.24, -0.05, rnd, true);
    for (let i = 0; i < 4; i++) {
      const x = -0.8 + i * 0.55;
      T.moss.add(pick(rnd, A.tpl.blobLo), trs(x, 2.16, zc, 0, rnd() * 6, 0, 0.32, 0.1, 0.18), FULL_UV, 0.6, 0.6);
    }
    // 上方再交叉一條細藤，填滿到 2.55
    tube(T.moss, strand(-W, W, (x) => 2.3 + 0.12 * Math.cos(x * 1.3), zc, 0.05, 0, 1.5, 14), () => 0.05, 5, 1, 0.6);
    // 垂掛的松蘿（最低 1.15 m）
    for (let k = 0; k < 6; k++) {
      const x = -W + 0.25 + ((2 * W - 0.5) * (k + rnd() * 0.5)) / 6;
      const len = range(rnd, 0.35, 0.55);
      T.plants.add(A.tpl.card, trs(x, Math.max(lo + 0.05 + len / 2, 1.72 - len / 2), zc + range(rnd, -0.1, 0.1), 0, range(rnd, -0.5, 0.5), 0, 0.42, len, 1), A.uv.plant.hangMoss);
    }
    for (let k = 0; k < 5; k++) addLeafCard(T, A, rnd, range(rnd, -W + 0.2, W - 0.2), range(rnd, 2.1, 2.3), zc, 0.4);
  }
  return T;
}

// ───────────────────────── 擋牆 ─────────────────────────

/** 擋牆：variant 0 = 大樹樁；variant 1 = 苔蘚巨石＋樹根 */
function buildBlock(A: ForestAssets, v: number): ObsBatches {
  const T = batches();
  const rnd = seeded(7500 + v);
  const hw = BLOCK.width / 2;
  const hd = BLOCK.depth / 2;
  const zc = -hd;
  const H = BLOCK.height;
  if (v === 0) {
    // 橢圓樹樁：tube 圓周角 a 的方向是 (−sin a, 0, −cos a)
    const rx = hw - 0.06;
    const rz = hd - 0.05;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(0, -0.3 + ((H + 0.3) * i) / 8, zc));
    tube(
      T.bark,
      pts,
      (tt, a) => {
        const dx = -Math.sin(a);
        const dz = -Math.cos(a);
        const flare = 1 + 0.05 * Math.max(0, 1 - tt * 5);
        const base = 1 / Math.sqrt((dx / rx) ** 2 + (dz / rz) ** 2);
        return base * flare * (1 + 0.025 * Math.sin(a * 13) - 0.02 * Math.abs(Math.sin(a * 6 + tt * 3)));
      },
      24,
      3,
      1.3,
    );
    // 年輪切面（頂面）
    T.props.add(A.tpl.disc, trs(0, H - 0.005, zc, -Math.PI / 2, 0, 0, rx * 0.99, rz * 0.99, 1), A.uv.prop.ringsOld);
    // 根部外擴的樹根（不超出車道寬）
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as [number, number][]) {
      const a = new THREE.Vector3(sx * rx * 0.75, 0.55, zc + sz * rz * 0.6);
      const b = new THREE.Vector3(sx * (hw - 0.1), -0.1, zc + sz * (hd - 0.12));
      tube(T.bark, [a, new THREE.Vector3((a.x + b.x) / 2 + sx * 0.06, 0.25, (a.z + b.z) / 2), b], (tt) => 0.16 * (1 - 0.5 * tt), 6, 1, 1);
    }
    // 苔蘚：底部一圈、正面幾塊
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      T.moss.add(pick(rnd, A.tpl.blobLo), trs(Math.cos(a) * rx * 0.88, 0.12, zc + Math.sin(a) * rz * 0.8, 0, 0, 0, 0.3, 0.2, 0.13), FULL_UV, 0.6, 0.6);
    }
    for (const [x, y] of [[-0.45, 1.6], [0.5, 0.9], [0.1, 2.25]] as [number, number][]) {
      T.moss.add(pick(rnd, A.tpl.blobLo), trs(x, y, zc + rz * 0.86, 0, 0, 0, 0.28, 0.22, 0.1), FULL_UV, 0.6, 0.6);
    }
    // 層孔菌（正面）
    for (const [x, y] of [[-0.55, 1.25], [-0.45, 1.45], [0.6, 1.9]] as [number, number][]) {
      const nz = Math.sqrt(Math.max(0.05, 1 - (x / rx) ** 2));
      T.props.add(A.tpl.shelf, faceMatrix(x, y, zc + rz * nz * 0.96, x / rx * 0.6, 0, nz, 0, 0.17, 0.16, 0.15), A.uv.prop.fungus);
    }
    // 樹樁前的紅色香菇
    addMushrooms(T, A, rnd, 0.55, 0, -0.08, 3, 'red', 1.0, 0.25);
    addMushrooms(T, A, rnd, -0.65, 0, -0.1, 2, 'glow', 0.9, 0.2);
  } else {
    // 苔蘚巨石
    T.rock.add(A.tpl.blobLo[2], trs(0, 1.25, zc, 0, 0.4, 0, hw * 0.84, 1.06, hd * 0.84), FULL_UV, 1.5, 1.5);
    T.moss.add(A.tpl.blobLo[4], trs(0, 2.05, zc, 0, 1.1, 0, hw * 0.78, 0.36, hd * 0.8), FULL_UV, 1.2, 1.2);
    // 樹根從頂上垂下、抓著石頭
    for (const s of [-1, 1]) {
      const pts = [new THREE.Vector3(s * 0.2, 2.35, zc), new THREE.Vector3(s * 0.75, 1.8, zc + 0.35), new THREE.Vector3(s * 0.92, 0.9, zc + 0.3), new THREE.Vector3(s * 0.98, -0.1, zc + 0.25)];
      tube(T.bark, pts, (tt) => 0.11 * (1 - 0.35 * tt), 6, 1, 1);
    }
    // 底部蕨類與小香菇
    addFern(T, A, rnd, -0.7, 0, -0.3, 0.4);
    addFern(T, A, rnd, 0.7, 0, -0.35, 0.38);
    addMushrooms(T, A, rnd, 0.15, 0, -0.12, 3, 'brown', 0.9, 0.2);
  }
  return T;
}

// ───────────────────────── 斜坡 ─────────────────────────

/** 在 Batch 寫一個扇形（中心 c、外圈 ring），法線朝 n；依法線自動決定繞序 */
function addFan(b: Batch, c: THREE.Vector3, ring: THREE.Vector3[], n: THREE.Vector3, rect: { u: number; v: number; w: number; h: number }, uvOf: (p: THREE.Vector3) => [number, number]): void {
  const cuv = uvOf(c);
  for (let i = 0; i < ring.length - 1; i++) {
    let p1 = ring[i];
    let p2 = ring[i + 1];
    const cr = new THREE.Vector3().subVectors(p1, c).cross(new THREE.Vector3().subVectors(p2, c));
    if (cr.dot(n) < 0) [p1, p2] = [p2, p1];
    for (const [p, uv] of [[c, cuv], [p1, uvOf(p1)], [p2, uvOf(p2)]] as [THREE.Vector3, [number, number]][]) {
      b.vert(p.x, p.y, p.z, n.x, n.y, n.z, rect.u + uv[0] * rect.w, rect.v + uv[1] * rect.h);
    }
  }
}

/**
 * 斜坡：斜倒的巨樹幹（半圓木，削平的頂面就是斜坡面）＋防滑木條、頂端年輪切面、
 * 底下撐著的樹樁、側面苔蘚與香菇。
 */
function buildRamp(A: ForestAssets, v: number): ObsBatches {
  const T = batches();
  const rnd = seeded(7600 + v);
  const L = RAMP.length;
  const H = RAMP.height;
  const R = RAMP.width / 2;
  const len = Math.hypot(L, H);
  const S = new THREE.Vector3(0, H, -L).normalize();
  const N = new THREE.Vector3(0, L, H).normalize();
  const X = new THREE.Vector3(1, 0, 0);
  const rows = 9;
  const cols = 12;
  const w = rnd() * 10;
  // 樹皮半圓（θ 從 π 到 2π，在斜面下方）
  const p = new THREE.Vector3();
  grid(T.bark, cols, rows, (i, j, out) => {
    const s = j / rows;
    const th = Math.PI + (Math.PI * i) / cols;
    const edge = i === 0 || i === cols;
    const rr = edge ? R : R * (1 + 0.04 * Math.sin(th * 5 + s * 9 + w));
    p.set(0, 0, 0).addScaledVector(S, len * s).addScaledVector(X, Math.cos(th) * rr).addScaledVector(N, Math.sin(th) * rr);
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
    out[3] = (i / cols) * 3;
    out[4] = (s * len) / 1.6;
  });
  // 削平的頂面（x 由 +R 到 −R，法線才朝上）
  grid(T.rampTop, 1, rows, (i, j, out) => {
    const s = j / rows;
    const x = i === 0 ? R : -R;
    p.set(0, 0, 0).addScaledVector(S, len * s).addScaledVector(X, x);
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
    out[3] = x / (2 * R);
    out[4] = (s * len) / (2 * R);
  });
  // 防滑木條
  const ang = Math.atan2(H, L);
  for (let k = 1; k <= 7; k++) {
    const s = k / 8;
    const p = new THREE.Vector3().addScaledVector(S, len * s).addScaledVector(N, 0.025);
    T.rampTop.add(boxTpl(2 * R - 0.24, 0.05, 0.09, 0.015, 0.6), trs(p.x, p.y, p.z, ang, 0, 0));
  }
  // 頂端年輪切面（半圓）
  const top = new THREE.Vector3().addScaledVector(S, len);
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const th = Math.PI + (Math.PI * i) / 12;
    ring.push(new THREE.Vector3().copy(top).addScaledVector(X, Math.cos(th) * R).addScaledVector(N, Math.sin(th) * R));
  }
  addFan(T.props, top, ring, S, A.uv.prop.ringsFresh, (p) => {
    const d = new THREE.Vector3().subVectors(p, top);
    return [0.5 + (d.dot(X) / R) * 0.5, 0.5 + (d.dot(N) / R) * 0.5];
  });
  // 底下撐著的樹樁（頂端接到樹幹底面）
  const sz = -L * 0.86;
  const sy = H * 0.86 - R * Math.cos(ang) + 0.15;
  const sp = [new THREE.Vector3(0, -0.2, sz), new THREE.Vector3(0.03, sy * 0.5, sz), new THREE.Vector3(0, sy, sz)];
  tube(T.bark, sp, (tt, a) => 0.5 * (1 + 0.25 * Math.max(0, 1 - tt * 4)) * (1 + 0.05 * Math.sin(a * 7)), 12, 2, 1.2);
  // 側面苔蘚、斷枝、香菇
  for (let k = 0; k < 5; k++) {
    const s = range(rnd, 0.15, 0.85);
    const side = k % 2 === 0 ? -1 : 1;
    const th = side < 0 ? Math.PI * 1.08 : Math.PI * 1.92;
    const p = new THREE.Vector3().addScaledVector(S, len * s).addScaledVector(X, Math.cos(th) * R * 0.97).addScaledVector(N, Math.sin(th) * R * 0.97);
    T.moss.add(pick(rnd, A.tpl.blobLo), trs(p.x, p.y, p.z, -ang, 0, 0, 0.12, 0.3, 0.5), FULL_UV, 0.6, 0.6);
  }
  {
    const s = 0.55;
    const p = new THREE.Vector3().addScaledVector(S, len * s).addScaledVector(X, -R * 0.9).addScaledVector(N, -0.35);
    tube(T.bark, [p, new THREE.Vector3(-R * 0.98, p.y + 0.5, p.z + 0.25)], (tt) => 0.1 * (1 - 0.6 * tt), 6, 1, 1);
  }
  addMushrooms(T, A, rnd, 1.0, 0, -0.5, 3, 'brown', 0.8, 0.15);
  addMushrooms(T, A, rnd, -0.45, 0, sz + 0.75, 3, v === 0 ? 'red' : 'glow', 1, 0.3);
  return T;
}

// ───────────────────────── 組裝與快取 ─────────────────────────

/** 把障礙批次轉成網格群組（樹皮、岩石、斜坡面投影；小東西只接收陰影） */
function toGroup(A: ForestAssets, T: ObsBatches, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  /** 把一個批次輸出成網格加進障礙群組 */
  const put = (b: Batch, mat: THREE.Material, cast: boolean) => {
    const geo = b.geometry();
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
  };
  put(T.bark, A.mats.obsBark, true);
  put(T.moss, A.mats.moss, true);
  put(T.rock, A.mats.rock, true);
  put(T.rampTop, A.mats.rampTop, true);
  put(T.props, A.mats.props, false);
  put(T.plants, A.mats.plants, false);
  put(T.canopy, A.mats.canopy, false);
  return g;
}

/** 障礙模板快取 */
const obsCache = new Map<string, THREE.Group>();

/** 建立（或從快取複製）低欄／高橫樑／擋牆／斜坡 */
export function buildForestObstacle(A: ForestAssets, kind: 'hurdle' | 'highBar' | 'block' | 'ramp', variant: number): THREE.Object3D {
  const v = ((variant % 2) + 2) % 2;
  const key = `${kind}|${v}`;
  let tpl = obsCache.get(key);
  if (!tpl) {
    const T = kind === 'hurdle' ? buildHurdle(A, v) : kind === 'highBar' ? buildHighBar(A, v) : kind === 'block' ? buildBlock(A, v) : buildRamp(A, v);
    tpl = toGroup(A, T, `forest-${key}`);
    obsCache.set(key, tpl);
  }
  return tpl.clone();
}
