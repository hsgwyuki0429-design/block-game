// 配信物のテスト。
// index.html と app.js が食い違うと盤面が真っ白になる（実際に起きた）ので、
// src/ から生成し直したものと一致しているかを必ず確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('app.js と index.html は src/ から生成された最新のもの', () => {
  execFileSync(process.execPath, ['tools/build.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('index.html はハッシュ付きの app.js を 1 つだけ読み込む', () => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const scripts = html.match(/<script[^>]*>/g) || [];
  assert.equal(scripts.length, 1, 'script タグは 1 つだけであるべき');
  assert.match(scripts[0], /src="app\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /href="styles\.css\?v=[0-9a-f]{10}"/);
  // モジュール読み込みが残っていると、古いキャッシュと混ざる余地ができる
  assert.ok(!html.includes('type="module"'), 'module 読み込みは残さない');
  assert.ok(!html.includes('src/main.js'), 'src/ を直接読み込まない');
});

test('app.js は単一のスコープに閉じている', () => {
  const code = readFileSync(resolve(ROOT, 'app.js'), 'utf8');
  assert.ok(code.startsWith('// SLIDE POP!'), '生成物のしるしが無い');
  assert.ok(code.includes("'use strict'"));
  // import / export が残っていると classic script として読めない
  assert.ok(!/^\s*import\s/m.test(code), 'import が残っている');
  assert.ok(!/^\s*export\s/m.test(code), 'export が残っている');
});
