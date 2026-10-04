import * as THREE from 'three';

/**
 * 死亡森林共用的幾何工具：雜訊、批次組裝（Batch）、管子、倒角方塊、凹凸球、格網。
 *
 * 效能重點：一段場景有上千個小物件，如果每個都建成 Mesh 再交給 mergeByMaterial，
 * 光是複製與轉換就會超過 30 ms。所以這裡先用 Batch 依材質把三角形直接寫進同一組陣列，
 * 每個材質只產生一個 Mesh，最後再交給 mergeByMaterial 收尾（它只剩十幾個網格要處理）。
 */

// ───────────────────────── 雜訊與數學 ─────────────────────────

/** 整數雜湊 → 0..1（同輸入同輸出，用來做可重現的雜訊） */
function hash(a: number, b = 0, c = 0, s = 0): number {
  let h =
    (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x61c88647) ^ Math.imul(s | 0, 0x2545f491)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** smoothstep 內插權重 */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 1D 平滑雜訊（值域 0..1） */
export function noise1(x: number, s = 0): number {
  const i = Math.floor(x);
  const f = fade(x - i);
  const a = hash(i, 0, 0, s);
  return a + (hash(i + 1, 0, 0, s) - a) * f;
}

/** 2D 平滑雜訊（值域 0..1） */
export function noise2(x: number, y: number, s = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash(ix, iy, 0, s);
  const b = hash(ix + 1, iy, 0, s);
  const c = hash(ix, iy + 1, 0, s);
  const d = hash(ix + 1, iy + 1, 0, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 3D 平滑雜訊（值域 0..1） */
function noise3(x: number, y: number, z: number, s = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  /** 取格點 (ix+dx, iy+dy, iz+dz) 的雜湊值 */
  const l = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz, s);
  const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * fx;
  const x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * fx;
  const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * fx;
  const x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/**
 * 凹凸球（二十面體）縮放後的 UV 重複次數：u 繞一圈、v 從頂到底，
 * 依實際周長換算成「每 tile 公尺重複一次」，葉子／石紋才不會因為球變大而跟著放大。
 */
export function blobUV(sx: number, sy: number, sz: number, tile: number): [number, number] {
  return [Math.max(1, Math.round((2 * Math.PI * Math.max(sx, sz)) / tile)), Math.max(1, (Math.PI * sy) / tile)];
}

/** 夾在 a..b 之間 */
export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

/** smoothstep：x 在 a..b 之間平滑地從 0 到 1 */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 亂數工具：區間亂數、整數、挑一個 */
export interface Rng {
  (): number;
}
/** 回傳 [a, b) 的亂數 */
export function range(rnd: Rng, a: number, b: number): number {
  return a + (b - a) * rnd();
}
/** 從陣列挑一個 */
export function pick<T>(rnd: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

// ───────────────────────── 貼圖集 UV ─────────────────────────

/** 貼圖集中的一格（UV 範圍：左下角 u,v 與寬高） */
export interface UVRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

/** 整張貼圖（不轉換） */
export const FULL_UV: UVRect = { u: 0, v: 0, w: 1, h: 1 };

/**
 * n×n 貼圖集的第 (col,row) 格；row 0 是畫布最上面一列。
 * @param pad 往內縮的比例（避免 mipmap 取樣到隔壁格）
 */
export function cell(col: number, row: number, n: number, pad = 0.012): UVRect {
  const s = 1 / n;
  return { u: col * s + pad * s, v: 1 - (row + 1) * s + pad * s, w: s * (1 - 2 * pad), h: s * (1 - 2 * pad) };
}

/** 取一格裡的子矩形（fx、fy、fw、fh 為 0..1 比例；fy 由下往上量） */
export function subRect(r: UVRect, fx: number, fy: number, fw: number, fh: number): UVRect {
  return { u: r.u + r.w * fx, v: r.v + r.h * fy, w: r.w * fw, h: r.h * fh };
}

// ───────────────────────── 批次組裝 ─────────────────────────

/** 非索引的三角形資料（位置／法線／UV） */
export interface Tpl {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  /** 頂點數（三角形數 × 3） */
  count: number;
}

/** 把 BufferGeometry 轉成非索引的 Tpl（建模板時用一次） */
export function toTpl(geo: THREE.BufferGeometry): Tpl {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const t = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const count = p.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = p.getX(i);
    pos[i * 3 + 1] = p.getY(i);
    pos[i * 3 + 2] = p.getZ(i);
    nor[i * 3] = n.getX(i);
    nor[i * 3 + 1] = n.getY(i);
    nor[i * 3 + 2] = n.getZ(i);
    if (t) {
      uv[i * 2] = t.getX(i);
      uv[i * 2 + 1] = t.getY(i);
    }
  }
  return { pos, nor, uv, count };
}

/** 暫存：法線矩陣 */
const _nm = new THREE.Matrix3();
/** 暫存：單位矩陣 */
const IDENTITY = new THREE.Matrix4();

/**
 * 一個材質的三角形批次：把模板或程式產生的三角形（已套用矩陣）累積在同一組陣列，
 * 最後輸出一個非索引的 BufferGeometry。
 */
export class Batch {
  /** 位置（每頂點 3 個 float） */
  private p: Float32Array;
  /** 法線 */
  private n: Float32Array;
  /** UV */
  private t: Float32Array;
  /** 目前頂點數 */
  count = 0;

  /** 建立批次；capacity 是預先配置的頂點數（不夠會自動加倍） */
  constructor(capacity = 4096) {
    this.p = new Float32Array(capacity * 3);
    this.n = new Float32Array(capacity * 3);
    this.t = new Float32Array(capacity * 2);
  }

  /** 確保還放得下 add 個頂點（不夠就加倍） */
  private reserve(add: number): void {
    const need = this.count + add;
    let cap = this.p.length / 3;
    if (need <= cap) return;
    cap = Math.max(cap, 256);
    while (cap < need) cap *= 2;
    const p = new Float32Array(cap * 3);
    p.set(this.p);
    const n = new Float32Array(cap * 3);
    n.set(this.n);
    const t = new Float32Array(cap * 2);
    t.set(this.t);
    this.p = p;
    this.n = n;
    this.t = t;
  }

  /**
   * 加入一個模板：位置套用矩陣 m、法線套用法線矩陣；UV 先做 (u·su+ou, v·sv+ov)，再映射到貼圖集的 rect。
   * 矩陣有鏡像（行列式為負）時自動翻轉三角形繞序。
   */
  add(tpl: Tpl, m: THREE.Matrix4, rect: UVRect = FULL_UV, su = 1, sv = 1, ou = 0, ov = 0): void {
    const c = tpl.count;
    this.reserve(c);
    const e = m.elements;
    const ne = _nm.getNormalMatrix(m).elements;
    const flip = m.determinant() < 0;
    const P = this.p;
    const N = this.n;
    const T = this.t;
    const sp = tpl.pos;
    const sn = tpl.nor;
    const st = tpl.uv;
    let o = this.count;
    for (let i = 0; i < c; i++) {
      // 鏡像時交換每個三角形的第 2、3 個頂點
      const r = i % 3;
      const k = flip ? (r === 1 ? i + 1 : r === 2 ? i - 1 : i) : i;
      const x = sp[k * 3];
      const y = sp[k * 3 + 1];
      const z = sp[k * 3 + 2];
      P[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = sn[k * 3];
      const ny = sn[k * 3 + 1];
      const nz = sn[k * 3 + 2];
      let ax = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let ay = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      ax /= len;
      ay /= len;
      az /= len;
      N[o * 3] = ax;
      N[o * 3 + 1] = ay;
      N[o * 3 + 2] = az;
      T[o * 2] = rect.u + (st[k * 2] * su + ou) * rect.w;
      T[o * 2 + 1] = rect.v + (st[k * 2 + 1] * sv + ov) * rect.h;
      o++;
    }
    this.count = o;
  }

  /** 加入一個 BufferGeometry（轉成 Tpl 再加；給每段才建一次的程式幾何用） */
  addGeo(geo: THREE.BufferGeometry, m: THREE.Matrix4 = IDENTITY, rect: UVRect = FULL_UV, su = 1, sv = 1, ou = 0, ov = 0): void {
    this.add(toTpl(geo), m, rect, su, sv, ou, ov);
    geo.dispose();
  }

  /**
   * 直接寫入一個 (cols+1)×(rows+1) 的格網（位置 P、法線 N、UV U 都是緊密陣列，索引 = 列 × (cols+1) + 欄）。
   * 每個格子拆成兩個三角形；flip 反轉正面方向。
   */
  emitGrid(cols: number, rows: number, P: Float32Array, N: Float32Array, U: Float32Array, flip: boolean): void {
    const W = cols + 1;
    this.reserve(cols * rows * 6);
    const p = this.p;
    const n = this.n;
    const t = this.t;
    let o = this.count;
    /** 把格點 k 的位置、法線、UV 寫到輸出陣列 */
    const put = (k: number) => {
      p[o * 3] = P[k * 3];
      p[o * 3 + 1] = P[k * 3 + 1];
      p[o * 3 + 2] = P[k * 3 + 2];
      n[o * 3] = N[k * 3];
      n[o * 3 + 1] = N[k * 3 + 1];
      n[o * 3 + 2] = N[k * 3 + 2];
      t[o * 2] = U[k * 2];
      t[o * 2 + 1] = U[k * 2 + 1];
      o++;
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * W + i;
        const b = a + W;
        const c = a + 1;
        const d = b + 1;
        if (!flip) {
          put(a);
          put(b);
          put(c);
          put(c);
          put(b);
          put(d);
        } else {
          put(a);
          put(c);
          put(b);
          put(c);
          put(d);
          put(b);
        }
      }
    }
    this.count = o;
  }

  /** 直接加入一個頂點（位置、法線、UV），三個一組構成三角形 */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void {
    this.reserve(1);
    const o = this.count;
    this.p[o * 3] = x;
    this.p[o * 3 + 1] = y;
    this.p[o * 3 + 2] = z;
    this.n[o * 3] = nx;
    this.n[o * 3 + 1] = ny;
    this.n[o * 3 + 2] = nz;
    this.t[o * 2] = u;
    this.t[o * 2 + 1] = v;
    this.count = o + 1;
  }

  /**
   * 加入一個四邊形（a→b→c→d 依逆時針為正面），法線自動計算；uv 依序對應四個角。
   */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]): void {
    _e1.subVectors(b, a);
    _e2.subVectors(d, a);
    _fn.crossVectors(_e1, _e2).normalize();
    const nx = _fn.x;
    const ny = _fn.y;
    const nz = _fn.z;
    this.vert(a.x, a.y, a.z, nx, ny, nz, ua[0], ua[1]);
    this.vert(b.x, b.y, b.z, nx, ny, nz, ub[0], ub[1]);
    this.vert(c.x, c.y, c.z, nx, ny, nz, uc[0], uc[1]);
    this.vert(a.x, a.y, a.z, nx, ny, nz, ua[0], ua[1]);
    this.vert(c.x, c.y, c.z, nx, ny, nz, uc[0], uc[1]);
    this.vert(d.x, d.y, d.z, nx, ny, nz, ud[0], ud[1]);
  }

  /** 直接接上一份模板（不做任何變換，用 TypedArray.set 整段複製；預先算好的軌道用） */
  addRaw(tpl: Tpl): void {
    this.reserve(tpl.count);
    this.p.set(tpl.pos, this.count * 3);
    this.n.set(tpl.nor, this.count * 3);
    this.t.set(tpl.uv, this.count * 2);
    this.count += tpl.count;
  }

  /** 把目前內容複製成一份 Tpl（預先組好、之後整段複製用） */
  snapshot(): Tpl {
    const n = this.count;
    return { pos: this.p.slice(0, n * 3), nor: this.n.slice(0, n * 3), uv: this.t.slice(0, n * 2), count: n };
  }

  /** 清空（保留已配置的陣列，下一段場景重複使用，避免反覆配置與 GC） */
  reset(): void {
    this.count = 0;
  }

  /**
   * 輸出幾何（沒有內容時回傳 null）。不複製：直接把目前的陣列（子陣列視圖）交給幾何，批次清空；
   * reuse = true（每段場景共用的批次）時立刻配一組新陣列，容量取這次的 1.25 倍，下一段幾乎不用再長大。
   * 外框直接掃一次位置陣列算（three 的 computeBoundingBox／Sphere 走通用存取器，慢很多）；
   * 給了 bounds（已知的保守外框，例如整段場景）就直接用，不必掃。
   */
  geometry(bounds?: THREE.Box3, reuse = false): THREE.BufferGeometry | null {
    const n = this.count;
    if (n === 0) return null;
    const pos = this.p.subarray(0, n * 3);
    const nor = this.n.subarray(0, n * 3);
    const uvs = this.t.subarray(0, n * 2);
    const cap = reuse ? Math.ceil(n * 1.25) + 256 : 0;
    this.p = new Float32Array(cap * 3);
    this.n = new Float32Array(cap * 3);
    this.t = new Float32Array(cap * 2);
    this.count = 0;
    if (bounds) {
      const g0 = new THREE.BufferGeometry();
      g0.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g0.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g0.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      g0.boundingBox = bounds.clone();
      g0.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      return g0;
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n * 3; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    // 外接球取外框的半對角線（略保守，視錐剔除用夠了）
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    g.boundingSphere = new THREE.Sphere(center, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
    return g;
  }
}

/** 暫存向量 */
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _fn = new THREE.Vector3();

// ───────────────────────── 矩陣小工具 ─────────────────────────

/** 暫存：組合用 */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * 組出位移／旋轉（XYZ 歐拉角，弧度）／縮放矩陣。回傳共用的暫存矩陣，請立刻使用（例如 batch.add）。
 */
export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _eu.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_eu);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}


// ───────────────────────── 幾何產生器 ─────────────────────────

/** grid() 的暫存陣列（重複使用，避免每次配置） */
let _gp = new Float32Array(3 * 2048);
let _gn = new Float32Array(3 * 2048);
let _gu = new Float32Array(2 * 2048);
/** grid() 回呼用的輸出暫存：[x, y, z, u, v] */
const _go = [0, 0, 0, 0, 0];

/**
 * 直接把格網寫進批次（不建 BufferGeometry，比較快）。
 * fn(i, j, out)：i 為欄（0..cols）、j 為列（0..rows），把位置與 UV 寫進 out = [x, y, z, u, v]。
 * 法線用相鄰格點的差分算（平滑）；wrapU = 第一欄與最後一欄重合（管子接縫，法線一致）；
 * flip 反轉正面方向（預設正面法線 = 列方向 × 欄方向）。
 * UV 會再映射到貼圖集的 rect。
 */
export function grid(b: Batch, cols: number, rows: number, fn: (i: number, j: number, out: number[]) => void, wrapU = false, flip = false, rect: UVRect = FULL_UV): void {
  const W = cols + 1;
  const n = W * (rows + 1);
  if (_gp.length < n * 3) {
    _gp = new Float32Array(n * 6);
    _gn = new Float32Array(n * 6);
    _gu = new Float32Array(n * 4);
  }
  const P = _gp;
  const N = _gn;
  const U = _gu;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      fn(i, j, _go);
      const k = j * W + i;
      P[k * 3] = _go[0];
      P[k * 3 + 1] = _go[1];
      P[k * 3 + 2] = _go[2];
      U[k * 2] = rect.u + _go[3] * rect.w;
      U[k * 2 + 1] = rect.v + _go[4] * rect.h;
    }
  }
  for (let j = 0; j <= rows; j++) {
    const j0 = j > 0 ? j - 1 : 0;
    const j1 = j < rows ? j + 1 : rows;
    for (let i = 0; i <= cols; i++) {
      let i0 = i - 1;
      let i1 = i + 1;
      if (wrapU) {
        if (i0 < 0) i0 = cols - 1;
        if (i1 > cols) i1 = 1;
      } else {
        if (i0 < 0) i0 = 0;
        if (i1 > cols) i1 = cols;
      }
      const a = (j * W + i0) * 3;
      const bb = (j * W + i1) * 3;
      const c = (j0 * W + i) * 3;
      const d = (j1 * W + i) * 3;
      const ux = P[bb] - P[a];
      const uy = P[bb + 1] - P[a + 1];
      const uz = P[bb + 2] - P[a + 2];
      const vx = P[d] - P[c];
      const vy = P[d + 1] - P[c + 1];
      const vz = P[d + 2] - P[c + 2];
      const nx = vy * uz - vz * uy;
      const ny = vz * ux - vx * uz;
      const nz = vx * uy - vy * ux;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const k = (j * W + i) * 3;
      if (l < 1e-9) {
        // 退化（管子尖端收成一點）：沿用上一列的法線
        const kp = ((j > 0 ? j - 1 : j) * W + i) * 3;
        N[k] = N[kp];
        N[k + 1] = N[kp + 1];
        N[k + 2] = N[kp + 2];
        if (j === 0) N[k + 1] = 1;
        continue;
      }
      const s = flip ? -1 / l : 1 / l;
      N[k] = nx * s;
      N[k + 1] = ny * s;
      N[k + 2] = nz * s;
    }
  }
  b.emitGrid(cols, rows, P, N, U, flip);
}

