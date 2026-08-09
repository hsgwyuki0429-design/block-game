// 厳密生成 ―「ゴールから距離 N の盤面」を全探索で取り出す
//
// これまでの逆順構築は「解ける手順があること」しか保証していなかった。実測すると
// PAR 106手の盤面が20手で解けていた ―― 表示していた手数が嘘だった。
//
// ここでは作り方を裏返す:
//
//   1. 色つきブロックを2個、接触させて置く（＝解けた瞬間の形）
//   2. 灰色ブロックを目標の埋め率まで敷く
//   3. そこから到達できる盤面を**全部**列挙する（前向き BFS）
//   4. 「2個が接触している盤面」すべてを距離0として、後ろ向きの幅優先探索で
//      各盤面のゴールまでの距離を配る
//   5. **欲しい手数と同じ距離の盤面**を初期配置として取り出す
//
// こうすると PAR が推定ではなく**厳密な最短手数**になる。近道は原理的に存在しない。
//
// 5 が肝。以前は「いちばん遠い盤面」だけを採っていたので、出てくる手数は運任せ
// だった（欲しい手数を狙えない）。距離マップには 0 から最遠までの**全部の距離**が
// 入っているので、1回の探索から「30手の問題」「78手の問題」…と好きな手数を
// 切り出せる。レベル1000本ぶんの手数カーブを埋められるのはこのため。
//
// 前向き BFS が要るのは、後ろ向き探索を「初期配置から到達できる盤面」に閉じ込める
// ため。到達集合 R は S0 から辿れる盤面の全体で、s ∈ R なら s から行ける先も R に
// 入る（推移性）。つまり R の中だけで距離を配っても、「R の外にもっと近いゴールが
// あって手数が縮む」ということは起こらない。
//
// 全探索が現実的なのは「空きマスが少ない」ときだけ。埋め率9割弱なら状態数は
// 数万〜数十万で収まり、5割まで下げると数億に爆発して計算できない ―― 高い埋め率は
// 難易度にも計算量にも都合がよい、という珍しい組み合わせになっている。
//
// 速度について。盤面は「各ブロックのアンカー位置を並べた Uint8Array」で持ち、
// 専用のオープンアドレス法ハッシュ表に**バイト列のまま**入れる。Map<string> を
// 使うと 1 状態あたり数十本の文字列を作ることになり、そこが探索時間のほとんどを
// 占めていた。表は使い回すので、1回の探索でメモリを新しく確保することは無い。

import { Board, BLOCKER } from './board.js';
import { DIRS } from './shapes.js';

/** 探索で使う方向の並び。添字 0..3 がそのまま向きを表す */
export const DIR_ORDER = ['up', 'right', 'down', 'left'];

/**
 * 灰色ブロックに使う長方形。いちばん小さくて 1×2、いちばん大きくて 3×3。
 * 1×1 を入れないのは、単独マスは隙間をすり抜けてしまい通路をふさげないから。
 */
export const GREY_RECTS = [[1, 2], [2, 1], [1, 3], [3, 1], [2, 2], [2, 3], [3, 2], [3, 3]];

/** 色つきブロックに使う長方形。灰色と同じく 1×2 〜 3×3 */
export const COLOR_RECTS = [[1, 2], [2, 1], [1, 3], [3, 1], [2, 2], [2, 3], [3, 2], [3, 3]];

/** 盤面の一辺の上限。ここを超えると位置が 1 バイトに収まらないし、探索も終わらない */
export const MAX_BOARD = 8;

/** 1 盤面あたりのブロック数の上限（ハッシュ表の 1 レコード長） */
const STRIDE = 32;

/**
 * ハッシュ表の空きスロット印。到達済み未確定は -1、確定した距離は 0 以上。
 * board.js の EMPTY（空きマス）とは別物なので、名前を分けてある
 * ―― 配信物は 1 つのスコープに連結されるので、同じ名前は置けない。
 */
