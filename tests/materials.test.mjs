// 素材のテスト。
//
// 見た目そのものは目で確かめるしかないが、**目で気づきにくいのに致命的な**
// ところだけは機械で押さえておく:
//
//   ・タイルが本当に継ぎ目なく繋がっているか（繋がっていないと盤面に格子が走る）
//   ・灰色ブロックと色つきブロックが、どの進行度でも見分けられるか
//   ・素材を足したときに、寸法や色の入れ忘れが無いか
//
// 継ぎ目の検査には Canvas が要るので、無い環境（素の node）では飛ばす。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIAL_KEYS, DEFAULT_MATERIAL, materialFor, materialList,
  paletteFor, texturePaletteFor, trayPaletteFor, facetShade, LIGHT,
  makeNoise, noiseAt, fbm2,
} from '../src/materials.js';
import { makeRng } from '../src/rng.js';
import { luma, hexRgb } from '../src/color.js';
import { progressColor } from '../src/render.js';

const HEX = /^#[0-9a-f]{6}$/;

test('素材は一覧と引き当てが噛み合っている', () => {
  assert.ok(MATERIAL_KEYS.length >= 7);
  assert.ok(MATERIAL_KEYS.includes(DEFAULT_MATERIAL));
  assert.equal(materialList().length, MATERIAL_KEYS.length);
  for (const m of materialList()) {
    assert.ok(MATERIAL_KEYS.includes(m.key));
    assert.ok(m.name.length > 0, `${m.key} に名前が無い`);
    assert.match(m.swatch, HEX);
  }
});

test('知らない素材名は既定の素材に落ちる（保存済みの設定が壊れても遊べる）', () => {
  assert.equal(materialFor('gelatin').key, DEFAULT_MATERIAL);
  assert.equal(materialFor(undefined).key, DEFAULT_MATERIAL);
  assert.equal(materialFor(null).key, DEFAULT_MATERIAL);
});

test('どの素材も、立体を組み立てるのに要る寸法をすべて持っている', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    for (const field of ['depth', 'bevel', 'gap', 'gloss', 'sheen', 'tint', 'shadow']) {
      assert.equal(typeof m[field], 'number', `${key}.${field} が数値でない`);
      assert.ok(m[field] >= 0 && m[field] <= 2, `${key}.${field} が範囲外`);
    }
    assert.ok(['soft', 'facet'].includes(m.bevelStyle), `${key}.bevelStyle が不正`);
    // 模様を持たないのは、平らな素材（プレーン）と写真を貼る素材（クリスタル）
    // だけ。持たないことが仕様なので「関数か null か」を見る ――
    // undefined（書き忘れ）はここで落ちる
    if (m.flat || m.photo) assert.equal(m.texture, null, `${key} は模様を持たないはず`);
    else assert.equal(typeof m.texture, 'function', `${key} にテクスチャが無い`);
    for (const kind of ['grey', 'lit']) {
      for (const slot of ['top', 'mid', 'deep', 'side']) {
        assert.match(m.colors[kind][slot], HEX, `${key}.${kind}.${slot} が色でない`);
      }
    }
    for (const slot of ['frame', 'floor', 'well']) {
      assert.match(m.tray[slot], HEX, `${key}.tray.${slot} が色でない`);
    }
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

test('既定の素材は、いちばん読みやすい平らなもの', () => {
  const m = materialFor(DEFAULT_MATERIAL);
  assert.ok(m.flat, '既定の素材が平らでない');
  assert.equal(m.depth, 0);
  assert.equal(m.shadow, 0);
});

test('平らな素材は進行度の色をそのまま着る（素材の明るさに引き戻さない）', () => {
  const m = materialFor('plain');
  for (const t of [0, 0.5, 1]) {
    const c = progressColor(t).base;
    assert.equal(paletteFor(m, true, c).mid, c, `t=${t} で色が素材に引かれている`);
  }
});

test('平らな素材だけ、盤面も進行度の色を追いかける', () => {
  const plain = materialFor('plain');
  const stone = materialFor('stone');
  const a = trayPaletteFor(plain, progressColor(0).base);
  const b = trayPaletteFor(plain, progressColor(1).base);
  assert.notEqual(a.floor, b.floor, 'プレーンの盤面が進行度で動いていない');
  // 盤面は「ほとんど白」でなければならない。濃いと色つきブロックと紛れる
  for (const p of [a, b]) assert.ok(luma(p.floor) > 200, `盤面が濃すぎる（${p.floor}）`);
  // それ以外の素材は据え置き（動かすと 1 手ごとにトレイを焼き直すことになる）
  assert.equal(
    trayPaletteFor(stone, progressColor(0).base).floor,
    trayPaletteFor(stone, progressColor(1).base).floor,
  );
});

test('立体の素材は、盤面とブロックの明るさがはっきり離れている（輪郭が読める）', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    if (m.flat) continue;
    const tray = luma(m.tray.floor);
    for (const kind of ['grey', 'lit']) {
      const block = luma(m.colors[kind].mid);
      /*
       * どちらが明るいかは問わない。削り出しの素材は「明るい塊を暗い受け皿に
       * 載せる」が読みやすいが、写真のクリスタルはその逆 ―― 白い盤面に
       * 透明なガラスが置いてある。要るのは差そのもので、向きではない。
       */
      assert.ok(Math.abs(block - tray) > 40,
        `${key}: ${kind} ブロック（${block.toFixed(0)}）と盤面（${tray.toFixed(0)}）の差が小さい`);
    }
  }
});

