import * as THREE from 'three';
import { DIMS, SPIN_Y, type HumanoidRig } from './rig';

/**
 * 程式產生的角色動畫：每個動作狀態算出一組「目標姿勢」，再平滑混合到目前姿勢。
 * 角度單位：度（套用到骨架時才轉弧度），方便調整與閱讀。
 *
 * 旋轉慣例（見 rig.ts）：
 * - 肢體 rotation.x > 0：往前（−z）甩；膝蓋彎曲是負值（小腿往後收）。
 * - 軀幹 rotation.x < 0：往前傾。
 * - 肩膀 rotation.z：右手（+x）正值是往外張開，左手相反。
 */

/** 一組完整姿勢（所有關節角度，單位：度；bodyY 單位：公尺） */
export interface Pose {
  /** 骨盆高度偏移（公尺） */
  bodyY: number;
  /** 根節點側傾（換線傾身） */
  rootRoll: number;
  /** 根節點轉向 */
  rootYaw: number;
  /** 骨盆前傾（腿的角度是相對骨盆，所以腿要扣回來） */
  pelvisX: number;
  pelvisYaw: number;
  spineX: number;
  spineY: number;
  spineZ: number;
  chestX: number;
  neckX: number;
  neckY: number;
  shLX: number;
  shLY: number;
  shLZ: number;
  shRX: number;
  shRY: number;
  shRZ: number;
  elL: number;
  elR: number;
  handLX: number;
  handRX: number;
  hipLX: number;
  hipLZ: number;
  hipRX: number;
  hipRZ: number;
  knL: number;
  knR: number;
  anL: number;
  anR: number;
}

/** 站姿（所有姿勢的基底） */
export function neutralPose(): Pose {
  return {
    bodyY: 0,
    rootRoll: 0,
    rootYaw: 0,
    pelvisX: 0,
    pelvisYaw: 0,
    spineX: 0,
    spineY: 0,
    spineZ: 0,
    chestX: 0,
    neckX: 0,
    neckY: 0,
    shLX: 0,
    shLY: 0,
    shLZ: -8,
    shRX: 0,
    shRY: 0,
    shRZ: 8,
    elL: 8,
    elR: 8,
    handLX: 0,
    handRX: 0,
    hipLX: 0,
    hipLZ: 0,
    hipRX: 0,
    hipRZ: 0,
    knL: 0,
    knR: 0,
    anL: 0,
    anR: 0,
  };
}

/** 動畫狀態 */
export type AnimState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'superJump'
  | 'roll'
  | 'stumble'
  | 'fall'
  | 'surf'
  | 'ride'
  | 'grab'
  | 'paint';

/** 跑步風格：忍者跑（主角、暗部）或一般衝刺（伊魯卡老師） */
export type RunStyle = 'naruto' | 'sprint';

const DEG = Math.PI / 180;

/**
 * 單腳的跑步循環：大腿前後擺、膝蓋在回擺時大幅彎曲（腳跟踢到屁股）、著地時較直。
 * @param p 這隻腳的相位（弧度）
 * @param amp 大腿擺幅（度）
 * @param bias 大腿平均前擺角（度），身體前傾時腳要往前多伸
 */
function legCycle(p: number, amp: number, bias: number): { hip: number; knee: number; ankle: number } {
  const hip = bias + amp * Math.sin(p);
  const fold = Math.pow((1 + Math.cos(p + 0.3)) / 2, 1.4);
  const knee = -(20 + 92 * fold);
  // 腳掌大致維持水平，回擺時腳尖往下
  const ankle = -(hip + knee) * 0.55 - 12 * fold;
  return { hip, knee, ankle };
}

/**
 * 忍者跑：上身前傾約 50°、頭抬起看前方、雙臂打直拖在身後（往後上方約 20°、略張開、不前後擺），
 * 大步高抬腿；每個循環身體上下彈兩次。
 * @param phase 跑步相位（0..1）
 */
