// 厳密生成 ―「いちばん遠い盤面」を全探索で選ぶ
//
// これまでの逆順構築は「解ける手順があること」しか保証していなかった。実測すると
// PAR 106手の盤面が20手で解けていた ―― 表示していた手数が嘘だった。
//
// ここでは作り方を裏返す:
//
//   1. 色つき 1×2 を2個、接触させて置く（＝解けた瞬間の形）
//   2. 灰色ブロックを目標の埋め率まで敷く
//   3. そこから到達できる盤面を**全部**列挙する
//   4. 「2個が接触している盤面」すべてを始点に、後ろ向きの幅優先探索で
//      各盤面のゴールまでの距離を配る
//   5. いちばん遠い盤面を初期配置にする
//
// こうすると PAR が推定ではなく**厳密な最短手数**になる。近道は原理的に存在しない。
//
// 全探索が現実的なのは「空きマスが少ない」ときだけ。埋め率9割なら状態数は数万で
// 収まり、5割まで下げると数億に爆発して計算できない ―― 高い埋め率は難易度にも
// 計算量にも都合がよい、という珍しい組み合わせになっている。

import { Board, BLOCKER } from './board.js';
import { DIRS, DIR_KEYS } from './shapes.js';
import { makeRng } from './rng.js';

/** 灰色に使う長方形。大きいほど通路をふさぎ、状態数も減って探索できる */
export const GREY_RECTS = [[2, 2], [3, 2], [2, 3], [3, 1], [1, 3]];

/** 色つきは 1×2 固定 */
const COLOR_SHAPE = [[0, 0], [0, 1]];

const rectCells = (w, h) => {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([x, y]);
  return out;
};

/**
 * 盤面を組む。色つき2個を接触させて置き、残りを灰色で埋める。
 * @returns {{board: Board, colorIds: number[]}|null}
 */
function layout(rng, size, fillTarget, greyRects) {
  const board = new Board(size);
  const free = (x, y) => x >= 0 && y >= 0 && x < size && y < size && board.grid[y * size + x] === -1;

  // 色つき 1×2 を横に並べて接触させる
  let colorIds = null;
  for (let t = 0; t < 400 && !colorIds; t++) {
    const x = Math.floor(rng() * (size - 1));
    const y = Math.floor(rng() * (size - 1));
    if (free(x, y) && free(x, y + 1) && free(x + 1, y) && free(x + 1, y + 1)) {
      const a = board.addPiece(0, [[x, y], [x, y + 1]], '1x2');
      const b = board.addPiece(0, [[x + 1, y], [x + 1, y + 1]], '1x2');
      colorIds = [a.id, b.id];
    }
  }
  if (!colorIds) return null;

  const total = size * size;
  for (let t = 0; t < 3000 && board.filledCells / total < fillTarget; t++) {
    const [w, h] = greyRects[Math.floor(rng() * greyRects.length)];
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const cells = rectCells(w, h).map(([i, j]) => [x + i, y + j]);
    if (!cells.every(([cx, cy]) => free(cx, cy))) continue;
    board.addPiece(BLOCKER, cells, `${w}x${h}`);
  }
  return { board, colorIds };
}

/**
 * 盤面の状態を「アンカー位置の並び」で扱う軽い表現に落とす。
 * 形は動かないので、位置だけ持てば足りる。
 */
function compile(board, colorIds) {
  const size = board.size;
  const ids = [...board.pieces.keys()];
  // 色つき2個を先頭に固定しておくと、接触判定が速い
  ids.sort((a, b) => (colorIds.includes(b) ? 1 : 0) - (colorIds.includes(a) ? 1 : 0) || a - b);

  const shapes = ids.map((id) => {
    const cells = board.pieces.get(id).cells;
    const ax = Math.min(...cells.map((c) => c[0]));
    const ay = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => [x - ax, y - ay]);
  });
  const start = ids.map((id) => {
    const cells = board.pieces.get(id).cells;
    return Math.min(...cells.map((c) => c[0])) + Math.min(...cells.map((c) => c[1])) * size;
  });

  // 同じ形の灰色は入れ替えても同じ盤面。別物として数えると状態数が階乗で爆発する
  const shapeKey = shapes.map((s) => s.map(([x, y]) => `${x},${y}`).join(' '));
  const groups = new Map();
  for (let k = 2; k < ids.length; k++) {
    if (!groups.has(shapeKey[k])) groups.set(shapeKey[k], []);
    groups.get(shapeKey[k]).push(k);
  }
  const encode = (st) => {
    let key = `${st[0]}/${st[1]}`;
    for (const [sk, idx] of groups) {
      key += `|${sk}:${idx.map((k) => st[k]).sort((a, b) => a - b).join(',')}`;
    }
    return key;
  };

  return { size, ids, shapes, start, encode, n: ids.length };
}

