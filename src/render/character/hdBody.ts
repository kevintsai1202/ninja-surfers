import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, SPIN_Y, type HumanoidRig } from './rig';
import { fabricMat, skinMat, metalMat, rubberMat } from './charMats';
import { latheBody, taperedLimb, ringBand, tubeAlong } from './shapes';
import { outlineMat } from '../toon';
import { stdMat } from '../materials';

/**
 * 高精細人形角色（地鐵跑酷等級）：關節階層與 rig.ts 完全相同（DIMS、關節位置不變，動畫不用重調），
 * 只把身體網格換成有版型的衣服、手指、涼鞋等細節，材質用風格化 PBR。
 * 參考：docs/concept/ninja-sheet-a.jpg、ninja-sheet-b.jpg。
 */

/** 高精細身體的配色與選項 */
export interface HDBodySpec {
  skin: number;
  /** 上衣主色 */
  jacket: number;
  /** 腰部上衣（背部中段）的自訂顏色貼圖（畫了背後紋章；uv 的 u = 0.5 是背後正中央） */
  jacketMap?: THREE.Texture;
  /** 披肩（肩膀與上胸）顏色；undefined = 不加披肩 */
  yoke?: number;
  /** 高領顏色；undefined = 不加高領 */
  collar?: number;
  /** 袖口與腰帶顏色 */
  cuffs: number;
  /** 袖子顏色與自訂貼圖（例如外側條紋；u = 0.25 是右手外側） */
  sleeve: number;
  sleeveMap?: THREE.Texture;
  pants: number;
  /** 小腿綁腿顏色 */
  wraps: number;
  sandal: number;
  sole: number;
  /** 前面有拉鍊（含環形拉鍊頭） */
  zipper?: boolean;
  /** 手套顏色（不給就是皮膚） */
  gloves?: number;
  /** 露出手臂：forearm＝短袖（手肘以下是皮膚）、full＝無袖（整隻手臂是皮膚）；不給＝長袖 */
  bareArms?: 'forearm' | 'full';
  /** 手腕的袖口環（預設有；無袖、短袖的角色通常不要） */
  wristCuffs?: boolean;
  /** 描邊粗細（0 = 不描邊） */
  outline?: number;
}

/** 下半身衣身的輪廓（[半徑, 高度]），從骨盆往上 */
const BELLY_PROFILE: [number, number][] = [
  [0.15, 0],
  [0.162, 0.05],
  [0.17, 0.12],
  [0.174, 0.19],
  [0.176, 0.27],
];
/** 上半身衣身的輪廓（胸樞紐為 0） */
const CHEST_PROFILE: [number, number][] = [
  [0.176, -0.035],
  [0.182, 0.03],
  [0.18, 0.09],
  [0.165, 0.15],
  [0.13, 0.195],
  [0.08, 0.215],
];
/** 衣身的 x／z 縮放（寬、扁） */
const BODY_SX = 1.13;
const BODY_SZ = 0.86;

/** 在 parent 底下建立關節節點 */
function joint(parent: THREE.Object3D, x: number, y: number, z: number, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** 建立網格並掛到 parent（位置、旋轉可選） */
function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos?: [number, number, number],
  rot?: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}

/** 依輪廓內插某個高度的半徑（拉鍊要貼著衣身正面） */
function radiusAt(profile: [number, number][], y: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return y < profile[0][1] ? profile[0][0] : profile[profile.length - 1][0];
}

/** 沿衣身正面中線的拉鍊（細管） */
function zipperAlong(profile: [number, number][], y0: number, y1: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const y = y0 + ((y1 - y0) * i) / 8;
    pts.push(new THREE.Vector3(0, y, -radiusAt(profile, y) * BODY_SZ - 0.004));
  }
  return tubeAlong(pts, 0.0065, 16);
}

/**
 * 建立高精細人形角色（不含頭部；頭部由各角色自己加在 rig.head）。
 * 回傳的 rig 還沒合併網格，加完頭部之後要呼叫 finalizeRig。
 */
