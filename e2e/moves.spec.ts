/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';

/**
 * 第二版新招式 e2e：用 gen=0 開一局（不自動生成障礙），再用除錯鉤子在主角前方擺障礙、給道具，
 * 實際按鍵操作後檢查模擬結果，並截圖確認畫面（碎片、爆炸、螺旋丸、替身木頭、影分身、瞬身術、攀牆）。
 * 用法（對 dev server）：$env:BASE_URL='http://localhost:5173/'; npx playwright test e2e/moves.spec.ts
 * 截圖輸出到 e2e/screenshots/move-*.png。
 */

test.describe.configure({ timeout: 420_000 });

/** 遊戲除錯鉤子（只列這裡用到的） */
interface Hook {
  mode: string;
  run: {
    status: string;
    shuriken: number;
    kunai: number;
    subs: number;
    clonesLeft: number;
    flickerCooldown: number;
    power: Record<string, number>;
    player: { lane: number; y: number; z: number; laneT: number };
    obstacles: { id: number }[];
    projectiles: { z: number }[];
  };
  grant(kind: string, dz?: number): void;
  place(kind: string, dz?: number, length?: number): number;
}

/** 頁面裡的 window（帶除錯鉤子） */
type Win = { __game: Hook };

/** 等待條件的逾時（軟體渲染很慢） */
const WAIT = { timeout: 120_000 };

/** 開一局（不生成障礙、跳過開場）並等到開始奔跑；回傳收集頁面錯誤的陣列 */
async function startRun(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 擋掉 Vite 熱重載的 WebSocket（對 dev server 跑時，有人改檔不會整頁重載）
  await page.routeWebSocket(/.*/, () => {});
  // dtcap：軟體渲染一幀很久，放寬每幀推進的遊戲時間
  await page.goto('./?mute=1&seed=7&intro=0&gen=0&dtcap=0.15');
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  await page.locator('.title-screen .start').click();
  await page.waitForFunction(() => (window as unknown as Win).__game.mode === 'run', null, WAIT);
  return errors;
}

/** 在主角前方 0.3 m 放一個道具（下一幀就撿到） */
async function grant(page: Page, kind: string): Promise<void> {
  await page.evaluate((k) => (window as unknown as Win).__game.grant(k, 0.3), kind);
}

/** 在主角目前車道前方擺一個障礙，回傳障礙編號 */
async function place(page: Page, kind: string, dz: number, length?: number): Promise<number> {
  return page.evaluate(([k, d, l]) => (window as unknown as Win).__game.place(k as string, d as number, l as number | undefined), [kind, dz, length] as const);
}

/** 等某個障礙從模擬裡消失（被打碎） */
async function waitGone(page: Page, id: number): Promise<void> {
  await page.waitForFunction((i) => !(window as unknown as Win).__game.run.obstacles.some((o) => o.id === i), id, WAIT);
}

/** 目前的模擬狀態 */
async function run(page: Page): Promise<Hook['run']> {
  return page.evaluate(() => (window as unknown as Win).__game.run);
}

test('手裏劍：按 F 擲出，擊碎前方的擋牆', async ({ page }) => {
  const errors = await startRun(page);
  const id = await place(page, 'block', 40);
  await page.keyboard.press('f');
  // 飛行中截一張（手裏劍模型與光暈）
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__game.run;
    return r.projectiles.some((pr) => pr.z - r.player.z > 5);
  }, null, WAIT);
  await page.screenshot({ path: 'e2e/screenshots/move-shuriken-flight.png', timeout: 240_000 });
  await waitGone(page, id);
  await page.screenshot({ path: 'e2e/screenshots/move-shuriken.png', timeout: 240_000 });
  const r = await run(page);
  expect(r.status).toBe('running');
  expect(r.shuriken).toBe(2);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('起爆符苦無：按 G 擲出，炸掉前方的列車', async ({ page }) => {
  const errors = await startRun(page);
  await grant(page, 'kunai');
  await page.waitForFunction(() => (window as unknown as Win).__game.run.kunai === 1, null, WAIT);
  const id = await place(page, 'train', 14, 20);
  await page.keyboard.press('g');
  await waitGone(page, id);
  await page.screenshot({ path: 'e2e/screenshots/move-kunai.png', timeout: 240_000 });
  const r = await run(page);
  expect(r.status).toBe('running');
  expect(r.kunai).toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('螺旋丸：右手出現螺旋丸，撞碎前方的列車', async ({ page }) => {
  const errors = await startRun(page);
  await grant(page, 'rasengan');
  await page.waitForFunction(() => (window as unknown as Win).__game.run.power.rasengan > 0, null, WAIT);
  // 先擺列車再截圖：截圖很慢，期間螺旋丸的 3 秒可能就過了，之後才擺列車會直接撞死
  const id = await place(page, 'train', 8, 20);
  await page.screenshot({ path: 'e2e/screenshots/move-rasengan.png', timeout: 240_000 });
  await waitGone(page, id);
  expect((await run(page)).status).toBe('running');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('替身木頭：擋下一次正面撞擊', async ({ page }) => {
  const errors = await startRun(page);
  await grant(page, 'sub');
  await page.waitForFunction(() => (window as unknown as Win).__game.run.subs === 1, null, WAIT);
  await place(page, 'block', 5);
  await page.waitForFunction(() => (window as unknown as Win).__game.run.subs === 0, null, WAIT);
  await page.screenshot({ path: 'e2e/screenshots/move-sub.png', timeout: 240_000 });
  expect((await run(page)).status).toBe('running');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('影分身：一個分身擋下擋牆，剩一個', async ({ page }) => {
  const errors = await startRun(page);
  await grant(page, 'clones');
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__game.run;
    return r.power.clones > 0 && r.clonesLeft === 2;
  }, null, WAIT);
  await place(page, 'block', 6);
  await page.waitForFunction(() => (window as unknown as Win).__game.run.clonesLeft === 1, null, WAIT);
  await page.screenshot({ path: 'e2e/screenshots/move-clones.png', timeout: 240_000 });
  expect((await run(page)).status).toBe('running');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('瞬身術：從左線同方向連按兩下 → 瞬間到右線', async ({ page }) => {
  const errors = await startRun(page);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => {
    const p = (window as unknown as Win).__game.run.player;
    return p.lane === -1 && p.laneT >= 1;
  }, null, WAIT);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__game.run;
    return r.player.lane === 1 && r.flickerCooldown > 0;
  }, null, WAIT);
  await page.screenshot({ path: 'e2e/screenshots/move-flicker.png', timeout: 240_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('查克拉攀牆：正面撞上列車時直接跑上車頂', async ({ page }) => {
  const errors = await startRun(page);
  await grant(page, 'chakra');
  await page.waitForFunction(() => (window as unknown as Win).__game.run.power.chakra > 0, null, WAIT);
  await place(page, 'train', 8, 20);
  await page.waitForFunction(() => (window as unknown as Win).__game.run.player.y > 3.0, null, WAIT);
  await page.screenshot({ path: 'e2e/screenshots/move-climb.png', timeout: 240_000 });
  expect((await run(page)).status).toBe('running');
  expect(errors, errors.join('\n')).toEqual([]);
});
