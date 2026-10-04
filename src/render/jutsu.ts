import * as THREE from 'three';
import { glowTexture } from './textures';
import type { JutsuInfo } from '../sim/characters';

/**
 * 招牌忍術的手上特效（撿到「螺旋丸」道具時依角色顯示，效果相同、外觀不同）：
 * - sphere：螺旋丸（亮白核心＋半透明外殼＋三圈旋轉氣流＋光暈）
 * - lightning：千鳥／雷切（小亮核＋每幀重新亂數的鋸齒雷光＋閃爍光暈）
 * - fist：怪力（包住拳頭的發光球＋旋轉光環，腳下一圈查克拉光）
 * 全部用加法混合、不受光照；群組跟著右手，腳下光（feet）由呼叫端擺在腳下。
 */

/** 一個忍術特效 */
export interface JutsuView {
  /** 跟著右手的群組 */
  group: THREE.Group;
  /** 腳下的光（怪力才有）；呼叫端加進場景、擺位置 */
  feet?: THREE.Object3D;
  /** 每幀動畫（time：經過秒數） */
  update(time: number): void;
}

/** 加法混合的共同設定 */
const ADD = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;

/** 共用光暈貼圖 */
let glowTex: THREE.Texture | null = null;
function glow(): THREE.Texture {
  glowTex ??= glowTexture();
  return glowTex;
}

/** 光暈 sprite */
function halo(color: THREE.ColorRepresentation, size: number, opacity = 0.9): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, opacity, ...ADD }));
  sp.scale.set(size, size, 1);
  return sp;
}

/** 螺旋丸：亮白核心＋半透明外殼＋三圈旋轉氣流＋光暈 */
function sphereJutsu(color: THREE.Color): JutsuView {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xe8fbff })));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshBasicMaterial({ color, opacity: 0.5, ...ADD })));
  const swirl = new THREE.Group();
  const ringColor = color.clone().lerp(new THREE.Color(0xffffff), 0.6);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25 + i * 0.028, 0.014, 6, 36), new THREE.MeshBasicMaterial({ color: ringColor, opacity: 0.85, ...ADD }));
    ring.rotation.set(i * 1.1, i * 0.7, 0);
    swirl.add(ring);
  }
  g.add(swirl);
  g.add(halo(color, 1.7));
  return {
    group: g,
    update(time) {
      g.scale.setScalar(1 + Math.sin(time * 24) * 0.06);
      swirl.rotation.y = time * 18;
      swirl.rotation.x = time * 11;
    },
  };
}

/** 千鳥／雷切：小亮核、閃爍光暈、每幀重新亂數的鋸齒雷光 */
function lightningJutsu(color: THREE.Color): JutsuView {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const inner = halo(0xffffff, 0.7, 0.95);
  const outer = halo(color, 1.9, 0.85);
  g.add(inner, outer);
  // 雷光：BOLTS 條、每條 SEGS 段，用 LineSegments（每段兩個頂點）
  const BOLTS = 9;
  const SEGS = 5;
  const pos = new Float32Array(BOLTS * SEGS * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const boltColor = color.clone().lerp(new THREE.Color(0xffffff), 0.45);
  const bolts = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: boltColor, opacity: 0.95, ...ADD }));
  bolts.frustumCulled = false;
  g.add(bolts);
  // 第二層：同樣的雷光放大一點點，看起來比較粗
  const thick = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, opacity: 0.6, ...ADD }));
  thick.scale.setScalar(1.04);
  thick.frustumCulled = false;
  g.add(thick);
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  let next = 0;
  return {
    group: g,
    update(time) {
      // 每 0.04 秒換一次雷光形狀，光暈跟著閃
      if (time >= next) {
        next = time + 0.04;
        let k = 0;
        for (let b = 0; b < BOLTS; b++) {
          p.set(0, 0, 0);
          d.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
          for (let s = 0; s < SEGS; s++) {
            pos[k++] = p.x;
            pos[k++] = p.y;
            pos[k++] = p.z;
            d.x += (Math.random() - 0.5) * 1.1;
            d.y += (Math.random() - 0.5) * 1.1;
            d.z += (Math.random() - 0.5) * 1.1;
            d.normalize();
            p.addScaledVector(d, 0.07 + Math.random() * 0.06);
            pos[k++] = p.x;
            pos[k++] = p.y;
            pos[k++] = p.z;
          }
        }
        geo.attributes.position.needsUpdate = true;
        geo.computeBoundingSphere();
        (outer.material as THREE.SpriteMaterial).opacity = 0.55 + Math.random() * 0.45;
        const s = 1.6 + Math.random() * 0.6;
        outer.scale.set(s, s, 1);
      }
    },
  };
}

/** 怪力：包住拳頭的發光球＋旋轉光環，腳下一圈查克拉光 */
function fistJutsu(color: THREE.Color): JutsuView {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), new THREE.MeshBasicMaterial({ color, opacity: 0.5, ...ADD })));
  g.add(halo(color, 1.3));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.014, 6, 32), new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.4), opacity: 0.85, ...ADD }));
  g.add(ring);
  const feet = halo(color, 1, 0.8);
  return {
    group: g,
    feet,
    update(time) {
      const pulse = 1 + Math.sin(time * 16) * 0.12;
      g.scale.setScalar(pulse);
      ring.rotation.set(time * 7, time * 5, 0);
      feet.scale.set(1.9 * pulse, 0.75 * pulse, 1);
    },
  };
}

/**
 * 依角色的招牌忍術建立手上特效（不顯示；呼叫端控制 visible 與位置）。
 */
export function buildJutsu(info: JutsuInfo): JutsuView {
  const color = new THREE.Color(info.color);
  const view = info.style === 'lightning' ? lightningJutsu(color) : info.style === 'fist' ? fistJutsu(color) : sphereJutsu(color);
  view.group.name = `jutsu-${info.name}`;
  view.group.visible = false;
  if (view.feet) view.feet.visible = false;
  return view;
}
