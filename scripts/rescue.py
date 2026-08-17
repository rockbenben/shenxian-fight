"""把当前 Gemini 标签页上**已经生成好**的那张图裁下来存进 _raw/。

用途：轮询判据认错导致 TIMEOUT，但图其实已经出来了（skill 红线：超时 ≠ 没出图，
配额已经花掉，丢了就是白烧）。用法：python scripts/rescue.py <cid> <part>
"""
import json, sys, os, time, urllib.request, urllib.parse
from PIL import Image

PROXY = 'http://localhost:3456'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def post(path, body):
    req = urllib.request.Request(PROXY + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=60))


def ev(t, expr):
    return post('/eval', {'target': t, 'expression': expr}).get('value')


cid, part = sys.argv[1], sys.argv[2]
targets = json.load(urllib.request.urlopen(PROXY + '/targets', timeout=30))
t = next((x['id'] for x in targets if 'gemini.google.com' in x.get('url', '')), None)
if not t:
    raise SystemExit('找不到 Gemini 标签页')

rect = ev(t, "(()=>{const a=[...document.images].filter(i=>Math.max(i.naturalWidth,i.naturalHeight)>800);"
             "if(!a.length)return '';const i=a[a.length-1];i.scrollIntoView({block:'center'});"
             "const r=i.getBoundingClientRect();"
             "return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,d:devicePixelRatio,"
             "nw:i.naturalWidth,nh:i.naturalHeight})})()")
if not rect:
    raise SystemExit('页面上没有生成图')
r = json.loads(rect)
print('找到生成图', r['nw'], 'x', r['nh'], flush=True)
time.sleep(1.5)   # 等 scrollIntoView 的平滑滚动停稳，否则截到滚动中途的画面

os.makedirs(os.path.join(ROOT, '_raw'), exist_ok=True)
shot = os.path.join(ROOT, '_raw', f'{cid}_{part}.png')
urllib.request.urlopen(f'{PROXY}/shot?target={t}&file=' + urllib.parse.quote(shot), timeout=60).read()

# 只裁到图片自己的矩形；recut.py 负责后面的抠品红/按墨量收紧/装框
d = r['d']
im = Image.open(shot).convert('RGBA')
im.crop((int(r['x'] * d), int(r['y'] * d),
         int((r['x'] + r['w']) * d), int((r['y'] + r['h']) * d))).save(shot)
print('已存', shot, Image.open(shot).size, flush=True)
