import * as THREE from 'three';
import type { ForestAssets } from './assets';
import { Batch, FULL_UV, blobUV, clamp, grid, noise2, pick, range, tube, trs, type Rng, type UVRect } from './geom';

/**
 * 森林植物與小道具的建模（全部直接寫進 Batch）：巨樹（樹幹、板根、地表根、苔蘚袖套、樹枝、樹冠、垂藤、纏藤、層孔菌）、
 * 蕨類、灌木、香菇、苔蘚石、倒木、拱起的樹根。
 * 場景段落、障礙、入口地標都共用這些函式。
 */

/** 植物與道具要寫入的批次（依材質分） */
export interface FloraTarget {
  bark: Batch;
  moss: Batch;
  canopy: Batch;
  plants: Batch;
  props: Batch;
  rock: Batch;
}

// ───────────────────────── 擺放矩陣 ─────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

/**
 * 讓模板的 +z 朝向 (nx,ny,nz)，再繞該方向轉 roll（卡片、切面、層孔菌用）。回傳共用暫存矩陣。
 */
export function faceMatrix(px: number, py: number, pz: number, nx: number, ny: number, nz: number, roll: number, sx: number, sy: number, sz = 1): THREE.Matrix4 {
  _v.set(nx, ny, nz).normalize();
  _q.setFromUnitVectors(_Z, _v);
  _qr.setFromAxisAngle(_Z, roll);
  _q.multiply(_qr);
  _p.set(px, py, pz);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

// ───────────────────────── 垂掛的帶狀植物 ─────────────────────────

/** 暫存向量（垂掛帶用） */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * 垂掛帶（藤蔓、松蘿）：兩片十字交叉的長條，每 segLen 公尺重複一次貼圖格，下端略微擺盪。
 * @param x,y,z 上端位置
 * @param len 長度
 * @param width 寬度
 */
export function addHanging(b: Batch, rect: UVRect, x: number, y: number, z: number, len: number, width: number, segLen: number, rnd: Rng): void {
  const segs = Math.max(1, Math.round(len / segLen));
  const sl = len / segs;
  const rot = rnd() * Math.PI;
  const sway = (rnd() - 0.5) * 0.6;
  for (const ang of [rot, rot + Math.PI / 2]) {
    const wx = (Math.cos(ang) * width) / 2;
    const wz = (Math.sin(ang) * width) / 2;
    for (let s = 0; s < segs; s++) {
      const y0 = y - s * sl;
      const y1 = y - (s + 1) * sl;
      const o0 = sway * Math.pow(s / segs, 2);
      const o1 = sway * Math.pow((s + 1) / segs, 2);
      _a.set(x - wx + o0, y0, z - wz);
      _b.set(x + wx + o0, y0, z + wz);
      _c.set(x + wx + o1, y1, z + wz);
      _d.set(x - wx + o1, y1, z - wz);
      b.quad(_d, _c, _b, _a, [rect.u, rect.v], [rect.u + rect.w, rect.v], [rect.u + rect.w, rect.v + rect.h], [rect.u, rect.v + rect.h]);
    }
  }
}

// ───────────────────────── 巨樹 ─────────────────────────

/** 巨樹參數 */
interface TreeOpts {
  /** 樹基中心 */
  x: number;
  z: number;
  /** 地面高度 */
  y: number;
  /** 樹幹基部半徑（不含外擴） */
  r: number;
  /** 樹幹高度 */
  h: number;
  /** 細緻度：0 近景、1 中景、2 遠景 */
  lod: 0 | 1 | 2;
  /** 板根、地表根尖端的 |x| 不可小於這個值（不伸進跑道） */
  keepOutX: number;
  /** 往跑道伸的樹枝方向（−1／+1，0 = 不伸） */
  reach: number;
  /** 伸向跑道的樹枝高度（樹冠隧道） */
  canopyY: number;
  /** 在跑道上方（|x| < 4.8）的垂掛物最低高度 */
  overTrackMinY: number;
  /** 是否加樹枝與樹冠（入口地標的樹自己加） */
  crown?: boolean;
  /** 樹冠團塊用高細分（入口地標） */
  hiCanopy?: boolean;
}

/** 某個方向是否朝向跑道、能伸多長才不會越過 keepOutX */
function allowedLen(ox: number, dx: number, startR: number, keepOutX: number, want: number): number {
  const toward = Math.sign(dx) !== Math.sign(ox) && Math.abs(dx) > 0.05;
  if (!toward) return want;
  return Math.min(want, (Math.abs(ox) - keepOutX - 0.4) / Math.abs(dx) - startR);
}

/**
 * 建一棵巨樹：樹幹（底部外擴成板根的稜、節瘤、微彎）、板根、地表拱根、苔蘚袖套、層孔菌、纏繞藤蔓、
 * 樹枝、樹冠團塊＋葉片卡、垂藤與松蘿。回傳樹幹中心函式（入口地標要接注連繩用）。
 */
export function addTree(t: FloraTarget, A: ForestAssets, rnd: Rng, o: TreeOpts): (yy: number) => [number, number] {
  const segs = o.lod === 0 ? 11 : o.lod === 1 ? 8 : 5;
  const radial = o.lod === 0 ? 16 : o.lod === 1 ? 12 : 8;
  const leanX = o.reach * o.r * (0.3 + 0.5 * rnd()) + (rnd() - 0.5) * o.r * 0.6;
  const leanZ = (rnd() - 0.5) * o.r * 0.8;
  const wob = rnd() * 10;
  // 板根方向（樹幹底部也朝這些方向鼓起稜線）
  const finCount = o.lod === 0 ? 5 + Math.floor(rnd() * 3) : o.lod === 1 ? 4 : 3;
  const phase = rnd() * Math.PI * 2;
  const finPhi: number[] = [];
  for (let k = 0; k < finCount; k++) finPhi.push(phase + (k / finCount) * Math.PI * 2 + (rnd() - 0.5) * 0.5);

  /** 樹幹中心（相對地面高度 yy） */
  const center = (yy: number): [number, number] => {
    const k = Math.max(0, yy) / o.h;
    return [
      o.x + leanX * k * k + Math.sin(k * 3.2 + wob) * o.r * 0.5 * k + Math.sin(k * 7.1 + wob * 2) * o.r * 0.12 * k,
      o.z + leanZ * k * k + Math.cos(k * 2.7 + wob) * o.r * 0.5 * k + Math.cos(k * 6.3 + wob) * o.r * 0.12 * k,
    ];
  };
  /** 方向 phi 有多朝向跑道（0..1；樹在跑道右邊時 −x 方向是 1） */
  const sideSign = Math.sign(o.x) || 1;
  /** 方向 phi 朝向跑道的程度（0..1） */
  const toward = (phi: number) => Math.max(0, -Math.cos(phi) * sideSign);
  /** 樹幹半徑（phi 為世界角度：方向 (cos phi, sin phi) 在 xz 平面） */
  const radius = (yy: number, phi: number): number => {
    const k = clamp(yy / o.h, 0, 1);
    const yc = Math.max(-1, yy);
    // 底部外擴：朝跑道那一側收小，樹基才不會擠到路肩
    const flare = 1 + 0.75 * (1 - 0.5 * toward(phi)) * Math.exp(-yc / 1.5);
    // 板根方向的稜線（越接近地面越明顯；朝跑道的板根不做稜）
    let lobes = 0;
    for (const fp of finPhi) {
      if (toward(fp) > 0.5) continue;
      const c = Math.cos(phi - fp);
      if (c > 0) lobes += c * c * c * c * c * c;
    }
    lobes *= 0.35 * Math.exp(-Math.max(0, yc) / 2.2);
    const gn = 1 + 0.08 * Math.sin(phi * 3 + yy * 0.45 + wob) + 0.06 * Math.sin(phi * 2 - yy * 0.8 + wob * 2) + 0.035 * Math.sin(phi * 7 + yy * 2.1);
    return o.r * (1 - 0.4 * k) * (flare + lobes) * gn;
  };

  // 分岔：約四成的近／中景樹在 hf 高度分成兩根副幹（輪廓比較不像電線桿）
  const fork = o.lod < 2 && o.crown !== false && rnd() < 0.4;
  const hf = fork ? o.h * range(rnd, 0.45, 0.6) : o.h;
  /** 樹頂（副幹末端）位置，放樹冠用 */
  const tips: [number, number, number][] = [];

  // 樹幹：tube 的圓周角 a 與世界角度的關係是 phi = −a − π/2（起始切線朝上時）
  const trunkTop = fork ? hf + 0.8 : o.h;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segs; i++) {
    const f = i / (segs - 1);
    const yy = -1 + (trunkTop + 1) * Math.pow(f, 1.45);
    const [cx, cz] = center(yy);
    pts.push(new THREE.Vector3(cx, o.y + yy, cz));
  }
  const uRep = Math.max(2, Math.round((2 * Math.PI * o.r * 1.3) / 2.2));
  tube(t.bark, pts, (tt, a) => radius(-1 + tt * (trunkTop + 1), -a - Math.PI / 2), radial, uRep, 2.4);
  if (fork) {
    const [fx, fz] = center(hf);
    const rF = radius(hf, 0) * 0.66;
    const fphi = rnd() * Math.PI * 2;
    for (let s = 0; s < 2; s++) {
      const phi = fphi + s * Math.PI + (rnd() - 0.5) * 0.7;
      const spread = range(rnd, 2.2, 4.2);
      const top = o.h * range(rnd, 0.92, 1.05);
      const sp: THREE.Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const tt = i / 5;
        const off = spread * Math.pow(tt, 1.25);
        sp.push(new THREE.Vector3(fx + Math.cos(phi) * off, o.y + hf - 0.6 + (top - hf + 0.6) * tt, fz + Math.sin(phi) * off));
      }
      tube(t.bark, sp, (tt) => rF * (1 - 0.45 * tt), Math.max(8, radial - 6), Math.max(2, Math.round(uRep * 0.6)), 2.4);
      const e = sp[sp.length - 1];
      tips.push([e.x, e.y, e.z]);
    }
  } else {
    const [tx, tz] = center(o.h);
    tips.push([tx, o.y + o.h, tz]);
  }

  // 折斷的樹枝殘幹（近景）：短粗的枝、末端是舊年輪切面、掛一點松蘿
  if (o.lod === 0) {
    for (let k = 0; k < 2; k++) {
      const yy = range(rnd, 3.5, Math.max(4, Math.min(9, hf - 1)));
      const phi = rnd() * Math.PI * 2;
      const [cx, cz] = center(yy);
      const rr = radius(yy, phi);
      const dx = Math.cos(phi);
      const dz = Math.sin(phi);
      // 朝跑道的斷枝不能伸進 keepOutX 以內
      const L = allowedLen(o.x, dx, rr, o.keepOutX, range(rnd, 1.0, 2.0));
      if (L < 0.5) continue;
      const rs = range(rnd, 0.16, 0.3);
      const a0 = new THREE.Vector3(cx + dx * rr * 0.6, o.y + yy, cz + dz * rr * 0.6);
      const a1 = new THREE.Vector3(cx + dx * (rr + L), o.y + yy + L * 0.45, cz + dz * (rr + L));
      tube(t.bark, [a0, new THREE.Vector3().lerpVectors(a0, a1, 0.5), a1], (tt) => rs * (1 - 0.3 * tt), 7, 1, 1.2);
      const d = new THREE.Vector3().subVectors(a1, a0).normalize();
      t.props.add(A.tpl.disc, faceMatrix(a1.x, a1.y, a1.z, d.x, d.y, d.z, rnd() * 6, rs * 0.7, rs * 0.7), A.uv.prop.ringsOld);
      addHanging(t.plants, A.uv.plant.hangMoss, a1.x, a1.y - rs, a1.z, range(rnd, 0.8, 1.8), 0.7, 1.2, rnd);
    }
  }

  // 板根：從樹幹往外蜿蜒的薄板
  const finSegs = o.lod === 0 ? 6 : o.lod === 1 ? 4 : 3;
  for (const phi of finPhi) {
    const L = allowedLen(o.x, Math.cos(phi), o.r, o.keepOutX, o.r * (0.9 + rnd() * 0.9) + 0.6);
    if (L < 0.5) continue;
    addFin(t.bark, o.x, o.y, o.z, phi, o.r, L, o.r * (1.15 + rnd() * 0.6), 0.22 + 0.08 * o.r, finSegs, rnd);
  }

  // 地表拱根：從樹基拱起、往外鑽進地裡（近景與中景）
  if (o.lod < 2) {
    const nr = o.lod === 0 ? 3 : 2;
    for (let k = 0; k < nr; k++) {
      const phi = phase + ((k + 0.5) / nr) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const dx = Math.cos(phi);
      const dz = Math.sin(phi);
      const len = allowedLen(o.x, dx, o.r * 1.4, o.keepOutX, range(rnd, 2.6, 4.8));
      if (len < 1) continue;
      const r0 = range(rnd, 0.22, 0.36) * Math.min(1.4, o.r / 1.8);
      const sx = o.x + dx * o.r * 0.9;
      const sz = o.z + dz * o.r * 0.9;
      const ex = o.x + dx * (o.r * 1.4 + len);
      const ez = o.z + dz * (o.r * 1.4 + len);
      const rp: THREE.Vector3[] = [];
      const wig = rnd() * 6;
      for (let i = 0; i <= 7; i++) {
        const s = i / 7;
        const side = Math.sin(s * Math.PI * 1.5 + wig) * 0.35;
        rp.push(new THREE.Vector3(sx + (ex - sx) * s - dz * side, o.y + 1.3 * Math.pow(1 - s, 1.6) + 0.35 * Math.sin(Math.PI * s) - 0.25 * s, sz + (ez - sz) * s + dx * side));
      }
      tube(t.bark, rp, (tt) => r0 * (1 - 0.7 * tt), o.lod === 0 ? 7 : 5, 1, 1.6);
    }
  }

  // 苔蘚袖套：包住樹基、上緣高低起伏
  if (o.lod < 2) {
    const mr = o.lod === 0 ? 20 : 10;
    const circ = 2 * Math.PI * o.r;
    const uR = Math.max(1, Math.round(circ / 1.5));
    grid(t.moss, mr, 3, (i, j, out) => {
      const phi = (i / mr) * Math.PI * 2;
      const top = 0.45 + 1.4 * noise2(Math.cos(phi) * 1.4 + wob, Math.sin(phi) * 1.4, 77);
      const f = [0, 0.5, 0.82, 1][j];
      const yy = -0.2 + (top + 0.2) * f;
      const [cx, cz] = center(yy);
      const rr = radius(yy, phi) * (1.06 - 0.09 * f * f * f) + 0.03;
      out[0] = cx + Math.cos(phi) * rr;
      out[1] = o.y + yy;
      out[2] = cz + Math.sin(phi) * rr;
      out[3] = (i / mr) * uR;
      out[4] = yy / 1.5;
    }, true);
  }

  if (o.lod === 0) {
    // 層孔菌
    const nf = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < nf; k++) {
      const phi = rnd() * Math.PI * 2;
      const yy = range(rnd, 1.2, 4.8);
      const [cx, cz] = center(yy);
      const rr = radius(yy, phi) * 0.95;
      const s = range(rnd, 0.22, 0.5);
      for (let j = 0; j < 2; j++) {
        t.props.add(A.tpl.shelf, faceMatrix(cx + Math.cos(phi) * rr, o.y + yy + j * s * 0.45, cz + Math.sin(phi) * rr, Math.cos(phi), 0, Math.sin(phi), 0, s * (1 - j * 0.3), s * 0.8, s * (1 - j * 0.3)), A.uv.prop.fungus);
      }
    }
    // 纏繞的藤蔓（螺旋）＋藤上的小葉
    const phi0 = rnd() * Math.PI * 2;
    const turns = (rnd() < 0.5 ? -1 : 1) * range(rnd, 0.5, 0.85);
    const top = Math.min(range(rnd, 6, 10), hf - 1);
    const vp: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const yy = 0.1 + (top * i) / 16;
      const phi = phi0 + yy * turns;
      const [cx, cz] = center(yy);
      const rr = radius(yy, phi) + 0.06;
      vp.push(new THREE.Vector3(cx + Math.cos(phi) * rr, o.y + yy, cz + Math.sin(phi) * rr));
    }
    tube(t.moss, vp, () => 0.075, 5, 1, 1);
    for (let i = 2; i < vp.length; i += 2) {
      const p = vp[i];
      const [cx, cz] = center(p.y - o.y);
      const nx = p.x - cx;
      const nz = p.z - cz;
      t.plants.add(A.tpl.card, faceMatrix(p.x + nx * 0.05, p.y, p.z + nz * 0.05, nx, 0.2, nz, rnd() * 6.28, 0.8, 0.8), A.uv.plant.twig);
    }
  }

  // 樹枝與樹冠
  if (o.crown !== false) {
    const nb = o.lod === 0 ? 2 + Math.floor(rnd() * 2) : o.lod === 1 ? 1 + Math.floor(rnd() * 2) : 0;
    for (let k = 0; k < nb; k++) {
      const reachIt = o.reach !== 0 && k === 0;
      const hb = Math.min(reachIt ? o.canopyY - range(rnd, 4.5, 6.5) : o.h * range(rnd, 0.5, 0.78), hf - 0.8);
      const [cx, cz] = center(hb);
      const phi = reachIt ? (o.reach > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.9 : rnd() * Math.PI * 2;
      const L = reachIt ? Math.max(4, Math.abs(o.x) - range(rnd, 1, 4)) : range(rnd, 4, 8);
      const rise = reachIt ? o.canopyY - hb - 1.5 : range(rnd, 2, 5);
      const dx = Math.cos(phi);
      const dz = Math.sin(phi);
      const p0 = new THREE.Vector3(cx, o.y + hb, cz);
      const p2 = new THREE.Vector3(cx + dx * L, o.y + hb + rise, cz + dz * L);
      const p1 = new THREE.Vector3(cx + dx * L * 0.45, o.y + hb + rise * 0.85, cz + dz * L * 0.45);
      const bp: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const s = i / 6;
        const a = (1 - s) * (1 - s);
        const b2 = 2 * (1 - s) * s;
        const c = s * s;
        bp.push(new THREE.Vector3(a * p0.x + b2 * p1.x + c * p2.x, a * p0.y + b2 * p1.y + c * p2.y, a * p0.z + b2 * p1.z + c * p2.z));
      }
      const rb = radius(hb, phi) * 0.42;
      tube(t.bark, bp, (tt) => rb * (1 - 0.62 * tt), o.lod === 0 ? 8 : 6, 2, 2.2);
      // 樹枝末端的樹冠
      addCanopyBlob(t, A, rnd, p2.x, p2.y + 1.2, p2.z, range(rnd, 4.5, 6.5), range(rnd, 2.6, 3.6), o.lod, o.hiCanopy);
      if (reachIt) addCanopyBlob(t, A, rnd, p1.x, p1.y + 2.0, p1.z, range(rnd, 3.5, 5), range(rnd, 2.2, 3), o.lod, o.hiCanopy);
      // 垂藤與松蘿
      if (o.lod === 0) {
        for (let i = 2; i <= 6; i++) {
          if (rnd() < 0.35) continue;
          const p = bp[i];
          const overTrack = Math.abs(p.x) < 4.8;
          const maxLen = overTrack ? p.y - o.overTrackMinY : p.y - 0.8;
          if (maxLen < 1) continue;
          if (rnd() < 0.55) {
            addHanging(t.plants, A.uv.plant.ivy, p.x, p.y, p.z, Math.min(maxLen, range(rnd, 3, 9)), 0.55, 1.5, rnd);
          } else {
            addHanging(t.plants, A.uv.plant.hangMoss, p.x, p.y, p.z, Math.min(maxLen, range(rnd, 1.2, 2.6)), 0.9, 1.3, rnd);
          }
        }
      }
    }
    // 樹頂（或兩根副幹末端）的樹冠
    for (const [tx, ty, tz] of tips) {
      const big = tips.length === 1 ? 1 : 0.8;
      addCanopyBlob(t, A, rnd, tx, ty + 1.5, tz, range(rnd, 5.5, 8) * big * (o.lod === 2 ? 1.2 : 1), range(rnd, 3.5, 5) * big, o.lod, o.hiCanopy);
      if (o.lod < 2 && tips.length === 1) addCanopyBlob(t, A, rnd, tx + range(rnd, -4, 4), ty - 1.5, tz + range(rnd, -4, 4), range(rnd, 4, 6), range(rnd, 2.5, 3.5), o.lod, o.hiCanopy);
    }
  }
  return center;
}

