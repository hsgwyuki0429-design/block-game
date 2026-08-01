// 効果音。音源ファイルは持たず、WebAudio でその場で合成する。
//
// 音の設計は 2 種類だけ。
//
//   ウッドクリック  掴む・滑る・着地する・UI を押す ―― 操作すべて。
//                   乾いた「カチッ／コトン」。木片を叩いたときの、芯があって
//                   すぐ消える音。マリンバの丸みを少しだけ混ぜてある。
//                   操作が全部これになることで、プレイがリズムになる。
//
//   グラスシャター  消えた瞬間。薄い氷が砕けるような「シャラン」。
//                   非整数倍の高い partial を重ねると、鐘でも打楽器でもない
//                   「ガラス」の質感になる。連鎖するほど音程が階段状に上がる。
//
// ハプティクスは音と同じ関数の中で鳴らす。指と耳がずれない。
//
// iOS は最初のタップまで音を出せないので、unlock() を最初のポインタ操作で呼ぶ。

/** 音程の階段（ペンタトニック：外れた感じにならず、上がり続けても心地よい） */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

/** ガラスの部分音。整数倍から外すと「鐘」ではなく「ガラス」に聴こえる */
const GLASS_PARTIALS = [1, 2.41, 3.86, 5.62, 7.71, 9.94];

/**
 * ほぼ無音の WAV を作る（画面収録対策。理由は keepAlive のコメント）。
 * 完全な 0 ではなく最下位ビットだけを 22kHz で振っている ―― 人には聴こえず、
 * それでいて「無音だから」と再生を止められることもない。
 */
