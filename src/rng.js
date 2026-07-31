// 決定論的な擬似乱数。シードを固定すれば誰がどこで実行しても同じ盤面になる。
// （デイリーパズル / リプレイ共有のための土台）

/** mulberry32: 32bit シードから [0,1) の乱数を返す関数を作る */
export function makeRng(seed) {
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
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 0 以上 n 未満の整数 */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/** 配列からひとつ選ぶ */
export function pick(rng, arr) {
  return arr[randInt(rng, arr.length)];
}

/** 破壊的シャッフル（Fisher-Yates） */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** 重み付き抽選。weights は同じ長さの数値配列 */
export function weightedIndex(rng, weights) {
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
export function seedToCode(seed) {
  return (seed >>> 0).toString(36).toUpperCase();
}

/** seedToCode の逆。パースできなければ hashSeed にフォールバック */
export function codeToSeed(code) {
  const cleaned = String(code).trim().toUpperCase();
  if (/^[0-9A-Z]{1,7}$/.test(cleaned)) {
    const n = parseInt(cleaned, 36);
    if (Number.isFinite(n)) return n >>> 0;
  }
  return hashSeed(cleaned);
}
