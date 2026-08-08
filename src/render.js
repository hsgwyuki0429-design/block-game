// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックは「色の付いた板」ではなく、**素材から削り出した塊**として描く。
// 順番は 接地影 → 側面の厚み → 天面のテクスチャ → 面取り → 縁 の 1 本道で、
// 素材（src/materials.js）はその道に寸法と色と塗り方を渡すだけ。
// 素材ごとに立体の作りを分岐させると、素材を足すたびに立体が壊れる。
//
// 速さについて。天面のテクスチャは 256×256 のタイルを 1 枚焼いて使い回し、
// **ブロック 1 個の絵そのものもオフスクリーンに焼いて使い回す**。
// 同じ形・同じ色のブロックは 1 枚を共有するので、盤上に 20 個あっても
// 焼くのは数枚で済む。毎フレームやるのは、その絵を貼ることだけ。
// 影のぼかしや面取りの扇を毎フレーム描くと、それだけで 60fps が出ない。

import { DIRS, DIR_KEYS } from './shapes.js';
import { mix, shade, mixHex, hexRgb, rgba, tintTowards } from './color.js';
import {
  LIGHT, materialFor, DEFAULT_MATERIAL, paletteFor, trayPaletteFor,
  scaledTile, facetColor, edgeColor, makeCanvas, texturePaletteFor,
} from './materials.js';

/** roundRect は Safari 16.4 未満に無い。無ければ自前で足す */
function installRoundRect() {
  if (typeof CanvasRenderingContext2D === 'undefined') return;
  const impl = function roundRect(x, y, w, h, r) {
    let rr = r;
    if (typeof rr === 'number') rr = [rr, rr, rr, rr];
    else if (!Array.isArray(rr)) rr = [0, 0, 0, 0];
    else if (rr.length === 1) rr = [rr[0], rr[0], rr[0], rr[0]];
    else if (rr.length === 2) rr = [rr[0], rr[1], rr[0], rr[1]];
    else if (rr.length === 3) rr = [rr[0], rr[1], rr[2], rr[1]];
    const max = Math.min(Math.abs(w), Math.abs(h)) / 2;
    const [tl, tr, br, bl] = rr.map((v) => Math.min(Math.max(Number(v) || 0, 0), max));
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    this.arcTo(x + w, y, x + w, y + tr, tr);
    this.lineTo(x + w, y + h - br);
    this.arcTo(x + w, y + h, x + w - br, y + h, br);
    this.lineTo(x + bl, y + h);
    this.arcTo(x, y + h, x, y + h - bl, bl);
    this.lineTo(x, y + tl);
    this.arcTo(x, y, x + tl, y, tl);
    return this;
  };
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = impl;
  }
  if (typeof Path2D !== 'undefined' && !Path2D.prototype.roundRect) {
    Path2D.prototype.roundRect = impl;
  }
}
installRoundRect();

// ---------------------------------------------------------------- 色

/**
 * 色は何色でも作れる。レベルが上がれば色数はいくらでも増えるので、
 * 手で選んだ一覧ではなく「隣り合う番号どうしがいちばん離れて見える色相の並び」
 * から手続き的に組み立てる。一覧を使い切ったら色相をずらし、
 * 明度も段ごとに変えるので、同じ色相が戻ってきても別の色として読める。
 */
/*
 * 色相の並び。「先頭から N 個取っても互いに離れている」ように並べてある
 * （すでに選んだどれからも遠いものを順に選ぶ貪欲順）。レベルによって使う色数が
 * 3〜12 と変わるので、どこで切っても見分けがつくことが要る。
 *
 * 並べ替えの物差しは色相の角度ではなく **Lab 空間での距離（ΔE）**。色相を等間隔に
 * 並べても、緑は 90°〜160° がまとめて「緑」に見えるのに対し、赤〜橙は数十度でも
 * 別の色に見える ―― 角度で揃えると緑ばかりが並んで見分けられなくなる。
 *
 * 12色での最小 ΔE: 素直な並びで 15、色相角で並べ替えても 15、この並びで 31。
 */
const HUES = [190, 4, 272, 118, 46, 330, 210, 168, 78, 228, 26, 308, 142, 348, 200, 64, 96, 288, 14, 258];

/** 色相ごとの見た目の明るさ補正（黄～緑は明るく見えるので少し暗く置く） */
function toneFor(hue) {
  const yellowness = Math.max(0, Math.cos(((hue - 55) * Math.PI) / 180));
  return 1 - yellowness * 0.16;
}

function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v);
  };
  return [f(0), f(8), f(4)];
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const paletteCache = [];

/**
 * 色番号 -> 色。番号はいくつでもよい（無制限）。
 * base=ブロックの色 / light=明るめ / dark=文字などに使う濃いめ / shadow="r,g,b"
 */
/** 灰色ブロックの見た目。どの色とも消えないので、彩度を持たせない */
const BLOCKER_COLOR = {
  name: '灰色（消えないブロック）',
  base: '#9a9aa2',
  light: '#c4c4cb',
  dark: '#5f5f68',
  shadow: '110,110,120',
};

export function colorFor(index) {
  if (index === -9) return BLOCKER_COLOR; // board.js の BLOCKER
  const i = Math.max(0, Math.floor(index) || 0);
  if (paletteCache[i]) return paletteCache[i];

  const lap = Math.floor(i / HUES.length);
  const hue = (HUES[i % HUES.length] + lap * 23) % 360;
  const tone = toneFor(hue);
  // 周回ごとに明るさを振って、同じ色相帯でも別の色として見えるようにする
  const shift = [0, 10, -8, 18][lap % 4];
  const sat = 68 - (lap % 3) * 7;
  const light = Math.max(30, Math.min(72, 55 * tone + shift));

  const c = {
    name: `色${i + 1}`,
    base: hex(hsl(hue, sat, light)),
    light: hex(hsl(hue, sat, Math.min(88, light + 13))),
    dark: hex(hsl(hue, Math.min(90, sat + 10), Math.max(20, light - 22))),
    shadow: hsl(hue, Math.min(90, sat + 10), Math.max(16, light - 30)).join(','),
  };
  paletteCache[i] = c;
  return c;
}

// ---------------------------------------------------------------- 進行度の色
//
// 色つきブロックは盤面に1組しかないので、その色を**進行度そのもの**に使える。
// 遠いうちは冷たい藍、近づくにつれて青緑 → 緑 → 琥珀 → 朱へ。
// 盤面と背景も同じ色相をごく薄めて追いかけるので、
// 「解に近づくほど画面全体があたたまっていく」ように見える。
//
// 数字で「あと何手」と出すより、こちらのほうが手を止めない ――
// 見ていなくても視野の端で温度が変わる。

/** 進行度 0 → 1 の色の道すじ（HSL） */
const PROGRESS_STOPS = [
  { h: 236, s: 58, l: 52 }, // 0.00 藍
  { h: 202, s: 66, l: 47 }, // 0.28 青
  { h: 158, s: 56, l: 41 }, // 0.55 翡翠
  { h: 40, s: 84, l: 49 },  // 0.80 琥珀
  { h: 10, s: 76, l: 53 },  // 1.00 朱
];
const PROGRESS_AT = [0, 0.28, 0.55, 0.8, 1];

const lerp = mix;

/** 進行度 t（0..1）の HSL を求める。色相は近いほうへ回して濁りを避ける */
function progressHsl(t) {
  const p = Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < PROGRESS_AT.length - 1 && p > PROGRESS_AT[i]) i++;
  const a = PROGRESS_STOPS[i - 1];
  const b = PROGRESS_STOPS[i];
  const span = PROGRESS_AT[i] - PROGRESS_AT[i - 1];
  const k = span > 0 ? (p - PROGRESS_AT[i - 1]) / span : 0;
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  return { h: (a.h + dh * k + 360) % 360, s: lerp(a.s, b.s, k), l: lerp(a.l, b.l, k) };
}

/** 進行度 -> 色つきブロックの色。colorFor と同じ形を返す */
export function progressColor(t) {
  const { h, s, l } = progressHsl(t);
  return {
    name: '色つきブロック',
    base: hex(hsl(h, s, l)),
    light: hex(hsl(h, s, Math.min(88, l + 14))),
    dark: hex(hsl(h, Math.min(90, s + 10), Math.max(20, l - 22))),
    shadow: hsl(h, Math.min(90, s + 10), Math.max(16, l - 30)).join(','),
  };
}

