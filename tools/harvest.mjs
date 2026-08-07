// 盤面の採集。
//   node tools/harvest.mjs [--seconds 600] [--shard 0] [--shards 1]
//                          [--levels 1000] [--color mixed|small|big|huge]
//                          [--out data/pool-0.jsonl]
//
// 「欲しい最短手数を先に決めて、それになる盤面を探す」のがこのツール。
//
// 仕組みは src/exact.js を読むのが早いが、要点はひとつ:
//
//   1回の全探索は「ゴールから 0手・1手・2手…最遠まで」の距離をすべて配る。
//
// つまり深さ 106 の盤面をひとつ引き当てれば、そこから「ちょうど 104手の問題」
// 「ちょうど 97手の問題」…と、欲しい手数の問題を何本でも切り出せる。手数の
// 当たり外れを引くのではなく、**引いた 1 本を端から端まで使う**。
//
// 採集の中身:
//   ・レシピ（盤面の広さ・空きマス数・使う長方形）を無作為に選んで盤面を組む
//   ・全探索して「ゴールからいちばん遠い距離」＝ その盤面が出せる最大手数を知る
//   ・まだ足りていない手数のうち、その盤面で出せるいちばん長いものから順に取る
//
// 深い盤面ほど貴重（110手の問題は深さ110以上の盤面からしか出ない）ので、
// 深い盤面ほど「上の手数」に回す。1枚の盤面から取りすぎないよう上限も置く。
//
// 出力は JSONL（1行1問）。tools/levels.mjs がこれを読んでレベルに割り当てる。
// 複数プロセスで別 shard を同時に回してよい（shard が違えばシードが被らない）。
// --shards には同時に回す本数を渡す ―― 1本あたりの目標がその数で割られる。
//
// --color は色つきブロックの大きさの寄り方。深い手数が出るのは小さいときなので
// 既定（mixed）は小さめに寄せてある。大きい色つきのレベルも並べたいときは、
// big / huge で回した shard を混ぜる。

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, compile, Explorer, GREY_RECTS } from '../src/exact.js';
import { encodeLevel } from '../src/levelCodec.js';
import { makeRng, hashSeed } from '../src/rng.js';
import { targetPar } from '../src/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};

const seconds = Number(arg('seconds', 600));
const shard = Number(arg('shard', 0));
const shards = Number(arg('shards', 1));
const levels = Number(arg('levels', 1000));
const out = resolve(ROOT, arg('out', `data/pool-${shard}.jsonl`));

/**
 * 盤面のレシピ。実測（tools/ の下で何度も回した結果）でいちばん深い手数が出るのは
 * 6×6・空き3マス。空きが多いほど状態が広がって探索が終わらず、少なすぎると
 * ブロックが動けなくなって手数が落ちる。両側から挟まれた狭い谷にしか深い盤面は無い。
 *
 * weight は「そのレシピを選ぶ比率」。深い盤面が出るレシピを厚く踏む。
 */
const RECIPES = [
  { size: 6, free: 3, weight: 26 },
  { size: 6, free: 4, weight: 14 },
  { size: 6, free: 5, weight: 6 },
  { size: 5, free: 2, weight: 6 },
  { size: 5, free: 3, weight: 8 },
  { size: 5, free: 4, weight: 4 },
  { size: 7, free: 3, weight: 10 },
  { size: 7, free: 4, weight: 5 },
  { size: 8, free: 3, weight: 4 },
  { size: 8, free: 4, weight: 3 },
  { size: 4, free: 2, weight: 2 },
  { size: 4, free: 3, weight: 2 },
];

/**
 * 色つきブロックに使う長方形の重み。
 *
 * 小さいほうが深い手数が出る（大きいと隙間を通れず、そもそも寄せられない）ので
 * 既定は小さめを厚くしてある。ただしそれだけで採ると、焼き上がりの色つきが
 * ほぼ 1×2 と 1×3 になってしまう ―― `--color big` で回した shard を混ぜると、
 * 2×2 や 3×3 の色つきが出るレベルも在庫に入る。
 */
const COLOR_POOLS = {
  mixed: [
    ...Array(5).fill([1, 2]), ...Array(5).fill([2, 1]),
    ...Array(3).fill([1, 3]), ...Array(3).fill([3, 1]),
    [2, 2], [2, 3], [3, 2], [3, 3],
  ],
  small: [[1, 2], [2, 1], [1, 3], [3, 1]],
  big: [
    ...Array(3).fill([2, 2]), ...Array(2).fill([2, 3]), ...Array(2).fill([3, 2]),
    [3, 3], [1, 3], [3, 1],
  ],
  huge: [...Array(4).fill([3, 3]), [2, 3], [3, 2], [2, 2]],
};
const COLOR_POOL = COLOR_POOLS[arg('color', 'mixed')] || COLOR_POOLS.mixed;

/** 灰色は全種類を等しく。大小が混ざるほど通路の形が読みにくくなる */
const GREY_POOL = GREY_RECTS;

