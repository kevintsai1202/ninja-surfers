# 全套 e2e（PowerShell 7）：先建置再對 vite preview 跑（沒有熱重載，截圖穩定），結果寫到 logs/e2e-all.log。
# 用法：pwsh scripts/e2e-all.ps1
# 內容：跑姿截圖、木葉村場景預覽、遊戲流程（含三場景遊玩截圖與音效）、道具畫面、第二版新招式（moves）、手機模擬（mobile）、多角色（chars），再補森林與峽谷的場景預覽。
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force logs | Out-Null
$log = 'logs/e2e-all.log'
'' | Set-Content $log

# 場景預覽只截遊戲鏡頭（其他鏡頭是除錯用）
$env:SCENE_CAMS = 'game'
Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue

# 第一輪：全部 spec（webServer 會先 npm run build 再 vite preview）
npx playwright test --reporter=line 2>&1 | Tee-Object -FilePath $log -Append
$failed = $LASTEXITCODE

# 補森林與峽谷的場景預覽
foreach ($id in 'forest', 'valley') {
  $env:SCENE_ID = $id
  npx playwright test e2e/scene.spec.ts --reporter=line 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { $failed = $LASTEXITCODE }
}
Remove-Item Env:SCENE_ID -ErrorAction SilentlyContinue
Remove-Item Env:SCENE_CAMS -ErrorAction SilentlyContinue
exit $failed
