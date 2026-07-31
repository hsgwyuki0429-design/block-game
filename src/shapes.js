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
