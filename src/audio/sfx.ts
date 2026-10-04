/**
 * 音效合成：每個音效都由 tone（振盪器）與 noise（濾波噪音）兩種基本元件組成。
 * 每次播放都建立新節點，並在來源結束時 disconnect。
 */
import type { SfxName, SfxOptions } from './audio';

/** 音效環境 */
export interface SfxEnv {
  ctx: AudioContext;
  /** 音效總線 */
  bus: AudioNode;
  /** 殘響輸入 */
  reverb: AudioNode;
  /** 白噪音 buffer */
  noise: AudioBuffer;
}

/** 單次播放的上下文：所有元件都接到 dest（panner），pitch 倍率套用在所有頻率上 */
interface Ctx {
  env: SfxEnv;
  dest: AudioNode;
  /** 播放起點時間 */
  t0: number;
  pitch: number;
}

/** 單音元件參數 */
interface ToneSpec {
  type?: OscillatorType;
  /** 起始頻率 */
  f: number;
  /** 結束頻率（指數滑音），省略則不滑 */
  f2?: number;
  /** 相對於 t0 的起始秒數 */
  t?: number;
  dur: number;
  vol: number;
  /** 起音秒數 */
  att?: number;
  /** lowpass 起始截止頻率；省略則不濾波 */
  lp?: number;
  /** lowpass 結束截止頻率 */
  lp2?: number;
  hp?: number;
  /** 殘響送出量 */
  send?: number;
  /** 方波／鋸齒等的失諧（cents） */
  detune?: number;
}

/** 噪音元件參數 */
interface NoiseSpec {
  t?: number;
  dur: number;
  vol: number;
  att?: number;
  type: BiquadFilterType;
  f: number;
  /** 濾波頻率終點（指數掃頻） */
  f2?: number;
  q?: number;
  send?: number;
}

/** 極小值：指數曲線的「靜音」 */
const EPS = 0.0001;

/** 同時播放中的音效數量（超過上限就略過，避免狂撿金幣時節點爆量） */
let active = 0;
const MAX_ACTIVE = 48;

/**
 * 建立殘響送出節點。
 * @param env 環境
 * @param amount 送出量
 * @param from 從哪個節點送出
 */
function sendTo(env: SfxEnv, amount: number, from: AudioNode): GainNode {
  const s = env.ctx.createGain();
  s.gain.value = amount;
  from.connect(s);
  s.connect(env.reverb);
  return s;
}

/**
 * 播放一個單音元件（振盪器＋指數包絡＋可選濾波）。
 * @param c 播放上下文
 * @param s 參數
 */
function tone(c: Ctx, s: ToneSpec): void {
  const { ctx } = c.env;
  const t = c.t0 + (s.t ?? 0);
  const end = t + s.dur;
  const o = ctx.createOscillator();
  o.type = s.type ?? 'sine';
  o.frequency.setValueAtTime(s.f * c.pitch, t);
  if (s.f2 !== undefined) o.frequency.exponentialRampToValueAtTime(s.f2 * c.pitch, end);
  if (s.detune) o.detune.value = s.detune;
  const g = ctx.createGain();
  const att = s.att ?? 0.004;
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(s.vol, t + att);
  g.gain.exponentialRampToValueAtTime(EPS, end);
  const nodes: AudioNode[] = [o, g];
  let head: AudioNode = o;
  if (s.hp !== undefined) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = s.hp * c.pitch;
    head.connect(hp);
    head = hp;
    nodes.push(hp);
  }
  if (s.lp !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(s.lp * c.pitch, t);
    if (s.lp2 !== undefined) lp.frequency.exponentialRampToValueAtTime(s.lp2 * c.pitch, end);
    head.connect(lp);
    head = lp;
    nodes.push(lp);
  }
  head.connect(g);
  g.connect(c.dest);
  if (s.send) nodes.push(sendTo(c.env, s.send, g));
  o.start(t);
  o.stop(end + 0.02);
  o.onended = () => nodes.forEach((n) => n.disconnect());
}

/**
 * 播放一個噪音元件（循環白噪音＋濾波掃頻＋包絡）。
 * @param c 播放上下文
 * @param s 參數
 */
