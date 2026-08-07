// レベルデータの詰め方。
//
// レベルは 1000 本あり、上のほうは 1 問 110 手を超える。素直に JSON で書くと
// 1 問 2〜3KB ―― 全部で 3MB になり、アプリ本体（200KB）の 15 倍という馬鹿げた
// 大きさになってしまう。ここでは 1 レベルを**1本の文字列**に潰す。
//
// 潰せる理由は、盤面に出てくるものが少ないから:
//   ・ブロックは全部長方形。幅も高さも 1〜3 マスなので、形は 9 通り = 1 文字
//   ・盤面は 8×8 まで。位置は 0〜63 なので、これも 1 文字
//   ・色つきは必ず 2 個で、必ず先頭。色を書く必要が無い（3個目以降は全部灰色）
//   ・1手は「どのブロックを・どの向きへ」だけ。滑る距離は盤面から決まるが、
//     読み直す手間を省いて一緒に入れてある（向き 4 通り × 距離 7 マス = 1 文字）
//
// これで 1 レベル 200〜250 文字。1000 本で 230KB ほどに収まる。
//
// 文字は 64 種類（1文字 = 6ビット）。URL に貼っても壊れない字だけを使う。

import { BLOCKER } from './board.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const VALUE = new Map();
for (let i = 0; i < ALPHABET.length; i++) VALUE.set(ALPHABET[i], i);

/** 向きの並び。添字がそのまま符号になる */
export const DIR_CODES = ['up', 'right', 'down', 'left'];

const ch = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 63) throw new Error(`符号化できない値: ${v}`);
  return ALPHABET[v];
};
const val = (c) => {
  const v = VALUE.get(c);
  if (v === undefined) throw new Error(`読めない文字: ${c}`);
  return v;
};

/**
 * パズル -> 1本の文字列。
 * @param {{size:number, pieces:{c:number, s:number[][]}[], solution:Array}} puzzle
 */
export function encodeLevel(puzzle) {
  const { size, pieces, solution } = puzzle;
  if (size < 2 || size > 8) throw new Error(`盤面が符号化できません: ${size}`);
  let out = ch(size) + ch(pieces.length);
  for (const p of pieces) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of p.s) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w * h !== p.s.length) throw new Error('長方形でないブロックは符号化できません');
    if (w > 3 || h > 3) throw new Error(`大きすぎるブロック: ${w}x${h}`);
    out += ch(minY * 8 + minX) + ch((w - 1) * 3 + (h - 1));
  }
  for (const [pieceId, dir, distance] of solution) {
    const d = DIR_CODES.indexOf(dir);
    if (d < 0) throw new Error(`向きが不正: ${dir}`);
    if (distance < 1 || distance > 8) throw new Error(`滑る距離が不正: ${distance}`);
    out += ch(pieceId - 1) + ch(d * 8 + (distance - 1));
  }
  return out;
}

/**
 * 1本の文字列 -> パズル。
 * @returns {{size:number, cells:number, optimal:number,
 *            pieces:{c:number, s:number[][]}[], solution:Array}}
 */
export function decodeLevel(code) {
  const size = val(code[0]);
  const count = val(code[1]);
  const pieces = [];
  let cells = 0;
  let at = 2;
  for (let k = 0; k < count; k++) {
    const p = val(code[at++]);
    const s = val(code[at++]);
    const x = p % 8;
    const y = (p - x) / 8;
    const w = Math.floor(s / 3) + 1;
    const h = (s % 3) + 1;
    const shape = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) shape.push([x + i, y + j]);
    cells += shape.length;
    // 色つきは必ず先頭の2個。3個目からは全部灰色
    pieces.push({ c: k < 2 ? 0 : BLOCKER, s: shape, w, h });
  }
  const solution = [];
  while (at < code.length) {
    const id = val(code[at++]) + 1;
    const m = val(code[at++]);
    solution.push([id, DIR_CODES[Math.floor(m / 8)], (m % 8) + 1]);
  }
  return { size, cells, optimal: solution.length, pieces, solution };
}

/** 符号だけから最短手数を読む（盤面を組み立てずに済ませたいとき用） */
export function optimalOf(code) {
  const count = val(code[1]);
  return (code.length - 2 - count * 2) / 2;
}

/** 符号だけから盤面の一辺を読む */
export function sizeOf(code) {
  return val(code[0]);
}

/** 符号だけから埋め率を読む */
export function fillOf(code) {
  const count = val(code[1]);
  let cells = 0;
  for (let k = 0; k < count; k++) {
    const s = val(code[3 + k * 2]);
    cells += (Math.floor(s / 3) + 1) * ((s % 3) + 1);
  }
  const size = val(code[0]);
  return cells / (size * size);
}
