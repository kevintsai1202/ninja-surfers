import { TRAIN, RAMP, VIEW_AHEAD, VIEW_BEHIND } from '../config';
import { speedAt, minGap } from './speed';
import { POWER_TIME, TOAD_ALTITUDE } from './powerups';
import { addObstacle, addCoin, addPickup, type RunState } from './run';
import type { Rng } from './rng';
import type { Lane, ObstacleKind, PowerKind } from './types';

/**
 * 關卡生成：用「圖樣模板」一段一段往前排，每段之間空 minGap(v)，保證玩家來得及反應。
 * 每個模板都保證至少有一條可通過的路線（自動駕駛的公平性測試會驗證）。
 */

/** 生成器狀態 */
export interface GenState {
  /** 下一段圖樣的起點 */
  nextZ: number;
  /** 上一次放道具的位置 */
  lastPowerZ: number;
  /** 下一次放道具前要隔多遠 */
  powerEvery: number;
  /** 上一個圖樣名稱（避免連續重複） */
  last: string;
}

/** 三條車道 */
const LANES: Lane[] = [-1, 0, 1];

/** 建立生成器（起跑後先空 40 m 讓玩家熱身） */
export function createGen(startZ: number): GenState {
  return { nextZ: startZ + 40, lastPowerZ: startZ, powerEvery: 160, last: '' };
}

/** 模板用的擺放工具 */
interface Ctx {
  s: RunState;
  rng: Rng;
  /** 圖樣起點 */
  z0: number;
  /** 起點的跑速 */
  v: number;
  /** 這個速度下需要動作的障礙最少間距 */
  g: number;
  ob(kind: ObstacleKind, lane: Lane, dz: number, length?: number, extra?: { speed?: number; trigger?: number }): void;
  /** 一排地面上的兩 */
  coins(lane: Lane, dz: number, count: number, spacing?: number, y?: number): void;
  /** 一道跳躍弧線上的兩（越過低欄或車廂縫） */
  arc(lane: Lane, dz: number, length: number, base: number, apex: number): void;
}

/** 隨機的列車長度（10 的倍數） */
function trainLen(rng: Rng, min: number, max: number): number {
  return rng.int(min / TRAIN.carLength, max / TRAIN.carLength) * TRAIN.carLength;
}

/** 除了指定車道以外的車道 */
function others(...lanes: Lane[]): Lane[] {
  return LANES.filter((l) => !lanes.includes(l));
}

/** 一個圖樣模板：最小出現距離、權重、建造函式（回傳圖樣長度） */
interface Pattern {
  name: string;
  minD: number;
  weight: number;
  build(c: Ctx): number;
}

/** 可以跳或滾過的小障礙（隨機） */
function smallKind(rng: Rng): ObstacleKind {
  return rng.weighted<ObstacleKind>([
    ['hurdle', 3],
    ['highBar', 2],
  ]);
}

