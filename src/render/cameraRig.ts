import * as THREE from 'three';
import { GAME_CAMERA } from './stage';

/**
 * 追尾鏡頭：跟著玩家左右、上下（上車頂時抬高），速度越快視角越寬；撞擊時晃動。
 * 另有開場鏡頭：從主角正前方看著他（塗鴉被發現），再繞到身後。
 */

/** 鏡頭相對玩家的位置與注視點（玩家在原點、面向 −z）；和場景預覽共用 stage.ts 的 GAME_CAMERA */
const OFFSET = GAME_CAMERA.pos;
const LOOK = GAME_CAMERA.look;

/** 每幀餵給鏡頭的資料 */
export interface CameraTarget {
  x: number;
  y: number;
  speed: number;
  /** 騎蛤蟆（鏡頭拉高拉遠） */
  flying: boolean;
}

export class CameraRig {
  private x = 0;
  private y = 0;
  private fly = 0;
  private shakeAmp = 0;
  /** 標題畫面的展示鏡頭（斜前方看主角的忍者跑） */
  private titleMode = false;
  /** 開場鏡頭剩餘秒數（0 = 一般追尾） */
  private intro = 0;
  private introTotal = 1;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** 切換標題畫面的展示鏡頭 */
  setTitle(on: boolean): void {
    this.titleMode = on;
  }

  /** 撞擊或踉蹌時晃動 */
  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** 開始開場鏡頭（從正前方繞到身後） */
  startIntro(seconds: number): void {
    this.intro = seconds;
    this.introTotal = seconds;
  }

  /** 直接跳到目標（新的一局，不要從上一局的位置滑過來） */
  snap(t: CameraTarget): void {
    this.x = t.x;
    this.y = t.y;
    this.fly = t.flying ? 1 : 0;
  }

  /** 推進鏡頭 */
  update(dt: number, t: CameraTarget): void {
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    this.x += (t.x - this.x) * k(7);
    this.y += (t.y - this.y) * k(4);
    // 騎上蛤蟆時鏡頭要快點升高，不然巨蛤蟆會塞滿畫面
    this.fly += ((t.flying ? 1 : 0) - this.fly) * k(3.5);
    const cam = this.camera;
    const pos = new THREE.Vector3(this.x * 0.82, OFFSET.y + this.y * 0.8 + this.fly * 2.2, OFFSET.z + this.fly * 2.5);
    const look = new THREE.Vector3(this.x * 0.9, LOOK.y + this.y * 0.85 + this.fly * 0.5, LOOK.z);
    if (this.titleMode) {
      // 標題：從右前方斜看主角（展示忍者跑），主角在畫面左半邊
      // 注視點往畫面右方偏，主角落在畫面左側，右側留給標題介面
      pos.set(this.x + 3.4, 1.55 + this.y, -3.2);
      look.set(this.x - 2.2, 1.15 + this.y, -0.6);
    }
    if (this.intro > 0) {
      // 開場：從正前方（看著主角的臉）繞半圈到身後
      this.intro = Math.max(0, this.intro - dt);
      const u = 1 - this.intro / this.introTotal;
      const e = u * u * (3 - 2 * u);
      // 角度 π＝正前方、π/2＝側面（剛好展示忍者跑）、0＝身後
      const ang = (1 - e) * Math.PI;
      const r = 4.6;
      // 從主角左側繞：追捕者站在右後方，從右側繞會被他擋住
      const orbit = new THREE.Vector3(this.x - Math.sin(ang) * r, 1.3 + e * 0.8, Math.cos(ang) * r);
      pos.lerp(orbit, 1 - e);
      look.lerp(new THREE.Vector3(this.x, 1.0, 0), 1 - e);
    }
    if (this.shakeAmp > 0.001) {
      pos.x += (Math.random() - 0.5) * this.shakeAmp;
      pos.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 6);
    }
    cam.position.copy(pos);
    cam.lookAt(look);
    const fov = GAME_CAMERA.fov + Math.max(0, t.speed - 12) * 0.35 + this.fly * 6;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * k(2);
      cam.updateProjectionMatrix();
    }
  }
}
