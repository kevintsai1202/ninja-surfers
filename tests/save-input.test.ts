import { describe, it, expect } from 'vitest';
import { defaultSave, parseSave, serializeSave, applyRunResult, loadSave, writeSave, SAVE_VERSION } from '../src/sim/save';
import { SwipeTracker } from '../src/input/gesture';

/** 記憶體版的 localStorage（測試用） */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe('存檔', () => {
  it('預設存檔：兩 0、卷軸滑板 2、兵糧丸 1', () => {
    const d = defaultSave();
    expect(d.schemaVersion).toBe(SAVE_VERSION);
    expect(d.ryo).toBe(0);
    expect(d.boards).toBe(2);
    expect(d.pills).toBe(1);
    expect(d.best).toBe(0);
  });

  it('壞掉或空的存檔回到預設；缺欄位補預設；負數夾成 0', () => {
    expect(parseSave(null)).toEqual(defaultSave());
    expect(parseSave('{壞掉的 json')).toEqual(defaultSave());
    const d = parseSave(JSON.stringify({ schemaVersion: SAVE_VERSION, best: 500, ryo: -3 }));
    expect(d.best).toBe(500);
    expect(d.ryo).toBe(0);
    expect(d.boards).toBe(2);
  });

  it('序列化後再讀回來相同', () => {
    const d = { ...defaultSave(), best: 1234, ryo: 99, muted: true };
    expect(parseSave(serializeSave(d))).toEqual(d);
  });

  it('結算：最高分取大、兩累加、道具庫存更新、不修改原物件', () => {
    const d = { ...defaultSave(), best: 1000, ryo: 50 };
    const r = applyRunResult(d, { score: 800, coins: 30, boards: 1, pills: 3 });
    expect(r.best).toBe(1000);
    expect(r.ryo).toBe(80);
    expect(r.boards).toBe(1);
    expect(r.pills).toBe(3);
    expect(r.runs).toBe(d.runs + 1);
    expect(d.ryo).toBe(50);
    const r2 = applyRunResult(r, { score: 1500.7, coins: 0, boards: 1, pills: 3 });
    expect(r2.best).toBe(1500);
  });

  it('localStorage 讀寫（包 try/catch，丟例外時不會壞）', () => {
    const st = memoryStorage();
    const d = { ...defaultSave(), ryo: 77 };
    expect(writeSave(d, st)).toBe(true);
    expect(loadSave(st).ryo).toBe(77);
    const broken = {
      ...st,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadSave(broken)).toEqual(defaultSave());
    expect(writeSave(d, broken)).toBe(false);
  });
});

describe('滑動手勢', () => {
  it('超過門檻立刻判定方向，一次觸控只觸發一次', () => {
    const g = new SwipeTracker();
    g.start(1, 100, 100, 0);
    expect(g.move(1, 120, 102, 0.05)).toBeNull();
    expect(g.move(1, 140, 104, 0.08)).toBe('right');
    expect(g.move(1, 200, 104, 0.1)).toBeNull();
    expect(g.end(1, 200, 104, 0.12)).toBeNull();
  });

  it('上滑跳、下滑滾、左滑往左', () => {
    const g = new SwipeTracker();
    g.start(1, 100, 100, 0);
    expect(g.move(1, 102, 60, 0.05)).toBe('jump');
    g.end(1, 102, 60, 0.06);
    g.start(2, 100, 100, 1);
    expect(g.move(2, 98, 150, 1.05)).toBe('roll');
    g.end(2, 98, 150, 1.06);
    g.start(3, 100, 100, 2);
    expect(g.move(3, 50, 110, 2.05)).toBe('left');
  });

  it('雙擊（0.3 秒內、位置相近）＝啟動卷軸滑板；間隔太久不算', () => {
    const g = new SwipeTracker();
    g.start(1, 100, 100, 0);
    expect(g.end(1, 101, 100, 0.08)).toBeNull();
    g.start(2, 104, 102, 0.2);
    expect(g.end(2, 104, 102, 0.26)).toBe('board');
    g.start(3, 100, 100, 5);
    g.end(3, 100, 100, 5.05);
    g.start(4, 100, 100, 5.6);
    expect(g.end(4, 100, 100, 5.65)).toBeNull();
  });
});
