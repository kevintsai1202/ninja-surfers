import { Builder, type Prefab, Rng } from './builder';
import { sw } from './atlas';
import { backHouse, gardenLot, randomHouseStyle, shopHouse, shrineLot, wellLot } from './buildings';
import type { VillageMats } from './mats';
import {
  barrel,
  benchUmbrella,
  bonsai,
  bunting,
  crate,
  farTree,
  fireBuckets,
  lanternString,
  mailbox,
  nobori,
  pine,
  planter,
  pole,
  POLE_X,
  POLE_ZS,
  sakura,
  standSign,
  streetLamp,
  wire,
  WIRE_PTS,
} from './props';
import { CHUNK_LEN } from '../../../config';
import { STREET_Y } from './track';

/**
 * 木葉村的預製件庫（createKit 時建一次）：前排町家（5 種寬度 × 5 種外觀）、空地（神社、櫻花庭院、水井）、
 * 後排建築、街道道具、電線桿、電線、燈籠串、三角旗、各種樹。
 * 建一段場景時只做「挑預製件、決定位置、整段複製（stamp）」，不再從零件重新產生幾何，
 * 所以一段場景只要幾毫秒；變化來自預製件的組合、位置與每段不同的道具擺放。
 */

/** 前排地塊的寬度級距（房子與空地都從這幾種寬度挑） */
export const HOUSE_WIDTHS = [4.6, 5.4, 6.2, 7.0, 7.8];
/** 後排建築的寬度級距 */
export const BACK_WIDTHS = [6.0, 7.5, 9.0];
/** 每種寬度的町家外觀數 */
const HOUSE_STYLES = 5;

/** 街道道具種類 */
export type PropKind = 'bonsai' | 'crate' | 'crates' | 'barrel' | 'buckets' | 'mailbox' | 'planter' | 'nobori' | 'sign' | 'bench';

/** 預製件庫 */
export interface VillageLib {
  /** 前排町家：[寬度級距][外觀] */
  houses: Prefab[][];
  /** 小神社、櫻花庭院、水井：[寬度級距][變化]（太窄的級距是空陣列） */
  shrine: Prefab[][];
  garden: Prefab[][];
  well: Prefab[][];
  /** 後排建築：[寬度級距][外觀] */
  backs: Prefab[][];
  /** 街道道具（原點在道具底部中心） */
  props: Record<PropKind, Prefab[]>;
  /** 電線桿（[0] 無變壓器、[1] 有變壓器），放在 z = 0，stamp 時平移到桿位 */
  poles: Prefab[];
  /** 路燈（z = 0） */
  lamp: Prefab;
  /** 沿軌道的電線（已在正確的 z，跨到下一段的桿子） */
  sideWires: Prefab;
  /** 跨越軌道的電纜（世界座標，z = 0） */
  crossCable: Prefab;
  /** 跨越軌道的燈籠串、三角旗（世界座標，z = 0） */
  lanterns: Prefab[];
  bunting: Prefab[];
  /** 樹：櫻花、松、遠處便宜版（原點在樹根） */
  sakura: Prefab[];
  pine: Prefab[];
  far: Prefab[];
  /** 全部預製件的三角形數（統計用） */
  tris: number;
}

