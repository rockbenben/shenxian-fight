/**
 * 后期层：辉光（bloom）与暗角（vignette）。
 *
 * 为什么零依赖、零 WebGL：这个项目的画面是 Canvas 2D 的 2D 格斗，缺的是"亮的东西会发光"
 * 这一层——月亮是硬边渐变、火花是纯色圆点、命中时没有一次过曝。街机格斗的那种通透感
 * 有一大半来自这一层，而它用离屏画布 + 一次降采样 + 一次模糊就能拿到，不需要换渲染栈
 * （见 DEVELOPMENT.md：实测 844x390@2x 对局 p50/p95 都是 16.7ms，Canvas 2D 没有性能瓶颈）。
 *
 * 两道工序的顺序是有讲究的：
 *  · **辉光在 HUD 之前**：血条、招式名、计时器不该被烤亮——它们是读数，不是光源。
 *  · **暗角在最后**：它压的是整幅画面的四角，把视线收回中间，顺带盖住宽屏下画布边缘的
 *    渐变断层。
 *
 * 辉光的做法是"取亮部再叠回去"：把当前画面降到 1/4 分辨率，用一条对比度极高的滤镜把
 * 暗部压黑、亮部留住，糊开之后用 'lighter' 叠回原画。降采样不是为了省性能才那么做——
 * 它本身就是辉光的一部分（低分辨率的模糊天然是大范围的光晕），1/4 既是效果也是性能。
 *
 * 能力检测：ctx.filter 在 Safari 17.4 以下不存在。那里没有辉光，但画面照旧（整段跳过），
 * 不报错、不空转。
 */

/** 辉光缓冲：1/4 分辨率。两块——A 装缩略图，B 装阈值+模糊后的结果。 */
let bufA: HTMLCanvasElement | null = null;
let bufB: HTMLCanvasElement | null = null;
let filterSupported: boolean | null = null;

/** ctx.filter 的能力探测。
 *
 * 判据不能是「赋值不报错」——旧 Safari 接受任意 filter 字符串但根本不生效。做法是画一格
 * 不透明白、带模糊把自己重画一遍，再读中心像素：糊过之后中心就不会是满不透的了。
 */
function supportsFilter(): boolean {
  if (filterSupported !== null) return filterSupported;
  try {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const g = c.getContext('2d');
    if (!g) { filterSupported = false; return false; }
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 4, 4);
    g.filter = 'blur(2px)';
    g.drawImage(c, 0, 0);
    g.filter = 'none';
    const px = g.getImageData(2, 2, 1, 1).data;
    filterSupported = px[3] < 255;
  } catch {
    filterSupported = false;
  }
  return filterSupported;
}

function getBuffers(w: number, h: number): { a: CanvasRenderingContext2D; b: CanvasRenderingContext2D } | null {
  if (!bufA) bufA = document.createElement('canvas');
  if (!bufB) bufB = document.createElement('canvas');
  if (bufA.width !== w || bufA.height !== h) { bufA.width = w; bufA.height = h; }
  if (bufB.width !== w || bufB.height !== h) { bufB.width = w; bufB.height = h; }
  const a = bufA.getContext('2d');
  const b = bufB.getContext('2d');
  if (!a || !b) return null;
  return { a, b };
}

export interface BloomOptions {
  /** 叠回去的强度。0.3~0.6 之间比较稳：再高整个画面会糊成一片奶油。 */
  strength?: number;
  /** 阈值对比度。越大越只有最亮的东西发光。
   *
   *  调高过一次：远景画成背板之后，画面里大片中亮度的雾也会被烤成一团团光斑，
   *  满屏都是"闪光"，而真正该发光的只有月亮、火焰与招式特效。3.4 是"只有很亮的才亮"。 */
  threshold?: number;
}

/**
 * 辉光：把当前画面的亮部取出来、糊开、叠回去。
 *
 * 主画布此刻必须已经画完该亮的那些东西（场景、角色、特效），但还没画 HUD。
 * 真实画布之外（单测的替身 ctx）直接跳过——那些替身没有 canvas 对象，
 * 也没有 drawImage/filter，硬调会炸。
 */
export function applyBloom(ctx: CanvasRenderingContext2D, opts: BloomOptions = {}): void {
  const { strength = 0.42, threshold = 3.4 } = opts;
  if (strength <= 0) return;
  const cv = ctx.canvas;
  if (!cv || !cv.width || !cv.height) return;   // 替身 ctx：没有真画布，跳过
  if (!supportsFilter()) return;                // 老 Safari：没有辉光，画面照旧

  const W = cv.width, H = cv.height;
  const w = Math.max(1, Math.round(W / 4));
  const h = Math.max(1, Math.round(H / 4));
  const bufs = getBuffers(w, h);
  if (!bufs) return;
  const { a, b } = bufs;

  // A：当前画面缩到 1/4
  a.globalCompositeOperation = 'copy';
  a.filter = 'none';
  a.drawImage(cv, 0, 0, w, h);
  a.globalCompositeOperation = 'source-over';

  // B：阈值（对比度把暗部压黑）+ 模糊（糊成光晕）
  // blur 的半径按缓冲尺寸给：1/4 分辨率下 1.5px 等于原画面的 6px，糊得开又不糊成雾
  b.globalCompositeOperation = 'copy';
  b.filter = `brightness(1.06) contrast(${threshold}) saturate(1.12) blur(${Math.max(1, w / 110).toFixed(2)}px)`;
  b.drawImage(bufA!, 0, 0);
  b.filter = 'none';
  b.globalCompositeOperation = 'source-over';

  // 叠回主画布。setTransform(1,0,0,1,0,0) 是必要的：主画布上挂着
  // 「逻辑单位 → 设备像素」的变换，不清掉的话辉光会被缩到屏幕中间一小块
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;
  ctx.drawImage(bufB!, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/**
 * 暗角：四角压暗，把视线收回中间。
 *
 * 用径向渐变而不是一张暗图叠加——径向渐变中间完全透明，只有边缘才压，所以不牺牲
 * 画面中段的对比度（那里是角色和 HUD 所在）。
 *
 * 坐标是**逻辑单位**（跟舞台同一个坐标系），画的是当前可见视口那一块：
 * 可见区从 -offX 铺到 -offX + visW，offX 是可见视口比安全区宽出来的那一半。
 */
export function applyVignette(
  ctx: CanvasRenderingContext2D,
  offX: number, offY: number, visW: number, visH: number,
  strength = 0.42,
): void {
  if (strength <= 0) return;
  const cx = -offX + visW / 2;
  const cy = -offY + visH / 2;
  const r = Math.max(visW, visH) * 0.78;
  const g = ctx.createRadialGradient(cx, cy, r * 0.52, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.72, `rgba(0,0,0,${strength * 0.28})`);
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(-offX, -offY, visW, visH);
}
