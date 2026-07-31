// SLIDE POP! ― tools/build.mjs が src/ から生成。直接編集しないこと。
(function () {
'use strict';

// ===== src/shapes.js =====
// ブロック形状の定義。テトロミノ7種を全回転させたものを「向き付き形状」として持つ。

/** 方向ベクトル。y は下が正（画面座標系と一致させる） */
const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const DIR_KEYS = ['up', 'right', 'down', 'left'];

const DIR_LABEL = { up: '↑', right: '→', down: '↓', left: '←' };

/** 反対方向 */
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// 各テトロミノの基準形。[x, y] の並び。
const TETROMINO_BASE = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

// 生成が詰まったときだけ使う小型ピース（既定では未使用）。
const SMALL_BASE = {
  i1: [[0, 0]],
  i2: [[0, 0], [1, 0]],
  i3: [[0, 0], [1, 0], [2, 0]],
  v3: [[0, 0], [0, 1], [1, 1]],
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

function buildShapes(base, kind) {
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
        out.push({
          id: out.length,
          name,
          kind,
          rotation: r,
          cells,
          parts: cells.map(() => 0),
          w,
          h,
          size: cells.length,
        });
      }
      cells = rotate(cells);
    }
  }
  return out;
}

/** テトロミノ全種・全向き（19 通り） */
const TETROMINOES = buildShapes(TETROMINO_BASE, 'tetromino');

/** 1〜3 セルの小型ピース（生成オプションで有効化した場合のみ使用） */
const SMALL_PIECES = buildShapes(SMALL_BASE, 'small');

/** 形状名 -> 代表的な向きの一覧 */
function shapesByName(name) {
  return TETROMINOES.filter((s) => s.name === name);
}

// --------------------------------------------------------------------------
// 連結ピース ― テトロミノを 2 個・3 個とつなげた大型ブロック
//
// レベルが上がるにつれてブロックが複雑になっていく。形は「テトロミノを辺で
// 繋いだもの」に限定しているので、大きくなっても“テトリスのブロックの合体”
// として読める。cells と同じ並びで parts（何番目のテトロミノ由来か）を持ち、
// 描画側はその境界に継ぎ目を入れる。
// --------------------------------------------------------------------------

/** セル配列 + パート番号を正規化して形状オブジェクトにする */
function finalizeShape(cells, parts, name, kind) {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const moved = cells.map(([x, y]) => [x - minX, y - minY]);
  const order = moved.map((_, i) => i);
  order.sort((a, b) => (moved[a][1] - moved[b][1]) || (moved[a][0] - moved[b][0]));

  const outCells = order.map((i) => moved[i]);
  const outParts = order.map((i) => parts[i]);
  let w = 0;
  let h = 0;
  for (const [x, y] of outCells) {
    if (x + 1 > w) w = x + 1;
    if (y + 1 > h) h = y + 1;
  }
  return { name, kind, cells: outCells, parts: outParts, w, h, size: outCells.length, rotation: 0 };
}

/** 既存セル群に、辺で接するようテトロミノを 1 個くっつける（座標は負でもよい） */
function attachTetromino(rng, cells) {
  const occupied = new Set(cells.map(([x, y]) => `${x},${y}`));

  // 接続先の候補 = 既存セルの上下左右で、まだ埋まっていないところ
  const halo = [];
  const seen = new Set();
  for (const [x, y] of cells) {
    for (const key of DIR_KEYS) {
      const d = DIRS[key];
      const k = `${x + d.x},${y + d.y}`;
      if (occupied.has(k) || seen.has(k)) continue;
      seen.add(k);
      halo.push([x + d.x, y + d.y]);
    }
  }
  shuffleInPlace(rng, halo);

  for (const [hx, hy] of halo) {
    for (const shape of shuffleInPlace(rng, TETROMINOES.slice())) {
      const idx = shuffleInPlace(rng, shape.cells.map((_, i) => i));
      for (const i of idx) {
        const ox = hx - shape.cells[i][0];
        const oy = hy - shape.cells[i][1];
        const abs = [];
        let clash = false;
        for (const [cx, cy] of shape.cells) {
          const p = [cx + ox, cy + oy];
          if (occupied.has(`${p[0]},${p[1]}`)) { clash = true; break; }
          abs.push(p);
        }
        if (!clash) return abs;
      }
    }
  }
  return null;
}

function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * テトロミノを parts 個つなげた形をひとつ作る。
 * @param {() => number} rng シード付き乱数（同じ種なら同じ形）
 * @param {number} parts つなげるテトロミノの数（1 なら素のテトロミノ）
 * @param {number} maxSpan 縦横の最大長。盤面内で必ず 1 マス以上滑れるよう size-1 を渡す
 */
