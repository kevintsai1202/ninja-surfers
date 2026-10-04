import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMS, type HumanoidRig } from './rig';
import { buildHumanoidHD, finalizeRig, darken } from './hdBody';
import { fabricMat, skinMat, hairMat, rubberMat, metalMat } from './charMats';
import { ringBand, taperedLimb, shapeHead, withWhiteColors, latheBody } from './shapes';
import { addHead3D } from './face3d';
import { addHeadbandHD, NINJA_COLORS } from './ninja';

/**
 * 小櫻（Q 版，高精細版）：參考 docs/concept/sakura-sheet.jpg、sakura-face.jpg。
 * - 粉紅及肩鮑伯頭：中分瀏海露出寬額頭、耳朵前面兩撮長鬢髮、後面與兩側垂到肩膀，髮尾一撮撮收尖。
 * - 護額當髮箍戴在頭頂（金屬片在頭頂前方、布帶斜繞到後腦打結）。
 * - 紅色無袖旗袍式上衣：小立領、前面拉鍊、背後白色圓紋；腰部以下分成前後兩片短裙片（兩側開衩）。
 * - 淡橄欖綠合身短褲、右大腿繃帶＋忍具袋、裸腿、藍色露趾短靴。
 *
 * 跑步時（上身前傾約 75°、頭抬起）後腦正下方就是上背，前裙片會被高抬的大腿頂到：
 * 這兩處做成「被動關節」（見 drive），每幀依脖子／大腿的角度自己轉開，不用改 anim.ts。
 */

/** 小櫻配色 */
export const SAKURA_COLORS = {
  skin: 0xf9cfae,
  /** 頭髮（粉紅，頂點色會讓髮根暗、髮尾亮） */
  hair: 0xf2a0bb,
  /** 上衣紅 */
  top: 0xc8322e,
  /** 背後圓紋（偏暖的白） */
  crest: 0xf6f2ea,
  /** 短褲（淡橄欖綠） */
  pants: 0x9aa76b,
  brow: 0xd9708f,
  iris: '#2fa86b',
};

const D = DIMS;
/** 頭半徑 */
const R = DIMS.headR;
const DEG = Math.PI / 180;

/** 衣身下半段（腰部）的輪廓與 x／z 縮放：要和 hdBody.ts 的 BELLY_PROFILE、BODY_SX、BODY_SZ 一致（白色圓紋依此換算位置） */
const BELLY_PROFILE: [number, number][] = [
  [0.15, 0],
  [0.162, 0.05],
  [0.17, 0.12],
  [0.174, 0.19],
  [0.176, 0.27],
];
const BODY_SX = 1.13;
const BODY_SZ = 0.86;

/** 背後圓紋：圓心在腰部衣身的高度（腰椎座標）與半徑（公尺）。上緣要低於胸部衣身的下緣（約 0.205），才不會被蓋住 */
const CREST_Y = 0.136;
const CREST_R = 0.066;

/** 小櫻共用貼圖（影分身共用，不重複產生） */
let shared: { jacket: THREE.Texture } | null = null;

/** 0..1 平滑插值 */
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 上衣腰部貼圖：紅底，背後正中央（u = 0.5）一個白色圓紋。
 * 旋轉曲面的 v 是依輪廓點的索引均分（不是依高度），x、z 又有不同縮放，
 * 所以逐像素換算回衣身上的 3D 位置、用「離圓心的距離」上色，貼到身上才是正圓、邊緣也平滑。
 */
function jacketTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const red = [(SAKURA_COLORS.top >> 16) & 255, (SAKURA_COLORS.top >> 8) & 255, SAKURA_COLORS.top & 255];
  const white = [(SAKURA_COLORS.crest >> 16) & 255, (SAKURA_COLORS.crest >> 8) & 255, SAKURA_COLORS.crest & 255];
  const n = BELLY_PROFILE.length - 1;
  // 圓心：背後正中央、高度 CREST_Y 的衣身表面
  const seg = BELLY_PROFILE.findIndex(([, y], i) => i < n && CREST_Y >= y && CREST_Y <= BELLY_PROFILE[i + 1][1]);
  const [r0, y0] = BELLY_PROFILE[seg];
  const [r1, y1] = BELLY_PROFILE[seg + 1];
  const cz = (r0 + ((r1 - r0) * (CREST_Y - y0)) / (y1 - y0)) * BODY_SZ;
  for (let py = 0; py < H; py++) {
    // CanvasTexture 預設 flipY：畫布最上面是 v = 1（衣身上緣）
    const f = (1 - (py + 0.5) / H) * n;
    const j = Math.min(n - 1, Math.floor(f));
    const k = f - j;
    const r = BELLY_PROFILE[j][0] + (BELLY_PROFILE[j + 1][0] - BELLY_PROFILE[j][0]) * k;
    const h = BELLY_PROFILE[j][1] + (BELLY_PROFILE[j + 1][1] - BELLY_PROFILE[j][1]) * k;
    for (let px = 0; px < W; px++) {
      // latheBody 的接縫在正面（phi 從 π 開始），u = 0.5 是背後正中央
      const phi = Math.PI + ((px + 0.5) / W) * Math.PI * 2;
      const dx = Math.sin(phi) * r * BODY_SX;
      const dy = h - CREST_Y;
      const dz = Math.cos(phi) * r * BODY_SZ - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // 圓紋邊緣 3 mm 的平滑過渡（抗鋸齒）
      const w = 1 - smooth(CREST_R - 0.0015, CREST_R + 0.0015, d);
      const i = (py * W + px) * 4;
      img.data[i] = red[0] + (white[0] - red[0]) * w;
      img.data[i + 1] = red[1] + (white[1] - red[1]) * w;
      img.data[i + 2] = red[2] + (white[2] - red[2]) * w;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 取得小櫻共用貼圖 */
function textures(): { jacket: THREE.Texture } {
  if (!shared) shared = { jacket: jacketTexture() };
  return shared;
}

/** 建立網格並掛到 parent（位置可選） */
function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  parent.add(m);
  return m;
}

/** 移除關節底下直接掛著、符合條件的網格（hdBody 的預設零件有些小櫻用不到） */
function removeMeshes(joint: THREE.Object3D, match: (m: THREE.Mesh) => boolean): void {
  for (const o of [...joint.children]) {
    const m = o as THREE.Mesh;
    if (m.isMesh && match(m)) {
      joint.remove(m);
      m.geometry.dispose();
    }
  }
}

/**
 * 被動關節：three 每幀算圖前更新矩陣時（updateMatrixWorld → updateMatrix），先呼叫 update 依其他關節的角度
 * 重算自己的旋轉。動畫器已經在這之前設好所有關節角度，所以不用改 anim.ts 就能跟著動作反應。
 */
function drive(g: THREE.Group, update: () => void): void {
  const compose = g.updateMatrix.bind(g);
  g.updateMatrix = () => {
    update();
    compose();
  };
}

// ───────────────────────── 身體：短褲、裸腿、短靴、裙片 ─────────────────────────

/**
 * 裸腿的輪廓（[半徑, 高度]，由下往上）：大腿下端與小腿上端都是圓頭，膝蓋彎曲時兩個圓頭互相嵌合，
 * 不會像「圓柱＋膝蓋球」那樣在皮膚上出現鋸齒狀的交線或露出圓柱切口。
 */
const THIGH_PROFILE: [number, number][] = [
  [0, -0.396],
  [0.04, -0.39],
  [0.064, -0.378],
  [0.078, -0.36],
  [0.084, -0.34],
  [0.086, -0.3],
  [0.089, -0.22],
  [0.092, -0.15],
  [0.097, -0.06],
  [0.1, 0],
];
const SHIN_PROFILE: [number, number][] = [
  [0.058, -0.25],
  [0.064, -0.16],
  [0.072, -0.07],
  [0.076, -0.02],
  [0.073, 0.015],
  [0.058, 0.04],
  [0.032, 0.055],
  [0, 0.06],
];

/** 圓頭肢體：輪廓繞 y 軸旋轉（LatheGeometry 自己算的法線在接縫處是平滑的，不會有接縫線） */
function roundLimb(profile: [number, number][]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    18,
  );
}

/**
 * 腿：hdBody 預設是長褲＋綁腿，這裡改成短褲（褲管到大腿中段）、裸露的膝蓋與小腿、藍色露趾短靴。
 * 右大腿的繃帶與忍具袋沿用 hdBody（苦無柄往外挪一點，不要被短褲褲管吃掉）。
 */
