import * as THREE from 'three';
import { seeded } from '../../proctex';

/**
 * 木葉村場景的幾何建構器：把大量小零件（盒子、倒角盒、圓柱、平面）的三角形
 * 直接寫進「每個材質一組」的頂點陣列，最後每個材質只產生一個網格。
 * 這樣比「每個零件一個 Mesh 再交給 mergeByMaterial」快很多（不必複製幾何、轉非索引），
 * 一段場景數百個零件也能在幾毫秒內建好；最後仍呼叫 mergeByMaterial 收尾（只剩少數網格，成本很低）。
 *
 * 合併後只保留 position／normal／uv（merge.ts 會丟掉其他屬性），所以顏色變化一律靠圖集貼圖的 UV：
 * - pt：所有頂點指到圖集裡的一個色塊（純色零件）
 * - rect：整個面貼到圖集裡的一張小圖（招牌、窗、暖簾）
 * - tile：沿零件長軸依公尺平鋪、v 落在某條色帶內（木紋、牆面）
 */

/** UV 映射規格 */
export type UVSpec =
  | { k: 'pt'; u: number; v: number }
  | { k: 'rect'; u0: number; v0: number; u1: number; v1: number }
  | { k: 'tile'; su: number; v0: number; v1: number; uo?: number };

/** 平鋪型的 UV 規格 */
export type TileUV = Extract<UVSpec, { k: 'tile' }>;

/** 盒子的選項 */
interface BoxOpts {
  /** 個別面的 UV（索引 0..5 = +x, −x, +y, −y, +z, −z），沒給的面用整體 UV */
  faces?: (UVSpec | undefined)[];
  /** 倒角帶與角落的 UV（預設跟著所屬的面）；面與面貼不同圖時要給，避免倒角拉出整片圖集 */
  edge?: UVSpec;
  /** 不輸出的面（位元遮罩，1 << 面索引），例如貼地的底面 */
  skip?: number;
}

/** 面索引常數 */
export const PX = 0;
export const NX = 1;
export const PY = 2;
const NY = 3;
export const PZ = 4;
export const NZ = 5;
/** 常用的面遮罩 */
export const SKIP_BOTTOM = 1 << NY;

/**
 * 各面的座標系：法線軸 a、正負 sg；s 軸（面上往右）與 t 軸（面上往上），
 * 「右、上」是從面的外側看過去的方向，所以圖片貼上去不會左右顛倒。
 */
const FACES: { a: number; sg: number; sa: number; ss: number; ta: number; ts: number }[] = [
  { a: 0, sg: 1, sa: 2, ss: -1, ta: 1, ts: 1 }, // +x：s = −z、t = +y
  { a: 0, sg: -1, sa: 2, ss: 1, ta: 1, ts: 1 }, // −x：s = +z、t = +y
  { a: 1, sg: 1, sa: 0, ss: 1, ta: 2, ts: -1 }, // +y：s = +x、t = −z
  { a: 1, sg: -1, sa: 0, ss: 1, ta: 2, ts: 1 }, // −y：s = +x、t = +z
  { a: 2, sg: 1, sa: 0, ss: 1, ta: 1, ts: 1 }, // +z：s = +x、t = +y
  { a: 2, sg: -1, sa: 0, ss: -1, ta: 1, ts: 1 }, // −z：s = −x、t = +y
];

/** 依面索引找出「法線軸 = a、正負 = sg」的面 */
function faceOf(a: number, sg: number): number {
  return a * 2 + (sg > 0 ? 0 : 1);
}

/** 一個材質的頂點緩衝（非索引三角形），可選擇附帶搖擺動畫用的樞紐與參數 */
class GeoBuf {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  /** 搖擺樞紐（每頂點 vec3），只有搖擺材質才有 */
  piv: Float32Array | null;
  /** 搖擺參數（振幅、頻率、相位） */
  swy: Float32Array | null;
  /** 目前的頂點數 */
  n = 0;
  private cap: number;

