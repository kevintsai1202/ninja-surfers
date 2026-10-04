/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';

/**
 * 遊戲流程 e2e：標題 → 開始 → 鍵盤操作 → 倒下 → 結算 → 存檔；並截三個場景的遊戲畫面。
 * 用法（對 dev server）：$env:BASE_URL='http://localhost:5173/'; npx playwright test e2e/game.spec.ts
 * 截圖輸出到 e2e/screenshots/game-*.png。
 */

test.describe.configure({ timeout: 420_000 });

/** 遊戲的除錯鉤子 */
interface GameHook {
  mode: string;
  run: { status: string; score: number; coins: number; player: { z: number; lane: number; x: number }; biome: string };
  save: { best: number; ryo: number; runs: number };
  start(): void;
  crash(): void;
  settle(): void;
  grant(kind: string, dz?: number): void;
  stats(): { drawCalls: number; triangles: number };
}

/** 等遊戲載入完成 */
async function ready(page: Page, query = ''): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 擋掉 Vite 熱重載的 WebSocket（對 dev server 跑時，有人改檔不會整頁重載）
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(`./?mute=1${query}`);
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  // 讓幾幀畫完
  await page.waitForTimeout(1500);
  expect(errors, errors.join('\n')).toEqual([]);
}

test('標題畫面：顯示 Logo 與開始按鈕，背景有自動跑的忍者', async ({ page }) => {
  await ready(page, '&seed=7');
  await expect(page.locator('.title-screen .start')).toBeVisible();
  await expect(page.locator('.logo-en')).toContainText('NINJA');
  const z = await page.evaluate(() => (window as unknown as { __game: GameHook }).__game.run.player.z);
  expect(z).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e/screenshots/game-title.png', timeout: 240_000 });
});

test('開始、鍵盤換線、倒下、結算並寫入存檔', async ({ page }) => {
  // dtcap：軟體渲染一幀要 1～2 秒，放寬每幀推進的遊戲時間，倒下動畫才不會等太久
  await ready(page, '&seed=11&dtcap=0.3');
  await page.locator('.title-screen .start').click();
  await page.waitForFunction(() => (window as unknown as { __game: GameHook }).__game.mode !== 'title');
  // 起跑後前 40 m 一定沒有障礙：馬上換線，不會被障礙干擾
  await page.keyboard.press('ArrowLeft');
  // 軟體渲染下一幀可能要好幾百毫秒：輪詢到車道真的換過去（按鍵要等下一幀才會被模擬取走）
  await page.waitForFunction(() => (window as unknown as { __game: GameHook }).__game.run.player.lane === -1, null, {
    timeout: 120_000,
  });
  await page.screenshot({ path: 'e2e/screenshots/game-run.png', timeout: 240_000 });
  // 強制撞擊，等結算畫面
  await page.evaluate(() => (window as unknown as { __game: GameHook }).__game.crash());
  await page.waitForFunction(() => (window as unknown as { __game: GameHook }).__game.mode === 'over', null, { timeout: 240_000 });
  await expect(page.locator('.over-screen')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/game-over.png', timeout: 240_000 });
  // 有兵糧丸時會先問要不要復活：按「不用了」
  const skip = page.locator('.over-screen .skip');
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.over-screen .retry')).toBeVisible();
  const save = await page.evaluate(() => (window as unknown as { __game: GameHook }).__game.save);
  expect(save.runs).toBeGreaterThanOrEqual(1);
  const stored = await page.evaluate(() => localStorage.getItem('ninja-surfers-save'));
  expect(stored).toContain('"runs"');
});

for (const [name, z] of [
  ['village', 120],
  ['forest', 720],
  ['valley', 1320],
] as const) {
  test(`自動駕駛代玩截圖：${name}`, async ({ page }) => {
    await ready(page, `&seed=21&auto=1&intro=0&z=${z}`);
    await page.locator('.title-screen .start').click();
    await page.waitForTimeout(6000);
    const st = await page.evaluate(() => {
      const g = (window as unknown as { __game: GameHook }).__game;
      return { biome: g.run.biome, status: g.run.status, stats: g.stats() };
    });
    expect(st.biome).toBe(name);
    console.log(name, JSON.stringify(st.stats));
    await page.screenshot({ path: `e2e/screenshots/game-${name}.png`, timeout: 240_000 });
  });
}

test('音效：開局後量得到聲音（AnalyserNode RMS > 0）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('./?seed=5&intro=0');
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  await page.locator('.title-screen .start').click();
  // 最多量 15 秒，量到聲音就停（軟體渲染開局的前幾幀很慢，音樂排程可能晚一點才開始）
  let peak = 0;
  for (let i = 0; i < 75 && peak <= 0.001; i++) {
    await page.waitForTimeout(200);
    const lv = await page.evaluate(() => (window as unknown as { __game: { audioLevel(): number } }).__game.audioLevel());
    peak = Math.max(peak, lv);
  }
  expect(errors, errors.join('\n')).toEqual([]);
  expect(peak).toBeGreaterThan(0.001);
});
