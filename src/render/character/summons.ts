import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MountRig } from './mounts';
import { stdMat } from '../materials';
import { outlineMat } from '../toon';
import { seeded } from '../proctex';

/**
 * 佐助的大蛇、小櫻的蛞蝓（通靈獸坐騎，介面見 mounts.ts 的 MountRig）。
 *
 * 做法：
 * - 身體用「放樣網格」（Loft）：沿一條中心線排一圈一圈的截面。索引與 uv 只建一次，
 *   每幀只改頂點位置、重算法線（不重建幾何）。大蛇做左右 S 形擺動，蛞蝓做沿身體傳遞的伸縮波。
 * - 頭、眼柄這些不會變形的部件是獨立群組，每幀跟著身體擺位置；部件用頂點色合併成少數網格，省 draw call。
 * - 描邊沿用反向外殼（同忍犬、巨蛤蟆）；外殼和本體共用幾何，所以會跟著一起變形。
 * - 動畫只由累積的相位與時間決定：dt = 0 時重算結果不變（姿勢檢視模式凍結截圖才穩定）。
 */

/** 描邊顏色（和忍犬、巨蛤蟆相同的深褐） */
const OUTLINE_COLOR = 0x24170f;
/** 世界的上方向 */
const UP = new THREE.Vector3(0, 1, 0);

// ───────────────────────────── 共用小工具 ─────────────────────────────

/** smoothstep：x 從 a 走到 b 時，回傳值平滑地從 0 變到 1 */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 線性插值 */
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 數字顏色 → CSS 色碼（canvas 繪圖用） */
function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * 由位置、旋轉（尤拉角）、縮放組出變換矩陣（套用順序：縮放 → 旋轉 → 平移）。
 * @param order 尤拉角順序（要「先俯仰再左右轉」時用 'YXZ'）
 */
function trs(
  pos: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
  scl: [number, number, number] = [1, 1, 1],
  order: THREE.EulerOrder = 'XYZ',
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], order)),
    new THREE.Vector3(...scl),
  );
}

/**
 * 幫網格加反向外殼描邊（外殼和本體共用幾何）。
 * @param thickness 描邊粗細（公尺）
 * @param dynamic 幾何每幀變形：包圍球會過時，本體與外殼都關掉視錐剔除
 */
function addOutline(mesh: THREE.Mesh, thickness: number, dynamic = false): void {
  const shell = new THREE.Mesh(mesh.geometry, outlineMat(thickness, OUTLINE_COLOR));
  shell.userData.noOutline = true;
  if (dynamic) {
    mesh.frustumCulled = false;
    shell.frustumCulled = false;
  }
  mesh.add(shell);
}

/**
 * 雕塑幾何：拿掉 uv 與法線、合併接縫上的重複頂點，逐點變形後重算法線
 * （先合併接縫，重算的法線在接縫處才不會斷開、出現明暗線）。
 * @param geo 原始幾何（會被釋放，之後不要再用）
 * @param fn 就地修改頂點座標的變形函式
 */
