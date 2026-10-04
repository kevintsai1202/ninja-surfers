import * as THREE from 'three';
import { CHUNK_LEN } from '../../../config';
import { bark, seeded, woodGrain } from '../../proctex';
import { FX, fxMaterial, rockMaterial, waterMaterial } from './mats';
import {
  card,
  crossCard,
  flat,
  flatCard,
  foamRing,
  fxCard,
  fxCross,
  fxFlat,
  mergeAll,
  paint,
  rockBlock,
} from './geom';
import {
  cascadeTexture,
  endGrainTexture,
  foamTexture,
  mistTexture,
  paletteTexture,
  PALETTE,
  rockTextures,
  ropeTexture,
  splashTexture,
  sunsetEnvTexture,
  vegAtlas,
  warmTextures,
  waterNormal,
  type VegAtlas,
} from './textures';
import { clamp, fbm3 } from './noise';
import { buildWall, type Wall } from './cliffs';

/**
 * 終末之谷場景模組的共用資源：材質與範本幾何。
 * 建立場景模組（createKit）時一次建好，buildChunk／buildObstacle 只做擺放與合併。
 */

/** 共用材質 */
interface ValleyMats {
  water: THREE.MeshStandardMaterial;
  /** 岩壁與岸邊大石（暖橘砂岩） */
  wall: THREE.MeshStandardMaterial;
  /** 車道中央的踏腳石（淺米色花崗岩） */
  step: THREE.MeshStandardMaterial;
  /** 障礙、石柱、石墩、入口石柱（灰米色花崗岩） */
  stone: THREE.MeshStandardMaterial;
  /** 植物圖集（荷葉、灌木、垂藤、蘆葦、蓮花瓣、草、紙垂） */
  veg: THREE.MeshStandardMaterial;
  /** 調色盤（樹幹、松葉、蓮心等單色小零件） */
  palette: THREE.MeshStandardMaterial;
  /** 樹皮（漂流木、巨木筏） */
  wood: THREE.MeshStandardMaterial;
  /** 原木切面 */
  endGrain: THREE.MeshStandardMaterial;
  /** 剖開的木頭平面（木筏甲板） */
  deck: THREE.MeshStandardMaterial;
  /** 粗麻繩 */
  rope: THREE.MeshStandardMaterial;
  /** 水效（浪花、漣漪、細瀑布、水花、霧） */
  fx: THREE.MeshStandardMaterial;
}

/** 範本幾何（非索引，擺放時只設變換） */
interface ValleyTemplates {
  /** 一段場景的水面（x ±30、z 0 → −CHUNK_LEN） */
  water: THREE.BufferGeometry;
  /** 大石（約 1×0.75×0.9，擺放時縮放） */
  boulders: THREE.BufferGeometry[];
  /** 扁圓踏腳石（直徑約 1） */
  stones: THREE.BufferGeometry[];
  /** 荷葉（1×1） */
  lily: THREE.BufferGeometry;
  /** 蓮花：花瓣（植物圖集）與花心（調色盤） */
  lotusPetals: THREE.BufferGeometry;
  lotusCenter: THREE.BufferGeometry;
  /** 蘆葦叢、灌木叢、草叢、闊葉叢 */
  reed: THREE.BufferGeometry;
  bush: THREE.BufferGeometry;
  grass: THREE.BufferGeometry;
  /** 垂藤、垂苔（直立卡片，頂邊在原點、往下垂；正面朝 +z，擺放時轉向面對河道） */
  vine: THREE.BufferGeometry;
  moss: THREE.BufferGeometry;
  /** 盆景松：樹幹與樹冠（調色盤） */
  pine: THREE.BufferGeometry;
  /** 漂流木：樹皮與切面 */
  logBody: THREE.BufferGeometry;
  logCaps: THREE.BufferGeometry;
  /** 水效 */
  ripple: THREE.BufferGeometry;
  /** 浪花圈：內徑 0.5（貼物體）、外徑 1.0；擺放時依物體大小縮放 */
  foamDisc: THREE.BufferGeometry;
  /** 細浪花圈：內徑 0.5、外徑 0.77（踏腳石用） */
  foamThin: THREE.BufferGeometry;
  splash: THREE.BufferGeometry;
  mist: THREE.BufferGeometry;
}

/** 共用資源 */
export interface ValleyContext {
  mats: ValleyMats;
  tpl: ValleyTemplates;
  atlas: VegAtlas;
  /**
   * 預先建好的岩壁（每側 WALL_VARIANTS 種）：建段落時依種子挑一種，不必每段重算格網與雜訊。
   * 岩壁的頭尾接縫是固定的，任兩種相接都無縫。
   */
  walls: { left: Wall[]; right: Wall[] };
}

/** 每一側預先建好的岩壁種類數 */
const WALL_VARIANTS = 8;

