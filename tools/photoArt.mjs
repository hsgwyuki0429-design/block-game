// クリスタルの見た目を「写真」から作る。
//
// この素材だけは、模様を手続き的に描いていない ―― 実機のスクリーンショットから
// ブロックを 1 個ずつ切り出して、それをそのまま貼っている。ガラスの面取りや
// 内部反射は、計算で真似るより本物を貼るほうが速いし、確かに本物に見える。
//
//   node tools/photoArt.mjs --shots a.png b.png ...
//     スクリーンショットから art/crystal/*.png を切り出す。
//     写真には**切り取る範囲を赤い長方形で囲って**おくこと（手描きでよい。
//     多少ずれていても、盤面の格子に載せ直すので問題ない）。
//     囲った長方形が盤面をちょうど埋め尽くしていることだけが条件。
//
//   node tools/photoArt.mjs [--check]
//     art/crystal/*.png を src/photoArt.js（データ URI）へ焼き直す。
//     --check は焼き直しが要るかどうかだけを見る（テストから使う）。
//
// 依存パッケージは足さない。PNG は node:zlib だけで読み書きしている
// （PNG の中身は「zlib で固めた生のピクセル行」なので、これで足りる）。

import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(ROOT, 'art/crystal');
const OUT = resolve(ROOT, 'src/photoArt.js');

/**
 * 1 マスぶんの画素数。
 *
 * 貼るときは 9 分割で引き伸ばすので、ブロックが何マスでもこの解像度で足りる。
 * 端末のマスは大きくても 200px ほど（4×4 の盤面 × Retina）なので、
 * 160 なら拡大しても面取りの稜線が崩れない。上げるとそのぶん app.js が太る。
 */
const UNIT = 160;

/**
 * 切り出す形。9 分割で任意の大きさに伸ばせるが、写真ごとに艶の出方が違うので、
 * 縦長・横長・大きい塊はそれぞれの写真を持っておく（貼るときに近い比率を選ぶ）。
 */
const SHAPES = ['1x1', '2x1', '1x2', '2x2'];

// ---------------------------------------------------------------- PNG

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** 8bit・非インタレースの PNG を RGBA へ広げて読む */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではない');
  let p = 8;
  let w = 0;
  let h = 0;
  let ctype = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ctype = data[9];
      if (data[8] !== 8) throw new Error(`ビット深度 ${data[8]} は読めない`);
      if (data[12] !== 0) throw new Error('インタレース PNG は読めない');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`カラータイプ ${ctype} は読めない`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[off++];
    const line = Buffer.from(raw.subarray(off, off + stride));
    off += stride;
    // PNG のフィルタを戻す（1 行ずつ、左と上の画素からの差分になっている）
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch;
      const d = (y * w + x) * 4;
      const g = line[s];
      if (ch <= 2) { out[d] = g; out[d + 1] = g; out[d + 2] = g; out[d + 3] = ch === 2 ? line[s + 1] : 255; }
      else { out[d] = g; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = ch === 4 ? line[s + 3] : 255; }
    }
    prev = line;
  }
  return { width: w, height: h, data: out };
}

/**
 * 8bit グレースケールの PNG を書く。
 * 写真は色をほとんど持っていない（無色のガラス）ので、明暗だけを残せば
 * 画素あたり 1 バイトで済む。色は貼るときに被せる ―― そのほうが、
 * 進行度で色が変わっても写真の陰影がそのまま残る。
 */
function encodeGray(w, h, px) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 1; // Sub フィルタ。なだらかな階調はこれがいちばん縮む
    for (let x = 0; x < w; x++) {
      raw[y * (w + 1) + 1 + x] = (px[y * w + x] - (x ? px[y * w + x - 1] : 0)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 0; // カラータイプ 0 = グレースケール
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 写真から切り出す

const LUM = (d, i) => 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];

/** 手描きの赤い注釈線 */
function redMask(img) {
  const n = img.width * img.height;
  const red = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = img.data[o];
    if (r > 110 && r - img.data[o + 1] > 45 && r - img.data[o + 2] > 45) red[i] = 1;
  }
  return red;
}