function sculpt(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const g = mergeVertices(geo);
  geo.dispose();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * 上色的部件：轉成非索引、只留 position／normal／color（合併時每個部件的屬性要完全一致），可順便套變換。
 * @param hex 顏色（sRGB 色碼，會轉成線性值寫進頂點色）
 * @param matrix 變換矩陣（不要用鏡像，鏡像會讓三角形繞序反過來）
 */
function painted(geo: THREE.BufferGeometry, hex: number, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  g.clearGroups();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 合併部件幾何；屬性不一致時 mergeGeometries 會靜默回傳 null，這裡直接報錯 */
function mergeParts(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false) as THREE.BufferGeometry | null;
  if (!g) throw new Error(`summons：${name} 的部件合併失敗（屬性不一致）`);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** 三次貝茲曲線上參數 u（0..1）的點 */
function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return out.set(
    p0.x * a + p1.x * b + p2.x * c + p3.x * d,
    p0.y * a + p1.y * b + p2.y * c + p3.y * d,
    p0.z * a + p1.z * b + p2.z * c + p3.z * d,
  );
}

/**
 * 由切線算一圈截面的座標系：up＝世界上方向扣掉切線分量，side＝切線 × up（配合 Loft 的繞序，法線才會朝外）。
 */
function frameFrom(tangent: THREE.Vector3, side: THREE.Vector3, up: THREE.Vector3): void {
  up.copy(UP).addScaledVector(tangent, -tangent.dot(UP)).normalize();
  side.crossVectors(tangent, up);
}

/** 建立 canvas 與 2D 繪圖環境 */
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** 把 canvas 包成顏色貼圖（不上下翻轉：canvas 的 y 直接等於貼圖 v） */
function canvasTexture(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

/**
 * 可每幀變形的放樣網格。
 * rings 圈 × (seg + 1) 個頂點：每圈最後一點和第一點位置重疊（貼圖 u 才能從 0 走到 1），頭尾各加一個極點封口。
 * 索引與 uv 只在建構時建一次；每幀用 setRing／setPole 寫頂點位置，最後呼叫 commit()。
 * 繞序約定：截面座標 (x, y) 對應 side·x + up·y，side＝切線 × up、切線指向圈號增加的方向；
 * 截面點要依「腹部 → +x 側 → 背部 → −x 側 → 腹部」的順序排，法線才會朝外。
 */
class Loft {
  /** 幾何（本體與描邊外殼共用） */
  readonly geometry = new THREE.BufferGeometry();
  /** 頂點座標（每幀直接寫入這個陣列） */
  private readonly pos: Float32Array;
  /** 頂點法線（commit 時由網格差分算出） */
  private readonly nrm: Float32Array;
  /** 每圈的頂點數（seg + 1） */
  private readonly cols: number;
  /** 前端極點的頂點索引 */
  private readonly startPole: number;
  /** 後端極點的頂點索引 */
  private readonly endPole: number;

  /**
   * @param rings 圈數
   * @param seg 每圈的分段數
   * @param vOf 第 i 圈的貼圖 v 座標
   */
  constructor(
    readonly rings: number,
    readonly seg: number,
    vOf: (i: number) => number,
  ) {
    this.cols = seg + 1;
    this.startPole = rings * this.cols;
    this.endPole = this.startPole + 1;
    const count = this.endPole + 1;
    this.pos = new Float32Array(count * 3);
    this.nrm = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < rings; i++) {
      const v = vOf(i);
      for (let j = 0; j <= seg; j++) {
        const k = i * this.cols + j;
        uv[k * 2] = j / seg;
        uv[k * 2 + 1] = v;
      }
    }
    uv[this.startPole * 2] = 0.5;
    uv[this.startPole * 2 + 1] = vOf(0);
    uv[this.endPole * 2] = 0.5;
    uv[this.endPole * 2 + 1] = vOf(rings - 1);
    const index: number[] = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * this.cols + j;
        const b = a + this.cols;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const last = (rings - 1) * this.cols;
    for (let j = 0; j < seg; j++) {
      index.push(j, j + 1, this.startPole);
      index.push(last + j, this.endPole, last + j + 1);
    }
    this.geometry.setIndex(index);
    const posAttr = new THREE.BufferAttribute(this.pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const nrmAttr = new THREE.BufferAttribute(this.nrm, 3);
    nrmAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('normal', nrmAttr);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  /**
   * 寫入第 i 圈：截面點 (x, y) 放到 center + side·x + up·y。
   * @param profile 截面座標（交錯的 x, y，共 seg + 1 點，已經乘好寬高）
   */
  setRing(i: number, center: THREE.Vector3, side: THREE.Vector3, up: THREE.Vector3, profile: Float32Array): void {
    const base = i * this.cols * 3;
    for (let j = 0; j <= this.seg; j++) {
      const px = profile[j * 2];
      const py = profile[j * 2 + 1];
      const o = base + j * 3;
      this.pos[o] = center.x + side.x * px + up.x * py;
      this.pos[o + 1] = center.y + side.y * px + up.y * py;
      this.pos[o + 2] = center.z + side.z * px + up.z * py;
    }
  }

  /** 寫入前端（start，第 0 圈之前）或後端（end，最後一圈之後）的封口極點 */
  setPole(which: 'start' | 'end', p: THREE.Vector3): void {
    const o = (which === 'start' ? this.startPole : this.endPole) * 3;
    this.pos[o] = p.x;
    this.pos[o + 1] = p.y;
    this.pos[o + 2] = p.z;
  }

  /**
   * 一幀寫完：算法線並通知上傳 GPU。
   * 法線用網格的中央差分（沿身體方向 × 繞截面方向）直接算，只跑一次頂點迴圈，
   * 比 computeVertexNormals（逐三角形累加）快好幾倍；接縫處左右鄰點繞回去取，兩側法線自然一致。
   * 叉積順序和三角形繞序相同（切線 × 截面切向），所以法線朝外。
   */
  commit(): void {
    const P = this.pos;
    const N = this.nrm;
    const cols = this.cols;
    const seg = this.seg;
    const last = this.rings - 1;
    const sp = this.startPole * 3;
    const ep = this.endPole * 3;
    for (let i = 0; i <= last; i++) {
      const row = i * cols;
      for (let j = 0; j <= seg; j++) {
        const o = (row + j) * 3;
        // 沿身體方向的前後鄰點（頭尾那一圈改用極點）
        const a = i > 0 ? o - cols * 3 : sp;
        const b = i < last ? o + cols * 3 : ep;
        // 繞截面方向的左右鄰點（第 0 點與第 seg 點是同一個位置，繞回去取）
        const c = (row + (j > 0 ? j - 1 : seg - 1)) * 3;
        const d = (row + (j < seg ? j + 1 : 1)) * 3;
        const sx = P[b] - P[a];
        const sy = P[b + 1] - P[a + 1];
        const sz = P[b + 2] - P[a + 2];
        const ax = P[d] - P[c];
        const ay = P[d + 1] - P[c + 1];
        const az = P[d + 2] - P[c + 2];
        const nx = sy * az - sz * ay;
        const ny = sz * ax - sx * az;
        const nz = sx * ay - sy * ax;
        const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        N[o] = nx * inv;
        N[o + 1] = ny * inv;
        N[o + 2] = nz * inv;
      }
    }
    this.poleNormal(sp, 0);
    this.poleNormal(ep, last);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  /**
   * 極點的法線：從相鄰那一圈的中心指向極點（封口朝外）。
   * @param p 極點在陣列中的位置（頂點索引 × 3）
   * @param ring 相鄰的圈號
   */
  private poleNormal(p: number, ring: number): void {
    const P = this.pos;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < this.seg; j++) {
      const o = (ring * this.cols + j) * 3;
      cx += P[o];
      cy += P[o + 1];
      cz += P[o + 2];
    }
    const nx = P[p] - cx / this.seg;
    const ny = P[p + 1] - cy / this.seg;
    const nz = P[p + 2] - cz / this.seg;
    const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    this.nrm[p] = nx * inv;
    this.nrm[p + 1] = ny * inv;
    this.nrm[p + 2] = nz * inv;
  }
}

// ───────────────────────────── 佐助的大蛇 ─────────────────────────────

/** 大蛇的尺寸與動作參數（公尺、弧度） */
const SNAKE = {
  /** 身體最粗處的截面：半寬、中心到背、中心到腹（腹部比較扁，平貼地面） */
  halfW: 0.19,
  topH: 0.19,
  bellyH: 0.15,
  /** 錨點 z：從這裡往前是抬起的蛇頸（騎乘者站在蛇頸起點），往後是左右擺動的蛇身 */
  anchorZ: 0.3,
  /** 錨點往後的蛇身弧長（尾巴尖約在角色後方 3.5 m） */
  bodyLen: 3.8,
  /** 蛇頸的估計弧長（只用來排貼圖 v） */
  neckLen: 0.85,
  /** 蛇頸、蛇身的圈數與每圈分段數 */
  neckRings: 14,
  bodyRings: 60,
  seg: 16,
  /** S 形擺動的波長與最大擺角 */
  wavelength: 1.8,
  maxAngle: 0.9,
  /**
   * 頭的基準位置（頭的後緣、蛇頸接進去的點；頭中心再往前約 0.25 m）。
   * 偏向騎乘者面向的一側（−x）：遊戲鏡頭在正後方，頭擺在正中間會被騎乘者的腿整個擋住。
   */
  head: new THREE.Vector3(-0.38, 0.53, -0.36),
  /** 頭往左（−x）轉的基準角度：和蛇頸往左彎的方向一致，也和騎乘者面向的方向一致 */
  headYaw: 0.34,
  /** 頭部放大倍率（Q 版比例，頭大一點遠看才認得出來） */
  headScale: 1.18,
  /** 背上斑紋一個循環的長度（貼圖 v 方向） */
  patternLen: 0.8,
};

/** 大蛇的配色 */
const SNAKE_COLORS = {
  /** 紫色鱗片 */
  skin: 0x7d50ae,
  /** 側腹的淺紫 */
  light: 0xa37fcc,
  /** 淡黃色腹部 */
  belly: 0xf2dc98,
  /** 腹鱗的分隔線 */
  scute: 0xc9ac62,
  /** 背上的黑斑 */
  mark: 0x1d1028,
  /** 黑斑中心透出的深紫 */
  markInner: 0x5e3489,
  /** 眉骨 */
  brow: 0x3b2156,
  /** 黃眼 */
  eye: 0xf6c51b,
  /** 瞳孔、鼻孔 */
  pupil: 0x120a14,
};

/**
 * 大蛇的身體貼圖（256×512）：u 繞身體一圈（0 與 1＝腹部正中、0.5＝背脊），v 沿身體、一張是一個斑紋循環。
 * 淡黃腹部（橫向腹鱗）→ 淺紫側腹 → 紫色背部（細菱格鱗片）；背脊一串黑色大菱形，菱形之間左右各一塊黑斑，側面斜斜的細長黑斑。
 */
function snakeSkinTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  // 底色：橫向漸層（腹部 → 側腹 → 背部 → 側腹 → 腹部）
  const grad = g.createLinearGradient(0, 0, W, 0);
  const stops: [number, number][] = [
    [0, SNAKE_COLORS.belly],
    [0.15, SNAKE_COLORS.belly],
    [0.22, SNAKE_COLORS.light],
    [0.32, SNAKE_COLORS.skin],
    [0.68, SNAKE_COLORS.skin],
    [0.78, SNAKE_COLORS.light],
    [0.85, SNAKE_COLORS.belly],
    [1, SNAKE_COLORS.belly],
  ];
  for (const [at, col] of stops) grad.addColorStop(at, css(col));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 腹鱗：橫向分隔線（一個循環 12 片，上下無縫）
  g.strokeStyle = css(SNAKE_COLORS.scute);
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const y = (i * H) / 12;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W * 0.17, y);
    g.moveTo(W * 0.83, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // 細鱗：側面與背上錯位排列的小菱格（16 欄 × 24 列，左右上下都無縫）
  g.strokeStyle = 'rgba(40, 14, 72, 0.22)';
  g.lineWidth = 1.5;
  const sx = W / 16;
  const sy = H / 24;
  for (let row = 0; row <= 24; row++) {
    for (let col = 0; col <= 16; col++) {
      const cx = col * sx + (row % 2) * (sx / 2);
      const cy = row * sy;
      if (cx < W * 0.19 || cx > W * 0.81) continue;
      g.beginPath();
      g.moveTo(cx, cy - sy / 2);
      g.lineTo(cx + sx / 2, cy);
      g.lineTo(cx, cy + sy / 2);
      g.lineTo(cx - sx / 2, cy);
      g.closePath();
      g.stroke();
    }
  }
  /** 畫一個菱形 */
  const diamond = (cx: number, cy: number, rx: number, ry: number, fill: string): void => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(cx, cy - ry);
    g.lineTo(cx + rx, cy);
    g.lineTo(cx, cy + ry);
    g.lineTo(cx - rx, cy);
    g.closePath();
    g.fill();
  };
  /** 畫一個橢圓斑（rot：旋轉角） */
  const blot = (cx: number, cy: number, rx: number, ry: number, rot = 0): void => {
    g.fillStyle = css(SNAKE_COLORS.mark);
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    g.fill();
  };
  // 背脊的大菱形（中心透出深紫，像蟒蛇的鞍紋）
  diamond(W / 2, H * 0.25, 36, 118, css(SNAKE_COLORS.mark));
  diamond(W / 2, H * 0.25, 14, 58, css(SNAKE_COLORS.markInner));
  for (const s of [-1, 1]) {
    // 菱形之間、背脊兩側的黑斑
    blot(W / 2 + s * 27, H * 0.75, 12, 46);
    // 側面往下斜的細長黑斑（跨上下邊界的要畫兩次才會無縫）
    blot(W / 2 + s * 64, H * 0.5, 5, 26, s * 0.45);
    blot(W / 2 + s * 60, 0, 5, 20, -s * 0.45);
    blot(W / 2 + s * 60, H, 5, 20, -s * 0.45);
  }
  return canvasTexture(c, true);
}

/** 大蛇的材質（第一次用到時建立，之後共用） */
let snakeMatCache: {
  body: THREE.MeshStandardMaterial;
  parts: THREE.MeshStandardMaterial;
  tongue: THREE.MeshStandardMaterial;
} | null = null;

/** 取得大蛇的材質：身體（斑紋貼圖）、頭部部件（頂點色）、蛇信 */
function snakeMaterials(): NonNullable<typeof snakeMatCache> {
  if (!snakeMatCache) {
    snakeMatCache = {
      body: stdMat({ map: snakeSkinTexture(), roughness: 0.42, envMapIntensity: 0.9 }),
      parts: stdMat({ color: 0xffffff, vertexColors: true, roughness: 0.4, envMapIntensity: 0.9 }),
      tongue: stdMat({ color: 0xd8385a, roughness: 0.35 }),
    };
  }
  return snakeMatCache;
}

/**
 * 大蛇的頭（局部座標：原點在頭的後緣、蛇頸接進去的地方，吻端朝 −z）。
 * 長約 0.5 m、寬約 0.33 m：紫色頭殼、淡黃下顎、黃色大眼（豎瞳）、兇狠的深紫眉骨、頭頂與眼後的黑斑。
 * @returns main＝要描邊的主體；details＝豎瞳、鼻孔、眼睛反光（太小，描邊會糊成黑點，所以分開、不描邊）
 */
function buildSnakeHead(): { main: THREE.BufferGeometry; details: THREE.BufferGeometry } {
  const main: THREE.BufferGeometry[] = [];
  const details: THREE.BufferGeometry[] = [];
  // 頭殼：後腦寬（下顎肌肉）、往吻端收窄，頂部扁平
  main.push(
    painted(
      sculpt(new THREE.SphereGeometry(1, 22, 14), (p) => {
        const fr = (1 - p.z) / 2; // 0＝後腦、1＝吻端
        p.x *= 0.165 * (1 - 0.34 * Math.pow(fr, 1.4));
        p.y = p.y * (p.y > 0 ? 0.115 : 0.06) * (1 - 0.3 * fr) + 0.02;
        p.z = p.z * 0.25 - 0.22;
      }),
      SNAKE_COLORS.skin,
    ),
  );
  // 下顎：淡黃色，比頭殼窄一點、短一點，從下方露出來（和頭殼的交界就是嘴線）
  main.push(
    painted(
      sculpt(new THREE.SphereGeometry(1, 20, 12), (p) => {
        const fr = (1 - p.z) / 2;
        p.x *= 0.15 * (1 - 0.4 * Math.pow(fr, 1.4));
        p.y = p.y * (p.y > 0 ? 0.03 : 0.075) - 0.03;
        p.z = p.z * 0.235 - 0.2;
      }),
      SNAKE_COLORS.belly,
    ),
  );
  // 頭頂的黑色菱斑
  main.push(painted(new THREE.SphereGeometry(1, 10, 6), SNAKE_COLORS.mark, trs([0, 0.112, -0.15], [0, 0, 0], [0.055, 0.013, 0.085])));
  for (const side of [-1, 1]) {
    const eye = new THREE.Vector3(side * 0.118, 0.058, -0.3);
    // 眼球：側上方半顆凸出頭殼
    main.push(painted(new THREE.SphereGeometry(0.047, 14, 10), SNAKE_COLORS.eye, trs([eye.x, eye.y, eye.z])));
    // 眉骨：眼睛上方斜斜的骨脊（內側低、外側高，看起來兇），順著頭形往吻端內收
    main.push(
      painted(
        new THREE.SphereGeometry(1, 10, 6),
        SNAKE_COLORS.brow,
        trs([side * 0.1, 0.106, -0.29], [0, -side * 0.35, side * 0.38], [0.068, 0.02, 0.036], 'YXZ'),
      ),
    );
    // 眼後的黑色條紋（從眼睛往後下方延伸）
    main.push(
      painted(new THREE.SphereGeometry(1, 8, 6), SNAKE_COLORS.mark, trs([side * 0.14, 0.022, -0.17], [0.3, 0, 0], [0.013, 0.02, 0.075])),
    );
    // 豎瞳：貼在眼球朝外前方的表面，細長的黑色橢圓
    const dir = new THREE.Vector3(side * 0.78, 0.18, -0.6).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    details.push(
      painted(
        new THREE.SphereGeometry(1, 8, 6),
        SNAKE_COLORS.pupil,
        new THREE.Matrix4().compose(eye.clone().addScaledVector(dir, 0.04), q, new THREE.Vector3(0.011, 0.034, 0.012)),
      ),
    );
    // 眼睛的反光點（前上方）
    const hl = eye.clone().addScaledVector(new THREE.Vector3(dir.x * 0.6, 0.6, dir.z * 0.6 - 0.15).normalize(), 0.045);
    details.push(painted(new THREE.SphereGeometry(0.009, 6, 4), 0xffffff, trs([hl.x, hl.y, hl.z])));
    // 鼻孔
    details.push(painted(new THREE.SphereGeometry(1, 6, 4), SNAKE_COLORS.pupil, trs([side * 0.038, 0.047, -0.452], [0, 0, 0], [0.012, 0.007, 0.01])));
  }
  return { main: mergeParts(main, '大蛇頭部'), details: mergeParts(details, '大蛇頭部細節') };
}

/** 蛇信（局部座標：根部在原點、往 −z 伸出）：扁長的舌身＋分岔的舌尖 */
function buildTongue(): THREE.BufferGeometry {
  const stem = new THREE.CapsuleGeometry(0.015, 0.14, 3, 8);
  stem.applyMatrix4(trs([0, 0, -0.08], [-Math.PI / 2, 0, 0], [1, 1, 0.45]));
  const parts: THREE.BufferGeometry[] = [stem];
  for (const side of [-1, 1]) {
    const prong = new THREE.CapsuleGeometry(0.009, 0.06, 3, 6);
    // 先轉成沿 −z，再往左右張開（根部接在舌身前端 z = −0.15）
    prong.applyMatrix4(trs([side * 0.0145, 0, -0.188], [-Math.PI / 2, -side * 0.38, 0], [1, 1, 0.5], 'YXZ'));
    parts.push(prong);
  }
  return mergeParts(parts, '蛇信');
}

/**
 * 蛇身的粗細倍率（相對最粗處）：中段略粗，從 1.1 m 開始往尾巴漸細到很尖。
 * @param s 錨點往後的弧長
 */
function snakeThickness(s: number): number {
  const bulge = 1 + 0.05 * Math.sin(Math.min(1, s / 1.6) * Math.PI);
  const t = Math.max(0, (s - 1.1) / (SNAKE.bodyLen - 1.1));
  return bulge * (1 - 0.94 * Math.pow(t, 1.2));
}

/**
 * 佐助的大蛇：紫色大蛇、背上黑色斑紋、淡黃肚子。角色站在蛇頸後方（蛇身平貼地面處），
 * 蛇頸從角色腳下往前抬起，蛇頭在角色前方約 0.6 m、離地約 0.4 m（黃眼豎瞳、會吐蛇信），
 * 蛇身往後拖約 3.5 m、左右 S 形擺動（擺動頻率隨跑速提高），尾巴漸細。
 */
export function buildSnakeMount(): MountRig {
  const mats = snakeMaterials();
  const root = new THREE.Group();
  root.name = 'mount-snake';

  const NR = SNAKE.neckRings;
  const R = NR + SNAKE.bodyRings;
  const SEG = SNAKE.seg;
  /** 蛇身每圈之間的弧長 */
  const ds = SNAKE.bodyLen / (SNAKE.bodyRings - 1);
  /** 第 i 圈的弧長位置（錨點為 0、蛇頸為負），用來排貼圖 v */
  const arcOf = (i: number): number => (i < NR ? -SNAKE.neckLen * (1 - i / NR) : (i - NR) * ds);

  // 身體：放樣網格（第 0 圈在頭裡，往後依序是蛇頸、錨點、蛇身、尾巴尖）
  const loft = new Loft(R, SEG, (i) => arcOf(i) / SNAKE.patternLen);
  const body = new THREE.Mesh(loft.geometry, mats.body);
  body.name = 'snake-body';
  body.castShadow = true;
  addOutline(body, 0.008, true);
  root.add(body);

  // 頭：頂點色合併的主體（描邊、投影）＋細節（不描邊）＋蛇信
  const headGeo = buildSnakeHead();
  const head = new THREE.Group();
  head.name = 'snake-head';
  head.rotation.order = 'YXZ';
  head.scale.setScalar(SNAKE.headScale);
  const headMesh = new THREE.Mesh(headGeo.main, mats.parts);
  headMesh.castShadow = true;
  addOutline(headMesh, 0.007);
  head.add(headMesh);
  head.add(new THREE.Mesh(headGeo.details, mats.parts));
  const tongue = new THREE.Mesh(buildTongue(), mats.tongue);
  tongue.position.set(0, -0.03, -0.43);
  head.add(tongue);
  root.add(head);

  // ── 每幀共用的暫存（避免每幀配置記憶體） ──
  /** 每圈的中心點 */
  const centers = Array.from({ length: R }, () => new THREE.Vector3());
  /** 每圈的粗細倍率 */
  const thick = new Float32Array(R);
  /** 一圈的截面座標（交錯 x, y） */
  const profile = new Float32Array((SEG + 1) * 2);
  /** 單位截面：從腹部正中開始，往 +x 側、背部、−x 側繞一圈 */
  const cosA = new Float32Array(SEG + 1);
  const sinA = new Float32Array(SEG + 1);
  for (let j = 0; j <= SEG; j++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * j) / SEG;
    cosA[j] = Math.cos(a);
    sinA[j] = Math.sin(a);
  }
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  /** 頭的朝向（吻端方向） */
  const fwd = new THREE.Vector3();
  /** 蛇頸貝茲曲線的控制點：p0 錨點（貼地）、p1 往前平伸、p2／p3 沿頭的方向接進頭裡 */
  const p0 = new THREE.Vector3(0, SNAKE.bellyH, SNAKE.anchorZ);
  const p1 = new THREE.Vector3(0, SNAKE.bellyH, SNAKE.anchorZ - 0.34);
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const pole = new THREE.Vector3();

  /** 騎乘者腳底的位置：蛇頸起點（還貼著地面）的背上 */
  const seat = new THREE.Vector3(0, SNAKE.bellyH + SNAKE.topH, 0);
  /** S 形擺動的相位（弧度，隨跑速加快） */
  let phase = 0;
  /** 累積秒數（吐信用） */
  let time = 0;

  const update = (dt: number, speed: number): void => {
    phase += dt * Math.PI * 2 * (0.8 + speed * 0.045);
    time += dt;

    // 1) 頭：跟著擺動左右輕晃、轉向晃動的方向，微微上下點頭
    const sway = Math.sin(phase + 1.2);
    head.position.set(SNAKE.head.x + 0.06 * sway, SNAKE.head.y + 0.012 * Math.sin(phase * 2 + 0.5), SNAKE.head.z);
    head.rotation.set(-0.1 + 0.03 * Math.sin(phase * 2), SNAKE.headYaw - 0.16 * Math.cos(phase + 1.2), 0);
    fwd.set(0, 0, -1).applyQuaternion(head.quaternion);

    // 2) 蛇頸：三次貝茲曲線，從錨點（貼地、朝前）平順地抬到頭後緣，沿頭的方向伸進頭裡
    p3.copy(head.position).addScaledVector(fwd, 0.11);
    p2.copy(p3).addScaledVector(fwd, -0.3);
    for (let i = 0; i < NR; i++) {
      const u = 1 - i / NR; // 1＝頭端、接近 0＝錨點
      bezier(p0, p1, p2, p3, u, centers[i]);
      thick[i] = mix(1, 0.6, smooth(0.25, 1, u));
    }

    // 3) 蛇身：從錨點往後依擺角積分（每段弧長固定，身體不會被拉長）；
    //    擺幅從錨點往後漸大（騎乘者腳下穩定），波往尾巴傳（蛇往前滑的樣子）
    const k = (Math.PI * 2) / SNAKE.wavelength;
    let x = 0;
    let z = SNAKE.anchorZ;
    for (let b = 0; b < SNAKE.bodyRings; b++) {
      const s = b * ds;
      const th = snakeThickness(s);
      thick[NR + b] = th;
      centers[NR + b].set(x, SNAKE.bellyH * th, z);
      const mid = s + ds / 2; // 這一段中點的擺角
      const ang = SNAKE.maxAngle * smooth(0, 0.55, mid) * Math.sin(k * mid - phase);
      x += Math.sin(ang) * ds;
      z += Math.cos(ang) * ds;
    }

    // 4) 寫入每一圈：截面座標系由切線決定，腹部比背部扁
    for (let i = 0; i < R; i++) {
      tangent.subVectors(centers[Math.min(R - 1, i + 1)], centers[Math.max(0, i - 1)]).normalize();
      frameFrom(tangent, side, up);
      const th = thick[i];
      for (let j = 0; j <= SEG; j++) {
        profile[j * 2] = cosA[j] * SNAKE.halfW * th;
        profile[j * 2 + 1] = sinA[j] * (sinA[j] > 0 ? SNAKE.topH : SNAKE.bellyH) * th;
      }
      loft.setRing(i, centers[i], side, up, profile);
    }
    // 封口：前端藏在頭裡；尾端拉出一個尖
    tangent.subVectors(centers[1], centers[0]).normalize();
    loft.setPole('start', pole.copy(centers[0]).addScaledVector(tangent, -0.03));
    tangent.subVectors(centers[R - 1], centers[R - 2]).normalize();
    loft.setPole('end', pole.copy(centers[R - 1]).addScaledVector(tangent, 0.04));
    loft.commit();

    // 5) 吐信：每 1.6 秒快速伸出、抖動、縮回
    const tau = ((time + 1.44) / 1.6) % 1;
    const ext = smooth(0, 0.07, tau) * (1 - smooth(0.24, 0.33, tau));
    tongue.visible = ext > 0.02;
    tongue.scale.set(1, 1, Math.max(0.02, ext));
    tongue.rotation.x = -0.12 + 0.22 * Math.sin(time * 38) * ext;
  };

  update(0, 16);
  loft.geometry.computeBoundingSphere();
  return { root, seat, pose: 'surf', update };
}

