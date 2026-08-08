// 採集した盤面をレベルに割り当てて src/levelData.js を書き出す。
//   node tools/levels.mjs [--levels 1000] [--pool data]
//
// 採集（tools/harvest.mjs）は「手数ごとの在庫」を作るだけで、レベル番号は付けない。
// ここでその在庫を手数カーブ（src/levels.js の PAR_ANCHORS）に流し込む。
//
//   Lv1 → 2手 ／ Lv20 → 20手 ／ Lv50 → 40手 ／ Lv100 → 80手
//   Lv500 → 100手 ／ Lv800 → 122手 ／ Lv950 → 162手 ／ Lv1000 → 300手
//
// 在庫がぴったり無い手数は、いちばん近い手数で埋める（無い手数を待って止まるより、
// 1手ずれても並べたほうがカーブは滑らかになる）。最後に手数の昇順へ並べ直すので、
// レベルが上がって手数が減ることは絶対に起きない。
//
// 選び方の決まりは3つ:
//
//   ① 1枚の盤面からは1レベルまで。
//      全探索の距離マップは1枚から何十問でも切り出せるが、切り出したものは
//      灰色の位置こそ違え、ブロックの顔ぶれ（配役）が同じままになる。
//      並べると「さっきと同じ盤面」に見えるので、使い回さない。
//
//   ② 盤面はできるだけ小さいものから使う。
//      同じ手数なら小さい盤面のほうが読みやすく、詰まった手触りも出る。
//      4×4 で足りるなら 4×4、そこに無ければ 5×5、6×6 …と広げていく。
//      110手級は 6×6 以上でしか出ないので、上のレベルだけが自然に広くなる。
//
//   ③ 灰色の2マスブロック（1×2・2×1）が少ない盤面から使う。
//      ただし大きい色つき（2×2 以上）の盤面は 2マス1個ぶん優遇する ――
//      2マスを減らすことだけを追うと、大きい色つきが全部押し出されてしまう。
//      小さい灰色が並ぶと盤面が細切れに見えて、どこが通路なのか読みにくい。
//      ただし2マスを無くすと盤面が動かなくなって手数が伸びない（実測: 禁止すると
//      最深90手まで落ちる）ので、**禁止ではなく「少ないものを選ぶ」**で効かせる。
//      在庫を多めに集めておくほど、ここで選べる幅が広がる。

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
/** 大きい色つきを「2マスの灰色◯個ぶん」として優遇するか */
const BIG_COLOR_BONUS = Number(arg('bigcolor', 3));
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
    const pieces = decodeLevel(row.code).pieces;
    // 灰色のうち2マスのものが何個あるか（少ないほど好ましい）
    row.dominoes = pieces.slice(2).filter((p) => p.w * p.h === 2).length;
    row.greys = pieces.length - 2;
    // 色つきが 2×2 以上かどうか。2マスの灰色1個ぶんの価値として扱う ――
    // 2マスを減らすことだけを追うと、大きい色つきの盤面が全部押し出されてしまう
    // （在庫の 12% はあるのに、焼き上がりでは 1000 本中 1 本まで減った）
    row.bigColor = pieces.slice(0, 2).some((p) => p.w * p.h >= 4) ? 1 : 0;
    row.rank = row.dominoes - row.bigColor * BIG_COLOR_BONUS;
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

// 同じ手数の在庫は「盤面が小さい順 → 見た目の評点が良い順」に並べる。
// 評点は「2マスの灰色の数 − 大きい色つきなら1」。同点は符号順（何度回しても同じ結果に）
for (const rows of stock.values()) {
  rows.sort((a, b) => a.size - b.size
    || a.rank - b.rank
    || a.dominoes - b.dominoes
    || (a.code < b.code ? -1 : 1));
}

const usedLayouts = new Map();
const usedCodes = new Set();

/**
 * 手数 par の在庫から1本取る。すでに maxUse 回使った盤面のものは飛ばす。
 * 在庫は小さい盤面から並んでいるので、先頭から見るだけで②が満たされる。
 */
const takeFrom = (par, maxUse) => {
  const rows = stock.get(par);
  if (!rows) return null;
  for (const row of rows) {
    if (usedCodes.has(row.code)) continue;
    if ((usedLayouts.get(row.lay) || 0) >= maxUse) continue;
    usedCodes.add(row.code);
    usedLayouts.set(row.lay, (usedLayouts.get(row.lay) || 0) + 1);
    return row;
  }
  return null;
};

/** 目標 target に近い手数から順に1本取る。無ければ null */
const takeNear = (target, maxUse, radius) => {
  const hit = takeFrom(target, maxUse);
  if (hit) return hit;
  for (let d = 1; d <= radius; d++) {
    const row = takeFrom(target - d, maxUse) || takeFrom(target + d, maxUse);
    if (row) return row;
  }
  return null;
};

// ── レベルに割り当てる ──
// 探す順は「①ぴったりの手数 → ②近い手数 → ③盤面の使い回しを許す」。
// 使い回しは最後の手段で、在庫が足りているかぎり起きない。
//
// **長い手数から先に割り当てる。** 300手の盤面は在庫に1枚しか無いのに、
// 掘り直したものは元の（浅い）行と同じ盤面から出ているので、浅いレベルに
// 先に取られると300手のほうが使えなくなる ―― 希少なほうから押さえる。
const widest = Math.max(...stock.keys(), 1);
const chosen = [];
const substituted = [];
const order = [];
for (let lv = 1; lv <= want; lv++) order.push(lv);
order.sort((a, b) => targetPar(b) - targetPar(a));
for (const lv of order) {
  const target = targetPar(lv);
  let row = null;
  for (let maxUse = 1; maxUse <= 4 && !row; maxUse++) {
    // 近い手数から探し、無ければ手数がどれだけ離れていても在庫から埋める。
    // **盤面の使い回し（maxUse を上げること）はいちばん最後**にしか許さない
    // ―― 手数が狙いから外れるより、同じ盤面が2回出るほうが目につくため。
    // カーブは最後に手数の昇順へ並べ直すので、崩れるのは「狙いどおりか」だけ
    row = takeNear(target, maxUse, 40) || takeNear(target, maxUse, widest);
  }
  if (!row) {
    console.error(`在庫を使い切りました（${chosen.length} 本で打ち止め）`);
    break;
  }
  if (row.par !== target) substituted.push([lv, target, row.par]);
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
let dominoes = 0;
let greys = 0;
for (const row of chosen) {
  sizes.set(row.size, (sizes.get(row.size) || 0) + 1);
  layouts.add(row.lay);
  dominoes += row.dominoes;
  greys += row.greys;
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
console.error(`盤面を使い回したレベル: ${chosen.length - layouts.size} 本（0 なら全レベルが別の盤面）`);
console.error(`目標カーブとのずれ: 平均 ${avg(err).toFixed(2)}手 / 最大 ${Math.max(...err)}手 / 代用 ${substituted.length} 件`);
console.error(`盤面の広さ: ${[...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${s}:${n}`).join(' ')}`);
console.error(`色つきの形: ${[...colorShapes.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' ')}`);
console.error(`灰色の2マス: ${dominoes}/${greys} (${((dominoes / greys) * 100).toFixed(1)}%) / 1盤面あたり ${(dominoes / chosen.length).toFixed(1)}個`);
console.error(`データの大きさ: ${(code.length / 1024).toFixed(0)}KB`);
console.error(`${OUT} に書き出しました`);
for (const [lv, tgt, got] of substituted.slice(0, 10)) {
  console.error(`  代用 Lv${lv}: ${tgt}手 -> ${got}手`);
}
