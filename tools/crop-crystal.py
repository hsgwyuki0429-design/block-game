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

== 切り口をどこに置くか ==

**目地（ブロックとブロックのあいだに覗くトレイの地）のまん中**に置く。
そこがマスの境目そのものなので、切り出した絵はちょうど 1 マス分になり、
貼るときも 1 マス分の矩形へそのまま置ける ―― ずれを控える必要も、
引き伸ばして辻褄を合わせる必要も無い。

最初はマスの矩形から 3% 内側で切って、貼るときに伸ばして返していた。これだと

  ・はみ出し方は辺ごとに違うので、ある辺では面取りの外縁を削り、
    別の辺では隣のブロックが混ざる
  ・削ったぶんを伸ばして埋めると、面取りの輪がマス何 px かぶん内へ寄る

写真と重ねると、どのブロックの縁にも明るい輪が出た。目地で切ればどちらも起きない。

目地の探し方は**ブロックの内側から外へ 1 画素ずつ**。トレイの色になったところが
ブロックの端、そこから外もトレイの色でいるあいだが目地で、そのまん中が境目。
盤の外周に面した辺には目地が無いので、他の辺で測れた目地幅の半分を足す。

「目地らしさ」は色の距離だけでは決まらない ―― 淡い水色のブロックは、トレイの
淡い藤色と RGB の距離がほとんど変わらない。**色みの傾き**（青と赤の差）も
一緒に見る。ガラスははっきり青へ振れていて、トレイは振れていない。

== 盤の位置 ==

格子を総当たりで探すのはやめた。何を点にしても外れる ――

  ・縁の強さ: 面取りが太いので縁が帯になり、帯のどこでも点が入る。
    レベル 8 で 16px（マスの 8%）ずれたまま、見た目には合っていた
  ・目地の色: 盤の外も空きマスの窪みも淡いので、**盤を大きく見積もるほど
    点が伸びる**。1 マス近く膨らんだ
  ・目地を 1 本ずつ測って最小二乗: 測れる線が少ないレベル（レベル 1 は
    内側の目地が縦横 1 本ずつしかない）で、当てはめが暴れる

代わりに、**盤の寸法を数え上げで組み立てる**。どのレベルもブロックが盤の
四辺すべてに触れているので、

    盤の一辺 = ブロック全体の外接矩形 + 目地 1 本ぶん
    マス     = 盤の一辺 ÷ 盤の目数
    原点     = 外接矩形の左上 − 目地の半分

外接矩形も目地の幅も、閾値ひとつで数えられる量なので、当てはめが暴れる余地が
無い。粗合わせは「どのあたりを見るか」の窓を切るためだけに使う。

  ① トレイの色が載っているのは盤の板の上だけ ―― その外接矩形が板。
     板は正方形なので、縦は横幅から決める（下には落ち影が伸びていて、
     そのまま測ると 30px ほど長くなる）
  ② 板の内側でトレイ色でない画素の外接矩形 ＝ ブロック全体の占める範囲
  ③ その内側で、ブロックでない画素が並ぶ帯の幅の中央値 ＝ 目地 1 本
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'crystal'

# アプリを 393pt 幅で開いたときの盤の矩形（CSS px）。全画面の写真はこれの拡大
CSS_W, BOARD_X, BOARD_Y, BOARD_S = 393.0, 26.0, 274.390625, 340.0

# 形 -> (レベル, 左上のマス)
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

# トレイ（盤の地）の色。目地を探す物差し
TRAY = (222, 224, 240)

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


def trayness(path):
    """画素ごとの「目地らしさ」（0..1）"""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    tray = np.array(TRAY, dtype=np.float32)
    dist = np.abs(a - tray).sum(axis=2)
    cast = np.abs((a[..., 2] - a[..., 0]) - (TRAY[2] - TRAY[0]))
    return np.clip(1.0 - (dist / 90.0) - (cast / 22.0), 0.0, 1.0)


