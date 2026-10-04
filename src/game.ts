import { createStage, type Stage } from './render/stage';
import { WorldView } from './render/world/worldView';
import { Actors, type ActorMode } from './render/actors';
import { Fx } from './render/fx';
import { CameraRig } from './render/cameraRig';
import { powerInfo } from './render/world/pickups';
import { AudioEngine, type MusicTrack, type SfxName } from './audio/audio';
import { Ui } from './ui/ui';
import { Input } from './input/input';
import { createRun, step, revive, reviveCost, addPickup, addObstacle, type RunState } from './sim/run';
import { Autopilot } from './sim/autopilot';
import { loadSave, writeSave, applyRunResult, type SaveData } from './sim/save';
import { speedAt } from './sim/speed';
import { biomeAt } from './sim/biome';
import type { Action, Lane, ObstacleKind, PowerKind, ScrollReward, SimEvent } from './sim/types';
import { LANE_WIDTH } from './config';
import { characterInfo, cycleCharacter, isUnlocked, newlyUnlocked, type CharacterId } from './sim/characters';

/**
 * 遊戲主流程：標題（背景是自動駕駛的展示跑）→ 開場 → 奔跑 → 倒下 → 結算（兵糧丸復活）。
 * 網址參數：seed（固定種子）、auto=1（自動駕駛代玩）、z（起跑距離）、mute=1（靜音）、intro=0（跳過開場鏡頭）、
 * dtcap（每幀最多推進秒數，e2e 用）、gen=0（不自動生成障礙，e2e 用除錯鉤子自己擺）、
 * chars=all（預覽：全部角色都能選，不寫進存檔）。
 */

/** 遊戲流程階段 */
type Mode = 'title' | 'intro' | 'run' | 'paused' | 'dying' | 'over';

/** 開場鏡頭秒數 */
const INTRO_TIME = 2.0;
/** 倒下動畫到出現結算的秒數 */
const DYING_TIME = 1.4;

/** 道具 → 撿到時的音效 */
const POWER_SFX: Record<PowerKind, SfxName> = {
  toad: 'toad',
  chakra: 'powerup',
  magnet: 'magnet',
  clones: 'clone',
  scroll: 'scroll',
  pill: 'powerup',
  shuriken: 'powerup',
  rasengan: 'rasengan',
  kunai: 'powerup',
  sub: 'poof',
};

/** 卷軸獎勵的橫幅文字 */
function rewardText(r: ScrollReward): string {
  switch (r.kind) {
    case 'ryo':
      return `秘傳卷軸：兩 +${r.amount}`;
    case 'board':
      return '秘傳卷軸：通靈卷軸 +1';
    case 'pill':
      return '秘傳卷軸：兵糧丸 +1';
    default:
      return `大獎！兩 +${r.amount}、兵糧丸 +1`;
  }
}

class Game {
  private readonly stage: Stage;
  private readonly world: WorldView;
  private readonly actors: Actors;
  private readonly fx: Fx;
  private readonly cam: CameraRig;
  private readonly audio = new AudioEngine();
  private readonly ui: Ui;
  private readonly input: Input;
  private save: SaveData = loadSave();
  private mode: Mode = 'title';
  private pausedFrom: Mode | null = null;
  private run!: RunState;
  /** 標題畫面背景的展示跑（自動駕駛，立即反應） */
  private readonly demoBot = new Autopilot({ reaction: 0 });
  /** auto=1 時代玩的自動駕駛 */
  private readonly playBot: Autopilot | null;
  private time = 0;
  private modeTime = 0;
  private last = performance.now();
  /** 這一局已經結算過（避免重複寫存檔） */
  private settled = false;
  private readonly seedParam: number | null;
  private readonly startZ: number;
  /** 每幀最多推進的秒數（預設 0.05，避免切分頁回來時暴衝；e2e 的軟體渲染很慢，可用 ?dtcap= 放寬） */
  private readonly dtCap: number;
  /** 標題畫面正在看的角色（可能還沒解鎖；解鎖的才會寫進存檔） */
  private preview: CharacterId;
  /** 網址 chars=all：全部角色都能選（預覽用，不寫進存檔） */
  private readonly unlockAll: boolean;
  /** 這局上一幀跑的距離（判斷有沒有跨過解鎖距離） */
  private lastDist = 0;

