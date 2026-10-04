/**
 * 音樂排程器：前瞻排程（setInterval 約 25ms，每次排程未來約 0.12 秒內的音符）。
 * 一個 MusicRunner 負責一首曲子的無縫循環；換曲時舊 runner 停止排程並淡出，
 * 新 runner 淡入，達成約 1 秒的交叉淡化。
 */
import { playFlute, playKane, playKoto, playShamisen, playShime, playTaiko, type VoiceEnv } from './synth';
import { TRACKS, VARIANTS, buildLoop, groupByStep, type NoteEvent, type TrackSpec } from './songs';
import { midiToFreq, stepSeconds, tempoFactor } from './theory';
import type { MusicTrack } from './audio';

/** 排程計時器間隔（毫秒） */
const TICK_MS = 25;
/** 前瞻排程視窗（秒） */
const LOOKAHEAD = 0.12;
/** 強度平滑係數：每個 tick 往目標靠近的比例 */
const INTENSITY_SMOOTH = 0.06;

/** 各層的混音音量 */
const LAYER_GAIN: Record<NoteEvent['layer'], number> = {
  lead: 1,
  koto: 0.9,
  shamisen: 0.8,
  taiko: 1,
  shime: 0.7,
  kane: 0.7,
};

export class MusicRunner {
  /** 此曲專屬的音量節點（交叉淡化用） */
  readonly gain: GainNode;
  private readonly spec: TrackSpec;
  /** 目前循環的事件（依格分組） */
  private grid: NoteEvent[][];
  private loopSteps: number;
  /** 下一個要排程的格（相對於循環起點） */
  private step = 0;
  /** 已完成的循環數（決定變奏版本） */
  private loopCount = 0;
  /** 下一格的 AudioContext 時間 */
  private nextTime: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 目標強度與平滑後的強度 */
  private target = 0;
  private smooth = 0;

  /**
   * @param env 樂器環境
   * @param dest 輸出節點（音樂總線）
   * @param track 曲名
   * @param intensity 初始強度
   */
  constructor(
    private readonly env: VoiceEnv,
    dest: AudioNode,
    track: MusicTrack,
    intensity: number,
  ) {
    this.spec = TRACKS[track];
    const loop = buildLoop(this.spec, 0);
    this.grid = groupByStep(loop);
    this.loopSteps = loop.loopSteps;
    this.target = this.smooth = intensity;
    this.gain = env.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
    this.nextTime = env.ctx.currentTime + 0.06;
  }

  /** 開始排程並淡入（fadeSec 秒） */
  start(fadeSec: number): void {
    const now = this.env.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(1, now + fadeSec);
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** 設定目標強度（0..1），實際值會平滑追隨 */
  setIntensity(x: number): void {
    this.target = Math.min(1, Math.max(0, x));
  }

  /** 停止排程並淡出，淡出後斷開節點（會呼叫 onDone） */
  stop(fadeSec: number, onDone?: () => void): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.env.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    // 多等 0.3 秒讓已排程的尾音與殘響送出結束
    setTimeout(() => {
      this.gain.disconnect();
      onDone?.();
    }, (fadeSec + 0.3) * 1000);
  }

  /** 計時器回呼：把前瞻視窗內的格全部排程 */
  private tick(): void {
    const ctx = this.env.ctx;
    // 分頁被節流太久時，不要一次補播一大串，直接從現在重新接上
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05;
    this.smooth += (this.target - this.smooth) * INTENSITY_SMOOTH;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.grid[this.step], this.nextTime);
      // 每格的長度跟著當下的平滑強度走，節奏漸進加快、不會跳拍
      this.nextTime += stepSeconds(this.spec.bpm) / tempoFactor(this.smooth);
      this.step++;
      if (this.step >= this.loopSteps) {
        this.step = 0;
        this.loopCount++;
        // 每個循環換一個變奏版本，旋律後半略有不同
        const loop = buildLoop(this.spec, this.loopCount % VARIANTS);
        this.grid = groupByStep(loop);
        this.loopSteps = loop.loopSteps;
      }
    }
  }

  /**
   * 排程某一格的所有事件。
   * @param events 此格事件
   * @param t 此格的 AudioContext 時間
   */
  private scheduleStep(events: NoteEvent[], t: number): void {
    const spb = stepSeconds(this.spec.bpm) / tempoFactor(this.smooth);
    for (const e of events) {
      if (e.minIntensity > this.smooth) continue;
      const v = e.vel * LAYER_GAIN[e.layer];
      const dur = e.durSteps * spb;
      switch (e.layer) {
        case 'lead':
          playFlute(this.env, this.gain, t, midiToFreq(e.midi), dur, v);
          break;
        case 'koto':
          playKoto(this.env, this.gain, t, midiToFreq(e.midi), v);
          break;
        case 'shamisen':
          playShamisen(this.env, this.gain, t, midiToFreq(e.midi), v);
          break;
        case 'taiko':
          playTaiko(this.env, this.gain, t, e.midi, v);
          break;
        case 'shime':
          playShime(this.env, this.gain, t, v);
          break;
        case 'kane':
          playKane(this.env, this.gain, t, e.midi, v);
          break;
      }
    }
  }
}
