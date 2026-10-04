import * as THREE from 'three';
import { smokeTexture, glowTexture } from './textures';
import { solid } from './materials';

/**
 * 粒子特效（物件池重複使用）：
 * - 煙霧「砰」：替身術、影分身、通靈蛤蟆、撿到道具（可染色：爆炸的火球、黑煙）。
 * - 閃光：撿到兩時金色小光點往外散；手裏劍打在列車上的火花；爆炸的閃光。
 * - 碎片：障礙被打碎時的小方塊，受重力落地、彈跳、翻轉後縮小消失。
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
  /** 橫向拉長倍率（瞬身術的殘影用；1 = 正圓） */
  stretch: number;
}

/** 一塊碎片 */
interface Chip {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
  /** 原本的大小（最後 0.3 秒縮小用） */
  scale: THREE.Vector3;
}

/** 碎片的重力（比真實大一點，看起來比較俐落） */
const CHIP_GRAVITY = 20;

export class Fx {
  private readonly smokeMat: THREE.SpriteMaterial;
  private readonly glowTex: THREE.Texture;
  private readonly live: Particle[] = [];
  private readonly smokePool: THREE.Sprite[] = [];
  private readonly sparkPool: THREE.Sprite[] = [];
  /** 碎片共用的方塊幾何 */
  private readonly chipGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly chips: Chip[] = [];
  private readonly chipPool: THREE.Mesh[] = [];

