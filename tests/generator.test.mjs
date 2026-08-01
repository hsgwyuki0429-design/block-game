// パズル生成器のテスト。
// 「解けることが構造的に保証されている」という主張を、実際に解いて確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { generatePuzzle, verifySolution, clearableColors, analyzeSolution } from '../src/generator.js';
import { seedToCode, codeToSeed, hashSeed, makeRng } from '../src/rng.js';

const SEEDS = [1, 7, 42, 1234, 99991, 0xdeadbeef, 2654435761, 314159, 8675309, 20240731];

/** 既定より少しだけ大きい盤面（既定は 8×8 / 4色） */
const BIG = { size: 10, colors: 7 };

test('生成した問題は解答手順で必ず全消しできる', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const r = verifySolution(p.snapshot, p.solution, p.size);
    assert.equal(r.ok, true, `seed ${seed}: ${r.reason}`);
  }
});

test('初期盤面に同色の隣接はひとつも無い', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.equal(b.hasSameColorContact(), false, `seed ${seed}`);
  }
});

test('初期盤面から必ず何か手が指せる', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.ok(b.allMoves().length > 0, `seed ${seed}`);
  }
});

test('同じ色のブロックはちょうど2個ずつ、すべてテトロミノ', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    const counts = new Map();
    for (const piece of b.pieces.values()) {
      assert.equal(piece.cells.length, 4, `seed ${seed}`);
      counts.set(piece.color, (counts.get(piece.color) || 0) + 1);
    }
    for (const [color, n] of counts) {
      assert.equal(n, 2, `seed ${seed}: 色 ${color} が ${n} 個`);
    }
    assert.equal(b.pieceCount, p.colors * 2, `seed ${seed}`);
    assert.equal(b.filledCells, b.pieceCount * 4);
  }
});

test('PAR は色数と一致する（仕込み手が無いとき）', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    assert.equal(p.setupMoves, 0, `seed ${seed}`);
    assert.equal(p.par, p.colors, `seed ${seed}`);
  }
});

test('1手で消えるのはちょうど2ブロック（＝同色ペア）', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    for (const step of p.solution) {
      const res = b.applyMove(step.pieceId, step.dir);
      assert.equal(res.cleared.length, step.kind === 'setup' ? 0 : 2, `seed ${seed}`);
    }
  }
});

test('解答の各手は必ず1マス以上滑る', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const p = generatePuzzle(seed);
    for (const step of p.solution) assert.ok(step.distance >= 1);
  }
});

test('仕込み手を求めると、何も消さない手が解に混ざる', () => {
  const p = generatePuzzle(4242, { ...BIG, setupMoves: 2 });
  assert.ok(p.setupMoves > 0, '仕込み手がひとつも入らなかった');
  assert.equal(p.par, p.solution.length);
  assert.equal(p.par, p.colors + p.setupMoves);
  assert.equal(verifySolution(p.snapshot, p.solution, p.size).ok, true);
});

test('一本道を求めると、分岐のない解になる', () => {
  const p = generatePuzzle(31337, { ...BIG, forced: true });
  assert.equal(verifySolution(p.snapshot, p.solution, p.size).ok, true);
  assert.equal(p.analysis.forced, true);
  assert.equal(p.analysis.branchPoints, 0);
});

test('clearableColors は「いま消せる色」だけを返す', () => {
  const p = generatePuzzle(2718);
  const b = new Board(p.size);
  b.restore(p.snapshot);

  const colors = clearableColors(b);
  const fromMoves = new Set(b.findClearingMoves().map((m) => b.pieces.get(m.id).color));
  assert.deepEqual([...colors].sort(), [...fromMoves].sort());

  // limit を渡すと、その数まで数えたところで打ち切る
  if (colors.size >= 2) assert.equal(clearableColors(b, 1).size, 1);
});

test('analyzeSolution は初手の選択肢の数を返す', () => {
  const p = generatePuzzle(161803);
  const a = analyzeSolution(p.snapshot, p.solution, p.size);
  const b = new Board(p.size);
  b.restore(p.snapshot);
  assert.equal(a.clearAtStart, clearableColors(b).size);
});

test('同じシードからは常に同じ盤面が生まれる', () => {
  const a = generatePuzzle(123456);
  const b = generatePuzzle(123456);
  const ba = new Board(a.size); ba.restore(a.snapshot);
  const bb = new Board(b.size); bb.restore(b.snapshot);
  assert.equal(ba.fingerprint(), bb.fingerprint());
  assert.deepEqual(a.solution, b.solution);
});

test('違うシードからは違う盤面が生まれる', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    seen.add(b.fingerprint());
  }
  assert.equal(seen.size, SEEDS.length);
});

test('verifySolution は壊れた手順をきちんと弾く', () => {
  const p = generatePuzzle(42);

  // 最後の手を落とす -> 盤面が空にならない
  const truncated = p.solution.slice(0, -1);
  assert.equal(verifySolution(p.snapshot, truncated, p.size).ok, false);

  // 存在しないブロックを指す
  const bogus = p.solution.map((s, i) => (i === 0 ? { ...s, pieceId: 99999 } : s));
  assert.equal(verifySolution(p.snapshot, bogus, p.size).ok, false);

  // 手順を入れ替える（通路がまだ開いていないので破綻する）
  const swapped = p.solution.slice();
  [swapped[0], swapped[swapped.length - 1]] = [swapped[swapped.length - 1], swapped[0]];
  assert.equal(verifySolution(p.snapshot, swapped, p.size).ok, false);
});

test('verifySolution は「同じ色が2個」でない盤面を弾く', () => {
  const p = generatePuzzle(42);
  const broken = {
    ...p.snapshot,
    // 1個だけ色を書き換えると、その色が1個・元の色が3個になる
    pieces: p.snapshot.pieces.map((piece, i) => (i === 0 ? { ...piece, color: 900 } : piece)),
  };
  const r = verifySolution(broken, p.solution, p.size);
  assert.equal(r.ok, false);
  assert.match(r.reason, /2個であるべき/);
});

test('シードコードは往復変換できる', () => {
  for (const seed of [0, 1, 999, 0xffffffff, 123456789]) {
    assert.equal(codeToSeed(seedToCode(seed)), seed >>> 0);
  }
  assert.equal(typeof hashSeed('daily-2026-07-31'), 'number');
});

test('乱数はシード決定的', () => {
  const a = makeRng(7);
  const b = makeRng(7);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});

test('ヒント用の局面テーブルが解答の全ステップを覆う', () => {
  const p = generatePuzzle(31415);
  const sim = new Board(p.size);
  sim.restore(p.snapshot);
  const map = new Map();
  for (const step of p.solution) {
    map.set(sim.fingerprint(), step);
    sim.applyMove(step.pieceId, step.dir);
  }
  assert.equal(map.size, p.solution.length);
  assert.equal(sim.isEmpty, true);
});

test('解の途中のどの局面にも「消せる手」が必ず存在する', () => {
  const p = generatePuzzle(777);
  const b = new Board(p.size);
  b.restore(p.snapshot);
  for (const step of p.solution) {
    assert.ok(b.findClearingMoves().length > 0);
    b.applyMove(step.pieceId, step.dir);
  }
});
