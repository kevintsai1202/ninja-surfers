/// <reference types="node" />
import { test } from '@playwright/test';

/**
 * 跑姿截圖驗收：開姿勢檢視模式（?pose=1），各視角、各相位截一張圖到 e2e/screenshots/。
 * 用法（對 dev server）：$env:BASE_URL='http://localhost:5173/'; npx playwright test e2e/pose.spec.ts
 * 環境變數：
 * - POSE_ANIM：換動作（預設 run），例如 roll、jump、surf
 * - POSE_EXTRA：額外網址參數（例如 outline=0），檔名會加上 -extra 後綴
 * - POSE_SHOTS：只截部分畫面（逗號分隔，例如 side-25,face）
 */
const anim = process.env.POSE_ANIM ?? 'run';
const extra = process.env.POSE_EXTRA ?? '';
const only = process.env.POSE_SHOTS?.split(',');

/** 要截的畫面：檔名與網址參數 */
const shots: { name: string; query: string }[] = [
  { name: 'side-0', query: 'view=side&phase=0' },
  { name: 'side-25', query: 'view=side&phase=0.25' },
  { name: 'side-50', query: 'view=side&phase=0.5' },
  { name: 'side-75', query: 'view=side&phase=0.75' },
  { name: 'back', query: 'view=back&phase=0.25' },
  { name: 'three', query: 'view=three&phase=0.25' },
  { name: 'front', query: 'view=front&phase=0.25' },
  { name: 'game', query: 'view=game&phase=0.25' },
  { name: 'face', query: 'view=face&anim=idle' },
];

for (const s of shots.filter((x) => !only || only.includes(x.name))) {
  test(`跑姿截圖 ${anim} ${s.name} ${extra}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // 畫面自己指定 anim（例如臉部特寫用 idle）時，以畫面的為準
    const animPart = s.query.includes('anim=') ? '' : `anim=${anim}&`;
    const query = `./?pose=1&${animPart}${s.query}${extra ? `&${extra}` : ''}`;
    // 擋掉 Vite 熱重載的 WebSocket（對 dev server 跑時，有人改檔不會整頁重載）
    await page.routeWebSocket(/.*/, () => {});
    await page.goto(query);
    await page.waitForFunction(() => (window as unknown as { __poseReady?: boolean }).__poseReady === true);
    const suffix = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '')}` : '';
    await page.screenshot({ path: `e2e/screenshots/pose-${anim}-${s.name}${suffix}.png`, timeout: 240_000 });
    if (errors.length) throw new Error(errors.join('\n'));
  });
}
