// ゲーム進行・アニメーション・UI 配線。

import { Board } from './board.js';
import { DIRS } from './shapes.js';
import { generatePuzzle } from './generator.js';
import { Renderer, PALETTE } from './render.js';
import { attachInput } from './input.js';
import { seedToCode, codeToSeed, hashSeed } from './rng.js';

/** 大量消去の段階評価（セル数） */
const TIERS = [
  { cells: 20, label: 'ミラクル!!!', color: '#ff7ad9' },
  { cells: 16, label: 'ファンタスティック!!', color: '#ffd93d' },
  { cells: 12, label: 'グレイト!', color: '#7fe7a3' },
];

const STORE_KEY = 'slidepop.v1';

function tierOf(cells) {
  for (const t of TIERS) if (cells >= t.cells) return t;
  return null;
}

function todaySeedSource() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `daily-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveStore(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* プライベートモードなどでは黙って諦める */ }
}

export class Game {
  constructor(dom) {
    this.dom = dom;
    this.renderer = new Renderer(dom.canvas);
    this.board = new Board();
    this.store = loadStore();
    this.settings = Object.assign(
      { symbols: false, ghost: true, calm: false },
      this.store.settings || {},
    );

    this.puzzle = null;
    this.solutionMap = new Map();
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.status = 'playing';
    this.mode = 'free';

    this.anim = null;
    this.invalid = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    this.newRecord = false;
    this.initialCells = 0;

    this.applySettings();
    this.bindUi();
    this.bindInput();

    const ro = new ResizeObserver(() => this.renderer.resize(this.board.size));
    ro.observe(dom.canvas);
    window.addEventListener('resize', () => this.renderer.resize(this.board.size));

    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ パズル

  /** @param {number} seed @param {'free'|'daily'} mode */
  load(seed, mode = 'free') {
    this.renderer.clearEffects();
    let puzzle;
    try {
      puzzle = generatePuzzle(seed);
    } catch (err) {
      this.toast('問題の生成に失敗しました。もう一度お試しください。');
      console.error(err);
      return;
    }
    this.puzzle = puzzle;
    this.mode = mode;
    this.board.restore(puzzle.snapshot);
    this.initialCells = puzzle.cells;
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.status = 'playing';
    this.selected = null;
    this.ghost = null;
    this.hint = null;
    this.anim = null;

    this.buildSolutionMap();
    this.renderer.resize(this.board.size);
    this.hideOverlay();
    this.updateHud();

    const code = seedToCode(puzzle.seed);
    if (mode === 'daily') {
      location.hash = '#daily';
    } else {
      location.hash = `#${code}`;
    }
  }

  /**
   * 保証解をたどり、各局面の指紋 -> 次の手 の対応表を作る。
   * プレイヤーが解の道筋に乗っている間は、この表からヒントを出せる。
   */
  buildSolutionMap() {
    this.solutionMap.clear();
    const sim = new Board(this.puzzle.size);
    sim.restore(this.puzzle.snapshot);
    for (const step of this.puzzle.solution) {
      this.solutionMap.set(sim.fingerprint(), step);
      sim.applyMove(step.pieceId, step.dir);
    }
  }

  newPuzzle() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.load(seed, 'free');
    this.toast('新しい問題を用意しました');
  }

  daily() {
    this.load(hashSeed(todaySeedSource()), 'daily');
    this.toast('今日のデイリーパズル');
  }

  restart() {
    if (!this.puzzle) return;
    this.renderer.clearEffects();
    this.board.restore(this.puzzle.snapshot);
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.status = 'playing';
    this.selected = null;
    this.ghost = null;
    this.hint = null;
    this.anim = null;
    this.hideOverlay();
    this.updateHud();
    this.toast('最初からやり直します');
  }

  // ------------------------------------------------------------ 手番

  get busy() {
    return this.anim !== null;
  }

  canInteract() {
    return this.status === 'playing' && !this.busy;
  }

  tryMove(pieceId, dir) {
    if (!this.canInteract()) return;
    if (!this.board.pieces.has(pieceId)) return;

    const steps = this.board.slideDistance(pieceId, dir);
    if (steps <= 0) {
      // 無効手はブロックを小刻みに揺らして拒否。手数には数えない
      this.invalid = { pieceId, dir, t: 0 };
      this.ghost = null;
      return;
    }

    this.history.push({ snap: this.board.snapshot(), moves: this.moves });
    if (this.history.length > 400) this.history.shift();

    this.hint = null;
    this.ghost = null;
    this.selected = pieceId;
    this.moves++;

    this.board.movePiece(pieceId, dir, steps);
    this.anim = {
      phase: 'slide',
      pieceId,
      dir,
      steps,
      t: 0,
      duration: Math.min(0.36, 0.1 + steps * 0.033),
    };
    this.updateHud();
  }

  onSlideEnd(a) {
    const group = this.board.colorGroup(a.pieceId);
    if (group.length < 2) {
      // 何も消えない手。着地の沈み込みだけ見せる
      this.anim = { phase: 'land', pieceId: a.pieceId, dir: a.dir, steps: a.steps, t: 0, duration: 0.17 };
      return;
    }

    const pieces = group.map((id) => this.board.pieces.get(id));
    let cells = 0;
    let sx = 0;
    let sy = 0;
    for (const p of pieces) {
      this.renderer.burst(p.cells, p.color);
      for (const [x, y] of p.cells) {
        sx += x + 0.5;
        sy += y + 0.5;
        cells++;
      }
    }
    const center = this.renderer.cellCenter(sx / cells - 0.5, sy / cells - 0.5);
    const color = pieces[0].color;
    this.renderer.ring(center.x, center.y, color, group.length);
    this.renderer.addShake(2.5 + cells * 0.55);

    const tier = tierOf(cells);
    this.renderer.floatText(
      center.x,
      center.y,
      `${cells}個消し！`,
      tier ? tier.label : null,
      tier ? tier.color : '#ffffff',
    );

    for (const id of group) this.board.removePiece(id);
    this.selected = null;
    this.anim = null;
    this.afterMove();
  }

  afterMove() {
    this.updateHud();
    if (this.board.isEmpty) {
      this.status = 'won';
      this.recordResult();
      setTimeout(() => this.showWin(), 620);
      return;
    }
    if (this.board.isDeadlock()) {
      this.status = 'dead';
      setTimeout(() => this.showDead(), 380);
    }
  }

  undo() {
    if (this.busy || this.history.length === 0) return;
    const h = this.history.pop();
    this.board.restore(h.snap);
    this.moves = h.moves;
    this.status = 'playing';
    this.selected = null;
    this.ghost = null;
    this.hint = null;
    this.renderer.clearEffects();
    this.hideOverlay();
    this.updateHud();
  }

  showHint() {
    if (!this.canInteract()) return;
    const step = this.solutionMap.get(this.board.fingerprint());
    if (step) {
      this.hint = { pieceId: step.pieceId, dir: step.dir };
      this.hintsUsed++;
      this.toast(`保証解の第${this.moves + 1}手：${step.cleared}個まとめて消えます`);
      this.updateHud();
      return;
    }
    const moves = this.board.findClearingMoves();
    if (moves.length > 0) {
      const best = moves[0];
      this.hint = { pieceId: best.id, dir: best.dir };
      this.hintsUsed++;
      this.toast(`${best.cleared.length}個（${best.clearedCells}マス）消せる手があります`);
      this.updateHud();
      return;
    }
    this.toast('いま消せる手はありません。「戻す」で組み立て直しましょう');
  }

  // ------------------------------------------------------------ 入力

  bindInput() {
    attachInput(this.dom.canvas, {
      canInteract: () => this.canInteract(),
      toCell: (x, y) => this.renderer.toCell(x, y),
      pieceAt: (x, y) => {
        const id = this.board.at(x, y);
        return id >= 0 ? id : null;
      },
      onTap: (id) => {
        this.selected = id;
        this.ghost = null;
        if (id != null) this.hint = null;
      },
      onPreview: (id, dir) => this.setGhost(id, dir),
      onCommit: (id, dir) => this.tryMove(id, dir),
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key;
      const arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (arrows[key]) {
        e.preventDefault();
        if (this.selected != null) this.tryMove(this.selected, arrows[key]);
        else this.toast('先にブロックをクリックして選んでください');
        return;
      }
      const k = key.toLowerCase();
      if (k === 'z' || k === 'u' || k === 'backspace') { e.preventDefault(); this.undo(); }
      else if (k === 'h') { e.preventDefault(); this.showHint(); }
      else if (k === 'r') { e.preventDefault(); this.restart(); }
      else if (k === 'n') { e.preventDefault(); this.newPuzzle(); }
      else if (k === 'escape') { this.selected = null; this.ghost = null; this.closeModals(); }
    });
  }

  setGhost(pieceId, dir) {
    if (!dir || !this.canInteract()) {
      this.ghost = null;
      return;
    }
    const piece = this.board.pieces.get(pieceId);
    if (!piece) { this.ghost = null; return; }
    const sim = this.board.simulate(pieceId, dir);
    if (!sim) { this.ghost = null; return; }
    this.ghost = {
      piece,
      dir,
      steps: sim.steps,
      willClear: sim.cleared.length > 0,
      clearIds: sim.cleared,
    };
  }

  // ------------------------------------------------------------ UI

  bindUi() {
    const d = this.dom;
    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnHint.addEventListener('click', () => this.showHint());
    d.btnRestart.addEventListener('click', () => this.restart());
    d.btnNew.addEventListener('click', () => this.newPuzzle());
    d.btnRules.addEventListener('click', () => this.openModal(d.modalRules));
    d.btnSettings.addEventListener('click', () => this.openModal(d.modalSettings));

    for (const modal of [d.modalRules, d.modalSettings]) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.hasAttribute('data-close')) this.closeModals();
      });
    }

    d.optSymbols.checked = this.settings.symbols;
    d.optGhost.checked = this.settings.ghost;
    d.optCalm.checked = this.settings.calm;
    const sync = () => {
      this.settings.symbols = d.optSymbols.checked;
      this.settings.ghost = d.optGhost.checked;
      this.settings.calm = d.optCalm.checked;
      this.applySettings();
      this.store.settings = this.settings;
      saveStore(this.store);
    };
    d.optSymbols.addEventListener('change', sync);
    d.optGhost.addEventListener('change', sync);
    d.optCalm.addEventListener('change', sync);

    d.btnSeedGo.addEventListener('click', () => {
      const raw = d.seedInput.value.trim();
      if (!raw) return;
      this.closeModals();
      this.load(codeToSeed(raw), 'free');
      this.toast(`シード ${seedToCode(this.puzzle.seed)} の問題`);
    });
    d.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') d.btnSeedGo.click();
    });
    d.btnDaily.addEventListener('click', () => { this.closeModals(); this.daily(); });
    d.btnShare.addEventListener('click', () => this.share());
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
  }

  openModal(el) {
    el.hidden = false;
  }

  closeModals() {
    this.dom.modalRules.hidden = true;
    this.dom.modalSettings.hidden = true;
  }

  async share() {
    const url = `${location.origin}${location.pathname}#${seedToCode(this.puzzle.seed)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('リンクをコピーしました');
    } catch {
      this.dom.seedInput.value = seedToCode(this.puzzle.seed);
      this.toast(`シード: ${seedToCode(this.puzzle.seed)}`);
    }
  }

  toast(msg) {
    const el = this.dom.toast;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /** 色ごとの残りブロック数。1個だけ残っている色は「相棒がいない = 消せない」ので目立たせる */
  updateLegend() {
    const d = this.dom;
    if (!d.legend) return;
    const counts = new Array(PALETTE.length).fill(0);
    for (const p of this.board.pieces.values()) counts[p.color]++;

    if (d.legend.childElementCount !== PALETTE.length) {
      d.legend.innerHTML = '';
      for (const c of PALETTE) {
        const chip = document.createElement('div');
        chip.className = 'legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${c.base}"></span><span class="legend-n">0</span>`;
        chip.title = `${c.name}の残りブロック数`;
        d.legend.appendChild(chip);
      }
    }
    for (let i = 0; i < PALETTE.length; i++) {
      const chip = d.legend.children[i];
      chip.querySelector('.legend-n').textContent = String(counts[i]);
      chip.classList.toggle('empty', counts[i] === 0);
      chip.classList.toggle('lone', counts[i] === 1);
    }
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statPar.textContent = this.puzzle ? String(this.puzzle.par) : '-';
    d.statLeft.textContent = String(this.board.pieceCount);
    d.statSeed.textContent = this.puzzle ? seedToCode(this.puzzle.seed) : '------';
    d.statModeLabel.textContent = this.mode === 'daily' ? 'DAILY' : 'SEED';

    const done = this.initialCells ? (this.initialCells - this.board.filledCells) / this.initialCells : 0;
    d.progressBar.style.width = `${Math.round(done * 100)}%`;

    d.btnUndo.disabled = this.history.length === 0 || this.busy;
    d.statMovesBox.classList.toggle('over', this.puzzle ? this.moves > this.puzzle.par : false);
    this.updateLegend();
  }

  // ------------------------------------------------------------ 結果表示

  recordResult() {
    if (!this.puzzle) return;
    const key = seedToCode(this.puzzle.seed);
    this.store.best = this.store.best || {};
    const prev = this.store.best[key];
    this.newRecord = prev == null || this.moves < prev;
    if (this.newRecord) this.store.best[key] = this.moves;
    this.store.cleared = (this.store.cleared || 0) + (prev == null ? 1 : 0);
    saveStore(this.store);
  }

  rankOf(moves, par) {
    if (moves <= par) return { label: 'PERFECT', badge: '👑', gold: true };
    if (moves <= par + 2) return { label: 'GREAT', badge: '🎉', gold: false };
    if (moves <= par + 5) return { label: 'GOOD', badge: '✨', gold: false };
    return { label: 'CLEAR', badge: '🎊', gold: false };
  }

  showWin() {
    const par = this.puzzle.par;
    const rank = this.rankOf(this.moves, par);
    const best = (this.store.best || {})[seedToCode(this.puzzle.seed)];
    this.showOverlay({
      badge: rank.badge,
      title: '全消し！',
      titleClass: rank.gold ? 'rank-gold' : '',
      text: this.moves <= par
        ? '保証解と同じかそれ以上。最初から最後まで読み切りました。'
        : 'おめでとう！ より短い手順が必ず存在します。',
      stats: [
        { k: 'あなた', n: this.moves },
        { k: 'PAR', n: par },
        { k: '自己ベスト', n: best != null ? best : this.moves },
        ...(this.hintsUsed > 0 ? [{ k: '使ったヒント', n: this.hintsUsed }] : []),
      ],
      actions: [
        { label: 'もう一度', onClick: () => this.restart() },
        { label: '新しい問題', primary: true, onClick: () => this.newPuzzle() },
      ],
      extra: rank.label + (this.newRecord ? '  ／ 自己ベスト更新!' : ''),
    });
  }

  showDead() {
    this.showOverlay({
      badge: '🧊',
      title: 'デッドロック',
      text: 'どのブロックをどう滑らせても、同色を接触させられません。運ではなく手順の帰結です ―― 戻して読み直しましょう。',
      stats: [
        { k: '手数', n: this.moves },
        { k: 'PAR', n: this.puzzle.par },
        { k: '残り', n: this.board.pieceCount },
      ],
      actions: [
        { label: '1手戻す', primary: true, onClick: () => this.undo() },
        { label: '最初から', onClick: () => this.restart() },
        { label: '新しい問題', onClick: () => this.newPuzzle() },
      ],
    });
  }

  showOverlay(cfg) {
    const d = this.dom;
    d.overlayBadge.textContent = cfg.badge || '';
    d.overlayTitle.textContent = cfg.title || '';
    d.overlayTitle.className = cfg.titleClass || '';
    d.overlayText.textContent = cfg.text || '';

    d.overlayStats.innerHTML = '';
    for (const s of cfg.stats || []) {
      const div = document.createElement('div');
      div.innerHTML = `<span class="n">${s.n}</span><span class="k">${s.k}</span>`;
      d.overlayStats.appendChild(div);
    }
    if (cfg.extra) {
      const p = document.createElement('div');
      p.style.cssText = 'flex-basis:100%;font-size:12px;letter-spacing:.12em;color:#ffd93d;font-weight:800;';
      p.textContent = cfg.extra;
      d.overlayStats.appendChild(p);
    }

    d.overlayActions.innerHTML = '';
    for (const a of cfg.actions || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctl' + (a.primary ? ' ctl-primary' : '');
      btn.innerHTML = `<span class="ctl-label">${a.label}</span>`;
      btn.addEventListener('click', a.onClick);
      d.overlayActions.appendChild(btn);
    }
    d.overlay.hidden = false;
  }

  hideOverlay() {
    this.dom.overlay.hidden = true;
  }

  // ------------------------------------------------------------ ループ

  loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.anim) {
      this.anim.t += dt / this.anim.duration;
      if (this.anim.t >= 1) {
        const a = this.anim;
        this.anim = null;
        if (a.phase === 'slide') this.onSlideEnd(a);
        else this.afterMove();
        this.updateHud();
      }
    }

    if (this.invalid) {
      this.invalid.t += dt / 0.34;
      if (this.invalid.t >= 1) this.invalid = null;
    }

    this.renderer.draw({
      board: this.board,
      anim: this.anim,
      selected: this.selected,
      ghost: this.ghost,
      hint: this.hint,
      invalid: this.invalid,
    }, dt);

    requestAnimationFrame((t) => this.loop(t));
  }
}

export { PALETTE, DIRS };