/** 霧與水氣的顏色（傍晚金色） */
const MIST_COLOR = 0xffe7c2;

/**
 * 段落水面：x ±30（延伸到岩壁腳下）、z 0 → −CHUNK_LEN，沿 z 每 2 m 一段（地平線下彎才平順）。
 * uv = 公尺 / 10（u = x/10、v = −z/10），段長 30 是 10 的整數倍 → 前後段無縫。
 */
function waterGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(60, CHUNK_LEN, 12, Math.round(CHUNK_LEN / 2));
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -CHUNK_LEN / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 10, -p.getZ(i) / 10);
  return flat(g);
}

/**
 * 扁圓石（踏腳石）：壓扁的球、頂面略平、邊緣有起伏；uv = (色調, 遮蔽)。
 * 中心在原點，頂面約在 y = +0.07。
 */
function pebble(seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 12, 6);
  g.deleteAttribute('uv');
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const n = fbm3(x * 2.2, y * 2.2, z * 2.2, seed, 3) - 0.5;
    const s = 1 + n * 0.22;
    x *= s;
    z *= s * 0.88;
    y = y * 0.26;
    // 頂面壓平一點
    if (y > 0.07) y = 0.07 + (y - 0.07) * 0.35;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = 0.3 + ((seed * 0.37) % 0.4);
    uv[i * 2 + 1] = clamp(0.55 + 0.45 * ((p.getY(i) + 0.13) / 0.22), 0, 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return flat(g);
}

/**
 * 蓮花瓣：外圈 7 片張開、內圈 6 片半開，都是植物圖集的花瓣卡片。中心在原點（浮在荷葉上）。
 */
function lotusPetals(atlas: VegAtlas): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rings: [number, number, number, number][] = [
    // [片數, 開角（離垂直）, 長, 寬]
    [7, 1.0, 0.21, 0.14],
    [5, 0.45, 0.18, 0.12],
  ];
  rings.forEach(([count, tilt, len, w], ri) => {
    for (let i = 0; i < count; i++) {
      const c = card(w, len, atlas.petal);
      c.rotateX(-tilt);
      c.rotateY((i / count) * Math.PI * 2 + ri * 0.4);
      parts.push(c);
    }
  });
  const g = mergeAll(parts);
  g.translate(0, 0.02, 0);
  return g;
}

/** 蓮心（黃色小圓柱，調色盤） */
function lotusCenter(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.04, 0.032, 0.05, 6);
  g.translate(0, 0.06, 0);
  return flat(paint(g, PALETTE.lotusCenter));
}

/**
 * 盆景松（日式造型松）：彎曲的樹幹＋三四片扁平的樹冠雲團，全部用調色盤上色。
 * 底部在原點，高約 4 m。
 */
function bonsaiPine(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk1 = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 7);
  trunk1.translate(0, 1.1, 0);
  trunk1.rotateZ(0.18);
  parts.push(paint(trunk1, PALETTE.barkDark));
  const trunk2 = new THREE.CylinderGeometry(0.1, 0.16, 1.8, 6);
  trunk2.translate(0, 0.9, 0);
  trunk2.rotateZ(-0.45);
  trunk2.translate(-0.38, 2.05, 0);
  parts.push(paint(trunk2, PALETTE.barkLight));
  const pads: [number, number, number, number, number][] = [
    // [x, y, z, 半徑, 色]
    [0.55, 3.25, 0.1, 1.15, PALETTE.pineMid],
    [-0.75, 2.45, -0.2, 0.95, PALETTE.pineDark],
    [-0.05, 3.85, -0.15, 0.8, PALETTE.leafLight],
    [0.9, 2.3, 0.35, 0.7, PALETTE.pineDark],
  ];
  for (const [x, y, z, r, col] of pads) {
    const pad = new THREE.IcosahedronGeometry(r, 0);
    pad.scale(1.25, 0.42, 1.05);
    pad.translate(x, y, z);
    parts.push(paint(pad, col));
  }
  return mergeAll(parts);
}

/** 漂流木：略為錐形的原木＋兩根斷枝，沿 z 長 1（擺放時縮放）；樹皮 uv 依長度重複 */
function driftLog(): { body: THREE.BufferGeometry; caps: THREE.BufferGeometry } {
  const body = new THREE.CylinderGeometry(0.85, 1, 1, 10, 1, true);
  body.rotateX(Math.PI / 2);
  const uv = body.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2.5);
  const stub1 = new THREE.CylinderGeometry(0.18, 0.3, 0.9, 6, 1, true);
  stub1.rotateZ(1.0);
  stub1.translate(0.75, 0.35, 0.15);
  const stub2 = new THREE.CylinderGeometry(0.14, 0.24, 0.7, 6, 1, true);
  stub2.rotateZ(-1.2);
  stub2.translate(-0.7, 0.2, -0.25);
  const capA = new THREE.CircleGeometry(0.85, 10);
  capA.translate(0, 0, 0.5);
  const capB = new THREE.CircleGeometry(1, 10);
  capB.rotateY(Math.PI);
  capB.translate(0, 0, -0.5);
  return { body: mergeAll([body, stub1, stub2]), caps: mergeAll([capA, capB]) };
}

