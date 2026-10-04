import * as THREE from 'three';

/**
 * 人形角色的關節階層定義（尺寸、關節名稱）。網格建模在 hdBody.ts。
 * 角色面向 −z（往前跑的方向）；角色的右手在 +x。
 * 旋轉慣例：rotation.x > 0 會把「往下垂」的肢體往前（−z）甩；軀幹 rotation.x < 0 是往前傾。
 */

/** 身體尺寸（公尺），Q 版比例：頭大、腿夠長才看得出跑步動作 */
export const DIMS = {
  /** 腳踝離地高度 */
  ankle: 0.07,
  shin: 0.34,
  thigh: 0.34,
  /** 髖關節高度（站直時） */
  hip: 0.75,
  /** 髖關節離中線的距離 */
  hipHalf: 0.105,
  /** 骨盆到胸樞紐 */
  spine: 0.24,
  /** 胸樞紐到肩線 */
  chest: 0.2,
  shoulderHalf: 0.2,
  upperArm: 0.21,
  forearm: 0.19,
  neck: 0.05,
  headR: 0.235,
};

/** 翻滾旋轉中心（spin 節點）離地高度 */
export const SPIN_Y = 0.45;

/** 人形角色的關節節點（每個都是 Group，動畫只改它們的 rotation／position） */
export interface HumanoidRig {
  /** 角色根節點：放在地面上，換線傾身、轉向 */
  root: THREE.Group;
  /** 翻滾／空翻的旋轉中心（約在腰高） */
  spin: THREE.Group;
  /** 骨盆高度節點：上下彈跳 */
  body: THREE.Group;
  /** 骨盆：腿的父層，只做扭轉，不跟上身一起前傾 */
  pelvis: THREE.Group;
  /** 腰椎：上身前傾的主要關節 */
  spine: THREE.Group;
  chest: THREE.Group;
  /** 脖子：頭部俯仰的樞紐 */
  neck: THREE.Group;
  /** 頭部（掛臉、頭髮、護額） */
  head: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  ankleL: THREE.Group;
  ankleR: THREE.Group;
  /** 會隨風飄的布條、馬尾等（由動畫依速度擺動） */
  flaps: THREE.Group[];
}
