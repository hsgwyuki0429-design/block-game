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
  return { gold, silver: Math.ceil(gold * 1.5) + 2 };
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
     * **いちばん読みやすいのはこれ**なので、既定にしてある。厚みも面取りも影も
     * 持たず、一色のベタ塗りに髪の毛ほどのすき間だけ。
     * 目が拾うものが「色と形」しか無いので、どのブロックがどこまでかが一瞬で分かる。
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
    /** 盤面も進行度の色を、ほとんど白まで薄めて追いかける */
    trayTint: true,
    colors: {
      grey: { top: '#c4c4cb', mid: '#9a9aa2', deep: '#5f5f68', side: '#6e6e78' },
      lit: { top: '#7f97e6', mid: '#3e47cc', deep: '#2a2f8c', side: '#333a9f' },
    },
    tray: { frame: '#dde2f0', floor: '#dde2f0', well: '#eef1f8' },
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
    chamfer: 0.156,    // 写真の角の落としと同じ角度・同じ深さで切り抜く
    gap: 0.09,
    tint: 0.86,        // 色の濃さ。1 まで上げるとガラスではなく塗った板に見える
    shadow: 0.3,
    colors: {
      // 写真から拾った代表色。演出（破片・光の輪）と落ち影に使う
      grey: { top: '#e2e4ea', mid: '#b3b6be', deep: '#70747c', side: '#8c9099' },
      lit: { top: '#d8f2ff', mid: '#6ec8ee', deep: '#175f85', side: '#3d95c4' },
    },
    /*
     * 受け皿は、枠を立てずに平らに敷く。
     * 写真は「白い台の上に置かれたガラス」で、暗い箱に嵌まっているのではない ――
     * 枠と落ち影を付けると、ガラスが箱の底に沈んで透明感がまるごと消える。
     */
    tray: { frame: '#eef0f7', floor: '#edeff6', well: '#dde1ec' },
  },
];

/** デザインの並び（設定画面もこの順で出す） */
const MATERIAL_KEYS = DEFS.map((d) => d.key);

/**
 * 何も選んでいないときのデザイン。
 * 迷ったら**いちばん読みやすいもの**を出す ―― 見た目は好みで選ぶ飾りで、
 * 遊べることのほうが先にある。
 */
const DEFAULT_MATERIAL = 'plain';

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

/**
 * 盤面（トレイ）の色。
 *
 * クリスタルでは**進行度で動かさない。** 写真のガラスは白い台の上に置かれて
 * いるのが正しい見え方で、台まで色づくとガラスが染まって見える。
 */
