import * as THREE from 'three';
import type { CharacterId } from '../../sim/characters';
import { buildDog, animateDog, buildToad, animateToad, TOAD_SEAT } from './creatures';
import { buildSnakeMount, buildSlugMount } from './summons';

/**
 * 通靈獸坐騎（取代第一版的通靈卷軸滑板，效果不變：30 秒、擋一次正面撞擊）：
 * 鳴人＝小蛤蟆、佐助＝大蛇、小櫻＝蛞蝓、卡卡西＝忍犬。
 * 坐騎的根節點放在主角腳下（地面高度跟著模擬的 y），騎乘者放在 root.position + seat。
 */

/** 一隻坐騎 */
export interface MountRig {
  /** 根節點（腳底、面向 −z） */
  root: THREE.Group;
  /** 騎乘者（角色根節點）相對坐騎根節點的位置；每幀 update 後可能變（例如跳躍起伏） */
  seat: THREE.Vector3;
  /** 騎姿：ride＝蹲坐（小蛤蟆、忍犬）、surf＝側身站著（大蛇、蛞蝓） */
  pose: 'ride' | 'surf';
  /**
   * 每幀動畫。
   * @param dt 秒
   * @param speed 跑速（m/s），決定步頻、擺動頻率
   */
  update(dt: number, speed: number): void;
}

/** 小蛤蟆的縮放（巨蛤蟆約 1.9 m 高 → 約 0.8 m） */
const KID_TOAD_SCALE = 0.42;
/** 忍犬的放大倍率（原本約 0.5 m 高，放大到可以騎） */
const DOG_SCALE = 1.55;

/** 鳴人的小蛤蟆：一跳一跳往前，主角蹲坐在頭上 */
function toadMount(): MountRig {
  const toad = buildToad('kid');
  const root = new THREE.Group();
  root.name = 'mount-toad';
  // 內層做跳躍起伏，外層 root 由角色畫面擺位置
  const hopper = new THREE.Group();
  hopper.scale.setScalar(KID_TOAD_SCALE);
  hopper.add(toad.root);
  root.add(hopper);
  const base = TOAD_SEAT.clone().multiplyScalar(KID_TOAD_SCALE);
  const seat = base.clone();
  let hop = 0;
  return {
    root,
    seat,
    pose: 'ride',
    update(dt, speed) {
      hop = (hop + dt * (1.6 + speed * 0.06)) % 1;
      animateToad(toad, hop);
      const lift = Math.sin(hop * Math.PI) * 0.14;
      hopper.position.y = lift;
      seat.set(base.x, base.y + lift, base.z);
    },
  };
}

/** 卡卡西的忍犬：放大的小巴哥犬，主角蹲坐在背上 */
function dogMount(): MountRig {
  const dog = buildDog();
  const root = new THREE.Group();
  root.name = 'mount-dog';
  dog.root.scale.setScalar(DOG_SCALE);
  root.add(dog.root);
  const seat = new THREE.Vector3(0, 0.36 * DOG_SCALE, 0.04);
  let phase = 0;
  return {
    root,
    seat,
    pose: 'ride',
    update(dt, speed) {
      phase = (phase + dt * (2.4 + speed * 0.07)) % 1;
      animateDog(dog, phase);
    },
  };
}

/**
 * 建立角色的通靈獸坐騎。
 * @param id 角色編號
 */
export function buildMount(id: CharacterId): MountRig {
  switch (id) {
    case 'sasuke':
      return buildSnakeMount();
    case 'sakura':
      return buildSlugMount();
    case 'kakashi':
      return dogMount();
    default:
      return toadMount();
  }
}
