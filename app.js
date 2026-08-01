// SLIDE POP! ― tools/build.mjs が src/ から生成。直接編集しないこと。
(function () {
'use strict';

// ===== src/shapes.js =====
// ブロック形状の定義。
//
// 盤面に出るのはテトロミノ（4マス）だけ。7 種をすべて回転させたものを
// 「向き付き形状」として持つ（19 通り）。連結した大型ブロックは出さない ――
// 難しさは形ではなく、色数・仕込み手・一本道でつける。

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

/** テトロミノ全種・全向き（19 通り） */
const TETROMINOES = buildShapes(TETROMINO_BASE);

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
// 盤面には「同じ色のブロックがちょうど2個ずつ」置かれる。
// 1手で消えるのは必ずその2個なので、
//
//     最短手数 = 色数
//
// が構造的に決まる。レベルが上がると色数が増え、それに合わせて盤面も広がる。
// さらに上のレベルでは
//   ・仕込み手（それ自体では何も消えないが、通さないと解けない手）
//   ・一本道（どの局面でも「消せる手」が実質1通りしかない）
// が加わる。

const MIN_SIZE = 4;
const MAX_SIZE = 12;
/**
 * 色数の上限。最大盤面 12×12 に「11色 × 2個 × 4マス = 88マス」を敷いても
 * 埋め率は 61% ―― 逆順構築が滑走路を確保できる密度に収まる。
 * これ以上増やすと盤面が詰まりすぎて生成が破綻する。
 */
const MAX_COLORS = 11;

/** 目標の埋め率。これを基準に色数から盤面サイズを決める */
const FILL = 0.62;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** レベル -> 色数（＝ブロックのペア数＝最短手数） */
function colorsForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(1 + Math.floor((lv - 1) / 2), 1, MAX_COLORS);
}

/** 色数 -> 盤面サイズ。ブロックは色数×2個、1個4マスなので 8×色数 マスを敷く */
function boardSizeForColors(colors) {
  const cells = clamp(Math.round(colors), 1, MAX_COLORS) * 8;
  return clamp(Math.round(Math.sqrt(cells / FILL)), MIN_SIZE, MAX_SIZE);
}

/** レベル -> 盤面サイズ */
function boardSizeForLevel(level) {
  return boardSizeForColors(colorsForLevel(level));
}

/**
 * レベル -> 仕込み手の数。
 * 「一見関係ないところを動かさないと解けない」手を何手ぶん混ぜるか。
 */
function setupMovesForLevel(level) {
  const lv = normalizeLevel(level);
  return clamp(Math.floor((lv - 8) / 5), 0, 4);
}

/** レベル -> 一本道（解が実質1通り）を要求するか */
function requiresForcedLine(level) {
  return normalizeLevel(level) >= 16;
}

/** レベル -> 生成シード。この一本道が「どの端末でも同じ譜面」を担保する */
function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/** レベルの各種パラメータ */
function levelConfig(level) {
  const lv = normalizeLevel(level);
  const colors = colorsForLevel(lv);
  const size = boardSizeForColors(colors);
  const setupMoves = setupMovesForLevel(lv);
  return {
    level: lv,
    colors,
    size,
    setupMoves,
    forced: requiresForcedLine(lv),
    /** ブロック数（色数×2） */
    pieces: colors * 2,
    /** 最短手数＝色数＋仕込み手 */
    par: colors + setupMoves,
    /** 生成の試行回数 */
    attempts: 60,
  };
}

/** レベルの内容を一言で（見出しの下に出す補足） */
function levelSummary(config) {
  const parts = [`${config.size}×${config.size}`, `${config.colors}色`];
  if (config.setupMoves > 0) parts.push(`仕込み${config.setupMoves}手`);
  if (config.forced) parts.push('一本道');
  return parts.join('・');
}

// ===== src/generator.js =====
// パズル生成 ―「解の逆順構築」
//
// ランダムに埋めて解けるか検証する、という素朴な方法は使わない。代わりに
// 完成状態（空盤面）から出発し、1手ぶんずつ逆再生するようにブロックを置いていく。
// 最後に置いたステップが、解の第1手になる。
//
// 盤面には同じ色のブロックがちょうど2個ずつ。だから1手で消えるのは必ずその2個で、
// 「最短手数＝色数」が構造的に決まる。逆順構築の1ステップはこうなる:
//
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
// 色ごとにブロックは2個しかないので「予定外の巻き込み消去」は原理的に起きない。
//
// さらに上のレベルでは「仕込み手」を前に足す。盤面にあるブロックを1つ選び、
// 滑らせれば今の位置に来るような手前の位置へ戻す。その手自体では何も消えないが、
// 通さないと後の手が成立しない ―― 一見関係ない場所を動かす必要が生まれる。

const DEFAULT_OPTIONS = {
  size: 8,
  colors: 4,
  setupMoves: 0,
  forced: false,
  attempts: 60,
  /** 滑走距離の偏り。1 未満で「長い滑走」寄り */
  distanceBias: 0.85,
  /** 配置優先度のゆらぎ。0 だと常に最も詰まった場所へ置く（＝単調になる） */
  packingJitter: 3,
  /** 一本道の判定を1ステップで何回まで試すか（探索が指数的に伸びるのを防ぐ） */
  forcedChecks: 90,
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
function emptyPlacements(board) {
  const out = [];
  const size = board.size;
  for (const shape of TETROMINOES) {
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
    for (const shape of shuffle(rng, TETROMINOES.slice())) {
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
function clearableColors(board, limit = Infinity) {
  const out = new Set();
  for (const [id, piece] of board.pieces) {
    if (out.has(piece.color)) continue; // この色はもう数えた
    for (const dir of DIR_KEYS) {
      const r = board.simulate(id, dir);
      if (r && r.cleared.length > 0) { out.add(piece.color); break; }
    }
    if (out.size >= limit) break; // 呼び出し側が必要な数まで数えたら打ち切る
  }
  return out;
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
function placePair(board, rng, opts, color, requireForced) {
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
      if (!requireForced) return placed.step;

      // 一本道を求めるレベルでは、この局面で消せる色がこの色だけであることを課す
      if (clearableColors(board, 2).size <= 1) return placed.step;

      board.removePiece(placed.movingId);
      board.removePiece(placed.mateId);
      if (!fallback) fallback = cand;
      if (++checks >= opts.forcedChecks) break search;
    }
  }

  if (fallback) return commitPair(board, color, fallback).step;
  return null;
}

/**
 * 仕込み手を1つ前に足す。
 * 盤面のブロックを1つ選び、「滑らせれば今の位置にちょうど来る」手前の位置へ戻す。
 * その手自体では何も消えない（同色は隣接していないため）が、
 * 通さないと後の手が成立しない。
 *
 * @param {number[]} preferIds この順で優先して対象を選ぶ（次に動かす予定のブロックなど）
 */
function placeSetup(board, rng, opts) {
  const size = board.size;
  const candidates = [];

  for (const id of board.pieces.keys()) {
    const piece = board.pieces.get(id);
    const partner = [...board.pieces.values()].find((p) => p.color === piece.color && p.id !== id);
    const own = new Set(piece.cells.map(([x, y]) => y * size + x));

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
        const from = piece.cells.map(([x, y]) => [x - d.x * t, y - d.y * t]);
        if (partner) {
          const halo = haloOf(size, from);
          if (partner.cells.some(([x, y]) => halo.has(y * size + x))) continue;
        }
        candidates.push({ id, dir, t, color: piece.color });
      }
    }
  }
  if (candidates.length === 0) return null;

  // 「動かした結果、すぐ消せる色が減る」候補を選ぶ。
  // 消せる色が 0 になれば、その仕込み手を通さないと先へ進めない盤面になる。
  shuffle(rng, candidates);
  let best = null;
  let bestN = Infinity;
  for (const c of candidates.slice(0, 80)) {
    board.movePiece(c.id, OPPOSITE[c.dir], c.t);
    const n = clearableColors(board, bestN).size;
    board.movePiece(c.id, c.dir, c.t);
    if (n < bestN) {
      bestN = n;
      best = c;
      if (n === 0) break;
    }
  }
  if (!best) return null;

  board.movePiece(best.id, OPPOSITE[best.dir], best.t);
  return { pieceId: best.id, dir: best.dir, distance: best.t, color: best.color, kind: 'setup' };
}

/** 1回分の生成試行 */
function attemptBuild(seed, opts) {
  const rng = makeRng(seed);
  const board = new Board(opts.size);
  const solution = [];

  for (let c = 0; c < opts.colors; c++) {
    const step = placePair(board, rng, opts, c, opts.forced);
    if (!step) return null;
    // 逆順に作っているので、新しいステップほど「先の手」になる
    solution.unshift(step);
  }

  for (let i = 0; i < opts.setupMoves; i++) {
    const step = placeSetup(board, rng, opts);
    if (!step) break;
    solution.unshift(step);
  }

  return { board, solution };
}

/**
 * 解の道筋を調べる。
 *   clearAtStart : 初期盤面に「消せる手」がいくつあるか（0 なら仕込み手が必須）
 *   forced       : どの局面でも「消せる手」の結果が実質1通りしかないか
 */
function analyzeSolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);
  let forced = true;
  let clearAtStart = 0;
  let branchPoints = 0;

  for (let i = 0; i < solution.length; i++) {
    const colors = clearableColors(board);
    if (i === 0) clearAtStart = colors.size;
    // 仕込み手の局面（消せる色が無い）は分岐とみなさない
    if (colors.size > 1) {
      forced = false;
      branchPoints++;
    }
    board.applyMove(solution[i].pieceId, solution[i].dir);
  }
  return { forced, clearAtStart, branchPoints };
}

