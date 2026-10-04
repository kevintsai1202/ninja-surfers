import * as THREE from 'three';
import { CHUNK_LEN } from '../../../config';
import { mergeByMaterial } from '../../merge';
import { Builder, type Prefab, Rng } from './builder';
import { sw } from './atlas';
import { BACK_WIDTHS, HOUSE_WIDTHS, type PropKind, type VillageLib } from './lib';
import type { VillageMats } from './mats';
import { POLE_TOP, POLE_X, POLE_ZS, wire } from './props';
import { BERM_TOP, BERM_X0, BERM_X1, buildTrackMeshes, STREET_Y } from './track';

/**
 * 組出一段木葉村場景（長 CHUNK_LEN，local z ∈ [−CHUNK_LEN, 0]）：
 * 靜態的軌道與地面（共用幾何）＋依 seed 挑選、擺放的預製件（前排町家與空地、人行道道具、
 * 電線桿與電線、後排建築、外圍樹林）＋跨越軌道的電纜與燈籠串。
 *
 * 做法：先依 seed 規劃「哪個預製件放在哪裡」，算出每個材質需要的頂點數一次配置好緩衝，
 * 再把預製件整段複製進去（stamp），最後直接把緩衝交給幾何（不再複製）。
 * 兩側共用「右側座標系」的規劃，左側只是 frame 換成繞 y 轉 180°。
 */

/** 左側街景的座標系：local (x, y, z) → 世界 (−x, y, −z − CHUNK_LEN) */
const LEFT_FRAME = new THREE.Matrix4().makeTranslation(0, 0, -CHUNK_LEN).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
const IDENTITY = new THREE.Matrix4();
/** 一段場景的包圍盒（電線會跨到前後段，所以 z 範圍放寬） */
const CHUNK_BOUNDS = new THREE.Box3(new THREE.Vector3(-47, -2, -CHUNK_LEN - 9), new THREE.Vector3(47, 26, 9));
/** 人行道上放道具的 x 範圍（擋土牆與建築正面之間） */
const WALK_X0 = 5.6;
const WALK_X1 = 6.7;

/** 一個預製件的擺放：side 1 = 右側座標系、−1 = 左側、0 = 世界座標 */
interface Placement {
  p: Prefab;
  side: number;
  x: number;
  y: number;
  z: number;
}

/** 直接產生的少量幾何（電線桿拉到房子的引下線） */
interface Direct {
  side: number;
  fn: (b: Builder) => void;
}

/** 靜態軌道網格（第一次建場景時產生，之後每段共用幾何） */
let trackCache: { mats: VillageMats; meshes: THREE.Mesh[] } | null = null;

/** 取得共用的軌道網格 */
function trackMeshes(m: VillageMats): THREE.Mesh[] {
  if (!trackCache || trackCache.mats !== m) trackCache = { mats: m, meshes: buildTrackMeshes(m) };
  return trackCache.meshes;
}

/** 預先建好靜態軌道（createKit 時呼叫，讓第一段場景不必付這個成本） */
export function prepareTrack(m: VillageMats): void {
  trackMeshes(m);
}

/** 依權重挑一種街道道具 */
function pickProp(rnd: Rng): PropKind {
  const r = rnd.f();
  if (r < 0.2) return 'bonsai';
  if (r < 0.3) return 'crate';
  if (r < 0.38) return 'crates';
  if (r < 0.47) return 'barrel';
  if (r < 0.54) return 'buckets';
  if (r < 0.6) return 'mailbox';
  if (r < 0.7) return 'planter';
  if (r < 0.8) return 'nobori';
  if (r < 0.88) return 'sign';
  return 'bench';
}