function silentLoopUrl() {
  const rate = 44100;
  const frames = rate >> 1; // 0.5 秒
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) v.setInt16(44 + i * 2, i & 1 ? 1 : -1, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this._enabled = true;
    this.haptics = true;
    this.keepAlive = null;
  }

  /**
   * サウンドの入切。切ったら「画面収録用の無音ループ」も止める
   * （鳴らさないのに音声セッションを占有しない）。
   */
  get enabled() { return this._enabled; }

  set enabled(v) {
    this._enabled = !!v;
    if (!this.keepAlive) return;
    if (this._enabled) this.keepAlive.play().catch(() => {});
    else this.keepAlive.pause();
  }

  /** 最初のユーザー操作で呼ぶ。以降いつでも鳴らせるようになる */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.keepAlive && this._enabled && this.keepAlive.paused) {
        this.keepAlive.play().catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // ノイズは使い回す（砕ける音とクリックの芯に使う）
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startKeepAlive();
  }

  /**
   * 画面収録に音が乗るようにする。
   *
   * iOS/Safari は WebAudio だけを鳴らしていると音声セッションが「環境音」扱いのままで、
   * 消音スイッチで黙るうえ、画面収録にも録音されない ―― 収録した動画が無音になる。
   * <audio> 要素で何かを再生し続けているあいだはセッションが「メディア再生」に上がり、
   * 同じセッションを共有する WebAudio の出力も、消音スイッチを無視して鳴り、収録される。
   *
   * そのための、ほぼ無音のループ。再生が止められても復帰できるように見張る。
   */
  startKeepAlive() {
    if (this.keepAlive || typeof Audio === 'undefined') return;
    try {
      const el = new Audio(silentLoopUrl());
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      this.keepAlive = el;
      if (this._enabled) el.play().catch(() => {});

      // タブに戻ってきたとき、OS に止められていたら鳴らし直す
      const revive = () => {
        if (!this._enabled || document.hidden) return;
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if (el.paused) el.play().catch(() => {});
      };
      document.addEventListener('visibilitychange', revive);
      el.addEventListener('pause', revive);
    } catch { /* 使えない環境では諦める（音は鳴る。収録に乗らないだけ） */ }
  }

  get ready() {
    return this._enabled && this.ctx && this.master;
  }

  /** 単音。type と包絡を指定して鳴らす */
  tone(freq, { type = 'sine', gain = 0.2, attack = 0.004, decay = 0.25, delay = 0, glide = 0 } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    // glide > 0 なら少し上から落ちてくる。木を叩いた瞬間の「詰まり」がこれで出る
    osc.frequency.setValueAtTime(freq * (1 + glide), t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
  }

  /** ノイズをフィルタ越しに一瞬だけ */
  burst({ gain = 0.12, decay = 0.14, delay = 0, type = 'highpass', freq = 1200, q = 0.7 } = {}) {
    if (!this.ready || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  /**
   * 乾いたウッドクリック。この音がゲーム中のすべての操作音になる。
   *
   *   ・帯域を絞ったノイズの一撃  = 木を叩いた「カチッ」という芯
   *   ・上から落ちてくる基音      = 木片の詰まった鳴り
   *   ・4 倍音を少しだけ          = マリンバ寄りの丸み
   */
  wood(freq = 520, { gain = 1, decay = 0.11, delay = 0 } = {}) {
    this.burst({
      type: 'bandpass',
      freq: freq * 3.4,
      q: 1.6,
      gain: 0.09 * gain,
      decay: 0.022,
      delay,
    });
    this.tone(freq, { type: 'triangle', gain: 0.17 * gain, attack: 0.002, decay, delay, glide: 0.06 });
    this.tone(freq * 4, { type: 'sine', gain: 0.035 * gain, attack: 0.002, decay: decay * 0.5, delay });
  }

  /**
   * 薄いガラス／氷が砕ける音。
   * 非整数倍の partial を上から順に、ほんの少しずつ遅らせて散らす。
   */
  glass(root = 1046.5, { gain = 1, spread = 1 } = {}) {
    GLASS_PARTIALS.forEach((mul, i) => {
      this.tone(root * mul, {
        type: 'sine',
        gain: (0.15 / (1 + i * 0.9)) * gain,
        attack: 0.002,
        decay: (0.42 - i * 0.045) * spread,
        delay: i * 0.008 * spread,
      });
    });
    // 破片が散る「シャラン」
    this.burst({ type: 'highpass', freq: 5200, q: 0.7, gain: 0.1 * gain, decay: 0.26 * spread });
    this.burst({ type: 'highpass', freq: 9000, q: 0.7, gain: 0.06 * gain, decay: 0.4 * spread, delay: 0.03 });
    // 炭酸が弾ける「シュワッ」
    this.burst({ type: 'bandpass', freq: 3000, q: 0.5, gain: 0.05 * gain, decay: 0.18 * spread, delay: 0.01 });
  }

  // ---------------------------------------------------------------- 効果音

  /** ブロックをつかんだ合図 */
  tap() {
    this.wood(880, { gain: 0.42, decay: 0.06 });
    this.vibrate(5);
  }

  /** UI のボタン。盤面と同じ手触りに揃える */
  click() {
    this.wood(700, { gain: 0.5, decay: 0.07 });
    this.vibrate(6);
  }

  /** 滑って壁にぶつかった瞬間。距離が長いほど低く重い音 */
  land(distance = 1) {
    const d = Math.min(distance, 10);
    this.wood(430 - d * 18, { gain: 1, decay: 0.13 + d * 0.006 });
    this.tone(96, { type: 'sine', gain: 0.07, attack: 0.002, decay: 0.09 });
    this.vibrate(Math.round(7 + d));
  }

  /**
   * 消えた瞬間。連鎖数 combo が増えるほど音程が上がっていく。
   * @param {number} combo 0 から始まる連続消しの回数
   * @param {number} pieces まとめて消えたブロック数（多いほど厚みを増す）
   */
  pop(combo = 0, pieces = 2) {
    const step = LADDER[Math.min(combo, LADDER.length - 1)];
    const root = 1046.5 * Math.pow(2, step / 12); // C6 から上へ
    // 階段を「聴かせる」のはウッドクリックの側。ガラスはその上に散る
    this.wood(523.25 * Math.pow(2, step / 12), { gain: 0.75, decay: 0.1 });
    this.glass(root, { gain: 1, spread: pieces >= 3 ? 1.25 : 1 });
    this.vibrate(pieces >= 3 ? [12, 24, 18] : 13);
  }

  /** 動かせない方向。木を押さえて叩いたような、詰まった短い音 */
  invalid() {
    this.wood(150, { gain: 0.7, decay: 0.05 });
    this.vibrate([9, 36, 9]);
  }

  /** 全消し。ウッドクリックの階段を駆け上がって、最後にガラスが散る */
  win() {
    [0, 4, 7, 12, 16].forEach((s, i) => {
      this.wood(523.25 * Math.pow(2, s / 12), { gain: 0.8, decay: 0.16, delay: i * 0.085 });
    });
    this.glass(2093, { gain: 1.15, spread: 1.6 });
    this.burst({ type: 'highpass', freq: 6000, gain: 0.07, decay: 0.9, delay: 0.4 });
    this.vibrate([14, 34, 14, 34, 26]);
  }

  /** 1手戻した合図。下がる2つのクリック */
  undo() {
    this.wood(560, { gain: 0.5, decay: 0.07 });
    this.wood(400, { gain: 0.45, decay: 0.09, delay: 0.07 });
    this.vibrate(6);
  }

  vibrate(pattern) {
    if (!this.haptics) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* 非対応端末は黙って無視 */ }
    }
  }
}
