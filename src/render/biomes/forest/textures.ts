import * as THREE from 'three';
import { seeded, tileFbm, tileNoise, type TexSet } from '../../proctex';

/**
 * 死亡森林專用的程式貼圖（全部 canvas 繪製、原創圖案）：
 * 林道泥土、森林地面、舊枕木、鏽鋼軌、樹皮、苔蘚、樹冠葉叢、岩石、
 * 植物貼圖集（蕨葉、葉叢、藤蔓、鐵絲網…，帶透明）、道具貼圖集（年輪、香菇、警告牌、繩索、紙垂…）、
 * 光束／光暈、螢火蟲光點。
 * 顏色貼圖是 SRGBColorSpace；凹凸貼圖保持 NoColorSpace。
 */

// ───────────────────────── 小工具 ─────────────────────────

/** 建立畫布 */
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** 畫布 → 可重複貼的貼圖 */
function toTex(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 數字顏色 → CSS 顏色字串（k 為亮度倍率，a 為不透明度） */
function css(hex: number, k = 1, a = 1): string {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 255) * k)));
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}

/** 灰階 CSS 顏色（0..1） */
function gray(v: number, a = 1): string {
  const c = Math.max(0, Math.min(255, Math.round(v * 255)));
  return a < 1 ? `rgba(${c},${c},${c},${a})` : `rgb(${c},${c},${c})`;
}

/** 兩個數字顏色內插 */
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/** smoothstep */
function sstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 在可重複貼的畫布上畫：靠近邊緣時在對側補畫一次，接縫才連續 */
function wrap(W: number, H: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const xx = x + dx * W;
      const yy = y + dy * H;
      if (xx + r < 0 || xx - r > W || yy + r < 0 || yy - r > H) continue;
      fn(xx, yy);
    }
  }
}

/** 葉片形狀路徑（尖頭、圓肚），中心在原點、長軸沿 y */
function leafPath(g: CanvasRenderingContext2D, len: number, wid: number): void {
  g.beginPath();
  g.moveTo(0, -len / 2);
  g.bezierCurveTo(wid * 0.95, -len * 0.28, wid * 0.75, len * 0.3, 0, len / 2);
  g.bezierCurveTo(-wid * 0.75, len * 0.3, -wid * 0.95, -len * 0.28, 0, -len / 2);
  g.closePath();
}

/**
 * 在顏色與凹凸兩張畫布上同時畫一片葉子。
 * @param bump 凹凸亮度（0..1，越亮越凸）
 */
