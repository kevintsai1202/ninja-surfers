import * as THREE from 'three';
import { DIMS, type HumanoidRig } from './rig';
import { buildHumanoidHD, finalizeRig } from './hdBody';
import { fabricMat, skinMat, hairMat, metalMat } from './charMats';
import {
  hairLock,
  placeLock,
  withWhiteColors,
  curvedPlate,
  ringBand,
  shapeHead,
  shapeHeadGeometry,
  ribbonChain,
} from './shapes';
import { faceTextureHD } from './faceHD';
import { FACE_PHI_DEG, FACE_THETA_START, FACE_THETA_LENGTH } from '../textures';
import { stdMat } from '../materials';
import { addHead3D } from './face3d';

/**
 * 主角（Q 版忍者，高精細版）：參考 docs/concept/ninja-sheet-a.jpg、ninja-sheet-b.jpg。
 * 金色粗髮束、藍眼大眼、鬍鬚紋、深藍護額（弧形金屬片＋刻紋）、橘色夾克（深藍披肩、白色高領、拉鍊、
 * 袖子外側深藍條紋、背後紅色漩渦）、橘色寬褲、右大腿繃帶與忍具袋、深藍綁腿、藍色涼鞋。
 */

/** 主角配色 */
export const NINJA_COLORS = {
  skin: 0xf7c9a2,
  orange: 0xff7d1f,
  pants: 0xf87318,
  navy: 0x2a2d4b,
  white: 0xf4f1ea,
  sandal: 0x2f63c9,
  sole: 0x22408a,
  hair: 0xffcd38,
  band: 0x272f50,
  metal: 0xd3dae0,
};

/** 主角共用貼圖（影分身共用，不重複產生） */
let shared: {
  face: THREE.Texture;
  jacket: THREE.Texture;
  sleeve: THREE.Texture;
  plate: THREE.Texture;
  plateBump: THREE.Texture;
} | null = null;

/** 把 0xRRGGBB 轉成 CSS 色碼 */
function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/**
 * 夾克下半身貼圖：橘色底，背後正中央（u = 0.5）畫紅色漩渦紋。
 * 漩渦在貼圖上畫成橢圓，是為了抵銷旋轉曲面 u、v 方向每公尺像素數不同（見設計註記）。
 */
function jacketTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = css(NINJA_COLORS.orange);
  g.fillRect(0, 0, W, H);
  // 背後漩渦紋：中心 u = 0.5、v ≈ 0.6（衣身高度 0.15 m 處）
  const cx = W / 2;
  const cy = H * 0.39;
  const rx = 62;
  const ry = 118;
  g.save();
  g.translate(cx, cy);
  g.scale(rx / 100, ry / 100);
  g.strokeStyle = '#d3271d';
  g.lineCap = 'round';
  g.lineWidth = 15;
  g.beginPath();
  for (let a = 0; a <= Math.PI * 3.6; a += 0.05) {
    const r = 6 + a * 7.6;
    const x = Math.cos(a + Math.PI) * r;
    const y = Math.sin(a + Math.PI) * r;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // 漩渦尾巴往右下拖出一段
  g.lineWidth = 13;
  g.beginPath();
  g.arc(0, 0, 92, Math.PI * 0.05, Math.PI * 0.55);
  g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 袖子貼圖：橘色底，外側（u = 0.25）一條深藍色條紋 */
function sleeveTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = css(NINJA_COLORS.orange);
  g.fillRect(0, 0, W, H);
  g.fillStyle = css(NINJA_COLORS.navy);
  g.fillRect(W * 0.25 - W * 0.065, 0, W * 0.13, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 護額金屬片的顏色貼圖與凹凸貼圖：銀色漸層＋刻出來的漩渦葉紋（原創簡化圖案） */
function plateTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512;
  const H = 224;
  const draw = (forBump: boolean) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    if (forBump) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
    } else {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#f2f5f7');
      grad.addColorStop(0.5, '#c9d0d6');
      grad.addColorStop(1, '#9ea8b0');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    // 刻紋：漩渦＋葉尖；凹凸圖裡是黑色（凹下去），顏色圖裡是深灰
    g.strokeStyle = forBump ? '#000000' : '#59636b';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 13;
    const cx = W * 0.46;
    const cy = H * 0.52;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 3.3; a += 0.05) {
      const r = 6 + a * 11;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.92;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    g.moveTo(cx + 86, cy + 14);
    g.quadraticCurveTo(cx + 132, cy + 34, cx + 150, cy + 70);
    g.quadraticCurveTo(cx + 104, cy + 64, cx + 64, cy + 60);
    g.stroke();
    // 四角鉚釘的凹槽
    if (forBump) {
      g.fillStyle = '#7a7a7a';
      for (const [x, y] of [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]]) {
        g.beginPath();
        g.arc(x, y, 12, 0, Math.PI * 2);
        g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = forBump ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: draw(false), bump: draw(true) };
}

/** 取得主角共用貼圖（護額金屬片也給其他角色用） */
export function textures() {
  if (!shared) {
    const plate = plateTextures();
    shared = {
      face: faceTextureHD({ iris: '#2f86ec', brow: '#e8b52c', whiskers: true, blush: true, mouth: 'smile' }),
      jacket: jacketTexture(),
      sleeve: sleeveTexture(),
      plate: plate.map,
      plateBump: plate.bump,
    };
  }
  return shared;
}

/**
 * 頭部：變形過的頭殼（下巴、臉頰）、臉部貼圖、鼻子、圓耳朵。
 * 臉部切片與頭殼用同一個變形函式，五官才會貼合。
 */
export function addHeadHD(rig: HumanoidRig, skin: number, face: THREE.Texture): void {
  const r = DIMS.headR;
  const skinM = skinMat(skin);
  const skull = shapeHeadGeometry(new THREE.SphereGeometry(r, 36, 26));
  rig.head.add(new THREE.Mesh(skull, skinM));
  // 臉部切片：phi 以 3π/2（正面 −z）為中心
  const faceGeo = shapeHeadGeometry(
    new THREE.SphereGeometry(
      r * 1.006,
      32,
      22,
      Math.PI * 1.5 - (FACE_PHI_DEG * Math.PI) / 360,
      (FACE_PHI_DEG * Math.PI) / 180,
      FACE_THETA_START,
      FACE_THETA_LENGTH,
    ),
  );
  const faceMesh = new THREE.Mesh(
    faceGeo,
    stdMat({ map: face, transparent: true, alphaTest: 0.3, roughness: 0.5, depthWrite: true }),
  );
  faceMesh.userData.noOutline = true;
  faceMesh.renderOrder = 1;
  rig.head.add(faceMesh);
  // 鼻子：貼在變形後的頭殼表面
  const nosePos = new THREE.Vector3(0, -0.3, -1).normalize().multiplyScalar(r);
  shapeHead(nosePos);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), skinM);
  nose.scale.set(1.2, 0.8, 0.8);
  nose.position.copy(nosePos).add(new THREE.Vector3(0, 0, 0.006));
  rig.head.add(nose);
  // 圓耳朵＋耳窩
  const inner = skinMat(0xe3a37f);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.064, 18, 12), skinM);
    ear.scale.set(0.42, 0.95, 0.72);
    ear.position.set(side * r * 0.985, -0.05, 0.012);
    rig.head.add(ear);
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), inner);
    hole.scale.set(0.24, 0.72, 0.5);
    hole.position.set(side * (r * 0.985 + 0.014), -0.05, 0.004);
    hole.userData.noOutline = true;
    rig.head.add(hole);
  }
}

/**
 * 金色刺蝟頭：頭頂與後腦的髮蓋＋一撮撮往上、往後翹的粗髮束，額前與鬢角也有髮束壓在護額上。
 */