export function narutoRunPose(phase: number): Pose {
  const p = phase * Math.PI * 2;
  const pose = neutralPose();
  // 身體壓更低，腳的平均前擺也加大，重心才不會看起來往前倒
  const R = legCycle(p, 52, 28);
  const L = legCycle(p + Math.PI, 52, 28);
  // 腳張開（騰空）時身體最高、雙腳交錯（著地）時最低
  pose.bodyY = -0.1 - 0.03 * Math.cos(2 * p);
  pose.pelvisYaw = 7 * Math.sin(p);
  // 上身前傾約 75°、接近水平（骨盆 −22° ＋腰 −46° ＋胸 −7°；使用者兩次要求壓低），骨盆也前傾，身體才是一直線
  pose.pelvisX = -22;
  pose.spineX = -46 + 2.5 * Math.sin(2 * p);
  pose.spineY = -5 * Math.sin(p);
  pose.chestX = -7;
  // 頭往上補回，世界角約 −16°，仍然看前方
  pose.neckX = 59;
  // 手臂：世界角度約 −90°（水平往後），扣掉軀幹前傾的 −75° → 區域角 −15°；
  // 再往外張約 20°，從背後的追尾鏡頭看才是往後拖的 V 字，不會被身體擋住
  const flutter = 2.5 * Math.sin(2 * p + 1);
  pose.shLX = -15 + flutter;
  pose.shRX = -15 - flutter;
  pose.shLZ = -20;
  pose.shRZ = 20;
  pose.shLY = 5;
  pose.shRY = -5;
  pose.elL = 4;
  pose.elR = 4;
  pose.handLX = -15;
  pose.handRX = -15;
  // 腿的世界角度不變：骨盆前傾多少，髖關節就往回補多少
  pose.hipRX = R.hip - pose.pelvisX;
  pose.knR = R.knee;
  pose.anR = R.ankle;
  pose.hipLX = L.hip - pose.pelvisX;
  pose.knL = L.knee;
  pose.anL = L.ankle;
  pose.hipLZ = -3;
  pose.hipRZ = 3;
  return pose;
}

/**
 * 一般衝刺（伊魯卡老師追人）：上身微前傾、雙臂彎曲前後大幅擺動（與同側腳反向）。
 */
export function sprintPose(phase: number): Pose {
  const p = phase * Math.PI * 2;
  const pose = neutralPose();
  const R = legCycle(p, 48, 12);
  const L = legCycle(p + Math.PI, 48, 12);
  pose.bodyY = -0.04 + 0.03 * Math.cos(2 * p);
  pose.pelvisYaw = 8 * Math.sin(p);
  pose.spineX = -16;
  pose.spineY = -10 * Math.sin(p);
  pose.neckX = 10;
  pose.shRX = -50 * Math.sin(p);
  pose.shLX = 50 * Math.sin(p);
  pose.shLZ = -10;
  pose.shRZ = 10;
  pose.elL = 85;
  pose.elR = 85;
  pose.hipRX = R.hip;
  pose.knR = R.knee;
  pose.anR = R.ankle;
  pose.hipLX = L.hip;
  pose.knL = L.knee;
  pose.anL = L.ankle;
  return pose;
}

/**
 * 跳躍：保留忍者跑的雙臂姿勢，雙腿收起（一前一後），下降時腿往下伸準備落地。
 * @param vyNorm 垂直速度正規化（+1 = 剛起跳、−1 = 快落地）
 */
export function jumpPose(vyNorm: number): Pose {
  const pose = narutoRunPose(0.25);
  const rise = Math.max(0, Math.min(1, (vyNorm + 1) / 2));
  pose.bodyY = 0;
  pose.spineX = -38;
  pose.neckX = 32;
  pose.hipRX = 75 * rise + 25;
  pose.knR = -(110 * rise + 30);
  pose.hipLX = -10 + 20 * rise;
  pose.knL = -(70 + 20 * rise);
  pose.anR = -20;
  pose.anL = 10;
  return pose;
}

