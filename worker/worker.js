// SLIDE POP! の世界共通ランキング（Cloudflare Workers）。
//
//   npm run rank:deploy    -> https://slidepop.<サブドメイン>.workers.dev/
//
// なぜ Durable Object（SQLite）なのか:
//   D1 や KV は「先に器を作って、その ID を設定ファイルに貼る」手順が要る。
//   Durable Object は **クラス名だけで結びつく** ので、作るものも貼るものも無い ――
//   `wrangler deploy` の 1 回で器から表まで揃う。表はこの下の constructor が作る。
//
//   ついでに、KV では避けられない読み書きの競合が消える。KV は「読んで・足して・書く」の
//   あいだに別の投稿が挟まると片方が消えるが、Durable Object は 1 レベルにつき 1 つの
//   インスタンスへ直列化されるので、同時にクリアされても記録は落ちない。
//
// レベルごとに別のインスタンスへ分ける（idFromName('level:12')）。
// レベルは上限なく増えるが、実際に遊ばれたレベルの器しか作られない。
//
// 表は 2 つある。レベル別（scores）と、星の総数（stars）。
// 星の表は全員が 1 つの器を共有するので、専用のインスタンス（idFromName('board:stars')）
// にだけ作られる。**クラスを増やしていない**のがここの肝 ―― 増やすと wrangler.toml に
// バインディングと migration を足すことになり、「deploy 1 回で揃う」が崩れる。

import { DurableObject } from 'cloudflare:workers';
import { RANK_LIMIT } from '../src/ranking.js';
import {
  isAdminKey, readAdminAction, adminTargetLevels, readCursor, readBoard, readEntry,
  readLevel, readLimit, readStarEntry,
} from './rules.mjs';

/**
 * 管理の合言葉を送るヘッダ。
 * body ではなくヘッダに載せるのは、投稿の本文と混ざらないようにするため ――
 * 混ぜると「name の隣に admin がある投稿」をログにそのまま出しかねない。
 */
const ADMIN_HEADER = 'X-Admin-Key';

/** 一度に返せる件数の上限。要求がこれを超えても、ここで頭打ちにする */
const LIMIT_MAX = 200;

/**
 * 管理の 1 操作で、直し（消し）に行くレベル数の上限。
 * 総当たりの範囲（SWEEP_MAX）に、索引で拾える高いレベルのぶんを足した数 ――
 * 無いと、極端な索引を持つ名前を相手にしたときに応答がいつまでも返らない。
 */
const ADMIN_LEVEL_CAP = 400;

/**
 * 1 回のリクエストで手を出すレベル数。
 *
 * **ここを大きくすると動かなくなる。** Cloudflare Workers には「1 リクエストあたりの
 * サブリクエスト数」の上限があり（無料プランで 50）、Durable Object の呼び出しも
 * ここに数えられる。300 レベルを一息に回ると上限を越えて落ち、画面には
 * 「サーバーに届きませんでした」としか出ない ―― しかも `wrangler dev --local` では
 * 上限が課されないので、手元の検証はすべて通ってしまう。
 *
 * 星の表と索引のぶん（数回）を足しても上限に余裕がある数にしてある。
 * 残りは続きの位置（next）を返して、クライアントが次のリクエストで続ける。
 */
const ADMIN_CHUNK = 20;

/**
 * いま何が動いているかの目印。**deploy が本当に届いたかを、URL を開くだけで確かめられる。**
 * 「直したのに変わらない」が、コードの問題なのか deploy が届いていないだけなのかを
 * 見分けるのに、これが無いと手も足も出ない。中身を変えたらここも上げること。
 */
const VERSION = 'admin-chunked-3';

// 誰でも読めて誰でも投稿できる公開ランキングなので、配信元を問わない。
// Cookie も認証も使わないため、'*' を許しても持ち出されて困るものが無い。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': `Content-Type, ${ADMIN_HEADER}`,
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 順位は投稿のたびに変わる。途中の箱に溜められると古い順位が出る
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

