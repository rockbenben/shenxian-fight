"""关卡远景出图（Gemini 网页通道）：十二张远景画完，落盘到 public/stages/<id>/far.webp。

为什么有两个生成脚本：出图通道有两条，各有各的门槛。
  · 本脚本（Gemini 网页）：走仓库既有的 CDP 管线，额度在 Google 账号上，需要副本里登录过；
  · scripts/gen-stage-art-matrix.mjs（MiniMax Matrix）：一条命令就能跑，额度在 MiniMax 账号上。
两边出的是同一样东西——**提示词与关卡清单共用 scripts/stage-art.json**，不各写一份。
后处理（裁切/量化/羽化/压 webp）也共用本文件的 postprocess()。

前置：Chrome 副本(9222) + ai-image-gen 的 cdp-proxy(3456) 都在跑，**Gemini 已登录**。

用法：
  python scripts/gen-stage-art.py              # 续跑（已存在跳过）
  python scripts/gen-stage-art.py nezha niumo  # 点名重出
  python scripts/gen-stage-art.py --postprocess  # 只做后处理（改了裁切/配色时用，零配额）

产物分两段，与 scripts/gen-parts.py 同一套规矩：
  · **原生分辨率**先落到 _raw/stages/<id>.png（出图烧配额，后处理可重跑，两者解耦）
  · 再由 postprocess() 压成关卡色阶的平涂远景带，进 public/stages/<id>/far.webp
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from PIL import Image, ImageFilter

PROXY = 'http://localhost:3456'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, '_raw', 'stages')
OUTROOT = os.path.join(ROOT, 'public', 'stages')
os.makedirs(RAW, exist_ok=True)

# 提示词与关卡清单：与 gen-stage-art-matrix.mjs 共用同一份，两边不许各写一遍
_cfg = json.load(open(os.path.join(ROOT, 'scripts', 'stage-art.json'), encoding='utf-8'))
STYLE = _cfg['style']
STAGES = [(s['id'], s['place'], s['detail']) for s in _cfg['stages']]


def post(path, body):
    req = urllib.request.Request(PROXY + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=90))


def ev(target, expr):
    return post('/eval', {'target': target, 'expression': expr}).get('value')


def big_imgs(target):
    """当前页面上的生成图（长边 >800），返回 src 列表。

    判据必须用**长边**：那是照着 Gemini 默认横图定的；改构图要求就得回头看这个判据。
    """
    raw = ev(target, "JSON.stringify([...document.images]"
                     ".filter(i=>Math.max(i.naturalWidth,i.naturalHeight)>800).map(i=>i.src))")
    try:
        return json.loads(raw or '[]')
    except Exception:
        return []


def colors_of(stage_id):
    """这一关的色板：剪影色、地面色、天色两档。从 src/data/stages.ts 里读，
    不另抄一份——抄的那份一定会漂。"""
    src = open(os.path.join(ROOT, 'src', 'data', 'stages.ts'), encoding='utf-8').read()
    m = re.search(r"id: '%s'.*?sky: \['(#[0-9a-fA-F]{6})', '(#[0-9a-fA-F]{6})'\]"
                  r".*?ground: '(#[0-9a-fA-F]{6})'.*?silhouette: '(#[0-9a-fA-F]{6})'"
                  % re.escape(stage_id), src, re.S)
    if not m:
        return '#0e1420', '#1a2a3a', '#101820', '#0a0f18'
    return m.group(4), m.group(3), m.group(2), m.group(1)


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mix_rgb(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def postprocess(raw_path, stage_id):
    """原生图 → public/stages/<id>/far.webp。

    **这一层是"调色"，但调色的前提是画本身要摆对位置。**

    上一版把它裁成"地平线以下的一条带"塞进画面中段，十二关实测下来全是三条横带
    （渐变天 / 一条外来画带 / 黑山带）——画与舞台各说各话，怎么调色都还是"贴上去的"。

    现在远景是**整幅背板**：画铺满画面上部（自己的天空、自己的远山、自己的地面），
    程序化的星辰与月亮画在它**上面**，角色站在画里的地面上。舞台自己的天空渐变、
    云纹、山形剪影在有画时全部退场——一份背景只留一个来源。
    于是这一步只剩一件事：**把画的颜色拉进这一关的色板**。

    四步：
      1. **不裁**。原图就是 16:9（2752×1536），构图完整留着：上半是提示词要来的"空天"，
         下半是远方的大地。裁任何一刀都会把地平线或天空切掉半边。
      2. **按色相调色**：把画乘上这一关的主色（天色），除以主色自己的亮度——
         于是亮度结构原样保留、只有色相被拉过去。再压暗一档、往地面色沉一点，
         远景就该是背景该有的亮度。
      3. **不量化**。上一版把画量化成几个平色块再映到色阶上，结果形状糊成一团
         （石牌坊、竹子、屋顶全成了同色的块）——那是"把画变成剪影"的路子，
         而这一版画要保留自己的形体，所以不能量化。
      4. 压成 webp：十二张要进离线包，png 每张 300~500KB，webp 同一张 40~90KB。
    """
    im = Image.open(raw_path).convert('RGB')
    w, h = im.size
    out_w = 1280
    out_h = max(64, int(out_w * im.height / im.width))
    im = im.resize((out_w, out_h), Image.LANCZOS)

    sil_hex, ground_hex, sky_hex, sky0_hex = colors_of(stage_id)
    key = hex_rgb(sky_hex)                                   # 这一关的主色（天色）
    ground = hex_rgb(ground_hex)
    # 色相归一化：把主色除以它最大的通道，得到"纯度方向"。
    # 这一步是必须的：直接按主色相乘，红通道会被顶到 255 截断（熔岩关那张整片橙红
    # 与随后的白屏都是这么来的）——而**饱和红的亮度上限只有 0.299×255**，
    # 亮度超过 70 的像素根本不可能是纯红，通道必然溢出。
    kmax = max(key) or 1
    cn = [c / kmax for c in key]
    lmax = 255 * (0.299 * cn[0] + 0.587 * cn[1] + 0.114 * cn[2])   # 这个色相能承载的最大亮度
    # 色调曲线：亮度按 gamma 压下去再乘一档。
    # 为什么要曲线而不是单纯乘一个系数：出图的亮度差别极大（熔岩洞那张满屏是亮的橙，
    # 白虎岭那张大半是灰），单一系数压不住——压轻了熔岩关亮得把角色吞掉，
    # 压重了别的关就全糊成黑。曲线压的是中调与高光，黑场不受影响。
    GAMMA = 1.28
    DARK = 0.8
    # 色相往这一关的主色上拉多少。**先定亮度、再拉色相**，顺序不能反。
    CHROMA = 0.55
    SINK = 0.12        # 往地面色沉一点：整幅画因此与舞台同一口气

    px = im.load()
    for y in range(out_h):
        for x in range(out_w):
            r, g, b = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            # 目标亮度：曲线给一档，再被这个色相的承载上限封一次顶
            L = min(((lum / 255.0) ** GAMMA) * DARK * 255, lmax)
            tr, tg, tb = cn[0] * L, cn[1] * L, cn[2] * L
            r = r + (tr - r) * CHROMA
            g = g + (tg - g) * CHROMA
            b = b + (tb - b) * CHROMA
            r = r + (ground[0] - r) * SINK
            g = g + (ground[1] - g) * SINK
            b = b + (ground[2] - b) * SINK
            px[x, y] = (min(255, int(r)), min(255, int(g)), min(255, int(b)))
    dest = os.path.join(OUTROOT, stage_id, 'far.webp')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    im.save(dest, 'WEBP', quality=80, method=6)
    return dest, os.path.getsize(dest)

    im.save(dest, 'WEBP', quality=80, method=6)
    return dest, os.path.getsize(dest)


def fetch_img(target, src, dest):
    """优先直接下载 img.src；拿不到（403/需要会话）再退回截图裁。

    直接下载比截图裁可靠得多：截图只有视口那么大，而生成图常常比视口高，
    裁出来的会是"画的一部分 + 页面 UI"。"""
    try:
        req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=60).read()
        if len(data) > 20000:
            with open(dest, 'wb') as f:
                f.write(data)
            return True
    except Exception as e:
        print('   直接下载失败，退回截图：', repr(e)[:120], flush=True)
    # 退回：按 img 自己的 rect 裁截图
    rect = json.loads(ev(target,
        "(()=>{const a=[...document.images].filter(i=>Math.max(i.naturalWidth,i.naturalHeight)>800);"
        "const i=a[a.length-1];i.scrollIntoView({block:'center'});const r=i.getBoundingClientRect();"
        "return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,d:devicePixelRatio})})()"))
    time.sleep(1)
    shot = os.path.join(RAW, f'_shot_{os.path.basename(dest)}.png')
    urllib.request.urlopen(f'{PROXY}/shot?target={target}&file=' + urllib.parse.quote(shot),
                            timeout=60).read()
    d = rect['d']
    im = Image.open(shot).convert('RGB')
    W0, H0 = im.size
    box = (max(0, int(rect['x'] * d)), max(0, int(rect['y'] * d)),
           min(W0, int((rect['x'] + rect['w']) * d)), min(H0, int((rect['y'] + rect['h']) * d)))
    if box[2] <= box[0] or box[3] <= box[1]:
        return False
    im.crop(box).save(dest)
    return True


def make(target, stage_id, place, detail):
    raw = os.path.join(RAW, f'{stage_id}.png')
    prompt = f'{STYLE} A {place}. {detail}.'
    # 每件开一条**新对话**。复用同一个线程时踩过：某次生成挂住之后，后续 /enter 全部发不出去。
    ev(target, "location.href='https://gemini.google.com/app'")
    for _ in range(30):
        time.sleep(2)
        if ev(target, "!!document.querySelector('.ql-editor')"):
            break
    time.sleep(2)
    prev_last = (big_imgs(target) or [''])[-1]
    ev(target, "(()=>{const e=document.querySelector('.ql-editor');e.focus();"
               "const r=document.createRange();r.selectNodeContents(e);"
               "const s=getSelection();s.removeAllRanges();s.addRange(r);"
               "document.execCommand('insertText',false," + json.dumps(prompt) + ");return 1})()")
    # 先开焦点仿真再提交——不这么做，点按钮 editorLen 一直不变，提示词就躺在编辑器里
    post('/focus', {'target': target, 'enabled': True})
    time.sleep(1)
    post('/enter', {'target': target, 'selector': '.ql-editor'})
    time.sleep(2)
    if len(ev(target, "(document.querySelector('.ql-editor')||{}).innerText||''") or '') > 20:
        sent = ev(target, "(()=>{const b=[...document.querySelectorAll('button')]"
                          ".find(x=>/send|发送/i.test((x.getAttribute('aria-label')||'')+x.className));"
                          "if(b){b.click();return 'clicked'}return 'no-button'})()")
        if sent != 'clicked':
            post('/enter', {'target': target, 'selector': '.ql-editor'})
    # 等新图出现（最多 10 分钟）
    for i in range(120):
        time.sleep(5)
        if i < 3:
            continue          # 前 15 秒一律不认：出图从来没这么快
        cur = big_imgs(target)
        if cur and cur[-1] != prev_last:
            break
    else:
        print('TIMEOUT', stage_id, flush=True)
        return False
    time.sleep(3)
    srcs = big_imgs(target)
    if not srcs:
        return False
    if not fetch_img(target, srcs[-1], raw):
        print('拿不到图', stage_id, flush=True)
        return False
    dest, size = postprocess(raw, stage_id)
    print('OK', stage_id, os.path.basename(dest), f'{size // 1024}KB', flush=True)
    return True


FORCE = set(sys.argv[1:])

if __name__ == '__main__':
    # 只做后处理：出图已经落盘，改了裁切/量化时用这一条重跑，零配额
    if '--postprocess' in FORCE:
        n = 0
        for stage_id, _, _ in STAGES:
            raw = os.path.join(RAW, f'{stage_id}.png')
            if not os.path.exists(raw):
                print('skip (没有原图)', stage_id, flush=True)
                continue
            dest, size = postprocess(raw, stage_id)
            print('OK', stage_id, os.path.basename(dest), f'{size // 1024}KB', flush=True)
            n += 1
        print('后处理完成', n, '张', flush=True)
        raise SystemExit(0)

    targets = json.load(urllib.request.urlopen(PROXY + '/targets', timeout=30))
    t = next((x['id'] for x in targets if 'gemini.google.com' in x.get('url', '')), None)
    if not t:
        raise SystemExit('找不到 Gemini 标签页——先开一个并登录（副本里的登录态不会自动带过去）')
    print('target', t, flush=True)
    made = 0
    done = 0
    fails = 0
    for stage_id, place, detail in STAGES:
        dest = os.path.join(OUTROOT, stage_id, 'far.webp')
        if os.path.exists(dest) and stage_id not in FORCE:
            print('skip (已存在)', stage_id, flush=True)
            continue
        made += 1
        try:
            ok = make(t, stage_id, place, detail)
        except Exception as e:
            print('ERR', stage_id, repr(e)[:160], flush=True)
            ok = False
        if ok:
            done += 1
        fails = 0 if ok else fails + 1
        # 件间退避：连续失败通常是 1095 过载或触额，接着捶只会加深封标
        time.sleep(600 if fails >= 2 else 90)
    print('完成', done, '/', made, flush=True)