/** 所有圖樣模板 */
const PATTERNS: Pattern[] = [
  {
    // 單一障礙，旁邊車道有兩
    name: 'single',
    minD: 0,
    weight: 3,
    build(c) {
      const lane = c.rng.pick(LANES);
      const kind = c.rng.weighted<ObstacleKind>([
        ['hurdle', 3],
        ['highBar', 2],
        ['block', 2],
      ]);
      c.ob(kind, lane, 0);
      if (kind === 'hurdle' && c.rng.chance(0.6)) c.arc(lane, -c.v * 0.3, c.v * 0.62, 0.6, 1.9);
      else c.coins(c.rng.pick(others(lane)), -4, 6);
      return 1.5;
    },
  },
  {
    // 兩條車道各一個障礙，第三條空著
    name: 'pair',
    minD: 100,
    weight: 3,
    build(c) {
      const free = c.rng.pick(LANES);
      for (const l of others(free)) c.ob(c.rng.weighted<ObstacleKind>([['hurdle', 2], ['highBar', 2], ['block', 2]]), l, 0);
      c.coins(free, -5, 7);
      return 1.5;
    },
  },
  {
    // 三條都是低欄：一定要跳
    name: 'wallJump',
    minD: 150,
    weight: 2,
    build(c) {
      for (const l of LANES) c.ob('hurdle', l, 0);
      c.arc(c.rng.pick(LANES), -c.v * 0.3, c.v * 0.62, 0.6, 1.9);
      return 1;
    },
  },
  {
    // 三條都是高橫樑：一定要滾
    name: 'wallRoll',
    minD: 250,
    weight: 2,
    build(c) {
      for (const l of LANES) c.ob('highBar', l, 0);
      c.coins(c.rng.pick(LANES), -4, 5, 2, 0.5);
      return 1;
    },
  },
  {
    // 低欄、高橫樑、擋牆各一（打亂車道）
    name: 'mixedWall',
    minD: 300,
    weight: 2,
    build(c) {
      const kinds: ObstacleKind[] = ['hurdle', 'highBar', 'block'];
      const order = [...LANES].sort(() => c.rng.next() - 0.5);
      order.forEach((l, i) => c.ob(kinds[i], l, 0));
      return 1.5;
    },
  },
  {
    // 一列靜止列車在旁邊，另一條車道有小障礙，第三條有兩
    name: 'trainSide',
    minD: 40,
    weight: 3,
    build(c) {
      const [tl, ol, cl] = [...LANES].sort(() => c.rng.next() - 0.5);
      const len = trainLen(c.rng, 20, 40);
      c.ob('train', tl, 0, len);
      if (len > c.g + 4) c.ob(smallKind(c.rng), ol, c.rng.range(2, len - c.g));
      c.coins(cl, 2, Math.floor(len / 3), 3);
      return len;
    },
  },
  {
    // 兩條車道都是長列車，中間只剩一條路（路上可能有小障礙）
    name: 'trainCorridor',
    minD: 400,
    weight: 2,
    build(c) {
      const free = c.rng.pick(LANES);
      let maxLen = 0;
      for (const l of others(free)) {
        const len = trainLen(c.rng, 30, 50);
        c.ob('train', l, 0, len);
        maxLen = Math.max(maxLen, len);
      }
      let z = c.g * 0.6;
      while (z + 2 < maxLen) {
        c.ob(smallKind(c.rng), free, z);
        z += c.g;
      }
      c.coins(free, maxLen * 0.1, 4, 2.5);
      return maxLen;
    },
  },
  {
    // 斜坡＋列車：可以跑上車頂吃兩
    name: 'rampRoof',
    minD: 200,
    weight: 3,
    build(c) {
      const lane = c.rng.pick(LANES);
      const len = trainLen(c.rng, 30, 50);
      c.ob('ramp', lane, 0, RAMP.length);
      c.ob('train', lane, RAMP.length, len);
      c.coins(lane, RAMP.length + 3, Math.floor(len / 3), 3, TRAIN.height + 1);
      // 旁邊車道：短列車或空著。圖樣長度要算到最遠的列車尾端，
      // 不然後面空檔撒的兩可能落進延伸出去的短列車裡
      let end = RAMP.length + len;
      for (const l of others(lane)) {
        if (c.rng.chance(0.45)) {
          const at = RAMP.length + c.rng.range(0, 6);
          const sideLen = trainLen(c.rng, 10, 30);
          c.ob('train', l, at, sideLen);
          end = Math.max(end, at + sideLen);
        }
      }
      return end;
    },
  },
  {
    // 三條車道都是列車，只有一條前面有斜坡：一定要走斜坡上車頂
    name: 'trainWall',
    minD: 700,
    weight: 2,
    build(c) {
      const rampLane = c.rng.pick(LANES);
      let maxLen = 0;
      for (const l of LANES) {
        const len = trainLen(c.rng, 30, 50);
        if (l === rampLane) c.ob('ramp', l, 0, RAMP.length);
        c.ob('train', l, RAMP.length, len);
        maxLen = Math.max(maxLen, len);
      }
      c.coins(rampLane, RAMP.length + 2, 8, 3, TRAIN.height + 1);
      return RAMP.length + maxLen;
    },
  },
  {
    // 迎面列車：它在的那條車道整段不能待，另一條可能有靜止列車，第三條安全
    name: 'movingTrain',
    minD: 350,
    weight: 2,
    build(c) {
      const [ml, sl, fl] = [...LANES].sort(() => c.rng.next() - 0.5);
      const vt = c.rng.range(8, 12);
      // 玩家距離 trigger 時開動，約 4 秒後交會；交會前它會往玩家方向開 travel 公尺
      const trigger = (c.v + vt) * 4;
      const travel = (vt * trigger) / (c.v + vt);
      const start = travel + 12;
      const len = trainLen(c.rng, 20, 30);
      c.ob('train', ml, start, len, { speed: vt, trigger });
      if (c.rng.chance(0.6)) c.ob('train', sl, c.rng.range(0, 10), trainLen(c.rng, 20, 40));
      c.coins(fl, 5, 8, 3);
      return start + len;
    },
  },
  {
    // 蛇行：每隔一段換一條車道被擋
    name: 'slalom',
    minD: 500,
    weight: 2,
    build(c) {
      const rows = c.rng.int(3, 4);
      let lane = c.rng.pick(LANES);
      for (let i = 0; i < rows; i++) {
        c.ob('block', lane, i * c.g);
        const next = c.rng.pick(others(lane));
        lane = next;
      }
      return (rows - 1) * c.g + 1.5;
    },
  },
  {
    // 車頂跳車頂：斜坡上去，兩節列車之間有縫要跳過
    name: 'roofHop',
    minD: 900,
    weight: 1,
    build(c) {
      const lane = c.rng.pick(LANES);
      const len1 = trainLen(c.rng, 20, 30);
      const gap = 4;
      const len2 = trainLen(c.rng, 20, 30);
      c.ob('ramp', lane, 0, RAMP.length);
      c.ob('train', lane, RAMP.length, len1);
      c.ob('train', lane, RAMP.length + len1 + gap, len2);
      c.arc(lane, RAMP.length + len1 - c.v * 0.25, c.v * 0.62, TRAIN.height + 0.6, TRAIN.height + 1.9);
      return RAMP.length + len1 + gap + len2;
    },
  },
];

