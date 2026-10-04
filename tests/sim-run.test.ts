import { describe, it, expect } from 'vitest';
import { createRun, addObstacle, addCoin, addPickup, step, revive, reviveCost, type RunState } from '../src/sim/run';
import type { Action, SimEvent } from '../src/sim/types';
import { LANE_WIDTH, PHYS, TRAIN, RAMP, PLAYER } from '../src/config';
import { CHASER } from '../src/sim/chaser';

/** 建立不自動生成關卡的測試用跑局（玩家從 z = 0、中間車道開始） */
function bare(opts: Partial<Parameters<typeof createRun>[0]> = {}): RunState {
  return createRun({ seed: 1, generate: false, introSeconds: 0, ...opts });
}

/**
 * 推進 seconds 秒（每次 1/60 秒），actionsAt(t) 回傳這一刻要送的動作；回傳全部事件。
 */
function run(s: RunState, seconds: number, actionsAt: (t: number) => Action[] = () => []): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    events.push(...step(s, actionsAt(t), dt));
    if (s.status !== 'running') break;
  }
  return events;
}

/** 只在 t 剛好跨過 at 的那一幀送出動作 */
function once(at: number, action: Action): (t: number) => Action[] {
  // 加一點容許量：t 是 1/60 累加出來的，會有浮點誤差
  return (t) => (t <= at + 1e-9 && t + 1 / 60 > at + 1e-9 ? [action] : []);
}

/** 事件種類清單 */
const kinds = (ev: SimEvent[]) => ev.map((e) => e.type);

describe('玩家移動', () => {
  it('換線 0.14 秒完成，最右邊不能再往右', () => {
    const s = bare();
    run(s, 0.2, once(0, 'right'));
    expect(s.player.x).toBeCloseTo(LANE_WIDTH, 3);
    expect(s.player.lane).toBe(1);
    run(s, 0.2, once(0, 'right'));
    expect(s.player.lane).toBe(1);
    expect(s.player.x).toBeCloseTo(LANE_WIDTH, 3);
  });

  it('一般跳：最高約 1.31 m、滯空約 0.62 s', () => {
    const s = bare();
    let maxY = 0;
    let air = 0;
    step(s, ['jump'], 1 / 120);
    for (let i = 0; i < 200; i++) {
      step(s, [], 1 / 120);
      maxY = Math.max(maxY, s.player.y);
      if (!s.player.grounded) air += 1 / 120;
      else break;
    }
    expect(maxY).toBeCloseTo((PHYS.jumpVelocity * PHYS.jumpVelocity) / (2 * PHYS.gravity), 1);
    expect(air).toBeGreaterThan(0.58);
    expect(air).toBeLessThan(0.66);
  });

  it('查克拉附著時跳得更高（可上車頂）', () => {
    const s = bare();
    s.power.chakra = 10;
    let maxY = 0;
    run(s, 1.3, (t) => {
      maxY = Math.max(maxY, s.player.y);
      return t === 0 ? ['jump'] : [];
    });
    expect(maxY).toBeGreaterThan(TRAIN.height + 0.5);
  });

  it('翻滾 0.55 秒，判定高度變矮；空中按翻滾會急降並在落地後翻滾', () => {
    const s = bare();
    step(s, ['roll'], 1 / 60);
    expect(s.player.rolling).toBeGreaterThan(0);
    expect(s.player.height).toBeCloseTo(PLAYER.rollHeight, 5);
    run(s, 0.6);
    expect(s.player.rolling).toBe(0);
    expect(s.player.height).toBeCloseTo(PLAYER.height, 5);

    const s2 = bare();
    step(s2, ['jump'], 1 / 60);
    run(s2, 0.15);
    const ev = run(s2, 0.3, once(0, 'roll'));
    expect(kinds(ev)).toContain('land');
    expect(s2.player.grounded).toBe(true);
    expect(s2.player.rolling).toBeGreaterThan(0);
  });
});