/** 赤い線のかたまりごとの外接矩形 */
function redBoxes(img, red) {
  const { width: W, height: H } = img;
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!red[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let x0 = W; let y0 = H; let x1 = -1; let y1 = -1; let n = 0;
    while (stack.length) {
      const j = stack.pop();
      n++;
      const x = j % W;
      const y = (j / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (red[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
    }
    if (n > 300) out.push({ x0, y0, x1, y1 });
  }
  return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/**
 * 1 本の軸について「格子の原点・1 マスの幅・枠のはみ出し」を最小二乗で解く。
 *
 * **はみ出しを未知数に入れておくのが要点。** 赤い長方形は手描きなので、
 * ブロックより必ずひとまわり大きく描かれる。それを無視して端の値をそのまま
 * 使うと、盤面が縦にも横にも 1 割ほど大きく見積もられ、切り出しが目地に食い込む。
 */
function fitAxis(samples) {
  let n = 0; let si = 0; let ss = 0; let sv = 0;
  let sii = 0; let sis = 0; let sss = 0; let siv = 0; let ssv = 0;
  for (const { i, v, end } of samples) {
    const s = end ? 1 : -1;
    n++; si += i; ss += s; sv += v;
    sii += i * i; sis += i * s; sss += 1; siv += i * v; ssv += s * v;
  }
  const A = [[n, si, ss], [si, sii, sis], [ss, sis, sss]];
  const B = [sv, siv, ssv];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 3; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  return { base: B[0] / A[0][0], step: B[1] / A[1][1], over: B[2] / A[2][2] };
}

/**
 * 盤面の格子を割り出す。
 * 一辺のマス数 n は「赤い長方形がぴったり格子に載り、かつ盤面を n×n 埋め尽くす」
 * ものを選ぶ ―― 埋め尽くしの条件があるので、まず 1 通りしか通らない。
 */
function boardGrid(boxes) {
  const X0 = Math.min(...boxes.map((b) => b.x0));
  const X1 = Math.max(...boxes.map((b) => b.x1));
  const Y0 = Math.min(...boxes.map((b) => b.y0));
  const Y1 = Math.max(...boxes.map((b) => b.y1));
  let best = null;
  for (let n = 3; n <= 12; n++) {
    const cw = (X1 - X0) / n;
    const ch = (Y1 - Y0) / n;
    let cells = 0;
    let ok = true;
    const at = boxes.map((b) => {
      const c0 = Math.round((b.x0 - X0) / cw);
      const c1 = Math.round((b.x1 - X0) / cw);
      const r0 = Math.round((b.y0 - Y0) / ch);
      const r1 = Math.round((b.y1 - Y0) / ch);
      if (c1 <= c0 || r1 <= r0) ok = false;
      else cells += (c1 - c0) * (r1 - r0);
      return { c0, c1, r0, r1 };
    });
    if (!ok || cells !== n * n) continue;
    const fx = fitAxis(boxes.flatMap((b, k) => [
      { i: at[k].c0, v: b.x0, end: false }, { i: at[k].c1, v: b.x1, end: true },
    ]));
    const fy = fitAxis(boxes.flatMap((b, k) => [
      { i: at[k].r0, v: b.y0, end: false }, { i: at[k].r1, v: b.y1, end: true },
    ]));
    let err = 0;
    boxes.forEach((b, k) => {
      err += Math.abs(b.x0 - (fx.base + at[k].c0 * fx.step - fx.over))
        + Math.abs(b.x1 - (fx.base + at[k].c1 * fx.step + fx.over))
        + Math.abs(b.y0 - (fy.base + at[k].r0 * fy.step - fy.over))
        + Math.abs(b.y1 - (fy.base + at[k].r1 * fy.step + fy.over));
    });
    const score = err / (boxes.length * 4);
    /*
     * **いちばん小さい n を採る。** n が通れば 2n も 3n も通ってしまう
     * （どのブロックも整数マスのまま細かく割れるので、埋め尽くしの条件が
     * そのまま成り立つ）。細かいほうを採ると、1×1 が 3×3 と数えられて
     * 切り出しの形が全部ずれる ―― 実際そうなった。
     */
    if (score < fx.step * 0.12) { best = { n, at, fx, fy, score }; break; }
    if (!best || score < best.score) best = { n, at, fx, fy, score };
  }
  if (!best) throw new Error('赤い長方形が盤面を埋め尽くしていない（囲み忘れがある）');
  return best;
}

/**
 * 格子線（＝目地の中心）から内へ向かって、ブロックの縁を探す。
 * 目地はいちばん暗く、面取りはいちばん明るい。その中間の高さに達したところが縁。
 */
function edgeFrom(img, red, side, line, a0, a1, reach) {
  const { width: W, data } = img;
  const prof = [];
  for (let k = 0; k < reach; k++) {
    let sum = 0;
    let cnt = 0;
    for (let a = a0; a <= a1; a++) {
      const x = side === 'left' ? line + k : side === 'right' ? line - k : a;
      const y = side === 'top' ? line + k : side === 'bottom' ? line - k : a;
      const i = y * W + x;
      if (red[i]) continue;
      sum += LUM(data, i);
      cnt++;
    }
    prof.push(cnt ? sum / cnt : NaN);
  }
  let low = 0;
  for (let k = 0; k < Math.min(reach, 10); k++) if (!(prof[k] >= prof[low])) low = k;
  let high = low;
  for (let k = low; k < reach; k++) if (prof[k] > prof[high]) high = k;
  const half = (prof[low] + prof[high]) / 2;
  for (let k = low; k <= high; k++) if (prof[k] >= half) return k;
  return Math.round(reach * 0.4);
}

const median = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];

function crop(img, x0, y0, x1, y1) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.width + x0) * 4;
    img.data.copy(data, y * w * 4, s, s + w * 4);
  }
  return { width: w, height: h, data };
}

