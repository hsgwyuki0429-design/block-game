// ブロックのデザインのテスト。
//
// 見た目そのものは目で確かめるしかないが、**目で気づきにくいのに致命的な**
// ところだけは機械で押さえておく:
//
//   ・灰色ブロックと色つきブロックが、どの進行度でも見分けられるか
//   ・デザインを足したときに、寸法や色の入れ忘れが無いか
//   ・廃止したデザインを選んだまま残っている端末が、黙って既定へ落ちるか

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIAL_KEYS, DEFAULT_MATERIAL, materialFor, materialList,
  paletteFor,
} from '../src/materials.js';
import { luma, hexRgb } from '../src/color.js';
import { progressColor } from '../src/render.js';

const HEX = /^#[0-9a-f]{6}$/;

test('デザインは一覧と引き当てが噛み合っている', () => {
  assert.ok(MATERIAL_KEYS.length >= 2);
  assert.ok(MATERIAL_KEYS.includes(DEFAULT_MATERIAL));
  assert.equal(materialList().length, MATERIAL_KEYS.length);
  for (const m of materialList()) {
    assert.ok(MATERIAL_KEYS.includes(m.key));
    assert.ok(m.name.length > 0, `${m.key} に名前が無い`);
    assert.match(m.swatch, HEX);
  }
});

test('知らないデザイン名は既定へ落ちる（保存済みの設定が壊れても遊べる）', () => {
  assert.equal(materialFor('gelatin').key, DEFAULT_MATERIAL);
  assert.equal(materialFor(undefined).key, DEFAULT_MATERIAL);
  assert.equal(materialFor(null).key, DEFAULT_MATERIAL);
});

test('廃止したデザインを選んだままの端末も、黙って既定へ落ちる', () => {
  // 石・木・金属・紙・布・ガラスは廃止した。設定に残っていても遊べなくならない
  for (const gone of ['stone', 'wood', 'metal', 'paper', 'fabric', 'glass']) {
    assert.equal(materialFor(gone).key, DEFAULT_MATERIAL, `${gone} が既定へ落ちない`);
  }
});

test('どのデザインも、描くのに要る寸法をすべて持っている', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    for (const field of ['depth', 'gap', 'tint', 'shadow']) {
      assert.equal(typeof m[field], 'number', `${key}.${field} が数値でない`);
      assert.ok(m[field] >= 0 && m[field] <= 2, `${key}.${field} が範囲外`);
    }
    // 平らに塗るか、写真を貼るか。どちらでもない描き方は無い
    assert.ok(m.flat || m.photo, `${key} の描き方が決まっていない`);
    for (const kind of ['grey', 'lit']) {
      for (const slot of ['top', 'mid', 'deep', 'side']) {
        assert.match(m.colors[kind][slot], HEX, `${key}.${kind}.${slot} が色でない`);
      }
    }
  }
});

/*
 * 受け皿（盤面という 1 枚の面）は廃した。
 *
 * 昔は枠を立て、床を落とし、空きマスを窪みにしていたが、その面は遊ぶのに
 * 何ひとつ足していなかった ―― どこがマスかはブロックの並びで分かるし、通路は
 * 「ブロックが載っていないところ」として読める。面が 1 枚あるぶん、背景・受け皿・
 * ブロックと明るさの段が 3 つになり、ブロックの輪郭がいちばん強い境目でなくなる。
 * いまはキャンバスを透かして、盤面のあたりも背景とまったく同じ色にしてある。
 */
test('どのデザインも受け皿を持たない（盤面という面そのものを廃した）', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    assert.equal(m.tray, undefined, `${key} に受け皿の色が残っている`);
    assert.equal(m.trayTint, undefined, `${key} に受け皿の色づけが残っている`);
  }
});

test('灰色ブロックは進行度で色が変わらない（動く色との対比が消えない）', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    const a = paletteFor(m, false, progressColor(0).base);
    const b = paletteFor(m, false, progressColor(1).base);
    assert.equal(a.mid, b.mid, `${key}: 灰色が進行度で動いている`);
  }
});

test('色つきブロックは、どの進行度でも灰色ブロックと見分けられる', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    const grey = paletteFor(m, false, null);
    for (let i = 0; i <= 20; i++) {
      const lit = paletteFor(m, true, progressColor(i / 20).base);
      const dl = Math.abs(luma(lit.mid) - luma(grey.mid));
      const [r1, g1, b1] = hexRgb(lit.mid);
      const [r2, g2, b2] = hexRgb(grey.mid);
      const dc = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      // 明るさか色みか、どちらかで十分に離れていればよい
      assert.ok(dl > 24 || dc > 70,
        `${key} の t=${i / 20}: 色つきと灰色が近すぎる（明るさ差 ${dl.toFixed(0)} / 色差 ${dc}）`);
    }
  }
});

test('既定は写真のクリスタル。読みやすいプレーンへはいつでも戻せる', () => {
  const m = materialFor(DEFAULT_MATERIAL);
  assert.ok(m.photo, '既定のデザインが写真のものでない');
  // 逃げ道が消えていないこと。プレーンは「速く読む」ための道具として要る
  assert.ok(MATERIAL_KEYS.includes('plain'), 'プレーンが選べなくなっている');
  assert.ok(materialFor('plain').flat, 'プレーンが平らでない');
});

test('平らなデザインは進行度の色をそのまま着る（明るさに引き戻さない）', () => {
  const m = materialFor('plain');
  for (const t of [0, 0.5, 1]) {
    const c = progressColor(t).base;
    assert.equal(paletteFor(m, true, c).mid, c, `t=${t} で色が引かれている`);
  }
});

