import * as THREE from 'three';
import { PHYS, LANE_WIDTH } from '../config';
import { buildCharacter } from './character/roster';
import { buildMount, type MountRig } from './character/mounts';
import { buildJutsu, type JutsuView } from './jutsu';
import { characterInfo, type CharacterId } from '../sim/characters';
import { buildIruka, buildAnbu } from './character/chasers';
import { buildDog, animateDog, buildToad, animateToad, TOAD_SEAT, type DogRig, type ToadRig } from './character/creatures';
import { buildLog } from './character/props';
import { CharacterAnimator, type AnimState } from './character/anim';
import { glowTexture } from './textures';
import { TOAD_HOP_PERIOD } from '../sim/powerups';
import type { HumanoidRig } from './character/rig';
import type { Fx } from './fx';
import type { Stage } from './stage';
import type { RunState } from '../sim/run';
import type { BiomeId, ObstacleKind, SimEvent } from '../sim/types';

/**
 * 角色畫面：主角（動作依模擬狀態切換）、影分身、巨蛤蟆、通靈獸坐騎、追捕者與忍犬、查克拉光與萬象天引光環、
 * 招牌忍術（螺旋丸／千鳥／怪力／雷切，在右手上）與各招式的特效（障礙碎裂、起爆符爆炸、替身木頭、瞬身術殘影）。
 * 可切換角色（鳴人、佐助、小櫻、卡卡西）：模型、影分身、坐騎、忍術特效依角色快取，第一次選到時才建立。
 * 主角在畫面原點附近（世界往玩家移動），x、y 直接用模擬座標。
 */

/** 擲出動作（右手往前甩）維持的秒數 */
const THROW_POSE_TIME = 0.22;

/** 碎片從障礙的哪個高度噴出（大約是障礙中心） */
const BREAK_Y: Record<ObstacleKind, number> = { hurdle: 0.5, highBar: 1.85, block: 1.3, train: 1.6, ramp: 1.4 };

/** 障礙碎片的顏色：依場景與種類，大致對應各場景的障礙外觀 */
function debrisColors(biome: BiomeId, kind: ObstacleKind): number[] {
  if (biome === 'valley') return [0x8a867c, 0x6f6a60, 0xa8a090, 0x5f7a4a];
  if (biome === 'forest') return [0x6b4a2b, 0x8a6a42, 0x4f7a2e, 0xd2a46c];
  if (kind === 'hurdle') return [0xc8352a, 0xf2efe6, 0x8b5a2b];
  if (kind === 'highBar') return [0x23345e, 0xb8282a, 0xe8dcc0, 0x8b5a2b];
  if (kind === 'train') return [0x2e5c9a, 0x3f7a3a, 0xd8c8a0, 0x5a3a22];
  return [0xa0703a, 0x7a5230, 0xe6d6a8];
}

/** 人形角色＋動畫器 */
interface Actor {
  rig: HumanoidRig;
  anim: CharacterAnimator;
}

/** 遊戲流程的畫面階段（影響追捕者與主角的動作） */
export type ActorMode = 'title' | 'intro' | 'run' | 'dying' | 'over';

export class Actors {
  /** 目前的角色 */
  private charId: CharacterId;
  /** 目前的主角模型＋動畫器 */
  private ninjaActor!: Actor;
  /** 各角色的主角模型、影分身、坐騎、忍術特效（第一次選到時建立） */
  private readonly casts = new Map<CharacterId, Actor>();
  private readonly cloneCasts = new Map<CharacterId, Actor[]>();
  private readonly mounts = new Map<CharacterId, MountRig>();
  private readonly jutsus = new Map<CharacterId, JutsuView>();
  /** 目前的通靈獸坐騎與忍術特效 */
  private mount!: MountRig;
  private jutsu!: JutsuView;
  /** 忍術主色（撞碎障礙的閃光） */
  private jutsuColor = 0x6fd0ff;
  /** 切換角色時預先編譯 shader 用（warmup 時記下） */
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;
  private iruka: Actor | null = null;
  private anbu: Actor | null = null;
  private dog: DogRig | null = null;
  private dogPhase = 0;
  private toad: ToadRig | null = null;
  private readonly chakraGlow: THREE.Sprite;
  private readonly magnetRings: THREE.Mesh[] = [];
  /** 留在原地的替身木頭（世界座標） */
  private logs: THREE.Group[] = [];
  /** 追捕者在畫面上的 x（跟著玩家慢慢移動） */
  private chaserX = 0;
  /** 死亡後追捕者衝上來的距離 */
  private catchGap: number | null = null;
  private lastX = 0;
  private time = 0;
  /** 上一幀每個影分身是否顯示（出現／消失時冒煙；擋下撞擊會一個一個消失） */
  private readonly cloneShown = [false, false];
  private toadOn = false;
  /** 擲出動作剩餘秒數 */
  private throwT = 0;
  private readonly tmp = new THREE.Vector3();