// ───────────────────────────── 小櫻的蛞蝓 ─────────────────────────────

/** 蛞蝓的尺寸與動作參數（公尺） */
const SLUG = {
  /** 頭的最前端 z 與身長（尾巴尖在 frontZ + length） */
  frontZ: -0.66,
  length: 1.6,
  /** 最寬處的半寬、背最高處的高度（騎乘者腳下）：扁長的身體，身長約是寬的 3 倍 */
  halfW: 0.28,
  height: 0.4,
  /** 圈數 */
  rings: 46,
  /** 伸縮波：波長、伸縮幅度（局部伸長率 1 ± stretch） */
  wavelength: 0.75,
  stretch: 0.09,
  /** 錨點 z：騎乘者踩著的那一點（z 固定不動，伸縮從這裡往前後傳） */
  anchorZ: 0.2,
  /** 眼柄長在身長的哪裡（t：0＝頭的最前端、1＝尾巴尖） */
  stalkT: 0.1,
};

/**
 * 蛞蝓截面的右半邊（單位寬高，從腹部正中往外、往上繞到背脊）：
 * 扁平的腹足、往外翻的裙邊與上方一道淺溝、圓頂的背。左半邊鏡像。
 */
const SLUG_HALF: [number, number][] = [
  [0, 0],
  [0.45, 0],
  [0.82, 0],
  [0.98, 0.012],
  [1.06, 0.04],
  [1.05, 0.075],
  [0.97, 0.1],
  [0.985, 0.16],
  [0.95, 0.3],
  [0.87, 0.46],
  [0.75, 0.62],
  [0.59, 0.77],
  [0.4, 0.89],
  [0.2, 0.97],
  [0, 1],
];

