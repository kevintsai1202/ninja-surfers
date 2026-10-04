import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMS, type HumanoidRig } from './rig';
import { buildHumanoidHD, finalizeRig, addVestHD, darken } from './hdBody';
import { addHeadbandHD, NINJA_COLORS, type HeadbandPose } from './ninja';
import { addHead3D, sculpt } from './face3d';
import { fabricMat, hairMat, metalMat, skinMat } from './charMats';
import { shapeHead, latheBody, ringBand } from './shapes';

/**
 * 卡卡西（Q 版，高精細版）：參考 docs/concept/kakashi-sheet.jpg、kakashi-face.jpg。
 * - 頭：銀白色葉片形刺蝟頭，整叢往上翹、強烈往角色左邊（−x）掃；斜戴的護額（金屬片斜在左額、布蓋住左眼）；
 *   深藍面罩從鼻樑包到脖子；只露出右眼（半閉的睏眼）。
 * - 身體：深藍長袖上衣＋綠色中忍背心（背後正中央紅色漩渦）、兩臂紅色漩渦袖章、
 *   露指手套（手背金屬護片）、深藍長褲、白色綁腿、右大腿忍具袋、藍色涼鞋。
 * - 大人：整體放大 4%（從腳底縮放，腳仍踩在地上），比例維持 Q 版。
 * 關節階層與主角相同，共用 anim.ts 的忍者跑。
 */

const R = DIMS.headR;
const DEG = Math.PI / 180;

/** 卡卡西配色 */
const KAKASHI_COLORS = {
  skin: 0xf3c7a2,
  /** 銀白髮（頂點色再做出髮根暗、髮尖亮） */
  hair: 0xd2d6e0,
  /** 上衣、褲子（偏灰的石板藍，參考圖不是很飽和的深藍） */
  navy: 0x3f405f,
  /** 面罩與往下延伸的高領 */
  mask: 0x393b59,
  /** 護額布帶（含左眼遮布） */
  band: 0x383a58,
  /** 手套與袖口 */
  glove: 0x2d2f4a,
  /** 中忍背心（偏灰的橄欖綠） */
  vest: 0x65724c,
  /** 紅色漩渦紋（袖章、背後） */
  swirl: 0xc23a2c,
  /** 小腿綁腿 */
  wraps: 0xe8e4da,
  /** 手背金屬護片 */
  guard: 0xc4cad1,
  iris: '#3d3f4a',
  /** 眉毛（深銀灰） */
  brow: 0x5d6069,
};

/** 護額斜戴：正面往下壓、整條往角色左邊轉、左邊往下 → 金屬片從額頭中央斜到左太陽穴 */
const HEADBAND_POSE: Required<HeadbandPose> = { pitch: -0.15, yaw: 0.3, roll: 0.45 };
/** 布帶中線在護額區域座標的高度與半寬（與 ninja.ts addHeadbandHD 的 y = r × 0.34、高 0.082 相同） */
const BAND_Y = R * 0.34;
const BAND_HALF = 0.041;
/** 布帶中線離頭心的距離（約略值，用來把高度換成 yr） */
const BAND_RHO = 0.262;
/**
 * 布帶的目標路徑（頭部座標的中線高度，公尺）：右額約 0.076（下緣剛好在右眉上方）、右側水平經過耳朵上方、
 * 後腦打結處 0.045、左側 0.01。金屬片那一段（yaw −47°..−3°）不動，見 bandPath、warpHeadband。
 */
const BAND_TARGET: [number, number][] = [
  [-180, 0.045],
  [-140, 0.03],
  [-100, 0.012],
  [-70, 0.006],
  [-47, 0.0],
  [-3, 0.079],
  [20, 0.076],
  [60, 0.072],
  [110, 0.07],
  [150, 0.055],
  [180, 0.045],
];

/** 衣身輪廓（[半徑, 高度]）與 x／z 縮放、背心加大量：與 hdBody.ts 相同（那邊沒有匯出，改了要一起改） */
const BELLY_PROFILE: [number, number][] = [
  [0.15, 0],
  [0.162, 0.05],
  [0.17, 0.12],
  [0.174, 0.19],
  [0.176, 0.27],
];
const CHEST_PROFILE: [number, number][] = [
  [0.176, -0.035],
  [0.182, 0.03],
  [0.18, 0.09],
  [0.165, 0.15],
  [0.13, 0.195],
  [0.08, 0.215],
];
const BODY_SX = 1.13;
const BODY_SZ = 0.86;
const VEST_PAD = 0.022;

/** 0..1 平滑插值 */
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 頭部方向：yaw（度，正值往角色右邊）、yr（高度 ÷ 頭半徑）→ 單位向量（正面 −z） */
function dirOf(yaw: number, yr: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.sqrt(Math.max(0, 1 - yr * yr));
  return out.set(Math.sin(yaw * DEG) * c, yr, -Math.cos(yaw * DEG) * c);
}

/** 頭部座標下、距頭心 dist 的點（套上 Q 版頭型變形，和頭殼、頭髮一致） */
function headPoint(dir: THREE.Vector3, dist: number): THREE.Vector3 {
  const p = dir.clone().normalize().multiplyScalar(dist);
  shapeHead(p);
  return p;
}

