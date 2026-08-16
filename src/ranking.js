// ランキング。表は2つある。
//
//   ・**レベル別** ―― そのレベルを何手で解いたか。手数の少ない順
//   ・**星の数**   ―― その人が持っている星の総数。多い順
//
// レベル別だけだと「1つの盤面をどれだけ詰めたか」しか競えない。星の数の表は
// **どれだけ広く、どれだけ上手く解いてきたか**を1本の数字で並べる ―― 遊んだ量と
// 質が同じ物差しに乗るので、ホームから開いたときに自分の立ち位置がすぐ分かる。
//
// 方針:
//
//   ・**クリアしたら必ず記録される**。「保存しますか？」は訊かない。
//     訊くと、押し忘れた回のぶんだけランキングが実態とずれる。
//   ・名前は**自分で打つ**。初回だけ入力させ、以後はその名前を自動で使う。
//     毎回訊くのは邪魔だし、途中で変えられるとランキングが同一人物で埋まる
//     （変えたいときは設定から変えられる）。
//   ・順位は**手数の少ない順**。同着はタイムの短い順、それも同じなら先に出した方が上。
//     星ではなく手数で並べるのは、星が手数から決まる粗い階段でしかないから。
//   ・星の数の表は**星の多い順**。同数なら**クリア数の少ない順** ―― 同じ 30 個でも、
//     10 レベルで集めた人のほうが 30 レベルかけた人より上手い。それも同じなら先着順。
//
// 接続先（src/config.js の RANKING_ENDPOINT）が空のあいだは、この端末の
// localStorage にだけ貯める。世界共通に切り替えても記録の見た目は変わらない ――
// 画面には「世界」か「この端末」かだけを出す。
//
// 通信が失敗したときも、必ず端末側には残す。ランキングに載らなかったせいで
// クリアそのものが無かったことになる、という事故を起こさない。

import { RANKING_ENDPOINT } from './config.js';

/** 保存した名前。一度決めたら以後は自動で使う */
export const NAME_KEY = 'slidepop.name';
/** 端末内ランキングの置き場（レベル別） */
export const RANK_KEY = 'slidepop.rank.v1';
/** 端末内ランキングの置き場（星の数） */
export const STAR_KEY = 'slidepop.stars.v1';

/** 名前の長さの上限。長い名前は一覧で他人の行を潰す */
export const NAME_MAX = 12;
/** 1レベルあたり持っておく順位の数 */
export const RANK_LIMIT = 50;

/** 通信を諦めるまで。待たせるくらいなら端末内の記録を出す */
const TIMEOUT_MS = 7000;

/**
 * 管理の付け替えだけは長く待つ。
 * 名前 1 つの付け替えでも**その人の記録がある全レベルを直しに行く**ので、
 * ふつうの読み込みより時間がかかる ―― ここで先に諦めると、サーバでは直り
 * きっているのに画面には「届きませんでした」と出て、直っていないように見える。
 */
const ADMIN_TIMEOUT_MS = 25000;

/**
 * 分けて頼むときの、頼み直しの上限。
 * サーバが「終わった」と言い忘れても、ここで必ず止まる ―― 終わらない輪に入って
 * 画面が固まるくらいなら、諦めて理由を出したほうがいい。
 */
const ADMIN_ROUNDS_MAX = 40;

/** 接続先。末尾のスラッシュは落として揃える */
function endpoint() {
  const url = (RANKING_ENDPOINT || '').trim();
  return url ? url.replace(/\/+$/, '') : '';
}

/** 世界共通ランキングに繋がる設定になっているか */
export function isGlobalRanking() {
  return endpoint() !== '';
}

/**
 * 名前を整える。
 * 制御文字と前後の空白を落とし、連続する空白を1つに詰めてから長さで切る。
 * 空になるような入力（空白だけ・記号だけ）は受け付けない ―― 呼び出し側で弾く。
 */
export function sanitizeName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

export function savedName() {
  try {
    return sanitizeName(localStorage.getItem(NAME_KEY) || '');
  } catch {
    return '';
  }
}

export function saveName(name) {
  const clean = sanitizeName(name);
  if (!clean) return '';
  try { localStorage.setItem(NAME_KEY, clean); } catch { /* 保存できない環境では今回だけ有効 */ }
  return clean;
}

export function forgetName() {
  try { localStorage.removeItem(NAME_KEY); } catch { /* 消せなければ諦める */ }
}