/** 蛞蝓的配色 */
const SLUG_COLORS = {
  /** 白中帶一點藍的身體 */
  body: 0xf3f7fc,
  /** 腹足（偏藍灰，看起來半透明） */
  sole: 0xc3d3e7,
  /** 裙邊 */
  skirt: 0xdde7f2,
  /** 裙邊上方的淺溝 */
  groove: 0xb3c5dc,
  /** 背上的藍色條紋 */
  stripe: 0x3e66c4,
  stripeEdge: 0x2b4c9c,
  /** 眼珠、嘴 */
  eye: 0x1b2236,
};

/**
 * 蛞蝓的平面輪廓：回傳半寬。頭端圓、中段最寬、往尾巴圓滑地收成尖（不是直線收，從後面看才像一團軟軟的身體）。
 * @param t 身長位置（0＝頭的最前端、1＝尾巴尖）
 */
function slugWidth(t: number): number {
  const front = t < 0.15 ? Math.sqrt(Math.max(0, 1 - ((0.15 - t) / 0.15) ** 2)) : 1;
  const grow = 0.82 + 0.18 * smooth(0.05, 0.42, t);
  const u = Math.max(0, (t - 0.58) / 0.42);
  const tail = Math.pow(Math.cos((Math.min(1, u) * Math.PI) / 2), 0.65);
  return SLUG.halfW * front * grow * tail;
}