/** 1 枚のスクリーンショットから、囲まれたブロックを全部取り出す */
function harvest(file) {
  const img = decodePng(readFileSync(file));
  const red = redMask(img);
  const boxes = redBoxes(img, red);
  if (boxes.length < 2) throw new Error(`${basename(file)}: 赤い長方形が見つからない`);
  const { at, fx, fy } = boardGrid(boxes);

  // 目地の幅は 1 辺ずつ測ると外れやすい（角の面取りを掴んでしまう）。
  // 盤面ぜんぶで測って中央値を採ると、1 枚のなかでは必ず同じ幅になる
  const reachX = Math.round(fx.step * 0.2);
  const reachY = Math.round(fy.step * 0.2);
  const gapsX = [];
  const gapsY = [];
  for (const p of at) {
    const gx0 = Math.round(fx.base + p.c0 * fx.step);
    const gx1 = Math.round(fx.base + p.c1 * fx.step);
    const gy0 = Math.round(fy.base + p.r0 * fy.step);
    const gy1 = Math.round(fy.base + p.r1 * fy.step);
    const my0 = Math.round(gy0 + (gy1 - gy0) * 0.35);
    const my1 = Math.round(gy0 + (gy1 - gy0) * 0.65);
    const mx0 = Math.round(gx0 + (gx1 - gx0) * 0.35);
    const mx1 = Math.round(gx0 + (gx1 - gx0) * 0.65);
    gapsX.push(edgeFrom(img, red, 'left', gx0, my0, my1, reachX));
    gapsX.push(edgeFrom(img, red, 'right', gx1, my0, my1, reachX));
    gapsY.push(edgeFrom(img, red, 'top', gy0, mx0, mx1, reachY));
    gapsY.push(edgeFrom(img, red, 'bottom', gy1, mx0, mx1, reachY));
  }
  const gapX = median(gapsX);
  const gapY = median(gapsY);

  return at.map((p) => {
    let x0 = Math.round(fx.base + p.c0 * fx.step) + gapX;
    let x1 = Math.round(fx.base + p.c1 * fx.step) - gapX;
    let y0 = Math.round(fy.base + p.r0 * fy.step) + gapY;
    let y1 = Math.round(fy.base + p.r1 * fy.step) - gapY;
    // 注釈の赤が縁に残っていたら、消えるまで削る（隣の枠線を巻き込むことがある）
    const onEdge = (side) => {
      const [a0, a1] = side === 'top' || side === 'bottom' ? [x0, x1] : [y0, y1];
      for (let a = a0; a <= a1; a++) {
        const x = side === 'left' ? x0 : side === 'right' ? x1 : a;
        const y = side === 'top' ? y0 : side === 'bottom' ? y1 : a;
        if (red[y * img.width + x]) return true;
      }
      return false;
    };
    for (let i = 0; i < 24; i++) {
      let cut = false;
      if (onEdge('left')) { x0++; cut = true; }
      if (onEdge('right')) { x1--; cut = true; }
      if (onEdge('top')) { y0++; cut = true; }
      if (onEdge('bottom')) { y1--; cut = true; }
      if (!cut) break;
    }
    const im = crop(img, x0, y0, x1, y1);
    let dr = 0;
    for (let i = 0; i < im.width * im.height; i++) dr += im.data[i * 4 + 2] - im.data[i * 4];
    return {
      cols: p.c1 - p.c0,
      rows: p.r1 - p.r0,
      colored: dr / (im.width * im.height) > 16,
      img: im,
    };
  });
}

