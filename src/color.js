// 色の小道具。render.js と materials.js の両方が使う。
//
// 切り出してあるのは、ビルドが src/ を 1 つのスコープに連結するから ――
// 同じ名前の関数を 2 つのファイルに置くと、そこで衝突してビルドが止まる。

/** 直線補間 */
export function mix(a, b, t) {
  return a + (b - a) * t;
}

/** 下限と上限で挟む。ここの中だけで使う */
function clip(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/** HSL -> [r,g,b]（0..255）。h は度、s と l は % */
export function hslRgb(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v);
  };
  return [f(0), f(8), f(4)];
}

/** [r,g,b] -> "#rrggbb" */
export function rgbHex(rgb) {
  return `#${rgb.map((v) => clip(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** "#rrggbb" -> [r,g,b] */
export function hexRgb(hex) {
  const s = String(hex).replace('#', '');
  const n = s.length === 3
    ? s.split('').map((c) => c + c).join('')
    : s.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
}

/** [r,g,b] -> [h,s,l]（rgbHsl の逆算。色相をずらすために要る） */
export function rgbHsl(rgb) {
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
export function shade(hex, amount) {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return rgbHex(hexRgb(hex).map((v) => mix(v, target, clip(k, 0, 1))));
}

/** 色に不透明度を付けて rgba() にする */
export function rgba(hex, alpha) {
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
export function tintTowards(baseHex, tintHex, strength) {
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
export function luma(hex) {
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
