// パズル生成 ―「解の逆順構築」
//
// ランダムに埋めて解けるか検証する、という素朴な方法は使わない。代わりに
// 完成状態（空盤面）から出発し、1手ぶんずつ逆再生するようにブロックを置いていく。
// 最後に置いたステップが、解の第1手になる。
//
// 盤面には同じ色のブロックがちょうど2個ずつ。だから消去は色数ぶんしか起きない。
// 逆順構築は3層になっている。
//
// ① 消去の1手（kind:'clear'）
//   色 c を新しく1つ選ぶ
//     移動ブロック P : テトロミノ。着地点 B・滑走方向 d・開始点 A (= B - t×d)
//     相棒ブロック Q : 同じ色 c。B にいる P に隣接する
//
//   制約                                   保証される性質
//   ─────────────────────────────────────────────────────
//   新規セルはすべて空き                    ブロックの重複なし
//   A→B の経路が空 / B+d に壁かブロック      その手が実行でき、ちょうど B で止まる
//   A にいる P は Q に触れていない            初期盤面から同色は隣接しない
//
// ② 追い込み手（kind:'chain'）― このゲームの核
//   ①で置いた P を、さらに手前へ何度も「巻き戻す」。巻き戻し先 A' は
//   「A' から滑らせるとちょうど A で止まる」位置。P は相棒に触れない位置にしか
//   戻さないので、その手自体では何も消えない。
//   これを n 回重ねると、その1組を消すのに n+1 手が必要になる ――
//   ぶつける場所へ「滑らせて、また滑らせて」持っていく読みが要る。
//   滑って止まった直後に同じ方向へは進めないので、追い込み手は必ず曲がる。
//
// ③ 仕込み手（kind:'setup'）
//   盤面にある「別の」ブロックを1つ選び、同じ要領で手前へ戻す。
//   その手自体では何も消えないが、通さないと後の手が成立しない ――
//   一見関係ない場所を動かす必要が生まれる。
//
// 色ごとにブロックは2個しかないので「予定外の巻き込み消去」は原理的に起きない。
//
// 最後に「初手から消せてしまう色」が残っていれば、その色をもう1手ぶん奥へ追い込む。
// 狙いは clearAtStart === 0 ―― 初期盤面では、どのブロックをどう動かしても
// 何も消えない。まず通路を作る読みから入る盤面になる。

import { Board, BLOCKER } from './board.js';
import { DIRS, DIR_KEYS, OPPOSITE, PIECES, BLOCKER_SHAPES } from './shapes.js';
import { makeRng, shuffle } from './rng.js';
import { levelConfig, levelSeed } from './levels.js';

export const DEFAULT_OPTIONS = {
  size: 8,
  colors: 4,
  /** 灰色ブロック（消えない邪魔者）の数 */
  blockers: 0,
  /** 追い込み手の総数。色ごとに振り分けられる */
  chainMoves: 0,
  setupMoves: 0,
  forced: false,
  attempts: 60,
  /** 滑走距離の偏り。1 未満で「長い滑走」寄り */
  distanceBias: 0.85,
  /** 配置優先度のゆらぎ。0 だと常に最も詰まった場所へ置く（＝単調になる） */
  packingJitter: 3,
  /** 1ステップで何回まで置き直しを試すか（探索が指数的に伸びるのを防ぐ） */
  forcedChecks: 90,
  /** 追い込み1手あたりに評価する巻き戻し候補の数 */
  chainTries: 40,
  /** 仕込み手1手あたりに評価する巻き戻し候補の数 */
  setupTries: 240,
  /** 初手の消し手を潰すために、1回の掃除で足してよい手の上限 */
  openingPushes: 10,
  /** ペアを1組置くたびに行う掃除の上限（ここは軽く。深追いすると手数が水増しになる） */
  openingPushesInline: 1,
  /** 「消せる色が減らない手」が何手続いたら諦めるか */
  openingStale: 2,
  /** 初手を塞ぐ1手あたりに評価する巻き戻し候補の数 */
  openingTries: 400,
  /** 追い込み手の達成率がこれを超えれば「狙いどおり」とみなして試行を打ち切る */
  chainQuota: 0.75,
  /**
   * 同じ色の2個を「接触まで最短この手数」以上に引き離す。
   * PAR をいくら長くしても、ここが小さいと数手で消されてしまう ―― 実際に
   * 何手かかるかを決めているのはこの値のほう。
   */
  separation: 2,
  /** 引き離しに使ってよい手の上限 */
  separationPushes: 30,
  /** 引き離し1手あたりに評価する巻き戻し候補の数 */
  separationTries: 40,
  /** 巻き戻しで「相棒から離れること」をどれだけ重く見るか */
  gapWeight: 9,
};

/** セル群の上下左右の隣接セルを Set に集める（盤外は無視） */
function haloOf(size, cells, target = new Set()) {
  for (const [x, y] of cells) {
    for (const key of DIR_KEYS) {
      const d = DIRS[key];
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      target.add(ny * size + nx);
    }
  }
  return target;
}

/** 盤面に置けるすべての「形状 × 位置」を列挙（空きマスのみ） */
function emptyPlacements(board, shapes = PIECES) {
  const out = [];
  const size = board.size;
  for (const shape of shapes) {
    const maxX = size - shape.w;
    const maxY = size - shape.h;
    for (let oy = 0; oy <= maxY; oy++) {
      for (let ox = 0; ox <= maxX; ox++) {
        let ok = true;
        const cells = [];
        for (const [cx, cy] of shape.cells) {
          const x = cx + ox;
          const y = cy + oy;
          if (board.grid[y * size + x] !== -1) { ok = false; break; }
          cells.push([x, y]);
        }
        if (ok) out.push({ shape, cells });
      }
    }
  }
  return out;
}

