import { useEffect, useRef } from 'react';
import { FLOOR_Y, LOGIC_H, LOGIC_W } from '../engine/types';
import { drawBg } from '../render/renderer';
import type { StageBg } from '../data/stages';

const STEP = 1000 / 60;
/** 云与山影的横向漂移速度（逻辑单位/逻辑帧）。drawBg 内部各层按 0.15/0.3/0.6 的系数
 * 分别取这个值，所以最慢的云每秒只走约 2.7px——是"过一会儿才发觉在动"的量，不抢文字。 */
const DRIFT = 0.3;

/** 菜单专用夜景：不复用任何一关的配色，免得标题页看起来像停在第一关的场景里。
 * 比四关都更深、更蓝，让宣纸色的标题与朱砂印浮得起来。 */
const MENU_BG: StageBg = {
  sky: ['#0a1526', '#2b5876'],
  ground: '#0b1420',
  silhouette: '#061019',
  seed: 7,
  celestial: 'moon',
  celestialColor: '#EDE3D2',
};

/** 标题/操作/选人/结算四页共用的动态背景（挂载条件是 scene.s !== 'fight'）。
 *
 * 之前这三页是一块纯色板：游戏自己有四层视差（星月、如意云纹、远近山影），却在玩家看到的
 * 第一屏完全没用上。这里直接复用 renderer 的 drawBg——同一套画法，菜单与对局因此是同一个
 * 世界，而不是"一个好看的游戏 + 一个空壳菜单"。
 *
 * 计时：漂移量走固定 1/60s 逻辑步进（累加器），draw 只读状态。本项目在"按渲染帧推进本该
 * 按逻辑帧走的量"上栽过四次（大招暗场、血条残影、BannerSystem、火焰纹），120Hz 手机上
 * 会快一倍。prefers-reduced-motion 时直接不推进，画面静止。 */
export function MenuBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const viewport = { w: LOGIC_W, h: LOGIC_H };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = window.innerWidth, vh = window.innerHeight;
      // 背景是装饰层，没有"玩法安全区"要守——这里取 max 铺满，宁可裁掉一点也不留空边
      const scale = Math.max(vw / LOGIC_W, vh / LOGIC_H);
      canvas.width = vw * dpr;
      canvas.height = vh * dpr;
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      viewport.w = vw / scale;
      viewport.h = vh / scale;
      const offX = (viewport.w - LOGIC_W) / 2, offY = (viewport.h - LOGIC_H) / 2;
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * scale * dpr, offY * scale * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, acc = 0, camX = LOGIC_W / 2, last = performance.now();
    const frame = () => {
      const now = performance.now();
      acc += Math.min(now - last, 100); // 切回标签页时不补一串追帧
      last = now;
      while (acc >= STEP) { if (!still.matches) camX += DRIFT; acc -= STEP; }
      drawBg(ctx, MENU_BG, camX, viewport.w, viewport.h);
      // drawBg 只画到天空+云+山影：天空渐变的终点在 FLOOR_Y，再往下渐变会钳到末端色，
      // 于是地平线以下出现一条比山影还亮的横带（对局里那块是被地面盖住的，这里没有地面）。
      // 补一层地面色把它盖掉，接缝处压一道更深的线当地平线。
      const offY = (viewport.h - LOGIC_H) / 2, offX = (viewport.w - LOGIC_W) / 2;
      ctx.fillStyle = MENU_BG.ground;
      ctx.fillRect(-offX, FLOOR_Y, viewport.w, viewport.h - FLOOR_Y - offY + 2);
      ctx.fillStyle = 'rgba(6,16,25,.85)';
      ctx.fillRect(-offX, FLOOR_Y, viewport.w, 2);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return (
    <>
      <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
{/* 压暗罩。原来是一圈径向暗角，但月亮画在固定的 (800,86)——正是暗角最重的右上角，
          任何角落加重的罩子都会把它压成一坨灰。改成纵向：顶部只压 10%（月亮保持宣纸色的亮），
          底部压到 45% 把地面坐实，中段完全放空留给文字。夜空本来就暗，文字是宣纸色，
          中段不压也够读——之前那圈重罩解决的是一个并不存在的问题。 */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none',
        background: 'linear-gradient(180deg, rgba(7,13,24,.10) 0%, rgba(7,13,24,0) 28%, rgba(7,13,24,0) 60%, rgba(7,13,24,.45) 100%)',
      }} />
    </>
  );
}