const SLOT_EMPTY = -2;

/**
 * ブロックの「形の指紋」。色つき/灰色の別と、アンカーからのマスの並びで決まる。
 *
 * 並びは必ず**昇順に揃えてから**文字にする。同じ形でも、盤面データの書かれ方に
 * よってマスの順序は違いうるので、揃えないと同じ形が別の形として数えられ、
 * 入れ替えの正規化（canon）が効かなくなる。
 */
export function pieceKey(kind, offs) {
  const sorted = offs.map(([x, y]) => `${x},${y}`).sort();
  return `${kind}|${sorted.join(' ')}`;
}

export const rectCells = (w, h) => {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([x, y]);
  return out;
};

/**
 * 盤面を組む。色つき2個を接触させて置き（＝ゴールの形）、残りを灰色で埋める。
 *
 * 空きマス数 free をぴったり合わせるのが肝。「埋め率 86%」のような指定だと
 * 端数のぶんだけ隙間が余り、そこがブロックの逃げ場になって手数が伸びない。
 * いちばん深い盤面が出るのは 6×6 で空き 3 マス ―― 華容道と同じで、
 * 「動かせる隙間が数マスしか無い」ときだけ手順が長く伸びる。
 *
 * @param {() => number} rng
 * @param {{size:number, free:number, greyRects?:number[][], colorRects?:number[][]}} options
 *   greyRects / colorRects は同じ形を複数回入れると、その形が選ばれやすくなる
 * @returns {{board: Board, colorIds: number[]}|null} 空きが free ぴったりにならなければ null
 */
export function layout(rng, options = {}) {
  const {
    size = 6,
    free = 3,
    greyRects = GREY_RECTS,
    colorRects = COLOR_RECTS,
  } = options;

  const board = new Board(size);
  const isFree = (x, y) => x >= 0 && y >= 0 && x < size && y < size && board.grid[y * size + x] === -1;
  const fits = (cells) => cells.every(([x, y]) => isFree(x, y));

  // 色つき2個を「触れた状態」で置く。触れているので、この盤面が距離 0 になる
  let colorIds = null;
  for (let t = 0; t < 600 && !colorIds; t++) {
    const [w1, h1] = colorRects[Math.floor(rng() * colorRects.length)];
    const [w2, h2] = colorRects[Math.floor(rng() * colorRects.length)];
    if (w1 > size || h1 > size || w2 > size || h2 > size) continue;
    const x1 = Math.floor(rng() * (size - w1 + 1));
    const y1 = Math.floor(rng() * (size - h1 + 1));
    const a = rectCells(w1, h1).map(([i, j]) => [x1 + i, y1 + j]);
    if (!fits(a)) continue;

    // 相手は上下左右のどれかに、辺を重ねて隣接させる
    const d = DIRS[DIR_ORDER[Math.floor(rng() * 4)]];
    let x2;
    let y2;
    if (d.x !== 0) {
      x2 = d.x > 0 ? x1 + w1 : x1 - w2;
      y2 = y1 + Math.floor(rng() * (h1 + h2 - 1)) - (h2 - 1);
    } else {
      y2 = d.y > 0 ? y1 + h1 : y1 - h2;
      x2 = x1 + Math.floor(rng() * (w1 + w2 - 1)) - (w2 - 1);
    }
    const b = rectCells(w2, h2).map(([i, j]) => [x2 + i, y2 + j]);
    if (!fits(b)) continue;

    const pa = board.addPiece(0, a, `${w1}x${h1}`);
    const pb = board.addPiece(0, b, `${w2}x${h2}`);
    colorIds = [pa.id, pb.id];
  }
  if (!colorIds) return null;

  const total = size * size;
  for (let t = 0; t < 6000 && total - board.filledCells > free; t++) {
    const [w, h] = greyRects[Math.floor(rng() * greyRects.length)];
    if (w > size || h > size) continue;
    // 敷いたら空きが足りなくなる形は置かない（空きは free ぴったりで止める）
    if (total - board.filledCells - w * h < free) continue;
    const x = Math.floor(rng() * (size - w + 1));
    const y = Math.floor(rng() * (size - h + 1));
    const cells = rectCells(w, h).map(([i, j]) => [x + i, y + j]);
    if (!fits(cells)) continue;
    board.addPiece(BLOCKER, cells, `${w}x${h}`);
  }
  if (total - board.filledCells !== free) return null; // 隙間が埋まりきらなかった
  return { board, colorIds };
}