/**
 * 蛞蝓的側面輪廓：回傳背的高度。頭比較低、圓；騎乘者腳下（t 約 0.45～0.66）最高且平；尾巴圓滑地往下收尖。
 * @param t 身長位置（0＝頭的最前端、1＝尾巴尖）
 */
function slugHeight(t: number): number {
  const front = t < 0.18 ? Math.sqrt(Math.max(0, 1 - ((0.18 - t) / 0.18) ** 2)) : 1;
  const rise = 0.78 + 0.22 * smooth(0.06, 0.45, t);
  const u = Math.max(0, (t - 0.66) / 0.34);
  const tail = Math.max(0.06, Math.pow(Math.cos((Math.min(1, u) * Math.PI) / 2), 0.75));
  return SLUG.height * front * rise * tail;
}

/**
 * 蛞蝓的身體貼圖（256×512，不重複）：u 繞身體一圈（0 與 1＝腹足正中、0.5＝背脊），v 從頭（0）到尾（1）。
 * 白中帶藍的身體、偏藍灰的腹足與裙邊（看起來半透明）、背上兩條藍色條紋（從眼柄根部一路到尾巴）、淡淡的斑點與皺紋。
 * u 的位置對應 SLUG_HALF 的頂點：每點佔 1/28，裙邊在第 4～5 點、淺溝在第 6 點、背脊在第 14 點。
 */
function slugSkinTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const seg = (SLUG_HALF.length - 1) * 2;
  const uOf = (j: number) => j / seg;
  // 底色：橫向漸層（腹足 → 裙邊 → 淺溝 → 白色身體 → 鏡像回來）
  const grad = g.createLinearGradient(0, 0, W, 0);
  const half: [number, number][] = [
    [0, SLUG_COLORS.sole],
    [uOf(3), SLUG_COLORS.sole],
    [uOf(4.5), SLUG_COLORS.skirt],
    [uOf(6), SLUG_COLORS.groove],
    [uOf(7.2), SLUG_COLORS.skirt],
    [uOf(9.5), SLUG_COLORS.body],
  ];
  for (const [at, col] of half) grad.addColorStop(at, css(col));
  for (const [at, col] of [...half].reverse()) grad.addColorStop(1 - at, css(col));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 淡淡的斑點與斜向皺紋（黏滑的皮膚質感），只在側面與背上
  const rnd = seeded(4242);
  for (let i = 0; i < 40; i++) {
    const s = rnd() < 0.5 ? -1 : 1;
    const u = 0.5 + s * (0.04 + rnd() * 0.24);
    const v = 0.06 + rnd() * 0.9;
    g.fillStyle = `rgba(165, 186, 214, ${0.05 + rnd() * 0.06})`;
    g.beginPath();
    g.ellipse(u * W, v * H, 3 + rnd() * 7, 4 + rnd() * 9, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(150, 172, 204, 0.18)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 50; i++) {
    const s = rnd() < 0.5 ? -1 : 1;
    const u = 0.5 + s * (0.1 + rnd() * 0.2);
    const v = 0.1 + rnd() * 0.85;
    g.beginPath();
    g.moveTo(u * W, v * H);
    g.lineTo((u + s * 0.04) * W, (v + 0.025) * H);
    g.stroke();
  }
  // 背上的兩條藍色條紋：從眼柄根部（v 約 0.09、截面 x 約 0.45 倍半寬處）一路到尾巴，兩端收細
  const v0 = 0.085;
  const v1 = 0.985;
  for (const s of [-1, 1]) {
    const uc = 0.5 + s * 0.08;
    const steps = 48;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const v = v0 + ((v1 - v0) * i) / steps;
      const hw = 0.026 * (0.35 + 0.65 * smooth(v0, v0 + 0.08, v)) * (1 - 0.55 * smooth(0.65, 1, v));
      left.push([(uc - hw) * W, v * H]);
      right.push([(uc + hw) * W, v * H]);
    }
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const [px, py] of left) g.lineTo(px, py);
    for (const [px, py] of right.reverse()) g.lineTo(px, py);
    g.closePath();
    g.fillStyle = css(SLUG_COLORS.stripe);
    g.fill();
    g.strokeStyle = css(SLUG_COLORS.stripeEdge);
    g.lineWidth = 2;
    g.stroke();
  }
  return canvasTexture(c, false);
}

