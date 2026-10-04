/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';

/**
 * 道具畫面 e2e：自動駕駛代玩，用除錯鉤子在主角前方放道具，撿到後截圖（騎蛤蟆、影分身、萬象天引、查克拉附著、卷軸滑板）。
 * 用法（對 dev server）：$env:BASE_URL='http://localhost:5173/'; npx playwright test e2e/powers.spec.ts
 * 截圖輸出到 e2e/screenshots/power-*.png。
 */

test.describe.configure({ timeout: 420_000 });

/** 遊戲除錯鉤子（只列這裡用到的） */
interface Hook {
  mode: string;
  run: { power: Record<string, number>; status: string; boards: number };
  grant(kind: string, dz?: number): void;
}

/** 開一局（自動駕駛、跳過開場）並等到開始奔跑 */
async function startRun(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 擋掉 Vite 熱重載的 WebSocket（對 dev server 跑時，有人改檔不會整頁重載）
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('./?mute=1&seed=33&auto=1&intro=0');
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  await page.locator('.title-screen .start').click();
  await page.waitForFunction(() => (window as unknown as { __game: Hook }).__game.mode === 'run', null, { timeout: 120_000 });
  return errors;
}

for (const kind of ['toad', 'clones', 'magnet', 'chakra'] as const) {
  test(`道具畫面：${kind}`, async ({ page }) => {
    const errors = await startRun(page);
    await page.evaluate((k) => (window as unknown as { __game: Hook }).__game.grant(k, 0.3), kind);
    // 等到能力生效（軟體渲染很慢，給足時間）
    await page.waitForFunction((k) => (window as unknown as { __game: Hook }).__game.run.power[k] > 0, kind, { timeout: 120_000 });
    await page.waitForTimeout(kind === 'toad' ? 2500 : 1200);
    await page.screenshot({ path: `e2e/screenshots/power-${kind}.png`, timeout: 240_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('道具畫面：卷軸滑板（Space 啟動）', async ({ page }) => {
  const errors = await startRun(page);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as unknown as { __game: Hook }).__game.run.power.board > 0, null, { timeout: 120_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/power-board.png', timeout: 240_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