/**
 * 配置の「詰まり具合」。壁や既存ブロックに接しているほど高い。
 * これを優先して置くと空きマスが断片化せず、密度の高い盤面になる。
 */
function contactScore(board, cells) {
  const size = board.size;
  let score = 0;
  for (const [x, y] of cells) {
    for (const key of DIR_KEYS) {
      const d = DIRS[key];
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) score += 1;
      else if (board.grid[ny * size + nx] !== -1) score += 2;
    }
  }
  return score;
}

/**
 * 相棒ブロック Q を1つ探す。
 * anchors のいずれかのセルを含み、すべての制約を満たす配置を返す（無ければ null）。
 */
function findPartner(board, rng, ctx, anchors) {
  const { size, blocked, forbidden } = ctx;
  for (const anchor of shuffle(rng, [...anchors])) {
    const ax = anchor % size;
    const ay = (anchor - ax) / size;
    for (const shape of shuffle(rng, PIECES.slice())) {
      for (const oi of shuffle(rng, shape.cells.map((_, i) => i))) {
        const [px, py] = shape.cells[oi];
        const ox = ax - px;
        const oy = ay - py;
        const cells = [];
        let ok = true;
        for (const [cx, cy] of shape.cells) {
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= size || y >= size) { ok = false; break; }
          const gi = y * size + x;
          if (board.grid[gi] !== -1) { ok = false; break; }
          if (blocked.has(gi)) { ok = false; break; }
          if (forbidden.has(gi)) { ok = false; break; }
          cells.push([x, y]);
        }
        if (ok) return { shape, cells };
      }
    }
  }
  return null;
}

/**
 * いま消せる色の集合。
 * 消去は必ず同色2個をまとめて取り除くだけなので、結果の盤面は「どの色が消えたか」
 * だけで決まる。したがって「消せる色が1つしかない＝次の一手が実質1通り」になる。
 */
export function clearableColors(board, limit = Infinity) {
  const out = new Set();
  for (const [id, piece] of board.pieces) {
    if (piece.color === BLOCKER) continue; // 灰色は消えない
    if (out.has(piece.color)) continue; // この色はもう数えた
    for (const dir of DIR_KEYS) {
      const r = board.simulate(id, dir);
      if (r && r.cleared.length > 0) { out.add(piece.color); break; }
    }
    if (out.size >= limit) break; // 呼び出し側が必要な数まで数えたら打ち切る
  }
  return out;
}

/** その色が「いま1手で消せる」か。色ごとにブロックは2個なので判定は軽い */
export function colorClearable(board, color) {
  if (color === BLOCKER) return false; // 灰色は何と触れても消えない
  for (const [id, piece] of board.pieces) {
    if (piece.color !== color) continue;
    for (const dir of DIR_KEYS) {
      const r = board.simulate(id, dir);
      if (r && r.cleared.length > 0) return true;
    }
  }
  return false;
}

/**
 * 「あと何手で1組消せるか」を幅優先で探す。
 *
 * 追い込み手が入った盤面では、消せる手はたいてい目の前に無い。だから
 * 「いま消せる手」を挙げるだけのヒントは役に立たない ―― 何手か先に消去がある
 * 道筋の1手目を教える必要がある。
 *
 * 局面は指紋で重複を除き、探索したノード数に上限を置く（深いレベルでも
 * ボタンを押した指が待たされない範囲で打ち切る）。
 *
 * @returns {{dir:string, pieceId:number, depth:number}|null} 最初の1手
 */