/** レベル番号からパズルを作る */
function generateLevel(level, overrides = {}) {
  const config = levelConfig(level);
  const puzzle = generatePuzzle(levelSeed(config.level), {
    size: config.size,
    colors: config.colors,
    setupMoves: config.setupMoves,
    forced: config.forced,
    attempts: config.attempts,
    ...overrides,
  });
  return { ...puzzle, level: config.level, config };
}

/** generateLevel の非同期版（画面を固めずに生成する） */
async function generateLevelAsync(level, overrides = {}, onProgress = null) {
  const config = levelConfig(level);
  const puzzle = await generatePuzzleAsync(levelSeed(config.level), {
    size: config.size,
    colors: config.colors,
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
    setupMoves: built.solution.filter((s) => s.kind === 'setup').length,
    analysis,
  };
}

/** 望んだ性質をどれだけ満たしているか。大きいほど良い */
function score(result, opts) {
  let s = result.cells;
  if (opts.setupMoves > 0) {
    s += result.setupMoves * 40;
    // 初手から消せる手が無い＝仕込みが必須。これが一番欲しい形
    if (result.analysis.clearAtStart === 0) s += 200;
  }
  if (opts.forced && result.analysis.forced) s += 300;
  return s;
}

function goodEnough(result, opts) {
  if (opts.setupMoves > 0 && result.analysis.clearAtStart !== 0) return false;
  if (opts.setupMoves > 0 && result.setupMoves < opts.setupMoves) return false;
  if (opts.forced && !result.analysis.forced) return false;
  return true;
}

function generatePuzzle(seed, options = {}) {
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
async function generatePuzzleAsync(seed, options = {}, onProgress = null) {
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
    if (attempt % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }

  if (!best) throw new Error('パズルを生成できませんでした');
  return best;
}

/**
 * 生成された解答手順を前から実行して、本当に全消しできるか確かめる。
 * 生成ロジックのバグをここで必ず捕まえる（テストからも使用）。
 */
function verifySolution(snapshot, solution, size) {
  const board = new Board(size);
  board.restore(snapshot);

  if (board.hasSameColorContact()) {
    return { ok: false, reason: '初期盤面に同色接触がある' };
  }
  for (const p of board.pieces.values()) {
    if (p.cells.length !== 4) return { ok: false, reason: 'テトロミノ以外のブロックがある' };
  }
  const counts = new Map();
  for (const p of board.pieces.values()) counts.set(p.color, (counts.get(p.color) || 0) + 1);
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
    const wantCleared = step.kind === 'setup' ? 0 : 2;
    if (res.cleared.length !== wantCleared) {
      return { ok: false, reason: `手 ${i + 1}: 消去数が想定と違う (${res.cleared.length} != ${wantCleared})` };
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

// ===== src/render.js =====
// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックは「色そのもの」で描く。影も光沢も模様も乗せない ―― 一色のベタ塗りに、
// ほんのわずかな角丸だけ。マス同士のすき間も髪の毛ほどしか空けないので、
// 盤面はタイルを敷き詰めたモザイクのように見える。
// 同じブロックのマス同士はすき間なく繋がるので「どこまでが一緒に動くか」は形で読める。
//
// 後ろの盤面も同じ考えで、淡い色のマスを敷き詰めただけの平らな面にしている。

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
const HUES = [4, 210, 46, 142, 288, 26, 190, 330, 96, 258, 168, 14, 308, 64, 228, 118, 348, 200, 78, 272];

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
function colorFor(index) {
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

/** 盤面（ブロックを並べる面）。影を落とさない、平らな一色 */
const TRAY = { plate: '#dde2f0', hole: '#eef1f8' };

/** 色覚サポート用の記号。色数が増えても足りるよう繰り返して使う */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '▼', '⬢', '♦', '☰'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.6 * Math.pow(t - 1, 2);

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

    // 盤面は正方形。外周にわずかな縁だけ取る
    const cell = Math.floor((Math.min(w, h) - 18) / this.size);
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
  }

  /**
   * マスとマスのすき間。「ほんの少しだけ」＝ 1〜2px。
   * 敷き詰まって見えることを優先し、マスが小さいときも 1px 以上は空けない。
   */
  get tileGap() { return this.cell >= 34 ? 1.5 : 1; }
  get tileSize() { return this.cell - this.tileGap * 2; }
  get tileRadius() { return Math.max(1.5, this.tileSize * 0.14); }

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

  /** 砕けた破片が飛び散る */
  burst(cells, colorIndex) {
    const c = colorFor(colorIndex);
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
      color: colorFor(colorIndex).shadow,
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

  /**
   * 盤面。ブロックと同じ寸法・同じすき間の淡いマスを敷き詰めただけの平らな面。
   * 影も枠線も付けない ―― 空きマスがそのまま「通路」として読めればいい。
   */
  drawTray(board) {
    const ctx = this.ctx;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    const x0 = this.ox;
    const y0 = this.oy;
    const pad = Math.max(2, cell * 0.06);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, Math.max(6, cell * 0.24));
    ctx.fillStyle = TRAY.plate;
    ctx.fill();
    ctx.restore();

    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    ctx.save();
    ctx.fillStyle = TRAY.hole;
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

      const axis = anim && anim.pieceId === piece.id ? anim.dir : null;
      this.drawPiece(piece, dx, dy, 1, squash, selected === piece.id, 'solid', axis);
    }
  }

  drawTrail(piece, d, anim, p) {
    const ctx = this.ctx;
    const c = colorFor(piece.color);
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

  /** ブロックのセル矩形を組み立てる（同じブロックの隣とは継ぎ目なく繋がる） */
  cellRects(piece, dx, dy) {
    const cell = this.cell;
    const own = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
    const has = (x, y) => own.has(`${x},${y}`);
    const pad = this.tileGap;
    const r = this.tileRadius;

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

    const c = colorFor(piece.color);
    const outline = this.outlineOf(rects, this.tileRadius);

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

    // ベタ塗り一色。同じブロックのマス同士は継ぎ目なく繋がり、
    // 別のブロックとのあいだにだけ髪の毛ほどのすき間が残る。
    ctx.fillStyle = c.base;
    ctx.fill(this.pathOf(rects));

    // 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.38;
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
      ctx.lineWidth = Math.max(2, cell * 0.08);
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
    ctx.strokeStyle = '#ffd60a';
    ctx.lineWidth = Math.max(2.5, cell * 0.1);
    ctx.shadowColor = 'rgba(255,214,10,.9)';
    ctx.shadowBlur = cell * 0.6;
    ctx.stroke(this.outlineOf(this.cellRects(piece, 0, 0), this.tileRadius));
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
    ctx.fillStyle = '#ffd60a';
    ctx.shadowColor = 'rgba(255,214,10,.9)';
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
      ctx.strokeStyle = 'rgba(16,20,36,.85)';
      ctx.font = `800 ${Math.floor(this.cell * 0.82)}px ${UI_FONT}`;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = `800 ${Math.floor(this.cell * 0.52)}px ${UI_FONT}`;
        ctx.strokeText(t.sub, 0, this.cell * 0.8);
        ctx.fillStyle = '#ffd60a';
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
//
// 画面は3つ（ホーム / レベル一覧 / ゲーム）。同時に見えるのは常に1つだけ。
// レベルは「ひとつ前をクリアするまで開かない」ので、進行状況は
// 「解放済みレベル」と「レベルごとの星」だけで表せる。

/** 大量消去の段階評価（セル数）。明るい背景で読める中間の明度に寄せてある */
const TIERS = [
  { cells: 20, label: 'ミラクル!!!', color: '#e0388f' },
  { cells: 16, label: 'ファンタスティック!!', color: '#e08a00' },
  { cells: 12, label: 'グレイト!', color: '#0f9d63' },
];

const STORE_KEY = 'slidepop.v3';

/** レベル一覧の1ページに並べる数 */
const PAGE_SIZE = 30;

function tierOf(cells) {
  for (const t of TIERS) if (cells >= t.cells) return t;
  return null;
}

/**
 * 手数の星評価。
 *   ★★★ PAR 以内（保証解と同じかそれ以上）
 *   ★★  PAR+2 以内
 *   ★   クリア
 */
function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + 2) return 2;
  return 1;
}

/** レベル一覧・ホームに出す、遊ぶ前のプレビュー文 */
function levelPreview(level) {
  return levelSummary(levelConfig(level));
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
    this.status = 'idle';
    this.level = 1;
    this.loadToken = 0;
    this.screen = 'home';
    /** レベル一覧のページ（0 始まり） */
    this.page = 0;

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

  // ------------------------------------------------------------ 進行状況

  /** 遊べる最大レベル。ひとつ前をクリアすると 1 つ増える */
  get unlockedLevel() {
    return Math.max(1, Math.floor(this.store.unlocked) || 1);
  }

  /** そのレベルが開いているか */
  isUnlocked(level) {
    return normalizeLevel(level) <= this.unlockedLevel;
  }

  /** そのレベルで取った星（0 = 未クリア） */
  starsOf(level) {
    return (this.store.stars || {})[String(normalizeLevel(level))] || 0;
  }

  /** 星の総数 */
  get totalStars() {
    return Object.values(this.store.stars || {}).reduce((a, b) => a + b, 0);
  }

  /** クリア済みレベル数 */
  get clearedCount() {
    return Object.keys(this.store.stars || {}).length;
  }

  // ------------------------------------------------------------ パズル

  /**
   * レベルを読み込む。
   * 上のレベルほど生成に時間がかかるので、非同期版を使って
   * 「生成中」を出しながら待つ（画面が固まらない）。
   */
  async load(level) {
    const lv = normalizeLevel(level);
    if (!this.isUnlocked(lv)) {
      this.showLevels(Math.floor((this.unlockedLevel - 1) / PAGE_SIZE));
      this.toast(`レベル ${lv - 1} をクリアすると開きます`);
      return;
    }
    const token = ++this.loadToken;
    this.showGame();

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

  showLoading(level) {
    const cfg = levelConfig(level);
    this.showOverlay({
      badge: '🧩',
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
    // 段階評価が無いときは、消えたブロックの色そのままで祝う
    const textColor = tier ? tier.color : colorFor(color).dark;
    this.renderer.floatText(center.x, center.y, `${cells}個消し！`, sub, textColor);

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
    if (this.board.isEmpty) {
      this.status = 'won';
      this.recordResult();
      this.sound.win();
      setTimeout(() => this.showWin(), 640);
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
      this.toast(step.kind === 'setup'
        ? `保証解の第${this.moves + 1}手：これ自体は何も消えません（後の手のための仕込み）`
        : `保証解の第${this.moves + 1}手：この色のペアが消えます`);
      this.updateHud();
      return;
    }
    const moves = this.board.findClearingMoves();
    if (moves.length > 0) {
      const best = moves[0];
      this.hint = { pieceId: best.id, dir: best.dir };
      this.hintsUsed++;
      this.toast(`${best.clearedCells}マスぶん消せる手があります`);
      this.updateHud();
      return;
    }
    this.toast('いま消せる手はありません。通路を作るか、「戻す」で組み立て直しましょう');
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
    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnHint.addEventListener('click', () => this.showHint());
    d.btnRestart.addEventListener('click', () => this.restart());
    d.btnLevels.addEventListener('click', () => this.showLevels());
    d.btnHome.addEventListener('click', () => this.showHome());

    // ホーム
    d.btnStart.addEventListener('click', () => this.load(this.startLevel));
    d.btnOpenLevels.addEventListener('click', () => this.showLevels());

    // レベル一覧
    d.btnLevelsBack.addEventListener('click', () => this.showHome());
    d.btnLevelsJump.addEventListener('click', () => this.showLevels(this.pageOf(this.unlockedLevel)));
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
      if (el) el.addEventListener('click', () => this.openModal(d.modalSettings));
    }

    for (const modal of [d.modalRules, d.modalSettings]) {
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

    d.btnShare.addEventListener('click', () => this.share());
  }

  // ------------------------------------------------------------ 画面の切り替え

  /** 「ゲームスタート」が始めるレベル。まだ挑戦中のものがあればそれを続ける */
  get startLevel() {
    const last = normalizeLevel(this.store.lastLevel || 1);
    return this.isUnlocked(last) && this.starsOf(last) === 0 ? last : this.unlockedLevel;
  }

  showScreen(name) {
    const d = this.dom;
    this.screen = name;
    d.screenHome.hidden = name !== 'home';
    d.screenLevels.hidden = name !== 'levels';
    d.screenGame.hidden = name !== 'game';
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

    d.homeProgress.innerHTML = '';
    const chips = [
      ['クリア', this.clearedCount],
      ['星', this.totalStars],
      ['最高レベル', this.unlockedLevel],
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
      const unlocked = this.isUnlocked(lv);
      const stars = this.starsOf(lv);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'level-cell';
      if (!unlocked) cell.classList.add('locked');
      else if (lv === this.unlockedLevel) cell.classList.add('current');
      else if (stars > 0) cell.classList.add('done');

      if (unlocked) {
        cell.dataset.level = String(lv);
        cell.innerHTML = `<span class="n">${lv}</span>`
          + `<span class="stars${stars ? '' : ' none'}">${'★'.repeat(stars) || '☆☆☆'}</span>`;
        cell.title = `レベル ${lv}：${levelPreview(lv)}`;
      } else {
        cell.disabled = true;
        cell.setAttribute('aria-label', `レベル ${lv}（未開放）`);
        cell.innerHTML = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true">'
          + '<rect x="5" y="10.5" width="14" height="9.5" rx="2.6"/>'
          + '<path d="M8.4 10.5V7.9a3.6 3.6 0 0 1 7.2 0v2.6"/></svg>'
          + `<span class="stars none">${lv}</span>`;
      }
      d.levelGrid.appendChild(cell);
    }
  }

  showGame() {
    if (this.screen !== 'game') this.showScreen('game');
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
    this.sound.enabled = this.settings.sound;
    this.sound.haptics = this.settings.haptics;
  }

  openModal(el) {
    el.hidden = false;
  }

  anyModalOpen() {
    return !this.dom.modalRules.hidden || !this.dom.modalSettings.hidden;
  }

  closeModals() {
    this.dom.modalRules.hidden = true;
    this.dom.modalSettings.hidden = true;
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
    const counts = new Map();
    for (const p of this.board.pieces.values()) counts.set(p.color, (counts.get(p.color) || 0) + 1);

    const colors = this.activeColors || [];
    if (d.legend.childElementCount !== colors.length) {
      d.legend.innerHTML = '';
      for (const i of colors) {
        const chip = document.createElement('div');
        chip.className = 'legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${colorFor(i).base}"></span><span class="legend-n">0</span>`;
        chip.title = `${colorFor(i).name}の残りブロック数`;
        d.legend.appendChild(chip);
      }
      // 色数はレベルによって変わる。1行6個までで、行が均等に埋まる列数にする
      const rows = Math.max(1, Math.ceil(colors.length / 6));
      const cols = Math.max(1, Math.ceil(colors.length / rows));
      d.legend.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      d.legend.style.maxWidth = `${cols * 76}px`;
    }
    colors.forEach((color, i) => {
      const chip = d.legend.children[i];
      if (!chip) return;
      const n = counts.get(color) || 0;
      chip.querySelector('.legend-n').textContent = String(n);
      chip.classList.toggle('empty', n === 0);
      chip.classList.toggle('lone', n === 1);
    });
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statPar.textContent = this.puzzle ? String(this.puzzle.par) : '-';
    d.statLeft.textContent = String(this.board.pieceCount);
    d.statLevel.textContent = String(this.level);
    d.levelInfo.textContent = this.puzzle ? levelSummary(this.puzzle.config) : '\u00a0';

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

  /** クリアを記録する。星は最高記録だけを残し、次のレベルが開く */
  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    const stars = starsFor(this.moves, this.puzzle.par);

    this.store.best = this.store.best || {};
    this.store.stars = this.store.stars || {};
    const prevBest = this.store.best[key];
    const prevStars = this.store.stars[key] || 0;

    this.newRecord = prevBest == null || this.moves < prevBest;
    if (this.newRecord) this.store.best[key] = this.moves;
    this.store.stars[key] = Math.max(prevStars, stars);

    // クリアしたら次のレベルが開く
    this.store.unlocked = Math.max(this.unlockedLevel, this.level + 1);
    saveStore(this.store);

    this.lastStars = stars;
    this.newStars = stars > prevStars;
  }

  showWin() {
    const par = this.puzzle.par;
    const stars = this.lastStars;
    const best = (this.store.best || {})[String(this.level)];
    const next = levelConfig(this.level + 1);
    const badges = { 3: '👑', 2: '🎉', 1: '🎊' };

    let text = stars === 3
      ? '保証解と同じかそれ以上。最初から最後まで読み切りました。'
      : `おめでとう！ ${par}手で解ける手順が必ず存在します。`;
    if (next.size > this.puzzle.size) text += ` 次は盤面が ${next.size}×${next.size} に広がります。`;
    else if (next.colors > this.puzzle.colors) text += ` 次は色が ${next.colors} 色に増えます。`;
    else if (next.setupMoves > this.puzzle.config.setupMoves) text += ' 次は仕込み手が増えます。';
    else if (next.forced && !this.puzzle.config.forced) text += ' 次から手順は実質一本道になります。';

    this.showOverlay({
      badge: badges[stars] || '🎊',
      title: `レベル ${this.level} クリア！`,
      titleClass: stars === 3 ? 'gold' : '',
      stars,
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
        { label: 'レベル一覧', onClick: () => this.showLevels() },
      ],
      extra: this.newStars ? '自己ベスト更新!' : '',
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
// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の画面を決める。

const $ = (id) => document.getElementById(id);

const dom = {
  // 画面
  screenHome: $('screen-home'),
  screenLevels: $('screen-levels'),
  screenGame: $('screen-game'),

  canvas: $('board'),
  toast: $('toast'),

  // ホーム
  btnStart: $('btn-start'),
  btnStartLabel: $('btn-start-label'),
  btnStartSub: $('btn-start-sub'),
  btnOpenLevels: $('btn-open-levels'),
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
  statPar: $('stat-par'),
  statLeft: $('stat-left'),
  levelInfo: $('level-info'),
  progressBar: $('progress-bar'),
  legend: $('legend'),

  overlay: $('overlay'),
  overlayBadge: $('overlay-badge'),
  overlayTitle: $('overlay-title'),
  overlayStars: $('overlay-stars'),
  overlayText: $('overlay-text'),
  overlayExtra: $('overlay-extra'),
  overlayStats: $('overlay-stats'),
  overlayActions: $('overlay-actions'),

  btnUndo: $('btn-undo'),
  btnHint: $('btn-hint'),
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
  optSound: $('opt-sound'),
  optHaptics: $('opt-haptics'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
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
  if (!localStorage.getItem('slidepop.seenRules')) {
    dom.modalRules.hidden = false;
    localStorage.setItem('slidepop.seenRules', '1');
  }
} catch { /* プライベートモードなどでは無視 */ }

window.slidePop = game;

})();