function noise(c: Ctx, s: NoiseSpec): void {
  const { ctx, noise: buf } = c.env;
  const t = c.t0 + (s.t ?? 0);
  const end = t + s.dur;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = s.type;
  f.frequency.setValueAtTime(s.f * c.pitch, t);
  if (s.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(s.f2 * c.pitch, end);
  f.Q.value = s.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(s.vol, t + (s.att ?? 0.004));
  g.gain.exponentialRampToValueAtTime(EPS, end);
  src.connect(f).connect(g).connect(c.dest);
  const nodes: AudioNode[] = [src, f, g];
  if (s.send) nodes.push(sendTo(c.env, s.send, g));
  src.start(t, Math.random() * (buf.duration - 0.1));
  src.stop(end + 0.02);
  src.onended = () => nodes.forEach((n) => n.disconnect());
}

/**
 * 煙霧「砰」：低通噪音爆發＋低頻下沉。影分身、替身術、通靈共用。
 * @param c 播放上下文
 * @param t 相對起始秒數
 * @param k 音量倍率
 * @param pf 音高倍率
 */
function poofAt(c: Ctx, t: number, k = 1, pf = 1): void {
  noise(c, { t, dur: 0.45, vol: 0.6 * k, att: 0.005, type: 'lowpass', f: 2600 * pf, f2: 300 * pf, q: 0.8 });
  tone(c, { t, f: 150 * pf, f2: 50 * pf, dur: 0.25, vol: 0.4 * k });
}

/**
 * 各音效的合成配方。
 */
const RECIPES: Record<SfxName, (c: Ctx) => number> = {
  // 回傳值 = 音效總長（秒），用來決定何時釋放 panner/gain
  coin: (c) => {
    tone(c, { type: 'triangle', f: 1318.5, dur: 0.12, vol: 0.32 });
    tone(c, { type: 'triangle', f: 1975.5, t: 0.06, dur: 0.24, vol: 0.32 });
    tone(c, { type: 'sine', f: 3951, t: 0.06, dur: 0.18, vol: 0.06 });
    return 0.35;
  },
  jump: (c) => {
    noise(c, { dur: 0.3, vol: 0.28, att: 0.06, type: 'bandpass', f: 400, f2: 1700, q: 1.2 });
    return 0.35;
  },
  superJump: (c) => {
    noise(c, { dur: 0.6, vol: 0.32, att: 0.08, type: 'bandpass', f: 500, f2: 3800, q: 1.4 });
    tone(c, { type: 'sine', f: 440, f2: 1320, dur: 0.55, vol: 0.12, att: 0.05, send: 0.3 });
    tone(c, { type: 'triangle', f: 660, f2: 1980, t: 0.1, dur: 0.5, vol: 0.1, att: 0.05, send: 0.3 });
    tone(c, { type: 'sine', f: 2637, t: 0.35, dur: 0.3, vol: 0.06, send: 0.4 });
    return 0.7;
  },
  roll: (c) => {
    noise(c, { dur: 0.26, vol: 0.28, att: 0.05, type: 'bandpass', f: 900, f2: 300, q: 0.9 });
    return 0.3;
  },
  lane: (c) => {
    noise(c, { dur: 0.1, vol: 0.18, att: 0.02, type: 'bandpass', f: 2200, f2: 1200, q: 1 });
    return 0.15;
  },
  land: (c) => {
    tone(c, { f: 130, f2: 60, dur: 0.15, vol: 0.5 });
    noise(c, { dur: 0.06, vol: 0.22, type: 'lowpass', f: 400 });
    return 0.2;
  },
  stumble: (c) => {
    // 木頭碰撞兩下＋短下行音
    tone(c, { type: 'triangle', f: 240, f2: 130, dur: 0.1, vol: 0.5 });
    noise(c, { dur: 0.07, vol: 0.4, type: 'lowpass', f: 900 });
    tone(c, { type: 'triangle', f: 190, f2: 110, t: 0.09, dur: 0.1, vol: 0.4 });
    noise(c, { t: 0.09, dur: 0.06, vol: 0.3, type: 'lowpass', f: 800 });
    tone(c, { type: 'sawtooth', f: 320, f2: 120, t: 0.1, dur: 0.3, vol: 0.14, lp: 900 });
    return 0.45;
  },
  crash: (c) => {
    noise(c, { dur: 0.6, vol: 0.7, type: 'lowpass', f: 1600, f2: 180, q: 0.7, send: 0.15 });
    tone(c, { f: 95, f2: 35, dur: 0.75, vol: 0.8 });
    tone(c, { type: 'triangle', f: 170, f2: 60, dur: 0.4, vol: 0.3 });
    return 0.8;
  },
  powerup: (c) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(c, { type: 'triangle', f, t: i * 0.06, dur: 0.25, vol: 0.24, send: 0.2 });
    });
    tone(c, { type: 'sine', f: 2093, t: 0.24, dur: 0.5, vol: 0.1, send: 0.3 });
    noise(c, { t: 0.2, dur: 0.3, vol: 0.06, type: 'highpass', f: 6000 });
    return 0.75;
  },
  poof: (c) => {
    poofAt(c, 0);
    return 0.5;
  },
  toad: (c) => {
    // 「咕呱」＋砰
    tone(c, { type: 'sine', f: 150, f2: 90, dur: 0.16, vol: 0.45, att: 0.02 });
    tone(c, { type: 'square', f: 210, f2: 130, t: 0.15, dur: 0.2, vol: 0.2, lp: 500 });
    poofAt(c, 0.32, 0.9, 0.9);
    return 0.8;
  },
  magnet: (c) => {
    tone(c, { type: 'sawtooth', f: 80, f2: 400, dur: 0.9, vol: 0.2, att: 0.15, lp: 500, lp2: 1800 });
    tone(c, { type: 'sine', f: 160, f2: 800, dur: 0.9, vol: 0.14, att: 0.15, send: 0.2 });
    return 0.95;
  },
  clone: (c) => {
    poofAt(c, 0, 0.8, 1.1);
    poofAt(c, 0.09, 0.6, 1);
    poofAt(c, 0.18, 0.5, 0.9);
    return 0.7;
  },
  board: (c) => {
    // 卷軸展開的唰聲
    noise(c, { dur: 0.42, vol: 0.3, att: 0.15, type: 'bandpass', f: 1200, f2: 3200, q: 0.7 });
    return 0.5;
  },
  boardBreak: (c) => {
    noise(c, { dur: 0.05, vol: 0.6, type: 'highpass', f: 1500 });
    noise(c, { t: 0.04, dur: 0.05, vol: 0.5, type: 'highpass', f: 1200 });
    tone(c, { type: 'triangle', f: 300, f2: 100, dur: 0.12, vol: 0.4 });
    poofAt(c, 0.08, 0.8);
    return 0.6;
  },
  scroll: (c) => {
    [1568, 2093, 2637, 3136].forEach((f, i) => {
      tone(c, { type: 'sine', f, t: i * 0.05, dur: 0.5, vol: 0.12, send: 0.5 });
    });
    noise(c, { dur: 0.3, vol: 0.08, att: 0.05, type: 'bandpass', f: 5000, q: 2 });
    return 0.8;
  },
  revive: (c) => {
    [261.63, 329.63, 392, 523.25].forEach((f, i) => {
      tone(c, { type: 'triangle', f, t: i * 0.08, dur: 0.9, vol: 0.2, att: 0.03, lp: 2500, send: 0.35 });
    });
    return 1.3;
  },
  gameOver: (c) => {
    // 鑼：非諧波泛音、長衰減
    [1, 1.47, 2.09, 2.56, 3.4].forEach((r, i) => {
      tone(c, { type: 'sine', f: 110 * r, dur: 2.4 - i * 0.3, vol: 0.3 / (1 + i * 0.5), att: 0.01, send: 0.4 });
    });
    noise(c, { dur: 0.25, vol: 0.2, type: 'lowpass', f: 1200, f2: 300 });
    return 2.5;
  },
  click: (c) => {
    tone(c, { type: 'square', f: 1200, dur: 0.03, vol: 0.12, hp: 600 });
    tone(c, { type: 'sine', f: 800, dur: 0.05, vol: 0.12 });
    return 0.1;
  },
  trainHorn: (c) => {
    // 兩個略失諧的方波＋低通
    tone(c, { type: 'square', f: 233, f2: 226, dur: 0.85, vol: 0.2, att: 0.03, lp: 1200 });
    tone(c, { type: 'square', f: 233, f2: 226, dur: 0.85, vol: 0.2, att: 0.03, lp: 1200, detune: 14 });
    tone(c, { type: 'square', f: 311, f2: 300, dur: 0.85, vol: 0.12, att: 0.03, lp: 1200 });
    return 0.9;
  },
  anbu: (c) => {
    tone(c, { f: 62, f2: 40, dur: 0.55, vol: 0.8 });
    tone(c, { type: 'square', f: 55, dur: 0.4, vol: 0.18, lp: 300 });
    noise(c, { dur: 0.2, vol: 0.4, type: 'lowpass', f: 450 });
    tone(c, { type: 'sine', f: 1800, t: 0.02, dur: 0.5, vol: 0.1, send: 0.2 });
    tone(c, { type: 'sine', f: 2490, t: 0.02, dur: 0.4, vol: 0.08, send: 0.2 });
    return 0.65;
  },
  biome: (c) => {
    // 風鈴
    [1568, 1760, 2093, 2349, 2637].forEach((f, i) => {
      tone(c, { type: 'sine', f, t: i * 0.07, dur: 0.9, vol: 0.12, send: 0.5 });
    });
    return 1.3;
  },
};

/**
 * 播放一個音效。
 * @param env 音效環境
 * @param name 音效名
 * @param opts pan / pitch / volume
 */
export function triggerSfx(env: SfxEnv, name: SfxName, opts: SfxOptions = {}): void {
  if (active >= MAX_ACTIVE) return;
  const { ctx } = env;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.min(1, Math.max(-1, opts.pan ?? 0));
  const vol = ctx.createGain();
  vol.gain.value = Math.min(1, Math.max(0, opts.volume ?? 1));
  panner.connect(vol).connect(env.bus);
  const c: Ctx = { env, dest: panner, t0: ctx.currentTime + 0.005, pitch: opts.pitch && opts.pitch > 0 ? opts.pitch : 1 };
  const total = RECIPES[name](c);
  active++;
  // 播完後釋放這次的 panner / gain，以及計數
  setTimeout(() => {
    panner.disconnect();
    vol.disconnect();
    active--;
  }, (total + 0.2) * 1000);
}
