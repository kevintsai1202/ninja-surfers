import type { BiomeKit } from '../types';
import { forestAssets } from './assets';
import { buildLogTrain } from './cart';
import { buildForestChunk, FOREST_SUN, warmUpForest } from './chunk';
import { ForestFx } from './fx';
import { buildForestGate } from './gate';
import { buildForestObstacle } from './obstacles';
import { buildForestBackdrop } from './backdrop';

/**
 * 死亡森林場景模組（id：forest）。
 * - 跑道：泥土與落葉的林道上鋪三條運木小火車軌道（長苔的舊枕木＋鏽色鋼軌）
 * - 兩側：直徑 3～7 m 的巨樹（板根、苔蘚、纏藤、垂藤、層孔菌）、蕨類、灌木、香菇、倒木、苔蘚石、鐵絲網與警告牌
 * - 氣氛：灰綠天空、濃霧、從樹冠縫隙斜射的暖黃陽光與光束、飄落的葉子、螢火蟲
 * - 障礙：運木台車（列車）、斜倒巨樹幹（斜坡）、倒下的樹枝（低欄）、藤圈（高橫樑）、大樹樁／巨石（擋牆）
 * - 遠景：森林深處的遠景畫；入口地標：注連繩巨樹拱門
 * 貼圖、材質與幾何模板在 createKit() 一次建好；建一段場景只做擺放與批次組裝。
 */
export function createKit(): BiomeKit {
  const A = forestAssets();
  const fx = new ForestFx(A);
  warmUpForest(A, fx);
  return {
    id: 'forest',
    name: '死亡森林',
    atmosphere: {
      skyTop: 0x1e3a24,
      skyHorizon: 0x6a8a62,
      fog: 0x5d7a58,
      fogNear: 35,
      fogFar: 160,
      sunColor: 0xffe2a2,
      sunIntensity: 2.6,
      sunDir: FOREST_SUN,
      hemiSky: 0xa9c99b,
      hemiGround: 0x3a3020,
      hemiIntensity: 0.6,
      envIntensity: 0.26,
      exposure: 1.0,
    },
    buildChunk(seed) {
      return buildForestChunk(A, fx, seed);
    },
    buildObstacle(o) {
      if (o.kind === 'train') return buildLogTrain(A, o.length, o.variant, o.moving);
      return buildForestObstacle(A, o.kind, o.variant);
    },
    buildBackdrop() {
      return buildForestBackdrop();
    },
    buildGate() {
      return buildForestGate(A);
    },
    update(time) {
      fx.update(time);
    },
  };
}
