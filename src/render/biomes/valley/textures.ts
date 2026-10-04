import * as THREE from 'three';
import { seeded, tileFbm, tileNoise } from '../../proctex';

/**
 * 終末之谷專用的程式貼圖（canvas 繪製，全部原創、不讀外部圖檔）。
 * 顏色貼圖是 SRGBColorSpace；凹凸、法線、遮罩類保持 NoColorSpace。
 * 每個函式只產生一次（模組快取），場景模組建立時（createKit）一次預先產生，建段落時不再花時間。
 */

/** 建立 canvas 與 2D context */
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/**
 * 把 canvas 包成貼圖。
 * @param srgb 顏色貼圖用 true；遮罩、凹凸、法線用 false
 * @param repeat 是否可重複貼（RepeatWrapping）
 */
function toTex(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 0xRRGGBB → [r,g,b]（0..1） */
function rgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** 夾在 0..1 */
function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** GLSL 風格 smoothstep */
function sstep(e0: number, e1: number, x: number): number {
  const t = sat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 模組層快取：key → 貼圖 */
const cache = new Map<string, unknown>();

/** 依 key 只產生一次 */
function once<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

/** 岩石貼圖組：砂岩（岩壁）與花崗岩（障礙、石柱）共用同一張凹凸貼圖，層理位置一致 */
interface RockTextures {
  /** 暖橘砂岩顏色（岩壁、岸邊大石） */
  sand: THREE.CanvasTexture;
  /** 灰米色花崗岩顏色（倒塌石柱、石墩、踏腳石） */
  granite: THREE.CanvasTexture;
  /** 凹凸高度（灰階，NoColorSpace） */
  bump: THREE.CanvasTexture;
  /** 朝上表面用的顏色（沒有層理條紋，只有斑駁、顆粒、小坑與細裂紋）：砂岩版 */
  sandTop: THREE.CanvasTexture;
  /** 朝上表面用的顏色：花崗岩版 */
  graniteTop: THREE.CanvasTexture;
}

/**
 * 朝上表面的岩石顏色（256×256 無縫）：大塊斑駁＋細顆粒＋小坑＋幾道細裂紋，沒有層理條紋
 * （三軸投影的頂面如果用層理貼圖，會出現一條條平行線，看起來像人孔蓋）。
 */
function rockTop(pal: number[], seed: number): THREE.CanvasTexture {
  const W = 256;
  const big = tileFbm(W, W, 3, 3, seed);
  const mid = tileFbm(W, W, 10, 2, seed + 1);
  const fine = tileNoise(W, W, 64, seed + 2);
  const rnd = seeded(seed + 3);
  const crack = new Float32Array(W * W);
  for (let k = 0; k < 9; k++) {
    let x = rnd() * W;
    let y = rnd() * W;
    let a = rnd() * Math.PI * 2;
    const len = 20 + rnd() * 60;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.5;
      x += Math.cos(a);
      y += Math.sin(a);
      crack[((Math.floor(y) % W) + W) % W * W + (((Math.floor(x) % W) + W) % W)] = 1;
    }
  }
  const cols = pal.map(rgb01);
  const [c, g] = makeCanvas(W, W);
  const img = g.createImageData(W, W);
  for (let i = 0; i < W * W; i++) {
    // 兩種色調依大塊雜訊混合
    const t = sstep(0.35, 0.65, big[i]);
    const a = cols[0];
    const b = cols[1];
    const shade = (0.84 + 0.22 * mid[i]) * (0.92 + 0.14 * fine[i]) * (1 - 0.45 * crack[i]) * (fine[i] > 0.86 ? 0.82 : 1);
    const o = i * 4;
    img.data[o] = sat((a[0] * (1 - t) + b[0] * t) * shade) * 255;
    img.data[o + 1] = sat((a[1] * (1 - t) + b[1] * t) * shade) * 255;
    img.data[o + 2] = sat((a[2] * (1 - t) + b[2] * t) * shade) * 255;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, true);
}

/**
 * 岩石貼圖：水平層理（厚薄不一、被雜訊扭曲）、層間凹縫、垂直裂紋、風化水痕、細顆粒與小坑洞。
 * 512×512、四邊無縫，給三軸投影（triplanar）用。
 */
export function rockTextures(): RockTextures {
  return once('rock', () => {
    const W = 512;
    const H = 512;
    const seed = 41;
    const rnd = seeded(seed);
    const warp = tileFbm(W, H, 3, 4, seed);
    const grain = tileFbm(W, H, 28, 3, seed + 1);
    const big = tileFbm(W, H, 2, 3, seed + 2);
    // 垂直拉長的水痕：低解析度雜訊沿 y 放大 8 倍取樣
    const streakSrc = tileNoise(W, H / 8, 36, seed + 3);
    // 層理：9 層，厚度隨機，累加後正規化到 0..1
    const layers = 9;
    const thick = Array.from({ length: layers }, () => 0.6 + rnd() * 0.9);
    const sum = thick.reduce((a, b) => a + b, 0);
    const bounds: number[] = [0];
    for (let i = 0; i < layers; i++) bounds.push(bounds[i] + thick[i] / sum);
    const layerTone = Array.from({ length: layers }, () => rnd());
    const layerPal = Array.from({ length: layers }, () => Math.floor(rnd() * 4));
    // 裂紋：隨機漫步畫出的暗線（繞回邊界，保持無縫）
    const crack = new Float32Array(W * H);
    for (let k = 0; k < 22; k++) {
      let x = rnd() * W;
      let y = rnd() * H;
      const len = 30 + rnd() * 110;
      const width = rnd() < 0.3 ? 2 : 1;
      let dx = (rnd() - 0.5) * 0.6;
      for (let s = 0; s < len; s++) {
        dx += (rnd() - 0.5) * 0.35;
        dx = Math.max(-0.8, Math.min(0.8, dx));
        x += dx;
        y += 1;
        for (let w = 0; w < width; w++) {
          const xi = ((Math.floor(x) + w) % W + W) % W;
          const yi = ((Math.floor(y) % H) + H) % H;
          crack[yi * W + xi] = 1;
          // 裂紋旁邊一像素淡一點（柔邊）
          const xn = (xi + 1) % W;
          crack[yi * W + xn] = Math.max(crack[yi * W + xn], 0.35);
        }
      }
    }
    // 小坑洞
    const pits = new Float32Array(W * H);
    for (let k = 0; k < 900; k++) {
      const cx = Math.floor(rnd() * W);
      const cy = Math.floor(rnd() * H);
      const r = rnd() < 0.2 ? 2 : 1;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue;
          pits[((cy + oy + H) % H) * W + ((cx + ox + W) % W)] = 1;
        }
      }
    }
    // 兩組色盤：砂岩（暖橘、黃褐、赭紅、米黃）與花崗岩（灰米、暖灰）
    const sandPal = [0xcb8d5c, 0xbb7b4f, 0xd8a675, 0xab6d46].map(rgb01);
    const granPal = [0xc4bba9, 0xb3ab98, 0xd2cab7, 0xa59c8a].map(rgb01);
    const [cs, gs] = makeCanvas(W, H);
    const [cg, gg] = makeCanvas(W, H);
    const [cb, gb] = makeCanvas(W, H);
    const imS = gs.createImageData(W, H);
    const imG = gg.createImageData(W, H);
    const imB = gb.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(y / 8);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        // 層理位置（被 warp 扭曲，仍然無縫：warp 本身可重複，偏移量對整張是週期性的）
        let ly = y / H + (warp[i] - 0.5) * 0.09;
        ly -= Math.floor(ly);
        let li = 0;
        while (li < layers - 1 && ly >= bounds[li + 1]) li++;
        const f = (ly - bounds[li]) / (bounds[li + 1] - bounds[li]);
        // 層與層之間的凹縫
        const crev = f < 0.07 ? 1 - f / 0.07 : f > 0.95 ? (f - 0.95) / 0.05 : 0;
        // 每層是圓潤凸起的剖面（凹凸貼圖用）
        const prof = Math.sqrt(Math.max(0, Math.sin(Math.PI * f)));
        const streak = streakSrc[sy * W + x];
        const tone = 0.86 + 0.22 * layerTone[li];
        const shade =
          tone *
          (0.82 + 0.3 * grain[i]) *
          (0.9 + 0.2 * big[i]) *
          (1 - 0.22 * sstep(0.55, 0.85, streak)) *
          (1 - 0.42 * crev) *
          (1 - 0.55 * crack[i]) *
          (pits[i] ? 0.78 : 1);
        const ps = sandPal[layerPal[li]];
        const pg = granPal[layerPal[li]];
        const o = i * 4;
        imS.data[o] = sat(ps[0] * shade) * 255;
        imS.data[o + 1] = sat(ps[1] * shade) * 255;
        imS.data[o + 2] = sat(ps[2] * shade) * 255;
        imS.data[o + 3] = 255;
        // 花崗岩：層理對比弱一點、多一點細顆粒
        const shadeG = shade * (0.93 + 0.12 * grain[(i * 7) % (W * H)]);
        imG.data[o] = sat(pg[0] * shadeG) * 255;
        imG.data[o + 1] = sat(pg[1] * shadeG) * 255;
        imG.data[o + 2] = sat(pg[2] * shadeG) * 255;
        imG.data[o + 3] = 255;
        const hgt = sat(0.25 + 0.45 * prof + 0.3 * grain[i] - 0.5 * crack[i] - 0.25 * crev - (pits[i] ? 0.2 : 0));
        imB.data[o] = imB.data[o + 1] = imB.data[o + 2] = hgt * 255;
        imB.data[o + 3] = 255;
      }
    }
    gs.putImageData(imS, 0, 0);
    gg.putImageData(imG, 0, 0);
    gb.putImageData(imB, 0, 0);
    return {
      sand: toTex(cs, true),
      granite: toTex(cg, true),
      bump: toTex(cb, false),
      sandTop: rockTop([0xc9935f, 0xb98454], 61),
      graniteTop: rockTop([0xc8bfac, 0xb2a994], 67),
    };
  });
}