/** 1枚の盤面から取る問題数の上限。同じ盤面ばかりにならないための蓋 */
const PER_LAYOUT = 12;
/** 深い盤面はそれ自体が貴重（110手はここからしか出ない）ので、多めに取る */
const PER_DEEP_LAYOUT = 24;
const DEEP = 90;
/** 同じ手数を1枚の盤面から取る数の上限 */
const PER_LAYOUT_PER_PAR = 2;
/** 探索を諦める状態数。深い盤面はここに収まる（実測で最大5万強） */
const CAP = 70000;

// ── 欲しい手数の表を作る。shard ごとに頭数を割る ──
const need = new Map();
for (let lv = 1; lv <= levels; lv++) {
  const p = targetPar(lv);
  need.set(p, (need.get(p) || 0) + 1);
}
for (const [p, n] of need) need.set(p, Math.ceil(n / shards) + 1);
const pars = [...need.keys()].sort((a, b) => b - a); // 深いほうから埋める

/**
 * どのレシピを踏むかは、走らせながら決める。
 *
 * 序盤は短い手数がいくらでも足りないので、どのレシピもよく当たる。埋まってくると
 * 「深い盤面しか出せないレシピ」だけが役に立つようになり、当たるレシピが入れ替わる。
 * 固定の重みだと後半ずっと無駄を踏むので、**1秒あたり何問採れたか**でレシピを
 * 選び直す（ε-greedy: 1割は当たりに関係なく試して、様子見も切らさない）。
 */
const stats = RECIPES.map((r) => ({ recipe: r, ms: 200, got: r.weight / 4 }));
const pickRecipe = (rng) => {
  if (rng() < 0.1) return stats[Math.floor(rng() * stats.length)];
  let total = 0;
  for (const s of stats) total += s.got / s.ms;
  let r = rng() * total;
  for (const s of stats) {
    r -= s.got / s.ms;
    if (r <= 0) return s;
  }
  return stats[0];
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, '');

const ex = new Explorer(CAP);
const rng = makeRng(hashSeed(`slidepop/harvest/${shard}`));
const t0 = Date.now();
const deadline = t0 + seconds * 1000;
let tries = 0;
let explored = 0;
let capped = 0;
let taken = 0;
let deepest = 0;
let pending = [];

const remaining = () => {
  let n = 0;
  for (const v of need.values()) n += v;
  return n;
};

const flush = async () => {
  if (!pending.length) return;
  await appendFile(out, `${pending.join('\n')}\n`);
  pending = [];
};

while (Date.now() < deadline && remaining() > 0) {
  tries++;
  const stat = pickRecipe(rng);
  const at = Date.now();
  let got = 0;
  attempt: {
    const built = layout(rng, {
      size: stat.recipe.size,
      free: stat.recipe.free,
      colorRects: COLOR_POOL,
      greyRects: GREY_POOL,
    });
    if (!built) break attempt;

    let ctx;
    try {
      ctx = compile(built.board, built.colorIds);
    } catch {
      break attempt;
    }
    if (!ex.run(ctx)) { capped++; break attempt; }
    explored++;
    if (ex.depth > deepest) deepest = ex.depth;
    if (ex.depth < 2) break attempt;

    // まだ足りていない手数のうち、この盤面で出せるいちばん長いものから順に取る。
    // どの距離を何件取るかを先に決めて、表の走査は1回で済ませる
    const budget = ex.depth >= DEEP ? PER_DEEP_LAYOUT : PER_LAYOUT;
    const limits = new Map();
    let planned = 0;
    for (const par of pars) {
      if (planned >= budget) break;
      if (par > ex.depth) continue;
      const want = need.get(par);
      if (!want) continue;
      const take = Math.min(PER_LAYOUT_PER_PAR, want, budget - planned);
      limits.set(par, take);
      planned += take;
    }
    if (limits.size === 0) break attempt;

    for (const [par, slots] of ex.slotsForDistances(limits, rng)) {
      for (const slot of slots) {
        const puzzle = ex.puzzleAt(slot);
        if (!puzzle) continue;
        let code;
        try {
          code = encodeLevel(puzzle);
        } catch {
          continue;
        }
        pending.push(JSON.stringify({
          par, size: puzzle.size, cells: puzzle.cells, lay: `${shard}.${explored}`, code,
        }));
        need.set(par, need.get(par) - 1);
        if (need.get(par) <= 0) need.delete(par);
        taken++;
        got++;
      }
    }
    if (pending.length >= 64) await flush();
  }

  stat.ms += Math.max(1, Date.now() - at);
  stat.got += got;

  if (tries % 4000 === 0) {
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.error(
      `[${shard}] ${secs}s 試行${tries} 探索${explored} 打切${capped} 採取${taken} 最深${deepest} 残${remaining()}`,
    );
  }
}
await flush();

const left = [...need.entries()].sort((a, b) => b[0] - a[0]);
console.error(`[${shard}] 完了: ${((Date.now() - t0) / 1000).toFixed(0)}秒 / 採取 ${taken} 件 / 最深 ${deepest}手`);
if (left.length) {
  console.error(`[${shard}] 足りない手数: ${left.slice(0, 30).map(([p, n]) => `${p}手×${n}`).join(' ')}`);
}
console.error(`[${shard}] -> ${out}`);
