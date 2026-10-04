import { SwipeTracker } from './gesture';
import type { Action } from '../sim/types';

/**
 * 輸入：鍵盤（方向鍵／WASD／Space／Esc）與觸控滑動（也支援滑鼠拖曳），
 * 動作先排進佇列，遊戲每幀取走。
 */

/** 鍵盤按鍵 → 動作 */
const KEYS: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  ArrowDown: 'roll',
  KeyS: 'roll',
  Space: 'board',
};

export class Input {
  private queue: Action[] = [];
  private readonly swipe = new SwipeTracker();
  /** 是否接受遊戲動作（標題、暫停時不收） */
  enabled = false;

  /**
   * @param surface 接收觸控滑動的元素（遊戲畫面）
   * @param onPause 按下 Esc／P
   * @param onAnyInput 任何使用者輸入（第一次用來解鎖音效）
   */
  constructor(
    surface: HTMLElement,
    private readonly onPause: () => void,
    private readonly onAnyInput: () => void,
  ) {
    window.addEventListener('keydown', (e) => {
      this.onAnyInput();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause();
        return;
      }
      const a = KEYS[e.code];
      if (!a) return;
      e.preventDefault();
      // Windows 按住會送重複的 keydown：只收第一次
      if (e.repeat) return;
      if (this.enabled) this.queue.push(a);
    });
    const now = () => performance.now() / 1000;
    surface.addEventListener('pointerdown', (e) => {
      this.onAnyInput();
      this.swipe.start(e.pointerId, e.clientX, e.clientY, now());
    });
    surface.addEventListener('pointermove', (e) => {
      const a = this.swipe.move(e.pointerId, e.clientX, e.clientY, now());
      if (a && this.enabled) this.queue.push(a);
    });
    const end = (e: PointerEvent) => {
      const a = this.swipe.end(e.pointerId, e.clientX, e.clientY, now());
      if (a && this.enabled) this.queue.push(a);
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', (e) => this.swipe.cancel(e.pointerId));
  }

  /** 由按鈕送出的動作（例如畫面上的卷軸滑板按鈕） */
  push(a: Action): void {
    if (this.enabled) this.queue.push(a);
  }

  /** 取走這一幀累積的動作 */
  drain(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  /** 清空（切換畫面時） */
  clear(): void {
    this.queue = [];
  }
}