/**
 * 盤面を「アンカー位置の並び」という軽い表現に落とす。形は動かないので位置だけでよい。
 *
 * ・色つき2個を先頭（添字 0,1）に固定する。接触判定がそこだけ見れば済む
 * ・同じ形・同じ種類のブロックはひとつの group にまとめ、位置を昇順に正規化する。
 *   入れ替えただけの盤面を別物として数えると、状態数が階乗で爆発する
 * ・セルは「アンカーからの linear offset」に潰しておく。探索の内側は
 *   occ[pos + off] の一次元アクセスだけになり、x/y の計算が消える
 */
export function compile(board, colorIds) {
  const size = board.size;
  if (size > MAX_BOARD) throw new Error(`盤面が大きすぎます: ${size}`);
  const colorSet = new Set(colorIds);
  const raw = [...board.pieces.values()].map((p) => {
    const ax = Math.min(...p.cells.map((c) => c[0]));
    const ay = Math.min(...p.cells.map((c) => c[1]));
    const offs = p.cells.map(([x, y]) => [x - ax, y - ay]);
    return { offs, anchor: ax + ay * size, kind: colorSet.has(p.id) ? 'c' : 'g' };
  });
  if (raw.length > STRIDE) throw new Error(`ブロックが多すぎます: ${raw.length}`);
  const keyOf = (p) => pieceKey(p.kind, p.offs);
  // 'c' < 'g' なので、色つきが必ず先頭ふたつに来る
  raw.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const n = raw.length;
  const pieceStart = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) pieceStart[k + 1] = pieceStart[k] + raw[k].offs.length;
  const cellOff = new Int16Array(pieceStart[n]);
  const cellDX = new Int8Array(pieceStart[n]);
  const cellDY = new Int8Array(pieceStart[n]);
  const pw = new Int8Array(n);
  const ph = new Int8Array(n);
  for (let k = 0; k < n; k++) {
    let w = 0;
    let h = 0;
    for (let i = 0; i < raw[k].offs.length; i++) {
      const [dx, dy] = raw[k].offs[i];
      const at = pieceStart[k] + i;
      cellOff[at] = dy * size + dx;
      cellDX[at] = dx;
      cellDY[at] = dy;
      if (dx + 1 > w) w = dx + 1;
      if (dy + 1 > h) h = dy + 1;
    }
    pw[k] = w;
    ph[k] = h;
  }

  const start = new Uint8Array(n);
  for (let k = 0; k < n; k++) start[k] = raw[k].anchor;

  // 同じ形が連続している区間 = 入れ替えても同じ盤面になるグループ
  const groupLo = [];
  const groupHi = [];
  for (let i = 0; i < n;) {
    let j = i + 1;
    while (j < n && keyOf(raw[j]) === keyOf(raw[i])) j++;
    if (j - i > 1) { groupLo.push(i); groupHi.push(j); }
    i = j;
  }

  return {
    size,
    area: size * size,
    n,
    pieceStart,
    cellOff,
    cellDX,
    cellDY,
    pw,
    ph,
    start,
    groupLo: Int32Array.from(groupLo),
    groupHi: Int32Array.from(groupHi),
    shapes: raw.map((p) => p.offs),
    /** 各ブロックの形の指紋。生きている盤面と突き合わせるのに使う */
    keys: raw.map(keyOf),
    delta: Int32Array.from([-size, 1, size, -1]),
  };
}

