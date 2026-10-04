"""
把 muse image 生成的遠景畫處理成遊戲用的遠景貼圖：
- 上緣漸層透明（融入程式畫的天空球），左右兩側淡出；下緣保持不透明（接地平線的霧）。
- 輸出帶透明度的 WebP 到 src/render/biomes/<id>/backdrop.webp。
- 印出畫面上緣與地平線附近的平均色，給場景的 atmosphere（skyTop／skyHorizon／fog）參考。
用法：python scripts/backdrops.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "generated-images"

# 場景 → (來源檔名, 上緣透明漸層結束的高度比例；0 表示上緣不透明)
CHOICES = {
    "village": ("backdrop-village-20261003-205212-1.png", 0.30),
    "forest": ("backdrop-forest-20261003-205245-1.png", 0.0),
    "valley": ("backdrop-valley-20261003-205321-2.png", 0.22),
}
# 左右淡出的寬度比例
SIDE_FADE = 0.06


def smoothstep(e0: float, e1: float, x: float) -> float:
    """平滑的 0→1 過渡（與 GLSL 的 smoothstep 相同）。"""
    if e1 <= e0:
        return 1.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def avg_color(img: Image.Image, y0: float, y1: float) -> str:
    """回傳圖片中 y0～y1（高度比例）水平帶的平均色（十六進位字串）。"""
    w, h = img.size
    band = img.crop((0, int(h * y0), w, max(int(h * y0) + 1, int(h * y1)))).resize((1, 1), Image.Resampling.BOX)
    pixel = band.getpixel((0, 0))
    assert isinstance(pixel, tuple)
    r, g, b = pixel[:3]
    return f"0x{r:02x}{g:02x}{b:02x}"


def process(scene: str, filename: str, top_fade: float) -> None:
    """處理一張遠景畫並輸出 WebP。"""
    src = Image.open(SRC / filename).convert("RGB")
    w, h = src.size
    alpha = Image.new("L", (w, h), 255)
    px = alpha.load()
    assert px is not None
    for y in range(h):
        ay = smoothstep(0.0, top_fade, y / h) if top_fade > 0 else 1.0
        for x in range(w):
            u = x / w
            ax = smoothstep(0.0, SIDE_FADE, u) * smoothstep(0.0, SIDE_FADE, 1 - u)
            px[x, y] = int(255 * ay * ax)
    out_img = src.copy()
    out_img.putalpha(alpha)
    out = ROOT / "src" / "render" / "biomes" / scene / "backdrop.webp"
    out_img.save(out, "WEBP", quality=82, method=6)
    print(
        f"{scene}: {out.relative_to(ROOT)} {w}x{h} {out.stat().st_size // 1024} KB | "
        f"上緣平均色 {avg_color(src, 0.0, 0.06)}，中上 {avg_color(src, 0.2, 0.3)}，"
        f"地平線帶 {avg_color(src, 0.78, 0.9)}，底部 {avg_color(src, 0.92, 1.0)}"
    )


def main() -> None:
    """處理所有場景的遠景畫。"""
    for scene, (filename, top_fade) in CHOICES.items():
        process(scene, filename, top_fade)


if __name__ == "__main__":
    main()
