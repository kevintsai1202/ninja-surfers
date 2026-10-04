// 角色模型截圖（姿勢檢視模式 ?pose=1），輸出到 e2e/screenshots/model-*.png
// 用法（dev server 要在 5173）：
//   node scripts/shot-models.mjs                  第一版：伊魯卡、暗部、忍犬、蛤蟆、卷軸滑板
//   node scripts/shot-models.mjs faces ninja sasuke   指定角色的頭部特寫（正面、四分之三、側面）＋全身斜前方與背面
//   node scripts/shot-models.mjs mounts sasuke        指定角色騎著通靈獸坐騎（側面、斜前方、遊戲鏡頭）
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:5173/';
const [group, ...models] = process.argv.slice(2);

/** 要截的畫面：[檔名, 網址參數] */
let shots;
if (group === 'faces') {
  // 每個角色：頭部三視角（idle 站姿）＋全身斜前方、背面（跑姿相位 0.25）
  shots = (models.length ? models : ['ninja']).flatMap((m) => [
    [`${m}-facefront`, `model=${m}&view=facefront&anim=idle`],
    [`${m}-face3q`, `model=${m}&view=face3q&anim=idle`],
    [`${m}-faceside`, `model=${m}&view=faceside&anim=idle`],
    [`${m}-three`, `model=${m}&view=three&phase=0.25`],
    [`${m}-back`, `model=${m}&view=back&phase=0.25`],
  ]);
} else if (group === 'mounts') {
  // 每個角色騎著自己的通靈獸坐騎：側面、斜前方、遊戲鏡頭
  shots = (models.length ? models : ['naruto', 'sasuke', 'sakura', 'kakashi']).flatMap((m) => [
    [`${m}-mount-side`, `model=${m}&mount=1&view=side&phase=0.25`],
    [`${m}-mount-three`, `model=${m}&mount=1&view=three&phase=0.25`],
    [`${m}-mount-game`, `model=${m}&mount=1&view=game&phase=0.25`],
  ]);
} else {
  shots = [
    ['iruka-three', 'model=iruka&view=three&phase=0.25'],
    ['anbu-three', 'model=anbu&view=three&phase=0.25'],
    ['anbu-back', 'model=anbu&view=back&phase=0.25'],
    ['dog-side', 'model=dog&view=three&phase=0.3'],
    ['toad-three', 'model=toad&view=three&phase=0.5'],
    ['board-three', 'model=board&view=three&phase=0.25'],
  ];
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
// 擋掉 Vite 熱重載的 WebSocket（有人改檔時不會整頁重載）
await page.routeWebSocket(/.*/, () => {});
for (const [name, q] of shots) {
  await page.goto(`${base}?pose=1&${q}`);
  await page.waitForFunction(() => window.__poseReady === true, null, { timeout: 180000 });
  await page.screenshot({ path: `e2e/screenshots/model-${name}.png`, timeout: 240000 });
  // 印出這個畫面的 draw call 與三角形數（角色模型的效能預算）
  const stats = await page.evaluate(() => window.__poseStats);
  console.log('ok', name, JSON.stringify(stats));
}
await browser.close();