/**
 * 蛞蝓皮膚的凹凸貼圖（256×512，和顏色貼圖同一組 uv）：一顆顆細小的疣粒，中間是細溝，
 * 讓身體看起來是軟軟濕濕的皮膚，不像光滑的塑膠。
 */
function slugBumpTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#5a5a5a';
  g.fillRect(0, 0, W, H);
  const rnd = seeded(9137);
  g.filter = 'blur(1.2px)';
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const v = 150 + Math.floor(rnd() * 70);
    g.fillStyle = `rgb(${v}, ${v}, ${v})`;
    g.beginPath();
    g.ellipse(x, y, 2.5 + rnd() * 2.5, 3.5 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  return t;
}

/**
 * 半透明感（不真的透明）：在自發光加上偏藍的菲涅耳邊緣光，輪廓邊緣像果凍一樣透亮。
 * 只改片段著色器的 emissivemap_fragment 之後（此時 normal 與 vViewPosition 都已經有了）。
 */
function addJellyRim(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        'float jellyRim = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );',
        'totalEmissiveRadiance += vec3( 0.36, 0.52, 0.78 ) * ( pow( jellyRim, 2.5 ) * 0.55 );',
      ].join('\n'),
    );
  };
  mat.customProgramCacheKey = () => 'slug-jelly-rim';
}

/** 蛞蝓的材質（第一次用到時建立，之後共用） */
let slugMatCache: { body: THREE.MeshStandardMaterial; parts: THREE.MeshStandardMaterial } | null = null;

/**
 * 取得蛞蝓的材質：身體（條紋貼圖＋疣粒凹凸）、眼柄與臉（頂點色）。
 * 粗糙度低（濕滑的反光），加一點偏藍的自發光（陰影面不會太暗）與邊緣光，看起來有半透明感。
 */
function slugMaterials(): NonNullable<typeof slugMatCache> {
  if (!slugMatCache) {
    const body = stdMat({
      map: slugSkinTexture(),
      bumpMap: slugBumpTexture(),
      bumpScale: 1.2,
      roughness: 0.3,
      envMapIntensity: 1.1,
      emissive: 0x1e2a38,
    });
    const parts = stdMat({ color: 0xffffff, vertexColors: true, roughness: 0.3, envMapIntensity: 1.1, emissive: 0x1e2a38 });
    addJellyRim(body);
    addJellyRim(parts);
    slugMatCache = { body, parts };
  }
  return slugMatCache;
}

/**
 * 蛞蝓的眼柄（局部座標：根部在原點、往 +y 長，頂端往前（−z）彎）：下粗上細的柄＋頂端的黑眼珠與反光。
 */
function buildStalk(): THREE.BufferGeometry {
  /** 柄長 */
  const len = 0.5;
  /** 頂端往前彎的距離 */
  const bend = 0.11;
  const pts = [
    [0, -0.03],
    [0.054, -0.03],
    [0.051, 0.06],
    [0.043, 0.18],
    [0.034, 0.31],
    [0.029, 0.42],
    [0.027, len],
    [0, len + 0.006],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const stalk = sculpt(new THREE.LatheGeometry(pts, 10), (p) => {
    p.z -= bend * Math.pow(Math.max(0, p.y) / len, 2);
  });
  const parts = [painted(stalk, SLUG_COLORS.body)];
  const tip = new THREE.Vector3(0, len + 0.022, -bend);
  parts.push(painted(new THREE.SphereGeometry(0.07, 12, 8), SLUG_COLORS.eye, trs([tip.x, tip.y, tip.z])));
  parts.push(painted(new THREE.SphereGeometry(0.018, 6, 4), 0xffffff, trs([0.019, tip.y + 0.037, tip.z - 0.048])));
  return mergeParts(parts, '蛞蝓眼柄');
}

/**
 * 蛞蝓的臉（局部座標：原點在頭的最前端、貼地）：一對往前伸的短下觸角、小小的 ∪ 形嘴。
 */
function buildSlugFace(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // 下觸角：圓錐的尖端朝前、朝外、略朝下
    const dir = new THREE.Vector3(side * 0.5, -0.25, -1).normalize();
    const base = new THREE.Vector3(side * 0.06, 0.1, 0.035);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    parts.push(
      painted(
        new THREE.ConeGeometry(0.02, 0.075, 8, 1),
        SLUG_COLORS.body,
        new THREE.Matrix4().compose(base.clone().addScaledVector(dir, 0.0375), q, new THREE.Vector3(1, 1, 1)),
      ),
    );
  }
  // 嘴：半圈圓環轉成 ∪ 形，再往後仰貼在斜斜的臉上
  parts.push(painted(new THREE.TorusGeometry(0.032, 0.0065, 5, 10, Math.PI), SLUG_COLORS.eye, trs([0, 0.06, 0.004], [0.5, 0, Math.PI])));
  return mergeParts(parts, '蛞蝓的臉');
}

