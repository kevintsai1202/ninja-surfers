import * as THREE from 'three';
import { glow, solid, stdMat } from '../../materials';
import { grass } from '../../proctex';
import { createPaletteAtlas } from './atlas';
import { SHADOW, SWAY_MATS } from './builder';
import {
  decalAtlas,
  paving,
  pebbles,
  railTex,
  roofAtlas,
  sleeperTex,
  TRAIN_COLORS,
  trainBodyTex,
  wallAtlas,
  woodAtlas,
} from './textures';

/**
 * 木葉村的全部材質（createKit 時一次建立，之後每段場景、每個障礙都共用）。
 * 每個材質的投影／接收陰影固定（記在 SHADOW），合併時才不會因為旗標不同而多拆網格。
 */

/** 搖擺動畫（燈籠、旗子）共用的時間 uniform，update() 每幀寫入 */
export const swayTime = { value: 0 };

/** 木葉村材質集合 */
export interface VillageMats {
  /** 卵石道碴（只接收陰影） */
  ballast: THREE.MeshStandardMaterial;
  /** 枕木 */
  sleeper: THREE.MeshStandardMaterial;
  /** 鋼軌與扣件 */
  rail: THREE.MeshStandardMaterial;
  /** 石板路 */
  street: THREE.MeshStandardMaterial;
  /** 草地（後院、外圍土坡） */
  grass: THREE.MeshStandardMaterial;
  /** 牆面圖集（灰泥、木板牆、石牆） */
  wall: THREE.MeshStandardMaterial;
  /** 木材圖集（樑柱、木箱、朱漆） */
  wood: THREE.MeshStandardMaterial;
  /** 屋瓦圖集 */
  roof: THREE.MeshStandardMaterial;
  /** 調色盤圖集（純色零件、招牌、暖簾、窗、燈籠…），含自發光貼圖 */
  palette: THREE.MeshStandardMaterial;
  /** 會搖擺的零件（燈籠、幟旗），同一張調色盤圖集＋頂點動畫 */
  sway: THREE.MeshStandardMaterial;
  /** 塗鴉貼花（alphaTest、往前偏移避免 z-fighting） */
  decal: THREE.MeshStandardMaterial;
  /** 深色金屬（轉向架、車輪、連結器） */
  metal: THREE.MeshStandardMaterial;
  /** 亮著的車頭燈 */
  headOn: THREE.MeshStandardMaterial;
  /** 列車車身木板（依配色） */
  trainBody: THREE.MeshStandardMaterial[];
}

/** 登記材質的陰影設定 */
function shadow<T extends THREE.Material>(m: T, cast: boolean, receive: boolean): T {
  SHADOW.set(m, { cast, receive });
  return m;
}

/**
 * 建立搖擺材質：在頂點著色器裡依 aPivot（樞紐）與 aSway（振幅、頻率、相位）旋轉頂點與法線。
 * 只改 begin_vertex／beginnormal_vertex，地平線下彎（project_vertex）照常套用在擺動之後。
 */
function makeSwayMaterial(map: THREE.Texture, emissiveMap: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 1,
    roughness: 0.68,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec3 aPivot;
attribute vec3 aSway;
uniform float uSwayTime;
// 擺動旋轉：繞 x 軸前後擺，再繞 z 軸左右擺（兩個頻率錯開，看起來比較自然）
mat3 villageSwayRot() {
  float a = aSway.x * sin( uSwayTime * aSway.y + aSway.z );
  float b = aSway.x * 0.6 * sin( uSwayTime * aSway.y * 1.37 + aSway.z * 1.9 );
  float ca = cos( a );
  float sa = sin( a );
  float cb = cos( b );
  float sb = sin( b );
  mat3 rx = mat3( 1.0, 0.0, 0.0, 0.0, ca, sa, 0.0, -sa, ca );
  mat3 rz = mat3( cb, sb, 0.0, -sb, cb, 0.0, 0.0, 0.0, 1.0 );
  return rz * rx;
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
mat3 villageR = villageSwayRot();
objectNormal = villageR * objectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
transformed = aPivot + villageR * ( transformed - aPivot );`,
      );
  };
  m.customProgramCacheKey = () => 'village-sway-v1';
  return m;
}

/** 已建立的材質（整個網頁只建一次） */
let built: VillageMats | null = null;

/** 取得木葉村材質（第一次呼叫時產生全部貼圖） */
export function villageMats(): VillageMats {
  if (built) return built;
  const pal = createPaletteAtlas();
  const wallT = wallAtlas();
  const woodT = woodAtlas();
  const roofT = roofAtlas();
  const paveT = paving();
  const pebT = pebbles();
  const slpT = sleeperTex();
  const grassT = grass(0x6fb24c, 8);
  const decalT = decalAtlas();

  const decal = stdMat({ map: decalT, alphaTest: 0.5, roughness: 0.6 }, 'village|decal');
  decal.polygonOffset = true;
  decal.polygonOffsetFactor = -2;
  decal.polygonOffsetUnits = -4;

  const sway = makeSwayMaterial(pal.map, pal.emissive);
  SWAY_MATS.add(sway);

  built = {
    ballast: shadow(stdMat({ map: pebT.map, bumpMap: pebT.bump, bumpScale: 2.2, roughness: 0.92 }, 'village|ballast'), false, true),
    sleeper: shadow(stdMat({ map: slpT.map, bumpMap: slpT.bump, bumpScale: 1.6, roughness: 0.85 }, 'village|sleeper'), false, true),
    rail: shadow(stdMat({ map: railTex(), roughness: 0.38, metalness: 0.55 }, 'village|rail'), false, true),
    street: shadow(stdMat({ map: paveT.map, bumpMap: paveT.bump, bumpScale: 1.6, roughness: 0.9 }, 'village|street'), false, true),
    grass: shadow(stdMat({ map: grassT.map, bumpMap: grassT.bump, bumpScale: 1, roughness: 0.95 }, 'village|grass'), false, true),
    wall: shadow(stdMat({ map: wallT.map, bumpMap: wallT.bump, bumpScale: 1.4, roughness: 0.88 }, 'village|wall'), true, true),
    wood: shadow(stdMat({ map: woodT.map, bumpMap: woodT.bump, bumpScale: 1.2, roughness: 0.72 }, 'village|wood'), true, true),
    roof: shadow(stdMat({ map: roofT.map, bumpMap: roofT.bump, bumpScale: 1.6, roughness: 0.55, metalness: 0.05 }, 'village|roof'), true, true),
    palette: shadow(
      stdMat({ map: pal.map, emissiveMap: pal.emissive, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.7 }, 'village|palette'),
      true,
      true,
    ),
    sway: shadow(sway, false, true),
    decal: shadow(decal, false, true),
    metal: shadow(solid(0x3b3f45, 0.5, 0.55), true, true),
    headOn: shadow(glow(0xfff0c2, 2.6), false, false),
    trainBody: TRAIN_COLORS.map((_, v) => {
      const t = trainBodyTex(v);
      return shadow(stdMat({ map: t.map, bumpMap: t.bump, bumpScale: 1.8, roughness: 0.74 }, `village|trainBody|${v}`), true, true);
    }),
  };
  return built;
}
