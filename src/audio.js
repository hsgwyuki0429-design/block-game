// 効果音。音源ファイルは持たず、WebAudio でその場で合成する。
//
// いちばん大事なのは**ブロックを動かした音**なので、そこだけ独立した設計にしてある。
//
//   石を押す（slide → land）
//                   このゲームで唯一「重さ」を伝える音。押し出しの抵抗 →
//                   引きずる摩擦 → ぶつかって沈む衝撃、の3段階で作る。
//                   軽い「カチッ」で済ませると、盤面が紙のように感じられて
//                   「壁を押しのけている」実感が消える。
//                   詳しくは slide() / land() のコメントに書いた。
//
//   ウッドクリック  掴む・UI を押す。乾いた「カチッ」。木片を叩いたときの、
//                   芯があってすぐ消える音。操作の合図だけを担う。
//
//   グラスシャター  消えた瞬間。薄い氷が砕けるような「シャラン」。
//                   非整数倍の高い partial を重ねると、鐘でも打楽器でもない
//                   「ガラス」の質感になる。連鎖するほど音程が階段状に上がる。
//
//   低いほめ音      解法どおりに進んでいるときの相づち。低く、丸く、短い和音。
//                   祝う音ではないので、消去音より下の音域に置いて重ならせない。
//
// ハプティクスは音と同じ関数の中で鳴らす。指と耳がずれない。
// どの端末で震わせるかは haptics.js に任せてある（iOS には navigator.vibrate が
// 無いので、そこだけ別の道を通る）。
//
// iOS は最初のタップまで音を出せないので、unlock() を最初のポインタ操作で呼ぶ。

