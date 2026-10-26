"""把纸偶件的拼装结果叠回原画，逐人核对**位置**对不对。

为什么要有：切件本身对不对是切线的事（check-cuts.py 管那个）；**挂上去对不对**
是挂载的事——每块挂在骨架的哪个点、骨架的关节在不在画里那个关节上。
这两件事长得不一样：切对了，挂错了，画面上照样歪。

做法：原画按 rig 的比例缩到与纸偶同一大小（整高 154 逻辑单位），
再按**身体中轴**与**脚底**对齐，叠到纸偶的截图上。
原画走一层半透明：对齐了就是两条轮廓重合，歪了就是能一眼看出偏哪边、偏多少。

用法：python design-preview/tools/doll-vs-source.py [角色id...]
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design-preview', 'out', 'doll-vs-source')

ORDER = ['nezha', 'wukong', 'erlang', 'niumo', 'honghaier', 'tieshan',
         'baigu', 'houyi', 'leizhen', 'zhongkui', 'xingtian', 'bajie']
CELL_W, CELL_H = 480, 536      # 截图里的格子（dpr 2 → 240x268 逻辑）
DPR = 2
FIG_H = 154.0                  # 整高（逻辑单位）

# 原画的清理**必须与切件脚本同一份**：rig 里的 axisX 是切件脚本那份坐标系的像素值，
# 两份清理不一致（这里原来自己写了一份，不删与画幅边缘相连的连通域），
# 内容框就不同 → 中轴对不上 → 叠图整体横移，看着像「纸偶挂歪了」。
# 这个工具是对齐检查器：它自己歪了，就等于没有。
import importlib.util as _ilu
_cs = _ilu.spec_from_file_location('cf', os.path.join(ROOT, 'scripts', 'cut-fullbody.py'))
_cf = _ilu.module_from_spec(_cs); _cs.loader.exec_module(_cf)
load_clean = _cf.load_clean


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith('-')] or ORDER
    shot = Image.open(os.path.join(ROOT, 'design-preview', 'out', 'doll-ab', 'doll-idle.png')).convert('RGB')
    os.makedirs(OUT, exist_ok=True)
    for cid in ids:
        if cid not in ORDER:
            continue
        src_path = os.path.join(ROOT, '_raw', f'{cid}_full.png')
        rig_path = os.path.join(ROOT, 'design-preview', 'out', 'cut', f'{cid}-rig.json')
        if not os.path.exists(src_path) or not os.path.exists(rig_path):
            continue
        rig = json.load(open(rig_path, encoding='utf-8'))
        art = load_clean(src_path)
        AW, AH = art.size
        # 原画缩到与纸偶同一比例：整高 FIG_H 逻辑单位 = FIG_H*DPR 屏幕像素
        k = FIG_H / AH                      # 逻辑单位 / 原画像素
        scale = (FIG_H * DPR) / AH
        art = art.resize((max(1, int(AW * scale)), max(1, int(AH * scale))), Image.LANCZOS)
        AW, AH = art.size
        # 原画里的身体中轴（rig 量出来的）
        axis_src_x = rig['axisX'] * scale
        # 截图格子里：角色的 x = 格子的中心，脚底 = 格子底部 - 34 逻辑（×DPR）
        i = ORDER.index(cid)
        cx, cy = i % 6, i // 6
        cell = shot.crop((cx * CELL_W, cy * CELL_H, (cx + 1) * CELL_W, (cy + 1) * CELL_H))
        char_x = CELL_W / 2
        feet_y = CELL_H - 34 * DPR
        # 原画脚底对齐截图脚底，中轴对齐角色中轴
        off_x = int(char_x - axis_src_x)
        off_y = int(feet_y - AH)
        bg = Image.new('RGB', cell.size, (247, 243, 234))
        art_rgb = Image.new('RGB', art.size, (247, 243, 234))
        art_rgb.paste(art, (0, 0), art)
        # 半透明：看得见原画的轮廓
        art_rgb = art_rgb.point(lambda v: int(v * 0.45 + 247 * 0.55))
        bg.paste(art_rgb, (off_x, off_y))
        bg = Image.blend(cell, bg, 0.62)
        bg.save(os.path.join(OUT, f'{cid}.png'))

        # ---- 逐像素差分：原画里有、纸偶上却没有的像素 = **丢了的身体** ---------
        # 这一条比眼睛可靠：躯干右缘那一块（身体与远臂之间、裙摆的右边）
        # 若切漏了，原画那一块有像素而纸偶上没有——叠图上只是一条窄边，
        # 缩到拼版里根本看不出来，但像素数会把它算出来。
        src_mask = np.array(art.getchannel('A')) > 8
        cell_arr = np.array(cell.convert('RGB')).astype(int)
        # 背景色**取格子的实际角落色**：写死一个近似值会让整个背景都算进「纸偶」，
        # 差分就成了零（背景与实际色差 14，阈值 12 刚好把它算进去）。
        bg_col = cell_arr[2, 2].copy()
        doll_mask = (np.abs(cell_arr - bg_col).max(axis=2) > 18)
        # 把原画贴到格子里的同一位置
        full = np.zeros(cell_arr.shape[:2], bool)
        x0, y0 = max(0, off_x), max(0, off_y)
        w = min(art.size[0], cell_arr.shape[1] - x0)
        h = min(art.size[1], cell_arr.shape[0] - y0)
        if w > 0 and h > 0:
            full[y0:y0 + h, x0:x0 + w] = src_mask[:h, :w]
        lost = int((full & ~doll_mask).sum())
        # 换算成源图像素（叠图是放大过的）
        lost_src = lost / max(1e-6, (FIG_H * DPR) / AH) ** 2
        # 把丢掉的像素**标红**画出来：数字只说丢了多少，红点说丢在哪儿
        mark = bg.copy()
        m = np.array(mark)
        lost_mask = full & ~doll_mask
        if lost_mask.any():
            m[lost_mask] = (220, 0, 0)
            mark = Image.fromarray(m)
            mark.save(os.path.join(OUT, f'{cid}-lost.png'))
        print(f'{cid}: 原画 {AW}x{AH} 叠上去了（横移 {off_x} 纵移 {off_y}）'
              f'｜原画有而纸偶没有：{lost} 屏幕像素（约 {lost_src:.0f} 源像素）')


if __name__ == '__main__':
    main()
