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
 * 6色の粘土。彩度を落としすぎず、明度差で見分けられるようにしてある。
 * light=光が当たる面 / base=素の色 / dark=翳り / shadow=下に落ちる色付きの影
 */
export const PALETTE = [
  { name: '赤', base: '#ff6d80', light: '#ff98a6', dark: '#dd3f56', shadow: '206,52,74' },
  { name: '橙', base: '#ff9d45', light: '#ffbe7d', dark: '#e0741a', shadow: '204,105,20' },
  { name: '黄', base: '#ffcd3d', light: '#ffe07d', dark: '#dfa406', shadow: '199,148,8' },
  { name: '緑', base: '#3fcf93', light: '#77e0b4', dark: '#1ba471', shadow: '20,150,102' },
  { name: '青', base: '#54a9f5', light: '#8cc6f9', dark: '#2a7ed6', shadow: '32,116,196' },
  { name: '紫', base: '#a488ee', light: '#c1adf4', dark: '#7b56dd', shadow: '110,76,200' },
];

/** 色覚サポート用の記号 */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];

const UI_FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.6 * Math.pow(t - 1, 2);

/** 上端が外側になっているセルを、横につながった並びごとにまとめる */
function topRuns(rects) {
  const tops = rects.filter((p) => !p.up).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const runs = [];
  let cur = null;
  for (const p of tops) {
    if (cur && cur.row === p.y && cur.lastX === p.x - 1) {
      cur.x1 = p.px + p.pw;
      cur.lastX = p.x;
      continue;
    }
    cur = { row: p.y, y: p.py, x0: p.px, x1: p.px + p.pw, lastX: p.x };
    runs.push(cur);
  }
  return runs;
}

