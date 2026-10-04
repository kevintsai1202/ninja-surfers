import { describe, it, expect } from 'vitest';
import { createRun, step, type RunState } from '../src/sim/run';
import { Autopilot } from '../src/sim/autopilot';
import { TRAIN, BLOCK } from '../src/config';
import type { Obstacle } from '../src/sim/types';

/** 用自動駕駛跑到 targetZ 或死掉為止，回傳狀態與每次死前附近的障礙（除錯用） */
function drive(seed: number, targetZ: number, reaction: number): { s: RunState; report: string } {
  const s = createRun({ seed, introSeconds: 0 });
  const bot = new Autopilot({ reaction });
  const dt = 1 / 60;
  let guard = 0;
  while (s.status === 'running' && s.player.z < targetZ && guard++ < 400000) {
    step(s, bot.decide(s, dt), dt);
  }
  const p = s.player;
  const near = s.obstacles
    .filter((o) => o.z + o.length > p.z - 15 && o.z < p.z + 40)
    .map((o) => `${o.kind}@lane${o.lane} z${o.z.toFixed(1)}~${(o.z + o.length).toFixed(1)}${o.speed ? ` v${o.speed.toFixed(1)}` : ''}`)
    .join('; ');
  const report = `seed ${seed} 死於 z=${p.z.toFixed(1)} lane=${p.lane} y=${p.y.toFixed(2)} 原因=${s.deathCause}｜附近：${near}`;
  return { s, report };
}

/** 生成前 2000 m 的障礙清單（不推進玩家，只看生成器） */
function layout(seed: number, until: number): Obstacle[] {
  const s = createRun({ seed, introSeconds: 0 });
  const all: Obstacle[] = [];
  const seen = new Set<number>();
  // 讓玩家瞬移往前，觸發生成，同時記錄所有出現過的障礙
  while (s.player.z < until) {
    s.player.z += 50;
    for (const o of s.obstacles) if (!seen.has(o.id)) {
      seen.add(o.id);
      all.push({ ...o });
    }
    step(s, [], 1 / 120);
    if (s.status !== 'running') {
      s.status = 'running';
      s.deathCause = null;
    }
  }
  return all;
}

describe('關卡生成器', () => {
  it('同種子生成相同的關卡', () => {
    const a = layout(5, 1500).map((o) => `${o.kind}${o.lane}${o.z.toFixed(2)}${o.length}`);
    const b = layout(5, 1500).map((o) => `${o.kind}${o.lane}${o.z.toFixed(2)}${o.length}`);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(40);
  });

  it('同一條車道的靜止障礙不重疊', () => {
    for (const seed of [1, 2, 3]) {
      const obs = layout(seed, 3000).filter((o) => o.speed === 0);
      for (const lane of [-1, 0, 1]) {
        const list = obs.filter((o) => o.lane === lane).sort((x, y) => x.z - y.z);
        for (let i = 1; i < list.length; i++) {
          expect(list[i].z + 1e-6, `seed ${seed} lane ${lane} 第 ${i} 個重疊`).toBeGreaterThanOrEqual(
            list[i - 1].z + list[i - 1].length,
          );
        }
      }
    }
  });

  it('兩不會卡在列車或擋牆裡面；道具不放在障礙上', () => {
    for (const seed of [1, 2, 3]) {
      const s = createRun({ seed, introSeconds: 0 });
      while (s.player.z < 2500) {
        s.player.z += 40;
        step(s, [], 1 / 120);
        s.status = 'running';
        for (const c of s.coinList) {
          for (const o of s.obstacles) {
            if (o.lane !== c.lane || o.speed > 0) continue;
            if (c.z < o.z || c.z > o.z + o.length) continue;
            if (o.kind === 'train') expect(c.y, `seed ${seed} 兩在列車裡`).toBeGreaterThanOrEqual(TRAIN.height);
            if (o.kind === 'block') expect(c.y, `seed ${seed} 兩在擋牆裡`).toBeGreaterThanOrEqual(BLOCK.height);
          }
        }
        for (const k of s.pickups) {
          for (const o of s.obstacles) {
            if (o.lane !== k.lane || o.speed > 0) continue;
            expect(k.z < o.z - 1 || k.z > o.z + o.length + 1, `seed ${seed} 道具在障礙上`).toBe(true);
          }
        }
      }
    }
  });
});

describe('關卡確實有挑戰', () => {
  it('完全不操作的話，300 m 內就會死', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = createRun({ seed, introSeconds: 0 });
      for (let i = 0; i < 60 * 60 && s.status === 'running' && s.player.z < 300; i++) step(s, [], 1 / 60);
      expect(s.status, `seed ${seed} 不操作居然跑到 ${s.player.z.toFixed(0)} m`).toBe('dead');
    }
  });

  it('自動駕駛跑 3000 m 途中有跳、滾、換線，也上過車頂', () => {
    const s = createRun({ seed: 3, introSeconds: 0 });
    const bot = new Autopilot({ reaction: 0.35 });
    const count: Record<string, number> = {};
    let roofTime = 0;
    while (s.status === 'running' && s.player.z < 3000) {
      for (const e of step(s, bot.decide(s, 1 / 60), 1 / 60)) count[e.type] = (count[e.type] ?? 0) + 1;
      if (s.player.y > TRAIN.height - 0.1) roofTime += 1 / 60;
    }
    expect(count.jump ?? 0).toBeGreaterThan(10);
    expect(count.roll ?? 0).toBeGreaterThan(5);
    expect(count.lane ?? 0).toBeGreaterThan(20);
    expect(roofTime).toBeGreaterThan(2);
    expect(count.coin ?? 0).toBeGreaterThan(50);
  });
});

describe('公平性：自動駕駛（有反應延遲）跑得完', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}：反應延遲 0.35 秒跑到 3000 m 不死`, () => {
      const { s, report } = drive(seed, 3000, 0.35);
      expect(s.status, report).toBe('running');
      expect(s.player.z).toBeGreaterThanOrEqual(3000);
    });
  }
});
