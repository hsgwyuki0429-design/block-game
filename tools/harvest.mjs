// 盤面の採集。
//   node tools/harvest.mjs [--seconds 600] [--shard 0] [--shards 1]
//                          [--levels 1000] [--color mixed|small|big|huge]
//                          [--sizes 4,5,6,7,8] [--grey half|all|few|none]
//                          [--slack 1.15] [--minpar 0] [--maxpar 999] [--resume]
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
// 深い盤面ほど「上の手数」に回す。
//
// **1枚の盤面から取るのは1問だけ。**
// 距離マップは1枚から何十問でも切り出せるが、切り出したものは灰色の位置こそ違え、
// ブロックの顔ぶれ（配役）が同じままになる。並べると「さっきと同じ盤面」に見える。
// 効率は4分の1になるが、1000レベルすべてを別の盤面にするにはこれしかない。
//
// 出力は JSONL（1行1問）。tools/levels.mjs がこれを読んでレベルに割り当てる。
// 複数プロセスで別 shard を同時に回してよい（shard が違えばシードが被らない）。
// --shards には同時に回す本数を渡す ―― 1本あたりの目標がその数で割られる。
//
// --color は色つきブロックの大きさの寄り方。深い手数が出るのは小さいときなので
// 既定（mixed）は小さめに寄せてある。大きい色つきのレベルも並べたいときは、
// big / huge で回した shard を混ぜる。

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, compile, Explorer, GREY_RECTS, canonicalKey, rectsOf } from '../src/exact.js';
import { encodeLevel, decodeLevel } from '../src/levelCodec.js';
import { makeRng, hashSeed } from '../src/rng.js';
import { Board } from '../src/board.js';
import { targetPar } from '../src/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};

const seconds = Number(arg('seconds', 600));
const onlySizes = arg('sizes', '') ? new Set(arg('sizes', '').split(',').map(Number)) : null;
/**
 * この手数より上は採らない。
 * 深い手数は1枚に何分もかかるので、放っておくと shard の時間が全部そこへ行く。
 * レベルの大半を占める帯（80〜110手あたり）の在庫を厚くしたいときに使う ――
 * 在庫が厚いほど tools/levels.mjs が「2マスの灰色が少ない盤面」を選べる。
 */
const maxPar = Number(arg('maxpar', 9999));

/**
 * 逆に、この手数**未満**は採らない。
 *
 * --maxpar と組み合わせて、シャードに帯を割り当てるために使う。浅い手数は
 * すぐ埋まってしまうので、指定しないと深い帯を狙わせたいシャードまで
 * 浅いほうへ流れていく（「まだ足りない手数のうちいちばん長いもの」を採る
 * 作りなので、浅い在庫が薄いとそちらが選ばれてしまう）。
 */
const minPar = Number(arg('minpar', 0));
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

/**
 * 灰色ブロックの大きさの寄り方。
 *
 * 2マス（1×2・2×1）は見た目にうるさいので減らしたいのだが、**深い盤面には
 * 構造的に要る** ―― 華容道の「縦棒」と同じで、大きい塊の隙間を通り抜けて
 * 場所を入れ替える役をこれが担っている。実測（6×6・空き3マス、1分あたり）:
 *
 *   全種類を等しく  深さ110以上 1.25枚  最深131  2マス率 67%
 *   2マスを半分に   深さ110以上 3.00枚  最深332  2マス率 60%   ←採用
 *   2マスを1/4に    深さ110以上 0.50枚  最深147  2マス率 51%
 *   2マスを禁止     深さ110以上 0枚     最深 90  2マス率  0%
 *
 * 禁止すると盤面が動かなくなって手数が伸びない（そもそも空き3マスぴったりに
 * 詰められず、組み立て自体が14万回失敗した）。半分に抑えるのが、見た目と
 * 深さの両方がいちばん良くなる点だった ―― 減らしたほうが深くなる、というのは
 * 意外だが、2マスが多いと盤面がゆるくなって手数が縮むということらしい。
 *
 * 最後にどれを使うかは tools/levels.mjs が選ぶ。同じ手数・同じ広さなら
 * **2マスの少ない盤面から**採るので、ここは在庫の寄り方を決めるだけでよい。
 */
const GREY_POOLS = {
  all: GREY_RECTS,
  half: [
    [1, 2], [2, 1],
    ...Array(2).fill([1, 3]), ...Array(2).fill([3, 1]), ...Array(2).fill([2, 2]),
    ...Array(2).fill([2, 3]), ...Array(2).fill([3, 2]), ...Array(2).fill([3, 3]),
  ],
  few: [
    [1, 2], [2, 1],
    ...Array(4).fill([1, 3]), ...Array(4).fill([3, 1]), ...Array(4).fill([2, 2]),
    ...Array(4).fill([2, 3]), ...Array(4).fill([3, 2]), ...Array(4).fill([3, 3]),
  ],
  none: [[1, 3], [3, 1], [2, 2], [2, 3], [3, 2], [3, 3]],
};
const GREY_POOL = GREY_POOLS[arg('grey', 'half')] || GREY_POOLS.half;

/**
 * 1枚の盤面から取る問題数。1 ―― 配役の使い回しを作らないため。
 * ここを 2 以上にすると、その本数ぶんだけ「同じ顔ぶれのレベル」が並ぶ。
 */
const PER_LAYOUT = 1;
/**
 * 探索を諦める状態数。
 * 大きくすると「広いが深い」盤面も拾えるが、外れの1枚にかける時間も伸びる。
 * 実測では 7万で深い盤面の大半が収まる（打ち切りは試行の2割ほど）。
 */