/** 粘土のざらつき。一度だけ作って使い回す */
function makeGrain() {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 74;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
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

    this.grain = makeGrain();
    this.grainPattern = this.ctx.createPattern(this.grain, 'repeat');

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
    this.grainPattern = this.ctx.createPattern(this.grain, 'repeat');
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

    // 盤面はコンテンツのカード。無彩色で、色を持つのは粘土だけ
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, w + pad * 2, Math.max(18, cell * 0.52));
    ctx.fillStyle = dark ? '#1c1c1e' : '#efeff3';
    ctx.shadowColor = dark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.07)';
    ctx.shadowBlur = cell * 0.8;
    ctx.shadowOffsetY = cell * 0.2;
    ctx.fill();
    ctx.restore();

    // 空きマス（＝通路）。カードよりわずかに沈ませる
    ctx.save();
    const r = Math.max(3, cell * 0.28);
    ctx.fillStyle = dark ? '#111113' : '#e3e3ea';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        const px = x0 + x * cell + cell * 0.08;
        const py = y0 + y * cell + cell * 0.08;
        const s = cell - cell * 0.16;
        ctx.beginPath();
        ctx.roundRect(px, py, s, s, r);
        ctx.fill();
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
    const pad = Math.max(1.2, cell * 0.075);
    const r = Math.max(3, cell * 0.34);

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
    const outline = this.outlineOf(rects, Math.max(3, cell * 0.34));

    if (mode === 'outline') {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = c.base;
      ctx.setLineDash([cell * 0.26, cell * 0.2]);
      ctx.lineCap = 'round';
      ctx.stroke(this.outlineOf(rects, Math.max(3, cell * 0.34)));
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 1) 下に落ちる色付きの影
    ctx.save();
    ctx.shadowColor = `rgba(${c.shadow},${this.dark ? 0.5 : 0.42})`;
    ctx.shadowBlur = cell * 0.42;
    ctx.shadowOffsetY = cell * 0.16;
    ctx.fillStyle = c.dark;
    ctx.fill(path);
    ctx.restore();

    // 2) 本体（斜めのグラデーションで塊に見せる）
    const grad = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    grad.addColorStop(0, c.light);
    grad.addColorStop(0.36, c.base);
    grad.addColorStop(1, c.dark);
    ctx.fillStyle = grad;
    ctx.fill(path);

    // 3) 内側の陰影とざらつき
    ctx.save();
    ctx.clip(path);

    const rTL = ctx.createRadialGradient(
      box.x0 + box.w * 0.16, box.y0 + box.h * 0.14, 0,
      box.x0 + box.w * 0.16, box.y0 + box.h * 0.14, Math.max(box.w, box.h) * 0.92,
    );
    rTL.addColorStop(0, 'rgba(255,255,255,.17)');
    rTL.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rTL;
    ctx.fillRect(box.x0, box.y0, box.w, box.h);

    const rBR = ctx.createRadialGradient(
      box.x1 - box.w * 0.1, box.y1 - box.h * 0.06, 0,
      box.x1 - box.w * 0.1, box.y1 - box.h * 0.06, Math.max(box.w, box.h) * 0.78,
    );
    rBR.addColorStop(0, `rgba(${c.shadow},.34)`);
    rBR.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rBR;
    ctx.fillRect(box.x0, box.y0, box.w, box.h);

    if (this.grainPattern && cell > 12) {
      ctx.globalAlpha = alpha * 0.09;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(box.x0, box.y0, box.w, box.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
    }

    // 外周のふちに光をひとすじ。クリップしているので内側半分だけ残る
    ctx.lineWidth = Math.max(1.5, cell * 0.12);
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.stroke(outline);

    // てっぺんの平らな面のツヤ（横一続きごとに 1 本）
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = '#ffffff';
    for (const run of topRuns(rects)) {
      const w = run.x1 - run.x0;
      if (w <= cell * 0.6) continue;
      ctx.beginPath();
      ctx.roundRect(run.x0 + cell * 0.24, run.y + cell * 0.15, w - cell * 0.48, cell * 0.09, cell * 0.045);
      ctx.fill();
    }
    ctx.restore();

    // 4) 連結ピースの継ぎ目
    this.drawSeams(piece, dx, dy, alpha);

    // 5) 色記号（色覚サポート）
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

    // 6) 選択中はやわらかい白い光をまとう
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

  /** 連結ピースの内部境界（元のテトロミノ同士の境目）。粘土をくっつけた継ぎ目 */
  drawSeams(piece, dx, dy, alpha) {
    const parts = piece.parts;
    if (!parts) return;
    let multi = false;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] !== parts[0]) { multi = true; break; }
    }
    if (!multi) return;

    const ctx = this.ctx;
    const cell = this.cell;
    const index = new Map();
    for (let i = 0; i < piece.cells.length; i++) {
      index.set(`${piece.cells[i][0]},${piece.cells[i][1]}`, parts[i]);
    }

    ctx.save();
    ctx.globalAlpha = alpha * 0.3;
    ctx.lineCap = 'round';
    const inset = cell * 0.2;
    for (const pass of [
      { color: 'rgba(0,0,0,.5)', off: 0 },
      { color: 'rgba(255,255,255,.6)', off: Math.max(1, cell * 0.04) },
    ]) {
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = Math.max(1, cell * 0.035);
      ctx.beginPath();
      for (let i = 0; i < piece.cells.length; i++) {
        const [x, y] = piece.cells[i];
        const px = this.ox + x * cell + dx;
        const py = this.oy + y * cell + dy;
        const right = index.get(`${x + 1},${y}`);
        const below = index.get(`${x},${y + 1}`);
        if (right !== undefined && right !== parts[i]) {
          ctx.moveTo(px + cell + pass.off, py + inset);
          ctx.lineTo(px + cell + pass.off, py + cell - inset);
        }
        if (below !== undefined && below !== parts[i]) {
          ctx.moveTo(px + inset, py + cell + pass.off);
          ctx.lineTo(px + cell - inset, py + cell + pass.off);
        }
      }
      ctx.stroke();
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
    const col = ghost.willClear ? '#ff9f0a' : (this.dark ? 'rgba(255,255,255,.72)' : 'rgba(60,60,67,.5)');

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
      ctx.strokeStyle = '#ff9f0a';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.shadowColor = 'rgba(255,159,10,.85)';
      ctx.shadowBlur = cell * 0.4;
      for (const id of ghost.clearIds) {
        const p = view.board.pieces.get(id);
        if (!p || p.id === piece.id) continue;
        const r2 = this.cellRects(p, 0, 0);
        ctx.stroke(this.outlineOf(r2, Math.max(3, cell * 0.34)));
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
    ctx.strokeStyle = '#ff9f0a';
    ctx.lineWidth = Math.max(2.5, cell * 0.1);
    ctx.shadowColor = 'rgba(255,159,10,.9)';
    ctx.shadowBlur = cell * 0.6;
    ctx.stroke(this.outlineOf(this.cellRects(piece, 0, 0), Math.max(3, cell * 0.34)));
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
    ctx.fillStyle = '#ff9f0a';
    ctx.shadowColor = 'rgba(255,159,10,.9)';
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
      ctx.strokeStyle = this.dark ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.96)';
      ctx.font = `800 ${Math.floor(this.cell * 0.82)}px ${UI_FONT}`;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = `800 ${Math.floor(this.cell * 0.52)}px ${UI_FONT}`;
        ctx.strokeText(t.sub, 0, this.cell * 0.8);
        ctx.fillStyle = this.dark ? '#ffd60a' : '#c77800';
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