test('テクスチャの色は進行度で動かない（動くと毎回焼き直しになる）', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    assert.equal(texturePaletteFor(m, true).key, texturePaletteFor(m, true).key);
    assert.notEqual(texturePaletteFor(m, true).key, texturePaletteFor(m, false).key);
    assert.equal(trayPaletteFor(m).key, `${key}|tray`);
  }
});

test('面取りは、光の来ている側がいちばん明るい', () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    const toward = facetShade(m, LIGHT.x, LIGHT.y);
    const away = facetShade(m, -LIGHT.x, -LIGHT.y);
    const side = facetShade(m, -LIGHT.y, LIGHT.x);
    assert.ok(toward > away, `${key}: 光の側が暗い`);
    assert.ok(toward > side, `${key}: 光の側が横より暗い`);
    assert.ok(toward - away > 0.2, `${key}: 面ごとの差が小さすぎて立体に見えない`);
  }
});

// ---------------------------------------------------------------- 継ぎ目

/*
 * 継ぎ目の大もとはノイズの折り返し。ここが繋がっていないと、テクスチャを
 * 繰り返して敷いたときにブロックの上を格子の線が走る（実際に走った）。
 * Canvas の無い環境でも回せるよう、絵ではなく**関数の値**で確かめる。
 */

test('ノイズは、周回数が整数なら端と端が一致する', () => {
  const g = makeNoise(makeRng(4242));
  for (const [fx, fy] of [[1, 1], [3, 8], [2, 70], [110, 3], [52, 52]]) {
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      assert.ok(Math.abs(noiseAt(g, 0, t, fx, fy) - noiseAt(g, 1, t, fx, fy)) < 1e-9,
        `左右が繋がっていない (fx=${fx}, fy=${fy}, v=${t})`);
      assert.ok(Math.abs(noiseAt(g, t, 0, fx, fy) - noiseAt(g, t, 1, fx, fy)) < 1e-9,
        `上下が繋がっていない (fx=${fx}, fy=${fy}, u=${t})`);
    }
  }
});

test('重ねたノイズも端と端が一致する（どのオクターブも整数のままだから）', () => {
  const g = makeNoise(makeRng(99));
  for (const ridge of [false, true]) {
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      assert.ok(Math.abs(fbm2(g, 0, t, 3, 3, 4, 0.55, ridge) - fbm2(g, 1, t, 3, 3, 4, 0.55, ridge)) < 1e-9);
      assert.ok(Math.abs(fbm2(g, t, 0, 2, 3, 3, 0.5, ridge) - fbm2(g, t, 1, 2, 3, 3, 0.5, ridge)) < 1e-9);
    }
  }
});

test('周回数が整数でなければ、端は繋がらない（この前提が崩れたら気づけるように）', () => {
  const g = makeNoise(makeRng(7));
  // 2.5 は round で 3 に丸められるので、丸めが効いていることも同時に確かめる
  assert.ok(Math.abs(noiseAt(g, 0, 0.3, 2.5, 4) - noiseAt(g, 0, 0.3, 3, 4)) < 1e-9);
});

/**
 * タイルの端どうしが繋がっているかを測る。
 * 右端の列と左端の列は、繰り返して敷いたときに隣り合う ―― ここが食い違うと
 * ブロックの上に縦線が走る。上下も同じ。
 */
function seamError(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const px = ctx.getImageData(0, 0, w, h).data;
  const at = (x, y, c) => px[(y * w + x) * 4 + c];
  let worst = 0;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      // 端をまたいだ差と、内側どうしの差を比べる。
      // 模様そのものの起伏より端の段差が大きければ、そこが継ぎ目
      const across = Math.abs(at(w - 1, y, c) - at(0, y, c));
      const inside = Math.abs(at(w - 2, y, c) - at(w - 1, y, c));
      worst = Math.max(worst, across - inside);
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      const across = Math.abs(at(x, h - 1, c) - at(x, 0, c));
      const inside = Math.abs(at(x, h - 2, c) - at(x, h - 1, c));
      worst = Math.max(worst, across - inside);
    }
  }
  return worst;
}

test('テクスチャのタイルは継ぎ目なく繰り返せる', { skip: typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined' }, () => {
  for (const key of MATERIAL_KEYS) {
    const m = materialFor(key);
    if (!m.texture) continue;
    const tile = m.texture(texturePaletteFor(m, false), 12345);
    assert.ok(seamError(tile) < 26, `${key}: タイルの端が繋がっていない`);
  }
});