/**
 * 板根：從樹幹往外蜿蜒、越往外越矮越薄的板子（截面是圓頂的薄牆）。
 */
function addFin(b: Batch, x: number, y: number, z: number, phi: number, r: number, L: number, H0: number, T0: number, segs: number, rnd: Rng): void {
  const dx = Math.cos(phi);
  const dz = Math.sin(phi);
  // 側向（水平、垂直於板根走向）
  const sx = -dz;
  const sz = dx;
  const mea = (rnd() - 0.5) * 0.9;
  const uMax = Math.max(1, H0 / 1.6);
  // 截面：從 +側向的底部，經過頂端，繞到 −側向的底部（這個順序法線才朝外）
  const PX = [0.5, 0.5, 0.36, 0, -0.36, -0.5, -0.5];
  const PY = [-0.45, 0.55, 0.88, 1, 0.88, 0.55, -0.45];
  grid(b, 6, segs, (i, j, out) => {
    const s = j / segs;
    const along = r * 0.45 + (r * 0.55 + L) * s;
    const off = Math.sin(s * Math.PI) * mea;
    const px = x + dx * along + sx * off;
    const pz = z + dz * along + sz * off;
    const H = H0 * Math.pow(1 - s, 1.5) + 0.1;
    const T = T0 * (1 - 0.55 * s);
    const lx = PX[i] * T;
    const ly = PY[i] < 0 ? PY[i] : PY[i] * H;
    out[0] = px + sx * lx;
    out[1] = y + ly;
    out[2] = pz + sz * lx;
    out[3] = (i / 6) * uMax;
    out[4] = along / 2.4;
  });
}

