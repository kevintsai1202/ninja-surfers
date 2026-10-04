import * as THREE from 'three';

/**
 * 程式產生的材質貼圖（canvas 繪製，全部可無縫重複貼）。
 * 每組回傳 { map, bump }：map 是顏色（sRGB），bump 是凹凸高度（灰階、NoColorSpace）。
 * 結果依參數快取，同一組參數只產生一次。
 *
 * 場景模組如果需要特別的貼圖，請在自己的資料夾另寫，不要改這個共用檔。
 */

/** 一組貼圖 */
export interface TexSet {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

/** 種子亂數（mulberry32），同種子產生相同序列 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 可無縫重複的 value noise（座標在 w、h 處繞回）。
 * @param cells 橫向格數（越多越細）
 * @returns 長度 w×h、值域 0..1 的陣列
 */
export function tileNoise(w: number, h: number, cells: number, seed: number): Float32Array {
  const rnd = seeded(seed);
  const cx = Math.max(1, Math.round(cells));
  const cy = Math.max(1, Math.round((cells * h) / w));
  const grid = new Float32Array(cx * cy);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * cy;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    const r0 = (y0 % cy) * cx;
    const r1 = ((y0 + 1) % cy) * cx;
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cx;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const c0 = x0 % cx;
      const c1 = (x0 + 1) % cx;
      const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
      const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
      out[y * w + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** 多層 value noise 疊加（fbm），值域約 0..1 */
export function tileFbm(w: number, h: number, cells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(w, h, cells * Math.pow(2, o), seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** 建立 canvas */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** 把 canvas 包成可重複貼的貼圖 */
function wrapTex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 把高度陣列（0..1）畫成灰階凹凸貼圖 */
function heightToTex(height: Float32Array, w: number, h: number): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let i = 0; i < height.length; i++) {
    const v = Math.max(0, Math.min(255, height[i] * 255));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return wrapTex(c, false);
}

/** 顏色字串 → [r,g,b]（0..255） */
function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** 用「底色 × 明暗陣列」產生顏色貼圖（shade 值 1 = 原色） */
function shadeToTex(base: number, shade: Float32Array, w: number, h: number, tint?: Float32Array, tintColor?: number): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const [r, gg, b] = rgb(base);
  const [tr, tg, tb] = rgb(tintColor ?? base);
  for (let i = 0; i < shade.length; i++) {
    const s = shade[i];
    const t = tint ? tint[i] : 0;
    img.data[i * 4] = Math.max(0, Math.min(255, (r * (1 - t) + tr * t) * s));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, (gg * (1 - t) + tg * t) * s));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, (b * (1 - t) + tb * t) * s));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return wrapTex(c, true);
}

/** 貼圖快取 */
const texCache = new Map<string, TexSet>();

