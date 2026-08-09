// シートを下へ払って閉じる。
//
// 下から せり上がってくる紙は、指で下へ押し戻せないと嘘に見える。閉じるボタンは
// 右上の小さな丸ひとつしかないので、盤面を見ながら片手で持っているときほど遠い ――
// 「開いてしまったから閉じる」だけの操作に、画面の端まで指を運ばせない。
//
// 作りの要点:
//
//   ・**指の位置にそのまま付いてくる**。しきい値を超えた瞬間に消えるのではなく、
//     下げたぶんだけ下がり、背景の暗さも一緒に薄くなる。途中で気が変わったら
//     戻せる ―― 戻せるからこそ、思い切って引ける。
//   ・**中身が上まで来ているときだけ**引き下げる。ルールのシートは長くて縦に
//     スクロールするので、読んでいる途中の下向きスワイプでシートごと落ちたら
//     読めたものではない。
//   ・touch イベントを直に使う。Pointer Events だと、シートを閉じる向きの指を
//     つかむために touch-action: none が要り、そうすると中身がスクロールできない。
//     「スクロールを始めてよいか」をこちらで決めたいので、touchmove を
//     preventDefault できる形にしてある（passive: false）。

/** ここまで下げたら「引き下げ」とみなす。それ未満は中身のスクロールに譲る */
const SHEET_GRAB = 8;
/** カードの高さのこれだけ下げたら、離した時点で閉じる */
const SHEET_CLOSE_RATIO = 0.3;
/** px/ms。速く払われたら、下げた距離が足りなくても閉じる */
const SHEET_FLICK = 0.5;
/** 払いで閉じると認める最小の距離。指が触れただけで閉じないための床 */
const SHEET_FLICK_MIN = 24;

/** 触っている指を changedTouches から拾う */
function touchOf(list, id) {
  for (const t of list) if (t.identifier === id) return t;
  return null;
}

/**
 * 開くときに呼ぶ。前に引きずった跡（位置・背景の濃さ・畳む途中のアニメ）を消す。
 * これを忘れると、閉じかけの姿のまま次のシートが開く。
 */
export function resetSheet(sheet) {
  const card = sheet && sheet.querySelector('.sheet-card');
  if (!card) return;
  card.classList.remove('dragging', 'settling', 'dropping');
  card.style.transform = '';
  card.style.animation = '';
  sheet.classList.remove('closing');
  sheet.style.removeProperty('--sheet-shade');
}

/**
 * シートに「下へ払って閉じる」を付ける。
 *
 * @param {HTMLElement} sheet .sheet（背景の暗幕ごと）
 * @param {{ canClose?: () => boolean, onClose?: () => void }} opts
 *   canClose 閉じてよいか（名前を決めるシートは決めきるまで false）
 *   onClose  閉じ切ったときに呼ばれる。実際に隠すのは呼び出し側の仕事
 */
export function attachSheetSwipe(sheet, opts = {}) {
  const canClose = opts.canClose || (() => true);
  const onClose = opts.onClose || (() => {});
  const card = sheet && sheet.querySelector('.sheet-card');
  if (!card) return;

  /** つかんでいる指。null なら見ていない */
  let touchId = null;
  let x0 = 0;
  let y0 = 0;
  let lastY = 0;
  let lastT = 0;
  /** 下げた量（px）と、直近の速度（px/ms） */
  let dy = 0;
  let vy = 0;
  let dragging = false;
  let timer = 0;

  /** 指の位置を、カードの下がり具合と背景の薄さに写す */
  const paint = (y) => {
    card.style.transform = y > 0 ? `translate3d(0,${y.toFixed(1)}px,0)` : '';
    const h = card.offsetHeight || 1;
    // 下げ切る手前で背景が透明になるほうが「もう閉じる」と伝わる
    const shade = Math.max(0, 1 - (y / h) * 1.4);
    sheet.style.setProperty('--sheet-shade', shade.toFixed(3));
  };

  /** 指を離したあとの後始末。done は畳み終わり／戻り終わりで呼ばれる */
  const after = (ms, done) => {
    clearTimeout(timer);
    timer = setTimeout(done, ms);
  };

  /** 元の位置へ戻す */
  const settle = () => {
    card.classList.add('settling');
    paint(0);
    after(420, () => {
      card.classList.remove('settling');
      card.style.animation = '';
      sheet.style.removeProperty('--sheet-shade');
    });
  };

  /** 下まで畳んでから閉じる */
  const drop = () => {
    card.classList.add('dropping');
    card.style.transform = 'translate3d(0,100%,0)';
    // 暗幕もカードと同じ時間をかけて引く（先に消えると紙だけが取り残される）
    sheet.classList.add('closing');
    sheet.style.setProperty('--sheet-shade', '0');
    after(240, () => {
      resetSheet(sheet);
      onClose();
    });
  };

  card.addEventListener('touchstart', (e) => {
    if (touchId != null || e.touches.length !== 1) return;
    if (!canClose()) return;
    // 入力欄の中は、文字を選ぶために指が縦に動く。ここを掴むとキーボードが
    // 出ている最中にシートが落ちる
    const target = e.target;
    if (target instanceof Element && target.closest('input, textarea, select')) return;

    const t = e.touches[0];
    touchId = t.identifier;
    x0 = t.clientX;
    y0 = t.clientY;
    lastY = t.clientY;
    lastT = e.timeStamp;
    dy = 0;
    vy = 0;
    dragging = false;
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (touchId == null) return;
    const t = touchOf(e.changedTouches, touchId);
    if (!t) return;

    if (!dragging) {
      const gx = t.clientX - x0;
      const gy = t.clientY - y0;
      // 横に払っている／上へ動かしている＝中身を読みたい。この指はもう見ない
      if (Math.abs(gx) > Math.abs(gy) || gy < -2) { touchId = null; return; }
      if (gy < SHEET_GRAB) return;
      // 中身が上まで来ていないなら、下向きは「上へスクロール」の意味になる
      if (card.scrollTop > 0) { touchId = null; return; }
      // すでにブラウザがスクロールを始めていたら、もう横取りできない
      if (!e.cancelable) { touchId = null; return; }
      dragging = true;
      // 戻っている途中で掴み直されることがある。残っている transition を外さないと、
      // ここから先の指の動きが 0.4 秒遅れて付いてくる
      clearTimeout(timer);
      card.classList.remove('settling', 'dropping');
      card.classList.add('dragging');
      // せり上がりの途中で掴まれることがある。走っているアニメは
      // インラインの transform より強いので、ここで降ろす
      card.style.animation = 'none';
      // つかんだ瞬間にカードが SHEET_GRAB ぶん飛ばないよう、原点をずらす
      y0 += SHEET_GRAB;
    }

    if (e.cancelable) e.preventDefault();
    dy = Math.max(0, t.clientY - y0);
    if (e.timeStamp > lastT) vy = (t.clientY - lastY) / (e.timeStamp - lastT);
    lastY = t.clientY;
    lastT = e.timeStamp;
    paint(dy);
  }, { passive: false });

  const release = (e) => {
    if (touchId == null) return;
    if (!touchOf(e.changedTouches, touchId)) return;
    touchId = null;
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');

    const h = card.offsetHeight || 1;
    const far = dy > h * SHEET_CLOSE_RATIO;
    const flicked = vy > SHEET_FLICK && dy > SHEET_FLICK_MIN;
    if (canClose() && (far || flicked)) drop();
    else settle();
  };

  card.addEventListener('touchend', release);
  card.addEventListener('touchcancel', release);
}
