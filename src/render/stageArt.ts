/**
 * 关卡远景美术：把"画出来的远景"挂进舞台，逐层独立、缺层回退。
 *
 * 规则与角色部件（parts.ts）一模一样，一条都不多：
 *  · 路径固定：`public/stages/<关卡id>/{far,mid,near}.webp`；
 *  · **逐层独立**：某层有图就用那层，没有就回退到程序化画的那层，绝不半吊子拼接；
 *  · 目录整个不存在时，效果等同完全没有美术，程序化画法一像素不变。
 *
 * 为什么是 webp 不是 png：十二关的远景是要进离线包的（游戏承诺离线可玩），
 * png 存这种大色块图每张 300~500KB，webp 同一张 40~90KB。
 *
 * 运行时拼出来的路径必须走 import.meta.env.BASE_URL——vite 只改写 index.html 里的引用，
 * 运行时拼的字符串它一概不管（见 vite.config.ts 的注释）。路径错了 404 是**静默兜底**：
 * 没有报错，只是那一层永远画不出来。
 */

/** 一关的三个图层。null = 这一层没有美术，用程序化画法 */
export interface StageArt {
  far: HTMLImageElement | null;
  mid: HTMLImageElement | null;
  near: HTMLImageElement | null;
}

const SLOTS = ['far', 'mid', 'near'] as const;
export type StageSlot = typeof SLOTS[number];

const cache = new Map<string, StageArt>();

/** 已探测完成的状态。每层两种：pending（加载中）与 ok/miss（已定）。 */
type SlotState = 'pending' | 'ok' | 'miss';
const slotState = new Map<string, SlotState>();

function urlFor(stageId: string, slot: StageSlot): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}stages/${stageId}/${slot}.webp`;
}

/**
 * 取一关的美术。没探过就发起探测（fire-and-forget，不阻塞任何一帧）。
 * 探测没回来之前那一层是 null —— 于是程序化画法先顶上，图到了自然就换上去。
 */
export function getStageArt(stageId: string): StageArt {
  const hit = cache.get(stageId);
  if (hit) return hit;
  const art: StageArt = { far: null, mid: null, near: null };
  cache.set(stageId, art);
  // 非浏览器环境（vitest 默认 node）没有 Image —— 那一层没有美术可挂，
  // 程序化画法顶上，跟"目录整个不存在"是同一种结果
  if (typeof Image === 'undefined') return art;
  for (const slot of SLOTS) {
    const key = `${stageId}/${slot}`;
    if (slotState.get(key) === 'pending') continue;
    slotState.set(key, 'pending');
    const img = new Image();
    img.onload = () => {
      slotState.set(key, 'ok');
      art[slot] = img;
    };
    img.onerror = () => { slotState.set(key, 'miss'); };
    img.src = urlFor(stageId, slot);
  }
  return art;
}

/**
 * 画一层远景（**背板**形态）。
 *
 * 横向视差用"轻微放大 + 平移"实现，而不是平铺：平铺会在接缝处露馅（AI 画的图接不上下一个），
 * 而放大一点点（视差位移的两倍除以图宽，通常 2~4%）看不出来，却能保证任何镜头位置都不露边。
 */
export function drawStageLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  camX: number, parallax: number,
  visW: number, visH: number, offX: number, offY: number,
  horizonY: number,
): void {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const dw = visW + offX * 2;                 // 铺满可见宽度
  const dh = dw * (ih / iw);
  const shift = camX * parallax;
  const grow = 1 + (Math.abs(shift) * 2) / dw; // 放大一点点，保证平移后不露边
  const w = dw * grow;
  const h = dh * grow;
  const x = -offX - (w - dw) / 2 + shift;
  const y = horizonY - (h - dh) * 0;          // 顶边钉在 horizonY
  ctx.drawImage(img, x, y, w, h);
}

/**
 * 整幅背板：画铺满**整个可见视口**。
 *
 * 上一版把画裁成"地平线以下的一条带"塞进画面中段，十二关实测下来全是三条横带
 * （渐变天 / 一条外来画带 / 黑山带）——画与舞台各说各话。现在画是**唯一的背景**：
 * 它自己的天空、自己的远山、自己的地面都在里面，星辰与月亮画在它上面，
 * 角色站在它自己的地面上。舞台自己的渐变天、云纹、山形剪影在有画时全部退场。
 *
 * **为什么必须盖满整个视口，而不是盖到地面线为止**：地面线在**世界坐标**里，
 * 而镜头缩放（放大招时 1.25~1.45）会把它推到屏幕更下面去。背景只画到固定的
 * 地面线，两者之间就露出一条**谁都没画的缝**——上一帧的像素留在那里，
 * 于是画面上出现一条横贯全屏的彩色乱码带，镜头一动它就闪。
 * 背景层每帧必须把整块画布盖死（sky.ts 那条注释讲的正是这件事）。
 *
 * 缩放**只跟视口走，不跟镜头走**：每帧按 camX 改一点点缩放，图会被反复重采样，
 * 山脊线、牌坊雕花那些细边缘会跟着一起抖——那是"背景一直在闪"的另一半来源。
 * 平移则要**对齐到整数像素**：缩放固定后，重采样的相位也就固定了，画面不再抖。
 */
export function drawStageMatte(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  camX: number, parallax: number,
  visW: number, visH: number, offX: number, offY: number,
): void {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const coverW = visW + offX * 2;               // 可见宽度
  const coverH = visH + offY * 2;               // 可见高度
  // 覆盖所需的缩放（cover），再留 3% 余量给视差平移用
  const scale = Math.max(coverW / iw, coverH / ih) * 1.03;
  const w = iw * scale, h = ih * scale;
  const shift = camX * parallax;
  // 对齐到整数逻辑像素：缩放固定 + 相位固定 = 重采样结果每帧一致，不闪
  const x = Math.round(-offX - (w - coverW) / 2 + shift);
  const y = (-offY + visH) - h;                // 底边钉在可见区底边之下，永远盖得住
  ctx.drawImage(img, x, y, w, h);
}
