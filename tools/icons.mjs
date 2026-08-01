// ホーム画面用アイコンを生成する。
//
//   node tools/icons.mjs [--check]
//     --check : 生成物が最新かどうかだけ確かめる（テストから使う）
//
// 依存パッケージは足さない。PNG は node:zlib だけで自前に書き出している
// （PNG の中身は「zlib で固めた生のピクセル行」なので、これで足りる）。
// 絵はゲームそのもの ―― 淡い盤面の上に、4 色のテトロミノ的な角丸タイル。
// 4 倍で描いてから縮小しているので、角の丸みはなめらかに出る。

import { deflateSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'icons');

/** 描く色（ゲーム内の色と揃えてある） */
const BG = [0xee, 0xf1, 0xf8];
const PLATE = [0xdd, 0xe2, 0xf0];
const TILES = ['#3f8ede', '#d94a41', '#4fa83f', '#e0a52c'].map(hexToRgb);

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// ---------------------------------------------------------------- PNG 出力

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

/** RGB のピクセル配列（Uint8Array, 幅×高さ×3）を PNG バイト列にする */
function encodePng(rgb, size) {
  // 各行の先頭にフィルタ種別バイト（0 = フィルタなし）を挟むのが PNG の生データ形式
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // ビット深度
  ihdr[9] = 2;  // カラータイプ 2 = トゥルーカラー（アルファなし）
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 作図

/** 4 倍の解像度で描いてから平均で縮小する（＝アンチエイリアス） */
const SS = 4;

function makeCanvas(size) {
  const w = size * SS;
  const px = new Uint8Array(w * w * 3);
  return {
    w,
    px,
    fill(color) {
      for (let i = 0; i < px.length; i += 3) {
        px[i] = color[0];
        px[i + 1] = color[1];
        px[i + 2] = color[2];
      }
    },
    /** 角丸の矩形（座標はすべて 1 倍系で受け取る） */
    roundRect(x, y, rw, rh, r, color) {
      const x0 = Math.round(x * SS);
      const y0 = Math.round(y * SS);
      const x1 = Math.round((x + rw) * SS);
      const y1 = Math.round((y + rh) * SS);
      const rr = r * SS;
      for (let py = Math.max(0, y0); py < Math.min(w, y1); py++) {
        for (let pxx = Math.max(0, x0); pxx < Math.min(w, x1); pxx++) {
          // 角の内側かどうかを、四隅の中心からの距離で判定する
          const dx = Math.max(x0 + rr - pxx - 0.5, 0, pxx + 0.5 - (x1 - rr));
          const dy = Math.max(y0 + rr - py - 0.5, 0, py + 0.5 - (y1 - rr));
          if (dx * dx + dy * dy > rr * rr) continue;
          const i = (py * w + pxx) * 3;
          px[i] = color[0];
          px[i + 1] = color[1];
          px[i + 2] = color[2];
        }
      }
    },
    /** 平均で 1/SS に縮小して RGB 配列を返す */
    downsample(size2) {
      const out = new Uint8Array(size2 * size2 * 3);
      const n = SS * SS;
      for (let y = 0; y < size2; y++) {
        for (let x = 0; x < size2; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
              const i = ((y * SS + sy) * w + (x * SS + sx)) * 3;
              r += px[i];
              g += px[i + 1];
              b += px[i + 2];
            }
          }
          const o = (y * size2 + x) * 3;
          out[o] = Math.round(r / n);
          out[o + 1] = Math.round(g / n);
          out[o + 2] = Math.round(b / n);
        }
      }
      return out;
    },
  };
}

/**
 * アイコンを 1 枚描く。
 * @param {number} size   出力の一辺（px）
 * @param {number} inset  絵を内側に寄せる割合。マスカブルは 0.18（安全領域）
 */
function drawIcon(size, inset = 0.06) {
  const c = makeCanvas(size);
  c.fill(BG);

  const art = size * (1 - inset * 2);
  const ox = size * inset;
  const oy = size * inset;

  // 盤面（うっすら濃い台）
  c.roundRect(ox, oy, art, art, art * 0.2, PLATE);

  // 2×2 のタイル。すき間はゲームと同じく「ほんの少し」
  const pad = art * 0.1;
  const gap = art * 0.035;
  const cell = (art - pad * 2 - gap) / 2;
  const r = cell * 0.2;
  const at = [[0, 0], [1, 0], [0, 1], [1, 1]];
  at.forEach(([gx, gy], i) => {
    c.roundRect(ox + pad + gx * (cell + gap), oy + pad + gy * (cell + gap), cell, cell, r, TILES[i]);
  });

  return encodePng(c.downsample(size), size);
}

// ---------------------------------------------------------------- 実行

const FILES = [
  { name: 'icon-192.png', size: 192, inset: 0.06 },
  { name: 'icon-512.png', size: 512, inset: 0.06 },
  // マスカブルは端末側で円などに切り抜かれるので、絵を安全領域（中央 80%）に収める
  { name: 'icon-maskable-512.png', size: 512, inset: 0.19 },
  // iOS はアイコンを自分で角丸にするので、こちらは余白少なめの不透明な正方形
  { name: 'apple-touch-icon.png', size: 180, inset: 0.05 },
];

const built = FILES.map((f) => ({ ...f, data: drawIcon(f.size, f.inset) }));

if (process.argv.includes('--check')) {
  let stale = false;
  for (const f of built) {
    const cur = await readFile(resolve(OUT_DIR, f.name)).catch(() => null);
    if (!cur || !cur.equals(f.data)) {
      console.error(`icons/${f.name} が古い（または存在しない）。\`npm run icons\` を実行してください。`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log('アイコンは最新です');
} else {
  await mkdir(OUT_DIR, { recursive: true });
  for (const f of built) {
    await writeFile(resolve(OUT_DIR, f.name), f.data);
    const sum = createHash('sha256').update(f.data).digest('hex').slice(0, 8);
    console.log(`icons/${f.name.padEnd(24)} ${String(f.size).padStart(3)}px  ${(f.data.length / 1024).toFixed(1)}KB  ${sum}`);
  }
}