/**
 * 進行度 -> 画面の後ろに敷く色（CSS へ渡す）。
 *
 * 素材の地（baseHex）を渡すと、**色つきブロックとまったく同じ色**を薄めて返す ――
 * 背景だけが blocks と違う色だと、2 つの色が画面で喧嘩する。
 * 渡さなければ進行度の色そのもの。
 *
 * ここは段に丸めない。ブロックの色は手数の目盛りとして段で動くが、
 * 背景まで段で動くと、1 手ごとに画面全体がカクッと変わって落ち着かない。
 */
export function auraFor(t, baseHex = null, strength = 1, alpha = 0.22) {
  const hue = progressColor(t).base;
  return rgba(baseHex ? tintTowards(baseHex, hue, strength) : hue, alpha);
}

/** 色覚サポート用の記号。色数が増えても足りるよう繰り返して使う */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '▼', '⬢', '♦', '☰'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * 角を 45° で切り落とした矩形を path に足す（エメラルドカット）。
 * 落とすのは**外側の角だけ** ―― 同じブロックの隣と接している角を落とすと、
 * 塊の途中に切り欠きができて 1 個に見えなくなる。
 */
function chamferRect(path, p, cut) {
  const { px, py, pw, ph, up, down, left, right } = p;
  const x1 = px + pw;
  const y1 = py + ph;
  const c = Math.min(cut, pw / 2, ph / 2);
  const tl = (!up && !left) ? c : 0;
  const tr = (!up && !right) ? c : 0;
  const br = (!down && !right) ? c : 0;
  const bl = (!down && !left) ? c : 0;
  path.moveTo(px + tl, py);
  path.lineTo(x1 - tr, py);
  if (tr) path.lineTo(x1, py + tr);
  path.lineTo(x1, y1 - br);
  if (br) path.lineTo(x1 - br, y1);
  path.lineTo(px + bl, y1);
  if (bl) path.lineTo(px, y1 - bl);
  path.lineTo(px, py + tl);
  if (tl) path.lineTo(px + tl, py);
  path.closePath();
}

/**
 * 面取りを何枚の面に割るか、その境界の向きを決める。
 *
 * 角から角へ均等に 8 分割すると、細長いブロックでは対角線が角を通らず、
 * 長辺の途中で面が割れてしまう。だから角度は**その矩形の角の位置から逆算**する ――
 * 角の落とし（丸みなら丸みの端、面取りなら切り口の両端）を通る 8 本の線が境界。
 * こうすると額縁の留め継ぎのように、角でぴたりと 45° に合う。
 */
