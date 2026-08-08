// ブロックの素材。
//
// 盤面のブロックは「色のついた板」ではなく、**その素材で削り出した塊**に見せる。
// 石は欠けた粗い面、木は繊維の走った木目、金属はヘアラインと帯状の反射、
// クリスタルはエメラルドカットの面取り、紙は繊維の浮いたマット、布は織り目。
//
// 画像は 1 枚も使っていない。すべて実行時に手続き的に描いている ――
// 素材ごとに「高さの場」を作り、その**傾きから陰影を計算する**（バンプマッピング）。
// 色を塗り分けただけのテクスチャは、動かすと平らに見える。傾きから光を当てると、
// 同じデータでも凹凸として読める。
//
// ここが持つのは「表面」だけ。立体の組み立て（接地影 → 側面の厚み → 天面 →
// 面取り → 鏡面）は render.js の 1 本の経路が受け持ち、素材はその経路に
// 寸法と色と塗り方を渡す。そうしないと素材を足すたびに立体の作りが分岐する。

import { makeRng, hashSeed } from './rng.js';
import {
  mix, clip, hexRgb, rgbHex, rgbHsl, hslRgb, mixHex, shade, tintTowards, luma,
} from './color.js';

/**
 * 光の向き（画面座標）。左上やや上から。
 * 全素材で共通にしてある ―― 素材ごとに光源が動くと、盤面が 1 つの場所に見えない。
 */
export const LIGHT = { x: -0.52, y: -0.85 };

/** テクスチャのタイルの一辺（px）。継ぎ目なく繰り返せるように作る */
const TILE = 256;
/** ノイズ格子の一辺。TILE と割り切れる 2 の冪にしておくと端が繋がる */
const GRID = 64;

// ---------------------------------------------------------------- ノイズ

/** 格子の乱数。端で折り返すので、タイルの継ぎ目が出ない */
export function makeNoise(rng) {
  const g = new Float32Array(GRID * GRID);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return g;
}

/**
 * 値ノイズをタイル座標（u,v ∈ 0..1）で読む。
 *
 * **fx / fy は「タイルを横切るあいだに何周するか」で、整数でなければならない。**
 * ここが継ぎ目の有無を決める。整数でないと u=0 と u=1 が別の格子点を指し、
 * 繰り返して敷いたときに縦横の線が走る（最初これで盤面に格子が出た）。
 * 整数なら剰余がぴったり回るので、端は必ず反対の端と繋がる。
 *
 * ox / oy は表を読む位置のずらし。オクターブごとに変えて、
 * 重ねた層が同じ模様の拡大縮小に見えないようにする。
 */
export function noiseAt(g, u, v, fx, fy, ox = 0, oy = 0) {
  const px = Math.max(1, Math.round(fx));
  const py = Math.max(1, Math.round(fy));
  const x = u * px;
  const y = v * py;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  // smoothstep。線形補間のままだと格子の筋が見えてしまう
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const i0 = ((xi % px) + px) % px;
  const j0 = ((yi % py) + py) % py;
  const i1 = (i0 + 1) % px;
  const j1 = (j0 + 1) % py;
  const at = (j, i) => g[(((j + oy) % GRID) * GRID) + ((i + ox) % GRID)];
  return mix(mix(at(j0, i0), at(j0, i1), sx), mix(at(j1, i0), at(j1, i1), sx), sy);
}

/**
 * 重ね合わせたノイズ（fBm）。周波数は倍々になるので、fx / fy が整数なら
 * どのオクターブも整数のまま ―― 全部の層が同時に継ぎ目なく繋がる。
 *
 * @param {boolean} ridge 山にする（|2n-1| を裏返す）。石の「欠け」はこれで出る ――
 *   ふつうの fBm は丘のように丸いが、ridge は稜線が立って割れ目に見える。
 */
