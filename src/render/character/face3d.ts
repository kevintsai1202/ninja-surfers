import * as THREE from 'three';
import { DIMS, type HumanoidRig } from './rig';
import { shapeHead } from './shapes';
import { skinMat, fabricMat } from './charMats';
import { stdMat } from '../materials';
import { darken } from './hdBody';

/**
 * 立體臉部（第二版多角色，參考 docs/concept/*-face.jpg）：
 * - 頭殼：高解析度球面，先雕出眼窩、眉骨、鼻樑與鼻頭、顴骨、口鼻區、上下唇、嘴角、下巴，再套原本的 Q 版頭型變形。
 * - 眼睛：杏仁形、中間微凸的「眼球片」（真的有厚度，轉頭時會反光），虹膜、瞳孔、高光畫在眼球片的貼圖上；
 *   上眼線（粗、眼尾上挑）、雙眼皮摺線、下眼線、眉毛、嘴線、鬍鬚紋都是貼著臉的立體細管。
 * - 面罩（卡卡西）：從鼻樑往下整個包住的布殼，鼻樑形狀會透出來。
 * 座標：頭心為原點、正面 −z、角色的右邊 +x；臉上的位置用 yaw（度，正值往角色右邊）與 yr（高度 ÷ 頭半徑）表示。
 */

/** 眼型：圓眼（鳴人）、杏眼（小櫻）、銳利（佐助）、睏眼（卡卡西） */
export type EyeShape = 'round' | 'doe' | 'sharp' | 'sleepy';
/** 眉型：自信上揚、皺眉、細彎眉、放鬆 */
export type BrowShape = 'confident' | 'frown' | 'arch' | 'relaxed';
/** 嘴型：咧嘴笑、微笑、抿嘴（不高興）、沒有（戴面罩） */
export type MouthShape = 'grin' | 'smile' | 'frown' | 'none';

/** 一個角色的臉部設定 */
export interface Face3DSpec {
  skin: number;
  /** 虹膜色（CSS 色碼） */
  iris: string;
  /** 眉毛顏色 */
  brow: number;
  eyes: EyeShape;
  brows: BrowShape;
  mouth: MouthShape;
  /** 兩頰各三條鬍鬚紋 */
  whiskers?: boolean;
  /** 腮紅 */
  blush?: boolean;
  /** 只做右眼與右眉（左眼被斜戴的護額遮住） */
  rightEyeOnly?: boolean;
  /** 面罩顏色：給了就從鼻樑往下包住（不做嘴、鬍鬚紋、腮紅） */
  mask?: number;
}

const R = DIMS.headR;
const DEG = Math.PI / 180;
/** 眼睛中心的位置（沿用第一版臉部貼圖的五官配置，頭髮、護額才對得上） */
const EYE_YAW = 19.5;
const EYE_Y = -0.12;

/** 眼睛尺寸（公尺）：寬、上緣拱高、下緣深度、內外眼角高度、眼球片凸起、上眼線粗細、眼尾上挑長度與角度 */
interface EyeDims {
  w: number;
  up: number;
  low: number;
  inner: number;
  outer: number;
  bulge: number;
  lash: number;
  flick: number;
  flickDeg: number;
  /** 眼尾額外的睫毛根數 */
  lashes: number;
  /** 虹膜寬、高（佔眼寬的比例） */
  irisW: number;
  irisH: number;
}

const EYE_DIMS: Record<EyeShape, EyeDims> = {
  round: { w: 0.088, up: 0.046, low: 0.036, inner: -0.003, outer: 0.004, bulge: 0.005, lash: 0.0034, flick: 0.009, flickDeg: 15, lashes: 0, irisW: 0.62, irisH: 0.78 },
  doe: { w: 0.09, up: 0.048, low: 0.038, inner: -0.004, outer: 0.007, bulge: 0.0052, lash: 0.0031, flick: 0.012, flickDeg: 28, lashes: 2, irisW: 0.62, irisH: 0.78 },
  sharp: { w: 0.086, up: 0.034, low: 0.03, inner: -0.005, outer: 0.01, bulge: 0.0045, lash: 0.0038, flick: 0.013, flickDeg: 20, lashes: 0, irisW: 0.52, irisH: 0.8 },
  sleepy: { w: 0.082, up: 0.02, low: 0.03, inner: 0, outer: -0.002, bulge: 0.004, lash: 0.0037, flick: 0.005, flickDeg: -8, lashes: 0, irisW: 0.5, irisH: 0.85 },
};

