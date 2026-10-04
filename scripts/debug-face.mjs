// 除錯用：開臉部特寫視角，印出鏡頭與角色頭部的世界座標（找出特寫畫面為何空白）
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?pose=1&view=face&anim=idle');
await page.waitForFunction(() => window.__poseReady === true, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const s = window.__stage; const r = window.__rig;
  const c = s.camera; const p = c.position; const d = c.getWorldDirection(new c.position.constructor());
  const hp = r.head.getWorldPosition(new c.position.constructor());
  return JSON.stringify({ cam: [p.x, p.y, p.z], dir: [d.x, d.y, d.z], head: [hp.x, hp.y, hp.z], fov: c.fov, aspect: c.aspect });
}));
await page.screenshot({ path: 'e2e/screenshots/debug-face.png' });
await browser.close();
