import { describe, it, expect } from 'vitest';
import { createRun, addObstacle, addPickup, step, type RunState } from '../src/sim/run';
import { SHURIKEN, KUNAI, RASENGAN, FLICKER } from '../src/sim/powerups';
import { speedAt } from '../src/sim/speed';
import { LANE_WIDTH, TRAIN, BLOCK } from '../src/config';
import type { Action, SimEvent } from '../src/sim/types';

/**
 * 第二版的新招式與道具：影分身擋撞擊、手裏劍、替身木頭、起爆符苦無、螺旋丸、查克拉攀牆、瞬身術。
 */

/** 不自動生成關卡的測試用跑局（玩家從 z = 0、中間車道開始） */
function bare(opts: Partial<Parameters<typeof createRun>[0]> = {}): RunState {
  return createRun({ seed: 1, generate: false, introSeconds: 0, ...opts });
}

/** 推進 seconds 秒（每次 1/60 秒），回傳全部事件 */
function run(s: RunState, seconds: number, actionsAt: (t: number) => Action[] = () => []): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    events.push(...step(s, actionsAt(t), dt));
    if (s.status !== 'running') break;
  }
  return events;
}

/** 只在 t 跨過 at 的那一幀送出動作（加浮點容許量） */
function once(at: number, action: Action): (t: number) => Action[] {
  return (t) => (t <= at + 1e-9 && t + 1 / 60 > at + 1e-9 ? [action] : []);
}

/** 某種事件的數量 */
const count = (ev: SimEvent[], type: SimEvent['type']) => ev.filter((e) => e.type === type).length;

describe('影分身擋撞擊', () => {
  it('每個分身擋一次小障礙（共兩次），撞碎障礙；兩個用完影分身結束，第三次就倒下', () => {
    const s = bare();
    addPickup(s, 'clones', 0, 3);
    addObstacle(s, { kind: 'hurdle', lane: 0, z: 20 });
    addObstacle(s, { kind: 'highBar', lane: 0, z: 45 });
    addObstacle(s, { kind: 'block', lane: 0, z: 70 });
    const ev = run(s, 4.2);
    expect(count(ev, 'cloneBlock')).toBe(2);
    expect(ev.filter((e) => e.type === 'break' && e.cause === 'clone')).toHaveLength(2);
    expect(s.clonesLeft).toBe(0);
    expect(s.power.clones).toBe(0);
    run(s, 3);
    expect(s.status).toBe('dead');
  });

  it('列車擋不住：影分身期間正面撞上列車照樣倒下', () => {
    const s = bare();
    addPickup(s, 'clones', 0, 3);
    addObstacle(s, { kind: 'train', lane: 0, z: 20, length: 30 });
    run(s, 3);
    expect(s.status).toBe('dead');
  });

  it('影分身不救被抓', () => {
    const s = bare();
    addPickup(s, 'clones', 0, 3);
    addObstacle(s, { kind: 'train', lane: 1, z: 5, length: 80 });
    run(s, 1, once(0.5, 'right'));
    run(s, 1, once(0.3, 'right'));
    expect(s.status).toBe('dead');
    expect(s.deathCause).toBe('caught');
  });
});

describe('手裏劍', () => {
  it('每局 3 支；擲出後打碎同一車道前方的低欄，不用跳也能通過', () => {
    const s = bare();
    expect(s.shuriken).toBe(SHURIKEN.start);
    addObstacle(s, { kind: 'hurdle', lane: 0, z: 25 });
    const ev = run(s, 3, once(0.2, 'throw'));
    expect(count(ev, 'throw')).toBe(1);
    expect(s.shuriken).toBe(SHURIKEN.start - 1);
    expect(ev.some((e) => e.type === 'break' && e.cause === 'shuriken')).toBe(true);
    expect(s.obstacles).toHaveLength(0);
    expect(s.status).toBe('running');
  });

  it('打不壞列車（鏘一聲彈開），列車還在', () => {
    const s = bare();
    addObstacle(s, { kind: 'train', lane: 0, z: 20, length: 20 });
    const ev = run(s, 0.8, once(0.1, 'throw'));
    expect(count(ev, 'clink')).toBe(1);
    expect(s.obstacles).toHaveLength(1);
  });

  it('射程外的障礙打不到；用完就不能再擲', () => {
    const s = bare({ shuriken: 1 });
    addObstacle(s, { kind: 'block', lane: 0, z: 90 });
    run(s, 1.5, once(0.05, 'throw'));
    expect(s.obstacles).toHaveLength(1);
    expect(s.projectiles).toHaveLength(0);
    const ev = run(s, 0.2, once(0, 'throw'));
    expect(count(ev, 'throw')).toBe(0);
  });

  it('撿「劍」+3，最多 9 支', () => {
    const s = bare({ shuriken: 7 });
    addPickup(s, 'shuriken', 0, 5);
    run(s, 1);
    expect(s.shuriken).toBe(SHURIKEN.max);
  });
});

