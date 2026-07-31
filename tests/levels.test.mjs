// レベル進行のテスト。
// 「レベルが上がるほど盤面が広く・ブロックが複雑になる」「どのレベルも必ず解ける」
// 「同じレベルならどの端末でも同じ譜面」を確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { generateLevel, verifySolution } from '../src/generator.js';
import {
  levelConfig, levelSeed, boardSizeForLevel, shapeMixForLevel,
  buildLevelClasses, MIN_SIZE, MAX_SIZE, MAX_COMPLEXITY_LEVEL,
} from '../src/levels.js';
import { makeCompoundShape, rotationsOfShape, TETROMINOES } from '../src/shapes.js';
import { makeRng } from '../src/rng.js';

/** 通しで確かめるレベル（全部やると遅いので代表点を拾う） */
const SAMPLE = [1, 2, 3, 5, 7, 10, 13, 17, 21, 24, 26, 30, 36, 42, 46, 60, 120];

test('盤面はレベル1で4×4、上がるほど広がり、12×12で頭打ち', () => {
  assert.equal(boardSizeForLevel(1), MIN_SIZE);
  assert.equal(boardSizeForLevel(26), MAX_SIZE);
  assert.equal(boardSizeForLevel(1000), MAX_SIZE);

  let prev = 0;
  for (let lv = 1; lv <= 200; lv++) {
    const size = boardSizeForLevel(lv);
    assert.ok(size >= prev, `Lv${lv}: 盤面が縮んだ`);
    assert.ok(size >= MIN_SIZE && size <= MAX_SIZE);
    prev = size;
  }
});

test('ブロックの複雑さは テトロミノ -> 2個つなぎ -> 3個つなぎ と進む', () => {
  // 序盤は素のテトロミノだけ
  for (const lv of [1, 5, 10, 12]) {
    const m = shapeMixForLevel(lv);
    assert.equal(m.single, 1, `Lv${lv}`);
    assert.equal(m.double, 0);
    assert.equal(m.triple, 0);
  }
  // 中盤で2個つなぎが混ざる
  const mid = shapeMixForLevel(18);
  assert.ok(mid.single > 0 && mid.double > 0 && mid.triple === 0);
  // 最終的に全部3個つなぎ
  for (const lv of [MAX_COMPLEXITY_LEVEL, 100, 5000]) {
    const m = shapeMixForLevel(lv);
    assert.equal(m.triple, 1, `Lv${lv}`);
    assert.equal(m.single, 0);
    assert.equal(m.double, 0);
  }
  // 配合比は常に合計 1
  for (let lv = 1; lv <= 200; lv++) {
    const m = shapeMixForLevel(lv);
    assert.ok(Math.abs(m.single + m.double + m.triple - 1) < 1e-9, `Lv${lv}`);
  }
});

test('3個つなぎは「テトロミノ3個ぶん」= 12セルで、辺で繋がっている', () => {
  const rng = makeRng(1234);
  for (let i = 0; i < 40; i++) {
    for (const parts of [2, 3]) {
      const shape = makeCompoundShape(rng, parts, 11);
      assert.ok(shape, 'ピースを作れなかった');
      assert.equal(shape.cells.length, parts * 4);
      // 何番目のテトロミノ由来か（parts）は cells と同じ長さで、parts 種類ある
      assert.equal(shape.parts.length, shape.cells.length);
      assert.equal(new Set(shape.parts).size, parts);
      // 各パートはちょうど4セル
      for (let p = 0; p < parts; p++) {
        assert.equal(shape.parts.filter((v) => v === p).length, 4);
      }
      // 全体が上下左右で1つに繋がっている
      assert.ok(isConnected(shape.cells), '連結していない');
      assert.ok(shape.w <= 11 && shape.h <= 11);
    }
  }
});

test('回転してもセル数・パート構成は保たれる', () => {
  const rng = makeRng(99);
  const shape = makeCompoundShape(rng, 3, 11);
  for (const rot of rotationsOfShape(shape)) {
    assert.equal(rot.cells.length, 12);
    assert.equal(rot.parts.length, 12);
    assert.equal(new Set(rot.parts).size, 3);
    assert.ok(isConnected(rot.cells));
  }
});

