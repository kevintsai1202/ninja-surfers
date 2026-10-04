# 參考圖提示詞（muse image）

每張 US$0.01，輸出到 `generated-images/`（不進版控），挑中的用 `python scripts/concept-images.py` 轉存到這個資料夾。

提示詞描述外觀特徵、不寫角色名（圖像模型遇到作品名容易拒絕或走樣）；全身圖都以 `ninja-sheet-a.jpg` 當風格參考（`edit_image`），讓四個角色的 Q 版比例、打光、三視圖排版一致。

## 第二版：多角色（2026-10-04）

### 全身三視圖

共用開頭：

> Create a NEW character turnaround sheet in exactly the same style as the reference image: same high-quality stylized 3D chibi render, same body proportions and big head size, same layout (front view, side view facing right, back view), same light gray background and soft studio lighting. Do NOT copy the reference character's hair, colors or outfit.

| 檔案 | 角色描述（接在共用開頭後面） | 挑選 |
| --- | --- | --- |
| `sasuke-sheet.jpg` | cool, serious ninja boy；spiky black hair with a deep blue sheen（長側瀏海、後腦往上往後翹）；dark eyes, slightly frowning；dark blue headband with a silver leaf-swirl plate；dark navy short-sleeved shirt with a tall stiff high collar；red-and-white round paper-fan crest on the upper back；white knee-length shorts；light gray arm warmers；right-thigh bandage and tool pouch；blue sandals；finely sculpted detailed 3D face | 2 張挑第 2 張（高領、扇紋、皺眉最像） |
| `sakura-sheet.jpg` | cheerful, determined ninja girl；shoulder-length straight pink hair, bangs parted to show a wide forehead；jade-green eyes；red sleeveless qipao-style top（立領、前拉鍊、兩側開衩成前後片）、white circle emblem on the back；light olive-green shorts；thigh tool pouch；blue sandals | 第一輪把護額戴在額頭、還誤抄了鬍鬚紋；用第一輪第 2 張再修一次：「護額往上移，像髮箍戴在頭頂，露出寬額頭，不要鬍鬚紋」，挑修正後第 1 張 |
| `kakashi-sheet.jpg` | laid-back adult ninja（仍是 Q 版比例、略高）；spiky silver-white hair leaning to one side；dark navy face mask over nose, mouth and neck；headband tilted to cover his left eye, sleepy right eye；green multi-pocket flak vest over a navy long-sleeved shirt with red swirl patches on the sleeves；navy pants；shin wraps；fingerless gloves with metal plates；thigh pouch；blue sandals | 2 張挑第 1 張（第 2 張護額沒有遮眼） |

### 臉部特寫（為了細緻的 3D 臉型）

以各自挑中的全身圖當參考：

> Head and face close-up model sheet of this exact same ⟨角色⟩, for 3D modeling reference: three head views side by side — front view, three-quarter view, side profile — same high-quality stylized 3D render style, light gray background, soft even studio lighting. Show the finely sculpted 3D face clearly: ⟨眼睛顏色⟩ eyes with modeled eyeballs, iris, pupil and highlights, upper eyelids with thick dark lash lines, eyebrows, small nose bridge and tip, mouth with lips, cheeks, chin, ears …

| 檔案 | 臉部重點 |
| --- | --- |
| `naruto-face.jpg` | 藍眼、咧嘴笑、兩頰各三條鬍鬚紋 |
| `sasuke-face.jpg` | 深灰黑眼、下眼線、皺眉、緊閉的小嘴、尖下巴、高領 |
| `sakura-face.jpg` | 翠綠大眼、睫毛、寬額頭、腮紅、微笑 |
| `kakashi-face.jpg` | 面罩包住鼻子到脖子（看得出鼻樑）、護額斜遮左眼、右眼半閉的睏眼 |