/** 依輪廓內插某個高度的半徑 */
function radiusAt(profile: [number, number][], y: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return y < profile[0][1] ? profile[0][0] : profile[profile.length - 1][0];
}

/** 依折線控制點 [x, 值] 平滑內插（相鄰兩點之間用 smoothstep） */
function smoothTable(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, v0] = table[i];
    const [x1, v1] = table[i + 1];
    if (x <= x1) return v0 + (v1 - v0) * smooth(x0, x1, x);
  }
  return table[table.length - 1][1];
}

/**
 * 沿曲線掃出扁橢圓斷面的細條（漩渦紋）：斷面的寬沿表面、高沿法線，兩端用扇形封口。
 * （同 face3d.ts 的 taperTube，那邊沒有匯出）
 * @param pts 曲線上的點
 * @param nrm 每個點的朝外法線
 * @param half 每個點的半寬
 * @param hRatio 斷面高／寬
 */
function surfaceStroke(pts: THREE.Vector3[], nrm: THREE.Vector3[], half: number[], hRatio: number, radial = 6): THREE.BufferGeometry {
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

// ───────────────────────── 護額 ─────────────────────────

/** 護額群組的旋轉矩陣（與 addHeadbandHD 裡 g.rotation.set(pitch, yaw, roll) 相同：Euler XYZ） */
function headbandMatrix(pose: Required<HeadbandPose>): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pose.pitch, pose.yaw, pose.roll, 'XYZ'));
}

/**
 * 從頭心往 dir 看出去，視線打到「轉動前」布帶（護額區域座標裡的直立圓筒）的高度。
 * 布帶圓筒套過頭型變形，x 方向比 z 方向寬約 7%。
 * @param inv 護額群組旋轉的反矩陣
 */
function bandHitY(dir: THREE.Vector3, inv: THREE.Matrix4): number {
  const d = dir.clone().applyMatrix4(inv);
  const t = 1 / Math.sqrt((d.x / (0.25 * 1.07)) ** 2 + (d.z / 0.25) ** 2);
  return d.y * t;
}

/** 在某個 yaw 上找出「視線打到轉動前布帶區域高度 target」的 yr（二分法；範圍內單調） */
function yrAtBand(yaw: number, target: number, inv: THREE.Matrix4): number {
  let lo = -0.8;
  let hi = 0.8;
  const v = new THREE.Vector3();
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (bandHitY(dirOf(yaw, mid, v), inv) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 斜戴布帶的路徑：轉動前後的對照與彎曲量 */
interface BandPath {
  /** 護額群組旋轉的反矩陣 */
  inv: THREE.Matrix4;
  /** 某個 yaw 上布帶中線（彎曲後）的 yr */
  centerYr(yaw: number): number;
  /** 某個 yaw 上把布帶往上（正）或往下（負）彎的仰角（弧度） */
  bend(yaw: number): number;
}

/**
 * 計算斜戴布帶的路徑：addHeadbandHD 的布帶是一個「平面圓環」，整個轉斜之後右側與後腦會翹得太高
 * （參考圖的布帶在右邊水平經過耳朵上方、後腦打結）。這裡量出圓環轉完後每個 yaw 的中線高度，
 * 再算出要沿經線彎到 BAND_TARGET 的角度；金屬片那一段（−47°..−3°）不動，兩側 22° 內平滑接上。
 */
function bandPath(pose: Required<HeadbandPose>): BandPath {
  const inv = headbandMatrix(pose).invert();
  /** 轉動前布帶中線在各 yaw 的 yr */
  const origYr = (yaw: number) => yrAtBand(yaw, BAND_Y, inv);
  /** 彎曲權重：金屬片那段 0、兩側漸漸到 1 */
  const weight = (yaw: number) => (yaw > -3 ? smooth(-3, 19, yaw) : yaw < -47 ? 1 - smooth(-69, -47, yaw) : 0);
  const bend = (yaw: number) => {
    const from = Math.asin(Math.max(-1, Math.min(1, origYr(yaw))));
    const to = Math.asin(Math.max(-1, Math.min(1, smoothTable(BAND_TARGET, yaw) / BAND_RHO)));
    return (to - from) * weight(yaw);
  };
  return {
    inv,
    bend,
    centerYr: (yaw) => Math.sin(Math.asin(Math.max(-1, Math.min(1, origYr(yaw)))) + bend(yaw)),
  };
}

/**
 * 把一個點（頭部座標）沿經線轉 dEl（弧度）：離頭心的距離不變、水平方向的比例（含頭型的 x 拉寬）不變。
 */
function rotateOnMeridian(p: THREE.Vector3, dEl: number): void {
  const h = Math.hypot(p.x, p.z);
  if (h < 1e-6) return;
  const rho = Math.hypot(h, p.y);
  const el = Math.atan2(p.y, h) + dEl;
  const h2 = rho * Math.cos(el);
  p.x *= h2 / h;
  p.z *= h2 / h;
  p.y = rho * Math.sin(el);
}

/**
 * 金屬片與鉚釘往外推的比例（以頭心為中心）：布帶套過頭型變形後兩側比較寬，
 * 會從沒變形的金屬片左右兩段穿出來（主角也有，見回報），往外推一點就蓋得住。
 */
const PLATE_PUSH = 1.035;

/**
 * 把 addHeadbandHD 做好的護額「彎」成參考圖的路徑：布帶頂點、後腦的結、兩個環與綁帶起點都沿經線移到目標高度；
 * 金屬片與鉚釘那段權重是 0，不會彎，但整片往外推 PLATE_PUSH，布帶才不會從金屬片穿出來。
 */
function warpHeadband(group: THREE.Object3D, path: BandPath): void {
  const m = new THREE.Matrix4().copy(path.inv).invert();
  const p = new THREE.Vector3();
  const az = (v: THREE.Vector3) => Math.atan2(v.x, -v.z) / DEG;
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry.type === 'LatheGeometry') {
      // 布帶本體：逐頂點彎
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m);
        rotateOnMeridian(p, path.bend(az(p)));
        p.applyMatrix4(path.inv);
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    } else if (mesh.isMesh && mesh.geometry.type === 'BoxGeometry') {
      // 金屬片：以頭心為中心往外推
      mesh.position.multiplyScalar(PLATE_PUSH);
      mesh.scale.setScalar(PLATE_PUSH);
    } else if (mesh.isMesh && child.position.z < 0) {
      // 鉚釘（在正面金屬片上）：跟著金屬片往外推
      child.position.multiplyScalar(PLATE_PUSH);
    } else {
      // 後腦的結、環、綁帶起點：沿經線移到目標高度
      p.copy(child.position).applyMatrix4(m);
      rotateOnMeridian(p, path.bend(az(p)));
      child.position.copy(p.applyMatrix4(path.inv));
    }
  }
}