/**
 * 生きている Board -> 探索が使う位置の並び（アンカーの配列）。
 *
 * compile はブロックを形の順に並べ替えるので、盤面のブロック id とは並びが違う。
 * 同じ形のブロックは互いに入れ替えても同じ盤面なので（canon が昇順に均す）、
 * 「同じ指紋の枠へ順に詰めていく」だけで正しい位置の並びになる。
 *
 * @returns {Uint8Array|null} 盤面と ctx が食い違っていれば null
 */
export function positionsOf(ctx, board, colorIds) {
  const colorSet = colorIds instanceof Set ? colorIds : new Set(colorIds);
  const slots = new Map();
  ctx.keys.forEach((k, i) => {
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(i);
  });

  const used = new Map();
  const pos = new Uint8Array(ctx.n);
  let placed = 0;
  for (const p of board.pieces.values()) {
    let ax = Infinity;
    let ay = Infinity;
    for (const [x, y] of p.cells) {
      if (x < ax) ax = x;
      if (y < ay) ay = y;
    }
    const offs = p.cells.map(([x, y]) => [x - ax, y - ay]);
    const key = pieceKey(colorSet.has(p.id) ? 'c' : 'g', offs);
    const list = slots.get(key);
    const at = used.get(key) || 0;
    if (!list || at >= list.length) return null;
    used.set(key, at + 1);
    pos[list[at]] = ax + ay * ctx.size;
    placed++;
  }
  return placed === ctx.n ? pos : null;
}

/** k 番のブロックのマスを occ に v で書く */
function mark(ctx, pos, k, occ, v) {
  const a = pos[k];
  const { pieceStart, cellOff } = ctx;
  for (let i = pieceStart[k], e = pieceStart[k + 1]; i < e; i++) occ[a + cellOff[i]] = v;
}

/** k 番のブロックが向き d へ何マス進めるか（occ から k は外してあること） */
function slide(ctx, pos, k, d, occ) {
  const { size, pieceStart, cellOff, pw, ph, delta } = ctx;
  const a = pos[k];
  const ax = a % size;
  const ay = (a - ax) / size;
  let limit;
  if (d === 0) limit = ay;
  else if (d === 1) limit = size - pw[k] - ax;
  else if (d === 2) limit = size - ph[k] - ay;
  else limit = ax;
  if (limit <= 0) return 0;

  const dv = delta[d];
  const s = pieceStart[k];
  const e = pieceStart[k + 1];
  let steps = 0;
  for (let t = 1; t <= limit; t++) {
    const base = a + dv * t;
    let ok = true;
    for (let i = s; i < e; i++) {
      if (occ[base + cellOff[i]]) { ok = false; break; }
    }
    if (!ok) break;
    steps = t;
  }
  return steps;
}

/** 色つき2個（添字 0,1）が上下左右で接しているか */
function touching(ctx, pos, stamp, gen) {
  const { size, pieceStart, cellOff, cellDX, cellDY } = ctx;
  const b = pos[1];
  for (let i = pieceStart[1], e = pieceStart[2]; i < e; i++) stamp[b + cellOff[i]] = gen;
  const a = pos[0];
  const ax = a % size;
  const ay = (a - ax) / size;
  for (let i = pieceStart[0], e = pieceStart[1]; i < e; i++) {
    const x = ax + cellDX[i];
    const y = ay + cellDY[i];
    const c = a + cellOff[i];
    if (x > 0 && stamp[c - 1] === gen) return true;
    if (x < size - 1 && stamp[c + 1] === gen) return true;
    if (y > 0 && stamp[c - size] === gen) return true;
    if (y < size - 1 && stamp[c + size] === gen) return true;
  }
  return false;
}

