import * as THREE from 'three';
import { smokeTexture, glowTexture } from './textures';

/**
 * 粒子特效（物件池重複使用）：
 * - 煙霧「砰」：替身術、影分身、通靈蛤蟆、撿到道具。
 * - 閃光：撿到兩時金色小光點往外散。
 * 特效放在世界裡（local 座標：模擬 z → −z），玩家會從特效旁邊跑過去。
 */

/** 一個粒子 */
interface Particle {
  sprite: THREE.Sprite;
  life: number;
  age: number;
  vel: THREE.Vector3;
  s0: number;
  s1: number;
  spin: number;
}

export class Fx {
  private readonly smokeMat: THREE.SpriteMaterial;
  private readonly glowTex: THREE.Texture;
  private readonly live: Particle[] = [];
  private readonly smokePool: THREE.Sprite[] = [];
  private readonly sparkPool: THREE.Sprite[] = [];

  constructor(private readonly parent: THREE.Object3D) {
    this.smokeMat = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false });
    this.glowTex = glowTexture();
  }

  /**
   * 煙霧「砰」：在 (x, y, simZ) 一團煙往外擴散、淡出。
   * @param size 煙霧大小（公尺）
   * @param count 煙團數
   */
  puff(x: number, y: number, simZ: number, size = 1.6, count = 7): void {
    for (let i = 0; i < count; i++) {
      const sp = this.smokePool.pop() ?? new THREE.Sprite(this.smokeMat.clone());
      const a = (i / count) * Math.PI * 2 + Math.random();
      const r = Math.random() * size * 0.35;
      sp.position.set(x + Math.cos(a) * r, y + Math.random() * size * 0.5, -simZ + Math.sin(a) * r);
      (sp.material as THREE.SpriteMaterial).opacity = 1;
      (sp.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
      this.parent.add(sp);
      this.live.push({
        sprite: sp,
        life: 0.55 + Math.random() * 0.3,
        age: 0,
        vel: new THREE.Vector3(Math.cos(a) * size * 1.4, size * 0.9 + Math.random(), Math.sin(a) * size * 1.4),
        s0: size * 0.5,
        s1: size * (1.2 + Math.random() * 0.5),
        spin: (Math.random() - 0.5) * 2,
      });
    }
  }

  /** 金色閃光：撿到兩 */
  sparkle(x: number, y: number, simZ: number, color = 0xffd23f): void {
    for (let i = 0; i < 5; i++) {
      const sp =
        this.sparkPool.pop() ??
        new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      (sp.material as THREE.SpriteMaterial).color.set(color);
      (sp.material as THREE.SpriteMaterial).opacity = 1;
      sp.position.set(x, y, -simZ);
      sp.userData.spark = true;
      this.parent.add(sp);
      const a = Math.random() * Math.PI * 2;
      this.live.push({
        sprite: sp,
        life: 0.35,
        age: 0,
        vel: new THREE.Vector3(Math.cos(a) * 2.5, 1.5 + Math.random() * 2, Math.sin(a) * 2.5 + 6),
        s0: 0.45,
        s1: 0.1,
        spin: 0,
      });
    }
  }

  /** 推進所有粒子 */
  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const t = Math.min(1, p.age / p.life);
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * 3));
      const s = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      p.sprite.scale.set(s, s, 1);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.opacity = 1 - t * t;
      m.rotation += p.spin * dt;
      if (t >= 1) {
        p.sprite.removeFromParent();
        (p.sprite.userData.spark ? this.sparkPool : this.smokePool).push(p.sprite);
        this.live.splice(i, 1);
      }
    }
  }

  /** 清掉所有粒子（新的一局） */
  clear(): void {
    for (const p of this.live) p.sprite.removeFromParent();
    this.live.length = 0;
  }
}
