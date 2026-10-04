/**
 * 模擬層的共用型別（純資料，不依賴 three／DOM）。
 * 座標：z 是往前跑的距離（越大越前面）；x = 車道 × LANE_WIDTH；y 是高度（地面 0）。
 */

/** 場景（輪替順序見 config.ts 的 BIOME_ORDER） */
export type BiomeId = 'village' | 'forest' | 'valley';

/** 車道：−1 左、0 中、+1 右 */
export type Lane = -1 | 0 | 1;

/**
 * 障礙種類（模擬只有一套，外觀依所在場景換皮）：
 * - hurdle 低欄：要跳過
 * - highBar 高橫樑：要滾過
 * - block 擋牆：要換線
 * - train 列車：要換線或從斜坡跑上車頂；有 speed 時是迎面列車
 * - ramp 斜坡：接在列車前面，可以跑上去
 */
export type ObstacleKind = 'hurdle' | 'highBar' | 'block' | 'train' | 'ramp';

/** 玩家輸入動作 */
export type Action = 'left' | 'right' | 'jump' | 'roll' | 'board' | 'throw' | 'kunai';

/** 場上可撿的道具（第二版加：手裏劍、螺旋丸、起爆符苦無、替身木頭） */
export type PowerKind =
  | 'toad'
  | 'chakra'
  | 'magnet'
  | 'clones'
  | 'scroll'
  | 'pill'
  | 'shuriken'
  | 'rasengan'
  | 'kunai'
  | 'sub';

/** 障礙 */
export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  /** 前緣（靠玩家那一端）的距離 */
  z: number;
  /** 上一個模擬步的前緣距離（迎面列車會動，判定正面／側面要用） */
  prevZ: number;
  /** 沿跑道方向的長度 */
  length: number;
  /** 迎面列車的速度（m/s，往玩家方向）；0 = 靜止 */
  speed: number;
  /** 玩家距離多近時迎面列車開始移動 */
  trigger: number;
  /** 迎面列車已經開動 */
  moving: boolean;
  /** 外觀變化 */
  variant: number;
  /** 生成時所在的場景（決定外觀） */
  biome: BiomeId;
  /** 已被打碎（子步結束時才從陣列移除，避免迭代中改動陣列） */
  removed?: boolean;
}

/** 兩（金幣） */
export interface Coin {
  id: number;
  lane: Lane;
  x: number;
  y: number;
  z: number;
  /** 被萬象天引吸住，正飛向玩家 */
  pulled: boolean;
  taken: boolean;
}

/** 場上的道具 */
export interface Pickup {
  id: number;
  kind: PowerKind;
  lane: Lane;
  y: number;
  z: number;
  taken: boolean;
}

/** 秘傳卷軸的獎勵 */
export type ScrollReward =
  | { kind: 'ryo'; amount: number }
  | { kind: 'board' }
  | { kind: 'pill' }
  | { kind: 'jackpot'; amount: number };

/** 有時效的能力 */
export type TimedPower = 'toad' | 'chakra' | 'magnet' | 'clones' | 'board' | 'rasengan';

/** 飛行中的手裏劍或起爆符苦無（只看車道判定，不看高度） */
export interface Projectile {
  id: number;
  kind: 'shuriken' | 'kunai';
  lane: Lane;
  x: number;
  y: number;
  z: number;
  /** 擲出的位置（算射程、爆炸範圍） */
  startZ: number;
  dead: boolean;
}

/** 障礙被打碎的原因 */
export type BreakCause = 'shuriken' | 'kunai' | 'rasengan' | 'clone';

/** 模擬事件（畫面、音效、UI 依事件反應） */
export type SimEvent =
  | { type: 'coin'; id: number; combo: number }
  | { type: 'jump'; super: boolean }
  | { type: 'roll' }
  | { type: 'lane'; dir: -1 | 1 }
  | { type: 'land' }
  | { type: 'stumble'; obstacleId: number }
  | { type: 'crash'; obstacleId: number }
  | { type: 'caught' }
  | { type: 'powerup'; kind: PowerKind }
  | { type: 'powerEnd'; kind: TimedPower }
  | { type: 'boardOn' }
  | { type: 'boardBreak' }
  | { type: 'scroll'; reward: ScrollReward }
  | { type: 'biome'; id: BiomeId }
  | { type: 'chaser'; identity: 'iruka' | 'anbu' }
  | { type: 'trainStart'; id: number }
  | { type: 'revive' }
  | { type: 'throw'; kind: 'shuriken' | 'kunai' }
  | { type: 'break'; obstacleId: number; kind: ObstacleKind; lane: Lane; z: number; length: number; biome: BiomeId; cause: BreakCause }
  | { type: 'clink'; lane: Lane; z: number }
  | { type: 'explode'; lane: Lane; z: number }
  | { type: 'cloneBlock'; left: number }
  | { type: 'climb' }
  | { type: 'flicker'; fromX: number; toX: number }
  | { type: 'substitution'; cause: 'crash' | 'caught' };