/** 規劃一側的街景（側邊座標系） */
function planSide(lib: VillageLib, m: VillageMats, rnd: Rng, side: number, out: Placement[], direct: Direct[]): void {
  /** 記下一個預製件放在這一側的哪裡 */
  const put = (p: Prefab, x: number, y: number, z: number) => out.push({ p, side, x, y, z });

  // ── 電線桿、沿軌道的電線、路燈 ──
  for (const pz of POLE_ZS) put(lib.poles[rnd.chance(0.4) ? 1 : 0], 0, 0, pz);
  put(lib.sideWires, 0, 0, 0);
  put(lib.lamp, 0, 0, -15);

  // ── 前排：從 z = 0 往 −z 一塊塊排地 ──
  let z = 0;
  let shrine = false;
  while (z > -CHUNK_LEN + 0.6) {
    const remain = z + CHUNK_LEN;
    const gap = rnd.range(0.15, 0.32);
    const fits = HOUSE_WIDTHS.map((w, i) => ({ w, i })).filter((c) => c.w + 2 * gap <= remain);
    if (fits.length === 0) {
      // 剩下的窄地當成巷子：堆木箱木桶或花箱
      if (remain > 1.2) {
        const zc = z - remain / 2;
        if (rnd.chance(0.6)) put(rnd.pick(lib.props.crates), rnd.range(8.6, 10.5), 0, zc);
        if (rnd.chance(0.6)) put(rnd.pick(lib.props.barrel), rnd.range(10.8, 12.0), 0, zc + rnd.range(-0.3, 0.3));
      }
      break;
    }
    // 避免最後留下 0.3～1.2 m 的細縫：優先挑能剛好收尾或留下夠寬巷子的寬度
    let pick = rnd.pick(fits);
    const left = remain - (pick.w + 2 * gap);
    if (left > 0.3 && left < 1.2) pick = fits[fits.length - 1];
    const r = rnd.f();
    let p: Prefab;
    let house = false;
    if (r < 0.08 && !shrine && lib.shrine[pick.i].length) {
      p = lib.shrine[pick.i][0];
      shrine = true;
    } else if (r < 0.19 && lib.garden[pick.i].length) p = rnd.pick(lib.garden[pick.i]);
    else if (r < 0.25 && lib.well[pick.i].length) p = lib.well[pick.i][0];
    else {
      p = rnd.pick(lib.houses[pick.i]);
      house = true;
    }
    const zA = z - gap;
    put(p, 0, 0, zA);
    // 電線桿拉到房子二樓的引下線
    if (house && rnd.chance(0.5)) {
      const zc = zA - pick.w / 2;
      const pz = Math.abs(POLE_ZS[0] - zc) < Math.abs(POLE_ZS[1] - zc) ? POLE_ZS[0] : POLE_ZS[1];
      direct.push({
        side,
        fn: (b) => wire(b, m.palette, [POLE_X + 0.3, POLE_TOP - 1.55, pz], [7.4, STREET_Y + 5.3, zc], 0.3, 0.03, sw('black'), 5),
      });
    }
    z = zA - pick.w - gap;
  }

  // ── 人行道道具（避開電線桿與路燈） ──
  const avoid = [...POLE_ZS, -15];
  let pz = -rnd.range(0.8, 2.2);
  while (pz > -CHUNK_LEN + 0.8) {
    if (avoid.some((a) => Math.abs(a - pz) < 1.1)) {
      pz -= 0.8;
      continue;
    }
    const kind = pickProp(rnd);
    const x = kind === 'nobori' ? WALK_X0 - 0.1 : rnd.range(WALK_X0 + 0.15, WALK_X1);
    put(rnd.pick(lib.props[kind]), x, 0, pz);
    pz -= rnd.range(1.3, 2.7);
  }

  // ── 後排建築（x 17 以外；x 14.5～16.5 保持淨空，從側面鏡頭看得到巷子） ──
  let bz = -rnd.range(0, 1.5);
  while (bz > -CHUNK_LEN + 3) {
    const fits = BACK_WIDTHS.map((w, i) => ({ w, i })).filter((c) => c.w <= bz + CHUNK_LEN - 0.3);
    if (fits.length === 0) break;
    const c = rnd.pick(fits);
    if (rnd.chance(0.85)) put(rnd.pick(lib.backs[c.i]), 0, 0, bz - 0.2);
    else put(rnd.pick(rnd.chance(0.5) ? lib.sakura : lib.pine), 19.5, 0, bz - c.w / 2);
    bz -= c.w + rnd.range(0.4, 1.8);
  }

  // ── 後院與外圍土坡上的樹林 ──
  for (let tz = -rnd.range(0, 3); tz > -CHUNK_LEN; tz -= rnd.range(3.2, 5.5)) {
    put(rnd.pick(lib.far), rnd.range(26, 30), STREET_Y, tz);
  }
  for (let row = 0; row < 2; row++) {
    for (let tz = -rnd.range(0, 3); tz > -CHUNK_LEN; tz -= rnd.range(3.0, 4.5)) {
      const x = BERM_X0 + 2.0 + row * 5.5 + rnd.range(-1, 1);
      const y = STREET_Y + ((x - BERM_X0) / (BERM_X1 - BERM_X0)) * (BERM_TOP - STREET_Y);
      put(rnd.pick(lib.far), x, y - 0.2, tz);
    }
  }
}