describe('障礙判定', () => {
  it('不跳直接撞上低欄＝正面撞死；時機正確跳過＝沒事', () => {
    const s = bare();
    addObstacle(s, { kind: 'hurdle', lane: 0, z: 20 });
    const ev = run(s, 3);
    expect(kinds(ev)).toContain('crash');
    expect(s.status).toBe('dead');
    expect(s.deathCause).toBe('crash');

    const s2 = bare();
    addObstacle(s2, { kind: 'hurdle', lane: 0, z: 20 });
    // 速度 12 m/s：前緣 0.3 m 碰到 20 m 處約在 1.64 秒，提早約 0.2 秒起跳
    run(s2, 3, once(1.4, 'jump'));
    expect(s2.status).toBe('running');
  });

  it('高橫樑：站著撞死、滾過去沒事、跳起來也會撞', () => {
    const a = bare();
    addObstacle(a, { kind: 'highBar', lane: 0, z: 20 });
    run(a, 3);
    expect(a.status).toBe('dead');

    const b = bare();
    addObstacle(b, { kind: 'highBar', lane: 0, z: 20 });
    run(b, 3, once(1.4, 'roll'));
    expect(b.status).toBe('running');

    const c = bare();
    addObstacle(c, { kind: 'highBar', lane: 0, z: 20 });
    run(c, 3, once(1.4, 'jump'));
    expect(c.status).toBe('dead');
  });

  it('列車正面撞死；換線撞到列車側面＝踉蹌彈回原車道、追捕者進入危險期', () => {
    const a = bare();
    addObstacle(a, { kind: 'train', lane: 0, z: 15, length: 30 });
    run(a, 2);
    expect(a.status).toBe('dead');

    const b = bare();
    addObstacle(b, { kind: 'train', lane: 1, z: 5, length: 40 });
    const ev = run(b, 1, once(0.6, 'right'));
    expect(kinds(ev)).toContain('stumble');
    expect(b.status).toBe('running');
    expect(b.player.lane).toBe(0);
    run(b, 0.3);
    expect(b.player.x).toBeCloseTo(0, 2);
    expect(b.chaser.danger).toBeGreaterThan(0);
  });

  it('危險期內再踉蹌一次＝被抓', () => {
    const s = bare();
    addObstacle(s, { kind: 'train', lane: 1, z: 5, length: 60 });
    run(s, 1, once(0.5, 'right'));
    expect(s.status).toBe('running');
    run(s, 1, once(0.3, 'right'));
    expect(s.status).toBe('dead');
    expect(s.deathCause).toBe('caught');
  });

  it('危險期過了之後再踉蹌不會被抓', () => {
    const s = bare();
    addObstacle(s, { kind: 'train', lane: 1, z: 5, length: 400 });
    run(s, 1, once(0.5, 'right'));
    run(s, CHASER.iruka.danger + 0.5);
    expect(s.chaser.danger).toBe(0);
    run(s, 1, once(0.3, 'right'));
    expect(s.status).toBe('running');
  });

  it('從斜坡跑上車頂、在車頂跑、跑完落回地面不會死', () => {
    const s = bare();
    addObstacle(s, { kind: 'ramp', lane: 0, z: 10, length: RAMP.length });
    addObstacle(s, { kind: 'train', lane: 0, z: 10 + RAMP.length, length: 30 });
    run(s, (10 + RAMP.length + 10) / 12);
    expect(s.player.y).toBeCloseTo(TRAIN.height, 1);
    expect(s.status).toBe('running');
    run(s, 4);
    expect(s.status).toBe('running');
    expect(s.player.y).toBeCloseTo(0, 3);
    expect(s.player.grounded).toBe(true);
  });

  it('查克拉跳可以直接跳上列車車頂', () => {
    const s = bare();
    s.power.chakra = 10;
    addObstacle(s, { kind: 'train', lane: 0, z: 18, length: 40 });
    // 提早約 0.8 秒起跳（滯空 1.1 秒）
    run(s, 3, once(0.65, 'jump'));
    expect(s.status).toBe('running');
    expect(s.player.y).toBeCloseTo(TRAIN.height, 1);
  });

  it('迎面列車：不換線會撞死，換線就沒事', () => {
    const a = bare();
    addObstacle(a, { kind: 'train', lane: 0, z: 140, length: 20, speed: 10, trigger: 100 });
    const ev = run(a, 8);
    expect(kinds(ev)).toContain('trainStart');
    expect(a.status).toBe('dead');

    const b = bare();
    addObstacle(b, { kind: 'train', lane: 0, z: 140, length: 20, speed: 10, trigger: 100 });
    run(b, 8, once(2, 'left'));
    expect(b.status).toBe('running');
  });

  it('高速大步長也不會穿過薄障礙（掃掠判定）', () => {
    const s = bare({ startZ: 60000 });
    addObstacle(s, { kind: 'hurdle', lane: 0, z: 60010 });
    for (let i = 0; i < 60 && s.status === 'running'; i++) step(s, [], 1 / 30);
    expect(s.status).toBe('dead');
  });
});

