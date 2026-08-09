// ブロックの見た目（デザイン）。
//
// 2 つだけある。
//
//   プレーン ―― 色だけの平らな面。既定。
//   クリスタル ―― 実機で撮ったガラスの写真を、そのまま貼ったもの。
//
// 昔はここに手続きで描いた素材（石・木・金属・紙・布・描いたガラス）が並んでいた。
// ノイズから「高さの場」を作り、その傾きから陰影を計算する（バンプマッピング）
// やり方で、拡大すれば見事に見える。だが**1 マスが 40px そこそこになると、
// 模様がブロックの輪郭と同じ細かさになり、形が模様に埋もれて読めなくなる**。
// 盤面を読むゲームでそれは致命的で、結局どれも「薄く敷く」ところへ落ち着いた ――
// 薄く敷いた石と薄く敷いた紙は、遊んでいるあいだ見分けが付かない。
//
// 残したのは、**役割がはっきり違う 2 つ**だけ。いちばん読みやすい平らな面と、
// 描いて真似るのをやめて本物を貼ったガラス。
//
// ここが持つのは「表面」だけ。立体の組み立ては render.js の経路が受け持ち、
// デザインはその経路に寸法と色を**マスの一辺に対する比**で渡す。

import {
  hexRgb, rgbHex, rgbHsl, hslRgb, shade, tintTowards,
} from './color.js';

// ---------------------------------------------------------------- デザインの定義

/**
 * デザインひとつ。寸法はすべて**セルの一辺に対する比**で持つ ――
 * 盤面が 4×4 でも 8×8 でも、ブロックの厚みと角の落としが同じ割合で見えるように。
 */
const DEFS = [
  {
    key: 'plain',
    name: 'プレーン',
    note: '色だけの平らな面',
    /*
     * 何も乗せない、元からの見た目。
     *
     * **いちばん読みやすいのはこれ**なので、既定にしてある。厚みも面取りも影も
     * 持たず、一色のベタ塗りに髪の毛ほどのすき間だけ。
     * 目が拾うものが「色と形」しか無いので、どのブロックがどこまでかが一瞬で分かる。
     *
     * flat が立っているデザインは、影も写真も通らない ―― 薄くするのではなく、
     * そもそも通らない。
     */
    flat: true,
    depth: 0,
    radius: 0.14,
    gap: 0.032,
    tint: 1,
    shadow: 0,
    /** 進行度の色を混ぜず、そのまま使う（元の見た目がそうだった） */
    rawTint: true,
    /** 盤面も進行度の色を、ほとんど白まで薄めて追いかける */
    trayTint: true,
    colors: {
      grey: { top: '#c4c4cb', mid: '#9a9aa2', deep: '#5f5f68', side: '#6e6e78' },
      lit: { top: '#7f97e6', mid: '#3e47cc', deep: '#2a2f8c', side: '#333a9f' },
    },
    tray: { frame: '#dde2f0', floor: '#dde2f0', well: '#eef1f8' },
  },
  {
    key: 'crystal',
    name: 'クリスタル',
    note: '写真から切り出した本物のガラス',
    /*
     * **ここだけは、模様を描いていない。**
     *
     * ガラスは「表面の凹凸」ではなく、**中を通ってきた光**でできている ――
     * 面取りの向こう側が透けて重なり、角では全反射して白く跳ね返る。
     * 高さの場から陰影を計算するやり方は表面しか作れないので、どれだけ手を
     * 入れても「ガラスに似せた石」より先へ行けなかった。
     *
     * そこで、実機で撮ったブロックの写真をそのまま貼っている
     * （art/crystal/*.png、切り出しは tools/photoArt.mjs）。
     * 写真は 1 マス 160px の無色（グレースケール）で、貼るときに
     * 9 分割で任意の大きさへ伸ばす ―― 角と縁は伸ばさず中央だけを伸ばすので、
     * 何マスのブロックでも面取りの太さが変わらない。だから全部のレベルに効く。
     *
     * 色は貼ってから被せる（進行度の色相を 'color' で重ねる）。
     * こうすると陰影は写真のまま、色だけが手数に合わせて動く。
     */
    photo: true,
    /** 灰色ブロックに被せる色。写真のガラスがわずかに帯びている青みそのもの */
    photoTint: '#797986',
    depth: 0.025,      // 側面はほとんど見えない。落ち影のぶんだけ持たせる
    radius: 0,
    chamfer: 0.156,    // 写真の角の落としと同じ角度・同じ深さで切り抜く
    gap: 0.09,
    tint: 0.86,        // 色の濃さ。1 まで上げるとガラスではなく塗った板に見える
    shadow: 0.3,
    colors: {
      // 写真から拾った代表色。演出（破片・光の輪）と落ち影に使う
      grey: { top: '#e2e4ea', mid: '#b3b6be', deep: '#70747c', side: '#8c9099' },
      lit: { top: '#d8f2ff', mid: '#6ec8ee', deep: '#175f85', side: '#3d95c4' },
    },
    /*
     * 受け皿は、枠を立てずに平らに敷く。
     * 写真は「白い台の上に置かれたガラス」で、暗い箱に嵌まっているのではない ――
     * 枠と落ち影を付けると、ガラスが箱の底に沈んで透明感がまるごと消える。
     */
    tray: { frame: '#eef0f7', floor: '#edeff6', well: '#dde1ec' },
  },
];

