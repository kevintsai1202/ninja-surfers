import { describe, expect, it } from 'vitest';
import {
  TRACKS,
  VARIANTS,
  buildLoop,
  groupByStep,
  loopBars,
  percVelocity,
  type TrackSpec,
} from '../src/audio/songs';
import { BEATS_PER_BAR, STEPS_PER_BEAT, isInScale } from '../src/audio/theory';

const specs = Object.values(TRACKS) as TrackSpec[];
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;

describe('曲子規格', () => {
  it('BPM 與音階符合設計', () => {
    expect(TRACKS.title).toMatchObject({ bpm: 110, scale: 'yo' });
    expect(TRACKS.village).toMatchObject({ bpm: 150, scale: 'yo' });
    expect(TRACKS.forest).toMatchObject({ bpm: 140, scale: 'miyako' });
    expect(TRACKS.valley).toMatchObject({ bpm: 160, scale: 'miyako' });
  });
  it.each(specs.map((s) => [s.id, s] as const))('%s：pattern 皆為 16 格、和弦數 = 循環小節數', (_id, s) => {
    for (const l of [s.koto, s.shamisen, s.taiko, s.shime, s.kane]) {
      if (!l) continue;
      expect(l.pattern).toHaveLength(STEPS_PER_BAR);
      if (l.fill) expect(l.fill).toHaveLength(STEPS_PER_BAR);
    }
    expect(s.chords).toHaveLength(loopBars(s));
  });
  it.each(specs.map((s) => [s.id, s] as const))('%s：手寫樂句每小節落在 4 拍內', (_id, s) => {
    for (const bar of [...s.leadPhrase, s.cadence]) {
      for (const n of bar) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat + n.dur).toBeLessThanOrEqual(BEATS_PER_BAR);
      }
    }
  });
});

describe('buildLoop', () => {
  it.each(specs.map((s) => [s.id, s] as const))('%s：事件都在循環內、音高在音階內、同參數結果相同', (_id, s) => {
    for (let v = 0; v < VARIANTS; v++) {
      const loop = buildLoop(s, v);
      expect(loop.loopSteps).toBe(loopBars(s) * STEPS_PER_BAR);
      expect(loop.events.length).toBeGreaterThan(0);
      for (const e of loop.events) {
        expect(e.step).toBeGreaterThanOrEqual(0);
        expect(e.step + 0).toBeLessThan(loop.loopSteps);
        expect(e.step + e.durSteps).toBeLessThanOrEqual(loop.loopSteps);
        expect(isInScale(e.midi, s.root, s.scale)).toBe(true);
      }
      expect(buildLoop(s, v)).toEqual(loop);
    }
  });
  it.each(specs.map((s) => [s.id, s] as const))('%s：旋律最後一個音落在主音（無縫循環收尾）', (_id, s) => {
    const lead = buildLoop(s, 0).events.filter((e) => e.layer === 'lead');
    const last = lead[lead.length - 1];
    expect((last.midi - s.root) % 12).toBe(0);
  });
  it('不同 variant 的旋律後半有差異、前半相同', () => {
    const a = buildLoop(TRACKS.village, 0).events.filter((e) => e.layer === 'lead');
    const half = (TRACKS.village.leadPhrase.length * STEPS_PER_BAR);
    let differs = false;
    for (let v = 1; v < VARIANTS; v++) {
      const b = buildLoop(TRACKS.village, v).events.filter((e) => e.layer === 'lead');
      expect(b.filter((e) => e.step < half)).toEqual(a.filter((e) => e.step < half));
      if (JSON.stringify(b) !== JSON.stringify(a)) differs = true;
    }
    expect(differs).toBe(true);
  });
  it('各曲樂器層配置符合設計', () => {
    const layers = (id: keyof typeof TRACKS) => new Set(buildLoop(TRACKS[id]).events.map((e) => e.layer));
    expect(layers('village')).toEqual(new Set(['lead', 'shamisen', 'taiko', 'shime', 'kane']));
    expect(layers('title')).toContain('koto');
    expect(layers('forest')).toContain('koto');
    expect(layers('valley')).toContain('koto');
    expect(layers('valley')).toContain('shamisen');
  });
  it('太鼓：valley 比 forest 重（事件數較多）', () => {
    const count = (id: keyof typeof TRACKS) => buildLoop(TRACKS[id]).events.filter((e) => e.layer === 'taiko').length;
    expect(count('valley')).toBeGreaterThan(count('forest') * 2);
  });
  it('groupByStep 數量守恆', () => {
    const loop = buildLoop(TRACKS.title);
    const g = groupByStep(loop);
    expect(g).toHaveLength(loop.loopSteps);
    expect(g.reduce((s, x) => s + x.length, 0)).toBe(loop.events.length);
  });
  it('percVelocity', () => {
    expect(percVelocity('X')).toBeGreaterThan(percVelocity('x'));
    expect(percVelocity('x')).toBeGreaterThan(percVelocity('o'));
    expect(percVelocity('.')).toBe(0);
  });
});
