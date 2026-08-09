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
