"""给规格表里加一个角色（避免手改大 JSON）。

用法：C:\Python314\python.exe scripts/add-spec.py <角色id> <json片段>
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'scripts', 'fullbody-spec.json')
sp = json.load(open(P, encoding='utf-8'))
cid = sys.argv[1]
sp[cid] = json.loads(sys.argv[2])
json.dump(sp, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('added', cid, '->', list(sp[cid].keys()))
