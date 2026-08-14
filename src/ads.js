// 広告（忍者AdMax）。
//
// 忍者AdMax の非同期タグは 3 つでひと組になっている。
//
//   1. 置き場所      <div class="admax-ads" data-admax-id="…" style="width:…;height:…">
//   2. 依頼          window.admaxads.push({ admax_id:"…", type:"banner" })
//   3. 描画スクリプト <script src="https://adm.shinobi.jp/st/t.js" async>
//
// 3 が読み込まれた時点で、2 に積まれた依頼を順に見て 1 を埋める。
// このゲームは画面を 1 枚の HTML で切り替える作りなので、素直に貼ると
// 「最初に読み込んだときの依頼しか描かれない」ことになる。そこで:
//
//   枠は「その画面を初めて出したとき」に組み立てる。
//     見てもいない画面の広告まで最初にまとめて呼ぶと、表示されないまま
//     回数だけが増える。開いた画面のぶんだけ呼ぶ。
//
//   依頼を積んだら、t.js を貼り直す。
//     t.js は読み込まれた瞬間に、そのとき積まれている依頼を処理して終わる。
//     後から積んだぶんを描かせるには、もう一度読み込ませるのがいちばん確実
//     （クライアント側で画面を切り替える作りでは、これが定石になっている）。
//
//   1 つの枠は 1 回だけ組み立てる。
//     画面を行き来するたびに広告を呼び直さない。枠はそのまま残す。

import { ADMAX } from './config.js';

const ADMAX_SCRIPT = 'https://adm.shinobi.jp/st/t.js';

/** 枠の名前 → 置き場所の id */
const AD_BOX_IDS = {
  home: 'ad-home',
  levels: 'ad-levels',
  game: 'ad-game',
  clear: 'ad-clear',
};

/** 広告ユニットの ID は英数字。書き間違いをここで落とす */
function admaxSlot(name) {
  const slot = (ADMAX.slots || {})[name];
  const id = String((slot && slot.id) || '').trim();
  if (!/^[0-9a-zA-Z]{8,}$/.test(id)) return null;
  // file:// では広告は動かない（オフライン起動でも同じ扱いでよい）
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return {
    id,
    type: slot.type === 'switch' ? 'switch' : 'banner',
    width: Number(slot.width) > 0 ? Number(slot.width) : 320,
    height: Number(slot.height) > 0 ? Number(slot.height) : 50,
  };
}

/** t.js を貼り直して、積んである依頼を描かせる */
function runAdmax() {
  // 前回のものは残しておいても意味が無いので片付ける
  for (const old of document.querySelectorAll('script[data-admax-loader]')) old.remove();
  const el = document.createElement('script');
  el.async = true;
  el.src = ADMAX_SCRIPT;
  el.dataset.admaxLoader = '1';
  document.body.appendChild(el);
}

/** 組み立て済みの枠。同じ枠を二度呼ばない */
const adsBuilt = new Set();

/**
 * 広告の枠。画面を出す側から `ads.show('home')` のように呼ぶ。
 *
 * 設定が空なら全て空振りする ―― 呼ぶ側に「広告があるかどうか」を持たせない。
 */
export const ads = {
  /** その場所の広告を出す（設定が無ければ何もしない） */
  show(name) {
    const box = document.getElementById(AD_BOX_IDS[name]);
    const slot = box ? admaxSlot(name) : null;
    if (!slot) return;

    box.hidden = false;
    if (adsBuilt.has(name)) return;
    adsBuilt.add(name);

    // 読み込みの前後で画面が飛び跳ねないよう、先に高さぶんの場所を取る
    box.style.setProperty('--ad-h', `${slot.height}px`);

    const ins = document.createElement('div');
    ins.className = 'admax-ads';
    ins.dataset.admaxId = slot.id;
    ins.style.display = 'inline-block';
    ins.style.width = `${slot.width}px`;
    ins.style.height = `${slot.height}px`;
    box.appendChild(ins);

    (window.admaxads = window.admaxads || []).push({ admax_id: slot.id, type: slot.type });
    runAdmax();
  },

  /** その場所の広告を引っ込める（読み込み中のカードなど、出したくない場面用） */
  hide(name) {
    const box = document.getElementById(AD_BOX_IDS[name]);
    if (box) box.hidden = true;
  },

  /**
   * クリアの表示に切り替える。
   *
   * ゲーム画面の広告はいったん引っ込める ―― クリアのカードのすぐ下に 2 枚
   * 並ぶと、見た目にうるさいだけでなく、カードが縮んでボタンが隠れる。
   * 引っ込めるのは表示だけで、広告を呼び直しはしない。
   */
  showClear() {
    this.hide('game');
    this.show('clear');
  },

  /** クリアの表示を畳んで、ゲーム画面の広告を戻す */
  hideClear() {
    this.hide('clear');
    this.show('game');
  },
};
