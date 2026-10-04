/// <reference types="node" />
import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

/**
 * 場景截圖驗收：開場景預覽模式（?scene=<id>），各鏡頭截一張圖，並把統計數字寫成 JSON。
 * 用法（對 dev server）：
 *   $env:BASE_URL='http://localhost:5173/'; $env:SCENE_ID='village'; npx playwright test e2e/scene.spec.ts
 * 輸出：e2e/screenshots/scene-<id>-<cam>.png、e2e/screenshots/scene-<id>-stats.json
 */
const id = process.env.SCENE_ID ?? 'village';
const cams = (process.env.SCENE_CAMS ?? 'game,high,side,low,gate,far').split(',');

test.describe.configure({ timeout: 300_000 });

for (const cam of cams) {
  test(`場景截圖 ${id} ${cam}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    // 擋掉 Vite 熱重載的 WebSocket：有人同時改檔時，整頁重載會讓截圖變白或逾時
    await page.routeWebSocket(/.*/, () => {});
    await page.goto(`./?scene=${id}&cam=${cam}&clean=1&freeze=1`);
    await page.waitForFunction(() => (window as unknown as { __sceneReady?: boolean }).__sceneReady === true, null, {
      timeout: 240_000,
    });
    mkdirSync('e2e/screenshots', { recursive: true });
    await page.screenshot({ path: `e2e/screenshots/scene-${id}-${cam}.png`, timeout: 240_000 });
    if (cam === cams[0]) {
      const stats = await page.evaluate(() => (window as unknown as { __sceneStats: unknown }).__sceneStats);
      writeFileSync(`e2e/screenshots/scene-${id}-stats.json`, JSON.stringify({ stats, errors }, null, 2));
    }
    if (errors.length) throw new Error(`頁面錯誤：\n${errors.join('\n')}`);
  });
}