/** 面罩上緣的 yr（與 face3d.ts addMask 的 top() 相同；那邊沒有匯出） */
function maskTopYr(yaw: number): number {
  const a = Math.abs(yaw);
  return -0.262 + 0.06 * Math.exp(-0.5 * (a / 7) ** 2) - 0.23 * smooth(40, 85, a);
}

/** 遮布表面上的點：沿用臉部雕塑但不要凹陷（布是撐過眼窩的），套頭型變形後沿法線浮起 lift */
function clothPoint(yaw: number, yr: number, lift: number): THREE.Vector3 {
  const base = (yw: number, y: number) => headPoint(dirOf(yw, y), R + Math.max(0, sculpt(yw, y)));
  const p = base(yaw, yr);
  const px = base(yaw + 0.35, yr).sub(p);
  const py = base(yaw, yr + 0.003).sub(p);
  const n = new THREE.Vector3().crossVectors(py, px).normalize();
  return p.addScaledVector(n, lift);
}

/**
 * 左眼遮布：參考圖的金屬片斜在左額，金屬片下方的布一路蓋住整個左眼、接到面罩上緣。
 * 做成貼著臉（浮起約 1 公分）的一片布：上緣塞進布帶下半部、下緣蓋住面罩的收邊，
 * 右緣到鼻樑、左端往上收進太陽穴的布帶。先在頭部座標算好，再轉進護額群組（和布帶同材質，合併成一個 draw call）。
 */
