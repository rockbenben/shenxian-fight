"""生成**全身**角色图的提示词：一个人从头到脚，站着，双臂垂在身侧。

为什么改成整人一张：躯干是画的、手臂是程序化的圆柱，两种画法并排，
关节永远对不上（这一路都在治这个）。整人一张再在关节处切开，
接缝由**切的位置**保证，两半也出自同一张画，风格天然一致。

用法：python design-preview/tools/make-fullbody-prompts.py
输出：scripts/fullbody-prompts.json（供 gen-char-art-matrix 之类用）
"""
import json
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'char-art.json')
DST = os.path.join(ROOT, 'scripts', 'fullbody-prompts.json')

d = json.load(open(SRC, encoding='utf-8'))
heads = {h['id']: h['desc'] for h in d['heads']}
torsos = {t['id']: t['desc'] for t in d['torsos']}

STYLE = d['style']
CONTRACT = (
    " A single full-body character, one view only, one subject alone in the picture: the whole body "
    "from the top of the head to the soles of the feet, standing upright and relaxed with both arms "
    "hanging straight down, each arm held a little away from the body so that a clear strip of "
    "background shows between the arm and the torso, and both legs straight, nothing cropped. "
    "The body is turned about 35 degrees so that the chest and the belly face the RIGHT of the picture "
    "and the back is at the LEFT; the head is turned the same way, its nose also pointing to the right. "
    "The hands are open and empty at the sides of the body. The feet are bare and simple. "
    "The silhouette is clear and readable against the flat background, the whole figure centred in "
    "the frame with a small margin all around. "
    "No text, no letters, no words, no watermark, no signature."
)

items = []
for cid in sorted(set(list(heads) + list(torsos))):
    head = heads.get(cid, '')
    torso = torsos.get(cid, '')
    # 头与身的描述合成一句：去掉各自的 "Head and neck only of ..." / "Torso only of ..." 前缀
    h = head.replace('Head and neck only of ', '').replace('Head only of ', '')
    t = torso.replace('Torso only of ', '')
    desc = f" The character is: {h} {t}"
    items.append({'id': cid, 'desc': desc, 'style': STYLE, 'contract': CONTRACT})

out = {'style': STYLE, 'contract': CONTRACT, 'items': items}
io.open(DST, 'w', encoding='utf-8', newline='').write(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print('写出', DST, len(items), '个角色')
for it in items[:2]:
    print(' -', it['id'], ':', it['desc'][:110], '...')