/** 1 レベルぶんの記録。同じ名前はいちばん良い 1 件だけを持つ */
export class RankStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // SQLite バックエンドの storage は同期なので、ここで作ってよい。
    // name を主キーにすることで「1 人 1 行」をサーバ側でも保証する ――
    // 並べ替えのときに間引くのではなく、そもそも 2 行目を作らせない。
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS scores (
         name  TEXT    PRIMARY KEY,
         moves INTEGER NOT NULL,
         time  INTEGER NOT NULL,
         stars INTEGER NOT NULL,
         at    INTEGER NOT NULL
       )`,
    );
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS scores_rank ON scores (moves, time, at)');

    // 星の総数の表。使うのは 'board:stars' の器だけだが、作るのは無料なので
    // 分岐は置かない（空の表が 1 つ増えるだけ）。
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS stars (
         name    TEXT    PRIMARY KEY,
         stars   INTEGER NOT NULL,
         cleared INTEGER NOT NULL,
         at      INTEGER NOT NULL
       )`,
    );
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS stars_rank ON stars (stars DESC, cleared, at)');

    /*
     * その名前が、どのレベルへ投稿したことがあるか。使うのは 'board:stars' の器だけ
     * （他の器では作るだけで空のまま）。名前を付け替えるとき、**その人の記録がある
     * すべてのレベル**を辿るのに要る ―― レベルごとに器が分かれているので、
     * 索引を持たないと「他のレベルにも同じ名前がいないか」を探しようがない。
     */
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS played (
         name  TEXT    NOT NULL,
         level INTEGER NOT NULL,
         PRIMARY KEY (name, level)
       )`,
    );
  }

  /**
   * 上位 limit 件。
   * 並びは src/ranking.js の rankSort と同じ ―― 手数の少ない順、
   * 同着はタイムの短い順、それも同じなら先に出した方が上。
   */
  top(limit) {
    return this.ctx.storage.sql.exec(
      `SELECT name, moves, time, stars, at FROM scores
        ORDER BY moves ASC, time ASC, at ASC
        LIMIT ?`,
      limit,
    ).toArray();
  }

  /**
   * 1 件足して、その人の順位と一覧を返す。
   * 前より悪い記録は書かない（自己ベストだけが残る）。順位は
   * **残っているほうの記録**に対して数える ―― 悪い記録を出した瞬間に
   * 自分の順位が下がって見えると、記録が消されたように読めてしまう。
   */
  submit(entry, limit) {
    const sql = this.ctx.storage.sql;
    const cur = sql.exec('SELECT moves, time FROM scores WHERE name = ?', entry.name).toArray()[0];
    const improved = !cur
      || entry.moves < cur.moves
      || (entry.moves === cur.moves && entry.time < cur.time);

    if (improved) {
      sql.exec(
        `INSERT INTO scores (name, moves, time, stars, at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             moves = excluded.moves, time = excluded.time,
             stars = excluded.stars, at   = excluded.at`,
        entry.name, entry.moves, entry.time, entry.stars, entry.at,
      );
    }

    const best = improved ? entry : cur;
    // 自分より前に並ぶ人数 + 1。一覧の外（51 位以下）でも順位が出せる
    const ahead = sql.exec(
      'SELECT COUNT(*) AS n FROM scores WHERE moves < ? OR (moves = ? AND time < ?)',
      best.moves, best.moves, best.time,
    ).one().n;

    return { ok: true, rank: ahead + 1, entries: this.top(limit) };
  }

  /**
   * 名前を付け替える（管理者のみ。呼ぶ前に合言葉を照らしてある）。
   *
   * 付け替え先に行があるときは **良いほうを残して 1 行に潰す** ――
   * 名前は主キーなので、そのまま UPDATE すると衝突で書けずに終わる。
   */
  rename(from, to, limit) {
    const sql = this.ctx.storage.sql;
    const row = sql.exec('SELECT moves, time, stars, at FROM scores WHERE name = ?', from)
      .toArray()[0];
    if (!row) return { ok: true, changed: false, entries: this.top(limit) };

    const dst = sql.exec('SELECT moves, time FROM scores WHERE name = ?', to).toArray()[0];
    sql.exec('DELETE FROM scores WHERE name = ?', from);

    const better = !dst
      || row.moves < dst.moves
      || (row.moves === dst.moves && row.time < dst.time);
    if (better) {
      sql.exec(
        `INSERT INTO scores (name, moves, time, stars, at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             moves = excluded.moves, time = excluded.time,
             stars = excluded.stars, at   = excluded.at`,
        to, row.moves, row.time, row.stars, row.at,
      );
    }
    return { ok: true, changed: true, entries: this.top(limit) };
  }

  /** 1 行消す（管理者のみ）。無い名前を指されても errorにはしない */
  remove(name, limit) {
    const sql = this.ctx.storage.sql;
    const had = sql.exec('SELECT name FROM scores WHERE name = ?', name).toArray().length > 0;
    if (had) sql.exec('DELETE FROM scores WHERE name = ?', name);
    return { ok: true, changed: had, entries: this.top(limit) };
  }

  /** 星の表の名前を付け替える。残すのは星の多いほう（同数ならクリア数の少ないほう） */
  renameStars(from, to, limit) {
    const sql = this.ctx.storage.sql;
    const row = sql.exec('SELECT stars, cleared, at FROM stars WHERE name = ?', from).toArray()[0];
    if (!row) return { ok: true, changed: false, entries: this.topStars(limit) };

    const dst = sql.exec('SELECT stars, cleared FROM stars WHERE name = ?', to).toArray()[0];
    sql.exec('DELETE FROM stars WHERE name = ?', from);

    const better = !dst
      || row.stars > dst.stars
      || (row.stars === dst.stars && row.cleared < dst.cleared);
    if (better) {
      sql.exec(
        `INSERT INTO stars (name, stars, cleared, at) VALUES (?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             stars = excluded.stars, cleared = excluded.cleared, at = excluded.at`,
        to, row.stars, row.cleared, row.at,
      );
    }
    return { ok: true, changed: true, entries: this.topStars(limit) };
  }

  /** 星の表から 1 行消す */
  removeStars(name, limit) {
    const sql = this.ctx.storage.sql;
    const had = sql.exec('SELECT name FROM stars WHERE name = ?', name).toArray().length > 0;
    if (had) sql.exec('DELETE FROM stars WHERE name = ?', name);
    return { ok: true, changed: had, entries: this.topStars(limit) };
  }

  /** この名前がそのレベルへ投稿したことを覚える（board:stars の器にだけ意味がある） */
  recordPlayed(name, level) {
    this.ctx.storage.sql.exec(
      'INSERT INTO played (name, level) VALUES (?, ?) ON CONFLICT DO NOTHING',
      name, level,
    );
  }

  /** その名前が投稿したことのあるレベルの一覧 */
  playedLevels(name) {
    return this.ctx.storage.sql.exec('SELECT level FROM played WHERE name = ?', name)
      .toArray().map((r) => r.level);
  }

  /** 索引からその名前を落とす（消したあとに残しておく意味が無い） */
  forgetPlayed(name) {
    this.ctx.storage.sql.exec('DELETE FROM played WHERE name = ?', name);
  }

  /** 索引側の付け替え。from の行を to へ寄せる（同じレベルの重複は落とす） */
  transferPlayed(from, to) {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'INSERT INTO played (name, level) SELECT ?, level FROM played WHERE name = ? ON CONFLICT DO NOTHING',
      to, from,
    );
    sql.exec('DELETE FROM played WHERE name = ?', from);
  }

  /**
   * 星の数の上位 limit 件。
   * 並びは src/ranking.js の starSort と同じ ―― 星の多い順、
   * 同数はクリア数の少ない順、それも同じなら先に出した方が上。
   */
  topStars(limit) {
    return this.ctx.storage.sql.exec(
      `SELECT name, stars, cleared, at FROM stars
        ORDER BY stars DESC, cleared ASC, at ASC
        LIMIT ?`,
      limit,
    ).toArray();
  }

  /**
   * 星の数を 1 件書いて、その人の順位と一覧を返す。
   *
   * レベル別と違って**遊べば遊ぶほど増える現在地**なので、来た値でそのまま
   * 上書きする ―― ただし減る向きだけは書かない。端末のデータを消してから
   * 遊び直した人の記録を、その瞬間に 0 に落としてしまわないため
   * （消したのは端末側の控えであって、集めた星の事実ではない）。
   */
  submitStars(entry, limit) {
    const sql = this.ctx.storage.sql;
    const cur = sql.exec('SELECT stars, cleared FROM stars WHERE name = ?', entry.name).toArray()[0];
    const improved = !cur
      || entry.stars > cur.stars
      || (entry.stars === cur.stars && entry.cleared < cur.cleared);

    if (improved) {
      sql.exec(
        `INSERT INTO stars (name, stars, cleared, at) VALUES (?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             stars = excluded.stars, cleared = excluded.cleared, at = excluded.at`,
        entry.name, entry.stars, entry.cleared, entry.at,
      );
    }

    const best = improved ? entry : cur;
    const ahead = sql.exec(
      'SELECT COUNT(*) AS n FROM stars WHERE stars > ? OR (stars = ? AND cleared < ?)',
      best.stars, best.stars, best.cleared,
    ).one().n;

    return { ok: true, rank: ahead + 1, entries: this.topStars(limit) };
  }
}

/** そのレベルの器を掴む */
function storeFor(env, level) {
  return env.RANK.get(env.RANK.idFromName(`level:${level}`));
}

/** 星の数はレベルを跨ぐので、全員で 1 つの器を使う */
function starStore(env) {
  return env.RANK.get(env.RANK.idFromName('board:stars'));
}

async function handleGet(url, env) {
  const limit = readLimit(url.searchParams.get('limit'), RANK_LIMIT, LIMIT_MAX);

  if (readBoard(url.searchParams.get('board')) === 'stars') {
    return json({ entries: await starStore(env).topStars(limit) });
  }

  const raw = url.searchParams.get('level');
  // level なしで叩かれたら生存確認とみなす。version は **URL を開くだけで
  // 「新しい版が本当に上がっているか」を確かめる**ための目印
  if (raw == null) return json({ ok: true, service: 'slidepop-rank', version: VERSION });

  const level = readLevel(raw);
  if (level == null) return json({ error: 'invalid level' }, 400);

  return json({ entries: await storeFor(env, level).top(limit) });
}

/**
 * 直すも消すも、**その人の記録があるすべての表**に効かせる。
 *
 * レベル別は 1 レベル 1 器に分かれているので、いま見ている 1 つの表だけ直しても
 * 「他のレベルでは古い名前のまま」「他のレベルにはまだ居る」になる ―― 直した・
 * 消したのに変わっていないように見える事故は、すべてここから起きる。
 *
 * 消すほうを 1 つの表だけに留めていたのは「消しすぎ」を避けるためだったが、
 * 実際に困るのは逆で、**消したはずの人が別の表に残っている**ほうだった。
 * 消す前には必ず訊く（画面側）ので、範囲は直すと揃える。
 */
async function editEverywhere(env, cmd, cursor) {
  const rename = cmd.action === 'rename';
  const stars = starStore(env);
  const indexed = await stars.playedLevels(cmd.name);
  const levels = adminTargetLevels(indexed, cmd, ADMIN_LEVEL_CAP);

  // この 1 回で回るぶんだけ切り出す。残りは next を返して次のリクエストに継ぐ
  const slice = levels.slice(cursor, cursor + ADMIN_CHUNK);
  const done = await Promise.all(slice.map((level) => {
    const store = storeFor(env, level);
    return rename
      ? store.rename(cmd.name, cmd.to, RANK_LIMIT)
      : store.remove(cmd.name, RANK_LIMIT);
  }));
  let changed = done.some((r) => r.changed);

  const next = cursor + slice.length;
  const finished = next >= levels.length;

  // 星の表と索引は**最後の 1 回**でだけ触る。毎回やるとサブリクエストを無駄に使い、
  // 途中で名前が変わって、残りのレベルで探す相手が居なくなる
  let starsRes = null;
  if (finished) {
    starsRes = rename
      ? await stars.renameStars(cmd.name, cmd.to, RANK_LIMIT)
      : await stars.removeStars(cmd.name, RANK_LIMIT);
    changed = changed || starsRes.changed;

    // 索引も一緒に始末する。置き去りにすると、次の付け替えで居ない名前を探しに行く
    if (rename) await stars.transferPlayed(cmd.name, cmd.to);
    else await stars.forgetPlayed(cmd.name);
  }

  // 応答には、いま管理者が見ている表の一覧だけを載せる（他の表は裏で直っている）。
  // まだ途中なら一覧は要らない ―― 画面は最後の応答で組み直す
  let entries = null;
  if (finished) {
    entries = cmd.board === 'stars'
      ? starsRes.entries
      : await storeFor(env, cmd.level).top(RANK_LIMIT);
  }

  return {
    ok: true, changed, entries, done: finished, next, total: levels.length,
  };
}

/**
 * 名前を直す・行を消す ―― **持ち主だけ**の入口。
 *
 * 合言葉は環境変数（Cloudflare のシークレット）に置く。
 *
 *   npx wrangler secret put ADMIN_KEY
 *
 * 置いていないあいだは、この入口は**開かない**（誰が何を送っても 503）――
 * 「空の合言葉なら通る」を残すと、設定し忘れた瞬間に誰でも消せる表になる。
 */
async function handleAdmin(request, env, body) {
  const secret = env.ADMIN_KEY;
  if (!secret) return json({ error: 'admin disabled' }, 503);
  if (!isAdminKey(request.headers.get(ADMIN_HEADER), secret)) {
    return json({ error: 'forbidden' }, 403);
  }

  const cmd = readAdminAction(body);
  if (!cmd) return json({ error: 'invalid body' }, 400);

  // 続きの位置。前の応答の next をそのまま返してもらう（無ければ頭から）
  const cursor = readCursor(body.cursor, ADMIN_LEVEL_CAP);
  return json(await editEverywhere(env, cmd, cursor));
}

async function handlePost(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  // 合言葉のヘッダが付いているものだけを管理の指示として読む。
  // 付いていない POST は今までどおりの投稿（古い版のクライアントが素通りする）
  if (request.headers.has(ADMIN_HEADER)) return handleAdmin(request, env, body);

  if (readBoard(body && body.board) === 'stars') {
    const entry = readStarEntry(body);
    if (!entry) return json({ error: 'invalid body' }, 400);
    return json(await starStore(env).submitStars(entry, RANK_LIMIT));
  }

  const entry = readEntry(body);
  if (!entry) return json({ error: 'invalid body' }, 400);

  const { level, ...row } = entry;
  const result = await storeFor(env, level).submit(row, RANK_LIMIT);
  // この名前がこのレベルに投稿したことを索引へ残す。名前の付け替えで全レベルを
  // 辿るのに要る ―― 応答は待たせない（遅れて書き込まれても実害は無い）
  ctx.waitUntil(starStore(env).recordPlayed(row.name, level).catch(() => {}));
  return json(result);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      if (request.method === 'GET') return await handleGet(new URL(request.url), env);
      if (request.method === 'POST') return await handlePost(request, env, ctx);
      return json({ error: 'method not allowed' }, 405);
    } catch (err) {
      // 中身は漏らさない。クライアントは失敗したら端末内の記録に切り替える
      console.error(err);
      return json({ error: 'internal error' }, 500);
    }
  },
};