export function findClearPlan(board, maxDepth = 3, budget = 12000) {
  if (board.isCleared) return null;
  const seen = new Set([board.fingerprint()]);
  /** @type {{snap:object, first:{pieceId:number,dir:string}|null, depth:number}[]} */
  let frontier = [{ snap: board.snapshot(), first: null, depth: 0 }];
  const sim = new Board(board.size);
  let visited = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const piece of node.snap.pieces) {
        for (const dir of DIR_KEYS) {
          if (visited++ > budget) return null;
          sim.restore(node.snap);
          const res = sim.applyMove(piece.id, dir);
          if (!res) continue;
          const first = node.first || { pieceId: piece.id, dir };
          if (res.cleared.length > 0) return { ...first, depth };
          const print = sim.fingerprint();
          if (seen.has(print)) continue;
          seen.add(print);
          if (depth < maxDepth) next.push({ snap: sim.snapshot(), first, depth });
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}

/**
 * 灰色ブロックを撒く。
 *
 * 消えないので、盤面はここで決めた形のまま最後まで残る。色つきブロックが減っても
 * 通路が広がらない ―― 終盤になっても「同じ色の2個を寄せる道のり」が短くならない。
 * 逆順構築にとってはストッパーが増えるだけなので、追い込みはむしろ深く掛かる。
 *
 * 置き場所は散らす。1か所に固めると、ただの壁が生えただけで盤面の大半は素通しになる。
 */
function placeBlockers(board, rng, count) {
  for (let i = 0; i < count; i++) {
    const spots = emptyPlacements(board, BLOCKER_SHAPES);
    if (spots.length === 0) return i;
    // すでに置いた灰色から遠い場所を好む（散らすため）
    let best = null;
    let bestScore = -Infinity;
    for (const spot of shuffle(rng, spots).slice(0, 120)) {
      let near = Infinity;
      for (const p of board.pieces.values()) {
        if (p.color !== BLOCKER) continue;
        for (const [x, y] of spot.cells) {
          for (const [qx, qy] of p.cells) {
            near = Math.min(near, Math.abs(x - qx) + Math.abs(y - qy));
          }
        }
      }
      const score = (near === Infinity ? 99 : near) + rng() * 3;
      if (score > bestScore) { bestScore = score; best = spot; }
    }
    board.addPiece(BLOCKER, best.cells, best.shape.name);
  }
  return count;
}

/**
 * そのペアが「接触するまで最短で何手か」。cap 以上なら cap を返す。
 *
 * 他のブロックは動かさない前提で、そのペアの2個だけを滑らせる幅優先探索。
 * 状態は「2個のアンカー位置の組」なので、深さに関係なく盤面の広さの2乗で頭打ちになる。
 */
export function pairDistance(board, color, cap = 8) {
  if (color === BLOCKER) return cap;
  const size = board.size;
  const pair = [];
  for (const p of board.pieces.values()) if (p.color === color) pair.push(p);
  if (pair.length < 2) return cap;
  const [P, Q] = pair;

  const occ = new Uint8Array(size * size);
  for (const p of board.pieces.values()) {
    if (p.id === P.id || p.id === Q.id) continue;
    for (const [x, y] of p.cells) occ[y * size + x] = 1;
  }
  const shapeOf = (p) => p.cells.map(([x, y]) => [x - p.cells[0][0], y - p.cells[0][1]]);
  const shapes = [shapeOf(P), shapeOf(Q)];
  const starts = [P.cells[0][0] + P.cells[0][1] * size, Q.cells[0][0] + Q.cells[0][1] * size];
  const cellsAt = (w, a) => {
    const ax = a % size;
    const ay = (a - ax) / size;
    return shapes[w].map(([dx, dy]) => [ax + dx, ay + dy]);
  };
  const keyset = (cells) => {
    const set = new Set();
    for (const [x, y] of cells) set.add(y * size + x);
    return set;
  };
  const touching = (a, b) => {
    const set = keyset(b);
    for (const [x, y] of a) {
      for (const k of DIR_KEYS) {
        const d = DIRS[k];
        if (set.has((y + d.y) * size + (x + d.x))) return true;
      }
    }
    return false;
  };
  const slide = (w, a, otherCells, dir) => {
    const d = DIRS[dir];
    const mine = cellsAt(w, a);
    const other = keyset(otherCells);
    let steps = 0;
    for (let n = 1; n <= size; n++) {
      let ok = true;
      for (const [x, y] of mine) {
        const nx = x + d.x * n;
        const ny = y + d.y * n;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) { ok = false; break; }
        const gi = ny * size + nx;
        if (occ[gi] || other.has(gi)) { ok = false; break; }
      }
      if (!ok) break;
      steps = n;
    }
    return steps > 0 ? a + (d.y * size + d.x) * steps : -1;
  };

  const span = size * size;
  const seen = new Set([starts[0] * span + starts[1]]);
  let frontier = [starts];
  for (let depth = 1; depth <= cap; depth++) {
    const next = [];
    for (const [ap, aq] of frontier) {
      const cells = [cellsAt(0, ap), cellsAt(1, aq)];
      for (let w = 0; w < 2; w++) {
        for (const dir of DIR_KEYS) {
          const moved = slide(w, w === 0 ? ap : aq, cells[1 - w], dir);
          if (moved < 0) continue;
          const np = w === 0 ? moved : ap;
          const nq = w === 0 ? aq : moved;
          if (touching(cellsAt(0, np), cellsAt(1, nq))) return depth;
          const k = np * span + nq;
          if (seen.has(k)) continue;
          seen.add(k);
          next.push([np, nq]);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return cap;
}

/** 接触まで cap 手に満たない色（＝近道になりうる色）の集合 */
export function nearColors(board, cap) {
  const out = new Set();
  const seen = new Set();
  for (const p of board.pieces.values()) {
    if (p.color === BLOCKER || seen.has(p.color)) continue;
    seen.add(p.color);
    if (pairDistance(board, p.color, cap) < cap) out.add(p.color);
  }
  return out;
}

/** いちばん近いペアの接触距離 ―― 最短で何手目に最初の消去が起こりうるか */
export function minPairDistance(board, cap = 8) {
  let min = cap;
  const seen = new Set();
  for (const p of board.pieces.values()) {
    if (p.color === BLOCKER || seen.has(p.color)) continue;
    seen.add(p.color);
    min = Math.min(min, pairDistance(board, p.color, min));
  }
  return min;
}

/** 相棒ブロックとの盤上の隔たり（いちばん近いセル同士のマンハッタン距離） */
function gapToPartner(board, piece) {
  if (piece.color === BLOCKER) return 0;
  let partner = null;
  for (const q of board.pieces.values()) {
    if (q.color === piece.color && q.id !== piece.id) { partner = q; break; }
  }
  if (!partner) return 0;
  let best = Infinity;
  for (const [x, y] of piece.cells) {
    for (const [qx, qy] of partner.cells) {
      const d = Math.abs(x - qx) + Math.abs(y - qy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 見つけた候補を実際に盤面へ置く */
function commitPair(board, color, cand) {
  const moving = board.addPiece(color, cand.acells, cand.aname);
  const mate = board.addPiece(color, cand.q.cells, cand.q.shape.name);
  return {
    movingId: moving.id,
    mateId: mate.id,
    step: { pieceId: moving.id, dir: cand.dir, distance: cand.t, color, kind: 'clear' },
  };
}

/**
 * 逆順構築の1ステップ。色 color のペアを盤面に足し、その手を返す。
 * 探索は「開始点 A」から始める。A に置いたブロックが盤面に残るので、
 * A を詰まった場所から順に試すと空きマスが断片化しにくい。
 *
 * requireForced のときは「置いた直後に消せる色がこの色だけ」になる配置を探す。
 * ただし見つからないからといって生成全体を捨てはしない ―― 最初に見つかった
 * 普通の配置を控えとして持っておき、最後にそれを使う。
 */
function placePair(board, rng, opts, color, requireForced, requireRetractable = false) {
  const size = board.size;
  const placements = emptyPlacements(board);
  for (const p of placements) p.score = contactScore(board, p.cells) + rng() * opts.packingJitter;
  placements.sort((a, b) => b.score - a.score);

  let fallback = null;
  let checks = 0;

  search:
  for (const placement of placements) {
    const acells = placement.cells;

    for (const dir of shuffle(rng, DIR_KEYS.slice())) {
      const d = DIRS[dir];

      // A から d 方向へ何マス進めるか（＝経路が空である最大距離）
      let maxT = 0;
      for (let t = 1; t < size; t++) {
        let ok = true;
        for (const [x, y] of acells) {
          const nx = x + d.x * t;
          const ny = y + d.y * t;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { ok = false; break; }
          if (board.grid[ny * size + nx] !== -1) { ok = false; break; }
        }
        if (!ok) break;
        maxT = t;
      }
      if (maxT === 0) continue;

      const t = 1 + Math.floor(Math.pow(rng(), opts.distanceBias) * maxT);
      const bcells = acells.map(([x, y]) => [x + d.x * t, y + d.y * t]);

      // 掃過セル（A から B までに P が占める全セル）。相棒はここに置けない
      const blocked = new Set();
      for (let i = 0; i <= t; i++) {
        for (const [x, y] of acells) blocked.add((y + d.y * i) * size + (x + d.x * i));
      }

      // ストッパー: B+d に壁か既存ブロックがあるか
      let stopped = false;
      const front = new Set();
      for (const [x, y] of bcells) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) { stopped = true; continue; }
        const gi = ny * size + nx;
        if (blocked.has(gi)) continue;
        if (board.grid[gi] !== -1) { stopped = true; continue; }
        front.add(gi);
      }

      // 相棒は「B の P に隣接」かつ「A の P には隣接しない」
      const forbidden = haloOf(size, acells);
      const ctx = { size, blocked, forbidden };

      // ストッパーが無いなら、相棒が進行方向側を塞ぐ役も兼ねる
      const anchors = stopped ? haloOf(size, bcells) : front;
      for (const gi of blocked) anchors.delete(gi);
      if (anchors.size === 0) continue;

      const q = findPartner(board, rng, ctx, anchors);
      if (!q) continue;

      const cand = { acells, aname: placement.shape.name, q, dir, t };
      const placed = commitPair(board, color, cand);

      // 追い込みを掛ける予定なら、巻き戻せる置き方を選ぶ。
      // 埋め率の高い盤面では「置けはするが1歩も戻せない」場所が増え、そこに
      // 置いたペアは初手からぶつけられる形のまま残ってしまう
      const canRetract = !requireRetractable
        || retractCandidates(board, placed.movingId).length > 0
        || retractCandidates(board, placed.mateId).length > 0;
      // 一本道を求めるレベルでは、この局面で消せる色がこの色だけであることを課す
      const lineOk = !requireForced || clearableColors(board, 2).size <= 1;
      if (canRetract && lineOk) return placed;

      board.removePiece(placed.movingId);
      board.removePiece(placed.mateId);
      if (!fallback) fallback = cand;
      if (++checks >= opts.forcedChecks) break search;
    }
  }

  if (fallback) return commitPair(board, color, fallback);
  return null;
}

/**
 * ブロック id の「巻き戻し先」候補をすべて挙げる。
 *
 * 候補 (dir, t) は「今の位置から dir と逆向きに t マス戻した位置 A' から
 * dir 方向へ滑らせると、ちょうど今の位置で止まる」ことを意味する。条件は2つ:
 *   ・今の位置の進行方向側が壁か他のブロック（＝そこで止まる）
 *   ・A' までの経路が空いている（自分が今いるセルは通ってよい）
 * さらに A' で相棒に触れていてはいけない ―― 触れていたらその場で消えてしまう。
 */
function retractCandidates(board, id) {
  const size = board.size;
  const piece = board.pieces.get(id);
  if (!piece) return [];
  const partner = piece.color === BLOCKER
    ? null // 灰色に相棒はいない。どこへ戻しても消えようがない
    : [...board.pieces.values()].find((p) => p.color === piece.color && p.id !== id);
  const own = new Set(piece.cells.map(([x, y]) => y * size + x));
  const out = [];

  for (const dir of DIR_KEYS) {
    const d = DIRS[dir];

    // 今の位置に「ちょうど止まる」ためには、進行方向側が壁かブロックである必要がある
    let stopped = false;
    for (const [x, y] of piece.cells) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) { stopped = true; break; }
      const gi = ny * size + nx;
      if (own.has(gi)) continue;
      if (board.grid[gi] !== -1) { stopped = true; break; }
    }
    if (!stopped) continue;

    // 手前へ何マス戻せるか（自分のセルは通過できる）
    for (let t = 1; t < size; t++) {
      let ok = true;
      for (const [x, y] of piece.cells) {
        const nx = x - d.x * t;
        const ny = y - d.y * t;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) { ok = false; break; }
        const gi = ny * size + nx;
        if (own.has(gi)) continue;
        if (board.grid[gi] !== -1) { ok = false; break; }
      }
      if (!ok) break;

      // 戻した先で相棒に触れていてはいけない（触れていたらその場で消えてしまう）
      if (partner) {
        const from = piece.cells.map(([x, y]) => [x - d.x * t, y - d.y * t]);
        const halo = haloOf(size, from);
        if (partner.cells.some(([x, y]) => halo.has(y * size + x))) continue;
      }
      out.push({ id, dir, t, color: piece.color });
    }
  }
  return out;
}

/**
 * 追い込み手を1手ぶん足す。ブロック id を1つ手前の「滑らせれば今の位置に来る」
 * 場所へ戻し、その手を返す（盤面は書き換わる）。
 *
 * 候補の選び方が難易度を決める。いちばん効くのは
 * 「戻したあと、その色がもう1手では消せなくなっていること」――
 * これが満たされる限り、消すには必ずもう1手ぶん滑らせる必要がある。
 * 次に、長く滑る候補を好む（盤面の端から端まで動くほど読む範囲が広がる）。
 */
function retractOnce(board, rng, opts, id, seen, guard = Infinity) {
  const piece = board.pieces.get(id);
  if (!piece) return null;
  const cands = retractCandidates(board, id);
  if (cands.length === 0) return null;

  shuffle(rng, cands);
  let best = null;
  let bestScore = -Infinity;
  for (const c of cands.slice(0, opts.chainTries)) {
    // 乱数は候補ごとに必ず1回引く（枝刈りで引く回数が変わると決定論が崩れる）
    const jitter = rng() * 6;
    board.movePiece(id, OPPOSITE[c.dir], c.t);

    // 一度通った局面へ戻す手は採らない。行って戻るだけの往復が解に混ざってしまう
    let ok = !seen.has(board.fingerprint());
    let s = -Infinity;
    if (ok) {
      // 軽い判定（この色だけを見る）で点を出し、いまの最高点に届かない候補は
      // ここで捨てる。盤面全体を数える guard は残った候補にだけ掛ける ――
      // 追い込み1手あたり数十回まわるので、ここの枝刈りが生成時間を決める
      // 相棒から遠ざかる巻き戻しを強く好む。ここが「実際に何手かかるか」を決める
      s = (colorClearable(board, piece.color) ? 0 : 100)
        + gapToPartner(board, piece) * opts.gapWeight + c.t * 2 + jitter;
      if (s <= bestScore) ok = false;
      // guard を渡されたら「盤面全体で消せる色」をそこまでに抑える候補しか認めない。
      // せっかく塞いだ初手を、深さを稼ぐついでに開けてしまわないための歯止め
      else if (Number.isFinite(guard) && clearableColors(board, guard + 1).size > guard) ok = false;
    }
    board.movePiece(id, c.dir, c.t);
    if (!ok) continue;

    bestScore = s;
    best = c;
  }
  if (!best) return null;

  board.movePiece(id, OPPOSITE[best.dir], best.t);
  seen.add(board.fingerprint());
  return { pieceId: id, dir: best.dir, distance: best.t, color: piece.color, kind: 'chain' };
}

/**
 * 追い込み手を hops 回まで重ねる。戻り値は「作った順」（＝プレイ順の逆）。
 *
 * 巻き戻す相手は「ぶつけに行く側 P」だけでなく「待ち受ける側 Q」でもよい。
 * Q を巻き戻すと、プレイでは先に Q を定位置へ滑らせてから P をぶつけることになる
 * ―― 1組を消すのに両方のブロックを動かす、いちばん読み応えのある形になる。
 * （Q が戻る手はプレイ順で必ず P の消去手より前に来るので、ストッパーは崩れない）
 */
function retractPair(board, rng, opts, movingId, mateId, hops, seen) {
  const steps = [];
  for (let i = 0; i < hops; i++) {
    // どちらを巻き戻すかは毎回振る。P 寄りにして「ぶつけに行く側」の道のりを主役にする
    const order = rng() < 0.65 ? [movingId, mateId] : [mateId, movingId];
    let step = null;
    for (const id of order) {
      step = retractOnce(board, rng, opts, id, seen);
      if (step) break;
    }
    if (!step) break; // どちらも戻せない。ここまでの深さで諦める
    steps.push(step);
  }
  return steps;
}

/**
 * 追い込みを後から足す。
 *
 * 逆順構築では、最初に置くペアほど「まだ何も無い盤面」で巻き戻すことになる。
 * 止まる先が壁しか無いので、そこで稼げる深さには限りがある。ところが全部置き
 * 終えた盤面には**ストッパーが増えている** ―― さっきは戻せなかったブロックも、
 * いまならもう1手ぶん戻せる。
 *
 * ここで足した手はプレイ順では前に来るので、「先にこれを動かしておかないと、
 * あとでぶつけに行けない」という形になる。ペアごとの道のりが互いに割り込み、
 * 1組ずつ順番に片づける解き方ができなくなる。
 */
function deepenChains(board, rng, opts, solution, seen, want) {
  const ids = [...board.pieces.keys()];
  if (ids.length === 0) return 0;
  // ここに来る時点で初手は塞いである。深さを稼ぐために開け直しては本末転倒なので、
  // 「消せる色をいまより増やさない」ことを条件に付ける
  const guard = clearableColors(board).size;
  let added = 0;
  let idle = 0;
  while (added < want && idle < ids.length * 3) {
    const id = ids[Math.floor(rng() * ids.length)];
    const step = retractOnce(board, rng, opts, id, seen, guard);
    if (!step) { idle++; continue; }
    solution.unshift(step);
    added++;
    idle = 0;
  }
  return added;
}

/**
 * 近すぎるペアを引き離す。
 *
 * 逆順構築は「解ける手順があること」しか保証しない。実際に何手かかるかを決めて
 * いるのは同じ色の2個の隔たりのほうで、ここが2手だと、どれだけ長い保証解を
 * 作っても数手で消されてしまう。
 */
function pushApart(board, rng, opts, solution, seen) {
  const sep = opts.separation;
  if (sep <= 2) return;
  let added = 0;
  for (let round = 0; round < sep + 3 && added < opts.separationPushes; round++) {
    const near = nearColors(board, sep);
    if (near.size === 0) return;
    let moved = false;
    for (const color of shuffle(rng, [...near])) {
      if (added >= opts.separationPushes) break;
      const step = retractApart(board, rng, opts, seen, color, sep);
      if (!step) continue;
      solution.unshift(step);
      added++;
      moved = true;
    }
    if (!moved) return;
  }
}

/** 色 color の2個のどちらかを、いちばん引き離せる向きへ1手ぶん巻き戻す */
function retractApart(board, rng, opts, seen, color, sep) {
  const ids = [];
  for (const p of board.pieces.values()) if (p.color === color) ids.push(p.id);
  let best = null;
  let bestScore = pairDistance(board, color, sep);
  let checked = 0;
  for (const id of shuffle(rng, ids)) {
    for (const c of shuffle(rng, retractCandidates(board, id))) {
      if (checked++ >= opts.separationTries) break;
      board.movePiece(id, OPPOSITE[c.dir], c.t);
      const ok = !seen.has(board.fingerprint()) && !colorClearable(board, color);
      const d = ok ? pairDistance(board, color, sep) : -1;
      board.movePiece(id, c.dir, c.t);
      if (d > bestScore) { bestScore = d; best = c; }
      if (bestScore >= sep) break;
    }
    if (bestScore >= sep || checked >= opts.separationTries) break;
  }
  if (!best) return null;
  board.movePiece(best.id, OPPOSITE[best.dir], best.t);
  seen.add(board.fingerprint());
  return { pieceId: best.id, dir: best.dir, distance: best.t, color, kind: 'chain' };
}

/** 追い込み手の総数を色ごとに配る。先に置く色（＝最後に消す色）ほど深くする */
function hopPlan(colors, total) {
  const plan = new Array(Math.max(0, colors)).fill(0);
  if (plan.length === 0) return plan;
  const base = Math.floor(total / plan.length);
  let extra = total - base * plan.length;
  for (let i = 0; i < plan.length; i++) {
    plan[i] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
  }
  return plan;
}

/**
 * 初期盤面に「いきなり消せてしまう色」が残っていたら、その色をもう1手ぶん奥へ追い込む。
 * 狙いは clearAtStart === 0 ―― 第1手からすでに、何を動かしても消えない盤面。
 * 足した手は解の先頭に積む（この時点の盤面がそのまま初期盤面なので、常に成立する）。
 */
function pushBackOpenings(board, rng, opts, solution, seen, budget = opts.openingPushes) {
  let stale = 0;
  for (let added = 0; added < budget; added++) {
    const open = clearableColors(board);
    if (open.size === 0) return;
    const step = closeOneOpening(board, rng, opts, seen, open);
    if (!step) return; // どうにも動かせない。best-effort でここまで
    solution.unshift(step);

    // 打った結果、消せる色が減らなかったら「回り道」。何手も続くようなら諦めて
    // 別の試行に賭ける ―― 減らない手を積むのは、難しさではなく水増しにしかならない
    if (clearableColors(board, open.size).size >= open.size) {
      if (++stale > opts.openingStale) return;
    } else {
      stale = 0;
    }
  }
}

/**
 * 「いま消せる色」の数を確実に1つ以上減らす手を、1手ぶん打つ。
 *
 * 当の色のブロックを奥へ動かせば、その色は消せなくなる ―― けれど動かした先が
 * 別の色のストッパーになって、そちらが開いてしまうことがある。だから採否は
 * **必ず盤面全体の「消せる色の数」で判定する**。減らない手は打たない。
 *
 * こうすると1手ごとに数が単調に減るので、多くても色数ぶんの手で 0 に到達する。
 * 候補は「開いている色のブロック」を先に、続けて残り全部を見る（開いた原因が
 * ストッパー側にあるときは、そちらを退かすほうが早い）。
 */
function closeOneOpening(board, rng, opts, seen, open) {
  const priority = [];
  const rest = [];
  for (const p of board.pieces.values()) (open.has(p.color) ? priority : rest).push(p.id);
  const order = [...shuffle(rng, priority), ...shuffle(rng, rest)];

  let best = null;
  let bestScore = -Infinity;
  let checked = 0;
  for (const id of order) {
    for (const c of shuffle(rng, retractCandidates(board, id))) {
      if (checked++ >= opts.openingTries) break;
      board.movePiece(id, OPPOSITE[c.dir], c.t);
      // 一度通った局面へは戻さない（往復が手順に混ざる）
      const n = seen.has(board.fingerprint()) ? Infinity : clearableColors(board, open.size + 1).size;
      board.movePiece(id, c.dir, c.t);

      if (n > open.size) continue; // 開く色が増える手は採らない
      // 減る手を強く優先しつつ、同数でも採る ―― 「1手では減らないが、動かせば
      // 次の1手で減らせる」形があるので、横ばいを禁じると手前で行き詰まる
      const s = (open.size - n) * 100 + rng() * 10;
      if (s > bestScore) { bestScore = s; best = c; }
      if (n === 0) break;
    }
    if (bestScore >= 100 * open.size || checked >= opts.openingTries) break;
  }
  if (!best) return null;

  board.movePiece(best.id, OPPOSITE[best.dir], best.t);
  seen.add(board.fingerprint());
  return { pieceId: best.id, dir: best.dir, distance: best.t, color: best.color, kind: 'setup' };
}

/**
 * 仕込み手を1つ前に足す。
 * 盤面のブロックを1つ選び、「滑らせれば今の位置にちょうど来る」手前の位置へ戻す。
 * その手自体では何も消えない（同色は隣接していないため）が、
 * 通さないと後の手が成立しない。
 *
 * 追い込み手との違いは「対象を選ばないこと」。次に消したいブロックとは限らない
 * ので、盤面のどこを触ればよいのか自体が読みどころになる。
 */
function placeSetup(board, rng, opts, seen, maxClearable = Infinity) {
  const candidates = [];
  for (const id of board.pieces.keys()) {
    for (const c of retractCandidates(board, id)) candidates.push(c);
  }
  if (candidates.length === 0) return null;

  // 「動かした結果、すぐ消せる色が減る」候補を選ぶ。
  // 消せる色が 0 になれば、その仕込み手を通さないと先へ進めない盤面になる。
  shuffle(rng, candidates);
  let best = null;
  let bestN = Infinity;
  for (const c of candidates.slice(0, opts.setupTries)) {
    board.movePiece(c.id, OPPOSITE[c.dir], c.t);
    const revisits = seen.has(board.fingerprint());
    const n = revisits ? Infinity : clearableColors(board, bestN).size;
    board.movePiece(c.id, c.dir, c.t);
    if (n < bestN) {
      bestN = n;
      best = c;
      if (n === 0) break;
    }
  }
  // 呼び出し側が「ここまで減らなければ意味が無い」と言っているときは打たない
  if (!best || bestN > maxClearable) return null;

  board.movePiece(best.id, OPPOSITE[best.dir], best.t);
  seen.add(board.fingerprint());
  return { pieceId: best.id, dir: best.dir, distance: best.t, color: best.color, kind: 'setup' };
}

/** 1回分の生成試行 */
function attemptBuild(seed, opts) {
  const rng = makeRng(seed);
  const board = new Board(opts.size);
  const solution = [];
  const plan = hopPlan(opts.colors, opts.chainMoves);
  // 作った各手の「直前の局面」。同じ局面へ戻る手を採らないために覚えておく
  // （放っておくと「右へ押して、左へ押し戻す」だけの往復が手順に混ざる）
  const seen = new Set();

  // 先に灰色を撒いておく。以降の逆順構築はこれを壁として組み上がる
  placeBlockers(board, rng, opts.blockers);

  for (let c = 0; c < opts.colors; c++) {
    const placed = placePair(board, rng, opts, c, opts.forced, plan[c] > 0);
    if (!placed) return null;
    // 逆順に作っているので、新しいステップほど「先の手」になる
    solution.unshift(placed.step);
    seen.add(board.fingerprint());
    // ぶつける場所から手前へ何度も巻き戻す ―― ここで「スライドの重ね」が生まれる
    const chain = retractPair(board, rng, opts, placed.movingId, placed.mateId, plan[c], seen);
    for (const step of chain) solution.unshift(step);

    // いま置いたペアが、別の色の通路を変えて「消せる形」を作ってしまうことがある。
    // 盤面がまだ空いているこの段階なら戻す先が豊富なので、その場で塞いでおく。
    // 全部置き終えてからまとめて塞ごうとしても、動かす余地が残っていない
    pushBackOpenings(board, rng, opts, solution, seen, opts.openingPushesInline);
  }

  // ① 取りこぼしがあれば、この時点でもう一度塞ぐ
  pushBackOpenings(board, rng, opts, solution, seen);

  // ② 盤面が埋まったぶんストッパーも増えている。届かなかった深さをここで取り返す
  //    （塞いだ状態は崩さない）
  const got = solution.filter((s) => s.kind === 'chain').length;
  if (got < opts.chainMoves) {
    deepenChains(board, rng, opts, solution, seen, opts.chainMoves - got);
  }

  // ③ 仕込み手。消せる色を増やす向きには打たない
  for (let i = 0; i < opts.setupMoves; i++) {
    const step = placeSetup(board, rng, opts, seen, clearableColors(board).size);
    if (!step) break;
    solution.unshift(step);
  }

  // ④ 近すぎるペアを引き離す。ここが「実際に何手かかるか」を決める
  pushApart(board, rng, opts, solution, seen);

  // ⑤ 引き離しで開いた色が残っていれば、最後に押し戻す
  pushBackOpenings(board, rng, opts, solution, seen);

  return { board, solution };
}

/**
 * 解の道筋を調べる。
 *   clearAtStart : 初期盤面に「消せる手」がいくつあるか（0 が狙い）
 *   forced       : どの局面でも「消せる手」の結果が実質1通りしかないか
 *   dryStreak    : 何も消えない手が最大で何手続くか（＝読みの深さ）
 *   blindMoves   : 「消せる色がひとつも無い」局面が何回あるか
 */
export function analyzeSolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);
  let forced = true;
  let clearAtStart = 0;
  let branchPoints = 0;
  let blindMoves = 0;
  let dryStreak = 0;
  let streak = 0;

  for (let i = 0; i < solution.length; i++) {
    const colors = clearableColors(board);
    if (i === 0) clearAtStart = colors.size;
    if (colors.size === 0) blindMoves++;
    // 何も消せない局面は「選択肢が無い」ので分岐とはみなさない
    if (colors.size > 1) {
      forced = false;
      branchPoints++;
    }
    const res = board.applyMove(solution[i].pieceId, solution[i].dir);
    if (res && res.cleared.length > 0) streak = 0;
    else dryStreak = Math.max(dryStreak, ++streak);
  }
  return { forced, clearAtStart, branchPoints, blindMoves, dryStreak };
}

/** レベル番号からパズルを作る */
export function generateLevel(level, overrides = {}) {
  const config = levelConfig(level);
  const puzzle = generatePuzzle(levelSeed(config.level), {
    size: config.size,
    colors: config.colors,
    blockers: config.blockers,
    chainMoves: config.chainMoves,
    setupMoves: config.setupMoves,
    forced: config.forced,
    attempts: config.attempts,
    ...overrides,
  });
  return { ...puzzle, level: config.level, config };
}

/** generateLevel の非同期版（画面を固めずに生成する） */
export async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  const config = levelConfig(level);
  const puzzle = await generatePuzzleAsync(levelSeed(config.level), {
    size: config.size,
    colors: config.colors,
    blockers: config.blockers,
    chainMoves: config.chainMoves,
    setupMoves: config.setupMoves,
    forced: config.forced,
    attempts: config.attempts,
    ...overrides,
  }, onProgress);
  return { ...puzzle, level: config.level, config };
}

