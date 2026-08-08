// 全探索エンジンのテスト。
//
// ここが間違っていると「最短 110 手」の看板が嘘になる。確かめるのは 3 つ:
//   ・距離マップが本当に最短手数か（素朴な幅優先探索と突き合わせる）
//   ・復元した手順が盤面の上で本当に通り、最後の1手でちょうど消えるか
//   ・同じ形のブロックをまとめる正規化が、盤面を取り違えていないか

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, BLOCKER } from '../src/board.js';
import { DIR_KEYS } from '../src/shapes.js';
import { layout, compile, positionsOf, Explorer, GREY_RECTS, COLOR_RECTS } from '../src/exact.js';
import { levelPuzzle } from '../src/generator.js';
import { encodeLevel, decodeLevel } from '../src/levelCodec.js';
import { makeRng, hashSeed } from '../src/rng.js';

/** Board をそのまま動かす素朴な幅優先探索。エンジンの答え合わせ用 */
function bruteForceDistance(board, cap = 60000) {
  const key = (b) => [...b.pieces.values()]
    .map((p) => `${p.color}:${p.cells.map(([x, y]) => `${x}.${y}`).join('-')}`)
    .sort()
    .join('|');

  const start = board.snapshot();
  const seen = new Map([[key(board), 0]]);
  let wave = [start];
  let depth = 0;
  while (wave.length && seen.size < cap) {
    const next = [];
    for (const snap of wave) {
      const b = new Board(board.size);
      b.restore(snap);
      for (const id of [...b.pieces.keys()]) {
        for (const dir of DIR_KEYS) {
          b.restore(snap);
          const res = b.applyMove(id, dir);
          if (!res) continue;
          if (res.cleared.length > 0) return depth + 1; // 触れた＝ゴール
          const k = key(b);
          if (seen.has(k)) continue;
          seen.set(k, depth + 1);
          next.push(b.snapshot());
        }
      }
    }
    wave = next;
    depth++;
  }
  return Infinity;
}

test('距離マップは本当に最短手数（素朴な探索と一致する）', () => {
  const ex = new Explorer(40000);
  let checked = 0;
  for (let i = 0; checked < 12 && i < 400; i++) {
    const rng = makeRng(hashSeed(`test/exact/${i}`));
    const built = layout(rng, { size: 5, free: 3, greyRects: GREY_RECTS, colorRects: COLOR_RECTS });
    if (!built) continue;
    if (!ex.run(compile(built.board, built.colorIds))) continue;
    if (ex.depth < 3) continue;

    for (const want of [2, Math.min(ex.depth, 5), ex.depth]) {
      const slots = ex.slotsAtDistance(want, 1, rng);
      if (!slots.length) continue;
      const puzzle = ex.puzzleAt(slots[0]);
      assert.ok(puzzle, '盤面を取り出せない');
      assert.equal(puzzle.optimal, want);

      const b = new Board(puzzle.size);
      for (const p of puzzle.pieces) b.addPiece(p.c, p.s);
      assert.equal(bruteForceDistance(b), want, `距離 ${want} の盤面が素朴な探索と食い違う`);
      checked++;
    }
  }
  assert.ok(checked >= 12, `${checked} 件しか確かめられていない`);
});

test('復元した手順は盤面の上で通り、最後の1手だけが消去になる', () => {
  const ex = new Explorer(60000);
  let checked = 0;
  for (let i = 0; checked < 20 && i < 600; i++) {
    const rng = makeRng(hashSeed(`test/path/${i}`));
    const built = layout(rng, { size: 6, free: 3 });
    if (!built) continue;
    if (!ex.run(compile(built.board, built.colorIds))) continue;
    if (ex.depth < 6) continue;

    const slots = ex.slotsAtDistance(ex.depth, 1, rng);
    if (!slots.length) continue;
    const puzzle = ex.puzzleAt(slots[0]);
    if (!puzzle) continue;

    const b = new Board(puzzle.size);
    for (const p of puzzle.pieces) b.addPiece(p.c, p.s);
    assert.equal(b.hasSameColorContact(), false, '初期盤面で既に触れている');
    assert.equal(puzzle.solution.length, ex.depth);

    puzzle.solution.forEach(([id, dir, distance], k) => {
      const res = b.applyMove(id, dir);
      assert.ok(res, `第${k + 1}手が指せない`);
      assert.equal(res.steps, distance, `第${k + 1}手の停止位置が違う`);
      const last = k === puzzle.solution.length - 1;
      assert.equal(res.cleared.length, last ? 2 : 0, `第${k + 1}手の消去数`);
    });
    assert.equal(b.isCleared, true);
    checked++;
  }
  assert.ok(checked >= 20, `${checked} 件しか確かめられていない`);
});

