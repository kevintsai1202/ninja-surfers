import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 依材質合併網格，降低 draw call（場景每一段可能有上百個小物件）。
 *
 * mergeGeometries 遇到屬性集合不一致（有的有 color／uv1、有的沒有）或索引／非索引混用時會回傳 null，
 * 而且不報錯，所以這裡先把每個幾何正規化成只剩 position／normal／uv，再一律轉成非索引。
 */

/** 合併選項 */
export interface MergeOptions {
  /** 不合併、原樣保留的條件（例如需要每幀動畫的物件） */
  keep?: (obj: THREE.Object3D) => boolean;
}

/** 把幾何正規化：套用矩陣、只留 position／normal／uv、轉非索引；鏡像矩陣要翻轉三角形繞序 */
function normalizeGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  let g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.clearGroups();
  g.morphAttributes = {};
  g.applyMatrix4(matrix);
  // 行列式為負（有鏡像縮放）時，三角形繞序會反過來，背面剔除會把它剔掉：交換每個三角形的兩個頂點
  if (matrix.determinant() < 0) {
    for (const name of ['position', 'normal', 'uv']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      const size = attr.itemSize;
      const arr = attr.array as Float32Array;
      for (let t = 0; t < attr.count; t += 3) {
        for (let k = 0; k < size; k++) {
          const a = (t + 1) * size + k;
          const b = (t + 2) * size + k;
          const tmp = arr[a];
          arr[a] = arr[b];
          arr[b] = tmp;
        }
      }
    }
  }
  if (g.index) g = g.toNonIndexed();
  return g;
}

/**
 * 把 root 底下的一般網格依（材質、投影、接收陰影）分組合併，回傳新的 Group。
 * - 座標轉成相對 root 的座標（root 自己的位置不算進去）。
 * - InstancedMesh、SkinnedMesh、多材質網格、Points、Line、Sprite 以及 keep() 為真的物件原樣保留（連同子孫）。
 * - 合併失敗時丟出含材質名稱的錯誤，不會靜默回傳空物件。
 */
export function mergeByMaterial(root: THREE.Object3D, opts: MergeOptions = {}): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const kept: THREE.Object3D[] = [];

  const visit = (obj: THREE.Object3D) => {
    if (obj !== root) {
      const mesh = obj as THREE.Mesh;
      const special =
        (obj as THREE.InstancedMesh).isInstancedMesh ||
        (obj as THREE.SkinnedMesh).isSkinnedMesh ||
        (obj as THREE.Points).isPoints ||
        (obj as THREE.Line).isLine ||
        (obj as THREE.Sprite).isSprite ||
        (mesh.isMesh && Array.isArray(mesh.material)) ||
        (opts.keep?.(obj) ?? false);
      if (special) {
        kept.push(obj);
        return; // 子孫跟著一起保留
      }
      if (mesh.isMesh && mesh.visible) {
        const mat = mesh.material as THREE.Material;
        const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
        let grp = groups.get(key);
        if (!grp) {
          grp = { mat, cast: mesh.castShadow, receive: mesh.receiveShadow, geos: [] };
          groups.set(key, grp);
        }
        const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
        grp.geos.push(normalizeGeometry(mesh.geometry, m));
      }
    }
    for (const c of obj.children) visit(c);
  };
  visit(root);

  const out = new THREE.Group();
  out.name = `${root.name || 'merged'}(merged)`;
  for (const grp of groups.values()) {
    const merged = grp.geos.length === 1 ? grp.geos[0] : mergeGeometries(grp.geos, false);
    if (!merged) {
      throw new Error(`mergeByMaterial：材質 ${grp.mat.name || grp.mat.type}（${grp.geos.length} 個幾何）合併失敗`);
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, grp.mat);
    mesh.castShadow = grp.cast;
    mesh.receiveShadow = grp.receive;
    out.add(mesh);
    for (const g of grp.geos) if (g !== merged) g.dispose();
  }
  // 保留的物件：把相對 root 的變換寫回去後掛到新 Group
  for (const obj of kept) {
    const m = new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld);
    obj.removeFromParent();
    m.decompose(obj.position, obj.quaternion, obj.scale);
    out.add(obj);
  }
  return out;
}
