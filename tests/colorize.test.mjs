// 無色の写真を色で染めるところのテスト。
//
// ここは以前、合成の混ぜ方（globalCompositeOperation = 'color'）に任せていた。
// 仕様にはあるが「分離しない混ぜ方」で、実装によっては効かない ―― Android の
// ある端末では、色つきブロックにだけ色が乗らなかった（灰色ブロックは無彩色を
// 被せているので、効かなくても見た目が変わらない）。
//
// いまは画素を自分で解いているので、**ブラウザに頼らず**ここで確かめられる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { colorizePixels } from '../src/render.js';

/** [r,g,b,a] を1画素だけ持つ配列を作る */
const one = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);

test('無彩色の画素に色が乗る（乗らなかったのが、直したかった不具合そのもの）', () => {
  const px = one(128, 128, 128);
  colorizePixels(px, '#3e47cc', 1);
  assert.notEqual(px[0], px[2], '染めたのに無彩色のままになっている');
  assert.ok(px[2] > px[0], '青で染めたのに青が強くなっていない');
});

test('明るさは写真のまま残る（ガラスの陰影が潰れない）', () => {
  // 合成の仕様が使う明るさ。染める前と後で、ここが変わってはいけない
  const lum = (p) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
  for (const v of [16, 64, 128, 200, 250]) {
    const px = one(v, v, v);
    const before = lum(px);
    colorizePixels(px, '#e0a52c', 1);
    assert.ok(Math.abs(lum(px) - before) < 2,
      `明るさ ${v} が ${lum(px).toFixed(0)} へ動いた（陰影が潰れている）`);
  }
});

test('暗いところは暗いまま、明るいところは明るいまま（順序が入れ替わらない）', () => {
  const shades = [20, 80, 140, 200, 245].map((v) => {
    const px = one(v, v, v);
    colorizePixels(px, '#2a85c8', 0.86);
    return 0.3 * px[0] + 0.59 * px[1] + 0.11 * px[2];
  });
  for (let i = 1; i < shades.length; i++) {
    assert.ok(shades[i] > shades[i - 1], `${i} 番目で明暗が入れ替わっている`);
  }
});

test('濃さ 0 なら何も変わらない（灰色ブロックの逃げ道）', () => {
  const px = one(90, 90, 90);
  colorizePixels(px, '#cc2222', 0);
  assert.deepEqual([...px], [90, 90, 90, 255]);
});

test('濃さを上げるほど、色みが強くなる', () => {
  const chroma = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  let prev = -1;
  for (const k of [0, 0.3, 0.6, 0.86, 1]) {
    const px = one(150, 150, 150);
    colorizePixels(px, '#d94a41', k);
    const c = chroma(px);
    assert.ok(c > prev, `濃さ ${k} で色みが増えていない`);
    prev = c;
  }
});

test('透明な画素には触らない（ブロックの外へ色がにじまない）', () => {
  const px = new Uint8ClampedArray([0, 0, 0, 0, 128, 128, 128, 255]);
  colorizePixels(px, '#3e47cc', 1);
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 0], '透明な画素が塗られている');
  assert.equal(px[7], 255, '不透明な画素の透明度が変わっている');
  assert.notEqual(px[4], px[6], '不透明な画素が染まっていない');
});

test('白と黒は染まらない（明るさを保つと、そこには色を置けない）', () => {
  for (const v of [0, 255]) {
    const px = one(v, v, v);
    colorizePixels(px, '#3e47cc', 1);
    assert.equal(px[0], v);
    assert.equal(px[1], v);
    assert.equal(px[2], v);
  }
});

test('どの色で染めても、画素が範囲から出ない', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#3e47cc', '#e0a52c']) {
    for (let v = 0; v <= 255; v += 5) {
      const px = one(v, v, v);
      colorizePixels(px, hex, 1);
      for (let i = 0; i < 3; i++) {
        assert.ok(px[i] >= 0 && px[i] <= 255, `${hex} の ${v} で範囲外`);
        assert.ok(Number.isFinite(px[i]), `${hex} の ${v} で数値になっていない`);
      }
    }
  }
});
