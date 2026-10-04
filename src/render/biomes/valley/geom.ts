import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, fbm3, smoothstep } from './noise';
import type { AtlasRect } from './textures';
import { paletteUV } from './textures';

/**
 * 終末之谷的幾何工具：圓角岩塊、卡片（植物、霧、水花）、浪花環、細瀑布緞帶、繩子、小道具。
 * 範本幾何一律轉成非索引（合併時不必再展開），uv 依各材質的約定填好。
 */

/** 岩塊參數 */
interface RockBlockOptions {
  /** 每公尺細分數（越大越細） */
  density?: number;
  /** 圓角半徑（公尺） */
  radius?: number;
  /** 表面起伏振幅（公尺） */
  amp?: number;
  /** 起伏頻率（每公尺） */
  freq?: number;
  seed?: number;
  /** 頂面保持平坦（玩家會踩在上面） */
  flatTop?: boolean;
  /** 岩層色調（寫進 uv.x，0..1） */
  tint?: number;
}

/**
 * 圓角岩塊：細分方塊 → 往圓角形狀推 → 沿法線加 fbm 起伏 → 平滑法線。
 * 中心在原點；uv.x = 色調、uv.y = 遮蔽（底部與凹處較暗）。
 */
export function rockBlock(w: number, h: number, d: number, o: RockBlockOptions = {}): THREE.BufferGeometry {
  const density = o.density ?? 2;
  const r = Math.max(0.02, Math.min(o.radius ?? 0.2, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
  const amp = o.amp ?? 0.08;
  const freq = o.freq ?? 0.8;
  const seed = o.seed ?? 1;
  const sx = Math.max(2, Math.ceil(w * density));
  const sy = Math.max(2, Math.ceil(h * density));
  const sz = Math.max(2, Math.ceil(d * density));
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const n = pos.count;
  /** 每個頂點的凹凸量（算遮蔽用） */
  const dent = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    // 圓角：先找內縮方塊上最近的點，再沿方向推到半徑 r
    const ix = clamp(x, -hx + r, hx - r);
    const iy = clamp(y, -hy + r, hy - r);
    const iz = clamp(z, -hz + r, hz - r);
    let nx = x - ix;
    let ny = y - iy;
    let nz = z - iz;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    x = ix + nx * r;
    y = iy + ny * r;
    z = iz + nz * r;
    let disp = amp * (fbm3(x * freq, y * freq, z * freq, seed, 3) - 0.5) * 2.2;
    if (o.flatTop) disp *= 1 - smoothstep(0.35, 0.85, ny);
    dent[i] = disp / Math.max(1e-4, amp);
    x += nx * disp;
    y += ny * disp;
    z += nz * disp;
    if (o.flatTop) y = Math.min(y, hy);
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(n * 2);
  const tint = o.tint ?? 0.5;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const bottom = smoothstep(-hy, -hy + Math.min(1.2, h * 0.5), y);
    uv[i * 2] = tint;
    uv[i * 2 + 1] = clamp((0.62 + 0.38 * bottom) * (0.86 + 0.14 * clamp(dent[i], -1, 1)), 0, 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** 把幾何轉成非索引（範本用，合併時省掉展開的時間） */
export function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

/** 把整個幾何的 uv 設成同一個值（調色盤格子、岩石色調／遮蔽） */
export function fillUV(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = u;
    a[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
  return g;
}

/** 把幾何的 uv 指到調色盤的某一格（整個零件同一個顏色） */
export function paint(g: THREE.BufferGeometry, paletteIndex: number): THREE.BufferGeometry {
  const [u, v] = paletteUV(paletteIndex);
  return fillUV(g, u, v);
}

/** 把 0..1 的 uv 重新對應到圖集的某個區塊 */
function remapUV(g: THREE.BufferGeometry, rect: AtlasRect): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect.u0 + uv.getX(i) * (rect.u1 - rect.u0), rect.v0 + uv.getY(i) * (rect.v1 - rect.v0));
  }
}

/** 合併數個幾何（全部先轉非索引） */
export function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (!f.attributes.normal) f.computeVertexNormals();
    return f;
  });
  const m = mergeGeometries(list, false);
  if (!m) throw new Error('valley geom：mergeAll 失敗');
  return m;
}

/**
 * 直立卡片（植物、垂藤）：底邊中心在原點、往 +y 長、正面朝 +z，uv 對應到圖集區塊。
 */
export function card(w: number, h: number, rect: AtlasRect): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2, 0);
  remapUV(g, rect);
  return flat(g);
}

/** 平放的卡片（荷葉）：中心在原點、朝 +y */
export function flatCard(w: number, d: number, rect: AtlasRect): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  remapUV(g, rect);
  return flat(g);
}

/** 交叉卡片（count 張繞 y 軸平均旋轉，從各角度看都有體積） */
export function crossCard(w: number, h: number, rect: AtlasRect, count = 3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const c = card(w, h, rect);
    c.rotateY((i * Math.PI) / count);
    parts.push(c);
  }
  return mergeAll(parts);
}

/** 設定水效 uv：u = 區塊編號 + 區內 u（0..0.999），v 原樣 */
function fxUV(g: THREE.BufferGeometry, region: number, vScale = 1): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, region + Math.min(0.999, uv.getX(i)), uv.getY(i) * vScale);
}

/** 平放在水面的水效方塊（漣漪），中心在原點 */
export function fxFlat(w: number, d: number, region: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  fxUV(g, region);
  return flat(g);
}