// ---------------------------------------------------------------- 仕上げ

/**
 * 角に残った盤面を、ガラスで埋める。
 *
 * 切り出しは長方形だが、ブロックの角は 45° に落ちている ―― そのままだと
 * 四隅に盤面の色が三角形で残る。貼る側は同じ角度で切り抜くので、本当は
 * 残っていても隠れるのだが、切り抜きの角度がわずかにずれただけで
 * 角に灰色の点が出る。**盤面だった画素だけ**をガラスで埋めておけば、
 * どちらにずれても汚れない ―― 面取りの稜線には触らないので、角の切子は残る。
 */
function fillCorners(im) {
  const { width: w, height: h, data } = im;
  const outside = new Uint8Array(w * h);
  const stack = [];
  // 四隅から、その角の色に近いところだけを塗り広げる。
  // ブロックの縁には必ず暗い目地の影が回っているので、そこで止まる
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const base = LUM(data, cy * w + cx);
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const k = y * w + x;
      if (outside[k]) return;
      if (Math.abs(LUM(data, k) - base) > 10) return;
      outside[k] = 1;
      stack.push(k);
    };
    push(cx, cy);
    while (stack.length) {
      const k = stack.pop();
      const x = k % w;
      const y = (k / w) | 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
  }
  // 内側のガラスを 1 画素ずつ外へ広げて埋める
  for (let pass = 0; pass < Math.max(w, h); pass++) {
    const edge = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!outside[y * w + x]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (outside[ny * w + nx]) continue;
          edge.push([x, y, nx, ny]);
          break;
        }
      }
    }
    if (!edge.length) break;
    for (const [x, y, nx, ny] of edge) {
      data.copy(data, (y * w + x) * 4, (ny * w + nx) * 4, (ny * w + nx) * 4 + 4);
    }
    for (const [x, y] of edge) outside[y * w + x] = 0;
  }
}

