import * as THREE from 'three';
import { stdMat } from '../materials';
import { bark, woodGrain, paper } from '../proctex';
import { outlineMat } from '../toon';

/**
 * 角色相關的小道具：通靈卷軸滑板、替身術的木頭。
 */

/** 卷軸滑板紙面貼圖：米色和紙、紅色邊框、中央墨色「忍」字與雲紋 */
function scrollPaperTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const base = paper(0xf3e6c8).map.image as HTMLCanvasElement;
  g.drawImage(base, 0, 0, W, H);
  g.strokeStyle = '#b8282a';
  g.lineWidth = 14;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.lineWidth = 4;
  g.strokeRect(30, 30, W - 60, H - 60);
  g.fillStyle = '#1e1a18';
  g.font = "900 150px 'Noto Serif TC', 'Microsoft JhengHei', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('忍', W / 2, H / 2);
  // 上下雲紋
  g.strokeStyle = 'rgba(30,26,24,0.75)';
  g.lineWidth = 5;
  for (const y of [110, H - 110]) {
    for (const x of [70, 128, 186]) {
      g.beginPath();
      g.arc(x, y, 20, Math.PI, Math.PI * 2.6);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * 通靈卷軸滑板：攤開的巨大卷軸當滑板，兩端是捲起的軸與木把手。長 1.5 m，前方是 −z。
 */
export function buildScrollBoard(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'scrollBoard';
  const paperMat = stdMat({ map: scrollPaperTexture(), roughness: 0.8 });
  const under = stdMat({ color: 0x8a5a33, roughness: 0.7 }, 'board-under');
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 1.5), [under, under, paperMat, under, under, under]);
  deck.castShadow = true;
  g.add(deck);
  const rollMat = stdMat({ color: 0xe9d9b4, roughness: 0.8 }, 'board-roll');
  const capMat = stdMat({ color: 0x5a3820, roughness: 0.6 }, 'board-cap');
  for (const z of [-0.78, 0.78]) {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.66, 16), rollMat);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.03, z);
    roll.castShadow = true;
    g.add(roll);
    for (const x of [-0.36, 0.36]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 12), capMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x, 0.03, z);
      g.add(cap);
    }
  }
  for (const m of [...g.children] as THREE.Mesh[]) m.add(new THREE.Mesh(m.geometry, outlineMat(0.008, 0x24170f)));
  return g;
}

/**
 * 替身術的木頭：撞擊瞬間主角變成一根帶樹皮的短圓木（配煙霧）。
 */
export function buildLog(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'substitutionLog';
  const b = bark(0x7a5636, 0x5f7a32, 31);
  const barkMat = stdMat({ map: b.map, bumpMap: b.bump, bumpScale: 2, roughness: 0.9 }, 'log-bark');
  const w = woodGrain(0xd2a46c, 32);
  const endMat = stdMat({ map: w.map, roughness: 0.8 }, 'log-end');
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.95, 18), [barkMat, endMat, endMat]);
  log.position.y = 0.48;
  log.castShadow = true;
  g.add(log);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.22, 8), barkMat);
  stub.position.set(0.17, 0.62, 0);
  stub.rotation.z = -1.0;
  g.add(stub);
  return g;
}
