import type { HumanoidRig } from './rig';
import type { CharacterId } from '../../sim/characters';
import { buildNinja } from './ninja';
import { buildSasuke } from './sasuke';
import { buildSakura } from './sakura';
import { buildKakashi } from './kakashi';

/**
 * 依角色編號建立模型（主角、影分身、標題畫面背景的展示跑、姿勢檢視都用這個）。
 * 每個角色共用同一套骨架（rig.ts）與動畫器（anim.ts）。
 * @param outline 描邊粗細（0 = 不描邊）
 */
export function buildCharacter(id: CharacterId, outline = 0.007): HumanoidRig {
  switch (id) {
    case 'sasuke':
      return buildSasuke(outline);
    case 'sakura':
      return buildSakura(outline);
    case 'kakashi':
      return buildKakashi(outline);
    default:
      return buildNinja(outline);
  }
}