/**
 * 水面法線貼圖：橫向波峰（垂直於水流）的正弦波組＋細碎漣漪雜訊，512×512 無縫。
 * 切線空間：R = 沿 u（x）、G = 沿 v（往前）、B = 法線。
 */
export function waterNormal(): THREE.CanvasTexture {
  return once('waterNormal', () => {
    const W = 512;
    const H = 512;
    const fbm = tileFbm(W, H, 8, 4, 77);
    const fine = tileNoise(W, H, 48, 78);
    // 整數頻率的正弦波（保證無縫）：[k(沿 u), l(沿 v), 振幅, 相位]
    const waves: [number, number, number, number][] = [
      [1, 5, 0.5, 0.3],
      [-2, 8, 0.35, 1.7],
      [3, 11, 0.25, 2.9],
      [0, 14, 0.2, 0.8],
      [5, 9, 0.18, 4.1],
      [-4, 19, 0.12, 5.3],
      [7, 23, 0.08, 1.1],
    ];
    const h = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        let s = 0;
        for (const [k, l, a, p] of waves) s += a * Math.sin(Math.PI * 2 * (k * u + l * v) + p);
        const i = y * W + x;
        h[i] = 0.55 * fbm[i] + 0.25 * s + 0.12 * fine[i];
      }
    }
    const [c, g] = makeCanvas(W, H);
    const img = g.createImageData(W, H);
    const strength = 9;
    for (let y = 0; y < H; y++) {
      const yu = (y + H - 1) % H;
      const yd = (y + 1) % H;
      for (let x = 0; x < W; x++) {
        const xl = (x + W - 1) % W;
        const xr = (x + 1) % W;
        const dhdu = (h[y * W + xr] - h[y * W + xl]) * 0.5 * strength;
        // canvas 的 y 往下 = 貼圖 v 往下（flipY），所以 dh/dv = −(下 − 上)
        const dhdv = -(h[yd * W + x] - h[yu * W + x]) * 0.5 * strength;
        let nx = -dhdu;
        let ny = -dhdv;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const o = (y * W + x) * 4;
        img.data[o] = (nx * 0.5 + 0.5) * 255;
        img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, false);
  });
}