export function buildHumanoidHD(spec: HDBodySpec): HumanoidRig {
  const D = DIMS;
  const root = new THREE.Group();
  root.name = 'humanoidHD';
  const spin = joint(root, 0, SPIN_Y, 0, 'spin');
  const body = joint(spin, 0, D.hip - SPIN_Y, 0, 'body');
  const pelvis = joint(body, 0, 0, 0, 'pelvis');

  const jacket = fabricMat(spec.jacket);
  const pants = fabricMat(spec.pants);
  const cuffs = fabricMat(spec.cuffs);
  const sleeve = fabricMat(spec.sleeve, spec.sleeveMap);
  // 肩頭、手肘的圓球：球面的 uv 和圓柱不同，有條紋貼圖時改用素色上衣，避免條紋跑到背面
  const sleeveBall = spec.sleeveMap ? fabricMat(spec.jacket) : sleeve;
  const wraps = fabricMat(spec.wraps);
  const skin = skinMat(spec.skin);
  const hands = spec.gloves !== undefined ? fabricMat(spec.gloves) : skin;
  const sandal = rubberMat(spec.sandal);
  const sole = rubberMat(spec.sole);
  const zipMat = metalMat(0xb9c0c6);

  // ── 骨盆：褲子臀部＋夾克下擺的羅紋腰帶 ──
  const seat = new THREE.SphereGeometry(0.155, 22, 14);
  seat.scale(1.1, 0.7, 0.8);
  part(pelvis, seat, pants, [0, -0.03, 0.012]);
  const band = ringBand(0.148, 0.062, 0.022);
  band.scale(BODY_SX, 1, BODY_SZ);
  part(pelvis, band, cuffs, [0, 0.055, 0]);

  // ── 腿：髖 → 膝 → 踝 ──
  const legs: THREE.Group[][] = [];
  for (const side of [-1, 1]) {
    const hip = joint(pelvis, side * D.hipHalf, -0.03, 0, side < 0 ? 'hipL' : 'hipR');
    part(hip, new THREE.SphereGeometry(0.1, 16, 10), pants);
    part(hip, taperedLimb(0.1, 0.083, D.thigh * 0.95), pants);
    if (side > 0) {
      // 右大腿：白色繃帶、深藍忍具袋（外側）、露出兩支苦無柄
      part(hip, ringBand(0.094, 0.07, 0.012), fabricMat(0xf1ece0), [0, -0.15, 0]);
      part(hip, ringBand(0.09, 0.03, 0.01), fabricMat(0xf1ece0), [0, -0.205, 0]);
      const holster = new RoundedBoxGeometry(0.042, 0.13, 0.088, 3, 0.016);
      part(hip, holster, rubberMat(0x262c45), [0.102, -0.175, 0.004]);
      part(hip, ringBand(0.097, 0.022, 0.008), rubberMat(0x262c45), [0, -0.135, 0]);
      for (const dz of [-0.022, 0.018]) {
        part(hip, new THREE.CylinderGeometry(0.0065, 0.0065, 0.07, 8), metalMat(0x3d4148), [0.102, -0.085, dz]);
        part(hip, new THREE.TorusGeometry(0.012, 0.0035, 6, 12), metalMat(0x3d4148), [0.102, -0.042, dz], [0, Math.PI / 2, 0]);
      }
    }
    const knee = joint(hip, 0, -D.thigh, 0, side < 0 ? 'kneeL' : 'kneeR');
    part(knee, new THREE.SphereGeometry(0.083, 14, 10), pants);
    part(knee, taperedLimb(0.083, 0.076, D.shin * 0.68), pants);
    // 褲口收束（蓬起的一圈）＋深藍綁腿
    part(knee, ringBand(0.068, 0.05, 0.022), pants, [0, -D.shin * 0.68, 0]);
    part(knee, taperedLimb(0.054, 0.049, D.shin * 0.34), wraps, [0, -D.shin * 0.68, 0]);
    const ankle = joint(knee, 0, -D.shin, 0, side < 0 ? 'ankleL' : 'ankleR');
    // 涼鞋：鞋底、腳背帶、後跟，露出腳掌與腳趾
    part(ankle, new RoundedBoxGeometry(0.115, 0.03, 0.25, 2, 0.012), sole, [0, -0.07, -0.05]);
    part(ankle, new RoundedBoxGeometry(0.092, 0.05, 0.19, 2, 0.022), skin, [0, -0.033, -0.058]);
    part(ankle, new RoundedBoxGeometry(0.106, 0.034, 0.07, 2, 0.014), sandal, [0, -0.012, -0.085]);
    part(ankle, new RoundedBoxGeometry(0.106, 0.075, 0.075, 2, 0.022), sandal, [0, -0.02, 0.03]);
    const toeR = [0.021, 0.017, 0.016, 0.015, 0.013];
    const toeX = [-0.031, -0.01, 0.008, 0.024, 0.038];
    for (let i = 0; i < 5; i++) {
      // 大拇趾在內側（靠身體中線）：右腳內側是 −x
      part(ankle, new THREE.SphereGeometry(toeR[i], 8, 6), skin, [side * toeX[i], -0.042, -0.152 + i * 0.006]);
    }
    legs.push([hip, knee, ankle]);
  }

  // ── 上身：腰椎（前傾）→ 胸 ──
  const spine = joint(pelvis, 0, 0.04, 0, 'spine');
  // 背後紋章畫在腰部衣身（跑步時上身前傾，背部中段正對追尾鏡頭）
  part(spine, latheBody(BELLY_PROFILE, BODY_SX, BODY_SZ), spec.jacketMap ? fabricMat(0xffffff, spec.jacketMap) : jacket);
  // 斜插口袋蓋（左右對稱，貼在前面）
  const pocketMat = fabricMat(darken(spec.jacket, 0.82));
  for (const side of [-1, 1]) {
    part(spine, new RoundedBoxGeometry(0.075, 0.014, 0.018, 2, 0.006), pocketMat, [side * 0.088, 0.085, -0.132], [
      0,
      side * 0.45,
      side * -0.38,
    ]);
  }
  const chest = joint(spine, 0, D.spine, 0, 'chest');
  part(chest, latheBody(CHEST_PROFILE, BODY_SX, BODY_SZ), jacket);
  if (spec.yoke !== undefined) {
    // 披肩：比衣身大一點點的旋轉曲面，下緣有一圈厚度
    const yokeProfile: [number, number][] = [
      [0.176, 0.078],
      [0.1845, 0.082],
      [0.1835, 0.097],
      [0.169, 0.153],
      [0.134, 0.198],
      [0.083, 0.219],
    ];
    part(chest, latheBody(yokeProfile, BODY_SX, BODY_SZ), fabricMat(spec.yoke));
  }
  if (spec.collar !== undefined) {
    // 高領：有厚度的環，前面開一個口（拉鍊位置）
    // 高領：從披肩頂端往上外翻，要露在下巴下方（頭部下緣約在胸樞紐 0.2 處）
    const collarProfile: [number, number][] = [
      [0.08, 0.17],
      [0.1, 0.175],
      [0.118, 0.235],
      [0.114, 0.25],
      [0.104, 0.246],
      [0.086, 0.185],
      [0.08, 0.17],
    ];
    part(chest, latheBody(collarProfile, 1.08, 1, 28, Math.PI + 0.3, Math.PI * 2 - 0.6), fabricMat(spec.collar));
  }
  if (spec.zipper) {
    part(spine, zipperAlong(BELLY_PROFILE, 0.0, 0.27), zipMat);
    part(chest, zipperAlong(CHEST_PROFILE, -0.035, 0.19), zipMat);
    // 環形拉鍊頭
    const zTop = -radiusAt(CHEST_PROFILE, 0.17) * BODY_SZ - 0.016;
    part(chest, new RoundedBoxGeometry(0.012, 0.03, 0.006, 1, 0.003), zipMat, [0, 0.165, zTop + 0.006]);
    part(chest, new THREE.TorusGeometry(0.018, 0.0048, 8, 18), zipMat, [0, 0.135, zTop]);
  }

  // ── 手臂：肩 → 肘 → 腕 ──
  const arms: THREE.Group[][] = [];
  for (const side of [-1, 1]) {
    const sh = joint(chest, side * D.shoulderHalf, D.chest - 0.035, 0, side < 0 ? 'shoulderL' : 'shoulderR');
    // 袖子貼圖的外側條紋在 u = 0.25（+x）；左手轉半圈讓條紋也在外側
    const rotY = side > 0 ? 0 : Math.PI;
    // 露手臂：無袖整隻是皮膚、短袖手肘以下是皮膚
    const bareUpper = spec.bareArms === 'full';
    const bareLower = spec.bareArms !== undefined;
    part(sh, new THREE.SphereGeometry(0.084, 16, 10), bareUpper ? skin : sleeveBall);
    part(sh, taperedLimb(0.08, 0.066, D.upperArm, rotY), bareUpper ? skin : sleeve);
    const el = joint(sh, 0, -D.upperArm, 0, side < 0 ? 'elbowL' : 'elbowR');
    part(el, new THREE.SphereGeometry(0.066, 12, 8), bareLower ? skin : sleeveBall);
    part(el, taperedLimb(0.066, 0.058, D.forearm * 0.82, rotY), bareLower ? skin : sleeve);
    if (spec.wristCuffs !== false) part(el, ringBand(0.054, 0.052, 0.017), cuffs, [0, -D.forearm * 0.86, 0]);
    const hand = joint(el, 0, -D.forearm, 0, side < 0 ? 'handL' : 'handR');
    // 手掌（掌心朝內）＋四指＋拇指（在前方）
    part(hand, new THREE.CylinderGeometry(0.034, 0.036, 0.03, 12), hands, [0, -0.005, 0]);
    part(hand, new RoundedBoxGeometry(0.046, 0.088, 0.08, 3, 0.02), hands, [0, -0.052, 0]);
    for (let i = 0; i < 4; i++) {
      const len = [0.044, 0.05, 0.047, 0.04][i];
      part(hand, new THREE.CapsuleGeometry(0.0118, len, 4, 8), hands, [side * -0.004, -0.108 - len * 0.35, -0.028 + i * 0.0185], [
        0,
        0,
        side * 0.08,
      ]);
    }
    part(hand, new THREE.CapsuleGeometry(0.0135, 0.038, 4, 8), hands, [side * -0.016, -0.04, -0.048], [-0.6, 0, side * 0.35]);
    arms.push([sh, el, hand]);
  }

  // ── 脖子與頭的樞紐 ──
  const neck = joint(chest, 0, D.chest, 0, 'neck');
  part(neck, new THREE.CylinderGeometry(0.055, 0.06, 0.1, 14), skin, [0, 0.03, 0]);
  const head = joint(neck, 0, D.neck + D.headR * 0.82, 0, 'head');

  return {
    root,
    spin,
    body,
    pelvis,
    spine,
    chest,
    neck,
    head,
    shoulderL: arms[0][0],
    elbowL: arms[0][1],
    handL: arms[0][2],
    shoulderR: arms[1][0],
    elbowR: arms[1][1],
    handR: arms[1][2],
    hipL: legs[0][0],
    kneeL: legs[0][1],
    ankleL: legs[0][2],
    hipR: legs[1][0],
    kneeR: legs[1][1],
    ankleR: legs[1][2],
    flaps: [],
  };
}

