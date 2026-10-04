import * as THREE from 'three';

/**
 * 風格化 PBR 材質工廠：地鐵跑酷式的飽和配色＋柔和光影。
 * 一律用 MeshStandardMaterial（高粗糙度、非金屬），金屬零件才調 metalness。
 * 顏色貼圖要是 SRGBColorSpace；bump／normal／roughness 貼圖保持 NoColorSpace（proctex.ts 已處理）。
 */

/** 材質參數 */
export interface MatOptions {
  color?: number;
  map?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  bumpScale?: number;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  /** 0..1，預設 0.78（不反光的塗料、布料） */
  roughness?: number;
  /** 0..1，預設 0 */
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  flatShading?: boolean;
  vertexColors?: boolean;
  /** 環境貼圖反射強度（預設 1） */
  envMapIntensity?: number;
  /** 不受地平線下彎影響（遠景、天空） */
  noCurve?: boolean;
  depthWrite?: boolean;
}

/** 材質快取：key 由呼叫端指定（同 key 回傳同一個材質） */
const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * 取得風格化材質。
 * @param opts 材質參數
 * @param key 快取鍵；同一個 key 會共用同一個材質（減少 shader 切換與記憶體）。不給就不快取。
 */
export function stdMat(opts: MatOptions, key?: string): THREE.MeshStandardMaterial {
  if (key) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    bumpMap: opts.bumpMap ?? null,
    bumpScale: opts.bumpScale ?? 1,
    normalMap: opts.normalMap ?? null,
    roughnessMap: opts.roughnessMap ?? null,
    roughness: opts.roughness ?? 0.78,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    emissiveMap: opts.emissiveMap ?? null,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    side: opts.side ?? THREE.FrontSide,
    flatShading: opts.flatShading ?? false,
    vertexColors: opts.vertexColors ?? false,
    envMapIntensity: opts.envMapIntensity ?? 1,
    depthWrite: opts.depthWrite ?? true,
  });
  if (opts.noCurve) mat.defines = { NO_CURVE: '' };
  if (key) cache.set(key, mat);
  return mat;
}

/**
 * 純色材質的捷徑（依顏色與粗糙度自動快取）。
 * @param color 顏色
 * @param roughness 粗糙度（預設 0.78）
 * @param metalness 金屬度（預設 0）
 */
export function solid(color: number, roughness = 0.78, metalness = 0): THREE.MeshStandardMaterial {
  return stdMat({ color, roughness, metalness }, `solid|${color}|${roughness}|${metalness}`);
}

/**
 * 發光材質（燈籠、車燈、查克拉）：自發光顏色等於底色。
 * @param intensity 自發光強度
 */
export function glow(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
  return stdMat(
    { color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 },
    `glow|${color}|${intensity}`,
  );
}