/** 翻滾：縮成一團，雙手抱膝（整體旋轉由 spin 節點另外處理） */
export function rollPose(): Pose {
  const pose = neutralPose();
  pose.bodyY = -0.32;
  pose.spineX = -78;
  pose.chestX = -20;
  pose.neckX = 25;
  pose.hipLX = 115;
  pose.hipRX = 115;
  pose.knL = -150;
  pose.knR = -150;
  pose.anL = 30;
  pose.anR = 30;
  pose.shLX = 55;
  pose.shRX = 55;
  pose.shLZ = -12;
  pose.shRZ = 12;
  pose.elL = 95;
  pose.elR = 95;
  return pose;
}

/**
 * 踉蹌：身體往後仰、雙手往前亂揮、腳步打結。
 * @param t 踉蹌開始後的秒數
 */
export function stumblePose(t: number): Pose {
  const pose = neutralPose();
  const w = Math.sin(t * 30);
  pose.bodyY = -0.05;
  pose.spineX = 8;
  pose.neckX = -5;
  pose.shLX = 120 + 30 * w;
  pose.shRX = 120 - 30 * w;
  pose.shLZ = -30;
  pose.shRZ = 30;
  pose.elL = 30;
  pose.elR = 30;
  pose.hipLX = 30 * w;
  pose.hipRX = -30 * w;
  pose.knL = -40;
  pose.knR = -40;
  return pose;
}

/** 倒地（正面撞上）：往後倒、四肢攤開 */
export function fallPose(): Pose {
  const pose = neutralPose();
  pose.bodyY = -0.5;
  pose.spineX = 10;
  pose.neckX = -10;
  pose.shLX = 160;
  pose.shRX = 150;
  pose.shLZ = -40;
  pose.shRZ = 40;
  pose.elL = 20;
  pose.elR = 20;
  pose.hipLX = 70;
  pose.hipRX = 40;
  pose.knL = -30;
  pose.knR = -60;
  return pose;
}

/** 卷軸滑板：側身站、膝蓋微彎、雙手張開平衡 */
export function surfPose(phase: number): Pose {
  const pose = neutralPose();
  const b = Math.sin(phase * Math.PI * 2);
  pose.rootYaw = 70;
  pose.bodyY = -0.1 + 0.02 * b;
  pose.spineX = -12;
  pose.spineZ = 4 * b;
  pose.neckY = -60;
  pose.neckX = 5;
  pose.shLZ = -80 + 6 * b;
  pose.shRZ = 80 - 6 * b;
  pose.shLX = 10;
  pose.shRX = -10;
  pose.elL = 15;
  pose.elR = 15;
  pose.hipLX = 22;
  pose.hipRX = -18;
  pose.hipLZ = -12;
  pose.hipRZ = 12;
  pose.knL = -45;
  pose.knR = -45;
  pose.anL = 20;
  pose.anR = 20;
  return pose;
}

/** 騎在蛤蟆頭上：蹲坐、右手握拳往前指 */
export function ridePose(phase: number): Pose {
  const pose = neutralPose();
  const b = Math.sin(phase * Math.PI * 2);
  pose.bodyY = -0.32;
  pose.spineX = -15 + 3 * b;
  pose.neckX = 12;
  pose.hipLX = 85;
  pose.hipRX = 85;
  pose.hipLZ = -18;
  pose.hipRZ = 18;
  pose.knL = -120;
  pose.knR = -120;
  pose.anL = 35;
  pose.anR = 35;
  pose.shRX = 150 + 8 * b;
  pose.shRZ = 10;
  pose.elR = 10;
  pose.shLX = -20;
  pose.shLZ = -35;
  pose.elL = 70;
  return pose;
}

/** 抓人（追捕者抓到主角）：雙手往前伸 */
export function grabPose(t: number): Pose {
  const pose = neutralPose();
  pose.spineX = -20;
  pose.shLX = 85 + 10 * Math.sin(t * 8);
  pose.shRX = 95;
  pose.shLZ = -5;
  pose.shRZ = 5;
  pose.elL = 15;
  pose.elR = 15;
  pose.hipLX = 20;
  pose.knL = -25;
  return pose;
}

