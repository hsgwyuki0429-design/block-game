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

/**
 * 広告（忍者AdMax）の設定。
 *
 * どの枠も `id` が空のあいだは**広告まわりを一切動かさない** ―― 枠も出さないし、
 * 忍者AdMax のスクリプトも読み込まない。ID を入れ忘れたまま配信しても、
 * 空白が残ったり、オフライン起動の邪魔になる通信が増えたりしない。
 *
 * 入れる値は、忍者AdMax の管理画面で「広告を作成」して貰えるタグの中身。
 * 貰えるタグはこういう形をしている ――
 *
 *   <div class="admax-ads" data-admax-id="0123456789abcdef0123456789abcdef"
 *        style="display:inline-block;width:320px;height:50px;"></div>
 *   <script>(window.admaxads = window.admaxads || []).push(
 *     {admax_id:"0123456789abcdef0123456789abcdef", type:"banner"});</script>
 *   <script src="https://adm.shinobi.jp/st/t.js" async></script>
 *
 * このうち **id（data-admax-id の値）と、幅・高さ・type** をここに写す。
 * タグそのものを貼る必要はない ―― 組み立ては src/ads.js がやる。
 *
 *   id     広告ユニットの ID（英数字32桁）。空にした枠は出ない
 *   type   'banner'（固定サイズ）か 'switch'（PC/スマホ出し分け）。タグに書いてあるほう
 *   width  タグの style に書いてある幅（px）
 *   height 同じく高さ（px）。読み込み前に場所を取っておくのに使う
 *
 * 置き場所は 4 つ。要らない枠は id を空のままにしておけばよい。
 *
 *   home   ホーム画面のいちばん下
 *   levels レベル一覧のいちばん下
 *   game   ゲーム画面、盤面とツールバーのあいだ
 *   clear  レベルクリアの表示（カードの外・ボタンより下）
 *
 * **ここを直したら `npm run build` を必ず走らせること。** ブラウザが読むのは
 * src/ ではなく app.js なので、焼き直さないと設定が一切届かない。
 *
 * 忍者AdMax は審査が無いので、ID を入れて焼けばその日から出る（README の
 * 「広告」の節に、取ってくるところから書いてある）。
 */
export const ADMAX = {
  slots: {
    home:   { id: '', type: 'banner', width: 320, height: 50 },
    levels: { id: '', type: 'banner', width: 320, height: 50 },
    game:   { id: '324373f6ac260f664ab65c6869c0ea2d', type: 'banner', width: 320, height: 50 },
    clear:  { id: '24d60ba6b37c9d6d805ee39b13f5d210', type: 'banner', width: 320, height: 50 },
  },
};
