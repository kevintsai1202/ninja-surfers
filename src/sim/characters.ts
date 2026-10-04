/**
 * 可選角色（第二版多角色）：純資料與純函式，不依賴 three／DOM（存檔、介面、畫面共用）。
 * - 解鎖：單局跑到指定距離（存檔記錄單局最遠距離 bestDist）。
 * - 招牌忍術：場上的「螺旋丸」道具依角色換外觀、名稱與音效，效果不變（3 秒衝刺撞碎一切）。
 * - 通靈獸坐騎：取代第一版的通靈卷軸滑板（庫存道具「通靈卷軸」），效果不變（30 秒、擋一次正面撞擊）。
 * 跑姿全部是忍者跑（第一版的需求）；影分身會變成該角色的分身。
 */

/** 角色編號 */
export type CharacterId = 'naruto' | 'sasuke' | 'sakura' | 'kakashi';

/** 招牌忍術的外觀：sphere＝螺旋丸的球、lightning＝千鳥／雷切的雷光、fist＝怪力的發光拳頭 */
export type JutsuStyle = 'sphere' | 'lightning' | 'fist';

/** 招牌忍術（取代螺旋丸道具的名稱與外觀） */
export interface JutsuInfo {
  /** 名稱（橫幅、HUD） */
  name: string;
  /** 道具徽章與 HUD 上的漢字 */
  kanji: string;
  /** 主色（CSS 色碼） */
  color: string;
  /** 撿到時的音效（對應 audio 的 SfxName） */
  sfx: 'rasengan' | 'chidori' | 'strength';
  style: JutsuStyle;
}

/** 通靈獸坐騎（名稱、HUD 按鈕上的漢字） */
export interface MountInfo {
  name: string;
  kanji: string;
}

/** 一個角色 */
export interface CharacterInfo {
  id: CharacterId;
  /** 選單上的名字 */
  name: string;
  /** 單局跑到幾公尺解鎖（0 = 一開始就能用） */
  unlockDist: number;
  jutsu: JutsuInfo;
  mount: MountInfo;
}

/** 角色表（選單順序） */
export const CHARACTERS: readonly CharacterInfo[] = [
  {
    id: 'naruto',
    name: '鳴人',
    unlockDist: 0,
    jutsu: { name: '螺旋丸', kanji: '螺', color: '#15b3d6', sfx: 'rasengan', style: 'sphere' },
    mount: { name: '小蛤蟆', kanji: '蟆' },
  },
  {
    id: 'sasuke',
    name: '佐助',
    unlockDist: 1000,
    jutsu: { name: '千鳥', kanji: '千', color: '#4aa8ff', sfx: 'chidori', style: 'lightning' },
    mount: { name: '大蛇', kanji: '蛇' },
  },
  {
    id: 'sakura',
    name: '小櫻',
    unlockDist: 2000,
    jutsu: { name: '怪力', kanji: '怪', color: '#ff4f9a', sfx: 'strength', style: 'fist' },
    mount: { name: '蛞蝓', kanji: '蛞' },
  },
  {
    id: 'kakashi',
    name: '卡卡西',
    unlockDist: 3000,
    jutsu: { name: '雷切', kanji: '雷', color: '#cfe8ff', sfx: 'chidori', style: 'lightning' },
    mount: { name: '忍犬', kanji: '犬' },
  },
];

/** 是不是合法的角色編號 */
export function isCharacterId(x: unknown): x is CharacterId {
  return typeof x === 'string' && CHARACTERS.some((c) => c.id === x);
}

/** 取得角色資料 */
export function characterInfo(id: CharacterId): CharacterInfo {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/**
 * 是否已解鎖。
 * @param bestDist 單局最遠距離（公尺）
 */
export function isUnlocked(id: CharacterId, bestDist: number): boolean {
  return bestDist >= characterInfo(id).unlockDist;
}

/**
 * 從 prevBest 跑到 newBest 時新跨過門檻的角色（依選單順序）。
 * 用在：遊玩中第一次跑過門檻時顯示「解鎖」橫幅。
 */
export function newlyUnlocked(prevBest: number, newBest: number): CharacterId[] {
  return CHARACTERS.filter((c) => c.unlockDist > 0 && prevBest < c.unlockDist && newBest >= c.unlockDist).map((c) => c.id);
}

/**
 * 選角左右切換（循環）。
 * @param dir +1 下一個、−1 上一個
 */
export function cycleCharacter(id: CharacterId, dir: 1 | -1): CharacterId {
  const i = CHARACTERS.findIndex((c) => c.id === id);
  const n = CHARACTERS.length;
  return CHARACTERS[(((i + dir) % n) + n) % n].id;
}
