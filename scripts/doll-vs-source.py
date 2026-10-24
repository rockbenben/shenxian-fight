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

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design-preview', 'out', 'doll-vs-source')

ORDER = ['nezha', 'wukong', 'erlang', 'niumo', 'honghaier', 'tieshan',
         'baigu', 'houyi', 'leizhen', 'zhongkui', 'xingtian', 'bajie']
CELL_W, CELL_H = 480, 536      # 截图里的格子（dpr 2 → 240x268 逻辑）
DPR = 2
FIG_H = 154.0                  # 整高（逻辑单位）


def is_magenta(r, g, b):
    return r > 110 and b > 110 and g < min(r, b) * 0.72


def load_clean(path):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and is_magenta(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    bb = im.getbbox()
    return im.crop(bb) if bb else im


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
        print(f'{cid}: 原画 {AW}x{AH} 叠上去了（横移 {off_x} 纵移 {off_y}）')


if __name__ == '__main__':
    main()
