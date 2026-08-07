// レベル進行のテスト。
//
// 「レベルは上限なく続く」「上がるほど最短手数が伸びる」「手数は目標カーブに沿う」
// 「どのレベルも手順どおりに指せば必ず解ける」「初期盤面からは何も消せない」
// 「ブロックは 1×2 〜 3×3 の長方形」「同じレベルならどの端末でも同じ譜面」
// を確かめる。
//
// PAR は推定ではなく厳密な最短手数なので、「焼いてある手順より短い解き方が
// 存在しない」ことは生成側（全探索）が保証している。ここではその手順が本当に
// 盤面の上で通ることと、並びが崩れていないことを見る。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, BLOCKER } from '../src/board.js';
import { generateLevel, verifySolution, clearableColors } from '../src/generator.js';
import {
  levelConfig, levelSeed, levelSummary, puzzleSummary, levelIndex, levelData,
  boardSizeForLevel, fillForLevel, blockersForLevel, parForLevel, targetPar,
  targetTimes, starsForTime, formatTime, normalizeLevel,
  MIN_SIZE, MAX_SIZE, MAX_PAR, PAR_ANCHORS, BAKED_LEVELS, TAIL_LEVELS,
} from '../src/levels.js';
import { LEVEL_CODES } from '../src/levelData.js';
import { encodeLevel, decodeLevel } from '../src/levelCodec.js';

/** 通しで確かめるレベル（全部やると遅いので代表点を拾う） */
const SAMPLE = [1, 2, 3, 5, 8, 13, 20, 35, 50, 80, 100, 150, 250, 400, 600, 800, 1000];

test('レベルは上限なく続く ―― どんな番号でも盤面が出る', () => {
  for (const lv of [1, BAKED_LEVELS, BAKED_LEVELS + 1, BAKED_LEVELS * 3 + 7, 999999]) {
    const p = generateLevel(lv);
    assert.ok(p.par >= 2, `Lv${lv}: PAR が ${p.par}`);
    assert.ok(p.size >= MIN_SIZE && p.size <= MAX_SIZE);
  }
});

test('焼いたぶんを使い切ったら、いちばん上の帯を繰り返す（頭には戻らない）', () => {
  const tail = Math.min(TAIL_LEVELS, BAKED_LEVELS);
  assert.equal(levelIndex(BAKED_LEVELS + 1), BAKED_LEVELS - tail);
  assert.equal(levelIndex(BAKED_LEVELS + tail), BAKED_LEVELS - 1);
  assert.equal(levelIndex(BAKED_LEVELS + tail + 1), BAKED_LEVELS - tail);

  // 繰り返しに入っても手数はいちばん上の帯のまま。頭に戻って易しくならない
  const easiest = parForLevel(1);
  for (const lv of [BAKED_LEVELS + 1, BAKED_LEVELS + 50, BAKED_LEVELS * 2]) {
    assert.ok(parForLevel(lv) > easiest + 50, `Lv${lv}: ${parForLevel(lv)}手まで落ちた`);
  }
});

test('目標カーブは折れ線どおり ―― 減らないし、指定した節を通る', () => {
  for (const [lv, par] of PAR_ANCHORS) assert.equal(targetPar(lv), par, `Lv${lv}`);
  let prev = 0;
  for (let lv = 1; lv <= 1200; lv++) {
    const p = targetPar(lv);
    assert.ok(p >= prev, `Lv${lv}: 目標手数が減った`);
    assert.ok(p >= 2 && p <= MAX_PAR);
    prev = p;
  }
  assert.equal(targetPar(1000), MAX_PAR);
  assert.equal(targetPar(99999), MAX_PAR);
});

test('焼いてある手数は、レベルが上がるほど伸びる（1レベルも減らない）', () => {
  let prev = 0;
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const par = parForLevel(lv);
    assert.ok(par >= prev, `Lv${lv}: 手数が ${prev} -> ${par} と減った`);
    prev = par;
  }
  assert.equal(parForLevel(1), targetPar(1));
  assert.ok(prev >= 250, `いちばん上でも ${prev} 手しかない`);
});