function facetRays(box, cut) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const c = Math.max(0.5, Math.min(cut, box.w / 2 - 0.5, box.h / 2 - 0.5));
  const { x0, y0, x1, y1 } = box;
  // 右上の切り口の始点から時計回り。点と点のあいだが 1 枚の面になる
  const pts = [
    [x1 - c, y0], [x1, y0 + c], // 右上の角
    [x1, y1 - c], [x1 - c, y1], // 右辺 → 右下の角
    [x0 + c, y1], [x0, y1 - c], // 下辺 → 左下の角
    [x0, y0 + c], [x0 + c, y0], // 左辺 → 左上の角
  ];
  // 各面の外向き法線。pts[i] と pts[i+1] のあいだの面が normals[i]
  const K = Math.SQRT1_2;
  const normals = [
    [K, -K],  // 右上の角
    [1, 0],   // 右辺
    [K, K],   // 右下の角
    [0, 1],   // 下辺
    [-K, K],  // 左下の角
    [-1, 0],  // 左辺
    [-K, -K], // 左上の角
    [0, -1],  // 上辺
  ];
  // atan2 は ±π で折り返す。そのまま arc() に渡すと、折り返した 1 枚だけが
  // 円をほぼ 1 周してしまうので、単調に増えるようにほどいておく
  const angles = pts.map(([x, y]) => Math.atan2(y - cy, x - cx));
  for (let i = 1; i < angles.length; i++) {
    while (angles[i] < angles[i - 1]) angles[i] += Math.PI * 2;
  }
  return { cx, cy, angles, normals };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cell = 30;
    this.ox = 0;
    this.oy = 0;
    this.size = 12;
    this.viewW = 1;
    this.viewH = 1;

    this.particles = [];
    this.shards = [];
    this.rings = [];
    this.flashes = [];
    this.stamps = [];
    this.shake = 0;
    this.time = 0;

    /**
     * 解へどれだけ近いか（0..1）。
     * 表示用の progress は目標へ毎フレーム少しずつ寄せる ―― 1手ごとに色が
     * ぱっと変わると「点滅」に見えてしまう。ゆっくり動くから景色になる。
     */
    this.progress = 0;
    this.progressTarget = 0;
    this._tintAt = -1;
    /** 色を何段に分けるか。レベルの最短手数がそのまま段数になる */
    this.steps = 32;

    /** ブロックの素材。設定で切り替わる */
    this.material = materialFor(DEFAULT_MATERIAL);
    /**
     * 焼き上げたブロックの絵。
     * 鍵は「素材 × 形 × 色 × マスの大きさ」。同じ鍵なら 1 枚を全員で使う。
     */
    this.pieceCache = new Map();
    /** 焼き上げた盤面。素材・大きさ・色が変わったときだけ焼き直す */
    this.trayCache = null;
    this.trayKey = '';

    this.refreshTint();

    this.options = { symbols: false, ghost: true, calm: false };
  }

  /** 素材を切り替える。焼いてある絵は全部捨てる */
  setMaterial(key) {
    const next = materialFor(key);
    if (next === this.material) return;
    this.material = next;
    this.invalidateBakes();
  }

  invalidateBakes() {
    this.pieceCache.clear();
    this.trayCache = null;
    this.trayKey = '';
    this._tintAt = -1; // 素材が変われば同じ進行度でも色が変わる
    this.refreshTint();
  }

  /**
   * 色を何段に分けるか。**そのレベルの最短手数**を渡す。
   * 40 手の盤面なら色は 40 段。1 手進めば 1 段進み、1 手遠ざかれば 1 段戻る。
   * 上下の丸めは念のための歯止めで、実際の手数（2〜300）は必ずこの中に入る。
   */
  setSteps(n) {
    const next = Math.max(4, Math.min(400, Math.round(n) || 32));
    if (next === this.steps) return;
    this.steps = next;
    this._tintAt = -1;
    this.refreshTint();
  }

  /**
   * 進行度を伝える。immediate はレベルを跨いだときだけ（前のレベルの色を
   * 引きずったまま次の盤面が出ると、いま何色なのかが意味を失う）。
   */
  setProgress(t, immediate = false) {
    this.progressTarget = Math.max(0, Math.min(1, t || 0));
    if (immediate) this.progress = this.progressTarget;
  }

  /**
   * 進行度から作った色。値が動いたときだけ作り直す。
   *
   * 刻みは**そのレベルの最短手数**（setSteps）に合わせる。残り手数が 1 減れば
   * 色がちょうど 1 段進み、遠ざかれば 1 段戻る ―― 色そのものが手数の目盛りになる。
   * 連続値のまま焼くと、進行度が動くたびに焼き直すことになって引っかかるので、
   * ここで段に丸めることが速さの担保も兼ねている。
   * 背景の光だけは丸めずに動かすので、段は目には見えない。
   */
  refreshTint() {
    const q = Math.round(this.progress * this.steps) / this.steps;
    if (this._tintAt === q) return;
    this._tintAt = q;
    this.tint = progressColor(q);
    this.stonePal = paletteFor(this.material, false, null);
    this.litPal = paletteFor(this.material, true, this.tint.base);
    this.trayPal = trayPaletteFor(this.material, this.tint.base);
  }

  /** 背景に敷く色。色つきブロックと同じ色を、うんと薄めて返す */
  auraColor(alpha = 0.22) {
    const m = this.material;
    if (m.rawTint) return auraFor(this.progress, null, 1, alpha);
    return auraFor(this.progress, m.colors.lit.mid, m.tint, alpha);
  }

  /** 背景の色がどこまで満ちているか（画面の下からの割合） */
  auraRise() {
    return 26 + this.progress * 68;
  }

  /** ブロックの色。灰色は素材そのまま、色つきは進行度の色を素材に混ぜたもの */
  palFor(colorIndex) {
    return colorIndex === -9 ? this.stonePal : this.litPal; // -9 は board.js の BLOCKER
  }

  /**
   * 演出（破片・光の輪・残像）に使う色。
   * ブロックそのものではなく「そこにあった色」を伝えられればいいので、
   * 素材の代表色 3 つに畳んで返す。
   */
  colorOf(colorIndex) {
    const pal = this.palFor(colorIndex);
    return {
      name: colorIndex === -9 ? '灰色（消えないブロック）' : '色つきブロック',
      base: pal.mid,
      light: shade(pal.top, 0.16),
      dark: pal.deep,
      shadow: hexRgb(pal.deep).join(','),
    };
  }

  resize(size) {
    if (size) this.size = size;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.viewW = w;
    this.viewH = h;

    // 盤面は正方形。画面をできるだけ大きく使う ―― 余白ではなく盤面が主役。
    // 外周は演出（光の輪）がわずかに滲む余地だけ残す
    // 外周は、トレイの枠と落ち影のぶんだけ余白を取る
    const frame = Math.max(10, Math.min(w, h) * 0.035);
    const cell = Math.floor((Math.min(w, h) - frame * 2) / this.size);
    const prev = this.cell;
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
    // マスの大きさが変われば、焼いてある絵は全部寸法違い
    if (this.cell !== prev) this.invalidateBakes();
    else { this.trayCache = null; this.trayKey = ''; }
  }

  /**
   * マスとマスのすき間。素材ごとに決まる（石は目地が広く、金属は詰まっている）。
   * ここが空いているぶんだけ、下のトレイと落ち影が見える ＝ 厚みが読める。
   */
  get tileGap() { return Math.max(1, this.cell * this.material.gap); }
  get tileSize() { return this.cell - this.tileGap * 2; }
  get tileRadius() { return Math.max(1.5, this.cell * (this.material.radius || 0.12)); }
  /** ブロックの厚み（側面の見える高さ） */
  get depth() { return Math.max(1.5, this.cell * this.material.depth); }
  /** 面取りの幅 */
  get bevel() { return Math.max(1.5, this.cell * this.material.bevel); }

  /** 画面座標 -> 盤面セル */
  toCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.ox) / this.cell);
    const y = Math.floor((clientY - rect.top - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }

  cellCenter(x, y) {
    return { x: this.ox + (x + 0.5) * this.cell, y: this.oy + (y + 0.5) * this.cell };
  }

  // ---------------------------------------------------------------- 演出
  //
  // 消えた瞬間の報酬は「光」だけで作る。文字は一切出さない。
  //   マスが光に開く -> 破片が散る -> リングが広がる -> 画面が一瞬白む
  // 連鎖が深いほど強度が上がり、音程の階段と一緒に効いてくる。

  /** 消えたマスそのものが光になって開く */
  shatter(cells, colorIndex) {
    const c = this.colorOf(colorIndex);
    for (const [x, y] of cells) {
      this.shards.push({ x, y, color: c.light, life: 1 });
    }
  }

  /** 砕けた破片が飛び散る */
  burst(cells, colorIndex, strength = 1) {
    const c = this.colorOf(colorIndex);
    const n = this.options.calm ? 3 : Math.round(9 + strength * 3);
    for (const [cx, cy] of cells) {
      const p = this.cellCenter(cx, cy);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.5 + Math.random() * 3.1) * this.cell * 0.06;
        const white = Math.random() < 0.3;
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * this.cell * 0.6,
          y: p.y + (Math.random() - 0.5) * this.cell * 0.6,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - this.cell * 0.04,
          g: this.cell * 0.011,
          life: 1,
          decay: 0.015 + Math.random() * 0.018,
          size: this.cell * (white ? 0.05 : 0.09 + Math.random() * 0.18),
          radius: white ? 0.5 : 0.3,
          color: white ? '#ffffff' : (Math.random() < 0.45 ? c.light : c.base),
          spin: (Math.random() - 0.5) * 0.34,
          rot: Math.random() * Math.PI,
        });
      }
    }
  }

  /** 色のついた光の輪が広がる */
  ring(x, y, colorIndex, strength = 1) {
    const c = this.colorOf(colorIndex);
    this.rings.push({
      x, y,
      r: this.cell * 0.3,
      maxR: this.cell * (2.2 + strength * 1.6),
      life: 1,
      color: c.shadow,
      glow: c.light,
    });
  }

  /** 消えた瞬間のフラッシュ（報酬のトリガー） */
  flash(x, y, strength = 1) {
    if (this.options.calm) return;
    this.flashes.push({ x, y, r: this.cell * (2.6 + strength * 1.8), life: 1 });
  }

  /**
   * ブロックの上にスタンプを貼る（👍）。
   *
   * 手が良かったことを伝える唯一の「文字」。数字でも文章でもないので読む必要がなく、
   * 目を上げずに済む ―― 盤面から視線を外させないための形。
   * ひとつずつ間を置いて出し、跳ねてから浮き上がって消える。
   */
  stamp(cells, text = '👍', count = 3) {
    if (!cells || cells.length === 0) return;
    for (let i = 0; i < count; i++) {
      const [cx, cy] = cells[Math.floor(Math.random() * cells.length)];
      const p = this.cellCenter(cx, cy);
      this.stamps.push({
        x: p.x + (Math.random() - 0.5) * this.cell * 0.9,
        y: p.y + (Math.random() - 0.5) * this.cell * 0.7,
        rot: (Math.random() - 0.5) * 0.44,
        // マスに比例させつつ頭打ちを付ける。4×4 の盤面はマスが大きく、
        // 比例させただけだとスタンプがブロックより大きくなって盤面が読めなくなる
        size: Math.min(this.cell * (0.62 + Math.random() * 0.24), 46),
        // 3個が同時に出ると1個の大きな塊に見える。少しずつずらして「増えていく」
        delay: i * 0.11,
        life: 1,
        text,
      });
    }
  }

  addShake(amount) {
    if (this.options.calm) amount *= 0.3;
    this.shake = Math.min(22, this.shake + amount);
  }

  clearEffects() {
    this.particles.length = 0;
    this.shards.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
    this.stamps.length = 0;
    this.shake = 0;
  }

  // ---------------------------------------------------------------- 描画

  draw(view, dt) {
    const ctx = this.ctx;
    this.time += dt;

    // 進行度は目標へ寄せるだけ。1フレームで 6% ずつ詰めると、1手ぶんの変化が
    // 0.5秒ほどかけて渡る ―― 変化に気づけて、かつ気を取られない速さ
    if (this.progress !== this.progressTarget) {
      const k = 1 - Math.pow(1 - 0.06, Math.max(0.5, dt * 60));
      this.progress += (this.progressTarget - this.progress) * k;
      if (Math.abs(this.progressTarget - this.progress) < 0.0008) this.progress = this.progressTarget;
    }
    this.refreshTint();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0.15) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.85, dt * 60);
    } else {
      this.shake = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);

    this.drawTray(view.board);
    this.drawPieces(view);
    if (view.selected != null && !view.ghost && !view.anim) {
      this.drawMoveHints(view.board, view.selected);
    }
    if (view.ghost && this.options.ghost) this.drawGhost(view);

    this.drawShards(dt);
    this.drawRings(dt);
    this.drawFlashes(dt);
    this.drawParticles(dt);
    this.drawStamps(dt);

    ctx.restore();
  }

  /**
   * 盤面（トレイ）。
   *
   * ブロックが**中に収まっている**ことを見せたいので、枠は 1 段高く、床は
   * 1 段低く描く。高いところは上面が明るく、低いところは上端に影が落ちる ――
   * 明暗の付け方をひっくり返すだけで、同じ形が「出っ張り」にも「窪み」にも見える。
   *
   * 空きマスはさらにもう 1 段深い窪みにしてある。通路がどこにあるかは
   * このゲームでいちばん読みたい情報なので、影の濃さで他と差を付ける。
   */
  drawTray(board) {
    /*
     * 平らな盤面は焼かずに、その場で描く。
     *
     * プレーンは盤面の色も進行度を追いかけるので、焼いてしまうと色が 1 段動くたびに
     * 盤面ぶんのキャンバスを作り直すことになる ―― 大きな盤面で 1 手ごとに 55ms
     * 止まった。中身は角丸の塗り 2 枚しか無いので、毎フレーム直に描くほうがずっと軽い。
     */
    if (this.material.flat) {
      this.bakeFlatTray(this.ctx, board, this.trayPal, this.ox, this.oy, this.cell * this.size);
      return;
    }
    const key = `${this.material.key}|${this.cell}|${this.size}|${this.ox},${this.oy}`
      + `|${this.trayPal ? this.trayPal.key : ''}|${this.emptyKey(board)}`;
    if (this.trayKey !== key || !this.trayCache) {
      this.trayCache = this.bakeTray(board);
      this.trayKey = key;
    }
    if (this.trayCache) {
      const t = this.trayCache;
      this.ctx.drawImage(t.canvas, t.x, t.y, t.w, t.h);
    }
  }

  /** 空きマスの並び。ここが変わったときだけトレイを焼き直せばいい */
  emptyKey(board) {
    if (!board) return '';
    const out = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) if (board.at(x, y) === -1) out.push(`${x}.${y}`);
    }
    return out.join(',');
  }

  bakeTray(board) {
    const mat = this.material;
    const pal = this.trayPal;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    // 枠の幅。盤面が小さいほど相対的に太くして、額縁らしく見せる
    const frame = Math.max(6, cell * 0.3);
    const outPad = Math.ceil(frame + cell * 0.3);
    const side = w + outPad * 2;
    const s = this.dpr;
    const cv = makeCanvas(side * s, side * s);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    ctx.scale(s, s);
    const x0 = outPad;
    const y0 = outPad;
    const radius = Math.max(6, cell * 0.3);

    const grain = mat.grain == null ? 1 : mat.grain;

    // --- 落ち影（盤面そのものが台の上に置かれている） ---
    ctx.save();
    ctx.shadowColor = 'rgba(24,22,20,0.3)';
    ctx.shadowBlur = cell * 0.4;
    ctx.shadowOffsetY = cell * 0.16;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2, radius);
    ctx.fill();
    ctx.restore();

    // --- 枠 ---
    const outerRect = new Path2D();
    outerRect.roundRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2, radius);
    ctx.save();
    ctx.clip(outerRect);
    ctx.fillStyle = pal.frame;
    ctx.fillRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2);
    const framePal = {
      top: shade(pal.frame, 0.18), mid: pal.frame, deep: shade(pal.frame, -0.24), side: pal.frame,
    };
    this.fillTexture(ctx, scaledTile(mat, framePal, cell * 3.4 * this.dpr), 0.85 * grain);
    // 枠は 1 段高い ―― 上端が明るく、下端が暗い
    const fg = ctx.createLinearGradient(0, y0 - frame, 0, y0 + w + frame);
    fg.addColorStop(0, 'rgba(255,255,255,0.32)');
    fg.addColorStop(0.5, 'rgba(255,255,255,0)');
    fg.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = fg;
    ctx.fillRect(x0 - frame, y0 - frame, w + frame * 2, w + frame * 2);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0 - frame + 0.5, y0 - frame + 0.5, w + frame * 2 - 1, w + frame * 2 - 1, radius);
    ctx.stroke();
    ctx.restore();

    // --- 床（1 段低い。上端に枠の影が落ちる） ---
    const floorPad = frame * 0.34;
    const floor = new Path2D();
    floor.roundRect(x0 - floorPad, y0 - floorPad, w + floorPad * 2, w + floorPad * 2,
      Math.max(3, radius * 0.6));
    ctx.save();
    ctx.clip(floor);
    ctx.fillStyle = pal.floor;
    ctx.fillRect(x0 - floorPad, y0 - floorPad, w + floorPad * 2, w + floorPad * 2);
    // 枠と同じ模様が続かないようにずらす
    this.fillTexture(ctx, scaledTile(mat, framePal, cell * 2.4 * this.dpr), 0.5 * grain, 37, 61);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x0 - floorPad, y0 - floorPad, w + floorPad * 2, w + floorPad * 2);
    ctx.restore();
    this.insetShadow(ctx, floor, cell * 0.34, 0.5);

    // --- 空きマス（もう 1 段深い窪み） ---
    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    const holes = new Path2D();
    let any = false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        holes.roundRect(x0 + x * cell + gap, y0 + y * cell + gap, size, size, tr);
        any = true;
      }
    }
    if (any) {
      ctx.save();
      ctx.clip(holes);
      ctx.fillStyle = pal.well;
      ctx.fillRect(0, 0, side, side);
      this.fillTexture(ctx, scaledTile(mat, framePal, cell * 2 * this.dpr), 0.38 * grain, 13, 29);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, 0, side, side);
      ctx.restore();
      this.insetShadow(ctx, holes, cell * 0.22, 0.62);
    }

    return { canvas: cv, x: this.ox - outPad, y: this.oy - outPad, w: side, h: side };
  }

  /**
   * 平らな盤面（プレーン）。
   *
   * ブロックと同じ寸法・同じすき間の淡いマスを敷き詰めただけの面で、影も枠も無い。
   * 上半分だけを 1px の白い線でなぞる ―― ガラス板の縁が光を拾ったときの 1 本で、
   * これだけで面が「浮いている」ように見える。
   */
  bakeFlatTray(ctx, board, pal, x0, y0, w) {
    const n = this.size;
    const cell = this.cell;
    const pad = Math.max(2, cell * 0.06);
    const radius = Math.max(6, cell * 0.24);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, radius);
    ctx.fillStyle = pal.floor;
    ctx.fill();
    ctx.clip();
    /*
     * 縁の光は上半分だけ。**短い矩形をなぞるのではなく、消えていく線でなぞる** ――
     * 短い矩形だと下辺がそのまま残り、盤面の真ん中に横線が 1 本走る（走っていた）。
     */
    const rim = ctx.createLinearGradient(0, y0 - pad, 0, y0 - pad + (w + pad * 2) * 0.55);
    rim.addColorStop(0, 'rgba(255,255,255,.85)');
    rim.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0 - pad + 0.5, y0 - pad + 0.5, w + pad * 2 - 1, w + pad * 2 - 1, radius);
    ctx.stroke();
    ctx.restore();

    // 空きマスだけ、ほんの少し明るく抜く（通路がそのまま読めればいい）
    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    ctx.save();
    ctx.fillStyle = pal.well;
    ctx.beginPath();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        ctx.roundRect(x0 + x * cell + gap, y0 + y * cell + gap, size, size, tr);
      }
    }
    ctx.fill();
    ctx.restore();
  }

  /**
   * 窪みの内側に落ちる影。
   * 形の内側を切り抜き、外側を塗った面に影を落とすと、影だけが内側へ回り込む ――
   * これが「へこんでいる」ことのいちばん確かなしるしになる。
   */
  insetShadow(ctx, path, blur, strength) {
    ctx.save();
    ctx.clip(path);
    ctx.shadowColor = `rgba(18,16,14,${strength})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = blur * 0.34;
    // 外側だけを塗る（even-odd で「とても大きな矩形 − この形」を作る）
    const outside = new Path2D();
    outside.rect(-2000, -2000, 6000, 6000);
    outside.addPath(path);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill(outside, 'evenodd');
    ctx.restore();
  }

  /**
   * 盤上のブロックを全部描く。
   *
   * 描く順を「画面の下にあるものほど後」にしてある。ブロックには厚みがあり、
   * 手前（下）のブロックは奥（上）のブロックの側面を隠す ―― 順を守らないと、
   * 下のブロックの向こう側に上のブロックの側面が突き抜けて見える。
   */
  drawPieces(view) {
    const { board, anim, selected, invalid } = view;
    if (!board) return;

    const list = [];
    for (const piece of board.pieces.values()) {
      let dx = 0;
      let dy = 0;
      let squash = 0;

      if (anim && anim.pieceId === piece.id) {
        const d = DIRS[anim.dir];
        if (anim.phase === 'slide') {
          const p = easeOutCubic(anim.t);
          dx = -d.x * anim.steps * this.cell * (1 - p);
          dy = -d.y * anim.steps * this.cell * (1 - p);
        } else if (anim.phase === 'land') {
          // 進行方向につぶれて戻る（ぶつかった手応え）
          squash = Math.sin(anim.t * Math.PI) * 0.16;
        }
      }

      if (invalid && invalid.pieceId === piece.id) {
        const d = DIRS[invalid.dir];
        const k = Math.sin(invalid.t * Math.PI * 6) * (1 - invalid.t) * this.cell * 0.16;
        dx += d.x * k;
        dy += d.y * k;
      }

      let bottom = -Infinity;
      for (const [, y] of piece.cells) if (y > bottom) bottom = y;
      list.push({ piece, dx, dy, squash, depth: bottom * this.cell + dy });
    }
    list.sort((a, b) => a.depth - b.depth);

    // 残像は全部のブロックより下に敷く（塊の下をくぐって見えるように）
    if (anim && anim.phase === 'slide') {
      const moving = board.pieces.get(anim.pieceId);
      if (moving) this.drawTrail(moving, DIRS[anim.dir], anim, easeOutCubic(anim.t));
    }

    for (const item of list) {
      const axis = anim && anim.pieceId === item.piece.id ? anim.dir : null;
      this.drawPiece(item.piece, item.dx, item.dy, 1, item.squash,
        selected === item.piece.id, 'solid', axis);
    }
  }

  // ---------------------------------------------------------------- ブロックを焼く

  /**
   * 素材のタイルを敷く。
   *
   * **必ず画素そのままの座標で敷くこと。** 変換行列に拡大が掛かったまま
   * createPattern を敷くと、繰り返しの継ぎ目に半端な画素が挟まり、
   * ブロックの上を白い格子の線が走る（実機ではっきり見えた）。
   * 切り抜き（clip）は変換を戻しても効いたままなので、ここだけ等倍に落とせばよい。
   */
  fillTexture(ctx, tile, alpha, offsetX = 0, offsetY = 0) {
    if (!tile) return;
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    const ox = Math.round(offsetX);
    const oy = Math.round(offsetY);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.translate(ox, oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(-ox, -oy, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /** ブロックの外接矩形（セル単位） */
  cellBounds(cells) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
  }

  /** 形の指紋。同じ形なら同じ絵を使い回せる */
  shapeKey(cells, minX, minY) {
    return cells.map(([x, y]) => `${x - minX}.${y - minY}`).sort().join('-');
  }

  /**
   * ブロック 1 個の絵をオフスクリーンに焼く。
   *
   * 影のぼかし・面取りの扇・テクスチャの敷き込みは、どれも 1 個あたり
   * 10 回近い描画になる。盤上に 20 個あると毎フレーム 200 回。
   * 焼いてしまえば毎フレームやるのは drawImage 1 回だけになる。
   *
   * @param {number[][]} cells 盤面座標のセル
   * @param {object} pal 色（materials.paletteFor）
   * @param {number} variant 同じ形でもテクスチャの位置をずらすための番号
   * @param {boolean} colored 色つきブロックか（灰色は進行度の色を被せない）
   */
  bakePiece(cells, pal, variant, colored) {
    const mat = this.material;
    const cell = this.cell;
    const { minX, minY, cols, rows } = this.cellBounds(cells);
    const depth = this.depth;
    // 影と厚みがはみ出すぶんの余白。平らな素材は何もはみ出さないので 1px でいい
    const pad = mat.flat ? 1 : Math.ceil(depth + cell * 0.34);
    const w = cols * cell + pad * 2;
    const h = rows * cell + pad * 2;
    // 画素密度ぶん大きく焼いて、貼るときに CSS 画素へ戻す。
    // 等倍で焼くと Retina で 2 倍に引き伸ばされ、面取りの稜線がぼやける
    const s = this.dpr;
    const cv = makeCanvas(w * s, h * s);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    ctx.scale(s, s);

    const ox = pad - minX * cell;
    const oy = pad - minY * cell;
    const gap = this.tileGap;
    const bevel = this.bevel;
    const radius = this.tileRadius;
    const chamfer = mat.chamfer ? mat.chamfer * cell : 0;

    const rects = this.rectsFor(cells, ox, oy, gap, radius);
    const outer = this.pathOf(rects, chamfer);
    const box = this.bboxOf(rects);

    /*
     * 平らな素材（プレーン）はここで終わり。
     *
     * 立体の経路を薄くするのではなく、**通らない**。接地影も側面も面取りも縁の線も
     * 無いので、目が拾うものが「色と形」だけになる ―― どのブロックがどこまでかを
     * いちばん速く読めるのがこの見た目で、だから既定にしてある。
     */
    if (mat.flat) {
      ctx.fillStyle = pal.mid;
      ctx.fill(outer);
      return { canvas: cv, pad, minX, minY, w, h };
    }

    // 卓面（面取りの内側）。角の落としも面取りのぶんだけ小さくなる
    const innerCut = chamfer ? Math.max(1, chamfer - bevel * 0.7) : Math.max(0.5, radius - bevel * 0.6);
    const innerRects = this.rectsFor(cells, ox, oy, gap + bevel, innerCut);
    const inner = this.pathOf(innerRects, chamfer ? innerCut : 0);

    // 順番が意味を持つ。
    //
    // 面取りは「輪郭と卓面のあいだの輪」だが、**輪を even-odd で切り抜いてはいけない**。
    // ブロックが複数マスにまたがると、マスの継ぎ目で内側の輪郭が重なり、
    // そこだけ半端な被覆率になって細い線が走る（盤面にマス目が浮いて見えた）。
    // 代わりに「面取りを一面に塗ってから、卓面をその上に重ねて隠す」―― こうすれば
    // 輪は塗り重ねの差として現れるだけで、切り抜きが要らない。
    // 縁をなぞるとき用の、外周だけの 1 本の輪郭（マスの境目を含まない）
    const rim = this.boundaryOf(cells, rects, box, radius, chamfer);
    const innerBox = this.bboxOf(innerRects);
    const innerRim = this.boundaryOf(cells, innerRects, innerBox, innerCut, chamfer ? innerCut : 0);

    const skin = {
      pal, mat, cols, rows, variant, box,
      colored,
      tintHex: this.tint.base,
    };
    this.bakeShadow(ctx, outer, rim, mat, cell, depth);
    this.bakeSide(ctx, outer, box, pal, mat, depth);
    // 天面をいったん全面に描く。面取りはこの上に乗せる
    this.bakeFace(ctx, outer, skin, 1);
    if (mat.bevelStyle === 'facet') {
      // 留め継ぎの面。いったん全面を面の色で塗り、卓面を上から重ねて中央を隠す ――
      // 輪だけを even-odd で切り抜くと、マスの継ぎ目に線が残る
      this.bakeFacets(ctx, outer, box, pal, mat, chamfer || radius * 0.85);
      this.bakeTable(ctx, inner, skin);
    } else {
      this.bakeSoftBevel(ctx, outer, rim, box, pal, mat);
    }
    this.bakeEdge(ctx, rim, innerRim, pal, mat, cell);

    return { canvas: cv, pad, minX, minY, w, h };
  }

  /**
   * 接地影。
   * いったん影を落としてから**内側をくり抜く** ―― くり抜かないと、影を落とすために
   * 塗った面がブロックの下に残り、透けるクリスタルで真っ黒に見えてしまう。
   */
  bakeShadow(ctx, outer, rim, mat, cell, depth) {
    ctx.save();
    ctx.shadowColor = `rgba(26,24,22,${mat.shadow})`;
    ctx.shadowBlur = cell * 0.16;
    ctx.shadowOffsetX = cell * 0.018;
    ctx.shadowOffsetY = depth * 0.72 + cell * 0.05;
    ctx.fillStyle = '#000';
    ctx.fill(outer);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(outer);
    // 塗りだけだと縁の半端な画素が残り、黒い髪の毛のような線になる。
    // 外周を 1px の線でもなぞって、その半端まで消す
    ctx.lineWidth = 1;
    ctx.stroke(rim);
    ctx.restore();
  }

  /** 側面。塊の厚み。下へ押し出したぶんが、すき間から帯になって見える */
  bakeSide(ctx, outer, box, pal, mat, depth) {
    ctx.save();
    ctx.translate(0, depth);
    const g = ctx.createLinearGradient(0, box.y0, 0, box.y1 + depth);
    g.addColorStop(0, pal.side);
    g.addColorStop(0.55, mixHex(pal.side, pal.deep, 0.5));
    g.addColorStop(1, shade(pal.deep, -0.26));
    ctx.fillStyle = g;
    ctx.fill(outer);
    ctx.restore();
  }

  /**
   * 素材の地。指定された形に、色とテクスチャだけを敷く。
   * タイル 1 枚はおよそ 3 マスぶん。マスが小さくても、木目や石の粒が
   * 「そのブロックに対して」同じ割合で見える。
   * 木と金属は筋を長辺に沿わせる ―― 板の取り方が変われば、別の板に見える。
   */
  bakeSurface(ctx, box, skin, alpha) {
    const { pal, mat, cols, rows, variant, colored } = skin;
    const along = (mat.key === 'wood' || mat.key === 'metal') && rows > cols;
    // タイルは**素材そのものの色**で焼く。進行度で焼き直すと、色が 1 段動くたびに
    // 数十ミリ秒止まる。色は下の「色相を被せる」ひと塗りで付ける
    const tile = scaledTile(mat, texturePaletteFor(mat, colored), this.cell * 3 * this.dpr, along);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.mid;
    ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
    /*
     * 模様は**地の上に薄く重ねる**。
     *
     * 昔はここを不透明で敷いていたが、マスが 40px 前後まで小さくなると
     * 粒や織り目が形と同じ細かさになり、ブロックの輪郭が模様に埋もれて読めなくなる。
     * grain のぶんだけ透かして、下のベタ塗りを残す ―― 素材は「触れそうな表面」に
     * 見えればよく、拡大鏡で見るためのものではない。
     */
    // 同じ形のブロックでも模様の位置をずらす（並ぶと繰り返しが目に付く）
    if (tile) {
      this.fillTexture(ctx, tile, alpha * (mat.grain == null ? 1 : mat.grain),
        tile.width * variant * 0.37, tile.height * variant * 0.61);
    }
    ctx.globalAlpha = 1;

    /*
     * 進行度の色相を被せる。
     *
     * 'color' は「色相と彩度は塗った色、明るさは下のまま」という混ぜ方。
     * ふつうの半透明で塗ると陰影まで一緒に薄まって、木目も石の粒も潰れる ――
     * これなら凹凸はそのまま残り、色だけが変わる。
     */
    if (colored && mat.tint > 0 && skin.tintHex) {
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = alpha * mat.tint;
      ctx.fillStyle = skin.tintHex;
      ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
      ctx.restore();
    }
  }

  /**
   * 天面。素材の地を敷き、その上に帯・斜めの明暗・艶を重ねる。
   * 面取りの前に全面へ、面取りのあとに卓面へ ―― 同じ関数を 2 度使う。
   */
  bakeFace(ctx, path, skin, alpha) {
    const { pal, mat, box } = skin;
    ctx.save();
    ctx.clip(path);

    this.bakeSurface(ctx, box, skin, alpha);

    // 帯状の映り込み（金属だけ）。研磨の筋と直交する向きに置く
    if (mat.banded) {
      const g = ctx.createLinearGradient(0, box.y0, 0, box.y1);
      // 帯は 3 本まで。以前は 5 本入れていたが、板ではなく波板に見えた
      g.addColorStop(0, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.02)');
      g.addColorStop(0.44, 'rgba(0,0,0,0.16)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0.14)');
      ctx.fillStyle = g;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }

    // 斜めの明暗。光の来ている側が明るい
    const s = mat.sheen;
    if (s > 0) {
      const g = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
      g.addColorStop(0, `rgba(255,255,255,${s * 0.5})`);
      g.addColorStop(0.42, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(20,16,12,${s * 0.4})`);
      ctx.fillStyle = g;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }

    // 艶。左上寄りに広い光の溜まりを置く
    if (mat.gloss > 0.15) {
      const r = Math.max(box.w, box.h) * 0.62;
      const g = ctx.createRadialGradient(
        box.x0 + box.w * 0.3, box.y0 + box.h * 0.2, 0,
        box.x0 + box.w * 0.3, box.y0 + box.h * 0.2, r,
      );
      g.addColorStop(0, `rgba(255,255,255,${mat.gloss * 0.26})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }

    ctx.restore();
  }

  /**
   * 卓面。面取りを塗ったあとに、その中央だけを塗り直して隠す。
   * 透ける素材はいったん下を消してから薄く塗る ―― 消さないと、下に敷いた
   * 面取りと側面が透けて、トレイではなく自分の影を見ることになる。
   */
  bakeTable(ctx, inner, skin) {
    const { mat, box } = skin;
    if (mat.translucent) {
      ctx.save();
      ctx.clip(inner);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
      ctx.restore();
    }
    this.bakeFace(ctx, inner, skin, mat.translucent || 1);
  }

  /**
   * 留め継ぎの面取り（金属・クリスタル）。
   * 中心から 8 方向へ扇を放ち、面ごとに明るさを変える。角度は矩形の角から
   * 逆算してあるので（facetRays）、角でぴたりと 45° に合う。
   * ここでは全面を塗り、中央は卓面で隠す ―― 輪を切り抜くとマスの継ぎ目に線が出る。
   */
  bakeFacets(ctx, outer, box, pal, mat, cut) {
    const { cx, cy, angles, normals } = facetRays(box, cut);
    const r = Math.hypot(box.w, box.h);
    ctx.save();
    ctx.clip(outer);
    ctx.globalAlpha = mat.bevelAlpha == null ? 1 : mat.bevelAlpha;
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i];
      const a1 = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
      ctx.fillStyle = facetColor(mat, pal, normals[i][0], normals[i][1]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 丸い縁の面取り（石・木・紙・布）。
   *
   * 面では割らない。輪郭を**太さを変えながら何度もなぞる** ―― 太くて薄い線から
   * 細くて濃い線へ重ねると、縁でいちばん強く、内へ向かって滑らかに消える帯になる。
   * 内側の輪郭で切り抜くやり方だと、そこに硬い境目が出て「丸み」に見えない。
   */
  bakeSoftBevel(ctx, outer, rim, box, pal, mat) {
    const bevel = this.bevel;
    const r = Math.hypot(box.w, box.h) / 2;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const g = ctx.createLinearGradient(
      cx + LIGHT.x * r, cy + LIGHT.y * r,
      cx - LIGHT.x * r, cy - LIGHT.y * r,
    );
    g.addColorStop(0, facetColor(mat, pal, LIGHT.x, LIGHT.y));
    g.addColorStop(0.5, facetColor(mat, pal, -LIGHT.y, LIGHT.x));
    g.addColorStop(1, facetColor(mat, pal, -LIGHT.x, -LIGHT.y));

    const alpha = mat.bevelAlpha == null ? 1 : mat.bevelAlpha;
    ctx.save();
    ctx.clip(outer);
    ctx.strokeStyle = g;
    ctx.lineJoin = 'round';
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      ctx.globalAlpha = alpha * (0.26 + i * 0.16);
      ctx.lineWidth = bevel * 2 * (1 - i / steps);
      ctx.stroke(rim);
    }
    ctx.restore();
  }

  /** 縁の線と、クリスタルの稜線 */
  bakeEdge(ctx, rim, innerRim, pal, mat, cell) {
    ctx.save();
    ctx.lineWidth = Math.max(1, cell * 0.018);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = edgeColor(pal);
    ctx.stroke(rim);
    ctx.restore();

    if (!mat.prism) return;
    // 面と面の継ぎ目が光を拾う。ガラスの「エッジの線」はこれで出る
    ctx.save();
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke(innerRim);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, cell * 0.014);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke(rim);
    ctx.restore();
  }

  drawTrail(piece, d, anim, p) {
    const ctx = this.ctx;
    const c = this.colorOf(piece.color);
    const total = anim.steps * this.cell;
    const cell = this.cell;
    for (let i = 1; i <= 3; i++) {
      const back = Math.min(1, (1 - p) + i * 0.09);
      const dx = -d.x * total * back;
      const dy = -d.y * total * back;
      ctx.save();
      ctx.globalAlpha = 0.14 * (1 - i / 4) * Math.min(1, p * 3);
      ctx.fillStyle = c.base;
      for (const [cx, cy] of piece.cells) {
        ctx.beginPath();
        ctx.roundRect(
          this.ox + cx * cell + dx + this.tileGap,
          this.oy + cy * cell + dy + this.tileGap,
          this.tileSize, this.tileSize, this.tileRadius,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * セル群 -> 矩形の並び。
   *
   * 同じブロックの隣り合うマスは、接する側のすき間と角丸を 0 にして繋げる ――
   * こうすると L 字でも凹型でも「1 個の塊」に見える。
   * pad を大きくすると、そのぶん内側へ縮んだ相似形になる（面取りの内側の輪郭）。
   */
  rectsFor(cells, ox, oy, pad, r) {
    const cell = this.cell;
    const own = new Set(cells.map(([x, y]) => `${x},${y}`));
    const has = (x, y) => own.has(`${x},${y}`);
    /*
     * 隣り合うマスは、接する側をわずかに**重ねる**。
     *
     * ぴったり突き合わせると、塗りと切り抜きの縁で被覆率が 100% に届かず、
     * マスの境目に髪の毛ほどの線が走る（盤面にマス目が浮いて見えた）。
     * 0.6px 食い込ませれば重なるので、線は原理的に出ない。
     * 重なっても困らないよう、塗りと切り抜きは全部 nonzero で扱う。
     */
    const bleed = -0.6;

    const out = [];
    for (const [x, y] of cells) {
      const up = has(x, y - 1);
      const down = has(x, y + 1);
      const left = has(x - 1, y);
      const right = has(x + 1, y);
      const l = left ? bleed : pad;
      const t = up ? bleed : pad;
      const rt = right ? bleed : pad;
      const b = down ? bleed : pad;
      out.push({
        x, y, up, down, left, right,
        px: ox + x * cell + l,
        py: oy + y * cell + t,
        pw: cell - l - rt,
        ph: cell - t - b,
        radii: [
          (!up && !left) ? r : 0,
          (!up && !right) ? r : 0,
          (!down && !right) ? r : 0,
          (!down && !left) ? r : 0,
        ],
      });
    }
    return out;
  }

  /** ブロックのセル矩形（盤面座標） */
  cellRects(piece, dx, dy) {
    return this.rectsFor(piece.cells, this.ox + dx, this.oy + dy, this.tileGap, this.tileRadius);
  }

  /**
   * 矩形の並び -> 輪郭の Path2D。
   * 角の落とし方は素材が決める ―― 丸める（石・木・金属・紙・布）か、
   * 45° で切り落とす（クリスタル。エメラルドカットの角はここで決まる）。
   */
  /**
   * ブロックの**外周だけ**をなぞる 1 本の閉じた輪郭。
   *
   * pathOf はマスごとの矩形を並べたものなので、これを stroke すると
   * マスとマスの境目まで線が引かれ、1 個の塊に格子が浮く（実際そうなった）。
   * 縁をなぞる用途では必ずこちらを使うこと。
   *
   * このゲームのブロックは全部が長方形（src/exact.js が長方形しか置かない）なので、
   * 外接矩形をそのままなぞれば厳密に外周と一致する。将来 L 字などが増えたときの
   * ために、長方形でなければ辺ごとの外周（outlineOf）へ落ちる。
   */
  boundaryOf(cells, rects, box, r, chamfer = 0) {
    const { cols, rows } = this.cellBounds(cells);
    if (cells.length !== cols * rows) return this.outlineOf(rects, r);
    const path = new Path2D();
    const shape = {
      px: box.x0, py: box.y0, pw: box.w, ph: box.h,
      up: false, down: false, left: false, right: false,
    };
    if (chamfer > 0) chamferRect(path, shape, chamfer);
    else path.roundRect(box.x0, box.y0, box.w, box.h, r);
    return path;
  }

  pathOf(rects, chamfer = 0) {
    const path = new Path2D();
    for (const p of rects) {
      if (chamfer > 0) chamferRect(path, p, chamfer);
      else path.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
    }
    return path;
  }

  bboxOf(rects) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of rects) {
      if (p.px < x0) x0 = p.px;
      if (p.py < y0) y0 = p.py;
      if (p.px + p.pw > x1) x1 = p.px + p.pw;
      if (p.py + p.ph > y1) y1 = p.py + p.ph;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * ブロック本体。
   * @param {string} mode 'solid' | 'outline'
   * @param {string|null} axis つぶれる向き（着地アニメ用）
   */
  drawPiece(piece, dx = 0, dy = 0, alpha = 1, squash = 0, selected = false, mode = 'solid', axis = null) {
    const ctx = this.ctx;
    const cell = this.cell;
    const rects = this.cellRects(piece, dx, dy);
    const box = this.bboxOf(rects);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (squash) {
      const cx = (box.x0 + box.x1) / 2;
      const cy = (box.y0 + box.y1) / 2;
      const horiz = axis === 'left' || axis === 'right';
      ctx.translate(cx, cy);
      ctx.scale(horiz ? 1 - squash : 1 + squash * 0.55, horiz ? 1 + squash * 0.55 : 1 - squash);
      ctx.translate(-cx, -cy);
    }

    const c = this.colorOf(piece.color);
    const mat = this.material;
    const outline = this.boundaryOf(
      piece.cells, rects, box, this.tileRadius, mat.chamfer ? mat.chamfer * cell : 0,
    );

    if (mode === 'outline') {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = c.light;
      ctx.setLineDash([cell * 0.26, cell * 0.2]);
      ctx.lineCap = 'round';
      ctx.stroke(outline);
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 焼いてある絵を貼る。同じ形・同じ素材・同じ色なら 1 枚を全員で使い回す
    const pal = this.palFor(piece.color);
    const { minX, minY } = this.cellBounds(piece.cells);
    const variant = ((piece.id % 4) + 4) % 4;
    const key = `${this.material.key}|${this.shapeKey(piece.cells, minX, minY)}`
      + `|${pal.key}|${this.cell}|${variant}`;
    let baked = this.pieceCache.get(key);
    if (baked === undefined) {
      baked = this.bakePiece(piece.cells, pal, variant, piece.color !== -9);
      /*
       * 盤上の形は数種類しかないが、色つきの絵は残り手数が 1 動くたびに増える。
       * 300 手のレベルなら 600 枚まで積み上がるので、上限を超えたら**古いものから**
       * 捨てる。全部捨てると、灰色ブロック（色が動かない＝ずっと使い回せる）まで
       * 巻き添えで焼き直しになり、そこで一瞬止まる。
       */
      while (this.pieceCache.size >= 64) {
        this.pieceCache.delete(this.pieceCache.keys().next().value);
      }
      this.pieceCache.set(key, baked);
    } else {
      // 使ったものを新しい側へ回す（Map は入れた順に並ぶので、これで最近使った順になる）。
      // これをしないと、いちばん長く使い回せる灰色ブロックが最初に捨てられる
      this.pieceCache.delete(key);
      this.pieceCache.set(key, baked);
    }
    if (baked) {
      ctx.drawImage(
        baked.canvas,
        this.ox + minX * cell + dx - baked.pad,
        this.oy + minY * cell + dy - baked.pad,
        baked.w, baked.h,
      );
    } else {
      // キャンバスを作れない環境（テストなど）。塗りだけは出しておく
      ctx.fillStyle = pal.mid;
      ctx.fill(this.pathOf(rects));
    }

    // 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.42;
      ctx.fillStyle = c.dark;
      ctx.font = `700 ${Math.floor(cell * 0.44)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SYMBOLS[piece.color % SYMBOLS.length], this.ox + (ax + 0.5) * cell + dx, this.oy + (ay + 0.55) * cell + dy);
      ctx.restore();
    }

    // 選択中はブロックの外周をなぞる（動く単位を示す）。光らせず、線だけ
    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.5);
      ctx.save();
      ctx.globalAlpha = alpha * (0.55 + 0.45 * pulse);
      ctx.lineWidth = Math.max(2, cell * 0.075);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(outline);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * ブロックの外周だけの Path2D。
   * セル矩形の集合をそのまま stroke すると内部のセル境界まで線が出て、
   * 1個のブロックが格子模様に見えてしまう。外周の辺と外側の角だけを集める。
   */
  outlineOf(rects, r) {
    const ctx = new Path2D();
    const HALF_PI = Math.PI / 2;
    for (const p of rects) {
      const { px, py, pw, ph, up, down, left, right } = p;
      const x1 = px + pw;
      const y1 = py + ph;
      const rTL = (!up && !left) ? r : 0;
      const rTR = (!up && !right) ? r : 0;
      const rBR = (!down && !right) ? r : 0;
      const rBL = (!down && !left) ? r : 0;

      if (!up) { ctx.moveTo(px + rTL, py); ctx.lineTo(x1 - rTR, py); }
      if (!right) { ctx.moveTo(x1, py + rTR); ctx.lineTo(x1, y1 - rBR); }
      if (!down) { ctx.moveTo(x1 - rBR, y1); ctx.lineTo(px + rBL, y1); }
      if (!left) { ctx.moveTo(px, y1 - rBL); ctx.lineTo(px, py + rTL); }

      if (rTL) { ctx.moveTo(px, py + rTL); ctx.arc(px + rTL, py + rTL, rTL, Math.PI, Math.PI * 1.5); }
      if (rTR) { ctx.moveTo(x1 - rTR, py); ctx.arc(x1 - rTR, py + rTR, rTR, Math.PI * 1.5, 0); }
      if (rBR) { ctx.moveTo(x1, y1 - rBR); ctx.arc(x1 - rBR, y1 - rBR, rBR, 0, HALF_PI); }
      if (rBL) { ctx.moveTo(px + rBL, y1); ctx.arc(px + rBL, y1 - rBL, rBL, HALF_PI, Math.PI); }
    }
    return ctx;
  }

  /** 着地予測ゴースト + 矢印 */
  drawGhost(view) {
    const { ghost } = view;
    if (!ghost || ghost.steps <= 0) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const d = DIRS[ghost.dir];
    const dx = d.x * ghost.steps * cell;
    const dy = d.y * ghost.steps * cell;
    const piece = ghost.piece;

    this.drawPiece(piece, dx, dy, 0.3, 0, false, 'solid');
    this.drawPiece(piece, dx, dy, 0.9, 0, false, 'outline');

    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const from = this.cellCenter(cxs, cys);
    const to = { x: from.x + dx, y: from.y + dy };
    const col = ghost.willClear ? '#ffd60a' : 'rgba(255,255,255,.78)';

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.setLineDash([cell * 0.26, cell * 0.24]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x + d.x * cell * 0.4, from.y + d.y * cell * 0.4);
    ctx.lineTo(to.x - d.x * cell * 0.35, to.y - d.y * cell * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);

    const ax = to.x + d.x * cell * 0.1;
    const ay = to.y + d.y * cell * 0.1;
    const s = cell * 0.3;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ax + d.x * s, ay + d.y * s);
    ctx.lineTo(ax - d.x * s * 0.5 + d.y * s * 0.62, ay - d.y * s * 0.5 + d.x * s * 0.62);
    ctx.lineTo(ax - d.x * s * 0.5 - d.y * s * 0.62, ay - d.y * s * 0.5 - d.x * s * 0.62);
    ctx.closePath();
    ctx.fill();

    // 消える予定の相手を光らせる ―― 「あと1手で消える」予感を可視化する
    if (ghost.willClear && ghost.clearIds) {
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(this.time * 9);
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.shadowColor = 'rgba(255,214,10,.85)';
      ctx.shadowBlur = cell * 0.4;
      for (const id of ghost.clearIds) {
        const p = view.board.pieces.get(id);
        if (!p || p.id === piece.id) continue;
        const r2 = this.cellRects(p, 0, 0);
        ctx.stroke(this.outlineOf(r2, this.tileRadius));
      }
    }
    ctx.restore();
  }

  drawParticles(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    ctx.save();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += p.g * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= Math.pow(0.955, k);
      p.rot += p.spin * k;
      p.life -= p.decay * k;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + p.life * 0.5);
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s / 2, s, s, s * p.radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 消えたマスが光になって開く。
   * ブロックと同じ矩形を、白く飛ばしながら少しだけ膨らませて消す ――
   * 「そこにあったものが光になった」ように見せたいので、位置と形は変えない。
   */
  drawShards(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    const cell = this.cell;
    const gap = this.tileGap;
    const size = this.tileSize;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= 0.075 * k;
      if (s.life <= 0) {
        this.shards.splice(i, 1);
        continue;
      }
      const t = easeOutCubic(1 - s.life);
      const grow = 1 + t * 0.85;
      const w = size * grow;
      const cx = this.ox + s.x * cell + gap + size / 2;
      const cy = this.oy + s.y * cell + gap + size / 2;
      ctx.save();
      ctx.globalAlpha = s.life * 0.9;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = s.life > 0.55 ? '#ffffff' : s.color;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - w / 2, w, w, this.tileRadius * grow);
      ctx.fill();
      ctx.restore();
    }
  }

  drawRings(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= 0.036 * k;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = easeOutCubic(1 - r.life);
      const rad = r.r + (r.maxR - r.r) * t;
      ctx.save();
      ctx.globalAlpha = r.life * 0.55;
      ctx.strokeStyle = `rgba(${r.color},1)`;
      ctx.lineWidth = Math.max(1.5, this.cell * 0.17 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      // 内側にもう一本、明るい輪を重ねてネオンのように光らせる
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = r.life * 0.45;
      ctx.strokeStyle = r.glow;
      ctx.lineWidth = Math.max(1, this.cell * 0.06 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad * 0.93, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 👍 のスタンプ。
   * 出るときだけ勢いよく（跳ねながら大きくなる）、消えるときはただ浮いて薄れる ――
   * 出現に力を入れて退場を静かにすると、視線を引いておいて返してくれる。
   */
  drawStamps(dt) {
    const ctx = this.ctx;
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.life -= dt * 0.85;
      if (s.life <= 0) {
        this.stamps.splice(i, 1);
        continue;
      }
      const t = 1 - s.life; // 0 -> 1
      // 出てから 0.22 のあいだで跳ねる（行き過ぎて戻る）
      const pop = t < 0.22
        ? 1.28 * easeOutCubic(t / 0.22)
        : 1.28 - 0.28 * easeOutCubic(Math.min(1, (t - 0.22) / 0.2));
      const rise = easeOutCubic(t) * this.cell * 0.6;
      ctx.save();
      ctx.globalAlpha = Math.min(1, s.life * 2.2);
      ctx.translate(s.x, s.y - rise);
      ctx.rotate(s.rot * (1 - t * 0.6));
      ctx.scale(pop, pop);
      ctx.font = `${Math.round(s.size)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 絵文字は色で描かれるので、後ろに白を敷いて盤面から浮かせる
      ctx.shadowColor = 'rgba(0,0,0,.28)';
      ctx.shadowBlur = s.size * 0.28;
      ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }
  }

  drawFlashes(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= 0.09 * k;
      if (f.life <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      const rad = f.r * (1.6 - f.life * 0.6);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      g.addColorStop(0, `rgba(255,255,255,${0.7 * f.life})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
      ctx.restore();
    }
  }

  /** 選択中ブロックの「動ける方向」を控えめに示す */
  drawMoveHints(board, pieceId) {
    if (pieceId == null) return;
    const piece = board.pieces.get(pieceId);
    if (!piece) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const base = this.cellCenter(cxs, cys);
    ctx.save();
    for (const dir of DIR_KEYS) {
      if (board.slideDistance(pieceId, dir) <= 0) continue;
      const d = DIRS[dir];
      const ax = base.x + d.x * cell * 1.1;
      const ay = base.y + d.y * cell * 1.1;
      const s = cell * 0.2;
      ctx.globalAlpha = 0.4 + 0.18 * Math.sin(this.time * 5);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = cell * 0.2;
      ctx.beginPath();
      ctx.moveTo(ax + d.x * s, ay + d.y * s);
      ctx.lineTo(ax - d.x * s * 0.4 + d.y * s * 0.8, ay - d.y * s * 0.4 + d.x * s * 0.8);
      ctx.lineTo(ax - d.x * s * 0.4 - d.y * s * 0.8, ay - d.y * s * 0.4 - d.x * s * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