function runAttempt(seed, opts, attempt) {
  // 試行ごとにシードを派生させる（同じ seed なら常に同じ結果）
  const derived = (seed + attempt * 0x9e3779b1) >>> 0;
  const built = attemptBuild(derived, opts);
  if (!built || built.solution.length === 0) return null;

  const snapshot = built.board.snapshot();
  if (!verifySolution(snapshot, built.solution, opts.size).ok) return null;

  const analysis = analyzeSolution(snapshot, built.solution, opts.size);
  return {
    seed: seed >>> 0,
    snapshot,
    solution: built.solution,
    par: built.solution.length,
    cells: built.board.filledCells,
    pieces: built.board.pieceCount,
    size: opts.size,
    colors: opts.colors,
    blockers: [...built.board.pieces.values()].filter((p) => p.color === BLOCKER).length,
    chainMoves: built.solution.filter((s) => s.kind === 'chain').length,
    setupMoves: built.solution.filter((s) => s.kind === 'setup').length,
    analysis,
  };
}

/**
 * 望んだ性質をどれだけ満たしているか。大きいほど良い。
 * いちばん重いのは「初手から何も消せないこと」―― この盤面でしか
 * 「スライドを重ねて読む」体験は生まれない。
 */
function score(result, opts) {
  let s = result.cells;
  // 初手から消せる手が無い＝まず通路を作る読みから入る。これが一番欲しい形。
  // 追い込みの深さより優先する（深くても初手で消せたら台無しなので、桁を分ける）
  if (result.analysis.clearAtStart === 0) s += 4000;
  else s -= result.analysis.clearAtStart * 1500;
  s += Math.min(result.chainMoves, opts.chainMoves) * 45;
  s += result.analysis.dryStreak * 12;
  if (opts.setupMoves > 0) s += Math.min(result.setupMoves, opts.setupMoves) * 40;
  if (opts.forced && result.analysis.forced) s += 300;
  return s;
}