function buildLegs(rig: HumanoidRig): void {
  const c = SAKURA_COLORS;
  const pants = fabricMat(c.pants);
  const skin = skinMat(c.skin);
  const boot = rubberMat(NINJA_COLORS.sandal);
  for (const [hip, side] of [
    [rig.hipL, -1],
    [rig.hipR, 1],
  ] as const) {
    // 大腿：長褲褲管與髖部圓球拿掉，換成裸露的大腿（粗細和原本褲管一樣，繃帶才貼得剛好）
    removeMeshes(hip, (m) => m.material === pants);
    part(hip, roundLimb(THIGH_PROFILE), skin);
    // 短褲褲管：合身、到大腿上段，褲口有一圈收邊
    part(hip, new THREE.SphereGeometry(0.108, 18, 12), pants);
    part(hip, taperedLimb(0.108, 0.103, 0.1), pants);
    part(hip, ringBand(0.1, 0.024, 0.008), pants, [0, -0.098, 0]);
    if (side < 0) {
      // 左腿外側的立體口袋（右腿外側是忍具袋）
      part(hip, new RoundedBoxGeometry(0.024, 0.062, 0.07, 2, 0.008), pants, [-0.105, -0.05, 0.004]);
      part(hip, new RoundedBoxGeometry(0.028, 0.016, 0.074, 2, 0.006), pants, [-0.109, -0.018, 0.004]);
    } else {
      // 苦無柄與拉環往外挪，露在短褲外面
      const kunai = metalMat(0x3d4148);
      for (const o of hip.children) if ((o as THREE.Mesh).material === kunai) o.position.x += 0.014;
    }
  }
  for (const knee of [rig.kneeL, rig.kneeR]) {
    // 膝蓋以下全部重做：皮膚的小腿、藍色短靴（踝關節底下的涼鞋底、腳背帶、後跟沿用）
    removeMeshes(knee, () => true);
    part(knee, roundLimb(SHIN_PROFILE), skin);
    part(knee, taperedLimb(0.064, 0.058, D.shin * 0.31), boot, [0, -D.shin * 0.69, 0]);
    // 靴口反摺的一圈
    part(knee, ringBand(0.064, 0.02, 0.008), boot, [0, -D.shin * 0.69, 0]);
  }
}

/**
 * 裙片：有厚度的弧形布片，繞著骨盆外圍、下襬往外微張。
 * 用細分方塊彎出來（同 shapes.ts 的 curvedPlate），前後面與四邊都封閉，被大腿掀起時看得到內面。
 * @param a0 a1 左右邊緣的方位角（弧度，0 = 正前方、π = 正後方，正值往角色右邊）
 * @param yTop yBot 上緣、下襬高度（骨盆座標）
 * @param rTop rBot 上緣、下襬半徑（再乘上衣身的 x／z 縮放）
 * @param thick 布片厚度
 */
function skirtPanel(
  a0: number,
  a1: number,
  yTop: number,
  yBot: number,
  rTop: number,
  rBot: number,
  thick: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 12, 5, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const bx = pos.getX(i) + 0.5;
    const by = pos.getY(i) + 0.5;
    // 方塊的 −z 面朝外（半徑較大的一面）
    const bz = pos.getZ(i);
    const a = a0 + (a1 - a0) * bx;
    // 下襬往外張：越往下半徑越大（上緣塞在腰帶環裡面，從腰帶下緣露出來）
    const r = rTop + (rBot - rTop) * (1 - by) - bz * thick;
    pos.setXYZ(i, Math.sin(a) * r * BODY_SX, yBot + (yTop - yBot) * by, -Math.cos(a) * r * BODY_SZ);
  }
  g.computeVertexNormals();
  return g;
}

/** 髖關節在骨盆座標的高度（hdBody 的 joint(pelvis, ±hipHalf, −0.03, 0)） */
const HIP_Y = -0.03;
/** 前裙片的樞紐（骨盆座標：腰帶正前方） */
const FRONT_HINGE = new THREE.Vector3(0, 0.07, -0.135);
/** 前裙片從樞紐到下襬的長度、要和大腿軸保持的距離（短褲半徑＋布片厚度＋餘裕） */
const FRONT_LEN = 0.19;
const THIGH_CLEAR = 0.12;

