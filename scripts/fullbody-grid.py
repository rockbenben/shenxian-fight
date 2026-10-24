"""把全身图铺上**可读的**坐标网格：给眼睛读切线用。

为什么要有：切件的位置全靠解剖（下巴、肩线、肘、腕、胯、膝、踝），
而这些位置在画里**没有坐标**——只能量。量法有两条：自动检测（描边当屏障做连通域，
见 cut-fullbody.py）或人眼读数。这张网格图是后者：横竖各 5% 一条线并标数字，
读出百分比写进 fullbody-spec.json，工具再换算成像素。

用法：
  python design-preview/tools/fullbody-grid.py <角色id> [--w 900]
输出：design-preview/out/cut/<id>-read.png
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, '_raw')
OUT = os.path.join(ROOT, 'design-preview', 'out', 'cut')


def is_magenta(r, g, b):
    return r > 110 and b > 110 and g < min(r, b) * 0.72


def load_clean(path):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and is_magenta(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def main():
    cid = sys.argv[1]
    out_w = 900
    if '--w' in sys.argv:
        out_w = int(sys.argv[sys.argv.index('--w') + 1])
    src = os.path.join(RAW, f'{cid}_full.png')
    if not os.path.exists(src):
        print('没有', src)
        return
    im = load_clean(src)
    W, H = im.size

    bg = Image.new('RGBA', im.size, (247, 243, 234, 255))
    bg.alpha_composite(im)
    d = ImageDraw.Draw(bg)
    # 5% 一条线，10% 一条粗线；数字标在两端
    for p in range(0, 101, 5):
        x = int(W * p / 100)
        y = int(H * p / 100)
        strong = p % 10 == 0
        col = (0, 110, 190, 150) if strong else (0, 110, 190, 70)
        d.line([x, 0, x, H], fill=col, width=2 if strong else 1)
        d.line([0, y, W, y], fill=col, width=2 if strong else 1)
        if p % 10 == 0:
            d.text((x + 3, 3), f'{p}', fill=(0, 70, 140))
            d.text((3, y + 3), f'{p}', fill=(0, 70, 140))
    # 左右各留一条竖标尺，把数字标在右边，免得压在画上
    os.makedirs(OUT, exist_ok=True)
    sc = out_w / W
    out = bg.convert('RGB').resize((out_w, int(H * sc)), Image.LANCZOS)
    d2 = ImageDraw.Draw(out)
    for p in range(0, 101, 10):
        y = int(H * sc * p / 100)
        d2.text((out_w - 22, y - 12), f'{p}', fill=(200, 0, 0))
    out.save(os.path.join(OUT, f'{cid}-read.png'))
    print(f'{cid}: 原图 {W}x{H}  输出 {out_w}x{int(H*sc)}')
    print(f'  百分比→像素：x*={W/100:.2f}  y*={H/100:.2f}')


if __name__ == '__main__':
    main()
