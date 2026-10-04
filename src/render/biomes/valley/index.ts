import type * as THREE from 'three';
import type { Atmosphere, BiomeKit } from '../types';
import { buildValleyBackdrop } from './backdrop';
import { buildValleyChunk } from './chunk';
import { createValleyContext } from './context';
import { buildValleyGate } from './gate';
import { timeUniform } from './mats';
import { createObstacleBuilder } from './obstacles';

/**
 * 終末之谷場景模組（id：valley）。
 * 河面跑道（y = 0 是水面）、兩側層狀岩壁、遠方兩座對望的石像與大瀑布、金色傍晚逆光與霧氣。
 *
 * 檔案分工：
 * - textures.ts：程式產生的貼圖（岩石、水面法線、浪花、細瀑布、霧、植物圖集、調色盤、繩、年輪、夕陽環境圖）
 * - mats.ts：自訂 shader 材質（岩石三軸投影＋苔蘚、水面、水效）
 * - geom.ts：幾何工具（圓角岩塊、卡片、浪花環、細瀑布緞帶、繩子）
 * - context.ts：共用材質與範本幾何（建立 kit 時一次建好）
 * - cliffs.ts：無縫的層狀岩壁
 * - chunk.ts／obstacles.ts／gate.ts／backdrop.ts：四種建構函式
 */

/** 傍晚金色逆光的氣氛（天空與霧的顏色取自遠景畫的地平線一帶，讓天空、霧與遠景無縫） */
const ATMOSPHERE: Atmosphere = {
  // 天頂偏藍灰（傍晚的天空），往下漸變到金橘色的地平線（與遠景畫上緣的金色光暈接起來）
  skyTop: 0x938fa8,
  skyHorizon: 0xf3cf9c,
  fog: 0xd9b38c,
  fogNear: 40,
  fogFar: 190,
  sunColor: 0xffd7a0,
  sunIntensity: 2.6,
  sunDir: [-0.15, 0.42, -0.9],
  hemiSky: 0xffe3bd,
  hemiGround: 0x5f6d55,
  hemiIntensity: 1.0,
  envIntensity: 0.6,
  exposure: 1.0,
};

/** 建立終末之谷場景模組 */
export function createKit(): BiomeKit {
  const ctx = createValleyContext();
  const obstacle = createObstacleBuilder(ctx);
  // 預熱：先建兩段丟掉，讓 JIT 編好建段落的程式碼（第一次建段落會慢好幾倍，遊戲中第一次換到峽谷才不會卡一下）。
  // 這兩段從未加進場景、沒上傳 GPU，丟掉後由 GC 回收即可。
  buildValleyChunk(ctx, 97);
  buildValleyChunk(ctx, 98);
  /** 入口地標模板（第一次建立後快取，之後回傳 clone） */
  let gate: THREE.Group | null = null;
  return {
    id: 'valley',
    name: '終末之谷',
    atmosphere: ATMOSPHERE,
    buildChunk: (seed) => buildValleyChunk(ctx, seed),
    buildObstacle: (o) => obstacle(o),
    buildBackdrop: () => buildValleyBackdrop(),
    buildGate: () => {
      if (!gate) gate = buildValleyGate(ctx);
      return gate.clone();
    },
    update: (time) => {
      timeUniform.value = time;
    },
  };
}
