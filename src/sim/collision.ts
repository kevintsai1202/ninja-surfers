import { LANE_WIDTH, TRAIN, HURDLE, HIGH_BAR, BLOCK, RAMP, PLAYER, PHYS } from '../config';
import type { Obstacle, Lane } from './types';

/**
 * 判定用的幾何查詢：障礙的佔地範圍、實體高度、可站立的頂面、玩家的判定盒、正面／側面撞擊分類。
 */

/** 車道中心的 x */
export function laneX(lane: Lane | number): number {
  return lane * LANE_WIDTH;
}

/** 障礙半寬（依種類） */
function halfWidth(o: Obstacle): number {
  switch (o.kind) {
    case 'hurdle':
      return HURDLE.width / 2;
    case 'highBar':
      return HIGH_BAR.width / 2;
    case 'block':
      return BLOCK.width / 2;
    case 'ramp':
      return RAMP.width / 2;
    default:
      return TRAIN.width / 2;
  }
}

/** 障礙的佔地範圍（z 用目前位置） */
export function footprint(o: Obstacle): { x0: number; x1: number; z0: number; z1: number } {
  const cx = laneX(o.lane);
  const hw = halfWidth(o);
  return { x0: cx - hw, x1: cx + hw, z0: o.z, z1: o.z + o.length };
}

/**
 * 可以站上去的頂面高度（在 z 處）；不能站的障礙（低欄、高橫樑）或 z 不在範圍內回傳 null。
 */
export function surfaceAt(o: Obstacle, z: number): number | null {
  if (z < o.z || z > o.z + o.length) return null;
  switch (o.kind) {
    case 'train':
      return TRAIN.height;
    case 'block':
      return BLOCK.height;
    case 'ramp':
      return (RAMP.height * (z - o.z)) / RAMP.length;
    default:
      return null;
  }
}

/** 障礙實體的高度範圍 [底, 頂]（斜坡用玩家所在 z 的斜面高度） */
export function solidRange(o: Obstacle, z: number): [number, number] {
  switch (o.kind) {
    case 'hurdle':
      return [0, HURDLE.height];
    case 'highBar':
      return [HIGH_BAR.bottom, HIGH_BAR.top];
    case 'block':
      return [0, BLOCK.height];
    case 'ramp': {
      const s = surfaceAt(o, Math.max(o.z, Math.min(o.z + o.length, z)));
      return [0, s ?? 0];
    }
    default:
      return [0, TRAIN.height];
  }
}

/** 越過頂面的容許量：可站的障礙用踩上去的高度，低欄給一點點寬容，高橫樑沒有 */
function topTolerance(o: Obstacle): number {
  switch (o.kind) {
    case 'hurdle':
      return 0.15;
    case 'highBar':
      return 0;
    default:
      return PHYS.stepUp;
  }
}

/** 玩家判定盒所需的最少資料 */
export interface BodyState {
  x: number;
  y: number;
  z: number;
  height: number;
}

/** 判定盒 */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** 玩家判定盒（z 以玩家位置為中心） */
export function bodyBox(b: BodyState): Box {
  const hw = PLAYER.width / 2;
  const hd = PLAYER.depth / 2;
  return { x0: b.x - hw, x1: b.x + hw, y0: b.y, y1: b.y + b.height, z0: b.z - hd, z1: b.z + hd };
}

/** 兩個區間是否重疊（eps > 0 表示要重疊超過 eps 才算） */
function overlap(a0: number, a1: number, b0: number, b1: number, eps = 0): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > eps;
}

/**
 * 玩家腳下的地面高度：與玩家水平範圍重疊至少 30% 寬、頂面不高於「腳底＋stepUp」的可站頂面取最高者，沒有就是 0。
 */
export function groundUnder(b: BodyState, obstacles: readonly Obstacle[]): number {
  const box = bodyBox(b);
  const minOverlap = PLAYER.width * 0.3;
  let g = 0;
  for (const o of obstacles) {
    const fp = footprint(o);
    if (b.z < fp.z0 - 1 || b.z > fp.z1 + 1) continue;
    if (Math.min(box.x1, fp.x1) - Math.max(box.x0, fp.x0) < minOverlap) continue;
    const s = surfaceAt(o, b.z);
    if (s === null) continue;
    if (s <= b.y + PHYS.stepUp && s > g) g = s;
  }
  return g;
}

/** 撞擊結果 */
export interface Hit {
  kind: 'front' | 'side';
  obstacle: Obstacle;
}

/**
 * 偵測玩家這一步撞到什麼。
 * - 用「上一步 z → 這一步 z」的掃掠範圍判斷 z 重疊，高速也不會穿過薄障礙。
 * - 上一步已經橫向重疊、這一步才在 z 方向進入 → 正面撞；上一步沒有橫向重疊（換線造成）→ 側撞。
 * - 斜坡從正面跑上去不算撞，只有從側面撞到比 stepUp 高的斜面才算側撞。
 * 同時撞到多個時，正面撞優先。
 */
export function detectHit(prev: BodyState, cur: BodyState, obstacles: readonly Obstacle[]): Hit | null {
  const now = bodyBox(cur);
  const was = bodyBox(prev);
  const sz0 = Math.min(was.z0, now.z0);
  const sz1 = Math.max(was.z1, now.z1);
  let side: Hit | null = null;
  for (const o of obstacles) {
    const fp = footprint(o);
    const oz0 = Math.min(o.z, o.prevZ);
    const oz1 = Math.max(o.z, o.prevZ) + o.length;
    if (!overlap(sz0, sz1, oz0, oz1)) continue;
    if (!overlap(now.x0, now.x1, fp.x0, fp.x1, 0.02)) continue;
    const [bottom, top] = solidRange(o, cur.z);
    if (now.y0 >= top - topTolerance(o)) continue; // 在上面（越過或踩在頂面）
    if (now.y1 <= bottom + 0.02) continue; // 在下面（滾過高橫樑）
    const prevX = overlap(was.x0, was.x1, fp.x0, fp.x1, 0.02);
    if (o.kind === 'ramp') {
      if (prevX) continue;
      side ??= { kind: 'side', obstacle: o };
      continue;
    }
    const prevZ = overlap(was.z0, was.z1, o.prevZ, o.prevZ + o.length);
    if (prevX && !prevZ) return { kind: 'front', obstacle: o };
    if (!prevX) {
      side ??= { kind: 'side', obstacle: o };
      continue;
    }
    // 上一步就已經重疊（例如無敵剛結束時還卡在裡面）：算正面撞
    return { kind: 'front', obstacle: o };
  }
  return side;
}

/** 玩家目前是否卡在任何實體裡（無敵結束前用來決定要不要延長） */
export function insideSolid(cur: BodyState, obstacles: readonly Obstacle[]): boolean {
  const box = bodyBox(cur);
  for (const o of obstacles) {
    const fp = footprint(o);
    if (!overlap(box.z0, box.z1, fp.z0, fp.z1)) continue;
    if (!overlap(box.x0, box.x1, fp.x0, fp.x1, 0.02)) continue;
    const [bottom, top] = solidRange(o, cur.z);
    if (box.y0 >= top - topTolerance(o)) continue;
    if (box.y1 <= bottom + 0.02) continue;
    return true;
  }
  return false;
}