/**
 * 盤面の指紋。**回転・鏡像で重なる盤面は同じ指紋になる。**
 *
 * 正方形の対称性は8通り（回転4 × 鏡像2）。人間の目には「同じ盤面を裏返しただけ」
 * にしか見えないので、レベルとして並べるときは1枚と数えたい。
 *
 * ブロックは全部長方形なので、指紋は「種類・左上・幅・高さ」を並べて字句順に
 * 揃えたもので足りる。8通りぜんぶ作って、いちばん小さいものを代表に採る。
 *
 * @param {number} size 盤面の一辺
 * @param {{kind:string, x:number, y:number, w:number, h:number}[]} rects
 */
export function canonicalKey(size, rects) {
  let best = null;
  for (let t = 0; t < 8; t++) {
    const parts = [];
    for (const r of rects) {
      // t >= 4 は先に左右反転してから回す
      let { x, y, w, h } = r;
      if (t >= 4) x = size - x - w;
      for (let k = t % 4; k > 0; k--) {
        // 時計回り90度: (x, y) -> (size-1-y, x)
        const nx = size - y - h;
        const ny = x;
        const nw = h;
        const nh = w;
        x = nx; y = ny; w = nw; h = nh;
      }
      parts.push(`${r.kind}${x},${y},${w},${h}`);
    }
    parts.sort();
    const key = `${size}|${parts.join(' ')}`;
    if (best === null || key < best) best = key;
  }
  return best;
}

/** Board -> canonicalKey に渡せる長方形の並び */
export function rectsOf(board) {
  return [...board.pieces.values()].map((p) => {
    const xs = p.cells.map((c) => c[0]);
    const ys = p.cells.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      kind: p.color === BLOCKER ? 'g' : 'c',
      x,
      y,
      w: Math.max(...xs) - x + 1,
      h: Math.max(...ys) - y + 1,
    };
  });
}

/**
 * 全探索の作業場。表もキューも作り置きして使い回す ―― 探索そのものは
 * 何万回も回すので、1回ごとにメモリを確保していると、そこが律速になる。
 */
export class Explorer {
  constructor(cap = 200000) {
    this.cap = cap;
    let capacity = 1024;
    while (capacity < cap * 2) capacity *= 2;
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.keys = new Uint8Array(capacity * STRIDE);
    this.vals = new Int32Array(capacity);
    this.queueA = new Int32Array(cap + 8);
    this.queueB = new Int32Array(cap + 8);
    this.occ = new Uint8Array(MAX_BOARD * MAX_BOARD);
    this.stamp = new Int32Array(MAX_BOARD * MAX_BOARD);
    this.pos = new Uint8Array(STRIDE);
    this.buf = new Uint8Array(STRIDE);
    this.ctx = null;
    this.size = 0;
    this.depth = 0;
    this.counts = [];
  }