/** 占有マップ（skip のブロックだけ除く） */
function occupancy(ctx, st, skip) {
  const { size, shapes, n } = ctx;
  const occ = new Uint8Array(size * size);
  for (let k = 0; k < n; k++) {
    if (k === skip) continue;
    const ax = st[k] % size;
    const ay = (st[k] - ax) / size;
    for (const [sx, sy] of shapes[k]) occ[(ay + sy) * size + (ax + sx)] = 1;
  }
  return occ;
}

/** k 番のブロックを dir へ滑らせたときに進めるマス数 */
function slide(ctx, st, k, dir, occ) {
  const { size, shapes } = ctx;
  const d = DIRS[dir];
  const ax = st[k] % size;
  const ay = (st[k] - ax) / size;
  let steps = 0;
  for (let n = 1; n <= size; n++) {
    let ok = true;
    for (const [sx, sy] of shapes[k]) {
      const nx = ax + sx + d.x * n;
      const ny = ay + sy + d.y * n;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) { ok = false; break; }
      if (occ[ny * size + nx]) { ok = false; break; }
    }
    if (!ok) break;
    steps = n;
  }
  return steps;
}

/** 色つき2個が接触しているか */
function touching(ctx, st) {
  const { size, shapes } = ctx;
  const set = new Set();
  const bx = st[1] % size;
  const by = (st[1] - bx) / size;
  for (const [sx, sy] of shapes[1]) set.add((by + sy) * size + (bx + sx));
  const ax = st[0] % size;
  const ay = (st[0] - ax) / size;
  for (const [sx, sy] of shapes[0]) {
    const x = ax + sx;
    const y = ay + sy;
    for (const key of DIR_KEYS) {
      const d = DIRS[key];
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && set.has(ny * size + nx)) return true;
    }
  }
  return false;
}

/**
 * 到達できる盤面を全部列挙し、ゴール（接触状態）までの距離を配る。
 * @returns {{dist: Map<string, number>, states: Map<string, number[]>, best: number[], depth: number}|null}
 */
function explore(ctx, cap) {
  const states = new Map([[ctx.encode(ctx.start), ctx.start]]);
  let frontier = [ctx.start];
  while (frontier.length) {
    const next = [];
    for (const st of frontier) {
      for (let k = 0; k < ctx.n; k++) {
        const occ = occupancy(ctx, st, k);
        for (const dir of DIR_KEYS) {
          const steps = slide(ctx, st, k, dir, occ);
          if (steps <= 0) continue;
          const ns = st.slice();
          ns[k] = st[k] + (DIRS[dir].y * ctx.size + DIRS[dir].x) * steps;
          const key = ctx.encode(ns);
          if (states.has(key)) continue;
          states.set(key, ns);
          next.push(ns);
          if (states.size > cap) return null; // 広すぎる。全探索は諦める
        }
      }
    }
    frontier = next;
  }

  // 接触している盤面すべてを始点に、後ろ向きへ距離を配る
  const dist = new Map();
  let wave = [];
  for (const [key, st] of states) {
    if (touching(ctx, st)) { dist.set(key, 0); wave.push(st); }
  }
  if (wave.length === 0) return null;

  let depth = 0;
  let best = null;
  while (wave.length) {
    depth++;
    const next = [];
    for (const st of wave) {
      for (let k = 0; k < ctx.n; k++) {
        const occ = occupancy(ctx, st, k);
        for (const dir of DIR_KEYS) {
          const d = DIRS[dir];
          // st[k] で「ちょうど止まる」＝進行方向側が塞がっている必要がある
          const ax = st[k] % ctx.size;
          const ay = (st[k] - ax) / ctx.size;
          let stops = false;
          for (const [sx, sy] of ctx.shapes[k]) {
            const nx = ax + sx + d.x;
            const ny = ay + sy + d.y;
            if (nx < 0 || ny < 0 || nx >= ctx.size || ny >= ctx.size) { stops = true; break; }
            if (occ[ny * ctx.size + nx]) { stops = true; break; }
          }
          if (!stops) continue;

          for (let t = 1; t <= ctx.size; t++) {
            let ok = true;
            for (const [sx, sy] of ctx.shapes[k]) {
              const px = ax + sx - d.x * t;
              const py = ay + sy - d.y * t;
              if (px < 0 || py < 0 || px >= ctx.size || py >= ctx.size) { ok = false; break; }
              if (occ[py * ctx.size + px]) { ok = false; break; }
            }
            if (!ok) break;
            const ps = st.slice();
            ps[k] = st[k] - (d.y * ctx.size + d.x) * t;
            const key = ctx.encode(ps);
            if (!states.has(key) || dist.has(key)) continue;
            dist.set(key, depth);
            best = ps;
            next.push(ps);
          }
        }
      }
    }
    if (next.length) wave = next;
    else break;
  }
  if (!best) return null;
  return { dist, states, best, depth: dist.get(ctx.encode(best)) };
}

