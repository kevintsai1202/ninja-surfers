/**
 * 和風樂器合成（音樂用）：尺八風的笛、箏、三味線、太鼓、締太鼓、鉦。
 * 每個音符都建立新節點，結束後在 onended 裡 disconnect，避免節點洩漏。
 */
import { midiToFreq } from './theory';

/** 樂器共用環境 */
export interface VoiceEnv {
  ctx: AudioContext;
  /** 迴圈用的白噪音 buffer */
  noise: AudioBuffer;
  /** 殘響輸入（ConvolverNode 的前級） */
  reverb: AudioNode;
}

/** 極小值：指數曲線不能到 0，用它當「靜音」 */
const EPS = 0.0001;

/**
 * 來源播完時斷開整串節點，避免洩漏。
 * @param src 最晚結束的來源節點
 * @param nodes 要斷開的節點
 */
function disposeOnEnd(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) n.disconnect();
  };
}

/**
 * 建立一個循環白噪音來源（起點隨機，避免每次聽起來一樣）。
 * @param env 環境
 * @param t 開始時間
 * @param dur 長度（秒）
 */
function noiseSrc(env: VoiceEnv, t: number, dur: number): AudioBufferSourceNode {
  const s = env.ctx.createBufferSource();
  s.buffer = env.noise;
  s.loop = true;
  s.start(t, Math.random() * (env.noise.duration - 0.1));
  s.stop(t + dur);
  return s;
}

/**
 * 建立殘響送出節點（gain -> reverb）。
 * @param env 環境
 * @param amount 送出量
 */
function reverbSend(env: VoiceEnv, amount: number): GainNode {
  const g = env.ctx.createGain();
  g.gain.value = amount;
  g.connect(env.reverb);
  return g;
}

/**
 * 尺八風的笛：sine＋triangle 本體，滑音進入、延遲出現的 vibrato，
 * 再疊一層帶通濾波白噪音當氣音。
 * @param env 環境
 * @param out 輸出節點
 * @param t 發聲時間（AudioContext 時間）
 * @param freq 頻率（Hz）
 * @param dur 長度（秒）
 * @param vel 力度 0..1
 */
export function playFlute(env: VoiceEnv, out: AudioNode, t: number, freq: number, dur: number, vel: number): void {
  const { ctx } = env;
  const end = t + dur + 0.14;
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.07);
  g.gain.setValueAtTime(vel * 0.46, t + Math.max(0.08, dur));
  g.gain.exponentialRampToValueAtTime(EPS, end);
  g.connect(out);

  const body = ctx.createOscillator();
  body.type = 'sine';
  const tri = ctx.createOscillator();
  tri.type = 'triangle';
  const triGain = ctx.createGain();
  triGain.gain.value = 0.3;
  for (const o of [body, tri]) {
    // 滑音：從略低半音以下滑入
    o.frequency.setValueAtTime(freq * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
  }
  body.connect(g);
  tri.connect(triGain).connect(g);

  // vibrato：起音後 0.25 秒才逐漸加深
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(0, t);
  lfoGain.gain.linearRampToValueAtTime(freq * 0.007, t + 0.3);
  lfo.connect(lfoGain);
  lfoGain.connect(body.frequency);
  lfoGain.connect(tri.frequency);

  // 氣音
  const n = noiseSrc(env, t, dur + 0.14);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(8000, freq * 2);
  bp.Q.value = 2.5;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(EPS, t);
  ng.gain.linearRampToValueAtTime(vel * 0.16, t + 0.03);
  ng.gain.exponentialRampToValueAtTime(vel * 0.04, t + 0.25);
  ng.gain.setValueAtTime(vel * 0.04, t + Math.max(0.26, dur));
  ng.gain.exponentialRampToValueAtTime(EPS, end);
  n.connect(bp).connect(ng).connect(g);

  const send = reverbSend(env, 0.5);
  g.connect(send);

  for (const o of [body, tri, lfo]) {
    o.start(t);
    o.stop(end);
  }
  disposeOnEnd(body, [g, body, tri, triGain, lfo, lfoGain, n, bp, ng, send]);
}

/**
 * 箏：撥弦感。triangle 本體＋高一個八度的 sine 泛音，lowpass 隨衰減收攏，
 * 起音極快、指數衰減，再加一點撥弦噪音。
 * @param env 環境
 * @param out 輸出節點
 * @param t 發聲時間
 * @param freq 頻率（Hz）
 * @param vel 力度 0..1
 */