describe('替身木頭', () => {
  it('擋下一次正面撞死（含列車），之後再撞就倒下', () => {
    const s = bare();
    addPickup(s, 'sub', 0, 3);
    addObstacle(s, { kind: 'train', lane: 0, z: 20, length: 30 });
    const ev = run(s, 5);
    expect(ev.some((e) => e.type === 'substitution' && e.cause === 'crash')).toBe(true);
    expect(s.status).toBe('running');
    expect(s.subs).toBe(0);
    addObstacle(s, { kind: 'block', lane: 0, z: s.player.z + 10 });
    run(s, 2);
    expect(s.status).toBe('dead');
  });

  it('被抓時追捕者抓到的是木頭：救一次、危險期解除', () => {
    const s = bare();
    addPickup(s, 'sub', 0, 3);
    addObstacle(s, { kind: 'train', lane: 1, z: 5, length: 80 });
    run(s, 1, once(0.5, 'right'));
    const ev = run(s, 1, once(0.3, 'right'));
    expect(ev.some((e) => e.type === 'substitution' && e.cause === 'caught')).toBe(true);
    expect(s.status).toBe('running');
    expect(s.chaser.danger).toBe(0);
  });

  it('最多持有 1 個', () => {
    const s = bare();
    addPickup(s, 'sub', 0, 3);
    addPickup(s, 'sub', 0, 8);
    run(s, 1);
    expect(s.subs).toBe(1);
  });
});

describe('起爆符苦無', () => {
  it('撿「爆」持有，擲出後清掉同一車道前方 30 m 內所有障礙（含列車），其他車道不受影響', () => {
    const s = bare();
    addPickup(s, 'kunai', 0, 3);
    run(s, 0.5);
    expect(s.kunai).toBe(1);
    addObstacle(s, { kind: 'train', lane: 0, z: s.player.z + 12, length: 20 });
    addObstacle(s, { kind: 'block', lane: 0, z: s.player.z + 26 });
    addObstacle(s, { kind: 'block', lane: 1, z: s.player.z + 15 });
    const ev = run(s, 1.2, once(0, 'kunai'));
    expect(count(ev, 'explode')).toBe(1);
    expect(s.kunai).toBe(0);
    expect(s.obstacles.filter((o) => o.lane === 0)).toHaveLength(0);
    expect(s.obstacles.filter((o) => o.lane === 1)).toHaveLength(1);
  });

  it(`最多持有 ${KUNAI.max} 支；沒有就不能擲`, () => {
    const s = bare();
    for (let i = 0; i < 3; i++) addPickup(s, 'kunai', 0, 3 + i * 4);
    run(s, 1.5);
    expect(s.kunai).toBe(KUNAI.max);
    const t = bare();
    const ev = run(t, 0.2, once(0, 'kunai'));
    expect(count(ev, 'throw')).toBe(0);
  });
});

describe('螺旋丸', () => {
  it(`撿「螺」衝刺 ${RASENGAN.time} 秒：跑得更快、撞碎列車也不會倒下`, () => {
    const s = bare();
    addPickup(s, 'rasengan', 0, 3);
    // 2.5 秒內（約跑到 39 m）會先撞到列車、再撞到擋牆
    addObstacle(s, { kind: 'train', lane: 0, z: 20, length: 10 });
    addObstacle(s, { kind: 'block', lane: 0, z: 34 });
    let fast = false;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 150 && s.status === 'running'; i++) {
      ev.push(...step(s, [], 1 / 60));
      if (s.power.rasengan > 0 && s.speed > speedAt(s.player.z) * 1.3) fast = true;
    }
    expect(fast).toBe(true);
    expect(ev.filter((e) => e.type === 'break' && e.cause === 'rasengan').length).toBeGreaterThanOrEqual(2);
    expect(s.status).toBe('running');
  });
});