/** 高斯凸起（用 yaw 度數與 yr 的距離） */
function bump(dyaw: number, dyr: number, syaw: number, syr: number): number {
  return Math.exp(-0.5 * ((dyaw / syaw) ** 2 + (dyr / syr) ** 2));
}

/** 0..1 平滑插值 */
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 臉部雕塑：回傳該方向的半徑增量（公尺），正值凸出、負值凹進。
 * @param yaw 度，正值往角色右邊
 * @param yr 高度 ÷ 頭半徑
 */
export function sculpt(yaw: number, yr: number): number {
  let d = 0;
  for (const side of [-1, 1]) {
    const dy = yaw - side * EYE_YAW;
    // 眼窩：淺凹，眼球片才嵌得進去
    d -= 0.006 * bump(dy, yr - EYE_Y, 11, 0.1);
    // 眉骨：眼窩上方微凸
    d += 0.0032 * bump(yaw - side * 17, yr - 0.11, 12, 0.05);
    // 顴骨（蘋果肌）
    d += 0.005 * bump(yaw - side * 27, yr + 0.36, 11, 0.11);
    // 嘴角小凹
    d -= 0.0016 * bump(yaw - side * 7.5, yr + 0.585, 2.6, 0.03);
  }
  // 鼻樑：從兩眼之間往下越來越高，接到鼻頭
  const bridge = smooth(-0.02, -0.27, yr) * (yr > -0.3 ? 1 : bump(0, yr + 0.3, 1, 0.035));
  d += 0.0055 * bridge * bump(yaw, 0, 3.6, 1);
  // 鼻頭（Q 版：小而圓）
  d += 0.0135 * bump(yaw, yr + 0.31, 5.2, 0.05);
  // 口鼻區（人中到下巴）微微往前
  d += 0.0038 * bump(yaw, yr + 0.55, 13, 0.12);
  // 上唇、下唇
  d += 0.002 * bump(yaw, yr + 0.555, 6.5, 0.022);
  d += 0.0032 * bump(yaw, yr + 0.625, 5.5, 0.03);
  // 下巴
  d += 0.004 * bump(yaw, yr + 0.8, 9, 0.07);
  return d;
}

/** 方向（單位向量）→ yaw（度）與 yr */
function angles(dir: THREE.Vector3): { yaw: number; yr: number } {
  return { yaw: Math.atan2(dir.x, -dir.z) / DEG, yr: dir.y };
}

/** yaw、yr → 單位方向 */
function dirOf(yaw: number, yr: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.sqrt(Math.max(0, 1 - yr * yr));
  return out.set(Math.sin(yaw * DEG) * c, yr, -Math.cos(yaw * DEG) * c);
}

/** 臉上某處的表面點（含雕塑與頭型變形） */
export function facePoint(yaw: number, yr: number, out = new THREE.Vector3()): THREE.Vector3 {
  dirOf(yaw, yr, out).multiplyScalar(R + sculpt(yaw, yr));
  shapeHead(out);
  return out;
}

/** 臉上某處的表面點與朝外法線 */
function faceFrame(yaw: number, yr: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const p = facePoint(yaw, yr);
  const px = facePoint(yaw + 0.35, yr).sub(p);
  const py = facePoint(yaw, yr + 0.003).sub(p);
  const n = new THREE.Vector3().crossVectors(py, px).normalize();
  return { p, n };
}

/** 臉上某處、沿法線抬高 lift 公尺的點 */
function liftedPoint(yaw: number, yr: number, lift: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const f = faceFrame(yaw, yr);
  f.p.addScaledVector(f.n, lift);
  return f;
}

