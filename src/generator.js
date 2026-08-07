// レベル番号 -> 盤面。
//
// 盤面はその場で作らない。tools/harvest.mjs が事前に全探索して焼いたものを
// src/levelData.js から取り出し、Board に組み直すだけ。
//
// 昔はここで「解の逆順構築」―― 完成状態から1手ずつ巻き戻してブロックを置く ――
// をやっていた。手軽だが、保証できるのは「解ける手順がひとつある」ことだけで、
// 本当の最短手数は分からない。実測すると PAR 106手と表示していた盤面が20手で
// 解けていた。表示していた手数が嘘だったので、作り方ごと捨てた。
//
// いまは src/exact.js が「到達できる盤面を全部展開して、ゴールからちょうど N 手の
// 配置」を選んでいる。N は推定ではなく**厳密な最短手数**で、近道は原理的に無い。
//
// ここに残っているのは、焼いたデータを組み立てる関数と、それを検算する関数だけ。

import { Board, BLOCKER } from './board.js';
import { DIR_KEYS } from './shapes.js';
import { levelConfig, levelData, normalizeLevel } from './levels.js';

/**
 * 「いま1手で消せる色」の集合。
 *
 * 盤面には同じ色がちょうど2個ずつしかないので、消える条件は「その2個が触れる」
 * だけで決まる。したがって「消せる色が1つしかない＝次の一手が実質1通り」になる。
 */
export function clearableColors(board, limit = Infinity) {
  const out = new Set();
  for (const [id, piece] of board.pieces) {
    if (piece.color === BLOCKER) continue; // 灰色は消えない
    if (out.has(piece.color)) continue; // この色はもう数えた
    for (const dir of DIR_KEYS) {
      const r = board.simulate(id, dir);
      if (r && r.cleared.length > 0) { out.add(piece.color); break; }
    }
    if (out.size >= limit) break; // 呼び出し側が必要な数まで数えたら打ち切る
  }
  return out;
}

/** その色が「いま1手で消せる」か。色ごとにブロックは2個なので判定は軽い */
export function colorClearable(board, color) {
  if (color === BLOCKER) return false; // 灰色は何と触れても消えない
  for (const [id, piece] of board.pieces) {
    if (piece.color !== color) continue;
    for (const dir of DIR_KEYS) {
      const r = board.simulate(id, dir);
      if (r && r.cleared.length > 0) return true;
    }
  }
  return false;
}

/**
 * 解の道筋を調べる。
 *   clearAtStart : 初期盤面に「消せる手」がいくつあるか（0 が狙い）
 *   forced       : どの局面でも「消せる手」の結果が実質1通りしかないか
 *   dryStreak    : 何も消えない手が最大で何手続くか（＝読みの深さ）
 *   blindMoves   : 「消せる色がひとつも無い」局面が何回あるか
 */
export function analyzeSolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);
  let forced = true;
  let clearAtStart = 0;
  let branchPoints = 0;
  let blindMoves = 0;
  let dryStreak = 0;
  let streak = 0;

  for (let i = 0; i < solution.length; i++) {
    const colors = clearableColors(board);
    if (i === 0) clearAtStart = colors.size;
    if (colors.size === 0) blindMoves++;
    // 何も消せない局面は「選択肢が無い」ので分岐とはみなさない
    if (colors.size > 1) {
      forced = false;
      branchPoints++;
    }
    const res = board.applyMove(solution[i].pieceId, solution[i].dir);
    if (res && res.cleared.length > 0) streak = 0;
    else dryStreak = Math.max(dryStreak, ++streak);
  }
  return { forced, clearAtStart, branchPoints, blindMoves, dryStreak };
}

/**
 * レベル番号 -> 焼いてあるパズル。
 *
 * ブロックはデータの順に入れる。id が採集時と同じ並びになるので、
 * 一緒に焼いてある手順（ブロックid・向き・滑るマス数）がそのまま使える。
 */
export function levelPuzzle(level) {
  const lv = normalizeLevel(level);
  const data = levelData(lv);
  const board = new Board(data.size);
  for (const p of data.pieces) board.addPiece(p.c, p.s, `${p.w}x${p.h}`);

  const snapshot = board.snapshot();
  const solution = data.solution.map(([pieceId, dir, distance], i) => ({
    pieceId,
    dir,
    distance,
    color: board.pieces.get(pieceId).color,
    // 色つきは1組しかないので、消えるのは必ずいちばん最後の1手
    kind: i === data.solution.length - 1 ? 'clear' : 'chain',
  }));

  const colors = new Set();
  let blockers = 0;
  for (const piece of board.pieces.values()) {
    if (piece.color === BLOCKER) blockers++;
    else colors.add(piece.color);
  }

  return {
    seed: lv,
    snapshot,
    solution,
    par: solution.length,
    cells: board.filledCells,
    pieces: board.pieceCount,
    size: data.size,
    colors: colors.size,
    blockers,
    chainMoves: solution.length - 1,
    setupMoves: 0,
    /** 厳密な最短手数（これより短い解き方は存在しない） */
    optimal: data.optimal,
    analysis: analyzeSolution(snapshot, solution, data.size),
    level: lv,
    config: levelConfig(lv),
  };
}

/** レベル番号からパズルを作る */
export function generateLevel(level) {
  return levelPuzzle(level);
}

/** generateLevel の非同期版（画面を固めないための形だけ合わせてある） */
export async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  if (onProgress) onProgress(1);
  return levelPuzzle(level);
}

/**
 * 盤面と手順を突き合わせて検算する。
 * 「その手順どおりに指せば、本当に、ちょうどそこで全部消えるか」を確かめる。
 */
export function verifySolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }
  for (const p of board.pieces.values()) {
    if (p.cells.length < 2 || p.cells.length > 9) {
      return { ok: false, reason: `${p.cells.length}マスのブロックがある（2〜9マスであるべき）` };
    }
  }
  const counts = new Map();
  for (const p of board.pieces.values()) {
    if (p.color === BLOCKER) continue; // 灰色は何個でもよい
    counts.set(p.color, (counts.get(p.color) || 0) + 1);
  }
  for (const [color, n] of counts) {
    if (n !== 2) return { ok: false, reason: `色 ${color} のブロックが ${n} 個（2個であるべき）` };
  }

  for (let i = 0; i < solution.length; i++) {
    const step = solution[i];
    if (!board.pieces.has(step.pieceId)) {
      return { ok: false, reason: `手 ${i + 1}: ブロックが存在しない` };
    }
    const res = board.applyMove(step.pieceId, step.dir);
    if (!res) return { ok: false, reason: `手 ${i + 1}: 動かせない` };
    if (res.steps !== step.distance) {
      return { ok: false, reason: `手 ${i + 1}: 停止位置が想定と違う (${res.steps} != ${step.distance})` };
    }
    // 消えるのは 'clear' の手だけ。それ以外の手では何も消えてはいけない
    const wantCleared = step.kind === 'clear' ? 2 : 0;
    if (res.cleared.length !== wantCleared) {
      return { ok: false, reason: `手 ${i + 1}: 消去数が想定と違う (${res.cleared.length} != ${wantCleared})` };
    }
    if (board.hasSameColorContact()) {
      return { ok: false, reason: `手 ${i + 1} の直後に同色接触が残っている` };
    }
  }

  if (!board.isCleared) {
    return { ok: false, reason: `解答を実行しても色つきブロックが ${board.coloredCount} 個残る` };
  }
  return { ok: true };
}
