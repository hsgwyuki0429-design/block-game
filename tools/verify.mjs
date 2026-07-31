// 生成器の健全性チェック。
//   node tools/verify.mjs [件数] [オプションJSON]
// 全ての生成結果について「解答手順で本当に全消しできるか」を確かめ、統計を出す。

import { generatePuzzle, verifySolution, DEFAULT_OPTIONS } from '../src/generator.js';
import { Board } from '../src/board.js';

const count = Number(process.argv[2] || 100);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const opts = { ...DEFAULT_OPTIONS, ...overrides };

let failures = 0;
const cells = [];
const pars = [];
const clears = [];
let deadlockAtStart = 0;
const t0 = Date.now();

for (let i = 0; i < count; i++) {
  const seed = (i * 2654435761) >>> 0;
  let puzzle;
  try {
    puzzle = generatePuzzle(seed, overrides);
  } catch (err) {
    console.error(`seed ${seed}: 生成失敗 - ${err.message}`);
    failures++;
    continue;
  }
  const check = verifySolution(puzzle.snapshot, puzzle.solution, puzzle.size);
  if (!check.ok) {
    console.error(`seed ${seed}: 検証失敗 - ${check.reason}`);
    failures++;
    continue;
  }
  const board = new Board(puzzle.size);
  board.restore(puzzle.snapshot);
  if (board.isDeadlock()) {
    console.error(`seed ${seed}: 初期盤面が既に詰み`);
    deadlockAtStart++;
    failures++;
  }
  cells.push(puzzle.cells);
  pars.push(puzzle.par);
  for (const s of puzzle.solution) clears.push(s.cleared);
}

const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length);
const min = (a) => Math.min(...a);
const max = (a) => Math.max(...a);
const dist = (a) => {
  const m = new Map();
  for (const v of a) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(' ');
};

console.log(`--- ${count} 件 / ${Date.now() - t0}ms ---`);
console.log(`失敗                : ${failures} (うち初期詰み ${deadlockAtStart})`);
console.log(`埋めセル数          : 平均 ${avg(cells).toFixed(1)} (${min(cells)}〜${max(cells)}) = 平均 ${(avg(cells) / (opts.size * opts.size) * 100).toFixed(1)}%`);
console.log(`PAR(手数)           : 平均 ${avg(pars).toFixed(1)} (${min(pars)}〜${max(pars)})`);
console.log(`PAR 分布            : ${dist(pars)}`);
console.log(`1手の消去ブロック数 : 平均 ${avg(clears).toFixed(2)} / 分布 ${dist(clears)}`);
process.exit(failures > 0 ? 1 : 0);