/** 依 key 快取一組貼圖 */
function cached(key: string, make: () => TexSet): TexSet {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

/**
 * 木板牆／地板：直向木板（沿 v 方向）、每片明暗不同、木紋、板縫、偶有木節。
 * @param base 木頭底色
 * @param planks 一張貼圖裡的木板片數
 */
export function woodPlanks(base = 0x9a6a3e, planks = 6, seed = 1): TexSet {
  return cached(`planks|${base}|${planks}|${seed}`, () => {
    const W = 512;
    const H = 512;
    const rnd = seeded(seed);
    const grain = tileFbm(W, H, 4, 4, seed + 7);
    const fine = tileNoise(W, H, 64, seed + 9);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    const pw = W / planks;
    const plankTone = Array.from({ length: planks }, () => 0.82 + rnd() * 0.3);
    const plankOff = Array.from({ length: planks }, () => rnd() * 50);
    // 木節：位置與大小
    const knots = Array.from({ length: 5 }, () => ({ x: rnd() * W, y: rnd() * H, r: 6 + rnd() * 10 }));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const p = Math.floor(x / pw);
        const lx = x - p * pw;
        // 木紋：沿 y 方向拉長的條紋
        const gnoise = grain[((y + Math.floor(plankOff[p])) % H) * W + x];
        const stripes = 0.5 + 0.5 * Math.sin((lx * 0.35 + gnoise * 18) * 1.0);
        let s = plankTone[p] * (0.86 + 0.14 * stripes) * (0.94 + 0.12 * fine[i]);
        let hgt = 0.55 + 0.1 * stripes;
        for (const k of knots) {
          const dx = x - k.x;
          const dy = (y - k.y) * 0.6;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < k.r) {
            s *= 0.7 + 0.3 * (d / k.r);
            hgt -= 0.15 * (1 - d / k.r);
          }
        }
        // 板縫：兩側 2 像素變暗變低
        if (lx < 2 || lx > pw - 2) {
          s *= 0.45;
          hgt = 0.1;
        }
        shade[i] = s;
        height[i] = hgt;
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 木材（樑、柱、枕木）：只有木紋，沒有板縫。
 */
export function woodGrain(base = 0x7b5232, seed = 2): TexSet {
  return cached(`grain|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const grain = tileFbm(W, H, 3, 4, seed);
    const fine = tileNoise(W, H, 48, seed + 3);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const stripes = 0.5 + 0.5 * Math.sin(x * 0.5 + grain[i] * 22);
        shade[i] = (0.82 + 0.18 * stripes) * (0.93 + 0.14 * fine[i]);
        height[i] = 0.4 + 0.3 * stripes;
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 日式瓦屋頂：一列列圓筒瓦（直向凸起）與橫向的瓦片接縫。
 * 貼圖 u 方向 = 沿屋簷，v 方向 = 沿屋頂斜面。
 */
export function roofTiles(base = 0x3d4a5c, seed = 3): TexSet {
  return cached(`roof|${base}|${seed}`, () => {
    const W = 512;
    const H = 512;
    const cols = 12;
    const rows = 8;
    const noise = tileNoise(W, H, 32, seed);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    const cw = W / cols;
    const rh = H / rows;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const lx = (x % cw) / cw; // 0..1 一條瓦的寬度
        const ly = (y % rh) / rh; // 0..1 一片瓦的長度
        // 圓筒瓦的弧面：中間高、兩側低
        const arc = Math.sin(lx * Math.PI);
        // 每片瓦下緣有一條陰影（上一片蓋住下一片）
        const lap = ly > 0.9 ? 0.55 : 1 - 0.15 * ly;
        shade[i] = (0.6 + 0.4 * arc) * lap * (0.92 + 0.16 * noise[i]);
        height[i] = arc * 0.8 * (ly > 0.9 ? 0.6 : 1);
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 灰泥牆：細緻的斑駁顆粒＋大塊的深淺變化。
 */
export function plaster(base = 0xefe3cc, seed = 4): TexSet {
  return cached(`plaster|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const big = tileFbm(W, H, 3, 3, seed);
    const fine = tileNoise(W, H, 80, seed + 5);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      shade[i] = 0.88 + 0.12 * big[i] + 0.06 * (fine[i] - 0.5);
      height[i] = 0.5 + 0.4 * (fine[i] - 0.5) + 0.2 * (big[i] - 0.5);
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 石磚牆：錯縫排列的石磚、每塊明暗不同、灰縫凹陷。
 * @param rows 一張貼圖的磚列數
 */
export function stoneBricks(base = 0x9b958a, rows = 6, seed = 5): TexSet {
  return cached(`bricks|${base}|${rows}|${seed}`, () => {
    const W = 512;
    const H = 512;
    const rnd = seeded(seed);
    const noise = tileFbm(W, H, 16, 3, seed + 1);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    const rh = H / rows;
    const cols = 4;
    const cw = W / cols;
    const tones: number[] = [];
    for (let i = 0; i < rows * (cols + 1); i++) tones.push(0.8 + rnd() * 0.3);
    for (let y = 0; y < H; y++) {
      const row = Math.floor(y / rh);
      const ly = y - row * rh;
      const offset = row % 2 === 0 ? 0 : cw / 2;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const xx = (x + offset) % W;
        const col = Math.floor(xx / cw);
        const lx = xx - col * cw;
        const mortar = ly < 4 || lx < 4;
        const tone = tones[row * (cols + 1) + col];
        // 磚面邊緣略暗，做出立體感
        const edge = Math.min(ly, rh - ly, lx, cw - lx) / 10;
        const bevel = Math.min(1, edge);
        shade[i] = mortar ? 0.55 : tone * (0.85 + 0.15 * bevel) * (0.9 + 0.2 * noise[i]);
        height[i] = mortar ? 0.05 : 0.5 + 0.4 * bevel * (0.8 + 0.2 * noise[i]);
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 道碴（鐵軌下的碎石）：一顆顆有亮面與陰影的小石頭，石頭之間是暗縫。
 */
export function gravel(base = 0x8c857a, seed = 6): TexSet {
  return cached(`gravel|${base}|${seed}`, () => {
    const W = 512;
    const H = 512;
    const rnd = seeded(seed);
    const shade = new Float32Array(W * H).fill(0.35);
    const height = new Float32Array(W * H).fill(0.05);
    // 隨機撒石頭（可重複：畫在繞回的位置）
    const stones = 900;
    for (let s = 0; s < stones; s++) {
      const cx = rnd() * W;
      const cy = rnd() * H;
      const r = 5 + rnd() * 9;
      const tone = 0.75 + rnd() * 0.45;
      const rx = r * (0.8 + rnd() * 0.4);
      const ry = r * (0.8 + rnd() * 0.4);
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
        for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
          const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
          if (d > 1) continue;
          const x = (Math.floor(cx + dx) + W) % W;
          const y = (Math.floor(cy + dy) + H) % H;
          const i = y * W + x;
          const hgt = Math.sqrt(1 - d);
          if (hgt * 0.9 + 0.1 > height[i]) {
            height[i] = hgt * 0.9 + 0.1;
            // 左上亮、右下暗
            const light = 0.75 + 0.35 * (-dx / rx - dy / ry) * 0.5;
            shade[i] = tone * (0.55 + 0.45 * hgt) * light;
          }
        }
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 樹皮：直向深溝紋＋苔蘚斑塊。
 * @param mossColor 苔蘚顏色（0 = 不要苔蘚）
 */
export function bark(base = 0x5b4430, mossColor = 0x4f7a2e, seed = 7): TexSet {
  return cached(`bark|${base}|${mossColor}|${seed}`, () => {
    const W = 256;
    const H = 512;
    const ridges = tileFbm(W, H, 6, 4, seed);
    const moss = tileFbm(W, H, 3, 3, seed + 11);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    const tint = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        // 溝紋：x 方向的正弦被雜訊扭曲，形成直向裂紋
        const v = Math.abs(Math.sin((x / W) * Math.PI * 14 + ridges[i] * 6));
        const groove = Math.pow(v, 0.6);
        shade[i] = 0.45 + 0.6 * groove;
        height[i] = groove;
        tint[i] = mossColor ? Math.max(0, Math.min(1, (moss[i] - 0.52) * 4)) * 0.85 : 0;
      }
    }
    return { map: shadeToTex(base, shade, W, H, tint, mossColor || base), bump: heightToTex(height, W, H) };
  });
}

/**
 * 草地：深淺不一的綠色，夾雜短草葉筆觸。
 */
export function grass(base = 0x5f9e3a, seed = 8): TexSet {
  return cached(`grass|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const big = tileFbm(W, H, 4, 3, seed);
    const fine = tileNoise(W, H, 96, seed + 1);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      shade[i] = 0.75 + 0.3 * big[i] + 0.2 * (fine[i] - 0.5);
      height[i] = fine[i];
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 岩石：水平層理（峽谷岩壁）＋裂紋雜訊。
 * @param layers 一張貼圖裡的層數
 */
export function rock(base = 0x8a7f72, layers = 7, seed = 9): TexSet {
  return cached(`rock|${base}|${layers}|${seed}`, () => {
    const W = 512;
    const H = 512;
    const warp = tileFbm(W, H, 4, 4, seed);
    const fine = tileFbm(W, H, 24, 3, seed + 3);
    const rnd = seeded(seed + 5);
    const tones = Array.from({ length: layers }, () => 0.78 + rnd() * 0.32);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const ly = ((y / H) * layers + warp[i] * 1.2) % layers;
        const layer = Math.floor(ly);
        const f = ly - layer;
        const ledge = f < 0.08 ? 0.6 : 1;
        shade[i] = tones[layer] * ledge * (0.82 + 0.3 * fine[i]);
        height[i] = (f < 0.08 ? 0.2 : 0.6) + 0.35 * fine[i];
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 泥土路面：大塊深淺＋小石子。
 */
export function dirt(base = 0xa98a62, seed = 10): TexSet {
  return cached(`dirt|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const big = tileFbm(W, H, 4, 4, seed);
    const pebbles = tileNoise(W, H, 60, seed + 2);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const p = pebbles[i] > 0.78 ? 1.15 : 1;
      shade[i] = (0.8 + 0.3 * big[i]) * p;
      height[i] = 0.4 * big[i] + (pebbles[i] > 0.78 ? 0.5 : 0);
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 布料（角色衣服）：細緻的織紋＋很淡的大塊明暗，讓純色衣服不會像塑膠。
 */
export function fabric(base = 0xffffff, seed = 11): TexSet {
  return cached(`fabric|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const big = tileFbm(W, H, 3, 3, seed);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        // 經緯交錯的織紋
        const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 1 : 0.9;
        shade[i] = (0.94 + 0.06 * weave) * (0.95 + 0.08 * big[i]);
        height[i] = 0.5 + 0.25 * weave;
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 和紙（燈籠、紙門、暖簾）：淡淡的纖維紋路。
 */
export function paper(base = 0xf5ecd7, seed = 12): TexSet {
  return cached(`paper|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const fibers = tileFbm(W, H, 32, 2, seed);
    const big = tileFbm(W, H, 2, 2, seed + 1);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      shade[i] = 0.92 + 0.08 * big[i] + 0.05 * (fibers[i] - 0.5);
      height[i] = fibers[i];
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 金屬（鋼軌、護額金屬片、鉚釘）：細微拉絲紋。
 */
export function metal(base = 0xb8c0c8, seed = 13): TexSet {
  return cached(`metal|${base}|${seed}`, () => {
    const W = 256;
    const H = 256;
    const streak = tileNoise(W, 4, 64, seed);
    const big = tileFbm(W, H, 3, 2, seed + 1);
    const shade = new Float32Array(W * H);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        shade[i] = 0.9 + 0.1 * streak[x] + 0.08 * (big[i] - 0.5);
        height[i] = streak[x];
      }
    }
    return { map: shadeToTex(base, shade, W, H), bump: heightToTex(height, W, H) };
  });
}

/**
 * 設定一組貼圖的重複次數（會複製貼圖物件，共用同一張圖片，不影響其他使用者）。
 */
export function repeated(set: TexSet, u: number, v: number): TexSet {
  const map = set.map.clone();
  const bump = set.bump.clone();
  map.repeat.set(u, v);
  bump.repeat.set(u, v);
  map.needsUpdate = true;
  bump.needsUpdate = true;
  return { map: map as THREE.CanvasTexture, bump: bump as THREE.CanvasTexture };
}