describe('兩與道具', () => {
  it('同車道的兩會被撿起，其他車道的不會', () => {
    const s = bare();
    addCoin(s, 0, 10, 1);
    addCoin(s, 1, 12, 1);
    const ev = run(s, 2);
    expect(ev.filter((e) => e.type === 'coin')).toHaveLength(1);
    expect(s.coins).toBe(1);
  });

  it('萬象天引會把其他車道的兩吸過來', () => {
    const s = bare();
    addPickup(s, 'magnet', 0, 5);
    addCoin(s, 1, 20, 1);
    addCoin(s, -1, 24, 1);
    run(s, 3);
    expect(s.coins).toBe(2);
  });

  it('多重影分身：分數倍率 ×2，旁邊車道的兩也撿得到', () => {
    const s = bare();
    addPickup(s, 'clones', 0, 3);
    addCoin(s, -1, 20, 1);
    const before = s.score;
    run(s, 2);
    expect(s.coins).toBe(1);
    const a = bare();
    run(a, 2);
    expect(s.score - before).toBeGreaterThan((a.score - 0) * 1.6);
  });

  it('卷軸滑板：啟動消耗一個，撞到時替身術抵銷、短暫無敵並穿過列車', () => {
    const s = bare({ boards: 2 });
    const ev0 = step(s, ['board'], 1 / 60);
    expect(kinds(ev0)).toContain('boardOn');
    expect(s.boards).toBe(1);
    addObstacle(s, { kind: 'train', lane: 0, z: 15, length: 30 });
    const ev = run(s, 5);
    expect(kinds(ev)).toContain('boardBreak');
    expect(s.status).toBe('running');
    expect(s.power.board).toBe(0);
  });

  it('沒有滑板時按 board 沒有效果', () => {
    const s = bare({ boards: 0 });
    const ev = step(s, ['board'], 1 / 60);
    expect(kinds(ev)).not.toContain('boardOn');
  });

  it('通靈術・巨蛤蟆：飛在高空、無視障礙，結束後安全落地', () => {
    const s = bare();
    addPickup(s, 'toad', 0, 4);
    addObstacle(s, { kind: 'train', lane: 0, z: 30, length: 50 });
    addObstacle(s, { kind: 'block', lane: -1, z: 60 });
    addObstacle(s, { kind: 'block', lane: 1, z: 60 });
    run(s, 1.5);
    expect(s.player.y).toBeGreaterThan(5);
    run(s, 10);
    expect(s.status).toBe('running');
    expect(s.power.toad).toBe(0);
  });

  it('秘傳卷軸會給獎勵事件；兵糧丸會加進庫存', () => {
    const s = bare({ pills: 0 });
    addPickup(s, 'scroll', 0, 5);
    addPickup(s, 'pill', 0, 10);
    const ev = run(s, 2);
    expect(ev.some((e) => e.type === 'scroll')).toBe(true);
    expect(s.pills).toBeGreaterThanOrEqual(1);
  });
});

describe('復活、分數、追捕者', () => {
  it('復活花費 1、2、4…顆兵糧丸，清掉附近障礙並繼續跑', () => {
    expect(reviveCost(0)).toBe(1);
    expect(reviveCost(1)).toBe(2);
    expect(reviveCost(2)).toBe(4);
    const s = bare({ pills: 5 });
    addObstacle(s, { kind: 'train', lane: 0, z: 15, length: 30 });
    run(s, 3);
    expect(s.status).toBe('dead');
    expect(revive(s)).toBe(true);
    expect(s.pills).toBe(4);
    expect(s.status).toBe('running');
    run(s, 3);
    expect(s.status).toBe('running');
  });

  it('兵糧丸不夠就不能復活', () => {
    const s = bare({ pills: 0 });
    addObstacle(s, { kind: 'block', lane: 0, z: 10 });
    run(s, 2);
    expect(revive(s)).toBe(false);
    expect(s.status).toBe('dead');
  });

  it('分數約等於跑的距離', () => {
    const s = bare();
    run(s, 2);
    expect(s.score).toBeCloseTo(s.player.z, 0);
  });

  it('跑到 1800 m 時換暗部追，發出事件', () => {
    const s = bare({ startZ: 1790 });
    const ev = run(s, 2);
    expect(ev.some((e) => e.type === 'chaser' && e.identity === 'anbu')).toBe(true);
    expect(s.chaser.identity).toBe('anbu');
  });

  it('開場追捕者貼在身後，幾秒後離開', () => {
    const s = createRun({ seed: 1, generate: false, introSeconds: 3 });
    expect(s.chaser.gap).toBeLessThan(4);
    run(s, 6);
    expect(s.chaser.gap).toBeGreaterThan(15);
  });
});
