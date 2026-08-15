// ランキングと、解への近さ（色のグラデーション）のテスト。
//
// 通信そのものは試さない ―― 接続先は持ち主が用意するもので、ここには無い。
// 試すのは「サーバーから何が返ってきても壊れない」ための、並べ替えと入力の始末。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeName, rankSort, rankOf, starSort, starRankOf, NAME_MAX,
  renameEntries, removeEntries,
} from '../src/ranking.js';
import { progressColor, auraFor, Renderer } from '../src/render.js';

// ---------------------------------------------------------------- 名前

test('名前は前後の空白を落とし、連続する空白を1つに詰める', () => {
  assert.equal(sanitizeName('  たろう  '), 'たろう');
  assert.equal(sanitizeName('た    ろう'), 'た ろう');
});

test('名前は長さで切る（一覧で他人の行を潰さないため）', () => {
  const long = 'あ'.repeat(40);
  assert.equal(sanitizeName(long).length, NAME_MAX);
});

test('名前から制御文字を落とす（改行で一覧の行が崩れないように）', () => {
  assert.equal(sanitizeName('\u0000\u001f\u007f'), '');
  assert.equal(sanitizeName('\u0000\u3042\u0007'), '\u3042');
  // 改行も制御文字として落とす。空白に化けさせない（行が増えて見えるのを防ぐ）
  assert.equal(sanitizeName('\u3042\n\u3044'), '\u3042\u3044');
  assert.equal(sanitizeName('\n'), '');
});

test('空になる入力は空のまま返す（呼び出し側で弾ける）', () => {
  assert.equal(sanitizeName('   '), '');
  assert.equal(sanitizeName(null), '');
  assert.equal(sanitizeName(undefined), '');
});

// ---------------------------------------------------------------- 並べ替え

test('順位は手数の少ない順。同着はタイムの短い順', () => {
  const sorted = rankSort([
    { name: 'c', moves: 12, time: 40 },
    { name: 'a', moves: 8, time: 90 },
    { name: 'b', moves: 12, time: 20 },
  ]);
  assert.deepEqual(sorted.map((e) => e.name), ['a', 'b', 'c']);
});

test('同じ名前はいちばん良い1件だけ残る（1人で上位を埋めさせない）', () => {
  const sorted = rankSort([
    { name: 'たろう', moves: 20, time: 10 },
    { name: 'たろう', moves: 14, time: 60 },
    { name: 'はなこ', moves: 16, time: 30 },
  ]);
  assert.equal(sorted.length, 2);
  assert.deepEqual(sorted.map((e) => [e.name, e.moves]), [['たろう', 14], ['はなこ', 16]]);
});

test('壊れた行が来ても落ちない（サーバーの応答は信用しない）', () => {
  const sorted = rankSort([
    { name: 'ok', moves: 5, time: 5, stars: 3 },
    { name: '', moves: 'abc', time: null, stars: 99 },
    { moves: -3 },
  ]);
  assert.equal(sorted.length, 2, '名前が空の行はまとめて "???" 1件になる');
  for (const e of sorted) {
    assert.ok(Number.isFinite(e.moves) && e.moves >= 0);
    assert.ok(Number.isFinite(e.time) && e.time >= 0);
    assert.ok(e.stars >= 0 && e.stars <= 3);
    assert.equal(typeof e.name, 'string');
  }
});

test('rankOf は1始まりの順位を返す。無ければ null', () => {
  const list = rankSort([
    { name: 'a', moves: 8, time: 1 },
    { name: 'b', moves: 9, time: 1 },
  ]);
  assert.equal(rankOf(list, { name: 'b', moves: 9 }), 2);
  assert.equal(rankOf(list, { name: 'z', moves: 9 }), null);
});

// ---------------------------------------------------------------- 星の数の表

