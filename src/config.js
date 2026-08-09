// 外部につなぐ設定。ここ以外に URL を書かない。
//
// なぜ 1 ファイルに切り出してあるか:
//   ランキングのサーバは持ち主が自分で立てるもので、このリポジトリの中には無い。
//   URL をコードのあちこちに散らすと、配信先を変えるたびに探し回ることになる。
//   ここ 1 行だけを書き換えれば、世界共通ランキングに切り替わる。

/**
 * 世界共通ランキングの接続先。
 *
 * 空のあいだは**この端末の中だけ**にランキングを貯める（遊べなくはならない）。
 * URL を入れると、そこへ投稿・取得しにいく。末尾のスラッシュは付けても付けなくてもよい。
 *
 *   例) 'https://slidepop-rank.example.workers.dev/scores'
 *
 * **この URL を直したら `npm run build` を必ず走らせること。** ブラウザが読むのは
 * src/ ではなく app.js なので、焼き直さないとここの変更は一切届かない
 * （GitHub の web エディタから直したときは .github/workflows/build.yml が代わりに焼く）。
 *
 * 接続先のサーバ本体は worker/ に入っている。`npm run rank:deploy` で上がり、
 * 上の URL の <name> の部分は wrangler.toml（リポジトリのルート）の name と揃っている。
 *
 * サーバに求める約束ごとは 2 つだけ:
 *
 *   GET  <URL>?level=12&limit=50
 *        -> { "entries": [ { "name":"...", "moves":18, "time":73, "stars":3, "at":1700000000000 }, ... ] }
 *           手数の少ない順に並べて返す。素の配列を返してもよい。
 *
 *   POST <URL>   Content-Type: application/json
 *        body    { "level":12, "name":"...", "moves":18, "time":73, "stars":3 }
 *        -> { "ok":true, "rank":4, "entries":[ ... ] }
 *           rank と entries は省略してよい（省略されたら改めて GET しに行く）。
 *
 * CORS を許す（Access-Control-Allow-Origin）ことだけ忘れないこと。
 */
export const RANKING_ENDPOINT = 'https://slidepop.hsgw-yuki0429.workers.dev/';
