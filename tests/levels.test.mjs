// レベル進行のテスト。
// 「レベルが上がるほど盤面が広く・色が増える」「ブロックはテトロミノだけ」
// 「同じ色はちょうど2個」「どのレベルも必ず解ける」
// 「同じレベルならどの端末でも同じ譜面」を確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { generateLevel, verifySolution, clearableColors } from '../src/generator.js';
import {
  levelConfig, levelSeed, levelSummary, boardSizeForLevel, boardSizeForColors,
  colorsForLevel, setupMovesForLevel, requiresForcedLine,
  MIN_SIZE, MAX_SIZE, MAX_COLORS,
} from '../src/levels.js';
import { TETROMINOES } from '../src/shapes.js';

/** 通しで確かめるレベル（全部やると遅いので代表点を拾う） */
const SAMPLE = [1, 2, 3, 5, 7, 10, 13, 17, 21, 24, 26, 30, 42, 60, 120];

test('盤面はレベル1で4×4、上がるほど広がり、12×12で頭打ち', () => {
  assert.equal(boardSizeForLevel(1), MIN_SIZE);
  assert.equal(boardSizeForLevel(1000), MAX_SIZE);

  let prev = 0;
  for (let lv = 1; lv <= 200; lv++) {
    const size = boardSizeForLevel(lv);
    assert.ok(size >= prev, `Lv${lv}: 盤面が縮んだ`);
    assert.ok(size >= MIN_SIZE && size <= MAX_SIZE);
    prev = size;
  }
});

test('色数はレベル1で1色、上がるほど増え、上限で頭打ち', () => {
  assert.equal(colorsForLevel(1), 1);

  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const n = colorsForLevel(lv);
    assert.ok(n >= prev, `Lv${lv}: 色数が減った`);
    assert.ok(n >= 1 && n <= MAX_COLORS);
    prev = n;
  }
  assert.equal(colorsForLevel(1000), MAX_COLORS);
});

test('色数の上限は最大盤面に収まる（色数×2ブロック×4マス）', () => {
  assert.ok(MAX_COLORS * 8 < MAX_SIZE * MAX_SIZE * 0.7, '最大色数が盤面に対して詰まりすぎ');
  assert.equal(boardSizeForColors(MAX_COLORS), MAX_SIZE);
});

test('仕込み手と一本道は、あるレベルから先で加わる', () => {
  assert.equal(setupMovesForLevel(1), 0);
  assert.equal(requiresForcedLine(1), false);

  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const n = setupMovesForLevel(lv);
    assert.ok(n >= prev, `Lv${lv}: 仕込み手が減った`);
    prev = n;
  }
  assert.ok(setupMovesForLevel(100) > 0, '上のレベルで仕込み手が入らない');
  assert.equal(requiresForcedLine(100), true);
  // 一本道は「一度始まったら戻らない」
  let seen = false;
  for (let lv = 1; lv <= 300; lv++) {
    const f = requiresForcedLine(lv);
    if (f) seen = true;
    else assert.equal(seen, false, `Lv${lv}: 一本道が取り消された`);
  }
});

test('PAR は 色数 + 仕込み手', () => {
  for (const lv of [1, 5, 13, 24, 60]) {
    const cfg = levelConfig(lv);
    assert.equal(cfg.par, cfg.colors + cfg.setupMoves);
    assert.equal(cfg.pieces, cfg.colors * 2);
  }
});

test('どのレベルも解答手順で必ず全消しできる', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const r = verifySolution(p.snapshot, p.solution, p.size);
    assert.equal(r.ok, true, `Lv${lv}: ${r.reason}`);
  }
});

test('どのレベルも初期盤面に同色隣接が無く、少なくとも1手は指せる', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.equal(b.hasSameColorContact(), false, `Lv${lv}`);
    assert.ok(b.allMoves().length > 0, `Lv${lv}: 1手も指せない`);
  }
});

test('ブロックはテトロミノだけで、同じ色はちょうど2個ずつ', () => {
  const shapeNames = new Set(TETROMINOES.map((s) => s.name));
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);

    const counts = new Map();
    for (const piece of b.pieces.values()) {
      assert.equal(piece.cells.length, 4, `Lv${lv}: ${piece.cells.length}セルのブロック`);
      assert.ok(shapeNames.has(piece.shape), `Lv${lv}: 未知の形 ${piece.shape}`);
      counts.set(piece.color, (counts.get(piece.color) || 0) + 1);
    }
    assert.equal(counts.size, p.config.colors, `Lv${lv}: 色数が違う`);
    for (const [color, n] of counts) {
      assert.equal(n, 2, `Lv${lv}: 色 ${color} が ${n} 個`);
    }
    assert.equal(b.size, p.config.size);
  }
});

test('仕込み手を求めるレベルでは、初手に「消せる手」が無い盤面を狙う', () => {
  // 生成は最善を尽くすが必ず成功するとは限らない。代表点の大半で成り立てばよい
  const levels = [18, 23, 28, 33, 40, 50, 60];
  let ok = 0;
  for (const lv of levels) {
    const p = generateLevel(lv);
    assert.ok(p.config.setupMoves > 0, `Lv${lv}: 仕込み手が設定されていない`);
    if (p.analysis.clearAtStart === 0) ok++;
  }
  assert.ok(ok >= levels.length - 2, `仕込み必須の盤面が ${ok}/${levels.length} しか作れていない`);
});

test('一本道を求めるレベルでは、実際にほぼ分岐が無い', () => {
  const levels = [16, 20, 25, 35, 45, 70];
  let ok = 0;
  for (const lv of levels) {
    const p = generateLevel(lv);
    assert.equal(p.config.forced, true, `Lv${lv}: 一本道が設定されていない`);
    if (p.analysis.forced) ok++;
  }
  assert.ok(ok >= levels.length - 2, `一本道の盤面が ${ok}/${levels.length} しか作れていない`);
});

test('消える色は「消せる色」の集合と一致する', () => {
  const p = generateLevel(9);
  const b = new Board(p.size);
  b.restore(p.snapshot);
  const colors = clearableColors(b);
  for (const c of colors) {
    // その色が実際に消せることを、盤面のコピーで確かめる
    const found = b.findClearingMoves().some((m) => b.pieces.get(m.id).color === c);
    assert.ok(found, `色 ${c} が消せると報告されたが手が無い`);
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

test('レベル1は1色2個・1手で解ける入門用', () => {
  const p = generateLevel(1);
  assert.equal(p.size, 4);
  assert.equal(p.par, 1);
  assert.equal(p.colors, 1);
  assert.equal(p.pieces, 2);
});

test('レベルの要約は主要なパラメータを含む', () => {
  const s = levelSummary(levelConfig(60));
  const cfg = levelConfig(60);
  assert.match(s, new RegExp(`${cfg.size}×${cfg.size}`));
  assert.match(s, new RegExp(`${cfg.colors}色`));
  assert.match(s, /一本道/);
});

test('レベル番号が不正でもレベル1として扱う', () => {
  for (const bad of [0, -5, 0.4, NaN, undefined, 'abc']) {
    assert.equal(levelConfig(bad).level, 1);
  }
});