/**
 * 樹冠團塊：凹凸橢球（葉叢貼圖）＋周圍一圈葉片卡（破開圓滾滾的輪廓）。
 * @param s 水平半徑
 * @param sy 垂直半徑
 * @param hi 用高細分球（入口地標等近看的樹冠）
 */
export function addCanopyBlob(t: FloraTarget, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, s: number, sy: number, lod: number, hi = false): void {
  const tplB = hi ? pick(rnd, A.tpl.blobHi) : pick(rnd, A.tpl.blobLo);
  const sz = s * range(rnd, 0.8, 1.15);
  const [cu, cv] = blobUV(s, sy, sz, 6);
  t.canopy.add(tplB, trs(x, y, z, 0, rnd() * 6.28, 0, s, sy, sz), FULL_UV, cu, cv);
  const cards = lod === 0 ? 12 : lod === 1 ? 6 : 0;
  for (let k = 0; k < cards; k++) {
    const th = rnd() * Math.PI * 2;
    const el = range(rnd, -0.95, 0.55);
    const dx = Math.cos(el) * Math.cos(th);
    const dy = Math.sin(el);
    const dz = Math.cos(el) * Math.sin(th);
    const size = range(rnd, 2.4, 3.8);
    t.plants.add(A.tpl.card, faceMatrix(x + dx * s * 0.95, y + dy * sy * 0.9, z + dz * sz * 0.95, dx, dy * 0.4, dz, rnd() * 6.28, size, size), A.uv.plant.twig);
  }
}