/** 直立的水效卡片（水花、霧），底邊中心在原點、正面朝 +z */
export function fxCard(w: number, h: number, region: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2, 0);
  fxUV(g, region);
  return flat(g);
}

/** 交叉的水效卡片（水花從各角度都看得到） */
export function fxCross(w: number, h: number, region: number, count = 2): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const c = fxCard(w, h, region);
    c.rotateY((i * Math.PI) / count + 0.3);
    parts.push(c);
  }
  return mergeAll(parts);
}

/**
 * 圓角矩形的外框點（逆時針），給浪花環用。
 * @param hw 半寬（x）
 * @param hd 半深（z）
 * @param rc 圓角半徑
 */
function roundedRect(hw: number, hd: number, rc: number, seg: number): [number, number][] {
  const pts: [number, number][] = [];
  const c = Math.min(rc, hw, hd);
  const corners: [number, number, number][] = [
    [hw - c, hd - c, 0],
    [-(hw - c), hd - c, Math.PI / 2],
    [-(hw - c), -(hd - c), Math.PI],
    [hw - c, -(hd - c), (Math.PI * 3) / 2],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * c, cz + Math.sin(a) * c]);
    }
  }
  return pts;
}

/**
 * 浪花環：圍著物體底部一圈（內緣貼物體、外緣淡出），平放在水面上方一點點。
 * 中心在原點；uv = (浪花區塊, 0 內緣 → 1 外緣)。
 * @param hw 物體半寬（x）
 * @param hd 物體半深（z）
 * @param rc 物體底部的圓角半徑（圓形物體給 min(hw, hd)）
 * @param width 浪花寬度
 */
export function foamRing(hw: number, hd: number, rc: number, width: number, y = 0.03): THREE.BufferGeometry {
  const inner = roundedRect(hw, hd, rc, 3);
  const outer = roundedRect(hw + width, hd + width, rc + width, 3);
  const n = inner.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = inner[i];
    const b = inner[j];
    const c = outer[i];
    const d = outer[j];
    const ua = Math.min(0.999, i / n);
    const ub = Math.min(0.999, (i + 1) / n);
    // 兩個三角形：a c b、b c d（從上往下看逆時針 → 法線朝上）
    pos.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1], b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
    uv.push(ua, 0, ua, 1, ub, 0, ub, 0, ua, 1, ub, 1);
    for (let k = 0; k < 6; k++) nrm.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * 尾流浪花帶：一條沿 z 的直帶，內緣在 x = 0、往 +x 方向 width 寬，從 z = 0 往 −z 延伸 length。
 * uv = (尾流區塊 + 沿長度 0..1, 0 內緣 → 1 外緣)；shader 會讓 u 小的一端（z = 0）淡出。
 * 呼叫端用旋轉或鏡像放到兩側。
 */
export function foamStrip(length: number, width: number, y = 0.03): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, length, 1, Math.max(1, Math.round(length / 3)));
  g.rotateX(-Math.PI / 2);
  g.translate(width / 2, y, -length / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 5 + Math.min(0.999, -p.getZ(i) / length), p.getX(i) / width);
  return flat(g);
}

/**
 * 細瀑布緞帶：沿著一串從上到下的點，寬度沿 z 展開，uv = (細瀑布區塊 + 0..1 橫向, 累計長度 / 3)。
 */
export function cascadeRibbon(points: THREE.Vector3[], halfWidth: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += points[i].distanceTo(points[i - 1]);
    const p = points[i];
    // 越往下越寬一點（水流散開）
    const w = halfWidth * (1 + 0.35 * (i / (points.length - 1)));
    pos.push(p.x, p.y, p.z + w, p.x, p.y, p.z - w);
    uv.push(2, acc / 3, 2.999, acc / 3);
  }
  const idx: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return flat(g);
}

/**
 * 繩子：沿曲線的管子，uv.x 依長度重複（每 0.3 m 一個繩紋週期）。
 * @param closed 是否封閉（繞一圈的綁繩）
 */
export function ropeTube(points: THREE.Vector3[], radius: number, closed: boolean, tubular = 48): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.3);
  const g = new THREE.TubeGeometry(curve, tubular, radius, 6, closed);
  const len = curve.getLength();
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 0.3), uv.getY(i));
  return flat(g);
}

/**
 * 繞著方形截面（半寬 hw、從 y0 到 y1）一圈的綁繩路徑點（在 z = 0 的平面上）。
 * @param pad 繩子離表面的距離
 */
export function wrapPoints(hw: number, y0: number, y1: number, pad: number, sag = 0): THREE.Vector3[] {
  const r = 0.25;
  const x = hw + pad;
  const pts: THREE.Vector3[] = [];
  // 頂面（往前稍微下垂一點）、右側、底、左側；角用短弧
  const add = (px: number, py: number) => pts.push(new THREE.Vector3(px, py, 0));
  add(-x + r, y1 + pad);
  add(0, y1 + pad - sag);
  add(x - r, y1 + pad);
  add(x, y1 + pad - r);
  add(x + 0.01, (y0 + y1) / 2);
  add(x, y0 + r);
  add(x - r, y0 - pad);
  add(0, y0 - pad);
  add(-x + r, y0 - pad);
  add(-x, y0 + r);
  add(-x - 0.01, (y0 + y1) / 2);
  add(-x, y1 + pad - r);
  return pts;
}
