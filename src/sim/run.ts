import { PHYS, LANE_WIDTH, TRAIN, BLOCK, PLAYER } from '../config';
import { createRng, type Rng } from './rng';
import { speedAt } from './speed';
import { biomeAt, chaserIdentityAt } from './biome';
import { createChaser, chaserStumble, updateChaser, resetChaser, type ChaserState } from './chaser';
import { groundUnder, detectHit, insideSolid, footprint, laneX, type BodyState, type Hit } from './collision';
import {
  createPlayer,
  playerHeight,
  requestLane,
  requestJump,
  requestRoll,
  moveHorizontal,
  moveVertical,
  bounceBack,
  type PlayerState,
} from './player';
import {
  POWER_TIME,
  BOARD_SAFE_TIME,
  TOAD_LANDING_SAFE,
  REVIVE_SAFE,
  MAGNET_RANGE,
  MAGNET_PULL_SPEED,
  TOAD_ALTITUDE,
  TOAD_HOP,
  TOAD_HOP_PERIOD,
  SHURIKEN,
  KUNAI,
  RASENGAN,
  FLICKER,
  CLIMB_SPEED,
  CLONE_BLOCKS,
  SUB_SAFE_TIME,
  rollScroll,
} from './powerups';
import { createGen, ensureTrack, cleanupTrack, spawnToadCoins, type GenState } from './track';
import type {
  Action,
  BiomeId,
  BreakCause,
  Coin,
  Lane,
  Obstacle,
  ObstacleKind,
  Pickup,
  PowerKind,
  Projectile,
  SimEvent,
  TimedPower,
} from './types';

/**
 * 一局跑酷的完整狀態與推進（純函式風格：狀態物件＋step，沒有 three／DOM 依賴，可在 Node 測試）。
 */

/** 模擬子步長上限（秒）：28 m/s 時每步 0.23 m，比任何障礙都薄，不會穿過 */
export const MAX_SUBSTEP = 1 / 120;

/** 建立跑局的選項 */
export interface RunOptions {
  seed: number;
  /** 自動生成關卡（測試可關掉，自己擺障礙） */
  generate?: boolean;
  /** 起跑距離（測試用） */
  startZ?: number;
  /** 帶進來的卷軸滑板數 */
  boards?: number;
  /** 帶進來的兵糧丸數 */
  pills?: number;
  /** 開場追捕者貼身的秒數（預設 3） */
  introSeconds?: number;
  /** 開局的手裏劍數（預設 SHURIKEN.start） */
  shuriken?: number;
  /** 是否允許瞬身術（公平性測試關掉，維持原本「不能瞬移」的標準） */
  flicker?: boolean;
}

/** 各能力的剩餘秒數（0 = 沒有） */
export type PowerTimers = Record<TimedPower, number> & { invincible: number };

/** 一局的狀態 */
export interface RunState {
  seed: number;
  /** 關卡生成用的亂數 */
  rng: Rng;
  /** 卷軸獎勵用的亂數（和關卡分開：撿不撿卷軸不影響之後的關卡） */
  rewardRng: Rng;
  generate: boolean;
  /** 經過秒數 */
  time: number;
  status: 'running' | 'dead';
  deathCause: 'crash' | 'caught' | null;
  player: PlayerState;
  chaser: ChaserState;
  power: PowerTimers;
  /** 蛤蟆已飛行秒數（跳躍相位） */
  toadTime: number;
  /** 蛤蟆結束後、落地前（無敵） */
  landingGrace: boolean;
  boards: number;
  pills: number;
  /** 這局已經復活幾次（決定下次復活的花費） */
  revives: number;
  score: number;
  /** 這局撿到的兩 */
  coins: number;
  /** 連續撿兩的連段數（音效音高用） */
  combo: number;
  lastCoinTime: number;
  /** 目前跑速 */
  speed: number;
  biome: BiomeId;
  obstacles: Obstacle[];
  coinList: Coin[];
  pickups: Pickup[];
  /** 飛行中的手裏劍、起爆符苦無 */
  projectiles: Projectile[];
  /** 手裏劍數量 */
  shuriken: number;
  /** 起爆符苦無數量 */
  kunai: number;
  /** 替身木頭數量（0 或 1） */
  subs: number;
  /** 影分身還能擋幾次撞擊 */
  clonesLeft: number;
  /** 是否允許瞬身術 */
  flickerEnabled: boolean;
  /** 瞬身術冷卻剩餘秒數 */
  flickerCooldown: number;
  /** 上一次換線（判斷瞬身術：方向、時間、換線前的車道） */
  lastLane: { dir: -1 | 1; time: number; fromLane: Lane } | null;
  /** 查克拉攀牆中：攀的是哪個障礙、頂面高度 */
  climb: { obstacleId: number; top: number } | null;
  nextId: number;
  gen: GenState;
}

