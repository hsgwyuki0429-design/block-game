#!/usr/bin/env python3
"""クリスタルのブロックの絵を、実機のスクリーンショットから切り出す。

    python3 tools/crop-crystal.py <lv1.png> <lv4.png> <lv8.png> <lv18.png>

ビルドにもテストにも組み込んでいない ―― 絵を作り直すときだけ手で回す道具。
Pillow と numpy が要る（`pip install pillow numpy`）。元のスクリーンショットは
重いのでリポジトリには置いていない。出来上がった 9 枚だけが assets/crystal/ に入る。

== なぜこの 4 枚なのか ==

ブロックの形は 8 種類しかない（src/shapes.js の長方形だけ）。全レベルの譜面を
デコードして、「8 形すべてが灰色で写り、かつ 1 マスがいちばん大きく写る」
最小の組を探した結果がこの 4 つ:

    レベル 1  (4x4)  3x3
    レベル 4  (5x5)  1x3 / 3x1 / 3x2
    レベル 8  (4x4)  1x2 / 2x1 / 2x2
    レベル 18 (5x5)  2x3

盤が小さいレベルほど 1 マスが大きく写る＝切り出した絵の解像度が上がるので、
覆う数より盤の小ささを優先して選んである。

色つきブロックは撮らない。色つきの色相は残り手数の目盛りとして動くので、
写真 1 枚では押さえられない ―― 無色ガラスの絵に色相を被せて作る（render.js）。

== 盤の位置の当て方 ==

縁を探して当てるやり方は当たらなかった（面取りが太く、縁が 1 本の線ではなく
帯になる）。当てにできるのはレベルデータのほうで、

    ・ブロックの境目に当たる線には強い縁があるはず
    ・ブロックの内側を横切る線には縁が無いはず（1 個の塊なので）

この差が最大になる (盤の一辺, 原点) を探す。内側への罰が無いと、格子が
マス 1 つぶんずれても同じ点になってしまう。
出発点はアプリ自身の寸法（393pt 幅で盤は 340pt の正方形、上端 274.4pt）。
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'crystal'

# アプリを 393pt 幅で開いたときの盤の矩形（CSS px）。写真はこれを等倍で拡大したもの
CSS_W, BOARD_X, BOARD_Y, BOARD_S = 393.0, 26.0, 274.390625, 340.0

# 形 -> (レベル, 左上のマス)。上の表のとおり
PICK = {
    '3x3': (1, 0, 0),
    '1x3': (18, 2, 0),
    '3x1': (4, 2, 2),
    '3x2': (4, 0, 0),
    '1x2': (8, 1, 0),
    '2x1': (8, 2, 0),
    '2x2': (8, 0, 2),
    '2x3': (18, 3, 2),
}
# 空きマスの窪み。両隣も空きのところを選ぶ ―― 隣がブロックだと、その面取りが
# マスの中へわずかに食い込んでいて、窪みの絵に紛れ込む
EMPTY = (1, 3, 3)

# 切り出しの内寄せ（マスの一辺に対する比）。ブロックの絵はマスの矩形から
# ほんの少しはみ出しているので、ちょうどで切ると隣の色つきが混ざる。
# 貼るときはほぼ 0 まで詰めて戻す（src/sprites.js の SPRITE_INSET）
INSET = 0.03


def layouts(levels):
    """レベル -> ブロックの並び。src/levelCodec.js にそのまま訊く"""
    script = '''
      import("%s/src/levelData.js").then(async (m) => {
        const { decodeLevel } = await import("%s/src/levelCodec.js");
        const out = {};
        for (const lv of %s) {
          const p = decodeLevel(m.LEVEL_CODES[lv - 1]);
          out[lv] = { size: p.size,
            pieces: p.pieces.map((x) => ({ c: x.c, w: x.w, h: x.h, x: x.s[0][0], y: x.s[0][1] })) };
        }
        console.log(JSON.stringify(out));
      });
    ''' % (ROOT, ROOT, list(levels))
    return json.loads(subprocess.run(['node', '-e', script], capture_output=True,
                                     check=True, text=True).stdout)


def edges(path):
    """縦線 / 横線の強さ。面取りの帯を ±3px の最大で 1 本に畳んでから積分しておく"""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    lum = a.mean(axis=2)
    gx = np.abs(np.diff(lum, axis=1, append=lum[:, -1:]))
    gy = np.abs(np.diff(lum, axis=0, append=lum[-1:, :]))
    for s in (1, 2, 3):
        gx = np.maximum(gx, np.maximum(np.roll(gx, s, 1), np.roll(gx, -s, 1)))
        gy = np.maximum(gy, np.maximum(np.roll(gy, s, 0), np.roll(gy, -s, 0)))
    return np.cumsum(gx, axis=0), np.cumsum(gy, axis=1), lum.shape


def fit(path, layout, wide):
    """写真の中の盤の矩形 (一辺, 原点x, 原点y) を返す"""
    cx, cy, (H, W) = edges(path)
    n = layout['size']
    ps = layout['pieces']

    def vs(x, ya, yb):
        x = int(round(x)); ya = max(0, min(H - 1, int(ya))); yb = max(0, min(H - 1, int(yb)))
        return 0.0 if (x < 0 or x >= W or yb <= ya) else float(cx[yb, x] - cx[ya, x]) / (yb - ya)

    def hs(y, xa, xb):
        y = int(round(y)); xa = max(0, min(W - 1, int(xa))); xb = max(0, min(W - 1, int(xb)))
        return 0.0 if (y < 0 or y >= H or xb <= xa) else float(cy[y, xb] - cy[y, xa]) / (xb - xa)

    def score(side, ox, oy):
        cell = side / n
        good = bad = 0.0
        for p in ps:
            xa, ya = ox + p['x'] * cell, oy + p['y'] * cell
            xb, yb = xa + p['w'] * cell, ya + p['h'] * cell
            good += vs(xa, ya, yb) + vs(xb, ya, yb) + hs(ya, xa, xb) + hs(yb, xa, xb)
            for i in range(1, p['w']):
                bad += vs(xa + i * cell, ya, yb)
            for j in range(1, p['h']):
                bad += hs(ya + j * cell, xa, xb)
        return good - 1.5 * bad

    if wide:                                  # 全画面のスクリーンショット
        k = W / CSS_W
        s0, x0, y0 = BOARD_S * k, BOARD_X * k, BOARD_Y * k
        ranges = (np.arange(s0 - 40, s0 + 41, 2),
                  np.arange(x0 - 30, x0 + 31, 2), np.arange(y0 - 60, y0 + 61, 2))
    else:                                     # 盤だけ切り抜かれた画像
        ranges = (np.arange(W * 0.55, W * 0.78, 3),
                  np.arange(W * 0.08, W * 0.26, 3), np.arange(H * 0.15, H * 0.36, 3))
    best = None
    for side in ranges[0]:
        for ox in ranges[1]:
            for oy in ranges[2]:
                v = score(side, ox, oy)
                if best is None or v > best[0]:
                    best = (v, side, ox, oy)
    for step in (1.0, 0.5, 0.25):
        _, side, ox, oy = best
        for s in np.arange(side - 4, side + 4.01, step):
            for x in np.arange(ox - 4, ox + 4.01, step):
                for y in np.arange(oy - 4, oy + 4.01, step):
                    v = score(s, x, y)
                    if v > best[0]:
                        best = (v, s, x, y)
    return best[1], best[2], best[3]


def dirty_sides(layout, cx, cy, w, h):
    """このマスの外周で、隣が色つきブロックになっている辺"""
    n = layout['size']
    owner = [[-1] * n for _ in range(n)]
    colored = set()
    for k, p in enumerate(layout['pieces']):
        if p['c'] != -9:
            colored.add(k)
        for j in range(p['h']):
            for i in range(p['w']):
                owner[p['y'] + j][p['x'] + i] = k

    def lit(x, y):
        return 0 <= x < n and 0 <= y < n and owner[y][x] in colored

    out = set()
    for j in range(h):
        if lit(cx - 1, cy + j): out.add('left')
        if lit(cx + w, cy + j): out.add('right')
    for i in range(w):
        if lit(cx + i, cy - 1): out.add('top')
        if lit(cx + i, cy + h): out.add('bottom')
    return out


def repair(im, sides):
    """隣の色つきが混ざった帯を落として、元の大きさへ伸ばし直す。

    塗りつぶしではなく伸ばすのが要点。内側のきれいな 1 行で塗ると、面取りの
    いちばん明るい外縁が平らな帯に化けて、その辺だけ丸まって見える（2x2 の
    上辺で実際にそうなった）。伸ばすほうは数 % 縮むだけで目には分からない。
    """
    a = np.asarray(im).astype(np.int16)
    H, W, _ = a.shape
    core = a[H // 5: H * 4 // 5, W // 5: W * 4 // 5]
    base = float(np.median(core[..., 2].astype(float) - core[..., 0]))

    def depth(lines, cap):
        d = 0
        while d < cap and (lines[d][..., 2].mean() - lines[d][..., 0].mean()) > base + 5:
            d += 1
        return d

    t = depth([a[i] for i in range(H)], max(2, int(H * 0.08))) if 'top' in sides else 0
    b = depth([a[H - 1 - i] for i in range(H)], max(2, int(H * 0.08))) if 'bottom' in sides else 0
    l = depth([a[:, i] for i in range(W)], max(2, int(W * 0.08))) if 'left' in sides else 0
    r = depth([a[:, W - 1 - i] for i in range(W)], max(2, int(W * 0.08))) if 'right' in sides else 0
    if not (t or b or l or r):
        return im, (0, 0, 0, 0)
    return im.crop((l, t, W - r, H - b)).resize((W, H), Image.LANCZOS), (l, t, r, b)


def main(argv):
    if len(argv) != 4:
        print(__doc__)
        return 1
    shots = dict(zip((1, 4, 8, 18), argv))
    lay = layouts(shots)
    grid = {}
    for lv, path in shots.items():
        im = Image.open(path)
        wide = im.height > im.width * 1.6     # 全画面か、盤だけの切り抜きか
        side, ox, oy = fit(path, lay[str(lv)], wide)
        grid[lv] = (side / lay[str(lv)]['size'], ox, oy)
        print(f'レベル{lv}: 盤 {side:.1f}px  マス {side / lay[str(lv)]["size"]:.1f}px')

    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (lv, cx, cy) in list(PICK.items()) + [('empty', EMPTY)]:
        cell, ox, oy = grid[lv]
        w, h = (1, 1) if name == 'empty' else map(int, name.split('x'))
        m = cell * INSET
        box = (round(ox + cx * cell + m), round(oy + cy * cell + m),
               round(ox + (cx + w) * cell - m), round(oy + (cy + h) * cell - m))
        im = Image.open(shots[lv]).convert('RGB').crop(box)
        im, cut = repair(im, dirty_sides(lay[str(lv)], cx, cy, w, h))
        dst = OUT / f'{name}.webp'
        im.save(dst, 'WEBP', quality=90, method=6)
        total += dst.stat().st_size
        note = f'  混ざった帯を落とした 左{cut[0]} 上{cut[1]} 右{cut[2]} 下{cut[3]}' if any(cut) else ''
        print(f'{name:6s} {im.size[0]:4d}x{im.size[1]:4d}  {dst.stat().st_size / 1024:5.1f} KB{note}')
    print(f'合計 {total / 1024:.1f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
