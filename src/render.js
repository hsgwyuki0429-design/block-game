// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックは「色そのもの」で描く。影も光沢も模様も乗せない ―― 一色のベタ塗りに、
// ほんのわずかな角丸だけ。マス同士のすき間も髪の毛ほどしか空けないので、
// 盤面はタイルを敷き詰めたモザイクのように見える。
// 同じブロックのマス同士はすき間なく繋がるので「どこまでが一緒に動くか」は形で読める。
//
// 後ろの盤面も同じ考えで、淡い色のマスを敷き詰めただけの平らな面にしている。

import { DIRS, DIR_KEYS } from './shapes.js';

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

/**
 * 盤面（ブロックを並べる面）。影も光沢も落とさない、平らな面。
 * 上端にだけ細い明るい線を引く ―― ガラス板の縁が光を拾ったときの1本で、
 * これだけで面が「浮いている」ように見える。
 */
const TRAY = { plate: '#dde2f0', hole: '#eef1f8', rim: 'rgba(255,255,255,.85)' };

/** 色覚サポート用の記号。色数が増えても足りるよう繰り返して使う */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '▼', '⬢', '♦', '☰'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

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
    this.shake = 0;
    this.time = 0;

    this.options = { symbols: false, ghost: true, calm: false };
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
    const cell = Math.floor((Math.min(w, h) - 8) / this.size);
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
  }

  /**
   * マスとマスのすき間。「ほんの少しだけ」＝ 1〜2px。
   * 敷き詰まって見えることを優先し、マスが小さいときも 1px 以上は空けない。
   */
  get tileGap() { return this.cell >= 34 ? 1.5 : 1; }
  get tileSize() { return this.cell - this.tileGap * 2; }
  get tileRadius() { return Math.max(1.5, this.tileSize * 0.14); }

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
    const c = colorFor(colorIndex);
    for (const [x, y] of cells) {
      this.shards.push({ x, y, color: c.light, life: 1 });
    }
  }

  /** 砕けた破片が飛び散る */
  burst(cells, colorIndex, strength = 1) {
    const c = colorFor(colorIndex);
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
    const c = colorFor(colorIndex);
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

  addShake(amount) {
    if (this.options.calm) amount *= 0.3;
    this.shake = Math.min(22, this.shake + amount);
  }

  clearEffects() {
    this.particles.length = 0;
    this.shards.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
    this.shake = 0;
  }

  // ---------------------------------------------------------------- 描画

  draw(view, dt) {
    const ctx = this.ctx;
    this.time += dt;

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

    ctx.restore();
  }

  /**
   * 盤面。ブロックと同じ寸法・同じすき間の淡いマスを敷き詰めただけの平らな面。
   * 影も枠線も付けない ―― 空きマスがそのまま「通路」として読めればいい。
   */
  drawTray(board) {
    const ctx = this.ctx;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    const x0 = this.ox;
    const y0 = this.oy;
    const pad = Math.max(2, cell * 0.06);

    const radius = Math.max(6, cell * 0.24);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, radius);
    ctx.fillStyle = TRAY.plate;
    ctx.fill();
    // ガラスの縁の光。上半分だけを 1px でなぞる
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = TRAY.rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0 - pad + 0.5, y0 - pad + 0.5, w + pad * 2 - 1, (w + pad * 2) * 0.6, radius);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    const gap = this.tileGap;
    const size = this.tileSize;
    const tr = this.tileRadius;
    ctx.save();
    ctx.fillStyle = TRAY.hole;
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

  drawPieces(view) {
    const { board, anim, selected, invalid } = view;
    if (!board) return;

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
          this.drawTrail(piece, d, anim, p);
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

      const axis = anim && anim.pieceId === piece.id ? anim.dir : null;
      this.drawPiece(piece, dx, dy, 1, squash, selected === piece.id, 'solid', axis);
    }
  }

  drawTrail(piece, d, anim, p) {
    const ctx = this.ctx;
    const c = colorFor(piece.color);
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

  /** ブロックのセル矩形を組み立てる（同じブロックの隣とは継ぎ目なく繋がる） */
  cellRects(piece, dx, dy) {
    const cell = this.cell;
    const own = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
    const has = (x, y) => own.has(`${x},${y}`);
    const pad = this.tileGap;
    const r = this.tileRadius;

    const out = [];
    for (const [x, y] of piece.cells) {
      const up = has(x, y - 1);
      const down = has(x, y + 1);
      const left = has(x - 1, y);
      const right = has(x + 1, y);
      out.push({
        x, y, up, down, left, right,
        px: this.ox + x * cell + dx + (left ? 0 : pad),
        py: this.oy + y * cell + dy + (up ? 0 : pad),
        pw: cell - (left ? 0 : pad) - (right ? 0 : pad),
        ph: cell - (up ? 0 : pad) - (down ? 0 : pad),
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

  pathOf(rects) {
    const path = new Path2D();
    for (const p of rects) path.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
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

    const c = colorFor(piece.color);
    const outline = this.outlineOf(rects, this.tileRadius);

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

    // ベタ塗り一色。同じブロックのマス同士は継ぎ目なく繋がり、
    // 別のブロックとのあいだにだけ髪の毛ほどのすき間が残る。
    ctx.fillStyle = c.base;
    ctx.fill(this.pathOf(rects));

    // 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.38;
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
      ctx.lineWidth = Math.max(2, cell * 0.08);
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
