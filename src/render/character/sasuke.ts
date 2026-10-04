import * as THREE from 'three';
import { DIMS, type HumanoidRig } from './rig';
import { buildHumanoidHD, finalizeRig } from './hdBody';
import { addHead3D, facePoint } from './face3d';
import { addHeadbandHD, NINJA_COLORS } from './ninja';
import { fabricMat, skinMat, rubberMat } from './charMats';
import { shapeHead, latheBody, taperedLimb, ringBand } from './shapes';
import { stdMat } from '../materials';

/**
 * 佐助（Q 版，高精細版）：參考 docs/concept/sasuke-sheet.jpg、sasuke-face.jpg。
 * - 頭髮：黑色帶深藍光澤；整頭往後梳、後腦一大叢往後上方翹的尖刺（鴨屁股刺蝟頭）、
 *   從頭頂分線往兩側拱起、越過護額垂到下巴的長瀏海，耳後與後頸也蓋滿頭髮；耳朵露出來。
 * - 臉：銳利眼、皺眉、抿嘴（冷酷）。護額戴在額頭，深藍布帶，後腦打結兩條綁帶。
 * - 衣服：深藍短袖上衣（袖口外擴）、很高的漏斗立領（前低後高、包住後頸、內側較暗）、
 *   背後團扇紋（上紅下白、白色有放射細線）、白色及膝短褲（膝下褲口外翻、小腿光腳）、
 *   前臂淡灰色針織護臂、右大腿繃帶與忍具袋（hdBody 內建）、藍色露趾涼鞋（後跟包住腳踝）。
 * 頭部座標：頭心為原點、正面 −z、角色的右邊 +x；頭上的位置用 yaw（度，0 = 正面、正值往角色右邊、180 = 後腦）
 * 與 yr（方向的 y 分量）或仰角表示。
 */

/** 佐助配色 */
export const SASUKE_COLORS = {
  skin: 0xf8d2b0,
  /** 深藍上衣與立領 */
  shirt: 0x262a4e,
  /** 白色短褲 */
  shorts: 0xeeeae2,
  /** 頭髮底色（黑帶深藍；頂點色再往髮尖加藍） */
  hair: 0x1c2036,
  /** 護額布帶 */
  band: 0x2b3462,
  /** 前臂護臂（淡灰針織） */
  guard: 0xa3a5aa,
  iris: '#3b3d48',
  brow: 0x1b1c24,
  /** 團扇紋的紅、白、白色部分的放射細線、外圈細邊（0..255） */
  crestRed: [205, 32, 39] as const,
  crestWhite: [244, 242, 236] as const,
  crestRib: [150, 152, 160] as const,
  crestRing: [30, 30, 38] as const,
};

/**
 * 團扇紋半徑（公尺）。圓心放在胸部衣身的下緣（腰、胸兩塊衣身的接縫，腰椎座標約 0.205）：
 * 紅白交界剛好落在接縫上——跑步時胸部相對腰部前傾、接縫錯開，也只是紅色或白色多露出一點，紋章中間不會多一條線。
 */
const CREST_R = 0.1;

const DEG = Math.PI / 180;

/** 0..1 平滑插值 */
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 依控制點（[x, y]，x 遞增）做分段平滑內插 */
function curveAt(pts: readonly (readonly [number, number])[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t * t * (3 - 2 * t);
    }
  }
  return pts[pts.length - 1][1];
}