// ───────────────────────── 地被與小道具 ─────────────────────────

/** 蕨類 */
export function addFern(t: FloraTarget, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, size: number): void {
  const k = Math.floor(rnd() * A.tpl.ferns.length);
  t.plants.add(A.tpl.ferns[k], trs(x, y - 0.03, z, 0, rnd() * 6.28, 0, size, size * range(rnd, 0.8, 1.15), size), k % 2 === 0 ? A.uv.plant.fern : A.uv.plant.fern2);
}

/** 灌木：小團葉叢＋一圈闊葉卡 */
export function addBush(t: FloraTarget, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, s: number, cards = 10): void {
  const blob = pick(rnd, A.tpl.blobLo);
  const [bu, bv] = blobUV(s * 0.72, s * 0.5, s * 0.72, 4);
  t.canopy.add(blob, trs(x, y + s * 0.35, z, 0, rnd() * 6.28, 0, s * 0.72, s * 0.5, s * 0.72 * range(rnd, 0.8, 1.1)), FULL_UV, bu, bv);
  for (let k = 0; k < cards; k++) {
    const th = (k / cards) * Math.PI * 2 + rnd() * 0.5;
    const el = range(rnd, -0.2, 0.7);
    const dx = Math.cos(el) * Math.cos(th);
    const dy = Math.sin(el);
    const dz = Math.cos(el) * Math.sin(th);
    const size = s * range(rnd, 1.0, 1.45);
    t.plants.add(A.tpl.card, faceMatrix(x + dx * s * 0.7, y + s * 0.38 + dy * s * 0.5, z + dz * s * 0.7, dx, dy * 0.5 + 0.25, dz, rnd() * 6.28, size, size), rnd() < 0.6 ? A.uv.plant.broad : A.uv.plant.twig);
  }
}

