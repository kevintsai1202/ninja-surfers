import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMS, type HumanoidRig } from './rig';
import { buildHumanoidHD, finalizeRig, addVestHD } from './hdBody';
import { addHeadHD, addHeadbandHD } from './ninja';
import { hairMat, metalMat, fabricMat, skinMat } from './charMats';
import { hairLock, placeLock, withWhiteColors, shapeHeadGeometry, ribbonChain } from './shapes';
import { faceTextureHD, anbuMaskHD } from './faceHD';

/**
 * 追捕者：伊魯卡老師（中忍背心、棕色馬尾、鼻樑疤）與暗部（白色面具、胸甲、背刀）。
 * 都用高精細身體，關節階層與主角相同，可以共用動畫器。
 */

/** 頭頂髮蓋＋後腦髮蓋（給不同髮型共用） */
function hairCaps(rig: HumanoidRig, mat: THREE.Material, shade = 0.85): void {
  const r = DIMS.headR;
  const cap = new THREE.SphereGeometry(r * 1.06, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.42);
  rig.head.add(new THREE.Mesh(withWhiteColors(shapeHeadGeometry(cap), shade), mat));
  const back = new THREE.SphereGeometry(r * 1.05, 24, 12, 0, Math.PI, Math.PI * 0.25, Math.PI * 0.55);
  rig.head.add(new THREE.Mesh(withWhiteColors(shapeHeadGeometry(back), shade * 0.95), mat));
}

/**
 * 伊魯卡老師：棕髮在頭頂後方綁成翹起的馬尾、鼻樑橫疤、生氣大叫的表情、
 * 深藍上衣與褲子、綠色中忍背心、白色綁腿。
 */
export function buildIruka(outline = 0.007): HumanoidRig {
  const navy = 0x27365a;
  const rig = buildHumanoidHD({
    skin: 0xe8b68c,
    jacket: navy,
    cuffs: navy,
    sleeve: navy,
    pants: navy,
    wraps: 0xeeeae0,
    sandal: 0x2c3a5c,
    sole: 0x1b2236,
  });
  addVestHD(rig, 0x5f7f3d, 'vest');
  // 袖子上的紅色漩渦袖章
  for (const sh of [rig.shoulderL, rig.shoulderR]) {
    const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16), fabricMat(0xc8352a));
    patch.rotation.z = Math.PI / 2;
    patch.position.set(sh === rig.shoulderR ? 0.078 : -0.078, -0.06, 0);
    patch.userData.noOutline = true;
    sh.add(patch);
  }
  addHeadHD(
    rig,
    0xe8b68c,
    faceTextureHD({ iris: '#6b4226', brow: '#3a2414', noseScar: true, mouth: 'shout', browShape: 'angry' }),
  );
  const hair = hairMat(0x4b2e1b);
  hairCaps(rig, hair);
  // 短瀏海與鬢角
  const r = DIMS.headR;
  for (const [d, len, rad, bend] of [
    [[0.3, 0.7, -0.65], 0.13, 0.06, 0.4],
    [[-0.3, 0.7, -0.65], 0.13, 0.06, 0.4],
    [[0.85, 0.2, -0.3], 0.12, 0.05, 0.2],
    [[-0.85, 0.2, -0.3], 0.12, 0.05, 0.2],
  ] as [[number, number, number], number, number, number][]) {
    const m = new THREE.Mesh(hairLock(len, rad, bend), hair);
    placeLock(m, new THREE.Vector3(...d), r * 0.9);
    rig.head.add(m);
  }
  // 馬尾：綁在頭頂後方，幾撮往上再往後翹（會隨風擺動）
  const tie = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), fabricMat(0x3a2a1c));
  tie.position.set(0, r * 0.78, r * 0.55);
  rig.head.add(tie);
  const tail = new THREE.Group();
  tail.position.set(0, r * 0.82, r * 0.6);
  rig.head.add(tail);
  for (const [d, len] of [
    [[0, 1, 0.5], 0.24],
    [[0.35, 0.85, 0.6], 0.2],
    [[-0.35, 0.85, 0.6], 0.2],
    [[0.15, 0.6, 1], 0.22],
    [[-0.15, 0.6, 1], 0.22],
  ] as [[number, number, number], number][]) {
    const m = new THREE.Mesh(hairLock(len, 0.055, 0.5), hair);
    placeLock(m, new THREE.Vector3(...d), 0.01);
    tail.add(m);
  }
  tail.userData.side = 0;
  tail.userData.baseX = 0.2;
  rig.flaps.push(tail);
  addHeadbandHD(rig, 0x283252, false);
  finalizeRig(rig, outline);
  return rig;
}