/** 建立一局 */
export function createRun(opts: RunOptions): RunState {
  const startZ = opts.startZ ?? 0;
  const s: RunState = {
    seed: opts.seed,
    rng: createRng(opts.seed),
    rewardRng: createRng(opts.seed ^ 0x5bd1e995),
    generate: opts.generate ?? true,
    time: 0,
    status: 'running',
    deathCause: null,
    player: createPlayer(startZ),
    chaser: createChaser(opts.introSeconds ?? 3),
    power: { toad: 0, chakra: 0, magnet: 0, clones: 0, board: 0, rasengan: 0, invincible: 0 },
    toadTime: 0,
    landingGrace: false,
    boards: opts.boards ?? 0,
    pills: opts.pills ?? 0,
    revives: 0,
    score: 0,
    coins: 0,
    combo: 0,
    lastCoinTime: -1,
    speed: speedAt(startZ),
    biome: biomeAt(startZ),
    obstacles: [],
    coinList: [],
    pickups: [],
    projectiles: [],
    shuriken: opts.shuriken ?? SHURIKEN.start,
    kunai: 0,
    subs: 0,
    clonesLeft: 0,
    flickerEnabled: opts.flicker ?? true,
    flickerCooldown: 0,
    lastLane: null,
    climb: null,
    nextId: 1,
    gen: createGen(startZ),
  };
  s.chaser.identity = chaserIdentityAt(startZ);
  if (s.generate) ensureTrack(s);
  return s;
}

/** 擺一個障礙（關卡生成與測試共用） */
export function addObstacle(
  s: RunState,
  o: { kind: ObstacleKind; lane: Lane; z: number; length?: number; speed?: number; trigger?: number; variant?: number },
): Obstacle {
  const defaults: Record<ObstacleKind, number> = { hurdle: 0.4, highBar: 0.4, block: 1.2, train: 20, ramp: 7 };
  const ob: Obstacle = {
    id: s.nextId++,
    kind: o.kind,
    lane: o.lane,
    z: o.z,
    prevZ: o.z,
    length: o.length ?? defaults[o.kind],
    speed: o.speed ?? 0,
    trigger: o.trigger ?? 0,
    moving: false,
    variant: o.variant ?? 0,
    biome: biomeAt(o.z),
  };
  s.obstacles.push(ob);
  return ob;
}

/** 擺一個兩 */
export function addCoin(s: RunState, lane: Lane, z: number, y = 1): Coin {
  const c: Coin = { id: s.nextId++, lane, x: lane * LANE_WIDTH, y, z, pulled: false, taken: false };
  s.coinList.push(c);
  return c;
}

/** 擺一個道具 */
export function addPickup(s: RunState, kind: PowerKind, lane: Lane, z: number, y = 1): Pickup {
  const k: Pickup = { id: s.nextId++, kind, lane, y, z, taken: false };
  s.pickups.push(k);
  return k;
}

/** 玩家目前的判定資料 */
function body(p: PlayerState): BodyState {
  return { x: p.x, y: p.y, z: p.z, height: playerHeight(p) };
}

