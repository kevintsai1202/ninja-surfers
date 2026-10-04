// 角色模型截圖：伊魯卡、暗部、忍犬、蛤蟆（騎乘）、卷軸滑板（衝浪），輸出到 e2e/screenshots/model-*.png
// 用法：node scripts/shot-models.mjs（dev server 要在 5173）
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://localhost:5173/';
const shots = [
  ['iruka-three', 'model=iruka&view=three&phase=0.25'],
  ['anbu-three', 'model=anbu&view=three&phase=0.25'],
  ['anbu-back', 'model=anbu&view=back&phase=0.25'],
  ['dog-side', 'model=dog&view=three&phase=0.3'],
  ['toad-three', 'model=toad&view=three&phase=0.5'],
  ['board-three', 'model=board&view=three&phase=0.25'],
];
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
for (const [name, q] of shots) {
  await page.goto(`${base}?pose=1&${q}`);
  await page.waitForFunction(() => window.__poseReady === true, null, { timeout: 180000 });
  await page.screenshot({ path: `e2e/screenshots/model-${name}.png`, timeout: 240000 });
  console.log('ok', name);
}
await browser.close();
