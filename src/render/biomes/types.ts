import type * as THREE from 'three';
import type { BiomeId, ObstacleKind } from '../../sim/types';

/**
 * 場景模組的共用介面（村莊、森林、峽谷各實作一份）。
 *
 * 座標約定（全部是畫面層的 local 座標）：
 * - 前方是 −z；x = 0 是中央車道，車道中心 x = lane × LANE_WIDTH（config.ts）。
 * - y = 0 是地面（跑道表面；峽谷的水面也是 y = 0）。
 * - 尺寸一律 import config.ts 的常數，不要寫死數字。
 */

/** 場景氣氛：天空、霧、光線（場景交界時由遊戲端漸變） */
export interface Atmosphere {
  /** 天頂顏色 */
  skyTop: number;
  /** 地平線顏色 */
  skyHorizon: number;
  /** 霧色（通常接近地平線顏色） */
  fog: number;
  fogNear: number;
  fogFar: number;
  /** 太陽光 */
  sunColor: number;
  sunIntensity: number;
  /** 太陽方向（從場景指向太陽，會正規化） */
  sunDir: [number, number, number];
  /** 半球光（天空色、地面反射色） */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** 環境貼圖（反射與柔和補光）強度 */
  envIntensity: number;
  /** tone mapping 曝光 */
  exposure: number;
}

/** 建立障礙外觀的參數 */
export interface ObstacleOptions {
  kind: ObstacleKind;
  /** 長度（公尺）：train 是 TRAIN.carLength 的整數倍（10～50）；ramp 固定 RAMP.length；其他種類忽略 */
  length: number;
  /** 迎面駛來的列車（例如亮車燈、冒煙） */
  moving: boolean;
  /** 外觀變化（0 起算的整數，各場景自行對應成顏色或款式；超出範圍請取餘數） */
  variant: number;
}

/** 一個場景模組 */
export interface BiomeKit {
  id: BiomeId;
  /** 中文名稱（換場景時的橫幅），例如「木葉村」 */
  name: string;
  atmosphere: Atmosphere;
  /**
   * 建立一段長 CHUNK_LEN 的場景：三條跑道的地面（軌道或水面）＋兩側建築與道具＋路肩。
   * local z ∈ [−CHUNK_LEN, 0]，前後兩段要能無縫接起來（地面、軌道、連續的牆）。
   * seed 決定這一段的變化，同 seed 結果相同。
   * 回傳的物件會被遊戲端重複使用（物件池），呼叫端不會 dispose。
   */
  buildChunk(seed: number): THREE.Object3D;
  /**
   * 建立障礙外觀。local 原點在障礙「前緣（靠玩家那一端）中央、地面」，往 −z 延伸。
   * 外觀的寬高深要符合 config.ts 的判定尺寸（TRAIN、HURDLE、HIGH_BAR、BLOCK、RAMP），玩家才不會覺得被冤枉。
   * 相同參數請快取共用幾何與材質。
   */
  buildObstacle(opts: ObstacleOptions): THREE.Object3D;
  /**
   * 遠景：跟著玩家移動、永遠不會接近的背景（山、刻臉岩壁、巨樹剪影、石像與瀑布）。
   * 擺在 z = −150 ～ −450；材質要加 defines NO_CURVE（不受地平線下彎影響）。
   */
  buildBackdrop(): THREE.Object3D;
  /**
   * 場景入口地標（玩家從底下或中間穿過，例如村子大門、注連繩巨樹拱門、石像）。
   * local 原點在入口中央地面；不可以擋到三條車道 y ∈ [0, 4.5] 的空間。
   */
  buildGate(): THREE.Object3D;
  /** 每幀動畫（水面流動、燈籠搖晃、落葉、光束閃爍）；time 為經過秒數 */
  update?(time: number, dt: number): void;
}

/** 場景模組的建立函式（延後到瀏覽器裡才建立貼圖） */
export type BiomeFactory = () => BiomeKit;
