"""把整人一张画的全身图切成纸偶的 8 块，并算出该角色的骨架尺寸（rig）。

为什么切：**接缝由切的位置保证**。躯干是画的、四肢是程序化圆柱，两种画法并排，
接口永远对不齐（这一路都在治它）。整人一张画再切，接口与颜色天然成立。

为什么还要算骨架尺寸：切出来的每一块都会被**拉伸**到骨架那一段的长度上。
骨架原本是十二人共用的一副（肩 118、髋 62、上臂 26、大腿 32）——猪八戒画里
15% 高的短腿会被抻成 64 单位的长腿、小孩的短手臂会被抻长。比例一丢，
"整人一张画"就只剩"同一套颜色"的意思了。所以这里量出**这个人**的骨架尺寸（rig），
渲染层按 rig 挂载，每一块按画里的原尺寸 1:1 落位——不抻、不变形。

切线从哪来：scripts/fullbody-spec.json 里逐人写的解剖位置（人眼在
design-preview/tools/fullbody-grid.py 铺的网格图上读，横向边界再用
scripts/row-runs.py 的像素行数据校正）。衣摆下沿与踝是**自动量**的。

用法：
  python scripts/cut-fullbody.py <角色id> [<角色id>...]
输入：_raw/<id>_full.png（scripts/gen-fullbody-matrix.mjs 出的）
输出：public/chars/<id>/parts/{head,torso,armFU,armFL,handF,legFU,legFL,footF}.png
      design-preview/out/cut/<id>-rig.json
      design-preview/out/cut/<id>-pieces.png（拼版核对图）
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, '_raw')
OUTPARTS = os.path.join(ROOT, 'public', 'chars')
OUT = os.path.join(ROOT, 'design-preview', 'out', 'cut')
SPEC_PATH = os.path.join(ROOT, 'scripts', 'fullbody-spec.json')

# 骨架基准：画里整个人的高度（头顶→脚底）折算成多少逻辑单位。
# 150 是十二人身高的中位数（见 renderer 的 bodyScale），与改之前"头贴图底边
# 对齐颈点、头顶 154"的那套一致。
FIG_H = 154.0

# 描边阈值：纸偶切件要靠描边把肢体和躯干分开（近侧手臂压在躯干上，
# 不按描边切就会把一块躯干像素带进手臂那块，抬手时那块像素会跟着飞出去）。
OUTLINE_LUM = 105


def is_magenta(r, g, b):
    return r > 110 and b > 110 and g < min(r, b) * 0.72


def load_clean(path, max_h=700):
    """读原图，抠掉品红底，裁到内容框；**并把高度压到 max_h**。

    为什么压：原图是 2K（1696×2528），切出来的躯干那一块能有 1000 多像素高。
    角色在屏幕上只有 ~154 逻辑单位高（dpr 2 也就 300 多像素），按原分辨率切，
    十一个人全套就是 16MB 的 PNG—— precache 进去每个玩家白下载。
    压到 700 高（约为屏幕的 2.3 倍）画质绰绰有余，体积降到 1/13。
    """
    im = Image.open(path).convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and is_magenta(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    bb = im.getbbox()
    im = im.crop(bb) if bb else im
    if im.size[1] > max_h:
        sc = max_h / im.size[1]
        im = im.resize((max(1, int(im.size[0] * sc)), max_h), Image.LANCZOS)
    return im


def runs_of(row):
    """一行里的不透明段（起止列号）。"""
    idx = np.where(row > 8)[0]
    if len(idx) == 0:
        return []
    out = []
    start = prev = idx[0]
    for i in idx[1:]:
        if i > prev + 1:
            out.append((int(start), int(prev)))
            start = i
        prev = i
    out.append((int(start), int(prev)))
    return out


def substantial_runs(row, W, min_frac=0.03):
    """一行里够宽的不透明段（宽度 ≥ 画幅的 min_frac）。

    为什么要有"够宽"这一层：脚趾之间的缝、下巴的高光缝隙都会把一行切成好几段，
    不滤掉的话，"两条腿分开"这件事在脚底就成立，衣摆下沿会被量到脚趾尖上。
    """
    out = []
    for x0, x1 in runs_of(row):
        if (x1 - x0) >= W * min_frac:
            out.append((x0, x1))
    return out


def is_split(row, W, gap_frac=0.03):
    """这一行算不算"两条腿分开了"：要有两段够宽的、且**中间那道缝够宽**。

    为什么还要看缝：脚趾之间的缝只有一两个像素，按"段数≥2"判，脚底就成立，
    衣摆下沿会被量到脚趾尖上（实测 99.6%，差了一整条腿）。
    """
    rs = substantial_runs(row, W, 0.02)
    if len(rs) < 2:
        return False
    gaps = [rs[i + 1][0] - rs[i][1] for i in range(len(rs) - 1)]
    return max(gaps) >= W * gap_frac


def detect_hem(alpha, W, H):
    """衣摆下沿（腿根）：剪影**分成两条腿**的那一整段的最上端。

    为什么自动量：袍子/裙子的下沿就是腿的根。这一行往下两条腿分开、往上并成
    一整片衣服——量这一条比人眼估准得多，估错 5% 就是"腿根错位、袍子裂开"。
    """
    lo = int(H * 0.25)
    split = [is_split(alpha[y], W) for y in range(H)]
    y = H - 1
    while y > lo and not split[y]:
        y -= 1
    miss = 0
    while y > lo and miss <= 2:
        if split[y]:
            miss = 0
        else:
            miss += 1
        y -= 1
    miss = 0
    while y > lo:
        if split[y]:
            miss = 0
        else:
            miss += 1
            if miss >= 3:
                return y + 1
        y -= 1
    return int(H * 0.6)


def detect_ankle(alpha, W, H, hem):
    """踝：下沿以下，腿最细的那一行（再往下就是脚掌，脚掌是往横里张开的）。"""
    best_y, best_w = None, None
    limit = H - max(4, int(H * 0.04))
    for y in range(hem, max(hem + 1, limit)):
        rs = substantial_runs(alpha[y], W, 0.02)
        if not rs:
            continue
        w = max(x1 - x0 for x0, x1 in rs)
        if best_w is None or w < best_w:
            best_w, best_y = w, y
    return best_y if best_y is not None else limit - 1


def flood_mask(im, seed, outline_lum=OUTLINE_LUM):
    """从 seed 出发做连通域填充，**描边当屏障**。

    为什么：近侧手臂压在躯干上，两块贴图叠着画。切手臂那一块时若按矩形取，
    会把一条躯干像素带进手臂件——手一抬，那条像素就跟着飞到胸口前面去了。

    但在这批画上它并不可靠：描边的深浅每个角色不同，填到一半会漏进躯干
    （实测把哪吒的手臂切碎过）。所以默认**不用**它，只留作雷震子（翅膀压在
    手臂上、必须抠掉）的场合。
    """
    from scipy import ndimage
    arr = np.array(im.convert('RGB')).astype(np.float32)
    lum = arr[:, :, 0] * 0.299 + arr[:, :, 1] * 0.587 + arr[:, :, 2] * 0.114
    alpha = np.array(im.getchannel('A'))
    wall = (lum < outline_lum) | (alpha < 8)
    wall = ndimage.binary_dilation(wall, np.ones((3, 3), bool), iterations=2)
    lab, n = ndimage.label(~wall, structure=np.ones((3, 3)))
    sx, sy = seed
    if not (0 <= sy < lab.shape[0] and 0 <= sx < lab.shape[1]):
        return None
    v = lab[sy, sx]
    if v == 0:
        for dy in range(-6, 7):
            for dx in range(-6, 7):
                yy, xx = sy + dy, sx + dx
                if 0 <= yy < lab.shape[0] and 0 <= xx < lab.shape[1] and lab[yy, xx] != 0:
                    v = lab[yy, xx]
                    break
            if v:
                break
    if v == 0:
        return None
    return lab == v


def trim_box(im, threshold=10):
    """内容包围盒。阈值与 src/render/parts.ts 的 trimBox 一致（10）——
    两边裁得不一样，渲染层算出的宽高就和这里对不上，贴图会被抻。"""
    a = np.array(im.getchannel('A'))
    ys = np.where(a > threshold)[0]
    xs = np.where(a > threshold)[1]
    if len(ys) == 0:
        return (0, 0, im.size[0], im.size[1])
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def apply_mask(im, mask):
    out = im.copy()
    a = np.array(out.getchannel('A'))
    a[~mask] = 0
    out.putalpha(Image.fromarray(a))
    return out


def crop_pct(im, x0, y0, x1, y1):
    """按百分比裁（百分比相对整幅）。"""
    W, H = im.size
    box = (int(round(W * x0 / 100)), int(round(H * y0 / 100)),
           int(round(W * x1 / 100)), int(round(H * y1 / 100)))
    box = (max(0, box[0]), max(0, box[1]), min(W, box[2]), min(H, box[3]))
    if box[2] <= box[0]:
        box = (box[0], box[1], min(W, box[0] + 1), box[3])
    if box[3] <= box[1]:
        box = (box[0], box[1], box[2], min(H, box[1] + 1))
    return im.crop(box)


def cut_one(cid, spec, verbose=True):
    src = os.path.join(RAW, f'{cid}_full.png')
    if not os.path.exists(src):
        print(f'{cid}: 没有 {src}')
        return None
    im = load_clean(src)
    W, H = im.size
    if 'box' in spec:
        b = spec['box']
        im = crop_pct(im, b[0], b[1], b[2], b[3])
        W, H = im.size

    def X(p):
        return W * p / 100

    def Y(p):
        return H * p / 100

    outdir = os.path.join(OUTPARTS, cid, 'parts')
    os.makedirs(outdir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    alpha = np.array(im.getchannel('A'))

    # ---- 自动量两处最难的位置：衣摆下沿（腿根）与踝 ------------------------
    if spec.get('autoHem', True):
        spec = dict(spec)
        hem_row = detect_hem(alpha, W, H)
        hem_pct = hem_row / H * 100
        # 量出来的不合理（贴到脚底或高过腰）就退回规格表里写的：
        # 自动量在"两条腿并在一起"（脚背相碰）时会失效。
        if not (25 < hem_pct < 93):
            print(f'  （衣摆自动量得 {hem_pct:.1f}%，不合理，用规格表里的 {spec["hip"]}%）')
        else:
            spec['hip'] = hem_pct
        spec['ankle'] = detect_ankle(alpha, W, H, int(spec['hip'] / 100 * H)) / H * 100
        # 膝盖取腿中点（画里腿几乎是直的，中点就是膝盖）
        spec['knee'] = (spec['hip'] + spec['ankle']) / 2
        # 脚那一块的横向：踝两侧各留一点
        leg0, leg1 = spec['leg']
        spec['foot'] = [max(0, leg0 - 3), min(100, leg1 + 3)]
        print(f'  自动量：衣摆 {spec["hip"]:.1f}%  膝 {spec["knee"]:.1f}%  踝 {spec["ankle"]:.1f}%')

    # 身体中轴：躯干裁切框的中心。手臂切线要靠它认出「紧挨躯干的那一段」
    # （哪吒的混天绫飘在手臂左边，"最左边那一段"会把它圈进来）。
    axis_px = (X(spec['torso'][0]) + X(spec['torso'][1])) / 2

    # ---- 近侧手臂（画面左 = 近侧）三段 ---------------------------------------
    def arm_x_range(y0, y1, fallback):
        """这一段手臂的横向范围。

        取的是**紧挨着躯干的那一段**，不是"最左边那一段"：
        哪吒的混天绫飘在手臂左边，"最左边"会把它圈进来，切出来的手臂块
        左边就挂着一截红绸（那截绸在肩上看着像块补丁）。

        内缘取**最大**的右端——那一行是这条手臂最宽的地方（三角肌那截）。
        前提是"肩上手臂与躯干连着"的那几行已被宽度门槛滤掉：
        不滤的话那几行的右端是**躯干**的边，内缘会被撑到躯干那边去。
        """
        los, his = [], []
        y = int(Y(y0))
        while y < int(Y(y1)):
            rs = substantial_runs(alpha[y], W, 0.02)
            if rs:
                body_i = None
                for i, (a, b) in enumerate(rs):
                    if a <= axis_px <= b:
                        body_i = i
                        break
                cand = None
                if body_i is not None and body_i > 0:
                    cand = rs[body_i - 1]
                elif body_i is None:
                    cand = rs[0]
                if cand and (cand[1] - cand[0]) <= W * 0.35:
                    los.append(cand[0])
                    his.append(cand[1])
            y += max(1, int(H * 0.004))
        if not los:
            return fallback
        los.sort()
        outer = los[len(los) // 2]      # 外缘取中位数：飘带偶尔与手臂连成一段
        return [outer / W * 100, max(outer + 1, max(his)) / W * 100]

    arm_segs = [('armFU', spec['shoulder'], spec['elbow'], spec.get('armFU', spec['arm'])),
                ('armFL', spec['elbow'], spec['wrist'], spec.get('armFL', spec['arm'])),
                ('handF', spec['wrist'], spec['handEnd'], spec.get('handF', spec['arm']))]
    arm_mask = None
    if spec.get('armMask', False):
        # 只有"手臂压在别的东西上"的角色才抠（雷震子的翅膀）。
        elbow_y = int(Y(spec['elbow']))
        seed = None
        for a, b in substantial_runs(alpha[elbow_y], W, 0.02):
            seed = ((a + b) // 2, elbow_y)
            break
        if seed is None:
            seed = (X((spec['arm'][0] + spec['arm'][1]) / 2), elbow_y)
        arm_mask = flood_mask(im, seed)
        if arm_mask is not None:
            from scipy import ndimage
            arm_mask = ndimage.binary_dilation(arm_mask, np.ones((5, 5), bool), iterations=1)
            xs = np.where(arm_mask.any(axis=0))[0]
            if len(xs):
                ax0 = max(0, xs.min() - 1) / W * 100
                ax1 = min(W, xs.max() + 2) / W * 100
                arm_segs = [(n, y0, y1, [ax0, ax1]) for n, y0, y1, _ in arm_segs]
    pieces = {}
    for name, y0, y1, xr in arm_segs:
        if not spec.get('armOverride'):
            xr = arm_x_range(y0, y1, xr)
        # 裁切框与掩码切片必须用同一组整数，否则差一像素（掩码对不上，apply_mask 直接抛）
        bx0 = max(0, int(round(W * xr[0] / 100)))
        by0 = max(0, int(round(H * y0 / 100)))
        bx1 = min(W, int(round(W * xr[1] / 100)))
        by1 = min(H, int(round(H * y1 / 100)))
        piece = im.crop((bx0, by0, max(bx0 + 1, bx1), max(by0 + 1, by1)))
        if arm_mask is not None:
            piece = apply_mask(piece, arm_mask[by0:by1, bx0:bx1])
        pieces[name] = piece

    # ---- 头 / 躯干 / 腿 / 脚 ------------------------------------------------
    pieces['head'] = crop_pct(im, spec['head'][0], spec['head'][1], spec['head'][2], spec['head'][3])
    pieces['torso'] = crop_pct(im, spec['torso'][0], spec['chin'], spec['torso'][1], spec['hip'])
    pieces['legFU'] = crop_pct(im, spec['leg'][0], spec['hip'], spec['leg'][1], spec['knee'])
    pieces['legFL'] = crop_pct(im, spec['leg'][0], spec['knee'], spec['leg'][1], spec['ankle'])
    pieces['footF'] = crop_pct(im, spec['foot'][0], spec['ankle'], spec['foot'][1], 100)

    # ---- 存盘 + 量尺寸 -----------------------------------------------------
    k = FIG_H / H          # 画里 1 像素 = 多少逻辑单位
    rig = {'k': k, 'srcH': H, 'srcW': W}
    for name, piece in pieces.items():
        piece.save(os.path.join(outdir, f'{name}.png'))
        tb = trim_box(piece)
        pw = tb[2] - tb[0]
        ph = tb[3] - tb[1]
        rig[name] = {'w': pw * k, 'h': ph * k}

    # 关节高度（离地，逻辑单位）：脚底为 0
    def above(pct):
        return (100 - pct) / 100 * H * k

    rig['chinY'] = above(spec['chin'])
    rig['shoulderY'] = above(spec['shoulder'])
    rig['hipY'] = above(spec['hip'])
    rig['neckLen'] = rig['chinY'] - rig['shoulderY']

    # 两条腿各自的横向偏移（相对身体中轴）。画里两条腿是岔开的，
    # 而骨架的两条腿都从同一个髋点出发——不给偏移就会并到中轴上。
    leg_x = []
    knee_y = int(Y(spec['knee']))
    for a, b in substantial_runs(alpha[knee_y], W, 0.02):
        leg_x.append((a + b) / 2)
    if len(leg_x) >= 2:
        rig['legFDx'] = (max(leg_x) - axis_px) * k     # 画面右边那条是前腿
        rig['legBDx'] = (min(leg_x) - axis_px) * k
    else:
        rig['legFDx'] = 0
        rig['legBDx'] = 0

    # 近肩：量上臂那一块最上面几行的内容中心（上臂的最上端就是肩）
    arm_piece = pieces['armFU']
    tb = trim_box(arm_piece)
    top_rows = arm_piece.crop((0, tb[1], arm_piece.size[0], tb[1] + max(1, (tb[3] - tb[1]) // 8)))
    a = np.array(top_rows.getchannel('A'))
    cols = np.where((a > 10).any(axis=0))[0]
    arm_x0 = spec.get('armFU', spec['arm'])[0]
    shoulder_px = X(arm_x0) + ((cols.min() + cols.max()) / 2 if len(cols) else 0)
    # 后肩：肩线那一行最右边一段的右缘
    sh_row = alpha[int(Y(spec['shoulder']))]
    rs = substantial_runs(sh_row, W, 0.03)
    back_px = rs[-1][1] if rs else axis_px
    rig['shoulderDx'] = (shoulder_px - axis_px) * k
    rig['backShoulderDx'] = (back_px - axis_px) * k
    rig['axisX'] = axis_px

    # 头件的横向挂点：**保持它在画里的位置**，不要按脸心再对齐一次。
    # 旧版的头是**单独画的肖像**，头冠、飘带全长在左边，要把脸心挪到身体中轴上；
    # 纸偶的头却是从**整人一张画**上裁下来的——脸相对身体的位置本来就是对的
    # （角色朝右，脸心在身体中轴右边），再按脸心对齐一次等于把整个头平移半个头宽。
    head_box = trim_box(pieces['head'])
    head_c_px = X(spec['head'][0]) + (head_box[0] + head_box[2]) / 2
    rig['headDx'] = (head_c_px - axis_px) * k

    # 骨段长度：取**切出来那一块**的高（渲染层会把它拉满整段骨长，两者必须相等）
    rig['upperArm'] = rig['armFU']['h']
    rig['lowerArm'] = rig['armFL']['h']
    rig['handLen'] = rig['handF']['h']
    rig['thigh'] = rig['legFU']['h']
    rig['shin'] = rig['legFL']['h']
    rig['torsoLen'] = rig['chinY'] - rig['hipY']

    # 脚件：锚点（踝）在脚件里的横向位置
    fbox = trim_box(pieces['footF'])
    ankle_in_foot = (X(spec['ankleX']) - X(spec['foot'][0]) - fbox[0]) / max(1, fbox[2] - fbox[0])
    rig['footAnchorX'] = max(0.0, min(1.0, ankle_in_foot))
    rig['footLen'] = rig['footF']['h']

    # 脸的位置：头件要按**脸**挂到身体中轴上（头冠、飘带、火焰都长在左边）
    try:
        import importlib.util
        mh_path = os.path.join(ROOT, 'scripts', 'measure-heads.py')
        sspec = importlib.util.spec_from_file_location('mh', mh_path)
        mh = importlib.util.module_from_spec(sspec)
        sspec.loader.exec_module(mh)
        fr = mh.face_rect(pieces['head'])
        if fr:
            rig['face'] = [float(v) for v in fr]
    except Exception as e:      # 量不到不致命：退回按整幅居中挂
        print('  （脸框没量出来：%s）' % e)

    with open(os.path.join(OUT, f'{cid}-rig.json'), 'w', encoding='utf-8') as f:
        json.dump(rig, f, ensure_ascii=False, indent=2)

    # ---- 拼版核对图 --------------------------------------------------------
    order = ['head', 'torso', 'armFU', 'armFL', 'handF', 'legFU', 'legFL', 'footF']
    W2 = 940
    rowh = 300
    sheet = Image.new('RGB', (W2, rowh * 2 + 40), (240, 236, 226))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(order):
        p = pieces[name]
        s = min(190 / max(1, p.size[0]), 250 / max(1, p.size[1]), 1.0)
        w2, h2 = max(1, int(p.size[0] * s)), max(1, int(p.size[1] * s))
        col, row = i % 4, i // 4
        px = 14 + col * 232
        py = 34 + row * rowh
        sheet.paste(p.resize((w2, h2), Image.LANCZOS), (px, py))
        d.text((px, py - 16), f'{name} {p.size[0]}x{p.size[1]}', fill=(20, 20, 20))
    d.text((14, rowh * 2 + 8),
           f'rig: chinY={rig["chinY"]:.1f} shoulderY={rig["shoulderY"]:.1f} hipY={rig["hipY"]:.1f} '
           f'headDx={rig["headDx"]:.1f} arm={rig["upperArm"]:.1f}+{rig["lowerArm"]:.1f} '
           f'leg={rig["thigh"]:.1f}+{rig["shin"]:.1f} legDx={rig["legFDx"]:.1f}/{rig["legBDx"]:.1f}',
           fill=(180, 0, 0))
    sheet.save(os.path.join(OUT, f'{cid}-pieces.png'))
    if verbose:
        print(f'{cid}: 切完 8 块 → {os.path.relpath(outdir, ROOT)}')
    return rig


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith('-')]
    if not ids:
        print(__doc__)
        return
    with open(SPEC_PATH, encoding='utf-8') as f:
        spec_all = json.load(f)
    for cid in ids:
        if cid not in spec_all:
            print(f'{cid}: 规格表里没有这个角色')
            continue
        cut_one(cid, spec_all[cid])


if __name__ == '__main__':
    main()
