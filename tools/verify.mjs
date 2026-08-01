// 生成器の健全性チェック。
//   node tools/verify.mjs [最大レベル] [開始レベル]
// レベル 1..N をすべて生成し、「解答手順で本当に全消しできるか」を確かめて統計を出す。

import { generateLevel, verifySolution } from '../src/generator.js';
import { Board } from '../src/board.js';
import { levelSummary } from '../src/levels.js';

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
  if (board.allMoves().length === 0) {
    console.error(`Lv${level}: 初期盤面で1手も指せない`);
    failures++;
  }

  rows.push({
    level,
    size: puzzle.size,
    cells: puzzle.cells,
    fill: puzzle.cells / (puzzle.size * puzzle.size),
    par: puzzle.par,
    pieces: puzzle.pieces,
    colors: puzzle.colors,
    setup: puzzle.setupMoves,
    // 初手の選択肢の数。0 なら「仕込み手を通さないと何も消せない」
    open: puzzle.analysis.clearAtStart,
    forced: puzzle.analysis.forced,
    wantForced: puzzle.config.forced,
    summary: levelSummary(puzzle.config),
    ms,
  });
}

const head = 'Lv   盤面  埋め率  PAR  個数  色  仕込  初手  一本道   ms';
console.log(head);
console.log('-'.repeat(head.length + 4));
for (const r of rows) {
  if (r.level > 30 && r.level % 5 !== 0) continue; // 30 以降は 5 レベルおきに表示
  console.log(
    String(r.level).padStart(3),
    `${r.size}x${r.size}`.padStart(6),
    `${(r.fill * 100).toFixed(0)}%`.padStart(6),
    String(r.par).padStart(4),
    String(r.pieces).padStart(5),
    String(r.colors).padStart(3),
    String(r.setup).padStart(5),
    String(r.open).padStart(5),
    (r.wantForced ? (r.forced ? '  一本道' : '  分岐あり') : '      –').padStart(8),
    String(r.ms).padStart(5),
  );
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const forcedRows = rows.filter((r) => r.wantForced);
const setupRows = rows.filter((r) => r.setup > 0);
console.log('-'.repeat(head.length + 4));
console.log(`レベル ${from}〜${maxLevel} / ${Date.now() - t0}ms`);
console.log(`失敗            : ${failures}`);
console.log(`埋め率          : 平均 ${(avg(rows.map((r) => r.fill)) * 100).toFixed(1)}%`);
console.log(`PAR             : 平均 ${avg(rows.map((r) => r.par)).toFixed(1)} (${Math.min(...rows.map((r) => r.par))}〜${Math.max(...rows.map((r) => r.par))})`);
if (forcedRows.length) {
  console.log(`一本道の達成    : ${forcedRows.filter((r) => r.forced).length}/${forcedRows.length}`);
}
if (setupRows.length) {
  console.log(`仕込みが必須    : ${setupRows.filter((r) => r.open === 0).length}/${setupRows.length}`);
}
console.log(`生成時間        : 平均 ${avg(times).toFixed(0)}ms / 最大 ${Math.max(...times)}ms`);
process.exit(failures > 0 ? 1 : 0);
