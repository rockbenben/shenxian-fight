"""给指定的角色改手臂的切法（armMask: "color" / true / 删掉）。

用法：C:\Python314\python.exe scripts/set-arm-mask.py <角色id> <color|flood|none>
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'scripts', 'fullbody-spec.json')
sp = json.load(open(P, encoding='utf-8'))
for cid in sys.argv[1:-1]:
    mode = sys.argv[-1]
    if mode == 'none':
        sp[cid].pop('armMask', None)
    elif mode == 'flood':
        sp[cid]['armMask'] = True
    else:
        sp[cid]['armMask'] = mode
    print(cid, '->', sp[cid].get('armMask'))
json.dump(sp, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