describe('查克拉攀牆', () => {
  it('查克拉附著時正面撞上列車：沿車頭跑上車頂，不會倒下', () => {
    const s = bare();
    s.power.chakra = 10;
    addObstacle(s, { kind: 'train', lane: 0, z: 18, length: 40 });
    const ev = run(s, 2.5);
    expect(count(ev, 'climb')).toBe(1);
    expect(s.status).toBe('running');
    expect(s.player.y).toBeCloseTo(TRAIN.height, 1);
  });

  it('擋牆也可以攀上去，翻過去落地繼續跑', () => {
    const s = bare();
    s.power.chakra = 10;
    addObstacle(s, { kind: 'block', lane: 0, z: 18 });
    let maxY = 0;
    run(s, 3, () => {
      maxY = Math.max(maxY, s.player.y);
      return [];
    });
    expect(maxY).toBeGreaterThanOrEqual(BLOCK.height - 0.05);
    expect(s.status).toBe('running');
  });

  it('攀上的列車結束後落地，沒有障礙就不會死', () => {
    const s = bare();
    s.power.chakra = 10;
    addObstacle(s, { kind: 'train', lane: 0, z: 15, length: 20 });
    run(s, 5);
    expect(s.status).toBe('running');
    expect(s.player.y).toBeCloseTo(0, 3);
  });
});

describe('瞬身術', () => {
  it('0.25 秒內同方向換線兩次＝瞬間移動兩條車道', () => {
    const s = bare();
    run(s, 0.5, once(0, 'left'));
    expect(s.player.lane).toBe(-1);
    const ev = run(s, 0.2, (t) => (t < 1e-9 ? ['right'] : t > 0.06 && t < 0.07 + 1e-9 ? ['right'] : []));
    expect(count(ev, 'flicker')).toBe(1);
    expect(s.player.lane).toBe(1);
    expect(s.player.x).toBeCloseTo(LANE_WIDTH, 3);
  });

  it('瞬移可以閃過中間車道前方的列車（正常換兩條線會撞上）', () => {
    const s = bare();
    run(s, 0.5, once(0, 'left'));
    // 列車車頭在前方 2 m：第一次換線的前 0.07 秒還碰不到，瞬移直接越過中線
    addObstacle(s, { kind: 'train', lane: 0, z: s.player.z + 2, length: 40 });
    const ev = run(s, 0.3, (t) => (t < 1e-9 ? ['right'] : t > 0.06 && t < 0.07 + 1e-9 ? ['right'] : []));
    expect(count(ev, 'stumble')).toBe(0);
    expect(s.player.lane).toBe(1);
  });

  it(`冷卻 ${FLICKER.cooldown} 秒內再連按就是一般換線；flicker: false 時關閉`, () => {
    const s = bare();
    run(s, 0.5, once(0, 'left'));
    run(s, 0.2, (t) => (t < 1e-9 ? ['right'] : t > 0.06 && t < 0.07 + 1e-9 ? ['right'] : []));
    const ev = run(s, 0.3, (t) => (t < 1e-9 ? ['left'] : t > 0.06 && t < 0.07 + 1e-9 ? ['left'] : []));
    expect(count(ev, 'flicker')).toBe(0);
    const off = bare({ flicker: false });
    run(off, 0.5, once(0, 'left'));
    const ev2 = run(off, 0.3, (t) => (t < 1e-9 ? ['right'] : t > 0.06 && t < 0.07 + 1e-9 ? ['right'] : []));
    expect(count(ev2, 'flicker')).toBe(0);
  });

  it('目標車道在當下被列車占住時不瞬移進去', () => {
    const s = bare();
    run(s, 0.5, once(0, 'left'));
    addObstacle(s, { kind: 'train', lane: 1, z: s.player.z - 5, length: 40 });
    run(s, 0.3, (t) => (t < 1e-9 ? ['right'] : t > 0.06 && t < 0.07 + 1e-9 ? ['right'] : []));
    expect(s.player.lane).not.toBe(1);
    expect(s.status).toBe('running');
  });
});
