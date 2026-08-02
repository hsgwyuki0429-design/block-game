// ブロック形状の定義。
//
// ブロックは「大小さまざまな長方形」。凸凹したテトロミノは使わない。
//
// 長方形にしているのは見た目のためではない。**大きいブロックほど通れる隙間が
// 減る** ―― 2×4 のブロックは幅2の通路しか通れないので、同じ色の相手にたどり
// つくまでの道のりが長くなる。凸凹した形は「どこまでが1つの塊か」を読む負荷を
// 増やすだけで、通路を読む面白さは増えない。長方形なら形が一目で分かるまま、
// 動かしにくさだけを上げられる。

/** 方向ベクトル。y は下が正（画面座標系と一致させる） */
export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const DIR_KEYS = ['up', 'right', 'down', 'left'];

/** 反対方向 */
export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// 長方形の基準形を作る。w×h のマスを敷き詰めるだけ
function rect(w, h) {
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
  return cells;
}

/**
 * 色つきブロックに使う長方形。縦横は buildShapes が回転で足すので、
 * ここには片側だけ書けばよい（2×3 を書けば 3×2 も出る）。
 */
const RECT_BASE = {
  '1x2': rect(1, 2),
  '1x3': rect(1, 3),
  '1x4': rect(1, 4),
  '2x2': rect(2, 2),
  '2x3': rect(2, 3),
  '2x4': rect(2, 4),
  '3x3': rect(3, 3),
};

/** 灰色ブロックに使う長方形。小さめに寄せる（大きすぎると盤面が動かなくなる） */
const BLOCKER_BASE = {
  '1x1': rect(1, 1),
  '1x2': rect(1, 2),
  '1x3': rect(1, 3),
  '2x2': rect(2, 2),
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

/** 色つきブロックに使う形（大小の長方形・全向き） */
export const PIECES = buildShapes(RECT_BASE);

/** 灰色ブロックに使う形 */
export const BLOCKER_SHAPES = buildShapes(BLOCKER_BASE);

/** ブロック1個の平均マス数。盤面サイズの見積もりに使う */
export const AVG_PIECE_CELLS =
  PIECES.reduce((a, s) => a + s.size, 0) / PIECES.length;