test('組んだ盤面は空きマス数ぴったりで、ブロックは 1×2 〜 3×3', () => {
  const rng = makeRng(hashSeed('test/layout'));
  let built = 0;
  for (let i = 0; i < 400; i++) {
    const size = 5 + (i % 4);
    const free = 3 + (i % 3);
    const r = layout(rng, { size, free });
    if (!r) continue;
    built++;
    assert.equal(size * size - r.board.filledCells, free, '空きマス数が合わない');
    assert.equal(r.colorIds.length, 2);
    for (const p of r.board.pieces.values()) {
      const xs = p.cells.map((c) => c[0]);
      const ys = p.cells.map((c) => c[1]);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      assert.equal(p.cells.length, w * h);
      assert.ok(w >= 1 && w <= 3 && h >= 1 && h <= 3, `${w}×${h} のブロック`);
      assert.ok(p.cells.length >= 2, '1マスのブロックがある');
    }
    // 色つき2個は組んだ時点で触れている（＝そこがゴール）
    const [a] = r.colorIds;
    assert.ok(r.board.colorGroup(a).length === 2, '色つき2個が触れていない');
  }
  assert.ok(built > 100, `${built} 枚しか組めていない`);
});

test('符号は往復しても壊れない', () => {
  const ex = new Explorer(40000);
  const rng = makeRng(hashSeed('test/codec'));
  let checked = 0;
  for (let i = 0; checked < 8 && i < 400; i++) {
    const built = layout(rng, { size: 6, free: 4 });
    if (!built) continue;
    if (!ex.run(compile(built.board, built.colorIds))) continue;
    if (ex.depth < 4) continue;
    const slots = ex.slotsAtDistance(ex.depth, 1, rng);
    if (!slots.length) continue;
    const puzzle = ex.puzzleAt(slots[0]);
    if (!puzzle) continue;

    const code = encodeLevel(puzzle);
    const back = decodeLevel(code);
    assert.equal(back.size, puzzle.size);
    assert.equal(back.cells, puzzle.cells);
    assert.equal(back.optimal, puzzle.optimal);
    assert.deepEqual(back.solution, puzzle.solution);
    assert.deepEqual(back.pieces.map((p) => p.s), puzzle.pieces.map((p) => p.s));
    assert.deepEqual(back.pieces.map((p) => p.c), puzzle.pieces.map((p) => p.c));
    // 色つきは必ず先頭2個、残りは全部灰色
    assert.equal(back.pieces.filter((p) => p.c !== BLOCKER).length, 2);
    checked++;
  }
  assert.ok(checked >= 8, `${checked} 件しか確かめられていない`);
});