function addEyeCover(group: THREE.Object3D, path: BandPath, bandColor: number): void {
  /** 橫向（yaw）與縱向分段 */
  const NU = 18;
  const NV = 7;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      // 右緣（鼻樑側）略斜：下端 −3°、上端 +1°；左端到 −52°
      const yaw = (-3 + 4 * v) * (1 - u) - 52 * u;
      const shift = path.bend(yaw);
      const top = Math.sin(Math.asin(yrAtBand(yaw, BAND_Y - 0.016, path.inv)) + shift);
      const edge = Math.sin(Math.asin(yrAtBand(yaw, BAND_Y - BAND_HALF + 0.004, path.inv)) + shift);
      let bot = maskTopYr(yaw) - 0.03;
      // 左端：下緣慢慢升到布帶下緣上方，收進布帶裡
      bot += (edge + 0.03 - bot) * smooth(0.55, 1, u);
      const yr = bot + (top - bot) * v;
      // 布撐過眼睛，中間略鼓
      const lift = 0.0095 + 0.0025 * Math.sin(Math.PI * Math.min(1, u * 1.6)) * Math.sin(Math.PI * v);
      const p = clothPoint(yaw, yr, lift);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j;
      const b = (i + 1) * (NV + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.applyMatrix4(path.inv);
  geo.computeVertexNormals();
  const cover = new THREE.Mesh(geo, fabricMat(bandColor));
  cover.userData.noOutline = true;
  group.add(cover);
}

/**
 * 斜戴的護額：用主角的 addHeadbandHD（金屬片、布帶、後腦的結與兩條綁帶）轉成斜的，
 * 再把布帶彎成參考圖的路徑，最後補上蓋住左眼的布。
 */
function addSlantedHeadband(rig: HumanoidRig, path: BandPath): void {
  addHeadbandHD(rig, KAKASHI_COLORS.band, true, HEADBAND_POSE);
  const group = rig.head.getObjectByName('headband');
  if (!group) return;
  warpHeadband(group, path);
  addEyeCover(group, path, KAKASHI_COLORS.band);
}

// ───────────────────────── 頭髮 ─────────────────────────

/**
 * 一撮葉片形髮束（參考圖那種大片、帶弧度、有中脊的髮片）。
 * 脊線是二次貝茲曲線 a → b → c；斷面是扁葉形：寬沿 W、厚沿 N，中脊往 face 方向凸、兩側往後收。
 * 寬度從髮根 0.75 倍到約 1/4 處最寬，再收成尖端；頂點色做出髮根暗、髮尖亮
 * （hairMat 是頂點色材質，幾何一定要有 color 屬性，合併時才不會變黑或失敗）。
 * @param w 最寬處的半寬（公尺）
 * @param face 髮片正面的朝向（通常是往頭外）
 * @param tone 這撮的明暗微調（1 = 標準）
 */
function bladeGeometry(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  w: number,
  face: THREE.Vector3,
  tone = 1,
): THREE.BufferGeometry {
  /** 斷面分段、長度分段、厚度比 */
  const RAD = 6;
  const RINGS = 7;
  const FLAT = 0.5;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const W = new THREE.Vector3();
  const ab = new THREE.Vector3().subVectors(b, a);
  const bc = new THREE.Vector3().subVectors(c, b);
  const up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j <= RINGS; j++) {
    const s = j / RINGS;
    P.set(0, 0, 0)
      .addScaledVector(a, (1 - s) * (1 - s))
      .addScaledVector(b, 2 * (1 - s) * s)
      .addScaledVector(c, s * s);
    T.copy(ab)
      .multiplyScalar(2 * (1 - s))
      .addScaledVector(bc, 2 * s)
      .normalize();
    // N 指向髮片背面（face 的反方向，扣掉沿 T 的分量）；face 幾乎平行 T 時改用「上」
    N.copy(face).addScaledVector(T, -face.dot(T));
    if (N.lengthSq() < 0.05) N.copy(up).addScaledVector(T, -up.dot(T));
    N.normalize().negate();
    W.crossVectors(T, N).normalize();
    const prof = s < 0.25 ? 0.75 + 0.25 * Math.sin(((s / 0.25) * Math.PI) / 2) : Math.pow(Math.cos((((s - 0.25) / 0.75) * Math.PI) / 2), 0.8);
    const half = w * prof;
    const shade = (0.62 + 0.4 * Math.pow(s, 0.8)) * tone;
    for (let k = 0; k < RAD; k++) {
      const th = (k / RAD) * Math.PI * 2;
      const cs = Math.cos(th);
      // 中脊在 −N（正面）凸出、兩側往 +N 收
      const off = Math.sin(th) * half * FLAT + 0.25 * half * cs * cs;
      pos.push(P.x + W.x * cs * half + N.x * off, P.y + W.y * cs * half + N.y * off, P.z + W.z * cs * half + N.z * off);
      col.push(shade, shade, shade);
    }
  }
  for (let j = 0; j < RINGS; j++) {
    for (let k = 0; k < RAD; k++) {
      const i0 = j * RAD + k;
      const i1 = j * RAD + ((k + 1) % RAD);
      idx.push(i0, i0 + RAD, i1, i1, i0 + RAD, i1 + RAD);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 一撮髮束的設定：[髮根 yaw（度）, 髮根仰角（度，90 = 頭頂）, 長度, 半寬, 尖端往外翹的比例 out] */
type LockSpec = [number, number, number, number, number];

/** 一組髮束共用的流向：前段往 rise（投影到頭皮切平面）長、後段轉往 sweep 甩出去 */
interface LockFlow {
  rise: [number, number, number];
  sweep: [number, number, number];
  /** 髮根離開頭皮的角度（度） */
  lift0: number;
  /**
   * 依髮根位置把流向繞 y 軸轉 twist × sin(yaw) 度：右半邊的頭髮比較往後梳、左半邊比較往左甩
   * （參考圖從右前方看，右邊的髮束是往後倒的；從正面看整叢往左傾）
   */
  twist?: number;
}

/**
 * 一組髮束：髮根在頭皮下（0.95R）；前段沿 rise 方向（投影到切平面、再抬起 lift0）長出去，
 * 後段轉往 sweep 方向（混一點外法線，out 越大越往外刺）把尖端甩出去——像參考圖那樣先翹起、再往左掃。
 * 每撮的明暗略有變化，看起來才有層次。
 */
function addLocks(rig: HumanoidRig, mat: THREE.Material, specs: LockSpec[], flow: LockFlow): void {
  const up = new THREE.Vector3(0, 1, 0);
  specs.forEach(([az, el, len, w, out], i) => {
    const turn = (flow.twist ?? 0) * Math.sin(az * DEG) * DEG;
    const rise = new THREE.Vector3(...flow.rise).normalize().applyAxisAngle(up, turn);
    const sweep = new THREE.Vector3(...flow.sweep).normalize().applyAxisAngle(up, turn);
    const d = dirOf(az, Math.sin(el * DEG));
    const a = headPoint(d, R * 0.95);
    // rise 投影到這裡的切平面（剛好垂直頭皮時改往上）
    const ft = rise.clone().addScaledVector(d, -rise.dot(d));
    if (ft.lengthSq() < 1e-3) ft.set(0, 1, 0).addScaledVector(d, -d.y);
    ft.normalize();
    const g0 = ft.multiplyScalar(Math.cos(flow.lift0 * DEG)).addScaledVector(d, Math.sin(flow.lift0 * DEG)).normalize();
    const g1 = sweep.clone().multiplyScalar(1 - out).addScaledVector(d, out).normalize();
    const b = a.clone().addScaledVector(g0, len * 0.45);
    const c = b.clone().addScaledVector(g1, len * 0.6);
    const tone = 0.95 + (0.1 * ((i * 37) % 5)) / 4;
    rig.head.add(new THREE.Mesh(bladeGeometry(a, b, c, w, d, tone), mat));
  });
}

/**
 * 頭髮底層（髮蓋）：從頭頂往下包到下緣——正面沿著斜戴的布帶中線（塞在布帶底下）、
 * 兩側停在耳朵上方、耳後往下繞到後頸。越往下緣越貼頭皮（1.05R 收到 1.01R），邊緣不會像浮起來的帽子。
 * @param bandYr 某個 yaw 上布帶中線的 yr
 */
function hairCapGeometry(bandYr: (yaw: number) => number): THREE.BufferGeometry {
  const NU = 40;
  const NV = 11;
  /** 兩側與後腦的下緣（|yaw| → yr）：太陽穴、耳朵上方、耳後、後頸 */
  const SIDE: [number, number][] = [
    [55, 1],
    [72, 0.12],
    [104, 0.06],
    [122, -0.4],
    [145, -0.68],
    [180, -0.8],
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= NU; i++) {
    const yaw = -180 + (i / NU) * 360;
    const edge = Math.min(bandYr(yaw) - 0.03, smoothTable(SIDE, Math.abs(yaw)));
    const thMax = Math.acos(Math.max(-0.98, Math.min(0.98, edge)));
    for (let j = 0; j <= NV; j++) {
      const t = j / NV;
      dirOf(yaw, Math.cos(thMax * t), v);
      const p = headPoint(v, R * (1.012 + 0.032 * (1 - t * t)));
      pos.push(p.x, p.y, p.z);
      const shade = 0.55 + 0.13 * (1 - t);
      col.push(shade, shade, shade);
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j;
      const b = (i + 1) * (NV + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 額前與右側髮際：從布帶後面陡陡地翹起來，再往左後方倒（頭頂的蓬度） */
const FLOW_FRONT: LockFlow = { rise: [-0.4, 0.45, 0.8], sweep: [-0.6, 0.16, 0.79], lift0: 10, twist: 28 };
/** 頭頂：順著往左後方梳、貼著頭，尖端再翹起 */
const FLOW_TOP: LockFlow = { rise: [-0.72, 0.15, 0.66], sweep: [-0.68, 0.2, 0.7], lift0: 14, twist: 24 };
/** 左側：往上冒一點就往左甩出去（從正面看整叢往畫面右邊傾） */
const FLOW_LEFT: LockFlow = { rise: [-0.3, 1, 0.3], sweep: [-0.95, 0.22, 0.2], lift0: 18 };
/** 後腦上半（布帶上方）：往後上方、往左掃 */
const FLOW_BACK_UP: LockFlow = { rise: [-0.45, 0.65, 0.6], sweep: [-0.6, 0.3, 0.75], lift0: 18, twist: 15 };
/** 後腦布帶以下：往下、尖端略往後翹 */
const FLOW_BACK: LockFlow = { rise: [-0.1, -1, 0.3], sweep: [-0.15, -0.8, 0.6], lift0: 12 };
/** 左額：垂下來蓋住布帶 */
const FLOW_DROOP: LockFlow = { rise: [-0.45, -0.85, -0.25], sweep: [-0.55, -0.8, -0.1], lift0: 14 };

/**
 * 銀白刺蝟頭：髮蓋＋葉片形髮束，整叢梳向左後方：額前與右側從布帶後面翹起來撐出蓬度、
 * 頭頂順著往左後方倒、左邊長長地甩出去、左額幾撮垂下來蓋住布帶；後腦一層層往下的短髮；耳朵前面的鬢角。
 */
function addHair(rig: HumanoidRig, bandYr: (yaw: number) => number): void {
  const mat = hairMat(KAKASHI_COLORS.hair);
  rig.head.add(new THREE.Mesh(hairCapGeometry(bandYr), mat));
  // 額前與右側髮際（布帶上方）
  addLocks(
    rig,
    mat,
    [
      [-18, 36, 0.358, 0.06, 0.15],
      [8, 40, 0.403, 0.065, 0.15],
      [32, 42, 0.403, 0.065, 0.16],
      [56, 44, 0.392, 0.063, 0.18],
      [80, 46, 0.37, 0.06, 0.18],
      [104, 46, 0.347, 0.058, 0.18],
      [-2, 52, 0.426, 0.067, 0.16],
      [20, 30, 0.3, 0.056, 0.14],
      [68, 32, 0.3, 0.054, 0.16],
      [44, 56, 0.414, 0.065, 0.18],
    ],
    FLOW_FRONT,
  );
  // 頭頂與中段
  addLocks(
    rig,
    mat,
    [
      [-40, 62, 0.48, 0.067, 0.15],
      [0, 70, 0.504, 0.069, 0.14],
      [50, 72, 0.48, 0.067, 0.14],
      [100, 66, 0.456, 0.065, 0.16],
      [150, 66, 0.456, 0.065, 0.18],
      [-150, 64, 0.48, 0.065, 0.18],
      [-95, 66, 0.504, 0.067, 0.18],
      [0, 88, 0.48, 0.067, 0.15],
    ],
    FLOW_TOP,
  );
  // 左側：甩得最遠
  addLocks(
    rig,
    mat,
    [
      [-52, 40, 0.461, 0.063, 0.32],
      [-80, 40, 0.538, 0.067, 0.34],
      [-108, 40, 0.512, 0.065, 0.32],
      [-135, 42, 0.461, 0.062, 0.3],
      [-92, 22, 0.435, 0.06, 0.34],
      [-122, 24, 0.41, 0.056, 0.32],
    ],
    FLOW_LEFT,
  );
  // 後腦上半（布帶上方）
  addLocks(
    rig,
    mat,
    [
      [128, 36, 0.336, 0.057, 0.3],
      [158, 36, 0.358, 0.059, 0.3],
      [-172, 34, 0.358, 0.059, 0.3],
      [-148, 30, 0.336, 0.055, 0.3],
    ],
    FLOW_BACK_UP,
  );
  // 後腦布帶以下：一層層往下、往後的短髮，長短與翹度錯開（短，跑步抬頭時才不會插進背心高領）
  addLocks(
    rig,
    mat,
    [
      [180, -2, 0.18, 0.054, 0.16],
      [157, 0, 0.15, 0.049, 0.26],
      [-158, -3, 0.17, 0.052, 0.14],
      [133, 2, 0.13, 0.045, 0.22],
      [-132, 0, 0.15, 0.047, 0.18],
      [110, 4, 0.12, 0.04, 0.14],
      [-108, -2, 0.14, 0.043, 0.2],
      [170, -22, 0.14, 0.047, 0.28],
      [-166, -20, 0.15, 0.045, 0.18],
      [144, -18, 0.12, 0.043, 0.22],
      [-143, -22, 0.12, 0.04, 0.26],
      [120, -16, 0.1, 0.036, 0.16],
      [-119, -16, 0.11, 0.036, 0.22],
      [178, -40, 0.1, 0.038, 0.28],
      [152, -36, 0.09, 0.034, 0.22],
      [-154, -38, 0.1, 0.034, 0.26],
    ],
    FLOW_BACK,
  );
  // 左額：垂下來蓋住布帶
  addLocks(
    rig,
    mat,
    [
      [-42, 30, 0.2, 0.042, 0.2],
      [-58, 32, 0.23, 0.044, 0.22],
      [-72, 30, 0.2, 0.04, 0.22],
    ],
    FLOW_DROOP,
  );
  // 鬢角：耳朵前面往下垂（貼著臉）
  addLocks(
    rig,
    mat,
    [
      [68, 12, 0.15, 0.03, 0.04],
      [76, 16, 0.13, 0.026, 0.04],
    ],
    { rise: [0.05, -1, -0.3], sweep: [0, -1, -0.35], lift0: 8 },
  );
  addLocks(rig, mat, [[-68, 4, 0.12, 0.028, 0.04]], { rise: [-0.05, -1, -0.3], sweep: [0, -1, -0.35], lift0: 8 });
}

// ───────────────────────── 脖子、漩渦紋、手套、背心 ─────────────────────────

/**
 * 面罩往下延伸的高領：包住脖子，下端塞進背心高領裡；拿掉 buildHumanoidHD 的皮膚脖子
 * （不然會從背心高領前面的開口露出來）。
 */
function addNeckGaiter(rig: HumanoidRig, skin: number, color: number): void {
  const skinM = skinMat(skin);
  for (const c of [...rig.neck.children]) {
    if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).material === skinM) rig.neck.remove(c);
  }
  const profile: [number, number][] = [
    [0.094, -0.095],
    [0.08, -0.05],
    [0.072, 0.0],
    [0.07, 0.06],
  ];
  rig.neck.add(new THREE.Mesh(latheBody(profile, 1.05, 1, 24, 0, Math.PI * 2), fabricMat(color)));
}

/** 曲面上一點與朝外法線（給漩渦紋用：u 往右、v 往上，單位公尺） */
type SurfaceMap = (u: number, v: number) => { p: THREE.Vector3; n: THREE.Vector3 };

/**
 * 紅色漩渦紋：從中心往外逆時針轉 turns 圈，外圈尾端停在右下；做成微微凸起的扁條，貼在曲面上。
 * @param map 平面座標 → 曲面上的點與法線
 * @param radius 外圈半徑（公尺）
 * @param halfRel 筆畫半寬（相對半徑）
 */
function swirlGeometry(map: SurfaceMap, radius: number, turns: number, halfRel: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  const half: number[] = [];
  const n = Math.round(36 * turns);
  const aMax = turns * Math.PI * 2;
  const a0 = -Math.PI / 4 - aMax;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = a0 + t * aMax;
    const r = radius * (0.1 + 0.9 * t);
    const hw = radius * halfRel * (0.6 + 0.4 * smooth(0, 0.15, t));
    const { p, n: nn } = map(Math.cos(ang) * r, Math.sin(ang) * r);
    pts.push(p.addScaledVector(nn, hw * 0.2));
    nrm.push(nn);
    half.push(hw);
  }
  return surfaceStroke(pts, nrm, half, 0.5, 5);
}

/**
 * 背心背面的曲面對應：背心是（衣身輪廓半徑 + VEST_PAD）的旋轉曲面，再縮放 (BODY_SX, 1, BODY_SZ)。
 * @param profile 胸或腰的衣身輪廓
 * @param y0 漩渦中心高度（關節座標）
 */
function vestBackMap(profile: [number, number][], y0: number): SurfaceMap {
  const f = (u: number, y: number) => {
    const rr = radiusAt(profile, y) + VEST_PAD;
    const phi = u / (rr * BODY_SX);
    return new THREE.Vector3(Math.sin(phi) * rr * BODY_SX, y, Math.cos(phi) * rr * BODY_SZ);
  };
  return (u, v) => {
    const p = f(u, y0 + v);
    const du = f(u + 0.001, y0 + v).sub(p);
    const dv = f(u, y0 + v + 0.001).sub(p);
    const n = new THREE.Vector3().crossVectors(du, dv).normalize();
    if (n.z < 0) n.negate();
    return { p, n };
  };
}

/**
 * 上臂外側的曲面對應（袖子是上粗下細的圓筒）；從手臂外側看，u 往右、v 往上。
 * @param side +1 右手、−1 左手
 * @param y0 袖章中心高度（肩關節座標）
 */
function sleeveMap(side: number, y0: number): SurfaceMap {
  return (u, v) => {
    const y = y0 + v;
    const r = 0.08 + ((0.066 - 0.08) * -y) / DIMS.upperArm;
    const psi = u / r;
    const n = new THREE.Vector3(side * Math.cos(psi), 0, -side * Math.sin(psi));
    const p = new THREE.Vector3(n.x * r, y, n.z * r);
    return { p, n };
  };
}

/**
 * 兩臂的紅色漩渦袖章與背心背後的大漩渦。
 * 背後的漩渦放在腰椎那段背心的上半：跑步時上身前傾，胸那段會被頭擋住，這段才正對追尾鏡頭。
 */
function addSwirls(rig: HumanoidRig): void {
  const red = fabricMat(KAKASHI_COLORS.swirl);
  for (const [sh, side] of [
    [rig.shoulderL, -1],
    [rig.shoulderR, 1],
  ] as [THREE.Group, number][]) {
    const m = new THREE.Mesh(swirlGeometry(sleeveMap(side, -0.075), 0.027, 1.5, 0.14), red);
    m.userData.noOutline = true;
    sh.add(m);
  }
  const back = new THREE.Mesh(swirlGeometry(vestBackMap(BELLY_PROFILE, 0.165), 0.076, 1.75, 0.115), red);
  back.userData.noOutline = true;
  rig.spine.add(back);
}

/**
 * 露指手套：手腕與手掌包一層深藍手套（手指露出皮膚），手背（外側）一片金屬護片加四顆鉚釘。
 * 手掌的掌心朝內，所以手背在 side 方向（右手 +x、左手 −x）。
 */
function addGloves(rig: HumanoidRig): void {
  const glove = fabricMat(KAKASHI_COLORS.glove);
  const guard = metalMat(KAKASHI_COLORS.guard);
  for (const [hand, side] of [
    [rig.handL, -1],
    [rig.handR, 1],
  ] as [THREE.Group, number][]) {
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.041, 0.04, 14), glove);
    wrist.position.y = -0.008;
    hand.add(wrist);
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.054, 0.086, 0.088, 2, 0.022), glove);
    palm.position.y = -0.05;
    hand.add(palm);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.008, 0.046, 0.058, 2, 0.003), guard);
    plate.position.set(side * 0.029, -0.047, 0.002);
    hand.add(plate);
    for (const [dy, dz] of [
      [-0.016, -0.021],
      [-0.016, 0.021],
      [0.016, -0.021],
      [0.016, 0.021],
    ]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 6, 4), guard);
      rivet.position.set(side * 0.0335, -0.047 + dy, 0.002 + dz);
      rivet.userData.noOutline = true;
      hand.add(rivet);
    }
  }
}