function drawLeaf(
  g: CanvasRenderingContext2D,
  bg: CanvasRenderingContext2D | null,
  x: number,
  y: number,
  len: number,
  wid: number,
  rot: number,
  color: number,
  bump = 0.75,
  vein = true,
): void {
  for (const [ctx, isBump] of [[g, false], [bg, true]] as [CanvasRenderingContext2D | null, boolean][]) {
    if (!ctx) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    leafPath(ctx, len, wid);
    if (isBump) {
      ctx.fillStyle = gray(bump);
      ctx.fill();
    } else {
      // 葉面：暗的整片＋亮的半邊（立體感；不用漸層，畫得快）
      ctx.fillStyle = css(color, 0.86);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -len / 2);
      ctx.bezierCurveTo(wid * 0.95, -len * 0.28, wid * 0.75, len * 0.3, 0, len / 2);
      ctx.closePath();
      ctx.fillStyle = css(color, 1.1);
      ctx.fill();
      if (vein && len > 6) {
        ctx.strokeStyle = css(color, 0.62);
        ctx.lineWidth = Math.max(0.6, wid * 0.14);
        ctx.beginPath();
        ctx.moveTo(0, -len / 2);
        ctx.lineTo(0, len / 2 + len * 0.08);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** 把底色雜訊直接寫進像素：顏色在 lo..hi 之間依 n 內插，再乘明暗 shade */
function paintBase(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  colorAt: (i: number) => number,
  shadeAt: (i: number) => number,
): void {
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < W * H; i++) {
    const c = colorAt(i);
    const s = shadeAt(i);
    d[i * 4] = Math.max(0, Math.min(255, ((c >> 16) & 255) * s));
    d[i * 4 + 1] = Math.max(0, Math.min(255, ((c >> 8) & 255) * s));
    d[i * 4 + 2] = Math.max(0, Math.min(255, (c & 255) * s));
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** 把高度陣列寫進灰階畫布 */
function paintHeight(g: CanvasRenderingContext2D, W: number, H: number, heightAt: (i: number) => number): void {
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(255, heightAt(i) * 255));
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** 落葉的顏色（秋色＋綠） */
const LITTER = [0xd27a2a, 0xe0a83a, 0x9a5a2a, 0xb4442a, 0x7f9a35, 0xc9902f, 0x6e4a26];

// ───────────────────────── 地面 ─────────────────────────

/**
 * 林道泥土（三條軌道鋪在上面）：濕泥深淺、小石子、彩色落葉、細枝、零星青苔。
 * 一張貼圖代表 3 m × 3 m。
 */
export function pathTextures(): TexSet {
  const W = 512;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const rnd = seeded(4401);
  const big = tileFbm(W, H, 5, 3, 4402);
  const fine = tileNoise(W, H, 110, 4403);
  const moss = tileFbm(W, H, 6, 2, 4404);
  paintBase(
    g,
    W,
    H,
    (i) => {
      const wet = sstep(0.56, 0.7, big[i]);
      let col = mix(0x8b6a47, 0x5a4330, wet);
      col = mix(col, 0x5d6e2c, sstep(0.66, 0.78, moss[i]) * 0.8);
      return col;
    },
    (i) => 0.82 + 0.22 * big[i] + 0.16 * (fine[i] - 0.5),
  );
  paintHeight(bg, W, H, (i) => 0.32 + 0.18 * big[i] + 0.12 * fine[i] - 0.1 * sstep(0.56, 0.7, big[i]));
  // 小石子：灰褐色、影子＋本體＋左上亮點（不用漸層，畫得快）
  for (let k = 0; k < 480; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 1.6 + rnd() * rnd() * 5.5;
    const tone = [0x8d867a, 0x7a6e60, 0xa49a88, 0x6a6458][Math.floor(rnd() * 4)];
    const rot = rnd() * Math.PI;
    const rx = r * (0.8 + rnd() * 0.5);
    wrap(W, H, x, y, r + 2, (xx, yy) => {
      g.fillStyle = 'rgba(30,22,14,0.45)';
      g.beginPath();
      g.ellipse(xx + 0.8, yy + 1, rx, r, rot, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(tone, 0.85);
      g.beginPath();
      g.ellipse(xx, yy, rx, r, rot, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(tone, 1.25);
      g.beginPath();
      g.ellipse(xx - rx * 0.25, yy - r * 0.25, rx * 0.55, r * 0.5, rot, 0, Math.PI * 2);
      g.fill();
      bg.fillStyle = gray(0.85);
      bg.beginPath();
      bg.ellipse(xx, yy, rx, r, rot, 0, Math.PI * 2);
      bg.fill();
    });
  }
  // 細枝
  for (let k = 0; k < 26; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const len = 18 + rnd() * 40;
    const a = rnd() * Math.PI;
    wrap(W, H, x, y, len, (xx, yy) => {
      g.strokeStyle = css(0x4a3424, 0.9 + rnd() * 0.3);
      g.lineWidth = 1.2 + rnd() * 1.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(xx, yy);
      g.quadraticCurveTo(xx + Math.cos(a) * len * 0.5 + 4, yy + Math.sin(a) * len * 0.5 - 3, xx + Math.cos(a) * len, yy + Math.sin(a) * len);
      g.stroke();
      bg.strokeStyle = gray(0.8);
      bg.lineWidth = 2;
      bg.beginPath();
      bg.moveTo(xx, yy);
      bg.lineTo(xx + Math.cos(a) * len, yy + Math.sin(a) * len);
      bg.stroke();
    });
  }
  // 落葉（秋色＋綠）
  for (let k = 0; k < 190; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const len = 9 + rnd() * 13;
    const col = LITTER[Math.floor(rnd() * LITTER.length)];
    const rot = rnd() * Math.PI * 2;
    wrap(W, H, x, y, len, (xx, yy) => {
      g.fillStyle = 'rgba(25,18,10,0.35)';
      g.save();
      g.translate(xx + 1.2, yy + 1.5);
      g.rotate(rot);
      leafPath(g, len, len * 0.45);
      g.fill();
      g.restore();
      drawLeaf(g, bg, xx, yy, len, len * 0.42, rot, col, 0.7);
    });
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/**
 * 森林地面（軌道兩側）：深色腐植土、成片青苔、落葉、小草芽。一張貼圖代表 5 m × 5 m。
 */
export function floorTextures(): TexSet {
  const W = 512;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const rnd = seeded(5501);
  const big = tileFbm(W, H, 4, 3, 5502);
  const moss = tileFbm(W, H, 5, 3, 5503);
  const fine = tileNoise(W, H, 128, 5504);
  paintBase(
    g,
    W,
    H,
    (i) => {
      // 深色腐植土＋小片橄欖綠苔（苔要暗、要碎，不能變成一大塊亮綠）
      const m = sstep(0.56, 0.68, moss[i]) * (0.55 + 0.45 * fine[i]);
      return mix(mix(0x5b4631, 0x3b2f22, sstep(0.45, 0.7, big[i])), mix(0x45602a, 0x5f7a32, fine[i]), m);
    },
    (i) => 0.82 + 0.24 * big[i] + 0.2 * (fine[i] - 0.5),
  );
  paintHeight(bg, W, H, (i) => 0.3 + 0.25 * sstep(0.56, 0.68, moss[i]) + 0.2 * fine[i]);
  // 落葉（腐葉色，偏暗）
  for (let k = 0; k < 380; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const len = 6 + rnd() * 10;
    const col = mix(LITTER[Math.floor(rnd() * LITTER.length)], 0x4a3a28, 0.3 + rnd() * 0.35);
    const rot = rnd() * Math.PI * 2;
    wrap(W, H, x, y, len, (xx, yy) => drawLeaf(g, bg, xx, yy, len, len * 0.42, rot, col, 0.65));
  }
  // 小草芽
  for (let k = 0; k < 90; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const col = [0x6f9a34, 0x5a8a2e, 0x86aa44][Math.floor(rnd() * 3)];
    wrap(W, H, x, y, 6, (xx, yy) => {
      for (let l = 0; l < 3; l++) {
        const a = (l / 3) * Math.PI * 2 + rnd();
        drawLeaf(g, bg, xx + Math.cos(a) * 2.2, yy + Math.sin(a) * 2.2, 4.5, 3.6, a + Math.PI / 2, col, 0.8, false);
      }
    });
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

// ───────────────────────── 軌道 ─────────────────────────

/**
 * 舊枕木：灰褐風化木紋（沿 u）、裂縫、木節、端部與邊緣長苔蘚。整張貼一根枕木。
 */
export function sleeperTextures(): TexSet {
  const W = 256;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const grain = tileFbm(W, H, 3, 4, 6601);
  const fine = tileNoise(W, H, 64, 6602);
  const moss = tileFbm(W, H, 4, 4, 6603);
  const mossFine = tileNoise(W, H, 96, 6604);
  const shade = new Float32Array(W * H);
  const height = new Float32Array(W * H);
  const mossAmt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // 木紋沿 x（枕木長邊）方向延伸
      const stripes = 0.5 + 0.5 * Math.sin(y * 0.55 + grain[i] * 16);
      // 裂縫：細而深的橫向暗線
      const crack = Math.abs(Math.sin(y * 0.11 + grain[i] * 9)) < 0.035 ? 1 : 0;
      shade[i] = (0.78 + 0.2 * stripes) * (0.9 + 0.2 * fine[i]) * (crack ? 0.45 : 1);
      height[i] = 0.45 + 0.25 * stripes - (crack ? 0.35 : 0);
      // 苔蘚：雜訊門檻，兩端（u 接近 0、1）比較多
      const edge = Math.min(x, W - x) / W;
      const m = sstep(0.55, 0.68, moss[i] + (0.16 - edge) * 0.9) * (0.45 + 0.55 * mossFine[i]);
      mossAmt[i] = m;
    }
  }
  paintBase(
    g,
    W,
    H,
    (i) => mix(mix(0x6b5a48, 0x52443a, grain[i]), mix(0x4a6526, 0x6f8a36, mossFine[i]), mossAmt[i]),
    (i) => shade[i] * (1 - mossAmt[i]) + (0.82 + 0.28 * mossFine[i]) * mossAmt[i],
  );
  paintHeight(bg, W, H, (i) => height[i] * (1 - mossAmt[i]) + (0.6 + 0.35 * mossFine[i]) * mossAmt[i]);
  // 木節
  const rnd = seeded(6605);
  for (let k = 0; k < 4; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 4 + rnd() * 5;
    wrap(W, H, x, y, r * 2, (xx, yy) => {
      g.strokeStyle = 'rgba(40,28,20,0.7)';
      g.lineWidth = 1.5;
      for (let ring = 0; ring < 3; ring++) {
        g.beginPath();
        g.ellipse(xx, yy, r * (1 + ring * 0.6), r * 0.5 * (1 + ring * 0.5), 0, 0, Math.PI * 2);
        g.stroke();
      }
      bg.fillStyle = gray(0.2);
      bg.beginPath();
      bg.ellipse(xx, yy, r, r * 0.5, 0, 0, Math.PI * 2);
      bg.fill();
    });
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/**
 * 金屬貼圖（鋼軌、墊板、鐵件、車輪）：
 * - u 0～0.125：被車輪磨亮的鋼面（軌頭頂面）
 * - u 0.125～0.875：鏽蝕鐵面（橘褐鏽斑、暗色鐵、凹點）
 * - u 0.875～1：墊板頂面（每 32 px 一塊，兩顆螺栓）
 */
export function metalTextures(): TexSet {
  const W = 256;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const rust = tileFbm(W, H, 6, 4, 7701);
  const fine = tileNoise(W, H, 90, 7702);
  const streak = tileNoise(W, 8, 48, 7703);
  paintBase(
    g,
    W,
    H,
    (i) => {
      const x = i % W;
      if (x < 32) return mix(0x8e8a84, 0xbab4aa, streak[x % W]);
      return mix(mix(0x4a3226, 0x7a4426, sstep(0.3, 0.55, rust[i])), 0xb0612e, sstep(0.55, 0.75, rust[i]));
    },
    (i) => {
      const x = i % W;
      if (x < 32) return 0.92 + 0.12 * fine[i];
      return 0.8 + 0.3 * fine[i] + 0.1 * rust[i];
    },
  );
  paintHeight(bg, W, H, (i) => 0.5 + 0.25 * (fine[i] - 0.5) + 0.2 * rust[i]);
  // 墊板頂面：深灰鐵板＋兩顆螺栓
  for (let y = 0; y < H; y += 32) {
    g.fillStyle = '#3e3834';
    g.fillRect(224, y, 32, 32);
    g.fillStyle = 'rgba(150,80,40,0.35)';
    g.fillRect(226, y + 2, 28, 28);
    for (const by of [y + 9, y + 23]) {
      const grd = g.createRadialGradient(237, by - 1, 0.5, 240, by, 5);
      grd.addColorStop(0, '#9a928a');
      grd.addColorStop(1, '#3a3430');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(240, by, 4.5, 0, Math.PI * 2);
      g.fill();
      bg.fillStyle = gray(0.95);
      bg.beginPath();
      bg.arc(240, by, 4.5, 0, Math.PI * 2);
      bg.fill();
    }
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

// ───────────────────────── 植物表面 ─────────────────────────

/**
 * 巨樹樹皮：一塊塊直向的厚樹皮板，板與板之間是蜿蜒的深溝（暗）、偶爾有橫向斷口；
 * 板面帶細纖維與明暗差、溝裡長青苔、板上有淺色地衣斑。
 * u 繞樹幹一圈、v 沿樹幹往上；一張約代表 2.2 m × 2.4 m（溝的擺動在 v 方向是整數週期，接縫連續）。
 */
export function barkTextures(): TexSet {
  const W = 512;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const rnd = seeded(8801);
  /** 溝的條數（= 樹皮板塊數） */
  const NF = 9;
  const sp = W / NF;
  const fb = Array.from({ length: NF }, (_, k) => (k + 0.5 + (rnd() - 0.5) * 0.35) * sp);
  const fph = Array.from({ length: NF }, () => rnd() * Math.PI * 2);
  const fq = Array.from({ length: NF }, () => 1 + Math.floor(rnd() * 3));
  const famp = Array.from({ length: NF }, () => sp * (0.1 + rnd() * 0.14));
  const fw = Array.from({ length: NF }, () => sp * (0.1 + rnd() * 0.08));
  const tone = Array.from({ length: NF }, () => 0.75 + rnd() * 0.4);
  // 每塊板的橫向斷口（y 位置）
  const brk = Array.from({ length: NF }, () => Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => rnd() * H));
  const jit = tileNoise(W, H, 40, 8802);
  const fiber = tileNoise(W, 1, 150, 8803);
  const fine = tileNoise(W, H, 110, 8807);
  const moss = tileFbm(W, H, 5, 2, 8805);
  const lichen = tileNoise(W, H, 26, 8804);
  const height = new Float32Array(W * H);
  const plateOf = new Uint8Array(W * H);
  const fxRow = new Float32Array(NF);
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < NF; k++) fxRow[k] = fb[k] + famp[k] * Math.sin((y / H) * Math.PI * 2 * fq[k] + fph[k]);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xx = x + (jit[i] - 0.5) * sp * 0.18;
      // 最近的溝（水平距離，左右繞回）與所在的板（溝的右邊那塊）
      let best = 1e9;
      let bk = 0;
      let plate = 0;
      for (let k = 0; k < NF; k++) {
        let d = xx - fxRow[k];
        if (d > W / 2) d -= W;
        if (d < -W / 2) d += W;
        const ad = Math.abs(d);
        if (ad < best) {
          best = ad;
          bk = k;
          plate = d >= 0 ? k : (k + NF - 1) % NF;
        }
      }
      // 溝 → 板：溝底平、板緣圓、板面略鼓
      let h = sstep(fw[bk] * 0.35, fw[bk] * 1.6, best);
      // 橫向斷口
      for (const by of brk[plate]) {
        let dy = Math.abs(y - by);
        if (dy > H / 2) dy = H - dy;
        if (dy < 5) h *= 0.35 + 0.65 * (dy / 5);
      }
      height[i] = h * (0.82 + 0.18 * fiber[x]) + 0.06 * (fine[i] - 0.5);
      plateOf[i] = plate;
    }
  }
  paintBase(
    g,
    W,
    H,
    (i) => {
      const h = height[i];
      const t = tone[plateOf[i]];
      // 溝底近黑褐 → 板緣暗褐 → 板面灰褐（每塊板明暗不同）
      let col = mix(0x1a120c, mix(0x47372a, 0x76604c, Math.min(1, (t - 0.75) * 2.4)), sstep(0.08, 0.7, h));
      // 溝裡與板緣的青苔
      col = mix(col, 0x3d5c22, sstep(0.56, 0.7, moss[i]) * (1 - sstep(0.35, 0.85, h)) * 0.9);
      // 板面上的淺色地衣
      col = mix(col, 0x8e9878, sstep(0.8, 0.88, lichen[i]) * sstep(0.6, 0.9, h) * 0.55);
      return col;
    },
    (i) => 0.86 + 0.22 * height[i] + 0.1 * (fine[i] - 0.5),
  );
  paintHeight(bg, W, H, (i) => height[i]);
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/**
 * 繩子（注連繩、麻繩）：三股斜向絞紋，沿繩可無縫重複。u 繞繩一圈、v 沿繩。
 * @param base 繩色
 * @param dark 絞紋縫隙色
 */
export function ropeTextures(base: number, dark: number, seed: number): TexSet {
  const W = 128;
  const H = 128;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const fine = tileNoise(W, H, 40, seed);
  const prof = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = ((x / W) * 3 + (y / H) * 3) % 1;
      prof[y * W + x] = Math.sin(Math.PI * f);
    }
  }
  paintBase(g, W, H, (i) => mix(dark, base, sstep(0.05, 0.6, prof[i])), (i) => 0.8 + 0.25 * prof[i] + 0.15 * (fine[i] - 0.5));
  paintHeight(bg, W, H, (i) => 0.15 + 0.75 * prof[i] + 0.1 * fine[i]);
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/** 苔蘚：細密的絨毛顆粒、亮綠芽尖與暗綠底。 */
export function mossTextures(): TexSet {
  const W = 256;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const big = tileFbm(W, H, 4, 3, 9901);
  const fine = tileNoise(W, H, 100, 9902);
  const fine2 = tileNoise(W, H, 50, 9903);
  paintBase(
    g,
    W,
    H,
    (i) => mix(mix(0x2d4f17, 0x4f7424, big[i]), 0x86a83e, sstep(0.7, 0.88, fine[i])),
    (i) => 0.78 + 0.3 * fine2[i] + 0.12 * (fine[i] - 0.5),
  );
  paintHeight(bg, W, H, (i) => 0.25 + 0.5 * fine[i] + 0.25 * fine2[i]);
  // 孢子體小點
  const rnd = seeded(9904);
  for (let k = 0; k < 160; k++) {
    const x = rnd() * W;
    const y = rnd() * H;
    g.fillStyle = css(0xc9b65a, 0.9 + rnd() * 0.3);
    g.beginPath();
    g.arc(x, y, 0.9 + rnd(), 0, Math.PI * 2);
    g.fill();
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/**
 * 樹冠葉叢：深綠底上疊滿大小不一的葉片（暗→亮分三層），凹凸隨葉片起伏。
 */
export function canopyTextures(): TexSet {
  const W = 512;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const rnd = seeded(1201);
  g.fillStyle = '#0f2412';
  g.fillRect(0, 0, W, H);
  bg.fillStyle = gray(0.12);
  bg.fillRect(0, 0, W, H);
  // 三層葉片：深→中→亮；亮葉少一點，整體偏深綠（陽光由材質受光表現）
  const layers: [number[], number, number][] = [
    [[0x183a1a, 0x1f4421, 0x234a1f], 380, 0.45],
    [[0x2a5a26, 0x31652a, 0x285429], 380, 0.65],
    [[0x3f7a2e, 0x4c8a34, 0x5a9a3a, 0x72aa40], 240, 0.9],
  ];
  for (const [cols, n, bump] of layers) {
    for (let k = 0; k < n; k++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const len = 20 + rnd() * 22;
      const col = cols[Math.floor(rnd() * cols.length)];
      const rot = rnd() * Math.PI * 2;
      wrap(W, H, x, y, len, (xx, yy) => {
        // 葉片下方的陰影讓層次更清楚
        g.fillStyle = 'rgba(8,20,8,0.35)';
        g.save();
        g.translate(xx + 2, yy + 3);
        g.rotate(rot);
        leafPath(g, len, len * 0.5);
        g.fill();
        g.restore();
        drawLeaf(g, bg, xx, yy, len, len * 0.46, rot, col, bump);
      });
    }
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/** 岩石：灰石、裂紋、黃綠與灰白地衣斑。 */
export function rockTextures(): TexSet {
  const W = 256;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const big = tileFbm(W, H, 4, 4, 1301);
  const fine = tileNoise(W, H, 80, 1302);
  const lich = tileFbm(W, H, 10, 3, 1303);
  const crack = tileFbm(W, H, 6, 3, 1304);
  paintBase(
    g,
    W,
    H,
    (i) => {
      let col = mix(0x6f6d64, 0x9b978a, big[i]);
      col = mix(col, 0xb7b65e, sstep(0.66, 0.72, lich[i]) * 0.8);
      col = mix(col, 0x5d7f30, sstep(0.6, 0.7, big[i] * 0.6 + lich[i] * 0.4) * 0.55);
      return col;
    },
    (i) => (Math.abs(crack[i] - 0.5) < 0.012 ? 0.45 : 0.85 + 0.25 * fine[i]),
  );
  paintHeight(bg, W, H, (i) => (Math.abs(crack[i] - 0.5) < 0.012 ? 0.1 : 0.4 + 0.3 * big[i] + 0.2 * fine[i]));
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

/** 運木台車的木板（中性淺色，由材質顏色上色）：用 proctex 風格自己畫一份帶螺栓的木板 */
export function cartPlankTextures(): TexSet {
  const W = 256;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  const [bc, bg] = makeCanvas(W, H);
  const grain = tileFbm(W, H, 3, 4, 1401);
  const fine = tileNoise(W, H, 64, 1402);
  const planks = 4;
  const pw = W / planks;
  const rnd = seeded(1403);
  const tone = Array.from({ length: planks }, () => 0.85 + rnd() * 0.25);
  const height = new Float32Array(W * H);
  const shade = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const p = Math.floor(x / pw);
      const lx = x - p * pw;
      const stripes = 0.5 + 0.5 * Math.sin(lx * 0.4 + grain[i] * 14);
      let s = tone[p] * (0.84 + 0.16 * stripes) * (0.92 + 0.14 * fine[i]);
      let h = 0.55 + 0.15 * stripes;
      if (lx < 2 || lx > pw - 2) {
        s *= 0.4;
        h = 0.05;
      }
      shade[i] = s;
      height[i] = h;
    }
  }
  paintBase(g, W, H, () => 0xd9cfc0, (i) => shade[i]);
  paintHeight(bg, W, H, (i) => height[i]);
  // 鐵釘頭
  for (let p = 0; p < planks; p++) {
    for (const y of [24, 232]) {
      const x = p * pw + pw / 2;
      g.fillStyle = '#2e2a28';
      g.beginPath();
      g.arc(x - 9, y, 3.2, 0, Math.PI * 2);
      g.arc(x + 9, y, 3.2, 0, Math.PI * 2);
      g.fill();
      bg.fillStyle = gray(0.9);
      bg.beginPath();
      bg.arc(x - 9, y, 3.2, 0, Math.PI * 2);
      bg.arc(x + 9, y, 3.2, 0, Math.PI * 2);
      bg.fill();
    }
  }
  return { map: toTex(c, true), bump: toTex(bc, false) };
}

// ───────────────────────── 帶透明的植物貼圖集 ─────────────────────────

/**
 * 把畫布轉成帶透明的 DataTexture：先把透明像素的顏色往外擴張（避免 mipmap 與 alphaTest 的黑邊），
 * 再上下翻轉成與 CanvasTexture 相同的 UV 方向（v = 1 是畫布最上面）。
 */
function alphaAtlasTexture(c: HTMLCanvasElement, fill: number): THREE.DataTexture {
  const W = c.width;
  const H = c.height;
  const src = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const rgb = new Float32Array(W * H * 3);
  let has = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = src[i * 4];
    rgb[i * 3 + 1] = src[i * 4 + 1];
    rgb[i * 3 + 2] = src[i * 4 + 2];
    has[i] = src[i * 4 + 3] > 8 ? 1 : 0;
  }
  // 1 輪擴張：透明像素取鄰近有色像素的平均（更外圈的透明像素填 fill 色）
  for (let pass = 0; pass < 1; pass++) {
    const next = has.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (has[i]) continue;
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = yy * W + xx;
            if (!has[j]) continue;
            r += rgb[j * 3];
            gg += rgb[j * 3 + 1];
            b += rgb[j * 3 + 2];
            n++;
          }
        }
        if (n) {
          rgb[i * 3] = r / n;
          rgb[i * 3 + 1] = gg / n;
          rgb[i * 3 + 2] = b / n;
          next[i] = 1;
        }
      }
    }
    has = next;
  }
  const out = new Uint8Array(W * H * 4);
  const fr = (fill >> 16) & 255;
  const fg = (fill >> 8) & 255;
  const fb = fill & 255;
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y; // 上下翻轉
    for (let x = 0; x < W; x++) {
      const i = sy * W + x;
      const o = (y * W + x) * 4;
      out[o] = has[i] ? rgb[i * 3] : fr;
      out[o + 1] = has[i] ? rgb[i * 3 + 1] : fg;
      out[o + 2] = has[i] ? rgb[i * 3 + 2] : fb;
      out[o + 3] = src[i * 4 + 3];
    }
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** 植物貼圖集（4×4 格，每格 256 px）各格位置：[欄, 列] */
export const PLANT = {
  fern: [0, 0],
  fern2: [1, 0],
  twig: [2, 0],
  ivy: [3, 0],
  grass: [0, 1],
  leaves: [1, 1],
  wire: [2, 1],
  broad: [3, 1],
  deadTwig: [0, 2],
  hangMoss: [1, 2],
  sprout: [2, 2],
  leafBunch: [3, 2],
} as const;

/** 畫一片蕨葉（羽狀複葉）：底部在格子下緣、尖端在上緣 */
function drawFernFrond(g: CanvasRenderingContext2D, ox: number, oy: number, S: number, base: number, rnd: () => number): void {
  const cx = ox + S / 2;
  const bottom = oy + S - 6;
  const top = oy + 8;
  const pairs = 17;
  // 葉軸
  g.strokeStyle = css(base, 0.6);
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx, bottom);
  g.quadraticCurveTo(cx + 3, (bottom + top) / 2, cx, top);
  g.stroke();
  for (let p = 0; p < pairs; p++) {
    const t = p / pairs; // 0 = 底、1 = 尖
    const y = bottom - (bottom - top) * (0.08 + t * 0.9);
    const len = (S * 0.46) * Math.sin(Math.PI * (0.18 + t * 0.82)) * (1 - t * 0.35);
    const wid = Math.max(3, len * 0.26);
    for (const side of [-1, 1]) {
      const ang = side * (Math.PI / 2 - 0.35 - t * 0.25);
      const col = mix(base, 0x9fd35a, 0.15 + rnd() * 0.2 + t * 0.15);
      g.save();
      g.translate(cx + side * 2, y);
      g.rotate(ang);
      // 小羽片：有鋸齒的長葉
      g.beginPath();
      g.moveTo(0, 0);
      const seg = 6;
      for (let s = 0; s <= seg; s++) {
        const u = s / seg;
        const w = wid * Math.sin(Math.PI * Math.min(1, u * 1.05)) * (s % 2 === 0 ? 1 : 0.72);
        g.lineTo(w, -len * u);
      }
      for (let s = seg; s >= 0; s--) {
        const u = s / seg;
        const w = wid * Math.sin(Math.PI * Math.min(1, u * 1.05)) * (s % 2 === 0 ? 1 : 0.72);
        g.lineTo(-w * 0.85, -len * u);
      }
      g.closePath();
      const grd = g.createLinearGradient(0, 0, 0, -len);
      grd.addColorStop(0, css(col, 0.75));
      grd.addColorStop(1, css(col, 1.12));
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = css(col, 0.55);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -len * 0.95);
      g.stroke();
      g.restore();
    }
  }
}

/**
 * 植物貼圖集（1024×1024、帶透明）：蕨葉兩款、闊葉枝叢、垂藤、草叢、四色單片落葉、
 * 帶刺鐵絲、大型闊葉、枯枝、垂掛苔蘚、小芽、葉束。
 */
export function plantAtlas(): THREE.DataTexture {
  const N = 4;
  const S = 256;
  const [c, g] = makeCanvas(S * N, S * N);
  const rnd = seeded(2101);
  /** 植物貼圖集某一格的左上角像素座標 */
  const at = (key: keyof typeof PLANT): [number, number] => [PLANT[key][0] * S, PLANT[key][1] * S];

  // 蕨葉兩款
  {
    const [x, y] = at('fern');
    drawFernFrond(g, x, y, S, 0x5fa83a, rnd);
    const [x2, y2] = at('fern2');
    drawFernFrond(g, x2, y2, S, 0x3f8a3a, rnd);
  }
  // 闊葉枝叢（樹冠邊緣卡片、灌木）：從底部中央分出的小枝，掛滿卵形葉
  {
    const [ox, oy] = at('twig');
    const cx = ox + S / 2;
    for (let b = 0; b < 7; b++) {
      const a = -Math.PI / 2 + (b - 3) * 0.32 + (rnd() - 0.5) * 0.2;
      const len = S * (0.32 + rnd() * 0.14);
      const ex = cx + Math.cos(a) * len;
      const ey = oy + S * 0.92 + Math.sin(a) * len;
      g.strokeStyle = '#4a3a26';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx, oy + S - 4);
      g.lineTo(ex, ey);
      g.stroke();
      for (let l = 0; l < 7; l++) {
        const t = 0.25 + (l / 7) * 0.8;
        const px = cx + (ex - cx) * t;
        const py = oy + S - 4 + (ey - (oy + S - 4)) * t;
        const side = l % 2 === 0 ? 1 : -1;
        const la = a + Math.PI / 2 + side * (0.6 + rnd() * 0.4);
        const col = [0x3f7a2c, 0x4f8f34, 0x5ea23c, 0x6cb244, 0x37702a][Math.floor(rnd() * 5)];
        drawLeaf(g, null, px + Math.cos(la - Math.PI / 2) * 10, py + Math.sin(la - Math.PI / 2) * 10, 30 + rnd() * 10, 13, la, col);
      }
    }
  }
  // 垂藤：一條細莖，左右交錯掛心形葉（沿 v 方向）
  {
    const [ox, oy] = at('ivy');
    for (const sx of [0.32, 0.68]) {
      const cx = ox + S * sx;
      g.strokeStyle = '#3d5a22';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx, oy);
      for (let y = 0; y <= S; y += 16) g.lineTo(cx + Math.sin(y * 0.05 + sx * 9) * 6, oy + y);
      g.stroke();
      for (let y = 6; y < S - 6; y += 13) {
        const side = (y / 13) % 2 < 1 ? 1 : -1;
        const px = cx + Math.sin(y * 0.05 + sx * 9) * 6 + side * 9;
        const col = [0x3f7f2e, 0x56953a, 0x6aa842, 0x2f6a2a][Math.floor(rnd() * 4)];
        drawLeaf(g, null, px, oy + y, 20, 14, side * 0.9 + Math.PI, col);
      }
    }
  }
  // 草叢：從底部往上的細長葉
  {
    const [ox, oy] = at('grass');
    for (let k = 0; k < 46; k++) {
      const bx = ox + S * (0.2 + rnd() * 0.6);
      const h = S * (0.45 + rnd() * 0.5);
      const lean = (rnd() - 0.5) * S * 0.5;
      const col = [0x5f9a32, 0x76b03c, 0x4a8a2c, 0x8fbf4a][Math.floor(rnd() * 4)];
      g.fillStyle = css(col);
      g.beginPath();
      g.moveTo(bx - 4, oy + S);
      g.quadraticCurveTo(bx + lean * 0.3, oy + S - h * 0.6, bx + lean, oy + S - h);
      g.quadraticCurveTo(bx + lean * 0.3 + 3, oy + S - h * 0.6, bx + 4, oy + S);
      g.closePath();
      g.fill();
    }
  }
  // 四色單片落葉（2×2 小格）：綠、黃、橘、紅褐
  {
    const [ox, oy] = at('leaves');
    const cols = [0x6fa83a, 0xe2b23a, 0xd9782a, 0xa8482a];
    for (let k = 0; k < 4; k++) {
      const x = ox + (k % 2) * (S / 2) + S / 4;
      const y = oy + Math.floor(k / 2) * (S / 2) + S / 4;
      drawLeaf(g, null, x, y, S * 0.42, S * 0.2, 0.25, cols[k]);
      g.strokeStyle = css(cols[k], 0.5);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x - 4, y + S * 0.2);
      g.lineTo(x - 7, y + S * 0.24);
      g.stroke();
    }
  }
  // 帶刺鐵絲：格子中間一條水平帶（兩股絞在一起＋每隔一段一組刺）
  {
    const [ox, oy] = at('wire');
    const cy = oy + S / 2;
    g.strokeStyle = '#3a3634';
    g.lineWidth = 3;
    for (const ph of [0, Math.PI]) {
      g.beginPath();
      for (let x = 0; x <= S; x += 4) {
        const y = cy + Math.sin(x * 0.2 + ph) * 3;
        if (x === 0) g.moveTo(ox + x, y);
        else g.lineTo(ox + x, y);
      }
      g.stroke();
    }
    g.lineWidth = 2.5;
    for (let x = 16; x < S; x += 42) {
      g.beginPath();
      g.moveTo(ox + x - 7, cy - 9);
      g.lineTo(ox + x + 7, cy + 9);
      g.moveTo(ox + x + 7, cy - 9);
      g.lineTo(ox + x - 7, cy + 9);
      g.stroke();
    }
  }
  // 大型闊葉（林下的大葉植物）：三片大葉
  {
    const [ox, oy] = at('broad');
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k - 1) * 0.55;
      const cx = ox + S / 2 + Math.cos(a) * S * 0.2;
      const cy = oy + S * 0.86 + Math.sin(a) * S * 0.36;
      g.strokeStyle = '#5a7a2e';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(ox + S / 2, oy + S - 2);
      g.lineTo(cx, cy + S * 0.12);
      g.stroke();
      drawLeaf(g, null, cx, cy - S * 0.08, S * 0.5, S * 0.3, a + Math.PI / 2, [0x3f8a34, 0x4c9a3a, 0x357a2c][k]);
    }
  }
  // 枯枝：分岔的褐色細枝
  {
    const [ox, oy] = at('deadTwig');
    /** 遞迴畫分岔的枯枝 */
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      g.strokeStyle = depth > 1 ? '#5a4030' : '#6e5038';
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(ex, ey);
      g.stroke();
      if (depth < 3) {
        branch(ex, ey, a - 0.45 - rnd() * 0.3, len * 0.66, w * 0.65, depth + 1);
        branch(ex, ey, a + 0.4 + rnd() * 0.3, len * 0.6, w * 0.65, depth + 1);
      }
    };
    branch(ox + S / 2, oy + S - 4, -Math.PI / 2, S * 0.34, 8, 0);
  }
  // 垂掛苔蘚（松蘿）：一束束往下的細絲
  {
    const [ox, oy] = at('hangMoss');
    for (let k = 0; k < 60; k++) {
      const x = ox + S * (0.15 + rnd() * 0.7);
      const len = S * (0.4 + rnd() * 0.58);
      g.strokeStyle = css([0x8aa05a, 0x9fb36a, 0x6f8a46, 0xb0c27a][Math.floor(rnd() * 4)]);
      g.lineWidth = 1.2 + rnd() * 1.8;
      g.beginPath();
      g.moveTo(x, oy + 2);
      g.bezierCurveTo(x + (rnd() - 0.5) * 20, oy + len * 0.3, x + (rnd() - 0.5) * 30, oy + len * 0.7, x + (rnd() - 0.5) * 20, oy + len);
      g.stroke();
    }
  }
  // 小芽（枕木之間、路肩）
  {
    const [ox, oy] = at('sprout');
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.5;
      drawLeaf(g, null, ox + S / 2 + Math.cos(a) * S * 0.2, oy + S * 0.75 + Math.sin(a) * S * 0.25, S * 0.36, S * 0.16, a + Math.PI / 2, [0x7fbf3a, 0x6aaa34, 0x92cc4a][k % 3]);
    }
  }
  // 葉束（高橫樑藤蔓上垂掛的葉）
  {
    const [ox, oy] = at('leafBunch');
    for (let k = 0; k < 12; k++) {
      const x = ox + S * (0.2 + rnd() * 0.6);
      const y = oy + S * (0.25 + rnd() * 0.6);
      const col = [0x4f8f34, 0x5ea23c, 0x6cb244, 0x3f7a2c][Math.floor(rnd() * 4)];
      drawLeaf(g, null, x, y, 46 + rnd() * 20, 22, Math.PI + (rnd() - 0.5) * 1.2, col);
    }
  }
  return alphaAtlasTexture(c, 0x3f6a2a);
}