  constructor(private readonly parent: THREE.Object3D) {
    this.smokeMat = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false });
    this.glowTex = glowTexture();
  }

  /**
   * 煙霧「砰」：在 (x, y, simZ) 一團煙往外擴散、淡出。
   * @param size 煙霧大小（公尺）
   * @param count 煙團數
   * @param color 染色（預設白煙）
   */
  puff(x: number, y: number, simZ: number, size = 1.6, count = 7, color = 0xffffff): void {
    for (let i = 0; i < count; i++) {
      const sp = this.smokePool.pop() ?? new THREE.Sprite(this.smokeMat.clone());
      const a = (i / count) * Math.PI * 2 + Math.random();
      const r = Math.random() * size * 0.35;
      sp.position.set(x + Math.cos(a) * r, y + Math.random() * size * 0.5, -simZ + Math.sin(a) * r);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = 1;
      m.rotation = Math.random() * Math.PI;
      m.color.set(color);
      this.parent.add(sp);
      this.live.push({
        sprite: sp,
        life: 0.55 + Math.random() * 0.3,
        age: 0,
        vel: new THREE.Vector3(Math.cos(a) * size * 1.4, size * 0.9 + Math.random(), Math.sin(a) * size * 1.4),
        s0: size * 0.5,
        s1: size * (1.2 + Math.random() * 0.5),
        spin: (Math.random() - 0.5) * 2,
        stretch: 1,
      });
    }
  }

  /** 從物件池取一個發光 sprite（加法混合）並設好顏色 */
  private glowSprite(color: number): THREE.Sprite {
    const sp =
      this.sparkPool.pop() ??
      new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    const m = sp.material as THREE.SpriteMaterial;
    m.color.set(color);
    m.opacity = 1;
    m.rotation = 0;
    sp.userData.spark = true;
    return sp;
  }

  /** 金色閃光：撿到兩 */
  sparkle(x: number, y: number, simZ: number, color = 0xffd23f): void {
    for (let i = 0; i < 5; i++) {
      const sp = this.glowSprite(color);
      sp.position.set(x, y, -simZ);
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
        stretch: 1,
      });
    }
  }

  /**
   * 一團不動的閃光：從 size×0.4 放大到 size 並淡出（爆炸、手裏劍火花、螺旋丸撞擊）。
   * @param stretch 橫向拉長倍率（瞬身術的殘影）
   */
  flash(x: number, y: number, simZ: number, color: number, size: number, life = 0.3, stretch = 1): void {
    const sp = this.glowSprite(color);
    sp.position.set(x, y, -simZ);
    this.parent.add(sp);
    this.live.push({ sprite: sp, life, age: 0, vel: new THREE.Vector3(), s0: size * 0.4, s1: size, spin: 0, stretch });
  }

  /**
   * 火花：小光點往四周快速噴出（手裏劍被列車彈開）。
   * @param count 光點數
   */
  sparks(x: number, y: number, simZ: number, color = 0xfff1b0, count = 8): void {
    for (let i = 0; i < count; i++) {
      const sp = this.glowSprite(color);
      sp.position.set(x, y, -simZ);
      this.parent.add(sp);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 4;
      this.live.push({
        sprite: sp,
        life: 0.25 + Math.random() * 0.15,
        age: 0,
        vel: new THREE.Vector3(Math.cos(a) * 6, up + 1, Math.sin(a) * 3 + 4),
        s0: 0.32,
        s1: 0.06,
        spin: 0,
        stretch: 1,
      });
    }
  }

  /**
   * 碎片：障礙被打碎時小方塊往外、往前噴，落地彈跳後縮小消失。
   * @param colors 碎片顏色（輪流使用）
   * @param count 碎片數
   * @param spread 生成範圍（公尺）
   * @param size 碎片大小（公尺）
   */
  debris(x: number, y: number, simZ: number, colors: readonly number[], count = 14, spread = 1, size = 0.22): void {
    for (let i = 0; i < count; i++) {
      const m = this.chipPool.pop() ?? new THREE.Mesh(this.chipGeo);
      m.material = solid(colors[i % colors.length], 0.82);
      const s = size * (0.5 + Math.random());
      m.scale.set(s, s * (0.35 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.8));
      m.position.set(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.3) * spread * 0.8, -simZ + (Math.random() - 0.5) * spread);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.parent.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 5;
      this.chips.push({
        mesh: m,
        // 往四周＋往前方（local −z，玩家前進的方向）噴，玩家跑過去時碎片還在眼前
        vel: new THREE.Vector3(Math.cos(a) * sp, 3.5 + Math.random() * 6, Math.sin(a) * sp * 0.6 - 3 - Math.random() * 5),
        spin: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
        age: 0,
        life: 1.0 + Math.random() * 0.6,
        scale: m.scale.clone(),
      });
    }
  }

  /** 起爆符爆炸：橘色閃光＋火球＋黑煙＋碎片 */
  explosion(x: number, y: number, simZ: number): void {
    this.flash(x, y + 0.3, simZ, 0xffb347, 7, 0.4);
    this.flash(x, y + 0.3, simZ, 0xfff4c0, 3.5, 0.18);
    this.puff(x, y, simZ, 2.4, 9, 0xff9a4a);
    this.puff(x, y + 0.8, simZ, 3.0, 7, 0x4a403a);
    this.debris(x, y, simZ, [0x3a3430, 0x6b4a2b, 0xb8282a, 0xf3e6c8], 14, 1.4, 0.26);
  }

  /** 推進所有粒子與碎片 */
  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const t = Math.min(1, p.age / p.life);
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * 3));
      const s = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      p.sprite.scale.set(s * p.stretch, s, 1);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.opacity = 1 - t * t;
      m.rotation += p.spin * dt;
      if (t >= 1) {
        p.sprite.removeFromParent();
        (p.sprite.userData.spark ? this.sparkPool : this.smokePool).push(p.sprite);
        this.live.splice(i, 1);
      }
    }
    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i];
      c.age += dt;
      c.vel.y -= CHIP_GRAVITY * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      // 落地：彈一下、減速
      if (c.mesh.position.y < 0.06 && c.vel.y < 0) {
        c.mesh.position.y = 0.06;
        c.vel.y *= -0.3;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.5);
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const shrink = Math.min(1, (c.life - c.age) / 0.3);
      c.mesh.scale.copy(c.scale).multiplyScalar(Math.max(0.001, shrink));
      if (c.age >= c.life) {
        c.mesh.removeFromParent();
        this.chipPool.push(c.mesh);
        this.chips.splice(i, 1);
      }
    }
  }

  /**
   * 預熱用：回傳一組暫時的碎片、閃光物件（放進場景編譯 shader 用，呼叫端負責移除）。
   */
  warmupObjects(): THREE.Object3D[] {
    const chip = new THREE.Mesh(this.chipGeo, solid(0x6b4a2b, 0.82));
    const glow = this.glowSprite(0xffffff);
    const smoke = new THREE.Sprite(this.smokeMat);
    return [chip, glow, smoke];
  }

  /** 清掉所有粒子與碎片（新的一局） */
  clear(): void {
    for (const p of this.live) {
      p.sprite.removeFromParent();
      (p.sprite.userData.spark ? this.sparkPool : this.smokePool).push(p.sprite);
    }
    this.live.length = 0;
    for (const c of this.chips) {
      c.mesh.removeFromParent();
      this.chipPool.push(c.mesh);
    }
    this.chips.length = 0;
  }
}