/** 雕塑過的頭殼（接縫轉到後腦，被頭髮蓋住） */
function headGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  geo.rotateY(Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const { yaw, yr } = angles(v);
    v.multiplyScalar(R + sculpt(yaw, yr));
    shapeHead(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 沿曲線掃出橢圓斷面、粗細漸變的細管（眼線、眉毛、嘴線、鬍鬚紋）。
 * @param pts 曲線上的點
 * @param nrm 每個點的朝外法線（斷面的「高」沿這個方向）
 * @param half 每個點的半寬（沿臉的表面）
 * @param hRatio 斷面高／寬（小於 1 是扁的）
 */
function taperTube(pts: THREE.Vector3[], nrm: THREE.Vector3[], half: number[], hRatio: number, radial = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    t.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    n.copy(nrm[i]).addScaledVector(t, -nrm[i].dot(t)).normalize();
    b.crossVectors(t, n);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const w = half[i];
      pos.push(
        pts[i].x + b.x * Math.cos(a) * w + n.x * Math.sin(a) * w * hRatio,
        pts[i].y + b.y * Math.cos(a) * w + n.y * Math.sin(a) * w * hRatio,
        pts[i].z + b.z * Math.cos(a) * w + n.z * Math.sin(a) * w * hRatio,
      );
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const c = i * radial + ((k + 1) % radial);
      idx.push(a, a + radial, c, c, a + radial, c + radial);
    }
  }
  // 兩端封口（扇形）
  for (const [ring, tip, flip] of [
    [0, pts[0], true],
    [pts.length - 1, pts[pts.length - 1], false],
  ] as [number, THREE.Vector3, boolean][]) {
    const center = pos.length / 3;
    pos.push(tip.x, tip.y, tip.z);
    for (let k = 0; k < radial; k++) {
      const a = ring * radial + k;
      const c = ring * radial + ((k + 1) % radial);
      if (flip) idx.push(center, c, a);
      else idx.push(center, a, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 二次貝茲曲線上取樣（yaw、yr 平面） */
function bezier2(p0: [number, number], p1: [number, number], p2: [number, number], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]);
  }
  return out;
}

/**
 * 貼著臉的細管：給 yaw／yr 上的折線、每點的半寬、抬高量。
 * @param shapeFn 0..1 → 半寬
 */
function faceStroke(
  path: [number, number][],
  shapeFn: (t: number) => number,
  lift: number,
  hRatio: number,
): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  const half: number[] = [];
  path.forEach(([yaw, yr], i) => {
    const f = liftedPoint(yaw, yr, lift);
    pts.push(f.p);
    nrm.push(f.n);
    half.push(shapeFn(i / (path.length - 1)));
  });
  return taperTube(pts, nrm, half, hRatio);
}

/** 眼睛的上、下緣曲線（s：0 內眼角 → 1 外眼角，回傳離眼睛中心的高度，公尺） */
function eyeCurves(d: EyeDims): { upper: (s: number) => number; lower: (s: number) => number } {
  const base = (s: number) => d.inner + (d.outer - d.inner) * s;
  return {
    upper: (s) => base(s) + d.up * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.85)), 0.7),
    lower: (s) => base(s) - d.low * Math.pow(Math.sin(Math.PI * s), 0.85),
  };
}

/**
 * 眼睛上的點：u 從眼睛中心往外眼角（公尺）、v 往上（公尺），貼著眼窩表面再抬高 lift。
 * @param side +1 右眼、−1 左眼
 */
function eyePoint(side: number, u: number, v: number, lift: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const lat = Math.acos(Math.max(-1, Math.min(1, Math.sqrt(1 - EYE_Y * EYE_Y))));
  const yaw = side * (EYE_YAW + u / (R * Math.cos(lat)) / DEG);
  const yr = EYE_Y + v / R;
  return liftedPoint(yaw, yr, lift);
}