/** 香菇種類 */
type MushroomKind = 'red' | 'brown' | 'glow';

/**
 * 一叢香菇（菇柄＋半球菇傘＋菌褶）。
 * @param spread 散佈範圍（公尺；預設 0.7 × scale）
 */
export function addMushrooms(t: FloraTarget, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, n: number, kind: MushroomKind, scale: number, spread = 0.7 * scale): void {
  const capRect = kind === 'red' ? A.uv.prop.capRed : kind === 'brown' ? A.uv.prop.capBrown : A.uv.prop.capGlow;
  for (let i = 0; i < n; i++) {
    const px = x + (rnd() - 0.5) * spread;
    const pz = z + (rnd() - 0.5) * spread;
    const big = i === 0 ? 1.4 : 1;
    const h = (0.1 + rnd() * 0.16) * scale * big;
    const cr = (0.07 + rnd() * 0.07) * scale * big;
    const tx = (rnd() - 0.5) * 0.3;
    const tz = (rnd() - 0.5) * 0.3;
    t.props.add(A.tpl.stem, trs(px, y - 0.03, pz, tx, 0, tz, cr * 0.32, h + 0.03, cr * 0.32), A.uv.prop.stem);
    const cy = y + h - cr * 0.08;
    const ox = Math.sin(tz) * -h;
    const oz = Math.sin(tx) * h;
    t.props.add(A.tpl.cap, trs(px + ox, cy, pz + oz, tx, rnd() * 6.28, tz, cr, cr * (kind === 'red' ? 0.7 : 0.55), cr), capRect);
    t.props.add(A.tpl.gills, trs(px + ox, cy + 0.003, pz + oz, Math.PI / 2 + tx, 0, tz, cr * 0.97, cr * 0.97, 1), A.uv.prop.gills);
  }
}

