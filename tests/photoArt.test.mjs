// 写真から作るクリスタルのテスト。
//
// 見た目そのものは目で確かめるしかないが、**目で気づきにくいのに致命的な**
// ところだけは機械で押さえておく:
//
//   ・app.js に焼き込んだ写真が art/crystal/ と食い違っていないか
//     （食い違うと、直したはずの見た目が端末に届かない）
//   ・写真が 1 マス PHOTO_UNIT 画素で揃っているか
//     （揃っていないと、9 分割の縁の太さがブロックごとに変わる）
//   ・どんな大きさのブロックにも 1 枚選べるか（＝全部のレベルで貼れるか）

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_UNIT, PHOTO_CHAMFER, PHOTO_GAP, photoFor, photosReady } from '../src/photoArt.js';
import { materialFor } from '../src/materials.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(ROOT, 'art/crystal');

/** PNG の IHDR から幅・高さだけ読む */
function pngSize(file) {
  const buf = readFileSync(file);
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${file} が PNG でない`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

test('src/photoArt.js は art/crystal/ から生成された最新のもの', () => {
  execFileSync(process.execPath, ['tools/photoArt.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('写真は 1 マス PHOTO_UNIT 画素ちょうどで揃っている', () => {
  const files = readdirSync(ART).filter((f) => f.endsWith('.png'));
  assert.ok(files.length >= 3, '写真が足りない');
  for (const f of files) {
    const [cols, rows] = f.replace('.png', '').split('x').map(Number);
    assert.ok(cols >= 1 && rows >= 1, `${f} の名前が cols x rows になっていない`);
    const { w, h, bytes } = pngSize(resolve(ART, f));
    assert.equal(w, cols * PHOTO_UNIT, `${f} の幅が 1 マスぶんに揃っていない`);
    assert.equal(h, rows * PHOTO_UNIT, `${f} の高さが 1 マスぶんに揃っていない`);
    assert.ok(bytes > 0, `${f} が空`);
  }
});

test('写真は app.js に収まる大きさに収まっている', () => {
  // 全部 app.js に埋め込むので、ここが太ると起動が遅くなる。
  // 上限は「感じ取れる遅さが出ない」ところに置いてある（データ URI は 4/3 に膨らむ）
  const total = readdirSync(ART)
    .filter((f) => f.endsWith('.png'))
    .reduce((sum, f) => sum + statSync(resolve(ART, f)).size, 0);
  assert.ok(total < 120 * 1024, `写真の合計が大きすぎる（${(total / 1024).toFixed(0)}KB）`);
});

test('クリスタルは写真を貼るデザインとして組んである', () => {
  const m = materialFor('crystal');
  assert.ok(m.photo, 'クリスタルが写真のデザインになっていない');
  /*
   * 角を 45° で落とす深さは、写真の角の落とし（実測）を**超えてはいけない**。
   * 超えると角の切子をガラスごと削り、のっぺりした八角形になる。
   * 浅すぎても写真の角が丸ごと残って四隅に盤面が覗くので、下も押さえておく。
   */
  assert.ok(m.chamfer > 0, '角の落としが無い');
  assert.ok(m.chamfer <= PHOTO_CHAMFER,
    `角の落とし ${m.chamfer} が写真の実測 ${PHOTO_CHAMFER} より深い`);
  assert.ok(m.chamfer >= PHOTO_CHAMFER * 0.8,
    `角の落とし ${m.chamfer} が写真の実測 ${PHOTO_CHAMFER} より浅すぎる`);
  /*
   * 目地は、切り出しに使った内寄せとぴったり一致していなければならない。
   * ずれると、巻き込んだ影がブロックの内側へ入り込むか、縁が目地へはみ出す。
   */
  assert.equal(m.gap, PHOTO_GAP, `目地 ${m.gap} が切り出しの ${PHOTO_GAP} と違う`);
  assert.match(m.photoTint, /^#[0-9a-f]{6}$/, '灰色ブロックに被せる色が無い');
  // 平らな塗りの経路とは排他。両方立つと、写真の上にベタ塗りが乗る
  assert.ok(!m.flat, '写真を貼るのに平らな塗りにもなっている');
});

test('写真が読めていないあいだは、貼らずに無地へ落ちる（画面が消えない）', () => {
  // node には Image が無いので、ここは必ず「まだ読めていない」状態になる
  assert.equal(photosReady(), false);
  assert.equal(photoFor(1, 1), null);
});

test('どんな大きさのブロックにも、比のいちばん近い写真が選ばれる', () => {
  // 画像の復号は Image に頼らざるを得ないので、選ぶところだけを同じ式で確かめる。
  // 盤面に出るのは 1×2 〜 3×3（tests/levels.test.mjs）だが、
  // 将来広がっても選び漏れが出ないよう 8 マスまで見る
  const shapes = readdirSync(ART)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace('.png', '').split('x').map(Number));
  const pick = (cols, rows) => {
    const want = Math.log(cols / rows);
    let best = null;
    let score = Infinity;
    for (const [c, r] of shapes) {
      const d = Math.abs(Math.log(c / r) - want) * 8 + Math.abs(Math.log((c * r) / (cols * rows)));
      if (d < score) { score = d; best = [c, r]; }
    }
    return best;
  };
  for (let cols = 1; cols <= 8; cols++) {
    for (let rows = 1; rows <= 8; rows++) {
      const got = pick(cols, rows);
      assert.ok(got, `${cols}×${rows} に貼る写真が無い`);
      // 縦長のブロックに横長の写真を選んでしまうと、面取りが真横に伸びる
      const want = Math.sign(Math.log(cols / rows) * 1000 | 0);
      const has = Math.sign(Math.log(got[0] / got[1]) * 1000 | 0);
      assert.ok(want === 0 || has === 0 || want === has,
        `${cols}×${rows} に ${got[0]}x${got[1]} の写真が選ばれている（向きが逆）`);
    }
  }
});
