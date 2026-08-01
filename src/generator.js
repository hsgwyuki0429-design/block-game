// パズル生成 ―「解の逆順構築」
//
// ランダムに埋めて解けるか検証する、という素朴な方法は使わない。代わりに
// 完成状態（空盤面）から出発し、1手ぶんずつ逆再生するようにブロックを置いていく。
// 最後に置いたステップが、解の第1手になる。
//
// 盤面には同じ色のブロックがちょうど2個ずつ。だから1手で消えるのは必ずその2個で、
// 「最短手数＝色数」が構造的に決まる。逆順構築の1ステップはこうなる:
//
//   色 c を新しく1つ選ぶ
//     移動ブロック P : テトロミノ。着地点 B・滑走方向 d・開始点 A (= B - t×d)
//     相棒ブロック Q : 同じ色 c。B にいる P に隣接する
//
//   制約                                   保証される性質
//   ─────────────────────────────────────────────────────
//   新規セルはすべて空き                    ブロックの重複なし
//   A→B の経路が空 / B+d に壁かブロック      その手が実行でき、ちょうど B で止まる
//   A にいる P は Q に触れていない            初期盤面から同色は隣接しない
//
// 色ごとにブロックは2個しかないので「予定外の巻き込み消去」は原理的に起きない。
//
// さらに上のレベルでは「仕込み手」を前に足す。盤面にあるブロックを1つ選び、
// 滑らせれば今の位置に来るような手前の位置へ戻す。その手自体では何も消えないが、
// 通さないと後の手が成立しない ―― 一見関係ない場所を動かす必要が生まれる。

import { Board } from './board.js';
import { DIRS, DIR_KEYS, OPPOSITE, TETROMINOES } from './shapes.js';
import { makeRng, shuffle } from './rng.js';
import { levelConfig, levelSeed } from './levels.js';

export const DEFAULT_OPTIONS = {
  size: 8,
  colors: 4,
  setupMoves: 0,
  forced: false,
  attempts: 60,
  /** 滑走距離の偏り。1 未満で「長い滑走」寄り */
  distanceBias: 0.85,
  /** 配置優先度のゆらぎ。0 だと常に最も詰まった場所へ置く（＝単調になる） */
  packingJitter: 3,
  /** 一本道の判定を1ステップで何回まで試すか（探索が指数的に伸びるのを防ぐ） */
  forcedChecks: 90,
};

/** セル群の上下左右の隣接セルを Set に集める（盤外は無視） */
function haloOf(size, cells, target = new Set()) {
  for (const [x, y] of cells) {
    for (const key of DIR_KEYS) {
      const d = DIRS[key];
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      target.add(ny * size + nx);
    }
  }
  return target;
}

/** 盤面に置けるすべての「形状 × 位置」を列挙（空きマスのみ） */
function emptyPlacements(board) {
  const out = [];
  const size = board.size;
  for (const shape of TETROMINOES) {
    const maxX = size - shape.w;
    const maxY = size - shape.h;
    for (let oy = 0; oy <= maxY; oy++) {
      for (let ox = 0; ox <= maxX; ox++) {
        let ok = true;
        const cells = [];
        for (const [cx, cy] of shape.cells) {
          const x = cx + ox;
          const y = cy + oy;
          if (board.grid[y * size + x] !== -1) { ok = false; break; }
          cells.push([x, y]);
        }
        if (ok) out.push({ shape, cells });
      }
    }
  }
  return out;
}

/**
 * 配置の「詰まり具合」。壁や既存ブロックに接しているほど高い。
 * これを優先して置くと空きマスが断片化せず、密度の高い盤面になる。
 */
function contactScore(board, cells) {
  const size = board.size;
  let score = 0;
  for (const [x, y] of cells) {
    for (const key of DIR_KEYS) {
      const d = DIRS[key];
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) score += 1;
      else if (board.grid[ny * size + nx] !== -1) score += 2;
    }
  }
  return score;
}

/**
 * 相棒ブロック Q を1つ探す。
 * anchors のいずれかのセルを含み、すべての制約を満たす配置を返す（無ければ null）。
 */