/**
 * 前裙片被大腿頂起的角度（相對骨盆，往前為正，弧度）。
 * 側面看，大腿是繞髖關節轉的圓柱（半徑 THIGH_CLEAR）；裙片從樞紐往下垂，
 * 要讓下襬落在圓柱外面：s 是樞紐到大腿軸的有號距離，sin(φ − θ) ≥ (ρ − s) / L。
 * @param theta 大腿角度（hip.rotation.x）
 */
function frontPanelAngle(theta: number): number {
  const dy = FRONT_HINGE.y - HIP_Y;
  const dz = FRONT_HINGE.z;
  const s = dy * Math.sin(theta) - dz * Math.cos(theta);
  const need = theta + Math.asin(THREE.MathUtils.clamp((THIGH_CLEAR - s) / FRONT_LEN, -1, 1));
  return Math.max(0.05, need);
}

/**
 * 上衣下襬：腰部以下分成前後兩片短裙片，兩側開衩露出短褲。
 * 後片固定在骨盆上（大腿往後擺的角度很小）；前片從中間（拉鍊下方）分成左右兩半，
 * 各自被同側大腿頂起（被動關節），高抬腿時才不會插進大腿。
 */
function addSkirt(rig: HumanoidRig): void {
  const red = fabricMat(SAKURA_COLORS.top);
  // 腰部內襯：跑步時腰椎前彎，衣身下緣的背面會翹離腰帶環，從縫裡看到的是紅色內襯（不是描邊的黑色背面）
  part(
    rig.pelvis,
    latheBody(
      [
        [0.15, 0.05],
        [0.143, 0.1],
        [0.125, 0.14],
        [0.1, 0.165],
      ],
      BODY_SX,
      BODY_SZ,
      28,
    ),
    red,
  );
  // 後片：蓋住屁股
  part(rig.pelvis, skirtPanel(Math.PI - 0.98, Math.PI + 0.98, 0.06, -0.13, 0.15, 0.19, 0.012), red);
  for (const [hip, side] of [
    [rig.hipL, -1],
    [rig.hipR, 1],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'skirtFrontL' : 'skirtFrontR';
    pivot.position.copy(FRONT_HINGE);
    rig.pelvis.add(pivot);
    const geo = side < 0 ? skirtPanel(-0.86, -0.025, 0.06, -0.115, 0.15, 0.19, 0.012) : skirtPanel(0.025, 0.86, 0.06, -0.115, 0.15, 0.19, 0.012);
    geo.translate(-FRONT_HINGE.x, -FRONT_HINGE.y, -FRONT_HINGE.z);
    part(pivot, geo, red);
    drive(pivot, () => {
      pivot.rotation.x = frontPanelAngle(hip.rotation.x);
    });
  }
}

// ───────────────────────── 頭髮 ─────────────────────────

/** 護額整條繞頭心往上推的角度（弧度）：金屬片推到頭頂前方、結落在後腦下方（頭髮在布帶底下會被壓扁，見 pinchUnderBand） */
const BAND_PITCH = 0.62;
/** addHeadbandHD 內部的布帶尺寸：環半徑 r·1.03、中心高度 r·0.34、半寬 0.041（要和 ninja.ts 一致） */
const BAND_R = R * 1.03;
const BAND_Y = R * 0.34;
const BAND_HALF = 0.041;

/**
 * 頭殼表面某方向往外 lift 公尺的點（套用 Q 版頭型變形，和臉、頭殼一致）。
 * @param yaw 度，0 = 正前方、正值往角色右邊
 * @param yr 高度 ÷ 頭半徑（1 = 頭頂）
 */
function hp(yaw: number, yr: number, lift: number): THREE.Vector3 {
  const y = Math.max(-0.999, Math.min(0.999, yr));
  const c = Math.sqrt(1 - y * y);
  const p = new THREE.Vector3(Math.sin(yaw * DEG) * c, y, -Math.cos(yaw * DEG) * c).multiplyScalar(R + lift);
  shapeHead(p);
  return p;
}

/**
 * 頭部下方垂下來的髮尾位置：方位 yaw、高度 y、離頭部中軸的水平距離 d（左右略寬、後腦略扁，同頭型）。
 */
function hang(yaw: number, y: number, d: number): THREE.Vector3 {
  const z = -Math.cos(yaw * DEG) * d;
  return new THREE.Vector3(Math.sin(yaw * DEG) * d * 1.05, y, z > 0 ? z * 0.96 : z);
}

/** 髮束的選項 */
interface StrandOpts {
  /** 髮根收細的長度比例（0 = 髮根不收，埋在別的髮束下面） */
  rootTaper?: number;
  /** 沿長度的分段數 */
  segs?: number;
  /** 寬面要朝向的方向（長度 = 權重，加到往外的方向上）；鬢髮用來讓寬面朝前，正面看才是一片髮簾 */
  face?: THREE.Vector3;
}

/**
 * 一撮頭髮：沿中心線掃出扁平、兩端收尖的髮束（斷面是外凸內平的扁六角形，寬的方向貼著頭）。
 * 頂點色：髮根暗、髮尾亮，內側再暗一點（像髮束之間的陰影）。
 * @param ctrl 中心線的控制點（髮根 → 髮尾），用 Catmull-Rom 曲線補成平滑的線
 * @param w0 最寬處的半寬
 * @param h0 最厚處的厚度（往外凸的那一側）
 */
function strand(ctrl: THREE.Vector3[], w0: number, h0: number, opts: StrandOpts = {}): THREE.BufferGeometry {
  const { rootTaper = 0.14, segs = 14, face } = opts;
  const radial = 6;
  const pts = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getPoints(segs);
  const n = pts.length;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const tan = new THREE.Vector3();
  const out = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const bin = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = pts[i];
    tan.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
    // 往外的參考方向：頭的上半部從頭心放射，下面垂下來的髮尾改成水平往外；face 讓髮束的寬面轉向指定方向
    out.set(p.x, Math.max(p.y, 0), p.z).normalize();
    if (face) out.add(face).normalize();
    nrm.copy(out).addScaledVector(tan, -out.dot(tan)).normalize();
    bin.crossVectors(tan, nrm);
    // 寬度：髮根收細、中段最寬、髮尾收尖
    const root = rootTaper > 0 ? 0.2 + 0.8 * smooth(0, rootTaper, t) : 1;
    const half = w0 * root * Math.pow(1 - Math.pow(t, 2.2), 0.85);
    const thick = h0 * root * Math.pow(1 - t, 0.45) * (0.75 + 0.25 * Math.sin(Math.PI * t));
    const shade = 0.76 + 0.34 * t;
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const cx = Math.cos(a) * half;
      const cy = s * thick * (s >= 0 ? 1 : 0.3);
      pos.push(p.x + bin.x * cx + nrm.x * cy, p.y + bin.y * cx + nrm.y * cy, p.z + bin.z * cx + nrm.z * cy);
      const cc = shade * (s < -0.1 ? 0.84 : 1);
      col.push(cc, cc, cc);
    }
  }
  // 斷面從 bin 轉向 nrm 是繞 −tan 逆時針，三角形照這個順序排，正面才會朝外
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      idx.push(a, a + radial, b, b, a + radial, b + radial);
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
 * 護額壓住頭髮：換到護額的座標系，靠近布帶高度的頂點往內收到布帶內緣以內（布帶上下保持蓬鬆），
 * 看起來像髮箍壓著頭髮，布帶也不會被比它厚的頭髮吃掉。
 */