test('レベルのブロック集合は配合比どおりのクラスを持つ', () => {
  const early = buildLevelClasses(levelConfig(3));
  assert.equal(early.length, 1);
  assert.equal(early[0].kind, 'single');
  assert.equal(early[0].shapes, TETROMINOES);

  const late = buildLevelClasses(levelConfig(100));
  assert.equal(late.length, 1);
  assert.equal(late[0].kind, 'triple');
  for (const s of late[0].shapes) assert.equal(s.cells.length, 12);

  const mid = buildLevelClasses(levelConfig(18));
  assert.deepEqual(mid.map((c) => c.kind).sort(), ['double', 'single']);
});

test('どのレベルも解答手順で必ず全消しできる', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const r = verifySolution(p.snapshot, p.solution, p.size);
    assert.equal(r.ok, true, `Lv${lv}: ${r.reason}`);
  }
});

test('どのレベルも初期盤面に同色隣接が無く、いきなり詰んでいない', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.equal(b.hasSameColorContact(), false, `Lv${lv}`);
    assert.equal(b.isDeadlock(), false, `Lv${lv}`);
  }
});

test('盤面のブロックはレベルの想定サイズだけで構成される', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    const allowed = new Set();
    if (p.config.mix.single > 0.001) allowed.add(4);
    if (p.config.mix.double > 0.001) allowed.add(8);
    if (p.config.mix.triple > 0.001) allowed.add(12);
    for (const piece of b.pieces.values()) {
      assert.ok(allowed.has(piece.cells.length), `Lv${lv}: ${piece.cells.length}セルのブロック`);
      assert.equal(piece.parts.length, piece.cells.length);
    }
    assert.equal(b.size, p.config.size);
  }
});

test('同じレベルなら、どの端末でも同じ譜面になる', () => {
  for (const lv of [1, 9, 22, 47]) {
    const a = generateLevel(lv);
    const b = generateLevel(lv);
    const ba = new Board(a.size); ba.restore(a.snapshot);
    const bb = new Board(b.size); bb.restore(b.snapshot);
    assert.equal(ba.fingerprint(), bb.fingerprint(), `Lv${lv}`);
    assert.deepEqual(a.solution, b.solution);
    assert.equal(levelSeed(lv), levelSeed(lv));
  }
});

test('違うレベルは違う譜面になる', () => {
  const seen = new Set();
  for (let lv = 1; lv <= 12; lv++) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    seen.add(b.fingerprint());
  }
  assert.equal(seen.size, 12);
});

test('レベル1は1手で解ける入門用', () => {
  const p = generateLevel(1);
  assert.equal(p.size, 4);
  assert.equal(p.par, 1);
  assert.ok(p.pieces >= 2);
});

test('連結ピースは盤面内で必ず1マス以上滑れる大きさに収まる', () => {
  for (const lv of [26, 40, 60, 200]) {
    const cfg = levelConfig(lv);
    for (const cls of buildLevelClasses(cfg)) {
      for (const shape of cls.shapes) {
        assert.ok(shape.w < cfg.size, `Lv${lv}: 幅 ${shape.w} が盤面 ${cfg.size} に対して広すぎる`);
        assert.ok(shape.h < cfg.size, `Lv${lv}: 高さ ${shape.h} が盤面 ${cfg.size} に対して高すぎる`);
      }
    }
  }
});

test('レベル番号が不正でもレベル1として扱う', () => {
  for (const bad of [0, -5, 0.4, NaN]) {
    assert.equal(levelConfig(bad).level, 1);
  }
});

/** セル群が上下左右で1つに繋がっているか */
function isConnected(cells) {
  const key = ([x, y]) => `${x},${y}`;
  const all = new Set(cells.map(key));
  const seen = new Set([key(cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (all.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === cells.length;
}
