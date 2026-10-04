import * as THREE from 'three';
import { noCurve } from '../../curvedWorld';
import backdropUrl from './backdrop.webp';
import { timeUniform } from './mats';
import { cascadeTexture, mistTexture } from './textures';

/**
 * 終末之谷遠景：兩座對望的巨大石像＋中央大瀑布（美術提供的 backdrop.webp，上緣與左右已做透明漸層），
 * 貼在玩家正前方的大弧面上。跟著玩家（掛在 scene），不受地平線下彎影響（NO_CURVE），不吃霧（在 fogFar 外）。
 *
 * 尺寸由地平線下彎決定：
 * - 遊戲鏡頭（高 3.5 m）看到的水面盡頭約在水平線下 5～6°，高空鏡頭（11 m）約 10°（半徑 330 處約 y −50），
 *   畫面下緣必須低於這些角度（被近處下彎的水面擋住）。
 * - 石像頭頂要在遊戲鏡頭上緣（仰角約 +19°）以內。
 * - 兩岸岩壁只在畫面中央留一個 V 形開口，石像（圖片寬度 25%／77% 處）要落在開口裡，
 *   所以整張圖的弧角約 48°，高度依圖片比例（2016:1152）換算。
 */

/** 弧面半徑（圓心在玩家原點） */
const RADIUS = 330;
/** 圖片下緣高度 */
const Y_BOTTOM = -58;
/** 圖片上緣高度 */
const Y_TOP = 100;
/** 圖片寬高比 */
const ASPECT = 2016 / 1152;
/** 圖片下緣漸變的霧中水色（取自圖片底部河面一帶） */
const MIST = 0xd6b48c;

/** 圖片下緣再往下延伸多少（漸變成霧中水色）：入口鏡頭這種站在下彎處的視角，水面會往下掉得更低 */
const Y_EXTEND = 140;

/**
 * 畫中瀑布的位置（圖片座標：u 由左到右、v 由上到下，0..1），疊一層往下流的半透明水紋讓瀑布會動。
 * [u0, u1, v0, v1]
 */
const FALLS: [number, number, number, number][] = [
  [0.352, 0.408, 0.2, 0.62],
  [0.442, 0.558, 0.24, 0.69],
  [0.582, 0.632, 0.2, 0.6],
];
/** 瀑布底部水霧（圖片座標） */
const FALL_MIST: [number, number, number, number] = [0.33, 0.67, 0.56, 0.8];

/**
 * 遠景用的流動貼圖材質（自訂 shader，不經過內建 project_vertex，所以天生不受地平線下彎影響；不吃霧）。
 * @param tex 可重複的貼圖（細瀑布水紋或霧）
 * @param repeat 貼圖重複次數
 * @param speed 每秒捲動量（uv 單位；y 正值 = 往下流）
 * @param tint 顏色（乘在貼圖上，配合畫裡的金色逆光）
 */
