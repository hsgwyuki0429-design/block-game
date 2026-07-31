// Canvas 描画。盤面・粘土ブロック・着地予測ゴースト・演出をすべてここで描く。
//
// ブロックは「粘土」として描く:
//   下に色付きのやわらかい影 → 斜めのグラデーションで塊感 → 内側の上左に光、
//   下右に翳り → 表面に細かいざらつき（グレイン） → 縁取り線は引かない。
// マットで、押したらへこみそうな質感を目指している。UI 側がガラスで退いているぶん、
// ここだけが主役として前に出る。

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

/**
 * 6色の毛糸。織物の質感を乗せるので、彩度を高めにして色そのもので見分けられるようにする。
 * light=上端に当たる光 / base=素の色 / dark=下端の翳り / shadow=盤面に落ちる影
 */
export const PALETTE = [
  { name: '赤', base: '#e0483d', light: '#f0705f', dark: '#a82b26', shadow: '120,26,24' },
  { name: '橙', base: '#ee8a2c', light: '#faa951', dark: '#b45f14', shadow: '130,60,12' },
  { name: '黄', base: '#efb62a', light: '#fbd056', dark: '#b78310', shadow: '130,88,10' },
  { name: '緑', base: '#46bd3c', light: '#6fd85f', dark: '#2b8b26', shadow: '28,88,24' },
  { name: '青', base: '#3d95dc', light: '#63b4ee', dark: '#2168a8', shadow: '20,70,120' },
  { name: '紫', base: '#a94ccd', light: '#c473e2', dark: '#7c2f9c', shadow: '80,28,104' },
];

/** 盤面（毛糸を並べる台）の色 */
const TRAY = {
  light: { frame: '#2c3757', hole: '#39466c', edge: 'rgba(0,0,0,.35)' },
  dark: { frame: '#171d31', hole: '#232c48', edge: 'rgba(0,0,0,.5)' },
};

/** 色覚サポート用の記号 */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.6 * Math.pow(t - 1, 2);

/**
 * 織物（刺繍）の地。斜め45度に走る糸の列を、繰り返して使えるタイルとして描く。
 * グレー #808080 を基準色にして overlay で重ねるので、どの色の上でも
 * 「明るい糸／暗い糸」として乗る。糸の間隔はマスの大きさに比例させる。
 */