function findPartner(board, rng, ctx, anchors) {
  const { size, blocked, forbidden } = ctx;
  for (const anchor of shuffle(rng, [...anchors])) {
    const ax = anchor % size;
    const ay = (anchor - ax) / size;
    for (const shape of shuffle(rng, TETROMINOES.slice())) {
      for (const oi of shuffle(rng, shape.cells.map((_, i) => i))) {
        const [px, py] = shape.cells[oi];
        const ox = ax - px;
        const oy = ay - py;
        const cells = [];
        let ok = true;
        for (const [cx, cy] of shape.cells) {
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= size || y >= size) { ok = false; break; }
          const gi = y * size + x;
          if (board.grid[gi] !== -1) { ok = false; break; }
          if (blocked.has(gi)) { ok = false; break; }
          if (forbidden.has(gi)) { ok = false; break; }
          cells.push([x, y]);
        }
        if (ok) return { shape, cells };
      }
    }
  }
  return null;
}

/**
 * いま消せる色の集合。
 * 消去は必ず同色2個をまとめて取り除くだけなので、結果の盤面は「どの色が消えたか」
 * だけで決まる。したがって「消せる色が1つしかない＝次の一手が実質1通り」になる。
 */
export function clearableColors(board, limit = Infinity) {
  const out = new Set();
  for (const [id, piece] of board.pieces) {
    if (out.has(piece.color)) continue; // この色はもう数えた
    for (const dir of DIR_KEYS) {
      const r = board.simulate(id, dir);
      if (r && r.cleared.length > 0) { out.add(piece.color); break; }
    }
    if (out.size >= limit) break; // 呼び出し側が必要な数まで数えたら打ち切る
  }
  return out;
}

/** 見つけた候補を実際に盤面へ置く */
function commitPair(board, color, cand) {
  const moving = board.addPiece(color, cand.acells, cand.aname);
  const mate = board.addPiece(color, cand.q.cells, cand.q.shape.name);
  return {
    movingId: moving.id,
    mateId: mate.id,
    step: { pieceId: moving.id, dir: cand.dir, distance: cand.t, color, kind: 'clear' },
  };
}

/**
 * 逆順構築の1ステップ。色 color のペアを盤面に足し、その手を返す。
 * 探索は「開始点 A」から始める。A に置いたブロックが盤面に残るので、
 * A を詰まった場所から順に試すと空きマスが断片化しにくい。
 *
 * requireForced のときは「置いた直後に消せる色がこの色だけ」になる配置を探す。
 * ただし見つからないからといって生成全体を捨てはしない ―― 最初に見つかった
 * 普通の配置を控えとして持っておき、最後にそれを使う。
 */
function placePair(board, rng, opts, color, requireForced) {
  const size = board.size;
  const placements = emptyPlacements(board);
  for (const p of placements) p.score = contactScore(board, p.cells) + rng() * opts.packingJitter;
  placements.sort((a, b) => b.score - a.score);

  let fallback = null;
  let checks = 0;

  search:
  for (const placement of placements) {
    const acells = placement.cells;

    for (const dir of shuffle(rng, DIR_KEYS.slice())) {
      const d = DIRS[dir];

      // A から d 方向へ何マス進めるか（＝経路が空である最大距離）
      let maxT = 0;
      for (let t = 1; t < size; t++) {
        let ok = true;
        for (const [x, y] of acells) {
          const nx = x + d.x * t;
          const ny = y + d.y * t;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { ok = false; break; }
          if (board.grid[ny * size + nx] !== -1) { ok = false; break; }
        }
        if (!ok) break;
        maxT = t;
      }
      if (maxT === 0) continue;

      const t = 1 + Math.floor(Math.pow(rng(), opts.distanceBias) * maxT);
      const bcells = acells.map(([x, y]) => [x + d.x * t, y + d.y * t]);

      // 掃過セル（A から B までに P が占める全セル）。相棒はここに置けない
      const blocked = new Set();
      for (let i = 0; i <= t; i++) {
        for (const [x, y] of acells) blocked.add((y + d.y * i) * size + (x + d.x * i));
      }

      // ストッパー: B+d に壁か既存ブロックがあるか
      let stopped = false;
      const front = new Set();
      for (const [x, y] of bcells) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) { stopped = true; continue; }
        const gi = ny * size + nx;
        if (blocked.has(gi)) continue;
        if (board.grid[gi] !== -1) { stopped = true; continue; }
        front.add(gi);
      }

      // 相棒は「B の P に隣接」かつ「A の P には隣接しない」
      const forbidden = haloOf(size, acells);
      const ctx = { size, blocked, forbidden };

      // ストッパーが無いなら、相棒が進行方向側を塞ぐ役も兼ねる
      const anchors = stopped ? haloOf(size, bcells) : front;
      for (const gi of blocked) anchors.delete(gi);
      if (anchors.size === 0) continue;

      const q = findPartner(board, rng, ctx, anchors);
      if (!q) continue;

      const cand = { acells, aname: placement.shape.name, q, dir, t };
      const placed = commitPair(board, color, cand);
      if (!requireForced) return placed.step;

      // 一本道を求めるレベルでは、この局面で消せる色がこの色だけであることを課す
      if (clearableColors(board, 2).size <= 1) return placed.step;

      board.removePiece(placed.movingId);
      board.removePiece(placed.mateId);
      if (!fallback) fallback = cand;
      if (++checks >= opts.forcedChecks) break search;
    }
  }

  if (fallback) return commitPair(board, color, fallback).step;
  return null;
}

