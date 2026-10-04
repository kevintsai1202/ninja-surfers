import * as THREE from 'three';
import { CHUNK_LEN } from '../../../config';

/**
 * 終末之谷的自訂材質（全部是 MeshStandardMaterial＋onBeforeCompile，保留 three 內建的
 * project_vertex／worldpos_vertex，地平線下彎與陰影照常運作）。
 *
 * 合併網格（merge.ts）只保留 position／normal／uv，所以要帶到 shader 的逐頂點資料一律塞在 uv：
 * - 岩石材質：uv.x = 岩層色調（0..1，0.5 = 原色）、uv.y = 環境遮蔽（1 = 全亮、0 = 縫隙最暗）。
 * - 水效材質：floor(uv.x) = 效果種類（0 浪花、1 漣漪、2 細瀑布、3 水花、4 霧、5 尾流），fract(uv.x)／uv.y = 該效果內的座標。
 */

/** 所有動畫材質共用的時間 uniform（update 只要改這一個值） */
export const timeUniform = { value: 0 };

/** 岩石材質參數 */
interface RockMatOptions {
  /** 三軸投影用的顏色貼圖（sRGB，側面：有水平層理） */
  albedo: THREE.Texture;
  /** 朝上表面用的顏色貼圖（沒有層理條紋） */
  top: THREE.Texture;
  /** 三軸投影用的高度貼圖（灰階） */
  bump: THREE.Texture;
  /** 一張貼圖涵蓋幾公尺（場景段落用的必須能整除 CHUNK_LEN，接縫才對得上） */
  texScale: number;
  /** 底色（乘在貼圖上） */
  tint: number;
  /** 朝上表面的苔蘚量 0..1 */
  moss: number;
  /** 苔蘚顏色 */
  mossColor: number;
  /** 水線上方多高以內是濕的（變暗、變亮滑） */
  wetHeight: number;
  /** 凹凸強度 */
  bumpScale: number;
  roughness: number;
}

/** 岩石 shader：宣告區（uniform、varying、週期雜訊、凹凸擾動） */
const ROCK_PARS = /* glsl */ `
uniform sampler2D uRockMap;
uniform sampler2D uRockTop;
uniform sampler2D uRockBump;
uniform float uTexScale;
uniform float uMoss;
uniform vec3 uMossColor;
uniform float uWetH;
uniform float uBumpScale;
varying vec3 vRkPos;
varying vec3 vRkNrm;
varying vec2 vRkData;

// 格點雜湊（0..1）
float rkHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

// 3D value noise；z 方向的格點以 period 為週期繞回（period = CHUNK_LEN × 頻率，段落接縫才連續）
float rkNoise( vec3 p, float period ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float z0 = mod( i.z, period );
  float z1 = mod( i.z + 1.0, period );
  float a = rkHash( vec3( i.x, i.y, z0 ) );
  float b = rkHash( vec3( i.x + 1.0, i.y, z0 ) );
  float c = rkHash( vec3( i.x, i.y + 1.0, z0 ) );
  float d = rkHash( vec3( i.x + 1.0, i.y + 1.0, z0 ) );
  float e = rkHash( vec3( i.x, i.y, z1 ) );
  float g = rkHash( vec3( i.x + 1.0, i.y, z1 ) );
  float h = rkHash( vec3( i.x, i.y + 1.0, z1 ) );
  float k = rkHash( vec3( i.x + 1.0, i.y + 1.0, z1 ) );
  return mix( mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y ), mix( mix( e, g, f.x ), mix( h, k, f.x ), f.y ), f.z );
}

// 用螢幕空間高度導數擾動法線（同 three 的 perturbNormalArb）
vec3 rkPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
  vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN );
  vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDir;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
float rkWet;
float rkMossAmt;
`;