/**
 * 建立共用資源（材質、範本幾何）。
 */
export function createValleyContext(): ValleyContext {
  warmTextures();
  const rockT = rockTextures();
  const atlas = vegAtlas();
  const barkT = bark(0x7a5a3e, 0x5d7a30, 23);
  const deckT = woodGrain(0xc4935e, 29);

  const mats: ValleyMats = {
    water: waterMaterial({
      normalMap: waterNormal(),
      envMap: sunsetEnvTexture(),
      deep: 0x2a8fae,
      shallow: 0x58b8a8,
      lane: 0xd9fbff,
      glint: 0xfff0c8,
    }),
    wall: rockMaterial({
      albedo: rockT.sand,
      top: rockT.sandTop,
      bump: rockT.bump,
      texScale: 6,
      tint: 0xffffff,
      moss: 0.95,
      mossColor: 0x5d8a2c,
      wetHeight: 1.4,
      bumpScale: 1.6,
      roughness: 0.92,
    }),
    step: rockMaterial({
      albedo: rockT.granite,
      top: rockT.graniteTop,
      bump: rockT.bump,
      texScale: 3,
      tint: 0xfff6e6,
      moss: 0.45,
      mossColor: 0x6f9a3a,
      wetHeight: 0.1,
      bumpScale: 0.8,
      roughness: 0.82,
    }),
    stone: rockMaterial({
      albedo: rockT.granite,
      top: rockT.graniteTop,
      bump: rockT.bump,
      texScale: 4,
      tint: 0xf2f0ea,
      moss: 0.85,
      mossColor: 0x5f8f30,
      wetHeight: 0.9,
      bumpScale: 1.3,
      roughness: 0.88,
    }),
    veg: new THREE.MeshStandardMaterial({
      map: atlas.tex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.78,
    }),
    palette: new THREE.MeshStandardMaterial({ map: paletteTexture(), roughness: 0.82 }),
    wood: new THREE.MeshStandardMaterial({ map: barkT.map, bumpMap: barkT.bump, bumpScale: 2, roughness: 0.9 }),
    endGrain: new THREE.MeshStandardMaterial({ map: endGrainTexture(), roughness: 0.85 }),
    deck: new THREE.MeshStandardMaterial({ map: deckT.map, bumpMap: deckT.bump, bumpScale: 1.2, roughness: 0.82 }),
    rope: new THREE.MeshStandardMaterial({ map: ropeTexture(), roughness: 0.95 }),
    fx: fxMaterial(
      { foam: foamTexture(), cascade: cascadeTexture(), splash: splashTexture(), mist: mistTexture() },
      MIST_COLOR,
    ),
  };

  const rnd = seeded(2024);
  const boulders: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    boulders.push(
      flat(
        rockBlock(1, 0.78, 0.92, {
          density: 5,
          radius: 0.34,
          amp: 0.1,
          freq: 1.7,
          seed: 300 + i * 13,
          tint: rnd(),
        }),
      ),
    );
  }
  const stones = [0, 1, 2, 3].map((i) => pebble(500 + i * 7));
  const log = driftLog();
  const tpl: ValleyTemplates = {
    water: waterGeometry(),
    boulders,
    stones,
    lily: flatCard(1, 1, atlas.lily),
    lotusPetals: lotusPetals(atlas),
    lotusCenter: lotusCenter(),
    reed: crossCard(1.1, 1.8, atlas.reed, 3),
    bush: crossCard(1.9, 1.5, atlas.bush, 3),
    grass: crossCard(1.1, 0.75, atlas.grass, 2),
    vine: card(1.3, 3.2, atlas.vine).translate(0, -3.2, 0),
    moss: card(1.2, 1.3, atlas.moss).translate(0, -1.3, 0),
    pine: bonsaiPine(),
    logBody: log.body,
    logCaps: log.caps,
    ripple: fxFlat(1, 1, FX.ripple),
    foamDisc: foamRing(0.5, 0.5, 0.5, 0.5),
    foamThin: foamRing(0.5, 0.5, 0.5, 0.27),
    splash: fxCross(1, 1, FX.splash, 2),
    mist: fxCard(1, 1, FX.mist),
  };
  const walls = {
    left: Array.from({ length: WALL_VARIANTS }, (_, i) => buildWall(-1, 7100 + i * 37)),
    right: Array.from({ length: WALL_VARIANTS }, (_, i) => buildWall(1, 8300 + i * 41)),
  };
  return { mats, tpl, atlas, walls };
}
