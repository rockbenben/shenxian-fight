"""扫描全身图每一行的不透明区间：横向位置不靠眼睛估，直接从像素读。

为什么需要：切件要的是"这一段肢体在画面上占哪一段横坐标"。眼睛在缩略的网格图上
读横向位置能差 3~5%，切出来就是一条竖直的口子（身体被切掉一块）。
这里把每一行上的不透明连通段打印出来，横向边界是确切的。

用法：
  python design-preview/tools/row-runs.py <角色id> [<角色id>...]
  python design-preview/tools/row-runs.py --bands nezha     # 按规格表里的关节高度扫
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, 'scripts', 'fullbody-spec.json')


def load_clean(path):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and r > 110 and b > 110 and g < min(r, b) * 0.72:
                px[x, y] = (0, 0, 0, 0)
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def runs_of(row):
    """一行里的不透明段（起止列号）。"""
    idx = np.where(row > 8)[0]
    if len(idx) == 0:
        return []
    out = []
    start = idx[0]
    prev = idx[0]
    for i in idx[1:]:
        if i > prev + 1:
            out.append((int(start), int(prev)))
            start = i
        prev = i
    out.append((int(start), int(prev)))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    bands_mode = '--bands' in sys.argv
    spec_all = json.load(open(SPEC_PATH, encoding='utf-8'))
    for cid in args:
        src = os.path.join(ROOT, '_raw', f'{cid}_full.png')
        if not os.path.exists(src):
            print(f'{cid}: 没有原图')
            continue
        im = load_clean(src)
        W, H = im.size
        if cid in spec_all and 'box' in spec_all[cid]:
            b = spec_all[cid]['box']
            im = im.crop((int(W * b[0] / 100), int(H * b[1] / 100),
                          int(W * b[2] / 100), int(H * b[3] / 100)))
            W, H = im.size
        a = np.array(im.getchannel('A'))
        print(f'=== {cid}  {W}x{H} ===')
        if bands_mode and cid in spec_all:
            sp = spec_all[cid]
            marks = [('头', sp['chin'] - 8), ('肩', sp['shoulder'] + 2), ('肘', sp['elbow']),
                     ('腕', sp['wrist']), ('胯/摆', sp['hip']), ('膝', sp['knee']),
                     ('踝', sp['ankle']), ('脚', 98)]
            for name, pct in marks:
                y = min(H - 1, max(0, int(H * pct / 100)))
                rs = runs_of(a[y])
                pretty = '  '.join(f'{x0/W*100:.0f}~{x1/W*100:.0f}' for x0, x1 in rs)
                print(f'  {name:<6} y={pct:5.1f}%  段: {pretty}')
        else:
            for pct in range(0, 101, 5):
                y = min(H - 1, int(H * pct / 100))
                rs = runs_of(a[y])
                pretty = '  '.join(f'{x0/W*100:.0f}~{x1/W*100:.0f}' for x0, x1 in rs)
                print(f'  y={pct:3d}%  段: {pretty}')


if __name__ == '__main__':
    main()