function addHair(rig: HumanoidRig): void {
  const r = DIMS.headR;
  const mat = hairMat(NINJA_COLORS.hair);
  const cap = new THREE.SphereGeometry(r * 1.07, 36, 16, 0, Math.PI * 2, 0, Math.PI * 0.4);
  rig.head.add(new THREE.Mesh(withWhiteColors(shapeHeadGeometry(cap), 0.85), mat));
  const back = new THREE.SphereGeometry(r * 1.055, 28, 14, 0, Math.PI, Math.PI * 0.25, Math.PI * 0.5);
  rig.head.add(new THREE.Mesh(withWhiteColors(shapeHeadGeometry(back), 0.8), mat));
  // [方向, 長度, 底半徑, 彎曲]（正面是 −z）
  const locks: [[number, number, number], number, number, number][] = [
    // 頭頂：大撮往上、髮尾往後
    [[0, 1, 0.15], 0.3, 0.1, 0.35],
    [[0.32, 0.92, 0.12], 0.28, 0.095, 0.35],
    [[-0.32, 0.92, 0.12], 0.28, 0.095, 0.35],
    [[0.16, 0.95, -0.28], 0.27, 0.09, 0.4],
    [[-0.16, 0.95, -0.28], 0.27, 0.09, 0.4],
    [[0.02, 0.9, -0.42], 0.25, 0.085, 0.45],
    [[0.45, 0.8, -0.25], 0.24, 0.085, 0.4],
    [[-0.45, 0.8, -0.25], 0.24, 0.085, 0.4],
    // 兩側往外、往後翹
    [[0.75, 0.6, 0.05], 0.26, 0.085, 0.35],
    [[-0.75, 0.6, 0.05], 0.26, 0.085, 0.35],
    [[0.62, 0.55, 0.45], 0.27, 0.09, 0.3],
    [[-0.62, 0.55, 0.45], 0.27, 0.09, 0.3],
    [[0.88, 0.3, 0.25], 0.21, 0.075, 0.3],
    [[-0.88, 0.3, 0.25], 0.21, 0.075, 0.3],
    [[0.8, 0.45, -0.3], 0.2, 0.07, 0.35],
    [[-0.8, 0.45, -0.3], 0.2, 0.07, 0.35],
    // 後腦：往後、往下
    [[0, 0.62, 0.78], 0.3, 0.1, 0.25],
    [[0.38, 0.4, 0.83], 0.27, 0.09, 0.22],
    [[-0.38, 0.4, 0.83], 0.27, 0.09, 0.22],
    [[0.18, 0.12, 0.98], 0.25, 0.085, 0.2],
    [[-0.18, 0.12, 0.98], 0.25, 0.085, 0.2],
    [[0.42, -0.1, 0.9], 0.2, 0.07, 0.15],
    [[-0.42, -0.1, 0.9], 0.2, 0.07, 0.15],
    [[0, -0.18, 0.98], 0.2, 0.075, 0.15],
    // 額前瀏海：從護額上方往前上翹
    [[0.25, 0.72, -0.65], 0.2, 0.075, 0.5],
    [[-0.25, 0.72, -0.65], 0.2, 0.075, 0.5],
    [[0.02, 0.76, -0.66], 0.21, 0.08, 0.5],
    [[0.52, 0.58, -0.62], 0.17, 0.065, 0.45],
    [[-0.52, 0.58, -0.62], 0.17, 0.065, 0.45],
  ];
  for (const [d, len, rad, bend] of locks) {
    const m = new THREE.Mesh(hairLock(len, rad, bend), mat);
    placeLock(m, new THREE.Vector3(...d), r * 0.86);
    rig.head.add(m);
  }
  // 鬢角：耳朵前方往下垂的兩撮
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(hairLock(0.15, 0.045, 0.15), mat);
    placeLock(m, new THREE.Vector3(side * 0.92, 0.05, -0.35), r * 0.9, new THREE.Vector3(0, -1, 0.2));
    m.rotateX(Math.PI * 0.85);
    rig.head.add(m);
  }
}

/** 護額的擺放：繞頭心旋轉（弧度）。pitch 正值把正面往上推到頭頂（小櫻當髮箍戴）；roll 正值讓角色左邊往下（卡卡西斜遮左眼）；yaw 正值把金屬片往角色左邊轉 */
export interface HeadbandPose {
  pitch?: number;
  roll?: number;
  yaw?: number;
}