/**
 * 沿中心線建立管子並直接寫進批次（樹幹、樹枝、樹根、藤蔓、原木、繩子都用它）。
 * 座標框用「平行移動」，管子在彎處不會扭轉。
 * 圓周角 a 的方向 = N·cos a + B·sin a；起始切線朝上時 N = (0,0,−1)、B = (−1,0,0)。
 * @param pts 中心線（至少 2 點）
 * @param rad (t, a) => 半徑；t 為 0..1 沿長度、a 為 0..2π 圓周角
 * @param radial 圓周分段數
 * @param uRep 圓周方向貼圖重複次數
 * @param vTile 沿長度方向每幾公尺重複一次貼圖
 */
export function tube(b: Batch, pts: THREE.Vector3[], rad: (t: number, a: number) => number, radial: number, uRep: number, vTile: number, rect: UVRect = FULL_UV): void {
  const n = pts.length;
  const T = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = pts[i > 0 ? i - 1 : 0];
    const c = pts[i < n - 1 ? i + 1 : n - 1];
    let x = c.x - a.x;
    let y = c.y - a.y;
    let z = c.z - a.z;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l;
    y /= l;
    z /= l;
    T[i * 3] = x;
    T[i * 3 + 1] = y;
    T[i * 3 + 2] = z;
  }
  // 起始法向：切線 × 最不平行的軸
  const tx = T[0];
  const ty = T[1];
  const tz = T[2];
  let nx: number;
  let ny: number;
  let nz: number;
  if (Math.abs(ty) < 0.9) {
    // T × (0,1,0)
    nx = -tz;
    ny = 0;
    nz = tx;
  } else {
    // T × (1,0,0)
    nx = 0;
    ny = tz;
    nz = -ty;
  }
  const Nf = new Float32Array(n * 3);
  const Bf = new Float32Array(n * 3);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = T[i * 3];
    const y = T[i * 3 + 1];
    const z = T[i * 3 + 2];
    // 平行移動：把上一個法向投影到新切線的垂直平面
    const d = nx * x + ny * y + nz * z;
    nx -= d * x;
    ny -= d * y;
    nz -= d * z;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    Nf[i * 3] = nx;
    Nf[i * 3 + 1] = ny;
    Nf[i * 3 + 2] = nz;
    // B = T × N
    Bf[i * 3] = y * nz - z * ny;
    Bf[i * 3 + 1] = z * nx - x * nz;
    Bf[i * 3 + 2] = x * ny - y * nx;
    if (i > 0) {
      const p = pts[i];
      const q = pts[i - 1];
      L[i] = L[i - 1] + Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
    }
  }
  const total = L[n - 1] || 1;
  const TWO_PI = Math.PI * 2;
  grid(
    b,
    radial,
    n - 1,
    (j, i, out) => {
      const a = (j / radial) * TWO_PI;
      const r = Math.max(0.004, rad(L[i] / total, j === radial ? 0 : a));
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = pts[i];
      out[0] = p.x + (Nf[i * 3] * ca + Bf[i * 3] * sa) * r;
      out[1] = p.y + (Nf[i * 3 + 1] * ca + Bf[i * 3 + 1] * sa) * r;
      out[2] = p.z + (Nf[i * 3 + 2] * ca + Bf[i * 3 + 2] * sa) * r;
      out[3] = (j / radial) * uRep;
      out[4] = L[i] / vTile;
    },
    true,
    true,
    rect,
  );
}

