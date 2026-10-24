"""把动作表里所有"反向膝"按脚的位置重解一遍。

为什么需要：膝弯量为负 = 小腿相对大腿朝前甩 = 膝盖反着折 = 人腿不可能的关节。
上一轮只修了 idle/walk/crouch/block/run/jump 六条公共动作，
**大招的姿势词表与公共动作的其余部分从没被扫过**——
实测 462 个动作里有 406 个的关键帧存在反向膝，最集中的就是
"后蹬/冲刺/空中追击/落地砸"这些大招分段（悟空的蓄力腿、哪吒的空中追击腿）。

修法不是把负号抹掉（那会让脚凭空挪位），而是**按脚的位置重解膝盖**：
脚在作者摆的位置上不动，只把膝盖掰回人膝的方向。
两连杆 IK：圆(髋,32) ∩ 圆(踝,32) 有两个解，取膝盖在"髋→踝"连线朝前那一侧的那个。

用法：python scripts/fix-reverse-knees.py
"""
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THIGH = 32.0
SHIN = 32.0
TARGETS = [
    'src/data/superPhases.ts',
    'src/data/motions.ts',
    'src/data/superChoreo.ts',
]
PAT = re.compile(r'leg([FB]):\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]')


def seg_end(px, py, ang, ln):
    return (px + math.sin(ang) * ln, py + math.cos(ang) * ln)


def repair(thigh, flex):
    """保脚重解膝盖；返回 (大腿角, 膝弯量)。够不着就退回保大腿。"""
    if flex >= 0:
        return (thigh, flex)
    knee = seg_end(0, 0, thigh, THIGH)
    ankle = seg_end(knee[0], knee[1], thigh - flex, SHIN)
    d = math.hypot(*ankle)
    if d > THIGH + SHIN or d < abs(THIGH - SHIN):
        return (thigh, -flex)
    a = (THIGH ** 2 - SHIN ** 2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, THIGH ** 2 - a * a))
    mx, my = ankle[0] * a / d, ankle[1] * a / d
    px, py = -ankle[1] / d, ankle[0] / d
    best = None
    for k in ((mx + h * px, my + h * py), (mx - h * px, my - h * py)):
        cross = ankle[0] * k[1] - ankle[1] * k[0]
        if best is None or cross < best[0]:
            best = (cross, k)
    knee = best[1]
    t = math.atan2(knee[0], knee[1])
    s = math.atan2(ankle[0] - knee[0], ankle[1] - knee[1])
    return (t, t - s)


def fmt(v):
    s = f"{v:.3f}".rstrip('0').rstrip('.')
    if s in ('-0', ''):
        s = '0'
    return s


def main():
    apply = '--apply' in sys.argv
    total = 0
    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        with open(path, 'r', encoding='utf-8', newline='') as f:
            src = f.read()
        changed = [0]

        def sub(m):
            side, ts, fs = m.group(1), float(m.group(2)), float(m.group(3))
            if fs >= 0:
                return m.group(0)
            t, fl = repair(ts, fs)
            changed[0] += 1
            return f"leg{side}: [{fmt(t)}, {fmt(fl)}]"

        out = PAT.sub(sub, src)
        total += changed[0]
        print(f"{rel}: 修 {changed[0]} 处")
        if apply and changed[0]:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(out)
    print(f"合计 {total} 处" + ("" if apply else "（加 --apply 才会写盘）"))


if __name__ == '__main__':
    main()