/** 塗鴉（開場）：面向岩壁、右手舉高來回刷 */
export function paintPose(t: number): Pose {
  const pose = neutralPose();
  const s = Math.sin(t * 6);
  pose.shRX = 130 + 20 * s;
  pose.shRZ = 20 + 15 * s;
  pose.elR = 30;
  pose.shLX = 20;
  pose.elL = 60;
  pose.spineX = 5;
  pose.neckX = -15;
  return pose;
}

/** 依動作狀態取得目標姿勢 */
export function poseFor(state: AnimState, phase: number, t: number, style: RunStyle, vyNorm: number): Pose {
  switch (state) {
    case 'run':
      return style === 'naruto' ? narutoRunPose(phase) : sprintPose(phase);
    case 'jump':
    case 'superJump':
      return style === 'naruto' ? jumpPose(vyNorm) : sprintPose(0.25);
    case 'roll':
      return rollPose();
    case 'stumble':
      return stumblePose(t);
    case 'fall':
      return fallPose();
    case 'surf':
      return surfPose(phase);
    case 'ride':
      return ridePose(phase);
    case 'grab':
      return grabPose(t);
    case 'paint':
      return paintPose(t);
    default:
      return neutralPose();
  }
}

/** 每幀餵給動畫器的資料 */
export interface AnimInput {
  state: AnimState;
  /** 往前跑速（m/s），決定步頻 */
  speed: number;
  /** 垂直速度（m/s），跳躍姿勢用 */
  vy?: number;
  /** 橫向速度（m/s），換線傾身用 */
  vx?: number;
  /** 翻滾或空翻的進度（0..1），由模擬層的計時換算 */
  spinProgress?: number;
}

/**
 * 角色動畫器：持有目前姿勢、跑步相位，每幀把姿勢混合到目標並套用到骨架。
 */
export class CharacterAnimator {
  /** 目前姿勢（混合後） */
  readonly current: Pose = neutralPose();
  /** 跑步相位（0..1 循環） */
  phase = 0;
  /** 目前狀態持續的秒數 */
  stateTime = 0;
  /** 上一幀的狀態（偵測狀態切換） */
  private lastState: AnimState = 'idle';
  /** 總經過時間（布條擺動用） */
  private time = 0;
  /** 布條各節的關節（第一次 update 時收集） */
  private flapJoints: THREE.Group[][] | null = null;
  /** 凍結相位（姿勢檢視模式用）：有值時不推進相位 */
  frozenPhase: number | null = null;

  constructor(
    readonly rig: HumanoidRig,
    readonly style: RunStyle = 'naruto',
  ) {}

  /**
   * 推進動畫一幀。
   * @param dt 秒
   */
  update(dt: number, input: AnimInput): void {
    if (input.state !== this.lastState) {
      this.stateTime = 0;
      this.lastState = input.state;
    }
    this.stateTime += dt;
    this.time += dt;
    // 步頻隨速度提高：12 m/s 約 3.1 Hz、28 m/s 約 4.1 Hz
    const freq = 2.35 + 0.063 * input.speed;
    if (this.frozenPhase !== null) this.phase = this.frozenPhase;
    else this.phase = (this.phase + freq * dt) % 1;

    const vyNorm = Math.max(-1, Math.min(1, (input.vy ?? 0) / 8.4));
    const target = poseFor(input.state, this.phase, this.stateTime, this.style, vyNorm);
    // 換線傾身：往移動方向側傾（往右移 = 繞 z 軸負方向）
    target.rootRoll += -Math.max(-1, Math.min(1, (input.vx ?? 0) / 18)) * 16;

    // 混合速度：跑步循環本身就連續，用較快的混合；切換狀態的瞬間也不會硬切
    const rate = input.state === 'roll' || input.state === 'fall' ? 22 : 16;
    const k = 1 - Math.exp(-rate * dt);
    const cur = this.current as unknown as Record<string, number>;
    const tgt = target as unknown as Record<string, number>;
    for (const key of Object.keys(cur)) cur[key] += (tgt[key] - cur[key]) * k;

    this.apply(input);
  }

