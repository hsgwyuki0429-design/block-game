// ゲーム進行・アニメーション・UI 配線。

import { Board } from './board.js';
import { DIRS } from './shapes.js';
import { generateLevelAsync } from './generator.js';
import { levelConfig, normalizeLevel, levelFlavor } from './levels.js';
import { Renderer, PALETTE } from './render.js';
import { attachInput } from './input.js';
import { Sound } from './audio.js';

/**
 * 大量消去の段階評価（セル数）。
 * 色はライト／ダークどちらの背景でも読めるよう中間の明度に寄せてある
 * （縁取りは背景と反対色を敷くので、これで両方に耐える）。
 */
const TIERS = [
  { cells: 20, label: 'ミラクル!!!', color: '#e0388f' },
  { cells: 16, label: 'ファンタスティック!!', color: '#e08a00' },
  { cells: 12, label: 'グレイト!', color: '#0f9d63' },
];

const STORE_KEY = 'slidepop.v2';

function tierOf(cells) {
  for (const t of TIERS) if (cells >= t.cells) return t;
  return null;
}

/** 盤面に実際に置かれているブロックの構成を一言で */
function pieceKindLabel(board) {
  const sizes = new Set();
  for (const p of board.pieces.values()) sizes.add(p.cells.length);
  const label = (n) => (n <= 4 ? 'テトロミノ' : n <= 8 ? '2個つなぎ' : '3個つなぎ');
  const names = [...sizes].sort((a, b) => a - b).map(label);
  return [...new Set(names)].join('＋');
}