import { Haptics } from './haptics.js';

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
    this.hap = new Haptics();
    this.keepAlive = null;
  }

  /** 触覚の入切。呼ぶ側は今までどおり sound.haptics だけを見ればよい */
  get haptics() { return this.hap.enabled; }

  set haptics(v) { this.hap.enabled = !!v; }

  /** この端末に震える部品があるか（設定画面の但し書きに使う） */
  get hapticsSupported() { return this.hap.supported; }

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

  /**
   * 触覚だけを起こす。音と違って AudioContext が要らないので、
   * サウンドを切っている人や、まだボタンに触れていない人にも先に効かせる。
   */
  armHaptics() {
    this.hap.arm();
  }

  /** 最初のユーザー操作で呼ぶ。以降いつでも鳴らせるようになる */
  unlock() {
    this.hap.arm();
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
   * 沈み込む低音。「重い」の芯はこれ 1 本で決まる。
   *
   * 同じ低さでも、一定の周波数を鳴らすと "ブーッ" というただの低音にしかならない。
   * 上から下へ落とすと、はじめて**質量のあるものが着いた**ように聴こえる ――
   * 実際の衝突音でも、材料がたわんで戻るあいだに基音が下がっていく。
   * 落とし切るまでの時間を decay より短くしてあるのは、下がりきったあとに
   * 「residual（余韻）」を残したいから。ここが無いと音が痩せる。
   */
  thump(from, to, { gain = 0.5, decay = 0.4, delay = 0, type = 'sine' } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, to), t + decay * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.03);
  }

  /**
   * 引きずる摩擦。ブロックが滑っているあいだだけ鳴る。
   *
   * ノイズをループさせ、ローパスの角を「開いて閉じる」ように動かす。
   * 開くところが加速、閉じるところが減速に聴こえるので、
   * 目で見えている滑走とひとつながりの動きになる。
   * 帯域を 600Hz 以下に抑えているのが要点 ―― 上が出ると砂や紙になってしまい、
   * 石や木の塊には聴こえない。
   */
  rumble(duration = 0.3, { gain = 1 } = {}) {
    if (!this.ready || !this.noise) return;
    const t = this.ctx.currentTime;
    const dur = Math.max(0.07, duration);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.45 + Math.random() * 0.12;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(210, t);
    lp.frequency.linearRampToValueAtTime(600, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(300, t + dur);

    // ざらつきの芯。低い帯域をひとつ持ち上げると「ゴロゴロ」が出る
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 150;
    bp.Q.value = 1.1;
    bp.gain.value = 7;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.055 * gain), t + 0.05);
    g.gain.setValueAtTime(0.055 * gain, t + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(lp);
    lp.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  /**
   * 乾いたウッドクリック。掴む合図と UI のボタンに使う。
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

  /** ブロックをつかんだ合図。掴むのは重い塊なので、低く short に */
  tap() {
    this.wood(430, { gain: 0.4, decay: 0.055 });
    this.thump(150, 104, { gain: 0.14, decay: 0.1 });
    this.vibrate(7);
  }

  /** UI のボタン。盤面の重さとは切り離した、軽い操作音 */
  click() {
    this.wood(700, { gain: 0.5, decay: 0.07 });
    this.vibrate(6);
  }

  /**
   * 押し出して滑り始めた瞬間 ―― と、滑っているあいだ。
   *
   * 「重いものを動かした」感じは、着地の一撃だけでは出ない。動き出しの抵抗と、
   * 動いているあいだ鳴りっぱなしの摩擦があって、はじめて**ぶつかった音に意味が出る**。
   * 摩擦は滑走アニメと同じ長さで鳴らして、音が先に終わったり残ったりしないようにする。
   *
   * @param {number} distance 滑るマス数（多いほど重く長い）
   * @param {number} duration 滑走アニメの長さ（秒）
   */
  slide(distance = 1, duration = 0.3) {
    const d = Math.min(distance, 10);
    const w = Math.min(1, d / 8); // 0..1 の「重さ」
    // 押し出しの抵抗。低く短い一撃で、動き出しの "グッ" を作る
    this.thump(132 - w * 22, 80 - w * 14, { gain: 0.2 + w * 0.14, decay: 0.14 });
    this.burst({ type: 'lowpass', freq: 320, q: 0.8, gain: 0.07 + w * 0.03, decay: 0.05 });
    this.rumble(duration, { gain: 0.55 + w * 0.8 });
    this.vibrate(Math.round(5 + d * 1.4));
  }

  /**
   * 滑って壁にぶつかって止まった瞬間 ―― この音がこのゲームの手触りを決める。
   *
   * 重さは 5 層の重ね方で作る。どれか 1 つでも抜けると軽くなる:
   *
   *   ① 沈む芯   100Hz 台から 40Hz 台へ落ちる正弦波。腹に来る「ドスッ」
   *   ② 胴鳴り   塊そのものの質量。三角波を少し上から落として詰まりを出す
   *   ③ 接触面   低く絞ったノイズの一撃。木と木がぶつかる面の「ゴッ」
   *   ④ 輪郭     ごく短い中高域を一撃だけ。**これが無いと低音がぼやけて、
   *              重いのではなく「こもった」音になる**。混ぜるのは一瞬でいい
   *   ⑤ 余韻     受け止めた板が残す低い響き。ここで「置かれた」と分かる
   *
   * 距離が長いほど低く・長く・強くなる。10マス滑らせた1手が、
   * 1マスの1手と同じ音で終わらないようにするため。
   */
  land(distance = 1) {
    const d = Math.min(distance, 10);
    const w = Math.min(1, d / 8);
    const decay = 0.4 + w * 0.3;

    this.thump(102 - w * 20, 44 - w * 10, { gain: 0.5 + w * 0.4, decay });                                  // ①
    this.tone(166 - w * 44, { type: 'triangle', gain: 0.26, attack: 0.003, decay: 0.19 + w * 0.1, glide: 0.16 }); // ②
    this.burst({ type: 'lowpass', freq: 400 + w * 160, q: 0.9, gain: 0.19 + w * 0.06, decay: 0.075 });      // ③
    this.burst({ type: 'bandpass', freq: 1900, q: 1.5, gain: 0.045, decay: 0.016 });                        // ④
    this.tone(58, { type: 'sine', gain: 0.09 + w * 0.07, attack: 0.02, decay: 0.46 + w * 0.3, delay: 0.02 }); // ⑤

    // 触覚も同じ形にする。短い前触れ → 間 → 長く重い本体
    this.vibrate([8, 24, Math.round(20 + d * 6)]);
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

  /**
   * 解法どおりに進んでいる／解に近づいたときの相づち。
   *
   * 祝う音ではない ―― 祝ってしまうと、最後にクリアしたときの音が軽くなる。
   * 消去音（C6 まわり）よりずっと下の F3 に完全五度を重ねただけの、
   * 低くて丸い和音にしてある。減衰も長めで、鳴っても手を止めさせない。
   */
  praise() {
    const root = 174.61; // F3
    [1, 1.5, 2].forEach((mul, i) => {
      this.tone(root * mul, {
        type: 'sine', gain: 0.17 / (1 + i * 0.4), attack: 0.024, decay: 0.66, delay: i * 0.045,
      });
      this.tone(root * mul * 2, {
        type: 'triangle', gain: 0.035 / (1 + i * 0.5), attack: 0.02, decay: 0.34, delay: i * 0.045,
      });
    });
    // 和音だけだと始まりがぼやける。輪郭に低いウッドをひとつ置く
    this.wood(262, { gain: 0.34, decay: 0.14 });
    this.vibrate([10, 40, 14]);
  }

  /** 動かせない方向。重い塊が動かず、押した力だけが返ってくる詰まった音 */
  invalid() {
    this.thump(92, 68, { gain: 0.38, decay: 0.13 });
    this.burst({ type: 'lowpass', freq: 300, q: 0.9, gain: 0.13, decay: 0.055 });
    this.wood(130, { gain: 0.5, decay: 0.05 });
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
    this.hap.play(pattern);
  }
}