/** 顏色變暗（k < 1） */
export function darken(color: number, k: number): number {
  const r = Math.round(((color >> 16) & 255) * k);
  const g = Math.round(((color >> 8) & 255) * k);
  const b = Math.round((color & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * 把幾何正規化成可合併的形式：套用矩陣、轉非索引、只留 position／normal／uv（必要時保留 color）。
 */
function normalizeForMerge(src: THREE.BufferGeometry, matrix: THREE.Matrix4, keepColor: boolean): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'uv') continue;
    if (name === 'color' && keepColor) continue;
    g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.clearGroups();
  g.applyMatrix4(matrix);
  return g;
}

/**
 * 角色完成：每個關節底下「直接掛著的網格」依材質合併（大幅減少 draw call），
 * 並幫每個關節加一個合併後的描邊網格（反向外殼）。
 * userData.noOutline 的網格（臉部貼圖、細緞帶）不描邊；userData.noMerge 的網格不合併。
 */
export function finalizeRig(rig: HumanoidRig, outline = 0.007): void {
  const joints: THREE.Object3D[] = [];
  rig.root.traverse((o) => {
    if ((o as THREE.Group).isGroup) joints.push(o);
  });
  for (const j of joints) {
    const meshes = j.children.filter((c) => (c as THREE.Mesh).isMesh && !c.userData.noMerge) as THREE.Mesh[];
    if (meshes.length === 0) continue;
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const m of meshes) {
      const mat = m.material as THREE.Material;
      const list = byMat.get(mat) ?? [];
      list.push(m);
      byMat.set(mat, list);
    }
    const outlineGeos: THREE.BufferGeometry[] = [];
    for (const [mat, list] of byMat) {
      const keepColor = (mat as THREE.MeshStandardMaterial).vertexColors === true;
      const geos = list.map((m) => {
        m.updateMatrix();
        return normalizeForMerge(m.geometry, m.matrix, keepColor);
      });
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) throw new Error(`finalizeRig：關節 ${j.name} 的材質合併失敗`);
      // 描邊用的幾何要在移除原網格之前算好
      const forOutline = list.filter((m) => !m.userData.noOutline);
      if (forOutline.length === list.length) outlineGeos.push(merged);
      else outlineGeos.push(...forOutline.map((m) => normalizeForMerge(m.geometry, m.matrix, false)));
      for (const m of list) {
        j.remove(m);
        m.geometry.dispose();
      }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !(mat as THREE.Material).transparent;
      mesh.name = `${j.name}-part`;
      j.add(mesh);
    }
    if (outline > 0 && outlineGeos.length > 0) {
      const plain = outlineGeos.map((g) => {
        const c = g.clone();
        if (c.attributes.color) c.deleteAttribute('color');
        return c;
      });
      const og = plain.length === 1 ? plain[0] : mergeGeometries(plain, false);
      if (og) {
        const o = new THREE.Mesh(og, outlineMat(outline, 0x24170f));
        o.name = `${j.name}-outline`;
        j.add(o);
      }
    }
  }
}

