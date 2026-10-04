import * as THREE from 'three';

/**
 * 角色描邊：反向外殼（BackSide＋頂點沿法線外推），比後製 OutlinePass 便宜，手機也跑得動。
 */

/** 描邊材質快取（依粗細與顏色） */
const outlineCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * 反向外殼描邊材質：只畫背面，頂點沿法線往外推 thickness 公尺。
 * 比後製 OutlinePass 便宜很多，手機也跑得動。
 */
export function outlineMat(thickness = 0.016, color = 0x1b1410): THREE.MeshBasicMaterial {
  const key = `${thickness.toFixed(4)}|${color}`;
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader =
      'uniform float uOutline;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        'vec3 transformed = vec3( position ) + normalize( normal ) * uOutline;',
      );
  };
  // 粗細走 uniform，所有描邊材質可以共用同一支 shader 程式
  mat.customProgramCacheKey = () => 'toon-outline';
  outlineCache.set(key, mat);
  return mat;
}