  /**
   * @param initial 一開始的角色
   */
  constructor(
    private readonly stage: Stage,
    private readonly fx: Fx,
    initial: CharacterId = 'naruto',
  ) {
    this.charId = initial;
    this.useCharacter(initial);
    const glowTex = glowTexture();
    this.chakraGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0x4fb4ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.chakraGlow.visible = false;
    stage.scene.add(this.chakraGlow);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.035, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      stage.scene.add(ring);
      this.magnetRings.push(ring);
    }
  }

  /** 目前的主角模型＋動畫器 */
  get ninja(): Actor {
    return this.ninjaActor;
  }

  /** 目前的角色編號 */
  get character(): CharacterId {
    return this.charId;
  }

  /**
   * 換角色：藏起舊的主角、影分身、坐騎、忍術特效，換成新角色的（第一次選到時建立並預先編譯 shader）。
   */
  setCharacter(id: CharacterId): void {
    if (id === this.charId) return;
    this.ninjaActor.rig.root.visible = false;
    this.mount.root.visible = false;
    this.jutsu.group.visible = false;
    if (this.jutsu.feet) this.jutsu.feet.visible = false;
    for (const c of this.cloneCasts.get(this.charId) ?? []) c.rig.root.visible = false;
    this.cloneShown[0] = false;
    this.cloneShown[1] = false;
    this.charId = id;
    const fresh = !this.casts.has(id);
    this.useCharacter(id);
    if (fresh && this.renderer && this.camera) this.compileHidden([this.ninjaActor.rig.root, this.mount.root, this.jutsu.group]);
  }

  /** 取得（必要時建立）角色的主角模型、坐騎、忍術特效，設為目前使用的 */
  private useCharacter(id: CharacterId): void {
    let cast = this.casts.get(id);
    if (!cast) {
      const rig = buildCharacter(id);
      this.stage.scene.add(rig.root);
      cast = { rig, anim: new CharacterAnimator(rig, 'naruto') };
      this.casts.set(id, cast);
    }
    cast.rig.root.visible = true;
    this.ninjaActor = cast;
    let mount = this.mounts.get(id);
    if (!mount) {
      mount = buildMount(id);
      mount.root.visible = false;
      this.stage.scene.add(mount.root);
      this.mounts.set(id, mount);
    }
    this.mount = mount;
    let jutsu = this.jutsus.get(id);
    if (!jutsu) {
      jutsu = buildJutsu(characterInfo(id).jutsu);
      this.stage.scene.add(jutsu.group);
      if (jutsu.feet) this.stage.scene.add(jutsu.feet);
      this.jutsus.set(id, jutsu);
    }
    this.jutsu = jutsu;
    this.jutsuColor = new THREE.Color(characterInfo(id).jutsu.color).getHex();
  }

  /** 暫時顯示幾個物件並編譯 shader（避免第一次出現時卡頓），之後恢復原本的顯示狀態 */
  private compileHidden(objs: THREE.Object3D[]): void {
    if (!this.renderer || !this.camera) return;
    const prev = objs.map((o) => o.visible);
    for (const o of objs) o.visible = true;
    this.renderer.compile(this.stage.scene, this.camera);
    objs.forEach((o, i) => (o.visible = prev[i]));
  }

  /**
   * 預熱：先建好之後才會出現的角色（追捕者、忍犬、巨蛤蟆、影分身、卷軸滑板、光環），並預先編譯它們的 shader。
   * 在載入畫面期間呼叫；不然開局（追捕者第一次出現）與第一次撿到道具時會卡頓。
   */
  warmup(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.renderer = renderer;
    this.camera = camera;
    const extra: THREE.Object3D[] = [
      this.getChaser('iruka').rig.root,
      this.getChaser('anbu').rig.root,
      this.getDog().root,
      this.getToad().root,
      ...this.getClones().map((c) => c.rig.root),
      this.mount.root,
      this.chakraGlow,
      ...this.magnetRings,
      this.jutsu.group,
      ...(this.jutsu.feet ? [this.jutsu.feet] : []),
    ];
    const prev = extra.map((o) => o.visible);
    for (const o of extra) o.visible = true;
    // 特效（碎片、閃光、煙）也先編譯，第一次打碎障礙時才不會卡
    const fxObjs = this.fx.warmupObjects();
    for (const o of fxObjs) {
      o.position.set(0, 1, -3);
      this.stage.scene.add(o);
    }
    renderer.compile(this.stage.scene, camera);
    for (const o of fxObjs) o.removeFromParent();
    extra.forEach((o, i) => (o.visible = prev[i]));
  }

  /** 新的一局：清掉替身木頭、重置追捕者 */
  reset(): void {
    for (const l of this.logs) l.removeFromParent();
    this.logs = [];
    this.catchGap = null;
    this.chaserX = 0;
    this.throwT = 0;
  }

  /** 取得（第一次建立）目前角色的兩個影分身 */
  private getClones(): Actor[] {
    let clones = this.cloneCasts.get(this.charId);
    if (!clones) {
      clones = [0, 1].map(() => {
        const rig = buildCharacter(this.charId);
        rig.root.visible = false;
        this.stage.scene.add(rig.root);
        const anim = new CharacterAnimator(rig, 'naruto');
        return { rig, anim };
      });
      clones[1].anim.phase = 0.5;
      this.cloneCasts.set(this.charId, clones);
    }
    return clones;
  }

  /** 取得（第一次建立）追捕者 */
  private getChaser(identity: 'iruka' | 'anbu'): Actor {
    if (identity === 'iruka') {
      if (!this.iruka) {
        const rig = buildIruka();
        this.stage.scene.add(rig.root);
        this.iruka = { rig, anim: new CharacterAnimator(rig, 'sprint') };
      }
      return this.iruka;
    }
    if (!this.anbu) {
      const rig = buildAnbu();
      this.stage.scene.add(rig.root);
      this.anbu = { rig, anim: new CharacterAnimator(rig, 'naruto') };
    }
    return this.anbu;
  }

  /** 取得（第一次建立）忍犬 */
  private getDog(): DogRig {
    if (!this.dog) {
      this.dog = buildDog();
      this.stage.scene.add(this.dog.root);
    }
    return this.dog;
  }

  /** 取得（第一次建立）巨蛤蟆 */
  private getToad(): ToadRig {
    if (!this.toad) {
      this.toad = buildToad();
      this.stage.scene.add(this.toad.root);
    }
    return this.toad;
  }

  /** 依模擬狀態決定主角的動作 */
  private stateOf(run: RunState, mode: ActorMode): { state: AnimState; spin: number } {
    const p = run.player;
    if (mode === 'title') return { state: 'run', spin: 0 };
    if (run.status === 'dead') return { state: run.deathCause === 'caught' ? 'stumble' : 'fall', spin: 0 };
    if (run.climb) return { state: 'climb', spin: 0 };
    if (p.flying) return { state: 'ride', spin: 0 };
    if (p.rolling > 0) return { state: 'roll', spin: 1 - p.rolling / PHYS.rollTime };
    if (!p.grounded) {
      if (run.power.chakra > 0 && p.jumped) return { state: 'superJump', spin: Math.min(1, p.airTime / 1.0) };
      return { state: 'jump', spin: 0 };
    }
    if (p.stumble > 0) return { state: 'stumble', spin: 0 };
    if (run.power.rasengan > 0) return { state: 'rasengan', spin: 0 };
    // 通靈獸坐騎：蹲坐（小蛤蟆、忍犬）或側身站（大蛇、蛞蝓）
    if (run.power.board > 0) return { state: this.mount.pose, spin: 0 };
    return { state: 'run', spin: 0 };
  }

  /** 處理模擬事件（冒煙、替身木頭、碎裂、爆炸、殘影） */
  onEvents(events: readonly SimEvent[], run: RunState): void {
    const p = run.player;
    for (const e of events) {
      switch (e.type) {
        case 'boardBreak':
          // 通靈獸擋下撞擊：「砰」一聲消失
          this.fx.puff(p.x, p.y + 0.4, p.z + 0.3, 1.3, 7);
          break;
        case 'substitution': {
          // 替身術：原地留下一根木頭＋煙霧（被抓時追捕者抓到的是這根木頭）
          const log = buildLog();
          log.position.set(p.x, p.y, -p.z);
          log.rotation.z = 0.25;
          this.stage.world.add(log);
          this.logs.push(log);
          if (this.logs.length > 3) this.logs.shift()!.removeFromParent();
          // 煙留在原地，鏡頭會從中穿過：小一點、低一點，不要整個畫面都是煙
          this.fx.puff(p.x, p.y + 0.4, p.z, 1.15, 6);
          break;
        }
        case 'powerup':
          this.fx.puff(p.x, p.y + 0.8, p.z + 1, e.kind === 'toad' ? 3.2 : 1.2, e.kind === 'toad' ? 12 : 5);
          break;
        case 'coin':
          this.fx.sparkle(p.x, p.y + 1, p.z + 0.6);
          break;
        case 'throw':
          this.throwT = THROW_POSE_TIME;
          break;
        case 'break': {
          // 障礙碎裂：長的障礙（列車）沿著長度每 6 m 噴一團
          const colors = debrisColors(e.biome, e.kind);
          const x = e.lane * LANE_WIDTH;
          const bursts = Math.min(5, Math.max(1, Math.ceil(e.length / 6)));
          for (let i = 0; i < bursts; i++) {
            const z = e.z + Math.min(e.length, 0.3 + i * 6);
            this.fx.debris(x, BREAK_Y[e.kind], z, colors, i === 0 ? 16 : 9, 1.3, 0.24);
            this.fx.puff(x, BREAK_Y[e.kind] * 0.5, z, 0.9, i === 0 ? 3 : 2, 0xd8d0c0);
          }
          if (e.cause === 'rasengan') this.fx.flash(x, BREAK_Y[e.kind], e.z, this.jutsuColor, 4, 0.3);
          break;
        }
        case 'clink':
          // 手裏劍被列車彈開：火花
          this.fx.sparks(e.lane * LANE_WIDTH, 1.4, e.z, 0xfff1b0, 9);
          this.fx.flash(e.lane * LANE_WIDTH, 1.4, e.z, 0xfff1b0, 1.2, 0.15);
          break;
        case 'explode':
          this.fx.explosion(e.lane * LANE_WIDTH, 1.0, e.z);
          break;
        case 'cloneBlock':
          // 分身衝到前面擋下撞擊（分身本身的消失煙霧在 sync 裡處理）
          this.fx.puff(p.x, p.y + 0.6, p.z + 1.2, 0.9, 4);
          break;
        case 'flicker': {
          // 瞬身術：原地一團小煙＋橫向拉長的殘影光
          const dist = Math.abs(e.toX - e.fromX);
          this.fx.puff(e.fromX, p.y + 0.7, p.z, 1.1, 5);
          this.fx.flash((e.fromX + e.toX) / 2, p.y + 0.9, p.z, 0x9fd8ff, 1.3, 0.25, Math.max(1, dist / 1.1));
          this.fx.puff(e.toX, p.y + 0.5, p.z + 0.4, 0.8, 3);
          break;
        }
        case 'climb':
          // 查克拉攀牆：腳下一團藍白光
          this.fx.flash(p.x, p.y + 0.2, p.z + 0.2, 0x4fb4ff, 2.2, 0.3);
          break;
        default:
          break;
      }
    }
  }

  /**
   * 每幀同步。
   * @param mode 遊戲流程階段
   */
  sync(run: RunState, dt: number, mode: ActorMode): void {
    this.time += dt;
    const p = run.player;
    const vx = dt > 0 ? (p.x - this.lastX) / dt : 0;
    this.lastX = p.x;
    const { state, spin } = this.stateOf(run, mode);
    const speed = mode === 'dying' || mode === 'over' ? 0 : run.speed;
    const ninja = this.ninja;
    // 通靈獸坐騎：坐騎在腳下，主角放在坐騎的座位上
    const mountOn = run.power.board > 0 && !p.flying && run.status === 'running' && mode !== 'title';
    this.mount.root.visible = mountOn;
    if (mountOn) {
      this.mount.update(dt, speed);
      this.mount.root.position.set(p.x, p.y, 0);
      this.mount.root.rotation.set(0, 0, -vx * 0.01);
      const seat = this.mount.seat;
      ninja.rig.root.position.set(p.x + seat.x, p.y + seat.y, seat.z);
    } else {
      ninja.rig.root.position.set(p.x, p.y, 0);
    }
    this.throwT = Math.max(0, this.throwT - dt);
    ninja.anim.update(dt, { state, speed, vy: p.vy, vx, spinProgress: spin, throwing: this.throwT > 0 });

    // 巨蛤蟆
    const toadOn = p.flying;
    if (toadOn !== this.toadOn) {
      this.fx.puff(p.x, p.y - 0.8, p.z, 3, 12);
      this.toadOn = toadOn;
    }
    if (toadOn || this.toad) {
      const toad = this.getToad();
      toad.root.visible = toadOn;
      if (toadOn) {
        toad.root.position.set(p.x - TOAD_SEAT.x, p.y - TOAD_SEAT.y, -TOAD_SEAT.z);
        animateToad(toad, (run.toadTime % TOAD_HOP_PERIOD) / TOAD_HOP_PERIOD);
      }
    }

    // 影分身：在主角兩側稍後方一起跑；每擋下一次撞擊就少一個（剩下的數量 = clonesLeft）
    const clonesOn = run.power.clones > 0 && run.status === 'running';
    if (clonesOn || this.cloneCasts.has(this.charId)) {
      const clones = this.getClones();
      clones.forEach((c, i) => {
        const dx = i === 0 ? -1.05 : 1.05;
        const shown = clonesOn && i < run.clonesLeft;
        if (shown !== this.cloneShown[i]) {
          // 分身在主角後方、比較靠近鏡頭：煙小一點
          this.fx.puff(p.x + dx, p.y + 0.7, p.z - 0.6, 0.95, 4);
          this.cloneShown[i] = shown;
        }
        c.rig.root.visible = shown;
        if (!shown) return;
        c.rig.root.position.set(p.x + dx, p.y, 0.7);
        // 分身不拿忍術、不騎坐騎，也不攀牆：照一般跑
        const cs = state === 'surf' || state === 'rasengan' || state === 'climb' || (mountOn && state === 'ride') ? 'run' : state;
        c.anim.update(dt, { state: cs, speed, vy: p.vy, vx, spinProgress: spin });
      });
    }

    // 招牌忍術（螺旋丸／千鳥／怪力／雷切）：跟著右手
    const jutsuOn = run.power.rasengan > 0 && run.status === 'running';
    this.jutsu.group.visible = jutsuOn;
    if (this.jutsu.feet) this.jutsu.feet.visible = jutsuOn;
    if (jutsuOn) {
      ninja.rig.root.updateMatrixWorld(true);
      ninja.rig.handR.getWorldPosition(this.tmp);
      // 托在手掌上：手腕再往外、往上一點
      this.jutsu.group.position.set(this.tmp.x + 0.1, this.tmp.y + 0.16, this.tmp.z + 0.02);
      this.jutsu.feet?.position.set(p.x, p.y + 0.12, 0);
      this.jutsu.update(this.time);
    }

    // 查克拉附著：腳底藍光
    const chakra = run.power.chakra > 0 && run.status === 'running';
    this.chakraGlow.visible = chakra;
    if (chakra) {
      const pulse = 1 + Math.sin(this.time * 14) * 0.15;
      this.chakraGlow.position.set(p.x, p.y + 0.12, 0);
      this.chakraGlow.scale.set(1.6 * pulse, 0.7 * pulse, 1);
    }

    // 萬象天引：紫色光環往外擴散
    const magnet = run.power.magnet > 0 && run.status === 'running';
    this.magnetRings.forEach((ring, i) => {
      ring.visible = magnet;
      if (!magnet) return;
      const t = (this.time * 0.9 + i * 0.5) % 1;
      const s = 0.5 + t * 2.4;
      ring.scale.set(s, s, s);
      ring.position.set(p.x, p.y + 0.9, 0);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
    });

    this.syncChaser(run, dt, mode);
  }

  /** 追捕者與忍犬：在玩家身後 gap 公尺，死亡時衝上來抓人 */
  private syncChaser(run: RunState, dt: number, mode: ActorMode): void {
    const p = run.player;
    const identity = run.chaser.identity;
    const chaser = this.getChaser(identity);
    const other = identity === 'iruka' ? this.anbu : this.iruka;
    if (other) other.rig.root.visible = false;
    let gap = run.chaser.gap;
    if (mode === 'dying' || mode === 'over') {
      this.catchGap = Math.max(1.1, (this.catchGap ?? gap) - dt * 9);
      gap = this.catchGap;
    } else {
      this.catchGap = null;
    }
    const visible = gap < 24 && mode !== 'title';
    chaser.rig.root.visible = visible;
    const dog = this.getDog();
    dog.root.visible = visible;
    if (!visible) return;
    // 追捕者站在主角右後方一點，不要擋住主角與前方的路
    const targetX = Math.max(-LANE_WIDTH, Math.min(LANE_WIDTH, p.x + 1.1));
    this.chaserX += (targetX - this.chaserX) * (1 - Math.exp(-dt * 4));
    chaser.rig.root.position.set(this.chaserX, 0, gap);
    const grabbing = (mode === 'dying' || mode === 'over') && gap < 1.4;
    chaser.anim.update(dt, { state: grabbing ? 'grab' : 'run', speed: grabbing ? 0 : Math.max(run.speed, 12) });
    dog.root.position.set(this.chaserX - 1.6, 0, gap + 0.5);
    if (!grabbing) this.dogPhase = (this.dogPhase + dt * (2.6 + run.speed * 0.08)) % 1;
    animateDog(dog, this.dogPhase);
  }
}
