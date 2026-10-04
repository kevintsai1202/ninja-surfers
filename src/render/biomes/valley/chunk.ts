import * as THREE from 'three';
import { CHUNK_LEN, LANE_WIDTH, SIDE_START_X } from '../../../config';
import { mergeByMaterial } from '../../merge';
import { seeded } from '../../proctex';
import { Batcher, isMerged, markMerged } from './batch';
import type { Wall } from './cliffs';
import type { ValleyContext } from './context';
import { cascadeRibbon } from './geom';
import { hash3 } from './noise';

/**
 * 終末之谷的一段場景（長 CHUNK_LEN）：
 * - 水面（三條車道都是水，查克拉踩水跑）
 * - 車道標示：每條車道中央一排踏腳石；車道邊界與跑道邊緣各一排荷葉（部分開蓮花）
 * - 淺灘：荷葉群、露出水面的石頭、蘆葦、漂流木
 * - 兩側層狀岩壁：岩架上的灌木與草、垂藤與垂苔、細瀑布、岩壁頂的盆景松、岩壁腳的大石
 * - 浪花、漣漪、水花、水面霧氣
 *
 * 合併方式（每段約 11 個網格）：
 * - 小道具用 Batcher 依材質直接寫進大陣列（等同 mergeByMaterial，但不建立中間物件，快很多）；
 * - 大石與踏腳石數量多、形狀相同 → InstancedMesh；
 * - 兩側岩壁從預先建好的款式挑一種（共用幾何，不複製頂點）；
 * 最後一樣交給 mergeByMaterial，已合併好的網格用 keep 原樣保留（避免再複製一次十萬個頂點）。
 */
