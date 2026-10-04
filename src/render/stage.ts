import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from './sky';
import type { Atmosphere } from './biomes/types';

/**
 * 渲染舞台：渲染器、場景、鏡頭、光線、天空、環境光。遊戲與各種預覽模式共用。
 *
 * 世界往玩家移動：玩家固定在世界原點附近，`world` 這個 Group 的 z 由遊戲端設成「跑的距離」，
 * 所以太陽與陰影相機固定在原點附近就好，不必跟著跑。
 */

/** 遊戲中的追尾鏡頭（玩家在原點、面向 −z） */
export const GAME_CAMERA = {
  /** 鏡頭位置（相對玩家） */
  pos: new THREE.Vector3(0, 2.9, 5.0),
  /** 注視點（相對玩家） */
  look: new THREE.Vector3(0, 1.0, -7),
  /** 基本視角（cameraRig 會依速度再加寬） */
  fov: 58,
};

/** 舞台 */
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 世界：障礙、場景、兩都掛在這裡，z = 跑的距離 */
  world: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  /** 目前套用中的氣氛 */
  atmosphere: Atmosphere;
  /** 套用氣氛（天空、霧、光線、曝光） */
  applyAtmosphere(a: Atmosphere): void;
  /** 在兩個氣氛之間漸變（t = 0..1） */
  blendAtmosphere(a: Atmosphere, b: Atmosphere, t: number): void;
  /** 依視窗大小調整 */
  resize(): void;
  /** 畫一幀 */
  render(): void;
}

/** 預設氣氛（晴天） */
export const DEFAULT_ATMOSPHERE: Atmosphere = {
  skyTop: 0x3f9be6,
  skyHorizon: 0xcfeeff,
  fog: 0xcfe9f7,
  fogNear: 60,
  fogFar: 230,
  sunColor: 0xfff1d6,
  sunIntensity: 2.6,
  sunDir: [0.45, 0.85, 0.35],
  hemiSky: 0xd8ecff,
  hemiGround: 0x8a7458,
  hemiIntensity: 0.9,
  envIntensity: 0.45,
  exposure: 1.0,
};

/** 是否為觸控裝置（手機、平板），用來降低畫質 */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

/**
 * 建立舞台並掛到 container。
 * 陰影只開太陽一盞，陰影範圍涵蓋玩家前後（固定在原點附近）。
 */
export function createStage(container: HTMLElement): Stage {
  const touch = isTouchDevice();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch ? 1.5 : 2));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral tone mapping 保留色相與飽和度（ACES 會把橘色壓黃、整體變灰）
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  // r186 起 PCFSoftShadowMap 已移除，PCFShadowMap 搭配 shadow.radius 就是柔邊
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe9f7, 60, 230);

  // 環境光：程式產生的室內環境，給 PBR 材質柔和的補光與反射
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(GAME_CAMERA.fov, 1, 0.1, 900);
  camera.position.copy(GAME_CAMERA.pos);
  camera.lookAt(GAME_CAMERA.look);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x8a7458, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.castShadow = true;
  const size = touch ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  const sc = sun.shadow.camera;
  sc.left = -16;
  sc.right = 16;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 1;
  sc.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  // 陰影中心放在玩家前方一點（前方的障礙陰影比較重要）
  sun.target.position.set(0, 0, -14);
  scene.add(sun);
  scene.add(sun.target);

  const sky = new Sky();
  scene.add(sky.mesh);

  const world = new THREE.Group();
  world.name = 'world';
  scene.add(world);

  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  const sunDir = new THREE.Vector3();

  const stage: Stage = {
    renderer,
    scene,
    camera,
    world,
    sun,
    hemi,
    sky,
    atmosphere: DEFAULT_ATMOSPHERE,
    applyAtmosphere(a) {
      stage.blendAtmosphere(a, a, 0);
    },
    blendAtmosphere(a, b, t) {
      const mix = (x: number, y: number) => tmpA.set(x).lerp(tmpB.set(y), t).getHex();
      const lerp = (x: number, y: number) => x + (y - x) * t;
      const fog = scene.fog as THREE.Fog;
      fog.color.set(mix(a.fog, b.fog));
      fog.near = lerp(a.fogNear, b.fogNear);
      fog.far = lerp(a.fogFar, b.fogFar);
      sun.color.set(mix(a.sunColor, b.sunColor));
      sun.intensity = lerp(a.sunIntensity, b.sunIntensity);
      sunDir
        .set(lerp(a.sunDir[0], b.sunDir[0]), lerp(a.sunDir[1], b.sunDir[1]), lerp(a.sunDir[2], b.sunDir[2]))
        .normalize();
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 60);
      hemi.color.set(mix(a.hemiSky, b.hemiSky));
      hemi.groundColor.set(mix(a.hemiGround, b.hemiGround));
      hemi.intensity = lerp(a.hemiIntensity, b.hemiIntensity);
      scene.environmentIntensity = lerp(a.envIntensity, b.envIntensity);
      renderer.toneMappingExposure = lerp(a.exposure, b.exposure);
      sky.set(mix(a.skyTop, b.skyTop), mix(a.skyHorizon, b.skyHorizon), sunDir, sun.color);
      stage.atmosphere = t < 0.5 ? a : b;
    },
    resize() {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    render() {
      sky.follow(camera);
      renderer.render(scene, camera);
    },
  };
  stage.applyAtmosphere(DEFAULT_ATMOSPHERE);
  stage.resize();
  window.addEventListener('resize', () => stage.resize());
  return stage;
}