/** 苔蘚石：凹凸石頭＋頂上一層苔蘚 */
export function addRock(t: FloraTarget, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, s: number, mossy = true): void {
  const ry = rnd() * 6.28;
  const [ru, rv] = blobUV(s * 1.15, s * 0.72, s, 2);
  t.rock.add(pick(rnd, A.tpl.rocks), trs(x, y + s * 0.22, z, (rnd() - 0.5) * 0.3, ry, 0, s * 1.15, s * 0.72, s), FULL_UV, ru, rv);
  if (mossy && rnd() < 0.75) {
    // 苔蘚頂：略小、略傾斜、偏向一側，看起來是長在石頭上而不是蓋一片綠蓋子
    const [mu, mv] = blobUV(s, s * 0.4, s * 0.85, 1.5);
    t.moss.add(pick(rnd, A.tpl.blobLo), trs(x + (rnd() - 0.5) * s * 0.3, y + s * 0.52, z + (rnd() - 0.5) * s * 0.3, (rnd() - 0.5) * 0.4, ry + 1, (rnd() - 0.5) * 0.4, s * 0.88, s * 0.36, s * 0.72), FULL_UV, mu, mv);
  }
}

/**
 * 倒木：凹凸圓木（樹皮）、兩端年輪切面、上方苔蘚。
 * @param old 舊切面（灰、長苔）
 */
