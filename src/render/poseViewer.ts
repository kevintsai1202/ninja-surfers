import * as THREE from 'three';
import { buildNinja } from './character/ninja';
import { CharacterAnimator, type AnimState } from './character/anim';
import { buildIruka, buildAnbu } from './character/chasers';
import { buildDog, animateDog, buildToad, animateToad, TOAD_SEAT } from './character/creatures';
import { buildScrollBoard } from './character/props';
import type { HumanoidRig } from './character/rig';
import { createStage } from './stage';

/**
 * 姿勢檢視模式（網址加 ?pose=1）：單獨顯示角色與動作，用來調整與截圖驗收跑姿與模型。
 * 用遊戲同一套舞台（環境光、陰影、tone mapping），截圖才會和遊戲裡一致。
 * 參數：
 * - model：ninja（預設）
 * - anim：run／jump／roll／stumble／fall／surf／ride／idle／grab／paint／rasengan（螺旋丸跑，不含球）／climb（查克拉攀牆）
 * - phase：0..1，指定時凍結在該相位（截圖用）
 * - view：side（側面，預設）／back（背後）／front（正面）／three（斜前方）／game（遊戲中的追尾鏡頭）／face（臉部特寫）
 * - speed：跑速（m/s），影響步頻與布條飄動
 * - outline：描邊粗細（預設 0.007，0 = 不描邊）
 */

/** 檢視用的模型：場景物件＋每幀更新函式 */
interface ViewModel {
  object: THREE.Object3D;
  /** 每幀更新（dt 秒、跑步相位推進用） */
  update(dt: number, state: AnimState, speed: number, frozen: number | null): void;
  /** 人形角色的骨架（除錯用） */
  rig?: HumanoidRig;
}

/** 人形角色＋動畫器 */
function humanoid(rig: HumanoidRig, style: 'naruto' | 'sprint', frozen: number | null): ViewModel {
  const anim = new CharacterAnimator(rig, style);
  if (frozen !== null) anim.frozenPhase = frozen;
  return {
    object: rig.root,
    rig,
    update(dt, state, speed) {
      anim.update(dt, { state, speed, spinProgress: (performance.now() / 550) % 1 });
    },
  };
}

/** 建立指定的模型（ninja／iruka／anbu／dog／toad／board） */
function buildModel(name: string, outline: number, frozen: number | null): ViewModel {
  switch (name) {
    case 'iruka':
      return humanoid(buildIruka(outline), 'sprint', frozen);
    case 'anbu':
      return humanoid(buildAnbu(outline), 'naruto', frozen);
    case 'dog': {
      const dog = buildDog();
      let phase = frozen ?? 0;
      return {
        object: dog.root,
        update(dt) {
          if (frozen === null) phase = (phase + dt * 3.2) % 1;
          animateDog(dog, phase);
        },
      };
    }
    case 'toad': {
      const toad = buildToad();
      const rider = humanoid(buildNinja(outline), 'naruto', frozen);
      rider.object.position.copy(TOAD_SEAT);
      toad.root.add(rider.object);
      let hop = frozen ?? 0;
      return {
        object: toad.root,
        update(dt, _state, speed) {
          if (frozen === null) hop = (hop + dt / 0.9) % 1;
          animateToad(toad, hop);
          rider.update(dt, 'ride', speed, frozen);
        },
      };
    }
    case 'board': {
      const g = new THREE.Group();
      const board = buildScrollBoard();
      board.position.y = 0.06;
      g.add(board);
      const rider = humanoid(buildNinja(outline), 'naruto', frozen);
      rider.object.position.y = 0.1;
      g.add(rider.object);
      return {
        object: g,
        update(dt, _state, speed) {
          rider.update(dt, 'surf', speed, frozen);
        },
      };
    }
    default:
      return humanoid(buildNinja(outline), 'naruto', frozen);
  }
}

/** 依視角設定鏡頭位置與視角 */
function placeCamera(cam: THREE.PerspectiveCamera, view: string): void {
  const target = new THREE.Vector3(0, 0.85, 0);
  cam.fov = 30;
  switch (view) {
    case 'back':
      cam.position.set(0, 1.3, 5.2);
      break;
    case 'front':
      cam.position.set(0, 1.1, -5.2);
      break;
    case 'three':
      cam.position.set(3.4, 1.4, -3.8);
      break;
    case 'face':
      cam.position.set(0.7, 1.35, -2.2);
      target.set(0, 1.15, -0.3);
      break;
    case 'game':
      cam.fov = 60;
      cam.position.set(0, 3.5, 6.2);
      target.set(0, 1.1, -6.5);
      break;
    default:
      // 側面：從角色的右手邊看過去（角色面向畫面右邊）
      cam.position.set(5.2, 0.95, 0);
  }
  cam.updateProjectionMatrix();
  cam.lookAt(target);
}

/** 啟動姿勢檢視模式 */
export function startPoseViewer(params: URLSearchParams): void {
  const app = document.getElementById('app')!;
  const stage = createStage(app);

  // 地面＋格線（看得出腳有沒有踩在地上）
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0xd9cba8, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  stage.scene.add(ground);
  const grid = new THREE.GridHelper(60, 60, 0xa8956e, 0xbfae88);
  grid.position.y = 0.002;
  stage.scene.add(grid);

  const outline = Number(params.get('outline') ?? 0.007);
  const phaseParam = params.get('phase');
  const frozen = phaseParam !== null ? Number(phaseParam) : null;
  const model = buildModel(params.get('model') ?? 'ninja', outline, frozen);
  stage.scene.add(model.object);
  const state = (params.get('anim') ?? 'run') as AnimState;
  const speed = Number(params.get('speed') ?? 16);

  placeCamera(stage.camera, params.get('view') ?? 'side');
  if (params.get('model') === 'toad') {
    // 蛤蟆很大：鏡頭拉遠
    stage.camera.position.multiplyScalar(2.2);
    stage.camera.lookAt(0, 1.6, 0);
  }
  // 除錯用：讓 e2e／除錯腳本可以讀鏡頭與角色
  (window as unknown as { __stage: unknown; __rig: unknown }).__stage = stage;
  (window as unknown as { __rig: unknown }).__rig = model.rig;
  window.addEventListener('resize', () => placeCamera(stage.camera, params.get('view') ?? 'side'));

  // 凍結相位時先讓混合收斂（模擬 2 秒），截圖才會是目標姿勢本身
  if (frozen !== null) {
    for (let i = 0; i < 120; i++) model.update(1 / 60, state, speed, frozen);
  }

  let frames = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    model.update(frozen !== null ? 0 : dt, state, speed, frozen);
    stage.render();
    frames++;
    if (frames === 3) {
      const w = window as unknown as { __poseReady: boolean; __poseStats: unknown };
      w.__poseStats = { drawCalls: stage.renderer.info.render.calls, triangles: stage.renderer.info.render.triangles };
      w.__poseReady = true;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
