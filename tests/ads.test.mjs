// 広告（忍者AdMax）のテスト。
//
// 見たいのは「置き場所が揃っているか」と「既定では完全に切れているか」の 2 点。
// ID を入れ忘れたまま配信しても、空の枠や余計な通信が出てはいけない。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADMAX } from '../src/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const adsSource = read('src/ads.js');

/** 置き場所の id。ここが揃っていないと、設定を入れても広告は出ない */
const SLOTS = ['ad-home', 'ad-levels', 'ad-game', 'ad-clear'];

test('広告の枠は 4 か所そろっていて、既定では hidden', () => {
  for (const id of SLOTS) {
    const re = new RegExp(`<div class="[^"]*ad-slot[^"]*" id="${id}"[^>]*hidden`);
    assert.match(html, re, `${id} の枠が hidden 付きで見つからない`);
  }
});

test('設定の枠の名前は、置き場所の id と対応している', () => {
  const keys = Object.keys(ADMAX.slots).sort();
  assert.deepEqual(keys, SLOTS.map((id) => id.replace(/^ad-/, '')).sort());
});

test('既定では広告は切れている（ID を直書きしない）', () => {
  for (const [name, slot] of Object.entries(ADMAX.slots)) {
    assert.equal(slot.id, '', `${name} の広告ユニット ID は config.js で入れるもの`);
    // 大きさは先に場所を取るために使うので、入れ忘れると画面が飛び跳ねる
    assert.ok(slot.width > 0 && slot.height > 0, `${name} に大きさが無い`);
  }
});

test('広告のスクリプトは HTML には貼らない（組み立ては src/ads.js の仕事）', () => {
  assert.ok(!html.includes('shinobi.jp'), '忍者AdMax のタグを index.html に貼らない');
  assert.ok(!html.includes('admax-ads'), '広告の枠は src/ads.js が組み立てる');
  assert.match(adsSource, /adm\.shinobi\.jp\/st\/t\.js/);
});

test('忍者AdMax の作法どおりに組み立てている', () => {
  // 置き場所・依頼・描画スクリプトの 3 つでひと組
  assert.match(adsSource, /admax-ads/);
  assert.match(adsSource, /admaxId/);
  assert.match(adsSource, /window\.admaxads = window\.admaxads \|\| \[\]/);
  // 後から積んだ依頼を描かせるには、t.js を貼り直す必要がある
  assert.match(adsSource, /data-admax-loader|admaxLoader/);
});

test('読み込み前に場所を取る（画面が飛び跳ねない）', () => {
  assert.match(adsSource, /--ad-h/);
  assert.match(css, /min-height:\s*calc\(var\(--ad-h/);
});