test('星の順位は多い順。同数ならクリア数の少ない人が上', () => {
  const sorted = starSort([
    { name: 'a', stars: 30, cleared: 30 },
    { name: 'b', stars: 42, cleared: 20 },
    { name: 'c', stars: 30, cleared: 12 },
  ]);
  assert.deepEqual(sorted.map((e) => e.name), ['b', 'c', 'a']);
});

test('星が同じでクリア数も同じなら、先に出した方が上', () => {
  const sorted = starSort([
    { name: 'あと', stars: 9, cleared: 5, at: 200 },
    { name: 'さき', stars: 9, cleared: 5, at: 100 },
  ]);
  assert.deepEqual(sorted.map((e) => e.name), ['さき', 'あと']);
});

test('星の表も同じ名前は1行だけ。残るのはいちばん良いもの', () => {
  const sorted = starSort([
    { name: 'たろう', stars: 12, cleared: 9 },
    { name: 'たろう', stars: 21, cleared: 11 },
    { name: 'はなこ', stars: 15, cleared: 8 },
  ]);
  assert.equal(sorted.length, 2);
  assert.deepEqual(sorted.map((e) => [e.name, e.stars]), [['たろう', 21], ['はなこ', 15]]);
});

test('星の表も壊れた行で落ちない（サーバーの応答は信用しない）', () => {
  const sorted = starSort([
    { name: 'ok', stars: 6, cleared: 3 },
    { name: '', stars: 'abc', cleared: null },
    { stars: -8, cleared: -2 },
  ]);
  assert.equal(sorted.length, 2, '名前が空の行はまとめて "???" 1件になる');
  for (const e of sorted) {
    assert.ok(Number.isFinite(e.stars) && e.stars >= 0);
    assert.ok(Number.isFinite(e.cleared) && e.cleared >= 0);
    assert.equal(typeof e.name, 'string');
  }
});

test('starRankOf は名前で1始まりの順位を返す。無ければ null', () => {
  const list = starSort([
    { name: 'a', stars: 30, cleared: 10 },
    { name: 'b', stars: 12, cleared: 6 },
  ]);
  assert.equal(starRankOf(list, 'b'), 2);
  assert.equal(starRankOf(list, 'z'), null);
  // 名前は投稿と同じ整えかたを通ってから照合する
  assert.equal(starRankOf(list, '  a  '), 1);
});

// ---------------------------------------------------------------- 進行度の色

