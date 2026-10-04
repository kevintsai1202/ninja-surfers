/**
 * 存檔（localStorage）：純函式＋不可變更新，讀寫都包 try/catch（無痕模式、封鎖網站資料時不能壞）。
 */

/** 存檔格式版本（格式不相容的修改要加一，並在 parseSave 處理舊版） */
export const SAVE_VERSION = 1;
/** localStorage 的 key */
export const SAVE_KEY = 'ninja-surfers-save';

/** 存檔內容 */
export interface SaveData {
  schemaVersion: number;
  /** 最高分 */
  best: number;
  /** 兩總額 */
  ryo: number;
  /** 卷軸滑板庫存 */
  boards: number;
  /** 兵糧丸庫存 */
  pills: number;
  /** 靜音 */
  muted: boolean;
  /** 看過操作說明 */
  seenTutorial: boolean;
  /** 總局數 */
  runs: number;
}

/** 新玩家的預設存檔（送 2 個卷軸滑板、1 顆兵糧丸） */
export function defaultSave(): SaveData {
  return { schemaVersion: SAVE_VERSION, best: 0, ryo: 0, boards: 2, pills: 1, muted: false, seenTutorial: false, runs: 0 };
}

/** 非負整數（壞資料夾成 0） */
function nonNeg(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;
}

/**
 * 解析存檔字串：壞掉或空的回到預設；缺欄位補預設；數值夾成非負整數。
 */
export function parseSave(raw: string | null): SaveData {
  const d = defaultSave();
  if (!raw) return d;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return d;
  }
  if (!obj || typeof obj !== 'object') return d;
  return {
    schemaVersion: SAVE_VERSION,
    best: nonNeg(obj.best, d.best),
    ryo: nonNeg(obj.ryo, d.ryo),
    boards: nonNeg(obj.boards, d.boards),
    pills: nonNeg(obj.pills, d.pills),
    muted: typeof obj.muted === 'boolean' ? obj.muted : d.muted,
    seenTutorial: typeof obj.seenTutorial === 'boolean' ? obj.seenTutorial : d.seenTutorial,
    runs: nonNeg(obj.runs, d.runs),
  };
}

/** 序列化存檔 */
export function serializeSave(d: SaveData): string {
  return JSON.stringify(d);
}

/** 一局的結算資料 */
export interface RunResult {
  score: number;
  /** 這局撿到的兩 */
  coins: number;
  /** 結束時剩下的卷軸滑板 */
  boards: number;
  /** 結束時剩下的兵糧丸 */
  pills: number;
}

/** 套用一局的結算（回傳新物件，不修改原存檔） */
export function applyRunResult(d: SaveData, r: RunResult): SaveData {
  return {
    ...d,
    best: Math.max(d.best, Math.floor(r.score)),
    ryo: d.ryo + Math.max(0, Math.floor(r.coins)),
    boards: Math.max(0, Math.floor(r.boards)),
    pills: Math.max(0, Math.floor(r.pills)),
    runs: d.runs + 1,
  };
}

/** 取得瀏覽器的 localStorage（取不到就回傳 null） */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 讀存檔（任何錯誤都回傳預設存檔） */
export function loadSave(storage: Storage | null = defaultStorage()): SaveData {
  try {
    return parseSave(storage ? storage.getItem(SAVE_KEY) : null);
  } catch {
    return defaultSave();
  }
}

/** 寫存檔；成功回傳 true */
export function writeSave(d: SaveData, storage: Storage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, serializeSave(d));
    return true;
  } catch {
    return false;
  }
}