export function fbm2(g, u, v, fx, fy, octaves, gain = 0.5, ridge = false) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let mul = 1;
  for (let o = 0; o < octaves; o++) {
    let n = noiseAt(g, u, v, fx * mul, fy * mul, o * 17, o * 29);
    if (ridge) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    mul *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- タイル生成

/**
 * 高さの場から 1 枚のタイルを焼く。
 *
 * @param {(u:number,v:number)=>number} height 0..1 の高さ（u,v は 0..1 のタイル座標）
 * @param {(u:number,v:number,h:number)=>number[]} color その点の地の色 [r,g,b]
 * @param {{relief?:number, ambient?:number}} opts relief = 凹凸の強さ
 * @returns {HTMLCanvasElement}
 */
function bumpTile(height, color, opts = {}) {
  const { relief = 0.35, ambient = 0.92 } = opts;
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const px = img.data;

  // ① 高さを全部求める。傾きを取るのに隣の値が要るので、色より先に片づける
  const h = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) h[y * TILE + x] = height(x / TILE, y / TILE);
  }
  const at = (x, y) => h[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];

  // ② 傾きの大きさを測る。
  //
  //    ここが要点。同じ relief を与えても、高さの場が細かいほど傾きは大きくなる ――
  //    素材ごとに周波数が違うので、生の傾きをそのまま明るさにすると、細かい素材
  //    （金属のヘアライン）だけが真っ白と真っ黒に振り切れる。実際そうなった。
  //    傾きの二乗平均で割って正規化すれば、relief は「どれくらい凸凹に見せたいか」
  //    という 1 つの意味だけを持つようになり、周波数を変えても破綻しない。
  const gx = new Float32Array(TILE * TILE);
  const gy = new Float32Array(TILE * TILE);
  let acc = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      gx[i] = dx;
      gy[i] = dy;
      acc += dx * dx + dy * dy;
    }
  }
  const norm = Math.sqrt(acc / (TILE * TILE)) || 1e-6;

  // ③ 色を置く
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const slope = (gx[i] * LIGHT.x + gy[i] * LIGHT.y) / norm;
      const lit = clip(ambient + slope * relief, 0.45, 1.55);
      const c = color(x / TILE, y / TILE, h[i]);
      const o = i * 4;
      px[o] = clip(c[0] * lit, 0, 255);
      px[o + 1] = clip(c[1] * lit, 0, 255);
      px[o + 2] = clip(c[2] * lit, 0, 255);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** オフスクリーンのキャンバス。OffscreenCanvas が無い環境でも動くようにする */
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.ceil(w), Math.ceil(h));
  return null;
}

// ---------------------------------------------------------------- 素材ごとの表面

/**
 * 石 ―― 磨いた御影石。
 *
 * 最初は「割り肌」（ridge を効かせた fBm で稜線を立てたもの）にしていたが、
 * 1 マスが 40px そこそこまで小さくなると、稜線がブロックの輪郭と同じ細かさになり、
 * 形が模様に埋もれて読めなくなった ―― 皺くちゃの箔にしか見えなかった。
 *
 * 磨いた石は**ほとんど平ら**で、石らしさは凹凸ではなく**粒**が持っている。
 * 明るい長石と暗い黒雲母を閾値で切って散らし、面そのものは撫でるだけにする。
 * 情報量が減ったぶん、形と色が先に目に入るようになる。
 */
function stoneTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const grit = makeNoise(makeRng(seed ^ 0x9e3779b9));
  const base = hexRgb(pal.mid);
  const high = hexRgb(pal.top);
  const low = hexRgb(pal.deep);

  // 面は撫でるだけ。ここに細かい起伏を足すと、光の向きに沿って明暗が伸び、
  // 粒ではなく**虫の這った跡**のような筋になる（実際そう見えた）
  const height = (u, v) => fbm2(g, u, v, 2, 2, 2, 0.5);
  const color = (u, v) => {
    // 大きな斑（同じ石でも場所によって色が振れる）
    const mottle = fbm2(grit, u, v, 3, 3, 2, 0.5) - 0.5;
    // 粒は閾値で切る。滑らかに混ぜると靄になり、切ると**粒**として残る
    const pale = clip((noiseAt(grit, u, v, 48, 48, 3, 5) - 0.6) * 2.6, 0, 1);
    const dark = clip((noiseAt(g, u, v, 40, 40, 9, 13) - 0.64) * 2.8, 0, 1);
    let c = [0, 1, 2].map((i) => mix(base[i], mottle > 0 ? high[i] : low[i], Math.abs(mottle) * 0.3));
    c = [0, 1, 2].map((i) => mix(c[i], high[i], pale * 0.72));
    return [0, 1, 2].map((i) => mix(c[i], low[i], dark * 0.55));
  };
  return bumpTile(height, color, { relief: 0.12, ambient: 1 });
}

/**
 * 木 ―― 削り出した板。
 * 年輪は「中心からの距離をノイズで歪めて、その小数部を取る」だけで出る。
 * 歪めないと同心円の模様になってしまうので、歪みの量が木らしさそのものになる。
 * 導管（細い縦筋）を別に重ねて、繊維の向きを出す。
 */
function woodTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const fib = makeNoise(makeRng(seed ^ 0x85ebca6b));
  const light = hexRgb(pal.top);
  const mid = hexRgb(pal.mid);
  const dark = hexRgb(pal.deep);

  // 板は横長に取る。木目は u 方向（横）へ流し、縦向きのブロックには
  // タイルごと 90° 回して貼る（render.js 側）。板の取り方が変われば別の木に見える
  const height = (u, v) => {
    // 年輪を v 方向にだけ数え、u に沿ってノイズで歪める。
    // 折り返しは三角波で作る ―― 小数部（のこぎり波）のままだと 1 周ごとに
    // 段差ができ、木目ではなく等高線のような硬い輪郭になる（実際そう見えた）。
    // 年輪の本数を**偶数**にしてあるのも継ぎ目のため。三角波の周期は 2 なので、
    // 奇数だとタイルの上端と下端で山と谷が入れ替わってしまう
    // 本数は少ないほど板に見える。22 本だと 1 マスに何本も入り、木目ではなく
    // バーコードになった ―― 3 マスぶんのタイルに 4 周（＝山 4 本）で足りる
    // 歪みは**木目を横切る向きにはほとんど掛けない**（fy=1）。両方向に掛けると
    // 年輪が渦を巻き、木ではなく大理石か流れる液体に見える（実際そう見えた）
    const warp = fbm2(g, u, v, 3, 1, 3, 0.5);
    const t = v * 12 + warp * 1.5;
    const tri = Math.abs((t % 2) - 1);
    // 指数を上げると谷が広く山が細くなる。年輪は「広い春材に細い濃い線」
    const ring = Math.pow(tri, 1.7);
    // 導管。木目に沿って走る細い筋（u にはほぼ変化せず、v に細かく振る）
    const pore = noiseAt(fib, u, v, 2, 48) * 0.24;
    return clip(ring * 0.78 + pore, 0, 1);
  };
  const color = (u, v, h) => {
    const t = clip(h * 1.15 - 0.05, 0, 1);
    const c = [0, 1, 2].map((i) => mix(dark[i], light[i], t));
    // 濃い筋（晩材）をところどころ強く出す
    const streak = noiseAt(fib, u, v, 2, 18, 5, 9);
    const k = streak > 0.72 ? (streak - 0.72) * 1.4 : 0;
    return [0, 1, 2].map((i) => mix(c[i], mid[i] * 0.8, clip(k, 0, 0.36)));
  };
  return bumpTile(height, color, { relief: 0.22, ambient: 0.98 });
}

/**
 * 金属 ―― ヘアライン仕上げのステンレス。
 * 研磨の筋は「片方向にだけ引き伸ばしたノイズ」。縦にはほとんど変化させず、
 * 横に細かく散らすと、あの一方向の擦り傷になる。
 * 帯状の映り込みはテクスチャではなく、render.js 側の鏡面グラデーションで出す
 * （ブロックの大きさに合わせて帯の位置が動かないと、板に見えない）。
 */
function metalTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const base = hexRgb(pal.mid);

  const height = (u, v) => {
    // u 方向はほとんど変えず、v 方向にだけ細かく振る = 横へ伸びた筋。
    // v の本数を上げすぎると 1 画素より細かくなり、筋ではなく砂嵐になる ――
    // タイル 256px なら 110 本で周期およそ 2px。ヘアラインはこのあたりが限度
    const fine = noiseAt(g, u, v, 3, 110);
    const mid = noiseAt(g, u, v, 4, 32, 11, 5);
    const broad = fbm2(g, u, v, 2, 9, 2, 0.5);
    return clip(fine * 0.5 + mid * 0.3 + broad * 0.2, 0, 1);
  };
  const color = (u, v, h) => {
    // 金属は色数を持たない。明暗だけで見せる
    const k = (h - 0.5) * 0.16;
    return [0, 1, 2].map((i) => clip(base[i] * (1 + k), 0, 255));
  };
  return bumpTile(height, color, { relief: 0.26, ambient: 1 });
}

/**
 * 紙 ―― 圧した厚紙。
 * 繊維は「短い線分がランダムな向きに絡んだ場」。細かいノイズを 2 枚、
 * 別の縮尺で重ねると、目で追えない細かさの繊維に見える。
 */
function paperTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const f = makeNoise(makeRng(seed ^ 0xc2b2ae35));
  const base = hexRgb(pal.mid);
  const dark = hexRgb(pal.deep);

  const height = (u, v) => {
    // 紙は「ほとんど平ら」が正解。粗さを上げると石膏や漆喰になってしまう
    // 88 本まで細かくすると 1 画素より細かい砂嵐になり、紙ではなく漆喰に見えた
    const fiber = noiseAt(f, u, v, 44, 44);
    const laid = noiseAt(f, u, v, 3, 40, 9, 3) * 0.5;  // 簀の目。ごく淡い横筋
    const felt = fbm2(g, u, v, 4, 4, 3, 0.6);
    const wave = fbm2(g, u, v, 2, 2, 2, 0.5) * 0.5;    // 紙のうねり
    return clip(fiber * 0.13 + laid * 0.12 + felt * 0.32 + wave, 0, 1);
  };
  const color = (u, v, h) => {
    const t = clip((h - 0.5) * 0.6 + 0.5, 0, 1);
    return [0, 1, 2].map((i) => mix(dark[i], base[i], 0.62 + t * 0.38));
  };
  return bumpTile(height, color, { relief: 0.1, ambient: 0.99 });
}

/**
 * 布 ―― 平織り。
 * 縦糸と横糸が交互に上へ出る。市松に位相をずらした 2 本の正弦波を、
 * 市松の位置で選び分けると、糸が交差して見える。
 */
function fabricTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const base = hexRgb(pal.mid);
  const dark = hexRgb(pal.deep);
  const light = hexRgb(pal.top);
  const threads = 24; // タイルあたりの糸の本数

  const height = (u, v) => {
    const fx = u * threads;
    const fy = v * threads;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    // 市松で「いま上に出ている糸」を切り替える
    const warpUp = (cx + cy) % 2 === 0;
    const along = warpUp ? fy - cy : fx - cx;   // 糸に沿う向き
    const across = warpUp ? fx - cx : fy - cy;  // 糸を横切る向き
    // 横切る向きに丸みを付けると、糸が円柱に見える
    const round = Math.sin(across * Math.PI);
    const twist = 0.85 + 0.15 * Math.sin(along * Math.PI * 2);
    const fuzz = noiseAt(g, u, v, 54, 54) * 0.16;
    return clip(round * twist * 0.84 + fuzz, 0, 1);
  };
  const color = (u, v, h) => {
    const t = clip(h * 1.1, 0, 1);
    const c = [0, 1, 2].map((i) => mix(dark[i], base[i], 0.4 + t * 0.6));
    return [0, 1, 2].map((i) => mix(c[i], light[i], clip((h - 0.7) * 1.6, 0, 0.5)));
  };
  return bumpTile(height, color, { relief: 0.3, ambient: 0.95 });
}

/**
 * クリスタル ―― 磨いたガラスの卓面。
 * 面取りは幾何（render.js の 8 面）で作るので、ここは卓面のごく淡い曇りだけ。
 * texture を濃くすると、透明感が濁って「すりガラス」になってしまう。
 */
function crystalTexture(pal, seed) {
  const g = makeNoise(makeRng(seed));
  const base = hexRgb(pal.mid);
  const light = hexRgb(pal.top);

  const height = (u, v) => fbm2(g, u, v, 2, 2, 3, 0.55);
  // 卓面は「ほとんど何も無い」のが正しい。濁らせると、すりガラスになってしまう。
  // かといって白く飛ばすと、透けているようには見えない ―― 地の色を中心に振る
  const color = (u, v, h) => [0, 1, 2].map((i) => mix(base[i], light[i], clip(h * 0.5 + 0.05, 0, 1)));
  return bumpTile(height, color, { relief: 0.1, ambient: 1.04 });
}

// ---------------------------------------------------------------- 素材の定義

/**
 * 素材ひとつ。寸法はすべて**セルの一辺に対する比**で持つ ――
 * 盤面が 4×4 でも 8×8 でも、ブロックの厚みと面取りが同じ割合で見えるように。
 */
