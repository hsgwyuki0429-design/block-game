// 生成器の健全性チェック。
//   node tools/verify.mjs [最大レベル] [開始レベル]
// レベル 1..N をすべて生成し、「解答手順で本当に全消しできるか」を確かめて統計を出す。

import { generateLevel, verifySolution } from '../src/generator.js';
import { Board } from '../src/board.js';
import { levelFlavor } from '../src/levels.js';

const maxLevel = Number(process.argv[2] || 60);
const from = Number(process.argv[3] || 1);

let failures = 0;
const rows = [];
const times = [];
const t0 = Date.now();

for (let level = from; level <= maxLevel; level++) {
  const t1 = Date.now();
  let puzzle;
  try {
    puzzle = generateLevel(level);
  } catch (err) {
    console.error(`Lv${level}: 生成失敗 - ${err.message}`);
    failures++;
    continue;
  }
  const ms = Date.now() - t1;
  times.push(ms);

  const check = verifySolution(puzzle.snapshot, puzzle.solution, puzzle.size);
  if (!check.ok) {
    console.error(`Lv${level}: 検証失敗 - ${check.reason}`);
    failures++;
    continue;
  }

  const board = new Board(puzzle.size);
  board.restore(puzzle.snapshot);
  if (board.hasSameColorContact()) {
    console.error(`Lv${level}: 初期盤面に同色接触`);
    failures++;
  }
  if (board.isDeadlock()) {
    console.error(`Lv${level}: 初期盤面が既に詰み`);
    failures++;
  }

  const sizes = new Set([...board.pieces.values()].map((p) => p.cells.length));
  rows.push({
    level,
    size: puzzle.size,
    cells: puzzle.cells,
    fill: puzzle.cells / (puzzle.size * puzzle.size),
    par: puzzle.par,
    pieces: puzzle.pieces,
    colors: puzzle.colors,
    kinds: [...sizes].sort((a, b) => a - b).join('/'),
    flavor: levelFlavor(puzzle.config),
    ms,
  });
}

const head = 'Lv   盤面   ブロック  埋め率  PAR  個数  色  ブロック構成';
console.log(head);
console.log('-'.repeat(head.length + 8));
for (const r of rows) {
  if (r.level > 30 && r.level % 5 !== 0) continue; // 30 以降は 5 レベルおきに表示
  console.log(
    String(r.level).padStart(3),
    `${r.size}x${r.size}`.padStart(6),
    r.kinds.padStart(9) + 'セル',
    `${(r.fill * 100).toFixed(0)}%`.padStart(6),
    String(r.par).padStart(4),
    String(r.pieces).padStart(5),
    String(r.colors).padStart(3),
    ' ' + r.flavor,
  );
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('-'.repeat(head.length + 8));
console.log(`レベル ${from}〜${maxLevel} / ${Date.now() - t0}ms`);
console.log(`失敗            : ${failures}`);
console.log(`埋め率          : 平均 ${(avg(rows.map((r) => r.fill)) * 100).toFixed(1)}%`);
console.log(`PAR             : 平均 ${avg(rows.map((r) => r.par)).toFixed(1)} (${Math.min(...rows.map((r) => r.par))}〜${Math.max(...rows.map((r) => r.par))})`);
console.log(`生成時間        : 平均 ${avg(times).toFixed(0)}ms / 最大 ${Math.max(...times)}ms`);
process.exit(failures > 0 ? 1 : 0);
