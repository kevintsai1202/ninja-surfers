/**
 * Ninja Surfers 音訊引擎：音樂與音效全部以 Web Audio API 合成，不使用任何音檔。
 * 匯流排：music / sfx 分開 -> master -> DynamicsCompressor -> Analyser -> destination；
 * 另有一條由程式產生 impulse response 的殘響。
 */
import { MusicRunner } from './music';
import { triggerSfx } from './sfx';
import { preferPlaybackSession, startSilentLoopIfNeeded } from './iosAudio';

export type SfxName =
  | 'coin' | 'jump' | 'superJump' | 'roll' | 'lane' | 'land' | 'stumble' | 'crash'
  | 'powerup' | 'poof' | 'toad' | 'magnet' | 'clone' | 'board' | 'boardBreak'
  | 'scroll' | 'revive' | 'gameOver' | 'click' | 'trainHorn' | 'anbu' | 'biome'
  | 'throw' | 'clink' | 'break' | 'explode' | 'rasengan' | 'flicker' | 'substitution' | 'climb';
export type MusicTrack = 'title' | 'village' | 'forest' | 'valley';
export interface SfxOptions { pan?: number /* -1..1 */; pitch?: number /* 倍率，預設 1 */; volume?: number /* 0..1 */ }

/** 音樂總線基準音量（比音效小，避免蓋過音效） */
const MUSIC_LEVEL = 0.26;
/** 暫停時音樂總線的音量倍率 */
const PAUSED_FACTOR = 0.12;
/** 音樂交叉淡化秒數 */
const CROSSFADE = 1;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverbIn!: GainNode;
  private analyser!: AnalyserNode;
  private analyserBuf!: Float32Array<ArrayBuffer>;
  private noise!: AudioBuffer;
  private _unlocked = false;
  private _muted = false;
  private paused = false;
  /** 想播的曲子（unlock 前先記著，unlock 後補播） */
  private wantTrack: MusicTrack | null = null;
  /** 目前正在播的曲子與其 runner */
  private currentTrack: MusicTrack | null = null;
  private runner: MusicRunner | null = null;
  private intensity = 0;

  /**
   * 建構時不建立 AudioContext（瀏覽器要使用者手勢才能出聲）。
   * 掛上全域手勢監聽：每次 touchend／click／keydown 都檢查，聲音還沒真的開始就再試一次
   * （iOS 要在 touchend／click 裡 resume；來電或切 App 回來會變成 interrupted，也要重試）。
   */
  constructor() {
    if (typeof window === 'undefined') return;
    const retry = () => {
      if (this.ctx && this.ctx.state !== 'running') this.unlock();
    };
    for (const type of ['touchend', 'click', 'keydown', 'pointerup']) {
      window.addEventListener(type, retry, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) retry();
    });
  }

  /** 聲音是否真的在播（AudioContext 已建立且狀態是 running） */
  get unlocked(): boolean {
    return this._unlocked && this.ctx !== null && this.ctx.state === 'running';
  }

  /** 是否靜音 */
  get muted(): boolean {
    return this._muted;
  }

  /**
   * 第一次使用者手勢時呼叫：建立或 resume AudioContext。
   * 不 await resume（headless 沒手勢時 resume 會永遠 pending）。
   */
  unlock(): void {
    // iOS：改走媒體播放（不受響鈴／靜音鍵影響），要在建立或 resume AudioContext 之前設定
    preferPlaybackSession();
    if (!this.ctx) {
      try {
        this.build();
      } catch {
        return; // 無 Web Audio 環境：安靜地放棄
      }
      // 狀態變成 running 時補播音樂（resume 是非同步的）
      this.ctx!.addEventListener('statechange', () => {
        if (this.ctx?.state === 'running') this.applyMusic();
      });
    }
    // 舊版 iOS（沒有 audioSession）：在這次手勢裡播無聲迴圈，同樣讓 Web Audio 不受靜音鍵影響
    startSilentLoopIfNeeded();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    this._unlocked = true;
    // 補播 unlock 前就要求的曲子（還沒 running 的話，statechange 時會再補一次）
    this.applyMusic();
  }

  /**
   * 靜音開關：主音量淡出／淡入。靜音狀態的保存由呼叫端負責。
   * @param m 是否靜音
   */
  setMuted(m: boolean): void {
    this._muted = m;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.9, now + 0.15);
  }

  /**
   * 播放音效；還沒 unlock 或靜音時安靜地什麼都不做。
   * @param name 音效名
   * @param opts pan / pitch / volume
   */
  playSfx(name: SfxName, opts?: SfxOptions): void {
    // 聲音還沒真的開始（例如 iOS 還在等手勢）時不排音效，避免 resume 的瞬間一口氣全部播出來
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || this._muted) return;
    triggerSfx({ ctx, bus: this.sfxBus, reverb: this.reverbIn, noise: this.noise }, name, opts);
  }

  /**
   * 切換背景音樂，約 1 秒交叉淡化；null = 停止；同一首重複呼叫不重播。
   * @param track 曲名或 null
   */
  setMusic(track: MusicTrack | null): void {
    this.wantTrack = track;
    this.applyMusic();
  }

  /**
   * 跑速強度 0..1：節奏略加快、多加打擊層（內部平滑）。
   * @param x 強度
   */
  setIntensity(x: number): void {
    this.intensity = Math.min(1, Math.max(0, x));
    this.runner?.setIntensity(this.intensity);
  }

  /**
   * 暫停時音樂降到很小聲。
   * @param p 是否暫停
   */
  setPaused(p: boolean): void {
    this.paused = p;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(p ? MUSIC_LEVEL * PAUSED_FACTOR : MUSIC_LEVEL, now + 0.2);
  }

  /**
   * 目前輸出音量 RMS（0..1），給 e2e 當「確實有聲音」的證據。
   */
  getLevel(): number {
    if (!this.ctx) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserBuf);
    let sum = 0;
    for (let i = 0; i < this.analyserBuf.length; i++) sum += this.analyserBuf[i] * this.analyserBuf[i];
    return Math.sqrt(sum / this.analyserBuf.length);
  }

  /** 建立整個音訊圖：總線、壓縮器、分析器、殘響、噪音 buffer */
  private build(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.9;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyserBuf = new Float32Array(this.analyser.fftSize);
    this.master.connect(comp);
    comp.connect(ctx.destination);
    comp.connect(this.analyser);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.paused ? MUSIC_LEVEL * PAUSED_FACTOR : MUSIC_LEVEL;
    this.musicBus.connect(this.master);

    // 殘響：衰減噪音 impulse response
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(1.8, 2.6);
    const ret = ctx.createGain();
    ret.gain.value = 0.35;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(conv).connect(ret).connect(this.master);

    // 2 秒白噪音（樂器與音效共用，循環播放）
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /**
   * 產生雙聲道衰減噪音當殘響 impulse response。
   * @param seconds 長度
   * @param decay 衰減指數（越大衰減越快）
   */
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** 讓實際播放的曲子對齊 wantTrack：換曲時舊曲淡出、新曲淡入；null 則停止 */
  private applyMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked) return;
    if (this.wantTrack === this.currentTrack) return;
    const old = this.runner;
    this.runner = null;
    this.currentTrack = this.wantTrack;
    if (old) old.stop(CROSSFADE);
    if (this.wantTrack) {
      const r = new MusicRunner(
        { ctx, noise: this.noise, reverb: this.reverbIn },
        this.musicBus,
        this.wantTrack,
        this.intensity,
      );
      this.runner = r;
      r.start(old ? CROSSFADE : 0.4);
    }
  }
}