test('焼いてある手数は目標カーブから大きく外れない', () => {
  // 上端（250手超）は在庫がそもそも数枚しか無いので、狙いどおりの手数が
  // 見つからないことがある。ずれても手数が減ることは無い（並べ直すため）ので、
  // 効いてくるのは「狙った形になっているか」だけ
  let worst = 0;
  let total = 0;
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const gap = Math.abs(parForLevel(lv) - targetPar(lv));
    worst = Math.max(worst, gap);
    total += gap;
  }
  assert.ok(worst <= 40, `いちばんずれたレベルで ${worst} 手ずれている`);
  assert.ok(total / BAKED_LEVELS <= 3, `平均で ${(total / BAKED_LEVELS).toFixed(2)} 手ずれている`);
});

test('どのレベルも解答手順で必ず全消しできる', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const r = verifySolution(p.snapshot, p.solution, p.size);
    assert.equal(r.ok, true, `Lv${lv}: ${r.reason}`);
  }
});

test('焼いてあるレベルは全部、手順どおりに指せばちょうどそこで消える', () => {
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
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

test('どのレベルも初期盤面に同色隣接が無く、少なくとも1手は指せる', () => {
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.equal(b.hasSameColorContact(), false, `Lv${lv}`);
    assert.ok(b.allMoves().length > 0, `Lv${lv}: 1手も指せない`);
  }
});

test('初期盤面ではどのブロックを動かしても何も消えない', () => {
  // これがこのゲームの核。最短2手以上の盤面しか採っていないので、1手では届かない
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const p = generateLevel(lv);
    assert.equal(p.analysis.clearAtStart, 0, `Lv${lv}: 初手から消せてしまう`);
  }
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

test('ブロックは 1×2 〜 3×3 の長方形で、色つきはちょうど2個', () => {
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const p = generateLevel(lv);
    const b = new Board(p.size);
    b.restore(p.snapshot);
    assert.ok(b.size >= MIN_SIZE && b.size <= MAX_SIZE, `Lv${lv}: ${b.size}×${b.size}`);

    let colored = 0;
    let grey = 0;
    for (const piece of b.pieces.values()) {
      const xs = piece.cells.map((c) => c[0]);
      const ys = piece.cells.map((c) => c[1]);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      assert.equal(piece.cells.length, w * h, `Lv${lv}: 長方形でないブロック`);
      assert.ok(w >= 1 && w <= 3 && h >= 1 && h <= 3, `Lv${lv}: ${w}×${h} のブロック`);
      assert.ok(piece.cells.length >= 2, `Lv${lv}: 1マスのブロック`);
      if (piece.color === BLOCKER) grey++;
      else colored++;
    }
    assert.equal(colored, 2, `Lv${lv}: 色つきが ${colored} 個`);
    assert.ok(grey >= 1, `Lv${lv}: 灰色が無い`);
  }
});

test('色つきにも灰色にも、大きいブロックが実際に出てくる', () => {
  const colorShapes = new Set();
  const greyShapes = new Set();
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const data = levelData(lv);
    data.pieces.forEach((p, i) => {
      (i < 2 ? colorShapes : greyShapes).add(`${p.w}x${p.h}`);
    });
  }
  // 色つきは 1×2 だけだった時代の名残を残さない ―― 2×2 以上も出る
  assert.ok(colorShapes.size >= 4, `色つきの形が ${colorShapes.size} 通りしかない`);
  assert.ok([...colorShapes].some((s) => s !== '1x2' && s !== '2x1'), '色つきが 1×2 だけになっている');
  assert.ok(greyShapes.has('3x3'), '3×3 の灰色が出てこない');
  for (const s of [...colorShapes, ...greyShapes]) {
    assert.match(s, /^[123]x[123]$/, `使ってはいけない形 ${s}`);
  }
});