const DEFS = [
  {
    key: 'plain',
    name: 'プレーン',
    note: '色だけの平らな面',
    /*
     * 何も乗せない、元からの見た目。
     *
     * **いちばん読みやすいのはこれ**なので、既定にしてある。厚みも面取りも影も
     * テクスチャも持たず、一色のベタ塗りに髪の毛ほどのすき間だけ。
     * 目が拾うものが「色と形」しか無いので、どのブロックがどこまでかが一瞬で分かる。
     *
     * flat が立っている素材は、立体の経路（接地影・側面・面取り・縁・テクスチャ）を
     * まるごと飛ばす ―― 薄くするのではなく、通らない。
     */
    flat: true,
    depth: 0,
    bevel: 0,
    radius: 0.14,
    gap: 0.032,
    gloss: 0,
    sheen: 0,
    tint: 1,
    shadow: 0,
    grain: 0,
    bevelStyle: 'soft',
    /** 進行度の色を素材へ混ぜず、そのまま使う（元の見た目がそうだった） */
    rawTint: true,
    /** 盤面も進行度の色を、ほとんど白まで薄めて追いかける */
    trayTint: true,
    colors: {
      grey: { top: '#c4c4cb', mid: '#9a9aa2', deep: '#5f5f68', side: '#6e6e78' },
      lit: { top: '#7f97e6', mid: '#3e47cc', deep: '#2a2f8c', side: '#333a9f' },
    },
    tray: { frame: '#dde2f0', floor: '#dde2f0', well: '#eef1f8' },
    texture: null,
  },
  {
    key: 'stone',
    name: '石',
    note: '磨いた御影石',
    depth: 0.115,      // 側面の厚み
    bevel: 0.12,       // 面取りの幅
    radius: 0.14,      // 角の丸み
    gap: 0.062,        // ブロック同士のすき間（＝黒い目地の太さ）
    gloss: 0.12,       // 鏡面の強さ（石はほとんど光らない）
    sheen: 0.2,        // 天面の明暗の付き方
    /*
     * 色つきブロックは進行度の色を**はっきり**まとう。
     * ここを弱くすると「灰色がかった石が2種類ある」だけの盤面になり、
     * どれが動かせる色つきなのかが一瞬で読めない（実際そうなっていた）。
     */
    tint: 0.54,
    shadow: 0.5,       // 接地影の濃さ
    grain: 0.5,        // 表面の模様の出し方。粗すぎると形が読めなくなる
    facets: 8,
    bevelStyle: 'soft',   // 縁は丸い。面では割らない
    bevelAlpha: 0.85,
    colors: {
      // 灰色は暗い玄武岩、色つきは明るい花崗岩。**明るさが先に目に入り**、
      // そのあとで色が付いてくる ―― この順でないと小さいマスで見分けが付かない
      grey: { top: '#a6a29b', mid: '#807c76', deep: '#4f4c47', side: '#5d5a55' },
      lit: { top: '#eae5dc', mid: '#c9c3b8', deep: '#8a8479', side: '#999287' },
    },
    // 盤面はブロックより**はっきり暗い**。明るい石が暗い受け皿に載っている、
    // という関係が、ブロックの輪郭をいちばん強く立たせる
    tray: { frame: '#4c4842', floor: '#38352f', well: '#292722' },
    texture: stoneTexture,
  },
  {
    key: 'wood',
    name: '木',
    note: 'ウォールナットと楓',
    depth: 0.1,
    bevel: 0.075,
    radius: 0.2,
    gap: 0.058,
    gloss: 0.26,
    sheen: 0.24,
    // 木を真っ青にすると木に見えなくなる。灰色との差は「樹種の差」＝明暗が持ち、
    // 色相はそこへ乗せるだけ。それでも 0.18 では色が見えなかったので上げる
    tint: 0.3,
    shadow: 0.44,
    grain: 0.62,
    facets: 8,
    bevelStyle: 'soft',
    bevelAlpha: 0.9,
    colors: {
      grey: { top: '#9c6b42', mid: '#7d5330', deep: '#4a2d19', side: '#583620' },
      lit: { top: '#f8e3bb', mid: '#e4c895', deep: '#a2814d', side: '#b0905e' },
    },
    tray: { frame: '#3a2819', floor: '#281b10', well: '#1d140b' },
    texture: woodTexture,
  },
  {
    key: 'metal',
    name: '金属',
    note: 'ヘアラインの金属',
    depth: 0.095,
    bevel: 0.1,
    radius: 0.16,
    gap: 0.058,
    gloss: 1,
    sheen: 0.42,
    tint: 0.6,
    shadow: 0.56,
    grain: 0.55,
    facets: 8,
    bevelStyle: 'facet',  // 留め継ぎの面取り。金属はここが命
    bevelAlpha: 1,
    banded: true,      // 帯状の映り込みを重ねる（金属だけ）
    colors: {
      grey: { top: '#b9bec3', mid: '#878d93', deep: '#3b4046', side: '#4a4f55' },
      lit: { top: '#eef4fa', mid: '#c2ccd6', deep: '#697682', side: '#7a8794' },
    },
    tray: { frame: '#33363a', floor: '#1d1f22', well: '#121315' },
    texture: metalTexture,
  },
  {
    key: 'crystal',
    name: 'クリスタル',
    note: 'エメラルドカット',
    depth: 0.085,
    bevel: 0.17,
    radius: 0,
    chamfer: 0.2,      // 角を 45° で落とす（丸めない）
    gap: 0.058,
    gloss: 1,
    sheen: 0.3,
    tint: 0.95,
    shadow: 0.42,
    grain: 0.6,
    facets: 8,
    bevelStyle: 'facet',  // エメラルドカット
    bevelAlpha: 1,
    translucent: 0.76, // 卓面の不透明度。下のトレイが薄く透ける
    prism: true,       // 面の継ぎ目に虹の線を入れる
    colors: {
      // 灰色は無色のガラス、色つきは染めたガラス。透けるぶん明暗が薄くなるので、
      // ここだけは色みの差をいちばん強く取る
      grey: { top: '#c4cad1', mid: '#8d939a', deep: '#474c52', side: '#6b7178' },
      lit: { top: '#d8f2ff', mid: '#6ec8ee', deep: '#175f85', side: '#3d95c4' },
    },
    // 透けるものは、暗い受け皿の上でしか透けて見えない
    tray: { frame: '#3e4650', floor: '#2b323b', well: '#1d232a' },
    texture: crystalTexture,
  },
  {
    key: 'paper',
    name: '紙',
    note: '板紙と白いカード',
    depth: 0.078,
    bevel: 0.07,
    radius: 0.14,
    gap: 0.06,
    gloss: 0.06,
    sheen: 0.14,
    tint: 0.56,
    shadow: 0.38,
    grain: 0.45,
    facets: 8,
    bevelStyle: 'soft',
    bevelAlpha: 0.8,
    colors: {
      // 灰色は板紙（クラフト）、色つきは白いカード。紙どうしなので、
      // 色相ではなく**紙の種類**で差を付けないと見分けが付かない
      grey: { top: '#bdb19b', mid: '#9c9179', deep: '#675e4a', side: '#756c56' },
      lit: { top: '#fffdf6', mid: '#f7f0e1', deep: '#c6bba1', side: '#d6cbb1' },
    },
    tray: { frame: '#4a4336', floor: '#373127', well: '#2b261e' },
    texture: paperTexture,
  },
  {
    key: 'fabric',
    name: '布',
    note: '平織りのリネン',
    depth: 0.085,
    bevel: 0.1,
    radius: 0.24,
    gap: 0.064,
    gloss: 0.05,
    sheen: 0.16,
    tint: 0.64,
    shadow: 0.4,
    grain: 0.6,
    facets: 8,
    bevelStyle: 'soft',
    bevelAlpha: 0.75,
    colors: {
      // 灰色は染めた麻、色つきは晒した麻。織り目は同じで、糸の色だけが違う
      grey: { top: '#968d7e', mid: '#756d5f', deep: '#48423a', side: '#554f44' },
      lit: { top: '#f2ecdd', mid: '#ded7c4', deep: '#9c947f', side: '#aba38d' },
    },
    tray: { frame: '#464036', floor: '#332f28', well: '#272420' },
    texture: fabricTexture,
  },
];