/** 角度換到 −180..180 */
function wrap180(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** 0xRRGGBB → [r, g, b]（0..255） */
function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

// ───────────────────────── 貼圖與材質（影分身共用，只產生一次） ─────────────────────────

/** 共用貼圖與材質：團扇紋（腰部、胸部衣身各一張）、護臂針織紋、立領（頂點色讓內壁較暗） */
let shared: {
  bellyCanvas: HTMLCanvasElement;
  chestCanvas: HTMLCanvasElement;
  belly: THREE.CanvasTexture;
  chest: THREE.CanvasTexture;
  /** 團扇紋畫好了沒（要等第一次建好身體、拿到衣身幾何才畫得出來） */
  drawn: boolean;
  chestMat: THREE.MeshStandardMaterial;
  guardMat: THREE.MeshStandardMaterial;
  collarMat: THREE.MeshStandardMaterial;
} | null = null;

/** 建立一張衣身用的畫布貼圖（先填上衣底色，團扇紋之後再畫） */
function shirtCanvas(w: number, h: number): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = `#${SASUKE_COLORS.shirt.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, tex };
}

/** 護臂的針織紋：淡灰底、直向羅紋（一圈 22 條）＋淡淡的橫向針目 */
function knitTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 羅紋：每條中間亮、邊緣暗
      const rib = 0.5 + 0.5 * Math.cos((x / W) * Math.PI * 2 * 22);
      // 針目：每條羅紋上的 V 字小起伏
      const stitch = 0.5 + 0.5 * Math.cos((y / H) * Math.PI * 2 * 10 + Math.abs(((x / W) * 22) % 1 - 0.5) * 4);
      const s = 0.72 + 0.24 * Math.pow(rib, 0.6) + 0.04 * stitch;
      const v = Math.round(255 * Math.min(1, s));
      const i = (y * W + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** 取得佐助共用的貼圖與材質 */
function textures() {
  if (!shared) {
    const belly = shirtCanvas(1024, 256);
    const chest = shirtCanvas(1024, 256);
    // 立領：沿用上衣布料（織紋、凹凸），另外開頂點色讓內壁暗一點
    const collarMat = fabricMat(SASUKE_COLORS.shirt).clone();
    collarMat.vertexColors = true;
    shared = {
      bellyCanvas: belly.canvas,
      chestCanvas: chest.canvas,
      belly: belly.tex,
      chest: chest.tex,
      drawn: false,
      chestMat: fabricMat(0xffffff, chest.tex),
      guardMat: stdMat({ color: SASUKE_COLORS.guard, map: knitTexture(), roughness: 0.95 }),
      collarMat,
    };
  }
  return shared;
}

/**
 * 團扇紋某一點的顏色（站姿、腰椎座標）：圓形，上半紅、下半白，白色部分有放射狀細線，外圈細黑邊。
 * @param x 左右（0 = 背後正中央）
 * @param y 高度（腰椎座標）
 * @param cy 圓心高度（腰椎座標）
 * @returns 顏色；不在紋章內回傳 null
 */
function crestColor(x: number, y: number, cy: number): readonly [number, number, number] | null {
  const dy = y - cy;
  if (Math.abs(x) > CREST_R || Math.abs(dy) > CREST_R) return null;
  const d = Math.sqrt(x * x + dy * dy);
  if (d > CREST_R) return null;
  const C = SASUKE_COLORS;
  if (d > CREST_R - 0.0032) return C.crestRing;
  if (dy >= 0) return C.crestRed;
  // 白色下半：從圓心往外放射的細線（10 等分，9 條線）
  if (d > 0.004) {
    const ang = Math.atan2(-dy, x); // 0..π
    const step = Math.PI / 10;
    const k = Math.round(ang / step);
    if (k > 0 && k < 10 && Math.abs(ang - k * step) * d < 0.0011) return C.crestRib;
  }
  // 紅白交界一條極細的灰線，白色才不會直接糊進紅色
  if (dy > -0.0012) return C.crestRib;
  return C.crestWhite;
}

/**
 * 把團扇紋畫進旋轉曲面衣身的貼圖：逐像素用衣身網格本身的頂點（雙線性內插）換算出 3D 位置，
 * 所以紋章在衣服上是正圓，且腰部、胸部兩塊衣身接得起來。
 * 旋轉曲面的頂點是 (r_j·s_i, y_j, r_j·c_i)，雙線性內插可以拆成「沿圓周」與「沿輪廓」兩個一維內插，先各自算好表再組合（快很多）。
 * @param geo hdBody 的衣身（LatheGeometry；u = 0.5 是背後正中央）
 * @param yOffset 網格座標換到腰椎座標要加的高度（胸部衣身 = 胸關節高度）
 * @param cy 紋章圓心高度（腰椎座標）
 */
function drawCrest(canvas: HTMLCanvasElement, geo: THREE.BufferGeometry, yOffset: number, cy: number): void {
  const params = (geo as THREE.LatheGeometry).parameters;
  const n = params.points.length;
  const segs = params.segments;
  const arr = geo.attributes.position.array;
  // 輪廓上半徑最大的點：用來把頂點座標換回經線方向 s_i、c_i（含寬扁縮放）
  let jMax = 0;
  for (let j = 1; j < n; j++) if (params.points[j].x > params.points[jMax].x) jMax = j;
  const rMax = params.points[jMax].x;
  const W = canvas.width;
  const H = canvas.height;
  // 每個像素 2×2 超取樣（邊緣才平滑）；紋章只在背後正中央附近（u ≈ 0.5），只處理那一段
  const SS = 2;
  const x0 = Math.floor(W * 0.36);
  const x1 = Math.ceil(W * 0.64);
  /** 沿圓周的子取樣：經線方向的 x、z 分量 */
  const colS = new Float32Array((x1 - x0) * SS);
  const colC = new Float32Array((x1 - x0) * SS);
  for (let k = 0; k < colS.length; k++) {
    const fi = Math.min(segs - 1e-6, Math.max(0, ((x0 + (k + 0.5) / SS) / W) * segs));
    const i0 = Math.floor(fi);
    const a = fi - i0;
    const v0 = (i0 * n + jMax) * 3;
    const v1 = ((i0 + 1) * n + jMax) * 3;
    colS[k] = (arr[v0] * (1 - a) + arr[v1] * a) / rMax;
    colC[k] = (arr[v0 + 2] * (1 - a) + arr[v1 + 2] * a) / rMax;
  }
  /** 沿輪廓的子取樣：半徑與高度（畫布 y 往下 = v 由 1 往 0） */
  const rowR = new Float32Array(H * SS);
  const rowY = new Float32Array(H * SS);
  for (let k = 0; k < rowR.length; k++) {
    const fj = Math.min(n - 1 - 1e-6, Math.max(0, (1 - (k + 0.5) / (H * SS)) * (n - 1)));
    const j0 = Math.floor(fj);
    const b = fj - j0;
    rowR[k] = params.points[j0].x * (1 - b) + params.points[j0 + 1].x * b;
    rowY[k] = params.points[j0].y * (1 - b) + params.points[j0 + 1].y * b + yOffset;
  }
  // 直接在記憶體裡建整張圖（先填上衣底色）：不從畫布讀回像素（getImageData 在 GPU 畫布上很慢）
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, H);
  const base = rgb(SASUKE_COLORS.shirt);
  // 一次填滿：RGBA 四個位元組合成一個 32 位元整數（小端序：A 在最高位）
  new Uint32Array(img.data.buffer).fill(((255 << 24) | (base[2] << 16) | (base[1] << 8) | base[0]) >>> 0);
  /** 一個像素在衣服上的大小（公尺，取寬高較大者再放寬）：快速排除用 */
  const pxSize = 0.004;
  for (let py = 0; py < H; py++) {
    const Rc = rowR[py * SS];
    const dyc = rowY[py * SS] - cy;
    if (Math.abs(dyc) > CREST_R + pxSize) continue;
    for (let px = x0; px < x1; px++) {
      const kc = (px - x0) * SS;
      const xc = colS[kc] * Rc;
      if (colC[kc] <= 0 || xc * xc + dyc * dyc > (CREST_R + pxSize) ** 2) continue;
      let r = 0;
      let gg = 0;
      let bb = 0;
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        const R = rowR[py * SS + sy];
        const y = rowY[py * SS + sy];
        for (let sx = 0; sx < SS; sx++) {
          const k = (px - x0) * SS + sx;
          const c = colC[k] > 0 ? crestColor(colS[k] * R, y, cy) : null;
          const col = c ?? base;
          if (c) hit++;
          r += col[0];
          gg += col[1];
          bb += col[2];
        }
      }
      if (hit === 0) continue;
      const k = (py * W + px) * 4;
      img.data[k] = r / (SS * SS);
      img.data[k + 1] = gg / (SS * SS);
      img.data[k + 2] = bb / (SS * SS);
    }
  }
  g.putImageData(img, 0, 0);
}

/** 找出關節底下（直接子節點）頂點最多的旋轉曲面網格（hdBody 的衣身） */
function findLathe(joint: THREE.Object3D): THREE.Mesh | undefined {
  let best: THREE.Mesh | undefined;
  let bestN = -1;
  for (const c of joint.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.geometry.type !== 'LatheGeometry') continue;
    const count = m.geometry.attributes.position.count;
    if (count > bestN) {
      best = m;
      bestN = count;
    }
  }
  return best;
}

/**
 * 背後團扇紋：腰部衣身用 jacketMap（建身體時已給），胸部衣身換成同樣畫了紋章的材質。
 * 紋章橫跨兩塊衣身，所以兩張貼圖都從實際網格換算，接縫處才對得齊；圓心（紅白交界）放在胸部衣身下緣。
 */
function applyCrest(rig: HumanoidRig): void {
  const tex = textures();
  const belly = findLathe(rig.spine);
  const chest = findLathe(rig.chest);
  if (!tex.drawn && belly && chest) {
    chest.geometry.computeBoundingBox();
    const cy = chest.geometry.boundingBox!.min.y + rig.chest.position.y;
    drawCrest(tex.bellyCanvas, belly.geometry, 0, cy);
    drawCrest(tex.chestCanvas, chest.geometry, rig.chest.position.y, cy);
    tex.belly.needsUpdate = true;
    tex.chest.needsUpdate = true;
    tex.drawn = true;
  }
  if (chest) chest.material = tex.chestMat;
}

// ───────────────────────── 頭髮 ─────────────────────────

/**
 * 髮色（頂點色，乘在 hairMat 的底色上）：髮根暗、往髮尖越亮越藍；rim 是斷面邊緣的藍色反光。
 * @param t 0 髮根 → 1 髮尖
 * @param rim 0..1
 */
function hairTint(t: number, rim = 0): [number, number, number] {
  const k = 0.48 + 0.5 * t;
  const blue = 0.3 + 1.3 * t * t + 1.6 * rim;
  return [k, k * (1 + 0.12 * blue), k * (1 + blue)];
}

/**
 * 尖刺髮束：沿局部 +y 長出、斷面是扁橢圓（x 寬、z 薄），尖端往局部 +z 彎（像葉片）。
 * 底部開口（埋在頭髮底殼裡），頂點色髮根暗、髮尖帶藍。
 * @param len 長度
 * @param rad 底部半寬
 * @param bend 尖端往 +z 彎的量（相對長度）
 * @param flat z／x 厚度比
 */
function spikeGeometry(len: number, rad: number, bend: number, flat = 0.6, radial = 9, rings = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    // 底部飽滿、往尖端收細（指數 < 1：中段胖一點，像葉片）
    const r = rad * Math.pow(1 - t, 0.8);
    const y = len * t;
    const zc = bend * len * t * t;
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      pos.push(ca * r, y, zc + Math.sin(a) * r * flat);
      col.push(...hairTint(t, Math.pow(Math.abs(ca), 6) * t));
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < radial; k++) {
      const a = j * radial + k;
      const b = j * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 把網格擺到 base、局部 +y 朝 dir、局部 +z（彎曲方向）朝 bendHint（投影到垂直 dir 的平面）。
 */
function orient(mesh: THREE.Object3D, base: THREE.Vector3, dir: THREE.Vector3, bendHint: THREE.Vector3): void {
  const y = dir.clone().normalize();
  const z = bendHint.clone().addScaledVector(y, -bendHint.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  mesh.position.copy(base);
}

/** 頭上的方向：yaw（0 = 正面、正值往角色右邊）、仰角 el（度） */
function headDir(yaw: number, el: number): THREE.Vector3 {
  const c = Math.cos(el * DEG);
  return new THREE.Vector3(Math.sin(yaw * DEG) * c, Math.sin(el * DEG), -Math.cos(yaw * DEG) * c);
}

/** 頭表面（含臉部雕塑與頭型變形）某方向的點與朝外法線 */
function surfaceFrame(yaw: number, yr: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const y = Math.max(-0.985, Math.min(0.985, yr));
  const p = facePoint(yaw, y);
  const px = facePoint(yaw + 0.4, y).sub(p);
  const py = facePoint(yaw, y + 0.004).sub(p);
  return { p, n: new THREE.Vector3().crossVectors(py, px).normalize() };
}

/**
 * 髮束路徑上的一點。hang = 0：頭表面沿法線往外 lift；hang = 1：往下垂——
 * 水平位置固定在臉頰高度（yr −0.35）的頭表面外 lift，高度照 yr 往下，下巴附近才不會沿著頭型往內收。
 */
function hairPoint(yaw: number, yr: number, lift: number, hang: number): THREE.Vector3 {
  const f = surfaceFrame(yaw, yr);
  const onNormal = f.p.clone().addScaledVector(f.n, lift);
  if (hang <= 0) return onNormal;
  const top = surfaceFrame(yaw, Math.max(yr, -0.35)).p;
  const h = new THREE.Vector3(top.x, 0, top.z);
  h.setLength(h.length() + lift);
  return onNormal.lerp(new THREE.Vector3(h.x, f.p.y, h.z), Math.min(1, hang));
}

/** 均勻 Catmull-Rom 內插（每個分量各自內插）；t 0..1 涵蓋整條 */
function catmull(ctrl: readonly (readonly number[])[], t: number): number[] {
  const n = ctrl.length - 1;
  const f = Math.min(n - 1e-9, Math.max(0, t * n));
  const i = Math.floor(f);
  const u = f - i;
  const p0 = ctrl[Math.max(0, i - 1)];
  const p1 = ctrl[i];
  const p2 = ctrl[i + 1];
  const p3 = ctrl[Math.min(n, i + 2)];
  return p1.map(
    (_, k) =>
      0.5 *
      (2 * p1[k] +
        (-p0[k] + p2[k]) * u +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u),
  );
}

/** 髮束路徑控制點：[yaw 度, yr, 離頭表面的距離（公尺）, 下垂程度 0..1] */
type StrandPoint = [number, number, number, number];

/**
 * 貼著頭的長髮束（瀏海、鬢髮、後頸）：沿路徑掃出扁橢圓斷面的管子，髮根窄、上段最寬、往髮尾收尖。
 * @param path 控制點（Catmull-Rom 內插）
 * @param maxW 最寬處的半寬（公尺）
 * @param flat 厚度／寬度比
 */
function strandGeometry(path: readonly StrandPoint[], maxW: number, flat = 0.4, segs = 20, radial = 8): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const [yaw, yr, lift, hang] = catmull(path, i / segs);
    pts.push(hairPoint(yaw, yr, lift, hang));
  }
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    T.subVectors(pts[Math.min(i + 1, segs)], pts[Math.max(i - 1, 0)]).normalize();
    // 斷面「厚度」方向：從頭心往外（扣掉沿髮束的分量）
    N.copy(pts[i]).normalize().addScaledVector(T, -pts[i].clone().normalize().dot(T)).normalize();
    B.crossVectors(T, N);
    // 髮根略窄、中段維持最寬，最後四成才收成尖端
    const w = maxW * (0.55 + 0.45 * smooth(0, 0.25, t)) * Math.pow(1 - smooth(0.55, 1, t), 0.7);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(
        pts[i].x + B.x * ca * w + N.x * sa * w * flat,
        pts[i].y + B.y * ca * w + N.y * sa * w * flat,
        pts[i].z + B.z * ca * w + N.z * sa * w * flat,
      );
      col.push(...hairTint(0.2 + 0.8 * t, Math.pow(Math.abs(ca), 5) * (0.4 + 0.6 * t)));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 髮際線（極角，度；0 = 頭頂）隨方位（度，0 = 正面、180 = 後腦）變化：
 * 前面藏在護額下、兩側停在耳朵上方、耳後往下、後頸最低（塞進立領）。
 */
const HAIRLINE: readonly (readonly [number, number])[] = [
  [0, 74],
  [40, 76],
  [70, 80],
  [84, 84],
  [99, 85],
  [106, 100],
  [118, 122],
  [140, 134],
  [180, 138],
];

/**
 * 頭髮底殼：包住頭頂與後腦（半徑 1.065 倍頭），邊緣最後一段收回貼著頭皮，髮際線才不會翹起來。
 * 頭頂一個頂點、往下一圈一圈，方位是封閉環（沒有接縫）。
 */
function hairShellGeometry(): THREE.BufferGeometry {
  const NA = 56;
  const NT = 18;
  const R = DIMS.headR;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  // 頭頂
  v.set(0, R * 1.065, 0);
  shapeHead(v);
  pos.push(v.x, v.y, v.z);
  col.push(...hairTint(0.3));
  for (let j = 1; j <= NT; j++) {
    const t = j / NT;
    for (let i = 0; i < NA; i++) {
      const a = (i / NA) * 360;
      const theta = curveAt(HAIRLINE, Math.abs(wrap180(a))) * t * DEG;
      const rad = R * (1.065 - 0.06 * smooth(0.8, 1, t));
      v.set(Math.sin(theta) * Math.sin(a * DEG), Math.cos(theta), -Math.sin(theta) * Math.cos(a * DEG)).multiplyScalar(rad);
      shapeHead(v);
      pos.push(v.x, v.y, v.z);
      col.push(...hairTint(0.32 - 0.2 * t));
    }
  }
  // 頭頂扇形
  for (let i = 0; i < NA; i++) idx.push(0, 1 + ((i + 1) % NA), 1 + i);
  for (let j = 1; j < NT; j++) {
    for (let i = 0; i < NA; i++) {
      const a = 1 + (j - 1) * NA + i;
      const b = 1 + (j - 1) * NA + ((i + 1) % NA);
      const c = a + NA;
      const d = b + NA;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 一排往後梳的尖刺：[髮根仰角, 髮根方位列表（度，0 = 正面、180 = 後腦、正值往角色右邊）,
 * 尖刺仰角, 往外張的比例（髮根偏離後腦中線幾度 × 比例 = 尖刺往外偏幾度）, 長度, 底半寬]
 */
type SpikeRow = [number, number[], number, number, number, number];

/**
 * 鴨屁股刺蝟頭（仰角是站姿的頭部座標；跑步時頭往前傾，尖刺會再往上翹約 16°）：
 * 額頭上方兩撮往上竄、頭頂前段往上後方、頭頂後段與後腦往後上方翹（最長）、護額上緣往正後方、
 * 後腦兩側與耳朵上方往外張（背面看才是炸開的星形）。
 */
const DUCK_ROWS: SpikeRow[] = [
  [34, [-14, 14], 74, 0.1, 0.16, 0.062],
  [55, [-32, -11, 11, 32], 62, 0.12, 0.23, 0.08],
  [62, [-62, 62], 44, 0.3, 0.24, 0.078],
  [56, [-140, -104, 104, 140, 180], 32, 0.3, 0.3, 0.09],
  [50, [-122, 122], 26, 0.55, 0.27, 0.08],
  [42, [-160, -125, 125, 160], 20, 0.36, 0.33, 0.094],
  [44, [180], 22, 0, 0.35, 0.096],
  [36, [-170, 170], 12, 0.3, 0.3, 0.084],
  [27, [-145, 145, 180], 6, 0.5, 0.3, 0.086],
  [34, [-116, 116], 12, 0.8, 0.26, 0.08],
  [46, [-90, 90], 24, 0.8, 0.22, 0.072],
  [22, [-130, 130], 2, 1.2, 0.22, 0.072],
];

/**
 * 後腦的鴨屁股刺蝟頭：一排排往後梳、往後上方翹的尖刺（側面看像彗星尾巴，背面看像炸開的星形）。
 * 髮根埋在底殼裡，尖端微微往上（往後上方）捲。
 */
function addDuckSpikes(head: THREE.Object3D, mat: THREE.Material): void {
  const R = DIMS.headR;
  const curl = new THREE.Vector3(0, 0.7, 0.7);
  for (const [baseEl, yaws, el, spread, len, rad] of DUCK_ROWS) {
    for (const yaw of yaws) {
      const base = headDir(yaw, baseEl).multiplyScalar(R * 0.92);
      shapeHead(base);
      // 髮根偏離後腦中線的角度（正值 = 角色右邊）× 張開比例 = 尖刺往外偏的角度
      const dyaw = wrap180(180 - yaw) * spread;
      const c = Math.cos(el * DEG);
      const dir = new THREE.Vector3(Math.sin(dyaw * DEG) * c, Math.sin(el * DEG), Math.cos(dyaw * DEG) * c);
      const m = new THREE.Mesh(spikeGeometry(len, rad, 0.12), mat);
      orient(m, base, dir, curl);
      head.add(m);
    }
  }
}

/** 角色右邊（yaw 為正）的髮束，左邊鏡像：[路徑, 最寬半寬] */
const SIDE_STRANDS: [StrandPoint[], number][] = [
  // 主瀏海：從頭頂分線往外拱、越過護額側邊（金屬片旁），緊貼眼尾外側垂到下巴
  [
    [
      [3, 0.95, 0.006, 0],
      [13, 0.88, 0.036, 0],
      [25, 0.74, 0.052, 0],
      [35, 0.56, 0.058, 0],
      [41, 0.33, 0.054, 0],
      [41, 0.08, 0.04, 0.3],
      [39, -0.2, 0.028, 0.8],
      [37, -0.5, 0.024, 1],
      [34, -0.8, 0.026, 1],
    ],
    0.05,
  ],
  // 第二撮：在主瀏海外側後面
  [
    [
      [14, 0.93, 0.006, 0],
      [28, 0.8, 0.04, 0],
      [42, 0.6, 0.056, 0],
      [52, 0.36, 0.056, 0],
      [56, 0.08, 0.046, 0.4],
      [57, -0.22, 0.036, 0.9],
      [56, -0.52, 0.032, 1],
      [54, -0.72, 0.034, 1],
    ],
    0.044,
  ],
  // 第三撮：耳朵前方（不蓋住耳朵）
  [
    [
      [36, 0.88, 0.006, 0],
      [50, 0.7, 0.04, 0],
      [59, 0.44, 0.05, 0],
      [63, 0.14, 0.044, 0.4],
      [64, -0.14, 0.036, 1],
      [63, -0.4, 0.032, 1],
    ],
    0.032,
  ],
  // 耳後：從耳朵上後方垂到下巴高度
  [
    [
      [100, 0.62, 0.006, 0],
      [104, 0.32, 0.032, 0],
      [108, 0.02, 0.036, 0.3],
      [110, -0.3, 0.032, 1],
      [111, -0.58, 0.032, 1],
    ],
    0.044,
  ],
  // 後側：垂到立領上緣
  [
    [
      [124, 0.52, 0.006, 0],
      [128, 0.22, 0.03, 0],
      [132, -0.1, 0.03, 0.4],
      [134, -0.38, 0.028, 1],
      [134, -0.56, 0.028, 1],
    ],
    0.046,
  ],
];

/** 後腦護額下方往下梳的扁髮束（方位，度）：蓋住底殼，後腦才不會是一顆光滑的球 */
const BACK_YAWS = [140, 153, 166, 180, 194, 207, 220];

/**
 * 佐助的頭髮：底殼＋後腦鴨屁股尖刺＋兩側長瀏海、耳後髮束、後腦往下梳的扁髮束。全部共用一個頂點色頭髮材質。
 * 後腦的髮束短、貼著頭：跑步時頭前傾，太長會垂到背上擋住團扇紋。
 */
function addHair(rig: HumanoidRig): void {
  // 環境反射調低：灰白的反光少一點，頂點色的深藍光澤才看得出來
  const mat = stdMat({ color: SASUKE_COLORS.hair, roughness: 0.5, vertexColors: true, envMapIntensity: 0.45 }, 'sasuke-hair');
  const head = rig.head;
  head.add(new THREE.Mesh(hairShellGeometry(), mat));
  addDuckSpikes(head, mat);
  for (const [path, w] of SIDE_STRANDS) {
    for (const s of [-1, 1]) {
      const p = path.map(([yaw, yr, lift, hang]) => [s * yaw, yr, lift, hang] as StrandPoint);
      head.add(new THREE.Mesh(strandGeometry(p, w, 0.34), mat));
    }
  }
  for (const yaw of BACK_YAWS) {
    const lean = (yaw - 180) * 0.08;
    const p: StrandPoint[] = [
      [yaw, 0.3, 0.012, 0],
      [yaw + lean, 0.08, 0.026, 0],
      [yaw + lean * 1.6, -0.16, 0.025, 0],
      [yaw + lean * 2, -0.36, 0.016, 0],
      [yaw + lean * 2.2, -0.46, 0.01, 0],
    ];
    head.add(new THREE.Mesh(strandGeometry(p, 0.036, 0.16), mat));
  }
}

// ───────────────────────── 立領 ─────────────────────────

/** 立領外壁半徑隨高度（胸關節座標）變化：底部埋在胸口、腰身細、上緣大幅外翻（漏斗） */
const COLLAR_OUTER: readonly (readonly [number, number])[] = [
  [0.15, 0.142],
  [0.19, 0.137],
  [0.21, 0.143],
  [0.235, 0.174],
  [0.26, 0.205],
  [0.285, 0.232],
  [0.32, 0.26],
];

/** 立領上緣高度（胸關節座標）隨方位（度，0 = 正前方）：前面到下巴、後面高到後頸，正前方一個淺 V 開口 */
function collarTop(a: number): number {
  const t = Math.abs(wrap180(a)) / 180;
  const vee = 0.012 * Math.exp(-((wrap180(a) / 11) ** 2));
  return 0.23 + (0.318 - 0.23) * t * t * (3 - 2 * t) - vee;
}

/**
 * 高立領：從肩頸往上包住脖子的漏斗（外壁、圓滾上緣、內壁三段），掛在胸關節底下。
 * 前低後高；底部埋在胸口裡，所以不用封底。
 * 頂點色：外壁下暗上亮、圓滾上緣頂端最亮（摺邊的反光）、內壁暗（看得出是空心的）。
 */
function collarGeometry(): THREE.BufferGeometry {
  const NA = 56;
  const THICK = 0.018;
  const RIM = THICK / 2;
  const Y0 = 0.15;
  const YIN = 0.172;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let rows = 0;
  for (let i = 0; i < NA; i++) {
    const a = (i / NA) * 360;
    const ar = a * DEG;
    const top = collarTop(a) - RIM;
    /** 這個方位的斷面點 [半徑, 高度, 亮度]：外壁往上 → 上緣半圓 → 內壁往下 */
    const prof: [number, number, number][] = [];
    for (let k = 0; k <= 9; k++) {
      const y = Y0 + ((top - Y0) * k) / 9;
      prof.push([curveAt(COLLAR_OUTER, y), y, 0.9 + 0.25 * (k / 9) ** 2]);
    }
    const rTop = curveAt(COLLAR_OUTER, top);
    for (let k = 1; k <= 5; k++) {
      const ph = (k / 6) * Math.PI;
      prof.push([rTop - RIM + RIM * Math.cos(ph), top + RIM * Math.sin(ph), 1.15 + 0.15 * Math.sin(ph) - 0.5 * (k / 6)]);
    }
    for (let k = 0; k <= 7; k++) {
      const y = top + ((YIN - top) * k) / 7;
      prof.push([curveAt(COLLAR_OUTER, y) - THICK, y, 0.55 - 0.22 * (k / 7)]);
    }
    rows = prof.length;
    let acc = 0;
    prof.forEach(([r, y, shade], k) => {
      if (k > 0) acc += Math.hypot(r - prof[k - 1][0], y - prof[k - 1][1]);
      pos.push(r * Math.sin(ar), y, -r * Math.cos(ar));
      uv.push((i / NA) * 6, acc * 8);
      col.push(shade, shade, shade);
    });
  }
  for (let i = 0; i < NA; i++) {
    const i1 = (i + 1) % NA;
    for (let k = 0; k < rows - 1; k++) {
      const a = i * rows + k;
      const b = i1 * rows + k;
      const c = i * rows + k + 1;
      const d = i1 * rows + k + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ───────────────────────── 衣服細節 ─────────────────────────

/**
 * 依佐助的服裝修改 hdBody 的身體：拿掉夾克口袋蓋、長褲改成及膝短褲（膝下褲口外翻、小腿光腳）、
 * 涼鞋加高到包住腳踝、短袖袖口外擴、前臂套淡灰色針織護臂。
 */
function tailorBody(rig: HumanoidRig): void {
  const C = SASUKE_COLORS;
  const tex = textures();
  const shirt = fabricMat(C.shirt);
  const shorts = fabricMat(C.shorts);
  const skin = skinMat(C.skin);
  const sandal = rubberMat(NINJA_COLORS.sandal);
  // 上衣沒有口袋：移除腰部衣身前面的斜口袋蓋（hdBody 的圓角方塊）
  for (const c of [...rig.spine.children]) {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry.type === 'RoundedBoxGeometry') {
      rig.spine.remove(m);
      m.geometry.dispose();
    }
  }
  // 腿：移除長褲的小腿、褲口、綁腿（膝關節底下的圓柱與旋轉曲面），換成光腳小腿＋膝下外翻的短褲褲口
  for (const knee of [rig.kneeL, rig.kneeR]) {
    for (const c of [...knee.children]) {
      const m = c as THREE.Mesh;
      if (m.isMesh && (m.geometry.type === 'CylinderGeometry' || m.geometry.type === 'LatheGeometry')) {
        knee.remove(m);
        m.geometry.dispose();
      }
    }
    const shin = new THREE.Mesh(taperedLimb(0.061, 0.047, DIMS.shin * 0.97), skin);
    shin.position.y = -0.012;
    knee.add(shin);
    // 褲口：內壁往下 → 下緣 → 外壁往上（有厚度、微微外擴）
    const hem: [number, number][] = [
      [0.066, -0.03],
      [0.068, -0.084],
      [0.074, -0.093],
      [0.086, -0.09],
      [0.093, -0.074],
      [0.094, -0.05],
      [0.089, -0.022],
      [0.08, 0.0],
    ];
    knee.add(new THREE.Mesh(latheBody(hem, 1, 1, 28, 0, Math.PI * 2), shorts));
  }
  // 涼鞋後跟往上包住腳踝（藍色一圈）
  for (const ankle of [rig.ankleL, rig.ankleR]) {
    const cuff = new THREE.Mesh(ringBand(0.047, 0.072, 0.011, 24), sandal);
    cuff.position.set(0, -0.004, 0.004);
    ankle.add(cuff);
  }
  // 短袖：袖口外擴、有厚度（內壁往下 → 下緣 → 外壁往上）
  const sleeveHem: [number, number][] = [
    [0.067, -0.15],
    [0.07, -0.2],
    [0.075, -0.207],
    [0.082, -0.205],
    [0.087, -0.196],
    [0.086, -0.176],
    [0.08, -0.15],
    [0.074, -0.12],
  ];
  for (const sh of [rig.shoulderL, rig.shoulderR]) {
    sh.add(new THREE.Mesh(latheBody(sleeveHem, 1, 1, 24, 0, Math.PI * 2), shirt));
  }
  // 前臂護臂：手肘下方到手腕上方，比前臂粗一圈，上下緣收圓
  const guard: [number, number][] = [
    [0.057, -0.158],
    [0.068, -0.155],
    [0.075, -0.145],
    [0.077, -0.1],
    [0.076, -0.055],
    [0.071, -0.042],
    [0.062, -0.038],
  ];
  for (const el of [rig.elbowL, rig.elbowR]) {
    el.add(new THREE.Mesh(latheBody(guard, 1, 1, 28, 0, Math.PI * 2), tex.guardMat));
  }
}

/**
 * 建立佐助（高精細版）。回傳的 rig 由 anim.ts 驅動動作（和主角共用骨架與動畫）。
 * @param outline 描邊粗細（0 = 不描邊）
 */
export function buildSasuke(outline = 0.007): HumanoidRig {
  const C = SASUKE_COLORS;
  const tex = textures();
  const rig = buildHumanoidHD({
    skin: C.skin,
    jacket: C.shirt,
    jacketMap: tex.belly,
    cuffs: C.shirt,
    sleeve: C.shirt,
    pants: C.shorts,
    wraps: C.skin,
    sandal: NINJA_COLORS.sandal,
    sole: NINJA_COLORS.sole,
    bareArms: 'forearm',
    wristCuffs: false,
  });
  applyCrest(rig);
  tailorBody(rig);
  rig.chest.add(new THREE.Mesh(collarGeometry(), tex.collarMat));
  addHead3D(rig, {
    skin: C.skin,
    iris: C.iris,
    brow: C.brow,
    eyes: 'sharp',
    brows: 'frown',
    mouth: 'frown',
  });
  addHair(rig);
  addHeadbandHD(rig, C.band, true);
  finalizeRig(rig, outline);
  return rig;
}
