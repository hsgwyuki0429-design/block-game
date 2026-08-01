// レベル進行のテスト。
// 「レベルが上がるほど盤面が広く・色が増え・追い込みが深くなる」
// 「ブロックはテトロミノだけ」「同じ色はちょうど2個」「どのレベルも必ず解ける」
// 「初手からは何も消せない（＝スライドを重ねないと1個も消えない）」
// 「同じレベルならどの端末でも同じ譜面」を確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { generateLevel, verifySolution, clearableColors, findClearPlan } from '../src/generator.js';
import {
  levelConfig, levelSeed, levelSummary, puzzleSummary, boardSizeForLevel, boardSizeForColors,
  colorsForLevel, chainDepthForLevel, chainMovesForLevel, setupMovesForLevel,
  targetTimes, starsForTime, formatTime,
  MIN_SIZE, MAX_SIZE, MAX_COLORS, MAX_CHAIN_DEPTH, MAX_CHAIN_MOVES,
} from '../src/levels.js';
import { TETROMINOES } from '../src/shapes.js';

/** 通しで確かめるレベル（全部やると遅いので代表点を拾う） */
const SAMPLE = [1, 2, 3, 5, 7, 10, 13, 17, 21, 24, 26, 30, 42, 60, 120];

test('盤面はレベル1で最小、上がるほど広がり、12×12で頭打ち', () => {
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

test('色数はレベル1で2色、上がるほど増え、上限で頭打ち', () => {
  assert.equal(colorsForLevel(1), 2);

  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const n = colorsForLevel(lv);
    assert.ok(n >= prev, `Lv${lv}: 色数が減った`);
    assert.ok(n >= 2 && n <= MAX_COLORS);
    prev = n;
  }
  assert.equal(colorsForLevel(1000), MAX_COLORS);
});

test('色数の上限は最大盤面に収まる（色数×2ブロック×4マス）', () => {
  // 追い込み手は「滑走路」を要る。半分は空けておく
  assert.ok(MAX_COLORS * 8 <= MAX_SIZE * MAX_SIZE * 0.55, '最大色数が盤面に対して詰まりすぎ');
  assert.equal(boardSizeForColors(MAX_COLORS), MAX_SIZE);
});

test('追い込みはレベル1から入り、上がるほど深くなる', () => {
  // レベル1でも「置いてすぐぶつけられる」形にはしない
  assert.ok(chainDepthForLevel(1) >= 1);
  assert.ok(chainMovesForLevel(1) >= colorsForLevel(1));

  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const d = chainDepthForLevel(lv);
    assert.ok(d >= prev, `Lv${lv}: 追い込みが浅くなった`);
    assert.ok(d >= 1 && d <= MAX_CHAIN_DEPTH);
    assert.ok(chainMovesForLevel(lv) <= MAX_CHAIN_MOVES);
    prev = d;
  }
  assert.equal(chainDepthForLevel(1000), MAX_CHAIN_DEPTH);
});

test('仕込み手は、あるレベルから先で加わる', () => {
  assert.equal(setupMovesForLevel(1), 0);

  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const n = setupMovesForLevel(lv);
    assert.ok(n >= prev, `Lv${lv}: 仕込み手が減った`);
    prev = n;
  }
  assert.ok(setupMovesForLevel(100) > 0, '上のレベルで仕込み手が入らない');
});

test('PAR の見込みは 色数 + 追い込み手 + 仕込み手', () => {
  for (const lv of [1, 5, 13, 24, 60]) {
    const cfg = levelConfig(lv);
    assert.equal(cfg.par, cfg.colors + cfg.chainMoves + cfg.setupMoves);
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

test('初期盤面ではどのブロックを動かしても何も消えない', () => {
  // これがこのゲームの核。生成は最善を尽くすが必ず成功するとは限らないので、
  // 代表点の大半で成り立てばよい
  let blocked = 0;
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.equal(clearableColors(b).size, p.analysis.clearAtStart, `Lv${lv}`);
    if (p.analysis.clearAtStart === 0) blocked++;
  }
  assert.ok(blocked >= SAMPLE.length - 2, `初手が塞がった盤面が ${blocked}/${SAMPLE.length} しかない`);
});

test('どのレベルも「消すには何手か重ねる」手順になっている', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    // 何も消さない手が解に必ず混ざる（＝1手で消えるだけの盤面ではない）
    const quiet = p.solution.filter((s) => s.kind !== 'clear').length;
    assert.ok(quiet >= p.colors, `Lv${lv}: 何も消さない手が ${quiet} 手しかない`);
    assert.ok(p.par > p.colors, `Lv${lv}: PAR が色数と同じ（＝1手ずつ消えるだけ）`);
    assert.ok(p.analysis.dryStreak >= 1, `Lv${lv}`);
  }
});

test('レベルが上がるほど手順は長くなる（多少の上下は許す）', () => {
  const pars = [1, 6, 12, 20, 30].map((lv) => generateLevel(lv).par);
  assert.ok(pars[0] < pars[2], `Lv1 ${pars[0]} / Lv12 ${pars[2]}`);
  assert.ok(pars[2] < pars[4], `Lv12 ${pars[2]} / Lv30 ${pars[4]}`);
});

test('ヒントはどのレベルの初期盤面でも道筋を出せる', () => {
  for (const lv of [1, 5, 13, 26]) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    const plan = findClearPlan(b, 3);
    assert.ok(plan, `Lv${lv}: 3手先まで見ても消去の道筋が無い`);
    assert.ok(b.slideDistance(plan.pieceId, plan.dir) > 0, `Lv${lv}: 指せない手を返した`);
  }
});

test('星は解決時間で決まる', () => {
  const t = targetTimes(10, 4);
  assert.ok(t.gold > 0 && t.silver > t.gold);
  assert.equal(starsForTime(1, t), 3);
  assert.equal(starsForTime(t.gold, t), 3);
  assert.equal(starsForTime(t.gold + 1, t), 2);
  assert.equal(starsForTime(t.silver, t), 2);
  assert.equal(starsForTime(t.silver + 1, t), 1);
  assert.equal(starsForTime(99999, t), 1);
});

test('しきい値は手順が長いほど緩む', () => {
  const short = targetTimes(4, 2);
  const long = targetTimes(28, 9);
  assert.ok(long.gold > short.gold);
  // 極端な値でも壊れない
  assert.ok(targetTimes(0, 0).gold > 0);
});

test('時間の表記は M:SS（1時間を超えたら H:MM:SS）', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9), '0:09');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(-5), '0:00');
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

test('レベル1は2色4個の入門用。それでも一手では消えない', () => {
  const p = generateLevel(1);
  assert.equal(p.size, MIN_SIZE);
  assert.equal(p.colors, 2);
  assert.equal(p.pieces, 4);
  assert.ok(p.par >= 3, `PAR が ${p.par} 手しかない`);
  assert.equal(p.analysis.clearAtStart, 0);
});

test('レベルの要約は主要なパラメータを含む', () => {
  const cfg = levelConfig(60);
  const s = levelSummary(cfg);
  assert.match(s, new RegExp(`${cfg.size}×${cfg.size}`));
  assert.match(s, new RegExp(`${cfg.colors}色`));
  assert.match(s, /追い込み/);

  // 遊んだあとの要約には、実際にかかる手数が入る
  const p = generateLevel(13);
  assert.match(puzzleSummary(p), new RegExp(`PAR ${p.par}手`));
});

test('レベル番号が不正でもレベル1として扱う', () => {
  for (const bad of [0, -5, 0.4, NaN, undefined, 'abc']) {
    assert.equal(levelConfig(bad).level, 1);
  }
});