/** 素材の並び（設定画面もこの順で出す） */
export const MATERIAL_KEYS = DEFS.map((d) => d.key);

/**
 * 何も選んでいないときの素材。
 * 迷ったら**いちばん読みやすいもの**を出す ―― 素材は好みで選ぶ飾りで、
 * 遊べることのほうが先にある。
 */
export const DEFAULT_MATERIAL = 'plain';

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/** 素材を引く。知らない名前なら既定の素材 */
export function materialFor(key) {
  return BY_KEY.get(key) || BY_KEY.get(DEFAULT_MATERIAL);
}

/** 設定画面に並べるための一覧 */
export function materialList() {
  return DEFS.map((d) => ({ key: d.key, name: d.name, note: d.note, swatch: d.colors.lit.mid }));
}

// ---------------------------------------------------------------- 色

/**
 * ブロックの色を決める。
 *
 * 灰色ブロックは素材そのままの色。色つきブロックは、素材の明るいほうの地を
 * 進行度の色相へ引っぱる ―― 引っぱる強さは素材ごと（木を真っ青にすると
 * 木に見えなくなるが、ガラスは何色でもガラスに見える）。
 */
export function paletteFor(mat, isColored, tintHex) {
  const src = isColored ? mat.colors.lit : mat.colors.grey;
  if (!isColored || !tintHex) return { ...src, key: `${mat.key}|grey` };
  /*
   * プレーンだけは素材へ混ぜない。混ぜると明るさが素材の側に引き戻されて、
   * 琥珀まで進んでも青のままの明るさになってしまう ―― 何も乗っていない面では、
   * 進行度の色そのものが見えるのが正しい。
   */
  if (mat.rawTint) {
    return {
      top: shade(tintHex, 0.24),
      mid: tintHex,
      deep: shade(tintHex, -0.3),
      side: shade(tintHex, -0.24),
      key: `${mat.key}|${tintHex}`,
    };
  }
  const k = mat.tint;
  return {
    top: tintTowards(src.top, tintHex, k * 0.9),
    mid: tintTowards(src.mid, tintHex, k),
    deep: tintTowards(src.deep, tintHex, k),
    side: tintTowards(src.side, tintHex, k),
    key: `${mat.key}|${tintHex}`,
  };
}

