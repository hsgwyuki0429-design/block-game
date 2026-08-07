// ランキングと、解への近さ（色のグラデーション）のテスト。
//
// 通信そのものは試さない ―― 接続先は持ち主が用意するもので、ここには無い。
// 試すのは「サーバーから何が返ってきても壊れない」ための、並べ替えと入力の始末。

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeName, rankSort, rankOf, NAME_MAX } from '../src/ranking.js';
import { progressColor, trayFor, auraFor } from '../src/render.js';

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

// ---------------------------------------------------------------- 進行度の色

test('進行度の色は 0 から 1 まで途切れなく作れる', () => {
  for (let i = 0; i <= 100; i++) {
    const c = progressColor(i / 100);
    for (const key of ['base', 'light', 'dark']) {
      assert.match(c[key], /^#[0-9a-f]{6}$/, `${key} が色になっていない (t=${i / 100})`);
    }
    assert.match(c.shadow, /^\d+,\d+,\d+$/);
    assert.match(trayFor(i / 100).plate, /^#[0-9a-f]{6}$/);
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

test('盤面の面はブロックよりずっと淡い（ブロックが埋もれない）', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    assert.ok(lum(trayFor(t).plate) > lum(progressColor(t).base) + 50,
      `t=${t} で面とブロックの明るさが近すぎる`);
  }
});
