import { SPEED, PHYS } from '../config';

/**
 * 跑速曲線：距離越遠越快，逐漸逼近上限。
 * v(d) = max − (max − start)·e^(−d/scale)
 * @param d 跑的距離（公尺）
 */
export function speedAt(d: number): number {
  return SPEED.max - (SPEED.max - SPEED.start) * Math.exp(-Math.max(0, d) / SPEED.scale);
}

/** 玩家看到障礙到開始動作的反應時間（秒） */
export const REACTION_TIME = 0.5;

/**
 * 兩個「需要動作」的障礙之間至少要隔多遠，玩家才來得及反應並完成動作。
 * = 速度 × (反應時間 ＋ 最長動作時間) ＋ 2 m 餘裕；最長動作是一般跳的滯空時間。
 * @param v 該處的跑速（m/s）
 */
export function minGap(v: number): number {
  const airTime = (2 * PHYS.jumpVelocity) / PHYS.gravity;
  const action = Math.max(PHYS.laneChangeTime, PHYS.rollTime, airTime);
  return v * (REACTION_TIME + action) + 2;
}