/**
 * 浪花圖樣：格子化 Worley 雜訊做出一團團泡沫（中心亮、外圈破碎），疊上 fbm 打散。256×256 無縫灰階。
 */
export function foamTexture(): THREE.CanvasTexture {
  return once('foam', () => {
    const W = 256;
    const cells = 10;
    const cs = W / cells;
    const rnd = seeded(91);
    // 每格兩個特徵點
    const pts: [number, number][][] = [];
    for (let i = 0; i < cells * cells; i++) pts.push([[rnd() * cs, rnd() * cs], [rnd() * cs, rnd() * cs]]);
    const fbm = tileFbm(W, W, 6, 3, 92);
    const [c, g] = makeCanvas(W, W);
    const img = g.createImageData(W, W);
    for (let y = 0; y < W; y++) {
      const cy = Math.floor(y / cs);
      for (let x = 0; x < W; x++) {
        const cx = Math.floor(x / cs);
        let f1 = 1e9;
        let f2 = 1e9;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = (cx + ox + cells) % cells;
            const gy = (cy + oy + cells) % cells;
            for (const p of pts[gy * cells + gx]) {
              const px = (cx + ox) * cs + p[0];
              const py = (cy + oy) * cs + p[1];
              const d = Math.hypot(px - x, py - y);
              if (d < f1) {
                f2 = f1;
                f1 = d;
              } else if (d < f2) f2 = d;
            }
          }
        }
        const i = y * W + x;
        const blob = 1 - sstep(0.15, 0.75, f1 / cs);
        const web = sstep(0.0, 0.25, (f2 - f1) / cs);
        const v = sat(0.55 * blob + 0.25 * web + 0.35 * (fbm[i] - 0.3));
        const o = i * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, false);
  });
}

/**
 * 細瀑布水流：垂直拉長的條紋（白到淡藍）、中段偶有空隙，128×256，沿 v 無縫（往下捲動）。
 */
