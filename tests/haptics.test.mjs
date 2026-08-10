// 触覚のテスト。
// 実機の震えは見られないので、「その端末で選べる手段に、正しい形で届いたか」を見る。

import test from 'node:test';
import assert from 'node:assert/strict';

import { Haptics } from '../src/haptics.js';

/** 差し替え用のタイマー。予約を溜めておいて、好きなときに流す */
function fakeClock() {
  const jobs = [];
  let next = 1;
  return {
    jobs,
    setTimeout: (fn, ms) => { jobs.push({ id: next, fn, ms }); return next++; },
    clearTimeout: (id) => {
      const i = jobs.findIndex((j) => j.id === id);
      if (i >= 0) jobs.splice(i, 1);
    },
    runAll() { const list = jobs.splice(0); for (const j of list) j.fn(); },
  };
}

/** iOS のふりをする最小の DOM。input に switch があることだけが本質 */
function fakeDom() {
  const clicks = [];
  const appended = [];
  const el = (tag) => ({
    tag,
    style: {},
    children: [],
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); },
    click() { clicks.push(this); },
  });
  const doc = {
    clicks,
    appended,
    createElement(tag) {
      const node = el(tag);
      if (tag === 'input') node.switch = false; // WebKit の IDL 属性
      return node;
    },
    body: { appendChild(c) { appended.push(c); } },
    hidden: false,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    emit(type) { for (const fn of this.listeners[type] || []) fn(); },
  };
  return doc;
}

/** switch を持たない DOM（Android / デスクトップ） */
function plainDom() {
  const doc = fakeDom();
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = create(tag);
    delete node.switch;
    return node;
  };
  return doc;
}

test('Android：navigator.vibrate にパターンをそのまま渡す', () => {
  const calls = [];
  const hap = new Haptics({
    navigator: { vibrate: (p) => { calls.push(p); return true; } },
    document: plainDom(),
  });
  assert.equal(hap.backend, 'vibration');
  assert.equal(hap.supported, true);
  assert.equal(hap.play([20, 30, 40]), true);
  assert.deepEqual(calls, [[20, 30, 40]]);
});

test('短すぎる振動は指に届く長さまで持ち上げる（休みは触らない）', () => {
  const calls = [];
  const hap = new Haptics({
    navigator: { vibrate: (p) => { calls.push(p); return true; } },
    document: plainDom(),
  });
  hap.play(6);
  assert.deepEqual(calls[0], [12]);
  hap.play([8, 4, 44]);
  assert.deepEqual(calls[1], [12, 4, 44], '休み（奇数番）は元のまま');
});

test('数値ひとつでも配列として渡る', () => {
  const calls = [];
  const hap = new Haptics({
    navigator: { vibrate: (p) => { calls.push(p); return true; } },
    document: plainDom(),
  });
  hap.play(30);
  assert.deepEqual(calls[0], [30]);
});

test('iOS：navigator.vibrate が無くても隠しスイッチで震える', () => {
  const doc = fakeDom();
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: {}, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });

  assert.equal(hap.backend, 'ios-switch');
  assert.equal(hap.supported, true);

  assert.equal(hap.play(10), true);
  assert.equal(doc.appended.length, 1, 'スイッチは 1 枚だけ作る');
  assert.equal(doc.appended[0].children[0].attrs.switch, '', 'switch 属性が要る');
  assert.equal(doc.clicks.length, 1, '先頭の一撃はその場で鳴らす');

  clock.runAll();
  assert.equal(doc.clicks.length, 1, '短い振動は 1 回で終わる');
});

test('iOS：休みを挟んだパターンは、間を空けた連打に翻訳される', () => {
  const doc = fakeDom();
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: {}, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });

  // land() と同じ形：短い前触れ → 間 → 長く重い本体
  hap.play([8, 24, 68]);
  assert.equal(doc.clicks.length, 1, '最初の一撃だけ即時');
  const times = clock.jobs.map((j) => j.ms);
  assert.deepEqual(times, [32, 66], '本体は頭と、途中でもう一度');

  clock.runAll();
  assert.equal(doc.clicks.length, 3);
});

test('iOS：長すぎるパターンでも叩く回数には上限がある', () => {
  const doc = fakeDom();
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: {}, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  hap.play([1000]);
  clock.runAll();
  assert.equal(doc.clicks.length, 6);
});

test('新しいパターンは、前のパターンの予約を打ち切る', () => {
  const doc = fakeDom();
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: {}, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  hap.play([10, 500, 10]);
  assert.equal(clock.jobs.length, 1);
  hap.play([10]);
  assert.equal(clock.jobs.length, 0, '古い予約は消えている');
});

test('切ってあるときは何もしない', () => {
  const calls = [];
  const hap = new Haptics({
    navigator: { vibrate: (p) => { calls.push(p); return true; } },
    document: plainDom(),
  });
  hap.enabled = false;
  assert.equal(hap.play(20), false);
  assert.equal(calls.length, 0);
});

test('ゲームパッドが繋がっていれば、そこでも鳴らす', () => {
  const effects = [];
  const pad = {
    connected: true,
    vibrationActuator: { playEffect: (type, opt) => { effects.push([type, opt]); } },
  };
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: { getGamepads: () => [null, pad] },
    document: plainDom(),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  assert.equal(hap.backend, 'gamepad');
  assert.equal(hap.play([40, 30, 40]), true);
  clock.runAll();
  assert.equal(effects.length, 2);
  assert.equal(effects[0][0], 'dual-rumble');
  assert.equal(effects[0][1].duration, 40);
});

test('震える部品が何も無い端末では、静かに何もしない', () => {
  const hap = new Haptics({ navigator: {}, document: plainDom() });
  assert.equal(hap.supported, false);
  assert.equal(hap.backend, 'none');
  assert.equal(hap.play([10, 20, 10]), false);
});

test('navigator も document も無い場所で壊れない（テストや SSR）', () => {
  const hap = new Haptics({ navigator: null, document: null });
  assert.equal(hap.supported, false);
  assert.doesNotThrow(() => hap.play(10));
  assert.doesNotThrow(() => hap.arm());
  assert.doesNotThrow(() => hap.stop());
});

test('画面を離れたら、予約してある叩きは捨てる', () => {
  const doc = fakeDom();
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: {}, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  hap.arm();
  hap.play([10, 300, 10]);
  assert.equal(clock.jobs.length, 1);

  doc.hidden = true;
  doc.emit('visibilitychange');
  assert.equal(clock.jobs.length, 0);

  const before = doc.clicks.length;
  clock.runAll();
  assert.equal(doc.clicks.length, before, '戻ってきてから後追いで鳴ったりしない');
});

test('stop() は予約を消し、鳴っている振動も止める', () => {
  const calls = [];
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: { vibrate: (p) => { calls.push(p); return true; } },
    document: plainDom(),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  hap.play([20, 30, 20]);
  hap.stop();
  assert.deepEqual(calls[calls.length - 1], 0);
  assert.equal(clock.jobs.length, 0);
});
