"""试某个角色的手臂连通域：填充出来的那块是不是「手臂自己」。

用法：C:\Python314\python.exe scripts/probe-arm-mask.py niumo bajie nezha ...
"""
import importlib.util
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cf_spec = importlib.util.spec_from_file_location('cf', os.path.join(ROOT, 'scripts', 'cut-fullbody.py'))
cf = importlib.util.module_from_spec(cf_spec)
cf_spec.loader.exec_module(cf)

spec_all = json.load(open(os.path.join(ROOT, 'scripts', 'fullbody-spec.json'), encoding='utf-8'))

for cid in sys.argv[1:]:
    sp = spec_all[cid]
    im = cf.load_clean(os.path.join(ROOT, '_raw', f'{cid}_full.png'))
    W, H = im.size
    if 'box' in sp:
        b = sp['box']
        im = cf.crop_pct(im, b[0], b[1], b[2], b[3])
        W, H = im.size
    alpha = np.array(im.getchannel('A'))
    axis = (W * sp['torso'][0] / 100 + W * sp['torso'][1] / 100) / 2
    ey = int(H * sp['elbow'] / 100)
    rs = cf.substantial_runs(alpha[ey], W, 0.02)
    body_i = None
    for i, (a, bb) in enumerate(rs):
        if a <= axis <= bb:
            body_i = i
            break
    arm = rs[body_i - 1] if body_i else rs[0]
    seed = ((arm[0] + arm[1]) // 2, ey)
    print(f'== {cid}: 肘行 {[(round(a/W*100), round(b/W*100)) for a, b in rs]}  '
          f'手臂段 {round(arm[0]/W*100)}~{round(arm[1]/W*100)}%  种子 {seed}')
    for th in (105, 135, 165):
        m = cf.flood_mask(im, seed, outline_lum=th)
        if m is None:
            print(f'   阈值{th}: 填不出来')
            continue
        xs = np.where(m.any(axis=0))[0]
        ys = np.where(m.any(axis=1))[0]
        print(f'   阈值{th}: 填充范围 x {xs.min()/W*100:.0f}~{xs.max()/W*100:.0f}%  '
              f'y {ys.min()/H*100:.0f}~{ys.max()/H*100:.0f}%')
