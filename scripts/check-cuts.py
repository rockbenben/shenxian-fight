"""切件体检：把「切错了」变成机器能判的几条，而不是靠肉眼扫十二张图。

查四件事（每条都对应一种真实的错法）：
  1. **脸贴边** —— 头件的横向切线切到了脸上（铁扇公主那张就切掉了半张脸）。
  2. **手臂进了躯干** —— 躯干那一块的横向范围盖住了近臂，手臂一动，
     躯干上会留一条跟着飞的胳膊像素。
  3. **躯干里烤进了后臂** —— 后臂在躯干右边（画里藏半身），躯干切得��宽就把
     它烤进去了：那条胳膊从此钉在躯干上不动。
  4. **腿那一块空着** —— 袍子/裙子的下沿以下本来就只有一点点腿，
     切出来是几像素高的碎片，等于没有腿。

用法：python design-preview/tools/check-cuts.py [角色id...]
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = os.path.join(ROOT, 'scripts', 'fullbody-spec.json')

cf_spec = importlib.util.spec_from_file_location('cf', os.path.join(ROOT, 'scripts', 'cut-fullbody.py'))
cf = importlib.util.module_from_spec(cf_spec)
cf_spec.loader.exec_module(cf)

mh_spec = importlib.util.spec_from_file_location('mh', os.path.join(ROOT, 'scripts', 'measure-heads.py'))
mh = importlib.util.module_from_spec(mh_spec)
mh_spec.loader.exec_module(mh)


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith('-')]
    spec_all = json.load(open(SPEC, encoding='utf-8'))
    if not ids:
        ids = [k for k in spec_all if not k.startswith('_')]
    bad_total = 0
    for cid in ids:
        sp = spec_all.get(cid)
        if not sp:
            print(f'{cid}: 规格表里没有')
            continue
        im = cf.load_clean(os.path.join(ROOT, '_raw', f'{cid}_full.png'))
        W, H = im.size
        if 'box' in sp:
            b = sp['box']
            im = im.crop((int(W * b[0] / 100), int(H * b[1] / 100),
                          int(W * b[2] / 100), int(H * b[3] / 100)))
            W, H = im.size
        alpha = np.array(im.getchannel('A'))
        problems = []
        notes = []

        def X(p):
            return W * p / 100

        def Y(p):
            return H * p / 100

        # ---- 1. 脸贴边 ------------------------------------------------------
        head = cf.crop_pct(im, sp['head'][0], sp['head'][1], sp['head'][2], sp['head'][3])
        fr = mh.face_rect(head)
        if fr is None:
            problems.append('头件里量不到脸（头切没了？）')
        else:
            fx, fy, fw, fh = fr
            hw, hh = head.size
            if fx <= 1:
                problems.append(f'脸贴左边（脸框 x={fx}）')
            if fx + fw >= hw - 1:
                problems.append(f'脸贴右边（脸框右边 {fx+fw} / 头件宽 {hw}）—— 脸被切了')
            if fy <= 1:
                problems.append('脸贴上边')

        # ---- 2/3. 躯干与手臂的横向互相越界 ---------------------------------
        arm0, arm1 = sp.get('armFU', sp['arm'])
        tor0, tor1 = sp['torso']
        # 躯干的左缘若是按画上的界逐行走的（torsoL / armR），矩形那个 tor0 就不作数了：
        # 体检取**腕那一行**上的那条界——近臂与躯干就是在那一行上分开的。
        pl = sp.get('torsoL') or sp.get('armR')
        if pl:
            yy = sp['wrist']
            if yy <= pl[0][0]:
                tor0 = pl[0][1]
            elif yy >= pl[-1][0]:
                tor0 = pl[-1][1]
            else:
                for i in range(len(pl) - 1):
                    if pl[i][0] <= yy <= pl[i + 1][0]:
                        t = (yy - pl[i][0]) / max(1e-6, (pl[i + 1][0] - pl[i][0]))
                        tor0 = pl[i][1] + (pl[i + 1][1] - pl[i][1]) * t
                        break
        # 允许 ≤4% 的重叠：那一段是**三角肌**（肩上的肌肉），
        # 它本来就同时属于肩与手臂，躯干从腋下开始、手臂带着三角肌。
        if arm1 > tor0 + 4:
            problems.append(f'近臂的右边 {arm1:.1f}% 压过躯干的左边 {tor0:.1f}% 太多 —— 手臂里带着一条躯干')
        # 后臂：腕那一行，躯干右边与后臂之间的缝
        y = int(Y(sp['wrist']))
        rs = cf.substantial_runs(alpha[y], W, 0.02)
        axis = (X(tor0) + X(tor1)) / 2
        body = None
        for a, b in rs:
            if a <= axis <= b:
                body = (a, b)
                break
        far = None
        if body:
            for a, b in rs:
                if a >= body[1]:
                    far = (a, b)
                    break
        if far and tor1 > far[0] / W * 100 + 2.0:
            problems.append(f'躯干的右边 {tor1:.1f}% 盖过后臂的内缘 {far[0]/W*100:.1f}% —— 后臂被烤进躯干')

        # ---- 4. 腿那一块是不是碎片 -----------------------------------------
        leg_h = (sp['knee'] - sp['hip']) / 100 * H * (154.0 / H)
        shin_h = (sp['ankle'] - sp['knee']) / 100 * H * (154.0 / H)
        # 袍子人物：下沿以下本来就只有一点点腿，切出来是碎片——那是画的实话，不是切错。
        if leg_h < 6 or shin_h < 6:
            notes.append(f'腿很碎（大腿 {leg_h:.1f} / 小腿 {shin_h:.1f} 逻辑单位）—— 画里袍子到脚面就是这样')

        flag = 'OK ' if not problems else 'NG '
        bad_total += len(problems)
        line = f'{flag}{cid:<11}' + ('；'.join(problems) if problems else '')
        if notes:
            line += '   [注] ' + '；'.join(notes)
        print(line)
    print(f'\n共 {bad_total} 处待修')
    return 0


if __name__ == '__main__':
    sys.exit(main())