export function addLog(t: FloraTarget, A: ForestAssets, rnd: Rng, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, old: boolean, mossy: boolean): void {
  const a = new THREE.Vector3(x0, y0, z0);
  const b = new THREE.Vector3(x1, y1, z1);
  const len = a.distanceTo(b);
  const n = Math.max(2, Math.ceil(len / 2.2));
  const pts: THREE.Vector3[] = [];
  const w = rnd() * 10;
  for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3().lerpVectors(a, b, i / n));
  tube(t.bark, pts, (tt, ang) => r * (1 + 0.05 * Math.sin(ang * 3 + tt * 9 + w) + 0.04 * Math.sin(ang * 7 - w)), 12, Math.max(2, Math.round((2 * Math.PI * r) / 1.4)), 1.8);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const rings = old ? A.uv.prop.ringsOld : A.uv.prop.ringsFresh;
  t.props.add(A.tpl.disc, faceMatrix(b.x, b.y, b.z, dir.x, dir.y, dir.z, rnd() * 6.28, r * 1.02, r * 1.02), rings);
  t.props.add(A.tpl.disc, faceMatrix(a.x, a.y, a.z, -dir.x, -dir.y, -dir.z, rnd() * 6.28, r * 1.02, r * 1.02), rings);
  if (mossy) {
    const m = Math.max(1, Math.floor(len / 1.5));
    for (let i = 0; i < m; i++) {
      const p = new THREE.Vector3().lerpVectors(a, b, (i + 0.5) / m);
      t.moss.add(pick(rnd, A.tpl.blobLo), trs(p.x, p.y + r * 0.62, p.z, 0, Math.atan2(dir.x, dir.z), 0, r * 0.85, r * 0.42, Math.min(1.1, len / m) * 0.7), FULL_UV, 1, 1);
    }
  }
}

