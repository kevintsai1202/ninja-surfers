import * as THREE from 'three';
import { stdMat } from '../materials';
import type { Coin } from '../../sim/types';

/**
 * 兩（金幣）：方孔銅錢造型的金色硬幣，用一個 InstancedMesh 畫全部（一個 draw call）。
 */

/** 同時顯示的兩上限 */
const CAPACITY = 700;

/** 方孔銅錢的幾何：圓形外框、中間方孔、厚度與倒角 */
function ryoGeometry(): THREE.BufferGeometry {
  const r = 0.27;
  const hole = 0.065;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.moveTo(-hole, -hole);
  h.lineTo(-hole, hole);
  h.lineTo(hole, hole);
  h.lineTo(hole, -hole);
  h.lineTo(-hole, -hole);
  shape.holes.push(h);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.016,
    bevelSegments: 2,
    curveSegments: 28,
  });
  g.translate(0, 0, -0.02);
  g.computeVertexNormals();
  return g;
}

/** 場上所有兩的畫面 */
export class CoinField {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(parent: THREE.Object3D) {
    const mat = stdMat({ color: 0xffc83a, metalness: 0.85, roughness: 0.28, emissive: 0x6a3d00, emissiveIntensity: 0.55 }, 'ryo-coin');
    this.mesh = new THREE.InstancedMesh(ryoGeometry(), mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.name = 'coins';
    parent.add(this.mesh);
  }

  /**
   * 依模擬的兩更新畫面（模擬座標 z → 畫面 local z = −z）。
   * @param time 秒（旋轉用）
   */
  sync(coins: readonly Coin[], time: number): void {
    let n = 0;
    for (const c of coins) {
      if (c.taken || n >= CAPACITY) continue;
      this.pos.set(c.x, c.y, -c.z);
      this.e.set(0, time * 3.2 + c.id * 0.37, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.pos, this.q, this.one);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