const CAP = Number(arg('cap', 70000));

/**
 * 「くっついた瞬間の盤面」の指紋。回転・鏡像で重なるものは同じ指紋になる。
 *
 * これが同じ盤面は、途中がどう違っても**同じパズルの別の入口**でしかない。
 * 焼く側（tools/levels.mjs）はそこで弾くので、採集の段階から避けておくと
 * 「探したのに使われない」無駄が減る。
 */
function goalSignature(code) {
  let data;
  try {
    data = decodeLevel(code);
  } catch {
    return null;
  }
  const board = new Board(data.size);
  for (const p of data.pieces) board.addPiece(p.c, p.s, `${p.w}x${p.h}`);
  for (let i = 0; i < data.solution.length - 1; i++) {
    if (!board.applyMove(data.solution[i][0], data.solution[i][1])) return null;
  }
  const [id, dir, distance] = data.solution[data.solution.length - 1];
  if (board.slideDistance(id, dir) !== distance) return null;
  board.movePiece(id, dir, distance);
  return canonicalKey(data.size, rectsOf(board));
}

/** すでに採ってある「くっついた形」。同じものは二度採らない */
const knownGoals = new Set();
/** すでに調べた出発点。同じ配置を何度も全探索しない */
const studied = new Set();

// ── 欲しい手数の表を作る ──
// 目標より少し多めに集める。焼く側は「小さい盤面から先に使う」ので、
// 同じ手数でも大きさ違いの在庫があったほうがよい（余りは捨てられる）
const slack = Number(arg('slack', 1.15));
const need = new Map();
for (let lv = 1; lv <= levels; lv++) {
  const p = targetPar(lv);
  if (p > maxPar || p < minPar) continue;
  need.set(p, (need.get(p) || 0) + 1);
}

// --resume: すでに貯まっている在庫を数えて、足りないぶんだけを目標にする。
// 深い手数は1枚見つけるのに数分かかるので、何度も回して積み上げられるようにしておく。
if (process.argv.includes('--resume')) {
  const dir = dirname(out);
  const have = new Map();
  for (const file of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of (await readFile(resolve(dir, file), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      have.set(row.par, (have.get(row.par) || 0) + 1);
      const sig = goalSignature(row.code);
      if (!sig) continue;
      knownGoals.add(sig);
    }
  }
  let left = 0;
  for (const [p, n] of need) {
    const short = Math.ceil(n * slack) - (have.get(p) || 0);
    need.set(p, Math.max(0, short));
    left += Math.max(0, short);
  }
  console.error(`[${shard}] 既存の在庫を差し引いた残り: ${left} 本`);
}

const resumed = process.argv.includes('--resume');
for (const [p, n] of need) {
  const want = resumed ? n : Math.ceil(n * slack);
  if (want <= 0) { need.delete(p); continue; }
  need.set(p, Math.ceil(want / shards) + 1);
}
const pars = [...need.keys()].sort((a, b) => b - a); // 深いほうから埋める

/**
 * どのレシピを踏むかは、走らせながら決める。
 *
 * 序盤は短い手数がいくらでも足りないので、どのレシピもよく当たる。埋まってくると
 * 「深い盤面しか出せないレシピ」だけが役に立つようになり、当たるレシピが入れ替わる。
 * 固定の重みだと後半ずっと無駄を踏むので、**1秒あたり何問採れたか**でレシピを
 * 選び直す（ε-greedy: 1割は当たりに関係なく試して、様子見も切らさない）。
 */
const stats = RECIPES
  .filter((r) => !onlySizes || onlySizes.has(r.size))
  .map((r) => ({ recipe: r, ms: 200, got: r.weight / 4 }));
if (!stats.length) {
  console.error(`--sizes ${arg('sizes', '')} に合うレシピがありません`);
  process.exit(1);
}
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

// 出力は**追記**する。空にすると、同じ shard 番号で回し直したときに前回の
// 採取ぶんが消える（実際に480枚失った）。焼く側は符号で重複を落とすので、
// 同じ行が二度入っても害はない。
await mkdir(dirname(out), { recursive: true });

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

// 外から止められたとき（採集を回し直すたびに kill している）にも取りこぼさない。
// 非同期の flush は間に合わないので、ここだけ同期で書く。
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (pending.length) appendFileSync(out, `${pending.join('\n')}\n`);
    process.exit(0);
  });
}

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

    // 同じ出発点はもう調べてある ―― 全探索は数十ミリ秒かかるので、ここで省く
    const startSig = canonicalKey(built.board.size, rectsOf(built.board));
    if (studied.has(startSig)) break attempt;
    studied.add(startSig);

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
    const limits = new Map();
    for (const par of pars) {
      if (par > ex.depth) continue;
      if (!need.get(par)) continue;
      limits.set(par, PER_LAYOUT); // いちばん長い「まだ足りない手数」を1本だけ
      break;
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
        const goal = goalSignature(code);
        if (!goal || knownGoals.has(goal)) continue; // 同じパズルの別の入口
        knownGoals.add(goal);
        pending.push(JSON.stringify({
          par, size: puzzle.size, cells: puzzle.cells, lay: `${shard}.${explored}`, code,
        }));
        need.set(par, need.get(par) - 1);
        if (need.get(par) <= 0) need.delete(par);
        taken++;
        got++;
      }
    }
    // 採れたらその場で書き出す。深い盤面は1枚に何分もかかるので、
    // 溜めている間に止められると、その時間がまるごと消える。
    // 採取は数分に数回しかないので、毎回書いても負担にならない。
    if (got > 0) await flush();
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
