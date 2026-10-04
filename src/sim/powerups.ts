import type { Rng } from './rng';
import type { ScrollReward, TimedPower } from './types';

/**
 * 道具時效與秘傳卷軸獎勵。
 */

/** 各能力的持續秒數 */
export const POWER_TIME: Record<TimedPower, number> = {
  toad: 8,
  chakra: 10,
  magnet: 10,
  clones: 10,
  board: 30,
  rasengan: 3,
};

/** 手裏劍：每局初始數、持有上限、撿一次補幾支、射程（m）、相對玩家的飛行速度（m/s） */
export const SHURIKEN = { start: 3, max: 9, pickup: 3, range: 45, speed: 42 } as const;
/** 起爆符苦無：持有上限、爆炸清除範圍（擲出點往前幾公尺）、相對飛行速度 */
export const KUNAI = { max: 2, range: 30, speed: 40 } as const;
/** 螺旋丸：衝刺秒數、速度倍率、結束後的無敵秒數 */
export const RASENGAN = { time: 3, speedMul: 1.35, afterSafe: 0.5 } as const;
/** 瞬身術：兩次同方向換線的最大間隔、冷卻秒數 */
export const FLICKER = { window: 0.25, cooldown: 1.2 } as const;
/** 查克拉攀牆的上升速度（m/s） */
export const CLIMB_SPEED = 18;
/** 影分身能擋的撞擊次數（每個分身一次） */
export const CLONE_BLOCKS = 2;
/** 替身木頭救命後的無敵秒數 */
export const SUB_SAFE_TIME = 1.5;

/** 卷軸滑板撞擊後的無敵秒數 */
export const BOARD_SAFE_TIME = 1.5;
/** 蛤蟆結束、落地後的無敵秒數 */
export const TOAD_LANDING_SAFE = 1.0;
/** 復活後的無敵秒數 */
export const REVIVE_SAFE = 2.0;

/** 萬象天引：吸取前方多遠的兩 */
export const MAGNET_RANGE = 18;
/** 被吸住的兩飛向玩家的速度（相對玩家，m/s） */
export const MAGNET_PULL_SPEED = 32;

/** 蛤蟆飛行的基準高度與跳躍幅度 */
export const TOAD_ALTITUDE = 8;
export const TOAD_HOP = 2.2;
/** 蛤蟆一次大跳的週期（秒） */
export const TOAD_HOP_PERIOD = 0.9;

/**
 * 抽秘傳卷軸的獎勵：兩 50～300（40%）、卷軸滑板（25%）、兵糧丸（15%）、兩 500（15%）、大獎（5%）。
 */
export function rollScroll(rng: Rng): ScrollReward {
  const pick = rng.weighted<'ryo' | 'board' | 'pill' | 'ryo500' | 'jackpot'>([
    ['ryo', 40],
    ['board', 25],
    ['pill', 15],
    ['ryo500', 15],
    ['jackpot', 5],
  ]);
  switch (pick) {
    case 'ryo':
      return { kind: 'ryo', amount: rng.int(5, 30) * 10 };
    case 'ryo500':
      return { kind: 'ryo', amount: 500 };
    case 'jackpot':
      return { kind: 'jackpot', amount: 1000 };
    case 'board':
      return { kind: 'board' };
    default:
      return { kind: 'pill' };
  }
}
