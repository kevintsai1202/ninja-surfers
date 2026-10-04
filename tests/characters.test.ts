import { describe, it, expect } from 'vitest';
import {
  CHARACTERS,
  characterInfo,
  isCharacterId,
  isUnlocked,
  newlyUnlocked,
  cycleCharacter,
} from '../src/sim/characters';

describe('角色表', () => {
  it('四個角色依序是鳴人、佐助、小櫻、卡卡西，解鎖距離 0／1000／2000／3000 m', () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual(['naruto', 'sasuke', 'sakura', 'kakashi']);
    expect(CHARACTERS.map((c) => c.name)).toEqual(['鳴人', '佐助', '小櫻', '卡卡西']);
    expect(CHARACTERS.map((c) => c.unlockDist)).toEqual([0, 1000, 2000, 3000]);
  });

  it('招牌忍術：螺旋丸／千鳥／怪力／雷切（螺旋丸道具依角色換外觀與名稱）', () => {
    expect(characterInfo('naruto').jutsu.name).toBe('螺旋丸');
    expect(characterInfo('sasuke').jutsu.name).toBe('千鳥');
    expect(characterInfo('sakura').jutsu.name).toBe('怪力');
    expect(characterInfo('kakashi').jutsu.name).toBe('雷切');
    // 千鳥與雷切都是雷光，怪力是拳頭
    expect(characterInfo('sasuke').jutsu.style).toBe('lightning');
    expect(characterInfo('kakashi').jutsu.style).toBe('lightning');
    expect(characterInfo('sakura').jutsu.style).toBe('fist');
    expect(characterInfo('naruto').jutsu.style).toBe('sphere');
  });

  it('通靈獸坐騎（取代卷軸滑板）：鳴人小蛤蟆、佐助大蛇、小櫻蛞蝓、卡卡西忍犬', () => {
    expect(CHARACTERS.map((c) => c.mount.name)).toEqual(['小蛤蟆', '大蛇', '蛞蝓', '忍犬']);
    expect(CHARACTERS.map((c) => c.mount.kanji)).toEqual(['蟆', '蛇', '蛞', '犬']);
  });

  it('角色編號檢查', () => {
    expect(isCharacterId('sasuke')).toBe(true);
    expect(isCharacterId('itachi')).toBe(false);
    expect(isCharacterId(3)).toBe(false);
  });
});

describe('解鎖', () => {
  it('單局最遠距離達到門檻就解鎖；鳴人一開始就能用', () => {
    expect(isUnlocked('naruto', 0)).toBe(true);
    expect(isUnlocked('sasuke', 999.9)).toBe(false);
    expect(isUnlocked('sasuke', 1000)).toBe(true);
    expect(isUnlocked('kakashi', 2999)).toBe(false);
    expect(isUnlocked('kakashi', 3000)).toBe(true);
  });

  it('這次跨過哪些門檻：只算新跨過的，沒跨過就是空的', () => {
    expect(newlyUnlocked(0, 1500)).toEqual(['sasuke']);
    expect(newlyUnlocked(1500, 3200)).toEqual(['sakura', 'kakashi']);
    expect(newlyUnlocked(999.9, 1000)).toEqual(['sasuke']);
    expect(newlyUnlocked(2000, 2000)).toEqual([]);
    expect(newlyUnlocked(3500, 800)).toEqual([]);
  });
});

describe('選角切換', () => {
  it('左右切換循環', () => {
    expect(cycleCharacter('naruto', 1)).toBe('sasuke');
    expect(cycleCharacter('kakashi', 1)).toBe('naruto');
    expect(cycleCharacter('naruto', -1)).toBe('kakashi');
    expect(cycleCharacter('sakura', -1)).toBe('sasuke');
  });
});