export function cascadeTexture(): THREE.CanvasTexture {
  return once('cascade', () => {
    const W = 128;
    const H = 256;
    const src = tileNoise(W, 32, 40, 101);
    const src2 = tileNoise(W, 16, 18, 102);
    const [c, g] = makeCanvas(W, H);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      // 沿 y 放大取樣（線性內插，繞回）→ 垂直條紋
      const fy = (y / H) * 32;
      const y0 = Math.floor(fy) % 32;
      const y1 = (y0 + 1) % 32;
      const ty = fy - Math.floor(fy);
      const fy2 = (y / H) * 16;
      const z0 = Math.floor(fy2) % 16;
      const z1 = (z0 + 1) % 16;
      const tz = fy2 - Math.floor(fy2);
      for (let x = 0; x < W; x++) {
        const s = src[y0 * W + x] * (1 - ty) + src[y1 * W + x] * ty;
        const s2 = src2[z0 * W + x] * (1 - tz) + src2[z1 * W + x] * tz;
        const v = sat(0.6 * s + 0.4 * s2);
        const o = (y * W + x) * 4;
        img.data[o] = (0.86 + 0.14 * v) * 255;
        img.data[o + 1] = (0.92 + 0.08 * v) * 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = sat(0.25 + 0.85 * sstep(0.3, 0.75, v)) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true);
  });
}

/**
 * 水花：底部一團泡沫＋往上往外噴的水珠與水絲（白色、柔邊），128×128 透明底。
 */
export function splashTexture(): THREE.CanvasTexture {
  return once('splash', () => {
    const S = 128;
    const [c, g] = makeCanvas(S, S);
    const rnd = seeded(111);
    /** 畫一顆柔邊白點 */
    const dot = (x: number, y: number, r: number, a: number) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(255,255,255,${a})`);
      grd.addColorStop(0.55, `rgba(255,255,255,${a * 0.8})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    // 底部泡沫團
    for (let i = 0; i < 26; i++) dot(64 + (rnd() - 0.5) * 90, 112 + (rnd() - 0.5) * 16, 8 + rnd() * 12, 0.85);
    // 往上噴的水絲（弧線）
    g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
      const len = 30 + rnd() * 60;
      const x0 = 64 + Math.cos(a) * 10;
      const y0 = 108;
      const x1 = 64 + Math.cos(a) * len;
      const y1 = 108 + Math.sin(a) * len;
      g.strokeStyle = `rgba(255,255,255,${0.5 + rnd() * 0.4})`;
      g.lineWidth = 2 + rnd() * 3;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2, y1 - 6, x1, y1);
      g.stroke();
      dot(x1, y1, 3 + rnd() * 4, 0.95);
    }
    // 散落水珠
    for (let i = 0; i < 40; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;
      const r = 20 + rnd() * 70;
      dot(64 + Math.cos(a) * r, 108 + Math.sin(a) * r * 0.95, 1.5 + rnd() * 3, 0.9);
    }
    return toTex(c, true, false);
  });
}

/**
 * 霧氣：柔邊的雲團（fbm 門檻），左右與上下漸隱，256×128 透明底（只用 alpha）。
 */
export function mistTexture(): THREE.CanvasTexture {
  return once('mist', () => {
    const W = 256;
    const H = 128;
    const fbm = tileFbm(W, H, 4, 4, 121);
    const [c, g] = makeCanvas(W, H);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      // 上緣淡出多、下緣淡出少（霧貼著水面比較濃）
      const vy = sstep(0.0, 0.55, v) * (1 - sstep(0.88, 1.0, v));
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1);
        const ux = Math.pow(Math.sin(Math.PI * u), 0.8);
        const i = y * W + x;
        const a = sstep(0.3, 0.72, fbm[i]) * ux * vy;
        const o = i * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true);
  });
}

/** 植物圖集裡的一個區塊（UV 範圍） */
export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** 植物圖集：各區塊的 UV 範圍 */
export interface VegAtlas {
  tex: THREE.CanvasTexture;
  lily: AtlasRect;
  bush: AtlasRect;
  vine: AtlasRect;
  reed: AtlasRect;
  petal: AtlasRect;
  grass: AtlasRect;
  shide: AtlasRect;
  moss: AtlasRect;
}

/** 圖集尺寸 */
const ATLAS = 512;

/** canvas 像素矩形 → UV 範圍（CanvasTexture 預設 flipY：canvas 上方是 v = 1） */
function rectUV(x0: number, y0: number, x1: number, y1: number): AtlasRect {
  return { u0: x0 / ATLAS, u1: x1 / ATLAS, v0: 1 - y1 / ATLAS, v1: 1 - y0 / ATLAS };
}

/**
 * 植物與小道具圖集（512×512 透明底，alphaTest 用）：
 * 荷葉（俯視）、灌木葉叢、垂藤、蘆葦、蓮花瓣、草叢、紙垂、垂苔、闊葉蕨。
 * 每個區塊內縮留邊，避免 mipmap 互相滲色。
 */
