import { TRAIN, RAMP, PHYS } from '../config';
import { footprint, solidRange } from './collision';
import type { RunState } from './run';
import type { Action, Lane, Obstacle } from './types';

/**
 * 自動駕駛：標題畫面的展示模式，也是關卡公平性測試的「代理玩家」。
 * 為了接近真人，決策有反應延遲（看到後 reaction 秒才按下）與有限視距（lookahead 秒）。
 */

/** 自動駕駛參數 */
export interface AutopilotOptions {
  /** 反應延遲（秒）；0 = 立即反應（展示模式） */
  reaction?: number;
  /** 視距（秒 × 速度） */
  lookahead?: number;
}

/** 排定的按鍵 */
interface Pending {
  at: number;
  action: Action;
}

/** 三條車道 */
const LANES: Lane[] = [-1, 0, 1];

export class Autopilot {
  private readonly reaction: number;
  private readonly lookahead: number;
  /** 已決定、等反應延遲到了才送出的按鍵 */
  private queue: Pending[] = [];
  /** 排定換線之後的目標車道（還沒真的換過去時用來接著規劃） */
  private planned: Lane | null = null;
  /** 跳／滾的冷卻（避免同一個障礙重複按） */
  private actUntil = 0;
  /** 換線的冷卻 */
  private laneUntil = 0;

  constructor(opts: AutopilotOptions = {}) {
    this.reaction = opts.reaction ?? 0.35;
    this.lookahead = opts.lookahead ?? 2.2;
  }

  /**
   * 每幀呼叫：思考並回傳這一幀要送出的按鍵（反應延遲已到的）。
   * @param dt 這一幀的秒數
   */
  decide(s: RunState, dt: number): Action[] {
    const now = s.time;
    const out: Action[] = [];
    this.queue = this.queue.filter((q) => {
      if (q.at <= now + dt * 0.5) {
        out.push(q.action);
        return false;
      }
      return true;
    });
    if (s.status !== 'running') return out;
    if (this.planned !== null && !this.queue.some((q) => q.action === 'left' || q.action === 'right')) {
      if (s.player.lane === this.planned) this.planned = null;
    }
    this.think(s);
    return out;
  }

  /** 排一個按鍵（反應延遲後送出） */
  private push(s: RunState, action: Action, extraDelay = 0): void {
    this.queue.push({ at: s.time + this.reaction + extraDelay, action });
  }

  /** 玩家是否站在列車車頂（或更高） */
  private onRoof(s: RunState): boolean {
    return s.player.y >= TRAIN.height - 0.4;
  }

  /** 列車前面是否接著斜坡（可以跑上去，不算擋路） */
  private hasRampBefore(s: RunState, o: Obstacle): boolean {
    return s.obstacles.some((r) => r.kind === 'ramp' && r.lane === o.lane && Math.abs(r.z + RAMP.length - o.z) < 0.6);
  }

  /**
   * 某條車道從 zAct 往前，多遠會被「跳滾都過不去」的障礙擋住（迎面列車用相對速度換算成等效距離）。
   */
  private blockDist(s: RunState, lane: Lane, zAct: number, roof: boolean): number {
    const v = s.speed;
    let best = Infinity;
    for (const o of s.obstacles) {
      if (o.lane !== lane) continue;
      if (o.z + o.length < zAct - 0.6) continue;
      if (o.kind === 'hurdle' || o.kind === 'highBar' || o.kind === 'ramp') continue;
      if (roof && o.speed === 0) continue; // 在車頂上：靜止列車與擋牆都在腳下
      if (o.kind === 'train' && o.speed === 0 && this.hasRampBefore(s, o)) continue;
      let d = Math.max(0, o.z - zAct);
      if (o.speed > 0) d = (d * v) / (v + o.speed);
      if (d < best) best = d;
    }
    return best;
  }