  constructor(
    private readonly params: URLSearchParams,
    ui: Ui,
  ) {
    this.ui = ui;
    const app = document.getElementById('app')!;
    this.stage = createStage(app);
    this.world = new WorldView(this.stage, biomeAt(Number(params.get('z') ?? 0)));
    this.fx = new Fx(this.stage.world);
    this.unlockAll = params.get('chars') === 'all';
    this.preview = this.savedCharacter();
    this.actors = new Actors(this.stage, this.fx, this.preview);
    this.cam = new CameraRig(this.stage.camera);
    this.input = new Input(
      this.stage.renderer.domElement,
      () => this.togglePause(),
      () => this.unlockAudio(),
    );
    this.seedParam = params.has('seed') ? Number(params.get('seed')) : null;
    this.startZ = Number(params.get('z') ?? 0);
    this.dtCap = Math.min(0.5, Math.max(0.02, Number(params.get('dtcap') ?? 0.05)));
    this.playBot = params.get('auto') === '1' ? new Autopilot({ reaction: 0 }) : null;
    if (params.get('mute') === '1') this.save = { ...this.save, muted: true };
    this.audio.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.mode === 'run' || this.mode === 'intro')) this.togglePause();
    });
    this.exposeDebug();
    this.toTitle();
    requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * 載入其他場景（起跑的場景在建構時已經建好）。載入畫面期間呼叫，避免遊玩中途卡頓。
   * @param onProgress 進度回呼
   */
  preload(onProgress: (done: number, total: number) => void): Promise<void> {
    const others = (['village', 'forest', 'valley'] as const).filter((b) => b !== biomeAt(this.startZ));
    return this.world.preload([...others], onProgress).then(() => {
      // 全部場景與角色預先編譯 shader，開局與換場景時才不會卡頓
      this.actors.warmup(this.stage.renderer, this.stage.camera);
      this.world.warmup(this.stage.renderer, this.stage.camera);
    });
  }

  /** 介面按鈕的回呼 */
  static handlers(get: () => Game | null): ConstructorParameters<typeof Ui>[1] {
    return {
      onStart: () => get()?.start(),
      onResume: () => get()?.togglePause(),
      onPause: () => get()?.togglePause(),
      onHome: () => get()?.goHome(),
      onRevive: () => get()?.tryRevive(),
      onSkipRevive: () => get()?.settle(),
      onRetry: () => get()?.start(),
      onToggleMute: () => get()?.toggleMute(),
      onBoard: () => get()?.input.push('board'),
      onKunai: () => get()?.input.push('kunai'),
      onPrevChar: () => get()?.cycleChar(-1),
      onNextChar: () => get()?.cycleChar(1),
    };
  }

  /** 這個角色能不能用（已解鎖，或網址 chars=all 的預覽模式） */
  private available(id: CharacterId): boolean {
    return this.unlockAll || isUnlocked(id, this.save.bestDist);
  }

  /** 存檔裡選的角色；還沒解鎖（例如存檔被改過）就退回鳴人 */
  private savedCharacter(): CharacterId {
    return isUnlocked(this.save.character, this.save.bestDist) ? this.save.character : 'naruto';
  }

  /**
   * 標題畫面切換角色：背景跑的角色、道具徽章、HUD 字樣跟著換；已解鎖的才寫進存檔。
   * @param dir +1 下一個、−1 上一個
   */
  cycleChar(dir: 1 | -1): void {
    if (this.mode !== 'title') return;
    this.unlockAudio();
    this.preview = cycleCharacter(this.preview, dir);
    this.applyCharacter(this.preview);
    // 真的解鎖了才寫進存檔（chars=all 的預覽不寫，避免存成還沒解鎖的角色）
    if (isUnlocked(this.preview, this.save.bestDist) && this.save.character !== this.preview) {
      this.save = { ...this.save, character: this.preview };
      writeSave(this.save);
    }
    this.audio.playSfx('click');
  }

  /** 把角色套用到畫面（模型、坐騎、忍術、道具徽章）與介面（HUD、標題選角） */
  private applyCharacter(id: CharacterId): void {
    const info = characterInfo(id);
    this.actors.setCharacter(id);
    this.world.pickups.setJutsu(info.jutsu);
    this.ui.setCharacter(info);
    const lock = this.available(id) ? null : `單局跑到 ${info.unlockDist.toLocaleString('zh-TW')} m 解鎖`;
    this.ui.setTitleCharacter(info.name, lock);
  }

  /** 這局第一次跑過解鎖距離：橫幅提示（真正寫進存檔是在結算時） */
  private checkUnlocks(): void {
    const dist = this.run.player.z - this.startZ;
    for (const id of newlyUnlocked(this.lastDist, dist)) {
      if (this.available(id)) continue;
      this.ui.flash(`解鎖新角色：${characterInfo(id).name}！`, 'biome', 2.6);
      this.audio.playSfx('scroll');
    }
    this.lastDist = dist;
  }

  /** 第一次使用者操作時解鎖音效，並播放目前階段的音樂 */
  private unlockAudio(): void {
    if (this.audio.unlocked) return;
    this.audio.unlock();
    this.applyMusic();
  }

  /** 依目前階段設定音樂 */
  private applyMusic(): void {
    const track: MusicTrack = this.mode === 'title' ? 'title' : this.run.biome;
    this.audio.setMusic(track);
  }

  /** 開一局（demo = 標題背景的展示跑） */
  private newRun(demo: boolean): void {
    const seed = this.seedParam ?? Math.floor(Math.random() * 1e9);
    this.run = createRun({
      seed,
      // gen=0：正式的一局不生成障礙（標題背景的展示跑照常生成）
      generate: demo || this.params.get('gen') !== '0',
      boards: demo ? 0 : this.save.boards,
      pills: demo ? 0 : this.save.pills,
      introSeconds: demo ? 0 : 3,
      startZ: this.startZ,
    });
    this.world.reset();
    this.actors.reset();
    this.fx.clear();
    this.cam.snap({ x: 0, y: 0, speed: speedAt(this.startZ), flying: false });
    this.settled = false;
    this.lastDist = 0;
  }

  /** 回到標題畫面 */
  private toTitle(): void {
    this.mode = 'title';
    this.modeTime = 0;
    this.newRun(true);
    this.input.enabled = false;
    this.input.clear();
    this.cam.setTitle(true);
    this.ui.showTitle(this.save);
    // 回標題時顯示存檔裡選的角色（剛才可能在看還沒解鎖的角色；chars=all 時維持剛才玩的角色）
    if (!this.unlockAll || !this.available(this.preview)) this.preview = this.savedCharacter();
    this.applyCharacter(this.preview);
    if (this.audio.unlocked) this.audio.setMusic('title');
  }

  /** 開始逃跑（選的是還沒解鎖的角色就不開始；按鈕也是停用的） */
  start(): void {
    if (!this.available(this.preview)) return;
    this.unlockAudio();
    this.newRun(false);
    this.mode = 'intro';
    this.modeTime = 0;
    this.cam.setTitle(false);
    // intro=0：跳過開場鏡頭（e2e 截圖用）
    this.cam.startIntro(this.params.get('intro') === '0' ? 0 : INTRO_TIME);
    this.ui.showHud();
    this.input.enabled = true;
    this.input.clear();
    this.ui.flash(this.run.chaser.identity === 'anbu' ? '「站住！」' : '伊魯卡老師：「給我站住──！」', 'warn', 2.2);
    this.applyMusic();
    this.audio.setPaused(false);
  }

  /** 暫停／繼續 */
  togglePause(): void {
    if (this.mode === 'run' || this.mode === 'intro') {
      this.pausedFrom = this.mode;
      this.mode = 'paused';
      this.input.enabled = false;
      this.ui.showPause(true);
      this.audio.setPaused(true);
    } else if (this.mode === 'paused' && this.pausedFrom) {
      this.mode = this.pausedFrom;
      this.pausedFrom = null;
      this.input.enabled = true;
      this.input.clear();
      this.ui.showPause(false);
      this.audio.setPaused(false);
    }
  }

  /** 回標題（跑到一半離開也要結算撿到的兩） */
  goHome(): void {
    if (this.mode !== 'title' && !this.settled) this.applyResult();
    this.pausedFrom = null;
    this.audio.setPaused(false);
    this.toTitle();
  }

  /** 切換靜音並存檔 */
  toggleMute(): void {
    this.unlockAudio();
    this.save = { ...this.save, muted: !this.save.muted };
    writeSave(this.save);
    this.audio.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
  }

  /** 吃兵糧丸復活 */
  tryRevive(): void {
    if (this.mode !== 'over' || !revive(this.run)) return;
    this.mode = 'run';
    this.modeTime = 0;
    this.ui.showHud();
    this.input.enabled = true;
    this.input.clear();
    const p = this.run.player;
    this.fx.puff(p.x, p.y + 0.8, p.z, 2.2, 10);
    this.audio.playSfx('revive');
    this.ui.flash('兵糧丸！復活！', 'power');
    this.applyMusic();
  }

  /** 把這一局的結果寫進存檔 */
  private applyResult(): void {
    this.save = applyRunResult(this.save, {
      score: this.run.score,
      coins: this.run.coins,
      boards: this.run.boards,
      pills: this.run.pills,
      distance: Math.max(0, this.run.player.z - this.startZ),
    });
    writeSave(this.save);
    this.settled = true;
  }

  /** 結算（不復活或倒數結束） */
  settle(): void {
    if (this.mode !== 'over' || this.settled) return;
    const prevBest = this.save.best;
    this.applyResult();
    this.ui.showResult(this.run.score, this.run.coins, this.save.best, Math.floor(this.run.score) > prevBest);
  }

  /** 倒下動畫結束：顯示結算（有兵糧丸就先問要不要復活） */
  private enterOver(): void {
    this.mode = 'over';
    this.modeTime = 0;
    this.input.enabled = false;
    const cost = reviveCost(this.run.revives);
    const canRevive = this.run.pills >= cost;
    const caught = this.run.deathCause === 'caught';
    const iruka = this.run.chaser.identity === 'iruka';
    const headline = caught ? '被抓到了！' : '撞到了！';
    const quote = iruka ? '伊魯卡老師：「又在岩壁上亂畫！給我回去擦乾淨！」' : '暗部：「目標確保。乖乖跟我們回去。」';
    this.ui.showGameOver(headline, quote, canRevive ? cost : null, this.run.pills);
    if (!canRevive) this.settle();
  }

  /** 處理模擬事件：音效、橫幅、特效 */
  private handleEvents(events: readonly SimEvent[]): void {
    this.actors.onEvents(events, this.run);
    if (this.mode === 'title') return;
    const sfx = (name: SfxName, volume = 1, pitch = 1) => this.audio.playSfx(name, { volume, pitch });
    for (const e of events) {
      switch (e.type) {
        case 'coin':
          sfx('coin', 0.55, 1 + Math.min(e.combo, 14) * 0.035);
          break;
        case 'jump':
          sfx(e.super ? 'superJump' : 'jump', 0.8);
          break;
        case 'roll':
          sfx('roll', 0.8);
          break;
        case 'lane':
          sfx('lane', 0.5);
          break;
        case 'land':
          sfx('land', 0.4);
          break;
        case 'stumble':
          sfx('stumble');
          this.cam.shake(0.25);
          if (this.run.status === 'running') {
            this.ui.flash(this.run.chaser.identity === 'anbu' ? '暗部逼近了！' : '伊魯卡老師追上來了！', 'warn');
          }
          break;
        case 'crash':
        case 'caught':
          sfx('crash');
          this.cam.shake(0.6);
          break;
        case 'powerup': {
          // 螺旋丸道具依角色換成招牌忍術（千鳥、怪力、雷切）的名稱與音效
          const info = characterInfo(this.actors.character);
          sfx(e.kind === 'rasengan' ? info.jutsu.sfx : POWER_SFX[e.kind]);
          if (e.kind !== 'scroll') this.ui.flash(`${powerInfo(e.kind, info.jutsu).name}！`, 'power');
          break;
        }
        case 'boardOn':
          sfx('board');
          this.ui.flash(`通靈術・${characterInfo(this.actors.character).mount.name}！`, 'power');
          break;
        case 'boardBreak':
          sfx('poof');
          this.cam.shake(0.3);
          this.ui.flash(`${characterInfo(this.actors.character).mount.name}擋下了！`, 'power');
          break;
        case 'throw':
          sfx('throw', e.kind === 'kunai' ? 0.9 : 0.7, e.kind === 'kunai' ? 0.8 : 1);
          break;
        case 'break':
          // 起爆符一次炸掉好幾個障礙：碎裂聲交給爆炸聲，不重複播
          if (e.cause === 'kunai') break;
          sfx('break', e.kind === 'train' ? 1 : 0.8, e.kind === 'train' ? 0.7 : 1);
          this.cam.shake(e.kind === 'train' ? 0.35 : 0.15);
          break;
        case 'clink':
          sfx('clink', 0.7);
          break;
        case 'explode':
          sfx('explode');
          this.cam.shake(0.5);
          break;
        case 'cloneBlock':
          sfx('poof');
          this.ui.flash(e.left > 0 ? `影分身擋下了！（剩 ${e.left} 個）` : '影分身擋下了！（分身用完了）', 'power', 1.4);
          break;
        case 'climb':
          sfx('climb');
          break;
        case 'flicker':
          sfx('flicker');
          this.ui.flash('瞬身術！', 'power', 0.8);
          break;
        case 'substitution':
          sfx('substitution');
          this.cam.shake(0.3);
          this.ui.flash(e.cause === 'caught' ? '替身術！抓到的是木頭！' : '替身術！', 'power');
          break;
        case 'scroll':
          this.ui.flash(rewardText(e.reward), 'power', 2.4);
          break;
        case 'biome':
          sfx('biome');
          this.ui.flash(this.world.kit(e.id).name, 'biome', 2.4);
          this.audio.setMusic(e.id);
          break;
        case 'chaser':
          if (e.identity === 'anbu') {
            sfx('anbu');
            this.ui.flash('暗部出動！', 'warn', 2.4);
          }
          break;
        case 'trainStart':
          sfx('trainHorn', 0.6);
          break;
        default:
          break;
      }
    }
  }

  /** 每幀 */
  private loop(now: number): void {
    const dt = Math.min(this.dtCap, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.modeTime += dt;
    const simulate = this.mode === 'title' || this.mode === 'intro' || this.mode === 'run';
    if (simulate) {
      let actions: Action[];
      if (this.mode === 'title') actions = this.demoBot.decide(this.run, dt);
      // 代玩時也收鍵盤（例如 e2e 按 Space 啟動卷軸滑板）
      else if (this.playBot) actions = [...this.playBot.decide(this.run, dt), ...this.input.drain()];
      else actions = this.input.drain();
      const events = step(this.run, actions, dt);
      this.handleEvents(events);
      if (this.mode === 'run' || this.mode === 'intro') this.checkUnlocks();
      if (this.mode === 'title' && this.run.status === 'dead') this.newRun(true);
      else if (this.mode !== 'title' && this.run.status === 'dead') {
        this.mode = 'dying';
        this.modeTime = 0;
        this.input.enabled = false;
        this.audio.playSfx('gameOver', { volume: 0.8 });
      } else if (this.mode === 'intro' && this.modeTime >= INTRO_TIME) {
        this.mode = 'run';
      }
      this.audio.setIntensity(Math.min(1, (this.run.speed - 12) / 16));
    } else if (this.mode === 'dying' && this.modeTime >= DYING_TIME) {
      this.enterOver();
    }
    const actorMode: ActorMode =
      this.mode === 'paused' ? (this.pausedFrom === 'intro' ? 'intro' : 'run') : this.mode === 'title' ? 'title' : this.mode;
    const frameDt = this.mode === 'paused' ? 0 : dt;
    this.world.sync(this.run, this.time, frameDt);
    this.actors.sync(this.run, frameDt, actorMode);
    this.fx.update(frameDt);
    const p = this.run.player;
    this.cam.update(frameDt, { x: p.x, y: p.y, speed: this.run.speed, flying: p.flying });
    this.stage.render();
    if (this.mode === 'run' || this.mode === 'intro') this.ui.updateHud(this.run);
    if (this.ui.tick(dt)) this.settle();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** 除錯鉤子（e2e 與截圖用） */
  private exposeDebug(): void {
    const g = this;
    (window as unknown as { __game: unknown }).__game = {
      get mode() {
        return g.mode;
      },
      get run() {
        return g.run;
      },
      get save() {
        return g.save;
      },
      /** 目前畫面上的角色、標題畫面正在看的角色 */
      get character() {
        return g.actors.character;
      },
      get preview() {
        return g.preview;
      },
      start: () => g.start(),
      /** 在玩家前方 dz 公尺放一個道具（車道取主角目前 x 最近的那條、高度跟著主角，換線或跳躍中也撿得到） */
      grant: (kind: PowerKind, dz = 6) => {
        const p = g.run.player;
        const lane = Math.max(-1, Math.min(1, Math.round(p.x / LANE_WIDTH))) as Lane;
        return addPickup(g.run, kind, lane, p.z + dz, p.y + 1.0);
      },
      /** 在玩家目前車道前方 dz 公尺擺一個障礙（e2e 測新招式用），回傳障礙編號 */
      place: (kind: ObstacleKind, dz = 15, length?: number) => {
        const p = g.run.player;
        const lane = Math.max(-1, Math.min(1, Math.round(p.x / LANE_WIDTH))) as Lane;
        return addObstacle(g.run, { kind, lane, z: p.z + dz, length }).id;
      },
      /** 在玩家前方放一個擋牆（測試倒下流程） */
      crash: () => addObstacle(g.run, { kind: 'block', lane: g.run.player.lane, z: g.run.player.z + 3 }),
      revive: () => g.tryRevive(),
      settle: () => g.settle(),
      home: () => g.goHome(),
      pause: () => g.togglePause(),
      stats: () => ({ drawCalls: g.stage.renderer.info.render.calls, triangles: g.stage.renderer.info.render.triangles }),
      audioLevel: () => g.audio.getLevel(),
      get params() {
        return g.params.toString();
      },
    };
  }
}

/** 遊戲進入點：先顯示載入畫面，下一幀再建立場景（建場景較久，讓載入畫面先畫出來） */
export function startGame(params: URLSearchParams): void {
  let game: Game | null = null;
  const ui = new Ui(document.body, Game.handlers(() => game));
  requestAnimationFrame(() =>
    setTimeout(async () => {
      const g = new Game(params, ui);
      game = g;
      // 其他兩個場景也在載入畫面期間建好（每個之間讓出主執行緒，載入動畫會動）
      await g.preload((done, total) => ui.setLoadingText(`場景準備中…… ${done}／${total}`));
      ui.ready();
      (window as unknown as { __gameReady: boolean }).__gameReady = true;
    }, 30),
  );
}
