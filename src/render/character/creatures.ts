import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fabricMat, skinMat, metalMat, rubberMat } from './charMats';
import { stdMat } from '../materials';
import { mergeByMaterial } from '../merge';
import { outlineMat } from '../toon';

/**
 * 忍犬（追捕者的搭檔）與巨蛤蟆（通靈術坐騎）：四足或特殊體型，各自有簡單的程式動畫。
 */

/** 幫一個群組底下的每個網格加描邊（共用幾何、反向外殼） */
function outlineAll(root: THREE.Object3D, thickness: number): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.noOutline) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const o = new THREE.Mesh(m.geometry, outlineMat(thickness, 0x24170f));
    o.userData.noOutline = true;
    m.add(o);
    m.castShadow = true;
  }
}

/** 建立網格的小工具 */
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  return m;
}

/** 忍犬的關節 */
export interface DogRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  /** 前左、前右、後左、後右 */
  legs: THREE.Group[];
  tail: THREE.Group;
}

/**
 * 忍犬：小巴哥犬，土黃色短毛、深色口鼻與垂耳、藍色背心、頭上戴小護額。約 0.5 m 高。
 */
export function buildDog(): DogRig {
  const fur = skinMat(0xc3925b);
  const dark = skinMat(0x4a3324);
  const vest = fabricMat(0x2c4f93);
  const root = new THREE.Group();
  root.name = 'dog';
  const body = new THREE.Group();
  body.position.y = 0.3;
  root.add(body);
  body.add(mesh(new THREE.SphereGeometry(0.16, 20, 14), fur, [0, 0, 0], [0.9, 0.82, 1.3]));
  // 背心：蓋住背部的半球殼
  body.add(mesh(new THREE.SphereGeometry(0.168, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), vest, [0, 0.01, 0.02], [0.92, 0.84, 1.15]));
  const head = new THREE.Group();
  head.position.set(0, 0.12, -0.2);
  body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.12, 20, 14), fur, [0, 0, 0], [1.05, 0.95, 0.95]));
  head.add(mesh(new THREE.SphereGeometry(0.065, 14, 10), dark, [0, -0.035, -0.1], [1.15, 0.8, 0.75]));
  head.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), rubberMat(0x111111), [0, -0.012, -0.155]));
  for (const side of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), rubberMat(0x14110f), [side * 0.05, 0.03, -0.1]));
    const ear = mesh(new THREE.SphereGeometry(0.05, 10, 8), dark, [side * 0.1, 0.05, 0.0], [0.45, 1.0, 0.75]);
    ear.rotation.z = side * 0.5;
    head.add(ear);
  }
  // 小護額
  head.add(mesh(new THREE.CylinderGeometry(0.123, 0.123, 0.03, 20, 1, true), fabricMat(0x283252), [0, 0.05, 0]));
  head.add(mesh(new RoundedBoxGeometry(0.08, 0.035, 0.012, 1, 0.005), metalMat(0xcfd6dd), [0, 0.05, -0.12]));
  // 腳：四個關節，各一隻腳＋腳掌
  const legs: THREE.Group[] = [];
  for (const [x, z] of [
    [-0.075, -0.13],
    [0.075, -0.13],
    [-0.075, 0.13],
    [0.075, 0.13],
  ]) {
    const leg = new THREE.Group();
    leg.position.set(x, -0.05, z);
    body.add(leg);
    leg.add(mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), fur, [0, -0.1, 0]));
    leg.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), fur, [0, -0.2, -0.01], [1, 0.6, 1.2]));
    legs.push(leg);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.08, 0.2);
  body.add(tail);
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.018, 6, 12, Math.PI * 1.5), fur);
  curl.rotation.y = Math.PI / 2;
  tail.add(curl);
  outlineAll(root, 0.006);
  return { root, body, head, legs, tail };
}

/**
 * 忍犬奔跑（四足跳躍步態）：前腳一起、後腳一起前後擺，身體上下起伏並前後點頭。
 * @param phase 跑步相位（0..1）
 */
export function animateDog(rig: DogRig, phase: number): void {
  const p = phase * Math.PI * 2;
  const front = Math.sin(p) * 0.8;
  const back = Math.sin(p + Math.PI) * 0.8;
  rig.legs[0].rotation.x = front;
  rig.legs[1].rotation.x = front * 0.85;
  rig.legs[2].rotation.x = back;
  rig.legs[3].rotation.x = back * 0.85;
  rig.body.position.y = 0.3 + Math.abs(Math.sin(p)) * 0.05;
  rig.body.rotation.x = Math.cos(p) * 0.12;
  rig.head.rotation.x = -Math.cos(p) * 0.1;
  rig.tail.rotation.z = Math.sin(p * 2) * 0.4;
}

/** 巨蛤蟆的關節 */
export interface ToadRig {
  root: THREE.Group;
  /** 身體（壓扁／拉長） */
  body: THREE.Group;
  frontL: THREE.Group;
  frontR: THREE.Group;
  backL: THREE.Group;
  backR: THREE.Group;
}

/** 主角坐在蛤蟆頭上的位置（相對蛤蟆根節點） */
export const TOAD_SEAT = new THREE.Vector3(0, 1.82, -0.15);

/**
 * 巨蛤蟆（通靈術）：橘紅色疣皮、奶油色肚子、頭頂兩顆凸出的大眼、寬嘴、深藍短外掛、嘴角叼菸斗。
 * 約 2.8 m 寬、1.9 m 高；主角坐在頭頂（TOAD_SEAT）。
 */
