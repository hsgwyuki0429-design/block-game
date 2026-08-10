// 触覚（バイブレーション）。
//
// 「震える端末では必ず震える」ことを目標にした層。鳴らす側（audio.js）からは
// play(pattern) しか見えず、その端末に届く手段の選択はここに閉じてある。
//
//   ① Vibration API   navigator.vibrate。Android の Chrome / Firefox / Samsung など。
//                     [振動, 休み, 振動, ...] のパターンをそのまま渡せる唯一の道。
//
//   ② iOS の隠しスイッチ
//                     iOS には navigator.vibrate が無い（Safari も、ホーム画面に
//                     追加した PWA も）。ただし iOS 17.4 以降の WebKit は
//                     <input type="checkbox" switch> を切り替えるとシステムの
//                     触覚を返す。画面外に置いた 1 枚のスイッチをその発生源として
//                     借りる。強さと長さは選べないので、パターンは
//                     「叩く回数と間隔」に翻訳する（toTaps）。
//
//   ③ ゲームパッド    PC にコントローラが繋がっているとき。vibrationActuator に
//                     dual-rumble を流す。手元にモーターがあるならそこで鳴らす。
//
// ①〜③ のどれも持たない端末（多くのデスクトップ）は、震える部品が本当に無い
// ので何もしない。supported を見れば設定画面でそう伝えられる。

/**
 * Android の実機では 5ms 前後の振動は指に届かない（モーターが立ち上がる前に
 * 指示が終わる）。細かい合図ほど「鳴らしたのに感じない」になるので下限を敷く。
 */
const MIN_PULSE_MS = 12;

/** iOS のスイッチを連打するときの最短間隔。これより詰めると 1 回に潰れる */
const TAP_GAP_MS = 34;

/** 1 パターンで叩く上限。長い振動を刻みすぎると「連打」に化ける */
const MAX_TAPS = 6;

/** 数値 1 つでも配列でも受け取り、[振動, 休み, 振動, ...] の ms 配列にそろえる */
function toSegments(pattern) {
  const raw = Array.isArray(pattern) ? pattern : [pattern];
  const out = [];
  for (const v of raw) {
    const n = Math.round(Number(v));
    out.push(Number.isFinite(n) && n > 0 ? n : 0);
  }
  while (out.length && out[out.length - 1] === 0) out.pop();
  return out;
}

/** 偶数番＝振動、奇数番＝休み。振動の側にだけ下限を敷いた配列を返す */
function withMinPulse(segments) {
  return segments.map((ms, i) => (i % 2 === 0 && ms > 0 ? Math.max(ms, MIN_PULSE_MS) : ms));
}

/**
 * パターンを「叩く時刻（ms）」の列に変換する。
 *
 * iOS のスイッチは長さを選べない一撃しか出せないので、長い振動は等間隔の
 * 連打で代える。land() の [8, 24, 44]（前触れ → 間 → 重い本体）なら
 * 「1 発 → 間 → 2 発」になり、耳から入る形と崩れない。
 */
function toTaps(segments) {
  const taps = [];
  let t = 0;
  for (let i = 0; i < segments.length; i++) {
    const ms = segments[i];
    if (i % 2 === 1) { t += ms; continue; } // 休み
    if (ms <= 0) continue;
    taps.push(t);
    // 長い振動は等間隔で刻んで「続いている」ことを伝える
    for (let at = TAP_GAP_MS; at + TAP_GAP_MS * 0.5 <= ms; at += TAP_GAP_MS) taps.push(t + at);
    t += ms;
  }
  return taps.slice(0, MAX_TAPS);
}

export class Haptics {
  /**
   * @param {{navigator?: object, document?: object, setTimeout?: Function,
   *          clearTimeout?: Function}} [env] 差し替え用（テストから使う）
   */
  constructor(env = {}) {
    this.nav = env.navigator !== undefined ? env.navigator
      : (typeof navigator !== 'undefined' ? navigator : null);
    this.doc = env.document !== undefined ? env.document
      : (typeof document !== 'undefined' ? document : null);
    this.setTimer = env.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = env.clearTimeout || ((id) => clearTimeout(id));

    this.enabled = true;
    this.switchEl = null;   // iOS の隠しスイッチ（arm() で作る）
    this.timers = [];       // 予約済みの叩き
    this.watching = false;  // 画面を離れたときの後始末を仕掛けたか
  }

  // ------------------------------------------------------------ 端末を見る

  /** navigator.vibrate が使えるか（Android 系） */
  get hasVibrationApi() {
    return !!(this.nav && typeof this.nav.vibrate === 'function');
  }

  /**
   * iOS のスイッチ触覚が使えるか。
   * `switch` は WebKit が IDL 属性として持つので、実装の有無をそのまま聞ける。
   */
  get hasSwitchHaptics() {
    if (!this.doc || typeof this.doc.createElement !== 'function') return false;
    try {
      return 'switch' in this.doc.createElement('input');
    } catch {
      return false;
    }
  }

