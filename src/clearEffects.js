// 高級クリスタル / ガラス系のクリア演出。
// ★1: 2種類 / ★2: 2種類 / ★3: 1種類。
// レベルが高いほど、ガラス片・光・衝撃波の量とスケールを強化する。

const TAU = Math.PI * 2;

const PALETTE = [
  '#ffffff',
  '#e8f7ff',
  '#bfe9ff',
  '#9ad8ff',
  '#d8c8ff',
  '#f8e8ff',
  '#ffe8b8',
];

const fxClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fxEaseOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function color(i) {
  return PALETTE[i % PALETTE.length];
}

export class ClearEffects {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.particles = [];
    this.rings = [];
    this.rays = [];
    this.shocks = [];
    this.flashes = [];
    this.running = false;
    this.raf = 0;
    this.seed = 0;
    this.lastTime = 0;
    this.resizeHandler = null;
  }

  ensureCanvas() {
    if (this.canvas) return;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'clear-effects-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '1200',
      mixBlendMode: 'screen',
    });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler, { passive: true });
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.rays.length = 0;
    this.shocks.length = 0;
    this.flashes.length = 0;
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  // 高レベルほど強く。ただし無限に膨らまないよう上限を設ける。
  intensity(level, stars) {
    const lv = Math.max(1, Number(level) || 1);
    const levelBoost = 1 + Math.min(1.55, Math.log10(lv + 1) * 0.72);
    const starBoost = stars === 3 ? 1.55 : stars === 2 ? 1.18 : 0.82;
    return levelBoost * starBoost;
  }

  addParticle(p) {
    // 低スペック端末で暴れないよう上限。
    if (this.particles.length < 950) this.particles.push(p);
  }

  burst(x, y, count, speed, size, life, spread = TAU, gravity = 0.0, colorOffset = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * spread - spread / 2 + (spread === TAU ? 0 : -Math.PI / 2);
      const sp = speed * (0.35 + Math.random() * 1.15);
      this.addParticle({
        x: x + (Math.random() - 0.5) * size,
        y: y + (Math.random() - 0.5) * size,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        gravity,
        drag: 0.985 + Math.random() * 0.01,
        life: life * (0.72 + Math.random() * 0.4),
        maxLife: life,
        size: size * (0.12 + Math.random() * 0.55),
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.5,
        color: color(i + colorOffset),
        shape: Math.random() < 0.52 ? 'diamond' : (Math.random() < 0.5 ? 'glass' : 'dot'),
      });
    }
  }

  glassRain(x, y, count, scale, lift = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const r = Math.random() * scale * 0.45;
      const s = scale * (0.015 + Math.random() * 0.045);
      this.addParticle({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * scale * 0.004,
        vy: lift + scale * (0.001 + Math.random() * 0.006),
        gravity: scale * 0.000018,
        drag: 0.992,
        life: 1.0 + Math.random() * 1.6,
        maxLife: 1.0 + Math.random() * 1.6,
        size: s,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.22,
        color: color(i + 2),
        shape: 'glass',
      });
    }
  }

  ring(x, y, radius, width, life, colorIndex, delay = 0) {
    this.rings.push({
      x, y, radius, width, life, maxLife: life,
      color: color(colorIndex), delay
    });
  }

  shock(x, y, maxRadius, life, width, delay = 0) {
    this.shocks.push({
      x, y, maxRadius, life, maxLife: life, width, delay
    });
  }

  ray(x, y, angle, length, width, life, colorIndex, delay = 0) {
    this.rays.push({
      x, y, angle, length, width, life, maxLife: life,
      color: color(colorIndex), delay
    });
  }

  flash(x, y, radius, life, alpha = 0.85) {
    this.flashes.push({ x, y, radius, life, maxLife: life, alpha });
  }

  // ★1 / TYPE A: 繊細なガラス散乱
  effectStar1Glass(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    this.flash(x, y, scale * 0.28 * s, 0.18, 0.52);
    this.shock(x, y, scale * 0.20 * s, 0.62, 2.2);
    this.ring(x, y, scale * 0.24 * s, 2.1, 0.78, 1);
    this.burst(x, y, Math.round(70 * s), scale * 0.004 * s, scale * 0.12, 0.9, TAU, scale * 0.000008);
    this.glassRain(x, y, Math.round(55 * s + highLevel * 10), scale, scale * 0.0004);
  }

  // ★1 / TYPE B: 斜めカットのガラス波
  effectStar1Wave(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    this.flash(x, y, scale * 0.22 * s, 0.13, 0.42);
    for (let i = 0; i < 4; i++) {
      this.shock(x, y, scale * (0.12 + i * 0.055) * s, 0.52 + i * 0.05, 1.5 + i * 0.25, i * 0.045);
    }
    for (let i = 0; i < 18 + Math.round(highLevel * 3); i++) {
      this.ray(x, y, (TAU * i / 18) + 0.22, scale * (0.18 + Math.random() * 0.2) * s, 1.2 + Math.random() * 1.3, 0.55, i, i * 0.006);
    }
    this.glassRain(x, y, Math.round(65 * s + highLevel * 8), scale * 1.08, scale * 0.0008);
  }

  // ★2 / TYPE C: 連続クラッシュ
  effectStar2Crash(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    this.flash(x, y, scale * 0.38 * s, 0.2, 0.68);
    this.burst(x, y, Math.round(170 * s + highLevel * 20), scale * 0.007 * s, scale * 0.18, 1.15, TAU, scale * 0.000012);
    for (let i = 0; i < 6; i++) {
      this.shock(x, y, scale * (0.18 + i * 0.09) * s, 0.78 + i * 0.045, 2.2 + i * 0.4, i * 0.035);
      this.ring(x, y, scale * (0.18 + i * 0.075) * s, 2.6 + i * 0.35, 0.95 + i * 0.04, i, i * 0.028);
    }
    this.glassRain(x, y, Math.round(120 * s + highLevel * 15), scale * 1.18, scale * 0.00035);
  }

  // ★2 / TYPE D: クリスタル・ファイアリング
  effectStar2Fire(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);
    for (let k = 0; k < 5; k++) {
      const a = TAU * k / 5 + 0.15;
      const cx = x + Math.cos(a) * scale * 0.12 * s;
      const cy = y + Math.sin(a) * scale * 0.12 * s;
      this.flash(cx, cy, scale * 0.14 * s, 0.13, 0.46);
      this.shock(cx, cy, scale * 0.11 * s, 0.48, 1.6);
      this.burst(cx, cy, Math.round(46 * s + highLevel * 6), scale * 0.0045 * s, scale * 0.10, 0.85);
      for (let i = 0; i < 10; i++) {
        this.ray(cx, cy, TAU * i / 10, scale * 0.11 * s, 1.2, 0.46, i + k * 2, i * 0.02);
      }
    }
    this.shock(x, y, scale * 0.64 * s, 0.95, 3.6);
    this.glassRain(x, y, Math.round(160 * s + highLevel * 12), scale * 1.3, scale * 0.0006);
  }

  // ★3: 完全別格。ガラスの「圧縮 → 破砕 → 巨大衝撃波 → 余韻」
  effectStar3Master(x, y, s, highLevel) {
    const scale = Math.min(this.w, this.h);

    // 0) ほんの一瞬の白い核
    this.flash(x, y, scale * 0.15 * s, 0.10, 0.95);

    // 1) 破砕前の巨大な収束感
    for (let i = 0; i < 16; i++) {
      const a = TAU * i / 16;
      this.ray(x, y, a, scale * (0.24 + (i % 3) * 0.04) * s, 2.4 + (i % 2), 0.48, i, i * 0.012);
    }

    // 2) 本爆発
    this.flash(x, y, scale * 0.62 * s, 0.24, 1.0);
    this.burst(x, y, Math.round(430 * s + highLevel * 45), scale * 0.009 * s, scale * 0.22, 1.45, TAU, scale * 0.000015, 2);
    this.glassRain(x, y, Math.round(300 * s + highLevel * 30), scale * 1.45, scale * 0.0002);

    // 3) 巨大な多重衝撃波
    for (let i = 0; i < 10; i++) {
      this.shock(x, y, scale * (0.16 + i * 0.095) * s, 1.18 + i * 0.05, 3.4 + i * 0.45, i * 0.032);
      this.ring(x, y, scale * (0.14 + i * 0.085) * s, 3.4 + i * 0.45, 1.22 + i * 0.05, i + 1, i * 0.025);
    }

    // 4) 外周へ走る光
    const rays = 34 + Math.round(highLevel * 3);
    for (let i = 0; i < rays; i++) {
      const a = TAU * i / rays;
      this.ray(
        x, y, a,
        scale * (0.38 + Math.random() * 0.34) * s,
        1.5 + Math.random() * 3.2,
        0.82 + Math.random() * 0.28,
        i + 3,
        Math.random() * 0.15
      );
    }

    // 5) 余韻。大量の細かいガラス片が落ちる。
    this.glassRain(x, y, Math.round(240 * s + highLevel * 26), scale * 1.65, scale * 0.00045);
  }

  play({ stars = 1, level = 1, centerX = window.innerWidth / 2, centerY = window.innerHeight / 2, calm = false } = {}) {
    if (calm || !document?.body) return;
    this.ensureCanvas();

    const scale = this.intensity(level, stars);
    // 「高レベル」感をほんの少し視覚化。0〜1に圧縮。
    const highLevel = Math.min(6, Math.log10(Math.max(1, level)) + 0.3);

    this.clear();
    this.seed++;

    const variant = stars === 3 ? 5 : (stars === 2 ? (Math.random() < 0.5 ? 3 : 4) : (Math.random() < 0.5 ? 1 : 2));

    if (variant === 1) this.effectStar1Glass(centerX, centerY, scale, highLevel);
    else if (variant === 2) this.effectStar1Wave(centerX, centerY, scale, highLevel);
    else if (variant === 3) this.effectStar2Crash(centerX, centerY, scale, highLevel);
    else if (variant === 4) this.effectStar2Fire(centerX, centerY, scale, highLevel);
    else this.effectStar3Master(centerX, centerY, scale, highLevel);

    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame((t) => this.draw(t));
  }

  draw(now) {
    if (!this.running || !this.ctx) return;
    const dt = fxClamp((now - this.lastTime) / 1000 * 2.0, 0.008, 0.066);
    this.lastTime = now;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    let alive = false;

    for (const f of this.flashes) {
      f.life -= dt;
      if (f.life <= 0) continue;
      alive = true;
      const t = fxClamp(f.life / f.maxLife, 0, 1);
      const alpha = Math.pow(t, 1.8) * f.alpha;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.18, `rgba(255,255,255,${alpha * 0.55})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    for (const s of this.shocks) {
      if (s.delay > 0) {
        s.delay -= dt;
        alive = true;
        continue;
      }
      s.life -= dt;
      if (s.life <= 0) continue;
      alive = true;
      const t = 1 - s.life / s.maxLife;
      const r = s.maxRadius * easeOutQuint(fxClamp(t, 0, 1));
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.lineWidth = s.width * (1 - t * 0.65);
      ctx.globalAlpha = Math.pow(1 - t, 0.7) * 0.82;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#d9f5ff';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    for (const r of this.rings) {
      if (r.delay > 0) {
        r.delay -= dt;
        alive = true;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) continue;
      alive = true;
      const t = 1 - r.life / r.maxLife;
      const radius = r.radius * fxEaseOutCubic(fxClamp(t, 0, 1));
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.lineWidth = r.width * (0.35 + (1 - t));
      ctx.globalAlpha = Math.pow(1 - t, 0.58) * 0.76;
      ctx.strokeStyle = r.color;
      ctx.shadowBlur = 14;
      ctx.shadowColor = r.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    for (const r of this.rays) {
      if (r.delay > 0) {
        r.delay -= dt;
        alive = true;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) continue;
      alive = true;
      const t = 1 - r.life / r.maxLife;
      const len = r.length * fxEaseOutCubic(fxClamp(t * 1.12, 0, 1));
      const x2 = r.x + Math.cos(r.angle) * len;
      const y2 = r.y + Math.sin(r.angle) * len;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = r.width * (1 - t * 0.58);
      ctx.globalAlpha = (1 - t) * 0.72;
      ctx.strokeStyle = r.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = r.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      alive = true;

      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.gravity * dt * 60;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.rot += p.spin * dt * 60;

      const a = Math.pow(fxClamp(p.life / p.maxLife, 0, 1), 0.72);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.shadowBlur = Math.min(18, p.size * 2.4);
      ctx.shadowColor = p.color;

      if (p.shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.62, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size * 0.62, 0);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'glass') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.54, -p.size * 0.28);
        ctx.lineTo(p.size * 0.28, p.size);
        ctx.lineTo(-p.size * 0.45, p.size * 0.36);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = a * 0.7;
        ctx.lineWidth = Math.max(0.7, p.size * 0.08);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (alive) {
      this.raf = requestAnimationFrame((t) => this.draw(t));
    } else {
      this.running = false;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  }
}
