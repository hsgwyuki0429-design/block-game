// レベル定義。
//
// レベル1から無限に続く。同じレベルなら、どの端末でも必ず同じ譜面が出る
// （レベル番号 -> シード -> 決定論的な生成、という一本道になっている）。
//
// 盤面には「同じ色のブロックがちょうど2個ずつ」置かれる。
// 1手で消えるのは必ずその2個なので、
//
//     最短手数 = 色数
//
// が構造的に決まる。レベルが上がると色数が増え、それに合わせて盤面も広がる。
// さらに上のレベルでは
//   ・仕込み手（それ自体では何も消えないが、通さないと解けない手）
//   ・一本道（どの局面でも「消せる手」が実質1通りしかない）
// が加わる。

import { hashSeed } from './rng.js';

export const MIN_SIZE = 4;
export const MAX_SIZE = 12;
/**
 * 色数の上限。最大盤面 12×12 に「11色 × 2個 × 4マス = 88マス」を敷いても
 * 埋め率は 61% ―― 逆順構築が滑走路を確保できる密度に収まる。
 * これ以上増やすと盤面が詰まりすぎて生成が破綻する。
 */
export const MAX_COLORS = 11;

/** 目標の埋め率。これを基準に色数から盤面サイズを決める */
const FILL = 0.62;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
export function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** レベル -> 色数（＝ブロックのペア数＝最短手数） */
export function colorsForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(1 + Math.floor((lv - 1) / 2), 1, MAX_COLORS);
}

/** 色数 -> 盤面サイズ。ブロックは色数×2個、1個4マスなので 8×色数 マスを敷く */
export function boardSizeForColors(colors) {
  const cells = clamp(Math.round(colors), 1, MAX_COLORS) * 8;
  return clamp(Math.round(Math.sqrt(cells / FILL)), MIN_SIZE, MAX_SIZE);
}

/** レベル -> 盤面サイズ */
export function boardSizeForLevel(level) {
  return boardSizeForColors(colorsForLevel(level));
}

/**
 * レベル -> 仕込み手の数。
 * 「一見関係ないところを動かさないと解けない」手を何手ぶん混ぜるか。
 */
export function setupMovesForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(Math.floor((lv - 8) / 5), 0, 4);
}

/** レベル -> 一本道（解が実質1通り）を要求するか */
export function requiresForcedLine(level) {
  return normalizeLevel(level) >= 16;
}

/** レベル -> 生成シード。この一本道が「どの端末でも同じ譜面」を担保する */
export function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/** レベルの各種パラメータ */
export function levelConfig(level) {
  const lv = normalizeLevel(level);
  const colors = colorsForLevel(lv);
  const size = boardSizeForColors(colors);
  const setupMoves = setupMovesForLevel(lv);
  return {
    level: lv,
    colors,
    size,
    setupMoves,
    forced: requiresForcedLine(lv),
    /** ブロック数（色数×2） */
    pieces: colors * 2,
    /** 最短手数＝色数＋仕込み手 */
    par: colors + setupMoves,
    /** 生成の試行回数 */
    attempts: 60,
  };
}

/** レベルの内容を一言で（見出しの下に出す補足） */
export function levelSummary(config) {
  const parts = [`${config.size}×${config.size}`, `${config.colors}色`];
  if (config.setupMoves > 0) parts.push(`仕込み${config.setupMoves}手`);
  if (config.forced) parts.push('一本道');
  return parts.join('・');
}
