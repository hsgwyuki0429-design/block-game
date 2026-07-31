// パズル生成 ―「解の逆順構築」
//
// ランダムに埋めて解けるか検証する、という素朴な方法は使わない（80% 埋めはほぼ確実に詰む）。
// 代わりに完成状態（空盤面）から出発し、「ある 1 手でまとめて消えるブロック群」を
// 1 ステップずつ置いていく。最後に置いたステップが、解の第 1 手になる。
//
//   S_N = ∅（空盤面）← 逆順ステップ 1 ─ S_{N-1} ← ステップ 2 ─ … ← ステップ N ─ S_0（初期盤面）
//
// 各ステップで置くもの:
//   移動ブロック P : 色 c・形状・着地点 B・滑走方向 d・開始点 A (= B - t*d)
//   相棒ブロック Q : 同色 c。B にいる P に隣接し、Q 同士は非隣接
//
// 配置時の制約（それぞれが一つの保証に対応する）:
//   新規セルはすべて空き               -> ブロックの重複なし
//   既存の同色ブロックと隣接しない       -> 同色隣接ゼロ ＋ 予定外の巻き込み消去が起きない
//   A→B の経路が空 / B+d に壁かブロック -> その手が実行可能で、ちょうど B で止まる
//   A にいる時点で同色接触していない     -> 中間状態の不変条件が保たれる
//
// 結果として PAR（保証解の手数）と完全な解答手順が副産物として手に入る。

import { Board, BOARD_SIZE, COLOR_COUNT } from './board.js';
import { DIRS, DIR_KEYS, TETROMINOES } from './shapes.js';
import { makeRng, shuffle, weightedIndex } from './rng.js';
import { levelConfig, levelSeed, buildLevelClasses } from './levels.js';

export const DEFAULT_OPTIONS = {
  size: BOARD_SIZE,
  colors: COLOR_COUNT,
  /** 使用するブロックのクラス（形状集合と配合比）。レベルごとに差し替える */
  classes: [{ kind: 'single', parts: 1, weight: 1, shapes: TETROMINOES }],
  /** 目標の埋め率（セル数）。盤面の約 80% */
  targetCells: 120,
  /** これを下回る盤面は生成失敗として作り直す */
  minCells: 100,
  /** 目標にこれだけ届いていれば「十分良い」として打ち切る */
  acceptSlack: 4,
  /** 手数（PAR）の上限 */
  maxSteps: 16,
  /** これ未満の手数しかない盤面は物足りないので作り直す */
  minPar: 4,
  /** 1 ステップの相棒ブロック数（= 1手で消えるブロック数 - 1）の重み */
  partnerWeights: [0.45, 0.4, 0.15],
  /** 滑走距離の偏り。1 未満で「長い滑走」寄り、1 より大きいと短い滑走寄り */
  distanceBias: 0.85,
  /** 配置優先度のゆらぎ。0 だと常に最も詰まった場所へ置く（＝単調になる） */
  packingJitter: 3,
  /** 1 ステップあたりの探索予算 */
  budget: 26000,
  /** 生成全体のリトライ回数 */
  attempts: 24,
};

/** [x,y] 配列を「格子 index の Set」に */
function cellSet(size, cells) {
  const s = new Set();
  for (const [x, y] of cells) s.add(y * size + x);
  return s;
}

