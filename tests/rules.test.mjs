// ルール（スライド・同色接触消去・重力なし）のテスト

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { PIECES, DIRS, DIR_KEYS } from '../src/shapes.js';

const put = (b, color, cells) => b.addPiece(color, cells);

test('ブロックは壁にぶつかるまで滑る（距離は選べない）', () => {
  const b = new Board(12);
  const p = put(b, 0, [[3, 3], [4, 3]]);
  assert.equal(b.slideDistance(p.id, 'left'), 3);
  assert.equal(b.slideDistance(p.id, 'right'), 7);
  assert.equal(b.slideDistance(p.id, 'up'), 3);
  assert.equal(b.slideDistance(p.id, 'down'), 8);
});

test('他のブロックの手前で止まる', () => {
  const b = new Board(12);
  const p = put(b, 0, [[0, 0]]);
  put(b, 1, [[5, 0]]);
  assert.equal(b.slideDistance(p.id, 'right'), 4);
  b.movePiece(p.id, 'right', 4);
  assert.deepEqual(p.cells, [[4, 0]]);
});

test('自分が今いるセルは通過できる（剛体としての移動）', () => {
  const b = new Board(12);
  // 横長の I ピース。右へ滑るとき自分の元セルは邪魔にならない
  const p = put(b, 0, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.equal(b.slideDistance(p.id, 'right'), 8);
});

test('いずれか1セルでも塞がれれば全体が止まる', () => {
  const b = new Board(12);
  const p = put(b, 0, [[0, 0], [0, 1], [0, 2], [0, 3]]); // 縦 I
  put(b, 1, [[3, 2]]);                                    // 3列目に障害物
  assert.equal(b.slideDistance(p.id, 'right'), 2);
});

test('単体のブロックは自己消去しない（消去の単位はブロック）', () => {
  const b = new Board(12);
  // 4セルすべて同色だが「1つの塊」なので消えない
  const p = put(b, 0, [[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.equal(b.colorGroup(p.id).length, 1);
  assert.equal(b.findAllTouchingGroups().length, 0);
});

test('同色ブロックが接触すると、繋がったグループ全体が消える', () => {
  const b = new Board(12);
  const mover = put(b, 2, [[0, 5]]);
  put(b, 2, [[5, 5]]);
  const res = b.applyMove(mover.id, 'right');
  assert.equal(res.steps, 4);
  assert.equal(res.cleared.length, 2);
  assert.equal(b.pieceCount, 0);
});

test('違う色は触れても消えない', () => {
  const b = new Board(12);
  const mover = put(b, 2, [[0, 5]]);
  put(b, 3, [[5, 5]]);
  const res = b.applyMove(mover.id, 'right');
  assert.equal(res.cleared.length, 0);
  assert.equal(b.pieceCount, 2);
});

test('斜めの接触では消えない', () => {
  const b = new Board(12);
  const mover = put(b, 1, [[0, 5]]);
  put(b, 4, [[6, 5]]);   // 止めるための別色 -> mover は (5,5) で止まる
  put(b, 1, [[6, 6]]);   // (5,5) から見て斜め
  const res = b.applyMove(mover.id, 'right');
  assert.equal(res.steps, 5);
  assert.equal(res.cleared.length, 0);
});

test('橋渡し: 離れた同色3つを1手で繋いで消す', () => {
  const b = new Board(12);
  //  [赤A] … [赤B(動かす)] … [赤C]  を一直線に並べ、B を滑らせて A と C を繋ぐ
  put(b, 0, [[0, 5]]);            // A
  const bridge = put(b, 0, [[8, 5]]); // 動かすブロック
  put(b, 0, [[2, 5]]);            // C
  const res = b.applyMove(bridge.id, 'left');
  assert.equal(res.steps, 5);            // C の右隣で止まる
  assert.equal(res.cleared.length, 2);   // C と自分（A には届かない）
  assert.equal(b.pieceCount, 1);
});

test('動かしたブロックがハブになり、隣接した同色すべてが消える（星型）', () => {
  const b = new Board(12);
  const hub = put(b, 5, [[5, 0]]);
  put(b, 5, [[4, 5]]);
  put(b, 5, [[6, 5]]);
  put(b, 5, [[5, 6]]);
  const res = b.applyMove(hub.id, 'down');
  assert.equal(res.steps, 5);
  assert.equal(res.cleared.length, 4);
  assert.equal(b.pieceCount, 0);
});

test('重力なし: 消去後も他のブロックは落ちない', () => {
  const b = new Board(12);
  const mover = put(b, 2, [[0, 11]]);
  put(b, 2, [[5, 11]]);
  const floating = put(b, 3, [[3, 0]]);
  b.applyMove(mover.id, 'right');
  assert.deepEqual(floating.cells, [[3, 0]]);
});

test('消去で生まれた空きマスが、次のスライドの通路になる', () => {
  const b = new Board(12);
  // 5行目を横一列にほぼ埋める（別色のブロックが通路を塞いでいる）
  const wall = put(b, 1, [[6, 5]]);
  const partner = put(b, 1, [[8, 5]]);
  const traveler = put(b, 4, [[0, 5]]);
  put(b, 3, [[10, 5]]);

  assert.equal(b.slideDistance(traveler.id, 'right'), 5); // 壁の手前で止まる
  b.applyMove(wall.id, 'right');                          // 同色に触れて2つとも消える
  assert.equal(b.pieceCount, 2);
  assert.equal(b.slideDistance(traveler.id, 'right'), 9); // 通路が開いた
});

test('不変条件: どの手の直後も同色は隣接していない', () => {
  const b = new Board(12);
  const a = put(b, 0, [[0, 0]]);
  put(b, 0, [[5, 0]]);
  put(b, 1, [[0, 4]]);
  b.applyMove(a.id, 'right');
  assert.equal(b.hasSameColorContact(), false);
});

test('同色ペアは、直接ぶつけられなくても通路を作れば消せる', () => {
  const b = new Board(4);
  // 同色2つが対角。1手では触れないが、2手あれば必ず揃う（＝詰みではない）
  const a = put(b, 0, [[0, 0]]);
  const c = put(b, 0, [[3, 3]]);
  assert.equal(b.findClearingMoves().length, 0);

  b.applyMove(a.id, 'down');            // 左下へ。まだ触れない
  assert.equal(b.pieceCount, 2);
  const res = b.applyMove(c.id, 'left'); // 左端まで滑って隣接 -> 2つとも消える
  assert.equal(res.cleared.length, 2);
  assert.equal(b.isEmpty, true);
});

test('スナップショットの保存と復元', () => {
  const b = new Board(12);
  const p = put(b, 3, [[2, 2], [3, 2]]);
  const snap = b.snapshot();
  b.movePiece(p.id, 'right', 3);
  assert.deepEqual(p.cells, [[5, 2], [6, 2]]);
  b.restore(snap);
  assert.deepEqual(b.pieces.get(p.id).cells, [[2, 2], [3, 2]]);
  assert.equal(b.at(2, 2), p.id);
  assert.equal(b.at(5, 2), -1);
});

test('simulate は盤面を変更しない', () => {
  const b = new Board(12);
  const mover = put(b, 2, [[0, 5]]);
  put(b, 2, [[5, 5]]);
  const before = b.fingerprint();
  const r = b.simulate(mover.id, 'right');
  assert.equal(r.steps, 4);
  assert.equal(r.cleared.length, 2);
  assert.equal(r.clearedCells, 2);
  assert.equal(b.fingerprint(), before);
});

test('ブロックは大小の長方形。全向きが揃っていて重複が無い', () => {
  assert.ok(PIECES.length >= 8, `形が ${PIECES.length} 通りしかない`);
  const seen = new Set();
  for (const shape of PIECES) {
    // 長方形なので「幅×高さ = マス数」がぴったり合う
    assert.equal(shape.cells.length, shape.w * shape.h, `${shape.name} が長方形でない`);
    assert.ok(shape.w >= 1 && shape.h >= 1);
    const key = `${shape.w}x${shape.h}`;
    assert.equal(seen.has(key), false, `${key} が重複している`);
    seen.add(key);
  }
  // 縦横比の違う形が揃っている（正方形だけ・棒だけ、にはなっていない）
  assert.ok(PIECES.some((s) => s.w === s.h), '正方形が無い');
  assert.ok(PIECES.some((s) => s.w > s.h), '横長が無い');
  assert.ok(PIECES.some((s) => s.h > s.w), '縦長が無い');
});

test('方向ベクトルは4つとも単位ベクトル', () => {
  assert.equal(DIR_KEYS.length, 4);
  for (const k of DIR_KEYS) {
    const d = DIRS[k];
    assert.equal(Math.abs(d.x) + Math.abs(d.y), 1);
  }
});
