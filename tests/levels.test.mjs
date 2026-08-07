// レベル進行のテスト。
// 「レベルが上がるほど盤面が広く・色が増え・追い込みが深くなる」
// 「ブロックはテトロミノだけ」「同じ色はちょうど2個」「どのレベルも必ず解ける」
// 「初手からは何も消せない（＝スライドを重ねないと1個も消えない）」
// 「同じレベルならどの端末でも同じ譜面」を確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, BLOCKER } from '../src/board.js';
import { generateLevel, verifySolution, clearableColors } from '../src/generator.js';
import {
  levelConfig, levelSeed, levelSummary, puzzleSummary, boardSizeForLevel, boardSizeForColors,
  colorsForLevel, chainDepthForLevel, chainMovesForLevel, setupMovesForLevel, fillForLevel,
  targetMoves, starsForMoves, formatTime,
  MIN_SIZE, MAX_SIZE, MAX_COLORS, MAX_CHAIN_DEPTH, MAX_CHAIN_MOVES, MAX_SETUP_MOVES,
} from '../src/levels.js';
import { PIECES } from '../src/shapes.js';
import { LEVEL_DATA } from '../src/levelData.js';

/** 通しで確かめるレベル（全部やると遅いので代表点を拾う） */
const SAMPLE = [1, 2, 3, 5, 7, 10, 13, 17, 21, 24, 26, 30, 42, 60, 120];

/** 焼いてあるレベルの数。ここを超えると先頭に戻る */
const BAKED = LEVEL_DATA.length;
/** 焼いてある中でいちばん上のレベル（手数の昇順なので、いちばん難しい） */
const LAST = BAKED;

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

test('色数はレベル1で3色、上がるほど増え、上限で頭打ち', () => {
  assert.equal(colorsForLevel(1), 3);

  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const n = colorsForLevel(lv);
    assert.ok(n >= prev, `Lv${lv}: 色数が減った`);
    assert.ok(n >= 3 && n <= MAX_COLORS);
    prev = n;
  }
  assert.equal(colorsForLevel(1000), MAX_COLORS);
});

test('盤面が頭打ちになったあとは、色数がそのまま埋め率になる', () => {
  assert.equal(boardSizeForColors(MAX_COLORS), MAX_SIZE);
  // 上限でも空きは残す。追い込み手も初手の掃除も「戻す先の空き」が要る
  const topFill = fillForLevel(1000);
  assert.ok(topFill >= 0.6, `最大でも埋め率が ${(topFill * 100).toFixed(0)}% しかない`);
  assert.ok(topFill <= 0.85, `埋め率 ${(topFill * 100).toFixed(0)}% は詰まりすぎ（生成が破綻する）`);

  // 盤面が広がる途中では一度ゆるむが、全体としては詰まっていく
  for (let lv = 1; lv <= 200; lv++) {
    const f = fillForLevel(lv);
    assert.ok(f > 0.3 && f <= topFill + 1e-9, `Lv${lv}: 埋め率 ${f.toFixed(2)}`);
  }
  assert.ok(fillForLevel(40) > fillForLevel(1) + 0.1, 'いちばん上でも盤面が詰まらない');
});

test('追い込みはレベル1から深い', () => {
  // レベル1でも「1手ずらせば届く」形にはしない。3手ぶん寄せさせる
  assert.ok(chainDepthForLevel(1) >= 3, `レベル1の追い込みが ${chainDepthForLevel(1)} 手しかない`);
  assert.ok(chainMovesForLevel(1) >= colorsForLevel(1) * 3);

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
    assert.ok(n <= MAX_SETUP_MOVES);
    prev = n;
  }
  assert.ok(setupMovesForLevel(100) > 0, '上のレベルで仕込み手が入らない');
  assert.equal(setupMovesForLevel(1000), MAX_SETUP_MOVES);
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
  const shapeNames = new Set(PIECES.map((s) => s.name));
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);

    const counts = new Map();
    for (const piece of b.pieces.values()) {
      if (piece.color === BLOCKER) continue; // 灰色は何個でもよい
      assert.ok(piece.cells.length >= 1 && piece.cells.length <= 9, `Lv${lv}: ${piece.cells.length}セルのブロック`);
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
  assert.ok(blocked >= SAMPLE.length - 1, `初手が塞がった盤面が ${blocked}/${SAMPLE.length} しかない`);
});

