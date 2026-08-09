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
  'FIDBQBABCBJBZBSCTFAIDIEAEIFCBICSFYBBGYHYASDIAAEIBIFICCGYHYESBIBQ', 'FJECREBBIBTBYBcBKDiDDAFAHAEAIZGYARHICIDIFBBYCSHYABGICIBIFRDYBACYERBI', 'FIABLDBBaBcBCCTDQFBADIFRGAGYEBDIFIHIASCYCQBaGAGIBIBQGaEAEYDCFIHIAIAA', 'FIYBSDbBcBECKDZDAFFABACAGQCYDYDAGJCQCYGYERBIFIHIACCYHQFZBAEAGIHQFQBZ',
  'FIQCDECBZBcBSDiDAEFICRHIABDYCYCQFZEAGICIDIARHYBYEBFJCADAGZFRCJBRHJDBBY', 'FIABcBJDQDYDDESEgGBACAHJEQDQAQCYFYBBGIDIDAEAEIARDYDAAAEAHZGQEJAJDRCRFZBZ', 'FIDDgDBBCBLBACREbEBIEIFRCYDYAYEAHABJGQDQDICICQAZDADIAICIFBGYCRARDZEZHBBB', 'FIMCZECBJBYBACLCjDDABAHZAQGQCJDJBBHBEJFRBYDYGBEIHRDRDYGYECAYCSEIABCAHJGRBI',
  'FIIEiGYBADKDSDCGZGEIFIAICBBZHYFRERAJCJDRGZAAEAHJDQCZEZEAHADKBAFaDQBJFICRHZAQ', 'FIQECGBBSDbDgDKGiGCYDIAICRBZGZDBEBAJCJFBHZAQEQGJFACZEZEQGQFKBQDaFABJDICBGZAA', 'FITEAGDBRDZDjDIGgGCIDYEYAYCRBJGJDBEBAZCZFBHJAQEQGZFACJEJEQGQFaBQDKFABZDYCBGJAA', 'FIABMBDBQBJCBDSDaHBADQAQEQFYCYGICQFJAAAIDCEYASCYGYBQCAFICIACGYHYBRFRCJAJGBFZAQBA',
  'FJBBTEaBCCDDLDQDYDjDAYHQGQDYCCGICQHIASDYEZFABAGJCQEQFZBAGAIAHJAIAAHaCQIQGQBQFJEABY', 'FJQCKEABEBJBUBbBZDBGFQDQHQEQIICIABHYGYFYDRBIGBHIARCYEBGQGYBYDBFIHIGQEQIYDAFAHIGIERBY', 'FIbBYDCBSCDDTDgDAFAIFADICSEYFYACCADIGJBQHQEZFACAGABJHQEQFZAYAQFKCADAEAHABZGQAQAYGIAQ', 'FJEBQBDBCCJCUCaDgDiDEAGYCRAYFBIIFQHIBQEYDYAYCBGIFAGAHAHJBJDRERAZCZGBBBBIDICSAIAQGZBABY',
  'FJDDiDIBJBZBLDAGSGaGCRDYFZAQEAGJDACABZGYIQHQAQFJEAEICIGICBBBHZIZARFREJBJBAHAFaAAAYERBIBQ', 'FILDYDACTDgDJEaECGGIBICQHZAADAGAEKBQCQFQDaAQHJDAAaGAAIEABJFQAQDQHZGAAJFABZEQAQGQHJDAFAAZ', 'FJBBjDCBDDLDTDQGaGgGAYCYHZFQGJAQCQDaEAGAFAHJAQCQDQEaGAFAHABAIJAQCQDQFaHADKFQFIABCYBZDQFJAI', 'FJDBYDABBBCBECSCTCQDBQFRAIEIGBBIIQIICSDYGYEYHBBIIICIDSGYEYHYAYFBBIIICIESHYCCEIEABZIQARCIEBAY',
  'FJBDhDEBJBLBYBACUCZGBIEYCYCQHBAIIIDRGIFCDYDABZGQAYCAIQEQEIGIDIDABAFQAYGABIIZEQEICSFQGIDIAQDABA', 'FJDDTDYBCCRCIDLDiDaGCAFAEAHZIQBQDQGQAQFKCBDAEAHAIZBQHKDQEQFZAAGAHABAIJEQEYDYBYDQGZAQFJGAAZHABA', 'FJYBKCDBMBTBACBChDjDBAHAIZDRCIEQBIGIFIACHYIYEYDYCSBIGIECHIIIASFYEYGYBYCCDIHIIIAIFREYGYBYCYDCHIBQ', 'FIEBaDZBBCQCUCSDCEBQEBCYDRGQHYAYFBBIGIDICICAERHYDBBZGYFRAIDIHIEBBYGQCIBAGZCQCIBIGIERHYDYAYFBCIAS',
  'FJCDjDEBJBSCADKDYDTEDYHQDQGZAQFJGAAZEAHIDQAQGQFZEAHABZIQEIAIFIGIDCAYBYHYIYCSEIGIIABJHQAQDQFYGAIAAJ', 'FIADhDIBYBRDTDZGCHBJGIDICREYEAFaHQAKEAFACADABaGQHQAQEKFAAaHAGABKCQDQAQFQEaHAAKCADABaGQAQHQEKFADAAZ', 'FJIBcBKBBCCDaDgDiDLEDQEZCAIAFAFIHACQEIAAGJDQDYCYCRFZFACAGYIQEJFAIYBBHIHQIQFQFIAIEYBAIICIAREZFZBZIBCJBR', 'FITBICZBaBADjDDEJEAIEIBACYDYFYAQGQEJHADADICICAFZDQDIFIBRHYGYABDIFICQGQHIBBCYFYGYAYARERHJGBEZAADAFJERAZ',
  'FJQDbDSBCDYDjDAEKGgGBAFAIJEQAQGQDZHABACAFAAKEAIZAQEKCQGQDQHZBAFAEAAAIJGQDQFaBQHJFADAGAIZAQEQBQDKCAGAEaAA', 'FIIDLDCBADDDaDQFSGFQHQBQCQEQDKAAGAFZHQBQEQDQAKGAFAHZBQFKCQGQAaDAEAFABAHJGQAQDaEAAKGAHZBQFQAQEQDKCBGAFaAQ', 'FJABTCKBQBcBBCZDgDCGBAEBHKDQAQGQFQIZBAHAHYERBICICAHAEYBRCIHAEAEYGIFQHYCYCRHJIJAAAIDCFYEYEQAQAIDIEAFBGZCQCYBY', 'FILEgGABBBQBSBCDbEDRGYAAHABJEQCQGYFBDICICRGRFZAZHBDJGJCABYDQEAGICIEIFSAYCBGYDABIEQGZCRAICIGIFCEYEABZCQDQGJAR',
  'FIBEhGABQBRBSBDDLEBYHRGRAJEBFBGZHABJDQDICSEYGYFRAZHBFJGJDABYCAFQGIDICIESAYDBGYFABICQGZDRAIDIGIECCYCABZDQFQGJAR', 'FICEhGEBSBTBUBADQEBIHQGRAZDBEBGJHABZFQFYCSEIGIDRAJHBDZGZFABICADQGYFYCYESAIFBGIDABYCQGJFRAYFYGYECCICABJDQFQGZAR', 'FIUCBEABQDSDYDgDDEERDJFJCRBYHYABEIGICQDZFAEAGJCJDRBRHZFBCBEYAQFICAEAGYGADKBQEZCQFYAAGICREJBAEACADaGQGYAREIFICBBJ', 'FIBEhGIBRBSBYBLDTECAFABYHQGQAJDBEBGZHABJFQFICSDYGYERAZHBEJGJFABYCAEQGIFICIDSAYFBGYEABICQGZFRAIFIGIDCCYCABZEQFQGJAR',
  'FICEgGMBSBbBcBIDQECAEAFABJHQGQAZDBEBGJHABZFQFYCSEIGIDRAJHBDZGZFABICADQGYFYCYESAIFBGIDABYCQGJFRAYFYGYECCICABJDQFQGZAR', 'GLCDUDADKDYDcDEEIEkESFpGEQHQCQAZDAJAEJHQCQAQDZJAFZIAKJHQFZJQDJAACAFAHAKaIQBQGQDJAJCAFAHAEZJQAQCJFAAZJAEJHQAQFQCZJABZIAKKHQAQ', 'GLQGjGLBYCZCaCbDMEAGDGIGBQGICRGQHQKKAAEAFABZGQHQKQAKIQJaAAKAHAGABJEQFQIQKaAQJKKAIADAEAFABaGQHQAQIKDAEAFABAGbCQHQAQIQJQKKFAAY', 'GNABkDEBSBUBYBbBiBNCZCQDrGBHFQGABYIQCIEBGIDIKIARHAMYEYCYIBBIDQKIJALZBQIRCIGBIYCSGIEIMIABFBLYBYCQGREIMIAIFBJYASKYDAMYIBBALJJQKYHABY',
  'FJACSCEBJBYBZBTDbDBGBAHQGQCQIIDAFAHZGQBIFIFAHADQGZBQIYCABIFIDIGIHIEIEBGZAQHYIYFABYCSFIBBFQHIHQBQDQIJEADYBYFYCBHIHAGKAQEYDBAI', 'FKDDaDABKBUBBDLDQDjDYEIYEQGQAQFJDADYAYFYGYECBIGIHIIIJICSDYAYHYGYEQFIAAGAHJDQDICCJYBYIYERGIHIDIJAIZBQDQAQFZGAAJDABAIJJQCQFYDAHZAQ', 'FIIBLBMBDDaDJEYEAGEIEQBQCQDQGIARFYDYCBBIDQCYBBDIDQBQCQHJFAAAGAEaDQDYBRCIGIGADADYBYCREIAQFQGIHZGABACAEJDQBYBADADIAIEYCQGQHJFAAA', 'FJYBcBIBADJDLDTDREhGFAFYGABAHIIIAICREYGYBBEQHIEICBAYEQGYGQFQDJCACIACEYEQGQCQDYGYHYBRFIFABAHAGKCQCYHYHQDQDIAICBHYGYBQDIAIAQFZDAAI',
  'FJABKCLBbBcBBDDDQDYEBQCIFQGZDCBIHIIIASFYGYDYBBEYCRBIDIDQFIABIYEYCYBRGKAAFAHYDYGQFJDADYECHJIIASDYEYFYGYBBCIIIAIDSEYFYGYHZBYCCIIAIAA', 'FIYGCHBBbBcBRDTDgDCYBYFYGYECDIDAHKAQFQCQGYDYFICQBYDBHBAJCQAYGYHYESDIBIHIGICCAYEYGYHYDSHIGICRBYHBGJGADAEAAJCQBQHaGAGYDBEIBICBFYFQBQ', 'FJADZDCBDBQCIDhDbESGDICIAIFIEBBYGYHYIYDSCICQAJFAIAHAGJBQEQFYAYCADAGIBIEQHYDYCRAIIYAQFKIAAaCADAAIGABJHQAQIQFaCADAAJHABZGQAQCQDQFKIAHAAZ', 'FIADRGIBYBZDbDiDCHBICIDBEYEQFaBQHQAKCADAFAEAGZBQEKFQCQDQAaHAEAFKGAGIDRCYGADICRGYGAEaHQAKGAEACADABZFQHQAQGKEAAaHAFABJCQDQAQEQGaHAFAAIBA',
  'FJCDhDLBQBcBECADIGZGDQHQGQAZCAAIGIHIDCBYHYIYEYFRCIECHIIIDRAYGYEYCYFBIIIQHQCQEQAJGADAEYHYCQAQGJDAEAHABABIIZCQFRAIHIDREYGYAAHABABIDIERHYAQ', 'GKEFZFTBCCYCADIDQDjDrGAQIICQDIFIGIHIECBYCYDRFKDBCIBIGAHABAJaCQDQIQAQFQGKDACAHABAJAEQHYIbCQDQGZFAAACJIKIAJQBQEQHQGZFZAACAJKBQEQHQGQFZDADYAYAQ', 'FKBDhDRBSBYBACMCDDKDjDCADIBAJZDQGQIQHQHYGBAICADIBIJIEIFRCYECBYIYJYDYDAGRAIHIEICIFBBYJIBQIQCQEQAZHADAGAIIBAJZIQBJCQIIJIFRAYAQHaDAEABAGAIAJJCQBY', 'FJBCTCCBSBcBQCDDLDhDAQFBIYDQCQFQGaHAHYECBICIDBIJAQCQDQFQGQHZEZBBIIBQDQEQHKEADAGAAAFAIaBQDQEQHQGKEADAIJAQFQEZABHYBAIIDQDYIYBQHIAIEIDAFBIZCQCYBY',
  'FKCDiDJBSBcBECICADKDgDCQDIIYDABAJJCQGQIQHQHIGBAYCYBYDAJYEYFRDIECBIIIJICICAGRAYHYEYDYFBBIJYBQIQDQEQAJHACAGAIYBAJJIQBZDQIYJYFRAIAQHKCAEABAGAIAJZDQBI', 'FKYDbDIBJBLBMBKCgDiDCGCADAAAHAIZBQBYFREIGIAIHICRDYAAHAJYEAFABIIICQDQIABZGQJYEYFBGIBIHIIICICABZDQAYIQHQEQEYFYFQJJAACADABAIZHQBJCQDQAQJZFAFIEIAIEABA', 'FKABhDEBJBKBbBQCTDZDBGFIBIIIDREYHYCQHAIAJIEADABYFYCRIIDIERAIGBBYDQIYCBFIDIBIGRAYEBIYDAIQEQJYCAFABJIQDYEQFYHYFABACQIJDQEQHQJIAIGBEYDYBYIYCRFIHIAQHABA', 'FKBBZBABYBMCDDKDaDjDQGFYEAHIBIDIJICSAYAQFZGAJABADAIZHQBIDIEQGIFIAACACIIYARHYEQJYGQFJJAAACADAIAIIARCYDYGYHYBQGQFQFYEBBIHIIIAICRDYABHYIYBYERFIFAGABAGIAI',
  'FJADgDCBJBcBICiDSGZGCJAJDAHYEAGIBIFQDYHAIABAGZEQEYCSHIDIIIDQAZHAIACAEAGJBQDQIZCAEAGAGYCRBIDQEIIIIQAQAJFBHYEAIIDBBZBAGQBJDRFRAZIYEQHIAAIABABYIYEYEQIJAQ', 'FJADhDEBRBbBQCCDIGSGEIBIDQHIIYCQGIAIFBDYIQHQAQGZCACYECHIIIDIDABZIQHQCQEQGJAADAHZCQEQGQGYEBAICIDAHIHABABJFRIYCQHIDRAZAQGAAJDBFBBZHYCAIIBQHQAQAYHYCYCAHJBA', 'FJDDiDABTBZBUCBDKGQGEYBYDQHYIICQGYAYFBDIIQHQAQGJCACIECHYIYDYDABJIQHQCQEQGZAADAHJCQEQGQGIEBAYCYDAHYHABABZFRIICQHYDRAJAQGAAZDBFBBJHICAIYBQHQAQAIHICICAHZBA', 'FKMBYBcBCCRCADDDIDaDiDAYCBIIJIDRFIHIBCEYDYIYJYCRAIHIHQFQFIDBGYAACAIYJIIQHQHYCYARFIGIDIBIBQEBHYDQGZFACAIYJYAQCIDIBIHIEQGYFYCAAAJIIIEQGQFZBADAHAIAJZAQAYCSDIAC',
  'GLBBSDNBgBkBdCQEDGKGaGhHAYBIHZCAIYCYFCEIJIGIKIDIATGYBYCQIYJYFQHJIABAGAAAJYCQBIGIABDYJYCYKYEYEBFRBICAJIKIDIASGYJYCQBZEAEICIBQCAJJGQIQHaCABICYEAEYFCJIGIABDYKIGRAJ', 'FJBDSGaBcBACJDYDgDDEBYCIGIHIERAYFYIYDCCICAHJGQBQIQAJFAEAGYHYCQDQAIFIEABYIYDYCBHIHAGKBQHaCQDQAQFJHIIAHABAGaCQDQHJIQFZAAHACADAGKBQIQHZAQFJHAIABAGaCQDQAQFQHJIAAZ', 'FJADZGCBEBcBQCIDiDSGCIAIGIFBBYIYEAHIBQFQAYIQGQCYDYEBGJCQAICYFAGYERDIGAIYEYDRGIGADAEAIJCQAQFQGaDAEAIAHABJCQFQHYIYDREIAIAAIAHAHYDYERAIIYAQGKIAHACABYDYEQAQHJCADABA', 'FJBDSGaBbBACJDYDgDDEBYDICIGIHIERAYFYIYDCCICAHJGQBQIQAJFAEAGYHYCQDQAIFIEABYIYDYCBHIHAGKBQHaCQDQAQFJHIIAHABAGaCQDQHJIQFZAAHACADAGKBQIQHZAQFJHAIABAGaCQDQAQFQHJIAAZ',
  'FJbBQCABcBBCCDKDhDSGEQFYGIGAIAAADAHJEQEIBICSIZGQFJIABAEAHZAQDQGQFQIJBABYEYFYGYDBAIGQHIEQFYDYABGIHIEICIBRCAFYEAHZGQAQIZDADIEICICAEAHAGZAQAYDSEICIFIBAGYHAAYCRFIHIBI', 'FJABECBBcBTCKDZDgDQGFAEAGYHJGQIQAQCQFZEAEYBYDCIJGAHZIQBQEQFJAACAGAHAIZBQBIEIGIHIARCYFYEAGAHIAICRFYGYEYDYBBDQHIEQFJGAAAIJCQAYEYDYDQEQFQGJAAAICCEYDYFQHYBQGIAIDBFYHYBY', 'FJADaGCBDBEBRCIDiDSGFYBYHIIYERDICIAIGIFBBYBQFQAYIQGQCYDYEBGJCQAICYFAGYERDIGAIYEYDRGIGADAEAIJCQAQFQGaDAEAIAHABJCQFQHYIYDREIAIAAIAHAHYDYERAIIYAQGKIAHACABYDYEQAQHJCADABA', 'FJACUCBBYBZBCDLDiDRGFIGYBAHIEIDIARCYGYGAIADAEAEIDIAICSGYHYBQIIGQFaIAGKFQFICCAYDYDQFQCIABDYFQCQGYIYBBHIFQEYHAFJEQEYFYHYBRGICIIIAIDCEYEAFZAQHQCQCIAIEIIYEAFAHZAQCQGYBBCIAI',
  'GKQBFCSCADsDLECGIGoGbHCYEYJYBSFIGIDIHIABCYHQDQDIGZFABAEIHIIICQAQAICCIYEYJZEBIKEQJQHQHZEBHJAQCQDYGYFYBBHIHQBQEQFQGKDAAADYEZFQGYBAGQDKAACAEAJAIaHQFQEJAQFIJICRDaGAAIDQGZEBAJ', 'FJACUCDBEBaBJDYDgDRGEIFAGIAQFYCYDYBBEIGIGQIQCQCYDQDYBYECFIAAGIIYGAHKIQGaHAHYESBIDIDAHAEYBRDIGIHAEAIIARFYHACIFQHZCACIFIHIABGYEYIYBYDSCICQHJBAFAEAEYBYCYIICQHQFJBAEAGIAREYBY', 'GLgBFCQBdBcCqDAELERECGhGDQBQFYJIGICBABKYEYDYBRDAHIEBFJKQIQGQJZHABADAFAKKIQIYFYDQKYBQHQJJGAAJCRGYABCJIBFZCQAQJYKZERHYBCDIEICIARHYEBKKFQIQGQJZEADYKYBSEIJJDBGAIAFAKZBYCQESDIBBCIAI', 'FKIBECTBaBcBADCDRDgDJGAQJYCADIHQIIAQJQFQGZCACYDCHIJIAAIYHQJQCQDQGJFAAACYJYDQGQFJAACAJAIAHZDQHIIIJIASCYFYGYJYDCHIIIAIJICSGYJYDQFIGAJAAACAHZIQAIDQJICAHAIZAQDQJQFQFYGJCAGYJYDCAIAA',
  'FKLBRCUBYBCCADDDIDaDiDCAIIJIERFIHIDCBYEYIYJYCRAIHIHQFQFIEBGYAACAIYJIIQHQHYCYARFIGIEIDIBBDQHYEQGZFACAIYJYAQCIEIDIHIBQGYFYCAAAJIIIBQGQFZDAEAHAIAJZAQAYCSEIDIDQFJGABAHAIAJYAYDRHIIIBI', 'GLhBLFVBiBYCQDZDAECGjGrGFIIIHIECAYDYGYJYKYCRBIFIFQHQHIIZBAFJGJEQEIADDYDBJZKZCZFRBRIJBAEAFAGYCAKKJQGQEQGYCYIZBAFAKAJKCQFZBQGQEQIJAIDBEYASIZABBAFJCACYFZBQGIIJAACAGAJaKQGKFQHQAICBHYBY', 'FKDDaGABLBMBYBZBBDiDQGHQAZDAEAJJFAGAIZBQJQDQEQAJHAGAGIFIFAJZCQDQHYAYEADIGIGQAQHJCAFAJAIABZDQEQGQHIIIJICRFYAYAAJAGABICQFQAYHYEADABIIACIFRIYGYDYERJIAQHZJAAKIAIIFBCYBYEQGYDYAQIJDAGABA', 'GKKGiHlBQCSDoDAEUECGZGAIEYIIGIDBJYHYCBBIJQDQEQGQIaAACAHABAFLJQDQEQGQIQAaCAHABAFAJKEQFaBQCQHQAKIAGAFAEAJaBQFKGQFYIQAaHAFABAJKEQGQFZHQAKIAFAGAEAJaBQCQHQAQIKFAAaCAHABAJKDQEQGQAQFQIaHAAJ',
  'GLCBdCgBFCICJCSCADpDLEbFJAKAIJFRGQAQAYGCFICIERAYCCFYGSCIAIHIECFYASCYAAGBIZKQJQHJGAAICREIFCCYAYIYGSHYJYDYBCKIGIAICIIIFSEYHYJYGCAICIIIFIESJYCBAYGRHIJAEAFAIZGQCIABGYKYBSDICIAIHIGCKYCSAIAQ', 'GLDEZEdBgBFCIDQDpDTEjEAGCQFIGIDCBYHYJYCYESAIKIDAGYIYAQCAKJFAIAJAHKBQGQDQFYIYAYKYECCIHIJQGKDQIQFQFIKZAAGACYERAIKIDBIYGYJAHZEQAQKJFAGAGYAYEBHJJQIIDRFYGYKYEACIAQKQFKGAGIDBIYAYCYKYCBHBJJAR', 'GLEDsDDBRCSCYCMDIGTGpGbHHADAEAFBJYJABbKQIQCQGQAQHKDAEAFAIaKABLJQIQDQEQFQHaAACAGAKABAJKIQBbKQBICQGQAQHKDAEABAIAJaKQBKDQEQHaAAGABAKAJKIQDQEQFQHQAbGAGZBBCJHJAQGZBZCAKAJAIKDQFQAQGQBZHAGKAA', 'GLFCpDCBgBICRCSCdCADLEbFJAKABJFQGQCQCYGCFIDIERCYDCFYGSDICIIIECFYCSDYCAGBBZKQJQIJGACIDREIFCBYDYCYGSIYJYAYHCKIGIBICIDIFSEYIYJYGCKYHSAIGIIIJIEIFCBYDYCYKYGSAYHCGIKIBICIDIFSEYIYJYAYHYGCKIAS',
  'GLLEYEBBCBNBACEDrDaEcEoGCQDQGaAAEAHIJAHAKKBQFQGYDAIABIFRCYHYIYJYESAIDIGICAFAIABAKaEQHQJIDSGIIICICQFBBYDYHAKJBQFQGZIADAJYEBKIBIFRCYDYDABAKZERJIIQGJCADAFAKYHQBIFICSDYDQGZFAIABAHAHZEZJRAR', 'GLQDrGABNBEDZEBGKGSGoGbHFYKYDRHIIIAIAAIaHQEQGJAAEaHAIKCQEQAQGaHAAKEAAYIZDBKIFICRIYAQEJGQHaDAEAAAIKCAFAJABaKQIQAQDQEQHKGACAFAIaAQDQEQHQGKFAEZAAIJCQFYGYHYDBIIEQAZIAKABKJQCQEQAQIaKAEKAQAI', 'GLRBjHQBNCSCTDbDgDDEIGoGDAGIJAAAEAHICQAYEYFYFQIQJJAAEAFYGYDQJIEIAICCFYFAGaEQHYJYDABAKKERFIHQGQCRAYFACIAREAFYFAAACAGAHAKaBQDQJIEBGKCQERFIFQJaDAIAGABAKKHQCQCYEYBYGYKYDSIIFIIQJKAAAICCEYAS', 'GLYDDGVBgBkDIEAGaGhGrGKHCAHIAIJZEQIJAQHaIAEAJJAQEaIQHKDAEAAAJaIQAKEQAYHZCRKIFIDBHYAAEJJAIaCQEQAQHKDQFQGQBaKAHAAACAEAIKJQDQFQHaAACAEAIAJKFQEZAQHJDAFYIYJYCRHIEAAZHQKQBKGADAEAAAHaKQEKAAAI',
  'GLZBMCaBCCLCYCdCADIEDGpGBREQJQBAGAKJCQDQHLIAAACYDRIIDAFCCYCAKaAQBQEQGQJQIIFICCAYFRIYHYJAEAKIAQCRIYJYGCBIEIDIFIKIAICRIRJZHQJAIAAACAHYEBKZBYDQGSEIBCDIFIAIKICQIQHZFBAIHIIICCIQIYAYAAKYFSBY', 'FKBDgGABMBSBcBTCDDKDQDIYGAJQCQAYHYDAFABJJQCQEYIYGYFYDRHIHQAKIACAEAJABZDQFQHQAQIKEAGAJICQEYGYAYHYIYDCFIFABJCQJICIESGYAYHYIYDYDQIJAAFAHACAJICIEIEABZJQDQFQHJAQIZHAAJCAEABAJaDQFQAQHQIJCAAY', 'FKCDiGEBIBSBYBRCADJDTDIIGAJQCQAIHIDAFABZJQCQEIIIGIFIDRHYHQAaIACAEAJABJDQFQHQAQIaEAGAJYCQEIGIAIHIIIDCFYFABZCQJYCYESGIAIHIIIDIDQIZAAFAHACAJYCYEYEABJJQDQFQHZAQIJHAAZCAEABAJKDQFQAQHQIZCAAI', 'FKMBACCBTBcBDDRDgDiDYGCYDAFYAAEAIIHIJIBRCYFYDAGAJAHAIZEQEYASDIFIGICIBBHYIYEYAYDSGIJICQFYGAJAAADAEAIKHQCQHIBRFYFQGaJAAADAEAIAIYDRAIEIFIHICQFQGQGIBBCYHYIYERAYDBEIARFIGIBICCHYIYAYEYDRFIAA',
  'FKQBUCABJBaBBDDDSDgDKGDQEIIIAQCQFYGYJYBBEIHQIIDQJQGQFJCACIACDYHYIYEYBRFIGICIAIDCHYJYEAIIHQJQAQCQDQFaGAEAGYBBIIIAHKJQAQCQDQFQFIDBAYCYGYEAIYIAHAHYBREIFIGICBAIDRCYABHYIYBYESFIGIAICIDBIYAQ', 'FKhDAGEBKBUBYBDCQDaDjDHAFAAYIYGQJYEQCQBJHADYFAIYGYCYEBJIJAAKIQDQFQHQBZCAEAJAAAIKDQGQHIFADYGYAYIYJYESCICQBJFAHIFIDCGYAYIYEYJYEAIJAQCQHIJQFQFIDIDQBZHACAEAJJAAIZJQAJDQFQBQHaCAEAAAJAIJFQAY', 'FKiDCGABKBQBcBBCTDZDgDHAFAAIIIGQJIEQCQBZHADIFAIIGICIEBJYJAAaIQDQFQHQBJCAEAJAAAIaDQGQHYFADIGIAIIIJIESCYCQBZFAHYFYDCGIAIIIEIJIEAIZAQCQHYJQFQFYDYDQBJHACAEAJZAAIJJQAZDQFQBQHKCAEAAAJAIZFQAI', 'GKYBbHLDZDrDDGQGTGoGAHDQEIIIAQGQHaBAEAIJDQEaBQHKGAAAEADAIaBQHQGKJQFaCAGAHABAIKAQDQEQJQGaCQFKGAJAAAEADAIaBQHQCQFQGKJAAACZHABAIKARDQEQCQJQGaFAHABAEKCQJQHaBAEAIADKCQIZEQBQHKJAAACYDZEQIJAJ',
  'GLABsDSBVCTDEEQEbEJGgGpGIACAKYBYDQEICIGIGAJAAQIYCAEYKABaHQEQCQFQIKAAGAJAEaHABKKQEQJQAQGQIaCAFAHABAKJEQBaHQCQFQIKAAGAJABAEAEIKZHQBKJQAQGQIaCAFABABIJJARCQGYCYBYFYDCHIDQKIAQJZBQFQIKCAGAJABa', 'GLADqDMBYCZCiDIEKEkECGbGCIHIGIJIAIDCEYBYFYIYKZCSHIKJGQAQJZHAKAIABJFQGQKZHQJJAAKAGAFABZIQHQHYKJCBGAIIBIFIEIDSAYGYJYKYCBHIFBBBIZHRCRFIJIAIKIGIDCEYBYFQIYHYCRKQJQAKGABAFZKQBKGQAaJABAKAFKGQBa', 'GLDBaCEBFCZCdCIDQDbFAGSGEYBYIYFYDSCIAICQGJHAEAKYAQJKHAHIEBBYGYIYFYASCYCQJQHKGAJZCADBAIFIIIBIESGYHZJYKYCYFCAYDRFICIHIGIJIKIECBYIYAYDYFSCIHIGIJIKIEIBCIYAYDYFYCSJIKIACIIBSEYAYJYKYCCFIDIIIAS', 'GLEBYEiBjBCDKDUDsDSEcEAFAIBQKQEZFAIACADAHZJQGQAQFJEJIICBDYGYKABAHZDQCQJYASIIEQFZIAABGAJIDIDAHJBQCQGYKQFZEAGADADIGQEQFJKABAHZJYARDIJAHKBQHYKQFZEAGAJAAYDRJIGQEQFJKABAHZAYAAHKBQKQFZEAGACABI',
  'GLEBZBABBBCBDBFCTDaFcFQGBYIYJYGSAIFIEIDICIHIKIBCIYJYGYKYHYATFIFREJHBGBAYFRERHIDIDQHZEBFBAIGREYEQHJDADYEYGBAYFRGIEIDIDQHZEAABFYGREIEQHJAADADYAYAAFCJIIIKIBTCYCRDZAZHZFAKIAQEAHYFYEYGCJIIIAS', 'GLQBVCABFBUBLDZDBEgERGiHBQDQFAEAFIGJHICIABJYJQAQCQHQFbDAEAHAGAGIHQFJAAFYJJCQCYHYEYEQFJHACIARHYEYGYEAGAJAJIERHIABCYEYJYDQFIJQGQHIAICBEYARHYFYDAGAJAJIAIEICRHYABJYDQFIJQGQAIHICBEYGZAQAIJYAQ', 'GLQDbGhBiBKCYCIDAGDGjGLHJQBQKQIQHKGAAACBDYERAIEAGIFCDYDAJaBQCQKQIQAKGQGIFIDCCYFRGYHZAAIAKABAJKCQDREQFQGQIaAQHJIADACAGAEAFAJaBQKQAQHQIKDACAGAEAFAJABaKQAQHQIQGKEAFAAaKABKJQAQEQFQGaIAHAKAAK', 'GLRCUEFBSBLCQCkDsDAEiECGAQDAFQIQKZEAJAHZGQBQEIDIIIKIFCAYHYJYBYCSEIDIGYIIKIFIACJYBYCYESDICBBIJIASFYIYCYDYECBICRIIFIACJYCYBYESDIIICBJIASFYCYIYDYECBIGIHIJIAIFSCYACHYGYJYBYESDIIIKIAICIFCJYAR',
  'GLcDQGDBEBFCTCkDIGoGrGYHHABAKAIAJaGQAQDRCIFBAYERCIDBAAGYGAJKIQGaAQAYEYCSDIDQFQHKBAEAAIKAGAIAJaAQCQDQEQFQHQBKKAGAIAJAAaEQFQGKKQBaHAGAEAFAAKJQIQKQBQHaDBCBGAEAFAAAJKIQKQBQHQGaEAFAAAJAIKKQAa', 'GMADiGlBECFCICLCCDcDgDJEoGKQLJJQBZGQHQHYGBIYCAIQDQGQAKFAHAKABAJALZIQJKBQKQHQAZDAGAJAIALKBQIaJQDQGQAJHAIIKAIABALaJQDQGQAQHJKAIABALAJaDQGQIJKQHZAAIADAGAJLLQBQKQIZAQHJIAKABALAJbDQGQAQHQIJKAAZ', 'GMJDYGABgBFCTCLDpDcEBGQGrGHALZIQEQJJAAGZFAFIBIGIKICRAYAQJaEAFAIALJHQBQKQGQAJCACIDCBYHYKYIYLYESFIAIGIJJCADAKABAHALZIQGQKJCQDQJZAAKAGAIALJHQBQCQDQKZGAIABJCQDQKQGaAQJJGAKACADABZIQAQAYKJCADABA', 'GMjDJGhBACYCaCMDRDDGTGbGrGAICAIZGABJHAFALZAQKQJQBQGQHIIJDIECCYCQDREQHYHAGaBAJAKAAALJDQFQGQHQIaBAHKGAJZHQGKJADAFALZAQKQHQGQJJDAFAKZHQGQJQBQIKDAFAKAHaAALJHQKQGaAAKJGQDQFQIaBAJAAAKAGKDQFQJZAA',
  'GNQBlBMBRBNCcCSDaDAGDGJGgGoGKYLIMIARDYGYCYFBLIMIAIDRGYHZCQCYFYEYBCLIMICRGIHIDBAYCYLYMYBSEIFIGIHICBAIDRCYGYHYFYEYBCLIMIAIDICRGYHYABLYMYBSEIFIAIAAHJGQKQIQJaAAFAHIGIKICBDYLYMYBYERFIAIIICAGYHYAR', 'GJYBFCbBkBdCQDAEZECIAQHQFQFIABCQHYCYDYEYBSFIIIGIABHBCZDZFRHICBDYHQHICIDBFZHQCIDIASGYAACBHAFJDRDYHYHADIARHYCSCIHIABDYHQIYBCEIFIHQAIDBHYCYFYEYBSIICCAIAQAIDJGRCZDBDYIYBCEIAIFBHJGRCRDYIYAC', 'GKBBDBCCMDaDiDQFUFoGrGAYBQDAHAFJEQCQDaBAHAFAEJCQCIGIGAIAJaCQBQEQFQHQDKBACAGAIAJAEbFQFZHRDRBJCBIIJIASGYCYBZBQDBHBFJFAELJQFaEAJJFQIQCQDZHAEAIJFAJaIQEQHQDJCAFAEaBRCIGIACEYFYBYIAJKBQEQFJASAI', 'GKIDZDEBDCYChDpDAGQGbIAICIDIHIIIECBYFYGYJYCTDIDQHJAAIAJAGKFQBQEQAYHYDACAGIFJBQEQJYCYDRIJAQHZIAALEAJAFAFZGZGABLFQEQGQJQAbIQHKAAHYIaCBDBBBGJGAFLIIJQIQAQAJEBAYJYBYFYGYDSCIHIAAIABABZCYCQIJAQ',
  'GKIGTGQBRDZDsDgGpGDHbHAACADAEAGAHYHAFbJQBQIQAKCADAEAGABaJAFLHQBQGQCQEQDQAaIAJAFAHKBQFbJQIQAKCADAEAGAFABAHaJQFLGQCQEQDQAaIAFAJAHKBQGQEQFaJAGKBAHaGQJQFKEABAHAGaJQFQIQAKCADAEABAFbIQAQDKEAAZ', 'GKQGiGFCdCJDpDrDYEDFaGEAAAFYHAFAGaBQJQIQEJAAHAFAJZIQEQAJHAFAJAGABZIQFKHQAZEAFAIABJGQJQHQFaEQAJFAEaIAIYJJHQEQFQAZCYCQAKDBBIFAEAHAJZBAGLJQGYHQBYDREQFQAaCACIAJFAEAHABZIIIQAQFKEAHABAJAGaIQAQ', 'GLACdCJBYBFCKCZCBDrDDETFDQAQHYFAGIDIARCYDCGYFSDICIHIACGYCSDYCAFBIZKQJQHJFACIDRFYHYJYEYBCKICIDIIIFSAIGCFYDYCYIYKYBSEIHIJIAIGIFCDYCYIYASHYJYEYBCKIAICIDIIIFSGYHYJYACKYBSEIAIHIJIGIFCDYCYIYKYAS', 'GLADpGgBICRCUCaDiDsDEECFEAFIGIHYGQKQAJDACABYEAIYFQJQAJKAGAHAIABJCQCIDSEYIYKYAYJYFCGIGQHKCABYGQIJCJKRAZJACAKAIaGABJIQGaHQHYFRJICBHBGJGAIAIJKRHZGAHAGZCRJYFBIICQJQAJHAGAKABZIQCJJRARGJHJKBJZAR',
  'GLEBRBBBKBFCICaCCDgETFrGERAIFAHIDAGAKYEQAQHIDICIBBIAKZJQDQDICICQGBHYIIFRBYGYCYDYAYECJIDSCIDAGIBIFBIYDYJYESAICIHIGIDCIIFRBYDYGYCYAYHYECJIIIDSBIFBDYIYJYESAICIHIGIBIFIDCIYBSGYCYAYHYECJICSAYAQ', 'GLEDiGlBCDQDpDrDAEKEYEMFIQDQAZKACAGIFIJQEQHQAZDAIAEKJAFZGZCQEIIQDQAJHAJAFAGZBQFKJQFYHQAZDAIAFABAGKJQFZIQDQAJHAFAJAGaBQIQFJHQAZDAFAIABAGKJQHQAQDZFAAJHAJAGaBQIQAQFQDJHAAZIABAGKJQAQHQDZFAIAAJ', 'GLRBkBaBhBCCQCdCqDAELFDGFQGBBIHICQEQKYGABAHICIDIARIQKZJACACIDIDAERHYIIFBAYEYDYCYBYGSJICCDICQEIAIFRIYCYJYGCBIDIHIEICSIIFBAYCYEYDYBYHYGSJIIICCAIFRCYIYJYGCBIDIHIEIAIFICSIYACEYDYBYHYGSJIDCBYBA', 'GLSBACdBBCUCbCMDYDsDCEgHFAGAEAIYCQEIFIAIAQHIJQGZEACAFBAIIIKIBSDYGYJYFYACCYAQERFQGKFAJAHAKAIaEQAICBIJKIBIDSHYJYFYCYAYGYECKIFSHIJIDCBYFYKYESAICIGIHIJIFCBIDSFYHYJYCYAYGYECKIBIDIFSHYJYCYAYCABA',
  'GLYCKGFBUBVBZBIEaEkEAGpGHAJJGAAAKYIYERCRBIJIGIABFYHYDYCYEBHQGQIIKIDQFQAQJaBACAEAGIIAKJHQAIFCHYDYIYERCIGIDBHIFSAYDYGYCYEBHAIIHIFIARDYGYFAKZIQCQEQBQJKDAAAGAFAHAKYIYERCIHIFIAIDSGYBYJYCBHIFIAI', 'GLcDIGQBgBsDhEAGTGZGjGDHHZAAIJFAEaJQIQAQHJFAIZAQHQKQGKBACADAFAHZAAIJEAJaIQAQHJEAAaIAJKAQDQEQHaKQGQBKCAFAHADAEAAAJaIQKQHKCQFQBaGAHAKAIAJKAQDQCQEQFQBQGaHABKCADAFAEAAAJaIQKQBQHQGKCAFAEAAAEYBY', 'GLjGAHUBFChDoDqDsDDERGZGEYAYDRIIJYKYCYCBJJKJEBFBGZGAHbAQKQFKEQJZFAKAAAHLGQGJERAZKZFRCRIYDBFIFAHAGJCRFYFACAHAGAELAQCQHYKQJQFaHACAGAEAAKKQJQFQHaCACYEYGYGAEAAAKKJQCQFQHQGaEAAAKAJKCQAYFQHQGQBQ', 'GMBDTDkBFCdCJDiDqDDEQEgEaGAYBYFYIYDYECCICAHJGQLQBQIQAJFAJAKAGZHZCQBJIQAQFJJAKAGAHZLQGKKQGYJQFZAAIAGALAHKKQGZIQAQFJJAGAKAHaLQIQGJJQFZAAGAIALAHKKQJQFQAZGAIABZDQEQGJAJFAJABZIQAQFJJABAKAHaLQIQAQ',
  'GMIBaBJBUBVBTCkDCEEEYEoGrGAABACAJAKALaGQGYERDIFIBIJIARCYHYIYDBEBGIBRJIAICRHYIYDYEBFIDSIIDAHICBAYJYDYFYESIIDBJIAICRHYDYIYECFIJIDRHICBAYDYJYFYESIIHICIABDYJYBBKILIDRARCYHYBBJIAICRHYBYIYECFIJIAI', 'GMJDZDYBACUCEDBGLGRGhGoGrGBIEIIIJICICADRAYGYFYHYEBBJJYBQIQHQAKGQFaAAFIGJCADBIIJYJABbIQBIJKCQDRFYFQAaGAHAJYJAIAIYLAKKBQCQDQFQAQGZLYERHIHAEAAKFACAFIDBBYBAKaLILQIQIIBIDQJQAQAYFJGQHaEAFAGJCAJIBA', 'GMTDjDNBJCdCoDAGDGKGaGgGqGAYDYIYCYEBBIJYCQIIKILIFIDRAZAAJAJYKABaLAFKBQFYLZCQERIIIQALJAAYIaCAEBFIFABKIILQKQIQJQGQHaAACAEAFABAGIJIDBKYLJKQDQBaFQCQFYERAIAQGYHKGAJAIABABIFZJYAYEALAKKDQFQIYLZCQAQ', 'GMUDIGYBDCZDhDEEQGbGjGoGrGBAHACAEAFAJaIQAQDQGQBKHACAEAFAJAIaAQDQGQBQHKCAEAFAJAIAKALaAQDQGQJKCQFQEQHaBAJAFKDAEQJZFAGAAALKKQIQCQEQJYDAIICQJQHQBaDAFAGAAAIJEQAaDQGQFQBKHAJAAACAEAIaDQGQFQBQHKJAAA',
  'GMZDrDBBACYCCDKDjDEEUEhERGAIBIHIKIEIDSCYCQFZGALAAAKABZHQJQIQGJFJCAAZKABAHZJQIQGQFJLAGaIAGIJAHJBQKQGQLQFaIAGJKABAHZJQGQIQFKLAKAGZJAHJBQGQKQLQFaIAJAHABJGQKQAJDAEAGZBZHQJQAJKABAHZJQAQIQFKLAKAAZ', 'GJDDrGYBhDLEAGoGIHbHAIDAEIFIHICCGABaIQDKHQFQAaEADAHYIABKGQHQCQDaCAEQAKFADAHAGABaIQEQAQFJDAAaEAIABKGQHQAQDQFZEAAKDQDYAZEQFJCJDBAZCQCIDQFaCAEAALCQHAGABaIQAQEQFKDAHAAbIABKGQAQHQDQFaCAEAIAAL', 'GJNBACZBYCdCpDLEBFbFAACIEAGAIAFKDIBSHYCCIYEYASGICIIQHIBCDYIYCTGYACCBEICICQIIDIBSHYGYAYEBCIASGIHIBCDYIYAYCYERGIACCYCQARGYEBFBCJARCYFYESFAFIGIADFYIIDIBSHYAYGYECCIIIATHIBCDYAYIYCYESFIGIHIAD', 'GJdBYCJBACFCBDbEDFZFAQCIEQGQHQFKDIBCIYCSHYEYACGICIHAIIBSDYHYCDGYASCREICICAHIDIBCIYGYAYERCIACGIIIBSDYHYAYCYEBGIASCYCAABGYERFRCJABCYFYECFQFIGIATFYHIDIBCIYAYGYESCIHIADIIBSDYAYHYCYECFIGIIIAT',
  'GKBBaEABNBQBRCdCoDqGCIBIDAGAIIHIERCRAYFBHBEJCRCIATFYHYEAJYDYGBBIEICIAIHIFSJYECBYGRDIEIJIFCAYCYHYBYESDYGBEIBICIAIHIFSJYDYGYECBIDSJIFCAYCYHYDYBYDQESGIHIJIFIADCYCBDZHRFRAIBYCBDBEYHYIYGSJIAIAQ', 'GKKDYDSDcDMEaEkEAFCGpGBQHQIZEADAGAJJBQHQAZCADZEQIKAAHABAJaGQEQCJDAFABJHQDZCZEAGAJKHQDQAQIaEAGABJFQDJAQCZDAFABZGQEQIKCAAAHAJaGQEQDJAJHABZFQAQDZEAGAJKBQHQCQIaEAAJDQCJHABAJaGQAQDJFABJHQCZFAAZ', 'GKZBVCjBICUCaDJEAGoGDHBQEQJQHKDAAYFYCAGAFAAJIIDSFYGYACFIFRARAYGIDCFYCYCAFJAQAYAQCYCQDQGQHaJABAEAIJCQGQGICCAIDRCYACFYFQGQAICIDBFYFACQIaBQEQJQHKAAAYDAHYJYBCEIIJFQCQCYASHYJYBYECGJAJCJFBIZGQBQ', 'GLDBRCABQBSBgBbDBEEETGiHBQKIERGYJZIRAJHJCJDBDIFDBYEYGYJYIYKYATHICIIICRHZIBCJGJJJDRFIBCEYDRFRHYIYCBJIFIDBEIBSHYFBGYJYABKIEIDRJZAYCRGYIIFIFRIZABCBFJARAYCYCRIJABAYCYCBGJJJDBEYKYFRJIARHIBCEYDRAY',
  'GLDDZDTBICLDRDoDBEUEgGjHAIDABYEICBFIFQCQHQAaEAIAFJBJDQAYBYEZIAFAKAGLJQBQJIDRHYCYCQEQAJHACYFZIQAJEAFACIHQEZAZIAKAGAJJBQGaKQIQAJEJHACYFQEQAZIAFJCIHQAZEACACIGABAHIDBJaDQKQGKCQHQAQEZIZFBGBCJHJBB', 'GLFBQBCBRBUBVCLDAESEjEgHFQAQGAGICIHIBBDYIYEYAYFBJIKIDRBRHYCYEBIIBIDBKYJYFRAIIICRHIDBBYCYIYAYFBJIKIBRCYIYERHIDICBBBKYERIIDRCIBBDYIYEBKIDRBRCYHYEBIIBIDBKYJYFRAIIIBIDICRHYBBIYAYFBJIKICRDYIYERBI', 'GLaCdCABBBFCMCDDgDKEQEjEHQJQCQDQGaFAIAAAKAHKAQIQGJCAGYJQDQDYIYFYEYBCHIKIFSIIDIDAJACQGYIAAAFAHbAQFQIQKQBQEQGLIAAAFAHJJQCQDQIZGZBAEAKAHJAQFQGRIJCBDYGYIYFCAIGQJIDRCRIYFYACHYKYBSEIAIFIGAJAHZKQAQ', 'GMADpDVBlBYCcCCDEDIESELGhGFAKYCADABKLQJQJYFYDYDABACQKIIILJJQIQKaDAFABYCQDIFIKIEBJYBYFQLYCQDQKJIABABYFYDYCBDQLIJIERIYKYCADIFIBIBAJALZDQCQFQBIKIIIEBLYFYDYCRBICADAFALKJQIQJYKZBADALYCQDIFIIIIQKQBa',
  'GMMBqDDBhBFCcCdCQDYDiDSEAHAADYFABIJYJQKQHJIADAJYBYFQHIIIDAJABZKQIQHZCRAYFCKIBIJIDRHYIYCYKABJJQCQHJIACYDAJYBYKYFSAIHIIILIDCCYCAJABZKQIQIICIDRHYLYAYFCKIBIJIDRCYHYIYARLICBHYIYAYKABJJQAQHJIADAJYAQ', 'GMRBLDCBQBbBSDUDAEcFDGgGpGBILYEQFQCQCIHIDBAYFYEAHQJZBAGAIALKKQAQDQFQJYCAEAFIAIDRHYEYCRGZBQJKHAAADAFZCQEQGQHIDBAYGYCBEIFIAQDQGQHQJaBACAEAIAFKGQGIAIDRHYEYEAGACQFZIQBQJKHAAADAFZGQCQEQBZIAGJCQEQBQ', 'GMhBFCUCYCaCbCJDQDSDsDDEAGAABRGYKIIAEAFAJaBQCQFQKQLKGAHADAJYEQIQIYKYHILYBCCIFIEIAIAQIQHQGQGIDBIYAAIQDQLZKAEAFAJKIQIIDRHYAAGYIAJZEQFQKQLJGAHAHIDBIYJYARHRKZEBFBAJIJDQIQHQKQGQLZEAFAAAAYCYBSFICCAI', 'GMjBYCKBaBdBACJCcCBDpDDGLHAAJIGRCYLYEBHIAIDIJIGIBIFSCYIYKYLYEYHCAIAQERHQKIIILICIFCBYGYDYEYJYAYAAHRJIDQLICIGBDYJYAQCRLYHBAIEICIJIDIDAGRJYLYEBAYHREIACCIDIJIGIBIFSLYAYCBDIARLIFCBYGYAYAQDYCRLIGBAY',
  'GNFBADRBaBbBgBICMCSDkECGJGpGARCQIYEAKIBIGAFAMYJYARHIEIEAIICAJAMJFQGQBYKYHAAAMIDQDYJYAYMYHSEIABEAHAJIMIDIDAMZCQHQEQIYKIBIGAFAMYJQAQAYEYHBJIMIAQFQGQBYIICAKYHAJAMJDQDYAYJYMYHSEIEAHAIIAALIMIDICRAYAA', 'GNNBpDLBMBZBaBgBBCCCICbCcEDGJAGABYFQIQLQDQMYAADICICQKBLYDRCIKIIIFCBIEIGQHRJQMZIAKALABJHQFYEBHIGIJRFYGCHYBYLYKSIIEIGIFIMIJCHYBYLYKYISEIGIFIMIJIHCBYLYKYGSFIGAKBBJLQHQJQMZEAIABIKRFYGCIYCYAREICBAYAQ', 'GNZBBDNBdBQCIDiDDGKGRGaGoGrGBYHYCADAJIAAGYMALKGQAQGYJYLYMYDRCRHIBIIIFIEBAYKYCYMYCQJJDAFQBQLIGIAQEQHaIABKFAJZBQIQHKEAAAFAGYIZBACALYDQCIKIMIAIERFYHYIYBYCBJJDALIGIEQIQFQHZBAFKIAJaCQFQBQHKIABaFAJJAA', 'GNZBCDEBLBFCUCYCaCdCADrDIGQGAQDRLIMIGBAYHYDYKYFQMIHAKYFYIYESCICQBJJJGAAALIHBAIGSHYJYBYLYMYCYECIIFIDIAIKIGIHSJYBYLYMYCYFCDICRDQFQBIJILIMIHCGYAYCYKYDYDAFRLIMIABCYDYFYIYESBIJILIMIAIHIGCCYCQGQHRJZBZ',
  'GNcBJDdBgBICTCADhDpDRECGLGrGAAKIGIEADAIYMYCQAIFIHIJIDIERBYGYKYLYABCBMIIIEQBQLZFAHJJQBJDALIEBIYIAMaHQFQHYCRARKIGILJGQKaLAGKBAJAIJEQBZGZAACAFAIYHAMKIQHZFQIYMYCQAQGJBJEAHYJQBQGaLQKKEAGADAHAIAMZFQBI', 'GKDBcCjBACBCCCYChEEFZGBICIHIJIESFYAYIYBCCIHIJIATFIECAYHYCYJZBSCAIIFIEIDIGCAYHYJYFSIYBCCIFIHIAIJIGSDYEYIYFCHIAIJIESIYFYBYCCHIAIJIEIGIDSIYECAYHYJYCTBIFIEIJIADHYCYJYBSFIEIAIIIDCGYHYCYJYBYFSEIBC', 'GKLBcCjBACBCCCYChEEFZGBICIHIJIESFYAYIYBCCIHIJIASFIECAYHYCYJZBSCAIIFIEIDIGCAYHYJYFSIYBCCIFIHIAIJIGSDYEYIYFCHIAIJIESIYFYBYCCHIAIJIEIGIDSIYECAYHYJYCTBIFIEIJIADHYCYJYBSFIEIAIIIDCGYHYCYJYBYFSEIBC', 'GKbBECDBACYCZCaCBEcFRGBICIHIJIFCGYAYIYBSCIHIJIACGIFSAYHYCYJZBCCQIIGIFIEIDSAYHYJYGCIYBSCIGIHIAIJIDCEYFYIYGSHIAIJIFCIYGYBYCSHIAIJIFIDIECIYFSAYHYJYCDBIGIFIJIATHYCYJYBCGIFIAIIIESDYHYCYJYBYGCFIBS',
  'GKcDIGQBFCqDDEgEAGiGRHEJIIGICRJYAYDQFQHKBAJAGAEaCAIQAQDQFQHQBKJAGAEAIaAQEJGQJQBaHAFAEAAAIKGQEZFQHQBKJAEAGAIaAQFQEJJQBaHAEAFAAAIKCQGQJQBQHaEABKJACAGAIaAQDQFQBQEQHKJABaDBFAAAIKCQGQBQJQHaEAFAAA', 'GKiBFCQBECRCCDAEcEKFrGCREQGQFZIAAAHYJYBSDIIIGICCEYAYFIHYJYBYDSIIGICIECAYCRGYIYDCBIHICIAIESGYCBHYBYDSIICIGIECAYHYCRIYDCBICIHIAIESFYGYIYCCBYDSCIIIFIGIECAYHYJYBYDYCTIIBCHIAIJIESFYGYBYIYCDDIHIAI', 'GLADkDFBECICCDJDcDgEiERHBQCQGIHQDQFJGAKAJABZHQCRDQFQGJAJEAIABZHZDQFQGQAJKAFaGQGYCBDIHIBIJIIIESKYGAJAHABJIQFQKQAbCAGAJAFJIABZHQFQJQGQAKKAIABAHZFQBJIQKQAaGAJABAFAHJIQBZJQGQAKKABAIAHZFQJQGQAQGIBI', 'GLBBTCFBUBVBYCkDhEQGrGCHAYHAJZGQKYDBBIIIFAJYGYERCRDIBBGBEZCRCYDTBIGIEAKIAIFBHYEYCYDYGYBSIJKIECHIEQFRAYEYIYKYBCDICIGIHIERAIFBEYHYCYDYGYBSIIKIAIFIECHYASIYKYBCDICIGIAIAQHIESFYGYIYKYBYDDCICBAJGRBR',
  'GLDBBCABCCFCTCaCoDYEcErGAIFBJYERAIFIDIGCIICSBYGYDYFYAYEBHIJIIICIBSGYCCIYJYERAIFIDICIGIBCIYCSDYFYAYEBHYJICIDSFYCCJYERAICIFIDCJYCSAYEBCIJIDSFYAYEYCCJIASFIDCAYHIJYCSEIFIDIACIIBSGYAYDYFYEYCCJIIIAS', 'GLFBhBMBVBiBsDAEQEKFCGjGBYCQEYFZKYDRCIIIHIBBEYFYKYDYCRARJIGIBBEBKYDYCYARIIDCCYCAFJKQEQBQHQGQJaIACIHIEIBRGYDYIYADCIFIHIDRGIBBEYDYHYCYASIIGIBIEBDYBRGYIYACCIHIBIDIERGYBBHYCYASIIBIGIEBDYHYCYAYCQBQ', 'GLKBZCiBDCECFCdCQDAEjEaGBYCYJYKYESDIAIHIIIBCCYJYKYASDYECAIJICIKJBSHYIYDYEYFYGCAIJIKIDSHIIIBCCYDYJYAYKYGSFIEIHIIIBICDDYBSCQHYIYEYFYGCAIJIKIBIDICSHYIYBCJYAYKYGSFIEIBIHIIICDDYJYAYKYESBIIICIDCKYAB', 'GLNCJDaBlBTCcCRDqDDEYFAGAABYDAFAGYCBHJEQEYFYDYHYASIIIQKKBACAEAGAJAHaDQEQCQFQCIECFYCSIYABDICIFIESIYCCDYARCIIIECFYDYAYCSIIDCFIESDYIYCCAIFIEIDSIYCYKYACFICSIIDCEYCYFYASIIDIEBCYDSIYACFIDICIERIQKQBK',
  'GLQBpGDBgBECcDiDkERGZGAHEICIGYKIABIYJYFYEQFAJJDABYHYERCIFIIIKIAIDCGYIYFYJZFQIKJAFaHABJGQFQJQIaHAFKGABZFQHQIKJAGABAFaHQGKJQIaGAHAFKBQEAJQIQGaHAFABKJQFaHQFIGKIAFAJABaHQGQIJDRAYKYCYEBGIFIDIHIJIAS', 'GLQDjGiBLCcDMEgEAGDGIGYGBQDQEQFQJKAAKACAGABaDQEQFQJQALHQIaAAJADAFAEABKCQGQKQHQJaDBFAKKCAGABaEQKQDQFQAQIKJAHACAGABAEbKQBKCRGQHQCAJQIaAADAFABAKAELCQGQBaDQFQAQIKJAHABACAGAEbKQDQFQAQHKBAGAEAKaDQAZ', 'GLSDrGhBiBYCQDjDBEMFDGZGGIHYAAFJHQJaIAKJCADABZGQKQIQJKHAFZDADICICAKZIQAJCBFIFQCQHQJaAADBIAKJFQCQCIFAHIEBBYBAGbKQBKFQGIERHYCYCADRFABZIQAQJKCAHAFAFYCRAZIABJCQCYDYDQFJHQJaIABAKAGKCQDQBZIQJKHAFZAQ', 'GLUDoDlBQCcCMDhDqDAECERHCAFAAAEAGIHJGQKQJQFZAACBEAHAGJBJDQIQFZAZEAHAGABJKQHaGAGYCREIAIFIJIIIDCKYGQJQAQFJIAHAKABbCQGQJQHJIQFZAAHAJAGABKKQIQHZAQFJHAIAKABaGQJQAQFQHJIAAZJAGABKKQAQIQHZFAJAGABAGIAI',
  'GLZDLGICbCcCdCTDJEAGDGgGFAKQAQCQHQBaGADAEAKKAQCQHQBQIQJaGAIKBACAHAAAKaDQEQFQIQGQJKBACAGZIADAEAFAKKAQCRHQGQBQJaIADAEAFAKAAKHQGQBQJQIaDAEAGJHAAaKQGQDQEQGIIKJABAHAAAKZGQAKHQAYBQJQIaDAEAAAGAKJHQAZ', 'GLbBECDBACYCZCaCcDBEkERGBICIIIKIFCGYAYHYJYBSCIIIKIACGIFSAYIYCYKZBCHIJIGIFIEIDSAYIYKYGCHYJYBSCIGIIIAIKIDCEYFYHYJYBYCTGIBCCAHIJIFIEIDSAYIYKYBYGYCCHIJIBSIIAIKIDCEYFYBYHYJYCTGIIIAIKIFCBYJYCYGSKIAR', 'GLjBECDBACYCZCaCcDBEkERGBICIHYIIKIFCGYAYJYBSCIIIKIADGIFSAYIYCYKZBCHIJIGIFIEIDSAYIYKYGCHYJYBSCIGIIIAIKIDCEYFYHYJYBYCTGIBCCAHIJIFIEIDSAYIYKYBYGYCCHIJIBSIIAIKIDCEYFYBYHYJYCTGIIIAIKIFCBYJYCYGSKIAR', 'GLqGDHKBQBaBJCgDoDTEAGjGAIEQCQIICIECGIHIDRFYEYCYCAGAKZIQBQJKCAEAGAKAHAAZHIIQKJGQCQEQJaBAKAIAAJDIFREYGIDCAZGYHYIQKQBQJKCADAGAKZIAAJHQKQGQCQDQJaBAIAKJGQCQCIDIEIFBGAKaAAHKKQAaCRIQBQJKDAEAFAGAAAAI',
  'GMZBsDCBLBACBCECSCYCbGjGpGDAGIDICIHBJYKYGRDICIHIFIEIICAYJYKYCSDYGBCIDSHIFIEIIIACJYKYDYCYLYBYGSHICCDIFRCYDCFIJIKIASIYEYCYDYFBJIKIERCYDYFYHYGCJIKIEIAIIRCYACEYJYKYGSHIFIDIAIEBJYKYFRDIAIEICIIBJYKYAS', 'GKIBFCJBlBYCZDhDDFbFAGCIAIDAEBGQFQFYGYIYDYBSHICICAIAGKFQFIERAYIYCSHYBCDIGICQHQIAJJAAEAFYCYGYDQBQGAJIIACACYGYDYBRFJCQEQAQIQJaHAHIIIAIEBCYASIYHYHQJKBBDIFIGIAICIERIACAIYADFZGQHQHYBYDCGIGAFKHQAQAI', 'GKdBYCABcBFCLDTDBFZFrGCQDYAYERFAFIGAGIHICIBCIYDYDQHQFaGAGYEBAIHIDCHQIIBSCYFYDAIAJZAQEQGIDIFICABAFQJYHQDQDIFICIBBGZDAEAAAHAJKIQIYHYAYERDIACHIIIIAJaBRCYFYGYAYDYEBHQDQHIATGJFAIAIIBICSFYFQGaIAAAAY', 'GLBDaDYBlBACDCZCEDJEMFiGCQEQAYKQBQBIFQHZJADAKIGICIERIYGBKYDQJQHJAJIACBBZEAKZDZJRHRAJFADAHAJAKKBQCQGQIIEBCYGYDYDAFRIIGBCIESGYIYCABAFBBICRDYBACIDRBYBACACIDIEIGSBYIYDDCYCQDRFRIJBBEBGBCZDRDYFYFQIQAZ',
  'GLDDsDMBgBFCaCbCKEQEcEAGIAFYGYBYJYESAICIHIIIDCFYGYBYJYEYCSHIIIDIKIFCGYDSIYDAHYCCEIJIDIGIFSIYDBJYEYCSHIDIIIFCGYJYDRHYCCEIDIJIGIFSIYHYDBEYCSDIDQAQKJIAFAGABZJQHQAZEBKYDBCBJJBJFQGQHQAQAZHBBBJZERHIAI', 'GLJDqGgBhBlBDCSCBDQEEFbGAYHYGBKYKQFQGQJQHLAAAJIBCBDBBZKZEZJRHRAJFAEAHAJABKKQDQGQIICBDYGYEYFRIIGBDICSGYIYFBEIDICIGRIYFYECDIFRIIGBCYFYDYESIIFBDYEYIQAZHAJABAKKCQDQFQGQAZIAEADIEIDBCJFRGRARIZDBEBAJAQ', 'GLLBrGRBSBYCUDkDEEbGhGAHAABZGQJJCQDQFbIAFIJAGABJCQDQFQIaJAFKCADABZGQFQJQIKCADAFaGABJFQCQDQIaJAGABAFKCQDQGaJQIKGACADAFaBQEAJQIQGKCADAFABaJQFKCQDQGaIAFAJABKCQDQFaIQGKFACADABaJQIQGQFKARKIEBCYDYAYAQ', 'GLMBaCbBhBFCDDKEQEcEAGrGDYHABYCYIYKYESAIFIGIHIDCBYCYIYJIKYEYASGIHIDIBCCYDRHYGYACEIIIDICIBSHYDBIYEYASGIDIHIBCCYCQIYDRGYACEIDIIIKICIBSHYGYAYJYFYECDIARGIHIBBCYIYAYDYESGIABIICIBRHYAYGYECDIIIKICIAQBI',
  'GLQBdCABiBECFCbDgDjEJFBGHQAQCQKYEYFYBCGIIIDIDAHJAQAICSJYDYDBGZBQFQGQEQKKJAAACAHZGQDRJICCAYAADYGAHJDQDYGYHYIYBRJQKZFAFIEIEAJIAIDBGYHYIYBYFSEIKIBBCIDBAYCRIIGIHIARCYJYBYKYEYEQKJFBIIGIHIAIJAAAHZGQAI', 'GLZDLGICbCTDcDJEkEAGDGgGKQAQCQGQBaEADAFAHAKKAQCQGQBQIQJaEAIKBACAGAAAKaDQHQFQIQEQJKBACAEZIADAFAHAKKAQCRGQEQBQJaIADAFAHAKAAKGQEQBQJQIaDAFAHAEKDQGAAaKQEQHQFQIKJABAGAAAKZEQAKGQBQJQIaDAFAHAAAEAKJGQAa', 'GLaBECCBDBFCZCdCAEbEQGqGFYAYIYBRDICIHIJIFCAYIYKZBQBYGYESDIGCBIIIAIKIFSHYCYJYGYDYECBIDTGICIDAHIJIFCAYIYDYBYESGICIHIJIFIACIYDYKYBYEYGSCIHIJIDCIIASJYFYDYHYCYGCEIBIIIAIFRDYACIYBYEYGSCIHIAIDIFBIYJIAS', 'GLbBBCCBDBACYCcCEEZETGpGGIAIIIBRCYDYHYJYGCAIIIKJBQBIFIESCYFCBYIYAYKYGSHIDIJIFICIECBYCTFYCADYHYJYGCAIIICIBIESFYDYHYJYGYACIICIKIBIEIFSDYHYJYCCIYASJIGICIHIDIFCEYBYIYAYGRCIACIIBIEIFSDYHYAYCYGBIIJYAS',
  'GLbBDGRBSBACMDcDkEJGTGgHAQBZFAIJCADAGbJQGIIQFQBJCADAGAJaIQGKCQDQBZFAGAIAJKCQDQGaFQBJGACADAJaIQFQBQGKCADAFaIAJKFQCQDQGaBAEQIAJAFKCQDQGQBaIAGKCADAFaJQGQIQBKCADAGaJAFKGQCQDQBaIAJAFAGKABKIERCYDYAYAA', 'GLbDIGNCaCRDYDLEgEAGDGjGKQAQCQGQBKEADAFAHAKaAQCQGQBQJQIKEAJaBACAGAAAKKDQHQFQJQEQIaBACAEJJADAFAHAKaAQCRGQEQBQIKJADAFAHAKAAaGQEQBQIQJKDAFAHAEaDQGAAKKQEQHQFQJaIABAGAAAKJEQAaGQBQIQJKDAFAHAAAEAKZGQAK', 'GLcDLGABYCEDBEhEQGTGZGjGKQAQJJGAKZAQJQIQHKFQEaBACQHAIAJAAAKJGQFQEQBaHAEKFAGAKZAQJQIQEQHQBKFAEaCAIAJAAAKJGQEQIaJAEKGAKZAQEQJQIKGAEaAAKJEQGQIaJAAAKAEKGQAaJQIKAACQGAEaKQJQIQAKFQBaHAAAIAJAKAEKGQFQAa', 'GLhBTHQCADCDEDIDREKGiGrGIIGICAAYJIKZHQGQIZFQEJDJCAAADYKYJQBQFQIJDQEaIAFABAJAKKHQGQDQFaBAGKHAKaJQGQBQFKDAHAGaJAKKAQCQGQHQDQFaBAJAKAGKHQDQFQEQIaBAFKDAHAGaKQJQFQBQIKCAAAEADAHAGAKaJQGKHQHIAIAACRDYBY',
  'GLiBcCdBDCKCZCbCEDIEMEAGFYAYERIIFBAYEYGYDSJYCBBIDIGIEIAIFRHYIYJYCYBCDICSJIIIFBAYEYGYCYDYBSJICCGIEIAIFRHIIYCYGCEICSIIFBAYCYEYGSIICCAIFRCYIYGCEIAIFICSIYACEYGSAIHYIICCFYEYGYASJYBCDIAIGIEIFICSIYJYAC', 'GLjDQGdBFCYCIDZDCETEhErGFAHIBAEAGAJAKaAQCQIQHQFKBADQEAGAJAKAAaIQHQFQBKGAFZHAIAAKKQJQFQGQBaHAFJJAKAAaIQFQHQBKGAGYJAFZIAAKKQEQFQJQGQBaDACAHAIAAAKKFQAZIQHQBJGAJAAAFAKaIQAJJQGQBZHAAAIAKKEQFQJQGQAYBQ', 'GLpDDGNBUBYCkDsDIEAGKGZHCQJIHIEBAYGZFQCQDQJQBQIKEAHAJZCADAFAKYFYCRDIFACYDRFIJJHQKIERIaBAJAFACADAGJAJEQHYFZCADAGAAJKQFQFYCYHIEBKYCRDZGBABCJDRDIKIERHYGZAAFKGQGYFYHIAYCBDIEBKYFRGJHQJZCADAFIKIERJYAA', 'GMABpGVBgBMDSDQEkEDGJGaGhGFIIZEACAKIGIARIYEYJYEQIKJAAAGAKaCQFQEQIQJKGAEZAAFAKJDBBYLYHYCRKIEQFZKACAHABKLQDQEQFQKaCAHABALKDQEQFQKQAQGQJaIACAHAKKDAFAEALaBQKQCQHQIQJKAADAGAFAEAKaBALKKQBaCQHQFKEAEIDIAR',
  'GMFBqGQBlBIDSDUEgEAGKGZGiGFYIJEACAKYGYARIIEIJIEQIaJAAAGAKKCQFQEQIQJaGAEJAAFAKZDBBILIHICRKYEQFJKACAHABaLQDQEQFQKKCAHABALaDQEQFQKQAQGQJKIACAHAKaDAFAEALKBQKQCQHQIQJaAADAGAFAEAKKBALaKQBKCQHQFaEAEYDYAR', 'GKADrDNBCCICJCUCdCDEgHCADQGYHABIHYCSIIAJFAGAJIERFYAYDYGYIYCCHIIRAJDAGAIAJABaHQHYCTAIIIGIDIFIECJYGSIYCCHIGIJIESFYDYAZIYCYHCGIBJJIDSIYCYHYGCJIDIEIFSIYDBIAEABZDQJQCQGQHQAJIJEBEYDYDBBBJZGRHRARIJCBAZ', 'GKBDoDABDCECFCQCaCJEbHJQDQEQAJIAGICSIYAYEAHBJYFSEIAIDIHIIICCGYIRAZDAHAIAJABKGQGICTAYIYHYDYEYFCJIHSIICCGYHYJYFSEIDIAJIICIGCHYBZJYDSIICIGIHCJYDYFYESIIDBIAFABJDQJQCQGQHQAZIZFBFIDIDBBBJJGRHRARIZCBAJ', 'GKVBACYBjBBCEETEZEkEoGEIBICCFYABGIDBHYJIDQDYGYJYIYATFIGIEIDCHICSBYDYEYFYGYADGIIIHICIBRDYCCHYGYIYATFIGIEICIDIBBHYCSEYFYGYADGIIICICQERGYARFIDJEBEYDYDSFZABDAFIGIDIEIERFZAZGBDJCBCIEIHIBRFYAYAQEBHIBI',
  'GKgBdCFCSCADjDpDrDIFCHFBHBGJDQHQFQJQEKIADYFYGYHYBYCSJIIIADDYDAGZHQFQIQEZJABACAHJFQIQIIDIDAGAAREYFZHZBQJYCBBIHIFIIIGIARDYGBFBAJDRGYGADAFAAAHaAQFQIQJQEKGAEYJYCYBCIIAIFQHIDQJYACIYBSCIAIJIDBFYHYIYAS', 'GKsDDGgBBCCCNCYDLEpGaHDYEYBYFAJIGIGQEQEIDICDGYGACQIYIAAbJQFQBIEAGKDQEQBaFAHAGAJAALIQIICSDYEYGYJYFRHIGAJAIAAaIIEQGYHYFBIIIQJQHQBJDACAJIEICIDSGYDAEAGACBAAIaJQFQBIEAAAAJCRERGQBaFAHAAAJAIKDQEQGQAYBQ', 'GLCBFBUBVBIDDERGjGoGrGYHEAGYCYDYBRFIAIGAKAHaBQCQAQDQFQELGAKAHAIAJaBQCQDQHKKQGQEbAAFAHABACADAJKIQKQHaAQFQELGAHAKAIAJaBQCQAQDQFQEQGKHAEbAACAFABADAJKIQKQEQHQGaAACAFABADAJAIKKQCYARFYBBDIAICIKAIaJQDQBQ', 'GLCGoGFBIBADUDbEKGRGrGYHGIKIDRHZIYFYFAIKHQEQAZFAEKHAIaCQEQFQAKHAFaEAFIIJDBKYGYCRIIFQEZIACAGAJABKKQDQFQEQIaAQHKIADAEAFAKABaJQCQGQAQHQIKDAEAFAAaCAGAJABKKQAQDQFQEQIaHACAGAAKKABaJQAQCQGQHQIKDAEAFAKAAa',
  'GLEDZDNBQCdCRDrDAETFKGoGAZBQCAEAFQGIKIDQHQAZJAHIDBBYIAKYGYEQCQGAJIAIKJBQFQHQAQJaIAGAFJBAKZFQGQIQJKAADAHABAKAFaGQKJBQDQHQAQJaCAEAGIFJBQKZIQAJAAHAIAKJBAFZGZEQCQAIJIDABABIFAGZKQIQFIDRJYAYAQJKHABAHYAY', 'GLEDcDkBACBCTCYCCDKDMEZFCIFQIQHQAZJABAFIKIESAYHYIYBYJYCDFIKIEIGIDSAYHYIYECKYFYCTBIJIEIAIHIIIDCGYKYESBYJYCDFIEIKIGIDSAYHYIYBYJYCYFCEICTBIIIJIAIHIDCGYKYCYEYFSBIIIJIAIHIDIGCKYIQBZJQAJHABAIAKIGSDYHYAY', 'GLFBaBIBbBMCYCDDkEAGpGJHARBYDYGIIICAFAJYHYAREIHAJJBQFQCQIYGYEAAAKICIFBBYDYHYAYESKICIDBBIFRDYCYKYECAIHIJIBIFIDSCYFBBYHYAYJYESGIIICADBBYFRKYABAIHIKIFBBIDRCRIYGYAAEAJIBIBADICRFYKYDAJZEQAQAYECHIBIHQAQ', 'GLJBoGABQBFCcDgDjESGZGCHAAGIHIBIDRIZJYFYEQFAJJDABYHYERFIIIKIAICIDCGYIYFYJZFQIKJAFaHABJGQFQJQIaHAFKGABZFQHQIKJAGABAFaHQGKJQIaGAHAFKBQEAJQIQGaHAFABKJQFaHQGKIAFAJABaHQFKIQGaFAHABKJQIQGQFaARKYEBHIAIAQ',
  'GLJDkDbBiBICDEUEgEAGRGrGDAFIIIEAHAKaBQCQGQFQIJAAJADADIHIERJYDACAKIEQJQAQIaDAFAJKEBHAKYKABbCQGQJQDQFQIKAAEAHAJaCAGABLKQJQEQHQAQIaDACAFAGABAKKJQBbCQBIDQGQFQIKAAHABAJAKaCQGQBKCAHQAQIaDAFABAGAKKJQHQBa', 'GLJGrGABVBMDQDYEDGSGoGaHDQHZEAAJIIFIFAIaAQEQHJFAEaAAIKCQEQFQHaAAFKEAFYIZDBKIGICRIYFQEJIACAGAJABaKQDQFQEQAQHKIAAaDAEAFAKABKJQCQGQAQIQHaDAEAFAAKCAGAJABaKQAQDQFQEQHKIACAGAAaKABKJQAQCQGQIQHaDAEAFAKAAK', 'GLKBlBLBYBACUCrDEEBGoGZHAYBBCYGIJIDQEQIYHYBBFIHQIJAAEADAJYGYFQBQKIDIERAYCYHYBYFCKIDICRAIEBCYDYKYFSBIHIIIAIEICCDYERAYHYBYIYFCGIJIDQCRAYEBKYBRBIHIKIERAICBDBJYGYBQFQIIAIAQCIDBEYKYCQIZFABABYFSHIAIHABA', 'GLMBpGFBVBACSDsDYEaGjGBHAABYFYGYJYDRIIIADAJAGABKHQHIESFYIYKYAYCYDCGIIIFIJIFQIaJAFKHABZGQFQJQIKHAFaGABJFQHQIaJAGABAFKHQGaJQIKGAHAFaBQEAJQIQGKHAFABaJQFKHQGaIAFAJABKHQFaIQGKFAHABaJQIQGQFKARKIEBHYAYAQ',
  'GLMBrGNBdBACYDiDgERGaGBHAABYCADQGIIJJIFIEQFAJZDABIHIERFYIYKYAYCYDCGIIIFIJJFQIaJAFKHABZGQFQJQIKHAFaGABJFQHQIaJAGABAFKHQGaJQIKGAHAFaBQEAJQIQGKHAFABaJQFKHQGaIAFAJABKHQFaIQGKFAHABaJQIQGQFKARKIEBHYAYAQ', 'GLTDoDYBACNCBDbDkEJFDGhGAABJCQDQFYGAJYEAHABJKQHYERAIIQJIFIDACAFQJZAAGAHAKYBYBAKKIQFQGZAQJJGAFAIAKaBQEQHQAQJQGKFAJZAAEAHABAKKCQDQFYGZAAJJIABZBQHQIQJZAQGJFJDACABYKYEQAQAYGQFJJAIAGYEBKIBIBAKaHQAQHIBI', 'GLUCYCDBlBACNCTCEDrDJEZFJAKAIZAQGQCQCIGCAYDYFRCIDCAIGSDYCYHYFCAICSDICAGBIJKQJQHZGACYDRGIHIJIEIBCKYCYDYIYAYFSGIACDICIIIKIBSEYHYJYAYGYFCDICIIIASHIJIEIBCKYAYCYDYIYFSGIHIJIACKIBSEYAYHYJYGYFCDICIIIKIAS', 'GNlBIEDBFBKBVBgBECTCZCcCqDAGERBIGCJYEYLYIQCQMIGAJALYIYKYHSCIBIMIGIJBEYGSBYCYMYHCKIIIGIEILIJSBYCYMYICGICRBIGQIQMIJCEYCYLYGYGAIRBICBGYIYKYHSBIIBLIEQJQMYBAHAKALJGQGICSIYGCCICALZHQKQBQMJIACYJAEALYKYHYAYAA',
  'GNsDBEVBACDDRDYDoDqDLGaGgGjGFJBQEZJACAFAKIGIDQEYJYCAKAMALKDQGQBQEQJZFAEKBADAGALaMQKQCQEQFQJKBADAGAKaEQEIGJBQKIDQJaCAFAGAEAEYKJBQGZEAKAMALKBQKZCQFIJIDABYLYMYCREIEQGKKAEaGQGYCBLIMIBIDRJYFYCAKYGAMALAAAAY', 'GKCDhGIBYCADZDkDJEpGLIAJEJCADAEYGQBJFQHQEQAaJABAGAIJFQGaBQJQAKEAHAGAFAIaBQJQAQEKHAGAFAHICIDBIABaDQJQGKCQHQEbHAGZAQHJEJCAGAFAFICREZGAFAAZHQGJEJCBAYAQCQEZFAHZGRFJFQELCAHAGaJABKIQAQDQCYGQHYHQEaFAJAAK', 'GKbBFChBECaCSDCEcEIFrGCYIAEYAYHYJYBSDIFIGIIICDEYAYHYJYBYDSFIGIIICIECAYCSIYFYGYDCBIHICIAIESIYCCHYBYDSFIGICIIIECAYHYCSFYGYDCBICIHIAIESIYFYGYCCBYFIDSCIGIIIECAYHYJYBYDYCTFIGIBCHIAIJIESIYBYFYGYCDDIHIAI', 'GKbDgGDBdCMDBEjETGoGQHEAFYCYHAAADAGAIKBQJQCQFQEbHAAADAGAIABKJQCQFQEQHaAAEKCAFAJABaIQGQEQAQHKCAFAEaCQGAIABKJQEQFQHaAAGAEKJABaIQEQGQAQHKCAFAJABAIaEQBKJQCQFQHaAADAGABAEAIKJQBaDRGQAQHKCAFABAJAIaEQGQAQ',
  'GLEBoDYBACFCLCcDJEiEkEBGAQCIDRKYDAFAIABJCQCYBYIYFSHIKJDADICDBYIYFYGYJYESAIHIKIFCIICSBIDYFYHYAYKYECGIJIIICIDSFYCCIYCQGYJYESAIHICIFIDCIYCRHYAYECGIJICIIIDSFYHYCBGYJYESAICIHIFIDCBYIYGYJYCSAYECCIASGJJABJ', 'GLEEiGDBKBdCIDaDrDYFAGTGGIIAHaBQDRGQKYEABIDQKQCQCYAYAQEBJJFAIAHAKIDABaGQKQEQJICADAKYERAIDIDAKAGABJHQGaKQDQDYAYEBKIDQBICQJYEAKABAHLGQGJIRCZDBBYKYERJIFICAIAGZHZEQAIDIFQJZAAEAHJGJIQCQJYDAKABAGAHZEQKYAQ', 'GLJDhGNBACYCZDDEkERGbGpGAACAIJFBIZJZCRGIAIFIIIDIECBYJYKYHYCRIIIQFQFJARGZFBAJAAIAIYCBHIBIJJKIESDYGYAYFYCBIIJIGRAZAAFQAJGBIZJZCRAIFIGIIIDIECBYJYKYHYCRIIIQFQFZARGJFBAZAAIAIYCBHIBIJJKIESDYAYFYGYCBIIJIAR', 'GLLGgGRBKCbCcCdCEDBGTGoGCYDYAYIYHYJYGCFIEIBIKICRDYAYJYEBBIJQAQKICIDRIQHaIIDBCYBYKYERAIIIIAAAJAJIDICCBYCQKYEYFYGSAIJIDIHQIZAAJAEAFAGAKKBQCQDQHQJaAQIKJADAHACABAKaEQFQGQAQIQJKHADYAYIYJYGCFIEIBIKICRDYBA',
  'GLYCdCABBCFCCDKDZDTEhEjECQFIGIDICIACHYDQFZGAIAJYKYBYESGIIIDIDAHJAQFYDYGYIYECBIHIKIDSGYIYEYBCHIKIDIJIARCYIYIQGQGYDCHYKYBSEIDIGIGAIAHZIICIABJYKYBYESDIBCHJKIJIARCYIYIQGQGYBYDYECHIKIBSGIGABBIAJIAICSIYBY', 'GLYGoGKBbBBCFCcCdCLECGgGBIEYCYIYJYGCDIAIKIESCYIYJYGYDCHYDQFSDIGIIICIJIECAYBYKYHYGSDYFCGIHIAIBIKIESCYIYDYHCAIBIJYKIEICSIYDYHYFYGCAIKIDRIICCEYDYAYKYGSFIHIIIDBEICSDYCAIYHYFYGCAIBIKIEICIDSIYDAEBBaKQAQAY', 'GLZBdCDBKBaBFCoDIETFAGqGAYCIEYDRHIJIACEYEAGAKZIQCQHIEIARJIEBEYHYCYJYFYBCIIDIDQGIAQGAGIAIESHYJYCAGADADYIYBSFICICQJJHAGZCZIBKJAQEQGQHQJZIADJCRCIGIHIECAYAAKZCQDQGJAJERHYABGZCAKIDAEQGYCYDYBYFSIIAICBDYAR', 'GLgBcEABLBMBNBQBBDJDDGZIBQEQIQHQJZFAEIDIDQHJIIJICICQJZGAHAIAIICIGIACKYBYERDIIRHRFZDBFIHICICAHZDRFICICQJJAAGAHZCZIBBBEZDRDYFTBIIIECJICAHIKIATGYCYHYEYEAHJGRCYEYEQIZJZBBDBDIKIAIEQGREYACKYDYDRHJHQIQIJAJ',
  'GLpDIEFCYCDDcDkDrDAGKGZHJQEQIJBADAAYHYGQFQCQIIBIDBKYFYFAGAGYCREIHIJIBQIZEAJACAFAGAHAALKQBQJZCAHIKIDSIYEYJYEQIKJABADBGZFQEQKYHYCQIQJKBAEZFAHAKIDRBYDAIYJYCBHIHQGKKAAbHQHZGRCRIIJIBIDBKIABHZHAGbKQFQEJBQ', 'GLqDDGkBVCBDMDZDiDTEgEIHEYBYFYDBCICAAJGYHQIQFQIYCYDRBIBQELKAGAFYJAHZIQFQGKKQEbBABYDBCIFIGAFAIAHJIIJQKQEQBZGAEKKAIYJAHZIQFQEQFYCYDRGQBKDAKAEaCAAAFAIAHLIQFQEJJAIZAZAQFQFJABIJJREZAAIAJAHbFQCQFZDRGIGQBQ', 'GMEDoGABKBaBLCMCQCRCBGjGrGGIFIDIDQEBIAKZEQFQGQAQAZFBGBKJEQIQAYDAKALABKHQIQAQAYBYEBKYLYGSFIDIEIAIJICIHCIYBYKYLYGYFSDIEIAIJICIHIICBYKYLYGYESAIAACQEBGAJYDAFABKLQKQCQAYHQIQJZEBGICICQAQEYGBCIAQEQEYGYCCAIAQ', 'GMIBTBNBcBgBZCdCiDDEJEAGqGCADAEAGAHILIFIEIASJYAAFBLaFQHQBQDQHIIQKJJAEALIAQEYFYBYBBDZIRBJDBDIFIEIABLYHYGQCQKIJIABEYFYIYBRCYGBHILIERARJYDYCYBBKYGAIJCRBYCYBRDJBBCBIZDRDIIICRBYIBCJBRBIFIAIEBLYHYDQGQKIFBBY',
  'GMMBACBBaBCCDCFCRCkDbGoGrGAABRCYHBIYDYJYGRAIFIEIHICIBBDAKALaIQIIKJDQDYCSHYEYFYAYGBJIKICIDILIBSHYDCCYERDICCEYJYKYGRAIFIDICIEBJYKYFRDICIEIHIBCJYKYFYDSAYGBDIFIJIKIBSHYEYCYAYFBJIKIERCYAYFYGYDCJIKIASCIEBAY', 'GMSBVBFBJBYBACECKDbEhEBGrGDQEQFQHYKYGYCYBBCQIIBQGRKKGAHAAADAHYJAKYBALZIQCQCIGIAIARDJJBAZDRDYGYCYBRKIHIFAEALYIYBRCIGIJIABEIFRHYKYCBBBIIDIEIARLIFQJZDBEBAJEREYAYDRJJEBEYJYDBAIJRDZABAYGYBYCRKIHIEAFALYGRAI', 'GMYBBGABVBTDoDEEZEJGQGjGqGEQJJLIFIAQCRBYIYGYDBEIJIHAKZEQJQDQGQBKIACAAAHAJZEAKJFALaKQEQJJFAEaKALKAQEQFQJaDQGQBQIKCAHAJAAAFAEALaKQDQGQJKCQHQIaBAJADAGAKALKAQCQEQFQHQJaBQIKJACAAAHAFAEALaKQDQGQBQIQJKCAHABa', 'GMcBYCKBhBJCaCbCdCMDAGDGTGAQBBDYERIYCYLYHBAIGIFIEIDIBRCQJQKaIAIIJJCACYDCEYFYGYAYHRJIKILIDICIBCEYCSDYFBCIDSFYJYLYHBAIGICIDIFRJYLYGBCIDIFIEIBSJYLYGYCCAYHRCIGIJILIBCEYFYDYAYGRJILIFBDYAYGYHYCSJILIACDIFRAY',
  'GMsDSGCBVCYCADDDQDZEbELGpGGIHAEALYAYDQBICQFJHACYBYDAAILIEQCYBYKZGQFJHJCAEAHYLYAYDQGQKJHQFaKAGABJHQGaBADAJAAALKEQCQIQHQGQFQKaBADAAIJAHJIALZAQHQJQFJGAIAHZAALJHQAaDQJQFQBQKKCAEAGAIAAAHALaDQFIJQAJIQBZFAAA', 'GJEDTGDBMDqDsDIGbHQIEZGAIAEAFbHQBQCQDQAQGKIABaHAFLEQBQIQGaAACADAHAFAELBQFbHQCQDQAQGKIAFABAEbHQFLIQGaAADAFAHAELBQIQGQAbDADZFBCJGJAQDZFZCAFIHAEABKIQAQGZFQDKGAAAIABaEQHQCQFQAKIABAEbHQFQAQDQFIGKIABABI', 'GJlBbCQBgBkBECcDZFBICBFIIICIDDHYBYEYAYGYFSIIBCHIDTCYBYIYFCAIEIGIHIDICTBYDDHYEYAYGYFSIIDIBICDHYDTIYFCAIEIDIHICTBYIYFYADEIEBDJGRFRAYEBDBGIDQHICIBSIYAYFBDYESFIAIIIBCCYHYDYASDQIIBICDHYDYAYEYGYFSIIBIBQ', 'GJsDbGjBEDkDBGgGLHIIFYGQIQFQDbHABACAEAAAGKIQBaHQDLFABAIAGaAQCQEQHQDQFKBADbHACAEAAAGKIQDQBQFaHADLIAGaAQEQDQHQFKBAIAGAAbEQEZDRCJGJAAEZDZCQDIHQFQBKIAAAGZDAEKGQAQIQBaFAHACADAAKIQBQFaHADAAADIEAGKIQBQBI',
  'GKQBMCABLBkBdCBDJEDGZIARCRFBEIBRDIGYCAHICIACIYJYBYEYFRDIECBIJIASCYHYEYDYFCBIJIAICSHYEYDYHQGQIZFYBCIIJIESGIHICDHYEBAIHRCREYGYDYDQGJCBEYDYABHIERCRGZAAAIGICBDYHBEJDRDICTGYHYECJYBSFIAIEIIIGAHAHICCDYJYAS', 'GKQBdCRBCCMDAEbFTGgGoGDQEAHABAGAJKIQAQCQFQEbHABAGAJAJYBRIJAQCQFQEQHaGAGIDIEIFIHIADCYCBIZJZDRDIJICQAQHYGYBCDIGQHJAACAHYJYGRBYDCGIFICIAREYFAGYDSBIFIEIABCYERFZBYDCGIJICQAQHYBYBQHJAACAJYBRFJAIAQAICBEYAQ', 'GKjDpDLBACYCbDBEMERFrGAIFIHAFAAAJABKCQGIIQDIECIYCYCRAZAAFQFZHRGJABFBCBCIIIESDYIABaJQCQHQGQAJFAIABAJZHQGQAQFJIAIIDIDQECJYCQERIQFbAAAZGBHBCJBJDQBYFQAZIABACZHRBJBACACYHAJKCQEQIQAJFADACYIQAQFJDADYCDIYBY', 'GLADiGJBlBYDgDCEEESEUEoGCYKJFQEQIYJYDBBIEIKIFICSIYIACAEAFAKaBQDQJQGQHQALGAIACAEAFAKABaDQJQFKEQGQAZHAFAEKGQGYEYFYDBJIBIKICRGYFYFAEAGICBBYKYJYJABKDQKQCQGQIQAZEYFAHQFJEBIJAREZEQFbHADAIAJAAIBACAKKGQAQGYBY',
  'GLBBsDdBACFCKCYDTEgEiECGAQHACYERKIEAFAJABZCQCIBIJIFSHYKZEAEYCDBIJIFIGIIIDSAYHYKYFCJYCSBYEIFIHIAIKIDCGYIYJYCYESFICCJICQGIIIDSAYHYCYFYECJICRHIAIDCGYIYCYJYESFIHICBGIIIDSAYCYHYFYECBIJIGIIICSAIDCCYASGZIABZ', 'GLFBgDjBICDDKEUEkEAGZGoGBIFYEQIJDAIYJYGYAREIEAAAGAJKDRFQIYIQEbAAGAJACAHAKKBQDQFQJaGQEKAQIAJADAFABAKaCQHQGQEQIKJAEaGACAEIHAKKBQFQEQJQIaGAEJFABAKaCQHQEQGQIKJAFAEZCAHAKKBQEQFQJQIaAAGACAHAEKBAKaEQBKCRHYAR', 'GLMDgHSBTBACdCUDYDjDrDBHAAGADICIHIHABAJaIQCQIYDRGQGYFBDICIBIIIJIESHYGYCBKYAYFADADYFSAICIGIHIKIECBYJYIYDQGQCYFBDIIIIAJKBQEQGZCQCYFYDCIIJIBIERHYKYCBGIGABAJaIQIYDSFIGIHIEAJYIYDYDAFRIIJIEQHYGYARCJKJHBGZAZ', 'GLRBdCNBaBICjDqDgEAGDGKHAAFAGIDQFZGBDJHJERAYHYKYCYBBDIGRFJHAGZFRCRHIKIAIAREBGYFYKYCBDYDAFJGJAQAYGYFYBRHYDYCRKJHBGBAJERAYFYCQHYKYBBCIDIDQGJAAAIFYDYCYBRKIABGZCADAFJGRARAYDYDBAJGBFZAQCQGJDRDYGYKYBBCIAIAA',
  'GLVBQDFBiBjBECYCZCkECFaGBBGBHBDZEZIZARAYCTFIJIKIHIECDIGREYDCHAIYAYCYKZFSJIHIBIDIEIGCIYAYKYHSJYFCCIHIAIIIKIGSBYEYDYJYHCCYFSHIJIBIDIEIGCIYAYCYFYHSJIKYCDAIIIKICQGSEYDYCYJYHCFIAIIIKIDSEIGCDYIYAYKZFYHSJIAD', 'GLYCUEhBjBJCaCEDMDKEkEBGACCYERIYDCFIEICIASIYDYKYFCEIDSIIABCYDYEYFSIIDCCIARDYIYFCEICIAIDSIYCCEYFSCIIIDCAYEYFYCSIIDIKIACEYDSIYCCFIDIEIASIYDCFYCSDIIIACEYFYCYDSIIIQHaGQHIKJAIECFYASHYHAIAIYDCCIAIFIESIYDYBY', 'GLiBCDLCADUDcDEEIGjGrGQHAZIZJZFRERGRBJBQDLCAHAKAIAEaFAIYJJEQFaCRGQBQDQHKKAIAAAFAEAJaCQGQBQIKKQHaDAIABACAGAJKAQEQFQKQIaDQHKIAKAAAFAEAJaCQGQBQDQHQIKKADbBACADIGAJKEQFQDQKQIaHABACAGAFKEAJaCRFQGQBQHQIKKABb', 'GLiEAGNBhBYCLDTDkDJFDGbGEBDYAYHQKQCQGQFQJQBKEAIAAAHaDAKQGQGIAIDIESIYBYJYCBFIAAGZFRCRAIBIJIIIECDYDQEQGYIQBaJAAACAFAKAHKGQKZFQAQCQJQBKEADAGYHZFQIAKJDJGBHZHAFbKQKYCRAIDIDAGIHKERGQIQBaJAAADAHAGJHIDQIQBQBI',
  'GLjBCDKCEDQDYDAELGgGoGTHAJIJJJFRERGRBZBQDbCAHAKAIAEKFAIIJZEQFKCRGQBQDQHaKAIAAAFAEAJKCQGQBQIaKQHKDAIABACAGAJaAQEQFQKQIKDQHaIAKAAAFAEAJKCQGQBQDQHQIaKADLBACADYGAJaEQFQDQKQIKHABACAGAFaEAJKCRFQGQBQHQIaKABL', 'GLkBADIBTCYCdCUDCEEEREpGAAJQCIEBKYDQEQHQBJCACYBYHYDCJIKJEQEICTBYHYDYGYIYFCAIJIKIDSHICCBIEYDYJYAYKYFSGIIIHICIECDYCSHYCAGYIYFCAIJICIDIESHYCBJYAYFSGIIICIHIECDYJYCRGYIYFCAICIJIDIESBYHYGYIYCCAYFSCIACGJIQBJ', 'GLkBCCBBLBdCgDMEQEaEDGpGAACYKIFQHQBYDYGYJYECAIIIHICSBYDYGYJYEYACIIHICIKIFIBSDYCBHYIYASEIGICIDIBCHYCRGYEYACIICIHIBSDYDAGYCBIYASEICIGIJIDIBCFYHYIYAYKYESCIABIIHIBRDYGYAYCYECIIARGIDIBBHYAYIYESCIGIJIDIAABI', 'GMEBsDQBgBDCFCUCZCqDaEAGIGFRAIGBHAJIHICIDBIZIABbFQAQJQBIEQGQKKLAHAIIDRCYHYEYGYAYFBJIBIIIDICRHYDCBYIYJYFRAIGIEIDIHICCBYIYDSEYGYAYFBJIDIBIIICSHYEYGYDCJYFRAIDIGIEIHICCBYIYJYDSAYFBDIJIBIIICSHYEYGYAYFYDCJIAS',
  'GMVBIDCCTDkDQEDGLGaGhGoGrGBAFAIZJYEYEAJKIQCQFQBQGaHAAADAEAJAIKCQFQBQGQHaAADAEAJAIALAKKCQFQBQJaAQEQDQHKGAJABACAFAKaLQIQAQEQDQJKBACAFAIaAQEQDQJQHQGKBACAFADaCQEAIJDQFQBQGaHAJAAAEAIICQJYAAIALAKKCQDQFQEaJQBK', 'GKADkDCBaBjBICRDgEDGLIBQDQGQCQAICYFAGYDCEYGIJQIQAKCADAGAEAHABbJQGKCQDQAaEQIADICICQAQIZGBDJAJAQCACYECBIHIFSCYIYGYGQIKCAEAAaEQGQIZDAGIEIAICQIYEAEIIICAAYGZGAJAAIBKCQHQAQCIFCAYHYBZJYDTEIERGJGAJABADYERJIAI', 'GLBDrGMBACFCJCDDaDKEcEhEKYDQAYGYHQIQGQAKDAFAKABaJQBIEQAIGAIAHAHIKIDSFYGYAYEAHIIYCYCRIJGRAZIAGJKBCZHZHQGQGYIQAJJABJCQBYGYKAGAHAHYJYESAIIIGIKIFIDCCYCABZJQHJCJDRFRKZAZIAGJARKJDBFBCZHZHQAQAYGZEAJABKHQAQHYBY', 'GLCDqDKBVBkBlBEETEAFYGhGBZKYEYFYDRHIECFYFABKKQJQCQIQAZEAEYFCBAHYDBKKJQBaKAJKCRERFYGYDBHIEICBJaCQFQKQEQHQGQAKFACAIABAJAKaEQHQGQGICICABJFQIQAaCACIAJIABZGYDRCIGABKFQIQAZGABAEAGYCYDBBIHAKKJQFQGQAJIAFZEZGRAR',
  'GLCDqDLBQBgBhBAEREEFbGiGBJKIFIEIDRHYFCEIEABaKQJQCQIQAJFAFIECBAHIDBKaJQBKKAJaCRFREIGIDBHYFYCBJKCQEQKQFQHQGQAaEACAIABAJAKKFQHQGQGYCYCABZEQIQAKCACYAZIABJGIDRCYGABaEQIQAJGABAFAGICIDBBYHAKaJQEQGQAZIAEJFJGRAR', 'GLECaEBBNBACCCDCRCpDcErGESCYHBBYJYDRAIGIFIHICIECBYIYJYDYKYASGIDCJIBIERCYHYFYDYGYACJIDSFIHICIEBBYDYJYASGIFIHIDCBIERCYDYHYFYGYACJIBIEICSDYEBBYJYASGIFIHIEIDICCBYBAIAJYKZAYGSFIACJIKJIQBQBICSDYEYHYAYFYGCJIAR', 'GLEDrDDBVBACMCTCkDBEoGYHBIDAGQCQIQAaCAFAGAHABAJKKQEQAYIQCYGBBYHYDRFIGICICQIAHZGQAKEAIAHAKAJaBQKIERIYAYGADYFSGIAIIIEBKYCRHJIQAZHBCBKIERAYHYGYFCDIGRHIAIEBGAKYBACQJKKQEQIQAQAIHaAACAGABAIABZCRGRAIAQHKIABABI', 'GLKBrGFBLBbBBCkDUECGoGYHFYAYDYEBKIFRIZEAEIIIFBKYHYCREIGYHAGABAJKKQFQGZHQEYCBHIDIIYDAHYCREIDIIIFAGYHYHAGKDQIIAAKAJaBQGQGIKIFRAYHYDYCYIYCBGBKJHRDZGZCQEQIJDADIAIAQFBHYKYERCIGIDQIZCACYECGIDIAIKIARDZGZGAKABA',
  'GLLErGgBhBiBaDQEcEAGDGIGAIFAEAEIDIDABZHQAQKKGACABYDYEQFQGICBDYFYEBBIDQCQFQGQKaAAEAHABJFQGQGICICQKQIQJaAAEAKKCACYGYGAFABZHQKQAQEQJKIAGAKZHABJFQKQEQGQIQIICBDBJZAAHAKYBAFKKQKIDRBZCRHQAQIYEAJJIAGABAKAFaHQAQ', 'GLQBADSBdCIDoDqDCEbEEFgGCYHQBJEAAACAKAFAFIGZIQGIKJASCQCYEQBZHAKYKAFAFJGBIZFRGJGQKQHQBJEACACIACIYKIIAFaGQKQHQBQEJAACAIAFAGaKQFKIQAQCQEZBAHAFAKAGKIQFaHQBQEJAACAFAIAGaKQHQFJAQCQEZBAFAHAKAGKIQAQCQEQBZFAEJAA', 'GLQBVBDCMCRDkDqDsDaEgEAHBBDAFAHAGJIQFaHAHYBSDICIEIKIABFYFAHaBYIAGZDSCIBCDYCSEJFJHAJAGZIQFQEZCCDIEIFIHIIIJIASHYEYKYBYCYDCFIIIJIJQEQEYBRHIKIACEYEQARKYBBJAGJEQJYBSHIKIABJYBYFYJAEAGZBQIYDSCIHIJIARKYHBFBJJAJ', 'GLQBVBRCaCADCDIDbDEEKEjHARCQGQEQFZJAGKEQEIACCYDYHYKYBRGIGQEKAIJQFJCCDYASCIDCHZGZEQIQFJJAGAHJDSCYGYHYEYJYIYBCEIHIKIAIDICSGYJYIYIAHAHIABEYKYBSHIHABBKIARIQFZHAIIACEYKYBRIIAIGIIQHQFJAAJICCDYEYIYBBKIERGRIZBZ',
  'GLVBEDTBYCMDqDsDCEZEAFjGCIHQBZEAAACAKAGAFJGYIQFYKZASCICQEQBJHAKIKAGAGZFBIJGRFZFQKQHQBZEACACYACIIKYIAGKFQKQHQBQEZAACAIAGAFKKQGaIQAQCQEJBAHAGAKAFaIQGKHQBQEZAACAGAIAFKKQHQGZAQCQEJBAGAHAKAFaIQAQCQEQBJGAEZAA', 'GLgBlBhBICcDqDMEBFDGZGiGDAFIGYJYEYBCEIJIKICIAIDSHYGYIYBAEAJJAACAFZKQJQEQEYGICBJYBSGICIIIHIDCAYHQIZGABAJIFAKaJQBQGQIJHAEZCRGYBBCJEJHQIZBACAJAKKFQJZCQBQIJHAJIAIDSEYHYGYBYBQIYCCBIEIGIJIAIABEZJZBQBYCSGIAIAQ', 'GLgBlBkBNCYDqDIEDFAGaGhGDAFYGIJIEIACEYJYKYCYBYDSHIGIIIAAEAJZBACAFJKQJQEQEIGYCBJIASGYCYIYHYDCBIHQIJGAAAJYFAKKJQAQGQIZHAEJCRGIABCZEZHQIJAACAJAKaFQJJCQAQIZHAJYBYDSEIHIGIAIAQIICCAYEYGYJYBYBBEJJJAQAICSGYBYBQ', 'GLhBKGFBgBBCaCdCYDbFCGTGEYBYKZCQCYGCIIFIAIDIHIESBYJZKYFCIYGSCIFIBIJIKIECDYAYHYIYFSCYGCFIIIAIDIHIESBYKYCYGYFCIICSBIKIECDYAYCYIYFSGIBIJIKIEIDDAYABCZHRERDIABCBHYCQIYFYGSBIJIDIEBCIASEYDYBYJYGCFIIICIAIERDYAC',
  'GLpDDGcBACRCdCSDrDBEMEaEAYDRHYIYGAKAHAAKDQEQIQBaJABIFAAIHQKQGQGIIIDCEYHYAYFQGIKYCYCBKJHBAZKQHJIRCZGZGAHAHYJQBJCABYHYKAAJIQHQGQGYJYFCAIKIHIIIEIDSCYCQBZJAGJCJDBEBIZAZKQHJABIJDRERCZGZGAAAAYHZFQJQBKGAAAGYBY', 'GLqDCGICTCADZDkDsDgEMFJGBIEICAFAIAAZHZGQIICRJQKJEQBaCAKAEKFAIAAAAIHZGZJQEQFKIAAAHAHICRGYDQIYEZFQKQBKIAIICCAYEYDAGIHYHQAQCQEQIQBaKADAFAJAGJHJAQEQEIAAHZEQDQAIAAHAEZGZHIJQFQKQBKIAAAHAEAEICRGYDQAIIYIQBaKAAA', 'GMABSDVBYBlBRCUCbCBDJDoGDHDAGQBIFIDIASIYJYLYCBBIHAKIAQDYFYHYBYCRLIJIDAAAKYGYEYCRBICAEAGAKKAQDQFQJYHBFIAIABDRAYFYFAHSJIAADAHAKaCQEQBQGQLQILJAJIFBDIARFYJYJQDAIaLABACAEAGAKKAQAIFSIYJYFAHBAIAAKaEQGQBYCAEIGIAI', 'GMACVCYBjBBCCCLCUChDsDDGoGEQFQKZBBHBJBDJLJCQAQKYGAJYDAJQGQKIAACALZJQDYBSGQHIDCGIFIEIIICICBIZIALAJaFRGQDQDYGCBYHSGIDIDABAFBJKLQIQIJCRCYEYFYIYBYBADSGYHCDIIJFQGQJIKIEACILIASEYCCFYBYGYIYDYDBJBIJLJBRFQCQCIFCAI',
  'GMADgGkBCCICJCTCdCUDoDqDDECADQKIJILIAJFAGABIERFYAYDYGYIYLYHCCIIQLQAJDAGAIZCYHSAILIGIDIFIECGQBYIYDQAZLACAKAJJBQKaJAJYCRBILQAJDAGAIKKAKIESFYDYGYAYLYHCCICAJIKQBJDQGQAZLAIAJAKJDRGRARLZIBJBAJAQLQIZJALJDBGBKZAQ', 'GKJCrGIBYBbBdBhDAGoGDIAICIDBEIGYGAIABaEQBIFQIIJQHKAAGIDSCYAYGYHYJYFDEIEBBJIJDJGRCRAYCICCGBCQDZBZIZEREYFTJICIGIAQHZJAEAFABJGIAIDCIYIQGQGZCRCIAIGAIABaCQEQFQJQHKAAAYDAHYJYFDEIEBCJBJIJGRARAYJYEYCBBIGIIIGABa', 'GKMDrGSBcBiBTCUDCEAFYFAADIGAFICICQHQAZEABYDQGAFAFIHIEBCYHREJARGZAAEAFADABICQHAHYDYEQFRGJAAHACABYFQEIDBCJHRDZEZGRAJDAEAGZCBCIGIHIDSEYAYCAFABIDQERAYGAGYCYCQAJGAEADABYFQCIHBDJERDYHYCYCRARGJHAAZCBCIDIDBEJAR', 'GKSBFCDDQDYDoDgGrGAHbHCRFIIJDBEBAZCZCQIQDKEAEIABCYCAGAFAHaJQGKCQCIASEYERDaEAIACACYGZBQGIGAFAFJAJBACRGZFAJAHKCQAZHYJZBSFIGIIIDIEIACGYFYJYFRGKFAJACACKJQGaBAFAHIJQGQAQDYFZCBGJAQEYIYBBGIGQCQFJAJERDRIZFBCBAJ',
  'GKSBQCFBLCRCsDAEiEUFCGAABQEQGQJZDAHAFZIQDIAIGIJIBCEYFYHYIYCTDIAIGIJIBIECFYHYIYCYDSAICCIIFIHIESBYGYCYAYDCIICSGIBICAECHYCYIYDSAIGICBHIESBYCYGYAYDCIIHICRBIECCYFYHYIYDSAIGIJIBIEICCHYBSGYAYJYDCIIBIHICSEYGYAY', 'GKTBYCEDUDcDpDAGLGIHjHCYFBJZERDRAJFJFAJAEaDQDYARFIFQHQCQGKIAHaFAFYACDIDBEKDQJQFQFIHJBAHYHQCQCZAZBQFBHJCQIQGaFAAJGIIJBCCYHYJYDYEYASHICIIICBHaCQIQFQFaIAHKBQCQGYIAHAAACJEIFRHZAADIJIBRHYHAFACZAZDBEBJJCRFRAZ', 'GLABFBLDSDUDcDBEQEgGoGjHCADQEZBQEIBAEADAFAKAJKIQHQHIASGYGQCaEADADIGIABFYHYKYBSDIEIFIGIGAFaDQDYBBKIHIARFYFADaGQCJGIDIFIACCYDYHYKYBRGIFIFQCQEaGAGYBCFJDJHAKIIAJaKQDQFQGQEJCAGYFADJGQCQCJAJHBGZDZAQEYFQCQBYCIAI', 'GLEBhBFBJBACYCZDCEiGqGTHDAGAIIJIBIFIESGYKYCRAIHIDIGBEBFBBZFRIYJYCRKIDRGIDADYGYHYAYKYCDIIJIKIFIBIERDYBCFYIYJYKYCTAIHIGIKIBIDIECFYDSBYKYCBIIJIDIFIESBYFBDYGYIYJYCRKIFIBIEBDYBSFYHYAYKYCDIIJIBIKIBBDJERFRGRHZAZ',
  'GLEDsDCBDBMBTBYCZCcEiEAFCRDYAYEIFAAIFICIDIKIGCHYJYJABaIQIYESFICICAIABJDQJQKQAaCADAFAIAIIDSCYCQAJKAJABZDQDICSIYEBIACADABKCQEQJQKQAZIADADYEYFSIIIQAKDBCBJIKAHIGSKYCYDYIYFBEIIQDICBIYEYEBBBJJIRCRBYDYEYEABAFQAQ', 'GLFBgDEBRBACCDSDUEkEaFJGBQDQERFZGYKYCYCQFKKAGAGYCYFQKJGACYJABJDQCQGQGIEBDYDABZCQJQGQGIEIDCCYDQERFZKZAZHBGJAQGQHQKKFAAYEAFYAAJABJCQCIDSEYCCDIDABZJQAQFIEADYCRAYJBBJCQAQDQJQFQFIABCBDIESAYCBDBEABZJQFQCIDBEIAS', 'GLKBUCIBBCVCCDEDYDgEaFLGBQEQKQGQFJAAFYGYKYECBIJIHIIICSDYAYFYGYKYEYBCJIHIIICIDSAYAQFZGAKACBHAIYJYBSEIHICIKIAIAQFQGZKAFKCADBIYJYBYESFIHICIKIGIGQKaCAHZFQCJGJGAHAFZCQCYECBIJIIIDRHZFAAIHQFZAAAIFIHIDBIYJYCSAIAQ', 'GLYCUDhBjBJCaCEDMDKEcFAGABCYERIYDDFIDQEICIARIYDYFCEIDSIIABCYDYEYFSIIDCCIARDYIYFCEICIAIDSIYCCEYFSCIIIDCAYEYFYCSIIDIKIACEYDSIYCCFIDIEIASIYDCFYCSDIIIACEYFYCYDSIIIQHaGQHIKJAIECFYASHYHAIAIYDCCIAIFIESHYIYDYDABZ',
  'GLaBMCgBNCZCQDqDsDAECFjGBADAKAHAGJAQGYHYKYDSBIJIFIIICDEYAYGYHYKYDYBSJIFIIICIECAYAAGZHQKQCRFQIYJYBCDIFICIKIAIAAGAHZKQGKCQERIYJYBYDCFIGICIKIHIHAKaCQFZGACJHJHQFQGZCACYDSBIJIIIEBFZGQAIFAGZAQAIFIGIERIYJYCCAIAA', 'GLaDAGEBDCFCICgDsDJEcEiEAYCQDQBJFAAYGQAQFQBZDAKAGJAQKYDRBJDAFAKYGAAJKQFQBZDAGAAAGYDQHZJQEQBKFAIAGAKAHZAQKIFRIYBYEAJAAJDRGIGADAAZJQCQEQBIGIIIIQBaGADAGIBIFBKYAAHJKQFQBYDAAAAYDRGYGQBKFAIAAAKAHZDQDYCYCRGRAJAA', 'GLgBlBUDaDcDjDQEhEAGIGDHCZEABADIBQFQDQCQEQKQIKJAGAGIACHYHAFaDQCQCIHIAREYGYKYBCCIDIEIHIHQEaCACYBRKIGIABEYEQCaHAFJHICIEIASCYFYGYKYBBHIEIEAFADaHQHYBSEJCJGQKIJQIaKACAEAHADJFQHYEQCJHADAFJAJGRHZCZAAEADADIAIFYBY', 'GLlBiDIBgBkBZCaDJEUEAGDHBQDAGQIYABEIBIGIFIDICSHYCAFBBaGQGYEYARFQIIFIDIDBCJHRDZCBCYFYFAGAIYABEIBKGIHQHIDSCYFYIYAYEBBIGIHIDICSFYDCHYBYGYERAIIIDIFICCHYDSIYAYEBBIGIDIHICSFYIYDBBYGYERAIDIIIFICCHYBYGYDRAYEBDIAR',
  'GMABcBSBbBhBdCKDEEQEBGTGqGCQEYGYKYFALICQCYLYFQKIIIEBCYIQKZFAKILIIQEICBIYLYFQKIEICIAREQJYHYKYFCBIDIEILIIIARCYCAAAIAKYDALaBQBYFSHIJICAKYEBBYDREQEIKIBACQJYHYFCDIDALKAQCQEQIQKICIACIYBYEYDYLYFSHIGIJIAACYKIBABYBA', 'GMIBcDNBYCRDTDsDZFAGDGJGjGBYCQKJEAHAGaLQBQCQFQKQJQIKAADAEAHAGALaBQBIGJHQEQLIDQAQIaJAKACAFAGABABYLJCQFIHQEQKZFACABIEJHALZBQCQGQEQFQFYKJCAHAGZBALJGQBaCQEQFQKQJQIKHAFZEABJFQHQIaJAKAEABAEIFJHQKZEABACAFALAGKHQBZ', 'GMNBYCCBEBZBDCUCdCpDrDIEaEAAHAJIKABAIYLQCRKIBBEYCYLAIJEQEIBSKYFYDYGBLIFRDYGYAYHBLIGRDIKIBCEYEAIZJZLQARDIKICBFYGYAYAQDRKIGBAYDYLAJJAQAIIIGRCIFBEIBSFYECGYDYABIIGQIAJZLQAIDICREIGCBIFSGYEYBACBDYAYLAJJIQIYARDIBI', 'GMQDrGFBKBVCYDjDpDDFAGaGgGAAFAHYBYEQCQKZIQJKAADAFAKALAHABZGQHKLQKQDQFQAQJaCAEAIAHAGABKLQGaHQKJGAHaKQDQIQJJAAFAGAHAKZIQFKAQJZFAAKDAGAHAKALABaEQCQIQAQFQJKDAGAHAAaDQIAJYCAEABKLQKQAQDQHQFaDAIAKJAQHQFQGQJZIAKAAK',
  'GNYBSEIBJBMBNCKDhDoDAGDGjGqGDQEQGIMIIIAQCQJQKaGAEAGIJIKICBABHYIYLYMYFREIBIDIAICRJYKYGYGQKKJAGaBADALAHKIAMZHQLQBQDQGKJQKaEAFAGAJJAACAIALZHAMKLQIQIICRAYDYDAIAHZBQJQGQGYEYFBBIHIIIDRAICBDYHYIYBYFREIGIGAJABAHJIQBY', 'GKACdCNBbBgBrDJEhEDFYGCABADIFIGAHIEIJIASGYIYCYBBDICSIIGIACEYHYFYJYCYDYBSIICCJIEAJAHAFaDQHIHQJQJIEIARGYCYIYBCJICRGIABEYCYCQJYBSIIGIAIECCYARGYIYBCDIHIFICQERGYJIAIABFBCJERCYFYHYDYJYBSFAIIAIFIGIEDCYHYDYJZAQBY', 'GKBDrGdBFCaCYDjDTEgEIHAJHAJAEAFAIABaGQCZDSAICIHIEIEBCZGBBJGQEQIQFQJQAbEAHADABICQFKCAIABaDQGQFQEQHQALJACAIAFaGABJEAFQGaCQCJGJFAGAFJIRGZFAGAFZERAYEYHYDCBICIEQHRARJJGBAaAAFAFKAREABYGRJZFBHBCZDSCIFIHIEIEBAJAQ', 'GKLGYGiBACRDgDBEjEDGTHFQHICIBQDQEQGQIaAAJACAHAFLBQDQEQGQIQAaJACAHAFABKEQFaCQHQJQAKIAGAFAEABaCQHQFKCAGQIQAaJAFAHABKEQGQFaJQAKIAFAGAEABaCQHQJQAQIKFAAaJACAHABKDQEQGQAQFQIaJAAKDBEYGAEABaCQHQAQJQIKDAFAGAEAAYBA',
  'GKQCcEFCTDoDAEREKGhGqGHADAGIJIEIAQFQHZDAGAGIFIABEYFQIYBYJYCSDIGIHIHQDbGABAIJAQHYGYCCIIJIEIEAJaIQBQBIGQDKHAAAFAEAJAJIARFYGYIZBQEKGQDQHJFAGYEYCQEAHIFIACIYJYBYBAIKJQGQEZBAIAJKASFYGQEQFQHaCADABABYEKBQDQHJFABY', 'GKUCoGNBYBZBdBaDDGrGAIAAGQAYCYFBGJGAIABKDQEQBYIYJQHaAAGYFSCIAIGIHIJIDDEYEBBZIZFZGRCRAICYCCGBCQFJBJIJEREIDTJYCYGYAQHJJADAEABZGYAYFCIIIQGQGJCRCYAYGAIABKCQDQEQJQHaAAAIFAHIJIDDEYEBCZBZIZGRARAIJIEICBBYGYIYGABK', 'GLEBACTBYBlBREUEjEBGJGoGAIFQIIJIBIDCFYCYGYARJICAFIDSBYCYCAFAJYABGIFIDIBRCYDCFYFQDQGYARJIDICICQIZBAJAAAEAGAHAKKFQFYDSGYAYDAEBHIDIFIBRCYGYDBHYERAIDIGICIBBFYHYDRAYEBDIHIFIBRCYGYAYEYDBHIARGICIBBFYAYHYDREIGICIBI', 'GLEBhGABFBDCQCcCUDBFZGpGFQGIBIJIKIFICTIYEYAYDYHYGCBIJIKIESIICDFYEYBYJYKYGSDIAIHIIICIFCEYCTIYAYCADYHYGCBIJICIEIFSIYCCBYJYGSDIAICIIIFCEYBYJYKYGYDTAIARCJHBGBDYARCRHICAIIFIECBYKYDYGRCYACGIDIBIKIESFYIYCYAYGBDIAS',
  'GLIDgGNBdCoDTEjEAGKGQGYGCAHJAAIZFAGAEKBQDAKQJQIQAQHZFAGAEABKKQEaGQFQHJAAIAJAEAKABaGQEKJQIQAQHZFAEAGABKKQJQIQEaFQHJAAEAIAJAKABaGQFQEKAQHZEAFAGABKKQJQIQAQHQEaFAAKIAJAKABaGQAQFQEKHAIAJAAaGABKKQAQJQIQHQEaFAGAAK', 'GLIDoGQCRCdCEDSDrDCEMEaEAACADAKIBAHaKQGQIQAJDAGYKAHKBQGQDQAZGYIAKYKAHABJGQHaKQIQAJDAKIHIHAGAGICRBYDYAYFYIYJYECKIKQHKIQAQFZHYJAHAKABJGQIQHZJQFJAAHAIAGABZKQJQHJAQFZHAJAKABJGQIQAQFQHZJAAJIAGABZKQAQJQHJFAIAGABA', 'GLMDjGIBYCsDREhEDGJGTGbGCAHZAAIJFAGAEaBQDAKQJQIQAQHJFAGAEABaKQEKGQFQHZAAIAJAEAKABKGQEaJQIQAQHJFAEAGABaKQJQIQEKFQHZAAEAIAJAKABKGQFQEaAQHJEAFAGABaKQJQIQAQHQEKFAAaIAJAKABKGQAQFQEaHAIAJAAKGABaKQAQJQIQHQEKFAGAAa', 'GLYBVCjBACLCUCsDBEREDGoGIQHQJZBBFBGBCJKJAQDQJYEAGYCAGQEQJIDAAAKZGQCYBSEQFICCEIIIAIDRJYCYCQEBJIDBAYIYCRCIIIAIDRJYEYFYBCCIGIIIAIKIDQHYABIZERFRJJEAFAHADAKYGYCQGAKJDQHQJZEAFAGAKYCYBSFIEIAIHIJIDCIYGYKYCYBYFSEIAI',
  'GLdBICiBFCJCKCgDDETEAGrGIQHQJJBAEAGACZKZAQDQJIFAGICAGQFQJYDAAAKJGQCIBSEYCCFQFYIYAYDRJICICQFBJYDBAIIICRCYIYAYDRJIFIEIBCCYGYIYAYKYDQHIABIJERFRJZEAFAHADAKIGICQGAKZDQHQJJEAFAGAKICIBSEYFYAYHYJYDCIIGIKICIBIESFYAY', 'GLgEJGABSBdCbDrDMEQEDGiGJZHAFAFIDIIICRBYJYDBFYFQDQHQJKBACAIAAAGaKQAICRFQIYDYHYHQJQBKDAEAIAAACAGAKZFQGKAQCQDQIQBaJAHAGAFAKKAQGZHQJQBKDAIAGAAAKaFQHQGJDQIQBaJAGAHAFAKKAQCQDQIQBQJaGABKDAIAAACAKaEQFQHQBQGQJKDABY', 'GLrDDGUBlBNCBDLDSEYFIGiGFYBYEADAIAAaKQCQHQGQGYCBDYESCICAGJHAJJIAAAAJIRFRBZJZCZGBDBEBAJHQFJIAKZAQAYDRERGRCJBJJJIBHZFRGZDAFAAAAYKJDQGJFAAAHQAZFRAJGZDAFIHAKZFQDQGJAAHJIRBZJZCZGBDBEBFIFAKKIQAZHAFZDRKYERGRCJJJAA', 'GMADcEEBFBIDQDUDaDpDYECFrGHQIYKQAJEAFAJAIALaBQGQCQDQAJKAGZBALKIQHZGQKQAZCADABAGJHJIALaGQHJKQAQEJFAAZKAIJJQAQFQEZKAIAHZGALKJQIZKQEJFAAAIAJALaGQBQCQDQEJFJAAIAJAHZKQIJAQFZIAKAHJJQAQFQIZEZCADABAGALKJQAQFQIQEZKAAJ',
  'GMDGoGCBUBYBADSDIEkELGZGhGBIDIEQGICQKIHQFQAaJADAKICQFKCAHAKaDQGQFQJQAKCAHAFaGAFIKJEBBYLYIYDRKIFQGZKADAIABKLQEQFQGQCQHQAaJAKADAIABALKEQFQGQCQHQAQJaKAAKCAHAEAGAFALaBQDQIQAQKQJKCAHAAaDAIABALKEQFQGQAQCQHQJaKAIAAJ', 'GMYBdCLBMBcBhBFCDDBEiEQGZGAQEQIYHYDALYCQCIKILIABFYJYEYCRDRHIIIABKYLYDYCCBYGSCIBBEIDRBYCYHIGBEICSBIIIAIKILIFDJYKYLYDBCZEZBRGRHRIJDBDYEDCIJIKILIFTAYDYEYKYLYCDJIFIKILIATDYDREZCZIZHBBBGBJJFJAJDRDIETCYIYKYLYFDAIAB', 'GMdBYCJBKBZBkBACBDDEiETGaGAQEQIIHICALIDQDYKYLYABFIJIEIDRCRHYIYABKILICIDCBIGSDYBBEYCRBIDIHYGBEYDSBYIYAYKYLYFDJIKILICBDJEJBRGRHRIZCBCIEDDYJYKYLYFTAICIEIKILIDDJYFYKYLYATCICREJDJIJHBBBGBJZFZAZCRCYETDIIIKILIFDAYAB', 'GMoGDHQBlBIDUDcDgDAGRGZGiGAJEICAHQKYGYLZGQKKLAHAAZGQHKLQKaDAHAGAAKLQKQCQHZGAKJCQJYFYDAKIHQGZFQJJCBHYKYDQJIGAHAKZFQHKKALAAaDQFQHQJQBQIKCAEAGAKAJaDAHAFAAKLQJQKQCQGQEQIaBADAHAFAAALKJQAaDQFQHQBQIKCAEAGAKAAAFaHQAJ',
  'GNkBAEKBQBUBFCdCgDiDoDqDDEZGCAMAIAHJDQHYIYMYEYEQMJAAKIJIDQIYIAHAHYJAKZAQEQMQIKHADAIYKYMYABEIJIJQMQIQIYAYEBJIKIDQIYCRLYEBAICIHIIIDBKYJYARERLIBIDBIYMYCQHIIAMAKAJZCQCYAYERMJIQHZMAAACAEAJKKQIQHQMZAAEAJAKKCQIQHQMQBQ', 'GKYBcCFBjBACUDhDoGCHRHBIDIDAGIHJAQAIESIZCZEAFBDBDIGIJIABHZAQGQJQCQCIIIEBAYJYCRDYBBGIHIJAHAGbBRDICBHIHQJQJIAIAAERIYCYDYFYBCHIGIJIGAHaJQCQCYJAHKEQGQAQCQIQIIECAYCYFZDAJYBRDIIICBAIESCYABFYIAJYBYDSIIAICIFIECJYBY', 'GLABUCQCVCZCBDRDEEaEJGrGCQAQGIEAKZBQDQHQFKJAGAGYHYJYFYDCBIIIEIKICICAKZARGYIQHQFQJJGAABFZHAIAKJCQCYEYIYKYBYDSHIFIFQJIGIGQGIJaHABAJIKIEQAICCEYKYARBQFYGYHQHYDCBIIIAIKIEICSGYJYHAFJABEAIYKYBYDSFIHIAIAAFZBAKIEQFZAQ', 'GLDDkDgBFCICqDsDRELFAGhGDQAIHAJIEACAFZGZBQKJCJFBGZGABbCQFIKQDQIQAQJJHAFACAGABAKaIQFJHQJZAAFAIAKKBQCQGQHQFZAQAYJJFAHACAGABAKaIQAQJQFKHAAZIAKKBQCQGQAQAYHQCAFaJADAIAKABLGQGJARCZKZBAGJAJCQEQHQFQJaDAIABAGAAJKQGaAA',
  'GLFBQDABYBKCVCBDDDhEjELFDQBQCQCIFQAQGYEABIDCBYHIIYESGJCADABABIDRCYBADICRBYBAEBIICRDYEYKYAYFBJIIICIDREYCCIYJYFRAIKICIEIDCIYCSKYAYFBJICIIIDSEYKYCCJYFRAICIKIEIDCIYJYFYASCICQFBJIIIDSEYKYFYCYHQABJIFRHYABCIGIHQGQBK', 'GLFCIGDBRBaBMCTCYCkEAGpGFAIAKJEQEYGYCSBICAJIHCEYEAKaDQIQIYASFIBIJIHIECDYHRBYJYFYFQJJABIIKIDQERBYBAEADAGAKYCRGIHIDIERBQDAJaAAFAGACAKIEQDYHYCYCAIAIYASFIGIBIDAEAKYIQCIHIEIDRBYCBDAIAKJEQEYHYIYKYAYFSGICIAABIKIHQBQ', 'GLIBVBRDYDDFAGaGgGjGoGrGBBCAGIBQDIDAGaEQFKAACADAGAHAIaEQDJCQFZBAEIGIHIIIASFYDACJGYGAAAHAIAJAJIKaAQEQBQHYCQDQFKGADaCADIHJABIYJYEYBSHIBADQCZFQGKAACADAHaEAKKJQIQHQAQCYDQFZGYBCEIDIFIHIIIARCRFZGZBZEBHJIJAJCRDZAABQ', 'GLICKHBBRBgBNCbDpDkEDGhGAAEAGYJYFAIAHKKQGQGYIYKYHYFSBIDIJICIAIAQECGYDQCQERJaBAFAIAHAKKGQGIERAYCYDBGBHZIQKZFQBQJKAACAEAKYIQGJDQCIAIAQECHYDQCQERJaBAFAGAIAKKHQHIERAYCYCRGZGACADAHAKZFQBQJKAAEAGACADAHAKYIQHJCRDRBZ',
  'GLIDpDFBVCYCADCDTERFKGrGEABYHQKYDQCQGJFJAAJZCZGRFJFQALCAGYJAEAIABAKZHQGQCQFQAQJKIAGZHAKJBQGQIQJaAACAFAHAGJBABIKZGQHQCQFQAQJKIABAKAGaHQBJIQJaAACAFABABIHACQGKKQEQIQJQAbFAFZBBCJJJAQFZBZCADAHAGAKKEQIQAQFQBZJAFKAA', 'GLJBFCSBiBACTDYDgEbGjGCHAAJQIQFQFICIGIGADAHAJaIQFQCIDIDAHIERAYFYBRKYCBCIDIDBGJHAFZGRDRHIKIAIAREBKYCYBBGIFIAQAYFYGYBRHYDYCRKJHBFBAJERAYGYCQHYKYBBCIDIDQFJAAAIGYDYCYBRKIABFZCADAGJFRDZARAIDIHIEBFYFAJAIaGQGIARCYBY', 'GLJDoDDBZBICTCaCRDcEEFAGFQCQIQJQKKAAAYHAGABIERHYHQAQKaCAFAJAIABKDQFQCQGQCYFCGICSAIHIEBDYCYGYFSAIHICCDIERCYAYHYFCGIDIEICSAYHYDCGYFSDIAIHICCEYGYFYBYDRAIHICIKIECGYFYBYIQJQKJCAFABYDQHQAQCIFBHYHQAQCQCIFIEIGCHYHABA', 'GLJFpGLBdBACUCgDiDsDEEBGBYCQEQIYKYJYDCFICICQFQDQJQKKAAEAGAHABABIIaCQHIGIIJESAYJYDYKYFCCICAIJBQGQHZCZDRFRJIKIAIECBYGYIYFQJICBHIGABABIIaDQHIGIIJESAYCYJYKYFCDIDAIJBQGQGJCRCYGYHYDYFRKIAIECBYCYGYHYDYIYFQJIDBGJHJAR',
  'GLLEpGJBNBACCCYCdCDGZGiGBIJIGIESCYFYAYDYIYHCBIJIKIGIFSCIECFYGYBYJYKYHSDIAICIGCBYIIJYKYHYDSAICIGIEIFCJYKYCRAYDCHICIJICQKIFSEYGYAYDYHBCIDSAIDAGIEIFCJYKYDYCYCABJKQJQEQFQGQIaAACADABAKKJQBaCQDQAQIKEAFAGABAJAKaDQBI', 'GLMDrDABQCdCCDEDRETFJGoGEABIHQKIDQCQFZGZAAJJCJFRGZGQAbCAFIJAEAIABAKJHQFQCQGQAQJaIAFJHAKZBQFQIQJKAACAGAHAFZBABYKJFQHQCQGQAQJaIABAKAFKHQBZIQJKAACAGABABYHACQFaKQEQIQJQALGAGJBBCZJZAQGJBJCADAHAFAKaEQIQAQGQBJJAGaAA', 'GLNCJHEBUBlBICZDqDgEAGiGAAEAGIJIFAIAHZKQGQGIIIKIHIFSBYDYJYCYAYAQECGIDQCQERJKBAFAIAHAKaGQGYERAICIDBGBHJIQKJFQBQJaAACAEAKIIQGZDQCYAYAQECHIDQCQERJKBAFAGAIAKaHQHYERAICICRGJGACADAHAKJFQBQJaAAEAGACADAHAKIIQHZCRDRBJ', 'GLRFBGVBbBMCYCEDIDKDkEpGBYDAFAGYKYJYCREIDIDAEACAJAKKAQFQHQIQBQBIGaDAGJIIHIFCAYJYCYKYESDIDQGJBAHAIZDZCBEBJIKIAIFSBYGYEAHYJIDRIIHQBQBIGaCAGJIIHIFCAYDYJYKYESCICQGJBAHAHJDBDYHYIYCYEBKIAIFSBYDYGYEAHYIYCYJICRHJIJAB',
  'GLUBYCbBhBkBDCVCqDEEJFAGBBDYGQHYCQFQKIBADAHYCYEYARIQKJJACACYEYEAFRHIIYGBAIFIEICIDIBSJYCCEYCQFYAYGRIICIJIBCDYEYHYFYCSIYGBAICIFIEIDIHIBSJYIYCCAYGRCIIIJIBCDYEYHYFYAYGYCSIIACFIEIDIHIBSJYAYIYCCGIFIEIARJIBCDYAYDQBQ', 'GLdBhBIBYBFCJCADKECGrGaHHIJYAQEQIIGICADABYFRGRCJDBDIBDFYGYCQJYKYAYERHICIDIBIGIFCKYCRHYEBAICIKIFSBYDYGYHYCBAYAAERCIHIDIBIGIFCKYAYEYCSHIABKIFSBYDYGYAYAAHYCCEIGIJIKIFIBTDYDRAZGBFBBIDRARGYHYCYIYECJIKIBIDIARFYDCAI', 'GLhEJGUBVBQCADCDEESEjGrGEAAYIYCYJYKYDRHRGJGQFLBABYCBHYDBIAJIKIAIAAKaEQJQDQHQCQGQFQBKIAIYCYCAFYGaDBHAJAKKAQEQGYCRBYDAHICIAAGIEAKaJQCQHQDQBIIIEBAYCYHYDRFIGKIQBZFAGADAHAJAKKAQCQIQBQFaGABJIAAACAKaJQDQHQBQGQFKIABZ', 'GMBCbENBECaCdCSDYDgDoDrDCEAYCAGYLYDYCYFCBIKIEIHIIIJIASGYLYDYECBYFRCIEIDIGILIACHYIYBYJYKZESCYFBEIBIHIIIKIJIASGYLYDYCYFYECBICSDIGIKIJILIACHYIYIQHQGQGYCYCAHJGQCYHAGJCQCYGYHYHAGAJAJYBYKZESFIDIHILIAICCGYJYBYDSHILIAI',
  'GMECoDYBlBCCDCRCaDcDAEiGqGAIFIEIJICCGYHYHAIaDAKYDYASFIEIJICIGBKYDYDAERKIGRCYJYDBDIHIIIJICICRJZDZEBIIKICQHYEYFYACKILIBIGQHYDSHIJIGCBYCYDYKYLYASFIEIHIJIDCCICAKZIQHQHICIDRJYEYFYACIIKIGRJYCBHYIAKJLIBIBALaKQBKHQIZAQ', 'GLABFCJBECYCZCBDaDqDKEcFEAGICAFAIZHRJRGRCJAJEBFBIBHZJQIJERFRAZCZGBIBJBHJEQAQFQCQGZIAJQCJAJEBFBHZJQAQCQIQGJEAFAHBJZARCRHJEQFQGZIAHBABCYKYBSDIHIHQIIIQGKABCBFAJIERFYAYARGZIZHBKBJJARAIEIFSGYIYIQGQHaCBABJYKABYDSKIAI', 'GLADoGNBQBdBIDbDjDRFrGCHCADQEAGAHAJABKIQFQFIDBIYBYHYJYERCRKIAIDAFAIABZGYCYEBJIJQCQEQHQGQKQAKFAAYKYECCICAHJGQKQAQAZFJAAKAGAHZCQCYESKIAQFZKACAEAGAHAJAJYERBJCIGIIQAQDQFYKYCBGIAIHJAQGaHAHYCRKIFIDAGAIABZHYCYEBJIJQAQ', 'GLBCqDMBNBACcCdCoDCFYGgGCADAFAGABJHJJIKIESAYIYCYFBJIKIEIASIYCYFYDYGBJIKICSIIACEYCYJYKYGRDIFIIIAIECCYHZBZJYKYFSDYGBFIDTIIAIDAEICCJYKYDYFYGSIIDCJIKICSEYAYDYIYGCFIBIHIJIKICIESAYDYCAIYGYFCJIKIHABZKQHKCQCIDSAIECDYAR',
  'GLDBdBICADZDbDgDJEjEEFoGAQBQDJCAEYFYGIJQDJAAHAFAEJCRFYAQEYHYDZJABAIAKKCQGQEQFQHQHICCEYFYGYIYKYBQJQDJAAHAIAEKGAKZEQGKFQFICRHYIYARDZAAJABAEIGAFJIQKICQHQHICCIYGYKYEYBQJQDJAAHAGAGYARIICRHYDZAAJAFAFIARGIGAAAEAIAEZBZ', 'GLFBQBEBJCgDiDSEUFAGoGrGGAFAEJDQIIBBDYEYFYGYHYASCIAAHAKAJKDQBQIYHAFJEAJZKZARAYCTHICAGIBIIIDCEYFYAAJJKYKQEQDQEJBRGYIYHYCCAIAAEJFQHQIJDABYFYFAEaJAKKEQJZAQCQIIGAFAJIBIDSFYGYIYCAAAJIBIBBEBJZKZARAYCTHIBIFIIIGIDCJYBR', 'GLICbEMBgBBCCCDCVCpDZErGAACADAHBBIJIDIASEYDCJYBYHRCIGIFIDIEIACJYDSFYGYCYHBBIDIIYFSGYDCBYHRCIDIGIFCBYDSCYHBDIBIFSGYCYHYDCBICSGIFCCYBYDSHIGIFICCIIJIASEYCYFYGYHYDCBIJICSEIACCYIYJYBYDSHIGIFIEIAICCJYBYDYKYHSGIFIEIAI', 'GLJBECIBbBcBdBFCYCKEZFrGAACAHAIADAJAKaEQEYFYGSBIFCDIEIJIASCIHBAYCSIYCAFYDBEBKJAQAIHSIYFYDYEBJIFSIIFAHCAYCRFYJYESDIIIFBCBKYCQEQDRIIFIHIADCYCQARHRFZIZDBDYEDJIHIAIKICIFTAYABCBCYHYJYKYETDIDRIJAJCBCIFDHYJYDYKYDRIRAJ',
  'GLQBLGABBCCCjDrDDGgGoGTHDQEQFIGIIIJIARCRHaBAKAFAIJDQEQHQBaKAFAIAGAJJDQEQFaKQBKHAFADAEAJZGQIQKQBQHKCBABFADAEAIaGAJJIQGbKQBQGIHQFKDAEAGAIAJaKQGKDQEQFaHABAGAKAJKIQAQCQDQEQFQHaBAGAFIKAJAIKDQCIABDYCSEQFYFQGaBQHKGABZ', 'GLcBICJBKBdBgBFCZCaEDFAGAQEQGQIQDQJQKKCACIHCFIBRHYCYDYJYACEYGRAIECIIEQFIDRCRKZAAAYGCIIFIDICRJYFCIYFQGSAIEBFIJICCDYIYFRERKICADBEAIYFYGYATEIEAABGBFJIJDRDICTJYGYAYKYEYFDAIAREREIGIJIKICDDYDBIZAZEREYFTGIJIDIKIDBIBAZ', 'GLcDpDBBFBKBaBACLEYECGjHAYBYCQDRJIEAFAKYDRAIHIFIERFAAYJZEAHADBKIBIIIGSCYEYFYJYHYHQJKCAEAFAGABYIAKYDRAIHIIIESCIGBEYCSFYFQIAAZJZHADBAIKIBICIEQFRGQIYJYHYHQJKGAEABYIACAKYDRAIHICICAAZIQJZHADBAIKIFIFQAZCQCIAIEIIIEBBB', 'GLhDCGFCADLDTDpDREIGrGbHAYGYHYFYJYKYCSEIEQIKDQBZIAEACAFAKAJAGLAQAJHRDRFZFQEbCAKAJAAAAJGZAQCQJQKQELFAFJDBHBGZAZCQAICAJZAAGLJQHQAYDQFZEZCAGAJKHQDQFQEZKADKHADYJaGQAJDQKQEKFAHADZAZGAJKDQAZGZJYCREIFJHAAAGZKQEQFJHJAB',
  'GLkDAGIDKDQDoDYEaEMFDGqGEJGAFAKZAQIQDJEAHAFJGQCQEZDZIAAAKKGQCQEQDZHACJGAKaAQFJCQHQDJEAGACZFZAAKKCQFZAZIQDJEJGAFACAKaIQDQEJHAFJCAAZFQHQEZDAIAKKAQCQGQEZDZIAFJCJAAKaFQCJAJGQEQDZHAAACZFAKKGQAZHQDJEAAAGAKaFQIQDJEJAA', 'GMAGqGLBMBYBlBcDoDDGZGiGIHDICILIEBJYGYKZGQJKKAHABZGQHKKQJaFAHAGABKKQGaHQGIJJERLYCYDYFBJIGAHZJQCQDQFQIQAKLAEAGAHAJaBAKKJQEQHQGQLQAaIACADAFABAKAJKEQHQGQBaCQDQFQIQAKLABAEAGAHAJaKQCQDQFQBKLQAaIABACADAFAKAJKEQHQGQLQAQ', 'GMBDQDVBjBaCJDbDkDsDgESGDHAYFYJALYCBGIDAKIEAIbDQEQGYHQKYCSKILIECDYHYCQDAGIHAIKDQJQBQBJJBDZHZHQBQBIHAEQGYIZBQGQKQLQALEAFAJAHAGZBAIJGQHQEQJQFQAbEALAKABABYCACYHICICQBJHAGAGJDJJRHZHABbCAGAIIDIESKYLYCCGIGQKIKQHLFQFJAR', 'GMCDjGVBADIDQDsDEEKEYEaGoGBYCQGYHQAJIAFJJABZGALKBQGaKQFQIQDJEAJAFZKAGKFQJQEQDZAZHACAGIFJJQEQDQAZIAEKJAFZGZCQEIIQAJDAJAFAGZKQFKJQDQAZFYIAFAKAGKJQFZIQAJDAFAJAGaKQIQAQDJFAAZIAKAGKJQAQFQDZIAAJJAGaKQAQIQDJFAJAAZKAGKAQ',
  'GMECJCIBaBbBNCYCADCDKEkEpGFAKALJBRJYEBKYLYFSAIEIIIHIJICIGCBYDYKYERJICIDBKYEYLYFYASJIEBKIDRCYEYJYACFIKIDILIBIGSCYBBCAGALZBQKQJQIQHJEAEYDCBIESDYDQHZIAJAKALJGQCQHYBBKYLYFYASIIJIBIDICIHIGCEYKYLYBSIYJYACFIBIKICRDYJYBB', 'GMKBjDDBACBCVCaCTDbDrDEEgEAAFQGAHILAJaBQIQCRAIGBJILIDSEYGYAYCBIABAJJLQGQIYGAIABABZJBLJBRJZJQIQIYCRAIGIEIDCIYJYGRAYCBHYFALABKJQJJIRDRERAZCZGBKYFBLIJBBZBAILBQBZJRGRLYFRKICJAJDBEBBBJZJAIbFQHILQCRAIGBBIIIJIDSEYGYAYAQ', 'GMNBCCDBIBMBBCTCdCEDrDoGYHERAYHBJIGQCQIYHAEIARCIGBJYEQHQIIGALIDRFYBYGYCYABIYHAEAEYHSAIAAEBHAJIKILIDIFSBYGYCYEYIYAYAQHBIICALIDIGRCYIYAADBLYHRAIEIDIIICICQGBIYLYERAYHBEIASDICIIIGIBIFCLYAYDRCIABLIFSBYGYAYAACYDBLIGRAY', 'GMpDDGACRCYCdCBDUDiDrDSELGIILZHAFAJIAIKIDIEIEAAZCRGYJZLYHYFAIIIQFQKQHQLKGQBaDALAHAKAJAAJCQEQGQJIDQHaDAKAJAAAAIDRIYFQKIGJHQBQLaKAKYFCAIFQGIDAIYAQJQGQJIKQLKBADAHACAEAIZAZJQGQGIAAJZGQFQAIAAJAIJCQEQHQJIDQBQLaKAAAKIBI',
  'GMrDSGCBNBQCRCDDLDAEaGiGoGDSBICQGYHIHABAJIJAKAAAKICRLJEQFQIQIIECFYCYCQIQBZHQGJBAIACACIFIESIYHZGQBJIAEAJZGQHJIIEBFYCYCQKZGQJJIQBZHAJAGAGYDBAIKICALYAQDQKQGQGYJQHQBJHYIACAJYDBKYABKJLJCRGYAYJYKYLYDSAIAAGKHIJQAaHQAIBQ', 'GJQCDFCBlBRCcCoDAEaFBICIHIABIAGJEQEYIYCSBYDDFICIFAGJIQIIEIASHYBYDYFBCIDSBIHIACEYIYDYCYGYFSBIHIAIECIYDYCYCADQCYGBDJCRCIGYGAIIESAYGYHYCDIIEIASGYHYCYBYFCDIIICTGIHIACEYCYIYDYFSBIGIHIAIECCYASGYHYBYFCDIIIAICIESGYAA', 'GKADhGcBDCYCsDREEFIGpGCIDQEAJYFYCQHQALIAGAIIEBBYBAFAFaJJFQBQBJFBBZFIEQIYDAJZCZCAJKBQFQFYCYDRHQAQIKDAEAGACACYFJCQCYFYDQGRAaDAIZHBFKFAJABKCQEQGRIYDAFaDQFAGAHQIKAAEACABaFAJQDQHQFKARFaDAHAJABKCQEQGQAQIaDAHAAKGBJZAQ', 'GKADpGECFCKCYCCDhDIEbHBJHQEQGQAJIAEYFAHYBYJYDSCIAIGIIIFBJABAHKEQEYBYHZJYDYDAHKBQCRGIJQIQIIFIAYECBYGADAHYJYHABKJQEQFQAZGZDAHAHYDRGJGQALEAFAIAHAJAJIESBZDQFYIYAYGYCBDIBIJIEIEABZFRIYAYGYCYDCJIJQHQHJGRARIJEBFBBAGZAQ',
  'GLDBYCEBFBRBSBhBiBjEAHTHIIHIFRKYDRCIAIJIBCGYFYHYIYDRCRAIJIEBFBGIBSEYFBGBHYIYDYCRARJIFIGBKYAYCBDIARKIHBIYAYDYCRKIFRGIEIBCIYFRKYCBDIAIFIIIBSEYGYJYCBDBAIFIIIHRKYFBAYDRFIKIHBIYAYDYFRCRJIGIEIBCIYAYDYFYCRKIABIIBSEYHBAY', 'GLEBACYBBCVCTDbDCEZEjEoGEBGIJIIICIKIBSDYCCFZIYGYGAJAJYKJERAIHICIIQFQDIBCFYIYCTGYCAHYAYEBJICIFIIIBSDYGYHYCCGJJYERAICIHIDIBCFYGYIYJYCSAYEBCIJIFIIIBSDYGYHYAYEYCCJIASGIHIDIBCFYIYAYJYCSEIGIHIACFIGYIIBSDYAYHYEYCCJIFIAR', 'GLEBaChBFCbCIDsDKEQEcEBGAQCYKIFAIABYEYGYJYDSAIHIIICCBYEYGYJYDYASHIIICIKIFIBCEYCSIYCAHYACDIJICIEIBSIYCBJYDYASHICIIIBCEYJYCRHYACDICICQJIEIBSIYHYAYDBCIASHIAAIIBCEYJYAYCYDRHIABJIEIBSIYAYHYDBCIJIARIIBCEYAYJYCYDRHIIIAB', 'GLLBQCKBhBiBFCcDAECGZGjHAIBQCIHQHIBCDYEYIYAAJYGYKYFSAICICAGAGIHIJJECDIBSEYHYGYIYCYAYFCJIKIDIBIESHYDCJYKYFSAICIGIDIDAHIECBYGYJYKYFYATCICRDJGBFBHIEIBBKYAZCRCYDTFICCDYFRCIDCAIKIBREYHYDYACJIKIBIESHYDYAYCYFCJIKIDSAYAQ',
  'GLMDYGABkBVCgDBETEiEDGQGAYEADIFQIIBQKQCQGQJaAAEAHAIAFKBQDAKQCQGQJQAaHAIAFABKKQFaIQFIHQAKJAGAFAKABaIQFJGQJQAaHAFAIABKKQGQFZHQAKJAFAFYGAKABaIQHQAQJJFAAaHAAIIABKKQGQAQFQJZHAAJGAKABaIQAQHQJJFAGAAZIABKKQAQGQFQJZHAIAAJ', 'GLQDrGADIDaDcDiDkDMECFYFIAFAEJJQCJDAAAKABaHQEQFQIQCJDJAAKAGZEZFQIQCQDJAJKAGAEZFZHABKEQFZJQAQDZCAAJJAHZIQAQCQDJJAGJFAEABaIQGJJQDZCAAAGAIABKEQFQKQDZCZAAGAIAHJJQGZAQCJGAJAHZIQAQCQGJDJKAFAEABaIQAQCQGQDJJAAZIABKEQHZAQ', 'GLUDpGEDMDYDaDgDiDIECFcFIAEAFZJQCZDAAAKABJGQFQEQIQCZDZAAKAHJFJEQIQCQDZAZKAHAFJEJGABaFQEJJQAQDJCAAZJAGJIQAQCQDZJAGAEZFABKIQGZJQDJCAAAGAIABaFQHQKQDJCJAAGAIAEZJQGJAQCZGAJAEJIQAQCQGZDZKAHAFABKIQAQCQGQDZJAAJIABaFQEJAQ', 'GLbDBGiBKCVCIDQDTDEEYFrGAQBYHQIYIQBKDACAEAAIFAGAJAKaAQHQHICICQDRIQGKFQBaEAGAIACAHAAAKKDQJQFQBQGaIAFKDAJAKaAQCQHQFQFIIQCAGKBADAJAKAAbHQHZFRCJKJIQGQBJJAABHZFZCQFIKZFAHKCAKQAQJQBZGAIAFAAKDQJQBQGaIAFAAAHAKKDQJQFaAAAY',
  'GLdCADCBIBYBhBFCqDDERETFEQHIFIEIDSJYFBJAEAHZFQCQKQIQBKJAEAEYFYCRJIEBJQBZIAKAHJCQFQJQJYCCFIFAHZKQIQBJCACYFCJIERJQCQFQBaEAFAIAKAHJJQCQCIEIDCJYJAHaCRFRIYKQGYACKICIFIJIDREYJACYFRJIDIDBHBCZFZJRHJDQIQBJEABYDYHYIYGYGQBJ', 'GLrDRGACVCJDYDgDoDEEBGaHAIHJGQFQCQJYIYDBKIFIFAGAGICRBYEYHYIQJJEABACAFAGAHAAbKQIQBJCAHYKYDSBIJIEIEQJaBADBIAGJFQEQKIHICQJQBaIAEJFAHAKYDRIIBIDAJICBHYHQGaKAALHQHJGRCRBYJYIYDBKYABHJHAGLKQAaDQEQFJAAEZFQIQBKJAAAEAFZIQAJ', 'GMCBYBABBBlBNCcCTDoDDGQGZHHAGAIKBQKICRDYAYJYFAEAIILQKQAQAIDIDQJZCAHAAIDICIBCGAKYLYASGYEYEBFRHIGAAAAIGSEYABEAGAIYFQAIGIKIEQHYAAFAIILIBSCYCQDYEYHQJJDADYEYEAHYKALAIaGQIIKIEQJYAYFBGILIBICREQEYBCCICAIZEQDQJYLQKQHQAYHIBI', 'GMYCLFaBhBlBCCJCNCADEDjDqGABDYJYHAEALICQCYLYEQFRHQJIIJAADAGACALZKQBQIQIIFBCIDIJYHAEAKILIASGYDCCYFRDIGIACCYGRDYIYLYKYEQHQJIIABAKALJCQAQGQDQIZFBJYHAEALIGICIARDYCCGYFSCIDIIIACGYFYLYCRDIEQHQJIIIAIGCFYASDYCBIYJYHAEALIAI',
  'GMjBADTBJCKCCDEDpDsDUFLGgGDYEYCYABCAHYIZAQJQKQGQFJBJDAEALAHAHIIZAQIILIDSEYCYBQCAFZGAKZJBAJHJHQLQKQBQCQFQGaJAAAHIKILICRBYFYIIJYACKILICIDIESBYFYCBKYLYASJIGIFABADAIYHYAQKICQBJDAEBLZHAIJLQCQBQGQFJDAEACZHZKZAAIILICQKYAZ', 'GMoDIGDBVBbBcBQCRCaCEESGrGBADQGAHAAAKIIBLaDQEQFQKQCQJQBKGAHAIAKaEAFALJAQKQGQHQIQBaJAFAFIEICREAJYCAFBDBKKAAAILZKQCQDQEQFQJQBKHAIAAALAKaCQEQAJIQBYFADAEICIKILIGRHYIYAYJYCCAIBYKILIIRJYCYFYDBEBKILIIIGIHSBYCAAAJYAYFRCIAA', 'GMoGKHFBJBlBICDDZDgDAGbGiGAJCQGIIQJIFAHYHQFQJYGYCAKZEBAIIILIHIFRDYBYEYEAKJCQGIHAIAJIDAFAAaLQIKHQKZIALAAKFQDQHQJYGYCALZIQEQEIBIDIFBHYAYLYIYERKJCQGIJIFALAHAAZIQHKLQKaEAHAIAAKLQKQFQHZIAJYGYCAEAAALKKQAaEQCQGIIQHJJIFAAA', 'GNJBLGIBTBUBVBKCADDGgGjGoGrGAQCQHQIaBADAEAFAKAJKAQCQGQHQIQBaDAEAFAKAJAMALKAQCQGQHQKaDQEQFQBKIAKAGAHAAACALaMQJQDQEQFQKKGAHAAACAJaDQEQFQKQBQIKGAHAAACAJALAMaDQEQFQJKAQGQHICAAYGYBYJYKYFCEIDILIAQCQHYIYFAEBDILIMJAQAICSGYAC',
  'GNJDZENBdBjBQCRDbDoDsDLEAGDGAYIIFQGYKYCYDBHIEAJAIKBQEQHaJAJYDRCIKIAIGIFBBYEYIYDQCQJQKQMQLKAAFAGAHYEBIYJYDYCRKIEIGQAQHIFQLaMAKACADAIJJQEQKYCBDIEIJAIZDQCQEQKQMQLKAAAYLYMZCBDBEIIIJIBIFRGYMIGAHABAHYIZJQKQMQGKAQLZGAMAHKAQ', 'GLBDgDEBUBACFCdCYDSEJGiHBQHQEQAYIYDYCRJIJACADAIAKABKHQBYKYGYFSJIAIEAFBKYDRCYGBBJBAHLKQEQHYIQAQJaCADABYFRGAGICICRAJIAJJEAKAHaBQBYCRDIKIERJZAADADYCCFYGSCIFBBIFQHIEQIYDYAQJKDAIAEAHYBYFQAQAZCZFBGBBJBAHLEQKQAQDQIQJaFAAJ', 'GLCDgDEBUBACFCdCYDSEJGiHBQHQEQAZIYDYCRJIJACADAIAKABKHQBYKYGYFSJIAIEAFBKYDRCYGBBJBAHLKQEQHYIQAQJaCADABYFRGAGICICRAJIAJJEAKAHaBQBYCRDIKIERJZAADADYCCFYGSCIFBBIFQHIEQIYDYAQJKDAIAEAHYBYFQAQAZCZFBGBBJBAHLEQKQAQDQIQJaFAAJ', 'GLEBIBDBFCJDsDYEAGjGpGSHIYDRAICIHIBAGAIZJYFYFAJKIQFaKQCQCYAYAQDBHIKIGIBREYEAFIGAFAIAJaKQFKGQEQFYHZAACAFAKAJKIQGQFZAQCQHJEAFAGAIAJaKQAQCQFJEQEIHZBAFAAACAKAJKIQGQEQGYKYDRFIHIBAEYCYAYFQHJCACYAYAAEKAQFYHYDBKIGIBSCYAYBA',
  'GLEBjBDBFBaDcDkDYFQGTGAHBYGQFQEJBAEYGZFQEQJQDQIJHAGZBQFYJYDSAIARCJKJHBGBBZEZFZDZARDIEIJIGIBAFYEQGQJZABDAEJFJBQJYDYEAFJDQGQJJBAGYDYEYFYARJICQDADYEYJYAAFIGJDQJYAYCRIIKIHIBCDYEYGYJYAYAQJJDBEYGYAYFYCQFAJIAAGKEQAYEIDRBR', 'GLFCBDABDBECQCRCoDqDaEcFJAIAHJFQCQGQCIFCGYCSJYJAIAIYDSBIJIFIGCCYGQHYDQIIFRBZFAJAIADADYKYASEIIIJIBIGACAHYDQFICICBGRBYFADADYFSIYJYEYACKIFIDICRHIGQIZJQBJIBJZDBCIDIJIGBHYCQGQJQIQBZDADYFCKYASEIFIDIDQBJIAJACACYKYAYESFIAC', 'GLIBTGDBYCJDkDEEREiEAGbGFQIYKQBQCQGQJKAAEAHAIAFaDAKQBQCQGQJQEKHAIAFAKaBQFKIQHQEaJACAGAFABAKKIQFaCQGQJQEKHAFAIAKaBQCQGQFKCAHQEaJAFAGABAKKIQHQEQJZFAEKHAIAKaBQCQGQEQFQHIJJAIAQDBIYCYJZFAEAGABAKKCQHQIQAQDQJQFbEAEZGBHJAJ', 'GLIDpDUBkBFCYCdCQDSEhGCHAAHAFABYIYCYDBJIJQCQDQIQKQAKHAAYKYEYGCJIBIFQGRKYCBDYERAJAQHLKAFAHYIABAJaDQCQAYEQGBEICIDBBJIQJJFQKQHaAAAYCBDIKIFBJZBQDQDYCSGYECCIGRAIGAHIFAIYDYBAJKDQIQFQHYAYGABABZCZERGRAJAQHLFAKABADAIAJaGQBJ',
  'GLTBACRDUDcDjDEEBGJGYGgHFIARFQEQDQCKJIJADbEAEZFBAJKJDREZEQJQCaFAFYABKIEIBRHYIYGYABJJAQCQFZGQHKIABAEYFACAJZKYASGIGQHQIKBAFACAJAEAEJDBKZAZGREJDJBQJJCQFQIaHAJAEADJABKIBRCYAYFYAADaEQJQHQIKAAFACADADYEaAQJQHQIQFLCACJDBAZ', 'GLYBcCjBLCdCDDQDUDZEoGAHFIDACAGIAAHABAEAJKIQIYCYDRKIABIAAQJaBQDQEQGKKQFbHAHZGBKJCBIIARCZKZGRHJHQFLKAGaDAJIAQCQKYFYHYECBIDIGIIICIJICRGZGQKQFaHAHYDBIIGIKIACCYGYIYJYBYESDIBCIIGICAGQJYIQKQHQFJAAAICCGYKYIAJJGQKQHQHZFRAJ', 'GLYDqDJBKDcDiDSEgEkEEFAGCYDYKICAAAHABZFQGQAJHABAFZGQEZJQKJDAAAEAGAFJBQHQEZAQDQKZJAIAFJBJHQEQAZGABAFZIQJQKJDAGAEJHAFZBQEQGQDQKZJAIABJEQGQAJHAFAEZBZIQJQKJDAAAGAFJEABZFQGQAQDQKZJAIAFJBJEQHQAZGABAFZIQJQKJDAGABAFAEJHQAQ', 'GLZEBGEBgBACFCcCdCJGRGpGDAKYGYCTFYCAHCCIGIAIDIKIESBYIYJYFYGCCYHSGIFIBIIIJIECDYAYCYFSBIIIJIEIDCAYCYKYFYHYGSIIJICBAIDSEYCYIYJYCAGCHIFIAIDIERCYDCAYDQFYHYGSIIJIDICICQBZIAJAFAGAHAKKAQCQDQBQIaJABKCADAAAKaFQGQHQBQJQIKDABY',
  'GMBBdCbBCCICcCDDZDqDgELGTGAQEAHYDRGZDAKALABACAFAIJJJHRARAYDYCYCAJAHJAQDRCYEQGYJAHAIZFQKYLYBBFIHIIIJIDIAIERCYACDYHYIYJYFYFAIJBRHQJQKIGILIAICIECDYCSAYAQJAHALZBAFAHJCJARJYCBHZBQFQHQLJJAAAAIDIESGYJYKYLYAABBHAIZFQFICICRAJ', 'GMBBiGUBVBKCLCYCZCCDQDEEqGAYBIIYLIERJIGAJAEAHALaBQFQKYDBCIFIEIHIGIASIYJYKYDYCBFIDSKIIIJIACGYHYEYDYFYCSKIDCEIHIGIASIYJYDYKYCCFIEIHIDSIIJIACGYDYHYEYFYCSKIIIJIAIGBDYASIYJYKYCCFIEIHIAIDIGRIYJYACHYEYFYCSKIAIIIJIGBDYHYEYAS', 'GMFCICRBjBKCLCcCdCDDoDAGgGCAGBDIJJLIBRCYEYFYGYDCHYASDIHBIIKICABAJZLIEQLQFQGQHQKQIaDAAAKIEALIJIBQCQIYKAFAGAJALZAQDQHQDYACHIDSGIFIEICICQIQBAKZFALYDYGRAYHCGIASFIEIEADAIIBAJYDYAYFSEIACDIDQAQJIBQIYAYEYEQKJFBDIIACALIBQCYAY', 'GMIBiDFCYCDDTDsDREcEAGJGpGBYIYCREIJIAADALYGYCQFIFACAIAGALKBQBYGZIQLYCQFQFYKJCAHAGALIBIBALaCQFIIQGJHQKZFACAGAIALKBQBYHQLYCQGIKQFaEQJJFAKAHAGYCALIBIBALaCQIQGQEQEYKJCAHAGZIALKBQDQAQGQHQFQJaKAFKHAGABALZCQEIHIAIDBLYIQGJAQ',
  'GMJDrDRBICUCdCEDpDSEBGLGgGHYBYEQJYGYLIDQAYKYFCEIBIHIDQIILICQAQAIKZIALABABYHJCQHYLYEYFSGIIIJIKIDCCYCAHZBQLQAQKQJQGaIAKJAALABAHJCQCIDSAYJYIYKYFCEIBILICAHYBQLQKQIQAIGJJAAACADBLZBAHJLQBaKQCIIQGQJJDABAKZIQGQAJCABICYAYCABA', 'GMMBYBIBlBBCNCcCKDSEDGhGpGCABAEQJZAAFADAGAKYLJKQBQCQEQHYIQJYAYAQGBIIEIBIBACRHYCAEAKALaDQFQIQGQJKHAHICBBYEYAYGYFYDCIIGRAIEIBICRHYHQJaAAFAGAIALKKQBQEQHICABYEYGYIYAQDRFIAIHIJJEBBICREYBCGYHQIYDYFRJIBIGBIYDYARHIBQHAAAHIBI', 'GMNBICJBgBECZCdCADiDCEaGqGAAGAIIJQHJBACADAFALZIQIIKQEQHIJQCIFBDILIBSFYDCJYEYKYGYGAKJJQCQDQHZEAGAKAIAIYLJJQKZASGIEICIDIHIFIBCJYIYAYKYCQLYGSEIACCICQAQAYEYGCCICQGQIIKJJALZIQKQAQEQHJDAAYDIDRHZAADAEAGACAKAIALKJQJIBSFYAYAQ', 'GMNBZBABdBBCQCcCiDSECGKGpGDQAQFQCQGAKILIBQEQJZKAAADAGAHIIALIBIBAERIYGYAYAQDBHIDQGQKQJKCAFAIAEALaHQHYDRAIGIBIEIFICSIYEBBYGYAYDBHIHALKBQEQFQIQJaKAAAGAHYDQAIGIEIIIBACBFYBYHYLZGRAYDBGIASEIHAIICIFBLYAYERIICIBBHYAAHQBQHYAY',
  'GMjBEDCBZCaCkDsDAELGQGTGbGDYEYAYAAGZFQLQKQJKCQHQBbIABIJAKALAFAGJAQAICSHIDCEYCYAYAAGZFQLQKQJQIQBKHAAACBLZFAGJLQAQCQHQBaIAJAKAFAGALJAQCQFaKQJQIQBKHAFAAACALZGQKQJQFKHQBaIAFAJAKAGALJAQCQHQBQIZFABKHAAACALZGQKQJQBQFQIJHABa', 'GKCBFCIBiBdCrDDEgETFYGAYCAGYJADAHAFaIQBYECIIDIHIJICSAYGYJYDCIYESJIBIDIGIAICCHYIYEYBSDIECIIHICSAYGYJYEYDYBCIIESGIAIJJCCHYEYIYBSDIGIJIECFIHICTAYEYGYDYJYBCIIHIERAICDEYHYIYBSDIGIAICIEBHYJIASGYDYJZBCIIAIHIESCYGYDYBYJYAA', 'GKMDaEIBJBYDgDrDCFUFoGAACADAEAGIIAGAJKFQBZHRAZHAIAGAJAFLBQEQCQDQAZHAEJBAFbJQEQHQAJCADABAEZJAFLEQBQDQEJBQCRAZHAGaJAEAEJBJCRCIDYDSGYGBCBDBBZEZEQJQHQIQALGAGJCBDBBBEZEAFbJQELFAFJBRCRDRGZAZIAEAFJHQAQAZHBBIDRCYBABICICRAR', 'GKlBYCABkBECTCcDZFQGBHEIFQIJJICIBCHYFYDYAYGYESIIJIFCHIBSCYFYIYJYECAIDIGIHIFSCIBCFYHYDYAYGYESIIJICIBIFCHYCTIYJYECAIDICIHIFSBYIYJYEYADDIDBCJGRERAYDBCBGICQHIFIBSJYAYEBCYDSEIAIJIBCFYHYCYASCQIIJIBIFCHYCYAYDYGYESIIJIBIBQ',
  'GLABjDLBQBVCRDEEBGZGrGgHFAIIDIARFYCYHYGYGQHKFAAADAIZGQHQFLAACADAIAKAJaBQEQGQIKCQDQFaAQHAIAEAGABAJKKQCQDQFQHaIAFKCADAFYKAJaBQGQFQIQHKCADAFZGABAJKKQFQCQDQHaIAGAFJKAJaBQFQGQIQHKAACADAKAFaBAJKFQKQAQCQDQHaIAEAGABAJAFLKQBa', 'GLDDbGFCYCADIDQDhDkEpGKHBZCQAIEJFAGADAJYIYCRKIGIGQFQFIDBBYEYHYIAJJHQBQDQGQFQEQAbKAIABJDQEYKYCCBIJIHIHAJaBQCRIQFJGAHAKIEIDAJABaIQFQGJEQKYCBIIBICQJIDREYEAGaKQALEAEJGBDBBYJYIYCRKYAREJEQGLKAAaCAFAHJAQFZHAIABKJQAQFQHZIAAJ', 'GLFCBDABLBECQCRCoDqDaEcFDAJAIAHJFQCQGQCIFCGYCSJYJAIAIYDSBIJIFIGCCYGQHYDQIIFRBZFAJAIADADYKYASEIIIJIBIGACAHYDQFICICBGRBYFADADYFSIYJYEYACKIFIDICRHIGQIZJQBJIBJZDBCIDIJIGBHYCQGQJQIQBZDADYFCKYASEIFIDIDQBJIAJACACYKYAYESFIAC', 'GLSBDDMBFCTCYCKDcDkEAFpGAQAYBYCAEYHYHAIAIYDSCIBIGIEBIYDYCTBIGIHIEIJIFCAYIYKYESGYHYCCBYDIEIIIAIKIFSJYGYHYCYDCEICSGIHICAJIFCAYIYCYEYDSGIHICBIIAIFSJYCYGYHYDCEIIICRJIFCAYCYIYEYDSBIGIHIJICCAIFSCYJYBYGYHYDCEIIIAIKIFICTJYAC',
  'GLTBBDJBACSCdCKDYDgEEFqGAQAIBICAEIHIHAIAIIDSCYBYGYEBIIDICTBYGYHYEYJYFCAIIIKIESGIHICCBIDYEYIYAYKYFSJIGIHICIDCEYCSGYHYCAJYFCAIIICIEIDSGYHYCBIYAYFSJICIGIHIDCEYIYCRJYFCAICIIIEIDSBYGYHYJYCCAYFSCIJIBIGIHIDCEYIYAYKYFYCTJIAC', 'GLdBIEhBYCADCDKDsDSEEFiGHZAQJQFJEJBACBDAHZKQIQGQEQFZJAAAIIKIHIHAKaAQIQGQEQJQFJBJCBDBGZCQEQBQFaJAEJGJDRFYBAGAEaAAIAKKDQCYGYHQEQGQBQCIFJDCEYGYHYIYKYAQJQFJBAIAEKHAKZEQHKGQCQGIDRBZIBCJGBHZEAHAEZAZJRFRIJCBABBIDBEIHYHQGQBQ', 'GLdBSDUBiBICjDgEAGZGrGDHAABYBAFIIADADIGIGAJaFQAQCQIJGAJAFbAQCQDQIQKQHKBAEAGAIaCADAFKAAJQIQEQGQBQHaKACADAFAJKIQFaCQDQFIKQHKBAGAFAIAJaCQDQFJGQBQHaKAFACADAJKIQGQFZKQHKBAFAGAIAJaAQCQDQKQFKBQHaFAKAAACADAJKIQEQGQBQHQFbKABK', 'GLgBLDQBbBNCZDkEDGRGpGAHFQIICIABFYDYJYGYGAJKFQAQCQIZGAJAFLAQCQDQIQKQHaBAEAGAIKCADAFaAAJQIQEQGQBQHKKACADAFAJaIQFKCQDQFYKQHaBAGAFAIAJKCQDQFZGQBQHKKAFACADAJaIQGQFJKQHaBAFAGAIAJKAQCQDQKQFaBQHKFAKAAACADAJaIQEQGQBQHQFLKABa',
  'GLhDJGIBYBMCNCCDEDSEoGjHGZHZEAFAIYKAJKAQAYIQBQHQGJCACIDCIYDQJYKYFSEIBICQGZHABAKAJAAKIQCQDQGQHZBAGKCADAIAAaJQKQGQBQHKCADAGaKAJAAKIQGQCQDQHaBAKAGKIAAaJQGQKQBQHKCADAIAAAJZGQAKIQCQDQHaBAKAAAGAJJIQAaKQBQHKCADAAAIAJZGQKQAK', 'GMEDpGABKBdBYCcCBGLGTGZGhGCQDYHYIYJYEBGIBIKILIDSCIFBDYCSIYJYEYGBAYBIKYEQLICIDIFRIYAQHKIAJYJAFAKACADABaLQCIEQGQAIJIFAKIDABALaCQEQGQKQAQAZGBEICIBIJIDAKYLIFRDYJYGYECCICALJGQJIDIFBBYBQKQAQDQJYFQGAKIDQJQIQIIFBDYAYHZEACAKIAQ', 'GMKBcCNBACBCYCbCCDEDZDLEhEBIGIJILIESAYHYIYKYCYBCGICSKIAIEBLYCYGYBSIIHIEAJYKICCJILIESAYCYHYIYKYBCGIJILIEIFIDSAYCYHYECJYLYGYBSIIKIEICIAIHIDCFYJYLYESIYKYBCGIEIJILIFIDSAYCYHYIYKYBYGCEIBSIIHIKICIAIDCFYJYLYBYEYGSIIKICIAICABA', 'GMKDcDIBJBECFCSDYDaEgEAGrGBQEQKJCADAHAJALaBQEQFRAJGAHJDQKYAAEAFABALKJQCRDQGZHAIABZEQFQHJGJCBDAJALaEQFQHQAQKJDAJABZIQHZAQGJHAIABJJQDQKZGAAAEALJJQCRDQHZAZEAFBBJIQAQHJCBDAJALZBQEQFQGQKJDAAZHQGZEAFABALKJQAQHZIABZEQFQGJIAAJ',
  'GMMBYCIBcBCCDCVCADEDhEZGrGCIBBJYLYGQAIDBKIKQDQEQFQIZAAAYGCKILIJIBRCYEYFYDYARIIGQIQHLCABAEAFAJALaKQAQDQGQIIFIEICIBBCQJYDYFRHYIYGBAIFIDIERHZIYFBDIEIJIBRHYIACIHQIZCACIHIIIBBJYEYCSFYDCAYGRDIACCIFRAYCCFIEIJIBRHYIYAYAQEBJIBI', 'GMNBICBBRBjBKCLDkECGbGgGoGAABAJAEAHALKKQDQDYFQFYEYHYJYASGIIICIJICQIZFAGAJAAAHALAKKDQBQEQCQEYKYLYARHICIFIBIDDEYEBKZLZCRHYABCJKJLJEREIDTBYFYHYAYIYGYJYCDAIARCRGIHIIIJIFIBIDDEYEBKZLZAZCRHIABKJLJEREIDTBYFYAYAAHYCBKILIEIFRAY', 'GMNBiDACdCBDRDoDTEYEDGJGqGBIIICREYJYAADAKILIGICQFYFACAIAGALaBQBIGJIQLICQFQFIKZCAHAGALYBYBALKCQFYIQGZHQKJFACAGAIALaBQBIHQLICQGYKQFKEQJZFAKAHAGICALYBYBALKCQIQGQEQEIKZCAHAGJIALaBQDQAQGQHQFQJKKAFaHAGABALJCQEYHYAYDBLIIQGZAQ', 'GMSBYBABDBkBlBRCBEEETGbGoGLIBQCRHYABJYKYFBEIKQLIGQJYFYEBKILIGIBICRJYDRIYEBFIDIJICBBYGYKYLYFRERIIAIHICBJYARIYEBDIAIJICRHYIYABDYFBKILIGIBICRJYDYAREYFBAIDIJICBBYGYKYLYARDIJIGAKALYAYDRFREIIIHICBBBLYAYBQDYFRJIKIGIBICSHYGBBI',
  'GMpDDGdBACBCCCLCYCcCMDUDhGEQFQBZJAKACAIAAKLQEQFQGQKaJQBJKAJaGAIAAAAYLJCQEQFQJQKQBZIAIIBIGIJIKIECFYAYGQJQKILYCQIQBIEIFCAYJYGYLYCYCBLJAQIQJQKIGAJJABJZGQKYIALZCRCIGIAIJILIFSEYAABYIACAKYGAJILIFIESAYBYKYGYIYIQBJCBJIGQKAAAAI', 'GKCBjBQBiBdCbDgDAEREDIBIDIGICRGQIYASJYECBIFIDAGJAQAYDYFYGYBYESJIDCFYBAFQGIIICBAYFYFQIQIICIABFYFAGaIQDRHIABCYDYIAGKFQFICRARHYJYECGIFIDRAICBDYFYGYESJIHICBDBFYFAGaIQAIDICRHYABIAGKFQFICRDYIYIAFAFICIDRGYBQIYFAFIASJYECFIAI', 'GKEDpGCBYCADQDsDZELGTICQEQAbCAFIIAJAGABJHQFQCQEQAQIaJAFKHABZGQFQJQIKAACAEAHAFaGABJFQHQCQEQAQIaJAGABAFKHQGaJQIKAACAEAGAGYHACQFaBQJQIQALEAEJGBCZIZAQEJGJCADAGYHAFABaJQAQIJGQEaIAAAJABKDQCQFQHQGQAaJABAFKHQGQAQEQIaJAGKAQAI', 'GKFBQCABjBlBECcDZEoGBIEYGYATFIGIDAJICIBBHYDYEYAYGYFSJIDCHIBRCYDYJYFCAIEIGIHIDSCIBBDYHYEYAYGYFSJICIBIDCHYCSJYFCAIEIGICICQHIDSBYGYJYFYADEIEBCJGRFRAYEBCBGICQHIDIIIBSJYAYFBCYESFIAIJIBCDYHYCYASIYGYJIBIDCHYCYAYEYFSJICCAYAA',
  'GKFCIDQBgBbDREkEDFAGpGBICADAFQJYGYASHIBICIDBFYEYEAGAIIJJFQCQDQBZEACICQEQBJDBBYEZCAFAJZGQCIEIDQIYCBEIEQBQCQEIIIDABYCYCRBJBABYDQIYHYACEIGICIFIFAJIDSBYFYCYCBEZGAJJDJFREZBQDAGYJYASHICICABJEBBZBQCQCYHYACGIJIDQBJFBDZJZGQBJ', 'GKKCUCABTBVCoDEEiEQFBGBQDAEQGQJJAAHAFJIQAYDYGYJYECBIFIHIIICTAYDYGYJYEYBCFIHIIICIASDYCCIYFYHYBSEIGICIDIACIYCSGYCAEYBCHICIIIASDYGYCBHYBSEICIGIDIACIYFYHYBYESCIBCFIHIIIASDYGYJYBYCYECFIHIBSGIDIJJACDAIYBYFYHYESCIGIJIDIAIBA', 'GKdBgBFCUCADSDpDIFhGCHGKIQFRFYDYAYAAGAIJFQDYGYCRJIDBGZAQGIGAFAFIIZAQGIGAFAFIDRJYCBAIAAFQGQIJDQJQEKHADYFYGYAYIYCSJIHIBDDYDAFYIZAQAYGIHQEZJAGAGIABFJFQAQGYCAFIHQIIDQBQEYJYCBFBIJFQHQGZAAAIFYCRGIBIJIEIDCHYFYAQIYCQGJBIBQBI', 'GLCDaGACdCEDMDUDjDYEoGJHJJIQCQAZEZFAGADAJIIICRKYGYGQFQFYDBBIEIHIIAJZHQBQDQGQFQEQALKAIABZDQEIKICCBYJYHYHAJKBQCRIQFZGAHAKYEYDAJABKIQFQGZEQKICBIYBYCQJYDREIEAGKKQAbEAEZGBDBBIJIIICRKIAREZEQGbKAAKCAFAHZAQFJHAIABaJQAQFQHJIAAZ',
  'GLCDoDBBTBACKCRCiDEEUFqGKIBIESCYCQAZFAGAHYDQFIAIGICIECBYHYHABAKaDQFQJQIQAKCAFADAGADYFSGIDCBIHIERCYDYGYFCBIHIDSCIEBDYBYHYFSGICIEIDCBYHYCSGYFCCIBIHIDSEYGYFYAYCBBIHIDIKIESGYFYAYIAJAKJDQFQAYCAHABADIFRHYHABADADIFIEIGSHYHQAQ', 'GLFBQBUBVCIDZDgEAGKGRGiHDQAQHKEAEIBBIYCAFJJYJQBQIQEQHaAACACYAYDCFIJIKIGIBSEYIYJYFYFAJKIQFaAQCQHJEAFAIAJaAQCQFKEQHZFAAACAJKIQEQHQFaAACAEKIAJaEQAQCQFKDQHAIAJABAEZAQCQFQHKIAJABAGYKYDRFIJIBAEYCYAYFQJJCACYAYFYFQJQHQIKCACIBI', 'GLFBgHRBVBECIDkDKEBGaGrGCYGYDQAQJYEQIJFACAHYJYEYAYAQDBGIDQEQIQFLCAHAJABAKaEQGQAQDQJKHQFaIAJAAADAEAGAKKBQCRHQJaIQFKJACAHABAKaEQGQAQDQIQFQJKCAHAIaAADAEBGAKKBQIQCQHQJaEAFAAADAIKBAKaGQIQAQDQEQFQJKCAHABAIaGAKKIQBQCQHQJaEABI', 'GLIDMEDCYCEDpDZEQGbGjGrGAAHADAGAFAKaJQIQBQCQEQALHADAGAFAIaBQEQAQHKDAGAFAIAKAJaBQCREQFKCBGQHZAAFAEABAJKCQKQIQGQFaAQHJFAGAIAKAJaBQCQEQAQHQFKGAAaCAEABAJKKQIQAQGQFaDQHACAEABAIKAQGQFQHaCAEABAIAAKKAJaAQIQBQCQEQHKDAFAGAKAIaAA',
  'GLIDqDDBKBdCbDEEQFAGTGiGBZKQDRFQJYEAKIDQJQCQCYGYEBGQIJAAHABAJIDAKaFQJQEQIICADAJYERGIDIDAJAFAKJBQFaJQDQDYGYEBJIDQCQIYEAJAKIKABLFQFJHRCZDBJYEQIIAICAHAFZBZKYERGIDIAQIZGAEABJFJHQAQCQIYDAAJCJHBFZFABbEQKQJQAQDQGQIKHAAaJAFKAQ', 'GLIGjGZBECFCLCaCcDBGQGrGCYGYBYIYFAHZKYESDIFIAIJICBGYBYHYKYFSAIJICIGBBYKYFYEYDSAIDAAAJAEAFAKKBQGQHQCQJZAQIKJAAaDAEAFAKABKGQHQCQAQJQIaEAFAKYKABABYDREIFIAIIIJIGCCYHYBQKQAQAICICAGRIYJYFYEYDCAIBIHIKIHABaKQAQDQEQFQIKJACAHAAZ', 'GLJBdCIBbCcCYDgDpDKEEFBGFIGIHYCRAYIYDBGIGQFQFICIARIYDYKYJYBCEIFIFAGAGIHKCQDRIIABCYDYFYGYHYEYBSJIIIDBCIASDYIYCAJYBCEIFIGICIAIDRIYCBFZGYEYBSJICIIIDBAYGYCRJYBCEICICQFJGIAIAAHZGQAIHAGZAQAIFZGIHIDRIYJQKJIAFAFYJYCCEYBSCIEBAI', 'GLdBAFbBgBUCMDYDhDpDCFrGFAEAGIDAIYKYAQEICICBGJHAKAIKDQHYGYIZKYCSEYACCICAIKKQGQGYHJDAKYIYIAKKGQDIIYDYDQHZIAGAGJDJHRIZDAHAKaGQDIEQGIDQJQFZAAAYCCEIASCYCQFJJADAGYEQCIABDIJRFZAACADAJAGAGYDRARCYECDIEQGIGQAQCQFJJAAZGBKJHQIQBQ',
  'GLjBYDIBJBiBVCCEEEgESGaGAICADABAEIFQIIJIBICTBYBQDQDYGYHYJZFCAIEIIICIKIBIDSBYGYHYFYKYADEIIIKIBIDBCYBRKZEBIIBICIKICABZIZEREYATFIFQHIGIDBCYKYEBIIBIBACQDRGYHYEBJIKIDICBBYIYAYFREIHIGICBDYJYKYABIIBIDRCRGYHYEYFCIIBIDICRJYKYAY', 'GLlBAFVBgBhBUCCDEDYDSFLGFQJQKYKQGQHZCBCYADFIJIEIKIEBDJIRBRGZHZEBCYAYKYDAFCJIIJBQKZAQCSEIEQHKGAKABADAIZCQCYESAYAQHQGKKAHaAAAIDAECJYFSAIEIDICCJYESDIDQGQKKCAJAIJBQHQCZGZKZAAAYFCEIDRARFQGJKJCJHBBBIZBQHQJQCQKaGAAAAYDCJICSAY', 'GLqDEEhBACTCUCVCsDJEBGYGCYAYAAHaEQFQGQBQBYGCFIEIAIHICIKIDSIYBYECAIKICAHYAQKQEQJIIACADAHYAYKYERBICICAKAAAAYHJDQIQJZBAEAHIAQKQCQCIIIDBAYHYEQKYCQBQJJDAKAAAAIHZCQHIKIDSIYBYEBCIAIIADAHYAQKQBQBYEYCCFYGSCIFBAIJIIIDBKYAAHKKQAa', 'GMDDhGFBJBlBICcCAGKGTGZGpGFRDYIYJZGBEYCTGIIIJIDIKIDQIZAQHKIAFBAZBYLYEYCYGRJIJAGAKACAEALKBQDQEYFQAYJYGAKYCALABKDQEQFQKQAQAJFBDYEYBYJYCAKILYGRCIJIFIDCEYEABZFQJYCYGBLILQKQAQCQJIFAGQKYCQJQHQHYGBCIIJDAKIFQDIECFYAYJYKYCYCAKJAQ',
  'GMoDMEaCbCBDSDYDcDgDIEkEDGEYFACADAAJIQGQJQEQLaBAHAKAAJCQDQHZBQLKEAFZHACADAAZKQBQHJCBDAAAIJGQAZCRDQFJEQLaHAFJEJJAAAGAIZCQDQEQFZHQLKJAEZCADAIJGQAQEQJQLaHABAKAIJGJAQEQJQFZCADBEJAAGZEQCQDRFJJAAAGAEZIZKQBQHQLKJAAAGAEAIZCQDQAJ', 'GKADjDQBdBiBMCEDgErGJIGZFAFIGIAICBJIHBEZBZBQJQAQAJCJHBJYDYFRAIGICIHIEDJYCSAYGYFBDICIJIETHYAYGYCCDYFRCIAIGIHIEDJYDYFYCSAIGIDCJIETHYDYAYGYCCFIJIHRDZGZAAJABABJEJHRDRGYAYDAJYCYCRAJAQGLJAEAHAIaBQBIEIEQHIDRJYAYCYGYFBBBEJCRAQ', 'GLBDqGACFCdCDDYDaDjDgEKHHIGICQAYFYIYKYDYECHIHQDQEQFJAJCAGYIAHZDQERFQAJKAIAGJJABZDQIJKQAaFAIADABJJQCQAYFZIADAEBBIHJGQKQFQIZDAEAHAGJJICRFZIQAJFACBJYBYGZHQDQEQAJIAKAGAHZDQERAQIJFJCAJABZDQAQIQFJKAAaDAAIBJJQGZAQKQFaIADAEBHJAQ', 'GLDBYBVBZBlBMDrDAGIGoGSIDAFACAEAGIJIBQDYKYCYCRFRAJHJIJDBDIBDKYCYFYEAGAJJKQBQDQFYEYARHZIIIAFAFJCBCYEYEQFYFQIQHKBACADAKAJaGQAQEIFIJIKIBTDYDRCZHZIZFBABEIIIKIDICRDQHYCACIHIBDDYCRDQIYCACYKYAYARFRHJIJBJCBCIDDJYGYKYAYAAGAJKKQBQ',
  'GLEDrGDBVBMDTDYDJEgEAGaHBYDRFICQAYHYCYEYFYDDFIKICREYEQAQJJHAGAIABZKQFQEJGJHQJZAAGAEZFAGIKABKIQHQJQAaGAJJHAIABaKQFQFYDRGIAJHAEZJQAQAJGZAAJAEKHQEYGZAZDBAIFIFAKABKIQHQJZAQGKJAHAAYIABaKQFQFYDRGIGQJKHAEZAQAICCAYGYDAFIAQEKIABA', 'GLEDsDBBKBNBACLEYEaEcEoGCQAaEAGAJABAKKHQFQAYDAIAHIBYFRCYIYJYESGIDIAICAFAIAHAKaBQEQJIDSAIIICICQFBHYDYBAKJHQFQAZIADAJYEBKIHIFRCYDYDAHAKZERJIIQAJCADAFAKYBQHIFICSDYDQAZFAIAHABABZEZJRGRIJAJFAHABABICIDRFYAYCBDIFRAYHABADICRAQBY', 'GLKBcCJBACDCdCEDYDoDMEaFAAHQCQAYDQEYGYJYFCBIKIESAIAQGaAACAEAJAKAIKHQHIDRCYEYEAHAARIZJYKQFYBCKIAIARJRGJEAJAHAHIERGZJAHAAAAYKYBSFIHIJIACEICICRDBIYEQAQAYGIDACYARHZJQGJHBABAICICBDRHYAAEAIIDQCYEYASHIABCADAIYKYBYFSJIAIHQGZJABA', 'GLSDDGUBVBlBICgDBELGZGiHAYFAGQJYCYDYEBKIJQAQFQHQBaIACADAEAKAGLJQAQFQHQBQIaCADAEAKAGAJKAQGaKQCQDQEQIKBAHAGAAAJaKQGKHQBQGYIaCADAGAKAJKAQHQGZCQDQIKBAGAHAAAJaKQCQDQGJBQIaEAGACADAKAJKAQFQHQBQIQGaCADABKFAHAAAJaKQBQCQDQGKIAHAAA',
  'GLUDpDEBIBYCcCdCADCDhDJICIIIHIDAEABYJIJQKQHQIZCZABFBGBJJJABLKQCQHQIIDIEBKYBYJYCQGRIQAZFAFICICBHJDQAYHQIQCYFYGCBIHIJIKIESDYDAEAIYIAKABbJQJZHRFRGRCJAJFAIAKAJAHZGQHIGAJYHABLJQHZFQHIJYHQKQAQAZCZFBGBBBHJHAJLEQDQKQAQAIDIECKYBY', 'GLgDJGABQBMCNCBDEDREoGjHAIDQCQGYHZEAFAKAJKAQAYIQBQHQGJCACIDCIYDQJYKYFSEIBICQGZHABAKAJAAKIQCQDQGQHZBAGKCADAIAAaJQKQGQBQHKCADAGaKAJAAKIQGQCQDQHaBAKAGKIAAaJQGQKQBQHKCADAIAAAJZGQAKIQCQDQHaBAKAAAGAJJIQAaKQBQHKCADAAAIAJZGQKQAK', 'GLhDIGgBjBFCADpDDEQESEcEFIKQJIIICBAYGYDYKYESHIBICBIYJYHQFKBAJADAKAGKAQGYIQCQBYFYJYHYECKIKQEQHQFQBKJADAGAAJIQCQJYDBCJJRDZBZEAFZHAKAAJGQKYERBJEAFACAKYAAGJKQCQFQHQFJDJJBIBKZAZAQCQDQBYEAHQHICICAAAGZHQCIEQBIDAABGBHZCRERFIFQBQ', 'GLjBFCLBiBACYCZCJEkEBGbGCIHIGBDYAYIYKYBSCIHIJJGAGIDDFIDQESDYGYHYCYJYBCIIAIKIFIGSDIECGYFYAYIYKYBSCIHIDIFCAYIYJIKYBYCSHIDIFIEIGCAYIYKYDSHYCCBIDIIIKJESFYHYCYJYBCDIIIKIEIAIGSFYADEYAQIYDYKYBSCIHIAIECIYDYJIKYBYCSHIAIEIFIGCKYAQ',
  'GMBDoDlBACJDUDqDDEYERGbGiGHIEIKYCAGJBJIQDQAYEAJAKYKALABAGZCQLYFQHQEJAJDALYFYCAGJBQFQLJIABZGZCQGIBILIIIDSAZEZHAKJIABAGZFQBJIQKaLABAFAGJIQBZLQHQEJAJKIDCAYBYIYFYLYCAGIFQLQBKIABYFZGZCQHQJJAQEaJAAKKABABYHYCBLIIIDREYJYKYAYCBHIBI', 'GMDBcBABJBKBaBTCdCBDMEYFqGCQIYJAHALIFQEQAYJYHBBIGIEIAREQJYGBEIAIAQJQFAIJCADAKALaAQBQEQGQHQIJJAFAFIKICSDYJYIYFAAAHABALICQDRJYIYGAEALJKQFYABEYGRIIFAKALZBQGQAIHQIIFIJIDBCBLYEQFRJIDICBKYFYFQJQEAIZAAGAHABALKFQKQCQDQIZJAEAEYGYAS', 'GMICTGJBKBZCMDkDsDiEAGDGaGARCYLIDQFaKQJKFACIACDAEYIYIAHaGQLQBQKQJQFKCADAIAHAGaLQHKIQCQDQFaJAKABAHALAGKIQHaBQKQJQFKCADAHAIAGaLQBQKQHKCQDQFaJAHAKABALAGKIQCQDQHaJQFKHACADAIAGaLQBQKQJQFQHKDADICIAIECIYCRDYDQHZFAJAKABALAGKCQIQBa', 'GMJCNCABKBLBiBMCaDgECGjGrGBACRJZEAGAHJDQDIFCIICRAYFYDYDAERIAJIAACAEALaKQHQBQGQIIFRJJAICCFYCQIYERDIAICIFCIYARFQJaAABADAEAGAHAKALKIQIIFSCYAYEYHYDQEAJICAFBIYKYLYBSGIDIEIAIFIJIFBIBKZLZHRDREIAIIIKICSFYFQIAJZAAEADAKAHAHZDRDYBYBA',
  'GMQCUDABTBJCKCBDcDjDDEhErGAQCQGYFAIIDQJIFIEICIGIACKYKALaDQFQIQHQBQJQGKCAEAFADADYFSEIDCKIARCYDYEYFCKIDSCIABDYKYFSEICIAIDCKYCSEYFCCIKIDSAYEYFYCCKIDILIASEYDCKYCSFIDIEIACKYDSFYCCDICQKIASEYFYCYGZDBJABAHAIALJKQHaBQHIJQGJCADAHABa', 'GMgBbCcBdBACZCaCRDsDEEBGJGAAHKBAFAGAIbBQCQHYDACIBIGQGIFIAIERFQHZKYLYJYJQKKLAHAHYJYBBCYDRBIJIHIHQLQKaJACBDYBRJIGCDYCRGQJQKKLAHAHYFBDYGRJYBBCIGIDIDAIJAQFQHIEAAYFYDYDAIYGYCYBRCAJIHIFAGAIJAJERFRHZDAAAEAFAGAIaAQAICQDSGYACCYAQBY', 'GMjBBGVBZBiBYCEDbDIEkELGSGBYDQGYHZKYCBLILQCQKQGQBKIAIIFCDYEYAYHYJYLYCSGIKILIHIHALaKQHKIQBZGAHAKALKIQHaGQBJHAIALaKQGQBQHKIAGaKALKGQIQHaBAFQKALAGKIQHQBaKAHKIAGaLQHQKQBKIAHaLACAGJHQIQBaKALACAGAHJJIAIEIDIFRIYECAYEQJYCRGIHIEIAC', 'GMrDBGNBZBaBECQCIGRGbGjGoGAIHIGBDYEYJYKYCRFIBIHIIIECDIGREYDCIYJYKYCYCAFRAYBIHIDIEIGBJYKYAALKKQJQGQIQDQEQBaHACADIFAAIIIEQJIGQBQHaCADAFAIAAAAZFRCIDIBIHIGBJIEQEYIYJYFYCSDIDQHJFAJIEIGRBYBAIAAAEAJYFQGAIIEAJAKAKIGREYAYLZCQDQIIAA',
  'GNKBkEEBFBRBVBhBQCIDTDiEBGaGLYCYDYFBMIAQIIHAGYERAYJYMYFRDICICQIILJABEBGIHRAYAQLZEAMYCQIIIAJAJIEIAIHBGYKYBYFRDRIIJILIHAMYCYCADYFBBIKIGIMIHSAYEYCYJYLYIYFBDIJQIQLJAAEAMIGBKYBYDRMICQFQLIEIAIHCKYCRERAIGBEYCBKIHSGYEBCYAREIGIHCKYAR', 'GKADqGLBVCCDEDoDbEIGQIDQFREJEQALCAFYIAJAGABZHQFQCQEQAQIKJAFaHABJGQFQJQIaAACAEAHAFKGABZFQHQCQEQAQIKJAGABAFaHQGKJQIaAACAEAGAGIHACQFKBQJQIQAbEAEZGBCJIJAQEZGZCADAGIHAFABKJQAQIZGQEKIAAAJABaDQCQFQHQGQAKJABAFaHQGQAQEQIKJAGaAQAY', 'GKEDoGIBJBYBCCdCrDLHaHAYDRFYIYGCHIBIJIDIEICSFYFQAaEBDYIAJYGRIIEIDBEAJABABIDSFICCDYDAHbBQFQGQJQEQIQALEAAYEYIYGCBIHIDQCQEYFBJIHBDJCRCIETFYFQAaIAHAHJFIECCYDYBYJYGSHIIIAIEACBDYFRARAIEJFCDICRFYAYEYHYIYGCBIJIAQAYDIDBCJARDYCBAI', 'GKIBVCFBYBhBBCZDbEqGCIDQIIEIDIASFYGYEAJYCYBBHIEIDIAIGIFSJYECHYBRCIEIJIFCAYDYGYHYESCYBBEIHIDIAIGIFSJYCYBYECHICSJIFCAYDYGYCYCQHYESBIGIJIFIADDYDBCZGRFRAIDBCBGYCQHYEYIYBSJIAIFBCIDSFYAYJYBCEIHICIASIIGIJYBYECHICIAIDIFSJYCCAIAA',
  'GKJDrDIBdBhBYCEFBGRGaHAICADQEAFABaJQGQHJCIFBEYIQCQHZGAIJCRAYCACIEIEAFRAYCACIEIEAIZGQHJAAAIEYCYFBIYGYDCJIIQCQEQAQFQHaGAJABLIQEQIIFRAYAQCAJYDRGICICAAJEBEYAYCQHIEAFAIYBYDQJYGQHJEJFBEYJYCRAIAACABAEQHZGADAIKJQEQAYFQHYCBBABYBA', 'GKZBVCFBKBDDLDTDIEAGaIAYBQJYBYCTFIGIDIHIABJYDSFYGYCDBICQDIJIASHYFYGYCYBCDICSFIGIHIACJYCYGQGICBDZGRBREIFICBDBGYBQDQFQFYBBGIDQFQCQCIEYBAFIDCFQBQCQJIASHYAADYEQIKDAHAJAGbFQFZCRCIFIGIAQJIHRDZEZEAJAFAGJAJHRJYBYCCFIGIAIHIDTJYAC', 'GLACMCLBZBlBFCYCDDaEBFqGFQHIKYBRCIJIAIGCDYIYKYBYEYFRCIECBIIIDIKIGSAYJYEYCYHYFCBIIIDIKIGIASJYDCIYCRDQEIDIJIACGYIYCYKYBYFSEIBBEAFAKJBQIQJQHZDADICCBYDSCICQHJJAIAKZFQEQHIBBIIKIGIASJYBYCYDBHYEAFAIIKIBSJIACGYBYIYDRCIKYFQEQHIJIAI', 'GLIBTCUBVBYCMDpDZEBFDGrGBAKAGKHQGYIQJaFAFYDBCIBIIIAIEBHYKYCRDRFIJIEAHAGaKQBQFQIQFZDBDYCDBIIIHIKIGIESAYAAEAFYHAGAKaIQDQDYCYBBCQIIDSFIHIJIAIARFZFAAAEAGYHADADYIYBSCIHIAIJIAADADYASHYCYJYBCIIAIAQGIEQFQHQFJDBDYFYHYACIYBSCIAICABA',
  'GLNBYCLBaBbBMCEDkEAGpGIHDYEYCRIIKIBCDYEYCYJYHYASFIHAJJDQBQEQIYGYFAAAJICQKIBIDCEYCYHYAYJYFSGIIIDAEBCYBRKYABAIHIKIBBCIERDRIYGYAAFAJICICAEIDRBYJYFQAQKYAYEAFCHICIEIDIBRDAJYHQAQFQGIKYCCAYAQCQCIGYFAHAJJDQEQKIBBDYEYAYHYJYFSCIKIBI', 'GLQBFCKBLBaBRCoDAECGrGbHDICIEBJYKYBSDICIEIIIHIABFYHQIZCADABAJIGIFQAQIYEAKYBYDSCIEIHIAIIIFCGYJYDQCREIBBKIARAYHYKYBREYCBDBJIGIAQFQIYEYCYDBBIEQIIFAAAKIAICQFSHYEYCYDYBBDQIIHAAAFAGYKIESAIAAEAEYGIFQHQIZCADAKYBRDICIAIHIIIFCEYKYBY', 'GLSGhGABBBNCEDaDCEQEkEpGBYGIKYJYERAIIICRDYHYAAEAGAJAKKBQCQIQHQFaAADQEAGAJAKABKIQHQFQAaGAFJHAIABaKQJQFQGQAKHAFZJAKABKIQFQHQAaGAJAFJIABaKQFQJQGQAKDACAHAIABAKaFQBKCQDQIQHQAaEAGAJABAFAKKCQIQBaERGIJQGQAKDAHABACAIAKaEQFQJQGQAQBI', 'GLZDLGABjBkBgDBEDGQGoGTHAYEIDIFJAQIQCQGQHaBAJIKAIKAAAICSAYFYGYIYKYECDIDAJJFQIQIYDYAJERGQKIHQBaKAAAAJGJCBGYIYDYDAIJCRGYDYAYAQKQBKHADAGAAaIAFAFJJZEQIIAIAQCAJYFQAJDRGICBDZAZAAFAFZJJDQAYIYEAJIFQIQAKDAAZFYJYEQKQBQHKGAAADICRGYBY',
  'GLcCpDaBgBICRCbCADCDKEEFAIGICICQJQIQHJEADAFBDIESFYDCJYJQIQIYCCBIJIEIFSDYFAHYCAIIEBBZEQJQIQCQCYKYACGIIIJIBIFQDQHYCAEIDIDRFBBYEQCQCYECIYJYGYASKIEICIDBHIFAIZJABJIRJZCRCIDIJIFRHYDAFAJAIABZCQCYESKYACGIEICICABJIQJQDQDYKYAYGCEIAS', 'GLlBCGNBSBRCADoDLEIGbGiHCAEYDYDQJYABKIGIEQIQFQBZHAIJEAGYKYARCRHIBIFJDBEBGBKZAZCRAIJIGIKIESDYFYIYHQBJFAIAGAGIJZHQIJFQBaIAHAFIDIJJDQFZGADIFQGZDADIFIFQGIGQBQIaDAHAJAFKGQFYJaDQHQIKBAJAGAFZDQHQJKBQIaJADAHAFKGQBQIQJaDAHABKGAFaAA', 'GLpDKGFCYCDDcDkDsDIEAGZHBQEQJJIADAAYHZGQFQCQJIIIDBKYFYFAGAGYCRBIEIHIIQJZEABACAFAGAHAALKQIQBZCAHIKIDSBYJYEYEQJKBADBIAGZFQEQKYHYCQJQBKIAEZFAHAKIDRIYBYDAJYCBHIHQGKKAAbHQHZGRCRBIJIIIDBKIABHZHAGbKQAKDQEQFZAAEJFQIQBaJAAAEAFJIQAZ', 'GLrDBGQCRCdCbDpDEEJGTGiGBYCQFYIYJYEAAIGIDQHYJZHQBKIAJACADAGZAZEQHIFAKAAAGKDQFYHYEBGIAQEQKQHQBQIKJABaHAKAAAGZEQHIFIDAGZAQKQFQFIHYEBAJGJCQDQBQJQIaHAFAKAAAAZERAIFIBIHIIIJICCDYGYAQKQBQBIFaEAAIFJGIDICSDAFYGYAYEQHQIJJYJACBDAKZAA',
  'GMNBCCQBRBDCMCdCIDaDgEiGqGHACADAIZBQEQHLBADAIICQDYBYEAEYFYAYFAGBIJKILIJIJALaKQIQIIJIBRDICBBYJYIYIAKALKJQDRCIBBJYESCIDBEAJALaKQIQIIFRCIEBJIBRDYEYCYCQHZAAFAIYGQAIFICICQHIEIDIBBDQJYIYEQFQHZAZFBGBIJCQAQEQFQGQHKAAAYCCDAEIASDIAABI', 'GMNBRCKCLCUCYCdCDDIDiDAGpGEQAYFAGCEIJIAQCQLYJQDQHQKJIAHaCADAJAJYLJAQBQFQHQIQKZDADICIHIIIKIFCBYHQJYCQIILYAQDQKIFIBCHYJYCYLYAYABLJDQIICAJQHQBQFQKZIADALAJKHQHIBRLYDQIQKJFAFYCYAYIYDAKYLICQIYDYGYGQKJEBIACAJILYJAHKLQAQCQDQIQIICBAY', 'GMYBbCdBcCQDhDAGDGIGLGTGoGEIEQKaBADALKAQFQEQKQIQJaBADAEJFALZCQDIBIIIJIKIACKYLYEQFJKQAQIQJQGQGIHaAABADACAIYFAEALKKQEaFQEIIJARGYJYBYDYCCIICQEAFZLAKKAQFQEQIaBQDQHKGAJAIAAAEAFYKYLZCSDIBIEIIIJIABLIFBKZLZCZBRDRIJJJAJFBEZAQFQJaIAAI', 'GMdCYFABEBDCFCUCJDQDaDiDrDHAIIIABALaGQDQKQJQEQHJIAEYDYGBJIEQIQHZDAGAJAKIKALKBQCQEQHYIQDYGYFYACJIKIGRDIHICAIABAEALaKQKZJRARFRDJHJIJCJBBLBKZEQCQLQBQHaCAEAIAJZAQDQFQDYACFIJIDREQCQIYAYFCDIARIIAAJIGQCIECGYCSAYDYDBFRIIAACACIGIESAY',
  'GNYBsDIBLBdBCCECFCJCADaGiGpGIQMYBYEQKIFQJJCACIACIYCSAIAQJZDAFAKYEABIMIIQAYCBKYLYGRDIFICIAIJIICKYLYFRDYGBEYMYBYHSGIECFIKIDQJIAALIIRAYCYDYJYEYEQFBJIKILICRAIIBCYASDYEYJYFYGYHCKILIERDIABEYKYLYHSGIFIDIAIDAEBKYLYFRDIAIEIJIIICCKYLYAR', 'GLBDcDbBiBACSDgEEFJGYGrGBQFYHQAKIACBFAJIEQIYCAJADADIGIERGAJYCQKZBQHQAQIKFAJAEAKYDQCQJIEBGYCYCQJQFQIZAAFKJACACIGIERJYCADAIYKIEQJQIQAbFAFZHBDJCRIIJIEBKYBYDQHQFJAJEAGYCYBAKJGQEQAZFZHABADAKICQBZDZHRFJFQALEAIAJABACAGAKaHQBKJQFaAQ', 'GLFCAFECYCdCKDSDhDjDrDaGFAGAHQIZKYCRFIGIBIDCHYIYJYKYCYEYEAJJHJIQKQBQDQFaGACAGYEBJBHJHAILKIKQHbJQJZARERGJGQFLBADAHAHIDSBYFZGAAAEAJJKAIaJQAQEQGQFJBIDCFYIYJZEQKYCQGYABEICIHIJIIIKIDSBYFYGYHAKAIAJZCQAYECCIASFIGIHIBIDCKYAYCYESHIAA', 'GLIBlBFBhBYCaDUERGiGqGCHAAFYHYGYKYCYBDGIFIDAHIEAIIJZIQFQGQBQHIDAFYGYBRCIHIDIKIAIAREBFYDQHYKYCYBCGIHIDAFJAQAYDYDQFAHZGAIAJKAQDQDIAIESFYHYGYBRCIKYGBFJHJABDYFYIYJYBRCRGIKIECDYARHYCYBBIIJIAIDIESFYHYCYKYCBFJAADAHJEAHYJaIQFQBYFIAI',
  'GLIBlBVBYBcBhBiDAGDGqGJICABADQEBGIEQJIFIDIASKYEYCYCQIQHKKAAADAFAJaBQCIEIGQFIFAGAGYJJAQDQKQHaIACABAEABYFAJICREIFIKIACDYAQGYGQKQHQIaFAFYBCKIAIAQDBGYJYCQEQBIFIHIDAAYKYFSBYBQIKEACAJIGIAQDQHYHAKAGAGIAIDRJYCQEQKYBYBQIQFAGIHKKAAAAI', 'GLJBVBiBICEDZDgEBGLGSGjHFJHYEYIYBBJICBGIDRAYCYCAFZJQBQIQEQHKAACACIAIDCFYGYJYKYBSEIIIJIFIFAJaIQFKAQCQHZEAFAIAJKAQCQFaEQHJFAAACAJaIQEQHQFKAACAEaIAJKEQAQCQFaDQHAIAJABAEJAQCQFQHaIAJABAKIGIDRFYJYBAEICIAIFQJZCACIAIFIFQJQHQIaCACYBY', 'GLQBdCKBaBbBJCBDgEDGqGLHEIDICRGYIYKYBCEIDICIJIHIARFYHAJZDQEQBQIIGIFAAAJYCQKYBYECDICIHIAIJIFSGYIYEADBCIBRKIABAYHYKYBBCYDRERIIGIAAFAJYCYCADYERBIJIFQAQKIAIDAFCHYCYDYEYBREAJIHQAQFQGYKICCAIAQCQCYGIFAHAJZDQEQKYBBEIDIAIHIJIFSCYKYBY', 'GLQDCGFBSBYCpDAEUEkEKGhGHYCRBIJIDBAIAQDQGQBaJACAHAIAFKKQAQIYCRHIDIGIGQBQEAJaDAHACAIAFAKJAQFaCQIQDQHQJKBAGAFAAAKaIQFJGQBQJaDAHAFAIAKKAQGQFZDQHQJKBAFAGAAAKaCQIQDQHQFKBQDAJaFAHACAIAKKAQEQGQBQJQFbDAHABKEAGAAAKaCQIQBQDQHQFLJAGAAA',
  'GLTBQCADEDIDMDpDCEREUFhGBQGKKQAQIQEQEJCRHZEBFZAACIJAGAKJIQCQHQEZFAAACIHIBBIYGZJQDQFJEJBAIAKaJQDQFQEJAAHADaJADIKKIQCZDQAQHQEaFAJAGJDQAQCIBQEYFZJAGADJIIBRHYFQAQEJHABACACIIAKaDQGQJQEJFACAAAIAGaARIIJQCJIAAAKIBQHQFZEZCAJADAKJGQAZ', 'GLUBYCDBRBhBiBACFCBESEjHABJIFBKYHSAICIIIDBFYJYCRIIDIFBEBKYCRJIDRIYAYHCCIKIERDYJYARIIFIDBEBKYCYHSIIFIDIEBJYFRIYHCCIARFIJIERDYIYFBABCYHSFIABJIEIDRIYAYFYHCCIKIDREYJYFRAIIIEBDBKYFRARIIEIDBJYAYFBCYHSIIABJIDREYAYIYHCCIFRJIAREIDBAY', 'GLUDqDCBLBYCaDAEcFDGQGhGAAFYHABJKQDRFQJIEAKYDQJQCQCIGIEBGQIZAAHABAJYDAKKFQJQEQIYCADAJIERGYDYDAJAFAKZBQFKJQDQDIGIEBJYDQCQIIEAJAKYKABbFQFZHRCJDBJIEQIYAYCAHAFJBJKIERGYDYAQIJGAEABZFZHQAQCQIIDAAZCZHBFJFABLEQKQJQAQDQGQIaHAAKJAFaAQ', 'GLYBUDFBcBlBDCiDoDZGqGAIEAGYJIHIAQIYFRCZBBDBDIFIFAIIAACQBYDAEAJAHKGQGYJZEQDQBICAHZFRDYEBFIHIGIAQIYJIDQDYEYFBJIGAHZJQDQCQBYFADJGJGAHAHJJZDQGIIIAAJYHQIQGaCQDADYFSEIBQDABABICBDYEYERBRCJDBBYCYFCEIBQHIJIAQGYBYCSFYECCIBICAGIIJGQBa',
  'GLYCEDDCBDpDMEREIGbGjGrGAAEAKaJQIQCQFQBQDKHAAAGAEAIaFQBQDQHKAAGAEAIAKAJaCRFQBQEKCBGQHZDAEABAFAJKCQKQIQGQEaDQHJEAGAIAKAJaCQFQBQDQHQEKGADaBACAFAJKKQIQDQGQEaAQHABACAFAIKDQGQEQHaBACAFAIADKKAJaDQIQCQFQBQHKAAEAGAKAIaCRFQBQHQEKGABa', 'GMIBECjBFCYCZCaCADCDbDJEkEJICCJYLYDSBICIIIHIKIAIECFYGYJYLYCSKIAIGBLYCYDYBSIIHIGAJYKICCJILIGSAYCYHYIYKYBCDIJILIGIFIESAYCYHYGCJYLYDYBSIIKIGICIAIHIECFYJYLYGSIYKYBCDIGIJILIFIESAYCYHYIYKYBYDCGIBSIIHIKICIAIECFYJYLYBYGYDSIIKICIAICABA', 'GMrDCGgBFCICLCMCZCaCADRDjGKAHAIAAZLQDRBIFQGQJIEAKKJQBZKAJKFAHAIAAAAILZCADQGQJQKQBJHACIESHYIAIYBYFYJYKYDCGIAIFQJQKYLICQIQBYDYGCAIJIFILICICBLZAQIQJQKYFAJZABJJFQKIIALJCRCYFYAYJYLYGSDIAABIIACAKIFAJYLYGYDSAIBIKIFIIIIQBZCBJYFQKAAAAY', 'GNRDqGBBMBACFCTCYCZCKDcDkDCGBIIIHIESCYCQJYMZDAGBKYLYFRDIGIAIJICIMIECHYIYKYGQLYMICAIABZFQDQGRDYFCGIBIDRAIIQCQJICIICBYKYLYDYGYFSAIJIDBKIIQMYJAAAFAGABJLQIQKQCQDQAaJQMJAAIAJZFAGAKYBALKKQCQKIIRJYDAJQAQMZFAGABALAKJCQBYKYLYFSGIDIDAJJAQ',
  'GNlBIECBSBYBZBkBADiDUEDGLGoGJYABGIIIDQCQMJEQFQBQHQKaLAAAGAMIDQCQHKBACADAEAFAMaGQAQIQJQHQLQKKBACAHaCQJAIAMJEQFQHQBQKaLAAAGAJAMIDQHKDAEAFAMaGQHIIQDICRBIEBFYCYDYHYGAIAMKCQDQFQHaDAJQMYGQAQLQKKBAEAHACAFAMZIQJQHKBQEQKaLAHAHIBICBDYJYAY', 'GNqDIEDBUBVBhBSDYDaDiDEEkEAGFYAYJYLYERDIGIBIIIHIFCAYHYIYJYLYEYDRGICQGQKQMKBAFAHAIZCQCYGYKYDCEIGILICRIJHQBQFQMaDAKAGAGYEBIIHILICIAIJIFSBYGYHYIYEYDRKIGAIAHJBQGZKYDBEIGIHIIIBIFCAYJYCYLYERDRKIMIFABYCBLYEYDRHIIICICALAAJJQBQFQMYCALAAA', 'GJqDDGNBlBcCLDTDZHAIAZDAHYEYDYCSFIGIEBAKHQIQBaEAFAGADADIABCZDRAIAACIESAYFYGYDDAIAQGQGIEBCYARGREICCAYGYCQDTEIFQBKIAHAAaGQGYDYDBERFIGIGAAKHQIQBaCBDYFQCJDBCYFYFQCQDQBKEBIAHAAaGQFQFIGYFQHJABGZGAFbERHQAKIQBaCADAAAAIDRCYABDICRAY', 'GLABdCNBQBLDTDjDrDJFBGgHGAJJIAGZHBKJDRDIATGYHYIYJYCAFIHAGKIQJZEAHAHIIIFYCQEIJIADDYDBKZGRFRHRCZERJJEAIAHZCQEYBBFIGICRHJHAIQJZBAFAFYBREIJJIAFZCAGYBQHICBGBKJDRDIATFYIYCYEYHYBBCAKIDIDBAJFRIRCZDBDYJYACJIKYBREIHIAIDIDRCJIBFBKZGRARAI',
  'GLABoGTBYBMCEDrDZEQGjGBHEICICAGIBIDQIIARKYFYEAJAGABJHQJZEQFIKIABDBHYBYGZCRERFRKJAJDBAYIYFYKYECCIGIJIHABZGQJQFQFYIJHAJZGABKJQHQGYCYIZCAGJFQCYGAFJCQCYFYGYGAFABAJKCQHQIQGaFAGIIKCAHAJaBQIQFQGJCAHAIaBAJKIQCQHQGaFABAJAIKCQHQBaFQGKAQ', 'GLEChEFBIBJBADYDCESEcErGBYCQIQHQFJDAEAGABAKaJQAQFJHAIAJYCSAIIIBIGIDSEYDAHYFYAACAIAJAKKBQBYJYCYKYASIIGIDIERHYFYIAGJFRIZGBABCBJIKIBIERDYBAKZARCIFIBAKIEIDRBYFYCYJYCRGRIJHJBBDBEYFYGYAAJYKIJQFQFIDIEBJYFQKYAQGIHRBJDBEBHZBRIZGBCBCIBI', 'GLFBYCLBaBbBMCDDkEAGpGIHARDYEYCRGIIIKIBCDYEYCYJYHYARFIHAJJDQBQEQIYGYFAAAJICQKIBIDCEYCYHYAYJYFSGIIIDAEBCYBRKYABAIHIKIBBCIERDRIYGYAAFAJICICAEIDRBYJYFQAQKYAYEAFCHICIEIDIBRDAJYHQAQFQGIKYCCAYAQCQCIGYFAHAJJDQEQKIBBDYEYAYHYJYFSCIKIBI', 'GLSBoGFBVBADbDLECGIGgGjHAZFZGQIJAAFYGYDYCRHIEIIIEQHaIAEKGAGYDYDAFKAQGQHQIaEACAFIDQHJIIABGYDYFYFAHYKABKJQDQGQAQIYEYCAFIHQEQEZIJAAHYFYFAHKDAGAJABaKQHQCQFQEJIIDBGIARDZGBFZEQFQGQIZCAEIGIIIDIABFYFAHaKABKJQHQFQFIARDYGYEYEAKABAJKHQBa',
  'GLTBDGQBgBRDsDZELGjGpGAHAJEJGAIZAQEIGICIDBIYJYFYFAJKIQFaGQGICICQEaAAGAJAIKFQDQEYCAIYJZARGICIEIEQJIKQBaHACAGAAAIIFIDQEYJAFAFJIZAQJIEIEQJaCQGQHQBKKAJADAEAFZIYCRGYABCJGREJEAFAGAIJDQFYGYIYCYAREIEQJKKQBaHAJAEAEYABCIGIFIFQKQBQHaJABK', 'GLdCoDABNBECaCSDrDbEQFJGDAAAHIKAGAFABJGYJQCQKYEYDYABIIERKICAJABZHZIQAQDRGJKJCJJBBBHZBQFQCQJQKaGADAEAIYARDIEICICQFBIYERDYACEIIIDQFRGQGYDBCIGQDYCBGIGQCQDQDYCYAYECGIIIFIDSCYDAFCGYIYESAIFICIDBGYIYFSAYECFIGIIIDSCYAYEYFCGIIIASCIDCAY', 'GMMDSFABUBgBhBQDYDkDqDsDBHAADADIIAKAJJBQGKHAHICRLYAYDAGAIAIYDRAIGILICBHYHQIaBAJZKQBIDQHIIIEBFYJYJAKaBQGQGYDBBIHIJIKIFIFAKZEQIYGYJQHQGQIKEAFAHZGQFIEICRLYAYDAIABAFIJJGQHJCQEQLQAaIAAIFAHAGAJZBQFILICCEYEAGZHQLQAQAICIEBIYFABAJJHQLYBY', 'GMTCYCVBZBlBSCcCQDqDEEAGJGIYAQLYJYJQKKLAHABAIYFQJYGBEYCRGIJIHIHQLQKaJAEBCYGRJIACCYAQERJQKKLAHAHYFBCYARJYGBEIAICICAIJDQFQHIBADYFYCYCAIYAYEYEAGRJIHIAAFAIJDJBRFRHZAABACADAFAIaDQDICSAYDCCICAIKARFQHIHQLQKaJAGAIICQDQKILIBBFYAYCYDRHJAA',
  'GMpDKGUBACJCNCCDEDjDSEgGrGEAIIKIDSEYBYCAGYHYFAIAJYIYKJJQBQGQGIHZCABIHIEIDCAYJYKYLYFSCICQHJGABAIAKALAAKJQKZIQBQGQHZCACYFCIIKILIJIDSEYBYCQGYHIGABAKAJAAZIYLQFRIQCQBJGQHZBAGKKACYJAAALZFQGQKJJAAAIZCQCICQAJGYJQKZFBCIIJJQGZAAIACYFRAIAA', 'GNDBgBbBICNCADEDTDhDkDsDJFpGFIDABAMYCQHQAQAIGYEAHICCHYJYERMIBQDQFYGYAAAICICAHAJAIJLQGQGYCYFIDABAMYKYEQHICQFJGALAIZJQCQFQGJLAIAJZCQCIHYEAIIJIBIKIMIDSLYFYGYAYEBCIHYASFIGIHILIDCBYIYJYAYCYMYKYESFIGIHIACHYEAIIJIBIKIMIDSLYAYFYGYEBCIIIAR', 'GNdBaCYBcBjBFCLCZCDDsDAGIGQGDBAYFRIIGAEAJYFQDIABEIGRIYDAFAJIGQLIMICBHYBYGYEYARJYFQDQDYFCAIAQDRFQIIKILIMICIHCBYGYEYDYJYAYAAFRJIEQLIMICIGBEYJYAQCRLYMYFBAIDICIJIEIEAGRJYLYMYDBAYFRDIACCIEIJIGIBIHSLYMYAYCBEIARLIMIHCBYGYAYAQEYCRLIMIGBAY', 'GNiBEDLBMBACYCZCaDcDjDJEBGrGDICIKIGBAYJYIQCQDQBQLJGAAALYMZIQJJHQKQBZCADBJAIAMJAQGQLYCAJAIAHJKQJZCQLIGAAAMZHQIQCQDRBJJAKAIZHAMJAQGQLYBAJJKAIAHZCQDQJQBQLJGAAAMZCQDQIJKQBZJAIACADAMJAQGQLZJABJKAHAAIGRKYBYIYDBCIHIAAHQIQBQMYCQDQJQLJKAAA',
  'GKQCEEABTBBCKCCDhEUFrGAQCQDQEQGZFAFIEICIGIACHYHAJaDQFQIQBQGKCAEAFADADYFSEIDCHIARCYDYEYFCHIDSCIABDYHYFSEICIAIDCHYCSEYFCCIHIDSAYEYFYCCHIDIJIASEYDCHYCSFIDIEIACHYDSFYCCDICQHIASEYFYCYGZBADBHIIAJJAIESFYACHYDRCIJZIQBQGJAIFIECHYDYCRAI', 'GLkDAGDDQDYDgDiDpDKFMFrGCIDAEAFAHYHAKaAQJQCQBKDAEAFAHAGZIQCZJAAAKKGQHQFQEQCZIAHJFQEQCQDQBaJAAAHJFJGAKaHQAQJQBKDACAEAGAFZAZHAKKFQAZIQCJEAGAAAFAKaHQJQCJEJDQBaCAJAHAKKFQAQGQDQEZIAHZJQCQBKEADAGAAAHZIQDJEQBaCADJEJGAAAHAFAKaJQDQEJGJAA', 'GLlBACCBSBbBgBBCcDhDpGDIFAJYEQEIIIFIJIBSGYCYDBHZAAEAJJFQCRDYKYACEIEAHIIJFIFAJZCQIQHQHIFICIDSGIBCDYCYDQFYHYHAIAJJCQFQHaFAFICIDIHIBSGYKYAYEBIBFJHJCADAHQJZFQIQIYFBHIHQIQAREYFBAIIAHAHYARFREIKIDCCYCAHZAYIYAAJJFQHQIQIYAYFYESKICICBIBAZ', 'GMAGrGSBVBYCDDLDQDTEhEIGjGDBIICIHIEAJABaLQCQIQDQFIAIGQKJEBJYCYIYDRGIKYGAHKKQGaHAHYDBIICIJIERAYEAFYDAKJJABALaCQIQKQDQFIAIEAHQGJJAKaCAIALKBQKQEQAYFYDAJQGZHACAIAKKBALaKQCQIQDQHQFQAKEAGAJABALAKaCQIQBKEQGYAYDAJQFZHABACAIAKKLQEQJQFQHaAQ',
  'GMCBdCABBBTBUBjBkBhEQGYGDHIYGYERJIKICRDYAYLYBCHIEIGIIICRDRAYLYFBEBGIIICIDRARLYFYEBGBHYBSEIGBJJKIAIDBCYARJZKYHBIIAICIDRJYKYFRGYEYBCIIFRJIKIDBCYAYFYIYBSEIGILIDBCBAYFYIYHRJJKIFBAICRFYJZKYHBIIAICIFRDRLYGYEYBCIIAICIFIDRJYKYABIYBSEIHBAI', 'GMhBUCCBVBlBTCYDAEDGLGQGqGAYGIGQKQCQHQIaJABAFALYEYDRBIFICIHIKIACGYKYLYEYEALJFQGQKQAQHQIQJaBACACIIIEAJIABHYEYFYCSBYDDCIBRCQDRIJJJEBHIAREZIZJZDBDYCDBIFIHIAIKILIGIETAYABEBGYHYKYFYBYLYCTDIDRIJJJAJEBHYARIZJZDBDYCDBIFIAIAQHIERIYJYDYFBAI', 'GMlBACDBSBYBjBkBBEEEhETGbGDYEQKYLYABGIFIJIEIBSHYCYIYABKILICRHIBCEYDRCYKYLYARIIHICBDBEIBSCYDBKZLYAYGBFIARKJLIEBJYAYFYGRKILIEIDRCIBCJYERKYLYGBFIAIEIJIBSCYHYIYGBFBAIEIJIDRKZLYEBAYFREIKJLIDBJYAYFYERGRIIHICIBCJYAYFYEYGRKILIABJIBSCYDBAY', 'GMlBgGBBMBCCDCICNCEDZDbEqGCQGAJYEQLZKQFQIaFAHAAAKALKBQJQGQIYEAKYDRHYACDIDAKIJIJABALaKQKIFSHYAYARDBAIHIFCKYKALKBQJQJYKYHRDYABHIKIJIJABALaKQDRAYHBKIFSAYDBFAKALKBQJQJYERAYFBKYHRDIFIAIAQIJCAEAJIGQCYEYAYAQIYFYDYDQHBKIJIEQFQIJCJEBGBJZAQ',
  'GNABMCBBNBSBTBEDkDoDCEQEhGrGLYHYMYDSBIFIEIKIARCYJYEBFYBYDCHILIMIIIARCRJYEYFBKICIABIYLYHYMYDSBIKIERFYGYBADAKAHALJMIIIARCYEYFRJICBABIYLZHQKQMYDQBQGIJIEBAICREYJYGYBADAKAHALJMIIICRERJYFBAIEICBIYLZHQKQMYDQBQGIFIABKYBYDCHILIMIIICREYKYFRAI', 'GNADpGIBJBdBSDYDgDsDCEMEaGiGBYIYKAFJJQAJCADAGAHAMZIABKMQIaLQHKGQCQDQAZHYJAHALAIKGQGICRDYHYFYEAIIGICIDRHYHACAGYIYEQFIJQAJHACADBLZIAGJLQCQDQHQAZIYJAIAGALJCQDQIZJQAJHAIACADALZGQJQAQHJIAAZJAGALJCQDQAQIQHZJAAJCADALZGQAQAIJQHJIACADALAGaAQ', 'GNMDhGRBUBVBQCADIDkDoDCESEqGAADAEAIABJMIJIJAMaBQJKLQKQGJHACALYIYJYERDIKICIHQGZCAAYDAEALAJZBAMKFQJQLQCQHQGQAaCAKAHKFALAJAMaBQJKLQHZIAJYJABAMKFQLQHQIaCQKQAKCAGAIAHAHYJZCQAYKQDYEBKICICQAQGJIAAZCACYKYERDIGICAHIKAJJHQAQCQIQGaCAKAAKHAJZAQ', 'GNRDoDABQBcBdBBDgDEEiEJGTGZGEQFQMJAQLZIQGKKALAAAMZIQLJAAMAJABJHQDQJYMYIYFBEIBIHIDQIQMJCRAYKYGYLYFBMIEABIHIJADICRJYIYMYEABAHJIQMQLQGQKJAAGaLAMAIAHZBQEQIIMIJICBDYHYBYEQJQMZFRKIAILIGICBMYIABAHJJQMQCQGQAQKaLAFAIAMKCQGQAQKQLaFAIAAKGAMZAQ',
  'GNbBIDLBcBCCADMDQDDGYGgGoGrGDADIAIAAKKJQEQHQBQFQIaGAAADAKAJKEQHQBQFQIQGbAACADAKAJAMALKEQHQBQFQKaAQCQGKIAKAEAFABAHALaMQJQAQCQDRKKIQGaKAGIIKEAFABAHAJaAQCQDQIQKQGKEAFABAHAJALAMaAQCQDQJKEQHQBQFQGbEAKAIAJAHLBQEQFQGQKaIAJACBHAAADAMKLQBQBJ', 'GNoDCEABBBSBlBTCUCQDYDhDEEqGFBKYMIERIIJICRDYBYLYFBHIGIIIJICIDRBYLYGBJIJQIQIIEBAIKIDRCYEYIYIAJAJYGRKILIBICBDBAYAAMaGQHQIJJAKAAJEQJYIYMIDRCRBYLYFYHCGIAIKIEIMIDIDAMZAQCQKQIQJJDAEAKZAAMJCQDYEYIYJYFRLIBIDBCBKYAYKQCQEQJZIAAAMAKKCQEQJQIZAA', 'GJDHhHdBgBUCYDsDIESEAYCCEIHAFAIIFIDBBYGYEQCQIQFJDJHRAZFBCZECCIIIDIDAIYESCIFIDAIAIYCYCRFRDJAJHBIZCYCACYFYDQGBBJIRHRAZFBDZECBICRGIDQDYFRAJHBDZCBIIDRCZIBBZGRFQFIFQIJCJHRAZIBFAFYFAGBBJCRHIDBCZHRFZGaIRAJDBCBHYBYESAIFBGBIZAQFKGAIABA', 'GKABjBBBVCKDbDsDEEoGQIEAFABABIGYDQFIJIASCYCQEZHZFBBBBIJIAICRERHZJAGAIJAQCQEQHQFbJAEKAACAIZGQEQJQFLHAAACAEaGAIJEQAQCQHQFbJAGAIAEKAQCQGaJQFLHAGAAACAEaIQJQHJGBCBAYJYBYBRFRHJGJCAAAGYJAEAEJARAICTJYFYHYDCBIBQFQFIHQGJJAAACAEAIZBZFREJAI',
  'GKBBTBCBcBACdCRDMEDGYIBRDQHYFBDIBIJIESAYCYGYHYBCDYFRBIHICIAIGIECJYDYFYBSHIDCJIESAYCYGYDYDAHYBCFIGIJIEIATCYCRDZGBEBAICRDRGYDAHYBYIYFCJIAIERDICCEYAYJYFSBIHIDIACIIGIJYFYBSHIDIAICIECJYDSHYBCFIDIJIESCYAYHYBYFBDIBSHIAICIECJYBYDYFRHIBC', 'GKFBYCIBVBlBMCjDZEqGBICABAFAGAIZEZDRDYATFIGIEAJICIBBHYEYDYAYGYFSJIECHIBRCYEYJYFCAIDIGIHIESCIBBEYHYDYAYGYFSJICIBIECHYCSJYFCAIDIGICICQHIESBYGYJYFYADDIDBCJGRFRAYDBCBGICQHIEIIIBSJYAYFBCYDSFIAIJIBCEYHYCYASIYGYJIBIECHYCYAYDYFSJICCAYAA', 'GKgBMCFBVBkDpDrDAECGRIABFYGYEQDQCQIIHIABJYBYCYDBEBGJGAFLBRJQHQIZCADAEAEYDRCIEABADYCRIJHAJAFbGQGZCRDIBIJIASHYEYBACYDRBIEICBDYHIACJYCYDBGJGAFLJQAQHQIaEACAJIASHYAACYEQIKCAHAJAFbGQGZDRDIGIFIAQJIHRCZEZEAJAFAFJAJHRJYBYDCFIGIAIHICTJYAC', 'GKgBMCFBVBkDqDsDAECGRIABFZGZEQDQCQIIHIABJYBYCYDBEBGJGAFLBRJQHQIZCADAEAEYDRCIEABADYCRIJHAJAFbGQGZCRDIBIJIASHYEYBACYDRBIEICBDYHIACJYCYDBGJGAFLJQAQHQIaEACAJIASHYAACYEQIKCAHAJAFbGQGZDRDIGIFIAQJIHRCZEZEAJAFAFJAJHRJYBYDCFIGIAIHICTJYAC',
  'GLFCICRBgBhBdCADqDbECGKHHIEICRBIDCCYEYHYIYFYASJIGIDACBEYBRKIGRDJCBCIEDBYBAHZIQGQDQGICSEIBBCYESDYJZKYACFIGIIIEIDRHIKYAYFCGIIIEIDICIBSKYEBGYIYFSAIEIKIBCCYDYGYHYIYESAYGIFCEIIIDICIHIBSJYKYAYFYEDGIIIASJIKIBCCYDYHYAYGYIYETFIJIKIBICCDYBR', 'GLNCQEgBkBlBSDiDDGaGpGAHFIFAGYIADADYEYAREAIIBICBGYJIGQBQCQIaABDAEAJIJAGLBQCQIQKQHaAAFADAEAIKBAGaCAJQIQAQDQEQFQHKKABAGAJaIQGKBQGYKQHaFADAEAGAIAJKBQGZDQEQFQHKKACAGABAJaIQDQEQGJBAJAIaDQEQEIDIGQFQIIJICRBYFYGYAYECDIARFIFAGAGIBICBIYJYAY', 'GLQDDGKBTBZBMCNCYCpDAEjHCRAIDAJIHCEYIYCQAQJQBZFAAJCACYKYGRFIBIDIJICCEIHRCYBYJYDYFYGCKIEIEQAZDQFQGQBJJAAAEAEYIIHQAYDYDQAJHAIYDQAQJQBZFAAIDAJIEBDYKYGRFIBIJIEICICQBZJAAAKAIKHQCYDBIZKYGYFSAIJIEIEAAZFAGAIKKQAQAYDICIHBKYETDIDAEBKIHRCYAB', 'GLTBICBDcDgDkDoDREiEEFJGBAFQDQJQCKKAAAHAEAEJGBIZERDZAQGIJQCQKJHAGAIAEZDQAQGIIIBRHYCZJAFADJEJBQHQKaJAFADAEJAQIQFaJQFIKKHAGZFAAAIAEaDQJQCJFAAAGIBAEYDZJQCQFJHIBBIYDAAAEJIQBQGQGIHQKaFACAJAEJDQGQAQHQCaABHIJAGJHQAQKIBAIADZEZGQJQFQKJCAAZ',
  'GLZBMFCBYBjBkBSDaDAFDGoGFIEIHQGQCQCIIIDCAYAAGYHZEYEAKJHQAQDQGQIQJaBACAEAFAGJKIHIHAKaFQBQGQEQCQJKDAAAHYIAEYGAKJHQAQAIDSIYECGYGAEQKAHKAQDQIQJaBACAGJEQEIIIDCAYAAHaKQEQCQJIDAAAHAHIKZEQEICSIIAIAADSAYIYGYJYBYFDEIEBCJGRHJBQIQJJAAAIDCIYBY', 'GNJBUFDBKBiBjBACBDEDMDaDoDYEBQCQJQIQHKAACADAKAKYFBEILIMIGSAYDYCYFBKYJZBAEALKEQMQJQJYFRCIDIAIKIGCJYMYEYEALZBQFQKKAQCQDQHaCAIAKABALJEQFQJJGQHYDAJAEAFALZBQJJCQDQIZKAJABALJEQDQFQCQIQHJAADYEBMIGRAYDBEYCYFBMIERDRAIGCEYDRARHYIYFBCIAIDBMYCRAI', 'GNQBkDgBRCBDIDMDSDsDUEaEDGpGHAKABZJQGQHJFJABCBDABZKQGZJAIAMJBQBICRARDQFZGAKAIZJQHQGJFJABCBBYDABAMaJQHQGQFJKAHZJAMKBQIZHQKQFZGAJAHJIJBAMaHQIJBJDQMICRAREYFZGZJAIABJKQGQFJEQLaJAGJKABZIQGQJQLKEAFZKABAIZGQBJKQFJEQLaJABAGAIJKQBZGAIAHAMJDQBY', 'GLBBFBdBACRDYDgDoDLFCGiHCAFIKIGIHIDSAYAQEAJZIAFJGBHBKZCRCYBTFIHIIIJIAAGYHAFaIQJJEAHAHYIYGIAQEYJYBDCICBKJFRGRHRAJERJZEAIAHJAQEIDBFYGYARHZHAIQJJDAGAGIDREYJZIAGJAAFIDQHYABFBKZCRCYBTGIIIAIEIHIAADBKYCYCBBZGRIRAJCBCIJIBCJYKIDREYHYBYCYCRAZ',
  'GLFBSBLBMBhDQECGIGbGoGjHAQGIHABAFAIaKAJKEQIQBQFQHQGaAACADAKAIKEAJaIQKQAQCQDQGKHABAFAEAJAIaKQEKBQEYFQHQGaCADAEAKAIKJQBQFQEaBACQDQGKHAEAFAJAIaKQCQDQEKHQGaAAEACADAKAIKJQBQFQHQGQEaCADAHKBAFAJAIaKQHQCQDQEKGABAFAHaCQDQDICIBIBQEQEYAYDBCIAR', 'GLKBQBEBFBADCDIDZFjGrGTHBRGQEQFZAAAIEIFIGIBDGYHYIYJYKYDTCICRAJEJFJBJGBHBIZJZDZCRCYATEIKIBRFYEAKAAACADAJKIQBQKYABCIDIBIIAJaBQDQKQFQEZAAAYCCDIDBBJIJJJHRGREZFZAZCZDBDYBDIIKIASCYCQEJFAGAHAJZIQKQBQCIABDQEJFJGAHAJAAQIaKQBQCQFQEZDACIDICBAJ', 'GLQBdBFBjBkBZDbDhDAEoGCIBAEIDIJIARFYFAGaDADYEYEAJJBQHQDYEYBYCSKIDCFIGIABHAHYJaBQCQEQGKEAEYBYBAJJHQAQEYFYDSFIIIACEYEAHAJZBQBIDIDQGaBACADAJKHQGQGYDYDQFQFIEIARIYKYCCBIBAFIDAJAHLGQGJEREYDYDQAIEBDYGYAQAIEIDBGYGAHbAQFYJQBQBYCSKIIIDBEYFYBY', 'GLSDAGNBQBRBcBlBDEgEaFIGCAFAFIAIJIEIERDJIBEZDRDYJYGYFRAIAQCQHQBKKAIAIIECDYJYAYGYFYCSAIHIGCJIDIESIYIQKQBaGAHAAAAZHRGJBJKJIBDBDYAYJYFYFBCZHRFJCBCIAIJIDIDRIRBZKZGZCBFBAJAQCQFQGQBKKAIAIIECDYJYGSAYIIEIDCJYGYHYFSCIIIGCAYHYFYCSIIIQBQKKGAAA',
  'GLSDpGABJBMBFCYCsDZEBGbHCQEAAIDICIGCBYHYIYKYFSEIAAEQJJDAKAHABJIQCQDYJYEAFABIIIGSDYDQJZAACAKAIABZFQEQAIJIDAGABYHQIJCRIYKYEYERFBHIBIGQDQKIDIGCBYHYFRKIDICBIZDRCIDICRKZEBDICIFBHIBIIIGSJYKYCCDYDAHAHYFREIDICRAYAQJKKAGABYHQCQDQAQAZCBDBIJAR', 'GMABrDFBQBVBcBlBgDBEDESFoGDIARIYJYFCEYGBBIBALKHQHIARDYKYBYEYFRJIIIDBABHYLYGRCRJIEBFYCYGBBILIHIARDRIYEYJYGBCIFIKIDIABHYHALaBQBYCRFIKIESIIABDYEAEYKYFYGRJIIIAIDBEYARIYJYGBFIKIAIEIDRIYABKYFYCBBIBALKHQHIDREYKYBYFYCYGSJIAIIIEBDBHYLYGQCIFIAR', 'GMIBsDhBYCADCDEDKDqDMEcERHIABZKQJQGQFJEJAAAIDCCYCABZIQLQAQHQGZJAKAIJBJCQDQEZFZJAHJGQFQEJAADACABZIZKQHQJQEJFAGALAIABJCQCIDSAYAQFZGALAHaKABJHIIQHQLQGQEZJAKABAIJHQBZKQJQEJGALABAHAIZKQBJLQGQFJAAAIDCCYCAIZHQLQAQGQFQEaJABAKAHJIJCQDQEYFAGABZ', 'GMYBCDBBACEDhDoDqDsDMEcERHBQEZJAKAFKHAGJAQAIDSCYCQEZBALAAAHAFZKQJQBJEJCADAGZIZKQHJFAIAGJAQDQCQEZBZJAHAKAGJIQFQLQBQEJCACIDCAYAAIZFQLQHaJQEJBAHIHALAFAGZKQJQHJBQEZHAJAKAGJFQLQBQEQHZJABJLAFAIJAQAIDSCYCQHZEALAAAFAIAGaKQBQJQEJHJCADAGYIQFQBZ',
  'GNIBNBJBMBdCbDjDrDKEAGDGYGgGMQGaHAMJGQLQAQFZHALJAQCYIYDYBYEBLIMIGIGAMaLQEQHQBQDQKQJKIAFAGAHZBQDQFJIQJaKAFAFIDBGIHIAICRIYDYFYFQKQJKIAAACAHZGQDQIICBAYDYGAHJAQCQDQIQJaKAFAFIIIDBAICRDYIYFYFQKQJKDACAIAAAHZGQAICIDRIYABGAAQHJCQDQIQJaKAFABAFIAI', 'GNNBqGgBhBACJCKCdCBDEDbDiDLECAIIFADABZLIGQLQKQMQIQIIGBDICIJYAAHALIBIESFYCCDYGRCIFIECBYDYFRCYIYLYHQAQJIIAMAKALABJDQEQFQCQIZGBJYAAHABIFIDIERCYDCFYGSDICIIIECFYGYDSCIGBDYBYCRHQAQMYAYHCBIKILICIDIDAGRBYMYCBKYLYHSAICIJIIIMIGCBYDYKYLYCSAYHBCIAS', 'GNYBcFBBNBSBTBACRCEDiDoDqDKGIZDABALJKJAQGQHQCQIZMAEAFAJAKALZBQDQFIEICIHBMIIIGAAALZHQKQJQCQIQMZDAFABAKJJQCQCIHIAIAALAJZKZBQDQFQMJIAAALAJAKZHQEYCBHIJIKILIGSAYAAEYCYGAHBJIKYJQLQCQEQIQLIMZDAFABAJJLQCQHQIIEACYHYBYDSFIFQIIMJEAEIAIGBCYASEYHBAI', 'GNcBACSBVBbBRCYCBDTDpDEEJGrGCQDQIYKQHKLAFAIACAEAJAJIMZAQDQFQIYKQHQLJIAFAHZJYEQKAAADAMJJQCQFQHQIQIILZFAKAHJCAEAJAJIMZAQDQFQHQIYEAKQLJIACAFAHZAADAJYMJJQHQHYERKYDBAIEIHIHAJAJIFRCYKYEBAYDREIABHIJIFICSKYAYEYDBHIJIARKICCFYAYHYJYDREIKIABFICSAY',
  'GNjDDGNBQBiBJCdCSDaDrDgEAGKGHIIIEBKIDRFYEYHYIYMYCYCQGBAIJIKIDIFRMIEAEYMYCADBIIKYAYJYGRCIHIDIMIEIEQFBKYDRHYIYMYCYCQGBAIJIDIKIFRMIEAEYHYIYDBAYJYGRMYCACIDIDAIJKAJZAQIQDQDYCYCQMJHAKAIZAAJJIQAZCQDQMQHKKAAAIAJZCQDQAJKQHaMAAAAICADBJJIQKQHQMZAA', 'GLDDaDBBCCFCcCdCLDTDiEQFCYKQDYAYHYIYFCBIJIKICTDYAYHYIYFYEYGCBIJIFSAIHIIIDICDKYFYBYJYGSEIAIHIIIFCKICTDYFYAYHYIYEYGCBIJIKIFSDICDFYCQKYBYJYGSEIAIHIIIDICIFCKYDSAZHYIYEYGCBIJIDIKIFSCYHYIYDCBYJYGSEIDIHIIICIFCKYBYJYDSHIHAIABABIIICICQAQHZIAAJ', 'GLFBSBEBLBpDQEAGIGbGgGjHAQCQGKHABAFAIaKAEKJQIQBQFQHQGaAACADAKAEAJKIQEbKQAQCQDQGKHABAFAEAIAJaKQELBQEYFQHQGaCADAEAKAJKIQBQFQEaBACQDQGKHAEAFAIAJaKQCQDQEKHQGaAAEACADAKAJKIQBQFQHQGQEaCADAHKBAFAIAJaKQHQCQDQEKGABAFAHaCQCIDIBIBQDQEQEYAYCBDIAR', 'GLSDpDkBACBCYCbCZDhDCEMFCIKAGIBIHIIIESAYJYKYCDGIBIHIIIEIFIDSAYJYECBYHYIYGYCTKIEIAIJIDCFYBYHYIYESKYCDGIEIBIHIIIFIDSAYJYKYECGYCTEICAKIAIJIDCFYBYHYIYGYCYESKIGCBJHIIIFIDSAYJYGYKYECCIHIIIGSAIJIDCFYGYHYIYCYESKIAIJIGCHYIYIQHQAQAYCYCABAIJHQAQ',
  'GMABlBCBFBVBcBQCDDLDoDqGRICYHYIYFCLIGIASCYCQHZIYFYDYEBBBKIJIAQCQIYFYDYEYBBLIFSDYDQHJIACAAAJYFQDQHQIJGBAICRGYACDYDQAQFBJICQFQGQIZHAAIDBFYARHQIJDAFAGACAJYAQFIDSGICCDYCQGRIZHAFAAAJIDQCQIQHZFAFIACLYBSEIFIAIHIIICBDBJYKYBQERFIAIHIIICIDBGYLYAS', 'GMABlBZBaBkBoDqDBEDGLGQGTHCYDYGAFJCQDQKQAQHQIaJALAKKCADAFZGQDICIARHYDBGADQFJAQCQHQIQJaLAKABAEAFJGQDQDIHIABCYGYFYBQHQKZEAEIDIHIKIAIAQCBGYFYKYDABYERDIKIAABAFIGICRAYHYBYKYDYDQKJEAFIGIHACIARHYBYBAGAFZDQEQKQLQJKIAHAAACAFZGQBQHIABCYBYGAFJCQAQ', 'GMKCNCABMBQBDCJCBDbDgEjGqGBAIIFQHJAAGALIJIJALaKQIQBQHIFAJIGRCIEBGYJYIYIAKALKJQCREIGBJYASEIAACBJALaKQIQIIFREIABJIGRCYAYEYEQHZDAFAIYBQDIFIEIEQHIAICICQGBJYIYAQFQHZDZBBFBIJAQBQEQDQFQHKDADYECAIDSEYEQHaABFAIYIAKALKJQGQHYEADAKYLYBRFIAIEIDBIZAQ', 'GMgDCGBBFBKBdCLDQDUDYDoDaICYIYDQBIEAEYBYDAIIHJCQEQBZGAHAIZDQDYFCLIAIJIKICSEYEQHZIAJAJIEICBAYKYLYFSDIDAJJIQHKBQGaHABJGICBEYIYJYDQHIGICIEBIYIQJaLAKKAQIQJQCQEQGZHZDAFAKIAJIQJQCQEQGQHZBALAAAIJJQAZLQBQHKGACAEAAAJAIZKZFQDQHIGJCAEAAAJAIAKZLQAK',
  'GNIDoGFBlBMCADaDhDjDrDKEQECGDBHYIIGQKQAJLAHAGZIZDRCREQAJKAHJLQFQMZAAAYCBDBEAIJHQKQFJLAGAHZIZDRCRAIEQAQMKLAGAHAIZKQGJLQMaAAFJGAKAIJHQLQGZFZAQMKGAFZAZEAMYCBDBIJHJJILQFQAZKAHAIZJABKLQHZKQAJFAHALABaJQIJKQAQFJHAAZKAIZJABKLQAQHQFZKAAJLABaJQIJAQ', 'GNQBdCCBiBjBFCcCADIDRDaDDEgEKYEBDIMIARJYKYCRLYGCDIERCIJIKIABMYEYDYBYFSGILIHIIIABJYKYCYLQHJIACAKJJQAQCYIYHYLYBCDIEIKIJIMIASCYCQIQHZLAJAJICIABKYMYEYDYBSLIHIIIABCYJYKYDBEIMICRARHYIYLYBCEIDRKJJQLQHJIAAAAICCJYKYMYDYEYBSHIIICALIAIJAKZAQIQHZLAAI', 'GNUBRCCBkBFCQCdCADIDaDiDDEpGJAKAMYDYARJIKICSJYLYEYGCAIKIDAMJBQFQJZLQHJIAJABAFAMZDQDICICQKZEQGQHJLAKACACYDYDAMJBQFQKZLQIJJAKABAFAMZERLICBDYEYAYAAGRLIEBMJBQEQFQKQJQIZCACIDCEYCSDIDQIJJAKABAFAMZAQCQDQIQHZLADICBAYDRLQDAHJIACAAAMJBQFQKQJQIZEBAY', 'GNZBUDABEBFBTBaBcBdBYCQGpGBHFQHQIQBQEQKJJALYFQBYEQDIMIACJICSAYMYDYEBIBHIFILICQARMYDYEYIBHBFIBQLIJQKYERDIMIABKYEYHYFBBIEQKIARMYDYHBKIJALYBQFQFYISHIDIMIABCBLYBYCQIQHRDIMIJBCIASJYCCGYEYFYKYHYDRHQKIMICIGCAIJRGYCYKYHAMYDBHIFIEIAIKICSKYMYFCEIAI',
  'GNgBFCDBEBIBUBdBYDjDBEhERGrGHJEQJYCYDYFBLIEIABKYIYGYBRFIDICIJIABEYLYGAIIKIERARJYCYDYGBHILIAIEBKYMYBQLICSJICAEBAYCYHYLYBAMIKIARCYLYGRDIJIEICBABKYIYGQLIERCIABEYLYGAIIKIERARCYJYDYGBHILIAIEBKYMYBQLIAIEICRJYABEIEQLZBAMIEQHZGRDIAIJICBLYARDYGBAI', 'GNjDJGlBICBDSDaDcDrDMEDGgGoGDAFYGZHZJQBJFAHAHYJYCBAIGIIILIMIDSEYFYBYHYKYCBJIGIGALAMAIaAQJQCQGIHIDAIYAZJQCQBIFIKIEIDBLYGQHJFQBZCAGILIDRBYEYHAKYCAGAJAAJIJDQFYGZJAAAIJMQLQGQGYJYCRFIHIBIKIEIDCGYLYAYMYIYCRJIFIFQBQHaKQEKHAKZJAFJGJDQGYHYEZJAFAAA', 'GLBDrGABFBQCRCDDiDkDoDKIBYFAHYIYDTGIAIKIFICICRAZAQGbFAKADABIIAHJIYJIJABaHQDYJIDIDQIJJAHAHZDZIRJJDAIABKHQCQFRAIGIEBCYFYDYDAIZJQKQGKAAAIFBCIESFYAYAQCAGaKAJAIJHAHICRDYHACIDRHYHAJaKQGKAAHAJACADABZIQKQHKAQGaHAKAIABJCQDQJQAQGQHaKAJKAQAIDBCYAQ', 'GLCCEFBBYBaBDCbCQDcDkEoGEYARCIHBDBEYAYCSFYGCCICQFRGQHJDADIECAYDSHYDBGACAKIAQEQHYFBCZIZIQFQGQHJDACAIYJAKJIQCQDQHZFAGACJDREIABIYFSEIDBEAFAIIARDYFYESFAGYCCEIEAIAGQHIIIFRDIACFYDSGYEYEAIACQDIGRHIAIFCGYDYAQHYCAIQEQEIAIDCGIFSDYGBHYIYEQIQAQCYBY',
  'GLFBADIBVBhBiBECYDCFaGjHCIEYFYKYDRJIHIECFYHYJYKYDYATGIIIBICIEIJIHIFDHYJYKYDYAYGSIIBICIEAHAHIFREYHAFIERBZCAHYCYIYGCAIDIJIFIKIERHRBRCZFBFYIYGYJYADDIDBKJEJHRBRCRFYIYGYAYDBJYARAIGIIIFICBJIBBHBEZKZARAYDTGIIIBIFICIJIHIEDHYJYKYAYDYGSIIBIHAJZAA', 'GLIBdCNBUBgBkBADpDDGJGRIAQDAFAIYCABAHKKQJQGQGJABAIEDJYKYFYDRFAHYBQCQCYBCDIHACQHQHIFRCYDYDBHBFJCRFYHYBSDIGIJJAQEQIZGAJAHAHYFBCIKIESAYAQJZGQIKJAAAAIECGYKYCYFRDYDQGJHADYGQHJDADYCCKIESAYDYCYGYHYBBFIKIDSAIECDYKYFYBRGIHICIAIEIDCKYCSAIAQHZGAAI', 'GLQCMEABLBJCKCBDDDbEhErGAQCQGYFAHIIIDRFIEICIGIACJYJAKaDQFQIQBQHQGKCAEAFADADYFSEIDCJIARCYDYEYFCJIDSCIABDYJYFSEICIAIDCJYCSEYFCCIJIDSAYEYFYCCJIDIKIASEYDCJYCSFIDIEIACJYDSFYCCDICQJIASEYFYCYGZDBHABAIAJIKJAIESFYACJYDRCIJQAQAIFIFQGZAAEBJYDYCRAI', 'GLYBFCABEBUBdBCDoDhGrGJIAAEQDQJYFQBQGJKAIAHAHJARAICTIYKYDYDQEBGYBAFAFYBSEIGQFAGAGIDBFYEYERGRDJFBDYGYBCEIHIIJAACAJZHQIQGQGYDRFIKICCAYAAIZHAJKIQAQAICSHYKYFYDBEYEAHJGQEYHAGJEQEYFSKICCAYEYFYGYHYBRDIKIECAICSEYKYDYBBGIHIFIAICIESKYFCAIAAGZHQAI',
  'GLYDBGABEBLBbBFCrDJEcEgHAICRBYDQEAFAHIKICRAYIYFYERBJFAAIEAIACBKYHYJYGSBIDIEIFIIIIQBaDAEAFAGAHIJAKICRAYIYJYESDYGBEIDSFIFQBJIAJAAJCBAYKYDYFRHYEQGQBIJIIIIQBaGAEAHIJADAKICRAYIYDYDAAJJQBJIACBAYKYFYFQAJDQDYAYEYGRBIIICBDYAYAAFAHYGQJIAIDICRIYAA', 'GLaBACJCCDKDjDqDsDEEgETHCAFIJAGZHZFQKQEQEJDRIZEBDJDAKAFAHJAQAIGIJIBSCYIYIQEaDAKAAAFAHAGKAQJQFaKQDQEKIAIICIBCFYJYAYABJJFRBRCRIZDZDAAAKAHAHZGBJJHRGZGQAQKQDQDJIJBBCBFBGZHZARAIFIGIHIBSCYIYIQEaDAKAFKAAIQEQDaKAFAJAHKGQIQFaAAJAHAGKIQIIBICSFYAY', 'GLcBgBEBbBFCADCDTDrDhEIIAIIIDQHQCQCYEYACHIAQHQEQGJCADBHYIYASEIDICRGZDBCIKIBCJYHYIYAYERDICBABEAHIIJJIBSKYAYCRGIGQFKKABAJAIbHQHIARCYEYDSFIGICBABHZAQEQGQGYDBEIAIAQGQDYEBAIGQDQDYEYACGIDQCQFYAAGQEQEICIDBJJBJIBHZHAGbEQAQFIDAJQCQCYAYAQEBJICRAY', 'GLsDAFNBTBdBMCYCCDEDKDhHDYFQJIDAKAAaEQCQFQJQIQHJDADIBIGCKYFYEYCREAJICAFAAKFQDQKQBQGQHbIAIZJBDJFBAYCQDQFQJQJYDBCBAIFQJQDYCBEIJIFBAYEQJQCQDQIJFAHIGAJYJQDQFQIYCAEBJIFQIQHJBAKAAaFQJQDQEQIQIIFBJZDQEQIQCQCYHIFAIYECDIIQFQHYEADBIIIQDQEQHIFAKJAB',
  'GLsDIGQCEDMDUDpDcEBGhGRHGYAZHQFQEQDQIJBACAKAJAAAAZGJAQCQJQKQDbEAEZFBHBGJAJCQAYCAJJAAGbJQHQAIFQEJDJCAGAJaHQFQEQDJKAFaHAFIJKGQAZFQGIKQDaEAHAFJAJCRDYEZHAFAAJGAJZAQFQHQEJDJCBGYFZAAJJGQFZAZHQEQDJKAAAFJGAJaHQAJKQDaEAAAHAJKGQCQDYEZAAHAFJKQEQAZ', 'GMRCcCCBMBlBNCYCiDpDAESEDGGAIYHQKQCQDYBBLYFAEAHJIJAQGQJQLZBAKICRJILIGCAYCYIYHYKYEYFSBIDIJICBKYEYDRJICILIGIACKYCRJYDBEICIKIASGYJYDYLYBYFCEIBREQFQLJBAJAKAIAHZCQCIDSBYCCDIDAHJIQKQJQLZFAEAHIBRJILIGIACIYKYBYDYCRHYEQFQJILIBCIIKIASGYBYJYCBDIKIBR', 'GMYBFCBBdBACUCbCSDsDDEZEoGHYGAIYJYFBDYBSFIDCGIHIKICSHYJYDYGBKICIAIERJYDYGYFYBCIIKICILIEQHYDSHIJIECAYDYCYKYLYIYBSFIGIHIJIDCAIERDYACCYKYGRJIAIDIEBCYDSAYJYGBKIDIASHYJYGYFYBCIIKIDIAICILIESHYJYACDYHIEAKYLYIYBSFIGIAIHIJIEBCYDYKYGRAIJIDCHYKYGYAS', 'GNMBaBFBbBQCRCSDcDkDrDAECEoGAAHAIAJIJAMKBQEQFQGZDADYHYIYCRAIJYLIDBGIBAMYCRARLIDIKIECFYBYIYJYMYCYCAMJAQHIGIBAJYJQBQIQGQHaAACAIJGQDRLYABCIDIGAHIBAIaMAJKIQBQJYMYCRARLIKIEIFCBYIYJYMYDRAYCBDIJIIIMIBIFSEYBCGYHYAYCYDBJIMYJAIKMQAQGQHIBRKYLYDBCIHIBI',
  'GLBCcEDBIBCCECTCaCoDYErGFICIGBBYFRCIGIEIHCJIDRAYHYEYGYCYFBBIIIJIDIASHYDCJYBYFRCIGIEIDIHIACJYDSEYGYCYFBBIDIIYESGYDCBYFRCIDIGIECBYDSCYFBDIBIESGYCYFYDCBICSGIECCYBYDSFIGIEICCIIJIASHYCYEYGYFYDCBIJICSHIACCYIYJYBYDSFIGIEIHIAICCJYBYDYKYFSGIEIHIAI', 'GLDDrDMDQDYDgDiDKFUFAGoGAIBIDAEAFAGZHQCZAQJKDACZAZIABAKKGQFQEQCQAZHAFJEQCQAQDQJaIABAFJHQDJAACAEAGAKaFQBQIQJKAADZHABZFAKKGQBZHQDJCAEABAGAKaFQIQDJCJAQJaDAIAFAKKGQBQEQAQCZHABJGAKaFQIQDQJKCAAAEAGABZHQDZIAFAKKBQGQEQAQDZHAGJEQAQDQCQJaIAFAGJEJAQ', 'GLFBYHCBUBVBIDDERGjGoGrGFAHYDYEYARGICIHABAIaAQDQCQEQGQFLHABAIAJAKaAQDQEQIKBQHQFbCAGAIAAADAEAKKJQBQIaCQGQFLHAIABAJAKaAQDQCQEQGQFQHKIAFbCADAGAAAEAKKJQBQFQIQHaCADAGAAAEAKAJKBQDYCRGYABEICIDIBAJaKQCQDQEQAQGQHKIAGYAYEBCIARGIIQHaEAGAFLBAJAKaDQBI', 'GLkDAGbBKCIDQDcDYEoGrGLHBKDAEAFAHAIAJaCQGZAACJIJJJHRGZDQAYFQEQBaKACBIIJIDRFKDBGAHAJaIQAQCQFQKQBKEAGAHAJAIaAQCQFQKQBQELDAGAHAJAFaAAIJFQJQDQHQGQEbBAKAAAJJHQGQEQBaKACBIIJIDRGKDBHAFAIaJQAQCQGQKQBKDAEAHAGaAAFKDRGQHQEQBaKAAACAFAJAIKDQAYGQHQEQBQ',
  'GMLGiGgBVCQDSDYDaDsDDGpGAHFIEIHIGICBBZKYIYIAKKBQCQGQEQLQJaAADAFAHAIAKABKGQGYBYKZDRFIHIKILICBEYEQIaKAEKIQIICRLYHYDABIFYGICQKZHQFQAQJKLAKACAGYBYDQHZFQKKLQJaAAKADABIFAGICQHJLQKaAQJKKALACAGYBYDQHZFQAQJQKKLAAaDABIFAGICQHJAQLQKaJADAFAHAEABAGKIQBZ', 'GMQBEDUBgBhBiBjBkBlBNCAHRHKIABLYCYJYICHIGICRLIARKYBYIAHBGICIFIEIDIARLYFCCYGYHRIRBIFALIABDYEYCYGYHYIRJILIAIDBEYARLYJYICHIGICIAIEIDRLYFRBYIAHBGICIFRLIDBEYAYFYCYGYHRIRBIKIDBEBAYFYCYGYHYIRJILIFBAIERFYLYJYICHIGICIAIEIFRDRKYBYIAHBGICIAIEIFIDRLYAC', 'GMQBbBCBgBlBhDpDrDAEUERGDHFAGAHZBQBIGIHIDIARFYKYJYEBBIGIHIDIDAHZGQJQKJFAAADYHYGYJYBYBAGJHJAQDQFQKZBAGAHJJQFJKIABDYJYGYHYERBIFIKIAIDBJYGYHYEYBRKICRIIDBAYCYKYBBEIGIHIJIARDRIYLYBBEBGIHIJIAIDRCYABJYGYHYERKIAICIDBJYARKYBRLIIIDBCYFZKYBYEBGIHIAIAA', 'GMgDDGABNBQBdBBDoDRETFJGqGAIEQCQFQDQKJGQBaKADAFAGJIAAALIHIHALaFQDQJQGQKQBKCAEAHYIAGZJALJHQAQEQCQGQIQBaKADAFAJAAJLIHIHALaAQAIHJGQIQLIEQCQBQKaDAFAJAHAAALJGQAaFQDQHQJQKKBACAEAGYIAAAHZJQLYFQDQKQBKCAEAIAAAHAGAGILZEQCQJQAJIQBaKAAADAFAJALKGQHQIQAZ',
  'GNBDsDABRBSBTBQCMDoDqDUFDGJGDQJABZKQHQMJEAEYFYFAJABAIJGQCQAYFAHZKAIJBQJQHQFQAICAGABZJQHQFQFIEIEQMZKAHJEQFQMQAQLZKAHAIAJJEQFQHZKQLJAAMAHAEAHYFBJZIQKQMJHADAEAJAIZJYFQKQMQHKAQLZHAMAFAJIDQKAIJJQEQAQMZKAIAJJBJGQAYEABAJaIQBJEQFRAJGAJYEQAQMQLQHaKAAJ', 'GNDDqDFBKBaBdBTCUCIDLDsDYFAGLABZEQDQJYKYFQCRAIAQMKIAJZMYDAAYCBEAFBKIBJLQJQIQMZAAGAHAKABJEQEIDSGYECDIDABZKQFQCQAIEADABAKZHRCYFBHICSDIERAYAQFAHAMJIAJALAKZBQEQGQAYDACABJGQAQJJIQMZDAAIGAKJLQIQJZDYFYGAHBCIEIKABZCQEQAQDQFQHQMKGAAYEAJAIALABZKQAQKIBI', 'GNEDrDUBVBlBQCTCIDhDREBGKGoGKYAYDBEBBIBAMKFQIQJQHQHILZFAGABYIYMYERDRAIAQKKLAFAHAJAIAMZBQIKFQJQHQLQKaAACADAEAGAIABAMKFQHYJQIZCQGQAYDAEABIGQLJHAFAIAJAMaBQCQEQGQIKGAMIFQHQHILZAQFAMYGQIYDQKKLAAaIAAIHJAQLQKaDAEAIAHACABAGAMKFQJQAQLQHaGABYEQDQIIGAAI', 'GNJCqGNBbBcBACKCdCCDEDLDTDgEFQGQIZJZCAKYCYHCBIEIGQLYCSJIKILIGCBYDYCYEYHSJIKILIGIDCCYDQGRIJAAFAKYMABZEQGQLYHBEIGICIDRKYLYGBBJMQAQFQIZJZGACIHAEABIDQLQKQJQIJAAFALZDADILIMIFSAYIYJYKYGYCCDICQGRIJJAKALAMABZEQBIHQIIGBMIFIASJYKYLYGYCYDBMIGRJJKALAFABY',
  'GNZBdCYBbBcBFCKCDDLDrDIEAGoGDAEAGQJAMJAQCQKQIaHQLJIAHaDAGAJYEQDIGIHIKICCAYAAJYMZEQEYDSGIHIKICICQHZAAJYKAEAEYDYDAGRKIEBDYGYBYFSKIGBLIEADAJJMIARCYDYERHIIICBABJZEQMYGRHIHQIQIIDBAICRDYIYIAHAEAGAJIMICRDRHZIYEBAIDICBJYAQEQLYMYGQKYFCBIGIAIAQERKYGBAI', 'GNgBAGEBNBDCICUCdCJDRDpDrDZEERBIEAFAAAKYLYGQCQBJIAJAMALALYERCYDYKIAQFQIYBYHCGIDSCIEBDYGYHSBICIGBDIIIFAAAKYLILQMQJQIQBZCAGADAHALJERKIAQFQBYGYCYHBDICSGIECCYDYLYHSGIEICCDYERCIBIDBFAAAMIAIFSBYIYJYDYCYCQEBBIMIDRIIJIFCAYDYKYLYMYESBICIIIJIDCAIFRDYAC', 'GMADcDgBhBlBECFCaCbCCDYDJHLYIBEZBRFRGRJJJQALLAAYKAKICBDYHYEYEABZFQIQJYGBFIIIEIKIHABYEQIQKQJQJYIBEIBIHQJYKQIYECBIKIHIDICRDAJYCAHABaKQKYESIIHIHAJIKABJDQJQLQAaHAJIDABZKQJQHQAKLACADABAKZJQBJCQDQLQAaHABAJAKJDQBYHQAKLABACADYJYKYHRBICIDBJYKYHYEYIRAQ', 'GMBDgEbBACNCEDLDTDkDqDsDJFDQAYFZEAIAKAJJCQCYIYKYERGIGAEAHAIAKICICAJZKQCIEQJAKZCQIQHQGQGYEBCICAFIKJJQIQHQGQFQAKDAIYLABAHYJZIQHQGQGYCYCAHJGQCYHAGJIAJJBQDQLQAaFACACIFYCAHYHAGAGYERCIFIFQAKDAIILABABIDSJYKYEQCQAILYFYFAHAGAGYHYCYCQAQFJHAAZCACIGIGQAQ',
  'GMFBQBRBiBlBcCUDgDoDDESEAHDIHIIIBRCYKYGYARDAIIJILICBBBHYHQKQGZFAIIHIBRCRLYDCFYAYAQEBIIEQFQGKFAHIKABICRKYFYDSGYJYECAIDIGIFIKICBBYHYFQKQGaDAFAIYAQERJILICBBBHYIYAYERDIABIIAQHIBRCRLYFBAYDYEBIIIAHKAQKQGQGICIBBKYAYHYIYERDIGIABKIBRCYAYGYDYEBHIIIKIAR', 'GMFBYCABBBEBCDKDQDUDSEcEhHKQIQAQEQFJGAJAIaAQEQFQGJIIJAHJDRCIBCLYKYAREIHIIIDICRJYFYGYEBABKILIBSJYFYGYEYABHIIIDICIJQGZFACADAIaHQHYAREIDIDAHAIJCQFQGJJACYHYIYAYERDIABHIIICIJQGZFACAIZHQAQAYDYEBHIHAIKAQCQFQGJJACYAYHYIYERDIFIGIJIBCLYKYERDRFIGIJICBAY', 'GMVCJGRBECICADCDgDoDqDsDaHABLICICQBQGQFJEAHAIAJZCQHIEQFZGABAHACAHIJJIQCYCAIAJZKZLYASDIBICAGIFIEAHIIAJAKZLQHQBQGQFJCABYFYGYDYACIILIJIKIESCYCQFZGABAIAHZLAKKJQHQIQBQGQFJCACIECHYIYKYLYASDIBICQFYGIGABALAHKIQIIESCYBYFYGYLYDYACDQGIFICAEAHIJYKYHQDQBI', 'GNABFBBBEBZBQCCDaDiDpDKEUEkECQFQAQGZJIEQHYKALYBRDIKICIAIGIFCEYEAJZIQHQHIARCYLYBYDRKIGICAAALAHAIAJJEQEIFSCYFAGYAAEAJZIQHQLQKYDBBILIAIEBHYHAIAIYMYBRDRJIFQCQGYAAKIAIEICIEAFBIYJYMYBYDRLIAREIGIFAHYAYLYDBBIMIARHIFQGYEYEQKYDBBBGIFAHYMIAIESLYBYDRKILAAA',
  'GNFBJCABKBTBcBjBECQCVCsDhEBGIQCQMYEBGBLIBRDYGYGALAEQKZFQHQJQAQMKCADABAGAIAKZLQEQEYHYFCJYASFIJBLIKIEQGQIQCQMYFAABLIKIBQDQMZHAEIGRDIBBKYEQHQMJBACAGYIAKYEYLYARFRMIDAEBLYAYFRJIHIEIEALADQKJGQBQIQCQMaEAHAAAJAFAKJLQDQDIBIGCIICSGYIBLYDRERMIEAGACBLYDYAY', 'GNKBkDNCaCADCDEDLDTDbDoDIFrGBYLQEQFZAADAMYCRHIAIIIAQFJDAEALABaMAKKBQLQEQFZGZHAIACAKIBJLQEQFQGZHZIAAICAMIDQFJEALABZDQFQHQIZAAFIDABJLQEQHZDAMYCQAIIIIQGKHAEALABZKZCQAQGIHJEAKILAMZKABKMQKaDQJQFQIQHQEJHIDALAKAJaBADQHYMJJQKQLQEZHADAIAFABAKKDQLQIaFABA', 'GNMBYCKBLBNCZCQDbDiDqDkEAGDGCQLQMaAADAEAHAKAJJIQCQGIKYERAIDILIMIBCFYCYIYJYEQHIGICAIAJZKQGQHZDRAYECKIIIJICRGYHYDYKAJJIQDQHJGACADYIYJYKYESAIHIGILIMICCDYDAIAJZKQGQGIDICRHYLYMYAYECKIIIJICRDYGYHYARLIMIDBGYHYAYKAJJIQAQHJGAAYCAIYJYKYESHIGILIMIDICCAYAA', 'GNVBiDUBhBYCBDMDQDqDKEkEDGZGFYFQLaGAGYABCIJIFIHIEBDYBYIYKYCRARGILIEAMYJQGQLJFAGaAAJAMKEQHQGQFQLaAAJAMACAHJGQMZCAKIBIIIDIERFYMYJQLJFAMAGAHZJQMJEBDYBYIYKYCRARLIFIMIFQLaMAAACAJAKAIKBQBIDIERFYGYJYAYCBKIHIHQJQFJGADBEABZIZKQAQCQFJGJEABAIZHQBJEQGZJABA',
  'GNYBdCIBLBMBZBFCcCADoDqDJEaEIKCAAALAFAJAKZMQFIAICRLYIYEAFAHAMAKKJQJICRAYMYDRFIMAJAKZDQHQEQIILIABCBJYKYDYFSMICIARLYIYEAHAMADAFAKKJQJIARCYDYDAJAKZFQHQEQIIMQLICBDYMYFCHYESFIEAHBJIKJAIDRCRLYIYFAEAJIAIDICRMYACJYEQFQIIAAMICBDYJYKZEQEYBYGSFIBBEIHRIIAI', 'GNjBACRBTBSCCDEDMDgDpDUEkEJGBQFZGZHAMJCAEAIIBRCYEYDYABIIEQMZKALAJKEQIQAQDQMQGQGYHZKAMJGQHQFJCACIBCEYDYDQGQMZLAJAIJAQDIGIEIBSCYCQFZHAMAEAGAAADAIaJQLQKQHJFJCABAIYJZLQKQHQFJMAEAHZKALAJJIJBQCQERCIBCEYCSGYCAHYABDICIEIBSGYHYAYDBCIARGIHIBCEYAYCYDRGIAA', 'GNqDDGRBhBACYCdCMDSDUDiDBEaGAIHYKIDICRIYJYGBAIKIDICIFIESIYLYBYGAMICCDYDAAZKQMQGQBICAJQIKCQLQBaGAHAIAJAMAKAAJDQDICSLIMYGQHIBIECFYCYDYAYKYGRIIJILICCDYDAAZKQMQLQIZJAGAKIAIDQCQIYJYGALICIDBAYMIAAKaMQAKCQAYDQIQJZLAAAMAKKCQDQAZLQJJIAAACADAKaMQLQJQIJAA', 'GLIDbGQBRBjBKChDpDsDAGDIGYHYEYBQKQJKAACADAFAEAHJGQEZFRAICAEAFAGAGIERCRAYFAGAEICRDYGYFRAIDAGACAEAHZFQGIGAEAFAHJCQDRGYFAHYHAIaBQKQJQAKFAGADAEAHAHYFRGJDAEAHACACIIYFQHIDSEYDAHACAFAIABaKQJQAQGJHAAaHIJAKABKFQIQCQAQEIDBAYCYFBIICQAQDQEQHZFAAIAQCAIYBY',
  'GMEDiGSBdBACJCqDsDgEBGKGTGEQJYAYKICABAGAGIHZDQBIHICSBYKYLYDDBICAGIHYGQBQLILQKQAQJJEAFAIAKICBIIESFYCYCAIABZGAHJBQIQCQCIFIECIYGZHABJIQEQLZHAGJIIERFYCYCAKZHALJIABZGQLQHQHYDRAIKICQJYAADAKAHAHYLAGABJGYIQCQKYLYDRARJJKJCBHYAYJYKYDCAIGILYAQHKLAAaGAAIBA', 'GMFBJCABQBDCMCVCBDaDgEiGrGFAIIBIDICRDAHYBACAIaBQEQFQLYGQAQHLBADAIICQDYBYEAEYFYAYFAGBIJKILIJIJALaKQIQIIJIBRDICBBYJYIYIAKALKJQDRCIBBJYESCIDBEAJALaKQIQIIFRCIEBJIBRDYEYCYCQHZAAFAIYGQAIFICICQHIEIDIBBDQJYIYEQFQHZAZFBGBIJCQAQEQFQGQHKAAAYCCDAEIASDIAABI', 'GMMBZCaBgBlBACNCEDJEbEBGqGFQIIBBKYHYGAEALICQCYJYEYLYGSAIAAEBGAJILICIBRCAIYEYLYGQAQAYGCJIERIIBBLICQCYEYJYLYGSAIAAGAIILIEQBICCDIFRCYBYIYEALYGQAQAYGCJIEILIDIBRDAIYEBJYLYGSAIEIHIIICIKIFCBYDYJYLYESAYGBEIASIIAACIDBJYAYEYGRIIABJIDRCYAYIYGBEIJIARCIDBAY', 'GNABrGLBNBQBgBiBBCECKCZCCDcEMYDRIICILIJAGABYDQIQLIJIHIKCBYGYMYDYIRCIDCBIMIGIKSHYJYDYCYLYICBIMIGIJSDYDAGBJABYMYISCIGILIDIDQJBMYGRDIJIHIKCMYJRLYCAIABIMQHQKQLZDADYGCJIDSGYGQLJHAKAMABZIQCQJQCYICJIBIDIMIKSHYGYCYDBMIGRHIKCBYGYMYJYISDICILIHIKIAIEBGAGYAS',
  'GNBDqDABFBJBQBVBDDiDLEgEkEZGEIMIFIFAMZCQAYHYJQDYGBJIEIEQHQAJCAFAMAKABZIQEQKIMICSFYFQAZHAMAEAKAIABJCQCIFSKYEYJYGRDIHIMYHQAKMAKACAFABZIQEQKIFBCYEYIABJCQEQKQHZAQMJFAKYJYGYDRMIDAHAAZGAAILABJIQJQAQHQMZDAGAAJJAIABZLQAQDQGQMJHAJAAZLABJIQAQJQHQMZDAGALAAJ', 'GNDBYCEBFBRBSBhBiBjDrDTGbGAHIIJIHIFRKYLYDRCIAIMIBCGYFYHYIYJYDRCRAIMIEBFBGIBSEYBAFBGBHYIYJYDYCRARMIFIGBKYLYAYCBDIARKILIHBIYJZAYDYCRKILIFRGIEIBBIYFRKYLYCBDIAIFIIIBREYGYMYCBDBAIFIIIJJHRKYLYFBAYDRFIKILIHBIYJZAYDYFRCRMIGIEIBBIYAYDYFYCRKILIABIIBREYHBAY', 'GNMBQCDBNBKCRCdCEDbDpDrDAEiGBQCQHZDAGAKIJIFQLQHZCAEAIYAQCIEIHILIBCFYIYEQJYKYGQDQMYAQCQHKEALAIAMAJAJIKZAQKIMIFIBSIYLYEYCYDYHYGCAIJIKIMIESIILIBCFYEYJYKYAYMYGSDICIHIIILIBIFCEYBSIYLYCYDYHYGCAIJIKIMIBIEIFSIYLYBCJYKYAYMYGSDICIHIBIIILIFCEYJYMYAAKIJQMQBQ', 'GNYBDDFBdBhBiBACLCUDZDjDBFrGAQJYFAMYDQIQCQBICYHAIYDCIIKIFIJIMIEIAIGSLYHYFCIYFQKYDRCIFIHILIGCAYAAEYMYDQIIJIEAMZKQJQJIEIAIIYDAKIMIGSLYHYFYCYDBIIJIFRHIECFYFAJZHQBYDAIQCQCIHIFIFAJAEQBYIZHQDYCBHIIIJIDQBIERLIGCAYEYIYJYDRFIMYKYHQCQBILIGIACEYEAIZGQJQLQBa',
  'GNdCYDNBjBkBSCADCDEDLDIETEoGBQKQJaLADAEAMJBQKQJQGQHZIZCAAAMIFQLYCYABEICSIILIFCDYCYEYMYASIILIFIDCCYDQFRHJGAJAKABAMZEQFQLYABEIFICIDRLYFBMJBQKQJQGQHZLAJJKABAMZCQCIDIDQJQLQIZAAFAJJDADYCYCAMJBQKQGQHQIZLAGJKABAMZCQEYJYASFIGILIDCGYJYEBCIBJKQGZJABACYERBI', 'GNhBNCABMBbBQCEDZDkDqDsDBGJHFQCQLYGYBAIAKAJJEQEYIYJYKYBSDIDABAJIMICIFBAYEYKYKQIQHJEAEIKYCRJYBQDQMYDYBCHIIIEICIJIKIAIAAFRKYJYMYEBHYIYBSDIEIGILIMIFCAYCYHYIYERMICBAIFSCYLYGYMYDYBCEIDRMIABHYIYDYEYBSGILIMIAICIFCHYIYARKYJYEQMYBBEIDIAIHIIIJIKIFSCYMYDBAI', 'GOADjGFBVBiBCCICJCLDTDaDgDoDrGKIFQAKFAEAGAHALAMANaBQKQKIEIFRAYIYCYDBJIJQCQDQAJIAEBJYKYDRCIEIIQAZCADAEAJAKABANKMQLQGQHQAZIAFABYNYDRCREIIIIQAKFAGAHALABZKQLKFQGQHQAaIAJALAKABJGQHQAQIaJAJYEYCBDBBIFQAJIQJZAAFABYDRCREIAIAQJKIAGAHABZKQLQAQJQIKFAGAHALaAQAY', 'GOEBICRBSBcCdCADCDgDiDoDqDJGTGAIHIGIBAMICAIAJZDQDIIIJIBRNYAQHIGICACYGYHYMYNYAYFCEILIARKIBQCQMINICIBCIYJYDYAYKYLYEYFSHIGICAMINIDBIIJIBRCYDYGYHYMYNYFCEIAIIIJIDRLIKIBQCQCIBCDYCRMYNYABIIJICIDIBSGYHYMYNYAYFYECIIJIARLIKIDQMINIBBDYCYAYIYJYKYLYESFIMINICBAY',
  'GOEDpGABMBgBVCQDSDbDhDsDBGJGYGIQNJEABYKYFQDIHIGICQLYAYDAHIGIMICIEBJYJAIaKABJIQKaNQJKKAKIERCYGYHYDQAILICAGYHYMYDYFBBIIIEQKYJYNYDRHIGICQLYAYFADIJIKIEAIYBYDQJIKIMINIEICRGYGAHaMQAQLJGAAaMAHKAQAICBEYKYJYDABIIIEQCQMZHAAJKAJZAQHQMJCAEAIYBYDQFQLIGICAEANZAQ', 'GLADrGFBIBRCYCCDiDkDpDKICREAGJAJDAFAHYIYJYBYCRKIEIDIDRAZAQGbEAKACABIIAHJIYJIJABaHQCYJICICQIJJAHAHZCZIRJJCAIABKHQDQERAIGIFBDYEYCYCAIZJQKQGKAAAIEBDIFSEYAYAQDAGaKAJAIJHAHIDRCYHADICRHYHAJaKQGKAAHAJACADABZIQKQHKAQGaHAKAIABJCQDQJQAQGQHaKAJKAQAICBDYAQ', 'GLCDkDMBiBjBNCADEDbDgEIIBQCYFQHQAJCAGIIAEABYEIFQIICSAYHYIYFCBICQEIIQHQAQGJKAIaCADABZEQEYFSAIGIHICCHYHQAQAYFBEIBIDQHQIKDAJABaHQHYEYFRAIAAIAIICSAYGYIYFCEICICQIQIIDIDAHABJJQKQGaAAAYDAFYIYEDCICBHJHQIQIIBAHZIQCQBIBAHAIZCQCYETBIDQFIAIAQGKKAJAIZHQDQAQ', 'GLCDsDTBFCYCADLDZDcEiEIHAIJYBYCQGQAQFKKAEAHAJABaCQIQDQFIGQAQKIEBJYCYCAIYDRAIAAGAGIIABKCQJQEQHQKQFbAAAZGBKJHBCBJIERHYHQFQAZCBHIHQCQFQAQGbCAKAFLHAFYHYJABZCQIQFQKQGLAAAJHBCZJBFZIABJFRJRCJHRAZAQGbCAHIKADAIABAFKJQHQAQAIEBJYBYBQIQAJCQCYKYDBIIBAFZIQAQ',
  'GLFBQBJBbBgBSDDEUEZFAGrGBAHQAQFICIBIECIYDYHYARFIGICIBIJIEAIAKaAQHQFQFYGQJJBABYCYCAGYACFIHIDIIIKIETBYBRCZIBDZFZHAKJDQDIEIBRFZDADIEIBIFICTFYIYEDDYDQHYARFIEQGIEIIICDBYBBDZFRHZERGYABEJHJFBDJBRBICTFYDAIYGYAYJYECHIDIBIBAKZHQAQAIGIBBFIFQIQJZGAAYERGIBI', 'GMADjGLBMBhBFCaCCGIGQGbGrGEYGYBYKYLYFSDICIHIIIJIECGYBYKYLYCSDYFBCIDSIIJIEIGBAIBYKIEQLYDYCYFRIIAQHaIAJIJAFAKACADALKBQDYEQGQAYJYFAKYCALABKDQEQGQKQAQAJGBEYDYBYJYCAKILYFRCIJIGIECDYDABZGQJYCYFBLILQKQAQCQJIFQGAKYCQJQIQIYFBCIHJEAKIGQEIDCGYAYJYKYCYCAKJAQ', 'GMCDkDKBUBVBEDaDsDAEiEQFLGKQIQAZCAGAJAHZBQDQGICQAJIAKAHZBZDQDIJICRLYEADABJHJKQGaLQAQAIFZEAFILICCJYLYDABAHJJQLQGKCQIQFaAACAGALAJAHZBQDQJILICSGYLYEQAIFJIAKAHZBZDQEQAQFJGAAZEAAIDABJHJKQLZAQGQFZEAEYDCAIJICICAHABZJQAQDQEQFJGACAAZJABJHQAQCQGQFZDAEAJAAJ', 'GMIBkBLBYBdCADCDUDaDEEJEhHDQAQIIKQFQGZCACYHYJYECBIIILIDIARKYHYHQCQJQGKFAKAAAHYIYEQGIFJKAAADYLYBYERJICIHAIZCQFQGZJABBLIDIARHYIYCYBYJQGJFABACAIKCQHQKQFZBABYJYEBLICRHIBQFJKAABDYCYLYERJIBIHAIZBQFQGZJABIHIIIAIDBCYARHYIYBYJQGJFABAIJHQBYJYEBLIAICIDRHYAA',
  'GMbCDEFBACBCCCYCcCZDhDpDTGHIAIIIJIKIESFYBYCYLYHCAIIIJIKIEIFSBYCYLYHYACIIJIKIEIFIGIDSBYCYLYECIYJYKYASHIEICIBILIDCGYFYIYJYKYAYHSEIACIIJIKIFIGIDSBYCYLYAYEYHCIIJIKIASCIBILIDCGYFYAYIYJYKYHSEICIBILIFCAYIYJYKYHYESCIBILIFIACGIDSAYFYBYCYLYECHIIIJIKIGIFSAI', 'GMgBcCACBCKCTCdCCDYDhDLGpGBAGAHJEAIILJJQIQDQEQHaKABAFAGAIKJALZAAIQJKDQEQFQHQHIDBAICSDYKZABBAGAJAIALJEQEYFYIYJYLYGSBIHIFAIYJAKIAAEALYGYBSHIJIFIKIAIARKZEAHAIYFQJABAGALJIQEQKQHaJAJYBBKIEAIALZGQGIFIAIIIEQKYFAIIEILICICALZDRHYIQFQKIHQJaKAAAEAFAIAIYFRAI', 'GMpDIGMBZBaBDCYCAGQGbGjGrGCIFIBIHIIIGCDYEYJYKYCRFIBIHIIIECDIGSEYDCGAIYJYKYCYCAKJAALaKQFRAJBIHIDIEIGBJYJQGQIQDQEQHaBACADIFAAIIIEQJIGQHQBaCADAFAIAAAAZFRCIDIBIHIGBJIEQEYIYJYFYCSDIDQBJFAJIEIGRHYHAIAAAEAJYFQGAIIEAJALALIGREYIYFAKZCQCYDSFIAIIIEIJIEQIZAA', 'GMrDLGBBbBcBCCdCDGTGYGgGoGCYFYBYHYIYGCEIDIJIKICSFYBYHYIYDCEYGSDIECGAIIJIKICICAKZAALKKQFRAZBYHYEYDYGBJIJQGQIQDQEQHKBACAEYFAAYIYDQJYGQHQBKCAEAFAIAAAAJFRCYEYBYHYGBJYDQDIIIJIFICSEYEQBZFAJYDYGRHIHAIAAADAJIFQGAIYDAJALALYGRDIIIFAKJCQCIESFYAYIYDYJYDQIJAA',
  'GNEBiDDBFBSBTBICJDgDoDUFAGqGEYFYCRHIEALIGAIABZMIFRCYKYDSAIAQHILJCBEAIIIABAFAJAMaDQAQHIKQIJCQEQLZHAAADAIAKAMKFQCQJQBQEQGQIZLYHYHQLKIAEAIYCBFBBIJIGREYFYCRIIIQLaHAHIIJCAFABAJALIEAGAMaDQAQKQIQHQHYLJAACADAFAIZKAMKGQEQJQBQIQCQFQLaAADAHAKABKIQIIFRCYKYDYAR', 'GNIBhDJBMBNBYCcCdCADqDKECGZGBILIIIAAFAJZBQMQCQKQIQLZDAEAGAHABJJJFQAQLYDYGBMICRGQKYDRIILJAAAIFCCYCAJZBZHQEQMYGREYHCGIESDIDAEABIJICQFQKIARIYLZDADYHYGCEIEQGQHRDILIFACAJYBYHQDQLJIAAAKAMABABYJJCQJYMYHYEYGRDIECHIBIJICIMIFSAYIYKYEYDYLYGCHIDSEIKIAIFBCYMIAS', 'GNYBBDLBbBACMDhDkDpDJEUEDGrGAQEQJQBQLaCADAFAKAHAGKDQCQIALIEAAAMaDQCQGQHQKQBKCADAJAIAMIAQEQLYCADAHaGAMJHQGaDQCQKQBQFQLKEAAAJAIAGAHAMaDQKQGKIQJQLZFABAGAIKCQJQBaCAFQLJBAJAIaDAKAMKAQEQHQIQJQBQLaCADAFAGAKAIKHAMZIQHKDQCQJQBQLIEAAAMYDQCQGaCADAKAHAIAMKJQBQ', 'GJADqGCBIDoDLGQGYHTIBIFAIABAELHQGQCQDQAQFaIAGKHAEbBQGQIQFKAACADAHAEABaGQELHQCQDQAQFaIAEAGABKHQEbIQFKAADAEAHABaGQIQFQALDADJEBCZFZAQDJEJCAEYHABAGaIQAQFJEQDaFAAAIAGKBQHQCQEQAaIAGABKHQEQAQDQFaIAEKHABaGQEQIQFKCADAAAHABAGaEQBKHQAQCQDQFaIABAEAGKHQAQ',
  'GJFBQCABEBDCcCUDBFZIBQFIIIBICTHYEYDYAYGYFCIIESHICDBYEYIYFSAIDIGIHICIBCEYCTHYDYAYGYFCIICIEIBSHYCDIYFSAIDICIHIBCEYIYFYATDIDRCJGBFBAYDRCRGICAHIBIECIYAYFRCYDCFIAIIIESBYHYCYACGYIIEIBSHYCYAYDYFCIICSHIBCEYCYIYFSDIAIGIHIBIECCYBSHYAYDYGYFCIIBICIESHYAY', 'GLCDgGBBVBlBACKCEETEjEoGCRAYCAHYDBEBJIBIKIFSAYCYGYIYEYDRHIIBEZDZJBBJKJERDYEYKYDQIQAJCAFAGAEAKZBQDIEIGRJQHQAJIAIYDCEIGIFICSIYDYECGIDSIICCFYDYGYESIICIFBDYCSIYECGICIDIFRIYCCGYESCIIIFBDYGYEYCSIIGBEYCYIQAZHAJABAKKDQEQFQGQAZIACACIEIEBDJFRGRARIZCBEBAJAQ', 'GLJBjDaBICrDKEMEgEAGDGbGBICQEICIHIDRAYFYKZGQJQIKFAKACAHAEaBQGQKJFQIaJAKACAGABAEKHQHIDIASFYAACYCAHAEZBQGQKQJQIKFADAEZHQCQFIACDYCYHAEJCRDQAQFQIaJAKAGABAEJHQFQFIAIDBCYASFYFAHAEZBQGQKQJQIKDACAFAABEZHQAICIDRFYABHAAQEJCQDQFQIaJAKAGABAEJHQAQAIFIDBCYHYAR', 'GLUBACiBLCVCEDMDRDjEYFBGEQHACBIYARGQFQKJHACACYDYFYGYEBAIIIDRFYGYEYACIIDIJIBSCYFYGYDBIYASEIDIFIGICIBCJYIYDRFIGICICQFZGACIFQGZCACIFIFQCYGQHQKZDCAYERDICICQHJGAFAFYCYABIIJIBSFYGYHYABCIHQKYAYCBGIHIFIHQAQCQKJBCJYHYIYEYDSCIAIKIGAFAHAHYAYAQFJHAAYFQHJAAAY',
  'GMBDhGFBKBACYCdCpDrDDETGZGBIDYKYGAIIHILIFIESAYDYFBHYJYCYGBBIHAIaBQLILQKQCQJQAKDAEAFAKIHAIABaLQKQHKIAIIKZHQGQAIJAIAKAHaLABKHQHYBYLZCRGRIJIACAJQAZIAGBBIHILJHABaLQHKKQFQAYIYJQIQAKFAIYIAJAKAHaLABKHQHYBYLZCQGRARIJJAAZCBGBBIHILJHABaLQHKKQAQAYJQIZGAHAKJAQ', 'GMKDoGABQCdCEDbDrDMEREBGiGAYIYEBHIBIDQCQKYFYEAGILYGQEQIQFQKKAAAYFZIAKYEAGAGYLJEQJQFQKIAIAQKaEAGIIAFJJALZGQEQFQIQKKAAAYJAKYEAFILAGaHABJGQLQJQFYEQKIAIAQKaEAIAFAHAHYLJEQJQFZIQKKAACADAFAJAGABaLQEQHQIQFKAQKZFAAKJAAYGAHZIQAQFQKJJAAZIAHJGQAQJQKZFAIAHAGJAQ', 'GMKDoGYBACdCEDbDrDMEREBGiGAYIYEBHIBICQDQKYFYEAGILYGQEQIQFQKKAAAYFZIAKYEAGAGYLJEQJQFQKIAIAQKaEAGIIAFJJALZGQEQFQIQKKAAAYJAKYEAFILAGaHABJGQLQJQFYEQKIAIAQKaEAIAFAHAHYLJEQJQFZIQKKAADACAFAJAGABaLQEQHQIQFKAQKZFAAKJAAYGAHZIQAQFQKJJAAZIAHJGQAQJQKZFAIAHAGJAQ', 'GMRBFCbBdBgBICUCDDKEhEAGrGAAGAJALZDQBQHIKIFAEALYCQCIJIEILIFSAYAAEBFAJYLYCYCAGRIIEILIFQAQAIFCJYERIYGBLYCQCIEIJILIFSAYAAFAIYLYEQGYCCDYBRCIGIIIEALIFQAQAIFCJYEYLYDYDAGRIIEBJILIFSAYEYIYCYKYHYBCGIDIJILIESAIFBEYASIYAACYDBJIAIEIFRIYABJYDRCIAIIIFBEYJYDYCRAI',
  'GMUBACYBaBlBNCRCBDKEjEDGoGAAGAJALJCQBQHYKYFAEALIDQDYJYEYLYFSAIAAEBFAJILIDIDAGRIYEYLYFQAQAYFCJIERIIGBLIDQDYEYJYLYFSAIAAFAIILIEQGIDCCIBRDYGYIYEALYFQAQAYFCJIEILICICAGRIYEBJYLYFSAIEIIIDIKIHIBCGYCYJYLYESAYFBEIASIIAADICBJYAYEYFRIIABJICRDYAYIYFBEIJICIDRAY', 'GMUBYCFBIBKBJCVCpDDEaEAGrGAQFQIQKJDABAHYLYGQCQKIEAEYIYCYKYGCAIAQCRGQIIKIEIEQFBJYCYKYGAAAAYGSIICBJIFRKIEAEYCYIYKYGCAIAQGQJIKICAFIESDIBBEYFYJYCQKYGAAAAYGSIICIKIDIDQFBJYCRIYKYGCAICIJIEILIHIBSFYDYIYKYCCAYGRCIACJIAQEIDRIYAYCYGBJIARIIDBEYAYJYGRCIIIDIEBAY', 'GMaBLDTBCCdCUDgDjDrDIFDGoGBICAHAIAJALJGQAZHZIZCRBYCIFYEBIILIGIAQHYIAGALZCQCIIIIQHKAADQKYEACALJGQGYIZLYCQEQKIDAIALALYCYGJAQIYHYCAGJLQHQHYCYIIAALYCQIJDQKYEAIICAIQEQKIDAHALIAQHYCYIYIAGAGYLJCQCYDSEQBIFYFADALYEQBQBYEBFIDBGILICICALZGQIQIICIHIAAHQLYCQBQBZ', 'GMhBdCDBNBcBgBEDQEaEAGIGSGEQIQLQCQDYGYBCEIIIAILIABFJHRAZFBFYIYEYLYBSDICIGIJIKIABFYKQJQGaCADALYEBIIHIFRKYLYEYCRDYBCIIERKILIFBHYEYIYBSDIDQGKCAJAKALIFIARJYGYKYCYDYBCIILIEBHJFREYFYERAJEBFBHZARIYLYBSDICIGIJIKIFBEYKQJQGaDALYCQDYBCIIAIHIERKYLYABIYBSDICBAI',
  'GKBDiEFCKCTDoDsDDEcEQFAYDABAJAFAGbBQDQIQEQEIHQAKDAJAFAFJGBBZFRGJGQDQEYJQAaHAEAIAFJGQIYCRHIAJJABAGZDREYFYCQHQAJEBDBHYCBFIGJBQJQEZDAAYCAIIGBFZIQCQAIGIDREJJABAFZDQHYIYCRAREJAAHADAGAGIIAFKBQDQHQJQEbHAGZAQHJEJGADAAYJABAFaIQAQHQEJGAHYCBIIFJBQJQGZDBAYAQ', 'GLCDoGBBRBjBECFCICgDcEKFIIHQCYDBJQFQGQAJKAIAIIHICSDYDQHBIYIQHQKQAbFAGAJAKAEABKIQEYHQIYEQKQAJDADICCHYDSCICQAZKAEAIIHQCYDBEYKRAJDAEAKAIAIIERBYDRAZDAKAIAIYJYGSFIKIDIDAIAEABYJYGYFSKIDIDQAJCACIHCBYEYJYDSIIIAJAJIEICQHRAZIAJADABIEICRHQARIZJAAJCBCYEYEBDZAR', 'GLCDrGEBUBiBACBCFCkDYEKFIYHRCIDBJQFQGQAZKAIAIYHYCSDIDQHBIIIQHQKQALFAGAJAKAEABaIQEIHQIIEQKQAZDADYCCHIDSCYCQAJKAEAIYHQCIDBEIKRAZDAEAKAIAIYERBIDRAJDAKAIAIIJIFSGYKYDYDAIAEABIJIFIGSKYDYDQAZCACYHCBIEIJIDSIYIAJAJYEYCQHRAJIAJADABYEYCRHQARIJJAAZCBCIEIEBDJAR', 'GLEBjBDBFBhBCCaCYDIEkETHEYIAHAGYFSHIIIEDGYFYBYHYJYKYDTAIARCJIJEJHBFBGBBZFRJYDYARKIERHIEAEYHYIYCYKYADDIJIKIFIBIGREYBCFYJYDYKYATCIIIHIKIBIEIGCFYESBYKYCRIIHIBAKYCYABDICRKIBRHYBAIYABDBCIJIEIFIGSBYFBEYHYJYCYDRKIFIBIGBEYBSFYIYAYKYDDCIJIBIKIBBEJFRGRHRIZAZ',
  'GLIBUBNCYCLDkDsDaEBFDGpGAADAHYBYFYCQEIBAFAKYGYGAKKDQAQHQIQJaEABIEYCBFIIIAIDBHYGYFQCQEIJIDAHAKaFQFYCRBIGIIIHIDRJYEYBACAFIKIDQAYHBGZHQIQEQEZJJAADAIAKYFYFAKKDQAQJZIAFAGJHRFZFAGAGZIREJFAGAHAJJAADAKaCQIQGKFQAIFIAQJZEAFAFIAIGYBQEIJIDBHYARFZGZBZERJJFAGAAA', 'GLKDrDABBBMBFCQCRECGoGbHBIHQAQDQIYEAAIDIJIGQCQCIGCHYJYBYKYFSEIAAEQIJDAKABAJJHQCQDYIYEAFAJIHIGSDYDQIZAACAKAHAJZFQEQAIIIDAGAJYBQHJCRHYKYEYERFBBIJIGQDQKIDIGCJYBYFRKIDICBHZDRCIDICRKZEBDICIFBBIHIJIGSIYKYCCDYBADABYFREIDICRAYAQIKKAGAHABZDRJYCRAREZFBDICIBI', 'GLYDkDCBIDcDsDDEgEaFQGTGDAGICIJAKaCQGQDLCAJAKAAAHAIAFbBQBZERGRDRCJJJKJABKZHAFABZIQDZCQDICADAGAEAIABLFQHQIQKQAQJZDAAKKAHAFAIABbEQGQCQIQAQDQJKKADaAAIAEZGQCQAIIAEABJFQEZIQAZCAAIGABJFJEQHQDQKQJaAACAKJDAHAEAFZIQKQAQJJDAAaKAGABAIAFLEQHQAQIQAJDRJZKZCZGBBB', 'GLoGCHQBUBlBNCSDgDAEZGiGFAEAAKHQHICRJYKYDQGIJACAKAHAAaDQDYEQEYFSBIGIIIJICCHYJYGYKYGQJKKAGaDAEAAJHQGQKQJaDAEAGKHAAZGQDQEQJKKAHAAAGaDQEQHKKQJaHADAEAGKAQFAKQJQCQHZDAEAGAAKKQJQCQIYBYFBGIJICQHYDYEYGAJJDQDYEYEQGYHKCADAEAJaAAKKJQCQDQEQHaGAAAKAJKCQDQHQGaBQ',
  'GLqDDGCBUBkBVCYCZCMDIESFIYFAEIDRJAGAHAAZKQIQIYFYECDIDAFRIIIAFAKAALGQHQJQKQCQBaIACIFAIICAKAAZDQDYESFIDCEYEAAJKQCQIYFAEIDRCIKBAZDQCQKQIQIYCBBIDBAJDQKQIQIIJIGCHYKYDYDQIQCQBIJIGIHCKYDYDAAZEQEYFSBICIJIDCIYIQJQJYCYEAFBAJIQJQCYDQBYEBFAABIJJQAZERCIEICRDJAB', 'GMKDhGFBVCYCADZDpDIETECGrGAIBIIIEBHYLYDQCQKIFIEAGYGQEQIQFQKaAAAIFJIAKIEAGABZGIEQJQFQKYAYAQKKEAGYIAFZJABJGQEQFQIQKaAAAIJAKIEAFYBAGKHALZGQBQJQFIEQKYAYAQKKEAIAFAHABZHIEQJQFJIQKaAACADAFAJAGALKBQEQHQIQFaAQKJFAAaJAAIGAHJIQAQFQKZJAAJIAHZGQAQJQKJFAIAAZGAHJAQ', 'GMRBMCABLBNBQCdCoDBEaEDGqGAQBQIQKZEAGALIHIFQCQKYDADIIICIKIFCAYAQCRFQIYKYDYBBDQJICIKIFAAAAIFSIYCBJYBRKYDADICIIIKIFCAYAQFQJYKYCABYDSEYGBDIBIJICQKIFAAAAIFSIYCYKYEYBBEQJICRIIKIFCAYCYHYJYDYLYGSBIEIIIKICCAIFRCYACJYAQDYERIIAICIFBJYARIYEBDIAIJIFRCYIYABDYERAI', 'GMRBUCbBdBgBFCICADKEhECGrGAABAJALZDQFQKIHIGAEALYCQCIJIEILIGSAYAAEBGAJYLYCYBRCAIIEILIGQAQAIGCJYERIYBBLYCQCIEIJILIGSAYAAGAIYLYEQBYCCDYFRCIBIIIEALIGQAQAIGCJYEYLYDYBRDAIIEBJILIGSAYEYHYIYCYKYFCBIDIJILIESAIGBEYASIYAACYDBJIAIEIGRIYABJYDRCIAIIIGBEYJYARCYDBAI',
  'GMUBRCYBaBlBACNCEDKEjEBGoGAABAJALJCQFQKYHYGAEALIDQDYJYEYLYGSAIAAEBGAJILIDIBRDAIYEYLYGQAQAYGCJIERIIBBLIDQDYEYJYLYGSAIAAGAIILIEQBIDCCIFRDYBYIYEALYGQAQAYGCJIEILICIBRCAIYEBJYLYGSAIEIHIIIDIKIFCBYCYJYLYESAYGBEIASIIAADICBJYAYEYGRIIABJICRDYAYIYGBEIJIARDICBAY', 'GMbDJGMBiBACFCdCBDDDjERGYGDZJZARCRLIEQHYIYFYGCAICIFRIIJIDIERBYIQHKBAKYKALADAJAAaCQFQGQLYIQHQBKKALAIaHQHYLJIAEAAYJQHQLQIKKQBaIAIIBIKJDBEBHZHQDQJAAJHQERBYIYKZIQBKKAIaLAFAAIHIJAHAAaFQHIHQJQLQIKKQBaIAIIBIKJDAEBABHZJQAJDRERBYIYKZIQBKKAIaLAAAAIJAHJEQIQLZAA', 'GKECaCDBTBhBjBYDcFQGAHAICIDBEYIJGABYFYHYASCIDIIIGIJIEDBYFYGYHYAYIYCTDIDRJJEJGBBBBIFYBRGREZJZDBDYCDAIHIBIFIIIGIETGYIYGQJYDYCYACHIBIGIEBFYGREIEQFBGYBYHYASCIDIIIBAJIFBEYBYHYAYIYCTDIJIBBEIFSBYIYJYACHIEIFIGIBSIYJYAYDYCDHIASCQIJJIBCFYEYGYAYHYCSDIIIAAJIBI', 'GLNCAITBZBaBlBLDjDrDDGoGCIDYEYHYHAIAIYCRHIHACAKJDQEQBQJaAAFAGAHACACYFYASGIHIHQGQJKBACAIAIZCRGYHYABKIEIEAKZFQFICICQEIIIDAIQKYEQHQHZCBEBFZARGIAAEAFAKKDQIQHQBQJaEAFAGACAHJIAKZAQCIFIERGYGQJKBADAIAHZFRKYERGRCZABFIEIKIDQIYGYAYFCEIEAHJKJDJIRGZDAIAKaHQHICSAY',
  'GLpDAGDBEBFBKBYCQDsDUFZHCQHAGAAYIZJQDQEQBKHAFYHIGBKYCRDZEZJBIJIAALCQEQKQGQHYDAEYCCKIGRFYEYEAKADQHIFAGAAbIQIZJRCJDJEJHRFJGBFYKYERHIFQBZCADAHJEBEYKIGRBYDYDQBJFAGBKYDRHYCQBIEAHZCZJBIJIAALDQKQHQEQFQBZHYJAIAIZABDJKJHRIZIQGQAaGAJQBJEAFAAAIAIJHBKZDZJRCJAJAA', 'GNABLCBBCBcBdBiBjBDDUDsDgEQHIIBAHAJAEAKYFQEIHIBRHAIYJYEBHIBIMIARCYDYIYJYEYHBFBKIGILIARCRDYIYJYEYHYFBBIHSEIHAIIJIDICBMYHYBYFSEIEQIJJAHAGAKYFQEQIQJJHAHYGCMICRDYHYGYIYEAFAKILIAICRDRHYGYIYJZEAEYFCBIMIABCIDRHRGYABMYBYFSEIEQIIJJAIGIHBDBCYLYKYFQEQIIAIGIHIDBMYAS', 'GNCBlBFBVBZBaBgBICRDpDDETEjEAYHAGAJYFQKYCYDBBBMIFIEIGIHRAYKYCYDYBBLICRKIAIHBGYEYFYFAJJCQGQIIEAGIHSAYEBIZGAJYCQLYBRDIKIFCIIHAJYCYCAMYBRDRJIHQIYKIFICCLYDYBBMILQFQIIHAJYLQFQKYBBDIFIIILAJJGQERCYKYBYDBFIBRKICIAIHBGYGAJZEQIYLQBYFYDRKIBBIILAJJEQARCYBYKYDBFIIIBQ', 'GNJBqGDBMBNBQCEDSDoDZEAGbGjGBIIIFQAYHYCQHAJAIAKIAAFABaMQLQCQDQEQGQKJHAGaCADAEALAMABKFQAQIQJQGQHQKaCADAEAGKCQJAIAKIAAFABaMQLQGQDQEQKJHAJAGaLAIKGQLZIAMABKFQAQGQHYKYEAMZIQDQDICIJIAIFBGYBYMYIYDRLJEQKIHIFAMAGABZIQGKMQLaDAGAIABKMQLQFQGZHYIAKYEADABAMKLQBaIQGJAQ',
  'GNMBACVBgBhBiBCDEDbDrDYGjGJHCAIIKIBQGZHZAACAIAKJEAFAJZLQKQIQIYCRAIHIGIBADAMIEBDIBSEYEABAJYFQIYMYCYARHIHQGKMAIAFAJIBQIZFAFIIIBAJYKYLYARCIFIIIIQMQGaHAHYCBABLIJIBQEQGYHYFBAYCSFIFQHJGJEABAJYLYCQFQHQGJMAIAIYAYFYCBKILIJIBQIYAYAQIJBAJYAQIQMQGaHAHYCBFIIIAAMIDBAY', 'GNUDBGSBTBgBhBACYDcDEEJGiGqGLIMICRHIEAHACAFAMaLQDQIQAQHKCADAFAIaLAMKIQIYCRFIEIEAGRBYKYDBFICBIIIAMaLQIKCQEQFQHaDQJQBKKAGAHACAEAMALaFQDQIQAQJQBQKKHAEAHYCBDYFBLIMIGREYDYCRHIHQKaBAHKCADAFAMAAaIALJAQMQCQDQFQHaBQKKEAGAHABZJAIAMJAALaMQIQAIDQJQBJCACYFYFAAAIZJQBQ', 'GNZBDDCBLBMBbBdBFCSCYCcCIEpGGQHQBILAJAMYFQDQCILIJBAYIYDYCRDQLIIBDYCYCQLQBZEAFAHAGAKAMKAQCQDQIQJQBZLAFAFYKYESHYGCEIHRLIBIFACAJAAAMYEQGRLIBIIADAMZKQFICBDIIRBYFAKAMJAQIQCYJQBYFYLYGBEBMIDQFRLYGYEBHIKIFIFQLQBJCADAIAJAAAMaFQHQEQKQGQBJLADADIIIAIJRCYACIYDYDQLQBZ', 'GNdBJDACFCUCYCBDDDLDiDpDSErGJYLYEYAYAADRIIEAJJLQBQGQHZIADAIYJIEQGJBALAKAMZJQDQGIEAKJLQBQHQIZGAAAGYDBKIKAJAJYMJLQBQHQIQGZAAEAKYDRAIEIGIHIIICIFCBYKYEQLYMYDQAQGJIAHAKABJLAMZJQBQBIKQHQIQGZAADAEAJIKILIMIFSCYGYHYIYEYAYAQDBKIEQGJIAHALABZKQAQKYDRGIGQIKEAHALABABI',
  'GNgBkBQBTBlBZCADIDRDiDqDUECHMIGIHICBIYDYLYEBBIJIDQIICRGYHYMYEBBBJIJQLQIJFAKYJYBRERMIDCFICIABCQKYAQFQIaFAJYLABYERLIFIDSGIHIIIACCYDYIYFYLYEBBIJIFQLQIKAQGYHQMYEBIIHIAICBDYARHYIYERMIHAFAKIDQCQHYFBAICIDBKYKAJaAQLQIQIYEYBBLIAIJIKIDRCYIYABLYBREIAIIICIDBJYKYLYAR', 'GNgBlBCBVBaBADIDjDpDrDTEQGDHAAEYHYIYJYBYDRKIHAJAIJAQEQHZKYDBBIIIJIEIEAIZJQKQLJHAAAEYIYJYKYBYBAJJIJAQEQHQLZBAJAIJKQHJLIABEYKYIYJYDRBIHILIAIEBKYIYJYDYBRLICRFIGIEBAYCYLYBBDIIIJIKIARERFYGYMYBBDBIIJIKIAIERCYABKYIYJYDRLIAICIEBKYARLYBRMIFIGIEBCYHZLYBYDBIIJIAIAA', 'GOBBcBABCBDBaBlBECNCTCYCpDrDQGFYIAGAMIJQNIKALYJYBYGYMYISHIEIDIAICIKBFYNICSAYDYEYNYHYICGIBIMIJICIFILIKSAYDYEYNYJCBYGYMYISHIJIEIDIAINIKCFYCYBYGYLYMYJSEIDIAINICCFIKRCYFCBYGYNYJAMILIKQNYDSAIFICINIKCBYLYMYJQNICSFYAYEYNYJCDIGICIBIMILIKSFYAYEYNYGCDYNIKALYMYJSNIAQ', 'GOaBLDCCNCIDTDbDgDjDoDqDsDQEDGEAIIMAHAJAKZAQAIKICRNYDAGIAAKIJQHQMQBaNQEKBAMAHAJAKZAQCQGYDQEIBJMAFaCAGAAALZIQAIDQNICAJJHQFQMQBZCAJALAIZAQJICQBJMAFAHALZCQNYDAAIIICQJQGQFKCAMQBZEZDAAAEIIIKJLQHQMQNZEQBKNAEaCAFAGAJAHKCQMQEQFaBQCANJFAEAMAHaCQJQGQBQEKCAMAHAJaGQBQ',
  'GKTCYCSBACFCLDhDBEcFpGCYFAAAGICQHQFZAAAIFIHIDIBCCYGYDQJYIYESAIHIDIBIBQFZCBGYDQHAHYAYECIIDIDQGICRHQFJBABYHYDBGICIJIBSHYDYHABACAGYJYIYESAIIBGJCQGYJJBQHQFZIAFIJYEYASIIDIHIBCCYGYJYDRIYACEIDIGICIJIBSFYHYIYAYECDIASIIFIHIBCCYGYJYAYDYESIIFIHIBIBQFZCBGYHAAAAY', 'GKYBDFCBNBlBcDAFZGiGqGAQHYFYIYJYEYDSBICIFIGIHIADHYIYJYCTBYFYDDEIEBCJFRHJIJASGYBYHYEYCBFICQIYEQBIGIACHYIYEYCYDSBIECCYCAFYFAJKIQFaCQCIESBYDCCICAFIEIHIASGYBYECHIJAIKFQFYIYJZCRDREIBIGIACJIFBIZJZCZDRDYETBIEAGIFAHZCADAIKJQHQFQFIGYBYECDICIDAHIASGYBYCCFJHJAJ', 'GKhBDFFBKBlBcDAFZGiGqGAYHYFYIYJYEYCTBIDIFIGIHIADHYIYJYDSBYFYCDEIEBDJFRHJIJASGYBYHYEYDBFIDQIYEQBIGIACHYIYEYDYCSBIECDYDAFYFAJKIQFaDQDIESBYCCDIDAFIEIHIASGYBYECHIJAIKFQFYIYJZDRCREIBIGIACJIFBIZJZDZCRCYETBIEAGIFAHZCADAIKJQHQFQFIGYBYECCICADIHIASGYBYDCFJHJAJ', 'GLDBiGSBdCQDbDqDEEYFIGTGJAEAIAGZBQCQFQKYDABICQKQAQAYHYDBHQJJEAIAGAKICABaFQKQDQJIAACAKYDRHICICAKAFABJGQFaKQCQCYHYDBKICQAQBIJYDAKABAGLFQFJIRAZCBBYKYDRJIEIAAIAFZGZDQHICIEQJZHADAGJFJIQAQEQJYCAEJAJIBFZFAGbBQDQKQEQCQHQJKAAIAFAKZEQCQCYEAHYDBKKCQGABZKQEQEICIAS',
  'GLQDoGABBBYBbBcBMEZECFrGGIFIHAFAGAKABKEQIQAQAJCRAYDYJYFYFBGZHRFJGBGIJIDICBAYAAEAIABaKQHQHYFSGIJIAIDICIECAYIYDSJYGYFCHIHAKABKDQIQAQAJIBDZBZKZHRFRAIGIJICICREJIBCZEREYAYJYFYFBHBBJKJDJCRERAZAACADAEABaKQHQHYGSFIJIDCAIHYGYFSJIDIIICCEYHYDSAIIICIECHYHABAKaDQAQ', 'GLRCcDDBQBSBFCbCTDkEoGAHCIEQKIDBAYEYHZGAJIAQHYGYBYBAIAIYJJFRCIGQHIKIDIACEYGYJYFQBIHIGAJZIQHQHIGIEIARDYECGYHYHAIAJJGQHYAQBYFAJIGIAIDTEYERKZBBHJAAGAJZFQCQBIKIEBDBJYIQHQCYFBIIJIDRERKYBYCYFAHICRBRKJEBEIDDAYGYCYHYJYIYFSBIKIEIGBCYHYHACIIAJJGSDIABGYCYCQHYHQBa', 'GLUCYDCBbBdBBCaCSDgErGDHFYCYKYECAIDIHIGAJYAQHIGIBIBAIAIIJZFRCYGQHYKYEYACDIGIJIFQBYHYGAJJIQHQHYGYDYAREIDCGIHIHAIAJZGQHIAQBIFAJYGYAYETDIDRKJBBHZAAGAJJFQCQBYKYDBEBJIIQHQCIFBIYJYERDRKIBICIFAHYCRBRKZDBDYEDAIGICIHIJIIIFSBYKYDYGBCIHIHACYIAJZGSEYABGICICQHIHQBK', 'GLdBoDKBLBbBACUCEEBGrGYHBICYDYEBKIFSCYDYEYIYHYACGIHQIJCADAFABYJYGQAQIIEAKIFICSDYEYHYAYIYGCJIBICQDREYFBKYARAIHIKIFREIDBCBBYCQJYAQGQIIEIEQFBCIDSFYCCIYGAAAKYAYCQGSHIEICIFIDCKYERHYGCAIEIKIDSFYCYHYEBAYGSEIABKICRHYAYEYGCJIBIKICIDIFSHYCBHADABAFAJaKQAQGQIICAAY',
  'GLiBJGbBACBDSDcDgEEFYGrGFYGQIQEKBACBFAJIDQBYCAJAAAAIHIDRHAJYCQKZGQIQEQBKFAJADAKYAQCQJIDBHYCYCQJQFQBZEAFKJACACIHIDRJYCAAABYKIDQJQBQEbFAFZIBAJCRBIJIDBKYGYAQIQFJEJDAHYCYGAKJHQDQEZFZIAAAGAKICQGZAZIRFJFQELBADAJAGACAHAKaAQIQFQJJGACACIGQHIDRJaCAEQBJJAGAGYCYAC', 'GLjBKGSBFCDDTDYDkEAFbGgGKQGQIQEaBACAFAJYDQBICAJAAAAYHYDRHAJICQKJGQIQEQBaFAJADAKIAQCQJYDBHICICQJQFQBJEAFaJACACYHYDRJICAAABIKYDQJQBQELFAFJIBAZCRBYJYDBKIGIAQIQFZEZDAHICIGAKZHQDQEJFJIAAAGAKYCQGJAJIRFZFQEbBADAJAGACAHAKKAQIQFQJZGACACYGQHYDRJKCAEQBZJAGAGICIAC', 'GLjEDGgBlBQDYDaDhDUELGAHEJFACAGYCQHQGQEQFQKQBaJAIAIYDCAIAAHKGQEQEYAYDRFIIIKICCEYFYAYGYAQFKEAEICRKYIYDBFIFQEKAAAYEYFYHZDSEIHIIIKICBAYFYFAHAGKAQAICSFZEZIQKYJQBKKAEAFAAAGZHQAIFQEZAAGAGJCJFRERAZCBGYIYDBHIGQELAQCQKQBaJADAIACIEAHAGJFJAQKQBQJaDAIACAHZEQCJKJAB', 'GLlBYDIBKBjBkBBCaCDEgETHDAIIDIHCBIJICSBYGYHYDYIYKYADFIFBEJJJCJBRGRHRDZHBIYAYFBKICBBICQBYCYJYEYKYFTAIIIKIHIDIGBCYDSHYIYAYKYFDEIJIBIKIDICIGSHYCCDYKYEBJIBIDQKYARFYEBAIKIDBBYDQJYARERFIIICIHIGCBYDYHRCYIYFYEBKIHIDIGRCYDCHYJYAYKYETFIFRIJDJCJGBHBBBJZAZEZFRKIAB',
  'GNTDpDVBZBgBlBICrDBEDGLGaGiGIQJaKAAAAIIIDBLYCYFBMIBAHZMQBKLQDQIQAaKQJKAAGAEAKZCAFABALJHAMaLQHKDQIQKQAQAIJZCAKIDBIYBYHYFRCICQJJDAKYCYFBBIHIIIEIGRDYAYAAKAEAIAHaLAMKGQDQAYHQJYFALZBQCQCIIIEIKIDIDQGBHYLYBYMYCRFRJIAIKIAQJaKAFACAIABALJDQMIHIGRAYAQJQKaFACAIALIEQAK', 'GKFBgBICVCADJDRDTDDEZIDQDYATIIFIFAGAHZIQFJIYACDIJIBICRGYHYIYIAHKGQGICBBYJYDYASHIHAGKIQEJIYGYHYACDIJIBICRIYIAGaHQEQFZAAAYDCGIJIGQIQFZEAIICBBYGRIREQFJCACIBDGYHYAQIYBQJYDSAIFJEAHAJAGKIQCQEZHAJAIIBSCYJYAYARFRHJHQELJAIAIIBICRJYEYFYHYDCAIGIIQFQFZAYAAAYGBIJBJ', 'GKcCYFSBVCADTDiDqDIGDHBAHZGQCQFYAAGJHJBQFZCAHAGZAQDQJQELIAEYFABAGZHQCQJYDCAIHIHBGKCQHQJQFKBACZFYGZHQJQFQEQEYIJBACAGYHYJYAYABHJHAGLCQJQBQIZAAHAHZGBJJCJBREZFZHBCBGYJYDSAIHIHAEKIQHaEAEYGBCJFJFQIQGaCBFIGJIJBBJZFRIQGQEQHJBAIZCSAYCYAREJHJGBCBCYAYEQHQGJCACIBI', 'GLABdCMBNBTBhBQCcCiEJFDGGQAQKaCACYDYBCHIDSCIEIJIFCIYDYERCRFQKJAAAIGCIYDYEYCRJIDCIIDQGSAYFBDYJYCCEIIIDRFRKYCAEBFAIIDIGIATFYFAABGBDZIZEREYCTJIGIAIFRKIABAYGYJYKYCDEIEBIJDJFRFIATGYFCDYIYERCRKIFADBAIGRFYDBABIYEYCRJIAIDRFIGCIYARJYCCEIAIIIGSFYKYCAEBAIIIDRJYEYAB',
  'GLCDkEZBbBMCNCSCEDKDAFpGCYCQJQAZHZEAFABAKJGQIQHQAJJAGYDYBYKYFSEIAIHIIIJICDGYDYBYKYFYESAIHIIIJICIGCDYCSJYAYHYIYECFIBICIDIGSJYCCBYCQFYESHIIICIJIGCDYBYCRHYIYECFICIBICQDIGSJYAYHYIYEYEQAJFBCIERHIIIJIGCDYBYKYEYCYFRHIIIECBIDIKIGSJYEYHYIYFBCIBIERHYHAIABACYFRIYAQ', 'GLFBYDDBEBhBjBCCaCIEkETHEYIABAHYGSBIIIEDBYHYGYFYJYKYATDIDRCJIJEJBBGBHBFZGRJYAYDRKIERBIEABYEYIYCYKYDDAIJIKIGIFIHREYFCGYJYAYKYDTCIIIBIKIFIEIHCGYESFYKYCRIIBIFAKYABDYCRAIKIFRBYFAIYABCBDIJIEIGIHSBYFYGBEYJYDYCRKIGIFIHBEYFSGYIYAYKYCDDIDBJJFJEJGRHRBRIZAZCZDBKIAR', 'GLMEQFABBBSBbCKDcDoDkECGFAIJBQDQEQKYAAHAJAIJFQHZAQKJDAHZFAIZJQAQGJDIDQKZGAAAJAIJFQDIEBFYDSEIDAHIHABAFAIbDQEQJQAQGQKJHAGaAAEADAJAILBQFQGQGYEYDBFIESGICQEAHQKaDAFAIZJQAQDJHJGAHAGJCJBBIZBQEQCQGaHQKJGAHaFAEICRFYECCICAIJBQFQHQGQKZEAEIGJHABAIZCQAYDREIFQGIGAAAAY', 'GLQCjEABBBECFCLCdCCDREoGJQDQDICIABCQIYGABAJYDRKJJQAQIYGYEYFYHCBIDIGRIIAAJAKZBQDQEQFQHQIKCAEADAGBDYESGIDCJIARCYDYGYECJIDSCIABDYJYESGICIAIDCJYCSGYECCIJIDSAYGYEYCCJIDIKIASGYDCJYCSEIDIGIACJYDSEYCCDICQJIASGYEYCYIZDBFAHABAJIKJAIGSEYACJYBYKZHSFIDICIIIAIEIGCJYAR',
  'GLRBcEMBQCEDIDoDKFBGhGqGCIIYEYCABAJJKIGIGAKaJQGKAQHQEQFIIJDBAYHYBYCREIIYEACAFJHAGaJAKKAQDQGQIYEYCABIJZBQCQFQEQIKDAAAHAJAGAKaBQBYCSEIJJHQIZEAFAJABACAKKAQDQGQHQFZEQIJFAEaJABACAKAGKHQEQFQIaJACAFJEAHAGaKQBQBIFQEJHAGAGIKZBQCQFQEQJQIKDAAAHAAIDSHYIYJYCBEIFIGBAJ', 'GLUBIEZBNCEDkDrDSFBGKGoGCYGIIYEYKICQBQJZEQIKJAEaAAHAFaGAGYDRAIHIBICBFYKIFQCQGZHQEKJQIaAADAEAJJKIFICQBYBACAGAFAKaDQAQHQJQEQIKBABICCFYJZHAKJFQGQJQBQCQIaAADAEAHAGJFAKZGQFKJQBQCQIQEaHAFAGAKKJQCQGZFQHQEKIABABYGAFZHQEQEYIJBACAGAFAJAKaDQAQHQAYDCHIJIKICRFYGYERAZ', 'GLdBgBICJDbDsDEERFBGTGpGCABAKYFYFAKKHQJZGQIJDAJAHAKaAQFQEQGQGYJJABDQFIKIBQCQIaJADKHADYEZFAKJEQFaGQDQJQIKCABAHAFAEAKaGQFJGIEIBIFYKICSHYDYIYJYABGBEJEQFQFJDRGZARGIIIJIHICCBYBQCQHQIaJAAAGAFADJKAEaDQFQAQGQJQIKCABAEYDZFQHAKJBJEBDZDAFbKQKYARGIBIBAKAFKDQFYKZAYBQ', 'GLiBEDMDQDUDgDAEjECFYGbGFQHIAIJQKaAAHAFLAQJQKQDQGQIQBbCACZEBHBFBAJJJKJDRKZGQBQCZIAFZAAFIAQFQHQEQIQCLBAGAIAKADAJZFQDKKQGQBQIQCbEAHAAAIADAFAJKKQFaDQIQEZHAAADIIQBJCQEZBAIADZAQDIHQBJEJCAGAFAKAJaAQDQKJFQGQCQEZIAKADAJJFQDaKQHQBQIQELCACJGBDBFBJZKZAZHRBRERCJIAAA',
  'GLlBACRBhBYCCDTDEEJGbGiHGYHQFJIAGAGYHYJYACJICIKICRGRHZAZFRIJHAGAJZFQAJGJGAHQIZAAFAFYJJAQIJHACBDIEIBSHYCBFaJYAQCQGICIFIHIBCEYDYJYKYARGRCJFJFAHQIZCAGAGYCRFIFAGAGIHIJIDCJYCYABKYCRCIJIKIDSHYGYGQFQFYABGIJYGQAQFQIJHAFZAZGBCBJIKIDIEIBSFYHYAYAAFKGYCAJIARHIBCEYAY', 'GMEEqGLBQBRBgBKCUCdCIDAGhGBYHQAQKKJAJIDBFBBYLYCSGIEIFIDRJQKaAADAGACAHAIABKLQFQFYEYCYCAGRJIKIDAFALABaGQHQIQAQKJEBCYJQEICBJYAYJQEQKYICHIGIBIJICRLIFRCYEYAYGBBIKYLIESAYJYGYIYHCBILIEIFICRDRKYGAJKEAFAGQKIDBCBBaLQJQHQIQKJAAEAFABALaJQBKCQDQEQFQAQKaGAHAIABAJALKEQBY', 'GMgEBGFBSBUBVBACJCTCkDKGrGBIHAAALaJQJYFRCRBIKIDBIYEYCYFBJALKAQFQGQHQIQDQBaKACACIEIDIDQIBJYLYFQCQKQBKGAHAAAIALZERDIJAEYDRJIAIJAEALIGSHYIYBYJYDBKYCBDIEIAIIRBYKYECAIJIIILIGIHSBYKYEYCYDBFBLIIQJaCQEQIALYFRDRBKKAJAGAHALZAQCQEQBQKKJABaCADAEAAAFALKGQHQIQBQJQKaEABI', 'GMhDIGMBlBLCNCYCcCDDpDREAGIIEAHYDYFRCIDCHIESDYCYIYFCHICSDICAEBJJAQKQBQLQIaEACYDRFYHCDICIJIESFYCCDYHRCIFIECDYDQEQFRIKLABAGAAYKADYJYEQHQCQIQLKBAKADAAIDYGQKYEYFYIYCYHBJIJAAKCQDQEQFQIIKIGBDYEYFYCYCRIRKJEBFBCZAZJQIQIIAAJZIQHQAIAAHAIAJJCJERFRKZABCBCIFIEIDIGRKYAY',
  'GLACUCRBjBVCYCBDhDsDEEKFGIHQCQAIFCCYCQFQHAAQGZKADAIaBQDQEQJQKQGLAAFACAKAHAHICIFSAYKYGYJYECBIDIHICIIIFIASKYCCHYHQJQJYDCBYESDIBBDAEAIJBQHQJQCQCIKIACFYHYIYEQDQGICAJYBYDYDREBIIBQCQCIBCHIJIFIASKYBYCYDBGYEAJJCRCYDYJYERGIDAEAJAIAHJCQCIBSKIACFYBYCYCAHZIQJQDQDIKIAI', 'GLlBEDNCQCRDTDZDAEbFKGoGBZCAAAGQEQFZIAKKDQGQEQFQHQBZJAHIDBEYGYIAKYAQCQJIBIDAFYKAGKEQFQDQHQBQJaCAAAGIEJFQKZIQBJBAHAIAKJFAEZGZAQCQBIGIJIDAFAFIKZDQGAEKJYBYKQGaIQBQGIJKHAFAGAKAEaIQFJHQJaBAFAIAEKKQGQHQFZBQJKFABZIAGJHQBQFQJaCAAAIAGAEAKKHQGZHYEYAYKYCSIIBIJIDAGYBQ', 'GMcCIDQBRBVCoDqDSEAGDGKGgGAAEQGIFIKIBILICRDYDACAFYGYAQHYKQJQIKBABYHAIYLAGAFJCQCIDSHYDAJYKYECAILICAFZGQLQKQJQIQBKHACADAFAGZLQFKCQDQHQBaIAJAKAFALAGKCQDQFaKQJQIQBKHAFACADAGaLQKQJQFKHQBaIAFAJAKALAGKCQDQHQBQIZFABKHACADAGaLQKQJQBQFQIJHABaJAKALAGKCQDQBQHQIZFAJAKABK', 'GNADrGIBTBYBMDRDUDZDCEcEhGoGFAHAKALJIQGQCIEBGYDYIYDQJQFZHAKALABAMKIQGQCQEQAQFZIIJADAGIERCYDYJQFJAACADAEAGAIAMaBQIKGQLZKQHQFJAJCADAEAGYIZKQHQFQAJJAHaKAIJGJEQHYJQAZFAKAIAGJLQIaKQFQAJIIJAIALAGaKQIJJQAZFAIAKAGKLQJQAQFZIAAJJALAGaKQAQIQFJJAAZKAGKLQAQJQFZIAKAAJLAGaAQ',
  'GNBDjGDBEBFBVBiBTDYEIGQGaGrGIQLZHQCQDQAJJAKALAGAIAMaBQFQEQHQCQDQAQJKKALAGAIAHaCQDQAQLJIAHAMABaCQDQFQEQLIGAHKGQIQLaAAEAFAHACADABKMQGQIQLQKQJaAAEAHALKGAIAMABaCQDQFQLQEQHQAQJKKAGAIALaCADAFABKMQLQGQIQKQJaAAEAFAHACADABAMKLQBaCQDQFQEQHQAQJKKAGAIABALAMaCQDQFQHQAQHIBI', 'GNEBRBdBgBFCICUCADqDsDSEJGhGHJFADAIZJZCQEQGQAQHJLABAKAMAJAIJDQIYJYMYGYCYERAICCGIIIJIDIMIFSBYKYCYAYLYHYECGIASCIKIMIDCIYJYAYMYCSKIDIBIFBIYJYAYCYGYESHIKILIFAMYCCAIIIJIMIFSBYDYCYKYLYHYECGIAIIIJIMIDSCYKYMYACIIJIDIMICSBIFBCYDYIYJYMYASKIBIMIDCIYJYAYMYGYESHIKILIFAMYAC', 'GNEDrGNBSBdBIDQDTDbDCEYEiGoGFAGAKALZIQHQCYEBHIDIIIDQJQFJGAKALAMABaIQHQCQEQAQFJIYJADAHYERCIDIJQFZAACADAEAHAIABKMQIaHQLJKQGQFZAZCADAEAHIIJKQGQFQAZJAGKKAIZHZEQGIJQAJFAKAIAHZLQIKKQFQAZIYJAIALAHKKQIZJQAJFAIAKAHaLQJQAQFJIAAZJALAHKKQAQIQFZJAAJKAHaLQAQAIJQFJIAKAHALZAQ', 'GNFBYCKBLBjBkBACJCBDDDaDUEhEFIEIMIHRCYDYJQIJCADAKAKYLYFBEIMIHIBIGSCYCQDYIYJYAYFBLIKIDQIZJAKALYFRAIJIIIKIDICIGCBYCSDYHBMYEYFRARJIIIDACBKIMYEYFYARLIECMICRDRIYEALYABFIMICIDRHYCCMYCQFYARLICIHIDCMYCRLYABFICIMIDSHYLYAYFBCIARLIHIDCMYAYCYFRLIABMIDSHYAYLYFBCIMIARHIDCAY',
  'GNQBTCABNBiBdCLDgDoDrDBEREDGBILIAICRKYMYDAFAJIEIHIIICRAYLYEBHIIICIARLYEYEAHAIAJZBQFQDQMIEAHAHIERMYDAHIEILIABCYIYEQHYDQMIKIABCBIYIQCQAQLQKQMaDAGAHIEBLICIARKYEYGQHYDQMKKAAACAIAJZLQEQKIABCYEYLAJJIQCQAQEQKQMaDAGAHIKIAICBEYARKYGQHYDQMKCAEAKAAAIAJZLQAIEICRKYMYDAHIAI', 'GNVCgDABKBLBEDMDQDYDoDBGaGiHAQGQFQKJDADYEYFYGYKYACLIMIESHIIICRDYHAIALZAQKIHAIALICIDRHYKYAALIEBBIJIDRCYEYGYLYAQKIHICBDBBYJYMYARFIFQKQHKIAIIEBGYFYKYABMIBIJIDRGYGQFaLAGKFQCQEQIZHZAAGIFJCQEQIQHZKALAFAFIEICIDBBYGYJYMYASFIKILIEBGYGAMAJKBQBICQDRGZFZAAJIBICQGQFZMABABI', 'GNsDTGgBACbCBDJDRDYDcDkDDEhEIIDQFYLIGIGAHABZHILQGJHABAEAIAMAAaKQJQLQGQHJFJDACAAYKZJQLQGQHQFJBAEAIAMAKAJZKYEQLQGQHQIKEAKIMACIDRBYEAGZLAJJKQGQEQBIDBCYGYEQMQIaEAHALAGKEQMQIQBQFaHALAGAJAKJEQAICQDQFYHZLAIKEAAIMACIDRBYEAAAKZJQAJEQBIDBCYKYEQMQIaEAGAAAJAKKEQMQIQGaAAAY', 'HUjBFCGBWBoBpBsBtBuBCCQCRCaCDDIDLDTDcDyDkGOAKAEALAFARYBQSZAQMQJQTYDQCQNJOKJAKALAFAMASIEQFYLSJYOYMBNYCADATIAAAYSILQTYDQCQNIOIMARZQQPQOQNZBAQIRILASYGYHYIYDRCRBINIOIPIMIJILCFIFQRZAAEASYGYHYIYDYCRTIAIGBHYARTYCBDIIIAIHISIEQGQRJFAFYGYRYQYTYIBAIHISIGQTYHASIGIEIFRRYQYTYHYIYABDYCRAI',
  'GLEBZCDBFBgBjBaCRDAEkETHIIEDBYGYFYHYJYKYDTAIARCJIJEJHBBBGBFZGRJYDYARKIERHIEAEYHYIYCYKYADDIJIKIGIFIBREYFCGYJYDYKYATCIIIHIKIFIEIBCGYESFYKYCRIIHIFAKYDBAYCRDIKIFRHYFAIYDBKIFIECGIBSEYFYHYIYDYKYCDAIJIKIGIFSEIBBFYGYJYAYKYCTDIIIKIEIEAGBJYAYCYKYDTIIEIKIGIBIFCGAJYAYAA', 'GLRDoDDBcBACdCEDBETGqGZHERHYCYIAFAAJCQJIBIEQHQGbIAAAAICIDAGIHIECKYCRAYCAFAJABKKQEQHQGQIaAAAIGJHAIIEAKABbJQCQDQFQGQAQAYIJFAHAGZCADAJABLKQEQGQHQIaAAAIDAIICAEAGJKABbJQBIGQDQGIKIESHYCYIYAYAQIKCAHAKABAJZGQBKKQCQHQIaAAAICIDAHIIIECKYBYBAGAJJKQEQBZCRDQIYAYAQIKHABABI', 'GLdBAGYCIDbDpDREDGhGrGLHDICBFYIYEQJYAQKQHQBKCADAGAIAFAJZEQFKIQCQGQDQBaHAKAAAFAEAJKIQCQGQDQBQHaKADKGADYEZFQDQKQHKBACAGAEAIAJaFQFIIJJICRGYIYKYABDIDQEKIADaEQEYARKIGICBJYCQFYAQIJGQBQHaKAIAAAEADJFIGQJICQIaKQHKBAIACAGADZEQJYFYAQKQIKBQHaIAKAAAEADJFIGQJICQBQHQIaKABK', 'GLgBAGIBJBKBcBbChEDGYGLHFIGIHIAIJICSDYEYKYFBGIHIAIJIESKYFYGBHIAIEICIDSJZKYACHYAQGRFIAIJIKIDCCYDQEYHYARFYGBAIFSJIKIECHYEQFYAYGRKIBQIaKAJAJIEIDICBHYERJYJQKQIKBAKYGBAIFIEIHICRDYJYKYFCEIHICIDRKYFYECAYGREIFIKIDCCYDQHYAYFSEYGBFIESJIKIDICCHYAYCQEYFYGRKIBQIaKAJAJIAB',
  'GMIDiGCBSBFCLCMCQCRCdCoDqGAAHAIABZFQGQCJAJDAHAIABAKALZFQGQCQCYGCFIBIKJLIHSIYAYDYCYGYFCBILIHIISAYDYCYGYFYEYJCBIKJLIGSAICIDIICHYDSCYDAGBLZKQBQFQAICADABZKBBJDQCQAYFAKYLJGRCIDBHIISAYDYCYGCBYLYJSEIFIGIAICIDIICHYKZFQGQAJCADAKAHIISKYCRDIKBHBIBBZLZFRGRARDJCBAYDYFCGIAQ', 'GMkDJGTBjBACMCNCSCYCZCEDBGAQFQGQBJHAJBDZAZCQFQGQBQKQLJHAJADADIJSHYBYKZLYGCFIAICIDIJIHSBYLYGYFCAICIDIJIHIIIESBYKZLYJCAYDYCYFSGICCDICQJRLJKABAHAAYDQCQBJKRBZCADAAIHQKILZJBDYCRGYFCAICIDIJSBILIECIYHYJYAYDYCYFSGIKJHAJAAZCQDQKQGYFCKIDBCYKRFRGRBJLJHBJBABCZDRAICIHSJYAA', 'GNABMBBBNBSBTBKDsDQEcEDGhGpGLYMYFREIIIARCYGYEAFAKZBADAJAHAMKLQAQCQKYEAFAHaFQEQJQBQDQKKCAAAGAIAHALAMaFQJQHKFAIQGQKZBADAHAJAMKLQAQCQIQKYEAHaBQDQEQKKCAAAGAHAIALAMaFQEQJQBQDQKQGKHAGYKZDBBIEIFBLIMIARCRHYGYEBBYDREIBBFIIICIACLYMYJYDRFIBRGIHIAACYIYBYFYERGIHIKJAICBIYBYBA', 'GNADhDRBdBFCMCYCIDSDaDpDCEjEDQFAJJIQLQAJHACAGBBYIYJYKYMYDYESFIAIHIGAIYJYDCJIIIMIBIKIGSCYHYAYLYDYFYECJIMIDSJYLICIGBBYKYDYMYESFIAIHIGAIYLIDCBIIIKIGSCYDYHYAYLYFYECJIIIMIBIKIGICSDYCAGBKZBQIQJZEQFQAJHJDACAIZBAKJIQBZJQLQHQAaEAFAMAKJJQBJCQDQAYHALABAJAIJCQDQGRAQHZLABABY',
  'GNBDYGkBDCdCEDJDRDbDiDqDMEgEAYGYHYDYFYLYECCICAKJJQIQBJIYMAJZIQBQDQLQFQAKGAHAMAJAIZKZCQEQAIGJHAMAJAIAKZBQIKDQJQMQFaDALAIABAKKJQMQFQHQGZDAAYEACAKIJJMQIaDQLQAQGKHAFAIAMAJZKZCQEQGIHJFAIAMAJAKZBQJKDQMQIQAaHQFJAAHIDAIAMAJaBAKKJQMQIQAQFZGZEACAKIJJMQIQAQFQGZDAHALAIKAQAI', 'GNLDsDABUBFCQCRCDDSDaDkDBEiEFQGQIZJAMABZKQDQERAIHIJIIILICIFCGYBYKYEQJIIICSIYJYLYAYHYECDIKIBIMICIGIFSIYLYCCIIMYDYERAIHICILIFCGYBYKYEQJIMYCSAYHYJYECDICIKIBIMIGIFSIYJYLYAYHYEYDCCIDQERHJAAJAIJFAGABZKZCQDQJJAQHZJAAJIAMAKABKFQGQLQHZIAAZDACABIKQMQAQIQJZDACAEBBAKJMQAQAI', 'GNNCBDABMBcBJCQCbCKDSDsDhEDGGQCQBYMYAAEIDRIIJIFICICQGBLYFRIZFAJADAHAKZEQEYASJIIICAMIBIGALAKZFQHQIQJZDADIECHIFIKILIGSBYCYIYJYEYDYMYACHIDSEIFBDYHYASEIHBDIFRIIJICIMIBIGCKYLYFYDYDAHRIIFAJIKJLQCQBQGQMaJABJCABYJIMIGALAKZDQFQIYHBDIFIKILIGSCYBYIYFBDYHREYMYJYACHIDIEQFRBJ', 'GNRBUCEBdBgBFCICADqDsDSEJGhGHJGAEAIZJZBQCQDQFQHJLAAAKAMAJAIJEQIYJYMYBYDYFRCIDCBIIIJIEIMIGSAYKYDYCYLYHYFCBICSDIKIMIECIYJYCYMYDSKIEIAIGBIYJYCYDYBYFSHIKILIGAMYDCCIIIJIMIGSAYEYDYKYLYHYFCBICIIIJIMIESDYKYMYCCIIJIEIMIDSAIGBDYEYIYJYMYCSKIAIMIECIYJYCYMYBYFSHIKIAILIGAMYAQ',
  'GNgDJGABQBRBlBBDaDcDMEjEDGoGAIDQCQHAIZJQBJGQLaBAJAFAGIEAIYKAMKAQDQCQIQEQGZHAEICIDBIYEQAYHQGJCADAIAAAMaFQKQJQGJHAEAAIEIIIDRCYHYHQGaEAJAFAKAMKAQDQCQIQHQGQLQBaEAJAGKHAHICIDBAYIYKYMYFQGQHJKAIKAAAIDRCYKYGYHYFBIIMYIQAKKQAYHZGAAAIAIYMJFQKQHQGZAAHJGQAZEQJQBKLAAAGAHZEQAI', 'GOBBbDFBKBLBMBVBhBlBACCGYGiGqGAQHYMYNYIYGRBILIJQKZEAFABABYGBIILIMINIASJIHCAYAAMYNZIYGRCRFIEIKIHAAAMYIYGYCRFREIBAKIJALYGBIIMINIARLYGYFYERBIGALIABMYNYIYFRLIJQKYBAEAEYCCFIIIMIAQHQKYBYCAFBIIMINJJRHIABJYHSDYGYEYLYFYFAIBLIMINIHIDSAIJBDYHYLYFQMYNYIRFIEIGIAILIHCLYMYERGIAI', 'GKlBbCIBkBECYCcDpDZEBICAEIJICIFCHYIYBYDYAYGYESJIBCIIFRCYBYJYECAIDIGIHJIIBSCIFBBYHYIYDYAYGYESJICIFIBCHYIYCTJYECAIDICIHIIIBSFYJYEYADDIDBCJGRERAYDBCBGIHIIIBIFSJYAYDYCBEIDSCYDAEBGAHJIQDYCRAIDBIAHZGQCQCIASDIJIFCBYHYGYIYAYDSJIFIBCIYAYDYCYESJIACIIBSFYAYJYECCIDIIIAS', 'GLMDrDABJBKBdBBDUDbEDGYIAYBIHYFBIIKICTDYDQGYGQJaAAFAHIEIGIGQJQAaEAAIEIJIDBGYHZEQFQAKJAHAGJDRHZGAKABaIQEQFQAQJJHAGZAZEAFAIABKJYKQAQGJDADICCKYBYIYFSEIEAAJGQJQHKCADAGZAZERAIJIDIDQHZJAAAAIDIHQJZAADIHIHQJQAaDADIHIGICQAYJIJAGAHZIBBBFZEREYDTIIGIJIAICAHYGQAQAIJZIAGJAQ',
  'GLYBkBNBjBdCDDLDTDoDZEAIBACADAEAILAQDQJQKQFaGAGYCYEBBIHQCQCYEYBCHIBQHQEQGJCADBHYIYBSEIDICRGZDBCIKIACJYHYIYBYERDICBBBEAHIIJJIASKYBYCRGIGQFKKAAAJAIbHQHIBRCYEYDSFIGICBBBHZBQEQGQGYDBEIBIBQGQDYEBBIGQDQDYEYBCGIDQCQFYBAGQEQEICIDBJJAJIBHZHAGbEQBQFIDAJQCQCYBYBQEBJICRBY', 'GLlBACYBMDUDrDBEREbEhEDGCQDYEYACFIIIJICIBSGYKYAAEIHIGQCAKZDAHAJAFaIQEQAQDIHIGIKIBCCYFYJQEaAQHQDQDYKJGAEACIBRGYKYABHIEIJAFJBQGQKZDAEAEIGIBBFZJQHYARDIEIKIBACYGQKQDaEAEYABHIGICIKICBFBJZGRHZARHIKICICQDQEZKAAADJEQKZAAHICIEQDZFIBQKYAZHBIBGJCRARDIJIBREYEAFAFYAYCBJIBI', 'GMADoGMBFCcCdCYDgDiDIESECGKAGJJQAQLZCAEABJHQIZGQKQAJJAIAHABZEQCQLJJAIAHAGZKQIJJQLZCAEABJGQHQJQAZIAKAHJGABZEQCQLJAAIZKAHAGJJQIQAQLZCAEABJJQHZKQAJIAHAJABZEQCQLJIAHAJAGZKQAQHJIQLZCAEABJGQJQIQHZAAIJJAGABZEQCQLJHAAZIAKAGJJQAQHQLZCAEABJJQAQHQIZKAAJJABZEQCQLJIAHAJAGZAQ', 'GNABrDKBLBMBZBlBNCBDQDDGoGaHFYMYERDICIJIAQIYJAKYHAGABILIFQAQJYCYDYEBMIAIAQJQFALYBYGQHQKICAJIFBAYMYERDIJIFIABMYEYDRJICQJADAEABAKYHAGALKMQAQCQFQIQKZJAIKAACAFAMALaBQDQEQGQHQIQJQKKAACAFAIaCQDAEABAKYHAGALKMQIQAQFQKZJADAEAIKMALaBQGQHQIQDQEQJQKKAACAFAMALABaIQIYDREILIMIAS',
  'GNBDgGdBACJDRDbDjDsDDETGYGpGJIEIMYIYCQGILIDQAYEAFAFIKZJQEJFAKALAGaCAHABJIIMIDRKYLYJYCBBIGQHZBAIAMJGQIaBQCQJQKKLADAHAIAGAMaBQCQJQKQLKDAHAIAGAMABaCQJQKQIKGAIYKZCBJIBIMIDRHYLYCAKJGQIaLQHKAQFZHYHALAIKGAKZCQLIAIDBBYMYJYCRIIIQGKAQLZGAIAKJAQIaKACAJABKMQAQDQIQKZLYGYCBJIAI', 'GNDGRGUBVBbBiBQCZDkDoDAELGrGKIGBHYFAJAMaIQIYDRCIEIEAFIHIJIGRKYAYLYCBDBIIIAMKGQBYFAJQIaDQEQFQBKGAHAIAJAMaDQEQFQBQCQAIHJIABZCQEALIKIGBBYFAJYMJJQBQIQHZEAFABJGRKYAYLYCBDBBIIQMIJIGQHYFYEYDYCRAILIFBHIHQFQKQAaLACADAEABAIKHQBZIYCRDIEIFIKIGBJYGQMYCQBJKQAQLaDAEAFABAIAHJKQBZ', 'GNIBECJBKBbBcBlBDCNCaCrDYEAGIAGAKIEQHQLQCQMIAACYDYDQJBLICRDYJYHYECFYBRKYGQIQMJHAJALAKZBQEIFBBYGYIREIGCBIKILIJSHYFYGYEYMYICBIKILIJIHSFYGYEYMYIYBCKILIJIGSEYGAJBKZLQBQIQMJFAHAKYJREIGCHIFSAIDBFAFYHYGSEYJBKIHQAQMZBAIALAKJGQGIESAIHBEYGYJRAIGCJYKYLYBSIIAIGIJBMIHAEAKZLQAQ', 'GNLCdCABKBhBYCcCQDZDiDqDEEBGLQMJCIDAHIFCEYEAKZJQIQHQCQDQIIMZLABAGAJJKJEQEIFSCYMYAAHIECHYIYKYASDIEICIMIFCHYIYKYAYDSEIABDAIIJZBQGQLQMJAACAHIFRCYAYEYDBHIAQIIMZLABAGAJJKJAREYFQCQMYDAHAIAKAJZBQGQHJDQDYHYLYBCGIIIJIKIAIESDYABEAJZKQIQHQLQMJCAFAJYARLYMYBYGCHIIIKIAIEIDRLYAB',
  'GNLDqDNBgBhBkBlBYDcDiDSEAFDGMYCAIAFAGABJJQKQIZFAGABAJJKQHJLQMZAAIAHAKAJZBQFQGQHJIQAQMJLADAEAJZBZFQGQHQIJKABAJJDQEQLQMZAAKAHZFAGAJJBQHQKQAQMJLADAEABZHQKQIZFAGAJAHJBJDQEQLQMZAAIAKAJZHABJJQKQIQAQMJLADAEAJZBZHQFQGQIJKABAJJDQEQLQMZAAKABAJAHZFQGQBJKQAQMJLADAEAHZJQKQIZBA', 'GNgBDDFBJBaBbBcBVCYDpDAGrGKHDYMYGBFIEIIIAAIQJYLYHQCQBIKIDAAAIYEYFYGRMIAIAAIADQKYBYCAHALIEQIIDRAYMYGBFIIIDIARMYGYFBIIEAIQFQGQBQLYHQCQKKMAAADAEAJALZIQJKAQDQEQMQKaBACAFAGAHAJAIALKAQDQEQJaEAFQGQBQLYHQCQKKMAJAAADALZIQFQGQJKMQKaBACAHAJAFAGAIALKAQDQEQMQKQBaJAJYFBGIKIMIAC', 'GNkEDGMBNBYBZBaBbBSDcDoDqDAFIAGAHALAKJEQFQMQBaCADAJAAAKJLQGQHQJZCQBJMAEAFALZKZAQCQDRIJJAGAHAKALJEQFQMQBZIAIYDBCIHIGIJIMIECFYFALZKQGQMQJZHAHYCYDRIIIQBKEAFAJAMALALIFRERJYBYKYGQHQIYDBCIHIGBKILIFIERMYGYHYCYDRBIDAGBHYCYAAKJLQHQGQBYDAAAKALJCRAYDRBIGAHACYKYLYDRAIHIGRIYAA', 'GNpDIGNBYCEDLDTDZDhDjEBGQGbGJIIIKYEYCAGILIDAAYIQHQHIMZJAIJHQMQLQGaCQEIFQBJKIDBLYMYJYCRBIGAFZBQEQKJGAEaBACAJAMKLQDQFQEQGQKaBACAJAMALKDQFQEQGQKQBaCAJAMAEKGQEYMZCRJIBIKIDBFYLYCQMJGAEaLAFKAAFYHZFQLQEKGQMZCALIAIDRBYKYJYCBEIEAGKAALZGQEQMJAAEaMQCQJQBKKAAADAEALYGYMZCRJIAI',
  'GKABcCBBVBCCYCQDTDDEZIDRHIIIEICIAIGIFCJYESHYIYDDBIEIJIFSAYCYGYHYIYDYBCEIDTHIGIIICIAIFCJYDYEYBSHIIIDDHYJIFSAYCYDYIYBCEIJIFIATCYCRDZGBFBAICRDRGYDAHYIYBYECJIAIFRDICCFYAYJYESBIHIIIDIACGIJYEYBSHIIIDIAICIFCJYDSHYIYBCEIDIJIFSCYAYGYHYIYBYECDIBSHIIIAICIGIFCJYBYDYESHIBA', 'GKFBDCEBZBACdCRDUDBEaIESGYIYBYCYAYHYFCJIBSGIIIECDYBYJYFSAICIHIGIIIBCDIESBYGYHYIYCYAYFCJIDIEIBSGYIYDCGIJYFSAICIDIIIBCEYJYFYATCICRDJHBFBAYCRDRGIHIDAIIBIECJYAYFRDYCCFIAIJIESBYGYIYDYACHYJIEIBSGYIYDYAYCYFCJIDSGIIIBCEYDYJYFSCIAIGIHIIIBIECDYBSGYIYAYCYHYFCJIBIDIESGYBA', 'GLAGgHQBUBjBFCIDaDkEKGRGFQAKGAGICBHZJYDAKYEBIYFRDIEIEAHKKQCQJQGQAaDAEAEYDYFCHIIIBIKICSGYJYKYHYHAKKJQHaDQEQAJGAHAJAKaDQEQHKGQAZHADAEAKKJQGQAQHaDAEAGKJAKaGQDQEQHKAAFQJAKACAGZDQEQHQAKJAKACABYIYFRHIKICAGYEYDYHQKJEAEYDYDAGKCQDQEQHYKaAQJKKACADAEAGaHQAQJQKKCADAAYEAGABA', 'GLiDBGNCEDLDZDqDJETEgEkEBYDYCAFYHYEYIYKAGJAQIQEQDQBJHAFAJAAZIQEQFKHQBZDAFAEAIAAJJQHQBQDaFABJHAJAAZGZKQCQFIDJHAJAAAGZIQEQBQDQDIFZCAEJIAGJAQJQHQFZDABAIAGAAJJQHQBZDQFKBAHAJAAZGQIQDQFQBJHADaIAGAAJJQDQHQBZFAIADJJAAZGQDQIQFQBJHAJAAAGZDQAJJQHQBZFAIAAADAGJIIJQHQBQFaIAAA',
  'GMLDpGCBaBgBSDYDjDsDUEAFDGAIHIDIGIEABYDQGQFQCQFYDCBIEQFIKQLaAADAJAHAGKBAIaGQHQFJCQCIKIECBYIYGZCQDQHQFQJQAQLKKABAIAGZCQBIGIIIESBYKYDYCCBIEAGYIIIQBQCQDQAZJAFAHAIJGJEQKQLaJAFAHAIAGJBQCQDQFZHAIAGABJDQDYCYCQFQHZJQLKKAFZIZJQAJHAIACACIDIDABZGQJQAQHJIACADABAGaJQAQHQIJCAAY', 'GMYBTCABSBZCCDQDUDEEcEJGrGAQDRFYGICRDAKYBBDIEIAIAACRGYCAEALaDQBQJQHQIQFKBADAKAGAAALICQAYEYDYDBHZHQBQIQFQKKGAEAGIABCBHZLYBRDIEICIAREQGQKaAADABAFAIAJALKHQCQCYEYBYBQDSGIGQKIKQFbIAGJBAHICQAQKYDCBIEIAICBHYHALaBQDQJQGQIQFLKAAAEAHICQAYEYDYBCGZHIJALKERAICBEYHYHQARDYGQBQBY', 'GMcBYCABBBKBZBdCCDQDaDiELHAQFQHJEAIICQJIIQDQEQHbLAJAIJEQLYGCAIIIKIFIBICSDYBBFYERJYJQLQHKBADACBFYEYJYIYKYAYGSLIBIDICBDQJYBQCQHaBALAIAJKBQDQHICADYBYIYJYABKIEIFIDRCRHYLYGCKIEIFIDICRBYIYJYEBFIDICIBRIYIAJAJYDBFYKYGSLIDBFBKYAREIFIJIJQIQIIBBCYKYAYERFIIIJIBICCKYAYEYFRJIAA', 'GMpDRGDBVBjBACUCaDsDBEEEgGAYDQHZEAHIIZGQBJHALAAAAIIZEQIILIFSHYBYJYCYKYDCBIGIEIAIHIFAIYAQLQHQHJCRCYBYKYDYGCEIEAAJIJFQLICRBZHALAIAAZLYEYGSAIDIHIBIKIJIFCCYIYIQLQBQBYHaEAEYGAGYDTKIEBBICAIYAYGQHKBALAAAIJCQCIFSBYHYJYEYKYDDGIAILICAIYAQLQHQBKCAERJIFCLZAAIJLQCQCYAZEYBYHQBQ',
  'GMsDRGDBVBjBICUCaDpDBEEEgGDQHYEAFAIYAZGQBJHALAIAAZEQAIIILIFSHYBYJYCYKYDCBIGIEIHIFAAYIIIQLQHQHJCRCYBYKYDYGCEIEAIJAJFQLICRBZHALAAAIZLYEYGSDIHIBIIIKIJIFCCYAYAQLQBQBYHaEAEYGAGYDTKIEBBICAAYIYGQHKBALAIAAJCQCIFSBYHYJYEYKYDDGIIILICAAYIQLQHQBKCAERJIFCAYAAIaLQHQAIFRJYEBBYBQ', 'GNACpGNBUBdBYCBDJDSDjDsDDEZECAEAIYDYEYJICRDQIILIGIHIAIFCBYKYMYDYJYCREIJAKABJMQAQFQGZHAIAJAJYEYCBBIDQJQIQHQGJAAFAJZDAKIDIJIMIFSAYGYHYIYDCEYEQIJJAMABZKQCQEIIIDSGIHIJIAIFCBYKYCQMYDYEYIQJJEAKABJMQAQFQGZHADBEAIZJQLQHJGJAAFAMABZKQIQIIMIJYCAKIBIFSAYDYEYLYCBIIJIMIDRAIFCDYAR', 'GNMCgDABBBKBVBaCbCCDEDoDQEkEHBMYFRAIHIEIGBMYHREIGILICRDYIYGALAMAKJBQCQDQIYMYGRJZAAEAFAHAKJGQBICQDQLIIQJZLAGABIMACIDRMYGYHYFYAREIFCHIGIMIDBCYBYGQMQLQJJIADACABYLYGBKZAQEQHQFQJJGAMICIDRLYGYFYEYJYACHIKIMIGSFYEYJYAYHCKIMIESFIFQJQGABIDQIJLACACYGYFYEBBIBAKaMQAQHQIJJAEAFABA', 'GNQBjDEBKBLBNBUBdBgBCDAEZFrGFAHABIERDILAMZBQGQCQHQFQJJKIABIBMYEQDQKIAIIBLYDYDQKQEAJZCAFAGAHABAMKDQLQAQIQJZKAEAEYGYCRKIEBGYCYCQHYFRKIEIEQJJAAGADAIALAMaBQCQEQFQHQKQJJGAGIDCLIISAYDYGYEBCBMIIQARDYGYEYCBLIAIDRGYABLYCSEIAIGIDBIBMYCQERAIGIDIIBLYEYAREQGQJZAACABYFQKAHAHICIAR',
  'GNRBpGQBUBVCEDIDMDgDsDCESEiGBYGAAACAIAJYMZJABKMQJaLQKQFZHADALIIIJICRAYKYDYHQFJDAGIAACALAJJMABaEQJQLQDQHQFQGKDAKAHaEALAJABKMQJaLQHJIAJIJAMABaEQLQHQIKDQKQGaDAFAIAHAHIJJDQGIKQAICBKYDYDQIZHAEAJALABKMQKQAQCQGZIADAKICRAYDYIQGJAACADAKAMABaEQJILQKICIARDYCBKYJYJQHQHYEBLIMIAQ', 'GOLDrGCBbBcBdBACFCDDRDTDpDYGgGCYAYLYBYFQHQIIAAKAKYEBDIJICQMIGQAZIZHAFABILINIGRCYJYKYEYHYFCDIDANJHQIIAICAGALABaNQLKMQEQJQKQAQAICIGBMYEQGQKICQIaAAKAEALYDQFQAJIJCAGAJAMABANaDQFQLQHQBIKJIQAZKAIJEAMIGRCYAYAQKaIAFADALINIGQCQKYIZFAFYDCHIFSEIEAJJAQIQIYEYDYHBFIKICAGANYLYFQMJAQ', 'GKABCCBBdBFCYCQDTDDEZIDYESHIIIBICIAIGIFCJYBSHYIYECDIBIJIFSAYCYGYHYIYBCDYESBIHIGIIICIAIFCJYDYEYBSHIIIDCHYJIFSAYCYDYIYBCEIJIFIATCYCRDZGBFBAICRDRGYDAHYIYBYECJIAIFRDICCFYAYJYESBIHIIIDIACGIJYEYBSHIIIDIAICIFCJYDSHYIYBCEIDIJIFSCYAYGYHYIYBYECDIBSHIIIAICIGIFCJYBYDYESHIBA', 'GKFBQCABEBDCcCUDBFoGZHFIIJBQJIBICTHYEYDYAYGYFCIIJIESHICDBYEYIYJYFSAIDIGIHICIBCEYCTHYCADYAYGYFCJICIEIBSHYCCJYFSAIDICIHIBCEYIYJYFYATDIDRCJGBFBAYDRCRGICAHIBIECIYJYAYAAFRCYDCFIAIIJJIESBYHYCYABGYJIEIBSHYCYAYDYFCJICRHIBCEYCYJYFSDIAIGIHIBIECCYBSHYAYDYGYFCIIJIBICIESHYAY',
  'GLCBdChBkBQCADUDiDqDDHRHDAEACYHYIIHQKQAQAYGZJYBCDIIIHIKICIERAYCCHYIYKYDYBSGJJICIAIFIECKYDYDAIAHJKQEQFYCADYGYBAHIIAKIERAYDYCRJYBBIIIQGQGICIDIAIEBKYCRGYGAIAIYBRJIFIDAEAIaCACIDQHYBQGIDIAIDQIIEQFYAAGaBADAHIKIERGYGAIAIYARJYBBCIDIAIIIIQGQGIEBKYARDYCYBRCAJIFIEAGAIYDYCYBY', 'GLEDbDKBiBACdCgDjEBGYGLHCYGQKYFBHIDIJQEQBZDAIYAYFAHAGLJQBQBYCQDYGYHYFSKIDBBIDQEQIQAaKAFAHAGAJKBQBYGZHQJYFQKQALIACADAEAGABABIJZEQHQGJCQDQIQAbKAFAGAHAJKBQBYCQJYDQFQGZKQALIAAYGACAGYKYFCHIDIJIBIBAJaDQHQKQAQIJGAAaKADAHAJKBQBYCQDYHYJYFSKIAIAQGQIZKAFAAJCADBJIBIBAJaHQAQAY', 'GLRDoDDBbBACdCMDBETGqGYHDIGAKIERHYCYIAFAAJCQJIBIEQHQGbIAAAAICIDAGIHIECKYCRAYCAFAJABKKQEQHQGQIaAAAIGJHAIIEAKABbJQCQDQFQGQAQAYIJFAHAGZCADAJABLKQEQGQHQIaAAAIDAIICAEAGJKABbJQBIGQDQGIKIESHYCYIYAYAQIKCAHAKABAJZGQBKKQCQHQIaAAAICIDAHIIIECKYBYBAGAJJKQEQBZCRDQIYAYAQIKHABABI', 'GLrDCGYBZBMDSDUDaEcEAFoGAIEZGAIAAAKKCQDQJQBZGAEJFAHAAZIQEQGQBKJADAKZIQEQGQFJHAEZIAKJDQJQBaFAGAIAAJEQHQGZFQBKJADAKZAQEJHQGQFZIAEAAAKJDQJQBaIAGJHAAZEQGQIQBKJADAKZEQGQIQFJHAAAGZEAKJDQJQBaFAIAEAGJAQEZIQFQBKJADAKZGQAJEQHQFZIAAAGAKJDQJQBaIAAAGAEJHQAZIQBKJADAKZEQGQIQFJAA',
  'GNBDoDSBYBkBlBACJCNCbDLEDGhGBJCADQGQAYJYEALYIAFABJMQJQCQJYEYFYIRLIAIGADAMYBYIQKIEBJIEQHQAQAILZHAJYKAFABAIAMKJQHQAYBYFQJYMYIQKQLJAACAHABYEQKYIBMIJIDQGQAYLYIAFIEIBIBAJAJIHRCYKYEBBIJIHIDIGRCYDCHYBYJYERKIDICIMYFQIQLIAIGCHYBYJYEYMYFYFAIRKIEBBIJIMICSDYDQAQLZKAFAIAJIMICIDRAQ', 'GNDBACCBVBYBZBaBBCEDMDbDSGjHEQFQGQKaLQAQCQIZJAAICIDALIGCFIEIKIBSHYGYGAKALZAQDQJQIJCACYIYJYDBAIKJCQGQIZJAKAAYDRJIIIKICIGIHIBCEYBQFYMYDRAILIHQIZJZKAAAAYDCLIMIFIHRGYFCLYMYDSAICIFIGIHBMYDYASCICQKQJJIJHALYCYABDICRLIHQIZJZKAAAAYDCCIMIHRGYFYAYDYCCLIMIFSGIHBFYGSHIBIECFYGYHRAY', 'GNKDqDJBgBhBkBlBYDcDiDSEEFAGCYAYMICAHADAEABZJQKQHJDAEABAJZKQIZLQMJAAHAIAKAJJBQDQEQIZHQAQMZLAFAGAJJBJDQEQIQHZKABAJZFQGQLQMJAAKAIJDAEAJZBQIQKQAQMZLAFAGABJIQKQHJDAEAJAIZBZFQGQLQMJAAHAKAJJIABZJQKQHQAQMZLAFAGAJJBJIQDQEQHZKABAJZFQGQLQMJAAKABAJAIJDQEQBZKQAQMZLAFAGAIJJQKQHJBA', 'GNRBVBDBUBjBACEDJDMDkDsDSEgHFQHAAAHYCYGYIYBBDILICRGYIYBYDBLIEBMIFRAYCYEYLYDRBIGIIIEBCIAIFBMYJYKYDRBRGIIIEICBLYBYDBJIKIMIFRAYLYERGYIYDBBIEILIAIFBMYJYKYBREILICRGYIYDYEBBBJIKIMIFRAYCYLYDREYBBDILICIAIFBMYJYKYDRBREIGIIICBLYBYDBJIKIMIFRAYLYBYDYERGIIIBBLIAIFBMYJYKYERDILICRBY',
  'GOgDIGDBEBQBRBdBiBFCUCSDaDAGrGAQEQFQKZLAHAAIEQHIFIKQLZCQFAAANZGQIQJQDQMKBALAKAEANYHQCQLJKAFYCYHBNIEQFYCYHQLQKJFAEAKYNYHQLQDYJBHIAICQKQNIEQFQBQMaDAIAGAJAHAKICAAYNJAQLQLYHYJRDIBIMIFBCYKYHALAAAAIEICRFRBYMYDYJBGYNYISJIDIBIMIFBCBEYAYHQKJLAAAEICRAYHYGYLYKYDSJYICDIGINIHQKQLJAA', 'HQoBkDABOBeBBCQCFDZDxDzDtECFMFhGpGHYDAEABIIIOIFRCIGBABJYPIJAKaPQOQIQBYMQHZNABALAPJKJJQAQFQCQGQHZMAIAOAKAKIPZLQOJIQMQHJCAFAGAAAJAPZKQJKAQFQCQGQHZMAIAOZLAKJJQOQIQMQHJCAFAGAAAOZJAKZLQIKJAJYIYOJAQFQCQGQHZMABZIAJKBQBIMQHJCAFAGAAAOZBQJaLAKJBQOJAQFQCQGQHZMAJAOABAKZLQOJJQMQHJCAFABZ', 'HSQBVCDBGBRBWBiBjBtBmCADgDoDwDEEIGyGSHHIGIKILIMIAREYRYHBGILIMIAIERRYCROYDYFBJBIIBRHICIRIEBAYLYMYGYCRHYDROIPIEBABLYMYGYCYHRRIAIERPYOYDBRIGBLIMIERAYGYRYDROIPIABGYRYHBCILIMIEIGRARPYOYDBHIRIEBGIAREYRYHYDROIPIEBABGYLYMYCYHRRIAIERPYOYDBRIAIEIGBLYMYARRYDROIPIGBEYRYHBCIAILIMIERRYHYCBAI', 'GJrDYGLCADcDMEDGIHgHCQEQFQGQDLHABAIAAaCQEQFQBKHQDbGABACAFAEAALIQHQBaGQDLBAHAIAAbCQEQFQGQDQBKHAGaCBFAEAALIQGQHQBaCADAFAGKIAAbEQGQCQFQDQBKHAIAGaEAALGQIQHQBaCADAFAEAAAGKIQEbCRDYFQDQBKHAEAIAGaAQCQFQELCAHQBaDAEAFAAAGKIQHQBQDaEABKHAIAGaAQCQFQBQEQDLHABaCCAYFAAAGKIQBQBI',
  'GKEBdBFBgBACcCUDJEBGZIEQGYIYAYCYBCFIGIAQJIDIERHYAYCYBYGYFCJIASHIEBDYAYJYFSBICIGIHIACDIERAYHYCYBYGYFCJIDIEIASHYDCJYFSBICIGIDIDAHIACEYGYJYFYBTCICRDJGBFBBYCRDRGIDAHIAIIIECJYBYFRDYCCFIBIJIESAYHYDYBCIYGYJIEIASHYDYBYCYFCJIDSHIACEYDYJYFSCIBIHIAIEBDYASHYBYCYFCJIAIDIERHYAC', 'GKEDTGDBbBMDoDcEAGrGQIJAFAIaDQGQBQCQEQAQHKJABaDAGAIKFQBQJQHaAACADAEAGABKFAIaBQDQCQGQEQAQHKJAFAIABaDQGQFLDAJQHaAAEAFAGABKIQJQHQAbEAEZFBCJDBGYCRDJHJAQEZFZDACAGABAIKJQAQEQFZHAEKFQEYHZDYCBGIEQFJAAEZGYCRDIFIFAAKEAJAIaBQCQDQGQAQEKJAIABaGQAQEQFQHKJAAaGABKIQAQJQHaFAEAGAAK', 'GKQBbCCBdBZDAEMEDGRGgHBIJIARIYGYDBBIEJIQCQFQHaGAEABYDSEIGICIFIIIACIYJYCSEYGYDDBICIDQIJJIASFYIZEQGQGYDYBCEIHJFAIIABJYCYERBRDRGIHIFIABIYCAEYBQGICBIIARFYCYGYHYBCDIDQIJCQCYIYBQHIFIABCYFQHZBADAEIIYDYBRHJFAJICRARFYHYBBDIIIAICBJYEYDQIIAIAAIZDADYBSGIAIHIFICBFQHZGABAIYDYBY', 'GLACcCVBlBBCKDTDEEYEaEoGFAGYBAKJIQAQEQFZHZCBCYDDBIBQGJHQFJAAEAIAJIIIASEYFYHYCYDYGYBCJIKYJQGQDQGICSFJHIEIACIYKYCQGZBQFIHAGACAIIKIASEYGYHYFYBAJAKJIQGQHQFZCCDAJYBRDICIFIHIEIACGYIYJYBYDSCIBBCQJIGIIIASEYFYHYBYCYDCJIBRDQFKHAHIEIACGYIYBYBQHQJYDRCIHIBCGIIIASEYBYHYCYDBJIGIBQ',
  'GLACcCVBlBBCKDTDEEYEaEpGFAGYBAKIIQAQEQFZHZCBCYDDBIBQGJHQFJAAEAIAJIIIASEYFYHYCYDYGYBCJIKYJQGQDQGICSFJHIEIACIYKYCQGZBQFIHAGACAIIKIASEYGYHYFYBAJAKJIQGQHQFZCCDAJYBRDICIFIHIEIACGYIYJYBYDSCIBBCQJIGIIIASEYFYHYBYCYDCJIBRDQFKHAHIEIACGYIYBYBQHQJYDRCIHIBCGIIIASEYBYHYCYDBJIGIBQ', 'GLBCdCABNBCCDCECoDYEbEqGDAIICSAYEYFYGYDYBCJIIICIKIHIASEYCCIYJYBRDIGIFICIEIACIYCSFYGYDYBBHYJICIFSGYCCJYBRDICIGIFCJYCSDYBBCIJIFSGYDYBYCCJIDSGIFCDYJYCSBIGIFIDCJYCYKYBSGICCJIDSFYCYGYBCJIDIIIKIHIASEYFYCYDCIIIAHAHIAIESFYACHYHQIQIYDSCIAIFIECHYIYDYCSAIDCCYJYKYBSGIAIDICCJYAR', 'GLCBMCABNBiDkDSEQFDGoGrGAYGAEAFZBQIYDABIEIFIGIHICSAYCAHAJAKaBQDQIIHAEZFAJJKJCRCIATHYAAGYDYIYBCFIEICAJIKZJQEQFZBRDRGIIIHIACCYCAEZFQHQIZBBDIFIFAEKKAJaEQKJCQAQIYGAFAKYDYBSFIGIHIAIAQIICCAYAQCQHYFYIYGYBCDIFQGQIJCAAAKYEAJKKQEaFQFYDYBRIIHAFAEJAQAICSHYIYBBDIEIFIAIABEZFZGRAJ', 'GLDBIBYBEDJDMEAGhGoGrGRHFRDRAJEJGJBABICCEYHYKYDYFYASDIDAAAFAHKKQBQCQGZDADYABFIEQDQGJBACAEZFYARDIGIBIBQGZDAAAFAHAJAIKKQHaAQFQDQDYGJBABYGYABFIEJBQCQGZDAEAFYARDIDQGKBACAGYHAKAIaJQAQFQDQDYACDIEIFIHIKICSBYBQGZEAHAHIBICBDZFAKYJAIKKQDQDZFZARFIHIBIBQHZABFIBIDIDAKAIaJQFQAQAY',
  'GLDCYCABFBBCCCECsDaEcEpGIYJYDSGIAIFIEICIBCIYJYDYKYHYGSAIDCJIIIBRCYEYFYDYAYGCJIDSFIEICIBBHIIYDYFSEIDCIIBRCYDYEYFCIIDSCIBBDYIYFSEICIBIDCIYCSEYFCCIIIDSBYEYFYCCIIDIKIBSEYDCIYCSFIDIEIBCIYCYJYKYHYGSAIFIDICCJYJAHAHYFSAYGCFIHIHQJQJICSDYAYGYFCHIJICIDSAYCCDIIIKIBSEYAYCYDCIIAR', 'GLDGgGUBVBACoDqDBESEkELGBIERHYAYIYCYKYDBJBGJGAFLBQBYCRIQJYDRAIKIHIHQAaEAKADAJACAGAFABKIQIYCYCQFYGaDRJQKQAKEAGYHACBBYDQJICIGIEQHQAaKACAJADABIIIERHYCYJYDBFIGKIABZFQGQDQJQKQAKCAHAIABAFaGQBJGYIQCQHQAaKADAJABAGAFKIQBZFYDSJIJQKQAKCAHABABYIAFZGQJYJQBKCQHQAaKABAJAGAFJIQCQBY', 'GLECYCFBVBZCiDqDIESEkEBGAQIAFAKIHABAEAGZJZDRDYCTAIAAFJIIJAGJBQEQHQHIBCEYGYJYDYCYFYASIIKYIAFACAFIDCGJJIEIBSHYKYDAFZAAGIJQFQDQHIKIBCEYFYJYGYAQIQKJHAFAJAGZCQDSIYABCIDIGIJIEIBSFYHYIYAYCCDIARDAIIFIHIBCEYGYJYAYDYCSIIABCAGKJQJIEIBSFYHYAYAAIYCBDIJAJIASFIHIBCEYAYJYDYCRIIFIAA', 'GLFCaCYBdBZCbCcCADIELECGDQIICBEYBYFYGYDYASJIIICIKIHIECBYCSIYJYABDIGIFICIBIESIYCCFYGYDYARHYJICIFCGYCSJYABDICIGIFSJYCCDYARCIJIFCGYDYAYCSJIDCGIFSDYJYCCAIGIFIDSJYCYKYACGICSJIDCFYCYGYASJIDIIIKIHIECBYFYCYDSIIIQHQHIFCBIESFYHYHAIAIYDCCIBIEIFSHYIYDYCCBIDSCYJYKYACGIBIDICSJYBB',
  'GLIGqGNBdCADoDDETEQGYGiGKZHQGQELAAEYIAJAKAFABZHQGQEQAKIAEaGAHABJFQKQJQEQIQAaGAEKCAJAKAFABZHQEQJKKAEaHABJFQEQKQJaHAEKFABZEQHQJKKAFABAEaHQFKKQJaFAHAEKBQDAKQJQFaHAEABKKQEaHQFKJAEAKABaDQCQHQFQGQAKIAJAEAFaGQGYCYCQAQIKJAAaCACIGIGAFKEQAQJQIaCADAGAFAEKAQFaEAHABKKQAQFQEaHAAJ', 'GKBEoGABYBRCVCDDSFLGrGHIEIDICSAYAQGaEBIAFAHAJAJYEQFRBJCQDQAQGQIaHAHIEIAIGIIICDDYDBBZJZEREIJIDQCQIYHYFCEIHQIJCADAIYJYHRFYECHIAIDICRGYAAHYESFIAIGICBDYGRAZHBJJDQCQIYHAJYEYFSHIIICADAJYEYEBBJJJDRDICTAYGYEYIYHYHQIKAAEAFBBIGICBDYJIGRCIDBJaBAEQGKJQCQBYDQAQGYFRIaHAHIEIAIEABA', 'GLACVCSBcBLCEDJDMDiEYFBGBQDQHQFQKJGACACYEYFYHYBBDIIIERFYHYBYDCIIEIJIASCYFYHYEBIYDSBIEIFIHICIACJYIYERFIHICICQFZHACIFQHZCACIFIFQCYHQGQKZBABYDDEIBSCIDQKJGAHAFAFYCYCQHJFACYHQFJCACYFYHYBBIIJIASCYFYHYBYDYDQEBIIBRFJGQHIKaFAFIGJCIKIACJYBYIYERGIHADYGQHJDADYGYGQDICIHQFQKJAICABA', 'GLDBIBYBEDJDMEAGjGoGrGRHHZFRDRAJEJGJBABICCEYHYKYDYFYASDIDAAAFAHKKQBQCQGZDADYABFIEQDQGJBACAEZFYARDIGIBIBQGZDAAAFAHAJAIKKQHaAQFQDQDYGJBABYGYABFIEJBQCQGZDAEAFYARDIDQGKBACAGYHAKAIaJQAQFQDQDYACDIEIFIHIKICSBYBQGZEAHAHIBICBDZFAKYJAIKKQDQDZFZARFIHIBIBQHZABFIBIDIDAKAIaJQFQAQAY',
  'GLEBaCDBFBgBjBCCYDIEkETHIAHABYGSHIIIEDBYGYFYHYJYKYDTAIARCJIJEJHBBBGBFZGRJYDYARKIERHIEAEYHYIYCYKYADDIJIKIGIFIBREYFCGYJYDYKYATCIIIHIKIFIEIBCGYESFYKYCRIIHIFAKYDBAYCRDIKIFRHYFAIYDBKIFIECGIBSEYFYHYIYDYKYCDAIJIKIGIFSEIBBFYGYJYAYKYCTDIIIKIEIEAGBJYAYCYKYDTIIEIKIGIBIFCGAJYAYAA', 'GLUDiGRBhBACYCdCMDqDSEBHHAAAGAIJJICIDBBYBQCQDQJQKQHaAAHIKIEIFCBYFRIYGQKICBDIERHZHQAbKAAIGAJAIABKDQCQEQHIFBEYCYDBBZGQIZJQKQAKHAHICBDYKYGBBJIQDQDICSFIECCYFRHYAYFAGAJIDIIABaDQJQGQAIHIKQHQAaGAHIHAKADAJABKIQDYJYGRHIAIFACIESFYCCDYDAIABZGQKIDICRAYAQHaKAGABJIQCQDQAQAJCBDBJZAR', 'GLUDrDCBdCADIDSDQEhEaGDHIYJQGQGICRAYKYDCGIJICRAYAQKQEKFAHAAZCAGYDQEIFJHAAAIABaCQJQDQGQKQEQFJHJABIBBBCZGZGQKQHQAJIABACAGYJYDQEQFQAJHAEZDAJIGICQBQEZKAGAGJCJBRERIRHZAZFADAKACAGAJABLEQEJIRHRAZAQFbDAKACAGAJABABZEJBQCQJQDQGQKQFLAAAJHBIBBZBAEbCQJQDQGQKQAQAJHJIBBBEBCZGZGQKQBK', 'GLjBFCaBDDTDYDkEAFKGbGoGFQHQDaIACBEAJYBQIICAJAAAAYGYBRGAJICQKJFQHQDQIaEAJABAKIAQCQJYBBGICICQJQEQIJDAEaJACACYGYBRJICAAAIIKYBQJQIQDLEAEJHBAZCRIYJYBBKIFIAQHQEZDZBAGICIFAKZGQBQDJEJHAAAFAKYCQFJAJHREZEQDbBAIAJAFACAGAKKAQHQEQJZFACACYFQGYBRJKDQIZJABADKCAAAEAHAKaGQGIAICRDYFYBY',
  'GLjBRCQBkBIDKDSEMFAGDGoGDIAIGQFQEJBAKICRBYEYFYGYHYDCAIDQHQJQIKBACAIZKYHQFJEQJZDBDYADHIAQGICIKIBSEYFYDQIJJYJAEABAEJCBGYKYHYASDIDQEJFAHAKJBQCYFYFQEaIQJKEAIZDAAAIIKIGQFQCIBCFYGYHYAYAAKYDSAIAADAHIFIKIGIBSCYFAGAKZDQAQIIEQJaIAEKFAFICIBBKYHQFQEZAAAYDCHIKIBRCYEYFYAYAREJFJGBAZ', 'GMBBdCABjBkBFCYDhECGKGRGaGHYDYEYKIGALZBYFSIIJIKIGILICRAYGBJZKZBBFBEJDJHJCRCIATGYIYJYKYLYBYDCEYFRDIBIKILIABCYHYEYBRDYFCBIEIHICIARKYDYECBYFSEIDIIIJIKIACCYGIHYLYBYDSEYEQJJGQIaJAEAEIDCBIHICILIASKYDYLYDQGJIQJaGADAEYFCLIBIESDIKIABCYHYEYBYFSDIGQJKIAGaKIKALALIAICBHYEYBYFYDSLIAI', 'GKADrGCBiBIDoDYELGQGTIDAHAJABAFLDQGQIQCQEQAQHaJAIKDAGAFbBQIQJQHKAACADAEAGAFABaIQFLDQCQGQEQAQHaJAFAIABKDQGQFbDAJQHKAAEAFAGABaIQJQHQALEAEJFBCZDBGICRDZHZAQEJFJDACAGABAIaJQAQEQFJHAEaFQEIHJDICBGYEQFZAAEJGICRDYFYFAAaEAJAIKBQCQDQGQAQEaJAIABKGQAQEQFQHaJAAKGABaIQAQJQHKFAEAGAAa', 'GKEDoGDBjBMDsDcEIGTGQIDAHAJABAFbDQGQIQCQEQAQHKJAIaDAGAFLBQIQJQHaAACADAEAGAFABKIQFbDQCQGQEQAQHKJAFAIABaDQGQFLDAJQHaAAEAFAGABKIQJQHQAbEAEZFBCJDBGYCRDJHJAQEZFZDACAGABAIKJQAQEQFZHAEKFQEYHZDYCBGIEQFJAAEZGYCRDIFIFAAKEAJAIaBQCQDQGQAQEKJAIABaGQAQEQFQHKJAAaGABKIQAQJQHaFAEAGAAK',
  'GKEDpGDBbBMDsDcEIGTGQIBYHAJABAFbDQGQIQCQEQAQHKJAIaDAGAFLBQIQJQHaAACADAEAGAFABKIQFbDQCQGQEQAQHKJAFAIABaDQGQFLDAJQHaAAEAFAGABKIQJQHQAbEAEZFBCJDBGYCRDJHJAQEZFZDACAGABAIKJQAQEQFZHAEKFQEYHZDYCBGIEQFJAAEZGYCRDIFIFAAKEAJAIaBQCQDQGQAQEKJAIABaGQAQEQFQHKJAAaGABKIQAQJQHaFAEAGAAK', 'GKgBFChBlBBCaCYDcDjECIEYHYJYBYDDHIIIFICIAIGIESJYFCHYIYDTBIFIJIECAYCYGYHYIYDYBSFIDDHIGIIICIAIESJYDYFYBCHIIIDTHYJIECAYCYDYIYBSFIJIEIADCYCBDZGRERAICBDBGYDQHYIYBYFSJIAIEBDICSEYAYJYFCBIHIIIDIASGIJYFYBCHIIIDIAICIESJYDCHYIYBSFIDIJIECCYAYGYHYIYBYFSDIBCHIIIAICIGIESJYBYDYFCHIBQ', 'GLJDgGdCBDbDjDoDREDGqGLHAYDYHYEYIYKYCCFIFABKGAJZBQEQFQKQAKDQIZAADKHADYGAEZFZCRAIAQIKHAGAEAFZKQGKHQGYIaAADJGAKAFKEQHQGZDZCADIFIEJHQGQIQAbDADIAJIJGBHBEZEAFbCQKQIQAQAJDZAACAIAKAFLEQEJHRGRDZDQAbIADKGAHAEZFZCQDIGJAQIZDAGJAJHAEAFZKQAQGZDQIKHAAZKAFKEQAQHQIaDACAFIEJAQHQGZKAEAAJ', 'GKQBDCEBiBRDUEgEZGjGAHCIIQFQBIJIABHYFYCSBIEJHADAGAIaFQEQBYCCEIFIDIGIHIASHYJYDCEYFYCTBICADIHJJIACGYHZEAFAFYCYBSEIHIIJGQARJYDYEBBBCBFIIIGIARHYDQEYBAFIDRHIABGYDYFYIYBSCICAHJDADYHYBAIIGIARDYGAHYIZBQCQCYEIBBIJGQJIDBABGYIYBRCIHIAIDRJYEYCAHIAIAQHZCQCYBCFIAIIIGIDRGAHYCYIZFQBQBY',
  'GMDBQCMCNCbCADEDZDkDhEIGRGBQIQCQDQGQLYAQFLAAEAKALAHAHYJAIaCQDQEQGQGZFRAJKJLJHBGZFZAQLZAYDCCIASFIAAFAEAGIIJJQGQLQFaKQHKFAHYKZACEIGIKILIBBJYIYEQAQHIFIBAJAIZGRJJBRFYHYAAEAGIIIBQJYKYLYEYASHIHQFKKAHaFQFYACEIJILIBAIYGYEQAQKJHABAFYIAGZJQLQAYEBFQJIGIIIBRFYAYHQKZEAEYDYCCJIGIIILJAQBI', 'GMDBQCMCNCbCBDEDZDkDhEIGRGBQIQCQDQGQLYAQFKAAEAKALAHAHYJAIaCQDQEQGQGZFRAJKJLJHBGZFZAQLZAYDCCIASFIAAFAEAGIIJJQGQLQFaKQHKFAHYKZACEIGIKILIBBJYIYEQAQHIFIBAJAIZGRJJBRFYHYAAEAGIIIBQJYKYLYEYASHIHQFKKAHaFQFYACEIJILIBAIYGYEQAQKJHABAFYIAGZJQLQAYEBFQJIGIIIBRFYAYHQKZEAEYDYCCJIGIIILJAQBI', 'GMYDCGIBLBgBkBBCKCMEbGhGpGBIFIHAAIKILIEICSAYGYHYDYDAIYJYFCJIKILIEIEBCJARGRHRDZEBCBAIHBAALaKQAKCQAYCYJYEQFRIIEIHICCGIDSCYDAGBAaGQJQEQHQBZIAFAJIAIDQCQBYIYFBEJIRBJCADAAYGAIAJYEQFQBIHAJAAKDQDICSGYDCCICAAaJQHQBYFAEAIQJIAIGRDYBYCAFYEBIIHIAACIJZIQEQFQBJCAAADIGBJYJALAKaHRAIIQEQFQBQ', 'GLABiESBkBdCMDbDQFDGJGTGHQAQIaFAJJCACYJYKYEBDIBIFYHIASCYCQJZFQIKJACACIACHYBYDYERKICICQFZKAGAGICIFQKZGACIFIFQKQGaIQJKGAGYIZCACIDCBIFIHIASIYJYKYDYCYECBIFIDSIIKIACHYDYBYFZCQESIJJIGIGQJaIAGKKAFAFYCYGQKJFACYGYGQKQIQJKFACACYDCFYHIASCYDYIYJYKYECBIGIHIAICSDYACHYBYGYESIIKIAIDICCHYAS',
  'GLIBDGVBgBYDpDJEAGLGrGaHCQIQBQHKAAGAEADADIEIATEYGYBYHYIYCCIIEIABFYKIDIFAJaKQIQCQEJDADYFIHIIYCQBIGIABDYDQEaIAFAFJDJERARGYBYHYCBFIIYFAKAJKEQAQDYIYFYJYKYCTBIFIHIGIIIACDYAQKYFQIJGQHaBAIAFAFYKIDIARGYIYCCJIEIKIDIDAEAJaKQCQIIDAEAEJAJGRDZFZEAIZCAKAJKGQDQIYEAFJAAAYFYKYCREIEQBQHKIABa', 'GMDBACYBcBECTCVCBDJDREhErGCQBQGBDIERAIHYIIIAJAKALZDQEQAQGQIJFBHIBACALYEYDYGRAIDCEIFSDYAYIYGCEIFIKICILIBSHYIYJYDYAYFCKIDRJIBBLICQCYDYKYLYFSAIIIHIBACAJIDBCIBSDYCBDABAKYLYFYEYGSAIIIHIJICIDIBBDQHYIYKYCRJYAYGCEIFICIKILIBSDYHYIYJYAYFCCIARCQFQIIHIJIDIBCKYAYLYCYCAFRJIABKILIBSDYAYDABA', 'GMiBdCJBNBICKCZCjDrDDETEAGDABAERCYGBAYHYIIHQKQJQLJCAEAGAAAHZFRIYBQDQLIGICIEBAYCSGYFCCIAIHIESGYFYJYDYLYBCIIHIKICIAIFSJYCBKYBRLYDADICIJILIFCAYHYIYBQDQKYCRDYBCCICQBQDRJILIFIGIECAYHYIYKYDYCYBRCAIIHIJIDBKIAIESGYFYDYJYLYBCCIIIHIKIAIFSDYABDAFAHYIYKYCYBSJIAILIDIDQFBKYARJYLYBCCIAICQBQ', 'GMjBYCIBMBLCNCcChDpDBEREDGCABAFRDIGBAIHIIYHQKQJQLZDAFAGAAAHJERIIBQCQLYGYDYFBAIDSGIECDYAYHYFSGIEIJICILIBCIYHYKYDYAYESJIDBKIBRLICACYDYJYLYECAIHIIIBQCQKIDRCIBCDYCRDQBQJYLYEYGYFCAIHIIIKICIDIBRDAIYHYJYCBKYAYFSGIEICIJILIBCDYIYHYKYAYESCIABCAEAHIIIKIDIBSJYAYLYCYCQEBKIARJILIBCDYAYDQBQ',
  'GLADhGVBlBYCcCCDqDEEZGIHFAHIKIEBBYBQEQJQKQAQGZIZCBCYDDFICSIIAICAEAJYHABKJQEQAYHZIYCBFYDSCIDAFBHKFQKQIQGKAAAIEBIYKYFYDYCRDAGIFAHYHABAJKKQHaDQFQGQAKHIIAHAKAJaBQDQFQGYCADIFIKIERIYAZGYFBDYCRFIAIGIHJIIEBIQAZGAHADAKYDYCYCABAJKKQIQAQGZHAAJIAKAJaBQCQDQAQHQGJIAAZCADABAJKKQAQIQGZHADAAI', 'GLAGgGlBFCJDoDDEjEQGYGbGEYGQAJEAIAJAKaHAFKBQCAKQJQIQEQAZGAHAFABKKQFaHQGQAJEAIAJAFAKABaHQFKCQJQIQEQAZGAFAJKIQFaGQAJEAFAIAJaGQFKEQAZFAGAJKIQEQAQFaGAEKIAJaEQGQFKAADQIAJAEaGQFQAKIAFaGAEKJQFQIQAaDACAGAEAHABKKQJQFQEaHAHYCYCABAKKJQBaCQCIHIHQEKFABAJAKaCQDQHQEQFKBAEaFQGQAKIABAEAFaGQBJ', 'GLDDqGcBgBhBICdCiDJEAGLHAIEABYCQHAHIEIJIFADADIFSIYJYAYKYGCCICABJEQHQKQAQJJIADAEYBYCQGQJIIIFCEYEABZDQHQKQIQJZGACAHIBIEQFQJYAAIJDBIYKYCYCBGRAIJIFAEAKIEIFSJYAYGBKIEIDRIZEBDIEIDBKZCREIDIGRAIIIJIFCBYKYDSEYAQEQAYGBCIEIEQAQDAHYCQGQJJIAAZDBEYGYCCHIHABKKQAQFQIQJaDAEAGAHYCRGIDIEBHBAJAQ', 'GLEBYCDBSBiBFCRCTDcErGAHGQIYFRAICIKIBCGYDYEYHYIYCSAYFBCIASKIAADBEBJZCQCYFSKIDIEBFAHYIYAYAQHJCAJJIQDREIBIGCIYIAJaAQDQHYCAAIDIIIJIGSBYEYKYFBAIAAJJCQHIIQEREIBIGCIYIAJaAQDQEQHYCADIEIIIJIGSBYKYCBDBAYFSCIFAKIBIGCIYEYJYAYAAJKDQHIEAIQIIGSBYEYHYKYDCFYCSDIKIEBIAJZCQDRFQHIKIEIBIGCIYAYAA',
  'GLsDKGABQBBCFCCDqDgESGbHEQGYKYFRBIBAFAJAKAAAHJIJDRDICTEYDCIYAYDQFQJIGQBaJAFAAIGJIIDREICCDYCQERGaEAKAIAHaAQAYFRIIKIEICICQDBGIHYEQGQBQJaKAGKCAEAGYHAAaIQGQKQJKBACAEAHIDQCYEYKYFBIIAJHIERCIDBEYAYGZHYIYFRIAAJHQGQCQKICIDIDQBQJaKAIAAAHJGQAZIQKQJKBACADAAAGAHZIQAJCQDQBQJaKAAAIAHJGQCQAY', 'GKSDrGIBJBNBdBMCAGDGYIAAGQGYEYERAJAQIQHKCADAHYIYJABaGQAYFCAIEIGIBIJICTDYDRHZIZFZABEBEYGIBIERARFJHJIJDBDICDJYAYEYGABIJQCQDQAYGYFSHZIIIAAAAJEBEYGYAQIQHKCADAEAJABaGQGIBIJICTDYDREZHZIZABFBFYGIBIFRARHJIJEJDBDICDJYAYGABIJQCQDQEQHaIAAAAIEIERAZAQAIIQIYGBHJCADAJABaEQFQAQAIEBFYAREIFBAY', 'GKTBACFCdCBDDDjDrDKGYIAIIYIQEQFZABAYCYCQDCGIDQHIJIBSIYAQFKAAEAIABAJAHbGQGZCRDRFRAJEJEQIABAEZAZFBCBDBGJGAHLJQAQEQIIBAJYGYAQHYDRIQFaCACIAIABEJEQIQAYCYDCEIGIHIJIBSIYIABAJAHbGQGZERCRDRAJFJFQIABAFZAZCBDBEBGJGAHLJQAQIIBAJYEYGYHYDSCIAIAAEAEZARAYAACYCQIJDBGIHIJIBSEYFYAYAAEJFQAZEAFJAQ', 'GLBBqGaBbBACECCDKDcEYFRGBICQFIHIKIAQGYHAKADADYIYFRHIKIDACABYFQKQHQGKAADADICCKZFABIJIESAYCYKYDQGZHADIGQHZDADIGIHICIAIKJECJYBYFQKICSGYKZDQDYFCBIIICIJIESAYEAGYGAKACAJABaIQDQIYFSKJFAGQHZKACADAIABKEQJQGQHQKZAQDAFBIICRGJHIAIECJYCYIYFRDIHICBJIESAYAACYEAHYKICAJABaFQDQIQGQDYFCGIIIJIEIAS',
  'GLQDTGDBSCEDMDsDYEIGpGbHIAAADAHAJYJAGbKQBQCQFQEQIKAADAHABaKAGLJQBQDQHQAQIaCAEAFAKABKJAGbBQKQCQFQEQIKAADAHAJAGABaKQJKDRHQAQIaCAEAFAJAKABKDQGQHQJaCQFQEQIKAAJADAHAGABaKQCQFQEQIQALJAIaCBEAFAKABKDQGQHQFbEQEZARCJIJJJFBEZEAAbCQIQEKFQJZEAIAAKDAFQIZEQJKIAFAHAGABaKQAQCQEQJQIKDBAYFAHAGABA', 'GLUDBGjBkBdCSDhDEEIFaGoGFAAZGYHQBJIAJZCADAKJGQJQIQBaHAAJCACYDYDAJJIQFZDBAYAQDQHQBKCBFAIAJZAQDQDYAAHYEBJKGAKZJQGLDQCQIQFQBaEAAIDIHADAGZAQDIGAAZDQDIAIGIHQBJFAIAKAJaAQDQKJIQFQBZHAGAKAAAJJIQKICRGaCBHQBJFAGAIAJZAQKYDAKQCQHQGKFQBZGAFKCAIAKZAAJKKQAaHQFQGQBJIAAAKAJaDQHQFQFIAJIQBZGACJAB', 'GKACVCFBjBsDJELFCGYGgGJQIQAQHZGADADIIIIAJAEbBQDQDYBYCTEIGIHIAAIYDCIIJIASFYDYHYGYCDBIBAEKJQIQDQGQHJFADYGYBYBACSIIDQFQHZBABIGIFIABGAIAJYEYEAJKDQIYJYDYEZCYBSGIHIAAIYCYCBEJDIIJASFYCYHYGYBCIICRFIABDYCYIYBSCQGIFIAIDCCYARCAFYGYBCIIJIAICIDSFYABDAJaEQIQIYBSGIAIAAFIDBCYIAEAEZIYBYJICQIYAR', 'GLCCcCgBjBLCZCaCADIEMEDGBIDIERJYBBDIEIGIASIICCFYAYGYEYDYBRHIJIIICIFCAYCSIYJYBBDIEIGICIAIFSIYCCGYEYDYBRHYJICIGCEYCSJYBBDICIEIGSJYCCDYBRCIJIGCEYDYBYCSJIDCEIGSDYJYCCBIEIGIDSJYCYKYBCEICSJIDCGYCYEYBSJIDIIIKIHIFCAYGYCYDSIIIQHQHIGCAIFSGYHYHAIAIYDCCIAIFIGSHYIYDYCCAIDSCYJYKYBCEIAIDICSJYAB',
  'GLUDAGjBkBdCSDhDDEIFaGoGGYHIFAAZHQBKIAJZCADAKJGQJQIQBaHAAJCACYDYDAJJIQFZDBAYAQDQHQBKCBFAIAJZAQDQDYAAHYEBJKGAKZJQGLDQCQIQFQBaEAAIDIHADAGZAQDIGAAZDQDIAIGIHQBJFAIAKAJaAQDQKJIQFQBZHAGAKAAAJJIQKICRGaCBHQBJFAGAIAJZAQKYDAKQCQHQGKFQBZGAFKCAIAKZAAJKKQAaHQFQGQBJIAAAKAJaDQHQFQFIAJIQBZGACJAB', 'GLZCcCgBjBCCLCaCADIEMEDGBIDIFRJYBBDIFIGIESIICCAYEYGYFYDYBRHIJIIICIACEYCSIYJYBBDIFIGICIEIASIYCCGYFYDYBRHYJICIGCFYCSJYBBDICIFIGSJYCCDYBRCIJIGCFYDYBYCSJIDCFIGSDYJYCCBIFIGIDSJYCYKYBCFICSJIDCGYCYFYBSJIDIIIKIHIACEYGYCYDSIIIQHQHIAIECGYASHYHAIAIYDCCIAIGIESHYIYDYCCAIDSCYJYKYBCFIAIDICSJYAB', 'GKDDIDFBVCADpDTEKGrGQIFYGQIYDQCQAIEJBAHZCZAREJEQBLCAAYHAJAFAIZGQAQCQEQBQHKJAAaGAIJFQAQJQHaBACAEAGAAKFAIZAQGQCQEQBQHKJAFAIAAaGQFKJQHaBACAEAFAFIGAAKCQIQJQHQBbEAEZFBCJHJBQEZFZCADAFIGAAAIKJQBQHZFQEKHABAJAIaAQDQCQGQFQBKJAIAAaGQFQBQEQHKJAFaGAAKIQFQJQHaEABAGAAAIJFQAaGQBQEQHKJAAAFAIZGQAK', 'GKEBdBIBNBUCYCsDaEpGBICAFAHYIYGYBQDQAIEBGBBZDRDYATEIGIBAJICIFBHYBYDYAYGYESJIBCHIFRCYBYJYECAIDIGIHIBSCIFBBYHYDYAYGYESJICIFIBCHYCSJYECAIDIGICICQHIBSFYGYJYEYADDIDBCJGRERAYDBCBGICQHIBIIIFSJYAYEBCYDSEIAIJIFCBYHYCYASIYGYJIFIBCHYCYAYDYESJICCHIBSFYCYJYECDIAIHIBIFRCYBCHYAYDYESJIBICIFBHYBS',
  'GKNBkBYBdBACMCEDKEBGZICQEQHYIYGYAADABIFRGRAZDBDYBDFIGIAQJICIERHYAYDYBYGYFCJIASHIEBCYAYJYFSBIDIGIHIACCIERAYHYDYBYGYFCJICIEIASHYCCJYFSBIDIGICICAHIACEYGYJYFYBTDIDRCJGBFBBYDRCRGICAHIAIIIECJYBYFRCYDCFIBIJIESAYHYCYBCIYGYJIEIASHYCYBYDYFCJICSHIACEYCYJYFSDIBIHIAIEBCYASHYBYDYFCJIAICIERHYAC', 'GKNBkBYBlBACMCEDKEBGZICQEQHYIYGYAADBBIFRGRAZDBDYBDFIGIAQJICIERHYAYDYBYGYFCJIASHIEBCYAYJYFSBIDIGIHIACCIERAYHYDYBYGYFCJICIEIASHYCCJYFSBIDIGICICAHIACEYGYJYFYBTDIDRCJGBFBBYDRCRGICAHIAIIIECJYBYFRCYDCFIBIJIESAYHYCYBCIYGYJIEIASHYCYBYDYFCJICSHIACEYCYJYFSDIBIHIAIEBCYASHYBYDYFCJIAICIERHYAC', 'GKQBhBdBgBFCJCADKECGaICQEQHIIIGIABDBBYFRGRAJDBDIBDFYGYAQJYCYERHIAIDIBIGIFCJYASHYEBCIAIJIFSBYDYGYHYACCYERAIHIDIBIGIFCJYCYEYASHICCJIFSBYDYGYCYCAHYACEIGIJIFIBTDYDRCZGBFBBIDRCRGYCAHYAYIYECJIBIFRCIDCFYBYJYESAIHICIBCIIGIJYEYASHICIBIDIFCJYCSHYACEICIJIFSDYBYHYAYEBCIASHIBIDIFCJYAYCYERHIAC', 'GKFCJCIBECYCADCDKEcFhGHQGQFJBACAEAJQHQHYJYIYASDIFIGIBICICQEBHYBRFZGYDYACIIBIBQHIERFYGACJFQFIEBGYCABAHYBYIYASDICIFIIAJJHQEQGYFABABYFQGJBAEAHAIYJZCTDYDQGJFAIACYDRGRFJGAIACAHIJIESBYIYFYGYACDICIHIJIEIBSIYFYGYAYDCCIARFIGIIIBCEYHYAYCYDSFIGIABHIEIBSIYAYFYGYDCCIHIJIASIIBCEYAYHYCYDRFIGIIIAC',
  'GLcDpGABBBFCLDQDkECGSGZHBYKYAYHYESFIIIDIJIDQIZFAJAAAEAHABKKQGQCQDYIYFYJYEBHIGJCQDQJZAAGAHYERAIFIIIJICBDYGYGQJQAaFQIJAAJAGAGJDJCRAYDYGYIYJYFYEBHIGQFQJJDAGYHYERJIDIAQIZJAFAFIDIAIAQIQJaFADIAIIIJICBGYGAKABaEQDIAIGICQJYFYDAEABKKQCQGQAZIYFRDZEBDIHIGIIIJICBAYAQFaGAGIFIHYAICRERDIIYJYGBHBAJAQ', 'GMqDBGKBNBEDLDTDsDQEaEcEgEBYEYDAGIIALAAZHZKQGQDQFQEQBKCAIAFaCQBYDAGAGYKADQBICAHJAJLQFQGaJAAAHZKQJICRBYCADAJIFJLAHZAQFQJYDRBICADAJYKAAJFQJQGKCQBYDAGILAHAFZAZKQGQDQBICAJAHJFAAZHQJQCQBYDAGAGYKADQBICAHJAJFQLQGaJAAAHZKQJICRBYCADAJIAAHAFJLQAZJYDRBICADAJYKAFJHQJQGKAAGYLAHZJQGQAKCQIQBaEAAAEIBI', 'GNJDiGFBIBVCADRDTDYDsDDEgEaGFIDAJZEQHIGIIALAJZBQMQGQGIIJLAMZGQIQIILIDRAYFYHYKYCYECBIGIIIJIMIDRLYHYCQHQKQFKAALADAHYIYEQFIAJJYBYLADAMYGYERCIKIHAIZGAMJDQHYKYCYEBBIEQJIDQIYGYMYCRFQAJKAGAIJDAJYBYEQGJKQAZFAGAEABIJIDQIZKQAQFZGAAJKAIJDAJYBYEQAQGQFJKAAZEABIJIDQHQAZIAHJAQIZKQFZGACBEAHIAIDAJYBYMJAQ', 'GNYBLCABBBCBUBVBZBaBMDDGQGjHAQHQIQLQCQDQEQKaJAJYGBFIBIEIDICILIACHYIYMYFRGRJIKIAAHBIYMYFYGRBIEIDICILIHIHAIBLYMYFYESBYGCEIFIMIIRARKYAAJYGAEBFIBRDICIHIAIICLYMYCSDYBBFYERGRJIDACBFYEYGRBICICALJAQDQKIIAAYHYDYCYLYECFILIHQMIARHYDYCYEYLYBYGCFIMIAIHRIRKYJYGAFBMIAIHIIRDYCYEYLYBYFYGRJIJQKKCADAEALAAA',
  'GLUDoGTBZBjBSCcCdCKDEEAFDYIACAEABIDQKQIZCACYECFICSEYEQIJKACYDABYERFQAZAAFAGAHABKCQDQKQIZAAEBCICABZGQHQJQAJEAEICCFYESCICQAZFAJAGAHABJDJKRIRAZFADAIAKABaEQCQGQJYHBGICIEIDIDAEYFRJYCBGYHSCIGCEIEAHABKDQFQJQAJIAKQJZDBDYEYGRAIDAFABYHQCQAIECFIDSEYAYAQEQILEAIYJAKABZFQGQAQAYCYHCGIFIDIDQAQCYFBDIAQ', 'GLVBYFDBiBjBUCaDsDBEEERGIYCYJYABFIGIDAKYGAEAEIHZEQFQGQKKBAHZDQDICTJYAYKYCAFCEIDIEAHJBQKZGADADYHJCQDQGQGYEYFRAIECGICAGADADIHZDQGQKJBAFQHZCQDYGYFYATEIERJJIJBBGZCADAHJGRBRIZJZEBEYADFIFAHJGJBQKZFYASEIAAFBDICICAGAHZDQDIFSEYABDBFAHJGQCQCYFYDYASEIDBFICICAGAHZAQERDIFBAYAAHJGQCQCYAYAAHAGJCQCIBI', 'GMFBJCVBgBICDDLDkEAGSGaGhGLQBQGZFQIJEADALYHYCRARIIGAFZIQGKFAFIBBIYAAKIDJBRERFZFQGbAAIAJAKAHAKYARJILJBQEQFQGQIZJAAAGKAQFAFIKZGQJQIKFAJaGAGIJIKJECBYDYHYKYAYLYARGRJJKJDBHYGYJYKYCCAIAAGQLJHQDQKQJQFQIZCACYACFIDAGIJIKIHALZGQKQJQFQFJDJHBJZKZFRARCIDIDAAYCRDIIIAAAYCYIYCBFBJJKJHRAZFZFAJAKAGALJHQAQ', 'GMRBVBQBcBiBlBaDrDDEgESGAHBBFBHIEIJICRAYGYEAHYFRBRIIKYLIABCBJYHYDQBYFBDIHIBQJICRARKILYIYFBDBHIEQGIAICBJYEYHYDRFRIILICBAYGYBYKYFYDBFQHIBQGIKIAICRLYIYDBFIGIKIEBJICRAYEYGYFYKYDSIILIABEYGYBAHYDQKYFAFIBIGIKIEIARLYIYFBDBHIJIERAICBEYJYHYDRFRIILICBAYGYBYKYFYDBFQHIBQGIKIAICRLYIYDBFIGIKIAICIEBJYAR',
  'GMVBRCABlBQCiDrDEEJGSGaGoGIABAFYGALJEQCQIYHYABDBLIFQGZLAFKGQGIBRLYDQJICJBBEBGZGAFbDQLQKQJQHQIJBAEAGAFAJYDBKILZKQDQFKDAGQGIJZFAKALKGQKaFQFIJJKIESBYCYHYIYAYDBJYFBJJKJCRHYFYJYKYDSAIAQFAIJHACAJAKAGALZDQDYASFIGICQJIHQIZFAJAKIKAGAGJCJHRJZKZGBABDICICQAYDBCILIAQAYDYLYDRGRJJKJHBAZGZGQKQJQFQIJHAAA', 'GMEBIBDBTBUBgBFChDpDJEYGjHBAJAKAFAHAIYLYGSAICIDBHIFIKIBSJYDYCYEBHIKJDRFAJIBCFYDYDQHYKZERAYGCLIIIFRBRJYCYAYEBHJDIKIBIBQFBIYDQHZKYERAICIJIFBBYHYKYCRAYEBCIHIBIKIFSJYAYEYCBHJDAIIFQKIBABYDYHZKYCREIAIJIBBFBIYFQLYGSEICBHIKJDADIFIBSJYBADBHYKZCRAIDIJIBBFYHYKYDRAYCBDIHIFIKIBSJYAYCYDBHIKJARJIBCFYAYBQ', 'GNABqDCBQBbBgBlBBCSCZCcCMEDGLYGCKIBIEIIQCQMYGAKABIIIJIHSCYLYMYGYKBEIGSLICIMIHCJYIYBYGYEYKSLICIMIICGYCRGQIQLYMYKCBIEICIGIGAIRLYCBGIIIJIHSLYIBBYEQKQMILAHAJABZGQGYCSIIGCCYCABJHQJQLQMZIAKAEAEYKSIIGILIMIHCJYCYEYGRBYLICBEYGYKYISLICIMIHIJCEYEQHRJQMZHALAIAKABJEIFIDRARMYAACAGAEIFIJRAIDCJYASHYFCEYEABZ', 'GNCDoDIBLBbCADUDcDgDkDsDEEJFBIIICSMYDYDQAQEAFJMACABYKZJQHQGQLQFJAADAEAIAKABJCQIYDQKYEQAQFZLAGAHAJABJEQKQDQGZLQFJAAGADAEAKABaJQHQLQFQAJGADAEAIICABYKIKQEQIQDQFZLAHAJAKJBJCQMQGZAZLAHAJAKABJEQIQDQHZLQAJFAHADAEAIABaKQJQLQAQFJHAAZLAJAKABKEQIQDQAQHQFZLAAJDAEAIABaKQJQAQLQFJGJMACABYKZJQAQLQHJDAEAIAAa',
  'GNsDSGFBVBgBICDDJDZDbDkDAGhHBYGQLJFAIYJYDYCRGILYGAHKLQGaHACADAJJIJFQGYHZCADAJAIJMAAaKQIQJQCQDQHJGJFAEAAYKZIQJQCQDQHQGJLABAMAKAAJEQEIFSBYFAHYLYGYCBDIMIEBAZIZKYJYDRCRGIHIBILIFBKYJYDYCRMIEIKAAAIZJQAJKQEYMYCBDIAIKIFRBYHYLYGYCBDBAIJJIJKIERMYDYCRGIHIBILIFBEYEAIZKQMQBQLQGaHACADAAAJAKJIJEQFQGYHZDABI', 'GLACdCBBNBbBMCYCrDKEZFCGCQDABAHIKYFAEIJIGIASCYIYKYFYDYBBEIDSFIIICIKIACGYJYDYEYHYBSFIIICIKIAIGCJYCSIYCAEBDICIJIGSAYIYEYKYFYBCDIDQBQFRKJFAIAJAHZCQCIESFYCCEIEAHJJQIQKZBADAHIFRIIKIAIGCJYFYEYCRHYDQBQIIKIFCJIGSAYFYIYCBEIKYBADAHIJIFSAIGCFYJYEYDYHYBSCIIIKIAIGIFCJYASIYDBEIKYCABAHIAIJIFSGYIYDYKYECBY', 'GLADrGUBdBLCYCMDjDhECGIHDAHIEQIABZHQCQDQGQJIJQALKAFABYEQGaCADAEAHABKFQIQGQKQAbJAAICAEAHYDQCIEIGIKIFCIYHYIABaERBICYDBEIGIHIIIFSKYCYDYEBBJEQIQGZCQDQJQAKKAFAGAIABaHQCQDQGJHIBIFQKQAbJAAIGADAGIKIFCBYHYIYCYHABKCQIQKQAQJZGAAKKACAIABaHQCIDQHIBIIIFSKYAYAQGQGYJJEAKAAaCAAIDAHABJIQAQKQJaEAGACAAIDAHABA', 'GLCDoGjBkBKCLCUDcDEEAFgGDICIJQAZEAFAHZCADABKKQHQEQFQAJHZJAHAKABaCQDQGQIQAJEAFAGZCADABKKQGQEQFQAZGZIACADABAKKERGQHQJQAZFAFYCYCBDZIRCJDBDIFIFQAJEBJAHAGAKaBQIQCQDQAJEAFAGJGAKABaIQGJEQFSAZCADAGAGYCRDIGACYDRFAGIGACADAIABKKQEQAQHQJQGbAAAJGJEAJAHAKABaFQIQCQDQAQAYDBCIAQDYCBAIAQCQDQGJEAFCAZIABKKQAQ',
  'GNBDhDABMBVBLCQCJDoDREDGjGqGDQMIIIGQCQAYKYEBDIFIHIJICIGBBYIYLYMYDRERKIAIGABALZFQHJJABJCQLIGRAYAQKaHAFAHYEBDBLJMIIIIAMaLQIKBQBYIYDQEQHIJQAJCAKIGBBYBAMALaIQIILIMJBQGQKYHYEADAMIBIGRCYAYJYFYDYDAERHIEAFAMAIALJBQIaMQDQEQFQHQKKAACAGAJAIABALaMQBKFQIQJQHaDAEABAFAMALKGQCQIQJQHQAQKaDAFABYEQDIFIAIKICAHYAQ', 'GNFBqDDBKBVBYBlBECTCZCcCIEAGDRLIFBJYBYDYIQCQMIFAJABYIYKYHSCILIMIFIJBDYFSLYCYMYHCKIIIBIFIDIJSLYCYMYICFICRFQIQLIMIJCBYDYCYFYFAIRLICBFYIYKYHSLIIBBIDQJQMYLAHAKABJFQFICSIYFCCICABZHQKQLQMJIAJADADIJSIYFYLYMYHCKICIDIFRBILYCBDIFIJIISLYCYMYHYKCDIDQHRKQMJHALAIAJABZDYGYERARMIAACAFADYGYKRAYECKIASHIGCDIDABJ', 'GLCDoGABBBEBQBbCKEUEZEkEDQEIFQCQAZHAGAHIDICIDAFBJYGYIYKYETHIDIIIDRHZIBEBKIDREZIRHJEBEYDDBIGIJIEQFSCYCQEYDYDQAJEAEYAYDYGBJIDRAREJCBCIFDDYJYGRBYEICIFIDCAYJYGYETCICRHZIBKBEJCRCIBIGIAIJIDTFYFRHZIZKBCBBICIGIAIJIDIFRHRIZKZCBCYEDBIGIAIJIDIDBFJHRDZFBBYFYAYGQJYCSAJJAKIIIDBFYJYAYGABIHIFRDRIYKYEYGBCIAR', 'GNDDqGIBJBhBFCYCdCZDbDiDKEAGLIDICIGBEYKYJQLQAQMJGAEABZJQKJIQCQDQAZLAKAJABJEQBYGQMZLAKAJAIJCQDQKZLQMJGAEABYIQJQLQAJKACADAJZIABJEQGQMZAAKJCADAJAIZLQKQAQMJGAEABZLQJJCQDQAZKAJALABJEQBYGQMZKAJALAIJCQDQAQJZKQMJGAEABYIQLQKQJJAAKZLAIABJEQGQMZJAAJKACADAIZLQAQJQMJGAEABZLQAQJQKJCBDAAZCQLABJEQGQMZKAJALAIJAQ',
  'GNEDjDBBLBNBACMCYCdCCDhDREpGDQJQAZEAGAIAMJKQBZDQDIBILICSFIHCCYCQFRHQAZFAJALABAKAMZDQGQIQJIAIEQHACAMYDYGREYICGIDIDAKIMJCQFRHQAYJYLYEYIYGCDIBIKIMIFICICAHRLYFBKYMZDQDYGSIIJIFABYDCGYISDIEIJIFIAILIHCCYBYKYMYFSEYDYJYICGIFIBIKICIMIHSAYJYLYEYDYFCBIKIERLIHBMICQCYEYBYKYMYFSDIDAFALIMIEQHICCEYCQHRAQJZLABABY', 'GNFBJBVBZBQCDDTDkDaEAGKGoGrGGYCYARFIJIEBDYBRGYKIGABAIAHaMALKHQHYLYMZARCIIIBIMIDIERGYJYKYCAAAFYLIHIEQGQKZFQJKKAGADAGIEBHYLYAQCQMZIQFQJQKKEAGABADAMAHAHILZIQMJDQERGYGQKaJACAMIBQGKKQJaCAGAFAMAAAIALKEQHQBQDQMaCQFQGQJKKAMABADAEAHALaAQCQIQFQGQMKBADAEAFZHYIALJHQEQFQBQDQMaGAGIIAMIEAFYLAHKFQHYLZAYCRIIBIBQ', 'GNJDoDYBaBkBACFCRCdCLDqDTECGDAKABJCQFQHQMZJAAJDADYAYLYECIYGSEIEAGAIBBJIQKQLQAQJQMJDAFAHAKYBYCAGQEQMIDIHBCIFSHYDYDQJYMZEAGABIIBKILICIFIHSDYAYJYMYIYEYEQGBLIIRJIMJDADIHCFYKYIQAIDSHIFCDYCYKYIYBYLYGSEIAIJIMIICCIDIKIFSHYIYAYJYEYMYGCBIKILICIDIISAYJYCBLYGRMYEAEICIAIJIMIICDYDQIQLYMYCAGYESCIEAGBBAKJLQAQAI', 'GNZBlBJBVBICMDbDrDKEAGDGiGoGGYDYBBHILIMIERCYABGYGQAQIQFaKQJKFAFYJYKZBBDIIIAIKICIEBGYLYDQBQJIFIEAGALZMYHYHAMKLQGQCQGIERFYJYBADAKZIAHAMALKEQGQAQCQKQFQFIJZIAKJCAEBGYGALaMQDQKIAAGKLAMaDQGQHQKQBQIQJKEAFAAACAKaDAHAGAMKLQKQAQCQEQFQJaBADAIAHAGAKKAQCQEQFYHZIQJJFAEAHAAACAKaGQGIIQKIEQHYJQFKHAFYJZBYDBIIAIAA',
  'GNcBgBMBQBNCIDZDpDKEAGDGhGrGGIDIBBHYLYMYERCIABGIGQAQIQFKJQKaFAFIJJKIBBDYIYAYJYCYEBGILIDQBQKYFYEAGALJMIHIHAMaLQGQCQGYERFIJJIAHAKIBADAMALaEQGQAQCQJQFQFYKJIAJZCAEBGIGALKMQDQJYAAGaLAMKDQGQHQJQBQIQKaEAFAAACAJKDAHAGAMaLQJQAQCQEQFQKKBADAIAHAGAJaAQCQEQFIHJIQKZFAEAHAAACAJKGQGYIQJYEQHIKQFaHAFIKJBIDBIYAYAA', 'GNgDTGABQBcBdBBDRDoDEEiEJGZGEQFQMJHQBZJQGKLABAHAMZJQBJHAMAKAIJAQDQKYMYJYFBEIIIAIDQJQMJCRHYBYLYGYFBMIEAIIAIKADICRKYJYMYEAIAAJJQMQBQGQLJHAGaBAMAJAAZIQEQJIMIKICBDYAYIYEQKQMZFRBIGILIHICBMYJAIAAJKQMQCQGQHQLaBAFAJAMKCQGQHQLQBaFAJAMAGKKAAZGYIQGQMQHKKAAAIZGQAJKQHaMAAAGAIJKQAZMQFQJQBKLACAHAAAMaFQJQHKAAAI', 'GMsDDGVBiBACKCYCZCBDLDTEjGAYHBDYJILYCRKIFIHIDCGIESDYDAEAGBAaGQLQFQHQIQBZJAIKFAHALAAKEQDQGQAYDIECGYDSHYFYKYCBLIFQIZJQBJHADAAYLQCQKQJQJYCBIIFBKIDJFRHRIZIAJAJZDBKYCRDJJJFAHAAAKAAJLZFQHQIQBZDACAAIAQCQDQBJKQJQIJFBHBKZCZABLJAQDQIIKQFQHQBZIAJAJICBAYAADQJQIQBJFAHAKALZDQAIKILIHSFYCYCAJZAADAKILIHIFSCYIZAA', 'GOQBdCABBBCBLBUBiBMDRDjDgEDGZGBAKQGQKIHILIARJYEQMYNYFQIYBBGIFIFQHBKYGQBQHQMIEAJKEQMYBAGAKIHQNICRDYEYIYJYMYFCGYBRFIIIJIEIMIDICBNYHAKYBQFQMIEANALAKZGQHQJQNJCRDYEYEQIYMZFAFYBCGIHIJIKILIAICREQEYACKYLYHYGYJYBSFIFQIIMJAAAIDIEBNZJAGAHAKJLQNQAQMYFABAKIHQNIERDYAYIYJYMYGCBYFSGIGQIIMJAAAIDIEBNYHAJZAQKYFQGQIIAI',
  'GOcBJDABQBRBaBECVCbCSDgDsDBGoGHBAIGRBJMIEBJYIALYAQHQMIEICIDBJYEQJQCQDQMaBABIGAMIDAIALANJKQJQCQCYEYFBJICQDQJALZGQIQMYBYBQMKDACAEAFAJALAKAKINZCQDQGQIQJJEQFQMaBAHAAAJAGAIANKKQKYLQEQFQJZBQNYAQHQMKDACAJABZGAIALYNAKKLQLICREYFYFQBQJQMZHAAAKILIFQBQJQMIDIEBCBFYLYKYAQHQMIDIEICBFBNZKALJNQBQFQCQJQDQEQMaGAIAKABJ', 'HTBBZGABCBQBcBdBeBgBhBqBGCMDUDwDrEtEDGRGKAMYOIIQEQSYNYGBFIBIJAPAOJKQKYOYPYQYHRFIBIQAOJPQJIKBPYOYQYHYHAOJFQBIQQJIKIEIIBPYKRJYBYFAQAOZHQHIOIQIKIKAOZJQBYQQFYHBQIKIJIOIPIIREYBYKAPAOZJQJIOIPIIIIAOZEQBYPQKYJBQYHRFIGRMINIKBBIEAPAOJIQIYOYPYQYGRJIBIQAOJPQEIIBPYOYQYGYGAHYFRLRRIKALAFANYJAHAOKGQQQBQNQNYSJEABYGBQIPIIREYAR', 'HOpDCGVCWCADJDLDwDyDFETFsG0GQIAIFYHAIZAQLZCQDQJQBJEJFANAHAIAAZMZCQDQJQGJKAHKNQFQEZBZGAJACADAMJAJIQLZHQKQFKEQBZFAEKNALAHaKQEQFQGZJAEJKAHKLQNQFaKAHALJIAAZMZCQDQEQJQGJKAEZCADAMJAJIQLZHQEQKQBJFANAEaHALJEQHaLAAAAIIJEQHQLZAAHKLQNQFQBZKAAAHALJEAIZMZCQDQAJKQGZJAAACADAMJIJEQLZHQKQFKNALAHaKQAZJQGJFAAAKAHKLQNQAa', 'ITeDwEdBICkCADVDgDiDmDoD7DRETEqECGJGFHtIGICALYEQIJHJKABALZOQHQKJDQKYIYQYNAIAJaAQCQGQRQPKNAIAJAKJMQIZNQFKQAIAIYMAKZJQNQFQQJIAFaQQPaRACAGAAAJKCQNQGaRQPKQAGAFINAKJMQFQGaQQPaRAAACAJAKKCQNQAaRQPKQAGKFAAZFYGQQQPaRAGKCANAKaCQJQGQRQPKQAFKAAAYMAKZNQFQQQPaRAFKCANAJaCQGQFQRQPKQANAAIJAKJMQAQIQQZNAAJMAKZJQAQNQQJIAMAAZJAKJAQ',
  'IVYB-DABZBkClCoCEDGDNDQDVDaDcDiD8DeEuEBGKHpIJILITIKIAAKADAOZMQDIAICRKYDANZEAFAPABZRQQQLQJQIQHJSYTAJaLAJIQARABJPQEQFQJQLaQALIRABAPJEQFQJQLQTQHaIAQALJJAEAFAPZBQRQLQQQIQHKTAJAEAFAPABZRQLQQQJJEAFALZRABJPQLQEQFQJaQARABAPJLQBZRQQQJKEAFABALAPZRQBJEQFQJaQABAJIRAPJLQEQFQJQTQHaIAQABARAPALJEQFQJQBZQQIQHKSKKAAACANZBZJAMJOJNQAQ', 'GLABbBQBRBMDcESGgGoGrGBHEAGIDICIARKYGABAFAHKAQCQDQKQEbGABAFAHAJAIKAQCQDQHaBQFQGQELKAHAAACADAIaJQBQFQHKKQEbGAHABAFAJAIKAQCQDQKQEQGaHAELKAAACADAIaJQBQFQEQHQGKKAEbBAEIFAJAIKCQDQEQKQGaHABAFAEKBQCADAIaJQEQFQHQGKKACADAEaJAIKAQEQCQDQKQGaHABAFAJAIAEKCQDQJaBQFQHQGKKAJACADAEaIQBQFQJKCACYDADYBYBAEAEIAICRDYAB', 'GLKBlBUBVBgDIEAGDGLGZGiHEQJYCYDYBBKIJQAQFQIaBACADAKAELJQAQFQIQGQHaBACADAIKAAFAJAEbKQIQBQCQDQHKGAAAFAIaKAELJQIQAQFQGQHaBACADAKAEAJKIQEbKQBQCQDQHKGAAAFAEAIAJaKQELAQEYFQGQHaCADAEAKAJKIQAQFQEaAACQDQHKGAEAFAIAJaKQCQDQEKGQHaBAEACADAKAJKIQAQFQGQHQEaCADAGKAAFAIAJaKQGQCQDQEKHAAAFAGaCQDQDICIAIAQEQEYBYDBCIAI', 'GNRBUBEBFBVBACYCJDkDpDrDSFBGHIAAKIJIGIFSAYAAFAHYGAJZKZIQBQCQEQDQMJHALAKAJJFQAQGQAIFCGYASLYCYDYEBBIKIKAJAIZBQBYESDICIKILIACGIFSAYAAFAGBIZGQJQLQHQMZCADAKABAEAJJLQKZCQDQMJHAKALAJZBQCQEQKIHQMZDACIBBEYCRDRKIHIKABADACAEAJJLQHQMQKaBADAHJLAJZCQEQHQBQDQKKMALAJAIJFQAQGQAIFCGYASLYBYHYDQKQMJLAAAHYEBIYJIJQHQBQHIAI',
  'GNRBUBVBkBlBACYCBDDDMDhDKFpGIIHIKIAQFIGCAYAQGQKYFQHZIZJABACADAEAMJKQLQIQHJFAGAAAAIGSFYACLYDYEYCRBIIIIQHQJZBABYCCEIDIIILIASFIGCAYAQFRGQJZFAHALAKAMZDQEQIQBQCQHJLAIZDAEAMJKQIQLQHZBACADAIIKAMZEQDIBRCYDBEBIIIQBQCQEQDQHJKILAKAMAIaBQEQKJLQHZCADAKABAEAIKMQLQHQJJFAGAAAAIGSFYACLYBYKYEAIAMJLQAQJYKYCRHIHAKABAKIAI', 'GNYBTCIBJBcCdCADEDZDoDqDCEMEIQDQDICIABIYIAJAKZBQDRIIAQLQGJCACYGYHYLYMYFCEIBIDIDAKJJQIQLQGQHZMABAKIJIARCRGYHYMYBBDILICIABIYJYLQMQHJGAAACAIAJAKaLQIJAQCQGQHZMAIALAKKJQJIARCYLYDYBRMIGIHICBABJYKYBQIILAJAKZDQDYBYEYFSIIBAMIGIHICIABLYDBKJJQLQAQCQHZGADALIARCYDYGQHJCAAADALAJAJIARCRDYGYBAJIAICRDRGYGADACALAAAKZJQAI', 'GNdBSCMBNBYCZCADEDbDqDsDCEIEIQCQCYDYABIIIAKAJJBQCRIYAQLQHZDADIHIGILIMIECFYBYCYCAJZKQIQLQHQGJMABAJYKYARDRGIHIMIBBCYLYDYABIIKILQMQGZHAAADAIAKAJKLQIZAQDQHQGJMAIALAJaKQKYARDILICIBRMYGYHYDBABKIJIBQIYLAKAJJCQCIBIFIESIYBAMYGYHYDYABLICBJZKQLQAQDQGJHACALYARDICIHQGZCADAAALAKAKYARDRCIHIBAKYAYDRCRHIHACADALAAAJJKQAY', 'GOsDDGCBJBdBADMDSDUDoDqDbEYGgGDYGYHYIYEBLIMINIDRFQHYCQBaEAGAIICIFIHIDBMYNYCRIYIACALANKMQHQFQHYIZGQBJDAFYCYLYERBIEAIAGZLANAMKCQHQFQGQGYCBMYNYERLICIGIDQIQBaCALAGKCQBIDAFAFINZDQBYCAGYGQFKCQBIDANAHAJAKZAZEQAIGIHJJAMZAAKKMQJQAYHZAAJKMAKaJQMJHQAZGZEAGIJIKJHQMZGQAKNQDQBYCAFaAAAINJCQBIDAFYFQDQBYCAAaCQLQBKIAAAIYBY',
  'HQtDAIGBNBaBeBpBgCLDTDYDyD1DDGqGbHGALYMZAQFQOIEQKIHALYMYAYFQCSDIIIJINIBIHCGYEYKYOYPYCYFBAIAAMKOQPQKKEAGALAOZMZAQCQFQKJPALKOAMaLQMIOJGREYOYPYCYFYKYDSIIJIKICCPIEIGBOYLAMJOQLaPQKaDAFAAAMJOJLQEQGQKZPAOAMaAQAYDRFIOIPIEIGIKIHSBYCYIYJYFBPICRBIHCGYEYKYCYPYDBOIMAAZOQMKAAAILJCQEQKIGAEYCYAYLYMYOYDRPIKIKQBQNaFAIAJAPAKKAA', 'HQwDNFUBYBbBhBkBACFDZD0DBEDElEqERGDQJYEYKIGQCQCYGCOIAIDQEQJIHRLYMYGBCICAJIFAOAAJEQEYAYOYCSGSMILIHBFYPIECAYOYCYCAAJGQJIOQEQEIFIDBOYERJYEAPYGBCIEIOIDRHRLYMYGBPICAFAOAAZEQEIAIOIDIHRFYDCAYOYEYEAAJCQOQDQPYGRMILIFBHBOYEYCYGRJIEAOIHRPYMQIZBAJJCAGAAAKZNQJQBQIJMACAGAJZNAKJAQJQCQGQMQIZBANAJJAAKZJQNQBQIJMACAGAAAKAJZNQAJ', 'GLCDoGABjBBCNCQCZDhDkELFAJEICICQGBHYEQAaFAIYKADAJABKIQBYHQGQAYEADYJYFSKIEIDCHIHADQIAIIGRCYDYEYKYFCJIHIIIDSCIGBDYHYIYJYFSKIEICICAHAIADIGRHYHAIAIYCSEYKYFCBIJICIESHIIIGBDYEYBYCYJYFSKIAJHIIIECDIDAGREYAYHYIYKYFCJICIDIGIESHYIYDBCYJYFSKIAIDIHAIAEAGABZJQDQAQHJIAAZDAJABJEQGQAQIQHZCCDAAJEAGABZJQAQCQDQHJIAEAGABA', 'GLCDrGFBiBECICVCbDjDgEJFAZEYCYCQGBHIEQAKFAIIKADAJABaIQBIHQGQAIEADIJIFSKYEYDCHYHADQIAIYGRCIDIEIKIFCJYHYIYDSCYGBDIHIIIJIFSKYEYCYCAHAIADYGRHIHAIAIICSEIKIFCBYJYCYESHYIYGBDIEIBICIJIFSKYAZHYIYECDYDAGREIAIHIIIKIFCJYCYDYGYESHIIIDBCIJIFSKYAYDYHAIAEAGABJJQDQAQHZIAAJDAJABZEQGQAQIQHJCCDAAZEAGABJJQAQCQDQHZIAEAGABA',
  'GLqDDGCBlBNCQCcCLDTDAERFAZGYDYDAERHIIIGBAKFQKQCQJQBaHABIIAEAAIGRCIJIFCKYGYCSIYIQCAHQHYEBDICIGIKIFSJYHYIYCCDYERCIHIIIJIFCKYGYDYDQIQHQCYEBIIIQHQHIDCGIKIFSBYJYDYGCHYIYERCIGIBIDIJIFCKYAZHYIYGSCYCQEBGIAIHIIIKIFSJYDYCYEYGCHIIICRDIJIFCKYAYCYIQHQEQGQBJJACAAAIZHQAJCQJQBZEAGAAAHAIJCQDSAZEQGQBJJAAACADAIZHQEQGQBQ', 'GMZBECLBNBYCdCADCDpDrDIEaHDAFAJIIIAQKIEBAYLYBRHIGIEAAAIZJZBQFQDQDYFCBIJIIILIAIESGYHYKYCYDYFYBCJIIIAQLICRKIEBAYCYIYJYLYBSFIDIHIGIEAAAKICBAIESCYABLYDRKIAICIECIYJYLYDYBYFSHIGICAKIDBLIERCYAYDYGYHYKYFCBIJIIIEQCQLIARCIECAYAQCRDYEQGYHYKYFYBCJIIILICIAIERDYACCYIYJYLYBSFIHIGIDAEAIYJYKIAICBLYBYFSHIGIKIAICIDIEBLYAR', 'GMZCkDABBBCBUBYBFCDEaEQGqGGQKICRDYEYIYFBKIAALYBQHRFIIIEIDICBGBJILYBYHQKIESDICIGBKYAYCSDYIYFYHCBIJIEICIDSIYLIAQKZECJYHRFIEIIIKJAADCCYJYKYESFYHBEIFSIIDIKICCJYFYEYLYBYHSIIDICIGIABJYKICSDYIYKZHCEIFICIJIARGYDYIYFCEYHSFIIIDIGIABJYKJDSIYKZECCIDIHAJIARGYIYEYCCHYFTCICREJHBIIGIABJYDYBBFZCRBIFIDIDQBZCBFIDIDALJJQBZ', 'GLrDRGQBZBgBlBADpDEFIGaHFAAIGJHIDQJICBEBDYHYAYFQKYIQGJJABAKAAAAZFZIRGRBJJJCJEBEIDDAYKYFBHIAQKQCQDQEQJaBAFAKIDREYCYFYBQJKCAFAKAHAAJDQDIESCYCRFZBZJZGBIBAJHJDJEJCRCIFTBYKYDCEIEAAZHQIQGQJJBAKACAEYDRFAAZHZIQGQJQBKDAKAEAHAAJCQFQEZDZHBABCJFJDRERHZHQGbAAAJCBFBDJEJHRGRFZCZDBEBGJCQFQGQEQKQBaJAAAIAGJDREQKIFBCYKQAa',
  'GNABFBQBVBZBlBBDDDaDJELEjEoGCQIIEICIASGYHYJYKYBYDBIIIALAMJAQCQJQGQHZKAEAIYDRBIKIEBJIABCYJQIZLAMYFYDRBRKIEIGIAACAMYFYDYBRLIFBMICQAQGYEYFBLYBBDILQIJJAMICIARJYESFYFQHJGAJAAACAMZLQIQFIEBIYBYDBLIIQEQFQHQGJJACAIYFREICIJQGZHAEAFAMIAQJQGQHZEAEYKYDBBIFAFICIERKYFBBYDRFIKIEBCYBYDYFRKIEICBBYESCICQHJGAJAAAMYEQCQHQGJJABY', 'GNABlBBBECFCQCRCKDSDcDoDaEqGHAIALAMAKKFQAQGQCQHZIALAJZDQEQIJHJAACAFAGAKaMQJQLQHQIZDAEABABYESDIBCJILIGICSAIFBCYGYJYLYBSDYECBIDRHIIIAIGBCIMIKIFSGYCCJYLYDYBYBAERHIDAJJLQAQCQIZHAHYEBJIDQHQIJAACALAKAMZJQBQBIDIKILICSGIFCCYGRAYHYDAMYJYBQEQIIHALAKAJAJYMJCQFQGQAQHZIZDAEABABYESDIIIHIFACALIAIGBJYMZBQBYEYDSIIHIGAKYLIBC', 'GNADpDcBdBgBICTCJDhDRECGLGrGCAKIAIFAEABYMYDQCIGIIIJIEIFRAYHYKYLYCBDBMIBIFQHQLZGAIJJQHJEALIFBBYBAMaIQGQIYDRCRKIAILJAQKaLAAKHAHYAYCADAIIJABJEQMIFRHYHQKQLaAAAIKJHAFALIMYIYDQCQKIHIFBEYBYJYGYCYCQDBIIDQGQKQAQLJHAAaKACADAGAIAMKBQEQFQJQAQHQLaKAHKAAGAJAIaCQDQGQHQAKJAIABAMZCQDQHQAQKQLKFAEAJAMYGQAaHAHYDBCIGIBIMIEQIYBA', 'GNFBgBEBACBCUCVCKDSDYDsDaEpGHAIALAMAKaFQCQGQAQHJIALAJJDQEQIZHZAACAFAGAKKMQJQLQHQIJDABAEABIDSEYBCJYLYFYCSAYGBCIFIJILIBSEIDCBYERHYIYAYFBCYMYKYGSFICCJILIEIBIBADRHYEAJZLQAQCQIJHAHIDBJYEQHQIZAACALAKAMJJQBQBYEYKYLYCSFYGCCIFRAIHIEAMIJIBQDQIYHALAKAJAJIMZCQFQAQGQHJIJDABAEABIDSEYIYHYGACALYAYFBJIMJBQBIDIESIYHYFAKILYBC',
  'GNJBUBIBYBZBdBFCDDSEAGKGoGrGBQIQKQHQHYJJAAKYBBIIEIDICRAYAQJZBAKIAICBDYEYIYFYGRBIJJAAKYFBIIEIDICRAYAQHYJZFAFYBYBQGBIIEIDICIARHYKYFQJJHAKAAACADALAMaEQFQIQGQJIHIKIABCYDYFYEBIYGRBIEIEAFIDICIARHYJYBAGAKYFAIAMKLQAQCQDQKQHQHIJZFAKIABCYDYIYERFIFQHIJJAAAICCDYCQIYEYFRKIAQJZBYGBFIEIIIARHYBYKYECIIAIDICREQHYKYBQJJHAKAAA', 'GNDGiGTBUBYBhBVCKDMDZDIEAGrGEQJYCYDYMYGQIQHJCADAJKCQKQLQAaDAHAIYGBBIMICRKIEBFYCYBYMYGRIIIAJAJIDRAILIEBKYDYJYJQIQIYGBBIMIDRKIFBCYDYBYMYGRLJKAJZIQLQHQAJHYKALZGBBIMIDICIFRLYIAJJLQEQKQAaGAHAIAJALKCADAFAMaBQLQGQJQIQHQAKEAFAKACADALaBAMKLQCQDQFQEQKQAaGAHAIAJABAMALKCQDQFQBaGQJQIQHQAKEAKABAFAJZIQBJFABYCYDYLYMYGRHIHQAQ', 'GNLDjGYBNCQDZDbDhDrDAEDGSGoGIIKYDAGIFIMICQEQJQKZAALAFAEJFIJQLZFAEAEIJICBGYHYBYMYIYDSAIEIFIKILICBJYGYGABAHKMAIaHQMJJQCQGYEYDAHIIJJQCQKYAYLYFYDBBIGQEZFQLJCAGYBYDRAIKICALIEAGAJAIZHZDQFIGJJAIAHZMQBQGQGIJICREYFYKYAYLYDCBIGIIIMIHICRJYFYFQLQAQKJEAAaLAFAFIJICBGYHYIYBYMYDSFIKIEILIAICBJYGYGABAMAHKIQJQGZFZDAFIHIIJJQGQAQ', 'GNZBdCKBLBMBNBYBcBjBaCoDAFCGIAMICAJAKKAQGQJQCQLQMaDAEAFABAHAKIIQHYBYFSEIDIHBIBKYFQERDIBBIQIIHSCIJBKYIQBQMJLAAAGAKZHQHYCSJIHCCYIYFYERDRMIHACBIYFYEYDRBIJIFCIIIAKJAQCQGQHQLQMaBADAFAIAJAEAKJCQCIHSLIGCAYHYCYIRFRMIGAABHYCYIYFRLIAIHBCYARLYFCIIAICIHRGRMYFAIBAICIHIGRLYIYABIACAKZAQDQBQEQFQJQMKIALAGAHAKZAQCQFQFYACEYJRAI',
  'GLBDrGFBVBACJCKCUCYCDEhEDQHYDYCSJIJQAKFAGAHBKAKIFSGYHYJYCBDIKIHSJYCYDBJAHAKIHIFIGSJYJQAaHBKYDRCIHIAIJIGCFYKYDYCRBYHIAIJIGIFCKYDYCYHSAIJIGIFIEIICBZKYDYGSAYJYHCCIGIBIDIKIISEYFYAYJYGCBJDIKIFSAYJYGYDCKIFIIIESAYJYFCKYDSGIFIAIJIECIYBZCQDQGQHQKYFRAKJAJIEIICBYKYFYDYDBCZGRHRARJJDBAYCAAIFBCYDTAYJYHCGIDICICQAQAYDBCIAQ', 'GLMEYGIBdCbDgDiEAGDGJGRGFQGIBQCQEZGAFKBQCQEQJYKYAYDBFIBICQKQJQHQIaAAGAFABJEQFaGQAQIKHAJAKACAFAEABaGQFJGIBICQKQJQHQIaAAFAKJCABYGYDRAIFIHIIIJICCEYJYFYKZFQJKKAFaGABJEQFQKQJaGAFKEABZFQGQJKKAEABAFaGQEKKQJaEAGAFKBQDAKQJQEaGAFABKKQFaGQEKJAFAKABaGQFKJQCQEZFAGABKIYKQJQCQEQFZGAHYAYDBBADQKKJQBaGQAQIKHACAFAEABAJAKaGQAQ', 'GLbCBELBkBACRCSCYCpDUEDGDIJAAICSJYCADCAICIIJFQGQBQKZDAAAIIGIFIHIESBYJYDYABCIDSJIBIECHYFYGYDYCYIYASJIDBJAAAIIGIFIHIESBYDYGBIYAQJQKJBADAEAFAHAIaCQFQDQGRDIFCGYDSJYABCIDIGIFSJYDCCYARDIJIFCGYCYAYDSJICCGIFSCYJYDCAIGIFICSJYDYKYACGIDSJICCFYDYGYASJIDCFICSDYCAJYACGIFICIIJDREQHQBQJYKZAYGCFIASJIBIKJECHYDYCYIYAYFYGSJIAB', 'GNJDgGdBICUDZDbDjDpDDEAGRGrGIYJIKIDAFYGYMYCQEQJQKJAALAGAEZGYJQLJGAEAEYJYCBFIHIBIMIIIDSAYEYGYKYLYCBJIFIFABAHaMAIKHQMZJQCQFIEIDAHYIZJQCQKIAILIGIDBBYFQEJGQLZCAFIBIDRAYKYCALYEAFAJAIJHJDQGYFZJAIAHJMQBQFQFYJYCREIGIKIAILIDCBYFYIYMYHYCRJIGIGQLQAQKZEAAKLAGAGYJYCBFIHIIIBIMIDSGYKYEYLYAYCBJIFIFABAMAHaIQJQFJGJDAGYHYIZJQFQAQ',
  'GNKDgGdBICUDZDbDjDpDEEAGRGrGAYIYKIDAFYGYMYCQEQJQKJAALAGAEZGYJQLJGAEAEYJYCBFIHIBIMIIIDSAYEYGYKYLYCBJIFIFABAHaMAIKHQMZJQCQFIEIDAHYIZJQCQKIAILIGIDBBYFQEJGQLZCAFIBIDRAYKYCALYEAFAJAIJHJDQGYFZJAIAHJMQBQFQFYJYCREIGIKIAILIDCBYFYIYMYHYCRJIGIGQLQAQKZEAAKLAGAGYJYCBFIHIIIBIMIDSGYKYEYLYAYCBJIFIFABAMAHaIQJQFJGJDAGYHYIZJQFQAQ', 'GNADZDKBLBVBjBICCDbDkDsDEEgHCYDYIABJCQDQHQHYLYEBBIIIFBMIGRHYDBFYBYIYERLIDIHIGBMYJYKYERBIIIDRHIHADAFABZIQLQHJAJCBGABZIZLQHQAJDAFAIAIYLYBIEBJIKIMIGSCYFYDYAYHYEBIYLIBIBAMAKaJQLQBJIJFQGAKYJZLQBQIJDQAZHAIYIABALAJJKJGQCQAYDABZLAJAKJMQBQBYLYERHIIIDIAIFICIGCBYFQMYJYKYERLIDRAIAQHaIAAJDBFALYBIEBJIKIMIGSCYFYHYDYAYIYEBLIBIBA', 'GNgBkDKBNBQBUBjBLCCDEDsDAEZFDQJQIJCAHAGAMAKaBQBYDRFIGIGAHRIYJYFBGIHIMIEIABKYKABaHQMQJQJYHBDYGRFRIICILIABEYJYCQIYFBGBDIHRCIJIEIARLYIYCAHAJAMABKKQKIAREYMYHYCSIIJILIEBABKYBYCQGYFRIIJILIEIABMYHYGYCBBICQGQHQLQIZJAFADABIGQLIHBGYCYDYFRLICBGIGAKJMQAQEQIZJZLADAFABAKJHRCYGBHIMIASEYEQIQJZCAGAHAMAKaBQBYFRDIHIGSCICQJJIAMAKABZ', 'HSACLCKBaBmBtBBCMCCDYDdDgDrDNEEGjGoGwGEQMQPIQJLQJQAQGQIZBADICRBYDCCICAPZBQEAFAMJRJLQJQPZCQDQOZNAKAEAFAMARJLJJQQZMZEQFQKQNQOJDACAMAQJJALZRZEQFQMJCQDQOZNAKAMAEAFARJLJJQQZCQCIDSHYKYMYEBFICIDIHRKYKAHAMACADAQKPQAQBQGQIQOZKAIKAABAGAPAQaCQDQHQMQIQIIHBDYCYFYERIIMIHIDCCYCAQJJALZRZEQFQMQIQMYNQKJDACAHAIYEBFIPIQIJIRILIASGYBYCYDROIGAAA',
  'IVoEkFABGBPBmBFCMCTCfCBDDDdD2D7DQEqEJGgG4G9GEAPICRKYLYHAMYDREYJCFIDRMJEQGQHQLKKKRYIARACAPASAAAQATAOaUaNQNYFRDIBIQITJAQSQCQPQRQKaHAIAQATAUAOKAQTZQQHQIQKKRACAPASATAAAOaUQQQQYTJAAOAUZNZBQTJQANAUJOQNaQQTZBAUJOJNQAQTZHSIQKQHBLZGAMYDAFAUIHSIISITICRPYKYKQLQLYRJIAHAPACAUYFQDQMIGQRJLAKASATAAANAOZQQAJNBOBQZARNJCQNQTQSQPQLZKAPJCBPYSYIYHCBY', 'GLIDpDSBTBFCYCQDcDhDCHjHAAGACYDYHYHAKABKIQDQIICRGQGIFBCYDYIYBYKYESHIGIDBJIAIFACACIFSAYDYGYHYJYECBIIICQKIGQDIFBCYIYIABaKQEQGJDQDIFICCBYIYKYERHIJIDBGYGAKABKIQIICSFYGYHYEABIIICICAFRGYGAHaKAIABaEQIIIQKQDQJQALGAGJHBDZCBJYEBIIKYIABKKQCQJQGQAZEAAIEQGYAQHLGACAAYGYAAJAKABaIQIYERJIKICRDJGRAZAQHbDAJAGLAQAJCBFBBYBAIaKQAQAY', 'GLMDrDSBTBACdCUDYDjDBHgHAAGADICIHIHAKABaIQCQIYDRGQGYFBDICIIIBIKIESHYGYCBJYAYFADADYFSAICIGIHIJIECBYIYDQKYGQCYFBDIIIIABKKQEQGZCQCYFYDCBIIIKIERHYJYCBGIGAKABaIQIYDSFIGIHIEABYIYDYDAFRGIGAHKKAIABKEQIYIQKQCQJQAbGAGZHBCJDBJIEBIYKIIABaKQDQJQGQAJEAAYEQGIAQHbGADAAIGIAAJAKABKIQIIERJYKYDRCZGRAJAQHLCAJAGbAQAZDBFBBIBAIKKQAQAI', 'GLpDAGIBJBDDKDMDSEYEUFrGAYEIHQFQGZEQBKCADAIAAAKaJQFJHAAJIQDQBZEAFAJAKKIQCRDQGZFZJAAJHQFQGJCBDAIAKaAQJQEQBJDAFZGQEZJAAAKKIQFQGZHAAZJQEJHAFJGQDQBZEAJAAJFQGJIAKaAQJQEQBJDAIAFZGQHQEZJAGJFJIQDQBZJAGAAAKKIQCRDQEZHAGZAAFJGQHQEJCBDAIAKaFQAQJQBJDAIAGZAZJQEJHAAAGJIQDQBZEAJAFAKKIQAZGAFZJQEQBJDAAAGZHQEZJAFJHQAJGAIAKaFQJQEJAA',
  'GMAGoGFBTBQCIDUDiDREcEKGrGAJFAHYDQGYKZGADAJALABKEQHQIQKQFQAZGAFKKAEAIAHABaLQDQJQCQFQGQAKKAEAIAHABALaDQJQHKIQGZFAHYHADAJALKBQEQIQGQKQAaFAFIAIKJEBIYDYJYCRHIKYHAGKKQHaGAGYCBJIDIIIERAYEAFYCAKJIABALaDQJQKQCQFIAIEAGQHJIAKaDAJALKBQKQEQAYFYCAIQHZGADAJAKKBALaKQDQJQCQGQFQAKEAHAIABALAKaDQJQBKEQHYAYCAIQFZGABADAJAKKLQEQIQFQGaAQ', 'GMAGrGIBaBFCDDRDkDTEYEKGoGHYERFIAICAKIGADAJALABaEQHQIQKQFQAJGAFaKAEAIAHABKLQDQJQCQFQGQAaKAEAIAHABALKDQJQHaIQGJFAHIHADAJALaBQEQIQGQKQAKFAFYAYKZEBIIDIJICRHYKIHAGaKQHKGAGICBJYDYIYERAIEAFICAKZIABALKDQJQKQCQFYAYEAGQHZIAKKDAJALaBQKQEQAIFICAIQHJGADAJAKaBALKKQDQJQCQGQFQAaEAHAIABALAKKDQJQBaEQHIAICAIQFJGABADAJAKaLQEQIQFQGKAQ', 'GLABdCKBaBbBJCEDgEBGqGLHAREIDICRIYGYKYBCEIDICIJIHIARFYHAJZDQEQBQGIIIFAAAJYCQKYBYECDICIHIAIJIFSIYGYEADBCIBRKIABAYHYKYBBCYDRERGIEAIIAAFAJYCYBRCAEYDCBIESJIFQAQKIAIEAFCHYCYEYBYDSKICBHIFSAYCYIYKYDCBIEIGYHICRJIKYEBHICIFIASKYEYDYBCHIERKIACFYCYEYHYBSDIGIIIJYKICBEYHYBYDSKICIAIFCEYARCYJYKYDCBIHIAICRHQKYDYBBHIAICIEIJIFSKYDYBY', 'GLADrGgBICVCRDTDbDEEZFJGAJDACAHQGQFJJABaEQHQGQFQIQAJKAIYEBGIHIBICQDQJABAHaGQKYAYEAFIFQEQIQAQKKDACAHYGZFQBJJQAZAAIAJABZFAGJHJCQDQAYHYKYEAFABJFYEQHAGaBQHKJQHYKIAIAQKaIAFAHABAGKJQFZIQKKAADAFAJAGaBQCAHQIQFJEQJAHZIQFQKQAKJAHAGABaIQHJJQAaKAEAFAHAIABKCQDQGQJQFZHAIABAGKJQFQAQKaEAHAAJFAJAGaBQIQAQFJIIJAGABZIQAQEQFQHQKKJAGABA',
  'GLsDAGFBICVCRDZDbDgEDFiGAZEQCQFAGAHZJQBKDAFAGAHAIAAZKQIIDRFYBYCAEAGYJQBQFKGAKIAIDQHYHADAIAAAKaEQCQFIGJHABZJAAJAQIQJQBJHQGZFZCAEAAIFIKIDQHQBZFQGKBAFaHIDAJAFIKYAYAAKKIQHQFQBQGaJAHJIAKaAQEQHQJQGKBACQFAIAHZDAJQFJIAHAKAAaJQFQGQBKIAFZJAAKKQDQHQFQIQBaCAEAGAJAHJFQIQBQGaJAHAAAKKDQFQAZHQJQGKBAIAAAHZIYJQGQBJIAAADAHAFAKaJQGQBQ', 'GNFBKBTBUBVBaBRCIDDEAGjGoGrGGYFYBRFAHIBAGAKaCQDQEQAQIQJKGAHABAFAKALAMaCQKIDQGQHYJYAAEADICICALIMJGRFYBYIYCBKILIGIFSBYFAGBLYMZDYERARJIHIBAFALYDYEYARCIIIKIGIFIBRFAHYBAGAKaAADAEAMKLQKQFQGQHIBAFYGYIYCYABEICRIIGIFIBRFAHYBAGAKALAMaCQDQEQKKFQGQHIBAFYGYIYAYKYECCIDILIFQBQHYJYEACBDILIMJFQFIBSGYIYAYKYCYCADBLIMIFIBIGRIYAYCYDYDAKJAQBA', 'GNbBgBLBQBRBSBMCkDhEAGDGIGrGGICIABCQHYAQGQLKDABAEAFAIAMaGQHQAQCQLQKQJKFALYEAGAHIMIBQDQEYFYFQJZKYGBCIAIIIFRKYLYGYCCAICQGRJJKIEIDBBBMYHYAQCQKIEIDIBBFYIYLYGYCYABCQHIAQGQLKBQDQEQJaKALACAGAHYAQCIGIIIFIBRDYFBIYGYCYABCQHIAQGQLQKQJKDAEAFALaCAGAHYAQCIGIIIBILIDSFYEYJYKYCBABHIMIDQFREYJYKYCYABGIIIBILIFIERFQJYKYCYAYGBIIBIFIEIEQLZAQBA', 'GMCGoGQBRBFCADLDcDSEjEIGgGJIBILICRDYIYGQHYEQAIFIKJDBCBBYLYJYERKIEAIAHZJABKLQCQDQHQIQFQAaKAGAJAHJEAIQFQGZJAHABALKIQHZJQGJFAHAIALaBQEQJQGQKQAKFAFYAYKZEBJIIICIDRHYKIHAGaKQHKGAGIDBCYIYJYERAIEAFIDAKZJABALKCQIQKQDQFYAYEAGQHZJAKKCAIALaBQKQEQAIFIDACAJQHJGAIAKaBALKKQCQDQIQGQFQAaEAHAJABALAKKCQIQBaEQHIAIDAJQFJGABACAIAKaLQEQJQFQGKAQ',
  'GMLGpGUBVBYCQDhDsDBESEDGjGIYAYKYDBCIJIFIEABYGAHYLZCRDRAIKIIIEBLYEQJQFJIQKaAADACAFAJAHABKLQGQIQFZEQJAHAGJIQFQKQAaJAFJIAGZHQFQJQAKKAEAIAGALABaHQHIBILJERIYJYDYCBFILYFQGKLAFaGQGYCRDIJIIIEBBYEQHYCQLJIQKQAaDAJALACAGAFJHIBIEQIQLaDQJQAKKALAEABYHYCQDQIAFZGQJQAQKKLAAaDACAJAGAHABKEQFQIQAQLQKaDAJAAKEAFYBYCQIAHZGQAQDQJQKKLAEAIAHAGaBA', 'GMNCZCCBMBlBYCcCiDqDIESEDGJABAFAIZHQKQCQDYGBLYAAEAHJIJBQFQJQLZGAKICRJILIFCBYCYIYHYKYEYASGIDIJICBKYEYDRJICILIFIBCKYCRJYDBEICIKIBSFYJYDYLYGYACEIEQAQGRLJGAJAKAIAHZCQCIDSGYCCDIDAHJIQKQJQLZAAEAHIGRJILIFIBCIYKYGYDYCRHYEQAQJILIGCIIKIBSFYGYJYCBDIKILYAAEAHIIIBIFSGYBCIYHYKYDYEYASCIJILIBIGIFCIYKYBSJYEBDILYCAAAHIBIIIKIFSGYJYEYLYDCAY', 'GNEBoDFCJCQCbCADCDKDhDsDcESGEAJYFYKYLYCSAIAQHJIAMAFALAKABKJQDQEQGQIZHZAACABIJJDQEQGQIQHZMAIKFAGADAEAJZKYKQFQLQIQMQHKGADAEAJAKZBZCQAQHIGJDAEAJAKABZFQLQIQMQGQGIHZAAHIMIFCBIJIKIESDYFYGYHYAYMYCCIIJILIBIKIFSGYMYAQHIGAMAJAIZLABJKQIQJQMQGQGIHZAAHIMIFCIYJYKYBYLYCSAIAQHJGAMALABAKJIQBZLQMQGQHZAAAYCCKIIILIBIJIFSGYMYAQHIGAMAJABAIAKZLQAQ', 'GNQBkDABLBMBjBBDEDJDsDREbGgHEIDIGIIICIABKYIQGQHZDAEAIJKIARCYGYHYDYDQHJGAKALZIQDIEQHIGIKICICQGZHZDAEAIALJCQGQHZKAIZLYERDIKIGIHIABCYIYLYEYDRKIGIHIAICBLYFBBYJYDREIFILICRAYGYHYKYEBDBBIJIMICRLYFYDYERKIFBLIARGYHYFYKYEBDIIJLIAICBMYBYJYDRLIFRGIHICBAYFYLYERKIGIHIFBAICRFYGYHYKYEBLIAICIFRGYHYABLYDBBIJIMIFRCYIZLYDYERKIAIGICALYARKYEBDIAI',
  'GNkBADIBJBYBlBbCCDcDhDoDKEEFDQKIEQCQBQHZLADICIEBJYKYDRLQHJBACAEAJAJIERCYLYGBDIJQKIEQCQLQBQBICBEBJYKYDYGRBICIEBGALYDBKJJQLQCQEQHZBADAGAKAJJLQCQEQHQBZGAIZAAFAJJKQIQGQBJHACAEALAKZJZAQFQMQBJGAIAJAKJLQIZGQBZMAAAFAKJJQDRGQBQHJCAEAIALAJZGQIJCQEQHZBAIAGAJJLQCQEQIZBQHJIACAEALAJZGQBQHQIJCAEABZGAKZAQFQMQIJHADBGAKAJJLQBQCQHYGABJLAJZKQBQ', 'GNQBkDABLBMBjBBDDDJDsDREbGgHEIDIHIGIIICIABKYIQGQHZDAEAIJKIARCYGYHYDYDQHJGAKALZIQDIEQHIGIKICICQGZHZDAEAIALJCQGQHZKAIZLYERDIKIGIHIABCYIYLYEYDRKIGIHIAICBLYFBBYJYDREIFILICRAYGYHYKYEBDBBIJIMICRLYFYDYERKIFBLIARGYHYFYKYEBDIIJLIAICBMYBYJYDRLIFRGIHICBAYFYLYERKIGIHIFBAICRFYGYHYKYEBLIAICIFRGYHYABLYDBBIJIMIFRCYIZLYDYERKIAIGICALYARKYEBDIAI', 'GNlBACYBZBcBECNCCDJDoDaERGqGGAAAIIMIJICQBQHZIALADAKAJAMZAQEQFQGQIJHJBACAMYEYFRLIDBFAKYEBJIMJCQCIBSDYDQHZIZGAAALYFBAYGSFIACEIEQAQIIHIDABAKICBJYMZEQEYGYFSAIAAFAGBEIMIBQDQHYIYGAEAMJJQCQKQLQIQHJDAHYIYLYGYAYFBEIASGIHIIIDILIBCCYJYKYAYEYMYFSGIECAIKILIDSHYIYEYLYACKIDICIBRHYIYEYAYGYFCKIMIJIBQLYASEIHIIILIBCCYDYAYJYKYMYFSGIEIHIIILIDCAYAA', 'GNADoGCBQBRBNCIDgDkDrDDEaESGFAIAJIJABKHQHIDREYLYIYJYFRKICIAIGIEBDBHYBYFQMILAHABZJQHKDQLQMaFAIAHAJABKDQLQMQEQAYIZHAMJEQGYCYKYFBJIMILABZJQMQHQIJLAMZFRKICIAIGIEBDBBYJYFQIIMYHQCRAIGIEIDBLYCYHAIYFAJABKMQLQDQEQAZGACALIDREYCYGQAJCAEADALAMABaJQJIBIMJDRERCYAYGYKYFBHIMILQIZKQAJGAIALAMZHQKQAQGJIAAZKAHAMJLQAQIQGZKAAJLAMZHQAQKQGJIALAAZHAMJAQ',
  'GNEDrGDBUBVBICMDgDkDpDBEaERGFAHAJYJABaIQIYERDILIHIJIFRKYCYAYGYDBEBIIBIFQMYLAIABJJQIaEQLQMKFAHAIAJABaEQLQMQDQAIHJIAMZDQGICIKIFBJYMYLABJJQMQIQHZLAMJFRKYCYAYGYDBEBBIJIFQHYMIIQCRAYGYDYEBLICIHIFAIAJABaMQLQDQEQAJGACALYERDICIGQAZCADAEALAMABKJQJYBYMZERDRCIAIGIKIFBIYMYLQHJKQAZGAHALAMJIQKQAQGZHAAJKAIAMZLQAQHQGJKAAZLAMJIQAQKQGZHALAAJIAMZAQ', 'GNsDDGUBVBjBQCBDIDMDkDKEhEZGFQGYHQGQBaIAIYDBCIKIGIHIFBLYEYAYJYCRDRIIBIFAMYKQIQBJGAIaDAKAMKFQHQIQGQBaDAKAMACAAIHJIQMZCAJIEILIFRGYMYKQBJGAMAIAHZKQMJFBLYEYAYJYCRDRBIGIFAHYMIIAEBAYJYCYDRKIEIHIFQIQGQBaMAKACADAAJJQEQKYDBCIEIJAAZCQDQEQKQMQBKGAGYBYMZDBCBEIAIJILIFRIYMYKAHJLAAZJQHQKQMJIALAAAJZHQAJLQIQMZKAAAHAJJLQAZKQMJIAAALAJZHQKQAJIQMZAA', 'GLsDJGdBiBjBUCaDEEYFBGRGBYJYHYCCFIGIDAKYGAEAAZEIEQFQCQGQHQJKBAKAIAAZDQEYGYFYCSHIGADAEAAJIQGZHYCCFIEIEQHQKJGAIAAZDQHYEBDJAJHQIQGQKZEAEYCYFBDICSEIEQHAKJGAIAAZCZERHICBAJCQIQGQKZHAEAEYDYFRHIGJIAAZCQEQGQGICBHYFBDIEIAJCQIQKQBQJaHAGAEAEYDYFRGIHIECGYGQEQHQJKBAKACAIAAZDZGRERHYFBGIEQFQHQKKBQJaKAHAEAEIDIDAAJCQIQBQJQKaHAHIDCCICAAAGZEQCIAA', 'GNJBFCEBIBTBUBSCdCYDgDpDCEjEAADAIAKYGQIIDRAYLYEBIIDIARLYEYCYFBIIGAMAKKJQJIARDYGYIYMYFSCIEILIDBABJYKYFQCREILIDIABGYIYMYCYFBKIKAJKGQIYMQCYFYERLICBIIGAMAJaKQKYERFIIIMIGIASDYCYLYFBEBKIJIAQDRCYLYFYEBIIMIGIDIABJYJAKaGQIYMQERFILICIABDYCRLYFYEBIIGAMAKKJQJIDRCYGYIYMYESFILIAICBDBJYKYEQFRLIAIGBJAKZMQIQIYFYEBMIJIKIDRIYARLYEBFIAIIIDBJYKYMYFRAI',
  'GKCDpDEBNBdBgBQEJGrGSIAZDAHYCYDYECJIBAGIFBBYIaJQCQDQEQALHAHIFBGYCYCRDZEZARHJAADADYEYJAIKBQGQDQHZAAJAIABLGQDQDYEYCBGIDRGABaIQJQAQHJCAEAGAGYCSEIEQHZAAJAIABKCQCYESGIFRGACAEABaIQJQAQHJGAGYECCIEQFIDBBYBAIaJQEIGIDBFYGQHZAAEJGJFIDRHYHQAbCABIEAGAAIJAIKBQDRFYCYJYESGIHIFBCYJYGQAKHAJABABJDJCRCIFTJYGYGQAQHJJACADAFAIaBQEQGIDIDBBABYBAEZGRAR', 'GKQBdBFCRCBDDDIDsDiEKIARDQEYGQEQFaJABYIAHZBQCSJIEIFIGIADDYDAHZIQGQGJERFRAJDBAYEYEQFQJYCCBIIIEIDRAYJYCYBDIIEIEQFQGZIAEJIYBSCIJIAIDBFYGYIYIQGKFAFIDRAYJYCYBCGIGQFKIAHJIYFYGYBSCIJIAIDBIYIQFaGAFIHAEZBQBYCSJIFAIAEZHQIIDRAYFBIBHAEJDQDIATFYGYBAIYAAJYCCBIEJHQGQJQFKIADAHZGQJQIIACDYJYBYBBEBGJGAHLJQIQIIAIDBJYEYGYHYCSBIFIIAEAEZBYBQBYFRIJAJ', 'GKVBYBACUCBDDDMDoDiEJIARDQFIGQFQEKJABIIAHJBQCSJYEYFYGYADDIDAHJIQGQGZFRERAZDBAIFIFQEQJICCBYIYFYDRAIJICIBDIYFYFQEQGJIAFZIIBSCYJYAYDBEIGIIIIQGaEAEYDRAIJICIBCGYGQEaIAHZIIEIGIBSCYJYAYDBIIIQEKGAEYHAFJBQBICSJYEAIAFJHQIYDRAIEBIBHAFZDQDYATEIGIBAIIAAJICCBYFZHQGQJQEaIADAHJGQJQIYACDIJIBIBBFBGZGAHbJQIQIYAYDBJIFIGIHICSBYEYIAFAFJBIBQBIERIZAZ', 'HQZBmCGBSBWBYBdBACqDsDEETEoEiGyGBHAAGANYJAIJOIMIFRIYNYJYGREYCRKIPIABDYLYEYGBIIJINIHRAYPYEBGYCYBBOIMIFIHRARPYEYGBLIDIAIHBFYMYOYBRCILIERGYKYCBBBOIMIFIHRAYDYEYGRPIABHBFYMYOYBRCRKIPIDBEYGYLYCYBBOIMIFIHRARDYEBAIHBFYMYOYBRCILIGIAIERDIHBNYGRAIEIDRPYKYCBLIAIGBNIHRPYGBAYLYCRKIGIABLYCYBBOIMIFIHRDYEYLYGRAIPIDBHBFYMYOYBRCIGIARKYCBBBOIMIFIHRDRPYKYGBAI',
  'HReBSHVBgBhBiBjBDDFDLDNDYDkDwDyDAHsHAALADAEAMINAOZFQGQBQLKPQHaIaKAKYABCIJILIPIDBEYBYLQJQMYCQJIPIDIEBBYGBQYCRLIMIGIBIERDYPYGBLYMYCBQIFINIOIERBYFBQYCRLIMIFIBIDRPYGYFBLYMYCBQINIOIEIDRBYGRFYJYAQKQIKHKPABADAEAOZNQGQGYFSJYKYAYCBLYMIMAQANKOKDQEQGQBQJaLAMZAQCQKJLAJKBADAEAGAOaNaQQAQCQJJMAFAFIGIGANAOJDQEQBQMaLQLYFBGIBIDBEYNYOYQYCRAIGIBIDIEBNYOYQYGRAY', 'GLIBFCUBdBkBYCBEDESEhGpGAADQIYCYEBDYBSHIGIAIFCJYKYCRIIARGYHYBCDICIJIFRGYHYEBCBJIKJARIYCYERHIGIFBAYJYKYDYBSHICBEYDBJIKIAIFSGYCYEBIIABJYKYDRIICREYHYBCDIJIKIARCYERGIFCAYJYKYDYBSHIBAGICBEYIYDBJIKJERCRGYHYBBJIEIAIFSGYHYDBIIEBAICREYIYDRHIGIFCCYAYJYBRHIGIEBABJYKZDRIIAIERGYHYBBDIJIKICIFSGYABEICBJYKYDYBSHIAIEBIYDBJIKICRIYAREIGIFCCYJYKYDRAI', 'GLCDoGBBNBYBACcDkDrDKHZHCQDAIIBIEQFQAZJAGAGZHBKJCRGYHYKYDSHIGICBJIAIFAEAEIFSAYCYGYHYJYDCHIGICIKIEICRGZGAHbDQJQALGAGJHBCBEYKYDRJICIHRGZGQAbCAJADAKAIAIZDRBIEQIIKIHIHQGQGIFBEYHQGQCQAICYFAEABZIQHJGQKYDBHIGIEIIIBIFSCYCAEBFABYGYHYIYDRKIEIGAHZIABJFQCQAYCIEAFBHYHQGQKYDBBIHIFRIIGICRAREZJZDBJIEIKIAIFCCYGYGAIaKQAKGAIAHABaKQAQGKIAAaKABKHQAQHYBY', 'GLIBdCDBEBNBBDgDrDJFTFoGEABAFYGIHIKIASIYCYCRDZJBGJCQDQJQFKDACAGZIAAAKYHYHAKKAQGQCQDQIQFaDACAGAJAHAGJCRCYDTFIIIADCYCBDZGZHQJQFJIAGADJCRCIATGYIYFYJYEYERFJBAEAHIJADADICICAKZHQDICIGIAAGQKYHYBREIDBCIJQFZDACAEABAHAKKGQGYHZCQDQKYBQEQFJJACYDREYBBHAKIGIAQGAHYKZDQDICIJQFZBADAEACAGJKJAJHRIRFZIAHAJAAAKaGQCQCYESJIACCYEYDYBSJIAICCEYASJYBCDIAIDQBQ',
  'GLADrGFBECCDcDkDpDIEKEZHHYBYKYFYGYCTDIDQEJAJIAJIKAGaBAHKGQBZHYCYDRJIAQEZJAFACACYFICAHIHAGKBQKQIQEZAACACYFYDAHAGABKKQCQAQIQAZCBFYJYDBHIFQCQJQEKAAIAFZHZDREIAJHIIAFAKABaDQGQHQJICICQAQEZJACIFJIQEZAAFACYJQAJFACACYHAGAJYDBBKDQKQHaCQJQAQAZFJAACAJAHKKABaDQGQHQJICICQAQEJIAKAHaGABJHQKQIQEZFZJACIAQFQEJIAAZCYJQEJFACACYGAJYDBBIBAHLKQAQIQFZEZDAGIAJ', 'GLEDrGDBTBgDiDpDMEcEJFAGGYJYDYDAFACQEJGABaIQHQAQKKJAFZCQDQAZHAIABKGQFQJQKaHAIAEJFJJQAZCBDAFACQEZIQHQKKAAJAGABaIQBIFJEAGJJQAQKaHAFAEJCQDQAJJAGZCQDQFZEAIABJGQJQAZFAEZHQKKAAJAGABaIQHQFJEACADAGJJQEZFZHAIABKJQEQAQKaHAIAGJCQDREJAQFZEACADBGZIQHQKKFAAAJABaIQBIHQEJAJJAGZCQDQAQEZHAIABJGQJQFQKaHAAJEQFJJAGABaIQAQEJCADAGJJQFZCBDAAZCQEQHQKKFAJAGZAQ', 'GNADZGhBCCNCUCYCDDLDiDqDsDIEEQHIIIDIAIMIGCCYCAKZJQBQDQMQAQHaIAEAFALAJJKJCQGQHYIZEAFALAJAKJBQJaDQAILQEQFQIJAADAMAJABAKaLQEQFQIQAJHJGACAKYLZEQFQIQAQHJDAMAJABALAKJCQBYKYLYDSAYHYIYECFIDIBIKILICIGSJYIYMYAYHYDCBICAKYLILQBQIQJJMQHZAAJAIABALAKJCQBYKYLYDSAIHIIIJIMIGCCYCAKZLQBQMQJZAQHJJAMABALAKJCQCIGSJYHYMYAYIYDCBICAKYLILQBQIQAQHQJJMAAZIABALAKJCQBY', 'GNNBSCABMBQBRBlBgDjECGJGbGoGAAJYDALAGAIAMKHQHIERFYBYIYGYLYASDIDQJJKICIFBEBHYMYAQDQKICIFIEBBYFSCYJYKYDBLYGAGIIIFILIBIESCYCQJZKYDYGBABMIHIEQCQKYDYGYABIIFILIBICICQEBHYBQEQLaAQDQGQJKKALABACAEAHAMaFQDQIQAQGQLKBACAHIEQCYBYDYFBIYARGIFIDIBICICQEBHYBQEQLaDAFAGAAAIAMKHQHIERCYBYIYAYGRFIABIIBICIEBHYHAMaGQFQIQAQDQLKBACAHIEQCYBYDYAYFYGBIIARDIBICIEBHYBQ',
  'GMJBNCKBbBlBcCEDLEBGYGgGpGAYCYHYFBIYGYLYDQDIJIKILIASCYHYJYFYDCEYBRDIFIHICIJIACKYLYEYFRDYBCFIEIKIARCYHYDYECFYBSEIFBGIKILJAQAICSHYDYJYFYEYBBFAJJAACAKILZKQJQJIDRHICBAYDYJYJAKAKYBREILJAQDQJZFQFIGYHICIJIACDYDAKYLZFREYBCFIJIKIDIARCYDBJYKYFYBSEIFBGIKILJAQAICSDYHYJYFYEYBBFAJJAACAKILZKQJQJIAICIDRHYABJYJAKAKYBREILJCQDQJZFQFIAIGYEABAHIJIDCCYKYLYFRAI', 'GMjDCGFBQCVCZCaCADRDbDLEIGAQDQEQCQIYGAJQKQLJIADAFAAaGQJQKQLQIKHQBZIALAGAKAJAAKDQFQHQLZIQBKLAHADAFAAaJQKQIQHKLQBaCAHALJDAFAAAJaGQKQIQLQHQBJFALIGBAIJIDRFYGYGAIZKAJJAQIQGQGIFIFQBZDBAYHAIYGRLYCQLAGAKAJAAKIQDQFQIILZHQBKLAFAGAIAAaJQIJFQGRLQBaCAGAHALJDAFAAAJaGQIQKQLQHQBJFALIGBAIJIDRFYGYGAAAJAIZKQAJGQGIFIFQBZDBHAIYJYGRLYCQHIBILAAAGAKAIKJQDQFQLZAA', 'GMCBRCQBiBFCaDoDrDAEDESGjGCQFJDAFYHIGJBQKZFALAHAGJDQGYHYLYESFIJIAIIIKICCBYDYHYKYFYEAGIHQLQFQFZARAIIICIKIBCDYDAHZGZEQLYARKJFALAGAHJLIDIBSCYFYHYIYJYKYECAIGIGQLQKQFKBADAKIDIBICTIYDBKYAAGIHIBQFaKALAHAGZAQAYESJIDIIIKIFICDBYHYLYAAGIHQLQFQKaAADRJYECGIGAHKLQGaDQERJIIICIKIBCFYGYDYLYHYHALKDQFJGADZHZHQFQGJDADIBSCYIYJYEBFJGQKYAYFAGJAQAYFYGYERJIIIKJDCAY', 'GNKDoGYBNCQDZDbDhDrDAEDGSGjGAIIIBICQKYDAGIFIEQJQKZAALAFAEJFIJQLZFAEAEIJICBBYGYHYIYMYDSAIEIFIKILICBJYGYGAMAHKBAIaHQBJJQCQGYEYDAHIIJJQCQKYAYLYFYDBMIGQEZFQLJCAGYMYDRAIKICALIEAGAJAIZHZDQFIGJJAIAHZBQMQGQGIJICREYFYKYAYLYDCBIGIHIMIIICRJYFYFQLQAQKJEAAaLAFAFIJICBGYHYBYIYMYDSFIKIEILIAICBJYGYGAMABAHKIQJQGZFZDAFIHIIJJQGQAQCQEQKaLAFAAJEQFZLQKKCAFAEAGAMZAQ',
  'GNLDoGYBNCQDZDbDhDrDBEDGSGjGIIBICQJYKYDAGIFIEQJQKZAALAFAEJFIJQLZFAEAEIJICBBYGYHYIYMYDSAIEIFIKILICBJYGYGAMAHKBAIaHQBJJQCQGYEYDAHIIJJQCQKYAYLYFYDBMIGQEZFQLJCAGYMYDRAIKICALIEAGAJAIZHZDQFIGJJAIAHZBQMQGQGIJICREYFYKYAYLYDCBIGIHIMIIICRJYFYFQLQAQKJEAAaLAFAFIJICBGYHYBYIYMYDSFIKIEILIAICBJYGYGAMABAHKIQJQGZFZDAFIHIIJJQGQAQCQEQKaLAFAAJEQFZLQKKCAFAEAGAMZAQ', 'GNRBdCLBNBbBcBiBACECKCrDgEBGAADABAHQKIMYCAEAGILIHRAYJYEYEAGBLIJREYGYGALACQKZBQDQFQIQMKAAEAGAHAJAKZLQCQCYIYFCBYDSFIBBLIKICQGQHQAQMYFADBLIKIJQEQMZIACIGREIJBKYCQIQMJAAHAJAGYKYCYLYDRFRMIEACBLYDYFRBIIICICALAEQKJGQHQAQJQMaBACAFAIADAKJLQEQEIJIAIHBGYASJYEYEALACQKZDQFQBQIQMKEAHAGAJAAAKZLQCQCYIYBYFCDILICRERMYEAFADBLICIAIGIKIHSJYEYABGIERJIHCEYGYKYCYIRAI', 'GNFCICLBbBgBMCZCADJDRDqDkECGAQDYCRJIGAIIMIHIBAEAKZCQDQJQIQHQMZAAFAJJCADAKJEQBQGQIYMYCCIIGAJYKYLYASFICICQHIMJBAEAGBDYJYKYLYAYFSCIHIIIMIGIDCEIBRDYGYHYIYCYMYFCAIJILIEIGRHYKIBQDQMZCACYFYACJILIKIGQIYCSHIIIDIMIBCGYEYCYJYKYLYASFIHIIIDIMIBIGCEYBREQGQMZBAHAIAJALAKJCQCYDSBICCDYDAKZLQJQIQHQMJGAEAKYBRHYIYMYFYACJILIBIDICRHYIYKIEQGQMYBCJYLYASFIBIHIIICBDYJYBQ', 'GLIGrGFBQBdBLDUDgECGiGRHBYEQGQCQIZFACYAIFIIIDBKYGYECBIGIJIHIKIDTAYIYFYKYCYCQFQIKAAKADAHABaJQCQFQGQEQIQAKKAFaCACIHIHAGaJABKGQGYBYJZERCIHIFIFQJIKQAaIACAEABIGIDQFYHAJAGABZEQGJJIFIFQJaCQHQIQAKKAJADABYFAGZHRFJFAGAHABJDQBYGYHYEYCRFIFQJKKQAaIAJAFAFYCBEIHIGIGQKQAQIaJAAKKAGAGYHYEYCRFIFQAQJQIKKAAaFAFYCBEIHIGIGQAQKQIaJAFAFIHAEYCRHIAIKIDCAYBYEYEABJGYGQAQ',
  'GNABTCDBQBaBcBdBMDUDqDsDgEBFHAIAFAGAKAJJBQCQEQMQHaIAIYGBFICIBBCQJYKYFRCIBIMIDIARHYHQIaBAMAKAKYBRGYCBFBJIEILIARDYKYEAJYFRCRGIBBEIKIDIABLYJYEQBQKQMQIKHAHIABDYMYBYECJIKILIDRARHYIYEACYFBJIKILIDIARMYBYCYCAERIIBAEALAJZKQFQGQIICALIBRCYEYGYFBLIERCICQHJMAAADAJZKZLQFQGQIQHJBBEYCRHYIYCAFBGICIEIEAKABQJJAQDQMQHaIAIYCBEIBIMIACDYDAJZKQBQMQIQHJAAAIDCMYBYEYCRIIBA', 'GNFBSCCBVBYBZBbBIDQDoDqDkEDFHAIAEAFAJAKZBQCQGQMQHKIAIIEBFYCYBBCQJIKIFRCYBYMYDYARHIHQIKBAMAJAJIBREICBFBKYGYLYARDIJIGAKIFRCREYBBGYJYDYABLIJQKIGQBQMQIaHAHYABDIMIBIGCJYKYLYDRARHIIIGACIFBJYKYLYDYARMIBICICAGRIYBAGALAKJJQFQEQIYCALYBRCIGIEIFBLYGRCYCQHZMAAADAKJJJLQEQFQIQHZBBGICRHIIICAFBEYCYGYGAJABQKZAQDQMQHKIAIICBGYBYMYACDIDAKJJQBQMQIQHZAAAYDCMIBIGICRIYBA', 'GLDBdCIBcBJCEDMESEgEAGqGHQAQAYFYGYBCDIHIKIIICSEYAYGYIAKZDQBQFIJIEACAKYHQBYDCHIIICIKIESAYAACBEAIYKYHYDSBIGICIHAKJEQAQAIECIYCRGYKZHQBYDCHICIIIKIESAYAAEAGYCBKYHYDSBICIGIHAKJEQAQAIKYECIYHYDYBRCIDCHIIIESAYGYDYCYJYFYBCHIDRGIAIEBKJIQIYDYHYKYBSCIFIGIDBJIEAIAIIESAYDYGYCYJYFYBCHIIIDSAIEBDYIYHYBSCICABAGIAIKIIQEIDCIYKYARBQCQGYCYBCHIAIKIIIDSEYGYCYIAKZHQBQBY', 'GLQDDGABNCYCLDpDBESEkEhGIIAIAQCQHQBaDAFAIAJAGKKQAQHQJYDRFIBICAEAKYGYDQIIBQFaIADAJAGAKKAQAYGZJQKYDQIQFKBAHAGAIYDBKIAIAAKaDRIIJQGJHQBQFaIADAGAJAKKAQAYHQGZKYDQIQFKBAGAHAIYDBKIAIAADQKaJQIQFQBJGAFaIAJAKKAQEQCQHQFQGQBaDBIAFJHAAAJIKZJQDQFQIQBKCAEAGAHAFZKYJYJAKKAQEQCQFQHQGQBaIAJAFKAAKZFQJQIQBKGAGYBYDAHAAAJIKAFaJQDQAJBIGIHQGQBaDAIAAAJAFKKQHQGQJYDRIIBIBQ',
  'GLYDrGgBACVCBDjDEESEhEJGIIAIAACAJABaEQGQIQHQFKKAAAHYEBGIBICQDQJAKYFYEAIIBAGaIQEQHQFQKKAAAYFZHAKYEAIAGKBQIYERJQFQKIAIAQKaEBHAFJIIJABAGaIQEQFQHQKKAAAYJAFZKYEAIAGKBQFQIYERJQKIAIAQEAKaHAIAGABJFQGaIQHQKKAADACAJAGAFABaERHIIQGJJQAQKZHAEAGAIABKCQDQFQJQGZKYHYHQKKAADACAGAJAFABaIQHQGKAQKZGAHAIABKFQFYBYEQHIJQAQKQGaHAEAAJBIFIJAFABaEQIQAQHQGKKAHYEBIIBIJAFABA', 'GMDDrGCBFCSCTCUCLDYDgDIEoGDRAIHICIEBKAIAJALABaDQEQFQCQAZGQHACJFBGBBJLJJRIRKRAZAQHbCADAEAFAGALAIKJABZIQLQEQFQHJAAKAJALZIABKLQJQKQAQHZFAIAJKLABaDQJQIQFQGQHKAACQEAKALAIaJAJYGRCYDCGIJIJQIKLQEQKQAQHaEAFAIAIYCRDYGCCIIIEQJABKLQJaIQFQHJAAKAJALABaIQCYFQGSDICCFIEIEQHQAJKAJALABAIaEQJJKQAZHAJAEAIKBQLQKQAQHZJAAJKALABAIaEQAQJQHJKAAZEAIKBQLQAQKQHZJAEAEYFYFALJAQ', 'GNJBNCIBKBTBUCADCDEDLDgEiEYGBRFQJIEAJQIQHJGJAAMICQAYDYEYGYHYIYJYBCFILIKICRMYJQIQHQGJDAEAMAJaIQJIMJARDYEYEQGZHAMAIAJJEQEIAICBKYERAICIDRMZHQGJMAAACAJZIQHQGQMJCACYAYGYHYMYBYFCIIJIAQGYLIEIKIDRAYHYJYECJIKIDIARCRMYEAHICIACDYCRHYEQMIAADBCYJYIYKYLYFSBIEIGIHIMIAIAQMZDAJYIYEQGIGAHAHIIAJJAQDQMQGaHAHYEBIIJIAIDICBKYARIYEQHIGIMICBDYIYIQMQGQHZEAEYBYFCJILIAIKIDRMYAB', 'GLDDrGhBiBCCYCQDZDAEMFjGAIEIGIHICAIIFCCYDYDABaKQHQEQHJDICIFRIYAZJAHAKABKCQDQFQGQIQIIFCAYCYCADYEAGIDABaKQGQEQHQJQAKEAIADADICICAGZDQDICIGIFRIYCBGBDZERCIIIFBDYGRIRCZAZEAJAHAGKIQCQAYCIEAIIDIDBIZGZGAKABKIQGZCSEQAIDAGIGACAIABaKQEQHQJQAJDJGBCBCYIIFRGYDYDQGJCACYDYDAEAIAHaEQGQAZJQGJEAGAJAHKEQIQDQDICICQAZDADIAICIFBIYCRARDZGZEAJAHAKABKCQIQAQAYCCDQGYEAAJIABaKQAQ',
  'GNEDkEABBBLBVBKCMCbCCDhDpDQEKYLYGREYIBBYFRHIIIEIGBBYIREIGIMICRDYJYGAMABALJKQBYCQDQGRJYAZEAHAFAIALJGQKICQDQMIJQAZMABAGAKICIDRBYGYIYFYHREIFCIIGIBIDBCYBQKYGQMQAJJADACAKYMYGBLZHQEQIQFQAJGABICIDRMYGYAYFYEYHCIIBILIGSAYFYEYHYICBILIESFIGBEYFSGIMIDBCYEAEYFYFAGRMIEBFYGYBYLYISHIAIMIGCBYLYIYHSAIMIGIEIFBBYGRAZMAHAIALJGQEIFIKICQDQJQAZEAFABAGAKICIDRBYFSEYEQAJJABACAKYGQEIBI', 'HSQBmBRBaBgBhBECSDVDbDdDzD1DFEjGqGwGAHPIDQJYKYBARIABCYFBDYPYMALJQJDQEQCQFQHZJAFIDBPYMYQYLYBROIFIDICIEBPYQYFROYBBLIMIFIPIQIERCYDYJQHJCADAEAOZFAQYLZMQBQFIKIGSRIDBCIARDYRYGCFYKYBAMALJFQOJCQQIEQAQHZJACIAIEBPYQYFYLYMYBROIFBPIQIERAYCYFYOYBBLIMIPIQICRFYJQHJAAEAFACAQZLZMQPJCIFRAIEBFYCYPZMALJQJCQAQFQEQHZJAAICBPYMYQYLYBROIAICIEIFBPYQYAROYBBLIMIAIPIQIFREYCYJQHJCAEAFAOZAAQYLZMQAI', 'GNFCJDLBSBYBbBECQDhDoDqDcFBGBYDAIAMYCAFAKAKYFRJIEQIYDQBIDIHIIIECIYJYKYFYFAJJDQCQKQIQMIEAHYFAHQEQMYCADAIJHQFYDYCRMICAEAFYDYIAHJFQEQMYCAIAHAJAKJDRHYIYCRBIMIEAFADYJYKYCRHIIIFIDBFAHYJYKYCYLYASGIBIIIFIMIEIEQMZBADAHYCAIALAKKCQFQJQHQDQEQIaFACALAKAJKHQHIDREYCYFRIIIQMQBaLAKAJAHJCQFQKZLQBKMAIAKACAFAHZJQLQIJKACAFAHAJZKYLQIQBQMJKABaIABILAJJHQCQFQBQIaLAIIJAHJCQFQBQIQKQMZLABJ', 'GLqDBHNBTBdBACUCEDiDsDYFDYGAIIDQBQHaCAEAGAIAJAAJDQDIKIFSBYGYCYCQEBIIEQGQHKBAFAGADAKAAbJQJZIRDJGRHYEADAGAIAIYDRERHIGAIADYERCIIIGRHYCAIADAEAJJGQAIFQIYIADAGAJYEQCRIIGAJAAJKQBQHaGAIACADAJAJIGRIZCADAJAEAAIEYGQJYCSDIJAGAAYCQDRJIJADACAAIGQDZJRIJIQHLBADAFAJaEAGAAYCQEIGIDSBIFBKYAYDYGYCYERIRHRBJJBDBDYGYGAHYIYEBCIIQHQIYCYERBQEAJKGAHYCAAJIQHQGQJaBACAEAAAIJHQAZCQEQBQJKGAAA',
  'HRLD0DVBaBrBuBCCOCjDlDpDsDAETEQFEGwGCAKYDQGQPZHAJAFABIIIEAQJKQOQMQPZAANAEAJYHQAJLYPJMAOAKAQZLQIQIYFYHRCINIEBJYFAIIDIGREYNYFBIAJIDALALIDRBYHQIYJIIADALABAQKKQOQMQPZAZCAFAJAIJNQAQPJMAOAKAQaBQDQLQNQJZIAHABINIDBQJKQOQMQPZAAJAIZCQFQAJPJMAOAKAQZDRBYHQCQNYFRJJFAIANADALABAQKKQOQMQPZIAJZAQIJPJMAOAKAQaBQDQLQNQJQAZCAFAHABINIDBLYQJKQOQMQPZIZCAFAJJAQIQPJMAOAKAQZLQDQNQAQAIDBJYHANYBALJNQAQ', 'GLgBFCLBMBICDDcDhEJFAGjGCQKQGQBQDQFQJKEAIAHAKZAAGQBQFICAHIAIESIYCYCAFYBAGAHAGZDRDIGIHICSIIECAYAQCYEQGYKICQIQJaBADAFAHADYBSFIHIIIEIJIADCYCBGZGQEQIQJQFaHABAKIGICRARJYHYBBDIIIEIAICBGYGAKaDQBQIQHQFKJAAAEAGICQAYJIAACACIGYAREQJYJQFbBADAHAFIIAKKGQGIARCYEYIYDYBRHIJICBABGYKYBQHQFKJAEAGAIAGJARAICTEYIYHYJYFYBCDIDQBQGIHQFQJKIAAAAICICAERIYACGYHYKYDYDBGJGQBQDQFIHQAQAIIIECCYHYDYBY', 'GLUBZBdCMDQDrDAEKFCGiGoGBYCAFIJYAQKIBQEQGQIZDADYCBAIHIEIGIBCJYBQKYFYFAKKJQEQGQIQDaHAFAEJJAKaAQEQFQHQDKCQIABAGAJAFaEAKJFQEaHQDQEIIKBAGAJAEAFAFIKZHQJJBSGYGQIaCAAADAJAHAKKBQFQEQGQGIJZBBDQFYKYAQCQIKJADaHADIEJFAKZEQFKGQDQJQIaCAAAHAFAEAKKGQFZGYEYAYFIKYCSHIDIIIJIBBGBEZEQFQFZDRGJBRGYIYJYHYCCAIAQCQHQIKJABAGAFADZKAEKDQFQBQGQJQIaCAAAEIDJFQHAKZAZEBDJDAFLKQKIBRGYAYAAKAFaDQFIKJAQBI', 'GNQDkDABBBKBiBTCYCCDZDcDEFrGFYGABZKQLQIJGAJIFAMZKQBJJQGQIZLABAJJERAIHAMYGRAIAADQEAGAMIHQCQIZAAGAJZBQLQAJIJCADAFAHAJYGQIQAZLABAKAMJJQJYERFIDSCIHBDYFYEBJIDQHQJAMZKQBQLQAJIAEAGAJIFQCQIZGAJABZKAMJFQJYGQAZLAKABJFIDIGQHRCYEYAQIJCAEAHAJADAFAMaBQGQJIEQKQLQIJAAJAFAGAMIHQCQAZIZLAKABAMJDQDIESCICQAQIZJAAJCACYECDYDAMZBQFQKQLQJJIJCAEAHAMYGQAQAYIQGAJZLAKABAMKDQFQAQEQHQCQJZIAEICIGAHBDYFYBZ',
  'HOzDKGSBCDEDiDqDTEAFNFYFkGsGwGAJEINJKQIQDZBACAHAFALZJQEQBJDJIAFZCQHQDQBZEADKCAHAFKIQBZHAFALAGAGIMZJQFJHQBJIALZGAMANAAaJQGJLJIQBZHAFZGAJAAKNQMQLQFQHQBJIAFaLAMANAAaJQLJFJKAAZNQMQFQLZJANJAJKQIQBZHAGZJAMJFQLQGQGYHQEZDAJALJGQHQEQBJIAKAAZFQGQLZJQEJHALAGAFAAJKQLZHQEZJAMAFKAANZFQMQGKAAMZGQJQEJHALJKANZFZGQMJAQLQHQEZJALJAAMZGAFJNJKQIQBZEAHAAAAILZJQDQEJHAAALAMAGaJQAJHQEZDAAAJAGKMQLQCQHQAa', 'GNABdCNBkBDCMCQCBDEDJDoDREhGEQKJGQAQHYIZCABAFADAKJMQEQLQJQIQHJAAGAHYIYMYEQFYCYBBDICSFIECCYDYKYBSFIEICCDYERCIHIIIAIGBLYDYEYCSFYBCCIFRIIKIEQJIAQHYIAJAEAJIDBLIMIGSAYAADYGAJYMYEQJQIQIYFBCYHIDAJYEAKYBSFICCEIJILIDSAIGBDYASHYIYCYEBJYLIAIDIGRHYIYCYEYFYBCKILIAIMIGQJYCSHIIIJIGCDYCYAYLYMYKYBSFIEIIIJICBAYLYERIIIAEAJALAKAKYERMIDQGQHYIYECBYFSEIIIBBHIGADAKIMYKQBQLQJQIQIYBBLIAICRIYJYBYEYFCLIAI', 'GNlBACBBYBNCRCaCEDjDoDrDTEKGGAHZEAAAKIJJDQBQFQCQHZMAGALAIAJAJIGRKYAQEQMIGCFIDIBRCYDCFYGSDICIHIBCFYGYDSCIGBDYJYKYAYERLICIGIDCFIBSDYFBHYGAIYAAJYKIJQIQGQIYCRLYMYECAIAQCIEQIIMIGAIAJAJIFRDIKYCQIIGQHIBCFYDSGYIYLYCCAYERCIACIIJIKIDIGRLYAYCYEBJIKIDIGIFIBSHYLYAYMYEAIIDCIYJYKYESCIDIAILIMIHIBCFYGYIYJYDRAILIGBJYJQGQIQLQHQHIGBMYCAEAKIJIGSBIFCGYJYBRHYKYEQCQMIHABALAIAJAJIBRLYAYDBIIJIBIGIFSLYAY', 'GLCDoGTBZBMCNCSCEDKDjEAFDYJIBICQDQKQAZHZEAFAJABJGQIQHQAJKAGYBYCYJYFSEIAIHIIIKIDDGYBYCYJYFYESAIHIIIKIDIGCCYDSKYAYHYIYECFIJIDICIGSKYDCJYDQFYESHIIIDIKIGCCYJYDRHYIYECFIDIDQJICIGSKYAYHYIYEYEQAJFBDIERHIIIKIGCBYCYJYEYDYFRHIIIECBIJICIGSKYEYHYIYFBDIJIERHYHAIAIYJADYFRAQHJIAAZFBAIDIJQAQIQHZFADABJEQHIIIKIGCCYEYBYJYDYFSAIHIIIKIECCIGSEYKYAYHYIYFCDIJICIGIESKYCCJYDYFSHIIICIKIECGYBYDQJYAQIQIYFBDIAQ',
  'HPIClERBVBWBcCgCDDyDFEAGKGSG0GhHCAOAIANaBQDQEQJQHJKJAACAGAMYFAIINYIQFQOQMQCQLQKQHbJADAEABAIJFQMINIGQAQHYKALAMAFAOANAIbBQDQEQJQKJHJAACAGAIYMYFANINQFQOQMQLQHQKZJADAEABALYFBNJIJGQOIGIATCYHYKYLYMYFYDYDBEZJRDJEBEIFIHIKICILIMIADGYGAIZNZBQJQDQEQKJHAOYFRLILAFAMAOANAIKGQAQNYFQMICQHZKZDAEAJABAIJFQNQOQMQLQKQHKAACAGAMYFANYIZBQJQDQEQHJKALAFAMAOAIAIZBZJRDREIFIMIOICSAIGCCYARCQGQKZHZEAEYDCFIMIOIAIGICCIYAQ', 'GLqDDGMBSBACLCRCiDoDBEcFCIERJYBYCADAKAAJIJEQGQJQBZFAHAIAAZKQFIBIDIJIECGYAYHYIYKYCTFIBIDIJIEIGCAYHYIYKYCYFSDICCKIAIHIIIGSEYJYCYDYFCKICSJICAEIGCHYIYCYKYFSDIJICBHIIIGSEYCYCAJYDYFCKIAIHIIIGIESCYEAGCAZHYIYKYFSBIDIJIGICIEBHYIYGSBYJYDYFCKIGIHIIIERCYJYGBIIIQHQHIJQCIEBAAIZHQAJERAYCYJAAAHAHYGRIIEQCQBZGCKYFSDIGIBIJICIECAYHYIYKYGSDYFCGIKIAIHIIIESCYJYDYFYGCKIDSJICIECHYIYDYKYGSFIBICAJIAAHAHIERCYAA', 'GNABdBKBNBTBjBMCEDQDsDBGoGYHEAFAGQJYBQDQHQKJCACYEYEAFBIIMIASCYEYIYFYFAHYDABAIJJILIAQCREYFYFQHYKZDADYBCGIDSHIIIFIKIEIEQKZCAAAHALYJYGQIIFIEICIABMYFRIYGAIADAFAJALKMQAQCQEQIaEAHQKJIAAACAMALaGQJQDQFQHQHIFBMIARCYEYFYHYBQKIFAHYDBMIAICREYABMYDRHIFQKYBAHIFIAIEICBMYFRHYGAHADAFAJALKMQAQCQEQIQKZHAIKAACAEAMALaGQBQJQDQFQIQHQKKAACAEAIaAQDAFAJAKYBAGALKMQIQCQEQKZHADAFAIKMALaGQBQHIFAJQIQDQDYBYBQGBIIJIDRBY', 'HOLDsHoBCDTDYDNEbEdEEGIGQGgGpHDZJZGAEJHAMJFQLQKQDQJZAADKKALAFAMZHQEZGQAJDAEAHAMJFQLQKQEaDQJJEAKALAFAMZHQDQKJEQJZAZGADJHAMJFQLQEQKZHALJEQKQJQAaHADZIAMJFJEQLZDQHQAKJAKALAEAFZMZIQGQAJHADAEKFAMZEQDQHQAZGAIAEJMJFQLQKQJQAaHADALJFAMZEZIQDJHQAKJAKAFALZHQKJFALAMAEaHQDZGQAJJJFAKZDAHAEKMQLQKQFQJZAZGAIAEJHQDQAQJJFAAaDAKJAQFQJZDAKAHAEZIQGQDJJJFAKZHALJAQKQFQJZDZGAIAEJMJAQLZHQFKKALAAAMZEZIQGQDJFAHAAKMAEaAQ',
  'HSuBACLBMBSBYBNCOCRCDDFDlDoDwDyD0DBEiHCQDQJQKZGAHALAAAPIOINIRIMIFRBRQYEBIIBIFCMYNYIRERQIFBBYEYEQQQKZJACADALaDQGQHQJJCACIKIQIFIBBEYFSKYQYCYCQKJDALIQAIBMINIERBRQYIBFIBIECMYNYFRIRQIEBBYIYFCOYPYRYAYHSGIACLICQRIFRCYDYAYLYGYHCPIOINIRIFIMIBRERQYCBIIEIBBEQMYNYIRCRQIBBEYCYCQQQKZJZGAHALJAQDQJQKJQACACIEIBRQYJYKYABDICIIBMINIBRQQKZJACAFAMIEQQQKQJZIBFYCRAYCADBCIFIAQIRJJKAQAEAMYFQAQJQKJQABBMYNYIRAYCYDRJIKIQIBBEYAY', 'HPBDgGbBcBDDdDlDoDLEtEFFYGqGwGIHNJHQMZCQDQFZKQEJAJOALABAMAHANZCQDQGZKQEQAJIAFAGACADANJHQMQBQGaFQLJGABAMAHANZCQDQFQBJGQLZIQAZEAKAFJCADANJHQMQGQBZCADAMJGQBQLQOQAaEaKAFAJANJHJGQMZCQDQFZKQEKAKOALABAMAGAHZNZJQKQEQAJIAFACADAGKHANZGQHKMQBQLQFaIQAZEAKAJAGJHQCQDQIQAQEZKAJAGAHJCQDQIQFKOQEaAAFAIACADAHZGQJQKQAJEKOALABAMANAHaGaJQKQAQEJFAAZKAJAGKHKNQMQBQLQOQFaEaKAEIJAGAHJCQDQIQAQEQFKOAAaIACADAHZGQJQKQFJEAIALJAQ', 'GNVBYCCBFBIBhBiBlBDDLDRETEjECYEAIYJYDYABLIKICREIBCFYCRKYLYHBMIGICIFIBSEYIYJYDYAYHBLIDRIIJIEIBCFYCYGYDRKICBFIBSEYCBKYLYHRAIIIJICIEIBCFYGYDYMYHRLIKIGBFIBSEYGBKYLYARIIJICIGIEIBCFYDYMYHYARLIKIDBFIBSEYDBKYCRGIDIEIBCFYMYCRLYABHICIMIFIBSEYDYGYIYJYABLIKIDREIBCFYDRKYLYHBCIMIDIFIBSEYGYIYJYAYHBLIKIGREIBCFYGRKYLYCBMIDIGIFIBSEYIYJYAYHYCBLIARIIJIEIBCFYGYDYARKIGBFIBSEYGBKYLYCRHIIIJIGIEIBCFYDYAYMYCRLIKIDBFIBSEYDBFBAY', 'GOCDqGBBNBaBICLCMCdCEDRDgDjDoDFALANABZMQGQAQHQAIJZDAIAMIGQKICQJYAAKAGABIKIEBLINIFSCYCAEYFABYGQKYKQAQAYJJEAHAKYGAMYIQDQJIAAGANJLQKQEQEICICQFBAYGAKILYLANaMABJNQLQLIFRKYGQAICACYEYEAKALAMZGQAQHQAIEIJYDAIABINIFQKYEQJZAAGAHAMJLQEQJQAZGAHAMALJEQKIFANYEQMZGQHQAJJAKAMAEANIFQMYEALZGQHQAQJJKAAZGAHALJEQMIFANYEQMQAQKQJZGAHAMJEANIFQAYEALZMQGQHQJJKAEALAMZGQHQJQKJEAAIEYFAJYHANYBYIQDQKIJAGAMJLQAQEQEICICQFBJYGAAILYLAMaAQ',
  'GNRDjDNBYBiBACdCEDJDZDoDLFBGBQLQIJAAJAEAEYKIDQFQMYHYCAGABIKIEQJQAQIZLAKAKIEIBYGQCQHIMIFAJYEABZKQLQIJAAEABAKZLQIQAJEAEYAYIYCYJIFQMYHYGCLIBIJIKIDIFREYDCBYJYKYLYGSCIAIHIIIDIEIMIFCBYJYKYDSAYIYCYJIFQMYHYGCLIDIBIKIFREYAYIYDCLYGSCIDIAIHIIIEIMIFCBYJYKYLYGYCSDIDQAJGAIALAKKBQJQEQFQIYAYMYHYDBCBKIBJJQEQFQIYAYGAKABJJJFQIQAZLAJABaKQJJLQAJIAEAFABYKZJQGQAIIIFABAKZJZCRDRAIGQHIIIEAMIFABAKAJZLQIQAZDADYCCGILIBIJIKIFSEYEAIZAQ', 'GNDDSGCBQBRBNCLDgDkDrDAEaEoGFAIAJIJAMKHQHIDREYLYIYJYFRAIGICIKIEBDBHYMYFQBILAHAMZJQHKDQLQBaFAIAHAJAMKDQLQBQEQIZHABJEQKYCYAYGYFBBIJILAMZJQBQHQIJLABZFRAIGICIKIEBDBBYHQMYJYFQIICRKIEIDBLYCYHAIYFAJAMKBQCQLQIaKQAZGAFAJIKICBHYHQCQKQAQAICBGYFAKYJAHJKQIKCQDQEQGaAACAIAKAHZJQFQAIKICRGJDAEAIYLAHZJZFQAQGJIAAZFAAIJJHJLQDQEQIZCBGYFAKYJAHJKQAQCQGQIKCADAEAAaKAHZJQFQIIKICRGYGACAKAHAHICRJYFQKYIQGJKAAKCALABAMaFQJQHQAQIQIYFBHIBI', 'GNABKCEBJBNBkBdCYDiDqDTEgEBGAQEAMYCYEYGCFIFAJJIQKQCQEQMJAADAHALAIZJZFQGQMIBAKYFYGREIFCJIKIBSCYFYEYMYGCJIKIBICSFYBBCAIJLQHQAQDQMZBAEAKYGREIBIFICBKYBRMJAADAHALAIZJZBQFIGQEQMICAHJLAIAJZKQHQCQFYEYMYGCBIHIKICSLIARDYLAHZFQMYEAFIHILIAIAAHZDQLQMYEYFBLICCHIIIJIDSAYCYHYLYFREILAHJCQMIAADBIYJYKYFRERMIAIDBCYARMYAAEBFBKIIIJICRHZDQLQMYEYFBLIAIDIHICCHYIYJYASLYFREILAHJDQMICADYHYLYFYFAHJEQLQMICIDBLYACHYKYBYGSEIFIAIMICICQMZFABA', 'GNsDaGQBRBiBVCDDIDMDjDKEgEAGAYFQGIIQGQMKHAHICBDYKYGYIYFBAIJIEILIDRCRHYMYFABIKQHQMZGAHKCAKABaFQIQHQGQMKCAKABADAIZHQBJDALYEYAYJYFRBIGIKQMZGABAHAIJKQBZFBAIJIEILIDRCRBYHAMYGYFAIIEBLIDICRKYEYHQGQIYFQMKBAEAKAIaLAAZJQFQGILIERHYHAEALAAAAIERJYFQLYGQHJLAIKCADAEAJaAQEQIQLQHZGAFAAILIEBIYJJCQDQKQHZGZFAAAJJIQAZFQAIGJHJKACADAIZERJYFQLYGQHJLAAAEAJAIKCQDQEQAaLQHZGAFAIILIEBJYJQEQLQHQHIEBGYFALYIAJJLQAKEQKQBQMaFAGAHAAAIAIYFRHIBI',
  'GOYDDGCBaBgBhBACTCcCdCMDRDUDqDCYKZMAIAJANJHQLICQBZMAKJLAHANZIQJQKQLJDBAIGQBYHBAIAQDQFAHQBIGAEANZAQHQLZKAIAJAAJNJEQFQCQGQLYHANAAZIQJQKQMQBJLALYDBCIFCEIGRFYCYDRLIFAGALQBZMAKAIAJAAJNQDQHQLICAEANZHQLQKZMQBJCALYHAAZIQJQMQKJCIFIGBEYDYHAAANJDQEQGQLQCQFQBaHAKALIDAMAIAJANJAQLQCQHQBIGAEAAZNZIQJQMQKQBJFAFIDCEIEAAANZLQAJEQEYDSFYFQBZCAKAMAIAJALJNJDQEQGQBYHAAAAYNAHQLZIQJQMQKQBKCAFAAADAGAEALZNQDIEIGRFYCYHQKZMAIAJANJHQAICQBZMAKJAA', 'HSQBkFLBMBNBRBqBrBmCADCDaDgDiDoEEGIGcGEIDICILANAMJFQLYQIAAFYMYNYHCGIMIOIFRNYNQAQQYHARaCQDQEQPQKKJKQAAARYHQPaKQJJCBHIRIAQPYCYCQJZHAKADAEARKCQPIAANANIFBMYOYGYCSMINIFIARLYNAPYRZDQEQKQJJHAHYJYKYEBDINJLJAAFAMZRIGBCYBYIYDSESJIKIHINILIGAMIPIQIABFYFQAQGYLYHQQYJZKANAEARYEYDCIIBICIMIGQOIFRGYMYRYHQPIAIGBFBOYCYBYESHIHQRIAQPYNYNQKQJJPIQJABGAFAFIGSAYAQPYQZJZKANAHANIPIFARYHYECBICIMIOIGRARFYPYHARIAIAAGBMYOYCYBYIYDSEIEQNQKQJJHALIQIFAGAMYRIAIAQ', 'GONBbCABJBQBdBMCEDSDZDsDBGgGoGGQIABAKYFQAQIJBADIMIEQCQCILYEBHYJYDQMYBQIZABFBGAKIKANKMQJQCQEQIZBADAKZFQAQHIBAKAJKMANaJQJIMJNIERCYKYBQHYAAFAMIKQDQDYBYGYFYARFAHIAAGAMAJANJKQJaMQFQGQHYAAFIGIBIDICIEBJYKYDRBYGYFYARHIHQLKBADAIACAEAJAKANaMQFQGQHYAAFIGIDIDAKJBQIIEAJQCQCYBYDYHYGAKIJICQEQIYLYAAFAKIJIBQHYGYFYFAKAAQJJGQHIBALIIIEACANAMaGQJQKQAQFQHJDADIBICIERIYIQLaHAHYABFIDIGBKYFQAQHIGAJYKAJAMKNQJaKQKYDRAYFBDIKIKAJKNAMaJQJIKQGQHYFADAKIGRAY', 'GNADsDIBdBjBFCYCLDTDbDpDJFCGLQHZIAJAEABYDQEIFQMIAICAGAKYBYEQJQIQHJLABABYEYKIGQCQAYMYFAJIEAKJBQLQHZIAEAKABJLQHQIZEAEIHIIICIJYFQMIAIGCLYBYJYKYDYFREIDCBIJIKILIGSAYCYHYIYDYEYMYFCBIJIKIDSHIIICIJYFQMIAIGCLYDYBYKYFREIHIIIDCLIGSAYCYDYHYIYEYMYFCBIJIKILIGICSDYDQIZGAHALABaKQJQEQFQHIIIMIAIDBCBBYKZJQEQFQHIIIGABAKZJZFQHQIJLABJKAJZBQLQIZHAFABJJJKQCQDQAYGQIYHYMYFBEILIGICIDRIYIQAQMZHAAKIAIIDBCYGYLYEYEABAJJKJCQDQGQIYAYEABAJAKJLQAQIJDADICCGYLYBY',
  'HThCzDABBBCBDBRBWBaBbBoBqBtBQCSDrDMFEGkGHAMIBIPIJRSYMBBIPIJILIIROQFQRYHAMASIOQGIABKINRCRDYEYGBOAIASYMQHQRIFAOAIAKIAROYFRRYHAMASIFQOIABKYIRFYSYMQHQRIGIEIDICBNBKYAROYGRRYHAMASIGQOIABIYFRGYSYMQHQRIEIDICINBKBIYAROYERRYHAMASIEQOIABIIKRNRCYDYOAEASYMQHQRIOAGBFBIIARDROYDARYHAMASIEQGIDIACIYAQFREYSYMQHQRIOICINBKBIYFYLYJYBYPYMRSIEILBFIARCROYCAGAEASYMBBIPIJIFILRDRCIACIIKRNROYCADANASaFAJABZPQJIFIERGRRYGAEAHAMAJIFIBAPZFQJQMQHQRIGAEASKDQCQOINAKBIYASCYDBLBBY', 'IVJBmBCBTBjBnBqBSCADGDODYDgDUEWEkE2EoFzG6GDHAYTIGQHQCQCYHCGCSYGQTYQYFRBIPIEIDRNYOYBBPIEIDIGIHSUYJYKYBBOIEBPYFBQISIHQNYEYOYFBPIDIERNIHBSYDRPYFRBRJIKIUIHBGYEYPYFYBROINIEBPYDBQYBRFIDIPIERNYOYFBDIPIEIGIHSUYJYKYFBOINIGBEYPYDYBBQISITIHRGYMINYOYFRJIKIUIGBNYOYDBBYFRDIOINILIARCYGQGYUYJYKYDBOINILILAMAMIAICRGYABMYMQLQLYNYOYDRJIKIUIAIGICBLYAQMYUYJYKYDBOINIAIHCSYTYQYFRBIPIEIARNYOYDRJIKIUIHBAYEYPYBYDROINIEBPYBYDYFBQIBRPIERNYOYFBDIPIEIAIHSUYJYKYFBDBPIBBSIHQNYEBAI', 'GNFBQCMBZBkBVCKDSDbDoDAEiECGFQAQHYIYCQGIMIKIBBDYIYCYEBLIIQHQJIDQBQKQMaGAGICBEYAYFBLIERCRGYCAFAHKEAIAJIDIBRKYCYEBIIIQHaAQEQFQGQMKCAKAHADAHYCRGYAAMYFALAJJIQCQHIBAIZJZLQAQFQGIMIKIBBDYCYJAIJCQDQBQHQKQMaFAGAAAEALAIJJQLYFRGIFAMIBAHYLYIAJJLQHKBQCAMYGYFAHILAJaIQHQFQGIMIBADAJYIZHQAREIKICBDIBRMYGYFAAIERKICIDBLYEYAYFRGIMIBBLYCRKYABEICILIBRMYGYFBEICILIDRKYAYCBEYFRGIMIBBDYLYEYCRAIEBLIDIBRMYGYFBCIAREIKIDBLYAYCYFRGIMIBBLYAYCYERKIABLIBRMYGYFBEICILIDRAY', 'GNADoDSBTBEDQDcDiDkDCEMEYErGFALAHZCRDQJQAJCAFALAHABAMaIQGQKQEQAJJACADAGZIAMKBQGZCRDQJQCAFJLAHAGABAMaIQKQEQAQFJJAEZKAIAMKBQGQHQEZCADAGJBAMaIQGJCQDRJQDAFZAAKAGAIAMKBQHQEQLQFZJACADAHJBAMaIQHJCQDRJQAZDAKAGAHAIAMKBQEQLQFQAZJACADAEJBAMaIQEJCQDRGZDAHAEAIAMKBQLQGZJQAJFAGALABAMaIQEQHQKQAJJACADAEZIAMKBQEZCRDQJQCAFJGALAEABAMaIQHQKQAQFJJACADAHZIAMKBQHZCRDQJQCAGJLAEAHABAMaIQKQAQFQGJJAAZKAIAMKBQHQEQAZCADAHJBAMaIQHJCQDRJQDAGZFAKAHAIAMKBQEQAQLQGZJACADAEJAQ',
  'HOADoGTBUBIDjDxDrEFFdFCGKGgGQHJQIQKJAJEALZCADAFAHAGJBQMQNQLQEQAZKZIAJAGJHQFQCQDQEKAQKZEAAKLANAFaHAGZJQIQEJAACADAHAMJFQNQLQKQAaEaIAEIJAGJBJFQMZHQCQDQEQAKKALANAMAFABZGZJQIQAJEACADAHAFKBAGaFQHQCQDQEQAZIAJAFJGKBQMQNQLQKQAaEACADAHAGAFZJQIQEJAKKALANAMAGaHQCQDQAQEZIAJAFJBJGQMQNQLQAaCADAHAMJGABZFZJQIQEJKJAALANAGAMZHQCQDQLJAQKZEZIAJAFJHQGKNQAQLZCADAGAHAFZJQIQEJCADAAKNAMABAFaHQGQAQCQDQEZIAAJGAHAFKBQMQNQLQKQEaCADAGAAZJAFJHQAQGQCQDQEKKALANAAaHAFZJQGJHAMJAQ', 'GLSCsDCBNBBCDCECbCYEcEoGEYCYABIIERCYAYFYHCJYDRBYGIHIFIAICIEBIYJYDYGSHIDCJIIIERCYAYFYDYHYGCJIDSBIFIAICIEBIYDYFSAIDCIIERCYDYAYFCIIDSCIEBDYIYFSAICIEIDCIYCSAYFCCIIIDSEYAYFYCCIIDIKIESAYDCIYCSFIDIAIECIYDSFYCCJYKYBYGSHICIFIDCJYCSHYGCBICIJIDSFYHYGYCCJIDIIIKIESAYFYHYDCJYCSGIDIHIFIAIECIYJYDSGYCCDIJIIIESAYFYHYGYCYDCJIIIJABAKJFSAIECFYIYKZBQJQJYDSCIGIHIAIEIFCIYJYDYCSGIDCJIIIFSEYAYHYDYGYCCJIDSHIAIEIFCIYDYJYCSGIHIAIDCJYCYKYBYGSHICCJIDSAYCYHYGCJICSAIDCCYAR', 'GPMBRCQBgBjBNCADCDEDIDKDSDkDsDaGBQEYLYMYNYFRAIKIKQHQIZAAAYFCMIOIEANYMQOQFQKQAQIJGJJALIBBDICRBYDCEYKYAQOYFQHJGQJJBACADAEANZMZOYARKILIEIDRGYHYJYIYFBAIAAMJNJCQOICIBSGYBAJYEBDICBNZMZAQOYAYFSHIFAIIEIDBKYLYABMJNJOICRKYLYERDIGIJIBBCYCANZMZOYAREIDRHYIYFBAIAAMJNJCQOICIBSGYBAHYJYIYEBDIKILICBNZMZAQOYAYFSEIEQIJDAAAHAGJBACAKYOYAYDSEYFBDIAIKICQOIBQGZHQIZEAAAFADAMJNJOICRKYLYAYERHIGIIIJIBBCYCANZMZDQOYDYFSHIFAIIABEYDBMJNJCQOICIBSGYJYAYLYAQIZEAHADAFAKJOIARGILIBBCYAY', 'GOBDrGDBEBFBTBACJCKCUDcDgDpDiGGQAYMYBYNIIQCYFBJYKYERDIFICIAIGAIANYERJICQAIHALANZKQJQFQAIJYEBBIIAKILIMINIGSHYIYAYCYFYDYDQAJCAEAFAJILILANAMABZKQMKNQLQLYFRCIIIHIGCLYIQNYFQCQAZDAEAJAMAKABJNQLQGQHQAZIAFYCRIIFCCYCAKZMQJQJYERDIIIFIFQAJCAGAHAJaIQKAMZEQDQAJCAFAKAMALKNABaLQLIBINJJQMZKQCQFQAZDAEAIAKIMINIJIGSHYAYCYFYIYDYEBKIKAMKFQIQAICAFYIYKYMYERDIAIIAKAMYEYDRAIKIIICICQFBMYFQIQAaIAKADAEAMKCQFQAQIQKaEAIAMYDQEIIIAIKIFBCYAQMYIQKIFICBAYMYIYDYDAERKIEAIAMKJANZMQJKNABALaMQJQNJAQ',
  'GOQBFCCBDBjBkBECADIDRDZDbGgGoGDQFIEIMINIARJYCQHJIAJAKYKAAALZBQGQHJCAKIAAMYNYEYGRDICICQHZBADAFAGAJIAALYEANKMQLQAQKQJQIQHZCACYECGYFYBRDIFCGIESCIHIIIABJIKYKALAMANaEQGQJIKILIARHYIYCYFYDYBBGIEIMINIARLYJQKJLAJaKQKYDRFICICQHJIALAJAJIABKYMYNYCSDYLIFRHIIIABJYKYDYFYECGYBSEIEABAGBCIFRDIJIKIARIYHYGACALYDAFANKMQAQKQJQLQIQHZDADYFCCYGRFICCJILIAAKYJQLQCQDQHJIAAADYLYCQHQIJAADALAKAJZCQJIKILIASDYHYIYLYCCJIKIAILIDSHYLYCQIIHALAAADAJZKQAICQLIDAJAKZAQCQLQIQHJDAHYIYLYCCGYBYESFICIGBAI', 'GNVBADFBKBgBjBRCIDpDLEkECGaGEBIYFYKYARMICQDQHILIBIEBGYDYDQHQBQFAIIGQEQLaCAJAMAKAIJDQFQHQMZCRJIBILIMIEIGCDYFYHYIYKYAYAAIJKQHJEQBYGQLYJYCBAIHIMIEIFBKYHQIYAQMQCQJQLKBABYLYCAEAMYABHIIIKIFRGIDCFYKYHYAQCQLIBIDAFBKYHYIZAQAYCSJIEIMIGIFIDRBYDAFAGAMaAACAIJHQERJYCBAIEIHAIZAQEQMKFQGQBIDAFYGYJYCYMYACEIEAHIIJKIFRDRBYDALYAAEAHIKIGRDIFCGYKYHYIYERMYCQCIJIDIFIGBKYHYIYEYCRMJAQDQFQLIBIBQLaAAJAMACAEAIJHQDQEYCYMYASJIAABIFALIGAKAHZIZCQCIEIDIIIHIKIGSFYBYFAGAHYIYEQMYAYCBEIIIHIGQFQLYJYCBEBIIIAHKDQKQMQBQBI', 'GOBCVCABFBQBZBaBjBkBECCDbDpDKEBQDQMYGQLYJQKJNALAGAHAMJFQFYASLYNYHCLIAAMYIYIAJRMIAQLYHQHIICLIAAMYJYHSDYBBHIJIMIAQLYISDYDAJBLIAAMYIQIIMIAQLYDSLINIACGYMYDQLQNQKZBAJALJDADYIYHYLYBSJIKINIDCGIARCIEBFBMYGQDRCIEIFBAYDYDQEQLYCQKZNAHBIIGIMIAQFQKYCALADIERFIABMYDQLQCQKIAAEYLYGBDILQMIEQAQKYCAGYDBLIMIFSGYDYHYIBLIMIDRGIAIECFYDYMYGQCQKIEAFBDYMYAQLQHQIQNQKJCACYKYNYICHIHALAMJAQCQGQKYNQIYHBNICIABGAMZLQNQHQIQKJAAGYNYHRIICIAIGCFIDBMYMALaHQNQAQCQKYIACIAIFIFAGRKYAAGANALJMQDQEQKYFANYARFIGIEIDBNYGRFYIYCBHBLIGQFRIYCYHBAI', 'GOJGpGIBVBaBADEDMDRDYDgDsDTEjGBYGZHAAJIAEALYNYDRMIEIIQJICQAaEAMAJKEQAICAKAKINZCQAYEAJYJQKKEQAICANAJaLABJJQNQCQAYEAKaLALINJEQAICAKYKQCQAYEALaEQMQAKCAIALYEYMYDBBINIERLILAEAKAJABaNQDQMQLKIQAZHQGJFJCAIYLZHQGQFJAAGaHAHYDBLIEAMIJJKQIQCQAYFYDALIEIGQHZFQAJCAGYEYLYDQAIHAEAIJGQCQEYHYAYDALIIAGJCQEQFaIAGAJAKJCQEQFQIZAQHKIAFACAGYLYDQHIIJFACAAYEYJYKYMYDRLILADAMAKKJQJIEICRAYGYLYDAMYKAJJMQLQAJGICBEYMYJYKYDRAIGAMAJZKQLQAQGKIQFJCACIECJYMYAYDAKILYLQAQIQGZDAAIGIIIMIERCYFYHYDAIIMAAZIQGQHQFJMAGZIAKALJJJEQGYIZKALAJJAQ',
  'GLFCQCCBdBhBUCDDiDAEqGRHDQAQFAGICIHIIIBBEYEAJZHQKQCQIQGaAADAFADYASGIFICIIIBIECKYDYCRFYACCIDIHIKIESBYGYIYFYDCCYARDICCJIKICQEIBSGYIYFYCYDYABDQKIFRGKIAIIBCEYFYJYHYKYASDICIGIIIFBEIIQGZDAAAHIJIBSFYECKYCRDYABCIDSEQIIEIFIBCJYHYKYDYCYASIIDBIAAACAHADQJKKQBQEQFQGZIZCBCIDIDBEJIRGJBAFAIAKAJaHQHIJIKIBSFYGYIYDYEBAYCSEIDIGIIIFIBCJYHYCQERDIABKYHBCZEREYDTAIAQGJIAHACAHYECDYAREIDCCIJJKIBSFYHYIYDYCBGYKIBIFSHYIYDYCYEYACKIDRHIIIFCBYDYKYASEICIGIHIIIDCBIHYFSDYIYCYEYGYACJIKIBIFIDTHYIYBCJYKYASEICIGIBIHIIIDDFYJYKYAYESCIAB', 'GODGqGMBhBNCYCBDIDKDZDbDiDkDRGGYAYEAKIJIDABYMQKQCQEQAIGIIIHIFCDYDQJZLABAMaKQCQKYERIIIQHKNALAJJDALYMYKYCQJILQNQHaAQGKHAAZIANJLAJZCAKIMIDQFQHYGZIAAJLAJABAMAMIDIFRJYKYCQBIDAKYLYAYNYEBCIMIMQBQNQJKLQAZJALKDABYFAKYLYMYCYERJIJQAKDANYCAMIKIFQDYAZIQGJHJDALZJZIQGQHJAAGaIACAIYEBMIMAKKBQNQJQJYCYLIDQAYHYEAMANJJQLQGQIZCACIGIIIDIFBBYJYMYNYERHIAIFAKYLYMYCQIJGAMALJJANZKABKNQJQDQJIFRAYGZHYIZCAEBKIKABANKJQBZJYKQLJMQIQGJDAFABYKYMYLYNYESCIGIHIAIFAIIDIMYDQGZIALAKABJMQDYFQAYHYCAKYLIKABANAJKMQDQMIFRGYGQAQHaIAAJGAKZLZCQIIHJGAKALZAQ', 'IUlBpCHBXBbByBzB0BaCoCmDrDuDAEKEFFQFCGcG1HOIIBLYAYKYMYDRSIAACQLIIROYABKYSYDAMILIEQSYDYCRPIAIOIRIICEYEAKYLZMZCQDQSJKAMALJEQGBHYTYCRDILIMIGIHBTYCYDRLIMIGIHIEIFCTYGRLYMYDBCIGITIFSEYHYLYMYGBTIHRLYMYGYDYCBTIHIFIERLYMYHBTYCRDIGIHILIMIECFYLYTYGRHIMIMQKQKISZDAHAMJLJEQEIISOYAYRYPYDCHIKISIEALYMYHQSIAROIIBLYAQSYHBKIMIAILIFBTYARKZMYCBGIAITIFRLYMYABGYCRAIMILIFBTYGYCYARKJMIGBTIFRLYGYKYMYHRSIDQGALIIROYGBKYSYHAMILIEQSYHYDRPIGIOIRIICEYEAKYLZMZDQHQSJKAMALJEQEIFCTYCYAYDRHIABCITIFSEYLYMYAYCBTIFIERLYMYAYCYHYDBTIARLIMIECFYAYTYDRHICILIMIABFIBI', 'HRdBFDABBBeBhBgCbDiDqDxDLENECGQGYGsHKIFQIYHQLQNQBaMAAAEAHJLQOJCQDQBZNAOALAHZAQEQMQNJBJCADAPAIAHZLQPJGBFYJYKYQYERAILIHIIIDSCIGBDYCSOYPYMYABLIHIIICIDIFBJYKYCRHYIYLYEBQICIJIKIFRDYHYIYCBQYERARMIOIPIGIDCFCJYFQKYQYEYARLICIHIIIFIDSGYOYPYCBLYABEIQIJIKIDRFYHYIYLYAYEBQIJIKIDIFRHYIYLYCRMYEBAICILIHIIIFBDYJYKYQYARERMIOIPIGIFCDCJYKYQYAYERCIABQIJIKIDSFSGYOYPYMYCBEBQIJIKIDIFRHYIYLYAYEYCRMIABLIHIIIFBDYJYKYQYCREILIHIIIFIDBJYKYQYCYERLIAROIPIGIDCFYHYIYAYLYEBCIQIJIKIFRDSGYOYPYMYEBCBQIARHIIIDIFBJYKYAYQYCRLIHIIIABJIKIFRDYAYHYIYLYERMIOIPIAC',
  'GNFBrGZBaBVCYCIDRDjDpDTEAGKGHYDALJGAHACAFAJABaIQIIBIFQJJCQDQHQHIMZFABYIYKAJAIABKCQDQFQHYJZKQMJHAFAJACADABaIQIIBIFQJYKQMQHKGQLZHAMAKAJIFABYIYIABKCQDQFQJQGQGIMZFAKAJJCADABaEQAQIQJQKQHQLKMAFAGACADAJaIABJJQIaKQHQGJCADAIIIAJABZJIFQKQIJCQDQMQLaAAEAGAHAIAKABKFQJQCQDQMQHaGQLJHAMACADAFAJABaEQAQKQIQGQMJFAJYDQGYMYAYECIIKIDIDQIZAQEQJILIHIMICAIYDABIFRCYCAFABYDQGYMYAAIJGQMQHQHICIFBGYJYLYEAIIDADYIYKYESAIAAHIMJDBGIJIFRCYDYHYLYAYMYECIIGIKIBIFQCQJIDRCIFCDYDQGZIZJYKABJJQIQIYKYERAIGIFQHILYHAMAKAIJJABZEQAQHILIFADABYIQJJGQCQKYMYAYEBIIBIDQFQJILYHYEAJAGKBAIaGQJQEQHILIFADAIYGZJQAR', 'HQGBoDSBmBACBCTCcDkDwDCEEEYEqEsEUGDAOINICSGYHYIYDYPYASLIKIGBCBNYOYARDIHIIICIGRKYLYDCPIABCAIYOINIGRCYHYAYPYDSLIKICBHYPIHAGAIANAJKBQGQMQIaHQHIPZAADAGAOAJJBKGQMQIQHaNABAJZOQAQPICRKYLYDBAINIPICICQGBBYJYOYARPYDSLIKIGBPICAIJMAJZBQIQCQGRKYLYPYDCPIABCAOIBIIIGRCYNYAYPYDSLIDAKICBPYAAOABJIQNQHKGAMAJAIaGQBZHYOQAQDQPJHAGABYNAOYDRAINIGIJIMIESFYCYHYKYLYPYACPIDBGAOIBIIIJJIABaJQGQJYOYDRPYASLIKICIPIHIFIECIYMYGYNYAYDBOIJIGQNQHQHIPZAADAGAOAJJBKGQIQMQHaNABAJZOQAQPICRKYLYDBAINIPICICQGBBYJYOYARPYDSLIKIGBPICABAJAIJMQBZCQGRKYLYPYDCPIABCAOIIIJIGRCYNYAYPYDSLIDAKICBPYAAOAIJJQNQHKBAGAMAJaGQNQHQBK', 'GLgBNCUBEDIDkDQESFAGKGpGDYBAFQCQCIHIGIGQEQAAEIJZDQKYFYCQBQIKJAABDZGYHAFAFYKJGQAQEQDQJQIaBACAHACYBSEIHIDIIIJIABGBFZEQFQEZDRGJARGYIYJYHYBCCICQBQHQIKJAAAGAEADZKAFKDQEQAQGQJQIaBACAFIDJEQHAKZCZFBDJDAELKQKIARGYCYCAKAEaDQFQBQHQIKJAGAAAEYDZFQKJCQGIABCZKZFADJEJCQAQEYGQJQIaBAHAFAFYKJEADaKQBRFQHQIKJAAACAGAEAFZHQIQJKGAEAFADAKaHQEJGQJaIABAEAHAKKCQDQFQGQEZAQHAKADKFQDYGQEQJQIaBAHAKADAFKGQFYKZBSHIEIIIJIABCBKICIATCYEYIYJYHYBCKIGAFZDQKQBQHQIKJACAEAGAFADZAAKQHQEJBQGAFADAKaHQEQIQJKGAEZHAKKAQCQDQFQEQGQJaIABAHAFKEQGQJQIaBAHAFAKADKEQKZFQBQHQIKJACAAAEYDZFQGAKJAJCRGYABKZAQFADJEJCQGQJQIaBAHAFADAEJKQAQAIGICBKYKAEbDQDZFRAJ', 'GLIBVCFBJDRDjDgEDFAGYGrGJJGAKaBQCQFQJQHQIKAADAEAGAGIJZARDYFAIYCABAKKJQFaHQEJDQFIIZEADKGAFAJAKaBQCQHQDQEQIKGADZGYEYCYDIIYBCHIFIJIKIARGREZDAEADZFBGJABGYJYKYHYBSCICABAHAKKJQAQGQDQFZIQEKFADAAAGAJAKaBQCQEIFJDAHQIZCZERFJFQDLIAIIABGYCYCQIQDaFAEABAHAKKJQGQAQDYFZEAIJCAGIARCZIZEQFJDJCAAADYGAJAKaBQHQEQEYIJDQFaIABBEAHAKKJQAQCQGQDQEZHAKAJKGQDQEQFQIaHADJGAJaKQBQDQHQIKCAFAEAGADZAAHQIQFKEAFYGADAJAKaBQHQIQFQEKGAEYIZBCHIDIIIAIJIKICTAYABCBDYJYKYHYBSIIGQEZFAIABAHAKKJQCQDQGQEQFZAQIAHADJBAGQEQFQIaHADAKAJKGQDZHQIKAACAFAEADAGAJaKQBQHQEKDAGAJAKaBQHQEQIQFKDAIZEABAHAKKJQCQAQDYFZEAGQIJAJCBGYARIZAAEQFJDJCAGAJAKaBQHQEQFQDJIAAAAIGICRIYIQDbFAFZEBAJ',
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

/** 下限と上限で挟む */
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

/** 2 色を混ぜる（t=0 で a、t=1 で b） */
function mixHex(a, b, t) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return rgbHex([0, 1, 2].map((i) => mix(x[i], y[i], clip(t, 0, 1))));
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
// ブロックの素材。
//
// 盤面のブロックは「色のついた板」ではなく、**その素材で削り出した塊**に見せる。
// いま持っているのは 2 つだけ ―― 何も乗せないプレーンと、
// エメラルドカットのクリスタル。
//
// 昔はここに石・木・金属・紙・布も並んでいたが、どれも「それらしく見える」まで
// 詰め切れないまま数だけ増えていたので、畳んだ。素材は好みで選ぶ飾りで、
// 中途半端なものが 7 つ並ぶより、仕上がったものが 2 つ並ぶほうがいい。
//
// 画像は 1 枚も使っていない。すべて実行時に手続き的に描いている ――
// 素材ごとに「高さの場」を作り、その**傾きから陰影を計算する**（バンプマッピング）。
// 色を塗り分けただけのテクスチャは、動かすと平らに見える。傾きから光を当てると、
// 同じデータでも凹凸として読める。
//
// ここが持つのは「表面」だけ。立体の組み立て（接地影 → 側面の厚み → 天面 →
// 面取り → 鏡面）は render.js の 1 本の経路が受け持ち、素材はその経路に
// 寸法と色と塗り方を渡す。そうしないと素材を足すたびに立体の作りが分岐する。

/**
 * 光の向き（画面座標）。左上やや上から。
 * 全素材で共通にしてある ―― 素材ごとに光源が動くと、盤面が 1 つの場所に見えない。
 */
const LIGHT = { x: -0.52, y: -0.85 };

/** テクスチャのタイルの一辺（px）。継ぎ目なく繰り返せるように作る */
const TILE = 256;
/** ノイズ格子の一辺。TILE と割り切れる 2 の冪にしておくと端が繋がる */
const GRID = 64;

// ---------------------------------------------------------------- ノイズ

/** 格子の乱数。端で折り返すので、タイルの継ぎ目が出ない */
function makeNoise(rng) {
  const g = new Float32Array(GRID * GRID);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return g;
}

/**
 * 値ノイズをタイル座標（u,v ∈ 0..1）で読む。
 *
 * **fx / fy は「タイルを横切るあいだに何周するか」で、整数でなければならない。**
 * ここが継ぎ目の有無を決める。整数でないと u=0 と u=1 が別の格子点を指し、
 * 繰り返して敷いたときに縦横の線が走る（最初これで盤面に格子が出た）。
 * 整数なら剰余がぴったり回るので、端は必ず反対の端と繋がる。
 *
 * ox / oy は表を読む位置のずらし。オクターブごとに変えて、
 * 重ねた層が同じ模様の拡大縮小に見えないようにする。
 */
function noiseAt(g, u, v, fx, fy, ox = 0, oy = 0) {
  const px = Math.max(1, Math.round(fx));
  const py = Math.max(1, Math.round(fy));
  const x = u * px;
  const y = v * py;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  // smoothstep。線形補間のままだと格子の筋が見えてしまう
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const i0 = ((xi % px) + px) % px;
  const j0 = ((yi % py) + py) % py;
  const i1 = (i0 + 1) % px;
  const j1 = (j0 + 1) % py;
  const at = (j, i) => g[(((j + oy) % GRID) * GRID) + ((i + ox) % GRID)];
  return mix(mix(at(j0, i0), at(j0, i1), sx), mix(at(j1, i0), at(j1, i1), sx), sy);
}

/**
 * 重ね合わせたノイズ（fBm）。周波数は倍々になるので、fx / fy が整数なら
 * どのオクターブも整数のまま ―― 全部の層が同時に継ぎ目なく繋がる。
 *
 * @param {boolean} ridge 山にする（|2n-1| を裏返す）。石の「欠け」はこれで出る ――
 *   ふつうの fBm は丘のように丸いが、ridge は稜線が立って割れ目に見える。
 */
function fbm2(g, u, v, fx, fy, octaves, gain = 0.5, ridge = false) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let mul = 1;
  for (let o = 0; o < octaves; o++) {
    let n = noiseAt(g, u, v, fx * mul, fy * mul, o * 17, o * 29);
    if (ridge) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    mul *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- タイル生成

/**
 * 高さの場から 1 枚のタイルを焼く。
 *
 * @param {(u:number,v:number)=>number} height 0..1 の高さ（u,v は 0..1 のタイル座標）
 * @param {(u:number,v:number,h:number)=>number[]} color その点の地の色 [r,g,b]
 * @param {{relief?:number, ambient?:number}} opts relief = 凹凸の強さ
 * @returns {HTMLCanvasElement}
 */
function bumpTile(height, color, opts = {}) {
  const { relief = 0.35, ambient = 0.92 } = opts;
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const px = img.data;

  // ① 高さを全部求める。傾きを取るのに隣の値が要るので、色より先に片づける
  const h = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) h[y * TILE + x] = height(x / TILE, y / TILE);
  }
  const at = (x, y) => h[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];

  // ② 傾きの大きさを測る。
  //
  //    ここが要点。同じ relief を与えても、高さの場が細かいほど傾きは大きくなる ――
  //    素材ごとに周波数が違うので、生の傾きをそのまま明るさにすると、細かい素材
  //    （金属のヘアライン）だけが真っ白と真っ黒に振り切れる。実際そうなった。
  //    傾きの二乗平均で割って正規化すれば、relief は「どれくらい凸凹に見せたいか」
  //    という 1 つの意味だけを持つようになり、周波数を変えても破綻しない。
  const gx = new Float32Array(TILE * TILE);
  const gy = new Float32Array(TILE * TILE);
  let acc = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      gx[i] = dx;
      gy[i] = dy;
      acc += dx * dx + dy * dy;
    }
  }
  const norm = Math.sqrt(acc / (TILE * TILE)) || 1e-6;

  // ③ 色を置く
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const slope = (gx[i] * LIGHT.x + gy[i] * LIGHT.y) / norm;
      const lit = clip(ambient + slope * relief, 0.45, 1.55);
      const c = color(x / TILE, y / TILE, h[i]);
      const o = i * 4;
      px[o] = clip(c[0] * lit, 0, 255);
      px[o + 1] = clip(c[1] * lit, 0, 255);
      px[o + 2] = clip(c[2] * lit, 0, 255);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

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

// ---------------------------------------------------------------- 素材ごとの表面

/**
 * クリスタル ―― 磨いたガラスの卓面。
 * 面取りは幾何（render.js の 8 面）で作るので、ここは卓面のごく淡い曇りだけ。
 * texture を濃くすると、透明感が濁って「すりガラス」になってしまう。
 */
function crystalTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const base = hexRgb(pal.mid);
  const light = hexRgb(pal.top);

  const height = (u, v) => fbm2(g, u, v, 2, 2, 3, 0.55);
  // 卓面は「ほとんど何も無い」のが正しい。濁らせると、すりガラスになってしまう。
  // かといって白く飛ばすと、透けているようには見えない ―― 地の色を中心に振る
  const color = (u, v, h) => [0, 1, 2].map((i) => mix(base[i], light[i], clip(h * 0.5 + 0.05, 0, 1)));
  return bumpTile(height, color, { relief: 0.1, ambient: 1.04 });
}

// ---------------------------------------------------------------- 素材の定義

/**
 * 素材ひとつ。寸法はすべて**セルの一辺に対する比**で持つ ――
 * 盤面が 4×4 でも 8×8 でも、ブロックの厚みと面取りが同じ割合で見えるように。
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
     * テクスチャも持たず、一色のベタ塗りに髪の毛ほどのすき間だけ。
     * 目が拾うものが「色と形」しか無いので、どのブロックがどこまでかが一瞬で分かる。
     *
     * flat が立っている素材は、立体の経路（接地影・側面・面取り・縁・テクスチャ）を
     * まるごと飛ばす ―― 薄くするのではなく、通らない。
     */
    flat: true,
    depth: 0,
    bevel: 0,
    radius: 0.14,
    gap: 0.032,
    gloss: 0,
    sheen: 0,
    tint: 1,
    shadow: 0,
    grain: 0,
    bevelStyle: 'soft',
    /** 進行度の色を素材へ混ぜず、そのまま使う（元の見た目がそうだった） */
    rawTint: true,
    /** 盤面も進行度の色を、ほとんど白まで薄めて追いかける */
    trayTint: true,
    colors: {
      grey: { top: '#c4c4cb', mid: '#9a9aa2', deep: '#5f5f68', side: '#6e6e78' },
      lit: { top: '#7f97e6', mid: '#3e47cc', deep: '#2a2f8c', side: '#333a9f' },
    },
    tray: { frame: '#dde2f0', floor: '#dde2f0', well: '#eef1f8' },
    texture: null,
  },
  {
    key: 'crystal',
    name: 'クリスタル',
    note: 'エメラルドカット',
    depth: 0.085,
    bevel: 0.17,
    radius: 0,
    chamfer: 0.2,      // 角を 45° で落とす（丸めない）
    gap: 0.058,
    gloss: 1,
    sheen: 0.3,
    tint: 0.95,
    shadow: 0.42,
    grain: 0.6,
    facets: 8,
    bevelStyle: 'facet',  // エメラルドカット
    bevelAlpha: 1,
    translucent: 0.76, // 卓面の不透明度。下のトレイが薄く透ける
    prism: true,       // 面の継ぎ目に虹の線を入れる
    colors: {
      // 灰色は無色のガラス、色つきは染めたガラス。透けるぶん明暗が薄くなるので、
      // ここだけは色みの差をいちばん強く取る
      grey: { top: '#c4cad1', mid: '#8d939a', deep: '#474c52', side: '#6b7178' },
      lit: { top: '#d8f2ff', mid: '#6ec8ee', deep: '#175f85', side: '#3d95c4' },
    },
    // 透けるものは、暗い受け皿の上でしか透けて見えない
    tray: { frame: '#3e4650', floor: '#2b323b', well: '#1d232a' },
    texture: crystalTexture,
  },
];

/** 素材の並び（設定画面もこの順で出す） */
const MATERIAL_KEYS = DEFS.map((d) => d.key);

/**
 * 何も選んでいないときの素材。
 * 迷ったら**いちばん読みやすいもの**を出す ―― 素材は好みで選ぶ飾りで、
 * 遊べることのほうが先にある。
 */
const DEFAULT_MATERIAL = 'plain';

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/** 素材を引く。知らない名前なら既定の素材 */
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
 * 灰色ブロックは素材そのままの色。色つきブロックは、素材の明るいほうの地を
 * 進行度の色相へ引っぱる ―― 引っぱる強さは素材ごと（木を真っ青にすると
 * 木に見えなくなるが、ガラスは何色でもガラスに見える）。
 */
function paletteFor(mat, isColored, tintHex) {
  const src = isColored ? mat.colors.lit : mat.colors.grey;
  if (!isColored || !tintHex) return { ...src, key: `${mat.key}|grey` };
  /*
   * プレーンだけは素材へ混ぜない。混ぜると明るさが素材の側に引き戻されて、
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
 * テクスチャを焼くときの色。**進行度では動かさない。**
 *
 * タイル 1 枚を焼くのに数十ミリ秒かかるので、進行度が変わるたびに焼き直すと
 * 遊んでいる最中に引っかかる。そこでタイルは素材そのものの色で 1 度だけ焼き、
 * 進行度の色は描くときに色相だけ被せる（render.js の bakeSurface）。
 * 明るさは被せても変わらないので、木目や石の粒の陰影はそのまま残る。
 */
function texturePaletteFor(mat, isColored) {
  const src = isColored ? mat.colors.lit : mat.colors.grey;
  return { ...src, key: `${mat.key}|${isColored ? 'lit' : 'grey'}` };
}

/**
 * 盤面（トレイ）の色。
 *
 * **進行度では動かさない。** 動かすと、色が 1 段変わるたびにトレイを丸ごと
 * 焼き直すことになり（枠・床・空きマスの 3 枚のテクスチャと内側の影）、
 * 遊んでいる最中に 90ms 近く止まった。
 * 温度の変化は色つきブロックと背景の光が担っているので、
 * 受け皿は素材そのものの色で据えておくほうが、画面としても落ち着く。
 */
function trayPaletteFor(mat, tintHex) {
  /*
   * 例外はプレーンだけ。焼くものが「角丸の塗り 2 枚」しか無いので、
   * 色が 1 段動くたびに焼き直しても目に見えるほどの間は空かない ――
   * そのぶん、盤面まで含めて温度が変わる元の見え方が戻ってくる。
   */
  if (mat.trayTint && tintHex) {
    const [h] = rgbHsl(hexRgb(tintHex));
    const plate = rgbHex(hslRgb(h, 30, 89));
    return { frame: plate, floor: plate, well: rgbHex(hslRgb(h, 34, 95)), key: `${mat.key}|tray|${tintHex}` };
  }
  return { ...mat.tray, key: `${mat.key}|tray` };
}

// ---------------------------------------------------------------- タイルの控え

const tileCache = new Map();

/**
 * 素材 × 色 のタイルを 1 枚だけ焼いて使い回す。
 * 1 枚 256×256 の生成に数ミリ秒かかるので、毎フレーム作るわけにはいかない。
 */
function tileFor(mat, pal) {
  if (!mat.texture) return null; // プレーンは模様を持たない
  const key = `${mat.key}|${pal.top}|${pal.mid}|${pal.deep}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const cv = mat.texture(pal, hashSeed(key));
  // 使い回しが効かないほど溜まったら、古いものから捨てる（進行度で色が動くため）
  if (tileCache.size > 24) tileCache.delete(tileCache.keys().next().value);
  tileCache.set(key, cv);
  return cv;
}

/** 素材を切り替えたときなど、焼いたタイルを全部捨てる */
function clearTileCache() {
  tileCache.clear();
  scaleCache.clear();
}

const scaleCache = new Map();

/**
 * タイルを実寸に焼き直したもの。
 *
 * **createPattern に拡大縮小を掛けたまま敷いてはいけない。** 繰り返しの継ぎ目に
 * 半端な画素が挟まり、ブロックの上に白い格子の線が走る（実機ではっきり見えた）。
 * 整数の大きさに焼き直してから等倍で敷けば、継ぎ目は原理的に出ない。
 *
 * @param {boolean} turn 90° 回す（木目を長辺に沿わせるとき）。正方形なので
 *   回しても継ぎ目は崩れないし、画素の補間も起きない
 */
function scaledTile(mat, pal, size, turn = false) {
  if (!mat.texture) return null;
  // 8 の倍数に丸める。下で余白を 1/8 だけ取るので、そこが割り切れないと
  // 縮尺がわずかにずれ、せっかく消した継ぎ目が戻ってくる
  const px = Math.max(16, Math.round(size / 8) * 8);
  const key = `${mat.key}|${pal.top}|${pal.mid}|${pal.deep}|${px}|${turn ? 1 : 0}`;
  const hit = scaleCache.get(key);
  if (hit) return hit;

  const src = tileFor(mat, pal);
  if (!src) return null;

  /*
   * 素のタイルは継ぎ目なく繋がるが、**縮めた瞬間に継ぎ目が戻る** ――
   * drawImage は端の外側を読めないので、右端の画素が左端ではなく自分自身と
   * 混ざり、1 本の線になる。
   *
   * そこで周囲に「回り込んだぶん」の余白を付けてから縮め、中央だけを切り出す。
   * 中央の画素は上下左右に本物の隣を持つので、継ぎ目が生まれない。
   *
   * 余白は 1/8 で足りる。最初は 3×3 に並べていたが、それだと縮小先が
   * 9 倍の面積になり、素材を切り替えるたびに 300ms 近く固まった。
   */
  const m = TILE / 8;
  const sw = TILE + m * 2;
  const pm = px / 8;
  const pw = px + pm * 2;

  const rep = makeCanvas(sw, sw);
  const wide = makeCanvas(pw, pw);
  const cv = makeCanvas(px, px);
  if (!rep || !wide || !cv) return null;

  const rctx = rep.getContext('2d');
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) rctx.drawImage(src, m + i * TILE, m + j * TILE);
  }

  const wctx = wide.getContext('2d');
  wctx.imageSmoothingEnabled = true;
  if (wctx.imageSmoothingQuality) wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(rep, 0, 0, pw, pw);

  const ctx = cv.getContext('2d');
  if (turn) {
    ctx.translate(px, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(wide, pm, pm, px, px, 0, 0, px, px);

  if (scaleCache.size > 32) scaleCache.delete(scaleCache.keys().next().value);
  scaleCache.set(key, cv);
  return cv;
}

// ---------------------------------------------------------------- 面取りの陰影

/**
 * 面取りの 1 面の明るさ。法線 (nx, ny) が光のほうを向くほど明るい。
 *
 * 磨いたものだけ返り方を変えてある ―― 鏡のような面は拡散光をほとんど返さず、
 * 光源の**鏡像**を返す。だから上の面が明るいだけでなく、下の面も
 * （周りの明るい床を映して）明るくなる。この 2 つ目の山が無いと、
 * どれだけ磨いても「灰色のプラスチック」にしか見えない。
 */
function facetShade(mat, nx, ny) {
  const d = nx * LIGHT.x + ny * LIGHT.y;
  if (mat.key === 'crystal') {
    const direct = Math.max(0, d);
    const bounce = Math.max(0, -d); // 下から返ってくる環境光
    // 面ごとの差を大きく取る。差が小さいと、磨いた面ではなく
    // 「灰色のプラスチックに角を付けたもの」にしか見えない
    return 0.34 + Math.pow(direct, 1.15) * 1.05 + Math.pow(bounce, 2.2) * 0.5;
  }
  return 0.62 + Math.max(0, d) * 0.62 + Math.max(0, -d) * 0.06;
}

/** 面取りの 1 面の色 */
function facetColor(mat, pal, nx, ny) {
  const s = facetShade(mat, nx, ny);
  const base = pal.mid;
  return s >= 1 ? shade(base, (s - 1) * 0.9) : mixHex(pal.deep, base, clip(s, 0, 1));
}

/** ブロックの縁に引く 1 本の線。地より少し濃いだけにして、輪郭を主張させない */
function edgeColor(pal) {
  return luma(pal.deep) > 140 ? shade(pal.deep, -0.22) : shade(pal.deep, -0.3);
}

/** 効果（破片・光の輪）に使う代表色。素材が変わっても演出の色が浮かないように */
function effectColors(mat, pal) {
  return {
    base: pal.mid,
    light: shade(pal.top, 0.18),
    dark: pal.deep,
    shadow: hexRgb(pal.deep).join(','),
  };
}

// ===== src/render.js =====
// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックは「色の付いた板」ではなく、**素材から削り出した塊**として描く。
// 順番は 接地影 → 側面の厚み → 天面のテクスチャ → 面取り → 縁 の 1 本道で、
// 素材（src/materials.js）はその道に寸法と色と塗り方を渡すだけ。
// 素材ごとに立体の作りを分岐させると、素材を足すたびに立体が壊れる。
//
// 速さについて。天面のテクスチャは 256×256 のタイルを 1 枚焼いて使い回し、
// **ブロック 1 個の絵そのものもオフスクリーンに焼いて使い回す**。
// 同じ形・同じ色のブロックは 1 枚を共有するので、盤上に 20 個あっても
// 焼くのは数枚で済む。毎フレームやるのは、その絵を貼ることだけ。
// 影のぼかしや面取りの扇を毎フレーム描くと、それだけで 60fps が出ない。

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
 * 素材の地（baseHex）を渡すと、**色つきブロックとまったく同じ色**を薄めて返す ――
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

/**
 * 面取りを何枚の面に割るか、その境界の向きを決める。
 *
 * 角から角へ均等に 8 分割すると、細長いブロックでは対角線が角を通らず、
 * 長辺の途中で面が割れてしまう。だから角度は**その矩形の角の位置から逆算**する ――
 * 角の落とし（丸みなら丸みの端、面取りなら切り口の両端）を通る 8 本の線が境界。
 * こうすると額縁の留め継ぎのように、角でぴたりと 45° に合う。
 */
function facetRays(box, cut) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const c = Math.max(0.5, Math.min(cut, box.w / 2 - 0.5, box.h / 2 - 0.5));
  const { x0, y0, x1, y1 } = box;
  // 右上の切り口の始点から時計回り。点と点のあいだが 1 枚の面になる
  const pts = [
    [x1 - c, y0], [x1, y0 + c], // 右上の角
    [x1, y1 - c], [x1 - c, y1], // 右辺 → 右下の角
    [x0 + c, y1], [x0, y1 - c], // 下辺 → 左下の角
    [x0, y0 + c], [x0 + c, y0], // 左辺 → 左上の角
  ];
  // 各面の外向き法線。pts[i] と pts[i+1] のあいだの面が normals[i]
  const K = Math.SQRT1_2;
  const normals = [
    [K, -K],  // 右上の角
    [1, 0],   // 右辺
    [K, K],   // 右下の角
    [0, 1],   // 下辺
    [-K, K],  // 左下の角
    [-1, 0],  // 左辺
    [-K, -K], // 左上の角
    [0, -1],  // 上辺
  ];
  // atan2 は ±π で折り返す。そのまま arc() に渡すと、折り返した 1 枚だけが
  // 円をほぼ 1 周してしまうので、単調に増えるようにほどいておく
  const angles = pts.map(([x, y]) => Math.atan2(y - cy, x - cx));
  for (let i = 1; i < angles.length; i++) {
    while (angles[i] < angles[i - 1]) angles[i] += Math.PI * 2;
  }
  return { cx, cy, angles, normals };
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

    /** ブロックの素材。設定で切り替わる */
    this.material = materialFor(DEFAULT_MATERIAL);
    /**
     * 焼き上げたブロックの絵。
     * 鍵は「素材 × 形 × 色 × マスの大きさ」。同じ鍵なら 1 枚を全員で使う。
     */
    this.pieceCache = new Map();
    /** 焼き上げた盤面。素材・大きさ・色が変わったときだけ焼き直す */
    this.trayCache = null;
    this.trayKey = '';

    this.refreshTint();

    this.options = { symbols: false, ghost: true, calm: false };
  }

  /** 素材を切り替える。焼いてある絵は全部捨てる */
  setMaterial(key) {
    const next = materialFor(key);
    if (next === this.material) return;
    this.material = next;
    this.invalidateBakes();
  }

  invalidateBakes() {
    this.pieceCache.clear();
    this.trayCache = null;
    this.trayKey = '';
    this._tintAt = -1; // 素材が変われば同じ進行度でも色が変わる
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
    this.greyPal = paletteFor(this.material, false, null);
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

  /** ブロックの色。灰色は素材そのまま、色つきは進行度の色を素材に混ぜたもの */
  palFor(colorIndex) {
    return colorIndex === -9 ? this.greyPal : this.litPal; // -9 は board.js の BLOCKER
  }

  /**
   * 演出（破片・光の輪・残像）に使う色。
   * ブロックそのものではなく「そこにあった色」を伝えられればいいので、
   * 素材の代表色 3 つに畳んで返す。
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
    else { this.trayCache = null; this.trayKey = ''; }
  }

  /**
   * マスとマスのすき間。素材ごとに決まる（石は目地が広く、金属は詰まっている）。
   * ここが空いているぶんだけ、下のトレイと落ち影が見える ＝ 厚みが読める。
   */
  get tileGap() { return Math.max(1, this.cell * this.material.gap); }
  get tileSize() { return this.cell - this.tileGap * 2; }
  get tileRadius() { return Math.max(1.5, this.cell * (this.material.radius || 0.12)); }
  /** ブロックの厚み（側面の見える高さ） */
  get depth() { return Math.max(1.5, this.cell * this.material.depth); }
  /** 面取りの幅 */
  get bevel() { return Math.max(1.5, this.cell * this.material.bevel); }

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
   * ブロックが**中に収まっている**ことを見せたいので、枠は 1 段高く、床は
   * 1 段低く描く。高いところは上面が明るく、低いところは上端に影が落ちる ――
   * 明暗の付け方をひっくり返すだけで、同じ形が「出っ張り」にも「窪み」にも見える。
   *
   * 空きマスはさらにもう 1 段深い窪みにしてある。通路がどこにあるかは
   * このゲームでいちばん読みたい情報なので、影の濃さで他と差を付ける。
   */
  drawTray(board) {
    /*
     * 平らな盤面は焼かずに、その場で描く。
     *
     * プレーンは盤面の色も進行度を追いかけるので、焼いてしまうと色が 1 段動くたびに
     * 盤面ぶんのキャンバスを作り直すことになる ―― 大きな盤面で 1 手ごとに 55ms
     * 止まった。中身は角丸の塗り 2 枚しか無いので、毎フレーム直に描くほうがずっと軽い。
     */
    if (this.material.flat) {
      this.bakeFlatTray(this.ctx, board, this.trayPal, this.ox, this.oy, this.cell * this.size);
      return;
    }
    const key = `${this.material.key}|${this.cell}|${this.size}|${this.ox},${this.oy}`
      + `|${this.trayPal ? this.trayPal.key : ''}|${this.emptyKey(board)}`;
    if (this.trayKey !== key || !this.trayCache) {
      this.trayCache = this.bakeTray(board);
      this.trayKey = key;
    }
    if (this.trayCache) {
      const t = this.trayCache;
      this.ctx.drawImage(t.canvas, t.x, t.y, t.w, t.h);
    }
  }

  /** 空きマスの並び。ここが変わったときだけトレイを焼き直せばいい */
  emptyKey(board) {
    if (!board) return '';
    const out = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) if (board.at(x, y) === -1) out.push(`${x}.${y}`);
    }
    return out.join(',');
  }

  bakeTray(board) {
    const mat = this.material;
    const pal = this.trayPal;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    // 枠の幅。盤面が小さいほど相対的に太くして、額縁らしく見せる
    const frame = Math.max(6, cell * 0.3);
    const outPad = Math.ceil(frame + cell * 0.3);
    const side = w + outPad * 2;
    const s = this.dpr;
    const cv = makeCanvas(side * s, side * s);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    ctx.scale(s, s);
    const x0 = outPad;
    const y0 = outPad;
    const radius = Math.max(6, cell * 0.3);

    const grain = mat.grain == null ? 1 : mat.grain;

    // --- 落ち影（盤面そのものが台の上に置かれている） ---
    ctx.save();
    ctx.shadowColor = 'rgba(24,22,20,0.3)';
    ctx.shadowBlur = cell * 0.4;
    ctx.shadowOffsetY = cell * 0.16;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2, radius);
    ctx.fill();
    ctx.restore();

    // --- 枠 ---
    const outerRect = new Path2D();
    outerRect.roundRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2, radius);
    ctx.save();
    ctx.clip(outerRect);
    ctx.fillStyle = pal.frame;
    ctx.fillRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2);
    const framePal = {
      top: shade(pal.frame, 0.18), mid: pal.frame, deep: shade(pal.frame, -0.24), side: pal.frame,
    };
    this.fillTexture(ctx, scaledTile(mat, framePal, cell * 3.4 * this.dpr), 0.85 * grain);
    // 枠は 1 段高い ―― 上端が明るく、下端が暗い
    const fg = ctx.createLinearGradient(0, y0 - frame, 0, y0 + w + frame);
    fg.addColorStop(0, 'rgba(255,255,255,0.32)');
    fg.addColorStop(0.5, 'rgba(255,255,255,0)');
    fg.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = fg;
    ctx.fillRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0 - frame + 0.5, y0 - frame + 0.5, w + frame * 2 - 1, w + frame * 2 - 1, radius);
    ctx.stroke();
    ctx.restore();

    // --- 床（1 段低い。上端に枠の影が落ちる） ---
    const floorPad = frame * 0.34;
    const floor = new Path2D();
    floor.roundRect(x0 - floorPad, y0 - floorPad, w + floorPad * 2, w + floorPad * 2,
      Math.max(3, radius * 0.6));
    ctx.save();
    ctx.clip(floor);
    ctx.fillStyle = pal.floor;
    ctx.fillRect(x0 - floorPad, y0 - floorPad, w + floorPad * 2, w + floorPad * 2);
    // 枠と同じ模様が続かないようにずらす
    this.fillTexture(ctx, scaledTile(mat, framePal, cell * 2.4 * this.dpr), 0.5 * grain, 37, 61);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x0 - floorPad, y0 - floorPad, w + floorPad * 2, w + floorPad * 2);
    ctx.restore();
    this.insetShadow(ctx, floor, cell * 0.34, 0.5);

    // --- 空きマス（もう 1 段深い窪み） ---
    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    const holes = new Path2D();
    let any = false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        holes.roundRect(x0 + x * cell + gap, y0 + y * cell + gap, size, size, tr);
        any = true;
      }
    }
    if (any) {
      ctx.save();
      ctx.clip(holes);
      ctx.fillStyle = pal.well;
      ctx.fillRect(0, 0, side, side);
      this.fillTexture(ctx, scaledTile(mat, framePal, cell * 2 * this.dpr), 0.38 * grain, 13, 29);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, 0, side, side);
      ctx.restore();
      this.insetShadow(ctx, holes, cell * 0.22, 0.62);
    }

    return { canvas: cv, x: this.ox - outPad, y: this.oy - outPad, w: side, h: side };
  }

  /**
   * 平らな盤面（プレーン）。
   *
   * ブロックと同じ寸法・同じすき間の淡いマスを敷き詰めただけの面で、影も枠も無い。
   * 上半分だけを 1px の白い線でなぞる ―― ガラス板の縁が光を拾ったときの 1 本で、
   * これだけで面が「浮いている」ように見える。
   */
  bakeFlatTray(ctx, board, pal, x0, y0, w) {
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
    ctx.save();
    ctx.fillStyle = pal.well;
    ctx.beginPath();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        ctx.roundRect(x0 + x * cell + gap, y0 + y * cell + gap, size, size, tr);
      }
    }
    ctx.fill();
    ctx.restore();
  }

  /**
   * 窪みの内側に落ちる影。
   * 形の内側を切り抜き、外側を塗った面に影を落とすと、影だけが内側へ回り込む ――
   * これが「へこんでいる」ことのいちばん確かなしるしになる。
   */
  insetShadow(ctx, path, blur, strength) {
    ctx.save();
    ctx.clip(path);
    ctx.shadowColor = `rgba(18,16,14,${strength})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = blur * 0.34;
    // 外側だけを塗る（even-odd で「とても大きな矩形 − この形」を作る）
    const outside = new Path2D();
    outside.rect(-2000, -2000, 6000, 6000);
    outside.addPath(path);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill(outside, 'evenodd');
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

  /**
   * 素材のタイルを敷く。
   *
   * **必ず画素そのままの座標で敷くこと。** 変換行列に拡大が掛かったまま
   * createPattern を敷くと、繰り返しの継ぎ目に半端な画素が挟まり、
   * ブロックの上を白い格子の線が走る（実機ではっきり見えた）。
   * 切り抜き（clip）は変換を戻しても効いたままなので、ここだけ等倍に落とせばよい。
   */
  fillTexture(ctx, tile, alpha, offsetX = 0, offsetY = 0) {
    if (!tile) return;
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    const ox = Math.round(offsetX);
    const oy = Math.round(offsetY);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.translate(ox, oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(-ox, -oy, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

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
   * 影のぼかし・面取りの扇・テクスチャの敷き込みは、どれも 1 個あたり
   * 10 回近い描画になる。盤上に 20 個あると毎フレーム 200 回。
   * 焼いてしまえば毎フレームやるのは drawImage 1 回だけになる。
   *
   * @param {number[][]} cells 盤面座標のセル
   * @param {object} pal 色（materials.paletteFor）
   * @param {number} variant 同じ形でもテクスチャの位置をずらすための番号
   * @param {boolean} colored 色つきブロックか（灰色は進行度の色を被せない）
   */
  bakePiece(cells, pal, variant, colored) {
    const mat = this.material;
    const cell = this.cell;
    const { minX, minY, cols, rows } = this.cellBounds(cells);
    const depth = this.depth;
    // 影と厚みがはみ出すぶんの余白。平らな素材は何もはみ出さないので 1px でいい
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
    const gap = this.tileGap;
    const bevel = this.bevel;
    const radius = this.tileRadius;
    const chamfer = mat.chamfer ? mat.chamfer * cell : 0;

    const rects = this.rectsFor(cells, ox, oy, gap, radius);
    const outer = this.pathOf(rects, chamfer);
    const box = this.bboxOf(rects);

    /*
     * 平らな素材（プレーン）はここで終わり。
     *
     * 立体の経路を薄くするのではなく、**通らない**。接地影も側面も面取りも縁の線も
     * 無いので、目が拾うものが「色と形」だけになる ―― どのブロックがどこまでかを
     * いちばん速く読めるのがこの見た目で、だから既定にしてある。
     */
    if (mat.flat) {
      ctx.fillStyle = pal.mid;
      ctx.fill(outer);
      return { canvas: cv, pad, minX, minY, w, h };
    }

    // 卓面（面取りの内側）。角の落としも面取りのぶんだけ小さくなる
    const innerCut = chamfer ? Math.max(1, chamfer - bevel * 0.7) : Math.max(0.5, radius - bevel * 0.6);
    const innerRects = this.rectsFor(cells, ox, oy, gap + bevel, innerCut);
    const inner = this.pathOf(innerRects, chamfer ? innerCut : 0);

    // 順番が意味を持つ。
    //
    // 面取りは「輪郭と卓面のあいだの輪」だが、**輪を even-odd で切り抜いてはいけない**。
    // ブロックが複数マスにまたがると、マスの継ぎ目で内側の輪郭が重なり、
    // そこだけ半端な被覆率になって細い線が走る（盤面にマス目が浮いて見えた）。
    // 代わりに「面取りを一面に塗ってから、卓面をその上に重ねて隠す」―― こうすれば
    // 輪は塗り重ねの差として現れるだけで、切り抜きが要らない。
    // 縁をなぞるとき用の、外周だけの 1 本の輪郭（マスの境目を含まない）
    const rim = this.boundaryOf(cells, rects, box, radius, chamfer);
    const innerBox = this.bboxOf(innerRects);
    const innerRim = this.boundaryOf(cells, innerRects, innerBox, innerCut, chamfer ? innerCut : 0);

    const skin = {
      pal, mat, cols, rows, variant, box,
      colored,
      tintHex: this.tint.base,
    };
    this.bakeShadow(ctx, outer, rim, mat, cell, depth);
    this.bakeSide(ctx, outer, box, pal, mat, depth);
    // 天面をいったん全面に描く。面取りはこの上に乗せる
    this.bakeFace(ctx, outer, skin, 1);
    if (mat.bevelStyle === 'facet') {
      // 留め継ぎの面。いったん全面を面の色で塗り、卓面を上から重ねて中央を隠す ――
      // 輪だけを even-odd で切り抜くと、マスの継ぎ目に線が残る
      this.bakeFacets(ctx, outer, box, pal, mat, chamfer || radius * 0.85);
      this.bakeTable(ctx, inner, skin);
    } else {
      this.bakeSoftBevel(ctx, outer, rim, box, pal, mat);
    }
    this.bakeEdge(ctx, rim, innerRim, pal, mat, cell);

    return { canvas: cv, pad, minX, minY, w, h };
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

  /** 側面。塊の厚み。下へ押し出したぶんが、すき間から帯になって見える */
  bakeSide(ctx, outer, box, pal, mat, depth) {
    ctx.save();
    ctx.translate(0, depth);
    const g = ctx.createLinearGradient(0, box.y0, 0, box.y1 + depth);
    g.addColorStop(0, pal.side);
    g.addColorStop(0.55, mixHex(pal.side, pal.deep, 0.5));
    g.addColorStop(1, shade(pal.deep, -0.26));
    ctx.fillStyle = g;
    ctx.fill(outer);
    ctx.restore();
  }

  /**
   * 素材の地。指定された形に、色とテクスチャだけを敷く。
   * タイル 1 枚はおよそ 3 マスぶん。マスが小さくても、木目や石の粒が
   * 「そのブロックに対して」同じ割合で見える。
   */
  bakeSurface(ctx, box, skin, alpha) {
    const { pal, mat, cols, rows, variant, colored } = skin;
    // 筋のある素材は長辺に沿わせる（板の取り方が変われば別の板に見える）。
    // いまそういう素材は無いが、経路は残しておく ―― 素材ごとに分岐を足さないため
    const along = Boolean(mat.grainAlongLongSide) && rows > cols;
    // タイルは**素材そのものの色**で焼く。進行度で焼き直すと、色が 1 段動くたびに
    // 数十ミリ秒止まる。色は下の「色相を被せる」ひと塗りで付ける
    const tile = scaledTile(mat, texturePaletteFor(mat, colored), this.cell * 3 * this.dpr, along);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.mid;
    ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
    /*
     * 模様は**地の上に薄く重ねる**。
     *
     * 昔はここを不透明で敷いていたが、マスが 40px 前後まで小さくなると
     * 粒や織り目が形と同じ細かさになり、ブロックの輪郭が模様に埋もれて読めなくなる。
     * grain のぶんだけ透かして、下のベタ塗りを残す ―― 素材は「触れそうな表面」に
     * 見えればよく、拡大鏡で見るためのものではない。
     */
    // 同じ形のブロックでも模様の位置をずらす（並ぶと繰り返しが目に付く）
    if (tile) {
      this.fillTexture(ctx, tile, alpha * (mat.grain == null ? 1 : mat.grain),
        tile.width * variant * 0.37, tile.height * variant * 0.61);
    }
    ctx.globalAlpha = 1;

    /*
     * 進行度の色相を被せる。
     *
     * 'color' は「色相と彩度は塗った色、明るさは下のまま」という混ぜ方。
     * ふつうの半透明で塗ると陰影まで一緒に薄まって、木目も石の粒も潰れる ――
     * これなら凹凸はそのまま残り、色だけが変わる。
     */
    if (colored && mat.tint > 0 && skin.tintHex) {
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = alpha * mat.tint;
      ctx.fillStyle = skin.tintHex;
      ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
      ctx.restore();
    }
  }

  /**
   * 天面。素材の地を敷き、その上に帯・斜めの明暗・艶を重ねる。
   * 面取りの前に全面へ、面取りのあとに卓面へ ―― 同じ関数を 2 度使う。
   */
  bakeFace(ctx, path, skin, alpha) {
    const { pal, mat, box } = skin;
    ctx.save();
    ctx.clip(path);

    this.bakeSurface(ctx, box, skin, alpha);

    // 斜めの明暗。光の来ている側が明るい
    const s = mat.sheen;
    if (s > 0) {
      const g = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
      g.addColorStop(0, `rgba(255,255,255,${s * 0.5})`);
      g.addColorStop(0.42, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(20,16,12,${s * 0.4})`);
      ctx.fillStyle = g;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }

    // 艶。左上寄りに広い光の溜まりを置く
    if (mat.gloss > 0.15) {
      const r = Math.max(box.w, box.h) * 0.62;
      const g = ctx.createRadialGradient(
        box.x0 + box.w * 0.3, box.y0 + box.h * 0.2, 0,
        box.x0 + box.w * 0.3, box.y0 + box.h * 0.2, r,
      );
      g.addColorStop(0, `rgba(255,255,255,${mat.gloss * 0.26})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }

    ctx.restore();
  }

  /**
   * 卓面。面取りを塗ったあとに、その中央だけを塗り直して隠す。
   * 透ける素材はいったん下を消してから薄く塗る ―― 消さないと、下に敷いた
   * 面取りと側面が透けて、トレイではなく自分の影を見ることになる。
   */
  bakeTable(ctx, inner, skin) {
    const { mat, box } = skin;
    if (mat.translucent) {
      ctx.save();
      ctx.clip(inner);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
      ctx.restore();
    }
    this.bakeFace(ctx, inner, skin, mat.translucent || 1);
  }

  /**
   * 留め継ぎの面取り（金属・クリスタル）。
   * 中心から 8 方向へ扇を放ち、面ごとに明るさを変える。角度は矩形の角から
   * 逆算してあるので（facetRays）、角でぴたりと 45° に合う。
   * ここでは全面を塗り、中央は卓面で隠す ―― 輪を切り抜くとマスの継ぎ目に線が出る。
   */
  bakeFacets(ctx, outer, box, pal, mat, cut) {
    const { cx, cy, angles, normals } = facetRays(box, cut);
    const r = Math.hypot(box.w, box.h);
    ctx.save();
    ctx.clip(outer);
    ctx.globalAlpha = mat.bevelAlpha == null ? 1 : mat.bevelAlpha;
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i];
      const a1 = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
      ctx.fillStyle = facetColor(mat, pal, normals[i][0], normals[i][1]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 丸い縁の面取り（石・木・紙・布）。
   *
   * 面では割らない。輪郭を**太さを変えながら何度もなぞる** ―― 太くて薄い線から
   * 細くて濃い線へ重ねると、縁でいちばん強く、内へ向かって滑らかに消える帯になる。
   * 内側の輪郭で切り抜くやり方だと、そこに硬い境目が出て「丸み」に見えない。
   */
  bakeSoftBevel(ctx, outer, rim, box, pal, mat) {
    const bevel = this.bevel;
    const r = Math.hypot(box.w, box.h) / 2;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const g = ctx.createLinearGradient(
      cx + LIGHT.x * r, cy + LIGHT.y * r,
      cx - LIGHT.x * r, cy - LIGHT.y * r,
    );
    g.addColorStop(0, facetColor(mat, pal, LIGHT.x, LIGHT.y));
    g.addColorStop(0.5, facetColor(mat, pal, -LIGHT.y, LIGHT.x));
    g.addColorStop(1, facetColor(mat, pal, -LIGHT.x, -LIGHT.y));

    const alpha = mat.bevelAlpha == null ? 1 : mat.bevelAlpha;
    ctx.save();
    ctx.clip(outer);
    ctx.strokeStyle = g;
    ctx.lineJoin = 'round';
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      ctx.globalAlpha = alpha * (0.26 + i * 0.16);
      ctx.lineWidth = bevel * 2 * (1 - i / steps);
      ctx.stroke(rim);
    }
    ctx.restore();
  }

  /** 縁の線と、クリスタルの稜線 */
  bakeEdge(ctx, rim, innerRim, pal, mat, cell) {
    ctx.save();
    ctx.lineWidth = Math.max(1, cell * 0.018);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = edgeColor(pal);
    ctx.stroke(rim);
    ctx.restore();

    if (!mat.prism) return;
    // 面と面の継ぎ目が光を拾う。ガラスの「エッジの線」はこれで出る
    ctx.save();
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke(innerRim);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, cell * 0.014);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
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
   * pad を大きくすると、そのぶん内側へ縮んだ相似形になる（面取りの内側の輪郭）。
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
   * 矩形の並び -> 輪郭の Path2D。
   * 角の落とし方は素材が決める ―― 丸める（石・木・金属・紙・布）か、
   * 45° で切り落とす（クリスタル。エメラルドカットの角はここで決まる）。
   */
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

    // 焼いてある絵を貼る。同じ形・同じ素材・同じ色なら 1 枚を全員で使い回す
    const pal = this.palFor(piece.color);
    const { minX, minY } = this.cellBounds(piece.cells);
    const variant = ((piece.id % 4) + 4) % 4;
    const key = `${this.material.key}|${this.shapeKey(piece.cells, minX, minY)}`
      + `|${pal.key}|${this.cell}|${variant}`;
    let baked = this.pieceCache.get(key);
    if (baked === undefined) {
      baked = this.bakePiece(piece.cells, pal, variant, piece.color !== -9);
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
const RANKING_ENDPOINT = '';

// ===== src/ranking.js =====
// レベル別ランキング。
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
//
// 接続先（src/config.js の RANKING_ENDPOINT）が空のあいだは、この端末の
// localStorage にだけ貯める。世界共通に切り替えても記録の見た目は変わらない ――
// 画面には「世界」か「この端末」かだけを出す。
//
// 通信が失敗したときも、必ず端末側には残す。ランキングに載らなかったせいで
// クリアそのものが無かったことになる、という事故を起こさない。

/** 保存した名前。一度決めたら以後は自動で使う */
const NAME_KEY = 'slidepop.name';
/** 端末内ランキングの置き場 */
const RANK_KEY = 'slidepop.rank.v1';

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

/** 端末内ランキングを空にする（「データを消す」から呼ぶ） */
function clearLocalRanking() {
  try { localStorage.removeItem(RANK_KEY); } catch { /* 諦める */ }
}

// ---------------------------------------------------------------- 通信

/** 応答の形を吸収する。素の配列でも { entries: [...] } でも受け取る */
function entriesOf(payload) {
  if (Array.isArray(payload)) return rankSort(payload);
  if (payload && Array.isArray(payload.entries)) return rankSort(payload.entries);
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
  /** ブロックの素材。見た目だけが変わり、盤面もルールも変わらない */
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

    this.applySettings();
    this.bindUi();
    this.bindInput();

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
    }

    // ランキング
    if (d.btnRank) d.btnRank.addEventListener('click', () => this.showRanking(this.level));
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
   * ブロックの素材を選ぶボタンを並べる。
   * 見本は「その素材で焼いた実物」ではなく代表色の四角 ―― 一覧を実物で描くと
   * 選ぶだけで6素材ぶんのテクスチャを焼くことになり、シートを開くたびに固まる。
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

  /** いま選ばれている素材に印を付ける */
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
    if (wasLocked) this.submitResult();
    else this.toast(`ランキングの名前を「${clean}」にしました`);
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

  /** レベル別のランキングを開く */
  async showRanking(level = this.level) {
    const d = this.dom;
    if (!d.modalRank) return;
    const lv = normalizeLevel(level);
    const token = ++this.rankViewToken;

    d.rankTitle.textContent = `レベル ${lv} のランキング`;
    d.rankScope.textContent = isGlobalRanking() ? '世界共通 ― 手数の少ない順' : 'この端末 ― 手数の少ない順';
    d.rankList.innerHTML = '<div class="rank-empty">読み込んでいます…</div>';
    d.rankNote.textContent = ' ';
    this.openModal(d.modalRank);

    const res = await fetchRanking(lv);
    if (token !== this.rankViewToken) return; // 別のレベルを開き直された
    this.renderRanking(res);
  }

  /**
   * ランキングの一覧を組み立てる。
   * 名前はサーバーから来る他人の文字列なので、必ず textContent で入れる
   * （innerHTML に流すと、名前に書いた HTML がこちらの画面で動いてしまう）。
   */
  renderRanking(res) {
    const d = this.dom;
    const me = savedName();
    d.rankList.innerHTML = '';

    if (!res.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'rank-empty';
      empty.textContent = 'まだ誰も記録していません。最初のひとりになりましょう。';
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
        const moves = document.createElement('span');
        moves.className = 'rank-moves';
        moves.textContent = `${e.moves}手`;
        const time = document.createElement('span');
        time.className = 'rank-time';
        time.textContent = formatTime(e.time);
        row.append(pos, name, moves, time);
        d.rankList.appendChild(row);
      });
    }

    d.rankNote.textContent = res.offline
      ? 'サーバーにつながらないので、この端末の記録を出しています。'
      : (res.global
        ? `世界中の記録から、手数の少ない順に${RANK_LIMIT}位まで。`
        : 'いまはこの端末の記録だけです。');
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

  // ランキング（レベル別・世界共通）
  btnRank: $('btn-rank'),
  modalRank: $('modal-rank'),
  rankTitle: $('rank-title'),
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
