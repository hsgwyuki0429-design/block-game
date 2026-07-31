// ブロック形状の定義。テトロミノ7種を全回転させたものを「向き付き形状」として持つ。

/** 方向ベクトル。y は下が正（画面座標系と一致させる） */
export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const DIR_KEYS = ['up', 'right', 'down', 'left'];

export const DIR_LABEL = { up: '↑', right: '→', down: '↓', left: '←' };

/** 反対方向 */
export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

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
export const TETROMINOES = buildShapes(TETROMINO_BASE, 'tetromino');

/** 1〜3 セルの小型ピース（生成オプションで有効化した場合のみ使用） */
export const SMALL_PIECES = buildShapes(SMALL_BASE, 'small');

/** 形状名 -> 代表的な向きの一覧 */
export function shapesByName(name) {
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
export function makeCompoundShape(rng, parts, maxSpan) {
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
export function rotationsOfShape(shape) {
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