/**
 * 仕込み手を1つ前に足す。
 * 盤面のブロックを1つ選び、「滑らせれば今の位置にちょうど来る」手前の位置へ戻す。
 * その手自体では何も消えない（同色は隣接していないため）が、
 * 通さないと後の手が成立しない。
 *
 * @param {number[]} preferIds この順で優先して対象を選ぶ（次に動かす予定のブロックなど）
 */
function placeSetup(board, rng, opts) {
  const size = board.size;
  const candidates = [];

  for (const id of board.pieces.keys()) {
    const piece = board.pieces.get(id);
    const partner = [...board.pieces.values()].find((p) => p.color === piece.color && p.id !== id);
    const own = new Set(piece.cells.map(([x, y]) => y * size + x));

    for (const dir of DIR_KEYS) {
      const d = DIRS[dir];

      // 今の位置に「ちょうど止まる」ためには、進行方向側が壁かブロックである必要がある
      let stopped = false;
      for (const [x, y] of piece.cells) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) { stopped = true; break; }
        const gi = ny * size + nx;
        if (own.has(gi)) continue;
        if (board.grid[gi] !== -1) { stopped = true; break; }
      }
      if (!stopped) continue;

      // 手前へ何マス戻せるか（自分のセルは通過できる）
      for (let t = 1; t < size; t++) {
        let ok = true;
        for (const [x, y] of piece.cells) {
          const nx = x - d.x * t;
          const ny = y - d.y * t;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { ok = false; break; }
          const gi = ny * size + nx;
          if (own.has(gi)) continue;
          if (board.grid[gi] !== -1) { ok = false; break; }
        }
        if (!ok) break;

        // 戻した先で相棒に触れていてはいけない（触れていたらその場で消えてしまう）
        const from = piece.cells.map(([x, y]) => [x - d.x * t, y - d.y * t]);
        if (partner) {
          const halo = haloOf(size, from);
          if (partner.cells.some(([x, y]) => halo.has(y * size + x))) continue;
        }
        candidates.push({ id, dir, t, color: piece.color });
      }
    }
  }
  if (candidates.length === 0) return null;

  // 「動かした結果、すぐ消せる色が減る」候補を選ぶ。
  // 消せる色が 0 になれば、その仕込み手を通さないと先へ進めない盤面になる。
  shuffle(rng, candidates);
  let best = null;
  let bestN = Infinity;
  for (const c of candidates.slice(0, 80)) {
    board.movePiece(c.id, OPPOSITE[c.dir], c.t);
    const n = clearableColors(board, bestN).size;
    board.movePiece(c.id, c.dir, c.t);
    if (n < bestN) {
      bestN = n;
      best = c;
      if (n === 0) break;
    }
  }
  if (!best) return null;

  board.movePiece(best.id, OPPOSITE[best.dir], best.t);
  return { pieceId: best.id, dir: best.dir, distance: best.t, color: best.color, kind: 'setup' };
}

/** 1回分の生成試行 */
function attemptBuild(seed, opts) {
  const rng = makeRng(seed);
  const board = new Board(opts.size);
  const solution = [];

  for (let c = 0; c < opts.colors; c++) {
    const step = placePair(board, rng, opts, c, opts.forced);
    if (!step) return null;
    // 逆順に作っているので、新しいステップほど「先の手」になる
    solution.unshift(step);
  }

  for (let i = 0; i < opts.setupMoves; i++) {
    const step = placeSetup(board, rng, opts);
    if (!step) break;
    solution.unshift(step);
  }

  return { board, solution };
}

/**
 * 解の道筋を調べる。
 *   clearAtStart : 初期盤面に「消せる手」がいくつあるか（0 なら仕込み手が必須）
 *   forced       : どの局面でも「消せる手」の結果が実質1通りしかないか
 */
