import { installCurvedWorld } from './render/curvedWorld';
import './style.css';

// 地平線下彎要在任何材質編譯之前改寫 shader chunk
installCurvedWorld();

/**
 * 進入點：依網址參數決定要開遊戲或除錯檢視模式。
 * - ?pose=1：姿勢檢視（調整跑姿、截圖驗收）
 * - ?scene=<village|forest|valley>：場景預覽（調整場景外觀、截圖驗收）
 */
const params = new URLSearchParams(location.search);

if (params.has('pose')) {
  import('./render/poseViewer').then((m) => m.startPoseViewer(params));
} else if (params.has('scene')) {
  import('./render/sceneViewer').then((m) => m.startSceneViewer(params));
} else {
  import('./game').then((m) => m.startGame(params));
}