test('どのレベルも盤面が詰まっている', () => {
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const fill = fillForLevel(lv);
    // 埋め率は手数を伸ばすための手段であって目的ではないが、
    // 隙間だらけの盤面は「滑らせて詰める」読みが成立しない
    assert.ok(fill >= 0.65, `Lv${lv}: 埋め率 ${(fill * 100).toFixed(0)}%`);
    assert.ok(fill < 1, `Lv${lv}: 空きが無い`);
    assert.ok(blockersForLevel(lv) >= 1, `Lv${lv}: 灰色が無い`);
  }
});

test('ヒントは最短手順の上でだけ引ける（外れたら引けない）', () => {
  // ゲーム側は「いまの盤面が最短手順の途中か」を指紋で照合してヒントを出し、
  // 外れていたらやり直すかを訊く。その照合が成り立つことを確かめる
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const sim = new Board(p.size);
    sim.restore(p.snapshot);

    // 手順の各局面 -> 次の手 の対応表（game.js の buildSolutionMap と同じ）
    const map = new Map();
    for (const step of p.solution) {
      map.set(sim.fingerprint(), step);
      sim.applyMove(step.pieceId, step.dir);
    }
    assert.equal(map.size, p.solution.length, `Lv${lv}: 手順の途中で同じ局面に戻っている`);

    const b = new Board(p.size);
    b.restore(p.snapshot);
    for (let i = 0; i < p.solution.length; i++) {
      assert.ok(map.has(b.fingerprint()), `Lv${lv}: 第${i + 1}手のヒントが出せない`);
      b.applyMove(p.solution[i].pieceId, p.solution[i].dir);
    }
    assert.equal(map.has(b.fingerprint()), false, `Lv${lv}: 解き終えた盤面が手順上に残っている`);
  }
});

test('手順から外れられるレベルが確かにある（「やり直す？」の分岐は起きる）', () => {
  let offPath = 0;
  for (const lv of SAMPLE) {
    const p = generateLevel(lv);
    const sim = new Board(p.size);
    sim.restore(p.snapshot);
    const map = new Set();
    for (const step of p.solution) {
      map.add(sim.fingerprint());
      sim.applyMove(step.pieceId, step.dir);
    }

    const b = new Board(p.size);
    b.restore(p.snapshot);
    const step = p.solution[0];
    const strayed = [...b.pieces.keys()]
      .flatMap((id) => ['up', 'down', 'left', 'right'].map((dir) => ({ id, dir })))
      .filter(({ id, dir }) => (id !== step.pieceId || dir !== step.dir) && b.slideDistance(id, dir) > 0)
      .some(({ id, dir }) => {
        const snap = b.snapshot();
        b.applyMove(id, dir);
        const onPath = map.has(b.fingerprint());
        b.restore(snap);
        return !onPath;
      });
    if (strayed) offPath++;
  }
  assert.ok(offPath > SAMPLE.length / 2, `外れられるレベルが ${offPath}/${SAMPLE.length} しかない`);
});

test('星は解決時間で決まる', () => {
  const t = targetTimes(10, 6);
  assert.ok(t.gold > 0 && t.silver > t.gold);
  assert.equal(starsForTime(1, t), 3);
  assert.equal(starsForTime(t.gold, t), 3);
  assert.equal(starsForTime(t.gold + 1, t), 2);
  assert.equal(starsForTime(t.silver, t), 2);
  assert.equal(starsForTime(t.silver + 1, t), 1);
  assert.equal(starsForTime(99999, t), 1);
});

test('しきい値は手順が長いほど緩む', () => {
  assert.ok(targetTimes(110, 6).gold > targetTimes(4, 5).gold);
  assert.ok(targetTimes(0, 0).gold > 0); // 極端な値でも壊れない
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
  for (const lv of [1, 9, 22, 47, 500, 1000]) {
    const a = generateLevel(lv);
    const b = generateLevel(lv);
    const ba = new Board(a.size); ba.restore(a.snapshot);
    const bb = new Board(b.size); bb.restore(b.snapshot);
    assert.equal(ba.fingerprint(), bb.fingerprint(), `Lv${lv}`);
    assert.deepEqual(a.solution, b.solution);
    assert.equal(levelSeed(lv), levelSeed(lv));
  }
});