/**
 * 拱起的樹根：從地面冒出、拱起後再鑽回地裡。
 * @param h 拱起高度
 */
export function addRoot(b: Batch, x0: number, z0: number, x1: number, z1: number, y: number, h: number, r0: number, rnd: Rng): void {
  const pts: THREE.Vector3[] = [];
  const w = rnd() * 6;
  const n = 8;
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const px = -(z1 - z0) / len;
  const pz = (x1 - x0) / len;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const wig = Math.sin(s * Math.PI * 2 + w) * 0.25;
    pts.push(new THREE.Vector3(x0 + (x1 - x0) * s + px * wig, y - 0.2 + (h + 0.2) * Math.pow(Math.sin(Math.PI * s), 0.8), z0 + (z1 - z0) * s + pz * wig));
  }
  tube(b, pts, (tt) => r0 * (1 - 0.45 * tt), 7, 1, 1.4);
}

/** 小芽／草叢（十字交叉的兩片卡） */
export function addSprout(t: FloraTarget, A: ForestAssets, rnd: Rng, x: number, y: number, z: number, s: number, rect: UVRect): void {
  const ry = rnd() * Math.PI;
  for (const a of [ry, ry + Math.PI / 2]) {
    t.plants.add(A.tpl.card, trs(x, y + s * 0.45, z, 0, a, 0, s, s, 1), rect);
  }
}