/** 玩家上一步的判定資料 */
function prevBody(p: PlayerState): BodyState {
  return { x: p.prevX, y: p.prevY, z: p.prevZ, height: p.prevHeight };
}

/** 套用一個輸入動作 */
function applyAction(s: RunState, a: Action, ev: SimEvent[]): void {
  const p = s.player;
  switch (a) {
    case 'left':
    case 'right': {
      const dir = a === 'left' ? -1 : 1;
      if (tryFlicker(s, dir, ev)) break;
      const from = p.lane;
      if (requestLane(p, dir)) {
        ev.push({ type: 'lane', dir });
        s.lastLane = { dir, time: s.time, fromLane: from };
      }
      break;
    }
    case 'jump':
      if (requestJump(p, s.power.chakra > 0)) ev.push({ type: 'jump', super: s.power.chakra > 0 });
      break;
    case 'roll': {
      const r = requestRoll(p);
      if (r === 'roll') ev.push({ type: 'roll' });
      break;
    }
    case 'board':
      if (s.boards > 0 && s.power.board <= 0) {
        s.boards--;
        s.power.board = POWER_TIME.board;
        ev.push({ type: 'boardOn' });
      }
      break;
    case 'throw':
      if (s.shuriken > 0) {
        s.shuriken--;
        spawnProjectile(s, 'shuriken');
        ev.push({ type: 'throw', kind: 'shuriken' });
      }
      break;
    case 'kunai':
      if (s.kunai > 0) {
        s.kunai--;
        spawnProjectile(s, 'kunai');
        ev.push({ type: 'throw', kind: 'kunai' });
      }
      break;
  }
}

/** 主角目前 x 最近的車道 */
function nearestLane(x: number): Lane {
  return Math.max(-1, Math.min(1, Math.round(x / LANE_WIDTH))) as Lane;
}

/** 從主角位置擲出手裏劍或起爆符苦無（判定只看車道） */
function spawnProjectile(s: RunState, kind: Projectile['kind']): void {
  const p = s.player;
  const lane = nearestLane(p.x);
  s.projectiles.push({ id: s.nextId++, kind, lane, x: laneX(lane), y: p.y + 1.0, z: p.z + 0.4, startZ: p.z, dead: false });
}

/**
 * 瞬身術：0.25 秒內同方向第二次換線 → 從第一次換線前的車道，瞬間移動到該方向最遠、且當下沒被占住的車道。
 * @returns 有沒有發動（沒發動就照一般換線處理）
 */
function tryFlicker(s: RunState, dir: -1 | 1, ev: SimEvent[]): boolean {
  const last = s.lastLane;
  if (!s.flickerEnabled || s.flickerCooldown > 0 || !last) return false;
  if (last.dir !== dir || s.time - last.time > FLICKER.window) return false;
  const p = s.player;
  const clamp = (l: number) => Math.max(-1, Math.min(1, l)) as Lane;
  const far = clamp(last.fromLane + 2 * dir);
  const near = clamp(last.fromLane + dir);
  const targets = [far, near].filter((l, i, arr) => l !== last.fromLane && arr.indexOf(l) === i);
  for (const target of targets) {
    const x = laneX(target);
    if (insideSolid({ x, y: p.y, z: p.z, height: playerHeight(p) }, s.obstacles)) continue;
    const fromX = p.x;
    p.x = x;
    p.prevX = x;
    p.lane = target;
    p.laneFromX = x;
    p.laneT = 1;
    s.flickerCooldown = FLICKER.cooldown;
    s.lastLane = null;
    ev.push({ type: 'flicker', fromX, toX: x });
    return true;
  }
  return false;
}

/** 打碎一個障礙（先標記，子步結束時移除）並加一點分數 */
function breakObstacle(s: RunState, o: Obstacle, cause: BreakCause, ev: SimEvent[]): void {
  if (o.removed) return;
  o.removed = true;
  s.score += o.kind === 'train' ? 60 : 25;
  ev.push({ type: 'break', obstacleId: o.id, kind: o.kind, lane: o.lane, z: o.z, length: o.length, biome: o.biome, cause });
}

