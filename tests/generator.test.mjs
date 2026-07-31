// パズル生成器のテスト。
// 「解けることが構造的に保証されている」という主張を、実際に解いて確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { generatePuzzle, verifySolution, DEFAULT_OPTIONS } from '../src/generator.js';
import { seedToCode, codeToSeed, hashSeed, makeRng } from '../src/rng.js';

const SEEDS = [1, 7, 42, 1234, 99991, 0xdeadbeef, 2654435761, 314159, 8675309, 20240731];

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

test('初期盤面はいきなり詰んでいない', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.equal(b.isDeadlock(), false, `seed ${seed}`);
  }
});

test('埋め率と手数が設計値のレンジに収まる', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    const total = p.size * p.size;
    assert.ok(p.cells >= DEFAULT_OPTIONS.minCells, `seed ${seed}: ${p.cells} セルは少なすぎる`);
    assert.ok(p.cells / total >= 0.7, `seed ${seed}: 埋め率 ${(p.cells / total * 100).toFixed(1)}%`);
    assert.ok(p.cells / total <= 0.92, `seed ${seed}: 埋め率 ${(p.cells / total * 100).toFixed(1)}%`);
    assert.ok(p.par >= 8 && p.par <= DEFAULT_OPTIONS.maxSteps, `seed ${seed}: PAR ${p.par}`);
  }
});

test('すべてのブロックがテトロミノ（4セル）', () => {
  const p = generatePuzzle(20240731);
  const b = new Board(p.size);
  b.restore(p.snapshot);
  for (const piece of b.pieces.values()) assert.equal(piece.cells.length, 4);
  assert.equal(b.filledCells, b.pieceCount * 4);
});

test('1手で消えるのは常に2ブロック以上（= 8セル以上）', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const p = generatePuzzle(seed);
    for (const step of p.solution) assert.ok(step.cleared >= 2, `seed ${seed}`);
  }
});

test('解答の各手は必ず1マス以上滑る', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const p = generatePuzzle(seed);
    for (const step of p.solution) assert.ok(step.distance >= 1);
  }
});

test('同じシードからは常に同じ盤面が生まれる（デイリー用）', () => {
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