/**
 * 暗部：白色動物面具（紅色紋）、往一側傾的銀灰色刺蝟頭、深灰衣服、
 * 銀灰胸甲與護臂、深色手套、背上斜背一把短刀。
 */
export function buildAnbu(outline = 0.007): HumanoidRig {
  const dark = 0x2a2c34;
  const rig = buildHumanoidHD({
    skin: 0xf2d5bb,
    jacket: dark,
    cuffs: 0x1d1e24,
    sleeve: dark,
    pants: dark,
    wraps: 0x1d1e24,
    sandal: 0x22242c,
    sole: 0x15161a,
    gloves: 0x1c1d22,
  });
  addVestHD(rig, 0xc6cad1, 'armor');
  const guard = metalMat(0xb9bec6);
  // 護臂與肩甲
  for (const [el, sh] of [
    [rig.elbowL, rig.shoulderL],
    [rig.elbowR, rig.shoulderR],
  ] as const) {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.13, 16, 1, true), guard);
    g.position.y = -0.09;
    el.add(g);
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.05, 0.14, 2, 0.02), guard);
    pad.position.set(sh === rig.shoulderR ? 0.03 : -0.03, 0.06, 0);
    sh.add(pad);
  }
  addHeadHD(rig, 0xf2d5bb, anbuMaskHD());
  const hair = hairMat(0xc7cbd6);
  hairCaps(rig, hair, 0.9);
  // 往右上方傾的刺蝟頭
  const r = DIMS.headR;
  for (const [d, len, rad] of [
    [[0.3, 1, 0.1], 0.3, 0.09],
    [[0.55, 0.85, 0.2], 0.3, 0.085],
    [[0.1, 0.95, 0.4], 0.27, 0.085],
    [[0.7, 0.6, 0.35], 0.26, 0.08],
    [[-0.2, 0.9, 0.3], 0.22, 0.08],
    [[0.2, 0.7, 0.75], 0.24, 0.08],
    [[-0.4, 0.6, 0.65], 0.2, 0.07],
    [[0.45, 0.75, -0.45], 0.2, 0.07],
    [[0.0, 0.8, -0.55], 0.18, 0.065],
  ] as [[number, number, number], number, number][]) {
    const m = new THREE.Mesh(hairLock(len, rad, 0.3), hair);
    placeLock(m, new THREE.Vector3(...d), r * 0.86, new THREE.Vector3(0.6, -0.1, 0.8));
    rig.head.add(m);
  }
  addHeadbandHD(rig, 0x1d1e24, false);
  // 背上斜背的短刀（刀柄在右肩後方）
  const sword = new THREE.Group();
  sword.position.set(0.02, 0.08, 0.17);
  sword.rotation.z = -0.75;
  const sheath = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.5, 0.03, 2, 0.012), skinMat(0x3a1d1d));
  sheath.position.y = -0.05;
  sword.add(sheath);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), fabricMat(0x1b1b1f));
  handle.position.y = 0.28;
  sword.add(handle);
  const guardDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12), metalMat(0x9aa0a8));
  guardDisc.position.y = 0.2;
  sword.add(guardDisc);
  rig.chest.add(sword);
  // 暗部的布條（後腦）
  const band = fabricMat(0x1d1e24);
  const flap = ribbonChain(rig.head, [0, r * 0.3, r * 1.0], 3, 0.06, 0.05, 0.012, band, 0.9);
  flap.userData.side = 0;
  flap.userData.baseX = 0.7;
  rig.flaps.push(flap);
  // 讓 sword 內的網格也能合併：搬到 chest 節點底下
  sword.updateMatrix();
  for (const m of [...sword.children]) {
    m.applyMatrix4(sword.matrix);
    rig.chest.add(m);
  }
  rig.chest.remove(sword);
  finalizeRig(rig, outline);
  return rig;
}