/** 建立預製件庫 */
export function buildVillageLib(m: VillageMats): VillageLib {
  const rnd = new Rng(20261003);
  let tris = 0;
  /** 用一個建構器做出一個預製件 */
  const make = (fn: (b: Builder) => void): Prefab => {
    const b = new Builder();
    fn(b);
    const p = b.toPrefab();
    tris += p.tris;
    return p;
  };
  /** 0..n−1 的整數陣列 */
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const houses = HOUSE_WIDTHS.map((w) => range(HOUSE_STYLES).map(() => make((b) => shopHouse(b, m, rnd, 0, -w, randomHouseStyle(rnd, w)))));
  const shrine = HOUSE_WIDTHS.map((w) => (w >= 6.2 ? [make((b) => shrineLot(b, m, rnd, 0, -w))] : []));
  const garden = HOUSE_WIDTHS.map((w) => (w >= 5.4 ? range(2).map(() => make((b) => gardenLot(b, m, rnd, 0, -w))) : []));
  const well = HOUSE_WIDTHS.map((w) => (w >= 5.4 && w <= 7.0 ? [make((b) => wellLot(b, m, rnd, 0, -w))] : []));
  const backs = BACK_WIDTHS.map((w) => range(3).map(() => make((b) => backHouse(b, m, rnd, 0, -w, rnd.range(17.2, 18.4)))));

  const y0 = STREET_Y;
  const props: Record<PropKind, Prefab[]> = {
    bonsai: [0.85, 1.0, 1.1].map((s) => make((b) => bonsai(b, m, 0, y0, 0, s, rnd))),
    crate: [0.62, 0.72, 0.8].map((s) => make((b) => crate(b, m, 0, y0, 0, s, rnd.range(-0.3, 0.3), rnd))),
    crates: range(2).map(() =>
      make((b) => {
        crate(b, m, 0, y0, 0, 0.75, rnd.range(-0.2, 0.2), rnd);
        crate(b, m, 0.05, y0 + 0.75, rnd.range(-0.1, 0.1), 0.52, rnd.range(-0.4, 0.4), rnd);
        if (rnd.chance(0.6)) crate(b, m, 0, y0, -0.85, 0.6, rnd.range(-0.3, 0.3), rnd);
      }),
    ),
    barrel: [0.29, 0.33].map((r) => make((b) => barrel(b, m, 0, y0, 0, r, r * 2.6))),
    buckets: [make((b) => fireBuckets(b, m, 0, 0))],
    mailbox: [make((b) => mailbox(b, m, 0, 0))],
    planter: [1.0, 1.5].map((len) => make((b) => planter(b, m, 0, 0, len, rnd))),
    nobori: range(4).map(() => make((b) => nobori(b, m, 0, 0, rnd))),
    sign: range(3).map(() => make((b) => standSign(b, m, 0, 0, rnd))),
    bench: [make((b) => benchUmbrella(b, m, 0, 0, rnd))],
  };

  const poles = [false, true].map((t) => make((b) => pole(b, m, POLE_X, 0, rnd, t)));
  const lamp = make((b) => streetLamp(b, m, POLE_X + 0.05, 0));
  const sideWires = make((b) => {
    const spans: [number, number][] = [
      [POLE_ZS[0], POLE_ZS[1]],
      [POLE_ZS[1], POLE_ZS[0] - CHUNK_LEN],
    ];
    for (const [za, zb] of spans) {
      for (const [dx, y] of WIRE_PTS) {
        const thick = dx === 0.3;
        wire(b, m.palette, [POLE_X + dx, y, za], [POLE_X + dx, y, zb], thick ? 0.75 : 0.55, thick ? 0.06 : 0.04, sw('black'), 7);
      }
    }
  });
  const inner = POLE_X + WIRE_PTS[0][0];
  const crossCable = make((b) => wire(b, m.palette, [-inner, WIRE_PTS[0][1], 0], [inner, WIRE_PTS[0][1], 0], 1.1, 0.05, sw('black'), 10));
  const lanterns = range(2).map(() =>
    make((b) => lanternString(b, m, [-(POLE_X - 0.15), y0 + 7.9, 0], [POLE_X - 0.15, y0 + 7.9, 0], 0.9, 7, rnd)),
  );
  const buntingP = range(2).map(() => make((b) => bunting(b, m, [-(POLE_X - 0.15), y0 + 7.3, 0], [POLE_X - 0.15, y0 + 7.3, 0], 0.8, rnd)));

  const sakuraP = [1.15, 1.3, 1.45].map((s) => make((b) => sakura(b, m, 0, y0, 0, s, rnd)));
  const pineP = [1.05, 1.2, 1.35].map((s) => make((b) => pine(b, m, 0, y0, 0, s, rnd)));
  const far = [1.0, 1.2, 1.4, 1.1, 1.3, 1.5].map((s) => make((b) => farTree(b, m, 0, 0, 0, s, rnd)));

  return {
    houses,
    shrine,
    garden,
    well,
    backs,
    props,
    poles,
    lamp,
    sideWires,
    crossCable,
    lanterns,
    bunting: buntingP,
    sakura: sakuraP,
    pine: pineP,
    far,
    tris,
  };
}
