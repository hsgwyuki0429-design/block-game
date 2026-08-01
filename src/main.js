// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の画面を決める。

import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const dom = {
  // 画面
  screenHome: $('screen-home'),
  screenLevels: $('screen-levels'),
  screenGame: $('screen-game'),

  canvas: $('board'),
  toast: $('toast'),

  // ホーム
  btnStart: $('btn-start'),
  btnStartLabel: $('btn-start-label'),
  btnStartSub: $('btn-start-sub'),
  btnOpenLevels: $('btn-open-levels'),
  homeProgress: $('home-progress'),

  // レベル一覧
  levelGrid: $('level-grid'),
  levelsSubtitle: $('levels-subtitle'),
  pageRange: $('page-range'),
  btnLevelsBack: $('btn-levels-back'),
  btnLevelsJump: $('btn-levels-jump'),
  btnPagePrev: $('btn-page-prev'),
  btnPageNext: $('btn-page-next'),

  // ゲーム
  statLevel: $('stat-level'),
  statMoves: $('stat-moves'),
  hudMoves: $('hud-moves'),
  statPar: $('stat-par'),
  statLeft: $('stat-left'),
  levelInfo: $('level-info'),
  progressBar: $('progress-bar'),
  legend: $('legend'),

  overlay: $('overlay'),
  overlayBadge: $('overlay-badge'),
  overlayTitle: $('overlay-title'),
  overlayStars: $('overlay-stars'),
  overlayText: $('overlay-text'),
  overlayExtra: $('overlay-extra'),
  overlayStats: $('overlay-stats'),
  overlayActions: $('overlay-actions'),

  btnUndo: $('btn-undo'),
  btnHint: $('btn-hint'),
  btnRestart: $('btn-restart'),
  btnLevels: $('btn-levels'),
  btnHome: $('btn-home'),

  // シート（ホームとゲーム、両方から開ける）
  btnRules: $('btn-rules'),
  btnRules2: $('btn-rules-2'),
  btnSettings: $('btn-settings'),
  btnSettings2: $('btn-settings-2'),
  modalRules: $('modal-rules'),
  modalSettings: $('modal-settings'),
  optSound: $('opt-sound'),
  optHaptics: $('opt-haptics'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
  btnShare: $('btn-share'),
};

const game = new Game(dom);

/** URL のハッシュ（#L12 / #12）からレベルを読む */
function levelFromHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  const m = /^L?(\d+)$/i.exec(raw);
  if (!m) return null;
  return Math.max(1, parseInt(m[1], 10));
}

// リンクでレベルを指定されたときだけ直行する。そうでなければホームから始める
const linked = levelFromHash();
if (linked) game.load(linked);
else game.showHome();

window.addEventListener('hashchange', () => {
  const lv = levelFromHash();
  if (lv && lv !== game.level) game.load(lv);
});

// 初回だけルールを開く
try {
  if (!localStorage.getItem('slidepop.seenRules')) {
    dom.modalRules.hidden = false;
    localStorage.setItem('slidepop.seenRules', '1');
  }
} catch { /* プライベートモードなどでは無視 */ }

window.slidePop = game;