/** 眼球片貼圖：眼白（上緣有眼皮陰影）、漸層虹膜、瞳孔、兩個高光；左右眼共用（u 方向固定是觀看者的左→右） */
function eyeTexture(d: EyeDims, iris: string): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const { upper, lower } = eyeCurves(d);
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i <= 40; i++) {
    vmin = Math.min(vmin, lower(i / 40));
    vmax = Math.max(vmax, upper(i / 40));
  }
  const H = vmax - vmin;
  // 貼圖座標：x = s（0..1），y = 1 − (v − vmin) / H（畫布 y 往下）
  const toY = (v: number) => (1 - (v - vmin) / H) * S;
  // 眼白：上面略帶藍灰的眼皮陰影
  const white = g.createLinearGradient(0, 0, 0, S);
  white.addColorStop(0, '#d5dce8');
  white.addColorStop(0.35, '#f4f6fa');
  white.addColorStop(1, '#ffffff');
  g.fillStyle = white;
  g.fillRect(0, 0, S, S);
  // 虹膜：橢圓（換算成公尺比例才會是正的），中心略低於眼睛中心
  const cx = 0.5 * S;
  const cy = toY(d.inner * 0.5 + (d.up - d.low) * 0.12);
  const rx = ((d.irisW * d.w) / 2 / d.w) * S;
  const ry = ((d.irisH * (d.up + d.low)) / 2 / H) * S;
  const grad = g.createRadialGradient(cx, cy + ry * 0.35, ry * 0.05, cx, cy, ry);
  grad.addColorStop(0, lighten(iris, 0.55));
  grad.addColorStop(0.55, iris);
  grad.addColorStop(1, lighten(iris, -0.5));
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = S * 0.02;
  g.strokeStyle = lighten(iris, -0.65);
  g.stroke();
  // 瞳孔
  g.fillStyle = '#0b0f18';
  g.beginPath();
  g.ellipse(cx, cy + ry * 0.04, rx * 0.4, ry * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  // 高光：左上大、右下小（觀看者視角）
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(cx - rx * 0.36, cy - ry * 0.38, rx * 0.26, ry * 0.24, -0.4, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx + rx * 0.4, cy + ry * 0.42, rx * 0.11, ry * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  // 上緣的眼皮陰影帶（壓在虹膜上，眼睛才有深度）
  const lid = g.createLinearGradient(0, 0, 0, S * 0.3);
  lid.addColorStop(0, 'rgba(40,30,40,0.45)');
  lid.addColorStop(1, 'rgba(40,30,40,0)');
  g.fillStyle = lid;
  g.fillRect(0, 0, S, S * 0.3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 色碼變亮（amt > 0）或變暗（amt < 0） */
function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** 眼球片：杏仁形、中間微凸，邊緣貼著眼窩 */
function eyeLensGeometry(d: EyeDims, side: number): THREE.BufferGeometry {
  const NU = 30;
  const NV = 14;
  const { upper, lower } = eyeCurves(d);
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i <= 40; i++) {
    vmin = Math.min(vmin, lower(i / 40));
    vmax = Math.max(vmax, upper(i / 40));
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < NV; j++) {
    const t = j / (NV - 1);
    for (let i = 0; i < NU; i++) {
      const s = i / (NU - 1);
      const u = (s - 0.5) * d.w;
      const v = lower(s) + (upper(s) - lower(s)) * t;
      const dome = d.bulge * Math.pow(Math.sin(Math.PI * s), 0.5) * Math.pow(Math.sin(Math.PI * t), 0.6);
      const { p } = eyePoint(side, u, v, 0.0005 + dome);
      pos.push(p.x, p.y, p.z);
      // 右眼的外眼角在觀看者左邊，貼圖左右翻過來，高光才會在同一邊
      uv.push(side > 0 ? 1 - s : s, (v - vmin) / (vmax - vmin));
    }
  }
  for (let j = 0; j < NV - 1; j++) {
    for (let i = 0; i < NU - 1; i++) {
      const a = j * NU + i;
      const b = a + 1;
      const c = a + NU;
      const e = c + 1;
      // 左右眼的 u 方向相反，繞序也要相反，正面才會朝外
      if (side > 0) idx.push(a, c, b, b, c, e);
      else idx.push(a, b, c, b, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 單色細節材質（眼線、眉毛、嘴線）：依顏色快取 */
function lineMat(color: number, roughness = 0.6): THREE.MeshStandardMaterial {
  return stdMat({ color, roughness }, `face-line|${color}|${roughness}`);
}

/** 掛一個不描邊的細節網格到頭上 */
function addDetail(rig: HumanoidRig, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.userData.noOutline = true;
  rig.head.add(m);
  return m;
}

/** 一隻眼睛：眼球片、上眼線（含眼尾上挑）、雙眼皮摺線、下眼線、眼尾睫毛 */
function addEye(rig: HumanoidRig, spec: Face3DSpec, side: number, eyeMat: THREE.Material): void {
  const d = EYE_DIMS[spec.eyes];
  const { upper, lower } = eyeCurves(d);
  addDetail(rig, eyeLensGeometry(d, side), eyeMat);
  const lashMat = lineMat(0x1d1512, 0.55);
  // 上眼線：沿上緣、略往上蓋住眼球片的邊，外眼角再往外上方挑出去
  const pts: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  const half: number[] = [];
  const N = 22;
  for (let i = 0; i < N; i++) {
    const s = -0.02 + (i / (N - 1)) * 1.02;
    const f = eyePoint(side, (s - 0.5) * d.w, upper(Math.max(0, s)) + 0.0011, 0.0016 + d.bulge * 0.15);
    pts.push(f.p);
    nrm.push(f.n);
    half.push(d.lash * (0.42 + 0.58 * smooth(0, 0.55, s)));
  }
  const flickN = 6;
  const a = d.flickDeg * DEG;
  for (let i = 1; i <= flickN; i++) {
    const k = i / flickN;
    const f = eyePoint(side, d.w / 2 + Math.cos(a) * d.flick * k, d.outer + 0.0011 + Math.sin(a) * d.flick * k, 0.0016);
    pts.push(f.p);
    nrm.push(f.n);
    half.push(d.lash * (1 - 0.8 * k));
  }
  addDetail(rig, taperTube(pts, nrm, half, 0.55), lashMat);
  // 雙眼皮摺線（膚色加深）
  const creasePath: THREE.Vector3[] = [];
  const creaseN: THREE.Vector3[] = [];
  const creaseHalf: number[] = [];
  for (let i = 0; i < 14; i++) {
    const s = 0.14 + (i / 13) * 0.72;
    const f = eyePoint(side, (s - 0.5) * d.w, upper(s) + (spec.eyes === 'sleepy' ? 0.0052 : 0.0072), 0.0009);
    creasePath.push(f.p);
    creaseN.push(f.n);
    creaseHalf.push(0.001 * Math.sin(Math.PI * (i / 13)) + 0.0002);
  }
  addDetail(rig, taperTube(creasePath, creaseN, creaseHalf, 0.6, 6), lineMat(darken(spec.skin, 0.72), 0.8));
  // 睏眼：上眼皮蓋到虹膜一半，用一片膚色厚眼皮表現
  if (spec.eyes === 'sleepy') {
    const lidPts: THREE.Vector3[] = [];
    const lidN: THREE.Vector3[] = [];
    const lidHalf: number[] = [];
    for (let i = 0; i < 16; i++) {
      const s = 0.04 + (i / 15) * 0.92;
      const f = eyePoint(side, (s - 0.5) * d.w, upper(s) + 0.0028, 0.0018);
      lidPts.push(f.p);
      lidN.push(f.n);
      lidHalf.push(0.0026 * Math.pow(Math.sin(Math.PI * (i / 15)), 0.5) + 0.0004);
    }
    addDetail(rig, taperTube(lidPts, lidN, lidHalf, 0.8), skinMat(spec.skin));
  }
  // 下眼線：只畫外側一半，細
  const lowPts: THREE.Vector3[] = [];
  const lowN: THREE.Vector3[] = [];
  const lowHalf: number[] = [];
  for (let i = 0; i < 10; i++) {
    const s = 0.45 + (i / 9) * 0.55;
    const f = eyePoint(side, (s - 0.5) * d.w, lower(s) - 0.0005, 0.0009);
    lowPts.push(f.p);
    lowN.push(f.n);
    lowHalf.push(0.00035 + 0.0008 * (i / 9));
  }
  addDetail(rig, taperTube(lowPts, lowN, lowHalf, 0.6, 6), lineMat(0x3a2620, 0.7));
  // 眼尾睫毛（小櫻）
  for (let k = 0; k < d.lashes; k++) {
    const s = 0.82 + k * 0.1;
    const base = new THREE.Vector2((s - 0.5) * d.w, upper(s) + 0.001);
    const dir = new THREE.Vector2(0.55 + k * 0.25, 1).normalize();
    const lp: THREE.Vector3[] = [];
    const ln: THREE.Vector3[] = [];
    const lh: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const f = eyePoint(side, base.x + dir.x * 0.0065 * t, base.y + dir.y * 0.0065 * t, 0.0016 + 0.0012 * t);
      lp.push(f.p);
      ln.push(f.n);
      lh.push(0.0013 * (1 - t) + 0.0002);
    }
    addDetail(rig, taperTube(lp, ln, lh, 0.6, 6), lashMat);
  }
}

/** 眉毛的三個控制點（yaw、yr），side 只影響 yaw 正負 */
const BROW_SHAPES: Record<BrowShape, { pts: [[number, number], [number, number], [number, number]]; width: number }> = {
  confident: { pts: [[7, 0.1], [18, 0.14], [31, 0.125]], width: 0.0055 },
  frown: { pts: [[5, 0.075], [15, 0.115], [30, 0.15]], width: 0.005 },
  arch: { pts: [[8, 0.11], [19, 0.16], [31, 0.135]], width: 0.0026 },
  relaxed: { pts: [[7, 0.1], [19, 0.125], [31, 0.105]], width: 0.0035 },
};

/** 一邊的眉毛 */
function addBrow(rig: HumanoidRig, spec: Face3DSpec, side: number): void {
  const b = BROW_SHAPES[spec.brows];
  const [p0, p1, p2] = b.pts.map(([y, h]) => [side * y, h] as [number, number]);
  const path = bezier2(p0, p1, p2, 16);
  // 內側粗、外側收細
  const geo = faceStroke(path, (t) => b.width * (1 - 0.55 * t) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.15))), 0.0018, 0.5);
  addDetail(rig, geo, lineMat(spec.brow, 0.75));
}

/** 嘴線 */
function addMouth(rig: HumanoidRig, spec: Face3DSpec): void {
  let path: [number, number][];
  let width = 0.0014;
  switch (spec.mouth) {
    case 'grin':
      path = bezier2([-9.5, -0.535], [0, -0.64], [9.5, -0.532], 18);
      width = 0.0019;
      break;
    case 'smile':
      path = bezier2([-6, -0.565], [0, -0.615], [6, -0.562], 16);
      break;
    case 'frown':
      path = bezier2([-4.5, -0.592], [0, -0.572], [4.5, -0.594], 14);
      width = 0.0013;
      break;
    default:
      return;
  }
  addDetail(rig, faceStroke(path, (t) => width * (0.35 + 0.65 * Math.sin(Math.PI * t)), 0.0005, 0.35), lineMat(0x5a2a22, 0.6));
}

/** 鬍鬚紋：兩頰各三條，兩端漸細、微微凸起 */
function addWhiskers(rig: HumanoidRig): void {
  const mat = lineMat(0x3b2a20, 0.7);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y0 = -0.3 - i * 0.068;
      const path = bezier2([side * 28, y0], [side * 36.5, y0 - 0.012 - i * 0.004], [side * 45, y0 - 0.03 - i * 0.008], 12);
      addDetail(rig, faceStroke(path, (t) => 0.0012 * Math.sin(Math.PI * t) + 0.0002, 0.0006, 0.6), mat);
    }
  }
}

