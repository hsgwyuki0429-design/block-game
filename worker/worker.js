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
import { readBoard, readEntry, readLevel, readLimit, readStarEntry } from './rules.mjs';

/** 一度に返せる件数の上限。要求がこれを超えても、ここで頭打ちにする */
const LIMIT_MAX = 200;

// 誰でも読めて誰でも投稿できる公開ランキングなので、配信元を問わない。
// Cookie も認証も使わないため、'*' を許しても持ち出されて困るものが無い。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
  // level なしで叩かれたら生存確認とみなす（deploy 直後の疎通確認に使える）
  if (raw == null) return json({ ok: true, service: 'slidepop-rank' });

  const level = readLevel(raw);
  if (level == null) return json({ error: 'invalid level' }, 400);

  return json({ entries: await storeFor(env, level).top(limit) });
}

async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (readBoard(body && body.board) === 'stars') {
    const entry = readStarEntry(body);
    if (!entry) return json({ error: 'invalid body' }, 400);
    return json(await starStore(env).submitStars(entry, RANK_LIMIT));
  }

  const entry = readEntry(body);
  if (!entry) return json({ error: 'invalid body' }, 400);

  const { level, ...row } = entry;
  return json(await storeFor(env, level).submit(row, RANK_LIMIT));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      if (request.method === 'GET') return await handleGet(new URL(request.url), env);
      if (request.method === 'POST') return await handlePost(request, env);
      return json({ error: 'method not allowed' }, 405);
    } catch (err) {
      // 中身は漏らさない。クライアントは失敗したら端末内の記録に切り替える
      console.error(err);
      return json({ error: 'internal error' }, 500);
    }
  },
};
