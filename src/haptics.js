// 触覚（バイブレーション）。
//
// 端末ごとに震わせる手段がまったく違うので、ここにまとめてある。
//
//   ① Vibration API   navigator.vibrate。Android の Chrome / Firefox / Samsung など。
//                     [振動, 休み, 振動, ...] のパターンをそのまま渡せる唯一の道。
//                     鳴らしたい瞬間に鳴らせるので、音と同じ形に揃えられる。
//
//   ② 触覚の膜（iOS） 下の「iPhone では、鳴らすのではなく敷く」を参照。
//
//   ③ ゲームパッド    PC にコントローラが繋がっているとき。vibrationActuator に
//                     dual-rumble を流す。手元にモーターがあるならそこで鳴らす。
//
// ①〜③ のどれも持たない端末（多くのデスクトップ）は、震える部品が本当に無い
// ので何もしない。
//
// ---------------------------------------------------------------------------
// iPhone では、鳴らすのではなく「敷く」
//
// iOS には navigator.vibrate が無い（Safari も、ホーム画面に追加した PWA も）。
// 代わりに、iOS 17.4 以降の WebKit は <input type="checkbox" switch> が
// 切り替わるとシステムの触覚を返す。長らく「画面外の隠しスイッチを script から
// 叩く」形で借りられていたが、**iOS 26.5 で Apple がこれを塞いだ**。
//
// iPhone（Safari 26.6）で実測した結果:
//
//   ○ 見えるスイッチを指で切り替える
//   ○ ボタンに重ねた透明スイッチを指でタップ
//   ○ 透明スイッチの上を指でなぞる
//   × script から label.click()
//   × 指で押している最中（pointerdown の中）に script でトグル
//   × 指で踏んだ直後に script で連打
//
// 読み取れることは 1 つ ―― **指が直接スイッチに触れている操作だけが鳴る。**
// script から起こした変化は、ユーザー操作の最中であっても鳴らない。
//
// なので iOS では発想を裏返す。「鳴らしたい瞬間に鳴らす」のではなく、
// **触ってほしい場所に、本物のスイッチを透明にして敷いておく。**
// 指が盤面に触れてブロックを滑らせれば、その指自身がスイッチを動かし、
// システムが手ごたえを返す。こちらは一度敷くだけで、あとは何もしない。
//
// 引き換えに、iOS では次のことができない:
//   ・強さや長さを選べない（システムが決めた一撃だけ）
//   ・指が触れていない瞬間には鳴らせない（消えた・クリアした、など）
// これは抜け道の限界ではなく、Apple が意図して閉じた結果なので、
// 迂回しようとせず、できることの側で最善を尽くす。
// ---------------------------------------------------------------------------

/**
 * Android の実機では 5ms 前後の振動は指に届かない（モーターが立ち上がる前に
 * 指示が終わる）。細かい合図ほど「鳴らしたのに感じない」になるので下限を敷く。
 */
const MIN_PULSE_MS = 12;

/** 触覚の膜に付ける class。位置決めは styles.css の側に置いてある */
const VEIL_CLASS = 'haptic-veil';

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
    this.timers = [];       // ゲームパッドの区間ごとの予約
    this.watching = false;  // 画面を離れたときの後始末を仕掛けたか
  }

  // ------------------------------------------------------------ 端末を見る

  /** navigator.vibrate が使えるか（Android 系） */
  get hasVibrationApi() {
    return !!(this.nav && typeof this.nav.vibrate === 'function');
  }

  /**
   * スイッチの触覚が使えるか（＝ iOS か）。
   * `switch` は WebKit が IDL 属性として持つので、実装の有無をそのまま聞ける。
   *
   * 注意: これが真でも「script から鳴らせる」わけではない。iOS 26.5 以降で
   * 鳴るのは指が直接触れたときだけなので、判断材料としてだけ使う。
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

  /**
   * どの道で震わせるか。
   * 'vibration'（鳴らしたい瞬間に鳴らせる）／'ios-veil'（膜を敷いて指に鳴らしてもらう）
   * ／'gamepad'／'none'
   */
  get mode() {
    if (this.hasVibrationApi) return 'vibration';
    if (this.hasSwitchHaptics) return 'ios-veil';
    if (this.gamepads().length > 0) return 'gamepad';
    return 'none';
  }

  /** この端末で震えられるか。設定画面の但し書きに使う */
  get supported() {
    return this.mode !== 'none';
  }

  // ------------------------------------------------------------ 準備

  /** 最初のユーザー操作で呼ぶ */
  arm() {
    this.watchVisibility();
  }

  /**
   * 画面を離れたら、予約してある振動を捨てる。
   * 戻ってきた指と関係のない振動が後から来ると、ただの誤作動に感じられる。
   */
  watchVisibility() {
    if (this.watching || !this.doc || typeof this.doc.addEventListener !== 'function') return;
    this.watching = true;
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.hidden) this.stop();
    });
  }

  // ------------------------------------------------------------ 触覚の膜（iOS）

  /** この端末は「膜を敷く」側か（＝ script からは鳴らせないが、指になら鳴らせる） */
  needsVeil() {
    return this.enabled && !this.hasVibrationApi && this.hasSwitchHaptics;
  }

  /**
   * 触覚の膜を 1 枚こしらえる。**本物の** <input type="checkbox" switch> で、
   * 透明にして操作面に敷く。指がこれに直接触れることでシステムが手ごたえを返す。
   *
   * CSS で appearance を潰してはいけない。ネイティブのスイッチでなくなった
   * 時点で触覚も消える（見た目は同じなので気付きにくい）。
   *
   * @returns {Element|null}
   */
  createVeil() {
    if (!this.doc || typeof this.doc.createElement !== 'function') return null;
    try {
      const el = this.doc.createElement('input');
      el.type = 'checkbox';
      el.setAttribute('switch', '');
      el.className = VEIL_CLASS;
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
      return el;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ 鳴らす

  /**
   * 振動する。
   *
   * iOS では**何もしない** ―― script から鳴らす道が閉じているため。
   * その端末では createVeil() で敷いた膜が、指の操作そのものから鳴らす。
   *
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
    }
    if (this.playGamepad(segments)) fired = true;
    return fired;
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

  /** 予約済みの振動を取り消す */
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
