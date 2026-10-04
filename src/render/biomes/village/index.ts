import type * as THREE from 'three';
import type { Atmosphere, BiomeKit } from '../types';
import { buildVillageBackdrop, preloadBackdrop } from './backdrop';
import { buildVillageChunk, prepareTrack } from './chunk';
import { buildVillageGate } from './gate';
import { buildVillageLib, type VillageLib } from './lib';
import { swayTime, villageMats } from './mats';
import { buildVillageObstacle } from './obstacles';

/**
 * 木葉村場景模組（致敬地鐵跑酷的精細度＋火影忍者風格的原創木葉村）。
 * 檔案分工：
 * - atlas.ts／textures.ts：程式產生的貼圖（調色盤圖集、牆／木／瓦圖集、道碴、石板路、列車木板、塗鴉）
 * - mats.ts：材質（含燈籠搖擺的頂點動畫）
 * - builder.ts：把零件直接寫成「每材質一組」的頂點陣列（低 draw call 的關鍵）
 * - track.ts：三條軌道與地面（靜態共用）；lib.ts：預製件庫（房子、道具、樹）；chunk.ts：依 seed 挑選擺放預製件組出一段街景
 * - buildings.ts／props.ts：町家、空地、街道道具；train.ts／obstacles.ts：障礙；gate.ts：村子大門
 * - backdrop.ts：刻臉岩壁遠景畫（backdrop.webp）
 */

/** 晴朗中午的木葉村：藍天、暖黃陽光、淡霧（天空與霧色配合遠景畫的顏色） */
const ATMOSPHERE: Atmosphere = {
  skyTop: 0x48adf3,
  skyHorizon: 0xa9d9ef,
  fog: 0x9fcbe0,
  fogNear: 70,
  fogFar: 240,
  sunColor: 0xffe3b3,
  sunIntensity: 2.7,
  sunDir: [0.5, 0.82, 0.3],
  hemiSky: 0xd0e8ff,
  hemiGround: 0xa68b62,
  hemiIntensity: 0.95,
  envIntensity: 0.5,
  exposure: 1.02,
};

/**
 * 預熱：先建一段丟掉的場景。讓 JIT 編譯好建構器的熱路徑、模板幾何攤平快取與頂點緩衝池長到需要的容量，
 * 遊戲中（與預覽頁量測時）第一段場景就不會因為冷啟動多花好幾倍的時間。
 */
function warmUp(lib: VillageLib, m: ReturnType<typeof villageMats>): void {
  const tmp = buildVillageChunk(lib, m, 0x5eed);
  tmp.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // 軌道網格是共用幾何，不能釋放；其餘是這一段自己的幾何
    if (mesh.isMesh && mesh.name !== 'track') mesh.geometry.dispose();
  });
}

/** 建立木葉村場景模組（貼圖、材質、靜態軌道在這裡一次建好，之後建場景不再產生貼圖） */
export function createKit(): BiomeKit {
  const m = villageMats();
  prepareTrack(m);
  preloadBackdrop();
  const lib = buildVillageLib(m);
  warmUp(lib, m);
  return {
    id: 'village',
    name: '木葉村',
    atmosphere: ATMOSPHERE,
    buildChunk: (seed) => buildVillageChunk(lib, m, seed),
    buildObstacle: (o) => buildVillageObstacle(m, o),
    buildBackdrop: () => buildVillageBackdrop(),
    buildGate: () => buildVillageGate(m),
    /** 每幀動畫：只更新共用的時間 uniform */
    update(time: number) {
      // 燈籠、幟旗、晾的衣服在頂點著色器裡依時間擺動
      swayTime.value = time;
    },
  };
}
