/**
 * 四首曲子的資料與生成（純資料＋純函式，不碰 Web Audio）。
 * 旋律層用「手寫樂句＋種子變奏」，節奏／分解和弦層用 16 格字串 pattern。
 */
import type { MusicTrack } from './audio';
import {
  BEATS_PER_BAR,
  STEPS_PER_BEAT,
  buildLeadLoop,
  beatToStep,
  chordDegree,
  degreeToMidi,
  type MotifNote,
  type ScaleName,
} from './theory';

/** 樂器層名稱 */
export type LayerName = 'lead' | 'koto' | 'shamisen' | 'taiko' | 'shime' | 'kane';

/** 一個排程事件（以 16 分音符格為單位，step 相對於循環起點） */
export interface NoteEvent {
  layer: LayerName;
  /** 起始格 */
  step: number;
  /** 長度（格） */
  durSteps: number;
  /** MIDI 音高（打擊樂為象徵音高，皆在音階內） */
  midi: number;
  /** 力度 0..1 */
  vel: number;
  /** 強度（setIntensity）達到此值才發聲 */
  minIntensity: number;
}

/** 一個完整循環 */
export interface TrackLoop {
  /** 循環總格數 */
  loopSteps: number;
  events: NoteEvent[];
}

/** 單一節奏層設定：pattern 長度必須是 16（一小節的 16 分音符格） */
export interface PatternLayer {
  pattern: string;
  /** 該層在循環最後一小節的過門（只用在打擊層） */
  fill?: string;
  /** 音階級數位移（只用在和弦分解層；5 = 高八度） */
  shift?: number;
  minIntensity?: number;
}

/** 曲子規格 */
export interface TrackSpec {
  id: MusicTrack;
  bpm: number;
  /** 主音 MIDI */
  root: number;
  scale: ScaleName;
  /** 旋律種子（每個循環以 seed + variant 變奏） */
  seed: number;
  /** 旋律整體的級數位移 */
  leadShift: number;
  /** 手寫樂句（每小節一個陣列） */
  leadPhrase: MotifNote[][];
  /** 終止式小節（循環最後一小節） */
  cadence: MotifNote[];
  /** 每小節的和弦根音級數，長度 = 循環小節數 */
  chords: number[];
  koto?: PatternLayer;
  shamisen?: PatternLayer;
  taiko: PatternLayer;
  shime?: PatternLayer;
  kane?: PatternLayer;
}

/** 變奏版本數（循環 N 次後變奏回到第一版） */
export const VARIANTS = 4;

/** 簡寫手寫音符 [拍位置, 拍數, 級數] */
const n = (beat: number, dur: number, degree: number): MotifNote => ({ beat, dur, degree });

/**
 * 四首曲子規格。
 * - title：英雄感、陽音階，笛主旋律＋箏分解和弦＋太鼓
 * - village：木葉村，輕快，笛＋三味線＋太鼓（締太鼓、鉦隨強度加入）
 * - forest：死亡森林，陰音階，低沉的笛、稀疏的箏、低太鼓
 * - valley：終末之谷，陰音階，重太鼓、箏 16 分快速分解和弦、三味線
 */
