import * as THREE from 'three';

/**
 * 快速批次合併：把大量「範本幾何 × 變換」直接寫進每個材質一組的大陣列，最後每組只產生一個網格。
 * 比逐個建立 Mesh 再交給 mergeByMaterial 快很多（不建立中間物件、不 clone 幾何、矩陣運算內聯），
 * 建一段場景的時間主要花在這裡，所以特別寫。
 *
 * 範本幾何必須是非索引、有 position／normal／uv 三個屬性（geom.ts 的工具都已處理）。
 * 變換限定為「繞 y 旋轉＋非等比縮放＋平移」（場景道具夠用）。
 */

/** 一筆擺放紀錄 */
interface Item {
  geo: THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  /** cos(ry)、sin(ry) */
  c: number;
  s: number;
  sx: number;
  sy: number;
  sz: number;
}

/** 同材質、同投影設定的一組 */
interface Group {
  mat: THREE.Material;
  cast: boolean;
  items: Item[];
  vertices: number;
}

/** 批次合併器 */
export class Batcher {
  private readonly groups = new Map<string, Group>();

  /**
   * 擺一個範本幾何。
   * @param ry 繞 y 軸旋轉（弧度）
   * @param cast 是否投影
   */
  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
    sx = 1,
    sy = sx,
    sz = sx,
    cast = false,
  ): void {
    const key = `${mat.uuid}|${cast ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { mat, cast, items: [], vertices: 0 };
      this.groups.set(key, g);
    }
    g.items.push({ geo, x, y, z, c: Math.cos(ry), s: Math.sin(ry), sx, sy, sz });
    g.vertices += geo.attributes.position.count;
  }

  /**
   * 產生網格並掛到 parent 底下（每組一個網格，receiveShadow 一律開）。
   */
  build(parent: THREE.Object3D): void {
    for (const g of this.groups.values()) {
      const n = g.vertices;
      const pos = new Float32Array(n * 3);
      const nrm = new Float32Array(n * 3);
      const uvs = new Float32Array(n * 2);
      let o = 0;
      for (const it of g.items) {
        const P = it.geo.attributes.position.array as Float32Array;
        const N = it.geo.attributes.normal.array as Float32Array;
        const U = it.geo.attributes.uv.array as Float32Array;
        const cnt = it.geo.attributes.position.count;
        const { c, s, sx, sy, sz, x, y, z } = it;
        // 法線用縮放的倒數（逆轉置），再正規化
        const ix = 1 / sx;
        const iy = 1 / sy;
        const iz = 1 / sz;
        // 鏡像縮放（行列式為負）要翻轉三角形繞序，否則會被背面剔除
        const flip = sx * sy * sz < 0;
        for (let v = 0; v < cnt; v++) {
          // 鏡像時每個三角形交換第 2、3 個頂點
          const src = flip ? v - (v % 3) + (v % 3 === 1 ? 2 : v % 3 === 2 ? 1 : 0) : v;
          const p3 = src * 3;
          const px = P[p3] * sx;
          const py = P[p3 + 1] * sy;
          const pz = P[p3 + 2] * sz;
          const d3 = (o + v) * 3;
          pos[d3] = px * c + pz * s + x;
          pos[d3 + 1] = py + y;
          pos[d3 + 2] = -px * s + pz * c + z;
          const nx = N[p3] * ix;
          const ny = N[p3 + 1] * iy;
          const nz = N[p3 + 2] * iz;
          const rx = nx * c + nz * s;
          const rz = -nx * s + nz * c;
          const len = Math.sqrt(rx * rx + ny * ny + rz * rz) || 1;
          nrm[d3] = rx / len;
          nrm[d3 + 1] = ny / len;
          nrm[d3 + 2] = rz / len;
          const d2 = (o + v) * 2;
          uvs[d2] = U[src * 2];
          uvs[d2 + 1] = U[src * 2 + 1];
        }
        o += cnt;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(geo, g.mat);
      mesh.castShadow = g.cast;
      mesh.receiveShadow = true;
      markMerged(mesh);
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

/** 標記「已經依材質合併好」的網格（交給 mergeByMaterial 時原樣保留，不再重複展開與複製頂點） */
export function markMerged(obj: THREE.Object3D): void {
  obj.userData.valleyMerged = true;
}

/** mergeByMaterial 的 keep 條件：已合併好的網格原樣保留 */
export function isMerged(obj: THREE.Object3D): boolean {
  return obj.userData.valleyMerged === true;
}
