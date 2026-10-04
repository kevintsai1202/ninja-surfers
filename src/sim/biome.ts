import { BIOME_LEN, BIOME_ORDER, BIOME_BLEND } from '../config';
import type { BiomeId } from './types';

/** 追捕者身分 */
export type ChaserIdentity = 'iruka' | 'anbu';

/** 暗部接手追捕的距離（第二輪回到木葉村） */
export const ANBU_DISTANCE = BIOME_LEN * BIOME_ORDER.length;

/** 某距離所在的場景 */
export function biomeAt(d: number): BiomeId {
  const i = Math.floor(Math.max(0, d) / BIOME_LEN) % BIOME_ORDER.length;
  return BIOME_ORDER[i];
}

/** 場景漸變狀態：從 from 漸變到 to，t = 0..1 */
export interface BiomeBlend {
  from: BiomeId;
  to: BiomeId;
  t: number;
}

/**
 * 計算某距離的場景漸變：交界前 BIOME_BLEND 公尺開始，從目前場景漸變到下一個場景。
 * 不在漸變區時 t = 0。
 */
export function biomeBlend(d: number): BiomeBlend {
  const idx = Math.floor(Math.max(0, d) / BIOME_LEN);
  const from = BIOME_ORDER[idx % BIOME_ORDER.length];
  const to = BIOME_ORDER[(idx + 1) % BIOME_ORDER.length];
  const boundary = (idx + 1) * BIOME_LEN;
  const t = Math.max(0, Math.min(1, (d - (boundary - BIOME_BLEND)) / BIOME_BLEND));
  return { from, to, t };
}

/** 某距離的追捕者：1800 m 前是伊魯卡老師，之後是暗部 */
export function chaserIdentityAt(d: number): ChaserIdentity {
  return d >= ANBU_DISTANCE ? 'anbu' : 'iruka';
}
