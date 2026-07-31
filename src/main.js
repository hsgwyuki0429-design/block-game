// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の問題を決める。

import { Game } from './game.js';
import { codeToSeed, hashSeed } from './rng.js';

const $ = (id) => document.getElementById(id);

const dom = {
  canvas: $('board'),
  toast: $('toast'),

  statMoves: $('stat-moves'),
  statMovesBox: $('stat-moves').parentElement,
  statPar: $('stat-par'),
  statLeft: $('stat-left'),
  statSeed: $('stat-seed'),
  statModeLabel: $('stat-mode-label'),
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
  btnNew: $('btn-new'),
  btnRules: $('btn-rules'),
  btnSettings: $('btn-settings'),

  modalRules: $('modal-rules'),
  modalSettings: $('modal-settings'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
  seedInput: $('seed-input'),
  btnSeedGo: $('btn-seed-go'),
  btnDaily: $('btn-daily'),
  btnShare: $('btn-share'),
};

const game = new Game(dom);

function seedFromHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  if (!raw) return null;
  if (/^daily$/i.test(raw)) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return { seed: hashSeed(`daily-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`), mode: 'daily' };
  }
  return { seed: codeToSeed(raw), mode: 'free' };
}

const start = seedFromHash();
if (start) {
  game.load(start.seed, start.mode);
} else {
  game.load((Math.random() * 0xffffffff) >>> 0, 'free');
}

// 初回だけルールを開く
try {
  if (!localStorage.getItem('slidepop.seenRules')) {
    dom.modalRules.hidden = false;
    localStorage.setItem('slidepop.seenRules', '1');
  }
} catch { /* 無視 */ }

window.slidePop = game;