export const TRACKS: Record<MusicTrack, TrackSpec> = {
  title: {
    id: 'title',
    bpm: 110,
    root: 62, // D4
    scale: 'yo',
    seed: 11,
    leadShift: 0,
    leadPhrase: [
      [n(0, 1.5, 0), n(1.5, 0.5, 2), n(2, 2, 3)],
      [n(0, 1, 4), n(1, 1, 3), n(2, 1, 2), n(3, 1, 3)],
      [n(0, 1.5, 5), n(1.5, 0.5, 4), n(2, 1, 3), n(3, 1, 2)],
      [n(0, 1, 3), n(1, 1, 4), n(2, 2, 3)],
    ],
    cadence: [n(0, 1, 4), n(1, 1, 2), n(2, 2, 0)],
    chords: [0, 2, 3, 0, 0, 2, 3, 0],
    koto: { pattern: '0.1.2.3.2.1.2.1.', shift: 0 },
    taiko: { pattern: 'X...o...x...o...', fill: 'X...o...x...xxXX' },
    shime: { pattern: '..x...x...x...x.', minIntensity: 0.3 },
    kane: { pattern: 'x...............', minIntensity: 0.6 },
  },
  village: {
    id: 'village',
    bpm: 150,
    root: 62,
    scale: 'yo',
    seed: 23,
    leadShift: 0,
    leadPhrase: [
      [n(0, 0.5, 0), n(0.5, 0.5, 2), n(1, 0.5, 3), n(1.5, 0.5, 2), n(2, 1, 4), n(3, 0.5, 3), n(3.5, 0.5, 2)],
      [n(0, 0.5, 3), n(0.5, 0.5, 4), n(1, 1, 5), n(2, 0.5, 4), n(2.5, 0.5, 3), n(3, 1, 2)],
      [n(0, 0.5, 2), n(0.5, 0.5, 3), n(1, 0.5, 2), n(1.5, 0.5, 0), n(2, 1, 2), n(3, 1, 3)],
      [n(0, 1, 4), n(1, 0.5, 3), n(1.5, 0.5, 2), n(2, 2, 3)],
    ],
    cadence: [n(0, 0.5, 4), n(0.5, 0.5, 3), n(1, 0.5, 2), n(1.5, 0.5, 0), n(2, 2, 0)],
    chords: [0, 2, 3, 2, 0, 2, 3, 0],
    shamisen: { pattern: '0..1.2..0..1.2..', shift: 0 },
    taiko: { pattern: 'X...x.o.X...x.o.', fill: 'X.o.x.o.xxxxXXXX' },
    shime: { pattern: 'x.xxx.xxx.xxx.xx', minIntensity: 0.3 },
    kane: { pattern: '..x...x...x...x.', minIntensity: 0.6 },
  },
  forest: {
    id: 'forest',
    bpm: 140,
    root: 50, // D3
    scale: 'miyako',
    seed: 37,
    leadShift: 5,
    leadPhrase: [
      [n(0, 3, 0), n(3, 1, 1)],
      [n(0, 2, 2), n(2, 1, 1), n(3, 1, 0)],
      [n(0, 1, -1), n(1, 1, 0), n(2, 2, 1)],
      [n(0, 2, 2), n(2, 2, 1)],
    ],
    cadence: [n(0, 1, 2), n(1, 1, 1), n(2, 2, 0)],
    chords: [0, 0, 2, 1, 0, 0, 2, 0],
    koto: { pattern: '0...........2...', shift: 5 },
    taiko: { pattern: 'X.......o...x...', fill: 'X...o...x.x.xXXX' },
    shime: { pattern: '..x...x...x...x.', minIntensity: 0.4 },
    kane: { pattern: 'x...............', minIntensity: 0.7 },
  },
  valley: {
    id: 'valley',
    bpm: 160,
    root: 50,
    scale: 'miyako',
    seed: 53,
    leadShift: 5,
    leadPhrase: [
      [n(0, 1, 5), n(1, 0.5, 4), n(1.5, 0.5, 5), n(2, 1, 6), n(3, 1, 5)],
      [n(0, 1, 4), n(1, 1, 2), n(2, 1, 1), n(3, 1, 2)],
      [n(0, 0.5, 5), n(0.5, 0.5, 4), n(1, 0.5, 2), n(1.5, 0.5, 1), n(2, 2, 0)],
      [n(0, 1, 1), n(1, 1, 2), n(2, 2, 4)],
    ],
    cadence: [n(0, 1, 5), n(1, 1, 2), n(2, 2, 0)],
    chords: [0, 1, 2, 1, 0, 1, 2, 0],
    koto: { pattern: '0123210123210123', shift: 5 },
    shamisen: { pattern: '0.0.1.0.0.0.2.0.', shift: 0 },
    taiko: { pattern: 'X.xxX.xxX.xxX.xx', fill: 'XxXxXxXxXXXXXXXX' },
    shime: { pattern: 'x.x.x.x.x.x.x.x.', minIntensity: 0.2 },
    kane: { pattern: 'x.......x.......', minIntensity: 0.5 },
  },
};

/**
 * 打擊字元轉力度：'X' 重音、'x' 一般、'o' 輕音、其餘（含 '.'）= 休止。
 * @param ch pattern 單一字元
 * @returns 力度 0..1，休止回傳 0
 */
export function percVelocity(ch: string): number {
  if (ch === 'X') return 1;
  if (ch === 'x') return 0.7;
  if (ch === 'o') return 0.42;
  return 0;
}