function flowMaterial(tex: THREE.Texture, opacity: number, repeat: [number, number], speed: [number, number], tint: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uTex: { value: tex },
      uOpacity: { value: opacity },
      uRep: { value: new THREE.Vector2(repeat[0], repeat[1]) },
      uSpeed: { value: new THREE.Vector2(speed[0], speed[1]) },
      uTint: { value: new THREE.Color(tint) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uTime;
      uniform float uOpacity;
      uniform vec2 uRep;
      uniform vec2 uSpeed;
      uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D( uTex, vUv * uRep + uSpeed * uTime );
        float edge = smoothstep( 0.0, 0.3, vUv.x ) * smoothstep( 1.0, 0.7, vUv.x ) * smoothstep( 0.0, 0.25, vUv.y ) * smoothstep( 1.0, 0.85, vUv.y );
        gl_FragColor = vec4( t.rgb * uTint, t.a * edge * uOpacity );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * 弧面幾何：以原點為圓心、正前方（−z）為中央，左右對稱展開；
 * u 由左到右、v 由下到上（從原點看不會左右顛倒），三角形正面朝向原點。
 * @param rows 由下到上的 [高度, v] 列（最底下一段 v 固定 → 拉長圖片最底一列）
 */
function arcGeometry(radius: number, theta: number, rows: [number, number][], segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const nr = rows.length;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -theta / 2 + t * theta;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    for (const [y, v] of rows) {
      pos.push(x, y, z);
      uv.push(t, v);
      // 法線朝向圓心
      nrm.push(-Math.sin(a), 0, Math.cos(a));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    for (let r = 0; r < nr - 1; r++) {
      const b0 = i * nr + r;
      const t0 = b0 + 1;
      const b1 = b0 + nr;
      const t1 = b1 + 1;
      idx.push(b0, b1, t0, t0, b1, t1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * 建立遠景。貼圖載入完成前網格先隱藏（避免未載入時畫出一片黑）。
 */
export function buildValleyBackdrop(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'valley-backdrop';
  const height = Y_TOP - Y_BOTTOM;
  const theta = (height * ASPECT) / RADIUS;
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false });
  // 圖片下緣往下漸變成霧中水色（延伸段不再是拉長的直條紋）；左右仍沿用圖片的透明淡出
  const uniforms = {
    uBdBottom: { value: Y_BOTTOM },
    uBdMist: { value: new THREE.Color(MIST) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBdY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBdY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBdBottom;\nuniform vec3 uBdMist;\nvarying float vBdY;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
float bdMist = smoothstep( uBdBottom + 16.0, uBdBottom - 4.0, vBdY );
float bdSide = smoothstep( 0.0, 0.07, vMapUv.x ) * smoothstep( 1.0, 0.93, vMapUv.x );
diffuseColor.rgb = mix( diffuseColor.rgb, uBdMist, bdMist );
diffuseColor.a = mix( diffuseColor.a, bdSide, bdMist );`,
      );
  };
  mat.customProgramCacheKey = () => 'valley-backdrop-1';
  noCurve(mat);
  const rows: [number, number][] = [
    [Y_BOTTOM - Y_EXTEND, 0.004],
    [Y_BOTTOM, 0.004],
    [Y_TOP, 1],
  ];
  const mesh = new THREE.Mesh(arcGeometry(RADIUS, theta, rows, 48), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.visible = false;
  /** 貼圖載入後才一起顯示的網格（遠景圖本身與疊在上面的流動水紋） */
  const pending: THREE.Object3D[] = [mesh];
  const tex = new THREE.TextureLoader().load(backdropUrl, () => {
    for (const o of pending) o.visible = true;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  mat.map = tex;
  mat.needsUpdate = true;
  group.add(mesh);

  /** 把圖片座標的矩形換成弧面前方一點的平面（面向原點） */
  const overlay = (rect: [number, number, number, number], material: THREE.Material, inset: number) => {
    const [u0, u1, v0, v1] = rect;
    const a0 = -theta / 2 + u0 * theta;
    const a1 = -theta / 2 + u1 * theta;
    const am = (a0 + a1) / 2;
    const r = RADIUS - inset;
    const w = (a1 - a0) * r;
    const yTop = Y_BOTTOM + (1 - v0) * height;
    const yBot = Y_BOTTOM + (1 - v1) * height;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, yTop - yBot), material);
    q.position.set(Math.sin(am) * r, (yTop + yBot) / 2, -Math.cos(am) * r);
    q.rotation.y = -am;
    q.frustumCulled = false;
    q.visible = mesh.visible;
    pending.push(q);
    group.add(q);
  };
  const fallMat = flowMaterial(cascadeTexture(), 0.32, [3, 3.5], [0, 0.55], 0xfff0d8);
  for (const f of FALLS) overlay(f, fallMat, 1.5);
  overlay(FALL_MIST, flowMaterial(mistTexture(), 0.3, [1.5, 1], [0.008, 0], 0xffefd2), 2.5);
  return group;
}
