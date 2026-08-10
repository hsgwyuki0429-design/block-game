// ゲーム進行・アニメーション・UI 配線。
//
// 画面は3つ（ホーム / レベル一覧 / ゲーム）。同時に見えるのは常に1つだけ。
//
// レベルに鍵はかかっていない。どのレベルにもいつでも入れる ―― 1つ詰まったら
// 先へ行って戻ってくればいいし、いきなり上から始めてもいい。進行状況は
// 「到達レベル」と「レベルごとの星・自己ベスト」だけで表せる。
//
// 星は「何手で解いたか」で決まる。基準の par は厳密な最短手数なので、
// ★★★ は「最短で解いた」という、あいまいさのない達成になる。

import { Board, BLOCKER } from './board.js';
import { compile, positionsOf, Explorer } from './exact.js';
import { DIRS } from './shapes.js';
import { generateLevelAsync } from './generator.js';
import {
  levelConfig, normalizeLevel, levelSummary, puzzleSummary,
  targetMoves, starsForMoves, formatTime,
} from './levels.js';
import { Renderer, colorFor } from './render.js';
import { materialList, materialFor, DEFAULT_MATERIAL } from './materials.js';
import { attachInput } from './input.js';
import { Sound } from './audio.js';
import {
  savedName, saveName, forgetName, sanitizeName, clearLocalRanking,
  isGlobalRanking, fetchRanking, submitScore, fetchStarRanking, submitStars, RANK_LIMIT,
} from './ranking.js';
import { attachSheetSwipe, resetSheet } from './sheet.js';

/**
 * 保存領域。
 * 星の意味が「解けるまでの時間」から「解いた手数」に変わったので、v4 の記録を
 * そのまま読むと数字の意味が食い違う。鍵を分けて、引き継ぐのは到達レベルと
 * 設定だけにしてある。
 */
const STORE_KEY = 'slidepop.v5';
/** 星を時間で付けていた頃（v4）と、手数で付けていた頃（v3）の記録 */
const LEGACY_KEYS = ['slidepop.v4', 'slidepop.v3'];
/** 初回にルールを開いたかどうか。「データを消す」はここも戻す */
export const RULES_KEY = 'slidepop.seenRules';

/** 設定の初期値。「データを消す」でここへ戻る */
const DEFAULT_SETTINGS = {
  sound: true, haptics: true, symbols: false, ghost: true, calm: false,
  /** ブロックのデザイン。見た目だけが変わり、盤面もルールも変わらない */
  material: DEFAULT_MATERIAL,
};

/** レベル一覧の1ページに並べる数 */
const PAGE_SIZE = 30;

/** レベル一覧・ホームに出す、遊ぶ前のプレビュー文 */
export function levelPreview(level) {
  return levelSummary(levelConfig(level));
}

/**
 * 前の版の記録を引き継ぐ。
 * 星とベスト記録は意味が変わってしまうので持ち込まず、「どこまで進んでいたか」と
 * 設定だけを残す ―― 進みが巻き戻るのがいちばん理不尽なので。
 */