function makeCompoundShape(rng, parts, maxSpan) {
  const kind = parts === 1 ? 'tetromino' : `x${parts}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const base = TETROMINOES[Math.floor(rng() * TETROMINOES.length)];
    const cells = base.cells.map(([x, y]) => [x, y]);
    const partOf = cells.map(() => 0);

    let ok = true;
    for (let p = 1; p < parts; p++) {
      const added = attachTetromino(rng, cells);
      if (!added) { ok = false; break; }
      for (const c of added) {
        cells.push(c);
        partOf.push(p);
      }
    }
    if (!ok) continue;

    const shape = finalizeShape(cells, partOf, `${base.name}${parts > 1 ? `+${parts}` : ''}`, kind);
    if (shape.w > maxSpan || shape.h > maxSpan) continue;
    return shape;
  }
  return null;
}

/** ある形状の全回転（重複は除く）。parts は cells と並びを揃えたまま回る */
function rotationsOfShape(shape) {
  const out = [];
  const seen = new Set();
  let cells = shape.cells.map(([x, y]) => [x, y]);
  const parts = shape.parts ? shape.parts.slice() : shape.cells.map(() => 0);

  for (let r = 0; r < 4; r++) {
    const s = finalizeShape(cells, parts, shape.name, shape.kind);
    const key = keyOf(s.cells);
    if (!seen.has(key)) {
      seen.add(key);
      s.rotation = r;
      out.push(s);
    }
    cells = cells.map(([x, y]) => [-y, x]);
  }
  return out;
}

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

const BOARD_SIZE = 12;
const COLOR_COUNT = 6;

const EMPTY = -1;
const WALL = -2;

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

  addPiece(color, cells, shape = '', parts = null) {
    const id = this.nextId++;
    const piece = {
      id,
      color,
      cells: cells.map(([x, y]) => [x, y]),
      shape,
      // cells と並びを揃えた「何番目のテトロミノ由来か」。連結ピースの継ぎ目描画に使う
      parts: parts ? parts.slice() : cells.map(() => 0),
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

  /**
   * デッドロック判定。
   * 仕様上の敗北条件は「どの手でも同色接触が起きない」だが、
   * 「消去しない手が通路をずらして次の手を生む」ケースを誤って敗北にしないよう、
   * 2 手先まで見る（消去手が 2 手以内にひとつも無ければ詰み）。
   */
  isDeadlock() {
    if (this.pieces.size === 0) return false;
    if (this.findClearingMoves().length > 0) return false;
    const moves = this.allMoves();
    for (const m of moves) {
      const snap = this.snapshot();
      this.movePiece(m.id, m.dir, m.steps);
      const found = this.findClearingMoves().length > 0;
      this.restore(snap);
      if (found) return false;
    }
    return true;
  }

  /** 盤面の完全なスナップショット（Undo 用） */
  snapshot() {
    return {
      nextId: this.nextId,
      pieces: [...this.pieces.values()].map((p) => ({
        id: p.id,
        color: p.color,
        shape: p.shape,
        parts: p.parts ? p.parts.slice() : null,
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
        parts: p.parts ? p.parts.slice() : p.cells.map(() => 0),
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

  /** 状態の指紋（ヒントが「解答手順の途中かどうか」を判定するのに使う） */
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

// ===== src/levels.js =====
// レベル定義。
//
// レベル1から無限に続く。同じレベルなら、どの端末でも必ず同じ譜面が出る
// （レベル番号 -> シード -> 決定論的な生成、という一本道になっている）。
//
// レベルが上がるにつれて変わるもの:
//   盤面   4×4 から 1 マスずつ広がり、レベル26で 12×12 に到達（上限）
//   ブロック  テトロミノ -> 2個つなぎ -> 3個つなぎ。レベル46以降は全部3個つなぎ
//   色数   小さい盤面は3色。広がるにつれて6色まで増える
//
// 「1手で消えるブロック群」を逆順に積み上げる生成方式は変わらないので、
// どのレベルでも「必ず全消しできること」は構造的に保証されたままになる。

const MIN_SIZE = 4;
const MAX_SIZE = 12;

/** このレベルに達したら盤面が 1 マス広がる（4×4 から 12×12 まで 9 段階） */
const SIZE_UPS = [1, 3, 5, 7, 10, 13, 17, 21, 26];

/** 形状が最も複雑になる（＝全部3個つなぎになる）レベル */
const MAX_COMPLEXITY_LEVEL = 46;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** レベル -> 盤面サイズ */
function boardSizeForLevel(level) {
  const lv = normalizeLevel(level);
  let size = MIN_SIZE - 1;
  for (const up of SIZE_UPS) if (lv >= up) size++;
  return Math.min(MAX_SIZE, size);
}

/**
 * レベル -> ブロックの複雑さの配合。
 *   single = テトロミノそのまま（4セル）
 *   double = テトロミノ2個つなぎ（8セル）
 *   triple = テトロミノ3個つなぎ（12セル）
 */
function shapeMixForLevel(level) {
  const lv = normalizeLevel(level);
  const single = clamp01(1 - (lv - 12) / 12); // L12 まで 1.0、L24 で 0
  const triple = clamp01((lv - 26) / 20);     // L26 から出現、L46 で 1.0
  const double = clamp01(1 - single - triple);
  return { single, double, triple };
}

/** レベル -> 生成シード。この一本道が「どの端末でも同じ譜面」を担保する */
function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/** レベルの各種パラメータ */
function levelConfig(level) {
  const lv = normalizeLevel(level);
  const size = boardSizeForLevel(lv);
  const mix = shapeMixForLevel(lv);
  const area = size * size;

  // 1ブロックあたりの平均セル数（4 / 8 / 12 の加重平均）
  const avgPiece = 4 * (mix.single + 2 * mix.double + 3 * mix.triple);
  const maxPiece = 4 * (mix.triple > 0 ? 3 : mix.double > 0 ? 2 : 1);

  // 大きいブロックほど詰めにくい（同色非隣接の制約が効くので実際に頭打ちになる）。
  // 到達できない目標を掲げると生成が延々とリトライして遅くなるだけなので、
  // 実測できる上限に沿って下げる: 4セル=80% / 8セル=74% / 12セル=68%
  const fill = 0.80 - 0.06 * (avgPiece / 4 - 1);
  const targetCells = Math.round(area * fill);

  // 上級では「1手でまとめて消える数」を増やして橋渡しを難しくする
  const hard = clamp01((lv - MAX_COMPLEXITY_LEVEL) / 40);
  const bigPiece = clamp01((avgPiece - 4) / 8);
  const partnerWeights = [
    0.45 + 0.35 * bigPiece - 0.15 * hard,
    0.40 - 0.25 * bigPiece + 0.05 * hard,
    0.15 - 0.10 * bigPiece + 0.10 * hard,
  ].map((w) => Math.max(0, w));

  return {
    level: lv,
    size,
    mix,
    avgPiece,
    maxPiece,
    colors: Math.max(3, Math.min(6, 3 + Math.floor((size - 4) / 2))),
    targetCells,
    minCells: Math.max(2 * maxPiece, Math.round(area * 0.42)),
    acceptSlack: maxPiece + 2,
    /** 大きいブロックは 1 回の試行が重いので、リトライ回数を抑える */
    attempts: avgPiece >= 10 ? 9 : avgPiece >= 8 ? 14 : 24,
    maxSteps: Math.ceil(targetCells / (2 * avgPiece)) + 4,
    minPar: size <= 6 ? 1 : size <= 9 ? 3 : 4,
    partnerWeights,
    /** 1 クラスあたり何種類の連結ピースを用意するか */
    poolSize: 6,
  };
}

/**
 * レベルのブロック集合を作る。
 * 「素のテトロミノ」「2個つなぎ」「3個つなぎ」をそれぞれ 1 クラスとし、
 * 配合比を重みとして返す。生成器は 1 ステップごとにクラスを抽選して使う。
 */
function buildLevelClasses(config) {
  const rng = makeRng((levelSeed(config.level) ^ 0x5bf03635) >>> 0);
  const classes = [];

  if (config.mix.single > 0.001) {
    classes.push({ kind: 'single', parts: 1, weight: config.mix.single, shapes: TETROMINOES });
  }

  for (const [kind, parts] of [['double', 2], ['triple', 3]]) {
    const weight = config.mix[kind];
    if (weight <= 0.001) continue;
    const shapes = [];
    const seen = new Set();
    for (let i = 0; i < config.poolSize * 6 && shapes.length < config.poolSize * 4; i++) {
      const shape = makeCompoundShape(rng, parts, config.size - 1);
      if (!shape) continue;
      for (const rot of rotationsOfShape(shape)) {
        const key = rot.cells.map(([x, y]) => `${x},${y}`).join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        shapes.push(rot);
      }
    }
    if (shapes.length > 0) classes.push({ kind, parts, weight, shapes });
  }

  // 万一どのクラスも作れなければテトロミノに落とす
  if (classes.length === 0) {
    classes.push({ kind: 'single', parts: 1, weight: 1, shapes: TETROMINOES });
  }
  return classes;
}

/** レベルの見出し文（実際に出てくる可能性が高いブロックだけを挙げる） */
function levelFlavor(config) {
  const { mix } = config;
  const parts = [];
  if (mix.single >= 0.15) parts.push('テトロミノ');
  if (mix.double >= 0.15) parts.push('2個つなぎ');
  if (mix.triple >= 0.15) parts.push('3個つなぎ');
  if (parts.length === 0) parts.push(mix.triple >= mix.double ? '3個つなぎ' : '2個つなぎ');
  return parts.join('＋');
}

// ===== src/generator.js =====
// パズル生成 ―「解の逆順構築」
//
// ランダムに埋めて解けるか検証する、という素朴な方法は使わない（80% 埋めはほぼ確実に詰む）。
// 代わりに完成状態（空盤面）から出発し、「ある 1 手でまとめて消えるブロック群」を
// 1 ステップずつ置いていく。最後に置いたステップが、解の第 1 手になる。
//
//   S_N = ∅（空盤面）← 逆順ステップ 1 ─ S_{N-1} ← ステップ 2 ─ … ← ステップ N ─ S_0（初期盤面）
//
// 各ステップで置くもの:
//   移動ブロック P : 色 c・形状・着地点 B・滑走方向 d・開始点 A (= B - t*d)
//   相棒ブロック Q : 同色 c。B にいる P に隣接し、Q 同士は非隣接
//
// 配置時の制約（それぞれが一つの保証に対応する）:
//   新規セルはすべて空き               -> ブロックの重複なし
//   既存の同色ブロックと隣接しない       -> 同色隣接ゼロ ＋ 予定外の巻き込み消去が起きない
//   A→B の経路が空 / B+d に壁かブロック -> その手が実行可能で、ちょうど B で止まる
//   A にいる時点で同色接触していない     -> 中間状態の不変条件が保たれる
//
// 結果として PAR（保証解の手数）と完全な解答手順が副産物として手に入る。

const DEFAULT_OPTIONS = {
  size: BOARD_SIZE,
  colors: COLOR_COUNT,
  /** 使用するブロックのクラス（形状集合と配合比）。レベルごとに差し替える */
  classes: [{ kind: 'single', parts: 1, weight: 1, shapes: TETROMINOES }],
  /** 目標の埋め率（セル数）。盤面の約 80% */
  targetCells: 120,
  /** これを下回る盤面は生成失敗として作り直す */
  minCells: 100,
  /** 目標にこれだけ届いていれば「十分良い」として打ち切る */
  acceptSlack: 4,
  /** 手数（PAR）の上限 */
  maxSteps: 16,
  /** これ未満の手数しかない盤面は物足りないので作り直す */
  minPar: 4,
  /** 1 ステップの相棒ブロック数（= 1手で消えるブロック数 - 1）の重み */
  partnerWeights: [0.45, 0.4, 0.15],
  /** 滑走距離の偏り。1 未満で「長い滑走」寄り、1 より大きいと短い滑走寄り */
  distanceBias: 0.85,
  /** 配置優先度のゆらぎ。0 だと常に最も詰まった場所へ置く（＝単調になる） */
  packingJitter: 3,
  /** 1 ステップあたりの探索予算 */
  budget: 26000,
  /** 生成全体のリトライ回数 */
  attempts: 24,
};

/** [x,y] 配列を「格子 index の Set」に */
function cellSet(size, cells) {
  const s = new Set();
  for (const [x, y] of cells) s.add(y * size + x);
  return s;
}

/** セル群の上下左右の隣接セルを Set に追加（盤外は無視） */
function addHalo(size, cells, target) {
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

/** 盤面上に置けるすべての「形状 × 位置」を列挙（空きマスのみ） */
function emptyPlacements(board, shapes) {
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
 * 相棒ブロック Q の候補をひとつ探す。
 * anchors のいずれかのセルを含み、すべての制約を満たす配置を返す（無ければ null）。
 */
function findPartner(board, rng, ctx, anchors) {
  const { size, color, shapes, blocked, forbiddenAdj } = ctx;
  const anchorList = shuffle(rng, [...anchors]);
  for (const anchor of anchorList) {
    const ax = anchor % size;
    const ay = (anchor - ax) / size;
    const shapeList = shuffle(rng, shapes.slice());
    for (const shape of shapeList) {
      const offsets = shuffle(rng, shape.cells.map((c, i) => i));
      for (const oi of offsets) {
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
          // 動かすブロック P（A 地点）や既に選んだ相棒に隣接してはいけない
          if (forbiddenAdj.has(gi)) { ok = false; break; }
          cells.push([x, y]);
        }
        if (!ok) continue;
        // 盤面上の同色ブロックと隣接してはいけない（予定外の巻き込み消去の防止）
        if (board.touchesColor(cells, color)) continue;
        return { shape, cells };
      }
    }
  }
  return null;
}

/**
 * 配置の「詰まり具合」。壁や既存ブロックに接しているほど高い。
 * これを優先して置くことで空きマスの断片化を防ぎ、埋め率を上げる。
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
 * 逆順構築の 1 ステップ。
 *
 * まずブロックのクラス（テトロミノ / 2個つなぎ / 3個つなぎ）を配合比で抽選し、
 * そのクラスだけで 1 ステップを組む。1 ステップ分のブロックはまとめて消える
 * 仲間なので、同じクラスで揃えると見た目のまとまりも良くなる。
 * 抽選したクラスで置けなければ、残りのクラスへ順に落としていく。
 */
function buildStep(board, rng, opts) {
  const order = weightedOrder(rng, opts.classes);
  for (let i = 0; i < order.length; i++) {
    const cls = order[i];
    // 第1候補には満額、フォールバックには控えめな探索予算を与える
    const budget = i === 0 ? opts.budget : Math.round(opts.budget * 0.35);
    const step = buildStepWithShapes(board, rng, opts, cls.shapes, budget);
    if (step) return { ...step, kind: cls.kind };
  }
  return null;
}

/** 重みつきの並べ替え（重みが大きいクラスほど前に来やすい） */
function weightedOrder(rng, classes) {
  const pool = classes.slice();
  const out = [];
  while (pool.length > 0) {
    let total = 0;
    for (const c of pool) total += Math.max(1e-6, c.weight);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= Math.max(1e-6, pool[i].weight);
      if (r < 0) { idx = i; break; }
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * 指定した形状集合だけで 1 ステップ組む。
 *
 * 探索は「開始点 A」から始める。A に置いたブロックが盤面に残るので、
 * A を詰まった場所から順に試すと空きマスが断片化しにくい。
 */
function buildStepWithShapes(board, rng, opts, shapes, budgetLimit) {
  const size = board.size;
  const placements = emptyPlacements(board, shapes);
  for (const p of placements) p.score = contactScore(board, p.cells) + rng() * opts.packingJitter;
  placements.sort((a, b) => b.score - a.score);
  let budget = budgetLimit;

  const used = new Array(opts.colors).fill(0);
  for (const p of board.pieces.values()) used[p.color]++;

  for (const placement of placements) {
    if (budget <= 0) break;
    const acells = placement.cells;

    // ---- 色を選ぶ（開始点 A で同色に触れない色だけ = 中間状態の不変条件） ----
    // 使用数の少ない色を優先し、6色がまんべんなく盤面に出るようにする
    const colorOrder = Array.from({ length: opts.colors }, (_, i) => i)
      .sort((a, b) => (used[a] + rng() * 2.5) - (used[b] + rng() * 2.5));
    for (const color of colorOrder) {
      if (--budget <= 0) break;
      if (board.touchesColor(acells, color)) continue;

      // ---- 滑走方向と距離を選ぶ ----
      for (const dir of shuffle(rng, DIR_KEYS.slice())) {
        const d = DIRS[dir];

        // A から d 方向へ何マス進めるか（= 経路が空である最大距離）
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
        // 着地点 B で既存の同色ブロックに触れてはいけない（予定外の巻き込み消去の防止）
        if (board.touchesColor(bcells, color)) continue;

        // ---- 掃過セル（A から B までに P が占める全セル）。相棒はここに置けない ----
        const blocked = new Set();
        for (let i = 0; i <= t; i++) {
          for (const [x, y] of acells) blocked.add((y + d.y * i) * size + (x + d.x * i));
        }

        // ---- ストッパー: B+d に壁か既存ブロックがあるか ----
        const bset = cellSet(size, bcells);
        let stopped = false;
        const front = new Set();
        for (const [x, y] of bcells) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { stopped = true; continue; }
          const gi = ny * size + nx;
          if (bset.has(gi)) continue;
          if (board.grid[gi] !== -1) { stopped = true; continue; }
          front.add(gi);
        }

        // ---- 相棒ブロックを選ぶ ----
        const forbiddenAdj = addHalo(size, acells, new Set());
        const ctx = { size, color, shapes, blocked, forbiddenAdj };
        const partners = [];

        // ストッパーが無い場合、相棒のひとつが B の進行方向側を塞ぐ必要がある
        if (!stopped) {
          if (front.size === 0) continue;
          const q = findPartner(board, rng, ctx, front);
          if (!q) { budget -= 3; continue; }
          partners.push(q);
          for (const [x, y] of q.cells) blocked.add(y * size + x);
          addHalo(size, q.cells, forbiddenAdj);
        }

        // 残りの相棒は B の P に隣接していればどこでもよい
        const want = 1 + weightedIndex(rng, opts.partnerWeights);
        if (partners.length < want) {
          const halo = addHalo(size, bcells, new Set());
          for (const gi of bset) halo.delete(gi);
          while (partners.length < want) {
            const q = findPartner(board, rng, ctx, halo);
            if (!q) break;
            partners.push(q);
            for (const [x, y] of q.cells) blocked.add(y * size + x);
            addHalo(size, q.cells, forbiddenAdj);
          }
        }
        budget -= 4;
        if (partners.length === 0) continue;

        // ---- 確定。盤面に追加する ----
        const moving = board.addPiece(color, acells, placement.shape.name, placement.shape.parts);
        let cells = placement.shape.size;
        for (const q of partners) {
          board.addPiece(color, q.cells, q.shape.name, q.shape.parts);
          cells += q.shape.size;
        }

        return {
          pieceId: moving.id,
          dir,
          distance: t,
          color,
          cleared: partners.length + 1,
          cells,
        };
      }
    }
  }
  return null;
}

/** 1 回分の生成試行 */
function attemptBuild(seed, opts) {
  const rng = makeRng(seed);
  const board = new Board(opts.size);
  const solution = [];
  let misses = 0;

  while (solution.length < opts.maxSteps && board.filledCells < opts.targetCells) {
    const step = buildStep(board, rng, opts);
    if (!step) {
      misses++;
      if (misses >= 2) break;
      continue;
    }
    // 逆順に作っているので、新しいステップほど「先の手」になる
    solution.unshift(step);
  }

  return { board, solution };
}

/**
 * 解けることが構造的に保証されたパズルを生成する。
 * @returns {{seed:number, snapshot:object, solution:Array, par:number, cells:number, pieces:number, size:number, colors:number}}
 */
function generatePuzzle(seed, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (!result) continue;
    if (!best || result.cells > best.cells) best = result;
    if (goodEnough(result, opts)) break;
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * generatePuzzle と同じものを、試行の合間にイベントループへ制御を返しながら作る。
 * 大きな連結ピースの盤面は生成に数百ミリ秒かかることがあるので、
 * UI 側はこちらを使って「生成中」を出しつつ画面を固めない。
 */
async function generatePuzzleAsync(seed, options = {}, onProgress = null) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let best = null;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const result = runAttempt(seed, opts, attempt);
    if (result && (!best || result.cells > best.cells)) best = result;
    if (result && goodEnough(result, opts)) break;
    if (onProgress) onProgress((attempt + 1) / opts.attempts);
    // 2 試行ごとに 1 フレーム譲る
    if (attempt % 2 === 1) await new Promise((r) => setTimeout(r, 0));
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/** 1 回分の試行を回して、検証を通った結果だけ返す */
function runAttempt(seed, opts, attempt) {
  // 試行ごとにシードを派生させる（同じ seed なら常に同じ結果）
  const derived = (seed + attempt * 0x9e3779b1) >>> 0;
  const { board, solution } = attemptBuild(derived, opts);
  if (solution.length === 0) return null;

  const snapshot = board.snapshot();
  if (!verifySolution(snapshot, solution, opts.size).ok) return null;

  return {
    seed: seed >>> 0,
    snapshot,
    solution,
    par: solution.length,
    cells: board.filledCells,
    pieces: board.pieceCount,
    size: opts.size,
    colors: opts.colors,
  };
}

function goodEnough(result, opts) {
  return result.cells >= opts.targetCells - opts.acceptSlack && result.par >= opts.minPar;
}

/**
 * レベル番号からパズルを作る。
 * レベル -> シード -> 決定論的な生成、という一本道なので、
 * 同じレベルなら、どの端末でも必ず同じ譜面になる。
 */
function generateLevel(level, overrides = {}) {
  const config = levelConfig(level);
  const classes = buildLevelClasses(config);
  const puzzle = generatePuzzle(levelSeed(config.level), levelOptions(config, classes, overrides));
  return { ...puzzle, level: config.level, config };
}

/** generateLevel の非同期版（画面を固めずに生成する） */
async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  const config = levelConfig(level);
  const classes = buildLevelClasses(config);
  const puzzle = await generatePuzzleAsync(
    levelSeed(config.level),
    levelOptions(config, classes, overrides),
    onProgress,
  );
  return { ...puzzle, level: config.level, config };
}

function levelOptions(config, classes, overrides) {
  return {
    size: config.size,
    colors: config.colors,
    classes,
    targetCells: config.targetCells,
    minCells: config.minCells,
    acceptSlack: config.acceptSlack,
    maxSteps: config.maxSteps,
    minPar: config.minPar,
    partnerWeights: config.partnerWeights,
    attempts: config.attempts,
    ...overrides,
  };
}

/**
 * 生成された解答手順を前から実行して、本当に全消しできるか確かめる。
 * 生成ロジックのバグをここで必ず捕まえる（テストからも使用）。
 */
function verifySolution(snapshot, solution, size = BOARD_SIZE) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }

  for (let i = 0; i < solution.length; i++) {
    const step = solution[i];
    if (!board.pieces.has(step.pieceId)) {
      return { ok: false, reason: `手 ${i + 1}: ブロックが存在しない` };
    }
    const before = board.pieceCount;
    const res = board.applyMove(step.pieceId, step.dir);
    if (!res) return { ok: false, reason: `手 ${i + 1}: 動かせない` };
    if (res.steps !== step.distance) {
      return { ok: false, reason: `手 ${i + 1}: 停止位置が想定と違う (${res.steps} != ${step.distance})` };
    }
    if (res.cleared.length !== step.cleared) {
      return { ok: false, reason: `手 ${i + 1}: 消去数が想定と違う (${res.cleared.length} != ${step.cleared})` };
    }
    if (board.pieceCount !== before - step.cleared) {
      return { ok: false, reason: `手 ${i + 1}: 盤面のブロック数が合わない` };
    }
    if (board.hasSameColorContact()) {
      return { ok: false, reason: `手 ${i + 1} の直後に同色接触が残っている` };
    }
  }

  if (!board.isEmpty) {
    return { ok: false, reason: `解答を実行しても ${board.pieceCount} 個残る` };
  }
  return { ok: true };
}

/** 生成器の内部関数（テスト用） */
const __internals = { emptyPlacements, buildStep, attemptBuild };

// ===== src/render.js =====
// Canvas 描画。盤面・粘土ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックは「粘土」として描く:
//   下に色付きのやわらかい影 → 斜めのグラデーションで塊感 → 内側の上左に光、
//   下右に翳り → 表面に細かいざらつき（グレイン） → 縁取り線は引かない。
// マットで、押したらへこみそうな質感を目指している。UI 側がガラスで退いているぶん、
// ここだけが主役として前に出る。

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

/**
 * 6色の粘土。彩度を落としすぎず、明度差で見分けられるようにしてある。
 * light=光が当たる面 / base=素の色 / dark=翳り / shadow=下に落ちる色付きの影
 */
const PALETTE = [
  { name: '赤', base: '#ff6d80', light: '#ff98a6', dark: '#dd3f56', shadow: '206,52,74' },
  { name: '橙', base: '#ff9d45', light: '#ffbe7d', dark: '#e0741a', shadow: '204,105,20' },
  { name: '黄', base: '#ffcd3d', light: '#ffe07d', dark: '#dfa406', shadow: '199,148,8' },
  { name: '緑', base: '#3fcf93', light: '#77e0b4', dark: '#1ba471', shadow: '20,150,102' },
  { name: '青', base: '#54a9f5', light: '#8cc6f9', dark: '#2a7ed6', shadow: '32,116,196' },
  { name: '紫', base: '#a488ee', light: '#c1adf4', dark: '#7b56dd', shadow: '110,76,200' },
];

/** 色覚サポート用の記号 */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.6 * Math.pow(t - 1, 2);

/** 上端が外側になっているセルを、横につながった並びごとにまとめる */
function topRuns(rects) {
  const tops = rects.filter((p) => !p.up).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const runs = [];
  let cur = null;
  for (const p of tops) {
    if (cur && cur.row === p.y && cur.lastX === p.x - 1) {
      cur.x1 = p.px + p.pw;
      cur.lastX = p.x;
      continue;
    }
    cur = { row: p.y, y: p.py, x0: p.px, x1: p.px + p.pw, lastX: p.x };
    runs.push(cur);
  }
  return runs;
}

/** 粘土のざらつき。一度だけ作って使い回す */
function makeGrain() {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 74;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
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
    this.rings = [];
    this.texts = [];
    this.flashes = [];
    this.shake = 0;
    this.time = 0;

    this.options = { symbols: false, ghost: true, calm: false };

    this.grain = makeGrain();
    this.grainPattern = this.ctx.createPattern(this.grain, 'repeat');

    this.dark = false;
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) {
      this.dark = mq.matches;
      const onChange = (e) => { this.dark = e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
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

    // 盤面は正方形。影がはみ出せるよう外周に余白を取る
    const cell = Math.floor((Math.min(w, h) - 24) / this.size);
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
    this.grainPattern = this.ctx.createPattern(this.grain, 'repeat');
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

  /** 粘土のかけらが飛び散る */
  burst(cells, colorIndex) {
    const c = PALETTE[colorIndex];
    const n = this.options.calm ? 3 : 8;
    for (const [cx, cy] of cells) {
      const p = this.cellCenter(cx, cy);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.5 + Math.random() * 2.8) * this.cell * 0.06;
        const white = Math.random() < 0.16;
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * this.cell * 0.6,
          y: p.y + (Math.random() - 0.5) * this.cell * 0.6,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - this.cell * 0.03,
          g: this.cell * 0.011,
          life: 1,
          decay: 0.016 + Math.random() * 0.018,
          size: this.cell * (white ? 0.06 : 0.11 + Math.random() * 0.2),
          radius: 0.34,
          color: white ? '#ffffff' : (Math.random() < 0.4 ? c.light : c.base),
          spin: (Math.random() - 0.5) * 0.34,
          rot: Math.random() * Math.PI,
        });
      }
    }
  }

  ring(x, y, colorIndex, strength = 1) {
    this.rings.push({
      x, y,
      r: this.cell * 0.35,
      maxR: this.cell * (2 + strength * 1.4),
      life: 1,
      color: PALETTE[colorIndex].shadow,
    });
  }

  /** 消えた瞬間の白いフラッシュ（報酬のトリガー） */
  flash(x, y, strength = 1) {
    if (this.options.calm) return;
    this.flashes.push({ x, y, r: this.cell * (2.4 + strength * 1.6), life: 1 });
  }

  floatText(x, y, text, sub, color) {
    this.texts.push({ x, y, text, sub, color, life: 1, vy: -0.5 });
  }

  addShake(amount) {
    if (this.options.calm) amount *= 0.3;
    this.shake = Math.min(22, this.shake + amount);
  }

  clearEffects() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.flashes.length = 0;
    this.shake = 0;
  }

  // ---------------------------------------------------------------- 描画

  draw(view, dt) {
    const ctx = this.ctx;
    this.time += dt;

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
    if (view.hint) this.drawHint(view);

    this.drawRings(dt);
    this.drawFlashes(dt);
    this.drawParticles(dt);
    this.drawTexts(dt);

    ctx.restore();
  }

  /** 盤面＝粘土を並べるマット。空きマスはくぼみとして見せる */
  drawTray(board) {
    const ctx = this.ctx;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    const x0 = this.ox;
    const y0 = this.oy;
    const pad = Math.max(6, cell * 0.16);
    const dark = this.dark;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, Math.max(16, cell * 0.5));
    const g = ctx.createLinearGradient(x0, y0 - pad, x0, y0 + w + pad);
    if (dark) {
      g.addColorStop(0, 'rgba(255,255,255,.06)');
      g.addColorStop(1, 'rgba(255,255,255,.02)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,.6)');
      g.addColorStop(1, 'rgba(255,255,255,.3)');
    }
    ctx.fillStyle = g;
    ctx.shadowColor = dark ? 'rgba(0,0,0,.5)' : 'rgba(70,80,150,.16)';
    ctx.shadowBlur = cell * 0.7;
    ctx.shadowOffsetY = cell * 0.16;
    ctx.fill();
    ctx.restore();

    // 空きマス（＝通路）。少しくぼんで見えるように上に影、下に光
    ctx.save();
    const r = Math.max(3, cell * 0.26);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        const px = x0 + x * cell + cell * 0.09;
        const py = y0 + y * cell + cell * 0.09;
        const s = cell - cell * 0.18;
        ctx.beginPath();
        ctx.roundRect(px, py, s, s, r);
        ctx.fillStyle = dark ? 'rgba(0,0,0,.3)' : 'rgba(112,124,190,.11)';
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(px, py + Math.max(1, cell * 0.035), s, s, r);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.5)';
        ctx.lineWidth = Math.max(1, cell * 0.035);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawPieces(view) {
    const { board, anim, selected, invalid } = view;
    if (!board) return;

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
          this.drawTrail(piece, d, anim, p);
        } else if (anim.phase === 'land') {
          // 進行方向につぶれて戻る（粘土がぶつかった手応え）
          squash = Math.sin(anim.t * Math.PI) * 0.16;
        }
      }

      if (invalid && invalid.pieceId === piece.id) {
        const d = DIRS[invalid.dir];
        const k = Math.sin(invalid.t * Math.PI * 6) * (1 - invalid.t) * this.cell * 0.16;
        dx += d.x * k;
        dy += d.y * k;
      }

      const axis = anim && anim.pieceId === piece.id ? anim.dir : null;
      this.drawPiece(piece, dx, dy, 1, squash, selected === piece.id, 'solid', axis);
    }
  }

  drawTrail(piece, d, anim, p) {
    const ctx = this.ctx;
    const c = PALETTE[piece.color];
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
          this.ox + cx * cell + dx + cell * 0.08,
          this.oy + cy * cell + dy + cell * 0.08,
          cell * 0.84, cell * 0.84, cell * 0.3,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** ブロックのセル矩形を組み立てる（同じブロックの隣とは継ぎ目なく繋がる） */
  cellRects(piece, dx, dy) {
    const cell = this.cell;
    const own = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
    const has = (x, y) => own.has(`${x},${y}`);
    const pad = Math.max(1.2, cell * 0.075);
    const r = Math.max(3, cell * 0.34);

    const out = [];
    for (const [x, y] of piece.cells) {
      const up = has(x, y - 1);
      const down = has(x, y + 1);
      const left = has(x - 1, y);
      const right = has(x + 1, y);
      out.push({
        x, y, up, down, left, right,
        px: this.ox + x * cell + dx + (left ? 0 : pad),
        py: this.oy + y * cell + dy + (up ? 0 : pad),
        pw: cell - (left ? 0 : pad) - (right ? 0 : pad),
        ph: cell - (up ? 0 : pad) - (down ? 0 : pad),
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

  pathOf(rects) {
    const path = new Path2D();
    for (const p of rects) path.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
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
   * 粘土ブロック本体。
   * @param {string} mode 'solid' | 'outline'
   * @param {string|null} axis つぶれる向き（着地アニメ用）
   */
  drawPiece(piece, dx = 0, dy = 0, alpha = 1, squash = 0, selected = false, mode = 'solid', axis = null) {
    const ctx = this.ctx;
    const cell = this.cell;
    const c = PALETTE[piece.color];
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

    const path = this.pathOf(rects);
    const outline = this.outlineOf(rects, Math.max(3, cell * 0.34));

    if (mode === 'outline') {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = c.base;
      ctx.setLineDash([cell * 0.26, cell * 0.2]);
      ctx.lineCap = 'round';
      ctx.stroke(this.outlineOf(rects, Math.max(3, cell * 0.34)));
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 1) 下に落ちる色付きの影
    ctx.save();
    ctx.shadowColor = `rgba(${c.shadow},${this.dark ? 0.5 : 0.42})`;
    ctx.shadowBlur = cell * 0.42;
    ctx.shadowOffsetY = cell * 0.16;
    ctx.fillStyle = c.dark;
    ctx.fill(path);
    ctx.restore();

    // 2) 本体（斜めのグラデーションで塊に見せる）
    const grad = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    grad.addColorStop(0, c.light);
    grad.addColorStop(0.42, c.base);
    grad.addColorStop(1, c.dark);
    ctx.fillStyle = grad;
    ctx.fill(path);

    // 3) 内側の陰影とざらつき
    ctx.save();
    ctx.clip(path);

    const rTL = ctx.createRadialGradient(
      box.x0 + box.w * 0.16, box.y0 + box.h * 0.14, 0,
      box.x0 + box.w * 0.16, box.y0 + box.h * 0.14, Math.max(box.w, box.h) * 0.92,
    );
    rTL.addColorStop(0, 'rgba(255,255,255,.24)');
    rTL.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rTL;
    ctx.fillRect(box.x0, box.y0, box.w, box.h);

    const rBR = ctx.createRadialGradient(
      box.x1 - box.w * 0.1, box.y1 - box.h * 0.06, 0,
      box.x1 - box.w * 0.1, box.y1 - box.h * 0.06, Math.max(box.w, box.h) * 0.78,
    );
    rBR.addColorStop(0, `rgba(${c.shadow},.34)`);
    rBR.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rBR;
    ctx.fillRect(box.x0, box.y0, box.w, box.h);

    if (this.grainPattern && cell > 12) {
      ctx.globalAlpha = alpha * 0.09;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
    }

    // 外周のふちに光をひとすじ。クリップしているので内側半分だけ残る
    ctx.lineWidth = Math.max(1.5, cell * 0.12);
    ctx.strokeStyle = 'rgba(255,255,255,.34)';
    ctx.stroke(outline);

    // てっぺんの平らな面のツヤ（横一続きごとに 1 本）
    ctx.globalAlpha = alpha * 0.26;
    ctx.fillStyle = '#ffffff';
    for (const run of topRuns(rects)) {
      const w = run.x1 - run.x0;
      if (w <= cell * 0.6) continue;
      ctx.beginPath();
      ctx.roundRect(run.x0 + cell * 0.24, run.y + cell * 0.15, w - cell * 0.48, cell * 0.09, cell * 0.045);
      ctx.fill();
    }
    ctx.restore();

    // 4) 連結ピースの継ぎ目
    this.drawSeams(piece, dx, dy, alpha);

    // 5) 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.34;
      ctx.fillStyle = 'rgba(0,0,0,.9)';
      ctx.font = `700 ${Math.floor(cell * 0.44)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SYMBOLS[piece.color], this.ox + (ax + 0.5) * cell + dx, this.oy + (ay + 0.55) * cell + dy);
      ctx.restore();
    }

    // 6) 選択中はやわらかい白い光をまとう
    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.5);
      ctx.save();
      ctx.globalAlpha = alpha * (0.45 + 0.4 * pulse);
      ctx.lineWidth = Math.max(2, cell * 0.075);
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,255,255,.9)';
      ctx.shadowBlur = cell * (0.35 + 0.3 * pulse);
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

  /** 連結ピースの内部境界（元のテトロミノ同士の境目）。粘土をくっつけた継ぎ目 */
  drawSeams(piece, dx, dy, alpha) {
    const parts = piece.parts;
    if (!parts) return;
    let multi = false;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] !== parts[0]) { multi = true; break; }
    }
    if (!multi) return;

    const ctx = this.ctx;
    const cell = this.cell;
    const index = new Map();
    for (let i = 0; i < piece.cells.length; i++) {
      index.set(`${piece.cells[i][0]},${piece.cells[i][1]}`, parts[i]);
    }

    ctx.save();
    ctx.globalAlpha = alpha * 0.3;
    ctx.lineCap = 'round';
    const inset = cell * 0.2;
    for (const pass of [
      { color: 'rgba(0,0,0,.5)', off: 0 },
      { color: 'rgba(255,255,255,.6)', off: Math.max(1, cell * 0.04) },
    ]) {
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = Math.max(1, cell * 0.035);
      ctx.beginPath();
      for (let i = 0; i < piece.cells.length; i++) {
        const [x, y] = piece.cells[i];
        const px = this.ox + x * cell + dx;
        const py = this.oy + y * cell + dy;
        const right = index.get(`${x + 1},${y}`);
        const below = index.get(`${x},${y + 1}`);
        if (right !== undefined && right !== parts[i]) {
          ctx.moveTo(px + cell + pass.off, py + inset);
          ctx.lineTo(px + cell + pass.off, py + cell - inset);
        }
        if (below !== undefined && below !== parts[i]) {
          ctx.moveTo(px + inset, py + cell + pass.off);
          ctx.lineTo(px + cell - inset, py + cell + pass.off);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
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
    const col = ghost.willClear ? '#ffb340' : (this.dark ? 'rgba(255,255,255,.8)' : 'rgba(40,44,80,.55)');

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
      ctx.strokeStyle = '#ffb340';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.shadowColor = 'rgba(255,179,64,.8)';
      ctx.shadowBlur = cell * 0.4;
      for (const id of ghost.clearIds) {
        const p = view.board.pieces.get(id);
        if (!p || p.id === piece.id) continue;
        const r2 = this.cellRects(p, 0, 0);
        ctx.stroke(this.outlineOf(r2, Math.max(3, cell * 0.34)));
      }
    }
    ctx.restore();
  }

  /** ヒント: 金色の脈動 + 方向矢印 */
  drawHint(view) {
    const { hint, board } = view;
    const piece = board.pieces.get(hint.pieceId);
    if (!piece) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5);

    ctx.save();
    ctx.globalAlpha = 0.45 + 0.5 * pulse;
    ctx.strokeStyle = '#ffb340';
    ctx.lineWidth = Math.max(2.5, cell * 0.1);
    ctx.shadowColor = 'rgba(255,179,64,.9)';
    ctx.shadowBlur = cell * 0.6;
    ctx.stroke(this.outlineOf(this.cellRects(piece, 0, 0), Math.max(3, cell * 0.34)));
    ctx.restore();

    const d = DIRS[hint.dir];
    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const base = this.cellCenter(cxs, cys);
    const off = cell * (0.9 + 0.35 * pulse);
    const ax = base.x + d.x * off;
    const ay = base.y + d.y * off;
    const s = cell * 0.38;

    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * pulse;
    ctx.fillStyle = '#ffb340';
    ctx.shadowColor = 'rgba(255,179,64,.9)';
    ctx.shadowBlur = cell * 0.5;
    ctx.beginPath();
    ctx.moveTo(ax + d.x * s, ay + d.y * s);
    ctx.lineTo(ax - d.x * s * 0.4 + d.y * s * 0.7, ay - d.y * s * 0.4 + d.x * s * 0.7);
    ctx.lineTo(ax - d.x * s * 0.4 - d.y * s * 0.7, ay - d.y * s * 0.4 - d.x * s * 0.7);
    ctx.closePath();
    ctx.fill();
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
      ctx.globalAlpha = r.life * 0.5;
      ctx.strokeStyle = `rgba(${r.color},1)`;
      ctx.lineWidth = Math.max(1.5, this.cell * 0.17 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
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

  drawTexts(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= 0.014 * k;
      t.y += t.vy * k;
      t.vy *= Math.pow(0.965, k);
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      const appear = Math.min(1, (1 - t.life) * 5);
      const scale = easeOutBack(appear);
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life * 2.4);
      ctx.translate(t.x, t.y);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, this.cell * 0.22);
      ctx.strokeStyle = this.dark ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.94)';
      ctx.font = `800 ${Math.floor(this.cell * 0.82)}px ${UI_FONT}`;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = `800 ${Math.floor(this.cell * 0.52)}px ${UI_FONT}`;
        ctx.strokeText(t.sub, 0, this.cell * 0.8);
        ctx.fillStyle = this.dark ? '#ffc453' : '#d9821a';
        ctx.fillText(t.sub, 0, this.cell * 0.8);
      }
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
// 狙い:
//   着地音  マリンバのような丸い「コトン」。置く行為そのものを心地よいリズムにする
//   消去音  氷が砕けるような「シャラン」。溜まったものが解ける爽快感
//   連鎖音  連続で消すたびに音程が階段状に上がる。「次の音が聴きたい」を作る
//
// iOS は最初のタップまで音を出せないので、unlock() を最初のポインタ操作で呼ぶ。