/** 推進飛行中的手裏劍與起爆符苦無：撞到同車道的第一個障礙就作用 */
function updateProjectiles(s: RunState, v: number, dt: number, ev: SimEvent[]): void {
  for (const pr of s.projectiles) {
    if (pr.dead) continue;
    const z0 = pr.z;
    pr.z += (v + (pr.kind === 'shuriken' ? SHURIKEN.speed : KUNAI.speed)) * dt;
    let hit: Obstacle | null = null;
    for (const o of s.obstacles) {
      if (o.removed || o.lane !== pr.lane) continue;
      if (o.z + o.length < z0 || o.z > pr.z) continue;
      if (!hit || o.z < hit.z) hit = o;
    }
    if (pr.kind === 'shuriken') {
      if (hit) {
        if (hit.kind === 'hurdle' || hit.kind === 'highBar' || hit.kind === 'block') breakObstacle(s, hit, 'shuriken', ev);
        else ev.push({ type: 'clink', lane: pr.lane, z: Math.max(hit.z, z0) });
        pr.dead = true;
      } else if (pr.z - pr.startZ > SHURIKEN.range) {
        pr.dead = true;
      }
    } else if (hit || pr.z - pr.startZ >= KUNAI.range) {
      // 起爆符：清掉擲出點往前 KUNAI.range 公尺內同車道的所有障礙（含列車）
      const z1 = pr.startZ + KUNAI.range;
      for (const o of s.obstacles) {
        if (o.removed || o.lane !== pr.lane) continue;
        if (o.z + o.length < pr.startZ - 1 || o.z > z1) continue;
        breakObstacle(s, o, 'kunai', ev);
      }
      ev.push({ type: 'explode', lane: pr.lane, z: hit ? Math.max(hit.z, z0) : pr.z });
      pr.dead = true;
    }
  }
}

/** 處理撞擊：正面撞（卷軸滑板可抵銷一次）或側撞踉蹌 */
function handleHit(s: RunState, hit: Hit, ev: SimEvent[]): void {
  const p = s.player;
  const o = hit.obstacle;
  // 螺旋丸：碰到什麼都撞碎（含列車、側面）
  if (s.power.rasengan > 0) {
    breakObstacle(s, o, 'rasengan', ev);
    return;
  }
  if (hit.kind === 'front') {
    // 正面撞擊的處理順序：查克拉攀牆 → 影分身 → 卷軸滑板 → 替身木頭 → 倒下
    if (s.power.chakra > 0 && (o.kind === 'train' || o.kind === 'block')) {
      s.climb = { obstacleId: o.id, top: o.kind === 'train' ? TRAIN.height : BLOCK.height };
      p.vy = 0;
      p.grounded = false;
      p.jumped = true;
      p.rolling = 0;
      p.rollQueued = false;
      ev.push({ type: 'climb' });
      return;
    }
    if (s.clonesLeft > 0 && s.power.clones > 0 && (o.kind === 'hurdle' || o.kind === 'highBar' || o.kind === 'block')) {
      s.clonesLeft--;
      breakObstacle(s, o, 'clone', ev);
      ev.push({ type: 'cloneBlock', left: s.clonesLeft });
      if (s.clonesLeft === 0) {
        s.power.clones = 0;
        ev.push({ type: 'powerEnd', kind: 'clones' });
      }
      return;
    }
    if (s.power.board > 0) {
      s.power.board = 0;
      s.power.invincible = BOARD_SAFE_TIME;
      ev.push({ type: 'boardBreak' });
      return;
    }
    if (s.subs > 0) {
      s.subs--;
      s.power.invincible = SUB_SAFE_TIME;
      ev.push({ type: 'substitution', cause: 'crash' });
      return;
    }
    s.status = 'dead';
    s.deathCause = 'crash';
    ev.push({ type: 'crash', obstacleId: o.id });
    return;
  }
  const fp = footprint(o);
  bounceBack(p, fp.x0, fp.x1);
  p.stumble = 0.45;
  ev.push({ type: 'stumble', obstacleId: o.id });
  if (chaserStumble(s.chaser) === 'caught') {
    // 被抓只有替身木頭能救：追捕者抓到的是木頭
    if (s.subs > 0) {
      s.subs--;
      resetChaser(s.chaser);
      s.power.invincible = SUB_SAFE_TIME;
      ev.push({ type: 'substitution', cause: 'caught' });
      return;
    }
    s.status = 'dead';
    s.deathCause = 'caught';
    ev.push({ type: 'caught' });
  }
}