/** 腮紅貼片（放射漸層、半透明） */
let blushTex: THREE.CanvasTexture | null = null;
function addBlush(rig: HumanoidRig): void {
  if (!blushTex) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,120,120,0.55)');
    grad.addColorStop(1, 'rgba(255,120,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    blushTex = new THREE.CanvasTexture(c);
    blushTex.colorSpace = THREE.SRGBColorSpace;
  }
  const mat = stdMat({ map: blushTex, transparent: true, depthWrite: false, roughness: 0.8 }, 'face-blush');
  for (const side of [-1, 1]) {
    const NU = 8;
    const NV = 6;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const s = i / (NU - 1);
        const t = j / (NV - 1);
        const { p } = liftedPoint(side * (29 + (s - 0.5) * 16), -0.39 + (t - 0.5) * 0.13, 0.0007);
        pos.push(p.x, p.y, p.z);
        uv.push(s, t);
      }
    }
    for (let j = 0; j < NV - 1; j++) {
      for (let i = 0; i < NU - 1; i++) {
        const a = j * NU + i;
        if (side > 0) idx.push(a, a + NU, a + 1, a + 1, a + NU, a + NU + 1);
        else idx.push(a, a + 1, a + NU, a + 1, a + NU + 1, a + NU);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = addDetail(rig, geo, mat);
    m.renderOrder = 2;
  }
}