/** 音程の階段（ペンタトニック：外れた感じにならず、上がり続けても心地よい） */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = true;
    this.haptics = true;
  }

  /** 最初のユーザー操作で呼ぶ。以降いつでも鳴らせるようになる */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
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

    // ノイズは使い回す（砕ける音とアタックの芯に使う）
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get ready() {
    return this.enabled && this.ctx && this.master;
  }

  /** 単音。type と包絡を指定して鳴らす */
  tone(freq, { type = 'sine', gain = 0.2, attack = 0.004, decay = 0.25, delay = 0, detune = 0 } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
  }

  /** ノイズをフィルタ越しに一瞬だけ */
  burst({ gain = 0.12, decay = 0.14, delay = 0, hp = 1200, q = 0.7 } = {}) {
    if (!this.ready || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
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

  /** ブロックをつかんだ合図 */
  tap() {
    this.tone(660, { type: 'sine', gain: 0.055, decay: 0.07 });
  }

  /** 滑って壁にぶつかった瞬間。距離が長いほど低く重い音 */
  land(distance = 1) {
    const f = 300 - Math.min(distance, 8) * 14;
    this.tone(f, { type: 'triangle', gain: 0.18, decay: 0.2 });
    this.tone(f * 3.02, { type: 'sine', gain: 0.05, decay: 0.1 });
    this.burst({ gain: 0.05, decay: 0.05, hp: 1800 });
    this.vibrate(8);
  }

  /**
   * 消えた瞬間。連鎖数 combo が増えるほど音程が上がっていく。
   * @param {number} combo 0 から始まる連続消しの回数
   * @param {number} pieces まとめて消えたブロック数（多いほど厚みを増す）
   */
  pop(combo = 0, pieces = 2) {
    const step = LADDER[Math.min(combo, LADDER.length - 1)];
    const root = 523.25 * Math.pow(2, step / 12); // C5 から上へ
    this.tone(root, { type: 'sine', gain: 0.2, decay: 0.34 });
    this.tone(root * 1.5, { type: 'sine', gain: 0.11, decay: 0.28, delay: 0.012 });
    this.tone(root * 2.02, { type: 'sine', gain: 0.07, decay: 0.22, delay: 0.024 });
    this.burst({ gain: 0.1, decay: 0.18, hp: 2600 });
    if (pieces >= 3) {
      this.tone(root * 3, { type: 'sine', gain: 0.06, decay: 0.3, delay: 0.05 });
      this.burst({ gain: 0.07, decay: 0.24, hp: 3800, delay: 0.05 });
    }
    this.vibrate(pieces >= 3 ? [12, 26, 16] : 14);
  }

  /** 動かせない方向。低く短く突き放す */
  invalid() {
    this.tone(120, { type: 'sine', gain: 0.12, decay: 0.1 });
    this.vibrate([10, 40, 10]);
  }

  /** 全消し。上がっていくアルペジオ */
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone(f, { type: 'sine', gain: 0.2, decay: 0.5, delay: i * 0.09 });
      this.tone(f * 2, { type: 'sine', gain: 0.06, decay: 0.4, delay: i * 0.09 });
    });
    this.burst({ gain: 0.08, decay: 0.5, hp: 2600, delay: 0.25 });
    this.vibrate([16, 40, 16, 40, 30]);
  }

  /** 詰み。下がっていく2音 */
  dead() {
    this.tone(330, { type: 'triangle', gain: 0.16, decay: 0.28 });
    this.tone(247, { type: 'triangle', gain: 0.16, decay: 0.5, delay: 0.14 });
    this.vibrate([30, 60, 30]);
  }

  /** 1手戻した合図 */
  undo() {
    this.tone(392, { type: 'sine', gain: 0.1, decay: 0.14 });
    this.tone(294, { type: 'sine', gain: 0.1, decay: 0.2, delay: 0.06 });
  }

  vibrate(pattern) {
    if (!this.haptics) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* 非対応端末は黙って無視 */ }
    }
  }
}

