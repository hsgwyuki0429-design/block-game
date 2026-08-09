// 受け取った値の検分。ブラウザ API に触れないので Node からそのままテストできる。
//
// 名前の整えかたは **クライアントと同じ関数を使う**（src/ranking.js の sanitizeName）。
// サーバ側に写しを作ると、どちらかを直したときにもう片方がずれて、
// 「自分の端末では 12 文字なのにランキングでは 20 文字」のような食い違いが起きる。
//
// 範囲外の値は丸めずに **弾く**。丸めて受け入れると、壊れた投稿が
// 「0手クリア」として一覧の先頭に居座り、誰にも消せなくなる。

import { sanitizeName } from '../src/ranking.js';

/** レベルは上限なく続く（src/levels.js）。桁あふれだけを止める */
export const LEVEL_MAX = 1_000_000;
/** 最長のレベルでも 300 手。桁が違う投稿は壊れているとみなす */
export const MOVES_MAX = 100_000;
/** 100 時間。これを超えるタイムは時計が壊れている */
export const TIME_MAX = 360_000;
/** 星は 1 レベルにつき 3 個。全レベルを ★★★ で埋めてもここが上限 */
export const STARS_MAX = LEVEL_MAX * 3;

/** 数値として読む。数と文字列だけを受け付け、範囲外は null */
function readInt(raw, min, max) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** GET / POST どちらのレベル指定も、これを通ってから使う */
export function readLevel(raw) {
  return readInt(raw, 1, LEVEL_MAX);
}

/** 取りたい件数。読めない指定・多すぎる要求は、弾かずに既定値へ落とす */
export function readLimit(raw, fallback, max) {
  if (raw == null || raw === '') return fallback;
  const n = readInt(raw, 1, max);
  return n == null ? fallback : n;
}

/**
 * 投稿 1 件を読む。ひとつでも欠けたり範囲外なら null（＝ 400 を返す）。
 * at はサーバの時計で打つ ―― 端末の時計は自由に変えられるので、
 * それを信じると「同着なら先に出した方が上」が簡単に破られる。
 */
export function readEntry(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;

  const level = readLevel(body.level);
  const name = sanitizeName(body.name);
  const moves = readInt(body.moves, 0, MOVES_MAX);
  const time = readInt(body.time, 0, TIME_MAX);
  const stars = readInt(body.stars, 0, 3);

  if (level == null || !name || moves == null || time == null || stars == null) return null;
  return { level, name, moves, time, stars, at: now };
}

/**
 * どちらの表への出入りか。
 * 'stars' と名指ししたときだけ星の表、それ以外はすべてレベル別 ――
 * board を知らない古い版のクライアントが、そのまま今までどおり動く。
 */
export function readBoard(raw) {
  return raw === 'stars' ? 'stars' : 'level';
}

/**
 * 星の数の投稿 1 件を読む。
 * cleared（クリアしたレベル数）は同数のときの並べ替えに使うので、星と一緒に必ず要る。
 * 星が 1 レベルあたり 3 個を超えることはないので、クリア数の 3 倍を上限にする ――
 * 「1 レベルだけクリアして星 500 個」のような投稿を先頭に居座らせない。
 */
export function readStarEntry(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;

  const name = sanitizeName(body.name);
  const stars = readInt(body.stars, 0, STARS_MAX);
  const cleared = readInt(body.cleared, 0, LEVEL_MAX);

  if (!name || stars == null || cleared == null) return null;
  if (stars > cleared * 3) return null;
  return { name, stars, cleared, at: now };
}
