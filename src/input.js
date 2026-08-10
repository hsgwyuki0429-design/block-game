// 入力。スワイプ（ポインタ）とクリック選択を扱う。
//
// ドラッグ量が PREVIEW_THRESHOLD を超えた時点で着地予測ゴーストを出し、
// COMMIT_THRESHOLD(26px) を超えた瞬間にスライドを発動する。

const PREVIEW_THRESHOLD = 6;
const COMMIT_THRESHOLD = 26;

/**
 * 盤面の操作を受ける。
 *
 * 受け皿はキャンバスとは限らない ―― iPhone では、キャンバスの上に敷いた
 * 「触覚の膜」（透明なネイティブスイッチ）が受ける。指がその膜に直接触れることで
 * 手ごたえが返るので、**膜がイベントを受け取ったままでなければならない**
 * （詳しくは haptics.js）。位置はすべて clientX/Y で扱うので、受け皿が
 * どちらでも当たり判定は変わらない。
 *
 * @param {Element} surface 操作を受ける要素（キャンバス、または触覚の膜）
 * @param {{
 *   canInteract: () => boolean,
 *   toCell: (x:number, y:number) => ({x:number,y:number}|null),
 *   pieceAt: (x:number, y:number) => (number|null),
 *   onTap: (pieceId:number|null) => void,
 *   onPreview: (pieceId:number, dir:string|null) => void,
 *   onCommit: (pieceId:number, dir:string) => void,
 * }} handlers
 * @returns {() => void} 付け替えるときに呼ぶ、取り外し
 */
export function attachInput(surface, handlers) {
  const canvas = surface;
  let drag = null;
  const bound = [];
  const on = (type, fn) => { canvas.addEventListener(type, fn); bound.push([type, fn]); };

  const dirOf = (dx, dy) => {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  };

  on('pointerdown', (e) => {
    if (!handlers.canInteract()) return;
    const cell = handlers.toCell(e.clientX, e.clientY);
    const id = cell ? handlers.pieceAt(cell.x, cell.y) : null;
    if (id == null) {
      handlers.onTap(null);
      return;
    }
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    drag = { id, x0: e.clientX, y0: e.clientY, dir: null, done: false };
    handlers.onTap(id);
  });

  on('pointermove', (e) => {
    if (!drag || drag.done) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));

    if (dist < PREVIEW_THRESHOLD) {
      if (drag.dir) {
        drag.dir = null;
        handlers.onPreview(drag.id, null);
      }
      return;
    }

    const dir = dirOf(dx, dy);
    if (dir !== drag.dir) {
      drag.dir = dir;
      handlers.onPreview(drag.id, dir);
    }

    if (dist >= COMMIT_THRESHOLD) {
      drag.done = true;
      handlers.onPreview(drag.id, null);
      handlers.onCommit(drag.id, dir);
    }
  });

  const end = () => {
    if (!drag) return;
    if (!drag.done && drag.dir) handlers.onPreview(drag.id, null);
    drag = null;
  };

  on('pointerup', end);
  on('pointercancel', end);
  on('pointerleave', end);
  on('contextmenu', (e) => e.preventDefault());

  return () => {
    for (const [type, fn] of bound) canvas.removeEventListener(type, fn);
    bound.length = 0;
    drag = null;
  };
}