/**
 * 倒角方塊（6 面＋12 條倒角＋8 個角，共 44 個三角形）：地鐵跑酷式的圓潤厚實邊緣。
 * 每個三角形用平面法線（倒角會亮出一條高光）；UV 依法線主軸做三軸投影，uvScale 公尺 = 1 個貼圖單位。
 * bevel = 0 時只有 6 個面（12 個三角形）。
 * hidden 是要省略的面（位元遮罩）：HIDE_BOTTOM 朝下（埋在地裡）、HIDE_BACK 朝 −z（遊戲鏡頭永遠在後方看不到）、
 * HIDE_SIDES 朝 ±x。省掉看不到的面可以少很多頂點。
 */
export function bevelBox(w: number, h: number, d: number, bevel: number, uvScale = 1, hidden = 0): THREE.BufferGeometry {
  const hs = [w / 2, h / 2, d / 2];
  const b = Math.min(bevel, hs[0] * 0.95, hs[1] * 0.95, hs[2] * 0.95);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  /** 位於 axis 那一面上的角點（另外兩軸內縮 b） */
  const cp = (axis: number, s: number[]): THREE.Vector3 =>
    new THREE.Vector3(
      s[0] * (hs[0] - (axis === 0 ? 0 : b)),
      s[1] * (hs[1] - (axis === 1 ? 0 : b)),
      s[2] * (hs[2] - (axis === 2 ? 0 : b)),
    );
  /** 加入三角形：依「法線與重心同向」自動決定繞序（方塊是以原點為中心的凸多面體） */
  const tri = (a: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3) => {
    _e1.subVectors(c1, a);
    _e2.subVectors(c2, a);
    _fn.crossVectors(_e1, _e2);
    const cx = a.x + c1.x + c2.x;
    const cy = a.y + c1.y + c2.y;
    const cz = a.z + c1.z + c2.z;
    let p1 = c1;
    let p2 = c2;
    if (_fn.x * cx + _fn.y * cy + _fn.z * cz < 0) {
      p1 = c2;
      p2 = c1;
      _fn.negate();
    }
    _fn.normalize();
    if ((hidden & HIDE_BOTTOM && _fn.y < -0.3) || (hidden & HIDE_BACK && _fn.z < -0.3) || (hidden & HIDE_SIDES && Math.abs(_fn.x) > 0.7)) return;
    const ax = Math.abs(_fn.x);
    const ay = Math.abs(_fn.y);
    const az = Math.abs(_fn.z);
    for (const v of [a, p1, p2]) {
      pos.push(v.x, v.y, v.z);
      nor.push(_fn.x, _fn.y, _fn.z);
      if (ax >= ay && ax >= az) uv.push(v.z / uvScale, v.y / uvScale);
      else if (ay >= az) uv.push(v.x / uvScale, v.z / uvScale);
      else uv.push(v.x / uvScale, v.y / uvScale);
    }
  };
  /** 四邊形拆成兩個三角形 */
  const quad = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3, d2: THREE.Vector3) => {
    tri(a, b2, c);
    tri(a, c, d2);
  };
  // 6 個面
  for (let axis = 0; axis < 3; axis++) {
    const j = (axis + 1) % 3;
    const k = (axis + 2) % 3;
    for (const s of [-1, 1]) {
      /** 這一面的四個角之一（另外兩軸的正負號 sj、sk） */
      const corner = (sj: number, sk: number) => {
        const sg = [0, 0, 0];
        sg[axis] = s;
        sg[j] = sj;
        sg[k] = sk;
        return cp(axis, sg);
      };
      quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    }
  }
  // 12 條倒角
  for (let i = 0; i < 3 && b > 0; i++) {
    for (let j = i + 1; j < 3; j++) {
      const k = 3 - i - j;
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          /** 倒角邊上一個端點的三軸正負號 */
          const sg = (sk: number) => {
            const s = [0, 0, 0];
            s[i] = si;
            s[j] = sj;
            s[k] = sk;
            return s;
          };
          quad(cp(i, sg(-1)), cp(j, sg(-1)), cp(j, sg(1)), cp(i, sg(1)));
        }
      }
    }
  }
  // 8 個角
  for (const sx of b > 0 ? [-1, 1] : []) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = [sx, sy, sz];
        tri(cp(0, s), cp(1, s), cp(2, s));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** bevelBox 的省略面遮罩：朝下 */
