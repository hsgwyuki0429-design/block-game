// 在庫の掘り直し。
//   node tools/remine.mjs [--pool data] [--levels 1000] [--out data/remine.jsonl]
//
// 採集（tools/harvest.mjs）は1枚の盤面から1問しか取らない。取るのは
// 「そのとき足りていない、いちばん長い手数」なので、**そのときの目標より深い盤面を
// 引いても、目標のところで切って捨てている**。
//
// 実際に、110手までしか要らなかった頃に採った在庫を掘り直したら、深さ 363手・
// 272手・243手 の盤面が出てきた。カーブの上端を引き上げたので、この眠っている
// ぶんを起こす ―― 新しく探し直すより桁違いに速い（1枚 0.25 秒）。
//
// やること:
//   1. 在庫の符号から盤面を組み直す
//   2. 記録してある手順を最後まで指す。ただし最後の1手は「消さずに動かす」だけ
//      ―― 色つき2個が触れた状態、つまり全探索の出発点（距離0）がそこに現れる
//   3. そこから探索し直して、その盤面が本当は何手まで出せるのかを測る
//   4. まだ足りていない手数のうち、いちばん長いものを1問だけ切り出す
//
// 元になった盤面は同じなので、出力する行には**元の行と同じ lay** を付ける。
// tools/levels.mjs は「1枚の盤面につき1レベルまで」で選ぶので、掘り直したほうが
// 採られれば浅いほうは自動的に使われない。

import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, Explorer } from '../src/exact.js';
import { decodeLevel, encodeLevel } from '../src/levelCodec.js';
import { Board, BLOCKER } from '../src/board.js';
import { makeRng, hashSeed } from '../src/rng.js';
import { targetPar } from '../src/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};

const poolDir = resolve(ROOT, arg('pool', 'data'));
const levels = Number(arg('levels', 1000));
const slack = Number(arg('slack', 1.05));
const out = resolve(ROOT, arg('out', 'data/remine.jsonl'));
/** 掘り直しは状態数が読めないので、採集より広めに取る */
const CAP = Number(arg('cap', 150000));

// ── 在庫を読む ──
const rows = [];
const seen = new Set();
for (const file of (await readdir(poolDir)).filter((f) => f.endsWith('.jsonl'))) {
  if (resolve(poolDir, file) === out) continue; // 自分の出力は読まない
  for (const line of (await readFile(resolve(poolDir, file), 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    rows.push(row);
  }
}

// ── まだ足りていない手数 ──
const have = new Map();
for (const row of rows) have.set(row.par, (have.get(row.par) || 0) + 1);
const need = new Map();
for (let lv = 1; lv <= levels; lv++) {
  const p = targetPar(lv);
  need.set(p, (need.get(p) || 0) + 1);
}
for (const [p, n] of need) {
  const short = Math.ceil(n * slack) - (have.get(p) || 0);
  if (short > 0) need.set(p, short);
  else need.delete(p);
}
const pars = [...need.keys()].sort((a, b) => b - a); // 深いほうから埋める

let want = 0;
for (const n of need.values()) want += n;
console.error(`在庫 ${rows.length} 枚 / 足りない手数 ${want} 本ぶん`);

/**
 * 在庫の1枚から「全探索の出発点」（色つきが触れている盤面）を復元する。
 * 最後の1手は applyMove せず movePiece で動かす ―― 消してしまうと盤面から
 * 色つきが消えて、探索する対象そのものが無くなる。
 */
function goalBoard(data) {
  const board = new Board(data.size);
  for (const p of data.pieces) board.addPiece(p.c, p.s, `${p.w}x${p.h}`);
  for (let i = 0; i < data.solution.length - 1; i++) {
    const [id, dir] = data.solution[i];
    if (!board.applyMove(id, dir)) return null;
  }
  const [id, dir, distance] = data.solution[data.solution.length - 1];
  if (board.slideDistance(id, dir) !== distance) return null;
  board.movePiece(id, dir, distance);
  return board;
}

await writeFile(out, '');
const ex = new Explorer(CAP);
const rng = makeRng(hashSeed('slidepop/remine'));
const t0 = Date.now();
let studied = 0;
let capped = 0;
let taken = 0;
let deepest = 0;
let pending = [];

const flush = async () => {
  if (!pending.length) return;
  await appendFile(out, `${pending.join('\n')}\n`);
  pending = [];
};

// 浅い在庫から深い手数が出ることもある（採ったときは深い手数が要らなかっただけ）
for (const row of rows) {
  if (!pars.some((p) => need.get(p))) break; // もう足りている
  const data = decodeLevel(row.code);
  const board = goalBoard(data);
  if (!board) continue;
  const colorIds = [...board.pieces.values()].filter((p) => p.color !== BLOCKER).map((p) => p.id);
  if (colorIds.length !== 2) continue;

  let ctx;
  try {
    ctx = compile(board, colorIds);
  } catch {
    continue;
  }
  if (!ex.run(ctx)) { capped++; continue; }
  studied++;
  if (ex.depth > deepest) deepest = ex.depth;

  // まだ足りていない手数のうち、この盤面で出せるいちばん長いものを1本だけ
  let pick = 0;
  for (const par of pars) {
    if (par > ex.depth) continue;
    if (!need.get(par)) continue;
    pick = par;
    break;
  }
  if (!pick || pick <= row.par) continue; // 元より浅いなら掘り直す意味がない

  const slots = ex.slotsForDistances(new Map([[pick, 1]]), rng).get(pick);
  if (!slots || !slots.length) continue;
  const puzzle = ex.puzzleAt(slots[0]);
  if (!puzzle) continue;
  let code;
  try {
    code = encodeLevel(puzzle);
  } catch {
    continue;
  }
  pending.push(JSON.stringify({
    par: pick, size: puzzle.size, cells: puzzle.cells, lay: row.lay, code,
  }));
  need.set(pick, need.get(pick) - 1);
  if (need.get(pick) <= 0) need.delete(pick);
  taken++;
  if (pending.length >= 64) await flush();

  if (studied % 200 === 0) {
    let left = 0;
    for (const n of need.values()) left += n;
    console.error(`  ${studied}/${rows.length} 調査 / 掘り出し ${taken} / 最深 ${deepest} / 残 ${left}`);
  }
}
await flush();

const left = [...need.entries()].filter(([, n]) => n > 0).sort((a, b) => b[0] - a[0]);
console.error(`調査 ${studied} 枚 / 打切 ${capped} / 掘り出し ${taken} 本 / 最深 ${deepest}手 / ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
if (left.length) {
  console.error(`まだ足りない手数: ${left.slice(0, 20).map(([p, n]) => `${p}手×${n}`).join(' ')}`);
}
console.error(`-> ${out}`);