def coarse_fit(path, layout, wide):
    """盤のだいたいの矩形 (一辺, 原点x, 原点y)。マスの 1 割ほどの精度でよい"""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    lum = a.mean(axis=2)
    gx = np.abs(np.diff(lum, axis=1, append=lum[:, -1:]))
    gy = np.abs(np.diff(lum, axis=0, append=lum[-1:, :]))
    for k in (1, 2, 3):
        gx = np.maximum(gx, np.maximum(np.roll(gx, k, 1), np.roll(gx, -k, 1)))
        gy = np.maximum(gy, np.maximum(np.roll(gy, k, 0), np.roll(gy, -k, 0)))
    cx, cy = np.cumsum(gx, axis=0), np.cumsum(gy, axis=1)
    H, W = lum.shape
    n = layout['size']
    ps = layout['pieces']

    def vs(x, ya, yb):
        x = int(round(x)); ya = max(0, min(H - 1, int(ya))); yb = max(0, min(H - 1, int(yb)))
        return 0.0 if (x < 0 or x >= W or yb <= ya) else float(cx[yb, x] - cx[ya, x]) / (yb - ya)

    def hs(y, xa, xb):
        y = int(round(y)); xa = max(0, min(W - 1, int(xa))); xb = max(0, min(W - 1, int(xb)))
        return 0.0 if (y < 0 or y >= H or xb <= xa) else float(cy[y, xb] - cy[y, xa]) / (xb - xa)

    def score(side, ox, oy):
        # ブロックの境目には縁があり、内側の格子線には無い ―― その差。
        # 内側への罰が無いと、格子が 1 マスずれても同じ点になる
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

    if wide:                                  # 全画面。アプリの寸法から出発する
        k = W / CSS_W
        s0, x0, y0 = BOARD_S * k, BOARD_X * k, BOARD_Y * k
        rng = (np.arange(s0 - 40, s0 + 41, 2), np.arange(x0 - 30, x0 + 31, 2),
               np.arange(y0 - 60, y0 + 61, 2))
    else:                                     # 盤だけ切り抜かれた画像
        rng = (np.arange(W * 0.55, W * 0.80, 3), np.arange(W * 0.08, W * 0.26, 3),
               np.arange(H * 0.15, H * 0.36, 3))
    best = None
    for side in rng[0]:
        for ox in rng[1]:
            for oy in rng[2]:
                v = score(side, ox, oy)
                if best is None or v > best[0]:
                    best = (v, side, ox, oy)
    for step in (1.0, 0.5):
        _, side, ox, oy = best
        for sv in np.arange(side - 4, side + 4.01, step):
            for xv in np.arange(ox - 4, ox + 4.01, step):
                for yv in np.arange(oy - 4, oy + 4.01, step):
                    v = score(sv, xv, yv)
                    if v > best[0]:
                        best = (v, sv, xv, yv)
    return best[1], best[2], best[3]


def measure_grid(t, layout, coarse):
    """盤の (マス, 原点x, 原点y) を数え上げで組み立てる（説明は冒頭）"""
    side0, ox0, oy0 = coarse
    n = layout['size']
    H, W = t.shape

    # ① 盤の板。トレイの色が載っているのはこの上だけ
    win = np.zeros_like(t, dtype=bool)
    win[max(0, int(oy0 - side0 * 0.12)): min(H, int(oy0 + side0 * 1.12)),
        max(0, int(ox0 - side0 * 0.12)): min(W, int(ox0 + side0 * 1.12))] = True
    ys, xs = np.where((t > 0.6) & win)
    px0, px1, py0 = int(xs.min()), int(xs.max()), int(ys.min())
    py1 = py0 + (px1 - px0)                  # 板は正方形。縦は横幅から決める

    # ② ブロック全体の占める範囲。板の縁の滲みを避けて少し内から見る
    m = 6
    blk = t[py0 + m: py1 - m + 1, px0 + m: px1 - m + 1] < 0.35
    cxs = np.where(blk.mean(axis=0) > 0.2)[0]
    cys = np.where(blk.mean(axis=1) > 0.2)[0]
    bx0, bx1 = px0 + m + int(cxs.min()), px0 + m + int(cxs.max())
    by0, by1 = py0 + m + int(cys.min()), py0 + m + int(cys.max())

    # ③ 目地 1 本の幅
    inner = t[by0: by1 + 1, bx0: bx1 + 1] < 0.35

    def bands(frac):
        out, start = [], None
        for i, v in enumerate(frac):
            if v < 0.25 and start is None:
                start = i
            elif v >= 0.25 and start is not None:
                out.append(i - start)
                start = None
        return [g for g in out if 3 <= g <= 40]

    widths = bands(inner.mean(axis=0)) + bands(inner.mean(axis=1))
    gap = float(np.median(widths)) if widths else side0 * 0.012

    side = ((bx1 - bx0 + 1) + (by1 - by0 + 1)) / 2 + gap
    return side / n, bx0 - gap / 2, by0 - gap / 2


def main(argv):
    if len(argv) != 4:
        print(__doc__)
        return 1
    shots = dict(zip((1, 4, 8, 18), argv))
    lay = layouts(shots)
    grid, tray = {}, {}
    for lv, path in shots.items():
        im = Image.open(path)
        wide = im.height > im.width * 1.6     # 全画面か、盤だけの切り抜きか
        tray[lv] = trayness(path)
        coarse = coarse_fit(path, lay[str(lv)], wide)
        cell, ox, oy = measure_grid(tray[lv], lay[str(lv)], coarse)
        grid[lv] = (cell, ox, oy)
        n = lay[str(lv)]['size']
        print(f'レベル{lv}: 盤 {cell * n:.1f}px  マス {cell:.2f}px  '
              f'（粗合わせから {cell * n - coarse[0]:+.1f}px)')

    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (lv, cx, cy) in list(PICK.items()) + [('empty', EMPTY)]:
        cell, ox, oy = grid[lv]
        w, h = (1, 1) if name == 'empty' else map(int, name.split('x'))
        box = (ox + cx * cell, oy + cy * cell, ox + (cx + w) * cell, oy + (cy + h) * cell)
        im = Image.open(shots[lv]).convert('RGB').crop(tuple(int(round(v)) for v in box))
        dst = OUT / f'{name}.webp'
        im.save(dst, 'WEBP', quality=90, method=6)
        total += dst.stat().st_size
        print(f'{name:6s} {im.size[0]:4d}x{im.size[1]:4d}  {dst.stat().st_size / 1024:5.1f} KB')
    print(f'合計 {total / 1024:.1f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