/** 撿到一個兩 */
function takeCoin(s: RunState, c: Coin, ev: SimEvent[]): void {
  c.taken = true;
  s.coins++;
  s.combo = s.time - s.lastCoinTime < 0.35 ? s.combo + 1 : 0;
  s.lastCoinTime = s.time;
  ev.push({ type: 'coin', id: c.id, combo: s.combo });
}

/** 撿到道具：套用效果 */
function takePickup(s: RunState, k: Pickup, ev: SimEvent[]): void {
  k.taken = true;
  ev.push({ type: 'powerup', kind: k.kind });
  switch (k.kind) {
    case 'toad':
      s.power.toad = POWER_TIME.toad;
      s.toadTime = 0;
      s.player.rolling = 0;
      s.player.rollQueued = false;
      if (s.generate) spawnToadCoins(s);
      break;
    case 'chakra':
    case 'magnet':
      s.power[k.kind] = POWER_TIME[k.kind];
      break;
    case 'clones':
      s.power.clones = POWER_TIME.clones;
      s.clonesLeft = CLONE_BLOCKS;
      break;
    case 'rasengan':
      s.power.rasengan = RASENGAN.time;
      break;
    case 'shuriken':
      s.shuriken = Math.min(SHURIKEN.max, s.shuriken + SHURIKEN.pickup);
      break;
    case 'kunai':
      s.kunai = Math.min(KUNAI.max, s.kunai + 1);
      break;
    case 'sub':
      s.subs = 1;
      break;
    case 'scroll': {
      const reward = rollScroll(s.rewardRng);
      if (reward.kind === 'ryo') s.coins += reward.amount;
      else if (reward.kind === 'board') s.boards++;
      else if (reward.kind === 'pill') s.pills++;
      else {
        s.coins += reward.amount;
        s.pills++;
      }
      ev.push({ type: 'scroll', reward });
      break;
    }
    case 'pill':
      s.pills++;
      break;
  }
}

/** 撿兩與道具（含萬象天引吸取、影分身幫撿） */
function collect(s: RunState, dt: number, ev: SimEvent[]): void {
  const p = s.player;
  const h = playerHeight(p);
  const magnet = s.power.magnet > 0;
  const clones = s.power.clones > 0 && !p.flying;
  for (const c of s.coinList) {
    if (c.taken) continue;
    const dz = c.z - p.z;
    if (dz > MAGNET_RANGE + 5 || dz < -3) continue;
    if (magnet && !c.pulled && dz > -1 && dz < MAGNET_RANGE) c.pulled = true;
    if (c.pulled) {
      // 飛向玩家胸口
      const tx = p.x - c.x;
      const ty = p.y + 0.9 - c.y;
      const tz = p.z - c.z;
      const d = Math.hypot(tx, ty, tz);
      const stepLen = MAGNET_PULL_SPEED * dt;
      if (d <= stepLen + 0.6) takeCoin(s, c, ev);
      else {
        c.x += (tx / d) * stepLen;
        c.y += (ty / d) * stepLen;
        c.z += (tz / d) * stepLen;
      }
      continue;
    }
    if (Math.abs(dz) > 0.8) continue;
    const inLane = Math.abs(c.x - p.x) < 0.9 && (p.flying || (c.y >= p.y - 0.3 && c.y <= p.y + h + 0.4));
    const byClone = clones && c.y < 2.2;
    if (inLane || byClone) takeCoin(s, c, ev);
  }
  for (const k of s.pickups) {
    if (k.taken) continue;
    if (Math.abs(k.z - p.z) > 0.9) continue;
    if (Math.abs(laneX(k.lane) - p.x) > 0.95) continue;
    if (!p.flying && (k.y < p.y - 0.4 || k.y > p.y + h + 0.5)) continue;
    takePickup(s, k, ev);
  }
}