/** レベル選択画面に出す、遊ぶ前のプレビュー文 */
export function levelPreview(level) {
  const cfg = levelConfig(level);
  const mix = cfg.mix;
  const parts = [];
  if (mix.single > 0.001) parts.push(`テトロミノ ${Math.round(mix.single * 100)}%`);
  if (mix.double > 0.001) parts.push(`2個つなぎ ${Math.round(mix.double * 100)}%`);
  if (mix.triple > 0.001) parts.push(`3個つなぎ ${Math.round(mix.triple * 100)}%`);
  return `${cfg.size}×${cfg.size} ／ ${cfg.colors}色 ／ ${parts.join(' ・ ')}`;
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
      { sound: true, haptics: true, symbols: false, ghost: true, calm: false },
      this.store.settings || {},
    );
    this.sound = new Sound();

    this.puzzle = null;
    this.solutionMap = new Map();
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.status = 'loading';
    this.level = 1;
    this.loadToken = 0;

    this.anim = null;
    this.invalid = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    this.newRecord = false;
    this.initialCells = 0;
    this.activeColors = [];
    /** 連続で消せた回数。増えるほど消去音の音程が上がる */
    this.combo = 0;

    this.applySettings();
    this.bindUi();
    this.bindInput();

    const ro = new ResizeObserver(() => this.renderer.resize(this.board.size));
    ro.observe(dom.canvas);
    window.addEventListener('resize', () => this.renderer.resize(this.board.size));

    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ パズル

  /**
   * レベルを読み込む。
   * 大きな連結ピースの盤面は生成に少し時間がかかるので、非同期版を使って
   * 「生成中」を出しながら待つ（画面が固まらない）。
   */
  async load(level) {
    const lv = normalizeLevel(level);
    const token = ++this.loadToken;

    this.status = 'loading';
    this.anim = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;
    this.renderer.clearEffects();
    this.showLoading(lv);
    this.updateHud();
    // 生成を始める前に 1 フレーム譲り、「組み立て中」を確実に描かせる
    await new Promise((r) => requestAnimationFrame(r));
    if (token !== this.loadToken) return;

    let puzzle;
    try {
      puzzle = await generateLevelAsync(lv);
    } catch (err) {
      console.error(err);
      if (token !== this.loadToken) return;
      this.status = 'playing';
      this.hideOverlay();
      this.toast('レベルの生成に失敗しました。もう一度お試しください。');
      return;
    }
    if (token !== this.loadToken) return; // 待っている間に別のレベルが選ばれた

    this.level = lv;
    this.puzzle = puzzle;
    this.board = new Board(puzzle.size);
    this.board.restore(puzzle.snapshot);
    this.initialCells = puzzle.cells;
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.combo = 0;
    this.status = 'playing';

    this.store.lastLevel = lv;
    saveStore(this.store);

    // このレベルに登場する色（レジェンドはこれだけを並べる）
    this.activeColors = [...new Set([...this.board.pieces.values()].map((p) => p.color))]
      .sort((a, b) => a - b);
    if (this.dom.legend) this.dom.legend.innerHTML = '';

    this.buildSolutionMap();
    this.renderer.resize(this.board.size);
    this.hideOverlay();
    this.updateHud();
    location.hash = `#L${lv}`;
  }

  /** 到達したことのある最大レベル（未クリアでも「開いたことがある」で更新） */
  get bestLevel() {
    return Math.max(1, this.store.bestLevel || 1);
  }

  showLoading(level) {
    const cfg = levelConfig(level);
    this.showOverlay({
      badge: '🧊',
      title: `レベル ${level}`,
      text: `${cfg.size}×${cfg.size} の盤面を組み立てています…`,
      stats: [],
      actions: [],
    });
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

  /** 次のレベルへ */
  nextLevel() {
    this.load(this.level + 1);
  }

  restart() {
    if (!this.puzzle || this.status === 'loading') return;
    this.renderer.clearEffects();
    this.board.restore(this.puzzle.snapshot);
    this.history = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.combo = 0;
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
      this.sound.invalid();
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
    this.sound.land(a.steps);
    const group = this.board.colorGroup(a.pieceId);

    if (group.length < 2) {
      // 何も消えない手。連鎖は途切れ、着地の沈み込みだけ見せる
      this.combo = 0;
      this.anim = { phase: 'land', pieceId: a.pieceId, dir: a.dir, steps: a.steps, t: 0, duration: 0.17 };
      return;
    }

    // 大きい消去の直前だけ一瞬止める。「タメ」があると解放が強く感じられる
    if (group.length >= 3 && !this.settings.calm) {
      this.anim = { phase: 'hold', pieceId: a.pieceId, dir: a.dir, steps: a.steps, t: 0, duration: 0.1, group };
      return;
    }
    this.doClear(group);
  }

  /** 消去の演出と実行 */
  doClear(group) {
    const pieces = group.map((id) => this.board.pieces.get(id)).filter(Boolean);
    if (pieces.length < 2) { this.anim = null; this.afterMove(); return; }

    this.combo++;

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
    this.renderer.ring(center.x, center.y, color, pieces.length);
    this.renderer.flash(center.x, center.y, pieces.length / 2);
    this.renderer.addShake(2.5 + cells * 0.5);
    this.sound.pop(this.combo - 1, pieces.length);

    const tier = tierOf(cells);
    let sub = tier ? tier.label : null;
    if (this.combo >= 2) sub = sub ? `${sub}  ${this.combo}コンボ` : `${this.combo}コンボ!`;
    // 段階評価が無いときは、消えた粘土の色そのままで祝う
    const textColor = tier ? tier.color : PALETTE[color].dark;
    this.renderer.floatText(center.x, center.y, `${cells}個消し！`, sub, textColor);

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
      this.sound.win();
      setTimeout(() => this.showWin(), 640);
      return;
    }
    if (this.board.isDeadlock()) {
      this.status = 'dead';
      this.sound.dead();
      setTimeout(() => this.showDead(), 380);
    }
  }

  undo() {
    if (this.busy || this.history.length === 0) return;
    const h = this.history.pop();
    this.board.restore(h.snap);
    this.moves = h.moves;
    this.status = 'playing';
    this.combo = 0;
    this.sound.undo();
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
        this.sound.unlock();
        this.selected = id;
        this.ghost = null;
        if (id != null) {
          this.hint = null;
          this.sound.tap();
        }
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
      else if (k === 'l') { e.preventDefault(); this.openLevelPicker(); }
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
    d.btnLevels.addEventListener('click', () => this.openLevelPicker());
    d.btnRules.addEventListener('click', () => this.openModal(d.modalRules));
    d.btnSettings.addEventListener('click', () => this.openModal(d.modalSettings));

    for (const modal of [d.modalRules, d.modalSettings, d.modalLevels]) {
      modal.addEventListener('click', (e) => {
        // 閉じるボタンの中身（SVG）が押されることもあるので closest で辿る
        if (e.target === modal || (e.target.closest && e.target.closest('[data-close]'))) {
          this.closeModals();
        }
      });
    }

    const toggles = {
      sound: d.optSound,
      haptics: d.optHaptics,
      symbols: d.optSymbols,
      ghost: d.optGhost,
      calm: d.optCalm,
    };
    for (const [key, el] of Object.entries(toggles)) {
      if (!el) continue;
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => {
        this.settings[key] = el.checked;
        this.applySettings();
        this.store.settings = this.settings;
        saveStore(this.store);
        if (key === 'sound' && el.checked) { this.sound.unlock(); this.sound.tap(); }
      });
    }

    const stepLevel = (delta) => {
      const v = Math.max(1, (parseInt(d.levelInput.value, 10) || 1) + delta);
      d.levelInput.value = String(v);
      this.updateLevelPreview();
    };
    d.btnLevelPrev.addEventListener('click', () => stepLevel(-1));
    d.btnLevelNext.addEventListener('click', () => stepLevel(1));
    d.levelInput.addEventListener('input', () => this.updateLevelPreview());
    d.levelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') d.btnLevelGo.click();
    });
    d.btnLevelGo.addEventListener('click', () => {
      const lv = Math.max(1, parseInt(d.levelInput.value, 10) || 1);
      this.closeModals();
      this.load(lv);
    });
    d.btnLevelBest.addEventListener('click', () => {
      d.levelInput.value = String(this.bestLevel);
      this.updateLevelPreview();
      this.closeModals();
      this.load(this.bestLevel);
    });
    d.btnShare.addEventListener('click', () => this.share());
  }

  openLevelPicker() {
    this.dom.levelInput.value = String(this.level);
    this.updateLevelPreview();
    this.dom.btnLevelBest.disabled = this.bestLevel === this.level;
    this.openModal(this.dom.modalLevels);
  }

  updateLevelPreview() {
    const lv = Math.max(1, parseInt(this.dom.levelInput.value, 10) || 1);
    this.dom.levelPreview.textContent = levelPreview(lv);
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
    this.sound.enabled = this.settings.sound;
    this.sound.haptics = this.settings.haptics;
  }

  openModal(el) {
    el.hidden = false;
  }

  closeModals() {
    this.dom.modalRules.hidden = true;
    this.dom.modalSettings.hidden = true;
    this.dom.modalLevels.hidden = true;
  }

  async share() {
    const url = `${location.origin}${location.pathname}#L${this.level}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('リンクをコピーしました');
    } catch {
      this.toast(`レベル ${this.level}：${url}`);
    }
  }

  toast(msg) {
    const el = this.dom.toast;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /**
   * 色ごとの残りブロック数。
   * そのレベルに実際に出てくる色だけを並べ、1個だけ残っている色
   * （＝相棒がいないので単独では消せない）は白く縁取って警告する。
   */
  updateLegend() {
    const d = this.dom;
    if (!d.legend) return;
    const counts = new Array(PALETTE.length).fill(0);
    for (const p of this.board.pieces.values()) counts[p.color]++;

    const colors = this.activeColors || [];
    if (d.legend.childElementCount !== colors.length) {
      d.legend.innerHTML = '';
      for (const i of colors) {
        const chip = document.createElement('div');
        chip.className = 'legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${PALETTE[i].base}"></span><span class="legend-n">0</span>`;
        chip.title = `${PALETTE[i].name}の残りブロック数`;
        d.legend.appendChild(chip);
      }
      d.legend.style.gridTemplateColumns = `repeat(${Math.max(1, colors.length)}, 1fr)`;
    }
    colors.forEach((color, i) => {
      const chip = d.legend.children[i];
      if (!chip) return;
      chip.querySelector('.legend-n').textContent = String(counts[color]);
      chip.classList.toggle('empty', counts[color] === 0);
      chip.classList.toggle('lone', counts[color] === 1);
    });
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statPar.textContent = this.puzzle ? String(this.puzzle.par) : '-';
    d.statLeft.textContent = String(this.board.pieceCount);
    d.statLevel.textContent = String(this.level);
    if (this.puzzle) {
      // 盤面を空にしたあとは実物から読めないので、レベルの想定構成を出す
      const kinds = pieceKindLabel(this.board) || levelFlavor(this.puzzle.config);
      d.levelInfo.textContent = `${this.puzzle.size}×${this.puzzle.size} ／ ${kinds} ／ ${this.puzzle.colors}色`;
    } else {
      d.levelInfo.textContent = '\u00a0';
    }

    const done = this.initialCells ? (this.initialCells - this.board.filledCells) / this.initialCells : 0;
    d.progressBar.style.width = `${Math.round(done * 100)}%`;

    d.btnUndo.disabled = this.history.length === 0 || this.busy;
    d.hudMoves.classList.toggle('over', this.puzzle ? this.moves > this.puzzle.par : false);
    if (this.moves !== this.shownMoves) {
      this.shownMoves = this.moves;
      d.hudMoves.classList.remove('bump');
      void d.hudMoves.offsetWidth; // アニメーションを確実に再生させる
      d.hudMoves.classList.add('bump');
    }
    this.updateLegend();
  }

  // ------------------------------------------------------------ 結果表示

  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    this.store.best = this.store.best || {};
    const prev = this.store.best[key];
    this.newRecord = prev == null || this.moves < prev;
    if (this.newRecord) this.store.best[key] = this.moves;
    this.store.cleared = (this.store.cleared || 0) + (prev == null ? 1 : 0);
    // クリアしたら次のレベルが解放される
    this.store.bestLevel = Math.max(this.store.bestLevel || 1, this.level + 1);
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
    const best = (this.store.best || {})[String(this.level)];
    const next = levelConfig(this.level + 1);
    const grew = next.size > this.puzzle.size;
    const harder = next.mix.triple > this.puzzle.config.mix.triple + 0.001
      || next.mix.double > this.puzzle.config.mix.double + 0.001;

    let text = this.moves <= par
      ? '保証解と同じかそれ以上。最初から最後まで読み切りました。'
      : 'おめでとう！ より短い手順が必ず存在します。';
    if (grew) text += ` 次は盤面が ${next.size}×${next.size} に広がります。`;
    else if (harder) text += ' 次はブロックがもう少し複雑になります。';

    this.showOverlay({
      badge: rank.badge,
      title: `レベル ${this.level} クリア！`,
      titleClass: rank.gold ? 'gold' : '',
      text,
      stats: [
        { k: 'あなた', n: this.moves },
        { k: 'PAR', n: par },
        { k: '自己ベスト', n: best != null ? best : this.moves },
        ...(this.hintsUsed > 0 ? [{ k: '使ったヒント', n: this.hintsUsed }] : []),
      ],
      actions: [
        { label: `レベル ${this.level + 1} へ`, primary: true, onClick: () => this.nextLevel() },
        { label: 'もう一度あそぶ', onClick: () => this.restart() },
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
        { label: 'レベル選択', onClick: () => { this.hideOverlay(); this.openLevelPicker(); } },
      ],
    });
  }

  showOverlay(cfg) {
    const d = this.dom;
    d.overlayBadge.textContent = cfg.badge || '';
    d.overlayTitle.textContent = cfg.title || '';
    d.overlayTitle.className = cfg.titleClass || '';
    d.overlayText.textContent = cfg.text || '';

    d.overlayExtra.textContent = cfg.extra || '';

    d.overlayStats.innerHTML = '';
    for (const s of cfg.stats || []) {
      const div = document.createElement('div');
      div.innerHTML = `<span class="n">${s.n}</span><span class="k">${s.k}</span>`;
      d.overlayStats.appendChild(div);
    }

    d.overlayActions.innerHTML = '';
    for (const a of cfg.actions || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-plain');
      btn.textContent = a.label;
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
        else if (a.phase === 'hold') this.doClear(a.group);
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