function makeWeave(cellPx) {
  const spacing = Math.max(3, Math.round(cellPx / 8));
  const size = spacing * 8; // 45度の縞が継ぎ目なく繰り返せるよう間隔の倍数にする
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');

  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);

  // 糸1本ぶん＝明るい面と暗い面の対
  g.lineCap = 'butt';
  for (let i = -size; i <= size * 2; i += spacing) {
    g.strokeStyle = 'rgba(255,255,255,.6)';
    g.lineWidth = Math.max(0.8, spacing * 0.34);
    g.beginPath();
    g.moveTo(i, size);
    g.lineTo(i + size, 0);
    g.stroke();

    g.strokeStyle = 'rgba(0,0,0,.46)';
    g.lineWidth = Math.max(0.8, spacing * 0.3);
    g.beginPath();
    g.moveTo(i + spacing * 0.46, size);
    g.lineTo(i + spacing * 0.46 + size, 0);
    g.stroke();
  }

  // 繊維のざらつき
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
  return c;
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
    this.rings = [];
    this.texts = [];
    this.flashes = [];
    this.shake = 0;
    this.time = 0;

    this.options = { symbols: false, ghost: true, calm: false };

    this.weavePattern = null;
    this.weaveFor = 0;

    this.dark = false;
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) {
      this.dark = mq.matches;
      const onChange = (e) => { this.dark = e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
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

    // 盤面は正方形。影がはみ出せるよう外周に余白を取る
    const cell = Math.floor((Math.min(w, h) - 24) / this.size);
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
    this.buildWeave();
  }

  /** マスの大きさが変わったら織物の目も作り直す */
  buildWeave() {
    if (this.weaveFor === this.cell && this.weavePattern) return;
    this.weaveFor = this.cell;
    this.weavePattern = this.ctx.createPattern(makeWeave(this.cell), 'repeat');
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

  /** 粘土のかけらが飛び散る */
  burst(cells, colorIndex) {
    const c = PALETTE[colorIndex];
    const n = this.options.calm ? 3 : 8;
    for (const [cx, cy] of cells) {
      const p = this.cellCenter(cx, cy);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.5 + Math.random() * 2.8) * this.cell * 0.06;
        const white = Math.random() < 0.16;
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * this.cell * 0.6,
          y: p.y + (Math.random() - 0.5) * this.cell * 0.6,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - this.cell * 0.03,
          g: this.cell * 0.011,
          life: 1,
          decay: 0.016 + Math.random() * 0.018,
          size: this.cell * (white ? 0.06 : 0.11 + Math.random() * 0.2),
          radius: 0.34,
          color: white ? '#ffffff' : (Math.random() < 0.4 ? c.light : c.base),
          spin: (Math.random() - 0.5) * 0.34,
          rot: Math.random() * Math.PI,
        });
      }
    }
  }

  ring(x, y, colorIndex, strength = 1) {
    this.rings.push({
      x, y,
      r: this.cell * 0.35,
      maxR: this.cell * (2 + strength * 1.4),
      life: 1,
      color: PALETTE[colorIndex].shadow,
    });
  }

  /** 消えた瞬間の白いフラッシュ（報酬のトリガー） */
  flash(x, y, strength = 1) {
    if (this.options.calm) return;
    this.flashes.push({ x, y, r: this.cell * (2.4 + strength * 1.6), life: 1 });
  }

  floatText(x, y, text, sub, color) {
    this.texts.push({ x, y, text, sub, color, life: 1, vy: -0.5 });
  }

  addShake(amount) {
    if (this.options.calm) amount *= 0.3;
    this.shake = Math.min(22, this.shake + amount);
  }

  clearEffects() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
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
    if (view.hint) this.drawHint(view);

    this.drawRings(dt);
    this.drawFlashes(dt);
    this.drawParticles(dt);
    this.drawTexts(dt);

    ctx.restore();
  }

  /** 盤面＝粘土を並べるマット。空きマスはくぼみとして見せる */
  drawTray(board) {
    const ctx = this.ctx;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    const x0 = this.ox;
    const y0 = this.oy;
    const pad = Math.max(6, cell * 0.16);
    const dark = this.dark;

    // 盤面は毛糸を並べる台。暗い枠にすると糸の色がはっきり立つ
    const t = dark ? TRAY.dark : TRAY.light;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, Math.max(14, cell * 0.42));
    ctx.fillStyle = t.frame;
    ctx.shadowColor = dark ? 'rgba(0,0,0,.7)' : 'rgba(28,34,60,.28)';
    ctx.shadowBlur = cell * 0.9;
    ctx.shadowOffsetY = cell * 0.22;
    ctx.fill();
    ctx.restore();

    // 空きマス（＝通路）。枠より少し明るくして、通れる場所が読めるようにする
    ctx.save();
    const r = Math.max(2, cell * 0.2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        const px = x0 + x * cell + cell * 0.05;
        const py = y0 + y * cell + cell * 0.05;
        const s = cell - cell * 0.1;
        ctx.beginPath();
        ctx.roundRect(px, py, s, s, r);
        ctx.fillStyle = t.hole;
        ctx.fill();
        // 上のふちに影を落として、へこんで見せる
        ctx.beginPath();
        ctx.roundRect(px, py - Math.max(1, cell * 0.05), s, s, r);
        ctx.strokeStyle = t.edge;
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.save();
        ctx.clip((() => { const q = new Path2D(); q.roundRect(px, py, s, s, r); return q; })());
        ctx.stroke();
        ctx.restore();
      }
    }
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
          // 進行方向につぶれて戻る（粘土がぶつかった手応え）
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
    const c = PALETTE[piece.color];
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
          this.ox + cx * cell + dx + cell * 0.08,
          this.oy + cy * cell + dy + cell * 0.08,
          cell * 0.84, cell * 0.84, cell * 0.3,
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
    const pad = Math.max(1, cell * 0.055);
    const r = Math.max(2.5, cell * 0.22);

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
   * 粘土ブロック本体。
   * @param {string} mode 'solid' | 'outline'
   * @param {string|null} axis つぶれる向き（着地アニメ用）
   */
  drawPiece(piece, dx = 0, dy = 0, alpha = 1, squash = 0, selected = false, mode = 'solid', axis = null) {
    const ctx = this.ctx;
    const cell = this.cell;
    const c = PALETTE[piece.color];
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

    const path = this.pathOf(rects);
    const outline = this.outlineOf(rects, Math.max(2.5, cell * 0.22));

    if (mode === 'outline') {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = c.base;
      ctx.setLineDash([cell * 0.26, cell * 0.2]);
      ctx.lineCap = 'round';
      ctx.stroke(this.outlineOf(rects, Math.max(2.5, cell * 0.22)));
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 1) 盤面に落ちる影
    ctx.save();
    ctx.shadowColor = `rgba(${c.shadow},${this.dark ? 0.6 : 0.5})`;
    ctx.shadowBlur = cell * 0.3;
    ctx.shadowOffsetY = cell * 0.12;
    ctx.fillStyle = c.dark;
    ctx.fill(path);
    ctx.restore();

    // 2) 本体。上が明るく下が翳る、糸の束のような面
    const grad = ctx.createLinearGradient(0, box.y0, 0, box.y1);
    grad.addColorStop(0, c.light);
    grad.addColorStop(0.5, c.base);
    grad.addColorStop(1, c.dark);
    ctx.fillStyle = grad;
    ctx.fill(path);

    ctx.save();
    ctx.clip(path);

    // 3) 織物の目。斜め45度の糸を overlay で乗せる
    if (this.weavePattern && cell > 10) {
      ctx.globalAlpha = alpha * 0.3;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = this.weavePattern;
      ctx.fillRect(box.x0 - 2, box.y0 - 2, box.w + 4, box.h + 4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
    }

    // 4) 縁の立ち上がり。輪郭をずらして描き、クリップで内側半分だけ残す
    //    下へずらした明るい線＝上のふちが光り、上へずらした暗い線＝下のふちが翳る
    const bevel = Math.max(1.4, Math.min(cell * 0.09, 9));
    ctx.lineWidth = bevel * 2;

    ctx.save();
    ctx.translate(0, bevel);
    ctx.strokeStyle = 'rgba(255,255,255,.34)';
    ctx.stroke(outline);
    ctx.restore();

    ctx.save();
    ctx.translate(0, -bevel);
    ctx.strokeStyle = `rgba(${c.shadow},.58)`;
    ctx.stroke(outline);
    ctx.restore();

    ctx.restore();

    // 5) マスの継ぎ目。1マスずつ縫い合わせたように見せる
    this.drawCellSeams(piece, rects, dx, dy, alpha, c);

    // 6) 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.34;
      ctx.fillStyle = 'rgba(0,0,0,.9)';
      ctx.font = `700 ${Math.floor(cell * 0.44)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SYMBOLS[piece.color], this.ox + (ax + 0.5) * cell + dx, this.oy + (ay + 0.55) * cell + dy);
      ctx.restore();
    }

    // 7) 選択中はやわらかい白い光をまとう
    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.5);
      ctx.save();
      ctx.globalAlpha = alpha * (0.45 + 0.4 * pulse);
      ctx.lineWidth = Math.max(2, cell * 0.075);
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,255,255,.9)';
      ctx.shadowBlur = cell * (0.35 + 0.3 * pulse);
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

  /**
   * ブロック内部の継ぎ目。
   * すべてのマス境界に細い溝を彫って「1マスずつ縫い合わせた布」に見せる。
   * 連結ピース（テトロミノ2〜3個つなぎ）の境目だけは溝を強くして、
   * 何個つなぎのブロックなのかが読めるようにしている。
   */
  drawCellSeams(piece, rects, dx, dy, alpha, color) {
    const ctx = this.ctx;
    const cell = this.cell;
    const parts = piece.parts;
    const partOf = new Map();
    for (let i = 0; i < piece.cells.length; i++) {
      partOf.set(`${piece.cells[i][0]},${piece.cells[i][1]}`, parts ? parts[i] : 0);
    }

    const edges = [];
    for (const p of rects) {
      const px = this.ox + p.x * cell + dx;
      const py = this.oy + p.y * cell + dy;
      const mine = partOf.get(`${p.x},${p.y}`);
      if (p.right) {
        const other = partOf.get(`${p.x + 1},${p.y}`);
        edges.push({ x0: px + cell, y0: py, x1: px + cell, y1: py + cell, strong: other !== mine });
      }
      if (p.down) {
        const other = partOf.get(`${p.x},${p.y + 1}`);
        edges.push({ x0: px, y0: py + cell, x1: px + cell, y1: py + cell, strong: other !== mine });
      }
    }
    if (edges.length === 0) return;

    const inset = cell * 0.1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';

    const seamW = Math.max(1, Math.min(cell * 0.045, 3.4));
    const liftW = Math.max(0.8, Math.min(cell * 0.03, 2.4));
    for (const pass of [
      { color: `rgba(${color.shadow},.5)`, off: 0, w: seamW },
      { color: 'rgba(255,255,255,.16)', off: liftW, w: liftW },
    ]) {
      ctx.beginPath();
      for (const e of edges) {
        const horiz = e.y0 === e.y1;
        const s = e.strong ? inset * 0.5 : inset;
        if (horiz) {
          ctx.moveTo(e.x0 + s, e.y0 + pass.off);
          ctx.lineTo(e.x1 - s, e.y1 + pass.off);
        } else {
          ctx.moveTo(e.x0 + pass.off, e.y0 + s);
          ctx.lineTo(e.x1 + pass.off, e.y1 - s);
        }
      }
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = pass.w;
      ctx.stroke();

      // 連結ピースの境目だけ、もう一度なぞって濃くする
      ctx.beginPath();
      let any = false;
      for (const e of edges) {
        if (!e.strong) continue;
        any = true;
        const horiz = e.y0 === e.y1;
        if (horiz) {
          ctx.moveTo(e.x0 + inset * 0.5, e.y0 + pass.off);
          ctx.lineTo(e.x1 - inset * 0.5, e.y1 + pass.off);
        } else {
          ctx.moveTo(e.x0 + pass.off, e.y0 + inset * 0.5);
          ctx.lineTo(e.x1 + pass.off, e.y1 - inset * 0.5);
        }
      }
      if (any) {
        ctx.lineWidth = pass.w * 1.6;
        ctx.stroke();
      }
    }
    ctx.restore();
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
        ctx.stroke(this.outlineOf(r2, Math.max(2.5, cell * 0.22)));
      }
    }
    ctx.restore();
  }

  /** ヒント: 金色の脈動 + 方向矢印 */
  drawHint(view) {
    const { hint, board } = view;
    const piece = board.pieces.get(hint.pieceId);
    if (!piece) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5);

    ctx.save();
    ctx.globalAlpha = 0.45 + 0.5 * pulse;
    ctx.strokeStyle = '#ffd60a';
    ctx.lineWidth = Math.max(2.5, cell * 0.1);
    ctx.shadowColor = 'rgba(255,214,10,.9)';
    ctx.shadowBlur = cell * 0.6;
    ctx.stroke(this.outlineOf(this.cellRects(piece, 0, 0), Math.max(2.5, cell * 0.22)));
    ctx.restore();

    const d = DIRS[hint.dir];
    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const base = this.cellCenter(cxs, cys);
    const off = cell * (0.9 + 0.35 * pulse);
    const ax = base.x + d.x * off;
    const ay = base.y + d.y * off;
    const s = cell * 0.38;

    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * pulse;
    ctx.fillStyle = '#ffd60a';
    ctx.shadowColor = 'rgba(255,214,10,.9)';
    ctx.shadowBlur = cell * 0.5;
    ctx.beginPath();
    ctx.moveTo(ax + d.x * s, ay + d.y * s);
    ctx.lineTo(ax - d.x * s * 0.4 + d.y * s * 0.7, ay - d.y * s * 0.4 + d.x * s * 0.7);
    ctx.lineTo(ax - d.x * s * 0.4 - d.y * s * 0.7, ay - d.y * s * 0.4 - d.x * s * 0.7);
    ctx.closePath();
    ctx.fill();
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
      ctx.globalAlpha = r.life * 0.5;
      ctx.strokeStyle = `rgba(${r.color},1)`;
      ctx.lineWidth = Math.max(1.5, this.cell * 0.17 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
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

  drawTexts(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= 0.014 * k;
      t.y += t.vy * k;
      t.vy *= Math.pow(0.965, k);
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      const appear = Math.min(1, (1 - t.life) * 5);
      const scale = easeOutBack(appear);
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life * 2.4);
      ctx.translate(t.x, t.y);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, this.cell * 0.22);
      ctx.strokeStyle = 'rgba(16,20,36,.85)';
      ctx.font = `800 ${Math.floor(this.cell * 0.82)}px ${UI_FONT}`;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = `800 ${Math.floor(this.cell * 0.52)}px ${UI_FONT}`;
        ctx.strokeText(t.sub, 0, this.cell * 0.8);
        ctx.fillStyle = '#ffd60a';
        ctx.fillText(t.sub, 0, this.cell * 0.8);
      }
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