/** 推進一個子步 */
function substep(s: RunState, actions: readonly Action[], dt: number, ev: SimEvent[]): void {
  const p = s.player;
  s.time += dt;
  for (const a of actions) applyAction(s, a, ev);
  if (s.flickerCooldown > 0) s.flickerCooldown = Math.max(0, s.flickerCooldown - dt);
  const v = speedAt(p.z) * (s.power.rasengan > 0 ? RASENGAN.speedMul : 1);
  s.speed = v;

  // 迎面列車：玩家靠近到 trigger 距離內開動
  for (const o of s.obstacles) {
    o.prevZ = o.z;
    if (o.speed > 0) {
      if (!o.moving && o.z - p.z < o.trigger) {
        o.moving = true;
        ev.push({ type: 'trainStart', id: o.id });
      }
      if (o.moving) o.z -= o.speed * dt;
    }
  }

  p.prevX = p.x;
  p.prevY = p.y;
  p.prevZ = p.z;
  p.prevHeight = playerHeight(p);
  moveHorizontal(p, dt, v);

  const climb = s.climb;
  const climbing = climb !== null;
  if (climb) {
    // 查克拉攀牆：貼在障礙前面往上跑，到頂面後踏上去繼續跑
    const o = s.obstacles.find((x) => x.id === climb.obstacleId && !x.removed);
    if (!o) {
      s.climb = null;
    } else {
      p.z = o.z - PLAYER.depth / 2 - 0.01;
      p.y += CLIMB_SPEED * dt;
      if (p.y >= climb.top) {
        p.y = climb.top;
        p.z = o.z + 0.05;
        p.vy = 0;
        p.grounded = true;
        p.jumped = false;
        s.climb = null;
      }
    }
  } else if (s.power.toad > 0) {
    // 騎蛤蟆：在高空一跳一跳往前
    s.toadTime += dt;
    const target = TOAD_ALTITUDE + TOAD_HOP * Math.abs(Math.sin((Math.PI * s.toadTime) / TOAD_HOP_PERIOD));
    p.y += (target - p.y) * Math.min(1, dt * 6);
    p.vy = 0;
    p.grounded = false;
    p.flying = true;
  } else {
    if (p.flying) {
      // 蛤蟆消失：往下掉，落地前無敵
      p.flying = false;
      p.vy = 0;
      p.airTime = 1;
      p.jumped = true;
      s.landingGrace = true;
    }
    const r = moveVertical(p, dt, groundUnder(body(p), s.obstacles));
    if (r === 'land') {
      ev.push({ type: 'land' });
      if (s.landingGrace) {
        s.landingGrace = false;
        s.power.invincible = Math.max(s.power.invincible, TOAD_LANDING_SAFE);
      }
      if (p.rollQueued) {
        p.rollQueued = false;
        p.rolling = PHYS.rollTime;
        ev.push({ type: 'roll' });
      }
    }
  }
  if (p.rolling > 0) p.rolling = Math.max(0, p.rolling - dt);
  if (p.stumble > 0) p.stumble = Math.max(0, p.stumble - dt);
  p.height = playerHeight(p);

  updateProjectiles(s, v, dt, ev);

  // 撞擊（騎蛤蟆、落地前、攀牆中、無敵時跳過）
  const safe = p.flying || s.landingGrace || s.power.invincible > 0 || climbing;
  if (!safe) {
    const hit = detectHit(prevBody(p), body(p), s.obstacles);
    if (hit) handleHit(s, hit, ev);
    if (s.status !== 'running') return;
  }
  if (s.power.invincible > 0) {
    s.power.invincible -= dt;
    // 無敵結束時還卡在障礙裡：延長，直到穿出來
    if (s.power.invincible <= 0) s.power.invincible = insideSolid(body(p), s.obstacles) ? 0.05 : 0;
  }

  collect(s, dt, ev);

  for (const k of ['toad', 'chakra', 'magnet', 'clones', 'board', 'rasengan'] as const) {
    if (s.power[k] > 0) {
      s.power[k] -= dt;
      if (s.power[k] <= 0) {
        s.power[k] = 0;
        if (k === 'clones') s.clonesLeft = 0;
        // 螺旋丸結束：短暫無敵，避免剛好卡在障礙裡
        if (k === 'rasengan') s.power.invincible = Math.max(s.power.invincible, RASENGAN.afterSafe);
        ev.push({ type: 'powerEnd', kind: k });
      }
    }
  }

  const identity = chaserIdentityAt(p.z);
  if (identity !== s.chaser.identity) {
    s.chaser.identity = identity;
    ev.push({ type: 'chaser', identity });
  }
  updateChaser(s.chaser, dt);

  if (!climbing) s.score += v * dt * (s.power.clones > 0 ? 2 : 1);
  // 被打碎的障礙與用完的飛行道具在子步結束時才移除
  if (s.obstacles.some((o) => o.removed)) s.obstacles = s.obstacles.filter((o) => !o.removed);
  if (s.projectiles.some((x) => x.dead)) s.projectiles = s.projectiles.filter((x) => !x.dead);
  const biome = biomeAt(p.z);
  if (biome !== s.biome) {
    s.biome = biome;
    ev.push({ type: 'biome', id: biome });
  }
  if (s.generate) {
    ensureTrack(s);
    cleanupTrack(s);
  }
}

