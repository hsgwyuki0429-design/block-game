// 起動。DOM を集めて Game に渡し、URL のハッシュから最初の画面を決める。

import { Game, RULES_KEY } from './game.js';
import { attachEdgeGuard } from './edgeGuard.js';

const $ = (id) => document.getElementById(id);

const dom = {
  // 画面
  screenHome: $('screen-home'),
  screenLevels: $('screen-levels'),
  screenGame: $('screen-game'),

  canvas: $('board'),
  toast: $('toast'),
  gameAura: $('game-aura'),

  // ホーム
  btnStart: $('btn-start'),
  btnStartLabel: $('btn-start-label'),
  btnStartSub: $('btn-start-sub'),
  btnOpenLevels: $('btn-open-levels'),
  btnHomeRank: $('btn-home-rank'),
  btnInstall: $('btn-install'),
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
  statTime: $('stat-time'),
  hudTime: $('hud-time'),
  levelInfo: $('level-info'),

  overlay: $('overlay'),
  overlayBadge: $('overlay-badge'),
  overlayTitle: $('overlay-title'),
  overlayStars: $('overlay-stars'),
  overlayText: $('overlay-text'),
  overlayExtra: $('overlay-extra'),
  overlayStats: $('overlay-stats'),
  overlayRank: $('overlay-rank'),
  overlayActions: $('overlay-actions'),

  btnUndo: $('btn-undo'),
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
  modalInstall: $('modal-install'),
  optSound: $('opt-sound'),
  optHaptics: $('opt-haptics'),
  optHapticsNote: $('opt-haptics-note'),
  optSymbols: $('opt-symbols'),
  optGhost: $('opt-ghost'),
  optCalm: $('opt-calm'),
  materialGrid: $('material-grid'),
  btnShare: $('btn-share'),
  btnReset: $('btn-reset'),
  resetNote: $('reset-note'),

  // ランキング（星の数・レベル別／世界共通）
  btnRank: $('btn-rank'),
  modalRank: $('modal-rank'),
  rankTitle: $('rank-title'),
  rankTabs: $('rank-tabs'),
  rankPick: $('rank-pick'),
  rankLevelInput: $('rank-level'),
  btnRankPrev: $('btn-rank-prev'),
  btnRankNext: $('btn-rank-next'),
  rankScope: $('rank-scope'),
  rankList: $('rank-list'),
  rankNote: $('rank-note'),
  // 管理モード（持ち主だけ。ランキングの表題を長押しすると入口が出る）
  rankAdmin: $('rank-admin'),
  btnAdminOff: $('btn-admin-off'),

  // 名前（初回だけ訊いて、以後は自動で使う）
  modalName: $('modal-name'),
  nameTitle: $('name-title'),
  nameLead: $('name-lead'),
  nameInput: $('name-input'),
  nameError: $('name-error'),
  nameClose: $('name-close'),
  btnNameSave: $('btn-name-save'),
  btnChangeName: $('btn-change-name'),
  settingsName: $('settings-name'),
};

const game = new Game(dom);

// 端から払うスワイプでブラウザが前の画面に戻ってしまうのを止める
attachEdgeGuard();

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
  if (!localStorage.getItem(RULES_KEY)) {
    dom.modalRules.hidden = false;
    localStorage.setItem(RULES_KEY, '1');
  }
} catch { /* プライベートモードなどでは無視 */ }

/*
 * ホーム画面から開いたときに、通信が無くても遊べるようにする。
 * file:// では Service Worker が使えないので、そこでは何もしない。
 */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    // sw.js 自体はキャッシュさせない（新しい版に気づけなくなる）
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

window.slidePop = game;
