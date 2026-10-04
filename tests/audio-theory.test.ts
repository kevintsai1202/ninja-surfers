import { describe, expect, it } from 'vitest';
import {
  BEATS_PER_BAR,
  SCALES,
  STEPS_PER_BEAT,
  beatToStep,
  beatsToSeconds,
  buildLeadLoop,
  chordDegree,
  degreeToMidi,
  isInScale,
  midiToFreq,
  mulberry32,
  noteToMidi,
  scaleNotes,
  secondsPerBeat,
  stepSeconds,
  tempoFactor,
  varyBar,
  type MotifNote,
} from '../src/audio/theory';

describe('音名與頻率', () => {
  it('A4 = 440Hz，高八度加倍', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
  });
  it('音名轉 MIDI', () => {
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('D4')).toBe(62);
    expect(noteToMidi('Eb3')).toBe(51);
    expect(noteToMidi('F#5')).toBe(78);
  });
  it('無效音名丟錯', () => {
    expect(() => noteToMidi('H4')).toThrow();
    expect(() => noteToMidi('D')).toThrow();
  });
});

describe('日本音階', () => {
  it('陽音階 D E G A B', () => {
    const d4 = noteToMidi('D4');
    expect(scaleNotes(d4, 'yo').map((m) => m - d4)).toEqual([0, 2, 5, 7, 9, 12]);
    expect([0, 1, 2, 3, 4].map((d) => degreeToMidi(d4, 'yo', d))).toEqual(
      ['D4', 'E4', 'G4', 'A4', 'B4'].map(noteToMidi),
    );
  });
  it('陰音階 D Eb G A Bb', () => {
    const d4 = noteToMidi('D4');
    expect([0, 1, 2, 3, 4].map((d) => degreeToMidi(d4, 'miyako', d))).toEqual(
      ['D4', 'Eb4', 'G4', 'A4', 'Bb4'].map(noteToMidi),
    );
  });
  it('級數超出範圍會換八度，負數往下', () => {
    const d4 = noteToMidi('D4');
    expect(degreeToMidi(d4, 'yo', 5)).toBe(d4 + 12);
    expect(degreeToMidi(d4, 'yo', 6)).toBe(d4 + 14);
    expect(degreeToMidi(d4, 'yo', -1)).toBe(noteToMidi('B3'));
    expect(degreeToMidi(d4, 'miyako', -1)).toBe(noteToMidi('Bb3'));
  });
  it('isInScale 不分八度判斷', () => {
    const d4 = noteToMidi('D4');
    expect(isInScale(noteToMidi('B2'), d4, 'yo')).toBe(true);
    expect(isInScale(noteToMidi('F4'), d4, 'yo')).toBe(false);
    expect(isInScale(noteToMidi('Eb6'), d4, 'miyako')).toBe(true);
    expect(isInScale(noteToMidi('E4'), d4, 'miyako')).toBe(false);
  });
  it('和弦音級數', () => {
    expect(chordDegree(2, 0)).toBe(2);
    expect(chordDegree(2, 3)).toBe(7);
  });
});

describe('mulberry32', () => {
  it('同種子序列相同、不同種子不同', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = Array.from({ length: 10 }, a);
    expect(Array.from({ length: 10 }, b)).toEqual(sa);
    expect(Array.from({ length: 10 }, c)).not.toEqual(sa);
  });
  it('值在 [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('BPM 換算', () => {
  it('每拍、每格秒數', () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5, 9);
    expect(beatsToSeconds(4, 150)).toBeCloseTo(1.6, 9);
    expect(stepSeconds(120)).toBeCloseTo(0.125, 9);
    expect(beatToStep(1.5)).toBe(1.5 * STEPS_PER_BEAT);
  });
  it('強度越高節奏越快，且夾在 0..1', () => {
    expect(tempoFactor(0)).toBe(1);
    expect(tempoFactor(1)).toBeGreaterThan(tempoFactor(0.5));
    expect(tempoFactor(5)).toBe(tempoFactor(1));
    expect(tempoFactor(-1)).toBe(1);
  });
});

describe('樂句變奏', () => {
  const bar: MotifNote[] = [
    { beat: 0, dur: 1.5, degree: 0 },
    { beat: 1.5, dur: 0.5, degree: 2 },
    { beat: 2, dur: 1, degree: 3 },
    { beat: 3, dur: 1, degree: 2 },
  ];
  it('同種子結果相同', () => {
    expect(varyBar(bar, mulberry32(5))).toEqual(varyBar(bar, mulberry32(5)));
  });
  it('音符仍在小節內、可對齊 16 分音符格線、首尾音級數不變', () => {
    for (let seed = 0; seed < 200; seed++) {
      const out = varyBar(bar, mulberry32(seed));
      expect(out[0].degree).toBe(0);
      for (const n of out) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat + n.dur).toBeLessThanOrEqual(BEATS_PER_BAR + 1e-9);
        expect(Number.isInteger(n.beat * STEPS_PER_BEAT)).toBe(true);
        expect(Number.isInteger(n.dur * STEPS_PER_BEAT)).toBe(true);
        expect(Number.isInteger(n.degree)).toBe(true);
      }
      // 總長度不變（切半不改變時值）
      expect(out.reduce((s, n) => s + n.dur, 0)).toBeCloseTo(4, 9);
    }
  });
  it('變奏後轉成 MIDI 都在音階內', () => {
    const root = noteToMidi('D3');
    for (const scale of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      for (let seed = 0; seed < 50; seed++) {
        for (const n of varyBar(bar, mulberry32(seed))) {
          expect(isInScale(degreeToMidi(root, scale, n.degree), root, scale)).toBe(true);
        }
      }
    }
  });
  it('級數會夾在上下限內', () => {
    const opts = { pitchChance: 1, splitChance: 1, minDegree: 0, maxDegree: 3 };
    for (let seed = 0; seed < 100; seed++) {
      for (const n of varyBar(bar, mulberry32(seed), opts)) {
        expect(n.degree).toBeGreaterThanOrEqual(0);
        expect(n.degree).toBeLessThanOrEqual(3);
      }
    }
  });
  it('不同種子至少有一個產生不同結果', () => {
    const base = JSON.stringify(varyBar(bar, mulberry32(0)));
    let differs = false;
    for (let s = 1; s < 50; s++) if (JSON.stringify(varyBar(bar, mulberry32(s))) !== base) differs = true;
    expect(differs).toBe(true);
  });
});

describe('buildLeadLoop', () => {
  const phrase: MotifNote[][] = [
    [{ beat: 0, dur: 4, degree: 0 }],
    [{ beat: 0, dur: 2, degree: 2 }, { beat: 2, dur: 2, degree: 3 }],
    [{ beat: 0, dur: 4, degree: 4 }],
    [{ beat: 0, dur: 4, degree: 3 }],
  ];
  const cadence: MotifNote[] = [{ beat: 0, dur: 4, degree: 0 }];
  it('小節數為兩倍、前半原樣、最後一小節為終止式', () => {
    const loop = buildLeadLoop(phrase, cadence, 9);
    expect(loop).toHaveLength(8);
    expect(loop.slice(0, 4)).toEqual(phrase);
    expect(loop[7]).toEqual(cadence);
  });
  it('同種子相同', () => {
    expect(buildLeadLoop(phrase, cadence, 9)).toEqual(buildLeadLoop(phrase, cadence, 9));
  });
});
