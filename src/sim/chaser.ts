import type { ChaserIdentity } from './biome';

/**
 * 追捕者（伊魯卡老師／暗部＋忍犬）：
 * - 開場貼在身後，幾秒後退出畫面。
 * - 玩家踉蹌時貼近並進入「危險期」；危險期內再踉蹌一次就被抓。
 * - 暗部的危險期比較長、貼近比較快。
 */

/** 追捕者參數 */
export const CHASER = {
  iruka: { danger: 8, approach: 7 },
  anbu: { danger: 10, approach: 11 },
  /** 退出畫面時在玩家身後的距離 */
  farGap: 30,
  /** 危險期貼近時的距離（太遠會擋在鏡頭與主角之間，看起來很大） */
  nearGap: 1.7,
  /** 離開時的速度（m/s） */
  leaveSpeed: 9,
} as const;

/** 追捕者狀態 */
export interface ChaserState {
  identity: ChaserIdentity;
  /** 在玩家身後幾公尺（畫面用） */
  gap: number;
  /** 危險期剩餘秒數（> 0 時再踉蹌就被抓） */
  danger: number;
  /** 開場貼身剩餘秒數 */
  intro: number;
}

/** 建立追捕者；introSeconds > 0 時開場貼在身後 */
export function createChaser(introSeconds: number): ChaserState {
  return {
    identity: 'iruka',
    gap: introSeconds > 0 ? 2.0 : CHASER.farGap,
    danger: 0,
    intro: introSeconds,
  };
}

/**
 * 玩家踉蹌：危險期內 → 被抓；否則進入危險期並開始貼近。
 * @returns 'caught' 被抓、'danger' 進入危險期
 */
export function chaserStumble(c: ChaserState): 'caught' | 'danger' {
  if (c.danger > 0) return 'caught';
  c.danger = CHASER[c.identity].danger;
  return 'danger';
}

/** 推進追捕者：計時、依狀態讓距離往目標靠近 */
export function updateChaser(c: ChaserState, dt: number): void {
  c.intro = Math.max(0, c.intro - dt);
  c.danger = Math.max(0, c.danger - dt);
  const near = c.intro > 0 || c.danger > 0;
  const target = near ? CHASER.nearGap : CHASER.farGap;
  const speed = near ? CHASER[c.identity].approach : CHASER.leaveSpeed;
  if (c.gap < target) c.gap = Math.min(target, c.gap + speed * dt);
  else c.gap = Math.max(target, c.gap - speed * dt);
}

/** 復活時追捕者重新退到遠處 */
export function resetChaser(c: ChaserState): void {
  c.danger = 0;
  c.intro = 0;
  c.gap = CHASER.farGap;
}