test('焼いてあるレベルはすべて別の譜面', () => {
  assert.equal(new Set(LEVEL_CODES).size, LEVEL_CODES.length, '同じ盤面が2回出てくる');
});

test('同じ配役の使い回しになっていない', () => {
  // 全探索の距離マップは1枚の盤面から何十問でも切り出せる。切り出したものは
  // 灰色の位置まで違うが、ブロックの顔ぶれ（大きさの多重集合）は同じままなので、
  // 並べると「さっきと同じ盤面」に見える。1枚から1レベルしか取らないことで
  // 避けているが、別々の盤面がたまたま同じ顔ぶれになることはある
  const casts = new Map();
  for (const code of LEVEL_CODES) {
    const d = decodeLevel(code);
    const cast = `${d.size}:${d.pieces.map((p) => `${p.w}x${p.h}`).sort().join(',')}`;
    casts.set(cast, (casts.get(cast) || 0) + 1);
  }
  // 別々の盤面でも、たまたま同じ大きさのブロックが同じ数だけ入ることはある
  // （並びは違う）。使い回しは 0 だが、顔ぶれの一致まではゼロにできない
  const worst = Math.max(...casts.values());
  assert.ok(worst <= 20, `同じ顔ぶれの盤面が ${worst} レベルに使われている`);
  assert.ok(
    casts.size >= LEVEL_CODES.length / 3,
    `顔ぶれが ${casts.size} 通りしかない（${LEVEL_CODES.length} レベルに対して少なすぎる）`,
  );
});

test('盤面はできるだけ小さく、手数が要求したときだけ広がる', () => {
  const bySize = new Map();
  let smallPars = [];
  let bigPars = [];
  for (let lv = 1; lv <= BAKED_LEVELS; lv++) {
    const size = boardSizeForLevel(lv);
    const par = parForLevel(lv);
    bySize.set(size, Math.max(bySize.get(size) || 0, par));
    if (size <= 5) smallPars.push(par);
    if (size >= 7) bigPars.push(par);
  }
  // 大きい盤面は「小さい盤面では出せない手数」のために使う。
  // 4×4/5×5 で足りる手数の帯に、7×7/8×8 がまとめて居座っていないこと
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  if (smallPars.length && bigPars.length) {
    assert.ok(
      avg(bigPars) > avg(smallPars),
      `広い盤面の平均手数 ${avg(bigPars).toFixed(0)} が、小さい盤面の ${avg(smallPars).toFixed(0)} を上回っていない`,
    );
  }
  // いちばん易しい帯は小さい盤面から取る
  for (let lv = 1; lv <= 10; lv++) {
    assert.ok(boardSizeForLevel(lv) <= 6, `Lv${lv}: ${boardSizeForLevel(lv)}×${boardSizeForLevel(lv)} は入門には広すぎる`);
  }
});

test('レベル1は入門用 ―― 短いが、1手では終わらない', () => {
  const p = generateLevel(1);
  assert.equal(p.colors, 1);
  // 1手だとゴールそのもの（置いた瞬間くっついている）になってしまう
  assert.ok(p.par >= 2, `PAR が ${p.par} 手しかない`);
  assert.ok(p.par <= 4, `入門なのに ${p.par} 手もかかる`);
  assert.ok(p.size <= 7, `入門なのに ${p.size}×${p.size} は広すぎる`);
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
  assert.equal(cfg.par, parForLevel(10));
  assert.equal(cfg.size, boardSizeForLevel(10));
});

test('レベル番号が不正でもレベル1として扱う', () => {
  for (const bad of [0, -5, 0.4, NaN, undefined, 'abc']) {
    assert.equal(levelConfig(bad).level, 1);
    assert.equal(normalizeLevel(bad), 1);
  }
});

test('符号は往復しても同じ盤面になる', () => {
  for (const code of [LEVEL_CODES[0], LEVEL_CODES[Math.floor(BAKED_LEVELS / 2)], LEVEL_CODES[BAKED_LEVELS - 1]]) {
    const data = decodeLevel(code);
    assert.equal(encodeLevel({ size: data.size, pieces: data.pieces, solution: data.solution }), code);
  }
});