/** 岩石 shader：顏色（三軸投影、大尺度色差、遮蔽、苔蘚、濕帶），取代 map_fragment */
const ROCK_MAP = /* glsl */ `
vec3 rkN = normalize( vRkNrm );
vec3 rkW = pow( abs( rkN ), vec3( 4.0 ) );
rkW /= ( rkW.x + rkW.y + rkW.z + 1e-5 );
vec3 rkP = vRkPos / uTexScale;
vec2 rkUvX = rkP.zy;
vec2 rkUvY = rkP.zx + vec2( 0.37, 0.61 );
vec2 rkUvZ = rkP.xy;
vec3 rkTopC = texture2D( uRockTop, rkUvY ).rgb;
vec3 rkAlb = texture2D( uRockMap, rkUvX ).rgb * rkW.x + rkTopC * rkW.y + texture2D( uRockMap, rkUvZ ).rgb * rkW.z;
diffuseColor.rgb *= rkAlb;
// 大尺度色差（10 m 一格，z 週期 = 段長）
float rkBig = rkNoise( vRkPos * 0.1, ${(CHUNK_LEN * 0.1).toFixed(1)} );
diffuseColor.rgb *= mix( vec3( 0.84, 0.87, 0.95 ), vec3( 1.12, 1.03, 0.9 ), rkBig );
// 逐頂點資料：岩層色調與縫隙遮蔽
diffuseColor.rgb *= mix( vec3( 0.88, 0.93, 1.03 ), vec3( 1.1, 1.0, 0.88 ), vRkData.x );
diffuseColor.rgb *= mix( 0.38, 1.0, vRkData.y );
// 朝上的表面長一塊塊苔蘚（雜訊決定斑塊，縫隙裡多一點）
float rkMn = rkNoise( vRkPos * 0.6, ${(CHUNK_LEN * 0.6).toFixed(1)} );
float rkMn2 = rkNoise( vRkPos * 2.0 + 7.0, ${(CHUNK_LEN * 2.0).toFixed(1)} );
float rkUp = smoothstep( 0.42, 0.85, rkN.y );
float rkPatch = smoothstep( 0.4, 0.62, rkMn * 0.75 + rkMn2 * 0.35 - 0.06 + ( 1.0 - vRkData.y ) * 0.3 );
rkMossAmt = rkUp * rkPatch * uMoss;
vec3 rkMossC = uMossColor * ( 0.72 + 0.55 * rkMn2 );
diffuseColor.rgb = mix( diffuseColor.rgb, rkMossC, rkMossAmt );
// 水線附近的濕帶（較暗）
rkWet = 1.0 - smoothstep( 0.0, uWetH, vRkPos.y );
diffuseColor.rgb *= 1.0 - 0.4 * rkWet;
`;

/** 岩石 shader：三軸投影的凹凸，取代 normal_fragment_maps */
const ROCK_NORMAL = /* glsl */ `
float rkH = ( texture2D( uRockBump, rkUvX ).r * rkW.x + dot( rkTopC, vec3( 0.75 ) ) * rkW.y + texture2D( uRockBump, rkUvZ ).r * rkW.z ) * uBumpScale;
normal = rkPerturb( - vViewPosition, normal, vec2( dFdx( rkH ), dFdy( rkH ) ), faceDirection );
`;

/** 頂點端：把物件空間位置、法線、uv 傳給片段（InstancedMesh 也適用） */
const ROCK_VERT = /* glsl */ `
#include <begin_vertex>
vec4 rkPv = vec4( transformed, 1.0 );
vec3 rkNv = objectNormal;
#ifdef USE_INSTANCING
  rkPv = instanceMatrix * rkPv;
  rkNv = mat3( instanceMatrix ) * rkNv;
#endif
vRkPos = rkPv.xyz;
vRkNrm = rkNv;
vRkData = uv;
`;

/**
 * 岩石材質：三軸投影貼圖（不受 UV 拉伸影響、段落接縫連續）＋苔蘚、濕帶、縫隙遮蔽。
 * 岩壁、岸邊大石、踏腳石、倒塌石柱都用它（不同參數各一份）。
 */
