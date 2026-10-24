"""量十二个人头贴图里的「脸」，并算出上屏尺度。

为什么需要这个脚本：头贴图是「脸 + 装饰」——哪吒的抹额飘带、二郎的天冠、
铁扇的高髻、白骨精的头饰，各自带一大片内容。而**脸在整幅里的位置**同样要量：
飘带、翎羽、帽翅都长在左边，量出来的脸心比整幅中心偏右 7~31 像素（哪吒 23、悟空 28.5）。
头若按整幅居中挂到颈点，脸就被推到身体中轴右边 2~10 像素——脖子接在耳朵那一侧，
头看着就「不在身体上」。所以脸要连位置一起量，挂的时候按脸挂。

量法：取头贴图里**最亮的显著色块**（也就是脸的肤色），
在容差内取最大连通域，得到的包围盒就是脸。
有个人的量法要手工兜底，理由写在 OVERRIDE 里。

用法：python scripts/measure-heads.py
输出：每人脸的框（源像素 x,y,w,h）+ 上屏后的头/脸尺寸 + 离散度。
素材重出或重切之后重跑一遍，把数字抄回 src/data/characters/*.ts 的 build.face。
"""
import math
import os
import sys
from collections import Counter, deque

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 肤色容差：AI 出的图同一张脸也有色阶，全按精确色值取会把脸切成碎块
TOL = 46
# 显著色的下限：占整幅墨量这么少的不算脸（多半是描边或高光）
MIN_SHARE = 0.015

# 手工兜底：新一版素材（scripts/char-art.json 的 contracts.head）里每张脸都完整露出、
# 且脸与背景不同色，自动量法全部成立——所以这里**没有**例外项。
# 上一版需要手工框牛魔王（胡子把脸割成碎块）与哪吒（耳朵被圈进来），
# 那是素材本身的毛病：脸不完整、脸与配件同色。新契约两条都堵住了。
OVERRIDE: dict[str, tuple[int, int, int, int]] = {}

# 归一口径：新素材契约保证"头填满画幅"（内容盒高 123~124 像素，几乎一样），
# 于是**内容盒高就是头高**，归一只剩一条锚：把头缩到同一个逻辑高度。
# 头占身高的离散度因此收到 1.20（旧素材是渐隐半身像，盒高不等于头高，
# 只能退而用脸去量，收到了 1.43）。
HEAD_TARGET = 40.0
# 角色特质倍率（**这里是唯一来源**，抄回 src/data/characters/*.ts 的 build.head）：
#   · 小孩子头更大——同一副骨架，小孩的头本来就该更显眼（哪吒、红孩儿）；
#   · 猪八戒头更小——身子最肥、头小才读得出是「pig 撞在肉山上」；
#   · 其余一律 1.0：素材的脸占头的比例不同是角色设计（猴王的脸小、小孩的脸大），
#     不该用缩放去抹平。
TRAIT = {
    'nezha': 1.12, 'honghaier': 1.18, 'bajie': 0.92,
}


def face_rect(im):
    """脸的包围盒 (x, y, w, h)；量不出来返回 None。"""
    W, H = im.size
    px = im.load()
    cnt = Counter()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 60:
                cnt[(r // 8 * 8, g // 8 * 8, b // 8 * 8)] += 1
    ink = sum(cnt.values())
    cand = [(sum(k) / 3, n, k) for k, n in cnt.items() if n >= ink * MIN_SHARE]
    if not cand:
        return None
    # 最亮且不算零星的那块颜色就是脸的基色
    cand.sort(key=lambda t: (-t[0], -t[1]))
    kr, kg, kb = cand[0][2]
    mask = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 60 and abs(r - kr) <= TOL and abs(g - kg) <= TOL and abs(b - kb) <= TOL:
                mask[y][x] = True
    best = None
    seen = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if mask[y][x] and not seen[y][x]:
                q = deque([(x, y)])
                seen[y][x] = True
                comp = []
                while q:
                    cx, cy = q.popleft()
                    comp.append((cx, cy))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < W and 0 <= ny < H and mask[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = True
                            q.append((nx, ny))
                if best is None or len(comp) > len(best):
                    best = comp
    if not best:
        return None
    xs = [p[0] for p in best]
    ys = [p[1] for p in best]
    return (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)


def main():
    rows = []
    for cid in sorted(os.listdir(os.path.join(ROOT, 'public', 'chars'))):
        hp = os.path.join(ROOT, 'public', 'chars', cid, 'head.png')
        if not os.path.exists(hp):
            continue
        im = Image.open(hp).convert('RGBA')
        rect = OVERRIDE.get(cid) or face_rect(im)
        if not rect:
            print(f'{cid}: 量不到脸', file=sys.stderr)
            continue
        bb = im.getbbox()
        fx, fy, fw, fh = rect
        bw, bh = bb[2] - bb[0], bb[3] - bb[1]
        rows.append((cid, bb, rect, bw, bh))

    def scale_of(bw, bh, fw, fh, cid):
        return (HEAD_TARGET / bh) * TRAIT.get(cid, 1.0)

    print(f"{'id':<12}{'内容盒':<14}{'脸(源px)':<12}{'脸心-框心':<11}{'缩放':>8}"
          f"{'头宽':>7}{'头高':>7}{'头%身':>8}{'脸宽':>7}{'脸高':>7}")
    for cid, bb, (fx, fy, fw, fh), bw, bh in rows:
        s = scale_of(bw, bh, fw, fh, cid)
        boxCtr = (bb[0] + bb[2]) / 2
        faceCtr = fx + fw / 2
        pct = (bh * s) / (122 + bh * s) * 100
        print(f"{cid:<12}{f'{bb[0]},{bb[1]}..{bb[2]},{bb[3]}':<14}{f'{fx},{fy} {fw}x{fh}':<12}"
              f"{faceCtr - boxCtr:>+10.1f}{s:8.4f}{bw*s:7.1f}{bh*s:7.1f}{pct:7.1f}%"
              f"{fw*s:7.1f}{fh*s:7.1f}")

    print()
    print('离散度（越大越不齐）：')
    for name, get in (('头宽', lambda bw, bh, fw, fh, s: bw * s),
                      ('头高', lambda bw, bh, fw, fh, s: bh * s),
                      ('脸宽', lambda bw, bh, fw, fh, s: fw * s),
                      ('脸高', lambda bw, bh, fw, fh, s: fh * s),
                      ('脸几何平均', lambda bw, bh, fw, fh, s: math.sqrt(fw * fh) * s)):
        v = [get(bw, bh, fw, fh, scale_of(bw, bh, fw, fh, cid))
             for cid, bb, (fx, fy, fw, fh), bw, bh in rows]
        print(f'  {name:<10}{max(v) / min(v):.3f}')
    print()
    print('抄回 src/data/characters/*.ts 的 build：')
    for cid, bb, (fx, fy, fw, fh), bw, bh in rows:
        print(f"  {cid:<12}face: [{fx}, {fy}, {fw}, {fh}], head: {TRAIT.get(cid, 1.0)}")


if __name__ == '__main__':
    main()
