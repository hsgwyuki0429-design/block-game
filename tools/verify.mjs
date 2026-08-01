// 生成器の健全性チェック。
//   node tools/verify.mjs [最大レベル] [開始レベル]
// レベル 1..N をすべて生成し、「解答手順で本当に全消しできるか」を確かめて統計を出す。

import { generateLevel, verifySolution } from '../src/generator.js';
import { Board } from '../src/board.js';
import { puzzleSummary, targetTimes } from '../src/levels.js';

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
    chain: puzzle.chainMoves,
    wantChain: puzzle.config.chainMoves,
    setup: puzzle.setupMoves,
    // 初手の選択肢の数。0 なら「まず通路を作らないと1個も消せない」
    open: puzzle.analysis.clearAtStart,
    dry: puzzle.analysis.dryStreak,
    forced: puzzle.analysis.forced,
    gold: targetTimes(puzzle.par, puzzle.colors).gold,
    summary: puzzleSummary(puzzle),
    ms,
  });
}

const head = 'Lv   盤面  埋め率  PAR  個数  色  追込  仕込  初手  連続  ★★★    ms';
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
    `${r.chain}/${r.wantChain}`.padStart(5),
    String(r.setup).padStart(5),
    String(r.open).padStart(5),
    String(r.dry).padStart(5),
    `${Math.floor(r.gold / 60)}:${String(r.gold % 60).padStart(2, '0')}`.padStart(6),
    String(r.ms).padStart(5),
  );
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const setupRows = rows.filter((r) => r.setup > 0);
console.log('-'.repeat(head.length + 4));
console.log(`レベル ${from}〜${maxLevel} / ${Date.now() - t0}ms`);
console.log(`失敗            : ${failures}`);
console.log(`埋め率          : 平均 ${(avg(rows.map((r) => r.fill)) * 100).toFixed(1)}%`);
console.log(`PAR             : 平均 ${avg(rows.map((r) => r.par)).toFixed(1)} (${Math.min(...rows.map((r) => r.par))}〜${Math.max(...rows.map((r) => r.par))})`);
console.log(`初手が塞がった盤面: ${rows.filter((r) => r.open === 0).length}/${rows.length}`);
console.log(`追い込みの達成  : ${rows.filter((r) => r.chain >= r.wantChain).length}/${rows.length}`);
console.log(`最長の無消去連続: 平均 ${avg(rows.map((r) => r.dry)).toFixed(1)} / 最大 ${Math.max(...rows.map((r) => r.dry))}`);
console.log(`一本道になった  : ${rows.filter((r) => r.forced).length}/${rows.length}`);
if (setupRows.length) {
  console.log(`仕込みが必須    : ${setupRows.filter((r) => r.open === 0).length}/${setupRows.length}`);
}
console.log(`生成時間        : 平均 ${avg(times).toFixed(0)}ms / 最大 ${Math.max(...times)}ms`);
process.exit(failures > 0 ? 1 : 0);