  /** pos を正規化（同形グループを昇順に）して this.buf に置く */
  canon(pos) {
    const { n, groupLo, groupHi } = this.ctx;
    const buf = this.buf;
    for (let i = 0; i < n; i++) buf[i] = pos[i];
    for (let g = 0; g < groupLo.length; g++) {
      const lo = groupLo[g];
      const hi = groupHi[g];
      for (let i = lo + 1; i < hi; i++) { // 区間は短いので挿入ソート
        const v = buf[i];
        let j = i - 1;
        while (j >= lo && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
        buf[j + 1] = v;
      }
    }
    return buf;
  }

  /** this.buf のスロットを探す。無ければ確保して this.inserted を true にする */
  slotOf(insert) {
    const { keys, vals, mask } = this;
    const n = this.ctx.n;
    const buf = this.buf;
    let h = 0x811c9dc5;
    for (let i = 0; i < n; i++) { h = Math.imul(h ^ buf[i], 0x01000193); }
    let s = (h >>> 0) & mask;
    for (;;) {
      if (vals[s] === SLOT_EMPTY) {
        this.inserted = false;
        if (!insert) return s;
        const at = s * STRIDE;
        for (let i = 0; i < n; i++) keys[at + i] = buf[i];
        vals[s] = -1;
        this.size++;
        this.inserted = true;
        return s;
      }
      const at = s * STRIDE;
      let same = true;
      for (let i = 0; i < n; i++) {
        if (keys[at + i] !== buf[i]) { same = false; break; }
      }
      if (same) { this.inserted = false; return s; }
      s = (s + 1) & mask;
    }
  }

  /** スロットの盤面を out に取り出す */
  read(slot, out) {
    const n = this.ctx.n;
    const at = slot * STRIDE;
    const dst = out || new Uint8Array(n);
    for (let i = 0; i < n; i++) dst[i] = this.keys[at + i];
    return dst;
  }

  /** 盤面 pos の距離（未到達なら undefined） */
  distanceOf(pos) {
    this.canon(pos);
    const slot = this.slotOf(false);
    const v = this.vals[slot];
    return v === SLOT_EMPTY ? undefined : v;
  }

  /**
   * ctx の到達集合を全部展開し、ゴールまでの距離を配る（最後まで一気に）。
   * @returns {boolean} 状態数が cap に収まって探索できたか
   */
  run(ctx) {
    this.begin(ctx);
    while (this.step(Infinity) === 'running');
    return this.phase === 'done';
  }

  /**
   * 少しずつ進める探索の下ごしらえ。
   *
   * 一気に回すと、深い盤面では 0.5 秒以上のあいだ画面が固まる。遊び始める前に
   * それだけ待たせるのは筋が悪いので、**遊べる状態のまま少しずつ**配れるように
   * してある（begin -> step を何度も -> done）。
   * 配り終わるまでのあいだ、呼び出し側は控えの物差しで色を動かせばいい。
   */
  begin(ctx) {
    this.ctx = ctx;
    this.vals.fill(SLOT_EMPTY);
    // 接触判定の世代印。持ち越すと前回の印を「今回の印」と読み違えて、
    // 触れていない盤面をゴールと見なしてしまう（距離が全部おかしくなる）
    this.stamp.fill(0);
    this.size = 0;
    this.depth = 0;
    this.counts = [];

    this.queue = this.queueA;
    this.nextQueue = this.queueB;
    this.canon(ctx.start);
    this.queue[0] = this.slotOf(true);
    this.count = 1;
    this.cursor = 0;
    this.nextCount = 0;
    this.gen = 1;
    this.scanAt = 0;
    this.phase = 'forward';
  }

  /**
   * 予算（ミリ秒）ぶんだけ探索を進める。
   * @returns {'forward'|'seed'|'backward'|'done'|'failed'} いまの段階
   */
  step(budgetMs = 6) {
    if (this.phase === 'done' || this.phase === 'failed') return this.phase;
    const until = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + budgetMs;
    while (this.phase !== 'done' && this.phase !== 'failed') {
      if (this.phase === 'forward') this.stepForward(until);
      else if (this.phase === 'seed') this.stepSeed(until);
      else this.stepBackward(until);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now >= until) break;
    }
    return this.phase;
  }

  /** 探索が終わって距離が引ける状態か */
  get ready() {
    return this.phase === 'done';
  }