  /** 把目前姿勢套用到骨架，並處理翻滾旋轉與布條擺動 */
  private apply(input: AnimInput): void {
    const r = this.rig;
    const p = this.current;
    r.root.rotation.set(0, p.rootYaw * DEG, p.rootRoll * DEG);
    r.body.position.y = DIMS.hip - SPIN_Y + p.bodyY;
    r.pelvis.rotation.set(p.pelvisX * DEG, p.pelvisYaw * DEG, 0);
    r.spine.rotation.set(p.spineX * DEG, p.spineY * DEG, p.spineZ * DEG);
    r.chest.rotation.set(p.chestX * DEG, 0, 0);
    r.neck.rotation.set(p.neckX * DEG, p.neckY * DEG, 0);
    r.shoulderL.rotation.set(p.shLX * DEG, p.shLY * DEG, p.shLZ * DEG);
    r.shoulderR.rotation.set(p.shRX * DEG, p.shRY * DEG, p.shRZ * DEG);
    r.elbowL.rotation.set(p.elL * DEG, 0, 0);
    r.elbowR.rotation.set(p.elR * DEG, 0, 0);
    r.handL.rotation.set(p.handLX * DEG, 0, 0);
    r.handR.rotation.set(p.handRX * DEG, 0, 0);
    r.hipL.rotation.set(p.hipLX * DEG, 0, p.hipLZ * DEG);
    r.hipR.rotation.set(p.hipRX * DEG, 0, p.hipRZ * DEG);
    r.kneeL.rotation.set(p.knL * DEG, 0, 0);
    r.kneeR.rotation.set(p.knR * DEG, 0, 0);
    r.ankleL.rotation.set(p.anL * DEG, 0, 0);
    r.ankleR.rotation.set(p.anR * DEG, 0, 0);

    // 翻滾（往前滾一圈）與查克拉跳的前空翻：繞 spin 節點的 x 軸
    if (input.state === 'roll' || input.state === 'superJump') {
      const prog = input.spinProgress ?? 0;
      r.spin.rotation.x = -Math.PI * 2 * prog;
    } else if (input.state === 'fall') {
      // 往後倒：最多躺平 80°
      r.spin.rotation.x = Math.min(1, this.stateTime / 0.35) * 80 * DEG;
    } else {
      r.spin.rotation.x = 0;
    }

    this.updateFlaps(input.speed);
  }

  /** 布條（護額綁帶、馬尾）隨速度往後飄並波動 */
  private updateFlaps(speed: number): void {
    if (!this.flapJoints) {
      this.flapJoints = this.rig.flaps.map((first) => {
        const chain: THREE.Group[] = [];
        let g: THREE.Object3D | undefined = first;
        while (g) {
          chain.push(g as THREE.Group);
          g = g.children.find((c) => (c as THREE.Group).isGroup);
        }
        return chain;
      });
    }
    // 風速越快布條越平（抬起），越慢越下垂
    const wind = Math.min(1, speed / 14);
    for (const chain of this.flapJoints) {
      const side = (chain[0].userData.side as number | undefined) ?? 0;
      const base = (chain[0].userData.baseX as number | undefined) ?? 0.5;
      chain[0].rotation.x = base * (1 - wind) + 0.15 * wind;
      for (let i = 0; i < chain.length; i++) {
        const w = Math.sin(this.time * (10 + 8 * wind) + i * 1.3 + side);
        if (i > 0) chain[i].rotation.x = (0.12 + 0.25 * wind) * w + 0.12 * (1 - wind);
        chain[i].rotation.y = side * 0.1 + 0.15 * wind * Math.sin(this.time * 9 + i);
      }
    }
  }
}