/** 沒有動作 */
const NONE: readonly Action[] = [];

/**
 * 推進一幀：切成不超過 MAX_SUBSTEP 的子步，輸入動作在第一個子步套用。
 * @returns 這一幀發生的事件
 */
export function step(s: RunState, actions: readonly Action[], dt: number): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.status !== 'running' || dt <= 0) return ev;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
  const h = dt / n;
  for (let i = 0; i < n && s.status === 'running'; i++) substep(s, i === 0 ? actions : NONE, h, ev);
  return ev;
}

/** 第 n 次復活要花幾顆兵糧丸（1、2、4、8…） */
export function reviveCost(n: number): number {
  return 2 ** n;
}

/**
 * 用兵糧丸復活：扣兵糧丸、清掉附近障礙、短暫無敵、追捕者退開。
 * @returns 是否成功（兵糧丸不夠或還活著就失敗）
 */
export function revive(s: RunState): boolean {
  if (s.status !== 'dead') return false;
  const cost = reviveCost(s.revives);
  if (s.pills < cost) return false;
  s.pills -= cost;
  s.revives++;
  s.status = 'running';
  s.deathCause = null;
  const p = s.player;
  s.obstacles = s.obstacles.filter((o) => o.z + o.length < p.z - 5 || o.z > p.z + 45);
  p.y = 0;
  p.vy = 0;
  p.grounded = true;
  p.flying = false;
  p.rolling = 0;
  p.rollQueued = false;
  p.stumble = 0;
  p.x = laneX(p.lane);
  p.laneFromX = p.x;
  p.laneT = 1;
  s.power.toad = 0;
  s.landingGrace = false;
  s.climb = null;
  s.projectiles = [];
  s.power.invincible = REVIVE_SAFE;
  resetChaser(s.chaser);
  return true;
}