  /** ── 前向き BFS: S0 から到達できる盤面を全部集める ── */
  stepForward(until) {
    const ctx = this.ctx;
    const { n, delta } = ctx;
    const { occ, pos, keys, cap } = this;
    let ticks = 0;
    for (;;) {
      if (this.cursor >= this.count) {
        const t = this.queue;
        this.queue = this.nextQueue;
        this.nextQueue = t;
        this.count = this.nextCount;
        this.nextCount = 0;
        this.cursor = 0;
        if (this.count === 0) { this.phase = 'seed'; this.count = 0; return; }
      }
      const at = this.queue[this.cursor++] * STRIDE;
      for (let i = 0; i < n; i++) pos[i] = keys[at + i];
      occ.fill(0);
      for (let k = 0; k < n; k++) mark(ctx, pos, k, occ, 1);

      for (let k = 0; k < n; k++) {
        mark(ctx, pos, k, occ, 0);
        const a = pos[k];
        for (let d = 0; d < 4; d++) {
          const steps = slide(ctx, pos, k, d, occ);
          if (steps <= 0) continue;
          pos[k] = a + delta[d] * steps;
          this.canon(pos);
          pos[k] = a;
          const slot = this.slotOf(true);
          if (!this.inserted) continue;
          this.nextQueue[this.nextCount++] = slot;
        }
        mark(ctx, pos, k, occ, 1);
      }
      if (this.size > cap) { this.phase = 'failed'; return; } // 広すぎる。諦める
      if ((++ticks & 31) === 0
        && (typeof performance !== 'undefined' ? performance.now() : Date.now()) >= until) return;
    }
  }

  /** ── 接触している盤面（＝ゴール）を距離 0 として拾い集める ── */
  stepSeed(until) {
    const ctx = this.ctx;
    const { vals, pos, stamp } = this;
    let ticks = 0;
    while (this.scanAt <= this.mask) {
      const s = this.scanAt++;
      if (vals[s] === -1) {
        this.read(s, pos);
        if (touching(ctx, pos, stamp, this.gen++)) {
          vals[s] = 0;
          this.queue[this.count++] = s;
        }
      }
      if ((++ticks & 255) === 0
        && (typeof performance !== 'undefined' ? performance.now() : Date.now()) >= until) return;
    }
    if (this.count === 0) { this.phase = 'failed'; return; }
    this.counts.push(this.count);
    this.cursor = 0;
    this.nextCount = 0;
    this.depth = 0;
    this.phase = 'backward';
  }

  /** ── 後ろ向き BFS: ゴールから距離を配る ── */
  stepBackward(until) {
    const ctx = this.ctx;
    const { n, delta } = ctx;
    const { occ, pos, keys, vals } = this;
    let ticks = 0;
    for (;;) {
      if (this.cursor >= this.count) {
        if (this.nextCount === 0) { this.phase = 'done'; return; }
        this.depth++;
        this.counts.push(this.nextCount);
        const t = this.queue;
        this.queue = this.nextQueue;
        this.nextQueue = t;
        this.count = this.nextCount;
        this.nextCount = 0;
        this.cursor = 0;
      }
      const at = this.queue[this.cursor++] * STRIDE;
      for (let i = 0; i < n; i++) pos[i] = keys[at + i];
      occ.fill(0);
      for (let k = 0; k < n; k++) mark(ctx, pos, k, occ, 1);

      for (let k = 0; k < n; k++) {
        mark(ctx, pos, k, occ, 0);
        const a = pos[k];
        for (let d = 0; d < 4; d++) {
          // pos[k] で「ちょうど止まる」＝進行方向が塞がっていること。
          // 1マスでも進めるなら、この向きから滑ってきてここで止まることはない
          if (slide(ctx, pos, k, d, occ) > 0) continue;
          // 逆向きへ 1,2,3… マス戻したところが「1手前」の盤面
          const rev = (d + 2) & 3;
          const room = slide(ctx, pos, k, rev, occ);
          for (let t = 1; t <= room; t++) {
            pos[k] = a + delta[rev] * t;
            this.canon(pos);
            const slot = this.slotOf(false);
            if (vals[slot] !== -1) continue; // 未到達 or 既に確定
            vals[slot] = this.depth + 1;
            this.nextQueue[this.nextCount++] = slot;
          }
          pos[k] = a;
        }
        mark(ctx, pos, k, occ, 1);
      }
      if ((++ticks & 31) === 0
        && (typeof performance !== 'undefined' ? performance.now() : Date.now()) >= until) return;
    }
  }