/**
 * 背心細節（addVestHD 之外）：下擺鼓起來的一圈厚滾邊、正面中線的拉鍊縫、背後兩條肩帶與扣環、
 * 胸前兩個口袋上各三格直立的卷軸隔間與上蓋（參考圖的卷軸袋）。
 * 縫線與隔間用 addVestHD 的口袋材質（同色快取），會和口袋合併，不多 draw call。
 */
function addVestDetails(rig: HumanoidRig): void {
  const vest = fabricMat(KAKASHI_COLORS.vest);
  const pouch = fabricMat(darken(KAKASHI_COLORS.vest, 0.85));
  // 下擺滾邊
  const hem = ringBand(0.178, 0.042, 0.019, 32);
  hem.scale(BODY_SX, 1, BODY_SZ);
  const hemMesh = new THREE.Mesh(hem, vest);
  hemMesh.position.y = 0.068;
  rig.spine.add(hemMesh);
  // 正面中線的拉鍊縫（腰、胸兩段）
  for (const [joint, profile, y0, y1] of [
    [rig.spine, BELLY_PROFILE, 0.075, 0.27],
    [rig.chest, CHEST_PROFILE, -0.035, 0.165],
  ] as [THREE.Group, [number, number][], number, number][]) {
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const half: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const y = y0 + ((y1 - y0) * i) / 10;
      pts.push(new THREE.Vector3(0, y, -(radiusAt(profile, y) + VEST_PAD) * BODY_SZ - 0.001));
      nrm.push(new THREE.Vector3(0, 0, -1));
      half.push(0.0035);
    }
    const seam = new THREE.Mesh(surfaceStroke(pts, nrm, half, 0.6, 5), pouch);
    seam.userData.noOutline = true;
    joint.add(seam);
  }
  // 背後兩條肩帶（從肩頭往下到背中間）＋金屬扣環
  const buckle = metalMat(KAKASHI_COLORS.guard);
  for (const side of [-1, 1]) {
    const map = vestBackMap(CHEST_PROFILE, 0);
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const half: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const { p, n } = map(side * 0.092, 0.005 + (0.18 * i) / 8);
      pts.push(p.addScaledVector(n, 0.002));
      nrm.push(n);
      half.push(0.016);
    }
    const strap = new THREE.Mesh(surfaceStroke(pts, nrm, half, 0.28, 6), pouch);
    strap.userData.noOutline = true;
    rig.chest.add(strap);
    const { p, n } = map(side * 0.092, 0.045);
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.024, 0.008, 1, 0.003), buckle);
    b.position.copy(p).addScaledVector(n, 0.006);
    b.lookAt(b.position.clone().add(n));
    b.userData.noOutline = true;
    rig.chest.add(b);
  }
  // 胸前口袋（addVestHD 放在胸關節 y = 0.02、x = ±0.075、往外轉 0.35）：三格卷軸隔間＋上蓋
  const y = 0.02;
  const zc = -(radiusAt(CHEST_PROFILE, y) + VEST_PAD) * BODY_SZ * 0.92;
  for (const side of [-1, 1]) {
    const rotY = side * 0.35;
    const center = new THREE.Vector3(side * 0.075, y, zc);
    const place = (geo: THREE.BufferGeometry, local: [number, number, number]) => {
      const m = new THREE.Mesh(geo, pouch);
      m.position.copy(center).add(new THREE.Vector3(...local).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
      m.rotation.y = rotY;
      rig.chest.add(m);
    };
    for (const dx of [-0.024, 0, 0.024]) place(new THREE.BoxGeometry(0.02, 0.054, 0.012), [dx, -0.006, -0.022]);
    place(new RoundedBoxGeometry(0.08, 0.018, 0.05, 1, 0.006), [0, 0.032, -0.002]);
  }
}

