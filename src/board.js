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

import { DIRS, DIR_KEYS } from './shapes.js';

export const BOARD_SIZE = 12;

export const EMPTY = -1;
export const WALL = -2;

export class Board {
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
export function boardFromSnapshot(snap, size = BOARD_SIZE) {
  const b = new Board(size);
  b.restore(snap);
  return b;
}