/** デザインの並び（設定画面もこの順で出す） */
export const MATERIAL_KEYS = DEFS.map((d) => d.key);

/**
 * 何も選んでいないときのデザイン。
 * 迷ったら**いちばん読みやすいもの**を出す ―― 見た目は好みで選ぶ飾りで、
 * 遊べることのほうが先にある。
 */
export const DEFAULT_MATERIAL = 'plain';

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/**
 * デザインを引く。知らない名前なら既定のデザイン。
 * 廃止したデザイン（石・木・金属・紙・布・ガラス）を選んだまま残っている
 * 端末も、ここで黙ってプレーンへ落ちる ―― 設定が古いだけで遊べなくはならない。
 */
export function materialFor(key) {
  return BY_KEY.get(key) || BY_KEY.get(DEFAULT_MATERIAL);
}

/** 設定画面に並べるための一覧 */
export function materialList() {
  return DEFS.map((d) => ({ key: d.key, name: d.name, note: d.note, swatch: d.colors.lit.mid }));
}

// ---------------------------------------------------------------- 色

/**
 * ブロックの色を決める。
 *
 * 灰色ブロックはデザインそのままの色。色つきブロックは、明るいほうの地を
 * 進行度の色相へ引っぱる。
 */
export function paletteFor(mat, isColored, tintHex) {
  const src = isColored ? mat.colors.lit : mat.colors.grey;
  if (!isColored || !tintHex) return { ...src, key: `${mat.key}|grey` };
  /*
   * プレーンだけは混ぜない。混ぜると明るさがデザインの側に引き戻されて、
   * 琥珀まで進んでも青のままの明るさになってしまう ―― 何も乗っていない面では、
   * 進行度の色そのものが見えるのが正しい。
   */
  if (mat.rawTint) {
    return {
      top: shade(tintHex, 0.24),
      mid: tintHex,
      deep: shade(tintHex, -0.3),
      side: shade(tintHex, -0.24),
      key: `${mat.key}|${tintHex}`,
    };
  }
  const k = mat.tint;
  return {
    top: tintTowards(src.top, tintHex, k * 0.9),
    mid: tintTowards(src.mid, tintHex, k),
    deep: tintTowards(src.deep, tintHex, k),
    side: tintTowards(src.side, tintHex, k),
    key: `${mat.key}|${tintHex}`,
  };
}

/**
 * 盤面（トレイ）の色。
 *
 * クリスタルでは**進行度で動かさない。** 写真のガラスは白い台の上に置かれて
 * いるのが正しい見え方で、台まで色づくとガラスが染まって見える。
 */
export function trayPaletteFor(mat, tintHex) {
  /*
   * 例外はプレーンだけ。焼くものが「角丸の塗り 2 枚」しか無いので、
   * 色が 1 段動くたびに描き直しても目に見えるほどの間は空かない ――
   * そのぶん、盤面まで含めて温度が変わる元の見え方が戻ってくる。
   */
  if (mat.trayTint && tintHex) {
    const [h] = rgbHsl(hexRgb(tintHex));
    const plate = rgbHex(hslRgb(h, 30, 89));
    return { frame: plate, floor: plate, well: rgbHex(hslRgb(h, 34, 95)), key: `${mat.key}|tray|${tintHex}` };
  }
  return { ...mat.tray, key: `${mat.key}|tray` };
}