/**
 * 取得某曲的循環小節數（手寫樂句小節數 × 2）。
 * @param spec 曲子規格
 */
export function loopBars(spec: TrackSpec): number {
  return spec.leadPhrase.length * 2;
}

/**
 * 打擊層象徵音高：取主音音名落在指定音域的音（保證在音階內）。
 * @param root 主音 MIDI
 * @param base 音域下緣 MIDI（回傳值落在 base..base+11）
 */
export function percPitch(root: number, base: number): number {
  return base + ((((root - base) % 12) + 12) % 12);
}

/**
 * 生成一個完整循環的事件（同 spec 同 variant 結果一致）。
 * @param spec 曲子規格
 * @param variant 變奏版本（會對 VARIANTS 取餘），影響旋律後半的變奏
 * @returns 循環格數與事件陣列
 */
export function buildLoop(spec: TrackSpec, variant = 0): TrackLoop {
  const bars = loopBars(spec);
  const stepsPerBar = BEATS_PER_BAR * STEPS_PER_BEAT;
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const events: NoteEvent[] = [];

  // 旋律層：手寫樂句＋種子變奏
  const lead = buildLeadLoop(spec.leadPhrase, spec.cadence, spec.seed + v * 7919);
  lead.forEach((bar, b) => {
    for (const note of bar) {
      events.push({
        layer: 'lead',
        step: b * stepsPerBar + beatToStep(note.beat),
        durSteps: Math.max(1, beatToStep(note.dur)),
        midi: degreeToMidi(spec.root, spec.scale, note.degree + spec.leadShift),
        vel: 0.8,
        minIntensity: 0,
      });
    }
  });

  // 和弦分解層（箏／三味線）：數字 = 和弦音索引
  const chordLayer = (layer: 'koto' | 'shamisen', cfg: PatternLayer | undefined, durSteps: number) => {
    if (!cfg) return;
    for (let b = 0; b < bars; b++) {
      for (let i = 0; i < stepsPerBar; i++) {
        const ch = cfg.pattern[i];
        if (ch === '.' || ch === undefined) continue;
        const deg = chordDegree(spec.chords[b % spec.chords.length], parseInt(ch, 10)) + (cfg.shift ?? 0);
        events.push({
          layer,
          step: b * stepsPerBar + i,
          durSteps: Math.min(durSteps, bars * stepsPerBar - (b * stepsPerBar + i)), // 不超出循環尾端
          midi: degreeToMidi(spec.root, spec.scale, deg),
          vel: i % 4 === 0 ? 0.9 : 0.6,
          minIntensity: cfg.minIntensity ?? 0,
        });
      }
    }
  };
  chordLayer('koto', spec.koto, 8);
  chordLayer('shamisen', spec.shamisen, 3);

  // 打擊層：循環最後一小節換成過門
  const percLayer = (layer: 'taiko' | 'shime' | 'kane', cfg: PatternLayer | undefined, midi: number) => {
    if (!cfg) return;
    for (let b = 0; b < bars; b++) {
      const pat = b === bars - 1 && cfg.fill ? cfg.fill : cfg.pattern;
      for (let i = 0; i < stepsPerBar; i++) {
        const vel = percVelocity(pat[i]);
        if (vel === 0) continue;
        events.push({ layer, step: b * stepsPerBar + i, durSteps: 1, midi, vel, minIntensity: cfg.minIntensity ?? 0 });
      }
    }
  };
  percLayer('taiko', spec.taiko, percPitch(spec.root, 36));
  percLayer('shime', spec.shime, percPitch(spec.root, 84));
  percLayer('kane', spec.kane, percPitch(spec.root, 84));

  events.sort((a, b) => a.step - b.step);
  return { loopSteps: bars * stepsPerBar, events };
}

/**
 * 把事件依格索引分組，讓排程器 O(1) 取得當格要發的音。
 * @param loop 一個循環
 * @returns 長度為 loopSteps 的陣列，每格一個事件陣列（可能為空）
 */
export function groupByStep(loop: TrackLoop): NoteEvent[][] {
  const out: NoteEvent[][] = Array.from({ length: loop.loopSteps }, () => []);
  for (const e of loop.events) out[e.step].push(e);
  return out;
}
