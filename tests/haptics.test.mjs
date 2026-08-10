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
  assert.equal(hap.mode, 'vibration');
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

test('iOS：navigator.vibrate が無ければ「指に踏ませる」側に回る', () => {
  const hap = new Haptics({ navigator: {}, document: fakeDom() });
  assert.equal(hap.mode, 'ios-taps');
  assert.equal(hap.supported, true, '震えられないわけではない（指が触れれば鳴る）');
  assert.equal(hap.needsTapVeil(), true);
});

test('iOS：膜は本物のネイティブスイッチである', () => {
  const hap = new Haptics({ navigator: {}, document: fakeDom() });
  const veil = hap.createTapVeil();
  assert.equal(veil.tag, 'input');
  assert.equal(veil.type, 'checkbox');
  assert.equal(veil.attrs.switch, '', 'switch 属性が無いとただのチェックボックス');
  assert.equal(veil.className, 'haptic-tap');
  assert.equal(veil.tabIndex, -1);
  assert.equal(veil.attrs['aria-hidden'], 'true');
});

test('iOS：script からは鳴らそうとしない（26.5 で塞がれた道は叩かない）', () => {
  const doc = fakeDom();
  const clock = fakeClock();
  const hap = new Haptics({
    navigator: {}, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  assert.equal(hap.play([8, 24, 44]), false, '届く先が無いことを正直に返す');
  assert.equal(clock.jobs.length, 0, '鳴らないものを予約しない');
  assert.equal(doc.clicks.length, 0, 'スイッチを script から叩かない');
});

test('バイブレーションを切ったら膜は要らない', () => {
  const hap = new Haptics({ navigator: {}, document: fakeDom() });
  assert.equal(hap.needsTapVeil(), true);
  hap.enabled = false;
  assert.equal(hap.needsTapVeil(), false);
});

test('Android では膜を敷かない（鳴らしたい瞬間に鳴らせるので要らない）', () => {
  const hap = new Haptics({
    navigator: { vibrate: () => true }, document: fakeDom(),
  });
  assert.equal(hap.mode, 'vibration');
  assert.equal(hap.needsTapVeil(), false);
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
  assert.equal(hap.mode, 'gamepad');
  assert.equal(hap.play([40, 30, 40]), true);
  clock.runAll();
  assert.equal(effects.length, 2);
  assert.equal(effects[0][0], 'dual-rumble');
  assert.equal(effects[0][1].duration, 40);
});

test('震える部品が何も無い端末では、静かに何もしない', () => {
  const hap = new Haptics({ navigator: {}, document: plainDom() });
  assert.equal(hap.supported, false);
  assert.equal(hap.mode, 'none');
  assert.equal(hap.play([10, 20, 10]), false);
});

test('navigator も document も無い場所で壊れない（テストや SSR）', () => {
  const hap = new Haptics({ navigator: null, document: null });
  assert.equal(hap.supported, false);
  assert.equal(hap.createTapVeil(), null);
  assert.doesNotThrow(() => hap.play(10));
  assert.doesNotThrow(() => hap.arm());
  assert.doesNotThrow(() => hap.stop());
});

test('画面を離れたら、予約してある振動は捨てる', () => {
  const doc = plainDom();
  const clock = fakeClock();
  const pad = { connected: true, vibrationActuator: { playEffect: () => {} } };
  const hap = new Haptics({
    navigator: { getGamepads: () => [pad] },
    document: doc,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  hap.arm();
  hap.play([10, 300, 10]);
  assert.equal(clock.jobs.length, 1);

  doc.hidden = true;
  doc.emit('visibilitychange');
  assert.equal(clock.jobs.length, 0, '戻ってきてから後追いで鳴ったりしない');
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