// ===== src/game.js =====
// ゲーム進行・アニメーション・UI 配線。

/**
 * 大量消去の段階評価（セル数）。
 * 色はライト／ダークどちらの背景でも読めるよう中間の明度に寄せてある
 * （縁取りは背景と反対色を敷くので、これで両方に耐える）。
 */
const TIERS = [
  { cells: 20, label: 'ミラクル!!!', color: '#e0388f' },
  { cells: 16, label: 'ファンタスティック!!', color: '#e08a00' },
  { cells: 12, label: 'グレイト!', color: '#0f9d63' },
];

const STORE_KEY = 'slidepop.v2';

function tierOf(cells) {
  for (const t of TIERS) if (cells >= t.cells) return t;
  return null;
}

/** 盤面に実際に置かれているブロックの構成を一言で */
function pieceKindLabel(board) {
  const sizes = new Set();
  for (const p of board.pieces.values()) sizes.add(p.cells.length);
  const label = (n) => (n <= 4 ? 'テトロミノ' : n <= 8 ? '2個つなぎ' : '3個つなぎ');
  const names = [...sizes].sort((a, b) => a - b).map(label);
  return [...new Set(names)].join('＋');
}

/** レベル選択画面に出す、遊ぶ前のプレビュー文 */
function levelPreview(level) {
  const cfg = levelConfig(level);
  const mix = cfg.mix;
  const parts = [];
  if (mix.single > 0.001) parts.push(`テトロミノ ${Math.round(mix.single * 100)}%`);
  if (mix.double > 0.001) parts.push(`2個つなぎ ${Math.round(mix.double * 100)}%`);
  if (mix.triple > 0.001) parts.push(`3個つなぎ ${Math.round(mix.triple * 100)}%`);
  return `${cfg.size}×${cfg.size} ／ ${cfg.colors}色 ／ ${parts.join(' ・ ')}`;
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
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
    this.settings = Object.assign(
      { sound: true, haptics: true, symbols: false, ghost: true, calm: false },
      this.store.settings || {},
    );
    this.sound = new Sound();

    this.puzzle = null;
    this.solutionMap = new Map();
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.status = 'loading';
    this.level = 1;
    this.loadToken = 0;

    this.anim = null;
    this.invalid = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    this.newRecord = false;
    this.initialCells = 0;
    this.activeColors = [];
    /** 連続で消せた回数。増えるほど消去音の音程が上がる */
    this.combo = 0;

    this.applySettings();
    this.bindUi();
    this.bindInput();

    const ro = new ResizeObserver(() => this.renderer.resize(this.board.size));
    ro.observe(dom.canvas);
    window.addEventListener('resize', () => this.renderer.resize(this.board.size));

    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ パズル

  /**
   * レベルを読み込む。
   * 大きな連結ピースの盤面は生成に少し時間がかかるので、非同期版を使って
   * 「生成中」を出しながら待つ（画面が固まらない）。
   */
  async load(level) {
    const lv = normalizeLevel(level);
    const token = ++this.loadToken;

    this.status = 'loading';
    this.anim = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;
    this.renderer.clearEffects();
    this.showLoading(lv);
    this.updateHud();
    // 生成を始める前に 1 フレーム譲り、「組み立て中」を確実に描かせる
    await new Promise((r) => requestAnimationFrame(r));
    if (token !== this.loadToken) return;

    let puzzle;
    try {
      puzzle = await generateLevelAsync(lv);
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
    this.initialCells = puzzle.cells;
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.combo = 0;
    this.status = 'playing';

    this.store.lastLevel = lv;
    saveStore(this.store);

    // このレベルに登場する色（レジェンドはこれだけを並べる）
    this.activeColors = [...new Set([...this.board.pieces.values()].map((p) => p.color))]
      .sort((a, b) => a - b);
    if (this.dom.legend) this.dom.legend.innerHTML = '';

    this.buildSolutionMap();
    this.renderer.resize(this.board.size);
    this.hideOverlay();
    this.updateHud();
    location.hash = `#L${lv}`;
  }

  /** 到達したことのある最大レベル（未クリアでも「開いたことがある」で更新） */
  get bestLevel() {
    return Math.max(1, this.store.bestLevel || 1);
  }

  showLoading(level) {
    const cfg = levelConfig(level);
    this.showOverlay({
      badge: '🧊',
      title: `レベル ${level}`,
      text: `${cfg.size}×${cfg.size} の盤面を組み立てています…`,
      stats: [],
      actions: [],
    });
  }

  /**
   * 保証解をたどり、各局面の指紋 -> 次の手 の対応表を作る。
   * プレイヤーが解の道筋に乗っている間は、この表からヒントを出せる。
   */
  buildSolutionMap() {
    this.solutionMap.clear();
    const sim = new Board(this.puzzle.size);
    sim.restore(this.puzzle.snapshot);
    for (const step of this.puzzle.solution) {
      this.solutionMap.set(sim.fingerprint(), step);
      sim.applyMove(step.pieceId, step.dir);
    }
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
    this.hintsUsed = 0;
    this.combo = 0;
    this.status = 'playing';
    this.selected = null;
    this.ghost = null;
    this.hint = null;
    this.anim = null;
    this.hideOverlay();
    this.updateHud();
    this.toast('最初からやり直します');
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

    this.hint = null;
    this.ghost = null;
    this.selected = pieceId;
    this.moves++;

    this.board.movePiece(pieceId, dir, steps);
    this.anim = {
      phase: 'slide',
      pieceId,
      dir,
      steps,
      t: 0,
      duration: Math.min(0.36, 0.1 + steps * 0.033),
    };
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

  /** 消去の演出と実行 */
  doClear(group) {
    const pieces = group.map((id) => this.board.pieces.get(id)).filter(Boolean);
    if (pieces.length < 2) { this.anim = null; this.afterMove(); return; }

    this.combo++;

    let cells = 0;
    let sx = 0;
    let sy = 0;
    for (const p of pieces) {
      this.renderer.burst(p.cells, p.color);
      for (const [x, y] of p.cells) {
        sx += x + 0.5;
        sy += y + 0.5;
        cells++;
      }
    }
    const center = this.renderer.cellCenter(sx / cells - 0.5, sy / cells - 0.5);
    const color = pieces[0].color;
    this.renderer.ring(center.x, center.y, color, pieces.length);
    this.renderer.flash(center.x, center.y, pieces.length / 2);
    this.renderer.addShake(2.5 + cells * 0.5);
    this.sound.pop(this.combo - 1, pieces.length);

    const tier = tierOf(cells);
    let sub = tier ? tier.label : null;
    if (this.combo >= 2) sub = sub ? `${sub}  ${this.combo}コンボ` : `${this.combo}コンボ!`;
    // 段階評価が無いときは、消えた粘土の色そのままで祝う
    const textColor = tier ? tier.color : PALETTE[color].dark;
    this.renderer.floatText(center.x, center.y, `${cells}個消し！`, sub, textColor);

    for (const id of group) this.board.removePiece(id);
    this.selected = null;
    this.anim = null;
    this.afterMove();
  }

  afterMove() {
    this.updateHud();
    if (this.board.isEmpty) {
      this.status = 'won';
      this.recordResult();
      this.sound.win();
      setTimeout(() => this.showWin(), 640);
      return;
    }
    if (this.board.isDeadlock()) {
      this.status = 'dead';
      this.sound.dead();
      setTimeout(() => this.showDead(), 380);
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
    this.hint = null;
    this.renderer.clearEffects();
    this.hideOverlay();
    this.updateHud();
  }

  showHint() {
    if (!this.canInteract()) return;
    const step = this.solutionMap.get(this.board.fingerprint());
    if (step) {
      this.hint = { pieceId: step.pieceId, dir: step.dir };
      this.hintsUsed++;
      this.toast(`保証解の第${this.moves + 1}手：${step.cleared}個まとめて消えます`);
      this.updateHud();
      return;
    }
    const moves = this.board.findClearingMoves();
    if (moves.length > 0) {
      const best = moves[0];
      this.hint = { pieceId: best.id, dir: best.dir };
      this.hintsUsed++;
      this.toast(`${best.cleared.length}個（${best.clearedCells}マス）消せる手があります`);
      this.updateHud();
      return;
    }
    this.toast('いま消せる手はありません。「戻す」で組み立て直しましょう');
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
        if (id != null) {
          this.hint = null;
          this.sound.tap();
        }
      },
      onPreview: (id, dir) => this.setGhost(id, dir),
      onCommit: (id, dir) => this.tryMove(id, dir),
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key;
      const arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (arrows[key]) {
        e.preventDefault();
        if (this.selected != null) this.tryMove(this.selected, arrows[key]);
        else this.toast('先にブロックをクリックして選んでください');
        return;
      }
      const k = key.toLowerCase();
      if (k === 'z' || k === 'u' || k === 'backspace') { e.preventDefault(); this.undo(); }
      else if (k === 'h') { e.preventDefault(); this.showHint(); }
      else if (k === 'r') { e.preventDefault(); this.restart(); }
      else if (k === 'l') { e.preventDefault(); this.openLevelPicker(); }
      else if (k === 'escape') { this.selected = null; this.ghost = null; this.closeModals(); }
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
    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnHint.addEventListener('click', () => this.showHint());
    d.btnRestart.addEventListener('click', () => this.restart());
    d.btnLevels.addEventListener('click', () => this.openLevelPicker());
    d.btnRules.addEventListener('click', () => this.openModal(d.modalRules));
    d.btnSettings.addEventListener('click', () => this.openModal(d.modalSettings));

    for (const modal of [d.modalRules, d.modalSettings, d.modalLevels]) {
      modal.addEventListener('click', (e) => {
        // 閉じるボタンの中身（SVG）が押されることもあるので closest で辿る
        if (e.target === modal || (e.target.closest && e.target.closest('[data-close]'))) {
          this.closeModals();
        }
      });
    }

    const toggles = {
      sound: d.optSound,
      haptics: d.optHaptics,
      symbols: d.optSymbols,
      ghost: d.optGhost,
      calm: d.optCalm,
    };
    for (const [key, el] of Object.entries(toggles)) {
      if (!el) continue;
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => {
        this.settings[key] = el.checked;
        this.applySettings();
        this.store.settings = this.settings;
        saveStore(this.store);
        if (key === 'sound' && el.checked) { this.sound.unlock(); this.sound.tap(); }
      });
    }

    const stepLevel = (delta) => {
      const v = Math.max(1, (parseInt(d.levelInput.value, 10) || 1) + delta);
      d.levelInput.value = String(v);
      this.updateLevelPreview();
    };
    d.btnLevelPrev.addEventListener('click', () => stepLevel(-1));
    d.btnLevelNext.addEventListener('click', () => stepLevel(1));
    d.levelInput.addEventListener('input', () => this.updateLevelPreview());
    d.levelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') d.btnLevelGo.click();
    });
    d.btnLevelGo.addEventListener('click', () => {
      const lv = Math.max(1, parseInt(d.levelInput.value, 10) || 1);
      this.closeModals();
      this.load(lv);
    });
    d.btnLevelBest.addEventListener('click', () => {
      d.levelInput.value = String(this.bestLevel);
      this.updateLevelPreview();
      this.closeModals();
      this.load(this.bestLevel);
    });
    d.btnShare.addEventListener('click', () => this.share());
  }

  openLevelPicker() {
    this.dom.levelInput.value = String(this.level);
    this.updateLevelPreview();
    this.dom.btnLevelBest.disabled = this.bestLevel === this.level;
    this.openModal(this.dom.modalLevels);
  }

  updateLevelPreview() {
    const lv = Math.max(1, parseInt(this.dom.levelInput.value, 10) || 1);
    this.dom.levelPreview.textContent = levelPreview(lv);
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
    this.sound.enabled = this.settings.sound;
    this.sound.haptics = this.settings.haptics;
  }

  openModal(el) {
    el.hidden = false;
  }

  closeModals() {
    this.dom.modalRules.hidden = true;
    this.dom.modalSettings.hidden = true;
    this.dom.modalLevels.hidden = true;
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
   * 色ごとの残りブロック数。
   * そのレベルに実際に出てくる色だけを並べ、1個だけ残っている色
   * （＝相棒がいないので単独では消せない）は白く縁取って警告する。
   */
  updateLegend() {
    const d = this.dom;
    if (!d.legend) return;
    const counts = new Array(PALETTE.length).fill(0);
    for (const p of this.board.pieces.values()) counts[p.color]++;

    const colors = this.activeColors || [];
    if (d.legend.childElementCount !== colors.length) {
      d.legend.innerHTML = '';
      for (const i of colors) {
        const chip = document.createElement('div');
        chip.className = 'legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${PALETTE[i].base}"></span><span class="legend-n">0</span>`;
        chip.title = `${PALETTE[i].name}の残りブロック数`;
        d.legend.appendChild(chip);
      }
      d.legend.style.gridTemplateColumns = `repeat(${Math.max(1, colors.length)}, 1fr)`;
    }
    colors.forEach((color, i) => {
      const chip = d.legend.children[i];
      if (!chip) return;
      chip.querySelector('.legend-n').textContent = String(counts[color]);
      chip.classList.toggle('empty', counts[color] === 0);
      chip.classList.toggle('lone', counts[color] === 1);
    });
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statPar.textContent = this.puzzle ? String(this.puzzle.par) : '-';
    d.statLeft.textContent = String(this.board.pieceCount);
    d.statLevel.textContent = String(this.level);
    if (this.puzzle) {
      // 盤面を空にしたあとは実物から読めないので、レベルの想定構成を出す
      const kinds = pieceKindLabel(this.board) || levelFlavor(this.puzzle.config);
      d.levelInfo.textContent = `${this.puzzle.size}×${this.puzzle.size} ／ ${kinds} ／ ${this.puzzle.colors}色`;
    } else {
      d.levelInfo.textContent = '\u00a0';
    }

    const done = this.initialCells ? (this.initialCells - this.board.filledCells) / this.initialCells : 0;
    d.progressBar.style.width = `${Math.round(done * 100)}%`;

    d.btnUndo.disabled = this.history.length === 0 || this.busy;
    d.hudMoves.classList.toggle('over', this.puzzle ? this.moves > this.puzzle.par : false);
    if (this.moves !== this.shownMoves) {
      this.shownMoves = this.moves;
      d.hudMoves.classList.remove('bump');
      void d.hudMoves.offsetWidth; // アニメーションを確実に再生させる
      d.hudMoves.classList.add('bump');
    }
    this.updateLegend();
  }

  // ------------------------------------------------------------ 結果表示

  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    this.store.best = this.store.best || {};
    const prev = this.store.best[key];
    this.newRecord = prev == null || this.moves < prev;
    if (this.newRecord) this.store.best[key] = this.moves;
    this.store.cleared = (this.store.cleared || 0) + (prev == null ? 1 : 0);
    // クリアしたら次のレベルが解放される
    this.store.bestLevel = Math.max(this.store.bestLevel || 1, this.level + 1);
    saveStore(this.store);
  }

  rankOf(moves, par) {
    if (moves <= par) return { label: 'PERFECT', badge: '👑', gold: true };
    if (moves <= par + 2) return { label: 'GREAT', badge: '🎉', gold: false };
    if (moves <= par + 5) return { label: 'GOOD', badge: '✨', gold: false };
    return { label: 'CLEAR', badge: '🎊', gold: false };
  }

  showWin() {
    const par = this.puzzle.par;
    const rank = this.rankOf(this.moves, par);
    const best = (this.store.best || {})[String(this.level)];
    const next = levelConfig(this.level + 1);
    const grew = next.size > this.puzzle.size;
    const harder = next.mix.triple > this.puzzle.config.mix.triple + 0.001
      || next.mix.double > this.puzzle.config.mix.double + 0.001;

    let text = this.moves <= par
      ? '保証解と同じかそれ以上。最初から最後まで読み切りました。'
      : 'おめでとう！ より短い手順が必ず存在します。';
    if (grew) text += ` 次は盤面が ${next.size}×${next.size} に広がります。`;
    else if (harder) text += ' 次はブロックがもう少し複雑になります。';

    this.showOverlay({
      badge: rank.badge,
      title: `レベル ${this.level} クリア！`,
      titleClass: rank.gold ? 'gold' : '',
      text,
      stats: [
        { k: 'あなた', n: this.moves },
        { k: 'PAR', n: par },
        { k: '自己ベスト', n: best != null ? best : this.moves },
        ...(this.hintsUsed > 0 ? [{ k: '使ったヒント', n: this.hintsUsed }] : []),
      ],
      actions: [
        { label: `レベル ${this.level + 1} へ`, primary: true, onClick: () => this.nextLevel() },
        { label: 'もう一度あそぶ', onClick: () => this.restart() },
      ],
      extra: rank.label + (this.newRecord ? '  ／ 自己ベスト更新!' : ''),
    });
  }

  showDead() {
    this.showOverlay({
      badge: '🧊',
      title: 'デッドロック',
      text: 'どのブロックをどう滑らせても、同色を接触させられません。運ではなく手順の帰結です ―― 戻して読み直しましょう。',
      stats: [
        { k: '手数', n: this.moves },
        { k: 'PAR', n: this.puzzle.par },
        { k: '残り', n: this.board.pieceCount },
      ],
      actions: [
        { label: '1手戻す', primary: true, onClick: () => this.undo() },
        { label: '最初から', onClick: () => this.restart() },
        { label: 'レベル選択', onClick: () => { this.hideOverlay(); this.openLevelPicker(); } },
      ],
    });
  }

  showOverlay(cfg) {
    const d = this.dom;
    d.overlayBadge.textContent = cfg.badge || '';
    d.overlayTitle.textContent = cfg.title || '';
    d.overlayTitle.className = cfg.titleClass || '';
    d.overlayText.textContent = cfg.text || '';

    d.overlayExtra.textContent = cfg.extra || '';

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

  // ------------------------------------------------------------ ループ

  loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

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
      hint: this.hint,
      invalid: this.invalid,
    }, dt);

    requestAnimationFrame((t) => this.loop(t));
  }
}

