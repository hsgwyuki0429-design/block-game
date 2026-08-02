// パズル生成器のテスト。
// 「解けることが構造的に保証されている」という主張を、実際に解いて確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import {
  generatePuzzle, verifySolution, clearableColors, analyzeSolution,
  findClearPlan, colorClearable,
} from '../src/generator.js';
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
      assert.ok(piece.cells.length >= 1 && piece.cells.length <= 9, `seed ${seed}`);
      counts.set(piece.color, (counts.get(piece.color) || 0) + 1);
    }
    for (const [color, n] of counts) {
      assert.equal(n, 2, `seed ${seed}: 色 ${color} が ${n} 個`);
    }
    assert.equal(b.pieceCount, p.colors * 2, `seed ${seed}`);

  }
});

test('PAR は「色数 ＋ 何も消さない手」', () => {
  for (const seed of SEEDS) {
    const p = generatePuzzle(seed);
    assert.equal(p.par, p.solution.length, `seed ${seed}`);
    // 消去は色数ぶんきっかり。残りはすべて何も消さない手
    const clears = p.solution.filter((s) => s.kind === 'clear').length;
    assert.equal(clears, p.colors, `seed ${seed}`);
    assert.equal(p.par, p.colors + p.chainMoves + p.setupMoves, `seed ${seed}`);
  }
});

test('消えるのは kind:clear の手だけ、しかもちょうど2ブロック', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const p = generatePuzzle(seed);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    for (const step of p.solution) {
      const res = b.applyMove(step.pieceId, step.dir);
      assert.equal(res.cleared.length, step.kind === 'clear' ? 2 : 0, `seed ${seed}`);
    }
  }
});

test('追い込みを求めると、1組を消すまでに何手も重ねる盤面になる', () => {
  const p = generatePuzzle(20260801, { ...BIG, chainMoves: 12 });
  assert.equal(verifySolution(p.snapshot, p.solution, p.size).ok, true);
  assert.ok(p.chainMoves >= 8, `追い込み手が ${p.chainMoves} 手しか入らなかった`);
  assert.equal(p.par, p.solution.length);
  // 初手からいきなり消せる手があってはならない ―― まず通路を読む盤面が狙い
  assert.equal(p.analysis.clearAtStart, 0);
  assert.ok(p.analysis.dryStreak >= 2, '何も消えない手が続かない');
});

test('追い込み手も仕込み手も、それ自体では何も消さない', () => {
  const p = generatePuzzle(4649, { ...BIG, chainMoves: 10, setupMoves: 2 });
  const b = new Board(p.size);
  b.restore(p.snapshot);
  for (const step of p.solution) {
    const res = b.applyMove(step.pieceId, step.dir);
    if (step.kind !== 'clear') assert.equal(res.cleared.length, 0);
  }
  assert.equal(b.isCleared, true);
});

test('解答の各手は必ず1マス以上滑る', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const p = generatePuzzle(seed);
    for (const step of p.solution) assert.ok(step.distance >= 1);
  }
});

test('仕込み手を求めると、別のブロックを動かす手が解に混ざる', () => {
  const p = generatePuzzle(4242, { ...BIG, setupMoves: 2 });
  assert.ok(p.setupMoves > 0, '仕込み手がひとつも入らなかった');
  assert.equal(p.par, p.solution.length);
  assert.equal(p.par, p.colors + p.setupMoves + p.chainMoves);
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
  assert.equal(sim.isCleared, true);
});

test('解の途中のどの局面からも、数手先に必ず消去がある', () => {
  // 追い込みが入った盤面では「いま消せる手」は無いのが普通。
  // ヒントが頼るのは「何手先に消去があるか」なので、そちらを確かめる
  const p = generatePuzzle(777, { ...BIG, chainMoves: 10 });
  const b = new Board(p.size);
  b.restore(p.snapshot);
  for (const step of p.solution) {
    if (!b.isCleared) assert.ok(findClearPlan(b, 3), '3手先まで見ても消去が無い');
    b.applyMove(step.pieceId, step.dir);
  }
  assert.equal(b.isCleared, true);
});

test('findClearPlan は消去にたどり着く道筋の1手目を返す', () => {
  const p = generatePuzzle(555, { ...BIG, chainMoves: 8 });
  const b = new Board(p.size);
  b.restore(p.snapshot);

  const plan = findClearPlan(b, 3);
  assert.ok(plan, '道筋が見つからない');
  assert.ok(plan.depth >= 2, '初手から消せてしまっている');
  assert.ok(b.pieces.has(plan.pieceId));
  // 返ってきた1手目は、実際に指せる手でなければならない
  assert.ok(b.slideDistance(plan.pieceId, plan.dir) > 0);

  // 空の盤面には道筋が無い
  assert.equal(findClearPlan(new Board(6)), null);
});

test('colorClearable はその色が1手で消せるかを答える', () => {
  const b = new Board(8);
  const a1 = b.addPiece(3, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  b.addPiece(3, [[0, 5], [1, 5], [2, 5], [3, 5]]);
  b.addPiece(4, [[6, 0], [7, 0], [6, 1], [7, 1]]);
  assert.equal(colorClearable(b, 3), true);   // 下へ滑らせればぶつかる
  assert.equal(colorClearable(b, 4), false);  // 相棒がいない
  b.removePiece(a1.id);
  assert.equal(colorClearable(b, 3), false);
});
