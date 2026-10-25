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
    # 原来的判据只看「够亮的品红」。AI 出的背景噪点有深有浅，深的那些躲过了判据，
    # 又连成一片（不是「飞点」那种小块），于是留在画上——白骨精那条新图的胳膊四周
    # 就是这样：切下来一块手臂，上面全是紫点。
    # 所以再加一条**紫调**判据：红与蓝都明显高于绿。肤色阴影是「红 > 绿 > 蓝」，
    # 蓝不高于绿，不会被这条误伤。
    if b >= g + 30 and r >= g + 30:
        return True
    return r > 110 and b > 110 and g < min(r, b) * 0.72


def load_clean(path, max_h=512, keep_border=False):
    """读原图，抠掉背景，裁到内容框；**并把高度压到 max_h**。

    为什么压：原图是 2K（1696×2528），切出来的躯干那一块能有 1000 多像素高。
    角色在屏幕上只有 ~154 逻辑单位高（dpr 2 也就 300 多像素），按原分辨率切，
    十一个人全套就是 16MB 的 PNG—— precache 进去每个玩家白下载。
    压到 512 高（约为屏幕的 1.5 倍）画质绰绰有余，体积降到 2.5MB。

    背景怎么抠：**删掉与画面边缘相连的连通域**，而不是按颜色判。
    牛魔王那张的背景是带噪点的深品红（#B72F71 一带），按颜色判会漏下一片噪点，
    噪点把「手臂与身体之间那道缝」糊住——于是手臂和身体在像素上又连成了一段，
    切线就分不开了（实测他的手臂块怎么切都带着一条躯干）。按连通域删背景与颜色无关。

    keep_border：**不删与边缘相连的连通域**（只删飞点）。
    尾巴、翅膀这类附属件常常紧贴画幅边缘——按默认规则它们被当成背景整个删掉
    （雷震子的翅膀就是这么没的）。附属件那一块要走这条。
    """
    from scipy import ndimage
    im = Image.open(path).convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and is_magenta(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    alpha = np.array(im.getchannel('A'))
    # 内容框**仍按抠掉品红之后的 alpha 算**（规格表里的百分比是相对这个框量的，
    # 换了框整套百分比就错位了）。去噪点只改 alpha，不动框。
    solid = alpha > 8
    ys, xs = np.where(solid)
    if len(ys):
        bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    else:
        bb = (0, 0, W, H)
    # 去噪点：与画面边缘相连的是背景；零星的小块是背景的飞点。两者都删。
    # keep_border：附属件（尾巴/翅膀）常常紧贴画幅边缘，按这条会被整个当成背景删掉，
    # 所以那一条只给主体走。
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    if n:
        border = set(lab[0, :].tolist()) | set(lab[-1, :].tolist()) | \
            set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
        border.discard(0)
        keep = np.ones_like(lab, dtype=bool)
        if not keep_border:
            for b in border:
                keep &= lab != b
        sizes = np.bincount(lab.ravel())
        for lbl in range(1, n + 1):
            if lbl not in border and sizes[lbl] < 60:   # 飞点
                keep &= lab != lbl
        alpha = np.where(keep, alpha, 0)
        im.putalpha(Image.fromarray(alpha))
    im = im.crop(bb)
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


def is_split(row, W, gap_frac=0.03, gap_max=0.06):
    """这一行算不算"两条腿分开了"：要有两段够宽的、且**中间那道缝够宽又不太宽**。

    为什么还要看缝：脚趾之间的缝只有一两个像素，按"段数≥2"判，脚底就成立，
    衣摆下沿会被量到脚趾尖上（实测 99.6%，差了一整条腿）。
    为什么还要看缝的上限：刑天那样魁梧的角色，**手臂与身体之间**也有一道缝，
    按"有缝就算分叉"会量到 32% 处（那不是腿根，是腋下）。腿之间的缝窄，
    手臂与身体之间的缝宽——给个上限就分得开了。
    """
    rs = substantial_runs(row, W, 0.02)
    if len(rs) < 2:
        return False
    gaps = [rs[i + 1][0] - rs[i][1] for i in range(len(rs) - 1)]
    g = max(gaps)
    return W * 0.004 <= g <= W * gap_max


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
        # 自动量是**校正**，规格表是**基准**：两者差太多就以规格表为准。
        # 自动量在几种画上不成立——脚背相碰（两条腿并成一段）、手臂与身体之间
        # 也有一道缝（量到腋下而不是腿根），实测能差出 20% 身位。
        #
        # 阈值收到 4%：自动量**随分辨率变**——背景噪点的连通性在缩放后不一样，
        # 量到的行会差好几行（牛魔王在 700 高时量到 65%，512 高时量到 73%，
        # 差 7.8% 正好落在旧的 8% 阈值里，把规格表手调的 81% 覆盖了，
        # 于是躯干短了一截、腿与靴子之间裂开一道白缝）。
        # 阈值放宽等于让噪点决定切线——这正是这一条要防的。
        if abs(hem_pct - spec['hip']) > 4 or not (25 < hem_pct < 93):
            print(f'  （衣摆自动量得 {hem_pct:.1f}%，与规格表的 {spec["hip"]:.0f}% 差太远，用规格表的）')
        else:
            spec['hip'] = hem_pct
        # 踝同理：规格表里的值是基准，自动量只在差得不多时校正
        spec_ankle = spec['ankle']
        spec['ankle'] = detect_ankle(alpha, W, H, int(spec['hip'] / 100 * H)) / H * 100
        if abs(spec['ankle'] - spec_ankle) > 4:
            spec['ankle'] = spec_ankle
        # 膝盖取腿中点（画里腿几乎是直的，中点就是膝盖）
        spec['knee'] = (spec['hip'] + spec['ankle']) / 2
        # 脚那一块的横向：踝两侧各留一点
        leg0, leg1 = spec['leg']
        spec['foot'] = [max(0, leg0 - 3), min(100, leg1 + 3)]
        print(f'  衣摆 {spec["hip"]:.1f}%  膝 {spec["knee"]:.1f}%  踝 {spec["ankle"]:.1f}%')

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
                # 找不到躯干段的行**整行跳过**（那是头部/角/装饰的行）。
                # 早先退化到"取最左边那一段"，于是牛魔王那两根角被当成了手臂，
                # 手臂块只剩一条角（2.9 单位宽），后臂挂上去就是一条悬着的板子。
                if body_i is not None and body_i > 0:
                    cand = rs[body_i - 1]
                    if (cand[1] - cand[0]) <= W * 0.35:
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
    # 上臂那一块从**肩顶**开始（比肩关节高 3%）：三角肌是肩头，缺了它，肩上就是一道
    # 平口。渲染层会把多出来的这一截往上伸（见 renderer 的 drawDollLimbs），
    # 所以块的自然长度比骨段长，骨段长度仍按解剖量（肩关节→肘）。
    arm_segs[0] = ('armFU', spec['shoulder'] - 3, spec['elbow'], arm_segs[0][3])
    # 关节重叠：每一段在**下一个关节往下**多留一截。
    #
    # 为什么需要：画里胳膊是直的，姿势里肘要弯 29°，两块各自绕自己的骨转，
    # 接缝处就裂开一道楔形的空（画面上是一块背景色的三角，牛魔王那条最明显）。
    # 多留的这一截在渲染时与骨段**同步变长**（画出来的高度 = 贴图自然高度），
    # 所以贴图不会被抻；后画的那一段会盖住重叠部分，露出来的正好是那道楔形的空。
    # 重叠量取肢体宽度的四分之一——楔形的深度 ≈ 半宽 × sin(弯角)。
    arm_w_px = X(spec.get('armFU', spec['arm'])[1]) - X(spec.get('armFU', spec['arm'])[0])
    arm_ov = 0.25 * arm_w_px / H * 100          # 占画幅高的百分比
    leg_w_px = X(spec['leg'][1]) - X(spec['leg'][0])
    leg_ov = 0.25 * leg_w_px / H * 100
    arm_mask = None
    arm_mode = spec.get('armMask', False)
    if arm_mode:
        # 只有"手臂压在别的东西上"的角色才抠（猪八戒的胳膊贴着肚子、牛魔王的贴着甲、
        # 雷震子的压着翅膀、哪吒的压着混天绫）。按描边分对深肤色角色失效，
        # 按颜色分才分得开——胳膊的肤色与袍子不同。
        elbow_y = int(Y(spec['elbow']))
        seed = None
        rs = substantial_runs(alpha[elbow_y], W, 0.02)
        body_i = None
        for i, (a, b) in enumerate(rs):
            if a <= axis_px <= b:
                body_i = i
                break
        if body_i is not None and body_i > 0:
            a, b = rs[body_i - 1]
            seed = ((a + b) // 2, elbow_y)
        elif rs:
            a, b = rs[0]
            seed = ((a + b) // 2, elbow_y)
        if seed is None:
            seed = (X((spec['arm'][0] + spec['arm'][1]) / 2), elbow_y)
        arm_mask = flood_mask(im, seed)
        if arm_mask is not None:
            from scipy import ndimage
            # 描边不在"同色"里，胀 2 像素把它捞回来（不然手臂外缘没有黑边，看着发白）
            arm_mask = ndimage.binary_dilation(arm_mask, np.ones((5, 5), bool), iterations=2)
            xs = np.where(arm_mask.any(axis=0))[0]
            if len(xs):
                ax0 = max(0, xs.min() - 1) / W * 100
                ax1 = min(W, xs.max() + 2) / W * 100
                arm_segs = [(n, y0, y1, [ax0, ax1]) for n, y0, y1, _ in arm_segs]
    pieces = {}
    # 每一段在下一个关节往下多留 arm_ov（关节重叠，见上面的说明）
    arm_ends = {'armFU': spec['elbow'] + arm_ov, 'armFL': spec['wrist'] + arm_ov}
    for name, y0, y1, xr in arm_segs:
        # 横向范围仍按**原来那一段**量（重叠那截在关节之下，不参与测量）
        if not spec.get('armOverride'):
            xr = arm_x_range(y0, y1, xr)
        by1 = min(H, int(round(H * arm_ends.get(name, y1) / 100)))
        # 裁切框与掩码切片必须用同一组整数，否则差一像素（掩码对不上，apply_mask 直接抛）
        bx0 = max(0, int(round(W * xr[0] / 100)))
        by0 = max(0, int(round(H * y0 / 100)))
        bx1 = min(W, int(round(W * xr[1] / 100)))
        piece = im.crop((bx0, by0, max(bx0 + 1, bx1), max(by0 + 1, by1)))
        if arm_mask is not None:
            piece = apply_mask(piece, arm_mask[by0:by1, bx0:bx1])
        pieces[name] = piece

    # ---- 远侧手臂（画面右那条）：单独切一套 ---------------------------------
    # 为什么单独切：正面站着的角色画里**两条胳膊都画全了**（牛魔王、二郎、红孩儿、
    # 雷震子、刑天），远臂有完整的肘、腕、手。它不能烤进躯干——躯干切线一刀下去，
    # 远臂就只剩一条竖边（牛魔王那张右侧就是这么变成一块悬着的板子的）；
    # 也不能拿近臂的图顶替——那是另一条胳膊，画里形状不一样（远臂是斜着垂下的）。
    #
    # 远臂画在躯干**后面**，所以切件里带进来的躯干像素会被躯干盖住，看不见；
    # 切宽一点不要紧，切窄了远臂就会被切掉一块。
    #
    # 横向范围逐段写在规格表里（armB：三段的 [x0,x1]）——远臂是斜着垂下的，
    # 三段的横向范围不一样：上臂那段的三角肌还压在躯干边上（前臂那段已经分开了）。
    # 一段范围套三段也行（远臂几乎是竖的），但那三个人就切不出手来。
    if 'armB' in spec:
        bands = spec['armB']
        if len(bands) == 2 and all(isinstance(v, (int, float)) for v in bands):
            bands = [bands, bands, bands]

        def band_x(i):
            return bands[i] if i < len(bands) else bands[-1]

        bsegs = [('armBU', spec['shoulder'] - 3, spec['elbow'] + arm_ov, band_x(0)),
                 ('armBL', spec['elbow'], spec['wrist'] + arm_ov, band_x(1)),
                 ('handB', spec['wrist'], spec['handEnd'], band_x(2))]
        for name, y0, y1, xr in bsegs:
            pieces[name] = crop_pct(im, xr[0], y0, xr[1], y1)

    # ---- 身后的附属件（尾巴 / 翅膀）------------------------------------------
    # 悟空的尾巴、雷震子的翅膀在画里是**独立的一块**（与身体、手臂之间有一道背景缝），
    # 所以能单独切出来，画在躯干后面。spec 里写 deco: [部件名, [x0,y0,x1,y1]]。
    deco_geo = None
    if 'deco' in spec:
        dname, dbox = spec['deco'][0], spec['deco'][1]
        dx0, dy0, dx1, dy1 = dbox
        # 附属件常常紧贴画幅边缘（尾巴在左下、翅膀在左上），按主体那套清理规则
        # 会被当成背景整个删掉 —— 这一块单独走「保留贴边件」那张图。
        # 两次清理的**内容框与缩放完全一致**（内容框在删连通域之前算好），所以坐标通用。
        dimg = load_clean(src, keep_border=True)
        if 'box' in spec:
            b = spec['box']
            dimg = crop_pct(dimg, b[0], b[1], b[2], b[3])
        piece = crop_pct(dimg, dx0, dy0, dx1, dy1)
        pieces[dname] = piece
        dbox_t = trim_box(piece)
        dcx = X(dx0) + (dbox_t[0] + dbox_t[2]) / 2
        dtop = Y(dy0) + dbox_t[1]
        deco_geo = (dname, dcx, dtop)

    # ---- 头 / 躯干 / 腿 / 脚 ------------------------------------------------
    pieces['head'] = crop_pct(im, spec['head'][0], spec['head'][1], spec['head'][2], spec['head'][3])
    # 头件的底带：有些角色（牛魔王）**肩膀长到耳朵边上**，头件切矩形会带进一块肩甲，
    # 画出来就是脖子左边挂着一块方板。规格表里写 headKeep（那一带保留的横向范围）与
    # headKeepFrom（从哪一行往下开始裁），把肩膀切掉；没写就整块保留。
    if 'headKeep' in spec:
        hx0, hx1 = spec['headKeep']
        hw = pieces['head'].size[0]
        hh = pieces['head'].size[1]
        span = spec['head'][2] - spec['head'][0]
        kx0 = int(round(hw * (hx0 - spec['head'][0]) / span))
        kx1 = int(round(hw * (hx1 - spec['head'][0]) / span))
        ky = int(round(hh * (spec.get('headKeepFrom', spec['chin']) - spec['head'][1])
                       / (spec['head'][3] - spec['head'][1])))
        arr = np.array(pieces['head'].getchannel('A'))
        arr[max(0, ky):, :max(0, kx0)] = 0
        arr[max(0, ky):, min(arr.shape[1], kx1):] = 0
        pieces['head'].putalpha(Image.fromarray(arr))
    pieces['torso'] = crop_pct(im, spec['torso'][0], spec['chin'], spec['torso'][1], spec['hip'])
    # 腿同样留关节重叠：膝盖弯起来时两块之间也会裂开一道缝（姿势里膝弯 40°）。
    # 脚那一块不往上留——脚的贴图是**以踝为锚**画的（见 renderer 的 drawDollFoot），
    # 往上留会让整只脚沉到地里去；踝那里本来几乎不弯（差 8°），缝本来就看不见。
    pieces['legFU'] = crop_pct(im, spec['leg'][0], spec['hip'], spec['leg'][1], spec['knee'] + leg_ov)
    pieces['legFL'] = crop_pct(im, spec['leg'][0], spec['knee'], spec['leg'][1], spec['ankle'] + leg_ov)
    pieces['footF'] = crop_pct(im, spec['foot'][0], spec['ankle'], spec['foot'][1], 100)

    # ---- 存盘 + 量尺寸 -----------------------------------------------------
    k = FIG_H / H          # 画里 1 像素 = 多少逻辑单位
    rig = {'k': k, 'srcH': H, 'srcW': W}
    # 这个角色有没有单独切出来的远臂（画里两条胳膊都画全了的那些）。
    # 渲染层据此决定要不要多探三个远臂件——不探就是必然 404。
    if 'armB' in spec:
        rig['backArm'] = True
    # 身后的附属件（尾巴/翅膀）：位置等 k 与中轴定了再算
    if deco_geo:
        dname, dcx, dtop = deco_geo
        rig['deco'] = {
            'part': dname,
            'dx': (dcx - axis_px) * k,
            'y': (H - dtop) * k,      # 离地（逻辑单位）
        }
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
    #
    # **在踝行量，不在膝行量**：袍子人物画里膝盖以下还是一整片袍子，膝行根本分不出
    # 两条腿。实测牛魔王在膝行量到的第二段是**近侧手臂的手指**（袍子把腿整个挡住了），
    # 后腿因此偏了 26.9 单位，实际只该偏 12；铁扇公主膝行只有一段，两条腿的偏移双双
    # 成了 0（画里两条腿明明岔着）。踝行往下是腿最细的地方，袍子已经让开了。
    def leg_centers(pct):
        y = min(H - 1, max(0, int(Y(pct))))
        return [(a + b) / 2 for a, b in substantial_runs(alpha[y], W, 0.02)]

    leg_x = leg_centers(spec['ankle'])
    if len(leg_x) != 2:
        leg_x = leg_centers(spec['knee'])    # 兜底：还是按膝行量（老做法）
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
    # 后肩：挂在**躯干右缘往里半个臂宽**的地方。
    #
    # 为什么：后臂是**藏在身体后面**的，它的挂点要让后臂大半个身子被躯干盖住
    # （旧管线那条程序化后臂就是这么藏的）。直接用后臂的外缘当挂点，后臂整个挂到
    # 身体外面去——画面上就是一条悬在体侧的手臂板子（牛魔王那张最明显）。
    # 半个臂宽从**躯干裁切框的右缘**往里退：那条缘就是后臂的内缘（躯干裁到那儿为止）。
    #
    # 但画里**远臂单独画出来**的角色（spec 里有 armB）不走这条：它的远臂有自己的一整套
    # 切件，挂点必须落在画里那一块上，否则远臂会整条错位。
    # 挂点取**远臂件的内容中心**，不是三角肌的中心：远臂在画里是斜着垂下的
    # （肩靠里、腕靠外），三角肌在切件的左上角，拿它当支点会把整条胳膊平移出去。
    # 取内容中心的好处是**切件会原样落回画里的位置**（渲染层把这一块以它为中心画）。
    if 'armB' in spec:
        if 'backShoulder' in spec:
            back_px = X(spec['backShoulder'])
        else:
            btb = trim_box(pieces['armBU'])
            back_px = X(spec['armB'][0][0] if isinstance(spec['armB'][0], (list, tuple))
                         else spec['armB'][0]) + (btb[0] + btb[2]) / 2
    else:
        arm_half = rig['armFU']['w'] / 2
        back_px = X(spec['torso'][1]) - arm_half
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

    # 骨段长度：上臂按**解剖**量（肩关节→肘）——那一块多出来的一截是三角肌，
    # 渲染层会把它往上伸（不是骨段变长）。其余各段按解剖量（关节→关节），
    # **不按切件的自然高**：切件在关节处多留了重叠的一截（见 arm_ov/leg_ov），
    # 自然高比解剖量大一块，拿它当骨长，胳膊就凭空长了一截。
    rig['upperArm'] = (spec['elbow'] - spec['shoulder']) / 100 * H * k
    rig['lowerArm'] = (spec['wrist'] - spec['elbow']) / 100 * H * k
    rig['handLen'] = (spec['handEnd'] - spec['wrist']) / 100 * H * k
    rig['thigh'] = (spec['knee'] - spec['hip']) / 100 * H * k
    rig['shin'] = (spec['ankle'] - spec['knee']) / 100 * H * k
    rig['torsoLen'] = rig['chinY'] - rig['hipY']
    # 关节重叠量（逻辑单位）：渲染层把每一段画得比骨段长这么多，
    # 贴图自然高度不变（1:1 仍成立），多出来的正好补住弯关节裂开的那道缝。
    rig['armOv'] = arm_ov / 100 * H * k
    rig['legOv'] = leg_ov / 100 * H * k

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
    # 有远臂的角色把远臂那三块也摆上——不然拼版图上看不出远臂切成了什么样
    order += [n for n in ('armBU', 'armBL', 'handB') if n in pieces]
    W2 = 940
    rowh = 300
    sheet = Image.new('RGB', (W2, rowh * ((len(order) + 3) // 4) + 40), (240, 236, 226))
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
        print(f'{cid}: 切完 {len(pieces)} 块 → {os.path.relpath(outdir, ROOT)}')
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
