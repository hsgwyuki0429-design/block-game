// レベル定義。
//
// レベル1から無限に続く。同じレベルなら、どの端末でも必ず同じ譜面が出る
// （レベル番号 -> シード -> 決定論的な生成、という一本道になっている）。
//
// 盤面には「同じ色のブロックがちょうど2個ずつ」置かれる。
// 消えるのは必ずその2個なので「消去は色数ぶん」だけ起きる。
// ただし ―― ここがこのゲームの核 ――
//
//     ペアは、いきなりぶつけられる場所には置かれない。
//
// どのペアも「何手か滑らせて、やっと隣り合う」ところに置かれる。この
// 「追い込み手（kind:'chain'）」があるおかげで、最短手数は
//
//     PAR = 色数 + 追い込み手 + 仕込み手
//
// になる。初期盤面では、どのブロックを動かしても何も消えない ―― まず通路を
// 読み、どの順で追い込むかを頭の中で組み立てないと1個も消せない盤面を狙う。
//
// レベルが上がると
//   ・色数（＝消すペアの数）が増える
//   ・追い込みが深くなる（1組を消すまでに重ねるスライドが増える）
//   ・仕込み手（一見関係ないブロックを先に退かす手）が混ざる
// という順で難しくなる。

import { hashSeed } from './rng.js';

export const MIN_SIZE = 7;
export const MAX_SIZE = 12;
/**
 * 色数の上限。最大盤面 12×12 に「12色 × 2個 × 4マス = 96マス」で埋め率 67%
 * ―― 144 マスのうち空きは 48 マスだけ。
 *
 * 盤面が 12×12 で頭打ちになったあとは、色数を増やすことがそのまま
 * **埋め率を上げること**になる。難易度の最後のひと押しはここから取っている。
 *
 * ここが上限なのは「初期盤面では何をどう動かしても消えない」を守れる限界だから。
 * 追い込みも初手の掃除もブロックを手前へ戻す操作なので、戻す先の空きが要る。
 * 実測（1試行あたりの成立率）: 56%→8% / 67%→8% / 72%→0%（しかもペアを置く場所
 * 自体が見つからず、試行の4割が生成に失敗する）。72% は「詰まっている」のではなく
 * 「動かせない」。
 */
export const MAX_COLORS = 12;
/** 追い込み手の総数の上限 */
export const MAX_CHAIN_MOVES = 64;
/** 1組を消すまでに重ねるスライドの上限（追い込み手の深さ） */
export const MAX_CHAIN_DEPTH = 8;
/** 仕込み手の上限 */
export const MAX_SETUP_MOVES = 20;

/**
 * 目標の埋め率。これを基準に色数から盤面サイズを決める。
 * 盤面が MAX_SIZE で頭打ちになると、以降は色数がそのまま埋め率になる
 * （9色=50% / 11色=61% / 13色=72%）。
 */
const FILL = 0.5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
export function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** レベル -> 色数（＝ブロックのペア数＝消去の回数） */
export function colorsForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(3 + Math.floor((lv - 1) / 3), 3, MAX_COLORS);
}

/** レベル -> 盤面の埋め率（ブロックが占めるマスの割合） */
export function fillForLevel(level) {
  const colors = colorsForLevel(level);
  const size = boardSizeForColors(colors);
  return (colors * 8) / (size * size);
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
 * レベル -> 追い込みの深さ。
 * 「1組を消すまでに、そのブロックを平均で何手ぶん滑らせる必要があるか」。
 *
 * レベル1でも 3 手から始める。「1手ずらせば届く」形は、見つけて押すだけで
 * 終わってしまい読む余地が無いので、入門レベルにも置かない。
 */
export function chainDepthForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(3 + Math.floor((lv - 1) / 3), 3, MAX_CHAIN_DEPTH);
}

/**
 * レベル -> 追い込み手の総数。
 * 色数 × 深さ。ただし長すぎる手順は「難しい」ではなく「だるい」だけなので頭打ちにする。
 */
export function chainMovesForLevel(level) {
  const lv = normalizeLevel(level);
  const colors = colorsForLevel(lv);
  return clamp(colors * chainDepthForLevel(lv), colors, MAX_CHAIN_MOVES);
}

