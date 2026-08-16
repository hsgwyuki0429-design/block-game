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
 * 管理の合言葉を照らす。
 *
 * 1 文字ずつ **最後まで** 見て、違いを積むだけにする ―― 途中で return すると
 * 「何文字目まで合っていたか」が応答の速さに出て、1 文字ずつ当てられてしまう。
 * 長さの違いも同じ理由で、先に長さで弾かずに結果へ混ぜる。
 */
export function isAdminKey(given, expected) {
  if (typeof expected !== 'string' || expected === '') return false;
  const a = typeof given === 'string' ? given : '';
  let diff = a.length ^ expected.length;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= a.charCodeAt(i % (a.length || 1)) ^ expected.charCodeAt(i);
  }
  return diff === 0 && a.length === expected.length;
}

/**
 * 管理の指示を 1 件読む。合言葉の照合はここではやらない（呼ぶ側の仕事）。
 *
 *   { action:'rename', board:'level', level:12, name:'まえ', to:'あと' }
 *   { action:'delete', board:'stars', name:'けす' }
 *
 * 名前は投稿と同じ整えかたを通す ―― 一覧に載っているのは整えたあとの名前なので、
 * 生の文字列で指すと「見えているのに直せない」行ができる。
 */
export function readAdminAction(body) {
  if (!body || typeof body !== 'object') return null;

  const action = body.action === 'rename' || body.action === 'delete' ? body.action : null;
  if (!action) return null;

  const board = readBoard(body.board);
  // レベル別はどのレベルの表かが要る。星の表は全員で 1 つなので取らない
  const level = board === 'stars' ? null : readLevel(body.level);
  if (board !== 'stars' && level == null) return null;

  const name = sanitizeName(body.name);
  if (!name) return null;

  if (action === 'delete') return { action, board, level, name, to: null };

  const to = sanitizeName(body.to);
  // 同じ名前への付け替えは、書く先が自分自身になって行が消える。ここで弾く
  if (!to || to === name) return null;
  return { action, board, level, name, to };
}

/**
 * 索引に載っていない古い記録を拾うために、総当たりで見に行くレベルの上限。
 *
 * 索引（played 表）は**この機能を入れて以降の投稿しか載っていない**ので、
 * それだけを辿ると昔からある記録が丸ごと取り残される ―― 星の数の表から
 * 直したときに、レベル別がひとつも変わらない（消したのに残っている）という形で
 * 表に出る。記録の無いレベルを見に行くのは空振りで済むので、低いレベルは全部見に行く。
 */
export const SWEEP_MAX = 300;

/**
 * 管理の操作（直す・消す）で、実際にどのレベルの器まで手を出すか。**この順に**回る。
 *
 *   1. **いま管理者が見ている、レベル別の表** ―― 何があっても必ず直す
 *   2. **索引（played 表）にあるレベル**      ―― 総当たりの範囲より上も拾える
 *   3. **1 から SWEEP_MAX までの総当たり**    ―― 索引に無い、昔からある記録
 *
 * 1 を先頭に置くのは、頭打ち（cap）で真っ先に落ちるのが「押した本人が
 * いま見ている行」では意味がないから。2 を 3 より先に置くのも同じ理由で、
 * 索引にあるレベルは**記録があると分かっている**ぶん、空振りの総当たりより優先する。
 */
export function adminTargetLevels(indexedLevels, cmd, cap, sweepMax = SWEEP_MAX) {
  const order = [];
  const seen = new Set();
  const add = (level) => {
    if (level == null || seen.has(level)) return;
    seen.add(level);
    order.push(level);
  };

  if (cmd.board === 'level') add(cmd.level);
  for (const level of indexedLevels || []) add(level);
  for (let level = 1; level <= sweepMax; level += 1) add(level);

  return order.slice(0, cap);
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
