// SLIDE POP! ― tools/build.mjs が src/ から生成。直接編集しないこと。
(function () {
'use strict';

// ===== src/shapes.js =====
// ブロック形状の定義。
//
// ブロックは「大小さまざまな長方形」。凸凹したテトロミノは使わない。
//
// 長方形にしているのは見た目のためではない。**大きいブロックほど通れる隙間が
// 減る** ―― 3×3 のブロックは幅3の通路しか通れないので、同じ色の相手にたどり
// つくまでの道のりが長くなる。凸凹した形は「どこまでが1つの塊か」を読む負荷を
// 増やすだけで、通路を読む面白さは増えない。長方形なら形が一目で分かるまま、
// 動かしにくさだけを上げられる。
//
// 大きさは 1×2 から 3×3 まで。色つきも灰色も同じ範囲を使う。
//   下限が 1×2 なのは、1×1 はどんな隙間もすり抜けてしまい、通路をふさげないから。
//   上限が 3×3 なのは、それ以上だと 6×6 の盤面の半分を占めてしまい、
//   盤面が「動かせない」ほうへ倒れるから（＝手数が伸びずに詰むだけになる）。

/** 方向ベクトル。y は下が正（画面座標系と一致させる） */
const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const DIR_KEYS = ['up', 'right', 'down', 'left'];

/** 反対方向 */
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// 長方形の基準形を作る。w×h のマスを敷き詰めるだけ
function rect(w, h) {
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
  return cells;
}

/**
 * 使う長方形。縦横は buildShapes が回転で足すので、ここには片側だけ書けばよい
 * （2×3 を書けば 3×2 も出る）。
 */
const RECT_BASE = {
  '1x2': rect(1, 2),
  '1x3': rect(1, 3),
  '2x2': rect(2, 2),
  '2x3': rect(2, 3),
  '3x3': rect(3, 3),
};

function normalize(cells) {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return cells
    .map(([x, y]) => [x - minX, y - minY])
    .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

function rotate(cells) {
  // 時計回り 90 度: (x, y) -> (-y, x)
  return normalize(cells.map(([x, y]) => [-y, x]));
}

function keyOf(cells) {
  return cells.map(([x, y]) => `${x},${y}`).join(' ');
}

function buildShapes(base) {
  const out = [];
  for (const [name, cells0] of Object.entries(base)) {
    const seen = new Set();
    let cells = normalize(cells0);
    for (let r = 0; r < 4; r++) {
      const key = keyOf(cells);
      if (!seen.has(key)) {
        seen.add(key);
        let w = 0;
        let h = 0;
        for (const [x, y] of cells) {
          if (x + 1 > w) w = x + 1;
          if (y + 1 > h) h = y + 1;
        }
        out.push({ id: out.length, name, rotation: r, cells, w, h, size: cells.length });
      }
      cells = rotate(cells);
    }
  }
  return out;
}

/** 盤面に出てくる形（全向き）。色つきも灰色もここから選ばれる */
const PIECES = buildShapes(RECT_BASE);

/** ブロックの一辺の下限・上限 */
const MIN_SIDE = 1;
const MAX_SIDE = 3;
/** ブロックのマス数の下限・上限（1×2 = 2 マス 〜 3×3 = 9 マス） */
const MIN_CELLS = 2;
const MAX_CELLS = 9;

// ===== src/board.js =====
// 盤面モデルとルールの実装。
//
// ルールは 3 つだけ:
//   ① スライド  : ブロックは壁か他ブロックにぶつかるまで一直線に滑る（距離は選べない）
//   ② 同色接触消去: 滑り終えた直後、同色ブロックが上下左右で触れていればグループごと消える
//                   （消去の単位は「ブロック」。単体ブロックは自己消去しない = 2 個以上必要）
//   ③ 重力なし  : 消えても他は落ちない。空きマスは消去でしか生まれない
//
// 不変条件: どの手の直後も「同色ブロック同士は隣接していない」。
// 触れた瞬間に消えるため、この性質は初期盤面から永久に保たれる。
// この不変条件があるおかげで「動かしたブロックに触れた相手だけが消える」ことが確定する。
//
// 敗北条件は無い。盤面には同じ色がちょうど2個ずつしか無く、消せる手が
// 見当たらない局面でも、何も消さない手で通路を作れば必ず解ける。

const BOARD_SIZE = 12;

const EMPTY = -1;
const WALL = -2;

/**
 * 灰色ブロックの色番号。
 * どの色とも消えない、ただの邪魔者。押せば普通に滑るが、盤上から消えることは無い。
 *
 * これがあると「消えた跡に空きマスが増える」流れが最後まで続かない ――
 * 終盤になっても盤面は迷路のままで、同じ色の2個を寄せる道のりが短くならない。
 * 勝利条件は「盤面が空になること」ではなく「色つきブロックが全部消えること」。
 */
const BLOCKER = -9;

class Board {
  constructor(size = BOARD_SIZE) {
    this.size = size;
    this.grid = new Int16Array(size * size).fill(EMPTY);
    /** @type {Map<number, {id:number,color:number,cells:number[][],shape:string}>} */
    this.pieces = new Map();
    this.nextId = 1;
  }

  idx(x, y) {
    return y * this.size + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  /** 占有情報。盤外は WALL(-2)、空きは EMPTY(-1)、それ以外はピース id */
  at(x, y) {
    if (!this.inBounds(x, y)) return WALL;
    return this.grid[y * this.size + x];
  }

  get pieceCount() {
    return this.pieces.size;
  }

  get filledCells() {
    let n = 0;
    for (const p of this.pieces.values()) n += p.cells.length;
    return n;
  }

  get isEmpty() {
    return this.pieces.size === 0;
  }

  /** 色つきブロック（灰色を除く）の数 */
  get coloredCount() {
    let n = 0;
    for (const p of this.pieces.values()) if (p.color !== BLOCKER) n++;
    return n;
  }

  /** クリア判定。灰色は残っていてよい */
  get isCleared() {
    return this.coloredCount === 0;
  }

  /** 与えられたセル群がすべて盤内かつ空きか */
  cellsFree(cells) {
    for (const [x, y] of cells) {
      if (!this.inBounds(x, y)) return false;
      if (this.grid[y * this.size + x] !== EMPTY) return false;
    }
    return true;
  }

  /** セル群のいずれかが色 color のピースと上下左右で隣接しているか */
  touchesColor(cells, color, ignoreIds = null) {
    for (const [x, y] of cells) {
      for (const key of DIR_KEYS) {
        const d = DIRS[key];
        const id = this.at(x + d.x, y + d.y);
        if (id < 0) continue;
        if (ignoreIds && ignoreIds.has(id)) continue;
        const p = this.pieces.get(id);
        if (p && p.color === color) return true;
      }
    }
    return false;
  }

  addPiece(color, cells, shape = '') {
    const id = this.nextId++;
    const piece = {
      id,
      color,
      cells: cells.map(([x, y]) => [x, y]),
      shape,
    };
    this.pieces.set(id, piece);
    for (const [x, y] of piece.cells) this.grid[y * this.size + x] = id;
    return piece;
  }

  removePiece(id) {
    const p = this.pieces.get(id);
    if (!p) return;
    for (const [x, y] of p.cells) {
      if (this.grid[y * this.size + x] === id) this.grid[y * this.size + x] = EMPTY;
    }
    this.pieces.delete(id);
  }

  /**
   * ブロックが方向 dir に何マス滑るか。
   * 自分自身が今いるセルは通過可能（自分が退いた後なので）。
   */
  slideDistance(id, dir) {
    const p = this.pieces.get(id);
    if (!p) return 0;
    const d = DIRS[dir];
    let steps = 0;
    for (let n = 1; n <= this.size; n++) {
      let ok = true;
      for (const [x, y] of p.cells) {
        const nx = x + d.x * n;
        const ny = y + d.y * n;
        if (!this.inBounds(nx, ny)) { ok = false; break; }
        const occ = this.grid[ny * this.size + nx];
        if (occ !== EMPTY && occ !== id) { ok = false; break; }
      }
      if (!ok) break;
      steps = n;
    }
    return steps;
  }

  /** ブロックを steps マスだけ dir 方向へ動かす（グリッド更新込み） */
  movePiece(id, dir, steps) {
    if (steps <= 0) return;
    const p = this.pieces.get(id);
    const d = DIRS[dir];
    for (const [x, y] of p.cells) {
      if (this.grid[y * this.size + x] === id) this.grid[y * this.size + x] = EMPTY;
    }
    p.cells = p.cells.map(([x, y]) => [x + d.x * steps, y + d.y * steps]);
    for (const [x, y] of p.cells) this.grid[y * this.size + x] = id;
  }

  /** ブロックに上下左右で接しているブロック id の集合 */
  neighborsOf(id) {
    const p = this.pieces.get(id);
    const out = new Set();
    if (!p) return out;
    for (const [x, y] of p.cells) {
      for (const key of DIR_KEYS) {
        const d = DIRS[key];
        const other = this.at(x + d.x, y + d.y);
        if (other >= 0 && other !== id) out.add(other);
      }
    }
    return out;
  }

  /** id を含む同色連結グループ（ブロック id の配列） */
  colorGroup(id) {
    const start = this.pieces.get(id);
    if (!start) return [];
    return this.groupAt(id, start.cells);
  }

  /**
   * 「ブロック movedId が movedCells にいる」と仮定した同色連結グループ。
   * 盤面を書き換えずに手の結果を読むために使う。
   * 不変条件（動かす前は同色非隣接）があるため、
   * movedId の元セルがグリッドに残っていても結果は変わらない。
   */
  groupAt(movedId, movedCells) {
    const start = this.pieces.get(movedId);
    if (!start) return [];
    const color = start.color;
    // 灰色はどれだけ触れ合っても消えない
    if (color === BLOCKER) return [movedId];
    const seen = new Set([movedId]);
    const stack = [[movedId, movedCells]];
    while (stack.length) {
      const [cur, cells] = stack.pop();
      for (const [x, y] of cells) {
        for (const key of DIR_KEYS) {
          const d = DIRS[key];
          const other = this.at(x + d.x, y + d.y);
          if (other < 0 || other === cur || seen.has(other)) continue;
          const q = this.pieces.get(other);
          if (q && q.color === color) {
            seen.add(other);
            stack.push([other, q.cells]);
          }
        }
      }
    }
    return [...seen];
  }

  /** 盤面全体を走査して、同色で接しているグループをすべて返す（2 個以上のみ） */
  findAllTouchingGroups() {
    const seen = new Set();
    const groups = [];
    for (const id of this.pieces.keys()) {
      if (seen.has(id)) continue;
      const group = this.colorGroup(id);
      for (const g of group) seen.add(g);
      if (group.length >= 2) groups.push(group);
    }
    return groups;
  }

  /** 不変条件チェック（テスト・生成の検証用） */
  hasSameColorContact() {
    return this.findAllTouchingGroups().length > 0;
  }

  /**
   * 1 手をシミュレートする（盤面は変更しない）。
   * 戻り値: null（動かせない）または { id, dir, steps, cleared, clearedCells }
   */
  simulate(id, dir) {
    const steps = this.slideDistance(id, dir);
    if (steps <= 0) return null;
    const p = this.pieces.get(id);
    const d = DIRS[dir];
    const target = p.cells.map(([x, y]) => [x + d.x * steps, y + d.y * steps]);
    const group = this.groupAt(id, target);
    let cleared = [];
    let clearedCells = 0;
    if (group.length >= 2) {
      cleared = group;
      for (const g of group) clearedCells += this.pieces.get(g).cells.length;
    }
    return { id, dir, steps, target, cleared, clearedCells };
  }

  /**
   * 1 手を実際に適用する。
   * 戻り値: null（無効手）または { id, dir, steps, from, to, cleared: [{id,color,cells}] }
   */
  applyMove(id, dir) {
    const steps = this.slideDistance(id, dir);
    if (steps <= 0) return null;
    const p = this.pieces.get(id);
    const from = p.cells.map(([x, y]) => [x, y]);
    this.movePiece(id, dir, steps);
    const to = p.cells.map(([x, y]) => [x, y]);

    const group = this.colorGroup(id);
    const cleared = [];
    if (group.length >= 2) {
      for (const g of group) {
        const q = this.pieces.get(g);
        cleared.push({ id: q.id, color: q.color, cells: q.cells.map(([x, y]) => [x, y]) });
      }
      for (const g of group) this.removePiece(g);
    }
    return { id, dir, steps, from, to, cleared };
  }

  /** 「動かせる」手をすべて列挙（消去の有無は問わない） */
  allMoves() {
    const out = [];
    for (const id of this.pieces.keys()) {
      for (const dir of DIR_KEYS) {
        const r = this.simulate(id, dir);
        if (r) out.push(r);
      }
    }
    return out;
  }

  /** 消去が発生する手だけを、消去セル数の多い順に列挙 */
  findClearingMoves() {
    const out = [];
    for (const id of this.pieces.keys()) {
      for (const dir of DIR_KEYS) {
        const r = this.simulate(id, dir);
        if (r && r.cleared.length > 0) out.push(r);
      }
    }
    out.sort((a, b) => b.clearedCells - a.clearedCells);
    return out;
  }

  /** 盤面の完全なスナップショット（Undo 用） */
  snapshot() {
    return {
      nextId: this.nextId,
      pieces: [...this.pieces.values()].map((p) => ({
        id: p.id,
        color: p.color,
        shape: p.shape,
        cells: p.cells.map(([x, y]) => [x, y]),
      })),
    };
  }

  restore(snap) {
    this.grid.fill(EMPTY);
    this.pieces.clear();
    this.nextId = snap.nextId;
    for (const p of snap.pieces) {
      const piece = {
        id: p.id,
        color: p.color,
        shape: p.shape,
        cells: p.cells.map(([x, y]) => [x, y]),
      };
      this.pieces.set(piece.id, piece);
      for (const [x, y] of piece.cells) this.grid[y * this.size + x] = piece.id;
    }
  }

  clone() {
    const b = new Board(this.size);
    b.restore(this.snapshot());
    return b;
  }

  /** 状態の指紋（生成中に同じ局面を作っていないか調べるのに使う） */
  fingerprint() {
    const rows = [];
    for (const p of [...this.pieces.values()].sort((a, b) => a.id - b.id)) {
      rows.push(`${p.id}:${p.color}:${p.cells.map(([x, y]) => `${x}.${y}`).join('-')}`);
    }
    return rows.join('|');
  }
}

/** スナップショットから盤面を復元 */
function boardFromSnapshot(snap, size = BOARD_SIZE) {
  const b = new Board(size);
  b.restore(snap);
  return b;
}

// ===== src/exact.js =====
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

/** 探索で使う方向の並び。添字 0..3 がそのまま向きを表す */
const DIR_ORDER = ['up', 'right', 'down', 'left'];

/**
 * 灰色ブロックに使う長方形。いちばん小さくて 1×2、いちばん大きくて 3×3。
 * 1×1 を入れないのは、単独マスは隙間をすり抜けてしまい通路をふさげないから。
 */
const GREY_RECTS = [[1, 2], [2, 1], [1, 3], [3, 1], [2, 2], [2, 3], [3, 2], [3, 3]];

/** 色つきブロックに使う長方形。灰色と同じく 1×2 〜 3×3 */
const COLOR_RECTS = [[1, 2], [2, 1], [1, 3], [3, 1], [2, 2], [2, 3], [3, 2], [3, 3]];

/** 盤面の一辺の上限。ここを超えると位置が 1 バイトに収まらないし、探索も終わらない */
const MAX_BOARD = 8;

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
function pieceKey(kind, offs) {
  const sorted = offs.map(([x, y]) => `${x},${y}`).sort();
  return `${kind}|${sorted.join(' ')}`;
}

const rectCells = (w, h) => {
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
function layout(rng, options = {}) {
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
function compile(board, colorIds) {
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
function positionsOf(ctx, board, colorIds) {
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
function canonicalKey(size, rects) {
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
function rectsOf(board) {
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
class Explorer {
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

// ===== src/rng.js =====
// 決定論的な擬似乱数。シードを固定すれば誰がどこで実行しても同じ盤面になる。
// （デイリーパズル / リプレイ共有のための土台）

/** mulberry32: 32bit シードから [0,1) の乱数を返す関数を作る */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 任意の文字列を 32bit シードへ（FNV-1a） */
function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 0 以上 n 未満の整数 */
function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/** 配列からひとつ選ぶ */
function pick(rng, arr) {
  return arr[randInt(rng, arr.length)];
}

/** 破壊的シャッフル（Fisher-Yates） */
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** 重み付き抽選。weights は同じ長さの数値配列 */
function weightedIndex(rng, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** 表示・共有用のシード文字列（英数字） */
function seedToCode(seed) {
  return (seed >>> 0).toString(36).toUpperCase();
}

/** seedToCode の逆。パースできなければ hashSeed にフォールバック */
function codeToSeed(code) {
  const cleaned = String(code).trim().toUpperCase();
  if (/^[0-9A-Z]{1,7}$/.test(cleaned)) {
    const n = parseInt(cleaned, 36);
    if (Number.isFinite(n)) return n >>> 0;
  }
  return hashSeed(cleaned);
}

// ===== src/levelData.js =====
// tools/harvest.mjs で採集し、tools/levels.mjs が並べたもの。直接編集しないこと。
//
// 1行1レベルではなく1文字列1レベル。詰め方は src/levelCodec.js を参照。
// どのレベルも「到達できる盤面を全部展開して、ゴールからちょうど N 手の配置」で、
// N（＝符号に入っている手数）は推定ではなく**厳密な最短手数**。
// これより短く解く方法は存在しない。

const LEVEL_CODES = [
  'EDDBYDAIARBI', 'FGTCAHDBECQCZEDRCIAB', 'EFCEYGIDQDSDCADAEZAQ', 'FGRCbEaBQCSGAHFJABDBCZBZ',
  'FHBBaHABSDgDQEKGGADABAEKFQAQ', 'FGUCBHEBbBRGYHBYCYABDIEYCSAY', 'FHDEQEhDjDIGSGaGCYEABACADaGQFQBI', 'EGABKDBBSBCDQEDIFIARCYBYEYDBFIAI',
  'FHDFiGIBJDbDREAGBZCQDYEQAQGJDACAFABA', 'FHEBRFYBbBcBDCAEGICCBYDYFRAYECFIDIAQBI', 'FHMBAECBDCQCRDaHGYARDICIBIEBGYAYDRCIAC', 'FIAEaEMBRBYBcBCCDDCYFBBIGRAIECDYGYBYFRCIBA',
  'FIDDbEACBDTDgDREJGFICRHYAQDJHAAaEAAIBAFJGQAQ', 'FHQCDEJBTBCCUCZEABCADQGYERBYFBDIEIGIARCYBYBQ', 'EGBBTBCBDBSBQEAYCYEBBYDREIBBFIARCYBYEYDBFIAI', 'FHbBBFABaBDCUCYEFBAIDIGICSBYEYDCAYFRDIEIBICCGYAY',
  'EHQBTBABBBDBRDZDEYBBFIGIAICRDYABFYGYBREIAIDICBFYAQ', 'FHEBIEDBZBaBCCTFBADYEYFRBIDCEYFYGYASCIAABIDIECFYGYAY', 'FIIELESBZBADCDbDiGCADYFIGZBQFQEKAACADAGAHZBQGJCRAIDBCZAR', 'FIIEgGCBDDLDZDbESGAAFYHZGABJFQHQAQCQDaEAGAHJAQDQEaCAGAHABA',
  'FIBEhGMBRBYBcBACDCCADIFABIEIEABZFQFYCSHIAIEBDYFABIGREYDBFZAR', 'FIIBLEYBcBADCDJEhGFIEIGQEQFaBADAGIHICIAREYBYDBEQGIEIABCYEQAI', 'FIECBEDBaBACTCRDYDARCIFBDIHIERBYHQGQFYCYABDICSFIBIEBGAHYCYFRBI', 'FIABCCBBTBUCQDDEZEDQHYBRGYEBDIBIFIHIASCYGYBBHIAICSFYGYBYEYDCHIAI',
  'FIDBQBABCBJBZBSCTFAIDIEAEIFCBICSFYBBGYHYASDIAAEIBIFICCGYHYESBIBQ', 'FJECREBBIBTBYBcBKDiDDAFAHAEAIZGYARHICIDIFBBYCSHYABGICIBIFRDYBACYERBI', 'FIABLDBBaBcBCCTDQFBADIFRGAGYEBDIFIHIASCYCQBaGAGIBIBQGaEAEYDCFIHIAIAA', 'FIYBCDEBADTDaDhGIHFYEQHIABGYEQFJGAEaFQCRBIEIGIARHYBQDKHAAAEYFYCQBQBZ',
  'FIJBcBSBACTDiDCEYEAAGICBEZBAFIHIDRAYCYGYBBEJHAFZERHJCRAICIARGZBZHBCJBR', 'FIABcBJDQDYDDESEgGBACAHJEQDQAQCYFYBBGIDIDAEAEIARDYDAAAEAHZGQEJAJDRCRFZBZ', 'FJBBcBKBRBaBICTCgDDECAEAHIFQAYCYIYBCGIEIDIHICSAIFBCYHYAREQIYBYGBEIDIAIDQBQ', 'FJIBSDRBYBhDjDDEAGaGBICACIAIDBIZFAEJIQFaBQGQHJAADAFABaEAIJBQFQAQDQHZGAEAFKAQ',
  'FIACbEJBMBSBCDKDYEDAEQGQGIEBHIARFZEAEICIFIABHYCRGZDQEQFJGBCBBYCYDREIBBHJCRBY', 'FJABDEQBSBTBJCBDgDiGEIDIFICICAHAIZDQEQBQGJCAFAHIARCYFYBYGYECDIDAHIIJAQAICSFYAC', 'FITEAGDBRDZDjDIGgGCIDYEYAYCRBJGJDBEBAZCZFBHJAQEQGZFACJEJEQGQFaBQDKFABZDYCBGJAA', 'FIABMBDBQBJCBDSDaHBADQAQEQFYCYGICQFJAAAIDCEYASCYGYBQCAFICIACGYHYBRFRCJAJGBFZAQBA',
  'FJBBTEaBCCDDLDQDYDjDAYHQGQDYCCGICQHIASDYEZFABAGJCQEQFZBAGAIAHJAIAAHaCQIQGQBQFJEABY', 'FJQCKEABEBJBUBbBZDBGFQDQHQEQIICIABHYGYFYDRBIGBHIARCYEBGQGYBYDBFIHIGQEQIYDAFAHIGIERBY', 'FIbBCCABJBQBDCUCZEEQGBAIHIDRBYFYGYACHIDIEICSBYFYDCHYASGIDIFIECHYAYGRDIFIEIBICCHYAYAA', 'FIbBYDCBSCDDTDgDAFAIFADICSEYFYACCADIGJBQHQEZFACAGABJHQEQFZAYAQFKCADAEAHABZGQAQAYGIAQ',
  'FIIBUBEBYBBCjDKEZEAAGABYCRGIEIAIDCHYHAFaBQERGYCBBIEIHIDRAYGYEBBYCSEIGIAIBADBFJHYBYHQAQ', 'FIIDbDECQDjDKEZEBGGYBYCQHIAADAGAEaBQCQFQDKAQHZDAAKGAAYEABZFQAQDQHJGAAZFABJEQAQGQHZDAFAAJ', 'FJBBaDCBUCDDLDiDYERGAYCYEYFYDBBIGIHIASCYCQEZFAIAHAGZBQDQFIEICAAAGYBYDQHIAICREYIIEQFaIAHABA', 'FJDBYDABBBCBECSCTCQDBQFRAIEIGBBIIQIICSDYGYEYHBBIIICIDSGYEYHYAYFBBIIICIESHYCCEIEABZIQARCIEBAY',
  'FJBDhDEBJBLBYBACUCZGBIEYCYCQHBAIIIDRGIFCDYDABZGQAYCAIQEQEIGIDIDABAFQAYGABIIZEQEICSFQGIDIAQDABA', 'FJDDTDYBCCRCIDLDiDaGCAFAEAHZIQBQDQGQAQFKCBDAEAHAIZBQHKDQEQFZAAGAHABAIJEQEYDYBYDQGZAQFJGAAZHABA', 'FJYBKCDBMBTBACBChDjDBAHAIZDRCIEQBIGIFIACHYIYEYDYCSBIGIECHIIIASFYEYGYBYCCDIHIIIAIFREYGYBYCYDCHIBQ', 'FIEBaDZBBCQCUCSDCEBQEBCYDRGQHYAYFBBIGIDICICAERHYDBBZGYFRAIDIHIEBBYGQCIBAGZCQCIBIGIERHYDYAYFBCIAS',
  'FJCDjDEBJBSCADKDYDTEDYHQDQGZAQFJGAAZEAHIDQAQGQFZEAHABZIQEIAIFIGIDCAYBYHYIYCSEIGIIABJHQAQDQFYGAIAAJ', 'FIADhDIBYBRDTDZGCHBJGIDICREYEAFaHQAKEAFACADABaGQHQAQEKFAAaHAGABKCQDQAQFQEaHAAKCADABaGQAQHQEKFADAAZ', 'FJRBDCKBMBQBBDIDaGhGEQFYCAIIAQGQGIEBAYHYIYDRBICICQFJEAEIACGYCYHYIYDYDBHJIJGRARAIEYABGBHZIZDRCIDICRFRAJ', 'FITBICZBaBADjDDEJEAIEIBACYDYFYAQGQEJHADADICICAFZDQDIFIBRHYGYABDIFICQGQHIBBCYFYGYAYARERHJGBEZAADAFJERAZ',
  'FJKDbDABBBZBECQCiDRGAABYHIFQAIDICIGBEYBYBQIQCQDQDICIGIAYECBYFAIIBAHaIQBKHAHIESGYCYCAHAEIBYFQAIGRCYHBDZBB', 'FIIDLDCBADDDaDQFSGFQHQBQCQEQDKAAGAFZHQBQEQDQAKGAFAHZBQFKCQGQAaDAEAFABAHJGQAQDaEAAKGAHZBQFQAQEQDKCBGAFaAQ', 'FJABTCKBQBcBBCZDgDCGBAEBHKDQAQGQFQIZBAHAHYERBICICAHAEYBRCIHAEAEYGIFQHYCYCRHJIJAAAIDCFYEYEQAQAIDIEAFBGZCQCYBY', 'FJABcBKBTCBDDDLDgDQEBACRGZCADAHKCQIQGQEQFZDAGYCAHYBQDICICBGJGQCQFIIAHZGQIIAREYEAIAGAGYBYHIAQIYCYBBGJHJAJIRCZAB',
  'FIDDiGIBRBgDLEAGaGDAHZFQAQGJCADAHAEABZEIFQHJCRDQGZAAHAFABJCQDYEACIDREYEACADABZFQHQAQGJEAAaHAFABJCQDQAQAIDBCYAQ', 'FJTBQDUBYBZBCCIDDEiGFQGABADAEAIZAQCQHQGKBABIDBEYFYHYCBAIHQIIEQDQBYGYCAAAGQBJFAIIEIDRFYBYGYCYABEAHIEIDIDAIZHQCQBI', 'FKIBgDEBJBbBcBADCDSGYGHQGJAADAIZEAFABKJQIQAQDQGZHAEAEYFYFAIJCQDQHIGIAADYEYEQGQHZCAFAIABABYJJDQAQEQHYIYCRFIGIGAIABABY', 'FKDBRCIBYBbBcBSCBDJDTDAICAHIIICIDCBYGYEYFYJYASHIIICIGBEYJICSIYJYABFICIEIGRIYIAJAJYAYFBCIARJIJQIQIIGBEYAYCYFRIIJIGIECAY',
  'FICEgGMBSBbBcBIDQECAEAFABJHQGQAZDBEBGJHABZFQFYCSEIGIDRAJHBDZGZFABICADQGYFYCYESAIFBGIDABYCQGJFRAYFYGYECCICABJDQFQGZAR', 'GJdCKFACBCUCYCCDEEhEEQHQGJBAIIDSBYGYHYACEIIIDIFICSBYDCIYDQEYASHIDIBICCFYIYDRHYACEIDIIIFICSBYGYHYAYECDIASGIHIBICCFYBQIYAY', 'GLQGjGLBYCZCaCbDMEAGDGIGBQGICRGQHQKKAAEAFABZGQHQKQAKIQJaAAKAHAGABJEQFQIQKaAQJKKAIADAEAFABaGQHQAQIKDAEAFABAGbCQHQAQIQJQKKFAAY', 'GIkBBCACaCbCCFMFYFAIGAEIDIHICSBYFYGYADEIDIHICIBSFYGYAYECDIATGIFIBCCYHYAYDYESGIADHICIBSFYAYGYECDIHIATFIBCCYAYHYDYESGIFIAD',
  'FJACSCEBJBYBZBTDbDBGBAHQGQCQIIDAFAHZGQBIFIFAHADQGZBQIYCABIFIDIGIHIEIEBGZAQHYIYFABYCSFIBBFQHIHQBQDQIJEADYBYFYCBHIHAGKAQEYDBAI', 'FKDDaDABKBUBBDLDQDjDYEIYEQGQAQFJDADYAYFYGYECBIGIHIIIJICSDYAYHYGYEQFIAAGAHJDQDICCJYBYIYERGIHIDIJAIZBQDQAQFZGAAJDABAIJJQCQFYDAHZAQ', 'FIIBLBMBDDaDJEYEAGEIEQBQCQDQGIARFYDYCBBIDQCYBBDIDQBQCQHJFAAAGAEaDQDYBRCIGIGADADYBYCREIAQFQGIHZGABACAEJDQBYBADADIAIEYCQGQHJFAAA', 'FKDDbDKBaBBDIDQDYDgDLEBQJQAQEJCADAFAGAHAIABaDQJQHKCQGQFQEaAACADAHAJABKDQCQIQGQFQEQAaCADAHAJABAIKDQCQGQFQEQAQHaCADAJABAIAGKDQFQEQBa',
  'FJABKCLBbBcBBDDDQDYEBQCIFQGZDCBIHIIIASFYGYDYBBEYCRBIDIDQFIABIYEYCYBRGKAAFAHYDYGQFJDADYECHJIIASDYEYFYGYBBCIIIAIDSEYFYGYHZBYCCIIAIAA', 'FIYGCHBBbBcBRDTDgDCYBYFYGYECDIDAHKAQFQCQGYDYFICQBYDBHBAJCQAYGYHYESDIBIHIGICCAYEYGYHYDSHIGICRBYHBGJGADAEAAJCQBQHaGAGYDBEIBICBFYFQBQ', 'FJADZDCBDBQCIDhDbESGDICIAIFIEBBYGYHYIYDSCICQAJFAIAHAGJBQEQFYAYCADAGIBIEQHYDYCRAIIYAQFKIAAaCADAAIGABJHQAQIQFaCADAAJHABZGQAQCQDQFKIAHAAZ', 'FIADRGIBYBZDbDiDCHBICIDBEYEQFaBQHQAKCADAFAEAGZBQEKFQCQDQAaHAEAFKGAGIDRCYGADICRGYGAEaHQAKGAEACADABZFQHQAQGKEAAaHAFABJCQDQAQEQGaHAFAAIBA',
  'FJBBMBcBQDYDaDgDKECGAYFQEJDQAQHYBYIZBACCEIDIEAFIGIARHYEYCRBIDIEADAGAFZCQCYBSDIEIEADACAFIHIABGYGQAQHQDaCACIHIHAFAFYBYCRHIDIAAFYBYBAGJFQBY', 'GLEDaHKBLBACdCYDgDMEBGoGCYDYIYKJHQGQEQJYAYFCBIGIGAHAHIKZBQEQGKCQDQGYJQAaIAGABAKKHQCQDQGZIQAKJAGACADAGYHAKaBQIQAQJJGAAaIAAIBAKKHQCQDQAQGQJZIAAJ', 'GLBBbEDBACUDoDqDsDEERGYHBIKIDRAYCZIZEBBBHBGJGAFLDQAQKQJQCQIQEbBAHAIAHZBRIJHBCJAJERHZAACAEADAJAKAFbGQGZBRIRCJAJEJDAEAJAKAFAGZBZIRARCREJEQHLJAKABA', 'FJBCTCCBSBcBQCDDLDhDAQFBIYDQCQFQGaHAHYECBICIDBIJAQCQDQFQGQHZEZBBIIBQDQEQHKEADAGAAAFAIaBQDQEQHQGKEADAIJAQFQEZABHYBAIIDQDYIYBQHIAIEIDAFBIZCQCYBY',
  'FKCDiDJBSBcBECICADKDgDCQDIIYDABAJJCQGQIQHQHIGBAYCYBYDAJYEYFRDIECBIIIJICICAGRAYHYEYDYFBBIJYBQIQDQEQAJHACAGAIYBAJJIQBZDQIYJYFRAIAQHKCAEABAGAIAJZDQBI', 'GKCDhDNCYCZDTEAFKGjGpGAJJJBQIZCQHIGIDCBYEYIIEQDQGQAbHAFAHYCBIIIAELBAJaEQIQFQIYCREYHIHQALDAGABAIZEAJKIQBQGQAaDQHAFAEABKCAGQAQHaFAEABAJAIKDRGQEaBABY', 'FKABhDEBJBKBbBQCTDZDBGFIBIIIDREYHYCQHAIAJIEADABYFYCRIIDIERAIGBBYDQIYCBFIDIBIGRAYEBIYDAIQEQJYCAFABJIQDYEQFYHYFABACQIJDQEQHQJIAIGBEYDYBYIYCRFIHIAQHABA', 'FKBBZBABYBMCDDKDaDjDQGFYEAHIBIDIJICSAYAQFZGAJABADAIZHQBIDIEQGIFIAACACIIYARHYEQJYGQFJJAAACADAIAIIARCYDYGYHYBQGQFQFYEBBIHIIIAICRDYABHYIYBYERFIFAGABAGIAI',
  'FJLDiGIBUBYBCCRCADaDAADAGAIIFQHICAEABZIQFIGIEICRHYHQAaFAGAIAIYDRFIGIAIHICBEYHQIYGRAICIEBGAHYIYGYDYDBBJIQHQCQEQAZDAGABAIKHQBZIYFRDIGIGQAJCAEABAHAIZGQAQ', 'FJADhDEBRBbBQCCDIGSGEIBIDQHIIYCQGIAIFBDYIQHQAQGZCACYECHIIIDIDABZIQHQCQEQGJAADAHZCQEQGQGYEBAICIDAHIHABABJFRIYCQHIDRAZAQGAAJDBFBBZHYCAIIBQHQAQAYHYCYCAHJBA', 'FKLBQCABBBKBMBCDZDbDhGDQFAGYAAIAHJJIDREYHYIYFRAIGIEAIAHAHYFYARGIIIEICIBBDYHQCQEQGZIAFAHIJYAQCQFIEIGQIZEAFAAAHAJICQHYAYFREIABHICAHQAQJYFQEQIJGAAYEYFBJICQAY', 'FKBDjDABLBMBYBZBDDQGaGAQHZDAEAIJFAGABaJQIQDQEQHJAAGAGIFIFAIZCQAYDQHYEADIGIGQHQAJCAFAIABABIJZDQEQAIGQIICRFYHYHAIABAGAJICQFQHYAYEADAJICIFRBYGYDYERAIIYAQHKIAAa',
  'GLABcDYCEDBEhELGQGTGZGjGKQBQJJFAKZBQJQIQHKEQDaAQGAHAIAJABAKJFQEQDQGaHADKEAFAKZBQJQIQDQHQGKEADaAAIAJABAKJFQDQIaJADKFAKZBQDQJQIKFADaBAKJDQFQIaJABAKADKFQBaJQIKAQBA', 'FKLBYBABBBKBQDZDbDCGiGAIEIFIBAJZHQGJFQDQDICIBBFYFAJAHaGQGYAREIDIFIJIBRCYFAIYEAAAGIHIBQCQIYDAJAHAGZAQAYESDIDQFIIJCACIBCGYHYAYBQEYDRFIJICQIZFAJAAADAEAGKHQHIBRCYAY', 'FJBDSGaBbBACJDYDgDDEBYDICIGIHIERAYFYIYDCCICAHJGQBQIQAJFAEAGYHYCQDQAIFIEABYIYDYCBHIHAGKBQHaCQDQAQFJHIIAHABAGaCQDQHJIQFZAAHACADAGKBQIQHZAQFJHAIABAGaCQDQAQFQHJIAAZ', 'FJQBLCEBBDRDZDgDIGiGCRDJHAAAEAFAGAGIIZAQBQEJHQDaEAEYCBBIFIHIAAGYFQHQEQEYCYBBFIGIIJAREYHYCQDJEAHAAAIZFQCQHIAAGYCYFAIJGQCYFYBQDIEIAACYHQEQEIAICBDYBAFIHYHQEQEZDRAJ',
  'GJEBhBIBJBFCaCYDCFbIBYCADAGAFYIYESAIHIGICRDYGBFBBICRDRGYDAHYAYECIIBIFRDICCFYBYIYESAIHIDIBCGIIYEYATHIDIBICIFCIYDSHYADEIDIIIFSCYBYGYHYAYECDIATHIBICIGIFCIYAYDYESHIAD', 'GLRCEEABLBiBKCQCbCoDUFBGJQBQKJABFAEAEYFSAICIGBEYCSAYFCCIEIIIGSAYFYDYHBIIEQFQKZBAJAIJCQCIEIFRDYHYCCEIEAIZHQJQBQKJDADIAIGCFYASDYDQKZBAHAJAIJEQEYCSHIECAIFIGSDYEYABCYHRKYBY', 'FJADaGCBDBEBRCIDiDSGFYBYHIIYERDICIAIGIFBBYBQFQAYIQGQCYDYEBGJCQAICYFAGYERDIGAIYEYDRGIGADAEAIJCQAQFQGaDAEAIAHABJCQFQHYIYDREIAIAAIAHAHYDYERAIIYAQGKIAHACABYDYEQAQHJCADABA', 'GKNBgBhBBCaCdCYDrDbECIAADYJYAYFCHIIIEICIBIGIDSJYECIYFRAIEIJIDCBYCYGYHZIYESAYFBEIHIIICIBIGIDSJYAYFYECHIIIATJIDCBYCYAYHYIYESFIJIDIBDCYCBAZGRDRBICBABGYHYIYEYFSJIBICIABDYCSAI',
  'GKQBFCSCADsDLECGIGoGbHCYEYJYBSFIGIDIHIABCYHQDQDIGZFABAEIHIIICQAQAICCIYEYJZEBIKEQJQHQHZEBHJAQCQDYGYFYBBHIHQBQEQFQGKDAAADYEZFQGYBAGQDKAACAEAJAIaHQFQEJAQFIJICRDaGAAIDQGZEBAJ', 'FJACUCDBEBaBJDYDgDRGEIFAGIAQFYCYDYBBEIGIGQIQCQCYDQDYBYECFIAAGIIYGAHKIQGaHAHYESBIDIDAHAEYBRDIGIHAEAIIARFYHACIFQHZCACIFIHIABGYEYIYBYDSCICQHJBAFAEAEYBYCYIICQHQFJBAEAGIAREYBY', 'GLaBMCACLCYCZCRDBEDGjGrGAQBIDIGIGQHQHIIZDAFBAYGIJYKYBRDIHIFIACEICSAYEBIYHAGAJYKYBYDSGIHIFIEIAICBJYKYFRGYHYDCBIFIJIKICRAYEYGYGQHQHYFCIIJIKIERAICCEYJYKYBYDSFIHIAIIICIECGZAQJYKYBY', 'FKIBECTBaBcBADCDRDgDJGAQJYCADIHQIIAQJQFQGZCACYDCHIJIAAIYHQJQCQDQGJFAAACYJYDQGQFJAACAJAIAHZDQHIIIJIASCYFYGYJYDCHIIIAIJICSGYJYDQFIGAJAAACAHZIQAIDQJICAHAIZAQDQJQFQFYGJCAGYJYDCAIAA',
  'GLhBLFVBiBYCQDZDAECGjGrGFIIIHIECAYDYGYJYKYCRBIFIFQHQHIIZBAFJGJEQEIADDYDBJZKZCZFRBRIJBAEAFAGYCAKKJQGQEQGYCYIZBAFAKAJKCQFZBQGQEQIJAIDBEYASIZABBAFJCACYFZBQGIIJAACAGAJaKQGKFQHQAICBHYBY', 'GLkDDHVBhBIDYDsDTEiEAGQGDYEIIYAYGYCRHIFJKIDCIYAYIAGaAQFQFIIIDRKYHYCBFIFQHQKJDBIYHYFAAJHQKQEQEJDJIBGBHZAZFQKQGKHAAZFZCREIGYEQBQJKIAHAAAFZKQAKHQAYIQJaBAEAGJAAKAFKHQAZGZEQBQJKDAIAAAAI', 'FKDDaGABLBMBYBZBBDiDQGHQAZDAEAJJFAGAIZBQJQDQEQAJHAGAGIFIFAJZCQDQHYAYEADIGIGQAQHJCAFAJAIABZDQEQGQHIIIJICRFYAYAAJAGABICQFQAYHYEADABIIACIFRIYGYDYERJIAQHZJAAKIAIIFBCYBYEQGYDYAQIJDAGABA', 'GJQDrGFCLDpDcESGAHZHDAEYBYIYFYCSGIGAALHQAYDaGAAACBBIFABAELIQHQDQGaAADKHAIAEbBQFQDQAQGKHADaFABAELIQDQHQGaAAFADKIAEbBQDQFQAQGKHAIADaBAELDQIQHQGaAACAFABAEADLIQBaCQFQAQGKHABAIADbEQFQAQ',
  'GKCEkEVBgBhBTDYDEEaFQGAZHZCBFIFQHIAIJKGAGIDDEYGYIYBYFYJYCTHIAIDIJIGIEDGYIYFYJYCBBIFRJQGKIAFZBZCRBIFIGIJIIIETDYDRAZHZGBJABAFJIQJZGRHJAJDBDIEDIYBYGQJJIAFaBQGZJYCBBJFJGQIQJZCZBBFJGJCRBY', 'GKFCYFJBTBSCcEDDAGKGqGCYDQJIEQIQGQGZHJCAIZDBDIFYARHIGAIICQGYHYABFIIAEAEIBICSIYIQGQHZDAEBFYARDIGIEIHIIICDBYFYERJYAQDQHJGAIABAIIJZEQIQGQHZDADYACEIJJBQCQHYIYDSAYECDIFIJIBICSIYAYEYDCFIAR', 'GKKGiHlBQCSDoDAEUECGZGAIEYIIGIDBJYHYCBBIJQDQEQGQIaAACAHABAFLJQDQEQGQIQAaCAHABAFAJKEQFaBQCQHQAKIAGAFAEAJaBQFKGQFYIQAaHAFABAJKEQGQFZHQAKIAFAGAEAJaBQCQHQAQIKFAAaCAHABAJKDQEQGQAQFQIaHAAJ', 'GKNBYDKCEDbDIELEBGgGjHHYIQBQCQFQHQDbAAGAEAJAIKBQCQFQEaCAGQDKHAEAFABAIaJQGQEKHQDaEAGAJAIKBQCQFQHQDQEaGAEIHKCBFABAIaJQHQGQEJCADAFAHaJAIKBQHQCQFQDQEaGAJAHKBAIaHQJQAQGQELCADAFABAIAHaJQBL',
  'GKSBDGJCdCgELHbDqDAGiGAACYAYFYDBHJJIEIEAHbJQGQGIEIHAAQJaGQEIGYDRFIAIHICQIQBaFADAEAGAJKHQGZEQHYJYDQFQBKIAAACAGAHAHIJZCQEQGJAQIQBaFADAGAEAJKCQHQAQGaAAHAJZDQFQBKIAGAAYCAFYJYEQFQBQIKGABa', 'GLEDsDDBRCSCYCMDIGTGpGbHHADAEAFBJYJABbKQIQCQGQAQHKDAEAFAIaKABLJQIQDQEQFQHaAACAGAKABAJKIQBbKQBICQGQAQHKDAEABAIAJaKQBKDQEQHaAAGABAKAJKIQDQEQFQHQAbGAGZBBCJHJAQGZBZCAKAJAIKDQFQAQGQBZHAGKAA', 'GLJHgDFBECICVCjEADZDbDoGBIFQCQHJEAIYJYDQHJAAJAIJERAYHYIYJYDYCYFCGIGAKKBQEQIQJQAQHaCADAGYFRCIDIAIHJECBYIYJYGYDRKYFQCQHJAADAGAIKBAKZIQBKJQGYJIERAYDYCYHYFCBIBAIAKKEQJQGQAQHaCADABYFRCIDIAI', 'GLRBjHQBNCSCTDbDgDDEIGoGDAGIJAAAEAHICQAYEYFYFQIQJJAAEAFYGYDQJIEIAICCFYFAGaEQHYJYDABAKKERFIHQGQCRAYFACIAREAFYFAAACAGAHAKaBQDQJIEBGKCQERFIFQJaDAIAGABAKKHQCQCYEYBYGYKYDSIIFIIQJKAAAICCEYAS',
  'GLZBMCaBCCLCYCdCADIEDGpGBREQJQBAGAKJCQDQHLIAAACYDRIIDAFCCYCAKaAQBQEQGQJQIIFICCAYFRIYHYJAEAKIAQCRIYJYGCBIEIDIFIKIAICRIRJZHQJAIAAACAHYEBKZBYDQGSEIBCDIFIAIKICQIQHZFBAIHIIICCIQIYAYAAKYFSBY', 'FKBDgGABMBSBcBTCDDKDQDIYGAJQCQAYHYDAFABJJQCQEYIYGYFYDRHIHQAKIACAEAJABZDQFQHQAQIKEAGAJICQEYGYAYHYIYDCFIFABJCQJICIESGYAYHYIYDYDQIJAAFAHACAJICIEIEABZJQDQFQHJAQIZHAAJCAEABAJaDQFQAQHQIJCAAY', 'GKYBbHLDZDrDDGQGTGoGAHDQEIIIAQGQHaBAEAIJDQEaBQHKGAAAEADAIaBQHQGKJQFaCAGAHABAIKAQDQEQJQGaCQFKGAJAAAEADAIaBQHQCQFQGKJAAACZHABAIKARDQEQCQJQGaFAHABAEKCQJQHaBAEAIADKCQIZEQBQHKJAAACYDZEQIJAJ', 'GLABsDSBVCTDEEQEbEJGgGpGIACAKYBYDQEICIGIGAJAAQIYCAEYKABaHQEQCQFQIKAAGAJAEaHABKKQEQJQAQGQIaCAFAHABAKJEQBaHQCQFQIKAAGAJABAEAEIKZHQBKJQAQGQIaCAFABABIJJARCQGYCYBYFYDCHIDQKIAQJZBQFQIKCAGAJABa',
  'GLADqDMBYCZCiDIEKEkECGbGCIHIGIJIAIDCEYBYFYIYKZCSHIKJGQAQJZHAKAIABJFQGQKZHQJJAAKAGAFABZIQHQHYKJCBGAIIBIFIEIDSAYGYJYKYCBHIFBBBIZHRCRFIJIAIKIGIDCEYBYFQIYHYCRKQJQAKGABAFZKQBKGQAaJABAKAFKGQBa', 'GLCBbCBBACYCcCMDUDZFDGRGFIBIIIEIDSCYAYCQGZHAFAKIAQJaHAHYFBBIGIIIEIASCICQJQHaGAJJCADBAYEYIYBYFSGIHJJIKICIECAIDREYCYHYGYJYKYFCBIIIAIDIESCYHYGYJYKYFYBCIIAIDIEICSJYKYACIYBSFIAIJIKICCEYDYIYAS', 'GLEBYEiBjBCDKDUDsDSEcEAFAIBQKQEZFAIACADAHZJQGQAQFJEJIICBDYGYKABAHZDQCQJYASIIEQFZIAABGAJIDIDAHJBQCQGYKQFZEAGADADIGQEQFJKABAHZJYARDIJAHKBQHYKQFZEAGAJAAYDRJIGQEQFJKABAHZAYAAHKBQKQFZEAGACABI', 'GLEBZBABBBCBDBFCTDaFcFQGBYIYJYGSAIFIEIDICIHIKIBCIYJYGYKYHYATFIFREJHBGBAYFRERHIDIDQHZEBFBAIGREYEQHJDADYEYGBAYFRGIEIDIDQHZEAABFYGREIEQHJAADADYAYAAFCJIIIKIBTCYCRDZAZHZFAKIAQEAHYFYEYGCJIIIAS',
  'GLEDSDQCRCdCCEMEaEIDrDoGHIIACADAKAJaHQBQFQIJDABYHAJKKQBQBYDQHYIZFAHAJAKJBQJaHQFQHIIJDAJIJABABICRDYFYGYEBIYKIBQJQFQIQAaEAGAHAJKBAKZJQHQGQAJHIIAFABAKAJaHQBKFQBYIQAZGABAHAJKKQFQHYERGIAIIQAQ', 'GLEDqDdBSCYFMEbEADCDsDJGEABZJZKYFYCBGIGQCQFQKKDAEABABJERHRIZIQAbKACAFAGAJJBQDQGYCRFIIJAQKaFACAGAJAJYCRBIDQGIIQAJHAIZDABYGYCBJIJQCQGQFQKKHAIAEABZDQAQIJHQKaFAAJDAAYBJEQHQIZDAFYCCGIBAJZGQAQ', 'GLFCYEaBDDLDjDpDAGbGrGIHEQDQGYCQIYARHKAAKAEaIACAFAJAGLBQCQEQIZFAEKIQKQHaAADAFAEAIKBACAGbJQIQAQEQFQDQHKKABACAGAJaIQGLBQCQKQHaAADAEICIFACAGZEQAQCIGAEZCQFQDQHKKAFaCAEJGABJFRGZGQKQHaDACACYAY', 'GLQBVCABFBUBLDZDBEgERGiHBQDQFAEAFIGJHICIABJYJQAQCQHQFbDAEAHAGAGIHQFJAAFYJJCQCYHYEYEQFJHACIARHYEYGYEAGAJAJIERHIABCYEYJYDQFIJQGQHIAICBEYARHYFYDAGAJAJIAIEICRHYABJYDQFIJQGQAIHICBEYGZAQAIJYAQ',
  'GLRCUEFBSBLCQCkDsDAEiECGAQDAFQIQKZEAJAHZGQBQEIDIIIKIFCAYHYJYBYCSEIDIGYIIKIFIACJYBYCYESDICBBIJIASFYIYCYDYECBICRIIFIACJYCYBYESDIIICBJIASFYCYIYDYECBIGIHIJIAIFSCYACHYGYJYBYESDIIIKIAICIFCJYAR', 'GLoDKEQBBCVCCDZDbDgDEEiHCBEQGYHYJQFJBAHAGKIAIICSDYBYHYJYEBKIIQHQBQFaJAGAHJIAKYERGIJIBIFIDICCIYCQHYIQDQFZBAHAKAAKIQIICSDYHYGYEAAIIICICADRHYHAGaKAIAAaEQIIIQKQGLBQCAFJHADBAYAAIaKQBQFQHJCBBY', 'GMADiGlBECFCICLCCDcDgDJEoGKQLJJQBZGQHQHYGBIYCAIQDQGQAKFAHAKABAJALZIQJKBQKQHQAZDAGAJAIALKBQIaJQDQGQAJHAIIKAIABALaJQDQGQAQHJKAIABALAJaDQGQIJKQHZAAIADAGAJLLQBQKQIZAQHJIAKABALAJbDQGQAQHQIJKAAZ', 'GMBBUBgBkBFCdCYDaECGKGRGpGAYIYJYBBKIDAGAHYDYFYESBIIIJIAIKIGICDGYHYDYKYLYFYEYBTIIJIKIDCGIHICSAYDYGYIYJYKYBDEIFIHICIKIGIASDYGYIYJYBYKYECFIHILJAQCQGQGIABCYGQAICBGYGQAQAICICQDSIYJYBYKZEYFCHIBS',
  'GMJDYGABgBFCTCLDpDcEBGQGrGHALZIQEQJJAAGZFAFIBIGIKICRAYAQJaEAFAIALJHQBQKQGQAJCACIDCBYHYKYIYLYESFIAIGIJJCADAKABAHALZIQGQKJCQDQJZAAKAGAIALJHQBQCQDQKZGAIABJCQDQKQGaAQJJGAKACADABZIQAQAYKJCADABA', 'GMLDhGBBACCCYCZDkDDGTGbGrGAICQLZHQBJGQEQIZAAJAKABAHAGILJFIDSCYCADAFBGYGQHaBQKQJQAQIJEAFAHAGALaBQGKHQKZGAHKKQEQFQIZAAJAGAHAKJEQFQJZGAHAKABALKEQFQJQGaAQIJGAJAHaAQJJHAEAFALaBQKQAQJQHKEAFAKZAQ', 'GNABiBFBJBQBcCdCgESDUDBGKGZGBIHIERARKIDADYIYJYKYLYCYGCFIBIHIEIARIYMIIQJaMAIKJQJIDRKYLYCYMYGYFCBIFQHIEIAIDRJYIYGQMYCQKKLAMAJAIZEBHYGRCIEIIIEAJIDBAYHYGYBYFRCIBCGIESBYBQGBEIHIAIDRIYJYBYGYECHIAI', 'GNIBjEFBJBYBZBiBMCVCADKDSECGEQFQDQIQCQKYMIJIAADYLYHYCYIBBIGIFIEIDRLYFBGYBYIRCIHIFIFAGBBYHRFIGIGALIDBEYBYHYFSGIHBFYIYCSGIIBFIBIEIDRARJYKYMYGACBFIBIEIDIARLYECBYFYCRGRMIEALIABDYBYFYCYGRIIHILIAI',
  'GNQBlBMBRBNCcCSDaDAGDGJGgGoGKYLIMIARDYGYCYFBLIMIAIDRGYHZCQCYFYEYBCLIMICRGIHIDBAYCYLYMYBSEIFIGIHICBAIDRCYGYHYFYEYBCLIMIAIDICRGYHYABLYMYBSEIFIAIAAHJGQKQIQJaAAFAHIGIKICBDYLYMYBYERFIAIIICAGYHYAR', 'GJYBFCbBkBdCQDAEZECIAQHQFQFIABCQHYCYDYEYBSFIIIGIABHBCZDZFRHICBDYHQHICIDBFZHQCIDIASGYAACBHAFJDRDYHYHADIARHYCSCIHIABDYHQIYBCEIFIHQAIDBHYCYFYEYBSIICCAIAQAIDJGRCZDBDYIYBCEIAIFBHJGRCRDYIYAC', 'GKBBDBCCMDaDiDQFUFoGrGAYBQDAHAFJEQCQDaBAHAFAEJCQCIGIGAIAJaCQBQEQFQHQDKBACAGAIAJAEbFQFZHRDRBJCBIIJIASGYCYBZBQDBHBFJFAELJQFaEAJJFQIQCQDZHAEAIJFAJaIQEQHQDJCAFAEaBRCIGIACEYFYBYIAJKBQEQFJASAI', 'GKBHrGRBYBACVCEEhDaGoGHJCQIACIDIDAERAYGYFBHABAJKCQCYBYJYFSGIAIEBIIDICBBZJZHRBJCQCYDYBAIYFAHIJICQJAJICIESAYEAGYFBBIJICICAHbCQJQBQIQIICBHIHAJaBQIQGRAJDBEBHYHAIaBAJKIQHQCYHIERDYCBGZBAHKGQAQ',
  'GKFCJEUBTCdCYFDDLDAGqGBYCQDYCYHQGQGYIJBAFAJZEYASHIHAAAEAJKDQFQBQGQHZABIZEBCJERHIHAGADAEYJYCQAQAYAQHIHQIKBAFAIYJZAQEQHQHYCDAIEIHIDIDQHZCQCYACEIDIHRGRCZDBCIJJDQFQBQIZCACIBJFBHZGQBQCYJZDQAY', 'GKIDZDEBDCYChDpDAGQGbIAICIDIHIIIECBYFYGYJYCTDIDQHJAAIAJAGKFQBQEQAYHYDACAGIFJBQEQJYCYDRIJAQHZIAALEAJAFAFZGZGABLFQEQGQJQAbIQHKAAHYIaCBDBBBGJGAFLIIJQIQAQAJEBAYJYBYFYGYDSCIHIAAIABABZCYCQIJAQ', 'GKIGTGQBRDZDsDgGpGDHbHAACADAEAGAHYHAFbJQBQIQAKCADAEAGABaJAFLHQBQGQCQEQDQAaIAJAFAHKBQFbJQIQAKCADAEAGAFABAHaJQFLGQCQEQDQAaIAFAJAHKBQGQEQFaJAGKBAHaGQJQFKEABAHAGaJQFQIQAKCADAEABAFbIQAQDKEAAZ', 'GKQGiGFCdCJDpDrDYEDFaGEAAAFYHAFAGaBQJQIQEJAAHAFAJZIQEQAJHAFAJAGABZIQFKHQAZEAFAIABJGQJQHQFaEQAJFAEaIAIYJJHQEQFQAZCYCQAKDBBIFAEAHAJZBAGLJQGYHQBYDREQFQAaCACIAJFAEAHABZIIIQAQFKEAHABAJAGaIQAQ',
  'GLADaGYCZCLEkEiDqDCGIGQGEIIIAIJIKICCDYBYFAHJGQBQKQJQAQIZEAFAHAGJBQHaFQEQIJAAJAKAHABAGaFQHKKQJQAQIZEAHAFAGKBQKQJQHaEQIJAAHAJAKABAGaFQEQHKAQIZHAEAFAGKBQKQJQAQIQHaEAAKJAKABAGaFQAQEQHKIAJAKAAa', 'GLADpGgBICRCUCaDiDsDEECFEAFIGIHYGQKQAJDACABYEAIYFQJQAJKAGAHAIABJCQCIDSEYIYKYAYJYFCGIGQHKCABYGQIJCJKRAZJACAKAIaGABJIQGaHQHYFRJICBHBGJGAIAIJKRHZGAHAGZCRJYFBIICQJQAJHAGAKABZIQCJJRARGJHJKBJZAR', 'GLEBRBBBKBFCICaCCDgETFrGERAIFAHIDAGAKYEQAQHIDICIBBIAKZJQDQDICICQGBHYIIFRBYGYCYDYAYECJIDSCIDAGIBIFBIYDYJYESAICIHIGIDCIIFRBYDYGYCYAYHYECJIIIDSBIFBDYIYJYESAICIHIGIBIFIDCIYBSGYCYAYHYECJICSAYAQ', 'GLEDiGlBCDQDpDrDAEKEYEMFIQDQAZKACAGIFIJQEQHQAZDAIAEKJAFZGZCQEIIQDQAJHAJAFAGZBQFKJQFYHQAZDAIAFABAGKJQFZIQDQAJHAFAJAGaBQIQFJHQAZDAFAIABAGKJQHQAQDZFAAJHAJAGaBQIQAQFQDJHAAZIABAGKJQAQHQDZFAIAAJ',
  'GLFCIEZBECADCDKDoDSEcEiECYJQAQDQFJGAIAKAHJCQBQEQGZFZAADAJAHJKQKYHYJYASDIFIGIIIBIEICDBYKYHYJYAYDSIIEIEQGQFZIAIYDCAIEIHIJIBIKICTBYEYFYGYIYDYACJIEQIQFJGABACAEYJYASDIIIBICBEYKYHYJYAYDSIIBIIAAA', 'GLIDoDYBkBlBDDqDRFAGKGTHFIIIJIAICCHYGABJHQAQAYJZKYECDIDABJGQKQAKCQIYFYEAAIJQFQFZIJCAJYAYAAJKFQAZFYJYEQIIAAJAKAGABZDQDYESJIAQKIFICQIaJAAKFAAYKYECDIDABJGQKQAQAZFJAAKAGABZDQDYESKIAQFZKAGAGJBB', 'GLNBACBBCBRBSBYBdCDETEhHAAGQKIERCRDYIYAYHCKIFRJYARIIDICBEBFYKYHSIIDICIEBJYDRIYHCKIFIGIBSEYCYIYABDIJICREIBCGYCRERIYAYDBJIEICBGIBSIYEBJYDRAIEIIIBCGYCRJYERAYDBEIJICBGIBSIYAYDYEBJIARIIBCGYCRAY', 'GLSBACdBBCUCbCMDYDsDCEgHFAGAEAIYCQEIFIAIAQHIJQGZEACAFBAIIIKIBSDYGYJYFYACCYAQERFQGKFAJAHAKAIaEQAICBIJKIBIDSHYJYFYCYAYGYECKIFSHIJIDCBYFYKYESAICIGIHIJIFCBIDSFYHYJYCYAYGYECKIBIDIFSHYJYCYAYCABA',
  'GLYCKGFBUBVBZBIEaEkEAGpGHAJJGAAAKYIYERCRBIJIGIABFYHYDYCYEBHQGQIIKIDQFQAQJaBACAEAGIIAKJHQAIFCHYDYIYERCIGIDBHIFSAYDYGYCYEBHAIIHIFIARDYGYFAKZIQCQEQBQJKDAAAGAFAHAKYIYERCIHIFIAIDSGYBYJYCBHIFIAI', 'GLcDIGQBgBsDhEAGTGZGjGDHHZAAIJFAEaJQIQAQHJFAIZAQHQKQGKBACADAFAHZAAIJEAJaIQAQHJEAAaIAJKAQDQEQHaKQGQBKCAFAHADAEAAAJaIQKQHKCQFQBaGAHAKAIAJKAQDQCQEQFQBQGaHABKCADAFAEAAAJaIQKQBQHQGKCAFAEAAAEYBY', 'GLjGAHUBFChDoDqDsDDERGZGEYAYDRIIJYKYCYCBJJKJEBFBGZGAHbAQKQFKEQJZFAKAAAHLGQGJERAZKZFRCRIYDBFIFAHAGJCRFYFACAHAGAELAQCQHYKQJQFaHACAGAEAAKKQJQFQHaCACYEYGYGAEAAAKKJQCQFQHQGaEAAAKAJKCQAYFQHQGQBQ', 'GMBDTDkBFCdCJDiDqDDEQEgEaGAYBYFYIYDYECCICAHJGQLQBQIQAJFAJAKAGZHZCQBJIQAQFJJAKAGAHZLQGKKQGYJQFZAAIAGALAHKKQGZIQAQFJJAGAKAHaLQIQGJJQFZAAGAIALAHKKQJQFQAZGAIABZDQEQGJAJFAJABZIQAQFJJABAKAHaLQIQAQ',
  'GMJDZDYBACUCEDBGLGRGhGoGrGBIEIIIJICICADRAYGYFYHYEBBJJYBQIQHQAKGQFaAAFIGJCADBIIJYJABbIQBIJKCQDRFYFQAaGAHAJYJAIAIYLAKKBQCQDQFQAQGZLYERHIHAEAAKFACAFIDBBYBAKaLILQIQIIBIDQJQAQAYFJGQHaEAFAGJCAJIBA', 'GJDDrGYBhDLEAGoGIHbHAIDAEIFIHICCGABaIQDKHQFQAaEADAHYIABKGQHQCQDaCAEQAKFADAHAGABaIQEQAQFJDAAaEAIABKGQHQAQDQFZEAAKDQDYAZEQFJCJDBAZCQCIDQFaCAEAALCQHAGABaIQAQEQFKDAHAAbIABKGQAQHQDQFaCAEAIAAL', 'GKBBaEABNBQBRCdCoDqGCIBIDAGAIIHIERCRAYFBHBEJCRCIATFYHYEAJYDYGBBIEICIAIHIFSJYECBYGRDIEIJIFCAYCYHYBYESDYGBEIBICIAIHIFSJYDYGYECBIDSJIFCAYCYHYDYBYDQESGIHIJIFIADCYCBDZHRFRAIBYCBDBEYHYIYGSJIAIAQ', 'GKCBICMBJCNCbEgHSDDGrGBADAGAJaERCIFQHIAQHQCZIYECFIHICSHYHBCBCIFYESHIAIAQHZCACIAIAACAEAFAJKGQBQDQIZAAFAFYASCYEBAICSHIHAFACYAYERHIHQAAIKBADAGAJaCQCIGIJIBSDYFYIZHAAAAYCCGIJJBIDSFYAYCYHQIJFABA',
  'GKKDYDSDcDMEaEkEAFCGpGBQHQIZEADAGAJJBQHQAZCADZEQIKAAHABAJaGQEQCJDAFABJHQDZCZEAGAJKHQDQAQIaEAGABJFQDJAQCZDAFABZGQEQIKCAAAHAJaGQEQDJAJHABZFQAQDZEAGAJKBQHQCQIaEAAJDQCJHABAJaGQAQDJFABJHQCZFAAZ', 'GKYCcFIBECFCJCKEADCDhGGQIQHJCAAAFAJQGQGYJYBYESDIHIIIFICIABCQGYFRHZIYDYECBIFIFQGIARHYIACJHQHIABGYIYCAFAFYBYESDIBACIHIJJGQAQIYHAFAFYBYHQIJAAFAGAJZCTDYDQIJHABACYDRIRHJBACAGIIADAEAJKASFYBYGQBQ', 'GKlBZCCBYCDETHIDQGiGqGEICIGAHABADAFYABIIJZIQAQFQCQEQGLHACYEYABFICRHQGbAAEAFAGIIAJKBQCQFYAREIHIDBBYCYFYIYJYARERGKGQHAGaEBABFIGICCBIDSCYBBCADAIIJZBQIQAQFQEQGQHJCJBBDBFZAZERGJABGAEAIAAQJKFQAY', 'GLABlBNCCDEDJDbDLEjEgGQHDYJQKQFQDQEaCABAHAGAIAJKKQFQGaHQEJDAGIGAFAKAJaBQCQEIDIIQHQGJAIGYAYAQDZGAFAFJAJDRGZGQEbCABAFAHAIAJKKQAQDQGQEQFaHAHYCYBCIIAIAQBQHQFJEAGADAKAJaIQCQFJHAAAIYBSCIAIHQFZCABA',
  'GLDDZDTBICLDRDoDBEUEgGjHAIDABYEICBFIFQCQHQAaEAIAFJBJDQAYBYEZIAFAKAGLJQBQJIDRHYCYCQEQAJHACYFZIQAJEAFACIHQEZAZIAKAGAJJBQGaKQIQAJEJHACYFQEQAZIAFJCIHQAZEACACIGABAHIDBJaDQKQGKCQHQAQEZIZFBGBCJHJBB', 'GLFBQBCBRBUBVCLDAESEjEgHFQAQGAGICIHIBBDYIYEYAYFBJIKIDRBRHYCYEBIIBIDBKYJYFRAIIICRHIDBBYCYIYAYFBJIKIBRCYIYERHIDICBBBKYERIIDRCIBBDYIYEBKIDRBRCYHYEBIIBIDBKYJYFRAIIIBIDICRHYBBIYAYFBJIKICRDYIYERBI', 'GLFBYBIEUEhEBDDDKGZGjGrGBQIYDYARGIFICAHIIABAEAKaJQAQDQIKBAEAKAJaAQDQIQHQFQFJCJBBCYEYFYGYHYIYADDIHIIIEIJIKIBTEYHYIYARFIGICIEBHZIZAZFRGRCJABEIHIIIBDHYIYJYKYATHIIIBREYCZGBFBHJIJBJERCZFZFAHAIAAA', 'GLKBNCABlBBDQDLEbFDGYGgGKQJQAQEQFQCQIaBADAGAHAKKJQFQAYCQEYHYDYBRDAGIHAFKJAKaBQFQDQGQIKEAAAEIJICQAYAACAHYJYDYDBFBJJKJCRCIATEYHYDYDAGYBBJIKICICBAJHRERDZCBCYIYACIIJYKYBRGIAICICRDJEBHBJZKZFRARAI',
  'GLKBhBEBDCYCkDIEUEaEAGrGBACIKZFQHQDIAIGIJIECBYIYHYCSDIAIGIJIEIBCIYHYCYKYFYDSAICBHIIIBSEYGYCYAYDCHICRGIEIBCIYCYHYDSAIGICBIIBSEYCYCAGYAYDCHIIIBIERCYBCIYBQHYDSAIGIBICIEBIYBRGYAYDCHIBIIIERCYGYAY', 'GLQBCCABBCjDrDDGLGgGoGTHBQDQEIFIIIJIARCRGaHAKAEAIJBQDQGQHaKAEAIAFAJJBQDQEaKQHKGAEABADAJZFQIQKQHQGKCBABEABADAIaFAJJIQFbKQFIHQGQEKBADAFAIAJaKQFKBQDQEaGAHAFAKAJKIQAQBQCQDQEQGaHAFAEIDAKAJAIKAQAI', 'GLaCdCABBBFCMCDDgDKEQEjEHQJQCQDQGaFAIAAAKAHKAQIQGJCAGYJQDQDYIYFYEYBCHIKIFSIIDIDAJACQGYIAAAFAHbAQFQIQKQBQEQGLIAAAFAHJJQCQDQIZGZBAEAKAHJAQFQGRIJCBDYGYIYFCAIGQJIDRCRIYFYACHYKYBSEIAIFIGAJAHZKQAQ', 'GMADiDIBhBCCJCNCYCDEkDaGqGGAIQKIEQAKCAEAFADAHAKYLZJQJYGSAIBIIIEIFICIHBDYCSFYEYAYIYGCJIKICIDILIHSFYDCCYERDIFIHCCYFRDYEBKYLYJYGSAIIIEIDIDQFBBZJALJCQKZEQAZIAGALIBQJZEQEIDIDRARIZEBGBDJJJBALZDQKKBA',
  'GMADpDVBlBYCcCCDEDIESELGhGFAKYCADABKLQJQJYFYDYDABACQKIIILJJQIQKaDAFABYCQDIFIKIEBJYBYFQLYCQDQKJIABABYFYDYCBDQLIJIERIYKYCADIFIBIBAJALZDQCQFQBIKIIIEBLYFYDYCRBICADAFALKJQIQJYKZBADALYCQDIFIIIIQKQBa', 'GMcDAGYBDCQDhDMEIGZGjGoGrGEICAGAAAIJFAJaIQAQDQGQBKHACAEAFAJAIaAQDQGQBQHKCAEAFAJAIAKALaAQDQGQJKCQFQEQHaBAJAFKDAEQJZFAGAAALKKQIQCQEQJYDAIICQJQHQBaDAFAGAAAIJEQAaDQGQFQBKHAJAAACAEAIaDQGQFQBQHKJAAA', 'GMhBFCUCYCaCbCJDQDSDsDDEAGAABRGYKIIAEAFAJaBQCQFQKQLKGAHADAJYEQIQIYKYHILYBCCIFIEIAIAQIQHQGQGIDBIYAAIQDQLZKAEAFAJKIQIIDRHYAAGYIAJZEQFQKQLJGAHAHIDBIYJYARHRKZEBFBAJIJDQIQHQKQGQLZEAFAAAAYCYBSFICCAI', 'GNZBBDNBdBQCIDiDDGKGRGaGoGrGBYHYCADAJIAAGYMALKGQAQGYJYLYMYDRCRHIBIIIFIEBAYKYCYMYCQJJDAFQBQLIGIAQEQHaIABKFAJZBQIQHKEAAAFAGYIZBACALYDQCIKIMIAIERFYHYIYBYCBJJDALIGIEQIQFQHZBAFKIAJaCQFQBQHKIABaFAJJAA',
  'GNZBCDEBLBFCUCYCaCdCADrDIGQGAQDRLIMIGBAYHYDYKYFQMIHAKYFYIYESCICQBJJJGAAALIHBAIGSHYJYBYLYMYCYECIIFIDIAIKIGIHSJYBYLYMYCYFCDICRDQFQBIJILIMIHCGYAYCYKYDYDAFRLIMIABCYDYFYIYESBIJILIMIAIHIGCCYCQGQHRJZBZ', 'GKDBcCjBACBCCCYChEEFZGBICIHIJIESFYAYIYBCCIHIJIATFIECAYHYCYJZBSCAIIFIEIDIGCAYHYJYFSIYBCCIFIHIAIJIGSDYEYIYFCHIAIJIESIYFYBYCCHIAIJIEIGIDSIYECAYHYJYCTBIFIEIJIADHYCYJYBSFIEIAIIIDCGYHYCYJYBYFSEIBC', 'GKLEgGNBKCEDYDIEBGbGjHBQDQFQGQHYHQEbAACAIAJABKDQFQGQIaAQEKHAIADAGAFABaJQAQCRIKHQEaIAAACAJABKDQFQGQHQEQIaAACAHKDBGAFABaJQHQAQCQIKDAEAGAHaJABKFQHQDQGQEQIaAACAJABAFLHQBaJQAQCQIKDAEAGABAHAFbJQAQ', 'GKRDcDLCMEgHAGDGIGYGjGJQBQCQDQHKAAIAEAJaBQCQDQHQAKFQGaAAHACADABAJKEQIQFQHaCBDAIKEAJaBQIQCQDQAQGKHAFAEAIaBAJKCQIQEQFQAbGQHKAAFAEAIAJaBQCQDQGQFKAQHaFAGACADABAJKIQEQAQGaCADABAJAIKEQAQGQHQFaCAAJ',
  'GKcDIGQBFCqDDEgEAGiGRHEJIIGICRJYAYDQFQHKBAJAGAEaCAIQAQDQFQHQBKJAGAEAIaAQEJGQJQBaHAFAEAAAIKGQEZFQHQBKJAEAGAIaAQFQEJJQBaHAEAFAAAIKCQGQJQBQHaEABKJACAGAIaAQDQFQBQEQHKJABaDBFAAAIKCQGQBQJQHaEAFAAA', 'GKiBFCQBECRCCDAEcEKFrGCREQGQFZIAAAHYJYBSDIIIGICCEYAYFIHYJYBYDSIIGICIECAYCRGYIYDCBIHICIAIESGYCBHYBYDSIICIGIECAYHYCRIYDCBICIHIAIESFYGYIYCCBYDSCIIIFIGIECAYHYJYBYDYCTIIBCHIAIJIESFYGYBYIYCDDIHIAI', 'GLADkDFBECICCDJDcDgEiERHBQCQGIHQDQFJGAKAJABZHQCRDQFQGJAJEAIABZHZDQFQGQAJKAFaGQGYCBDIHIBIJIIIESKYGAJAHABJIQFQKQAbCAGAJAFJIABZHQFQJQGQAKKAIABAHZFQBJIQKQAaGAJABAFAHJIQBZJQGQAKKABAIAHZFQJQGQAQGIBI', 'GLBBTCFBUBVBYCkDhEQGrGCHAYHAJZGQKYDBBIIIFAJYGYERCRDIBBGBEZCRCYDTBIGIEAKIAIFBHYEYCYDYGYBSIJKIECHIEQFRAYEYIYKYBCDICIGIHIERAIFBEYHYCYDYGYBSIIKIAIFIECHYASIYKYBCDICIGIAIAQHIESFYGYIYKYBYDDCICBAJGRBR',
  'GLKBZCiBDCECFCdCQDAEjEaGBYCYJYKYESDIAIHIIIBCCYJYKYASDYECAIJICIKJBSHYIYDYEYFYGCAIJIKIDSHIIIBCCYDYJYAYKYGSFIEIHIIIBICDDYBSCQHYIYEYFYGCAIJIKIBIDICSHYIYBCJYAYKYGSFIEIBIHIIICDDYJYAYKYESBIIICIDCKYAB', 'GLNCJDaBlBTCcCRDqDDEYFAGAABYDAFAGYCBHJEQEYFYDYHYASIIIQKKBACAEAGAJAHaDQEQCQFQCIECFYCSIYABDICIFIESIYCCDYARCIIIECFYDYAYCSIIDCFIESDYIYCCAIFIEIDSIYCYKYACFICSIIDCEYCYFYASIIDIEBCYDSIYACFIDICIERIQKQBK', 'GLQBpGDBgBECcDiDkERGZGAHEICIGYKIABIYJYFYEQFAJJDABYHYERCIFIIIKIAIDCGYIYFYJZFQIKJAFaHABJGQFQJQIaHAFKGABZFQHQIKJAGABAFaHQGKJQIaGAHAFKBQEAJQIQGaHAFABKJQFaHQFIGKIAFAJABaHQGQIJDRAYKYCYEBGIFIDIHIJIAS', 'GLSDrGhBiBYCQDjDBEMFDGZGGIHYAAFJHQJaIAKJCADABZGQKQIQJKHAFZDADICICAKZIQAJCBFIFQCQHQJaAADBIAKJFQCQCIFAHIEBBYBAGbKQBKFQGIERHYCYCADRFABZIQAQJKCAHAFAFYCRAZIABJCQCYDYDQFJHQJaIABAKAGKCQDQBZIQJKHAFZAQ',
  'GLZDLGICbCcCdCTDJEAGDGgGFAKQAQCQHQBaGADAEAKKAQCQHQBQIQJaGAIKBACAHAAAKaDQEQFQIQGQJKBACAGZIADAEAFAKKAQCRHQGQBQJaIADAEAFAKAAKHQGQBQJQIaDAEAGJHAAaKQGQDQEQGIIKJABAHAAAKZGQAKHQAYBQJQIaDAEAAAGAKJHQAZ', 'GLoDEFCBDBJBSBcCdCADYEiEDRCIEYIIFAFYDYIYCYBYHCGIKIKAAKJQJIESFYDYDAJAAZCQKQBQIKCADAFAJAJYCSDIDQIZBAKAAJCQCYDSJIEBJACADAAaDQEQKQBQIJJACACIEIFSJYJQIaBACBDBKYGYHSBICIDIJIFBEYJQCYDBJIEIEBABKZJRAJAA', 'GLqGDHKBQBaBJCgDoDTEAGjGAIEQCQIICIECGIHIDRFYEYCYCAGAKZIQBQJKCAEAGAKAHAAZHIIQKJGQCQEQJaBAKAIAAJDIFREYGIDCAZGYHYIQKQBQJKCADAGAKZIAAJHQKQGQCQDQJaBAIAKJGQCQCIDIEIFBGAKaAAHKKQAaCRIQBQJKDAEAFAGAAAAI', 'GLsDAGgBICZCKDiDqDcEEFRGFYGAHAAZIQJQBKDACAFAKAEAAZGAHAIZJRGJGAHAIAJAALCQDQEQIQHQKQGaBQFKGABZGYFZJBHJIAAZHRJRFJFQGLBADACAKAEAAZHZIAHAALCQDQEQHQIQKQBQGbFAFZJBABHJIQAZJRFJFQGLBAKAAAAYIAHZJQFQKJAA',
  'GMZBsDCBLBACBCECSCYCbGjGpGDAGIDICIHBJYKYGRDICIHIFIEIICAYJYKYCSDYGBCIDSHIFIEIIIACJYKYDYCYLYBYGSHICCDIFRCYDCFIJIKIASIYEYCYDYFBJIKIERCYDYFYHYGCJIKIEIAIIRCYACEYJYKYGSHIFIDIAIEBJYKYFRDIAIEICIIBJYKYAS', 'GMZDKGbBcBdBBCFCICSGgGoGrGBAHAAYIACACYDADYEYEAGRIICAJJAQFQHQBZIADAEAJAAKKALaAQGQEIDICIKJFQHQBQIaCADAJAKAAALJFQHQJZCQDQIKBAJAFAHALZAQKQCQCYDQDYEYEQJKFAGAHAKZAALKKQFQHQBQIaJADAEAAAGALAKKCRAYFQHQBQ', 'GMiBACBBdBFCbCcCRDTDgEKGYGKAIAGAHICQIYKYGBDYESGIDCFIAIJILIBSCYIYKYDYFCAIJILIBICSHZDQIYDYFYGYECAIJILIDSHIIICCBYDYJYLZGSFIHIIICIKIBCDYJYLYGYAYESFIADGIJIDILIBSCYIYKYAYGCJIDILIBICSHZAQIYAYGYFYECLIAQ', 'GNaEBGABEBFBYBkBRCdCSDUDJGpGFQCRBYGALYDYEYMIHQJYKYICGIAIMIHIFICRJYJQKaDQEQHAMYGQIQBKLAKAJACAFAMZAQDQEQKKLQBaIAGAKADAEAAAMKFQHQJICAFYHYAYERDIJIHAMZEQDQGQIQKQBKLAKaJAAAJIKICAFAMYEYDRAIHIFICRKYKQJaAA',
  'GNdBBEDBEBIBSBFCYDgDsDTEiGoGEAHAIAJYLZJAMKLQJaFQKQHKFAIAJALAMaAQKQHQHIFIIIJIERBYCYFBHYAAHAKAMKLQJQIQHZKAJJLAMaJQJILJMIERHYIYKYLYAYGRDIACKIHIIIEBLYMYJYJAMKLQJaKQHJIAJIJALAMaGQHIKQFRCIBIEBIYJYFYCRAY', 'GKIBFCJBlBYCZDhDDFbFAGCIAIDAEBGQFQFYGYIYDYBSHICICAIAGKFQFIERAYIYCSHYBCDIGICQHQIAJJAAEAFYCYGYDQBQGAJIIACACYGYDYBRFJCQEQAQIQJaHAHIIIAIEBCYASIYHYHQJKBBDIFIGIAICIERIACAIYADFZGQHQHYBYDCGIGAFKHQAQAI', 'GKNCiEDBECBEQEkESDgDaGAAEYCYIQFQHZJICREJHBFBIBBZCRCIEQHJFAIAJaAQDQHJEACBGZARDRHREJCBCYEYHZACDIJJIQHZJADYASEIJICRFJHBIBCZJZJQFQHJEQIAFYEYACDIGIBICRFYEYAYAQHJIJFACBBYGYAREJJAIQHZEAJJCJBBGZAYCRBI', 'GKkEDGbBACREgHMDcDJGTGBZCQGAIJEAHbJQHIIQGQBJEAHAJaIQHKEQBZGAHAIAJKEQHaGQBJHAEAJaIQGQBQHKEAGaIAJKGQEQHaBADQIAJAGKEQHQBaIAHKEAGaJQHQIQBKDAEAHaJAGKHQHYGZJZABCJFJHRGZGQDQJQEQBaIAAAAYCCFIGIDQJJEQBQ',
  'GLACTDBBDBCCRCaDiDEEcFpGASBICYFBGYHYDSEIFICIACGYHYDYKYESFIDCGIHIARCYDYFYECGIHIDSCIABDYGYHYESFICIAIDCGYHYCSFYECCIGIHIDSAYFYEYCCGIHIDIKIASFYDCGYHYCSEIDIFIACGYHYDSEYCCDIGIHIASFYEYCYDCBZJAKJHQGQBQBY', 'GLBDSDFBUBVBlBACJCDEjEgHBQGQAYIYCYEBFBIQAJHABYJIKIGRHYAYIYCYDBFZJBKJBRIRARCZDZEZJBFJERDIEIDRCJABIBBBKZERDIBICQEIKIGIHSIYCYJYFBDIBICQJQAJIAIIHCGYCYCRBZIQAZJQFZDBFIJIBIIICCGIHSAYCYIABABYJYDRFIIIBA', 'GLBDaDYBlBACDCZCEDJEMFiGCQEQAYKQBQBIFQHZJADAKIGICIERIYGBKYDQJQHJAJIACBBZEAKZDZJRHRAJFADAHAJAKKBQCQGQIIEBCYGYDYDAFRIIGBCIESGYIYCABAFBBICRDYBACIDRBYBACACIDIEIGSBYIYDDCYCQDRFRIJBBEBGBCZDRDYFYFQIQAZ', 'GLDDsDMBgBFCaCbCKEQEcEAGIAFYGYBYJYESAICIHIIIDCFYGYBYJYEYCSHIIIDIKIFCGYDSIYDAHYCCEIJIDIGIFSIYDBJYEYCSHIDIIIFCGYJYDRHYCCEIDIJIGIFSIYHYDBEYCSDIDQAQKJIAFAGABZJQHQAZEBKYDBCBJJBJFQGQHQAQAZHBBBJZERHIAI',
  'GLFCRCLBkBMCQCaFADoDCGIGDIAQERCIGAIJBQJIHIKIFBBYGYIYEYDYDAEAIKEQGQKQHQJZAADICRHJJIKIFIBCGYEYCYDYIYASJIKIECGIBSFYEYJYKYACDICIIIGIBIFSEYBCGYCYDYIYASJIKIBIEIFCGYBSHYJYKYACDICIIIBIGIFSEYJYKYAYDCCIAR', 'GLJDqGgBhBlBDCSCBDQEEFbGAYHYGBKYKQFQGQJQHLAAAJIBCBDBBZKZEZJRHRAJFAEAHAJABKKQDQGQIICBDYGYEYFRIIGBDICSGYIYFBEIDICIGRIYFYECDIFRIIGBCYFYDYESIIFBDYEYIQAZHAJABAKKCQDQFQGQAZIAEADIEIDBCJFRGRARIZDBEBAJAQ', 'GLMBaCbBhBFCDDKEQEcEAGrGDYHABYCYIYKYESAIFIGIHIDCBYCYIYJIKYEYASGIHIDIBCCYDRHYGYACEIIIDICIBSHYDBIYEYASGIDIHIBCCYCQIYDRGYACEIDIIIKICIBSHYGYAYJYFYECDIARGIHIBBCYIYAYDYESGIABIICIBRHYAYGYECDIIIKICIAQBI', 'GLMFgGABQBRBlBDDSDBEjEoGGIHQIIEBHYIQGZAAFAJAKKBQDQCQHQERGZIAEICIDBHYEQIQGJCADAHBEZJZFZARGJAAIAFAHIKABKEQDRCYIYJQHQIQGaAAGIFAHKIQCIDBIYHZAQGJCICQGaAAFAHJCQCIIIEBIAJABaKQCQFQHQAQGKFACAIAJABAKaHQBK',
  'GLQBdCABiBECFCbDgDjEJFBGHQAQCQKYEYFYBCGIIIDIDAHJAQAICSJYDYDBGZBQFQGQEQKKJAAACAHZGQDRJICCAYAADYGAHJDQDYGYHYIYBRJQKZFAFIEIEAJIAIDBGYHYIYBYFSEIKIBBCIDBAYCRIIGIHIARCYJYBYKYEYEQKJFBIIGIHIAIJAAAHZGQAI', 'GLYBFCDBTBjBECcFZEQDIGoGIIJAABHYIADYCRDQIQJIAACAIYCYECGYBSFIEICIEAIIAQJYCAIJDBHIARDZIZCQEQJJDADIACHYIYCYCRIJDQIACAJYEAGAKJHQDQDYCYGYESJIAIDBCYARJYECGIAIAQCICAHAKZGQEQIQJICAIZEZGBKJHQIQCQDQJZGAAJ', 'GLZDLGICbCTDcDJEkEAGDGgGKQAQCQGQBaEADAFAHAKKAQCQGQBQIQJaEAIKBACAGAAAKaDQHQFQIQEQJKBACAEZIADAFAHAKKAQCRGQEQBQJaIADAFAHAKAAKGQEQBQJQIaDAFAHAEKDQGAAaKQEQHQFQIKJABAGAAAKZEQAKGQBQJQIaDAFAHAAAEAKJGQAa', 'GLcDLGABYCEDBEhEQGTGZGjGKQAQJJGAKZAQJQIQHKFQEaBACQHAIAJAAAKJGQFQEQBaHAEKFAGAKZAQJQIQEQHQBKFAEaCAIAJAAAKJGQEQIaJAEKGAKZAQEQJQIKGAEaAAKJEQGQIaJAAAKAEKGQAaJQIKAACQGAEaKQJQIQAKFQBaHAAAIAJAKAEKGQFQAa',
  'GLgEDGACMDYDcDqDaEkEJGTGBZDAKZFBKJIAGJHQEJCQEYCAEAAAHAGbHQIQKQEKJQFaDQBJFAJAEaKAHAIAGLAQCQHQEQKZDQJJFQBaJAFKKAEAHAGZIQDQEKKQFaJQBKCAAAFAGZHQDZJZEAIBHJGJAQDQKQJQEaBQFKEABZIAKJAAGZDQAICREYFZIAJJAA', 'GLhBTHQCADCDEDIDREKGiGrGIIGICAAYJIKZHQGQIZFQEJDJCAAADYKYJQBQFQIJDQEaIAFABAJAKKHQGQDQFaBAGKHAKaJQGQBQFKDAHAGaJAKKAQCQGQHQDQFaBAJAKAGKHQDQFQEQIaBAFKDAHAGaKQJQFQBQIKCAAAEADAHAGAKaJQGKHQHIAIAACRDYBY', 'GLiEDGABQBgBhBkBBEMEREbGGIAIFIEIDRIYJYKYGCAIKIFBEJDJJRCRFYHYDDEYAYKYDQGSIIDIHICBFYHQBZIAGBAIEIJIFRKZCQBYDQIYGBDJKJIQBJCAFBJYEYAYDRKIHQCIFBHYECKYDBAIJJHRCRBYCYEYIYGYDBKYABJJHJCRCIFTEYIYKYAYDRGIAA', 'GLpDDGNBUBYCkDsDIEAGKGZHCQJIHIEBAYGZFQCQDQJQBQIKEAHAJZCADAFAKYFYCRDIFACYDRFIJJHQKIERIaBAJAFACADAGJAJEQHYFZCADAGAAJKQFQFYCYHIEBKYCRDZGBABCJDRDIKIERHYGZAAFKGQGYFYHIAYCBDIEBKYFRGJHQJZCADAFIKIERJYAA',
  'GMoDBEYBFCLDQDcDqDkESGZGhGBYEAJAFKBQEaJABICBFAKYGYGAKKBQCREQJZFAEKBACBKaDQGQEQFQJKBACAKAGaEQGIKJCSBYFYJYDAKZEAGKLAHAHYIYAICQLYGYDSEIEAKKLAGaIAAJGIHQGQLQKaDAIAAAHKGQAZIQKJBQJZEAEYDBIILICAGYHZIQLJAA', 'GJrGLHICDDoDREAGgGbHDIEIFAGICAHAEAAaIQHKCRFQGYGQDbBAHAIAAKCQEQFQHaBQDLGAHACAFAEAAaIQBQHKGQDbHABADIIAAKCQEQFQGQDQHaBAGKCBFAEAAaIQGQBQHKCADAFAGaIAAKEQGQCQFQDQHaBAIAAAEKGQAaIQBQHKCADAFAAAGAEbIQAK', 'GKADrDNBCCICJCUCdCDEgHCADQGYHABIHYCSIIAJFAGAJIERFYAYDYGYIYCCHIIRAJDAGAIAJABaHQHYCTAIIIGIDIFIECJYGSIYCCHIGIJIESFYDYAZIYCYHCGIBJJIDSIYCYHYGCJIDIEIFSIYDBIAEABZDQJQCQGQHQAJIJEBEYDYDBBBJZGRHRARIJCBAZ', 'GKVBACYBjBBCEETEZEkEoGEIBICCFYABGIDBHYJIDQDYGYJYIYATFIGIEIDCHICSBYDYEYFYGYADGIIIHICIBRDYCCHYGYIYATFIGIEICIDIBBHYCSEYFYGYADGIIICICQERGYARFIDJEBEYDYDSFZABDAFIGIDIEIERFZAZGBDJCBCIEIHIBRFYAYAQEBHIBI',
  'GKgBdCFCSCADjDpDrDIFCHFBHBGJDQHQFQJQEKIADYFYGYHYBYCSJIIIADDYDAGZHQFQIQEZJABACAHJFQIQIIDIDAGAAREYFZHZBQJYCBBIHIFIIIGIARDYGBFBAJDRGYGADAFAAAHaAQFQIQJQEKGAEYJYCYBCIIAIFQHIDQJYACIYBSCIAIJIDBFYHYIYAS', 'GKsDDGgBBCCCNCYDLEpGaHDYEYBYFAJIGIGQEQEIDICDGYGACQIYIAAbJQFQBIEAGKDQEQBaFAHAGAJAALIQIICSDYEYGYJYFRHIGAJAIAAaIIEQGYHYFBIIIQJQHQBJDACAJIEICIDSGYDAEAGACBAAIaJQFQBIEAAAAJCRERGQBaFAHAAAJAIKDQEQGQAYBQ', 'GLABbBcBlBEDgDoDJFBGqGLHDAFIJIGIATHYIYEYKYDCCIBICAFIFAGAJZBQBIFIFQKQEQEYDYCBBBFIFQGKJAFaGQGYBRCRDIEIEAJIKAJAFAFJAJHRKZERDZCBCYBDFIJIAABQGYFQJQEQCQDQIKKAAAHAGZFZJYBSCIDIEIAIAAEZBAFJGJHQKQIaCABADABY', 'GLAEoGEBKBLBYBCDQDUErGZHCIIQCQEIDIGJAIHIFCKYDREYEAHJKABAJaDQIQHQEQGYCAHIDAHAIAJKBQKQAQFQGaEAEIAIAAHaDAIAJABKKQHQHYDYIYCREIAIGIDADYGYAYEYCBIIAREZCZIBAJHJHAKABaJQAQHJCSEIEQGJDAFAKABAJaAQHQIQGJEACAAY',
  'GLCBFBUBVBIDDERGjGoGrGYHEAGYCYDYBRFIAIGAKAHaBQCQAQDQFQELGAKAHAIAJaBQCQDQHKKQGQEbAAFAHABACADAJKIQKQHaAQFQELGAHAKAIAJaBQCQAQDQFQEQGKHAEbAACAFABADAJKIQKQEQHQGaAACAFABADAJAIKKQCYARFYBBDIAICIKAIaJQDQBQ', 'GLCGoGFBIBADUDbEKGRGrGYHGIKIDRHZIYFYFAIKHQEQAZFAEKHAIaCQEQFQAKHAFaEAFIIJDBKYGYCRIIFQEZIACAGAJABKKQDQFQEQIaAQHKIADAEAFAKABaJQCQGQAQHQIKDAEAFAAaCAGAJABKKQAQDQFQEQIaHACAGAAKKABaJQAQCQGQHQIKDAEAFAKAAa', 'GLEDZDNBQCdCRDrDAETFKGoGAZBQCAEAFQGIKIDQHQAZJAHIDBBYIAKYGYEQCQGAJIAIKJBQFQHQAQJaIAGAFJBAKZFQGQIQJKAADAHABAKAFaGQKJBQDQHQAQJaCAEAGIFJBQKZIQAJAAHAIAKJBAFZGZEQCQAIJIDABABIFAGZKQIQFIDRJYAYAQJKHABAHYAY', 'GLIDYGjBADQDUDkDEEhECFbGGQIYCYKQBKCAIAGbCQKQBQFQHQJQDLAAAJEBIBGBCZBZKZFRBJHQDQAJJAGJCAGYCQGQIQEQJQAbDAHAJABAFAKJGQFaBQHQDQJQALEAIAJAFAFYGAJQEJIAFACAKaBQGKJQDZAQEJDAJAGaBAKKGQBZHQAQEQDJJABAGAKaHQAQ',
  'GLJBoGABQBFCcDgDjESGZGCHAAGIHIBIDRIZJYFYEQFAJJDABYHYERFIIIKIAICIDCGYIYFYJZFQIKJAFaHABJGQFQJQIaHAFKGABZFQHQIKJAGABAFaHQGKJQIaGAHAFKBQEAJQIQGaHAFABKJQFaHQGKIAFAJABaHQFKIQGaFAHABKJQIQGQFaARKYEBHIAIAQ', 'GLJDkDbBiBICDEUEgEAGRGrGDAFIIIEAHAKaBQCQGQFQIJAAJADADIHIERJYDACAKIEQJQAQIaDAFAJKEBHAKYKABbCQGQJQDQFQIKAAEAHAJaCAGABLKQJQEQHQAQIaDACAFAGABAKKJQBbCQBIDQGQFQIKAAHABAJAKaCQGQBKCAHQAQIaDAFABAGAKKJQHQBa', 'GLQBLDgBZCaCTHDDAGIGjGrGBIDAEAGIHIIIABCBKaJQFQBQIJDAEAKAJaFQBQIQGQHJDAEABaFAJKKQBQDQEQHZGAIAFAJAKKBQCRARDQEQIaGQHJIAGbFAGIJAKABKDQEQGQIQHaFAGKDAEABaKQJQGQFQHKIAAACADAEABAKaJQGQBIDQFQHQIKAAAICCDYAS', 'GLQBrDNBdCBDIDbERFDGKGoGAQEYGABAIYCADAKKHQFQFIABHYJYKYDQCQIIEIAAFYGYCYDBBIGQFJHAKZBQBYDRCIFIGIHIASEYIYCADAJYFAGABAKKHQJQEQIZFAEKJAHAKaBQDQCQFIGQEQIIJJACHYEYGYJYCYCRFRIJJJAJHBGZERFZCAEABABYCREIFJAR',
  'GLgBAGIBdBhBiBFCUCDEJFrGHYDYGRIIBICAABEYFYKYGQIQBJJAFAFIEIEAKZAQDQHQIYGBDIHIFIEIAICSJYIYHBKJAQCQJQBaGADAHADYGSHIBJIIEBFYDYJAAAKYGYHSIIDBFIAIJQBZIABIGAHAKJAQAYESJICDAYABEZKZGQHQIQBJJQCJABAIEDJYCSAI', 'GMCBdCgBFCICJCSCADLDTDpDbFIAJALAKJFRGQAQAYGCFICIERAYCCFYGSCIAIHIECFYASCYAAGBKZLQJQIQHJGAAICREIFCCYAYKYGSHYIYJYDYBCLIGIAICIKIFSEYHYIYJYGCAICIKIFIESIYJYCBAYGRHIIAJAEAFAKZGQCIABGYLYBSDICIAIHIGCLYCSAIAQ', 'GMUBYCEBdBACDCFCBDqDsDJFhGAQCQFQIYJYDQGQHKFAKALAIAJZAQAYDYGRCIDCAIIIJILIBIESKYFYDYCYHYGCAIIIJILIFSKIECBYFYIYJYAYLYGSCIDIHIKIFCBIESFYKYDYCYHYGCAIIIJILIBIEIFSKYBCIYJYAYLYGSCIDIHIBIKIFCEYIYLYAAJIIQLQBQ', 'GMYBDGLBMBlBcDoDAGZGiGqGIHDICILIABIYFYJZFQIKJAGAKZFQGKJQIaEAGAFAKKJQFaGQFIIJARLYCYDYEBIIFAGZKAJKAQGQFQIaCQDQEQBQHKLAIAAAFAGAJaKQCQDQEQIKLQHaBAIACADAEAKAJKAQGQFQLQIaBQHKIALAAAFAGAJaKQCQDQEQBQHQIKLABa',
  'GNlBIEDBFBKBVBgBECTCZCcCqDAGERBIGCJYEYLYIQCQMIGAJALYIYKYHSCIBIMIGIJBEYGSBYCYMYHCKIIIGIEILIJSBYCYMYICGICRBIGQIQMIJCEYCYLYGYGAIRBICBGYIYKYHSBIIBLIEQJQMYBAHAKALJGQGICSIYGCCICALZHQKQBQMJIACYJAEALYKYHYAYAA', 'GKbBFChBECaCSDCEcEIFrGCYIAEYAYHYJYBSDIFIGIIICDEYAYHYJYBYDSFIGIIICIECAYCSIYFYGYDCBIHICIAIESIYCCHYBYDSFIGICIIIECAYHYCSFYGYDCBICIHIAIESIYFYGYCCBYFIDSCIGIIIECAYHYJYBYDYCTFIGIBCHIAIJIESIYBYFYGYCDDIHIAI', 'GKbDgGDBdCMDBEjETGoGQHEAFYCYHAAADAGAIKBQJQCQFQEbHAAADAGAIABKJQCQFQEQHaAAEKCAFAJABaIQGQEQAQHKCAFAEaCQGAIABKJQEQFQHaAAGAEKJABaIQEQGQAQHKCAFAJABAIaEQBKJQCQFQHaAADAGABAEAIKJQBaDRGQAQHKCAFABAJAIaEQGQAQ', 'GKgEDGSBJCdCLHbDqDAGiGCADYCYFYEBHJJIAIAAHbJQGQGIAIHACQJaGQAIGYERFIHIDQIQBaFAAAEAGAJKHQGZAQHYJYEQFQBKIACADAGAHAHIJZAQDQGJCQIQBaFAEAGAAAJKHQAYHYJYEQGIAAJAHKCRAYDQGYGQFQBKIAAAAYCAFYEBHZJIJQEQGQFQBQBY',
  'GLCDcEFCYCADIDQDpDhGrGKHIAHAJZBQCQAJEJFAGADAJYBYCRKIGIGQFQFIDBEYHYIYBAJJHQIQDQGQFQEQAbKABAIJDQEYKYCCIIJIHIHAJaIQBQCRFJGAHAKIEIDAJAIaBQFQGJEQKYCBBICQIIJIDREYEAGaKQALEAEJGBDBIYJYBYCRKYAREJEQGLKAHAFZBA', 'GLJDhGNBACYCZDDEkERGbGpGAACAIJFBIZJZCRGIAIFIIIDIECBYJYKYHYCRIIIQFQFJARGZFBAJAAIAIYCBHIBIJJKIESDYGYAYFYCBIIJIGRAZAAFQAJGBIZJZCRAIFIGIIIDIECBYJYKYHYCRIIIQFQFZARGJFBAZAAIAIYCBHIBIJJKIESDYAYFYGYCBIIJIAR', 'GLLDQGNBTBUCdCiEAHZDgDDGEQIYJQIQBQHQKaAACYDAFCEIGIGAJKIQBQHQKQAaCADAGAJAIKBQJaGQCQDQAKKAHAJABAIaGQJKHQKQAaCADAJAGAIKBQHQJaCQDQAKKAJAHABAIaGQCQDQAQKJJAAaCADAGAIKBQHQAQJQKZCADAAKHABAIaGQAQCQDQKJJAHAAa', 'GLLGgGRBKCbCcCdCEDBGTGoGCYDYAYIYHYJYGCFIEIBIKICRDYAYJYEBBIJQAQKICIDRIQHaIIDBCYBYKYERAIIIIAAAJAJIDICCBYCQKYEYFYGSAIJIDIHQIZAAJAEAFAGAKKBQCQDQHQJaAQIKJADAHACABAKaEQFQGQAQIQJKHADYAYIYJYGCFIEIBIKICRDYBA',
  'GLLHpDkBACBCCCYCbCZDhDDGCIHIBIIIJIESFYAYCCHIBIIIJIEIFSAYCYKZCAHCBIIIJIEIFIGIDSAYKYECIYJYHRCIEIAIKIDCGYFYBZIYJYESCYHBEICTAICAKIFCIYJYCYEYHSAIKIFIDIGCIYFQJYJQIQDQGQKaAACABAJJIQBZCQAQBIKKDAFABAIAJZCQBI', 'GLYCdCABBCFCCDKDZDTEhEjECQFIGIDICIACHYDQFZGAIAJYKYBYESGIIIDIDAHJAQFYDYGYIYECBIHIKIDSGYIYEYBCHIKIDIJIARCYIYIQGQGYDCHYKYBSEIDIGIGAIAHZIICIABJYKYBYESDIBCHJKIJIARCYIYIQGQGYBYDYECHIKIBSGIGABBIAJIAICSIYBY', 'GLYGoGKBbBBCFCcCdCLECGgGBIEYCYIYJYGCDIAIKIESCYIYJYGYDCHYDQFSDIGIIICIJIECAYBYKYHYGSDYFCGIHIAIBIKIESCYIYDYHCAIBIJYKIEICSIYDYHYFYGCAIKIDRIICCEYDYAYKYGSFIHIIIDBEICSDYCAIYHYFYGCAIBIKIEICIDSIYDAEBBaKQAQAY', 'GLZBdCDBKBaBFCoDIETFAGqGAYCIEYDRHIJIACEYEAGAKZIQCQHIEIARJIEBEYHYCYJYFYBCIIDIDQGIAQGAGIAIESHYJYCAGADADYIYBSFICICQJJHAGZCZIBKJAQEQGQHQJZIADJCRCIGIHIECAYAAKZCQDQGJAJERHYABGZCAKIDAEQGYCYDYBYFSIIAICBDYAR',
  'GLgBcEABLBMBNBQBBDJDDGZIBQEQIQHQJZFAEIDIDQHJIIJICICQJZGAHAIAIICIGIACKYBYERDIIRHRFZDBFIHICICAHZDRFICICQJJAAGAHZCZIBBBEZDRDYFTBIIIECJICAHIKIATGYCYHYEYEAHJGRCYEYEQIZJZBBDBDIKIAIEQGREYACKYDYDRHJHQIQIJAJ', 'GMABiDNBZBdBBCQCcCSECGKGoGEQCQHAKILJDQFQGQAQJZKACAEAHABIIALIDIDAFRIYHYCYCQEBBIEQHQKQJKAAGAIAFALaBQBYERCIHIDIFIGIASIYFBDYHYCYEBBIBALKDQFQGQIQJaKACAHABYEQCIHIFIIIABDAGYDYBYLZEQEYCSHIFIBAIIAIGBLYEYFRIIAI', 'GMDDiGTBACFCYCZCdCBELDRDrDCIKIKQIQAZJACAIIGBBYLZHYESCICAEAHBLKBQGQHQKQIQAQJZCZEBHBKJEQHQIQCQJKAACAGAIAKaLABJKQGQAQIQCQJaCAIALZEQHQCJAJAAGAIALAKAKIGRBYEQCQIYAQJKIAGABYHQAQAYHBIIGBKILYLQAQAYIQJZHAKALJAQ', 'GMEDoGABKBaBLCMCQCRCBGjGrGGIFIDIDQEBIAKZEQFQGQAQAZFBGBKJEQIQAYDAKALABKHQIQAQAYBYEBKYLYGSFIDIEIAIJICIHCIYBYKYLYGYFSDIEIAIJICIHIICBYKYLYGYESAIAACQEBGAJYDAFABKLQKQCQAYHQIQJZEBGICICQAQEYGBCIAQEQEYGYCCAIAQ',
  'GMIBTBNBcBgBZCdCiDDEJEAGqGCADAEAGAHILIFIEIASJYAAFBLaFQHQBQDQHIIQKJJAEALIAQEYFYBYBBDZIRBJDBDIFIEIABLYHYGQCQKIJIABEYFYIYBRCYGBHILIERARJYDYCYBBKYGAIJCRBYCYBRDJBBCBIZDRDIIICRBYIBCJBRBIFIAIEBLYHYDQGQKIFBBY', 'GMMBACBBaBCCDCFCRCkDbGoGrGAABRCYHBIYDYJYGRAIFIEIHICIBBDAKALaIQIIKJDQDYCSHYEYFYAYGBJIKICIDILIBSHYDCCYERDICCEYJYKYGRAIFIDICIEBJYKYFRDICIEIHIBCJYKYFYDSAYGBDIFIJIKIBSHYEYCYAYFBJIKIERCYAYFYGYDCJIKIASCIEBAY', 'GMYBBGABVBTDoDEEZEJGQGjGqGEQJJLIFIAQCRBYIYGYDBEIJIHAKZEQJQDQGQBKIACAAAHAJZEAKJFALaKQEQJJFAEaKALKAQEQFQJaDQGQBQIKCAHAJAAAFAEALaKQDQGQJKCQHQIaBAJADAGAKALKAQCQEQFQHQJaBQIKJACAAAHAFAEALaKQDQGQBQIQJKCAHABa', 'GMsDSGCBVCYCADDDQDZEbELGpGGIHAEALYAYDQBICQFJHACYBYDAAILIEQCYBYKZGQFJHJCAEAHYLYAYDQGQKJHQFaKAGABJHQGaBADAJAAALKEQCQIQHQGQFQKaBADAAIJAHJIALZAQHQJQFJGAIAHZAALJHQAaDQJQFQBQKKCAEAGAIAAAHALaDQFIJQAJIQBZFAAA',
  'GNdBAEKBLBUBgBFCRCaDpDCGiGrGEAFBIICQJYMYAQGQKIBIFBHYCYCQBQIYEQKZGAAAMIJIHQFQKYDADIBIFIKIHCCYCQFRBYHQKYDYDQKJEAHACAIIJYMYAQGQKIBAFAFICIHRBYKYFAGAAAIYEQMIJIHQBQKZDADIFIBIKIHCCYCQHQIYKYFAEYLYAYAAGRDIFIEBAY', 'GJEDTGDBMDqDsDIGbHQIEZGAIAEAFbHQBQCQDQAQGKIABaHAFLEQBQIQGaAACADAHAFAELBQFbHQCQDQAQGKIAFABAEbHQFLIQGaAADAFAHAELBQIQGQAbDADZFBCJGJAQDZFZCAFIHAEABKIQAQGZFQDKGAAAIABaEQHQCQFQAKIABAEbHQFQAQDQFIGKIABABI', 'GJsDbGjBEDkDBGgGLHIIFYGQIQFQDbHABACAEAAAGKIQBaHQDLFABAIAGaAQCQEQHQDQFKBADbHACAEAAAGKIQDQBQFaHADLIAGaAQEQDQHQFKBAIAGAAbEQEZDRCJGJAAEZDZCQDIHQFQBKIAAAGZDAEKGQAQIQBaFAHACADAAKIQBQFaHADAAADIEAGKIQBQBI', 'GKQBMCABLBkBdCBDJEDGZIARCRFBEIBRDIGYCAHICIACIYJYBYEYFRDIECBIJIASCYHYEYDYFCBIJIAICSHYEYDYHQGQIZFYBCIIJIESGIHICDHYEBAIHRCREYGYDYDQGJCBEYDYABHIERCRGZAAAIGICBDYHBEJDRDICTGYHYECJYBSFIAIEIIIGAHAHICCDYJYAS',
  'GKQBdCRBCCMDAEbFTGgGoGDQEAHABAGAJKIQAQCQFQEbHABAGAJAJYBRIJAQCQFQEQHaGAGIDIEIFIHIADCYCBIZJZDRDIJICQAQHYGYBCDIGQHJAACAHYJYGRBYDCGIFICIAREYFAGYDSBIFIEIABCYERFZBYDCGIJICQAQHYBYBQHJAACAJYBRFJAIAQAICBEYAQ', 'GKjDpDLBACYCbDBEMERFrGAIFIHAFAAAJABKCQGIIQDIECIYCYCRAZAAFQFZHRGJABFBCBCIIIESDYIABaJQCQHQGQAJFAIABAJZHQGQAQFJIAIIDIDQECJYCQERIQFbAAAZGBHBCJBJDQBYFQAZIABACZHRBJBACACYHAJKCQEQIQAJFADACYIQAQFJDADYCDIYBY', 'GLABkDiBNCBDKEQEgEDGaGrGBYFIEQIZDAIIJIGIAREYEAAAGAJaDRFQIIIQELAAGAJACAHAKaBQDQFQJKGQEaAQIAJADAFABAKKCQHQGQEQIaJAEKGACAEYHAKaBQFQEQJQIKGAEZFABAKKCQHQEQGQIaJAFAEJCAHAKaBQEQFQJQIKAAGACAHAEaBAKKEQBaCRHIAR', 'GLACkEBCCCNCbCLDTDYDgGoGDQEABAGAHAFAKKJQIQAQCQGaHAFAIJAQCQGQHaFAFIDIHJGACAIYAADQHQGJCAIAJAKaBQEQFQGJHADAJIKIARCYHYHRGaDAEAFAIKDQGIHQCIACHYDYIYJYKYBYESFIGIDAIBBBJJKJHRJZJAHAHKJQCQDQGZIABAHAJJCRCYDYDRBZ',
  'GLADiGJBlBYDgDCEEESEUEoGCYKJFQEQIYJYDBBIEIKIFICSIYIACAEAFAKaBQDQJQGQHQALGAIACAEAFAKABaDQJQFKEQGQAZHAFAEKGQGYEYFYDBJIBIKICRGYFYFAEAGICBBYKYJYJABKDQKQCQGQIQAZEYFAHQFJEBIJAREZEQFbHADAIAJAAIBACAKKGQAQGYBY', 'GLADjHFBVBhBYCIDQDZDLFCGGIHIFBEYBZDRDYCTJIHIKIAIFAIYHQGQAQKZJACAHIIIFQKYJYCCDIDBBJIRHZJQKJFAEAIYBYDRCRKIAAGAHAEIFRAYKYCBDBBIEIEQHQGQAQKZJAHJEAIIFQGYEBIBBZDRDYCTHIJIEIAIGIFBBYESHYJYCDDIDBEJHRIJGQIQGJAR', 'GLCBqDTCUDcDoDkEDGLGgGQHAZHZIZDBEBGBBJBAFLCQJQKQIQEaDQHJEADaGABAFAIYCBJKKQIQAQDQEQHaCAGABAIKKAJaFQIQBQCQGQHKAAEADAKAIaFAJKIQKQAQDQEQHaCAGABAFAJAIKKQFbBQCQFIGQHKEADAFAKAIaJQBQCQGQDKEQHaCBDAGABAJAIKKQBb', 'GLEEqGBBCBIBYBLCjDoDUERFBIEAHIGQDICIEIFCIIKYCSDYGBCIKIFTEYERDZKBIBFJERFYIYCYCQIJEBFYCYCABZHQIQIJCJKRDJEBEIFDBYKYDSGYCCDIDQCRGRAZJBIBHBDJCRCIBIGIKIFTEYERAZJZIBHBCBBICIGIKIEIERARJZHZIZCBCYDDGIKIAIFBEYAQ',
  'GLMDgHSBTBACdCUDYDjDrDBHAAGADICIHIHABAJaIQCQIYDRGQGYFBDICIBIIIJIESHYGYCBKYAYFADADYFSAICIGIHIKIECBYJYIYDQGQCYFBDIIIIAJKBQEQGZCQCYFYDCIIJIBIERHYKYCBGIGABAJaIQIYDSFIGIHIEAJYIYDYDAFRIIJIEQHYGYARCJKJHBGZAZ', 'GLQDiDcBdBUDaDEEKEYFAGqGAADQIAKZCQEQGQJKAAIABZFQEZCAKJBQIQAQJaGACADBFJEQHQAJIAEZFZCQDRGQJKIAEABAKZCQGQAJHAEJBAFZEQHQAZGACAKJFQBQIQJaGACADBEJBJIQAZHABAEZCQDRGQJKAAIAFAKZCQBJEAFJIQAQJaGABAEJHQAJIAFZHQAQ', 'GLRBdCNBaBICjDqDgEAGDGKHAAFAGIDQFZGBDJHJERAYHYKYCYBBDIGRFJHAGZFRCRHIKIAIAREBGYFYKYCBDYDAFJGJAQAYGYFYBRHYDYCRKJHBGBAJERAYFYCQHYKYBBCIDIDQGJAAAIFYDYCYBRKIABGZCADAFJGRARAYDYDBAJGBFZAQCQGJDRDYGYKYBBCIAIAA', 'GLYCUEEBJBKBACDCBDkDrGZHCIJZIQBQGIEIDIHIFIACJYKYBYCSGIEIEABAIYIAJKKQAQFQHZDABYERDJHJAABAFAKAJaIQEQIIJIKIASFYBYHYDYGYCCEIGRDIBIHIFIACJYIYEQCRDIGBKYIBEZCRCYDTGIGQHJBAIAEAIYCCEIJJKIASFYBYIYCYCAEBIIKIAIAA',
  'GLYCUEhBjBJCaCEDMDKEkEBGACCYERIYDCFIEICIASIYDYKYFCEIDSIIABCYDYEYFSIIDCCIARDYIYFCEICIAIDSIYCCEYFSCIIIDCAYEYFYCSIIDIKIACEYDSIYCCFIDIEIASIYDCFYCSDIIIACEYFYCYDSIIIQHaGQHIKJAIECFYASHYHAIAIYDCCIAIFIESIYDYBY', 'GLgEJGbBiBACBDSDcDEFYGrGGYHQIQFKBACBGAJIEQBYCAJADADIAIAAERJYCQKZHQIQFQBKGAJAEAKYDQCQJIEBAYCYCQJQGQBZFAGKJACACIAIERJYCABYDAKIEQJQBQFbGAGZIBDJCRBIJIEBKYHYDQIQGJFJEAAYCYHAKJAQEQFZGZIADAKICQJQBQGQFJEAJIAA', 'GLkBCCBBLBdCgDMEQEaEDGpGAACYKIFQHQBYDYGYJYECAIIIHICSBYDYGYJYEYACIIHICIKIFIBSDYCBHYIYASEIGICIDIBCHYCRGYEYACIICIHIBSDYDAGYCBIYASEICIGIJIDIBCFYHYIYAYKYESCIABIIHIBRDYGYAYCYECIIARGIDIBBHYAYIYESCIGIJIDIAABI', 'GMEBsDQBgBDCFCUCZCqDaEAGIGFRAIGBHAJIHICIDBIZIABbFQAQJQBIEQGQKKLAHAIIDRCYHYEYGYAYFBJIBIIIDICRHYDCBYIYJYFRAIGIEIDIHICCBYIYDSEYGYAYFBJIDIBIIICSHYEYGYDCJYFRAIDIGIEIHICCBYIYJYDSAYFBDIJIBIIICSHYEYGYAYFYDCJIAS',
  'GMVBIDCCTDkDQEDGLGaGhGoGrGBAFAIZJYEYEAJKIQCQFQBQGaHAAADAEAJAIKCQFQBQGQHaAADAEAJAIALAKKCQFQBQJaAQEQDQHKGAJABACAFAKaLQIQAQEQDQJKBACAFAIaAQEQDQJQHQGKBACAFADaCQEAIJDQFQBQGaHAJAAAEAIICQJYAAIALAKKCQDQFQEaJQBK', 'GKADkDCBaBjBICRDgEDGLIBQDQGQCQAICYFAGYDCEYGIJQIQAKCADAGAEAHABbJQGKCQDQAaEQIADICICQAQIZGBDJAJAQCACYECBIHIFSCYIYGYGQIKCAEAAaEQGQIZDAGIEIAICQIYEAEIIICAAYGZGAJAAIBKCQHQAQCIFCAYHYBZJYDTEIERGJGAJABADYERJIAI', 'GLBDrGMBACFCJCDDaDKEcEhEKYDQAYGYHQIQGQAKDAFAKABaJQBIEQAIGAIAHAHIKIDSFYGYAYEAHIIYCYCRIJGRAZIAGJKBCZHZHQGQGYIQAJJABJCQBYGYKAGAHAHYJYESAIIIGIKIFIDCCYCABZJQHJCJDRFRKZAZIAGJARKJDBFBCZHZHQAQAYGZEAJABKHQAQHYBY', 'GLCDqDEBFBVBaBTEkEYFJGQGAZJYCYDYEBGICSDYDQAKJAKAFAIABZCQCYDSAQGYERJKKAAaJQKKFBCBDYHYERGICIFRKaFADAJACAGAHABKDQFQIQAQKQJaCAGAHAHIFIFQAJDAIABaFQFIBJIQAZHYEBFIHQAKDAIABZHQAQCQHYFYERAIGQJKKADAHABJIQDZCZHBBB',
  'GLECaEBBNBACCCDCRCpDcErGESCYHBBYJYDRAIGIFIHICIECBYIYJYDYKYASGIDCJIBIERCYHYFYDYGYACJIDSFIHICIEBBYDYJYASGIFIHIDCBIERCYDYHYFYGYACJIBIEICSDYEBBYJYASGIFIHIEIDICCBYBAIAJYKZAYGSFIACJIKJIQBQBICSDYEYHYAYFYGCJIAR', 'GLEDrDDBVBACMCTCkDBEoGYHBIDAGQCQIQAaCAFAGAHABAJKKQEQAYIQCYGBBYHYDRFIGICICQIAHZGQAKEAIAHAKAJaBQKIERIYAYGADYFSGIAIIIEBKYCRHJIQAZHBCBKIERAYHYGYFCDIGRHIAIEBGAKYBACQJKKQEQIQAQAIHaAACAGABAIABZCRGRAIAQHKIABABI', 'GLKBrGFBLBbBBCkDUECGoGYHFYAYDYEBKIFRIZEAEIIIFBKYHYCREIGYHAGABAJKKQFQGZHQEYCBHIDIIYDAHYCREIDIIIFAGYHYHAGKDQIIAAKAJaBQGQGIKIFRAYHYDYCYIYCBGBKJHRDZGZCQEQIJDADIAIAQFBHYKYERCIGIDQIZCACYECGIDIAIKIARDZGZGAKABA', 'GLLErGgBhBiBaDQEcEAGDGIGAIFAEAEIDIDABZHQAQKKGACABYDYEQFQGICBDYFYEBBIDQCQFQGQKaAAEAHABJFQGQGICICQKQIQJaAAEAKKCACYGYGAFABZHQKQAQEQJKIAGAKZHABJFQKQEQGQIQIICBDBJZAAHAKYBAFKKQKIDRBZCRHQAQIYEAJJIAGABAKAFaHQAQ',
  'GLLGQHABkBBDJDgDiDoDDGTHDIHIHQGKBQCQFQEQJaAAKADAGAHAILBQCQEYFQKYDBGIHIBICRFYFABACAIbHQHZGRDRBIKIEIFICBIBHZHAGbBQIKCQEYFQKYDBBIGIHICRIIFIERKZDZIBFJDQIQAQJKKAEAHAHYDYDQEJHADYEQHJDADYEYEQFaBAGKEQFQHYHQIaAQ', 'GLgEAGkBlBFCIDZDTEiEKGQGBJFAJZHAGKKQGYJQFQBZHAGAKKJQGaHQBJFAGAJAKaHQGKFQBZGAHAKKJQFQBQGaHAFKJAKaFQHQGKBAEQJAKAFaHQGQBKJAGaHAFKKQGQJQBaHAGKKAFaGQHQBKJAKAFAGaHQHYCCDYCQERBQJKKABaCACIHIHAGKFQBQKQJaHAGAFKAA', 'GLkBACLBYBbCdCZDhDJEEFoGAACAEAIAGAHAKJDQDIBSIYCYEBHIHQGQGIDBKYAQDQGICRIIBCDYCYDQGYAAKIDIBSIYBAEYJYFCAIGIHIKIDIDAKaAQCQGIHQDIERIIBBCYEYDYDAGYAAGQGYAYFSJIIIEBGYAYAAGJERIYABDIEICIBRCAIYEBGZDQDIASEICICBGBAZ', 'GLqDCGICTCADZDkDsDgEMFJGBIEICAFAIAAZHZGQIICRJQKJEQBaCAKAEKFAIAAAAIHZGZJQEQFKIAAAHAHICRGYDQIYEZFQKQBKIAIICCAYEYDAGIHYHQAQCQEQIQBaKADAFAJAGJHJAQEQEIAAHZEQDQAIAAHAEZGZHIJQFQKQBKIAAAHAEAEICRGYDQAIIYIQBaKAAA',
  'GMABSDVBYBlBRCUCbCBDJDoGDHDAGQBIFIDIASIYJYLYCBBIHAKIAQDYFYHYBYCRLIJIDAAAKYGYEYCRBICAEAGAKKAQDQFQJYHBFIAIABDRAYFYFAHSJIAADAHAKaCQEQBQGQLQILJAJIFBDIARFYJYJQDAIaLABACAEAGAKKAQAIFSIYJYFAHBAIAAKaEQGQBYCAEIGIAI', 'GMACVCYBjBBCCCLCUChDsDDGoGEQFQKZBBHBJBDJLJCQAQKYGAJYDAJQGQKIAACALZJQDYBSGQHIDCGIFIEIIICICBIZIALAJaFRGQDQDYGCBYHSGIDIDABAFBJKLQIQIJCRCYEYFYIYBYBADSGYHCDIIJFQGQJIKIEACILIASEYCCFYBYGYIYDYDBJBIJLJBRFQCQCIFCAI', 'GMADgGkBCCICJCTCdCUDoDqDDECADQKIJILIAJFAGABIERFYAYDYGYIYLYHCCIIQLQAJDAGAIZCYHSAILIGIDIFIECGQBYIYDQAZLACAKAJJBQKaJAJYCRBILQAJDAGAIKKAKIESFYDYGYAYLYHCCICAJIKQBJDQGQAZLAIAJAKJDRGRARLZIBJBAJAQLQIZJALJDBGBKZAQ', 'GMFCJDEBLBYBACUCbCoDsDRFBGARCIIIEQFQLYDADILIFAEAHBIYJZAQCQGQDQLJBAKAJAJYHRDYCYIIEQFQBYLYACGICSDIHBCYGYASDIGBCIJILIBIFAEAIYJQKQBQLZDAAAGACAJJHRIIEQFQLYGYDYABCIDSGIHCDYCYJYASGIHILIDBCYFAEAIYJYAYGSHIACCIDRBI',
  'GMICMCTBkBJCSCdCADEDqDCEgECQGBDIJIFQKQIZBAGADADYGSBIIIKIFCCYDYJYGYBSKIDBCIFRIIHJAAEALAJZFQDYCBFIJILIASEYDYCYHYIYKYBCGIFIJILIAIESDYCYHYIYKYBYGCFIBSIIHIKICIDIECAYJYLYBYFYGSIIKIBCJILIAIESDYCYHYBYIYKYGCFILIBR', 'GMJBoGFBlBICADZDgDCGbGiGKHBJCQHQIIFIEAGYGQEQFYIYCAJZDBBIHIKIGIERAYLYDYDAJJCQGAHAIIFIAAEABaKQHKGQJZHAKABKEQAQFYGQIYCAKZHQDQDILIAIEBGYBYKYHYDRJJCQIIFIEAKAGABZHQGKKQJaDAGAHABKKQJQEQFYGZHAIYCADABAKKJQBaHQGJAQ', 'GNABcBNBbBJCSCdCBDgDoDLEDGqGARFAHYIILYCAGAMIJIAREYFYKYBBDIIIIAJAJIFRKYBYMYGQCQCYGCDICRBIKIFBJYMIJQIQIYCYDYGRLIHIEAAAJYMYGQBIDBCIIIFQKQHQLZBADAGAMIJIAQEQLYDYBYGBCIBSDIDQHILJEAAAFBAIESFYACIYKYBYBAIJDQHIKQAQAI', 'GNCDkDNBaBECYCZCKDQDSDAEbGqGBYMIDQLYCREIAIHIJIIIKIFCGYDYBYDAMZCQCYESAIHIJIIIKIDCBYIYJYEALYCAMJBQLQIQDQIIJYCALIDRFIGCBYDYLYCQMYEQJJKQAZHAJAEAMIBIDQIZKQAQHZJAAJKAIJDABYMYEQAQJQHJKAAZCAEAMIBIDQIZAQKQHZJAEALJBA',
  'GNFBpDIBJBMBVCYCcCADhDKECGZGFQAQJILIIICAGABYJQMQDQKQIQLZAAEAFAHAJJBJGQCQLYEYHBMIDRHQKYERIILJCACIGCDYDABZJZFQAQMYHRAYFCHIASEIEAAAJIBIDQGQKICRIYLZEAEYFYHCAIAQFREIHQLIGADABYJYFQEQLJIACAKAMAJABJDQDIGSCYKYEYFBAY', 'GKDCjElBACECYCZCaCBFbGEIAIIIGCHYBYCYJYESAIIIGIHCBYCYJYEYASIIGIHIDIFCBYCYJYGSIYACEIGICIBIJIFSDYHYIYAYECGIASIIHIDIFCBYCYJYAYGYESIIACCIBIJIFSDYHYAYIYECGICIBIJIHSAYIYEYGCCIBIJIHIASDIFCAYHYBYCYJYGSEIIIDIHCAI', 'GKLBjElBACECYCZCaCBFbGEIAIIIGCHYBYCYJYESAIIIGIHCBYCYJYEYASIIGIHIDIFCBYCYJYGSIYADEIGICIBIJIFSDYHYIYAYECGIATIIHIDIFCBYCYAYGYESIIJYADCIBIJIFSDYHYAYIYECGICIBIJIHSAYIYEYGCCIBIJIHIATDIFCAYHYBYCYJYGSEIIIDIHCAI', 'GKMDrGSBcBiBTCUDCEAFYFAADIGAFICICQHQAZEABYDQGAFAFIHIEBCYHREJARGZAAEAFADABICQHAHYDYEQFRGJAAHACABYFQEIDBCJHRDZEZGRAJDAEAGZCBCIGIHIDSEYAYCAFABIDQERAYGAGYCYCQAJGAEADABYFQCIHBDJERDYHYCYCRARGJHAAZCBCIDIDBEJAR',
  'GKSBFCDDQDYDoDgGrGAHbHCRFIIJDBEBAZCZCQIQDKEAEIABCYCAGAFAHaJQGKCQCIASEYERDaEAIACACYGZBQGIGAFAFJAJBACRGZFAJAHKCQAZHYJZBSFIGIIIDIEIACGYFYJYFRGKFAJACACKJQGaBAFAHIJQGQAQDYFZCBGJAQEYIYBBGIGQCQFJAJERDRIZFBCBAJ', 'GKSBQCFBLCRCsDAEiEUFCGAABQEQGQJZDAHAFZIQDIAIGIJIBCEYFYHYIYCTDIAIGIJIBIECFYHYIYCYDSAICCIIFIHIESBYGYCYAYDCIICSGIBICAECHYCYIYDSAIGICBHIESBYCYGYAYDCIIHICRBIECCYFYHYIYDSAIGIJIBIEICCHYBSGYAYJYDCIIBIHICSEYGYAY', 'GLABFBLDSDUDcDBEQEgGoGjHCADQEZBQEIBAEADAFAKAJKIQHQHIASGYGQCaEADADIGIABFYHYKYBSDIEIFIGIGAFaDQDYBBKIHIARFYFADaGQCJGIDIFIACCYDYHYKYBRGIFIFQCQEaGAGYBCFJDJHAKIIAJaKQDQFQGQEJCAGYFADJGQCQCJAJHBGZDZAQEYFQCQBYCIAI', 'GLEBhBFBJBACYCZDCEiGqGTHDAGAIIJIBIFIESGYKYCRAIHIDIGBEBFBBZFRIYJYCRKIDRGIDADYGYHYAYKYCDIIJIKIFIBIERDYBCFYIYJYKYCTAIHIGIKIBIDIECFYDSBYKYCBIIJIDIFIESBYFBDYGYIYJYCRKIFIBIEBDYBSFYHYAYKYCDIIJIBIKIBBDJERFRGRHZAZ',
  'GLFBgDEBRBACCDSDUEkEaFJGBQDQERFZGYKYCYCQFKKAGAGYCYFQKJGACYJABJDQCQGQGIEBDYDABZCQJQGQGIEIDCCYDQERFZKZAZHBGJAQGQHQKKFAAYEAFYAAJABJCQCIDSEYCCDIDABZJQAQFIEADYCRAYJBBJCQAQDQJQFQFIABCBDIESAYCBDBEABZJQFQCIDBEIAS', 'GLKBUCIBBCVCCDEDYDgEaFLGBQEQKQGQFJAAFYGYKYECBIJIHIIICSDYAYFYGYKYEYBCJIHIIICIDSAYAQFZGAKACBHAIYJYBSEIHICIKIAIAQFQGZKAFKCADBIYJYBYESFIHICIKIGIGQKaCAHZFQCJGJGAHAFZCQCYECBIJIIIDRHZFAAIHQFZAAAIFIHIDBIYJYCSAIAQ', 'GLYCUDhBjBJCaCEDMDKEcFAGABCYERIYDDFIDQEICIARIYDYFCEIDSIIABCYDYEYFSIIDCCIARDYIYFCEICIAIDSIYCCEYFSCIIIDCAYEYFYCSIIDIKIACEYDSIYCCFIDIEIASIYDCFYCSDIIIACEYFYCYDSIIIQHaGQHIKJAIECFYASHYHAIAIYDCCIAIFIESHYIYDYDABZ', 'GLYDCGABFBVBlBgDJELEaGiHCQBZGQAQIAJZEZDRDYIIEBFBJIEQKIAICRHYEYIYFBDIIQBJHACAAYKYDRJJEQFQBIHICBEZJZHQBZFADBKIAIGIERJYCQBYIADZFRIIBICADAJJEBAYGYKYFRIQBJHAEICRHYDYDAIYFCJIEIKIERCJABGBEZCRCYJYKYFSIIAJGAJZIQBQ',
  'GLaDAGEBDCFCICgDsDJEcEiEAYCQDQBJFAAYGQAQFQBZDAKAGJAQKYDRBJDAFAKYGAAJKQFQBZDAGAAAGYDQHZJQEQBKFAIAGAKAHZAQKIFRIYBYEAJAAJDRGIGADAAZJQCQEQBIGIIIIQBaGADAGIBIFBKYAAHJKQFQBYDAAAAYDRGYGQBKFAIAAAKAHZDQDYCYCRGRAJAA', 'GLlBiDIBgBkBZCaDJEUEAGDHBQDAGQIYABEIBIGIFIDICSHYCAFBBaGQGYEYARFQIIFIDIDBCJHRDZCBCYFYFAGAIYABEIBKGIHQHIDSCYFYIYAYEBBIGIHIDICSFYDCHYBYGYERAIIIDIFICCHYDSIYAYEBBIGIDIHICSFYIYDBBYGYERAIDIIIFICCHYBYGYDRAYEBDIAR', 'GMABcBSBbBhBdCKDEEQEBGTGqGCQEYGYKYFALICQCYLYFQKIIIEBCYIQKZFAKILIIQEICBIYLYFQKIEICIAREQJYHYKYFCBIDIEILIIIARCYCAAAIAKYDALaBQBYFSHIJICAKYEBBYDREQEIKIBACQJYHYFCDIDALKAQCQEQIQKICIACIYBYEYDYLYFSHIGIJIAACYKIBABYBA', 'GMIBcDNBYCRDTDsDZFAGDGJGjGBYCQKJEAHAGaLQBQCQFQKQJQIKAADAEAHAGALaBQBIGJHQEQLIDQAQIaJAKACAFAGABABYLJCQFIHQEQKZFACABIEJHALZBQCQGQEQFQFYKJCAHAGZBALJGQBaCQEQFQKQJQIKHAFZEABJFQHQIaJAKAEABAEIFJHQKZEABACAFALAGKHQBZ',
  'GMIBdCECFCJCKDSDgDAGaGiGoGIIAALJHQEQEYJYCQIIAIAQIZCAEAJIARFYGYCYDYBCJIKIAIHALZKQJQBQCQDQIKEAFAGAAAHAJaBQCQDQIQFKGAAAAYGIAAHIHAIYJALAKaCQHIAQDQGYFYBBDICIJIKILIESAYGYFYIYBYDCCIBSFIGIIIAIECJYKYLYBYCYDSHJBAIIAI', 'GMNBYCCBEBZBDCUCdCpDrDIEaEAAHAJIKABAIYLQCRKIBBEYCYLAIJEQEIBSKYFYDYGBLIFRDYGYAYHBLIGRDIKIBCEYEAIZJZLQARDIKICBFYGYAYAQDRKIGBAYDYLAJJAQAIIIGRCIFBEIBSFYECGYDYABIIGQIAJZLQAIDICREIGCBIFSGYEYBACBDYAYLAJJIQIYARDIBI', 'GMQDrGFBKBVCYDjDpDDFAGaGgGAAFAHYBYEQCQKZIQJKAADAFAKALAHABZGQHKLQKQDQFQAQJaCAEAIAHAGABKLQGaHQKJGAHaKQDQIQJJAAFAGAHAKZIQFKAQJZFAAKDAGAHAKALABaEQCQIQAQFQJKDAGAHAAaDQIAJYCAEABKLQKQAQDQHQFaDAIAKJAQHQFQGQJZIAKAAK', 'GMsDSGQBgBJCADkDpDCEEEaGhGBICADAHYAZGQKILJEQEICIDBHBAZAAGbEQLQKQBQIQJQFLCADAHAIAHJCRDRIZHBJZFRHJFAJABAEAKALAGLAQAJCRDRIRJZFZFABAEAKALAGAAJCJDJIRJRFZFQHbBAEAKALAGAGZABCJDJIJJRGZGAAbEQLQKQBQHLFAFJGBABJBIZERAI',
  'GNYBSEIBJBMBNCKDhDoDAGDGjGqGDQEQGIMIIIAQCQJQKaGAEAGIJIKICBABHYIYLYMYFREIBIDIAICRJYKYGYGQKKJAGaBADALAHKIAMZHQLQBQDQGKJQKaEAFAGAJJAACAIALZHAMKLQIQIICRAYDYDAIAHZBQJQGQGYEYFBBIHIIIDRAICBDYHYIYBYFREIGIGAJABAHJIQBY', 'GKACdCNBbBgBrDJEhEDFYGCABADIFIGAHIEIJIASGYIYCYBBDICSIIGIACEYHYFYJYCYDYBSIICCJIEAJAHAFaDQHIHQJQJIEIARGYCYIYBCJICRGIABEYCYCQJYBSIIGIAIECCYARGYIYBCDIHIFICQERGYJIAIABFBCJERCYFYHYDYJYBSFAIIAIFIGIEDCYHYDYJZAQBY', 'GKBDrGdBFCaCYDjDTEgEIHAJHAJAEAFAIABaGQCZDSAICIHIEIEBCZGBBJGQEQIQFQJQAbEAHADABICQFKCAIABaDQGQFQEQHQALJACAIAFaGABJEAFQGaCQCJGJFAGAFJIRGZFAGAFZERAYEYHYDCBICIEQHRARJJGBAaAAFAFKAREABYGRJZFBHBCZDSCIFIHIEIEBAJAQ', 'GKLGYGiBACRDgDBEjEDGTHFQHICIBQDQEQGQIaAAJACAHAFLBQDQEQGQIQAaJACAHAFABKEQFaCQHQJQAKIAGAFAEABaCQHQFKCAGQIQAaJAFAHABKEQGQFaJQAKIAFAGAEABaCQHQJQAQIKFAAaJACAHABKDQEQGQAQFQIaJAAKDBEYGAEABaCQHQAQJQIKDAFAGAEAAYBA',
  'GKQCcEFCTDoDAEREKGhGqGHADAGIJIEIAQFQHZDAGAGIFIABEYFQIYBYJYCSDIGIHIHQDbGABAIJAQHYGYCCIIJIEIEAJaIQBQBIGQDKHAAAFAEAJAJIARFYGYIZBQEKGQDQHJFAGYEYCQEAHIFIACIYJYBYBAIKJQGQEZBAIAJKASFYGQEQFQHaCADABABYEKBQDQHJFABY', 'GKUCoGNBYBZBdBaDDGrGAIAAGQAYCYFBGJGAIABKDQEQBYIYJQHaAAGYFSCIAIGIHIJIDDEYEBBZIZFZGRCRAICYCCGBCQFJBJIJEREIDTJYCYGYAQHJJADAEABZGYAYFCIIIQGQGJCRCYAYGAIABKCQDQEQJQHaAAAIFAHIJIDDEYEBCZBZIZGRARAIJIEICBBYGYIYGABK', 'GLEBACTBYBlBREUEjEBGJGoGAIFQIIJIBIDCFYCYGYARJICAFIDSBYCYCAFAJYABGIFIDIBRCYDCFYFQDQGYARJIDICICQIZBAJAAAEAGAHAKKFQFYDSGYAYDAEBHIDIFIBRCYGYDBHYERAIDIGICIBBFYHYDRAYEBDIHIFIBRCYGYAYEYDBHIARGICIBBFYAYHYDREIGICIBI', 'GLEBhGABFBDCQCcCUDBFZGpGFQGIBIJIKIFICTIYEYAYDYHYGCBIJIKIESIICDFYEYBYJYKYGSDIAIHIIICIFCEYCTIYAYCADYHYGCBIJICIEIFSIYCCBYJYGSDIAICIIIFCEYBYJYKYGYDTAIARCJHBGBDYARCRHICAIIFIECBYKYDYGRCYACGIDIBIKIESFYIYCYAYGBDIAS',
  'GLIBNCDBTCUCYCEDREhEAGrGHAIAKZBREQGRCJJJAAFAKYDQGYCQGADAKIFQAQJZGACYBCDAEICSDIHIAIFBKYCYCADRKIFRAYHYCBCIHIAIFBKYDYEYBSCIGIHIAIJIFAIYARHZDBEBKJDQEQIQFQJYGYCAGQJJFAIAJYKZDQEQGQCYBCEIDIAIIIKIFSHYGYJYCYBYECDIAI', 'GLIDgGNBdCoDTEjEAGKGQGYGCAHJAAIZFAGAEKBQDAKQJQIQAQHZFAGAEABKKQEaGQFQHJAAIAJAEAKABaGQEKJQIQAQHZFAEAGABKKQJQIQEaFQHJAAEAIAJAKABaGQFQEKAQHZEAFAGABKKQJQIQAQHQEaFAAKIAJAKABaGQAQFQEKHAIAJAAaGABKKQAQJQIQHQEaFAGAAK', 'GLUBhEDBYCSDsDEEIEAGZGjGAIEIFYHIDBBYJIKYAREICQIIDABAFaKQJQEQEZABEIJIBIKIFIDSHYCYIYGYGQIKCAHABADAFAKaJQAQFJBQCQGICIHIDBBYEYHQIZGAAAFIEQCQCIEAFZAQCQGQGYIJABCIEIFIBIHABAFaEQEYCYARGIBIFAEZBQGYABCIBIEIFIDRHYGYAY', 'GLgEJGABSBdCbDrDMEQEDGiGJZHAFAFIDIIICRBYJYDBFYFQDQHQJKBACAIAAAGaKQAICRFQIYDYHYHQJQBKDAEAIAAACAGAKZFQGKAQCQDQIQBaJAHAGAFAKKAQGZHQJQBKDAIAGAAAKaFQHQGJDQIQBaJAGAHAFAKKAQCQDQIQBQJaGABKDAIAAACAKaEQFQHQBQGQJKDABY',
  'GLrDDGUBlBNCBDLDSEYFIGiGFYBYEADAIAAaKQCQHQGQGYCBDYESCICAGJHAJJIAAAAJIRFRBZJZCZGBDBEBAJHQFJIAKZAQAYDRERGRCJBJJJIBHZFRGZDAFAAAAYKJDQGJFAAAHQAZFRAJGZDAFIHAKZFQDQGJAAHJIRBZJZCZGBDBEBFIFAKKIQAZHAFZDRKYERGRCJJJAA', 'GMADcEEBFBIDQDUDaDpDYECFrGHQIYKQAJEAFAJAIALaBQGQCQDQAJKAGZBALKIQHZGQKQAZCADABAGJHJIALaGQHJKQAQEJFAAZKAIJJQAQFQEZKAIAHZGALKJQIZKQEJFAAAIAJALaGQBQCQDQEJFJAAIAJAHZKQIJAQFZIAKAHJJQAQFQIZEZCADABAGALKJQAQFQIQEZKAAJ', 'GMDGjHVBYBBDMDTDhDJGQGaGoGEYAYIYFYCBGIKYGQJKIQEQAZFAEKIAJaCQEQFQAKIAJADAEZFQJJDAKYGYCQJIEAFZGAKJDREYJYCAKIFQEQJZGAEKJQIQAaCAGAEAKABALKDQHQFQJQKaCQEQGQAKIAKAJADAFAHALaBQCQEQGQAQIKKAAaCAGAEABALKDQHQFQJQAQGaEAAJ', 'GMDGoGCBUBYBADSDIEkELGZGhGBIDIEQGICQKIHQFQAaJADAKICQFKCAHAKaDQGQFQJQAKCAHAFaGAFIKJEBBYLYIYDRKIFQGZKADAIABKLQEQFQGQCQHQAaJAKADAIABALKEQFQGQCQHQAQJaKAAKCAHAEAGAFALaBQDQIQAQKQJKCAHAAaDAIABALKEQFQGQAQCQHQJaKAIAAJ',
  'GMYBdCLBMBcBhBFCDDBEiEQGZGAQEQIYHYDALYCQCIKILIABFYJYEYCRDRHIIIABKYLYDYCCBYGSCIBBEIDRBYCYHIGBEICSBIIIAIKILIFDJYKYLYDBCZEZBRGRHRIJDBDYEDCIJIKILIFTAYDYEYKYLYCDJIFIKILIATDYDREZCZIZHBBBGBJJFJAJDRDIETCYIYKYLYFDAIAB', 'GNAEZGNBQBgBhBiBcDjDDGKGSGrGIIJYCALYHABJFAGAMZIQBQHQHYCRJIKIAIDBLIFAFYGYBYCQGALIGIFIEBBZMYIYIAMKBQEQFQGQLaCAHAIAMABKEQFQGQLQAQDQJaKACAHAIALKEAFAGABaMQLQCQIQHQKQJKAADAEAFAGABAMaLQBKEQDQFQGQAQJaKACAHAIABALAMKGQBY', 'GNTBkDNBSBICJCcDgDoDiEAGDGKGBQGQAICQMIDAJABZGQAQCQMQLQKKDAEAFAHAIABZGZAQMYCAAIGIBIJIHIIIESFYDYKYLYCBMIHAIABAGZJQIKHQIYMZCRKILIDIMIFIECBYGYHYJYAYCRIIJAGJBQHQEQFQMIDQKaLAMAIAIYCBAIJIDRMYCAAADAGJBJHQEQFQMZIAJABABI', 'GNcBCDBBNBYBdBACECRCaCbCsDKEDAEQFAGQIQCQBZMAJAKALZAQAILIHRMIJBIIEIGRCYECIYJSBIEICIGCIYCSEYCAJBLZHQKQMQBJJACIERGIICEYCYLYJSBYMYHCKIJICIEILIISGYBYMYJCCIEILIIIGSMYEBCYJRBIMAGAIALZJQEICBJYKYHSBIEICIJCKYHYAYEQFREIAC',
  'GNkBAEKBQBUBFCdCgDiDoDqDDEZGCAMAIAHJDQHYIYMYEYEQMJAAKIJIDQIYIAHAHYJAKZAQEQMQIKHADAIYKYMYABEIJIJQMQIQIYAYEBJIKIDQIYCRLYEBAICIHIIIDBKYJYARERLIBIDBIYMYCQHIIAMAKAJZCQCYAYERMJIQHZMAAACAEAJKKQIQHQMZAAEAJAKKCQIQHQMQBQ', 'GKABcCiBjBQCBERELHoDDGBIDADICIGQFQIIEQAQJaHABACBIKGQGIEIASFYAACYCAGAIZBQHQJKFAEAIZGQCQFIACEYCYGAIKCREQAQFQJaHABAIIGQFQFIAIEBCYASFYFAGAIZBQHQJKEACAFAABIZGQAICIERFYABGAAQIKCQEQFQJaHABADAIIGQAQAIFIEBCYGYARDYBY', 'GKYBcCFBjBACUDhDoGCHRHBIDIDAGIHJAQAIESIZCZEAFBDBDIGIJIABHZAQGQJQCQCIIIEBAYJYCRDYBBGIHIJAHAGbBRDICBHIHQJQJIAIAAERIYCYDYFYBCHIGIJIGAHaJQCQCYJAHKEQGQAQCQIQIIECAYCYFZDAJYBRDIIICBAIESCYABFYIAJYBYDSIIAICIFIECJYBY', 'GLABUCQCVCZCBDRDEEaEJGrGCQAQGIEAKZBQDQHQFKJAGAGYHYJYFYDCBIIIEIKICICAKZARGYIQHQFQJJGAABFZHAIAKJCQCYEYIYKYBYDSHIFIFQJIGIGQGIJaHABAJIKIEQAICCEYKYARBQFYGYHQHYDCBIIIAIKIEICSGYJYHAFJABEAIYKYBYDSFIHIAIAAFZBAKIEQFZAQ',
  'GLBDgDlBACNCpDrDTEJFDGiGDQAYHAJYEACAGIFIBQKZCZGBFJFABLCQGYKQDQIQAQJZHAGACAFABAKKIQGZHQJJAAGAIAKaBQCQFQHQGJAQAIJZGAHACAFABAKKIQAQJQGaHAAJIAKaBQCQFQAQAIHQCAGKJADAIAKABbFQFZARCJKJBAFZAZCQEQHQGQJKDAIABAFAAZKQFKAA', 'GLEErGCBhBiBDCADUDaDcEIFCQDYEYIQFQGJKAEABZJQHQAQGJFAHZJABJEQHZFQGZAAJAIJEIEABZIQJQAQGJFAEICRFYECCIEQHIHQFQKQGbAAEACAJAHKFQEYCBFIESCYCQGJKADABYFQCIEBDJKRGZCAEADAFAKABAIbHQHZJRARCJEJGJDAFAKABAHAHZJZARCREIFIFABJ', 'GLFBQDABYBKCVCBDDDhEjELFDQBQCQCIFQAQGYEABIDCBYHIIYESGJCADABABIDRCYBADICRBYBAEBIICRDYEYKYAYFBJIIICIDREYCCIYJYFRAIKICIEIDCIYCSKYAYFBJICIIIDSEYKYCCJYFRAICIKIEIDCIYJYFYASCICQFBJIIIDSEYKYFYCYHQABJIFRHYABCIGIHQGQBK', 'GLFBYCDBEBIBSBjBBEhEkETHEAFYKYARDICIHIEIBCIYGYJYARKIGBIIBSEYFBGYKYABJIIIGRFREIBCGYFRKYAYDRCIABKIERHYAYCYDBKIEIFBGIBSHYEBKYDRCIAIEIHIBCGYIYJYDRCRAIEIHIFBKYERAYCBEIKIFRHYAYCYEBDBJIIIGIBSHYAYCYEYDBKIARHIBCGYFRAY',
  'GLFCIGDBRBaBMCTCYCkEAGpGFAIAKJEQEYGYCSBICAJIHCEYEAKaDQIQIYASFIBIJIHIECDYHRBYJYFYFQJJABIIKIDQERBYBAEADAGAKYCRGIHIDIERBQDAJaAAFAGACAKIEQDYHYCYCAIAIYASFIGIBIDAEAKYIQCIHIEIDRBYCBDAIAKJEQEYHYIYKYAYFSGICIAABIKIHQBQ', 'GLIBVBRDYDDFAGaGgGjGoGrGBBCAGIBQDIDAGaEQFKAACADAGAHAIaEQDJCQFZBAEIGIHIIIASFYDACJGYGAAAHAIAJAJIKaAQEQBQHYCQDQFKGADaCADIHJABIYJYEYBSHIBADQCZFQGKAACADAHaEAKKJQIQHQAQCYDQFZGYBCEIDIFIHIIIARCRFZGZBZEBHJIJAJCRDZAABQ', 'GLICKHBBRBgBNCbDpDkEDGhGAAEAGYJYFAIAHKKQGQGYIYKYHYFSBIDIJICIAIAQECGYDQCQERJaBAFAIAHAKKGQGIERAYCYDBGBHZIQKZFQBQJKAACAEAKYIQGJDQCIAIAQECHYDQCQERJaBAFAGAIAKKHQHIERAYCYCRGZGACADAHAKZFQBQJKAAEAGACADAHAKYIQHJCRDRBZ', 'GLJBFCSBiBACTDYDgEbGjGCHAAJQIQFQFICIGIGADAHAJaIQFQCIDIDAHIERAYFYBRKYCBCIDIDBGJHAFZGRDRHIKIAIAREBKYCYBBGIFIAQAYFYGYBRHYDYCRKJHBFBAJERAYGYCQHYKYBBCIDIDQFJAAAIGYDYCYBRKIABFZCADAGJFRDZARAIDIHIEBFYFAJAIaGQGIARCYBY',
  'GLMBRBiBjBFCICSEcEgECGJGHQJZAAGICBDYHYESAIJJKIBBCYDBIIFRBYJYKYAYECHIEQIICRDYGYARJJKIDBCBIYHYERKIDIBIFCIYHYARGIDRBICBDYGYABHIIIFSCYBYKYEBHIIIDRBRJZKYABGIBIDBIYHYERAIJIKICIFCIYBRDICRJYKYAYECHIBIDRGYARJIKICBGYAY', 'GLUBYCbBhBkBDCVCqDEEJFAGBBDYGQHYCQFQKIBADAHYCYEYARIQKJJACACYEYEAFRHIIYGBAIFIEICIDIBSJYCCEYCQFYAYGRIICIJIBCDYEYHYFYCSIYGBAICIFIEIDIHIBSJYIYCCAYGRCIIIJIBCDYEYHYFYAYGYCSIIACFIEIDIHIBSJYAYIYCCGIFIEIARJIBCDYAYDQBQ', 'GMBCbENBECaCdCSDYDgDoDrDCEAYCAGYLYDYCYFCBIKIEIHIIIJIASGYLYDYECBYFRCIEIDIGILIACHYIYBYJYKZESCYFBEIBIHIIIKIJIASGYLYDYCYFYECBICSDIGIKIJILIACHYIYIQHQGQGYCYCAHJGQCYHAGJCQCYGYHYHAGAJAJYBYKZESFIDIHILIAICCGYJYBYDSHILIAI', 'GMECoDYBlBCCDCRCaDcDAEiGqGAIFIEIJICCGYHYHAIaDAKYDYASFIEIJICIGBKYDYDAERKIGRCYJYDBDIHIIIJICICRJZDZEBIIKICQHYEYFYACKILIBIGQHYDSHIJIGCBYCYDYKYLYASFIEIHIJIDCCICAKZIQHQHICIDRJYEYFYACIIKIGRJYCBHYIAKJLIBIBALaKQBKHQIZAQ',
  'GMQBBDABbBFCMCaCdCDDgDrDJHFQJQAQAICSLYIQBJLAAACAGAJAKaDQFQGQIQIYFBDIGIJIKICRAYIYGBJIKICICAKZAQIYJQGQGYFYDCJIJAKKCQGQIIAACYGYJYKYDSFIIIGAJAKYDYFRIIIAJADADYFYHYESBIIIJJFCDIGIKICICBKZAQCQDQFQGQLQBbIAIZJBHBDIFRLIAB', 'GMQBlBABECFCJEcDgDBGZGiGoGFILJHQAQCQCIACJYGYKZGQJKKAHALZGQHKKQJaBAHAGALKKQGaHQGIJJASCYFYIYDYEYBCJIGAHZLAKKAQGYHQJYLZBSEIDIFIIICAGAAAHYJYBYKYESDIFIGIIICIACGYFYBBJILIGRARCYFYBYIYDYECJILIGIGALaJQDQEQGIIJFAAICRFYBY', 'GMYECDjBACBCSCVCTEEDKDMDsDAQDQEQBZJAFACYHQKYKQIQIYGBHICICALZFQHQGQJJBJDAEAAALZCQKQIQBQBIJZGAKICALJAQDQEQJZBAFBCYIAKYKAHAHYLJCQFQBYGRIIIAKAHACIFRKIBQIZKABJFBBYCYHQBQKQKYGBHICICALZFQHQGQIJJJDAEAAALZCQBQKQJQJIFBAI', 'GNJBoGFBlBICDDZDgDAGKGTGbGiGBJHQKYCQFIIIEAGYGQEQIYFYCALZDBBIHIMIGIERAYJYKYDYDALJCQFIGAHAIIAAEABaMQHKGQLZHAMABKEQAQGQIYFYCAMZHQDQDIJIKIAIEBGYBYMYHYDRLJCQFIIIEAMAGABZHQGKMQLaDAGAHABKMQLQEQGZHAIYFYCADABAMKLQBaHQGJAQ',
  'GNhBDFSBgBiBFCdCADQDYDbDjDIGLQKQBQHKMACAEAIAJAAALZKQBQHQMJIAJAAAAYEYCRJIJQIQIIMZHABAKALJCQEQJQIQMQHaBAJJCAEALZKQJQBQHKMAIACAEAJZBQIJCAEAJALAKZBQIQHQMJEAEYCYHYIYMYFYGCBIJIKILICSAIAADBCYJYKYLYBYGSFIHIIIAIMIEIDBJYAQ', 'GKFCgEdCADYDIESECGKGiGGIJQGQIQHQDKFAEABAJZGQIQEKFQDaHAEAIAGAGYJJBQFQDQHZEADKFABADYJZCYASEIEQHKFAHYIZEQEYACCIDIGIGQEQEYIJFQHZDAIAEAGAGYCYASCADIJJBQFQIZDQHKIAFABAJZCQEJGBBJFRGZDZDQHQHYIKGADZEZIYACCIBIJJFQDQEZBA', 'GKZECDjBYCAEkEKHQDbDpDBJGIEIHIDCAYIICAJIAQHQEQBaGAIAFAJJAICQDSEYHIHAAACAJaFQIQHJCAEIDCAYJYFZIRHRCJFAIZHQFIFAHAHZCRFIHAIAJKAQHZFYCBJIIQFQFYJAIJFQHKDQBYHAFAIZJQFIEQGYCBFIHIEIEQHaFAJAIJEQFYCRGIBIDAHQBRGZCBFIHIAA', 'GLABFCJBECYCZCBDaDqDKEcFEAGICAFAIZHRJRGRCJAJEBFBIBHZJQIJERFRAZCZGBIBJBHJEQAQFQCQGZIAJQCJAJEBFBHZJQAQCQIQGJEAFAHBJZARCRHJEQFQGZIAHBABCYKYBSDIHIHQIIIQGKABCBFAJIERFYAYARGZIZHBKBJJARAIEIFSGYIYIQGQHaCBABJYKABYDSKIAI',
  'GLADoGNBQBdBIDbDjDRFrGCHCADQEAGAHAJABKIQFQFIDBIYBYHYJYERCRKIAIDAFAIABZGYCYEBJIJQCQEQHQGQKQAKFAAYKYECCICAHJGQKQAQAZFJAAKAGAHZCQCYESKIAQFZKACAEAGAHAJAJYERBJCIGIIQAQDQFYKYCBGIAIHJAQGaHAHYCRKIFIDAGAIABZHYCYEBJIJQAQ', 'GLBBdCbBCCICcCgELHEDZDqDAQEAJYDRIaDAHABACAFAKJGJJRARAYDYCYCAGAJJAQDRCYEQGAIYHYBBJAKZFQFIGIJIKIDIAIAADAKaDQJQGQHQIKEAAYCRHYIZBYFCGIJIDICIAIKIESHYDCGYJYFSBIDIHIECAYCYGYKYJYDSBYFCDIGICIAIJIKIESHYBYFYDCGICIAIJICQBQ', 'GLBCMEABQBcCdCiDqDSEgECGAQIAGAKYBAEAFAHJJJDRDICTAYAAGZIYJAHZEQFQBQBYFCEIHIJIDICIGIASIYKIIAGACAGYDCHZJYEYFSBIKIDAGJAAHYJQGQBYDQKYFCEIGIJIHIAQIQKZBAGAJAHJCQDSIIABCYDYHYJYEYFSBIGIIIAICCDYARIYBYGYFCEIHIJIAIDICSIYAB', 'GLBCqDMBNBACcCdCoDCFYGgGCADAFAGABJHJJIKIESAYIYCYFBJIKIEIASIYCYFYDYGBJIKICSIIACEYCYJYKYGRDIFIIIAIECCYHZBZJYKYFSDYGBFIDTIIAIDAEICCJYKYDYFYGSIIDCJIKICSEYAYDYIYGCFIBIHIJIKICIESAYDYCAIYGYFCJIKIHABZKQHKCQCIDSAIECDYAR',
  'GLBDUDKBaBhBlBYCIEbEqGDHAYBYEAFBJIDQCQKYFBBIIICICQBZDAJZIQFRBIKIAIHIGCEYDYCYJYIYIAJKCQDQEQGQAYHQKYFBBIIIHIDCEIGRDYECCYCAHQBZJZIQFRBIKIAIDAEICBGAHYJYIYIAJKGQDQAYHQEQKYFBBIIIEIEQBZHAJZIQFRBIKICICABZEAEIBIDIHIDRAR', 'GLCDbFABBBECFCdCQDYDKEgGIIKQIQHQDQHICSAZDYJYEYFYGCBIESJIDICBHYIYJAEAEYBYGSFIJIJQAKDAEBHICQDYEYAYJYFYGCBIHIIJERDICBEYHYDQIYBYGSFIJIDICIEBHYIYDRJYFYGCBIDIHIIIERCYJYDBBYGSFIDIDAJICICQAZEAIYJABAKJIQHQCQHYBYDSJIAIAQ', 'GLJBECIBbBcBdBFCYCKEZFrGAACAHAIADAJAKaEQEYFYGSBIFCDIEIJIASCIHBAYCSIYCAFYDBEBKJAQAIHSIYFYDYEBJIFSIIFAHCAYCRFYJYESDIIIFBCBKYCQEQDRIIFIHIADCYCQARHRFZIZDBDYEDJIHIAIKICIFTAYABCBCYHYJYKYETDIDRIJAJCBCIFDHYJYDYKYDRIRAJ', 'GLYBTDEBJBKBACFCZFcEBGrGAQFQIYGRCIJYBBEJDJHBKZGQCQBIHQJIFAAAKYIQDQEQJQBaCACYGCIIDREYCRGQBKCAJAEADAKIAQFQJYBYGAIAKJHQEZCZDBIYGRBIBQJKCAEAFAAAHAKaIQDQBYDIGAIIHIAIFREYACHYDYIYGRBIDAGAIAKKFQEQHQAQCQJaBABYGBIIDRCJAJ',
  'GLcCADLBhBCCdCIFMEaDiDDGDYJQIQEQIYJYCSEIGIDCIYJYCYERHYKYFCAIEICICAIIJJDSGYHYEBJIIQCYJAIJCQCYIYJYERHIGIDCCYCAIZJYEYAYFSHIEBJIJQEQGQKIBIBQKaHAHYFCAIEIEQGICICAIADQBYJZGQHQHYECAYFSEIHIBIDAHAGAJJAAIQCQCYGYAYFYESHIAB', 'GLdBiBNBMCaDjDYEAGDGrGJHGQEZBAKYDYCYABCQFIAQDQIQHKKAEAGAJaDQFQCQEKKQHaIAEACADAFAJKBQGQKQHQIaEAHKKABAGAJaDQFQAQCQHQEQIKKAHaABCIDAFYCQAQAYCCFIFAJKBQGQHQKQIaEAAAEIDBHKBAGAJaFQHQAQCQDQEQIKKABAGAHaFAJKHQBQGQKQIaDABI', 'GLkDAGIDKDQDoDYEaEMFDGqGEJGAFAKZAQIQDJEAHAFJGQCQEZDZIAAAKKGQCQEQDZHACJGAKaAQFJCQHQDJEAGACZFZAAKKCQFZAZIQDJEJGAFACAKaIQDQEJHAFJCAAZFQHQEZDAIAKKAQCQGQEZDZIAFJCJAAKaFQCJAJGQEQDZHAAACZFAKKGQAZHQDJEAAAGAKaFQIQDJEJAA', 'GMAGqGLBMBYBlBcDoDDGZGiGIHDICILIEBJYGYKZGQJKKAHABZGQHKKQJaFAHAGABKKQGaHQGIJJERLYCYDYFBJIGAHZJQCQDQFQIQAKLAEAGAHAJaBAKKJQEQHQGQLQAaIACADAFABAKAJKEQHQGQBaCQDQFQIQAKLABAEAGAHAJaKQCQDQFQBKLQAaIABACADAFAKAJKEQHQGQLQAQ',
  'GMCDjGVBADIDQDsDEEKEYEaGoGBYCQGYHQAJIAFJJABZGALKBQGaKQFQIQDJEAJAFZKAGKFQJQEQDZAZHACAGIFJJQEQDQAZIAEKJAFZGZCQEIIQAJDAJAFAGZKQFKJQDQAZFYIAFAKAGKJQFZIQAJDAFAJAGaKQIQAQDJFAAZIAKAGKJQAQFQDZIAAJJAGaKQAQIQDJFAJAAZKAGKAQ', 'GMKBjDDBACBCVCaCTDbDrDEEgEAAFQGAHILAJaBQIQCRAIGBJILIDSEYGYAYCBIABAJJLQGQIYGAIABABZJBLJBRJZJQIQIYCRAIGIEIDCIYJYGRAYCBHYFALABKJQJJIRDRERAZCZGBKYFBLIJBBZBAILBQBZJRGRLYFRKICJAJDBEBBBJZJAIbFQHILQCRAIGBBIIIJIDSEYGYAYAQ', 'GMNBCCDBIBMBBCTCdCEDrDoGYHERAYHBJIGQCQIYHAEIARCIGBJYEQHQIIGALIDRFYBYGYCYABIYHAEAEYHSAIAAEBHAJIKILIDIFSBYGYCYEYIYAYAQHBIICALIDIGRCYIYAADBLYHRAIEIDIIICICQGBIYLYERAYHBEIASDICIIIGIBIFCLYAYDRCIABLIFSBYGYAYAACYDBLIGRAY', 'GMpDDGACRCYCdCBDUDiDrDSELGIILZHAFAJIAIKIDIEIEAAZCRGYJZLYHYFAIIIQFQKQHQLKGQBaDALAHAKAJAAJCQEQGQJIDQHaDAKAJAAAAIDRIYFQKIGJHQBQLaKAKYFCAIFQGIDAIYAQJQGQJIKQLKBADAHACAEAIZAZJQGQGIAAJZGQFQAIAAJAIJCQEQHQJIDQBQLaKAAAKIBI',
  'GNrDEEVBcBlBACRCTDaDiDBGJGoGFRHYDAKYLYBYCBEBAIAAMKFQGQHZIAJAAZDQIIHIMYERCRBIKILIFCGYAYJYDYMYEYEAMJAQJQHQIZDAEAMAAKJQAYMZCREIDIDQIJHAMAJAAZDQDYCYERMJHQIZMACADAAJJQHQIQMZCACIDIDAAAJJHQAZDQDYCYCQMJIAAAHAJZCQDQAKIQMZAA', 'GJQCDFCBlBRCcCoDAEaFBICIHIABIAGJEQEYIYCSBYDDFICIFAGJIQIIEIASHYBYDYFBCIDSBIHIACEYIYDYCYGYFSBIHIAIECIYDYCYCADQCYGBDJCRCIGYGAIIESAYGYHYCDIIEIASGYHYCYBYFCDIIICTGIHIACEYCYIYDYFSBIGIHIAIECCYASGYHYBYFCDIIIAICIESGYAA', 'GKADhGcBDCYCsDREEFIGpGCIDQEAJYFYCQHQALIAGAIIEBBYBAFAFaJJFQBQBJFBBZFIEQIYDAJZCZCAJKBQFQFYCYDRHQAQIKDAEAGACACYFJCQCYFYDQGRAaDAIZHBFKFAJABKCQEQGRIYDAFaDQFAGAHQIKAAEACABaFAJQDQHQFKARFaDAHAJABKCQEQGQAQIaDAHAAKGBJZAQ', 'GKADpGECFCKCYCCDhDIEbHBJHQEQGQAJIAEYFAHYBYJYDSCIAIGIIIFBJABAHKEQEYBYHZJYDYDAHKBQCRGIJQIQIIFIAYECBYGADAHYJYHABKJQEQFQAZGZDAHAHYDRGJGQALEAFAIAHAJAJIESBZDQFYIYAYGYCBDIBIJIEIEABZFRIYAYGYCYDCJIJQHQHJGRARIJEBFBBAGZAQ',
  'GKYCbFABdBBCFCpDKEZECGCQDQFQHIJIEICIACGYIYESHYJZFAFYDDBIEIGIIIASCYHYJYECBYDTFIEIHICIJIACGYIYBYDYFSEIDDBIDQGIIIASCYHYDYEYFCBIDSHICIACDAIYDYBYFSEIHIDBIIASCYDYHYEYFCBIGIIIDSCIJYABDYGYIYBYFSEIHICIHABAGJIQAIDCIYCSAI', 'GLDBYCEBFBRBSBhBiBjEAHTHIIHIFRKYDRCIAIJIBCGYFYHYIYDRCRAIJIEBFBGIBSEYFBGBHYIYDYCRARJIFIGBKYAYCBDIARKIHBIYAYDYCRKIFRGIEIBCIYFRKYCBDIAIFIIIBSEYGYJYCBDBAIFIIIHRKYFBAYDRFIKIHBIYAYDYFRCRJIGIEIBCIYAYDYFYCRKIABIIBSEYHBAY', 'GLEBACYBBCVCTDbDCEZEjEoGEBGIJIIICIKIBSDYCCFZIYGYGAJAJYKJERAIHICIIQFQDIBCFYIYCTGYCAHYAYEBJICIFIIIBSDYGYHYCCGJJYERAICIHIDIBCFYGYIYJYCSAYEBCIJIFIIIBSDYGYHYAYEYCCJIASGIHIDIBCFYIYAYJYCSEIGIHIACFIGYIIBSDYAYHYEYCCJIFIAR', 'GLEBaChBFCbCIDsDKEQEcEBGAQCYKIFAIABYEYGYJYDSAIHIIICCBYEYGYJYDYASHIIICIKIFIBCEYCSIYCAHYACDIJICIEIBSIYCBJYDYASHICIIIBCEYJYCRHYACDICICQJIEIBSIYHYAYDBCIASHIAAIIBCEYJYAYCYDRHIABJIEIBSIYAYHYDBCIJIARIIBCEYAYJYCYDRHIIIAB',
  'GLIEpGkBFCYCDDcDKEAGZGhGHIAIEBBYKYCYGRDRFIIIEAJYCACIGYJIEQIYFYDBCIGABKJIKQGaJQHQFQIJEAGAGIJZEQIZFAHAGJGQHQFQIJEAJAKABaCQDQGQHQFQIIAAFZHBJJKJERAYIYDACAGIJYKYCYDRIIAIDAEBJYKYCYGABKKQJQEQFQAQIaDAGAHACABAKKJQFQAQFYBY', 'GLJBrGKBVBBDLDTEDGjGoGYHAYCYEYFYHYDBGIFQHQEKAACAFZGYDRHICICQEZHADAGAIABAJKKQIaDQGQHQEKCACYEZHYDBGIFJCQIIAREZHAFAFICIEQHZFACIEIAAEQIYCQFQFZCBGYDRCJFJEAHJAAIAKAJaBQDQGQIKEQEYFZIYCQHIFAIAEKIYKAJABaGQEQCYDBEIGIJIKIAS', 'GLLBQCKBhBiBFCcDAECGZGjHAIBQCIHQHIBCDYEYIYAAJYGYKYFSAICICAGAGIHIJJECDIBSEYHYGYIYCYAYFCJIKIDIBIESHYDCJYKYFSAICIGIDIDAHIECBYGYJYKYFYATCICRDJGBFBHIEIBBKYAZCRCYDTFICCDYFRCIDCAIKIBREYHYDYACJIKIBIESHYDYAYCYFCJIKIDSAYAQ', 'GLNCZETBlBLDjDrDAGDGoGIHBYCIFYFAGAGYCRFIFACAJJBQKQHQIaAADAEAFACACYDYASFIFQEQIKHAEaFAFZDBDICICQFIFQEKKAGAGZCZFRERDZABDIJIAQCQEYDQIQHKKAEAGJBBCZFZDQEIFQGQBICBFYGZDYJYAQEIDAGKFAFICRBYDYEYAAGAFJJIDRBICBDZFZFQBQEZGABJ',
  'GLbDpDABdBBCFCYCKEZEjECGCQDQFQHIKIEICIGCBYIYESHYKZFAFYDDAIJIEIBIIIGSCYHYKYECAYJYDTFIEIHICIKIGCBYIYAYJYDYFSEIDDAIDQJIBIIIGSCYHYDYEYFCAIJIDSHICIDAGCIYDYAYJYFSEIHIDBIIGSCYDYHYEYFCAIJIBIIIGICSDYDACBGBBZBAIQAZEQKIGAAY', 'GLgDAGDBEBJBFCICSDZDoDbIAIDQJIGREYHYCQBJEAEIGCAYIYJYKYFSDICIDAFAHIEQBYCAHAKAJLAQAJIREREYHYKYFYDSCICQBJFAHAKAAAAYJZDQJIDAJAILAQAYJZFQJIJQKQHQBZCACYDCFIHIKIEIEBABJZJAIbFQKQCQBIDQEAHQHYCYDYFCKIAIIIJIGSEYEQBZCADAHJAB', 'GMACTFBBKBdBFCRCaCLDoDsDCGARCYKYEQFQLIDADYLYFAEAHBKIJJAQCQGQDQLZIABAJAJIHRDICIKYEQFQIILIACGYCSDYHBCIGIASDYGBCYJYLYIYFAEAKIJQBQIQLJDAAAGACAJZHRKYEQFQLIGIDIABCYDSGYHCDICIJIASGYHYLYDBCIFAEAKIJIAIGSHYACCYDRJYKYEQFQLIAI', 'GMCBYBABBBlBNCcCTDoDDGQGZHHAGAIKBQKICRDYAYJYFAEAIILQKQAQAIDIDQJZCAHAAIDICIBCGAKYLYASGYEYEBFRHIGAAAAIGSEYABEAGAIYFQAIGIKIEQHYAAFAIILIBSCYCQDYEYHQJJDADYEYEAHYKALAIaGQIIKIEQJYAYFBGILIBICREQEYBCCICAIZEQDQJYLQKQHQAYHIBI',
  'GMYCLFaBhBlBCCJCNCADEDjDqGABDYJYHAEALICQCYLYEQFRHQJIIJAADAGACALZKQBQIQIIFBCIDIJYHAEAKILIASGYDCCYFRDIGIACCYGRDYIYLYKYEQHQJIIABAKALJCQAQGQDQIZFBJYHAEALIGICIARDYCCGYFSCIDIIIACGYFYLYCRDIEQHQJIIIAIGCFYASDYCBIYJYHAEALIAI', 'GMjBADTBJCKCCDEDpDsDUFLGgGDYEYCYABCAHYIZAQJQKQGQFJBJDAEALAHAHIIZAQIILIDSEYCYBQCAFZGAKZJBAJHJHQLQKQBQCQFQGaJAAAHIKILICRBYFYIIJYACKILICIDIESBYFYCBKYLYASJIGIFABADAIYHYAQKICQBJDAEBLZHAIJLQCQBQGQFJDAEACZHZKZAAIILICQKYAZ', 'GMoDIGDBVBbBcBQCRCaCEESGrGBADQGAHAAAKIIBLaDQEQFQKQCQJQBKGAHAIAKaEAFALJAQKQGQHQIQBaJAFAFIEICREAJYCAFBDBKKAAAILZKQCQDQEQFQJQBKHAIAAALAKaCQEQAJIQBYFADAEICIKILIGRHYIYAYJYCCAIBYKILIIRJYCYFYDBEBKILIIIGIHSBYCAAAJYAYFRCIAA', 'GNJBLGIBTBUBVBKCADDGgGjGoGrGAQCQHQIaBADAEAFAKAJKAQCQGQHQIQBaDAEAFAKAJAMALKAQCQGQHQKaDQEQFQBKIAKAGAHAAACALaMQJQDQEQFQKKGAHAAACAJaDQEQFQKQBQIKGAHAAACAJALAMaDQEQFQJKAQGQHICAAYGYBYJYKYFCEIDILIAQCQHYIYFAEBDILIMJAQAICSGYAC',
  'GNJDZENBdBjBQCRDbDoDsDLEAGDGAYIIFQGYKYCYDBHIEAJAIKBQEQHaJAJYDRCIKIAIGIFBBYEYIYDQCQJQKQMQLKAAFAGAHYEBIYJYDYCRKIEIGQAQHIFQLaMAKACADAIJJQEQKYCBDIEIJAIZDQCQEQKQMQLKAAAYLYMZCBDBEIIIJIBIFRGYMIGAHABAHYIZJQKQMQGKAQLZGAMAHKAQ', 'GLBDgDEBUBACFCdCYDSEJGiHBQHQEQAYIYDYCRJIJACADAIAKABKHQBYKYGYFSJIAIEAFBKYDRCYGBBJBAHLKQEQHYIQAQJaCADABYFRGAGICICRAJIAJJEAKAHaBQBYCRDIKIERJZAADADYCCFYGSCIFBBIFQHIEQIYDYAQJKDAIAEAHYBYFQAQAZCZFBGBBJBAHLEQKQAQDQIQJaFAAJ', 'GLBDgGDBdBjBACYDJEEFaGoGCQAIDQEIBIJIGIKIFSHYHAGAJZIQAJHIAYFCBYJYKYCSIYDDEIEBCJIRGJHQAZGBIBCZEREYDTIICCJIFQAYGYIADAEAKKBQFQJQCQHQGQGZCBCYIYDCEIEAIQJJHQCQAKCAGAFAHABAKaJQBKHQCQCYGIFAHYIYEYDRAIAQGKCAIAHIFRCYIYEYEBDZAR', 'GLBEoGaBACUDkDYELGRGbGrGHAEAIJAQHZEAIAJAFAKABKCQGQFbJQFIIQEQHJAAFAJaIQFKAQHZEAFAIAJKAQFaEQHJFAAAJaIQEQHQFKAAEaIAJKEQAQFaDQHAIAJAEKAQFQHaIAFKAAEaJQFQIQHKAADAEACAGABaKQJQFQEKCACIGIGABADQKaJQBKGQAQHaIACAEAFABAJAKKGQAQ',
  'GLEBIBDBFCJDsDYEAGjGpGSHIYDRAICIHIBAGAIZJYFYFAJKIQFaKQCQCYAYAQDBHIKIGIBREYEAFIGAFAIAJaKQFKGQEQFYHZAACAFAKAJKIQGQFZAQCQHJEAFAGAIAJaKQAQCQFJEQEIHZBAFAAACAKAJKIQGQEQGYKYDRFIHIBAEYCYAYFQHJCACYAYAAEKAQFYHYDBKIGIBSCYAYBA', 'GLEBjBDBFBaDcDkDYFQGTGAHBYGQFQEJBAEYGZFQEQJQDQIJHAGZBQFYJYDSAIARCJKJHBGBBZEZFZDZARDIEIJIGIBAFYEQGQJZABDAEJFJBQJYDYEAFJDQGQJJBAGYDYEYFYARJICQDADYEYJYAAFIGJDQJYAYCRIIKIHIBCDYEYGYJYAYAQJJDBEYGYAYFYCQFAJIAAGKEQAYEIDRBR', 'GLIBTGDBYCJDkDEEREiEAGbGFQIYKQBQCQGQJKAAEAHAIAFaDAKQBQCQGQJQEKHAIAFAKaBQFKIQHQEaJACAGAFABAKKIQFaCQGQJQEKHAFAIAKaBQCQGQFKCAHQEaJAFAGABAKKIQHQEQJZFAEKHAIAKaBQCQGQEQFQHIJJAIAQDBIYCYJZFAEAGABAKKCQHQIQAQDQJQFbEAEZGBHJAJ', 'GLTBACRDUDcDjDEEBGJGYGgHFIARFQEQDQCKJIJADbEAEZFBAJKJDREZEQJQCaFAFYABKIEIBRHYIYGYABJJAQCQFZGQHKIABAEYFACAJZKYASGIGQHQIKBAFACAJAEAEJDBKZAZGREJDJBQJJCQFQIaHAJAEADJABKIBRCYAYFYAADaEQJQHQIKAAFACADADYEaAQJQHQIQFLCACJDBAZ',
  'GLYDqDJBKDcDiDSEgEkEEFAGCYDYKICAAAHABZFQGQAJHABAFZGQEZJQKJDAAAEAGAFJBQHQEZAQDQKZJAIAFJBJHQEQAZGABAFZIQJQKJDAGAEJHAFZBQEQGQDQKZJAIABJEQGQAJHAFAEZBZIQJQKJDAAAGAFJEABZFQGQAQDQKZJAIAFJBJEQHQAZGABAFZIQJQKJDAGABAFAEJHQAQ', 'GLgBAGlBUDaDcDjDQEhEIGDHDZFACAEICQGQEQDQFQKQBKJAHAHIACIYIAGaEQDQDIIIARFYHYKYCCDIEIFIIIIQFaDADYCRKIHIABFYFQDaIAGJIIDIFIASDYGYHYKYCBIIFIFAGAEaIQIYCSFJDJHQKIJQBaKADAFAIAEJGQIYFQDJIAEAEZCZFRDRIJCBEIHIABGYAQEQCQHQJQJIAB', 'GLkBoDFBlBLDUDcDqDYESFAHEAIABAHZJQFZCQFICAFAGAAADAJAHLBQIQJQGbAADAHAJABLIQGQJQKQEaFAAAAYDYCRFIFQELAAKAGAIAJABbHQCQDQJQGLIABAJAHbCQDQJQGZFRERAJKJIBGZGQEbFACADAJAHLBQGQEQJQFbCADAHAJABLGQGJERFRIRKZDBCYDYCBHBBBGJJQHZAQ', 'GMAErGLBQBbBcBdBgBUDpDRFCGIAFALIAIDBHBJYBYGQFIEICRIYFAGABIJIHRDRAYIYEBCIKIDIHBJYJABaCQEQGQFQIJKAJJDQHQAQLaIAIYFBGBCIJIJQKQIQIYEBGYCBJIJABKDQBYHQAQIZKAJZCRFREILJIAAADABYGRKIAIHCDYAQDQHQIQIIJYLZHADAKAGAGYCYCABJJQAQJYBY',
  'GMBBdCbBCCICcCDDZDqDgELGTGAQEAHYDRGZDAKALABACAFAIJJJHRARAYDYCYCAJAHJAQDRCYEQGYJAHAIZFQKYLYBBFIHIIIJIDIAIERCYACDYHYIYJYFYFAIJBRHQJQKIGILIAICIECDYCSAYAQJAHALZBAFAHJCJARJYCBHZBQFQHQLJJAAAAIDIESGYJYKYLYAABBHAIZFQFICICRAJ', 'GMBBiGUBVBKCLCYCZCCDQDEEqGAYBIIYLIERJIGAJAEAHALaBQFQKYDBCIFIEIHIGIASIYJYKYDYCBFIDSKIIIJIACGYHYEYDYFYCSKIDCEIHIGIASIYJYDYKYCCFIEIHIDSIIJIACGYDYHYEYFYCSKIIIJIAIGBDYASIYJYKYCCFIEIHIAIDIGRIYJYACHYEYFYCSKIAIIIJIGBDYHYEYAS', 'GMDDgDFBIBJBKBVBaBkELFAGoGEQIYGRCRAIKIDAEYFYHBBIEQDQKYAYCBGBIIBIFRHYJYGYCRAIAQKKDAEAHAFABZJQAZCAGAIALKBQBIERDRHYAYAAFAJABABIEIEALaDQHQAYIQGQKYCAGIJIFIEBBYEQIYGRCRKIFAEIHIHQAQDABYEQFQKaCBGBIIJAEIEQFRAIJQKJDBHYAQDIHBBA', 'GMFCICRBjBKCLCcCdCDDoDAGgGCAGBDIJJLIBRCYEYFYGYDCHYASDIHBIIKICABAJZLIEQLQFQGQHQKQIaDAAAKIEALIJIBQCQIYKAFAGAJALZAQDQHQDYACHIDSGIFIEICICQIQBAKZFALYDYGRAYHCGIASFIEIEADAIIBAJYDYAYFSEIACDIDQAQJIBQIYAYEYEQKJFBDIIACALIBQCYAY',
  'GMIBcBFBYBECVCZCiDSEBGJGrGDQAQGAKYLZBQEQFQCQJJKAAADAGAHYIALYBYBAERIIGIAIAQDBHYDQGQKQJaCAFAIAEALKHQHIDRAYGYBYEYFYCSIIEBBIGIAIDBHYHALaBQEQFQIQJKKAAAGAHIDQAYGYEYIYBACBFIBIHILJGRAIDBGYASEYHAIYCYFBLIAIERIYCYBBHIAAHQBQHIAI', 'GMNBICJBgBECZCdCADiDCEaGqGAAGAIIJQHJBACADAFALZIQIIKQEQHIJQCIFBDILIBSFYDCJYEYKYGYGAKJJQCQDQHZEAGAKAIAIYLJJQKZASGIEICIDIHIFIBCJYIYAYKYCQLYGSEIACCICQAQAYEYGCCICQGQIIKJJALZIQKQAQEQHJDAAYDIDRHZAADAEAGACAKAIALKJQJIBSFYAYAQ', 'GMQBMCFBRBaBgBhBVCAEKEjECGEQHQCQJQLIIIABDYJYBYCYHBKIEIGIFIDRJYGBEYKYHRCIBIGIEBGAKYBRGIEIJIDBFYKYERGYBBEIKIFIDRGQJYGYBYECHYCSEIHBKIGRJIARIYLYEACBKIGIFIDIARJYFCGYKYCRERLIFAJIABDYGYKYCYERHIBIJIAIDBGYARJYBYCCKIAIGIDRJYAB', 'GMjBEDCBZCaCkDsDAELGQGTGbGDYEYAYAAGZFQLQKQJKCQHQBbIABIJAKALAFAGJAQAICSHIDCEYCYAYAAGZFQLQKQJQIQBKHAAACBLZFAGJLQAQCQHQBaIAJAKAFAGALJAQCQFaKQJQIQBKHAFAAACALZGQKQJQFKHQBaIAFAJAKAGALJAQCQHQBQIZFABKHAAACALZGQKQJQBQFQIJHABa',
  'GNgBKDFBQBRDZDkDAECGTGbGhGrGBIMZGQLJFQEQJZCQIIHIDBEYJIEAKaLAGAMJFQGaLQKKAAGAFAMaLQKQCQGJFAKZCQJIEIAAKYGQFJEQJZCBGIKIAQJYFAGAKJEQGaKALAMKAQEQGQJQDQHQIaBACAFAKAJKAAGAEAMaLQJQKQCQFQBQIKDAAAEYHAGAJYKZCRFIGIKIAIDRHYBYFAGJBQ', 'GKCBFCIBiBdCrDDEgETFYGAYCAGYJADAHAFaIQBYECIIDIHIJICSAYGYJYDCIYESJIBIDIGIAICCHYIYEYBSDIECIIHICSAYGYJYEYDYBCIIESGIAIJJCCHYEYIYBSDIGIJIECFIHICTAYEYGYDYJYBCIIHIERAICDEYHYIYBSDIGIAICIEBHYJIASGYDYJZBCIIAIHIESCYGYDYBYJYAA', 'GKMDaEIBJBYDgDrDCFUFoGAACADAEAGIIAGAJKFQBZHRAZHAIAGAJAFLBQEQCQDQAZHAEJBAFbJQEQHQAJCADABAEZJAFLEQBQDQEJBQCRAZHAGaJAEAEJBJCRCIDYDSGYGBCBDBBZEZEQJQHQIQALGAGJCBDBBBEZEAFbJQELFAFJBRCRDRGZAZIAEAFJHQAQAZHBBIDRCYBABICICRAR', 'GKlBYCABkBECTCcDZFQGBHEIFQIJJICIBCHYFYDYAYGYESIIJIFCHIBSCYFYIYJYECAIDIGIHIFSCIBCFYHYDYAYGYESIIJICIBIFCHYCTIYJYECAIDICIHIFSBYIYJYEYADDIDBCJGRERAYDBCBGICQHIFIBSJYAYEBCYDSEIAIJIBCFYHYCYASCQIIJIBIFCHYCYAYDYGYESIIJIBIBQ',
  'GLABjDLBQBVCRDEEBGZGrGgHFAIIDIARFYCYHYGYGQHKFAAADAIZGQHQFLAACADAIAKAJaBQEQGQIKCQDQFaAQHAIAEAGABAJKKQCQDQFQHaIAFKCADAFYKAJaBQGQFQIQHKCADAFZGABAJKKQFQCQDQHaIAGAFJKAJaBQFQGQIQHKAACADAKAFaBAJKFQKQAQCQDQHaIAEAGABAJAFLKQBa', 'GLAGiGJBUBVBKDMDSEYFDGrGCYFYKYERDIHIFQGaJQAKCAGAFAHYDYEBBIIAKZBQDQEQHQJQFKGQAZFYJYECDIHIJIIICSAYCBFAGJIAKABaDQHQJQEQGQFQAKIAJaDAHABKKQJQIQAaEADAFAGAHABAKKJQBaDQEQHQGQFQAKIABAJAKaDQHQBKCQIQAaEAFAGABADAHAKKJQIQAQFaGAAJ', 'GLNCRFCBMBjBLCQCkDsDAEDGBQCQGQJQKaAADAFAHAHYARDIFICIJIKIGCBYEYEAHQFQIZAQDQKJJAEAHYFRCIEIJQKZCADAAAFAIJHQEQEYFYCSDYABCIFIEIEBHBIZCQAQFQDQHQEQKJJAEYDYFBHIEQJQKZFAHACYARFIDIDAHACACYAYFSDIFAHAAACAIJEQEIBIGSJYKYHAAACACYAY', 'GLdBIEhBYCADCDKDsDSEEFiGHZAQJQFJEJBACBDAHZKQIQGQEQFZJAAAIIKIHIHAKaAQIQGQEQJQFJBJCBDBGZCQEQBQFaJAEJGJDRFYBAGAEaAAIAKKDQCYGYHQEQGQBQCIFJDCEYGYHYIYKYAQJQFJBAIAEKHAKZEQHKGQCQGIDRBZIBCJGBHZEAHAEZAZJRFRIJCBABBIDBEIHYHQGQBQ',
  'GLdCCETBBCICEEjEUDZDpDgGEAIYCYGAHYAAJKKQIQIIKIESDYCYCBHZGAIJHRCRBYFYABGYIIIAJAKJHQJaIQGIIYARFIBICBJBIZGQJJCRBYFYABGIIIIAHAHICRIYIAHAHYGYKYASFIBIJIIIDIECCYCAKZGQHJCJDRERBZIBJZFQIJBJDBEBCZHZHQJQBQIZFAAAJYGAKKCQHQJYGYAY', 'GMKBsDNBEDLDTDqDQEaEcEgEBGHAKAGZBZJQLYDYCAFIFQCQEQDQLKAAHAEaAQLYCAFAFYJABJCQGJKQEQLIAAFaIAGABZJQIIARLYAACAIIEJKABZGQEQIYCRLIAACAIYJAGJEQIQFKAQKABAEZGZJQLYCAFIFQCQLIAAIAGAEJBQGZIQAQLYCAFAFYJACQEJBJGQKQLIAAFaIABAEZJQIIAR', 'GMKDYDMBNBACBCSDcDaEkECGpGBQDAFQKYCAHAJALJBQERFQAZGAHZCQKIAAEAFABALaJQCQDRGJHAIABJEQFQHZGZCADBJALKEQFQHQAQKZCAJABJIQHJAQGZHAIABZJQCQKJGAAAFALZJQCQDRHJAJEBFABZIQAQHZCADBJALJBQEQFQGQKZCAAJHQGJEAFABALaJQAQHJIABJEQFQGZIAAZ', 'GMMBYCIBcBCCDCVCADEDhEZGrGCIBBJYLYGQAIDBKIKQDQEQFQIZAAAYGCKILIJIBRCYEYFYDYARIIGQIQHLCABAEAFAJALaKQAQDQGQIIFIEICIBBCQJYDYFRHYIYGBAIFIDIERHZIYFBDIEIJIBRHYIACIHQIZCACIHIIIBBJYEYCSFYDCAYGRDIACCIFRAYCCFIEIJIBRHYIYAYAQEBJIBI',
  'GMNBiDACdCBDRDoDTEYEDGJGqGBIIICREYJYAADAKILIGICQFYFACAIAGALaBQBIGJIQLICQFQFIKZCAHAGALYBYBALKCQFYIQGZHQKJFACAGAIALaBQBIHQLICQGYKQFKEQJZFAKAHAGICALYBYBALKCQIQGQEQEIKZCAHAGJIALaBQDQAQGQHQFQJKKAFaHAGABALJCQEYHYAYDBLIIQGZAQ', 'GMSBYBABDBkBlBRCBEEETGbGoGLIBQCRHYABJYKYFBEIKQLIGQJYFYEBKILIGIBICRJYDRIYEBFIDIJICBBYGYKYLYFRERIIAIHICBJYARIYEBDIAIJICRHYIYABDYFBKILIGIBICRJYDYAREYFBAIDIJICBBYGYKYLYARDIJIGAKALYAYDRFREIIIHICBBBLYAYBQDYFRJIKIGIBICSHYGBBI', 'GMZBKDVBaCCDbDkDoDsDEEAFSGAYGYIYCRLIDAHIAQKQEZBADAGZFQLQJQBJDAJYLYCCFILIDQEJKAAAHYIYFQLQCQJQBQEJDAGALZFAIJHJAQGYDQEZBACAJAFAFYIAHJLQIaHAHYCSFIJIDIGIAALYHQIJGQDYFYCAHILIAQKQEZBZJACAFAIAHAHYCRFIIIDIKIACGYAQLIGQKQEQBZEIAA', 'GMpDDGdBACBCCCLCYCcCMDUDhGEQFQBZJAKACAIAAKLQEQFQGQKaJQBJKAJaGAIAAAAYLJCQEQFQJQKQBZIAIIBIGIJIKIECFYAYGQJQKILYCQIQBIEIFCAYJYGYLYCYCBLJAQIQJQKIGAJJABJZGQKYIALZCRCIGIAIJILIFSEYAABYIACAKYGAJILIFIESAYBYKYGYIYIQBJCBJIGQKAAAAI',
  'GNABlBBBiBjBNCcCQDoDYEDGKGSGDAEAIJJQHQAQMYGAIIDQHIAQCYKZFABALYGBBYFSGIKILICIABHYDAIYBQMYEAEIDIHIMIARCYLYEABAIIJIARCRKZEALYEYGYFCBIDIIIJIAICRHYJAIZBQDQFQGQMYEQKKLAMAHAHICBAYIYJYESGYDCBYFRDIBCEIGRBYECGIIIJIAIAAIZCQHYJQBQBY', 'GNBGaGABZBgBNCEDTDpDKGQGjGrGEAIYJYLYMYFRHIHAFAKJMIIIEQCRAYGYJYHYFBBILIDICICQKZEAHQGQIYDQBYFQAKJAGaHAKJGQJQAaFABIDAHAIIEQJJGACACYDYBYLYFRHIAIJIGICBKZEAIYMYFQJQHQAJGAHaJAKKCQHQGQAaJAKAFAHJGQMIIIEQCQAQJaKAAKCAEAGAHZIYMYFQAQ', 'GNDBdCCBEBbBhBACJCSCYCcCqDTGDIAICIHAFAIBFIHSIYCYAYDYMYBCKIEIFILIHIISCYAYDYMYBYKCEIFILIHIIIJIGSCYAYDYMYHCFYEYLYKSBIHIDIAICIMIGCJYIYFYEYLYHSBYKCHIBSDIAICIMIICFYEYLYBYHYKSDIAICIMIECFIIREYCYAYDYMYKCHIBIFILIIQMYBALIIIJIGSMYAQ', 'GNEDbEABSBlBNCYCLDQDTDhDBEqGAYFAEAMIKQDQDYBYEYFRAIHIIILICIGCDYKYMYFQJIIICSIYJYLYAYHYFCEIBICIDIMIKIGSIYLYCCBYEYFRAIHICIIILIGCDYBYKYMYFQJICSAYHYJYFCEICIBIDIMIKIGSIYJYLYAYHYFYECCIEQFRAJHAJAIJGAKYMYCQEQAQHJJAAZEACAMIKIGQIZAQ',
  'GNTDoGABBBdBFCDDYDKGQGaGgGrGLJHQKZAQJJCQDQGaIAJAAAKJCQDQJZAAKALAHKBAMaHQBJHIMICRBYDYKYLYEYFRAIIIJIDACAGIMYHYFQAQJJGQIaJAAAKJGQAaJQIKAADAGAKaJQGKAQIZGAJAFAHIKJMICQDRAYIYGYJYFBEIBILIDIDQAQCAJZGQMYHYEQFQIKJAGaKALABAHAMJDQBY', 'GKCBjBQBiBdCbDgDAEREDIBIDIGICRGQIYASJYECBIFIDAGJAQAYDYFYGYBYESJIDCFYBAFQGIIICBAYFYFQIQIICIABFYFAGaIQDRHIABCYDYIAGKFQFICRARHYJYECGIFIDRAICBDYFYGYESJIHICBDBFYFAGaIQAIDICRHYABIAGKFQFICRDYIYIAFAFICIDRGYBQIYFAFIASJYECFIAI', 'GKFCIDQBgBbDREkEDFAGpGBICADAFQJYGYASHIBICIDBFYEYEAGAIIJJFQCQDQBZEACICQEQBJDBBYEZCAFAJZGQCIEIDQIYCBEIEQBQCQEIIIDABYCYCRBJBABYDQIYHYACEIGICIFIFAJIDSBYFYCYCBEZGAJJDJFREZBQDAGYJYASHICICABJEBBZBQCQCYHYACGIJIDQBJFBDZJZGQBJ', 'GKKCUCABTBVCoDEEiEQFBGBQDAEQGQJJAAHAFJIQAYDYGYJYECBIFIHIIICTAYDYGYJYEYBCFIHIIICIASDYCCIYFYHYBSEIGICIDIACIYCSGYCAEYBCHICIIIASDYGYCBHYBSEICIGIDIACIYFYHYBYESCIBCFIHIIIASDYGYJYBYCYECFIHIBSGIDIJJACDAIYBYFYHYESCIGIJIDIAIBA',
  'GLCDoDBBTBACKCRCiDEEUFqGKIBIESCYCQAZFAGAHYDQFIAIGICIECBYHYHABAKaDQFQJQIQAKCAFADAGADYFSGIDCBIHIERCYDYGYFCBIHIDSCIEBDYBYHYFSGICIEIDCBYHYCSGYFCCIBIHIDSEYGYFYAYCBBIHIDIKIESGYFYAYIAJAKJDQFQAYCAHABADIFRHYHABADADIFIEIGSHYHQAQ', 'GLFBgHRBVBECIDkDKEBGaGrGCYGYDQAQJYEQIJFACAHYJYEYAYAQDBGIDQEQIQFLCAHAJABAKaEQGQAQDQJKHQFaIAJAAADAEAGAKKBQCRHQJaIQFKJACAHABAKaEQGQAQDQIQFQJKCAHAIaAADAEBGAKKBQIQCQHQJaEAFAAADAIKBAKaGQIQAQDQEQFQJKCAHABAIaGAKKIQBQCQHQJaEABI', 'GLIDMEDCYCEDpDZEQGbGjGrGAAHADAGAFAKaJQIQBQCQEQALHADAGAFAIaBQEQAQHKDAGAFAIAKAJaBQCREQFKCBGQHZAAFAEABAJKCQKQIQGQFaAQHJFAGAIAKAJaBQCQEQAQHQFKGAAaCAEABAJKKQIQAQGQFaDQHACAEABAIKAQGQFQHaCAEABAIAAKKAJaAQIQBQCQEQHKDAFAGAKAIaAA', 'GLIGjGZBECFCLCaCcDBGQGrGCYGYBYIYFAHZKYESDIFIAIJICBGYBYHYKYFSAIJICIGBBYKYFYEYDSAIDAAAJAEAFAKKBQGQHQCQJZAQIKJAAaDAEAFAKABKGQHQCQAQJQIaEAFAKYKABABYDREIFIAIIIJIGCCYHYBQKQAQAICICAGRIYJYFYEYDCAIBIHIKIHABaKQAQDQEQFQIKJACAHAAZ',
  'GLJBdCIBbCcCYDgDpDKEEFBGFIGIHYCRAYIYDBGIGQFQFICIARIYDYKYJYBCEIFIFAGAGIHKCQDRIIABCYDYFYGYHYEYBSJIIIDBCIASDYIYCAJYBCEIFIGICIAIDRIYCBFZGYEYBSJICIIIDBAYGYCRJYBCEICICQFJGIAIAAHZGQAIHAGZAQAIFZGIHIDRIYJQKJIAFAFYJYCCEYBSCIEBAI', 'GLQCDIhBjBaCADRDbDkDsDIGAQCAGYEAHIDAJaDQIQHQBQFLKAGAGIKIACCYEYJYDYDBHZHQBQGKKQFaGAFIKJDAEBCJJBHZHAIbBQIIKQGQFJDADICCHIJIASEYCYDYDQFZGAKABAIKHQJQCRDQKZGQFJKACADAJAHAIaBQGQFQKJCADAGaBAIKHQHIJQGQCQDQKZFABAJKGQGIAIESCYDYBY', 'GLRBsDICVCADCDEDJDLEgEaHBZDQIIHIHQFQEJABCAJABZKQHQFQFYHIIYDBKIJICRAYEYEQGaDAIAHAKABLJQFQHZCQIQGJEAHAFAJABaKQDQGIEIIQHJAIHYAYAQEZHAFAFJAJERHZHQGbAADAEIFAIAKABKJQEQAQHQGQFaAAIAHKEAEYJAAQBaKQDQHQIQFLGAGJEBAZJBBBKZDRIIJIAI', 'GLVBgElBDCICMDJEAGaGiGqGFAAAAYCCIIJIKIBIBAKaJQIQAQCQDQFQHKGABAIaAQDQFYCAAIDIIIEQGYFYDAHYCAAAIJBQFQFYDYAYAACRHIGIEBBYIYCQAIDIFIFQGQHZAACADAFIIIBIERHYDYAYAQCBFICQDQHKGABAGYHYCAIZFQAQAIDIBIBAIAFaJAKKEQFQGQHZDAJZAQAYCSDIAC',
  'GLYBdBABTCUCBDhDpDsDJFDHAAGYHIGQAQCQFYJQKYBCEIDIJIAICRFRKZBZDBEBIBHJHAGLCQJQFJAAAYJYGYHYIYESDIFIJAGZHQIQFQDYECFIIIJIAICBGYGAHaIQIZFRDRERBJKJABCBGBHBIZIAFbDQJQGKHAHICRAYKYBYEBDIJIFIHQGZIICRARKYBYEYDCGIJIHIAICBFYIYHRGRAJ', 'GLdBAFbBgBUCMDYDhDpDCFrGFAEAGIDAIYKYAQEICICBGJHAKAIKDQHYGYIZKYCSEYACCICAIKKQGQGYHJDAKYIYIAKKGQDIIYDYDQHZIAGAGJDJHRIZDAHAKaGQDIEQGIDQJQFZAAAYCCEIASCYCQFJJADAGYEQCIABDIJRFZAACADAJAGAGYDRARCYECDIEQGIGQAQCQFJJAAZGBKJHQIQBQ', 'GLgBRGBBMBFCICDDKDcEZFrGFAGYDABIIYERDIGIHICIFIADJYKYEQBICSBYGYHYDYECIICIKIJIATFYAABYDQGIHYHABACAJAKaIQDQIYESBJEAHQGZBACADAIAKKJQHQGQBZEBBIIICRGIHIFIACJYCYIYKYESDIDAEAGIHICBKIJIATFYAACYCAGYJAKaEQDQIQHQDYECHIIIJIAIFRCYAC', 'GLgEMFDBRBICSDkDqDsDaEAGBADAGAIAHJJQFQCQCYKIEAFZGZBQKJCAGAFJDQCYGAFAJAHZIQBQGJCIDBAADQHZIZBQFJCQCIDIKZGAFABAIJJQCQDQFaCAGQKJFADADYJAHJAQDQEQFQKaCAJAHAIZBQGQCJFJDAKJEAAAIZHQJQGZBAHJIJAQDQEQFZKZCZBBJJIBAJDRERGZIAAAHZJQBQ',
  'GLjBYDIBJBiBVCCEEEgESGaGAICADABAEIFQIIJIBICTBYBQDQDYGYHYJZFCAIEIIICIKIBIDSBYGYHYFYKYADEIIIKIBIDBCYBRKZEBIIBICIKICABZIZEREYATFIFQHIGIDBCYKYEBIIBIBACQDRGYHYEBJIKIDICBBYIYAYFREIHIGICBDYJYKYABIIBIDRCRGYHYEYFCIIBIDICRJYKYAY', 'GLlBAFVBgBhBUCCDEDYDSFLGFQJQKYKQGQHZCBCYADFIJIEIKIEBDJIRBRGZHZEBCYAYKYDAFCJIIJBQKZAQCSEIEQHKGAKABADAIZCQCYESAYAQHQGKKAHaAAAIDAECJYFSAIEIDICCJYESDIDQGQKKCAJAIJBQHQCZGZKZAAAYFCEIDRARFQGJKJCJHBBBIZBQHQJQCQKaGAAAAYDCJICSAY', 'GMAEpGFBdBCCRCYCLDUDsDaGiGGABYHAIYIAJYDQKIKALAJABJFQLIERAIGBFYBYEYKYLYDBJIJQDQCQHILQKQIQAIEBKYLYDYCRIIAQHZIBCBAIDIKILIERHYHQIaAACADAKALAJAJZDRBIJIKILIEIFIFABZGRHYIYEBJQLYLQEQKQAQCQILEAHAFAGAKYDALZJABKLQJaKQEQHJFAGAJAKZAR', 'GMUDYGKBTBjBcDIEkEAGDGLGgGLQBQCQGQKaAADAEAFAHALKBQCQGQKQIQJaAADAFAKKCAGABALaEQHQKQDQFQAQJKIACAGAKaEAHALKBQKQCQGQIQJaAADAEAFAHAKKBALaKQEQDQHQFQAQJKIACAGABALAKaEQHQBKCQGQIQJaAADAFABAEAHAKKLQCQGQBaDQFQAQJKIABACAGALAKaEQDQAY',
  'GMoDMEaCbCBDSDYDcDgDIEkEDGEYFACADAAJIQGQJQEQLaBAHAKAAJCQDQHZBQLKEAFZHACADAAZKQBQHJCBDAAAIJGQAZCRDQFJEQLaHAFJEJJAAAGAIZCQDQEQFZHQLKJAEZCADAIJGQAQEQJQLaHABAKAIJGJAQEQJQFZCADBEJAAGZEQCQDRFJJAAAGAEZIZKQBQHQLKJAAAGAEAIZCQDQAJ', 'GKZDBGNCYCIETEkEEDKGhGBYHYCAJQAQFYGAJJAQFQFYGYCRGAHIBIIIEIDCAYFYJYJAALFQEQIZCAJIFIDSBYHYIYDAHQBKIAEAFAAbJQCQGQHQBQIKDBEAFYHZGAJYJAALFQDQHQEQIaBACAGAHJJIFIFAAbJQCQHQGQBQIKEAFAAAJaHQAKDQFQEQIaBAGAAAHAJKFQAZGQBQIKEAAAEYBY', 'GKkBICMCdCADCDEDoDJHZHDBAICRHJBRIIERFZFQGbDAAAIACAEJFQHJJQEQEYFJBBFYJYCYAYDRIIFAEAGIBAJAHbCQDQEKCAHKJQFRFYGRIZEBABAICIGIGQIQEaCBGIFIGQCQEKIAFAJAHaGQGYCRJIBRIYAZAAEREYDCAICIGIIIBBJYERARAYDYCCEIEAGAHLJQFQFYAYEYHYCSDIIIBI', 'GLBDqGACFCdCDDYDaDjDgEKHHIGICQAYFYIYKYDYECHIHQDQEQFJAJCAGYIAHZDQERFQAJKAIAGJJABZDQIJKQAaFAIADABJJQCQAYFZIADAEBBIHJGQKQFQIZDAEAHAGJJICRFZIQAJFACBJYBYGZHQDQEQAJIAKAGAHZDQERAQIJFJCAJABZDQAQIQFJKAAaDAAIBJJQGZAQKQFaIADAEBHJAQ',
  'GLCBoDABbBNCDDLDTDqDkEQIAYFIGYGAHADADIHYKICSAYAQGZHAKAIAIYJYERFQHJGJAACAIYJYDRFQDAHQGJKAJABKIQCQCIASKYFYGYHYECBIDIIJAQCQJIKQGaHAFAHYJAIABZDQDYESFIFAJADABIJIKIACCYCAIYIQIYBYBADQIJCQCIASKYJYJQFQFYECDIDAHIIJBQJQFQHQGKKACABY', 'GLDBYBVBZBlBMDrDAGIGoGSIDAFACAEAGIJIBQDYKYCYCRFRAJHJIJDBDIBDKYCYFYEAGAJJKQBQDQFYEYARHZIIIAFAFJCBCYEYEQFYFQIQHKBACADAKAJaGQAQEIFIJIKIBTDYDRCZHZIZFBABEIIIKIDICRDQHYCACIHIBDDYCRDQIYCACYKYAYARFRHJIJBJCBCIDDJYGYKYAYAAGAJKKQBQ', 'GLDGaGIBVBiBjBkBlBYEBFLGIQBZFBEIFIBIIICSJYAYKYDBFIBIJQAZKQDZFBFYHDGIGBEJIJCJJRKZKABABZGZEBIIGRBJBQKQKJJBCZGZIZERBIIIGIKIGCCJJRGZCCBYCYIYEYKYHTFIFRDJAJCAKABABYEBIIJIGSCYCRAZKZDZEBFBBJBQDQEQFQAKKACACJGCJYCSBYDZEZFQAQKKEABA', 'GLEDrGDBVBMDTDYDJEgEAGaHBYDRFICQAYHYCYEYFYDDFIKICREYEQAQJJHAGAIABZKQFQEJGJHQJZAAGAEZFAGIKABKIQHQJQAaGAJJHAIABaKQFQFYDRGIAJHAEZJQAQAJGZAAJAEKHQEYGZAZDBAIFIFAKABKIQHQJZAQGKJAHAAYIABaKQFQFYDRGIGQJKHAEZAQAICCAYGYDAFIAQEKIABA',
  'GLEDsDBBKBNBACLEYEaEcEoGCQAaEAGAJABAKKHQFQAYDAIAHIBYFRCYIYJYESGIDIAICAFAIAHAKaBQEQJIDSAIIICICQFBHYDYBAKJHQFQAZIADAJYEBKIHIFRCYDYDAHAKZERJIIQAJCADAFAKYBQHIFICSDYDQAZFAIAHABABZEZJRGRIJAJFAHABABICIDRFYAYCBDIFRAYHABADICRAQBY', 'GLSDDGUBVBlBICgDBELGZGiHAYFAGQJYCYDYEBKIJQAQFQHQBaIACADAEAKAGLJQAQFQHQBQIaCADAEAKAGAJKAQGaKQCQDQEQIKBAHAGAAAJaKQGKHQBQGYIaCADAGAKAJKAQHQGZCQDQIKBAGAHAAAJaKQCQDQGJBQIaEAGACADAKAJKAQFQHQBQIQGaCADABKFAHAAAJaKQBQCQDQGKIAHAAA', 'GLcBZCdBgBUDsDDEIESEiEAGDAGIIAJAFZAQCQEQGQKKHABAFZJQIQHIDCBYIYEYGYCCAICQJIFIBQDQIQHQKaGAGIHIDIKIBCIYEYCYABJIFIIQEZFBIJERBRDRHYKYGYABCIGQKJBBDYFYGQKYAYCBGIFIDIHIDBEBIZJZGRARAIFIEIBQHIKYHAFAFYAYCRHIFAKIBAEYAZCZHRFJKJDADIBI', 'GLjBFCLBiBACYCZCJEkEBGbGCIHIGBDYAYIYKYBSCIHIJJGAGIDDFIDQESDYGYHYCYJYBCIIAIKIFIGSDIECGYFYAYIYKYBSCIHIDIFCAYIYJIKYBYCSHIDIFIEIGCAYIYKYDSHYCCBIDIIIKJESFYHYCYJYBCDIIIKIEIAIGSFYADEYAQIYDYKYBSCIHIAIECIYDYJIKYBYCSHIAIEIFIGCKYAQ',
  'GMBDoDlBACJDUDqDDEYERGbGiGHIEIKYCAGJBJIQDQAYEAJAKYKALABAGZCQLYFQHQEJAJDALYFYCAGJBQFQLJIABZGZCQGIBILIIIDSAZEZHAKJIABAGZFQBJIQKaLABAFAGJIQBZLQHQEJAJKIDCAYBYIYFYLYCAGIFQLQBKIABYFZGZCQHQJJAQEaJAAKKABABYHYCBLIIIDREYJYKYAYCBHIBI', 'GMDBcBABJBKBaBTCdCBDMEYFqGCQIYJAHALIFQEQAYJYHBBIGIEIAREQJYGBEIAIAQJQFAIJCADAKALaAQBQEQGQHQIJJAFAFIKICSDYJYIYFAAAHABALICQDRJYIYGAEALJKQFYABEYGRIIFAKALZBQGQAIHQIIFIJIDBCBLYEQFRJIDICBKYFYFQJQEAIZAAGAHABALKFQKQCQDQIZJAEAEYGYAS', 'GMICTGJBKBZCMDkDsDiEAGDGaGARCYLIDQFaKQJKFACIACDAEYIYIAHaGQLQBQKQJQFKCADAIAHAGaLQHKIQCQDQFaJAKABAHALAGKIQHaBQKQJQFKCADAHAIAGaLQBQKQHKCQDQFaJAHAKABALAGKIQCQDQHaJQFKHACADAIAGaLQBQKQJQFQHKDADICIAIECIYCRDYDQHZFAJAKABALAGKCQIQBa', 'GMJBdCACcCBDEDUDYDoDqDKFhGFQEKAAKAHJCRAYKYEYFYGYBCDIHIKQEZFAGAHADYBSFIEIGIHIKIAIAREZEQFbGAGZHBDBJIIICQLIAQEQFQGZHZDADIHIGIKIEIFICCAYEQFQGQHZKAEJAICSFYGYHYKYDYBCEIKQHJGAFAAACALIIAJaLQEQEYLYBSDIHIGIKIAIFICBIYIAEaAQFQGQHZKAAJ',
  'GMJCNCABKBLBiBMCaDgECGjGrGBACRJZEAGAHJDQDIFCIICRAYFYDYDAERIAJIAACAEALaKQHQBQGQIIFRJJAICCFYCQIYERDIAICIFCIYARFQJaAABADAEAGAHAKALKIQIIFSCYAYEYHYDQEAJICAFBIYKYLYBSGIDIEIAIFIJIFBIBKZLZHRDREIAIIIKICSFYFQIAJZAAEADAKAHAHZDRDYBYBA', 'GMQCUDABTBJCKCBDcDjDDEhErGAQCQGYFAIIDQJIFIEICIGIACKYKALaDQFQIQHQBQJQGKCAEAFADADYFSEIDCKIARCYDYEYFCKIDSCIABDYKYFSEICIAIDCKYCSEYFCCIKIDSAYEYFYCCKIDILIASEYDCKYCSFIDIEIACKYDSFYCCDICQKIASEYFYCYGZDBJABAHAIALJKQHaBQHIJQGJCADAHABa', 'GMjBICBBCBRBSBkBlBDEgGoGTHIIDIFBLYHBGIAIJIBQCYFYDYIYHBGBAIJIKJERFRCIBBEYFRCRDYIYHYGBABJIKIFICRLYAYGRHIABLIDRIYAYHYGBLIDICBEIBSIYDBLYGRHIAIDIIIBCEYFYJYKYGRHRAIDIIICBLYDRAYHBDILICRIYAYHYDBGBJIKIFIEIBSIYAYHYDYGBLIARIIBCEYCRAY', 'GNKBkEEBFBRBVBhBQCIDTDiEBGaGLYCYDYFBMIAQIIHAGYERAYJYMYFRDICICQIILJABEBGIHRAYAQLZEAMYCQIIIAJAJIEIAIHBGYKYBYFRDRIIJILIHAMYCYCADYFBBIKIGIMIHSAYEYCYJYLYIYFBDIJQIQLJAAEAMIGBKYBYDRMICQFQLIEIAIHCKYCRERAIGBEYCBKIHSGYEBCYAREIGIHCKYAR',
  'GNcDAGbBgBICZCaCDDJDUDLGRGrGAQHIBIEADAJQLJFAGAMaAQCQJQLQKQHQBJIAHaKALACAJAAAMKDQEQFQGQHQIQBaKAIKHALZIQHKLACAFAGAMZAQJQIQHQLJFAGAJaAAMJJQAaCQIQHQLQKQBKEADAFAGAAAJAMaCQIQHQAKCAFQGQMIDQEQBaKALAAACAHAJKCQFQGQLZAAHAJAIAMJFQGQLQAa', 'GKEDoGIBJBYBCCdCrDLHaHAYDRFYIYGCHIBIJIDIEICSFYFQAaEBDYIAJYGRIIEIDBEAJABABIDSFICCDYDAHbBQFQGQJQEQIQALEAAYEYIYGCBIHIDQCQEYFBJIHBDJCRCIETFYFQAaIAHAHJFIECCYDYBYJYGSHIIIAIEACBDYFRARAIEJFCDICRFYAYEYHYIYGCBIJIAQAYDIDBCJARDYCBAI', 'GKJDrDIBdBhBYCEFBGRGaHAICADQEAFABaJQGQHJCIFBEYIQCQHZGAIJCRAYCACIEIEAFRAYCACIEIEAIZGQHJAAAIEYCYFBIYGYDCJIIQCQEQAQFQHaGAJABLIQEQIIFRAYAQCAJYDRGICICAAJEBEYAYCQHIEAFAIYBYDQJYGQHJEJFBEYJYCRAIAACABAEQHZGADAIKJQEQAYFQHYCBBABYBA', 'GLACMCLBZBlBFCYCDDaEBFqGFQHIKYBRCIJIAIGCDYIYKYBYEYFRCIECBIIIDIKIGSAYJYEYCYHYFCBIIIDIKIGIASJYDCIYCRDQEIDIJIACGYIYCYKYBYFSEIBBEAFAKJBQIQJQHZDADICCBYDSCICQHJJAIAKZFQEQHIBBIIKIGIASJYBYCYDBHYEAFAIIKIBSJIACGYBYIYDRCIKYFQEQHIJIAI',
  'GLDDpGKBgBlBLDhDjDIFAGTHAICQFYAQJKIADABYHQGJCQCYGYKYEBHIHABKCQDQIQJaAAAYEBFIKIIIDCCYCAGYGQHaKQEQFQAQJKIAHAGABaKQEQHJIQJaAAEBFAHAKABKCQGQIQFZDQHAKABAGKIQFQHaAQJJHAFAIAGaBQKQAQEQFJHQJZFAHKDACAIAGABaKQAQHQFQJKIAAZKABKGQAQGYBY', 'GLFBaCQBVBZBgBBDRDDFIGjHIQGJJAHAEAHYBBKZDRDYATGIIIBIEICIEAFBJIKYBREIHIFBCYHREZBBKICRHYBYFQIYJYGYADDIDBKJCJHREREYBYBQIYDYARGIGQJKFAFIECBYFSEIEQJaGAGYABDIIICCHIBQEYFBHBKZDRDYATGIIICICAFIEIBBKYDYDBAZIRGRCJDBDIFIFAABKIBREYHBAZ', 'GLNCZDiBlBTCUCDEJEgErDAGAABYDAHYCCJIEQEYFYDYJYASGIGQKKCAEAHABAIAJaDQEQCQFQCIECFYCSGYABDICIFIESGYCCDYARCIGIECFYDYAYCSGIDCFIESDYGYCCAIFIEIDSGYCYKYACFICSGIDCEYCYFYASGICCEIDSCYDAGYACFIEIDIJJCRGYIQBQHQKZAYFCEIASGICBDYGAAAJIDQBJ', 'GLSGhGABBBNCEDaDCEQEkEpGBYGIKYJYERAIIICRDYHYAAEAGAJAKKBQCQIQHQFaAADQEAGAJAKABKIQHQFQAaGAFJHAIABaKQJQFQGQAKHAFZJAKABKIQFQHQAaGAJAFJIABaKQFQJQGQAKDACAHAIABAKaFQBKCQDQIQHQAaEAGAJABAFAKKCQIQBaERGIJQGQAKDAHABACAIAKaEQFQJQGQAQBI',
  'GLTDgGBBCBlBMDjEDGbGoGQHAICYDYFZAAHYIAEAGAJKBQKQIaAQAYECAIFIGIIIKICSDYDQHZFAIAIIDIAZCBGAKYJABKKQAQAZGZERGIIIDIDQIZEBGIDIAIAAKABaJQDQGQAKIQFQFZHJCAIYAYAAEQHIFAAZDBGYERDJAJAQFQFJHZDAAIIICQHYFAIAAaDQAJFIHICAKABAJaGQAQDYEBGIBI', 'GLYEbDLBaCMEoDAGDGIGQGjGBIKQBQCREQIKJAAADAFAKaBQEQIQJKAADAFAKABbCQEQIQJQHQGKAADAFAIaCAEABLKQIQDQFQAQGaHAJACAEABAKKIQBbCQEQJQHQGKAADAFABAIAKaCQEQBLDQFQAQGaHAJABACBEAKKIQDQFQAQJaBAEAKAIKDQFQAQJQBbHQGKBAJAAADAFAIaKQCQEQHQJKAA', 'GLoGBHABTBYBMCEDrDZEQGjGFIDIDAHIAIEQJICRBYGYFAKAHAAJIQKZFQGIBICBEBIYAYHZDRFRGRBJCJEBCYBYJYGYFCDIHIKIIAAZHQKQGQGYJJIAKZHAAKKQIQHYDYJZDAHJGQDYHAGJDQDYGYHYHAGAAAKKDQIQJQHaGAHIJKDAIAKaAQJQGQHJDAIAJaAAKKJQDQIQHaGAAAKAJKIQHQGaBQ', 'GLpDKGFCYCDDcDkDsDIEAGZHBQEQJJIADAAYHZGQFQCQJIIIDBKYFYFAGAGYCRBIEIHIIQJZEABACAFAGAHAALKQIQBZCAHIKIDSBYJYEYEQJKBADBIAGZFQEQKYHYCQJQBKIAEZFAHAKIDRIYBYDAJYCBHIHQGKKAAbHQHZGRCRBIJIIIDBKIABHZHAGbKQAKDQEQFZAAEJFQIQBaJAAAEAFJIQAZ',
  'GLrDBGQCRCdCbDpDEEJGTGiGBYCQFYIYJYEAAIGIDQHYJZHQBKIAJACADAGZAZEQHIFAKAAAGKDQFYHYEBGIAQEQKQHQBQIKJABaHAKAAAGZEQHIFIDAGZAQKQFQFIHYEBAJGJCQDQBQJQIaHAFAKAAAAZERAIFIBIHIIIJICCDYGYAQKQBQBIFaEAAIFJGIDICSDAFYGYAYEQHQIJJYJACBDAKZAA', 'GMACLHcBYCbCEDJDRDZDhDpDBGCIEIIIJIKIDIASGYHYBYLYFYCCEIEAKJJQIQBQFQLJGAHAAADAJZIQBQFQLQGKHAAADAJAIZKZEQCQGIHJAADAJAIAKZBQFQJILQHQGZCACYECBIIIKIASDYHYLYCQGIHALAJAFZBAKKIQFQJQKYLQHQGZCAGIHILIDIACFYJYBYESCICQGJHALABAFKJQJIASDYBY', 'GMAGgHQBRBSBbBlBMDrDDGJGTGFIGAIIBICRDYEYKYHYLYGBFILQHQKJEALYDAFYGRHIKIEIDICCBYIYGQLYFYHQKQJQAKDAEAKZHAFIGAIIBILICSDYDREZAZJZHBFBGBIBBJCJDRCYBYLYIYGSFIIILIERAYHYJYHQAKJAEAHZLYIYFQAQJKEAHAAZFAAIKYIALKKQIaAQHQHJJZFAAIIIIAKALaAQ', 'GMQBqGABBBKBRBlBFCUCDEaEgEEAGABIKALIARFYKYIYGYHRJIEIDICIFBKYDREYJYHBGIIIDIDQERJYIBDIEIKIFRCYJYEBDYDAIREIJICIFBKYDYIYESHYGCEIHRJIDBKIABLYBYEQGRJIDICIFIABKYCSDYJYGBEBBICQKIARFYDYJYGYEBHIIIKIAIFRDYABKYIYGSJIAIDIFBKYARJYGCIIAIAQ',
  'GMYBbCdBcCQDhDAGDGIGLGTGoGEIEQKaBADALKAQFQEQKQIQJaBADAEJFALZCQDIBIIIJIKIACKYLYEQFJKQAQIQJQGQGIHaAABADACAIYFAEALKKQEaFQEIIJARGYJYBYDYCCIICQEAFZLAKKAQFQEQIaBQDQHKGAJAIAAAEAFYKYLZCSDIBIEIIIJIABLIFBKZLZCZBRDRIJJJAJFBEZAQFQJaIAAI', 'GMcBICJBKBgBDCZCaCdCBDrDEFFRJYDADIHCGIEIBRCYECGYHSEICIJIBCGYHYESCIEAHBKZFQDQJIHAEYCRDYFBKJEQHQJYFACIEIHRDYECHIGIBSDYEYJYFYLYICAICIKIHIFSEIDIJIBCGYFYHYCYAYKYISLIEIDIJIBIGCFYBSDYEYJYLYICAICIKIHIBIFIGSDYEYJYBCHYCYAYKYISLICCAYAA', 'GNLDpDIBBCCCTCYCUEZDhDkDrDDGAICAFAGABYJILIJQIQDQEQMZAAHAKAIKDQEQFQMQAaHAKAIALAJJEQFQKZHQAKMAKAEAFAJZLQIQHQKJMQAaKAHAIALAJJBJDQGQCQAYKZHAIALAJABJEQFQIaFAHQKJAJCAAYIYEABZJQLQHQMJAQKaMAAKEAFABAJZLQBJEQFQAaHAAIBALAJJEQFQAQKQMZHAAJ', 'GNYBsDIBLBdBCCECFCJCADaGiGpGIQMYBYEQKIFQJJCACIACIYCSAIAQJZDAFAKYEABIMIIQAYCBKYLYGRDIFICIAIJIICKYLYFRDYGBEYMYBYHSGIECFIKIDQJIAALIIRAYCYDYJYEYEQFBJIKILICRAIIBCYASDYEYJYFYGYHCKILIERDIABEYKYLYHSGIFIDIAIDAEBKYLYFRDIAIEIJIIICCKYLYAR',
  'GNZBjGQBVBaCMDbDoDAGDGJGSGrGCQKYFYLZFQKKLAAACAEAHAMaBQDQGQFQKQLKAACAEAHAMABaDQGQFQKQLQJQIKAACAEAHAKaDAFAGABKMQKQEQHQAQCQIaJALADAFAGABAMKKQEQHQAQCQLaDAFAGABAMAKKEQHQAQCQGaEAFQLJGAAACAHAKaMQBQDQFQLIEABYDQLQJQIKEAGAAACAFaBAHKFQAQ', 'GLBChEgBCCFCbCcCdCDETDYGAYDYIYJYGCFIBICIKIASDYIYJYGYFCBICIKIAIDSIYJYGYFYEYHCBICIKIGSIIJIDCAYGYCYBYKYHSEIFIIIJIGCAIDSGYIYJYFYEYHCBICIKIAIDIGSIYJYACCYBYKYHSEIFIAIIIJIGCDYCYBYKYFSAIIIJIGIDCCYBYKYFYASEYHCAIFIBICIKIDSGYIYJYEYFCAY', 'GLBDcDbBiBACSDgEEFJGYGrGBQFYHQAKIACBFAJIEQIYCAJADADIGIERGAJYCQKZBQHQAQIKFAJAEAKYDQCQJIEBGYCYCQJQFQIZAAFKJACACIGIERJYCADAIYKIEQJQIQAbFAFZHBDJCRIIJIEBKYBYDQHQFJAJEAGYCYBAKJGQEQAZFZHABADAKICQBZDZHRFJFQALEAIAJABACAGAKaHQBKJQFaAQ', 'GLFCAFECYCdCKDSDhDjDrDaGFAGAHQIZKYCRFIGIBIDCHYIYJYKYCYEYEAJJHJIQKQBQDQFaGACAGYEBJBHJHAILKIKQHbJQJZARERGJGQFLBADAHAHIDSBYFZGAAAEAJJKAIaJQAQEQGQFJBIDCFYIYJZEQKYCQGYABEICIHIJIIIKIDSBYFYGYHAKAIAJZCQAYECCIASFIGIHIBIDCKYAYCYESHIAA',
  'GLIBlBFBhBYCaDUERGiGqGCHAAFYHYGYKYCYBDGIFIDAHIEAIIJZIQFQGQBQHIDAFYGYBRCIHIDIKIAIAREBFYDQHYKYCYBCGIHIDAFJAQAYDYDQFAHZGAIAJKAQDQDIAIESFYHYGYBRCIKYGBFJHJABDYFYIYJYBRCRGIKIECDYARHYCYBBIIJIAIDIESFYHYCYKYCBFJAADAHJEAHYJaIQFQBYFIAI', 'GLIBlBVBYBcBhBiDAGDGqGJICABADQEBGIEQJIFIDIASKYEYCYCQIQHKKAAADAFAJaBQCIEIGQFIFAGAGYJJAQDQKQHaIACABAEABYFAJICREIFIKIACDYAQGYGQKQHQIaFAFYBCKIAIAQDBGYJYCQEQBIFIHIDAAYKYFSBYBQIKEACAJIGIAQDQHYHAKAGAGIAIDRJYCQEQKYBYBQIQFAGIHKKAAAAI', 'GLJBVBiBICEDZDgEBGLGSGjHFJHYEYIYBBJICBGIDRAYCYCAFZJQBQIQEQHKAACACIAIDCFYGYJYKYBSEIIIJIFIFAJaIQFKAQCQHZEAFAIAJKAQCQFaEQHJFAAACAJaIQEQHQFKAACAEaIAJKEQAQCQFaDQHAIAJABAEJAQCQFQHaIAJABAKIGIDRFYJYBAEICIAIFQJZCACIAIFIFQJQHQIaCACYBY', 'GLQDCGFBSBYCpDAEUEkEKGhGHYCRBIJIDBAIAQDQGQBaJACAHAIAFKKQAQIYCRHIDIGIGQBQEAJaDAHACAIAFAKJAQFaCQIQDQHQJKBAGAFAAAKaIQFJGQBQJaDAHAFAIAKKAQGQFZDQHQJKBAFAGAAAKaCQIQDQHQFKBQDAJaFAHACAIAKKAQEQGQBQJQFbDAHABKEAGAAAKaCQIQBQDQHQFLJAGAAA',
  'GLUBYCDBRBhBiBACFCBESEjHABJIFBKYHSAICIIIDBFYJYCRIIDIFBEBKYCRJIDRIYAYHCCIKIERDYJYARIIFIDBEBKYCYHSIIFIDIEBJYFRIYHCCIARFIJIERDYIYFBABCYHSFIABJIEIDRIYAYFYHCCIKIDREYJYFRAIIIEBDBKYFRARIIEIDBJYAYFBCYHSIIABJIDREYAYIYHCCIFRJIAREIDBAY', 'GLYBUDFBcBlBDCiDoDZGqGAIEAGYJIHIAQIYFRCZBBDBDIFIFAIIAACQBYDAEAJAHKGQGYJZEQDQBICAHZFRDYEBFIHIGIAQIYJIDQDYEYFBJIGAHZJQDQCQBYFADJGJGAHAHJJZDQGIIIAAJYHQIQGaCQDADYFSEIBQDABABICBDYEYERBRCJDBBYCYFCEIBQHIJIAQGYBYCSFYECCIBICAGIIJGQBa', 'GLYCEDDCBDpDMEREIGbGjGrGAAEAKaJQIQCQFQBQDKHAAAGAEAIaFQBQDQHKAAGAEAIAKAJaCRFQBQEKCBGQHZDAEABAFAJKCQKQIQGQEaDQHJEAGAIAKAJaCQFQBQDQHQEKGADaBACAFAJKKQIQDQGQEaAQHABACAFAIKDQGQEQHaBACAFAIADKKAJaDQIQCQFQBQHKAAEAGAKAIaCRFQBQHQEKGABa', 'GMDDoGFBIBVBaBJDrDYELFAGjGFALYERCRAIKIDAIALZJQAQKJGAAaCAEAJAHABKLQFQIQAQDQGQKaCAEAJAHABALKFQIQDQGYHZJQKJGAAADAHAFAIALaBQEQCQJQAJKIGIGQKaAAAIGJHAFAKIDAIALABaEQCQJQGQAQKJHAAaCAEAGAJABKLQFQIQAQDQGZHYJAKYCAEABALKFQIQAQDQGQHQKZJAAJ',
  'GMIDrGQBbBNCUCoDAGDGKGRGgGBYERJIAICALAGABZDQFQGIKJAQLICRJaKAAKLADABICQLYLQJQKaAADBEAFABJGQLILQJQJIKQCAHQIaAADAEAFAKILJGABaLQGKJQKQDQHQIQAbDAEAFAGAHICAJJBALaJQGQBICQEQFQHYDQALDAIAHACAKABALALICRJZGQEQFQAQKYDQBYIKHAKABALALYDRAYBI', 'GMrDCGgBFCICLCMCZCaCADRDjGKAHAIAAZLQDRBIFQGQJIEAKKJQBZKAJKFAHAIAAAAILZCADQGQJQKQBJHACIESHYIAIYBYFYJYKYDCGIAIFQJQKYLICQIQBYDYGCAIJIFILICICBLZAQIQJQKYFAJZABJJFQKIIALJCRCYFYAYJYLYGSDIAABIIACAKIFAJYLYGYDSAIBIKIFIIIIQBZCBJYFQKAAAAY', 'GNBBaDABYBCCDCZCUEkEEDMDQDiDMQBQEQFQJZKAHAIAMJBQEQFQJQKZHAIAMABJEQFQLJAQCQKZJALAEAFABZMQIQHQJJKJAAGABZEQFQLQKQJZHALJEAFABJGQAQJZKAEAFABAMZIQLQHQKJEAFALZIAMJBQLQEQFQKZHAIALJBAMZLQIQHQKJJJAAGAMZLZIQHQKQJJEAFABALAMJDQCQAYGBBYDICRAR', 'GNBDcDFBRBYBACKCTCDDLDUDhErGDAEQFQAYGALAMZBRKRCRIIJIHBKYKABABYCRKIKABABILIMIEIFRDYECLYBYBQCAHQMILQEQGQAJDADIFCLYMYCQKQJQIQAJHAKYCAGAMILIFSDYEBFALAMaBQCQKILIFIDSEYDAFBLYBAKYCAMKLQKZBALYMYCQBIKIFQKQHQKIGRAaHAIAJABAKAKIHRAIAQIaJAAJ',
  'GNRDqGBBMBACFCTCYCZCKDcDkDCGBIIIHIESCYCQJYMZDAGBKYLYFRDIGIAIJICIMIECHYIYKYGQLYMICAIABZFQDQGRDYFCGIBIDRAIIQCQJICIICBYKYLYDYGYFSAIJIDBKIIQMYJAAAFAGABJLQIQKQCQDQAaJQMJAAIAJZFAGAKYBALKKQCQKIIRJYDAJQAQMZFAGABALAKJCQBYKYLYFSGIDIDAJJAQ', 'GNqDIEDBUBVBhBSDYDaDiDEEkEAGFYAYJYLYERDIGIBIIIHIFCAYHYIYJYLYEYDRGICQGQKQMKBAFAHAIZCQCYGYKYDCEIGILICRIJHQBQFQMaDAKAGAGYEBIIHILICIAIJIFSBYGYHYIYEYDRKIGAIAHJBQGZKYDBEIGIHIIIBIFCAYJYCYLYERDRKIMIFABYCBLYEYDRHIIICICALAAJJQBQFQMYCALAAA', 'GJqDDGNBlBcCLDTDZHAIAZDAHYEYDYCSFIGIEBAKHQIQBaEAFAGADADIABCZDRAIAACIESAYFYGYDDAIAQGQGIEBCYARGREICCAYGYCQDTEIFQBKIAHAAaGQGYDYDBERFIGIGAAKHQIQBaCBDYFQCJDBCYFYFQCQDQBKEBIAHAAaGQFQFIGYFQHJABGZGAFbERHQAKIQBaCADAAAAIDRCYABDICRAY', 'GLABoGTBYBMCEDrDZEQGjGBHEICICAGIBIDQIIARKYFYEAJAGABJHQJZEQFIKIABDBHYBYGZCRERFRKJAJDBAYIYFYKYECCIGIJIHABZGQJQFQFYIJHAJZGABKJQHQGYCYIZCAGJFQCYGAFJCQCYFYGYGAFABAJKCQHQIQGaFAGIIKCAHAJaBQIQFQGJCAHAIaBAJKIQCQHQGaFABAJAIKCQHQBaFQGKAQ',
  'GLACSDFBaBBCECVCqDsDbEYFBBDBJYFRBIDAJAHAIZFQGQCQCYGCFICSJIJAHAHIDSBYJYGYFCCIFQIIDQHYGRBJGAJAHADADIKIASEYHYJYBYFACAIIDQGYCYCBFRBIGADADIGSHIJIEIACKYGYDYCRIYFQHJJQBZHBJJDBCYDYJYFBIICQFQJQHQBJDADIGCKIASEYGYDYDQBZHAJACACIKIAIESGYAC', 'GLEChEFBIBJBADYDCESEcErGBYCQIQHQFJDAEAGABAKaJQAQFJHAIAJYCSAIIIBIGIDSEYDAHYFYAACAIAJAKKBQBYJYCYKYASIIGIDIERHYFYIAGJFRIZGBABCBJIKIBIERDYBAKZARCIFIBAKIEIDRBYFYCYJYCRGRIJHJBBDBEYFYGYAAJYKIJQFQFIDIEBJYFQKYAQGIHRBJDBEBHZBRIZGBCBCIBI', 'GLFBYCLBaBbBMCDDkEAGpGIHARDYEYCRGIIIKIBCDYEYCYJYHYARFIHAJJDQBQEQIYGYFAAAJICQKIBIDCEYCYHYAYJYFSGIIIDAEBCYBRKYABAIHIKIBBCIERDRIYGYAAFAJICICAEIDRBYJYFQAQKYAYEAFCHICIEIDIBRDAJYHQAQFQGIKYCCAYAQCQCIGYFAHAJJDQEQKIBBDYEYAYHYJYFSCIKIBI', 'GLUCBEABQBRBlBSEgHMDrDDGFBJIHIDRCRBYIZKYFBAIGIEICIDBHYGQJYAQFQFYACGIEICIJIHIDRBRIZKZEBCIBIDBHYCRIIERKJDBBYEYCCGYJYASFICIKIIAEAEIBIDRIQKaCAEAFAAAGAJIHIDRBYGYCSFYABCIGIBIDCHYGQEQFQJYCQAQKKDABYIAEYEQFYIQKZAAAYCDGIJIFSEIBIDRKYEBBI',
  'GMDDcDNBaBCCTCLDYDgDAFoGrGAIBQCQGIFBBYBALAKKDQIQHQBaEQFQAZGAFIEIDCKYLYCRFIEIBJJQAZGZEABIDQGQAJJAHALZBQDIEQAJGADAHJJQGZAZEAFAHJDQAQGJJALAIAKZBQIKLQDYJQGZAADAHZEQFQAJGJJAHZDQGQAZEAFACAIABAKKLQBaIQIYERAIGIDBHJBAHABJJRDZAZGAHABAHIAQ', 'GMMDSFABUBgBhBQDYDkDqDsDBHAADADIIAKAJJBQGKHAHICRLYAYDAGAIAIYDRAIGILICBHYHQIaBAJZKQBIDQHIIIEBFYJYJAKaBQGQGYDBBIHIJIKIFIFAKZEQIYGYJQHQGQIKEAFAHZGQFIEICRLYAYDAIABAFIJJGQHJCQEQLQAaIAAIFAHAGAJZBQFILICCEYEAGZHQLQAQAICIEBIYFABAJJHQLYBY', 'GMUBQCEBZBBCNCaCCESDoDjGrGBBDYERFAHYCYABIIGAIQIICRHIEBDIJIBSEYDCGYCYCQIYIAIYARHIDIGBCYIQKYFRHIDIGIEIBCCYIYDRHYFBKIJALaKQAQDQFRHIGIEIBICCIYJYDYGRHYFBAIGIDIIIJICSBYEYHYGBDIIIJIERHYGYDCAYFRDIGIHIEBIYJYAYAAJJIQAYJAIJAQAYIYJYGRHIEIAC', 'GMpDKGUBACJCNCCDEDjDSEgGrGEAIIKIDSEYBYCAGYHYFAIAJYIYKJJQBQGQGIHZCABIHIEIDCAYJYKYLYFSCICQHJGABAIAKALAAKJQKZIQBQGQHZCACYFCIIKILIJIDSEYBYCQGYHIGABAKAJAAZIYLQFRIQCQBJGQHZBAGKKACYJAAALZFQGQKJJAAAIZCQCICQAJGYJQKZFBCIIJJQGZAAIACYFRAIAA',
  'GNDBgBbBICNCADEDTDhDkDsDJFpGFIDABAMYCQHQAQAIGYEAHICCHYJYERMIBQDQFYGYAAAICICAHAJAIJLQGQGYCYFIDABAMYKYEQHICQFJGALAIZJQCQFQGJLAIAJZCQCIHYEAIIJIBIKIMIDSLYFYGYAYEBCIHYASFIGIHILIDCBYIYJYAYCYMYKYESFIGIHIACHYEAIIJIBIKIMIDSLYAYFYGYEBCIIIAR', 'GNDDZGABQBiBLDSDgDoDBEUEjGrGAIFIJICIDBGZJQAZFAKABJEAHAIAMaLQBQKQFQAJJAEAEIGIHIIIDSCYGYJYEBHIHAIABZKQHJERGIJICIDCBYEQGIIYIABAMALaKQHQGJJQAZFAGAHAKALKMQBQIQIIDRCYJYEBBIDQCQAZEQFZGAHAKABJIQJQFQAJCACIDCIYJYEYEQFQAQGZHAKABALAMKIQJQFZAQ', 'GNdBaCYBcBjBFCLCZCDDsDAGIGQGDBAYFRIIGAEAJYFQDIABEIGRIYDAFAJIGQLIMICBHYBYGYEYARJYFQDQDYFCAIAQDRFQIIKILIMICIHCBYGYEYDYJYAYAAFRJIEQLIMICIGBEYJYAQCRLYMYFBAIDICIJIEIEAGRJYLYMYDBAYFRDIACCIEIJIGIBIHSLYMYAYCBEIARLIMIHCBYGYAYAQEYCRLIMIGBAY', 'GNiBEDLBMBACYCZCaDcDjDJEBGrGDICIKIGBAYJYIQCQDQBQLJGAAALYMZIQJJHQKQBZCADBJAIAMJAQGQLYCAJAIAHJKQJZCQLIGAAAMZHQIQCQDRBJJAKAIZHAMJAQGQLYBAJJKAIAHZCQDQJQBQLJGAAAMZCQDQIJKQBZJAIACADAMJAQGQLZJABJKAHAAIGRKYBYIYDBCIHIAAHQIQBQMYCQDQJQLJKAAA',
  'GKQCEEABTBBCKCCDhEUFrGAQCQDQEQGZFAFIEICIGIACHYHAJaDQFQIQBQGKCAEAFADADYFSEIDCHIARCYDYEYFCHIDSCIABDYHYFSEICIAIDCHYCSEYFCCIHIDSAYEYFYCCHIDIJIASEYDCHYCSFIDIEIACHYDSFYCCDICQHIASEYFYCYGZBADBHIIAJJAIESFYACHYDRCIJZIQBQGJAIFIECHYDYCRAI', 'GKZEBGVBYCIEjHEDbDLGSGAQBYGYHZIYCBJIJQCQIQGQBKEAEIDCAYFYHYJYCSGIIIJIHIHAJaIQHKEQBZGAHAIAJKEQHaGQBJHAEAJaIQGQBQHKEAGaIAJKGQEQHaBADQIAJAGKEQHQBaIAHKEAGaJQHQIQBKEAHaJACAGJHQEQBaIAJACAFIAIDRGAHJEQBQIaJABKEAEYBYHZGQBQJQIKEABZGAHJAA', 'GLdCYFBBACCCcCMDaDiDqDTGCQGAKAAAFAJJIQHQEQGaKAEICICQGQKZABFBJBHJIJCRCIBIBADSGYDAKYEACAIbHQHZJRCJERFRGKGAKQGaEBFBCZJBHJCQEQJQAQFQGLEACAKABADAIAHbCQEQCYJQAQFQGQKKBACADAHJIQCZHABQHYJZEQFQGYKZABFIEIJIIICQDQKYGABIDICCHYBQGQGYIYJYEQAY', 'GLgBLDFBQBhBkBiDqDUEAHRHBAFIGIHIEIAIDRKYIYFBGIHIEIIAEAHZGQFQFYCSBIIIECHAGZCQFQIQIYCCFIFAGJHQIQCYEQBYFCIIHAEQGZIQCQCIEIKIDBAYGYHYIYCRFRBIJIDBKYEYFYCCIIERKIABGYHYEYIYCSFIKIAIDRJYBYFBKIEBGIHIDRAYEYKYFRBIFAJIABEYKYFYCCIIIAGKHQKQJQBa',
  'GLkDAGDDQDYDgDiDpDKFMFrGCIDAEAFAHYHAKaAQJQCQBKDAEAFAHAGZIQCZJAAAKKGQHQFQEQCZIAHJFQEQCQDQBaJAAAHJFJGAKaHQAQJQBKDACAEAGAFZAZHAKKFQAZIQCJEAGAAAFAKaHQJQCJEJDQBaCAJAHAKKFQAQGQDQEZIAHZJQCQBKEADAGAAAHZIQDJEQBaCADJEJGAAAHAFAKaJQDQEJGJAA', 'GLlBACCBSBbBgBBCcDhDpGDIFAJYEQEIIIFIJIBSGYCYDBHZAAEAJJFQCRDYKYACEIEAHIIJFIFAJZCQIQHQHIFICIDSGIBCDYCYDQFYHYHAIAJJCQFQHaFAFICIDIHIBSGYKYAYEBIBFJHJCADAHQJZFQIQIYFBHIHQIQAREYFBAIIAHAHYARFREIKIDCCYCAHZAYIYAAJJFQHQIQIYAYFYESKICICBIBAZ', 'GMCBdCABBBTBUBjBkBhEQGYGDHIYGYERJIKICRDYAYLYBCHIEIGIIICRDRAYLYFBEBGIIICIDRARLYFYEBGBHYBSEIGBJJKIAIDBCYARJZKYHBIIAICIDRJYKYFRGYEYBCIIFRJIKIDBCYAYFYIYBSEIGILIDBCBAYFYIYHRJJKIFBAICRFYJZKYHBIIAICIFRDRLYGYEYBCIIAICIFIDRJYKYABIYBSEIHBAI', 'GMKBcCJBbBlBNCLEEDBGYGgGpGCYAYGYBBIYHYLYDQDIJIKILICSAYGYJYBYDCEYFRDIBIGIAIJICCKYLYEYBRDYFCBIEIKICRAYGYDYECBYFSEIBBHIKILJCQCIASGYDYJYBYBAEYFBJJAACAKILZKQJQJIDRGIABCYDYJYJAKAKYFREILJCQDQJZBQBIGIAIJICCDYDAKYLZBRGIAICIDBJYKYBYFYESGIAI',
  'GMhBUCCBVBlBTCYDAEDGLGQGqGAYGIGQKQCQHQIaJABAFALYEYDRBIFICIHIKIACGYKYLYEYEALJFQGQKQAQHQIQJaBACACIIIEAJIABHYEYFYCSBYDDCIBRCQDRIJJJEBHIAREZIZJZDBDYCDBIFIHIAIKILIGIETAYABEBGYHYKYFYBYLYCTDIDRIJJJAJEBHYARIZJZDBDYCDBIFIAIAQHIERIYJYDYFBAI', 'GMlBACDBSBYBjBkBBEEEhETGbGDYEQKYLYABGIFIJIEIBSHYCYIYABKILICRHIBCEYDRCYKYLYARIIHICBDBEIBSCYDBKZLYAYGBFIARKJLIEBJYAYFYGRKILIEIDRCIBCJYERKYLYGBFIAIEIJIBSCYHYIYGBFBAIEIJIDRKZLYEBAYFREIKJLIDBJYAYFYERGRIIHICIBCJYAYFYEYGRKILIABJIBSCYDBAY', 'GMlBgGBBMBCCDCICNCEDZDbEqGCQGAJYEQLZKQFQIaFAHAAAKALKBQJQGQIYEAKYDRHYACDIDAKIJIJABALaKQKIFSHYAYARDBAIHIFCKYKALKBQJQJYKYHRDYABHIKIJIJABALaKQDRAYHBKIFSAYDBFAKALKBQJQJYERAYFBKYHRDIFIAIAQIJCAEAJIGQCYEYAYAQIYFYDYDQHBKIJIEQFQIJCJEBGBJZAQ', 'GNRDoDABQBcBdBBDgDEEiEJGTGZGEQFQMJAQLZIQGKKALAAAMZIQLJAAMAJABJHQDQJYMYIYFBEIBIHIDQIQMJCRAYKYGYLYFBMIEABIHIJADICRJYIYMYEABAHJIQMQLQGQKJAAGaLAMAIAHZBQEQIIMIJICBDYHYBYEQJQMZFRKIAILIGICBMYIABAHJJQMQCQGQAQKaLAFAIAMKCQGQAQKQLaFAIAAKGAMZAQ',
  'GNbBIDLBcBCCADMDQDDGYGgGoGrGDADIAIAAKKJQEQHQBQFQIaGAAADAKAJKEQHQBQFQIQGbAACADAKAJAMALKEQHQBQFQKaAQCQGKIAKAEAFABAHALaMQJQAQCQDRKKIQGaKAGIIKEAFABAHAJaAQCQDQIQKQGKEAFABAHAJALAMaAQCQDQJKEQHQBQFQGbEAKAIAJAHLBQEQFQGQKaIAJACBHAAADAMKLQBQBJ', 'GNoDCEABBBSBlBTCUCQDYDhDEEqGFBKYMIERIIJICRDYBYLYFBHIGIIIJICIDRBYLYGBJIJQIQIIEBAIKIDRCYEYIYIAJAJYGRKILIBICBDBAYAAMaGQHQIJJAKAAJEQJYIYMIDRCRBYLYFYHCGIAIKIEIMIDIDAMZAQCQKQIQJJDAEAKZAAMJCQDYEYIYJYFRLIBIDBCBKYAYKQCQEQJZIAAAMAKKCQEQJQIZAA', 'GJDHhHdBgBUCYDsDIESEAYCCEIHAFAIIFIDBBYGYEQCQIQFJDJHRAZFBCZECCIIIDIDAIYESCIFIDAIAIYCYCRFRDJAJHBIZCYCACYFYDQGBBJIRHRAZFBDZECBICRGIDQDYFRAJHBDZCBIIDRCZIBBZGRFQFIFQIJCJHRAZIBFAFYFAGBBJCRHIDBCZHRFZGaIRAJDBCBHYBYESAIFBGBIZAQFKGAIABA', 'GKABjBBBVCKDbDsDEEoGQIEAFABABIGYDQFIJIASCYCQEZHZFBBBBIJIAICRERHZJAGAIJAQCQEQHQFbJAEKAACAIZGQEQJQFLHAAACAEaGAIJEQAQCQHQFbJAGAIAEKAQCQGaJQFLHAGAAACAEaIQJQHJGBCBAYJYBYBRFRHJGJCAAAGYJAEAEJARAICTJYFYHYDCBIBQFQFIHQGJJAAACAEAIZBZFREJAI',
  'GKgBMCFBVBkDpDrDAECGRIABFYGYEQDQCQIIHIABJYBYCYDBEBGJGAFLBRJQHQIZCADAEAEYDRCIEABADYCRIJHAJAFbGQGZCRDIBIJIASHYEYBACYDRBIEICBDYHIACJYCYDBGJGAFLJQAQHQIaEACAJIASHYAACYEQIKCAHAJAFbGQGZDRDIGIFIAQJIHRCZEZEAJAFAFJAJHRJYBYDCFIGIAIHICTJYAC', 'GLBGaHABQBlBJCKDrDEETGoGDQCQAYFQGYIYJYEDBIJIFIDICRDAGYCAFAKAHaBQJQEQIQAKFAGACADAJaBAHLKQJQCQDQFQGQAaEAIABAJKKAHbJQBQEQIQAKFAGACADAKAHAJaBQKKCQDQFRGQAaEAIAKABAJKFQHQCQDQKaEQIQAKGAKACADAFAHAJaBQEQIQAQGLKAAaEAIABAJKFQHQCQDQAQKQGbIAAJ', 'GLJGiGhBACYCdCBDMEDGRGZGBQKIKQJQAQGQGIIZHAAJJICCAYEIDSCYGYIYHYFCBIJIKIEIDICSAZCAGYHQIJGAAADAEABaKQJQFQHQAJIIGICCDYEYJYEAFQAIEIDICSGYGQCAIaAAFAJIEQGKDAEABAKaJQBKDQEQGaEABYFQAQIKGAGICBDYEYAYEQFABIEIDICSAZGYHAIYFABAJAKKDQEQAQGQIZHAAJ', 'GLNCQEgBkBlBSDiDDGaGpGAHFIFAGYIADADYEYAREAIIBICBGYJIGQBQCQIaABDAEAJIJAGLBQCQIQKQHaAAFADAEAIKBAGaCAJQIQAQDQEQFQHKKABAGAJaIQGKBQGYKQHaFADAEAGAIAJKBQGZDQEQFQHKKACAGABAJaIQDQEQGJBAJAIaDQEQEIDIGQFQIIJICRBYFYGYAYECDIARFIFAGAGIBICBIYJYAY',
  'GLQDDGKBTBZBMCNCYCpDAEjHCRAIDAJIHCEYIYCQAQJQBZFAAJCACYKYGRFIBIDIJICCEIHRCYBYJYDYFYGCKIEIEQAZDQFQGQBJJAAAEAEYIIHQAYDYDQAJHAIYDQAQJQBZFAAIDAJIEBDYKYGRFIBIJIEICICQBZJAAAKAIKHQCYDBIZKYGYFSAIJIEIEAAZFAGAIKKQAQAYDICIHBKYETDIDAEBKIHRCYAB', 'GLTBICADcDgDkDoDREiEEFJGFQDQJQCLBAKAAAHAEAEJGBIZERDZAQGIJQCQKJHAGAIAEZDQAQGIIIBRHYCZJAFADJEJBQHQKaJAFADAEJAQIQFaJQFIKKHAGZFAAAIAEaDQJQCJFAAAGIBAEYDZJQCQFJHIBBIYDAAAEJIQBQGQGIHQKaFACAJAEJDQGQAQHQCaABHIJAGJHQAQKIBAIADZEZGQJQFQKJCAAZ', 'GLZBMFCBYBjBkBSDaDAFDGoGFIEIHQGQCQCIIIDCAYAAGYHZEYEAKJHQAQDQGQIQJaBACAEAFAGJKIHIHAKaFQBQGQEQCQJKDAAAHYIAEYGAKJHQAQAIDSIYECGYGAEQKAHKAQDQIQJaBACAGJEQEIIIDCAYAAHaKQEQCQJIDAAAHAHIKZEQEICSIIAIAADSAYIYGYJYBYFDEIEBCJGRHJBQIQJJAAAIDCIYBY', 'GMICEFZBaBgBjBkBADpDJGRGbGGIFIHJAAEAIYDQDICICQLZBQHJJAKALACAEIIIASJYHYKYLYBYGDFIFBDJBRKJLJABEBCYIYBYDYFRGRHIGAJIAACYERKYLYDCBIEICIIIASJYKYLYDYGYFCBIDSGYGQHYHQJKKAHaGADAGIHJIICQLIABCYEYDYIYBYFSGIGQHJLABADAIJEQDYBYGYGQHQFAIIBQLJDADIAI',
  'GMYBUCCBNBbBACdCDEZEoDRGqGCYDAGAHYBBEIIIAILIJIFSCYHYKYBYDYGBEIDSBIHICIKIFCAYIYDYEYJYLYGSBIECDIIIKICSHYEYKYDCIICIAIFRHYEYDYBYGCIILIJIFQKYDSEIHIKIFCAYCYDYIYJYLYGSBIEIHIKICCDYIYKYESHICIKIDCAIFRDYCYHYKYECIIAIKICSHYEYKYBYGCIIAILIJIFQKYAA', 'GNQBkDgBRCBDIDMDSDsDUEaEDGpGHAKABZJQGQHJFJABCBDABZKQGZJAIAMJBQBICRARDQFZGAKAIZJQHQGJFJABCBBYDABAMaJQHQGQFJKAHZJAMKBQIZHQKQFZGAJAHJIJBAMaHQIJBJDQMICRAREYFZGZJAIABJKQGQFJEQLaJAGJKABZIQGQJQLKEAFZKABAIZGQBJKQFJEQLaJABAGAIJKQBZGAIAHAMJDQBY', 'GNlBJGABEBQBkBNCRCaEoDqDBGSGFAGAAAKJJJERCRBYHQLYDYMYFCAYGRFIACIIMIHAJYKYGQMIHICICQEBJYEQHQMaAQDQFQLKBAMACAHAJIEQCYHYIYARDIIAMICAEAJYKYAQDQKAJJHQMICIEBHYJYKYAYCQDRIICIEIHBJYKYCRIYDBAICIJIKIHREYIYCBAYDRCIIIEIHBJYKYAYDYCRIIABJIKIHREYAYAA', 'GJLGoGACDDgDBERGYGbIGJFQDZAAGAIABKEQHQCQFQDQAaGAIAHKEABaHQELCQFQDQAQGaIAEAHABKFQEaIQGKAADAEAFABaHQIQDKAQGaDAAKCAEAFABAHaIQAQDQGKEADaAAIAHKBQCQFQDQEQGaAAIAHABKFQDQEQGQAaIADKFABaHQDQIQAKGACAEAFABAHaDQIQAQGKCAEAFABAHADbIQAQGQEKFAAZ',
  'GLAGgHTBUBjBFCIDZDkEKGQGAJGAJZCADAHKKQHYJQGQAZCADAHAKKJQHaCQDQAJGAHAJAKaCQDQHKGQAZHACADAKKJQGQAQHaCADAGKJAKaGQCQDQHKAAFQJAKAGaCQDQHQAKJAHaCADAGKKQHQJQAaCADAHKKAGaHQCQDQAKJAKAGAHaCQCYDQECIYEQFRAQJKKAAaDADIEAEICICAHKGQAQKQJaCAEAAJGABA', 'GLBBFBdBACRDYDgDoDLFCGiHCAFIKIGIHIDSAYAQEAJZIAFJGBHBKZCRCYBTFIHIIIJIAAGYHAFaIQJJEAHAHYIYGIAQEYJYBDCICBKJFRGRHRAJERJZEAIAHJAQEIDBFYGYARHZHAIQJJDAGAGIDREYJZIAGJAAFIDQHYABFBKZCRCYBTGIIIAIEIHIAADBKYCYCBBZGRIRAJCBCIJIBCJYKIDREYHYBYCYCRAZ', 'GLBDoGDBMBlBEDjEIGbGgGQHAYCQDICIFZCADAIAEAGABKJQKQIaEAGABAJKKQIQHQAQFZCZGBEZDRGIEBHJIJARFRCZEZGZDBGIHIFIIIAICREYFBABHZIZDRGIAIFIEICBHYIYDZGRFJAADAGAIKHQCQDYEQAZFZGAIAHKKAJaBQHQIQDIGQFJAJCAEAKAHaBAJKHQBaIQDQAQFZGADJKJCREYAYFYGYDBKIAR', 'GLKBQBEBFBADCDIDZFjGrGTHBRGQEQFZAAAIEIFIGIBDGYHYIYJYKYDTCICRAJEJFJBJGBHBIZJZDZCRCYATEIKIBRFYEAKAAACADAJKIQBQKYABCIDIBIIAJaBQDQKQFQEZAAAYCCDIDBBJIJJJHRGREZFZAZCZDBDYBDIIKIASCYCQEJFAGAHAJZIQKQBQCIABDQEJFJGAHAJAAQIaKQBQCQFQEZDACIDICBAJ',
  'GLNCJEiBlBTCUCZDrDDEgEAGAABYDAGYCCHIEQEYFYDYHYASIIIQKKBACAEAGAJAHaDQEQCQFQCIECFYCSIYABDICIFIESIYCCDYARCIIIECFYDYAYCSIIDCFIESDYIYCCAIFIEIDSIYCYKYACFICSIIDCEYCYFYASIICCEIDSCYDAIYACFIEIDIHJCRIYJQGQBQKZAYFCEIASIICBDYIAAAAYEYFSIIABDICRBI', 'GMABrDFBQBVBcBlBgDBEDESFoGDIARIYJYFCEYGBBIBALKHQHIARDYKYBYEYFRJIIIDBABHYLYGRCRJIEBFYCYGBBILIHIARDRIYEYJYGBCIFIKIDIABHYHALaBQBYCRFIKIESIIABDYEAEYKYFYGRJIIIAIDBEYARIYJYGBFIKIAIEIDRIYABKYFYCBBIBALKHQHIDREYKYBYFYCYGSJIAIIIEBDBHYLYGQCIFIAR', 'GMQBLDABFBcBdBRDBEgEiETGZGBAEQFQLJGQKZDQBIDYHICIABGYLYFCEIJIIILIGIATCYGYHYKYDYDAFYKILYECJIIIAILIGICTGYHYKYDQBZFALYEQFIDIDAKJHQBZDZFZEBFIKIDQBJHAGALZKQEQFQBJDAFYFAGKLAKaGQFQFIDIGIHIKILICDAYIYKYLYDTBYEAFYGAKKLQCQHQBaFAFIHIHAGaKALKGQCIAC', 'GMlBIDaBgBFCADQDYDcDjDpGCIIYAAKJCQCYKYAQIIHJCADAKZJQHQIZAAAYESLIBIFIGIDCCYCAHZIQGQGICIDRBYFYLYECAIAQGJIAHKKAJaHQJIKJDRCYIYGYAAHIJIDICRIYIAGaLQFKBAIAGACADAJZHZAQEQFIBJIAGACADAJAHZKQLQBQIJGABZLAKAHKJQCQDQBQGQIZFZEAAAHIJJCQDQBQGQIQFZLABK',
  'GNKBdBLBUBgBFCRCAEaDpDCGiGrGDAEBIIAQJYMYBQFQKIHIEBGYAYAQHQIYDQKZFABAMIJIGQEQKYCACIHIEIKIGCAYAQERGQHYKYCYCQKJDAGAAAIIJYMYBQFQKIHAEAEIAIGRHYKYEAFABAIYDQMIJIGQHQKZCACIEIHIKIGCAYAQGQIYKYEADYLYBYBAFRCIEIDBBYLIERDIKIBAGAAAIIAIGSHYBYKYDYEBIIBQ', 'GNYBcFBBNBSBTBACRCEDiDoDqDKGIZDABALJKJAQGQHQCQIZMAEAFAJAKALZBQDQFIEICIHBMIIIGAAALZHQKQJQCQIQMZDAFABAKJJQCQCIHIAIAALAJZKZBQDQFQMJIAAALAJAKZHQEYCBHIJIKILIGSAYAAEYCYGAHBJIKYJQLQCQEQIQLIMZDAFABAJJLQCQHQIIEACYHYBYDSFIFQIIMJEAEIAIGBCYASEYHBAI', 'GNcBACSBVBbBRCYCBDTDpDEEJGrGCQDQIYKQHKLAFAIACAEAJAJIMZAQDQFQIYKQHQLJIAFAHZJYEQKAAADAMJJQCQFQHQIQIILZFAKAHJCAEAJAJIMZAQDQFQHQIYEAKQLJIACAFAHZAADAJYMJJQHQHYERKYDBAIEIHIHAJAJIFRCYKYEBAYDREIABHIJIFICSKYAYEYDBHIJIARKICCFYAYHYJYDREIKIABFICSAY', 'GNgBMESBTBcBdBhBDDiDQEAGJGrGHILYDBCIJIABGYIYCQDQMZEQFQBQHQKKLAAAGAMYCQDQHaBADACAEAFAMKGQAQIQJQHQLQKaBADAHKDQJAIAMZEQFQHQBQKKLAAAGAJAMYCQHaCAEAFAMKGQHYIQCYDRBYFBEIDICIHIGAIAMaCQDQEQHKCAJQMIGQAQLQKaBAFAHADAEAMJIQJQHaBQFQKKLAHAHYBYDBCIJIAI',
  'GNkEJDABRBUBFCQCaELDSDoDqDBGDQFQJYMJBAJAHALAKJDQGQCQBYHYEYMYFAAAKJLQEQIQJJHADAEYAYLYKYFSIIJIHICIMIBIGCDYCRDQGQBYHYIYJYMYFCAIEIKILICQHQJZIAEALAKZAQEIHICBDIGRJYIYEAAAKJLQHQIQJJCAGBDYHYAYLYKYFSEIIIJICIMICAIZAAKALJHQIQCQBICYGAIYAYJYEYEQJJAA', 'GLDDaDBBCCFCcCdCLDTDiEQFCYKQDYAYHYIYFCBIJIKICTDYAYHYIYFYEYGCBIJIFSAIHIIIDICDKYFYBYJYGSEIAIHIIIFCKICTDYFYAYHYIYEYGCBIJIKIFSDICDFYCQKYBYJYGSEIAIHIIIDICIFCKYDSAZHYIYEYGCBIJIDIKIFSCYHYIYDCBYJYGSEIDIHIIICIFCKYBYJYDSHIHAIABABIIICICQAQHZIAAJ', 'GLEBgGABQBBCFCCDKDSEcFpGAQBIDRCREQGZHAHIGICBDBBYIAKYJYFSAIAAFAIIEIDICRGYGQHaIAHIJAKKBQEQGICBDYEYJYFYASIIGIHICIDBEYCSGYHYIYACFIJICIEIDSGYHYCCJYFYASIICIGIHIDCEYJYCSIYACFICIJIEIDSGYHYIYAYFBCIASIIGIHIDCEYJYAYCYFRIIACJIEIDSGYHYAYIYFBCIJIAS', 'GLYCUFBBCBEBRBACDCaDhGrGEIKZBQHIDICIFBIYDRCIFIGIACIYDYJYKYBYETHIBACIEAFIDBKKJQBYEYHRCIECBIJADRFYEYCYHBKaBQBIDIIIJIKIASGYFYEYDBIAIJERFRDZCZIBEIEAEIFJCRDIGIACGQJYAQKYFRCIDRIaCBCYEAFDBYBAKKHREIFIJQDQCQIJAAGADZCRCYBYBAFSEYFAHBKAJKCQCIGSAI',
  'GLkDLGUBVBBCICCDEDSErGgHAYBYEQFAGYHYDBCICQDQHIGIEAIIKAJaAQAIIQBQGQHZDADYCCIICQJIKIFSEYBYDQHJGABAKAJAAaIQCQDQHQGJBAHaCADAIAAKJQKQHQBQGaCADAHKKAJAAaIQHQCQDQGKBAKAHaIAAKJQHQKQBQGaCADAIAAAJJHQAaIQCQDQGKBAKAAAHAJZIQAKKQBQGaCADAAAIAJJHQKQAa', 'GMABlBCBFBVBcBQCDDLDoDqGRICYHYIYFCLIGIASCYCQHZIYFYDYEBBBKIJIAQCQIYFYDYEYBBLIFSDYDQHJIACAAAJYFQDQHQIJGBAICRGYACDYDQAQFBJICQFQGQIZHAAIDBFYARHQIJDAFAGACAJYAQFIDSGICCDYCQGRIZHAFAAAJIDQCQIQHZFAFIACLYBSEIFIAIHIIICBDBJYKYBQERFIAIHIIICIDBGYLYAS', 'GMABlBZBaBkBoDqDBEDGLGQGTHCYDYGAFJCQDQKQAQHQIaJALAKKCADAFZGQDICIARHYDBGADQFJAQCQHQIQJaLAKABAEAFJGQDQDIHIABCYGYFYBQHQKZEAEIDIHIKIAIAQCBGYFYKYDABYERDIKIAABAFIGICRAYHYBYKYDYDQKJEAFIGIHACIARHYBYBAGAFZDQEQKQLQJKIAHAAACAFZGQBQHIABCYBYGAFJCQAQ', 'GMgDCGBBFBKBdCLDQDUDYDoDaICYIYDQBIEAEYBYDAIIHJCQEQBZGAHAIZDQDYFCLIAIJIKICSEYEQHZIAJAJIEICBAYKYLYFSDIDAJJIQHKBQGaHABJGICBEYIYJYDQHIGICIEBIYIQJaLAKKAQIQJQCQEQGZHZDAFAKIAJIQJQCQEQGQHZBALAAAIJJQAZLQBQHKGACAEAAAJAIZKZFQDQHIGJCAEAAAJAIAKZLQAK',
  'GMgECGQBbBcBiBdCADZDMEIGRGBIDQEQHIIJKICBLYLQCQKQHQBaJAJYGCEIDIFIAIIILICSHYKYLYIYIALKKQIaJQBJHAIAKALaJQIKHQBZIAJALKKQHQBQIaJAHKKALaHQJQIKBAGQKALAHaJQIQBKKAIaJAHKLQIQKQBaJAIKLAHaIQJQBKKALAHAIaJQJYDCEYDQGRBQKKLABaDADIJIJAIKHQBQLQKaJABJHAAA', 'GNBBdCABFBQBZBaBjBkBRDTGoGCHEQHAIAJYKYBALKEQFQGQJQJICRAYKYMYICBYDSIIMIAICBEBFYGYLYDQIRMIAICIEBFBGYJQLYBQKICRAYMYIBKICIAREIFBAYCYKYIRMIEICBAIFRCYEYMYIBKIAIFIGBJYAQKYIRMIEIFBKYBALIJQGQGICSFYEYMYIBDBLIJICQFREYMYIYDBBIHIAIGIKIFIERFQKYMYIYHCAI', 'GNQBdCCBiBjBFCcCADIDRDaDDEgEKYEBDIMIARJYKYCRLYGCDIERCIJIKIABMYEYDYBYFSGILIHIIIABJYKYCYLQHJIACAKJJQAQCYIYHYLYBCDIEIKIJIMIASCYCQIQHZLAJAJICIABKYMYEYDYBSLIHIIIABCYJYKYDBEIMICRARHYIYLYBCEIDRKJJQLQHJIAAAAICCJYKYMYDYEYBSHIIICALIAIJAKZAQIQHZLAAI', 'GNUBRCCBkBFCQCdCADIDaDiDDEpGJAKAMYDYARJIKICSJYLYEYGCAIKIDAMJBQFQJZLQHJIAJABAFAMZDQDICICQKZEQGQHJLAKACACYDYDAMJBQFQKZLQIJJAKABAFAMZERLICBDYEYAYAAGRLIEBMJBQEQFQKQJQIZCACIDCEYCSDIDQIJJAKABAFAMZAQCQDQIQHZLADICBAYDRLQDAHJIACAAAMJBQFQKQJQIZEBAY',
  'GNgBFCDBEBIBUBdBYDjDBEhERGrGHJEQJYCYDYFBLIEIABKYIYGYBRFIDICIJIABEYLYGAIIKIERARJYCYDYGBHILIAIEBKYMYBQLICSJICAEBAYCYHYLYBAMIKIARCYLYGRDIJIEICBABKYIYGQLIERCIABEYLYGAIIKIERARCYJYDYGBHILIAIEBKYMYBQLIAIEICRJYABEIEQLZBAMIEQHZGRDIAIJICBLYARDYGBAI', 'GOSDpDABFBMBQBbBcBBCVCKDCGgGrGBYIQLYEANYJQAJGAGYHYHAMJFQCQIQKYLYHBAYAQDQEQHQLKKAGAAYIAKYLYMYERDYJCEIAIEQGQJQLIKICAMIIQKQLZJAAIHQKILICIFCIYMYCRKYHAAYJQLIKAGAAYDRHIGIKQLZHADAJAEAMICQKQNIBIIQFQLYGAKICBAYMYDQKICIFIIBBYMYDYEYNYJSHIGIKIDCEYEAMJBA', 'GKoGDHQBRBaBbCSDgDUFIGIQGJFAAIJADAEBHICRHAHYERDIHBCBAYCQEYDRFQGbDBFAIAAKCQEQGQGICBEYGRCICQCIHRDZCBCYFYFAGAAZGIIQBQJKCAFAHJDQCYFYFRCJCQJaBADAIAAJFQDIECFYGYGQDRCYHADJCRHYHACAGAAZIQBQJKEAFAAYDQHACAGAGICRBZIBDJAJCQGQBQGIHQHIEIFBCYCAAZGQBQ', 'GLACbEBCCCVCTDZDLGgGoGrGAQHAEAFABAIKGQCQDQHaEAFABAIAGKJAGYKaGQIQBQEQFQHKAACADAJAIaGAKKIQJQAQCQDQHaEAFABAGAJKAQCQDQHQFaBAGAJAKAIKCQDQGZBQFKHAGACADAGYIaKQJQBQFQHJGAFaBAFIJAKAIKCQDQFQGQGIABCYDYIYJYKYESBIFIGIAICCDYASFYGYBYECIIJIKIAIDICSFYAA',
  'GLCCEFBBYBaBDCbCQDcDkEoGEYARCIHBDBEYAYCSFYGCCICQFRGQHJDADIECAYDSHYDBGACAKIAQEQHYFBCZIZIQFQGQHJDACAIYJAKJIQCQDQHZFAGACJDREIABIYFSEIDBEAFAIIARDYFYESFAGYCCEIEAIAGQHIIIFRDIACFYDSGYEYEAIACQDIGRHIAIFCGYDYAQHYCAIQEQEIAIDCGIFSDYGBHYIYEQIQAQCYBY', 'GLCEpGJBdBACSDsDMEYEaGiGBYCAFYGYDQHAJIJADAKAGABKIQIIESCYAYFYHYJYDCGIJIFIKIFQJaKAFKIABZGQFQKQJKIAFaGABJFQIQJaKAGABAFKIQGaKQJKGAIAFaBQEAKQJQGKIAFABaKQFKIQGaJAFAKABKIQFaJQDQGJFAIABaKQJQDQGQFJHIAICIEBIABAKaJQBKIQFZGAIYBYBAJAJYDRBIGIKJIQFQAQ', 'GLFBADIBVBhBiBECYDCFaGjHCIEYFYKYDRJIHIECFYHYJYKYDYATGIIIBICIEIJIHIFDHYJYKYDYAYGSIIBICIEAHAHIFREYHAFIERBZCAHYCYIYGCAIDIJIFIKIERHRBRCZFBFYIYGYJYADDIDBKJEJHRBRCRFYIYGYAYDBJYARAIGIIIFICBJIBBHBEZKZARAYDTGIIIBIFICIJIHIEDHYJYKYAYDYGSIIBIHAJZAA', 'GLNBRCDBEBKBaBYCbIIDTDAGAABQFQEQIIJICQKIGCBYEYERIRCZJZAQDQJAKJCAIAIIEBFYHYASDIDQIIJJCICQKZEAJAIAIICIEIFCBIGSFYEYCYFAIYIQJQKJCAEAIaCQCIEIFIIIGCBYHYAYDRJRCJIJEQIAKYCAJAJYCRKIEAJZABDYCRAIJJEQKYABJIJQAQIQKIEAIZAZJBCBDIHIBIGSFYEYIYAYAAIKAQBA',
  'GLQCMEABLBJCKCBDDDbEhErGAQCQGYFAHIIIDRFIEICIGIACJYJAKaDQFQIQBQHQGKCAEAFADADYFSEIDCJIARCYDYEYFCJIDSCIABDYJYFSEICIAIDCJYCSEYFCCIJIDSAYEYFYCCJIDIKIASEYDCJYCSFIDIEIACJYDSFYCCDICQJIASEYFYCYGZDBHABAIAJIKJAIESFYACJYDRCIJQAQAIFIFQGZAAEBJYDYCRAI', 'GLYDBGABEBLBbBFCrDJEcEgHAICRBYDQEAFAHIKICRAYIYFYERBJFAAIEAIACBKYHYJYGSBIDIEIFIIIIQBaDAEAFAGAHIJAKICRAYIYJYESDYGBEIDSFIFQBJIAJAAJCBAYKYDYFRHYEQGQBIJIIIIQBaGAEAHIJADAKICRAYIYDYDAAJJQBJIACBAYKYFYFQAJDQDYAYEYGRBIIICBDYAYAAFAHYGQJIAIDICRIYAA', 'GLsDAFNBTBdBMCYCCDEDKDhHDYFQJIDAKAAaEQCQFQJQIQHJDADIBIGCKYFYEYCREAJICAFAAKFQDQKQBQGQHbIAIZJBDJFBAYCQDQFQJQJYDBCBAIFQJQDYCBEIJIFBAYEQJQCQDQIJFAHIGAJYJQDQFQIYCAEBJIFQIQHJBAKAAaFQJQDQEQIQIIFBJZDQEQIQCQCYHIFAIYECDIIQFQHYEADBIIIQDQEQHIFAKJAB', 'GMADgDiBDCECFCICREJDoDbGjGLQKQDQEQAKGAIAHABACAJALaKQEQFRAIAQIKDAHACAJJBQCYJABJCQCYHQJYDQBYIaAAEAFAKALKBQCQKZEQFQAQIKDAHAJAKABAKYDRAYIYFBLZEQEIDIDQJJHQIZAAJADADYEYEALJBQFRAIJIDBKICAKQDQHQIQAaJAEAFAKJBALaKQBKHQBYIQAQJaDAEABAKALKCQHQIQAQIYBY',
  'GMIBcCaBBCCCTCdCUDoDqDDEYEKIFBCILIARDYEYFYHYKYGCBICIJIIILIAIDSEYFYHYKYCCLIAIFRKYCYGYBCJIIIFQHYLICSHIKIFCAYCYIYJYLYBSGIHIKIFIEIDCAYCYIYFSHYKYGYBCJILIFICIAIIIDSEYHYKYFCJYLYBSGIFIHIKIEIDCAYCYIYJYLYBYGSFIBCJIIILICIAIDSEYHYKYBYFYGCJILICIAICQBQ', 'GMLBiBIBdBFCMCYCJEjEADCGZGBYDQEQIYFRAIHICIKIJIGCBYIYLYFYDYERAIDCFIIIBILIGSCYHYDYAYJYKYECFIASDIHILIBCIYAYLYDSHIBICIGBIYAYDYFYESHIKIJIGALYDCAIIILIGSCYBYDYHYJYKYECFIAIIILIBSCIGBBYCSDYHYLYACIICIBIGRDYLIBCCYIYLYASHIBIDIGBCYIYAYFYESHIKIJIGALYAC', 'GMRCcCCBMBlBNCYCiDpDAESEDGGAIYHQKQCQDYBBLYFAEAHJIJAQGQJQLZBAKICRJILIGCAYCYIYHYKYEYFSBIDIJICBKYEYDRJICILIGIACKYCRJYDBEICIKIASGYJYDYLYBYFCEIBREQFQLJBAJAKAIAHZCQCIDSBYCCDIDAHJIQKQJQLZFAEAHIBRJILIGIACIYKYBYDYCRHYEQFQJILIBCIIKIASGYBYJYCBDIKIBR', 'GMYBFCBBdBACUCbCSDsDDEZEoGHYGAIYJYFBDYBSFIDCGIHIKICSHYJYDYGBKICIAIERJYDYGYFYBCIIKICILIEQHYDSHIJIECAYDYCYKYLYIYBSFIGIHIJIDCAIERDYACCYKYGRJIAIDIEBCYDSAYJYGBKIDIASHYJYGYFYBCIIKIDIAICILIESHYJYACDYHIEAKYLYIYBSFIGIAIHIJIEBCYDYKYGRAIJIDCHYKYGYAS',
  'GLBCcEDBIBCCECTCaCoDYErGFICIGBBYFRCIGIEIHCJIDRAYHYEYGYCYFBBIIIJIDIASHYDCJYBYFRCIGIEIDIHIACJYDSEYGYCYFBBIDIIYESGYDCBYFRCIDIGIECBYDSCYFBDIBIESGYCYFYDCBICSGIECCYBYDSFIGIEICCIIJIASHYCYEYGYFYDCBIJICSHIACCYIYJYBYDSFIGIEIHIAICCJYBYDYKYFSGIEIHIAI', 'GLDDrDMDQDYDgDiDKFUFAGoGAIBIDAEAFAGZHQCZAQJKDACZAZIABAKKGQFQEQCQAZHAFJEQCQAQDQJaIABAFJHQDJAACAEAGAKaFQBQIQJKAADZHABZFAKKGQBZHQDJCAEABAGAKaFQIQDJCJAQJaDAIAFAKKGQBQEQAQCZHABJGAKaFQIQDQJKCAAAEAGABZHQDZIAFAKKBQGQEQAQDZHAGJEQAQDQCQJaIAFAGJEJAQ', 'GLEDZFkBACBCTCYCCDKDcDMECIFQIQHQAZKAJAFIBIESAYHYIYJYKYCDFIBIEIGIDSAYHYIYECBYFYCTJIKIEIAIHIIIDCGYBYESJYKYCDFIEIBIGIDSAYHYIYJYKYCYFCEICTJIIIKIAIHIDCGYBYCYEYFSJIIIKIAIHIDIGCBYIQJZKQAJHAJAIABIGSDYHYAYIYJYKYFCEIKQAQHJJAAZKAEYFSHIKICDBIGIDSIYBA', 'GMLGiGgBVCQDSDYDaDsDDGpGAHFIEIHIGICBBZKYIYIAKKBQCQGQEQLQJaAADAFAHAIAKABKGQGYBYKZDRFIHIKILICBEYEQIaKAEKIQIICRLYHYDABIFYGICQKZHQFQAQJKLAKACAGYBYDQHZFQKKLQJaAAKADABIFAGICQHJLQKaAQJKKALACAGYBYDQHZFQAQJQKKLAAaDABIFAGICQHJAQLQKaJADAFAHAEABAGKIQBZ',
  'GMQBEDUBgBhBiBjBkBlBNCAHRHKIABLYCYJYICHIGICRLIARKYBYIAHBGICIFIEIDIARLYFCCYGYHRIRBIFALIABDYEYCYGYHYIRJILIAIDBEYARLYJYICHIGICIAIEIDRLYFRBYIAHBGICIFRLIDBEYAYFYCYGYHRIRBIKIDBEBAYFYCYGYHYIRJILIFBAIERFYLYJYICHIGICIAIEIFRDRKYBYIAHBGICIAIEIFIDRLYAC', 'GMQBbBCBgBlBhDpDrDAEUERGDHFAGAHZBQBIGIHIDIARFYKYJYEBBIGIHIDIDAHZGQJQKJFAAADYHYGYJYBYBAGJHJAQDQFQKZBAGAHJJQFJKIABDYJYGYHYERBIFIKIAIDBJYGYHYEYBRKICRIIDBAYCYKYBBEIGIHIJIARDRIYLYBBEBGIHIJIAIDRCYABJYGYHYERKIAICIDBJYARKYBRLIIIDBCYFZKYBYEBGIHIAIAA', 'GMgDDGABNBQBdBBDoDRETFJGqGAIEQCQFQDQKJGQBaKADAFAGJIAAALIHIHALaFQDQJQGQKQBKCAEAHYIAGZJALJHQAQEQCQGQIQBaKADAFAJAAJLIHIHALaAQAIHJGQIQLIEQCQBQKaDAFAJAHAAALJGQAaFQDQHQJQKKBACAEAGYIAAAHZJQLYFQDQKQBKCAEAIAAAHAGAGILZEQCQJQAJIQBaKAAADAFAJALKGQHQIQAZ', 'GNBBlBEBVBYBZBaBACRDoDCETEjEDBBBGQMIGIFIEIHRAYKYCYDYBBLICRKIAIHBEYFYGYGAJJCQEQIIFAEIHSAYFBIZEAJYCQLYBRDIKIGCIIHAJYCYCAMYBRDRJIHQIYKIGICCLYDYBBMILQGQIIHAJYLQGQKYBBDIGIIILAJJEQFRCYKYBYDBGIBRKICIAIHBEYEAJZFQIYLQBYGYDRKIBBIILAJJFQARCYBYKYDBGIIIBQ',
  'GNBEoGABUBVBYBZBlBLCMDDGQGiGBJFQGQLQAQCQKaJAJYEBDIIIAICILIFCGYBYMYHYDRERJIKIFAGBBYMYHYDYERIIDCHIBILICQMIGRCYAYDYLYIYECHIBIMIGICRFRKYJYEAHBBIMIGICIFRAYDYLYIYHYERHAJIEAIALKCAFAGABaMQLQEQHQIQJQKKAACADAFAGABAMaLQBKCQFQAQGQDQKaIAJAEAHABALAMKCQGQBZ', 'GNDDqDFBKBaBdBTCUCIDLDsDYFAGLABZEQDQJYKYFQCRAIAQMKIAJZMYDAAYCBEAFBKIBJLQJQIQMZAAGAHAKABJEQEIDSGYECDIDABZKQFQCQAIEADABAKZHRCYFBHICSDIERAYAQFAHAMJIAJALAKZBQEQGQAYDACABJGQAQJJIQMZDAAIGAKJLQIQJZDYFYGAHBCIEIKABZCQEQAQDQFQHQMKGAAYEAJAIALABZKQAQKIBI', 'GNJCqGNBbBcBACKCdCCDEDLDTDgEFQGQIZJZCAKYCYHCBIEIGQLYCSJIKILIGCBYDYCYEYHSJIKILIGIDCCYDQGRIJAAFAKYMABZEQGQLYHBEIGICIDRKYLYGBBJMQAQFQIZJZGACIHAEABIDQLQKQJQIJAAFALZDADILIMIFSAYIYJYKYGYCCDICQGRIJJAKALAMABZEQBIHQIIGBMIFIASJYKYLYGYCYDBMIGRJJKALAFABY', 'GNVBACFBUBaBbBYCZCBDDDqDJEkEDADYAYAAMACQJIDAFAKJEQEIHIGIBSIYLYHCEYEAKZFQDQJYCAMQAQAIDIFBEIHRJYDAAYCRDIJIAAHBEYFRAYCYCAMADQJIAAFAKJEQEIHSIILIBCGYHYEYEAKZFQAQMQCQDQJQIKLAHAKYFQAQLIHBEYAYAQLQFAKIEQHQIaJAJYDBCILIABFYLQJQIJAAFAHAEAKYMYCRLIFIEIHRAY',
  'GNZBdCYBbBcBFCKCDDLDrDIEAGoGDAEAGQJAMJAQCQKQIaHQLJIAHaDAGAJYEQDIGIHIKICCAYAAJYMZEQEYDSGIHIKICICQHZAAJYKAEAEYDYDAGRKIEBDYGYBYFSKIGBLIEADAJJMIARCYDYERHIIICBABJZEQMYGRHIHQIQIIDBAICRDYIYIAHAEAGAJIMICRDRHZIYEBAIDICBJYAQEQLYMYGQKYFCBIGIAIAQERKYGBAI', 'GNdCAGLBMBhBFCICDDZDbDjDJEqGEYIQJZCQDQHQBJGABYEAMZKQIJJQLQHZCADBIAKAMJEQGQBYCAIAKAJJLQIZCQBIGAEAMZJQKQCQDRHJIALAKZJAMJEQGQBYHAIJLAKAJZCQDQIQHQBJGAEAMZCQDQKJLQHZIAKACADAMJEQGQBZIAHJLAJAEIGRLYHYKYDBCIJIEAJQKQHQMYCQDQIQBJIYDALAEAGAJYMYCYAYFSDIAB', 'GKIDrGFBVCADDDpDTEKGQIGYBYDQCQFIEJAAHQIZCZFREJEQALCAFYIAJAGABZHQFQCQEQAQIKJAFaHABJGQFQJQIaAACAEAHAFKGABZFQHQCQEQAQIKJAGABAFaHQGKJQIaAACAEAGAGIHACQFKBQJQIQAbEAEZGBCJIJAQEZGZCADAGIHAFABKJQAQIZGQEKIAAAJABaDQCQFQHQGQAKJABAFaHQGQAQEQIKJAGaAQAY', 'GLZDCGLBjBFCYCADkDhEbGIHCIHQKIFBIYDYJQEQAJBIDAGIFAIAHbJQAQAICQDIHIIIFSKYDBAYDQEQBQGKKAFAIAHAJaAQAIHJIQJIFQKQGbBACADAEAGIHAAAAYERCIDIJIKIFCIYAYHYDRCYIQFQGYBYECDIDQHJAAAYHYDAHQHYDYESBICIDBAJGIFAHIIAIIFSKYDYCYEBJIEQIQAZCQDQBQGKKAAAFAIAJaHQDQAI',
  'GLqGQHABNBdBMCCDEDgEJGiGAIBIGYHYDAEAKIIICTBYJYFYEYDRHIHQGKJABACAIAAaKQDQEQHQGQJKBACAIAAAKaEQFRGYHYDBEIFIAIKICRIYHYHQGQGYFBEYDSFIGIEAGAHAHIIICBAYEYDYDAKJAQIQHZCQDAEAKAAKIQHQBQJaGADAEAHJIAAaKQHQDQEQGQJKBACAIAAAKaHQAKCQIQBQJaFAGADAEAAAHAKKIQAZ', 'GMADcDgBhBlBECFCaCbCCDYDJHLYIBEZBRFRGRJJJQALLAAYKAKICBDYHYEYEABZFQIQJYGBFIIIEIKIHABYEQIQKQJQJYIBEIBIHQJYKQIYECBIKIHIDICRDAJYCAHABaKQKYESIIHIHAJIKABJDQJQLQAaHAJIDABZKQJQHQAKLACADABAKZJQBJCQDQLQAaHABAJAKJDQBYHQAKLABACADYJYKYHRBICIDBJYKYHYEYIRAQ', 'GMBDgEbBACNCEDLDTDkDqDsDJFDQAYFZEAIAKAJJCQCYIYKYERGIGAEAHAIAKICICAJZKQCIEQJAKZCQIQHQGQGYEBCICAFIKJJQIQHQGQFQAKDAIYLABAHYJZIQHQGQGYCYCAHJGQCYHAGJIAJJBQDQLQAaFACACIFYCAHYHAGAGYERCIFIFQAKDAIILABABIDSJYKYEQCQAILYFYFAHAGAGYHYCYCQAQFJHAAZCACIGIGQAQ', 'GMFBYCABBBEBCDKDQDUDSEcEhHKQIQAQEQFJGAJAIaAQEQFQGJIIJAHJDRCIBCLYKYAREIHIIIDICRJYFYGYEBABKILIBSJYFYGYEYABHIIIDICIJQGZFACADAIaHQHYAREIDIDAHAIJCQFQGJJACYHYIYAYERDIABHIIICIJQGZFACAIZHQAQAYDYEBHIHAIKAQCQFQGJJACYAYHYIYERDIFIGIJIBCLYKYERDRFIGIJICBAY',
  'GMVCJGRBECICADCDgDoDqDsDaHABLICICQBQGQFJEAHAIAJZCQHIEQFZGABAHACAHIJJIQCYCAIAJZKZLYASDIBICAGIFIEAHIIAJAKZLQHQBQGQFJCABYFYGYDYACIILIJIKIESCYCQFZGABAIAHZLAKKJQHQIQBQGQFJCACIECHYIYKYLYASDIBICQFYGIGABALAHKIQIIESCYBYFYGYLYDYACDQGIFICAEAHIJYKYHQDQBI', 'GNABFBBBEBZBQCCDaDiDpDKEUEkECQFQAQGZJIEQHYKALYBRDIKICIAIGIFCEYEAJZIQHQHIARCYLYBYDRKIGICAAALAHAIAJJEQEIFSCYFAGYAAEAJZIQHQLQKYDBBILIAIEBHYHAIAIYMYBRDRJIFQCQGYAAKIAIEICIEAFBIYJYMYBYDRLIAREIGIFAHYAYLYDBBIMIARHIFQGYEYEQKYDBBBGIFAHYMIAIESLYBYDRKILAAA', 'GNCDkDJBLBSBYBACbCEDhDsDMFoGCAEYDYHBJIEQCQAYHAJABZKAMKEQFQGQAYJYHQIZLAKABJEIFIGRCYDYHQIQAJCADAGAJAEAFAMaBQHQJIDQKQLQAJIAJAEAHAMIGQCQIZAZLAKABAMJFQFIDSCICQJZAQIJJACACYDCFYFAMZBQEQKQLQIJJJCADAGAMYHQAQAYJQHAIZLAKABAMKEQFQAQDQGQCQIZJADICIGBFYEYHABZ', 'GNKBkDNCaCADCDEDLDTDbDoDIFrGBYLQEQFZAADAMYCRHIAIIIAQFJDAEALABaMAKKBQLQEQFZGZHAIACAKIBJLQEQFQGZHZIAAICAMIDQFJEALABZDQFQHQIZAAFIDABJLQEQHZDAMYCQAIIIIQGKHAEALABZKZCQAQGIHJEAKILAMZKABKMQKaDQJQFQIQHQEJHIDALAKAJaBADQHYMJJQKQLQEZHADAIAFABAKKDQLQIaFABA',
  'GNMBYCKBLBNCZCQDbDiDqDkEAGDGCQLQMaAADAEAHAKAJJIQCQGIKYERAIDILIMIBCFYCYIYJYEQHIGICAIAJZKQGQHZDRAYECKIIIJICRGYHYDYKAJJIQDQHJGACADYIYJYKYESAIHIGILIMICCDYDAIAJZKQGQGIDICRHYLYMYAYECKIIIJICRDYGYHYARLIMIDBGYHYAYKAJJIQAQHJGAAYCAIYJYKYESHIGILIMIDICCAYAA', 'GNVBiDUBhBYCBDMDQDqDKEkEDGZGFYFQLaGAGYABCIJIFIHIEBDYBYIYKYCRARGILIEAMYJQGQLJFAGaAAJAMKEQHQGQFQLaAAJAMACAHJGQMZCAKIBIIIDIERFYMYJQLJFAMAGAHZJQMJEBDYBYIYKYCRARLIFIMIFQLaMAAACAJAKAIKBQBIDIERFYGYJYAYCBKIHIHQJQFJGADBEABZIZKQAQCQFJGJEABAIZHQBJEQGZJABA', 'GNqDDGRBhBACYCdCMDSDUDiDBEaGAIHYKIDICRIYJYGBAIKIDICIFIESIYLYBYGAMICCDYDAAZKQMQGQBICAJQIKCQLQBaGAHAIAJAMAKAAJDQDICSLIMYGQHIBIECFYCYDYAYKYGRIIJILICCDYDAAZKQMQLQIZJAGAKIAIDQCQIYJYGALICIDBAYMIAAKaMQAKCQAYDQIQJZLAAAMAKKCQDQAZLQJJIAAACADAKaMQLQJQIJAA', 'GLUEAGbBiBICJDkDDEgERGrGDAHIBIEAIAKaCQGQAQHQBJFAJADADIIIERJYDACAKIEQJQFQBaDAHAJKEBIAKYKAGbAQCQJQDQHQBKEAFAIAJaAACAGLKQJQEQIQFQBaDACAHAAAGAKKJQGbAQCQDQGIHQBKFAIAGAJAKaAQCQGKCAIQFQBaDAHAGAAAKKJQIQGaDQHQBKFAGAIAJAKaAQCQDQHQBQFKGABZGYFZHBABCJDRAY',
  'GLcEIGQBRBaBbBgDSGoGrGDHBACADAGAHIEBGIIAJaAQFQHQKQBKDAEAGAHaAAFAJKIQHQGQDQEQBaKAAAFAHKCRDYEYGQFYFAGAGIERFYGAEIFRGYGAEAEIFAFICICAHaAQEQKQBKGACAFAHAIAJaAQEQHKCQFQGQBaKAHAAAEAJKIQCQDRFQHaKQBKGAHACADAFAIAJaAQEQKQBQGKHABaKAAAEAJKIQCQDQFQBQHQGbKABK', 'GLoDKGJBlBACNCBDDDTEqGYHFAIQBQHQGJCABYGYHYFYDDIIDQJIAIKIESCYCQGZHABAKAAAJZIQFQHJGJCAEAJYIYDSFIBICIKICRGZGQHbBAFADAKAIAJKAQAYCQIYDYJYFSKIGIGQHQBZHIEAKAGKCAAAIAAJCRCYAYIYGYJYDQGQKQBKEAHAIAAAAYGYGQAKEQIQHQBaKAAAAIDAIIJICICBGZGQCQIQAaKQBKHAAAHYBY', 'GMEDiGSBdBACJCqDsDgEBGKGTGEQJYAYKICABAGAGIHZDQBIHICSBYKYLYDDBICAGIHYGQBQLILQKQAQJJEAFAIAKICBIIESFYCYCAIABZGAHJBQIQCQCIFIECIYGZHABJIQEQLZHAGJIIERFYCYCAKZHALJIABZGQLQHQHYDRAIKICQJYAADAKAHAHYLAGABJGYIQCQKYLYDRARJJKJCBHYAYJYKYDCAIGILYAQHKLAAaGAAIBA', 'GNABrGLBNBQBgBiBBCECKCZCCDcEMYDRIICILIJAGABYDQIQLIJIHIKCBYGYMYDYIRCIDCBIMIGIKSHYJYDYCYLYICBIMIGIJSDYDAGBJABYMYISCIGILIDIDQJBMYGRDIJIHIKCMYJRLYCAIABIMQHQKQLZDADYGCJIDSGYGQLJHAKAMABZIQCQJQCYICJIBIDIMIKSHYGYCYDBMIGRHIKCBYGYMYJYISDICILIHIKIAIEBGAGYAS',
  'GNDBYCEBFBRBSBhBiBjDrDTGbGAHIIJIHIFRKYLYDRCIAIMIBCGYFYHYIYJYDRCRAIMIEBFBGIBSEYBAFBGBHYIYJYDYCRARMIFIGBKYLYAYCBDIARKILIHBIYJZAYDYCRKILIFRGIEIBBIYFRKYLYCBDIAIFIIIBREYGYMYCBDBAIFIIIJJHRKYLYFBAYDRFIKILIHBIYJZAYDYFRCRMIGIEIBBIYAYDYFYCRKILIABIIBREYHBAY', 'GNYBDDFBdBhBiBACLCUDZDjDBFrGAQJYFAMYDQIQCQBICYHAIYDCIIKIFIJIMIEIAIGSLYHYFCIYFQKYDRCIFIHILIGCAYAAEYMYDQIIJIEAMZKQJQJIEIAIIYDAKIMIGSLYHYFYCYDBIIJIFRHIECFYFAJZHQBYDAIQCQCIHIFIFAJAEQBYIZHQDYCBHIIIJIDQBIERLIGCAYEYIYJYDRFIMYKYHQCQBILIGIACEYEAIZGQJQLQBa', 'GNdCYDNBjBkBSCADCDEDLDIETEoGBQKQJaLADAEAMJBQKQJQGQHZIZCAAAMIFQLYCYABEICSIILIFCDYCYEYMYASIILIFIDCCYDQFRHJGAJAKABAMZEQFQLYABEIFICIDRLYFBMJBQKQJQGQHZLAJJKABAMZCQCIDIDQJQLQIZAAFAJJDADYCYCAMJBQKQGQHQIZLAGJKABAMZCQEYJYASFIGILIDCGYJYEBCIBJKQGZJABACYERBI', 'GNhBNCABMBbBQCEDZDkDqDsDBGJHFQCQLYGYBAIAKAJJEQEYIYJYKYBSDIDABAJIMICIFBAYEYKYKQIQHJEAEIKYCRJYBQDQMYDYBCHIIIEICIJIKIAIAAFRKYJYMYEBHYIYBSDIEIGILIMIFCAYCYHYIYERMICBAIFSCYLYGYMYDYBCEIDRMIABHYIYDYEYBSGILIMIAICIFCHYIYARKYJYEQMYBBEIDIAIHIIIJIKIFSCYMYDBAI',
  'GOEBICRBSBcCdCADCDgDiDoDqDJGTGAIHIGIBAMICAIAJZDQDIIIJIBRNYAQHIGICACYGYHYMYNYAYFCEILIARKIBQCQMINICIBCIYJYDYAYKYLYEYFSHIGICAMINIDBIIJIBRCYDYGYHYMYNYFCEIAIIIJIDRLIKIBQCQCIBCDYCRMYNYABIIJICIDIBSGYHYMYNYAYFYECIIJIARLIKIDQMINIBBDYCYAYIYJYKYLYESFIMINICBAY', 'GOEDpGABMBgBVCQDSDbDhDsDBGJGYGIQNJEABYKYFQDIHIGICQLYAYDAHIGIMICIEBJYJAIaKABJIQKaNQJKKAKIERCYGYHYDQAILICAGYHYMYDYFBBIIIEQKYJYNYDRHIGICQLYAYFADIJIKIEAIYBYDQJIKIMINIEICRGYGAHaMQAQLJGAAaMAHKAQAICBEYKYJYDABIIIEQCQMZHAAJKAJZAQHQMJCAEAIYBYDQFQLIGICAEANZAQ', 'GOIDoGCBFBMBRBSBLCQCDDcDkDhGrGAADQFAIAJIMYHQCIAIGAIAMABANaHQCQJYDALQKQEQEICIHBKYEQDQJIHAKALYLANKBQMQKaCQHQJYDAEAKILIHQJQAJFAGAKAMABANaHQLQCQKJFQGQAZJAKACAHALANKBQMQFQGQAQJZKAAJFAGAMABANaHQLQCQAQKQJJFAGAAZCAHALANKBQMQAQAYFQGRJZKACAHALYEQDQKIHALAMJAQ', 'GObGrGMBNBQBRBaBgBIDKDSDAGDGjGGQAYGYBYNYDSCICQJJIJEAFAAZKIKQIQIIFIEIJYCAKIAIHCAYGYBYKYNYDYCSIIJIFIEIHIKIAIGCAYBYNYFSIYJYKYCCDIFIBIKIAINIGSAYHYEYIYKYCQJIIAKAAJEQHQIZJZCAAIEIHIGBBYJIEAAYNYFYDYCSAIEQJYKIKAAACADAFABKNQEQGQHQAaCADAFABANKEQGQHQAQIQJZFAAI',
  'GOoDBGTBcBQCRCSCdCEDIDKDMDUDqDBYCQIYMYHANJAJEQFQJQKZGALYHBDICIAANZCQDQHQMQLQIQBKGAKAJAEAFAMYCANZAQMQGQBYHADAAJNJEQFQJQKQBZIALACACYDYDAAANJMQAZDQDICICQLQIQBJKAJAEAFAMZNZCQDQHQBIGAAAAINAGQMJEQFQJQKQBaHADAIALAAACAMJNQCYDYGQHRLIKJJAEAFANZGQAYMYHQLQKJAA', 'GKpGAHFBLBYBMCDDsDRFjGAYCRDQGIBIECHYIYJYCRFIDIDAJAHAHYCYFRDIJACAAJIQJZCBHICQCYDYDQFBHICQCYDYDQJJIAAZHQDICIHYFRJIIIESBYJACADAFAHAAKIQBQGbJADAJYFBHICQBIEBHAIYCYCQHZDRBIDIHICAAYDQFQJIGIEAIAAZDZFRBICBDIHYDAAJHQIQCYBYEQGYJYFCDIBQHIJQGKCAEAIAAZHQBQ', 'GLADrGFBIBRCYCCDiDkDpDKICREAGJAJDAFAHYIYJYBYCRKIEIDIDRAZAQGbEAKACABIIAHJIYJIJABaHQCYJICICQIJJAHAHZCZIRJJCAIABKHQDQERAIGIFBDYEYCYCAIZJQKQGKAAAIEBDIFSEYAYAQDAGaKAJAIJHAHIDRCYHADICRHYHAJaKQGKAAHAJACADABZIQKQHKAQGaHAKAIABJCQDQJQAQGQHaKAJKAQAICBDYAQ', 'GLBDbEKBaBhBlBYCUDIEqGDHAYEAFAHYJIDQCQKYFCBIHICICQDBHYJZBQDQFRKIAIIIGCEYDYCYJYBYBAJKCQDQEQGQAYIQKYFBBIHIIIDCEIGRDYECCYCAIQHZJZBQFRHIKIAIDAEICBGAIYJYBYBAJKGQDQAYIQEQKYFBBIHIEIEQHZIAJZBQFRHIKICICAHZEAEIHIDIIIDRARCZKZEBEIHIAIKICIGCDYIYJYBYBAFRHIAI',
  'GLCDkDMBiBjBNCADEDbDgEIIBQCYFQHQAJCAGIIAEABYEIFQIICSAYHYIYFCBICQEIIQHQAQGJKAIaCADABZEQEYFSAIGIHICCHYHQAQAYFBEIBIDQHQIKDAJABaHQHYEYFRAIAAIAIICSAYGYIYFCEICICQIQIIDIDAHABJJQKQGaAAAYDAFYIYEDCICBHJHQIQIIBAHZIQCQBIBAHAIZCQCYETBIDQFIAIAQGKKAJAIZHQDQAQ', 'GLCDsDTBFCYCADLDZDcEiEIHAIJYBYCQGQAQFKKAEAHAJABaCQIQDQFIGQAQKIEBJYCYCAIYDRAIAAGAGIIABKCQJQEQHQKQFbAAAZGBKJHBCBJIERHYHQFQAZCBHIHQCQFQAQGbCAKAFLHAFYHYJABZCQIQFQKQGLAAAJHBCZJBFZIABJFRJRCJHRAZAQGbCAHIKADAIABAFKJQHQAQAIEBJYBYBQIQAJCQCYKYDBIIBAFZIQAQ', 'GLLBlBCBSBAFMEjDDGbGgGqGKZGQJJERCZDBDYAYAAFYIYBCGIIIJIEIKICTDYDRAZEBIZJZGBJJKJCJDRDIATEYAAFYHYBAGAIJCADAKaJQIQGQFIGYCBIYBSFICIHIEIACDYAQEQHaCAFAGAGICRHIAADAIZCQCIEIDIDAIIASDYEYGYHYFYBCCIBQGQFQHKEAIIAIDREYFYBYGYBQHYCCBIFIGIIIAIABGZIZBQBYCSFIAIAQ', 'GMADjGLBMBhBFCaCCGIGQGbGrGEYGYBYKYLYFSDICIHIIIJIECGYBYKYLYCSDYFBCIDSIIJIEIGBAIBYKIEQLYDYCYFRIIAQHaIAJIJAFAKACADALKBQDYEQGQAYJYFAKYCALABKDQEQGQKQAQAJGBEYDYBYJYCAKILYFRCIJIGIECDYDABZGQJYCYFBLILQKQAQCQJIFQGAKYCQJQIQIYFBCIHJEAKIGQEIDCGYAYJYKYCYCAKJAQ',
  'GMCDkDKBUBVBEDaDsDAEiEQFLGKQIQAZCAGAJAHZBQDQGICQAJIAKAHZBZDQDIJICRLYEADABJHJKQGaLQAQAIFZEAFILICCJYLYDABAHJJQLQGKCQIQFaAACAGALAJAHZBQDQJILICSGYLYEQAIFJIAKAHZBZDQEQAQFJGAAZEAAIDABJHJKQLZAQGQFZEAEYDCAIJICICAHABZJQAQDQEQFJGACAAZJABJHQAQCQGQFZDAEAJAAJ', 'GMEChEFBIBgBBCKCLCCDYDjGrGAQCRDAIJGAJIEBBYKYLYCRAIHIGIFIDIDQEBGQJYEQFQIbAAFAGAHAJLFQGQIJDAEABBKZLZCZJRARHRIJAAFAGACAHAJALKKQBQBIESDYFYGYCCBIFRDIECFYBYCSGIDIEIEQFBBYDSGYCCDICQGRIaCADAGAJZAQHQCJIJDAEAGAHAJIBIFREYGYDYHYIYCYCRIJAACADAHAJIBIGRDYHYCYAY', 'GMJBDCEBFBACCCaCgEUDYDbGjGAALQKQIQIYDRCIBIFIGCHIJIESAYEAGYFYBYCYDBIIIAJKHAJYLaKQJQIQIYDSCIBIFIGIAIEBHYIYJYDYCSBIDCIIJIHIERAYGYFYDYBYCCIIJIDSFIGIAIEBHYDYIYJYCSBIFIGIDCHIERAYDYGYFYBYCCIIJIHIDSAIEBDYHYIYJYCSBIFIGIAIEIDCHYASGYFYBYCCIIJIAIHIDSEYGYFYAC', 'GMbCDEFBACBCCCYCcCZDhDpDTGHIAIIIJIKIESFYBYCYLYHCAIIIJIKIEIFSBYCYLYHYACIIJIKIEIFIGIDSBYCYLYECIYJYKYASHIEICIBILIDCGYFYIYJYKYAYHSEIACIIJIKIFIGIDSBYCYLYAYEYHCIIJIKIASCIBILIDCGYFYAYIYJYKYHSEICIBILIFCAYIYJYKYHYESCIBILIFIACGIDSAYFYBYCYLYECHIIIJIKIGIFSAI',
  'GNEBiDDBFBSBTBICJDgDoDUFAGqGEYFYCRHIEALIGAIABZMIFRCYKYDSAIAQHILJCBEAIIIABAFAJAMaDQAQHIKQIJCQEQLZHAAADAIAKAMKFQCQJQBQEQGQIZLYHYHQLKIAEAIYCBFBBIJIGREYFYCRIIIQLaHAHIIJCAFABAJALIEAGAMaDQAQKQIQHQHYLJAACADAFAIZKAMKGQEQJQBQIQCQFQLaAADAHAKABKIQIIFRCYKYDYAR', 'GNJBTCCBDBIBSBVBUCADoDEEYErGFRCRDYKYGBHIBICICQDRKYBBCIDIDQKQFAIJAAEALAJAMaCQBQDQHQGQIJKAFAFIJILIESAYKYIYFADAGAHAMIEQARKYIYBACAMJJQLQFYDBCYBRIIBAFALAJAMZHQGQIIDACAJJMIEIARLYCYDRIYGAHAMICRLIABEYCYMYHQGQIIDBLIAIEBCYARLYDRIYGAHAMIAICIERLYABMYHQGQIIDBAI', 'GNgDIGFBLBQBlBADRDaDUEjECGoGAIEQHYIYDQBJHAIAIYDYJYCRBILIDBIIIQDQHQGQLaBACAFAJAKAMKAQEQIYDRJYCYFBKIDIAAIIEAMaDQKQIKJQGJHAJYDBMIDQEQJYGQHJJAEAMYDQIaDAKAMKAQEQIYDYKYFRCIGIHIDBAAIIEAMaFQCQHIKQGQDIJIEBIYGYCYFBKIAIIQGZAAKYFRCIAIGIIIERJYDYHYHQBQLKDAJAHaAA', 'GJADqGCBIDoDLGQGYHTIBIFAIABAELHQGQCQDQAQFaIAGKHAEbBQGQIQFKAACADAHAEABaGQELHQCQDQAQFaIAEAGABKHQEbIQFKAADAEAHABaGQIQFQALDADJEBCZFZAQDJEJCAEYHABAGaIQAQFJEQDaFAAAIAGKBQHQCQEQAaIAGABKHQEQAQDQFaIAEKHABaGQEQIQFKCADAAAHABAGaEQBKHQAQCQDQFaIABAEAGKHQAQ',
  'GLCDgGBBVBlBACKCEETEjEoGCRAYCAHYDBEBJIBIKIFSAYCYGYIYEYDRHIIBEZDZJBBJKJERDYEYKYDQIQAJCAFAGAEAKZBQDIEIGRJQHQAJIAIYDCEIGIFICSIYDYECGIDSIICCFYDYGYESIICIFBDYCSIYECGICIDIFRIYCCGYESCIIIFBDYGYEYCSIIGBEYCYIQAZHAJABAKKDQEQFQGQAZIACACIEIEBDJFRGRARIZCBEBAJAQ', 'GLLDpGZBcBdBFCYCTDaDsDAIAAHADAIQDYEYEAIJDQDYIYFRAIHIKIGCBYCYDYIYIAJYJABKCQDQDICIGSIYKYEYEBIJCADABZFQHQHYFBJIJQIQHQEQAYEIFAHIIIDIDBHZIZJBBJCQBYHYJYFSAIEIDIKIGCCYHYIYJYDREYFBBIIQJQHJCACIGSKYAYEYDBFAHJJJCJIBBZJQHQFQAIEACABAJaHQDRHYFRAREJCBAYEYFCDIAQ', 'GLUBACiBLCVCEDMDRDjEYFBGEQHACBIYARGQFQKJHACACYDYFYGYEBAIIIDRFYGYEYACIIDIJIBSCYFYGYDBIYASEIDIFIGICIBCJYIYDRFIGICICQFZGACIFQGZCACIFIFQCYGQHQKZDCAYERDICICQHJGAFAFYCYABIIJIBSFYGYHYABCIHQKYAYCBGIHIFIHQAQCQKJBCJYHYIYEYDSCIAIKIGAFAHAHYAYAQFJHAAYFQHJAAAY', 'GMIEkEEBSBZBiBjBFCYCKDBGbGCQEQKIAADYJQLYHQKIAIICEYDRJYLZGCFIDIEILJISAYJYKYHALIDCFYBYLZHSCIGIDIJIKIAIICEYFYBYGSCYHBGIBIFIEIISAYJYKYHALJFCBYLZCSDIFIHQJIKIAIICEYBYCYDSHYGCDICIBIEIISAYKYGADBCIHRFIJIAQKZFAFYGYDBJJFQFYJYDRGIJBHBFIAIIBEYBYCZDRDYGTHIHALJAQ',
  'GMKDoGABQCdCEDbDrDMEREBGiGAYIYEBHIBIDQCQKYFYEAGILYGQEQIQFQKKAAAYFZIAKYEAGAGYLJEQJQFQKIAIAQKaEAGIIAFJJALZGQEQFQIQKKAAAYJAKYEAFILAGaHABJGQLQJQFYEQKIAIAQKaEAIAFAHAHYLJEQJQFZIQKKAACADAFAJAGABaLQEQHQIQFKAQKZFAAKJAAYGAHZIQAQFQKJJAAZIAHJGQAQJQKZFAIAHAGJAQ', 'GMKDoGYBACdCEDbDrDMEREBGiGAYIYEBHIBICQDQKYFYEAGILYGQEQIQFQKKAAAYFZIAKYEAGAGYLJEQJQFQKIAIAQKaEAGIIAFJJALZGQEQFQIQKKAAAYJAKYEAFILAGaHABJGQLQJQFYEQKIAIAQKaEAIAFAHAHYLJEQJQFZIQKKAADACAFAJAGABaLQEQHQIQFKAQKZFAAKJAAYGAHZIQAQFQKJJAAZIAHJGQAQJQKZFAIAHAGJAQ', 'GMaBLDTBCCdCUDgDjDrDIFDGoGBICAHAIAJALJGQAZHZIZCRBYCIFYEBIILIGIAQHYIAGALZCQCIIIIQHKAADQKYEACALJGQGYIZLYCQEQKIDAIALALYCYGJAQIYHYCAGJLQHQHYCYIIAALYCQIJDQKYEAIICAIQEQKIDAHALIAQHYCYIYIAGAGYLJCQCYDSEQBIFYFADALYEQBQBYEBFIDBGILICICALZGQIQIICIHIAAHQLYCQBQBZ', 'GMgBBDMDhDjDpDrDIEKEUEDGYGBYEIDIGILIAAFYDQLQIQCZJAEAGADJFJAQHQBQKaJAEAGADAFJLQIQEZJQKKBACZEAIADaGQDIJQEJCJBQKaEACJIADALAFaGQJQCQEQKKBAHAAAFYGZJQDJIQEZCADAJAGJFJAQHQBQKaCAEJBJHAAAFZGZJQDQEQBJIADaJAGJFJAQDYIQBZEAJAGAFJLQIQBQEZCQKKHABZIAGaJQCQEJIADJAA',
  'GMhBdCDBNBcBgBEDQEaEAGIGSGEQIQLQCQDYGYBCEIIIAILIABFJHRAZFBFYIYEYLYBSDICIGIJIKIABFYKQJQGaCADALYEBIIHIFRKYLYEYCRDYBCIIERKILIFBHYEYIYBSDIDQGKCAJAKALIFIARJYGYKYCYDYBCIILIEBHJFREYFYERAJEBFBHZARIYLYBSDICIGIJIKIFBEYKQJQGaDALYCQDYBCIIAIHIERKYLYABIYBSDICBAI', 'GNABkDNBaBEDQDYDgEBGJGSGbGqGBYMIDQLYCRJJKIFIFAKaJQEQIJFAEaJAKKAQEQFQIaJAKACAEJFQKZCALIGIAQKYEAFJGALZCREIKIAALYFQGKKQEaJQIKAAEAJZGAKJLAFaDAMYCQKQGQJJEQLIAQIaJAEKLAGaKACAMIDQFKGQGYKZDAMYCQFIFACAMIDQGKDAHAMaBQCQGIDIHIARKYLYDBGYGQDQFQEQLKKAAAHAGaBAMJGQBa', 'GNEDhDRBSBlBYCCDKDjDAEMEbGqGFAMZIQBJCQDQHQGQAZHYKALABAEAIAMKCQDQFQHQLaBABIHJCADALIFAMaEQIQHQBQBYLJCADAHZBQLQKQAJGADADICICALZKQAQGJCADALAHABZIAMJFQLYKYEBMIBQEQIZKQLKFAHAIABAMaEQKQIKHQLZIAHKLQCQDQGZAAIAHALJCQCYDYDQIZAQGJIADADICICALZHQAQGQIJCADAAaHALJAQ', 'GNMDcDICTCDDRDUDZDAGJGgGoGrGBQEIGQAQIICAJJFAHAKALAMaBQDQGQAQJQEQIJFAEaJAAADAGABAMKLQKQCQHQEQFQIaJAAADAGABAKKCQHQEQFQIQJaAADAGABAEKDQHAKZEQBQGQAQJKIACAKYDQAaDAGABAEAKKCQHQFQAQIQJaDAGABAEAFKDQHAKZFQEQBQGQJKIACAKYDQGaJQIKCAGAAAHAKALAMaDQFQEQBQHKAQJZHAAK',
  'GKBDiEFCKCTDoDsDDEcEQFAYDABAJAFAGbBQDQIQEQEIHQAKDAJAFAFJGBBZFRGJGQDQEYJQAaHAEAIAFJGQIYCRHIAJJABAGZDREYFYCQHQAJEBDBHYCBFIGJBQJQEZDAAYCAIIGBFZIQCQAIGIDREJJABAFZDQHYIYCRAREJAAHADAGAGIIAFKBQDQHQJQEbHAGZAQHJEJGADAAYJABAFaIQAQHQEJGAHYCBIIFJBQJQGZDBAYAQ', 'GLCDoGBBRBjBECFCICgDcEKFIIHQCYDBJQFQGQAJKAIAIIHICSDYDQHBIYIQHQKQAbFAGAJAKAEABKIQEYHQIYEQKQAJDADICCHYDSCICQAZKAEAIIHQCYDBEYKRAJDAEAKAIAIIERBYDRAZDAKAIAIYJYGSFIKIDIDAIAEABYJYGYFSKIDIDQAJCACIHCBYEYJYDSIIIAJAJIEICQHRAZIAJADABIEICRHQARIZJAAJCBCYEYEBDZAR', 'GLEBjBDBFBhBCCaCYDIEkETHEYIAHAGYFSHIIIEDGYFYBYHYJYKYDTAIARCJIJEJHBFBGBBZFRJYDYARKIERHIEAEYHYIYCYKYADDIJIKIFIBIGREYBCFYJYDYKYATCIIIHIKIBIEIGCFYESBYKYCRIIHIBAKYCYABDICRKIBRHYBAIYABDBCIJIEIFIGSBYFBEYHYJYCYDRKIFIBIGBEYBSFYIYAYKYDDCIJIBIKIBBEJFRGRHRIZAZ', 'GLIBUBNCYCLDkDsDaEBFDGpGAADAHYBYFYCQEIBAFAKYGYGAKKDQAQHQIQJaEABIEYCBFIIIAIDBHYGYFQCQEIJIDAHAKaFQFYCRBIGIIIHIDRJYEYBACAFIKIDQAYHBGZHQIQEQEZJJAADAIAKYFYFAKKDQAQJZIAFAGJHRFZFAGAGZIREJFAGAHAJJAADAKaCQIQGKFQAIFIAQJZEAFAFIAIGYBQEIJIDBHYARFZGZBZERJJFAGAAA',
  'GLoGCHQBUBlBNCSDgDAEZGiGFAEAAKHQHICRJYKYDQGIJACAKAHAAaDQDYEQEYFSBIGIIIJICCHYJYGYKYGQJKKAGaDAEAAJHQGQKQJaDAEAGKHAAZGQDQEQJKKAHAAAGaDQEQHKKQJaHADAEAGKAQFAKQJQCQHZDAEAGAAKKQJQCQIYBYFBGIJICQHYDYEYGAJJDQDYEYEQGYHKCADAEAJaAAKKJQCQDQEQHaGAAAKAJKCQDQHQGaBQ', 'GMABUBDBhBdCBDJDSDaDEEQEiHDYEALYBRHIIIKIARFYGYCYJYEBBIIILIDIARKYHYHQCQJQFKGAKAAAHYIYEQFIGJKAAADYLYBYERJICIHAIZCQGQFZJABBLIDIARHYIYCYBYJQFJGABACAIKCQHQKQGZBABYJYEBLICRHIBQGJKAABDYCYLYERJIBIHAIZBQGQFZJABIHIIIAIDBCYARHYIYBYJQFJGABAIJHQBYJYEBLIAICIDRHYAA', 'GMKDhGFBVCYCADZDpDIETECGrGAIBIIIEBHYLYDQCQKIFIEAGYGQEQIQFQKaAAAIFJIAKIEAGABZGIEQJQFQKYAYAQKKEAGYIAFZJABJGQEQFQIQKaAAAIJAKIEAFYBAGKHALZGQBQJQFIEQKYAYAQKKEAIAFAHABZHIEQJQFJIQKaAACADAFAJAGALKBQEQHQIQFaAQKJFAAaJAAIGAHJIQAQFQKZJAAJIAHZGQAQJQKJFAIAAZGAHJAQ', 'GMLBRCIBYBSCbCJDcDMEAGDGoGHRIRAJGJFALIDQCQJQKaAAGAIAHAJJCALJBQCIDCBYEQEYFYFQHYIYASGIJICIDIKIBCEYFYCSDIDQFBCYLYAQIIDIFICCEIBSCYCABAEBHZLZDRDIHIIYABDILJBQCQERCIBCEYCSFYIYAYAQJYDCAIAQDQIIJIFICCEIBSCYCABAEBHYLZAZDRIIABHJLJBQCQERCIBCEYCSFYAYAAIYDBLICIFRAY',
  'GMMBSCCBFBLBRBbBYCDDAEcFpGDQFQHAIILYGQEQCIJIHBFYBYEYCREQJIBBEYCYCQJQGAIZAADAKALKCQEQBQFQHQIZJAGAGYKYDSAIJIIIGACAHAFALYDQARJIIIBAEALZKQGICBEIBRIYGAKALJBQCYFQHQIYGYJYABDBLIEQGRJYAYDBKIGIGQJQEAIJCABAHAFALaGQKQAQDQIJJAEAEIBICSHIFCCYHRJYEBGBLICQFRGQJYEYAY', 'GNIBhDFBJBMBVCYCcCADpDKECGZGBIFQCQLIIIAAGAJYBQMQDQKQIQLZCAEAFAHABJJJGQAQLYEYHBMIDRHQKYERIILJAAAIGCDYDAJZBZFQCQMYHRCYFCHICSEIEACABIJIDQGQKIARIYLZEAEYFYHCCICQFREIHQLIGADAJYBYFQEQLJIAAAKAMABABYJJDQJYMYFYCYHREICCFIBIJIDIMIGSAYIYKYCYEYLYHCFIESCIKIAIGBDYMIAS', 'GNQDrGFBVBECIDbDiDkDpDKEYEAGGYEQJYMJFAAALAHZGQKQAJLAHAJABaIQEQIYDRCRAJKAHJLQFQMZAAAYCBDBEAGJHQKQFJLAJAHZGZDRCRAIEQAQMKLAJAHAGZKQJJLQMaAAFJJAKAGJHQLQJZFZAQMKJAFZAZEAMYCBDBGJHJIILQFQAZKAHAGZIABKLQHZKQAJFAHALABaIQGJKQAQFJHAAZKAGZIABKLQAQHQFZKAAJLABaIQGJAQ', 'GNUBBDABDBJBKBaBTCdCoDEEYEqGAQCQBYIAMIGQFQDYKYIBAIHIFIDRFQKYHBFIDIDQKQBJCAEAGALAJAMaAQDQFQHQIQBJKAGAGIJILICSEYKYBYGADAIAAAMICQERKYBYHAFAMJJQLQGYDBFYHRBIGALAJAMZAQHQDIIQBIGIKIEBCBJYMYFQGRKIEICBLYGYGQKQBZDAFAHAIAAAMKGQJQLQCQEQBZKAFAFYHYAYIRDIACHIFIFQKQBJ',
  'GNUBRCDBNBCCQCdCEDaDoDqDAEiGAACQHYDAGAIIEQKJJJBQFQLQHaCAEAIYAQCIEIHILIFCBYIYEQJYKYGQDQMYAQCQHKEALAIAMAJAJIKZAQKIMIBIFSIYLYEYCYDYHYGCAIJIKIMIESIILIFCBYEYJYKYAYMYGSDICIHIIILIECBIFSEYIYLYCYDYHYGCAIJIKIMIBIFIESIYLYBCJYKYAYMYGSDICIHIBIIILIECFYJYMYAAKIJQMQBQ', 'GNcBJDgBhBdCBDRDYDaDiDTGqGDHBYFYGYKYMYECAIAQIJHJCADAJILZJQHQIZAAAYESKIGIMIBIFICCDYDAHZIQGQGIDICRBYFYKYMYECAIAQGJIAHKLAJaHQJILJCRDYIYGYAAHIJICIDRIYIAGaKQMQFKBAIAGACADAJZHZAQEQFIBJIAGACADAJAHZLQKQMQBQIJGABZMAKALAHKJQCQDQBQGQIZFZEAAAHIJJCQDQBQGQIQFZMAKABK', 'GKECaCDBTBhBjBYDcFQGAHAICIDBEYIJGABYFYHYASCIDIIIGIJIEDBYFYGYHYAYIYCTDIDRJJEJGBBBBIFYBRGREZJZDBDYCDAIHIBIFIIIGIETGYIYGQJYDYCYACHIBIGIEBFYGREIEQFBGYBYHYASCIDIIIBAJIFBEYBYHYAYIYCTDIJIBBEIFSBYIYJYACHIEIFIGIBSIYJYAYDYCDHIASCQIJJIBCFYEYGYAYHYCSDIIIAAJIBI', 'GLABjDQBBCFCdCZDCETEgEqGHIDIAICBGYDRGAHYJAKZBQIQEYFCIIDIGIJICSAYHYDBIYFSEIDIGIHIAICCJYJAKABaIQBIGQGIJICRAYHYDYEYFCIIKICRJYGYIABKKQGQJICBGZIYKYBYFSEIDIHIAICBJYIYIABAKJGQBaIQIIJICRAYHYDYEYFCIIBJKIGICRJYBAGAKZIQBJJIBYCBGYKYIYFSEIDIHIAICBJYBYBAIAIYDSHIAI',
  'GLCDgGTBICEFREADjDsDJGpGHIHAIAKJBQIbHQHZERAJGJDAGYDQJJGQAbJAEAGIHJIJDQAQJaEAHAIJCQFQGQGYJICBAIDBFYHZIAKABKFQFIDSGYHYCQAIGADAHAFABaKQIQEQJJGAGIDBFYIZEQAJGQJZAAEAIJCQFIDRGYHIHACAFAIaEQAQJJGAHZAZEAIKCQFQAQAYHJCAGQJaEAIAJIKABKDQFQAQGQGIDCFYHYCAAIFABaKQAQ', 'GLFCIEhBiBYCdCDETEZDrDAGHQGQKJBAIACAIYDCHYJZFYASGIKIDAIJEAJYHQIQDQGYKYACFIHIIIJIEQBQKZGAIAHAJJCQDSBIEBCYDYHYJYFYASGIIIBIEICCDYDAERBYGYIYACFIHIJIEIDICSBYCAEBJaHQHYFYASGIIIEIBICBDYEAHAHYESGYIYACFIEIHIDICRBYHQIYIQGQGYAYFCEIASGIGAIAHAIIBICBDYHYAYEYFSIIAA', 'GLNCAITBZBaBlBLDjDrDDGoGCIDYEYHYHAIAIYCRHIHACAKJDQEQBQJaAAFAGAHACACYFYASGIHIHQGQJKBACAIAIZCRGYHYABKIEIEAKZFQFICICQEIIIDAIQKYEQHQHZCBEBFZARGIAAEAFAKKDQIQHQBQJaEAFAGACAHJIAKZAQCIFIERGYGQJKBADAIAHZFRKYERGRCZABFIEIKIDQIYGYAYFCEIEAHJKJDJIRGZDAIAKaHQHICSAY', 'GLQDrGABBBFBMCYCpDKECGZHFQFIIIAIGAHYBYFQEQJIDICIGBKYIRAJCQDQJZEAEYFCBIHIIIKIGSCYCADYAYAAEQGAJIDAKAHABaIQIYFSEIJIKIDRAYAAKAIABJGQCQAYJYEAFABIHQDQCIDICRGBHYBYFQEQKYEYFCBIHIGRIIKYEYERKJCBDYEYGBHYBYIYFSJIKIECDIDAHAHIGRCYDYERAIAQJaKAFABIHQDQEQAQAJDBEBIZAR',
  'GLpDAGDBEBFBKBYCQDrDUFZHCQHAGAAYIYJQDQEQBKHAFYHIGBKYCRDZEZJBIJIAALCQEQKQGQHYDAEYCCKIGRFYEYEAKADQHIFAGAAbIQIZJRCJDJEJHRFJGBFYKYERHIFQBZCADAHJEBEYKIGRBYDYDQBJFAGBKYDRHYCQBIEAHZCZJBIJIAALDQKQHQEQFQBZHYJAIAIZABDJKJHRIZIQGQAaGAJQBJEAFAAAIAIJHBKZDZJRCJAJAA', 'GMAEqGCBQCVCZCDDRDTDbDLGiGBIDQHYCRKYEBJILICRIYIQHKAQGaKAHAIAIIAIJZEQJIKIGIDCFYAQCYBYHZLYERKQGKHAAAGYJZIQKQGQHKAAHYKZECBIIIJIKILICIFIDSAYAQHaGAKAJACAIYEQGIHJAADAFABaJILQEQIQJQKQGQHJAJDBFBCZIZFQJQKQAQHaGAAIGYEBJIIIKIFICICBDRHYFAIYIAJaDAKQIKJABALaKQIQAQBI', 'GMSEAGIBMBNBcBiBRCYCDGJGrGERDIKIHAGYAQKQLYEQDQJQJYDBBJCAEBHAGALYFQFIAIGILIHSCIICHYGYAYLYFYERDRBIFAJICIGCAYFYEYEALJAQDQGRKIGIIIHCAYAALaEQFQGQKYDAEIFIGIAILIHSIYCYBYJYDBEBFIGIAICSJYKYGBAIBYCILIHIISJYKYGYDYDQBJJAKAHAIALZAQDQGQBQJKKABaDAGAAALJHQIQBQKQJaGABI', 'GNBEiDABFBYCkEDDLDQDSDcDZGpGBYKAFAMJBQLQJQJYKZFALJJQKQKYFYDRGIHIAICIIIECBYJYKYLYMYDRFIIICQIQAQGaHAFADAIIKIEQGYHZFADALIJIMIBIERCYAYIAKJJALZDQIIAICIEBBYEQLIMYDQKIJICRGQHZAAIaKADAMIBIEQIYAQHJGAIAEABYMYDQKQFQHJGJIACBJYKYDALYMIBIEQCYAYFYDBKIKQJKLABAMZKQJQLJAQ',
  'GNJBqGDBMBNBQCEDSDoDZEAGbGjGBIIIFQAYHYCQHAJAIAKIAAFABaMQLQCQDQEQGQKJHAGaCADAEALAMABKFQAQIQJQGQHQKaCADAEAGKCQJAIAKIAAFABaMQLQGQDQEQKJHAJAGaLAIKGQLZIAMABKFQAQGQHYKYEAMZIQDQDICIJIAIFBGYBYMYIYDRLJEQKIHIFAMAGABZIQGKMQLaDAGAIABKMQLQFQGZHYIAKYEADABAMKLQBaIQGJAQ', 'GNMDqDUBVBaBICJCEDSDsDCEgEjGFAGALABZEQIQKQHZAACAIIEABJLQFQGQHZAZCACIKIEBMYDQCQAJHJFAGAIaMABABIJZDQJIMIESKYMYCQAQHJKAMAIKEALAJaBQEQIQMQKQHZAACAKIMIECIYMYDABIJJLQGQHYAYCADABAJJIQBZDQBICQAIHIGAMZBAIAJZDQDYCSBIKIEIEQHQAZKABACADAJJIQEQBZKQAJHABAEAIAJZCQDQKQAQ', 'GNNBhDQCBDLDRDTDcDjEDGIGZGoGDYIIJYAAMICQFYGYHAIAMJBQLQGQGYHZIALJGQHQHYIYAREIFIJIDIKICCBYGYHYLYMYARIIFIFQKQEaJQDKEAJZIAAAFIHICQEYDZIAAALIGIMIBICRKYFAHJGALZAQFIKICBBYLYHQMYAQFQIQDJEJCAGYFZIQDQEJJAKAFAFYIYABGIHILIMIBICSFYJYEYKYDYABIIGIGALABAMZHQBKLQGQGYIYAR', 'GNdBJDACFCUCYCBDDDLDiDpDSErGJYLYEYAYAADRIIEAJJLQBQGQHZIADAIYJIEQGJBALAKAMZJQDQGIEAKJLQBQHQIZGAAAGYDBKIKAJAJYMJLQBQHQIQGZAAEAKYDRAIEIGIHIIICIFCBYKYEQLYMYDQAQGJIAHAKABJLAMZJQBQBIKQHQIQGZAADAEAJIKILIMIFSCYGYHYIYEYAYAQDBKIEQGJIAHALABZKQAQKYDRGIGQIKEAHALABABI',
  'GKCGrGFBACBCYFUELDaDjGIAFIDSEYIYGYCRHIIAIIEIDCFYBYGYJYCRHRIJGAHZCBBIHIJIFIDSEYAYIACAGIFBBZHIJZHRJJJAHAHaJQCQGQIQAJFAHAJZCRBIGIHIJIDIESFYIZGAHJIRFIECDYGYIYHYCCBIJIIRHZGQHQFQAZCAAIGIFIEIDCHYHAJaBAIKJQHQHIJIDSEYFYGYGABACQAIFAIABZIYCSBJFQAZGIGABAIAHJFQAQ', 'GKTCYCSBACFCLDhDBEcFpGCYFAAAGICQHQFZAAAIFIHIDIBCCYGYDQJYIYESAIHIDIBIBQFZCBGYDQHAHYAYECIIDIDQGICRHQFJBABYHYDBGICIJIBSHYDYHABACAGYJYIYESAIIBGJCQGYJJBQHQFZIAFIJYEYASIIDIHIBCCYGYJYDRIYACEIDIGICIJIBSFYHYIYAYECDIASIIFIHIBCCYGYJYAYDYESIIFIHIBIBQFZCBGYHAAAAY', 'GKYBDFCBNBlBcDAFZGiGqGAQHYFYIYJYEYDSBICIFIGIHIADHYIYJYCTBYFYDDEIEBCJFRHJIJASGYBYHYEYCBFICQIYEQBIGIACHYIYEYCYDSBIECCYCAFYFAJKIQFaCQCIESBYDCCICAFIEIHIASGYBYECHIJAIKFQFYIYJZCRDREIBIGIACJIFBIZJZCZDRDYETBIEAGIFAHZCADAIKJQHQFQFIGYBYECDICIDAHIASGYBYCCFJHJAJ', 'GLACbEgBBCCCNCYDhDLEDGpGFRGICAIIKYBQGJDQEQJZIAFAGABAKKHQDQHYERGYGAEAGYHICQAQJYIYIQJKGADAEAGYHAJYFBBIHIKZBQDQFQJIEAHAHIERGIGQJaFAIAHABABYKJDQEQFRHZIQJKAACAGAHADAEAKaBQIQJQGKHAHIDBCIJYFABIKIASDYCCEYIYIQJQHQHICIEBGYFABAKJAIDSEYACIYBYKZFSGIHICIJIAIEIDCIYAR',
  'GLCBhGTBYCUDZDpDAEcFLGQGJAEAIAGKBQCQFQKIDABYCQKQAQAIHIDBHQJZEAIAGAKYCABKFQKQDQJYAACAKIDRHYCYCAKAFABZGQFKKQCQCIHIDBKYCQAQBYJIDAKABAGbFQFZIRAJCBBIKIDRJYEYAAIAFJGJDQHYCYEQJJHADAGZFZIQAQEQJICAEZAZIBFJFAGLBQDQKQEQCQHQJaAAIAFAKJEQCQCIEAHIDBKaCQGABJKQEQEYCYAS', 'GLLBQBJCKCdCbFgEADMDUDDGGIBRCYDYAYAQIZJYKYECFIGIDRIYJAAIIQJZAAAIIIJIDBGYFYESAIIIJIDICIBCGYDRIYJYAYECFIDIGIBSCYIYIQJQJYDBGIBICRHQHICCBYGYDRHIJICIBDGYIYDYFYESAIHIJIKIDCGIIIBTCYDYHYJYAYKYECFIGIBICSDYIIBDGYIYBQFYESAIHIJIBIDICCGYIYBSHYIIJYAYECFIBIGICSDYJYBB', 'GLQDoGABBBYBbBcBMEZECFrGGIFIHAFAGAKABKEQIQAQAJCRAYDYJYFYFBGZHRFJGBGIJIDICBAYAAEAIABaKQHQHYFSGIJIAIDICIECAYIYDSJYGYFCHIHAKABKDQIQAQAJIBDZBZKZHRFRAIGIJICICREJIBCZEREYAYJYFYFBHBBJKJDJCRERAZAACADAEABaKQHQHYGSFIJIDCAIHYGYFSJIDIIICCEYHYDSAIIICIECHYHABAKaDQAQ', 'GLYCiESBTBMCZCKDQDAEkECGEIDIGIKICBBBJZDRBIDIJICTHIIIACFYCYHQIQJYDYERGIKZGABAEBDIHJJICIFIASIYCCJYDYERBICIIIACFYHZJYCSBYEBDICIHJJIFIASHYIYBYEYDCCIERBIIIACFYHYJYEYCYDSBIBQEBGQJIKJIAHAFIASHYIYEYBYDBCIJIERHIIIACFYEYJYCYDRBIHIHQIQIIAIFCEYASIYIAHAHYBYDBCIJIAI',
  'GLdBBFABLBEDMDUDYEbEoGrGDAHICSBYDYEYFYGZACIIIAKAJKHQGQDQEYGYIYARFIFAIAGJHAJaKQAQGQIIDIDQEQFZIAAADIGIHIHAGaKAJKCQGQKZAQDQIQFJEAHAKAGAJZAQDQIQFQEJHAKYIYABDIIQHQEZFAAAAYDCIIJJGQKICAKQHQEQFZAADAIAKJGAJaKQGKHQHYGYIYDSAIAQFJEAIAGAIYAYDBKADQJKCQHQGaAQFQEJIAAZ', 'GLhEAGgBlBUDaDcDjDQEIGDHEZGADAFIDQHQFQEQGQKQBKJAIAIICCAYAAHaFQEQEIAICRGYIYKYDCEIFIGIAIAQGaEAEYDRKIIICBGYGQEaAAAIEIGIHJCSEYHYIYKYDBAIGIGAHAFaAQAYDSGJEJIQKIJQBaKAEAGAAAFJHQAYGQEJAAFAFZDZGRERAJDBFIIICBHYFQEbAQDQKQBKJACAIADYEAHAFZGZAQKQBQJKCAIADAHJEQDZKZAB', 'GLqDDGVBlBSCTCUCYFAELDQDCADAAJEQFQKJIQBaJAJIKAEAFAAZDQCQGQJQBKIAHAAZEQFQKQJZCACYDCGICSJIKIECFYCYGYDSJIKICCFIESCYJYKYDCBYGIFIEIAICRJYKYDYGCFIEIAIHQIQBZDAEAAICQKQJQDYEBKIKQJQDQDYEYGYFCAIJJEQKICIDSEYCDDIDBKZJQKQJZABJJDQCQKJERCYDCAYJYKYFSGIDICICAAAAYDRCIAA', 'GMLDrGIBJBUBYBZBdBFCSFCGoGAYEQKZIYHCEIEAIRAIAAIAJABALKGQGIDSJYIYEYHRAIAQKKJADAGALaBQEQIQAYHAEIIIGIDIFICRJYDCGYDQIYEYEAHRAIHAIABALKCQFQJQKaAAAYHBEIIIDIGBBYEQGQHQAIDAGIJICCFYBYFALaEQEYHSIIGIDRKICAFABYDRGYIYHCEIDIGRHQIYAQDBGIIRAYHBDIAQHYDBAIAQIBBIFQCQKYIAAY',
  'GNNBjDKBdCLEYEADCDIDQDoDaGqGHJGJIAJAFABaMAKKBQFQJQIQGZHZAADAKIBJFQJQIQGQHZCAEAIKJAFABZKZDQIIJJFABAKZMQLQJQJICREYAYIYDCJILIMICRIYAQIQEQHKGAFAIZJZDQHIGJFAIAJZEQGQHZAAEICBLYMYDRAIAQHJGACAEALABKKAMZBQKKJQLZKABAMJJQBaKQLJBAKaLQCQEQGQHZAAAYDCLIDQMICREYARHJGAEABJ', 'GKDGqGKBYBcBlBoDAFLGZHCAEAEIJIJABABYFYERGJDQHQJICRAaIAJAEAFAGJBQCQFYJYEBGBBJCQCYBYFYGQGYESJIJQIQAKHAHIDDCYCBFYFQFYHRDJCBCIFDHYDSCICQHQFQAaIAJAGAGIDICRFJHBBZDQDICIFRHQAQIaJAGADABJHQGbJQIKAAGAHABZCQDQJQGLAQIaGAJACADABJHQAQIQGbJAAKHABZCQDQAQJQGLIAFBAYHABA', 'GKZErGEBKBQBbBDCAEUFoGCIDAAAJABaIQGIFCIYCTGICAFIDIHIEBAYIABKJQIYCYGRFICCIIAIJABaERHYDYCYFYGBIQIICTDIHIDREBAYDYFYFRHJDBAIERDZHZFBAIEIDRFIHYABCBCYIYIABKGRFIAICBJQIYGYFSAICIHIDBEYIYCSAYFCGICIIIEIDSHYAYCCGYFSCIAIFAHIDCEYIYGYFYCSAICAGBBAJKERDRHYIQGYAYCBFIAR', 'GKcCYFSBVCADTDiDqDIGDHBAHZGQCQFYAAGJHJBQFZCAHAGZAQDQJQELIAEYFABAGZHQCQJYDCAIHIHBGKCQHQJQFKBACZFYGZHQJQFQEQEYIJBACAGYHYJYAYABHJHAGLCQJQBQIZAAHAHZGBJJCJBREZFZHBCBGYJYDSAIHIHAEKIQHaEAEYGBCJFJFQIQGaCBFIGJIJBBJZFRIQGQEQHJBAIZCSAYCYAREJHJGBCBCYAYEQHQGJCACIBI',
  'GLCDkEZBbBMCNCSCEDKDAFpGCYCQJQAZHZEAFABAKJGQIQHQAJJAGYDYBYKYFSEIAIHIIIJICDGYDYBYKYFYESAIHIIIJICIGCDYCSJYAYHYIYECFIBICIDIGSJYCCBYCQFYESHIIICIJIGCDYBYCRHYIYECFICIBICQDIGSJYAYHYIYEYEQAJFBCIERHIIIJIGCDYBYKYEYCYFRHIIIECBIDIKIGSJYEYHYIYFBCIBIERHYHAIABACYFRIYAQ', 'GLECQFVBlBDCKCbDjDoDAEqGCBDBFAGYHYKIDQDYCSAIDCGIHIFSEYDYAYCCGIHIDSEIFCDYGYHYCSAIEIFIDCGYHYCYKYASEICCGIHIDSFYCYEYACGIHICSFIDCCYFRKICQDRJJBBIBCZDRDYFYGYHYKYASEIGAJIFBHYIKCADAIYKZAYESGIJIFIBICCDYHYIYFSGYJYECAIFIHIIIDICSBYGYJYFCAYESFIGIJIBICCDYHYIYAYEYFSGIAA', 'GLFBYDDBEBhBjBCCaCIEkETHEYIABAHYGSBIIIEDBYHYGYFYJYKYATDIDRCJIJEJBBGBHBFZGRJYAYDRKIERBIEABYEYIYCYKYDDAIJIKIGIFIHREYFCGYJYAYKYDTCIIIBIKIFIEIHCGYESFYKYCRIIBIFAKYABDYCRAIKIFRBYFAIYABCBDIJIEIGIHSBYFYGBEYJYDYCRKIGIFIHBEYFSGYIYAYKYCDDIDBJJFJEJGRHRBRIZAZCZDBKIAR', 'GLMDgEKBTBYDiDkDUEAFDGrGDAEJBAKaGQFJEQCQDQAZHAFAGAKKBQIQJaHAFAGAEJCRDQFZCAHQJKIABAKaEQGQHQAJFACADAGZEAKKBQIQJaAAFJCADBGADQEZHQFQAQJKIABAKaHQGJCQDQAZFAGAHAKKBQIQJaFAGAHAEJCRDQAQCAGZFQJKIABAKaEQHQFQGJAAFZHAEAKKBQIQJaGAAJFACADAEZHQAQGQJKIABAKaHQAQGQFJCBDAAZ',
  'GLMEQFABBBSBbCKDcDoDkECGFAIJBQDQEQKYAAHAJAIJFQHZAQKJDAHZFAIZJQAQGJDIDQKZGAAAJAIJFQDIEBFYDSEIDAHIHABAFAIbDQEQJQAQGQKJHAGaAAEADAJAILBQFQGQGYEYDBFIESGICQEAHQKaDAFAIZJQAQDJHJGAHAGJCJBBIZBQEQCQGaHQKJGAHaFAEICRFYECCICAIJBQFQHQGQKZEAEIGJHABAIZCQAYDREIFQGIGAAAAY', 'GLRBcEMBQCEDIDoDKFBGhGqGCIIYEYCABAJJKIGIGAKaJQGKAQHQEQFIIJDBAYHYBYCREIIYEACAFJHAGaJAKKAQDQGQIYEYCABIJZBQCQFQEQIKDAAAHAJAGAKaBQBYCSEIJJHQIZEAFAJABACAKKAQDQGQHQFZEQIJFAEaJABACAKAGKHQEQFQIaJACAFJEAHAGaKQBQBIFQEJHAGAGIKZBQCQFQEQJQIKDAAAHAAIDSHYIYJYCBEIFIGBAJ', 'GLUCYFFBKBTBVBaCDDIEAGrGEQDIGBKYFRCRGQHIHQJKIABAKZAQEQDQHZCACYFCAICSFYFQHJAADAEAGBEYCYCAKKBQEQFQGQIQJaHADIHYABFICIGIECKYFQAQHIGACZDRGRHYAAFAHQKICQEQHYDCGIEIEQHQCADYGBFYKYASGIFCHICBEYHRDRDICIEBHYDQFQHAJJIABAKZDQDYAYGSFICIJIEAHADADYAYGYFSCICQHIEQHAHIEIDCBI', 'GLZEAGLBdBFCYCDDbEIGQGpGCIDQEQGIBIIIJIFCAYHYDYERCIDCHIAIFSBYGYIYJYDYCYECHIDRIIJIFBKJAQAYDYHYKYESCICAIIJJDADYDAJYCQGIBIFAAAAIFSDYDAFAIYJYCYEBKZHQCQHIIIKIFQJYCYCQJJDQDIFCAYCYKYHYERHAIIJICBAIKJFSBYDYCYGYIYJYECHIAIFIDSCYCQIZFAGQKYHQEQBKIAGaJAAAAIFICICQGQJZAA',
  'GMEEqGLBQBRBgBKCUCdCIDAGhGBYHQAQKKJAJIDBFBBYLYCSGIEIFIDRJQKaAADAGACAHAIABKLQFQFYEYCYCAGRJIKIDAFALABaGQHQIQAQKJEBCYJQEICBJYAYJQEQKYICHIGIBIJICRLIFRCYEYAYGBBIKYLIESAYJYGYIYHCBILIEIFICRDRKYGAJKEAFAGQKIDBCBBaLQJQHQIQKJAAEAFABALaJQBKCQDQEQFQAQKaGAHAIABAJALKEQBY', 'GMgBcEjBACEDMDUDhDpDsDBFZGEYLYCCHILIAAIYHQLQKQEZFAGABAJAHJIJAQDQEYFZGABAJAHAIJLQCRKQFQGZBAJAHAIALJKQJaBQGJFAJAKALZIQHQBQJKCBKALAIaHQBQJQGQFJEJDAAAIYHZBQJQGQFQEJKALAHAIJAQAIDSKYCYEZFAGAJALJAACQGZJALABAIJHQCQCIAIAAHYHAIaBQCQLQJQGJAAAILZJQGQFQEJKIDCHYIYCYLYAS', 'GMiDDGBBgBkBlBICNCRCSEKGpGEBFYGADAHRKICIIBDIGSIYCYBYKYHCFILIDQCRBYEQKYHYFDEIEQFRHRBJKJCBCIDDGIDQISDYCYCQBaKAFAEAHAAIJALIGIIIDSCYDAJYHYFYEBAIEQFQHQKQBKJAGAIALaAQAYERFIHIGIIIDICRJYJQBaIAKAGAHAAAAYEYFRHIGIIIJICBDYAYJQLIDQCQBQKaGAEAIAEYFYFAHRGIIIECAILIDICRJYAB', 'GJFCYCEBbBZCqDIECFcFDYGABAEAFZIYASCIHIDCIYAYCTHIDIGIBBIAFJEQEYIYDSHYCDAIAADIFJIQIIEIBSGYHYCYABDICSHIGIBCEYIYCYDYFYASHIGIBIECIYCYCQDYDADYFBCJDRDIFYFAIIESBYFYGYHYACCIDIIIEIBSFYGYHYAYCDDIASHIFIGIBCEYIYAYDYCTHIACIIEIBSFYGYAYHYCDDIIIASFIGIBCEYAYIYDYCTHIFIAA',
  'GLACUCRBjBVCYCBDhDsDEEKFGIHQCQAIFCCYCQFQHAAQGZKADAIaBQDQEQJQKQGLAAFACAKAHAHICIFSAYKYGYJYECBIDIHICIIIFIASKYCCHYHQJQJYDCBYESDIBBDAEAIJBQHQJQCQCIKIACFYHYIYEQDQGICAJYBYDYDREBIIBQCQCIBCHIJIFIASKYBYCYDBGYEAJJCRCYDYJYERGIDAEAJAIAHJCQCIBSKIACFYBYCYCAHZIQJQDQDIKIAI', 'GLlBEDNCQCRDTDZDAEbFKGoGBZCAAAGQEQFZIAKKDQGQEQFQHQBZJAHIDBEYGYIAKYAQCQJIBIDAFYKAGKEQFQDQHQBQJaCAAAGIEJFQKZIQBJBAHAIAKJFAEZGZAQCQBIGIJIDAFAFIKZDQGAEKJYBYKQGaIQBQGIJKHAFAGAKAEaIQFJHQJaBAFAIAEKKQGQHQFZBQJKFABZIAGJHQBQFQJaCAAAIAGAEAKKHQGZHYEYAYKYCSIIBIJIDAGYBQ', 'GMRBkBCBMBNBQBAESEgEiEcDDGBIJIIIFRAYHYDYEYKYBCJIIIFIARHYKYCQEQLYBAEIDICIKIHIABFYIYJYERBRLIGIABFBIYJYEYBRDICIKIHIFIARGYHAKZLYDABBEICSBYBAKJDQHQLIGIABFYHYBYDYKYECCIJIIIFRHYKIBQBYDYEYKYCCJIKIDSBIHIFBIYDYBRHIFIARGYHAKZEQLYCAEIHIKIDCBYJYERCRLIDABBIIARFYBYDRGIFBAB', 'GMcCIDQBRBVCoDqDSEAGDGKGgGAAEQGIFIKIBILICRDYDACAFYGYAQHYKQJQIKBABYHAIYLAGAFJCQCIDSHYDAJYKYECAILICAFZGQLQKQJQIQBKHACADAFAGZLQFKCQDQHQBaIAJAKAFALAGKCQDQFaKQJQIQBKHAFACADAGaLQKQJQFKHQBaIAFAJAKALAGKCQDQHQBQIZFABKHACADAGaLQKQJQBQFQIJHABaJAKALAGKCQDQBQHQIZFAJAKABK',
  'GNADrGIBTBYBMDRDUDZDCEcEhGoGFAHAKALJIQGQCIEBGYDYIYDQJQFZHAKALABAMKIQGQCQEQAQFZIIJADAGIERCYDYJQFJAACADAEAGAIAMaBQIKGQLZKQHQFJAJCADAEAGYIZKQHQFQAJJAHaKAIJGJEQHYJQAZFAKAIAGJLQIaKQFQAJIIJAIALAGaKQIJJQAZFAIAKAGKLQJQAQFZIAAJJALAGaKQAQIQFJJAAZKAGKLQAQJQFZIAKAAJLAGaAQ', 'GNBDjGDBEBFBVBiBTDYEIGQGaGrGIQLZHQCQDQAJJAKALAGAIAMaBQFQEQHQCQDQAQJKKALAGAIAHaCQDQAQLJIAHAMABaCQDQFQEQLIGAHKGQIQLaAAEAFAHACADABKMQGQIQLQKQJaAAEAHALKGAIAMABaCQDQFQLQEQHQAQJKKAGAIALaCADAFABKMQLQGQIQKQJaAAEAFAHACADABAMKLQBaCQDQFQEQHQAQJKKAGAIABALAMaCQDQFQHQAQHIBI', 'GNEBRBdBgBFCICUCADpDsDSEJGhGHJFADAIYJZCQEQGQAQHJLABAKAMAJAIJDQIYJYMYGYCYERAICCGIIIJIDIMIFSBYKYCYAYLYHYECGIASCIKIMIDCIYJYAYMYCSKIDIBIFBIYJYAYCYGYESHIKILIFAMYCCAIIIJIMIFSBYDYCYKYLYHYECGIAIIIJIMIDSCYKYMYACIIJIDIMICSBIFBCYDYIYJYMYASKIBIMIDCIYJYAYMYGYESHIKILIFAMYAC', 'GNEDrGNBSBdBIDQDTDbDCEYEiGoGFAGAKALZIQHQCYEBHIDIIIDQJQFJGAKALAMABaIQHQCQEQAQFJIYJADAHYERCIDIJQFZAACADAEAHAIABKMQIaHQLJKQGQFZAZCADAEAHIIJKQGQFQAZJAGKKAIZHZEQGIJQAJFAKAIAHZLQIKKQFQAZIYJAIALAHKKQIZJQAJFAIAKAHaLQJQAQFJIAAZJALAHKKQAQIQFZJAAJKAHaLQAQAIJQFJIAKAHALZAQ',
  'GNQBTCABNBiBdCLDgDoDrDBEREDGBILIAICRKYMYDAFAJIEIHIIICRAYLYEBHIIICIARLYEYEAHAIAJZBQFQDQMIEAHAHIERMYDAHIEILIABCYIYEQHYDQMIKIABCBIYIQCQAQLQKQMaDAGAHIEBLICIARKYEYGQHYDQMKKAAACAIAJZLQEQKIABCYEYLAJJIQCQAQEQKQMaDAGAHIKIAICBEYARKYGQHYDQMKCAEAKAAAIAJZLQAIEICRKYMYDAHIAI', 'GNVCgDABKBLBEDMDQDYDoDBGaGiHAQGQFQKJDADYEYFYGYKYACLIMIESHIIICRDYHAIALZAQKIHAIALICIDRHYKYAALIEBBIJIDRCYEYGYLYAQKIHICBDBBYJYMYARFIFQKQHKIAIIEBGYFYKYABMIBIJIDRGYGQFaLAGKFQCQEQIZHZAAGIFJCQEQIQHZKALAFAFIEICIDBBYGYJYMYASFIKILIEBGYGAMAJKBQBICQDRGZFZAAJIBICQGQFZMABABI', 'GNaDDGZBcBgBICVCRDTDpDBELGrGAQFAEAJYMYGQIIHIHQKQIYGAMIJIEQFQBaLAIADAAIIIKICBHYHQCQKQIaLQBKFAEAIACALYGAAIHIEIFSCYIYBYGALYDAAAEAHJJAMZHQAQAYGRBIIICAFAMYHYGQDIKILIEAJAAZHAMJFQCQIYBYDAGAMIAQJQEQEICICQLZFAKAHAJJAAMaJQHQJIKQLJCAMIFQCYEYEAAAHZKQLQBQIKCAEAFAMYJYGQLIAA', 'GNsDTGgBACbCBDJDRDYDcDkDDEhEIIDQFYLIGIGAHABZHILQGJHABAEAIAMAAaKQJQLQGQHJFJDACAAYKZJQLQGQHQFJBAEAIAMAKAJZKYEQLQGQHQIKEAKIMACIDRBYEAGZLAJJKQGQEQBIDBCYGYEQMQIaEAHALAGKEQMQIQBQFaHALAGAJAKJEQAICQDQFYHZLAIKEAAIMACIDRBYEAAAKZJQAJEQBIDBCYKYEQMQIaEAGAAAJAKKEQMQIQGaAAAY',
  'HUjBFCGBWBoBpBsBtBuBCCQCRCaCDDIDLDTDcDyDkGOAKAEALAFARYBQSZAQMQJQTYDQCQNJOKJAKALAFAMASIEQFYLSJYOYMBNYCADATIAAAYSILQTYDQCQNIOIMARZQQPQOQNZBAQIRILASYGYHYIYDRCRBINIOIPIMIJILCFIFQRZAAEASYGYHYIYDYCRTIAIGBHYARTYCBDIIIAIHISIEQGQRJFAFYGYRYQYTYIBAIHISIGQTYHASIGIEIFRRYQYTYHYIYABDYCRAI', 'GLdBAGYCIDbDpDREDGhGrGLHDICBFYIYEQJYAQKQHQBKCADAGAIAFAJZEQFKIQCQGQDQBaHAKAAAFAEAJKIQCQGQDQBQHaKADKGADYEZFQDQKQHKBACAGAEAIAJaFQFIIJJICRGYIYKYABDIDQEKIADaEQEYARKIGICBJYCQFYAQIJGQBQHaKAIAAAEADJFIGQJICQIaKQHKBAIACAGADZEQJYFYAQKQIKBQHaIAKAAAEADJFIGQJICQBQHQIaKABK', 'GLgBAGIBJBKBcBbChEDGYGLHFIGIHIAIJICSDYEYKYFBGIHIAIJIESKYFYGBHIAIEICIDSJZKYACHYAQGRFIAIJIKIDCCYDQEYHYARFYGBAIFSJIKIECHYEQFYAYGRKIBQIaKAJAJIEIDICBHYERJYJQKQIKBAKYGBAIFIEIHICRDYJYKYFCEIHICIDRKYFYECAYGREIFIKIDCCYDQHYAYFSEYGBFIESJIKIDICCHYAYCQEYFYGRKIBQIaKAJAJIAB', 'GMIDiGCBSBFCLCMCQCRCdCoDqGAAHAIABZFQGQCJAJDAHAIABAKALZFQGQCQCYGCFIBIKJLIHSIYAYDYCYGYFCBILIHIISAYDYCYGYFYEYJCBIKJLIGSAICIDIICHYDSCYDAGBLZKQBQFQAICADABZKBBJDQCQAYFAKYLJGRCIDBHIISAYDYCYGCBYLYJSEIFIGIAICIDIICHYKZFQGQAJCADAKAHIISKYCRDIKBHBIBBZLZFRGRARDJCBAYDYFCGIAQ',
  'GNABMBBBNBSBTBKDrDQEcEDGhGoGHILYFREIIIARCYGYEAFAKZBADAJAHAMKLQAQCQKYEAFAHaFQEQJQBQDQKKCAAAGAIAHALAMaFQJQHKFAIQGQKZBADAHAJAMKLQAQCQIQKYEAHaBQDQEQKKCAAAGAHAIALAMaFQEQJQBQDQKQGKHAGYKZDBBIEIFBLIMIARCRHYGYEBBYDREIBBFIIICIACLYMYJYDRFIBRGIHIAACYIYBYFYERGIHIKJAICBIYBYBA', 'GNBDYGkBDCdCEDJDRDbDiDqDMEgEAYGYHYDYFYLYECCICAKJJQIQBJIYMAJZIQBQDQLQFQAKGAHAMAJAIZKZCQEQAIGJHAMAJAIAKZBQIKDQJQMQFaDALAIABAKKJQMQFQHQGZDAAYEACAKIJJMQIaDQLQAQGKHAFAIAMAJZKZCQEQGIHJFAIAMAJAKZBQJKDQMQIQAaHQFJAAHIDAIAMAJaBAKKJQMQIQAQFZGZEACAKIJJMQIQAQFQGZDAHALAIKAQAI', 'GNBDhGSBYBACJCNCKDTDbDoDkEDGHICAJYKJDQEQAYMYGALAKJBQJQCQHYJYLYGRMIAIEADABYKYGQIIIAGALAKABKJQJYBYGQKZLQIQIYGBBIHICAJIDQEQAYMYGALIKIKAJABZLQGQKICQHYMIAIEADABYLYGRIIIAGAKALABKJQCQFQJYBYGQKIHQAQAIMZFAIAKAHJAQKZHAGAAIBICAJIJABaGQLQAQHQHYGBKICAAYLIBIDQEQMYIYGALABJJQAQ', 'GNNCBDABMBcBJCQCbCKDSDsDhEDGGQCQBYMYAAEIDRIIJIFICICQGBLYFRIZFAJADAHAKZEQEYASJIIICAMIBIGALAKZFQHQIQJZDADIECHIFIKILIGSBYCYIYJYEYDYMYACHIDSEIFBDYHYASEIHBDIFRIIJICIMIBIGCKYLYFYDYDAHRIIFAJIKJLQCQBQGQMaJABJCABYJIMIGALAKZDQFQIYHBDIFIKILIGSCYBYIYFBDYHREYMYJYACHIDIEQFRBJ',
  'GNRBUCEBdBgBFCICADqDsDSEJGhGHJGAEAIZJZBQCQDQFQHJLAAAKAMAJAIJEQIYJYMYBYDYFRCIDCBIIIJIEIMIGSAYKYDYCYLYHYFCBICSDIKIMIECIYJYCYMYDSKIEIAIGBIYJYCYDYBYFSHIKILIGAMYDCCIIIJIMIGSAYEYDYKYLYHYFCBICIIIJIMIESDYKYMYCCIIJIEIMIDSAIGBDYEYIYJYMYCSKIAIMIECIYJYCYMYBYFSHIKIAILIGAMYAQ', 'GNgDJGABQBRBlBBDaDcDMEjEDGoGAIDQCQHAIZJQBJGQLaBAJAFAGIEAIYKAMKAQDQCQIQEQGZHAEICIDBIYEQAYHQGJCADAIAAAMaFQKQJQGJHAEAAIEIIIDRCYHYHQGaEAJAFAKAMKAQDQCQIQHQGQLQBaEAJAGKHAHICIDBAYIYKYMYFQGQHJKAIKAAAIDRCYKYGYHYFBIIMYIQAKKQAYHZGAAAIAIYMJFQKQHQGZAAHJGQAZEQJQBKLAAAGAHZEQAI', 'GOBBbDFBKBLBMBVBhBlBACCGYGiGqGAQHYMYNYIYGRBILIJQKZEAFABABYGBIILIMINIASJIHCAYAAMYNZIYGRCRFIEIKIHAAAMYIYGYCRFREIBAKIJALYGBIIMINIARLYGYFYERBIGALIABMYNYIYFRLIJQKYBAEAEYCCFIIIMIAQHQKYBYCAFBIIMINJJRHIABJYHSDYGYEYLYFYFAIBLIMINIHIDSAIJBDYHYLYFQMYNYIRFIEIGIAILIHCLYMYERGIAI', 'GOLDhGCBNBSBgBEDQDTDYDpDrDAEcEGYDAIIEIHIJIFBBYEQKYLYNQIQHKEABIFQJAJYEYHYIYDRAIGICIEBIZEQHQCQGZAACIDAEIHIJIFABYERGQAZCADAJKEABIFQMQAZGAMIFBBYEQFQMIAQGZMAEABIFQIAIYEYHYJYDRCIMIEBHZEQJQMQGKAAEAIAHAHYJZEQGYMQCYDBMIEIEQIJAQGZIAAJHAFABYEQAQAYEBBIFQAYEYMYDRCIIIEAAIMAJJAQ',
  'GOsDAGbBDCQCUCVCIDMDRDZDhDoDqDHIIAFAGAAANJCQDQBIEBKYLYCYCANZAQDQFQGQHKBQIaHAFAGAAANJMJLQKQEQIYHZFAGAAANAMJLJKQCYEQBYDANZAQFQGQHJDANAAZMALJAQNQDQHZFAGAMANJAALZNQMQFQGQHJDAAALAKJCQAYDQHZFAGAMALJDQBIEACYKYKANaLQMQFQGQHJIJEACANYLZMQFQGQHQIJBADAJAAAKALALYMZDQFQGQHQJKAA', 'HRQByGCBUBiBADIDVDZDdDjDrDgFlFDGLGRGIIOIPICIFIGIABMABZLQKQDQQYHZJANALJBJMQIZEAKYDQHQJZNALABJKQEQHYDALZNQJJQJIAMAKZBZNQJQQJHAEALYDQJZNABJKJMQIQHZEALAKABZNQJJEIHIIIARFYGYCYEBIJEQHQCQFJGAAACYEYHYEQFQGJAACAHAMABZDQLIEQQZJAIJLADABJMQHQAQCQGZFAPZJAIALJDAKIEQHJMABZKQDQEIHIMIAS', 'HRZBcHGBKBLBaBsBbCgCIDQDpDtEAGDGUGxGIAQYHQEQOQNKJAJIKAIALYFQDQKIIBAYDYDQKQFAJQLIAQIQNaOAJKKAKIDBFYEYEQPZCQHAOINIIAQIAQFYDRPYJQKJNQOaCAKAJABAGAMAQKLQLIAIFRDYABLYLAQaGQMQBQCQJQKQOKNAPAAAJZKQPJAADIIRNYOYCAKIJIAIDBEYARJYKYCQOINIIBEYDRJYJAKaPQJKKAAAKIDBEIFBQYFQHQIQNYOYCAPIAI', 'HSuBRECBGBLBkBlBoBrBFCQCWCDDcD0DAEpEhGEINYJQMICICQPIKBMYRYIAOYGQJQDYLBABGIJRNIDQMICAIBRIKRPYCYIBNYIQJAOIQIHIKRBYNYCQEQMZDADYJCFIERFANIDQMICABIKBHYQYOYFRAYGBFIOIAQQIHIKRBYNYCQMYDAEBAYGYFBGQJQOIAQEQDQFQLQMKCADAIANANIBIKBHYQYAYOYEQFQNQDQIQMZJAGALAGIJSDIIIMICIPIKBRYAAOYJQNIAB',
  'GLlBACYBMDUDrDBEREbEhEDGCQDYEYACFIIIJICIBSGYKYAAEIHIGQCAKZDAHAJAFaIQEQAQDIHIGIKIBCCYFYJQEaAQHQDQDYKJGAEACIBRGYKYABHIEIJAFJBQGQKZDAEAEIGIBBFZJQHYARDIEIKIBACYGQKQDaEAEYABHIGICIKICBFBJZGRHZARHIKICICQDQEZKAAADJEQKZAAHICIEQDZFIBQKYAZHBIBGJCRARDIJIBREYEAFAFYAYCBJIBI', 'GMADoGMBFCcCdCYDaDgDIEKECGHQGJJQAQLZCAEABJIQHZGQKQAJJAHAIABZEQCQLJJAHAIAGZKQHJJQLZCAEABJGQIQJQAZHAKAIJGABZEQCQLJAAHZKAIAGJJQHQAQLZCAEABJJQIZKQAJHAIAJABZEQCQLJHAIAJAGZKQAQIJHQLZCAEABJGQJQHQIZAAHJJAGABZEQCQLJIAAZHAKAGJJQAQIQLZCAEABJJQAQIQHZKAAJJABZEQCQLJHAIAJAGZAQ', 'GNABrDKBLBMBZBlBNCBDQDDGoGaHFYMYERDICIJIAQIYJAKYHAGABILIFQAQJYCYDYEBMIAIAQJQFALYBYGQHQKICAJIFBAYMYERDIJIFIABMYEYDRJICQJADAEABAKYHAGALKMQAQCQFQIQKZJAIKAACAFAMALaBQDQEQGQHQIQJQKKAACAFAIaCQDAEABAKYHAGALKMQIQAQFQKZJADAEAIKMALaBQGQHQIQDQEQJQKKAACAFAMALABaIQIYDREILIMIAS', 'GNBDgGdBACJDRDbDjDsDDETGYGpGJIEIMYIYCQGILIDQAYEAFAFIKZJQEJFAKALAGaCAHABJIIMIDRKYLYJYCBBIGQHZBAIAMJGQIaBQCQJQKKLADAHAIAGAMaBQCQJQKQLKDAHAIAGAMABaCQJQKQIKGAIYKZCBJIBIMIDRHYLYCAKJGQIaLQHKAQFZHYHALAIKGAKZCQLIAIDBBYMYJYCRIIIQGKAQLZGAIAKJAQIaKACAJABKMQAQDQIQKZLYGYCBJIAI',
  'GNCDoGLBMBNBcBdBjBEDaDsDAEQFCYDYFBJICRDYFYEYGBJIJQEQGQIQAJFAHBJYKYGREIHIFRAZFAIAHAJAKABJMQLQAZIZHAHIFIDICBJYKYFRHYHQIJAJLAMABZFQHQIQAJCADAJAKAFYHRJIKICSDYDQAZIAJAJIDICBKYHBFIKQCQDQAQIZJAAJCADAKAFYHRKICRDYAYAQJQIJDADICCAYKYHBFIKQAQCQDQIZJAHAFABJMQLQIZJZEBGBHAFAKJAQ', 'GNLDqDNBgBhBkBlBYDcDiDSEAFDGMYCAIAFAGABJJQKQIZFAGABAJJKQHJLQMZAAIAHAKAJZBQFQGQHJIQAQMJLADAEAJZBZFQGQHQIJKABAJJDQEQLQMZAAKAHZFAGAJJBQHQKQAQMJLADAEABZHQKQIZFAGAJAHJBJDQEQLQMZAAIAKAJZHABJJQKQIQAQMJLADAEAJZBZHQFQGQIJKABAJJDQEQLQMZAAKABAJAHZFQGQBJKQAQMJLADAEAHZJQKQIZBA', 'GNVBACYBbBiBlBRDTDZDoDrDBEDHDIIICIBRLYMYABHIFAKIEIJIBQGYIAEAEYDYKYFQHQIJDAKAJJEQDYHYIYARMIDBGIBAEAJaEQKQHQIQGJDRMYABFBHIKIEIDRGZDAIAEAKZHQEIDIFQIIDAKAHZFQHIJIBQGYDYIYARMIDBIYEAKAHAHYERAYFBEIHIHQAQIIKQDRMYFBIIDIEAGIBAHIJYKQDQDYAYIYEAHAKJAQIQGJCADAAYHYKYERFRMIDBCIBI', 'GNkEDGMBNBYBZBaBbBSDcDoDqDAFIAGAHALAKJEQFQMQBaCADAJAAAKJLQGQHQJZCQBJMAEAFALZKZAQCQDRIJJAGAHAKALJEQFQMQBZIAIYDBCIHIGIJIMIECFYFALZKQGQMQJZHAHYCYDRIIIQBKEAFAJAMALALIFRERJYBYKYGQHQIYDBCIHIGBKILIFIERMYGYHYCYDRBIDAGBHYCYAAKJLQHQGQBYDAAAKALJCRAYDRBIGAHACYKYLYDRAIHIGRIYAA',
  'GNlBQCRBhBiBNCADCDEDLDSEjEIGKIEBLYAYFRJIMIBADYCREYKYABLICIDIBRMYJYFBLICIDIERKYCBLYFRJIMIBBEYDYLYARCIKIDBEIBRMYJYFBAICRKIDIEBLYCYAYFRJIMIBBLYDRKYABCIDILIBRMYJYFBCIDILIERKYAYDBCYFRJIMIBBEYLYCYDRAICBLIEIBRMYJYFBDIARCIKIEBLYAYDYFRJIMIBBLYAYDYCRKIABLIBRMYJYFBCIDILIERAY', 'HOWBIFDBUBiBrBVCmCBDjDSEsEgFEHEQIYCYJYNYABHBLIDSJIKIECFYDYLYHRARNICIEBFCDYLYGRKICRNYABKICIFIDCJYLYCSJIKYARNIFBKYGBCILIDSJYKYGYAYHBCIASGIJIKIESFYNYHBCBAILIDIERFSNYGBCYABLIDIEIFRJYKYDCLYARCIDQDIJIKIFCEYLYAYCRDIABLIEIFSJYKYAYDYCBLIARJIKIFCEYAYLYCRDIGRNIFBECAYLYGRKIEIAC', 'HSCBGBFBSBbBoBpBrBACBCVCWCiCTD0DDEYEsGEIHBOYRYLRBRCIPIAIDBMBRYKRBYCRPIAIDIMBQIFBGYOZRYERHIQIFIGBRYEYHRQIMRDYAYPYCBBIKBHIEIOIRIGRFYJRDYAYPYCYBBLBHIEIRIGIFRIRDYAYPYCYBYLBHBEIOJRIGIJRARPYCYBYKBHYEBRIGIMRAIJBFIIRDRPYABMBGYRYERHIKRBICIAIPIDBIBFYGYOZRYEYHRLRBICIAIPIJBGBRYEYKRCRAI', 'IYyB1BIBJBZBuBFCGCPCYCnCADSDdDiDpDwD4D7D-DrEaGkGCHBAIAMINITYKQVIWIOIEIDRCIEAJBOYPYAAWYKATISIRJQQPQDQDYCSJIDCCYCAPAQARZAQPISYTYKQWIOIPAAAQARASaAQUQOQWZKATIBQOIWIPIPQWaOAOIPJQJWIJRDICBJYDSEYEADAQYPYBATYKQOIVYGRXIEIDBEAMYVYWYGYBCOYKAPITIUIAIRISIJRVYWYACPYUYTYKQOIBSGIAIMIEQLICAVIWIJCQYPYAQ',
  'GLAGgHQBUBjBFCIDaDkEKGRGFQAKGAGICBHZJYDAKYEBIYFRDIEIEAHKKQCQJQGQAaDAEAEYDYFCHIIIBIKICSGYJYKYHYHAKKJQHaDQEQAJGAHAJAKaDQEQHKGQAZHADAEAKKJQGQAQHaDAEAGKJAKaGQDQEQHKAAFQJAKACAGZDQEQHQAKJAKACABYIYFRHIKICAGYEYDYHQKJEAEYDYDAGKCQDQEQHYKaAQJKKACADAEAGaHQAQJQKKCADAAYEAGABA', 'GLiDBGNCEDLDZDqDJETEgEkEBYDYCAFYHYEYIYKAGJAQIQEQDQBJHAFAJAAZIQEQFKHQBZDAFAEAIAAJJQHQBQDaFABJHAJAAZGZKQCQFIDJHAJAAAGZIQEQBQDQDIFZCAEJIAGJAQJQHQFZDABAIAGAAJJQHQBZDQFKBAHAJAAZGQIQDQFQBJHADaIAGAAJJQDQHQBZFAIADJJAAZGQDQIQFQBJHAJAAAGZDQAJJQHQBZFAIAAADAGJIIJQHQBQFaIAAA', 'GMLDpGCBaBgBSDYDjDsDUEAFDGAIHIDIGIEABYDQGQFQCQFYDCBIEQFIKQLaAADAJAHAGKBAIaGQHQFJCQCIKIECBYIYGZCQDQHQFQJQAQLKKABAIAGZCQBIGIIIESBYKYDYCCBIEAGYIIIQBQCQDQAZJAFAHAIJGJEQKQLaJAFAHAIAGJBQCQDQFZHAIAGABJDQDYCYCQFQHZJQLKKAFZIZJQAJHAIACACIDIDABZGQJQAQHJIACADABAGaJQAQHQIJCAAY', 'GMYBTCABSBZCCDQDUDEEcEJGrGAQDRFYGICRDAKYBBDIEIAIAACRGYCAEALaDQBQJQHQIQFKBADAKAGAAALICQAYEYDYDBHZHQBQIQFQKKGAEAGIABCBHZLYBRDIEICIAREQGQKaAADABAFAIAJALKHQCQCYEYBYBQDSGIGQKIKQFbIAGJBAHICQAQKYDCBIEIAICBHYHALaBQDQJQGQIQFLKAAAEAHICQAYEYDYBCGZHIJALKERAICBEYHYHQARDYGQBQBY',
  'GNACSGEBFBaBcBBCdCCDKDrDYEoGEIHAKILIMIASGYBYIYJYCYDYHBFIDSBICIIIJIGIACLYEYDYFYMYKYHSBICIIIJIECBYHAKILIMIASGYBYEYIYJYCYHBFICSBIIIJIEIGIACLYDYCYFYMYKYHSBIIIJIEIDCBYHAKILIMIASGYDYEYIYJYHBFICILIDSBYEYIYJYCCBILIDIESGIACEYDYLYFYMYKYHSCICQIJJABAFALAKAMJDQGQJYIYCAHAMIDIGRBY', 'GNACpGNBUBdBYCBDJDSDjDsDDEZECAEAIYDYEYJICRDQIILIGIHIAIFCBYKYMYDYJYCREIJAKABJMQAQFQGZHAIAJAJYEYCBBIDQJQIQHQGJAAFAJZDAKIDIJIMIFSAYGYHYIYDCEYEQIJJAMABZKQCQEIIIDSGIHIJIAIFCBYKYCQMYDYEYIQJJEAKABJMQAQFQGZHADBEAIZJQLQHJGJAAFAMABZKQIQIIMIJYCAKIBIFSAYDYEYLYCBIIJIMIDRAIFCDYAR', 'GNIBkBFBJBYBZBMCVCDDoDqDSFAGHQCQIILAKAJJEQFQDQMIAADYLYGYBCHYCSBICAHBJJKIFIEIDRARMYIYBACAKIFIEIDIARLYGYFCEIEAJZKQCQBQIIFAEAJAKZHRBYCBHIBSEIEABAFRIYCAFAHAKJJQBYERFIBBJAKZEQFQHQCQIIBAFYECHYCSEICAHBKJJQFQBQIYEACAKAJJFQFYBSGILIACDYFYBYJYKYCRERIIMIAADBFYBYJYKYCYERHIGILIBC', 'GNMCgDABBBKBVBaCbCCDEDoDQEkEHBMYFRAIHIEIGBMYHREIGILICRDYIYGALAMAKJBQCQDQIYMYGRJZAAEAFAHAKJGQBICQDQLIIQJZLAGABIMACIDRMYGYHYFYAREIFCHIGIMIDBCYBYGQMQLQJJIADACABYLYGBKZAQEQHQFQJJGAMICIDRLYGYFYEYJYACHIKIMIGSFYEYJYAYHCKIMIESFIFQJQGABIDQIJLACACYGYFYEBBIBAKaMQAQHQIJJAEAFABA',
  'GNQBjDEBKBLBNBUBdBgBCDAEZFrGFAHABIERDILAMZBQGQCQHQFQJJKIABIBMYEQDQKIAIIBLYDYDQKQEAJZCAFAGAHABAMKDQLQAQIQJZKAEAEYGYCRKIEBGYCYCQHYFRKIEIEQJJAAGADAIALAMaBQCQEQFQHQKQJJGAGIDCLIISAYDYGYEBCBMIIQARDYGYEYCBLIAIDRGYABLYCSEIAIGIDBIBMYCQERAIGIDIIBLYEYAREQGQJZAACABYFQKAHAHICIAR', 'GNRBpGQBUBVCEDIDMDgDsDCESEiGBYGAAACAIAJYMZJABKMQJaLQKQFZHADALIIIJICRAYKYDYHQFJDAGIAACALAJJMABaEQJQLQDQHQFQGKDAKAHaEALAJABKMQJaLQHJIAJIJAMABaEQLQHQIKDQKQGaDAFAIAHAHIJJDQGIKQAICBKYDYDQIZHAEAJALABKMQKQAQCQGZIADAKICRAYDYIQGJAACADAKAMABaEQJILQKICIARDYCBKYJYJQHQHYEBLIMIAQ', 'GNVBAGJBgBlBICSHKDMDhDpDrDDGCQHYIYAAEAJJLIKICRGYJYEYARIIIQHKGAJAJYKALZAQEQIQIYABEIKILICIDIFRGYHYHQMQBKGAJAJYCBKYLYEYARHIIICIJIJQGQBaMAHAHYIAAAEALJKQCQIYABEICIKALZCQEQAQIQHQMQBKGAHaIAIYCBJIDAKILYKQCQJQIQHKGQBaMAAAEAHACAKILIDQIYCYEYEAJJAQCQHIGIFBDYIQLYCQGQHaMQBKHAMZAA', 'GOLDrGCBbBcBdBACFCDDRDTDpDYGgGCYAYLYBYFQHQIIAAKAKYEBDIJICQMIGQAZIZHAFABILINIGRCYJYKYEYHYFCDIDANJHQIIAICAGALABaNQLKMQEQJQKQAQAICIGBMYEQGQKICQIaAAKAEALYDQFQAJIJCAGAJAMABANaDQFQLQHQBIKJIQAZKAIJEAMIGRCYAYAQKaIAFADALINIGQCQKYIZFAFYDCHIFSEIEAJJAQIQIYEYDYHBFIKICAGANYLYFQMJAQ',
  'HRMBAEQBbBtBuBWCCDNDZDgDKEcErEEGoGwGKICQBQHZOZIAAILIBICBJYKYDYMYEBFYGRAIEBMIDIJIKICRBYLYEYAYGCFINIPIQICRJYKYDYMYAREILIDBJIKICBPYQYNYFYGSEIABFBNIPIQICRJYKYDRLYAYFBMIDIJIKICBPYQYDRMYFREYGCNIDIPIQICRJYKYMYDBNYGSEIFBDIARFYEYGCNIARMIJIKICBPYQYAYNYGSEIDBMIABPIQICRJYKYAYMYDRFILIAB', 'GKFBQCABEBDCcCUDBFoGZHFIIJBQJIBICTHYEYDYAYGYFCIIJIESHICDBYEYIYJYFSAIDIGIHICIBCEYCTHYCADYAYGYFCJICIEIBSHYCCJYFSAIDICIHIBCEYIYJYFYATDIDRCJGBFBAYDRCRGICAHIBIECIYJYAYAAFRCYDCFIAIIJJIESBYHYCYABGYJIEIBSHYCYAYDYFCJICRHIBCEYCYJYFSDIAIGIHIBIECCYBSHYAYDYGYFCIIJIBICIESHYAY', 'GKNBACbDoDBELEiEkEDGYGCIEQJIBRIaAAFACACYARFIIIBBJIDBGZHZARHIGIJIDIBSEYCYCAFQIJEADADIEQIaFADJCQJZDQFQIKEAEIBCCYFYGYHYJYDYACDIDRJKBQCQEQIaAAFAJACKCQJQJZARFIIIBAJYAZCBDBHJARGIJIBSEYCZCADADZFRCJIJEAEIBCDYGYJYACHZFRJKDQEQIZCAAJEJDBJaAQDQEQCQCaABEIJIBQIYAZEBDKAQJJCRAZ', 'GLCBdChBkBQCADUDiDqDDHRHDAEACYHYIIHQKQAQAYGZJYBCDIIIHIKICIERAYCCHYIYKYDYBSGJJICIAIFIECKYDYDAIAHJKQEQFYCADYGYBAHIIAKIERAYDYCRJYBBIIIQGQGICIDIAIEBKYCRGYGAIAIYBRJIFIDAEAIaCACIDQHYBQGIDIAIDQIIEQFYAAGaBADAHIKIERGYGAIAIYARJYBBCIDIAIIIIQGQGIEBKYARDYCYBRCAJIFIEAGAIYDYCYBY',
  'GLEDbDKBiBACdCgDjEBGYGLHCYGQKYFBHIDIJQEQBZDAIYAYFAHAGLJQBQBYCQDYGYHYFSKIDBBIDQEQIQAaKAFAHAGAJKBQBYGZHQJYFQKQALIACADAEAGABABIJZEQHQGJCQDQIQAbKAFAGAHAJKBQBYCQJYDQFQGZKQALIAAYGACAGYKYFCHIDIJIBIBAJaDQHQKQAQIJGAAaKADAHAJKBQBYCQDYHYJYFSKIAIAQGQIZKAFAAJCADBJIBIBAJaHQAQAY', 'GLFCYCkBlBACcDpDBEDEREhGFYDAFACAGKKQCYDYARIIHIJQEIBCFYDAJYCYKYGYGAKKCQFQJQFZHRIZDBDIHIIICDFIJIBSEYCYFAIYDYABGIJAKZGQARDIHQFJIICIEIBCJYCSIYDYABHICIJIBSEYFZIYCCFJHYARDICIIIEIBCFYJYHYAYDSCIABHIJIBSEYFYIYAYCYDCHIARHAGAIIKJJQFQEIBCFYJYAYHYDRCIIIABFIJIBSEYAYIYCYDBHIFIAQ', 'GLNBqGCBDBEBJCSCdCTFgEADAAFYHABIGQCQCYKIFAGBJABaHQIQDQEQKJAQCAGAJIFRCYGYDYEYAYHCIIESDIEAGICIFBJYEYIYHSAIDIKIGIECJIFRCYEYGYDYAYKYHCIIJIESCIFBEYJYIYHSAIDIKIGICIFIECJYCSGYDYAYKYHCIICIJIESBIFYGYDYCBJIEIFSGYECJYCRDIEIEQGIFCBYJYCYIYHSAIAADIHAKYDAIABKJQFQGQKZEAEICCIYHYAS', 'GLdBaCYBZBACFCJETEjEoDCGAQFQHAIAKIGABADAJKCQCIESGYBBCIBQDRGQKaFAAAHAIAJICIBRGIEBDYBYCYIQHQJYAQFQKKEADAGABACBJaIQIYAYAAFRHICICAIAJKBQDQEQGQKaHAFAJIIQCQHYFBAICIIAJZAQCRFQHQKKEADAGABAJZIQHQHYCCAYFRCIHIHAIAJJBQDQEQGQKaCAFAHAABJJIQAYFYCSHIABIAAQJZFQHQKKEADAGABAJZIQAQAY',
  'GLrDCGYBZBMDSDUDaEcEAFoGAIEZGAIAAAKKCQDQJQBZGAEJFAHAAZIQEQGQBKJADAKZIQEQGQFJHAEZIAKJDQJQBaFAGAIAAJEQHQGZFQBKJADAKZAQEJHQGQFZIAEAAAKJDQJQBaIAGJHAAZEQGQIQBKJADAKZEQGQIQFJHAAAGZEAKJDQJQBaFAIAEAGJAQEZIQFQBKJADAKZGQAJEQHQFZIAAAGAKJDQJQBaIAAAGAEJHQAZIQBKJADAKZEQGQIQFJAA', 'GMIBNCMBjBYCDDKDbDZEkEAGRGFIIQHZCQKIAALYDBJYBRGJKQFaGACAGYBCJIDRHKLILQKQFQFIAIECIYDYJYLYHYBSCIGIFAKIKAHALJAREQFZGZCAKYCYBCJIDILIAIARHZCQGIFIEALaCQDBJYBSGIGQFKKAGaBBCADAJIAIIILJESGYHYDYKYFYBALIDQGJHADYGQHJEBIYAYJYLYBSCICAGJHQFQKJDBEAFYHYGYCQLZGQCYBCGIJIAIABJZGRCRCIAI', 'GMaDDGKBLBIDQDUDiDcEYFAGrGGAIAHJAQCQDQEJFAJALaHQIQGQEJFJJAAZCQDRGZDAIAHALKAQJQFZGACADAHZIQEQGJFJJAAALaIQEQGQFJCADAEZIALKAQHZEQCQDQFZGAIAEJHJAALaEQHJAJJQFZGZIAHAEALKJQFQGZCADAHZEAAJHQCQDQGJFAJALaAQEQIQGJFJJAHZEZAALKHQEZAZIQGQFJCADAAAEJHALaIQAJCQDQFZGAAAIALKHQJQFZGZAA', 'GNBDoDSBYBkBlBACJCNCbDLEDGhGBJCADQGQAYJYEALYIAFABJMQJQCQJYEYFYIRLIAIGADAMYBYIQKIEBJIEQHQAQAILZHAJYKAFABAIAMKJQHQAYBYFQJYMYIQKQLJAACAHABYEQKYIBMIJIDQGQAYLYIAFIEIBIBAJAJIHRCYKYEBBIJIHIDIGRCYDCHYBYJYERKIDICIMYFQIQLIAIGCHYBYJYEYMYFYFAIRKIEBBIJIMICSDYDQAQLZKAFAIAJIMICIDRAQ',
  'GNCDoGNBQBRBdCAESEEDhDjDrDKGDQHIEIGQAZIZCAFAIILIBIDQGQMZIQAKMAEAGADABYJAKZLYLABKDQJYKQLZHQIQAQMJGAJADALAKABaFQCQHQIQMIEAJKEQGQMaAACAFAJAIAHABKDQKQLQEQGQJaAQMJJAAaIAHALJKABZFQCQMIEBGIDBBYDQLQKJGQAQEQJQMaCAFAIAHAKALABKDQGQKaEQHQIQMJJAIaEAHAKKAQIQJQMZHAKAAKDAGABaLQAQLIBI', 'GNEDsDJBbBgBICCEUEhEMDSDZDkDDQFALYKQGQAaJAHAKJLJFQAYJZHAKALJGQJQAJCAGYDBIIEIFRCYCQAZJADAGAEAIABaMQLQKQHQJJAJCAFABYIQKZHQJQAJDAGAKAIABJFQKZIABAMaLQBJIQKJFAMYIQKQDQGQAaJAHAKJIALZBQKQHQJQAKDAGAIAKZBALJKQIQDQGQAaJAHABALAKJIQBZHQJQAKDAGABAIAKZLQHQBJDQGQAaJAAIBAHALAKJIQDQBY', 'GNKDoGABMBNBQCdCEDbDrDREBGhGAYDYEYGBJIBIFQCQLYHYGAIIDQIQEQGQHQLKAAAYHZDAEALYGAIAIYMJGQKQHQLIAIAQLaDAEAGAHJIIKAMZIQGQHQDQEQLKAAAYKALYGAHIMAIaJABJIQMQKQHYGQLIAIAQLaDAEAGAHAJAJYMJGQKQHZDQEQLKAACAFAHAKAIABaMQGQJQDQEQHKAQLZHAAKKAAYIAJZDQEQAQHQLJKAAZDBEAJJIQAQKQLZHAEAJAIJAQ', 'GJrDYGLCADcDMEDGIHgHCQEQFQGQDLHABAIAAaCQEQFQBKHQDbGABACAFAEAALIQHQBaGQDLBAHAIAAbCQEQFQGQDQBKHAGaCBFAEAALIQGQHQBaCADAFAGKIAAbEQGQCQFQDQBKHAIAGaEAALGQIQHQBaCADAFAEAAAGKIQEbCRDYFQDQBKHAEAIAGaAQCQFQELCAHQBaDAEAFAAAGKIQHQBQDaEABKHAIAGaAQCQFQBQEQDLHABaCCAYFAAAGKIQBQBI',
  'GLACcCVBlBBCKDTDEEYEaEoGFAGYBAKJIQAQEQFZHZCBCYDDBIBQGJHQFJAAEAIAJIIIASEYFYHYCYDYGYBCJIKYJQGQDQGICSFJHIEIACIYKYCQGZBQFIHAGACAIIKIASEYGYHYFYBAJAKJIQGQHQFZCCDAJYBRDICIFIHIEIACGYIYJYBYDSCIBBCQJIGIIIASEYFYHYBYCYDCJIBRDQFKHAHIEIACGYIYBYBQHQJYDRCIHIBCGIIIASEYBYHYCYDBJIGIBQ', 'GLMDhGRBQCUCVCEDoDsDSEAHAYGYFBIZEQEIBICQIIHIDQJIKQGaAAGIJABAIAHJCQBYHYIYEYFSJIKIDCCYCAHZIQBQKQGQAZJAJYFCEIBIKICICAHADQIZBQKQJQAJGACAGYAYJYFYECKIHIHAIABZIIDQKQHKCQGQAZHZJAHAKABKDQIQCQHZJQAJGAHACADAIABaKQJQAQGJHAAZJAKABKDQIQCQAQHQGZJAAJCADAIABaKQAQFQJQGKHACAHIDBIYIABA', 'GLQBTCUCADIDRDZDgGoGrGCHCIBIFIHIKIDIEIABGYGAHAIAIIJaBQFIGIJIATDYEYGYKYCBBIHIGQFaHAGKFQFIABHYIYJYGRFJFQHQKQDKEADYKYCYBCFIFAGAJKIQGaFQFZBRCRDJDQELABKAHAFAGAIAIIJaBQCQHJGAGIJIATGYHYGQKYDYEYBCCIFIGIABIYJYFRGJGQHQDQDZERKJABDYEYHZGAFAKYBYCCJKCRIQHQGaFAFYBRKJAJDBGBEZAQFZBY', 'GLYBkBNBjBdCLDTDbDoDZEAICAEAFAGAHABADAILAQDQJQKQFaGAGYCYEBBIHQCQCYEYBCHIBQHQEQGJCADBHYIYBSEIDICRGZDBCIKIACJYHYIYBYERDICBBBEAHIIJJIASKYBYCRGIGQFKKAAAJAIbHQHIBRCYEYDSFIGICBBBHZBQEQGQGYDBEIBIBQGQDYEBBIGQDQDYEYBCGIDQCQFYBAGQEQEICIDBJJAJIBHZHAGbEQBQFIDAJQCQCYBYBQEBJICRBY',
  'GLsDDGCBcBVCaCbCMDSDgEIFIICQBaHAIAGAAYEQIIIQHQBKCAFAKAJAAaDQFQCQGQCIFCGYCSHYIYEBDICIGIFSHYIYCCDYERCIHIIIFCGYDYEYCSHIIIDCGIFSDYHYIYCCBYEIGIFIAIDRHYIYCYECGIFIAIJQKQBZCAFAAIDQIQHQCYFBIIIQHQCQCYFYEYGCAIHJFQIIDICSFYDDCICBIZHQIQHZABHJCQDQIJFRDYCCAYHYIYGSEICIDIDAAAAYCRDIAA', 'GNADrDFBcBlBICTCUDgDRECGKGoGEABIGQHYEAIIFQLZHADABAGAMKFQIQJQLQAQKZHAAKLAFAJAIAMaBQDQEQCQGQAQHQKKLAHaAADAGABYEQCQAIGAHIIJJQHQLQKaAACADAEAGAIABAMKFQHYJQIZDQGQAYCAEABIGQLJHAFAIAJAMaBQDQEQGQIKGAMIFQHQHILZAQFAMYGQIYCQKKLAAaIAAIHJAQLQKaCAEAIAHADABAGAMKFQJQAQLQHaGABYEQCQIIGAAI', 'GNCDoGRBSBlBNCEDgDiDrDAETEKGCYIIHICQKQAZGZFAEAGIJIBICQKQMZGQAKMADAKACABYHAIZJYJABKCQHYIQJZLQGQAQMJKAHACAJAIABaEQFQLQGQMIDAHKDQKQMaAAFAEAHAGALABKCQIQJQDQKQHaAQMJHAAaGALAJJIABZEQFQMIDBKICBBYCQJQIJKQAQDQHQMaFAEAGALAIAJABKCQKQIaDQLQGQMJHAGaDALAIKAQGQHQMZLAIAAKCAKABaJQAQJIBI', 'GNNBqGgBhBICJCSCdCADEDTDbDCELQKQAYHBBIGQHQMQJZAAAIMIGBBYGQHQAQJJIJEACAFADABZLQKQMQIQIIGBDICIJYAAHALIBIESFYCCDYGRCIFIECBYDYFRCYIYLYHQAQJIIAMAKALABJDQEQFQCQIZGBJYAAHABIFIDIERCYDCFYGSDICIIIECFYGYDSCIGBDYBYCRHQAQMYAYHCBIKILICIDIDAGRBYMYCBKYLYHSAICIJIIIMIGCBYDYKYLYCSAYHBCIAS',
  'GNRBkBNBdBICKDgDiDoDqDAGDGSHDQCQFYLQKKFAAAFYKYLYCBDBBIHIGIJIIIERAYMYDYCRKIFILIFQKaLAFKMAGAHZDQDYCYBBJIJAIKDQHQGQMQFaLQKKFAFYKYLZBBCILIMIAIEBGYHYDYIYJYCRMIDBGIHIERAYDYMYCBIIHIJIGIDRAIAQEBDYGYHYIYJYCRMIAIEIDCGYHYARMYCBIIJIAIGIHIDSEYMYCYBRKIFILIFQKaLAFKMAAAGAHAIaJQJYBRCIAI', 'GOCBsDABQBZBbBgBBCLDSDUDcEDGpGEIHRAYIYKALABANJHQAQMZKAIJJAEAFABZLQIQKQMJAAHAMYNZLQIQKQJJEAFAIZLANJHQAQMYJAKALABJIQEQFQKZJQMJAAHANZBQIJEQFQKQJZLAIABANJHQAQMZLAKJEAFABZIQKQLQMJAAHAMYNZIQKQLQJJEAFABAKZIANJHQAQMYJALAIAKJBQIZLQJQMJAAHANZKQBJIQEQFQJZLABAKANJHQAQMZLABAKAIJERFQBZ', 'GOEBYCIBJBKBNBZBdCADCDpDrDTEiGEQFAHAJQIJCADALIKIGQEYMYARIIJIDICIBCGYGAKZLZNYARMIDRIYJYFYHBAIAALJKJNIERDYMYFRIIJICIDBEBKZLZAQNYAYHSIIJICIDIEBMYCRJYHBAIFRCIMIERDYIZJYCBFBAYHRCIFBABHALJKJGQBQNIERDRIZJYFYABMIDIEBGIBRJYDBMYARFIDIJIBBGYERMYAYFRDIABMIEBGIBRJYAYDYFBMIARJIBBGYERAY', 'GOoDTGABFBYBKCbCBDDDLDQDcDhDkEAIEQKQCQCIHYFAKIECAYKYMYFSBYDQIIJYJABAFAGAAJMQKQCQEQHQJZIZDALANAAJMJKQCQEQHQJQIZBAJKHACAEAJYKAMZFQGQJQBQIKHAHIEBCYJYLYDQIIHIEICBJYJQLaFAGAMJKQJQLQCQEQHZIZDANAAAMJKJJQLQCQEQHQIZBAFAGAAZMAKJJJLQAZFQGQBQIKHACAEAAALAJZKZMQNQDQIIHJCAEAAALAJAKZFQAI',
  'HPBFpGIBTBeCcDiDzD1DDEFEkEUGYGwGBYGZDRGIMYNICRAYJYKYECLIDIBICQNYFYLAIAHJDQGJOICQNQFaGAGYDBNICAOYHZIQBKNQGQGYDYFILYERKIJIAICDGYNYDQFIGANAOAHaIaBQEQLQFJMIDBGINIOICTAYGYDYDBGJCAGANAOAHAIABbEQLQFQNKOAFaLABKFIHQIZFQOQNaEALAFJIJHABaFQFIBJHQIZBAHKIQIICRBYLQNJOYOABABYIAHZLYLQNQOKAQ', 'GKBEoGABYBRCVCDDSFLGrGHIEIDICSAYAQGaEBIAFAHAJAJYEQFRBJCQDQAQGQIaHAHIEIAIGIIICDDYDBBZJZEREIJIDQCQIYHYFCEIHQIJCADAIYJYHRFYECHIAIDICRGYAAHYESFIAIGICBDYGRAZHBJJDQCQIYHAJYEYFSHIIICADAJYEYEBBJJJDRDICTAYGYEYIYHYHQIKAAEAFBBIGICBDYJIGRCIDBJaBAEQGKJQCQBYDQAQGYFRIaHAHIEIAIEABA', 'GLACVCSBcBLCEDJDMDiEYFBGBQDQHQFQKJGACACYEYFYHYBBDIIIERFYHYBYDCIIEIJIASCYFYHYEBIYDSBIEIFIHICIACJYIYERFIHICICQFZHACIFQHZCACIFIFQCYHQGQKZBABYDDEIBSCIDQKJGAHAFAFYCYCQHJFACYHQFJCACYFYHYBBIIJIASCYFYHYBYDYDQEBIIBRFJGQHIKaFAFIGJCIKIACJYBYIYERGIHADYGQHJDADYGYGQDICIHQFQKJAICABA', 'GLDBIBYBEDJDMEAGjGoGrGRHHZFRDRAJEJGJBABICCEYHYKYDYFYASDIDAAAFAHKKQBQCQGZDADYABFIEQDQGJBACAEZFYARDIGIBIBQGZDAAAFAHAJAIKKQHaAQFQDQDYGJBABYGYABFIEJBQCQGZDAEAFYARDIDQGKBACAGYHAKAIaJQAQFQDQDYACDIEIFIHIKICSBYBQGZEAHAHIBICBDZFAKYJAIKKQDQDZFZARFIHIBIBQHZABFIBIDIDAKAIaJQFQAQAY',
  'GLEBaCDBFBgBjBCCYDIEkETHIAHABYGSHIIIEDBYGYFYHYJYKYDTAIARCJIJEJHBBBGBFZGRJYDYARKIERHIEAEYHYIYCYKYADDIJIKIGIFIBREYFCGYJYDYKYATCIIIHIKIFIEIBCGYESFYKYCRIIHIFAKYDBAYCRDIKIFRHYFAIYDBKIFIECGIBSEYFYHYIYDYKYCDAIJIKIGIFSEIBBFYGYJYAYKYCTDIIIKIEIEAGBJYAYCYKYDTIIEIKIGIBIFCGAJYAYAA', 'GLQBUDDBEBFBcBZCsDaFRGAHARJYBYESBIDICIJIKIADGYIYFYEYHYJYBYDTBICIJIKIAIGCIYFYHYEQBQBYDBEIBQDYEBBIBQDQDYEQEYCSJJKIFCJZCAEABAHJDQIIGSAYFYJYEYKYCBBBHBDJEREIIIGIJIATFYFRKZCZBBHBDBEIIIGIAIFRJIABAYGYIYEYDRJYHRBRCJKJABAIFDGYIYEYJYEBDZHRBRCREIJIKIAIFIGCIYDYBYHYCREIBABYEYEQJJAQ', 'GLUDiGRBhBACYCdCMDqDSEBHHAAAGAIJJICIDBBYBQCQDQJQKQHaAAHIKIEIFCBYFRIYGQKICBDIERHZHQAbKAAIGAJAIABKDQCQEQHIFBEYCYDBBZGQIZJQKQAKHAHICBDYKYGBBJIQDQDICSFIECCYFRHYAYFAGAJIDIIABaDQJQGQAIHIKQHQAaGAHIHAKADAJABKIQDYJYGRHIAIFACIESFYCCDYDAIABZGQKIDICRAYAQHaKAGABJIQCQDQAQAJCBDBJZAR', 'GLUDrDCBdCADIDSDQEhEaGDHIYJQGQGICRAYKYDCGIJICRAYAQKQEKFAHAAZCAGYDQEIFJHAAAIABaCQJQDQGQKQEQFJHJABIBBBCZGZGQKQHQAJIABACAGYJYDQEQFQAJHAEZDAJIGICQBQEZKAGAGJCJBRERIRHZAZFADAKACAGAJABLEQEJIRHRAZAQFbDAKACAGAJABABZEJBQCQJQDQGQKQFLAAAJHBIBBZBAEbCQJQDQGQKQAQAJHJIBBBEBCZGZGQKQBK',
  'GLjBFCaBDDTDYDkEAFKGbGoGFQHQDaIACBEAJYBQIICAJAAAAYGYBRGAJICQKJFQHQDQIaEAJABAKIAQCQJYBBGICICQJQEQIJDAEaJACACYGYBRJICAAAIIKYBQJQIQDLEAEJHBAZCRIYJYBBKIFIAQHQEZDZBAGICIFAKZGQBQDJEJHAAAFAKYCQFJAJHREZEQDbBAIAJAFACAGAKKAQHQEQJZFACACYFQGYBRJKDQIZJABADKCAAAEAHAKaGQGIAICRDYFYBY', 'GMBBdCABjBkBFCYDhECGKGRGaGHYDYEYKIGALZBYFSIIJIKIGILICRAYGBJZKZBBFBEJDJHJCRCIATGYIYJYKYLYBYDCEYFRDIBIKILIABCYHYEYBRDYFCBIEIHICIARKYDYECBYFSEIDIIIJIKIACCYGIHYLYBYDSEYEQJJGQIaJAEAEIDCBIHICILIASKYDYLYDQGJIQJaGADAEYFCLIBIESDIKIABCYHYEYBYFSDIGQJKIAGaKIKALALIAICBHYEYBYFYDSLIAI', 'GKADrGCBiBIDoDYELGQGTIDAHAJABAFLDQGQIQCQEQAQHaJAIKDAGAFbBQIQJQHKAACADAEAGAFABaIQFLDQCQGQEQAQHaJAFAIABKDQGQFbDAJQHKAAEAFAGABaIQJQHQALEAEJFBCZDBGICRDZHZAQEJFJDACAGABAIaJQAQEQFJHAEaFQEIHJDICBGYEQFZAAEJGICRDYFYFAAaEAJAIKBQCQDQGQAQEaJAIABKGQAQEQFQHaJAAKGABaIQAQJQHKFAEAGAAa', 'GLJDgGdCBDbDjDoDREDGqGLHAYDYHYEYIYKYCCFIFABKGAJZBQEQFQKQAKDQIZAADKHADYGAEZFZCRAIAQIKHAGAEAFZKQGKHQGYIaAADJGAKAFKEQHQGZDZCADIFIEJHQGQIQAbDADIAJIJGBHBEZEAFbCQKQIQAQAJDZAACAIAKAFLEQEJHRGRDZDQAbIADKGAHAEZFZCQDIGJAQIZDAGJAJHAEAFZKQAQGZDQIKHAAZKAFKEQAQHQIaDACAFIEJAQHQGZKAEAAJ',
  'GMCBEBNBYBaBDCRCdCoDAEbEqGCAHALIEQARJIDCGYAYEBIIIALaKQBRCYHBKIFSCYBBFAKALKIQIYERAIGIDSJYCYFBKYHRBIFICIJIDCGYAYEBIIIALaKQCRJIABEYCYKALKIQIYCREIASJYFYBYHBKIFRJIACEYCBIIIALaKQBRJIAIEBCYARJYBBKALKIQIYARCIESJYFBKYHRBIFIJIECCYABIIIALaKQAICIERJYABKALKIQIYCREIGIDSJYAYFYBYHBKIFRAI', 'GNICKCEBbBlBFCJCADCDTDcDgEqGBQIQHJAAGALAMZDQEYKYFSCICQHJIAJAJYKADAEAMJLQAQGQIZHZCACYFCEIMIBQKYCSHIJIKIBCDYCYEYMYFSHIJIKIBIDCCYBRDQIJAAGAJYLAMZBQEQKYFBEIBICIDRJYKYBBMJLQAQGQIZHZBACIFAEAMIDQKQJQHQIJAAGAKZDADIKILIASGYHYIYJYBYCCDIBRCQIJHAJAKALAMZEQFQIIBBLIMIAIGSHYJYKYBYCYDBLIBR', 'GNYBEDTBjBACRDUDZDsDBEcELGoGHQFQJQBaLACADAGAKAIAMKAQEQHQFQJQBQLaCADAGAKAIAFKDQCQHALIEAAAMaDQCQFQIQKQBKCADAJAHAMIAQEQLYCADAIaFAMJIQFaDQCQKQBQGQLKEAAAJAHAFAIAMaDQKQFKHQJQLZGABAFAHKCQJQBaCAGQLJBAJAHaDAKAMKAQEQIQHQJQBQLaCADAGAFAKAHKIAMZHQIKDQCQJQBQLIEAAAMYDQCQFaCADAKAIAHAMKJQBQ', 'GKQBDCEBiBRDUEgEZGjGAHCIIQFQBIJIABHYFYCSBIEJHADAGAIaFQEQBYCCEIFIDIGIHIASHYJYDCEYFYCTBICADIHJJIACGYHZEAFAFYCYBSEIHIIJGQARJYDYEBBBCBFIIIGIARHYDQEYBAFIDRHIABGYDYFYIYBSCICAHJDADYHYBAIIGIARDYGAHYIZBQCQCYEIBBIJGQJIDBABGYIYBRCIHIAIDRJYEYCAHIAIAQHZCQCYBCFIAIIIGIDRGAHYCYIZFQBQBY',
  'GLMDYGUBVBjBLChDpDsDDGAICQGYHYEYFRAYDACIFAFIEIEBGJGQBQKQJaAAAIEBFYCYCBIBGJFQEQAYDAIQCQCIEIFBGZIYCRDRAIFAIACYDREIIIFRAYEAIACADAGJFQHIIYIACAFAGYDQERIIFAGAHJBQKQJQAaFAIACAEAGAGIFRIZCAEAGADADYHIFQGYESCIEAGADAFAHABKKQJQAQGYIZGAAKJAKABaFQHQDQAQCYEBAIDIFBHYDQAQCQEQGJFAAYAQDAHIBI', 'GMDBQCMCNCbCADEDZDkDhEIGRGBQIQCQDQGQLYAQFLAAEAKALAHAHYJAIaCQDQEQGQGZFRAJKJLJHBGZFZAQLZAYDCCIASFIAAFAEAGIIJJQGQLQFaKQHKFAHYKZACEIGIKILIBBJYIYEQAQHIFIBAJAIZGRJJBRFYHYAAEAGIIIBQJYKYLYEYASHIHQFKKAHaFQFYACEIJILIBAIYGYEQAQKJHABAFYIAGZJQLQAYEBFQJIGIIIBRFYAYHQKZEAEYDYCCJIGIIILJAQBI', 'GNIBkDJBKBUBVBgBhBiBTCYGrGDHAACADAKAGAHAIALaBQBYFREIJIIIHIGIKIASCYDYMYEBFBBILIAQCRDYMYEYFBJIIIHIGIKICICQDRKYMYEYICHIGICIKIDIDQKZAAHALYGQHYJYFSIIEIHBGBBYFQGQIREIJBGIHSKIMIACDYCYHYGYJREYIBFBBILIDQARMYEYIYFBJIISEIKICAMIABCYHYGYIYKYESKIHAMIAICBHYASKYMYECIIGIAIKIHIHQKZDAGAIALYBYBA', 'GLABiESBkBdCMDbDQFDGJGTGHQAQIaFAJJCACYJYKYEBDIBIFYHIASCYCQJZFQIKJACACIACHYBYDYERKICICQFZKAGAGICIFQKZGACIFIFQKQGaIQJKGAGYIZCACIDCBIFIHIASIYJYKYDYCYECBIFIDSIIKIACHYDYBYFZCQESIJJIGIGQJaIAGKKAFAFYCYGQKJFACYGYGQKQIQJKFACACYDCFYHIASCYDYIYJYKYECBIGIHIAICSDYACHYBYGYESIIKIAIDICCHYAS',
  'GLADjGCBSBDCIDbDrDQEhEEFGIEQJYHYDQCQAJFAIAJAHZBQEQGQKQAJCACIDCEYCSDIDQFJIAJAHABaCQDQFQAZKAGACJBJHQJQIQAZFADAGYGQKQFJEBGYGABAHKJQGZEQAJIAGAJAHaBQDREQAQFZKACABIEQGJIQFZAAGADAEABYCQKQAJFJIAJAHABZCZKRARFJAAGAAZKBCJBJDQHQJQIQGZFZKACABIEQAQFQGJIAAZDAEABYCQKQGJFAEABAHKJQAQIQFZEAAI', 'GLIBDGVBgBYDpDJEAGLGrGaHCQIQBQHKAAGAEADADIEIATEYGYBYHYIYCCIIEIABFYKIDIFAJaKQIQCQEJDADYFIHIIYCQBIGIABDYDQEaIAFAFJDJERARGYBYHYCBFIIYFAKAJKEQAQDYIYFYJYKYCTBIFIHIGIIIACDYAQKYFQIJGQHaBAIAFAFYKIDIARGYIYCCJIEIKIDIDAEAJaKQCQIIDAEAEJAJGRDZFZEAIZCAKAJKGQDQIYEAFJAAAYFYKYCREIEQBQHKIABa', 'GMBCsDdBiBjBACFCUCSDaDYFKGLAIAIIJADAEABZCQGQHQJILIDCJYHABIKIFSAYDYDQIYLZGACAHBCYGSHIIIJIDILIAIFCKYDSIYJYCBDAEIDIKIFSAYIYJYCYLYHYGCEIEQGQHRLJHAIAJAKABZDQDICSHYDCCICABJKQJQIQLZGAEABIHRIIJILIAIFCKYHYBYCYDREQGQIIJILIHCKIFSAYHYIYJYDBCILYGAEABIKIHSAIFCHYKYBYCYDREQGQIIJILIAIFIHCKYAS', 'GMDBACYBcBECTCVCBDJDREhErGCQBQGBDIERAIHYIIIAJAKALZDQEQAQGQIJFBHIBACALYEYDYGRAIDCEIFSDYAYIYGCEIFIKICILIBSHYIYJYDYAYFCKIDRJIBBLICQCYDYKYLYFSAIIIHIBACAJIDBCIBSDYCBDABAKYLYFYEYGSAIIIHIJICIDIBBDQHYIYKYCRJYAYGCEIFICIKILIBSDYHYIYJYAYFCCIARCQFQIIHIJIDIBCKYAYLYCYCAFRJIABKILIBSDYAYDABA',
  'GLADhGVBlBYCcCCDqDEEZGIHFAHIKIEBBYBQEQJQKQAQGZIZCBCYDDFICSIIAICAEAJYHABKJQEQAYHZIYCBFYDSCIDAFBHKFQKQIQGKAAAIEBIYKYFYDYCRDAGIFAHYHABAJKKQHaDQFQGQAKHIIAHAKAJaBQDQFQGYCADIFIKIERIYAZGYFBDYCRFIAIGIHJIIEBIQAZGAHADAKYDYCYCABAJKKQIQAQGZHAAJIAKAJaBQCQDQAQHQGJIAAZCADABAJKKQAQIQGZHADAAI', 'GLEBYCDBSBiBFCRCTDcErGAHGQIYFRAICIKIBCGYDYEYHYIYCSAYFBCIASKIAADBEBJZCQCYFSKIDIEBFAHYIYAYAQHJCAJJIQDREIBIGCIYIAJaAQDQHYCAAIDIIIJIGSBYEYKYFBAIAAJJCQHIIQEREIBIGCIYIAJaAQDQEQHYCADIEIIIJIGSBYKYCBDBAYFSCIFAKIBIGCIYEYJYAYAAJKDQHIEAIQIIGSBYEYHYKYDCFYCSDIKIEBIAJZCQDRFQHIKIEIBIGCIYAYAA', 'GMpDAGgBICJCKDhDjDsDEESEUEBIDACAAYHIGIEQFYGQHZLQJQBJFAKAHAGAIZLQHJKQFQBZJAHALAIJGQKQHZJQBJFAHAHYKAGAIZLQJQBQFKHABZJALAIJAJCQDQHYFZJALAGJAAIaGQLQJQFJHJDACAIYGZLQJQFQHJBAFaJAFILAGJAQKQFQBQHaJAFJKAAAGZLQFQJQHKBAKAFZLAGJAQFQKQBQHaJALAFJAAGZFQLQJQHKBAKAAAGAFZLQAJKQBQHaJAAALAFJGQKQAZ', 'GNADZDdBgBhBICLCCDUDsDEEJEiGJZCQIQKQHJGAAIBIEAFADAJZMQBQBIEIDIIYCAMIJIFSAYLYGYKYCBBIIIEIGRAJGALADAFAJAMaBQEQIQCQKQHQHYCBKIEBJIDQMIFQLQAZGAHAEAJAIZKQCQEIHIGIAILIFCDYDQFQAYJYGQHZCAEAIYKABAMJIQBaKQBICQEQHJGAAIFAJYBAIAIIMZKQBJJJDADIFSAYLYGYEYHYCABAJJEQGQHQAKLAAYDAFAIYMYERBYJYCRHIHABA',
  'GNJGrGABMBgBNCBDbDkDDGQGYGhGBZIQKICQGYJYFAHIHQFQJIGICALJEBBYIYMYHYFRDIAIKIEIEALZCQGYHAIAJYDAFABKMQIaHQLJIAMABaFQDQHQJIGICAMJIQEQAYEYKYDYFBHIBIMIIIERLZCQGYJYFAMAHABJIQHaMQLKEAHAIABaMQLQFQHJIAJIGICAEABAMaLQBKEQCQGYIQHZJYFABAIKHQBZDQIYFRAJJIGIGQJaAAGKKABAHAHIEICRBYIYDQKYGYGQAQJKKAAa', 'GKSDrGIBJBNBdBMCAGDGYIAAGQGYEYERAJAQIQHKCADAHYIYJABaGQAYFCAIEIGIBIJICTDYDRHZIZFZABEBEYGIBIERARFJHJIJDBDICDJYAYEYGABIJQCQDQAYGYFSHZIIIAAAAJEBEYGYAQIQHKCADAEAJABaGQGIBIJICTDYDREZHZIZABFBFYGIBIFRARHJIJEJDBDICDJYAYGABIJQCQDQEQHaIAAAAIEIERAZAQAIIQIYGBHJCADAJABaEQFQAQAIEBFYAREIFBAY', 'GLBBqGaBbBACECCDKDcEYFRGBICQFIHIKIAQGYHAKADADYIYFRHIKIDACABYFQKQHQGKAADADICCKZFABIJIESAYCYKYDQGZHADIGQHZDADIGIHICIAIKJECJYBYFQKICSGYKZDQDYFCBIIICIJIESAYEAGYGAKACAJABaIQDQIYFSKJFAGQHZKACADAIABKEQJQGQHQKZAQDAFBIICRGJHIAIECJYCYIYFRDIHICBJIESAYAACYEAHYKICAJABaFQDQIQGQDYFCGIIIJIEIAS', 'GLQDTGDBSCEDMDsDYEIGpGbHIAAADAHAJYJAGbKQBQCQFQEQIKAADAHABaKAGLJQBQDQHQAQIaCAEAFAKABKJAGbBQKQCQFQEQIKAADAHAJAGABaKQJKDRHQAQIaCAEAFAJAKABKDQGQHQJaCQFQEQIKAAJADAHAGABaKQCQFQEQIQALJAIaCBEAFAKABKDQGQHQFbEQEZARCJIJJJFBEZEAAbCQIQEKFQJZEAIAAKDAFQIZEQJKIAFAHAGABaKQAQCQEQJQIKDBAYFAHAGABA',
  'GLrDCGABBBMBFCQCKDREoGbHAIIQDQBYEAHQHIDIJIGQCQCIGCIYJYAYKYFSEIEQBJDAHAKAAAJJIQCQDYBYEAFAJIIIGSDYDQBZCAHAKAIAJZFQEQHIBIDAGAJYAQIJCRIYKYEYERFBAIJIGQDQKIDIGCJYAYFRKIDICBIZDRCIDICRKZEBDICIFBAIIIJIGSBYKYCCDYAADAAYFREIDIDAAACQHYEAFAJJIQAZCRDYFYESHIHQBKKAAAGAIAJaCQDQFQHYEBFICIDRHRAJAA', 'GNEDjDDBQBVBgBlBMDrDRETEhEIGMADAFAJALAIaBQBYGYERKILICQMIDAFAIABZLQCQJQHaAQHIMJDIFBJYCYKYEBGILICRJIFRDYHYAYMZEBGBLICIBIIIFRDRHYAYEYGBKICBBIIIFIDRJYCYKYGREIAIMIHAJADAFABZIQCQJIDBFYCYIABJCQFQDQJQHQHIDBJYKYGYERMIEAHAAZGAAILABJIQKQAQHQMZEAGAAJKAIABZLQAQEQGQMJHAKAAZLABJIQAQKQHQMZEAGALAAJ', 'GKACVCFBjBsDJELFCGYGgGJQIQAQHZGADADIIIIAJAEbBQDQDYBYCTEIGIHIAAIYDCIIJIASFYDYHYGYCDBIBAEKJQIQDQGQHJFADYGYBYBACSIIDQFQHZBABIGIFIABGAIAJYEYEAJKDQIYJYDYEZCYBSGIHIAAIYCYCBEJDIIJASFYCYHYGYBCIICRFIABDYCYIYBSCQGIFIAIDCCYARCAFYGYBCIIJIAICIDSFYABDAJaEQIQIYBSGIAIAAFIDBCYIAEAEZIYBYJICQIYAR', 'GLCCcCgBjBLCZCaCADIEMEDGBIDIERJYBBDIEIGIASIICCFYAYGYEYDYBRHIJIIICIFCAYCSIYJYBBDIEIGICIAIFSIYCCGYEYDYBRHYJICIGCEYCSJYBBDICIEIGSJYCCDYBRCIJIGCEYDYBYCSJIDCEIGSDYJYCCBIEIGIDSJYCYKYBCEICSJIDCGYCYEYBSJIDIIIKIHIFCAYGYCYDSIIIQHQHIGCAIFSGYHYHAIAIYDCCIAIFIGSHYIYDYCCAIDSCYJYKYBCEIAIDICSJYAB',
  'GLUDAGjBkBdCSDhDDEIFaGoGGYHIFAAZHQBKIAJZCADAKJGQJQIQBaHAAJCACYDYDAJJIQFZDBAYAQDQHQBKCBFAIAJZAQDQDYAAHYEBJKGAKZJQGLDQCQIQFQBaEAAIDIHADAGZAQDIGAAZDQDIAIGIHQBJFAIAKAJaAQDQKJIQFQBZHAGAKAAAJJIQKICRGaCBHQBJFAGAIAJZAQKYDAKQCQHQGKFQBZGAFKCAIAKZAAJKKQAaHQFQGQBJIAAAKAJaDQHQFQFIAJIQBZGACJAB', 'GMDCVCABFBQBJCMCBDaDgEiGrGGAIIFIEICREAHYCAFAIaAQFQGQLYBQDQHLEAFAIIAACQEYFYAYGYDYBBGAIJKILIJIJALaKQIQIIJIFREICBFYJYIYIAKALKJQERCIFBJYASCIAAEBJALaKQIQIIGRCIABJIFREYAYCYCQHZDAGAIYBQDIGICICQHIAIEIEQFBJYIYAQGQHZDZBBGBIJAQBQCQDQGQHKDADYCCAIDSCYCQHaABGAIYIAKALKJQFQHYCADAKYLYBRGIAICIDBIZAQ', 'GKDDIDFBVCADpDTEKGrGQIFYGQIYDQCQAIEJBAHZCZAREJEQBLCAAYHAJAFAIZGQAQCQEQBQHKJAAaGAIJFQAQJQHaBACAEAGAAKFAIZAQGQCQEQBQHKJAFAIAAaGQFKJQHaBACAEAFAFIGAAKCQIQJQHQBbEAEZFBCJHJBQEZFZCADAFIGAAAIKJQBQHZFQEKHABAJAIaAQDQCQGQFQBKJAIAAaGQFQBQEQHKJAFaGAAKIQFQJQHaEABAGAAAIJFQAaGQBQEQHKJAAAFAIZGQAK', 'GNgBdCEBSBZBcBFCICTDiDpDrDBHEAHAAAJYFYKYLYBYGSCIIIFAJIMIEBAIAAJZDQFQIZBAGALJKJJQAQAYESIYMYBBFIDIEIAIHRMYBYCYGBFIDIBRCYDCBIEIEAKAJJHQIYEYCRDYBBFYJYLYGSBIDIFAKIEQIIMIHCAYEYJYKYLYFRCIKALAJJEQKYAQCYFBJILIEIAIHSMYCBIIKIABEYJYLYFRDRCIMIHCEYEAJZAQIYLQKQDYFBKIAIEILIJIHSIYAAKYMYDBAIIIHAJYLYFRAI',
  'GNrDDGCBLBiBlBADMDUDoDIEYEbEEBFAAIJJEQCQLQKQGQBaDAHAIAFAMAAAAYFRJIEQCQMIDRIZHQBKGAIZCBDYHYMYFCAIJIEIDRCRBYCADAFAMIEBJZAQMQFQBICADAJAAZMQEIDICRHYEAMAAJJQCQDQHQIJGQBaEAFAHJCADAJAAZMQHQEQBJGAIZCADAHZMAAJJQHQCQDQIJGQBZEAMAAAJJHQAZMQEQBJGAIZCADAAAHAJZMQAJCQDQIJGQBZEAAAMAJJHQCQDQAZEQBJGAIZAA', 'GOZBMCFBVBgBjBkBlBDDKDQDpDAESEEAIYLYFYGYBRCYCQIJJANAFAGALJAQEQKQMQJZIZCACIBCGILIFQKJMQJQIZNAKAFAGYLYBSKINIFCMIEBAYMQKZBAKILIMQEIABMYLYBQKIFSKYNYBCGIFILIMIAREYKYKQNQIJJANYFBGYBRIIJIEBABMYLYBQFIGBKIKQNQJQIZFAGANIAIERIYJYGYFYBCHYHALJKQNQFQGQIJJAAAEAMAKZLZHQHIBSFIGIAIIIJIEAMAKALZNQAQJQIZGAAI', 'HQyDCHtBuBICJCUCSDVDdDgDlDFEaEoEqGEAFAKAOAAZPQGQNQHQIaJALACADAPJAJOQKQHZNAAAPZCQDQLQJQIKGAAINAKJOAPZAQGQKQNQIaGAJAKILACADAAJKQGQNQIQJaGALACADAAAKJPJOQHQIZNAAaCQDQGQLQJKGAAINAHJOAPZAQGQHQNQJaGALACADAHKAAAYKZGQHQCQDQLQJKGANAAAKAKYPJGQOQAZNQJaGALACADAKKGQNQJQLaCADAKAHAPJNQAJIQJZAANAPZHQKQCQLJAA', 'GKFCJCIBECYCADCDKEcFhGHQGQFJBACAEAJQHQHYJYIYASDIFIGIBICICQEBHYBRFZGYDYACIIBIBQHIERFYGACJFQFIEBGYCABAHYBYIYASDICIFIIAJJHQEQGYFABABYFQGJBAEAHAIYJZCTDYDQGJFAIACYDRGRFJGAIACAHIJIESBYIYFYGYACDICIHIJIEIBSIYFYGYAYDCCIARFIGIIIBCEYHYAYCYDSFIGIABHIEIBSIYAYFYGYDCCIHIJIASIIBCEYAYHYCYDRFIGIIIAC',
  'GLcDpGABBBFCLDQDkECGSGZHBYKYAYHYESFIIIDIJIDQIZFAJAAAEAHABKKQGQCQDYIYFYJYEBHIGJCQDQJZAAGAHYERAIFIIIJICBDYGYGQJQAaFQIJAAJAGAGJDJCRAYDYGYIYJYFYEBHIGQFQJJDAGYHYERJIDIAQIZJAFAFIDIAIAQIQJaFADIAIIIJICBGYGAKABaEQDIAIGICQJYFYDAEABKKQCQGQAZIYFRDZEBDIHIGIIIJICBAYAQFaGAGIFIHYAICRERDIIYJYGBHBAJAQ', 'GMqDBGKBNBEDLDTDsDQEaEcEgEBYEYDAGIIALAAZHZKQGQDQFQEQBKCAIAFaCQBYDAGAGYKADQBICAHJAJLQFQGaJAAAHZKQJICRBYCADAJIFJLAHZAQFQJYDRBICADAJYKAAJFQJQGKCQBYDAGILAHAFZAZKQGQDQBICAJAHJFAAZHQJQCQBYDAGAGYKADQBICAHJAJFQLQGaJAAAHZKQJICRBYCADAJIAAHAFJLQAZJYDRBICADAJYKAFJHQJQGKAAGYLAHZJQGQAKCQIQBaEAAAEIBI', 'GNJDiGFBIBVCADRDTDYDsDDEgEaGFIDAJZEQHIGIIALAJZBQMQGQGIIJLAMZGQIQIILIDRAYFYHYKYCYECBIGIIIJIMIDRLYHYCQHQKQFKAALADAHYIYEQFIAJJYBYLADAMYGYERCIKIHAIZGAMJDQHYKYCYEBBIEQJIDQIYGYMYCRFQAJKAGAIJDAJYBYEQGJKQAZFAGAEABIJIDQIZKQAQFZGAAJKAIJDAJYBYEQAQGQFJKAAZEABIJIDQHQAZIAHJAQIZKQFZGACBEAHIAIDAJYBYMJAQ', 'GNYBLCABBBCBUBVBZBaBMDDGQGjHAQHQIQLQCQDQEQKaJAJYGBFIBIEIDICILIACHYIYMYFRGRJIKIAAHBIYMYFYGRBIEIDICILIHIHAIBLYMYFYESBYGCEIFIMIIRARKYAAJYGAEBFIBRDICIHIAIICLYMYCSDYBBFYERGRJIDACBFYEYGRBICICALJAQDQKIIAAYHYDYCYLYECFILIHQMIARHYDYCYEYLYBYGCFIMIAIHRIRKYJYGAFBMIAIHIIRDYCYEYLYBYFYGRJIJQKKCADAEALAAA',
  'GLNBREbBQCLEcEADrDCGIGoGAABQHIKIDQJQGQGIIZEAJKBADBKYKAHbCQFQJQAQEQIKDAGABAJaCAFAHLKQJQBQDQGQIaAAEACAFAHAKKJQHbCQFQAQEQHIIKGABAHAJAKaCQFQHKBQCAGQIaAAEAHAFAKKJQBQHaEQIJDABYCYFYASEIIYEAAAFAKAJKBQCQHQHYCBJYKYARFICIHIDQHAIYCBFYABJIKIBIBAJaKQAQFQCQEQIKGAHABAJAKaAQFQCQEQIQGKHAHYGZIZEBABFICRAZ', 'GLQDrGSBcBiBTCYCZCKDAEEFDIIACAEABYDQKQIJCACIECFYCSEIEQIZKACIDABIERFQAJAAFAGAHABaCQDQKQIJAAEBCYCABJGQHQJQAZEAEYCCFIESCYCQAJFAJAGAHABZDZKRIRAJFADAIAKABKEQCQHQJIGBHYCYEYDYDAEIFRJICBHIGSCYGAHCEYEABaDQFQJQAZIAKQJJDBDIEIHRAYDAFABIGQCQAYECFYDSEIAIAQEQIbEAIIJAKABJFQHQAQAICIGCHYFYDYDQAQCIFBDYAQ', 'GLVBYFDBiBjBUCaDsDBEEERGIYCYJYABFIGIDAKYGAEAEIHZEQFQGQKKBAHZDQDICTJYAYKYCAFCEIDIEAHJBQKZGADADYHJCQDQGQGYEYFRAIECGICAGADADIHZDQGQKJBAFQHZCQDYGYFYATEIERJJIJBBGZCADAHJGRBRIZJZEBEYADFIFAHJGJBQKZFYASEIAAFBDICICAGAHZDQDIFSEYABDBFAHJGQCQCYFYDYASEIDBFICICAGAHZAQERDIFBAYAAHJGQCQCYAYAAHAGJCQCIBI', 'GMFBJCVBgBICDDLDkEAGSGaGhGLQBQGZFQIJEADALYHYCRARIIGAFZIQGKFAFIBBIYAAKIDJBRERFZFQGbAAIAJAKAHAKYARJILJBQEQFQGQIZJAAAGKAQFAFIKZGQJQIKFAJaGAGIJIKJECBYDYHYKYAYLYARGRJJKJDBHYGYJYKYCCAIAAGQLJHQDQKQJQFQIZCACYACFIDAGIJIKIHALZGQKQJQFQFJDJHBJZKZFRARCIDIDAAYCRDIIIAAAYCYIYCBFBJJKJHRAZFZFAJAKAGALJHQAQ',
  'GMRBVBQBcBiBlBaDrDDEgESGAHBBFBHIEIJICRAYGYEAHYFRBRIIKYLIABCBJYHYDQBYFBDIHIBQJICRARKILYIYFBDBHIEQGIAICBJYEYHYDRFRIILICBAYGYBYKYFYDBFQHIBQGIKIAICRLYIYDBFIGIKIEBJICRAYEYGYFYKYDSIILIABEYGYBAHYDQKYFAFIBIGIKIEIARLYIYFBDBHIJIERAICBEYJYHYDRFRIILICBAYGYBYKYFYDBFQHIBQGIKIAICRLYIYDBFIGIKIAICIEBJYAR', 'GMEBIBDBTBUBgBFChDpDJEYGjHBAJAKAFAHAIYLYGSAICIDBHIFIKIBSJYDYCYEBHIKJDRFAJIBCFYDYDQHYKZERAYGCLIIIFRBRJYCYAYEBHJDIKIBIBQFBIYDQHZKYERAICIJIFBBYHYKYCRAYEBCIHIBIKIFSJYAYEYCBHJDAIIFQKIBABYDYHZKYCREIAIJIBBFBIYFQLYGSEICBHIKJDADIFIBSJYBADBHYKZCRAIDIJIBBFYHYKYDRAYCBDIHIFIKIBSJYAYCYDBHIKJARJIBCFYAYBQ', 'GNCDoDIBLBbCADUDcDgDkDsDEEJFBIIICSMYDYDQAQEAFJMACABYKZJQHQGQLQFJAADAEAIAKABJCQIYDQKYEQAQFZLAGAHAJABJEQKQDQGZLQFJAAGADAEAKABaJQHQLQFQAJGADAEAIICABYKIKQEQIQDQFZLAHAJAKJBJCQMQGZAZLAHAJAKABJEQIQDQHZLQAJFAHADAEAIABaKQJQLQAQFJHAAZLAJAKABKEQIQDQAQHQFZLAAJDAEAIABaKQJQAQLQFJGJMACABYKZJQAQLQHJDAEAIAAa', 'GNsDSGFBVBgBICDDJDZDbDkDAGhHBYGQLJFAIYJYDYCRGILYGAHKLQGaHACADAJJIJFQGYHZCADAJAIJMAAaKQIQJQCQDQHJGJFAEAAYKZIQJQCQDQHQGJLABAMAKAAJEQEIFSBYFAHYLYGYCBDIMIEBAZIZKYJYDRCRGIHIBILIFBKYJYDYCRMIEIKAAAIZJQAJKQEYMYCBDIAIKIFRBYHYLYGYCBDBAIJJIJKIERMYDYCRGIHIBILIFBEYEAIZKQMQBQLQGaHACADAAAJAKJIJEQFQGYHZDABI',
  'GOEDhGCBMBNBACDCYCRDZDbDkDpDrGCYKIGQAZDAEAKALABJJQIQCQCIFIHCIYJYMYCSGYKYLYERDIAIGAKALAIKCAJAMANaBQIQIICIGRAYKYDYEBLILQDQEQAJKACBIYLYERDICIKQAZCADAEALAIABANKMQJQFQHQAZKAGABYNYERDRCIKIKQAKFAGAHAJABZIQJKFQGQAZKALAJAIABJFQHRAYAQKaLALYCYDBEBBIGQAJKQLZAAGABYERDRCIAIAQLKKAFAHABZIQJQAQLQKKFAGAHAJaAQAY', 'GLACdCBBNBbBMCYCrDKEZFCGCQDABAHIKYFAEIJIGIASCYIYKYFYDYBBEIDSFIIICIKIACGYJYDYEYHYBSFIIICIKIAIGCJYCSIYCAEBDICIJIGSAYIYEYKYFYBCDIDQBQFRKJFAIAJAHZCQCIESFYCCEIEAHJJQIQKZBADAHIFRIIKIAIGCJYFYEYCRHYDQBQIIKIFCJIGSAYFYIYCBEIKYBADAHIJIFSAIGCFYJYEYDYHYBSCIIIKIAIGIFCJYASIYDBEIKYCABAHIAIJIFSGYIYDYKYECBY', 'GLADrGUBdBLCYCMDjDhECGIHDAHIEQIABZHQCQDQGQJIJQALKAFABYEQGaCADAEAHABKFQIQGQKQAbJAAICAEAHYDQCIEIGIKIFCIYHYIABaERBICYDBEIGIHIIIFSKYCYDYEBBJEQIQGZCQDQJQAKKAFAGAIABaHQCQDQGJHIBIFQKQAbJAAIGADAGIKIFCBYHYIYCYHABKCQIQKQAQJZGAAKKACAIABaHQCIDQHIBIIIFSKYAYAQGQGYJJEAKAAaCAAIDAHABJIQAQKQJaEAGACAAIDAHABA', 'GLCDoGjBkBKCLCUDcDEEAFgGDICIJQAZEAFAHZCADABKKQHQEQFQAJHZJAHAKABaCQDQGQIQAJEAFAGZCADABKKQGQEQFQAZGZIACADABAKKERGQHQJQAZFAFYCYCBDZIRCJDBDIFIFQAJEBJAHAGAKaBQIQCQDQAJEAFAGJGAKABaIQGJEQFSAZCADAGAGYCRDIGACYDRFAGIGACADAIABKKQEQAQHQJQGbAAAJGJEAJAHAKABaFQIQCQDQAQAYDBCIAQDYCBAIAQCQDQGJEAFCAZIABKKQAQ',
  'GNBDhDABMBVBLCQCJDoDREDGjGqGDQMIIIGQCQAYKYEBDIFIHIJICIGBBYIYLYMYDRERKIAIGABALZFQHJJABJCQLIGRAYAQKaHAFAHYEBDBLJMIIIIAMaLQIKBQBYIYDQEQHIJQAJCAKIGBBYBAMALaIQIILIMJBQGQKYHYEADAMIBIGRCYAYJYFYDYDAERHIEAFAMAIALJBQIaMQDQEQFQHQKKAACAGAJAIABALaMQBKFQIQJQHaDAEABAFAMALKGQCQIQJQHQAQKaDAFABYEQDIFIAIKICAHYAQ', 'GNFBqDDBKBVBYBlBECTCZCcCIEAGDRLIFBJYBYDYIQCQMIFAJABYIYKYHSCILIMIFIJBDYFSLYCYMYHCKIIIBIFIDIJSLYCYMYICFICRFQIQLIMIJCBYDYCYFYFAIRLICBFYIYKYHSLIIBBIDQJQMYLAHAKABJFQFICSIYFCCICABZHQKQLQMJIAJADADIJSIYFYLYMYHCKICIDIFRBILYCBDIFIJIISLYCYMYHYKCDIDQHRKQMJHALAIAJABZDYGYERARMIAACAFADYGYKRAYECKIASHIGCDIDABJ', 'GLCDoGABBBEBQBbCKEUEZEkEDQEIFQCQAZHAGAHIDICIDAFBJYGYIYKYETHIDIIIDRHZIBEBKIDREZIRHJEBEYDDBIGIJIEQFSCYCQEYDYDQAJEAEYAYDYGBJIDRAREJCBCIFDDYJYGRBYEICIFIDCAYJYGYETCICRHZIBKBEJCRCIBIGIAIJIDTFYFRHZIZKBCBBICIGIAIJIDIFRHRIZKZCBCYEDBIGIAIJIDIDBFJHRDZFBBYFYAYGQJYCSAJJAKIIIDBFYJYAYGABIHIFRDRIYKYEYGBCIAR', 'GNABMBQBcBVCBDRDgDaEDGJGoGrGGICIARFYJYEBDIBRGIKYGABAIAHKLAMaHQHILJMIARCYIYBYLYDYERGIJIKICAAAFIMYHYEQGQKJFQJaKAGADAGYEBHILJIQFQMIAQCQJQKaEAGABADALAHAHYMJIQLZDQERGIGQKKJACALYBQGaKQJKCAGAFALAAAIAMaEQHQBQDQLKCQFQGQJaKALABADAEAHAMKAQCQIQFQGQLaBADAEAFJHIIAMZHQEQFQBQDQLKGAGYIALYEAFIMAHaFQHIMJAICRIYBYBQ',
  'GNADbGMBNBQBgBIDZDqDCEkERGhGCADALJHABZKAIJMQBQHQLZKABJHQLQJQAJGAEAJYLYKYDRCIAIGIEAKALJFBHYBYMYIYDRLICQAIGIJQEIFBJYKYLYCQAQGJKALABAIAMJHQIaBQLQKQGZAACAKILIJIFREYGYAYCAJALZDBBIIIMIHIFRLYKQAQGJJALAFAIAHAMaBQDQKQLKFAIAHAMABaDQKQLQIKJQGZAAIYIALAHKJQIZAQGJIAJAHaLQAQGQIJJAAZLADAKABKMQFQHQAQLaDAKAHKAQAI', 'GNDBACYBcBECTCVCBDJDRDZDhErGCQBQGBDIERAIHYIIIAJAKALAMZDQEQAQGQIJFBHIBACAMYEYDYGRAIDCEIFSDYAYIYGCEIFILICIMIBSHYIYJYKYDYAYFCLIDRJIKIBBMICQCYDYLYMYFSAIIIHIBACAJIKIDBCIBSDYCBDABALYMYFYEYGSAIIIHIJIKICIDIBBDQHYIYLYCRJYKYAYGCEIFICILIMIBSDYHYIYJYKYAYFCCIARCQFQIIHIJIKIDIBCLYAYMYCYCAFRJIKIABLIMIBSDYAYDABA', 'GNDDqGIBJBhBFCYCdCZDbDiDKEAGLIDICIGBEYKYJQLQAQMJGAEABZJQKJIQCQDQAZLAKAJABJEQBYGQMZLAKAJAIJCQDQKZLQMJGAEABYIQJQLQAJKACADAJZIABJEQGQMZAAKJCADAJAIZLQKQAQMJGAEABZLQJJCQDQAZKAJALABJEQBYGQMZKAJALAIJCQDQAQJZKQMJGAEABYIQLQKQJJAAKZLAIABJEQGQMZJAAJKACADAIZLQAQJQMJGAEABZLQAQJQKJCBDAAZCQLABJEQGQMZKAJALAIJAQ', 'GNgBrDCBVBlBADDDSDYDpDIELGaHGIHICQFJKAIAAAJYBYMYEYDRHIHQLQGQFJCACIIIKIACIYLYMYHYDBEIBIBAJKMQIQIIARKYCYFYGYDBEBBIJIMIARLZHAIJLQCQKQFaGAGYDYEBHICIIIKILIACLYMYCSKILIAQFQGZKALAIaHQHYERDIKIFIAAIYHYEYDRKIFIFALAHAHYCBIIMIASHYLYCAIIHQLQGQFZCACYKYDBEIIIHILJABMYBYEQLIHAIZBAMIARHYIYBYEYLYDSKILICQFJGAHAIABZ',
  'GOYCUDBBCBjBACDCcCdCMDRDaDhDpDJABAHAIALYEANKEQGQMQLQKQCQDQJaBAGAEAHAIANAMKEQGQLQKQCQDQJQBaGAEAHAIANAMALKKQKICRDYEYEAMZGQNQHQIQBKJAEAJIDBCBKYMYGREICICAMADQJYEAGAKALaGQEQNQHQIQBQJKCADAEAGAMAKALANaGQHQIQMKCQDQEQJaBAEAGAMAHAIANKGQEQJIDALQKQCQCYEYEQMZBQGAJJMABZHAIANALKGQKQCQEQBQBYMQGAJZHAIANALAKKCQEQBQ', 'GMsDDGVBiBACKCYCZCBDLDTEjGAYHBDYJILYCRKIFIHIDCGIESDYDAEAGBAaGQLQFQHQIQBZJAIKFAHALAAKEQDQGQAYDIECGYDSHYFYKYCBLIFQIZJQBJHADAAYLQCQKQJQJYCBIIFBKIDJFRHRIZIAJAJZDBKYCRDJJJFAHAAAKAAJLZFQHQIQBZDACAAIAQCQDQBJKQJQIJFBHBKZCZABLJAQDQIIKQFQHQBZIAJAJICBAYAADQJQIQBJFAHAKALZDQAIKILIHSFYCYCAJZAADAKILIHIFSCYIZAA', 'GOQBdCABBBCBLBUBiBMDRDjDgEDGZGBAKQGQKIHILIARJYEQMYNYFQIYBBGIFIFQHBKYGQBQHQMIEAJKEQMYBAGAKIHQNICRDYEYIYJYMYFCGYBRFIIIJIEIMIDICBNYHAKYBQFQMIEANALAKZGQHQJQNJCRDYEYEQIYMZFAFYBCGIHIJIKILIAICREQEYACKYLYHYGYJYBSFIFQIIMJAAAIDIEBNZJAGAHAKJLQNQAQMYFABAKIHQNIERDYAYIYJYMYGCBYFSGIGQIIMJAAAIDIEBNYHAJZAQKYFQGQIIAI', 'GOcBJDABQBRBaBECVCbCSDgDsDBGoGHBAIGRBJMIEBJYIALYAQHQMIEICIDBJYEQJQCQDQMaBABIGAMIDAIALANJKQJQCQCYEYFBJICQDQJALZGQIQMYBYBQMKDACAEAFAJALAKAKINZCQDQGQIQJJEQFQMaBAHAAAJAGAIANKKQKYLQEQFQJZBQNYAQHQMKDACAJABZGAIALYNAKKLQLICREYFYFQBQJQMZHAAAKILIFQBQJQMIDIEBCBFYLYKYAQHQMIDIEICBFBNZKALJNQBQFQCQJQDQEQMaGAIAKABJ',
  'HTBBZGABCBQBcBdBeBgBhBqBGCMDUDwDrEtEDGRGKAMYOIIQEQSYNYGBFIBIJAPAOJKQKYOYPYQYHRFIBIQAOJPQJIKBPYOYQYHYHAOJFQBIQQJIKIEIIBPYKRJYBYFAQAOZHQHIOIQIKIKAOZJQBYQQFYHBQIKIJIOIPIIREYBYKAPAOZJQJIOIPIIIIAOZEQBYPQKYJBQYHRFIGRMINIKBBIEAPAOJIQIYOYPYQYGRJIBIQAOJPQEIIBPYOYQYGYGAHYFRLRRIKALAFANYJAHAOKGQQQBQNQNYSJEABYGBQIPIIREYAR', 'GKLGQGCBdCTFYHADIDoDqGAADBEAJIJAILFQBQCQHQGQAaDAEABKFAIbJQBQDQEQAKCAGAHAFAIAJaBQILFQCQHQGQAaEAIYIABAJKFQIaEQAKGAHAIAFAJaBQDQEQAQGLHAHJIBCZAZGQHJIJCAFAIYJABaDQEQGQAJGYIQHaAADBGAEABKJQFQCQIQGZEABAJKFQIQGQHQAaEAIJFAJaBQIQEQAKCAHAGAFAIaBAJKIQFQCQGQHQAaDAEABAJAILFQBaDQEQAKCAHAGABAFAIbJQDQEQAQHKGAAZ', 'HOpDCGVCWCADJDLDwDyDFETFsG0GQIAIFYHAIZAQLZCQDQJQBJEJFANAHAIAAZMZCQDQJQGJKAHKNQFQEZBZGAJACADAMJAJIQLZHQKQFKEQBZFAEKNALAHaKQEQFQGZJAEJKAHKLQNQFaKAHALJIAAZMZCQDQEQJQGJKAEZCADAMJAJIQLZHQEQKQBJFANAEaHALJEQHaLAAAAIIJEQHQLZAAHKLQNQFQBZKAAAHALJEAIZMZCQDQAJKQGZJAAACADAMJIJEQLZHQKQFKNALAHaKQAZJQGJFAAAKAHKLQNQAa', 'ITeDwEdBICkCADVDgDiDmDoD7DRETEqECGJGFHtIGICALYEQIJHJKABALZOQHQKJDQKYIYQYNAIAJaAQCQGQRQPKNAIAJAKJMQIZNQFKQAIAIYMAKZJQNQFQQJIAFaQQPaRACAGAAAJKCQNQGaRQPKQAGAFINAKJMQFQGaQQPaRAAACAJAKKCQNQAaRQPKQAGKFAAZFYGQQQPaRAGKCANAKaCQJQGQRQPKQAFKAAAYMAKZNQFQQQPaRAFKCANAJaCQGQFQRQPKQANAAIJAKJMQAQIQQZNAAJMAKZJQAQNQQJIAMAAZJAKJAQ',
  'IVYB-DABZBkClCoCEDGDNDQDVDaDcDiD8DeEuEBGKHpIJILITIKIAAKADAOZMQDIAICRKYDANZEAFAPABZRQQQLQJQIQHJSYTAJaLAJIQARABJPQEQFQJQLaQALIRABAPJEQFQJQLQTQHaIAQALJJAEAFAPZBQRQLQQQIQHKTAJAEAFAPABZRQLQQQJJEAFALZRABJPQLQEQFQJaQARABAPJLQBZRQQQJKEAFABALAPZRQBJEQFQJaQABAJIRAPJLQEQFQJQTQHaIAQABARAPALJEQFQJQBZQQIQHKSKKAAACANZBZJAMJOJNQAQ', 'GLABbBQBRBMDcESGgGoGrGBHEAGIDICIARKYGABAFAHKAQCQDQKQEbGABAFAHAJAIKAQCQDQHaBQFQGQELKAHAAACADAIaJQBQFQHKKQEbGAHABAFAJAIKAQCQDQKQEQGaHAELKAAACADAIaJQBQFQEQHQGKKAEbBAEIFAJAIKCQDQEQKQGaHABAFAEKBQCADAIaJQEQFQHQGKKACADAEaJAIKAQEQCQDQKQGaHABAFAJAIAEKCQDQJaBQFQHQGKKAJACADAEaIQBQFQJKCACYDADYBYBAEAEIAICRDYAB', 'GNLBrGFBJBKBcBgBICDDUDpDAGZHFIMIDREYAYJYCQIIJALIHAGAKYBYFQCQJIAIEIDBMYCYCQJQFABIKIGQHQLYAAJYFBCIMIDREYJYFYCBMIDIERJYAQJADAEAKALIHAGABaMQAQCQFQIQLJJAIaAACAFAMABKGQHQKQDQEQIQJQLaAACAFAIKAQDAEAKALIHAGABaMQIQCQFQLJJADAEAIaMABKGQHQKQIQDQEQJQLaAACAFAMABAKKIQIIERBYDYMYCSFIAIJIDAEAIYKYCQFRAIJIJAMABAKAKYCYFRAR', 'GNRBUBEBFBVBACYCJDkDpDrDSFBGHIAAKIJIGIFSAYAAFAHYGAJZKZIQBQCQEQDQMJHALAKAJJFQAQGQAIFCGYASLYCYDYEBBIKIKAJAIZBQBYESDICIKILIACGIFSAYAAFAGBIZGQJQLQHQMZCADAKABAEAJJLQKZCQDQMJHAKALAJZBQCQEQKIHQMZDACIBBEYCRDRKIHIKABADACAEAJJLQHQMQKaBADAHJLAJZCQEQHQBQDQKKMALAJAIJFQAQGQAIFCGYASLYBYHYDQKQMJLAAAHYEBIYJIJQHQBQHIAI',
  'IXjCLDCBFBkBoB1BQCDDGDODRDZDdDmD4DAETE2EhFVGtG6GEQNIOZNQUQDQKQJQIKBARAUZKQJQIQBKDARALKMAUZLQDQRQBaIAJAKALJUJMQCQBYIZJAKALAUJMJCQCYMYRYDYDQKZLAUANAOJDQDIECAITIFIHRCYFCTYAYESDYDAOZNQUQLQKJDADIMIRIFIFAMZUZLQKQJQIJBJFAMAUZLZKQJQIQBJDARALAUJMQLaDQRQBaIABIJAKAUJRQFIQICBLYMYRYDYDQBQIZJABJDADIRILIMICRQYFYRAUZKQBQJQIJDARABaKAUJAA', 'GNYBTCIBJBcCdCADEDZDoDqDCEMEIQDQDICIABIYIAJAKZBQDRIIAQLQGJCACYGYHYLYMYFCEIBIDIDAKJJQIQLQGQHZMABAKIJIARCRGYHYMYBBDILICIABIYJYLQMQHJGAAACAIAJAKaLQIJAQCQGQHZMAIALAKKJQJIARCYLYDYBRMIGIHICBABJYKYBQIILAJAKZDQDYBYEYFSIIBAMIGIHICIABLYDBKJJQLQAQCQHZGADALIARCYDYGQHJCAAADALAJAJIARCRDYGYBAJIAICRDRGYGADACALAAAKZJQAI', 'GOsDDGCBJBdBADMDSDUDoDqDbEYGgGDYGYHYIYEBLIMINIDRFQHYCQBaEAGAIICIFIHIDBMYNYCRIYIACALANKMQHQFQHYIZGQBJDAFYCYLYERBIEAIAGZLANAMKCQHQFQGQGYCBMYNYERLICIGIDQIQBaCALAGKCQBIDAFAFINZDQBYCAGYGQFKCQBIDANAHAJAKZAZEQAIGIHJJAMZAAKKMQJQAYHZAAJKMAKaJQMJHQAZGZEAGIJIKJHQMZGQAKNQDQBYCAFaAAAINJCQBIDAFYFQDQBYCAAaCQLQBKIAAAIYBY', 'HQtDAIGBNBaBeBpBgCLDTDYDyD1DDGqGbHGALYMZAQFQOIEQKIHALYMYAYFQCSDIIIJINIBIHCGYEYKYOYPYCYFBAIAAMKOQPQKKEAGALAOZMZAQCQFQKJPALKOAMaLQMIOJGREYOYPYCYFYKYDSIIJIKICCPIEIGBOYLAMJOQLaPQKaDAFAAAMJOJLQEQGQKZPAOAMaAQAYDRFIOIPIEIGIKIHSBYCYIYJYFBPICRBIHCGYEYKYCYPYDBOIMAAZOQMKAAAILJCQEQKIGAEYCYAYLYMYOYDRPIKIKQBQNaFAIAJAPAKKAA',
  'HQwDNFUBYBbBhBkBACFDZD0DBEDElEqERGDQJYEYKIGQCQCYGCOIAIDQEQJIHRLYMYGBCICAJIFAOAAJEQEYAYOYCSGSMILIHBFYPIECAYOYCYCAAJGQJIOQEQEIFIDBOYERJYEAPYGBCIEIOIDRHRLYMYGBPICAFAOAAZEQEIAIOIDIHRFYDCAYOYEYEAAJCQOQDQPYGRMILIFBHBOYEYCYGRJIEAOIHRPYMQIZBAJJCAGAAAKZNQJQBQIJMACAGAJZNAKJAQJQCQGQMQIZBANAJJAAKZJQNQBQIJMACAGAAAKAJZNQAJ', 'HSVBQCMBhBiBoBtBuBADIDKDlDxDzDFEjECGRHAICQCIKIJIBAFAMYNYRIDBEYPYGYHYLYASCILIGARIDIEBPYGYHYAYLYCSLIHANIMIRIGBPIFIBSEYFBPYGRDIFIEIBCMYNYHQLYPYFRDYRYCCAIHILIGIFIDRGQLYRYCYACHIGILIFIDINIMIPIBSEYEABAMYNYFQLYRYCYAYHCGIFILICSAYHYLYGCFICILINIARMIBQEQRIEIBCMYNYPYDYAYCYFYLYGSHILICARIDBAYCYFYGYLYHSLIFANIMIRIDIABPIBSEYAYEABA', 'GLCDoGABjBBCNCQCZDhDkELFAJEICICQGBHYEQAaFAIYKADAJABKIQBYHQGQAYEADYJYFSKIEIDCHIHADQIAIIGRCYDYEYKYFCJIHIIIDSCIGBDYHYIYJYFSKIEICICAHAIADIGRHYHAIAIYCSEYKYFCBIJICIESHIIIGBDYEYBYCYJYFSKIAJHIIIECDIDAGREYAYHYIYKYFCJICIDIGIESHYIYDBCYJYFSKIAIDIHAIAEAGABZJQDQAQHJIAAZDAJABJEQGQAQIQHZCCDAAJEAGABZJQAQCQDQHJIAEAGABA', 'GLDDiGlBICcDqDKEMEgEAGZGAIFIGYHYJIDAKYEYCCBIEIIIKIDSGYHYJYAYCAEAKJIAFZBQKQEQCQAIHIGIJIDCFYBYIYEZKYCSHIHQAQAYJJGAEAEYHYCCBIFIKIIIDSGYJYCAHIEIGQJZAAEAHYCRAIEJGIJIDCFYBYIYKYCRHIGIGQEaAQJJEAGAGYHYCBBIFIKIIIDSEYGYAZJYCBHIAQJQEKGAAZHYAICRJIGIDCFYBYIYKYCRHIAIAQGQEZJAHAHYCCAJBIFIKIIIDSEYGYHYJYCAAAKABAFKIQKZAQ',
  'GMZBECLBNBYCdCADCDpDrDIEaHDAFAJIIIAQKIEBAYLYBRHIGIEAAAIZJZBQFQDQDYFCBIJIIILIAIESGYHYKYCYDYFYBCJIIIAQLICRKIEBAYCYIYJYLYBSFIDIHIGIEAAAKICBAIESCYABLYDRKIAICIECIYJYLYDYBYFSHIGICAKIDBLIERCYAYDYGYHYKYFCBIJIIIEQCQLIARCIECAYAQCRDYEQGYHYKYFYBCJIIILICIAIERDYACCYIYJYLYBSFIHIGIDAEAIYJYKIAICBLYBYFSHIGIKIAICIDIEBLYAR', 'GMZCkDABBBCBUBYBFCDEaEQGqGGQKICRDYEYIYFBKIAALYBQHRFIIIEIDICBGBJILYBYHQKIESDICIGBKYAYCSDYIYFYHCBIJIEICIDSIYLIAQKZECJYHRFIEIIIKJAADCCYJYKYESFYHBEIFSIIDIKICCJYFYEYLYBYHSIIDICIGIABJYKICSDYIYKZHCEIFICIJIARGYDYIYFCEYHSFIIIDIGIABJYKJDSIYKZECCIDIHAJIARGYIYEYCCHYFTCICREJHBIIGIABJYDYBBFZCRBIFIDIDQBZCBFIDIDALJJQBZ', 'GNFCADIBdBjBYCLDTDbDhDsDJFCGJQLQGZHAIAEAEIKYDQAQMIBICAFAJYKYEQIQHQGJLAKAKYEYJIFQCQBYMYAAIIEAJJKQLQGZHAEAJAKJLQGQHZEAEIGIHICIIYAQMIBIFCLYIYJYKYDYAREIDCIIJIKILIFSBYCYGYHYDYEYMYACIIJIKIDSGIHICIIYAQMIBIFCLYDYJYKYAREIGIHIDCLIFSBYCYDYGYHYEYMYACIIJIKILIFICSDYDQHZFAGALAKaJQIQEQGIHIDACAKYJZIQEQEILIFICIDRHYHQGaMQBK', 'GLTBlBABSBcCiDoDqDEFQFJGKAAADAFAHAGJJQCQDYAYKYIYBDEIEAFIGJHQFQIQKJCADAJAHZASGYEQBQKIADHIJICTDYDRAZKZBAEAGIHIJACIDRARKYIAFAHAHICIDIARJYCCDIDAGaEQBQHQFQIQKKJADYCRJIADDYDAGYGAHaCQFQJQKZBAEAFICIGIDQAQKYIACACIFZCQEQBQGIIQKKJADIARJYIYBYEBCIBSIIJIACDYAQGYJQKaEACAIABABYFJBQIQKJAADAGYBYFYCQEQFAKIJABAHKGQBYGIDRAR',
  'GLrDRGQBZBgBlBADpDEFIGaHFAAIGJHIDQJICBEBDYHYAYFQKYIQGJJABAKAAAAZFZIRGRBJJJCJEBEIDDAYKYFBHIAQKQCQDQEQJaBAFAKIDREYCYFYBQJKCAFAKAHAAJDQDIESCYCRFZBZJZGBIBAJHJDJEJCRCIFTBYKYDCEIEAAZHQIQGQJJBAKACAEYDRFAAZHZIQGQJQBKDAKAEAHAAJCQFQEZDZHBABCJFJDRERHZHQGbAAAJCBFBDJEJHRGRFZCZDBEBGJCQFQGQEQKQBaJAAAIAGJDREQKIFBCYKQAa', 'GNABFBQBVBZBlBBDDDaDJELEjEoGCQIIEICIASGYHYJYKYBYDBIIIALAMJAQCQJQGQHZKAEAIYDRBIKIEBJIABCYJQIZLAMYFYDRBRKIEIGIAACAMYFYDYBRLIFBMICQAQGYEYFBLYBBDILQIJJAMICIARJYESFYFQHJGAJAAACAMZLQIQFIEBIYBYDBLIIQEQFQHQGJJACAIYFREICIJQGZHAEAFAMIAQJQGQHZEAEYKYDBBIFAFICIERKYFBBYDRFIKIEBCYBYDYFRKIEICBBYESCICQHJGAJAAAMYEQCQHQGJJABY', 'GNABlBBBECFCQCRCKDSDcDoDaEqGHAIALAMAKKFQAQGQCQHZIALAJZDQEQIJHJAACAFAGAKaMQJQLQHQIZDAEABABYESDIBCJILIGICSAIFBCYGYJYLYBSDYECBIDRHIIIAIGBCIMIKIFSGYCCJYLYDYBYBAERHIDAJJLQAQCQIZHAHYEBJIDQHQIJAACALAKAMZJQBQBIDIKILICSGIFCCYGRAYHYDAMYJYBQEQIIHALAKAJAJYMJCQFQGQAQHZIZDAEABABYESDIIIHIFACALIAIGBJYMZBQBYEYDSIIHIGAKYLIBC', 'GNADpDcBdBgBICTCJDhDRECGLGrGCAKIAIFAEABYMYDQCIGIIIJIEIFRAYHYKYLYCBDBMIBIFQHQLZGAIJJQHJEALIFBBYBAMaIQGQIYDRCRKIAILJAQKaLAAKHAHYAYCADAIIJABJEQMIFRHYHQKQLaAAAIKJHAFALIMYIYDQCQKIHIFBEYBYJYGYCYCQDBIIDQGQKQAQLJHAAaKACADAGAIAMKBQEQFQJQAQHQLaKAHKAAGAJAIaCQDQGQHQAKJAIABAMZCQDQHQAQKQLKFAEAJAMYGQAaHAHYDBCIGIBIMIEQIYBA',
  'GNEDrGABBBNCCDQDYDaDkDpDhGKHIIHIKYBYLYJYERMIGICRDYFYFQAaMAEABIIAJAKILJCRDRAYFYLYMYEBJIJQHKLAKABZJQKKLQHaKAKYERMIAIFIDBCBBYJYLYJABKLQCQDQAYHQGQFQMYEBJIHIKIGICIDRFYFAIaMQAKFAIACADAHZGQKZEQAIFJIACADAKZMQFQIJCADAKAHAGZJZEQFJIQAZFAEAJJGJHQKQCQDQAZIAMAKKCQDQAQIZFZEAKIGAHJCQDQAQIQFZMAAKCAAYDAHZGQAQMQFKIACADAHAGZAQ', 'GNJBUBIBYBZBdBFCDDSEAGKGoGrGBQIQKQHQHYJJAAKYBBIIEIDICRAYAQJZBAKIAICBDYEYIYFYGRBIJJAAKYFBIIEIDICRAYAQHYJZFAFYBYBQGBIIEIDICIARHYKYFQJJHAKAAACADALAMaEQFQIQGQJIHIKIABCYDYFYEBIYGRBIEIEAFIDICIARHYJYBAGAKYFAIAMKLQAQCQDQKQHQHIJZFAKIABCYDYIYERFIFQHIJJAAAICCDYCQIYEYFRKIAQJZBYGBFIEIIIARHYBYKYECIIAIDICREQHYKYBQJJHAKAAA', 'GLqDAGFBVBhBQCSCDETEkEIGEBAZEQJYDRCRHIBIKIFBEYGYIYCYDBJIIRCZDZHRBJKJCBCYBYDYDAIAAJEQFQGQCQBZKADICIGBHAJAAJIQIYDSCIGIFIECIYDYCSGIDCIIESFYDYGYCCIIEIFRDYECIYCSGIEIDIFBIYESGYCCEIIIFRDYGYCYECIIGRCYEYIAAZJQHQKQBKCADAFAGAAZIQEQCIEICRDJFBGBABIZJZHREJCJDRBYKYEBCIDJJBHZCRDIHIIIJIAIFSGYAABYKYEYDBCBHIIIFIGSAYJYERKIAA', 'GNDGiGTBUBYBhBVCKDMDZDIEAGrGEQJYCYDYMYGQIQHJCADAJKCQKQLQAaDAHAIYGBBIMICRKIEBFYCYBYMYGRIIIAJAJIDRAILIEBKYDYJYJQIQIYGBBIMIDRKIFBCYDYBYMYGRLJKAJZIQLQHQAJHYKALZGBBIMIDICIFRLYIAJJLQEQKQAaGAHAIAJALKCADAFAMaBQLQGQJQIQHQAKEAFAKACADALaBAMKLQCQDQFQEQKQAaGAHAIAJABAMALKCQDQFQBaGQJQIQHQAKEAKABAFAJZIQBJFABYCYDYLYMYGRHIHQAQ',
  'GLBDrGFBVBACJCKCUCYCDEhEDQHYDYCSJIJQAKFAGAHBKAKIFSGYHYJYCBDIKIHSJYCYDBJAHAKIHIFIGSJYJQAaHBKYDRCIHIAIJIGCFYKYDYCRBYHIAIJIGIFCKYDYCYHSAIJIGIFIEIICBZKYDYGSAYJYHCCIGIBIDIKIISEYFYAYJYGCBJDIKIFSAYJYGYDCKIFIIIESAYJYFCKYDSGIFIAIJIECIYBZCQDQGQHQKYFRAKJAJIEIICBYKYFYDYDBCZGRHRARJJDBAYCAAIFBCYDTAYJYHCGIDICICQAQAYDBCIAQ', 'GLMEYGIBdCbDgDiEAGDGJGRGFQGIBQCQEZGAFKBQCQEQJYKYAYDBFIBICQKQJQHQIaAAGAFABJEQFaGQAQIKHAJAKACAFAEABaGQFJGIBICQKQJQHQIaAAFAKJCABYGYDRAIFIHIIIJICCEYJYFYKZFQJKKAFaGABJEQFQKQJaGAFKEABZFQGQJKKAEABAFaGQEKKQJaEAGAFKBQDAKQJQEaGAFABKKQFaGQEKJAFAKABaGQFKJQCQEZFAGABKIYKQJQCQEQFZGAHYAYDBBADQKKJQBaGQAQIKHACAFAEABAJAKaGQAQ', 'GNJDgGdBICUDZDbDjDpDDEAGRGrGIYJIKIDAFYGYMYCQEQJQKJAALAGAEZGYJQLJGAEAEYJYCBFIHIBIMIIIDSAYEYGYKYLYCBJIFIFABAHaMAIKHQMZJQCQFIEIDAHYIZJQCQKIAILIGIDBBYFQEJGQLZCAFIBIDRAYKYCALYEAFAJAIJHJDQGYFZJAIAHJMQBQFQFYJYCREIGIKIAILIDCBYFYIYMYHYCRJIGIGQLQAQKZEAAKLAGAGYJYCBFIHIIIBIMIDSGYKYEYLYAYCBJIFIFABAMAHaIQJQFJGJDAGYHYIZJQFQAQ', 'IRACOCJBzBHCNCYCfCDFZFjElE0E2EwHBDbDBACIFAQJIQPJAIGCJYCSIYPYFYBYEYFQHCLIKICIQIBQPJIAJIGSAYIYCDDDKYMYBTFIDICRDAPYCAFAQaEQFRHQPKCADADICIIIAIGCJYKYQYFYDSCIFBKIQIJIGSAYIYFYCYDCQIQAKAKIFSIIAIGCJYFYKYKQQQQYDSCIIIFCJIGSAYFYIYCYDCQIQAKAKIJIFSAIGCFYJYKYKQQQQYDSCIIIAIGIFCJYASIYCYDCQIQAKAKIAIJIFSGYIYACKYKQQQQYDSCIAIIIGIFCJYKYQYAS',
  'IUUBfBOBPBYBoBDCZCiCGDaDdDEEuFAGIGQGjG4GrIHQKYRIGRMYCYDYBBLICQMIGBRIAQAYCYCQLYBQMQJZDADIJIMIGIACCYCALYRZBQBYDSJIMIGIAIAQCBLYCQGQJaMABADARJLQAQCQJQOKPAJaAACALARZBQDQMQOJPJJAQAKALZAQCQQJJQPZOZMABADARJAQCQKJJQQZKAJKQQPQOaKAJAAACARZBQDQMQKKJAJICBAYGYMYDBBIMQRIAQCQJYKYDABAKQJJGARIAICRGYJYKYAADYBBMIAICIGRJYKYABMYBRDIAIJIKIGBCYMYAR', 'GLBDhDgBVCpDIELEbEDGYGrGAYFIIYDBHIBIJICCEYEAKaHQDQIIAICAJIEABZHYDRGIFIEAJZHAKJBQJQEQCQAYFYGYIYDCHIEJJIKIBICSFYFQAQAIIZGAEAEIFICCBYJYHYKYDSGIIICAFYEYGQIJAAEAFICRAYEZGYIYDCHIJIKIBICRFYGYGQEKAQIZEAGAGIFICBBYJYHYKYDSEIGIAJIICBFYAQIQEaGAAJFIAYCRIYGYDCHIJIKIBICRFYAYAQGQEJIAFAFICCAZBYJYHYKYDSEIGIFIIICAAAJABAKZHQJJAQ', 'GNADZDKBLBVBjBICCDbDkDsDEEgHCYDYIABJCQDQHQHYLYEBBIIIFBMIGRHYDBFYBYIYERLIDIHIGBMYJYKYERBIIIDRHIHADAFABZIQLQHJAJCBGABZIZLQHQAJDAFAIAIYLYBIEBJIKIMIGSCYFYDYAYHYEBIYLIBIBAMAKaJQLQBJIJFQGAKYJZLQBQIJDQAZHAIYIABALAJJKJGQCQAYDABZLAJAKJMQBQBYLYERHIIIDIAIFICIGCBYFQMYJYKYERLIDRAIAQHaIAAJDBFALYBIEBJIKIMIGSCYFYHYDYAYIYEBLIBIBA', 'GNdCBDABYBiBFCJDZDbDoDDEjEQGIAHJEAEYHYLYAYFSIIKIGIMICQBYGAMAIaKQGJBJCAIYHALAJJDQEQIQCQBZGZKAHJMQGQGYKYBICAMYHYFCAIJILIEIEAJZLQHQMJIADAEYHYJYLYAYFSKIGIMIIICQBYGAIAMZKQGJBJCABYGYMYKYFCAIHILIEIEQHZKQIJBQGZIAKAHJEAEYHYLYAYFSKIMICQGYIYKAMJBQIQIYKYGICABYMYFCAIHILIEIJIDQBQMZHALAJJEQEYJYLYAYFSHIKIIIMICQGYIAMAHaAAFAJJLQBJ',
  'HSACLCKBaBmBtBBCMCCDYDdDgDrDNEEGjGoGwGEQMQPIQJLQJQAQGQIZBADICRBYDCCICAPZBQEAFAMJRJLQJQPZCQDQOZNAKAEAFAMARJLJJQQZMZEQFQKQNQOJDACAMAQJJALZRZEQFQMJCQDQOZNAKAMAEAFARJLJJQQZCQCIDSHYKYMYEBFICIDIHRKYKAHAMACADAQKPQAQBQGQIQOZKAIKAABAGAPAQaCQDQHQMQIQIIHBDYCYFYERIIMIHIDCCYCAQJJALZRZEQFQMQIQMYNQKJDACAHAIYEBFIPIQIJIRILIASGYBYCYDROIGAAA', 'GLIDpDSBTBFCYCQDcDhDCHjHAAGACYDYHYHAKABKIQDQIICRGQGIFBCYDYIYBYKYESHIGIDBJIAIFACACIFSAYDYGYHYJYECBIIICQKIGQDIFBCYIYIABaKQEQGJDQDIFICCBYIYKYERHIJIDBGYGAKABKIQIICSFYGYHYEABIIICICAFRGYGAHaKAIABaEQIIIQKQDQJQALGAGJHBDZCBJYEBIIKYIABKKQCQJQGQAZEAAIEQGYAQHLGACAAYGYAAJAKABaIQIYERJIKICRDJGRAZAQHbDAJAGLAQAJCBFBBYBAIaKQAQAY', 'GOJDhDABEBFBLBQBRBSBgBUDbDBGjHBQIQLIFQAIHAIYFYKYFQLYERDIAIHIMICICQMZAAGAJABYFQKALYEYDRKIHICIIBLYHQKYDBEIHILIIRCYKYKQAQAYHBKILIFBNYERDRHIAIAAFAKALYDYHRKIFICIIBLYFQKYHBEBNIBIJQLQCQIQKZAQMJGAIYCYFYDYEYHRMIHAKAAZDAEANABKLQLICRIIGRAYFANYHREIDIFIAIGBIYAQCAKQLYBYHQEQMZDADIFIAIFAKICBNYEYHBBIBALKNQAQAYEYFRKICIMIGIGQMZKAEAFAAJ', 'GLpDAGIBJBDDKDMDSEYEUFrGAYEIHQFQGZEQBKCADAIAAAKaJQFJHAAJIQDQBZEAFAJAKKIQCRDQGZFZJAAJHQFQGJCBDAIAKaAQJQEQBJDAFZGQEZJAAAKKIQFQGZHAAZJQEJHAFJGQDQBZEAJAAJFQGJIAKaAQJQEQBJDAIAFZGQHQEZJAGJFJIQDQBZJAGAAAKKIQCRDQEZHAGZAAFJGQHQEJCBDAIAKaFQAQJQBJDAIAGZAZJQEJHAAAGJIQDQBZEAJAFAKKIQAZGAFZJQEQBJDAAAGZHQEZJAFJHQAJGAIAKaFQJQEJAA',
  'GMAGoGFBTBQCIDUDiDREcEKGrGAJFAHYDQGYKZGADAJALABKEQHQIQKQFQAZGAFKKAEAIAHABaLQDQJQCQFQGQAKKAEAIAHABALaDQJQHKIQGZFAHYHADAJALKBQEQIQGQKQAaFAFIAIKJEBIYDYJYCRHIKYHAGKKQHaGAGYCBJIDIIIERAYEAFYCAKJIABALaDQJQKQCQFIAIEAGQHJIAKaDAJALKBQKQEQAYFYCAIQHZGADAJAKKBALaKQDQJQCQGQFQAKEAHAIABALAKaDQJQBKEQHYAYCAIQFZGABADAJAKKLQEQIQFQGaAQ', 'GNLDoGFBQCDDRDaDcDiDkDsDTGAHBIDQFYGYHYIYJYLYCSAIEILIFIMIDCBYIYKYCQHIGIIABAKaJQBJIQDQGYHYCAJIKJIQBZHQGJFQLZCAHIBIDQMYAYEYCBGIGAFKLQGaFAHAJAKJIJDQGYFZHAJAKAIJBQLQJaHQHYCRAIEIFIGIMIDCBYIYJYHYLYKYCRFIFQGKMQEaAAGAFAHJJJDQEYAZGAFAHAJJMQAQGZFAAJMAJaHQAQFQGJEJDAJYHZAQFQGQEJMAHAAZHYFYCBAIIIBIJIKILIDSHYMYEYGYCBAIFIJIJAAaKALJAQ', 'GLABdCKBaBbBJCEDgEBGqGLHAREIDICRIYGYKYBCEIDICIJIHIARFYHAJZDQEQBQGIIIFAAAJYCQKYBYECDICIHIAIJIFSIYGYEADBCIBRKIABAYHYKYBBCYDRERGIEAIIAAFAJYCYBRCAEYDCBIESJIFQAQKIAIEAFCHYCYEYBYDSKICBHIFSAYCYIYKYDCBIEIGYHICRJIKYEBHICIFIASKYEYDYBCHIERKIACFYCYEYHYBSDIGIIIJYKICBEYHYBYDSKICIAIFCEYARCYJYKYDCBIHIAICRHQKYDYBBHIAICIEIJIFSKYDYBY', 'GNCBoDBBFBVBDDLDQDbDqDkESGYHCYAYFYGYDYEBIILIHIMICSAYAQFZGAHAHILZDQEQGJHALAMAJABJCQCIASLYMYDYDQLJFQHZGZEAIAKABJJQDQIYEQGJHJFALZIADAJABZKQDIEQIILIMIACCYCABZJQMQLQIaDAEAKAJJBJCQAQIYHQGZDAEAKAJABJMQLQHQHYIJAAIYLYKYERDIGIFIAAHYKALJHQIQFQGZKAIJHAHICBMYBYJYERDRKIFIGIAICBLZIQHJLAMABaJQJYEYDRHIIILIMICSAYAQGZFALAHaIAIYDBEIMICIAR',
  'GNKDkDBBbBgBhBACEDqDsDMFRGYGHZKABAJAIJDQFIEIMIGSCYCQHZAALAMADAEAFAIaJQBQKQAJHJCAGAHYIYJZBQKQLJHQAaLAHKMADAFAJABZKQHQMJFAFYDYDAJABAIJGQCQAYDAHZKAIJBQJQHQDQAICAGABZJQHQDQDIFIFQMZKAHJDQFQMQAQLZKAHAIAJJDQFQHZKQLJAAMAHAFAHYDBJZIQKQMJHAEAFAJAIZJYDQKQMQHKAQLZHAMADAJIEQKAIJJQFQAQMZKAIAJJBJGQAYFABAJaIQBJDRFQAJGAJYFQAQMQLQHaKAAJ', 'GNACUCBBRBSBTBhBYCdCKDiDEEqGIAJAEAFAKAMIGIDRKYFREIKADAGAMZBQIQLQJJEAEYJYLYICBIFIGIDIMIHIASCYEYJYKYLYIYBCFIFQBQIRJJIALAKJAAHAMZGQGIDIDQKQLQJZBAIAKJDADYGYFYKYBSIIJILIDCHIESDYDQJZLAKAGAMIAQCQFAJYHBGYFYBYISKILIHIDICIJIACEYGYFYMYHSKYLYICBIHIFIDRKYMIEQAQJYLYHCBYISHIKILIJIAADBEAFYMYBYIYHSKILIBCFIDRMIEQAQJYBYKYLYHCIIFIDIGIMICSAI', 'GNFBKBTBUBVBaBRCIDDEAGjGoGrGGYFYBRFAHIBAGAKaCQDQEQAQIQJKGAHABAFAKALAMaCQKIDQGQHYJYAAEADICICALIMJGRFYBYIYCBKILIGIFSBYFAGBLYMZDYERARJIHIBAFALYDYEYARCIIIKIGIFIBRFAHYBAGAKaAADAEAMKLQKQFQGQHIBAFYGYIYCYABEICRIIGIFIBRFAHYBAGAKALAMaCQDQEQKKFQGQHIBAFYGYIYAYKYECCIDILIFQBQHYJYEACBDILIMJFQFIBSGYIYAYKYCYCADBLIMIFIBIGRIYAYCYDYDAKJAQBA', 'GMCGoGQBRBFCADLDcDSEjEIGgGJIBILICRDYIYGQHYEQAIFIKJDBCBBYLYJYERKIEAIAHZJABKLQCQDQHQIQFQAaKAGAJAHJEAIQFQGZJAHABALKIQHZJQGJFAHAIALaBQEQJQGQKQAKFAFYAYKZEBJIIICIDRHYKIHAGaKQHKGAGIDBCYIYJYERAIEAFIDAKZJABALKCQIQKQDQFYAYEAGQHZJAKKCAIALaBQKQEQAIFIDACAJQHJGAIAKaBALKKQCQDQIQGQFQAaEAHAJABALAKKCQIQBaEQHIAIDAJQFJGABACAIAKaLQEQJQFQGKAQ',
  'GNFBACBBKBLBRBYBaBUDrDCGoGbHFQCQJILIGQBQKZEAEIDIDAHBIYMYASEIDIIIHICIFBKIBAGAGILYBRJYAQKYHAIYERDIHIKIBBGYFRCYIYIAMAJALJFQCQGQBQIYKYHYDYEBABLIFICRMYAYESDIABMICBFYJYLYEQDRAIHIIICAFAKIBAGALZEYDRARHIIIKICAFAJYEYDYARHRKICIFBMYHYACDIHRMIFRCYIYKYAADBHIEIJIFQCQKYAYDBHBEIJIJQMQIQIICIFBGIBRKYAYDYHBIIAQEAJILIBQFYCYAYDYHYIYECMIARCIGBAY', 'GNVBBCIBUBgBSDYDaDhDsDjGpGDHCAMYABDIFIHIGIEBIYKYLYJYDRARMIBICIEBGYGAHaKAIKHQKZIAJALJHQKQGQGIERCYBYFYMYABIIIAJAJIGIKJBRCIEBBYFYGYIYJYARMICIEIBBGYGQFQFYCRMYABDBKILICRFIFACAGAHALaKQJQIQFJCAJIHJGQERMYAYDBFIIICIEIGAHZCQEQFaCAIAJAKALKEQGIHQBRMYCBIYJYDRAICIMIBBGYGQJaIQIYCRAYDBCIIIIAJKGAGIBRMYAYDYCBIIJIARMIBBGYGQFQFYAYIYJYCRDIMIBI', 'GNEBoDFCJCQCbCADCDKDhDsDcESGEAJYFYKYLYCSAIAQHJIAMAFALAKABKJQDQEQGQIZHZAACABIJJDQEQGQIQHZMAIKFAGADAEAJZKYKQFQLQIQMQHKGADAEAJAKZBZCQAQHIGJDAEAJAKABZFQLQIQMQGQGIHZAAHIMIFCBIJIKIESDYFYGYHYAYMYCCIIJILIBIKIFSGYMYAQHIGAMAJAIZLABJKQIQJQMQGQGIHZAAHIMIFCIYJYKYBYLYCSAIAQHJGAMALABAKJIQBZLQMQGQHZAAAYCCKIIILIBIJIFSGYMYAQHIGAMAJABAIAKZLQAQ', 'HPVBkCEBYBrBACRCWClCFESHBGJGoGwGHRAIKIGIDIDAFRLYMYCYJYABKIECNIOIFRDYGYEYKYARJICILIMIDBFBNYOYBYIYHYASKIEIGIFIDSLYMYEBBBNIOIDRFYGYBYESLIMIFBDBNYEQKYACHIIIEIEQNIDRFRLYMYCYJYABKIBIGIFIDCNYOYBRKYARJICILIMIDBFYGYKYIBEIBINIOIFRDRLYMYCYJYABHBEIIRKIGIDIDQFBNYOYBYIYEYHRARJICILIMIFBDYGYKYAYHBEIASKIGIDIDAFRLYMYCYJYHBEBAIIIBINIOIFRDYGYKYIBAY',
  'IWeDAGEBIBOBPBVBYBoBRDZDjD4D6DTEuEhFFGJGlG8GrHBIDAGAJYUINIMIIQHQKYOYAZCQEQRYFAEIAIGICIOIJIKIDRBYRYGASYOAAZCQCIOISIDAKYAYOQSJJAAAAYOYCYGRRIBIDAAYOYCYGYEYFRRISJCBOIAIDQBYCYRYSYFBEIGIOIAIAQCQBIDAKAAZKIDQBYCAOYGYEYFRRISICIBIDAKYOYCRRYSZFBEIGICIOIKIDQBYRYGBCIOIKIKQJQSZOAKJAJDQAYKYSYOYCYCAKJGQLATZEQFQRJOAJJAALZJQOQRZFAEAGATJJQKZCQCIOISIDALYKYOQSJAA', 'GNQBkDABLBMBjBBDDDJDsDREbGgHEIDIHIGIIICIABKYIQGQHZDAEAIJKIARCYGYHYDYDQHJGAKALZIQDIEQHIGIKICICQGZHZDAEAIALJCQGQHZKAIZLYERDIKIGIHIABCYIYLYEYDRKIGIHIAICBLYFBBYJYDREIFILICRAYGYHYKYEBDBBIJIMICRLYFYDYERKIFBLIARGYHYFYKYEBDIIJLIAICBMYBYJYDRLIFRGIHICBAYFYLYERKIGIHIFBAICRFYGYHYKYEBLIAICIFRGYHYABLYDBBIJIMIFRCYIZLYDYERKIAIGICALYARKYEBDIAI', 'GNlBACYBZBcBECNCCDJDoDaERGqGGAAAIIMIJICQBQHZIALADAKAJAMZAQEQFQGQIJHJBACAMYEYFRLIDBFAKYEBJIMJCQCIBSDYDQHZIZGAAALYFBAYGSFIACEIEQAQIIHIDABAKICBJYMZEQEYGYFSAIAAFAGBEIMIBQDQHYIYGAEAMJJQCQKQLQIQHJDAHYIYLYGYAYFBEIASGIHIIIDILIBCCYJYKYAYEYMYFSGIECAIKILIDSHYIYEYLYACKIDICIBRHYIYEYAYGYFCKIMIJIBQLYASEIHIIILIBCCYDYAYJYKYMYFSGIEIHIIILIDCAYAA', 'GOkBZCSBTBFCYCADIDQDcDiDqDCGKGAIKILICRDYJYAAJAKALICIDRIIKYAYERMIGINIHIFCBYDYCYLYEQJIIIDBCYKQIQJZEAJILIKQIQDICBKYCQLYEQJIDIHQNZJAAAEAIICILIKIBIFSGYHYCAIYAQMYNYJYEBAIDIDQJQNJHABAFAKZIQCQDYAYJYAALAIJKJBQFQHQNZAALAIAKJCQDQLZAQNJHAJZLACADAKZIQAQERLIJIMIGINIHIFCBYCYCQJQLZDAKAIZAQDIEQJILICBIYKYAYDRLJDAJAAAIJKQCQCIJYLYEAIIKIBIFSHYJYCBAY',
  'GNADoGCBQBRBNCIDgDkDrDDEaESGFAIAJIJABKHQHIDREYLYIYJYFRKICIAIGIEBDBHYBYFQMILAHABZJQHKDQLQMaFAIAHAJABKDQLQMQEQAYIZHAMJEQGYCYKYFBJIMILABZJQMQHQIJLAMZFRKICIAIGIEBDBBYJYFQIIMYHQCRAIGIEIDBLYCYHAIYFAJABKMQLQDQEQAZGACALIDREYCYGQAJCAEADALAMABaJQJIBIMJDRERCYAYGYKYFBHIMILQIZKQAJGAIALAMZHQKQAQGJIAAZKAHAMJLQAQIQGZKAAJLAMZHQAQKQGJIALAAZHAMJAQ', 'HRCBOCNBSBTBdBiCADDDFDLDtD1DIEYEoEjFEIDIARIYJYBAFICRKYEAEIDIAIKIGCQYLYDQMYFRCIERKIKQJQIJABGAKYEAQAMZLQDQDIQIGSAYAQIZJAEADAKAQALALYDRCYBRJIIIAAGALYDYFYBREICBFBDILIGQAQIYJYEABBDILILQFQCQQQKQJQJYEYBBDBLIMIGQAQJYEYCBFBLAFQCQMJQQKQEQIJJAEYCYFBKIEQJQIZCAFAKADYBRFICIIIJIABEYKYQAMZLQDQCRFYBBDIBQCRFRIJJIAIEBGBMYLYDQBQJIAIEIGBQYCYFRKIEQKQAQIZJAAI', 'GLsDJGdBiBjBUCaDEEYFBGRGBYJYHYCCFIGIDAKYGAEAAZEIEQFQCQGQHQJKBAKAIAAZDQEYGYFYCSHIGADAEAAJIQGZHYCCFIEIEQHQKJGAIAAZDQHYEBDJAJHQIQGQKZEAEYCYFBDICSEIEQHAKJGAIAAZCZERHICBAJCQIQGQKZHAEAEYDYFRHIGJIAAZCQEQGQGICBHYFBDIEIAJCQIQKQBQJaHAGAEAEYDYFRGIHIECGYGQEQHQJKBAKACAIAAZDZGRERHYFBGIEQFQHQKKBQJaKAHAEAEIDIDAAJCQIQBQJQKaHAHIDCCICAAAGZEQCIAA', 'GNJBFCEBIBTBUBSCdCYDgDpDCEjEAADAIAKYGQIIDRAYLYEBIIDIARLYEYCYFBIIGAMAKKJQJIARDYGYIYMYFSCIEILIDBABJYKYFQCREILIDIABGYIYMYCYFBKIKAJKGQIYMQCYFYERLICBIIGAMAJaKQKYERFIIIMIGIASDYCYLYFBEBKIJIAQDRCYLYFYEBIIMIGIDIABJYJAKaGQIYMQERFILICIABDYCRLYFYEBIIGAMAKKJQJIDRCYGYIYMYESFILIAICBDBJYKYEQFRLIAIGBJAKZMQIQIYFYEBMIJIKIDRIYARLYEBFIAIIIDBJYKYMYFRAI',
  'GKCDpDEBNBdBgBQEJGrGSIAZDAHYCYDYECJIBAGIFBBYIaJQCQDQEQALHAHIFBGYCYCRDZEZARHJAADADYEYJAIKBQGQDQHZAAJAIABLGQDQDYEYCBGIDRGABaIQJQAQHJCAEAGAGYCSEIEQHZAAJAIABKCQCYESGIFRGACAEABaIQJQAQHJGAGYECCIEQFIDBBYBAIaJQEIGIDBFYGQHZAAEJGJFIDRHYHQAbCABIEAGAAIJAIKBQDRFYCYJYESGIHIFBCYJYGQAKHAJABABJDJCRCIFTJYGYGQAQHJJACADAFAIaBQEQGIDIDBBABYBAEZGRAR', 'HOABWCGBVBuBYClCBETEZEjEpEDHQGFQKQIQNJARHYMYDBGBEYBRCRDIMIHIABFBLYKYEYGRCYDRMIHIAIFBJYIYNYCYGBEICSGYDYBBEIDSGIIIJIFRAYHYMYBBEBDICIKILIFRARHYMYGBIIJINIAIFBLYKYCYDYERIICBKILIFRAYJYCYIYEBDIKICRJIAIFBLYCYKYDYERIIJICBLIFRAYCYJYIYEBDIKILICRAIAQFBCYLYKYDYERIIJIAIFICCLYARJYIYEBDIKIAILICSFYJYABKYDYERIIAIJIFICCLYKYARIYEBDIAIKILICSFYJYIYABDYERAI', 'HQZBmCGBSBWBYBdBACqDsDEETEoEiGyGBHAAGANYJAIJOIMIFRIYNYJYGREYCRKIPIABDYLYEYGBIIJINIHRAYPYEBGYCYBBOIMIFIHRARPYEYGBLIDIAIHBFYMYOYBRCILIERGYKYCBBBOIMIFIHRAYDYEYGRPIABHBFYMYOYBRCRKIPIDBEYGYLYCYBBOIMIFIHRARDYEBAIHBFYMYOYBRCILIGIAIERDIHBNYGRAIEIDRPYKYCBLIAIGBNIHRPYGBAYLYCRKIGIABLYCYBBOIMIFIHRDYEYLYGRAIPIDBHBFYMYOYBRCIGIARKYCBBBOIMIFIHRDRPYKYGBAI', 'GLIBFCUBdBkBYCBEDESEhGpGAADQIYCYEBDYBSHIGIAIFCJYKYCRIIARGYHYBCDICIJIFRGYHYEBCBJIKJARIYCYERHIGIFBAYJYKYDYBSHICBEYDBJIKIAIFSGYCYEBIIABJYKYDRIICREYHYBCDIJIKIARCYERGIFCAYJYKYDYBSHIBAGICBEYIYDBJIKJERCRGYHYBBJIEIAIFSGYHYDBIIEBAICREYIYDRHIGIFCCYAYJYBRHIGIEBABJYKZDRIIAIERGYHYBBDIJIKICIFSGYABEICBJYKYDYBSHIAIEBIYDBJIKICRIYAREIGIFCCYJYKYDRAI',
  'GNdBiBMBNBYCZCIDQDSDbEAGDGrGBAGJHAEAFAMaAQDQJQCQGJIACYDYABJICRIQCAGZAADAJAMKBQEQFQIZCACYJYARDIGIGQHKCABAIAEAFAMaAQDQHIJQGQCIBBGYDYABJIGQBQCQIJEAFAGZBQCRIQCAHZAADAJAMKBQGQEQFQHZIACACYJYARDIIIIQHKCABAEAFAGAMaAQDQHIJQIQCIBBIYDYABJIIQBQCQHZAADAJAMKGQIZBRCYJYARDIHICABAHQMYAQDQLQKKCAEAFAHYIAGAMZJQDYABJIBIGIIIMIESFYCYHYBAKYLYABDIBIHIIICRLYBA', 'ISDB9DtB0BECcCiFoFAIuEVHNDYDaDgDlD6DFGAQBILIPICADIFRERRZEAFALAKACADABZJQPQCJDBDIFIESKYCBDINKMKIQRaLaCADAPAJABJEQFQPZDQCQLKRKIAOAHAMYQZGQPZEBFABZJQDQDYCSKICAEBFYDYDQJABJFQPKFAGAQLGQHQMQMZARAYEYFCDYJYCRPZNQKQCALQRJEAFAPANZJABABYCRJINIQIDQNQPQEQFQRZLAKAJAJYCCBICQNIDAQYBQNQJQKQLQRJEAFAPADANYBAQJNQDQBYPQEQFQRZLAKAJABAQAQYCRJINIDQBYJQKQLQRJEAFAPABABY', 'GLADrGEBIBdBFCYDgDpDJHaHCQIYBYEQFQALDAJAGAGJHBKZCRGIHIKIDSHYGYCBJYAYFAEAEYFSAICIGIHIJIDCHYGYCYKYEYCRGJGAHLDQJQAbGAGZHBCBEIKIDRJYCYHRGJGQALCAJADAKAIAIJDRBYEQIYKYHYHQGQGYFBEIHQGQCQAYCIFAEABJIQHZGQKIDBHYGYEYIYBYFSCICAEBFABIGIHIIIDRKYEYGAHJIABZFQCQAICYEAFBHIHQGQKIDBBYHYFRIYGYCRAREJJJDBJYEYKYAYFCCIGIGAIKKQAaGAIAHABKKQAQGaIAAKKABaHQAQHIBI', 'GLCDjGhBiBLCYCQDZDAEEFrGGIJQAJEAHICAIIFCCYDYDAKaBQHQEQHJDICIFRIYAZJAHABAKKCQDQFQGQIQIIFCAYCYCADYEAGIDAKaBQGQEQHQJQAKEAIADADICICAGZDQDICIGIFRIYCBGBDZERCIIIFBDYGRIRCZAZEAJAHAGKIQCQAYCIEAIIDIDBIZGZGABAKKIQGZCSEQAIDAGIGACAIAKaBQEQHQJQAJDJGBCBCYIIFRGYDYDQGJCACYDYDAEAIAHaEQGQAZJQGJEAGAJAHKIQDQAYEAIIDRARCJFBCYDYIYERGZEAJAHABAKKIQAQCQGYEAAI',
  'GLADrGFBECCDcDkDpDIEKEZHHYBYKYFYGYCTDIDQEJAJIAJIKAGaBAHKGQBZHYCYDRJIAQEZJAFACACYFICAHIHAGKBQKQIQEZAACACYFYDAHAGABKKQCQAQIQAZCBFYJYDBHIFQCQJQEKAAIAFZHZDREIAJHIIAFAKABaDQGQHQJICICQAQEZJACIFJIQEZAAFACYJQAJFACACYHAGAJYDBBKDQKQHaCQJQAQAZFJAACAJAHKKABaDQGQHQJICICQAQEJIAKAHaGABJHQKQIQEZFZJACIAQFQEJIAAZCYJQEJFACACYGAJYDBBIBAHLKQAQIQFZEZDAGIAJ', 'GLEDrGDBTBgDiDpDMEcEJFAGGYJYDYDAFACQEJGABaIQHQAQKKJAFZCQDQAZHAIABKGQFQJQKaHAIAEJFJJQAZCBDAFACQEZIQHQKKAAJAGABaIQBIFJEAGJJQAQKaHAFAEJCQDQAJJAGZCQDQFZEAIABJGQJQAZFAEZHQKKAAJAGABaIQHQFJEACADAGJJQEZFZHAIABKJQEQAQKaHAIAGJCQDREJAQFZEACADBGZIQHQKKFAAAJABaIQBIHQEJAJJAGZCQDQAQEZHAIABJGQJQFQKaHAAJEQFJJAGABaIQAQEJCADAGJJQFZCBDAAZCQEQHQKKFAJAGZAQ', 'GNADZGhBCCNCUCYCDDLDiDqDsDIEEQHIIIDIAIMIGCCYCAKZJQBQDQMQAQHaIAEAFALAJJKJCQGQHYIZEAFALAJAKJBQJaDQAILQEQFQIJAADAMAJABAKaLQEQFQIQAJHJGACAKYLZEQFQIQAQHJDAMAJABALAKJCQBYKYLYDSAYHYIYECFIDIBIKILICIGSJYIYMYAYHYDCBICAKYLILQBQIQJJMQHZAAJAIABALAKJCQBYKYLYDSAIHIIIJIMIGCCYCAKZLQBQMQJZAQHJJAMABALAKJCQCIGSJYHYMYAYIYDCBICAKYLILQBQIQAQHQJJMAAZIABALAKJCQBY', 'GOSGoGABBBCBDBVBbBEDMDQDYGgGrGGQAIHIKILIMICSDYEYFYIYJYKYAYGCAIHIKILIMICIDSEYFYIYJYGYKYAYHCAIKILIMICIDIESFYFQIZJAKAKIDBAYCYLYMYHSGIGQJJIJDAFAAZKIKQIQIIDIFIJYGAKIAIECAYCYKYLYMYHYGSIIJIDIFIEIKIAICCAYLYMYDSIYJYKYGCHIDIKIAILIMICSAYEYFYIYKYGQJIIAKAAJEQFQIZJZGAAIFIEICBJIFAAYLYMYDYHYGSAIFQJYKIKAAADAGAHAMKBANaMQBKLQCQEQFQAaDAGAHABALKCQEQFQAQIQJZDAAI',
  'GPBDjDABJBQBVBZBaBgBlBMCKDSDDGpGFAJAOJGQDQHQMQLQAQAINZDAFAGAJABIKAMIHAOZBQMQMIHIGIDRAYLYHBMYMABAOJDQGQMZHRAIKQLINICIEBMYGAMADAIAOaBQBYJRFRKQAJLAMJCQEQNZAAAYFBJBBIKABAOKDQCQIQEQLZMAGAHABZKQMILIOYJRFRAINIEBCYDBBYHQOYKQMQAQNJLAAaMAHABIKAMIAIOIDRCIERLYLQNaMAKAMYFBJBBJGQHQAQLJCADAEAIAOZBQBYJRFRKQMIMQNKCAEAAZLQMZKANYFBJBBIBAOKDQGQIQAQAIIBDYGYLYHABZ', 'GMJBNCKBbBlBcCEDLEBGYGgGpGAYCYHYFBIYGYLYDQDIJIKILIASCYHYJYFYDCEYBRDIFIHICIJIACKYLYEYFRDYBCFIEIKIARCYHYDYECFYBSEIFBGIKILJAQAICSHYDYJYFYEYBBFAJJAACAKILZKQJQJIDRHICBAYDYJYJAKAKYBREILJAQDQJZFQFIGYHICIJIACDYDAKYLZFREYBCFIJIKIDIARCYDBJYKYFYBSEIFBGIKILJAQAICSDYHYJYFYEYBBFAJJAACAKILZKQJQJIAICIDRHYABJYJAKAKYBREILJCQDQJZFQFIAIGYEABAHIJIDCCYKYLYFRAI', 'GMCBRCQBiBFCaDoDrDAEDESGjGCQFJDAFYHIGJBQKZFALAHAGJDQGYHYLYESFIJIAIIIKICCBYDYHYKYFYEAGIHQLQFQFZARAIIICIKIBCDYDAHZGZEQLYARKJFALAGAHJLIDIBSCYFYHYIYJYKYECAIGIGQLQKQFKBADAKIDIBICTIYDBKYAAGIHIBQFaKALAHAGZAQAYESJIDIIIKIFICDBYHYLYAAGIHQLQFQKaAADRJYECGIGAHKLQGaDQERJIIICIKIBCFYGYDYLYHYHALKDQFJGADZHZHQFQGJDADIBSCYIYJYEBFJGQKYAYFAGJAQAYFYGYERJIIIKJDCAY', 'GNKDoGYBNCQDZDbDhDrDAEDGSGjGAIIIBICQKYDAGIFIEQJQKZAALAFAEJFIJQLZFAEAEIJICBBYGYHYIYMYDSAIEIFIKILICBJYGYGAMAHKBAIaHQBJJQCQGYEYDAHIIJJQCQKYAYLYFYDBMIGQEZFQLJCAGYMYDRAIKICALIEAGAJAIZHZDQFIGJJAIAHZBQMQGQGIJICREYFYKYAYLYDCBIGIHIMIIICRJYFYFQLQAQKJEAAaLAFAFIJICBGYHYBYIYMYDSFIKIEILIAICBJYGYGAMABAHKIQJQGZFZDAFIHIIJJQGQAQCQEQKaLAFAAJEQFZLQKKCAFAEAGAMZAQ',
  'GONBhBMBdBgBaCCDEDQDYDbDjDAEKEDQAQLQKQCQHQGJNACYAYDBKILICRNQGZHAAADAKAKYDRAINIFBCYKQLYDQAQNQHQHYABDBKILICIFRHYAYDBNIIJCAMQGZHAIAFALZKQNQAQDQHJGJMAJABAEALZFQJJMQGZHZAADAJJFALJBQEQMQIZCBFALAKZNQJQJYDRAIHIFAJYDYDANAAQHIKJLQJQFQGJIAMABAEALZJQFQNYARDICIGQHZCADAAANAKAKYARDRCIGIFAKYAYDRCRGIGACADANAAAJJKQAYDYCRNIABKAJZCQDQNQGQHJAANYCBDIJIKIFRAYAQIJMABA', 'GPBDrGABEBFBYBZBbBiBDCKCQDUDcDkDFQGQLQCQAYCIKALIFCGYIYLYKSJYHCMYNYOYESDIHIMIJIKCBYEQNILJGAIABZOQLQJQKQAJCAIALYOABJGQFQCYAYJANYEABILQOZNQJQAICIFBGBLYBYEQMQDQHQAJJAKAOYNYNABALKOQOIGRIYCSKYJYAYDAHYMAEALINIJQOICQKQAZHAHIAIKACAMYOYLYEQDRHIAIJAMANYDYEBLIOICQNYDYEYHSAIMIDBNICAOYLYHQEININABALAOJCQCIKSJYDYDQAZMAEABIDQAQAIDBBYEQAIDIJIKCBYCYLYOYHYERNINQAQAY', 'GNFCICLBbBgBMCZCADJDRDqDkECGAQDYCRJIGAIIMIHIBAEAKZCQDQJQIQHQMZAAFAJJCADAKJEQBQGQIYMYCCIIGAJYKYLYASFICICQHIMJBAEAGBDYJYKYLYAYFSCIHIIIMIGIDCEIBRDYGYHYIYCYMYFCAIJILIEIGRHYKIBQDQMZCACYFYACJILIKIGQIYCSHIIIDIMIBCGYEYCYJYKYLYASFIHIIIDIMIBIGCEYBREQGQMZBAHAIAJALAKJCQCYDSBICCDYDAKZLQJQIQHQMJGAEAKYBRHYIYMYFYACJILIBIDICRHYIYKIEQGQMYBCJYLYASFIBIHIIICBDYJYBQ', 'GLIGrGFBQBdBLDUDgECGiGRHBYEQGQCQIZFACYAIFIIIDBKYGYECBIGIJIHIKIDTAYIYFYKYCYCQFQIKAAKADAHABaJQCQFQGQEQIQAKKAFaCACIHIHAGaJABKGQGYBYJZERCIHIFIFQJIKQAaIACAEABIGIDQFYHAJAGABZEQGJJIFIFQJaCQHQIQAKKAJADABYFAGZHRFJFAGAHABJDQBYGYHYEYCRFIFQJKKQAaIAJAFAFYCBEIHIGIGQKQAQIaJAAKKAGAGYHYEYCRFIFQAQJQIKKAAaFAFYCBEIHIGIGQAQKQIaJAFAFIHAEYCRHIAIKIDCAYBYEYEABJGYGQAQ',
  'GNABTCDBQBaBcBdBMDUDqDsDgEBFHAIAFAGAKAJJBQCQEQMQHaIAIYGBFICIBBCQJYKYFRCIBIMIDIARHYHQIaBAMAKAKYBRGYCBFBJIEILIARDYKYEAJYFRCRGIBBEIKIDIABLYJYEQBQKQMQIKHAHIABDYMYBYECJIKILIDRARHYIYEACYFBJIKILIDIARMYBYCYCAERIIBAEALAJZKQFQGQIICALIBRCYEYGYFBLIERCICQHJMAAADAJZKZLQFQGQIQHJBBEYCRHYIYCAFBGICIEIEAKABQJJAQDQMQHaIAIYCBEIBIMIACDYDAJZKQBQMQIQHJAAAIDCMYBYEYCRIIBA', 'GOBBVCFBMBRBACDDKDSDoDqDsDbEgGFQGYDAIIEIARGZHYDYCYBBMINIFQHYEBIYIQDQEQGJHAAAFAIYNYMYBRCIDIEIAIGIHIFAIYAQHQGZDAEAMANJIQAYMYDRCYBBNIIIFRGYHYEYCYDBMIERHIFAIYNYBRDICIGJHIABEYMYCRDYBBNIBQIIFQAYEBMYCYDRGJHIEIAIFBIYNYBQHICBMIAREYCYHYBANIIIFREYCYGZHYDBMIAICREIFBIYNYBQDIGIHIEICBAYERGYHYDYBBNIBQIIFRCYABEYMYDRGJHIAICIFBIYNYBQHIAICIEBMYARHYBANIIIFREYCYGZHYDBAI', 'GLDBdCIBcBJCEDMESEgEAGqGHQAQAYFYGYBCDIHIKIIICSEYAYGYIAKZDQBQFIJIEACAKYHQBYDCHIIICIKIESAYAACBEAIYKYHYDSBIGICIHAKJEQAQAIECIYCRGYKZHQBYDCHICIIIKIESAYAAEAGYCBKYHYDSBICIGIHAKJEQAQAIKYECIYHYDYBRCIDCHIIIESAYGYDYCYJYFYBCHIDRGIAIEBKJIQIYDYHYKYBSCIFIGIDBJIEAIAIIESAYDYGYCYJYFYBCHIIIDSAIEBDYIYHYBSCICABAGIAIKIIQEIDCIYKYARBQCQGYCYBCHIAIKIIIDSEYGYCYIAKZHQBQBY', 'GMDDrGCBFCSCTCUCLDYDgDIEoGDRAIHICIEBKAIAJALABaDQEQFQCQAZGQHACJFBGBBJLJJRIRKRAZAQHbCADAEAFAGALAIKJABZIQLQEQFQHJAAKAJALZIABKLQJQKQAQHZFAIAJKLABaDQJQIQFQGQHKAACQEAKALAIaJAJYGRCYDCGIJIJQIKLQEQKQAQHaEAFAIAIYCRDYGCCIIIEQJABKLQJaIQFQHJAAKAJALABaIQCYFQGSDICCFIEIEQHQAJKAJALABAIaEQJJKQAZHAJAEAIKBQLQKQAQHZJAAJKALABAIaEQAQJQHJKAAZEAIKBQLQAQKQHZJAEAEYFYFALJAQ',
  'HRBC0DCBcBqBrBACWCDDLDSDUDwDFEaEYFsGBIDIOIEBFYQYHQLIKIEAFAMKFQEQCQPQAQGQIaCAEAFAJAKALZDAMYBYHQDILIOIEICRJYKYNYDBHBBIMIQIFIPIGSAYCYCAPAMZFQEQLZNQJJIJCALYEAFAMJPQLQCQIZKACIEALIAIGCPYFYFQLQCQEQKQJZNAOALJFAMYBYQYHRDRNIJIKICBEYOYDYHBBIMIQIFIPIGSAYEYEAPACQIIAAGAMaBaQQHQLQDQNQJJKAOAFAFIPIGIASEYCYIYKYJYOYNYHCDIFILIPIGICSOYCANYFBDYHRJIHAKIIIEAAAMABZQZLQDQDIPIGIMIAQ', 'HRrBKGTBeBoBADIDYDcDgDpDxDFFCGQGiGsHHIPIJIEBKYLYAYQYDRIICIOIEAJYPYIQMQNJFJGAEABYCAHJJAJIPZEQHQCQBIGQFZNZMAIAHJCQCYHYIYDBQICRIYPIEQOYIAJKPAAACALJKQAYEQPYCALAKJAQEQPQOQGQBZIAGKBQFQNZIAFKBAOAPAAAEAKZLQAICQPIEAKALZAQCQPQJaGQGIOJEAOYPYCBQYDRGIHICICAHZGQMQIJFACABIHAGZMQIQFJCANIEBOYHAJJOQEQHZCQNYFZIAMAGJJQCQOIEQBYFQIZMAGAJJCQHJPIEQBQFaHAHYCBGYJYDBQIAIKILIEROYPYAC', 'GNJBNCIBKBTBUCADCDEDLDgEiEYGBRFQJIEAJQIQHJGJAAMICQAYDYEYGYHYIYJYBCFILIKICRMYJQIQHQGJDAEAMAJaIQJIMJARDYEYEQGZHAMAIAJJEQEIAICBKYERAICIDRMZHQGJMAAACAJZIQHQGQMJCACYAYGYHYMYBYFCIIJIAQGYLIEIKIDRAYHYJYECJIKIDIARCRMYEAHICIACDYCRHYEQMIAADBCYJYIYKYLYFSBIEIGIHIMIAIAQMZDAJYIYEQGIGAHAHIIAJJAQDQMQGaHAHYEBIIJIAIDICBKYARIYEQHIGIMICBDYIYIQMQGQHZEAEYBYFCJILIAIKIDRMYAB', 'GLDDrGhBiBCCYCQDZDAEMFjGAIEIGIHICAIIFCCYDYDABaKQHQEQHJDICIFRIYAZJAHAKABKCQDQFQGQIQIIFCAYCYCADYEAGIDABaKQGQEQHQJQAKEAIADADICICAGZDQDICIGIFRIYCBGBDZERCIIIFBDYGRIRCZAZEAJAHAGKIQCQAYCIEAIIDIDBIZGZGAKABKIQGZCSEQAIDAGIGACAIABaKQEQHQJQAJDJGBCBCYIIFRGYDYDQGJCACYDYDAEAIAHaEQGQAZJQGJEAGAJAHKEQIQDQDICICQAZDADIAICIFBIYCRARDZGZEAJAHAKABKCQIQAQAYCCDQGYEAAJIABaKQAQ',
  'GNEDkEABBBLBVBKCMCbCCDhDpDQEKYLYGREYIBBYFRHIIIEIGBBYIREIGIMICRDYJYGAMABALJKQBYCQDQGRJYAZEAHAFAIALJGQKICQDQMIJQAZMABAGAKICIDRBYGYIYFYHREIFCIIGIBIDBCYBQKYGQMQAJJADACAKYMYGBLZHQEQIQFQAJGABICIDRMYGYAYFYEYHCIIBILIGSAYFYEYHYICBILIESFIGBEYFSGIMIDBCYEAEYFYFAGRMIEBFYGYBYLYISHIAIMIGCBYLYIYHSAIMIGIEIFBBYGRAZMAHAIALJGQEIFIKICQDQJQAZEAFABAGAKICIDRBYFSEYEQAJJABACAKYGQEIBI', 'GLCDZGVBlBQCcCEEJHADqDhGEAFAJIKYKQBQEQHQAQAZGZCBCYDDFIBICRGIAIEABZJAKKBQEQAYGYCBJZFYDSCIDAFBJKFQHQGQIKAAAIEBGYHYFYDYCRDAIIFAJYJAKABKHQJaDQFQIQAKGAJIJAHABaKQDQFQIYCADIFIHIERGYAZIYFBDYCRFIAIIIGIEBHYDYCYJJGQAZIAJACADAKABKHQGQAQIZJAAJGAHABaKQCQCIDIDQAQHIERJQIJGAAZGYIYJYFYCCDIDAFRIIJIGIEBHYFYDYCSJICAFAKABKHQAQGQIZFAJACADAAKFQHABaJYCAKQAQDQDIFIGIHIERIYIQJaGAHAAa', 'GNFCJDLBSBYBbBECQDhDoDqDcFBGBYDAIAMYCAFAKAKYFRJIEQIYDQBIDIHIIIECIYJYKYFYFAJJDQCQKQIQMIEAHYFAHQEQMYCADAIJHQFYDYCRMICAEAFYDYIAHJFQEQMYCAIAHAJAKJDRHYIYCRBIMIEAFADYJYKYCRHIIIFIDBFAHYJYKYCYLYASGIBIIIFIMIEIEQMZBADAHYCAIALAKKCQFQJQHQDQEQIaFACALAKAJKHQHIDREYCYFRIIIQMQBaLAKAJAHJCQFQKZLQBKMAIAKACAFAHZJQLQIJKACAFAHAJZKYLQIQBQMJKABaIABILAJJHQCQFQBQIaLAIIJAHJCQFQBQIQKQMZLABJ', 'GLqDBHNBTBdBACUCEDiDsDYFDYGAIIDQBQHaCAEAGAIAJAAJDQDIKIFSBYGYCYCQEBIIEQGQHKBAFAGADAKAAbJQJZIRDJGRHYEADAGAIAIYDRERHIGAIADYERCIIIGRHYCAIADAEAJJGQAIFQIYIADAGAJYEQCRIIGAJAAJKQBQHaGAIACADAJAJIGRIZCADAJAEAAIEYGQJYCSDIJAGAAYCQDRJIJADACAAIGQDZJRIJIQHLBADAFAJaEAGAAYCQEIGIDSBIFBKYAYDYGYCYERIRHRBJJBDBDYGYGAHYIYEBCIIQHQIYCYERBQEAJKGAHYCAAJIQHQGQJaBACAEAAAIJHQAZCQEQBQJKGAAA',
  'GLBBFCbBLDQDcDkECGSGpGYHAYDZJYCQFYBQHIDAIAFACAEIAQDYHYBAGAJKKQAQEQFZIZCBCIFIGYBRHIDIIIABEYEAKAJaBQCIFIGQFQIIIQDQDJHZCAIIEIEAIaDQDIEJIIAQHYEAIADaCQEIFAGAHIAADYFYCYBBJKBQKQDQDIARFYIYCYEQHJIAFAFYCYEYEQHQIKFACYHYIYBBGIDICQHZEADAGYBREIHIIIFIABCYDYDQHQFQEYHIIZBBGIDICIARIYEAFJCADYFYGYBREIEQIKCACYFYFAHYHADADJAJCRAYDYFYHYEYIYBBGIDQEQHJAADYGYBRHIAIFQIZHAEAEIAIFIFQIQHaEAAI', 'GLgBFCLBMBICDDcDhEJFAGjGCQKQGQBQDQFQJKEAIAHAKZAAGQBQFICAHIAIESIYCYCAFYBAGAHAGZDRDIGIHICSIIECAYAQCYEQGYKICQIQJaBADAFAHADYBSFIHIIIEIJIADCYCBGZGQEQIQJQFaHABAKIGICRARJYHYBBDIIIEIAICBGYGAKaDQBQIQHQFKJAAAEAGICQAYJIAACACIGYAREQJYJQFbBADAHAFIIAKKGQGIARCYEYIYDYBRHIJICBABGYKYBQHQFKJAEAGAIAGJARAICTEYIYHYJYFYBCDIDQBQGIHQFQJKIAAAAICICAERIYACGYHYKYDYDBGJGQBQDQFIHQAQAIIIECCYHYDYBY', 'GLMBRBACBDcDgDkESFDGJGoGAICQDYIYAAEAGAJIBAKKFQFICRBYHYEYGYASIIDIJIAADQIaJAEAGAKAFKHQDQEZJQIKBAEADAHAFaCAKQAQGQJQDKEQIZDAEKHAEYFAKaAQGQJQEQDQDYIJHAJZACGIGAKKCQBQFQJQHQIaAADAEAGAGYJJARDIFAIIBACAKaJQFKHQEZDQFYIJEADaGAFAJAKKCQBQHQDQEQIaGADJGIEIBIDYIICCHYFYJYKYARGREJDAEADJFBGZABGIJIKIHICSBYBACAHAKaJQAQGQDQFJIQEaFADAAAGAJAKKCQBQEYFZDAHQIJBJERFZFQDbIAIYABGIBIBQIQDKFADYIZAYBA', 'GMUDpDKBbBDCYCcDkDIEZEAGrGABGBHBDJJJCRIIFBBYBALaDQJQEQHQGQAQKKIACABICYFQIYEYAYEAGYHZDCJIJALKBQCQFQHQEQIQKaAADAGAJAHJEQEICIIIFBBYBALaEQHQJQDQGQAQKKIACABIFQIYCBGZEAGQCQKYDAJAHALKBQFQIQKZAAEAHaEQAQJQDQKKCAIAFAGAHABALaEQGJCQJQKYDAGIGQDQKICAHAHJCRIIFBBYCQFQIQKaAADAHAEAGAJALKBQBICYFRIYEYGYHYJYDSAIAQGIKKIAFABYEQHQAZGADAHIEABIFQIQKaGAGYDBAIHIJIEICIIIFBBYBALaEQJQHQAQDQGQKKFABAIAAZ',
  'GLrDLGCBZBiBACBCYCDDSEUFAIDQEIDIGSCYCQIZBAJADAEAAZKQJJCJIRBZIADAJAKAAJEQCQIIGBEZAZCQDQIQKQIJCBDIGIECHIFSEYEAFAHBAZDQDYCSGIDCCYCAAJFQEQHREIFCHYAYCYDRGRIZJQBJEAEICCDYIYGBAIDQIQCQEQBZJAKAAJDJIRCREYGYDCIIIAAaKQJQBJEACAIYDSGICIEIFIFQHCIYCQEQHQBaGADAJAKAAKIQIJFRHREZCBCYDYDBIBAZIQGQKQJQBKCAEAFAHAAZIQDRCICQBZJAKAIJDQDICSGYDCCICAAJFQHQEQEIHCFYAYAAIaCQKQJQBJGAAAAIERGYDYDAAAEIGRDYAA', 'GNABdCNBkBDCMCQCBDEDJDoDREhGEQKJGQAQHYIZCABAFADAKJMQEQLQJQIQHJAAGAHYIYMYEQFYCYBBDICSFIECCYDYKYBSFIEICCDYERCIHIIIAIGBLYDYEYCSFYBCCIFRIIKIEQJIAQHYIAJAEAJIDBLIMIGSAYAADYGAJYMYEQJQIQIYFBCYHIDAJYEAKYBSFICCEIJILIDSAIGBDYASHYIYCYEBJYLIAIDIGRHYIYCYEYFYBCKILIAIMIGQJYCSHIIIJIGCDYCYAYLYMYKYBSFIEIIIJICBAYLYERIIIAEAJALAKAKYERMIDQGQHYIYECBYFSEIIIBBHIGADAKIMYKQBQLQJQIQIYBBLIAICRIYJYBYEYFCLIAI', 'GNKCdCFBLBACJCYCBDDDUDbDrDhEKQDQIQHJAAFAMALZKQDQDIJYBAKILIMIFSAYHYIYCYBBDIJYCSHIIIJIAIFCLYKYMYCYDYBSHIIIJIAIFIEIGCLYMYFSAYCCJYBAKIFILIMIGSEYAYCYCQHZIAJAFAJIKYBQJQIQHJCAFBMIARCYFYHYIYJYBCDIKILIAQMIFRCIEIGCAYLYERCYFBKYMYDYBSHIIIJIFICICQEBMYFRHZIAJABAJYKIFQJQIQHJCACIEIGIACLYMYFYKYBQJICSEIFCLIMIASGYFYEYCCJYBAKILIMIAIGSFYACLYKYBQJIMYCSEIAIFIGCLYMYASEYHYIYJYBCDICIKIAIESHYIYJYBYDCCIBR', 'HPIClERBVBWBcCgCDDyDFEAGKGSG0GhHCAOAIANaBQDQEQJQHJKJAACAGAMYFAIINYIQFQOQMQCQLQKQHbJADAEABAIJFQMINIGQAQHYKALAMAFAOANAIbBQDQEQJQKJHJAACAGAIYMYFANINQFQOQMQLQHQKZJADAEABALYFBNJIJGQOIGIATCYHYKYLYMYFYDYDBEZJRDJEBEIFIHIKICILIMIADGYGAIZNZBQJQDQEQKJHAOYFRLILAFAMAOANAIKGQAQNYFQMICQHZKZDAEAJABAIJFQNQOQMQLQKQHKAACAGAMYFANYIZBQJQDQEQHJKALAFAMAOAIAIZBZJRDREIFIMIOICSAIGCCYARCQGQKZHZEAEYDCFIMIOIAIGICCIYAQ',
  'GLqDDGMBSBACLCRCiDoDBEcFCIERJYBYCADAKAAJIJEQGQJQBZFAHAIAAZKQFIBIDIJIECGYAYHYIYKYCTFIBIDIJIEIGCAYHYIYKYCYFSDICCKIAIHIIIGSEYJYCYDYFCKICSJICAEIGCHYIYCYKYFSDIJICBHIIIGSEYCYCAJYDYFCKIAIHIIIGIESCYEAGCAZHYIYKYFSBIDIJIGICIEBHYIYGSBYJYDYFCKIGIHIIIERCYJYGBIIIQHQHIJQCIEBAAIZHQAJERAYCYJAAAHAHYGRIIEQCQBZGCKYFSDIGIBIJICIECAYHYIYKYGSDYFCGIKIAIHIIIESCYJYDYFYGCKIDSJICIECHYIYDYKYGSFIBICAJIAAHAHIERCYAA', 'GNABdBKBNBTBjBMCEDQDsDBGoGYHEAFAGQJYBQDQHQKJCACYEYEAFBIIMIASCYEYIYFYFAHYDABAIJJILIAQCREYFYFQHYKZDADYBCGIDSHIIIFIKIEIEQKZCAAAHALYJYGQIIFIEICIABMYFRIYGAIADAFAJALKMQAQCQEQIaEAHQKJIAAACAMALaGQJQDQFQHQHIFBMIARCYEYFYHYBQKIFAHYDBMIAICREYABMYDRHIFQKYBAHIFIAIEICBMYFRHYGAHADAFAJALKMQAQCQEQIQKZHAIKAACAEAMALaGQBQJQDQFQIQHQKKAACAEAIaAQDAFAJAKYBAGALKMQIQCQEQKZHADAFAIKMALaGQBQHIFAJQIQDQDYBYBQGBIIJIDRBY', 'GNdBICZBcBgBBCFCDDLDsDaESGpGBAEAIYMYJYAQGQHIIALADAKAJAMJCQEQBQFQIZHZGAAAMICIFRLYDBFAKICBJYMZAQAYGSDIDQHJIJBAEALIFBEIBSFYECCYCQEQIYHYDAGAKYABJIMJCQCIBIFSEYBBCYEAFAMYGQDQHIIIBACAMZJQAQKQLQIQHZDAHIIILIBIEIFBCYESBYHYIYDYLYGCAIJIKIEICIMIFSBYCCEYKYLYDSHIIICILIECKYDYAYGRHIIICIEIBIFCKYMYJYGQLIESCYHYIYLYGCAIDIEIJIKIMIFSBYCYHYIYLYDCEIKILICSHYIYDYLYECAYGREIDIHIIILICCKYAYLYDSHIIICILIBIFCKYAYMYJYGQLIAA', 'HOLDsHoBCDTDYDNEbEdEEGIGQGgGpHDZJZGAEJHAMJFQLQKQDQJZAADKKALAFAMZHQEZGQAJDAEAHAMJFQLQKQEaDQJJEAKALAFAMZHQDQKJEQJZAZGADJHAMJFQLQEQKZHALJEQKQJQAaHADZIAMJFJEQLZDQHQAKJAKALAEAFZMZIQGQAJHADAEKFAMZEQDQHQAZGAIAEJMJFQLQKQJQAaHADALJFAMZEZIQDJHQAKJAKAFALZHQKJFALAMAEaHQDZGQAJJJFAKZDAHAEKMQLQKQFQJZAZGAIAEJHQDQAQJJFAAaDAKJAQFQJZDAKAHAEZIQGQDJJJFAKZHALJAQKQFQJZDZGAIAEJMJAQLZHQFKKALAAAMZEZIQGQDJFAHAAKMAEaAQ',
  'HSuBACLBMBSBYBNCOCRCDDFDlDoDwDyD0DBEiHCQDQJQKZGAHALAAAPIOINIRIMIFRBRQYEBIIBIFCMYNYIRERQIFBBYEYEQQQKZJACADALaDQGQHQJJCACIKIQIFIBBEYFSKYQYCYCQKJDALIQAIBMINIERBRQYIBFIBIECMYNYFRIRQIEBBYIYFCOYPYRYAYHSGIACLICQRIFRCYDYAYLYGYHCPIOINIRIFIMIBRERQYCBIIEIBBEQMYNYIRCRQIBBEYCYCQQQKZJZGAHALJAQDQJQKJQACACIEIBRQYJYKYABDICIIBMINIBRQQKZJACAFAMIEQQQKQJZIBFYCRAYCADBCIFIAQIRJJKAQAEAMYFQAQJQKJQABBMYNYIRAYCYDRJIKIQIBBEYAY', 'HPBDgGbBcBDDdDlDoDLEtEFFYGqGwGIHNJHQMZCQDQFZKQEJAJOALABAMAHANZCQDQGZKQEQAJIAFAGACADANJHQMQBQGaFQLJGABAMAHANZCQDQFQBJGQLZIQAZEAKAFJCADANJHQMQGQBZCADAMJGQBQLQOQAaEaKAFAJANJHJGQMZCQDQFZKQEKAKOALABAMAGAHZNZJQKQEQAJIAFACADAGKHANZGQHKMQBQLQFaIQAZEAKAJAGJHQCQDQIQAQEZKAJAGAHJCQDQIQFKOQEaAAFAIACADAHZGQJQKQAJEKOALABAMANAHaGaJQKQAQEJFAAZKAJAGKHKNQMQBQLQOQFaEaKAEIJAGAHJCQDQIQAQEQFKOAAaIACADAHZGQJQKQFJEAIALJAQ', 'GOqDBGLBYBkBACRCSCdCEDJDMDbDoDLQJQBJKAGAHAAAAYNJDQFQKYHAMYEANIAQMQHQBYMYCRJYLYICEICIEQIQBIHAMIMAAAAINZCQGQMIHQKIFADANYAQHQJZLAMACACYEYEAIRAIHQLIJIMIJQKQBZLAMAMYIBJIHAAYEQEICICQJQMQKJGAHAAAAYCYNIDQFQBYLYIAJICANJAQGQHQKZMACANAAJGQHQKQMZCAJYIQLICAKJGAHAAZNQJQKQCQLYIAKICQMJGAHAAANZJQAJGQHQMZCAKYIQLICAKAAAJANJGQHQKZCQLYIAAICQMJKAGAHANZJQCQMQKJGAHANAJZCQAYCIIQLIBIFADAJYNIGQNQHQKZMAAACACYEYEAIRMINIHQAYMQKKAA', 'GNVBYCCBFBIBhBiBlBDDLDRETEjECYEAIYJYDYABLIKICREIBCFYCRKYLYHBMIGICIFIBSEYIYJYDYAYHBLIDRIIJIEIBCFYCYGYDRKICBFIBSEYCBKYLYHRAIIIJICIEIBCFYGYDYMYHRLIKIGBFIBSEYGBKYLYARIIJICIGIEIBCFYDYMYHYARLIKIDBFIBSEYDBKYCRGIDIEIBCFYMYCRLYABHICIMIFIBSEYDYGYIYJYABLIKIDREIBCFYDRKYLYHBCIMIDIFIBSEYGYIYJYAYHBLIKIGREIBCFYGRKYLYCBMIDIGIFIBSEYIYJYAYHYCBLIARIIJIEIBCFYGYDYARKIGBFIBSEYGBKYLYCRHIIIJIGIEIBCFYDYAYMYCRLIKIDBFIBSEYDBFBAY',
  'GNRDjDNBYBiBACdCEDJDZDoDLFBGBQLQIJAAJAEAEYKIDQFQMYHYCAGABIKIEQJQAQIZLAKAKIEIBYGQCQHIMIFAJYEABZKQLQIJAAEABAKZLQIQAJEAEYAYIYCYJIFQMYHYGCLIBIJIKIDIFREYDCBYJYKYLYGSCIAIHIIIDIEIMIFCBYJYKYDSAYIYCYJIFQMYHYGCLIDIBIKIFREYAYIYDCLYGSCIDIAIHIIIEIMIFCBYJYKYLYGYCSDIDQAJGAIALAKKBQJQEQFQIYAYMYHYDBCBKIBJJQEQFQIYAYGAKABJJJFQIQAZLAJABaKQJJLQAJIAEAFABYKZJQGQAIIIFABAKZJZCRDRAIGQHIIIEAMIFABAKAJZLQIQAZDADYCCGILIBIJIKIFSEYEAIZAQ', 'GNMDiDDBRBVBhBYCEDSDaDqDkEAHGAIIJIDIFBBYKZLYERIIJICRMIGBBYDRCYIYJYEBLIDIBIGRMYAYHYEBIIJIDBBIBQCQDQIZJALABJKJFRGQIZJZLABAKJCQDQJQJYLYERAIHIIIMIGCFYCYDYBYJYKYERLIIIIQMQHaAALAIJJJCAGQHYAZLAIAJJDAJYKZBQJQIQLQAJHJGAFAKYDQIZLQAQHJMAIAIYLYEBBIJIDICIFIKIGSIYCAMYAYHYEBLIDBJZBAKKJQCQIIGAJZDRLYERAIHIMIGBFYCYDYBYKYERLIIIIQMQHaAALAIJDAJIFQGQHYAZLAIABAKAJJCQDQBZIQLQAJHJGABYIZLQAQHJMAIAIYLYBIEBJIKIDICIFIGSIYMYAYHYEBLIBIBA', 'GNABKCEBJBNBkBdCYDiDqDTEgEBGAQEAMYCYEYGCFIFAJJIQKQCQEQMJAADAHALAIZJZFQGQMIBAKYFYGREIFCJIKIBSCYFYEYMYGCJIKIBICSFYBBCAIJLQHQAQDQMZBAEAKYGREIBIFICBKYBRMJAADAHALAIZJZBQFIGQEQMICAHJLAIAJZKQHQCQFYEYMYGCBIHIKICSLIARDYLAHZFQMYEAFIHILIAIAAHZDQLQMYEYFBLICCHIIIJIDSAYCYHYLYFREILAHJCQMIAADBIYJYKYFRERMIAIDBCYARMYAAEBFBKIIIJICRHZDQLQMYEYFBLIAIDIHICCHYIYJYASLYFREILAHJDQMICADYHYLYFYFAHJEQLQMICIDBLYACHYKYBYGSEIFIAIMICICQMZFABA', 'GOYDDGCBaBgBhBACTCcCdCMDRDUDqDCYKZMAIAJANJHQLICQBZMAKJLAHANZIQJQKQLJDBAIGQBYHBAIAQDQFAHQBIGAEANZAQHQLZKAIAJAAJNJEQFQCQGQLYHANAAZIQJQKQMQBJLALYDBCIFCEIGRFYCYDRLIFAGALQBZMAKAIAJAAJNQDQHQLICAEANZHQLQKZMQBJCALYHAAZIQJQMQKJCIFIGBEYDYHAAANJDQEQGQLQCQFQBaHAKALIDAMAIAJANJAQLQCQHQBIGAEAAZNZIQJQMQKQBJFAFIDCEIEAAANZLQAJEQEYDSFYFQBZCAKAMAIAJALJNJDQEQGQBYHAAAAYNAHQLZIQJQMQKQBKCAFAAADAGAEALZNQDIEIGRFYCYHQKZMAIAJANJHQAICQBZMAKJAA',
  'HSQBkFLBMBNBRBqBrBmCADCDaDgDiDoEEGIGcGEIDICILANAMJFQLYQIAAFYMYNYHCGIMIOIFRNYNQAQQYHARaCQDQEQPQKKJKQAAARYHQPaKQJJCBHIRIAQPYCYCQJZHAKADAEARKCQPIAANANIFBMYOYGYCSMINIFIARLYNAPYRZDQEQKQJJHAHYJYKYEBDINJLJAAFAMZRIGBCYBYIYDSESJIKIHINILIGAMIPIQIABFYFQAQGYLYHQQYJZKANAEARYEYDCIIBICIMIGQOIFRGYMYRYHQPIAIGBFBOYCYBYESHIHQRIAQPYNYNQKQJJPIQJABGAFAFIGSAYAQPYQZJZKANAHANIPIFARYHYECBICIMIOIGRARFYPYHARIAIAAGBMYOYCYBYIYDSEIEQNQKQJJHALIQIFAGAMYRIAIAQ', 'GODDiDFBQBTBVBZBgBMCkDpDJEAGrGDAEABAHAJZIQKYNYFRCRAIAQMKDAHALAGAJZBQEQGIHIDRLYAZIAMYCBFBBJJJKANZBQBYFRCRIQAJEAGAJAKJDQHQLQMZAAAYCBFBBIIABANKDQHQJZKABZIQNYFRCRAIAQMKLAJAKZEQGQAZIAMYCBFBBJEQGQJJKADAHANZBQBYFRCRIQAJJAKJLQMZAAAYCBFBBIIABANKDQGQHQLQJZKAEALIDBHYGYBZIQKIJINYFRCRAIMIDBHBGYBYEQNYIQKQAQMJJAAaKAEABIIAKIAINIGIHRDRJYJQMaKAIAKYCBFBBJEQNIGIHIDRLYAQGAJJLADAHANaBQBYFRCRIQKIKQMKLAAZJQKZIAMYCBFBBIBANKDQGQHQAQAIDBHYGYJYEABZ', 'GONBbCABJBQBdBMCEDSDZDsDBGgGoGGQIABAKYFQAQIJBADIMIEQCQCILYEBHYJYDQMYBQIZABFBGAKIKANKMQJQCQEQIZBADAKZFQAQHIBAKAJKMANaJQJIMJNIERCYKYBQHYAAFAMIKQDQDYBYGYFYARFAHIAAGAMAJANJKQJaMQFQGQHYAAFIGIBIDICIEBJYKYDRBYGYFYARHIHQLKBADAIACAEAJAKANaMQFQGQHYAAFIGIDIDAKJBQIIEAJQCQCYBYDYHYGAKIJICQEQIYLYAAFAKIJIBQHYGYFYFAKAAQJJGQHIBALIIIEACANAMaGQJQKQAQFQHJDADIBICIERIYIQLaHAHYABFIDIGBKYFQAQHIGAJYKAJAMKNQJaKQKYDRAYFBDIKIKAJKNAMaJQJIKQGQHYFADAKIGRAY', 'GNADsDIBdBjBFCYCLDTDbDpDJFCGLQHZIAJAEABYDQEIFQMIAICAGAKYBYEQJQIQHJLABABYEYKIGQCQAYMYFAJIEAKJBQLQHZIAEAKABJLQHQIZEAEIHIIICIJYFQMIAIGCLYBYJYKYDYFREIDCBIJIKILIGSAYCYHYIYDYEYMYFCBIJIKIDSHIIICIJYFQMIAIGCLYDYBYKYFREIHIIIDCLIGSAYCYDYHYIYEYMYFCBIJIKILIGICSDYDQIZGAHALABaKQJQEQFQHIIIMIAIDBCBBYKZJQEQFQHIIIGABAKZJZFQHQIJLABJKAJZBQLQIZHAFABJJJKQCQDQAYGQIYHYMYFBEILIGICIDRIYIQAQMZHAAKIAIIDBCYGYLYEYEABAJJKJCQDQGQIYAYEABAJAKJLQAQIJDADICCGYLYBY',
  'HThCzDABBBCBDBRBWBaBbBoBqBtBQCSDrDMFEGkGHAMIBIPIJRSYMBBIPIJILIIROQFQRYHAMASIOQGIABKINRCRDYEYGBOAIASYMQHQRIFAOAIAKIAROYFRRYHAMASIFQOIABKYIRFYSYMQHQRIGIEIDICBNBKYAROYGRRYHAMASIGQOIABIYFRGYSYMQHQRIEIDICINBKBIYAROYERRYHAMASIEQOIABIIKRNRCYDYOAEASYMQHQRIOAGBFBIIARDROYDARYHAMASIEQGIDIACIYAQFREYSYMQHQRIOICINBKBIYFYLYJYBYPYMRSIEILBFIARCROYCAGAEASYMBBIPIJIFILRDRCIACIIKRNROYCADANASaFAJABZPQJIFIERGRRYGAEAHAMAJIFIBAPZFQJQMQHQRIGAEASKDQCQOINAKBIYASCYDBLBBY', 'GNNBZCABJBMBYCdCKEEDiDqDBGaGCQLYIYAAGAKJJQMQEQHQIQLJCADABAFAJZKZGQAQLIDIBBMYBQERHIDRIYLZAAAYGCEIEAKJJJFQCQMIBRCIFCBYCSDYDACAHYARIIJYKYEQGQLJDADIFIBCCYCQBQFRDYLYGAEAKIJIFQDQLZIAAAHAMAJAJIKZEQKIMIFICIBRDYCCFYJYKYEYMYGSAIHICIDIIILIBCFYDSCYHYMYECJIKIDIMICSHYEYAYGBJIKIDICIFIBSHYLYIYGAMICCDYJYKYMYGSAIEICIHIIILIBCFYDYJYKYMYESCIHIMIDCJYKYEYMYCSAYGBCIEIJIKIMIDSHYAYMYECCYGREICCJIKIDIMIFIBSHYAYCYEYLYIYGCJIKIDIMIASHIMYGQIILIBCFYAYDYJYKYGREICIHIAC', 'GNFBQCMBZBkBVCKDSDbDoDAEiECGFQAQHYIYCQGIMIKIBBDYIYCYEBLIIQHQJIDQBQKQMaGAGICBEYAYFBLIERCRGYCAFAHKEAIAJIDIBRKYCYEBIIIQHaAQEQFQGQMKCAKAHADAHYCRGYAAMYFALAJJIQCQHIBAIZJZLQAQFQGIMIKIBBDYCYJAIJCQDQBQHQKQMaFAGAAAEALAIJJQLYFRGIFAMIBAHYLYIAJJLQHKBQCAMYGYFAHILAJaIQHQFQGIMIBADAJYIZHQAREIKICBDIBRMYGYFAAIERKICIDBLYEYAYFRGIMIBBLYCRKYABEICILIBRMYGYFBEICILIDRKYAYCBEYFRGIMIBBDYLYEYCRAIEBLIDIBRMYGYFBCIAREIKIDBLYAYCYFRGIMIBBLYAYCYERKIABLIBRMYGYFBEICILIDRAY', 'GNADoDSBTBEDQDcDiDkDCEMEYErGFALAHZCRDQJQAJCAFALAHABAMaIQGQKQEQAJJACADAGZIAMKBQGZCRDQJQCAFJLAHAGABAMaIQKQEQAQFJJAEZKAIAMKBQGQHQEZCADAGJBAMaIQGJCQDRJQDAFZAAKAGAIAMKBQHQEQLQFZJACADAHJBAMaIQHJCQDRJQAZDAKAGAHAIAMKBQEQLQFQAZJACADAEJBAMaIQEJCQDRGZDAHAEAIAMKBQLQGZJQAJFAGALABAMaIQEQHQKQAJJACADAEZIAMKBQEZCRDQJQCAFJGALAEABAMaIQHQKQAQFJJACADAHZIAMKBQHZCRDQJQCAGJLAEAHABAMaIQKQAQFQGJJAAZKAIAMKBQHQEQAZCADAHJBAMaIQHJCQDRJQDAGZFAKAHAIAMKBQEQAQLQGZJACADAEJAQ',
  'GOBDjGDBEBFBTBACJCKCUDcDhDpDrGLYGQAYIQCYFBJYKYERDIFICIAIGAIABYMYNYERJICQAIHALABZKQJQFQAIJYEBIAKIBILINIMIGSHYIYAYCYFYDYDQAJCAEAFAJILILABAMANZKQMKBQLQLYFRCIIIHIGCBYFQCQLYIQAZDAEAJAMAKANJBQLQGQHQAZIAFYCRIIFCCYCAKZMQJQJYERDIIIFIFQAJCAGAHAJaIQKAMZEQDQAJCAFAKAMALKBANaLQBJJQLIMZKQCQFQAZDAEABIIAJIKIMINIGSHYAYCYFYIYDYEBKIKAMKFQIQAICAFYIYKYMYERDIAIIAKAMYEYDRAIKIIICICQFBMYFQIQAaIAKADAEAMKCQFQAQIQKaEAIAMYDQEIIIAIKIFBCYAQMYIQKIFICBAYMYIYDYDAERKIEAIAMKAQAI', 'HOADoGTBUBIDjDxDrEFFdFCGKGgGQHJQIQKJAJEALZCADAFAHAGJBQMQNQLQEQAZKZIAJAGJHQFQCQDQEKAQKZEAAKLANAFaHAGZJQIQEJAACADAHAMJFQNQLQKQAaEaIAEIJAGJBJFQMZHQCQDQEQAKKALANAMAFABZGZJQIQAJEACADAHAFKBAGaFQHQCQDQEQAZIAJAFJGKBQMQNQLQKQAaEACADAHAGAFZJQIQEJAKKALANAMAGaHQCQDQAQEZIAJAFJBJGQMQNQLQAaCADAHAMJGABZFZJQIQEJKJAALANAGAMZHQCQDQLJAQKZEZIAJAFJHQGKNQAQLZCADAGAHAFZJQIQEJCADAAKNAMABAFaHQGQAQCQDQEZIAAJGAHAFKBQMQNQLQKQEaCADAGAAZJAFJHQAQGQCQDQEKKALANAAaHAFZJQGJHAMJAQ', 'GLSCsDCBNBBCDCECbCYEcEoGEYCYABIIERCYAYFYHCJYDRBYGIHIFIAICIEBIYJYDYGSHIDCJIIIERCYAYFYDYHYGCJIDSBIFIAICIEBIYDYFSAIDCIIERCYDYAYFCIIDSCIEBDYIYFSAICIEIDCIYCSAYFCCIIIDSEYAYFYCCIIDIKIESAYDCIYCSFIDIAIECIYDSFYCCJYKYBYGSHICIFIDCJYCSHYGCBICIJIDSFYHYGYCCJIDIIIKIESAYFYHYDCJYCSGIDIHIFIAIECIYJYDSGYCCDIJIIIESAYFYHYGYCYDCJIIIJABAKJFSAIECFYIYKZBQJQJYDSCIGIHIAIEIFCIYJYDYCSGIDCJIIIFSEYAYHYDYGYCCJIDSHIAIEIFCIYDYJYCSGIHIAIDCJYCYKYBYGSHICCJIDSAYCYHYGCJICSAIDCCYAR', 'GPMBRCQBgBjBNCADCDEDIDKDSDkDsDaGBQEYLYMYNYFRAIKIKQHQIZAAAYFCMIOIEANYMQOQFQKQAQIJGJJALIBBDICRBYDCEYKYAQOYFQHJGQJJBACADAEANZMZOYARKILIEIDRGYHYJYIYFBAIAAMJNJCQOICIBSGYBAJYEBDICBNZMZAQOYAYFSHIFAIIEIDBKYLYABMJNJOICRKYLYERDIGIJIBBCYCANZMZOYAREIDRHYIYFBAIAAMJNJCQOICIBSGYBAHYJYIYEBDIKILICBNZMZAQOYAYFSEIEQIJDAAAHAGJBACAKYOYAYDSEYFBDIAIKICQOIBQGZHQIZEAAAFADAMJNJOICRKYLYAYERHIGIIIJIBBCYCANZMZDQOYDYFSHIFAIIABEYDBMJNJCQOICIBSGYJYAYLYAQIZEAHADAFAKJOIARGILIBBCYAY',
  'GOBDrGDBEBFBTBACJCKCUDcDgDpDiGGQAYMYBYNIIQCYFBJYKYERDIFICIAIGAIANYERJICQAIHALANZKQJQFQAIJYEBBIIAKILIMINIGSHYIYAYCYFYDYDQAJCAEAFAJILILANAMABZKQMKNQLQLYFRCIIIHIGCLYIQNYFQCQAZDAEAJAMAKABJNQLQGQHQAZIAFYCRIIFCCYCAKZMQJQJYERDIIIFIFQAJCAGAHAJaIQKAMZEQDQAJCAFAKAMALKNABaLQLIBINJJQMZKQCQFQAZDAEAIAKIMINIJIGSHYAYCYFYIYDYEBKIKAMKFQIQAICAFYIYKYMYERDIAIIAKAMYEYDRAIKIIICICQFBMYFQIQAaIAKADAEAMKCQFQAQIQKaEAIAMYDQEIIIAIKIFBCYAQMYIQKIFICBAYMYIYDYDAERKIEAIAMKJANZMQJKNABALaMQJQNJAQ', 'GNVBADFBKBgBjBRCIDpDLEkECGaGEBIYFYKYARMICQDQHILIBIEBGYDYDQHQBQFAIIGQEQLaCAJAMAKAIJDQFQHQMZCRJIBILIMIEIGCDYFYHYIYKYAYAAIJKQHJEQBYGQLYJYCBAIHIMIEIFBKYHQIYAQMQCQJQLKBABYLYCAEAMYABHIIIKIFRGIDCFYKYHYAQCQLIBIDAFBKYHYIZAQAYCSJIEIMIGIFIDRBYDAFAGAMaAACAIJHQERJYCBAIEIHAIZAQEQMKFQGQBIDAFYGYJYCYMYACEIEAHIIJKIFRDRBYDALYAAEAHIKIGRDIFCGYKYHYIYERMYCQCIJIDIFIGBKYHYIYEYCRMJAQDQFQLIBIBQLaAAJAMACAEAIJHQDQEYCYMYASJIAABIFALIGAKAHZIZCQCIEIDIIIHIKIGSFYBYFAGAHYIYEQMYAYCBEIIIHIGQFQLYJYCBEBIIIAHKDQKQMQBQBI', 'GOBCVCABFBQBZBaBjBkBECCDbDpDKEBQDQMYGQLYJQKJNALAGAHAMJFQFYASLYNYHCLIAAMYIYIAJRMIAQLYHQHIICLIAAMYJYHSDYBBHIJIMIAQLYISDYDAJBLIAAMYIQIIMIAQLYDSLINIACGYMYDQLQNQKZBAJALJDADYIYHYLYBSJIKINIDCGIARCIEBFBMYGQDRCIEIFBAYDYDQEQLYCQKZNAHBIIGIMIAQFQKYCALADIERFIABMYDQLQCQKIAAEYLYGBDILQMIEQAQKYCAGYDBLIMIFSGYDYHYIBLIMIDRGIAIECFYDYMYGQCQKIEAFBDYMYAQLQHQIQNQKJCACYKYNYICHIHALAMJAQCQGQKYNQIYHBNICIABGAMZLQNQHQIQKJAAGYNYHRIICIAIGCFIDBMYMALaHQNQAQCQKYIACIAIFIFAGRKYAAGANALJMQDQEQKYFANYARFIGIEIDBNYGRFYIYCBHBLIGQFRIYCYHBAI', 'GLFCQCCBdBhBUCDDiDAEqGRHDQAQFAGICIHIIIBBEYEAJZHQKQCQIQGaAADAFADYASGIFICIIIBIECKYDYCRFYACCIDIHIKIESBYGYIYFYDCCYARDICCJIKICQEIBSGYIYFYCYDYABDQKIFRGKIAIIBCEYFYJYHYKYASDICIGIIIFBEIIQGZDAAAHIJIBSFYECKYCRDYABCIDSEQIIEIFIBCJYHYKYDYCYASIIDBIAAACAHADQJKKQBQEQFQGZIZCBCIDIDBEJIRGJBAFAIAKAJaHQHIJIKIBSFYGYIYDYEBAYCSEIDIGIIIFIBCJYHYCQERDIABKYHBCZEREYDTAIAQGJIAHACAHYECDYAREIDCCIJJKIBSFYHYIYDYCBGYKIBIFSHYIYDYCYEYACKIDRHIIIFCBYDYKYASEICIGIHIIIDCBIHYFSDYIYCYEYGYACJIKIBIFIDTHYIYBCJYKYASEICIGIBIHIIIDDFYJYKYAYESCIAB',
  'HQrBDGCBGBNBUBsBTCWCdCADLD1DIEwGYICQBYEAGAMYIRDREILIHAAAMYJQDYERLIFAGALADAEAIAJAMJAQAIHSFYGBABHAMZAQGQIQEQJQDQLQLYEBDIJBMIHQFQLYJBAIGRFIHBMYAQJREYDBIBAIJRERLIHAGYFREYJBAYIRDRLIEAFALADAIAJAAAMJGQGIHSEYFBGBHAMZAQGQFQIQDQJQLQLYDBIBAIMIHQEQLYJBGIFREIHBMYGQJRDYIBABGIJRDRLIHAFYERDYJBGYARIRLIDAEALAIAAAJAGAMJFQFIHSDYEBFBHAMZAQFQEQGQIQJQLQLYIBABGIMIHQDQLYJBFIERDIHBMYFQAYGBFIMIAQHRDYEBAYJSLIDAHAJAMYFYGRIRLILAIAGAJAFAMJAQEQDIHBAYAAMZEQDQFQGQIQJQLQLYIBGBFIJRDIEBAIHRLYDBJBFYGRIRDIBIJAFAMIHQEYABFYJRLIEAHAJAMYGYIRDRLIAA', 'GODGqGMBhBNCYCBDIDKDZDbDiDkDRGGYAYEAKIJIDABYMQKQCQEQAIGIIIHIFCDYDQJZLABAMaKQCQKYERIIIQHKNALAJJDALYMYKYCQJILQNQHaAQGKHAAZIANJLAJZCAKIMIDQFQHYGZIAAJLAJABAMAMIDIFRJYKYCQBIDAKYLYAYNYEBCIMIMQBQNQJKLQAZJALKDABYFAKYLYMYCYERJIJQAKDANYCAMIKIFQDYAZIQGJHJDALZJZIQGQHJAAGaIACAIYEBMIMAKKBQNQJQJYCYLIDQAYHYEAMANJJQLQGQIZCACIGIIIDIFBBYJYMYNYERHIAIFAKYLYMYCQIJGAMALJJANZKABKNQJQDQJIFRAYGZHYIZCAEBKIKABANKJQBZJYKQLJMQIQGJDAFABYKYMYLYNYESCIGIHIAIFAIIDIMYDQGZIALAKABJMQDYFQAYHYCAKYLIKABANAJKMQDQMIFRGYGQAQHaIAAJGAKZLZCQIIHJGAKALZAQ', 'IUlBpCHBXBbByBzB0BaCoCmDrDuDAEKEFFQFCGcG1HOIIBLYAYKYMYDRSIAACQLIIROYABKYSYDAMILIEQSYDYCRPIAIOIRIICEYEAKYLZMZCQDQSJKAMALJEQGBHYTYCRDILIMIGIHBTYCYDRLIMIGIHIEIFCTYGRLYMYDBCIGITIFSEYHYLYMYGBTIHRLYMYGYDYCBTIHIFIERLYMYHBTYCRDIGIHILIMIECFYLYTYGRHIMIMQKQKISZDAHAMJLJEQEIISOYAYRYPYDCHIKISIEALYMYHQSIAROIIBLYAQSYHBKIMIAILIFBTYARKZMYCBGIAITIFRLYMYABGYCRAIMILIFBTYGYCYARKJMIGBTIFRLYGYKYMYHRSIDQGALIIROYGBKYSYHAMILIEQSYHYDRPIGIOIRIICEYEAKYLZMZDQHQSJKAMALJEQEIFCTYCYAYDRHIABCITIFSEYLYMYAYCBTIFIERLYMYAYCYHYDBTIARLIMIECFYAYTYDRHICILIMIABFIBI', 'HRdBFDABBBeBhBgCbDiDqDxDLENECGQGYGsHKIFQIYHQLQNQBaMAAAEAHJLQOJCQDQBZNAOALAHZAQEQMQNJBJCADAPAIAHZLQPJGBFYJYKYQYERAILIHIIIDSCIGBDYCSOYPYMYABLIHIIICIDIFBJYKYCRHYIYLYEBQICIJIKIFRDYHYIYCBQYERARMIOIPIGIDCFCJYFQKYQYEYARLICIHIIIFIDSGYOYPYCBLYABEIQIJIKIDRFYHYIYLYAYEBQIJIKIDIFRHYIYLYCRMYEBAICILIHIIIFBDYJYKYQYARERMIOIPIGIFCDCJYKYQYAYERCIABQIJIKIDSFSGYOYPYMYCBEBQIJIKIDIFRHYIYLYAYEYCRMIABLIHIIIFBDYJYKYQYCREILIHIIIFIDBJYKYQYCYERLIAROIPIGIDCFYHYIYAYLYEBCIQIJIKIFRDSGYOYPYMYEBCBQIARHIIIDIFBJYKYAYQYCRLIHIIIABJIKIFRDYAYHYIYLYERMIOIPIAC',
  'GNFBrGZBaBVCYCIDRDjDpDTEAGKGHYDALJGAHACAFAJABaIQIIBIFQJJCQDQHQHIMZFABYIYKAJAIABKCQDQFQHYJZKQMJHAFAJACADABaIQIIBIFQJYKQMQHKGQLZHAMAKAJIFABYIYIABKCQDQFQJQGQGIMZFAKAJJCADABaEQAQIQJQKQHQLKMAFAGACADAJaIABJJQIaKQHQGJCADAIIIAJABZJIFQKQIJCQDQMQLaAAEAGAHAIAKABKFQJQCQDQMQHaGQLJHAMACADAFAJABaEQAQKQIQGQMJFAJYDQGYMYAYECIIKIDIDQIZAQEQJILIHIMICAIYDABIFRCYCAFABYDQGYMYAAIJGQMQHQHICIFBGYJYLYEAIIDADYIYKYESAIAAHIMJDBGIJIFRCYDYHYLYAYMYECIIGIKIBIFQCQJIDRCIFCDYDQGZIZJYKABJJQIQIYKYERAIGIFQHILYHAMAKAIJJABZEQAQHILIFADABYIQJJGQCQKYMYAYEBIIBIDQFQJILYHYEAJAGKBAIaGQJQEQHILIFADAIYGZJQAR', 'HQGBoDSBmBACBCTCcDkDwDCEEEYEqEsEUGDAOINICSGYHYIYDYPYASLIKIGBCBNYOYARDIHIIICIGRKYLYDCPIABCAIYOINIGRCYHYAYPYDSLIKICBHYPIHAGAIANAJKBQGQMQIaHQHIPZAADAGAOAJJBKGQMQIQHaNABAJZOQAQPICRKYLYDBAINIPICICQGBBYJYOYARPYDSLIKIGBPICAIJMAJZBQIQCQGRKYLYPYDCPIABCAOIBIIIGRCYNYAYPYDSLIDAKICBPYAAOABJIQNQHKGAMAJAIaGQBZHYOQAQDQPJHAGABYNAOYDRAINIGIJIMIESFYCYHYKYLYPYACPIDBGAOIBIIIJJIABaJQGQJYOYDRPYASLIKICIPIHIFIECIYMYGYNYAYDBOIJIGQNQHQHIPZAADAGAOAJJBKGQIQMQHaNABAJZOQAQPICRKYLYDBAINIPICICQGBBYJYOYARPYDSLIKIGBPICABAJAIJMQBZCQGRKYLYPYDCPIABCAOIIIJIGRCYNYAYPYDSLIDAKICBPYAAOAIJJQNQHKBAGAMAJaGQNQHQBK', 'GNBDhDYBjBkBACFCKCdCDDbDLEoGHYKYLYECDIBIDAMJCQFQAYHRJYLYEYGYICDIBIKIMIHICICAFRLYHBBYMZDQDYISGIJIHAKYDCIYGSDIEIJIHIAILIFCCYBYKYMYHSEYDYJYGCIIHIBIKICIMIFSAYJYLYEYDYHCBIKIERLIFBMICQCYEYBYKYMYHSDIJIAIFACALIEBCIFSEYCBBYEAFAKYMYHYIYGSDIJIAILICIEIEQFBAYBYJYKYCRLYDYGCIIHICIBIKIMIFSAYEYJYLYDYHCCICQDRHQJIAILIEIFCBYKYDYMYCYCAHRLIDBCYHYIYGSJILIDICBBIDAHAKIMIFSAYEYCYDYDQHBBIKICRDYHYJYLYGCIIBIKIHRAIEAFAMYBQKQLQJQAJDADICCHYDSCICQAZJALAKABAMJFQEQHQEIFCHYDYBYKYMYIYGSLICIEIDBBYKYCRLYGCIICICQKJDQEQAQJZLAKACACYIYGSLIAIJIDBEYKYLQJJAAKAEIDRAYJYKYLYGCIICICQLQKJAQJZKALACACYIYGSKIJILIAIDBEYAQJQKZLAAJEIAYDRJYKYLYGCIICIBICQAQ', 'GLIBVCFBJDRDjDgEDFAGYGrGJJGAKaBQCQFQJQHQIKAADAEAGAGIJZARDYFAIYCABAKKJQFaHQEJDQFIIZEADKGAFAJAKaBQCQHQDQEQIKGADZGYEYCYDIIYBCHIFIJIKIARGREZDAEADZFBGJABGYJYKYHYBSCICABAHAKKJQAQGQDQFZIQEKFADAAAGAJAKaBQCQEIFJDAHQIZCZERFJFQDLIAIIABGYCYCQIQDaFAEABAHAKKJQGQAQDYFZEAIJCAGIARCZIZEQFJDJCAAADYGAJAKaBQHQEQEYIJDQFaIABBEAHAKKJQAQCQGQDQEZHAKAJKGQDQEQFQIaHADJGAJaKQBQDQHQIKCAFAEAGADZAAHQIQFKEAFYGADAJAKaBQHQIQFQEKGAEYIZBCHIDIIIAIJIKICTAYABCBDYJYKYHYBSIIGQEZFAIABAHAKKJQCQDQGQEQFZAQIAHADJBAGQEQFQIaHADAKAJKGQDZHQIKAACAFAEADAGAJaKQBQHQEKDAGAJAKaBQHQEQIQFKDAIZEABAHAKKJQCQAQDYFZEAGQIJAJCBGYARIZAAEQFJDJCAGAJAKaBQHQEQFQDJIAAAAIGICRIYIQDbFAFZEBAJ',
];

// ===== src/levelCodec.js =====
// レベルデータの詰め方。
//
// レベルは 1000 本あり、上のほうは 1 問 110 手を超える。素直に JSON で書くと
// 1 問 2〜3KB ―― 全部で 3MB になり、アプリ本体（200KB）の 15 倍という馬鹿げた
// 大きさになってしまう。ここでは 1 レベルを**1本の文字列**に潰す。
//
// 潰せる理由は、盤面に出てくるものが少ないから:
//   ・ブロックは全部長方形。幅も高さも 1〜3 マスなので、形は 9 通り = 1 文字
//   ・盤面は 8×8 まで。位置は 0〜63 なので、これも 1 文字
//   ・色つきは必ず 2 個で、必ず先頭。色を書く必要が無い（3個目以降は全部灰色）
//   ・1手は「どのブロックを・どの向きへ」だけ。滑る距離は盤面から決まるが、
//     読み直す手間を省いて一緒に入れてある（向き 4 通り × 距離 7 マス = 1 文字）
//
// これで 1 レベル 200〜250 文字。1000 本で 230KB ほどに収まる。
//
// 文字は 64 種類（1文字 = 6ビット）。URL に貼っても壊れない字だけを使う。

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const VALUE = new Map();
for (let i = 0; i < ALPHABET.length; i++) VALUE.set(ALPHABET[i], i);

/** 向きの並び。添字がそのまま符号になる */
const DIR_CODES = ['up', 'right', 'down', 'left'];

const ch = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 63) throw new Error(`符号化できない値: ${v}`);
  return ALPHABET[v];
};
const val = (c) => {
  const v = VALUE.get(c);
  if (v === undefined) throw new Error(`読めない文字: ${c}`);
  return v;
};

/**
 * パズル -> 1本の文字列。
 * @param {{size:number, pieces:{c:number, s:number[][]}[], solution:Array}} puzzle
 */
function encodeLevel(puzzle) {
  const { size, pieces, solution } = puzzle;
  if (size < 2 || size > 8) throw new Error(`盤面が符号化できません: ${size}`);
  let out = ch(size) + ch(pieces.length);
  for (const p of pieces) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of p.s) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w * h !== p.s.length) throw new Error('長方形でないブロックは符号化できません');
    if (w > 3 || h > 3) throw new Error(`大きすぎるブロック: ${w}x${h}`);
    out += ch(minY * 8 + minX) + ch((w - 1) * 3 + (h - 1));
  }
  for (const [pieceId, dir, distance] of solution) {
    const d = DIR_CODES.indexOf(dir);
    if (d < 0) throw new Error(`向きが不正: ${dir}`);
    if (distance < 1 || distance > 8) throw new Error(`滑る距離が不正: ${distance}`);
    out += ch(pieceId - 1) + ch(d * 8 + (distance - 1));
  }
  return out;
}

/**
 * 1本の文字列 -> パズル。
 * @returns {{size:number, cells:number, optimal:number,
 *            pieces:{c:number, s:number[][]}[], solution:Array}}
 */
function decodeLevel(code) {
  const size = val(code[0]);
  const count = val(code[1]);
  const pieces = [];
  let cells = 0;
  let at = 2;
  for (let k = 0; k < count; k++) {
    const p = val(code[at++]);
    const s = val(code[at++]);
    const x = p % 8;
    const y = (p - x) / 8;
    const w = Math.floor(s / 3) + 1;
    const h = (s % 3) + 1;
    const shape = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) shape.push([x + i, y + j]);
    cells += shape.length;
    // 色つきは必ず先頭の2個。3個目からは全部灰色
    pieces.push({ c: k < 2 ? 0 : BLOCKER, s: shape, w, h });
  }
  const solution = [];
  while (at < code.length) {
    const id = val(code[at++]) + 1;
    const m = val(code[at++]);
    solution.push([id, DIR_CODES[Math.floor(m / 8)], (m % 8) + 1]);
  }
  return { size, cells, optimal: solution.length, pieces, solution };
}

/** 符号だけから最短手数を読む（盤面を組み立てずに済ませたいとき用） */
function optimalOf(code) {
  const count = val(code[1]);
  return (code.length - 2 - count * 2) / 2;
}

/** 符号だけから盤面の一辺を読む */
function sizeOf(code) {
  return val(code[0]);
}

/** 符号だけから埋め率を読む */
function fillOf(code) {
  const count = val(code[1]);
  let cells = 0;
  for (let k = 0; k < count; k++) {
    const s = val(code[3 + k * 2]);
    cells += (Math.floor(s / 3) + 1) * ((s % 3) + 1);
  }
  const size = val(code[0]);
  return cells / (size * size);
}

// ===== src/levels.js =====
// レベル定義。
//
// レベル1から**上限なく**続く。同じレベルなら、どの端末でも必ず同じ譜面が出る
// （レベル番号 -> 焼いてあるデータ、という一本道になっている）。
//
// 盤面には「同じ色のブロックがちょうど2個」と、消えない灰色ブロックが置かれる。
// 勝ち筋はひとつだけ ―― 色つき2個を上下左右で触れさせること。触れた瞬間に
// 2個とも消え、盤面がクリアになる。
//
// 難しさは**最短手数そのもの**で測る。どのレベルも
//
//   「到達できる盤面を全部展開して、ゴールからちょうど N 手の配置」
//
// を選んで作ってある（tools/harvest.mjs + tools/levels.mjs）。N は推定ではなく
// 厳密な最短手数で、これより短く解く方法は存在しない。初期盤面から何を動かしても
// 消えないし、途中でも消えない ―― 最後の1手だけが消去になる。
//
// レベルが上がると N が伸びる。伸び方は下の PAR_ANCHORS で決めてある:
//
//   Lv1 → 2手 ／ Lv20 → 20手 ／ Lv50 → 40手 ／ Lv100 → 80手
//   Lv500 → 100手 ／ Lv800 → 122手 ／ Lv900 → 143手 ／ Lv950 → 162手
//   Lv985 → 210手 ／ Lv995 → 245手 ／ Lv1000 → 300手
//
// 前半は一気に、中盤はゆっくり、そして**最後の50レベルで跳ね上がる**。
//
// 最後を跳ねさせているのは、深い盤面の出方がそうなっているから。全探索で
// 「ゴールから300手」の盤面が出ることは実際にあるが、4コアを回して1時間に
// 2枚ほどしか採れない（110手級なら毎分2枚）。数百レベルぶんは揃わないが、
// 数十レベルぶんなら揃う ―― だから上端だけを切り立たせてある。
//
// この折れ線は**採れた深さの実測に合わせてある**。願望で引いても、そこに置く
// 盤面が無ければ意味がない ―― 上端の形は探索の当たり方がそのまま決めている。
//
// レベル975〜1000 は 192手から300手。1レベルごとに4手以上増えるので、
// この帯は**1レベル1枚の別々の盤面**で、同じ手数のレベルが並ぶことは無い。

/** 盤面の一辺の下限・上限。8×8 を超えると全探索が終わらないので作れない */
const MIN_SIZE = 4;
const MAX_SIZE = 8;

/** ブロックの一辺の下限・上限（色つきも灰色も同じ）。1×2 から 3×3 まで */
const MIN_BLOCK = 2;
const MAX_BLOCK = 3;

/**
 * レベル -> 目標の最短手数を決める折れ線。
 * ここを変えたら tools/levels.mjs を回し直してデータを作り直すこと。
 */
const PAR_ANCHORS = [
  [1, 2],
  [20, 20],
  [50, 40],
  [100, 80],
  [500, 100],
  [800, 122],
  [900, 143],
  [950, 162],
  [975, 192],
  [985, 210],
  [995, 245],
  [1000, 300],
];

/** 焼いてあるレベルの本数 */
const BAKED_LEVELS = LEVEL_CODES.length;

/**
 * 焼いたぶんを使い切ったあと、どこへ戻るか。
 * 先頭（レベル1）に戻すと難易度が一気に落ちて「終わった」感じになるので、
 * いちばん上の TAIL 本ぶんをぐるぐる回す ―― レベルは上限なく続き、
 * 手数もいちばん上の帯のまま保たれる。
 */
const TAIL_LEVELS = 200;

/** 手数の上限（＝いちばん上のレベルの手数） */
const MAX_PAR = PAR_ANCHORS[PAR_ANCHORS.length - 1][1];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * レベル -> 目標の最短手数。PAR_ANCHORS の折れ線を線形につないだもの。
 * 実際に焼けた手数は levelConfig(level).par で見ること（ぴったりとは限らない）。
 */
function targetPar(level) {
  const lv = normalizeLevel(level);
  const last = PAR_ANCHORS[PAR_ANCHORS.length - 1];
  if (lv >= last[0]) return last[1];
  for (let i = 1; i < PAR_ANCHORS.length; i++) {
    const [l0, p0] = PAR_ANCHORS[i - 1];
    const [l1, p1] = PAR_ANCHORS[i];
    if (lv <= l1) return Math.round(p0 + ((p1 - p0) * (lv - l0)) / (l1 - l0));
  }
  return last[1];
}

/**
 * レベル -> 焼いてあるデータの添字。
 * 焼いたぶんを超えたら、いちばん上の TAIL_LEVELS 本を順に繰り返す。
 */
function levelIndex(level) {
  const lv = normalizeLevel(level);
  if (lv <= BAKED_LEVELS) return lv - 1;
  const tail = Math.min(TAIL_LEVELS, BAKED_LEVELS);
  const base = BAKED_LEVELS - tail;
  return base + ((lv - BAKED_LEVELS - 1) % tail);
}

/** レベル -> 焼いてある符号 */
function levelCode(level) {
  return LEVEL_CODES[levelIndex(level)];
}

/** レベル -> 盤面データ（符号を展開したもの） */
function levelData(level) {
  return decodeLevel(levelCode(level));
}

/** レベル -> 厳密な最短手数 */
function parForLevel(level) {
  return optimalOf(levelCode(level));
}

/** レベル -> 盤面の一辺 */
function boardSizeForLevel(level) {
  return sizeOf(levelCode(level));
}

/** レベル -> 盤面の埋め率 */
function fillForLevel(level) {
  return fillOf(levelCode(level));
}

/** レベル -> 灰色ブロックの数（色つき2個を除いた残り全部） */
function blockersForLevel(level) {
  const code = levelCode(level);
  return decodeLevel(code).pieces.length - 2;
}

/** レベル -> 生成シード。譜面は焼いてあるので、今は表示・演出のゆらぎにだけ使う */
function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/**
 * 星の手数しきい値。
 *
 * 星は「何手で解いたか」で決まる。しきい値の基準になる par は**厳密な最短手数**
 * なので、★★★ は「最短で解いた」という、あいまいさのない達成になる ――
 * それより短い解き方は存在しないと分かっているので、上振れの余地がない。
 *
 *   ★★★ 最短ちょうど ／ ★★ silver 以内 ／ ★ クリア
 *
 * silver に少し余裕（+2）を足してあるのは、2手のレベルで1手ずれただけで
 * ★1 まで落ちるのを避けるため。短い問題ほど1手の重みが大きくなりすぎる。
 */
function targetMoves(par) {
  const gold = Math.max(1, Math.round(par));
  return {
    gold,
    silver: gold * 2,
  };
}

/** 解いた手数 -> 星（3/2/1） */
function starsForMoves(moves, targets) {
  if (moves <= targets.gold) return 3;
  if (moves <= targets.silver) return 2;
  return 1;
}

/** 秒 -> "M:SS"（1時間を超えたら "H:MM:SS"） */
function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** レベルの各種パラメータ（遊ぶ前でも出せる） */
function levelConfig(level) {
  const lv = normalizeLevel(level);
  const code = levelCode(lv);
  const par = optimalOf(code);
  const size = sizeOf(code);
  return {
    level: lv,
    /** 色の数。色つきは常に1組（2個）なので 1 */
    colors: 1,
    size: clamp(size, MIN_SIZE, MAX_SIZE),
    blockers: decodeLevel(code).pieces.length - 2,
    fill: fillOf(code),
    /** 厳密な最短手数。推定ではない */
    par,
    pieces: 2,
    /** 消えるまでに重ねるスライドの数（最後の1手が消去） */
    chainMoves: par - 1,
    setupMoves: 0,
    forced: false,
    attempts: 1,
  };
}

/** レベルの内容を一言で（見出しの下に出す補足）。遊ぶ前でも出せる */
function levelSummary(config) {
  return [
    `${config.size}×${config.size}`,
    `最短${config.par}手`,
    `灰${config.blockers}個`,
    `埋め率${Math.round(config.fill * 100)}%`,
  ].join('・');
}

/** 実際に生成できたパズルの要約（ゲーム画面の見出し下に出す） */
function puzzleSummary(puzzle) {
  const fill = puzzle.cells / (puzzle.size * puzzle.size);
  return [
    `${puzzle.size}×${puzzle.size}`,
    `最短${puzzle.par}手`,
    `灰${puzzle.blockers}個`,
    `埋め率${Math.round(fill * 100)}%`,
  ].join('・');
}

// ===== src/generator.js =====
// レベル番号 -> 盤面。
//
// 盤面はその場で作らない。tools/harvest.mjs が事前に全探索して焼いたものを
// src/levelData.js から取り出し、Board に組み直すだけ。
//
// 昔はここで「解の逆順構築」―― 完成状態から1手ずつ巻き戻してブロックを置く ――
// をやっていた。手軽だが、保証できるのは「解ける手順がひとつある」ことだけで、
// 本当の最短手数は分からない。実測すると PAR 106手と表示していた盤面が20手で
// 解けていた。表示していた手数が嘘だったので、作り方ごと捨てた。
//
// いまは src/exact.js が「到達できる盤面を全部展開して、ゴールからちょうど N 手の
// 配置」を選んでいる。N は推定ではなく**厳密な最短手数**で、近道は原理的に無い。
//
// ここに残っているのは、焼いたデータを組み立てる関数と、それを検算する関数だけ。

/**
 * 「いま1手で消せる色」の集合。
 *
 * 盤面には同じ色がちょうど2個ずつしかないので、消える条件は「その2個が触れる」
 * だけで決まる。したがって「消せる色が1つしかない＝次の一手が実質1通り」になる。
 */
function clearableColors(board, limit = Infinity) {
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
function colorClearable(board, color) {
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
 * 解の道筋を調べる。
 *   clearAtStart : 初期盤面に「消せる手」がいくつあるか（0 が狙い）
 *   forced       : どの局面でも「消せる手」の結果が実質1通りしかないか
 *   dryStreak    : 何も消えない手が最大で何手続くか（＝読みの深さ）
 *   blindMoves   : 「消せる色がひとつも無い」局面が何回あるか
 */
function analyzeSolution(snapshot, solution, size) {
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

/**
 * レベル番号 -> 焼いてあるパズル。
 *
 * ブロックはデータの順に入れる。id が採集時と同じ並びになるので、
 * 一緒に焼いてある手順（ブロックid・向き・滑るマス数）がそのまま使える。
 */
function levelPuzzle(level) {
  const lv = normalizeLevel(level);
  const data = levelData(lv);
  const board = new Board(data.size);
  for (const p of data.pieces) board.addPiece(p.c, p.s, `${p.w}x${p.h}`);

  const snapshot = board.snapshot();
  const solution = data.solution.map(([pieceId, dir, distance], i) => ({
    pieceId,
    dir,
    distance,
    color: board.pieces.get(pieceId).color,
    // 色つきは1組しかないので、消えるのは必ずいちばん最後の1手
    kind: i === data.solution.length - 1 ? 'clear' : 'chain',
  }));

  const colors = new Set();
  let blockers = 0;
  for (const piece of board.pieces.values()) {
    if (piece.color === BLOCKER) blockers++;
    else colors.add(piece.color);
  }

  return {
    seed: lv,
    snapshot,
    solution,
    par: solution.length,
    cells: board.filledCells,
    pieces: board.pieceCount,
    size: data.size,
    colors: colors.size,
    blockers,
    chainMoves: solution.length - 1,
    setupMoves: 0,
    /** 厳密な最短手数（これより短い解き方は存在しない） */
    optimal: data.optimal,
    analysis: analyzeSolution(snapshot, solution, data.size),
    level: lv,
    config: levelConfig(lv),
  };
}

/** レベル番号からパズルを作る */
function generateLevel(level) {
  return levelPuzzle(level);
}

/** generateLevel の非同期版（画面を固めないための形だけ合わせてある） */
async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  if (onProgress) onProgress(1);
  return levelPuzzle(level);
}

/**
 * 盤面と手順を突き合わせて検算する。
 * 「その手順どおりに指せば、本当に、ちょうどそこで全部消えるか」を確かめる。
 */
function verifySolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }
  for (const p of board.pieces.values()) {
    if (p.cells.length < 2 || p.cells.length > 9) {
      return { ok: false, reason: `${p.cells.length}マスのブロックがある（2〜9マスであるべき）` };
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
    // 消えるのは 'clear' の手だけ。それ以外の手では何も消えてはいけない
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

// ===== src/color.js =====
// 色の小道具。render.js と materials.js の両方が使う。
//
// 切り出してあるのは、ビルドが src/ を 1 つのスコープに連結するから ――
// 同じ名前の関数を 2 つのファイルに置くと、そこで衝突してビルドが止まる。

/** 直線補間 */
function mix(a, b, t) {
  return a + (b - a) * t;
}

/** 下限と上限で挟む。ここの中だけで使う */
function clip(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/** HSL -> [r,g,b]（0..255）。h は度、s と l は % */
function hslRgb(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v);
  };
  return [f(0), f(8), f(4)];
}

/** [r,g,b] -> "#rrggbb" */
function rgbHex(rgb) {
  return `#${rgb.map((v) => clip(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** "#rrggbb" -> [r,g,b] */
function hexRgb(hex) {
  const s = String(hex).replace('#', '');
  const n = s.length === 3
    ? s.split('').map((c) => c + c).join('')
    : s.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
}

/** [r,g,b] -> [h,s,l]（rgbHsl の逆算。色相をずらすために要る） */
function rgbHsl(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

/**
 * 明るくする / 暗くする。amount > 0 で白へ、< 0 で黒へ。
 * 単純な乗算ではなく端へ寄せるので、暗い色を明るくしても濁らない。
 */
function shade(hex, amount) {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return rgbHex(hexRgb(hex).map((v) => mix(v, target, clip(k, 0, 1))));
}

/** 色に不透明度を付けて rgba() にする */
function rgba(hex, alpha) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${clip(alpha, 0, 1)})`;
}

/**
 * 素材の地の色を、進行度の色相へ引っぱる。
 *
 * 木を真っ青にしてしまうと木に見えなくなるので、引っぱる強さは素材ごとに変える
 * （ガラスはほぼ言いなり、木はほんの少し）。明るさは素材の側を保つ ――
 * 明るさまで持っていかれると、灰色ブロックとの区別が付かなくなる。
 */
function tintTowards(baseHex, tintHex, strength) {
  const k = clip(strength, 0, 1);
  if (k <= 0) return baseHex;
  const base = hexRgb(baseHex);
  const [, , baseL] = rgbHsl(base);
  const [tintH, tintS] = rgbHsl(hexRgb(tintHex));

  // 行き先は「進行度の色相と彩度を、素材の明るさで鳴らした色」
  let target = hslRgb(tintH, tintS, baseL);

  /*
   * 明るさは HSL の L ではなく、**目に見える明るさ**で合わせ直す。
   *
   * HSL の L は色相をまったく見ていない。同じ L=50% でも黄色は白に近く、
   * 青は闇に近い。L だけ揃えると、進行度が琥珀を通るときにだけ色つきブロックが
   * 明るくなり、灰色ブロックと見分けが付かなくなる（実際そうなった）。
   * 見た目の明るさを揃えておけば、色相がどこへ動いても明暗差は保たれる。
   */
  const want = lumaRgb(base);
  const got = lumaRgb(target);
  if (got > 1) {
    const f = want / got;
    target = target.map((v) => clip(v * f, 0, 255));
  }

  // 混ぜるのは RGB 空間で。色相を回して混ぜると、橙から藍へ行くときに
  // 近いほうの回り道が赤側を通り、木材がピンクになる（実際にそうなった）。
  // RGB で混ぜれば途中は必ず「彩度の落ちた中間色」を通る
  return rgbHex([0, 1, 2].map((i) => mix(base[i], target[i], k)));
}

/** [r,g,b] の見た目の明るさ */
function lumaRgb(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** 見た目の明るさ（0..255）。文字や縁の色を決めるのに使う */
function luma(hex) {
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ===== src/materials.js =====
// ブロックの見た目（デザイン）。
//
// 2 つだけある。
//
//   プレーン ―― 色だけの平らな面。既定。
//   クリスタル ―― 実機で撮ったガラスの写真を、そのまま貼ったもの。
//
// 昔はここに手続きで描いた素材（石・木・金属・紙・布・描いたガラス）が並んでいた。
// ノイズから「高さの場」を作り、その傾きから陰影を計算する（バンプマッピング）
// やり方で、拡大すれば見事に見える。だが**1 マスが 40px そこそこになると、
// 模様がブロックの輪郭と同じ細かさになり、形が模様に埋もれて読めなくなる**。
// 盤面を読むゲームでそれは致命的で、結局どれも「薄く敷く」ところへ落ち着いた ――
// 薄く敷いた石と薄く敷いた紙は、遊んでいるあいだ見分けが付かない。
//
// 残したのは、**役割がはっきり違う 2 つ**だけ。いちばん読みやすい平らな面と、
// 描いて真似るのをやめて本物を貼ったガラス。
//
// ここが持つのは「表面」だけ。立体の組み立ては render.js の経路が受け持ち、
// デザインはその経路に寸法と色を**マスの一辺に対する比**で渡す。

// ---------------------------------------------------------------- デザインの定義

/**
 * デザインひとつ。寸法はすべて**セルの一辺に対する比**で持つ ――
 * 盤面が 4×4 でも 8×8 でも、ブロックの厚みと角の落としが同じ割合で見えるように。
 */
const DEFS = [
  {
    key: 'plain',
    name: 'プレーン',
    note: '色だけの平らな面',
    /*
     * 何も乗せない、元からの見た目。
     *
     * **いちばん読みやすいのはこれ。** 厚みも面取りも影も持たず、
     * 一色のベタ塗りに髪の毛ほどのすき間だけ。目が拾うものが「色と形」しか
     * 無いので、どのブロックがどこまでかが一瞬で分かる ―― 盤面を速く読みたい
     * ときのために、いつでもここへ戻れるようにしてある。
     *
     * flat が立っているデザインは、影も写真も通らない ―― 薄くするのではなく、
     * そもそも通らない。
     */
    flat: true,
    depth: 0,
    radius: 0.14,
    gap: 0.032,
    tint: 1,
    shadow: 0,
    /** 進行度の色を混ぜず、そのまま使う（元の見た目がそうだった） */
    rawTint: true,
    colors: {
      grey: { top: '#c4c4cb', mid: '#9a9aa2', deep: '#5f5f68', side: '#6e6e78' },
      lit: { top: '#7f97e6', mid: '#3e47cc', deep: '#2a2f8c', side: '#333a9f' },
    },
  },
  {
    key: 'crystal',
    name: 'クリスタル',
    note: '写真から切り出した本物のガラス',
    /*
     * **ここだけは、模様を描いていない。**
     *
     * ガラスは「表面の凹凸」ではなく、**中を通ってきた光**でできている ――
     * 面取りの向こう側が透けて重なり、角では全反射して白く跳ね返る。
     * 高さの場から陰影を計算するやり方は表面しか作れないので、どれだけ手を
     * 入れても「ガラスに似せた石」より先へ行けなかった。
     *
     * そこで、実機で撮ったブロックの写真をそのまま貼っている
     * （art/crystal/*.png、切り出しは tools/photoArt.mjs）。
     * 写真は 1 マス 160px の無色（グレースケール）で、貼るときに
     * 9 分割で任意の大きさへ伸ばす ―― 角と縁は伸ばさず中央だけを伸ばすので、
     * 何マスのブロックでも面取りの太さが変わらない。だから全部のレベルに効く。
     *
     * 色は貼ってから被せる（進行度の色相を 'color' で重ねる）。
     * こうすると陰影は写真のまま、色だけが手数に合わせて動く。
     */
    photo: true,
    /** 灰色ブロックに被せる色。写真のガラスがわずかに帯びている青みそのもの */
    photoTint: '#797986',
    depth: 0.025,      // 側面はほとんど見えない。落ち影のぶんだけ持たせる
    radius: 0,
    /*
     * 角の落とし。**1 マスぶんの短辺に対する割合**で持つ（マスそのものではない）
     * ―― 写真の角は「1 マスあたり何画素」で決まっているので、こう持たないと
     * 2 マスのブロックだけ切り口が深くなる。値は写真から実測した
     * PHOTO_CHAMFER より気持ち浅くしてある。深いほうへ外すと角の切子を
     * ガラスごと削り、浅いほうへ外しても埋めた画素が少し残るだけで済む。
     */
    chamfer: 0.09,
    /*
     * 目地。**tools/photoArt.mjs の PHOTO_GAP と一致していなければならない**
     * （テストで縛ってある）―― ずれると、切り出しに巻き込んだ影がブロックの
     * 内側へ入り込むか、逆に縁が目地へはみ出す。
     *
     * 写真を撮った盤面の実測は片側 4.1%（外周どうしが 15px、1 マスが 182px）だが、
     * そこからほんの少し詰めてある。ブロックが 1 回り大きくなり、白い台の上でも
     * 隙間だらけに見えない ―― 広いと「外側が無くなっている」ように見えた。
     */
    gap: 0.0292,
    tint: 0.86,        // 色の濃さ。1 まで上げるとガラスではなく塗った板に見える
    shadow: 0.3,
    colors: {
      // 写真から拾った代表色。演出（破片・光の輪）と落ち影に使う
      grey: { top: '#e2e4ea', mid: '#b3b6be', deep: '#70747c', side: '#8c9099' },
      lit: { top: '#d8f2ff', mid: '#6ec8ee', deep: '#175f85', side: '#3d95c4' },
    },
  },
];

/** デザインの並び（設定画面もこの順で出す） */
const MATERIAL_KEYS = DEFS.map((d) => d.key);

/**
 * 何も選んでいないときのデザイン。
 *
 * **初めて開いた人が最初に見るのはクリスタル。** 読みやすさだけならプレーンが
 * 勝つが、それは「速く読む」ための道具で、初めての画面が伝えるべきものではない。
 * 写真のガラスは触りたくなるし、盤面が何でできているかも一目で分かる。
 * 読みやすさが要るときは設定でいつでもプレーンへ戻せる。
 */
const DEFAULT_MATERIAL = 'crystal';

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/**
 * デザインを引く。知らない名前なら既定のデザイン。
 * 廃止したデザイン（石・木・金属・紙・布・ガラス）を選んだまま残っている
 * 端末も、ここで黙ってプレーンへ落ちる ―― 設定が古いだけで遊べなくはならない。
 */
function materialFor(key) {
  return BY_KEY.get(key) || BY_KEY.get(DEFAULT_MATERIAL);
}

/** 設定画面に並べるための一覧 */
function materialList() {
  return DEFS.map((d) => ({ key: d.key, name: d.name, note: d.note, swatch: d.colors.lit.mid }));
}

// ---------------------------------------------------------------- 色

/**
 * ブロックの色を決める。
 *
 * 灰色ブロックはデザインそのままの色。色つきブロックは、明るいほうの地を
 * 進行度の色相へ引っぱる。
 */
function paletteFor(mat, isColored, tintHex) {
  const src = isColored ? mat.colors.lit : mat.colors.grey;
  if (!isColored || !tintHex) return { ...src, key: `${mat.key}|grey` };
  /*
   * プレーンだけは混ぜない。混ぜると明るさがデザインの側に引き戻されて、
   * 琥珀まで進んでも青のままの明るさになってしまう ―― 何も乗っていない面では、
   * 進行度の色そのものが見えるのが正しい。
   */
  if (mat.rawTint) {
    return {
      top: shade(tintHex, 0.24),
      mid: tintHex,
      deep: shade(tintHex, -0.3),
      side: shade(tintHex, -0.24),
      key: `${mat.key}|${tintHex}`,
    };
  }
  const k = mat.tint;
  return {
    top: tintTowards(src.top, tintHex, k * 0.9),
    mid: tintTowards(src.mid, tintHex, k),
    deep: tintTowards(src.deep, tintHex, k),
    side: tintTowards(src.side, tintHex, k),
    key: `${mat.key}|${tintHex}`,
  };
}

// ===== src/photoArt.js =====
// クリスタルの写真。tools/photoArt.mjs が art/crystal/*.png から生成。直接編集しないこと。
//
// **なぜ画像を JS に埋めているか。** 別ファイルで配ると、Service Worker が
// 先読みする一覧に足す必要があり、足し忘れると「機内モードで素材を切り替えたら
// ブロックが消える」という直しにくい壊れ方をする。app.js に混ぜてあれば、
// app.js のハッシュが変わり、先読みも版ずれの心配もまとめて片づく。
//
// 中身は無色（グレースケール）。色は貼るときに被せる ―― そうすれば
// 進行度で色が変わっても、ガラスの陰影はそのまま残る。

const PHOTO_UNIT = 160;

/**
 * 写真の角の落とし（1 マスぶんの短辺に対する割合）。切り抜きをこれより
 * 深くすると、角の切子をガラスごと削ってしまう。
 */
const PHOTO_CHAMFER = 0.0946;

/**
 * 切り出しの内寄せ（マスの一辺に対する割合）。**貼るときの目地と
 * 一致していなければならない** ―― ずれると、巻き込んだ影がブロックの
 * 内側に入り込むか、逆に縁が目地へはみ出す。
 */
const PHOTO_GAP = 0.0292;

/** 写真 1 枚ぶん。cols/rows はもとのブロックが何マスだったか */
const PHOTOS = [
  { cols: 1, rows: 1, src: 'data:image/png;base64,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' },
  { cols: 1, rows: 2, src: 'data:image/png;base64,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' },
  { cols: 2, rows: 1, src: 'data:image/png;base64,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' },
  { cols: 2, rows: 2, src: 'data:image/png;base64,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' },
];

/** 読み込み済みの画像。読めるまでは null（そのあいだは無地で描く） */
const loaded = PHOTOS.map(() => null);
let pending = 0;
let onReady = null;

/**
 * 写真を読み込む。データ URI なので通信は起きないが、復号は非同期なので、
 * 読み終わったところで一度だけ知らせる（焼いてある絵を捨てさせるため）。
 */
function loadPhotos(done) {
  onReady = done;
  if (typeof Image === 'undefined') return;
  if (pending || loaded.some((v) => v)) return;
  pending = PHOTOS.length;
  PHOTOS.forEach((p, i) => {
    const im = new Image();
    im.onload = () => {
      loaded[i] = im;
      pending--;
      if (!pending && onReady) onReady();
    };
    im.onerror = () => {
      pending--;
      if (!pending && onReady) onReady();
    };
    im.src = p.src;
  });
}

/**
 * cols×rows のブロックに貼る写真を選ぶ。
 *
 * 縦横の比がいちばん近いものを採り、比が同じなら大きいほうを採る ――
 * 引き伸ばすのは中央だけ（9 分割）なので、比さえ合っていれば
 * 面取りの太さは崩れない。写真の無い形は、いちばん近い形から作られる。
 */
function photoFor(cols, rows) {
  const want = Math.log(cols / rows);
  let best = -1;
  let score = Infinity;
  for (let i = 0; i < PHOTOS.length; i++) {
    if (!loaded[i]) continue;
    const p = PHOTOS[i];
    const d = Math.abs(Math.log(p.cols / p.rows) - want) * 8
      + Math.abs(Math.log((p.cols * p.rows) / (cols * rows)));
    if (d < score) { score = d; best = i; }
  }
  return best < 0 ? null : loaded[best];
}

/** 写真がまだ 1 枚も読めていない（＝無地で描くしかない） */
function photosReady() {
  return loaded.some((v) => v);
}

// ===== src/render.js =====
// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックの描き方はデザイン（src/materials.js）ごとに 2 通りしかない ――
// プレーンは輪郭を 1 回塗るだけ、クリスタルは接地影を敷いて写真を 9 分割で貼る。
// デザインはこの経路に寸法と色を渡すだけで、立体の作りそのものは分岐しない。
//
// 速さについて。**ブロック 1 個の絵はオフスクリーンに焼いて使い回す。**
// 同じ形・同じ色のブロックは 1 枚を共有するので、盤上に 20 個あっても
// 焼くのは数枚で済む。毎フレームやるのは、その絵を貼ることだけ。
// 影のぼかしや写真の 9 分割を毎フレーム描くと、それだけで 60fps が出ない。

/** オフスクリーンのキャンバス。OffscreenCanvas が無い環境でも動くようにする */
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.ceil(w), Math.ceil(h));
  return null;
}

/*
 * 無色（グレースケール）の写真を、色で染める。
 *
 * **合成の混ぜ方（globalCompositeOperation = 'color'）には頼らない。**
 * あれは仕様にはあるが「分離しない混ぜ方」で、実装によっては効かない ――
 * 実際、Android のある端末では色つきブロックにだけ色が乗らなかった
 * （灰色ブロックは無彩色を被せているので、効かなくても見た目が変わらず、
 * 色つきブロックだけが白いガラスのまま残る、という出方をしていた）。
 *
 * そこで画素を自分で解く。やっていることは 'color' の定義そのもの ――
 * 「色相と彩度は塗った色、明るさは下のまま」（仕様の SetLum）。
 * どの端末でも同じ絵になり、iOS でのいまの見え方も変わらない。
 */

/** 合成の仕様が使う明るさ。sRGB の luma とは係数が違うので、別に持つ */
const blendLum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** 仕様の ClipColor。範囲から出た成分を、明るさを保ったまま引き戻す */
function clipColor(c) {
  const l = blendLum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n);
  if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l);
  return c;
}

/**
 * 画素をその場で染める（RGBA が並んだ配列を書き換える）。
 *
 * 透明度には触らない。触ると、写真の縁の半端な画素まで色が伸びて、
 * ブロックの外へ色がにじむ。
 *
 * @param {Uint8ClampedArray} data getImageData().data
 * @param {string} tintHex 被せる色
 * @param {number} strength 0..1。1 まで上げると、ガラスではなく塗った板に見える
 */
function colorizePixels(data, tintHex, strength) {
  const k = Math.max(0, Math.min(1, strength));
  if (k <= 0) return data;
  const [tr, tg, tb] = hexRgb(tintHex).map((v) => v / 255);
  const tl = blendLum(tr, tg, tb);
  /*
   * 行き先を明るさ 256 段ぶん先に作っておく。
   * 下は無彩色なので、行き先は**明るさだけ**で決まる ―― 1 画素ずつ解いても
   * 同じ答えになるし、こうすると 1 画素あたり足し算 3 回で済む。
   */
  const lut = new Uint8ClampedArray(768);
  for (let i = 0; i < 256; i++) {
    const d = i / 255 - tl;
    const c = clipColor([tr + d, tg + d, tb + d]);
    lut[i * 3] = c[0] * 255;
    lut[i * 3 + 1] = c[1] * 255;
    lut[i * 3 + 2] = c[2] * 255;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // 透明な画素は触らない（色がにじむ）
    const o = Math.round(blendLum(data[i], data[i + 1], data[i + 2])) * 3;
    data[i] = mix(data[i], lut[o], k);
    data[i + 1] = mix(data[i + 1], lut[o + 1], k);
    data[i + 2] = mix(data[i + 2], lut[o + 2], k);
  }
  return data;
}

/** roundRect は Safari 16.4 未満に無い。無ければ自前で足す */
function installRoundRect() {
  if (typeof CanvasRenderingContext2D === 'undefined') return;
  const impl = function roundRect(x, y, w, h, r) {
    let rr = r;
    if (typeof rr === 'number') rr = [rr, rr, rr, rr];
    else if (!Array.isArray(rr)) rr = [0, 0, 0, 0];
    else if (rr.length === 1) rr = [rr[0], rr[0], rr[0], rr[0]];
    else if (rr.length === 2) rr = [rr[0], rr[1], rr[0], rr[1]];
    else if (rr.length === 3) rr = [rr[0], rr[1], rr[2], rr[1]];
    const max = Math.min(Math.abs(w), Math.abs(h)) / 2;
    const [tl, tr, br, bl] = rr.map((v) => Math.min(Math.max(Number(v) || 0, 0), max));
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    this.arcTo(x + w, y, x + w, y + tr, tr);
    this.lineTo(x + w, y + h - br);
    this.arcTo(x + w, y + h, x + w - br, y + h, br);
    this.lineTo(x + bl, y + h);
    this.arcTo(x, y + h, x, y + h - bl, bl);
    this.lineTo(x, y + tl);
    this.arcTo(x, y, x + tl, y, tl);
    return this;
  };
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = impl;
  }
  if (typeof Path2D !== 'undefined' && !Path2D.prototype.roundRect) {
    Path2D.prototype.roundRect = impl;
  }
}
installRoundRect();

// ---------------------------------------------------------------- 色

/**
 * 色は何色でも作れる。レベルが上がれば色数はいくらでも増えるので、
 * 手で選んだ一覧ではなく「隣り合う番号どうしがいちばん離れて見える色相の並び」
 * から手続き的に組み立てる。一覧を使い切ったら色相をずらし、
 * 明度も段ごとに変えるので、同じ色相が戻ってきても別の色として読める。
 */
/*
 * 色相の並び。「先頭から N 個取っても互いに離れている」ように並べてある
 * （すでに選んだどれからも遠いものを順に選ぶ貪欲順）。レベルによって使う色数が
 * 3〜12 と変わるので、どこで切っても見分けがつくことが要る。
 *
 * 並べ替えの物差しは色相の角度ではなく **Lab 空間での距離（ΔE）**。色相を等間隔に
 * 並べても、緑は 90°〜160° がまとめて「緑」に見えるのに対し、赤〜橙は数十度でも
 * 別の色に見える ―― 角度で揃えると緑ばかりが並んで見分けられなくなる。
 *
 * 12色での最小 ΔE: 素直な並びで 15、色相角で並べ替えても 15、この並びで 31。
 */
const HUES = [190, 4, 272, 118, 46, 330, 210, 168, 78, 228, 26, 308, 142, 348, 200, 64, 96, 288, 14, 258];

/** 色相ごとの見た目の明るさ補正（黄～緑は明るく見えるので少し暗く置く） */
function toneFor(hue) {
  const yellowness = Math.max(0, Math.cos(((hue - 55) * Math.PI) / 180));
  return 1 - yellowness * 0.16;
}

function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v);
  };
  return [f(0), f(8), f(4)];
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const paletteCache = [];

/**
 * 色番号 -> 色。番号はいくつでもよい（無制限）。
 * base=ブロックの色 / light=明るめ / dark=文字などに使う濃いめ / shadow="r,g,b"
 */
/** 灰色ブロックの見た目。どの色とも消えないので、彩度を持たせない */
const BLOCKER_COLOR = {
  name: '灰色（消えないブロック）',
  base: '#9a9aa2',
  light: '#c4c4cb',
  dark: '#5f5f68',
  shadow: '110,110,120',
};

function colorFor(index) {
  if (index === -9) return BLOCKER_COLOR; // board.js の BLOCKER
  const i = Math.max(0, Math.floor(index) || 0);
  if (paletteCache[i]) return paletteCache[i];

  const lap = Math.floor(i / HUES.length);
  const hue = (HUES[i % HUES.length] + lap * 23) % 360;
  const tone = toneFor(hue);
  // 周回ごとに明るさを振って、同じ色相帯でも別の色として見えるようにする
  const shift = [0, 10, -8, 18][lap % 4];
  const sat = 68 - (lap % 3) * 7;
  const light = Math.max(30, Math.min(72, 55 * tone + shift));

  const c = {
    name: `色${i + 1}`,
    base: hex(hsl(hue, sat, light)),
    light: hex(hsl(hue, sat, Math.min(88, light + 13))),
    dark: hex(hsl(hue, Math.min(90, sat + 10), Math.max(20, light - 22))),
    shadow: hsl(hue, Math.min(90, sat + 10), Math.max(16, light - 30)).join(','),
  };
  paletteCache[i] = c;
  return c;
}

// ---------------------------------------------------------------- 進行度の色
//
// 色つきブロックは盤面に1組しかないので、その色を**進行度そのもの**に使える。
// 遠いうちは冷たい藍、近づくにつれて青緑 → 緑 → 琥珀 → 朱へ。
// 盤面と背景も同じ色相をごく薄めて追いかけるので、
// 「解に近づくほど画面全体があたたまっていく」ように見える。
//
// 数字で「あと何手」と出すより、こちらのほうが手を止めない ――
// 見ていなくても視野の端で温度が変わる。

/** 進行度 0 → 1 の色の道すじ（HSL） */
const PROGRESS_STOPS = [
  { h: 236, s: 58, l: 52 }, // 0.00 藍
  { h: 202, s: 66, l: 47 }, // 0.28 青
  { h: 158, s: 56, l: 41 }, // 0.55 翡翠
  { h: 40, s: 84, l: 49 },  // 0.80 琥珀
  { h: 10, s: 76, l: 53 },  // 1.00 朱
];
const PROGRESS_AT = [0, 0.28, 0.55, 0.8, 1];

const lerp = mix;

/** 進行度 t（0..1）の HSL を求める。色相は近いほうへ回して濁りを避ける */
function progressHsl(t) {
  const p = Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < PROGRESS_AT.length - 1 && p > PROGRESS_AT[i]) i++;
  const a = PROGRESS_STOPS[i - 1];
  const b = PROGRESS_STOPS[i];
  const span = PROGRESS_AT[i] - PROGRESS_AT[i - 1];
  const k = span > 0 ? (p - PROGRESS_AT[i - 1]) / span : 0;
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  return { h: (a.h + dh * k + 360) % 360, s: lerp(a.s, b.s, k), l: lerp(a.l, b.l, k) };
}

/** 進行度 -> 色つきブロックの色。colorFor と同じ形を返す */
function progressColor(t) {
  const { h, s, l } = progressHsl(t);
  return {
    name: '色つきブロック',
    base: hex(hsl(h, s, l)),
    light: hex(hsl(h, s, Math.min(88, l + 14))),
    dark: hex(hsl(h, Math.min(90, s + 10), Math.max(20, l - 22))),
    shadow: hsl(h, Math.min(90, s + 10), Math.max(16, l - 30)).join(','),
  };
}

/**
 * 進行度 -> 画面の後ろに敷く色（CSS へ渡す）。
 *
 * デザインの地（baseHex）を渡すと、**色つきブロックとまったく同じ色**を薄めて返す ――
 * 背景だけが blocks と違う色だと、2 つの色が画面で喧嘩する。
 * 渡さなければ進行度の色そのもの。
 *
 * ここは段に丸めない。ブロックの色は手数の目盛りとして段で動くが、
 * 背景まで段で動くと、1 手ごとに画面全体がカクッと変わって落ち着かない。
 */
function auraFor(t, baseHex = null, strength = 1, alpha = 0.22) {
  const hue = progressColor(t).base;
  return rgba(baseHex ? tintTowards(baseHex, hue, strength) : hue, alpha);
}

/** 色覚サポート用の記号。色数が増えても足りるよう繰り返して使う */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '▼', '⬢', '♦', '☰'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** 背景の新しい色が画面の下から上まで満ちるのにかける秒数 */
const AURA_SWEEP = 1.1;
/** 新旧の色の境目をぼかす幅（画面の高さに対する %）。硬い線が横切らないように */
const AURA_FEATHER = 26;

/**
 * 角を 45° で切り落とした矩形を path に足す（エメラルドカット）。
 * 落とすのは**外側の角だけ** ―― 同じブロックの隣と接している角を落とすと、
 * 塊の途中に切り欠きができて 1 個に見えなくなる。
 */
function chamferRect(path, p, cut) {
  const { px, py, pw, ph, up, down, left, right } = p;
  const x1 = px + pw;
  const y1 = py + ph;
  const c = Math.min(cut, pw / 2, ph / 2);
  const tl = (!up && !left) ? c : 0;
  const tr = (!up && !right) ? c : 0;
  const br = (!down && !right) ? c : 0;
  const bl = (!down && !left) ? c : 0;
  path.moveTo(px + tl, py);
  path.lineTo(x1 - tr, py);
  if (tr) path.lineTo(x1, py + tr);
  path.lineTo(x1, y1 - br);
  if (br) path.lineTo(x1 - br, y1);
  path.lineTo(px + bl, y1);
  if (bl) path.lineTo(px, y1 - bl);
  path.lineTo(px, py + tl);
  if (tl) path.lineTo(px + tl, py);
  path.closePath();
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cell = 30;
    this.ox = 0;
    this.oy = 0;
    this.size = 12;
    this.viewW = 1;
    this.viewH = 1;

    this.particles = [];
    this.shards = [];
    this.rings = [];
    this.flashes = [];
    this.stamps = [];
    this.shake = 0;
    this.time = 0;

    /**
     * 解へどれだけ近いか（0..1）。
     * 表示用の progress は目標へ毎フレーム少しずつ寄せる ―― 1手ごとに色が
     * ぱっと変わると「点滅」に見えてしまう。ゆっくり動くから景色になる。
     */
    this.progress = 0;
    this.progressTarget = 0;
    this._tintAt = -1;
    /**
     * 背景の色の渡り方。
     * auraFrom = 前の段の色 / auraTo = 新しい段の色 / auraWave = 下からどこまで満ちたか。
     * 色が 1 段動くたびに auraWave が 0 に戻り、下端から上へ塗り替わっていく。
     */
    this.auraFrom = 0;
    this.auraTo = 0;
    this.auraWave = 1;
    /** 色を何段に分けるか。レベルの最短手数がそのまま段数になる */
    this.steps = 32;

    /** ブロックのデザイン。設定で切り替わる */
    this.material = materialFor(DEFAULT_MATERIAL);
    /*
     * 既定が写真のデザインなら、ここで読み込みを始める。
     * setMaterial は「今と違うとき」しか動かないので、既定のまま遊ぶ人には
     * 呼ばれない ―― 任せきりにすると、設定を触るまで写真が貼られないままになる。
     */
    if (this.material.photo) loadPhotos(() => this.invalidateBakes());
    /**
     * 焼き上げたブロックの絵。
     * 鍵は「デザイン × 形 × 色 × マスの大きさ」。同じ鍵なら 1 枚を全員で使う。
     */
    this.pieceCache = new Map();

    this.refreshTint();

    this.options = { symbols: false, ghost: true, calm: false };
  }

  /** デザインを切り替える。焼いてある絵は全部捨てる */
  setMaterial(key) {
    const next = materialFor(key);
    if (next === this.material) return;
    this.material = next;
    this.invalidateBakes();
    // 写真を貼るデザイン（クリスタル）は、画像が復号できるまで無地で描くしかない。
    // 読めたところで焼いてある絵を捨て、貼り直す
    if (next.photo) loadPhotos(() => this.invalidateBakes());
  }

  invalidateBakes() {
    this.pieceCache.clear();
    this._tintAt = -1; // デザインが変われば同じ進行度でも色が変わる
    this.refreshTint();
  }

  /**
   * 色を何段に分けるか。**そのレベルの最短手数**を渡す。
   * 40 手の盤面なら色は 40 段。1 手進めば 1 段進み、1 手遠ざかれば 1 段戻る。
   * 上下の丸めは念のための歯止めで、実際の手数（2〜300）は必ずこの中に入る。
   */
  setSteps(n) {
    const next = Math.max(4, Math.min(400, Math.round(n) || 32));
    if (next === this.steps) return;
    this.steps = next;
    this._tintAt = -1;
    this.refreshTint();
  }

  /**
   * 進行度を伝える。immediate はレベルを跨いだときだけ（前のレベルの色を
   * 引きずったまま次の盤面が出ると、いま何色なのかが意味を失う）。
   */
  setProgress(t, immediate = false) {
    this.progressTarget = Math.max(0, Math.min(1, t || 0));
    if (immediate) {
      this.progress = this.progressTarget;
      // 背景も満ちきった状態から始める。レベルを跨いだのに前の色が上に残っていると、
      // 新しい盤面の色が何を指しているのか読めない
      this._tintAt = -1;
    }
  }

  /**
   * 進行度から作った色。値が動いたときだけ作り直す。
   *
   * 刻みは**そのレベルの最短手数**（setSteps）に合わせる。残り手数が 1 減れば
   * 色がちょうど 1 段進み、遠ざかれば 1 段戻る ―― 色そのものが手数の目盛りになる。
   * 連続値のまま焼くと、進行度が動くたびに焼き直すことになって引っかかるので、
   * ここで段に丸めることが速さの担保も兼ねている。
   * 背景の光だけは丸めずに動かすので、段は目には見えない。
   */
  refreshTint() {
    const q = Math.round(this.progress * this.steps) / this.steps;
    if (this._tintAt === q) return;
    /*
     * 背景はここで**すぐには**変わらない。
     *
     * ブロックの色は 1 手ぶんまるごと切り替わるが、画面いっぱいの背景まで同時に
     * 切り替わると、視界の端で照明が点滅したように見える。代わりに直前の色を
     * 覚えておき、新しい色を**下端から上へ満たしていく**（auraWave）。
     * 一瞬で置き換わるのではなく、水位が上がるように渡っていく。
     */
    if (this._tintAt >= 0) {
      this.auraFrom = this._tintAt;
      this.auraWave = 0;
    } else {
      this.auraFrom = q; // 最初の 1 回（レベルを開いた瞬間）は満ちきった状態から始める
      this.auraWave = 1;
    }
    this.auraTo = q;
    this._tintAt = q;
    this.tint = progressColor(q);
    this.stonePal = paletteFor(this.material, false, null);
    this.litPal = paletteFor(this.material, true, this.tint.base);
  }

  /**
   * 背景に敷く色。色つきブロックとまったく同じ色を、うんと薄めて返す。
   * 画面は**全体が**この色で、濃さは上下で変えない ―― 変えると、色の違いなのか
   * 濃さの違いなのかが読めなくなる。
   */
  auraColor(alpha = 0.22) {
    return this.auraAt(this.auraTo, alpha);
  }

  /** ひとつ前の段の色。新しい色が満ちきるまで、上のほうに残っている */
  auraPrevColor(alpha = 0.22) {
    return this.auraAt(this.auraFrom, alpha);
  }

  auraAt(t, alpha) {
    const m = this.material;
    if (m.rawTint) return auraFor(t, null, 1, alpha);
    return auraFor(t, m.colors.lit.mid, m.tint, alpha);
  }

  /**
   * 新しい色の水位（画面の下からの %）。
   *
   * 端は AURA_FEATHER のぶんぼかすので、水位は「画面の下の外」から
   * 「画面の上の外」まで動かす ―― そうしないと、満ちきったあとも画面の上端に
   * 前の色が細く残る。
   */
  auraRise() {
    return -AURA_FEATHER + this.auraWave * (100 + AURA_FEATHER * 2);
  }

  /** ブロックの色。灰色はデザインそのまま、色つきは進行度の色を混ぜたもの */
  palFor(colorIndex) {
    return colorIndex === -9 ? this.stonePal : this.litPal; // -9 は board.js の BLOCKER
  }

  /**
   * 演出（破片・光の輪・残像）に使う色。
   * ブロックそのものではなく「そこにあった色」を伝えられればいいので、
   * デザインの代表色 3 つに畳んで返す。
   */
  colorOf(colorIndex) {
    const pal = this.palFor(colorIndex);
    return {
      name: colorIndex === -9 ? '灰色（消えないブロック）' : '色つきブロック',
      base: pal.mid,
      light: shade(pal.top, 0.16),
      dark: pal.deep,
      shadow: hexRgb(pal.deep).join(','),
    };
  }

  resize(size) {
    if (size) this.size = size;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.viewW = w;
    this.viewH = h;

    // 盤面は正方形。画面をできるだけ大きく使う ―― 余白ではなく盤面が主役。
    // 外周は演出（光の輪）がわずかに滲む余地だけ残す
    // 外周は、トレイの枠と落ち影のぶんだけ余白を取る
    const frame = Math.max(10, Math.min(w, h) * 0.035);
    const cell = Math.floor((Math.min(w, h) - frame * 2) / this.size);
    const prev = this.cell;
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
    // マスの大きさが変われば、焼いてある絵は全部寸法違い
    if (this.cell !== prev) this.invalidateBakes();
  }

  /**
   * マスとマスのすき間。デザインごとに決まる（クリスタルは写真の目地に合わせて広い）。
   * ここが空いているぶんだけ、下のトレイと落ち影が見える ＝ 厚みが読める。
   */
  get tileGap() { return Math.max(1, this.cell * this.material.gap); }
  get tileSize() { return this.cell - this.tileGap * 2; }
  get tileRadius() { return Math.max(1.5, this.cell * (this.material.radius || 0.12)); }
  /** ブロックの厚み（側面の見える高さ） */
  get depth() { return Math.max(1.5, this.cell * this.material.depth); }

  /**
   * 角の落とし（px）。
   * **1 マスぶんの短辺**に掛ける ―― 写真の角は「1 マスあたり何画素」で決まって
   * いるので、マスの一辺に掛けると 2 マスのブロックだけ切り口が深くなる。
   */
  chamferFor(w, h, cols, rows) {
    const cut = this.material.chamfer;
    if (!cut) return 0;
    return cut * Math.min(w / cols, h / rows);
  }
  /** 画面座標 -> 盤面セル */
  toCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.ox) / this.cell);
    const y = Math.floor((clientY - rect.top - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }

  cellCenter(x, y) {
    return { x: this.ox + (x + 0.5) * this.cell, y: this.oy + (y + 0.5) * this.cell };
  }

  // ---------------------------------------------------------------- 演出
  //
  // 消えた瞬間の報酬は「光」だけで作る。文字は一切出さない。
  //   マスが光に開く -> 破片が散る -> リングが広がる -> 画面が一瞬白む
  // 連鎖が深いほど強度が上がり、音程の階段と一緒に効いてくる。

  /** 消えたマスそのものが光になって開く */
  shatter(cells, colorIndex) {
    const c = this.colorOf(colorIndex);
    for (const [x, y] of cells) {
      this.shards.push({ x, y, color: c.light, life: 1 });
    }
  }

  /** 砕けた破片が飛び散る */
  burst(cells, colorIndex, strength = 1) {
    const c = this.colorOf(colorIndex);
    const n = this.options.calm ? 3 : Math.round(9 + strength * 3);
    for (const [cx, cy] of cells) {
      const p = this.cellCenter(cx, cy);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.5 + Math.random() * 3.1) * this.cell * 0.06;
        const white = Math.random() < 0.3;
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * this.cell * 0.6,
          y: p.y + (Math.random() - 0.5) * this.cell * 0.6,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - this.cell * 0.04,
          g: this.cell * 0.011,
          life: 1,
          decay: 0.015 + Math.random() * 0.018,
          size: this.cell * (white ? 0.05 : 0.09 + Math.random() * 0.18),
          radius: white ? 0.5 : 0.3,
          color: white ? '#ffffff' : (Math.random() < 0.45 ? c.light : c.base),
          spin: (Math.random() - 0.5) * 0.34,
          rot: Math.random() * Math.PI,
        });
      }
    }
  }

  /** 色のついた光の輪が広がる */
  ring(x, y, colorIndex, strength = 1) {
    const c = this.colorOf(colorIndex);
    this.rings.push({
      x, y,
      r: this.cell * 0.3,
      maxR: this.cell * (2.2 + strength * 1.6),
      life: 1,
      color: c.shadow,
      glow: c.light,
    });
  }

  /** 消えた瞬間のフラッシュ（報酬のトリガー） */
  flash(x, y, strength = 1) {
    if (this.options.calm) return;
    this.flashes.push({ x, y, r: this.cell * (2.6 + strength * 1.8), life: 1 });
  }

  /**
   * ブロックの上にスタンプを貼る（👍）。
   *
   * 手が良かったことを伝える唯一の「文字」。数字でも文章でもないので読む必要がなく、
   * 目を上げずに済む ―― 盤面から視線を外させないための形。
   * ひとつずつ間を置いて出し、跳ねてから浮き上がって消える。
   */
  stamp(cells, text = '👍', count = 3) {
    if (!cells || cells.length === 0) return;
    for (let i = 0; i < count; i++) {
      const [cx, cy] = cells[Math.floor(Math.random() * cells.length)];
      const p = this.cellCenter(cx, cy);
      this.stamps.push({
        x: p.x + (Math.random() - 0.5) * this.cell * 0.9,
        y: p.y + (Math.random() - 0.5) * this.cell * 0.7,
        rot: (Math.random() - 0.5) * 0.44,
        // マスに比例させつつ頭打ちを付ける。4×4 の盤面はマスが大きく、
        // 比例させただけだとスタンプがブロックより大きくなって盤面が読めなくなる
        size: Math.min(this.cell * (0.62 + Math.random() * 0.24), 46),
        // 3個が同時に出ると1個の大きな塊に見える。少しずつずらして「増えていく」
        delay: i * 0.11,
        life: 1,
        text,
      });
    }
  }

  addShake(amount) {
    if (this.options.calm) amount *= 0.3;
    this.shake = Math.min(22, this.shake + amount);
  }

  clearEffects() {
    this.particles.length = 0;
    this.shards.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
    this.stamps.length = 0;
    this.shake = 0;
  }

  // ---------------------------------------------------------------- 描画

  draw(view, dt) {
    const ctx = this.ctx;
    this.time += dt;

    // 進行度は目標へ寄せるだけ。1フレームで 6% ずつ詰めると、1手ぶんの変化が
    // 0.5秒ほどかけて渡る ―― 変化に気づけて、かつ気を取られない速さ
    if (this.progress !== this.progressTarget) {
      const k = 1 - Math.pow(1 - 0.06, Math.max(0.5, dt * 60));
      this.progress += (this.progressTarget - this.progress) * k;
      if (Math.abs(this.progressTarget - this.progress) < 0.0008) this.progress = this.progressTarget;
    }
    this.refreshTint();
    // 背景の色は「下から満ちる」ぶんだけ遅れて追いつく（AURA_SWEEP 秒で画面いっぱい）
    if (this.auraWave < 1) this.auraWave = Math.min(1, this.auraWave + dt / AURA_SWEEP);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0.15) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.85, dt * 60);
    } else {
      this.shake = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);

    /*
     * 受け皿は描かない。**残っているのは、いちばん外側の縁取り 1 本だけ。**
     *
     * 昔はここに「盤面」という面を敷いていた ―― 枠を立て、床を落とし、空きマスを
     * 一段深い窪みにして、ブロックが箱に収まっているように見せていた。だが
     * **その面は、遊ぶのに何ひとつ足していなかった**。どこがマスかはブロックの
     * 並びで分かるし、通路は「ブロックが載っていないところ」として読める。
     * 面が 1 枚増えたぶん、背景・受け皿・ブロックと明るさの段が 3 つになり、
     * ブロックの輪郭がいちばん強い境目でなくなっていた。
     *
     * いまはキャンバスを透かして、そのまま背景（.game-aura）を見せている。
     * 盤面のあたりは背景と**まったく同じ色**で、面としての境目は無い ――
     * 画面にある明るさの段は「背景」と「ブロック」の 2 つだけ。
     */
    this.drawBoardEdge();
    this.drawPieces(view);
    if (view.selected != null && !view.ghost && !view.anim) {
      this.drawMoveHints(view.board, view.selected);
    }
    if (view.ghost && this.options.ghost) this.drawGhost(view);

    this.drawShards(dt);
    this.drawRings(dt);
    this.drawFlashes(dt);
    this.drawParticles(dt);
    this.drawStamps(dt);

    ctx.restore();
  }

  /**
   * 盤面のいちばん外側の縁取り。
   *
   * 面は敷かない ―― 線 1 本だけ。「ここまでが盤面」という境界は、遊ぶ人が
   * 最初に知りたいことなので残してある。けれど面まで敷くと、背景・盤面・ブロックと
   * 明るさの段が 3 つになり、ブロックの輪郭がいちばん強い境目でなくなる。
   * 線だけなら、境界を示しながら段は 2 つのままでいられる。
   *
   * **柔らかく見せるために、太くて薄い線と細くて濃い線を重ねる。**
   * 1 本だけだと硬い枠に見え、消しかけの箱がそこにあるように読める。
   * 太いほうが外へにじんで境目をぼかし、細いほうが位置を決める。
   * 角は大きめに丸めてある ―― 直角は「箱の角」に見えてしまう。
   */
  drawBoardEdge() {
    const ctx = this.ctx;
    const cell = this.cell;
    if (!cell) return;
    const w = cell * this.size;
    // ブロックの外周からわずかに離す。触れていると縁取りではなく枠に見える
    const pad = Math.max(3, cell * 0.1);
    const radius = Math.max(10, cell * 0.34);
    const x = this.ox - pad;
    const y = this.oy - pad;
    const side = w + pad * 2;

    ctx.save();
    ctx.lineJoin = 'round';
    // にじみ。太く、薄く
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = Math.max(4, cell * 0.11);
    ctx.beginPath();
    ctx.roundRect(x, y, side, side, radius);
    ctx.stroke();
    // 芯。細く、はっきり
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, cell * 0.03);
    ctx.beginPath();
    ctx.roundRect(x, y, side, side, radius);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 盤上のブロックを全部描く。
   *
   * 描く順を「画面の下にあるものほど後」にしてある。ブロックには厚みがあり、
   * 手前（下）のブロックは奥（上）のブロックの側面を隠す ―― 順を守らないと、
   * 下のブロックの向こう側に上のブロックの側面が突き抜けて見える。
   */
  drawPieces(view) {
    const { board, anim, selected, invalid } = view;
    if (!board) return;

    const list = [];
    for (const piece of board.pieces.values()) {
      let dx = 0;
      let dy = 0;
      let squash = 0;

      if (anim && anim.pieceId === piece.id) {
        const d = DIRS[anim.dir];
        if (anim.phase === 'slide') {
          const p = easeOutCubic(anim.t);
          dx = -d.x * anim.steps * this.cell * (1 - p);
          dy = -d.y * anim.steps * this.cell * (1 - p);
        } else if (anim.phase === 'land') {
          // 進行方向につぶれて戻る（ぶつかった手応え）
          squash = Math.sin(anim.t * Math.PI) * 0.16;
        }
      }

      if (invalid && invalid.pieceId === piece.id) {
        const d = DIRS[invalid.dir];
        const k = Math.sin(invalid.t * Math.PI * 6) * (1 - invalid.t) * this.cell * 0.16;
        dx += d.x * k;
        dy += d.y * k;
      }

      let bottom = -Infinity;
      for (const [, y] of piece.cells) if (y > bottom) bottom = y;
      list.push({ piece, dx, dy, squash, depth: bottom * this.cell + dy });
    }
    list.sort((a, b) => a.depth - b.depth);

    // 残像は全部のブロックより下に敷く（塊の下をくぐって見えるように）
    if (anim && anim.phase === 'slide') {
      const moving = board.pieces.get(anim.pieceId);
      if (moving) this.drawTrail(moving, DIRS[anim.dir], anim, easeOutCubic(anim.t));
    }

    for (const item of list) {
      const axis = anim && anim.pieceId === item.piece.id ? anim.dir : null;
      this.drawPiece(item.piece, item.dx, item.dy, 1, item.squash,
        selected === item.piece.id, 'solid', axis);
    }
  }

  // ---------------------------------------------------------------- ブロックを焼く

  /** ブロックの外接矩形（セル単位） */
  cellBounds(cells) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
  }

  /** 形の指紋。同じ形なら同じ絵を使い回せる */
  shapeKey(cells, minX, minY) {
    return cells.map(([x, y]) => `${x - minX}.${y - minY}`).sort().join('-');
  }

  /**
   * ブロック 1 個の絵をオフスクリーンに焼く。
   *
   * 影のぼかしと写真の 9 分割は、どれも 1 個あたり 10 回近い描画になる。
   * 盤上に 20 個あると毎フレーム 200 回。焼いてしまえば毎フレームやるのは
   * drawImage 1 回だけになる。
   *
   * @param {number[][]} cells 盤面座標のセル
   * @param {object} pal 色（materials.paletteFor）
   * @param {boolean} colored 色つきブロックか（灰色は進行度の色を被せない）
   */
  bakePiece(cells, pal, colored) {
    const mat = this.material;
    const cell = this.cell;
    const { minX, minY, cols, rows } = this.cellBounds(cells);
    const depth = this.depth;
    // 影がはみ出すぶんの余白。平らなデザインは何もはみ出さないので 1px でいい
    const pad = mat.flat ? 1 : Math.ceil(depth + cell * 0.34);
    const w = cols * cell + pad * 2;
    const h = rows * cell + pad * 2;
    // 画素密度ぶん大きく焼いて、貼るときに CSS 画素へ戻す。
    // 等倍で焼くと Retina で 2 倍に引き伸ばされ、面取りの稜線がぼやける
    const s = this.dpr;
    const cv = makeCanvas(w * s, h * s);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    ctx.scale(s, s);

    const ox = pad - minX * cell;
    const oy = pad - minY * cell;
    const radius = this.tileRadius;
    const rects = this.rectsFor(cells, ox, oy, this.tileGap, radius);
    const box = this.bboxOf(rects);
    const chamfer = this.chamferFor(box.w, box.h, cols, rows);
    const outer = this.pathOf(rects, chamfer);

    /*
     * プレーンはここで終わり。
     *
     * 薄い立体にするのではなく、**何も通らない**。接地影も面取りも縁の線も
     * 無いので、目が拾うものが「色と形」だけになる ―― どのブロックがどこまでかを
     * いちばん速く読めるのがこの見た目で、だから既定にしてある。
     */
    if (mat.flat) {
      ctx.fillStyle = pal.mid;
      ctx.fill(outer);
      return { canvas: cv, pad, minX, minY, w, h };
    }

    /*
     * クリスタルは、盤面に落ちる影を敷いてから写真を貼るだけ。
     * 面取りも艶も帯も**写真がすでに全部持っている**ので、上から足すと二重に光る。
     */
    const rim = this.boundaryOf(cells, rects, box, radius, chamfer);
    this.bakeShadow(ctx, outer, rim, mat, cell, depth);
    this.bakePhoto(ctx, outer, box, cols, rows, pal, colored);
    return { canvas: cv, pad, minX, minY, w, h };
  }

  /**
   * 写真を 1 個のブロックに貼る。
   *
   * ブロックは 1×1 から 8×3 まで何マスにもなるので、写真をそのまま引き伸ばすと
   * 面取りまで一緒に伸びて、細長いブロックだけ縁が太くなる。そこで **9 分割**で
   * 貼る ―― 四隅と四辺は伸ばさずそのまま、中央だけを伸ばす。
   * エメラルドカットの面取りは「一定の幅の帯」なので、これでどの大きさでも
   * 写真と同じ太さのまま収まる。全部のレベルに同じ 4 枚で足りるのはこのため。
   *
   * 色は貼ってから被せる。「色相と彩度は塗った色、明るさは写真のまま」なので、
   * ガラスの陰影を潰さずに色だけが変わる ―― 進行度の色（手数の目盛り）が、
   * 写真の上でもそのまま働く。
   *
   * 染めるのは**別のキャンバスの上**で、画素を直に書き換えてやる（colorizePixels）。
   * 合成の混ぜ方に任せると効かない端末があり、そこでは色つきブロックだけが
   * 白いガラスのまま残った。別のキャンバスを挟むのは、ここに直に描くと
   * すでに敷いてある接地影まで一緒に染まってしまうため。
   */
  bakePhoto(ctx, outer, box, cols, rows, pal, colored) {
    const mat = this.material;
    let img = photoFor(cols, rows);
    // 大きさを持たない写真は、復号に失敗している。そのまま貼ると**何も描かれず**
    // ブロックが消えるので、無地に落とす（無地なら色は付いている）
    if (img && !(img.naturalWidth || img.width)) img = null;
    // 色つきは進行度の色、灰色は写真がもともと帯びている青み。
    // 濃さを 1 まで上げると、ガラスではなく**塗った板**に見える ――
    // 少し透かすと、地の無彩色が残って「染めたガラス」になる
    const tintHex = colored ? this.tint.base : mat.photoTint;
    const strength = colored ? mat.tint : 1;

    ctx.save();
    ctx.clip(outer);
    if (!img) {
      // まだ復号できていない。無地で置いておく（読めたら焼き直される）。
      // pal.mid はもう色が乗っているので、被せる必要は無い
      ctx.fillStyle = pal.mid;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
      ctx.restore();
      return;
    }
    const dyed = this.dyePhoto(img, box, cols, rows, tintHex, strength);
    if (dyed) {
      ctx.drawImage(dyed, box.x0, box.y0, box.w, box.h);
    } else {
      // 画素を読めない環境。混ぜ方に頼るしかないが、効かなくても無色で残るだけ
      this.drawNineSlice(ctx, img, box, cols, rows);
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = strength;
      ctx.fillStyle = tintHex;
      ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
    }
    ctx.restore();
  }

  /**
   * 写真を 1 枚ぶん貼って染めたものを返す。失敗したら null。
   * 大きさはブロックの箱そのままで、画素密度ぶん大きく作る。
   */
  dyePhoto(img, box, cols, rows, tintHex, strength) {
    const s = this.dpr;
    const cv = makeCanvas(box.w * s, box.h * s);
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.scale(s, s);
    // 箱を原点へ移した写し。9 分割の割り方は貼る先と同じ
    const local = { x0: 0, y0: 0, x1: box.w, y1: box.h, w: box.w, h: box.h };
    this.drawNineSlice(ctx, img, local, cols, rows);
    try {
      const px = ctx.getImageData(0, 0, cv.width, cv.height);
      colorizePixels(px.data, tintHex, strength);
      ctx.putImageData(px, 0, 0);
    } catch {
      return null; // 画素を読めない（あってはならないが、黙って諦める）
    }
    return cv;
  }

  /**
   * 9 分割で貼る。
   *
   * 縁の太さは**マスに比例させる**（写真の側も貼る側も）。ブロックが何マスでも
   * 1 マスあたりの見え方が変わらないので、盤面のなかで面取りの太さが揃う。
   * 継ぎ目は destination 側を 0.5px 重ねて隠す ―― ぴったり突き合わせると、
   * 拡大縮小の補間が切れる位置に髪の毛ほどの線が出る。
   */
  drawNineSlice(ctx, img, box, cols, rows) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!sw || !sh) return;
    // 縁の取り方。面取り（0.17）＋角の落とし（0.2）が収まるだけ内側まで
    const K = 0.3;
    const sb = Math.min(PHOTO_UNIT * K, sw / 2 - 1, sh / 2 - 1);
    const db = Math.min(Math.min(box.w / cols, box.h / rows) * K, box.w / 2 - 0.5, box.h / 2 - 0.5);
    const bleed = 0.5;
    const sx = [0, sb, sw - sb, sw];
    const sy = [0, sb, sh - sb, sh];
    const dx = [box.x0, box.x0 + db, box.x1 - db, box.x1];
    const dy = [box.y0, box.y0 + db, box.y1 - db, box.y1];
    // 伸ばす面を先に、角を最後に。逆にすると、重ねた 0.5px が角に被さって
    // 面取りの稜線が鈍る ―― いちばん形を持っているのが角なので、そこを上に置く
    const order = [[1, 1], [1, 0], [1, 2], [0, 1], [2, 1], [0, 0], [2, 0], [0, 2], [2, 2]];
    for (const [i, j] of order) {
      const bx = i === 1 ? bleed : 0;
      const by = j === 1 ? bleed : 0;
      ctx.drawImage(
        img,
        sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j],
        dx[i] - bx, dy[j] - by,
        (dx[i + 1] - dx[i]) + bx * 2, (dy[j + 1] - dy[j]) + by * 2,
      );
    }
  }

  /**
   * 接地影。
   * いったん影を落としてから**内側をくり抜く** ―― くり抜かないと、影を落とすために
   * 塗った面がブロックの下に残り、透けるクリスタルで真っ黒に見えてしまう。
   */
  bakeShadow(ctx, outer, rim, mat, cell, depth) {
    ctx.save();
    ctx.shadowColor = `rgba(26,24,22,${mat.shadow})`;
    ctx.shadowBlur = cell * 0.16;
    ctx.shadowOffsetX = cell * 0.018;
    ctx.shadowOffsetY = depth * 0.72 + cell * 0.05;
    ctx.fillStyle = '#000';
    ctx.fill(outer);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(outer);
    // 塗りだけだと縁の半端な画素が残り、黒い髪の毛のような線になる。
    // 外周を 1px の線でもなぞって、その半端まで消す
    ctx.lineWidth = 1;
    ctx.stroke(rim);
    ctx.restore();
  }

  drawTrail(piece, d, anim, p) {
    const ctx = this.ctx;
    const c = this.colorOf(piece.color);
    const total = anim.steps * this.cell;
    const cell = this.cell;
    for (let i = 1; i <= 3; i++) {
      const back = Math.min(1, (1 - p) + i * 0.09);
      const dx = -d.x * total * back;
      const dy = -d.y * total * back;
      ctx.save();
      ctx.globalAlpha = 0.14 * (1 - i / 4) * Math.min(1, p * 3);
      ctx.fillStyle = c.base;
      for (const [cx, cy] of piece.cells) {
        ctx.beginPath();
        ctx.roundRect(
          this.ox + cx * cell + dx + this.tileGap,
          this.oy + cy * cell + dy + this.tileGap,
          this.tileSize, this.tileSize, this.tileRadius,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * セル群 -> 矩形の並び。
   *
   * 同じブロックの隣り合うマスは、接する側のすき間と角丸を 0 にして繋げる ――
   * こうすると L 字でも凹型でも「1 個の塊」に見える。
   */
  rectsFor(cells, ox, oy, pad, r) {
    const cell = this.cell;
    const own = new Set(cells.map(([x, y]) => `${x},${y}`));
    const has = (x, y) => own.has(`${x},${y}`);
    /*
     * 隣り合うマスは、接する側をわずかに**重ねる**。
     *
     * ぴったり突き合わせると、塗りと切り抜きの縁で被覆率が 100% に届かず、
     * マスの境目に髪の毛ほどの線が走る（盤面にマス目が浮いて見えた）。
     * 0.6px 食い込ませれば重なるので、線は原理的に出ない。
     * 重なっても困らないよう、塗りと切り抜きは全部 nonzero で扱う。
     */
    const bleed = -0.6;

    const out = [];
    for (const [x, y] of cells) {
      const up = has(x, y - 1);
      const down = has(x, y + 1);
      const left = has(x - 1, y);
      const right = has(x + 1, y);
      const l = left ? bleed : pad;
      const t = up ? bleed : pad;
      const rt = right ? bleed : pad;
      const b = down ? bleed : pad;
      out.push({
        x, y, up, down, left, right,
        px: ox + x * cell + l,
        py: oy + y * cell + t,
        pw: cell - l - rt,
        ph: cell - t - b,
        radii: [
          (!up && !left) ? r : 0,
          (!up && !right) ? r : 0,
          (!down && !right) ? r : 0,
          (!down && !left) ? r : 0,
        ],
      });
    }
    return out;
  }

  /** ブロックのセル矩形（盤面座標） */
  cellRects(piece, dx, dy) {
    return this.rectsFor(piece.cells, this.ox + dx, this.oy + dy, this.tileGap, this.tileRadius);
  }

  /**
   * ブロックの**外周だけ**をなぞる 1 本の閉じた輪郭。
   *
   * pathOf はマスごとの矩形を並べたものなので、これを stroke すると
   * マスとマスの境目まで線が引かれ、1 個の塊に格子が浮く（実際そうなった）。
   * 縁をなぞる用途では必ずこちらを使うこと。
   *
   * このゲームのブロックは全部が長方形（src/exact.js が長方形しか置かない）なので、
   * 外接矩形をそのままなぞれば厳密に外周と一致する。将来 L 字などが増えたときの
   * ために、長方形でなければ辺ごとの外周（outlineOf）へ落ちる。
   */
  boundaryOf(cells, rects, box, r, chamfer = 0) {
    const { cols, rows } = this.cellBounds(cells);
    if (cells.length !== cols * rows) return this.outlineOf(rects, r);
    const path = new Path2D();
    const shape = {
      px: box.x0, py: box.y0, pw: box.w, ph: box.h,
      up: false, down: false, left: false, right: false,
    };
    if (chamfer > 0) chamferRect(path, shape, chamfer);
    else path.roundRect(box.x0, box.y0, box.w, box.h, r);
    return path;
  }

  pathOf(rects, chamfer = 0) {
    const path = new Path2D();
    for (const p of rects) {
      if (chamfer > 0) chamferRect(path, p, chamfer);
      else path.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
    }
    return path;
  }

  bboxOf(rects) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of rects) {
      if (p.px < x0) x0 = p.px;
      if (p.py < y0) y0 = p.py;
      if (p.px + p.pw > x1) x1 = p.px + p.pw;
      if (p.py + p.ph > y1) y1 = p.py + p.ph;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * ブロック本体。
   * @param {string} mode 'solid' | 'outline'
   * @param {string|null} axis つぶれる向き（着地アニメ用）
   */
  drawPiece(piece, dx = 0, dy = 0, alpha = 1, squash = 0, selected = false, mode = 'solid', axis = null) {
    const ctx = this.ctx;
    const cell = this.cell;
    const rects = this.cellRects(piece, dx, dy);
    const box = this.bboxOf(rects);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (squash) {
      const cx = (box.x0 + box.x1) / 2;
      const cy = (box.y0 + box.y1) / 2;
      const horiz = axis === 'left' || axis === 'right';
      ctx.translate(cx, cy);
      ctx.scale(horiz ? 1 - squash : 1 + squash * 0.55, horiz ? 1 + squash * 0.55 : 1 - squash);
      ctx.translate(-cx, -cy);
    }

    const c = this.colorOf(piece.color);
    const mat = this.material;
    const { cols, rows } = this.cellBounds(piece.cells);
    const outline = this.boundaryOf(
      piece.cells, rects, box, this.tileRadius, this.chamferFor(box.w, box.h, cols, rows),
    );

    if (mode === 'outline') {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = c.light;
      ctx.setLineDash([cell * 0.26, cell * 0.2]);
      ctx.lineCap = 'round';
      ctx.stroke(outline);
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 焼いてある絵を貼る。同じ形・同じデザイン・同じ色なら 1 枚を全員で使い回す
    const pal = this.palFor(piece.color);
    const { minX, minY } = this.cellBounds(piece.cells);
    const key = `${this.material.key}|${this.shapeKey(piece.cells, minX, minY)}`
      + `|${pal.key}|${this.cell}`;
    let baked = this.pieceCache.get(key);
    if (baked === undefined) {
      baked = this.bakePiece(piece.cells, pal, piece.color !== -9);
      /*
       * 盤上の形は数種類しかないが、色つきの絵は残り手数が 1 動くたびに増える。
       * 300 手のレベルなら 600 枚まで積み上がるので、上限を超えたら**古いものから**
       * 捨てる。全部捨てると、灰色ブロック（色が動かない＝ずっと使い回せる）まで
       * 巻き添えで焼き直しになり、そこで一瞬止まる。
       */
      while (this.pieceCache.size >= 64) {
        this.pieceCache.delete(this.pieceCache.keys().next().value);
      }
      this.pieceCache.set(key, baked);
    } else {
      // 使ったものを新しい側へ回す（Map は入れた順に並ぶので、これで最近使った順になる）。
      // これをしないと、いちばん長く使い回せる灰色ブロックが最初に捨てられる
      this.pieceCache.delete(key);
      this.pieceCache.set(key, baked);
    }
    if (baked) {
      ctx.drawImage(
        baked.canvas,
        this.ox + minX * cell + dx - baked.pad,
        this.oy + minY * cell + dy - baked.pad,
        baked.w, baked.h,
      );
    } else {
      // キャンバスを作れない環境（テストなど）。塗りだけは出しておく
      ctx.fillStyle = pal.mid;
      ctx.fill(this.pathOf(rects));
    }

    // 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.42;
      ctx.fillStyle = c.dark;
      ctx.font = `700 ${Math.floor(cell * 0.44)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SYMBOLS[piece.color % SYMBOLS.length], this.ox + (ax + 0.5) * cell + dx, this.oy + (ay + 0.55) * cell + dy);
      ctx.restore();
    }

    // 選択中はブロックの外周をなぞる（動く単位を示す）。光らせず、線だけ
    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.5);
      ctx.save();
      ctx.globalAlpha = alpha * (0.55 + 0.45 * pulse);
      ctx.lineWidth = Math.max(2, cell * 0.075);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(outline);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * ブロックの外周だけの Path2D。
   * セル矩形の集合をそのまま stroke すると内部のセル境界まで線が出て、
   * 1個のブロックが格子模様に見えてしまう。外周の辺と外側の角だけを集める。
   */
  outlineOf(rects, r) {
    const ctx = new Path2D();
    const HALF_PI = Math.PI / 2;
    for (const p of rects) {
      const { px, py, pw, ph, up, down, left, right } = p;
      const x1 = px + pw;
      const y1 = py + ph;
      const rTL = (!up && !left) ? r : 0;
      const rTR = (!up && !right) ? r : 0;
      const rBR = (!down && !right) ? r : 0;
      const rBL = (!down && !left) ? r : 0;

      if (!up) { ctx.moveTo(px + rTL, py); ctx.lineTo(x1 - rTR, py); }
      if (!right) { ctx.moveTo(x1, py + rTR); ctx.lineTo(x1, y1 - rBR); }
      if (!down) { ctx.moveTo(x1 - rBR, y1); ctx.lineTo(px + rBL, y1); }
      if (!left) { ctx.moveTo(px, y1 - rBL); ctx.lineTo(px, py + rTL); }

      if (rTL) { ctx.moveTo(px, py + rTL); ctx.arc(px + rTL, py + rTL, rTL, Math.PI, Math.PI * 1.5); }
      if (rTR) { ctx.moveTo(x1 - rTR, py); ctx.arc(x1 - rTR, py + rTR, rTR, Math.PI * 1.5, 0); }
      if (rBR) { ctx.moveTo(x1, y1 - rBR); ctx.arc(x1 - rBR, y1 - rBR, rBR, 0, HALF_PI); }
      if (rBL) { ctx.moveTo(px + rBL, y1); ctx.arc(px + rBL, y1 - rBL, rBL, HALF_PI, Math.PI); }
    }
    return ctx;
  }

  /** 着地予測ゴースト + 矢印 */
  drawGhost(view) {
    const { ghost } = view;
    if (!ghost || ghost.steps <= 0) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const d = DIRS[ghost.dir];
    const dx = d.x * ghost.steps * cell;
    const dy = d.y * ghost.steps * cell;
    const piece = ghost.piece;

    this.drawPiece(piece, dx, dy, 0.3, 0, false, 'solid');
    this.drawPiece(piece, dx, dy, 0.9, 0, false, 'outline');

    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const from = this.cellCenter(cxs, cys);
    const to = { x: from.x + dx, y: from.y + dy };
    const col = ghost.willClear ? '#ffd60a' : 'rgba(255,255,255,.78)';

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.setLineDash([cell * 0.26, cell * 0.24]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x + d.x * cell * 0.4, from.y + d.y * cell * 0.4);
    ctx.lineTo(to.x - d.x * cell * 0.35, to.y - d.y * cell * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);

    const ax = to.x + d.x * cell * 0.1;
    const ay = to.y + d.y * cell * 0.1;
    const s = cell * 0.3;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ax + d.x * s, ay + d.y * s);
    ctx.lineTo(ax - d.x * s * 0.5 + d.y * s * 0.62, ay - d.y * s * 0.5 + d.x * s * 0.62);
    ctx.lineTo(ax - d.x * s * 0.5 - d.y * s * 0.62, ay - d.y * s * 0.5 - d.x * s * 0.62);
    ctx.closePath();
    ctx.fill();

    // 消える予定の相手を光らせる ―― 「あと1手で消える」予感を可視化する
    if (ghost.willClear && ghost.clearIds) {
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(this.time * 9);
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.shadowColor = 'rgba(255,214,10,.85)';
      ctx.shadowBlur = cell * 0.4;
      for (const id of ghost.clearIds) {
        const p = view.board.pieces.get(id);
        if (!p || p.id === piece.id) continue;
        const r2 = this.cellRects(p, 0, 0);
        ctx.stroke(this.outlineOf(r2, this.tileRadius));
      }
    }
    ctx.restore();
  }

  drawParticles(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    ctx.save();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += p.g * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= Math.pow(0.955, k);
      p.rot += p.spin * k;
      p.life -= p.decay * k;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + p.life * 0.5);
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s / 2, s, s, s * p.radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 消えたマスが光になって開く。
   * ブロックと同じ矩形を、白く飛ばしながら少しだけ膨らませて消す ――
   * 「そこにあったものが光になった」ように見せたいので、位置と形は変えない。
   */
  drawShards(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    const cell = this.cell;
    const gap = this.tileGap;
    const size = this.tileSize;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= 0.075 * k;
      if (s.life <= 0) {
        this.shards.splice(i, 1);
        continue;
      }
      const t = easeOutCubic(1 - s.life);
      const grow = 1 + t * 0.85;
      const w = size * grow;
      const cx = this.ox + s.x * cell + gap + size / 2;
      const cy = this.oy + s.y * cell + gap + size / 2;
      ctx.save();
      ctx.globalAlpha = s.life * 0.9;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = s.life > 0.55 ? '#ffffff' : s.color;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - w / 2, w, w, this.tileRadius * grow);
      ctx.fill();
      ctx.restore();
    }
  }

  drawRings(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= 0.036 * k;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = easeOutCubic(1 - r.life);
      const rad = r.r + (r.maxR - r.r) * t;
      ctx.save();
      ctx.globalAlpha = r.life * 0.55;
      ctx.strokeStyle = `rgba(${r.color},1)`;
      ctx.lineWidth = Math.max(1.5, this.cell * 0.17 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      // 内側にもう一本、明るい輪を重ねてネオンのように光らせる
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = r.life * 0.45;
      ctx.strokeStyle = r.glow;
      ctx.lineWidth = Math.max(1, this.cell * 0.06 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad * 0.93, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 👍 のスタンプ。
   * 出るときだけ勢いよく（跳ねながら大きくなる）、消えるときはただ浮いて薄れる ――
   * 出現に力を入れて退場を静かにすると、視線を引いておいて返してくれる。
   */
  drawStamps(dt) {
    const ctx = this.ctx;
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.life -= dt * 0.85;
      if (s.life <= 0) {
        this.stamps.splice(i, 1);
        continue;
      }
      const t = 1 - s.life; // 0 -> 1
      // 出てから 0.22 のあいだで跳ねる（行き過ぎて戻る）
      const pop = t < 0.22
        ? 1.28 * easeOutCubic(t / 0.22)
        : 1.28 - 0.28 * easeOutCubic(Math.min(1, (t - 0.22) / 0.2));
      const rise = easeOutCubic(t) * this.cell * 0.6;
      ctx.save();
      ctx.globalAlpha = Math.min(1, s.life * 2.2);
      ctx.translate(s.x, s.y - rise);
      ctx.rotate(s.rot * (1 - t * 0.6));
      ctx.scale(pop, pop);
      ctx.font = `${Math.round(s.size)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 絵文字は色で描かれるので、後ろに白を敷いて盤面から浮かせる
      ctx.shadowColor = 'rgba(0,0,0,.28)';
      ctx.shadowBlur = s.size * 0.28;
      ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }
  }

  drawFlashes(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= 0.09 * k;
      if (f.life <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      const rad = f.r * (1.6 - f.life * 0.6);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      g.addColorStop(0, `rgba(255,255,255,${0.7 * f.life})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
      ctx.restore();
    }
  }

  /** 選択中ブロックの「動ける方向」を控えめに示す */
  drawMoveHints(board, pieceId) {
    if (pieceId == null) return;
    const piece = board.pieces.get(pieceId);
    if (!piece) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const base = this.cellCenter(cxs, cys);
    ctx.save();
    for (const dir of DIR_KEYS) {
      if (board.slideDistance(pieceId, dir) <= 0) continue;
      const d = DIRS[dir];
      const ax = base.x + d.x * cell * 1.1;
      const ay = base.y + d.y * cell * 1.1;
      const s = cell * 0.2;
      ctx.globalAlpha = 0.4 + 0.18 * Math.sin(this.time * 5);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = cell * 0.2;
      ctx.beginPath();
      ctx.moveTo(ax + d.x * s, ay + d.y * s);
      ctx.lineTo(ax - d.x * s * 0.4 + d.y * s * 0.8, ay - d.y * s * 0.4 + d.x * s * 0.8);
      ctx.lineTo(ax - d.x * s * 0.4 - d.y * s * 0.8, ay - d.y * s * 0.4 - d.x * s * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// ===== src/input.js =====
// 入力。スワイプ（ポインタ）とクリック選択を扱う。
//
// ドラッグ量が PREVIEW_THRESHOLD を超えた時点で着地予測ゴーストを出し、
// COMMIT_THRESHOLD(26px) を超えた瞬間にスライドを発動する。

const PREVIEW_THRESHOLD = 6;
const COMMIT_THRESHOLD = 26;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   canInteract: () => boolean,
 *   toCell: (x:number, y:number) => ({x:number,y:number}|null),
 *   pieceAt: (x:number, y:number) => (number|null),
 *   onTap: (pieceId:number|null) => void,
 *   onPreview: (pieceId:number, dir:string|null) => void,
 *   onCommit: (pieceId:number, dir:string) => void,
 * }} handlers
 */
function attachInput(canvas, handlers) {
  let drag = null;

  const dirOf = (dx, dy) => {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!handlers.canInteract()) return;
    const cell = handlers.toCell(e.clientX, e.clientY);
    const id = cell ? handlers.pieceAt(cell.x, cell.y) : null;
    if (id == null) {
      handlers.onTap(null);
      return;
    }
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    drag = { id, x0: e.clientX, y0: e.clientY, dir: null, done: false };
    handlers.onTap(id);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.done) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));

    if (dist < PREVIEW_THRESHOLD) {
      if (drag.dir) {
        drag.dir = null;
        handlers.onPreview(drag.id, null);
      }
      return;
    }

    const dir = dirOf(dx, dy);
    if (dir !== drag.dir) {
      drag.dir = dir;
      handlers.onPreview(drag.id, dir);
    }

    if (dist >= COMMIT_THRESHOLD) {
      drag.done = true;
      handlers.onPreview(drag.id, null);
      handlers.onCommit(drag.id, dir);
    }
  });

  const end = () => {
    if (!drag) return;
    if (!drag.done && drag.dir) handlers.onPreview(drag.id, null);
    drag = null;
  };

  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ===== src/haptics.js =====
// 触覚（バイブレーション）。
//
// 「震える端末では必ず震える」ことを目標にした層。鳴らす側（audio.js）からは
// play(pattern) しか見えず、その端末に届く手段の選択はここに閉じてある。
//
//   ① Vibration API   navigator.vibrate。Android の Chrome / Firefox / Samsung など。
//                     [振動, 休み, 振動, ...] のパターンをそのまま渡せる唯一の道。
//
//   ② ボタンの触覚（iOS）
//                     iOS には navigator.vibrate が無く、iOS 26.5 以降は script から
//                     触覚を起こす道も塞がれている。実機で確かめた結論は 1 つ ――
//                     **指が直接スイッチに触れている操作だけが鳴る。**
//                     なのでボタンの中に透明なスイッチを 1 枚敷き、指がそれを
//                     踏むことで鳴らす。詳しくは createTapVeil() のコメント。
//
//   ③ ゲームパッド    PC にコントローラが繋がっているとき。vibrationActuator に
//                     dual-rumble を流す。手元にモーターがあるならそこで鳴らす。
//
// ①〜③ のどれも持たない端末（多くのデスクトップ）は、震える部品が本当に無い
// ので何もしない。supported を見れば設定画面でそう伝えられる。

/**
 * Android の実機では 5ms 前後の振動は指に届かない（モーターが立ち上がる前に
 * 指示が終わる）。細かい合図ほど「鳴らしたのに感じない」になるので下限を敷く。
 */
const MIN_PULSE_MS = 12;

/** ボタンに敷く膜に付ける class。位置決めは styles.css の側に置いてある */
const VEIL_CLASS = 'haptic-tap';

/** 数値 1 つでも配列でも受け取り、[振動, 休み, 振動, ...] の ms 配列にそろえる */
function toSegments(pattern) {
  const raw = Array.isArray(pattern) ? pattern : [pattern];
  const out = [];
  for (const v of raw) {
    const n = Math.round(Number(v));
    out.push(Number.isFinite(n) && n > 0 ? n : 0);
  }
  while (out.length && out[out.length - 1] === 0) out.pop();
  return out;
}

/** 偶数番＝振動、奇数番＝休み。振動の側にだけ下限を敷いた配列を返す */
function withMinPulse(segments) {
  return segments.map((ms, i) => (i % 2 === 0 && ms > 0 ? Math.max(ms, MIN_PULSE_MS) : ms));
}

class Haptics {
  /**
   * @param {{navigator?: object, document?: object, setTimeout?: Function,
   *          clearTimeout?: Function}} [env] 差し替え用（テストから使う）
   */
  constructor(env = {}) {
    this.nav = env.navigator !== undefined ? env.navigator
      : (typeof navigator !== 'undefined' ? navigator : null);
    this.doc = env.document !== undefined ? env.document
      : (typeof document !== 'undefined' ? document : null);
    this.setTimer = env.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = env.clearTimeout || ((id) => clearTimeout(id));

    this.enabled = true;
    this.timers = [];       // 予約済みの叩き
    this.watching = false;  // 画面を離れたときの後始末を仕掛けたか
  }

  // ------------------------------------------------------------ 端末を見る

  /** navigator.vibrate が使えるか（Android 系） */
  get hasVibrationApi() {
    return !!(this.nav && typeof this.nav.vibrate === 'function');
  }

  /**
   * iOS のスイッチ触覚が使えるか。
   * `switch` は WebKit が IDL 属性として持つので、実装の有無をそのまま聞ける。
   */
  get hasSwitchHaptics() {
    if (!this.doc || typeof this.doc.createElement !== 'function') return false;
    try {
      return 'switch' in this.doc.createElement('input');
    } catch {
      return false;
    }
  }

  /** 振動できるゲームパッド（繋がっていないときは空） */
  gamepads() {
    if (!this.nav || typeof this.nav.getGamepads !== 'function') return [];
    let list;
    try { list = this.nav.getGamepads(); } catch { return []; }
    if (!list) return [];
    return Array.from(list).filter(
      (g) => g && g.connected !== false && g.vibrationActuator
        && typeof g.vibrationActuator.playEffect === 'function',
    );
  }

  /** この端末で震えられるか。設定画面の但し書きに使う */
  get supported() {
    return this.mode !== 'none';
  }

  /**
   * どの道で震わせるか。
   * 'vibration'（鳴らしたい瞬間に鳴らせる）／'ios-taps'（ボタンを押した指にだけ返せる）
   * ／'gamepad'／'none'
   */
  get mode() {
    if (this.hasVibrationApi) return 'vibration';
    if (this.hasSwitchHaptics) return 'ios-taps';
    if (this.gamepads().length > 0) return 'gamepad';
    return 'none';
  }

  // ------------------------------------------------------------ 準備

  /** 最初のユーザー操作で呼ぶ */
  arm() {
    this.watchVisibility();
  }

  /**
   * 画面を離れたら、予約してある叩きを捨てる。
   * 戻ってきた指と関係のない振動が後から来ると、ただの誤作動に感じられる。
   */
  watchVisibility() {
    if (this.watching || !this.doc || typeof this.doc.addEventListener !== 'function') return;
    this.watching = true;
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.hidden) this.stop();
    });
  }

  // ------------------------------------------------- ボタンの触覚（iOS）

  /** この端末は「指に踏ませる」側か（＝ script からは鳴らせないが、指になら鳴らせる） */
  needsTapVeil() {
    return this.enabled && !this.hasVibrationApi && this.hasSwitchHaptics;
  }

  /**
   * ボタンの中に敷く、透明な触覚の膜を 1 枚こしらえる。
   *
   * 中身は**本物の** <input type="checkbox" switch>。iOS 26.5 以降、触覚が鳴るのは
   * 「指が直接スイッチに触れたとき」だけなので、ボタンの面をこれで覆って、
   * 押した指自身に鳴らしてもらう。
   *
   * ボタンを壊さないために、置き方には理由がある:
   *
   *   ・**ボタンの子**として入れる。膜をタップしても click はボタンまで
   *     バブリングするので、ボタンの動作はそのまま生きる（転送は要らない）。
   *   ・inset: 0 の絶対配置。ボタン側は position: relative になるだけで、
   *     並びも大きさも変わらない。
   *   ・:active はボタン側にも掛かる（CSS の :active は祖先にも一致する）ので、
   *     押した見た目も失われない。
   *   ・disabled のボタンでは CSS で pointer-events を切る。押せないボタンが
   *     手ごたえだけ返すことのないように。
   *
   * **盤面には敷かない。** 以前これを盤面に敷いたところ、実機の WebKit では
   * スイッチ自身がタッチを掴んでしまい、ブロックを動かせなくなった。
   * ドラッグを伴う面には決して置かないこと。
   *
   * CSS で appearance を潰してもいけない。ネイティブのスイッチでなくなった
   * 時点で触覚も消える（透明なので見た目は変わらず、気付けない）。
   *
   * @returns {Element|null}
   */
  createTapVeil() {
    if (!this.doc || typeof this.doc.createElement !== 'function') return null;
    try {
      const el = this.doc.createElement('input');
      el.type = 'checkbox';
      el.setAttribute('switch', '');
      el.className = VEIL_CLASS;
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
      return el;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ 鳴らす

  /**
   * 振動する。
   *
   * iOS では**何もしない** ―― script から鳴らす道が閉じているため。
   * その端末では createTapVeil() で敷いた膜が、ボタンを押した指から鳴らす。
   *
   * @param {number|number[]} pattern ms、または [振動, 休み, 振動, ...]
   * @returns {boolean} どれかの手段に届いたか
   */
  play(pattern) {
    if (!this.enabled) return false;
    const segments = toSegments(pattern);
    if (!segments.length) return false;

    this.cancelTimers(); // 前のパターンは打ち切る（Vibration API と同じ振る舞い）

    let fired = false;
    if (this.hasVibrationApi) {
      try {
        fired = this.nav.vibrate(withMinPulse(segments)) !== false;
      } catch { /* 端末が拒んだら黙って次へ */ }
    }
    if (this.playGamepad(segments)) fired = true;
    return fired;
  }

  /**
   * ゲームパッド：振動の区間ごとに dual-rumble を流す。
   * 長い一撃ほど強く鳴らして、盤面の「重さ」を手元でも同じ順に並べる。
   */
  playGamepad(segments) {
    const pads = this.gamepads();
    if (!pads.length) return false;
    let t = 0;
    let fired = false;
    for (let i = 0; i < segments.length; i++) {
      const ms = segments[i];
      if (i % 2 === 1) { t += ms; continue; }
      if (ms <= 0) continue;
      const dur = Math.max(ms, MIN_PULSE_MS);
      const weight = Math.min(1, dur / 60);
      const effect = {
        duration: dur,
        weakMagnitude: 0.35 + weight * 0.5,
        strongMagnitude: weight * 0.8,
      };
      const run = () => {
        for (const pad of pads) {
          try { pad.vibrationActuator.playEffect('dual-rumble', effect); } catch { /* 無視 */ }
        }
      };
      if (t <= 0) run();
      else this.timers.push(this.setTimer(run, t));
      t += ms;
      fired = true;
    }
    return fired;
  }

  /** 予約済みの叩きを取り消す */
  cancelTimers() {
    for (const id of this.timers) this.clearTimer(id);
    this.timers.length = 0;
  }

  /** いま鳴っているものを止める（画面を離れるときなど） */
  stop() {
    this.cancelTimers();
    if (this.hasVibrationApi) {
      try { this.nav.vibrate(0); } catch { /* 無視 */ }
    }
  }
}

// ===== src/audio.js =====
// 効果音。音源ファイルは持たず、WebAudio でその場で合成する。
//
// いちばん大事なのは**ブロックを動かした音**なので、そこだけ独立した設計にしてある。
//
//   石を押す（slide → land）
//                   このゲームで唯一「重さ」を伝える音。押し出しの抵抗 →
//                   引きずる摩擦 → ぶつかって沈む衝撃、の3段階で作る。
//                   軽い「カチッ」で済ませると、盤面が紙のように感じられて
//                   「壁を押しのけている」実感が消える。
//                   詳しくは slide() / land() のコメントに書いた。
//
//   ウッドクリック  掴む・UI を押す。乾いた「カチッ」。木片を叩いたときの、
//                   芯があってすぐ消える音。操作の合図だけを担う。
//
//   グラスシャター  消えた瞬間。薄い氷が砕けるような「シャラン」。
//                   非整数倍の高い partial を重ねると、鐘でも打楽器でもない
//                   「ガラス」の質感になる。連鎖するほど音程が階段状に上がる。
//
//   低いほめ音      解法どおりに進んでいるときの相づち。低く、丸く、短い和音。
//                   祝う音ではないので、消去音より下の音域に置いて重ならせない。
//
// ハプティクスは音と同じ関数の中で鳴らす。指と耳がずれない。
// どの端末で震わせるかは haptics.js に任せてある（iOS には navigator.vibrate が
// 無いので、そこだけ別の道を通る）。
//
// iOS は最初のタップまで音を出せないので、unlock() を最初のポインタ操作で呼ぶ。

/** 音程の階段（ペンタトニック：外れた感じにならず、上がり続けても心地よい） */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

/** ガラスの部分音。整数倍から外すと「鐘」ではなく「ガラス」に聴こえる */
const GLASS_PARTIALS = [1, 2.41, 3.86, 5.62, 7.71, 9.94];

/**
 * ほぼ無音の WAV を作る（画面収録対策。理由は keepAlive のコメント）。
 * 完全な 0 ではなく最下位ビットだけを 22kHz で振っている ―― 人には聴こえず、
 * それでいて「無音だから」と再生を止められることもない。
 */
function silentLoopUrl() {
  const rate = 44100;
  const frames = rate >> 1; // 0.5 秒
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) v.setInt16(44 + i * 2, i & 1 ? 1 : -1, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this._enabled = true;
    this.hap = new Haptics();
    this.keepAlive = null;
  }

  /** 触覚の入切。呼ぶ側は今までどおり sound.haptics だけを見ればよい */
  get haptics() { return this.hap.enabled; }

  set haptics(v) { this.hap.enabled = !!v; }

  /** この端末に震える部品があるか（設定画面の但し書きに使う） */
  get hapticsSupported() { return this.hap.supported; }

  /** どの道で震わせるか（'vibration' / 'ios-taps' / 'gamepad' / 'none'） */
  get hapticsMode() { return this.hap.mode; }

  /** iPhone のように「ボタンを押した指にだけ返せる」端末か */
  needsHapticTaps() { return this.hap.needsTapVeil(); }

  /** ボタンの中に敷く触覚の膜を 1 枚作る（詳しくは haptics.js） */
  createHapticTapVeil() { return this.hap.createTapVeil(); }

  /**
   * サウンドの入切。切ったら「画面収録用の無音ループ」も止める
   * （鳴らさないのに音声セッションを占有しない）。
   */
  get enabled() { return this._enabled; }

  set enabled(v) {
    this._enabled = !!v;
    if (!this.keepAlive) return;
    if (this._enabled) this.keepAlive.play().catch(() => {});
    else this.keepAlive.pause();
  }

  /**
   * 触覚だけを起こす。音と違って AudioContext が要らないので、
   * サウンドを切っている人や、まだボタンに触れていない人にも先に効かせる。
   */
  armHaptics() {
    this.hap.arm();
  }

  /** 最初のユーザー操作で呼ぶ。以降いつでも鳴らせるようになる */
  unlock() {
    this.hap.arm();
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.keepAlive && this._enabled && this.keepAlive.paused) {
        this.keepAlive.play().catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // ノイズは使い回す（砕ける音とクリックの芯に使う）
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startKeepAlive();
  }

  /**
   * 画面収録に音が乗るようにする。
   *
   * iOS/Safari は WebAudio だけを鳴らしていると音声セッションが「環境音」扱いのままで、
   * 消音スイッチで黙るうえ、画面収録にも録音されない ―― 収録した動画が無音になる。
   * <audio> 要素で何かを再生し続けているあいだはセッションが「メディア再生」に上がり、
   * 同じセッションを共有する WebAudio の出力も、消音スイッチを無視して鳴り、収録される。
   *
   * そのための、ほぼ無音のループ。再生が止められても復帰できるように見張る。
   */
  startKeepAlive() {
    if (this.keepAlive || typeof Audio === 'undefined') return;
    try {
      const el = new Audio(silentLoopUrl());
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      this.keepAlive = el;
      if (this._enabled) el.play().catch(() => {});

      // タブに戻ってきたとき、OS に止められていたら鳴らし直す
      const revive = () => {
        if (!this._enabled || document.hidden) return;
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if (el.paused) el.play().catch(() => {});
      };
      document.addEventListener('visibilitychange', revive);
      el.addEventListener('pause', revive);
    } catch { /* 使えない環境では諦める（音は鳴る。収録に乗らないだけ） */ }
  }

  get ready() {
    return this._enabled && this.ctx && this.master;
  }

  /** 単音。type と包絡を指定して鳴らす */
  tone(freq, { type = 'sine', gain = 0.2, attack = 0.004, decay = 0.25, delay = 0, glide = 0 } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    // glide > 0 なら少し上から落ちてくる。木を叩いた瞬間の「詰まり」がこれで出る
    osc.frequency.setValueAtTime(freq * (1 + glide), t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
  }

  /** ノイズをフィルタ越しに一瞬だけ */
  burst({ gain = 0.12, decay = 0.14, delay = 0, type = 'highpass', freq = 1200, q = 0.7 } = {}) {
    if (!this.ready || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  /**
   * 沈み込む低音。「重い」の芯はこれ 1 本で決まる。
   *
   * 同じ低さでも、一定の周波数を鳴らすと "ブーッ" というただの低音にしかならない。
   * 上から下へ落とすと、はじめて**質量のあるものが着いた**ように聴こえる ――
   * 実際の衝突音でも、材料がたわんで戻るあいだに基音が下がっていく。
   * 落とし切るまでの時間を decay より短くしてあるのは、下がりきったあとに
   * 「residual（余韻）」を残したいから。ここが無いと音が痩せる。
   */
  thump(from, to, { gain = 0.5, decay = 0.4, delay = 0, type = 'sine' } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, to), t + decay * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.03);
  }

  /**
   * 引きずる摩擦。ブロックが滑っているあいだだけ鳴る。
   *
   * ノイズをループさせ、ローパスの角を「開いて閉じる」ように動かす。
   * 開くところが加速、閉じるところが減速に聴こえるので、
   * 目で見えている滑走とひとつながりの動きになる。
   * 帯域を 600Hz 以下に抑えているのが要点 ―― 上が出ると砂や紙になってしまい、
   * 石や木の塊には聴こえない。
   */
  rumble(duration = 0.3, { gain = 1 } = {}) {
    if (!this.ready || !this.noise) return;
    const t = this.ctx.currentTime;
    const dur = Math.max(0.07, duration);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.45 + Math.random() * 0.12;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(210, t);
    lp.frequency.linearRampToValueAtTime(600, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(300, t + dur);

    // ざらつきの芯。低い帯域をひとつ持ち上げると「ゴロゴロ」が出る
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 150;
    bp.Q.value = 1.1;
    bp.gain.value = 7;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.055 * gain), t + 0.05);
    g.gain.setValueAtTime(0.055 * gain, t + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(lp);
    lp.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  /**
   * 乾いたウッドクリック。掴む合図と UI のボタンに使う。
   *
   *   ・帯域を絞ったノイズの一撃  = 木を叩いた「カチッ」という芯
   *   ・上から落ちてくる基音      = 木片の詰まった鳴り
   *   ・4 倍音を少しだけ          = マリンバ寄りの丸み
   */
  wood(freq = 520, { gain = 1, decay = 0.11, delay = 0 } = {}) {
    this.burst({
      type: 'bandpass',
      freq: freq * 3.4,
      q: 1.6,
      gain: 0.09 * gain,
      decay: 0.022,
      delay,
    });
    this.tone(freq, { type: 'triangle', gain: 0.17 * gain, attack: 0.002, decay, delay, glide: 0.06 });
    this.tone(freq * 4, { type: 'sine', gain: 0.035 * gain, attack: 0.002, decay: decay * 0.5, delay });
  }

  /**
   * 薄いガラス／氷が砕ける音。
   * 非整数倍の partial を上から順に、ほんの少しずつ遅らせて散らす。
   */
  glass(root = 1046.5, { gain = 1, spread = 1 } = {}) {
    GLASS_PARTIALS.forEach((mul, i) => {
      this.tone(root * mul, {
        type: 'sine',
        gain: (0.15 / (1 + i * 0.9)) * gain,
        attack: 0.002,
        decay: (0.42 - i * 0.045) * spread,
        delay: i * 0.008 * spread,
      });
    });
    // 破片が散る「シャラン」
    this.burst({ type: 'highpass', freq: 5200, q: 0.7, gain: 0.1 * gain, decay: 0.26 * spread });
    this.burst({ type: 'highpass', freq: 9000, q: 0.7, gain: 0.06 * gain, decay: 0.4 * spread, delay: 0.03 });
    // 炭酸が弾ける「シュワッ」
    this.burst({ type: 'bandpass', freq: 3000, q: 0.5, gain: 0.05 * gain, decay: 0.18 * spread, delay: 0.01 });
  }

  // ---------------------------------------------------------------- 効果音

  /** ブロックをつかんだ合図。掴むのは重い塊なので、低く short に */
  tap() {
    this.wood(430, { gain: 0.4, decay: 0.055 });
    this.thump(150, 104, { gain: 0.14, decay: 0.1 });
    this.vibrate(7);
  }

  /** UI のボタン。盤面の重さとは切り離した、軽い操作音 */
  click() {
    this.wood(700, { gain: 0.5, decay: 0.07 });
    this.vibrate(6);
  }

  /**
   * 押し出して滑り始めた瞬間 ―― と、滑っているあいだ。
   *
   * 「重いものを動かした」感じは、着地の一撃だけでは出ない。動き出しの抵抗と、
   * 動いているあいだ鳴りっぱなしの摩擦があって、はじめて**ぶつかった音に意味が出る**。
   * 摩擦は滑走アニメと同じ長さで鳴らして、音が先に終わったり残ったりしないようにする。
   *
   * @param {number} distance 滑るマス数（多いほど重く長い）
   * @param {number} duration 滑走アニメの長さ（秒）
   */
  slide(distance = 1, duration = 0.3) {
    const d = Math.min(distance, 10);
    const w = Math.min(1, d / 8); // 0..1 の「重さ」
    // 押し出しの抵抗。低く短い一撃で、動き出しの "グッ" を作る
    this.thump(132 - w * 22, 80 - w * 14, { gain: 0.2 + w * 0.14, decay: 0.14 });
    this.burst({ type: 'lowpass', freq: 320, q: 0.8, gain: 0.07 + w * 0.03, decay: 0.05 });
    this.rumble(duration, { gain: 0.55 + w * 0.8 });
    this.vibrate(Math.round(5 + d * 1.4));
  }

  /**
   * 滑って壁にぶつかって止まった瞬間 ―― この音がこのゲームの手触りを決める。
   *
   * 重さは 5 層の重ね方で作る。どれか 1 つでも抜けると軽くなる:
   *
   *   ① 沈む芯   100Hz 台から 40Hz 台へ落ちる正弦波。腹に来る「ドスッ」
   *   ② 胴鳴り   塊そのものの質量。三角波を少し上から落として詰まりを出す
   *   ③ 接触面   低く絞ったノイズの一撃。木と木がぶつかる面の「ゴッ」
   *   ④ 輪郭     ごく短い中高域を一撃だけ。**これが無いと低音がぼやけて、
   *              重いのではなく「こもった」音になる**。混ぜるのは一瞬でいい
   *   ⑤ 余韻     受け止めた板が残す低い響き。ここで「置かれた」と分かる
   *
   * 距離が長いほど低く・長く・強くなる。10マス滑らせた1手が、
   * 1マスの1手と同じ音で終わらないようにするため。
   */
  land(distance = 1) {
    const d = Math.min(distance, 10);
    const w = Math.min(1, d / 8);
    const decay = 0.4 + w * 0.3;

    this.thump(102 - w * 20, 44 - w * 10, { gain: 0.5 + w * 0.4, decay });                                  // ①
    this.tone(166 - w * 44, { type: 'triangle', gain: 0.26, attack: 0.003, decay: 0.19 + w * 0.1, glide: 0.16 }); // ②
    this.burst({ type: 'lowpass', freq: 400 + w * 160, q: 0.9, gain: 0.19 + w * 0.06, decay: 0.075 });      // ③
    this.burst({ type: 'bandpass', freq: 1900, q: 1.5, gain: 0.045, decay: 0.016 });                        // ④
    this.tone(58, { type: 'sine', gain: 0.09 + w * 0.07, attack: 0.02, decay: 0.46 + w * 0.3, delay: 0.02 }); // ⑤

    // 触覚も同じ形にする。短い前触れ → 間 → 長く重い本体
    this.vibrate([8, 24, Math.round(20 + d * 6)]);
  }

  /**
   * 消えた瞬間。連鎖数 combo が増えるほど音程が上がっていく。
   * @param {number} combo 0 から始まる連続消しの回数
   * @param {number} pieces まとめて消えたブロック数（多いほど厚みを増す）
   */
  pop(combo = 0, pieces = 2) {
    const step = LADDER[Math.min(combo, LADDER.length - 1)];
    const root = 1046.5 * Math.pow(2, step / 12); // C6 から上へ
    // 階段を「聴かせる」のはウッドクリックの側。ガラスはその上に散る
    this.wood(523.25 * Math.pow(2, step / 12), { gain: 0.75, decay: 0.1 });
    this.glass(root, { gain: 1, spread: pieces >= 3 ? 1.25 : 1 });
    this.vibrate(pieces >= 3 ? [12, 24, 18] : 13);
  }

  /**
   * 解法どおりに進んでいる／解に近づいたときの相づち。
   *
   * 祝う音ではない ―― 祝ってしまうと、最後にクリアしたときの音が軽くなる。
   * 消去音（C6 まわり）よりずっと下の F3 に完全五度を重ねただけの、
   * 低くて丸い和音にしてある。減衰も長めで、鳴っても手を止めさせない。
   */
  praise() {
    const root = 174.61; // F3
    [1, 1.5, 2].forEach((mul, i) => {
      this.tone(root * mul, {
        type: 'sine', gain: 0.17 / (1 + i * 0.4), attack: 0.024, decay: 0.66, delay: i * 0.045,
      });
      this.tone(root * mul * 2, {
        type: 'triangle', gain: 0.035 / (1 + i * 0.5), attack: 0.02, decay: 0.34, delay: i * 0.045,
      });
    });
    // 和音だけだと始まりがぼやける。輪郭に低いウッドをひとつ置く
    this.wood(262, { gain: 0.34, decay: 0.14 });
    this.vibrate([10, 40, 14]);
  }

  /** 動かせない方向。重い塊が動かず、押した力だけが返ってくる詰まった音 */
  invalid() {
    this.thump(92, 68, { gain: 0.38, decay: 0.13 });
    this.burst({ type: 'lowpass', freq: 300, q: 0.9, gain: 0.13, decay: 0.055 });
    this.wood(130, { gain: 0.5, decay: 0.05 });
    this.vibrate([9, 36, 9]);
  }

  /** 全消し。ウッドクリックの階段を駆け上がって、最後にガラスが散る */
  win() {
    [0, 4, 7, 12, 16].forEach((s, i) => {
      this.wood(523.25 * Math.pow(2, s / 12), { gain: 0.8, decay: 0.16, delay: i * 0.085 });
    });
    this.glass(2093, { gain: 1.15, spread: 1.6 });
    this.burst({ type: 'highpass', freq: 6000, gain: 0.07, decay: 0.9, delay: 0.4 });
    this.vibrate([14, 34, 14, 34, 26]);
  }

  /** 1手戻した合図。下がる2つのクリック */
  undo() {
    this.wood(560, { gain: 0.5, decay: 0.07 });
    this.wood(400, { gain: 0.45, decay: 0.09, delay: 0.07 });
    this.vibrate(6);
  }

  vibrate(pattern) {
    this.hap.play(pattern);
  }
}

// ===== src/clearEffects.js =====
// 高級クリスタル / ガラス系のクリア演出。
// ★1: 2種類 / ★2: 2種類 / ★3: 1種類。
// レベルが高いほど、ガラス片・光・衝撃波の量とスケールを強化する。

const TAU = Math.PI * 2;

const PALETTE = [
  '#FFFFFF',
  '#00E5FF',
  '#2979FF',
  '#7C4DFF',
  '#FF2BD6',
  '#00FFB3',
  '#FFD400',
];

const fxClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fxEaseOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function color(i) {
  return PALETTE[i % PALETTE.length];
}

class ClearEffects {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.particles = [];
    this.rings = [];
    this.rays = [];
    this.shocks = [];
    this.flashes = [];
    this.running = false;
    this.raf = 0;
    this.seed = 0;
    this.lastTime = 0;
    this.resizeHandler = null;
  }

  ensureCanvas() {
    if (this.canvas) return;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'clear-effects-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '1200',
      mixBlendMode: 'screen',
    });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler, { passive: true });
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.rays.length = 0;
    this.shocks.length = 0;
    this.flashes.length = 0;
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  // 高レベルほど強く。ただし無限に膨らまないよう上限を設ける。
  intensity(level, stars) {
    const lv = Math.max(1, Number(level) || 1);
    const levelBoost = 1 + Math.min(1.55, Math.log10(lv + 1) * 0.72);
    const starBoost = stars === 3 ? 1.55 : stars === 2 ? 1.18 : 0.82;
    return levelBoost * starBoost;
  }

  addParticle(p) {
    // 低スペック端末で暴れないよう上限。
    if (this.particles.length < 950) this.particles.push(p);
  }

  burst(x, y, count, speed, size, life, spread = TAU, gravity = 0.0, colorOffset = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * spread - spread / 2 + (spread === TAU ? 0 : -Math.PI / 2);
      const sp = speed * (0.35 + Math.random() * 1.15);
      this.addParticle({
        x: x + (Math.random() - 0.5) * size,
        y: y + (Math.random() - 0.5) * size,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        gravity,
        drag: 0.985 + Math.random() * 0.01,
        life: life * (0.72 + Math.random() * 0.4),
        maxLife: life,
        size: size * (0.12 + Math.random() * 0.55),
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.5,
        color: color(i + colorOffset),
        shape: Math.random() < 0.52 ? 'diamond' : (Math.random() < 0.5 ? 'glass' : 'dot'),
      });
    }
  }

  glassRain(x, y, count, scale, lift = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const r = Math.random() * scale * 0.45;
      const s = scale * (0.015 + Math.random() * 0.045);
      this.addParticle({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * scale * 0.004,
        vy: lift + scale * (0.001 + Math.random() * 0.006),
        gravity: scale * 0.000018,
        drag: 0.992,
        life: 1.0 + Math.random() * 1.6,
        maxLife: 1.0 + Math.random() * 1.6,
        size: s,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.22,
        color: color(i + 2),
        shape: 'glass',
      });
    }
  }

  ring(x, y, radius, width, life, colorIndex, delay = 0) {
    this.rings.push({
      x, y, radius, width, life, maxLife: life,
      color: color(colorIndex), delay
    });
  }

  shock(x, y, maxRadius, life, width, delay = 0) {
    this.shocks.push({
      x, y, maxRadius, life, maxLife: life, width, delay
    });
  }

  ray(x, y, angle, length, width, life, colorIndex, delay = 0) {
    this.rays.push({
      x, y, angle, length, width, life, maxLife: life,
      color: color(colorIndex), delay
    });
  }

  flash(x, y, radius, life, alpha = 0.85) {
    this.flashes.push({ x, y, radius, life, maxLife: life, alpha });
  }

  // ★1 / TYPE A: 繊細なガラス散乱
  effectStar1Glass(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    this.flash(x, y, scale * 0.28 * s, 0.18, 0.52);
    this.shock(x, y, scale * 0.20 * s, 0.62, 2.2);
    this.ring(x, y, scale * 0.24 * s, 2.1, 0.78, 1);
    this.burst(x, y, Math.round(70 * s), scale * 0.004 * s, scale * 0.12, 0.9, TAU, scale * 0.000008);
    this.glassRain(x, y, Math.round(55 * s + highLevel * 10), scale, scale * 0.0004);
  }

  // ★1 / TYPE B: 斜めカットのガラス波
  effectStar1Wave(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    this.flash(x, y, scale * 0.22 * s, 0.13, 0.42);
    for (let i = 0; i < 4; i++) {
      this.shock(x, y, scale * (0.12 + i * 0.055) * s, 0.52 + i * 0.05, 1.5 + i * 0.25, i * 0.045);
    }
    for (let i = 0; i < 18 + Math.round(highLevel * 3); i++) {
      this.ray(x, y, (TAU * i / 18) + 0.22, scale * (0.18 + Math.random() * 0.2) * s, 1.2 + Math.random() * 1.3, 0.55, i, i * 0.006);
    }
    this.glassRain(x, y, Math.round(65 * s + highLevel * 8), scale * 1.08, scale * 0.0008);
  }

  // ★2 / TYPE C: 連続クラッシュ
  effectStar2Crash(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    this.flash(x, y, scale * 0.38 * s, 0.2, 0.68);
    this.burst(x, y, Math.round(170 * s + highLevel * 20), scale * 0.007 * s, scale * 0.18, 1.15, TAU, scale * 0.000012);
    for (let i = 0; i < 6; i++) {
      this.shock(x, y, scale * (0.18 + i * 0.09) * s, 0.78 + i * 0.045, 2.2 + i * 0.4, i * 0.035);
      this.ring(x, y, scale * (0.18 + i * 0.075) * s, 2.6 + i * 0.35, 0.95 + i * 0.04, i, i * 0.028);
    }
    this.glassRain(x, y, Math.round(120 * s + highLevel * 15), scale * 1.18, scale * 0.00035);
  }

  // ★2 / TYPE D: クリスタル・ファイアリング
  effectStar2Fire(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    for (let k = 0; k < 5; k++) {
      const a = TAU * k / 5 + 0.15;
      const cx = x + Math.cos(a) * scale * 0.12 * s;
      const cy = y + Math.sin(a) * scale * 0.12 * s;
      this.flash(cx, cy, scale * 0.14 * s, 0.13, 0.46);
      this.shock(cx, cy, scale * 0.11 * s, 0.48, 1.6);
      this.burst(cx, cy, Math.round(46 * s + highLevel * 6), scale * 0.0045 * s, scale * 0.10, 0.85);
      for (let i = 0; i < 10; i++) {
        this.ray(cx, cy, TAU * i / 10, scale * 0.11 * s, 1.2, 0.46, i + k * 2, i * 0.02);
      }
    }
    this.shock(x, y, scale * 0.64 * s, 0.95, 3.6);
    this.glassRain(x, y, Math.round(160 * s + highLevel * 12), scale * 1.3, scale * 0.0006);
  }

  // ★3: 完全別格。ガラスの「圧縮 → 破砕 → 巨大衝撃波 → 余韻」
  effectStar3Master(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);

    // 0) ほんの一瞬の白い核
    this.flash(x, y, scale * 0.15 * s, 0.10, 0.95);

    // 1) 破砕前の巨大な収束感
    for (let i = 0; i < 16; i++) {
      const a = TAU * i / 16;
      this.ray(x, y, a, scale * (0.24 + (i % 3) * 0.04) * s, 2.4 + (i % 2), 0.48, i, i * 0.012);
    }

    // 2) 本爆発
    this.flash(x, y, scale * 0.62 * s, 0.24, 1.0);
    this.burst(x, y, Math.round(430 * s + highLevel * 45), scale * 0.009 * s, scale * 0.22, 1.45, TAU, scale * 0.000015, 2);
    this.glassRain(x, y, Math.round(300 * s + highLevel * 30), scale * 1.45, scale * 0.0002);

    // 3) 巨大な多重衝撃波
    for (let i = 0; i < 10; i++) {
      this.shock(x, y, scale * (0.16 + i * 0.095) * s, 1.18 + i * 0.05, 3.4 + i * 0.45, i * 0.032);
      this.ring(x, y, scale * (0.14 + i * 0.085) * s, 3.4 + i * 0.45, 1.22 + i * 0.05, i + 1, i * 0.025);
    }

    // 4) 外周へ走る光
    const rays = 34 + Math.round(highLevel * 3);
    for (let i = 0; i < rays; i++) {
      const a = TAU * i / rays;
      this.ray(
        x, y, a,
        scale * (0.38 + Math.random() * 0.34) * s,
        1.5 + Math.random() * 3.2,
        0.82 + Math.random() * 0.28,
        i + 3,
        Math.random() * 0.15
      );
    }

    // 5) 余韻。大量の細かいガラス片が落ちる。
    this.glassRain(x, y, Math.round(240 * s + highLevel * 26), scale * 1.65, scale * 0.00045);
  }

  play({ stars = 1, level = 1, centerX = window.innerWidth / 2, centerY = window.innerHeight / 2, calm = false } = {}) {
    if (calm || !document?.body) return;
    this.ensureCanvas();

    const scale = this.intensity(level, stars);
    // 「高レベル」感をほんの少し視覚化。0〜1に圧縮。
    const highLevel = Math.min(6, Math.log10(Math.max(1, level)) + 0.3);

    this.clear();
    this.seed++;

    const variant = stars === 3 ? 5 : (stars === 2 ? (Math.random() < 0.5 ? 3 : 4) : (Math.random() < 0.5 ? 1 : 2));

    if (variant === 1) this.effectStar1Glass(centerX, centerY, scale, highLevel);
    else if (variant === 2) this.effectStar1Wave(centerX, centerY, scale, highLevel);
    else if (variant === 3) this.effectStar2Crash(centerX, centerY, scale, highLevel);
    else if (variant === 4) this.effectStar2Fire(centerX, centerY, scale, highLevel);
    else this.effectStar3Master(centerX, centerY, scale, highLevel);

    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame((t) => this.draw(t));
  }

  draw(now) {
    if (!this.running || !this.ctx) return;
    const dt = fxClamp((now - this.lastTime) / 1000 * 3.0, 0.008, 0.10);
    this.lastTime = now;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    let alive = false;

    for (const f of this.flashes) {
      f.life -= dt;
      if (f.life <= 0) continue;
      alive = true;
      const t = fxClamp(f.life / f.maxLife, 0, 1);
      const alpha = Math.pow(t, 1.8) * f.alpha;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.18, `rgba(255,255,255,${alpha * 0.55})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    for (const s of this.shocks) {
      if (s.delay > 0) {
        s.delay -= dt;
        alive = true;
        continue;
      }
      s.life -= dt;
      if (s.life <= 0) continue;
      alive = true;
      const t = 1 - s.life / s.maxLife;
      const r = s.maxRadius * easeOutQuint(fxClamp(t, 0, 1));
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.lineWidth = s.width * (1 - t * 0.65);
      ctx.globalAlpha = Math.pow(1 - t, 0.7) * 0.82;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#d9f5ff';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    for (const r of this.rings) {
      if (r.delay > 0) {
        r.delay -= dt;
        alive = true;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) continue;
      alive = true;
      const t = 1 - r.life / r.maxLife;
      const radius = r.radius * fxEaseOutCubic(fxClamp(t, 0, 1));
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.lineWidth = r.width * (0.35 + (1 - t));
      ctx.globalAlpha = Math.pow(1 - t, 0.58) * 0.76;
      ctx.strokeStyle = r.color;
      ctx.shadowBlur = 14;
      ctx.shadowColor = r.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    for (const r of this.rays) {
      if (r.delay > 0) {
        r.delay -= dt;
        alive = true;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) continue;
      alive = true;
      const t = 1 - r.life / r.maxLife;
      const len = r.length * fxEaseOutCubic(fxClamp(t * 1.12, 0, 1));
      const x2 = r.x + Math.cos(r.angle) * len;
      const y2 = r.y + Math.sin(r.angle) * len;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = r.width * (1 - t * 0.58);
      ctx.globalAlpha = (1 - t) * 0.72;
      ctx.strokeStyle = r.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = r.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      alive = true;

      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.gravity * dt * 60;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.rot += p.spin * dt * 60;

      const a = Math.pow(fxClamp(p.life / p.maxLife, 0, 1), 0.72);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.shadowBlur = Math.min(18, p.size * 2.4);
      ctx.shadowColor = p.color;

      if (p.shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.62, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size * 0.62, 0);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'glass') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.54, -p.size * 0.28);
        ctx.lineTo(p.size * 0.28, p.size);
        ctx.lineTo(-p.size * 0.45, p.size * 0.36);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = a * 0.7;
        ctx.lineWidth = Math.max(0.7, p.size * 0.08);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (alive) {
      this.raf = requestAnimationFrame((t) => this.draw(t));
    } else {
      this.running = false;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  }
}

// ===== src/config.js =====
// 外部につなぐ設定。ここ以外に URL を書かない。
//
// なぜ 1 ファイルに切り出してあるか:
//   ランキングのサーバは持ち主が自分で立てるもので、このリポジトリの中には無い。
//   URL をコードのあちこちに散らすと、配信先を変えるたびに探し回ることになる。
//   ここ 1 行だけを書き換えれば、世界共通ランキングに切り替わる。

/**
 * 世界共通ランキングの接続先。
 *
 * 空のあいだは**この端末の中だけ**にランキングを貯める（遊べなくはならない）。
 * URL を入れると、そこへ投稿・取得しにいく。末尾のスラッシュは付けても付けなくてもよい。
 *
 *   例) 'https://slidepop-rank.example.workers.dev/scores'
 *
 * **この URL を直したら `npm run build` を必ず走らせること。** ブラウザが読むのは
 * src/ ではなく app.js なので、焼き直さないとここの変更は一切届かない
 * （GitHub の web エディタから直したときは .github/workflows/build.yml が代わりに焼く）。
 *
 * 接続先のサーバ本体は worker/ に入っている。`npm run rank:deploy` で上がり、
 * 上の URL の <name> の部分は wrangler.toml（リポジトリのルート）の name と揃っている。
 *
 * サーバに求める約束ごとは 2 つだけ:
 *
 *   GET  <URL>?level=12&limit=50
 *        -> { "entries": [ { "name":"...", "moves":18, "time":73, "stars":3, "at":1700000000000 }, ... ] }
 *           手数の少ない順に並べて返す。素の配列を返してもよい。
 *
 *   POST <URL>   Content-Type: application/json
 *        body    { "level":12, "name":"...", "moves":18, "time":73, "stars":3 }
 *        -> { "ok":true, "rank":4, "entries":[ ... ] }
 *           rank と entries は省略してよい（省略されたら改めて GET しに行く）。
 *
 * CORS を許す（Access-Control-Allow-Origin）ことだけ忘れないこと。
 */
const RANKING_ENDPOINT = 'https://slidepop.hsgw-yuki0429.workers.dev/';

/**
 * 広告（忍者AdMax）の設定。
 *
 * どの枠も `id` が空のあいだは**広告まわりを一切動かさない** ―― 枠も出さないし、
 * 忍者AdMax のスクリプトも読み込まない。ID を入れ忘れたまま配信しても、
 * 空白が残ったり、オフライン起動の邪魔になる通信が増えたりしない。
 *
 * 入れる値は、忍者AdMax の管理画面で「広告を作成」して貰えるタグの中身。
 * 貰えるタグはこういう形をしている ――
 *
 *   <div class="admax-ads" data-admax-id="0123456789abcdef0123456789abcdef"
 *        style="display:inline-block;width:320px;height:50px;"></div>
 *   <script>(window.admaxads = window.admaxads || []).push(
 *     {admax_id:"0123456789abcdef0123456789abcdef", type:"banner"});</script>
 *   <script src="https://adm.shinobi.jp/st/t.js" async></script>
 *
 * このうち **id（data-admax-id の値）と、幅・高さ・type** をここに写す。
 * タグそのものを貼る必要はない ―― 組み立ては src/ads.js がやる。
 *
 *   id     広告ユニットの ID（英数字32桁）。空にした枠は出ない
 *   type   'banner'（固定サイズ）か 'switch'（PC/スマホ出し分け）。タグに書いてあるほう
 *   width  タグの style に書いてある幅（px）
 *   height 同じく高さ（px）。読み込み前に場所を取っておくのに使う
 *
 * 置き場所は 4 つ。要らない枠は id を空のままにしておけばよい。
 *
 *   home   ホーム画面のいちばん下
 *   levels レベル一覧のいちばん下
 *   game   ゲーム画面、盤面とツールバーのあいだ
 *   clear  レベルクリアの表示（カードの外・ボタンより下）
 *
 * **ここを直したら `npm run build` を必ず走らせること。** ブラウザが読むのは
 * src/ ではなく app.js なので、焼き直さないと設定が一切届かない。
 *
 * 忍者AdMax は審査が無いので、ID を入れて焼けばその日から出る（README の
 * 「広告」の節に、取ってくるところから書いてある）。
 */
const ADMAX = {
  slots: {
    home:   { id: '', type: 'banner', width: 320, height: 50 },
    levels: { id: '', type: 'banner', width: 320, height: 50 },
    game:   { id: '324373f6ac260f664ab65c6869c0ea2d', type: 'banner', width: 320, height: 50 },
    clear:  { id: '24d60ba6b37c9d6d805ee39b13f5d210', type: 'banner', width: 320, height: 50 },
  },
};

// ===== src/ranking.js =====
// ランキング。表は2つある。
//
//   ・**レベル別** ―― そのレベルを何手で解いたか。手数の少ない順
//   ・**星の数**   ―― その人が持っている星の総数。多い順
//
// レベル別だけだと「1つの盤面をどれだけ詰めたか」しか競えない。星の数の表は
// **どれだけ広く、どれだけ上手く解いてきたか**を1本の数字で並べる ―― 遊んだ量と
// 質が同じ物差しに乗るので、ホームから開いたときに自分の立ち位置がすぐ分かる。
//
// 方針:
//
//   ・**クリアしたら必ず記録される**。「保存しますか？」は訊かない。
//     訊くと、押し忘れた回のぶんだけランキングが実態とずれる。
//   ・名前は**自分で打つ**。初回だけ入力させ、以後はその名前を自動で使う。
//     毎回訊くのは邪魔だし、途中で変えられるとランキングが同一人物で埋まる
//     （変えたいときは設定から変えられる）。
//   ・順位は**手数の少ない順**。同着はタイムの短い順、それも同じなら先に出した方が上。
//     星ではなく手数で並べるのは、星が手数から決まる粗い階段でしかないから。
//   ・星の数の表は**星の多い順**。同数なら**クリア数の少ない順** ―― 同じ 30 個でも、
//     10 レベルで集めた人のほうが 30 レベルかけた人より上手い。それも同じなら先着順。
//
// 接続先（src/config.js の RANKING_ENDPOINT）が空のあいだは、この端末の
// localStorage にだけ貯める。世界共通に切り替えても記録の見た目は変わらない ――
// 画面には「世界」か「この端末」かだけを出す。
//
// 通信が失敗したときも、必ず端末側には残す。ランキングに載らなかったせいで
// クリアそのものが無かったことになる、という事故を起こさない。

/** 保存した名前。一度決めたら以後は自動で使う */
const NAME_KEY = 'slidepop.name';
/** 端末内ランキングの置き場（レベル別） */
const RANK_KEY = 'slidepop.rank.v1';
/** 端末内ランキングの置き場（星の数） */
const STAR_KEY = 'slidepop.stars.v1';

/** 名前の長さの上限。長い名前は一覧で他人の行を潰す */
const NAME_MAX = 12;
/** 1レベルあたり持っておく順位の数 */
const RANK_LIMIT = 50;

/** 通信を諦めるまで。待たせるくらいなら端末内の記録を出す */
const TIMEOUT_MS = 7000;

/**
 * 管理の付け替えだけは長く待つ。
 * 名前 1 つの付け替えでも**その人の記録がある全レベルを直しに行く**ので、
 * ふつうの読み込みより時間がかかる ―― ここで先に諦めると、サーバでは直り
 * きっているのに画面には「届きませんでした」と出て、直っていないように見える。
 */
const ADMIN_TIMEOUT_MS = 25000;

/** 接続先。末尾のスラッシュは落として揃える */
function endpoint() {
  const url = (RANKING_ENDPOINT || '').trim();
  return url ? url.replace(/\/+$/, '') : '';
}

/** 世界共通ランキングに繋がる設定になっているか */
function isGlobalRanking() {
  return endpoint() !== '';
}

/**
 * 名前を整える。
 * 制御文字と前後の空白を落とし、連続する空白を1つに詰めてから長さで切る。
 * 空になるような入力（空白だけ・記号だけ）は受け付けない ―― 呼び出し側で弾く。
 */
function sanitizeName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

function savedName() {
  try {
    return sanitizeName(localStorage.getItem(NAME_KEY) || '');
  } catch {
    return '';
  }
}

function saveName(name) {
  const clean = sanitizeName(name);
  if (!clean) return '';
  try { localStorage.setItem(NAME_KEY, clean); } catch { /* 保存できない環境では今回だけ有効 */ }
  return clean;
}

function forgetName() {
  try { localStorage.removeItem(NAME_KEY); } catch { /* 消せなければ諦める */ }
}

// ---------------------------------------------------------------- 管理（持ち主だけ）

/**
 * 管理の合言葉の置き場。
 *
 * ランキングに載る名前は他人が打った文字列なので、見るに堪えないものが混ざりうる。
 * それを直せるのは**持ち主ひとり**でなければならない ―― 誰でも直せると、
 * 今度は 1 位の名前が書き換えられる。
 *
 * 判定はサーバでやる（`worker/worker.js` の ADMIN_KEY）。ここに持つのは
 * 「毎回打たなくていいように覚えておく」ためだけの控えで、**これ自体は鍵ではない**。
 * 端末を覗かれたら合言葉も見えるので、覗かれる端末では「やめる」で消しておくこと。
 */
const ADMIN_KEY = 'slidepop.admin.v1';

/** 覚えている合言葉。無ければ空 */
function adminKey() {
  try {
    return String(localStorage.getItem(ADMIN_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** 合言葉を覚える。空を渡したら忘れる（＝管理モードを降りる） */
function saveAdminKey(key) {
  const clean = String(key == null ? '' : key).trim();
  try {
    if (clean) localStorage.setItem(ADMIN_KEY, clean);
    else localStorage.removeItem(ADMIN_KEY);
  } catch { /* 保存できない環境では今回だけ有効 */ }
  return clean;
}

/** いま管理モードか（合言葉を持っているか）。合っているかはサーバが決める */
function isAdminMode() {
  return adminKey() !== '';
}

/** その名前の行が一覧にあるか */
function hasName(entries, name) {
  const clean = sanitizeName(name);
  return !clean ? false : entries.some((e) => sanitizeName(e.name) === clean);
}

/**
 * 一覧の中の名前を付け替える。
 * 付け替え先に同じ名前があれば、並べ替え（rankSort / starSort）が
 * **良いほうだけを残して 1 行に潰す** ―― サーバ側の付け替えと同じ結果になる。
 */
function renameEntries(entries, from, to, sort = rankSort) {
  const a = sanitizeName(from);
  const b = sanitizeName(to);
  if (!a || !b) return sort(entries);
  return sort(entries.map((e) => (sanitizeName(e.name) === a ? { ...e, name: b } : e)));
}

/** 一覧からその名前の行を落とす */
function removeEntries(entries, name, sort = rankSort) {
  const clean = sanitizeName(name);
  return sort(entries.filter((e) => sanitizeName(e.name) !== clean));
}

/**
 * 直すも消すも、端末に貯めている**すべてのレベル＋星の表**へ効かせる
 * （サーバ側の editEverywhere と同じ考えかた。端末内は全データを直接
 * 持っているので、索引を作らずそのまま全部の鍵を回すだけで済む）。
 */
function editLocalEverywhere(board, level, name, to) {
  const rename = !!to;
  const apply = (entries, sort) => (rename
    ? renameEntries(entries, name, to, sort)
    : removeEntries(entries, name, sort));

  const data = loadLocal();
  let changed = false;
  for (const key of Object.keys(data)) {
    const before = data[key] || [];
    changed = changed || hasName(before, name);
    data[key] = apply(before, rankSort).slice(0, RANK_LIMIT);
  }
  saveLocal(data);

  const starsBefore = loadStars();
  changed = changed || hasName(starsBefore, name);
  const starsAfter = apply(starsBefore, starSort).slice(0, RANK_LIMIT);
  try { localStorage.setItem(STAR_KEY, JSON.stringify(starsAfter)); } catch { /* 諦める */ }

  // 応答は、いま見ている表だけを返す（他の表は裏で直っている）
  const entries = board === 'stars' ? starsAfter : (data[String(level)] || []);
  return { changed, entries };
}

/**
 * 名前を直す／記録を消す。**合言葉を持っているときだけ**通る。
 *
 * どちらも**その人の記録があるすべての表**（星の表とレベル別の全レベル）に
 * 効かせる。1 つの表だけ相手にすると、他の表に古い名前が残って「直したのに
 * 変わっていない」「消したのにまだ居る」ことになるため。
 *
 * @param {{action:'rename'|'delete', board:'level'|'stars', level?:number,
 *          name:string, to?:string}} cmd
 * @returns {Promise<{ok:boolean, entries:Object[], changed:boolean, error:string|null}>}
 *   error は画面にそのまま出せる日本語。ok が false のときだけ入る。
 *   changed は false でも ok は true になりうる（＝直す相手が見つからなかった）
 */
async function adminEdit(cmd) {
  const board = cmd.board === 'stars' ? 'stars' : 'level';
  const name = sanitizeName(cmd.name);
  const to = sanitizeName(cmd.to);
  const rename = cmd.action === 'rename';

  if (!name) return { ok: false, entries: [], changed: false, error: '直す相手の名前が読めません。' };
  if (rename && !to) return { ok: false, entries: [], changed: false, error: '新しい名前を入れてください。' };
  if (rename && to === name) return { ok: false, entries: [], changed: false, error: '同じ名前です。' };

  const base = endpoint();
  // 端末の中だけで遊んでいるときは、その控えを直す（画面の見え方は世界共通と同じ）
  if (!base) {
    return { ok: true, ...editLocalEverywhere(board, cmd.level, name, rename ? to : ''), error: null };
  }

  const key = adminKey();
  if (!key) return { ok: false, entries: [], changed: false, error: '管理の合言葉がありません。' };

  try {
    const payload = await request(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Admin-Key': key,
      },
      body: JSON.stringify({
        action: rename ? 'rename' : 'delete',
        board,
        level: cmd.level,
        name,
        ...(rename ? { to } : {}),
      }),
    }, ADMIN_TIMEOUT_MS);
    const changed = !!(payload && payload.changed);
    let entries = entriesOf(payload, board === 'stars' ? starSort : rankSort);
    if (!entries) {
      // 一覧が返ってこなかったら取り直す（直したこと自体は成功している）
      const got = board === 'stars' ? await fetchStarRanking() : await fetchRanking(cmd.level);
      entries = got.entries;
    }
    return { ok: true, entries, changed, error: null };
  } catch (err) {
    const status = String(err && err.message);
    let error = 'サーバーに届きませんでした。時間をおいて試してください。';
    if (/HTTP 40[13]/.test(status)) error = '合言葉が違います（サーバーに断られました）。';
    else if (/HTTP 503/.test(status)) error = 'サーバーに合言葉が設定されていません。';
    return { ok: false, entries: [], changed: false, error };
  }
}

// ---------------------------------------------------------------- 端末内の記録

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(RANK_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveLocal(data) {
  try { localStorage.setItem(RANK_KEY, JSON.stringify(data)); } catch { /* 諦める */ }
}

/**
 * 並べ替えと重複の始末。
 * 同じ名前は**その人のいちばん良い1件**だけを残す。同じ人が上位を埋めると、
 * 何人が挑んだのかが分からなくなる。
 */
function rankSort(entries) {
  const best = new Map();
  for (const e of entries) {
    const name = sanitizeName(e.name) || '???';
    const row = {
      name,
      moves: Math.max(0, Math.round(Number(e.moves) || 0)),
      time: Math.max(0, Math.round(Number(e.time) || 0)),
      stars: Math.max(0, Math.min(3, Math.round(Number(e.stars) || 0))),
      at: Number(e.at) || 0,
    };
    const cur = best.get(name);
    if (!cur || row.moves < cur.moves || (row.moves === cur.moves && row.time < cur.time)) {
      best.set(name, row);
    }
  }
  return [...best.values()].sort((a, b) => a.moves - b.moves || a.time - b.time || a.at - b.at);
}

/** 端末内ランキングを読む */
function localEntries(level) {
  return rankSort(loadLocal()[String(level)] || []);
}

/** 端末内ランキングに1件足して、並べ直したものを返す */
function pushLocal(level, entry) {
  const data = loadLocal();
  const key = String(level);
  data[key] = rankSort([...(data[key] || []), entry]).slice(0, RANK_LIMIT);
  saveLocal(data);
  return data[key];
}

/** 端末内ランキングを空にする（「データを消す」から呼ぶ）。表は2つとも消す */
function clearLocalRanking() {
  for (const key of [RANK_KEY, STAR_KEY]) {
    try { localStorage.removeItem(key); } catch { /* 諦める */ }
  }
}

// ---------------------------------------------------------------- 星の数の表

/**
 * 星の数の並べ替えと重複の始末。
 *
 * 星の多い順。同数ならクリア数の少ない順（同じ星を少ないレベルで集めた人が上）、
 * それも同じなら先に出した方が上。レベル別と同じく**1人1行**に潰す ――
 * 星の総数はその人の現在地なので、古い記録が並ぶ意味がない。
 */
function starSort(entries) {
  const best = new Map();
  for (const e of entries) {
    const name = sanitizeName(e.name) || '???';
    const row = {
      name,
      stars: Math.max(0, Math.round(Number(e.stars) || 0)),
      cleared: Math.max(0, Math.round(Number(e.cleared) || 0)),
      at: Number(e.at) || 0,
    };
    const cur = best.get(name);
    if (!cur || row.stars > cur.stars || (row.stars === cur.stars && row.cleared < cur.cleared)) {
      best.set(name, row);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.stars - a.stars || a.cleared - b.cleared || a.at - b.at);
}

function loadStars() {
  try {
    const data = JSON.parse(localStorage.getItem(STAR_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** 端末内の星ランキングを読む */
function localStarEntries() {
  return starSort(loadStars());
}

/** 端末内の星ランキングに1件足して、並べ直したものを返す */
function pushStars(entry) {
  const list = starSort([...loadStars(), entry]).slice(0, RANK_LIMIT);
  try { localStorage.setItem(STAR_KEY, JSON.stringify(list)); } catch { /* 諦める */ }
  return list;
}

// ---------------------------------------------------------------- 通信

/**
 * 応答の形を吸収する。素の配列でも { entries: [...] } でも受け取る。
 * 並べ替えはこちらでやり直す ―― サーバが正しい順で返す保証はないし、
 * 壊れた行を落とすのもこの関数の仕事。
 */
function entriesOf(payload, sort = rankSort) {
  if (Array.isArray(payload)) return sort(payload);
  if (payload && Array.isArray(payload.entries)) return sort(payload.entries);
  return null;
}

async function request(url, init = {}, timeout = TIMEOUT_MS) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  try {
    const res = await fetch(url, { ...init, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * ランキングを取る。
 * @returns {Promise<{entries:Object[], global:boolean, offline:boolean}>}
 *   offline = 世界共通に繋ぐ設定なのに届かなかった（端末内の記録を返している）
 */
async function fetchRanking(level) {
  const base = endpoint();
  if (!base) return { entries: localEntries(level), global: false, offline: false };
  try {
    const url = `${base}${base.includes('?') ? '&' : '?'}level=${encodeURIComponent(level)}&limit=${RANK_LIMIT}`;
    const entries = entriesOf(await request(url, { headers: { Accept: 'application/json' } }));
    if (!entries) throw new Error('形式が違う応答');
    return { entries, global: true, offline: false };
  } catch {
    return { entries: localEntries(level), global: true, offline: true };
  }
}

/**
 * 記録を出す。**端末内には必ず残す**ので、通信が失敗しても記録は消えない。
 *
 * @returns {Promise<{entries:Object[], rank:number|null, global:boolean, offline:boolean}>}
 *   rank は 1 始まりの順位。分からなければ null
 */
async function submitScore({ level, name, moves, time, stars }) {
  const entry = {
    name: sanitizeName(name) || '???',
    moves: Math.max(0, Math.round(Number(moves) || 0)),
    time: Math.max(0, Math.round(Number(time) || 0)),
    stars: Math.max(0, Math.min(3, Math.round(Number(stars) || 0))),
    at: Date.now(),
  };
  const local = pushLocal(level, entry);
  const base = endpoint();

  if (!base) {
    return { entries: local, rank: rankOf(local, entry), global: false, offline: false };
  }

  try {
    const payload = await request(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ level, ...entry }),
    });
    // サーバが一覧を返してくれたらそれを使う。返さないなら改めて取りに行く
    let entries = entriesOf(payload);
    if (!entries) {
      const got = await fetchRanking(level);
      if (got.offline) throw new Error('投稿後の取得に失敗');
      entries = got.entries;
    }
    const rank = payload && Number.isFinite(payload.rank) && payload.rank > 0
      ? Math.round(payload.rank)
      : rankOf(entries, entry);
    return { entries, rank, global: true, offline: false };
  } catch {
    return { entries: local, rank: rankOf(local, entry), global: true, offline: true };
  }
}

/** 一覧の中でその記録が何位か（1 始まり）。見つからなければ null */
function rankOf(entries, entry) {
  if (!entries) return null;
  const name = sanitizeName(entry.name) || '???';
  const i = entries.findIndex((e) => e.name === name && e.moves === entry.moves);
  return i >= 0 ? i + 1 : null;
}

/** 星の一覧の中でその人が何位か（1 始まり）。見つからなければ null */
function starRankOf(entries, name) {
  if (!entries) return null;
  const clean = sanitizeName(name) || '???';
  const i = entries.findIndex((e) => e.name === clean);
  return i >= 0 ? i + 1 : null;
}

// ---------------------------------------------------------------- 星の数（通信）

/** 星ランキングの入口。レベル別と同じ URL を board で振り分ける */
function starUrl(base) {
  return `${base}${base.includes('?') ? '&' : '?'}board=stars&limit=${RANK_LIMIT}`;
}

/**
 * 星の数のランキングを取る。
 * @returns {Promise<{entries:Object[], global:boolean, offline:boolean}>}
 */
async function fetchStarRanking() {
  const base = endpoint();
  if (!base) return { entries: localStarEntries(), global: false, offline: false };
  try {
    const payload = await request(starUrl(base), { headers: { Accept: 'application/json' } });
    const entries = entriesOf(payload, starSort);
    if (!entries) throw new Error('形式が違う応答');
    return { entries, global: true, offline: false };
  } catch {
    return { entries: localStarEntries(), global: true, offline: true };
  }
}

/**
 * いま持っている星の数を出す。レベル別と違って**上書き**の投稿 ――
 * 星の総数はその人の現在地なので、増えるたびに同じ行を書き替えていく。
 *
 * @returns {Promise<{entries:Object[], rank:number|null, global:boolean, offline:boolean}>}
 */
async function submitStars({ name, stars, cleared }) {
  const entry = {
    name: sanitizeName(name) || '???',
    stars: Math.max(0, Math.round(Number(stars) || 0)),
    cleared: Math.max(0, Math.round(Number(cleared) || 0)),
    at: Date.now(),
  };
  const local = pushStars(entry);
  const base = endpoint();

  if (!base) {
    return { entries: local, rank: starRankOf(local, entry.name), global: false, offline: false };
  }

  try {
    const payload = await request(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ board: 'stars', ...entry }),
    });
    let entries = entriesOf(payload, starSort);
    if (!entries) {
      const got = await fetchStarRanking();
      if (got.offline) throw new Error('投稿後の取得に失敗');
      entries = got.entries;
    }
    const rank = payload && Number.isFinite(payload.rank) && payload.rank > 0
      ? Math.round(payload.rank)
      : starRankOf(entries, entry.name);
    return { entries, rank, global: true, offline: false };
  } catch {
    return { entries: local, rank: starRankOf(local, entry.name), global: true, offline: true };
  }
}

// ===== src/sheet.js =====
// シートを下へ払って閉じる。
//
// 下から せり上がってくる紙は、指で下へ押し戻せないと嘘に見える。閉じるボタンは
// 右上の小さな丸ひとつしかないので、盤面を見ながら片手で持っているときほど遠い ――
// 「開いてしまったから閉じる」だけの操作に、画面の端まで指を運ばせない。
//
// 作りの要点:
//
//   ・**指の位置にそのまま付いてくる**。しきい値を超えた瞬間に消えるのではなく、
//     下げたぶんだけ下がり、背景の暗さも一緒に薄くなる。途中で気が変わったら
//     戻せる ―― 戻せるからこそ、思い切って引ける。
//   ・**中身が上まで来ているときだけ**引き下げる。ルールのシートは長くて縦に
//     スクロールするので、読んでいる途中の下向きスワイプでシートごと落ちたら
//     読めたものではない。
//   ・touch イベントを直に使う。Pointer Events だと、シートを閉じる向きの指を
//     つかむために touch-action: none が要り、そうすると中身がスクロールできない。
//     「スクロールを始めてよいか」をこちらで決めたいので、touchmove を
//     preventDefault できる形にしてある（passive: false）。

/** ここまで下げたら「引き下げ」とみなす。それ未満は中身のスクロールに譲る */
const SHEET_GRAB = 8;
/** カードの高さのこれだけ下げたら、離した時点で閉じる */
const SHEET_CLOSE_RATIO = 0.3;
/** px/ms。速く払われたら、下げた距離が足りなくても閉じる */
const SHEET_FLICK = 0.5;
/** 払いで閉じると認める最小の距離。指が触れただけで閉じないための床 */
const SHEET_FLICK_MIN = 24;

/** 触っている指を changedTouches から拾う */
function touchOf(list, id) {
  for (const t of list) if (t.identifier === id) return t;
  return null;
}

/**
 * 開くときに呼ぶ。前に引きずった跡（位置・背景の濃さ・畳む途中のアニメ）を消す。
 * これを忘れると、閉じかけの姿のまま次のシートが開く。
 */
function resetSheet(sheet) {
  const card = sheet && sheet.querySelector('.sheet-card');
  if (!card) return;
  card.classList.remove('dragging', 'settling', 'dropping');
  card.style.transform = '';
  card.style.animation = '';
  sheet.classList.remove('closing');
  sheet.style.removeProperty('--sheet-shade');
}

/**
 * シートに「下へ払って閉じる」を付ける。
 *
 * @param {HTMLElement} sheet .sheet（背景の暗幕ごと）
 * @param {{ canClose?: () => boolean, onClose?: () => void }} opts
 *   canClose 閉じてよいか（名前を決めるシートは決めきるまで false）
 *   onClose  閉じ切ったときに呼ばれる。実際に隠すのは呼び出し側の仕事
 */
function attachSheetSwipe(sheet, opts = {}) {
  const canClose = opts.canClose || (() => true);
  const onClose = opts.onClose || (() => {});
  const card = sheet && sheet.querySelector('.sheet-card');
  if (!card) return;

  /** つかんでいる指。null なら見ていない */
  let touchId = null;
  let x0 = 0;
  let y0 = 0;
  let lastY = 0;
  let lastT = 0;
  /** 下げた量（px）と、直近の速度（px/ms） */
  let dy = 0;
  let vy = 0;
  let dragging = false;
  let timer = 0;

  /** 指の位置を、カードの下がり具合と背景の薄さに写す */
  const paint = (y) => {
    card.style.transform = y > 0 ? `translate3d(0,${y.toFixed(1)}px,0)` : '';
    const h = card.offsetHeight || 1;
    // 下げ切る手前で背景が透明になるほうが「もう閉じる」と伝わる
    const shade = Math.max(0, 1 - (y / h) * 1.4);
    sheet.style.setProperty('--sheet-shade', shade.toFixed(3));
  };

  /** 指を離したあとの後始末。done は畳み終わり／戻り終わりで呼ばれる */
  const after = (ms, done) => {
    clearTimeout(timer);
    timer = setTimeout(done, ms);
  };

  /** 元の位置へ戻す */
  const settle = () => {
    card.classList.add('settling');
    paint(0);
    after(420, () => {
      card.classList.remove('settling');
      card.style.animation = '';
      sheet.style.removeProperty('--sheet-shade');
    });
  };

  /** 下まで畳んでから閉じる */
  const drop = () => {
    card.classList.add('dropping');
    card.style.transform = 'translate3d(0,100%,0)';
    // 暗幕もカードと同じ時間をかけて引く（先に消えると紙だけが取り残される）
    sheet.classList.add('closing');
    sheet.style.setProperty('--sheet-shade', '0');
    after(240, () => {
      resetSheet(sheet);
      onClose();
    });
  };

  card.addEventListener('touchstart', (e) => {
    if (touchId != null || e.touches.length !== 1) return;
    if (!canClose()) return;
    // 入力欄の中は、文字を選ぶために指が縦に動く。ここを掴むとキーボードが
    // 出ている最中にシートが落ちる
    const target = e.target;
    if (target instanceof Element && target.closest('input, textarea, select')) return;

    const t = e.touches[0];
    touchId = t.identifier;
    x0 = t.clientX;
    y0 = t.clientY;
    lastY = t.clientY;
    lastT = e.timeStamp;
    dy = 0;
    vy = 0;
    dragging = false;
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (touchId == null) return;
    const t = touchOf(e.changedTouches, touchId);
    if (!t) return;

    if (!dragging) {
      const gx = t.clientX - x0;
      const gy = t.clientY - y0;
      // 横に払っている／上へ動かしている＝中身を読みたい。この指はもう見ない
      if (Math.abs(gx) > Math.abs(gy) || gy < -2) { touchId = null; return; }
      if (gy < SHEET_GRAB) return;
      // 中身が上まで来ていないなら、下向きは「上へスクロール」の意味になる
      if (card.scrollTop > 0) { touchId = null; return; }
      // すでにブラウザがスクロールを始めていたら、もう横取りできない
      if (!e.cancelable) { touchId = null; return; }
      dragging = true;
      // 戻っている途中で掴み直されることがある。残っている transition を外さないと、
      // ここから先の指の動きが 0.4 秒遅れて付いてくる
      clearTimeout(timer);
      card.classList.remove('settling', 'dropping');
      card.classList.add('dragging');
      // せり上がりの途中で掴まれることがある。走っているアニメは
      // インラインの transform より強いので、ここで降ろす
      card.style.animation = 'none';
      // つかんだ瞬間にカードが SHEET_GRAB ぶん飛ばないよう、原点をずらす
      y0 += SHEET_GRAB;
    }

    if (e.cancelable) e.preventDefault();
    dy = Math.max(0, t.clientY - y0);
    if (e.timeStamp > lastT) vy = (t.clientY - lastY) / (e.timeStamp - lastT);
    lastY = t.clientY;
    lastT = e.timeStamp;
    paint(dy);
  }, { passive: false });

  const release = (e) => {
    if (touchId == null) return;
    if (!touchOf(e.changedTouches, touchId)) return;
    touchId = null;
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');

    const h = card.offsetHeight || 1;
    const far = dy > h * SHEET_CLOSE_RATIO;
    const flicked = vy > SHEET_FLICK && dy > SHEET_FLICK_MIN;
    if (canClose() && (far || flicked)) drop();
    else settle();
  };

  card.addEventListener('touchend', release);
  card.addEventListener('touchcancel', release);
}

// ===== src/ads.js =====
// 広告（忍者AdMax）。
//
// 忍者AdMax の非同期タグは 3 つでひと組になっている。
//
//   1. 置き場所      <div class="admax-ads" data-admax-id="…" style="width:…;height:…">
//   2. 依頼          window.admaxads.push({ admax_id:"…", type:"banner" })
//   3. 描画スクリプト <script src="https://adm.shinobi.jp/st/t.js" async>
//
// 3 が読み込まれた時点で、2 に積まれた依頼を順に見て 1 を埋める。
// このゲームは画面を 1 枚の HTML で切り替える作りなので、素直に貼ると
// 「最初に読み込んだときの依頼しか描かれない」ことになる。そこで:
//
//   枠は「その画面を初めて出したとき」に組み立てる。
//     見てもいない画面の広告まで最初にまとめて呼ぶと、表示されないまま
//     回数だけが増える。開いた画面のぶんだけ呼ぶ。
//
//   依頼を積んだら、t.js を貼り直す。
//     t.js は読み込まれた瞬間に、そのとき積まれている依頼を処理して終わる。
//     後から積んだぶんを描かせるには、もう一度読み込ませるのがいちばん確実
//     （クライアント側で画面を切り替える作りでは、これが定石になっている）。
//
//   1 つの枠は 1 回だけ組み立てる。
//     画面を行き来するたびに広告を呼び直さない。枠はそのまま残す。

const ADMAX_SCRIPT = 'https://adm.shinobi.jp/st/t.js';

/** 枠の名前 → 置き場所の id */
const AD_BOX_IDS = {
  home: 'ad-home',
  levels: 'ad-levels',
  game: 'ad-game',
  clear: 'ad-clear',
};

/** 広告ユニットの ID は英数字。書き間違いをここで落とす */
function admaxSlot(name) {
  const slot = (ADMAX.slots || {})[name];
  const id = String((slot && slot.id) || '').trim();
  if (!/^[0-9a-zA-Z]{8,}$/.test(id)) return null;
  // file:// では広告は動かない（オフライン起動でも同じ扱いでよい）
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return {
    id,
    type: slot.type === 'switch' ? 'switch' : 'banner',
    width: Number(slot.width) > 0 ? Number(slot.width) : 320,
    height: Number(slot.height) > 0 ? Number(slot.height) : 50,
  };
}

/** t.js を貼り直して、積んである依頼を描かせる */
function runAdmax() {
  // 前回のものは残しておいても意味が無いので片付ける
  for (const old of document.querySelectorAll('script[data-admax-loader]')) old.remove();
  const el = document.createElement('script');
  el.async = true;
  el.src = ADMAX_SCRIPT;
  el.dataset.admaxLoader = '1';
  document.body.appendChild(el);
}

/** 組み立て済みの枠。同じ枠を二度呼ばない */
const adsBuilt = new Set();

/**
 * 「画面の下に貼り付く形（帯）で配信されたか」を見張る。
 *
 * 忍者AdMax は広告枠の種類によって、置いた枠の中ではなく**画面の下端に固定した
 * 帯**として広告を出す。そのときこちらの枠には何も入らないので、放っておくと
 * 「広告」の文字だけが宙に浮き、下の帯がツールバーを覆ってしまう。
 *
 * 枠に何も入らなかったら帯とみなして、画面の下に帯のぶんの余白を空ける。
 * 逆に枠の中に入ったなら、それは並びの中に出る形なので余白は要らない。
 * どちらで配信されるかは呼んでみるまで分からないので、結果を見て決めている。
 */
function watchAnchor(ins) {
  const root = document.documentElement;
  const filled = () => ins.firstChild != null;

  if (filled()) { root.classList.remove('ads-anchor'); return; }

  const mo = new MutationObserver(() => {
    if (!filled()) return;
    root.classList.remove('ads-anchor');
    mo.disconnect();
  });
  mo.observe(ins, { childList: true });

  // 届かないまま黙っていることもある。少し待って、入っていなければ帯とみなす
  setTimeout(() => {
    if (!filled()) root.classList.add('ads-anchor');
    mo.disconnect();
  }, 2000);
}

/**
 * 広告の枠。画面を出す側から `ads.show('home')` のように呼ぶ。
 *
 * 設定が空なら全て空振りする ―― 呼ぶ側に「広告があるかどうか」を持たせない。
 */
const ads = {
  /** その場所の広告を出す（設定が無ければ何もしない） */
  show(name) {
    const box = document.getElementById(AD_BOX_IDS[name]);
    const slot = box ? admaxSlot(name) : null;
    if (!slot) return;

    box.hidden = false;
    if (adsBuilt.has(name)) return;
    // すでに画面の下に帯が出ているなら、これ以上は呼ばない。帯はページに 1 本しか
    // 出ないので、枠を増やしても誰にも見えない広告を呼ぶだけになる
    if (document.documentElement.classList.contains('ads-anchor')) return;
    adsBuilt.add(name);

    // 読み込みの前後で画面が飛び跳ねないよう、先に高さぶんの場所を取る
    box.style.setProperty('--ad-h', `${slot.height}px`);

    const ins = document.createElement('div');
    ins.className = 'admax-ads';
    ins.dataset.admaxId = slot.id;
    ins.style.display = 'inline-block';
    ins.style.width = `${slot.width}px`;
    ins.style.height = `${slot.height}px`;
    box.appendChild(ins);

    (window.admaxads = window.admaxads || []).push({ admax_id: slot.id, type: slot.type });
    runAdmax();
    watchAnchor(ins);
  },

  /** その場所の広告を引っ込める（読み込み中のカードなど、出したくない場面用） */
  hide(name) {
    const box = document.getElementById(AD_BOX_IDS[name]);
    if (box) box.hidden = true;
  },

  /**
   * クリアの表示に切り替える。
   *
   * ゲーム画面の広告はいったん引っ込める ―― クリアのカードのすぐ下に 2 枚
   * 並ぶと、見た目にうるさいだけでなく、カードが縮んでボタンが隠れる。
   * 引っ込めるのは表示だけで、広告を呼び直しはしない。
   */
  showClear() {
    // 入れ替える相手が居るときだけ引っ込める。clear の枠を作っていないなら、
    // ゲーム画面の広告はそのまま出しておく（消しても何も入らない）
    if (admaxSlot('clear')) this.hide('game');
    this.show('clear');
  },

  /** クリアの表示を畳んで、ゲーム画面の広告を戻す */
  hideClear() {
    this.hide('clear');
    this.show('game');
  },
};

// ===== src/game.js =====
// ゲーム進行・アニメーション・UI 配線。
//
// 画面は3つ（ホーム / レベル一覧 / ゲーム）。同時に見えるのは常に1つだけ。
//
// レベルに鍵はかかっていない。どのレベルにもいつでも入れる ―― 1つ詰まったら
// 先へ行って戻ってくればいいし、いきなり上から始めてもいい。進行状況は
// 「到達レベル」と「レベルごとの星・自己ベスト」だけで表せる。
//
// 星は「何手で解いたか」で決まる。基準の par は厳密な最短手数なので、
// ★★★ は「最短で解いた」という、あいまいさのない達成になる。

/**
 * 保存領域。
 * 星の意味が「解けるまでの時間」から「解いた手数」に変わったので、v4 の記録を
 * そのまま読むと数字の意味が食い違う。鍵を分けて、引き継ぐのは到達レベルと
 * 設定だけにしてある。
 */
const STORE_KEY = 'slidepop.v5';
/** 星を時間で付けていた頃（v4）と、手数で付けていた頃（v3）の記録 */
const LEGACY_KEYS = ['slidepop.v4', 'slidepop.v3'];
/** 初回にルールを開いたかどうか。「データを消す」はここも戻す */
const RULES_KEY = 'slidepop.seenRules';

/** 設定の初期値。「データを消す」でここへ戻る */
const DEFAULT_SETTINGS = {
  sound: true, haptics: true, symbols: false, ghost: true, calm: false,
  /** ブロックのデザイン。見た目だけが変わり、盤面もルールも変わらない */
  material: DEFAULT_MATERIAL,
};

/** レベル一覧の1ページに並べる数 */
const PAGE_SIZE = 30;

/**
 * 触覚の膜を敷くボタン（iPhone だけ）。
 *
 * **盤面（#board）は入っていない。** ドラッグを伴う面にネイティブのスイッチを
 * 置くと、実機の WebKit ではスイッチ自身がタッチを掴み、ブロックが動かせなくなる。
 * 押すだけのボタンに限る。
 */
const HAPTIC_TAP_TARGETS = '.dock-item, .dock-circle, .circle-btn, .btn, .pager, .link-btn';
const HAPTIC_TAP_CLASS = 'haptic-tap';
const HAPTIC_HOST_CLASS = 'has-haptic-tap';

/** レベル一覧・ホームに出す、遊ぶ前のプレビュー文 */
function levelPreview(level) {
  return levelSummary(levelConfig(level));
}

/**
 * 前の版の記録を引き継ぐ。
 * 星とベスト記録は意味が変わってしまうので持ち込まず、「どこまで進んでいたか」と
 * 設定だけを残す ―― 進みが巻き戻るのがいちばん理不尽なので。
 */
function migrateLegacy(data) {
  // 鍵をかけていた頃の「解放済みレベル」は、いまは「到達レベル」の意味で使う
  if (data.reached == null && data.unlocked) data.reached = data.unlocked;
  if (data.reached != null) return data;
  for (const key of LEGACY_KEYS) {
    try {
      const old = JSON.parse(localStorage.getItem(key) || '{}');
      const reached = old.reached || old.unlocked;
      if (reached) data.reached = reached;
      if (old.settings) data.settings = { ...old.settings, ...(data.settings || {}) };
      if (data.reached != null) break;
    } catch { /* 読めなければ次へ */ }
  }
  return data;
}

function loadStore() {
  try {
    return migrateLegacy(JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
  } catch {
    return {};
  }
}

function saveStore(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* プライベートモードなどでは黙って諦める */ }
}

class Game {
  constructor(dom) {
    this.dom = dom;
    this.renderer = new Renderer(dom.canvas);
    this.board = new Board();
    this.store = loadStore();
    this.settings = Object.assign({ ...DEFAULT_SETTINGS }, this.store.settings || {});
    this.sound = new Sound();
    this.clearCelebration = new ClearEffects();
    this.puzzle = null;
    this.history = [];
    this.moves = 0;
    /** 解くのにかかった時間（秒）。星には使わない。記録として見せるだけ */
    this.elapsed = 0;
    this.shownTime = -1;
    this.status = 'idle';
    this.level = 1;
    this.loadToken = 0;
    this.screen = 'home';
    /** レベル一覧のページ（0 始まり） */
    this.page = 0;
    /** Android/Chrome が渡してくるインストールの入口。iOS では常に null */
    this.installPrompt = null;

    this.anim = null;
    this.invalid = null;
    this.selected = null;
    this.ghost = null;

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    /** 星のしきい値（手数）。レベルを読み込んだ時点で最短手数から決まる */
    this.targets = null;
    this.newRecord = false;
    /** 連続で消せた回数。増えるほど消去音の音程が上がる */
    this.combo = 0;

    /* --- 解へどれだけ近いか（色のグラデーションと「いいね」の判定に使う） --- */
    /**
     * 全探索の作業場。
     *
     * レベルを読み込むたびに「到達できる盤面すべての、ゴールまでの最短距離」を
     * 配り直す。以後はどの局面でも表を 1 回引くだけで**残り手数が厳密に分かる**。
     * 実測で状態数は 6千〜7万、配り終えるのに 15〜600ms ―― 読み込みの一度きりなら
     * 払える。表もキューも作り置きして使い回す（毎回確保すると 10MB が何度も動く）。
     */
    this.solver = null;
    /** いま距離を配ってある盤面の定義。null なら全探索はまだ／使えていない */
    this.solverCtx = null;
    /** 配っている最中の盤面の定義。遊びながら少しずつ進める */
    this.solvePending = null;
    /** 色つきブロックの id（探索へ渡すのに要る） */
    this.colorIds = null;
    /** いまの局面からゴールまでの残り手数（厳密）。分からなければ null */
    this.remaining = null;

    /** 手順どおりに指した各局面の指紋 -> 何手目か（全探索が使えないときの控え） */
    this.pathIndex = null;
    /** 初期盤面での色つき2個の隙間。ここからどれだけ詰まったかを測る */
    this.startGap = 0;
    /** これまでに届いた「いちばん先」。ここを更新したときだけ褒める */
    this.bestStep = 0;
    this.bestGap = Infinity;
    this.progress = 0;
    /** 背景にいま書き込んである「水位と色」（毎フレーム塗り直さないための控え） */
    this.paintedAura = '';
    /** 直前に動かしたブロック。スタンプを貼る場所になる */
    this.lastMovedId = null;

    /* --- ランキング --- */
    /** 名前を決めきるまで閉じられないシート（クリア直後） */
    this.nameLocked = false;
    // 管理の直す・消すは全レベルを探しに行くので、返事まで数秒かかる。そのあいだ立てる旗
    this.adminBusy = false;
    /** 直前の管理操作の結果。お知らせが流れても読めるよう、帯に残しておく */
    this.adminReport = '';
    /** 投稿・取得の世代。レベルを跨いだ古い応答を捨てるために使う */
    this.rankToken = 0;
    this.rankViewToken = 0;
    /** いま見ているランキングの表（'stars' = 星の数 / 'level' = レベル別） */
    this.rankBoard = 'stars';
    /** レベル別の表で見ているレベル */
    this.rankLevel = 1;

    this.applySettings();
    this.bindUi();
    this.bindInput();
    // すでに星を持っている人を、星のランキングに載せる（名前があるときだけ）
    this.postStars();

    const ro = new ResizeObserver(() => this.renderer.resize(this.board.size));
    ro.observe(dom.canvas);
    window.addEventListener('resize', () => this.renderer.resize(this.board.size));

    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ 進行状況

  /**
   * 到達レベル ―― まだクリアしていない、いちばん手前のレベル。
   * 鍵ではない。どのレベルにもいつでも入れる。これは「つづきから」の行き先と、
   * レベル一覧でいまいる場所を示すためだけに使う。
   */
  get reachedLevel() {
    return Math.max(1, Math.floor(this.store.reached) || 1);
  }

  /** そのレベルで取った星（0 = 未クリア） */
  starsOf(level) {
    return (this.store.stars || {})[String(normalizeLevel(level))] || 0;
  }

  /** そのレベルの自己ベスト（手数）。未クリアなら null */
  bestMovesOf(level) {
    const t = (this.store.best || {})[String(normalizeLevel(level))];
    return typeof t === 'number' ? t : null;
  }

  /** 星の総数 */
  get totalStars() {
    return Object.values(this.store.stars || {}).reduce((a, b) => a + b, 0);
  }

  /** クリア済みレベル数 */
  get clearedCount() {
    return Object.keys(this.store.stars || {}).length;
  }

  // ------------------------------------------------------------ 解への近さ
  //
  // 盤面の色も背景の光も、この「近さ」ひとつで決まる。数字は出さない ――
  // 残り手数を数字で出すと、盤面ではなく数字を見ながら遊ぶことになる。
  // 温度だけが変わっていくなら、視線を盤面から外さずに近さが伝わる。

  /**
   * この盤面の「全部の局面からゴールまでの最短距離」を配る。
   *
   * ここが効くのは、**遊んでいる最中に残り手数を厳密に言える**ようになること。
   * 焼いてある解答は最短手順の 1 本でしかないので、そこから外れた瞬間に
   * 「あと何手か」が分からなくなる。距離を全部の局面に配っておけば、
   * プレイヤーがどこへ迷い込んでも、そこからの残り手数がそのまま引ける ――
   * 別の最短手順に乗り換えただけの手を「間違い」と誤解することも無くなる。
   *
   * 状態数が多すぎて配りきれないときは false を返す（そのときは焼いてある
   * 手順との突き合わせに落ちる）。
   */
  beginDistances(puzzle) {
    this.solverCtx = null;
    this.solvePending = null;
    this.remaining = null;
    try {
      const board = new Board(puzzle.size);
      board.restore(puzzle.snapshot);
      this.colorIds = [...board.pieces.values()]
        .filter((p) => p.color !== BLOCKER).map((p) => p.id);
      const ctx = compile(board, this.colorIds);
      if (!this.solver) this.solver = new Explorer(140000);
      this.solver.begin(ctx);
      this.solvePending = ctx;
    } catch {
      // 盤面が大きすぎる・ブロックが多すぎるなど。控えの物差しに任せる
      this.solvePending = null;
    }
  }

  /**
   * 距離を配る続きを、フレームの余りだけ進める。
   *
   * 予算はアニメーション中だけ絞る。滑っている最中に大きく食うと、
   * いちばん見られている 0.3 秒がガタつく ―― 待っているのは色だけなので、
   * そこは譲ってよい。
   */
  advanceDistances() {
    if (!this.solvePending || !this.solver) return;
    const phase = this.solver.step(this.busy ? 2 : 7);
    if (phase === 'done') {
      this.solverCtx = this.solvePending;
      this.solvePending = null;
      // 配り終わった時点の局面で測り直す。ここまでは控えの物差しで動いていたので、
      // 色が少しだけ跳ぶことがある（表示側がなめらかに追いつく）
      this.updateProgress(null);
    } else if (phase === 'failed') {
      this.solvePending = null;
    }
  }

  /** いまの局面からゴールまでの残り手数（厳密）。分からなければ null */
  distanceToGoal() {
    if (!this.solverCtx || !this.solver) return null;
    if (this.board.isCleared) return 0;
    const pos = positionsOf(this.solverCtx, this.board, this.colorIds);
    if (!pos) return null;
    const d = this.solver.distanceOf(pos);
    return d === undefined ? null : d;
  }

  /**
   * 手順どおりに指した各局面の指紋 -> 何手目か、の索引。
   *
   * 全探索が使えなかったときの控え。焼いてある解答は**厳密な最短手順**なので、
   * その線上にいるかどうかは指紋の一致だけで判定できる。
   */
  buildPath(puzzle) {
    const board = new Board(puzzle.size);
    board.restore(puzzle.snapshot);
    const index = new Map([[board.fingerprint(), 0]]);
    for (let i = 0; i < puzzle.solution.length; i++) {
      const step = puzzle.solution[i];
      if (!board.applyMove(step.pieceId, step.dir)) break;
      index.set(board.fingerprint(), i + 1);
    }
    return index;
  }

  /** 色つき2個の隙間（0 = 上下左右で隣り合っている＝解けた形） */
  colorGap(board) {
    const colored = [...board.pieces.values()].filter((p) => p.color !== BLOCKER);
    if (colored.length < 2) return 0;
    let best = Infinity;
    for (const [ax, ay] of colored[0].cells) {
      for (const [bx, by] of colored[1].cells) {
        const d = Math.abs(ax - bx) + Math.abs(ay - by);
        if (d < best) best = d;
      }
    }
    return Math.max(0, best - 1);
  }

  /**
   * 進み具合を測り直し、色に反映し、前に進んでいたら褒める。
   *
   * 測り方は2つあって、**大きいほうを採る**:
   *   ・解法の線上にいるなら、そこが何手目か（いちばん確かな物差し）
   *   ・外れているなら、色つき2個の隙間がどれだけ詰まったか
   * 線から外れた瞬間に色が 0 まで戻ると、遠回りしただけで景色が真っ白に
   * 巻き戻ってしまう。隙間のほうを保険に置くことでそれを防いでいる。
   *
   * @param {number|null} movedPieceId 直前に動かしたブロック（褒めるときの貼り先）
   * @param {boolean} reset レベルを読み込み直したとき。色を瞬時に合わせ、記録も引き直す
   */
  updateProgress(movedPieceId = null, reset = false) {
    if (!this.puzzle) return;
    const par = Math.max(1, this.puzzle.par);
    const before = this.remaining;
    const now = this.distanceToGoal();
    this.remaining = now;
    const gap = this.colorGap(this.board);

    if (now != null) {
      // 残り手数がそのまま進み具合になる。最短 par 手の盤面なら色は par 等分され、
      // 残りが 1 減るごとに 1 段進み、遠ざかればその場で 1 段戻る
      this.progress = Math.max(0, Math.min(1, (par - now) / par));
    } else {
      // 全探索が使えなかったとき。焼いてある手順の線上か、色つき同士の隙間で測る
      const step = this.pathIndex ? this.pathIndex.get(this.board.fingerprint()) : undefined;
      const byPath = step == null ? 0 : step / par;
      const byGap = this.startGap > 0 ? (this.startGap - gap) / this.startGap : 1;
      this.progress = Math.max(0, Math.min(1, Math.max(byPath, byGap)));
    }
    this.renderer.setProgress(this.progress, reset);

    if (reset) {
      this.bestGap = gap;
      this.bestStep = 0;
      return;
    }
    if (movedPieceId == null) return; // 戻す・クリアなど。色だけ合わせる

    /*
     * 褒め方は 2 段。
     *
     *   残り手数が減った  = その 1 手は**最短手順のひとつ**だった。いちばん濃く褒める
     *   隙間だけ縮まった  = 解そのものには近づいていないが、形としては寄っている
     *
     * 残り手数で見るのが肝。焼いてある手順と一致するかで見ると、**別の最短手順に
     * 乗り換えただけの手**を間違い扱いしてしまう。最短の道は 1 本ではない。
     */
    if (before != null && now != null && now < before) {
      this.cheer(movedPieceId, 0.75);
    } else if (gap < this.bestGap) {
      this.cheer(movedPieceId, 0.33);
    }
    if (gap < this.bestGap) this.bestGap = gap;
  }

  /**
   * 「いいね」のスタンプと、低いほめ音。
   * 確率で間引く ―― 毎回出ると壁紙になり、出なさすぎると気づかれない。
   */
  cheer(pieceId, chance) {
    if (Math.random() >= chance) return;
    const piece = this.board.pieces.get(pieceId);
    if (!piece) return;
    this.renderer.stamp(piece.cells, '👍', 3);
    this.sound.praise();
  }

  // ------------------------------------------------------------ パズル

  /**
   * レベルを読み込む。
   * 上のレベルほど生成に時間がかかるので、非同期版を使って
   * 「生成中」を出しながら待つ（画面が固まらない）。
   */
  async load(level) {
    const lv = normalizeLevel(level);
    const token = ++this.loadToken;
    this.showGame();

    this.status = 'loading';
    this.anim = null;
    this.selected = null;
    this.ghost = null;
    this.renderer.clearEffects();
    this.showLoading(lv);
    this.updateHud();
    // 生成を始める前に 1 フレーム譲り、「組み立て中」を確実に描かせる
    await new Promise((r) => requestAnimationFrame(r));
    if (token !== this.loadToken) return;

    let puzzle;
    try {
      // 詰まった盤面ほど「当たり」を引くまで試行が要る（最大で数秒）。
      // 何回目を試しているかを出して、止まって見えないようにする
      puzzle = await generateLevelAsync(lv, {}, (ratio) => {
        if (token === this.loadToken) this.showLoading(lv, ratio);
      });
    } catch (err) {
      console.error(err);
      if (token !== this.loadToken) return;
      this.status = 'playing';
      this.hideOverlay();
      this.toast('レベルの生成に失敗しました。もう一度お試しください。');
      return;
    }
    if (token !== this.loadToken) return; // 待っている間に別のレベルが選ばれた

    this.level = lv;
    this.puzzle = puzzle;
    this.board = new Board(puzzle.size);
    this.board.restore(puzzle.snapshot);
    this.history = [];
    this.moves = 0;
    this.elapsed = 0;
    this.combo = 0;
    this.targets = targetMoves(puzzle.par);

    this.store.lastLevel = lv;
    saveStore(this.store);

    // 解への近さを測る道具立て。ここで引き直さないと前のレベルの色を引きずる
    this.pathIndex = this.buildPath(puzzle);
    this.startGap = this.colorGap(this.board);
    this.lastMovedId = null;
    this.remaining = null;

    // 残り手数の表は**遊びながら**配る。ここで配り終わるまで待たせると、
    // 深い盤面では 0.5 秒以上のあいだ画面が固まってしまう。
    // 配り終わるまでのあいだは、焼いてある手順と隙間で色をおおまかに動かす
    this.beginDistances(puzzle);

    this.status = 'playing';
    // 色は残り手数を par 等分した段で動く。焼き上げ直しの刻みもそこに合わせる
    this.renderer.setSteps(puzzle.par);
    this.updateProgress(null, true);

    this.renderer.resize(this.board.size);
    this.hideOverlay();
    this.updateHud();
    location.hash = `#L${lv}`;
  }

  showLoading(level, ratio = 0) {
    const cfg = levelConfig(level);
    const tried = Math.round(ratio * cfg.attempts);
    this.showOverlay({
      badge: '🧩',
      title: `レベル ${level}`,
      text: `${cfg.size}×${cfg.size}・最短${cfg.par}手 の盤面を組み立てています…`
        + (tried > 0 ? `（${tried} 通り目）` : ''),
      stats: [],
      actions: [],
    });
  }

  /** 次のレベルへ */
  nextLevel() {
    this.load(this.level + 1);
  }

  restart() {
    if (!this.puzzle || this.status === 'loading') return;
    this.renderer.clearEffects();
    this.board.restore(this.puzzle.snapshot);
    this.history = [];
    this.moves = 0;
    this.elapsed = 0;
    this.combo = 0;
    this.status = 'playing';
    this.selected = null;
    this.ghost = null;
    this.anim = null;
    this.lastMovedId = null;
    this.updateProgress(null, true);
    this.hideOverlay();
    this.updateHud();
    this.toast('最初からやり直します');
  }

  // ------------------------------------------------------------ 時計

  /**
   * 時計が進む条件。
   * ゲーム画面を見ていて、まだ解けていなくて、ルールや設定のシートで
   * 手が止まっていないとき ―― つまり「盤面を読んでいる間」だけ数える。
   */
  get timing() {
    if (this.status !== 'playing' || this.screen !== 'game') return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return !this.anyModalOpen();
  }

  // ------------------------------------------------------------ 手番

  get busy() {
    return this.anim !== null;
  }

  canInteract() {
    return this.status === 'playing' && !this.busy;
  }

  tryMove(pieceId, dir) {
    if (!this.canInteract()) return;
    if (!this.board.pieces.has(pieceId)) return;

    const steps = this.board.slideDistance(pieceId, dir);
    if (steps <= 0) {
      // 無効手はブロックを小刻みに揺らして拒否。手数には数えない
      this.invalid = { pieceId, dir, t: 0 };
      this.ghost = null;
      this.sound.invalid();
      return;
    }

    this.history.push({ snap: this.board.snapshot(), moves: this.moves });
    if (this.history.length > 400) this.history.shift();

    this.ghost = null;
    this.selected = pieceId;
    this.lastMovedId = pieceId;
    this.moves++;

    this.board.movePiece(pieceId, dir, steps);
    const duration = Math.min(0.36, 0.1 + steps * 0.033);
    this.anim = { phase: 'slide', pieceId, dir, steps, t: 0, duration };
    // 摩擦の音は滑走アニメと同じ長さで鳴らす（音だけ先に終わると軽くなる）
    this.sound.slide(steps, duration);
    this.updateHud();
  }

  onSlideEnd(a) {
    this.sound.land(a.steps);
    const group = this.board.colorGroup(a.pieceId);

    if (group.length < 2) {
      // 何も消えない手。連鎖は途切れ、着地の沈み込みだけ見せる
      this.combo = 0;
      this.anim = { phase: 'land', pieceId: a.pieceId, dir: a.dir, steps: a.steps, t: 0, duration: 0.17 };
      return;
    }

    // 大きい消去の直前だけ一瞬止める。「タメ」があると解放が強く感じられる
    if (group.length >= 3 && !this.settings.calm) {
      this.anim = { phase: 'hold', pieceId: a.pieceId, dir: a.dir, steps: a.steps, t: 0, duration: 0.1, group };
      return;
    }
    this.doClear(group);
  }

  /**
   * 消去の演出と実行。
   * 祝うのは光と音だけ ―― 画面に文字は出さない。連鎖の深さは
   * 音程の階段と、光の強さ・画面の揺れで伝える。
   */
  doClear(group) {
    const pieces = group.map((id) => this.board.pieces.get(id)).filter(Boolean);
    if (pieces.length < 2) { this.anim = null; this.afterMove(); return; }

    this.combo++;
    // 連鎖が深いほど強く光る（頭打ちは付ける。眩しすぎると読めなくなる）
    const heat = Math.min(2.2, 1 + (this.combo - 1) * 0.28);

    let cells = 0;
    let sx = 0;
    let sy = 0;
    for (const p of pieces) {
      this.renderer.shatter(p.cells, p.color);
      this.renderer.burst(p.cells, p.color, heat);
      for (const [x, y] of p.cells) {
        sx += x + 0.5;
        sy += y + 0.5;
        cells++;
      }
    }
    const center = this.renderer.cellCenter(sx / cells - 0.5, sy / cells - 0.5);
    const color = pieces[0].color;
    this.renderer.ring(center.x, center.y, color, heat);
    this.renderer.flash(center.x, center.y, heat);
    this.renderer.addShake(3 + cells * 0.4 * heat);
    this.sound.pop(this.combo - 1, pieces.length);

    for (const id of group) this.board.removePiece(id);
this.selected = null;
this.anim = null;

if (this.board.isCleared && !this.settings.calm) {
  const stars = starsForMoves(this.moves, this.targets);
  const rect = this.dom.canvas.getBoundingClientRect();
  const screenCenter = this.renderer.cellCenter(
    sx / cells - 0.5,
    sy / cells - 0.5,
  );

  this.clearCelebration.play({
    stars,
    level: this.level,
    centerX: rect.left + screenCenter.x,
    centerY: rect.top + screenCenter.y,
    calm: this.settings.calm,
  });
}

this.afterMove();
  }

  /**
   * 手番の後始末。
   * 「消せる手が無い」ことを敗北にはしない ―― 詰みかけて見える局面でも、
   * 何も消さない手で通路を作れば必ず解ける（PAR は保証された手数）。
   * 行き詰まったら「戻す」と「やり直す」がいつでも使える。
   */
  afterMove() {
    this.updateHud();
    const won = this.board.isCleared;
    // 勝った手はスタンプを出さない ―― クリアの音と重なって、どちらも痩せる
    this.updateProgress(won ? null : this.lastMovedId);
    if (won) {
      this.status = 'won';
      this.recordResult();
      this.sound.win();
      setTimeout(() => this.finishLevel(), 640);
    }
  }

  undo() {
    if (this.busy || this.history.length === 0) return;
    const h = this.history.pop();
    this.board.restore(h.snap);
    this.moves = h.moves;
    this.status = 'playing';
    this.combo = 0;
    this.sound.undo();
    this.selected = null;
    this.ghost = null;
    this.lastMovedId = null;
    this.renderer.clearEffects();
    // 色は巻き戻すが、「いちばん先まで行った記録」は残す
    // （戻して指し直すたびに褒められると、褒め言葉の意味が無くなる）
    this.updateProgress(null);
    this.hideOverlay();
    this.updateHud();
  }

  // ------------------------------------------------------------ 入力

  bindInput() {
    attachInput(this.dom.canvas, {
      canInteract: () => this.canInteract(),
      toCell: (x, y) => this.renderer.toCell(x, y),
      pieceAt: (x, y) => {
        const id = this.board.at(x, y);
        return id >= 0 ? id : null;
      },
      onTap: (id) => {
        this.sound.unlock();
        this.selected = id;
        this.ghost = null;
        if (id != null) this.sound.tap();
      },
      onPreview: (id, dir) => this.setGhost(id, dir),
      onCommit: (id, dir) => this.tryMove(id, dir),
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key;
      // シートが開いているあいだ、後ろの盤面には触らせない。
      // とくに「名前を決める」は決めるまで閉じないので、ここから抜け出せると
      // 名無しのまま先へ進めてしまう
      if (this.anyModalOpen() && key !== 'Escape') return;
      const arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (arrows[key]) {
        e.preventDefault();
        if (this.selected != null) this.tryMove(this.selected, arrows[key]);
        else this.toast('先にブロックをクリックして選んでください');
        return;
      }
      const k = key.toLowerCase();
      if (k === 'z' || k === 'u' || k === 'backspace') { e.preventDefault(); this.undo(); }
      else if (k === 'r') { e.preventDefault(); this.restart(); }
      else if (k === 'l') { e.preventDefault(); this.showLevels(); }
      else if (k === 'escape') {
        this.selected = null;
        this.ghost = null;
        if (!this.anyModalOpen()) this.showHome();
        this.closeModals();
      }
    });
  }

  setGhost(pieceId, dir) {
    if (!dir || !this.canInteract()) {
      this.ghost = null;
      return;
    }
    const piece = this.board.pieces.get(pieceId);
    if (!piece) { this.ghost = null; return; }
    const sim = this.board.simulate(pieceId, dir);
    if (!sim) { this.ghost = null; return; }
    this.ghost = {
      piece,
      dir,
      steps: sim.steps,
      willClear: sim.cleared.length > 0,
      clearIds: sim.cleared,
    };
  }

  // ------------------------------------------------------------ UI

  bindUi() {
    const d = this.dom;

    // 押せるものは全部、盤面と同じ乾いたウッドクリックで鳴る。
    // pointerdown で鳴らすと指の動きと音がずれない。ここが音の解錠地点でもある
    // （ホーム画面のボタンを押した時点で iOS の音が開く）。
    document.addEventListener('pointerdown', (e) => {
      // 触覚は AudioContext を伴わないので、押した先が何であれ先に起こしておく
      // （iOS はここで隠しスイッチを用意する。最初の 1 回だけ遅れるのを防ぐ）。
      this.sound.armHaptics();
      const hit = e.target.closest && e.target.closest('button, .switch');
      if (!hit || hit.disabled) return;
      this.sound.unlock();
      this.sound.click();
    }, { passive: true });

    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnRestart.addEventListener('click', () => this.restart());
    d.btnLevels.addEventListener('click', () => this.showLevels());
    d.btnHome.addEventListener('click', () => this.showHome());

    // ホーム
    d.btnStart.addEventListener('click', () => this.load(this.startLevel));
    d.btnOpenLevels.addEventListener('click', () => this.showLevels());
    // ホームから開くときは星の数の表から。ここは「自分がどれだけ集めたか」を
    // 見に来る場所で、特定の1レベルの手数を見に来る場所ではない
    if (d.btnHomeRank) d.btnHomeRank.addEventListener('click', () => this.showStarRanking());
    d.btnInstall.addEventListener('click', () => this.install());
    this.bindInstall();

    // レベル一覧
    d.btnLevelsBack.addEventListener('click', () => this.showHome());
    d.btnLevelsJump.addEventListener('click', () => this.showLevels(this.pageOf(this.reachedLevel)));
    d.btnPagePrev.addEventListener('click', () => this.showLevels(this.page - 1));
    d.btnPageNext.addEventListener('click', () => this.showLevels(this.page + 1));
    d.levelGrid.addEventListener('click', (e) => {
      const cell = e.target.closest && e.target.closest('[data-level]');
      if (!cell) return;
      this.load(parseInt(cell.dataset.level, 10));
    });

    for (const el of [d.btnRules, d.btnRules2]) {
      if (el) el.addEventListener('click', () => this.openModal(d.modalRules));
    }
    for (const el of [d.btnSettings, d.btnSettings2]) {
      if (el) {
        el.addEventListener('click', () => {
          this.updateSettingsName();
          // 開くたびに見直す（ゲームパッドは後から繋がることがある）
          this.updateHapticsNote();
          this.openModal(d.modalSettings);
        });
      }
    }

    for (const modal of this.modals()) {
      modal.addEventListener('click', (e) => {
        // 名前を決めきるまでは、背景タップでも閉じない
        if (modal === d.modalName && this.nameLocked) return;
        // 閉じるボタンの中身（SVG）が押されることもあるので closest で辿る
        if (e.target === modal || (e.target.closest && e.target.closest('[data-close]'))) {
          // 訊くシートは、閉じられたら「やめた」として返す（返事を待つ人が居る）
          if (modal === d.modalAsk) this.cancelAsk();
          this.closeModals();
        }
      });
      // 下へ払っても閉じられるようにする。閉じるボタンは右上の丸ひとつしか
      // 無いので、盤面を見ながら片手で持っているときほど遠い
      attachSheetSwipe(modal, {
        canClose: () => !(modal === d.modalName && this.nameLocked),
        onClose: () => {
          modal.hidden = true;
          if (modal === d.modalAsk) this.cancelAsk();
          this.disarmReset();
        },
      });
    }

    // ランキング
    if (d.btnRank) d.btnRank.addEventListener('click', () => this.showRanking(this.level));
    if (d.rankTabs) {
      d.rankTabs.addEventListener('click', (e) => {
        const tab = e.target.closest && e.target.closest('[data-board]');
        if (tab) this.setRankBoard(tab.dataset.board);
      });
    }
    if (d.btnRankPrev) d.btnRankPrev.addEventListener('click', () => this.stepRankLevel(-1));
    if (d.btnRankNext) d.btnRankNext.addEventListener('click', () => this.stepRankLevel(1));
    if (d.rankLevelInput) {
      d.rankLevelInput.addEventListener('change', () => this.pickRankLevel(d.rankLevelInput.value));
      d.rankLevelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          d.rankLevelInput.blur();
          this.pickRankLevel(d.rankLevelInput.value);
        }
      });
    }
    /*
     * 管理モードの入口（持ち主だけ）。
     * ボタンは置かない ―― 置くと全員に見えて「何だろう」と押される。
     * ランキングの**表題を長押し**したときだけ、合言葉を訊く。
     */
    if (d.rankTitle) this.bindAdminGesture(d.rankTitle);
    if (d.btnAdminOff) {
      d.btnAdminOff.addEventListener('click', () => {
        saveAdminKey('');
        this.updateAdminBar();
        this.loadRanking();
        this.toast('管理モードをやめました');
      });
    }
    if (d.rankList) {
      d.rankList.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-admin]');
        if (btn) this.adminAct(btn.dataset.admin, btn.dataset.name);
      });
    }

    // 訊くシート（prompt / confirm の代わり）
    if (d.btnAskOk) d.btnAskOk.addEventListener('click', () => this.commitAsk());
    if (d.btnAskCancel) d.btnAskCancel.addEventListener('click', () => this.cancelAsk());
    if (d.askInput) {
      d.askInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.commitAsk(); }
      });
      // 打ち始めたらエラーは引っ込める（打っている最中に赤いのは邪魔）
      d.askInput.addEventListener('input', () => {
        d.askInput.classList.remove('bad');
        if (d.askError) d.askError.hidden = true;
      });
    }

    if (d.btnNameSave) d.btnNameSave.addEventListener('click', () => this.commitName());
    if (d.nameInput) {
      d.nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.commitName(); }
      });
      // 打ち始めたらエラーは引っ込める（打っている最中に赤いのは邪魔）
      d.nameInput.addEventListener('input', () => {
        d.nameInput.classList.remove('bad');
        if (d.nameError) d.nameError.hidden = true;
      });
    }
    if (d.btnChangeName) {
      d.btnChangeName.addEventListener('click', () => {
        // 設定シートは畳んでから開く（同じ高さに2枚重なると、どちらも操作しづらい）
        d.modalSettings.hidden = true;
        this.askName(false);
      });
    }
    this.updateSettingsName();

    // 「データを消す」でも既定に戻せるよう、対応表を持っておく
    this.toggles = {
      sound: d.optSound,
      haptics: d.optHaptics,
      symbols: d.optSymbols,
      ghost: d.optGhost,
      calm: d.optCalm,
    };
    for (const [key, el] of Object.entries(this.toggles)) {
      if (!el) continue;
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => {
        this.settings[key] = el.checked;
        this.applySettings();
        this.store.settings = this.settings;
        saveStore(this.store);
        if (key === 'sound' && el.checked) { this.sound.unlock(); this.sound.click(); }
        // 入れた瞬間に一度震わせる。届く端末かどうかが、その場で手で分かる
        if (key === 'haptics' && el.checked) { this.sound.armHaptics(); this.sound.vibrate([12, 40, 26]); }
      });
    }
    this.updateHapticsNote();

    this.buildMaterialPicker();

    d.btnShare.addEventListener('click', () => this.share());
    if (d.btnReset) d.btnReset.addEventListener('click', () => this.askReset());
  }

  // ------------------------------------------------------------ 記録を消す

  /**
   * この端末のデータを消す。
   *
   * 取り返しがつかないので2段階にしてある ―― 1回目のタップで「本当に消す」に
   * 変わり、何を失うのかを数字で見せる。5秒でふつうの表示に戻るので、
   * 誤タップだけで消えることはない。
   */
  askReset() {
    const d = this.dom;
    if (!d.btnReset) return;
    if (this.resetArmed) { this.resetAll(); return; }

    this.resetArmed = true;
    d.btnReset.textContent = '本当に消す（もう一度タップ）';
    if (d.resetNote) {
      d.resetNote.textContent = `星 ${this.totalStars} 個・クリア ${this.clearedCount} レベル`
        + `・自己ベスト・設定・ランキングの名前が消えます。元には戻せません。`;
    }
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.disarmReset(), 5000);
  }

  /** 「本当に消す」の身構えを解いて、ふつうの表示に戻す */
  disarmReset() {
    const d = this.dom;
    this.resetArmed = false;
    clearTimeout(this.resetTimer);
    if (d.btnReset) d.btnReset.textContent = 'この端末のデータを消す';
    if (d.resetNote) {
      d.resetNote.textContent = '星・自己ベスト・設定・ランキングの名前を消して、最初の状態に戻します。';
    }
  }

  resetAll() {
    this.disarmReset();
    for (const key of [STORE_KEY, ...LEGACY_KEYS, RULES_KEY]) {
      try { localStorage.removeItem(key); } catch { /* 消せない環境では諦める */ }
    }
    // 名前とこの端末のランキングも一緒に消す。「最初の状態」に名前は残らない
    forgetName();
    clearLocalRanking();
    this.updateSettingsName();

    this.store = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.applySettings();
    this.markMaterial();
    for (const [key, el] of Object.entries(this.toggles || {})) {
      if (el) el.checked = !!this.settings[key];
    }

    // 遊びかけの盤面も畳んで、初回起動と同じ状態に戻す
    this.puzzle = null;
    this.level = 1;
    this.status = 'idle';
    this.loadToken++;
    this.closeModals();
    this.showHome();
    this.toast('この端末のデータを消しました');
  }

  // ------------------------------------------------------------ ホーム画面に追加

  /**
   * すでにホーム画面から起動しているか。
   * Android/Chrome は display-mode、iOS Safari は navigator.standalone で分かる。
   */
  get installed() {
    if (typeof navigator !== 'undefined' && navigator.standalone) return true;
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  /** iOS（iPadOS も含む）。ここだけはインストールの API が無く、手順を案内するしかない */
  get isIos() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13 以降は Mac を名乗る。タッチできる Mac は実質 iPad
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  bindInstall() {
    // Chrome 系は「入れられる」と分かった時点で合図をくれる。既定の
    // バナーは出さずに預かっておき、ホーム画面のボタンから使う
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      this.updateInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.updateInstallButton();
      this.toast('ホーム画面に追加しました');
    });
    this.updateInstallButton();
  }

  /**
   * ボタンを出すのは「まだ追加しておらず、追加する手段がある」ときだけ。
   * 追加済みの端末に出しても押せないボタンが増えるだけなので隠す。
   */
  updateInstallButton() {
    const btn = this.dom.btnInstall;
    if (!btn) return;
    btn.hidden = this.installed || !(this.installPrompt || this.isIos);
  }

  async install() {
    // iOS には API が無いので、共有シートからの手順を見せる
    if (!this.installPrompt) {
      if (this.isIos) this.openModal(this.dom.modalInstall);
      else this.toast('お使いのブラウザのメニューから「ホーム画面に追加」を選んでください');
      return;
    }
    const prompt = this.installPrompt;
    this.installPrompt = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { /* 閉じられただけ。何もしない */ }
    this.updateInstallButton();
  }

  // ------------------------------------------------------------ 画面の切り替え

  /** 「ゲームスタート」が始めるレベル。まだ挑戦中のものがあればそれを続ける */
  get startLevel() {
    const last = normalizeLevel(this.store.lastLevel || 1);
    return this.starsOf(last) === 0 ? last : this.reachedLevel;
  }

  showScreen(name) {
    const d = this.dom;
    this.screen = name;
    d.screenHome.hidden = name !== 'home';
    d.screenLevels.hidden = name !== 'levels';
    d.screenGame.hidden = name !== 'game';
    // 背景の色はゲーム画面だけ。ホームや一覧に持ち込むと、そこの配色が濁る
    if (d.gameAura) d.gameAura.hidden = name !== 'game';
    // 隠れている間はキャンバスの実寸が 0 なので、見えてから測り直す
    if (name === 'game') requestAnimationFrame(() => this.renderer.resize(this.board.size));
    // 広告は、開いた画面のぶんだけ呼ぶ（枠の名前は画面名と揃えてある）
    ads.show(name);
  }

  showHome() {
    const d = this.dom;
    this.showScreen('home');
    // '#' が残らないように履歴ごと書き換える（対応していなければ諦める）
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch { /* file:// などでは無視 */ }

    const lv = this.startLevel;
    const continuing = this.starsOf(lv) === 0 && lv > 1 && lv === normalizeLevel(this.store.lastLevel);
    d.btnStartLabel.textContent = continuing ? 'つづきから' : 'ゲームスタート';
    d.btnStartSub.textContent = `レベル ${lv} ／ ${levelPreview(lv)}`;

    this.updateInstallButton();

    d.homeProgress.innerHTML = '';
    const chips = [
      ['クリア', this.clearedCount],
      ['星', this.totalStars],
      ['到達レベル', this.reachedLevel],
    ];
    for (const [k, n] of chips) {
      const el = document.createElement('span');
      el.innerHTML = `${k}<b>${n}</b>`;
      d.homeProgress.appendChild(el);
    }
  }

  pageOf(level) {
    return Math.floor((normalizeLevel(level) - 1) / PAGE_SIZE);
  }

  /**
   * レベル一覧。無限に続くのでページ送りで見せる。
   * 開いていないレベルは押せず、クリア済みには取った星が残る。
   */
  showLevels(page = this.pageOf(this.level)) {
    const d = this.dom;
    this.page = Math.max(0, page);
    this.showScreen('levels');

    const from = this.page * PAGE_SIZE + 1;
    const to = from + PAGE_SIZE - 1;
    d.pageRange.textContent = `${from} – ${to}`;
    d.btnPagePrev.disabled = this.page === 0;
    d.levelsSubtitle.textContent = `${this.clearedCount} レベルクリア ／ 星 ${this.totalStars}`;

    d.levelGrid.innerHTML = '';
    for (let lv = from; lv <= to; lv++) {
      const stars = this.starsOf(lv);
      const best = this.bestMovesOf(lv);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'level-cell';
      if (lv === this.reachedLevel) cell.classList.add('current');
      else if (stars > 0) cell.classList.add('done');

      cell.dataset.level = String(lv);
      cell.innerHTML = `<span class="n">${lv}</span>`
        + `<span class="stars${stars ? '' : ' none'}">${'★'.repeat(stars) || '☆☆☆'}</span>`
        + (best != null ? `<span class="cell-time">${best}手</span>` : '');
      cell.title = best != null
        ? `レベル ${lv}：${levelPreview(lv)}／自己ベスト ${best}手`
        : `レベル ${lv}：${levelPreview(lv)}`;
      d.levelGrid.appendChild(cell);
    }
  }

  showGame() {
    if (this.screen !== 'game') this.showScreen('game');
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
    this.renderer.setMaterial(this.settings.material);
    this.sound.enabled = this.settings.sound;
    this.sound.haptics = this.settings.haptics;
    this.mountHapticTaps();
    this.updateHapticsNote();
  }

  /**
   * iPhone のボタンに、触覚の膜を敷く／外す。
   *
   * iOS は script から触覚を出せないので、押した指自身に鳴らしてもらうしかない
   * （詳しくは haptics.js）。膜はボタンの**子**として入れるので、タップした
   * click はボタンまでバブリングし、ボタンの動作はそのまま生きる。
   *
   * **盤面には敷かない。** ドラッグを伴う面にネイティブのスイッチを置くと、
   * 実機の WebKit ではスイッチ自身がタッチを掴み、ブロックが動かせなくなる。
   */
  mountHapticTaps() {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    const want = this.settings.haptics && this.sound.needsHapticTaps();

    for (const el of doc.querySelectorAll(`.${HAPTIC_TAP_CLASS}`)) el.remove();
    if (!want) {
      for (const b of doc.querySelectorAll(`.${HAPTIC_HOST_CLASS}`)) {
        b.classList.remove(HAPTIC_HOST_CLASS);
      }
      return;
    }

    for (const button of doc.querySelectorAll(HAPTIC_TAP_TARGETS)) {
      const veil = this.sound.createHapticTapVeil();
      if (!veil) return;
      button.classList.add(HAPTIC_HOST_CLASS);
      button.appendChild(veil);
    }
  }

  /**
   * バイブレーションの但し書きを、その端末の実際に合わせて書き換える。
   * 「対応端末のみ」とだけ書いてあると、鳴らないときに設定を疑い続けることになる。
   */
  updateHapticsNote() {
    const note = this.dom.optHapticsNote;
    if (!note) return;
    const NOTES = {
      vibration: '動かした手ごたえを指に返す',
      // iPhone は指がスイッチに直接触れたときしか鳴らせない。できないことを
      // 「対応端末のみ」と濁さずに書く（詳しくは haptics.js）
      'ios-taps': 'iPhone ではボタンを押したときだけ',
      gamepad: 'つないだコントローラを震わせる',
      none: 'この端末には振動する部品がありません',
    };
    note.textContent = NOTES[this.sound.hapticsMode] || NOTES.none;
  }

  /**
   * ブロックのデザインを選ぶボタンを並べる。
   * 見本は「そのデザインで焼いた実物」ではなく代表色の四角 ―― 一覧を実物で描くと
   * シートを開くだけで写真の復号と焼き上げが走り、そこで引っかかる。
   */
  buildMaterialPicker() {
    const grid = this.dom.materialGrid;
    if (!grid) return;
    grid.innerHTML = '';
    for (const m of materialList()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'material-cell';
      btn.dataset.material = m.key;
      btn.setAttribute('role', 'radio');
      btn.innerHTML = `<span class="material-chip" style="background:${m.swatch}"></span>`
        + `<span class="material-name"></span><span class="material-note"></span>`;
      btn.querySelector('.material-name').textContent = m.name;
      btn.querySelector('.material-note').textContent = m.note;
      grid.appendChild(btn);
    }
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest && e.target.closest('[data-material]');
      if (!cell) return;
      this.setMaterial(cell.dataset.material);
    });
    this.markMaterial();
  }

  setMaterial(key) {
    const mat = materialFor(key);
    if (this.settings.material === mat.key) return;
    this.settings.material = mat.key;
    this.applySettings();
    this.store.settings = this.settings;
    saveStore(this.store);
    this.markMaterial();
    this.toast(`ブロックを「${mat.name}」にしました`);
  }

  /** いま選ばれているデザインに印を付ける */
  markMaterial() {
    const grid = this.dom.materialGrid;
    if (!grid) return;
    for (const cell of grid.children) {
      const on = cell.dataset.material === this.settings.material;
      cell.classList.toggle('on', on);
      cell.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  openModal(el) {
    // 前に払って閉じたときの姿（下がった位置・薄い暗幕）が残っていると、
    // 次に開いたシートが閉じかけの形で現れる
    resetSheet(el);
    el.hidden = false;
  }

  /** 開け閉めの対象になるシート一覧（HTML に無いものは飛ばす） */
  modals() {
    const d = this.dom;
    return [d.modalRules, d.modalSettings, d.modalInstall, d.modalRank, d.modalName, d.modalAsk]
      .filter(Boolean);
  }

  anyModalOpen() {
    return this.modals().some((m) => !m.hidden);
  }

  closeModals() {
    for (const modal of this.modals()) {
      // 名前を決めきるまでは閉じない。名無しの記録をランキングに残さないため
      if (modal === this.dom.modalName && this.nameLocked) continue;
      modal.hidden = true;
    }
    // 開き直したら「本当に消す」は最初から訊き直す
    this.disarmReset();
  }

  async share() {
    const url = `${location.origin}${location.pathname}#L${this.level}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('リンクをコピーしました');
    } catch {
      this.toast(`レベル ${this.level}：${url}`);
    }
  }

  toast(msg) {
    const el = this.dom.toast;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /**
   * 時計の表示。毎フレーム呼ばれるので、秒が変わったときだけ DOM を触る。
   * 星には関わらないので、色は付けない ―― 急かす意味がない。
   */
  updateTimer() {
    const d = this.dom;
    const t = Math.floor(this.elapsed);
    if (t === this.shownTime) return;
    this.shownTime = t;
    d.statTime.textContent = formatTime(t);
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statLevel.textContent = String(this.level);
    d.levelInfo.textContent = this.puzzle ? puzzleSummary(this.puzzle) : '\u00a0';

    // ★★★ の手数を過ぎたら色を変えて、いま星いくつぶんの位置にいるかを伝える
    const g = this.targets;
    d.hudMoves.classList.toggle('warm', !!g && this.moves > g.gold && this.moves <= g.silver);
    d.hudMoves.classList.toggle('late', !!g && this.moves > g.silver);

    d.btnUndo.disabled = this.history.length === 0 || this.busy;
    if (this.moves !== this.shownMoves) {
      this.shownMoves = this.moves;
      d.hudMoves.classList.remove('bump');
      void d.hudMoves.offsetWidth; // アニメーションを確実に再生させる
      d.hudMoves.classList.add('bump');
    }
    this.shownTime = -1; // 表示を作り直す（レベルを跨いだ直後など）
    this.updateTimer();
  }

  // ------------------------------------------------------------ 結果表示

  /**
   * クリアを記録する。星は「何手で解いたか」で決まり、最高記録だけが残る。
   * ベストは最少手数。★★★ は最短ちょうどなので、そこが上限になる。
   */
  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    const moves = this.moves;
    const stars = starsForMoves(moves, this.targets);

    this.store.best = this.store.best || {};
    this.store.stars = this.store.stars || {};
    const prevBest = this.bestMovesOf(this.level);
    const prevStars = this.store.stars[key] || 0;

    this.newRecord = prevBest == null || moves < prevBest;
    if (this.newRecord) this.store.best[key] = moves;
    this.store.stars[key] = Math.max(prevStars, stars);

    // 到達レベルを進める（鍵ではない。「つづきから」の行き先になるだけ）
    this.store.reached = Math.max(this.reachedLevel, this.level + 1);
    saveStore(this.store);

    this.clearMoves = moves;
    this.clearTime = Math.max(1, Math.round(this.elapsed));
    this.lastStars = stars;
    this.newStars = stars > prevStars;
  }

  /**
   * クリアの後始末。
   *
   * 記録は**必ず**ランキングに出す ―― 「保存しますか？」は訊かない。
   * 訊いてしまうと、押し忘れた回のぶんだけランキングが実態からずれて、
   * 「1位の人が本当に1位なのか」が誰にも分からなくなる。
   * そのぶん名前だけは自分で決めてもらう（初回だけ。以後は自動）。
   */
  finishLevel() {
    this.showWin();
    if (savedName()) {
      this.submitResult();
      return;
    }
    this.askName(true);
  }

  showWin() {
    const stars = this.lastStars;
    const moves = this.clearMoves;
    const best = this.bestMovesOf(this.level);
    const par = this.puzzle.par;
    const badges = { 3: '👑', 2: '🎉', 1: '🎊' };

    // ★★★ は「最短ちょうど」。近道が存在しないと分かっているので言い切れる
    let text = stars === 3
      ? `${par}手 ―― 最短で解きました。これより短い解き方は存在しません。`
      : `おめでとう！ この盤面の最短は ${par}手 です`
        + `（あと ${moves - par}手 縮められます）。★★★ は ${this.targets.gold}手、★★ は ${this.targets.silver}手 までです。`;

    this.showOverlay({
      badge: badges[stars] || '🎊',
      title: `レベル ${this.level} クリア！`,
      titleClass: stars === 3 ? 'gold' : '',
      stars,
      text,
      stats: [
        { k: '手数', n: `${moves}/${par}` },
        { k: 'ベスト', n: `${best != null ? best : moves}手` },
        { k: 'タイム', n: formatTime(this.clearTime) },
      ],
      actions: [
        { label: `レベル ${this.level + 1} へ`, primary: true, onClick: () => this.nextLevel() },
        { label: 'ランキングを見る', onClick: () => this.showRanking(this.level) },
        { label: 'もう一度あそぶ', onClick: () => this.restart() },
        { label: 'レベル一覧', onClick: () => this.showLevels() },
      ],
      extra: this.newRecord ? '自己ベスト更新!' : (this.newStars ? '星が増えました!' : ''),
    });

    // クリアのときだけ出す。押し間違いを避けるため、カードの外・ボタンより下に置いてある
    ads.showClear();
  }

  showOverlay(cfg) {
    const d = this.dom;
    // 広告はクリアのときだけ出す。読み込み中の表示に混ぜない
    ads.hideClear();
    d.overlayBadge.textContent = cfg.badge || '';
    d.overlayTitle.textContent = cfg.title || '';
    d.overlayTitle.className = cfg.titleClass || '';
    d.overlayText.textContent = cfg.text || '';

    d.overlayStars.innerHTML = '';
    if (cfg.stars) {
      for (let i = 1; i <= 3; i++) {
        const s = document.createElement('i');
        s.textContent = '★';
        if (i > cfg.stars) s.className = 'off';
        d.overlayStars.appendChild(s);
      }
    }

    d.overlayExtra.textContent = cfg.extra || '';
    // 順位は非同期で入る。ここでは必ず空にしておく（前のレベルの順位が残らないように）
    if (d.overlayRank) {
      d.overlayRank.textContent = '';
      d.overlayRank.classList.remove('pending');
    }

    d.overlayStats.innerHTML = '';
    for (const s of cfg.stats || []) {
      const div = document.createElement('div');
      div.innerHTML = `<span class="n">${s.n}</span><span class="k">${s.k}</span>`;
      d.overlayStats.appendChild(div);
    }

    d.overlayActions.innerHTML = '';
    for (const a of cfg.actions || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-plain');
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      d.overlayActions.appendChild(btn);
    }
    d.overlay.hidden = false;
  }

  hideOverlay() {
    this.dom.overlay.hidden = true;
    // クリアの広告を畳んで、ゲーム画面の広告を戻す
    ads.hideClear();
  }

  // ------------------------------------------------------------ ランキング

  /**
   * 名前を訊く。
   * @param {boolean} locked クリア直後。決めるまで閉じられない
   */
  askName(locked = false) {
    const d = this.dom;
    if (!d.modalName) return;
    this.nameLocked = locked;
    if (d.nameClose) d.nameClose.hidden = locked;
    if (d.nameTitle) d.nameTitle.textContent = locked ? '名前を決める' : 'ランキングの名前';
    if (d.nameLead) {
      d.nameLead.innerHTML = locked
        ? 'クリアの記録は、レベルごとのランキングに残ります。<b>この名前で載ります。</b><br>'
          + '一度決めれば、次からは自動でこの名前が使われます。'
        : 'ランキングに載せる名前です。変えると、<b>次の記録から</b>新しい名前で載ります。';
    }
    if (d.btnNameSave) d.btnNameSave.textContent = locked ? 'この名前で記録する' : 'この名前にする';
    d.nameInput.value = locked ? '' : savedName();
    d.nameInput.classList.remove('bad');
    if (d.nameError) d.nameError.hidden = true;
    this.openModal(d.modalName);
    // シートが上がりきってから当てる。上がっている最中だと iOS で外れることがある
    setTimeout(() => { try { d.nameInput.focus(); } catch { /* 当てられなければそのまま */ } }, 280);
  }

  /** 入力された名前を確定する。空なら閉じさせない */
  commitName() {
    const d = this.dom;
    const clean = sanitizeName(d.nameInput.value);
    if (!clean) {
      if (d.nameError) d.nameError.hidden = false;
      d.nameInput.classList.add('bad');
      try { d.nameInput.focus(); } catch { /* 当てられなければそのまま */ }
      return;
    }
    saveName(clean);
    this.updateSettingsName();

    const wasLocked = this.nameLocked;
    this.nameLocked = false;
    d.modalName.hidden = true;
    if (wasLocked) {
      this.submitResult();
    } else {
      // 名前が変わったら、星の表にも新しい名前で載せ直す
      this.postStars();
      this.toast(`ランキングの名前を「${clean}」にしました`);
    }
  }

  /** 設定シートに出す、いまの名前 */
  updateSettingsName() {
    const el = this.dom.settingsName;
    if (!el) return;
    const name = savedName();
    el.textContent = name || 'まだ決めていません';
  }

  /**
   * クリアの記録をランキングへ出す。
   * 通信が失敗しても端末には残るので、ここで失敗しても記録は消えない。
   */
  async submitResult() {
    const d = this.dom;
    const level = this.level;
    const token = ++this.rankToken;

    if (d.overlayRank) {
      d.overlayRank.classList.add('pending');
      d.overlayRank.textContent = isGlobalRanking() ? 'ランキングに記録しています…' : '記録しています…';
    }

    // 星が増えていれば、通算の表にも反映しておく（返事は待たない）
    this.postStars();

    const res = await submitScore({
      level,
      name: savedName(),
      moves: this.clearMoves,
      time: this.clearTime,
      stars: this.lastStars,
    });
    // 待っているあいだに次のレベルへ行かれていたら、もう出す場所が無い
    if (token !== this.rankToken || this.level !== level) return;
    if (!d.overlayRank) return;

    d.overlayRank.classList.remove('pending');
    d.overlayRank.innerHTML = '';
    const scope = res.global && !res.offline ? '世界' : 'この端末';
    const line = document.createElement('span');
    if (res.rank) {
      line.innerHTML = `${scope}ランキング <b>${res.rank}位</b>`
        + `<span class="muted"> ／ ${res.entries.length}人中</span>`;
    } else {
      line.textContent = `${scope}ランキングに記録しました`;
    }
    d.overlayRank.appendChild(line);

    if (res.offline) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'サーバーにつながらなかったので、この端末に残しました。';
      d.overlayRank.appendChild(note);
    }
  }

  /**
   * いま持っている星の数を、星のランキングへ出す。
   *
   * レベル別の投稿と違って**画面には出さない** ―― クリア直後に見たいのはその
   * レベルの順位で、通算の順位はホームから見に行くもの。裏で静かに更新する。
   *
   * 前に出した数と同じなら何もしない。星は 1 レベルクリアするごとにしか動かないので、
   * 起動のたびに同じ数を投げても増えるのは通信だけ。届かなかったときは
   * 印を付けずに置いて、次の機会に出し直す。
   */
  async postStars() {
    const name = savedName();
    const stars = this.totalStars;
    if (!name || stars <= 0) return;
    if (this.store.starsPosted === stars && this.store.starsName === name) return;

    const res = await submitStars({ name, stars, cleared: this.clearedCount });
    if (res.offline) return;
    this.store.starsPosted = stars;
    this.store.starsName = name;
    saveStore(this.store);
  }

  /** レベル別のランキングを開く（ゲーム画面のドックと、クリア直後から） */
  showRanking(level = this.level) {
    this.openRanking('level', level);
  }

  /** 星の数のランキングを開く（ホームから） */
  showStarRanking() {
    this.openRanking('stars', this.level);
  }

  /**
   * ランキングのシートを開く。
   * @param {'stars'|'level'} board どちらの表から見せるか
   * @param {number} level レベル別へ切り替えたときに開くレベル
   */
  openRanking(board, level = this.level) {
    const d = this.dom;
    if (!d.modalRank) return;
    this.rankLevel = normalizeLevel(level);
    this.openModal(d.modalRank);
    this.setRankBoard(board);
  }

  // ------------------------------------------------------------ 管理（持ち主だけ）

  /**
   * 長押しで管理モードの入口を開く。
   *
   * 押しっぱなしにしている**あいだに指が動いたら取り消す** ―― シートを
   * 払って閉じようとしただけのときに、合言葉を訊かれてしまわないように。
   */
  bindAdminGesture(el) {
    let timer = 0;
    let from = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = 0;
      from = null;
    };
    el.addEventListener('pointerdown', (e) => {
      cancel();
      from = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { cancel(); this.askAdminKey(); }, 900);
    });
    el.addEventListener('pointermove', (e) => {
      if (!from) return;
      if (Math.abs(e.clientX - from.x) > 10 || Math.abs(e.clientY - from.y) > 10) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(type, cancel);
    }
  }

  /**
   * 訊く。ブラウザの prompt / confirm の代わりに、アプリの中のシートで訊く。
   *
   * ブラウザのダイアログは**繰り返し出すと Chrome に止められる**（「このページで
   * これ以上ダイアログを表示しない」）。一度そうなると、押しても何も出ないまま
   * 即キャンセルになり、機能そのものが壊れたように見える ―― 管理は同じボタンを
   * 何度も押す操作なので、そこに乗ってはいけない。
   *
   * @param {{title:string, lead?:string, ok?:string, input?:boolean,
   *          value?:string, placeholder?:string, danger?:boolean, allowEmpty?:boolean}} cfg
   * @returns {Promise<string|null>} やめたら null。入力なしの確認なら '' を返す
   */
  ask(cfg) {
    const d = this.dom;
    if (!d.modalAsk) return Promise.resolve(null);

    d.askTitle.textContent = cfg.title || '確認';
    // 名前が混ざる文字列なので textContent で入れる（innerHTML は使わない）
    d.askLead.textContent = cfg.lead || '';
    d.askLead.hidden = !cfg.lead;

    const wantsInput = !!cfg.input;
    d.askField.hidden = !wantsInput;
    d.askInput.value = wantsInput ? (cfg.value || '') : '';
    d.askInput.placeholder = cfg.placeholder || '';
    // 名前と合言葉では上限が違う。名前の 12 文字で合言葉を切ってしまわない
    d.askInput.maxLength = cfg.maxLength || NAME_MAX;
    // 空のままの決定を許すか（合言葉は空＝管理モードをやめる、という意味を持つ）
    this.askAllowEmpty = !!cfg.allowEmpty;
    d.askInput.classList.remove('bad');
    d.askError.hidden = true;

    d.btnAskOk.textContent = cfg.ok || 'OK';
    d.btnAskOk.classList.toggle('btn-danger', !!cfg.danger);

    this.openModal(d.modalAsk);
    if (wantsInput) {
      // シートが上がりきってから当てる。上がっている最中だと iOS で外れることがある
      setTimeout(() => { try { d.askInput.focus(); } catch { /* 当てられなければそのまま */ } }, 280);
    }

    return new Promise((resolve) => {
      const done = (value) => {
        d.modalAsk.hidden = true;
        d.btnAskOk.classList.remove('btn-danger');
        this.askResolve = null;
        resolve(value);
      };
      // 開きっぱなしのまま次を開かれたら、前の約束は「やめた」で閉じる
      if (this.askResolve) this.askResolve(null);
      this.askResolve = done;
    });
  }

  /** 訊くシートの「OK」。入力が要るのに空なら閉じない */
  commitAsk() {
    const d = this.dom;
    if (!this.askResolve) return;

    if (!d.askField.hidden) {
      const value = d.askInput.value.trim();
      if (!value && !this.askAllowEmpty) {
        d.askError.hidden = false;
        d.askInput.classList.add('bad');
        try { d.askInput.focus(); } catch { /* 当てられなければそのまま */ }
        return;
      }
      this.askResolve(value);
      return;
    }
    this.askResolve('');
  }

  /** 訊くシートの「やめる」。背景タップと下払いもここへ来る */
  cancelAsk() {
    if (this.askResolve) this.askResolve(null);
  }

  /** 合言葉を訊く。空で決定すると管理モードを降りる */
  async askAdminKey() {
    const raw = await this.ask({
      title: '管理の合言葉',
      lead: '合言葉を入れると、名前を直したり記録を消したりできます。空のままにすると、管理モードをやめます。',
      ok: '決定',
      input: true,
      value: adminKey(),
      placeholder: 'あいことば',
      maxLength: 64,
      allowEmpty: true,
    });
    if (raw === null) return;

    const clean = saveAdminKey(raw);
    this.setAdminReport('');
    this.updateAdminBar();
    this.loadRanking();
    this.toast(clean ? '管理モードにしました' : '管理モードをやめました');
  }

  /** 管理モードの帯を出し入れする。作業中と、直前の結果は消さない */
  updateAdminBar() {
    const d = this.dom;
    if (d.rankAdmin) d.rankAdmin.hidden = !isAdminMode();
    if (this.adminBusy || this.adminReport || !d.rankAdminNote) return;
    d.rankAdminNote.innerHTML = '<b>管理モード</b>　名前を直したり、記録を消したりできます';
  }

  /**
   * 直前の管理操作の結果を、帯に**残す**。
   *
   * お知らせ（トースト）は数秒で消えるうえ、指が画面を見ていない隙に流れてしまう。
   * 合言葉が違うといった、次の手が変わる報せは消えては困る ―― 次の操作をするか、
   * 管理モードを降りるまで、ここに置いておく。
   *
   * @param {string} message 空なら、ふつうの案内に戻す
   * @param {boolean} bad しくじりなら true（赤くする）
   */
  setAdminReport(message, bad = false) {
    const d = this.dom;
    this.adminReport = message || '';

    if (d.rankAdmin) d.rankAdmin.classList.toggle('bad', !!message && bad);
    if (!d.rankAdminNote) return;
    if (message) d.rankAdminNote.textContent = message; // 名前が混ざるので textContent
    else this.updateAdminBar();
  }

  /**
   * 「いま作業しています」を出す。
   *
   * 直すも消すも**その人の記録があるレベルを全部探しに行く**ので、返事まで数秒かかる。
   * そのあいだ画面が何も言わないと、効いていないと読めて何度も押されてしまう ――
   * 押せないようにしたうえで、何をしているところなのかを帯に出す。
   *
   * @param {string} message 空なら作業おわり（帯をふだんの案内に戻す）
   */
  setAdminBusy(message) {
    const d = this.dom;
    this.adminBusy = !!message;
    // 新しい作業を始めるときは、前の結果の報せを片付ける
    if (this.adminBusy) this.setAdminReport('');

    if (d.rankAdmin) d.rankAdmin.classList.toggle('busy', this.adminBusy);
    if (d.rankAdminNote && this.adminBusy) {
      // 名前が混ざる文字列なので textContent で入れる（innerHTML は使わない）
      d.rankAdminNote.textContent = message;
    }
    // 二重に押させない。一覧は作業のあとに組み直すので、ここでは今ある行だけ止める
    if (d.rankList) {
      for (const btn of d.rankList.querySelectorAll('.rank-act')) btn.disabled = this.adminBusy;
    }
    if (!this.adminBusy) this.updateAdminBar();
  }

  /**
   * 一覧の行を直す・消す。どちらも**その人の記録すべて**が相手。
   * 消すのは戻せないので必ず訊く。直すのは打ち直しで済むので訊かない。
   */
  async adminAct(action, name) {
    // 作業中の二度押しは受けない（同じ人を二重に直しに行かせない）
    if (this.adminBusy) return;

    const board = this.rankBoard;
    const level = this.rankLevel;
    const remove = action === 'delete';

    const answer = remove
      ? await this.ask({
        title: '記録を消す',
        lead: `「${name}」の記録をすべて消します。星の数と、この人が遊んだ全レベルから消えます。`
          + '元には戻せません。',
        ok: '消す',
        danger: true,
      })
      : await this.ask({
        title: '名前を直す',
        lead: `「${name}」を、どんな名前に直しますか？`
          + 'この人の記録すべて（星の数と全レベル）で、この名前になります。',
        ok: 'この名前にする',
        input: true,
        value: name,
        placeholder: `なまえ（${NAME_MAX}文字まで）`,
      });
    if (answer === null) return;
    const to = remove ? null : answer;

    // 待っているあいだに管理モードを降りていたら、もう手を出さない
    if (!isAdminMode() && isGlobalRanking()) return;

    this.setAdminBusy(remove
      ? `「${name}」の記録を消しています… 全レベルを探すので少しかかります`
      : `「${name}」の名前を直しています… 全レベルを探すので少しかかります`);

    let res;
    try {
      res = await adminEdit({ action, board, level, name, to });
    } finally {
      this.setAdminBusy('');
    }

    if (!res.ok) {
      const why = res.error || (remove ? '消せませんでした' : '直せませんでした');
      this.toast(why);
      // 帯にも残す。合言葉が違うなら、入れ直しかたまで書く
      this.setAdminReport(
        /合言葉/.test(why) ? `${why} ランキングの見出しを長押しすると入れ直せます。` : why,
        true,
      );
      return;
    }
    // 待っているあいだに別の表へ移られていたら、出す場所が無い
    if (board !== this.rankBoard || (board === 'level' && level !== this.rankLevel)) return;

    this.renderRanking({ entries: res.entries, global: isGlobalRanking(), offline: false }, board);

    if (!res.changed) {
      // ok なのに何も変わっていない ―― 相手がもう居なかった。成功したふりはしない
      const why = `「${name}」の記録が見つかりませんでした`;
      this.toast(why);
      this.setAdminReport(why, true);
      return;
    }
    const done = remove
      ? `「${name}」の記録をすべて消しました`
      : `「${name}」を「${sanitizeName(to)}」にしました（この人のすべての表で）`;
    this.toast(done);
    this.setAdminReport(done, false);
  }

  /** 表を切り替える（タブ）。切り替えたらその場で取りに行く */
  setRankBoard(board) {
    const d = this.dom;
    this.rankBoard = board === 'level' ? 'level' : 'stars';

    if (d.rankTabs) {
      for (const tab of d.rankTabs.children) {
        const on = tab.dataset.board === this.rankBoard;
        tab.classList.toggle('on', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    if (d.rankPick) d.rankPick.hidden = this.rankBoard !== 'level';
    if (d.rankLevelInput) d.rankLevelInput.value = String(this.rankLevel);
    if (d.btnRankPrev) d.btnRankPrev.disabled = this.rankLevel <= 1;

    this.loadRanking();
  }

  /** 見るレベルを1つずらす */
  stepRankLevel(delta) {
    this.pickRankLevel(this.rankLevel + delta);
  }

  /** 見るレベルを決め直す。同じレベルなら取りに行かない */
  pickRankLevel(raw) {
    const d = this.dom;
    const lv = normalizeLevel(parseInt(raw, 10) || 1);
    if (d.rankLevelInput) d.rankLevelInput.value = String(lv);
    if (d.btnRankPrev) d.btnRankPrev.disabled = lv <= 1;
    if (lv === this.rankLevel && this.rankBoard === 'level') return;
    this.rankLevel = lv;
    this.loadRanking();
  }

  /** いま選ばれている表を取りに行って、描き直す */
  async loadRanking() {
    const d = this.dom;
    const board = this.rankBoard;
    const lv = this.rankLevel;
    const token = ++this.rankViewToken;
    const where = isGlobalRanking() ? '世界共通' : 'この端末';

    d.rankTitle.textContent = board === 'stars' ? '星の数ランキング' : `レベル ${lv} のランキング`;
    d.rankScope.textContent = board === 'stars'
      ? `${where} ― 星の多い順`
      : `${where} ― 手数の少ない順`;
    d.rankList.innerHTML = '<div class="rank-empty">読み込んでいます…</div>';
    d.rankNote.textContent = ' ';

    const res = board === 'stars' ? await fetchStarRanking() : await fetchRanking(lv);
    // 待っているあいだに別の表・別のレベルへ切り替えられていたら、もう出す場所が無い
    if (token !== this.rankViewToken) return;
    this.renderRanking(res, board);
  }

  /**
   * ランキングの一覧を組み立てる。
   * 名前はサーバーから来る他人の文字列なので、必ず textContent で入れる
   * （innerHTML に流すと、名前に書いた HTML がこちらの画面で動いてしまう）。
   */
  renderRanking(res, board = 'level') {
    const d = this.dom;
    const me = savedName();
    const stars = board === 'stars';
    const admin = isAdminMode();
    d.rankList.innerHTML = '';
    this.updateAdminBar();

    if (!res.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'rank-empty';
      empty.textContent = stars
        ? 'まだ誰も星を持っていません。1レベルクリアすれば、ここに載ります。'
        : 'まだ誰も記録していません。最初のひとりになりましょう。';
      d.rankList.appendChild(empty);
    } else {
      res.entries.slice(0, RANK_LIMIT).forEach((e, i) => {
        const row = document.createElement('div');
        row.className = 'rank-row' + (me && e.name === me ? ' me' : '');
        const pos = document.createElement('span');
        pos.className = 'rank-pos';
        pos.textContent = String(i + 1);
        const name = document.createElement('span');
        name.className = 'rank-name';
        name.textContent = e.name;
        // 表によって右側の2つが入れ替わる（星の数とクリア数／手数とタイム）
        const value = document.createElement('span');
        const note = document.createElement('span');
        if (stars) {
          value.className = 'rank-stars';
          value.textContent = `★${e.stars}`;
          note.className = 'rank-cleared';
          note.textContent = `${e.cleared}レベル`;
        } else {
          value.className = 'rank-moves';
          value.textContent = `${e.moves}手`;
          note.className = 'rank-time';
          note.textContent = formatTime(e.time);
        }
        row.append(pos, name, value, note);

        // 管理モードのときだけ、行の末尾に「直す・消す」を足す。
        // 名前は data 属性で持たせる ―― 押されたときに一覧を数え直さずに済む
        if (admin) {
          for (const a of [
            { key: 'rename', label: '直す', danger: false },
            { key: 'delete', label: '消す', danger: true },
          ]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rank-act' + (a.danger ? ' danger' : '');
            btn.textContent = a.label;
            btn.dataset.admin = a.key;
            btn.dataset.name = e.name;
            // 作業中に一覧が組み直されても、押せない状態は引き継ぐ
            btn.disabled = !!this.adminBusy;
            row.appendChild(btn);
          }
        }
        d.rankList.appendChild(row);
      });
    }

    if (res.offline) {
      d.rankNote.textContent = 'サーバーにつながらないので、この端末の記録を出しています。';
    } else if (!res.global) {
      d.rankNote.textContent = 'いまはこの端末の記録だけです。';
    } else {
      d.rankNote.textContent = stars
        ? `世界中の記録から、星の多い順に${RANK_LIMIT}位まで。同じ星ならクリア数の少ない人が上です。`
        : `世界中の記録から、手数の少ない順に${RANK_LIMIT}位まで。`;
    }
  }

  // ------------------------------------------------------------ ループ

  loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // 残り手数の表を、フレームの余りで少しずつ配る（遊びは止めない）
    this.advanceDistances();

    // 盤面を読んでいる間だけ時計を進める（星はこの時間で決まる）
    if (this.timing) {
      this.elapsed += dt;
      this.updateTimer();
    }

    if (this.anim) {
      this.anim.t += dt / this.anim.duration;
      if (this.anim.t >= 1) {
        const a = this.anim;
        this.anim = null;
        if (a.phase === 'slide') this.onSlideEnd(a);
        else if (a.phase === 'hold') this.doClear(a.group);
        else this.afterMove();
        this.updateHud();
      }
    }

    if (this.invalid) {
      this.invalid.t += dt / 0.34;
      if (this.invalid.t >= 1) this.invalid = null;
    }

    this.renderer.draw({
      board: this.board,
      anim: this.anim,
      selected: this.selected,
      ghost: this.ghost,
      invalid: this.invalid,
    }, dt);

    /*
     * 背景。色が 1 段動くと、新しい色が画面の下端から上へ満ちていく。
     * 動いているのは水位（auraRise）なので、満ちきるまでは毎フレーム入れ直す ――
     * 満ちきったあとは何も変わらないので触らない。
     */
    const rise = this.renderer.auraRise().toFixed(1);
    const tint = this.renderer.auraColor(0.26);
    const prev = this.renderer.auraPrevColor(0.26);
    /*
     * 見張るのは**水位と色の両方**。
     * 水位だけを見ていると、レベルを跨いだときのように満ちきったまま色だけが
     * 変わる場合に一度も書き込まれず、前のレベルの色が残る（残っていた）。
     */
    const painted = `${rise}|${tint}|${prev}`;
    if (painted !== this.paintedAura) {
      this.paintedAura = painted;
      try {
        const style = document.documentElement.style;
        style.setProperty('--game-tint', tint);
        style.setProperty('--game-prev', prev);
        style.setProperty('--game-rise', `${rise}%`);
      } catch { /* 触れない環境では背景が白いだけ */ }
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

// ===== src/edgeGuard.js =====
// 画面のふちから始まるスワイプで「前の画面に戻る」のを止める。
//
// iOS Safari の戻る/進むジェスチャ（左端・右端から横に払う）は touch-action や
// overscroll-behavior では止まらない。唯一効くのが「端から始まった touchstart を
// preventDefault する」ことなので、ここだけ手で面倒を見る。
//
// ただし全部を止めると副作用が大きい:
//   - ボタンの上で touchstart を打ち消すと、iOS では click が発火しなくなる
//   - 横スクロールする箱の中で打ち消すと、スクロールできなくなる
// なので「端の帯の中」かつ「押した先が操作部品でも横スクロール領域でもない」
// ときだけ打ち消す。帯は 24px ―― ブラウザがジェスチャと判定する幅とほぼ同じで、
// 盤面の操作を邪魔しない程度に狭い。

/** 端から何 px までをジェスチャの帯とみなすか */
const EDGE_ZONE = 24;

/** ここを押しているときは打ち消さない（タップやスクロールを壊すため） */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [contenteditable="true"]';

/** 横スクロールできる箱の中か（中身がはみ出しているものだけ数える） */
function inScrollerX(node) {
  for (let el = node; el instanceof Element; el = el.parentElement) {
    if (el.scrollWidth - el.clientWidth <= 1) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll') return true;
  }
  return false;
}

/**
 * 端スワイプによる履歴移動を止める。
 * @param {Document|HTMLElement} [root] 監視する対象。既定は document
 */
function attachEdgeGuard(root = document) {
  // 打ち消した指。iOS は touchstart だけだと払い切られることがあるので、
  // 同じ指の touchmove も続けて打ち消す
  let guardedTouch = null;

  root.addEventListener('touchstart', (e) => {
    guardedTouch = null;
    // 2 本目以降（ピンチなど）はブラウザの戻るジェスチャにならない
    if (e.touches.length !== 1) return;

    const t = e.touches[0];
    const w = window.innerWidth;
    const nearEdge = t.clientX <= EDGE_ZONE || t.clientX >= w - EDGE_ZONE;
    if (!nearEdge) return;

    const target = e.target;
    if (target instanceof Element) {
      if (target.closest(INTERACTIVE)) return;
      if (inScrollerX(target)) return;
    }

    guardedTouch = t.identifier;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  root.addEventListener('touchmove', (e) => {
    if (guardedTouch == null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === guardedTouch) {
        if (e.cancelable) e.preventDefault();
        return;
      }
    }
  }, { passive: false });

  const clear = () => { guardedTouch = null; };
  root.addEventListener('touchend', clear);
  root.addEventListener('touchcancel', clear);
}

// ===== src/main.js =====
// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の画面を決める。

const $ = (id) => document.getElementById(id);

const dom = {
  // 画面
  screenHome: $('screen-home'),
  screenLevels: $('screen-levels'),
  screenGame: $('screen-game'),

  canvas: $('board'),
  toast: $('toast'),
  gameAura: $('game-aura'),

  // ホーム
  btnStart: $('btn-start'),
  btnStartLabel: $('btn-start-label'),
  btnStartSub: $('btn-start-sub'),
  btnOpenLevels: $('btn-open-levels'),
  btnHomeRank: $('btn-home-rank'),
  btnInstall: $('btn-install'),
  homeProgress: $('home-progress'),

  // レベル一覧
  levelGrid: $('level-grid'),
  levelsSubtitle: $('levels-subtitle'),
  pageRange: $('page-range'),
  btnLevelsBack: $('btn-levels-back'),
  btnLevelsJump: $('btn-levels-jump'),
  btnPagePrev: $('btn-page-prev'),
  btnPageNext: $('btn-page-next'),

  // ゲーム
  statLevel: $('stat-level'),
  statMoves: $('stat-moves'),
  hudMoves: $('hud-moves'),
  statTime: $('stat-time'),
  hudTime: $('hud-time'),
  levelInfo: $('level-info'),

  overlay: $('overlay'),
  overlayBadge: $('overlay-badge'),
  overlayTitle: $('overlay-title'),
  overlayStars: $('overlay-stars'),
  overlayText: $('overlay-text'),
  overlayExtra: $('overlay-extra'),
  overlayStats: $('overlay-stats'),
  overlayRank: $('overlay-rank'),
  overlayActions: $('overlay-actions'),

  btnUndo: $('btn-undo'),
  btnRestart: $('btn-restart'),
  btnLevels: $('btn-levels'),
  btnHome: $('btn-home'),

  // シート（ホームとゲーム、両方から開ける）
  btnRules: $('btn-rules'),
  btnRules2: $('btn-rules-2'),
  btnSettings: $('btn-settings'),
  btnSettings2: $('btn-settings-2'),
  modalRules: $('modal-rules'),
  modalSettings: $('modal-settings'),
  modalInstall: $('modal-install'),
  optSound: $('opt-sound'),
  optHaptics: $('opt-haptics'),
  optHapticsNote: $('opt-haptics-note'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
  materialGrid: $('material-grid'),
  btnShare: $('btn-share'),
  btnReset: $('btn-reset'),
  resetNote: $('reset-note'),

  // ランキング（星の数・レベル別／世界共通）
  btnRank: $('btn-rank'),
  modalRank: $('modal-rank'),
  rankTitle: $('rank-title'),
  rankTabs: $('rank-tabs'),
  rankPick: $('rank-pick'),
  rankLevelInput: $('rank-level'),
  btnRankPrev: $('btn-rank-prev'),
  btnRankNext: $('btn-rank-next'),
  rankScope: $('rank-scope'),
  rankList: $('rank-list'),
  rankNote: $('rank-note'),
  // 管理モード（持ち主だけ。ランキングの表題を長押しすると入口が出る）
  rankAdmin: $('rank-admin'),
  rankAdminNote: $('rank-admin-note'),
  btnAdminOff: $('btn-admin-off'),

  // 訊くシート。ブラウザの prompt / confirm の代わりに使う
  modalAsk: $('modal-ask'),
  askTitle: $('ask-title'),
  askLead: $('ask-lead'),
  askField: $('ask-field'),
  askInput: $('ask-input'),
  askError: $('ask-error'),
  btnAskOk: $('btn-ask-ok'),
  btnAskCancel: $('btn-ask-cancel'),

  // 名前（初回だけ訊いて、以後は自動で使う）
  modalName: $('modal-name'),
  nameTitle: $('name-title'),
  nameLead: $('name-lead'),
  nameInput: $('name-input'),
  nameError: $('name-error'),
  nameClose: $('name-close'),
  btnNameSave: $('btn-name-save'),
  btnChangeName: $('btn-change-name'),
  settingsName: $('settings-name'),
};

const game = new Game(dom);

// 端から払うスワイプでブラウザが前の画面に戻ってしまうのを止める
attachEdgeGuard();

/** URL のハッシュ（#L12 / #12）からレベルを読む */
function levelFromHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  const m = /^L?(\d+)$/i.exec(raw);
  if (!m) return null;
  return Math.max(1, parseInt(m[1], 10));
}

// リンクでレベルを指定されたときだけ直行する。そうでなければホームから始める
const linked = levelFromHash();
if (linked) game.load(linked);
else game.showHome();

window.addEventListener('hashchange', () => {
  const lv = levelFromHash();
  if (lv && lv !== game.level) game.load(lv);
});

// 初回だけルールを開く
try {
  if (!localStorage.getItem(RULES_KEY)) {
    dom.modalRules.hidden = false;
    localStorage.setItem(RULES_KEY, '1');
  }
} catch { /* プライベートモードなどでは無視 */ }

/*
 * ホーム画面から開いたときに、通信が無くても遊べるようにする。
 * file:// では Service Worker が使えないので、そこでは何もしない。
 */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    // sw.js 自体はキャッシュさせない（新しい版に気づけなくなる）
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

window.slidePop = game;

})();
