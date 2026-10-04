import * as THREE from 'three';
import { stdMat } from '../materials';
import { glowTexture } from '../textures';
import { outlineMat } from '../toon';
import type { Projectile } from '../../sim/types';

/**
 * 飛行中的手裏劍與起爆符苦無（物件池重複使用）：
 * - 手裏劍：四片彎刃的鋼製星形，斜對鏡頭高速旋轉，外圍一圈藍白光暈（遠處也看得到）。
 * - 起爆符苦無：刀尖朝前，柄纏布、尾端圓環綁一張寫著「爆」的符紙，符紙往後飄動，外圍一圈橘光。
 * 判定只看車道（見 sim/run.ts），外觀放大 1.5 倍方便辨認。
 */

/** 外觀放大倍率（實際大小在追尾鏡頭裡太小） */
const VIEW_SCALE = 1.5;

/** 手裏劍：四片彎刃（中間圓孔）的擠出幾何，平放在 xy 平面 */
function shurikenGeometry(): THREE.ExtrudeGeometry {
  const R = 0.26; // 刃尖半徑
  const r = 0.07; // 刃根半徑
  const s = new THREE.Shape();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const from = a - Math.PI / 4;
    if (i === 0) s.moveTo(Math.cos(from) * r, Math.sin(from) * r);
    // 刃的一邊是內凹的弧線、另一邊是直線，轉起來才有「風車」感
    s.quadraticCurveTo(Math.cos(a - 0.3) * R * 0.5, Math.sin(a - 0.3) * R * 0.5, Math.cos(a) * R, Math.sin(a) * R);
    s.lineTo(Math.cos(a + Math.PI / 4) * r, Math.sin(a + Math.PI / 4) * r);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.032, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 6 });
  g.center();
  return g;
}

/** 起爆符的紙面貼圖：米色符紙、紅色邊框、中央黑底紅字「爆」 */
function tagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3e6c8';
  g.fillRect(0, 0, 64, 160);
  g.strokeStyle = '#b8282a';
  g.lineWidth = 6;
  g.strokeRect(4, 4, 56, 152);
  g.fillStyle = '#1d1a17';
  g.font = "900 40px 'Noto Serif TC', 'Microsoft JhengHei', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('起', 32, 34);
  g.fillStyle = '#c8352a';
  g.font = "900 54px 'Noto Serif TC', 'Microsoft JhengHei', serif";
  g.fillText('爆', 32, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 光暈 sprite（加法混合） */
function haloSprite(tex: THREE.Texture, color: number, size: number): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }));
  sp.scale.set(size, size, 1);
  return sp;
}

/** 建立手裏劍模板：spinner 子節點負責旋轉 */
function buildShuriken(glowTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shuriken';
  // 斜躺約 55°，追尾鏡頭從後上方看得到整個星形
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.95;
  g.add(tilt);
  const spinner = new THREE.Group();
  spinner.name = 'spinner';
  tilt.add(spinner);
  const steel = stdMat({ color: 0x4a525c, metalness: 0.85, roughness: 0.32 }, 'shuriken-steel');
  const star = new THREE.Mesh(shurikenGeometry(), steel);
  star.add(new THREE.Mesh(star.geometry, outlineMat(0.008, 0x14161a)));
  spinner.add(star);
  g.add(haloSprite(glowTex, 0x9fd8ff, 0.9));
  g.scale.setScalar(VIEW_SCALE);
  return g;
}

/** 建立起爆符苦無模板：刀尖朝 −z；tag 子節點是會飄動的符紙 */
function buildKunai(glowTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  g.name = 'kunai';
  const steel = stdMat({ color: 0x5a626c, metalness: 0.85, roughness: 0.3 }, 'kunai-steel');
  const wrap = stdMat({ color: 0x2a2f45, roughness: 0.9 }, 'kunai-wrap');
  // 刀身：拉長壓扁的八面體（菱形刀刃）
  const blade = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), steel);
  blade.scale.set(0.07, 0.018, 0.17);
  blade.position.z = -0.17;
  g.add(blade);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.17, 8), wrap);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = 0.08;
  g.add(handle);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 16), steel);
  ring.position.z = 0.2;
  g.add(ring);
  for (const m of [blade, handle, ring]) m.add(new THREE.Mesh(m.geometry, outlineMat(0.006, 0x14161a)));
  // 符紙：上緣綁在圓環上，往後（+z）垂掛飄動
  const pivot = new THREE.Group();
  pivot.name = 'tag';
  pivot.position.z = 0.22;
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.22),
    new THREE.MeshStandardMaterial({ map: tagTexture(), side: THREE.DoubleSide, roughness: 0.85 }),
  );
  tag.rotation.x = -Math.PI / 2;
  tag.position.z = 0.11;
  pivot.add(tag);
  g.add(pivot);
  g.add(haloSprite(glowTex, 0xff8a3d, 0.8));
  g.scale.setScalar(VIEW_SCALE);
  return g;
}

/** 場上所有飛行道具的畫面 */
export class ProjectileField {
  private readonly glowTex = glowTexture();
  private readonly templates: Record<Projectile['kind'], THREE.Group>;
  private readonly views = new Map<number, THREE.Object3D>();
  private readonly pool: Record<Projectile['kind'], THREE.Object3D[]> = { shuriken: [], kunai: [] };

  constructor(private readonly parent: THREE.Object3D) {
    this.templates = { shuriken: buildShuriken(this.glowTex), kunai: buildKunai(this.glowTex) };
  }

  /**
   * 依模擬的飛行道具清單更新畫面。
   * @param time 經過秒數（旋轉、飄動）
   */
  sync(list: readonly Projectile[], time: number): void {
    const alive = new Set<number>();
    for (const pr of list) {
      if (pr.dead) continue;
      alive.add(pr.id);
      let v = this.views.get(pr.id);
      if (!v) {
        v = this.pool[pr.kind].pop() ?? this.templates[pr.kind].clone();
        v.userData.kind = pr.kind;
        this.parent.add(v);
        this.views.set(pr.id, v);
      }
      v.position.set(pr.x, pr.y, -pr.z);
      if (pr.kind === 'shuriken') {
        const spinner = v.getObjectByName('spinner');
        if (spinner) spinner.rotation.z = -time * 32;
      } else {
        const tag = v.getObjectByName('tag');
        if (tag) tag.rotation.x = 0.25 + Math.sin(time * 28 + pr.id) * 0.35;
      }
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      v.removeFromParent();
      this.views.delete(id);
      this.pool[v.userData.kind as Projectile['kind']].push(v);
    }
  }

  /** 預熱用：兩種模板各一份 clone（呼叫端放進場景編譯 shader 後移除） */
  warmupObjects(): THREE.Object3D[] {
    return [this.templates.shuriken.clone(), this.templates.kunai.clone()];
  }

  /** 清空（新的一局） */
  clear(): void {
    this.sync([], 0);
  }
}
