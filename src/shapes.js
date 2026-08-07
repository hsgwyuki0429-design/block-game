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
export const PIECES = buildShapes(RECT_BASE);

/** ブロックの一辺の下限・上限 */
export const MIN_SIDE = 1;
export const MAX_SIDE = 3;
/** ブロックのマス数の下限・上限（1×2 = 2 マス 〜 3×3 = 9 マス） */
export const MIN_CELLS = 2;
export const MAX_CELLS = 9;
