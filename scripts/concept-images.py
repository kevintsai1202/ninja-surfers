"""
把 muse image 生成的參考圖整理進 docs/concept/（轉成 JPEG 縮小體積，供設計比對用）。
用法：python scripts/concept-images.py
來源：generated-images/（muse image MCP 的輸出資料夾，不進版控）
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


def main() -> None:
    """依前綴找出參考圖，轉存成品質 88 的 JPEG。"""
    DST.mkdir(parents=True, exist_ok=True)
    for prefix, name in MAPPING.items():
        files = sorted(SRC.glob(f"{prefix}-*.png"))
        for i, f in enumerate(files):
            suffix = f"-{chr(ord('a') + i)}" if len(files) > 1 else ""
            out = DST / f"{name}{suffix}.jpg"
            Image.open(f).convert("RGB").save(out, "JPEG", quality=88, optimize=True)
            print(f"{f.name} -> {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