export function vegAtlas(): VegAtlas {
  return once('vegAtlas', () => {
    const [c, g] = makeCanvas(ATLAS, ATLAS);
    const rnd = seeded(131);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // ── 荷葉（0,0）-（256,256）：缺一角的圓、放射葉脈、亮黃綠中心、深色邊緣
    {
      const cx = 128;
      const cy = 128;
      const r = 112;
      const notch = 0.36;
      const a0 = -Math.PI / 2 + notch / 2;
      const a1 = -Math.PI / 2 - notch / 2 + Math.PI * 2;
      g.save();
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r, a0, a1);
      g.closePath();
      const grd = g.createRadialGradient(cx, cy, 4, cx, cy, r);
      grd.addColorStop(0, '#b6dd6a');
      grd.addColorStop(0.45, '#79b94a');
      grd.addColorStop(0.9, '#4e9a3c');
      grd.addColorStop(1, '#3d7f31');
      g.fillStyle = grd;
      g.fill();
      g.clip();
      // 葉脈
      g.strokeStyle = 'rgba(214,240,150,0.55)';
      for (let k = 0; k < 26; k++) {
        const a = a0 + ((a1 - a0) * (k + 0.5)) / 26;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.quadraticCurveTo(cx + Math.cos(a + 0.08) * r * 0.5, cy + Math.sin(a + 0.08) * r * 0.5, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.stroke();
      }
      // 斑點與日照亮斑
      for (let k = 0; k < 18; k++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (0.3 + rnd() * 0.6);
        g.fillStyle = rnd() < 0.5 ? 'rgba(60,110,40,0.35)' : 'rgba(190,170,80,0.3)';
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 4 + rnd() * 9, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      // 邊緣捲起的深色線
      g.strokeStyle = '#2f6a28';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, r - 3, a0, a1);
      g.stroke();
      g.restore();
    }

    // ── 灌木葉叢（256,0）-（512,256）：從底部中心往外長的葉片，深色在內、亮色在外
    {
      const ox = 384;
      const oy = 246;
      const greens = ['#2f5f27', '#3d7430', '#4f8a37', '#62a040', '#78b44a', '#8fc657'];
      for (let layer = 0; layer < greens.length; layer++) {
        for (let k = 0; k < 16; k++) {
          const a = -Math.PI / 2 + (rnd() - 0.5) * 2.7;
          const d = 30 + rnd() * 150 * (0.55 + layer * 0.09);
          const lx = ox + Math.cos(a) * d * 0.95;
          const ly = oy + Math.sin(a) * d * 0.85;
          if (ly < 12 || lx < 268 || lx > 500) continue;
          const len = 16 + rnd() * 18;
          g.save();
          g.translate(lx, ly);
          g.rotate(a + Math.PI / 2 + (rnd() - 0.5) * 0.9);
          g.fillStyle = greens[layer];
          g.beginPath();
          g.ellipse(0, -len / 2, len * 0.36, len / 2, 0, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = 'rgba(20,40,15,0.35)';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(0, -len * 0.9);
          g.stroke();
          g.restore();
        }
      }
    }

    // ── 垂藤（0,256）-（128,512）：三條從上垂下的波浪莖，兩側互生小葉
    {
      for (let s = 0; s < 3; s++) {
        let x = 24 + s * 38 + rnd() * 10;
        const leafCol = ['#3f7a30', '#5a9a3a', '#4c8a35'][s];
        g.strokeStyle = '#4a5a28';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(x, 262);
        const pts: [number, number][] = [];
        for (let y = 262; y < 500; y += 6) {
          x += Math.sin(y * 0.05 + s * 2) * 1.2;
          g.lineTo(x, y);
          pts.push([x, y]);
        }
        g.stroke();
        pts.forEach(([px, py], k) => {
          if (k % 2) return;
          const side = k % 4 === 0 ? 1 : -1;
          const fadeOut = 1 - (py - 262) / 260;
          const len = (9 + rnd() * 8) * (0.5 + 0.5 * fadeOut);
          g.save();
          g.translate(px, py);
          g.rotate(side * (0.9 + rnd() * 0.5));
          g.fillStyle = leafCol;
          g.beginPath();
          g.ellipse(0, len / 2, len * 0.42, len / 2, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        });
      }
    }

    // ── 蘆葦（128,256）-（256,512）：細長漸尖的葉片＋兩支香蒲穗
    {
      const base = 504;
      for (let k = 0; k < 13; k++) {
        const x0 = 150 + rnd() * 84;
        const h = 150 + rnd() * 90;
        const bend = (rnd() - 0.5) * 50;
        const w = 3 + rnd() * 3;
        const grd = g.createLinearGradient(0, base, 0, base - h);
        grd.addColorStop(0, '#3e6e2c');
        grd.addColorStop(0.6, '#6f9e3e');
        grd.addColorStop(1, '#c4c26a');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x0 - w, base);
        g.quadraticCurveTo(x0 - w * 0.5, base - h * 0.6, x0 + bend, base - h);
        g.quadraticCurveTo(x0 + w * 0.5, base - h * 0.6, x0 + w, base);
        g.closePath();
        g.fill();
      }
      for (let k = 0; k < 2; k++) {
        const x0 = 176 + k * 34;
        const top = 290 + k * 22;
        g.strokeStyle = '#6a7a38';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(x0, base);
        g.lineTo(x0 + 2, top);
        g.stroke();
        g.fillStyle = '#6b4426';
        g.beginPath();
        g.ellipse(x0 + 2, top + 22, 6, 20, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,220,170,0.25)';
        g.beginPath();
        g.ellipse(x0, top + 18, 2, 14, 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ── 蓮花瓣（256,256）-（384,384）：尖橢圓、底部白粉、尖端桃紅、淡脈
    {
      const cx = 320;
      const grd = g.createLinearGradient(0, 376, 0, 266);
      grd.addColorStop(0, '#fff3f6');
      grd.addColorStop(0.45, '#f7b4cb');
      grd.addColorStop(1, '#e25689');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx, 376);
      g.bezierCurveTo(cx - 52, 350, cx - 40, 296, cx, 266);
      g.bezierCurveTo(cx + 40, 296, cx + 52, 350, cx, 376);
      g.fill();
      g.strokeStyle = 'rgba(200,60,110,0.35)';
      g.lineWidth = 1.5;
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(cx, 372);
        g.quadraticCurveTo(cx + k * 12, 320, cx + k * 5, 274);
        g.stroke();
      }
    }

    // ── 草叢（384,256）-（512,384）：從底部中心散開的細葉
    {
      const bx = 448;
      const by = 380;
      for (let k = 0; k < 34; k++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.9;
        const len = 50 + rnd() * 66;
        const ex = bx + Math.cos(a) * len;
        const ey = by + Math.sin(a) * len;
        if (ey < 262) continue;
        g.strokeStyle = ['#4f8a33', '#6da343', '#88b54e', '#3f7a2e'][k % 4];
        g.lineWidth = 2 + rnd() * 2;
        g.beginPath();
        g.moveTo(bx + (rnd() - 0.5) * 10, by);
        g.quadraticCurveTo(bx + Math.cos(a) * len * 0.5, by + Math.sin(a) * len * 0.6, Math.max(390, Math.min(506, ex)), ey);
        g.stroke();
      }
    }

    // ── 紙垂（256,384）-（384,512）：白色折紙的閃電形
    {
      g.fillStyle = '#f7f3e8';
      g.strokeStyle = 'rgba(150,140,120,0.6)';
      g.lineWidth = 2;
      const x = 300;
      g.beginPath();
      g.moveTo(x, 392);
      g.lineTo(x + 34, 392);
      g.lineTo(x + 34, 420);
      g.lineTo(x + 14, 420);
      g.lineTo(x + 50, 452);
      g.lineTo(x + 50, 476);
      g.lineTo(x + 26, 476);
      g.lineTo(x + 62, 506);
      g.lineTo(x + 30, 506);
      g.lineTo(x - 4, 476);
      g.lineTo(x + 18, 476);
      g.lineTo(x - 14, 446);
      g.lineTo(x + 10, 446);
      g.lineTo(x, 420);
      g.closePath();
      g.fill();
      g.stroke();
    }

    // ── 垂苔（384,384）-（512,512）：細細下垂的黃綠苔絲
    {
      for (let k = 0; k < 26; k++) {
        const x0 = 392 + rnd() * 112;
        const len = 40 + rnd() * 76;
        g.strokeStyle = ['#7e9a3a', '#93ad48', '#647f2e'][k % 3];
        g.lineWidth = 2 + rnd() * 2.5;
        g.beginPath();
        g.moveTo(x0, 390);
        g.quadraticCurveTo(x0 + (rnd() - 0.5) * 12, 390 + len * 0.5, x0 + (rnd() - 0.5) * 8, 390 + len);
        g.stroke();
      }
    }

    const tex = toTex(c, true, false);
    return {
      tex,
      lily: rectUV(12, 12, 244, 244),
      bush: rectUV(264, 6, 508, 250),
      vine: rectUV(6, 258, 124, 508),
      reed: rectUV(134, 262, 250, 508),
      petal: rectUV(262, 262, 378, 380),
      grass: rectUV(388, 262, 508, 382),
      shide: rectUV(262, 388, 378, 508),
      moss: rectUV(388, 388, 508, 508),
    };
  });
}

/** 調色盤（單色小道具用）：每格 8×8 像素，UV 取格子中心 */
export const PALETTE = {
  barkDark: 0,
  barkLight: 1,
  pineDark: 2,
  pineMid: 3,
  leafLight: 4,
  lotusCenter: 5,
} as const;

/** 調色盤顏色（依 PALETTE 的索引）：深樹皮、淺樹皮、深松綠、松綠、亮葉綠、蓮心黃 */
const PALETTE_COLORS = [0x5a3d26, 0x8a6240, 0x2f5a2a, 0x3f7a35, 0x6fa045, 0xf2c93a];

/**
 * 調色盤貼圖（64×64、最近點取樣、不做 mipmap）：小道具用 UV 指到某一格就得到那個顏色，
 * 不同顏色的零件可以共用一個材質、合併成一個網格。
 */
export function paletteTexture(): THREE.CanvasTexture {
  return once('palette', () => {
    const [c, g] = makeCanvas(64, 64);
    PALETTE_COLORS.forEach((hex, i) => {
      g.fillStyle = `#${hex.toString(16).padStart(6, '0')}`;
      g.fillRect((i % 8) * 8, Math.floor(i / 8) * 8, 8, 8);
    });
    const t = toTex(c, true, false);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  });
}

/** 調色盤某一格的中心 UV */
export function paletteUV(index: number): [number, number] {
  const u = ((index % 8) * 8 + 4) / 64;
  const v = 1 - (Math.floor(index / 8) * 8 + 4) / 64;
  return [u, v];
}

/**
 * 粗麻繩：斜向扭轉的繩股（u 沿繩子、v 繞一圈），64×32 無縫。
 */
export function ropeTexture(): THREE.CanvasTexture {
  return once('rope', () => {
    const W = 64;
    const H = 32;
    const n = tileNoise(W, H, 16, 141);
    const [c, g] = makeCanvas(W, H);
    const img = g.createImageData(W, H);
    const base = rgb01(0xcfae6e);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // 三股扭轉：沿 u 與 v 的斜線
        const t = (x / W) * 4 + (y / H) * 3;
        const band = Math.pow(Math.abs(Math.sin(Math.PI * t)), 0.7);
        const s = (0.55 + 0.45 * band) * (0.9 + 0.2 * n[y * W + x]);
        const o = (y * W + x) * 4;
        img.data[o] = sat(base[0] * s) * 255;
        img.data[o + 1] = sat(base[1] * s) * 255;
        img.data[o + 2] = sat(base[2] * s) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true);
  });
}

/**
 * 原木切面：年輪、放射裂紋、外圈樹皮，128×128。
 */
export function endGrainTexture(): THREE.CanvasTexture {
  return once('endGrain', () => {
    const S = 128;
    const n = tileFbm(S, S, 4, 3, 151);
    const [c, g] = makeCanvas(S, S);
    const img = g.createImageData(S, S);
    const light = rgb01(0xd9b07a);
    const dark = rgb01(0x9a6a3c);
    const barkC = rgb01(0x4a3220);
    const rnd = seeded(152);
    const cracks = Array.from({ length: 5 }, () => rnd() * Math.PI * 2);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - S / 2 + 0.5;
        const dy = y - S / 2 + 0.5;
        const r = Math.hypot(dx, dy) / (S / 2);
        const a = Math.atan2(dy, dx);
        const i = y * S + x;
        const ring = 0.5 + 0.5 * Math.sin(r * 46 + n[i] * 5);
        let col: [number, number, number] = [
          light[0] * (1 - ring * 0.35) + dark[0] * ring * 0.35,
          light[1] * (1 - ring * 0.35) + dark[1] * ring * 0.35,
          light[2] * (1 - ring * 0.35) + dark[2] * ring * 0.35,
        ];
        // 中心較深
        const core = 1 - sstep(0.0, 0.12, r) * 0.25;
        col = [col[0] * (0.75 + 0.25 * core), col[1] * (0.75 + 0.25 * core), col[2] * (0.75 + 0.25 * core)];
        // 放射裂紋
        for (const ca of cracks) {
          let d = Math.abs(a - ca);
          d = Math.min(d, Math.PI * 2 - d);
          if (d < 0.025 && r > 0.15 && r < 0.85) col = [col[0] * 0.45, col[1] * 0.45, col[2] * 0.45];
        }
        // 外圈樹皮
        if (r > 0.86) col = barkC;
        const o = i * 4;
        img.data[o] = sat(col[0]) * 255;
        img.data[o + 1] = sat(col[1]) * 255;
        img.data[o + 2] = sat(col[2]) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true, false);
  });
}