/**
 * レベル -> 仕込み手の数。
 * 追い込みが「消したいブロック自身を動かす手」なのに対して、仕込み手は
 * 「まったく別のブロックを先に退かす手」。盤面全体を見る必要が生まれる。
 */
export function setupMovesForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(Math.floor((lv - 3) / 2), 0, MAX_SETUP_MOVES);
}

/** レベル -> 生成の試行回数。詰まった盤面ほど当たりを引くまで回数が要る */
export function attemptsForLevel(level) {
  // 詰まった盤面では「初手が塞がった」当たりを引く確率が1割ほどまで落ちるので、
  // 試行回数を増やして引き当てにいく（1回の試行は 50ms 前後）
  return colorsForLevel(level) >= 10 ? 96 : 48;
}

/** レベル -> 生成シード。この一本道が「どの端末でも同じ譜面」を担保する */
export function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/**
 * 星の時間しきい値（秒）。
 *
 * 星は手数ではなく「解けるまでの時間」で決まる。手数で測ると、詰まったときに
 * 戻して試すのが罰になってしまう ―― このゲームで時間がかかるのは指が遅いからでは
 * なく、盤面を読んでいるからなので、時間のほうが素直に「読み切れたか」を表す。
 *
 * しきい値は実際の手数（PAR）と色数から決まる。手順が長いほど読む量も増えるため。
 *   ★★★ gold 以内 ／ ★★ silver 以内 ／ ★ クリア
 */
export function targetTimes(par, colors) {
  const gold = Math.round(20 + Math.max(1, par) * 9 + Math.max(1, colors) * 4);
  return { gold, silver: gold * 2 };
}

/** 解けるまでの秒数 -> 星（3/2/1） */
export function starsForTime(seconds, times) {
  if (seconds <= times.gold) return 3;
  if (seconds <= times.silver) return 2;
  return 1;
}

/** 秒 -> "M:SS"（1時間を超えたら "H:MM:SS"） */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** レベルの各種パラメータ */
export function levelConfig(level) {
  const lv = normalizeLevel(level);
  const colors = colorsForLevel(lv);
  const size = boardSizeForColors(colors);
  const chainMoves = chainMovesForLevel(lv);
  const setupMoves = setupMovesForLevel(lv);
  return {
    level: lv,
    colors,
    size,
    chainMoves,
    chainDepth: chainDepthForLevel(lv),
    setupMoves,
    forced: false,
    /** ブロック数（色数×2） */
    pieces: colors * 2,
    /**
     * 手数の見込み（色数＋追い込み手＋仕込み手）。
     * 実際の手数は生成してみないと決まらない（巻き戻せる場所が尽きれば浅く、
     * 初手を塞ぐために足りなければ深くなる）ので、あくまで一覧に出す目安。
     */
    par: colors + chainMoves + setupMoves,
    /** 盤面の埋め率（ブロックが占めるマスの割合） */
    fill: (colors * 8) / (size * size),
    /** 生成の試行回数 */
    attempts: attemptsForLevel(lv),
  };
}

/** レベルの内容を一言で（見出しの下に出す補足）。遊ぶ前でも出せる */
export function levelSummary(config) {
  const parts = [`${config.size}×${config.size}`, `${config.colors}色`];
  parts.push(`追い込み${config.chainDepth}手`);
  if (config.setupMoves > 0) parts.push(`仕込み${config.setupMoves}手`);
  if (config.fill >= 0.6) parts.push(`埋め率${Math.round(config.fill * 100)}%`);
  return parts.join('・');
}

/** 実際に生成できたパズルの要約（ゲーム画面の見出し下に出す） */
export function puzzleSummary(puzzle) {
  const parts = [`${puzzle.size}×${puzzle.size}`, `${puzzle.colors}色`, `PAR ${puzzle.par}手`];
  const fill = puzzle.cells / (puzzle.size * puzzle.size);
  if (fill >= 0.6) parts.push(`埋め率${Math.round(fill * 100)}%`);
  return parts.join('・');
}
