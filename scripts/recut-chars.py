"""重切角色部件：_raw/<id>_<part>.png → public/chars/<id>/<part>.png。

为什么单独一个脚本：scripts/recut.py 会把 _raw/ 下所有 PNG 过一遍，
连不该重切的一起动。抠图判据与裁切规则直接 import recut.py——同一份，不另写一份。

用法：python scripts/recut-chars.py [head|torso]
"""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recut import recut  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = {'head': (128, 128), 'torso': (160, 224)}
only = sys.argv[1] if len(sys.argv) > 1 else None

# 需要**水平镜像**的部件。
#
# 判据（scripts/char-art.json 的 contracts.torso）：躯干朝自己的右转约 35 度，
# **胸口与肚子朝画面右、背在画面左**，近肩（朝向镜头的那一侧）在**画面左上**。
# 程序化手臂插的就是那个近肩——躯干画反了，手臂就插到背上去了。
#
# **不再有镜像兜底。**
# 之前哪吒与雷震子的臂孔画到了画面右侧（与另外十一人相反），这里是靠水平镜像"修"好的——
# 但镜像会把**整件衣服**翻过来：衣襟的开口方向、腰带的搭扣、披挂的位置全都反了，
# 高光也反（其余十一人光从左上，他变右上）。那是**把衣服穿反了**，不是把朝向修好。
# 现在规矩：**朝向不对就重出那一张**，镜像一律不用。
# FLIP 保留成空表，是为了让这条规矩留在代码里（新增镜像前先想一遍）。
FLIP: dict[str, str] = {}

for raw in sorted(glob.glob(os.path.join(ROOT, '_raw', '*_*.png'))):
    name = os.path.basename(raw)[:-len('.png')]
    if '_' not in name:
        continue
    cid, part = name.rsplit('_', 1)
    if part not in SIZE or (only and part != only):
        continue
    out = os.path.join(ROOT, 'public', 'chars', cid, f'{part}.png')
    if not os.path.isdir(os.path.dirname(out)):
        print(f'{cid}: 没有角色目录，跳过')
        continue
    r = recut(raw, out, SIZE[part], flip=FLIP.get(cid) == part)
    print(f'{cid}/{part}: {r}')