export function playKoto(env: VoiceEnv, out: AudioNode, t: number, freq: number, vel: number): void {
  const { ctx } = env;
  const dur = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.003);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(9000, freq * 7), t);
  lp.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.6);
  lp.Q.value = 0.7;
  lp.connect(g).connect(out);

  const o1 = ctx.createOscillator();
  o1.type = 'triangle';
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2.003;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.35, t);
  g2.gain.exponentialRampToValueAtTime(EPS, t + 0.35);
  o1.connect(lp);
  o2.connect(g2).connect(lp);

  // 撥弦噪音
  const n = noiseSrc(env, t, 0.03);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.12, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + 0.025);
  n.connect(hp).connect(ng).connect(g);

  const send = reverbSend(env, 0.45);
  g.connect(send);

  o1.start(t);
  o2.start(t);
  o1.stop(t + dur + 0.05);
  o2.stop(t + dur + 0.05);
  disposeOnEnd(o1, [o1, o2, g2, lp, g, n, hp, ng, send]);
}

/**
 * 三味線：明亮撥弦。sawtooth＋略失諧方波，高通去低頻，lowpass 快速收攏，衰減短，
 * 加一個「撥片」噪音。
 * @param env 環境
 * @param out 輸出節點
 * @param t 發聲時間
 * @param freq 頻率（Hz）
 * @param vel 力度 0..1
 */
export function playShamisen(env: VoiceEnv, out: AudioNode, t: number, freq: number, vel: number): void {
  const { ctx } = env;
  const dur = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(vel * 0.4, t + 0.002);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 280;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(9000, freq * 9), t);
  lp.frequency.exponentialRampToValueAtTime(freq * 2.5, t + 0.18);
  lp.Q.value = 2;
  hp.connect(lp).connect(g).connect(out);

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = freq;
  const sq = ctx.createOscillator();
  sq.type = 'square';
  sq.frequency.value = freq;
  sq.detune.value = 7;
  const sqGain = ctx.createGain();
  sqGain.gain.value = 0.4;
  saw.connect(hp);
  sq.connect(sqGain).connect(hp);

  const n = noiseSrc(env, t, 0.03);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3500;
  bp.Q.value = 1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.25, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + 0.02);
  n.connect(bp).connect(ng).connect(g);

  const send = reverbSend(env, 0.18);
  g.connect(send);

  saw.start(t);
  sq.start(t);
  saw.stop(t + dur + 0.05);
  sq.stop(t + dur + 0.05);
  disposeOnEnd(saw, [saw, sq, sqGain, hp, lp, g, n, bp, ng, send]);
}

/**
 * 太鼓：低頻 sine 音高快速下滑＋低通噪音敲擊。
 * @param env 環境
 * @param out 輸出節點
 * @param t 發聲時間
 * @param midi 象徵音高（決定鼓的基頻）
 * @param vel 力度 0..1
 */
export function playTaiko(env: VoiceEnv, out: AudioNode, t: number, midi: number, vel: number): void {
  const { ctx } = env;
  const f = midiToFreq(midi);
  const dur = 0.55;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.9, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  g.connect(out);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f * 2.6, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.14);
  o.connect(g);

  const n = noiseSrc(env, t, 0.08);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.35, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + 0.07);
  n.connect(lp).connect(ng).connect(out);

  const send = reverbSend(env, 0.12);
  g.connect(send);

  o.start(t);
  o.stop(t + dur + 0.05);
  disposeOnEnd(o, [o, g, n, lp, ng, send]);
}

/**
 * 締太鼓：高頻乾脆的噪音敲擊，做 16 分音符的節奏層。
 * @param env 環境
 * @param out 輸出節點
 * @param t 發聲時間
 * @param vel 力度 0..1
 */
export function playShime(env: VoiceEnv, out: AudioNode, t: number, vel: number): void {
  const { ctx } = env;
  const n = noiseSrc(env, t, 0.08);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.45, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.06);
  n.connect(bp).connect(g).connect(out);
  disposeOnEnd(n, [n, bp, g]);
}

/**
 * 鉦：金屬感高頻，三個非諧波泛音短衰減。
 * @param env 環境
 * @param out 輸出節點
 * @param t 發聲時間
 * @param midi 象徵音高
 * @param vel 力度 0..1
 */
export function playKane(env: VoiceEnv, out: AudioNode, t: number, midi: number, vel: number): void {
  const { ctx } = env;
  const f = midiToFreq(midi);
  const dur = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.22, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  hp.connect(g).connect(out);
  const send = reverbSend(env, 0.3);
  g.connect(send);
  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  [1, 2.76, 5.4].forEach((r, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * r;
    const og = ctx.createGain();
    og.gain.value = [1, 0.5, 0.25][i];
    o.connect(og).connect(hp);
    o.start(t);
    o.stop(t + dur + 0.05);
    oscs.push(o);
    gains.push(og);
  });
  disposeOnEnd(oscs[0], [...oscs, ...gains, hp, g, send]);
}
