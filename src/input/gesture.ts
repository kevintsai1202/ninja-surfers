import type { Action } from '../sim/types';

/**
 * 手機滑動手勢判定（純邏輯，不碰 DOM，方便單元測試）：
 * - 手指移動超過門檻就立刻判定方向（不等放開，反應比較快），一次觸控只觸發一次。
 * - 上滑跳、下滑滾、左右換線；輕點一下＝擲手裏劍（卷軸滑板改用畫面上的按鈕）。
 */

/** 手勢參數 */
export interface GestureConfig {
  /** 判定為滑動的最小移動距離（像素） */
  threshold: number;
  /** 輕點的最長按住時間（秒）；按更久算長按，不擲 */
  tapMaxTime: number;
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

  constructor(cfg: Partial<GestureConfig> = {}) {
    this.cfg = { threshold: 30, tapMaxTime: 0.35, ...cfg };
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
   * 手指放開：整次都沒滑動、而且很快放開（輕點）→ 'throw'（擲手裏劍）。
   */
  end(id: number, _x: number, _y: number, t: number): Action | null {
    const tc = this.touches.get(id);
    this.touches.delete(id);
    if (!tc || tc.fired) return null;
    return t - tc.t <= this.cfg.tapMaxTime ? 'throw' : null;
  }

  /** 手指被系統取消（例如來電），丟掉這次觸控 */
  cancel(id: number): void {
    this.touches.delete(id);
  }
}