test('符号は 1 レベル 1 文字列に収まる（読めない文字を混ぜない）', () => {
  const puzzle = {
    size: 6,
    pieces: [
      { c: 0, s: [[0, 0], [0, 1]] },
      { c: 0, s: [[3, 3], [4, 3], [3, 4], [4, 4]] },
      { c: BLOCKER, s: [[1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [2, 2]] },
    ],
    solution: [[3, 'left', 1], [2, 'up', 3], [1, 'right', 2]],
  };
  const code = encodeLevel(puzzle);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeLevel(code);
  assert.deepEqual(back.solution, puzzle.solution);
  assert.deepEqual(back.pieces.map((p) => p.s), puzzle.pieces.map((p) => p.s));
  assert.equal(back.cells, 2 + 4 + 6);
});

// ---------------------------------------------------------------- 遊んでいる最中の残り手数

/*
 * 焼いてある手順は最短の 1 本でしかないので、そこから外れると「あと何手か」が
 * 分からなくなる。遊んでいる最中に色を 1 手ずつ動かすには、**どの局面からでも**
 * 残り手数が引けないといけない ―― それが positionsOf + distanceOf の役目。
 */

test('生きている盤面から、その局面の残り手数がそのまま引ける', () => {
  const ex = new Explorer(120000);
  for (const lv of [1, 12, 60, 300]) {
    const pz = levelPuzzle(lv);
    const board = new Board(pz.size);
    board.restore(pz.snapshot);
    const colorIds = [...board.pieces.values()]
      .filter((p) => p.color !== BLOCKER).map((p) => p.id);

    const ctx = compile(board, colorIds);
    assert.ok(ex.run(ctx), `レベル${lv}: 距離を配りきれなかった`);

    // 初期盤面の残り手数は、焼いてある最短手数と一致するはず
    const at = () => ex.distanceOf(positionsOf(ctx, board, colorIds));
    assert.equal(at(), pz.par, `レベル${lv}: 初期の残り手数が par と違う`);

    // 手順どおりに指すと、1 手ごとにきっかり 1 ずつ減る
    for (let i = 0; i < pz.solution.length - 1; i++) {
      const step = pz.solution[i];
      board.applyMove(step.pieceId, step.dir);
      assert.equal(at(), pz.par - (i + 1), `レベル${lv}: ${i + 1}手目で残りがずれた`);
    }
  }
});

test('遠ざかる手を指すと残り手数は増える（色が戻る根拠）', () => {
  const ex = new Explorer(120000);
  const pz = levelPuzzle(40);
  const board = new Board(pz.size);
  board.restore(pz.snapshot);
  const colorIds = [...board.pieces.values()]
    .filter((p) => p.color !== BLOCKER).map((p) => p.id);
  const ctx = compile(board, colorIds);
  assert.ok(ex.run(ctx));

  const at = () => ex.distanceOf(positionsOf(ctx, board, colorIds));
  const start = at();
  // 「1 手指して戻す」を全通り試すと、必ず ±1 の範囲に収まる
  let sawFarther = false;
  for (const id of [...board.pieces.keys()]) {
    for (const dir of DIR_KEYS) {
      if (board.slideDistance(id, dir) <= 0) continue;
      const snap = board.snapshot();
      board.applyMove(id, dir);
      const d = at();
      board.restore(snap);
      assert.ok(d !== undefined, '指した先の局面が距離マップに無い');
      assert.ok(Math.abs(d - start) <= 1, `1 手で ${Math.abs(d - start)} も動いた`);
      if (d > start) sawFarther = true;
    }
  }
  assert.ok(sawFarther, '遠ざかる手がひとつも無い盤面では試験にならない');
  assert.equal(at(), start, '試したあとに盤面が元へ戻っていない');
});

test('ブロックを入れ替えただけの盤面は、同じ局面として同じ残り手数になる', () => {
  const ex = new Explorer(120000);
  const pz = levelPuzzle(60);
  const board = new Board(pz.size);
  board.restore(pz.snapshot);
  const colorIds = [...board.pieces.values()]
    .filter((p) => p.color !== BLOCKER).map((p) => p.id);
  const ctx = compile(board, colorIds);
  assert.ok(ex.run(ctx));
  const base = ex.distanceOf(positionsOf(ctx, board, colorIds));

  // 同じ形の灰色ブロック 2 個を入れ替えても、盤面の見た目は変わらない
  const greys = [...board.pieces.values()].filter((p) => p.color === BLOCKER);
  const pair = [];
  for (let i = 0; i < greys.length && pair.length < 2; i++) {
    for (let j = i + 1; j < greys.length; j++) {
      const a = greys[i];
      const b = greys[j];
      if (a.shape === b.shape) { pair.push(a, b); break; }
    }
  }
  if (pair.length < 2) return; // 同形が無い盤面ならこの試験は成り立たない
  const cellsA = pair[0].cells.map(([x, y]) => [x, y]);
  const cellsB = pair[1].cells.map(([x, y]) => [x, y]);
  pair[0].cells = cellsB;
  pair[1].cells = cellsA;
  assert.equal(ex.distanceOf(positionsOf(ctx, board, colorIds)), base,
    '同形を入れ替えただけで別の局面になっている');
});
