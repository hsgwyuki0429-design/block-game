// ホーム画面に追加したときの配信物のテスト。
// マニフェスト・アイコン・Service Worker が揃っていて、
// index.html からちゃんと繋がっているかを確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const manifest = JSON.parse(read('manifest.webmanifest'));
const html = read('index.html');

const { SPRITE_FILES, SPRITE_KEYS } = await import('../src/sprites.js');

test('index.html がマニフェストと iOS 用の設定を持っている', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="SLIDE POP!"/);
  // 全画面で開いたときにノッチへ潜り込めるように
  assert.match(html, /viewport-fit=cover/);
});

test('マニフェストは全画面起動に必要な項目を揃えている', () => {
  assert.equal(manifest.name, 'SLIDE POP!');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#ffffff');
  assert.equal(manifest.theme_color, '#ffffff');
  assert.equal(manifest.lang, 'ja');
  // サブディレクトリ配信（GitHub Pages）でも壊れないよう、パスは相対で持つ
  for (const key of ['id', 'start_url', 'scope']) {
    assert.ok(manifest[key].startsWith('./'), `${key} は相対パスであるべき`);
  }
});

test('アイコンは 192 / 512 / マスカブル が揃っていて、実体がある', () => {
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./'), `${icon.src} は相対パスであるべき`);
    const file = resolve(ROOT, icon.src.replace(/^\.\//, ''));
    assert.ok(statSync(file).size > 0, `${icon.src} が空`);
    // PNG のしるし
    assert.deepEqual([...readFileSync(file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  }
  assert.ok(statSync(resolve(ROOT, 'icons/apple-touch-icon.png')).size > 0);
});

test('アイコンは tools/icons.mjs から生成された最新のもの', () => {
  execFileSync(process.execPath, ['tools/icons.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('Service Worker は相対パスで、ページ本体をネットワーク優先で扱う', () => {
  const sw = read('sw.js');

  // 先読みするパスはすべて相対。絶対パスだとサブディレクトリ配信で壊れる
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(shell, 'SHELL の一覧が見つからない');
  const paths = [...shell[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3);
  for (const p of paths) assert.ok(p.startsWith('./'), `${p} は相対パスであるべき`);
  for (const icon of manifest.icons) assert.ok(paths.includes(icon.src), `${icon.src} を先読みしていない`);

  // 写真の絵も先読みしておく（通信の無いところで素材を切り替えても崩れない）
  for (const f of SPRITE_FILES) {
    assert.ok(paths.includes(`./${f}`), `${f} を先読みしていない`);
  }

  assert.match(sw, /caches\.open\(/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  // 新しい版に取り残されないよう、ナビゲーションはネットワークを先に見る
  assert.match(sw, /req\.mode === 'navigate'/);
  // 内容ハッシュ付きのアセットを先読みできる
  assert.match(sw, /app\\\.js\|styles\\\.css/);
});

test('ページから Service Worker を登録している（file:// では登録しない）', () => {
  const app = read('app.js');
  assert.match(app, /serviceWorker.*register\('sw\.js'/s);
  assert.match(app, /location\.protocol\.startsWith\('http'\)/);
});

test('ホーム画面に「追加」ボタンと iOS 向けの手順がある', () => {
  assert.match(html, /id="btn-install"/);
  assert.match(html, /id="modal-install"/);
  const app = read('app.js');
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /appinstalled/);
  // 追加済みの端末にボタンを出さないための判定
  assert.match(app, /display-mode: standalone/);
});

/*
 * 写真の絵は、コードが名前で引く（`${cols}x${rows}`）。だから 1 枚でも欠けると、
 * その形のブロックだけ手続き的な見た目に戻り、盤の上で 2 種類の素材が混ざる。
 * 名前の付け方も含めて、機械で押さえておく。
 */
test('写真の絵は、出てくる形をすべて覆っている', async () => {
  const { PIECES } = await import('../src/shapes.js');
  const shapes = new Set(PIECES.map((p) => `${p.w}x${p.h}`));
  for (const key of shapes) {
    assert.ok(SPRITE_KEYS.includes(key), `${key} の絵が無い`);
  }
  // 空きマスの窪みも写真から貼る
  assert.ok(SPRITE_KEYS.includes('empty'));
  assert.equal(SPRITE_KEYS.length, shapes.size + 1);
});

test('写真の絵の実体がある（WebP として読める）', () => {
  for (const f of SPRITE_FILES) {
    const file = resolve(ROOT, f);
    const buf = readFileSync(file);
    assert.ok(buf.length > 0, `${f} が空`);
    // RIFF....WEBP
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'RIFF', `${f} が RIFF でない`);
    assert.equal(buf.subarray(8, 12).toString('latin1'), 'WEBP', `${f} が WebP でない`);
  }
});