/** 依距離挑一個圖樣（距離越遠能出現的越多；避免和上一個相同） */
function pickPattern(rng: Rng, d: number, last: string): Pattern {
  const pool = PATTERNS.filter((p) => d >= p.minD && p.name !== last);
  return rng.weighted(pool.map((p) => [p, p.weight] as const));
}

/** 道具種類權重 */
const POWER_WEIGHTS: [PowerKind, number][] = [
  ['magnet', 18],
  ['chakra', 15],
  ['clones', 14],
  ['toad', 11],
  ['scroll', 10],
  ['pill', 4],
  ['shuriken', 18],
  ['rasengan', 6],
  ['kunai', 7],
  ['sub', 5],
];

/** 擺下一段圖樣（含之後的間隔、可能的道具） */
function placePattern(s: RunState): void {
  const z0 = s.gen.nextZ;
  const v = speedAt(z0);
  const g = minGap(v);
  const rng = s.rng;
  const ctx: Ctx = {
    s,
    rng,
    z0,
    v,
    g,
    ob(kind, lane, dz, length, extra) {
      addObstacle(s, { kind, lane, z: z0 + dz, length, speed: extra?.speed, trigger: extra?.trigger, variant: rng.int(0, 3) });
    },
    coins(lane, dz, count, spacing = 2, y = 1) {
      for (let i = 0; i < count; i++) addCoin(s, lane, z0 + dz + i * spacing, y);
    },
    arc(lane, dz, length, base, apex) {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        addCoin(s, lane, z0 + dz + t * length, base + (apex - base) * 4 * t * (1 - t));
      }
    },
  };
  const pattern = pickPattern(rng, z0, s.gen.last);
  const len = pattern.build(ctx);
  s.gen.last = pattern.name;
  let end = z0 + len;
  // 間隔中放道具（間隔裡沒有障礙，很安全）
  if (end - s.gen.lastPowerZ > s.gen.powerEvery) {
    const kind = rng.weighted(POWER_WEIGHTS);
    addPickup(s, kind, rng.pick(LANES), end + g * 0.5, 1.1);
    s.gen.lastPowerZ = end;
    s.gen.powerEvery = rng.range(170, 260);
  } else if (rng.chance(0.14)) {
    // 間隔裡偶爾放一份手裏劍補給
    addPickup(s, 'shuriken', rng.pick(LANES), end + g * 0.5, 1.1);
  } else if (rng.chance(0.4)) {
    ctx.coins(rng.pick(LANES), len + g * 0.25, 5, 2.2);
  }
  end += g;
  s.gen.nextZ = end;
}

/** 確保玩家前方 VIEW_AHEAD 內都已經生成 */
export function ensureTrack(s: RunState): void {
  while (s.gen.nextZ < s.player.z + VIEW_AHEAD) placePattern(s);
}

/** 清掉玩家身後太遠、或已經撿走的東西 */
export function cleanupTrack(s: RunState): void {
  const behind = s.player.z - VIEW_BEHIND;
  if (s.obstacles.length && s.obstacles[0].z + s.obstacles[0].length < behind) {
    s.obstacles = s.obstacles.filter((o) => o.z + o.length >= behind);
  }
  if (s.coinList.length > 0 && (s.coinList[0].z < behind || s.coinList[0].taken)) {
    s.coinList = s.coinList.filter((c) => !c.taken && c.z >= behind);
  }
  if (s.pickups.length > 0 && (s.pickups[0].z < behind || s.pickups[0].taken)) {
    s.pickups = s.pickups.filter((k) => !k.taken && k.z >= behind);
  }
}

/** 騎上蛤蟆時，在前方空中沿三條車道擺一串一串的兩（蛇形換線） */
export function spawnToadCoins(s: RunState): void {
  const p = s.player;
  const v = speedAt(p.z);
  const from = p.z + 18;
  const to = p.z + v * (POWER_TIME.toad - 0.8);
  let lane: Lane = p.lane;
  let z = from;
  while (z < to) {
    const run = s.rng.int(5, 9);
    for (let i = 0; i < run && z < to; i++, z += 2.6) addCoin(s, lane, z, TOAD_ALTITUDE + 1.2);
    z += 4;
    lane = s.rng.pick(others(lane));
  }
}