/** 三角フィルタで拡大縮小（縮小は面積平均に近く、拡大は線形補間になる） */
function resample(src, w, h) {
  const { width: sw, height: sh, data } = src;
  const mid = new Float32Array(w * sh);
  const pass = (inN, outN, lines, get, put) => {
    const scale = inN / outN;
    const sup = Math.max(1, scale);
    for (let o = 0; o < outN; o++) {
      const c = (o + 0.5) * scale - 0.5;
      const i0 = Math.ceil(c - sup);
      const i1 = Math.floor(c + sup);
      const ws = [];
      let sum = 0;
      for (let i = i0; i <= i1; i++) {
        const t = Math.abs((i - c) / sup);
        const g = t >= 1 ? 0 : 1 - t;
        ws.push(g);
        sum += g;
      }
      for (let l = 0; l < lines; l++) {
        let acc = 0;
        for (let i = i0, k = 0; i <= i1; i++, k++) {
          acc += get(Math.min(inN - 1, Math.max(0, i)), l) * ws[k];
        }
        put(o, l, acc / sum);
      }
    }
  };
  pass(sw, w, sh, (x, y) => LUM(data, y * sw + x), (x, y, v) => { mid[y * w + x] = v; });
  const out = new Uint8Array(w * h);
  pass(sh, h, w, (y, x) => mid[y * w + x],
    (y, x, v) => { out[y * w + x] = Math.max(0, Math.min(255, Math.round(v))); });
  return out;
}

/**
 * 3×3 の平均でならす。
 * 写真は端末の画面を撮ったものなので、目に見えないくらいの圧縮のざらつきが
 * 全面に乗っている。階調そのものは変わらないのに PNG が 4 割太るので、
 * ここで落としておく ―― ガラスは元からなめらかで、失うものが無い。
 */
function denoise(px, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(w - 1, Math.max(0, x + dx));
          const ny = Math.min(h - 1, Math.max(0, y + dy));
          sum += px[ny * w + nx];
        }
      }
      out[y * w + x] = Math.round(sum / 9);
    }
  }
  return out;
}

function buildArt(files) {
  const found = new Map();
  for (const file of files) {
    for (const block of harvest(file)) {
      // 色つきブロックは要らない。進行度で色が変わるので、無色のガラスに
      // 色相を被せるほうが正しく、写真も半分で済む（明暗はそのまま残る）
      if (block.colored) continue;
      const key = `${block.cols}x${block.rows}`;
      if (!SHAPES.includes(key)) continue;
      const cur = found.get(key);
      const area = block.img.width * block.img.height;
      if (!cur || area > cur.img.width * cur.img.height) found.set(key, block);
    }
  }
  const missing = SHAPES.filter((s) => !found.has(s));
  if (missing.length) {
    throw new Error(`写真に ${missing.join(' / ')} のブロックが無い`
      + `（見つかったのは ${[...found.keys()].join(' ')}）`);
  }

  mkdirSync(ART, { recursive: true });
  for (const key of SHAPES) {
    const block = found.get(key);
    const { cols, rows, img } = block;
    fillCorners(img);
    const px = denoise(resample(img, cols * UNIT, rows * UNIT), cols * UNIT, rows * UNIT);
    const png = encodeGray(cols * UNIT, rows * UNIT, px);
    writeFileSync(resolve(ART, `${key}.png`), png);
    console.log(`art/crystal/${key}.png  ${cols * UNIT}x${rows * UNIT}  `
      + `${(png.length / 1024).toFixed(1)}KB  <- 写真の ${img.width}x${img.height}`);
  }
}

// ---------------------------------------------------------------- モジュールを焼く

function bake() {
  const files = readdirSync(ART).filter((f) => f.endsWith('.png')).sort();
  const entries = files.map((f) => {
    const key = basename(f, '.png');
    const [cols, rows] = key.split('x').map(Number);
    const b64 = readFileSync(resolve(ART, f)).toString('base64');
    return { key, cols, rows, b64 };
  });
  const list = entries.map((e) => `  { cols: ${e.cols}, rows: ${e.rows}, src: '${DATA}${e.b64}' },`).join('\n');
  return `${HEAD}\nexport const PHOTO_UNIT = ${UNIT};\n\n`
    + `/** 写真 1 枚ぶん。cols/rows はもとのブロックが何マスだったか */\n`
    + `const PHOTOS = [\n${list}\n];\n${TAIL}`;
}

