import * as THREE from 'three';
import { CHUNK_LEN, BIOME_LEN, VIEW_AHEAD, VIEW_BEHIND, LANE_WIDTH } from '../../config';
import { BIOME_FACTORIES } from '../biomes';
import { biomeAt, biomeBlend } from '../../sim/biome';
import { CoinField } from './coins';
import { PickupField } from './pickups';
import type { Stage } from '../stage';
import type { BiomeKit } from '../biomes/types';
import type { BiomeId, Obstacle } from '../../sim/types';
import type { RunState } from '../../sim/run';

/**
 * 世界畫面：把模擬的狀態同步到 three 場景。
 * - 世界往玩家移動：stage.world.position.z = 跑的距離，世界裡的物件 local z = −模擬 z。
 * - 場景段落：每個場景預先建幾種變化當模板，畫面上用 clone（共用幾何）並重複使用，跑的時候不會卡頓。
 * - 障礙：依（場景、種類、長度、外觀、是否迎面）快取模板，畫面物件用物件池重複使用。
 * - 遠景、霧、天空依場景交界漸變。
 */

/** 每個場景預建幾種段落變化 */
const CHUNK_VARIANTS = 4;

/** 整數雜湊（段落編號 → 變化） */
function hash(i: number): number {
  let x = (i ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** 從物件池取出或用模板 clone */
function fromPool(pool: Map<string, THREE.Object3D[]>, key: string, make: () => THREE.Object3D): THREE.Object3D {
  const list = pool.get(key);
  const obj = list && list.length ? list.pop()! : make();
  obj.userData.poolKey = key;
  return obj;
}

/** 放回物件池 */
function toPool(pool: Map<string, THREE.Object3D[]>, obj: THREE.Object3D): void {
  obj.removeFromParent();
  const key = obj.userData.poolKey as string;
  const list = pool.get(key) ?? [];
  list.push(obj);
  pool.set(key, list);
}

export class WorldView {
  /** 已建立的場景模組（延後建立：開局只建起跑的場景，其他在背景或需要時才建） */
  private readonly kitCache: Partial<Record<BiomeId, BiomeKit>> = {};
  private readonly chunkTemplates = new Map<string, THREE.Object3D>();
  private readonly chunkPool = new Map<string, THREE.Object3D[]>();
  private readonly activeChunks = new Map<number, THREE.Object3D>();
  private readonly obstacleTemplates = new Map<string, THREE.Object3D>();
  private readonly obstaclePool = new Map<string, THREE.Object3D[]>();
  private readonly obstacleViews = new Map<number, THREE.Object3D>();
  private readonly gates = new Map<number, THREE.Object3D>();
  private readonly backdrops: Partial<Record<BiomeId, THREE.Object3D>> = {};
  readonly coins: CoinField;
  readonly pickups: PickupField;

  /**
   * @param startBiome 起跑所在的場景（先建這一個，其他延後）
   */
  constructor(
    private readonly stage: Stage,
    startBiome: BiomeId,
  ) {
    this.kit(startBiome);
    this.coins = new CoinField(stage.world);
    this.pickups = new PickupField(stage.world);
  }

  /**
   * 取得場景模組；還沒建立就當場建立（含預建段落模板與遠景）。
   * 建立貼圖與模板比較久，平常由 preloadInBackground 先建好，這裡是保底。
   */
  kit(id: BiomeId): BiomeKit {
    let k = this.kitCache[id];
    if (!k) {
      k = BIOME_FACTORIES[id]();
      this.kitCache[id] = k;
      for (let v = 0; v < CHUNK_VARIANTS; v++) {
        this.chunkTemplates.set(`${id}|${v}`, k.buildChunk(7919 * (v + 1) + id.length * 101));
      }
      const b = k.buildBackdrop();
      b.visible = false;
      this.stage.scene.add(b);
      this.backdrops[id] = b;
    }
    return k;
  }

  /**
   * 在背景依序建立其他場景模組（每個之間讓出主執行緒，標題畫面才不會一直卡住）。
   * @param ids 要預先建立的場景
   */
  preloadInBackground(ids: BiomeId[]): void {
    const next = (i: number) => {
      if (i >= ids.length) return;
      setTimeout(() => {
        this.kit(ids[i]);
        next(i + 1);
      }, 120);
    };
    next(0);
  }

  /** 新的一局：清掉所有障礙與入口地標 */
  reset(): void {
    for (const v of this.obstacleViews.values()) toPool(this.obstaclePool, v);
    this.obstacleViews.clear();
    for (const g of this.gates.values()) g.removeFromParent();
    this.gates.clear();
    for (const c of this.activeChunks.values()) toPool(this.chunkPool, c);
    this.activeChunks.clear();
    this.pickups.clear();
  }

  /**
   * 每幀同步。
   * @param time 經過秒數（動畫用）
   */
  sync(run: RunState, time: number, dt: number): void {
    const z = run.player.z;
    this.stage.world.position.z = z;
    this.syncChunks(z);
    this.syncObstacles(run.obstacles);
    this.syncGates(z);
    this.coins.sync(run.coinList, time);
    this.pickups.sync(run.pickups, time);
    const blend = biomeBlend(z);
    this.syncBackdrops(blend.from, blend.to, blend.t);
    const from = this.kit(blend.from);
    if (blend.t > 0) {
      const to = this.kit(blend.to);
      this.stage.blendAtmosphere(from.atmosphere, to.atmosphere, blend.t);
      to.update?.(time, dt);
    } else {
      this.stage.applyAtmosphere(from.atmosphere);
    }
    from.update?.(time, dt);
  }

  /** 場景段落：畫面範圍內每一段放一個（依段落中點的場景） */
  private syncChunks(z: number): void {
    const i0 = Math.floor((z - VIEW_BEHIND) / CHUNK_LEN);
    const i1 = Math.floor((z + VIEW_AHEAD) / CHUNK_LEN);
    for (const [i, obj] of this.activeChunks) {
      if (i < i0 || i > i1) {
        toPool(this.chunkPool, obj);
        this.activeChunks.delete(i);
      }
    }
    for (let i = i0; i <= i1; i++) {
      if (this.activeChunks.has(i)) continue;
      const biome = biomeAt(i * CHUNK_LEN + CHUNK_LEN / 2);
      const key = `${biome}|${hash(i) % CHUNK_VARIANTS}`;
      this.kit(biome);
      const obj = fromPool(this.chunkPool, key, () => this.chunkTemplates.get(key)!.clone());
      obj.position.set(0, 0, -i * CHUNK_LEN);
      this.stage.world.add(obj);
      this.activeChunks.set(i, obj);
    }
  }

  /** 障礙：新出現的建立畫面物件、消失的放回物件池、迎面列車更新位置 */
  private syncObstacles(list: readonly Obstacle[]): void {
    const alive = new Set<number>();
    for (const o of list) {
      alive.add(o.id);
      let v = this.obstacleViews.get(o.id);
      if (!v) {
        const moving = o.speed > 0;
        const variant = o.variant % 4;
        const key = `${o.biome}|${o.kind}|${o.length}|${variant}|${moving}`;
        v = fromPool(this.obstaclePool, key, () => {
          let t = this.obstacleTemplates.get(key);
          if (!t) {
            t = this.kit(o.biome).buildObstacle({ kind: o.kind, length: o.length, moving, variant });
            this.obstacleTemplates.set(key, t);
          }
          return t.clone();
        });
        this.stage.world.add(v);
        this.obstacleViews.set(o.id, v);
      }
      v.position.set(o.lane * LANE_WIDTH, 0, -o.z);
    }
    for (const [id, v] of this.obstacleViews) {
      if (alive.has(id)) continue;
      toPool(this.obstaclePool, v);
      this.obstacleViews.delete(id);
    }
  }

  /** 場景交界的入口地標（屬於要進入的那個場景） */
  private syncGates(z: number): void {
    const k0 = Math.ceil((z - VIEW_BEHIND) / BIOME_LEN);
    const k1 = Math.floor((z + VIEW_AHEAD) / BIOME_LEN);
    for (const [k, g] of this.gates) {
      if (k < k0 || k > k1) {
        g.removeFromParent();
        this.gates.delete(k);
      }
    }
    for (let k = Math.max(1, k0); k <= k1; k++) {
      if (this.gates.has(k)) continue;
      const g = this.kit(biomeAt(k * BIOME_LEN + 1)).buildGate();
      g.position.set(0, 0, -k * BIOME_LEN);
      this.stage.world.add(g);
      this.gates.set(k, g);
    }
  }

  /** 遠景交叉淡化：from 漸隱、to 漸顯 */
  private syncBackdrops(from: BiomeId, to: BiomeId, t: number): void {
    for (const id of Object.keys(this.backdrops) as BiomeId[]) {
      const b = this.backdrops[id];
      if (!b) continue;
      const alpha = id === from ? 1 - t : id === to ? t : 0;
      b.visible = alpha > 0.01;
      if (b.visible) this.fade(b, alpha);
    }
  }

  /** 設定遠景整體透明度（第一次會記住材質原本的透明度） */
  private fade(root: THREE.Object3D, alpha: number): void {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat.userData.baseOpacity === undefined) {
          mat.userData.baseOpacity = mat.opacity;
          mat.userData.baseTransparent = mat.transparent;
        }
        const want = mat.userData.baseOpacity * alpha;
        const transparent = alpha < 0.999 || mat.userData.baseTransparent;
        if (mat.transparent !== transparent) {
          mat.transparent = transparent;
          mat.needsUpdate = true;
        }
        mat.opacity = want;
      }
    });
  }
}
