/// <reference types="node" />
import { test, expect, devices } from '@playwright/test';

/**
 * 手機 e2e：模擬 Pixel 7（觸控、手機 UA），而且「不」放寬自動播放政策——照真實手機的規則，
 * 必須在使用者手勢裡才能出聲。驗證：
 * 1. 用觸控點「開始」後量得到聲音（AnalyserNode RMS > 0）。
 * 2. 點一下畫面擲出手裏劍；持有起爆符苦無時，點「爆」按鈕擲出。
 * 用法：$env:BASE_URL='http://localhost:5173/'; npx playwright test e2e/mobile.spec.ts
 * （iPhone 的響鈴／靜音鍵只能在實機確認。）
 */

const pixel = devices['Pixel 7'];
test.use({
  viewport: pixel.viewport,
  userAgent: pixel.userAgent,
  deviceScaleFactor: pixel.deviceScaleFactor,
  isMobile: pixel.isMobile,
  hasTouch: pixel.hasTouch,
  // 不加 --autoplay-policy=no-user-gesture-required：要和真的手機一樣需要手勢
  launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
});
test.describe.configure({ timeout: 420_000 });

/** 遊戲除錯鉤子（只列這裡用到的） */
interface Hook {
  mode: string;
  run: { shuriken: number; kunai: number; obstacles: unknown[] };
  audioLevel(): number;
  grant(kind: string, dz?: number): void;
}

/** 開頁並等遊戲載入（擋掉 Vite 熱重載的 WebSocket） */
async function open(page: import('@playwright/test').Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(`./?${query}`);
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  return errors;
}

test('手機：觸控點「開始」後有聲音（需要手勢的自動播放政策）', async ({ page }) => {
  const errors = await open(page, 'seed=5&intro=0&gen=0&dtcap=0.15');
  await page.locator('.title-screen .start').tap();
  let peak = 0;
  for (let i = 0; i < 75 && peak <= 0.001; i++) {
    await page.waitForTimeout(200);
    peak = Math.max(peak, await page.evaluate(() => (window as unknown as { __game: Hook }).__game.audioLevel()));
  }
  expect(errors, errors.join('\n')).toEqual([]);
  expect(peak).toBeGreaterThan(0.001);
});

test('手機：點一下畫面擲手裏劍、點「爆」按鈕擲起爆符苦無', async ({ page }) => {
  const errors = await open(page, 'seed=5&intro=0&mute=1&gen=0&dtcap=0.15');
  await page.locator('.title-screen .start').tap();
  await page.waitForFunction(() => (window as unknown as { __game: Hook }).__game.mode === 'run', null, { timeout: 120_000 });
  const before = await page.evaluate(() => (window as unknown as { __game: Hook }).__game.run.shuriken);
  // 點畫面中央（遊戲畫布）＝擲手裏劍
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(vp.width / 2, vp.height * 0.6);
  await page.waitForFunction((b) => (window as unknown as { __game: Hook }).__game.run.shuriken === b - 1, before, { timeout: 60_000 });
  // 給一支起爆符苦無，等「爆」按鈕出現後點下去
  await page.evaluate(() => (window as unknown as { __game: Hook }).__game.grant('kunai', 0.3));
  await page.waitForFunction(() => (window as unknown as { __game: Hook }).__game.run.kunai > 0, null, { timeout: 60_000 });
  const btn = page.locator('.kunai-btn');
  await expect(btn).toBeVisible();
  await btn.tap();
  await page.waitForFunction(() => (window as unknown as { __game: Hook }).__game.run.kunai === 0, null, { timeout: 60_000 });
  await page.screenshot({ path: 'e2e/screenshots/mobile-run.png', timeout: 240_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