function migrateLegacy(data) {
  // 鍵をかけていた頃の「解放済みレベル」は、いまは「到達レベル」の意味で使う
  if (data.reached == null && data.unlocked) data.reached = data.unlocked;
  if (data.reached != null) return data;
  for (const key of LEGACY_KEYS) {
    try {
      const old = JSON.parse(localStorage.getItem(key) || '{}');
      const reached = old.reached || old.unlocked;
      if (reached) data.reached = reached;
      if (old.settings) data.settings = { ...old.settings, ...(data.settings || {}) };
      if (data.reached != null) break;
    } catch { /* 読めなければ次へ */ }
  }
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
    this.settings = Object.assign({ ...DEFAULT_SETTINGS }, this.store.settings || {});
    this.sound = new Sound();

    this.puzzle = null;
    this.history = [];
    this.moves = 0;
    /** 解くのにかかった時間（秒）。星には使わない。記録として見せるだけ */
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

    this.lastFrame = performance.now();
    this.toastTimer = 0;
    /** 星のしきい値（手数）。レベルを読み込んだ時点で最短手数から決まる */
    this.targets = null;
    this.newRecord = false;
    /** 連続で消せた回数。増えるほど消去音の音程が上がる */
    this.combo = 0;

    /* --- 解へどれだけ近いか（色のグラデーションと「いいね」の判定に使う） --- */
    /**
     * 全探索の作業場。
     *
     * レベルを読み込むたびに「到達できる盤面すべての、ゴールまでの最短距離」を
     * 配り直す。以後はどの局面でも表を 1 回引くだけで**残り手数が厳密に分かる**。
     * 実測で状態数は 6千〜7万、配り終えるのに 15〜600ms ―― 読み込みの一度きりなら
     * 払える。表もキューも作り置きして使い回す（毎回確保すると 10MB が何度も動く）。
     */
    this.solver = null;
    /** いま距離を配ってある盤面の定義。null なら全探索はまだ／使えていない */
    this.solverCtx = null;
    /** 配っている最中の盤面の定義。遊びながら少しずつ進める */
    this.solvePending = null;
    /** 色つきブロックの id（探索へ渡すのに要る） */
    this.colorIds = null;
    /** いまの局面からゴールまでの残り手数（厳密）。分からなければ null */
    this.remaining = null;

    /** 手順どおりに指した各局面の指紋 -> 何手目か（全探索が使えないときの控え） */
    this.pathIndex = null;
    /** 初期盤面での色つき2個の隙間。ここからどれだけ詰まったかを測る */
    this.startGap = 0;
    /** これまでに届いた「いちばん先」。ここを更新したときだけ褒める */
    this.bestStep = 0;
    this.bestGap = Infinity;
    this.progress = 0;
    /** 背景の光にいま塗ってある進行度（毎フレーム塗り直さないための控え） */
    this.paintedProgress = -1;
    /** 直前に動かしたブロック。スタンプを貼る場所になる */
    this.lastMovedId = null;

    /* --- ランキング --- */
    /** 名前を決めきるまで閉じられないシート（クリア直後） */
    this.nameLocked = false;
    /** 投稿・取得の世代。レベルを跨いだ古い応答を捨てるために使う */
    this.rankToken = 0;
    this.rankViewToken = 0;
    /** いま見ているランキングの表（'stars' = 星の数 / 'level' = レベル別） */
    this.rankBoard = 'stars';
    /** レベル別の表で見ているレベル */
    this.rankLevel = 1;

    this.applySettings();
    this.bindUi();
    this.bindInput();
    // すでに星を持っている人を、星のランキングに載せる（名前があるときだけ）
    this.postStars();

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

  /** そのレベルの自己ベスト（手数）。未クリアなら null */
  bestMovesOf(level) {
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

  // ------------------------------------------------------------ 解への近さ
  //
  // 盤面の色も背景の光も、この「近さ」ひとつで決まる。数字は出さない ――
  // 残り手数を数字で出すと、盤面ではなく数字を見ながら遊ぶことになる。
  // 温度だけが変わっていくなら、視線を盤面から外さずに近さが伝わる。

  /**
   * この盤面の「全部の局面からゴールまでの最短距離」を配る。
   *
   * ここが効くのは、**遊んでいる最中に残り手数を厳密に言える**ようになること。
   * 焼いてある解答は最短手順の 1 本でしかないので、そこから外れた瞬間に
   * 「あと何手か」が分からなくなる。距離を全部の局面に配っておけば、
   * プレイヤーがどこへ迷い込んでも、そこからの残り手数がそのまま引ける ――
   * 別の最短手順に乗り換えただけの手を「間違い」と誤解することも無くなる。
   *
   * 状態数が多すぎて配りきれないときは false を返す（そのときは焼いてある
   * 手順との突き合わせに落ちる）。
   */
  beginDistances(puzzle) {
    this.solverCtx = null;
    this.solvePending = null;
    this.remaining = null;
    try {
      const board = new Board(puzzle.size);
      board.restore(puzzle.snapshot);
      this.colorIds = [...board.pieces.values()]
        .filter((p) => p.color !== BLOCKER).map((p) => p.id);
      const ctx = compile(board, this.colorIds);
      if (!this.solver) this.solver = new Explorer(140000);
      this.solver.begin(ctx);
      this.solvePending = ctx;
    } catch {
      // 盤面が大きすぎる・ブロックが多すぎるなど。控えの物差しに任せる
      this.solvePending = null;
    }
  }

  /**
   * 距離を配る続きを、フレームの余りだけ進める。
   *
   * 予算はアニメーション中だけ絞る。滑っている最中に大きく食うと、
   * いちばん見られている 0.3 秒がガタつく ―― 待っているのは色だけなので、
   * そこは譲ってよい。
   */
  advanceDistances() {
    if (!this.solvePending || !this.solver) return;
    const phase = this.solver.step(this.busy ? 2 : 7);
    if (phase === 'done') {
      this.solverCtx = this.solvePending;
      this.solvePending = null;
      // 配り終わった時点の局面で測り直す。ここまでは控えの物差しで動いていたので、
      // 色が少しだけ跳ぶことがある（表示側がなめらかに追いつく）
      this.updateProgress(null);
    } else if (phase === 'failed') {
      this.solvePending = null;
    }
  }

  /** いまの局面からゴールまでの残り手数（厳密）。分からなければ null */
  distanceToGoal() {
    if (!this.solverCtx || !this.solver) return null;
    if (this.board.isCleared) return 0;
    const pos = positionsOf(this.solverCtx, this.board, this.colorIds);
    if (!pos) return null;
    const d = this.solver.distanceOf(pos);
    return d === undefined ? null : d;
  }

  /**
   * 手順どおりに指した各局面の指紋 -> 何手目か、の索引。
   *
   * 全探索が使えなかったときの控え。焼いてある解答は**厳密な最短手順**なので、
   * その線上にいるかどうかは指紋の一致だけで判定できる。
   */
  buildPath(puzzle) {
    const board = new Board(puzzle.size);
    board.restore(puzzle.snapshot);
    const index = new Map([[board.fingerprint(), 0]]);
    for (let i = 0; i < puzzle.solution.length; i++) {
      const step = puzzle.solution[i];
      if (!board.applyMove(step.pieceId, step.dir)) break;
      index.set(board.fingerprint(), i + 1);
    }
    return index;
  }

  /** 色つき2個の隙間（0 = 上下左右で隣り合っている＝解けた形） */
  colorGap(board) {
    const colored = [...board.pieces.values()].filter((p) => p.color !== BLOCKER);
    if (colored.length < 2) return 0;
    let best = Infinity;
    for (const [ax, ay] of colored[0].cells) {
      for (const [bx, by] of colored[1].cells) {
        const d = Math.abs(ax - bx) + Math.abs(ay - by);
        if (d < best) best = d;
      }
    }
    return Math.max(0, best - 1);
  }

  /**
   * 進み具合を測り直し、色に反映し、前に進んでいたら褒める。
   *
   * 測り方は2つあって、**大きいほうを採る**:
   *   ・解法の線上にいるなら、そこが何手目か（いちばん確かな物差し）
   *   ・外れているなら、色つき2個の隙間がどれだけ詰まったか
   * 線から外れた瞬間に色が 0 まで戻ると、遠回りしただけで景色が真っ白に
   * 巻き戻ってしまう。隙間のほうを保険に置くことでそれを防いでいる。
   *
   * @param {number|null} movedPieceId 直前に動かしたブロック（褒めるときの貼り先）
   * @param {boolean} reset レベルを読み込み直したとき。色を瞬時に合わせ、記録も引き直す
   */
  updateProgress(movedPieceId = null, reset = false) {
    if (!this.puzzle) return;
    const par = Math.max(1, this.puzzle.par);
    const before = this.remaining;
    const now = this.distanceToGoal();
    this.remaining = now;
    const gap = this.colorGap(this.board);

    if (now != null) {
      // 残り手数がそのまま進み具合になる。最短 par 手の盤面なら色は par 等分され、
      // 残りが 1 減るごとに 1 段進み、遠ざかればその場で 1 段戻る
      this.progress = Math.max(0, Math.min(1, (par - now) / par));
    } else {
      // 全探索が使えなかったとき。焼いてある手順の線上か、色つき同士の隙間で測る
      const step = this.pathIndex ? this.pathIndex.get(this.board.fingerprint()) : undefined;
      const byPath = step == null ? 0 : step / par;
      const byGap = this.startGap > 0 ? (this.startGap - gap) / this.startGap : 1;
      this.progress = Math.max(0, Math.min(1, Math.max(byPath, byGap)));
    }
    this.renderer.setProgress(this.progress, reset);

    if (reset) {
      this.bestGap = gap;
      this.bestStep = 0;
      return;
    }
    if (movedPieceId == null) return; // 戻す・クリアなど。色だけ合わせる

    /*
     * 褒め方は 2 段。
     *
     *   残り手数が減った  = その 1 手は**最短手順のひとつ**だった。いちばん濃く褒める
     *   隙間だけ縮まった  = 解そのものには近づいていないが、形としては寄っている
     *
     * 残り手数で見るのが肝。焼いてある手順と一致するかで見ると、**別の最短手順に
     * 乗り換えただけの手**を間違い扱いしてしまう。最短の道は 1 本ではない。
     */
    if (before != null && now != null && now < before) {
      this.cheer(movedPieceId, 0.75);
    } else if (gap < this.bestGap) {
      this.cheer(movedPieceId, 0.33);
    }
    if (gap < this.bestGap) this.bestGap = gap;
  }

  /**
   * 「いいね」のスタンプと、低いほめ音。
   * 確率で間引く ―― 毎回出ると壁紙になり、出なさすぎると気づかれない。
   */
  cheer(pieceId, chance) {
    if (Math.random() >= chance) return;
    const piece = this.board.pieces.get(pieceId);
    if (!piece) return;
    this.renderer.stamp(piece.cells, '👍', 3);
    this.sound.praise();
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
    this.elapsed = 0;
    this.combo = 0;
    this.targets = targetMoves(puzzle.par);

    this.store.lastLevel = lv;
    saveStore(this.store);

    // 解への近さを測る道具立て。ここで引き直さないと前のレベルの色を引きずる
    this.pathIndex = this.buildPath(puzzle);
    this.startGap = this.colorGap(this.board);
    this.lastMovedId = null;
    this.remaining = null;

    // 残り手数の表は**遊びながら**配る。ここで配り終わるまで待たせると、
    // 深い盤面では 0.5 秒以上のあいだ画面が固まってしまう。
    // 配り終わるまでのあいだは、焼いてある手順と隙間で色をおおまかに動かす
    this.beginDistances(puzzle);

    this.status = 'playing';
    // 色は残り手数を par 等分した段で動く。焼き上げ直しの刻みもそこに合わせる
    this.renderer.setSteps(puzzle.par);
    this.updateProgress(null, true);

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
      text: `${cfg.size}×${cfg.size}・最短${cfg.par}手 の盤面を組み立てています…`
        + (tried > 0 ? `（${tried} 通り目）` : ''),
      stats: [],
      actions: [],
    });
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
    this.elapsed = 0;
    this.combo = 0;
    this.status = 'playing';
    this.selected = null;
    this.ghost = null;
    this.anim = null;
    this.lastMovedId = null;
    this.updateProgress(null, true);
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

    this.ghost = null;
    this.selected = pieceId;
    this.lastMovedId = pieceId;
    this.moves++;

    this.board.movePiece(pieceId, dir, steps);
    const duration = Math.min(0.36, 0.1 + steps * 0.033);
    this.anim = { phase: 'slide', pieceId, dir, steps, t: 0, duration };
    // 摩擦の音は滑走アニメと同じ長さで鳴らす（音だけ先に終わると軽くなる）
    this.sound.slide(steps, duration);
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
    const won = this.board.isCleared;
    // 勝った手はスタンプを出さない ―― クリアの音と重なって、どちらも痩せる
    this.updateProgress(won ? null : this.lastMovedId);
    if (won) {
      this.status = 'won';
      this.recordResult();
      this.sound.win();
      setTimeout(() => this.finishLevel(), 640);
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
    this.lastMovedId = null;
    this.renderer.clearEffects();
    // 色は巻き戻すが、「いちばん先まで行った記録」は残す
    // （戻して指し直すたびに褒められると、褒め言葉の意味が無くなる）
    this.updateProgress(null);
    this.hideOverlay();
    this.updateHud();
  }

  // ------------------------------------------------------------ 入力

  bindInput() {
    this.mountInput();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key;
      // シートが開いているあいだ、後ろの盤面には触らせない。
      // とくに「名前を決める」は決めるまで閉じないので、ここから抜け出せると
      // 名無しのまま先へ進めてしまう
      if (this.anyModalOpen() && key !== 'Escape') return;
      const arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (arrows[key]) {
        e.preventDefault();
        if (this.selected != null) this.tryMove(this.selected, arrows[key]);
        else this.toast('先にブロックをクリックして選んでください');
        return;
      }
      const k = key.toLowerCase();
      if (k === 'z' || k === 'u' || k === 'backspace') { e.preventDefault(); this.undo(); }
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

  /**
   * 盤面の操作をどこで受けるかを決めて、繋ぎ直す。
   *
   * ふつうはキャンバスで受ける。iPhone だけは、キャンバスの上に敷いた
   * 「触覚の膜」（透明なネイティブスイッチ）で受ける ―― iOS は script から
   * 触覚を出せないので、**指がその膜に直接触れること自体**を手ごたえにする
   * （詳しくは haptics.js）。膜がイベントを受け取ったままでないと鳴らないので、
   * 入力もキャンバスではなく膜に付ける。
   *
   * バイブレーションを切ったら膜は外す。触覚のためだけに敷いているものが
   * 残っていると、操作の経路だけが変わって得るものが無い。
   */
  mountInput() {
    const canvas = this.dom.canvas;
    const wrap = canvas.parentElement;
    if (this.detachInput) { this.detachInput(); this.detachInput = null; }
    if (this.hapticVeil) { this.hapticVeil.remove(); this.hapticVeil = null; }

    let surface = canvas;
    if (wrap && this.settings.haptics && this.sound.needsHapticVeil()) {
      const veil = this.sound.createHapticVeil();
      if (veil) {
        wrap.appendChild(veil);
        this.hapticVeil = veil;
        surface = veil;
      }
    }

    this.detachInput = attachInput(surface, {
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
        if (id != null) this.sound.tap();
      },
      onPreview: (id, dir) => this.setGhost(id, dir),
      onCommit: (id, dir) => this.tryMove(id, dir),
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
      // 触覚は AudioContext を伴わないので、押した先が何であれ先に起こしておく
      // （iOS はここで隠しスイッチを用意する。最初の 1 回だけ遅れるのを防ぐ）。
      this.sound.armHaptics();
      const hit = e.target.closest && e.target.closest('button, .switch');
      if (!hit || hit.disabled) return;
      this.sound.unlock();
      this.sound.click();
    }, { passive: true });

    d.btnUndo.addEventListener('click', () => this.undo());
    d.btnRestart.addEventListener('click', () => this.restart());
    d.btnLevels.addEventListener('click', () => this.showLevels());
    d.btnHome.addEventListener('click', () => this.showHome());

    // ホーム
    d.btnStart.addEventListener('click', () => this.load(this.startLevel));
    d.btnOpenLevels.addEventListener('click', () => this.showLevels());
    // ホームから開くときは星の数の表から。ここは「自分がどれだけ集めたか」を
    // 見に来る場所で、特定の1レベルの手数を見に来る場所ではない
    if (d.btnHomeRank) d.btnHomeRank.addEventListener('click', () => this.showStarRanking());
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
      if (el) {
        el.addEventListener('click', () => {
          this.updateSettingsName();
          // 開くたびに見直す（ゲームパッドは後から繋がることがある）
          this.updateHapticsNote();
          this.openModal(d.modalSettings);
        });
      }
    }

    for (const modal of this.modals()) {
      modal.addEventListener('click', (e) => {
        // 名前を決めきるまでは、背景タップでも閉じない
        if (modal === d.modalName && this.nameLocked) return;
        // 閉じるボタンの中身（SVG）が押されることもあるので closest で辿る
        if (e.target === modal || (e.target.closest && e.target.closest('[data-close]'))) {
          this.closeModals();
        }
      });
      // 下へ払っても閉じられるようにする。閉じるボタンは右上の丸ひとつしか
      // 無いので、盤面を見ながら片手で持っているときほど遠い
      attachSheetSwipe(modal, {
        canClose: () => !(modal === d.modalName && this.nameLocked),
        onClose: () => { modal.hidden = true; this.disarmReset(); },
      });
    }

    // ランキング
    if (d.btnRank) d.btnRank.addEventListener('click', () => this.showRanking(this.level));
    if (d.rankTabs) {
      d.rankTabs.addEventListener('click', (e) => {
        const tab = e.target.closest && e.target.closest('[data-board]');
        if (tab) this.setRankBoard(tab.dataset.board);
      });
    }
    if (d.btnRankPrev) d.btnRankPrev.addEventListener('click', () => this.stepRankLevel(-1));
    if (d.btnRankNext) d.btnRankNext.addEventListener('click', () => this.stepRankLevel(1));
    if (d.rankLevelInput) {
      d.rankLevelInput.addEventListener('change', () => this.pickRankLevel(d.rankLevelInput.value));
      d.rankLevelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          d.rankLevelInput.blur();
          this.pickRankLevel(d.rankLevelInput.value);
        }
      });
    }
    if (d.btnNameSave) d.btnNameSave.addEventListener('click', () => this.commitName());
    if (d.nameInput) {
      d.nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.commitName(); }
      });
      // 打ち始めたらエラーは引っ込める（打っている最中に赤いのは邪魔）
      d.nameInput.addEventListener('input', () => {
        d.nameInput.classList.remove('bad');
        if (d.nameError) d.nameError.hidden = true;
      });
    }
    if (d.btnChangeName) {
      d.btnChangeName.addEventListener('click', () => {
        // 設定シートは畳んでから開く（同じ高さに2枚重なると、どちらも操作しづらい）
        d.modalSettings.hidden = true;
        this.askName(false);
      });
    }
    this.updateSettingsName();

    // 「データを消す」でも既定に戻せるよう、対応表を持っておく
    this.toggles = {
      sound: d.optSound,
      haptics: d.optHaptics,
      symbols: d.optSymbols,
      ghost: d.optGhost,
      calm: d.optCalm,
    };
    for (const [key, el] of Object.entries(this.toggles)) {
      if (!el) continue;
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => {
        this.settings[key] = el.checked;
        this.applySettings();
        this.store.settings = this.settings;
        saveStore(this.store);
        if (key === 'sound' && el.checked) { this.sound.unlock(); this.sound.click(); }
        // 入れた瞬間に一度震わせる。届く端末かどうかが、その場で手で分かる
        if (key === 'haptics' && el.checked) { this.sound.armHaptics(); this.sound.vibrate([12, 40, 26]); }
      });
    }
    this.updateHapticsNote();

    this.buildMaterialPicker();

    d.btnShare.addEventListener('click', () => this.share());
    if (d.btnReset) d.btnReset.addEventListener('click', () => this.askReset());
  }

  // ------------------------------------------------------------ 記録を消す

  /**
   * この端末のデータを消す。
   *
   * 取り返しがつかないので2段階にしてある ―― 1回目のタップで「本当に消す」に
   * 変わり、何を失うのかを数字で見せる。5秒でふつうの表示に戻るので、
   * 誤タップだけで消えることはない。
   */
  askReset() {
    const d = this.dom;
    if (!d.btnReset) return;
    if (this.resetArmed) { this.resetAll(); return; }

    this.resetArmed = true;
    d.btnReset.textContent = '本当に消す（もう一度タップ）';
    if (d.resetNote) {
      d.resetNote.textContent = `星 ${this.totalStars} 個・クリア ${this.clearedCount} レベル`
        + `・自己ベスト・設定・ランキングの名前が消えます。元には戻せません。`;
    }
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.disarmReset(), 5000);
  }

  /** 「本当に消す」の身構えを解いて、ふつうの表示に戻す */
  disarmReset() {
    const d = this.dom;
    this.resetArmed = false;
    clearTimeout(this.resetTimer);
    if (d.btnReset) d.btnReset.textContent = 'この端末のデータを消す';
    if (d.resetNote) {
      d.resetNote.textContent = '星・自己ベスト・設定・ランキングの名前を消して、最初の状態に戻します。';
    }
  }

  resetAll() {
    this.disarmReset();
    for (const key of [STORE_KEY, ...LEGACY_KEYS, RULES_KEY]) {
      try { localStorage.removeItem(key); } catch { /* 消せない環境では諦める */ }
    }
    // 名前とこの端末のランキングも一緒に消す。「最初の状態」に名前は残らない
    forgetName();
    clearLocalRanking();
    this.updateSettingsName();

    this.store = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.applySettings();
    this.markMaterial();
    for (const [key, el] of Object.entries(this.toggles || {})) {
      if (el) el.checked = !!this.settings[key];
    }

    // 遊びかけの盤面も畳んで、初回起動と同じ状態に戻す
    this.puzzle = null;
    this.level = 1;
    this.status = 'idle';
    this.loadToken++;
    this.closeModals();
    this.showHome();
    this.toast('この端末のデータを消しました');
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
    // 背景の色はゲーム画面だけ。ホームや一覧に持ち込むと、そこの配色が濁る
    if (d.gameAura) d.gameAura.hidden = name !== 'game';
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
      const best = this.bestMovesOf(lv);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'level-cell';
      if (lv === this.reachedLevel) cell.classList.add('current');
      else if (stars > 0) cell.classList.add('done');

      cell.dataset.level = String(lv);
      cell.innerHTML = `<span class="n">${lv}</span>`
        + `<span class="stars${stars ? '' : ' none'}">${'★'.repeat(stars) || '☆☆☆'}</span>`
        + (best != null ? `<span class="cell-time">${best}手</span>` : '');
      cell.title = best != null
        ? `レベル ${lv}：${levelPreview(lv)}／自己ベスト ${best}手`
        : `レベル ${lv}：${levelPreview(lv)}`;
      d.levelGrid.appendChild(cell);
    }
  }

  showGame() {
    if (this.screen !== 'game') this.showScreen('game');
  }

  applySettings() {
    this.renderer.options = { ...this.settings };
    this.renderer.setMaterial(this.settings.material);
    this.sound.enabled = this.settings.sound;
    this.sound.haptics = this.settings.haptics;
    // 触覚の膜を敷くか外すかが変わる。まだ入力を繋いでいない起動時は飛ばす
    if (this.detachInput) this.mountInput();
    this.updateHapticsNote();
  }

  /**
   * バイブレーションの但し書きを、その端末の実際に合わせて書き換える。
   * 「対応端末のみ」とだけ書いてあると、鳴らないときに設定を疑い続けることになる。
   */
  updateHapticsNote() {
    const note = this.dom.optHapticsNote;
    if (!note) return;
    const NOTES = {
      vibration: '動かした手ごたえを指に返す',
      // iPhone は指が盤面に触れている操作でしか鳴らせない。できないことを
      // 「対応端末のみ」と濁さずに書く（詳しくは haptics.js）
      'ios-veil': 'iPhone ではブロックを操作したときだけ',
      gamepad: 'つないだコントローラを震わせる',
      none: 'この端末には振動する部品がありません',
    };
    note.textContent = NOTES[this.sound.hapticsMode] || NOTES.none;
  }

  /**
   * ブロックのデザインを選ぶボタンを並べる。
   * 見本は「そのデザインで焼いた実物」ではなく代表色の四角 ―― 一覧を実物で描くと
   * シートを開くだけで写真の復号と焼き上げが走り、そこで引っかかる。
   */
  buildMaterialPicker() {
    const grid = this.dom.materialGrid;
    if (!grid) return;
    grid.innerHTML = '';
    for (const m of materialList()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'material-cell';
      btn.dataset.material = m.key;
      btn.setAttribute('role', 'radio');
      btn.innerHTML = `<span class="material-chip" style="background:${m.swatch}"></span>`
        + `<span class="material-name"></span><span class="material-note"></span>`;
      btn.querySelector('.material-name').textContent = m.name;
      btn.querySelector('.material-note').textContent = m.note;
      grid.appendChild(btn);
    }
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest && e.target.closest('[data-material]');
      if (!cell) return;
      this.setMaterial(cell.dataset.material);
    });
    this.markMaterial();
  }

  setMaterial(key) {
    const mat = materialFor(key);
    if (this.settings.material === mat.key) return;
    this.settings.material = mat.key;
    this.applySettings();
    this.store.settings = this.settings;
    saveStore(this.store);
    this.markMaterial();
    this.toast(`ブロックを「${mat.name}」にしました`);
  }

  /** いま選ばれているデザインに印を付ける */
  markMaterial() {
    const grid = this.dom.materialGrid;
    if (!grid) return;
    for (const cell of grid.children) {
      const on = cell.dataset.material === this.settings.material;
      cell.classList.toggle('on', on);
      cell.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  openModal(el) {
    // 前に払って閉じたときの姿（下がった位置・薄い暗幕）が残っていると、
    // 次に開いたシートが閉じかけの形で現れる
    resetSheet(el);
    el.hidden = false;
  }

  /** 開け閉めの対象になるシート一覧（HTML に無いものは飛ばす） */
  modals() {
    const d = this.dom;
    return [d.modalRules, d.modalSettings, d.modalInstall, d.modalRank, d.modalName].filter(Boolean);
  }

  anyModalOpen() {
    return this.modals().some((m) => !m.hidden);
  }

  closeModals() {
    for (const modal of this.modals()) {
      // 名前を決めきるまでは閉じない。名無しの記録をランキングに残さないため
      if (modal === this.dom.modalName && this.nameLocked) continue;
      modal.hidden = true;
    }
    // 開き直したら「本当に消す」は最初から訊き直す
    this.disarmReset();
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
   * 時計の表示。毎フレーム呼ばれるので、秒が変わったときだけ DOM を触る。
   * 星には関わらないので、色は付けない ―― 急かす意味がない。
   */
  updateTimer() {
    const d = this.dom;
    const t = Math.floor(this.elapsed);
    if (t === this.shownTime) return;
    this.shownTime = t;
    d.statTime.textContent = formatTime(t);
  }

  updateHud() {
    const d = this.dom;
    d.statMoves.textContent = String(this.moves);
    d.statLevel.textContent = String(this.level);
    d.levelInfo.textContent = this.puzzle ? puzzleSummary(this.puzzle) : '\u00a0';

    // ★★★ の手数を過ぎたら色を変えて、いま星いくつぶんの位置にいるかを伝える
    const g = this.targets;
    d.hudMoves.classList.toggle('warm', !!g && this.moves > g.gold && this.moves <= g.silver);
    d.hudMoves.classList.toggle('late', !!g && this.moves > g.silver);

    d.btnUndo.disabled = this.history.length === 0 || this.busy;
    if (this.moves !== this.shownMoves) {
      this.shownMoves = this.moves;
      d.hudMoves.classList.remove('bump');
      void d.hudMoves.offsetWidth; // アニメーションを確実に再生させる
      d.hudMoves.classList.add('bump');
    }
    this.shownTime = -1; // 表示を作り直す（レベルを跨いだ直後など）
    this.updateTimer();
  }

  // ------------------------------------------------------------ 結果表示

  /**
   * クリアを記録する。星は「何手で解いたか」で決まり、最高記録だけが残る。
   * ベストは最少手数。★★★ は最短ちょうどなので、そこが上限になる。
   */
  recordResult() {
    if (!this.puzzle) return;
    const key = String(this.level);
    const moves = this.moves;
    const stars = starsForMoves(moves, this.targets);

    this.store.best = this.store.best || {};
    this.store.stars = this.store.stars || {};
    const prevBest = this.bestMovesOf(this.level);
    const prevStars = this.store.stars[key] || 0;

    this.newRecord = prevBest == null || moves < prevBest;
    if (this.newRecord) this.store.best[key] = moves;
    this.store.stars[key] = Math.max(prevStars, stars);

    // 到達レベルを進める（鍵ではない。「つづきから」の行き先になるだけ）
    this.store.reached = Math.max(this.reachedLevel, this.level + 1);
    saveStore(this.store);

    this.clearMoves = moves;
    this.clearTime = Math.max(1, Math.round(this.elapsed));
    this.lastStars = stars;
    this.newStars = stars > prevStars;
  }

  /**
   * クリアの後始末。
   *
   * 記録は**必ず**ランキングに出す ―― 「保存しますか？」は訊かない。
   * 訊いてしまうと、押し忘れた回のぶんだけランキングが実態からずれて、
   * 「1位の人が本当に1位なのか」が誰にも分からなくなる。
   * そのぶん名前だけは自分で決めてもらう（初回だけ。以後は自動）。
   */
  finishLevel() {
    this.showWin();
    if (savedName()) {
      this.submitResult();
      return;
    }
    this.askName(true);
  }

  showWin() {
    const stars = this.lastStars;
    const moves = this.clearMoves;
    const best = this.bestMovesOf(this.level);
    const par = this.puzzle.par;
    const badges = { 3: '👑', 2: '🎉', 1: '🎊' };

    // ★★★ は「最短ちょうど」。近道が存在しないと分かっているので言い切れる
    let text = stars === 3
      ? `${par}手 ―― 最短で解きました。これより短い解き方は存在しません。`
      : `おめでとう！ この盤面の最短は ${par}手 です`
        + `（あと ${moves - par}手 縮められます）。★★★ は ${this.targets.gold}手、★★ は ${this.targets.silver}手 までです。`;

    this.showOverlay({
      badge: badges[stars] || '🎊',
      title: `レベル ${this.level} クリア！`,
      titleClass: stars === 3 ? 'gold' : '',
      stars,
      text,
      stats: [
        { k: '手数', n: `${moves}/${par}` },
        { k: 'ベスト', n: `${best != null ? best : moves}手` },
        { k: 'タイム', n: formatTime(this.clearTime) },
      ],
      actions: [
        { label: `レベル ${this.level + 1} へ`, primary: true, onClick: () => this.nextLevel() },
        { label: 'ランキングを見る', onClick: () => this.showRanking(this.level) },
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
    // 順位は非同期で入る。ここでは必ず空にしておく（前のレベルの順位が残らないように）
    if (d.overlayRank) {
      d.overlayRank.textContent = '';
      d.overlayRank.classList.remove('pending');
    }

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

  // ------------------------------------------------------------ ランキング

  /**
   * 名前を訊く。
   * @param {boolean} locked クリア直後。決めるまで閉じられない
   */
  askName(locked = false) {
    const d = this.dom;
    if (!d.modalName) return;
    this.nameLocked = locked;
    if (d.nameClose) d.nameClose.hidden = locked;
    if (d.nameTitle) d.nameTitle.textContent = locked ? '名前を決める' : 'ランキングの名前';
    if (d.nameLead) {
      d.nameLead.innerHTML = locked
        ? 'クリアの記録は、レベルごとのランキングに残ります。<b>この名前で載ります。</b><br>'
          + '一度決めれば、次からは自動でこの名前が使われます。'
        : 'ランキングに載せる名前です。変えると、<b>次の記録から</b>新しい名前で載ります。';
    }
    if (d.btnNameSave) d.btnNameSave.textContent = locked ? 'この名前で記録する' : 'この名前にする';
    d.nameInput.value = locked ? '' : savedName();
    d.nameInput.classList.remove('bad');
    if (d.nameError) d.nameError.hidden = true;
    this.openModal(d.modalName);
    // シートが上がりきってから当てる。上がっている最中だと iOS で外れることがある
    setTimeout(() => { try { d.nameInput.focus(); } catch { /* 当てられなければそのまま */ } }, 280);
  }

  /** 入力された名前を確定する。空なら閉じさせない */
  commitName() {
    const d = this.dom;
    const clean = sanitizeName(d.nameInput.value);
    if (!clean) {
      if (d.nameError) d.nameError.hidden = false;
      d.nameInput.classList.add('bad');
      try { d.nameInput.focus(); } catch { /* 当てられなければそのまま */ }
      return;
    }
    saveName(clean);
    this.updateSettingsName();

    const wasLocked = this.nameLocked;
    this.nameLocked = false;
    d.modalName.hidden = true;
    if (wasLocked) {
      this.submitResult();
    } else {
      // 名前が変わったら、星の表にも新しい名前で載せ直す
      this.postStars();
      this.toast(`ランキングの名前を「${clean}」にしました`);
    }
  }

  /** 設定シートに出す、いまの名前 */
  updateSettingsName() {
    const el = this.dom.settingsName;
    if (!el) return;
    const name = savedName();
    el.textContent = name || 'まだ決めていません';
  }

  /**
   * クリアの記録をランキングへ出す。
   * 通信が失敗しても端末には残るので、ここで失敗しても記録は消えない。
   */
  async submitResult() {
    const d = this.dom;
    const level = this.level;
    const token = ++this.rankToken;

    if (d.overlayRank) {
      d.overlayRank.classList.add('pending');
      d.overlayRank.textContent = isGlobalRanking() ? 'ランキングに記録しています…' : '記録しています…';
    }

    // 星が増えていれば、通算の表にも反映しておく（返事は待たない）
    this.postStars();

    const res = await submitScore({
      level,
      name: savedName(),
      moves: this.clearMoves,
      time: this.clearTime,
      stars: this.lastStars,
    });
    // 待っているあいだに次のレベルへ行かれていたら、もう出す場所が無い
    if (token !== this.rankToken || this.level !== level) return;
    if (!d.overlayRank) return;

    d.overlayRank.classList.remove('pending');
    d.overlayRank.innerHTML = '';
    const scope = res.global && !res.offline ? '世界' : 'この端末';
    const line = document.createElement('span');
    if (res.rank) {
      line.innerHTML = `${scope}ランキング <b>${res.rank}位</b>`
        + `<span class="muted"> ／ ${res.entries.length}人中</span>`;
    } else {
      line.textContent = `${scope}ランキングに記録しました`;
    }
    d.overlayRank.appendChild(line);

    if (res.offline) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'サーバーにつながらなかったので、この端末に残しました。';
      d.overlayRank.appendChild(note);
    }
  }

  /**
   * いま持っている星の数を、星のランキングへ出す。
   *
   * レベル別の投稿と違って**画面には出さない** ―― クリア直後に見たいのはその
   * レベルの順位で、通算の順位はホームから見に行くもの。裏で静かに更新する。
   *
   * 前に出した数と同じなら何もしない。星は 1 レベルクリアするごとにしか動かないので、
   * 起動のたびに同じ数を投げても増えるのは通信だけ。届かなかったときは
   * 印を付けずに置いて、次の機会に出し直す。
   */
  async postStars() {
    const name = savedName();
    const stars = this.totalStars;
    if (!name || stars <= 0) return;
    if (this.store.starsPosted === stars && this.store.starsName === name) return;

    const res = await submitStars({ name, stars, cleared: this.clearedCount });
    if (res.offline) return;
    this.store.starsPosted = stars;
    this.store.starsName = name;
    saveStore(this.store);
  }

  /** レベル別のランキングを開く（ゲーム画面のドックと、クリア直後から） */
  showRanking(level = this.level) {
    this.openRanking('level', level);
  }

  /** 星の数のランキングを開く（ホームから） */
  showStarRanking() {
    this.openRanking('stars', this.level);
  }

  /**
   * ランキングのシートを開く。
   * @param {'stars'|'level'} board どちらの表から見せるか
   * @param {number} level レベル別へ切り替えたときに開くレベル
   */
  openRanking(board, level = this.level) {
    const d = this.dom;
    if (!d.modalRank) return;
    this.rankLevel = normalizeLevel(level);
    this.openModal(d.modalRank);
    this.setRankBoard(board);
  }

  /** 表を切り替える（タブ）。切り替えたらその場で取りに行く */
  setRankBoard(board) {
    const d = this.dom;
    this.rankBoard = board === 'level' ? 'level' : 'stars';

    if (d.rankTabs) {
      for (const tab of d.rankTabs.children) {
        const on = tab.dataset.board === this.rankBoard;
        tab.classList.toggle('on', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    if (d.rankPick) d.rankPick.hidden = this.rankBoard !== 'level';
    if (d.rankLevelInput) d.rankLevelInput.value = String(this.rankLevel);
    if (d.btnRankPrev) d.btnRankPrev.disabled = this.rankLevel <= 1;

    this.loadRanking();
  }

  /** 見るレベルを1つずらす */
  stepRankLevel(delta) {
    this.pickRankLevel(this.rankLevel + delta);
  }

  /** 見るレベルを決め直す。同じレベルなら取りに行かない */
  pickRankLevel(raw) {
    const d = this.dom;
    const lv = normalizeLevel(parseInt(raw, 10) || 1);
    if (d.rankLevelInput) d.rankLevelInput.value = String(lv);
    if (d.btnRankPrev) d.btnRankPrev.disabled = lv <= 1;
    if (lv === this.rankLevel && this.rankBoard === 'level') return;
    this.rankLevel = lv;
    this.loadRanking();
  }

  /** いま選ばれている表を取りに行って、描き直す */
  async loadRanking() {
    const d = this.dom;
    const board = this.rankBoard;
    const lv = this.rankLevel;
    const token = ++this.rankViewToken;
    const where = isGlobalRanking() ? '世界共通' : 'この端末';

    d.rankTitle.textContent = board === 'stars' ? '星の数ランキング' : `レベル ${lv} のランキング`;
    d.rankScope.textContent = board === 'stars'
      ? `${where} ― 星の多い順`
      : `${where} ― 手数の少ない順`;
    d.rankList.innerHTML = '<div class="rank-empty">読み込んでいます…</div>';
    d.rankNote.textContent = ' ';

    const res = board === 'stars' ? await fetchStarRanking() : await fetchRanking(lv);
    // 待っているあいだに別の表・別のレベルへ切り替えられていたら、もう出す場所が無い
    if (token !== this.rankViewToken) return;
    this.renderRanking(res, board);
  }

  /**
   * ランキングの一覧を組み立てる。
   * 名前はサーバーから来る他人の文字列なので、必ず textContent で入れる
   * （innerHTML に流すと、名前に書いた HTML がこちらの画面で動いてしまう）。
   */
  renderRanking(res, board = 'level') {
    const d = this.dom;
    const me = savedName();
    const stars = board === 'stars';
    d.rankList.innerHTML = '';

    if (!res.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'rank-empty';
      empty.textContent = stars
        ? 'まだ誰も星を持っていません。1レベルクリアすれば、ここに載ります。'
        : 'まだ誰も記録していません。最初のひとりになりましょう。';
      d.rankList.appendChild(empty);
    } else {
      res.entries.slice(0, RANK_LIMIT).forEach((e, i) => {
        const row = document.createElement('div');
        row.className = 'rank-row' + (me && e.name === me ? ' me' : '');
        const pos = document.createElement('span');
        pos.className = 'rank-pos';
        pos.textContent = String(i + 1);
        const name = document.createElement('span');
        name.className = 'rank-name';
        name.textContent = e.name;
        // 表によって右側の2つが入れ替わる（星の数とクリア数／手数とタイム）
        const value = document.createElement('span');
        const note = document.createElement('span');
        if (stars) {
          value.className = 'rank-stars';
          value.textContent = `★${e.stars}`;
          note.className = 'rank-cleared';
          note.textContent = `${e.cleared}レベル`;
        } else {
          value.className = 'rank-moves';
          value.textContent = `${e.moves}手`;
          note.className = 'rank-time';
          note.textContent = formatTime(e.time);
        }
        row.append(pos, name, value, note);
        d.rankList.appendChild(row);
      });
    }

    if (res.offline) {
      d.rankNote.textContent = 'サーバーにつながらないので、この端末の記録を出しています。';
    } else if (!res.global) {
      d.rankNote.textContent = 'いまはこの端末の記録だけです。';
    } else {
      d.rankNote.textContent = stars
        ? `世界中の記録から、星の多い順に${RANK_LIMIT}位まで。同じ星ならクリア数の少ない人が上です。`
        : `世界中の記録から、手数の少ない順に${RANK_LIMIT}位まで。`;
    }
  }

  // ------------------------------------------------------------ ループ

  loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // 残り手数の表を、フレームの余りで少しずつ配る（遊びは止めない）
    this.advanceDistances();

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
      invalid: this.invalid,
    }, dt);

    // 背景は盤面の色と同じ速さで動かす。別々に動くと2つの色がすれ違って濁る。
    // 進行度は毎フレーム少しずつしか動かないので、動いたときだけ CSS を触る
    if (Math.abs(this.renderer.progress - this.paintedProgress) > 0.0015) {
      this.paintedProgress = this.renderer.progress;
      try {
        const style = document.documentElement.style;
        // 下に溜まるぶんだけ濃く。上は透けたまま伸びていく
        style.setProperty('--game-tint', this.renderer.auraColor(0.24));
        style.setProperty('--game-deep', this.renderer.auraColor(0.44));
        style.setProperty('--game-rise', `${this.renderer.auraRise().toFixed(1)}%`);
      } catch { /* 触れない環境では背景が白いだけ */ }
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

export { colorFor, DIRS };