// ───────────────────────── 道具貼圖集 ─────────────────────────

/** 道具貼圖集（4×4 格，每格 128 px）各格位置：[欄, 列] */
export const PROP = {
  ringsFresh: [0, 0],
  ringsOld: [1, 0],
  capRed: [2, 0],
  capBrown: [3, 0],
  capGlow: [0, 1],
  stem: [1, 1],
  signDanger: [2, 1],
  signKeepOut: [3, 1],
  board: [0, 2],
  straw: [1, 2],
  hemp: [2, 2],
  paper: [3, 2],
  fungus: [0, 3],
  gills: [1, 3],
  lamp: [2, 3],
  rust: [3, 3],
} as const;

/** 道具貼圖集：顏色＋自發光（只有發光香菇與油燈玻璃會亮） */
interface PropAtlas {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

/** 畫年輪切面（圓心在格子中央、外圈是樹皮） */
function drawRings(g: CanvasRenderingContext2D, bg: CanvasRenderingContext2D, ox: number, oy: number, S: number, wood: number, ring: number, old: boolean, rnd: () => number): void {
  const cx = ox + S / 2;
  const cy = oy + S / 2;
  const R = S / 2;
  g.fillStyle = css(old ? 0x4a3a2c : 0x553c28);
  g.fillRect(ox, oy, S, S);
  // 木頭底色（中心亮、外圈暗）
  const grd = g.createRadialGradient(cx, cy, 2, cx, cy, R * 0.88);
  grd.addColorStop(0, css(wood, 1.12));
  grd.addColorStop(1, css(wood, 0.82));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, R * 0.88, 0, Math.PI * 2);
  g.fill();
  bg.fillStyle = gray(0.6);
  bg.fillRect(ox, oy, S, S);
  // 年輪：略不規則的同心圓
  for (let k = 1; k < 13; k++) {
    const r = (R * 0.86 * k) / 13;
    g.strokeStyle = css(ring, 0.9 + rnd() * 0.25, 0.75);
    g.lineWidth = 1 + rnd() * 1.4;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) {
      const rr = r * (1 + Math.sin(a * 3 + k) * 0.03 + Math.sin(a * 5 - k) * 0.02);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
    bg.strokeStyle = gray(0.45);
    bg.lineWidth = 1.2;
    bg.beginPath();
    bg.arc(cx, cy, r, 0, Math.PI * 2);
    bg.stroke();
  }
  // 髓心與放射狀裂紋
  g.fillStyle = css(ring, 0.7);
  g.beginPath();
  g.arc(cx, cy, 2.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = css(0x2a1c12, 1, 0.8);
  g.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
    g.lineTo(cx + Math.cos(a) * R * (0.4 + rnd() * 0.4), cy + Math.sin(a) * R * (0.4 + rnd() * 0.4));
    g.stroke();
  }
  // 外圈樹皮
  g.strokeStyle = css(old ? 0x3a2c22 : 0x4a3426);
  g.lineWidth = R * 0.14;
  g.beginPath();
  g.arc(cx, cy, R * 0.93, 0, Math.PI * 2);
  g.stroke();
  if (old) {
    // 舊切面：邊緣長苔
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2;
      const r = R * (0.75 + rnd() * 0.15);
      g.fillStyle = css(0x5f8f2c, 0.9 + rnd() * 0.3, 0.8);
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + rnd() * 4, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** 畫圓形菇傘（由上往下看）：底色漸層＋斑點 */
function drawCap(g: CanvasRenderingContext2D, ox: number, oy: number, S: number, base: number, spot: number, spots: number, rnd: () => number): void {
  const cx = ox + S / 2;
  const cy = oy + S / 2;
  g.fillStyle = css(base, 0.6);
  g.fillRect(ox, oy, S, S);
  const grd = g.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, S / 2);
  grd.addColorStop(0, css(base, 1.25));
  grd.addColorStop(0.7, css(base, 1));
  grd.addColorStop(1, css(base, 0.7));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 1, 0, Math.PI * 2);
  g.fill();
  for (let k = 0; k < spots; k++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * S * 0.42;
    g.fillStyle = css(spot, 0.95 + rnd() * 0.1);
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + rnd() * 5, 3 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

/** 畫警告牌文字（會依格子寬度縮字） */
function signText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, color: string): void {
  g.font = `900 ${size}px 'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', 'Heiti TC', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, x, y, maxW);
}

/**
 * 道具貼圖集（512×512，4×4 格）：年輪（新／舊）、紅白／褐色／發光菇傘、菇柄、
 * 「危險」三角警告牌、「禁止進入」牌、風化木板、注連繩稻草、麻繩、紙垂白紙、
 * 層孔菌、菌褶、油燈玻璃、鏽鐵。另外輸出自發光貼圖與凹凸貼圖。
 */
export function propAtlas(): PropAtlas {
  const N = 4;
  const S = 128;
  const [c, g] = makeCanvas(S * N, S * N);
  const [ec, eg] = makeCanvas(S * N, S * N);
  const [bc, bg] = makeCanvas(S * N, S * N);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, S * N, S * N);
  bg.fillStyle = gray(0.5);
  bg.fillRect(0, 0, S * N, S * N);
  const rnd = seeded(3101);
  /** 道具貼圖集某一格的左上角像素座標 */
  const at = (key: keyof typeof PROP): [number, number] => [PROP[key][0] * S, PROP[key][1] * S];

  {
    const [x, y] = at('ringsFresh');
    drawRings(g, bg, x, y, S, 0xd8ad72, 0x9a6a3c, false, rnd);
    const [x2, y2] = at('ringsOld');
    drawRings(g, bg, x2, y2, S, 0xa89072, 0x6e5a44, true, rnd);
  }
  {
    const [x, y] = at('capRed');
    drawCap(g, x, y, S, 0xd8302a, 0xf6efe0, 16, rnd);
    const [x2, y2] = at('capBrown');
    drawCap(g, x2, y2, S, 0xa0683a, 0xe0c49a, 7, rnd);
    const [x3, y3] = at('capGlow');
    drawCap(g, x3, y3, S, 0x4fd0d8, 0xc8fff4, 12, rnd);
    // 自發光：整個菇傘發青光
    const grd = eg.createRadialGradient(x3 + S / 2, y3 + S / 2, 4, x3 + S / 2, y3 + S / 2, S / 2);
    grd.addColorStop(0, '#9ff8f0');
    grd.addColorStop(1, '#2a9aa8');
    eg.fillStyle = grd;
    eg.fillRect(x3, y3, S, S);
  }
  {
    // 菇柄：奶油色、細直紋
    const [x, y] = at('stem');
    const grd = g.createLinearGradient(x, y, x + S, y);
    grd.addColorStop(0, '#d8cbb0');
    grd.addColorStop(0.5, '#f4ead6');
    grd.addColorStop(1, '#cdbfa2');
    g.fillStyle = grd;
    g.fillRect(x, y, S, S);
    g.strokeStyle = 'rgba(150,130,100,0.35)';
    g.lineWidth = 1;
    for (let k = 0; k < 18; k++) {
      const xx = x + rnd() * S;
      g.beginPath();
      g.moveTo(xx, y);
      g.lineTo(xx + (rnd() - 0.5) * 6, y + S);
      g.stroke();
    }
  }
  {
    // 「危險」三角警告牌：風化木板底＋黃色三角形＋驚嘆號＋文字
    const [x, y] = at('signDanger');
    g.fillStyle = '#7a6448';
    g.fillRect(x, y, S, S);
    g.strokeStyle = 'rgba(50,36,24,0.6)';
    g.lineWidth = 1.5;
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      g.moveTo(x, y + (S * k) / 4);
      g.lineTo(x + S, y + (S * k) / 4 + (rnd() - 0.5) * 3);
      g.stroke();
    }
    const cx = x + S / 2;
    g.fillStyle = '#1c1612';
    g.beginPath();
    g.moveTo(cx, y + 8);
    g.lineTo(x + S - 10, y + 82);
    g.lineTo(x + 10, y + 82);
    g.closePath();
    g.fill();
    g.fillStyle = '#f2c22e';
    g.beginPath();
    g.moveTo(cx, y + 19);
    g.lineTo(x + S - 21, y + 76);
    g.lineTo(x + 21, y + 76);
    g.closePath();
    g.fill();
    g.fillStyle = '#1c1612';
    g.fillRect(cx - 4, y + 36, 8, 24);
    g.beginPath();
    g.arc(cx, y + 67, 4.5, 0, Math.PI * 2);
    g.fill();
    signText(g, '危險', cx, y + 104, S - 12, 32, '#b81e1e');
    // 斑駁：掉漆
    for (let k = 0; k < 30; k++) {
      g.fillStyle = 'rgba(122,100,72,0.55)';
      g.fillRect(x + rnd() * S, y + rnd() * S, 2 + rnd() * 6, 1 + rnd() * 3);
    }
  }
  {
    // 「禁止進入」牌：白底紅框、紅色禁止圓圈、文字
    const [x, y] = at('signKeepOut');
    g.fillStyle = '#efe8da';
    g.fillRect(x, y, S, S);
    g.strokeStyle = '#c42424';
    g.lineWidth = 8;
    g.strokeRect(x + 5, y + 5, S - 10, S - 10);
    const cx = x + S / 2;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, y + 44, 24, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 17, y + 27);
    g.lineTo(cx + 17, y + 61);
    g.stroke();
    signText(g, '禁止進入', cx, y + 95, S - 22, 25, '#1e1a16');
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(110,90,60,${0.15 + rnd() * 0.3})`;
      g.fillRect(x + rnd() * S, y + rnd() * S, 1 + rnd() * 5, 1 + rnd() * 4);
    }
  }
  {
    // 風化木板（灰褐、直紋、裂縫）
    const [x, y] = at('board');
    g.fillStyle = '#6e5e4c';
    g.fillRect(x, y, S, S);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(${40 + rnd() * 40},${32 + rnd() * 30},${24 + rnd() * 20},0.45)`;
      g.lineWidth = 1 + rnd() * 1.5;
      const xx = x + rnd() * S;
      g.beginPath();
      g.moveTo(xx, y);
      g.bezierCurveTo(xx + 4, y + S * 0.3, xx - 4, y + S * 0.6, xx + (rnd() - 0.5) * 6, y + S);
      g.stroke();
    }
    for (let k = 0; k < 12; k++) {
      bg.fillStyle = gray(0.3);
      bg.fillRect(x + rnd() * S, y, 1.5, S);
    }
  }
  {
    // 注連繩稻草：金黃色斜向絞紋
    const [x, y] = at('straw');
    g.fillStyle = '#c9b276';
    g.fillRect(x, y, S, S);
    for (let k = -S; k < S * 2; k += 10) {
      const grd = g.createLinearGradient(x + k, y, x + k + 10, y);
      grd.addColorStop(0, '#9e8650');
      grd.addColorStop(0.5, '#ecd9a0');
      grd.addColorStop(1, '#9e8650');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x + k, y);
      g.lineTo(x + k + 10, y);
      g.lineTo(x + k + 10 - S * 0.6, y + S);
      g.lineTo(x + k - S * 0.6, y + S);
      g.closePath();
      g.fill();
      bg.fillStyle = gray(0.75);
      bg.beginPath();
      bg.moveTo(x + k + 2, y);
      bg.lineTo(x + k + 7, y);
      bg.lineTo(x + k + 7 - S * 0.6, y + S);
      bg.lineTo(x + k + 2 - S * 0.6, y + S);
      bg.closePath();
      bg.fill();
    }
    // 稻草細絲
    g.strokeStyle = 'rgba(255,240,190,0.5)';
    g.lineWidth = 1;
    for (let k = 0; k < 50; k++) {
      const xx = x + rnd() * S;
      const yy = y + rnd() * S;
      g.beginPath();
      g.moveTo(xx, yy);
      g.lineTo(xx - 6, yy + 10);
      g.stroke();
    }
  }
  {
    // 麻繩：褐色斜向絞紋（較細密）
    const [x, y] = at('hemp');
    g.fillStyle = '#8a6c46';
    g.fillRect(x, y, S, S);
    for (let k = -S; k < S * 2; k += 8) {
      g.fillStyle = 'rgba(60,42,26,0.55)';
      g.beginPath();
      g.moveTo(x + k, y);
      g.lineTo(x + k + 3, y);
      g.lineTo(x + k + 3 - S * 0.7, y + S);
      g.lineTo(x + k - S * 0.7, y + S);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(200,170,120,0.35)';
      g.beginPath();
      g.moveTo(x + k + 4, y);
      g.lineTo(x + k + 6, y);
      g.lineTo(x + k + 6 - S * 0.7, y + S);
      g.lineTo(x + k + 4 - S * 0.7, y + S);
      g.closePath();
      g.fill();
    }
  }
  {
    // 紙垂白紙：淡淡纖維
    const [x, y] = at('paper');
    g.fillStyle = '#f6f3ea';
    g.fillRect(x, y, S, S);
    for (let k = 0; k < 60; k++) {
      g.strokeStyle = 'rgba(200,190,170,0.35)';
      g.lineWidth = 0.8;
      const xx = x + rnd() * S;
      const yy = y + rnd() * S;
      g.beginPath();
      g.moveTo(xx, yy);
      g.lineTo(xx + (rnd() - 0.5) * 14, yy + (rnd() - 0.5) * 14);
      g.stroke();
    }
  }
  {
    // 層孔菌（樹幹上的檐狀菇）：橘褐同心色帶
    const [x, y] = at('fungus');
    const cx = x + S / 2;
    const cy = y + S;
    for (let k = 10; k >= 1; k--) {
      g.fillStyle = css([0xe39a3a, 0xc9742e, 0xf2c068, 0xa65a2a, 0xf0dca8][k % 5]);
      g.beginPath();
      g.arc(cx, cy, (S * k) / 10, Math.PI, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f4e6c4';
    g.fillRect(x, y + S - 8, S, 8);
  }
  {
    // 菌褶：放射狀細紋
    const [x, y] = at('gills');
    const cx = x + S / 2;
    const cy = y + S / 2;
    g.fillStyle = '#e9d9ba';
    g.fillRect(x, y, S, S);
    g.strokeStyle = 'rgba(140,110,80,0.6)';
    g.lineWidth = 1;
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
      g.lineTo(cx + Math.cos(a) * S * 0.5, cy + Math.sin(a) * S * 0.5);
      g.stroke();
    }
    g.fillStyle = '#d6c4a0';
    g.beginPath();
    g.arc(cx, cy, 11, 0, Math.PI * 2);
    g.fill();
  }
  {
    // 油燈玻璃：暖黃中心、橘色外圍；自發光同樣暖黃
    const [x, y] = at('lamp');
    for (const ctx of [g, eg]) {
      const grd = ctx.createRadialGradient(x + S / 2, y + S * 0.55, 4, x + S / 2, y + S / 2, S * 0.7);
      grd.addColorStop(0, '#fffbe6');
      grd.addColorStop(0.35, '#ffd36a');
      grd.addColorStop(1, '#e0782a');
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, S, S);
    }
  }
  {
    // 鏽鐵
    const [x, y] = at('rust');
    g.fillStyle = '#4a3a32';
    g.fillRect(x, y, S, S);
    for (let k = 0; k < 120; k++) {
      g.fillStyle = css([0xa0582a, 0x7a4024, 0x5a463c, 0xc06a30][Math.floor(rnd() * 4)], 1, 0.6);
      g.beginPath();
      g.arc(x + rnd() * S, y + rnd() * S, 1 + rnd() * 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  return { map: toTex(c, true, false), emissive: toTex(ec, true, false), bump: toTex(bc, false, false) };
}

// ───────────────────────── 光效 ─────────────────────────

/**
 * 光效貼圖（加法混合用，黑色＝透明）：
 * - 左半（u 0～0.5）：直向光束，上亮下淡、左右柔邊、帶細細的塵埃條紋
 * - 右上（u 0.5～1、v 0.5～1）：圓形柔光（油燈光暈）
 * - 右下（u 0.5～1、v 0～0.5）：地面光斑（樹葉縫隙透下來的斑駁光）
 */
export function fxTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const d = img.data;
  const streak = tileNoise(128, 4, 20, 4101);
  const dap = tileFbm(128, 128, 6, 3, 4102);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      let v = 0;
      if (x < 128) {
        const across = (x - 63.5) / 64;
        const soft = Math.exp(-across * across * 4.5) * sstep(1, 0.88, Math.abs(across));
        const along = y / (S - 1); // 0 = 上
        const fadeV = Math.pow(1 - along, 0.9) * sstep(0, 0.08, along) + 0.12 * (1 - along);
        v = soft * fadeV * (0.75 + 0.5 * streak[x % 128]);
      } else if (y < 128) {
        const dx = (x - 192) / 64;
        const dy = (y - 64) / 64;
        const r2 = dx * dx + dy * dy;
        v = Math.exp(-r2 * 3.2) * sstep(1, 0.8, Math.sqrt(r2));
      } else {
        const dx = (x - 192) / 64;
        const dy = (y - 192) / 64;
        const r = Math.sqrt(dx * dx + dy * dy);
        const n = dap[(y - 128) * 128 + (x - 128)];
        v = sstep(1, 0.35, r) * sstep(0.35, 0.6, n + (1 - r) * 0.3);
      }
      const cv = Math.max(0, Math.min(255, v * 255));
      d[i] = cv;
      d[i + 1] = cv;
      d[i + 2] = cv;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c, true, false);
}

/**
 * 遠景兩側的樹林剪影（帶透明，左右可無縫重複）：上方透明、兩層樹（遠層淡、近層暗）的樹冠團與樹幹、
 * 樹幹底部外擴成板根，下半部是越往下越濃的林下霧綠。
 */
export function silhouetteTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [c, g] = makeCanvas(W, H);
  const rnd = seeded(9401);
  const grd = g.createLinearGradient(0, H * 0.3, 0, H);
  grd.addColorStop(0, 'rgba(84,112,80,0)');
  grd.addColorStop(0.5, 'rgba(78,106,74,0.9)');
  grd.addColorStop(1, 'rgba(48,72,50,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const layers: [number, number, number, number, number][] = [
    [18, 0x5f7e58, 0x56764f, 12, 22],
    [11, 0x3a5439, 0x2f4d30, 24, 42],
  ];
  for (const [n, col, crown, wmin, wmax] of layers) {
    for (let k = 0; k < n; k++) {
      const x = (k + rnd() * 0.8) * (W / n);
      const w = wmin + rnd() * (wmax - wmin);
      const blobs = Array.from({ length: 5 }, () => [(rnd() - 0.5) * w * 5, H * (0.05 + rnd() * 0.16), w * (1.6 + rnd() * 1.6), w * (0.8 + rnd() * 0.6)]);
      wrap(W, H, x, H / 2, w * 4, (xx) => {
        g.fillStyle = css(col);
        g.beginPath();
        g.moveTo(xx - w * 0.4, H * 0.12);
        g.lineTo(xx + w * 0.4, H * 0.12);
        g.lineTo(xx + w * 0.7, H * 0.84);
        g.quadraticCurveTo(xx + w * 1.8, H * 0.95, xx + w * 2.4, H);
        g.lineTo(xx - w * 2.4, H);
        g.quadraticCurveTo(xx - w * 1.8, H * 0.95, xx - w * 0.7, H * 0.84);
        g.closePath();
        g.fill();
        g.fillStyle = css(crown);
        for (const [bx, by, bw, bh] of blobs) {
          g.beginPath();
          g.ellipse(xx + bx, by, bw, bh, 0, 0, Math.PI * 2);
          g.fill();
        }
      });
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** 螢火蟲光點（Points 用）：亮核心＋柔光暈 */
export function fireflyTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, g] = makeCanvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,235,1)');
  grd.addColorStop(0.18, 'rgba(255,240,170,0.95)');
  grd.addColorStop(0.45, 'rgba(220,200,90,0.35)');
  grd.addColorStop(1, 'rgba(160,160,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return toTex(c, true, false);
}
