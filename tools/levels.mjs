// 採集した盤面をレベルに割り当てて src/levelData.js を書き出す。
//   node tools/levels.mjs [--levels 1000] [--pool data]
//
// 採集（tools/harvest.mjs）は「手数ごとの在庫」を作るだけで、レベル番号は付けない。
// ここでその在庫を手数カーブ（src/levels.js の PAR_ANCHORS）に流し込む。
//
//   Lv1 → 2手 ／ Lv20 → 20手 ／ Lv50 → 40手 ／ Lv100 → 80手
//   Lv500 → 100手 ／ Lv1000 → 110手
//
// 在庫がぴったり無い手数は、いちばん近い手数で埋める（無い手数を待って止まるより、
// 1手ずれても並べたほうがカーブは滑らかになる）。最後に手数の昇順へ並べ直すので、
// レベルが上がって手数が減ることは絶対に起きない。
//
// 同じ盤面（灰色の並びが同じ配役）ばかりが続かないよう、同じ手数の在庫は
// 元になった盤面ごとに輪番で取る。

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetPar } from '../src/levels.js';
import { decodeLevel } from '../src/levelCodec.js';
import { Board } from '../src/board.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/levelData.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};

const want = Number(arg('levels', 1000));
const poolDir = resolve(ROOT, arg('pool', 'data'));

// ── 在庫を読む ──
const files = (await readdir(poolDir)).filter((f) => f.endsWith('.jsonl'));
if (!files.length) {
  console.error(`${poolDir} に .jsonl がありません。先に tools/harvest.mjs を回してください。`);
  process.exit(1);
}

/**
 * 符号を実際に盤面へ組み直し、手順どおりに指して本当に消えるかを確かめる。
 * 採集側のバグを焼き込まないための関門なので、ここは必ず全件通す。
 */
function playable(code) {
  const data = decodeLevel(code);
  const board = new Board(data.size);
  for (const p of data.pieces) board.addPiece(p.c, p.s, `${p.w}x${p.h}`);
  if (board.hasSameColorContact()) return false;
  for (const [id, dir, distance] of data.solution) {
    const res = board.applyMove(id, dir);
    if (!res || res.steps !== distance) return false;
  }
  return board.isCleared;
}

/** @type {Map<number, {par:number,size:number,cells:number,lay:string,code:string}[]>} */
const stock = new Map();
const seen = new Set();
let read = 0;
let broken = 0;
for (const file of files) {
  const text = await readFile(resolve(poolDir, file), 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    read++;
    if (seen.has(row.code)) continue; // 同じ盤面は1回だけ
    seen.add(row.code);
    if (!playable(row.code)) { broken++; continue; }
    if (!stock.has(row.par)) stock.set(row.par, []);
    stock.get(row.par).push(row);
  }
}
if (broken) {
  console.error(`警告: 手順が通らない在庫が ${broken}/${read} 件ありました（採集側のバグです）`);
  if (broken > read * 0.01) {
    console.error('壊れている割合が高すぎます。src/exact.js を直してから採集し直してください。');
    process.exit(1);
  }
}

// 同じ手数の在庫は、元になった盤面ごとに輪番へ並べ替える
for (const [par, rows] of stock) {
  const byLayout = new Map();
  for (const row of rows) {
    if (!byLayout.has(row.lay)) byLayout.set(row.lay, []);
    byLayout.get(row.lay).push(row);
  }
  const lanes = [...byLayout.values()];
  const mixed = [];
  for (let i = 0; lanes.some((l) => l.length > i); i++) {
    for (const lane of lanes) if (lane[i]) mixed.push(lane[i]);
  }
  stock.set(par, mixed);
}

const cursor = new Map();
const takeFrom = (par) => {
  const rows = stock.get(par);
  if (!rows) return null;
  const i = cursor.get(par) || 0;
  if (i >= rows.length) return null;
  cursor.set(par, i + 1);
  return rows[i];
};

// ── レベルに割り当てる ──
const chosen = [];
const substituted = [];
for (let lv = 1; lv <= want; lv++) {
  const target = targetPar(lv);
  let row = takeFrom(target);
  if (!row) {
    // いちばん近い手数で代用する。近いほうから外へ広げていく
    for (let d = 1; d <= 40 && !row; d++) {
      row = takeFrom(target - d) || takeFrom(target + d);
    }
    if (row) substituted.push([lv, target, row.par]);
  }
  if (!row) {
    console.error(`Lv${lv}（${target}手）の在庫がありません。採集をもう少し回してください。`);
    break;
  }
  chosen.push(row);
}

// 手数の昇順がそのままレベル順。ここで並べ直すので、手数が減ることは起きない
chosen.sort((a, b) => a.par - b.par || a.size - b.size || (a.code < b.code ? -1 : 1));

// ── 書き出し ──
const lines = [];
for (let i = 0; i < chosen.length; i += 4) {
  lines.push(chosen.slice(i, i + 4).map((r) => `'${r.code}'`).join(', '));
}
const code = `// tools/harvest.mjs で採集し、tools/levels.mjs が並べたもの。直接編集しないこと。
//
// 1行1レベルではなく1文字列1レベル。詰め方は src/levelCodec.js を参照。
// どのレベルも「到達できる盤面を全部展開して、ゴールからちょうど N 手の配置」で、
// N（＝符号に入っている手数）は推定ではなく**厳密な最短手数**。
// これより短く解く方法は存在しない。

export const LEVEL_CODES = [
  ${lines.join(',\n  ')},
];
`;
await writeFile(OUT, code);

// ── 統計 ──
const sizes = new Map();
const colorShapes = new Map();
const layouts = new Set();
for (const row of chosen) {
  sizes.set(row.size, (sizes.get(row.size) || 0) + 1);
  layouts.add(row.lay);
  const d = decodeLevel(row.code);
  for (const p of d.pieces.slice(0, 2)) {
    const k = `${p.w}x${p.h}`;
    colorShapes.set(k, (colorShapes.get(k) || 0) + 1);
  }
}
const err = [];
for (let lv = 1; lv <= chosen.length; lv++) err.push(Math.abs(chosen[lv - 1].par - targetPar(lv)));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.error('');
console.error(`在庫 ${read} 行 / 重複を除いて ${seen.size} 件 / 使った盤面 ${layouts.size} 枚`);
console.error(`レベル ${chosen.length} 本 / 最短手数 ${chosen[0].par} 〜 ${chosen[chosen.length - 1].par}`);
console.error(`目標カーブとのずれ: 平均 ${avg(err).toFixed(2)}手 / 最大 ${Math.max(...err)}手 / 代用 ${substituted.length} 件`);
console.error(`盤面の広さ: ${[...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${s}:${n}`).join(' ')}`);
console.error(`色つきの形: ${[...colorShapes.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' ')}`);
console.error(`データの大きさ: ${(code.length / 1024).toFixed(0)}KB`);
console.error(`${OUT} に書き出しました`);
for (const [lv, tgt, got] of substituted.slice(0, 10)) {
  console.error(`  代用 Lv${lv}: ${tgt}手 -> ${got}手`);
}
