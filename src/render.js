// Canvas 描画。盤面・ブロック・着地予測ゴースト・演出をすべてここで描く。

import { DIRS, DIR_KEYS } from './shapes.js';

/** 6色。base=本体 / light=上面ハイライト / dark=下面の影 */
export const PALETTE = [
  { name: '赤', base: '#ff4d6d', light: '#ff8ba1', dark: '#c31f43', glow: '255,77,109' },
  { name: '橙', base: '#ff9d3d', light: '#ffc17f', dark: '#c96b12', glow: '255,157,61' },
  { name: '黄', base: '#ffd93d', light: '#fff08c', dark: '#c6a306', glow: '255,217,61' },
  { name: '緑', base: '#37d67a', light: '#87f0b3', dark: '#129a4f', glow: '55,214,122' },
  { name: '青', base: '#4d9dff', light: '#93c4ff', dark: '#1a63c9', glow: '77,157,255' },
  { name: '紫', base: '#b56bff', light: '#d6aaff', dark: '#7a2ed6', glow: '181,107,255' },
];

/** 色覚サポート用の記号 */
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cell = 30;
    this.ox = 0;
    this.oy = 0;
    this.size = 12;

    this.particles = [];
    this.rings = [];
    this.texts = [];
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

    // 盤面は正方形。余白 6px を確保して中央寄せ
    const cell = Math.floor((Math.min(w, h) - 12) / this.size);
    this.cell = Math.max(8, cell);
    const boardPx = this.cell * this.size;
    this.ox = Math.floor((w - boardPx) / 2);
    this.oy = Math.floor((h - boardPx) / 2);
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

  burst(cells, colorIndex) {
    const c = PALETTE[colorIndex];
    const n = this.options.calm ? 3 : 7;
    for (const [cx, cy] of cells) {
      const p = this.cellCenter(cx, cy);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.6 + Math.random() * 2.6) * this.cell * 0.055;
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * this.cell * 0.5,
          y: p.y + (Math.random() - 0.5) * this.cell * 0.5,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.018 + Math.random() * 0.022,
          size: this.cell * (0.1 + Math.random() * 0.2),
          color: Math.random() < 0.25 ? c.light : c.base,
          spin: (Math.random() - 0.5) * 0.3,
          rot: Math.random() * Math.PI,
        });
      }
    }
  }

  ring(x, y, colorIndex, strength = 1) {
    this.rings.push({
      x, y,
      r: this.cell * 0.4,
      maxR: this.cell * (2.2 + strength * 1.5),
      life: 1,
      color: PALETTE[colorIndex].glow,
    });
  }

  floatText(x, y, text, sub, color) {
    this.texts.push({ x, y, text, sub, color, life: 1, vy: -0.55 });
  }

  addShake(amount) {
    if (this.options.calm) amount *= 0.35;
    this.shake = Math.min(20, this.shake + amount);
  }

  clearEffects() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.shake = 0;
  }

  get busyEffects() {
    return this.particles.length > 0 || this.rings.length > 0 || this.texts.length > 0;
  }

  // ---------------------------------------------------------------- 描画

  /**
   * @param {object} view 描画に必要な状態
   *   board, anim, selected, ghost, hint, invalidShake, dt
   */
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
      this.shake *= Math.pow(0.86, dt * 60);
    } else {
      this.shake = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);

    this.drawBoardBase(view.board);
    this.drawPieces(view);
    if (view.selected != null && !view.ghost && !view.anim) {
      this.drawMoveHints(view.board, view.selected);
    }
    if (view.ghost && this.options.ghost) this.drawGhost(view);
    if (view.hint) this.drawHint(view);

    this.drawRings(dt);
    this.drawParticles(dt);
    this.drawTexts(dt);

    ctx.restore();
  }

  drawBoardBase(board) {
    const ctx = this.ctx;
    const n = this.size;
    const cell = this.cell;
    const w = cell * n;
    const x0 = this.ox;
    const y0 = this.oy;

    // 盤面の器
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - 5, y0 - 5, w + 10, w + 10, 16);
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + w);
    g.addColorStop(0, '#111a33');
    g.addColorStop(1, '#0a1122');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 空きマス（＝通路）を少し明るく。「空間が資源」であることを見せる
    ctx.save();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (board && board.at(x, y) !== -1) continue;
        const px = x0 + x * cell;
        const py = y0 + y * cell;
        ctx.beginPath();
        ctx.roundRect(px + 2, py + 2, cell - 4, cell - 4, Math.max(2, cell * 0.16));
        ctx.fillStyle = 'rgba(140,175,255,.055)';
        ctx.fill();
      }
    }
    ctx.restore();

    // 格子
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(x0 + i * cell + 0.5, y0);
      ctx.lineTo(x0 + i * cell + 0.5, y0 + w);
      ctx.moveTo(x0, y0 + i * cell + 0.5);
      ctx.lineTo(x0 + w, y0 + i * cell + 0.5);
    }
    ctx.stroke();
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
          // 目標位置から逆算して現在位置を求める
          dx = -d.x * anim.steps * this.cell * (1 - p);
          dy = -d.y * anim.steps * this.cell * (1 - p);
          this.drawTrail(piece, d, anim, p);
        } else if (anim.phase === 'land') {
          squash = Math.sin(anim.t * Math.PI) * 0.14;
        }
      }

      if (invalid && invalid.pieceId === piece.id) {
        const d = DIRS[invalid.dir];
        const k = Math.sin(invalid.t * Math.PI * 6) * (1 - invalid.t) * this.cell * 0.17;
        dx += d.x * k;
        dy += d.y * k;
      }

      this.drawPiece(piece, dx, dy, 1, squash, selected === piece.id);
    }
  }

  drawTrail(piece, d, anim, p) {
    const ctx = this.ctx;
    const c = PALETTE[piece.color];
    const total = anim.steps * this.cell;
    for (let i = 1; i <= 3; i++) {
      const back = Math.min(1, (1 - p) + i * 0.1);
      const dx = -d.x * total * back;
      const dy = -d.y * total * back;
      ctx.save();
      ctx.globalAlpha = 0.16 * (1 - i / 4) * Math.min(1, p * 3);
      ctx.fillStyle = c.base;
      for (const [cx, cy] of piece.cells) {
        ctx.beginPath();
        ctx.roundRect(
          this.ox + cx * this.cell + dx + 2,
          this.oy + cy * this.cell + dy + 2,
          this.cell - 4, this.cell - 4,
          this.cell * 0.2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** ブロック本体。同じブロックのセル同士は継ぎ目なく繋げて描く */
  drawPiece(piece, dx = 0, dy = 0, alpha = 1, squash = 0, selected = false, outlineOnly = false) {
    const ctx = this.ctx;
    const cell = this.cell;
    const c = PALETTE[piece.color];
    const own = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
    const has = (x, y) => own.has(`${x},${y}`);

    // 着地時の沈み込み
    let cx0 = 0;
    let cy0 = 0;
    let sc = 1;
    if (squash) {
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const [x, y] of piece.cells) {
        mnx = Math.min(mnx, x); mny = Math.min(mny, y);
        mxx = Math.max(mxx, x); mxy = Math.max(mxy, y);
      }
      cx0 = this.ox + ((mnx + mxx + 1) / 2) * cell;
      cy0 = this.oy + ((mny + mxy + 1) / 2) * cell;
      sc = 1 - squash;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    if (squash) {
      ctx.translate(cx0, cy0);
      ctx.scale(1 + squash * 0.5, sc);
      ctx.translate(-cx0, -cy0);
    }

    const pad = Math.max(1.2, cell * 0.055);
    const r = Math.max(2, cell * 0.26);

    const paths = [];
    for (const [x, y] of piece.cells) {
      const up = has(x, y - 1);
      const down = has(x, y + 1);
      const left = has(x - 1, y);
      const right = has(x + 1, y);

      const px = this.ox + x * cell + dx + (left ? -pad : pad);
      const py = this.oy + y * cell + dy + (up ? -pad : pad);
      const pw = cell - (left ? -pad : pad) - (right ? -pad : pad);
      const ph = cell - (up ? -pad : pad) - (down ? -pad : pad);

      // 外側の角だけ丸める
      const radii = [
        (!up && !left) ? r : 0,
        (!up && !right) ? r : 0,
        (!down && !right) ? r : 0,
        (!down && !left) ? r : 0,
      ];
      paths.push({ px, py, pw, ph, radii, up });
    }

    if (outlineOnly) {
      ctx.lineWidth = Math.max(1.5, cell * 0.08);
      ctx.strokeStyle = c.base;
      ctx.setLineDash([cell * 0.24, cell * 0.18]);
      for (const p of paths) {
        ctx.beginPath();
        ctx.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 影
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    for (const p of paths) {
      ctx.beginPath();
      ctx.roundRect(p.px, p.py + cell * 0.07, p.pw, p.ph, p.radii);
      ctx.fill();
    }
    ctx.restore();

    // 本体
    const gy0 = this.oy + Math.min(...piece.cells.map(([, y]) => y)) * cell + dy;
    const gy1 = this.oy + (Math.max(...piece.cells.map(([, y]) => y)) + 1) * cell + dy;
    const grad = ctx.createLinearGradient(0, gy0, 0, gy1);
    grad.addColorStop(0, c.light);
    grad.addColorStop(0.42, c.base);
    grad.addColorStop(1, c.dark);
    ctx.fillStyle = grad;
    for (const p of paths) {
      ctx.beginPath();
      ctx.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
      ctx.fill();
    }

    // 上面のツヤ（各セルの上端が外側のときだけ）
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    for (const p of paths) {
      if (p.up) continue;
      ctx.beginPath();
      ctx.roundRect(p.px + cell * 0.14, p.py + cell * 0.1, p.pw - cell * 0.28, cell * 0.12, cell * 0.06);
      ctx.fill();
    }
    ctx.restore();

    // 輪郭
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.strokeStyle = 'rgba(0,0,0,.30)';
    for (const p of paths) {
      ctx.beginPath();
      ctx.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
      ctx.stroke();
    }

    // 色記号（色覚サポート）
    if (this.options.symbols && cell > 16) {
      const [ax, ay] = piece.cells[Math.floor(piece.cells.length / 2)];
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = 'rgba(0,0,0,.8)';
      ctx.font = `${Math.floor(cell * 0.5)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SYMBOLS[piece.color], this.ox + (ax + 0.5) * cell + dx, this.oy + (ay + 0.55) * cell + dy);
      ctx.restore();
    }

    // 選択中: 白く脈動するアウトライン
    if (selected) {
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 7);
      ctx.save();
      ctx.globalAlpha = alpha * (0.5 + 0.5 * pulse);
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,255,255,.85)';
      ctx.shadowBlur = cell * 0.5;
      for (const p of paths) {
        ctx.beginPath();
        ctx.roundRect(p.px, p.py, p.pw, p.ph, p.radii);
        ctx.stroke();
      }
      ctx.restore();
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

    this.drawPiece(piece, dx, dy, 0.3, 0, false, false);
    this.drawPiece(piece, dx, dy, 0.95, 0, false, true);

    // 進行方向の矢印
    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const from = this.cellCenter(cxs, cys);
    const to = { x: from.x + dx, y: from.y + dy };
    const col = ghost.willClear ? '#ffd93d' : 'rgba(255,255,255,.75)';

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.setLineDash([cell * 0.3, cell * 0.22]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x + d.x * cell * 0.4, from.y + d.y * cell * 0.4);
    ctx.lineTo(to.x - d.x * cell * 0.35, to.y - d.y * cell * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);

    // 矢じり
    const ax = to.x + d.x * cell * 0.1;
    const ay = to.y + d.y * cell * 0.1;
    const s = cell * 0.32;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ax + d.x * s, ay + d.y * s);
    ctx.lineTo(ax - d.x * s * 0.5 + d.y * s * 0.62, ay - d.y * s * 0.5 + d.x * s * 0.62);
    ctx.lineTo(ax - d.x * s * 0.5 - d.y * s * 0.62, ay - d.y * s * 0.5 - d.x * s * 0.62);
    ctx.closePath();
    ctx.fill();

    // 消える予定の相手を光らせる
    if (ghost.willClear && ghost.clearIds) {
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.time * 9);
      ctx.strokeStyle = '#ffd93d';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      for (const id of ghost.clearIds) {
        const p = view.board.pieces.get(id);
        if (!p || p.id === piece.id) continue;
        for (const [x, y] of p.cells) {
          ctx.beginPath();
          ctx.roundRect(this.ox + x * cell + 2, this.oy + y * cell + 2, cell - 4, cell - 4, cell * 0.2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /** ヒント: 黄色の脈動 + 方向矢印 */
  drawHint(view) {
    const { hint, board } = view;
    const piece = board.pieces.get(hint.pieceId);
    if (!piece) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);

    ctx.save();
    ctx.globalAlpha = 0.45 + 0.5 * pulse;
    ctx.strokeStyle = '#ffd93d';
    ctx.lineWidth = Math.max(2.5, cell * 0.11);
    ctx.shadowColor = 'rgba(255,217,61,.9)';
    ctx.shadowBlur = cell * 0.7;
    for (const [x, y] of piece.cells) {
      ctx.beginPath();
      ctx.roundRect(this.ox + x * cell + 2, this.oy + y * cell + 2, cell - 4, cell - 4, cell * 0.2);
      ctx.stroke();
    }
    ctx.restore();

    const d = DIRS[hint.dir];
    const cxs = piece.cells.reduce((s, c) => s + c[0], 0) / piece.cells.length;
    const cys = piece.cells.reduce((s, c) => s + c[1], 0) / piece.cells.length;
    const base = this.cellCenter(cxs, cys);
    const off = cell * (0.9 + 0.35 * pulse);
    const ax = base.x + d.x * off;
    const ay = base.y + d.y * off;
    const s = cell * 0.4;

    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * pulse;
    ctx.fillStyle = '#ffd93d';
    ctx.shadowColor = 'rgba(255,217,61,.9)';
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
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= Math.pow(0.94, k);
      p.vy *= Math.pow(0.94, k);
      p.rot += p.spin * k;
      p.life -= p.decay * k;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + p.life * 0.6);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.restore();
  }

  drawRings(dt) {
    const ctx = this.ctx;
    const k = dt * 60;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= 0.035 * k;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = easeOutCubic(1 - r.life);
      const rad = r.r + (r.maxR - r.r) * t;
      ctx.save();
      ctx.globalAlpha = r.life * 0.55;
      ctx.strokeStyle = `rgba(${r.color},1)`;
      ctx.lineWidth = Math.max(1.5, this.cell * 0.16 * r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
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
      ctx.globalAlpha = Math.min(1, t.life * 2.2);
      ctx.translate(t.x, t.y);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, this.cell * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.fillStyle = t.color;
      ctx.font = `900 ${Math.floor(this.cell * 0.95)}px "Impact", "Arial Black", system-ui, sans-serif`;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = `900 ${Math.floor(this.cell * 0.62)}px "Impact", "Arial Black", system-ui, sans-serif`;
        ctx.strokeText(t.sub, 0, this.cell * 0.88);
        ctx.fillStyle = '#ffd93d';
        ctx.fillText(t.sub, 0, this.cell * 0.88);
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
      const ax = base.x + d.x * cell * 1.15;
      const ay = base.y + d.y * cell * 1.15;
      const s = cell * 0.22;
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 5);
      ctx.fillStyle = '#fff';
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
