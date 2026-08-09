// 画面のふちから始まるスワイプで「前の画面に戻る」のを止める。
//
// iOS Safari の戻る/進むジェスチャ（左端・右端から横に払う）は touch-action や
// overscroll-behavior では止まらない。唯一効くのが「端から始まった touchstart を
// preventDefault する」ことなので、ここだけ手で面倒を見る。
//
// ただし全部を止めると副作用が大きい:
//   - ボタンの上で touchstart を打ち消すと、iOS では click が発火しなくなる
//   - 横スクロールする箱の中で打ち消すと、スクロールできなくなる
// なので「端の帯の中」かつ「押した先が操作部品でも横スクロール領域でもない」
// ときだけ打ち消す。帯は 24px ―― ブラウザがジェスチャと判定する幅とほぼ同じで、
// 盤面の操作を邪魔しない程度に狭い。

/** 端から何 px までをジェスチャの帯とみなすか */
const EDGE_ZONE = 24;

/** ここを押しているときは打ち消さない（タップやスクロールを壊すため） */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [contenteditable="true"]';

/** 横スクロールできる箱の中か（中身がはみ出しているものだけ数える） */
function inScrollerX(node) {
  for (let el = node; el instanceof Element; el = el.parentElement) {
    if (el.scrollWidth - el.clientWidth <= 1) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll') return true;
  }
  return false;
}

/**
 * 端スワイプによる履歴移動を止める。
 * @param {Document|HTMLElement} [root] 監視する対象。既定は document
 */
export function attachEdgeGuard(root = document) {
  // 打ち消した指。iOS は touchstart だけだと払い切られることがあるので、
  // 同じ指の touchmove も続けて打ち消す
  let guardedTouch = null;

  root.addEventListener('touchstart', (e) => {
    guardedTouch = null;
    // 2 本目以降（ピンチなど）はブラウザの戻るジェスチャにならない
    if (e.touches.length !== 1) return;

    const t = e.touches[0];
    const w = window.innerWidth;
    const nearEdge = t.clientX <= EDGE_ZONE || t.clientX >= w - EDGE_ZONE;
    if (!nearEdge) return;

    const target = e.target;
    if (target instanceof Element) {
      if (target.closest(INTERACTIVE)) return;
      if (inScrollerX(target)) return;
    }

    guardedTouch = t.identifier;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  root.addEventListener('touchmove', (e) => {
    if (guardedTouch == null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === guardedTouch) {
        if (e.cancelable) e.preventDefault();
        return;
      }
    }
  }, { passive: false });

  const clear = () => { guardedTouch = null; };
  root.addEventListener('touchend', clear);
  root.addEventListener('touchcancel', clear);
}
