// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックの描き方はデザイン（src/materials.js）ごとに 2 通りしかない ――
// プレーンは輪郭を 1 回塗るだけ、クリスタルは接地影を敷いて写真を 9 分割で貼る。
// デザインはこの経路に寸法と色を渡すだけで、立体の作りそのものは分岐しない。
//
// 速さについて。**ブロック 1 個の絵はオフスクリーンに焼いて使い回す。**
// 同じ形・同じ色のブロックは 1 枚を共有するので、盤上に 20 個あっても
// 焼くのは数枚で済む。毎フレームやるのは、その絵を貼ることだけ。
// 影のぼかしや写真の 9 分割を毎フレーム描くと、それだけで 60fps が出ない。

import { DIRS, DIR_KEYS } from './shapes.js';
import { mix, shade, hexRgb, rgba, tintTowards } from './color.js';
import { materialFor, DEFAULT_MATERIAL, paletteFor, trayPaletteFor } from './materials.js';
import { loadPhotos, photoFor, PHOTO_UNIT } from './photoArt.js';

/** オフスクリーンのキャンバス。OffscreenCanvas が無い環境でも動くようにする */
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.ceil(w), Math.ceil(h));
  return null;
}

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
 * デザインの地（baseHex）を渡すと、**色つきブロックとまったく同じ色**を薄めて返す ――
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

    /** ブロックのデザイン。設定で切り替わる */
    this.material = materialFor(DEFAULT_MATERIAL);
    /*
     * 既定が写真のデザインなら、ここで読み込みを始める。
     * setMaterial は「今と違うとき」しか動かないので、既定のまま遊ぶ人には
     * 呼ばれない ―― 任せきりにすると、設定を触るまで写真が貼られないままになる。
     */
    if (this.material.photo) loadPhotos(() => this.invalidateBakes());
    /**
     * 焼き上げたブロックの絵。
     * 鍵は「デザイン × 形 × 色 × マスの大きさ」。同じ鍵なら 1 枚を全員で使う。
     */
    this.pieceCache = new Map();

    this.refreshTint();

    this.options = { symbols: false, ghost: true, calm: false };
  }

  /** デザインを切り替える。焼いてある絵は全部捨てる */
  setMaterial(key) {
    const next = materialFor(key);
    if (next === this.material) return;
    this.material = next;
    this.invalidateBakes();
    // 写真を貼るデザイン（クリスタル）は、画像が復号できるまで無地で描くしかない。
    // 読めたところで焼いてある絵を捨て、貼り直す
    if (next.photo) loadPhotos(() => this.invalidateBakes());
  }

  invalidateBakes() {
    this.pieceCache.clear();
    this._tintAt = -1; // デザインが変われば同じ進行度でも色が変わる
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

  /** ブロックの色。灰色はデザインそのまま、色つきは進行度の色を混ぜたもの */
  palFor(colorIndex) {
    return colorIndex === -9 ? this.stonePal : this.litPal; // -9 は board.js の BLOCKER
  }

  /**
   * 演出（破片・光の輪・残像）に使う色。
   * ブロックそのものではなく「そこにあった色」を伝えられればいいので、
   * デザインの代表色 3 つに畳んで返す。
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
  }

  /**
   * マスとマスのすき間。デザインごとに決まる（クリスタルは写真の目地に合わせて広い）。
   * ここが空いているぶんだけ、下のトレイと落ち影が見える ＝ 厚みが読める。
   */
  get tileGap() { return Math.max(1, this.cell * this.material.gap); }
  get tileSize() { return this.cell - this.tileGap * 2; }
  get tileRadius() { return Math.max(1.5, this.cell * (this.material.radius || 0.12)); }
  /** ブロックの厚み（側面の見える高さ） */
  get depth() { return Math.max(1.5, this.cell * this.material.depth); }

  /**
   * 角の落とし（px）。
   * **1 マスぶんの短辺**に掛ける ―― 写真の角は「1 マスあたり何画素」で決まって
   * いるので、マスの一辺に掛けると 2 マスのブロックだけ切り口が深くなる。
   */
  chamferFor(w, h, cols, rows) {
    const cut = this.material.chamfer;
    if (!cut) return 0;
    return cut * Math.min(w / cols, h / rows);
  }
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
   * ブロックと同じ寸法・同じすき間の淡いマスを敷き詰めただけの面で、影も枠も無い。
   * 上半分だけを 1px の白い線でなぞる ―― ガラス板の縁が光を拾ったときの 1 本で、
   * これだけで面が「浮いている」ように見える。
   *
   * **焼かずに毎フレーム直に描く。** プレーンは盤面の色も進行度を追いかけるので、
   * 焼くと色が 1 段動くたびに盤面ぶんのキャンバスを作り直すことになり、
   * 大きな盤面で 1 手ごとに 55ms 止まった。中身は角丸の塗り 2 枚しか無い。
   *
   * 枠を立てて影を落とす受け皿も持っていたが、写真のクリスタルはそれでは
   * 成り立たない ―― ガラスが暗い箱の底に沈んで、透明感がまるごと消える。
   * 写真は「白い台の上に置かれたガラス」で、いま残っている 2 つのデザインは
   * どちらもこの平らな台に載っている。
   */
  drawTray(board) {
    const ctx = this.ctx;
    const pal = this.trayPal;
    const x0 = this.ox;
    const y0 = this.oy;
    const w = this.cell * this.size;
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

    /*
     * 空きマス。
     *
     * **盤面と同じ色なら、そもそも描かない。** クリスタルは台をひと色にして
     * あるので、ここで四角を敷くと「もう 1 種類のブロック」が並んでいるように
     * 見えてしまう。通路は、ガラスが載っていないところとして読めばいい。
     */
    if (pal.well === pal.floor) return;
    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    // 角の落とし方はブロックと揃える。空きマスは「ブロックが抜けた跡」なので、
    // 丸と八角が混ざると盤面が 2 種類の形でできているように見える
    const cut = this.chamferFor(size, size, 1, 1);
    ctx.save();
    ctx.fillStyle = pal.well;
    ctx.beginPath();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        const px = x0 + x * cell + gap;
        const py = y0 + y * cell + gap;
        if (cut) {
          chamferRect(ctx, {
            px, py, pw: size, ph: size, up: false, down: false, left: false, right: false,
          }, cut);
        } else ctx.roundRect(px, py, size, size, tr);
      }
    }
    ctx.fill();
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
   * 影のぼかしと写真の 9 分割は、どれも 1 個あたり 10 回近い描画になる。
   * 盤上に 20 個あると毎フレーム 200 回。焼いてしまえば毎フレームやるのは
   * drawImage 1 回だけになる。
   *
   * @param {number[][]} cells 盤面座標のセル
   * @param {object} pal 色（materials.paletteFor）
   * @param {boolean} colored 色つきブロックか（灰色は進行度の色を被せない）
   */
  bakePiece(cells, pal, colored) {
    const mat = this.material;
    const cell = this.cell;
    const { minX, minY, cols, rows } = this.cellBounds(cells);
    const depth = this.depth;
    // 影がはみ出すぶんの余白。平らなデザインは何もはみ出さないので 1px でいい
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
    const radius = this.tileRadius;
    const rects = this.rectsFor(cells, ox, oy, this.tileGap, radius);
    const box = this.bboxOf(rects);
    const chamfer = this.chamferFor(box.w, box.h, cols, rows);
    const outer = this.pathOf(rects, chamfer);

    /*
     * プレーンはここで終わり。
     *
     * 薄い立体にするのではなく、**何も通らない**。接地影も面取りも縁の線も
     * 無いので、目が拾うものが「色と形」だけになる ―― どのブロックがどこまでかを
     * いちばん速く読めるのがこの見た目で、だから既定にしてある。
     */
    if (mat.flat) {
      ctx.fillStyle = pal.mid;
      ctx.fill(outer);
      return { canvas: cv, pad, minX, minY, w, h };
    }

    /*
     * クリスタルは、盤面に落ちる影を敷いてから写真を貼るだけ。
     * 面取りも艶も帯も**写真がすでに全部持っている**ので、上から足すと二重に光る。
     */
    const rim = this.boundaryOf(cells, rects, box, radius, chamfer);
    this.bakeShadow(ctx, outer, rim, mat, cell, depth);
    this.bakePhoto(ctx, outer, box, cols, rows, pal, colored);
    return { canvas: cv, pad, minX, minY, w, h };
  }

  /**
   * 写真を 1 個のブロックに貼る。
   *
   * ブロックは 1×1 から 8×3 まで何マスにもなるので、写真をそのまま引き伸ばすと
   * 面取りまで一緒に伸びて、細長いブロックだけ縁が太くなる。そこで **9 分割**で
   * 貼る ―― 四隅と四辺は伸ばさずそのまま、中央だけを伸ばす。
   * エメラルドカットの面取りは「一定の幅の帯」なので、これでどの大きさでも
   * 写真と同じ太さのまま収まる。全部のレベルに同じ 4 枚で足りるのはこのため。
   *
   * 色は貼ってから被せる。'color' は「色相と彩度は塗った色、明るさは下のまま」
   * という混ぜ方なので、ガラスの陰影を潰さずに色だけが変わる ――
   * 進行度の色（手数の目盛り）が、写真の上でもそのまま働く。
   */
  bakePhoto(ctx, outer, box, cols, rows, pal, colored) {
    const mat = this.material;
    const img = photoFor(cols, rows);
    ctx.save();
    ctx.clip(outer);
    if (img) this.drawNineSlice(ctx, img, box, cols, rows);
    else {
      // まだ復号できていない。無地で置いておく（読めたら焼き直される）
      ctx.fillStyle = pal.mid;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
    }
    ctx.globalCompositeOperation = 'color';
    // 色つきは進行度の色、灰色は写真がもともと帯びている青み。
    // 濃さを 1 まで上げると、ガラスではなく**塗った板**に見える ――
    // 少し透かすと、地の無彩色が残って「染めたガラス」になる
    ctx.globalAlpha = colored ? mat.tint : 1;
    ctx.fillStyle = colored ? this.tint.base : mat.photoTint;
    ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
    ctx.restore();
  }

  /**
   * 9 分割で貼る。
   *
   * 縁の太さは**マスに比例させる**（写真の側も貼る側も）。ブロックが何マスでも
   * 1 マスあたりの見え方が変わらないので、盤面のなかで面取りの太さが揃う。
   * 継ぎ目は destination 側を 0.5px 重ねて隠す ―― ぴったり突き合わせると、
   * 拡大縮小の補間が切れる位置に髪の毛ほどの線が出る。
   */
  drawNineSlice(ctx, img, box, cols, rows) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!sw || !sh) return;
    // 縁の取り方。面取り（0.17）＋角の落とし（0.2）が収まるだけ内側まで
    const K = 0.3;
    const sb = Math.min(PHOTO_UNIT * K, sw / 2 - 1, sh / 2 - 1);
    const db = Math.min(Math.min(box.w / cols, box.h / rows) * K, box.w / 2 - 0.5, box.h / 2 - 0.5);
    const bleed = 0.5;
    const sx = [0, sb, sw - sb, sw];
    const sy = [0, sb, sh - sb, sh];
    const dx = [box.x0, box.x0 + db, box.x1 - db, box.x1];
    const dy = [box.y0, box.y0 + db, box.y1 - db, box.y1];
    // 伸ばす面を先に、角を最後に。逆にすると、重ねた 0.5px が角に被さって
    // 面取りの稜線が鈍る ―― いちばん形を持っているのが角なので、そこを上に置く
    const order = [[1, 1], [1, 0], [1, 2], [0, 1], [2, 1], [0, 0], [2, 0], [0, 2], [2, 2]];
    for (const [i, j] of order) {
      const bx = i === 1 ? bleed : 0;
      const by = j === 1 ? bleed : 0;
      ctx.drawImage(
        img,
        sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j],
        dx[i] - bx, dy[j] - by,
        (dx[i + 1] - dx[i]) + bx * 2, (dy[j + 1] - dy[j]) + by * 2,
      );
    }
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
    const { cols, rows } = this.cellBounds(piece.cells);
    const outline = this.boundaryOf(
      piece.cells, rects, box, this.tileRadius, this.chamferFor(box.w, box.h, cols, rows),
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

    // 焼いてある絵を貼る。同じ形・同じデザイン・同じ色なら 1 枚を全員で使い回す
    const pal = this.palFor(piece.color);
    const { minX, minY } = this.cellBounds(piece.cells);
    const key = `${this.material.key}|${this.shapeKey(piece.cells, minX, minY)}`
      + `|${pal.key}|${this.cell}`;
    let baked = this.pieceCache.get(key);
    if (baked === undefined) {
      baked = this.bakePiece(piece.cells, pal, piece.color !== -9);
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