export function rockMaterial(o: RockMatOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: o.tint, roughness: o.roughness, metalness: 0 });
  const uniforms = {
    uRockMap: { value: o.albedo },
    uRockTop: { value: o.top },
    uRockBump: { value: o.bump },
    uTexScale: { value: o.texScale },
    uMoss: { value: o.moss },
    uMossColor: { value: new THREE.Color(o.mossColor) },
    uWetH: { value: o.wetHeight },
    uBumpScale: { value: o.bumpScale },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkPos;\nvarying vec3 vRkNrm;\nvarying vec2 vRkData;')
      .replace('#include <begin_vertex>', ROCK_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCK_PARS}`)
      .replace('#include <map_fragment>', ROCK_MAP)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.3, rkWet * 0.85 );\nroughnessFactor = mix( roughnessFactor, 0.95, rkMossAmt );',
      )
      .replace('#include <normal_fragment_maps>', ROCK_NORMAL);
  };
  mat.customProgramCacheKey = () => 'valley-rock-1';
  return mat;
}

/** 水面材質參數 */
interface WaterOptions {
  normalMap: THREE.Texture;
  envMap: THREE.Texture;
  /** 深水道顏色 */
  deep: number;
  /** 淺灘顏色 */
  shallow: number;
  /** 車道邊界水流光帶的顏色 */
  lane: number;
  /** 閃光顏色（自發光） */
  glint: number;
}

/**
 * 水面材質：兩層往玩家方向（+z）流動的法線、淺灘到深水道的顏色、車道邊界的水流光帶、
 * 會閃爍的亮點；反射自己的夕陽環境圖（不是 scene.environment 的灰色房間）。
 * 幾何的 uv 必須是「公尺 / 10」（u = x/10、v = −z/10），段落長 30 m 才會無縫。
 */
export function waterMaterial(o: WaterOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0,
    normalMap: o.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    envMap: o.envMap,
    envMapIntensity: 1.0,
  });
  const uniforms = {
    uTime: timeUniform,
    uDeep: { value: new THREE.Color(o.deep) },
    uShallow: { value: new THREE.Color(o.shallow) },
    uLane: { value: new THREE.Color(o.lane) },
    uGlint: { value: new THREE.Color(o.glint) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWtPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWtPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uLane;
uniform vec3 uGlint;
varying vec3 vWtPos;
float wtLine;
`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
float wtX = abs( vWtPos.x );
// 淺灘（靠岸）比較亮、偏綠
float wtShallow = smoothstep( 4.2, 13.0, wtX );
vec3 wtCol = mix( uDeep, uShallow, wtShallow );
// 跑道內：每條車道邊界有一道往玩家流動的亮色水流（虛線狀）
float wtIn = 1.0 - smoothstep( 3.9, 4.6, wtX );
float wtLaneD = abs( fract( vWtPos.x / 2.5 + 0.5 ) - 0.5 ) * 2.5;
// 取樣座標沿 z 的係數要讓 30 m 段長是整數週期（1/15），前後段接縫才連續
float wtFlow = texture2D( normalMap, vec2( vWtPos.x * 0.013 + 0.31, - vWtPos.z / 15.0 + uTime * 0.3 ) ).g;
wtLine = smoothstep( 0.3, 0.0, abs( wtLaneD - 1.25 ) ) * wtIn * smoothstep( 0.46, 0.6, wtFlow );
wtCol = mix( wtCol, uLane, wtLine * 0.6 );
diffuseColor.rgb *= wtCol;
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
// 兩層往 +z 流動的漣漪（v 增加 = 往前，取樣座標加上時間 → 圖樣往玩家方向移動）
// 縮放倍數必須是整數（uv 一段 = 3），段落接縫才不會錯開
vec2 wtUvA = vNormalMapUv + vec2( 0.0, uTime * 0.13 );
vec2 wtUvB = vNormalMapUv * 3.0 + vec2( 0.41, uTime * 0.29 );
vec3 wtNA = texture2D( normalMap, wtUvA ).xyz * 2.0 - 1.0;
vec3 wtNB = texture2D( normalMap, wtUvB ).xyz * 2.0 - 1.0;
vec3 mapN = normalize( vec3( wtNA.xy + wtNB.xy * 0.8, wtNA.z * wtNB.z ) );
mapN.xy *= normalScale;
// 水面是水平面：切線方向固定（u 沿 +x、v 沿 −z），直接用 viewMatrix 換到視空間。
// 不用 three 以螢幕導數推出的 tbn：地平線下彎讓相鄰三角形不共面，導數推出的切線每個三角形都不同，
// 低粗糙度的反射會在水面網格的邊上看出方形接縫。
vec3 wtT = normalize( ( viewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
vec3 wtB = normalize( ( viewMatrix * vec4( 0.0, 0.0, - 1.0, 0.0 ) ).xyz );
normal = normalize( mat3( wtT, wtB, normal ) * mapN );
`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
// 閃光：兩層高頻圖樣相乘取門檻，像陽光在波紋上的碎光
vec2 wtG = vNormalMapUv * 4.0;
float wtG1 = texture2D( normalMap, wtG + vec2( uTime * 0.05, uTime * 0.33 ) ).r;
float wtG2 = texture2D( normalMap, vNormalMapUv * 5.0 + vec2( - uTime * 0.07, uTime * 0.19 ) ).g;
float wtGlint = smoothstep( 0.52, 0.62, wtG1 * wtG2 * 1.5 );
totalEmissiveRadiance += uGlint * wtGlint + uLane * wtLine * 0.12;
`,
      );
  };
  mat.customProgramCacheKey = () => 'valley-water-1';
  return mat;
}

