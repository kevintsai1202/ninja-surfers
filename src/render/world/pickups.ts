import * as THREE from 'three';
import { stdMat, glow } from '../materials';
import { badgeTexture, glowTexture } from '../textures';
import type { Pickup, PowerKind } from '../../sim/types';

/**
 * 場上的道具：漂浮旋轉的漢字徽章（蛙／查／引／影／丸／劍／螺／爆／替）與秘傳卷軸，後面有一圈光暈。
 */

/** 各道具的徽章漢字、顏色與名稱（HUD、橫幅共用） */
export const POWER_INFO: Record<PowerKind, { kanji: string; color: string; name: string }> = {
  toad: { kanji: '蛙', color: '#e4572a', name: '通靈術・巨蛤蟆' },
  chakra: { kanji: '查', color: '#2f7de1', name: '查克拉附著' },
  magnet: { kanji: '引', color: '#7a4bd6', name: '萬象天引' },
  clones: { kanji: '影', color: '#f09a17', name: '多重影分身之術' },
  scroll: { kanji: '秘', color: '#b8282a', name: '秘傳卷軸' },
  pill: { kanji: '丸', color: '#3d9a4a', name: '兵糧丸' },
  // 第二版新招式
  shuriken: { kanji: '劍', color: '#4f6475', name: '手裏劍 +3' },
  rasengan: { kanji: '螺', color: '#15b3d6', name: '螺旋丸' },
  kunai: { kanji: '爆', color: '#c21d3c', name: '起爆符苦無' },
  sub: { kanji: '替', color: '#8a5a2b', name: '替身木頭' },
};

/** 共用的光暈貼圖 */
let glowTex: THREE.Texture | null = null;

/** 建立一種道具的外觀模板 */
function buildTemplate(kind: PowerKind): THREE.Group {
  const info = POWER_INFO[kind];
  const g = new THREE.Group();
  g.name = `pickup-${kind}`;
  const spinner = new THREE.Group();
  spinner.name = 'spinner';
  g.add(spinner);
  if (kind === 'scroll') {
    // 秘傳卷軸：捲起來的紙軸＋兩端木軸＋紅色封條
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 20), stdMat({ color: 0xf1e2bf, roughness: 0.7 }, 'scroll-paper'));
    paper.rotation.z = Math.PI / 2;
    spinner.add(paper);
    for (const x of [-0.36, 0.36]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 14), stdMat({ color: 0x6b3f1f, roughness: 0.5 }, 'scroll-cap'));
      cap.rotation.z = Math.PI / 2;
      cap.position.x = x;
      spinner.add(cap);
    }
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.12, 20), glow(0xc0262a, 0.4));
    seal.rotation.z = Math.PI / 2;
    spinner.add(seal);
  } else {
    // 徽章：兩面都有漢字的圓盤＋金色外框
    const tex = badgeTexture(info.kanji, info.color);
    const face = stdMat({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 });
    const rim = stdMat({ color: 0xffd25a, metalness: 0.8, roughness: 0.3 }, 'badge-rim');
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 36), [rim, face, face]);
    disc.rotation.x = Math.PI / 2;
    spinner.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.035, 8, 40), rim);
    spinner.add(ring);
  }
  glowTex ??= glowTexture();
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(info.color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }),
  );
  halo.scale.set(1.8, 1.8, 1);
  g.add(halo);
  return g;
}

/** 場上所有道具的畫面 */
export class PickupField {
  private readonly templates = new Map<PowerKind, THREE.Group>();
  private readonly views = new Map<number, THREE.Object3D>();
  private readonly pool = new Map<PowerKind, THREE.Object3D[]>();

  constructor(private readonly parent: THREE.Object3D) {}

  /** 依模擬的道具清單更新畫面（漂浮、旋轉） */
  sync(pickups: readonly Pickup[], time: number): void {
    const alive = new Set<number>();
    for (const k of pickups) {
      if (k.taken) continue;
      alive.add(k.id);
      let v = this.views.get(k.id);
      if (!v) {
        v = this.pool.get(k.kind)?.pop() ?? this.template(k.kind).clone();
        v.userData.kind = k.kind;
        this.parent.add(v);
        this.views.set(k.id, v);
      }
      v.position.set(k.lane * 2.5, k.y + 0.25 + Math.sin(time * 3 + k.id) * 0.12, -k.z);
      const spinner = v.getObjectByName('spinner');
      if (spinner) spinner.rotation.y = time * 2.2 + k.id;
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      v.removeFromParent();
      this.views.delete(id);
      const kind = v.userData.kind as PowerKind;
      const list = this.pool.get(kind) ?? [];
      list.push(v);
      this.pool.set(kind, list);
    }
  }

  /** 清空（新的一局） */
  clear(): void {
    this.sync([], 0);
  }

  /** 取得（必要時建立）道具模板 */
  private template(kind: PowerKind): THREE.Group {
    let t = this.templates.get(kind);
    if (!t) {
      t = buildTemplate(kind);
      this.templates.set(kind, t);
    }
    return t;
  }
}
