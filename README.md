# Ninja Surfers 忍者跑酷

致敬《地鐵跑酷》（Subway Surfers）、加入火影忍者元素的 3D 無盡跑酷網頁遊戲。電腦用鍵盤、手機用滑動操作，打開網頁就能玩。

**線上遊玩：<https://kevintsai1202.github.io/ninja-surfers/>**

> 個人非商業的同人作品。《火影忍者》《地鐵跑酷》及相關名稱、角色屬於各自的權利人；本作的角色、場景、音樂、音效都是程式產生或 AI 生成的原創素材，只求風格雷同。

## 玩法

在刻臉岩壁上塗鴉被發現了，一路被伊魯卡老師追，跑到 1800 m 之後換暗部追。三條車道自動往前跑，越跑越快：

| 動作 | 鍵盤 | 手機 |
| --- | --- | --- |
| 換線 | ← →、A D | 左右滑 |
| 跳 | ↑、W | 上滑 |
| 滾（空中＝急降） | ↓、S | 下滑 |
| 手裏劍 | F | 點一下畫面 |
| 起爆符苦無 | G | 右下角「爆」按鈕（持有時出現） |
| 瞬身術 | 同方向快按兩下 | 同方向快滑兩下 |
| 通靈卷軸滑板 | Space | 右下角「板」按鈕 |
| 暫停 | Esc、P | 左上角按鈕 |

- 正面撞上障礙就倒下；換線時側面擦撞會踉蹌，追捕者追上來，短時間內再踉蹌一次就被抓。
- 列車可以從斜坡跑上車頂。場景每 600 m 輪替：木葉村 → 死亡森林 → 終末之谷。
- 每局帶 3 支手裏劍：打碎同一車道前方第一個低欄、橫樑或擋牆（列車打不壞，會「鏘」一聲彈開）。
- 瞬身術：0.25 秒內往同一個方向換線兩次，瞬間移到那個方向最遠、而且沒被擋住的車道（冷卻 1.2 秒）。

| 道具 | 效果 |
| --- | --- |
| 兩 | 貨幣，存進總額 |
| 通靈術・巨蛤蟆（蛙） | 騎蛤蟆在空中大跳，期間無敵，空中有一串串的兩 |
| 查克拉附著（查） | 跳得更高，一跳上車頂；正面撞上列車或擋牆時沿著牆面直接跑上去 |
| 萬象天引（引） | 把附近的兩全部吸過來 |
| 多重影分身（影） | 分數 ×2，分身幫忙撿旁邊車道的兩；每個分身擋一次低欄、橫樑或擋牆（共 2 次，列車擋不住） |
| 手裏劍（劍） | 手裏劍 +3（最多 9 支） |
| 起爆符苦無（爆） | 最多 2 支；炸掉同一車道前方 30 m 內的所有障礙，連列車都炸得掉 |
| 螺旋丸（螺） | 3 秒衝刺（速度 ×1.35），撞到什麼都撞碎，期間無敵 |
| 替身木頭（替） | 最多 1 個；擋下一次倒下或被抓，原地留下一根木頭 |
| 通靈卷軸滑板（板） | 庫存道具；撞到一次不死（卷軸碎掉） |
| 秘傳卷軸（秘） | 隨機獎勵：兩、卷軸滑板、兵糧丸 |
| 兵糧丸（丸） | 倒下後可以復活（1、2、4…顆） |

正面撞擊的處理順序：螺旋丸撞碎 → 查克拉攀牆 → 影分身擋下 → 卷軸滑板 → 替身木頭 → 倒下。被抓只有替身木頭救得了。

iPhone：遊戲會把網頁音訊設成「媒體播放」（iOS 16.4 起支援；更舊的 iOS 改用無聲音軌切換），所以響鈴／靜音鍵開在靜音時也應該有聲音；還是沒聲音的話，先調高媒體音量，再點一下畫面。

## 開發

需要 Node.js 24。以下指令用 PowerShell 7：

```powershell
npm install
npm run dev          # 開發伺服器（--host，手機連同一個 Wi-Fi 也能開）
npm test             # 單元測試（模擬層、生成器公平性、存檔、手勢、音樂理論）
npm run build        # 型別檢查＋建置到 dist/
npm run e2e          # Playwright e2e（先 build 再對 vite preview 跑；需要本機 Chromium）
```

對開著的 dev server 跑 e2e 或截圖：

```powershell
$env:BASE_URL = 'http://localhost:5173/'
npx playwright test e2e/game.spec.ts     # 遊戲流程與三個場景截圖
npx playwright test e2e/pose.spec.ts     # 忍者跑姿截圖
npx playwright test e2e/moves.spec.ts    # 第二版新招式（手裏劍、苦無、螺旋丸、替身、影分身、瞬身、攀牆）
npx playwright test e2e/mobile.spec.ts   # 手機模擬：觸控開始後有聲音、點畫面擲手裏劍、「爆」按鈕
$env:SCENE_ID = 'forest'; npx playwright test e2e/scene.spec.ts   # 場景預覽截圖
```

除錯用的網址參數：

| 參數 | 說明 |
| --- | --- |
| `?seed=123` | 固定關卡種子 |
| `?auto=1` | 自動駕駛代玩 |
| `?z=1300` | 從指定距離起跑（例如直接到終末之谷） |
| `?mute=1` | 靜音 |
| `?gen=0` | 不自動生成障礙（e2e 用除錯鉤子自己擺） |
| `?dtcap=0.15` | 每幀最多推進的遊戲秒數（軟體渲染很慢時放寬） |
| `?pose=1&model=ninja&view=side&phase=0.25` | 角色姿勢檢視（model：ninja／iruka／anbu／dog／toad／board） |
| `?scene=village&cam=game` | 場景預覽（cam：game／high／side／low／gate／far） |

## 架構

```text
src/
  config.ts            所有數值常數（判定與外觀共用）
  sim/                 純 TS 模擬（不依賴 three／DOM，可在 Node 測試）
    run.ts             一局的狀態與推進（子步 1/120 秒、掃掠判定）
    track.ts           關卡圖樣與生成（間距依速度）
    autopilot.ts       自動駕駛（展示模式、公平性測試）
    collision.ts player.ts chaser.ts powerups.ts biome.ts speed.ts save.ts rng.ts
  render/
    stage.ts           渲染器、光線、陰影、天空、霧
    curvedWorld.ts     地平線下彎（改寫 shader chunk）
    character/         高精細角色（主角、伊魯卡、暗部、忍犬、巨蛤蟆）與程式動畫
    biomes/            三個場景模組（village／forest／valley），介面見 biomes/types.ts
    world/             把模擬同步到畫面（場景段落、障礙、兩、道具、手裏劍與苦無）
    actors.ts fx.ts cameraRig.ts
  audio/               Web Audio 合成的和風音樂與音效（iosAudio.ts：iPhone 靜音鍵與解鎖處理）
  input/ ui/ game.ts
docs/design.md         設計文件；docs/concept/ 是 AI 生成的參考圖
```

## 素材

- 3D 模型、材質貼圖、音樂、音效：全部程式產生。
- 遠景畫（`src/render/biomes/*/backdrop.webp`）與 `docs/concept/` 參考圖：用 muse image 生成，`scripts/backdrops.py`、`scripts/concept-images.py` 處理。
