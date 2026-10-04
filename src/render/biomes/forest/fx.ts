import * as THREE from 'three';
import type { ForestAssets } from './assets';
import { range, smoothstep, subRect, type Rng } from './geom';

/**
 * 每幀動畫的特效：飄落的葉子（InstancedMesh）、螢火蟲（Points，會閃爍）、光束與油燈的明暗起伏。
 * 每段場景建一組葉子與螢火蟲並登記在這裡；update(time) 依時間算出位置（同一時間結果固定，freeze 截圖穩定）。
 * 這些物件標記 userData.forestFx = true，合併網格時保留不合併。
 */

/** 一段場景的落葉 */
interface LeafSet {
  mesh: THREE.InstancedMesh;
  /** 每片葉子 8 個參數：x0, z0, top, speed, phase, swayA, swayF, spin */
  p: Float32Array;
}

/** 一段場景的螢火蟲 */
interface FlySet {
  pts: THREE.Points;
  /** 每隻 4 個參數：bx, by, bz, phase */
  p: Float32Array;
}

/** 落葉顏色（乘在黃葉貼圖上：綠、黃、橘、紅褐） */
const LEAF_TINTS = [new THREE.Color(0.62, 0.95, 0.45), new THREE.Color(1, 1, 1), new THREE.Color(1, 0.68, 0.38), new THREE.Color(0.85, 0.45, 0.3)];

/** 螢火蟲光色 */
const FLY_COLOR = new THREE.Color(1.0, 0.86, 0.42);

/** 暫存 */
const _o = new THREE.Object3D();

/** 特效登記處（一個場景模組一份） */
export class ForestFx {
  private leaves: LeafSet[] = [];
  private flies: FlySet[] = [];
  private readonly A: ForestAssets;
  /** 落葉的單片葉幾何（共用） */
  private readonly leafGeo: THREE.BufferGeometry;

  /** 建立特效登記處，並準備落葉共用的單片葉幾何 */
  constructor(A: ForestAssets) {
    this.A = A;
    // 黃色單片葉（植物貼圖集 leaves 格的右上小格）
    const r = subRect(A.uv.plant.leaves, 0.5, 0.5, 0.5, 0.5);
    const g = new THREE.PlaneGeometry(0.16, 0.2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u + uv.getX(i) * r.w, r.v + uv.getY(i) * r.h);
    this.leafGeo = g;
  }

  /**
   * 建一段場景的落葉：在跑道附近（|x| < 10）從 8～14 m 高處飄落，到地面前縮小消失、再從上方出現。
   */
  makeLeaves(rnd: Rng, n: number, len: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.leafGeo, this.A.mats.plants, n);
    const p = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      p[i * 8] = range(rnd, -10, 10);
      p[i * 8 + 1] = -range(rnd, 0, len);
      p[i * 8 + 2] = range(rnd, 8, 14);
      p[i * 8 + 3] = range(rnd, 0.7, 1.3);
      p[i * 8 + 4] = rnd();
      p[i * 8 + 5] = range(rnd, 0.4, 1.1);
      p[i * 8 + 6] = range(rnd, 0.8, 1.8);
      p[i * 8 + 7] = range(rnd, 1.5, 4);
      mesh.setColorAt(i, LEAF_TINTS[i % LEAF_TINTS.length]);
    }
    mesh.instanceColor!.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.forestFx = true;
    mesh.name = 'forest-leaves';
    const set = { mesh, p };
    this.leaves.push(set);
    this.updateLeaves(set, 1);
    return mesh;
  }

  /**
   * 建一段場景的螢火蟲：多數在兩側林下（|x| 4.5～14），少數飄到跑道上方。
   */
  makeFireflies(rnd: Rng, n: number, len: number): THREE.Points {
    const p = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const overTrack = rnd() < 0.25;
      const side = rnd() < 0.5 ? -1 : 1;
      p[i * 4] = overTrack ? range(rnd, -3.5, 3.5) : side * range(rnd, 4.5, 14);
      p[i * 4 + 1] = overTrack ? range(rnd, 1.6, 4.5) : range(rnd, 0.5, 3.5);
      p[i * 4 + 2] = -range(rnd, 0, len);
      p[i * 4 + 3] = rnd() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(g, this.A.mats.firefly);
    pts.frustumCulled = false;
    pts.userData.forestFx = true;
    pts.name = 'forest-fireflies';
    const set = { pts, p };
    this.flies.push(set);
    this.updateFlies(set, 1);
    return pts;
  }

  /** 從登記中移除（暖身建的段落用完就丟） */
  forget(obj: THREE.Object3D): void {
    this.leaves = this.leaves.filter((s) => s.mesh !== obj);
    this.flies = this.flies.filter((s) => s.pts !== obj);
  }

  /** 每幀更新：只更新目前掛在場景裡的段落 */
  update(time: number): void {
    for (const s of this.leaves) if (s.mesh.parent) this.updateLeaves(s, time);
    for (const s of this.flies) if (s.pts.parent) this.updateFlies(s, time);
    // 光束：緩慢的明暗起伏
    const fx = this.A.mats.fx;
    fx.opacity = 0.24 * (0.86 + 0.1 * Math.sin(time * 0.7) + 0.05 * Math.sin(time * 2.1 + 1.3));
    // 油燈：輕微的火光閃動
    this.A.mats.lamp.emissiveIntensity = 2.6 * (0.9 + 0.07 * Math.sin(time * 11) + 0.05 * Math.sin(time * 23 + 2));
  }

  /** 算出一段落葉在時間 time 的位置 */
  private updateLeaves(s: LeafSet, time: number): void {
    const p = s.p;
    const n = s.mesh.count;
    for (let i = 0; i < n; i++) {
      const top = p[i * 8 + 2];
      const speed = p[i * 8 + 3];
      const phase = p[i * 8 + 4];
      const cycle = top / speed;
      const tt = (((time + phase * cycle) % cycle) + cycle) % cycle;
      const y = top - tt * speed;
      const swayA = p[i * 8 + 5];
      const swayF = p[i * 8 + 6];
      const spin = p[i * 8 + 7];
      _o.position.set(p[i * 8] + Math.sin(time * swayF + phase * 6.28) * swayA, y, p[i * 8 + 1] + Math.cos(time * swayF * 0.7 + phase * 3) * swayA * 0.6);
      _o.rotation.set(time * spin + phase * 10, time * spin * 0.6 + phase * 4, Math.sin(time * swayF) * 0.9);
      _o.scale.setScalar(smoothstep(0, 0.7, y) * smoothstep(top, top - 1, y) + 0.001);
      _o.updateMatrix();
      s.mesh.setMatrixAt(i, _o.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 算出一段螢火蟲在時間 time 的位置與亮度 */
  private updateFlies(s: FlySet, time: number): void {
    const p = s.p;
    const pos = s.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = s.pts.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const ph = p[i * 4 + 3];
      pos.setXYZ(
        i,
        p[i * 4] + Math.sin(time * 0.6 + ph) * 0.7 + Math.sin(time * 1.7 + ph * 2) * 0.15,
        p[i * 4 + 1] + Math.sin(time * 0.9 + ph * 1.3) * 0.35,
        p[i * 4 + 2] + Math.cos(time * 0.5 + ph * 0.7) * 0.7,
      );
      const blink = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(time * 1.9 + ph * 5)), 2);
      col.setXYZ(i, FLY_COLOR.r * blink, FLY_COLOR.g * blink, FLY_COLOR.b * blink);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