test('消えるのは必ず最後の1手 ―― 途中で消えることはない', () => {
  // 色つきは1組しかないので、消去は手順のいちばん最後に1回だけ起きる。
  // つまり最短手数から1を引いた数だけ「何も消えない手」を積むことになる
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const quiet = p.solution.filter((s) => s.kind !== 'clear').length;
    assert.equal(quiet, p.par - 1, `Lv${lv}: 途中で消える手がある`);
    assert.ok(p.par >= 2, `Lv${lv}: 1手で終わってしまう`);
    assert.equal(p.analysis.dryStreak, p.par - 1, `Lv${lv}: 無消去の連続が途切れている`);
  }
});

test('入門を抜けたら「何手も重ねる」手順になる', () => {
  // レベル1〜12 は操作を掴むための短い問題（2〜5手）。そこを抜けたレベルは、
  // 1組を消すまでに最低でも5手ぶん滑らせる必要がある
  const graduated = SAMPLE.filter((lv) => generateLevel(lv).par >= 6);
  assert.ok(graduated.length >= 8, '入門を抜けたレベルが少なすぎる');
  for (const lv of graduated) {
    const p = generateLevel(lv);
    assert.ok(p.analysis.dryStreak >= 5, `Lv${lv}: 無消去の連続が ${p.analysis.dryStreak} 手`);
  }
});

test('レベルが上がるほど手順は長くなる', () => {
  // 焼いてある本数が変わっても壊れないよう、四分位で見る
  const at = (ratio) => generateLevel(Math.max(1, Math.round(LAST * ratio))).par;
  const [q1, q2, q4] = [at(0.25), at(0.5), at(1)];
  assert.ok(q1 < q2, `前半 ${q1} 手 / 中盤 ${q2} 手`);
  assert.ok(q2 < q4, `中盤 ${q2} 手 / 最後 ${q4} 手`);
});

test('上のレベルほど最短手数が長い（データは手数の昇順に並んでいる）', () => {
  // 焼いてあるぶんは端から端まで、1レベルたりとも手数が減らないことを確かめる
  const pars = [];
  for (let lv = 1; lv <= LAST; lv++) pars.push(generateLevel(lv).par);
  for (let i = 1; i < pars.length; i++) {
    assert.ok(pars[i] >= pars[i - 1], `Lv${i} -> Lv${i + 1} で手数が減った: ${pars[i - 1]} -> ${pars[i]}`);
  }
  assert.ok(pars[pars.length - 1] >= 20, `いちばん上でも ${pars[pars.length - 1]} 手しかない`);
  assert.ok(pars[pars.length - 1] > pars[0], '端から端まで手数が変わらない');
});

test('データを使い切ったら先頭に戻る', () => {
  const first = generateLevel(1);
  const wrapped = generateLevel(LAST + 1);
  assert.equal(wrapped.par, first.par);
  assert.equal(wrapped.size, first.size);
  assert.deepEqual(wrapped.solution, first.solution);
});

test('どのレベルも盤面が詰まっていて、灰色が入っている', () => {
  for (let lv = 1; lv <= LAST; lv++) {
    const p = generateLevel(lv);
    const fill = p.cells / (p.size * p.size);
    // 埋め率は手数を伸ばすための手段であって目的ではない。65% を下回るものは採らない
    assert.ok(fill >= 0.65, `Lv${lv}: 埋め率 ${(fill * 100).toFixed(0)}%`);
    assert.ok(p.blockers >= 1, `Lv${lv}: 灰色が無い`);
    assert.equal(p.colors, 1, `Lv${lv}: 色つきは1組だけ`);
  }
});

test('保証解は厳密な最短手順そのもの', () => {
  // データは「ゴールからいちばん遠い盤面」なので、記録されている手順より
  // 短い解き方は存在しない。手順どおりに指せば必ず色つきが消える
  for (let lv = 1; lv <= LAST; lv++) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    for (const step of p.solution) {
      const res = b.applyMove(step.pieceId, step.dir);
      assert.ok(res, `Lv${lv}: 指せない手がある`);
      assert.equal(res.steps, step.distance, `Lv${lv}: 停止位置が違う`);
    }
    assert.equal(b.isCleared, true, `Lv${lv}: 手順どおりに指しても消えない`);
    assert.equal(p.par, p.optimal, `Lv${lv}: PAR が最短手数と違う`);
  }
});