  /** 換到 target 車道的途中，會不會從側面撞到東西 */
  private lateralSafe(s: RunState, from: Lane, target: Lane, zAct: number): boolean {
    const p = s.player;
    const v = s.speed;
    const steps = Math.abs(target - from);
    const z0 = zAct - 0.7;
    const z1 = zAct + v * (PHYS.laneChangeTime * steps + 0.08) + 0.7;
    const dir = Math.sign(target - from);
    for (let l = from + dir; dir !== 0 && l !== target + dir; l += dir) {
      for (const o of s.obstacles) {
        if (o.lane !== l) continue;
        const fp = footprint(o);
        const oz0 = Math.min(fp.z0, fp.z0 - (o.speed > 0 ? o.speed * 0.5 : 0));
        if (fp.z1 < z0 || oz0 > z1) continue;
        const [, top] = solidRange(o, zAct);
        if (p.y >= top - 0.3) continue;
        if (o.kind === 'highBar' && p.y + p.height <= 1.1) continue;
        return false;
      }
    }
    return true;
  }

  /** 思考：換線、跳、滾 */
  private think(s: RunState): void {
    const p = s.player;
    if (p.flying || s.power.toad > 0) return;
    const now = s.time;
    const v = s.speed;
    const zAct = p.z + v * this.reaction;
    const lane = this.planned ?? p.lane;
    const roof = this.onRoof(s);

    // ── 車頂：前面車廂斷開就在邊緣起跳 ──
    if (roof && p.grounded) {
      const under = s.obstacles.find((o) => o.lane === p.lane && o.kind === 'train' && p.z >= o.z && p.z <= o.z + o.length);
      if (under) {
        const edge = under.z + under.length;
        const next = s.obstacles.find((o) => o.lane === p.lane && o.kind === 'train' && o.z >= edge - 0.1 && o.z < edge + 12);
        if (next && next.z > edge + 0.5) {
          const d = edge - (zAct + 0.3);
          if (d < v * 0.1 && d > -0.6 && now >= this.actUntil) {
            this.push(s, 'jump');
            this.actUntil = now + this.reaction + 0.6;
          }
        }
      }
    }

    // ── 換線 ──
    if (now >= this.laneUntil) {
      const range = v * this.lookahead + 6;
      const dCur = this.blockDist(s, lane, zAct, roof);
      let target: Lane = lane;
      if (dCur < range) {
        let bestScore = dCur + 3;
        for (const l of LANES) {
          if (l === lane) continue;
          const d = this.blockDist(s, l, zAct, roof && this.laneHasRoof(s, l, zAct));
          // 跨兩條車道要多花時間，打個折扣
          const score = d - Math.abs(l - lane) * 4;
          if (score > bestScore && this.lateralSafe(s, lane, l, zAct)) {
            bestScore = score;
            target = l;
          }
        }
      } else if (lane !== 0 && !roof) {
        // 前面都空：回到中間車道，保留往兩邊閃的空間
        if (this.blockDist(s, 0, zAct, false) >= range && this.lateralSafe(s, lane, 0, zAct)) target = 0;
      }
      if (target !== lane) {
        const dir = target > lane ? 'right' : 'left';
        const n = Math.abs(target - lane);
        for (let i = 0; i < n; i++) this.push(s, dir, i * (PHYS.laneChangeTime + 0.02));
        this.planned = target;
        this.laneUntil = now + this.reaction + n * (PHYS.laneChangeTime + 0.02) + 0.05;
      }
    }

    // ── 跳低欄、滾高橫樑（在規劃中的車道上） ──
    if (now < this.actUntil) return;
    const front = zAct + 0.3;
    let next: Obstacle | null = null;
    for (const o of s.obstacles) {
      if (o.lane !== lane || (o.kind !== 'hurdle' && o.kind !== 'highBar')) continue;
      if (o.z + o.length < front - 0.9) continue;
      if (roof && p.y > 2.7) continue;
      if (!next || o.z < next.z) next = o;
    }
    if (!next) return;
    const d = next.z - front;
    if (next.kind === 'hurdle' && d >= v * 0.12 && d <= v * 0.28) {
      this.push(s, 'jump');
      this.actUntil = now + this.reaction + 0.45;
    } else if (next.kind === 'highBar' && d >= 0.2 && d <= v * 0.32) {
      this.push(s, 'roll');
      this.actUntil = now + this.reaction + 0.4;
    }
  }

  /** 某條車道在 zAct 處是不是也有列車車頂（在車頂上換線時用） */
  private laneHasRoof(s: RunState, lane: Lane, zAct: number): boolean {
    return s.obstacles.some((o) => o.lane === lane && o.kind === 'train' && o.speed === 0 && zAct >= o.z && zAct <= o.z + o.length);
  }
}