  /**
   * @param sway 是否附帶搖擺動畫的頂點屬性（樞紐、擺動參數）
   * @param cap 初始容量（頂點數），不夠時自動加倍
   */
  constructor(sway: boolean, cap = 4096) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.nor = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.piv = sway ? new Float32Array(cap * 3) : null;
    this.swy = sway ? new Float32Array(cap * 3) : null;
  }

  /** 確保還能再放 add 個頂點（不夠就加倍擴充） */
  reserve(add: number): void {
    if (this.n + add <= this.cap) return;
    let cap = this.cap * 2;
    while (cap < this.n + add) cap *= 2;
    /** 配置新容量的陣列並複製既有資料（k 是每頂點的分量數） */
    const grow = (a: Float32Array, k: number) => {
      const b = new Float32Array(cap * k);
      b.set(a.subarray(0, this.n * k));
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nor = grow(this.nor, 3);
    this.uv = grow(this.uv, 2);
    if (this.piv) this.piv = grow(this.piv, 3);
    if (this.swy) this.swy = grow(this.swy, 3);
    this.cap = cap;
  }

  /**
   * 轉成 BufferGeometry。
   * @param views true：直接用緩衝的子陣列（不複製；之後這個緩衝不能再用），false：複製到剛好的長度
   * @param bounds 指定包圍盒（整段場景用固定的大盒子即可）；不給就用一次緊湊的迴圈算
   */
  toGeometry(views = false, bounds?: THREE.Box3): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n3 = this.n * 3;
    /** 取前 len 個元素：views 時直接共用記憶體，否則複製 */
    const cut = (a: Float32Array, len: number) => (views ? a.subarray(0, len) : a.slice(0, len));
    const pos = cut(this.pos, n3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(cut(this.nor, n3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(cut(this.uv, this.n * 2), 2));
    if (this.piv && this.swy) {
      g.setAttribute('aPivot', new THREE.BufferAttribute(cut(this.piv, n3), 3));
      g.setAttribute('aSway', new THREE.BufferAttribute(cut(this.swy, n3), 3));
    }
    let box: THREE.Box3;
    if (bounds) box = bounds.clone();
    else {
      let x0 = Infinity;
      let y0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < n3; i += 3) {
        const x = pos[i];
        const y = pos[i + 1];
        const z = pos[i + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    }
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return g;
  }
}

/** 預製件的一段（一個材質的頂點資料，區域座標） */
interface PrefabPart {
  mat: THREE.Material;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  piv: Float32Array | null;
  swy: Float32Array | null;
  n: number;
}

/** 預製件：事先建好的一組零件（房子、道具、樹），建場景時用 stamp() 平移或翻轉後整段複製 */
export interface Prefab {
  parts: PrefabPart[];
  /** 三角形數（除錯、統計用） */
  tris: number;
}

/** 頂點緩衝池：同一個材質的緩衝在下一次建構時重複使用（容量只會長一次，不必每段場景重新配置、擴充） */
const bufPool = new Map<THREE.Material, GeoBuf>();

/** 每個材質的陰影設定（投影、接收），建構器輸出網格時套用 */
export const SHADOW = new WeakMap<THREE.Material, { cast: boolean; receive: boolean }>();

/** 需要搖擺頂點屬性的材質（燈籠、旗子） */
export const SWAY_MATS = new WeakSet<THREE.Material>();

/** 共用的暫存矩陣（place() 回傳它，呼叫端要立刻用掉） */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * 組出零件的變換矩陣：位置＋旋轉（YXZ 順序：先 z 再 x 再 y）＋縮放。
 * 回傳共用的暫存矩陣，呼叫端要在下一次呼叫 place() 之前用掉。
 */
export function place(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

/** 攤平後的模板（非索引的位置、法線、UV） */
interface FlatTpl {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  count: number;
}
/** 模板攤平結果的快取 */
const flatCache = new WeakMap<THREE.BufferGeometry, FlatTpl>();

/** 把模板幾何攤平成非索引陣列（只做一次） */
function flatOf(g: THREE.BufferGeometry): FlatTpl {
  let f = flatCache.get(g);
  if (f) return f;
  const ng = g.index ? g.toNonIndexed() : g;
  const count = ng.attributes.position.count;
  const uvA = ng.attributes.uv;
  f = {
    pos: Float32Array.from(ng.attributes.position.array as ArrayLike<number>),
    nor: Float32Array.from(ng.attributes.normal.array as ArrayLike<number>),
    uv: uvA ? Float32Array.from(uvA.array as ArrayLike<number>) : new Float32Array(count * 2).fill(0.5),
    count,
  };
  flatCache.set(g, f);
  return f;
}

/** 倒角盒的十二條邊：面 A（軸 a、正負 sa）與面 B（軸 bb、正負 sb），沿第三軸 c */
const EDGES: { a: number; bb: number; c: number; sa: number; sb: number }[] = [];
for (let a = 0; a < 3; a++) {
  for (let bb = a + 1; bb < 3; bb++) {
    for (const sa of [1, -1]) for (const sb of [1, -1]) EDGES.push({ a, bb, c: 3 - a - bb, sa, sb });
  }
}
/** 倒角盒的八個角（x、y、z 的正負） */
const CORNERS: [number, number, number][] = [];
for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) CORNERS.push([x, y, z]);
/** 面上四個角的 (s, t) 符號，逆時針 */
const QUAD_ST = [-1, -1, 1, -1, 1, 1, -1, 1];

/** 場景建構器：收集各材質的三角形，最後每個材質輸出一個網格（熱路徑全部不配置記憶體） */
export class Builder {
  /** 各材質的頂點緩衝 */
  readonly bufs = new Map<THREE.Material, GeoBuf>();
  /** 外層座標系（例如左右兩側街景的座標系），所有零件都會再乘上它 */
  readonly frame = new THREE.Matrix4();
  /** 目前零件的完整變換與法線矩陣 */
  private readonly C = new THREE.Matrix4();
  private readonly N = new THREE.Matrix3();
  private flip = false;
  /** 目前的搖擺樞紐（已轉到輸出座標）與參數 */
  private readonly sp = new THREE.Vector3();
  private sa = 0;
  private sf = 1;
  private sph = 0;
  /** 暫存：一個三角形的頂點、法線、UV */
  private readonly P = new Float64Array(9);
  private readonly NN = new Float64Array(9);
  private readonly UV = new Float64Array(6);
  /** 暫存：盒子的半邊長、內縮半邊長、目前頂點 */
  private readonly H = new Float64Array(3);
  private readonly I = new Float64Array(3);
  private readonly Q = new Float64Array(3);
  /** 暫存：boxUV 的輸出 */
  private tu0 = 0;
  private tu1 = 0;
  /** presize 配置、要直接交給幾何的緩衝 */
  private readonly owned = new Set<GeoBuf>();

  /** 取得（或建立）某材質的緩衝 */
  buf(mat: THREE.Material): GeoBuf {
    let b = this.bufs.get(mat);
    if (!b) {
      // 從緩衝池借一個（借出期間從池裡拿掉，避免兩個建構器同時用到）
      b = bufPool.get(mat);
      if (b) bufPool.delete(mat);
      else b = new GeoBuf(SWAY_MATS.has(mat), 16384);
      b.n = 0;
      this.bufs.set(mat, b);
    }
    return b;
  }

  /**
   * 設定之後加入搖擺材質的零件要用的樞紐與擺動參數。
   * @param x 樞紐（外層座標系之前的座標）
   * @param amp 擺幅（弧度）
   * @param freq 角頻率
   * @param phase 相位
   */
  setSway(x: number, y: number, z: number, amp: number, freq: number, phase: number): void {
    this.sp.set(x, y, z).applyMatrix4(this.frame);
    this.sa = amp;
    this.sf = freq;
    this.sph = phase;
  }

  /** 開始一個零件：計算完整變換 C = frame × m 與法線矩陣 */
  private begin(m: THREE.Matrix4 | null): void {
    if (m) this.C.multiplyMatrices(this.frame, m);
    else this.C.copy(this.frame);
    this.N.getNormalMatrix(this.C);
    this.flip = this.C.determinant() < 0;
  }

  /** 寫入一個頂點（位置與法線都會套用目前的變換） */
  private vert(b: GeoBuf, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void {
    const e = this.C.elements;
    const n = this.N.elements;
    const i3 = b.n * 3;
    const pos = b.pos;
    pos[i3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    pos[i3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    pos[i3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const qx = n[0] * nx + n[3] * ny + n[6] * nz;
    const qy = n[1] * nx + n[4] * ny + n[7] * nz;
    const qz = n[2] * nx + n[5] * ny + n[8] * nz;
    const inv = 1 / (Math.sqrt(qx * qx + qy * qy + qz * qz) || 1);
    const nor = b.nor;
    nor[i3] = qx * inv;
    nor[i3 + 1] = qy * inv;
    nor[i3 + 2] = qz * inv;
    b.uv[b.n * 2] = u;
    b.uv[b.n * 2 + 1] = v;
    if (b.piv !== null && b.swy !== null) {
      b.piv[i3] = this.sp.x;
      b.piv[i3 + 1] = this.sp.y;
      b.piv[i3 + 2] = this.sp.z;
      b.swy[i3] = this.sa;
      b.swy[i3 + 1] = this.sf;
      b.swy[i3 + 2] = this.sph;
    }
    b.n++;
  }

  /** 把暫存 P/NN/UV 的三角形寫出去；依 ref 方向校正繞序，讓正面朝外 */
  private emit(b: GeoBuf, rx: number, ry: number, rz: number): void {
    const p = this.P;
    const ax = p[3] - p[0];
    const ay = p[4] - p[1];
    const az = p[5] - p[2];
    const bx = p[6] - p[0];
    const by = p[7] - p[1];
    const bz = p[8] - p[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    let swap = cx * rx + cy * ry + cz * rz < 0;
    if (this.flip) swap = !swap;
    b.reserve(3);
    const nn = this.NN;
    const uv = this.UV;
    this.vert(b, p[0], p[1], p[2], nn[0], nn[1], nn[2], uv[0], uv[1]);
    if (swap) {
      this.vert(b, p[6], p[7], p[8], nn[6], nn[7], nn[8], uv[4], uv[5]);
      this.vert(b, p[3], p[4], p[5], nn[3], nn[4], nn[5], uv[2], uv[3]);
    } else {
      this.vert(b, p[3], p[4], p[5], nn[3], nn[4], nn[5], uv[2], uv[3]);
      this.vert(b, p[6], p[7], p[8], nn[6], nn[7], nn[8], uv[4], uv[5]);
    }
  }

  /** 依 UV 規格算出盒子上一個頂點的 UV（f 面索引、Q 區域座標、H 半邊長），結果放在 tu0/tu1 */
  private boxUV(spec: UVSpec, f: number): void {
    const fd = FACES[f];
    const p = this.Q;
    const h = this.H;
    switch (spec.k) {
      case 'pt':
        this.tu0 = spec.u;
        this.tu1 = spec.v;
        return;
      case 'rect': {
        const s = (fd.ss * p[fd.sa] + h[fd.sa]) / (2 * h[fd.sa] || 1);
        const t = (fd.ts * p[fd.ta] + h[fd.ta]) / (2 * h[fd.ta] || 1);
        this.tu0 = spec.u0 + s * (spec.u1 - spec.u0);
        this.tu1 = spec.v0 + t * (spec.v1 - spec.v0);
        return;
      }
      case 'tile': {
        // 長軸 L：u 沿長軸依公尺平鋪；v 取「面上另一個軸」在色帶內的比例
        const L = h[0] >= h[1] && h[0] >= h[2] ? 0 : h[1] >= h[2] ? 1 : 2;
        let c: number;
        if (fd.a !== L) c = 3 - fd.a - L;
        else c = h[fd.sa] >= h[fd.ta] ? fd.sa : fd.ta;
        this.tu0 = (p[L] + h[L]) / spec.su + (spec.uo ?? 0);
        this.tu1 = spec.v0 + ((p[c] + h[c]) / (2 * h[c] || 1)) * (spec.v1 - spec.v0);
        return;
      }
    }
  }

  /** 把盒子上的一個頂點（Q，屬於面 f）寫進暫存三角形的第 k 格 */
  private setBoxVert(k: number, f: number, spec: UVSpec): void {
    const fd = FACES[f];
    this.boxUV(spec, f);
    const q = this.Q;
    const k3 = k * 3;
    this.P[k3] = q[0];
    this.P[k3 + 1] = q[1];
    this.P[k3 + 2] = q[2];
    this.NN[k3] = fd.a === 0 ? fd.sg : 0;
    this.NN[k3 + 1] = fd.a === 1 ? fd.sg : 0;
    this.NN[k3 + 2] = fd.a === 2 ? fd.sg : 0;
    this.UV[k * 2] = this.tu0;
    this.UV[k * 2 + 1] = this.tu1;
  }

  /**
   * 加入一個直角盒子（12 個三角形，扣掉 skip 的面）。
   * @param m 零件變換（中心點）；null 表示原點
   * @param sx 寬（x）、sy 高（y）、sz 深（z）
   */
  box(mat: THREE.Material, m: THREE.Matrix4 | null, sx: number, sy: number, sz: number, uv: UVSpec, o?: BoxOpts): void {
    this.begin(m);
    const b = this.buf(mat);
    const h = this.H;
    h[0] = sx / 2;
    h[1] = sy / 2;
    h[2] = sz / 2;
    const q = this.Q;
    for (let f = 0; f < 6; f++) {
      if (o?.skip && o.skip & (1 << f)) continue;
      const fd = FACES[f];
      const spec = o?.faces?.[f] ?? uv;
      // 兩個三角形：角 (0,1,2) 與 (0,2,3)
      for (let tri = 0; tri < 2; tri++) {
        for (let k = 0; k < 3; k++) {
          const ci = tri === 0 ? k : k === 0 ? 0 : k + 1;
          q[fd.a] = fd.sg * h[fd.a];
          q[fd.sa] = fd.ss * QUAD_ST[ci * 2] * h[fd.sa];
          q[fd.ta] = fd.ts * QUAD_ST[ci * 2 + 1] * h[fd.ta];
          this.setBoxVert(k, f, spec);
        }
        this.emit(b, fd.a === 0 ? fd.sg : 0, fd.a === 1 ? fd.sg : 0, fd.a === 2 ? fd.sg : 0);
      }
    }
  }

  /**
   * 加入一個倒角盒（44 個三角形）：倒角帶的法線由兩側面的法線內插，看起來像圓角，
   * 這是地鐵跑酷式「厚實圓潤」造型的主要零件。
   * @param r 倒角寬度（自動限制在最短邊的 45% 以內）
   */
  bevel(mat: THREE.Material, m: THREE.Matrix4 | null, sx: number, sy: number, sz: number, r: number, uv: UVSpec, o?: BoxOpts): void {
    this.begin(m);
    const b = this.buf(mat);
    const h = this.H;
    const ii = this.I;
    const q = this.Q;
    h[0] = sx / 2;
    h[1] = sy / 2;
    h[2] = sz / 2;
    r = Math.min(r, Math.min(sx, sy, sz) * 0.45);
    ii[0] = h[0] - r;
    ii[1] = h[1] - r;
    ii[2] = h[2] - r;
    const faces = o?.faces;
    const es = o?.edge;

    // 1) 六個主面（內縮 r）
    for (let f = 0; f < 6; f++) {
      if (o?.skip && o.skip & (1 << f)) continue;
      const fd = FACES[f];
      const spec = faces?.[f] ?? uv;
      for (let tri = 0; tri < 2; tri++) {
        for (let k = 0; k < 3; k++) {
          const ci = tri === 0 ? k : k === 0 ? 0 : k + 1;
          q[fd.a] = fd.sg * h[fd.a];
          q[fd.sa] = fd.ss * QUAD_ST[ci * 2] * ii[fd.sa];
          q[fd.ta] = fd.ts * QUAD_ST[ci * 2 + 1] * ii[fd.ta];
          this.setBoxVert(k, f, spec);
        }
        this.emit(b, fd.a === 0 ? fd.sg : 0, fd.a === 1 ? fd.sg : 0, fd.a === 2 ? fd.sg : 0);
      }
    }
    if (r <= 1e-4) return;

    // 2) 十二條倒角帶：A0、A1（面 A 邊上）與 B0、B1（面 B 邊上），兩個三角形 (A0,A1,B1)、(A0,B1,B0)
    for (const e of EDGES) {
      const fA = faceOf(e.a, e.sa);
      const fB = faceOf(e.bb, e.sb);
      const specA = es ?? faces?.[fA] ?? uv;
      const specB = es ?? faces?.[fB] ?? uv;
      const rx = e.a === 0 ? e.sa : e.bb === 0 ? e.sb : 0;
      const ry = e.a === 1 ? e.sa : e.bb === 1 ? e.sb : 0;
      const rz = e.a === 2 ? e.sa : e.bb === 2 ? e.sb : 0;
      for (let tri = 0; tri < 2; tri++) {
        for (let k = 0; k < 3; k++) {
          // tri 0：A0、A1、B1；tri 1：A0、B1、B0
          const onA = tri === 0 ? k < 2 : k === 0;
          const plus = tri === 0 ? k >= 1 : k === 1;
          q[e.c] = plus ? ii[e.c] : -ii[e.c];
          if (onA) {
            q[e.a] = e.sa * h[e.a];
            q[e.bb] = e.sb * ii[e.bb];
            this.setBoxVert(k, fA, specA);
          } else {
            q[e.a] = e.sa * ii[e.a];
            q[e.bb] = e.sb * h[e.bb];
            this.setBoxVert(k, fB, specB);
          }
        }
        this.emit(b, rx, ry, rz);
      }
    }
    // 3) 八個角落三角形
    for (const [cx, cy, cz] of CORNERS) {
      for (let k = 0; k < 3; k++) {
        q[0] = cx * (k === 0 ? h[0] : ii[0]);
        q[1] = cy * (k === 1 ? h[1] : ii[1]);
        q[2] = cz * (k === 2 ? h[2] : ii[2]);
        const f = faceOf(k, k === 0 ? cx : k === 1 ? cy : cz);
        this.setBoxVert(k, f, es ?? faces?.[f] ?? uv);
      }
      this.emit(b, cx, cy, cz);
    }
  }

  /**
   * 加入一個任意四邊形（外層座標系之前的座標，不再乘零件矩陣）。
   * 頂點順序 a→b→c→d 逆時針（從正面看），法線由外積算出（平面著色）。
   * @param uvs 四個角的 UV：[ua,va, ub,vb, uc,vc, ud,vd]
   */
  quad(mat: THREE.Material, a: ArrayLike<number>, bq: ArrayLike<number>, c: ArrayLike<number>, d: ArrayLike<number>, uvs: ArrayLike<number>): void {
    this.begin(null);
    const b = this.buf(mat);
    // 法線：(b − a) × (d − a)
    const ux = bq[0] - a[0];
    const uy = bq[1] - a[1];
    const uz = bq[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    const P = this.P;
    const NN = this.NN;
    const UV = this.UV;
    for (let k = 0; k < 9; k += 3) {
      NN[k] = nx;
      NN[k + 1] = ny;
      NN[k + 2] = nz;
    }
    // 三角形 (a, b, c)
    P[0] = a[0]; P[1] = a[1]; P[2] = a[2];
    P[3] = bq[0]; P[4] = bq[1]; P[5] = bq[2];
    P[6] = c[0]; P[7] = c[1]; P[8] = c[2];
    UV[0] = uvs[0]; UV[1] = uvs[1]; UV[2] = uvs[2]; UV[3] = uvs[3]; UV[4] = uvs[4]; UV[5] = uvs[5];
    this.emit(b, nx, ny, nz);
    // 三角形 (a, c, d)
    P[3] = c[0]; P[4] = c[1]; P[5] = c[2];
    P[6] = d[0]; P[7] = d[1]; P[8] = d[2];
    UV[2] = uvs[4]; UV[3] = uvs[5]; UV[4] = uvs[6]; UV[5] = uvs[7];
    this.emit(b, nx, ny, nz);
  }

  /** 四邊形貼一張圖集矩形（a 左下、b 右下、c 右上、d 左上） */
  quadRect(mat: THREE.Material, a: ArrayLike<number>, bq: ArrayLike<number>, c: ArrayLike<number>, d: ArrayLike<number>, uv: UVSpec): void {
    if (uv.k === 'rect') {
      this.quad(mat, a, bq, c, d, [uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1]);
    } else if (uv.k === 'pt') {
      this.quad(mat, a, bq, c, d, [uv.u, uv.v, uv.u, uv.v, uv.u, uv.v, uv.u, uv.v]);
    } else {
      // tile：u 依 a→b 的長度平鋪、v 佔滿色帶
      const dx = bq[0] - a[0];
      const dy = bq[1] - a[1];
      const dz = bq[2] - a[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) / uv.su;
      const u0 = uv.uo ?? 0;
      this.quad(mat, a, bq, c, d, [u0, uv.v0, u0 + len, uv.v0, u0 + len, uv.v1, u0, uv.v1]);
    }
  }

  /** 單一三角形（外層座標系之前的座標），法線由外積算出 */
  triangle(mat: THREE.Material, a: ArrayLike<number>, bq: ArrayLike<number>, c: ArrayLike<number>, uvs: ArrayLike<number>): void {
    this.begin(null);
    const b = this.buf(mat);
    const ux = bq[0] - a[0];
    const uy = bq[1] - a[1];
    const uz = bq[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    const P = this.P;
    const NN = this.NN;
    const UV = this.UV;
    P[0] = a[0]; P[1] = a[1]; P[2] = a[2];
    P[3] = bq[0]; P[4] = bq[1]; P[5] = bq[2];
    P[6] = c[0]; P[7] = c[1]; P[8] = c[2];
    for (let k = 0; k < 9; k += 3) {
      NN[k] = nx;
      NN[k + 1] = ny;
      NN[k + 2] = nz;
    }
    for (let k = 0; k < 6; k++) UV[k] = uvs[k];
    this.emit(b, nx, ny, nz);
  }

  /**
   * 加入一個模板幾何（圓柱、球、圓錐…），套用零件變換與 UV 規格。
   * rect：把模板原本 0..1 的 UV 縮放進圖集矩形；pt：全部指到一個色塊；tile：u 用模板 v 方向的公尺數；null：沿用模板 UV。
   * 模板事先攤平成非索引陣列，UV 規格在迴圈外換算成線性係數，迴圈裡只做乘加（這是建場景最熱的路徑）。
   */
  geo(mat: THREE.Material, tplGeo: THREE.BufferGeometry, m: THREE.Matrix4 | null, uv: UVSpec | null): void {
    this.begin(m);
    const b = this.buf(mat);
    const f = flatOf(tplGeo);
    const count = f.count;
    b.reserve(count);
    const e = this.C.elements;
    const nm = this.N.elements;
    const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6];
    const e8 = e[8], e9 = e[9], e10 = e[10], e12 = e[12], e13 = e[13], e14 = e[14];
    const n0 = nm[0], n1 = nm[1], n2 = nm[2], n3 = nm[3], n4 = nm[4], n5 = nm[5], n6 = nm[6], n7 = nm[7], n8 = nm[8];
    // UV 線性係數：u = au·su + bu·sv + cu、v = av·su + bv·sv + cv
    let au = 1, bu = 0, cu = 0, av = 0, bv = 1, cv = 0;
    if (uv) {
      if (uv.k === 'pt') {
        au = 0; cu = uv.u; bv = 0; cv = uv.v;
      } else if (uv.k === 'rect') {
        au = uv.u1 - uv.u0; cu = uv.u0; bv = uv.v1 - uv.v0; cv = uv.v0;
      } else {
        au = 0; bu = 1 / uv.su; cu = uv.uo ?? 0; av = uv.v1 - uv.v0; bv = 0; cv = uv.v0;
      }
    }
    const pos = b.pos;
    const nor = b.nor;
    const uvb = b.uv;
    const piv = b.piv;
    const swy = b.swy;
    const fp = f.pos;
    const fn = f.nor;
    const fu = f.uv;
    const flip = this.flip;
    const spx = this.sp.x, spy = this.sp.y, spz = this.sp.z;
    let o = b.n;
    for (let t = 0; t < count; t += 3) {
      for (let kk = 0; kk < 3; kk++) {
        const i = t + (flip && kk > 0 ? 3 - kk : kk);
        const i3 = i * 3;
        const x = fp[i3], y = fp[i3 + 1], z = fp[i3 + 2];
        const nx = fn[i3], ny = fn[i3 + 1], nz = fn[i3 + 2];
        const o3 = o * 3;
        pos[o3] = e0 * x + e4 * y + e8 * z + e12;
        pos[o3 + 1] = e1 * x + e5 * y + e9 * z + e13;
        pos[o3 + 2] = e2 * x + e6 * y + e10 * z + e14;
        const qx = n0 * nx + n3 * ny + n6 * nz;
        const qy = n1 * nx + n4 * ny + n7 * nz;
        const qz = n2 * nx + n5 * ny + n8 * nz;
        const inv = 1 / (Math.sqrt(qx * qx + qy * qy + qz * qz) || 1);
        nor[o3] = qx * inv;
        nor[o3 + 1] = qy * inv;
        nor[o3 + 2] = qz * inv;
        const su = fu[i * 2], sv = fu[i * 2 + 1];
        uvb[o * 2] = au * su + bu * sv + cu;
        uvb[o * 2 + 1] = av * su + bv * sv + cv;
        if (piv !== null && swy !== null) {
          piv[o3] = spx;
          piv[o3 + 1] = spy;
          piv[o3 + 2] = spz;
          swy[o3] = this.sa;
          swy[o3 + 1] = this.sf;
          swy[o3 + 2] = this.sph;
        }
        o++;
      }
    }
    b.n = o;
  }

  /**
   * 沿一條折線拉出細長的方管（電線、繩子、欄杆扶手）：每段一個 4 面的細管。
   * @param pts 折線頂點（外層座標系之前的座標）
   * @param w 管寬
   */
  tube(mat: THREE.Material, pts: number[][], w: number, uv: UVSpec): void {
    const hw = w / 2;
    const c0 = [0, 0, 0];
    const c1 = [0, 0, 0];
    const c2 = [0, 0, 0];
    const c3 = [0, 0, 0];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      let dx = c[0] - a[0];
      let dy = c[1] - a[1];
      let dz = c[2] - a[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-5) continue;
      dx /= len;
      dy /= len;
      dz /= len;
      // 參考向量（不與線平行）→ 兩個側向 side、up
      let ux = 0;
      let uy = 1;
      let uz = 0;
      if (Math.abs(dy) > 0.9) {
        ux = 1;
        uy = 0;
      }
      let sx = dy * uz - dz * uy;
      let sy = dz * ux - dx * uz;
      let sz = dx * uy - dy * ux;
      const sl = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
      sx *= sl;
      sy *= sl;
      sz *= sl;
      ux = sy * dz - sz * dy;
      uy = sz * dx - sx * dz;
      uz = sx * dy - sy * dx;
      // 四個角的偏移：(+s+u)、(−s+u)、(−s−u)、(+s−u)
      const offs = [
        [sx + ux, sy + uy, sz + uz],
        [-sx + ux, -sy + uy, -sz + uz],
        [-sx - ux, -sy - uy, -sz - uz],
        [sx - ux, sy - uy, sz - uz],
      ];
      for (let k = 0; k < 4; k++) {
        const o0 = offs[k];
        const o1 = offs[(k + 1) % 4];
        c0[0] = a[0] + o0[0] * hw; c0[1] = a[1] + o0[1] * hw; c0[2] = a[2] + o0[2] * hw;
        c1[0] = a[0] + o1[0] * hw; c1[1] = a[1] + o1[1] * hw; c1[2] = a[2] + o1[2] * hw;
        c2[0] = c[0] + o1[0] * hw; c2[1] = c[1] + o1[1] * hw; c2[2] = c[2] + o1[2] * hw;
        c3[0] = c[0] + o0[0] * hw; c3[1] = c[1] + o0[1] * hw; c3[2] = c[2] + o0[2] * hw;
        this.quadRect(mat, c0, c3, c2, c1, uv);
      }
    }
  }

  /**
   * 事先配置某材質剛好夠用的緩衝（不從緩衝池借）：配合 toGroup({ views: true }) 直接把緩衝交給幾何，不必再複製。
   * @param n 預計的頂點數
   */
  presize(mat: THREE.Material, n: number): void {
    const b = new GeoBuf(SWAY_MATS.has(mat), Math.max(16, n));
    this.bufs.set(mat, b);
    this.owned.add(b);
  }

  /** 把目前收集的三角形打包成預製件（複製出來），緩衝還回池子 */
  toPrefab(): Prefab {
    const parts: PrefabPart[] = [];
    let tris = 0;
    for (const [mat, b] of this.bufs) {
      if (b.n === 0) continue;
      const n3 = b.n * 3;
      parts.push({
        mat,
        pos: b.pos.slice(0, n3),
        nor: b.nor.slice(0, n3),
        uv: b.uv.slice(0, b.n * 2),
        piv: b.piv ? b.piv.slice(0, n3) : null,
        swy: b.swy ? b.swy.slice(0, n3) : null,
        n: b.n,
      });
      tris += b.n / 3;
    }
    this.release();
    return { parts, tris };
  }

  /**
   * 放一個預製件：區域座標先平移 (dx, dy, dz)，再套用外層座標系 frame。
   * frame 只會是單位矩陣或「繞 y 轉 180°＋平移」（左側街景），所以位置與法線只要變號加平移，
   * 不必做完整的矩陣運算；這是建一段場景最主要的工作，必須很快。
   */
  stamp(p: Prefab, dx: number, dy: number, dz: number): void {
    const f = this.frame.elements;
    const sx = f[0];
    const sz = f[10];
    if (Math.abs(f[4]) + Math.abs(f[8]) + Math.abs(f[1]) + Math.abs(f[2]) + Math.abs(f[6]) + Math.abs(f[9]) > 1e-6 || Math.abs(f[5] - 1) > 1e-6) {
      throw new Error('Builder.stamp：外層座標系只支援繞 y 轉 0° 或 180°');
    }
    const mx = sx * dx + f[12];
    const my = dy + f[13];
    const mz = sz * dz + f[14];
    for (const part of p.parts) {
      const b = this.buf(part.mat);
      const n = part.n;
      b.reserve(n);
      const o = b.n;
      const P = b.pos;
      const N = b.nor;
      const pp = part.pos;
      const pn = part.nor;
      const o3 = o * 3;
      for (let i3 = 0; i3 < n * 3; i3 += 3) {
        P[o3 + i3] = sx * pp[i3] + mx;
        P[o3 + i3 + 1] = pp[i3 + 1] + my;
        P[o3 + i3 + 2] = sz * pp[i3 + 2] + mz;
        N[o3 + i3] = sx * pn[i3];
        N[o3 + i3 + 1] = pn[i3 + 1];
        N[o3 + i3 + 2] = sz * pn[i3 + 2];
      }
      b.uv.set(part.uv, o * 2);
      if (b.piv && b.swy && part.piv && part.swy) {
        const V = b.piv;
        const pv = part.piv;
        for (let i3 = 0; i3 < n * 3; i3 += 3) {
          V[o3 + i3] = sx * pv[i3] + mx;
          V[o3 + i3 + 1] = pv[i3 + 1] + my;
          V[o3 + i3 + 2] = sz * pv[i3 + 2] + mz;
        }
        b.swy.set(part.swy, o3);
      }
      b.n = o + n;
    }
  }

  /** 把借來的緩衝還回池子（presize 配置的緩衝不還，因為已經交給幾何了） */
  private release(): void {
    for (const [mat, b] of this.bufs) {
      if (this.owned.has(b)) continue;
      b.n = 0;
      bufPool.set(mat, b);
    }
    this.bufs.clear();
    this.owned.clear();
  }

  /**
   * 輸出：每個材質一個網格（陰影設定取自 SHADOW）。
   * 每個網格都已經是「依材質合併」的結果，標記 villageKeep 讓 mergeByMaterial 原樣保留（不再複製一次頂點）。
   * @param opts.views 用 presize 配置的緩衝時直接交給幾何（不複製）
   * @param opts.bounds 固定的包圍盒（整段場景用）
   */
  toGroup(name = 'built', opts: { views?: boolean; bounds?: THREE.Box3 } = {}): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, b] of this.bufs) {
      if (b.n === 0) continue;
      const mesh = new THREE.Mesh(b.toGeometry(!!opts.views && this.owned.has(b), opts.bounds), mat);
      const sh = SHADOW.get(mat);
      mesh.castShadow = sh?.cast ?? false;
      mesh.receiveShadow = sh?.receive ?? true;
      mesh.userData.villageKeep = true;
      mesh.name = SWAY_MATS.has(mat) ? 'sway' : 'merged';
      g.add(mesh);
    }
    this.release();
    return g;
  }
}

/** 種子亂數小工具 */
export class Rng {
  private readonly next: () => number;
  /** @param seed 種子（同種子產生相同序列） */
  constructor(seed: number) {
    this.next = seeded(seed);
  }
  /** 0..1 的實數 */
  f(): number {
    return this.next();
  }
  /** a..b 的實數 */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** a..b 的整數（含兩端） */
  int(a: number, b: number): number {
    return a + Math.min(b - a, Math.floor(this.next() * (b - a + 1)));
  }
  /** 機率 p 為真 */
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** 從陣列挑一個 */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
}

/** 共用的模板幾何快取（圓柱、球、圓錐…），依參數鍵共用 */
const tplCache = new Map<string, THREE.BufferGeometry>();

/** 取得快取的模板幾何 */
export function tpl(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = tplCache.get(key);
  if (!g) {
    g = make();
    tplCache.set(key, g);
  }
  return g;
}

/** 常用模板：單位圓柱（半徑 1、高 1、中心在原點），radial 段數 */
export function cylTpl(radial = 12, open = false): THREE.BufferGeometry {
  return tpl(`cyl|${radial}|${open}`, () => new THREE.CylinderGeometry(1, 1, 1, radial, 1, open));
}

/** 常用模板：上下半徑不同的圓台（上半徑 top、下半徑 1、高 1） */
export function coneTpl(top: number, radial = 12, open = false): THREE.BufferGeometry {
  return tpl(`cone|${top}|${radial}|${open}`, () => new THREE.CylinderGeometry(top, 1, 1, radial, 1, open));
}

/** 常用模板：單位球（半徑 1） */
export function sphereTpl(w = 12, h = 8): THREE.BufferGeometry {
  return tpl(`sph|${w}|${h}`, () => new THREE.SphereGeometry(1, w, h));
}

/** 常用模板：二十面體（樹冠、石頭），detail 細分 */
export function icoTpl(detail = 1): THREE.BufferGeometry {
  return tpl(`ico|${detail}`, () => new THREE.IcosahedronGeometry(1, detail));
}