/**
 * 面罩：從鼻樑（眼睛下方）往下整個包住到下巴與後頸，比頭殼大一點；鼻樑會透出來。
 * 上緣：正中央在鼻樑最高，往兩側沿眼睛下方往後、經過耳朵下方繞到後頸。
 */
function addMask(rig: HumanoidRig, color: number): void {
  const NU = 96;
  const NV = 22;
  const top = (yaw: number) => {
    const a = Math.abs(yaw);
    // 側面降到耳朵下方（耳朵要露出來），再繞到後頸
    return -0.262 + 0.06 * bump(a, 0, 7, 1) - 0.23 * smooth(40, 85, a);
  };
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < NV; j++) {
    const t = j / (NV - 1);
    for (let i = 0; i <= NU; i++) {
      const yaw = -180 + (i / NU) * 360;
      const y0 = top(yaw);
      const yr = y0 + (-0.985 - y0) * Math.pow(t, 0.85);
      const { p } = liftedPoint(yaw, yr, 0.0045 + 0.002 * t);
      pos.push(p.x, p.y, p.z);
    }
  }
  const W = NU + 1;
  for (let j = 0; j < NV - 1; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * W + i;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = fabricMat(color);
  const mask = new THREE.Mesh(geo, mat);
  rig.head.add(mask);
  // 上緣的收邊（布料厚度）
  const hem: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const yaw = -180 + (i / 64) * 360;
    hem.push([yaw, top(yaw)]);
  }
  const hemGeo = faceStroke(hem, () => 0.0032, 0.0048, 0.9);
  const hemMesh = new THREE.Mesh(hemGeo, mat);
  rig.head.add(hemMesh);
}