/**
 * テクスチャを焼くときの色。**進行度では動かさない。**
 *
 * タイル 1 枚を焼くのに数十ミリ秒かかるので、進行度が変わるたびに焼き直すと
 * 遊んでいる最中に引っかかる。そこでタイルは素材そのものの色で 1 度だけ焼き、
 * 進行度の色は描くときに色相だけ被せる（render.js の bakeSurface）。
 * 明るさは被せても変わらないので、木目や石の粒の陰影はそのまま残る。
 */
export function texturePaletteFor(mat, isColored) {
  const src = isColored ? mat.colors.lit : mat.colors.grey;
  return { ...src, key: `${mat.key}|${isColored ? 'lit' : 'grey'}` };
}

/**
 * 盤面（トレイ）の色。
 *
 * **進行度では動かさない。** 動かすと、色が 1 段変わるたびにトレイを丸ごと
 * 焼き直すことになり（枠・床・空きマスの 3 枚のテクスチャと内側の影）、
 * 遊んでいる最中に 90ms 近く止まった。
 * 温度の変化は色つきブロックと背景の光が担っているので、
 * 受け皿は素材そのものの色で据えておくほうが、画面としても落ち着く。
 */
export function trayPaletteFor(mat, tintHex) {
  /*
   * 例外はプレーンだけ。焼くものが「角丸の塗り 2 枚」しか無いので、
   * 色が 1 段動くたびに焼き直しても目に見えるほどの間は空かない ――
   * そのぶん、盤面まで含めて温度が変わる元の見え方が戻ってくる。
   */
  if (mat.trayTint && tintHex) {
    const [h] = rgbHsl(hexRgb(tintHex));
    const plate = rgbHex(hslRgb(h, 30, 89));
    return { frame: plate, floor: plate, well: rgbHex(hslRgb(h, 34, 95)), key: `${mat.key}|tray|${tintHex}` };
  }
  return { ...mat.tray, key: `${mat.key}|tray` };
}

// ---------------------------------------------------------------- タイルの控え

const tileCache = new Map();

/**
 * 素材 × 色 のタイルを 1 枚だけ焼いて使い回す。
 * 1 枚 256×256 の生成に数ミリ秒かかるので、毎フレーム作るわけにはいかない。
 */
