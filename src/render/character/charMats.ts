import * as THREE from 'three';
import { stdMat } from '../materials';
import { fabric } from '../proctex';

/**
 * 角色用的風格化 PBR 材質（衣服布紋、皮膚、頭髮、金屬、橡膠）。
 * 依顏色快取：同一種顏色的布料在所有角色之間共用一個材質。
 */

/** 角色布料共用的織紋貼圖（白底，顏色由材質 color 決定；重複貼得比較密，近看才有布感） */
let fabricTex: { map: THREE.Texture; bump: THREE.Texture } | null = null;

/** 取得角色布料織紋（第一次呼叫時建立） */
function charFabric(): { map: THREE.Texture; bump: THREE.Texture } {
  if (!fabricTex) {
    const base = fabric(0xffffff, 21);
    const map = base.map.clone();
    const bump = base.bump.clone();
    map.repeat.set(6, 4);
    bump.repeat.set(6, 4);
    map.needsUpdate = true;
    bump.needsUpdate = true;
    fabricTex = { map, bump };
  }
  return fabricTex;
}

/**
 * 布料材質（衣服、褲子、護額布條）：粗糙、帶細織紋凹凸。
 * @param color 布料顏色
 * @param map 自訂顏色貼圖（例如畫了紋章的夾克）；有給時 color 會乘上貼圖
 */
export function fabricMat(color: number, map?: THREE.Texture): THREE.MeshStandardMaterial {
  const tex = charFabric();
  if (map) {
    return stdMat({ color, map, bumpMap: tex.bump, bumpScale: 0.6, roughness: 0.86 });
  }
  return stdMat({ color, map: tex.map, bumpMap: tex.bump, bumpScale: 0.6, roughness: 0.86 }, `cfab|${color}`);
}

/** 皮膚材質：略帶光澤、暖色 */
export function skinMat(color: number): THREE.MeshStandardMaterial {
  return stdMat({ color, roughness: 0.55, envMapIntensity: 0.8 }, `cskin|${color}`);
}

/** 頭髮材質：使用頂點色做出髮根暗、髮尖亮的漸層 */
export function hairMat(color: number): THREE.MeshStandardMaterial {
  return stdMat({ color, roughness: 0.48, vertexColors: true }, `chair|${color}`);
}

/** 金屬材質（護額金屬片、拉鍊、苦無） */
export function metalMat(color: number, map?: THREE.Texture, bumpMap?: THREE.Texture): THREE.MeshStandardMaterial {
  if (map || bumpMap) {
    return stdMat({ color, map: map ?? null, bumpMap: bumpMap ?? null, bumpScale: 2, metalness: 0.8, roughness: 0.3 });
  }
  return stdMat({ color, metalness: 0.85, roughness: 0.3 }, `cmetal|${color}`);
}

/** 橡膠／皮革材質（涼鞋、忍具袋） */
export function rubberMat(color: number): THREE.MeshStandardMaterial {
  return stdMat({ color, roughness: 0.62 }, `crub|${color}`);
}
