import { PHYS, PLAYER } from '../config';
import { laneX } from './collision';
import type { Lane } from './types';

/**
 * 玩家狀態與移動（換線、跳、滾、重力）。碰撞與地面高度由 run.ts 計算後餵進來。
 */
export interface PlayerState {
  /** 目標車道 */
  lane: Lane;
  /** 目前 x */
  x: number;
  /** 換線起點 x */
  laneFromX: number;
  /** 換線進度（0..1；1 = 完成） */
  laneT: number;
  /** 跑的距離 */
  z: number;
  /** 腳底高度 */
  y: number;
  /** 垂直速度 */
  vy: number;
  grounded: boolean;
  /** 離開地面後經過的秒數（土狼時間：剛跑出車頂邊緣還可以跳） */
  airTime: number;
  /** 這次離地是不是自己跳的（跳過就不能再用土狼時間） */
  jumped: boolean;
  /** 翻滾剩餘秒數 */
  rolling: number;
  /** 空中按了翻滾：落地後翻滾 */
  rollQueued: boolean;
  /** 踉蹌動畫剩餘秒數 */
  stumble: number;
  /** 騎蛤蟆飛行中 */
  flying: boolean;
  /** 目前判定盒高度（翻滾時變矮；每個模擬步同步更新） */
  height: number;
  /** 上一步的位置與判定高度（判定正面／側面撞用） */
  prevX: number;
  prevY: number;
  prevZ: number;
  prevHeight: number;
}

/** 土狼時間（秒） */
const COYOTE = 0.08;

/** 建立玩家（中間車道、地面） */
export function createPlayer(z = 0): PlayerState {
  return {
    lane: 0,
    x: 0,
    laneFromX: 0,
    laneT: 1,
    z,
    y: 0,
    vy: 0,
    grounded: true,
    airTime: 0,
    jumped: false,
    rolling: 0,
    rollQueued: false,
    stumble: 0,
    flying: false,
    height: PLAYER.height,
    prevX: 0,
    prevY: 0,
    prevZ: z,
    prevHeight: PLAYER.height,
  };
}

/** 目前判定盒高度（翻滾時變矮） */
export function playerHeight(p: PlayerState): number {
  return p.rolling > 0 ? PLAYER.rollHeight : PLAYER.height;
}

/**
 * 要求換線。
 * @returns 有沒有真的開始換線（已在最邊邊就不會）
 */
export function requestLane(p: PlayerState, dir: -1 | 1): boolean {
  const next = p.lane + dir;
  if (next < -1 || next > 1) return false;
  p.lane = next as Lane;
  p.laneFromX = p.x;
  p.laneT = 0;
  return true;
}

/**
 * 要求跳躍：在地面上（或剛離地的土狼時間內）才能跳；跳會取消翻滾。
 * @param superJump 查克拉附著（跳得更高）
 */
export function requestJump(p: PlayerState, superJump: boolean): boolean {
  if (p.flying) return false;
  const coyote = !p.grounded && !p.jumped && p.airTime < COYOTE;
  if (!p.grounded && !coyote) return false;
  p.vy = superJump ? PHYS.superJumpVelocity : PHYS.jumpVelocity;
  p.grounded = false;
  p.jumped = true;
  p.airTime = 0;
  p.rolling = 0;
  p.rollQueued = false;
  return true;
}

/**
 * 要求翻滾：地面上直接滾；空中則急降，落地後滾。
 * @returns 'roll' 開始翻滾、'dive' 空中急降、null 沒反應
 */
export function requestRoll(p: PlayerState): 'roll' | 'dive' | null {
  if (p.flying) return null;
  if (p.grounded) {
    p.rolling = PHYS.rollTime;
    p.height = PLAYER.rollHeight;
    return 'roll';
  }
  p.vy = Math.min(p.vy, PHYS.fastFallVelocity);
  p.rollQueued = true;
  return 'dive';
}

/** smoothstep 緩動 */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 推進換線與往前跑 */
export function moveHorizontal(p: PlayerState, dt: number, speed: number): void {
  if (p.laneT < 1) {
    p.laneT = Math.min(1, p.laneT + dt / PHYS.laneChangeTime);
    p.x = p.laneFromX + (laneX(p.lane) - p.laneFromX) * smooth(p.laneT);
  } else {
    p.x = laneX(p.lane);
  }
  p.z += speed * dt;
}

/**
 * 推進垂直方向（重力、落地、跑出平台邊緣）。
 * @param ground 這一步腳下的地面高度
 * @returns 'land' 剛落地、'fall' 剛跑出邊緣開始掉、null 沒變化
 */
export function moveVertical(p: PlayerState, dt: number, ground: number): 'land' | 'fall' | null {
  if (p.grounded) {
    if (ground < p.y - 0.02) {
      // 跑出車頂或斜坡邊緣
      p.grounded = false;
      p.jumped = false;
      p.airTime = 0;
      p.vy = 0;
      return 'fall';
    }
    p.y = ground;
    return null;
  }
  p.airTime += dt;
  p.vy -= PHYS.gravity * dt;
  p.y += p.vy * dt;
  if (p.y <= ground) {
    p.y = ground;
    p.vy = 0;
    p.grounded = true;
    p.jumped = false;
    return 'land';
  }
  return null;
}

/**
 * 側撞彈回：把玩家推出障礙側面，並往原本的車道換回去。
 * @param edgeX0 障礙左緣 x
 * @param edgeX1 障礙右緣 x
 */
export function bounceBack(p: PlayerState, edgeX0: number, edgeX1: number): void {
  const half = PLAYER.width / 2;
  // 從哪一側撞進來：換線方向
  const dir = Math.sign(laneX(p.lane) - p.laneFromX) || (p.x < (edgeX0 + edgeX1) / 2 ? 1 : -1);
  const back = Math.max(-1, Math.min(1, p.lane - dir)) as Lane;
  p.x = dir > 0 ? edgeX0 - half - 0.01 : edgeX1 + half + 0.01;
  p.lane = back;
  p.laneFromX = p.x;
  p.laneT = 0;
}
