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

import { hashSeed } from './rng.js';
import { LEVEL_CODES } from './levelData.js';
import { decodeLevel, optimalOf, sizeOf, fillOf } from './levelCodec.js';

/** 盤面の一辺の下限・上限。8×8 を超えると全探索が終わらないので作れない */
export const MIN_SIZE = 4;
export const MAX_SIZE = 8;

/** ブロックの一辺の下限・上限（色つきも灰色も同じ）。1×2 から 3×3 まで */
export const MIN_BLOCK = 2;
export const MAX_BLOCK = 3;

/**
 * レベル -> 目標の最短手数を決める折れ線。
 * ここを変えたら tools/levels.mjs を回し直してデータを作り直すこと。
 */
export const PAR_ANCHORS = [
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
export const BAKED_LEVELS = LEVEL_CODES.length;

/**
 * 焼いたぶんを使い切ったあと、どこへ戻るか。
 * 先頭（レベル1）に戻すと難易度が一気に落ちて「終わった」感じになるので、
 * いちばん上の TAIL 本ぶんをぐるぐる回す ―― レベルは上限なく続き、
 * 手数もいちばん上の帯のまま保たれる。
 */
export const TAIL_LEVELS = 200;

/** 手数の上限（＝いちばん上のレベルの手数） */
export const MAX_PAR = PAR_ANCHORS[PAR_ANCHORS.length - 1][1];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
export function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * レベル -> 目標の最短手数。PAR_ANCHORS の折れ線を線形につないだもの。
 * 実際に焼けた手数は levelConfig(level).par で見ること（ぴったりとは限らない）。
 */
export function targetPar(level) {
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
export function levelIndex(level) {
  const lv = normalizeLevel(level);
  if (lv <= BAKED_LEVELS) return lv - 1;
  const tail = Math.min(TAIL_LEVELS, BAKED_LEVELS);
  const base = BAKED_LEVELS - tail;
  return base + ((lv - BAKED_LEVELS - 1) % tail);
}

/** レベル -> 焼いてある符号 */
export function levelCode(level) {
  return LEVEL_CODES[levelIndex(level)];
}

/** レベル -> 盤面データ（符号を展開したもの） */
export function levelData(level) {
  return decodeLevel(levelCode(level));
}

/** レベル -> 厳密な最短手数 */
export function parForLevel(level) {
  return optimalOf(levelCode(level));
}

/** レベル -> 盤面の一辺 */
export function boardSizeForLevel(level) {
  return sizeOf(levelCode(level));
}

/** レベル -> 盤面の埋め率 */
export function fillForLevel(level) {
  return fillOf(levelCode(level));
}

/** レベル -> 灰色ブロックの数（色つき2個を除いた残り全部） */
export function blockersForLevel(level) {
  const code = levelCode(level);
  return decodeLevel(code).pieces.length - 2;
}

/** レベル -> 生成シード。譜面は焼いてあるので、今は表示・演出のゆらぎにだけ使う */
export function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/**
 * 星の時間しきい値（秒）。
 *
 * 星は手数ではなく「解けるまでの時間」で決まる。手数で測ると、詰まったときに
 * 戻して試すのが罰になってしまう ―― このゲームで時間がかかるのは指が遅いからでは
 * なく、盤面を読んでいるからなので、時間のほうが素直に「読み切れたか」を表す。
 *
 * しきい値は最短手数と盤面の広さから決まる。手順が長いほど読む量も増えるため。
 *   ★★★ gold 以内 ／ ★★ silver 以内 ／ ★ クリア
 */
export function targetTimes(par, size = 6) {
  const gold = Math.round(20 + Math.max(1, par) * 9 + Math.max(1, size) * 4);
  return { gold, silver: gold * 2 };
}

/** 解けるまでの秒数 -> 星（3/2/1） */
export function starsForTime(seconds, times) {
  if (seconds <= times.gold) return 3;
  if (seconds <= times.silver) return 2;
  return 1;
}

/** 秒 -> "M:SS"（1時間を超えたら "H:MM:SS"） */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** レベルの各種パラメータ（遊ぶ前でも出せる） */
export function levelConfig(level) {
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
export function levelSummary(config) {
  return [
    `${config.size}×${config.size}`,
    `最短${config.par}手`,
    `灰${config.blockers}個`,
    `埋め率${Math.round(config.fill * 100)}%`,
  ].join('・');
}

/** 実際に生成できたパズルの要約（ゲーム画面の見出し下に出す） */
export function puzzleSummary(puzzle) {
  const fill = puzzle.cells / (puzzle.size * puzzle.size);
  return [
    `${puzzle.size}×${puzzle.size}`,
    `最短${puzzle.par}手`,
    `灰${puzzle.blockers}個`,
    `埋め率${Math.round(fill * 100)}%`,
  ].join('・');
}
