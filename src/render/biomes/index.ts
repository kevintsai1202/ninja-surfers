import type { BiomeFactory } from './types';
import type { BiomeId } from '../../sim/types';
import { createKit as village } from './village';
import { createKit as forest } from './forest';
import { createKit as valley } from './valley';

/** 各場景模組的建立函式 */
export const BIOME_FACTORIES: Record<BiomeId, BiomeFactory> = { village, forest, valley };