function trayPaletteFor(mat, tintHex) {
  /*
   * 例外はプレーンだけ。焼くものが「角丸の塗り 2 枚」しか無いので、
   * 色が 1 段動くたびに描き直しても目に見えるほどの間は空かない ――
   * そのぶん、盤面まで含めて温度が変わる元の見え方が戻ってくる。
   */
  if (mat.trayTint && tintHex) {
    const [h] = rgbHsl(hexRgb(tintHex));
    const plate = rgbHex(hslRgb(h, 30, 89));
    return { frame: plate, floor: plate, well: rgbHex(hslRgb(h, 34, 95)), key: `${mat.key}|tray|${tintHex}` };
  }
  return { ...mat.tray, key: `${mat.key}|tray` };
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
    /** 色を何段に分けるか。レベルの最短手数がそのまま段数になる */
    this.steps = 32;

    /** ブロックのデザイン。設定で切り替わる */
    this.material = materialFor(DEFAULT_MATERIAL);
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
    if (immediate) this.progress = this.progressTarget;
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
    this._tintAt = q;
    this.tint = progressColor(q);
    this.stonePal = paletteFor(this.material, false, null);
    this.litPal = paletteFor(this.material, true, this.tint.base);
    this.trayPal = trayPaletteFor(this.material, this.tint.base);
  }

  /** 背景に敷く色。色つきブロックと同じ色を、うんと薄めて返す */
  auraColor(alpha = 0.22) {
    const m = this.material;
    if (m.rawTint) return auraFor(this.progress, null, 1, alpha);
    return auraFor(this.progress, m.colors.lit.mid, m.tint, alpha);
  }

  /** 背景の色がどこまで満ちているか（画面の下からの割合） */
  auraRise() {
    return 26 + this.progress * 68;
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

    this.drawTray(view.board);
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
   * 盤面（トレイ）。
   *
   * ブロックと同じ寸法・同じすき間の淡いマスを敷き詰めただけの面で、影も枠も無い。
   * 上半分だけを 1px の白い線でなぞる ―― ガラス板の縁が光を拾ったときの 1 本で、
   * これだけで面が「浮いている」ように見える。
   *
   * **焼かずに毎フレーム直に描く。** プレーンは盤面の色も進行度を追いかけるので、
   * 焼くと色が 1 段動くたびに盤面ぶんのキャンバスを作り直すことになり、
   * 大きな盤面で 1 手ごとに 55ms 止まった。中身は角丸の塗り 2 枚しか無い。
   *
   * 枠を立てて影を落とす受け皿も持っていたが、写真のクリスタルはそれでは
   * 成り立たない ―― ガラスが暗い箱の底に沈んで、透明感がまるごと消える。
   * 写真は「白い台の上に置かれたガラス」で、いま残っている 2 つのデザインは
   * どちらもこの平らな台に載っている。
   */
  drawTray(board) {
    const ctx = this.ctx;
    const pal = this.trayPal;
    const x0 = this.ox;
    const y0 = this.oy;
    const w = this.cell * this.size;
    const n = this.size;
    const cell = this.cell;
    const pad = Math.max(2, cell * 0.06);
    const radius = Math.max(6, cell * 0.24);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, radius);
    ctx.fillStyle = pal.floor;
    ctx.fill();
    ctx.clip();
    /*
     * 縁の光は上半分だけ。**短い矩形をなぞるのではなく、消えていく線でなぞる** ――
     * 短い矩形だと下辺がそのまま残り、盤面の真ん中に横線が 1 本走る（走っていた）。
     */
    const rim = ctx.createLinearGradient(0, y0 - pad, 0, y0 - pad + (w + pad * 2) * 0.55);
    rim.addColorStop(0, 'rgba(255,255,255,.85)');
    rim.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0 - pad + 0.5, y0 - pad + 0.5, w + pad * 2 - 1, w + pad * 2 - 1, radius);
    ctx.stroke();
    ctx.restore();

    // 空きマスだけ、ほんの少し明るく抜く（通路がそのまま読めればいい）
    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    // 角の落とし方はブロックと揃える。空きマスは「ブロックが抜けた跡」なので、
    // 丸と八角が混ざると盤面が 2 種類の形でできているように見える
    const cut = this.material.chamfer ? this.material.chamfer * cell : 0;
    ctx.save();
    ctx.fillStyle = pal.well;
    ctx.beginPath();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        const px = x0 + x * cell + gap;
        const py = y0 + y * cell + gap;
        if (cut) {
          chamferRect(ctx, {
            px, py, pw: size, ph: size, up: false, down: false, left: false, right: false,
          }, cut);
        } else ctx.roundRect(px, py, size, size, tr);
      }
    }
    ctx.fill();
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
    const chamfer = mat.chamfer ? mat.chamfer * cell : 0;
    const radius = this.tileRadius;
    const rects = this.rectsFor(cells, ox, oy, this.tileGap, radius);
    const outer = this.pathOf(rects, chamfer);
    const box = this.bboxOf(rects);

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
   * 色は貼ってから被せる。'color' は「色相と彩度は塗った色、明るさは下のまま」
   * という混ぜ方なので、ガラスの陰影を潰さずに色だけが変わる ――
   * 進行度の色（手数の目盛り）が、写真の上でもそのまま働く。
   */
  bakePhoto(ctx, outer, box, cols, rows, pal, colored) {
    const mat = this.material;
    const img = photoFor(cols, rows);
    ctx.save();
    ctx.clip(outer);
    if (img) this.drawNineSlice(ctx, img, box, cols, rows);
    else {
      // まだ復号できていない。無地で置いておく（読めたら焼き直される）
      ctx.fillStyle = pal.mid;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }
    ctx.globalCompositeOperation = 'color';
    // 色つきは進行度の色、灰色は写真がもともと帯びている青み。
    // 濃さを 1 まで上げると、ガラスではなく**塗った板**に見える ――
    // 少し透かすと、地の無彩色が残って「染めたガラス」になる
    ctx.globalAlpha = colored ? mat.tint : 1;
    ctx.fillStyle = colored ? this.tint.base : mat.photoTint;
    ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
    ctx.restore();
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
    const outline = this.boundaryOf(
      piece.cells, rects, box, this.tileRadius, mat.chamfer ? mat.chamfer * cell : 0,
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
    this.haptics = true;
    this.keepAlive = null;
  }

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

  /** 最初のユーザー操作で呼ぶ。以降いつでも鳴らせるようになる */
  unlock() {
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
    if (!this.haptics) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* 非対応端末は黙って無視 */ }
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

async function request(url, init = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : 0;
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
    /** 背景の光にいま塗ってある進行度（毎フレーム塗り直さないための控え） */
    this.paintedProgress = -1;
    /** 直前に動かしたブロック。スタンプを貼る場所になる */
    this.lastMovedId = null;

    /* --- ランキング --- */
    /** 名前を決めきるまで閉じられないシート（クリア直後） */
    this.nameLocked = false;
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
          this.closeModals();
        }
      });
      // 下へ払っても閉じられるようにする。閉じるボタンは右上の丸ひとつしか
      // 無いので、盤面を見ながら片手で持っているときほど遠い
      attachSheetSwipe(modal, {
        canClose: () => !(modal === d.modalName && this.nameLocked),
        onClose: () => { modal.hidden = true; this.disarmReset(); },
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
      });
    }

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
    return [d.modalRules, d.modalSettings, d.modalInstall, d.modalRank, d.modalName].filter(Boolean);
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
  }

  showOverlay(cfg) {
    const d = this.dom;
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
    d.rankList.innerHTML = '';

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

    // 背景は盤面の色と同じ速さで動かす。別々に動くと2つの色がすれ違って濁る。
    // 進行度は毎フレーム少しずつしか動かないので、動いたときだけ CSS を触る
    if (Math.abs(this.renderer.progress - this.paintedProgress) > 0.0015) {
      this.paintedProgress = this.renderer.progress;
      try {
        const style = document.documentElement.style;
        // 下に溜まるぶんだけ濃く。上は透けたまま伸びていく
        style.setProperty('--game-tint', this.renderer.auraColor(0.24));
        style.setProperty('--game-deep', this.renderer.auraColor(0.44));
        style.setProperty('--game-rise', `${this.renderer.auraRise().toFixed(1)}%`);
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
