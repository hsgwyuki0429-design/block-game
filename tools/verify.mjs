// 焼いたレベルの健全性チェック。
//   node tools/verify.mjs [最大レベル] [開始レベル]
//
// レベル 1..N をすべて組み立て、「手順どおりに指せば本当に全消しできるか」
// 「初期盤面から何も消せないか」「手数が目標カーブに沿っているか」を確かめる。

import { generateLevel, verifySolution } from '../src/generator.js';
import { Board } from '../src/board.js';
import { puzzleSummary, targetMoves, targetPar, BAKED_LEVELS } from '../src/levels.js';

const maxLevel = Number(process.argv[2] || BAKED_LEVELS);
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
    console.error(`Lv${level}: 組み立て失敗 - ${err.message}`);
    failures++;
    continue;
  }
  times.push(Date.now() - t1);

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
  if (board.allMoves().length === 0) {
    console.error(`Lv${level}: 初期盤面で1手も指せない`);
    failures++;
  }
  if (puzzle.analysis.clearAtStart !== 0) {
    console.error(`Lv${level}: 初手から消せてしまう`);
    failures++;
  }

  rows.push({
    level,
    size: puzzle.size,
    cells: puzzle.cells,
    fill: puzzle.cells / (puzzle.size * puzzle.size),
    par: puzzle.par,
    want: targetPar(level),
    pieces: puzzle.pieces,
    blockers: puzzle.blockers,
    dry: puzzle.analysis.dryStreak,
    silver: targetMoves(puzzle.par).silver,
    summary: puzzleSummary(puzzle),
  });
}

const head = 'Lv    盤面  埋め率   PAR  目標  ブロック   灰  無消去  ★★まで';
console.log(head);
console.log('-'.repeat(head.length + 4));
const step = Math.max(1, Math.round((maxLevel - from) / 40));
for (const r of rows) {
  if (r.level !== from && r.level !== maxLevel && r.level % step !== 0) continue;
  console.log(
    String(r.level).padStart(4),
    `${r.size}x${r.size}`.padStart(6),
    `${(r.fill * 100).toFixed(0)}%`.padStart(6),
    String(r.par).padStart(5),
    String(r.want).padStart(5),
    String(r.pieces).padStart(8),
    String(r.blockers).padStart(4),
    String(r.dry).padStart(6),
    String(r.silver).padStart(6),
  );
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sizes = new Map();
for (const r of rows) sizes.set(r.size, (sizes.get(r.size) || 0) + 1);
let drops = 0;
for (let i = 1; i < rows.length; i++) if (rows[i].par < rows[i - 1].par) drops++;

console.log('-'.repeat(head.length + 4));
console.log(`レベル ${from}〜${maxLevel} / ${Date.now() - t0}ms`);
console.log(`失敗              : ${failures}`);
console.log(`手数が減った箇所  : ${drops}`);
console.log(`埋め率            : 平均 ${(avg(rows.map((r) => r.fill)) * 100).toFixed(1)}%`);
console.log(`PAR               : ${Math.min(...rows.map((r) => r.par))}〜${Math.max(...rows.map((r) => r.par))}（平均 ${avg(rows.map((r) => r.par)).toFixed(1)}）`);
console.log(`目標カーブとのずれ: 平均 ${avg(rows.map((r) => Math.abs(r.par - r.want))).toFixed(2)}手 / 最大 ${Math.max(...rows.map((r) => Math.abs(r.par - r.want)))}手`);
console.log(`盤面の広さ        : ${[...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${s}:${n}`).join(' ')}`);
console.log(`組み立て時間      : 平均 ${avg(times).toFixed(1)}ms / 最大 ${Math.max(...times)}ms`);
process.exit(failures > 0 ? 1 : 0);