/** 耳朵：圓耳＋耳輪＋耳窩（沿用第一版的位置） */
function addEars(rig: HumanoidRig, skin: number): void {
  const skinM = skinMat(skin);
  const inner = skinMat(darken(skin, 0.86));
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.064, 20, 14), skinM);
    ear.scale.set(0.42, 0.95, 0.72);
    ear.position.set(side * R * 0.985, -0.05, -0.004);
    rig.head.add(ear);
    // 耳輪：沿耳朵外緣的大半圈，缺口朝前下方（圓環兩面對稱，左右耳用同一個轉向）
    const rimGeo = new THREE.TorusGeometry(0.046, 0.009, 8, 20, Math.PI * 1.3);
    rimGeo.rotateZ(-Math.PI * 0.15);
    const rim = new THREE.Mesh(rimGeo, skinM);
    rim.rotation.y = Math.PI / 2;
    rim.scale.set(1, 1.25, 1);
    rim.position.set(side * (R * 0.985 + 0.012), -0.045, -0.004);
    rig.head.add(rim);
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), inner);
    hole.scale.set(0.24, 0.72, 0.5);
    hole.position.set(side * (R * 0.985 + 0.014), -0.05, -0.012);
    hole.userData.noOutline = true;
    rig.head.add(hole);
  }
}

/** 眼球片材質快取（依眼型與虹膜色） */
const eyeMats = new Map<string, THREE.MeshStandardMaterial>();

/**
 * 立體頭部：雕塑頭殼＋耳朵＋眼睛、眉毛、嘴、鬍鬚紋、腮紅、面罩（依角色設定）。
 * 取代第一版的 addHeadHD（臉部貼圖）；頭髮、護額由各角色自己加。
 */
export function addHead3D(rig: HumanoidRig, spec: Face3DSpec): void {
  rig.head.add(new THREE.Mesh(headGeometry(), skinMat(spec.skin)));
  addEars(rig, spec.skin);
  const key = `${spec.eyes}|${spec.iris}`;
  let eyeMat = eyeMats.get(key);
  if (!eyeMat) {
    const tex = eyeTexture(EYE_DIMS[spec.eyes], spec.iris);
    eyeMat = stdMat({ map: tex, roughness: 0.16, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 });
    eyeMats.set(key, eyeMat);
  }
  for (const side of spec.rightEyeOnly ? [1] : [-1, 1]) {
    addEye(rig, spec, side, eyeMat);
    addBrow(rig, spec, side);
  }
  if (spec.mask !== undefined) {
    addMask(rig, spec.mask);
    return;
  }
  addMouth(rig, spec);
  if (spec.whiskers) addWhiskers(rig);
  if (spec.blush) addBlush(rig);
}