test('進行度の色は 0 から 1 まで途切れなく作れる', () => {
  for (let i = 0; i <= 100; i++) {
    const c = progressColor(i / 100);
    for (const key of ['base', 'light', 'dark']) {
      assert.match(c[key], /^#[0-9a-f]{6}$/, `${key} が色になっていない (t=${i / 100})`);
    }
    assert.match(c.shadow, /^\d+,\d+,\d+$/);
    assert.match(auraFor(i / 100), /^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
  }
});

test('進行度の色は連続している（1手で色が飛ばない）', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let prev = rgb(progressColor(0).base);
  for (let i = 1; i <= 200; i++) {
    const cur = rgb(progressColor(i / 200).base);
    const jump = Math.max(...cur.map((v, k) => Math.abs(v - prev[k])));
    assert.ok(jump < 24, `t=${i / 200} で色が飛んでいる（差 ${jump}）`);
    prev = cur;
  }
});

test('範囲外の進行度は両端に丸める', () => {
  assert.equal(progressColor(-5).base, progressColor(0).base);
  assert.equal(progressColor(9).base, progressColor(1).base);
});

// ---------------------------------------------------------------- 背景の色の渡り方

/*
 * 背景は画面いっぱいの1色で、色が変わるときだけ**下から満ちる**。
 * ここが壊れると、1手ごとに画面全体が点滅する（それが嫌で作り直した）ので、
 * 「すぐには変わらない」「必ず満ちきる」「レベルを跨いだら引きずらない」を押さえる。
 */

/** 画面を持たない環境でも Renderer は作れる（canvas は使わない範囲だけ触る） */
function headlessRenderer() {
  const r = Object.create(Renderer.prototype);
  r.progress = 0;
  r.progressTarget = 0;
  r._tintAt = -1;
  r.auraFrom = 0;
  r.auraTo = 0;
  r.auraWave = 1;
  r.steps = 4;
  r.material = { rawTint: true, tint: 1, colors: { lit: { mid: '#3e47cc' } } };
  r.refreshTint();
  return r;
}

test('色が1段動くと、背景は下端からやり直す（画面全体が同時に変わらない）', () => {
  const r = headlessRenderer();
  assert.equal(r.auraWave, 1, '最初は満ちきっている');
  r.progress = 0.5;
  r.refreshTint();
  assert.equal(r.auraWave, 0, '新しい色が下端から始まっていない');
  assert.equal(r.auraFrom, 0, '前の色を覚えていない');
  assert.equal(r.auraTo, 0.5);
  // 満ちきる前は、上（前の色）と下（新しい色）で別の色が出ている
  assert.notEqual(r.auraColor(0.26), r.auraPrevColor(0.26));
});

test('水位は画面の外から外へ動く（満ちきったあと上端に前の色が残らない）', () => {
  const r = headlessRenderer();
  r.progress = 1;
  r.refreshTint();
  assert.ok(r.auraRise() < 0, `満ち始めは画面の下の外（いま ${r.auraRise()}）`);
  r.auraWave = 1;
  assert.ok(r.auraRise() > 100, `満ちきったら画面の上の外（いま ${r.auraRise()}）`);
});

test('レベルを跨いだら背景は引きずらない（immediate なら満ちきった状態から）', () => {
  const r = headlessRenderer();
  r.progress = 0.5;
  r.refreshTint();
  assert.equal(r.auraWave, 0);
  r.setProgress(0, true);
  r.refreshTint();
  assert.equal(r.auraWave, 1, 'レベルを跨いだのに前の色が残っている');
  assert.equal(r.auraColor(0.26), r.auraPrevColor(0.26));
});

// ---------------------------------------------------------------- 管理（持ち主だけ）

test('名前を付け替えると、その人の行だけが変わる', () => {
  const after = renameEntries([
    { name: 'あらし', moves: 12, time: 40 },
    { name: 'はなこ', moves: 8, time: 90 },
  ], 'あらし', 'なまえ');
  assert.deepEqual(after.map((e) => e.name), ['はなこ', 'なまえ']);
  assert.equal(after.find((e) => e.name === 'なまえ').moves, 12);
});

test('付け替え先に同じ名前が居たら、良いほうだけが残る（1人2行にしない）', () => {
  const after = renameEntries([
    { name: 'あらし', moves: 20, time: 10 },
    { name: 'たろう', moves: 14, time: 60 },
  ], 'あらし', 'たろう');
  assert.equal(after.length, 1);
  assert.deepEqual([after[0].name, after[0].moves], ['たろう', 14]);
});

test('星の表の付け替えも、良いほう（星の多いほう）を残す', () => {
  const after = renameEntries([
    { name: 'あらし', stars: 30, cleared: 12 },
    { name: 'たろう', stars: 9, cleared: 4 },
  ], 'あらし', 'たろう', starSort);
  assert.equal(after.length, 1);
  assert.deepEqual([after[0].name, after[0].stars], ['たろう', 30]);
});

test('付け替えの指定が空なら、一覧は変わらない', () => {
  const src = [{ name: 'たろう', moves: 12, time: 40 }];
  assert.deepEqual(renameEntries(src, '  ', 'あと').map((e) => e.name), ['たろう']);
  assert.deepEqual(renameEntries(src, 'たろう', '  ').map((e) => e.name), ['たろう']);
});

test('消すと、その名前の行だけが落ちる', () => {
  const after = removeEntries([
    { name: 'あらし', moves: 8, time: 10 },
    { name: 'たろう', moves: 12, time: 40 },
  ], ' あらし ');
  assert.deepEqual(after.map((e) => e.name), ['たろう']);
});
