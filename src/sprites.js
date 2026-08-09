// 写真から切り出したブロックの絵。
//
// これまで素材はすべて手続き的に描いていた（画像を 1 枚も持たない、というのが
// この盤面の作りだった）。クリスタルだけはそれをやめて、**写真そのもの**を貼る。
// 面取りの 8 面も、卓面の映り込みも、角のわずかな欠けも、手で書ける形をしていない ――
// 近似を重ねるより、撮ったものをそのまま置くほうが速いし、確実に似る。
//
// ブロックの形は 8 種類しかない（src/shapes.js の長方形だけ）。だから絵も 8 枚 ――
// それに空きマスの窪みを 1 枚足して 9 枚で全部を賄える。合わせて 35KB ほど。
//
// 絵は**マスの矩形から少しだけ内へ寄せた範囲**を写している（SPRITE_INSET）。
// 目地はその外側に残るので、貼るときも同じだけ内へ寄せれば、隣り合ったブロックの
// あいだに写真とまったく同じ幅の目地が空く。マスいっぱいに貼ると目地が消えて、
// 盤が 1 枚の板に見える。

/** 絵の置き場所。index.html からの相対 */
const BASE = 'assets/crystal/';

/** 形の名前（cols x rows）と、空きマス */
export const SPRITE_KEYS = ['1x2', '2x1', '1x3', '3x1', '2x2', '2x3', '3x2', '3x3', 'empty'];

/** 配信物に含める必要があるファイル（sw.js の先読みと、配信物のテストが見る） */
export const SPRITE_FILES = SPRITE_KEYS.map((k) => `${BASE}${k}.webp`);

/**
 * 貼るとき、マスの矩形から一辺につきこの割合だけ内へ寄せる。
 *
 * 切り出しのときは 3% 内へ寄せてある（隣の色つきブロックの面取りが
 * わずかに食い込んでいて、ちょうどで切ると青い筋が混ざるため）。
 * ただし**貼るときは同じだけ寄せてはいけない。** 写真のブロックはマスの矩形から
 * ほんの少しはみ出しているので、3% 内側へ戻すとブロックが痩せ、目地だけが
 * 太くなる（実際、写真より目地の広い盤になった）。ほぼ 0 まで詰めて、
 * 切り落とした 3% を貼るときに引き伸ばして返す。
 */
export const SPRITE_INSET = 0.006;

const images = new Map();
let started = false;
let ready = false;

/** 読み込み済みの絵。まだなら null（呼び手は手続き的な描き方へ落ちる） */
export function spriteFor(key) {
  return images.get(key) || null;
}

/** 9 枚とも揃っているか */
export function spritesReady() {
  return ready;
}

/**
 * 絵を読み込む。読み終わったら onReady を 1 度だけ呼ぶ
 * （呼ばれた側は焼いてある絵を捨てて、写真で焼き直す）。
 *
 * **1 枚でも落ちたら、9 枚まとめて無かったことにする。** 半分だけ写真になった盤面は、
 * 素材が 2 つ混ざって見えて、手続き的なものだけの盤面よりはっきり悪い。
 */
export function loadSprites(onReady) {
  if (ready) { onReady(); return; }
  if (started) return;
  started = true;
  if (typeof Image === 'undefined') return;

  let left = SPRITE_KEYS.length;
  let failed = false;
  for (const key of SPRITE_KEYS) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      images.set(key, img);
      if (--left === 0 && !failed) { ready = true; onReady(); }
    };
    img.onerror = () => {
      // 通信が無い初回など。手続き的な描き方のままで遊べるので、黙って諦める
      failed = true;
      images.clear();
    };
    img.src = `${BASE}${key}.webp`;
  }
}