/** セル群の上下左右の隣接セルを Set に追加（盤外は無視） */
function addHalo(size, cells, target) {
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

/** 盤面上に置けるすべての「形状 × 位置」を列挙（空きマスのみ） */
function emptyPlacements(board, shapes) {
  const out = [];
  const size = board.size;
  for (const shape of shapes) {
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
 * 相棒ブロック Q の候補をひとつ探す。
 * anchors のいずれかのセルを含み、すべての制約を満たす配置を返す（無ければ null）。
 */
function findPartner(board, rng, ctx, anchors) {
  const { size, color, shapes, blocked, forbiddenAdj } = ctx;
  const anchorList = shuffle(rng, [...anchors]);
  for (const anchor of anchorList) {
    const ax = anchor % size;
    const ay = (anchor - ax) / size;
    const shapeList = shuffle(rng, shapes.slice());
    for (const shape of shapeList) {
      const offsets = shuffle(rng, shape.cells.map((c, i) => i));
      for (const oi of offsets) {
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
          // 動かすブロック P（A 地点）や既に選んだ相棒に隣接してはいけない
          if (forbiddenAdj.has(gi)) { ok = false; break; }
          cells.push([x, y]);
        }
        if (!ok) continue;
        // 盤面上の同色ブロックと隣接してはいけない（予定外の巻き込み消去の防止）
        if (board.touchesColor(cells, color)) continue;
        return { shape, cells };
      }
    }
  }
  return null;
}

/**
 * 配置の「詰まり具合」。壁や既存ブロックに接しているほど高い。
 * これを優先して置くことで空きマスの断片化を防ぎ、埋め率を上げる。
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
 * 逆順構築の 1 ステップ。
 *
 * まずブロックのクラス（テトロミノ / 2個つなぎ / 3個つなぎ）を配合比で抽選し、
 * そのクラスだけで 1 ステップを組む。1 ステップ分のブロックはまとめて消える
 * 仲間なので、同じクラスで揃えると見た目のまとまりも良くなる。
 * 抽選したクラスで置けなければ、残りのクラスへ順に落としていく。
 */
function buildStep(board, rng, opts) {
  const order = weightedOrder(rng, opts.classes);
  for (let i = 0; i < order.length; i++) {
    const cls = order[i];
    // 第1候補には満額、フォールバックには控えめな探索予算を与える
    const budget = i === 0 ? opts.budget : Math.round(opts.budget * 0.35);
    const step = buildStepWithShapes(board, rng, opts, cls.shapes, budget);
    if (step) return { ...step, kind: cls.kind };
  }
  return null;
}

/** 重みつきの並べ替え（重みが大きいクラスほど前に来やすい） */
function weightedOrder(rng, classes) {
  const pool = classes.slice();
  const out = [];
  while (pool.length > 0) {
    let total = 0;
    for (const c of pool) total += Math.max(1e-6, c.weight);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= Math.max(1e-6, pool[i].weight);
      if (r < 0) { idx = i; break; }
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * 指定した形状集合だけで 1 ステップ組む。
 *
 * 探索は「開始点 A」から始める。A に置いたブロックが盤面に残るので、
 * A を詰まった場所から順に試すと空きマスが断片化しにくい。
 */
function buildStepWithShapes(board, rng, opts, shapes, budgetLimit) {
  const size = board.size;
  const placements = emptyPlacements(board, shapes);
  for (const p of placements) p.score = contactScore(board, p.cells) + rng() * opts.packingJitter;
  placements.sort((a, b) => b.score - a.score);
  let budget = budgetLimit;

  const used = new Array(opts.colors).fill(0);
  for (const p of board.pieces.values()) used[p.color]++;

  for (const placement of placements) {
    if (budget <= 0) break;
    const acells = placement.cells;

    // ---- 色を選ぶ（開始点 A で同色に触れない色だけ = 中間状態の不変条件） ----
    // 使用数の少ない色を優先し、6色がまんべんなく盤面に出るようにする
    const colorOrder = Array.from({ length: opts.colors }, (_, i) => i)
      .sort((a, b) => (used[a] + rng() * 2.5) - (used[b] + rng() * 2.5));
    for (const color of colorOrder) {
      if (--budget <= 0) break;
      if (board.touchesColor(acells, color)) continue;

      // ---- 滑走方向と距離を選ぶ ----
      for (const dir of shuffle(rng, DIR_KEYS.slice())) {
        const d = DIRS[dir];

        // A から d 方向へ何マス進めるか（= 経路が空である最大距離）
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
        // 着地点 B で既存の同色ブロックに触れてはいけない（予定外の巻き込み消去の防止）
        if (board.touchesColor(bcells, color)) continue;

        // ---- 掃過セル（A から B までに P が占める全セル）。相棒はここに置けない ----
        const blocked = new Set();
        for (let i = 0; i <= t; i++) {
          for (const [x, y] of acells) blocked.add((y + d.y * i) * size + (x + d.x * i));
        }

        // ---- ストッパー: B+d に壁か既存ブロックがあるか ----
        const bset = cellSet(size, bcells);
        let stopped = false;
        const front = new Set();
        for (const [x, y] of bcells) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { stopped = true; continue; }
          const gi = ny * size + nx;
          if (bset.has(gi)) continue;
          if (board.grid[gi] !== -1) { stopped = true; continue; }
          front.add(gi);
        }

        // ---- 相棒ブロックを選ぶ ----
        const forbiddenAdj = addHalo(size, acells, new Set());
        const ctx = { size, color, shapes, blocked, forbiddenAdj };
        const partners = [];

        // ストッパーが無い場合、相棒のひとつが B の進行方向側を塞ぐ必要がある
        if (!stopped) {
          if (front.size === 0) continue;
          const q = findPartner(board, rng, ctx, front);
          if (!q) { budget -= 3; continue; }
          partners.push(q);
          for (const [x, y] of q.cells) blocked.add(y * size + x);
          addHalo(size, q.cells, forbiddenAdj);
        }

        // 残りの相棒は B の P に隣接していればどこでもよい
        const want = 1 + weightedIndex(rng, opts.partnerWeights);
        if (partners.length < want) {
          const halo = addHalo(size, bcells, new Set());
          for (const gi of bset) halo.delete(gi);
          while (partners.length < want) {
            const q = findPartner(board, rng, ctx, halo);
            if (!q) break;
            partners.push(q);
            for (const [x, y] of q.cells) blocked.add(y * size + x);
            addHalo(size, q.cells, forbiddenAdj);
          }
        }
        budget -= 4;
        if (partners.length === 0) continue;

        // ---- 確定。盤面に追加する ----
        const moving = board.addPiece(color, acells, placement.shape.name, placement.shape.parts);
        let cells = placement.shape.size;
        for (const q of partners) {
          board.addPiece(color, q.cells, q.shape.name, q.shape.parts);
          cells += q.shape.size;
        }

        return {
          pieceId: moving.id,
          dir,
          distance: t,
          color,
          cleared: partners.length + 1,
          cells,
        };
      }
    }
  }
  return null;
}

/** 1 回分の生成試行 */
function attemptBuild(seed, opts) {
  const rng = makeRng(seed);
  const board = new Board(opts.size);
  const solution = [];
  let misses = 0;

  while (solution.length < opts.maxSteps && board.filledCells < opts.targetCells) {
    const step = buildStep(board, rng, opts);
    if (!step) {
      misses++;
      if (misses >= 2) break;
      continue;
    }
    // 逆順に作っているので、新しいステップほど「先の手」になる
    solution.unshift(step);
  }

  return { board, solution };
}

/**
 * 解けることが構造的に保証されたパズルを生成する。
 * @returns {{seed:number, snapshot:object, solution:Array, par:number, cells:number, pieces:number, size:number, colors:number}}
 */
export function generatePuzzle(seed, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (!result) continue;
    if (!best || result.cells > best.cells) best = result;
    if (goodEnough(result, opts)) break;
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * generatePuzzle と同じものを、試行の合間にイベントループへ制御を返しながら作る。
 * 大きな連結ピースの盤面は生成に数百ミリ秒かかることがあるので、
 * UI 側はこちらを使って「生成中」を出しつつ画面を固めない。
 */
export async function generatePuzzleAsync(seed, options = {}, onProgress = null) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (result && (!best || result.cells > best.cells)) best = result;
    if (result && goodEnough(result, opts)) break;
    if (onProgress) onProgress((attempt + 1) / opts.attempts);
    // 2 試行ごとに 1 フレーム譲る
    if (attempt % 2 === 1) await new Promise((r) => setTimeout(r, 0));
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/** 1 回分の試行を回して、検証を通った結果だけ返す */
function runAttempt(seed, opts, attempt) {
  // 試行ごとにシードを派生させる（同じ seed なら常に同じ結果）
  const derived = (seed + attempt * 0x9e3779b1) >>> 0;
  const { board, solution } = attemptBuild(derived, opts);
  if (solution.length === 0) return null;

  const snapshot = board.snapshot();
  if (!verifySolution(snapshot, solution, opts.size).ok) return null;

  return {
    seed: seed >>> 0,
    snapshot,
    solution,
    par: solution.length,
    cells: board.filledCells,
    pieces: board.pieceCount,
    size: opts.size,
    colors: opts.colors,
  };
}

function goodEnough(result, opts) {
  return result.cells >= opts.targetCells - opts.acceptSlack && result.par >= opts.minPar;
}

/**
 * レベル番号からパズルを作る。
 * レベル -> シード -> 決定論的な生成、という一本道なので、
 * 同じレベルなら、どの端末でも必ず同じ譜面になる。
 */
export function generateLevel(level, overrides = {}) {
  const config = levelConfig(level);
  const classes = buildLevelClasses(config);
  const puzzle = generatePuzzle(levelSeed(config.level), levelOptions(config, classes, overrides));
  return { ...puzzle, level: config.level, config };
}

/** generateLevel の非同期版（画面を固めずに生成する） */
export async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  const config = levelConfig(level);
  const classes = buildLevelClasses(config);
  const puzzle = await generatePuzzleAsync(
    levelSeed(config.level),
    levelOptions(config, classes, overrides),
    onProgress,
  );
  return { ...puzzle, level: config.level, config };
}

function levelOptions(config, classes, overrides) {
  return {
    size: config.size,
    colors: config.colors,
    classes,
    targetCells: config.targetCells,
    minCells: config.minCells,
    acceptSlack: config.acceptSlack,
    maxSteps: config.maxSteps,
    minPar: config.minPar,
    partnerWeights: config.partnerWeights,
    attempts: config.attempts,
    ...overrides,
  };
}

/**
 * 生成された解答手順を前から実行して、本当に全消しできるか確かめる。
 * 生成ロジックのバグをここで必ず捕まえる（テストからも使用）。
 */
export function verifySolution(snapshot, solution, size = BOARD_SIZE) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }

  for (let i = 0; i < solution.length; i++) {
    const step = solution[i];
    if (!board.pieces.has(step.pieceId)) {
      return { ok: false, reason: `手 ${i + 1}: ブロックが存在しない` };
    }
    const before = board.pieceCount;
    const res = board.applyMove(step.pieceId, step.dir);
    if (!res) return { ok: false, reason: `手 ${i + 1}: 動かせない` };
    if (res.steps !== step.distance) {
      return { ok: false, reason: `手 ${i + 1}: 停止位置が想定と違う (${res.steps} != ${step.distance})` };
    }
    if (res.cleared.length !== step.cleared) {
      return { ok: false, reason: `手 ${i + 1}: 消去数が想定と違う (${res.cleared.length} != ${step.cleared})` };
    }
    if (board.pieceCount !== before - step.cleared) {
      return { ok: false, reason: `手 ${i + 1}: 盤面のブロック数が合わない` };
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

/** 生成器の内部関数（テスト用） */
export const __internals = { emptyPlacements, buildStep, attemptBuild };