export function buildToad(): ToadRig {
  const skin = stdMat({ color: 0xd9572a, roughness: 0.5 }, 'toad-skin');
  const belly = stdMat({ color: 0xf0c27c, roughness: 0.6 }, 'toad-belly');
  const wart = stdMat({ color: 0xa83c1c, roughness: 0.6 }, 'toad-wart');
  const eyeMat = stdMat({ color: 0xf6d63a, roughness: 0.25 }, 'toad-eye');
  const black = stdMat({ color: 0x111111, roughness: 0.4 }, 'toad-black');
  const coat = fabricMat(0x24386a);
  const root = new THREE.Group();
  root.name = 'toad';
  const body = new THREE.Group();
  root.add(body);
  const parts = new THREE.Group();
  body.add(parts);
  parts.add(mesh(new THREE.SphereGeometry(1.2, 40, 28), skin, [0, 1.0, 0], [1.18, 0.72, 1.0]));
  parts.add(mesh(new THREE.SphereGeometry(1.0, 32, 20), belly, [0, 0.72, -0.5], [1.08, 0.56, 0.72]));
  // 疣
  const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let i = 0; i < 26; i++) {
    const a = rnd(i) * Math.PI * 2;
    const h = 0.3 + rnd(i + 50) * 0.55;
    const r = 1.2 * Math.sqrt(1 - h * h);
    parts.add(mesh(new THREE.SphereGeometry(0.07 + rnd(i + 99) * 0.06, 8, 6), wart, [Math.cos(a) * r * 1.18, 1.0 + h * 0.72 * 1.2 * 0.83, Math.sin(a) * r]));
  }
  // 大眼睛：眼窩＋黃色眼球＋橫向瞳孔
  for (const side of [-1, 1]) {
    parts.add(mesh(new THREE.SphereGeometry(0.34, 20, 14), skin, [side * 0.62, 1.66, -0.5]));
    parts.add(mesh(new THREE.SphereGeometry(0.25, 20, 14), eyeMat, [side * 0.66, 1.76, -0.66]));
    parts.add(mesh(new RoundedBoxGeometry(0.2, 0.06, 0.05, 2, 0.02), black, [side * 0.67, 1.78, -0.9]));
  }
  // 嘴：前方一道寬弧
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.035, 6, 32, Math.PI * 0.8), black);
  mouth.rotation.set(Math.PI / 2 + 0.25, 0, Math.PI * 1.1);
  mouth.position.set(0, 0.98, -0.25);
  mouth.scale.set(1.2, 1.0, 1);
  parts.add(mouth);
  // 深藍短外掛：包住背部的半圓殼
  const coatGeo = new THREE.SphereGeometry(1.215, 32, 16, 0, Math.PI, Math.PI * 0.15, Math.PI * 0.5);
  coatGeo.rotateY(-Math.PI / 2);
  parts.add(mesh(coatGeo, coat, [0, 1.0, 0.04], [1.19, 0.73, 1.01]));
  // 菸斗：嘴角往外伸出
  const pipe = new THREE.Group();
  pipe.position.set(0.85, 0.95, -0.85);
  pipe.rotation.set(0, -0.6, -0.25);
  pipe.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), stdMat({ color: 0x6b4423, roughness: 0.6 }, 'toad-pipe'), [0.4, 0, 0]));
  pipe.children[0].rotation.z = Math.PI / 2;
  pipe.add(mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.2, 12), stdMat({ color: 0x4a2e17, roughness: 0.6 }, 'toad-bowl'), [0.85, 0.08, 0]));
  parts.add(pipe);
  // 腳：前腳（粗短）、後腳（大腿＋外張的蹼）
  const leg = (x: number, z: number, front: boolean): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, front ? 0.7 : 0.8, z);
    root.add(g);
    if (front) {
      g.add(mesh(new THREE.CapsuleGeometry(0.2, 0.45, 6, 12), skin, [0, -0.35, 0]));
    } else {
      g.add(mesh(new THREE.SphereGeometry(0.45, 18, 12), skin, [0, -0.25, 0.1], [0.8, 0.75, 1.2]));
    }
    g.add(mesh(new THREE.SphereGeometry(0.3, 14, 8), skin, [Math.sign(x) * 0.1, front ? -0.68 : -0.75, -0.15], [1.2, 0.3, 1.1]));
    return g;
  };
  const frontL = leg(-0.85, -0.75, true);
  const frontR = leg(0.85, -0.75, true);
  const backL = leg(-1.15, 0.55, false);
  const backR = leg(1.15, 0.55, false);
  // 身體部件合併成少數網格（材質相同的合在一起）
  const merged = mergeByMaterial(parts);
  body.remove(parts);
  body.add(merged);
  outlineAll(root, 0.02);
  return { root, body, frontL, frontR, backL, backR };
}

/**
 * 蛤蟆跳躍：hop = 0 與 1 是落地（壓扁、腳彎）、0.5 是最高點（拉長、後腳往後蹬直）。
 */
export function animateToad(rig: ToadRig, hop: number): void {
  const air = Math.sin(hop * Math.PI);
  const squash = 1 - (1 - air) * 0.14;
  rig.body.scale.set(1 + (1 - air) * 0.08, squash + air * 0.06, 1);
  rig.backL.rotation.x = 0.2 + air * 0.9;
  rig.backR.rotation.x = 0.2 + air * 0.9;
  rig.frontL.rotation.x = -0.3 + air * 0.6;
  rig.frontR.rotation.x = -0.3 + air * 0.6;
}
