import * as THREE from 'three';
import { stdMat } from '../../materials';
import {
  barkTextures,
  canopyTextures,
  cartPlankTextures,
  fireflyTexture,
  floorTextures,
  fxTexture,
  metalTextures,
  mossTextures,
  pathTextures,
  plantAtlas,
  propAtlas,
  rockTextures,
  ropeTextures,
  sleeperTextures,
  PLANT,
  PROP,
} from './textures';
import { HIDE_BACK, HIDE_BOTTOM, HIDE_SIDES, bevelBox, blobGeometry, cell, toTpl, type Tpl, type UVRect } from './geom';

/**
 * 森林的共用資源：所有貼圖、材質、可重複使用的幾何模板。
 * 在 createKit() 一次建好（建一段場景時只做擺放與批次組裝，才壓得進 30 ms）。
 */

/** 加法混合材質的霧：不是混成霧色，而是隨距離淡出成黑（加法下等於不加光），遠處光束才不會變成一片亮霧 */
const ADDITIVE_FOG = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fxFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fxFog = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb *= 1.0 - fxFog;
#endif
`;

/** 讓加法混合材質改用「淡出成黑」的霧 */
function additiveFog<T extends THREE.Material>(mat: T, key: string): T {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', ADDITIVE_FOG);
  };
  mat.customProgramCacheKey = () => `forest-additive-${key}`;
  return mat;
}

/** 森林材質 */
interface ForestMats {
  /** 林道泥土（軌道底下） */
  path: THREE.MeshStandardMaterial;
  /** 森林地面（兩側） */
  floor: THREE.MeshStandardMaterial;
  /** 舊枕木 */
  sleeper: THREE.MeshStandardMaterial;
  /** 鋼軌、墊板、鐵件 */
  metal: THREE.MeshStandardMaterial;
  /** 樹皮（樹幹、板根、樹枝、樹根、倒木） */
  bark: THREE.MeshStandardMaterial;
  /** 障礙用的樹皮（較亮、偏暖，在暗色軌道上清楚可辨） */
  obsBark: THREE.MeshStandardMaterial;
  /** 苔蘚（樹基、石頭頂、藤蔓） */
  moss: THREE.MeshStandardMaterial;
  /** 樹冠葉叢 */
  canopy: THREE.MeshStandardMaterial;
  /** 植物貼圖集（帶透明、雙面） */
  plants: THREE.MeshStandardMaterial;
  /** 道具貼圖集（年輪、香菇、警告牌、繩、紙垂；發光香菇與油燈會自發光） */
  props: THREE.MeshStandardMaterial;
  /** 岩石 */
  rock: THREE.MeshStandardMaterial;
  /** 光束、光斑、光暈（加法混合） */
  fx: THREE.MeshBasicMaterial;
  /** 螢火蟲（Points、加法混合） */
  firefly: THREE.PointsMaterial;
  /** 台車木料（依 variant 上色） */
  cartWood: THREE.MeshStandardMaterial[];
  /** 台車甲板與頂部平台（原木色、不上漆） */
  cartDeck: THREE.MeshStandardMaterial;
  /** 台車鐵件（車輪、台車架、連結器） */
  cartIron: THREE.MeshStandardMaterial;
  /** 載運的原木樹皮（依 variant 換色） */
  logBark: THREE.MeshStandardMaterial[];
  /** 斜坡削平的木頭面 */
  rampTop: THREE.MeshStandardMaterial;
  /** 注連繩（稻草繩，沿繩重複的絞紋） */
  ropeStraw: THREE.MeshStandardMaterial;
  /** 台車綁原木的麻繩 */
  ropeHemp: THREE.MeshStandardMaterial;
  /** 油燈燈芯（自發光） */
  lamp: THREE.MeshStandardMaterial;
}

/** 可重複使用的幾何模板 */
interface ForestTpls {
  /** 枕木（倒角方塊，UV 一根貼一張） */
  sleeper: Tpl;
  /** 鋼軌墊板 */
  plate: Tpl;
  /** 1×1 卡片（中心在原點、面向 +z） */
  card: Tpl;
  /** 蕨類（4 款，UV 為格內 0..1） */
  ferns: Tpl[];
  /** 高細分凹凸球（樹冠團塊） */
  blobHi: Tpl[];
  /** 低細分凹凸球（遠處樹冠、灌木、苔蘚墊） */
  blobLo: Tpl[];
  /** 石頭 */
  rocks: Tpl[];
  /** 菇傘（半球、由上往下投影的 UV） */
  cap: Tpl;
  /** 菇柄（開口圓柱） */
  stem: Tpl;
  /** 圓盤（原木切面） */
  disc: Tpl;
  /** 小圓盤（菌褶，8 邊） */
  gills: Tpl;
  /** 層孔菌（半圓檐） */
  shelf: Tpl;
  /** 單位倒角方塊（1×1×1，倒角 0.08）：木樁、木牌 */
  box: Tpl;
  /** 單位圓柱（半徑 1、高 1、底在 y = 0，10 邊） */
  cyl: Tpl;
  /** 輻條鐵輪（半徑 1、輪軸沿 x） */
  wheel: Tpl;
}

/** 貼圖集各格的 UV 範圍 */
interface ForestUV {
  plant: Record<keyof typeof PLANT, UVRect>;
  prop: Record<keyof typeof PROP, UVRect>;
  /** 光束（光效貼圖左半） */
  beam: UVRect;
  /** 圓形光暈（右上） */
  halo: UVRect;
  /** 地面光斑（右下） */
  spot: UVRect;
}

/** 全部資源 */
export interface ForestAssets {
  mats: ForestMats;
  tpl: ForestTpls;
  uv: ForestUV;
}

/** 台車三種塗裝（variant 取餘數） */
const CART_COLORS = [0xb0533a, 0x4f7d45, 0x4a6890];
/** 原木三種樹皮色（乘在樹皮貼圖上） */
const LOG_TINTS = [0xc79a7a, 0x9a8a78, 0xd0b48e];

/** 建立蕨類模板：fronds 片羽狀葉從中心放射、先往上再垂下 */
function fernGeometry(fronds: number, seed: number, upright: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const segs = 5;
  let rs = seed;
  /** 簡單的線性同餘亂數（模板固定，不需要 seeded 的品質） */
  const rnd = () => {
    rs = (rs * 16807) % 2147483647;
    return rs / 2147483647;
  };
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * Math.PI * 2 + rnd() * 0.5;
    const len = 0.75 + rnd() * 0.35;
    const width = len * 0.42;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    // 葉面的橫向（水平、垂直於葉軸）
    const sx = -dz;
    const sz = dx;
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const out = len * (0.18 + 0.78 * t);
      const up = len * (upright * t - (upright - 0.12) * 1.15 * t * t) + 0.02;
      const cx = dx * out;
      const cz = dz * out;
      // 葉面中間略高（V 形），看起來比較立體
      const fold = width * 0.12 * (1 - t * 0.5);
      pos.push(cx - sx * width * 0.5, up - fold, cz - sz * width * 0.5);
      pos.push(cx + sx * width * 0.5, up - fold, cz + sz * width * 0.5);
      uv.push(0, t, 1, t);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 植物卡片的法線偏向上方，受光比較柔和（不會一片亮一片黑）
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i) * 0.5;
    const y = Math.abs(n.getY(i)) * 0.5 + 0.6;
    const z = n.getZ(i) * 0.5;
    const l = Math.hypot(x, y, z);
    n.setXYZ(i, x / l, y / l, z / l);
  }
  return g;
}

/** 菇傘：上半球，UV 由上往下投影（貼圖畫成圓形菇傘） */
function capGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 9, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const t = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) t.setXY(i, 0.5 + p.getX(i) * 0.48, 0.5 - p.getZ(i) * 0.48);
  return g;
}

/** 層孔菌：往 +z 伸出的半圓檐（背面貼在樹幹上） */
function shelfGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 0.82, 0.18, 8, 1, false, -Math.PI / 2, Math.PI);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const t = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) t.setXY(i, 0.5 + p.getX(i) * 0.49, Math.max(0, p.getZ(i)) * 0.98);
  return g;
}

/** 輻條鐵輪：輪框（環）、輪轂、6 根輻條、內側輪緣；輪軸沿 x、半徑 1 */
function wheelGeometry(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(0.9, 0.1, 4, 16);
  rim.rotateY(Math.PI / 2);
  parts.push(rim);
  const flange = new THREE.CylinderGeometry(1.0, 1.0, 0.05, 16, 1, false);
  flange.rotateZ(Math.PI / 2);
  flange.translate(-0.12, 0, 0);
  parts.push(flange);
  const hub = new THREE.CylinderGeometry(0.2, 0.24, 0.32, 8, 1, false);
  hub.rotateZ(Math.PI / 2);
  parts.push(hub);
  for (let k = 0; k < 5; k++) {
    const spoke = new THREE.BoxGeometry(0.07, 0.75, 0.1);
    spoke.translate(0, 0.5, 0);
    spoke.rotateX((k / 5) * Math.PI * 2);
    parts.push(spoke);
  }
  return parts;
}

/** 合併數個幾何成一個 Tpl（建模板時用） */
function tplOf(parts: THREE.BufferGeometry[]): Tpl {
  const tpls = parts.map((p) => toTpl(p));
  const count = tpls.reduce((s, t) => s + t.count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const t of tpls) {
    pos.set(t.pos, o * 3);
    nor.set(t.nor, o * 3);
    uv.set(t.uv, o * 2);
    o += t.count;
  }
  return { pos, nor, uv, count };
}

/** 建立全部資源（只會建一次） */
let cache: ForestAssets | null = null;

/** 取得森林資源（第一次呼叫時建立） */
export function forestAssets(): ForestAssets {
  if (cache) return cache;
  const path = pathTextures();
  const floor = floorTextures();
  const sleeper = sleeperTextures();
  const metal = metalTextures();
  const bark = barkTextures();
  const moss = mossTextures();
  const canopy = canopyTextures();
  const rock = rockTextures();
  const plank = cartPlankTextures();
  const plants = plantAtlas();
  const props = propAtlas();
  const fx = fxTexture();
  const straw = ropeTextures(0xd2bb7c, 0x8e7444, 6101);
  const hemp = ropeTextures(0x9a7a50, 0x5a4228, 6102);

  const fxMat = additiveFog(
    new THREE.MeshBasicMaterial({
      map: fx,
      color: 0xffe7a8,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    'fx',
  );
  const firefly = additiveFog(
    new THREE.PointsMaterial({
      map: fireflyTexture(),
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    }),
    'firefly',
  );

  const plantMat = stdMat({ map: plants, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82 }, 'forest|plants');
  plantMat.alphaToCoverage = true;

  const mats: ForestMats = {
    path: stdMat({ map: path.map, bumpMap: path.bump, bumpScale: 2.2, roughness: 0.94 }, 'forest|path'),
    floor: stdMat({ map: floor.map, bumpMap: floor.bump, bumpScale: 2.2, roughness: 0.96 }, 'forest|floor'),
    sleeper: stdMat({ map: sleeper.map, bumpMap: sleeper.bump, bumpScale: 3, roughness: 0.9 }, 'forest|sleeper'),
    metal: stdMat({ map: metal.map, bumpMap: metal.bump, bumpScale: 1.2, roughness: 0.55, metalness: 0.35 }, 'forest|metal'),
    bark: stdMat({ map: bark.map, bumpMap: bark.bump, bumpScale: 4, roughness: 0.93 }, 'forest|bark'),
    obsBark: stdMat({ map: bark.map, bumpMap: bark.bump, bumpScale: 4, color: 0xffd6b0, roughness: 0.9, emissive: 0x24160a, emissiveIntensity: 1 }, 'forest|obsBark'),
    // 苔蘚：顏色乘一點灰綠，陽光下才不會變成螢光綠
    moss: stdMat({ map: moss.map, bumpMap: moss.bump, bumpScale: 2.5, color: 0xb2c29c, roughness: 1 }, 'forest|moss'),
    canopy: stdMat({ map: canopy.map, bumpMap: canopy.bump, bumpScale: 2.5, roughness: 0.86 }, 'forest|canopy'),
    plants: plantMat,
    props: stdMat(
      { map: props.map, emissiveMap: props.emissive, emissive: 0xffffff, emissiveIntensity: 1.6, bumpMap: props.bump, bumpScale: 1.2, roughness: 0.72 },
      'forest|props',
    ),
    rock: stdMat({ map: rock.map, bumpMap: rock.bump, bumpScale: 2.5, roughness: 0.9 }, 'forest|rock'),
    fx: fxMat,
    firefly,
    cartWood: CART_COLORS.map((c, i) =>
      stdMat({ map: plank.map, bumpMap: plank.bump, bumpScale: 2, color: c, roughness: 0.8 }, `forest|cartWood|${i}`),
    ),
    cartDeck: stdMat({ map: plank.map, bumpMap: plank.bump, bumpScale: 2, color: 0xb88f62, roughness: 0.85 }, 'forest|cartDeck'),
    cartIron: stdMat({ map: metal.map, bumpMap: metal.bump, bumpScale: 1, color: 0x9a948e, roughness: 0.6, metalness: 0.45 }, 'forest|cartIron'),
    logBark: LOG_TINTS.map((c, i) => stdMat({ map: bark.map, bumpMap: bark.bump, bumpScale: 4, color: c, roughness: 0.92 }, `forest|logBark|${i}`)),
    rampTop: stdMat({ map: plank.map, bumpMap: plank.bump, bumpScale: 2, color: 0xc49a6a, roughness: 0.85 }, 'forest|rampTop'),
    ropeStraw: stdMat({ map: straw.map, bumpMap: straw.bump, bumpScale: 3, roughness: 0.9 }, 'forest|ropeStraw'),
    ropeHemp: stdMat({ map: hemp.map, bumpMap: hemp.bump, bumpScale: 3, roughness: 0.9 }, 'forest|ropeHemp'),
    // 油燈燈芯：與 materials.ts 的 glow() 相同做法，但用自己的快取鍵（每幀會調亮度，不能動到共用材質）
    lamp: stdMat({ color: 0xffc35a, emissive: 0xffc35a, emissiveIntensity: 2.6, roughness: 0.5 }, 'forest|lamp'),
  };

  const ferns = [
    toTpl(fernGeometry(7, 11, 1.1)),
    toTpl(fernGeometry(9, 23, 0.95)),
    toTpl(fernGeometry(6, 37, 1.3)),
    toTpl(fernGeometry(8, 51, 0.8)),
  ];
  const tpl: ForestTpls = {
    // 枕木與墊板：埋在土裡的底面、背對鏡頭的 −z 面看不到，省掉（枕木 20 面、墊板只留頂面與正面 4 面）
    sleeper: toTpl(bevelBox(2.25, 0.16, 0.27, 0.035, 2.25, HIDE_BOTTOM | HIDE_BACK)),
    plate: toTpl(bevelBox(0.22, 0.03, 0.2, 0, 0.22, HIDE_BOTTOM | HIDE_BACK | HIDE_SIDES)),
    card: toTpl(new THREE.PlaneGeometry(1, 1)),
    ferns,
    blobHi: [1, 2, 3, 4, 5, 6].map((s) => toTpl(blobGeometry(2, s * 17, 0.32, 1.5))),
    blobLo: [1, 2, 3, 4, 5, 6].map((s) => toTpl(blobGeometry(1, s * 29 + 5, 0.28, 1.4))),
    rocks: [1, 2, 3, 4].map((s) => toTpl(blobGeometry(1, s * 41 + 3, 0.42, 1.2))),
    cap: toTpl(capGeometry()),
    stem: toTpl(new THREE.CylinderGeometry(0.8, 1, 1, 6, 1, true).translate(0, 0.5, 0)),
    disc: toTpl(new THREE.CircleGeometry(1, 16)),
    gills: toTpl(new THREE.CircleGeometry(1, 8)),
    shelf: toTpl(shelfGeometry()),
    box: toTpl(bevelBox(1, 1, 1, 0.08, 1)),
    cyl: toTpl(new THREE.CylinderGeometry(1, 1, 1, 10, 1, false).translate(0, 0.5, 0)),
    wheel: tplOf(wheelGeometry()),
  };

  const plantUV = {} as Record<keyof typeof PLANT, UVRect>;
  for (const k of Object.keys(PLANT) as (keyof typeof PLANT)[]) plantUV[k] = cell(PLANT[k][0], PLANT[k][1], 4);
  const propUV = {} as Record<keyof typeof PROP, UVRect>;
  for (const k of Object.keys(PROP) as (keyof typeof PROP)[]) propUV[k] = cell(PROP[k][0], PROP[k][1], 4, 0.03);
  const uv: ForestUV = {
    plant: plantUV,
    prop: propUV,
    beam: { u: 0.01, v: 0.01, w: 0.48, h: 0.98 },
    halo: { u: 0.505, v: 0.505, w: 0.49, h: 0.49 },
    spot: { u: 0.505, v: 0.005, w: 0.49, h: 0.49 },
  };
  cache = { mats, tpl, uv };
  return cache;
}