/** 距離が1ずつ減る手をたどって、最短手順を復元する */
function reconstruct(ctx, dist, from) {
  const path = [];
  let st = from;
  let d = dist.get(ctx.encode(st));
  while (d > 0) {
    let moved = false;
    for (let k = 0; k < ctx.n && !moved; k++) {
      const occ = occupancy(ctx, st, k);
      for (const dir of DIR_KEYS) {
        const steps = slide(ctx, st, k, dir, occ);
        if (steps <= 0) continue;
        const ns = st.slice();
        ns[k] = st[k] + (DIRS[dir].y * ctx.size + DIRS[dir].x) * steps;
        const nd = dist.get(ctx.encode(ns));
        if (nd !== d - 1) continue;
        path.push({ index: k, dir, distance: steps });
        st = ns;
        d = nd;
        moved = true;
        break;
      }
    }
    if (!moved) return null; // 起こらないはずだが、念のため
  }
  return path;
}

/**
 * 厳密生成の本体。
 * @returns {{board: Board, solution: object[], optimal: number, states: number}|null}
 */
export function generateExactPuzzle(seed, options = {}) {
  const { size = 6, fill = 0.89, greyRects = GREY_RECTS, cap = 200000, tries = 24 } = options;
  const rng = makeRng(seed);

  let best = null;
  for (let t = 0; t < tries; t++) {
    const built = layout(rng, size, fill, greyRects);
    if (!built) continue;
    const ctx = compile(built.board, built.colorIds);
    const found = explore(ctx, cap);
    if (!found) continue;
    if (!best || found.depth > best.found.depth) best = { built, ctx, found };
  }
  if (!best) return null;

  const { built, ctx, found } = best;
  const path = reconstruct(ctx, found.dist, found.best);
  if (!path) return null;

  // いちばん遠い盤面を初期配置として書き戻す
  const board = built.board;
  for (let k = 0; k < ctx.n; k++) {
    const id = ctx.ids[k];
    const piece = board.pieces.get(id);
    for (const [x, y] of piece.cells) board.grid[y * board.size + x] = -1;
    const ax = found.best[k] % ctx.size;
    const ay = (found.best[k] - ax) / ctx.size;
    piece.cells = ctx.shapes[k].map(([sx, sy]) => [ax + sx, ay + sy]);
    for (const [x, y] of piece.cells) board.grid[y * board.size + x] = id;
  }

  const solution = path.map((m) => ({
    pieceId: ctx.ids[m.index],
    dir: m.dir,
    distance: m.distance,
    color: board.pieces.get(ctx.ids[m.index]).color,
    kind: m.index < 2 && false ? 'clear' : 'chain',
  }));
  // 最後の1手だけが消去
  if (solution.length) solution[solution.length - 1].kind = 'clear';

  return { board, solution, optimal: found.depth, states: found.states.size };
}
