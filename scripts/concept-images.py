"""
把 muse image 生成的參考圖整理進 docs/concept/（轉成 JPEG 縮小體積，供設計比對用）。
用法：python scripts/concept-images.py
來源：generated-images/（muse image MCP 的輸出資料夾，不進版控）；提示詞記錄在 docs/concept/prompts.md
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "generated-images"
DST = ROOT / "docs" / "concept"

# 來源檔名前綴 → 輸出檔名（同前綴有多張時依序加 -a、-b）
MAPPING = {
    "ref-ninja-sheet": "ninja-sheet",
    "ref-scene-village": "scene-village",
    "ref-scene-forest": "scene-forest",
    "ref-scene-valley": "scene-valley",
}

# 第二版多角色：同一個提示詞生成好幾張，只收挑中的那一張（輸出檔名 → 來源檔名）
PICKS = {
    "sasuke-sheet": "ref-sasuke-sheet-20261004-225429-2.png",
    "sakura-sheet": "ref-sakura-sheet-v2-20261004-225634-1.png",
    "kakashi-sheet": "ref-kakashi-sheet-20261004-225541-1.png",
    "naruto-face": "ref-naruto-face-20261004-225713-1.png",
    "sasuke-face": "ref-sasuke-face-20261004-225730-1.png",
    "sakura-face": "ref-sakura-face-20261004-225756-1.png",
    "kakashi-face": "ref-kakashi-face-20261004-225821-1.png",
}


def convert(src: Path, out: Path) -> None:
    """轉存成品質 88 的 JPEG 並印出大小。"""
    Image.open(src).convert("RGB").save(out, "JPEG", quality=88, optimize=True)
    print(f"{src.name} -> {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


def main() -> None:
    """依前綴找出參考圖，再處理挑選過的單張參考圖；來源不存在就跳過（generated-images 不進版控）。"""
    DST.mkdir(parents=True, exist_ok=True)
    for prefix, name in MAPPING.items():
        files = sorted(SRC.glob(f"{prefix}-*.png"))
        for i, f in enumerate(files):
            suffix = f"-{chr(ord('a') + i)}" if len(files) > 1 else ""
            convert(f, DST / f"{name}{suffix}.jpg")
    for name, file in PICKS.items():
        src = SRC / file
        if src.exists():
            convert(src, DST / f"{name}.jpg")
        else:
            print(f"略過（找不到來源）：{file}")


if __name__ == "__main__":
    main()