/**
 * 小櫻的蛞蝓：白色、背上兩條藍色條紋的大蛞蝓，扁長、底部平，身長 1.5 m、背高 0.4 m；
 * 頭上一對眼柄（末端黑眼珠，微微擺動）。往前滑行時身體做沿身體往前傳的伸縮波（伸長處變細、壓縮處變粗），
 * 角色站在背上，腳下高度跟著波起伏。
 */
export function buildSlugMount(): MountRig {
  const mats = slugMaterials();
  const root = new THREE.Group();
  root.name = 'mount-slug';

  const R = SLUG.rings;
  const SEG = (SLUG_HALF.length - 1) * 2;
  /** 每圈的身長位置 t：兩端排密一點，圓頭與尖尾才平滑 */
  const ts = new Float32Array(R);
  for (let i = 0; i < R; i++) ts[i] = 0.0015 + 0.9955 * (0.5 - 0.5 * Math.cos((Math.PI * i) / (R - 1)));

  // 身體：放樣網格（第 0 圈在頭的最前端，往後到尾巴尖）
  const loft = new Loft(R, SEG, (i) => ts[i]);
  const body = new THREE.Mesh(loft.geometry, mats.body);
  body.name = 'slug-body';
  body.castShadow = true;
  addOutline(body, 0.008, true);
  root.add(body);

  // 眼柄：左右各一（群組的原點在柄的根部，每幀跟著頭的位置與高度擺）
  const stalkGeo = buildStalk();
  const stalks = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.name = s < 0 ? 'slug-stalk-l' : 'slug-stalk-r';
    const m = new THREE.Mesh(stalkGeo, mats.parts);
    addOutline(m, 0.006);
    g.add(m);
    root.add(g);
    return { group: g, side: s };
  });
  // 臉：原點在頭的最前端
  const face = new THREE.Group();
  face.name = 'slug-face';
  const faceMesh = new THREE.Mesh(buildSlugFace(), mats.parts);
  addOutline(faceMesh, 0.005);
  face.add(faceMesh);
  root.add(face);

  // ── 每幀共用的暫存 ──
  /** 單位截面（整圈，交錯的 x, y）：右半邊照 SLUG_HALF、左半邊鏡像 */
  const unit = new Float32Array((SEG + 1) * 2);
  for (let j = 0; j <= SEG; j++) {
    const mirrored = j >= SLUG_HALF.length;
    const [x, y] = SLUG_HALF[mirrored ? SEG - j : j];
    unit[j * 2] = mirrored ? -x : x;
    unit[j * 2 + 1] = y;
  }
  const profile = new Float32Array((SEG + 1) * 2);
  /** 蛞蝓沿 +z 直直排，每圈的截面座標系都一樣 */
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  frameFrom(new THREE.Vector3(0, 0, 1), side, up);
  const center = new THREE.Vector3();
  const pole = new THREE.Vector3();

  const L = SLUG.length;
  /** 伸縮波的波數 */
  const k = (Math.PI * 2) / SLUG.wavelength;
  const b = SLUG.stretch;
  /** 錨點的弧長位置與身長位置 */
  const sA = SLUG.anchorZ - SLUG.frontZ;
  const tA = sA / L;

  /** 騎乘者腳底的位置（高度跟著背的起伏） */
  const seat = new THREE.Vector3(0, SLUG.height, 0);
  /** 伸縮波的相位（弧度，隨跑速加快） */
  let phase = 0;
  /** 累積秒數（眼柄擺動用） */
  let time = 0;

  /** 弧長 s 處的局部伸長率（> 1 拉長變細、< 1 壓縮變粗）；波往頭的方向傳 */
  const stretchAt = (s: number): number => 1 + b * Math.sin(k * s + phase);
  /** 弧長 s 處現在的 z：從錨點對伸長率積分（錨點不動） */
  const zAt = (s: number): number => SLUG.anchorZ + (s - sA) - (b / k) * (Math.cos(k * s + phase) - Math.cos(k * sA + phase));

  const update = (dt: number, speed: number): void => {
    phase += dt * Math.PI * 2 * (1.0 + speed * 0.05);
    time += dt;

    // 1) 身體：每圈依伸長率移動 z，截面依體積守恆縮放（高度變化比寬度明顯，側面看得出起伏）
    for (let i = 0; i < R; i++) {
      const s = ts[i] * L;
      const e = stretchAt(s);
      const w = slugWidth(ts[i]) * Math.pow(e, -0.35);
      const h = slugHeight(ts[i]) * Math.pow(e, -0.65);
      center.set(0, 0, zAt(s));
      for (let j = 0; j <= SEG; j++) {
        profile[j * 2] = unit[j * 2] * w;
        profile[j * 2 + 1] = unit[j * 2 + 1] * h;
      }
      loft.setRing(i, center, side, up, profile);
      if (i === 0) loft.setPole('start', pole.set(0, h * 0.45, center.z - 0.006));
      if (i === R - 1) loft.setPole('end', pole.set(0, h * 0.4, center.z + 0.006));
    }
    loft.commit();

    // 2) 騎乘者：踩在錨點的背上（略低於背脊最高點，因為腳踩在背脊旁邊一點）
    seat.y = slugHeight(tA) * Math.pow(stretchAt(sA), -0.65) * 0.98;

    // 3) 眼柄：根部跟著頭頂，往前、往外張成 V 字（從正後方看，眼柄要從騎乘者的腿兩側露出來），微微擺動
    const sS = SLUG.stalkT * L;
    const eS = stretchAt(sS);
    const hS = slugHeight(SLUG.stalkT) * Math.pow(eS, -0.65);
    const wS = slugWidth(SLUG.stalkT) * Math.pow(eS, -0.35);
    const zS = zAt(sS);
    for (const { group, side: s } of stalks) {
      group.position.set(s * 0.45 * wS, 0.82 * hS, zS);
      group.rotation.set(-0.26 + 0.07 * Math.sin(time * 1.9 + s), 0, -s * 0.55 + 0.08 * Math.sin(time * 1.4 + s * 1.7));
    }

    // 4) 臉：跟著頭的最前端，高度隨伸縮
    face.position.set(0, 0, zAt(0));
    face.scale.set(1, Math.pow(stretchAt(0), -0.65), 1);
  };

  update(0, 16);
  loft.geometry.computeBoundingSphere();
  return { root, seat, pose: 'surf', update };
}