test('最短手順は同じ局面を二度通らない', () => {
  // 最短手順なのだから、同じ配置に戻る手が混ざっていたらその区間は無駄。
  // 全レベルで、手順上の局面がすべて相異なることを確かめる
  for (let lv = 1; lv <= LAST; lv++) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);

    const seen = new Set([b.fingerprint()]);
    for (const step of p.solution) {
      b.applyMove(step.pieceId, step.dir);
      const print = b.fingerprint();
      assert.equal(seen.has(print), false, `Lv${lv}: 同じ局面を二度通っている`);
      seen.add(print);
    }
    assert.equal(seen.size, p.solution.length + 1, `Lv${lv}: 局面の数が手数と合わない`);
  }
});

test('星は手数で決まる', () => {
  const t = targetMoves(10);
  assert.ok(t.gold > 0 && t.silver > t.gold);
  assert.equal(starsForMoves(1, t), 3);
  assert.equal(starsForMoves(t.gold, t), 3);
  assert.equal(starsForMoves(t.gold + 1, t), 2);
  assert.equal(starsForMoves(t.silver, t), 2);
  assert.equal(starsForMoves(t.silver + 1, t), 1);
  assert.equal(starsForMoves(99999, t), 1);
});

test('★★★ は最短ちょうど ―― 近道は存在しない', () => {
  // par は厳密な最短手数なので、gold をそれ未満に置く意味はないし、
  // gold ちょうどで解けたなら「それ以上短くできない」と言い切れる
  for (const lv of [1, 20, 40, 60]) {
    const p = generateLevel(lv);
    const t = targetMoves(p.par);
    assert.equal(t.gold, p.par, `Lv${lv}: ★★★ の基準が最短手数と違う`);
    assert.equal(starsForMoves(p.par, t), 3, `Lv${lv}: 最短で解いても ★★★ にならない`);
  }
});

test('しきい値は手順が長いほど緩む', () => {
  const short = targetMoves(4);
  const long = targetMoves(28);
  assert.ok(long.gold > short.gold);
  assert.ok(long.silver > short.silver);
  // 短いレベルほど1手の重みが大きいので、少しだけ余裕がある
  assert.ok(targetMoves(2).silver >= 4, '2手のレベルで1手ずれただけで★1になる');
  // 極端な値でも壊れない
  assert.ok(targetMoves(0).gold > 0);
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

test('レベル1は入門用 ―― 短いが、1手では終わらない', () => {
  const p = generateLevel(1);
  assert.equal(p.colors, 1);
  // 1手だとゴールそのもの（置いた瞬間くっついている）になってしまう
  assert.ok(p.par >= 2, `PAR が ${p.par} 手しかない`);
  assert.ok(p.par <= 5, `入門なのに ${p.par} 手もかかる`);
  assert.ok(p.size <= 7, `入門なのに ${p.size}×${p.size} は広すぎる`);
});

test('序盤は同じ手数が並びすぎない', () => {
  // 出やすい手数ばかりが続くと「上がった感じ」が消えるので、
  // 同じ最短手数は 3 レベルまでに抑えてある
  const counts = new Map();
  for (const d of LEVEL_DATA) counts.set(d.optimal, (counts.get(d.optimal) || 0) + 1);
  for (const [par, n] of counts) {
    assert.ok(n <= 3, `最短${par}手のレベルが ${n} 件ある`);
  }
});

test('レベルの要約は主要なパラメータを含む', () => {
  const cfg = levelConfig(10);
  const s = levelSummary(cfg);
  assert.match(s, new RegExp(`${cfg.size}×${cfg.size}`));
  assert.match(s, /最短\d+手/);
  assert.match(s, /灰\d+個/);
  assert.match(s, /埋め率\d+%/);

  const p = generateLevel(10);
  assert.match(puzzleSummary(p), new RegExp(`最短${p.par}手`));
});

test('レベル番号が不正でもレベル1として扱う', () => {
  for (const bad of [0, -5, 0.4, NaN, undefined, 'abc']) {
    assert.equal(levelConfig(bad).level, 1);
  }
});
