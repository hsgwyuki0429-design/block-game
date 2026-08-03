// ゲーム進行・アニメーション・UI 配線。
//
// 画面は3つ（ホーム / レベル一覧 / ゲーム）。同時に見えるのは常に1つだけ。
//
// レベルに鍵はかかっていない。どのレベルにもいつでも入れる ―― 1つ詰まったら
// 先へ行って戻ってくればいいし、いきなり上から始めてもいい。進行状況は
// 「到達レベル」と「レベルごとの星・自己ベスト」だけで表せる。
//
// 星は「解けるまでの時間」で決まる（手数ではない）。盤面を読むのに使った時間
// だけを数えたいので、時計は下の条件がすべて満たされている間だけ進む。

import { Board, BLOCKER } from './board.js';
import { DIRS } from './shapes.js';
import { generateLevelAsync } from './generator.js';
import {
  levelConfig, normalizeLevel, levelSummary, puzzleSummary,
  targetTimes, starsForTime, formatTime,
} from './levels.js';
import { Renderer, colorFor } from './render.js';
import { attachInput } from './input.js';
import { Sound } from './audio.js';

const STORE_KEY = 'slidepop.v4';
/** 手数で星を付けていた頃の記録。解放済みレベルだけ引き継ぐ */
const LEGACY_KEY = 'slidepop.v3';

/** レベル一覧の1ページに並べる数 */
const PAGE_SIZE = 30;

/**
 * ヒント1回ぶんの時間ペナルティ（秒）。
 * ヒントは「詰まったときの逃げ道」であって「速く解く手段」ではない、という線引き。
 */
const HINT_PENALTY = 20;

/** レベル一覧・ホームに出す、遊ぶ前のプレビュー文 */
export function levelPreview(level) {
  return levelSummary(levelConfig(level));
}

/**
 * 旧版（手数で星を付けていた頃）の記録を引き継ぐ。
 * 星とベスト記録は意味が変わってしまうので持ち込まず、
 * 「どこまで開いていたか」だけを残す ―― 進みが巻き戻るのがいちばん理不尽なので。
 */
function migrateLegacy(data) {
  // 鍵をかけていた頃の「解放済みレベル」は、いまは「到達レベル」の意味で使う
  if (data.reached == null && data.unlocked) data.reached = data.unlocked;
  if (data.reached != null) return data;
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
    if (old.unlocked) data.reached = old.unlocked;
    if (old.settings) data.settings = { ...old.settings, ...(data.settings || {}) };
  } catch { /* 読めなければ最初から */ }
  return data;
}

