import * as THREE from 'three';
import { noCurve } from '../../curvedWorld';
import backdropUrl from './backdrop.webp';
import { silhouetteTexture } from './textures';

/**
 * 遠景：森林深處的手繪遠景畫（backdrop.webp，2016×1152、上緣是不透明的樹冠、左右淡出）
 * 貼在正前方的大弧面（圓柱的一段，半徑 R）上。
 * - MeshBasicMaterial 保留畫裡的光影；fog: false（遠景在霧的範圍外，不關會整片變成霧色）；noCurve（不跟著地平線下彎）。
 * - 畫中「林道盡頭的亮霧」對準遊戲鏡頭看到的地平線（下彎地面的輪廓約在水平線下 6°）。
 * - 畫的上緣再接一條漸層帶，從樹冠色淡入天空，鏡頭往上看也不會看到硬邊。
 */

/** 弧面半徑 */
const R = 290;
/** 弧面張角（弧度） */
const THETA = 1.95;
/** 圖片寬高比 */
const ASPECT = 2016 / 1152;
/** 畫中林道盡頭（亮霧中心）在圖片高度的比例（由上往下量） */
const VP_FRAC = 0.6;
/** 林道盡頭要對準的仰角（度，負值＝水平線以下） */
const VP_DEG = -5.2;
/** 參考鏡頭高度（遊戲鏡頭） */
const CAM_Y = 3.5;

/** 畫上緣漸層帶的貼圖：底部是樹冠暗綠、往上淡出 */
function fadeTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const r = (color >> 16) & 255;
  const gg = (color >> 8) & 255;
  const b = color & 255;
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grd.addColorStop(0.35, `rgba(${r},${gg},${b},0.75)`);
  grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 建一段圓柱弧面（從裡面看；u 由左到右）。預設是正前方（−z）張角 THETA 的那一段 */
function arcGeometry(height: number, segs: number, radius = R, start = Math.PI - THETA / 2, length = THETA): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, segs, 1, true, start, length);
  // 圓柱的 u 由 +x 往 −x 增加（從裡面看是右到左），翻過來讓畫不會左右顛倒
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  return g;
}

/** 建立遠景 */
export function buildForestBackdrop(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'forest-backdrop';
  const H = (R * THETA) / ASPECT;
  const vpY = CAM_Y + R * Math.tan((VP_DEG * Math.PI) / 180);
  const centerY = vpY + (VP_FRAC - 0.5) * H;

  const tex = new THREE.TextureLoader().load(backdropUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = noCurve(
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }),
  );
  const mesh = new THREE.Mesh(arcGeometry(H, 64), mat);
  mesh.position.y = centerY;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  group.add(mesh);

  // 上緣漸層帶（樹冠暗綠淡入天空）
  const bandH = 120;
  const band = new THREE.Mesh(
    arcGeometry(bandH, 32),
    noCurve(new THREE.MeshBasicMaterial({ map: fadeTexture(0x0f2414), transparent: true, depthWrite: false, fog: false, side: THREE.BackSide })),
  );
  band.position.y = centerY + H / 2 + bandH / 2 - 2;
  band.renderOrder = -1;
  band.frustumCulled = false;
  group.add(band);

  // 左右兩側的樹林剪影帶（遠景畫只蓋正前方；側面鏡頭、轉頭看時才不會看到空蕩的地面邊緣）
  const sil = silhouetteTexture();
  sil.repeat.set(2, 1);
  const silMat = noCurve(new THREE.MeshBasicMaterial({ map: sil, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
  const SR = 240;
  const sideH = 160;
  const span = 1.9;
  for (const s of [-1, 1]) {
    // 與遠景畫邊緣（已淡出）重疊一點，接縫才看不出來
    const start = s > 0 ? Math.PI + THETA / 2 - 0.16 : Math.PI - THETA / 2 + 0.16 - span;
    const side = new THREE.Mesh(arcGeometry(sideH, 24, SR, start, span), silMat);
    side.position.y = -sideH / 2 + 62;
    side.renderOrder = -0.5;
    side.frustumCulled = false;
    group.add(side);
  }
  return group;
}