/**
 * 中忍背心（伊魯卡老師）或暗部胸甲：比衣身大一圈的旋轉曲面，蓋住腰部與胸部，
 * 胸前有兩排卷軸袋（vest）或分塊的護甲（armor）。
 * @param color 背心／護甲顏色
 * @param style vest＝中忍背心（高領、卷軸袋）、armor＝暗部胸甲（金屬感、分塊）
 */
export function addVestHD(rig: HumanoidRig, color: number, style: 'vest' | 'armor'): void {
  const pad = style === 'vest' ? 0.022 : 0.016;
  // 胸甲用自己的材質（不能改到共用快取的金屬材質）
  const mat = style === 'vest' ? fabricMat(color) : stdMat({ color, metalness: 0.35, roughness: 0.45 }, `armor|${color}`);
  const belly = BELLY_PROFILE.map(([r, y]) => [r + pad, y] as [number, number]).filter(([, y]) => y >= (style === 'vest' ? 0.02 : 0.1));
  const chest = CHEST_PROFILE.map(([r, y]) => [r + pad, y] as [number, number]).filter(([, y]) => y <= 0.2);
  if (style === 'vest') part(rig.spine, latheBody(belly, BODY_SX, BODY_SZ), mat);
  part(rig.chest, latheBody(chest, BODY_SX, BODY_SZ), mat);
  if (style === 'vest') {
    // 背心高領（往外翻）
    const collar: [number, number][] = [
      [0.085, 0.16],
      [0.11, 0.165],
      [0.13, 0.225],
      [0.125, 0.24],
      [0.112, 0.235],
      [0.092, 0.175],
      [0.085, 0.16],
    ];
    part(rig.chest, latheBody(collar, 1.12, 1, 28, Math.PI + 0.35, Math.PI * 2 - 0.7), mat);
    // 胸前兩排卷軸袋
    const pouch = fabricMat(darken(color, 0.85));
    for (const side of [-1, 1]) {
      for (const [y, part2] of [
        [0.02, rig.chest],
        [0.12, rig.spine],
      ] as const) {
        const r = radiusAt(part2 === rig.chest ? CHEST_PROFILE : BELLY_PROFILE, y) + pad;
        part(part2, new RoundedBoxGeometry(0.075, 0.07, 0.04, 2, 0.012), pouch, [side * 0.075, y, -r * BODY_SZ * 0.92], [0, side * 0.35, 0]);
      }
    }
  } else {
    // 胸甲分塊的橫向凹槽
    const groove = metalMat(darken(color, 0.6));
    for (const y of [0.0, 0.07]) {
      const r = radiusAt(CHEST_PROFILE, y) + pad + 0.002;
      part(rig.chest, ringBand(r, 0.012, 0.004), groove, [0, y, 0]).scale.set(BODY_SX, 1, BODY_SZ);
    }
  }
}