export function buildValleyChunk(ctx: ValleyContext, seed: number): THREE.Object3D {
  const { mats, tpl } = ctx;
  const rnd = seeded((seed * 2654435761) >>> 0);
  const root = new THREE.Group();
  root.name = 'valley-chunk';

  /** 隨機實數 a..b */
  const rand = (a: number, b: number) => a + (b - a) * rnd();

  /** 道具批次合併器（同材質的道具直接寫進同一組大陣列） */
  const batch = new Batcher();

  /**
   * 擺一個道具（範本幾何＋材質＋繞 y 旋轉＋縮放）。
   * @param cast 是否投影（只給近處主要物件）
   */
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
    sx = 1,
    sy = sx,
    sz = sx,
    cast = false,
  ): void => batch.add(geo, mat, x, y, z, ry, sx, sy, sz, cast);

  /** 實例化道具的擺放紀錄：[x, y, z, ry（偏航）, sx, sy, sz, 色調, rz（側傾）] */
  type Inst = [number, number, number, number, number, number, number, number, number];
  /** 大石（兩種外形，各一個 InstancedMesh） */
  const boulders: Inst[][] = [[], []];
  /** 踏腳石 */
  const stones: Inst[] = [];
  /** 這一段用的兩種大石外形與一種踏腳石外形 */
  const boulderGeo = [tpl.boulders[seed % tpl.boulders.length], tpl.boulders[(seed + 3) % tpl.boulders.length]];
  const stoneGeo = tpl.stones[seed % tpl.stones.length];

  /** 擺一顆大石（會投影）；ry 不給就隨機轉向，rz 是先在自身座標裡側傾（岩柱順著岩壁傾斜用） */
  const boulder = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = rnd() * Math.PI * 2, rz = 0) => {
    boulders[Math.floor(rnd() * 2)].push([x, y, z, ry, sx, sy, sz, rnd(), rz]);
  };

  /** 浪花圈（圓形物體底部）：rx、rz 是物體在水線的半徑 */
  const foamAround = (x: number, z: number, rx: number, rz: number) => {
    add(tpl.foamDisc, mats.fx, x, 0, z, 0, rx * 2, 1, rz * 2);
  };

  /** 漣漪（擴散的細圈） */
  const ripple = (x: number, z: number, r: number) => {
    add(tpl.ripple, mats.fx, x, 0.012, z, 0, r * 2, 1, r * 2);
  };

  /** 一朵蓮花（花瓣＋花心） */
  const lotus = (x: number, z: number, s: number) => {
    const ry = rnd() * Math.PI * 2;
    add(tpl.lotusPetals, mats.veg, x, 0.03, z, ry, s);
    add(tpl.lotusCenter, mats.palette, x, 0.03, z, ry, s);
  };

  // ── 水面
  add(tpl.water, mats.water, 0, 0, 0);

  // ── 兩側岩壁：從預先建好的款式裡依種子各挑一種（共用幾何，不複製頂點）
  /** 依種子從預建岩壁中挑一種（同種子結果相同） */
  const pickWall = (list: Wall[], salt: number) => list[Math.floor(hash3(seed, salt, 77) * list.length) % list.length];
  const walls: Wall[] = [pickWall(ctx.walls.left, 1), pickWall(ctx.walls.right, 2)];
  for (const w of walls) {
    const wm = new THREE.Mesh(w.geometry, mats.wall);
    wm.receiveShadow = true;
    markMerged(wm);
    root.add(wm);
  }

  // ── 車道中央的踏腳石（每 2.5 m 一顆，前後段節奏一致）
  for (const lane of [-1, 0, 1]) {
    for (let i = 0; i < Math.round(CHUNK_LEN / 2.5); i++) {
      if (rnd() < 0.07) continue;
      const z = -(i + 0.5) * 2.5 + rand(-0.3, 0.3);
      const x = lane * LANE_WIDTH + rand(-0.14, 0.14);
      const s = rand(1.0, 1.28);
      const sz = s * rand(0.82, 0.98);
      stones.push([x, -0.005, z, rnd() * Math.PI, s, rand(0.9, 1.2), sz, rnd(), 0]);
      // 踏腳石的浪花窄一點（內徑貼石頭、外徑只多 0.25 m）
      add(tpl.foamThin, mats.fx, x, 0, z, 0, s * 0.94, 1, sz * 0.94);
      if (rnd() < 0.55) ripple(x, z, s * 1.35);
    }
  }

  // ── 荷葉：車道邊界與跑道邊緣各一排（部分開蓮花）
  for (const bx of [-3.75, -1.25, 1.25, 3.75]) {
    let z = -rand(0.2, 1.3);
    while (z > -CHUNK_LEN + 0.4) {
      const s = rand(0.62, 0.95);
      const x = bx + rand(-0.12, 0.12);
      add(tpl.lily, mats.veg, x, 0.022 + rnd() * 0.004, z, rnd() * Math.PI * 2, s);
      if (rnd() < 0.3) lotus(x + rand(-0.1, 0.1), z + rand(-0.1, 0.1), rand(1.35, 1.8));
      else if (rnd() < 0.25) ripple(x, z, s * 1.1);
      // 旁邊偶爾再一片小荷葉（不碰到車道中央的踏腳石）
      if (rnd() < 0.4) add(tpl.lily, mats.veg, x + (rnd() < 0.5 ? -0.3 : 0.3), 0.025, z + rand(-0.55, 0.55), rnd() * Math.PI * 2, rand(0.42, 0.58));
      z -= rand(1.1, 1.65);
    }
  }

  for (const w of walls) {
    const side = w.side;
    // ── 淺灘：荷葉群（附蓮花）
    const clusters = 3 + Math.floor(rnd() * 3);
    for (let c = 0; c < clusters; c++) {
      const cx = side * rand(SIDE_START_X + 0.6, 11.5);
      const cz = rand(-CHUNK_LEN + 1, -1);
      const n = 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        const x = cx + rand(-1.6, 1.6);
        const z = cz + rand(-1.8, 1.8);
        const s = rand(0.55, 1.15);
        add(tpl.lily, mats.veg, x, 0.02 + rnd() * 0.006, z, rnd() * Math.PI * 2, s);
        if (rnd() < 0.3) lotus(x, z, rand(1.4, 1.9));
      }
      ripple(cx, cz, rand(1.6, 2.4));
    }

    // ── 淺灘：露出水面的石頭
    const rocks = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < rocks; i++) {
      const x = side * rand(SIDE_START_X + 0.4, 13);
      const z = rand(-CHUNK_LEN, 0);
      const s = rand(0.5, 1.4);
      boulder(x, -0.12 * s, z, s, s * rand(0.7, 1.1), s);
      foamAround(x, z, s * 0.5, s * 0.46);
      if (rnd() < 0.5) ripple(x, z, s * 1.6);
    }

    // ── 岸邊蘆葦叢與草
    const reeds = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < reeds; i++) {
      const z = rand(-CHUNK_LEN, 0);
      const x = side * Math.min(w.surface(z, 0.2) - 0.6, rand(9.5, 15.5));
      const s = rand(0.75, 1.3);
      add(tpl.reed, mats.veg, x, -0.05, z, rnd() * Math.PI, s, s * rand(0.85, 1.2), s);
    }

    // ── 岩壁腳的大石（投影）＋浪花、灌木
    const big = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < big; i++) {
      const z = rand(-CHUNK_LEN + 0.5, -0.5);
      const s = rand(1.4, 3.3);
      const x = side * (w.surface(z, 0.6) - s * 0.3);
      const sy = s * rand(0.65, 1.0);
      boulder(x, sy * rand(0.05, 0.22), z, s, sy, s * rand(0.8, 1.15));
      foamAround(x, z, s * 0.5, s * 0.48);
      if (rnd() < 0.6) add(tpl.bush, mats.veg, x + side * s * 0.25, sy * 0.55, z + rand(-0.6, 0.6), rnd() * 3, rand(0.6, 1.0));
      else add(tpl.grass, mats.veg, x - side * s * 0.1, sy * 0.6, z, rnd() * 3, rand(0.8, 1.3));
    }

    // ── 岩壁腳的浪花（沿水線約每 3 m 一圈，半圈埋進岩石）
    for (let z = -1.4; z > -CHUNK_LEN; z -= 3.2) {
      const zz = z + rand(-0.5, 0.5);
      foamAround(side * w.surface(zz, 0), zz, rand(1.0, 1.6), rand(1.6, 2.4));
    }

    // ── 岩架：灌木、草、垂藤、垂苔
    for (let k = 0; k < w.layers.length - 1; k++) {
      const L = w.layers[k];
      const yTop = w.layers[k + 1].y0;
      if (yTop < 1.5 || yTop > 44) continue;
      const plants = L.ledge ? 5 + Math.floor(rnd() * 4) : 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < plants; i++) {
        const z = rand(-CHUNK_LEN + 0.5, -0.5);
        if (yTop > w.top(z) - 0.8) continue;
        const x = side * (w.surface(z, yTop - 0.2) + 0.1);
        if (rnd() < 0.62) add(tpl.bush, mats.veg, x, yTop - 0.45, z, rnd() * 3, rand(0.8, 1.6));
        else add(tpl.grass, mats.veg, x, yTop - 0.3, z, rnd() * 3, rand(1.0, 1.6));
      }
      const hangs = L.ledge ? 2 + Math.floor(rnd() * 3) : rnd() < 0.45 ? 1 : 0;
      for (let i = 0; i < hangs; i++) {
        const z = rand(-CHUNK_LEN + 1, -1);
        if (yTop > w.top(z) - 0.8) continue;
        const x = side * (w.front(k, z) - 0.12);
        const len = Math.min(1.25, (L.t + 0.4) / 3.2);
        const isVine = rnd() < 0.65;
        add(isVine ? tpl.vine : tpl.moss, mats.veg, x, yTop + 0.1, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, rand(0.8, 1.2), isVine ? len : rand(0.8, 1.3), 1);
      }
    }

    // ── 靠在岩壁上的岩柱（打破一層層等高的橫紋）：從水裡長出來、順著岩壁往外傾，頂上長灌木
    const buttresses = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < buttresses; i++) {
      const z = rand(-CHUNK_LEN + 3, -3);
      const y0 = -1.4;
      const hh = rand(9, 17);
      // 範本高 0.78 → 半高 0.39 × hh
      const cy = y0 + 0.39 * hh;
      if (y0 + 0.78 * hh > w.top(z) - 2.5) continue;
      const depth = rand(3.2, 4.6);
      const len = rand(3.2, 5.5);
      const tilt = 0.22;
      // 用中段高度的岩面定位，再往岩壁裡埋一點（底部會比岩壁腳稍微突出，像倚著岩壁的石柱）
      const x = side * (w.surface(z, cy) - depth * 0.05);
      boulder(x, cy, z, depth, hh, len, rand(-0.2, 0.2), -side * tilt);
      // 頂端（側傾後往岩壁那側偏）
      const topX = x + side * 0.39 * hh * Math.sin(tilt);
      const topY = cy + 0.39 * hh * Math.cos(tilt) - 0.35;
      add(tpl.bush, mats.veg, topX - side * 0.3, topY, z + rand(-0.5, 0.5), rnd() * 3, rand(1.0, 1.6));
      if (rnd() < 0.6) add(tpl.grass, mats.veg, topX - side * 0.6, topY, z + rand(-0.8, 0.8), rnd() * 3, rand(1.0, 1.4));
      if (rnd() < 0.6) {
        add(tpl.vine, mats.veg, x - side * (depth * 0.46 + 0.05), cy + hh * 0.2, z + rand(-0.6, 0.6), side > 0 ? -Math.PI / 2 : Math.PI / 2, rand(0.9, 1.3), rand(0.7, 1.1), 1);
      }
      if (y0 < 0) foamAround(x, z, depth * 0.48, len * 0.48);
    }

    // ── 岩壁頂的盆景松
    const pines = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < pines; i++) {
      const z = rand(-CHUNK_LEN + 1, -1);
      const H = w.top(z);
      const x = side * (w.surface(z, H - 0.4) + rand(1.2, 4.5));
      add(tpl.pine, mats.palette, x, H - 0.1, z, rnd() * Math.PI * 2, rand(1.1, 1.9));
    }

    // ── 細瀑布：從岩壁頂或岩架沿岩面流下，底部有浪花、水花、霧
    const falls = rnd() < 0.8 ? (rnd() < 0.35 ? 2 : 1) : 0;
    for (let f = 0; f < falls; f++) {
      const zc = rand(-CHUNK_LEN + 4, -4);
      const H = w.top(zc);
      const ySrc = rnd() < 0.5 ? H - 0.2 : Math.min(H - 0.2, rand(9, 22));
      // 水流的水平位置只會往河道靠（遇到更凸的岩層就沿著它的前緣流下，岩面凹進去時直直落下）
      const pts: THREE.Vector3[] = [];
      let env = Infinity;
      for (let y = ySrc; y > -0.35; y -= 0.6) {
        env = Math.min(env, w.surface(zc, y) - 0.3);
        pts.push(new THREE.Vector3(side * env, y, zc));
      }
      env = Math.min(env, w.surface(zc, -0.3) - 0.3);
      pts.push(new THREE.Vector3(side * env, -0.3, zc));
      add(cascadeRibbon(pts, rand(0.45, 0.95)), mats.fx, 0, 0, 0);
      const bx = side * (w.surface(zc, 0) - 0.6);
      foamAround(bx, zc, 1.6, 2.2);
      add(tpl.splash, mats.fx, bx, -0.1, zc, rnd() * 3, 2.4, 2.0, 2.4);
      add(tpl.mist, mats.fx, bx - side * 1.0, -0.2, zc, side > 0 ? -1.2 : 1.2, 7, 3.6, 1);
    }

    // ── 漂流木（擱在淺灘或岸邊）
    if (rnd() < 0.7) {
      const z = rand(-CHUNK_LEN + 3, -3);
      const x = side * rand(8.5, 13.5);
      const len = rand(3, 5.5);
      const r = rand(0.22, 0.34);
      const ry = rand(-0.9, 0.9);
      add(tpl.logBody, mats.wood, x, r * 0.35, z, ry, r, r, len, true);
      add(tpl.logCaps, mats.endGrain, x, r * 0.35, z, ry, r, r, len, true);
      foamAround(x, z, len * 0.32, len * 0.32);
    }

    // ── 水面霧氣（沿兩岸的低霧帶）
    const mists = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < mists; i++) {
      const z = rand(-CHUNK_LEN, 0);
      const x = side * rand(7.5, 14);
      add(tpl.mist, mats.fx, x, -0.3, z, side * rand(-0.5, 0.2), rand(10, 17), rand(3.2, 5.5), 1);
    }
  }

  // ── 實例化的大石與踏腳石
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  /** 建一個 InstancedMesh（每顆石頭的色調用 instanceColor 微調） */
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], cast: boolean) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z, ry, sx, sy, sz, tone, rz], i) => {
      // Euler XYZ：先套用自身的 z 側傾，再繞 y 偏航
      m4.compose(p.set(x, y, z), q.setFromEuler(e.set(0, ry, rz)), s.set(sx, sy, sz));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, col.setRGB(0.88 + 0.22 * tone, 0.88 + 0.18 * tone, 0.86 + 0.14 * tone));
    });
    im.castShadow = cast;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    root.add(im);
  };
  instanced(boulderGeo[0], mats.wall, boulders[0], true);
  instanced(boulderGeo[1], mats.wall, boulders[1], true);
  instanced(stoneGeo, mats.step, stones, false);

  batch.build(root);
  return mergeByMaterial(root, { keep: isMerged });
}