/**
 * 水面反射用的天空環境圖（等距柱狀投影 512×256）：
 * 下半部是暗暖的峽谷倒影，地平線一圈亮金色，正前方（−z）有夕陽光暈，左右兩側有橘褐色岩壁剪影，往上漸變成藍灰。
 * mapping = EquirectangularReflectionMapping，renderer 會自動轉成 PMREM。
 */
export function sunsetEnvTexture(): THREE.CanvasTexture {
  return once('sunsetEnv', () => {
    const W = 512;
    const H = 256;
    const [c, g] = makeCanvas(W, H);
    const img = g.createImageData(W, H);
    const top = rgb01(0x7f8fb3);
    const mid = rgb01(0xf2c08a);
    const hor = rgb01(0xffe0a8);
    const low = rgb01(0x5a4632);
    const rockLit = rgb01(0xc98a52);
    const rockDark = rgb01(0x8a5a3a);
    const sun = rgb01(0xfff2cc);
    const n = tileFbm(W, H, 6, 3, 161);
    for (let y = 0; y < H; y++) {
      // 仰角（度）：canvas 上方 = +90°
      const elev = 90 - (y / (H - 1)) * 180;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        let col: [number, number, number];
        if (elev >= 0) {
          const t = Math.pow(elev / 90, 0.5);
          const a = sstep(0, 0.35, t);
          col = [
            hor[0] * (1 - a) + mid[0] * a,
            hor[1] * (1 - a) + mid[1] * a,
            hor[2] * (1 - a) + mid[2] * a,
          ];
          const b = sstep(0.3, 1.0, t);
          col = [col[0] * (1 - b) + top[0] * b, col[1] * (1 - b) + top[1] * b, col[2] * (1 - b) + top[2] * b];
        } else {
          const t = sstep(0, 25, -elev);
          col = [hor[0] * (1 - t) + low[0] * t, hor[1] * (1 - t) + low[1] * t, hor[2] * (1 - t) + low[2] * t];
        }
        // 兩側岩壁：+x（u = 0.5）與 −x（u = 0 / 1），仰角 0～(28～40)°
        const dRight = Math.abs(u - 0.5);
        const dLeft = Math.min(u, 1 - u);
        const wallTop = 28 + 12 * n[y * W + x];
        for (const [d, lit] of [
          [dRight, 1],
          [dLeft, 0],
        ] as [number, number][]) {
          const inWall = sstep(0.26, 0.05, d);
          if (inWall > 0 && elev < wallTop) {
            const rc = lit ? rockLit : rockDark;
            const shade = 0.75 + 0.35 * n[y * W + x];
            const k = inWall * sstep(wallTop, wallTop - 14, elev) * sstep(-16, -4, elev);
            col = [
              col[0] * (1 - k) + rc[0] * shade * k,
              col[1] * (1 - k) + rc[1] * shade * k,
              col[2] * (1 - k) + rc[2] * shade * k,
            ];
          }
        }
        // 正前方（u = 0.25）的夕陽光暈
        const du = (u - 0.25) * 360;
        const de = elev - 8;
        const dist = Math.hypot(du, de * 1.3);
        const glow = Math.exp(-dist / 9) * 1.4 + Math.exp(-dist / 30) * 0.45;
        col = [col[0] + sun[0] * glow, col[1] + sun[1] * glow * 0.92, col[2] + sun[2] * glow * 0.75];
        const o = (y * W + x) * 4;
        img.data[o] = sat(col[0]) * 255;
        img.data[o + 1] = sat(col[1]) * 255;
        img.data[o + 2] = sat(col[2]) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = toTex(c, true, false);
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  });
}

/**
 * 石柱刻紋：一圈圈的雲紋、漩渦與菱格（原創圖樣），256×128，u 沿圓周無縫。
 * 灰階高度（NoColorSpace）：刻痕處低；顏色由岩石材質處理。
 */
export function carvingTexture(): THREE.CanvasTexture {
  return once('carving', () => {
    const W = 256;
    const H = 128;
    const [c, g] = makeCanvas(W, H);
    g.fillStyle = '#b0b0b0';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a2a2a';
    g.lineCap = 'round';
    // 上下兩道邊框
    g.lineWidth = 6;
    for (const y of [10, H - 10]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    // 漩渦雲紋：一圈四個
    g.lineWidth = 5;
    for (let k = 0; k < 4; k++) {
      const cx = 32 + k * 64;
      const cy = H / 2;
      g.beginPath();
      for (let a = 0; a <= Math.PI * 3.4; a += 0.1) {
        const r = 4 + a * 6.2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.8;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      // 漩渦之間的菱形
      const mx = cx + 32;
      g.beginPath();
      g.moveTo(mx, cy - 14);
      g.lineTo(mx + 9, cy);
      g.lineTo(mx, cy + 14);
      g.lineTo(mx - 9, cy);
      g.closePath();
      g.stroke();
    }
    return toTex(c, false);
  });
}

/** 預先產生全部貼圖（createKit 時呼叫，避免第一次建段落時才花時間） */
export function warmTextures(): void {
  rockTextures();
  waterNormal();
  foamTexture();
  cascadeTexture();
  splashTexture();
  mistTexture();
  vegAtlas();
  paletteTexture();
  ropeTexture();
  endGrainTexture();
  sunsetEnvTexture();
  carvingTexture();
}