function pinchUnderBand(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const toBand = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -BAND_PITCH);
  const fromBand = toBand.clone().invert();
  const v = new THREE.Vector3();
  const ring = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyQuaternion(toBand);
    const w = 1 - smooth(BAND_HALF, BAND_HALF + 0.03, Math.abs(v.y - BAND_Y));
    const rho = Math.hypot(v.x, v.z);
    if (w <= 0 || rho < 1e-6) continue;
    // 布帶內緣：和 addHeadbandHD 一樣，在布帶自己的座標（環的中心高度為 0）套用頭型變形
    ring.set((v.x / rho) * BAND_R, v.y - BAND_Y, (v.z / rho) * BAND_R);
    shapeHead(ring);
    const inner = Math.hypot(ring.x, ring.z) - 0.003;
    if (rho <= inner) continue;
    const k = 1 - (w * (rho - inner)) / rho;
    v.x *= k;
    v.z *= k;
    v.applyQuaternion(fromBand);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 髮際線（頭皮髮蓋的下緣，yr）：正面中分處最高（寬額頭），往兩側降到耳朵上方，耳後再降到後頸 */
const HAIRLINE: [number, number][] = [
  [0, 0.8],
  [12, 0.68],
  [30, 0.5],
  [50, 0.3],
  [66, 0.16],
  [80, 0.13],
  [96, 0.13],
  [104, 0.0],
  [114, -0.3],
  [128, -0.44],
  [180, -0.46],
];

