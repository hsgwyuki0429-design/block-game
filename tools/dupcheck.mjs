// 焼いたレベルの重複チェック。
//   node tools/dupcheck.mjs [最大レベル]
//
// 「同じ盤面が2回出てこないか」を、種類ごとに全件見る。全探索を伴うので
// 1000本で4分ほどかかる ―― tests/ には入れず、焼き直したときに回すこと。
//
// 見る重複は4種類。下にいくほど見つけにくい:
//
//   ① 符号がそのまま同じ
//   ② 初期盤面が、回転・鏡像で重なる
//   ③ くっついた瞬間の盤面が、回転・鏡像で重なる
//      ―― 途中がどう違っても「同じパズルの別の入口」でしかない
//   ④ 連結成分が同じ
//      ―― 初期もゴールも違うのに、滑らせて行き来できてしまう。
//         ひとつの成分に「くっついた形」が複数あると③をすり抜ける。
//
// ④の指紋は「その成分に含まれるくっついた形すべての正準形の最小値」。
// 成分のどこから始めても同じ値になるので、入口が違っても一致する。

import { LEVEL_CODES } from '../src/levelData.js';
import { decodeLevel } from '../src/levelCodec.js';
import { canonicalKey, rectsOf, compile, Explorer } from '../src/exact.js';
import { Board } from '../src/board.js';

const maxLevel = Math.min(Number(process.argv[2] || LEVEL_CODES.length), LEVEL_CODES.length);
const explorer = new Explorer(200000);

/** ctx と位置配列から長方形の一覧を組む（rectsOf は Board 用なので、ここは直接） */
function rectsAt(ctx, pos) {
  const rects = [];
  for (let k = 0; k < ctx.n; k++) {
    const ax = pos[k] % ctx.size;
    const ay = (pos[k] - ax) / ctx.size;
    let minx = Infinity; let miny = Infinity; let maxx = -1; let maxy = -1;
    for (const [sx, sy] of ctx.shapes[k]) {
      const x = ax + sx; const y = ay + sy;
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    }
    rects.push({ kind: k < 2 ? 'c' : 'g', x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 });
  }
  return rects;
}

/** レベル1本を調べて、4種類の指紋を返す */
function fingerprints(code) {
  const data = decodeLevel(code);
  const board = new Board(data.size);
  for (const p of data.pieces) board.addPiece(p.c, p.s, `${p.w}x${p.h}`);
  const colorIds = [...board.pieces.values()].filter((p) => p.color === 0).map((p) => p.id);

  const start = canonicalKey(data.size, rectsOf(board));

  let component = null;
  try {
    const ctx = compile(board, colorIds);
    if (explorer.run(ctx)) {
      const buf = new Uint8Array(32);
      for (const slot of explorer.slotsAtDistance(0, Infinity)) {
        const key = canonicalKey(ctx.size, rectsAt(ctx, explorer.read(slot, buf)));
        if (component === null || key < component) component = key;
      }
    }
  } catch { component = null; }

  for (let i = 0; i < data.solution.length - 1; i++) {
    board.applyMove(data.solution[i][0], data.solution[i][1]);
  }
  const [id, dir, distance] = data.solution[data.solution.length - 1];
  board.movePiece(id, dir, distance); // 消さずに動かす＝くっついた瞬間の形
  const goal = canonicalKey(data.size, rectsOf(board));

  return { code, start, goal, component };
}

const kinds = {
  '符号': new Map(),
  '初期盤面': new Map(),
  'くっついた形': new Map(),
  '連結成分': new Map(),
};
let unknown = 0;

for (let lv = 1; lv <= maxLevel; lv++) {
  const fp = fingerprints(LEVEL_CODES[lv - 1]);
  if (fp.component === null) unknown++;
  const add = (name, key) => {
    if (key == null) return;
    const m = kinds[name];
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(lv);
  };
  add('符号', fp.code);
  add('初期盤面', fp.start);
  add('くっついた形', fp.goal);
  add('連結成分', fp.component);
  if (lv % 100 === 0) process.stderr.write(`  ${lv}/${maxLevel}\n`);
}

let bad = 0;
console.log(`レベル 1〜${maxLevel}`);
for (const [name, m] of Object.entries(kinds)) {
  const dup = [...m.values()].filter((v) => v.length > 1).sort((a, b) => b.length - a.length);
  const extra = dup.reduce((s, v) => s + v.length - 1, 0);
  bad += extra;
  console.log(`${name.padEnd(14)} ${String(m.size).padStart(5)} 通り / 重複 ${String(extra).padStart(4)} 本`);
  for (const g of dup.slice(0, 10)) console.log(`    Lv ${g.slice(0, 12).join(', ')}`);
}
if (unknown) console.log(`展開しきれず、連結成分を判定できなかったレベル: ${unknown} 本`);
console.log(bad === 0 ? '重複なし' : `重複が ${bad} 本あります`);
process.exit(bad > 0 ? 1 : 0);