/** 規劃跨越軌道的電纜、燈籠串、三角旗（世界座標；兩側電線桿的 z 相同） */
function planOverhead(lib: VillageLib, rnd: Rng, out: Placement[]): void {
  // 跨軌電纜只拉在一組桿子之間（另一組留給燈籠串／三角旗，畫面比較不雜亂）
  out.push({ p: lib.crossCable, side: 0, x: 0, y: 0, z: POLE_ZS[0] });
  const deco = rnd.f();
  const zL = POLE_ZS[rnd.int(0, 1)];
  const zB = zL === POLE_ZS[0] ? POLE_ZS[1] : POLE_ZS[0];
  if (deco < 0.65) out.push({ p: rnd.pick(lib.lanterns), side: 0, x: 0, y: 0, z: zL + 0.25 });
  if (deco > 0.35) out.push({ p: rnd.pick(lib.bunting), side: 0, x: 0, y: 0, z: zB + 0.25 });
}

/** 建立一段場景 */
export function buildVillageChunk(lib: VillageLib, m: VillageMats, seed: number): THREE.Object3D {
  const rnd = new Rng((seed * 2654435761) >>> 0);
  const out: Placement[] = [];
  const direct: Direct[] = [];
  planSide(lib, m, rnd, 1, out, direct);
  planSide(lib, m, rnd, -1, out, direct);
  planOverhead(lib, rnd, out);

  // 依規劃算出每個材質的頂點數，一次配置剛好的緩衝（引下線另外預留一點）
  const totals = new Map<THREE.Material, number>();
  for (const pl of out) for (const part of pl.p.parts) totals.set(part.mat, (totals.get(part.mat) ?? 0) + part.n);
  const b = new Builder();
  for (const [mat, n] of totals) b.presize(mat, n + (mat === m.palette ? direct.length * 130 + 64 : 0));
  for (const pl of out) {
    b.frame.copy(pl.side < 0 ? LEFT_FRAME : IDENTITY);
    b.stamp(pl.p, pl.x, pl.y, pl.z);
  }
  for (const d of direct) {
    b.frame.copy(d.side < 0 ? LEFT_FRAME : IDENTITY);
    d.fn(b);
  }
  const root = b.toGroup('village-chunk', { views: true, bounds: CHUNK_BOUNDS });
  for (const mesh of trackMeshes(m)) {
    const c = new THREE.Mesh(mesh.geometry, mesh.material);
    c.castShadow = mesh.castShadow;
    c.receiveShadow = mesh.receiveShadow;
    c.userData.villageKeep = true;
    c.name = 'track';
    root.add(c);
  }
  // 依材質合併（Builder 的輸出已經是每材質一個網格，標記保留，mergeByMaterial 只會原樣掛上）
  const merged = mergeByMaterial(root, { keep: (o) => o.userData.villageKeep === true });
  merged.name = 'village-chunk';
  return merged;
}
