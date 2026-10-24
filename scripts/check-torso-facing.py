"""验收：躯干素材的**裸肩在画面哪里**。

为什么要有这条：躯干素材决定手臂往哪儿插。3/4 侧身版把近肩画在画面**左**边，
侧身版画在**正中**——而骨架的肩点只有一个位置能让攻距与姿势都不动（身体中轴）。
模型不保证听指令（刑天就画成过正面朝向），所以这一条要**量**，不能靠看。

判据：躯干图**顶部 18%** 里那块**肤色**（裸肩）的横向中心：
  · 0.40~0.60 ⇒ 侧身版，近肩在正中 ✓ 合规；
  · < 0.35 或 > 0.65 ⇒ 朝向不对（画成了 3/4 或正面），不合规，重出。

用法：python scripts/check-torso-facing.py
"""
import glob
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARS = os.path.join(ROOT, 'public', 'chars')

TOP = 0.18        # 只看顶部这一段（裸肩所在）
SKIN_MIN = 0.01  # 肤色块至少占全图 1% 才算数（太小的是描边/杂点）
# 两种约定的裸肩位置：3/4 侧身版画在画面**左边**（近肩偏后 12），
# 侧身版画在**正中**。用法：python scripts/check-torso-facing.py [3q|side]
CONV = {'3q': (0.12, 0.34), 'side': (0.40, 0.60)}
LO, HI = CONV.get(sys.argv[1] if len(sys.argv) > 1 else '3q', (0.12, 0.34))


def skin_ok(r, g, b):
    """肤色：暖色、饱和度中等。鲜红的袍子（r-g 很大）不算。"""
    return r > 120 and 8 <= r - g <= 90 and r - b > 15 and g >= b - 4


def shoulder_x(path):
    """裸肩（最靠左的那块肤色）的横向中心。

    为什么取**最左**的一块而不是全部肤色的重心：3/4 侧身版里近肩与远肩**都有**肤色块
    （两个袖口都露肉），重heart会被拉回中间、判据失效；近肩永远是最靠左的那块 ✓。
    侧身版只有一个裸肩，同样落在最左边 ✓。
    """
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()
    pts = []
    for y in range(int(H * TOP)):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 200 and skin_ok(r, g, b):
                pts.append(x)
    if len(pts) < W * H * SKIN_MIN:
        return None, len(pts)
    # 以 6px 为一档分桶，每桶的像素数当权重，找"最靠左且成块"的那一档
    buckets: dict[int, list[int]] = {}
    for x in pts:
        buckets.setdefault(x // 6, []).append(x)
    # 最左边的桶若像素太少（描边/杂点），往右找下一个够大的桶
    order = sorted(buckets)
    for k in order:
        v = buckets[k]
        if len(v) >= max(8, W * H * 0.004):
            return sum(v) / len(v) / W, len(pts)
    return None, len(pts)


def main():
    bad = []
    print(f"{'id':<12}{'裸肩x':>8}{'肤色px':>9}  判定")
    for d in sorted(glob.glob(os.path.join(CHARS, '*'))):
        cid = os.path.basename(d)
        p = os.path.join(d, 'torso.png')
        if not os.path.exists(p):
            continue
        x, n = shoulder_x(p)
        if x is None:
            print(f'{cid:<12}{"量不到":>8}{n:>9}  !! 顶部没有肤色块（裸肩没画出来）')
            bad.append(cid)
            continue
        ok = LO <= x <= HI
        print(f'{cid:<12}{x:>8.2f}{n:>9}  {"OK 侧身（近肩在正中）" if ok else "!! 朝向不对，要重出"}')
        if not ok:
            bad.append(cid)
    print()
    if bad:
        print(f"不合规 {len(bad)} 张：{' '.join(bad)}")
        print("（重出提示词已写死「从侧面看、近肩在画面正中」；仍不合规就换个说法再来一轮）")
        return 1
    print('十二张的裸肩都在正中 —— 朝向合规')
    return 0


if __name__ == '__main__':
    sys.exit(main())
