/**
 * 全遊戲共用的數值常數（模擬判定與畫面外觀共用同一份，外觀尺寸必須對得上判定）。
 * 單位：公尺、秒。座標：模擬層的 z 是「往前跑的距離」（越大越前面）；
 * 畫面層世界座標的前方是 −z，車道 x = lane × LANE_WIDTH。
 */

/** 車道寬（三條車道中心 x = −2.5／0／+2.5） */
export const LANE_WIDTH = 2.5;
/** 車道編號 */
export const LANES = [-1, 0, 1] as const;
/** 跑道總寬（三條車道） */
export const TRACK_WIDTH = LANE_WIDTH * 3;
/** 兩側場景從這個 |x| 以外開始擺（跑道邊緣再留一點路肩） */
export const SIDE_START_X = TRACK_WIDTH / 2 + 0.9;

/** 列車：寬、高、單節車廂長（列車長度是單節長的整數倍） */
export const TRAIN = { width: 2.2, height: 3.2, carLength: 10 } as const;
/** 低欄（要跳過）：寬、高、深 */
export const HURDLE = { width: 2.1, height: 1.0, depth: 0.4 } as const;
/** 高橫樑（要滾過）：寬、底部離地高、頂部高、深 */
export const HIGH_BAR = { width: 2.3, bottom: 1.1, top: 2.6, depth: 0.4 } as const;
/** 擋牆（要換線）：寬、高、深 */
export const BLOCK = { width: 2.1, height: 2.6, depth: 1.2 } as const;
/** 斜坡（接在列車前面，可以跑上車頂）：寬、長、頂端高度 */
export const RAMP = { width: 2.2, length: 7, height: 3.2 } as const;

/** 玩家判定盒：寬、深、站立高、翻滾高 */
export const PLAYER = { width: 0.8, depth: 0.6, height: 1.6, rollHeight: 0.8 } as const;

/** 物理參數 */
export const PHYS = {
  gravity: 27,
  /** 一般跳初速（最高約 1.31 m、滯空約 0.62 s） */
  jumpVelocity: 8.4,
  /** 查克拉附著跳初速（最高約 4.2 m，可直接跳上車頂） */
  superJumpVelocity: 15,
  /** 換線所需時間 */
  laneChangeTime: 0.14,
  /** 翻滾持續時間 */
  rollTime: 0.55,
  /** 空中按下時的急降速度 */
  fastFallVelocity: -22,
  /** 可以直接踩上去的高度差（斜坡逐步爬升、車頂接縫） */
  stepUp: 0.35,
} as const;

/** 速度曲線：v(d) = max − (max − start)·e^(−d/scale) */
export const SPEED = { start: 12, max: 28, scale: 2200 } as const;

/** 場景：一段場景長度、每個場景的長度、輪替順序 */
export const CHUNK_LEN = 30;
export const BIOME_LEN = 600;
export const BIOME_ORDER = ['village', 'forest', 'valley'] as const;
/** 場景交界前多少公尺開始漸變霧色與天空 */
export const BIOME_BLEND = 60;

/** 視距：前方生成到多遠、後方保留多遠 */
export const VIEW_AHEAD = 230;
export const VIEW_BEHIND = 25;

/**
 * 地平線下彎（地鐵跑酷式 curved world）：玩家前方 start 公尺之後，
 * 每往前 d 公尺往下彎 amount·d² 公尺。世界座標的玩家位置固定在 z = 0。
 */
export const CURVE = { start: 10, amount: 0.0011 } as const;

/** 計算世界座標 z（前方為負）在地平線下彎後的高度落差（CPU 端用，例如擺放 DOM 標籤） */
export function curveDrop(worldZ: number): number {
  const d = Math.max(0, -worldZ - CURVE.start);
  return d * d * CURVE.amount;
}