/** 水效材質用的貼圖 */
interface FxTextures {
  foam: THREE.Texture;
  cascade: THREE.Texture;
  splash: THREE.Texture;
  mist: THREE.Texture;
}

/** 水效種類（寫在 uv.x 的整數部分） */
export const FX = { foam: 0, ripple: 1, cascade: 2, splash: 3, mist: 4, wake: 5 } as const;

/**
 * 水效材質（半透明、不寫深度）：浪花、漣漪、細瀑布、水花、霧、尾流共用一個材質，
 * 同一段場景的全部水效合併成一個網格（一次 draw call）。
 * @param mistColor 霧的顏色（會微微自發光，傍晚逆光的感覺）
 */
export function fxMaterial(t: FxTextures, mistColor: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  const uniforms = {
    uTime: timeUniform,
    uFoamTex: { value: t.foam },
    uCascadeTex: { value: t.cascade },
    uSplashTex: { value: t.splash },
    uMistTex: { value: t.mist },
    uMistColor: { value: new THREE.Color(mistColor) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFxPos;\nvarying vec2 vFxUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxPos = transformed;\nvFxUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform sampler2D uFoamTex;
uniform sampler2D uCascadeTex;
uniform sampler2D uSplashTex;
uniform sampler2D uMistTex;
uniform vec3 uMistColor;
varying vec3 vFxPos;
varying vec2 vFxUv;
vec3 fxEmit;
`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
float fxRegion = floor( vFxUv.x );
vec2 fxL = vec2( vFxUv.x - fxRegion, vFxUv.y );
vec3 fxCol = vec3( 1.0 );
float fxA = 0.0;
fxEmit = vec3( 0.0 );
if ( fxRegion < 0.5 ) {
  // 浪花：fxL.y = 0 在物體邊緣、1 在外圈；圖樣跟著水流往 +z 走
  float edge = 1.0 - fxL.y;
  vec2 fp = vFxPos.xz;
  float p1 = texture2D( uFoamTex, fp * 0.55 + vec2( 0.0, - uTime * 0.32 ) ).r;
  float p2 = texture2D( uFoamTex, fp * 1.3 + vec2( 0.37, - uTime * 0.55 ) ).r;
  float f = p1 * 0.6 + p2 * 0.4;
  // 越靠近物體越密（但仍是一團團的泡沫，不是實心白帶）；外圈碎開，最外緣淡出
  float th = 1.0 - pow( edge, 1.5 ) * 0.58;
  float body = smoothstep( th - 0.12, th + 0.08, f );
  // 物體邊緣一圈細的白線（水碰到石頭的接觸線，也跟著圖樣斷斷續續）
  float rim = smoothstep( 0.93, 0.99, edge ) * smoothstep( 0.25, 0.55, f );
  fxA = max( body * 0.88, rim ) * smoothstep( 0.0, 0.25, edge );
  fxCol = vec3( 1.0 );
  fxEmit = vec3( 0.32, 0.32, 0.3 );
} else if ( fxRegion < 1.5 ) {
  // 漣漪：從中心往外擴散的細圈
  vec2 q = fxL * 2.0 - 1.0;
  float r = length( q );
  float ph = fract( sin( dot( floor( vFxPos.xz * 0.7 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float w = fract( r * 2.3 - uTime * 0.42 + ph );
  float ring = smoothstep( 0.0, 0.08, w ) * smoothstep( 0.3, 0.1, w );
  fxA = ring * smoothstep( 1.0, 0.6, r ) * smoothstep( 0.15, 0.35, r ) * 0.6;
  fxEmit = vec3( 0.1 );
} else if ( fxRegion < 2.5 ) {
  // 細瀑布：fxL.x 橫跨、fxL.y 沿著水流往下（公尺 / 3），往下捲動
  vec4 c = texture2D( uCascadeTex, vec2( fxL.x, fxL.y * 0.5 - uTime * 1.15 ) );
  float side = smoothstep( 0.0, 0.2, fxL.x ) * smoothstep( 1.0, 0.8, fxL.x );
  fxA = c.a * side;
  fxCol = c.rgb;
  fxEmit = c.rgb * 0.22;
} else if ( fxRegion < 3.5 ) {
  // 水花：直立卡片
  vec4 s = texture2D( uSplashTex, fxL );
  float flick = 0.8 + 0.2 * sin( uTime * 9.0 + vFxPos.x * 3.1 + vFxPos.z * 1.7 );
  fxA = s.a * flick;
  fxEmit = vec3( 0.14 );
} else if ( fxRegion < 4.5 ) {
  // 霧：可重複的雲團慢慢飄，四邊在 shader 裡淡出
  float m = texture2D( uMistTex, vec2( fxL.x * 0.999 + uTime * 0.012 + vFxPos.z * 0.013, fxL.y ) ).a;
  float e = smoothstep( 0.0, 0.22, fxL.x ) * smoothstep( 1.0, 0.78, fxL.x ) * smoothstep( 0.0, 0.3, fxL.y ) * smoothstep( 1.0, 0.55, fxL.y );
  fxA = m * e * 0.7;
  fxCol = uMistColor;
  fxEmit = uMistColor * 0.45;
} else {
  // 尾流：靠物體那端（u → 1）濃、往外（u → 0）碎開淡出；橫向內緣濃、外緣淡
  vec2 fp = vFxPos.xz;
  float p1 = texture2D( uFoamTex, fp * 0.6 + vec2( 0.0, - uTime * 0.45 ) ).r;
  float p2 = texture2D( uFoamTex, fp * 1.4 + vec2( 0.21, - uTime * 0.7 ) ).r;
  float f = p1 * 0.6 + p2 * 0.4;
  float along = smoothstep( 0.0, 0.85, fxL.x );
  float across = 1.0 - fxL.y;
  float th = 1.0 - across * along * 0.8;
  fxA = smoothstep( th - 0.14, th + 0.1, f ) * smoothstep( 0.0, 0.3, across ) * along;
  fxEmit = vec3( 0.3, 0.3, 0.28 );
}
if ( fxA < 0.01 ) discard;
diffuseColor.rgb *= fxCol;
diffuseColor.a *= fxA;
`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fxEmit;');
  };
  mat.customProgramCacheKey = () => 'valley-fx-1';
  return mat;
}
