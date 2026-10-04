import * as THREE from 'three';
import { createStage, GAME_CAMERA } from './stage';
import { BIOME_FACTORIES } from './biomes';
import { CHUNK_LEN, LANE_WIDTH, RAMP } from '../config';
import { buildNinja } from './character/ninja';
import { CharacterAnimator } from './character/anim';
import type { BiomeId, ObstacleKind } from '../sim/types';

/**
 * 場景預覽模式（網址加 ?scene=village／forest／valley）：擺出一整段場景、範例障礙、遠景與入口地標，
 * 用來調整場景外觀與截圖驗收。
 * 參數：
 * - cam：game（遊戲鏡頭，預設）／high（高空俯瞰）／side（側面）／low（低角度細節）／gate（入口地標）／far（看遠景與地平線）
 * - clean=1：不顯示統計數字（截乾淨的圖）
 * - gate=0：不擺入口地標
 * - freeze=1：不播動畫（時間固定在 1.0 秒）
 */

/** 預覽用的範例障礙：[種類, 車道, 前緣距離, 長度, 是否迎面, 外觀變化] */
const SAMPLE: [ObstacleKind, number, number, number, boolean, number][] = [
  ['hurdle', 0, 14, 0, false, 0],
  ['train', 1, 20, 30, false, 0],
  ['highBar', -1, 26, 0, false, 0],
  ['block', 0, 40, 0, false, 0],
  ['ramp', -1, 52, RAMP.length, false, 0],
  ['train', -1, 52 + RAMP.length, 40, false, 1],
  ['hurdle', 0, 66, 0, false, 1],
  ['train', 1, 74, 20, true, 2],
  ['highBar', 0, 86, 0, false, 1],
  ['block', 1, 110, 0, false, 1],
];

/** 鏡頭預設：[位置, 注視點] */
const CAMS: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  game: [GAME_CAMERA.pos.clone(), GAME_CAMERA.look.clone()],
  high: [new THREE.Vector3(0, 11, 12), new THREE.Vector3(0, 0, -28)],
  side: [new THREE.Vector3(15, 5, -14), new THREE.Vector3(-2, 2.5, -34)],
  low: [new THREE.Vector3(2.2, 1.1, 2.5), new THREE.Vector3(0, 1.6, -22)],
  gate: [new THREE.Vector3(1.5, 2.6, -82), new THREE.Vector3(0, 4.5, -100)],
  far: [new THREE.Vector3(0, 5.5, 5), new THREE.Vector3(0, 4, -150)],
};

/** 計算一個物件底下的網格數與三角形數 */
function countStats(obj: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const n = g.index ? g.index.count : g.attributes.position.count;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    triangles += (n / 3) * inst;
  });
  return { meshes, triangles: Math.round(triangles) };
}

/** 啟動場景預覽 */
export function startSceneViewer(params: URLSearchParams): void {
  const app = document.getElementById('app')!;
  const id = (params.get('scene') ?? 'village') as BiomeId;
  const stage = createStage(app);
  const kit = BIOME_FACTORIES[id]();
  stage.applyAtmosphere(kit.atmosphere);

  // 一整段場景：玩家身後一段到前方 270 m
  const t0 = performance.now();
  for (let i = -1; i < 9; i++) {
    const chunk = kit.buildChunk(1000 + i);
    chunk.position.z = -i * CHUNK_LEN;
    stage.world.add(chunk);
  }
  const chunkMs = (performance.now() - t0) / 10;

  // 範例障礙
  for (const [kind, lane, z, length, moving, variant] of SAMPLE) {
    const o = kit.buildObstacle({ kind, length, moving, variant });
    o.position.set(lane * LANE_WIDTH, 0, -z);
    stage.world.add(o);
  }
  if (params.get('gate') !== '0') {
    const gate = kit.buildGate();
    gate.position.z = -100;
    stage.world.add(gate);
  }
  // 遠景跟著玩家（掛在 scene，不掛在 world）
  stage.scene.add(kit.buildBackdrop());

  // 主角（看比例用）
  const ninja = buildNinja();
  stage.scene.add(ninja.root);
  const anim = new CharacterAnimator(ninja, 'naruto');
  if (params.get('freeze') === '1') {
    // 定格時先讓跑姿收斂，截圖裡的角色才是跑步中的樣子
    anim.frozenPhase = 0.25;
    for (let i = 0; i < 120; i++) anim.update(1 / 60, { state: 'run', speed: 16 });
  }

  const camName = params.get('cam') ?? 'game';
  const [pos, look] = CAMS[camName] ?? CAMS.game;
  stage.camera.position.copy(pos);
  stage.camera.lookAt(look);

  // 統計：單一段場景、一列 30 m 列車的網格數與三角形數
  const chunkStats = countStats(kit.buildChunk(4242));
  const trainStats = countStats(kit.buildObstacle({ kind: 'train', length: 30, moving: false, variant: 0 }));
  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.55);color:#fff;font:12px/1.4 monospace;z-index:10';
  if (params.get('clean') !== '1') document.body.appendChild(overlay);

  const freeze = params.get('freeze') === '1';
  let frames = 0;
  let last = performance.now();
  let time = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time = freeze ? 1 : time + dt;
    kit.update?.(time, freeze ? 0 : dt);
    anim.update(freeze ? 0 : dt, { state: 'run', speed: 16 });
    stage.render();
    frames++;
    if (frames === 4) {
      const info = stage.renderer.info;
      const stats = {
        scene: id,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        chunk: chunkStats,
        train30: trainStats,
        chunkBuildMs: Math.round(chunkMs * 10) / 10,
      };
      overlay.textContent = JSON.stringify(stats, null, 1);
      const w = window as unknown as { __sceneStats: unknown; __sceneReady: boolean };
      w.__sceneStats = stats;
      w.__sceneReady = true;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