const DATA = 'data:image/png;base64,';

const HEAD = `// クリスタルの写真。tools/photoArt.mjs が art/crystal/*.png から生成。直接編集しないこと。
//
// **なぜ画像を JS に埋めているか。** 別ファイルで配ると、Service Worker が
// 先読みする一覧に足す必要があり、足し忘れると「機内モードで素材を切り替えたら
// ブロックが消える」という直しにくい壊れ方をする。app.js に混ぜてあれば、
// app.js のハッシュが変わり、先読みも版ずれの心配もまとめて片づく。
//
// 中身は無色（グレースケール）。色は貼るときに被せる ―― そうすれば
// 進行度で色が変わっても、ガラスの陰影はそのまま残る。
`;

const TAIL = `
/** 読み込み済みの画像。読めるまでは null（そのあいだは無地で描く） */
const loaded = PHOTOS.map(() => null);
let pending = 0;
let onReady = null;

/**
 * 写真を読み込む。データ URI なので通信は起きないが、復号は非同期なので、
 * 読み終わったところで一度だけ知らせる（焼いてある絵を捨てさせるため）。
 */
export function loadPhotos(done) {
  onReady = done;
  if (typeof Image === 'undefined') return;
  if (pending || loaded.some((v) => v)) return;
  pending = PHOTOS.length;
  PHOTOS.forEach((p, i) => {
    const im = new Image();
    im.onload = () => {
      loaded[i] = im;
      pending--;
      if (!pending && onReady) onReady();
    };
    im.onerror = () => {
      pending--;
      if (!pending && onReady) onReady();
    };
    im.src = p.src;
  });
}

/**
 * cols×rows のブロックに貼る写真を選ぶ。
 *
 * 縦横の比がいちばん近いものを採り、比が同じなら大きいほうを採る ――
 * 引き伸ばすのは中央だけ（9 分割）なので、比さえ合っていれば
 * 面取りの太さは崩れない。写真の無い形は、いちばん近い形から作られる。
 */
export function photoFor(cols, rows) {
  const want = Math.log(cols / rows);
  let best = -1;
  let score = Infinity;
  for (let i = 0; i < PHOTOS.length; i++) {
    if (!loaded[i]) continue;
    const p = PHOTOS[i];
    const d = Math.abs(Math.log(p.cols / p.rows) - want) * 8
      + Math.abs(Math.log((p.cols * p.rows) / (cols * rows)));
    if (d < score) { score = d; best = i; }
  }
  return best < 0 ? null : loaded[best];
}

/** 写真がまだ 1 枚も読めていない（＝無地で描くしかない） */
export function photosReady() {
  return loaded.some((v) => v);
}
`;

// ---------------------------------------------------------------- 実行

const argv = process.argv.slice(2);
const shotAt = argv.indexOf('--shots');
if (shotAt >= 0) {
  const files = argv.slice(shotAt + 1).filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('使い方: node tools/photoArt.mjs --shots <スクリーンショット.png> ...');
    process.exit(1);
  }
  buildArt(files);
}

const code = bake();
if (argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(OUT, 'utf8'); } catch { cur = ''; }
  if (cur !== code) {
    console.error('src/photoArt.js が art/crystal/*.png と食い違っています。'
      + '`node tools/photoArt.mjs` を実行してください。');
    process.exit(1);
  }
  console.log('写真は最新です');
} else {
  writeFileSync(OUT, code);
  console.log(`src/photoArt.js を生成しました (${(code.length / 1024).toFixed(1)}KB)`);
}