/** 依方位（度）內插髮際線高度 */
function hairlineYr(yaw: number): number {
  const a = Math.abs(((yaw + 540) % 360) - 180);
  for (let i = 0; i < HAIRLINE.length - 1; i++) {
    const [a0, y0] = HAIRLINE[i];
    const [a1, y1] = HAIRLINE[i + 1];
    if (a <= a1) return y0 + (y1 - y0) * smooth(a0, a1, a);
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

/** 頭皮髮蓋：蓋住頭頂、後腦與兩側（前面留出寬額頭），頭頂較厚；髮束之間的縫隙看到的是較暗的頭髮 */
function scalpGeometry(): THREE.BufferGeometry {
  const NU = 48;
  const NV = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= NV; j++) {
    for (let i = 0; i <= NU; i++) {
      const yaw = -180 + (360 * i) / NU;
      const yr = 1 - (1 - hairlineYr(yaw)) * (j / NV);
      const p = hp(yaw, yr, 0.004 + 0.012 * Math.max(0, yr) ** 2);
      pos.push(p.x, p.y, p.z);
    }
  }
  const W = NU + 1;
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * W + i;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return withWhiteColors(g, 0.72);
}

/** 下層後髮的樞紐（頭部座標：後頸的髮根處）；跑步抬頭時繞這裡往後掀，躺在上背上面而不是插進背裡 */
const NAPE_HINGE = new THREE.Vector3(0, -0.1, 0.22);
/** 下層後髮往後掀的角度 = 脖子後仰角 × 這個比例 */
const NAPE_LIFT = 0.6;

/**
 * 粉紅鮑伯頭：
 * - 頭皮髮蓋＋從頭頂往下梳的髮束（耳朵上方的停在耳朵上緣、耳後兩側垂到肩膀上緣、後腦的蓋住下層後髮的髮根）。
 * - 中分瀏海：左右各四撮，從分線往兩側彎到眉毛上方，中間露出寬額頭。
 * - 鬢髮：耳朵前面各兩撮長髮，垂到下巴下方（在肩膀前面，不碰肩膀）。
 * - 下層後髮：後頸垂到肩膀高度，掛在被動關節上（跑步抬頭時往後掀）。
 * 所有髮束都經過 pinchUnderBand：護額布帶底下的頭髮被壓扁。
 */
function addHair(rig: HumanoidRig): void {
  const mat = hairMat(SAKURA_COLORS.hair);
  const add = (geo: THREE.BufferGeometry) => rig.head.add(new THREE.Mesh(pinchUnderBand(geo), mat));
  add(scalpGeometry());
  for (const sd of [-1, 1]) {
    // 中分瀏海：[髮根, 中段（鼓起）, 髮尾]（各為 yaw、yr、lift）、半寬、厚度
    const bangs: [[number, number, number][], number, number][] = [
      [[[4, 0.86, 0.006], [8, 0.62, 0.026], [16, 0.27, 0.016]], 0.034, 0.022],
      [[[12, 0.88, 0.006], [20, 0.6, 0.032], [30, 0.19, 0.016]], 0.038, 0.024],
      [[[22, 0.88, 0.006], [33, 0.55, 0.034], [43, 0.11, 0.016]], 0.04, 0.024],
      [[[33, 0.85, 0.006], [46, 0.47, 0.034], [55, 0.05, 0.018]], 0.04, 0.024],
    ];
    for (const [ctrl, w, h] of bangs) add(strand(ctrl.map(([yaw, yr, lift]) => hp(sd * yaw, yr, lift)), w, h, { segs: 12 }));
    // 鬢髮（耳朵前面）：主撮垂到下巴下方、後面一撮短一點；寬面朝前，正面看是框住臉的髮簾
    add(
      strand(
        [hp(sd * 38, 0.84, 0.006), hp(sd * 50, 0.5, 0.03), hp(sd * 58, 0.05, 0.034), hp(sd * 60, -0.42, 0.03), hang(sd * 59, -0.31, 0.22)],
        0.044,
        0.026,
        { rootTaper: 0.12, segs: 18, face: new THREE.Vector3(0, 0, -0.9) },
      ),
    );
    add(
      strand([hp(sd * 52, 0.82, 0.006), hp(sd * 64, 0.45, 0.03), hp(sd * 70, 0.02, 0.034), hang(sd * 68, -0.21, 0.24)], 0.04, 0.024, {
        rootTaper: 0.12,
        segs: 16,
        face: new THREE.Vector3(0, 0, -0.6),
      }),
    );
    // 耳朵上方：停在耳朵上緣（被布帶壓住）
    for (const yaw of [64, 78, 92]) {
      add(strand([hp(sd * yaw, 0.97, 0.012), hp(sd * yaw, 0.7, 0.024), hp(sd * yaw, 0.4, 0.032), hp(sd * (yaw + 3), 0.14, 0.034)], 0.05, 0.024, { segs: 12 }));
    }
    // 耳後兩側：垂到肩膀上緣（再長會碰到肩膀與往後拖的手臂）
    for (const yaw of [106, 120, 134]) {
      add(
        strand(
          [hp(sd * yaw, 0.97, 0.012), hp(sd * yaw, 0.7, 0.024), hp(sd * yaw, 0.3, 0.038), hp(sd * yaw, -0.1, 0.048), hang(sd * yaw, -0.2, 0.292)],
          0.052,
          0.026,
        ),
      );
    }
    // 後腦：蓋住下層後髮的髮根
    for (const yaw of [148, 162, 176]) {
      add(
        strand(
          [hp(sd * yaw, 0.97, 0.012), hp(sd * yaw, 0.7, 0.024), hp(sd * yaw, 0.3, 0.036), hp(sd * yaw, -0.1, 0.044), hang(sd * yaw, -0.155, 0.285)],
          0.052,
          0.026,
        ),
      );
    }
  }
  // 下層後髮：掛在後頸的被動關節上，後面正中央最長（垂到肩膀高度）
  const nape = new THREE.Group();
  nape.name = 'hairNape';
  nape.position.copy(NAPE_HINGE);
  rig.head.add(nape);
  for (const yaw of [-142, -154, -166, 180, 166, 154, 142]) {
    const tip = -0.25 - 0.035 * smooth(142, 175, Math.abs(yaw));
    const geo = pinchUnderBand(
      strand([hp(yaw, -0.4, 0.014), hang(yaw, -0.16, 0.272), hang(yaw, -0.23, 0.268), hang(yaw, tip, 0.255)], 0.052, 0.024, { rootTaper: 0, segs: 12 }),
    );
    geo.translate(-NAPE_HINGE.x, -NAPE_HINGE.y, -NAPE_HINGE.z);
    part(nape, geo, mat);
  }
  drive(nape, () => {
    nape.rotation.x = -NAPE_LIFT * Math.max(0, rig.neck.rotation.x);
  });
}

/**
 * 建立小櫻（高精細版）。回傳的 rig 由 anim.ts 驅動動作（和主角共用忍者跑）。
 * @param outline 描邊粗細（0 = 不描邊）
 */
export function buildSakura(outline = 0.007): HumanoidRig {
  const c = SAKURA_COLORS;
  const tex = textures();
  const rig = buildHumanoidHD({
    skin: c.skin,
    jacket: c.top,
    jacketMap: tex.jacket,
    collar: c.top,
    cuffs: c.top,
    sleeve: c.top,
    pants: c.pants,
    wraps: NINJA_COLORS.sandal,
    sandal: NINJA_COLORS.sandal,
    sole: NINJA_COLORS.sole,
    zipper: true,
    bareArms: 'full',
    wristCuffs: false,
  });
  // 旗袍式上衣沒有口袋蓋
  const pocket = fabricMat(darken(c.top, 0.82));
  removeMeshes(rig.spine, (m) => m.material === pocket);
  buildLegs(rig);
  addSkirt(rig);
  addHead3D(rig, {
    skin: c.skin,
    iris: c.iris,
    brow: c.brow,
    eyes: 'doe',
    brows: 'arch',
    mouth: 'smile',
    blush: true,
  });
  addHair(rig);
  // 護額當髮箍：整條往上推到頭頂（金屬片在頭頂前方、結在後腦下方）
  addHeadbandHD(rig, NINJA_COLORS.band, true, { pitch: BAND_PITCH });
  finalizeRig(rig, outline);
  return rig;
}
