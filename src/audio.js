// 効果音。音源ファイルは持たず、WebAudio でその場で合成する。
//
// 狙い:
//   着地音  マリンバのような丸い「コトン」。置く行為そのものを心地よいリズムにする
//   消去音  氷が砕けるような「シャラン」。溜まったものが解ける爽快感
//   連鎖音  連続で消すたびに音程が階段状に上がる。「次の音が聴きたい」を作る
//
// iOS は最初のタップまで音を出せないので、unlock() を最初のポインタ操作で呼ぶ。

/** 音程の階段（ペンタトニック：外れた感じにならず、上がり続けても心地よい） */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = true;
    this.haptics = true;
  }

  /** 最初のユーザー操作で呼ぶ。以降いつでも鳴らせるようになる */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
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

    // ノイズは使い回す（砕ける音とアタックの芯に使う）
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get ready() {
    return this.enabled && this.ctx && this.master;
  }

  /** 単音。type と包絡を指定して鳴らす */
  tone(freq, { type = 'sine', gain = 0.2, attack = 0.004, decay = 0.25, delay = 0, detune = 0 } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
  }

  /** ノイズをフィルタ越しに一瞬だけ */
  burst({ gain = 0.12, decay = 0.14, delay = 0, hp = 1200, q = 0.7 } = {}) {
    if (!this.ready || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
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

  /** ブロックをつかんだ合図 */
  tap() {
    this.tone(660, { type: 'sine', gain: 0.055, decay: 0.07 });
  }

  /** 滑って壁にぶつかった瞬間。距離が長いほど低く重い音 */
  land(distance = 1) {
    const f = 300 - Math.min(distance, 8) * 14;
    this.tone(f, { type: 'triangle', gain: 0.18, decay: 0.2 });
    this.tone(f * 3.02, { type: 'sine', gain: 0.05, decay: 0.1 });
    this.burst({ gain: 0.05, decay: 0.05, hp: 1800 });
    this.vibrate(8);
  }

  /**
   * 消えた瞬間。連鎖数 combo が増えるほど音程が上がっていく。
   * @param {number} combo 0 から始まる連続消しの回数
   * @param {number} pieces まとめて消えたブロック数（多いほど厚みを増す）
   */
  pop(combo = 0, pieces = 2) {
    const step = LADDER[Math.min(combo, LADDER.length - 1)];
    const root = 523.25 * Math.pow(2, step / 12); // C5 から上へ
    this.tone(root, { type: 'sine', gain: 0.2, decay: 0.34 });
    this.tone(root * 1.5, { type: 'sine', gain: 0.11, decay: 0.28, delay: 0.012 });
    this.tone(root * 2.02, { type: 'sine', gain: 0.07, decay: 0.22, delay: 0.024 });
    this.burst({ gain: 0.1, decay: 0.18, hp: 2600 });
    if (pieces >= 3) {
      this.tone(root * 3, { type: 'sine', gain: 0.06, decay: 0.3, delay: 0.05 });
      this.burst({ gain: 0.07, decay: 0.24, hp: 3800, delay: 0.05 });
    }
    this.vibrate(pieces >= 3 ? [12, 26, 16] : 14);
  }

  /** 動かせない方向。低く短く突き放す */
  invalid() {
    this.tone(120, { type: 'sine', gain: 0.12, decay: 0.1 });
    this.vibrate([10, 40, 10]);
  }

  /** 全消し。上がっていくアルペジオ */
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone(f, { type: 'sine', gain: 0.2, decay: 0.5, delay: i * 0.09 });
      this.tone(f * 2, { type: 'sine', gain: 0.06, decay: 0.4, delay: i * 0.09 });
    });
    this.burst({ gain: 0.08, decay: 0.5, hp: 2600, delay: 0.25 });
    this.vibrate([16, 40, 16, 40, 30]);
  }

  /** 詰み。下がっていく2音 */
  dead() {
    this.tone(330, { type: 'triangle', gain: 0.16, decay: 0.28 });
    this.tone(247, { type: 'triangle', gain: 0.16, decay: 0.5, delay: 0.14 });
    this.vibrate([30, 60, 30]);
  }

  /** 1手戻した合図 */
  undo() {
    this.tone(392, { type: 'sine', gain: 0.1, decay: 0.14 });
    this.tone(294, { type: 'sine', gain: 0.1, decay: 0.2, delay: 0.06 });
  }

  vibrate(pattern) {
    if (!this.haptics) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* 非対応端末は黙って無視 */ }
    }
  }
}