  /**
   * 欲しい距離ぶんのスロットを**表の走査1回で**まとめて集める。
   * 表は数十万スロットあるので、距離ごとに引き直すと採集がそこで律速する。
   * @param {Map<number, number>} limits 距離 -> 何件まで
   * @returns {Map<number, number[]>} 距離 -> スロット番号
   */
  slotsForDistances(limits, rng = null) {
    const out = new Map();
    const seen = new Map();
    for (const d of limits.keys()) { out.set(d, []); seen.set(d, 0); }
    for (let s = 0; s <= this.mask; s++) {
      const d = this.vals[s];
      if (d < 0) continue;
      const bucket = out.get(d);
      if (bucket === undefined) continue;
      const n = seen.get(d) + 1;
      seen.set(d, n);
      const limit = limits.get(d);
      if (bucket.length < limit) bucket.push(s);
      else if (rng) {
        const j = Math.floor(rng() * n); // リザーバサンプリング
        if (j < limit) bucket[j] = s;
      }
    }
    return out;
  }

  /** 距離がちょうど want のスロットを最大 limit 件（多すぎるときは無作為に間引く） */
  slotsAtDistance(want, limit = Infinity, rng = null) {
    return this.slotsForDistances(new Map([[want, limit]]), rng).get(want);
  }

  /** 距離が1ずつ減る手をたどって、最短手順を復元する */
  reconstruct(slot) {
    const ctx = this.ctx;
    const { n, delta } = ctx;
    const occ = new Uint8Array(ctx.area);
    const pos = this.read(slot);
    const path = [];
    let d = this.vals[slot];
    if (d < 0) return null;

    while (d > 0) {
      let bestK = -1;
      let bestDir = -1;
      let bestSteps = 0;
      occ.fill(0);
      for (let k = 0; k < n; k++) mark(ctx, pos, k, occ, 1);
      for (let k = 0; k < n && bestK < 0; k++) {
        mark(ctx, pos, k, occ, 0);
        const a = pos[k];
        for (let dir = 0; dir < 4; dir++) {
          const steps = slide(ctx, pos, k, dir, occ);
          if (steps <= 0) continue;
          pos[k] = a + delta[dir] * steps;
          const at = this.distanceOf(pos);
          pos[k] = a;
          if (at !== d - 1) continue;
          bestK = k;
          bestDir = dir;
          bestSteps = steps;
          break;
        }
        mark(ctx, pos, k, occ, 1);
      }
      if (bestK < 0) return null; // 起こらないはずだが、念のため
      path.push({ index: bestK, dir: DIR_ORDER[bestDir], distance: bestSteps });
      pos[bestK] += delta[bestDir] * bestSteps;
      d -= 1;
    }
    return path;
  }

  /**
   * スロットをパズル（初期配置＋最短手順）に仕立てる。
   * @returns {{size:number, cells:number, optimal:number, pieces:object[], solution:Array}|null}
   */
  puzzleAt(slot) {
    const ctx = this.ctx;
    const want = this.vals[slot];
    if (want <= 0) return null;
    const path = this.reconstruct(slot);
    if (!path || path.length !== want) return null;

    const pos = this.read(slot);
    const pieces = [];
    let cells = 0;
    for (let k = 0; k < ctx.n; k++) {
      const ax = pos[k] % ctx.size;
      const ay = (pos[k] - ax) / ctx.size;
      const abs = ctx.shapes[k].map(([sx, sy]) => [ax + sx, ay + sy]);
      cells += abs.length;
      pieces.push({ c: k < 2 ? 0 : BLOCKER, s: abs });
    }
    return {
      size: ctx.size,
      cells,
      optimal: want,
      pieces,
      // ブロック id は 1 始まり（Board.addPiece の採番と揃える）
      solution: path.map((m) => [m.index + 1, m.dir, m.distance]),
    };
  }
}
