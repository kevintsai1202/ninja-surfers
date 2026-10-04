/**
 * 種子亂數（mulberry32）：同種子產生相同序列，關卡生成與自動駕駛測試都靠它重現。
 */
export interface Rng {
  /** 0（含）～1（不含）的亂數 */
  next(): number;
  /** min～max 的浮點數 */
  range(min: number, max: number): number;
  /** min～max 的整數（兩端都含） */
  int(min: number, max: number): number;
  /** 從陣列挑一個 */
  pick<T>(items: readonly T[]): T;
  /** 機率 p 為真 */
  chance(p: number): boolean;
  /** 依權重挑選：[值, 權重] 陣列 */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  /** 目前內部狀態（存檔或除錯用） */
  readonly state: number;
}

/** 建立種子亂數產生器 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    weighted(items) {
      const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
      let r = next() * total;
      for (const [v, w] of items) {
        if (w <= 0) continue;
        r -= w;
        if (r < 0) return v;
      }
      // 浮點誤差落到最後：回傳最後一個權重 > 0 的
      for (let i = items.length - 1; i >= 0; i--) if (items[i][1] > 0) return items[i][0];
      return items[0][0];
    },
    get state() {
      return a;
    },
  };
}