export function tileFor(mat, pal) {
  if (!mat.texture) return null; // プレーンは模様を持たない
  const key = `${mat.key}|${pal.top}|${pal.mid}|${pal.deep}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const cv = mat.texture(pal, hashSeed(key));
  // 使い回しが効かないほど溜まったら、古いものから捨てる（進行度で色が動くため）
  if (tileCache.size > 24) tileCache.delete(tileCache.keys().next().value);
  tileCache.set(key, cv);
  return cv;
}

/** 素材を切り替えたときなど、焼いたタイルを全部捨てる */
export function clearTileCache() {
  tileCache.clear();
  scaleCache.clear();
}

const scaleCache = new Map();

/**
 * タイルを実寸に焼き直したもの。
 *
 * **createPattern に拡大縮小を掛けたまま敷いてはいけない。** 繰り返しの継ぎ目に
 * 半端な画素が挟まり、ブロックの上に白い格子の線が走る（実機ではっきり見えた）。
 * 整数の大きさに焼き直してから等倍で敷けば、継ぎ目は原理的に出ない。
 *
 * @param {boolean} turn 90° 回す（木目を長辺に沿わせるとき）。正方形なので
 *   回しても継ぎ目は崩れないし、画素の補間も起きない
 */
export function scaledTile(mat, pal, size, turn = false) {
  if (!mat.texture) return null;
  // 8 の倍数に丸める。下で余白を 1/8 だけ取るので、そこが割り切れないと
  // 縮尺がわずかにずれ、せっかく消した継ぎ目が戻ってくる
  const px = Math.max(16, Math.round(size / 8) * 8);
  const key = `${mat.key}|${pal.top}|${pal.mid}|${pal.deep}|${px}|${turn ? 1 : 0}`;
  const hit = scaleCache.get(key);
  if (hit) return hit;

  const src = tileFor(mat, pal);
  if (!src) return null;

  /*
   * 素のタイルは継ぎ目なく繋がるが、**縮めた瞬間に継ぎ目が戻る** ――
   * drawImage は端の外側を読めないので、右端の画素が左端ではなく自分自身と
   * 混ざり、1 本の線になる。
   *
   * そこで周囲に「回り込んだぶん」の余白を付けてから縮め、中央だけを切り出す。
   * 中央の画素は上下左右に本物の隣を持つので、継ぎ目が生まれない。
   *
   * 余白は 1/8 で足りる。最初は 3×3 に並べていたが、それだと縮小先が
   * 9 倍の面積になり、素材を切り替えるたびに 300ms 近く固まった。
   */
  const m = TILE / 8;
  const sw = TILE + m * 2;
  const pm = px / 8;
  const pw = px + pm * 2;

  const rep = makeCanvas(sw, sw);
  const wide = makeCanvas(pw, pw);
  const cv = makeCanvas(px, px);
  if (!rep || !wide || !cv) return null;

  const rctx = rep.getContext('2d');
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) rctx.drawImage(src, m + i * TILE, m + j * TILE);
  }

  const wctx = wide.getContext('2d');
  wctx.imageSmoothingEnabled = true;
  if (wctx.imageSmoothingQuality) wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(rep, 0, 0, pw, pw);

  const ctx = cv.getContext('2d');
  if (turn) {
    ctx.translate(px, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(wide, pm, pm, px, px, 0, 0, px, px);

  if (scaleCache.size > 32) scaleCache.delete(scaleCache.keys().next().value);
  scaleCache.set(key, cv);
  return cv;
}

// ---------------------------------------------------------------- 面取りの陰影

/**
 * 面取りの 1 面の明るさ。法線 (nx, ny) が光のほうを向くほど明るい。
 *
 * 金属だけ返り方を変えてある ―― 磨いた金属は拡散光をほとんど返さず、
 * 光源の**鏡像**を返す。だから上の面が明るいだけでなく、下の面も
 * （周りの明るい床を映して）明るくなる。この 2 つ目の山が無いと、
 * どれだけ磨いても「灰色のプラスチック」にしか見えない。
 */
export function facetShade(mat, nx, ny) {
  const d = nx * LIGHT.x + ny * LIGHT.y;
  if (mat.key === 'metal' || mat.key === 'crystal') {
    const direct = Math.max(0, d);
    const bounce = Math.max(0, -d); // 下から返ってくる環境光
    // 面ごとの差を大きく取る。差が小さいと、磨いた面ではなく
    // 「灰色のプラスチックに角を付けたもの」にしか見えない
    return 0.34 + Math.pow(direct, 1.15) * 1.05 + Math.pow(bounce, 2.2) * 0.5;
  }
  return 0.62 + Math.max(0, d) * 0.62 + Math.max(0, -d) * 0.06;
}

/** 面取りの 1 面の色 */
export function facetColor(mat, pal, nx, ny) {
  const s = facetShade(mat, nx, ny);
  const base = pal.mid;
  return s >= 1 ? shade(base, (s - 1) * 0.9) : mixHex(pal.deep, base, clip(s, 0, 1));
}

/** ブロックの縁に引く 1 本の線。地より少し濃いだけにして、輪郭を主張させない */
export function edgeColor(pal) {
  return luma(pal.deep) > 140 ? shade(pal.deep, -0.22) : shade(pal.deep, -0.3);
}

/** 効果（破片・光の輪）に使う代表色。素材が変わっても演出の色が浮かないように */
export function effectColors(mat, pal) {
  return {
    base: pal.mid,
    light: shade(pal.top, 0.18),
    dark: pal.deep,
    shadow: hexRgb(pal.deep).join(','),
  };
}