/**
 * 狙いどおりの盤面か。ここが真になった時点で試行を打ち切る。
 * 追い込み手は「目標ちょうど」を求めない ―― 深いほど巻き戻せる場所は尽きやすく、
 * 100% を条件にすると毎回すべての試行を回すことになって生成が遅いだけになる。
 */
function goodEnough(result, opts) {
  if (result.analysis.clearAtStart !== 0) return false;
  if (result.chainMoves < opts.chainMoves * opts.chainQuota) return false;
  if (opts.setupMoves > 0 && result.setupMoves < opts.setupMoves) return false;
  if (opts.forced && !result.analysis.forced) return false;
  return true;
}

export function generatePuzzle(seed, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (!result) continue;
    const s = score(result, opts);
    if (s > bestScore) { best = result; bestScore = s; }
    if (goodEnough(result, opts)) break;
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * generatePuzzle と同じものを、試行の合間にイベントループへ制御を返しながら作る。
 * UI 側はこちらを使って「生成中」を出しつつ画面を固めない。
 */
export async function generatePuzzleAsync(seed, options = {}, onProgress = null) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (result) {
      const s = score(result, opts);
      if (s > bestScore) { best = result; bestScore = s; }
      if (goodEnough(result, opts)) break;
    }
    if (onProgress) onProgress((attempt + 1) / opts.attempts);
    // 詰まった盤面では1試行が 50ms 近くかかる。2回ごとに制御を返して、
    // 「組み立て中」の表示が止まって見えないようにする
    if (attempt % 2 === 1) await new Promise((r) => setTimeout(r, 0));
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * 生成された解答手順を前から実行して、本当に全消しできるか確かめる。
 * 生成ロジックのバグをここで必ず捕まえる（テストからも使用）。
 */
export function verifySolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }
  for (const p of board.pieces.values()) {
    if (p.cells.length < 1 || p.cells.length > 9) {
      return { ok: false, reason: `${p.cells.length}マスのブロックがある（1〜9マスであるべき）` };
    }
  }
  const counts = new Map();
  for (const p of board.pieces.values()) {
    if (p.color === BLOCKER) continue; // 灰色は何個でもよい
    counts.set(p.color, (counts.get(p.color) || 0) + 1);
  }
  for (const [color, n] of counts) {
    if (n !== 2) return { ok: false, reason: `色 ${color} のブロックが ${n} 個（2個であるべき）` };
  }

  for (let i = 0; i < solution.length; i++) {
    const step = solution[i];
    if (!board.pieces.has(step.pieceId)) {
      return { ok: false, reason: `手 ${i + 1}: ブロックが存在しない` };
    }
    const res = board.applyMove(step.pieceId, step.dir);
    if (!res) return { ok: false, reason: `手 ${i + 1}: 動かせない` };
    if (res.steps !== step.distance) {
      return { ok: false, reason: `手 ${i + 1}: 停止位置が想定と違う (${res.steps} != ${step.distance})` };
    }
    // 消えるのは 'clear' の手だけ。追い込み手も仕込み手も何も消してはいけない
    const wantCleared = step.kind === 'clear' ? 2 : 0;
    if (res.cleared.length !== wantCleared) {
      return { ok: false, reason: `手 ${i + 1}: 消去数が想定と違う (${res.cleared.length} != ${wantCleared})` };
    }
    if (board.hasSameColorContact()) {
      return { ok: false, reason: `手 ${i + 1} の直後に同色接触が残っている` };
    }
  }

  if (!board.isCleared) {
    return { ok: false, reason: `解答を実行しても色つきブロックが ${board.coloredCount} 個残る` };
  }
  return { ok: true };
}