export const HIDE_BOTTOM = 1;
/** bevelBox 的省略面遮罩：朝 −z（背對鏡頭） */
export const HIDE_BACK = 2;
/** bevelBox 的省略面遮罩：朝 ±x */
export const HIDE_SIDES = 4;

/** 倒角方塊模板快取（同尺寸共用） */
const boxCache = new Map<string, Tpl>();

/** 取得指定尺寸的倒角方塊模板（第一次建立後快取） */
export function boxTpl(w: number, h: number, d: number, bevel: number, uvScale = 1, hidden = 0): Tpl {
  const key = `${w}|${h}|${d}|${bevel}|${uvScale}|${hidden}`;
  let t = boxCache.get(key);
  if (!t) {
    t = toTpl(bevelBox(w, h, d, bevel, uvScale, hidden));
    boxCache.set(key, t);
  }
  return t;
}

/**
 * 依「位置」平滑法線：位置相同的頂點（例如二十面體的共用角）取面法線的平均，
 * 讓凹凸球體看起來是圓潤的，而不是一面一面的。
 */
function smoothNormalsByPosition(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const count = p.count;
  const acc = new Map<string, THREE.Vector3>();
  const keys: string[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const fnrm = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    keys.push(`${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`);
  }
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    fnrm.subVectors(c, b).cross(a.clone().sub(b)); // 面法線（面積加權）
    for (let k = 0; k < 3; k++) {
      const key = keys[i + k];
      let v = acc.get(key);
      if (!v) {
        v = new THREE.Vector3();
        acc.set(key, v);
      }
      v.add(fnrm);
    }
  }
  const nor = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = acc.get(keys[i])!.clone().normalize();
    nor[i * 3] = v.x;
    nor[i * 3 + 1] = v.y;
    nor[i * 3 + 2] = v.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
}

/**
 * 凹凸球（樹冠團塊、灌木、石頭、苔蘚墊）：單位半徑的二十面體加 3D 雜訊起伏，之後用矩陣縮放成橢球。
 * @param detail 細分等級（1 = 80 面、2 = 320 面）
 * @param amp 起伏幅度（相對半徑）
 * @param freq 起伏頻率
 */
export function blobGeometry(detail: number, seed: number, amp: number, freq: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n1 = noise3(x * freq + 11.3, y * freq + 7.1, z * freq + 3.7, seed);
    const n2 = noise3(x * freq * 2.3 + 1.1, y * freq * 2.3 + 9.4, z * freq * 2.3 + 5.2, seed + 9);
    const k = 1 + amp * ((n1 - 0.5) * 1.6 + (n2 - 0.5) * 0.6);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  smoothNormalsByPosition(g);
  return g;
}