// ---------------------------------------------------------------- 管理（持ち主だけ）

/**
 * 管理の合言葉の置き場。
 *
 * ランキングに載る名前は他人が打った文字列なので、見るに堪えないものが混ざりうる。
 * それを直せるのは**持ち主ひとり**でなければならない ―― 誰でも直せると、
 * 今度は 1 位の名前が書き換えられる。
 *
 * 判定はサーバでやる（`worker/worker.js` の ADMIN_KEY）。ここに持つのは
 * 「毎回打たなくていいように覚えておく」ためだけの控えで、**これ自体は鍵ではない**。
 * 端末を覗かれたら合言葉も見えるので、覗かれる端末では「やめる」で消しておくこと。
 */
export const ADMIN_KEY = 'slidepop.admin.v1';

/** 覚えている合言葉。無ければ空 */
export function adminKey() {
  try {
    return String(localStorage.getItem(ADMIN_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** 合言葉を覚える。空を渡したら忘れる（＝管理モードを降りる） */
export function saveAdminKey(key) {
  const clean = String(key == null ? '' : key).trim();
  try {
    if (clean) localStorage.setItem(ADMIN_KEY, clean);
    else localStorage.removeItem(ADMIN_KEY);
  } catch { /* 保存できない環境では今回だけ有効 */ }
  return clean;
}

/** いま管理モードか（合言葉を持っているか）。合っているかはサーバが決める */
export function isAdminMode() {
  return adminKey() !== '';
}

/** その名前の行が一覧にあるか */
export function hasName(entries, name) {
  const clean = sanitizeName(name);
  return !clean ? false : entries.some((e) => sanitizeName(e.name) === clean);
}

/**
 * 一覧の中の名前を付け替える。
 * 付け替え先に同じ名前があれば、並べ替え（rankSort / starSort）が
 * **良いほうだけを残して 1 行に潰す** ―― サーバ側の付け替えと同じ結果になる。
 */
export function renameEntries(entries, from, to, sort = rankSort) {
  const a = sanitizeName(from);
  const b = sanitizeName(to);
  if (!a || !b) return sort(entries);
  return sort(entries.map((e) => (sanitizeName(e.name) === a ? { ...e, name: b } : e)));
}

/** 一覧からその名前の行を落とす */
export function removeEntries(entries, name, sort = rankSort) {
  const clean = sanitizeName(name);
  return sort(entries.filter((e) => sanitizeName(e.name) !== clean));
}

/**
 * 直すも消すも、端末に貯めている**すべてのレベル＋星の表**へ効かせる
 * （サーバ側の editEverywhere と同じ考えかた。端末内は全データを直接
 * 持っているので、索引を作らずそのまま全部の鍵を回すだけで済む）。
 */
function editLocalEverywhere(board, level, name, to) {
  const rename = !!to;
  const apply = (entries, sort) => (rename
    ? renameEntries(entries, name, to, sort)
    : removeEntries(entries, name, sort));

  const data = loadLocal();
  let changed = false;
  for (const key of Object.keys(data)) {
    const before = data[key] || [];
    changed = changed || hasName(before, name);
    data[key] = apply(before, rankSort).slice(0, RANK_LIMIT);
  }
  saveLocal(data);

  const starsBefore = loadStars();
  changed = changed || hasName(starsBefore, name);
  const starsAfter = apply(starsBefore, starSort).slice(0, RANK_LIMIT);
  try { localStorage.setItem(STAR_KEY, JSON.stringify(starsAfter)); } catch { /* 諦める */ }

  // 応答は、いま見ている表だけを返す（他の表は裏で直っている）
  const entries = board === 'stars' ? starsAfter : (data[String(level)] || []);
  return { changed, entries };
}

/**
 * 名前を直す／記録を消す。**合言葉を持っているときだけ**通る。
 *
 * どちらも**その人の記録があるすべての表**（星の表とレベル別の全レベル）に
 * 効かせる。1 つの表だけ相手にすると、他の表に古い名前が残って「直したのに
 * 変わっていない」「消したのにまだ居る」ことになるため。
 *
 * @param {{action:'rename'|'delete', board:'level'|'stars', level?:number,
 *          name:string, to?:string}} cmd
 * @returns {Promise<{ok:boolean, entries:Object[], changed:boolean, error:string|null}>}
 *   error は画面にそのまま出せる日本語。ok が false のときだけ入る。
 *   changed は false でも ok は true になりうる（＝直す相手が見つからなかった）
 */
export async function adminEdit(cmd) {
  const board = cmd.board === 'stars' ? 'stars' : 'level';
  const name = sanitizeName(cmd.name);
  const to = sanitizeName(cmd.to);
  const rename = cmd.action === 'rename';

  if (!name) return { ok: false, entries: [], changed: false, error: '直す相手の名前が読めません。' };
  if (rename && !to) return { ok: false, entries: [], changed: false, error: '新しい名前を入れてください。' };
  if (rename && to === name) return { ok: false, entries: [], changed: false, error: '同じ名前です。' };

  const base = endpoint();
  // 端末の中だけで遊んでいるときは、その控えを直す（画面の見え方は世界共通と同じ）
  if (!base) {
    return { ok: true, ...editLocalEverywhere(board, cmd.level, name, rename ? to : ''), error: null };
  }

  const key = adminKey();
  if (!key) return { ok: false, entries: [], changed: false, error: '管理の合言葉がありません。' };

  /*
   * **何回かに分けて頼む。**
   * サーバは 1 回のリクエストで決まった数のレベルまでしか回れない
   * （Cloudflare のサブリクエスト上限。worker/worker.js の ADMIN_CHUNK に理由を書いた）。
   * 続きの位置（next）を受け取って、終わりと言われるまで頼み直す。
   */
  let cursor = 0;
  let changed = false;

  try {
    for (let round = 0; round < ADMIN_ROUNDS_MAX; round += 1) {
      const payload = await request(base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Admin-Key': key,
        },
        body: JSON.stringify({
          action: rename ? 'rename' : 'delete',
          board,
          level: cmd.level,
          name,
          cursor,
          ...(rename ? { to } : {}),
        }),
      }, ADMIN_TIMEOUT_MS);

      changed = changed || !!(payload && payload.changed);

      // done を知らない古いサーバなら、1 回で終わったものとして扱う
      const finished = !payload || payload.done !== false;
      const total = payload && Number(payload.total) > 0 ? Number(payload.total) : 0;
      cursor = payload && Number.isFinite(payload.next) ? Number(payload.next) : cursor;
      if (typeof cmd.onProgress === 'function') cmd.onProgress(cursor, total);

      if (!finished) continue;

      let entries = entriesOf(payload, board === 'stars' ? starSort : rankSort);
      if (!entries) {
        // 一覧が返ってこなかったら取り直す（直したこと自体は成功している）
        const got = board === 'stars' ? await fetchStarRanking() : await fetchRanking(cmd.level);
        entries = got.entries;
      }
      return { ok: true, entries, changed, error: null };
    }
    // ここに来るのは、終わりと言われないまま回りすぎたとき
    return { ok: false, entries: [], changed, error: 'サーバーの処理が終わりませんでした。' };
  } catch (err) {
    return { ok: false, entries: [], changed, error: failureText(err) };
  }
}

// ---------------------------------------------------------------- 端末内の記録

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(RANK_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveLocal(data) {
  try { localStorage.setItem(RANK_KEY, JSON.stringify(data)); } catch { /* 諦める */ }
}

/**
 * 並べ替えと重複の始末。
 * 同じ名前は**その人のいちばん良い1件**だけを残す。同じ人が上位を埋めると、
 * 何人が挑んだのかが分からなくなる。
 */
export function rankSort(entries) {
  const best = new Map();
  for (const e of entries) {
    const name = sanitizeName(e.name) || '???';
    const row = {
      name,
      moves: Math.max(0, Math.round(Number(e.moves) || 0)),
      time: Math.max(0, Math.round(Number(e.time) || 0)),
      stars: Math.max(0, Math.min(3, Math.round(Number(e.stars) || 0))),
      at: Number(e.at) || 0,
    };
    const cur = best.get(name);
    if (!cur || row.moves < cur.moves || (row.moves === cur.moves && row.time < cur.time)) {
      best.set(name, row);
    }
  }
  return [...best.values()].sort((a, b) => a.moves - b.moves || a.time - b.time || a.at - b.at);
}

/** 端末内ランキングを読む */
export function localEntries(level) {
  return rankSort(loadLocal()[String(level)] || []);
}

/** 端末内ランキングに1件足して、並べ直したものを返す */
function pushLocal(level, entry) {
  const data = loadLocal();
  const key = String(level);
  data[key] = rankSort([...(data[key] || []), entry]).slice(0, RANK_LIMIT);
  saveLocal(data);
  return data[key];
}

/** 端末内ランキングを空にする（「データを消す」から呼ぶ）。表は2つとも消す */
export function clearLocalRanking() {
  for (const key of [RANK_KEY, STAR_KEY]) {
    try { localStorage.removeItem(key); } catch { /* 諦める */ }
  }
}

// ---------------------------------------------------------------- 星の数の表

/**
 * 星の数の並べ替えと重複の始末。
 *
 * 星の多い順。同数ならクリア数の少ない順（同じ星を少ないレベルで集めた人が上）、
 * それも同じなら先に出した方が上。レベル別と同じく**1人1行**に潰す ――
 * 星の総数はその人の現在地なので、古い記録が並ぶ意味がない。
 */
export function starSort(entries) {
  const best = new Map();
  for (const e of entries) {
    const name = sanitizeName(e.name) || '???';
    const row = {
      name,
      stars: Math.max(0, Math.round(Number(e.stars) || 0)),
      cleared: Math.max(0, Math.round(Number(e.cleared) || 0)),
      at: Number(e.at) || 0,
    };
    const cur = best.get(name);
    if (!cur || row.stars > cur.stars || (row.stars === cur.stars && row.cleared < cur.cleared)) {
      best.set(name, row);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.stars - a.stars || a.cleared - b.cleared || a.at - b.at);
}

function loadStars() {
  try {
    const data = JSON.parse(localStorage.getItem(STAR_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** 端末内の星ランキングを読む */
export function localStarEntries() {
  return starSort(loadStars());
}

/** 端末内の星ランキングに1件足して、並べ直したものを返す */
function pushStars(entry) {
  const list = starSort([...loadStars(), entry]).slice(0, RANK_LIMIT);
  try { localStorage.setItem(STAR_KEY, JSON.stringify(list)); } catch { /* 諦める */ }
  return list;
}

// ---------------------------------------------------------------- 通信

/**
 * 応答の形を吸収する。素の配列でも { entries: [...] } でも受け取る。
 * 並べ替えはこちらでやり直す ―― サーバが正しい順で返す保証はないし、
 * 壊れた行を落とすのもこの関数の仕事。
 */
function entriesOf(payload, sort = rankSort) {
  if (Array.isArray(payload)) return sort(payload);
  if (payload && Array.isArray(payload.entries)) return sort(payload.entries);
  return null;
}

async function request(url, init = {}, timeout = TIMEOUT_MS) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  try {
    const res = await fetch(url, { ...init, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) {
      // 番号を持たせる。「届かなかった」のか「断られた」のかで、次の手がまるで違う
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * しくじりの理由を、画面にそのまま出せる日本語にする。
 * **番号を必ず添える** ―― 「サーバーに届きませんでした」だけでは、こちらも
 * 見ている人も、次にどこを見ればいいのか分からない。
 */
function failureText(err) {
  const status = err && err.status;
  if (status === 401 || status === 403) return '合言葉が違います（サーバーに断られました）。';
  if (status === 503) return 'サーバーに合言葉が設定されていません。';
  if (status === 400) return 'サーバーが指示を受け付けませんでした（400）。';
  if (status === 429) return 'サーバーが混んでいます（429）。少し待って試してください。';
  if (status) return `サーバーがエラーを返しました（${status}）。`;
  if (err && err.name === 'AbortError') return 'サーバーの返事が遅くて諦めました（時間切れ）。';
  return 'サーバーに届きませんでした（通信できません）。';
}

/**
 * ランキングを取る。
 * @returns {Promise<{entries:Object[], global:boolean, offline:boolean}>}
 *   offline = 世界共通に繋ぐ設定なのに届かなかった（端末内の記録を返している）
 */
export async function fetchRanking(level) {
  const base = endpoint();
  if (!base) return { entries: localEntries(level), global: false, offline: false };
  try {
    const url = `${base}${base.includes('?') ? '&' : '?'}level=${encodeURIComponent(level)}&limit=${RANK_LIMIT}`;
    const entries = entriesOf(await request(url, { headers: { Accept: 'application/json' } }));
    if (!entries) throw new Error('形式が違う応答');
    return { entries, global: true, offline: false, reason: null };
  } catch (err) {
    // なぜ繋がらなかったのかを持ち帰る。画面に出さないと、こちらも見ている人も
    // 「つながらない」以上のことが分からず、手の打ちようがない
    return { entries: localEntries(level), global: true, offline: true, reason: failureText(err) };
  }
}

/**
 * 記録を出す。**端末内には必ず残す**ので、通信が失敗しても記録は消えない。
 *
 * @returns {Promise<{entries:Object[], rank:number|null, global:boolean, offline:boolean}>}
 *   rank は 1 始まりの順位。分からなければ null
 */
export async function submitScore({ level, name, moves, time, stars }) {
  const entry = {
    name: sanitizeName(name) || '???',
    moves: Math.max(0, Math.round(Number(moves) || 0)),
    time: Math.max(0, Math.round(Number(time) || 0)),
    stars: Math.max(0, Math.min(3, Math.round(Number(stars) || 0))),
    at: Date.now(),
  };
  const local = pushLocal(level, entry);
  const base = endpoint();

  if (!base) {
    return { entries: local, rank: rankOf(local, entry), global: false, offline: false };
  }

  try {
    const payload = await request(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ level, ...entry }),
    });
    // サーバが一覧を返してくれたらそれを使う。返さないなら改めて取りに行く
    let entries = entriesOf(payload);
    if (!entries) {
      const got = await fetchRanking(level);
      if (got.offline) throw new Error('投稿後の取得に失敗');
      entries = got.entries;
    }
    const rank = payload && Number.isFinite(payload.rank) && payload.rank > 0
      ? Math.round(payload.rank)
      : rankOf(entries, entry);
    return { entries, rank, global: true, offline: false };
  } catch {
    return { entries: local, rank: rankOf(local, entry), global: true, offline: true };
  }
}

/** 一覧の中でその記録が何位か（1 始まり）。見つからなければ null */
export function rankOf(entries, entry) {
  if (!entries) return null;
  const name = sanitizeName(entry.name) || '???';
  const i = entries.findIndex((e) => e.name === name && e.moves === entry.moves);
  return i >= 0 ? i + 1 : null;
}

/** 星の一覧の中でその人が何位か（1 始まり）。見つからなければ null */
export function starRankOf(entries, name) {
  if (!entries) return null;
  const clean = sanitizeName(name) || '???';
  const i = entries.findIndex((e) => e.name === clean);
  return i >= 0 ? i + 1 : null;
}

// ---------------------------------------------------------------- 星の数（通信）

/** 星ランキングの入口。レベル別と同じ URL を board で振り分ける */
function starUrl(base) {
  return `${base}${base.includes('?') ? '&' : '?'}board=stars&limit=${RANK_LIMIT}`;
}

/**
 * 星の数のランキングを取る。
 * @returns {Promise<{entries:Object[], global:boolean, offline:boolean}>}
 */
export async function fetchStarRanking() {
  const base = endpoint();
  if (!base) return { entries: localStarEntries(), global: false, offline: false };
  try {
    const payload = await request(starUrl(base), { headers: { Accept: 'application/json' } });
    const entries = entriesOf(payload, starSort);
    if (!entries) throw new Error('形式が違う応答');
    return { entries, global: true, offline: false, reason: null };
  } catch (err) {
    return {
      entries: localStarEntries(), global: true, offline: true, reason: failureText(err),
    };
  }
}

/**
 * いま持っている星の数を出す。レベル別と違って**上書き**の投稿 ――
 * 星の総数はその人の現在地なので、増えるたびに同じ行を書き替えていく。
 *
 * @returns {Promise<{entries:Object[], rank:number|null, global:boolean, offline:boolean}>}
 */
export async function submitStars({ name, stars, cleared }) {
  const entry = {
    name: sanitizeName(name) || '???',
    stars: Math.max(0, Math.round(Number(stars) || 0)),
    cleared: Math.max(0, Math.round(Number(cleared) || 0)),
    at: Date.now(),
  };
  const local = pushStars(entry);
  const base = endpoint();

  if (!base) {
    return { entries: local, rank: starRankOf(local, entry.name), global: false, offline: false };
  }

  try {
    const payload = await request(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ board: 'stars', ...entry }),
    });
    let entries = entriesOf(payload, starSort);
    if (!entries) {
      const got = await fetchStarRanking();
      if (got.offline) throw new Error('投稿後の取得に失敗');
      entries = got.entries;
    }
    const rank = payload && Number.isFinite(payload.rank) && payload.rank > 0
      ? Math.round(payload.rank)
      : starRankOf(entries, entry.name);
    return { entries, rank, global: true, offline: false };
  } catch {
    return { entries: local, rank: starRankOf(local, entry.name), global: true, offline: true };
  }
}
