/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';

/**
 * 多角色 e2e：標題畫面 ◀ ▶ 選角、距離解鎖、chars=all 預覽，以及每個角色的通靈獸坐騎與招牌忍術截圖。
 * 用法（對 dev server）：$env:BASE_URL='http://localhost:5173/'; npx playwright test e2e/chars.spec.ts
 * 截圖輸出到 e2e/screenshots/char-*.png。
 */

test.describe.configure({ timeout: 900_000 });

/** 遊戲除錯鉤子（只列這裡用到的） */
interface Hook {
  mode: string;
  character: string;
  preview: string;
  save: { character: string; bestDist: number };
  run: { power: Record<string, number> };
  grant(kind: string, dz?: number): void;
  home(): void;
}

/** 頁面裡的 window（帶除錯鉤子） */
type Win = { __game: Hook };

/** 等待條件的逾時（軟體渲染很慢） */
const WAIT = { timeout: 120_000 };

/** 開頁並等遊戲載入完成（擋掉 Vite 熱重載的 WebSocket）；回傳收集頁面錯誤的陣列 */
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(`./?${query}`);
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  return errors;
}

test('選角：鎖住的角色看得到但不能開始；存檔跑過 1,200 m 就能選佐助', async ({ page }) => {
  const errors = await open(page, 'mute=1&seed=7&intro=0&gen=0&dtcap=0.15');
  const name = page.locator('.title-screen .char-name');
  const lock = page.locator('.title-screen .char-lock');
  const start = page.locator('.title-screen .start');
  await expect(name).toHaveText('鳴人');
  await expect(lock).toBeHidden();
  await expect(start).toBeEnabled();
  // 下一個：佐助（還沒解鎖）
  await page.locator('.title-screen .char-next').click();
  await expect(name).toHaveText('佐助');
  await expect(lock).toContainText('1,000 m');
  await expect(start).toBeDisabled();
  await page.waitForFunction(() => (window as unknown as Win).__game.character === 'sasuke', null, WAIT);
  // 鎖住的不寫進存檔
  expect(await page.evaluate(() => (window as unknown as Win).__game.save.character)).toBe('naruto');
  // 往回一個是卡卡西（循環）
  await page.locator('.title-screen .char-prev').click();
  await page.locator('.title-screen .char-prev').click();
  await expect(name).toHaveText('卡卡西');
  await expect(lock).toContainText('3,000 m');

  // 存檔裡的單局最遠距離 1,200 m：佐助解鎖
  await page.evaluate(() => localStorage.setItem('ninja-surfers-save', JSON.stringify({ bestDist: 1200 })));
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __gameReady?: boolean }).__gameReady === true, null, { timeout: 300_000 });
  await page.locator('.title-screen .char-next').click();
  await expect(name).toHaveText('佐助');
  await expect(lock).toBeHidden();
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as Win).__game.save.character)).toBe('sasuke');
  await start.click();
  await page.waitForFunction(() => (window as unknown as Win).__game.mode === 'run', null, WAIT);
  expect(await page.evaluate(() => (window as unknown as Win).__game.character)).toBe('sasuke');
  await page.screenshot({ path: 'e2e/screenshots/char-sasuke-run.png', timeout: 240_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('chars=all：每個角色騎自己的通靈獸、用自己的招牌忍術（截圖），而且不寫進存檔', async ({ page }) => {
  // 每局會用掉一個通靈卷軸（預設存檔只有 2 個），四個角色都要騎：先給 9 個
  await page.addInitScript(() => localStorage.setItem('ninja-surfers-save', JSON.stringify({ boards: 9 })));
  const errors = await open(page, 'mute=1&seed=7&intro=0&gen=0&dtcap=0.15&chars=all');
  for (const [i, id] of ['naruto', 'sasuke', 'sakura', 'kakashi'].entries()) {
    if (i > 0) await page.locator('.title-screen .char-next').click();
    await page.waitForFunction((want) => (window as unknown as Win).__game.preview === want, id, WAIT);
    await page.locator('.title-screen .start').click();
    await page.waitForFunction(() => (window as unknown as Win).__game.mode === 'run', null, WAIT);
    // 通靈獸坐騎（Space）
    await page.keyboard.press('Space');
    await page.waitForFunction(() => (window as unknown as Win).__game.run.power.board > 0, null, WAIT);
    await page.screenshot({ path: `e2e/screenshots/char-${id}-mount.png`, timeout: 240_000 });
    // 招牌忍術（螺旋丸道具）
    await page.evaluate(() => (window as unknown as Win).__game.grant('rasengan', 0.3));
    await page.waitForFunction(() => (window as unknown as Win).__game.run.power.rasengan > 0, null, WAIT);
    await page.screenshot({ path: `e2e/screenshots/char-${id}-jutsu.png`, timeout: 240_000 });
    expect(await page.evaluate(() => (window as unknown as Win).__game.character)).toBe(id);
    await page.evaluate(() => (window as unknown as Win).__game.home());
    await page.waitForFunction(() => (window as unknown as Win).__game.mode === 'title', null, WAIT);
  }
  // 預覽模式不改存檔選的角色
  expect(await page.evaluate(() => (window as unknown as Win).__game.save.character)).toBe('naruto');
  expect(errors, errors.join('\n')).toEqual([]);
});
