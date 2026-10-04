import * as THREE from 'three';
import { PHYS, LANE_WIDTH } from '../config';
import { buildNinja } from './character/ninja';
import { buildIruka, buildAnbu } from './character/chasers';
import { buildDog, animateDog, buildToad, animateToad, TOAD_SEAT, type DogRig, type ToadRig } from './character/creatures';
import { buildScrollBoard, buildLog } from './character/props';
import { CharacterAnimator, type AnimState } from './character/anim';
import { glowTexture } from './textures';
import { TOAD_HOP_PERIOD } from '../sim/powerups';
import type { HumanoidRig } from './character/rig';
import type { Fx } from './fx';
import type { Stage } from './stage';
import type { RunState } from '../sim/run';
import type { SimEvent } from '../sim/types';

/**
 * 角色畫面：主角（動作依模擬狀態切換）、影分身、巨蛤蟆、卷軸滑板、追捕者與忍犬、查克拉光與萬象天引光環。
 * 主角在畫面原點附近（世界往玩家移動），x、y 直接用模擬座標。
 */

/** 人形角色＋動畫器 */
interface Actor {
  rig: HumanoidRig;
  anim: CharacterAnimator;
}

/** 遊戲流程的畫面階段（影響追捕者與主角的動作） */
export type ActorMode = 'title' | 'intro' | 'run' | 'dying' | 'over';

export class Actors {
  readonly ninja: Actor;
  private clones: Actor[] | null = null;
  private iruka: Actor | null = null;
  private anbu: Actor | null = null;
  private dog: DogRig | null = null;
  private dogPhase = 0;
  private toad: ToadRig | null = null;
  private readonly board: THREE.Group;
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
  /** 上一幀的影分身狀態（出現／消失時冒煙） */
  private clonesOn = false;
  private toadOn = false;

  constructor(
    private readonly stage: Stage,
    private readonly fx: Fx,
  ) {
    const rig = buildNinja();
    stage.scene.add(rig.root);
    this.ninja = { rig, anim: new CharacterAnimator(rig, 'naruto') };
    this.board = buildScrollBoard();
    this.board.visible = false;
    stage.scene.add(this.board);
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

  /** 新的一局：清掉替身木頭、重置追捕者 */
  reset(): void {
    for (const l of this.logs) l.removeFromParent();
    this.logs = [];
    this.catchGap = null;
    this.chaserX = 0;
  }

  /** 取得（第一次建立）影分身 */
  private getClones(): Actor[] {
    if (!this.clones) {
      this.clones = [0, 1].map(() => {
        const rig = buildNinja();
        rig.root.visible = false;
        this.stage.scene.add(rig.root);
        const anim = new CharacterAnimator(rig, 'naruto');
        return { rig, anim };
      });
      this.clones[1].anim.phase = 0.5;
    }
    return this.clones;
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
    if (p.flying) return { state: 'ride', spin: 0 };
    if (p.rolling > 0) return { state: 'roll', spin: 1 - p.rolling / PHYS.rollTime };
    if (!p.grounded) {
      if (run.power.chakra > 0 && p.jumped) return { state: 'superJump', spin: Math.min(1, p.airTime / 1.0) };
      return { state: 'jump', spin: 0 };
    }
    if (p.stumble > 0) return { state: 'stumble', spin: 0 };
    if (run.power.board > 0) return { state: 'surf', spin: 0 };
    return { state: 'run', spin: 0 };
  }

  /** 處理模擬事件（冒煙、替身木頭） */
  onEvents(events: readonly SimEvent[], run: RunState): void {
    const p = run.player;
    for (const e of events) {
      if (e.type === 'boardBreak') {
        // 替身術：原地留下一根木頭＋煙霧
        const log = buildLog();
        log.position.set(p.x, p.y, -p.z);
        log.rotation.z = 0.25;
        this.stage.world.add(log);
        this.logs.push(log);
        if (this.logs.length > 3) this.logs.shift()!.removeFromParent();
        this.fx.puff(p.x, p.y + 0.6, p.z, 1.8, 9);
      } else if (e.type === 'powerup') {
        this.fx.puff(p.x, p.y + 0.8, p.z + 1, e.kind === 'toad' ? 3.2 : 1.2, e.kind === 'toad' ? 12 : 5);
      } else if (e.type === 'coin') {
        this.fx.sparkle(p.x, p.y + 1, p.z + 0.6);
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
    ninja.rig.root.position.set(p.x, p.y + (state === 'surf' ? 0.1 : 0), 0);
    ninja.anim.update(dt, { state, speed, vy: p.vy, vx, spinProgress: spin });

    // 卷軸滑板
    const boardOn = run.power.board > 0 && !p.flying && run.status === 'running';
    this.board.visible = boardOn;
    if (boardOn) {
      this.board.position.set(p.x, p.y + 0.06 + Math.sin(this.time * 9) * 0.015, 0);
      this.board.rotation.set(0, 0, -vx * 0.01);
    }

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

    // 影分身：在主角兩側稍後方一起跑
    const clonesOn = run.power.clones > 0 && run.status === 'running';
    if (clonesOn !== this.clonesOn) {
      for (const dx of [-1.05, 1.05]) this.fx.puff(p.x + dx, p.y + 0.8, p.z - 0.6, 1.2, 5);
      this.clonesOn = clonesOn;
    }
    if (clonesOn || this.clones) {
      const clones = this.getClones();
      clones.forEach((c, i) => {
        c.rig.root.visible = clonesOn;
        if (!clonesOn) return;
        c.rig.root.position.set(p.x + (i === 0 ? -1.05 : 1.05), p.y, 0.7);
        c.anim.update(dt, { state: state === 'surf' ? 'run' : state, speed, vy: p.vy, vx, spinProgress: spin });
      });
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