/**
 * 護額：深藍布帶（有厚度、貼合頭型）＋弧形金屬片（刻紋凹凸、四角鉚釘）＋後腦的結與兩條綁帶。
 * @param pose 整條護額繞頭心旋轉（頭接近球形，轉了仍貼著頭）
 */
export function addHeadbandHD(rig: HumanoidRig, bandColor = NINJA_COLORS.band, tails = true, pose: HeadbandPose = {}): void {
  const tex = textures();
  const r = DIMS.headR;
  const y = r * 0.34;
  // 所有零件放在同一個群組，整組繞頭心旋轉
  const g = new THREE.Group();
  g.name = 'headband';
  g.rotation.set(pose.pitch ?? 0, pose.yaw ?? 0, pose.roll ?? 0);
  rig.head.add(g);
  const bandMat = fabricMat(bandColor);
  // 先移到額頭高度再套頭型變形：反過來的話會用赤道的臉頰加寬量，布帶左右變寬、從金屬片兩側穿到前面
  const band = ringBand(r * 1.03, 0.082, 0.016, 40);
  band.translate(0, y, 0);
  shapeHeadGeometry(band);
  g.add(new THREE.Mesh(band, bandMat));
  // 金屬片：彎成頭部弧度，正面朝 −z
  const R = r * 1.075;
  const plate = new THREE.Mesh(curvedPlate(0.21, 0.09, 0.014, R), metalMat(0xffffff, tex.plate, tex.plateBump));
  plate.position.y = y;
  g.add(plate);
  const rivetMat = metalMat(0xa9b2ba);
  for (const [px, py] of [[-0.088, 0.03], [0.088, 0.03], [-0.088, -0.03], [0.088, -0.03]]) {
    const a = px / R;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), rivetMat);
    rivet.position.set(Math.sin(a) * (R + 0.008), y + py, -Math.cos(a) * (R + 0.008));
    rivet.userData.noOutline = true;
    g.add(rivet);
  }
  // 後腦的結
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), bandMat);
  knot.scale.set(1.25, 0.85, 0.8);
  knot.position.set(0, y, r * 0.98);
  g.add(knot);
  if (!tails) return;
  for (const side of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), bandMat);
    loop.scale.set(1.2, 0.7, 0.7);
    loop.position.set(side * 0.045, y + 0.01, r * 0.95);
    g.add(loop);
    // 兩條綁帶：動畫會讓它們隨風往後飄
    const flap = ribbonChain(g, [side * 0.03, y - 0.012, r * 1.02], 5, 0.068, 0.062, 0.013, bandMat, 0.93);
    flap.rotation.set(0.6, side * 0.22, 0);
    flap.userData.side = side;
    flap.userData.baseX = 0.75;
    rig.flaps.push(flap);
  }
}

/**
 * 建立主角（高精細版）。回傳的 rig 由 anim.ts 驅動動作。
 * @param outline 描邊粗細（0 = 不描邊）
 */
export function buildNinja(outline = 0.007): HumanoidRig {
  const c = NINJA_COLORS;
  const tex = textures();
  const rig = buildHumanoidHD({
    skin: c.skin,
    jacket: c.orange,
    jacketMap: tex.jacket,
    yoke: c.navy,
    collar: c.white,
    cuffs: c.navy,
    sleeve: 0xffffff,
    sleeveMap: tex.sleeve,
    pants: c.pants,
    wraps: c.navy,
    sandal: c.sandal,
    sole: c.sole,
    zipper: true,
  });
  // 第二版：立體臉（參考 docs/concept/naruto-face.jpg）
  addHead3D(rig, {
    skin: c.skin,
    iris: '#2f86ec',
    brow: 0xc9961f,
    eyes: 'round',
    brows: 'confident',
    mouth: 'grin',
    whiskers: true,
    blush: true,
  });
  addHair(rig);
  addHeadbandHD(rig);
  finalizeRig(rig, outline);
  return rig;
}