function loadStore() {
  try {
    return migrateLegacy(JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
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
    /** 盤面を読んでいた時間（秒）。星はこれで決まる */
    this.elapsed = 0;
    this.shownTime = -1;
    this.status = 'idle';
    this.level = 1;
    this.loadToken = 0;
    this.screen = 'home';
    /** レベル一覧のページ（0 始まり） */
    this.page = 0;
    /** Android/Chrome が渡してくるインストールの入口。iOS では常に null */
    this.installPrompt = null;

    this.anim = null;
    this.invalid = null;
    this.selected = null;
    this.ghost = null;
    this.hint = null;

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    /** 星のしきい値（秒）。レベルを読み込んだ時点で実際の手数から決まる */
    this.times = null;
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

  /**
   * 到達レベル ―― まだクリアしていない、いちばん手前のレベル。
   * 鍵ではない。どのレベルにもいつでも入れる。これは「つづきから」の行き先と、
   * レベル一覧でいまいる場所を示すためだけに使う。
   */
  get reachedLevel() {
    return Math.max(1, Math.floor(this.store.reached) || 1);
  }

  /** そのレベルで取った星（0 = 未クリア） */
  starsOf(level) {
    return (this.store.stars || {})[String(normalizeLevel(level))] || 0;
  }

  /** そのレベルの自己ベスト（秒）。未クリアなら null */
  bestTimeOf(level) {
    const t = (this.store.best || {})[String(normalizeLevel(level))];
    return typeof t === 'number' ? t : null;
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
      // 詰まった盤面ほど「当たり」を引くまで試行が要る（最大で数秒）。
      // 何回目を試しているかを出して、止まって見えないようにする
      puzzle = await generateLevelAsync(lv, {}, (ratio) => {
        if (token === this.loadToken) this.showLoading(lv, ratio);
      });
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
    this.elapsed = 0;
    this.combo = 0;
    this.times = targetTimes(puzzle.par, puzzle.colors);
    this.status = 'playing';

    this.store.lastLevel = lv;
    saveStore(this.store);

    // このレベルに登場する色（レジェンドはこれだけを並べる）
    this.activeColors = [...new Set([...this.board.pieces.values()]
      .filter((p) => p.color !== BLOCKER).map((p) => p.color))].sort((a, b) => a - b);
    if (this.dom.legend) this.dom.legend.innerHTML = '';

    this.buildSolutionMap();
    this.renderer.resize(this.board.size);
    this.hideOverlay();
    this.updateHud();
    location.hash = `#L${lv}`;
  }

  showLoading(level, ratio = 0) {
    const cfg = levelConfig(level);
    const tried = Math.round(ratio * cfg.attempts);
    this.showOverlay({
      badge: '🧩',
      title: `レベル ${level}`,
      text: `${cfg.size}×${cfg.size}・${cfg.colors}色 の盤面を組み立てています…`
        + (tried > 0 ? `（${tried} 通り目）` : ''),
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
    // 時計も 0 に戻す。同じ盤面をもう一度、読み切ったつもりで解き直せる
    this.elapsed = 0;
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

  // ------------------------------------------------------------ 時計

  /**
   * 時計が進む条件。
   * ゲーム画面を見ていて、まだ解けていなくて、ルールや設定のシートで
   * 手が止まっていないとき ―― つまり「盤面を読んでいる間」だけ数える。
   */
  get timing() {
    if (this.status !== 'playing' || this.screen !== 'game') return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return !this.anyModalOpen();
  }

  /** 星の判定に使う時間。ヒントを使ったぶんだけ足す */
  get ratedTime() {
    return this.elapsed + this.hintsUsed * HINT_PENALTY;
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
    if (this.board.isCleared) {
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

  /**
   * ヒント。
   * 出せるのは「最短手順の上にいる間」だけ。
   *
   * 最短手順は1本しか持っていないので、そこから外れた盤面については
   * 次の1手を答えようがない（その場で全探索し直すには重すぎる ―― 上のレベルは
   * 84手級で、これは事前に全状態を展開して初めて出せた数字）。
   * 適当な手でお茶を濁すくらいなら、外れたことをはっきり伝えて
   * **やり直すかどうかを訊く**。
   */
  showHint() {
    if (!this.canInteract()) return;
    const step = this.solutionMap.get(this.board.fingerprint());
    if (step) {
      this.useHint(step.pieceId, step.dir, step.kind === 'clear'
        ? `最短手順の第${this.moves + 1}手：この色のペアが消えます`
        : `最短手順の第${this.moves + 1}手：これ自体は何も消えません（後につながる手）`);
      return;
    }
    this.askRestart();
  }

  useHint(pieceId, dir, message) {
    this.hint = { pieceId, dir };
    this.hintsUsed++;
    this.toast(`${message}（+${HINT_PENALTY}秒）`);
    this.updateHud();
  }

  /**
   * 最短手順から外れているとき、やり直すかを訊く。
   * ここでは時間を足さない ―― 訊かれただけで罰を受けるのは筋が通らない。
   */
  askRestart() {
    this.showOverlay({
      badge: '🧭',
      title: '最短手順から外れています',
      text: `ヒントを出せるのは、記録してある最短手順（${this.puzzle.par}手）をたどっている間だけです。`
        + `いまはそこから外れているので、次の1手をお答えできません。`
        + `最初からやり直すと、第1手からヒントを出せます。`,
      stats: [],
      actions: [
        { label: '最初からやり直す', primary: true, onClick: () => this.restart() },
        { label: 'このまま続ける', onClick: () => this.hideOverlay() },
      ],
    });
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
    d.btnInstall.addEventListener('click', () => this.install());
    this.bindInstall();

    // レベル一覧
    d.btnLevelsBack.addEventListener('click', () => this.showHome());
    d.btnLevelsJump.addEventListener('click', () => this.showLevels(this.pageOf(this.reachedLevel)));
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

    for (const modal of [d.modalRules, d.modalSettings, d.modalInstall]) {
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

  // ------------------------------------------------------------ ホーム画面に追加

  /**
   * すでにホーム画面から起動しているか。
   * Android/Chrome は display-mode、iOS Safari は navigator.standalone で分かる。
   */
  get installed() {
    if (typeof navigator !== 'undefined' && navigator.standalone) return true;
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  /** iOS（iPadOS も含む）。ここだけはインストールの API が無く、手順を案内するしかない */
  get isIos() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13 以降は Mac を名乗る。タッチできる Mac は実質 iPad
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  bindInstall() {
    // Chrome 系は「入れられる」と分かった時点で合図をくれる。既定の
    // バナーは出さずに預かっておき、ホーム画面のボタンから使う
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      this.updateInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.updateInstallButton();
      this.toast('ホーム画面に追加しました');
    });
    this.updateInstallButton();
  }

  /**
   * ボタンを出すのは「まだ追加しておらず、追加する手段がある」ときだけ。
   * 追加済みの端末に出しても押せないボタンが増えるだけなので隠す。
   */
  updateInstallButton() {
    const btn = this.dom.btnInstall;
    if (!btn) return;
    btn.hidden = this.installed || !(this.installPrompt || this.isIos);
  }

  async install() {
    // iOS には API が無いので、共有シートからの手順を見せる
    if (!this.installPrompt) {
      if (this.isIos) this.openModal(this.dom.modalInstall);
      else this.toast('お使いのブラウザのメニューから「ホーム画面に追加」を選んでください');
      return;
    }
    const prompt = this.installPrompt;
    this.installPrompt = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { /* 閉じられただけ。何もしない */ }
    this.updateInstallButton();
  }

  // ------------------------------------------------------------ 画面の切り替え

  /** 「ゲームスタート」が始めるレベル。まだ挑戦中のものがあればそれを続ける */
  get startLevel() {
    const last = normalizeLevel(this.store.lastLevel || 1);
    return this.starsOf(last) === 0 ? last : this.reachedLevel;
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

    this.updateInstallButton();

    d.homeProgress.innerHTML = '';
    const chips = [
      ['クリア', this.clearedCount],
      ['星', this.totalStars],
      ['到達レベル', this.reachedLevel],
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
      const stars = this.starsOf(lv);
      const best = this.bestTimeOf(lv);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'level-cell';
      if (lv === this.reachedLevel) cell.classList.add('current');
      else if (stars > 0) cell.classList.add('done');

      cell.dataset.level = String(lv);
      cell.innerHTML = `<span class="n">${lv}</span>`
        + `<span class="stars${stars ? '' : ' none'}">${'★'.repeat(stars) || '☆☆☆'}</span>`
        + (best != null ? `<span class="cell-time">${formatTime(best)}</span>` : '');
      cell.title = best != null
        ? `レベル ${lv}：${levelPreview(lv)}／自己ベスト ${formatTime(best)}`
        : `レベル ${lv}：${levelPreview(lv)}`;
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
    const d = this.dom;
    return !d.modalRules.hidden || !d.modalSettings.hidden || !d.modalInstall.hidden;
  }

  closeModals() {
    this.dom.modalRules.hidden = true;
    this.dom.modalSettings.hidden = true;
    this.dom.modalInstall.hidden = true;
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

  /**
   * 時計の表示。毎フレーム呼ばれるので、秒が変わったときだけ DOM を触る。
   * ★★★ の持ち時間を過ぎたら色を変えて、いま星いくつぶんの位置にいるかを伝える。
   */
  updateTimer() {
    const d = this.dom;
    const t = Math.floor(this.ratedTime);
    if (t === this.shownTime) return;
    this.shownTime = t;
    d.statTime.textContent = formatTime(t);
    const times = this.times;
    d.hudTime.classList.toggle('warm', !!times && t > times.gold && t <= times.silver);
    d.hudTime.classList.toggle('late', !!times && t > times.silver);
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statLeft.textContent = String(this.board.coloredCount);
    d.statLevel.textContent = String(this.level);
    d.levelInfo.textContent = this.puzzle ? puzzleSummary(this.puzzle) : '\u00a0';

    d.btnUndo.disabled = this.history.length === 0 || this.busy;
    if (this.moves !== this.shownMoves) {
      this.shownMoves = this.moves;
      d.hudMoves.classList.remove('bump');
      void d.hudMoves.offsetWidth; // アニメーションを確実に再生させる
      d.hudMoves.classList.add('bump');
    }
    this.shownTime = -1; // 表示を作り直す（レベルを跨いだ直後など）
    this.updateTimer();
    this.updateLegend();
  }

  // ------------------------------------------------------------ 結果表示

  /**
   * クリアを記録する。星は「解けるまでの時間」で決まり、最高記録だけが残る。
   * ベストも手数ではなく秒で持つ―― 2周目で「読み切ってから指す」楽しみが残る。
   */
  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    const seconds = Math.max(1, Math.round(this.ratedTime));
    const stars = starsForTime(seconds, this.times);

    this.store.best = this.store.best || {};
    this.store.stars = this.store.stars || {};
    const prevBest = this.bestTimeOf(this.level);
    const prevStars = this.store.stars[key] || 0;

    this.newRecord = prevBest == null || seconds < prevBest;
    if (this.newRecord) this.store.best[key] = seconds;
    this.store.stars[key] = Math.max(prevStars, stars);

    // 到達レベルを進める（鍵ではない。「つづきから」の行き先になるだけ）
    this.store.reached = Math.max(this.reachedLevel, this.level + 1);
    saveStore(this.store);

    this.clearTime = seconds;
    this.lastStars = stars;
    this.newStars = stars > prevStars;
  }

  showWin() {
    const stars = this.lastStars;
    const seconds = this.clearTime;
    const best = this.bestTimeOf(this.level);
    const next = levelConfig(this.level + 1);
    const badges = { 3: '👑', 2: '🎉', 1: '🎊' };

    let text = stars === 3
      ? `${formatTime(this.times.gold)} 以内で読み切りました。最高の読みです。`
      : `おめでとう！ ★★★ は ${formatTime(this.times.gold)} 以内、★★ は ${formatTime(this.times.silver)} 以内です。`;
    if (next.size > this.puzzle.size) text += ` 次は盤面が ${next.size}×${next.size} に広がります。`;
    else if (next.colors > this.puzzle.colors) text += ` 次は色が ${next.colors} 色に増えます。`;
    else if (next.chainDepth > this.puzzle.config.chainDepth) text += ' 次は追い込みがさらに深くなります。';
    else if (next.setupMoves > this.puzzle.config.setupMoves) text += ' 次は仕込み手が増えます。';
    if (this.hintsUsed > 0) text += ` ヒント ${this.hintsUsed} 回ぶん +${this.hintsUsed * HINT_PENALTY}秒 を含みます。`;

    this.showOverlay({
      badge: badges[stars] || '🎊',
      title: `レベル ${this.level} クリア！`,
      titleClass: stars === 3 ? 'gold' : '',
      stars,
      text,
      stats: [
        { k: 'タイム', n: formatTime(seconds) },
        { k: 'ベスト', n: formatTime(best != null ? best : seconds) },
        { k: '手数', n: `${this.moves}/${this.puzzle.par}` },
        ...(this.hintsUsed > 0 ? [{ k: 'ヒント', n: this.hintsUsed }] : []),
      ],
      actions: [
        { label: `レベル ${this.level + 1} へ`, primary: true, onClick: () => this.nextLevel() },
        { label: 'もう一度あそぶ', onClick: () => this.restart() },
        { label: 'レベル一覧', onClick: () => this.showLevels() },
      ],
      extra: this.newRecord ? '自己ベスト更新!' : (this.newStars ? '星が増えました!' : ''),
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

    // 盤面を読んでいる間だけ時計を進める（星はこの時間で決まる）
    if (this.timing) {
      this.elapsed += dt;
      this.updateTimer();
    }

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
