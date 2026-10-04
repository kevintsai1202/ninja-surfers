import type { Action } from '../sim/types';

/**
 * 手機滑動手勢判定（純邏輯，不碰 DOM，方便單元測試）：
 * - 手指移動超過門檻就立刻判定方向（不等放開，反應比較快），一次觸控只觸發一次。
 * - 上滑跳、下滑滾、左右換線；短時間內輕點兩下＝啟動卷軸滑板。
 */

/** 手勢參數 */
export interface GestureConfig {
  /** 判定為滑動的最小移動距離（像素） */
  threshold: number;
  /** 雙擊的最大間隔（秒） */
  doubleTapTime: number;
  /** 雙擊兩次點擊的最大距離（像素） */
  doubleTapDist: number;
}

/** 進行中的一次觸控 */
interface Touch {
  x: number;
  y: number;
  t: number;
  /** 這次觸控已經觸發過滑動 */
  fired: boolean;
}

export class SwipeTracker {
  private readonly cfg: GestureConfig;
  private touches = new Map<number, Touch>();
  /** 上一次輕點（判斷雙擊） */
  private lastTap: { x: number; y: number; t: number } | null = null;

  constructor(cfg: Partial<GestureConfig> = {}) {
    this.cfg = { threshold: 30, doubleTapTime: 0.3, doubleTapDist: 40, ...cfg };
  }

  /** 手指按下 */
  start(id: number, x: number, y: number, t: number): void {
    this.touches.set(id, { x, y, t, fired: false });
  }

  /**
   * 手指移動：超過門檻時回傳方向動作（一次觸控只回傳一次）。
   */
  move(id: number, x: number, y: number, _t: number): Action | null {
    const tc = this.touches.get(id);
    if (!tc || tc.fired) return null;
    const dx = x - tc.x;
    const dy = y - tc.y;
    if (Math.hypot(dx, dy) < this.cfg.threshold) return null;
    tc.fired = true;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy < 0 ? 'jump' : 'roll';
  }

  /**
   * 手指放開：如果整次都沒滑動（輕點），檢查是不是雙擊 → 'board'。
   */
  end(id: number, x: number, y: number, t: number): Action | null {
    const tc = this.touches.get(id);
    this.touches.delete(id);
    if (!tc || tc.fired) return null;
    const last = this.lastTap;
    if (last && t - last.t <= this.cfg.doubleTapTime && Math.hypot(x - last.x, y - last.y) <= this.cfg.doubleTapDist) {
      this.lastTap = null;
      return 'board';
    }
    this.lastTap = { x, y, t };
    return null;
  }

  /** 手指被系統取消（例如來電），丟掉這次觸控 */
  cancel(id: number): void {
    this.touches.delete(id);
  }
}
