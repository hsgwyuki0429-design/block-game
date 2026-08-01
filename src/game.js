// ゲーム進行・アニメーション・UI 配線。
//
// 画面は3つ（ホーム / レベル一覧 / ゲーム）。同時に見えるのは常に1つだけ。
// レベルは「ひとつ前をクリアするまで開かない」ので、進行状況は
// 「解放済みレベル」と「レベルごとの星」だけで表せる。

import { Board } from './board.js';
import { DIRS } from './shapes.js';
import { generateLevelAsync } from './generator.js';
import { levelConfig, normalizeLevel, levelSummary } from './levels.js';
import { Renderer, colorFor } from './render.js';
import { attachInput } from './input.js';
import { Sound } from './audio.js';

const STORE_KEY = 'slidepop.v3';

/** レベル一覧の1ページに並べる数 */
const PAGE_SIZE = 30;

/**
 * 手数の星評価。
 *   ★★★ PAR 以内（保証解と同じかそれ以上）
 *   ★★  PAR+2 以内
 *   ★   クリア
 */
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + 2) return 2;
  return 1;
}

/** レベル一覧・ホームに出す、遊ぶ前のプレビュー文 */
export function levelPreview(level) {
  return levelSummary(levelConfig(level));
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
    this.status = 'idle';
    this.level = 1;
    this.loadToken = 0;
    this.screen = 'home';
    /** レベル一覧のページ（0 始まり） */
    this.page = 0;

    this.anim = null;
    this.invalid = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    this.newRecord = false;
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

  // ------------------------------------------------------------ 進行状況

  /** 遊べる最大レベル。ひとつ前をクリアすると 1 つ増える */
  get unlockedLevel() {
    return Math.max(1, Math.floor(this.store.unlocked) || 1);
  }

  /** そのレベルが開いているか */
  isUnlocked(level) {
    return normalizeLevel(level) <= this.unlockedLevel;
  }

  /** そのレベルで取った星（0 = 未クリア） */
  starsOf(level) {
    return (this.store.stars || {})[String(normalizeLevel(level))] || 0;
  }

  /** 星の総数 */
  get totalStars() {
    return Object.values(this.store.stars || {}).reduce((a, b) => a + b, 0);
  }

  /** クリア済みレベル数 */
  get clearedCount() {
    return Object.keys(this.store.stars || {}).length;
  }

  // ------------------------------------------------------------ パズル

  /**
   * レベルを読み込む。
   * 上のレベルほど生成に時間がかかるので、非同期版を使って
   * 「生成中」を出しながら待つ（画面が固まらない）。
   */
  async load(level) {
    const lv = normalizeLevel(level);
    if (!this.isUnlocked(lv)) {
      this.showLevels(Math.floor((this.unlockedLevel - 1) / PAGE_SIZE));
      this.toast(`レベル ${lv - 1} をクリアすると開きます`);
      return;
    }
    const token = ++this.loadToken;
    this.showGame();

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

  showLoading(level) {
    const cfg = levelConfig(level);
    this.showOverlay({
      badge: '🧩',
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

  /**
   * 消去の演出と実行。
   * 祝うのは光と音だけ ―― 画面に文字は出さない。連鎖の深さは
   * 音程の階段と、光の強さ・画面の揺れで伝える。
   */
  doClear(group) {
    const pieces = group.map((id) => this.board.pieces.get(id)).filter(Boolean);
    if (pieces.length < 2) { this.anim = null; this.afterMove(); return; }

    this.combo++;
    // 連鎖が深いほど強く光る（頭打ちは付ける。眩しすぎると読めなくなる）
    const heat = Math.min(2.2, 1 + (this.combo - 1) * 0.28);

    let cells = 0;
    let sx = 0;
    let sy = 0;
    for (const p of pieces) {
      this.renderer.shatter(p.cells, p.color);
      this.renderer.burst(p.cells, p.color, heat);
      for (const [x, y] of p.cells) {
        sx += x + 0.5;
        sy += y + 0.5;
        cells++;
      }
    }
    const center = this.renderer.cellCenter(sx / cells - 0.5, sy / cells - 0.5);
    const color = pieces[0].color;
    this.renderer.ring(center.x, center.y, color, heat);
    this.renderer.flash(center.x, center.y, heat);
    this.renderer.addShake(3 + cells * 0.4 * heat);
    this.sound.pop(this.combo - 1, pieces.length);

    for (const id of group) this.board.removePiece(id);
    this.selected = null;
    this.anim = null;
    this.afterMove();
  }

  /**
   * 手番の後始末。
   * 「消せる手が無い」ことを敗北にはしない ―― 詰みかけて見える局面でも、
   * 何も消さない手で通路を作れば必ず解ける（PAR は保証された手数）。
   * 行き詰まったら「戻す」と「やり直す」がいつでも使える。
   */
  afterMove() {
    this.updateHud();
    if (this.board.isEmpty) {
      this.status = 'won';
      this.recordResult();
      this.sound.win();
      setTimeout(() => this.showWin(), 640);
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
      this.toast(step.kind === 'setup'
        ? `保証解の第${this.moves + 1}手：これ自体は何も消えません（後の手のための仕込み）`
        : `保証解の第${this.moves + 1}手：この色のペアが消えます`);
      this.updateHud();
      return;
    }
    const moves = this.board.findClearingMoves();
    if (moves.length > 0) {
      const best = moves[0];
      this.hint = { pieceId: best.id, dir: best.dir };
      this.hintsUsed++;
      this.toast(`${best.clearedCells}マスぶん消せる手があります`);
      this.updateHud();
      return;
    }
    this.toast('いま消せる手はありません。通路を作るか、「戻す」で組み立て直しましょう');
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
      else if (k === 'l') { e.preventDefault(); this.showLevels(); }
      else if (k === 'escape') {
        this.selected = null;
        this.ghost = null;
        if (!this.anyModalOpen()) this.showHome();
        this.closeModals();
      }
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

    // 押せるものは全部、盤面と同じ乾いたウッドクリックで鳴る。
    // pointerdown で鳴らすと指の動きと音がずれない。ここが音の解錠地点でもある
    // （ホーム画面のボタンを押した時点で iOS の音が開く）。
    document.addEventListener('pointerdown', (e) => {
      const hit = e.target.closest && e.target.closest('button, .switch');
      if (!hit || hit.disabled) return;
      this.sound.unlock();
      this.sound.click();
    }, { passive: true });

    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnHint.addEventListener('click', () => this.showHint());
    d.btnRestart.addEventListener('click', () => this.restart());
    d.btnLevels.addEventListener('click', () => this.showLevels());
    d.btnHome.addEventListener('click', () => this.showHome());

    // ホーム
    d.btnStart.addEventListener('click', () => this.load(this.startLevel));
    d.btnOpenLevels.addEventListener('click', () => this.showLevels());

    // レベル一覧
    d.btnLevelsBack.addEventListener('click', () => this.showHome());
    d.btnLevelsJump.addEventListener('click', () => this.showLevels(this.pageOf(this.unlockedLevel)));
    d.btnPagePrev.addEventListener('click', () => this.showLevels(this.page - 1));
    d.btnPageNext.addEventListener('click', () => this.showLevels(this.page + 1));
    d.levelGrid.addEventListener('click', (e) => {
      const cell = e.target.closest && e.target.closest('[data-level]');
      if (!cell) return;
      this.load(parseInt(cell.dataset.level, 10));
    });

    for (const el of [d.btnRules, d.btnRules2]) {
      if (el) el.addEventListener('click', () => this.openModal(d.modalRules));
    }
    for (const el of [d.btnSettings, d.btnSettings2]) {
      if (el) el.addEventListener('click', () => this.openModal(d.modalSettings));
    }

    for (const modal of [d.modalRules, d.modalSettings]) {
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
        if (key === 'sound' && el.checked) { this.sound.unlock(); this.sound.click(); }
      });
    }

    d.btnShare.addEventListener('click', () => this.share());
  }

  // ------------------------------------------------------------ 画面の切り替え

  /** 「ゲームスタート」が始めるレベル。まだ挑戦中のものがあればそれを続ける */
  get startLevel() {
    const last = normalizeLevel(this.store.lastLevel || 1);
    return this.isUnlocked(last) && this.starsOf(last) === 0 ? last : this.unlockedLevel;
  }

  showScreen(name) {
    const d = this.dom;
    this.screen = name;
    d.screenHome.hidden = name !== 'home';
    d.screenLevels.hidden = name !== 'levels';
    d.screenGame.hidden = name !== 'game';
    // 隠れている間はキャンバスの実寸が 0 なので、見えてから測り直す
    if (name === 'game') requestAnimationFrame(() => this.renderer.resize(this.board.size));
  }

  showHome() {
    const d = this.dom;
    this.showScreen('home');
    // '#' が残らないように履歴ごと書き換える（対応していなければ諦める）
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch { /* file:// などでは無視 */ }

    const lv = this.startLevel;
    const continuing = this.starsOf(lv) === 0 && lv > 1 && lv === normalizeLevel(this.store.lastLevel);
    d.btnStartLabel.textContent = continuing ? 'つづきから' : 'ゲームスタート';
    d.btnStartSub.textContent = `レベル ${lv} ／ ${levelPreview(lv)}`;

    d.homeProgress.innerHTML = '';
    const chips = [
      ['クリア', this.clearedCount],
      ['星', this.totalStars],
      ['最高レベル', this.unlockedLevel],
    ];
    for (const [k, n] of chips) {
      const el = document.createElement('span');
      el.innerHTML = `${k}<b>${n}</b>`;
      d.homeProgress.appendChild(el);
    }
  }

  pageOf(level) {
    return Math.floor((normalizeLevel(level) - 1) / PAGE_SIZE);
  }

  /**
   * レベル一覧。無限に続くのでページ送りで見せる。
   * 開いていないレベルは押せず、クリア済みには取った星が残る。
   */
  showLevels(page = this.pageOf(this.level)) {
    const d = this.dom;
    this.page = Math.max(0, page);
    this.showScreen('levels');

    const from = this.page * PAGE_SIZE + 1;
    const to = from + PAGE_SIZE - 1;
    d.pageRange.textContent = `${from} – ${to}`;
    d.btnPagePrev.disabled = this.page === 0;
    d.levelsSubtitle.textContent = `${this.clearedCount} レベルクリア ／ 星 ${this.totalStars}`;

    d.levelGrid.innerHTML = '';
    for (let lv = from; lv <= to; lv++) {
      const unlocked = this.isUnlocked(lv);
      const stars = this.starsOf(lv);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'level-cell';
      if (!unlocked) cell.classList.add('locked');
      else if (lv === this.unlockedLevel) cell.classList.add('current');
      else if (stars > 0) cell.classList.add('done');

      if (unlocked) {
        cell.dataset.level = String(lv);
        cell.innerHTML = `<span class="n">${lv}</span>`
          + `<span class="stars${stars ? '' : ' none'}">${'★'.repeat(stars) || '☆☆☆'}</span>`;
        cell.title = `レベル ${lv}：${levelPreview(lv)}`;
      } else {
        cell.disabled = true;
        cell.setAttribute('aria-label', `レベル ${lv}（未開放）`);
        cell.innerHTML = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true">'
          + '<rect x="5" y="10.5" width="14" height="9.5" rx="2.6"/>'
          + '<path d="M8.4 10.5V7.9a3.6 3.6 0 0 1 7.2 0v2.6"/></svg>'
          + `<span class="stars none">${lv}</span>`;
      }
      d.levelGrid.appendChild(cell);
    }
  }

  showGame() {
    if (this.screen !== 'game') this.showScreen('game');
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
    this.sound.enabled = this.settings.sound;
    this.sound.haptics = this.settings.haptics;
  }

  openModal(el) {
    el.hidden = false;
  }

  anyModalOpen() {
    return !this.dom.modalRules.hidden || !this.dom.modalSettings.hidden;
  }

  closeModals() {
    this.dom.modalRules.hidden = true;
    this.dom.modalSettings.hidden = true;
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
    const counts = new Map();
    for (const p of this.board.pieces.values()) counts.set(p.color, (counts.get(p.color) || 0) + 1);

    const colors = this.activeColors || [];
    if (d.legend.childElementCount !== colors.length) {
      d.legend.innerHTML = '';
      for (const i of colors) {
        const chip = document.createElement('div');
        chip.className = 'legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${colorFor(i).base}"></span><span class="legend-n">0</span>`;
        chip.title = `${colorFor(i).name}の残りブロック数`;
        d.legend.appendChild(chip);
      }
      // 色数はレベルによって変わる。1行6個までで、行が均等に埋まる列数にする
      const rows = Math.max(1, Math.ceil(colors.length / 6));
      const cols = Math.max(1, Math.ceil(colors.length / rows));
      d.legend.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      d.legend.style.maxWidth = `${cols * 76}px`;
    }
    colors.forEach((color, i) => {
      const chip = d.legend.children[i];
      if (!chip) return;
      const n = counts.get(color) || 0;
      chip.querySelector('.legend-n').textContent = String(n);
      chip.classList.toggle('empty', n === 0);
      chip.classList.toggle('lone', n === 1);
    });
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statPar.textContent = this.puzzle ? String(this.puzzle.par) : '-';
    d.statLeft.textContent = String(this.board.pieceCount);
    d.statLevel.textContent = String(this.level);
    d.levelInfo.textContent = this.puzzle ? levelSummary(this.puzzle.config) : '\u00a0';

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

  /** クリアを記録する。星は最高記録だけを残し、次のレベルが開く */
  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    const stars = starsFor(this.moves, this.puzzle.par);

    this.store.best = this.store.best || {};
    this.store.stars = this.store.stars || {};
    const prevBest = this.store.best[key];
    const prevStars = this.store.stars[key] || 0;

    this.newRecord = prevBest == null || this.moves < prevBest;
    if (this.newRecord) this.store.best[key] = this.moves;
    this.store.stars[key] = Math.max(prevStars, stars);

    // クリアしたら次のレベルが開く
    this.store.unlocked = Math.max(this.unlockedLevel, this.level + 1);
    saveStore(this.store);

    this.lastStars = stars;
    this.newStars = stars > prevStars;
  }

  showWin() {
    const par = this.puzzle.par;
    const stars = this.lastStars;
    const best = (this.store.best || {})[String(this.level)];
    const next = levelConfig(this.level + 1);
    const badges = { 3: '👑', 2: '🎉', 1: '🎊' };

    let text = stars === 3
      ? '保証解と同じかそれ以上。最初から最後まで読み切りました。'
      : `おめでとう！ ${par}手で解ける手順が必ず存在します。`;
    if (next.size > this.puzzle.size) text += ` 次は盤面が ${next.size}×${next.size} に広がります。`;
    else if (next.colors > this.puzzle.colors) text += ` 次は色が ${next.colors} 色に増えます。`;
    else if (next.setupMoves > this.puzzle.config.setupMoves) text += ' 次は仕込み手が増えます。';
    else if (next.forced && !this.puzzle.config.forced) text += ' 次から手順は実質一本道になります。';

    this.showOverlay({
      badge: badges[stars] || '🎊',
      title: `レベル ${this.level} クリア！`,
      titleClass: stars === 3 ? 'gold' : '',
      stars,
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
        { label: 'レベル一覧', onClick: () => this.showLevels() },
      ],
      extra: this.newStars ? '自己ベスト更新!' : '',
    });
  }

  showOverlay(cfg) {
    const d = this.dom;
    d.overlayBadge.textContent = cfg.badge || '';
    d.overlayTitle.textContent = cfg.title || '';
    d.overlayTitle.className = cfg.titleClass || '';
    d.overlayText.textContent = cfg.text || '';

    d.overlayStars.innerHTML = '';
    if (cfg.stars) {
      for (let i = 1; i <= 3; i++) {
        const s = document.createElement('i');
        s.textContent = '★';
        if (i > cfg.stars) s.className = 'off';
        d.overlayStars.appendChild(s);
      }
    }

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

export { colorFor, DIRS };
