"""按新的肩点重解整套姿势里的**前臂角度**。

为什么：手臂的肩点从**身体中轴**挪到了**近肩**（画面左 12），
而姿势表里的角度是**相对肩点**的——肩点一挪，所有关键帧的手就整体后移 12 单位，
画面上就是"手不在该在的位置"（兵器攻距也短了一截）。

修法与当初修反向膝是同一路：不是把角度抹平，而是**按新的肩点重解**——
保留手该在的世界位置（那是这些姿势本来要表达的东西），
用两连杆 IK 解出新的肩角与肘角。手够不着的位置就摆成伸直够过去的姿态。

判据与量法：
  · 旧肩点 = 身体中轴 (shX, shY)，新肩点 = (shX - 12, shY - 4)（见 renderer.ts 的 NEAR_ARM_DX）；
  · 手的世界位置在换锚点前后**保持不变**；
  · 解出来的肘取"在下"那个（与渲染层 armIK 同一套约定）。

**后臂不重解**：后肩从 -17 挪到了 +14（背面那一侧），手臂是**垂**着的，
角度相对肩点保持即可，手自然落在体侧；若强行把手留在原处，后臂会横穿身体。
代价是"后手挠头/抹脸"那两处胜利姿势的手够不到脸——那两处单独调。

用法：python scripts/refit-arms.py [--apply]
"""
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

UPPER_ARM = 26
LOWER_ARM = 26
OLD_DX, OLD_DY = 0.0, 0.0        # 旧肩点（身体中轴）
NEW_DX, NEW_DY = -12.0, -4.0     # 新肩点（近肩）

TARGETS = [
    'src/data/motions.ts',
    'src/data/superPhases.ts',
] + [f'src/data/characters/{n}.ts' for n in sorted(os.listdir(os.path.join(ROOT, 'src', 'data', 'characters')))
     if n.endswith('.ts')]


def seg_end(px, py, ang, ln):
    return (px + math.sin(ang) * ln, py + math.cos(ang) * ln)


def solve(sh_x, sh_y, tx, ty, bend):
    """两连杆 IK：肩 → 手。肘取"在下"那个。够不着就**瞄住目标、保持原来的肘弯**。

    够不着时的处理很要紧：肩点后移 12 之后，手臂最长也够不到原来的位置
    （原来那只手本来就接近伸直）。若把两段都摆直，手臂会僵成一根棍 ✗；
    正确做法是**保持肘弯、整体转向目标**——手会落在够得到的最远处，
    缺口从 12 压到 8~9（再压就要动胳膊长度，那会改掉人物比例）。
    """
    dx, dy = tx - sh_x, ty - sh_y
    d = math.hypot(dx, dy)
    aim = math.atan2(dx, dy)
    if d > UPPER_ARM + LOWER_ARM - 0.5:
        return aim - bend / 2, bend
    if d < abs(UPPER_ARM - LOWER_ARM) + 0.5:
        return aim, bend
    a = (UPPER_ARM ** 2 - LOWER_ARM ** 2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, UPPER_ARM ** 2 - a * a))
    mx, my = sh_x + dx * a / d, sh_y + dy * a / d
    px, py = -dy / d, dx / d
    e1 = (mx + h * px, my + h * py)
    e2 = (mx - h * px, my - h * py)
    elbow = e1 if e1[1] >= e2[1] else e2
    up = math.atan2(elbow[0] - sh_x, elbow[1] - sh_y)
    fo = math.atan2(tx - elbow[0], ty - elbow[1])
    return up, fo - up


def fmt(v):
    s = f"{v:.3f}".rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def main():
    apply = '--apply' in sys.argv
    pat = re.compile(r'armF:\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]')
    total = 0
    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        with open(path, 'r', encoding='utf-8', newline='') as f:
            src = f.read()
        changed = [0]

        def sub(m):
            a, b = float(m.group(1)), float(m.group(2))
            # 旧肩点下的手（相对身体中轴）
            e = seg_end(OLD_DX, OLD_DY, a, UPPER_ARM)
            hand = seg_end(e[0], e[1], a + b, LOWER_ARM)
            # 手的世界位置保持不变 ⇒ 在新肩点的局部系里，目标要加上锚点的位移
            tx, ty = hand[0] - NEW_DX, hand[1] - NEW_DY
            na, nb = solve(NEW_DX, NEW_DY, tx, ty, b)
            if abs(na - a) < 1e-6 and abs(nb - b) < 1e-6:
                return m.group(0)
            changed[0] += 1
            return f"armF: [{fmt(na)}, {fmt(nb)}]"

        out = pat.sub(sub, src)
        total += changed[0]
        print(f"{rel}: 重解 {changed[0]} 处")
        if apply and changed[0]:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(out)
    print(f"合计 {total} 处" + ('' if apply else '（加 --apply 才会写盘）'))


if __name__ == '__main__':
    main()