// ===== src/main.js =====
// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の問題を決める。

const $ = (id) => document.getElementById(id);

const dom = {
  canvas: $('board'),
  toast: $('toast'),

  statLevel: $('stat-level'),
  statMoves: $('stat-moves'),
  hudMoves: $('hud-moves'),
  statPar: $('stat-par'),
  statLeft: $('stat-left'),
  levelInfo: $('level-info'),
  progressBar: $('progress-bar'),
  legend: $('legend'),

  overlay: $('overlay'),
  overlayBadge: $('overlay-badge'),
  overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'),
  overlayExtra: $('overlay-extra'),
  overlayStats: $('overlay-stats'),
  overlayActions: $('overlay-actions'),

  btnUndo: $('btn-undo'),
  btnHint: $('btn-hint'),
  btnRestart: $('btn-restart'),
  btnLevels: $('btn-levels'),
  btnRules: $('btn-rules'),
  btnSettings: $('btn-settings'),

  modalRules: $('modal-rules'),
  modalSettings: $('modal-settings'),
  modalLevels: $('modal-levels'),
  optSound: $('opt-sound'),
  optHaptics: $('opt-haptics'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
  levelInput: $('level-input'),
  levelPreview: $('level-preview'),
  btnLevelPrev: $('btn-level-prev'),
  btnLevelNext: $('btn-level-next'),
  btnLevelGo: $('btn-level-go'),
  btnLevelBest: $('btn-level-best'),
  btnShare: $('btn-share'),
};

const game = new Game(dom);

/** URL のハッシュ（#L12 / #12）からレベルを読む */
function levelFromHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  const m = /^L?(\d+)$/i.exec(raw);
  if (!m) return null;
  return Math.max(1, parseInt(m[1], 10));
}

// 優先順位: URL のレベル > 前回遊んでいたレベル > レベル1
game.load(levelFromHash() || game.store.lastLevel || 1);

window.addEventListener('hashchange', () => {
  const lv = levelFromHash();
  if (lv && lv !== game.level) game.load(lv);
});

// 初回だけルールを開く
try {
  if (!localStorage.getItem('slidepop.seenRules')) {
    dom.modalRules.hidden = false;
    localStorage.setItem('slidepop.seenRules', '1');
  }
} catch { /* 無視 */ }

window.slidePop = game;

})();