  /** 振動できるゲームパッド（繋がっていないときは空） */
  gamepads() {
    if (!this.nav || typeof this.nav.getGamepads !== 'function') return [];
    let list;
    try { list = this.nav.getGamepads(); } catch { return []; }
    if (!list) return [];
    return Array.from(list).filter(
      (g) => g && g.connected !== false && g.vibrationActuator
        && typeof g.vibrationActuator.playEffect === 'function',
    );
  }

  /** この端末で震えられるか。設定画面の但し書きに使う */
  get supported() {
    return this.hasVibrationApi || this.hasSwitchHaptics || this.gamepads().length > 0;
  }

  /** 使っている手段の名前（'vibration' / 'ios-switch' / 'gamepad' / 'none'） */
  get backend() {
    if (this.hasVibrationApi) return 'vibration';
    if (this.hasSwitchHaptics) return 'ios-switch';
    if (this.gamepads().length > 0) return 'gamepad';
    return 'none';
  }

  // ------------------------------------------------------------ 準備

  /**
   * 最初のユーザー操作で呼ぶ。iOS のスイッチをこの時点で作っておく
   * （最初の 1 回だけ生成が挟まると、その振動が一拍遅れて指とずれる）。
   */
  arm() {
    this.ensureSwitch();
    this.watchVisibility();
  }

  /**
   * 画面を離れたら、予約してある叩きを捨てる。
   * 戻ってきた指と関係のない振動が後から来ると、ただの誤作動に感じられる。
   */
  watchVisibility() {
    if (this.watching || !this.doc || typeof this.doc.addEventListener !== 'function') return;
    this.watching = true;
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.hidden) this.stop();
    });
  }

  /**
   * iOS の触覚を借りるための隠しスイッチ。
   *
   * display:none で隠すと描画されず触覚も返らないことがあるので、
   * 「描画はされるが見えず触れもしない」置き方にする。
   */
  ensureSwitch() {
    if (this.switchEl || !this.hasSwitchHaptics) return this.switchEl;
    const doc = this.doc;
    if (!doc || !doc.body || typeof doc.createElement !== 'function') return null;
    try {
      const label = doc.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;'
        + 'opacity:0;pointer-events:none;z-index:-1;overflow:hidden;';
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      doc.body.appendChild(label);
      this.switchEl = label;
    } catch {
      this.switchEl = null;
    }
    return this.switchEl;
  }

  // ------------------------------------------------------------ 鳴らす

  /**
   * 振動する。
   * @param {number|number[]} pattern ms、または [振動, 休み, 振動, ...]
   * @returns {boolean} どれかの手段に届いたか
   */
  play(pattern) {
    if (!this.enabled) return false;
    const segments = toSegments(pattern);
    if (!segments.length) return false;

    this.cancelTimers(); // 前のパターンは打ち切る（Vibration API と同じ振る舞い）

    let fired = false;
    if (this.hasVibrationApi) {
      try {
        fired = this.nav.vibrate(withMinPulse(segments)) !== false;
      } catch { /* 端末が拒んだら黙って次へ */ }
    } else if (this.playTaps(segments)) {
      fired = true;
    }
    if (this.playGamepad(segments)) fired = true;
    return fired;
  }

  /** iOS：隠しスイッチを予定どおりに叩く */
  playTaps(segments) {
    const label = this.ensureSwitch();
    if (!label) return false;
    const taps = toTaps(segments);
    if (!taps.length) return false;
    for (const at of taps) {
      if (at <= 0) this.tap();
      else this.timers.push(this.setTimer(() => this.tap(), at));
    }
    return true;
  }

  /** スイッチを 1 回切り替える。切り替わること自体が触覚の合図になる */
  tap() {
    const label = this.switchEl;
    if (!label) return;
    try { label.click(); } catch { /* 失敗しても遊びは止めない */ }
  }

  /**
   * ゲームパッド：振動の区間ごとに dual-rumble を流す。
   * 長い一撃ほど強く鳴らして、盤面の「重さ」を手元でも同じ順に並べる。
   */
  playGamepad(segments) {
    const pads = this.gamepads();
    if (!pads.length) return false;
    let t = 0;
    let fired = false;
    for (let i = 0; i < segments.length; i++) {
      const ms = segments[i];
      if (i % 2 === 1) { t += ms; continue; }
      if (ms <= 0) continue;
      const dur = Math.max(ms, MIN_PULSE_MS);
      const weight = Math.min(1, dur / 60);
      const effect = {
        duration: dur,
        weakMagnitude: 0.35 + weight * 0.5,
        strongMagnitude: weight * 0.8,
      };
      const run = () => {
        for (const pad of pads) {
          try { pad.vibrationActuator.playEffect('dual-rumble', effect); } catch { /* 無視 */ }
        }
      };
      if (t <= 0) run();
      else this.timers.push(this.setTimer(run, t));
      t += ms;
      fired = true;
    }
    return fired;
  }

  /** 予約済みの叩きを取り消す */
  cancelTimers() {
    for (const id of this.timers) this.clearTimer(id);
    this.timers.length = 0;
  }

  /** いま鳴っているものを止める（画面を離れるときなど） */
  stop() {
    this.cancelTimers();
    if (this.hasVibrationApi) {
      try { this.nav.vibrate(0); } catch { /* 無視 */ }
    }
  }
}
