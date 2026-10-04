import * as THREE from 'three';
import { CURVE } from '../config';

/**
 * 地平線下彎（地鐵跑酷招牌的 curved world）：改寫 three 內建的 shader chunk，
 * 讓所有內建材質的頂點依「世界座標 z」往下彎。玩家固定在世界 z = 0（世界往玩家移動），
 * 所以彎曲原點是常數，不需要額外的 uniform。
 *
 * 同時改 project_vertex（畫面位置）與 worldpos_vertex（陰影、環境貼圖用的世界位置），
 * 兩邊用同一個彎曲公式，陰影才對得上。
 * 不想被彎曲的材質（遠景、天空）設定 material.defines = { NO_CURVE: '' }。
 *
 * 必須在任何材質編譯（第一次 render）之前呼叫，main.ts 一開始就呼叫。
 */

/** 彎曲公式（GLSL）：輸入世界座標 vec4，往前（−z）超過 start 之後往下彎 */
const BEND_GLSL = /* glsl */ `
#ifndef NO_CURVE
	{
		float cwDist = max( 0.0, - cwWorld.z - ${CURVE.start.toFixed(3)} );
		cwWorld.y -= cwDist * cwDist * ${CURVE.amount.toFixed(6)};
	}
#endif
`;

/** 改寫後的 project_vertex：保留 batching／instancing，改成先算世界座標、彎曲、再乘 viewMatrix */
const PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif

{
	vec4 cwWorld = modelMatrix * mvPosition;
	${BEND_GLSL}
	mvPosition = viewMatrix * cwWorld;
}

gl_Position = projectionMatrix * mvPosition;
`;

/** 改寫後的 worldpos_vertex：世界位置也套同一個彎曲 */
const WORLDPOS_VERTEX = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0

	vec4 worldPosition = vec4( transformed, 1.0 );

	#ifdef USE_BATCHING

		worldPosition = batchingMatrix * worldPosition;

	#endif

	#ifdef USE_INSTANCING

		worldPosition = instanceMatrix * worldPosition;

	#endif

	worldPosition = modelMatrix * worldPosition;

	{
		vec4 cwWorld = worldPosition;
		${BEND_GLSL}
		worldPosition = cwWorld;
	}

#endif
`;

/** 是否已經套用過（避免重複改寫） */
let installed = false;

/** 套用地平線下彎（全域、只需呼叫一次） */
export function installCurvedWorld(): void {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.project_vertex = PROJECT_VERTEX;
  chunks.worldpos_vertex = WORLDPOS_VERTEX;
}

/** 讓材質不受地平線下彎影響（遠景、天空） */
export function noCurve<T extends THREE.Material>(mat: T): T {
  mat.defines = { ...(mat.defines ?? {}), NO_CURVE: '' };
  mat.needsUpdate = true;
  return mat;
}
