// レベルデータの事前生成。
//   node tools/levels.mjs [レベル数]
//
// src/exact.js は「到達できる盤面を全部展開していちばん遠いものを選ぶ」ので、
// 出てくる手数は厳密な最短手数になる代わりに、1問あたり数秒〜数十秒かかる。
// レベルは番号で決まる（＝毎回同じ盤面）ので、ここで作ってデータとして同梱する。
//
// 難易度順は「作ってから並べ替える」。盤面サイズと埋め率をいくら振っても
// 出てくる手数は前もって読めないので、候補をたくさん作って最短手数の昇順に
// 並べ、それをそのままレベル順にする。

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateExactPuzzle } from '../src/exact.js';
import { hashSeed } from '../src/rng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/levelData.js');

const want = Number(process.argv[2] || 24);

/** 振ってみる設定。6×6 前後・埋め率9割あたりがいちばん手数が伸びる */
const RECIPES = [];
for (const size of [5, 6, 7]) {
  for (const fill of [0.78, 0.83, 0.86, 0.89, 0.92]) RECIPES.push({ size, fill });
}

const pool = [];
const t0 = Date.now();
let attempts = 0;

for (let round = 0; pool.length < want && round < 8; round++) {
  for (const recipe of RECIPES) {
    if (pool.length >= want) break;
    attempts++;
    const seed = hashSeed(`slidepop/exact/${recipe.size}/${recipe.fill}/${round}`);
    const t = Date.now();
    const r = generateExactPuzzle(seed, { ...recipe, tries: 3, cap: 60000 });
    if (!r || r.optimal < 6) continue;
    pool.push({
      size: recipe.size,
      fill: Number((r.board.filledCells / (recipe.size * recipe.size)).toFixed(3)),
      optimal: r.optimal,
      states: r.states,
      pieces: r.board.snapshot().pieces.map((p) => ({ c: p.color, s: p.cells })),
      solution: r.solution.map((s) => [s.pieceId, s.dir, s.distance]),
    });
    console.error(`  ${recipe.size}x${recipe.size} fill${recipe.fill} -> ${r.optimal}手 (${Date.now() - t}ms)`);
  }
}

// 手数の昇順がそのままレベル順。候補は切り捨てない（難しいものほど貴重）
pool.sort((a, b) => a.optimal - b.optimal);
const levels = pool;

const body = levels.map((l) => JSON.stringify(l)).join(',\n  ');
const code = `// tools/levels.mjs が生成。直接編集しないこと。
//
// 各レベルは「到達できる盤面を全部展開して、ゴールからいちばん遠い配置」を選んだもの。
// optimal は推定ではなく**厳密な最短手数**で、これより短く解く方法は存在しない。
// solution はその最短手順（[ブロックid, 向き, 滑るマス数] の並び）。

export const LEVEL_DATA = [
  ${body},
];
`;
await writeFile(OUT, code);

console.error('');
console.error(`レベル ${levels.length} 件 / 候補 ${pool.length} 件 / ${attempts} 回試行 / ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
console.error(`最短手数: ${levels[0].optimal} 〜 ${levels[levels.length - 1].optimal}`);
console.error(`src/levelData.js に書き出しました`);
