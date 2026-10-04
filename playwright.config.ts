/// <reference types="node" />
import { defineConfig } from '@playwright/test';

// e2e 設定：預設對 build 後的產物（vite preview）跑
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  // headless 用軟體 WebGL（SwiftShader）很吃 CPU，平行跑會互相拖慢到逾時，所以一次只跑一個
  workers: 1,
  outputDir: 'test-results',
  use: {
    // 設定 BASE_URL 可以改測其他網址（例如 dev server 或 GitHub Pages），此時不啟動本機 preview；
    // 結尾要有斜線，測試裡用 './?xxx' 這種相對路徑才不會跳到網域根目錄
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173/',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // headless 需要軟體 WebGL；自動播放政策放寬，讓 AudioContext 不必等手勢
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
