import { describe, it, expect } from 'vitest';
import { createRng } from '../src/sim/rng';
import { speedAt, minGap } from '../src/sim/speed';
import { biomeAt, biomeBlend, chaserIdentityAt } from '../src/sim/biome';
import { SPEED, BIOME_LEN, PHYS } from '../src/config';

describe('rng：種子亂數', () => {
  it('同種子產生相同序列、不同種子不同', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    const sb = Array.from({ length: 5 }, () => b.next());
    const sc = Array.from({ length: 5 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('int／pick／chance 在範圍內', () => {
    const r = createRng(7);
    for (let i = 0; i < 200; i++) {
      const n = r.int(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      expect(['a', 'b']).toContain(r.pick(['a', 'b']));
    }
    expect(createRng(1).chance(0)).toBe(false);
    expect(createRng(1).chance(1)).toBe(true);
  });

  it('weighted 依權重挑選，權重 0 的永遠不會被選到', () => {
    const r = createRng(9);
    for (let i = 0; i < 100; i++) {
      expect(r.weighted([['x', 0], ['y', 1]])).toBe('y');
    }
  });
});

describe('speed：速度曲線與間距', () => {
  it('起速、上限、單調遞增', () => {
    expect(speedAt(0)).toBeCloseTo(SPEED.start, 5);
    expect(speedAt(1e7)).toBeCloseTo(SPEED.max, 3);
    let prev = 0;
    for (let d = 0; d < 10000; d += 250) {
      const v = speedAt(d);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('minGap = 速度 × (反應 0.5 秒 + 最長動作時間) ＋ 餘裕，速度越快間距越大', () => {
    const airTime = (2 * PHYS.jumpVelocity) / PHYS.gravity;
    expect(minGap(12)).toBeGreaterThanOrEqual(12 * (0.5 + airTime));
    expect(minGap(28)).toBeGreaterThan(minGap(12));
  });
});

describe('biome：場景輪替', () => {
  it('依距離輪替 village → forest → valley → village', () => {
    expect(biomeAt(0)).toBe('village');
    expect(biomeAt(BIOME_LEN - 1)).toBe('village');
    expect(biomeAt(BIOME_LEN)).toBe('forest');
    expect(biomeAt(BIOME_LEN * 2 + 1)).toBe('valley');
    expect(biomeAt(BIOME_LEN * 3 + 1)).toBe('village');
  });

  it('交界前 60 m 開始漸變到下一個場景', () => {
    expect(biomeBlend(100)).toEqual({ from: 'village', to: 'forest', t: 0 });
    const mid = biomeBlend(BIOME_LEN - 30);
    expect(mid.from).toBe('village');
    expect(mid.to).toBe('forest');
    expect(mid.t).toBeCloseTo(0.5, 5);
  });

  it('1800 m 前是伊魯卡老師，之後是暗部', () => {
    expect(chaserIdentityAt(0)).toBe('iruka');
    expect(chaserIdentityAt(1799)).toBe('iruka');
    expect(chaserIdentityAt(1800)).toBe('anbu');
  });
});
