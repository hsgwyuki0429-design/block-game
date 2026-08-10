// 触覚（バイブレーション）。
//
// 「震える端末では必ず震える」ことを目標にした層。鳴らす側（audio.js）からは
// play(pattern) しか見えず、その端末に届く手段の選択はここに閉じてある。
//
//   ① Vibration API   navigator.vibrate。Android の Chrome / Firefox / Samsung など。
//                     [振動, 休み, 振動, ...] のパターンをそのまま渡せる唯一の道。
//
//   ② ボタンの触覚（iOS）
//                     iOS には navigator.vibrate が無く、iOS 26.5 以降は script から
//                     触覚を起こす道も塞がれている。実機で確かめた結論は 1 つ ――
//                     **指が直接スイッチに触れている操作だけが鳴る。**
//                     なのでボタンの中に透明なスイッチを 1 枚敷き、指がそれを
//                     踏むことで鳴らす。詳しくは createTapVeil() のコメント。
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

/** ボタンに敷く膜に付ける class。位置決めは styles.css の側に置いてある */
const VEIL_CLASS = 'haptic-tap';

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
    return this.mode !== 'none';
  }

  /**
   * どの道で震わせるか。
   * 'vibration'（鳴らしたい瞬間に鳴らせる）／'ios-taps'（ボタンを押した指にだけ返せる）
   * ／'gamepad'／'none'
   */
  get mode() {
    if (this.hasVibrationApi) return 'vibration';
    if (this.hasSwitchHaptics) return 'ios-taps';
    if (this.gamepads().length > 0) return 'gamepad';
    return 'none';
  }

  // ------------------------------------------------------------ 準備

  /** 最初のユーザー操作で呼ぶ */
  arm() {
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

  // ------------------------------------------------- ボタンの触覚（iOS）

  /** この端末は「指に踏ませる」側か（＝ script からは鳴らせないが、指になら鳴らせる） */
  needsTapVeil() {
    return this.enabled && !this.hasVibrationApi && this.hasSwitchHaptics;
  }

  /**
   * ボタンの中に敷く、透明な触覚の膜を 1 枚こしらえる。
   *
   * 中身は**本物の** <input type="checkbox" switch>。iOS 26.5 以降、触覚が鳴るのは
   * 「指が直接スイッチに触れたとき」だけなので、ボタンの面をこれで覆って、
   * 押した指自身に鳴らしてもらう。
   *
   * ボタンを壊さないために、置き方には理由がある:
   *
   *   ・**ボタンの子**として入れる。膜をタップしても click はボタンまで
   *     バブリングするので、ボタンの動作はそのまま生きる（転送は要らない）。
   *   ・inset: 0 の絶対配置。ボタン側は position: relative になるだけで、
   *     並びも大きさも変わらない。
   *   ・:active はボタン側にも掛かる（CSS の :active は祖先にも一致する）ので、
   *     押した見た目も失われない。
   *   ・disabled のボタンでは CSS で pointer-events を切る。押せないボタンが
   *     手ごたえだけ返すことのないように。
   *
   * **盤面には敷かない。** 以前これを盤面に敷いたところ、実機の WebKit では
   * スイッチ自身がタッチを掴んでしまい、ブロックを動かせなくなった。
   * ドラッグを伴う面には決して置かないこと。
   *
   * CSS で appearance を潰してもいけない。ネイティブのスイッチでなくなった
   * 時点で触覚も消える（透明なので見た目は変わらず、気付けない）。
   *
   * @returns {Element|null}
   */
  createTapVeil() {
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
   * その端末では createTapVeil() で敷いた膜が、ボタンを押した指から鳴らす。
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