export function analyzeSolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);
  let forced = true;
  let clearAtStart = 0;
  let branchPoints = 0;

  for (let i = 0; i < solution.length; i++) {
    const colors = clearableColors(board);
    if (i === 0) clearAtStart = colors.size;
    // 仕込み手の局面（消せる色が無い）は分岐とみなさない
    if (colors.size > 1) {
      forced = false;
      branchPoints++;
    }
    board.applyMove(solution[i].pieceId, solution[i].dir);
  }
  return { forced, clearAtStart, branchPoints };
}

/** レベル番号からパズルを作る */
export function generateLevel(level, overrides = {}) {
  const config = levelConfig(level);
  const puzzle = generatePuzzle(levelSeed(config.level), {
    size: config.size,
    colors: config.colors,
    setupMoves: config.setupMoves,
    forced: config.forced,
    attempts: config.attempts,
    ...overrides,
  });
  return { ...puzzle, level: config.level, config };
}

/** generateLevel の非同期版（画面を固めずに生成する） */
export async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  const config = levelConfig(level);
  const puzzle = await generatePuzzleAsync(levelSeed(config.level), {
    size: config.size,
    colors: config.colors,
    setupMoves: config.setupMoves,
    forced: config.forced,
    attempts: config.attempts,
    ...overrides,
  }, onProgress);
  return { ...puzzle, level: config.level, config };
}

function runAttempt(seed, opts, attempt) {
  // 試行ごとにシードを派生させる（同じ seed なら常に同じ結果）
  const derived = (seed + attempt * 0x9e3779b1) >>> 0;
  const built = attemptBuild(derived, opts);
  if (!built || built.solution.length === 0) return null;

  const snapshot = built.board.snapshot();
  if (!verifySolution(snapshot, built.solution, opts.size).ok) return null;

  const analysis = analyzeSolution(snapshot, built.solution, opts.size);
  return {
    seed: seed >>> 0,
    snapshot,
    solution: built.solution,
    par: built.solution.length,
    cells: built.board.filledCells,
    pieces: built.board.pieceCount,
    size: opts.size,
    colors: opts.colors,
    setupMoves: built.solution.filter((s) => s.kind === 'setup').length,
    analysis,
  };
}

/** 望んだ性質をどれだけ満たしているか。大きいほど良い */
function score(result, opts) {
  let s = result.cells;
  if (opts.setupMoves > 0) {
    s += result.setupMoves * 40;
    // 初手から消せる手が無い＝仕込みが必須。これが一番欲しい形
    if (result.analysis.clearAtStart === 0) s += 200;
  }
  if (opts.forced && result.analysis.forced) s += 300;
  return s;
}

function goodEnough(result, opts) {
  if (opts.setupMoves > 0 && result.analysis.clearAtStart !== 0) return false;
  if (opts.setupMoves > 0 && result.setupMoves < opts.setupMoves) return false;
  if (opts.forced && !result.analysis.forced) return false;
  return true;
}

export function generatePuzzle(seed, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (!result) continue;
    const s = score(result, opts);
    if (s > bestScore) { best = result; bestScore = s; }
    if (goodEnough(result, opts)) break;
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * generatePuzzle と同じものを、試行の合間にイベントループへ制御を返しながら作る。
 * UI 側はこちらを使って「生成中」を出しつつ画面を固めない。
 */
export async function generatePuzzleAsync(seed, options = {}, onProgress = null) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (result) {
      const s = score(result, opts);
      if (s > bestScore) { best = result; bestScore = s; }
      if (goodEnough(result, opts)) break;
    }
    if (onProgress) onProgress((attempt + 1) / opts.attempts);
    if (attempt % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * 生成された解答手順を前から実行して、本当に全消しできるか確かめる。
 * 生成ロジックのバグをここで必ず捕まえる（テストからも使用）。
 */
export function verifySolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }
  for (const p of board.pieces.values()) {
    if (p.cells.length !== 4) return { ok: false, reason: 'テトロミノ以外のブロックがある' };
  }
  const counts = new Map();
  for (const p of board.pieces.values()) counts.set(p.color, (counts.get(p.color) || 0) + 1);
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
    const wantCleared = step.kind === 'setup' ? 0 : 2;
    if (res.cleared.length !== wantCleared) {
      return { ok: false, reason: `手 ${i + 1}: 消去数が想定と違う (${res.cleared.length} != ${wantCleared})` };
    }
    if (board.hasSameColorContact()) {
      return { ok: false, reason: `手 ${i + 1} の直後に同色接触が残っている` };
    }
  }

  if (!board.isEmpty) {
    return { ok: false, reason: `解答を実行しても ${board.pieceCount} 個残る` };
  }
  return { ok: true };
}
