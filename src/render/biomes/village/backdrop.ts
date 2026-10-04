import * as THREE from 'three';
import { noCurve } from '../../curvedWorld';
import backdropUrl from './backdrop.webp';

/**
 * 木葉村遠景：把手繪的「刻臉岩壁＋山脈＋霧中村落」畫（backdrop.webp，上緣 30% 漸層透明、左右淡出）
 * 貼在玩家正前方遠處的一段大圓弧面上。
 * - MeshBasicMaterial：保留畫裡的光影，不再受場景燈光影響。
 * - fog: false：遠景在霧的最遠距離之外，開著霧會整片變成霧色。
 * - NO_CURVE：不受地平線下彎影響（遠景跟著玩家，永遠在同一個方位）。
 * - transparent＋depthWrite: false：上緣透明處露出天空球；被近處場景擋住的地方照常被深度測試遮住。
 */

/** 圖片原始寬高比（2016×1152） */
const ASPECT = 2016 / 1152;
/** 圓弧半徑（以場景原點為圓心，玩家與鏡頭在原點附近） */
const RADIUS = 380;
/** 圓弧張角（弧度）：涵蓋遊戲鏡頭的水平視角（約 ±46°） */
const THETA = 1.7;
/** 圓弧下緣高度：壓到地平線以下，讓畫底部的霧中村落接在場景消失處 */
const BOTTOM_Y = -128;

/** 預先開始載入的貼圖（createKit 時就開始下載，建遠景時通常已經好了） */
let tex: THREE.Texture | null = null;
/** 貼圖是否已載入完成 */
let loaded = false;
/** 等貼圖載入後要顯示的網格 */
const waiting: THREE.Mesh[] = [];

/** 開始載入遠景貼圖（可重複呼叫） */
export function preloadBackdrop(): void {
  if (tex) return;
  tex = new THREE.TextureLoader().load(backdropUrl, () => {
    loaded = true;
    for (const m of waiting) m.visible = true;
    waiting.length = 0;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
}

/** 建立遠景（大圓弧面＋畫） */
export function buildVillageBackdrop(): THREE.Object3D {
  preloadBackdrop();
  const height = (RADIUS * THETA) / ASPECT;
  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, height, 64, 1, true, Math.PI - THETA / 2, THETA);
  // 從圓柱內側看，u 方向會左右顛倒，把 u 翻過來
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
  const mat = noCurve(
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'village-backdrop';
  mesh.position.y = BOTTOM_Y + height / 2;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // 貼圖還沒載入時先隱藏（未載入的貼圖會取樣成黑色）
  if (!loaded) {
    mesh.visible = false;
    waiting.push(mesh);
  }
  const root = new THREE.Group();
  root.name = 'village-backdrop-root';
  root.add(mesh);
  return root;
}
