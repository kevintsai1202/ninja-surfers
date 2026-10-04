/**
 * 音樂理論純函式（不依賴 Web Audio，可在 Node 單元測試）：
 * 音名／MIDI／頻率換算、日本音階、種子亂數、樂句變奏、BPM 排程換算。
 */

/** 日本音階的半音間隔：yo = 陽音階（D E G A B 類）；miyako = 陰音階／都節（D Eb G A Bb 類） */
export const SCALES = {
  yo: [0, 2, 5, 7, 9],
  miyako: [0, 1, 5, 7, 8],
} as const;

export type ScaleName = keyof typeof SCALES;

/** 每拍切成幾個排程格（16 分音符 = 4 格） */
export const STEPS_PER_BEAT = 4;
/** 每小節拍數（全部曲子都用 4/4） */
export const BEATS_PER_BAR = 4;

/** 各音名對應 C 起算的半音數 */
const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * MIDI 音高轉頻率（A4 = 69 = 440Hz）。
 * @param midi MIDI 音高，可為小數
 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 音名轉 MIDI，例如 'D4' -> 62、'Eb3' -> 51、'F#5' -> 78。
 * @param name 音名（A-G，可帶 # 或 b，再接八度數字）
 * @throws 格式不合時丟錯
 */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`無效的音名：${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + NOTE_BASE[m[1]] + acc;
}

/**
 * 音階級數轉 MIDI。degree 0 = 主音，超過音階長度就往上一個八度，負數往下。
 * @param root 主音 MIDI
 * @param scale 音階名
 * @param degree 音階級數（整數，可為負）
 */
export function degreeToMidi(root: number, scale: ScaleName, degree: number): number {
  const iv = SCALES[scale];
  const n = iv.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + oct * 12 + iv[idx];
}

/**
 * 產生從主音起算、涵蓋指定八度數的音階音（含最後一個高八度主音）。
 * @param root 主音 MIDI
 * @param scale 音階名
 * @param octaves 八度數（預設 1）
 */
export function scaleNotes(root: number, scale: ScaleName, octaves = 1): number[] {
  const n = SCALES[scale].length;
  const out: number[] = [];
  for (let d = 0; d <= n * octaves; d++) out.push(degreeToMidi(root, scale, d));
  return out;
}

/**
 * 判斷某個 MIDI 音高（不分八度）是否屬於以 root 為主音的音階。
 * @param midi 要檢查的音高
 * @param root 主音 MIDI
 * @param scale 音階名
 */
export function isInScale(midi: number, root: number, scale: ScaleName): boolean {
  const pc = (((midi - root) % 12) + 12) % 12;
  return (SCALES[scale] as readonly number[]).includes(pc);
}

/**
 * mulberry32 種子亂數：同種子序列必定相同，回傳 [0,1) 的函式。
 * @param seed 32 位元整數種子
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每拍秒數 */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** 拍數轉秒數 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * secondsPerBeat(bpm);
}

/** 每個排程格（16 分音符）的秒數 */
export function stepSeconds(bpm: number): number {
  return secondsPerBeat(bpm) / STEPS_PER_BEAT;
}

/** 拍位置轉排程格索引（四捨五入到 16 分音符格線） */
export function beatToStep(beat: number): number {
  return Math.round(beat * STEPS_PER_BEAT);
}

/**
 * 強度（0..1）對速度的倍率：強度 1 時節奏約快 10%。
 * @param intensity 0..1（超出範圍會被夾住）
 */
export function tempoFactor(intensity: number): number {
  const x = Math.min(1, Math.max(0, intensity));
  return 1 + 0.1 * x;
}

/** 手寫旋律的一個音：beat 為小節內拍位置（0..4），dur 為拍數，degree 為音階級數 */
export interface MotifNote {
  beat: number;
  dur: number;
  degree: number;
}

/** 樂句變奏參數 */
export interface VaryOptions {
  /** 非首尾音被上下挪一級的機率 */
  pitchChance: number;
  /** 長音（>= 1 拍）被切成兩半的機率 */
  splitChance: number;
  /** 級數下限（含） */
  minDegree: number;
  /** 級數上限（含） */
  maxDegree: number;
}

/** 預設變奏參數 */
export const DEFAULT_VARY: VaryOptions = { pitchChance: 0.25, splitChance: 0.2, minDegree: -3, maxDegree: 9 };

/**
 * 對單一小節的旋律做種子變奏：首尾音保持不動當錨點，中間音偶爾挪一級、
 * 長音偶爾切半。音符仍落在原小節內、級數仍在音階內，所以不會聽起來是亂跳。
 * 亂數呼叫順序固定，因此同種子結果一致。
 * @param bar 原小節旋律
 * @param rand 亂數函式（mulberry32）
 * @param opts 變奏參數
 */
export function varyBar(bar: readonly MotifNote[], rand: () => number, opts: VaryOptions = DEFAULT_VARY): MotifNote[] {
  const out: MotifNote[] = [];
  const last = bar.length - 1;
  const clamp = (d: number) => Math.min(opts.maxDegree, Math.max(opts.minDegree, d));
  bar.forEach((n, i) => {
    // 每個音固定消耗 3 次亂數，確保順序穩定
    const rPitch = rand();
    const rDir = rand();
    const rSplit = rand();
    let degree = n.degree;
    if (i > 0 && i < last && rPitch < opts.pitchChance) degree = clamp(degree + (rDir < 0.5 ? -1 : 1));
    if (n.dur >= 1 && rSplit < opts.splitChance) {
      const half = n.dur / 2;
      out.push({ beat: n.beat, dur: half, degree });
      out.push({ beat: n.beat + half, dur: half, degree: clamp(degree + (rDir < 0.5 ? 1 : -1)) });
    } else {
      out.push({ beat: n.beat, dur: n.dur, degree });
    }
  });
  return out;
}

/**
 * 由 4 小節（或任意小節數）的手寫樂句組出一個完整循環：
 * 前半原樣，後半除最後一小節外逐小節變奏，最後一小節換成終止式（cadence）收回主音。
 * 這樣循環首尾銜接、後半有變化又不離題。
 * @param phrase 手寫樂句（每小節一個陣列）
 * @param cadence 終止式小節
 * @param seed 變奏種子
 * @param opts 變奏參數
 * @returns 長度為 phrase.length * 2 的小節陣列
 */
export function buildLeadLoop(
  phrase: readonly (readonly MotifNote[])[],
  cadence: readonly MotifNote[],
  seed: number,
  opts: VaryOptions = DEFAULT_VARY,
): MotifNote[][] {
  const rand = mulberry32(seed);
  const first = phrase.map((b) => b.map((n) => ({ ...n })));
  const second = phrase.slice(0, -1).map((b) => varyBar(b, rand, opts));
  second.push(cadence.map((n) => ({ ...n })));
  return [...first, ...second];
}

/** 和弦音在「音階級數」上的堆疊（根音、上兩級、上四級、高八度根音） */
export const CHORD_TONE_OFFSETS = [0, 2, 4, 5] as const;

/**
 * 取和弦音的音階級數。
 * @param rootDegree 和弦根音的音階級數
 * @param toneIndex 0..3，對應 CHORD_TONE_OFFSETS
 */
export function chordDegree(rootDegree: number, toneIndex: number): number {
  return rootDegree + CHORD_TONE_OFFSETS[toneIndex];
}
