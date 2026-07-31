// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の問題を決める。

import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const dom = {
  canvas: $('board'),
  toast: $('toast'),

  statLevel: $('stat-level'),
  statMoves: $('stat-moves'),
  statMovesBox: $('stat-moves').parentElement,
  statPar: $('stat-par'),
  statLeft: $('stat-left'),
  levelInfo: $('level-info'),
  progressBar: $('progress-bar'),
  legend: $('legend'),

  overlay: $('overlay'),
  overlayBadge: $('overlay-badge'),
  overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'),
  overlayStats: $('overlay-stats'),
  overlayActions: $('overlay-actions'),

  btnUndo: $('btn-undo'),
  btnHint: $('btn-hint'),
  btnRestart: $('btn-restart'),
  btnLevels: $('btn-levels'),
  btnRules: $('btn-rules'),
  btnSettings: $('btn-settings'),

  modalRules: $('modal-rules'),
  modalSettings: $('modal-settings'),
  modalLevels: $('modal-levels'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
  levelInput: $('level-input'),
  levelPreview: $('level-preview'),
  btnLevelPrev: $('btn-level-prev'),
  btnLevelNext: $('btn-level-next'),
  btnLevelGo: $('btn-level-go'),
  btnLevelBest: $('btn-level-best'),
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

// 優先順位: URL のレベル > 前回遊んでいたレベル > レベル1
game.load(levelFromHash() || game.store.lastLevel || 1);

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
} catch { /* 無視 */ }

window.slidePop = game;