/**
 * 建立卡卡西（高精細版）。回傳的 rig 由 anim.ts 驅動動作。
 * @param outline 描邊粗細（0 = 不描邊）
 */
export function buildKakashi(outline = 0.007): HumanoidRig {
  const c = KAKASHI_COLORS;
  const rig = buildHumanoidHD({
    skin: c.skin,
    jacket: c.navy,
    cuffs: c.glove,
    sleeve: c.navy,
    pants: c.navy,
    wraps: c.wraps,
    sandal: NINJA_COLORS.sandal,
    sole: NINJA_COLORS.sole,
  });
  addVestHD(rig, c.vest, 'vest');
  addVestDetails(rig);
  addHead3D(rig, {
    skin: c.skin,
    iris: c.iris,
    brow: c.brow,
    eyes: 'sleepy',
    brows: 'relaxed',
    mouth: 'none',
    rightEyeOnly: true,
    mask: c.mask,
  });
  addNeckGaiter(rig, c.skin, c.mask);
  const path = bandPath(HEADBAND_POSE);
  addHair(rig, path.centerYr);
  addSlantedHeadband(rig, path);
  addSwirls(rig);
  addGloves(rig);
  // 大人：比主角高一點（從腳底縮放，腳仍踩在地上）
  rig.root.scale.setScalar(1.04);
  finalizeRig(rig, outline);
  // 漩渦紋是薄薄凸起的一條，影子看不出來：不投影，省下陰影那一趟的三角形
  const red = fabricMat(c.swirl);
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === red) o.castShadow = false;
  });
  return rig;
}
