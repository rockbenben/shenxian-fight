import { DESPERATE_HP, FLOOR_Y, LOGIC_H, LOGIC_W } from '../engine/types';
import type { Battle } from '../engine/battle';
import type { CharacterDef, CharacterRig, Fighter, Move, WeaponDef } from '../engine/types';
import { worldBox } from '../engine/collision';
import { drawAdornments, drawDecals, drawFlung, drawWings, isDisarmed } from './adornments';
import { skeletalSource, type PoseSource, type SkelDoc } from './poseSource';
import { Camera } from './camera';
import { FxSystem, hexAlpha } from './fx';
import { drawCrown } from './cutin';
import { BannerSystem } from './banner';
import { MandorlaSystem } from './mandorla';
import { CutInSystem } from './cutin';
import { drawHitCounter } from './hitCounter';
import { MOTIONS } from '../data/motions';
import { samplePose, lerpPose } from './motion';
import type { Pose } from './motion';
import { DEFAULT_BG, type StageBg } from '../data/stages';
import { loadParts, type DollParts, type PartImage, type PartImages } from './parts';
import { applyBloom, applyVignette } from './post';
import { drawStageMatte, getStageArt } from './stageArt';
import { INK } from './palette';

// 部件图缓存：'pending' = 加载中（防止 60fps 重复发起探测请求），PartImages = 已探测完成
// （逐件独立结果，可能任意子集为空，包括全空）。两态缺一不可——不区分 in-flight/resolved
// 会导致反复发起探测请求。"还没问过"用 Map 里没有这个 key 表示，不需要第三个显式状态。
type PartsCacheEntry = PartImages | 'pending';
const partsCache = new Map<string, PartsCacheEntry>();

/** fire-and-forget：不阻塞任何一帧，画面永远读缓存里已有的东西 */
/** 部件加载完成时的回调。选人页立绘**只画一次**（挂载那一刻），
 * 而部件是 fire-and-forget 异步探测的——立绘画完时素材往往还没到，
 * getParts 返回 null，于是画成火柴人，之后再也不重画。
 * 对局没这问题（每帧重画，素材一到自然就用上了），所以这个坑只在立绘上显形。
 * 让加载完成时能通知一声，立绘补画一次即可。 */
const partsWaiters = new Set<() => void>();
export function onPartsLoaded(fn: () => void): () => void {
  partsWaiters.add(fn);
  return () => partsWaiters.delete(fn);
}

export function preloadParts(id: string): void {
  if (partsCache.has(id)) return; // 已在探测中或已有结果，不重复发起
  partsCache.set(id, 'pending');
  // catch 是必须的：loadParts 抛出时（见 parts.ts 的 verticalBounds）原来会把这个 id
  // **永久留在 'pending'**——has(id) 挡住后续每一次重试，等待者一个都不触发，
  // 那个角色整场都是火柴人，且控制台只有一条 unhandled rejection。
  // 失败就把坑位删掉让下次能重来，并且照样通知一次，让立绘先按火柴人画出来。
  loadParts(id)
    .then(p => { partsCache.set(id, p); })
    .catch(() => { partsCache.delete(id); })
    .finally(() => { for (const w of [...partsWaiters]) w(); });
}

function getParts(id: string): PartImages | null {
  const e = partsCache.get(id);
  return e && e !== 'pending' ? e : null;
}

export interface PrevPos { x1: number; y1: number; x2: number; y2: number }

/**
 * 本帧的光源颜色（关卡的天体色）。角色身上要掺一点它——背景与角色被同一盏光照，
 * 人才算站在景里而不是贴在景上。每帧开头由 draw() 设定一次（见 draw 里的 sceneLight = ...）。
 */
let sceneLight = '#EDE3D2';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function capturePrev(b: Battle): PrevPos {
  return { x1: b.p1.x, y1: b.p1.y, x2: b.p2.x, y2: b.p2.y };
}

/** 确定性伪随机（GLSL 老套路的 sin-hash）：只吃 seed 派生的数字，逐帧结果恒定，
 * 不能换成 Math.random —— 否则云纹/山形每帧重算会"沸腾" */
function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// hexAlpha 的定义挪到了 fx.ts（fx 也要用它，而 renderer 已经 import fx，反向 import 会成环）。
// 这里再导出，adornments/banner/validate 及测试里原有的 import 路径全部不变。
export { hexAlpha };

// 光晕渐变按关卡缓存：celestialColor 和 cx/cy/r 全是关卡固定值，每帧 createRadialGradient
// 纯属浪费。StageBg 对象本身是 data/stages.ts 里的静态常量（生命周期等同应用），Map 不会泄漏。
const celestialHaloCache = new Map<StageBg, CanvasGradient>();
function getCelestialHalo(ctx: CanvasRenderingContext2D, bg: StageBg, cx: number, cy: number, r: number): CanvasGradient {
  let g = celestialHaloCache.get(bg);
  if (!g) {
    g = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.6);
    g.addColorStop(0, hexAlpha(bg.celestialColor, 0.35));
    g.addColorStop(1, hexAlpha(bg.celestialColor, 0));
    celestialHaloCache.set(bg, g);
  }
  return g;
}

/** 天体：每关固定一个，不参与视差（画在屏幕空间固定坐标），加一圈柔光晕做区分 */
/**
 * 天体挂在哪、多大：按 seed 派生。
 *
 * 此前十二关的日月**钉死在同一个点**（800, 86）、同一个半径 34——山形按 seed 各不相同、
 * 云纹按 seed 各不相同，唯独天上那一颗，十二关分毫不差地挂在右上角同一个位置。
 * 换关时最显眼的那一块反而是最没变的。
 *
 * 范围是照着构图定的，不是随手取的：
 *   cx 200~860——再往左会压到左侧血条底下（血条从两边向中间伸），再往右会出安全区
 *   cy 58~148——上不出画，下不进地平线（剪影山脊在 300 上下）
 *   r  26~44 ——比 26 小就读不出是什么，比 44 大会把半个天空占掉
 */
export function celestialPlace(seed: number): { cx: number; cy: number; r: number } {
  return {
    cx: 200 + hash(seed * 1.7 + 11.3) * 660,
    cy: 58 + hash(seed * 2.9 + 4.1) * 90,
    r: 26 + hash(seed * 4.3 + 7.9) * 18,
  };
}

function drawCelestial(ctx: CanvasRenderingContext2D, bg: StageBg) {
  const { cx, cy, r } = celestialPlace(bg.seed);
  ctx.fillStyle = getCelestialHalo(ctx, bg, cx, cy, r);
  ctx.beginPath(); ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2); ctx.fill();

  if (bg.celestial === 'sun') { // 日轮：加一圈短射线
    ctx.strokeStyle = hexAlpha(bg.celestialColor, 0.55);
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6));
      ctx.lineTo(cx + Math.cos(a) * (r + 16), cy + Math.sin(a) * (r + 16));
      ctx.stroke();
    }
  }
  ctx.fillStyle = bg.celestialColor;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  if (bg.celestial === 'crescent') {
    // 月牙：外圆 + 偏心内圆**反向**描一遍，nonzero 填充规则自然把重叠处挖空。
    //
    // 原来用的是 'destination-out' 挖——那是在**画布上真的挖了个洞**，露出来的是页面底色
    // （#0E141C 的深藏青），不是天色。夜里天暗，看不出来；翠云山那种青天上一眼就是
    // 一个月亮旁边挂了颗黑球。画成路径就没有洞，天色原样留在月牙缺掉的地方。
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2, false);
    ctx.arc(cx + r * 0.55, cy - r * 0.25, r * 0.9, 0, Math.PI * 2, true);
    ctx.fill();
  }
}

/** 如意云纹最小语汇单元：一段拱起主弧 + 弧尾向内卷入的螺旋，区别于写实蓬松云的关键就在这道内卷 */
function drawRuyiCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, rot: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 / scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-26, 6);
  ctx.bezierCurveTo(-26, -20, -2, -26, 16, -14); // 主弧：如意头部的拱起轮廓
  ctx.bezierCurveTo(30, -6, 32, 10, 20, 17);      // 弧尾开始向内卷
  ctx.bezierCurveTo(11, 22, 2, 16, 7, 7);          // 螺旋第一圈
  ctx.bezierCurveTo(10, 1, 17, 3, 15, 9);          // 螺旋收尾，卷向中心
  ctx.stroke();
  ctx.beginPath(); // 尾端飘带，衬出云气的轻盈
  ctx.moveTo(-26, 6);
  ctx.quadraticCurveTo(-40, 12, -52, 8);
  ctx.stroke();
  ctx.restore();
}

/** 3–5 组如意云纹，0.15 倍视差；位置/大小/旋转全部由 seed 派生的 hash 决定。visW/offX 只改
 * hash 结果映射到的坐标范围（撑满可见宽度、按可见范围居中），hash 本身吃的种子不变——宽屏
 * 上云纹会散得更开，不是种子/视差推导方式变了 */
function drawClouds(ctx: CanvasRenderingContext2D, bg: StageBg, camX: number, visW: number, offX: number) {
  const color = hexAlpha(bg.sky[1], 0.4);
  const n = 3 + (bg.seed % 3);
  for (let i = 0; i < n; i++) {
    const x = hash(bg.seed + i * 12.9) * visW - offX + camX * 0.15;
    const y = 50 + hash(bg.seed * 3.1 + i * 7.7) * 150;
    const scale = 0.6 + hash(bg.seed * 5.3 + i * 3.3) * 0.7;
    const rot = (hash(bg.seed * 9.7 + i * 5.1) - 0.5) * 0.8;
    drawRuyiCloud(ctx, x, y, scale, rot, color);
  }
}

/** 剪影山形的路径。单独抽出来是因为轮廓光要画两遍（见 drawSilhouette）：
 * 先把整条脊线往上挪一点点、用光色填一遍，再用本色填回原位——
 * 挪出来的那条窄边就是迎着天光的那道边。 */
function silhouettePath(
  ctx: CanvasRenderingContext2D, seed: number, camX: number, parallax: number,
  baseH: number, amp1: number, amp2: number, xFreq: number, wxMul2: number, x0: number, x1: number,
) {
  ctx.beginPath();
  ctx.moveTo(x0, FLOOR_Y);
  for (let x = x0; x <= x1; x += 16) {
    const wx = (x + camX * parallax) * xFreq;
    const h = baseH + Math.sin(wx + seed) * amp1 + Math.sin(wx * wxMul2 + seed * 3) * amp2;
    ctx.lineTo(x, FLOOR_Y - h);
  }
  ctx.lineTo(x1, FLOOR_Y);
  ctx.closePath();
}

/** 剪影山形：seed 正弦叠加。far/near 两层复用同一形状函数，靠 seed 偏移和振幅/频率区分，不同形。
 * x0/x1 是本次要画满的可见逻辑 x 范围（默认 0..LOGIC_W，宽屏时由调用方传更宽的范围）——山形
 * 曲线本身的算法（wx 的推导）不变，只是多算几段延伸到新边界。
 *
 * rim：轮廓光。迎着天光的那条脊线给一道亮边——剪影没有内部明暗，全靠这道边把"山"从
 * 天空里分出来。做法是把同一条路径往上挪 2px 用光色填一遍、再用本色填回原位。 */
function drawSilhouette(
  ctx: CanvasRenderingContext2D, color: string, seed: number, camX: number, parallax: number,
  baseH: number, amp1: number, amp2: number, xFreq: number, wxMul2: number, x0: number, x1: number,
  opts?: { rim?: { color: string; px: number }; volume?: [number, number] },
) {
  const rim = opts?.rim;
  if (rim) {
    ctx.save();
    ctx.translate(0, -rim.px);
    silhouettePath(ctx, seed, camX, parallax, baseH, amp1, amp2, xFreq, wxMul2, x0, x1);
    ctx.fillStyle = rim.color;
    ctx.fill();
    ctx.restore();
  }
  silhouettePath(ctx, seed, camX, parallax, baseH, amp1, amp2, xFreq, wxMul2, x0, x1);
  if (opts?.volume) {
    // 体积：山体上缘略亮、往下压暗。一整块平涂的深色在夜里读成"一条黑带"，
    // 有了这个渐变才读成"一座山"——明暗全靠这道竖向的坡
    const [top, bottom] = opts.volume;
    const g = ctx.createLinearGradient(0, FLOOR_Y - baseH - amp1, 0, FLOOR_Y);
    g.addColorStop(0, shade(color, top));
    g.addColorStop(1, shade(color, bottom));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fill();
}

/**
 * 层与层之间的大气：远层画完之后压一道近地平线的雾。
 *
 * 没有这一层的时候，三层剪影是三个同样黑的黑块贴在一起——深度只能靠"谁更黑"来读，
 * 而夜里越远的东西并不更黑，是**更被雾吃掉**。这层雾就是让远山退进天色里的那一步。
 */
function drawHaze(
  ctx: CanvasRenderingContext2D, color: string, offX: number, topY: number, visW: number, alpha: number,
) {
  if (alpha <= 0) return;
  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, topY);
  g.addColorStop(0, hexAlpha(color, alpha));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-offX, topY, visW, FLOOR_Y - topY + 2);
}

/** 背景四层，由远及近：渐变天空 → 天体（不参与视差）→ 如意云纹（0.15x）→ 远山剪影（0.3x，已有）
 * → 近景剪影（0.6x，新增）。整体画在 cam.apply 之前的屏幕空间，不随相机缩放/抖动；视差靠 camX
 * 手动加权算偏移，而非交给画布变换（若挪到 cam.apply 之后，相机的整体平移+缩放会再叠加一层，
 * 视差就会双重生效或错位）。visW/visH 默认等于 LOGIC_W/LOGIC_H（不传时行为与改动前完全一致），
 * 宽于/高于安全区时由调用方（draw()）传实际可见的逻辑尺寸，背景铺满整块画布，不再露出页面底色。
 * 天体（drawCelestial）不是按 seed 派生位置，本来就没有"绘制范围"要跟着变宽——固定挂在安全区
 * 右上角，跟这次改动无关，不动它
 *
 * 关卡远景美术（public/stages/<id>/far.webp）存在时，far 层由那张画顶替：
 * 画出来的远山比程序化剪影有细节得多，而程序化的近/中两层继续留在前面压着它，景深照旧。
 * 没有那张画时，far 层照旧是剪影——逐层独立，缺哪层补哪层。 */
export function drawBg(ctx: CanvasRenderingContext2D, bg: StageBg, camX: number, visW = LOGIC_W, visH = LOGIC_H) {
  const offX = (visW - LOGIC_W) / 2, offY = (visH - LOGIC_H) / 2;
  const art = bg.id ? getStageArt(bg.id) : null;
  const farArt = art?.far ?? null;

  if (farArt) {
    // **整幅背板**：画是唯一的背景来源——它自己的天空、自己的远山、自己的地面都在里面。
    // 舞台自己的渐变天、云纹、山形剪影全部退场（一份背景只留一个来源，
    // 两份天空叠在一起反而脏，而山影压在画上会把画压成"一条带"）。
    // 星辰与月亮画在画**上面**：它们是天空里的东西，画的天是实的，正好接住。
    // 视差 0.01：背板几乎不动。画出来的远景自带纵深，整幅一起飘反而像"背景在滑动"；
    // 而背板一动就得重采样，细边缘会跟着抖——这一层只留一点点生气（镜头横移几百像素
    // 才挪动 1px，而且对齐到整数像素，不产生重采样抖动）。
    drawStageMatte(ctx, farArt, camX, 0.01, visW, visH, offX, offY);
    drawStars(ctx, bg, camX, visW, offX, offY);
    drawCelestial(ctx, bg);
    drawAmbient(ctx, bg, camX, visW, visH, offX, offY);
    return;
  }

  const g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  g.addColorStop(0, bg.sky[0]);
  g.addColorStop(0.58, bg.sky[1]);
  // 近地平线的一层地气：天色到底下要往地的颜色里走一段，否则天地之间是一道硬边
  g.addColorStop(1, mixC(bg.sky[1], bg.ground, 0.5));
  ctx.fillStyle = g;
  // 天空铺满整块画布高度（下沿到 LOGIC_H + offY，即 visH），不是只铺到 FLOOR_Y——地面紧接着
  // 在 cam.apply 之内按世界坐标画，zoom>1 时地面在屏幕上的起始 y 会低于 FLOOR_Y（贴近镜头
  // 把地平线推下去了），如果天空只填到 FLOOR_Y，460 到地面实际起始 y 之间那条横带就没有任何
  // 绘制覆盖——上一帧角色腿部的像素会留在原地。走路会改变双方距离进而改变 zoom，残影就是
  // 这么冒出来的（task-30）。天空现在是"每帧重画一次、覆盖全画布"的基础层，之后不管地面/
  // 角色实际画到哪，画不到的地方最多露出天空色，不会露出上一帧的残留像素
  ctx.fillRect(-offX, -offY, visW, visH);
  drawStars(ctx, bg, camX, visW, offX, offY);
  drawCelestial(ctx, bg);
  drawClouds(ctx, bg, camX, visW, offX);
  // 远层：程序化的剪影。轮廓光用天色提亮一档——山脊迎着的那点光
  drawSilhouette(ctx, bg.silhouette, bg.seed, camX, 0.3, 90, 45, 25, 0.008, 2.7, -offX, LOGIC_W + offX,
    { rim: { color: mixC(bg.sky[1], INK.paper, 0.22), px: 2 }, volume: [10, -8] });
  // 远层之后的雾：远山因此退进天色里
  drawHaze(ctx, bg.sky[1], offX, FLOOR_Y - 210, visW, 0.34);
  drawSilhouette(ctx, shade(bg.silhouette, -18), bg.seed * 7 + 13, camX, 0.6, 150, 70, 30, 0.005, 1.8, -offX, LOGIC_W + offX,
    { rim: { color: mixC(bg.sky[1], INK.paper, 0.14), px: 2 }, volume: [8, -10] });
  drawAmbient(ctx, bg, camX, visW, visH, offX, offY);
  // 前景剪影：比角色更靠近镜头、跟随最快（1.15×），从画面下缘探进来。
  // 这一层是"景深"的关键——此前所有层都在角色之后，画面是平的。
  // 振幅压平（34/26 → 18/12）：它是岸，不该读成一道浪。
  drawSilhouette(ctx, shade(bg.silhouette, -34), bg.seed * 13 + 5, camX, 1.15, 250, 18, 12, 0.006, 1.1, -offX, LOGIC_W + offX,
    { rim: { color: mixC(bg.sky[1], INK.paper, 0.1), px: 2 }, volume: [6, -6] });
}

/** 星野：只在夜色足够深的关卡出现（按天空上缘亮度判定），位置由下标的固定散列给出，
 * 不用 Math.random——随机数会让星星逐帧乱闪。视差最慢（0.06×），撑出最远的一层。
 *
 * 取位一律用无符号右移 >>>：h 是 `x >>> 0` 得来的无符号数，但 `h >> n` 是**有符号**移位，
 * h 超过 2^31 时结果为负，半径会跟着变负——canvas 的 arc() 直接抛 IndexSizeError，
 * 整个 draw 挂掉、画面只剩天空渐变。 */
/** 位散列：把下标打散成看起来无规律但逐帧恒定的数。
 * 直接用 `i * 常数 % N` 不行——连续下标乘同一个常数再取模是**等差数列**，
 * 星星和流萤会排成一条条斜线（第一版就是这么翻车的）。这里做两轮异或折叠把高位混进低位。 */
function hash32(n: number): number {
  let h = Math.imul(n + 1, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function drawStars(ctx: CanvasRenderingContext2D, bg: StageBg, camX: number, visW: number, offX: number, offY: number) {
  const lum = parseInt(bg.sky[0].slice(1, 3), 16) + parseInt(bg.sky[0].slice(3, 5), 16) + parseInt(bg.sky[0].slice(5, 7), 16);
  if (lum > 150) return; // 白天/亮天不画星
  const drift = -camX * 0.06;
  for (let i = 0; i < 70; i++) {
    const h = hash32(i);                            // 固定散列，逐帧恒定
    const x = ((h % 1600) + drift) % 1600 - 200;
    const y = -offY + ((h >>> 11) % 240) * 0.85;
    if (x < -offX - 8 || x > visW - offX + 8) continue;
    const tw = 0.35 + ((h >>> 5) % 40) / 100;        // 每颗星自己的亮度，不闪
    ctx.fillStyle = hexAlpha('#EDE3D2', tw * 0.7);
    ctx.beginPath();
    ctx.arc(x, y, ((h >>> 3) % 3) * 0.5 + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 关卡氛围粒子：东海的浪沫、灌江口的流萤、花果山的落瓣、积雷山的火星。
 * 每一颗的轨迹都是「下标 + 帧号」的固定函数，无状态、无随机——因此不需要 tick，
 * 也不会因为掉帧而错乱。frameSeed 由 camX 推出，镜头不动时靠自身相位继续飘。 */
export function drawAmbient(ctx: CanvasRenderingContext2D, bg: StageBg, camX: number, visW: number, visH: number, offX: number, offY: number) {
  const a = bg.ambient;
  if (!a) return;
  ambientPhase = (ambientPhase + 1) % 100000;
  const t = ambientPhase;
  ctx.save();
  // 尘与雾不发光：走正常叠加，才读得出"挡住了后面"而不是"亮起来"。
  // 骨灰用 lighter 画会变成飘在洞里的萤火，那正是这一关原本的样子
  const dull = a.kind === 'petal' || a.kind === 'ash' || a.kind === 'mist';
  ctx.globalCompositeOperation = dull ? 'source-over' : 'lighter';
  for (let i = 0; i < a.count; i++) {
    const h = hash32(i * 7 + 3);
    const speed = 0.25 + ((h >>> 7) % 60) / 100;
    const sway = ((h >>> 13) % 30) + 10;
    // 雾走得比谁都慢（0.08），飘得快就成了烟不是雾
    const drift = a.kind === 'ember' ? 0 : t * speed * (a.kind === 'mist' ? 0.08 : 0.35);
    let x = ((h % 1400) - camX * 0.45 + drift) % 1400 - 220;
    if (x < -offX - 20) x += 1400;
    const span = visH + offY;
    let y: number;
    if (a.kind === 'ember') {           // 火星：向上飘
      y = span - ((t * speed * 0.6 + (h >>> 3) % 600) % 600) - offY;
    } else if (a.kind === 'petal') {    // 落瓣：向下飘
      y = ((t * speed * 0.5 + (h >>> 3) % 620) % 620) - offY;
    } else if (a.kind === 'ash') {      // 骨灰：也向下，但慢得多——无声地沉，不是被风吹落
      y = ((t * speed * 0.22 + (h >>> 3) % 620) % 620) - offY;
    } else {                            // 流萤/电花/鬼气：原地上下浮
      y = -offY + ((h >>> 3) % 420) + Math.sin((t * 0.02 + i) * speed) * sway;
    }
    x += Math.sin((t * 0.012 + i * 1.7)) * sway * 0.5;
    // 雾是大团的，其余都是细粒
    const r = a.kind === 'mist' ? 14 + ((h >>> 17) % 5) * 4 : 1 + ((h >>> 17) % 3) * 0.9;
    let alpha = 0.22 + ((h >>> 19) % 40) / 100 * 0.5;
    // 电花明灭：每颗有自己的频率与相位，闪到接近全暗再亮起来。
    // 雷部那一关的空气该是"啪、啪"地跳，不是匀速漂
    if (a.kind === 'spark') alpha *= 0.15 + 0.85 * Math.pow(Math.max(0, Math.sin(t * 0.09 * speed + i * 2.3)), 6);
    if (a.kind === 'mist') alpha *= 0.28;      // 大团必须更淡，否则糊住整个背景
    ctx.fillStyle = hexAlpha(a.color, alpha);
    if (a.kind === 'petal') {           // 花瓣画成小椭圆，带自转
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 0.01 * speed + i);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 2.2, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** 氛围粒子的相位。它挂在绘制上而不是逻辑 tick——这一层纯装饰、不参与任何判定，
 * 且相位只影响飘动位置，快一点慢一点看不出来；真挂逻辑帧反而要为它多传一个参数进来。 */
let ambientPhase = 0;

/** 可见视口的逻辑尺寸：默认等于安全区本身（960×540），letterbox 消除后由 GameCanvas 按实际
 * 屏幕比例算出更大的值传进来。draw() 不传这个参数时行为与改动前逐像素一致。 */
export interface Viewport { w: number; h: number }


export function draw(
  ctx: CanvasRenderingContext2D, b: Battle, prev: PrevPos, alpha: number,
  cam: Camera, fx: FxSystem, banner: BannerSystem, mandorla: MandorlaSystem,
  highlight: 0 | 1 | null = null, dark = 0, bg: StageBg = DEFAULT_BG,
  viewport: Viewport = { w: LOGIC_W, h: LOGIC_H }, cutin?: CutInSystem, bars = 0,
) {
  const offX = (viewport.w - LOGIC_W) / 2, offY = (viewport.h - LOGIC_H) / 2;
  drawBg(ctx, bg, cam.x, viewport.w, viewport.h);
  // 这一帧的光源颜色。角色要受同一盏光的照（见 drawFighter 里的 sceneLight 混色），
  // 所以它在每帧开头定一次，不各处现取——两处现取就会在换关的那一帧取到不同的值
  sceneLight = bg.celestialColor;
  cam.apply(ctx);
  // 地面：近地平线一层被雾照亮的地气，往镜头方向压暗。夜里远处的地被雾照着，近处是黑的——
  // 之前是一整块平涂色，地面读起来像一张贴上去的色纸
  const gg = ctx.createLinearGradient(0, FLOOR_Y, 0, LOGIC_H + offY);
  gg.addColorStop(0, mixC(bg.ground, bg.sky[1], 0.32));
  gg.addColorStop(0.28, bg.ground);
  gg.addColorStop(1, shade(bg.ground, -12));
  ctx.fillStyle = gg;
  // 地面要一直铺到屏幕底边**以下**。镜头缩放时（放大招 1.25~1.45）地面线在屏幕上的位置
  // 会往下走，而视口底边是固定的——按固定高度铺会露一条底（画在背景层，就成了"画从地板下
  // 冒出来"）。这里按当前缩放把地面线的世界坐标反算出来，铺到它以下为止。
  const zoom = Math.max(0.3, cam.zoom);
  const worldBottom = 300 + ((-offY + viewport.h) - 300) / zoom;
  const groundH = Math.max(LOGIC_H - FLOOR_Y + offY, worldBottom - FLOOR_Y + 20);
  ctx.fillRect(-LOGIC_W - offX, FLOOR_Y, LOGIC_W * 3 + offX * 2, groundH);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-LOGIC_W - offX, FLOOR_Y); ctx.lineTo(LOGIC_W * 2 + offX, FLOOR_Y); ctx.stroke(); // 地平线
  // 地平线下沿压一道极淡的亮线：天地之间那层空气。之前天地之间是一道硬边
  ctx.strokeStyle = hexAlpha(mixC(bg.sky[1], INK.paper, 0.45), 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-LOGIC_W - offX, FLOOR_Y + 2); ctx.lineTo(LOGIC_W * 2 + offX, FLOOR_Y + 2); ctx.stroke();
  ctx.strokeStyle = hexAlpha(INK.paper, 0.06); // 极淡横向纹理带，不做倒影
  ctx.lineWidth = 1;
  for (let ty = FLOOR_Y + 16; ty < LOGIC_H; ty += 18) {
    ctx.beginPath(); ctx.moveTo(-LOGIC_W - offX, ty); ctx.lineTo(LOGIC_W * 2 + offX, ty); ctx.stroke();
  }
  const p1x = lerp(prev.x1, b.p1.x, alpha), p1y = lerp(prev.y1, b.p1.y, alpha);
  const p2x = lerp(prev.x2, b.p2.x, alpha), p2y = lerp(prev.y2, b.p2.y, alpha);
  // 背光先画：它是"角色身后的光"，要在角色的投影之下——否则光晕会把脚下的影子照淡，
  // 影子一淡人就浮起来了
  drawBacklight(ctx, p1x, FLOOR_Y - p1y, bg.celestialColor);
  drawBacklight(ctx, p2x, FLOOR_Y - p2y, bg.celestialColor);
  drawShadow(ctx, p1x, p1y, b.p1.def.width);
  drawShadow(ctx, p2x, p2y, b.p2.def.width);
  drawDecals(ctx);                    // 地面痕迹：地面之上、角色之下
  drawAdornments(ctx, b, 'back');     // 飘带与满槽气环：在角色之下
  drawWeaponTrail(ctx, 0, b.p1.def); // 拖影压在角色之下：刃光该在身后拉出去，不该盖住人
  drawGhosts(ctx, ghostState.p1, b.p1.def); // 残影画在出招者之前（在其身后），只在 sp100 窗口内非空
  drawGhosts(ctx, ghostState.t1, b.p1.def); // 普通招式的身形拖影，同理画在角色身后
  drawFighter(ctx, b.p1, p1x, p1y, 0);
  drawWeaponTrail(ctx, 1, b.p2.def);
  drawGhosts(ctx, ghostState.p2, b.p2.def);
  drawGhosts(ctx, ghostState.t2, b.p2.def);
  drawFighter(ctx, b.p2, p2x, p2y, 1);
  if (dark > 0) {
    ctx.fillStyle = `rgba(6,4,16,${dark * 0.75})`;
    ctx.fillRect(-LOGIC_W, -LOGIC_H, LOGIC_W * 3, LOGIC_H * 3);
    if (highlight !== null) {
      const f = highlight === 0 ? b.p1 : b.p2;
      const px = highlight === 0 ? lerp(prev.x1, f.x, alpha) : lerp(prev.x2, f.x, alpha);
      const py = highlight === 0 ? lerp(prev.y1, f.y, alpha) : lerp(prev.y2, f.y, alpha);
      // 火焰纹背光：压在暗场之上、垫在出招者之下——顺序是暗场遮罩 → 背光 → 残影 → 高亮重绘的出招者。
      // Task 35：残影在第 210/212 行已经画过一次，但 sp100 的 dark 从 startMove 那一刻就是 1，
      // 整个 startup+active+recovery 期间全程 >0（见 GameCanvas 的 cine.hold），上面那次画的残影
      // 会被这里的暗场遮罩原地埋掉——之前只把出招者本人捞出来重画「保持明亮」，残影没有这一步，
      // 于是暗场铺满的这段时间里（也正是残影最需要看见的连打窗口）残影其实是隐形的。这里补上同一
      // 支重绘，让残影跟出招者一起穿过暗场
      mandorla.draw(ctx, px, FLOOR_Y - py - MANDORLA_Y, dark);
      drawGhosts(ctx, highlight === 0 ? ghostState.p1 : ghostState.p2, f.def);
      drawGhosts(ctx, highlight === 0 ? ghostState.t1 : ghostState.t2, f.def);
      drawFighter(ctx, f, px, py, highlight); // 遮罩之上重画一次，让出招者保持明亮
    }
  }
  fx.draw(ctx);
  banner.drawSkill(ctx, p1x, p1y, p2x, p2y); // 技能名跟出招者走，须在 cam.restore 之前
  drawHitCounter(ctx, 0, p2x, p2y); // HIT 计数贴在受击者头顶——p1 打人时数字长在 p2 头上，反之亦然
  drawHitCounter(ctx, 1, p1x, p1y);
  cam.restore(ctx);
  // 速度线：屏幕空间，只在超必杀（tier 100）出现，随暗场衰减一起淡出；必须画在竖排招式名之下
  // 颜色跟 mandorla 当次绽放走同一份 glow（角色 superGlow 或默认藤黄→朱砂），不再固定用纸白
  if (mandorla.on && mandorla.tier === 100) drawSpeedLines(ctx, dark, mandorla.glow[0]);
  drawProjectiles(ctx, b);            // 飞行中的实物：乾坤圈/光束/芭蕉扇
  drawAdornments(ctx, b, 'front');    // 余烬浮在角色之上
  drawFlung(ctx, b);                  // 被打飞的兵器：要看得见它飞出去、扎进地里
  if (fx.flashAlpha > 0) {
    ctx.globalAlpha = fx.flashAlpha;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-offX, -offY, viewport.w, viewport.h); // 屏幕空间：白闪要盖满整块画布，不留边
    ctx.globalAlpha = 1;
  }
  cutin?.draw(ctx); // cut-in 立绘：在速度线之上、竖排招式名之下（名字必须始终可读）
  banner.drawScreen(ctx); // 大招竖排卷轴+印、关卡开场横幅：屏幕空间，不随镜头晃/缩放；须压在速度线之上
  // 后期：辉光 + 暗角。位置在 HUD **之前**——血条、计时器是读数不是光源，烤亮了反而难读；
  // 而大招的招式名、cut-in 立绘属于演出，值得跟着一起发光。
  // 暗角同理：它压的是画面四角的底色，压在血条上会让两条血条的末端糊进黑里。
  applyBloom(ctx);
  applyVignette(ctx, offX, offY, viewport.w, viewport.h, 0.46);
  drawBars(ctx, b, viewport.w); // 血条不受相机影响；宽屏下贴真实屏幕边缘，不是贴 960 的边
  drawLetterbox(ctx, bars, viewport, offX, offY);
}

/** 影院黑边：超必杀期间从上下压进来，收势时退开——是这类大演出最省事也最见效的一层"这是过场"
 * 的信号。屏幕空间、画在最上层（连血条一起压住：演出期间 HUD 让位是惯例）。
 * 高度比例由 GameCanvas 的 cine.bars 缓动给出，这里只负责画，不推进任何计时。 */
/** 飞行中的投射物。旋转相位由自身 age 给出（不读时钟、不用随机），
 * 因此暂停/慢镜时它也跟着停，与整套演出同一条时间轴。 */
export function drawProjectiles(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const pr of b.projectiles) {
    const d = pr.def;
    const cy = FLOOR_Y - pr.y - d.h / 2;
    const fade = Math.min(1, (pr.life - pr.age) / 10);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(pr.x, cy);
    if (d.kind === 'ring') {            // 乾坤圈：金环旋着飞，带一道内圈
      ctx.rotate(pr.age * 0.34 * pr.facing);
      ctx.strokeStyle = d.color; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, d.w / 2 - 3, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = hexAlpha(INK.paper, 0.75); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, d.w / 2 - 8, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = hexAlpha(d.color, 0.5); ctx.lineWidth = 3;   // 拖尾一小段弧
      ctx.beginPath(); ctx.arc(0, 0, d.w / 2 + 4, 0.6, 2.2); ctx.stroke();
    } else if (d.kind === 'beam') {     // 天眼光束：横向长条 + 前端亮头
      const g = ctx.createLinearGradient(-d.w / 2, 0, d.w / 2, 0);
      g.addColorStop(0, hexAlpha(d.color, 0));
      g.addColorStop(1, hexAlpha(d.color, 0.95));
      ctx.fillStyle = g;
      ctx.fillRect(-d.w / 2 * pr.facing, -d.h / 2, d.w * pr.facing, d.h);
      ctx.fillStyle = hexAlpha(INK.paper, 0.9);
      ctx.beginPath(); ctx.ellipse(d.w / 2 * pr.facing, 0, 7, d.h / 2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (d.kind === 'arrow') {    // 箭：杆 + 三角镞 + 尾羽——不是一根发光的条
      // 后羿三记必杀全是箭，原本和二郎神的天眼光束共用 'beam'：一根渐变长条 + 椭圆亮头。
      // 那是"能量"的画法，不是"箭"的画法——全场唯一的弓箭手，射出去的东西看不出是箭。
      const f = pr.facing, L = d.w / 2;
      ctx.strokeStyle = hexAlpha(INK.paper, 0.85); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-L * f, 0); ctx.lineTo(L * f, 0); ctx.stroke();   // 箭杆
      ctx.fillStyle = d.color;                                                       // 箭镞
      ctx.beginPath();
      ctx.moveTo(L * f, 0);
      ctx.lineTo((L - 11) * f, -d.h / 2);
      ctx.lineTo((L - 11) * f, d.h / 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexAlpha(d.color, 0.75); ctx.lineWidth = 2;                  // 尾羽两片
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-L * f, 0);
        ctx.lineTo((-L + 9) * f, sgn * d.h * 0.45);
        ctx.stroke();
      }
      ctx.strokeStyle = hexAlpha(d.color, 0.30); ctx.lineWidth = 5;                  // 一小段拖影
      ctx.beginPath(); ctx.moveTo(-L * f, 0); ctx.lineTo(-(L + 16) * f, 0); ctx.stroke();
    } else if (d.kind === 'wraith') {   // 鬼卒：一具飘着的残影，不是旋转的金环
      // 原本借哪吒的 'ring' 画：召唤出来的鬼兵成了飞旋的金圈。而且环只按 d.w 算半径，
      // 鬼卒的判定框是 46x88——竖着那一半没有任何可见对应物，玩家挨了打找不到打他的东西。
      // 这里按 w x h 整个画满：立起来的躯影 + 空洞的脸 + 下摆散开的尾。
      const w2 = d.w / 2, h2 = d.h / 2, sway = Math.sin(pr.age * 0.12) * 3;
      ctx.fillStyle = hexAlpha(d.color, 0.34);
      ctx.beginPath();
      ctx.moveTo(sway, -h2);                                   // 头顶
      ctx.quadraticCurveTo(w2, -h2 * 0.2, w2 * 0.7, h2 * 0.5);  // 右肩到摆
      ctx.quadraticCurveTo(0, h2, -w2 * 0.7, h2 * 0.5);         // 下摆散开
      ctx.quadraticCurveTo(-w2, -h2 * 0.2, sway, -h2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexAlpha(d.color, 0.8); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = hexAlpha(INK.ink, 0.85);                  // 空洞的脸：两点眼窝
      for (const sgn of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(sgn * w2 * 0.22, -h2 * 0.62, 2.6, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (d.kind === 'roar') {     // 怒吼：一圈圈推出去的声浪，不是转着的扇叶
      // 原本借铁扇的 'fan' 画：牛魔王的一声吼成了一把旋转的芭蕉叶。
      // 声音该是同心弧从口部往外推，越外越淡。
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const phase = ((pr.age * 0.06 + i / 3) % 1);
        ctx.strokeStyle = hexAlpha(d.color, 0.75 * (1 - phase));
        ctx.beginPath();
        ctx.arc(-d.w / 2 * pr.facing, 0, d.w * (0.25 + phase * 0.75), -1.0, 1.0);
        ctx.stroke();
      }
    } else {                            // 芭蕉扇：扇形，边缘一圈风纹
      ctx.rotate(pr.age * 0.22 * pr.facing);
      ctx.fillStyle = hexAlpha(d.color, 0.8);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, d.w / 2, -0.9, 0.9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexAlpha(INK.paper, 0.55); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, d.w / 2 + 5, -0.9, 0.9); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawLetterbox(ctx: CanvasRenderingContext2D, ratio: number, viewport: Viewport, offX: number, offY: number) {
  if (ratio <= 0.001) return;
  const h = viewport.h * ratio;
  ctx.fillStyle = '#05080e';
  ctx.fillRect(-offX, -offY, viewport.w, h);
  ctx.fillRect(-offX, -offY + viewport.h - h, viewport.w, h);
  // 内沿一道极淡的亮线：黑边因此读成"压上来的框"，而不是画布被裁短了
  ctx.fillStyle = hexAlpha(INK.paper, 0.16);
  ctx.fillRect(-offX, -offY + h, viewport.w, 1);
  ctx.fillRect(-offX, -offY + viewport.h - h - 1, viewport.w, 1);
}

// 出招者脚底往上量到胸口大致高度——背光中心不贴地面，也不糊到脸上
const MANDORLA_Y = 95;

const SPEED_LINE_COUNT = 36;

/** 全屏速度线：屏幕中心向外放射，中心留空避免糊住角色，外圈随线本身长度自然变淡。
 * 每条线的长度/宽度由线序号 i 的固定公式决定，不读 Math.random()/时钟——逐帧结果恒定，
 * 不会像随机数那样闪烁。color 取自触发这次超必杀的角色 superGlow（见调用处），不再固定纸白——
 * 之前四个角色的速度线长一个样，是"除了名字都一样"的一部分 */
function drawSpeedLines(ctx: CanvasRenderingContext2D, alpha: number, color: string) {
  if (alpha <= 0) return;
  const cx = LOGIC_W / 2, cy = LOGIC_H / 2;
  const hollow = 90, maxR = 640;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < SPEED_LINE_COUNT; i++) {
    const a = (i / SPEED_LINE_COUNT) * Math.PI * 2;
    const spread = (i * 37) % 13 / 13; // 0..1 的固定错落，避免车轮般的机械匀分
    const len = maxR * (0.6 + spread * 0.4);
    const x1 = cx + Math.cos(a) * hollow, y1 = cy + Math.sin(a) * hollow;
    const x2 = cx + Math.cos(a) * len, y2 = cy + Math.sin(a) * len;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, hexAlpha(color, alpha * 0.85));
    grad.addColorStop(1, hexAlpha(color, 0)); // 外圈渐隐
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5 + spread * 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

// 骨骼尺寸（相对脚底）
const SHOULDER_Y = 118, HIP_Y = 62;
export const UPPER_ARM = 26, LOWER_ARM = 26, THIGH = 32, SHIN = 32;
export const THIGH_LEN = THIGH; // 导出给测试算腰部接缝用（腿部胶囊帽半径要用 THIGH_W/TAPER）
export const SHIN_LEN = SHIN;   // 小腿段长：导出给测试复算"脚落在哪"（THIGH 与 SHIN 目前同为 32）
export const THIGH_W = 13; // seg() 调用里大腿段的裸 13，命名导出防止测试抄错数

/** motionSeq 段间接缝的姿势混合窗口（帧）。3–5 帧足够抹平切换瞬间的姿势跳变，不必长。 */
const SEAM_BLEND = 4;

/** 按 weight 比例把 total 帧切给 motionSeq 里的每一段：累加权重取整得到切点，末段吃住到
 * total（不会因为取整损耗尾帧）。纯函数，poseForMotionSeq 内部用，也单独导出给测试直接验证
 * 切分结果——四个角色的 sp100 数据故意把 weight 取成分毫不差等于目标帧宽（sum(weight)===total），
 * 这样 round() 不产生任何偏移，报告里给的分段帧区间就是这里算出来的准确值。 */
export function motionSeqBounds(total: number, seq: { weight: number }[]): { start: number; end: number }[] {
  const sumW = seq.reduce((s, x) => s + x.weight, 0) || 1;
  let acc = 0;
  const cuts = [0];
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i].weight;
    cuts.push(i === seq.length - 1 ? total : Math.round((acc / sumW) * total));
  }
  return cuts.slice(0, -1).map((s, i) => ({ start: s, end: cuts[i + 1] }));
}

/** motionSeq 播放到第几段（0-based），供 GameCanvas 的相机脉冲探测"刚跨进新一段"用。
 * 不带 motionSeq（或段数<2）的招式返回 -1。 */
export function motionSeqPhaseIndex(move: Move, stateFrame: number): number {
  if (!move.motionSeq || move.motionSeq.length < 2) return -1;
  const total = move.startup + move.active + move.recovery;
  const bounds = motionSeqBounds(total, move.motionSeq);
  const f = Math.min(Math.max(stateFrame, 0), total - 1);
  const idx = bounds.findIndex(b => f < b.end);
  return idx < 0 ? bounds.length - 1 : idx;
}

/** motionSeq 单帧取姿：定位落在哪一段、段内比例采样那段自己的 Motion，再在每段开头
 * SEAM_BLEND 帧内把上一段的收势姿势（其 motion 末帧）与本段姿势线性混合过去——直接切换会
 * 让姿势瞬间跳变，读成四个不连贯的快照而不是一套连续编排。混合进度是 stateFrame 的纯函数，
 * 不引入新的计时状态，天然挂在逻辑帧上，不会有「按渲染帧走」的风险。 */
export function poseForMotionSeq(seq: { motionId: string; weight: number }[], total: number, stateFrame: number, charId?: string): Pose {
  const bounds = motionSeqBounds(total, seq);
  const f = Math.min(Math.max(stateFrame, 0), total - 1);
  let idx = bounds.findIndex(b => f < b.end);
  if (idx < 0) idx = bounds.length - 1;
  const seg = bounds[idx];
  const segLen = Math.max(seg.end - seg.start, 1);
  const localFrame = f - seg.start;
  const motion = MOTIONS[seq[idx].motionId] ?? MOTIONS.thrust;
  const extSeg = charId ? extPose(charId, seq[idx].motionId) : null;
  const pose = extSeg
    ? extSeg((localFrame / segLen) * motion.frames)
    : samplePose(motion, (localFrame / segLen) * motion.frames);
  if (idx > 0) {
    const blendLen = Math.min(SEAM_BLEND, segLen);
    if (localFrame < blendLen) {
      const prevMotion = MOTIONS[seq[idx - 1].motionId] ?? MOTIONS.thrust;
      const prevPose = samplePose(prevMotion, prevMotion.frames); // 上一段的收势末帧
      return lerpPose(prevPose, pose, localFrame / blendLen);
    }
  }
  return pose;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 供附属层（飘带挂点）取当前姿势——与角色本体用同一份，不另算一遍 */
export function poseForFighter(f: Fighter): Pose { return poseFor(f); }

/** 已注册的外部骨骼来源，按角色 id 索引。空表 = 完全走程序化动作，与接入前逐像素一致。 */
const skelSources = new Map<string, PoseSource>();

/** 该角色的外部骨骼里有没有这段动作；有就返回一个取样函数，没有返回 null。
 * 站立/走/跳、单段招式、以及 motionSeq 的每一段都走这同一个入口——
 * 少接一处，那一处就会在迁移后仍然偷偷用着程序化动作，而且看不出来。 */
function extPose(charId: string, motionId: string): ((frame: number) => Pose) | null {
  const src = skelSources.get(charId);
  const key = `${charId}:${motionId}`;
  return src?.has(key) ? (frame: number) => src.sample(key, frame) : null;
}

/** 注册某个角色的外部骨骼动画。fire-and-forget：文件缺失/格式不对就保持程序化，不报错、不卡住。 */
export async function loadSkeleton(charId: string): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}skel/${charId}.json`);   // 子路径部署，见 parts.ts 那条
    if (!res.ok) return false;
    const doc = await res.json() as SkelDoc;
    if (!doc?.animations) return false;
    skelSources.set(charId, skeletalSource(doc, charId));
    return true;
  } catch { return false; }
}

function poseFor(f: Fighter): Pose {
  // 胜利姿势排在最前：赢下来之后那 120 帧收尾里，不管他停在什么状态都该在摆造型。
  // 排在 attack 之后的话，用大招终结的那一局会一直播大招的收势，赢家等于没有胜利动作。
  // 角色专属优先（`${id}Victory`），没有就用通用那套——同 hitstun 里 own() 的写法
  if (f.victory > 0) {
    const m = MOTIONS[`${f.def.id}Victory`] ?? MOTIONS.victory;
    const ext = extPose(f.def.id, `${f.def.id}Victory`) ?? extPose(f.def.id, 'victory');
    return ext ? ext(f.victory) : samplePose(m, f.victory);
  }
  if (f.state === 'attack' && f.move) {
    const total = f.move.startup + f.move.active + f.move.recovery;
    if (f.move.motionSeq && f.move.motionSeq.length >= 2) {
      return poseForMotionSeq(f.move.motionSeq, total, f.stateFrame, f.def.id);
    }
    const id = f.move.motionId;
    const ext = extPose(f.def.id, id);
    if (ext) { // 外部骨骼里有这段就用外部的，时长同样拉伸到招式帧数
      const m = MOTIONS[id] ?? MOTIONS.thrust;
      return ext((f.stateFrame / Math.max(total, 1)) * m.frames);
    }
    const m = MOTIONS[id] ?? MOTIONS.thrust;
    // 动作时长拉伸到与招式帧数一致
    return samplePose(m, (f.stateFrame / Math.max(total, 1)) * m.frames);
  }
  // 受击反应不能只有一个 hit：它只有 14 帧且不循环，而连打里受击方的 stateFrame 会一路
  // 涨到几百，samplePose 钳在末帧上——整整十秒保持同一个姿势，正是"对方一直一个动作"。
  // 现在①每次命中都把 stateFrame 归零（battle 里做），让挨打反应逐下重放；
  // ②左右交替两套挨打姿势，连打读起来是被打得东倒西歪而不是原地抖；
  // ③腾空时换成会持续翻转的 tumble（loop），落地后是 fallen，都不会钉死。
  if (f.state === 'hitstun') {
    // 受击方向感：同一套反应动作按当下的速度偏一点，读得出是被挑起来、被砸下去，
    // 还是被狠狠推出去。数据全部来自 Fighter 已有的 vx/vy，不需要新的传递链路。
    // 优先用角色专属的反应（幅度按体重/身法派生），没有就回退到通用那套
    const own = (base: string) => MOTIONS[`${f.def.id}${base}`] ?? MOTIONS[base.toLowerCase()];
    if (f.y > 0) {
      const p = samplePose(own('Tumble'), f.stateFrame);
      const v = clamp(f.vy, -14, 14) / 14; // +1 正在被挑起，-1 正在下坠
      return { ...p, lean: p.lean - v * 0.22, squash: p.squash + v * 0.06 };
    }
    const p = samplePose(f.hitCount % 2 === 0 ? own('Hit') : own('HitAlt'), f.stateFrame);
    // 横向被推得越猛，仰得越狠（vx 已经带了方向，取绝对值即可——动作本身是背对来向的）
    const k = Math.min(Math.abs(f.vx) / 12, 1);
    return { ...p, lean: p.lean - k * 0.2, roll: p.roll - k * 0.1 * Math.sign(f.vx || 1) * f.facing };
  }
  if (f.state === 'down') return samplePose(MOTIONS[`${f.def.id}Fallen`] ?? MOTIONS.fallen, f.stateFrame);
  const map: Record<string, string> = {
    idle: 'idle', walk: 'walk', jump: 'jump', block: 'block', crouch: 'crouch',
    run: 'run', backstep: 'backstep', roll: 'roll',
  };
  // 蹲防要看得出是蹲着的：防错了段就要挨打，玩家必须能从画面上分辨自己防的是哪一段，
  // 否则上下段就成了纯猜。姿势取 block 的护架、叠上 crouch 的屈膝——不用新做一套动作。
  if (f.state === 'block' && f.lowGuard) {
    const guard = samplePose(MOTIONS.block, f.stateFrame);
    const duck = samplePose(MOTIONS.crouch, f.stateFrame);
    return { ...guard, crouch: duck.crouch, legF: duck.legF, legB: duck.legB };
  }
  const id = map[f.state] ?? 'idle';
  const ext = extPose(f.def.id, id);
  return ext ? ext(f.stateFrame) : samplePose(MOTIONS[id], f.stateFrame);
}

/**
 * 沿 (x,y)→(ex,ey) 方向挂载部件图：以起点为锚，旋转到骨骼方向，宽=w×2、高=段长。
 * 旋转本身是保定向变换（行列式 +1），只会把骨骼终点转到正确位置，不会把贴图内容做
 * 镜像——facing 翻转时终点方向已经跟着 seg() 里的 sin(angle)*facing 镜像过一次了，
 * 但贴图画面本身还是原样，非对称素材（武器、偏一侧的花纹）朝向就会不对。所以额外
 * 在 rotate 之后叠一次 ctx.scale(facing, 1)：终点落在本地 x=0 的对称轴上，scale 不
 * 会挪动它（继续精确落在 ex,ey），但 x≠0 的画面内容会跟着整体镜像，与骨骼一起翻面。
 * white 时把贴图染成不透明白色（对应受击白闪）——胶囊路径是换描边色，贴图没有"描边色"
 * 这个概念，只能后处理染色。染色走 drawWhitePart，不是在主画布上叠一层，理由见那里。
 * 只取 part.top..part.bottom 这段内容行（parts.ts 已裁掉上下透明留白），横向仍是整张图——
 * 素材自带的留白多少不再影响这一段贴图实际画出来有多高，接缝就不再随素材抖动。
 */
export function drawBoneImg(ctx: CanvasRenderingContext2D, x: number, y: number, ex: number, ey: number, w: number, part: PartImage, white: boolean, facing: number, topExtend = 0) {
  const dx = ex - x, dy = ey - y;
  const len = Math.hypot(dx, dy) || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(-dx, dy));
  ctx.scale(facing, 1);
  // 源矩形取**内容包围盒**，横向也裁（parts.ts 的 left/right）。原来横向取整幅 naturalWidth，
  // 后果是素材四周留白多少直接决定画出来的身体有多宽：160 的框里 124 的内容，实际只铺到
  // 40*124/160=31 逻辑单位，比程序化躯干的 TORSO_W=38 明显窄一截。更糟的是头部缩放是拿
  // **躯干内容宽**反推的，两个口径不一致，于是 recut.py 里得挂一个 fill=0.80 的常量去凑——
  // 同一个根因被绕了两次。裁了之后 w*2 就是躯干真实宽度，头躯比例才真的是同一个。
  const { top, bottom, left, right } = part;
  const sw = Math.max(1, right - left), sh = Math.max(1, bottom - top);
  // topExtend：把这一块往上伸出一截（肩头的三角肌），底端仍落在骨段末端。
  // 伸出去的量与块的自然长度对应，宽高比不变——只是这块的**支点**在下面那截。
  const dy0 = -topExtend, dh = len + topExtend;
  if (white) drawWhitePart(ctx, part, left, top, sw, sh, -w, dy0, w * 2, dh);
  else ctx.drawImage(part.img, left, top, sw, sh, -w, dy0, w * 2, dh);
  ctx.restore();
}

/**
 * 把部件图的一段裁片染成纯白（保留 alpha），结果画到 (dx,dy,dw,dh)。
 *
 * **不能在主画布上做这件事。** 原来这里是 `drawImage` 之后叠一层
 * `globalCompositeOperation='source-atop'` + `fillRect`，看着像"只染到贴图已有像素上"——
 * 其实不是：`source-atop` 的定义是"新内容只画在**目标**不透明的地方"，而目标是**整块画布**，
 * 画布早被关卡背景铺满了。于是那个 fillRect 覆盖的整片挂载框**全都是不透明的**，
 * 白块直接填满整个框，素材真正的轮廓被彻底盖掉。
 *
 * 屏幕上就是：挨一下，躯干变成一块白方、头变成一块白方，只有四肢（走 fillTapered、
 * 直接填 #fff、不叠这层）是对的——玩家报的是"被击倒的时候角色变成白框"。
 * 倒地那一击最容易注意到，是因为击倒招的判定框大、白闪正好叠在姿势变化最明显的地方。
 *
 * 正确做法是让"目标"只包含这张图：画到离屏上，在**离屏内部**用 source-in 染色，
 * 再把结果贴回主画布。整帧只借一块、按素材尺寸复用，不随角色数增长。
 */
let flashCanvas: HTMLCanvasElement | null = null;
let flashCtx: CanvasRenderingContext2D | null = null;

function drawWhitePart(
  ctx: CanvasRenderingContext2D, part: PartImage,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
) {
  const plain = () => ctx.drawImage(part.img, sx, sy, sw, sh, dx, dy, dw, dh);
  if (typeof document === 'undefined') { plain(); return; }   // 非浏览器环境（单测）
  if (!flashCanvas) { flashCanvas = document.createElement('canvas'); flashCtx = flashCanvas.getContext('2d'); }
  const c = flashCtx;
  // getContext 返回 null（画布数量/内存吃紧时手机 Safari 会）时退回直接画原图：
  // 白闪这一帧看得见颜色，但不会崩，更不会画出一个白方块。
  if (!c || !flashCanvas) { plain(); return; }
  if (flashCanvas.width < sw || flashCanvas.height < sh) {
    flashCanvas.width = Math.max(flashCanvas.width, sw);
    flashCanvas.height = Math.max(flashCanvas.height, sh);
  }
  c.globalCompositeOperation = 'copy';
  c.drawImage(part.img, sx, sy, sw, sh, 0, 0, sw, sh);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#fff';
  c.fillRect(0, 0, sw, sh);
  c.globalCompositeOperation = 'source-over';
  ctx.drawImage(flashCanvas, 0, 0, sw, sh, dx, dy, dw, dh);
}

/** 沿骨骼自身方向（(x,y)→(ex,ey) 的连线）延长线段两端，让贴图挂载"重叠"而非"贴边"——两张
 * 独立裁切的素材边缘再干净，严丝合缝地对接到同一行也容易露一条极细的背景缝，各自沿骨骼轴向
 * 留一点重叠余量，上层素材的边缘就能盖住下层，缝隙无处可露（管线文档：切件本来就要求切口留
 * 10% 重叠余量）。只延长端点、不改角度——方向完全取自原始的两点连线，lean/朝向都照常生效。 */
export function extendSeg(x: number, y: number, ex: number, ey: number, startExt: number, endExt: number): [number, number, number, number] {
  const dx = ex - x, dy = ey - y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return [x - ux * startExt, y - uy * startExt, ex + ux * endExt, ey + uy * endExt];
}

export const TAPER = 0.55; // 关节端→末端的收分比例，水墨笔锋的锥度
const TORSO_W = 38; // 躯干肩端宽度（直径）：明显大于头部直径 32，撑出宽肩窄腰的武人轮廓
/**
 * 四肢各段的半径（逻辑单位）。**相邻两段必须接上**：前一段的末端半径 = 后一段的起点半径。
 *
 * 不接上的话，关节处会有一级台阶——粗的一截突然从细的一截里冒出来，轮廓线上多一个折角。
 * 那是"关节看起来不正常"最直接的一处（实测膝盖：大腿收细到 3.6，小腿从 5.5 起步，
 * 左边缘跳一级，像接错的一节）。
 *
 * 数字的来历：肩 11 宽 → 肘 8 宽 → 腕 5 宽；髋 13 宽 → 膝 10 宽 → 踝 6 宽。
 * 腕/踝那几像素正好让手与脚"长在"末端而不是"挂"在末端。
 */
export const LIMB_R = {
  upperArm: [5.5, 4.0] as const,   // 肩 → 肘
  foreArm: [4.0, 2.5] as const,     // 肘 → 腕
  thigh: [6.5, 5.0] as const,       // 髋 → 膝
  shin: [5.0, 3.0] as const,        // 膝 → 踝
};
/**
 * 后侧手臂的横向偏移（逻辑单位，朝后）。**远侧手臂必须露出来**：
 * 躯干宽 40，后臂宽 11，同根同向画就整根埋在躯干里——画面上就是"只有一只手"。
 * 偏 17 之后，后臂从躯干的**后缘**探出来（肩那一端仍压在躯干后面），手与小臂露在体侧。
 */
/**
 * 后侧（背向镜头的那条）手臂的横向偏移：往**画面右边**让开中轴。
 *
 * 画面右边是身体背向镜头的那一侧（见 NEAR_ARM_DX 的说明：头与躯干都是 3/4 侧身朝右，
 * 近侧在画面左）。后臂画在躯干**之前**（被身体盖住），肩那一端藏进衣服里，
 * 到腰（衣服收窄）才从背侧探出来——这才是 3/4 视角里后臂该有的样子。
 * 原来它偏在 -17，也就是画面左、**近侧**那一头：后臂从近肩的位置探出来，
 * 与近臂挤在同一侧，近臂反而横穿胸口——两侧都错了。
 *
 * 17 → 14：上臂肩端的半径是 5.5，偏 17 时那半截肩会探出衣服后缘 2.5 单位，
 * 画面上就是背上一个圆包（十二个人都背着一个）。偏 14 时整条后臂藏在衣服里，
 * 到腰才露出来。
 */
const FAR_ARM_DX = 14, FAR_ARM_DY = 2;
/**
 * 近侧（朝向镜头的那条）手臂的肩点：贴在身体的**近肩**上，横向让开身体中轴。
 *
 * 朝向是从素材量出来的，不是拍的：**头是统一的 3/4 侧脸朝右**（鼻尖朝画面右、
 * 可见的耳朵在画面左），躯干十张的臂孔也都在画面左——画面左边就是身体朝向镜头的
 * 那一侧（近侧），右边是背。
 *
 * 原来前臂的肩点钉在中轴（也就是脖子底下），于是这条手臂从下巴出发、斜穿整片胸口——
 * 十二个人胸口上都横着一条淡色手臂，像一件贴上去的独立物件，而不是长在身上的一条胳膊
 * （四肢是程序化的圆柱、躯干是画出来的 3/4 侧身衣服，两者接不接得住全看肩点落在哪）。
 * 往后偏 12（torso 半宽 20 的六成）之后，手臂从衣服的**臂孔**里长出来，垂在体侧。
 * 纵向取 -4：与颈点同高，肩关节藏在肩线（躯干贴图上缘，NECK_OVERLAP 之上那 8 单位）之下，
 * 不会被画到肩线外面去。
 */
const NEAR_ARM_DX = 13.5, NEAR_ARM_DY = 4.5;   // 兜底值：实测十二人的中位数（量自躯干素材）
// 贴图躯干挂载半宽（原来是 drawBoneImg 调用里的裸 20）。导出给测试用同一个数，不在
// tests/renderer.test.ts 里另抄一份——抄一份的话渲染这边改了宽度，测试量的还是旧数字。
export const TORSO_MOUNT_HALFW = 20;

// Task 29 接缝重叠量（逻辑单位）。头贴图现在按颈点（shY-NECK_LEN=shY-4）对齐底边，裁掉素材
// 自身留白后底边就落在 shY-4——纯几何量，不随素材变。NECK_OVERLAP 必须 > 4 才能让躯干顶边
// 盖过头部底边、真正重叠而非贴边；多出来的部分反正被后画的头挡住，不会露出拉伸痕迹。躯干裁
// 掉留白后底边已经精确落在髋点，WAIST_OVERLAP 只是防抗锯齿边缘漏色的保险量，不需要很大。
export const NECK_OVERLAP = 8;
export const WAIST_OVERLAP = 4;

// Task 31：NECK_OVERLAP 只沿骨骼轴向补量，lean=0 时够用——但躯干是绕髋点整体旋转的
// （shX/shY 随 p.lean 摆动），头却在 Task 29 里钉死不转，两者的接合线一个在转一个不转，
// lean 越大楔形缺口越大（idle/walk 的小 lean 看不出来，rush/slam 这类前倾攻击帧才露馅）。
// NECK_LEN/CHIN_OFFSET 是 headAnchor() 里量出来的常量：lean=0 时 headAnchor 与旧公式
// （shX+facing*4, shY-20）完全重合，静止姿态一像素不差；旋转补偿只在 lean≠0 时才生效。
//
// 头部贴图挂载方形的边长本身不需要跟着放大——躯干顶边缺口相对头方形中心的偏移量只由
// "头有没有转到跟躯干同一个角度"决定，不受方形边长影响（把方形边长两端同时加大 ΔS，
// 静止姿态和前倾姿态的缺口会同步各自变松 ΔS，两者之间的差值纹丝不动）。真正能收窄
// "前倾比静止更差多少"这个差值的，只有 HEAD_LEAN_FOLLOW 本身——越接近 1（头跟躯干
// 等角度转），前倾姿态跟静止姿态的接缝就越接近同一种状态。取 0.95 时，见
// tests/renderer.test.ts 的楔形缺口扫描测试，全部 motion/帧/朝向下前倾都不比静止差
// 超过 0.5 个逻辑单位（多数在 0.35 以内，钝角残余来自 crouch 项——shY 里 +crouch*0.2
// 那一项不是纯旋转，crouch 和 lean 同时变化的招式会有极小的额外误差，0.95 而不是 1.0
// 是为了在"越接近刚性、误差越小"和"真实脖子不会跟身体等角度转"这两者间留一点余地）。
const HEAD_LEAN_FOLLOW = 0.95;
/** 颈点到肩点的距离，沿骨骼方向。贴图头以此点为**底边中点**向上生长；程序化圆头再往上
 * 抬一个半径当圆心，lean=0 时圆心回到旧的 shY-20，静止姿态一像素不差。 */
const NECK_LEN = 4;
/** 颈点垂直于骨骼方向的偏移（下巴前推）。原值 4 是给各向同性的圆头调的——圆怎么挪都还是圆，
 * 看不出偏心；换成真脸就变成"头没长在脖子上"，是头身分离最直接的一项。收到 1。 */
const CHIN_OFFSET = 1;
/** 没有躯干贴图可参照时，头的目标高度（逻辑单位）——等于旧的 32×32 方框高度 */
// 头贴图的目标高度（逻辑单位，颈点往上）。骨架是同一副，头就该是同一个大小，
// 角色差异体现在脸的画法、冠饰、发型上，不该体现在头有多大。
// 40 对应头占身高 40/162 ≈ 24.7%——十二个人共用一副骨架，头一样大才说得通。
const HEAD_TARGET = 40;

/**
 * 头贴图的像素→逻辑缩放：**内容盒高就是头高**。
 *
 * 新一版素材的契约是"头填满画幅"（scripts/head-art.json），实测十一个人的内容盒高
 * 是 123~124 像素（几乎一样）——内容盒高因此就是头本身的高度。
 * 于是归一只剩一条锚：把头缩到同一个逻辑高度，头占身高的比例就自然齐了
 * （实测离散度 1.17，头高 38~47 的散布全部来自角色特质倍率）。
 *
 * 此前用"脸的几何平均"当尺子，是因为旧素材是**渐隐的半身像**——内容盒里肩胸占了一截，
 * 盒高不等于头高，只能退而用脸去量。新素材不再需要那把尺子。
 *
 * 脸仍然要量，但只用于**两件事**：脸在整幅里的横向位置（挂点，见 headMountDx）
 * 与下巴到整幅底边的那一段（脖子要伸多远才够到下巴，见 chinGapOf）。
 *
 * 导出给测试用同一条式子，不在测试里另抄一份。 */
export function headScale(head: PartImage): number {
  return HEAD_TARGET / Math.max(1, head.bottom - head.top);
}

/**
 * 头在屏幕上的横向挂点：**按脸挂，不按整幅挂**。
 *
 * 头贴图是「脸 + 装饰」，而飘带、翎羽、帽翅这些装饰全都长在**左边**——
 * 量出来的脸心比整幅中心偏右 6~31 像素（哪吒 23、悟空 28.5、白骨精 31.5）。
 * 按整幅居中挂到颈点，脸就被推到身体中轴右边 2~10 像素：脖子接在**耳朵**那一侧，
 * 头看着就「不在身体上」，头与双手也再不是一对。
 *
 * 改按脸心对齐颈点，装饰就甩到身侧去了（哪吒那条混天绫拖在身后，正该如此）。
 * 返回的是整幅中心相对颈点的偏移（逻辑单位，正=脸在右边）。
 */
export function headMountDx(head: PartImage, face: [number, number, number, number] | undefined, scale: number): number {
  if (!face) return 0;
  const boxCtr = (head.left + head.right) / 2;
  const faceCtr = face[0] + face[2] / 2;      // face 是**整幅图的绝对坐标**，别再叠一次 head.left
  return (faceCtr - boxCtr) * scale;
}

/**
 * 下巴到头贴图底边的那一段（逻辑单位）——**脖子要多伸这么长才够到下巴**。
 *
 * 头贴图是半身像，下缘渐隐（哪吒那件从 0.34 淡到 0），而下巴在整幅底边之上 4~16 像素
 * （猪八戒的肖像里连胸口都有）。脖子原先只伸到固定高度，下巴与脖子之间就露出一截背景，
 * 头和颈看着是断开的两截。多伸的这一截正好被头贴图自己的衣领盖住。
 */
export function chinGapOf(head: PartImage, face: [number, number, number, number] | undefined, scale: number): number {
  if (!face) return 0;
  const faceBottom = face[1] + face[3];   // 脸底（下巴）在**整幅图**里的位置（绝对坐标）
  return Math.max(0, (head.bottom - faceBottom) * scale);
}
const HEAD_R = 16; // 程序化圆头半径

/**
 * 颈部锚点：沿骨骼方向（肩点→颈部延长线）挂载，随 lean 摆动到与躯干顶边同一位置，
 * 而不是像 Task 29 那样钉在 shY-20 不转——这是本任务修复"头和身子间隙"的几何核心。
 * angle 只用于贴图头的 ctx.rotate（部分跟随，HEAD_LEAN_FOLLOW<1），程序化圆头不读它
 * （圆本身各向同性，不需要转,也转不出视觉差异）。facing 已经在 lean 的 sin/cos 分量里
 * 处理过镜像，angle 额外乘一次 fc 是因为它要在 drawBoneImg 同款的
 * "先 rotate（世界系）再 scale(fc,1)（镜像贴图内容）" 顺序里使用——不乘 fc 的话，两侧
 * 朝向会转向同一个屏幕方向，而不是各自转向自己前倾的那一侧。
 */
export function headAnchor(shX: number, shY: number, lean: number, fc: number): { cx: number; cy: number; angle: number } {
  const ux = Math.sin(lean) * fc, uy = -Math.cos(lean); // 骨骼延长线方向（肩→头顶）
  const vx = Math.cos(lean) * fc, vy = Math.sin(lean);  // 垂直于骨骼方向（下巴前推）
  return {
    cx: shX + ux * NECK_LEN + vx * CHIN_OFFSET,
    cy: shY + uy * NECK_LEN + vy * CHIN_OFFSET,
    angle: lean * HEAD_LEAN_FOLLOW * fc,
  };
}

/**
 * 近侧手臂的肩点（屏幕上）。躯干贴图是 3/4 侧身的衣服，近肩在画面左侧；
 * 肩点往那边挪，手臂才是从肩膀长出来的（见 NEAR_ARM_DX 的说明）。
 * 导出给测试与探针：量与画必须走同一条路径。
 */
export function nearArmAnchor(
  shX: number, shY: number, fc: number, dx = NEAR_ARM_DX, dy = NEAR_ARM_DY,
): [number, number] {
  return [shX - dx * fc, shY + dy];
}

/**
 * 后侧手臂的肩点（屏幕上）。与 nearArmAnchor 是一对：**同一个肩点只能有一处定义**——
 * 解算后臂角度的地方与画后手的地方各抄一份的话，两边会差一整个偏移量，
 * 画面上就是"手握上了却离杆二十几像素"（这坑真的踩过）。
 */
export function backArmAnchor(shX: number, shY: number, fc: number): [number, number] {
  return [shX + FAR_ARM_DX * fc, shY + FAR_ARM_DY];
}

/** 关节粗、末端细的锥形笔触路径：两端各带半圆帽，撑出笔锋起收笔的圆润感。
 * 两个 arc 必须走 anticlockwise（true）——不然帽子朝内折回体内而非朝外鼓起，
 * 路径会在端点处自相交，nonzero 填充规则在自交区域算出卷绕数 0，抠出一个洞，
 * 就是关节处那个"黑洞"的成因（洞里透出来的是洞下面早画好的暗色地面）。
 *
 * capStart=false 时**不画起点那道半圆弧、也不 closePath**：于是路径只描两条侧边加末端
 * 圆帽，起点处不落墨。填充时永远要圆帽（否则接缝处是个平切的口子），描边时才用这一档。 */
function taperedPath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r1: number, r2: number, capStart = true) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const perp = angle + Math.PI / 2;
  const cp = Math.cos(perp), sp = Math.sin(perp);
  ctx.beginPath();
  ctx.moveTo(x1 + cp * r1, y1 + sp * r1);
  ctx.lineTo(x2 + cp * r2, y2 + sp * r2);
  ctx.arc(x2, y2, r2, perp, perp + Math.PI, true);
  ctx.lineTo(x1 - cp * r1, y1 - sp * r1);
  if (capStart) {
    ctx.arc(x1, y1, r1, perp + Math.PI, perp + Math.PI * 2, true);
    ctx.closePath();
  }
}

/** 光从左上斜上方来（屏幕系，未归一化，取用时只用它的方向）。
 *
 * 四肢是圆柱，柱面的亮度只取决于**法线与光的夹角**，跟圆柱自己转到哪儿无关——所以
 * 高光必须按骨轴两侧解算，不能按"世界坐标上/下"平涂。竖着的一根腿和横着的一根腿，
 * 高光各自落在该落的那一侧；这一条是下面 limbGrad 的立身之本。 */
const LIGHT = { x: -0.34, y: -0.94 };

/** 明暗差的**下限**。真实光照算下来，竖直肢体两侧的落差只有 0.34（光照方向几乎与
 * 骨轴平行），照实画等于还是平涂——而角色在屏幕上只有 150px 高、肢体宽 9px，本来
 * 就没有余量去表现 Lambert 衰减。所以给一个下限：骨轴转到任何角度，受光侧与背光侧
 * 的明暗差都不小于这个值。圆柱感在小尺寸下靠的是这个差值，不是物理正确。 */
const MIN_ROUND = 0.62;

/** 沿骨轴两侧的柱体渐变：一根肢体从平涂色管变成有明暗面的圆柱。
 *
 * 十二个人的头和躯干都是画出来的厚描边厚涂素材，只有四肢走程序化——此前四肢是一根
 * 平涂的色管贴在有块面阴影的躯干旁边，读起来像"贴上去的纸片手脚"而不是同一个人身上
 * 长出来的。这道横向渐变就是把两边统一到同一套上色语汇上，成本只有一次渐变。
 *
 * 渐变的两个端点都取在骨轴上：等值线与骨轴平行，所以沿整根肢体亮度恒定，
 * 起点坐标用 x1/y1 与用中点结果相同。
 */
function limbGrad(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, base: string) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const vx = -dy / len, vy = dx / len;          // 垂直于骨轴
  // 可见的两条轮廓边分别对应法线 +v 与 -v，亮度就是 ±dot(v, 光)。取绝对值下限，
  // 符号决定哪一侧受光——用 dot 而不是比较 vy 的大小，是为了跨过"骨轴竖直"那一刻
  // 不会突然翻面（一帧亮一帧暗地闪）。
  const dot = vx * LIGHT.x + vy * LIGHT.y;
  const k = (dot < 0 ? -1 : 1) * Math.max(Math.abs(dot), MIN_ROUND);
  const r = (w / 2) * k;
  const g = ctx.createLinearGradient(x1 + vx * r, y1 + vy * r, x1 - vx * r, y1 - vy * r);
  g.addColorStop(0, shade(base, 24));
  g.addColorStop(0.52, base);
  g.addColorStop(1, shade(base, -26));
  return g;
}

/**
 * 轮廓线颜色：把肢体本色朝墨蓝混一混。
 *
 * 十二张躯干 + 十一张头的描边逐张量过（`design-preview/measure-outline2.py`：从轮廓边向内
 * 走到内部平涂色为止，量这一段的宽度）：**0.50~2.25 逻辑单位，中位 1.25**。
 * 四肢此前描 2，本来就只是偏厚一点，**不是"粗了四倍"**——我第一版量出来的
 * "0.3~0.5、粗四倍"是判据坏了的结果（那版按"暗色连续段"数像素，对哪吒直接测不出值，
 * 一件没测出来就该怀疑判据而不是结论）。
 *
 * 真正的原因是**颜色不是一路**：素材描边不是墨蓝，是**同色系压深**的轮廓线
 * （哪吒是暗红、悟空是深金、铁扇是墨青、二郎是深蓝）。那圈硬邦邦的墨蓝边线贴在同色系的
 * 躯干旁边，就是"这是贴上去的"这种观感的主要来源——**比粗细更扎眼**。
 *
 * 混向墨蓝而不是 `shade(-90)` 直接压暗：压暗会把本来就暗的底色糊成纯黑、丢掉轮廓；
 * 混过去则保留角色自己的色相，同时拿到足够暗的边。
 */
function contourOf(base: string): string {
  return mixC(base, INK.ink, 0.62);
}

/** 四肢轮廓线宽度（逻辑单位）。素材描边中位 1.25（见 contourOf 上面的量法），
 * 原来这里描 2，是整幅画面里最粗的一圈边；收到 1.5 是向素材中位靠拢，
 * 同时仍留得住边——四肢只有 9~13 宽，真按躯干那个比例取会细到直接糊进背景
 * （关卡背景大半是暗的），所以不去追求完全相等。 */
const LIMB_STROKE = 1.5;

/** 填充当前 fillStyle 的锥形笔触，再描一圈轮廓细边让肢体从背景里立起来；
 * 受击白闪时跳过描边——整体已经是纯白，深色边线反而破坏"整体转白"的效果。
 *
 * capStart 透传给描边那一档：见 taperedPath 的注释——省略起点圆帽是为了消掉关节处
 * 那道横贯的黑带（肘、膝上最显眼）。省掉是安全的，因为起点一定被**下一段更粗的
 * 骨段或躯干**整个盖住：上臂末端半径 3.0 而小臂起点半径 4.5、大腿末端 3.6 而小腿起点
 * 5.5、肩髋起点则整个在躯干图之下。
 *
 * base 是这一节的**平涂本色**：填充用的是渐变（从渐变里读不出底色），描边色得另算一份，
 * 所以由调用方显式传进来。
 */
function fillTapered(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r1: number, r2: number, white: boolean, capStart = true, base = '#000') {
  taperedPath(ctx, x1, y1, x2, y2, r1, r2);     // 填充要圆帽：起点被平切的话接缝处是个口子
  ctx.fill();
  if (!white) {
    taperedPath(ctx, x1, y1, x2, y2, r1, r2, capStart);
    ctx.strokeStyle = contourOf(base);
    ctx.lineWidth = LIMB_STROKE;
    ctx.stroke();
  }
}

/** 球面渐变：锤头、金箍这类圆件。受光点沿 LIGHT 偏出去，与四肢的高光同一个方向，
 * 免得兵器是"别处打光"的。原来它们是一枚平涂的圆片，读起来像贴在杆上的贴纸。 */
function ballGrad(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, base: string) {
  const g = ctx.createRadialGradient(cx + LIGHT.x * r * 0.5, cy + LIGHT.y * r * 0.5, r * 0.12,
    cx, cy, r * 1.2);
  g.addColorStop(0, shade(base, 34));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -30));
  return g;
}

/**
 * 手。骨段是水墨笔锋（TAPER=0.55），前臂 9px 收到末端只剩 5px 的一个尖——
 * 而兵器恰好从这个尖上长出去，于是整条胳膊读起来是**一根鞭子**，不是"手握着兵器"；
 * 前臂又画成 accent 色（和身体不同的浅色），那根"鞭子"还格外显眼。
 * 补一颗手：笔锋照旧收尖，尖上多一个握着的东西，胳膊就有了终点。
 *
 * 画在兵器**之后**——手压在杆上才是握住；画在之前会被杆盖掉，等于没加。
 * 有美术贴图时不画：那时手已经在图里了，再叠一个圆是两只手。
 *
 * 四种手：拳（默认）/ 爪 / 掌 / 骨手。手是隔着屏幕认人的第一眼——比脸还小，但它一直在动，
 * 而十二个人此前全是同一颗圆，读起来就像同一副假人换了身衣服。
 */
function drawHand(
  ctx: CanvasRenderingContext2D, at: [number, number], fill: string, white: boolean,
  kind: 'fist' | 'claw' | 'paw' | 'bone' = 'fist',
) {
  if (kind === 'claw') {
    // 爪：三根锥形指从腕上张开，猴王的手
    ctx.fillStyle = white ? '#fff' : fill;
    ctx.beginPath(); ctx.arc(at[0], at[1], 4.4, 0, Math.PI * 2); ctx.fill();
    for (const a of [-0.66, 0, 0.66]) {
      const ex = at[0] + Math.sin(a) * 9, ey = at[1] + Math.cos(a) * 9;
      fillTapered(ctx, at[0], at[1], ex, ey, 1.7, 0.5, white, true, fill);
    }
    return;
  }
  if (kind === 'bone') {
    // 骨手：三根细骨，白骨精的手（没有肉）
    ctx.strokeStyle = white ? '#fff' : shade(fill, 22);
    ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    for (const a of [-0.52, 0.04, 0.56]) {
      ctx.beginPath();
      ctx.moveTo(at[0], at[1]);
      ctx.lineTo(at[0] + Math.sin(a) * 8.5, at[1] + Math.cos(a) * 8.5);
      ctx.stroke();
    }
    return;
  }
  if (kind === 'paw') {
    // 掌：宽厚的一只厚爪，猪八戒
    ctx.fillStyle = white ? '#fff' : fill;
    ctx.beginPath(); ctx.ellipse(at[0], at[1], 7.6, 6.4, 0, 0, Math.PI * 2); ctx.fill();
    if (!white) { ctx.strokeStyle = contourOf(fill); ctx.lineWidth = LIMB_STROKE; ctx.stroke(); }
    ctx.fillStyle = white ? '#fff' : shade(fill, -24);
    for (const a of [-0.52, 0, 0.52]) {
      ctx.beginPath();
      ctx.arc(at[0] + Math.sin(a) * 5.4, at[1] + Math.cos(a) * 4.8, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // 半径 6.6：5.2 那版**在实机上认不出是手**——前臂末端本来就有 5px 的笔锋，
  // 两者一样粗时读成"笔锋收了个圆头"，而不是"这里有只手"。手要比它握的那截明显粗一圈。
  ctx.fillStyle = white ? '#fff' : fill;
  ctx.beginPath();
  ctx.arc(at[0], at[1], 6.6, 0, Math.PI * 2);
  ctx.fill();
  if (!white) {
    ctx.strokeStyle = contourOf(fill); ctx.lineWidth = LIMB_STROKE; ctx.stroke();
    // 指缝。原来是一道**横贯整个圆的墨色横杠**——在这个尺寸下那道杠比圆还抢眼，
    // 读出来是"兵器杆上套了个垫圈"，不是手。改成掌缘两道短弧、且用手指自身的暗色
    // （而不是墨色）描：远看是一道若隐若现的指节线，近看才读得出攥着。
    ctx.strokeStyle = shade(fill, -78);
    ctx.lineWidth = 1.3;
    for (const r of [4.5, 2.0]) {
      ctx.beginPath();
      ctx.arc(at[0], at[1], r, -0.72, 0.72);
      ctx.stroke();
    }
  }
}

/**
 * 脚。从小腿末端朝前方长出来的一段楔子。
 *
 * 此前腿是一根收尖的笔锋直接怼到地面线上——两根插进地面的柱子，读起来像角色被钉在
 * 那里，而不是站在那里；一脚踢出去也还是一根棍子。补一只脚之后，静态的重心、
 * 出招时蹬地的方向感都出来了，成本是一个闭合路径。
 *
 * 脚掌是**水平**的、不跟小腿一起转：那是"踩在地上"读法的来源，屈膝时它就该保持平。
 * 空中翻整圈时脚会随人物整体旋转（roll 是绕髋的刚体变换），此时读作收脚蜷腿，成立。
 */
function drawFoot(ctx: CanvasRenderingContext2D, at: [number, number], facing: number, fill: string, white: boolean) {
  const [x, y] = at;
  // 脚掌只有 8px 高、15px 长。第一版给了 14 高 × 16 长，出来是两块方砖——脚在
  // 150px 的角色身上只占很小一块，比例上按"小腿一半粗"去画就已经太大了。
  const BACK = 4.5, FWD = 11, TOP = 2.8, BOT = 5.2;   // 跟后伸 / 尖前探 / 踝上 / 踝下
  const boot = shade(fill, -14);                     // 压暗一档：读作鞋，不是袜子
  ctx.fillStyle = white ? '#fff' : boot;
  ctx.beginPath();
  ctx.moveTo(x - facing * BACK, y - TOP);
  ctx.lineTo(x + facing * FWD, y - TOP * 0.45);
  ctx.quadraticCurveTo(x + facing * (FWD + 1.5), y + BOT * 0.55, x + facing * (FWD - 2), y + BOT);
  ctx.lineTo(x - facing * (BACK + 1), y + BOT);
  ctx.closePath();
  ctx.fill();
  if (!white) {
    ctx.strokeStyle = contourOf(boot); ctx.lineWidth = LIMB_STROKE; ctx.stroke();
  }
}

/** 角色脚下的地面投影：宽度随 def.width，透明度随离地高度衰减，画在角色之前、地面之后。
 *
 * 用径向渐变而不是平涂椭圆。平涂那版两头一样黑：暗关卡上等于没画（地板本来就是黑的），
 * 亮关卡上是一枚边缘生硬的黑色补丁。径向渐变中心实、四周淡开，两种背景上都成立。
 *
 * 影子分两摊：外圈那摊大的软影管"他在那儿"，中间那摊小的接触影管"他**站着**"——
 * 没有接触影的时候，角色读起来像是浮在地面上方一寸（尤其跳跃落地的瞬间）。
 */
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const t = Math.max(0.15, 1 - y / 150);
  const w = width * 0.9 * (0.7 + t * 0.3);
  const g = ctx.createRadialGradient(x, FLOOR_Y, 0, x, FLOOR_Y, w / 2);
  g.addColorStop(0, `rgba(0,0,0,${0.34 * t})`);
  g.addColorStop(0.62, `rgba(0,0,0,${0.2 * t})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, FLOOR_Y, w / 2, w / 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // 接触影：脚底一小块，更实更小
  const cw = w * 0.36;
  const cg = ctx.createRadialGradient(x, FLOOR_Y, 0, x, FLOOR_Y, cw);
  cg.addColorStop(0, `rgba(0,0,0,${0.46 * t})`);
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(x, FLOOR_Y, cw, cw / 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 角色背后的光晕：把他从背景里托出来。
 *
 * 夜里角色的深色衣服（哪吒的红、钟馗的紫）跟夜色几乎同色，不打这道光，角色就像贴在
 * 背景上的一张纸。街机格斗里角色的可读性大半靠这层背光——月亮从他背后打过来，
 * 轮廓上就有一圈晕。
 *
 * 用场景自己的光源色（天体色）——同一关里所有人被同一盏光照，十二关之间也各有各的光。
 * 走 'lighter' 叠加：它是"加上去的光"，不是"盖上去的一块色"。
 */
function drawBacklight(ctx: CanvasRenderingContext2D, x: number, feetY: number, color: string) {
  const cy = feetY - 72;
  const g = ctx.createRadialGradient(x, cy, 12, x, cy, 130);
  g.addColorStop(0, hexAlpha(color, 0.16));
  g.addColorStop(0.55, hexAlpha(color, 0.07));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, cy, 130, 142, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 脖子：头与躯干之间那一小段。
 *
 * **他们此前根本没有脖子**，于是头看着像浮在身上。根因不是挂载算错，是**躯干贴图的上缘是
 * 透明的**：领口画在贴图的上边以下（哪吒那件是 V 领），于是头贴图的底边与领口之间总会露
 * 一线背景——实测 4 个逻辑单位，正好是那条缝。
 *
 * 补一段脖子，缝就没了，角色也终于有脖子。颜色取 accent：那本来就是程序化圆头用的颜色，
 * 也就是这个角色在这套画法里的"肤色"（十二个人的 accent 都是肤色调或骨白）。
 *
 * 画在躯干之后、头之前：脖子压在肩膀上、头压在脖子上。
 *
 * **上端必须够到下巴**：头贴图是半身像，下缘是渐隐的（哪吒那件从 0.34 一路淡到 0），
 * 而下巴在整幅底边之上 4~16 像素（猪八戒的肖像里连胸口都有）。脖子若只伸到固定高度，
 * 下巴与脖子之间就露出一截背景——**头和颈看着是断开的两截**（玩家报的就是这个）。
 * `chinGap` 就是下巴到头贴图底边的那一段，脖子多伸这么长，缝就没了；
 * 多出来的一截正好被头贴图自己的衣领盖住（头画在脖子之后）。
 */
function drawNeck(
  ctx: CanvasRenderingContext2D, shX: number, shY: number, lean: number, fc: number,
  accent: string, white: boolean, chinGap = 0,
) {
  const ux = Math.sin(lean) * fc, uy = -Math.cos(lean);   // 躯干轴向（肩→头顶）
  // 上端伸进头里 5，再多伸下巴到头贴图底边的那一段；下端伸进躯干里 3：
  // 两头都藏进去，才不会在任一端露线。
  const topX = shX + ux * (NECK_LEN + 5 + chinGap), topY = shY + uy * (NECK_LEN + 5 + chinGap);
  const botX = shX - ux * 3, botY = shY - uy * 3;
  ctx.fillStyle = white ? '#fff' : accent;
  // 上细下粗：脖子在肩膀处比在颌下宽（斜方肌），上下反过来就成了"塞进去的萝卜"。
  // **半径要小**：8~11 单位的脖子在 40 宽的身体上就是一根柱子，压在胸口上像围脖；
  // 6~9 才像脖子。
  fillTapered(ctx, topX, topY, botX, botY, 3.2, 4.4, white, true, accent);
}

/**
 * 从**躯干贴图**上取两个颜色：近肩（手臂插进去的地方）与颈口（脖子接的地方）。
 *
 * 为什么不用调色板里的颜色：手臂与脖子是**程序化圆柱**，躯干是画出来的衣服，
 * 两者的颜色对不上，画面上就是"一件贴上去的色块"——钟馗的紫灰手臂压在朱砂袍上、
 * 铁扇的薄荷绿手臂压在青衣上、红孩儿的粉手臂压在红衣上，都是这一条。
 * accent 也不对：十二个人里有一半的 accent 是**近白**（铁扇 #eef3ea、后羿 #f2efe6…），
 * 拿它画手臂等于在身上贴一条白带子；调色板里本来就没有"皮肤"这一项。
 *
 * 直接从素材上量：近肩那块的颜色**正是手臂要接上的那块**，
 * 手臂取它，接口处必然同色——不管美术画的是裸肩（白骨精）、还是铠甲肩（牛魔王、钟馗、刑天）。
 * 颈口同理：脖子取美术那一截脖子的颜色。
 *
 * 量法：把贴图画到离屏 canvas 上，在对应位置取一个小邻域的**众数颜色**
 * （众数而不是均值——均值会被描边和阴影拉灰）。
 */
const torsoColorCache = new WeakMap<HTMLImageElement, { shoulder: string; neck: string; cloth: string }>();

function sampleTorsoColor(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  fx: number, fy: number, r: number,
): string | null {
  // fx/fy 是内容框内的相对位置（0~1），r 是取样半径（内容框宽的比例）
  const cx = fx * W, cy = fy * H, rr = Math.max(2, r * W);
  const x0 = Math.max(0, Math.floor(cx - rr)), x1 = Math.min(W - 1, Math.ceil(cx + rr));
  const y0 = Math.max(0, Math.floor(cy - rr)), y1 = Math.min(H - 1, Math.ceil(cy + rr));
  if (x1 <= x0 || y1 <= y0) return null;
  const d = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 160) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 34 || lum > 246) continue;         // 描边与纯白跳过
    const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    counts.set(key, e);
  }
  if (!counts.size) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null;
  const cr = Math.round(best.r / best.n), cg = Math.round(best.g / best.n), cb = Math.round(best.b / best.n);
  return `rgb(${cr},${cg},${cb})`;
}

/** 一块区域里的主色（出现最多的颜色，按 16 级分桶）。取不到返回 null。 */
function dominantColor(
  ctx: CanvasRenderingContext2D, W: number, H: number, y0: number, y1: number,
): string | null {
  const d = ctx.getImageData(0, Math.floor(H * y0), W, Math.ceil(H * (y1 - y0))).data;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 160) continue;
    const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    counts.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null;
  return `rgb(${Math.round(best.r / best.n)},${Math.round(best.g / best.n)},${Math.round(best.b / best.n)})`;
}

/**
 * 近肩那块**肩头**的中心（内容框里的相对坐标）。
 *
 * 找法不认颜色：肩头是"与衣服不同"的那一块（肤色的圆块、或空的深色袖窿都算），
 * 位置在顶部左侧。先量它的位置，再**在那个位置取色**——
 * 直接在左上角取主色会取到衣服（肩头只占那一小块），手臂就会穿上衣服的颜色，
 * 和肩头之间留一道色阶，看着像贴上去的。
 */
function capCenter(
  ctx: CanvasRenderingContext2D, W: number, H: number, cloth: string | null,
): { cx: number; cy: number } | null {
  const m = cloth && cloth.match(/(\d+),\s*(\d+),\s*(\d+)/);
  const dr = m ? +m[1] : -1, dg = m ? +m[2] : -1, db = m ? +m[3] : -1;
  const TOL = 46;
  const d = ctx.getImageData(0, 0, W, Math.floor(H * 0.28)).data;
  let sx = 0, sy = 0, n = 0;
  const cols = new Map<number, number>();
  for (let y = 0; y < Math.floor(H * 0.28); y++) {
    for (let x = 0; x < Math.floor(W * 0.38); x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 200) continue;
      if (cloth && Math.abs(d[i] - dr) <= TOL && Math.abs(d[i + 1] - dg) <= TOL && Math.abs(d[i + 2] - db) <= TOL) continue;
      sx += x; sy += y; n++;
      cols.set(Math.floor(x / 6), (cols.get(Math.floor(x / 6)) ?? 0) + 1);
    }
  }
  if (n < 30) return null;
  // 最靠左且够大的一档（描边/杂点不算）
  let pick = -1;
  for (const [k, v] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    if (v >= Math.max(8, W * H * 0.004)) { pick = k; break; }
  }
  if (pick < 0) return null;
  let sx2 = 0, sy2 = 0, n2 = 0;
  for (let y = 0; y < Math.floor(H * 0.28); y++) {
    for (let x = pick * 6; x < pick * 6 + 6 && x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 200) continue;
      if (cloth && Math.abs(d[i] - dr) <= TOL && Math.abs(d[i + 1] - dg) <= TOL && Math.abs(d[i + 2] - db) <= TOL) continue;
      sx2 += x; sy2 += y; n2++;
    }
  }
  if (n2 < 8) return null;
  return { cx: sx2 / n2 / W, cy: sy2 / n2 / H };
}

/** 近肩、衣身两处颜色。取不到（没有躯干贴图 / 读像素失败）就退回 fallback。 */
export function torsoColors(part: PartImage | undefined, fallback: string): { shoulder: string; neck: string; cloth: string } {
  if (!part) return { shoulder: fallback, neck: fallback, cloth: fallback };
  const hit = torsoColorCache.get(part.img);
  if (hit) return hit;
  const out = { shoulder: fallback, neck: fallback, cloth: fallback };
  try {
    if (typeof document !== 'undefined') {
      const W = part.right - part.left, H = part.bottom - part.top;
      if (W > 0 && H > 0) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const cctx = c.getContext('2d');
        if (cctx) {
          cctx.drawImage(part.img, part.left, part.top, W, H, 0, 0, W, H);
          const cloth = dominantColor(cctx, W, H, 0.35, 0.65);
          const cap = capCenter(cctx, W, H, cloth);
          if (cap) out.shoulder = sampleTorsoColor(cctx, W, H, cap.cx, cap.cy, 0.035) ?? fallback;
          if (cloth) out.cloth = cloth;
          out.neck = fallback;
        }
      }
    }
  } catch { /* 取不到就用 fallback */ }
  torsoColorCache.set(part.img, out);
  return out;
}

/**
 * **脸的肤色**——从头部贴图上量（脸的框由角色数据给出，取上半部分避开胡子与嘴）。
 * 脖子的颜色要用它：脖子是脸的下半截延续，用别的颜色就会出现"下巴这块颜色变了"。
 */
const faceToneCache = new WeakMap<HTMLImageElement, string>();
export function faceTone(
  head: PartImage | undefined, face: [number, number, number, number] | undefined, fallback: string,
): string {
  if (!head || !face) return fallback;
  const hit = faceToneCache.get(head.img);
  if (hit) return hit;
  let out = fallback;
  try {
    if (typeof document !== 'undefined') {
      const [fx, fy, fw, fh] = face;
      const x0 = Math.max(0, fx), y0 = Math.max(0, fy);
      const w = Math.min(head.img.naturalWidth - x0, fw);
      const h = Math.min(head.img.naturalHeight - y0, Math.floor(fh * 0.55));
      if (w > 4 && h > 4) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const cctx = c.getContext('2d');
        if (cctx) {
          cctx.drawImage(head.img, fx, fy, w, h, 0, 0, w, h);
          out = dominantColor(cctx, w, h, 0, 1) ?? fallback;
        }
      }
    }
  } catch { /* 取不到就用 fallback */ }
  faceToneCache.set(head.img, out);
  return out;
}

/** 一根骨段的两端 */
interface Bone { x1: number; y1: number; x2: number; y2: number }

/**
 * 手臂上的装束：袖口 / 护腕 / 毛边。
 *
 * 光溜溜的锥形色管是"假人"的主因——十二个人此前的手脚是同一条模具出来的，只有颜色不同。
 * 装束是最快的解：给手臂加一件东西，它就属于某个人了。
 * （出四肢贴图是另一条路，但一张图要同时拉伸到上臂与前臂两段长度，细节全被拉没——
 *  这条路的性价比不如在程序化画法上加装束。）
 */
function drawSleeve(
  ctx: CanvasRenderingContext2D,
  kind: 'cuff' | 'bracer' | 'fur' | 'none' | undefined,
  upper: Bone, fore: Bone, w: number, color: string, white: boolean,
  garment: string = color,
) {
  if (!kind || kind === 'none' || white) return;
  if (kind === 'cuff') {
    // 袖口：肘上张开的一截宽袖（铁扇公主的广袖、钟馗的官袍）——这是**衣服**的一截，
    // 用衣服色，不是皮肤色
    const dx = fore.x2 - fore.x1, dy = fore.y2 - fore.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ax = fore.x1 + (dx / len) * 3, ay = fore.y1 + (dy / len) * 3;
    const bx = fore.x1 + (dx / len) * 11, by = fore.y1 + (dy / len) * 11;
    ctx.fillStyle = garment;
    fillTapered(ctx, ax, ay, bx, by, w * 1.05, w * 0.735, false, false, garment);
    return;
  }
  if (kind === 'bracer') {
    // 护腕：前臂中段一道加宽压深的箍（二郎的天眼护腕、后羿的射弓臂）
    const ax = fore.x1 + (fore.x2 - fore.x1) * 0.3, ay = fore.y1 + (fore.y2 - fore.y1) * 0.3;
    const bx = fore.x1 + (fore.x2 - fore.x1) * 0.68, by = fore.y1 + (fore.y2 - fore.y1) * 0.68;
    ctx.fillStyle = shade(color, -46);
    fillTapered(ctx, ax, ay, bx, by, w * 0.675, w * 0.675, false, false, color);
    return;
  }
  // 毛边：沿上臂两侧伸出几撮毛（猴王）
  const dx = upper.x2 - upper.x1, dy = upper.y2 - upper.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  ctx.strokeStyle = shade(color, 26);
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (let i = 0; i <= 3; i++) {
    const t = 0.2 + i * 0.2;
    const px = upper.x1 + dx * t, py = upper.y1 + dy * t;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px + nx * s * w * 0.42, py + ny * s * w * 0.42);
      ctx.lineTo(px + nx * s * (w * 0.42 + 3.6) + dx * 0.07, py + ny * s * (w * 0.42 + 3.6) + dy * 0.07);
      ctx.stroke();
    }
  }
}

/** 只算骨段末端、不绘制。seg() 的几何与它保持一致——两处各写一遍必然漂移。 */
export function segEnd(x: number, y: number, angle: number, len: number, facing: number): [number, number] {
  return [x + Math.sin(angle) * len * facing, y + Math.cos(angle) * len];
}

/**
 * 双手兵器：哪些形制是两只手一起握的。
 *
 * 此前**所有**兵器都只有前手握着——兵器沿前臂方向画出去，后手是另画的一颗手，垂在身侧，
 * 离杆子几十像素。九齿钉耙、如意金箍棒、三尖两刃刀这种长杆兵器现实中都是两手分握
 * 杆上前后两处（否则重心在掌外，一挥就脱手），画面上单手拿长杆兵器读起来是"拿着道具"。
 *
 * 剑与扇是单手兵器（后手垂着才对）；弓是"一手持弓一手拉弦"，另有画法（见 backGrip）。
 */
const TWO_HANDED = new Set(['staff', 'rake', 'glaive', 'mace', 'spear', 'axe']);

/**
 * 两连杆 IK：肩 → 手，臂长 (upper, lower)。解不出（够不着/太近）返回 null。
 *
 * 约定与腿那条一致：骨段方向 = (sin a, cos a)，a=0 垂直向下、a>0 朝角色正面。
 * 手臂的肘弯量是**加**的（腿是减）：armB = [大腿…] 前臂绝对角 = 上臂角 + 肘弯量。
 * 肘挑哪个解：**肘在下**（自然肘位）——两个解里屏幕坐标 y 大的那个。
 */
function armIK(sx: number, sy: number, tx: number, ty: number, upper: number, lower: number): [number, number] | null {
  const dx = tx - sx, dy = ty - sy;
  const d = Math.hypot(dx, dy);
  if (d > upper + lower - 0.5 || d < Math.abs(upper - lower) + 0.5) return null;
  const a = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const mx = sx + dx * a / d, my = sy + dy * a / d;
  const px = -dy / d, py = dx / d;
  const e1: [number, number] = [mx + h * px, my + h * py];
  const e2: [number, number] = [mx - h * px, my - h * py];
  const elbow = e1[1] >= e2[1] ? e1 : e2;         // 肘在下
  const upAng = Math.atan2(elbow[0] - sx, elbow[1] - sy);
  const foAng = Math.atan2(tx - elbow[0], ty - elbow[1]);
  return [upAng, foAng - upAng];
}

/**
 * 后手该落在哪儿：握在兵器的杆上。
 *
 * 双手兵器：后手抓**杆上离后肩最近的那一段**——手里握着杆子，后手总是抓在够得到的最靠后
 *  处；够不到就抓不到（那一条角度不可达，退回姿势里原来的后臂）。
 * 弓：后手拉弦，落在弓身中点沿持弓方向往回拉一段。
 *
 * 返回后臂的两段角度；null = 用姿势里原来的后臂。
 */
function backGrip(
  bshX: number, bshY: number, fElbow: [number, number], fHand: [number, number],
  w: WeaponDef, fc: number,
  upperArm = UPPER_ARM, lowerArm = LOWER_ARM,
): [number, number] | null {
  if (!TWO_HANDED.has(w.kind)) return null;   // 单手兵器：后手垂着才对
  const dx = fHand[0] - fElbow[0], dy = fHand[1] - fElbow[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  // 沿杆往握点后方的距离
  const t = Math.max(13, Math.min(
    (fHand[0] - bshX) * ux + (fHand[1] - bshY) * uy,   // 杆上离后肩最近的那一点
    w.len * w.grip,                                    // 不得越过杆尾
  ));
  const tx = fHand[0] - ux * t, ty = fHand[1] - uy * t;
  // 够不着就够不着：手放开兵器（后臂用姿势里原来的角度），绝不硬掰
  return armIK(bshX, bshY, tx, ty, upperArm, lowerArm);
}

/**
 * 弓：后手拉弦，弦汇到它上面。拉弦的手要拉到颊边（弦才拉得开），
 * 而后手到颊边这一段，恰好让**头落在双手之间**——一手持弓一手拉弦，弓与头是一体的。
 */
const BOW_PULL = 34;

/**
 * 双手兵器的后臂：手落在兵器杆上（或拉弓的弦上），后臂由"手落在哪"反解。
 *
 * 导出给测试与探针——测量与渲染必须走同一条路径，两处各算一遍必然漂移。
 * 返回后臂的两段角度；null = 单手兵器，或那个位置够不着（退回姿势里原来的后臂）。
 */
export function backArmFor(
  p: Pose, x: number, feetY: number, fc: number, w?: WeaponDef,
  build?: CharacterDef['build'], rig?: CharacterRig,
): [number, number] | null {
  if (!w) return null;
  // 纸偶角色用的是**这个人自己的**骨架（臂长、肩点位置都不同），
  // 拿共用骨架去解 IK，解出来的手落点会偏出杆子几十像素。
  if (rig) {
    const a = dollAnchors(x, feetY, p.lean, p.crouch, fc, rig);
    const upperArm = rig.upperArm, lowerArm = rig.lowerArm;
    const fElbow = segEnd(a.nshX, a.nshY, p.armF[0], upperArm, fc);
    const fHand = segEnd(fElbow[0], fElbow[1], p.armF[0] + p.armF[1], lowerArm, fc);
    if (w.kind === 'bow') {
      const dx = fHand[0] - fElbow[0], dy = fHand[1] - fElbow[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      return armIK(a.bshX, a.bshY, fHand[0] - ux * BOW_PULL, fHand[1] - uy * BOW_PULL, upperArm, lowerArm);
    }
    const grip = backGrip(a.bshX, a.bshY, fElbow, fHand, w, fc, upperArm, lowerArm);
    // 纸偶角色的近肩在**身体的轮廓边**上（画里就是这么画的），前臂因此比旧管线更靠前，
    // 杆上给后手留的那一截会落到身体**前面**去——后臂要横穿胸口才能握到，
    // 手还会从身体左侧探出来（在画面上就是一只悬在体侧的手）。
    // 与其硬掰，不如不握：后臂按姿势垂着，兵器单手拿着。
    if (grip) {
      const ux = fHand[0] - fElbow[0], uy = fHand[1] - fElbow[1];
      const L = Math.hypot(ux, uy) || 1;
      const buttX = fHand[0] - (ux / L) * (w.len * w.grip);   // 杆尾
      if ((buttX - x) * fc < 0) return null;                  // 杆尾在身体前侧 = 握不住
    }
    return grip;
  }
  const { shX, shY } = torsoAnchors(x, feetY, p.lean, p.crouch, fc);
  const [bshX, bshY] = backArmAnchor(shX, shY, fc);
  const [nshX, nshY] = nearArmAnchor(shX, shY, fc, build?.shoulderDx, build?.shoulderDy);
  const fElbow = segEnd(nshX, nshY, p.armF[0], UPPER_ARM, fc);
  const fHand = segEnd(fElbow[0], fElbow[1], p.armF[0] + p.armF[1], LOWER_ARM, fc);
  if (w.kind === 'bow') {
    // 拉弦的手：一手持弓一手拉弦，弦汇到它上面
    const dx = fHand[0] - fElbow[0], dy = fHand[1] - fElbow[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    return armIK(bshX, bshY, fHand[0] - ux * BOW_PULL, fHand[1] - uy * BOW_PULL,
      UPPER_ARM, LOWER_ARM);
  }
  return backGrip(bshX, bshY, fElbow, fHand, w, fc);
}

/** 后手（握杆的那只）在屏幕上的位置。量「头在不在双手中间」时用它。 */
export function backHandFor(
  p: Pose, x: number, feetY: number, fc: number, w?: WeaponDef,
): [number, number] {
  const { shX, shY } = torsoAnchors(x, feetY, p.lean, p.crouch, fc);
  const [bshX, bshY] = backArmAnchor(shX, shY, fc);
  const armB = backArmFor(p, x, feetY, fc, w) ?? p.armB;
  const elbow = segEnd(bshX, bshY, armB[0], UPPER_ARM, fc);
  return segEnd(elbow[0], elbow[1], armB[0] + armB[1], LOWER_ARM, fc);
}

/**
 * 肩点（翅膀、飘带这些附属层的挂点）。
 *
 * 为什么要有这个：附属层挂在**身体中轴**的肩点上，而纸偶角色的肩点高度与
 * 横向位置是**这个人自己的**（build.rig 量自整人那张画）。还用共用骨架的肩点，
 * 雷震子的翅膀就会落到一个不是肩膀的地方——画面上等于没有翅膀。
 */
export function shoulderAnchor(
  x: number, feetY: number, lean: number, crouch: number, fc: number, rig?: CharacterRig,
): [number, number] {
  if (rig) {
    const a = dollAnchors(x, feetY, lean, crouch, fc, rig);
    return [a.shX, a.shY];
  }
  const a = torsoAnchors(x, feetY, lean, crouch, fc);
  return [a.shX, a.shY];
}

/**
 * 纸偶骨架的锚点（髋/肩/下巴/近肩/后肩）。
 *
 * 与 drawDollLimbs 共用同一份算法——量与画必须走同一条路，两处各算一遍必然漂移
 * （探针量出来的关节和画出来的关节对不上，就是这么来的）。
 */
export function dollAnchors(
  x: number, feetY: number, lean: number, crouch: number, fc: number, rig: CharacterRig,
) {
  const hipX = x;
  const hipY = feetY - rig.hipY + crouch;
  const shLen = rig.shoulderY - rig.hipY;
  const chinLen = rig.chinY - rig.hipY;
  const shX = hipX + Math.sin(lean) * shLen * fc;
  const shY = hipY - Math.cos(lean) * shLen + crouch * 0.2;
  const chinX = hipX + Math.sin(lean) * chinLen * fc;
  const chinY = hipY - Math.cos(lean) * chinLen + crouch * 0.2;
  return {
    hipX, hipY, shX, shY, chinX, chinY,
    // 近肩/后肩的横向位置取自这张画（近侧在画面左、后侧在画面右，见 NEAR_ARM_DX 的说明）
    nshX: x + rig.shoulderDx * fc, nshY: shY,
    bshX: x + rig.backShoulderDx * fc, bshY: shY,
  };
}

/**
 * 纸偶角色：整人一张画，在关节处切开动。
 *
 * 为什么另起一条路，而不是在原来那条里加分支：原来那条的每一样都是**十二人共用**的
 * ——肩 118、髋 62、上臂 26、大腿 32、躯干宽 40、头高 40。纸偶件是按画里的原尺寸
 * 切下来的，挂上去若按共用骨架抻开，猪八戒画里 15% 高的短腿会变成 64 单位的长腿、
 * 小孩的短手臂会被抻长：比例一丢，"整人一张画"就只剩"同一套颜色"的意思。
 * 所以这里用**这个人自己的**骨架尺寸（build.rig，由 design-preview/tools/cut-fullbody.py
 * 从画里量出来），每一块按画里的原尺寸 1:1 落位。
 *
 * 另一处不同：**不画程序化脖子**。画里脖子本来就在（头那一块的下面一截就是），
 * 再叠一根半径 3.2 的细脖子，等于在脖子上贴一根柱。
 */
function drawDollLimbs(
  ctx: CanvasRenderingContext2D, p: Pose, x: number, feetY: number, fc: number,
  doll: DollParts, rig: CharacterRig, white: boolean,
  weapon?: WeaponDef, weaponScale = 1, weaponGlow = 0,
  build?: CharacterDef['build'],
): void {
  const k = rig.k;
  const segHalfW = (q: PartImage) => (q.right - q.left) * k / 2;

  const armFU = doll.armFU!, armFL = doll.armFL!, handF = doll.handF!;
  const legFU = doll.legFU!, legFL = doll.legFL!, footF = doll.footF!;
  // 段长取自 rig（切件时量好的），段宽取自贴图自身的内容框——
  // 两者合起来保证每一块按画里的原尺寸落位，不抻不变形。
  const upperArm = rig.upperArm, lowerArm = rig.lowerArm, handLen = rig.handLen;
  const thigh = rig.thigh, shin = rig.shin;

  const a = dollAnchors(x, feetY, p.lean, p.crouch, fc, rig);

  // ---- 后侧肢体：先画，被躯干盖住 ----------------------------------------
  const armB = backArmFor(p, x, feetY, fc, weapon, build, rig) ?? p.armB;
  const bUpExt = Math.max(0, (armFU.bottom - armFU.top) * k - upperArm);
  seg(ctx, a.bshX, a.bshY, armB[0], upperArm, segHalfW(armFU), 0, fc, '', armFU, white, bUpExt);
  const bElbow = segEnd(a.bshX, a.bshY, armB[0], upperArm, fc);
  seg(ctx, bElbow[0], bElbow[1], armB[0] + armB[1], lowerArm, segHalfW(armFL), 0, fc, '', armFL, white);
  const bHand = segEnd(bElbow[0], bElbow[1], armB[0] + armB[1], lowerArm, fc);
  seg(ctx, bHand[0], bHand[1], armB[0] + armB[1], handLen, segHalfW(handF), 0, fc, '', handF, white);
  const bKnee = seg(ctx, a.hipX + (rig.legBDx ?? 0) * fc, a.hipY, p.legB[0], thigh, segHalfW(legFU), 0, fc, '', legFU, white);
  const bAnk = seg(ctx, bKnee[0], bKnee[1], p.legB[0] - p.legB[1], shin, segHalfW(legFL), 0, fc, '', legFL, white);
  drawDollFoot(ctx, bAnk, fc, footF, k, rig.footAnchorX, white);

  // ---- 前臂几何：兵器要用 -------------------------------------------------
  const fElbow = segEnd(a.nshX, a.nshY, p.armF[0], upperArm, fc);
  const fHand = segEnd(fElbow[0], fElbow[1], p.armF[0] + p.armF[1], lowerArm, fc);

  // ---- 躯干：从下巴画到腿根 ----------------------------------------------
  // 这一段用的是**这个人的**长度（下巴→腿根），所以贴图 1:1 落位：画里的肩膀
  // 就落在骨架的肩点上，不会被抻开。
  drawBoneImg(ctx, a.chinX, a.chinY, a.hipX, a.hipY, segHalfW(doll.torso!), doll.torso!, white, fc);

  // ---- 头：底边对齐下巴，横向**保持它在画里的位置** ------------------------
  // 横向不按脸心再对齐一次（那是旧版单独头像的规则）：纸偶的头是从整人一张画上
  // 裁下来的，脸相对身体的位置本来就是对的（角色朝右，脸心在中轴右边），
  // 再对齐一次等于把整个头平移半个头宽（实测悟空偏了 12% 身高的横向量）。
  // headDx 是头件裁剪框中心相对身体中轴的偏移（切件时量好）。
  const head = doll.head!;
  const hw = (head.right - head.left) * k, hh = (head.bottom - head.top) * k;
  ctx.save();
  ctx.translate(a.chinX + (rig.headDx ?? 0) * fc, a.chinY);
  ctx.rotate(p.lean * HEAD_LEAN_FOLLOW * fc);
  ctx.scale(fc, 1);
  const sw = head.right - head.left, sh = head.bottom - head.top;
  if (white) drawWhitePart(ctx, head, head.left, head.top, sw, sh, -hw / 2, -hh, hw, hh);
  else ctx.drawImage(head.img, head.left, head.top, sw, sh, -hw / 2, -hh, hw, hh);
  ctx.restore();

  // ---- 前侧肢体：后画，压在躯干之上 --------------------------------------
  const fKnee = seg(ctx, a.hipX + (rig.legFDx ?? 0) * fc, a.hipY, p.legF[0], thigh, segHalfW(legFU), 0, fc, '', legFU, white);
  const fAnk = seg(ctx, fKnee[0], fKnee[1], p.legF[0] - p.legF[1], shin, segHalfW(legFL), 0, fc, '', legFL, white);
  drawDollFoot(ctx, fAnk, fc, footF, k, rig.footAnchorX, white);

  // 上臂块比骨段长出来的那一截是**三角肌**（肩头）。它必须画在肩关节**之上**，
  // 绕着肩关节转——否则肩头就是一道平口，而且抬手时三角肌不会跟着肩膀转。
  // 办法：把这一块往上伸（画在骨段起点的上方），块的底端仍然落在肘上。
  const upExt = Math.max(0, (armFU.bottom - armFU.top) * k - upperArm);
  seg(ctx, a.nshX, a.nshY, p.armF[0], upperArm, segHalfW(armFU), 0, fc, '', armFU, white, upExt);

  // ---- 兵器：在躯干与腿**之后**、在手之前 --------------------------------
  // 为什么与旧管线相反：旧管线里兵器压在躯干之前，是因为那柄枪横过胸口，
  // 压在躯干上会读成"兵器穿过身体"。纸偶角色的手在**身体的轮廓边**上（画里就是
  // 这么画的），兵器顺着前臂朝前下就整根插进身体与腿里——只露出一截枪尖。
  // 手在身前，兵器本就在身前：画在躯干与腿之后才是对的；
  // 画在手之前，手才压得住杆（"手握着杆"这件事本身就是那个前后关系）。
  //
  // 长度**不**按手臂比例缩：兵器的长度跟着判定框走（autoWeaponScale），
  // 缩短了就够不到人（玩法的真值在这头）。
  if (weapon) {
    drawWeapon(ctx, fElbow, fHand, weapon, white, weaponScale, weaponGlow,
      weapon.kind === 'bow' ? bHand : undefined);
  }

  seg(ctx, a.nshX, a.nshY, p.armF[0], upperArm, segHalfW(armFU), 0, fc, '', armFU, white);
  const fElbow2 = segEnd(a.nshX, a.nshY, p.armF[0], upperArm, fc);
  seg(ctx, fElbow2[0], fElbow2[1], p.armF[0] + p.armF[1], lowerArm, segHalfW(armFL), 0, fc, '', armFL, white);
  const fHand2 = segEnd(fElbow2[0], fElbow2[1], p.armF[0] + p.armF[1], lowerArm, fc);
  seg(ctx, fHand2[0], fHand2[1], p.armF[0] + p.armF[1], handLen, segHalfW(handF), 0, fc, '', handF, white);
}

/**
 * 纸偶的脚：画在踝上，沿脚件自己的朝向（不跟小腿转——脚掌该是平的）。
 *
 * 锚点用**踝在脚件里的横向位置**（rig.footAnchorX）：裁脚那一块的横向范围
 * 是连着脚背一起切下来的，踝在块里的位置不等于块的中点，按中点挂会歪。
 */
function drawDollFoot(
  ctx: CanvasRenderingContext2D, ank: [number, number], facing: number,
  part: PartImage, k: number, anchorX: number, white: boolean,
) {
  const w = (part.right - part.left) * k, h = (part.bottom - part.top) * k;
  const x = ank[0] - anchorX * w * facing;
  ctx.save();
  ctx.translate(x, ank[1]);
  ctx.scale(facing, 1);
  const sw = part.right - part.left, sh = part.bottom - part.top;
  if (white) drawWhitePart(ctx, part, part.left, part.top, sw, sh, 0, 0, w, h);
  else ctx.drawImage(part.img, part.left, part.top, sw, sh, 0, 0, w, h);
  ctx.restore();
}

/** 画一节骨段。`fill` 显式传进来而不是读 ctx.fillStyle——回读属性在真实画布上没问题，
 * 但测试里替身 ctx 的 fillStyle 是个桩（读出来是函数而不是颜色），而这条路径每个角色
 * 每帧要走八次，不该让渲染的正确性挂在替身身上。 */
function seg(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, r1: number, r2: number, facing: number,
  fill: string, img?: PartImage, white = false, topExtend = 0,
): [number, number] {
  const [ex, ey] = segEnd(x, y, angle, len, facing);
  if (img) {
    drawBoneImg(ctx, x, y, ex, ey, r1, img, white, facing, topExtend);
  } else {
    ctx.fillStyle = white ? '#fff' : limbGrad(ctx, x, y, ex, ey, r1 * 2, fill);
    // capStart=false：起点圆帽不描边，肘/膝上那道横贯的黑带就没了（原因见 fillTapered）
    fillTapered(ctx, x, y, ex, ey, r1, r2, white, false, fill);
  }
  return [ex, ey];
}

/** 髋点/肩点：躯干挂载的两个骨骼锚点。肩点绕髋点按 p.lean 摆动（shLen 是唯一半径），
 * 髋点本身不随 lean 移动——腿从髋点独立发力，不该跟着躯干转。抽成独立、可导出的纯函数，
 * 是为了让 tests/renderer.test.ts 的楔形缺口扫描测试和 drawFighter 用同一份公式：改一处，
 * 两边同步；如果各自照抄一份，公式改坏了测试也不会发现。 */
export function torsoAnchors(x: number, feetY: number, lean: number, crouch: number, fc: number) {
  const hipX = x, hipY = feetY - HIP_Y + crouch;
  const shLen = SHOULDER_Y - HIP_Y;
  const shX = hipX + Math.sin(lean) * shLen * fc;
  const shY = hipY - Math.cos(lean) * shLen + crouch * 0.2;
  return { hipX, hipY, shX, shY };
}

/**
 * 骨骼装配核心：后侧肢体 → 躯干 → 头 → 前侧肢体（前后遮挡）。drawFighter（实时角色）和
 * drawGhost（残影快照）共用同一份拼装——残影要求"贴图路径下也要能跑"，跟正式渲染另起
 * 一份容易在贴图接缝/挂载逻辑上跑偏，抽出来只有一处入口，改一处两边同步。
 * white 只有 drawFighter 会传 true（受击白闪）；残影不闪白，恒传 false。
 */
export function drawLimbs(
  ctx: CanvasRenderingContext2D, p: Pose, x: number, feetY: number, fc: number,
  parts: PartImages | null, main: string, accent: string, white: boolean,
  weapon?: WeaponDef, weaponScale = 1, weaponGlow = 0,
  /** 无头（刑天）：不画头，改在胸口画一对眼、腹上画一张口。见 CharacterDef.headless */
  headless = false,
  /** 头饰。与大招特写共用同一份画法（drawCrown）——对局里那颗头此前也是个光头圆，
   * 十二个人只差配色；而玩家绝大多数时间看的是这里，不是特写。 */
  crown?: CharacterDef['crown'],
  /**
   * 体型：四肢粗细、手形、装束。十二个人此前共用同一套四肢几何，只有颜色不同——
   * 于是十二个人看着像同一副假人换了个色（见 CharacterDef.build）。
   */
  build?: CharacterDef['build'],
): void {
  // 纸偶角色（整人一张画切出来的那一套）走自己的路：它有自己的骨架尺寸，
  // 与共用骨架的那条并存。用 ?doll=1 打开（见 parts.ts 的 dollModeOn）。
  const rig = build?.rig;
  const doll = parts?.doll;
  if (rig && doll && doll.torso && doll.head && doll.armFU && doll.armFL
    && doll.handF && doll.legFU && doll.legFL && doll.footF) {
    drawDollLimbs(ctx, p, x, feetY, fc, doll, rig, white, weapon, weaponScale, weaponGlow, build);
    return;
  }
  const { hipX, hipY, shX, shY } = torsoAnchors(x, feetY, p.lean, p.crouch, fc);
  const armScale = build?.arm ?? 1, legScale = build?.leg ?? 1;
  // 各段半径：基准值按体型倍率缩放。**相邻两段首尾相接**（LIMB_R 里就是这么定的），
  // 所以关节处没有台阶——见 LIMB_R 的注释
  const rU: [number, number] = [LIMB_R.upperArm[0] * armScale, LIMB_R.upperArm[1] * armScale];
  const rF: [number, number] = [LIMB_R.foreArm[0] * armScale, LIMB_R.foreArm[1] * armScale];
  const rT: [number, number] = [LIMB_R.thigh[0] * legScale, LIMB_R.thigh[1] * legScale];
  const rS: [number, number] = [LIMB_R.shin[0] * legScale, LIMB_R.shin[1] * legScale];
  const awL = rF[0] * 2;

  // 前臂（袖子）的颜色。此前直接取 accent，而十二个角色的 accent 大多是**近白的浅色**
  // ——铁扇 #eef3ea、后羿 #f2efe6、雷震子 #f0f4ff、二郎 #e8ecff、白骨精 #e8e4d6。
  // 拿它画满整条前臂，等于在身上横着贴一条白带子：选人卡的尺寸上它比脸还亮，
  // 铁扇公主那条斜过胸口的袖子、哪吒那条压在红肚兜上的白胳膊，都是这个毛病
  // （同一个理由此前已经用在"手"上：手改回 main 之后好了一截，胳膊还留着）。
  // 对半之后仍然是"浅色袖 + 深衣"的两截配色，角色差异没丢，亮度落回角色自己的色系里。
  const sleeve = mixC(main, accent, 0.5);

  // **手臂与脖子取躯干素材上的颜色**（见 torsoColors 的说明）：接口处必然同色。
  // 调色板里没有"皮肤"这一项，而 accent 对一半角色是近白——拿它画手臂等于贴一条白带子。
  const tc = torsoColors(parts?.torso, sleeve);
  const skin = tc.shoulder;          // 近肩的颜色：手臂插进去的地方就是这个色
  const backSkin = shade(skin, -25); // 后侧手臂压暗，拉开与躯干的纵深

  // 每条肢体只有一张图（无分大小臂/大小腿贴图），上下两段共用同一张部件图，
  // 各自按自己的段长/段宽独立挂载
  const backLimb = shade(main, -25);   // 后侧肢体压暗，靠这层拉开与躯干的纵深
  // 后侧手臂往身后挪一截：同根同向画就整根埋在躯干里，画面上只剩一只手
  const [bshX, bshY] = backArmAnchor(shX, shY, fc);
  // 前臂的肘→手：兵器杆线就是它的方向。后手要落到杆上，得先知道杆线在哪
  // 肩点用**近肩**（nearArmAnchor），不是身体中轴——前臂因此从肩膀长出来，而不是斜穿胸口
  const [nshX, nshY] = nearArmAnchor(shX, shY, fc, build?.shoulderDx, build?.shoulderDy);
  const fElbow = segEnd(nshX, nshY, p.armF[0], UPPER_ARM, fc);
  const fHand = segEnd(fElbow[0], fElbow[1], p.armF[0] + p.armF[1], LOWER_ARM, fc);
  // 双手兵器：后手去握杆（或拉弓的弦），后臂由"手落在哪"反解——与腿那条 IK 同一套道理。
  // 握不到（角度不可达）就退回姿势里原来的后臂，绝不硬掰。
  const gripArm = parts?.armB ? null : backArmFor(p, x, feetY, fc, weapon, build);
  const armB = gripArm ?? p.armB;
  let j = seg(ctx, bshX, bshY, armB[0], UPPER_ARM, rU[0], rU[1], fc, backSkin, parts?.armFU ?? parts?.armB, white);
  const handB = seg(ctx, j[0], j[1], armB[0] + armB[1], LOWER_ARM, rF[0], rF[1], fc, backSkin, parts?.armFL ?? parts?.armB, white);
  // 握杆的后手要压在兵器与身体**之上**（手在杆上，不是杆在身上），所以晚一点画
  const deferBackHand = !parts?.armB && gripArm !== null;
  if (!parts?.armB && !parts?.handF && !deferBackHand) drawHand(ctx, handB, backSkin, white, build?.hand);
  j = seg(ctx, hipX, hipY, p.legB[0], THIGH, rT[0], rT[1], fc, backLimb, parts?.legFU ?? parts?.legB, white);
  const ankB = seg(ctx, j[0], j[1], p.legB[0] - p.legB[1], SHIN, rS[0], rS[1], fc, backLimb, parts?.legFL ?? parts?.legB, white);
  if (!parts?.legB && !parts?.footF) drawFoot(ctx, ankB, fc, backLimb, white);

  // 前臂的几何已经算好（上面）：兵器要画在躯干**之前**。
  // 兵器柄从身前横过胸口时，压在躯干上会读成"兵器穿过身体"；放到躯干之后，柄被身体盖住，
  // 只有伸出去的那一截可见——那才是"手里握着兵器"该有的样子。
  if (parts?.weapon) { // 有贴图就用贴图
    seg(ctx, fHand[0], fHand[1], p.armF[0] + p.armF[1], 34, 4, 4, fc, main, parts.weapon, white);
  } else if (weapon) { // 否则走程序化兵器：方向取前臂（肘→手）的实际朝向，不重算角度约定
    drawWeapon(ctx, fElbow, fHand, weapon, white, weaponScale, weaponGlow,
      weapon.kind === 'bow' && deferBackHand ? handB : undefined);
  }

  // 头的尺度与「下巴到头贴图底边」的那一段，都要先算出来：
  // 脖子得按 chinGap 多伸一截才够到下巴（否则下巴与脖子之间露出一截背景）。
  const headScaleVal = parts?.head ? headScale(parts.head) * (build?.head ?? 1) : 0;
  const chinGap = parts?.head ? chinGapOf(parts.head, build?.face, headScaleVal) : 0;

  // 脖子画在**躯干之前**。
  //
  // 脖子的位置见下面 `if (parts?.torso)` 那一段：画在躯干**之后**，
  // 颜色取美术自己的颈窝色（torsoColors 的 neck），不是 accent。

  if (parts?.torso) {
    // 20 = 原胶囊 lineWidth；起点=肩，图片顶部对肩、底部对腰。两端各沿骨骼轴向多伸出
    // NECK_OVERLAP/WAIST_OVERLAP，让躯干贴图往上盖过颈部、往下盖过腰部，接缝做成重叠
    // 而不是贴边（下面头部绘制会盖在颈部重叠区之上，腰部的重叠区则被后画的腿盖住）
    const [tx, ty, hx, hy] = extendSeg(shX, shY, hipX, hipY, NECK_OVERLAP, WAIST_OVERLAP);
    // 躯干的铺开宽度**跟着素材的长宽比走**：素材改成侧身后，身体本来就窄（0.42~0.64），
    // 若还按固定的 40 宽铺，侧身的身体会被横向拉成 1.4 倍（白骨精那种）。高度仍是 68
    // （肩→髋的骨长加两端重叠），宽度 = 68 x 素材长宽比 => 素材不被拉伸。
    const tAr = (parts.torso.right - parts.torso.left) / Math.max(1, parts.torso.bottom - parts.torso.top);
    const tHalf = 34 * tAr;
    drawBoneImg(ctx, tx, ty, hx, hy, tHalf, parts.torso, white, fc);
    // 脖子画在躯干**之后**：头贴图的下缘是渐隐的脖子断面，若脖子被躯干盖住，
    // 头与身体之间就断成两截（站姿都能看见）。颜色取**脸的肤色**（faceTone）：
    // 脖子是脸的下半截延续，用别的颜色，下巴那块就会变色——看着像"脖子接错了"。
    drawNeck(ctx, shX, shY, p.lean, fc, faceTone(parts?.head, build?.face, tc.neck), white, chinGap);
  } else if (white) {
    ctx.fillStyle = '#fff';
    fillTapered(ctx, shX, shY, hipX, hipY, TORSO_W / 2, (TORSO_W * TAPER) / 2, true, true, main); // 白闪时整体转白，跳过渐变与描边
  } else {
    const tg = ctx.createLinearGradient(0, shY, 0, hipY); // 竖向渐变：上端 main，下端压暗
    tg.addColorStop(0, main);
    tg.addColorStop(1, shade(main, -28));
    ctx.fillStyle = tg;
    // 肩端粗、髋端细——武人是宽肩窄腰，不是宽臀窄肩的裙摆轮廓（taperedPath 的 x1,y1 是粗的
    // 那头，所以起点传肩不传髋）；TORSO_W 比头部直径 32 明显更宽，肩线撑得起头，不会显小孩
    fillTapered(ctx, shX, shY, hipX, hipY, TORSO_W / 2, (TORSO_W * TAPER) / 2, false, true, main);
  }

  // 握杆的后手：压在兵器与身体之上。手在杆上，杆在手上——顺序就是"握住"这件事本身。
  if (deferBackHand) drawHand(ctx, handB, backSkin, white, build?.hand);

  const { cx: headCx, cy: headCy, angle: baseHeadAngle } = headAnchor(shX, shY, p.lean, fc);
  const headAngle = baseHeadAngle + p.headTilt * fc; // 头相对躯干的额外偏转
  if (parts?.head) {
    // 缩放取自**头素材自己的内容高**，对齐一个固定的逻辑目标高度。
    //
    // 这里先后错过两版。最早是把头硬塞进 32×32 方框：横向 32/128、纵向 32/107 两个比例，
    // 非方形的脸当场压扁。改法是让头跟躯干共用一个比例——scale = 40/躯干内容宽——
    // 方向对，但那个比例来自**另一件素材的留白**：屏幕上的头高等于
    //     头内容高 × 40 ÷ 躯干内容宽
    // 是两件独立素材的测量值相除，没有任何解剖依据。实测头素材内容高本身很齐
    // （95~128，中位 124），可除完之后炸成 29.5~45.2，足足 1.53 倍。
    // 更直接的证据：重切了一轮躯干，全员的头尺寸跟着变了——躯干的裁切参数不该有这个权力。
    //
    // 骨架是同一副，头就该是同一个大小。角色差异体现在脸怎么画、戴什么冠，不是头有多大。
    // 按颈部底边对齐这条保留：头素材多高都不会浮起来，脖子始终落在衣领上。
    const { img, top, bottom, left, right } = parts.head;
    // 角色级头身比：build.face 是**量出来的脸框**（源像素 x,y,宽,高），build.head 是角色特质倍率。
    // 归一化（headScale）只有**一条锚**：内容盒高就是头高——素材契约保证头填满画幅，
    // 头高因此直接可归一；脸不再当尺子（按脸量的话，猴王那种小脸会被放大、小孩那种大脸
    // 会被缩小，角色差异被抹平），脸只管横向挂点与下巴接缝（headMountDx / chinGapOf）。
    const scale = headScaleVal;
    // 源矩形取内容包围盒，横纵都裁。原来横向取整幅 naturalWidth，再拿 contentDx 把刚
    // 包进来的留白手工减掉——一进一出，等价于直接裁。裁了之后内容天然居中，脸没画在
    // 正中也不会歪，那个补偿项从构造上就不需要了。
    const sw = Math.max(1, right - left);
    const sh = Math.max(1, bottom - top);
    const dw = sw * scale, dh = sh * scale;
    // **按脸挂**：横向让脸心落在身体中轴上（见 headMountDx）。
    // 装饰（飘带/翎羽/帽翅）全在左边，头贴图的下缘又是渐隐的衣领——
    // 按整幅挂的话，脸被推出身体 2~10 像素，而下巴与脖子之间会露出一截背景
    // （脖子要按 chinGapOf 多伸一截才够到下巴，见 drawNeck）。
    const dx = headMountDx(parts.head, build?.face, scale);
    ctx.save();
    ctx.translate(headCx, headCy);
    ctx.rotate(headAngle); // 部分跟随 lean——顺序与 drawBoneImg 一致：先在世界系里转，
    ctx.scale(fc, 1); // 再镜像贴图内容，镜像不会带偏已经转好的朝向（同 drawBoneImg 的注释）
    // 只取 top..bottom 这段内容行（parts.ts 已裁掉上下透明留白），横向仍是整张图；
    // 目标矩形的**底边**贴在颈点上（headCy 即颈点），高度由素材自己的比例决定。
    // 白闪走 drawWhitePart：原来这层 source-atop 染的是整块画布，头会变成一块白方（同 drawBoneImg）
    if (white) drawWhitePart(ctx, parts.head, left, top, sw, sh, -dw / 2 - dx, -dh, dw, dh);
    else ctx.drawImage(img, left, top, sw, sh, -dw / 2 - dx, -dh, dw, dh);
    ctx.restore();
  } else if (headless) {
    // 无头：断首之后以乳为目、以脐为口。不画头，改在躯干上画那三处——
    // 这不是省一颗圆，是他这个角色的**本体**（见 CharacterDef.headless）。
    // 位置从肩点与髋点插值取，跟着 lean 一起动，不另立一套坐标。
    const ex = (shX + hipX) / 2, ey = shY + (hipY - shY) * 0.22;
    ctx.fillStyle = white ? '#fff' : INK.paper;
    for (const s2 of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ex + s2 * 7 * fc * Math.cos(p.lean), ey + s2 * 7 * Math.sin(p.lean) * fc, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!white) {
      ctx.strokeStyle = INK.ink; ctx.lineWidth = 1.2;
      for (const s2 of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(ex + s2 * 7 * fc * Math.cos(p.lean), ey + s2 * 7 * Math.sin(p.lean) * fc, 3.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 脐为口：髋点略上，一道横弧
    const mx = (shX + hipX) / 2 + (hipX - shX) * 0.28, my = shY + (hipY - shY) * 0.72;
    ctx.strokeStyle = white ? '#fff' : INK.ink;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(mx, my, 5.5, 0.25, Math.PI - 0.25);
    ctx.stroke();
  } else {
    // 头：圆形程序化兜底，各向同性，不需要跟着 headAngle 转。headAnchor 现在给的是颈点，
    // 圆心要沿骨骼方向再抬一个半径——lean=0 时圆心正好回到旧的 shY-20
    const cUx = Math.sin(p.lean) * fc, cUy = -Math.cos(p.lean);
    const headCx2 = headCx + cUx * HEAD_R, headCy2 = headCy + cUy * HEAD_R;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(headCx2, headCy2, HEAD_R, 0, Math.PI * 2); ctx.fill();
    // 头饰画在头之后、面孔之前：它是戴在头上的，不该被脸盖住，也不该盖住眼睛。
    // 受击白闪时跳过——那一帧整个人是纯白剪影，多画一件反而破坏"闪"的读法
    if (crown && !white) {
      ctx.save();
      ctx.translate(headCx2, 0);
      ctx.scale(fc, 1);            // 非对称的那几件（发簪/抹额）要跟着朝向翻
      drawCrown(ctx, crown, headCy2, HEAD_R);
      ctx.restore();
    }
    if (!white) {
      ctx.strokeStyle = INK.ink;
      ctx.lineWidth = 2;
      ctx.stroke();
      const hiAngle = fc === 1 ? 0 : Math.PI; // 面向侧留一道高光弧
      ctx.strokeStyle = INK.paper;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(headCx2, headCy2, 11, hiAngle - 0.7, hiAngle + 0.7); ctx.stroke();
      // 侧脸：一道眉、一只眼。没有它这颗头就是一枚空白鹅卵石——
      // public/chars/ 只有最早四个人有 head.png，另外八个走的全是这条程序化分支，
      // 于是同一帧里一边是画出来的脸、一边是没有五官的假人。
      // 只画这两笔：这套画风本来就是平涂粗描边，五官多了反而脏
      ctx.save();
      ctx.translate(headCx2, headCy2);
      ctx.scale(fc, 1);            // 朝向哪边，脸就朝哪边
      ctx.strokeStyle = INK.ink;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.2;
      ctx.beginPath();             // 眉：略斜，压在眼上方
      ctx.moveTo(2.5, -6.5);
      ctx.lineTo(9.5, -4.5);
      ctx.stroke();
      ctx.fillStyle = INK.ink;     // 眼
      ctx.beginPath();
      ctx.ellipse(7, 0, 1.9, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  j = seg(ctx, hipX, hipY, p.legF[0], THIGH, rT[0], rT[1], fc, main, parts?.legFU ?? parts?.legF, white);
  const ankF = seg(ctx, j[0], j[1], p.legF[0] - p.legF[1], SHIN, rS[0], rS[1], fc, main, parts?.legFL ?? parts?.legF, white);
  if (!parts?.legF && !parts?.footF) drawFoot(ctx, ankF, fc, main, white);
  j = seg(ctx, nshX, nshY, p.armF[0], UPPER_ARM, rU[0], rU[1], fc, skin, parts?.armFU ?? parts?.armF, white);
  const elbow = j;
  j = seg(ctx, j[0], j[1], p.armF[0] + p.armF[1], LOWER_ARM, rF[0], rF[1], fc, skin, parts?.armFL ?? parts?.armF, white);
  // 装束画在两段之后：袖口要盖住小臂的根，护腕在小臂中段，毛边沿上臂
  // 袖口是**衣服**的一截（铁扇的广袖、钟馗的官袍），用衣服色；护腕与毛边是手臂自己的东西，用皮肤色
  if (!parts?.armF) {
    drawSleeve(ctx, build?.sleeve,
      { x1: nshX, y1: nshY, x2: elbow[0], y2: elbow[1] },
      { x1: elbow[0], y1: elbow[1], x2: j[0], y2: j[1] },
      awL, skin, white, tc.cloth);
  }
  // 兵器已经画在躯干之前了（见上面那段），这里只剩手——手压在兵器之上，
  // 顺序就是"握住"这件事本身
  // 手是皮肤的一部分，跟手臂同色（此前用 main，是 accent 时代的老办法：accent 近白，
  // 手若也用白就成了腰腹上最显眼的一枚浅色贴纸——现在手臂本身已是皮肤色，手跟着走就对上了）。
  if (!parts?.armF && !parts?.handF) drawHand(ctx, j, skin, white, build?.hand);
}

/** 兵器握持点（前手末端）与朝向。抽出来是因为拖影也要用同一个点——
 * 两处各算一遍必然漂移。 */
export function weaponHold(p: Pose, x: number, feetY: number, fc: number, build?: CharacterDef['build']) {
  const { shX, shY } = torsoAnchors(x, feetY, p.lean, p.crouch, fc);
  const [nshX, nshY] = nearArmAnchor(shX, shY, fc, build?.shoulderDx, build?.shoulderDy);
  const elbow = segEnd(nshX, nshY, p.armF[0], UPPER_ARM, fc);
  const hand = segEnd(elbow[0], elbow[1], p.armF[0] + p.armF[1], LOWER_ARM, fc);
  return { elbow, hand };
}

/**
 * 判定框叠加层要不要画：**默认不画**，要看得自己加 `?hitbox=1`。
 *
 * 此前它只挂在 `import.meta.env.DEV` 上，也就是**开发时每一次出招的生效帧都会画**。
 * 生产构建确实裁掉了（实测 bundle 里 `255,224,102` 零出现），但开发时那层半透明黄绿
 * 矩形会盖在角色身上——玩家（也就是调参的人自己）一眼看见的是"打起来了冒出个色块"，
 * 画面读起来像 demo 演示。要调判定框的人加个参数就行，不该让所有人看。
 *
 * `import.meta.env.DEV` 仍然留在**使用处**而不是收进这里：vite 只在表达式里遇到
 * `import.meta.env.DEV === false` 时才把整棵子树裁掉，收进模块级常量就可能被
 * 跨模块传播挡住，裁不干净反而把调试框发到线上去。
 */
function hitboxDebug(): boolean {
  return typeof location !== 'undefined' && /[?&]hitbox=1/.test(location.search);
}

/** 兵器尖端的世界坐标，供拖影采样 */
export function weaponTipOf(p: Pose, x: number, feetY: number, fc: number, w: WeaponDef): [number, number] {
  const { elbow, hand } = weaponHold(p, x, feetY, fc);
  const dx = hand[0] - elbow[0], dy = hand[1] - elbow[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const fwd = w.len * (1 - w.grip);
  return [hand[0] + ux * fwd, hand[1] + uy * fwd];
}

/** 程序化兵器：沿前臂方向画一根杆，按形制在两端加不同的头，不用任何美术资源。
 *
 * 九种形制各自对应角色招式名里那件东西——火尖枪的焰形刃、如意棒的箍、三尖两刃刀的三叉、
 * 九齿钉耙的横梁与九根齿、震天弓的弓臂与弦、戚的阔斧、判官剑的剑格、芭蕉扇的叶面、
 * 混铁棍的钝重头。**最后一支是 else**（钝头棍）：新形制忘了加分支不会报错，
 * 只会安静地画成一根棍子，所以 weapons.test 里钉着"九种画出来两两不同"。
 *
 * 导出只为那条测试：它要拿一个记录用的 ctx 把九种各画一遍，比对调用序列。 */
export function drawWeapon(
  ctx: CanvasRenderingContext2D, elbow: [number, number], hand: [number, number],
  w0: WeaponDef, white: boolean, scale = 1, glow = 0,
  /** 拉弦的那只手（弓用）：弦从两个弓弭汇到它上面，画成拉满的 V。别的形制不看这个参数。 */
  pull?: [number, number],
) {
  const w = scale === 1 ? w0 : { ...w0, len: w0.len * scale };
  if (glow > 0) { // 大招期间刃身发光：叠一层同色的粗描边
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(glow, 1) * 0.55;
    drawWeapon(ctx, elbow, hand, { ...w, shaft: w.edge }, false, 1, 0, pull);
    ctx.restore();
  }
  const dx = hand[0] - elbow[0], dy = hand[1] - elbow[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;      // 顺着前臂往外
  const px = -uy, py = ux;             // 垂直方向
  const fwd = w.len * (1 - w.grip), back = w.len * w.grip;
  const tipX = hand[0] + ux * fwd, tipY = hand[1] + uy * fwd;
  const buttX = hand[0] - ux * back, buttY = hand[1] - uy * back;
  const shaft = white ? '#fff' : w.shaft;
  const edge = white ? '#fff' : w.edge;
  // 兵器与四肢走同一套上色语汇：描边是本色朝墨蓝混（contourOf），大面积的部件给一道
  // 体积渐变。人物那边刚把硬墨边换成同色系轮廓线，兵器若还留着一圈硬墨蓝，
  // 就成了"手上那根东西是另一个画师画的"。
  const outline = (c: string) => (white ? '#fff' : contourOf(c));
  const solid = (c: string | CanvasGradient) => (white ? '#fff' : c);

  // 杆。弓没有杆——它是横着握的，画一根顺前臂的直杆就成了"举着一根棍"，
  // 而弓臂本身就是它的形。所以这一段跳过，下面 bow 那一支自己画弓臂与弦。
  if (w.kind !== 'bow') {
    ctx.strokeStyle = shaft;
    ctx.lineWidth = w.kind === 'mace' ? 8 : w.kind === 'staff' ? 6 : w.kind === 'rake' ? 6 : 5;
    ctx.beginPath(); ctx.moveTo(buttX, buttY); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.strokeStyle = outline(shaft);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(buttX, buttY); ctx.lineTo(tipX, tipY); ctx.stroke();
  }

  const tri = (cx: number, cy: number, len: number, halfW: number) => {
    ctx.beginPath();
    ctx.moveTo(cx + ux * len, cy + uy * len);
    ctx.lineTo(cx + px * halfW, cy + py * halfW);
    ctx.lineTo(cx - px * halfW, cy - py * halfW);
    ctx.closePath(); ctx.fill();
  };

  ctx.fillStyle = edge;
  if (w.kind === 'spear') {          // 火尖枪：焰形刃 + 缨
    tri(tipX, tipY, 16, 5);
    ctx.strokeStyle = edge; ctx.lineWidth = 3;
    for (const s of [-1, 1]) { // 两缕火缨
      ctx.beginPath();
      ctx.moveTo(tipX - ux * 6, tipY - uy * 6);
      ctx.quadraticCurveTo(tipX - ux * 16 + px * 7 * s, tipY - uy * 16 + py * 7 * s,
        tipX - ux * 26 + px * 3 * s, tipY - uy * 26 + py * 3 * s);
      ctx.stroke();
    }
  } else if (w.kind === 'staff') {   // 如意棒：两端金箍
    for (const e of [[tipX, tipY], [buttX, buttY]] as const) {
      ctx.fillStyle = solid(ballGrad(ctx, e[0], e[1], 5, edge));
      ctx.beginPath();
      ctx.arc(e[0], e[1], 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (w.kind === 'glaive') {  // 三尖两刃刀：主刃 + 两侧短叉
    tri(tipX, tipY, 20, 6);
    for (const s of [-1, 1]) tri(tipX + px * 7 * s - ux * 4, tipY + py * 7 * s - uy * 4, 11, 3);
  } else if (w.kind === 'rake') {    // 九齿钉耙：横梁 + 九根齿。名字里就写着几根，那就画几根
    const half = 17;
    ctx.strokeStyle = edge; ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(tipX + px * half, tipY + py * half);
    ctx.lineTo(tipX - px * half, tipY - py * half);
    ctx.stroke();
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const t = (i / 8 - 0.5) * 2 * half;
      ctx.beginPath();
      ctx.moveTo(tipX + px * t, tipY + py * t);
      ctx.lineTo(tipX + px * t + ux * 12, tipY + py * t + uy * 12);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  } else if (w.kind === 'axe') {     // 戚：偏在一侧的阔斧，刃口外凸；杆头再留一个小尖
    ctx.beginPath();
    ctx.moveTo(tipX - ux * 15, tipY - uy * 15);
    ctx.quadraticCurveTo(tipX - ux * 2 + px * 30, tipY - uy * 2 + py * 30,
      tipX + ux * 11 + px * 7, tipY + uy * 11 + py * 7);
    ctx.lineTo(tipX + ux * 9, tipY + uy * 9);
    ctx.closePath();
    // 刃面横跨整个斧头，给一道横向渐变才有厚度；平涂时它读作一片贴纸
    ctx.fillStyle = solid(limbGrad(ctx, tipX - ux * 15, tipY - uy * 15, tipX + ux * 11, tipY + uy * 11, 30, edge));
    ctx.fill();
    ctx.strokeStyle = outline(edge); ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = edge; tri(tipX + ux * 9, tipY + uy * 9, 9, 3);
  } else if (w.kind === 'sword') {   // 剑：剑格 + 收锋的直刃。刃比杆宽，才不至于看成一根棍
    const gx = hand[0] + ux * 7, gy = hand[1] + uy * 7;
    ctx.beginPath();
    ctx.moveTo(gx + px * 4.5, gy + py * 4.5);
    ctx.lineTo(tipX + ux * 11, tipY + uy * 11);
    ctx.lineTo(gx - px * 4.5, gy - py * 4.5);
    ctx.closePath();
    // 刃是薄片：亮边朝上、暗边朝下，比整片平涂更像一块钢
    ctx.fillStyle = solid(limbGrad(ctx, gx + px * 4.5, gy + py * 4.5, gx - px * 4.5, gy - py * 4.5, 9, edge));
    ctx.fill();
    ctx.strokeStyle = outline(edge); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = shaft; ctx.lineWidth = 3.4;   // 剑格
    ctx.beginPath();
    ctx.moveTo(gx + px * 10, gy + py * 10);
    ctx.lineTo(gx - px * 10, gy - py * 10);
    ctx.stroke();
  } else if (w.kind === 'bow') {     // 震天弓：弓臂沿垂直方向张开、朝前弯，弦绷在内侧
    const up = w.len * (1 - w.grip), dn = w.len * w.grip;   // grip 决定握点偏上还是偏下
    const t1: [number, number] = [hand[0] + px * up, hand[1] + py * up];
    const t2: [number, number] = [hand[0] - px * dn, hand[1] - py * dn];
    ctx.strokeStyle = shaft; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t1[0], t1[1]);
    ctx.quadraticCurveTo(hand[0] + ux * 26, hand[1] + uy * 26, t2[0], t2[1]);
    ctx.stroke();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.4;    // 弦
    ctx.beginPath();
    if (pull) {
      // 拉满的弓：弦不是一条直线，而是从两个弓弭汇到**拉弦的那只手**上。
      // 此前弦直直穿过握点、另一只手垂在身侧，画出来是"拿着一把没拉开的弓"。
      ctx.moveTo(t1[0], t1[1]); ctx.lineTo(pull[0], pull[1]); ctx.lineTo(t2[0], t2[1]);
    } else {
      ctx.moveTo(t1[0], t1[1]); ctx.lineTo(t2[0], t2[1]);
    }
    ctx.stroke();
    ctx.fillStyle = edge;                            // 两端弓弭
    for (const e of [t1, t2]) { ctx.beginPath(); ctx.arc(e[0], e[1], 3.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineCap = 'butt';
  } else if (w.kind === 'fan') {     // 芭蕉扇：宽阔的叶面 + 三根扇骨，握把很短
    // 扇面是**横着张开**的（沿 p 轴展宽），不是顺着杆子伸长——她的攻程来自风，不是杆长
    // 扇面要**大**才读得出是扇：第一版 spread 15 / blade 26 在实机上是一根棍加个小疙瘩。
    // 芭蕉扇本来就是"比人还宽"的法宝，这里给到近乎半个身位
    const spread = 30, blade = 46;
    ctx.beginPath();
    ctx.moveTo(tipX - ux * 4, tipY - uy * 4);
    ctx.quadraticCurveTo(tipX + ux * blade + px * spread, tipY + uy * blade + py * spread,
      tipX + ux * (blade + 6), tipY + uy * (blade + 6));
    ctx.quadraticCurveTo(tipX + ux * blade - px * spread, tipY + uy * blade - py * spread,
      tipX - ux * 4, tipY - uy * 4);
    ctx.closePath();
    // 扇面是全场最大的一块平涂，沿展宽方向给一道渐变，扇子才有"面"而不是"片"
    ctx.fillStyle = solid(limbGrad(ctx, tipX - ux * 4, tipY - uy * 4, tipX + ux * (blade + 6), tipY + uy * (blade + 6), spread * 2, edge));
    ctx.fill();
    ctx.strokeStyle = outline(edge); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = shaft; ctx.lineWidth = 1.4;
    for (const s2 of [-1, 0, 1]) {   // 扇骨
      ctx.beginPath();
      ctx.moveTo(tipX - ux * 2, tipY - uy * 2);
      ctx.lineTo(tipX + ux * (blade - 2) + px * spread * 0.7 * s2, tipY + uy * (blade - 2) + py * spread * 0.7 * s2);
      ctx.stroke();
    }
  } else {                            // 混铁棍：钝重头
    const mx = tipX + ux * 5, my = tipY + uy * 5;
    ctx.beginPath();
    ctx.ellipse(mx, my, 11, 8, Math.atan2(uy, ux), 0, Math.PI * 2);
    ctx.fillStyle = solid(ballGrad(ctx, mx, my, 11, edge));   // 锤头是球面，平涂就是个贴片
    ctx.fill();
    ctx.strokeStyle = outline(edge); ctx.lineWidth = 1.5; ctx.stroke();
  }
}

/**
 * 选人页的立绘：把这个角色按站姿画进一个 w×h 的框里。
 *
 * 十二张选人卡此前只有**竖排名号 + 一层配色**，形状完全一样——玩家第一次
 * 感到"新角色怎么都一样"就在这一屏，比进对局还早。
 * 而现在这十二个人本来就分得开：九种兵器形制、刑天无头、雷震子有翅膀。
 * 所以不新画一套立绘，直接复用对局那套骨骼装配（drawLimbs）——
 * 卡面上出现的就是待会儿真正打的那个人，两边永远不会不一致。
 *
 * 帧号固定传 0：卡片是静态的，不该为了一屏选人跑十二个 60fps 的画布。
 */
export function drawPortrait(ctx: CanvasRenderingContext2D, def: CharacterDef, w: number, h: number) {
  const FIG = 178;                       // 脚底到头顶的逻辑高度（SHOULDER_Y 118 + 头颈）
  const s = (h * 0.86) / FIG;
  const pose = samplePose(MOTIONS.idle, 0);
  ctx.save();
  ctx.translate(w / 2, h * 0.96);        // 原点落在脚底
  ctx.scale(s, s);
  // 与对局同一套身高缩放（见 drawFighter 里 bodyScale 那段）：卡片上的人要与场上一样高矮，
  // 否则选人页看着比实际矮一头。
  const bodyScale = def.height / 150;
  ctx.translate(0, 0);
  ctx.scale(bodyScale, bodyScale);
  if (def.adorn?.wings) {
    const wa = shoulderAnchor(0, 0, pose.lean, pose.crouch, 1, def.build?.rig);
    drawWings(ctx, def.adorn.wings, wa[0], wa[1], 1, 0, 0);
  }
  // 传 getParts 而不是 null：立绘刚做出来时还没有任何美术素材，当时写死 null 是对的；
  // 现在素材陆续补进来了，选人页却仍是火柴人——而那正是玩家第一眼看的地方。
  // 逐件挂载：有 head.png 就用，没有就回退程序化圆头（连带头饰），互不影响。
  drawLimbs(ctx, pose, 0, 0, 1, getParts(def.id), def.palette.main, def.palette.accent, false,
    def.weapon, 1, 0, def.headless, def.crown, def.build);
  ctx.restore();
}

/**
 * 普通技的兵器视觉倍率：让刃尖**够到判定框前沿**。
 *
 * 玩家反馈「武器还没接触对方就显示被打了」，量下来是真的：判定框前沿普遍比刃尖远——
 * n3 一档多出 40~60px（牛魔王 判定125/兵器78、猪八戒 +59），接近一个身位宽，
 * 打空了却算中，一眼看得出来。
 *
 * 修的是**视觉**不是判定：判定框调过平衡、有一堆守门钉着，动它是另一回事；
 * 而 weaponScale 这个字段本来就是为"招式名承诺变长的招"准备的。
 * 这里只是把它的缺省值从 1 改成"够到判定前沿所需的倍率"，所以**零平衡影响**。
 *
 * 只给普通技（n1~n3）。必杀/超必杀按同样算法要 2~6 倍（牛魔王 sp100 要 6.0×，
 * 78px 的混铁棍会变成 468px、半个场子长）——那一档的射程是特效撑起来的，不是兵器，
 * 所以不在这里凑，宁可不动。CAP 同理：再长就不像挥兵器了，是在拉面条。
 *
 * 结果按 (角色, 招式 id) 记忆化：它只依赖静态数据，而这是每帧都要走的路径。
 */
const REACH_CAP = 2.0;
const reachCache = new Map<string, number>();
export function autoWeaponScale(def: CharacterDef, mv: Move): number {
  if (mv.weaponScale !== undefined) return mv.weaponScale;
  if (!def.weapon || !(mv.slot === 'n1' || mv.slot === 'n2' || mv.slot === 'n3')) return 1;
  const key = `${def.id}:${mv.id}`;
  const hit = reachCache.get(key);
  if (hit !== undefined) return hit;
  const motion = MOTIONS[mv.motionId] ?? MOTIONS.thrust;
  const total = mv.startup + mv.active + mv.recovery;
  const front = mv.hitbox.x + mv.hitbox.w;
  const tipAt = (scale: number) => {
    let best = -1e9;
    for (let fr = mv.startup; fr <= mv.startup + mv.active; fr++) {
      const p = samplePose(motion, (fr / total) * motion.frames);
      best = Math.max(best, weaponTipOf(p, 0, FLOOR_Y, 1, { ...def.weapon!, len: def.weapon!.len * scale })[0]);
    }
    return best;
  };
  let out = 1;
  if (front - tipAt(1) > 12) {          // 差得不多就别动，免得每招都在微调
    let lo = 1, hi = REACH_CAP;
    if (tipAt(hi) < front - 8) out = hi; // 顶到上限也够不着：认了，不再拉长
    else { for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (tipAt(mid) < front - 8) lo = mid; else hi = mid; } out = hi; }
  }
  reachCache.set(key, out);
  return out;
}

/**
 * 这一招的"视觉够不到判定框前沿"的缺口（px）。0 = 够得到。
 *
 * 规矩是玩家定的：**被打了，视觉上必须有东西够到——兵器，或者特效**。
 * 兵器那一半由 autoWeaponScale 管（只管普通技）。必杀/超必杀的射程本该由特效撑，
 * 实测撑不住：算上特效之后 sp100 仍普遍差 80~124px（牛魔王 判定360/兵器120/特效251），
 * 必杀也差 21~86px。差出来的那一段就是"什么都没碰到却算中"的地方。
 *
 * 这里只**算**缺口；补什么由 FxSystem 决定（在判定生效那一帧于前沿补一发）。
 * 分成两处是因为 renderer 引着 fx，fx 不能反过来引 renderer（会成环）。
 * 同样按 角色+招式 记忆化：只依赖静态数据。
 */
const gapCache = new Map<string, number>();
export function visualReachGap(def: CharacterDef, mv: Move): number {
  if (mv.projectile) return 0;               // 判定属于飞出去那颗，不属于本体
  const key = `${def.id}:${mv.id}`;
  const hit = gapCache.get(key);
  if (hit !== undefined) return hit;
  const front = mv.hitbox.x + mv.hitbox.w;
  const motion = MOTIONS[mv.motionId] ?? MOTIONS.thrust;
  const total = mv.startup + mv.active + mv.recovery;
  let reach = -1e9;
  if (def.weapon) {
    const sc = autoWeaponScale(def, mv);
    for (let f = mv.startup; f <= mv.startup + mv.active; f++) {
      const p = samplePose(motion, (f / total) * motion.frames);
      reach = Math.max(reach, weaponTipOf(p, 0, FLOOR_Y, 1, { ...def.weapon, len: def.weapon.len * sc })[0]);
    }
  }
  for (const e of mv.fx ?? []) {             // 判定窗口前后 6 帧内的特效才算数
    if (e.frame < mv.startup - 6 || e.frame > mv.startup + mv.active + 6) continue;
    reach = Math.max(reach, (e.x ?? 0) + (e.size ?? 24));
  }
  const gap = Math.max(0, front - reach - 20); // 留 20px 宽容：差一点点不值得再补一发
  gapCache.set(key, gap);
  return gap;
}

function drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, x: number, y: number, who: 0 | 1) {
  const p: Pose = poseFor(f);
  const feetY = FLOOR_Y - y;
  const white = f.flash > 0;
  // 环境光：角色的主色里掺一点本帧的光源色（天体色）。掺得很少（8~10%），读不出来是"染了色"，
  // 只读得出"这盏光也照在他身上"——背景与角色各用各的色时，人物是浮在景上的贴纸
  const main = white ? '#fff' : mixC(f.def.palette.main, sceneLight, 0.1);
  const accent = white ? '#fff' : mixC(f.def.palette.accent, sceneLight, 0.06);
  const fc = f.facing;
  // 逐件挂载：parts 里存在哪个字段就用哪张图，缺的字段各自独立回退到笔锋/胶囊绘制
  // （见 drawLimbs 里每处 parts?.xxx 判断）；parts 本身可能是空对象——效果等同完全没有美术
  const parts = getParts(f.def.id);

  ctx.save();
  ctx.lineCap = 'round';
  // 整体翻转与挤压：套在骨骼装配之外的刚体/缩放变换，因此不动头颈接缝的几何关系
  //（那条楔形缺口扫描测试量的是 drawLimbs 内部的相对位置，不受这里影响）。
  // 支点取臀部高度：绕脚底转会让人像绕着脚尖倒，绕重心转才像被打翻。
  // 倒地此前是对 down 状态写死的 -90°——既不能插值也只有一个角度；现在由 pose.roll 给，
  // fallen 动作因此能「转着倒下去」，tumble 能在空中真的翻整圈。
  // **受击形变**：被打中的那一瞬间，身体沿受力方向拉一下、另一轴压一下。
  // 打击感里最容易被漏掉的一项：只有粒子与震屏时，角色像一张贴纸被推动；
  // 有了这一下挤压拉伸，这一击才有"砸进去"的重量。
  // 方向：水平受力就横向拉长（sq<1 → 横向撑开、纵向压扁）；被打飞起来则反过来。
  const imp = f.impact > 0
    ? (f.vy < -6 ? 1 + 0.16 * (f.impact / 4) : 1 - 0.2 * (f.impact / 4))
    : 1;
  const sq = p.squash * imp;
  if (p.roll !== 0 || sq !== 1) {
    const pivotY = feetY - 40;
    ctx.translate(x, pivotY);
    if (p.roll !== 0) ctx.rotate(p.roll * fc);
    if (sq !== 1) ctx.scale(1 / sq, sq); // 横向反向补偿，体积守恒
    ctx.translate(-x, -pivotY);
  }
  // **每个角色按自己的身高缩放**（def.height）。
  //
  // 为什么：十二个人**共用一副骨架**，画面上一直一样高——可数据里写的是各人各的身高
  // （红孩儿 128、牛魔王 160、白骨精 146…），**投影的宽度与判定框的高度都按这份数据画**，
  // 于是画面上会出现"投影比身体宽、判定框比身体矮"的不一致：红孩儿的头和肩膀根本在判定框外。
  // 数据既然写了"谁多高谁多矮"，渲染就该照着画——红孩儿就该是个小孩，牛魔王就该压人。
  // 缩放绕脚底（脚不能离地），美术贴图与程序化四肢一起缩放，比例关系不变。
  // 基准 150：十二人数据的中位数附近，取这个值等于"大多数人的体型不变"。
  const bodyScale = f.def.height / 150;
  ctx.translate(x, feetY);
  ctx.scale(bodyScale, bodyScale);
  ctx.translate(-x, -feetY);
  // 兵器倍率取自当前招式；大招期间刃身发光，强度随判定窗口起落
  const mv = f.state === 'attack' ? f.move : null;
  const wScale = mv ? autoWeaponScale(f.def, mv) : 1;
  const wGlow = mv && mv.meterCost > 0 && f.stateFrame >= mv.startup
    && f.stateFrame < mv.startup + mv.active ? 1 : 0;
  // 兵器已被打飞的一方，手上不再画兵器
  const held = isDisarmed(who) ? undefined : f.def.weapon;
  drawLimbs(ctx, p, x, feetY, fc, parts, main, accent, white, held, wScale, wGlow, f.def.headless, f.def.crown, f.def.build);

  if (import.meta.env.DEV && hitboxDebug() && f.state === 'attack' && f.move) { // 判定帧命中框叠加层，直接取自 worldBox，与 checkHit 一致；生产构建裁掉
    const mv = f.move;
    if (f.stateFrame >= mv.startup && f.stateFrame < mv.startup + mv.active) {
      const hb = worldBox(mv.hitbox, x, feetY, fc);
      ctx.fillStyle = 'rgba(255, 224, 102, 0.35)';
      ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    }
  }

  if (f.state === 'block') {
    ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 3;
    const { cx, cy, r, a0, a1 } = blockArcGeom(x, feetY, fc);
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  }
  ctx.restore();
}

/**
 * 残影环形缓冲：出招者身后 3–4 个逐渐淡出的姿势快照，只在 sp100 攻击窗口内采样——性能与
 * 观感都不需要全程开着。复用 drawLimbs 同一份骨骼拼装（含贴图路径），跟正式渲染是同一套
 * 美术，不会看起来像另一样东西。
 *
 * 推进必须挂在逻辑 tick 上（GameCanvas 固定步长循环里，紧跟 battle.tick() 之后）——同
 * tickDamageTrail 的道理，采样间隔/淡出速度不能绑定渲染帧率，否则 120Hz 手机上残影堆得
 * 更密、淡得更快。用 Battle 引用探测新局，避免上一局的残影漏进下一局第一帧。
 */
interface Ghost { x: number; y: number; pose: Pose; facing: 1 | -1; age: number; peak: number; life: number }
interface GhostState {
  battle: Battle | null;
  p1: Ghost[]; p2: Ghost[];
  since1: number; since2: number;
  /** 普通招式的身形拖影。与超必杀那套分开存：两者的浓度、存活时间都不同 */
  t1: Ghost[]; t2: Ghost[];
  tsince1: number; tsince2: number;
}
const ghostState: GhostState = {
  battle: null, p1: [], p2: [], since1: 0, since2: 0, t1: [], t2: [], tsince1: 0, tsince2: 0,
};
const GHOST_MAX = 4;
const GHOST_SAMPLE_EVERY = 3; // 每 3 逻辑 tick 采样一次
const GHOST_LIFE = 14;        // age 超过这个 tick 数就从队列移除（淡出全程）
const GHOST_ALPHA = 0.42;     // 最新一张残影的峰值透明度——Task 35 之前是 0.3；那时残影多数
// 时间被 sp100 的暗场+背光盖住看不见（渲染顺序的问题，见下面 draw() 里补的那次重绘），调多高
// 都没用。顺序修好之后再看，0.3 在暗场里仍偏淡，调到 0.42 才在正常观战距离下读得出来是拖尾

/** 普通招式的身形拖影：浓度低、活得短。存在的意义是"他冲出去了"——三段连击的位移很快，
 * 没有这道拖影时角色像瞬移。跟兵器拖影不冲突：一条是刃，一条是人。 */
const TRAIL_GHOST_MAX = 3;
const TRAIL_GHOST_LIFE = 7;
const TRAIL_GHOST_ALPHA = 0.16;

function resetGhostsIfNewBattle(b: Battle): void {
  if (ghostState.battle !== b) {
    ghostState.battle = b;
    ghostState.p1 = []; ghostState.p2 = []; ghostState.since1 = 0; ghostState.since2 = 0;
    ghostState.t1 = []; ghostState.t2 = []; ghostState.tsince1 = 0; ghostState.tsince2 = 0;
  }
}

function stepGhostList(
  list: Ghost[], since: number, f: Fighter,
  max: number, life: number, every: number, peak: number,
  window: (f: Fighter) => boolean,
): number {
  if (!window(f)) { list.length = 0; return 0; } // 出了窗口立刻清空，不留尾巴
  for (const g of list) g.age++;
  while (list.length && list[0].age > life) list.shift();
  if (since + 1 >= every) {
    list.push({ x: f.x, y: f.y, pose: poseFor(f), facing: f.facing, age: 0, peak, life });
    if (list.length > max) list.shift();
    return 0;
  }
  return since + 1;
}

/** 每逻辑 tick 调一次，紧跟 battle.tick() 之后（同 tickDamageTrail 的调用位置）。 */
export function tickAfterimages(b: Battle): void {
  resetGhostsIfNewBattle(b);
  ghostState.since1 = stepGhostList(ghostState.p1, ghostState.since1, b.p1,
    GHOST_MAX, GHOST_LIFE, GHOST_SAMPLE_EVERY, GHOST_ALPHA,
    f => f.state === 'attack' && f.move?.slot === 'sp100');
  ghostState.since2 = stepGhostList(ghostState.p2, ghostState.since2, b.p2,
    GHOST_MAX, GHOST_LIFE, GHOST_SAMPLE_EVERY, GHOST_ALPHA,
    f => f.state === 'attack' && f.move?.slot === 'sp100');
  ghostState.tsince1 = stepGhostList(ghostState.t1, ghostState.tsince1, b.p1,
    TRAIL_GHOST_MAX, TRAIL_GHOST_LIFE, GHOST_SAMPLE_EVERY, TRAIL_GHOST_ALPHA,
    f => f.state === 'attack' && f.move?.slot !== 'sp100');
  ghostState.tsince2 = stepGhostList(ghostState.t2, ghostState.tsince2, b.p2,
    TRAIL_GHOST_MAX, TRAIL_GHOST_LIFE, GHOST_SAMPLE_EVERY, TRAIL_GHOST_ALPHA,
    f => f.state === 'attack' && f.move?.slot !== 'sp100');
  stepWeaponTrail(weaponTrail.p1, b.p1);
  stepWeaponTrail(weaponTrail.p2, b.p2);
}

// ── 兵器拖影 ────────────────────────────────────────────────────────
/** 挥动时刃尖划过的弧线。采样只在 attack 状态进行——走路时挥个残影反而脏。
 * 与残影共用同一条逻辑 tick（tickAfterimages），不另起计时器。 */
const TRAIL_LEN = 10;
type TrailPt = { x: number; y: number };
const weaponTrail = { p1: [] as TrailPt[], p2: [] as TrailPt[] };

function stepWeaponTrail(list: TrailPt[], f: Fighter) {
  const w = f.def.weapon;
  if (!w || f.state !== 'attack') { if (list.length) list.length = 0; return; }
  const [tx, ty] = weaponTipOf(poseFor(f), f.x, FLOOR_Y - f.y, f.facing, w);
  list.push({ x: tx, y: ty });
  while (list.length > TRAIL_LEN) list.shift();
}

/** 画拖影：沿采样点连成一条越往回越细越淡的带子。用 lighter 叠加，刃光才亮得起来。 */
function drawTrail(ctx: CanvasRenderingContext2D, list: TrailPt[], color: string) {
  if (list.length < 3) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 1; i < list.length; i++) {
    const k = i / (list.length - 1);       // 0=最旧 1=最新
    ctx.strokeStyle = hexAlpha(color, 0.10 + k * 0.42);
    ctx.lineWidth = 1.5 + k * 6;
    ctx.beginPath();
    ctx.moveTo(list[i - 1].x, list[i - 1].y);
    ctx.lineTo(list[i].x, list[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost, def: CharacterDef) {
  const alpha = g.peak * Math.max(0, 1 - g.age / g.life);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawLimbs(ctx, g.pose, g.x, FLOOR_Y - g.y, g.facing, getParts(def.id), def.palette.main, def.palette.accent, false, def.weapon, 1, 0, def.headless, def.crown, def.build);
  ctx.restore();
}

export function drawWeaponTrail(ctx: CanvasRenderingContext2D, who: 0 | 1, def: CharacterDef) {
  if (def.weapon) drawTrail(ctx, who === 0 ? weaponTrail.p1 : weaponTrail.p2, def.weapon.edge);
}

function drawGhosts(ctx: CanvasRenderingContext2D, list: Ghost[], def: CharacterDef) {
  for (const g of list) drawGhost(ctx, g, def);
}

/** cut-in 用：直接复用已探测的部件缓存里的头像，不另开一份加载请求。缺 head.png（或整个
 * public/chars/ 都没有）时返回 null，调用方（GameCanvas 的 CutInSystem.trigger）据此
 * 优雅跳过 cut-in——不崩、不画空框。 */
export function getHeadPart(id: string): PartImage | null {
  return getParts(id)?.head ?? null;
}

/**
 * 防御指示弧几何：圆心已经在镜像（x + fc*26），角度范围也必须跟着镜像——ctx.arc 的角度
 * 是画布绝对角度（0 = 朝 +x，即屏幕右），不会因为圆心挪到了 fc 那一侧就自动跟着转向。
 * 旧代码只镜像了圆心、角度范围写死 -1.2..1.2，面朝左（fc=-1）时弧仍然鼓向屏幕右侧，
 * 结果鼓进角色自己身体、背对对手，玩家报告"站右边防御方向错了"正是这个（右边的角色
 * 面朝左）。这里的 base 偏移写法直接抄头部高光弧那段现成的正确实现（同文件 hiAngle：
 * `fc === 1 ? 0 : Math.PI`），不用 drawBoneImg 那套 translate/scale(fc,1)——这段弧
 * 本身左右对称，偏移半圈跟镜像变换算出来的角度完全一致，没必要多开一次 save/restore。
 * 抽成纯函数只为了让测试量到这一步的确切产出，drawFighter 和测试各调一次同一份实现。
 */
export function blockArcGeom(x: number, feetY: number, fc: number) {
  const base = fc === 1 ? 0 : Math.PI;
  return { cx: x + fc * 26, cy: feetY - 90, r: 40, a0: base - 1.2, a1: base + 1.2 };
}

/** 颜色明度偏移，用于后侧肢体压暗、肢体柱体渐变两端 */
function shade(hex: string, amt: number): string {
  return pack(parseC(hex).map(v => v + amt));
}

/** 两个颜色按 t 混。走 parseC/pack 而不是照抄 adornments.ts 那份 mix——那个模块引
 * 本模块，在这里反向 import 会成环；两份各写一遍则是同一个式子两处漂移。 */
export function mixC(a: string, b: string, t: number): string {
  const A = parseC(a), B = parseC(b);
  return pack(A.map((v, i) => v + (B[i] - v) * t));
}

/** #rrggbb 与 rgb(r,g,b) 都要认：palette 里存的是前者，shade() 的返回值是后者，
 * 而明暗/混色两级都要吃进同一个函数。 */
function parseC(c: string): [number, number, number] {
  if (c.charCodeAt(0) === 35) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const m = c.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}
function pack(rgb: number[]): string {
  return `rgb(${rgb.map(v => Math.min(255, Math.max(0, Math.round(v)))).join(',')})`;
}

// 血条几何：外框 2px ink 描边，2px 内缩为实际内容区
const BAR_W = 320, BAR_H = 20, BAR_Y = 20;
// 气槽两段：紧贴血条下方，段间留出清楚的间隙——离散两次充能，不是一条连续槽
const SEG_GAP = 10, SEG_H = 16, SEG_Y = BAR_Y + BAR_H + 8;
// ShenxianSerif 子集（Task 25）放栈首，系统衬线留作它没加载出来时的兜底——理由同 banner.ts 的 SERIF
const NAME_FONT = "18px 'ShenxianSerif','Songti SC','SimSun','Noto Serif CJK SC',serif";
const NAME_GAP = 10;
// 角色名最外侧到真实屏幕边缘的安全距离（逻辑单位）：Task 29 之前这里是裸的 10，宽屏下换算成
// 屏幕像素只有十来 px，几乎贴边。放大到 24 让左右留白显得稳定、宽窄屏看着一致——顺带跟
// MuteButton 拉开的垂直间距配合，两套定位系统才不会再抢同一个角
// （那颗键现在是 top=10 的顶部居中，不再是当初的 top=168——TouchLayer 顶部注释记着这段变更）
const HUD_EDGE_MARGIN = 24;

/** 掉血残影：延迟追上真实血量的半透明条，让玩家看清刚才那套连招吃掉了多少。
 * 用 Battle 实例引用而非任何计时器/随机数判断"新一局"——每场 Fight 都是 new Battle()，
 * 引用一变就说明是新的一局，残影必须贴回满血，否则上一局的拖影会漏进下一局第一帧。 */
interface DamageTrail { battle: Battle | null; p1: number; p2: number }
const dmgTrail: DamageTrail = { battle: null, p1: 1, p2: 1 };
const TRAIL_CATCHUP = 0.02; // 每 tick 固定追赶的血量比例（占满血），不读时钟

function stepTrail(cur: number, real: number): number {
  if (real >= cur) return real; // 回血/训练场每 tick 满血重置：残影立刻贴回，不会倒着往回拖
  return Math.max(real, cur - TRAIL_CATCHUP);
}

function resetTrailIfNewBattle(b: Battle): void {
  if (dmgTrail.battle !== b) {
    dmgTrail.battle = b;
    dmgTrail.p1 = b.p1.hp / b.p1.def.hp;
    dmgTrail.p2 = b.p2.hp / b.p2.def.hp;
  }
}

/** 残影推进：必须挂在逻辑 tick 上（GameCanvas 固定步长循环里，紧跟 battle.tick() 之后），
 * 不能挂在 draw() 上——draw() 每个渲染帧跑一次，追赶速度就会绑定屏幕刷新率：60Hz 手机上
 * 追满全程约 0.83s，120Hz 手机上因为一秒钟多跑一倍帧数，同一段掉血看起来快一倍追平，
 * 同一套连招在不同设备上读出"吃了更少血"的错觉。挂在 tick 上，速度只取决于 60Hz 的固定
 * 逻辑步长，跟渲染帧率无关。 */
export function tickDamageTrail(b: Battle): void {
  resetTrailIfNewBattle(b);
  dmgTrail.p1 = stepTrail(dmgTrail.p1, b.p1.hp / b.p1.def.hp);
  dmgTrail.p2 = stepTrail(dmgTrail.p2, b.p2.hp / b.p2.def.hp);
}

/** 残血搏动的周期（逻辑帧）。约 0.75 秒一次——比心跳略慢，看得出是"警告"而不是闪烁噪点 */
const DANGER_PERIOD = 45;

function healthBar(ctx: CanvasRenderingContext2D, x: number, flip: boolean, f: Fighter, trailFrac: number, frame: number) {
  const w = BAR_W, h = BAR_H, y = BAR_Y;
  // 贴片：paper 极淡内衬 + ink 半透明槽底叠在上面——宣纸贴片压了墨线的底色
  ctx.fillStyle = hexAlpha(INK.paper, 0.12);
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = hexAlpha(INK.ink, 0.4);
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

  const ix = x + 2, iy = y + 2, iw = w - 4, ih = h - 4;
  const hpFrac = f.hp / f.def.hp;
  // 残影画在血量条之下：血量条覆盖掉重叠部分，露出的那道半透明红色就是"刚掉的血"
  ctx.fillStyle = hexAlpha(INK.cinnab, 0.5);
  const trailW = trailFrac * iw;
  ctx.fillRect(flip ? ix + iw - trailW : ix, iy, trailW, ih);
  // 残血：转朱砂色**并且搏动**。0.3 这条线不是这里定的，是引擎那条 DESPERATE_HP——
  // 越过它对手就进入「凶暴」（攻击权重翻倍、逃跑权重砍到三成半）。
  // 光换个颜色的话，玩家看不出"从这一刻起对面会拼命"这件事已经发生了。
  const danger = hpFrac <= DESPERATE_HP;
  const hpW = hpFrac * iw;
  // 血条不是一根平涂的进度条：上缘提亮一档，下缘压深，读起来是一块有厚度的颜料
  const hg = ctx.createLinearGradient(0, iy, 0, iy + ih);
  const base = danger ? INK.cinnab : INK.gamboge;
  hg.addColorStop(0, mixC(base, INK.paper, 0.3));
  hg.addColorStop(0.55, base);
  hg.addColorStop(1, mixC(base, INK.ink, 0.25));
  ctx.fillStyle = hg;
  ctx.fillRect(flip ? ix + iw - hpW : ix, iy, hpW, ih);
  if (danger && hpFrac > 0) {
    // 搏动挂在**逻辑帧**上，不是渲染帧：这个项目在"按逻辑帧走的量"上栽过四次，
    // 120Hz 手机上按渲染帧算会让它快一倍（见 MenuBackdrop 那条注释）
    const pulse = 0.22 + 0.22 * (1 - Math.cos(2 * Math.PI * (frame % DANGER_PERIOD) / DANGER_PERIOD)) / 2;
    ctx.fillStyle = hexAlpha(INK.paper, pulse);
    ctx.fillRect(flip ? ix + iw - hpW : ix, iy, hpW, ih);
  }

  // 外框：墨线一整圈，底下垫一层投影——血条压在天空上，没有投影就与背景糊在一起
  ctx.save();
  ctx.shadowColor = 'rgba(4,8,14,.55)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  // 内框：印章那道内缩一圈的细边。血条因此读成"一枚横躺的印章"，而不是一根进度条
  ctx.strokeStyle = hexAlpha(INK.paper, 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 4.5, y + 4.5, w - 9, h - 9);
  // 四分刻度：血量读数靠条的长度，但"还剩多少"要能一眼估出来，刻度给的是比例。
  // 压得很淡——刻度一旦读成分段，血量条就变成"还剩几格"，那是另一套读法
  ctx.strokeStyle = hexAlpha(INK.ink, 0.16);
  for (let i = 1; i < 4; i++) {
    const tx = ix + iw * (i / 4);
    ctx.beginPath(); ctx.moveTo(tx, iy + 1); ctx.lineTo(tx, iy + ih - 1); ctx.stroke();
  }

  // 角色名：血条外侧，p1 右对齐贴左端外，p2 左对齐贴右端外；描边加深底色，避免撞上浅色天空。
  // save/restore 包住文字状态（font/baseline/align/描边宽度全在内）——比逐个手动复位更不容易漏
  ctx.save();
  ctx.font = NAME_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = flip ? 'left' : 'right';
  const tx = flip ? x + w + NAME_GAP : x - NAME_GAP;
  const ty = y + h / 2;
  ctx.strokeStyle = hexAlpha(INK.ink, 0.7);
  ctx.lineWidth = 3;
  ctx.strokeText(f.def.name, tx, ty);
  ctx.fillStyle = INK.paper;
  ctx.fillText(f.def.name, tx, ty);
  ctx.restore();
}

function meterBar(ctx: CanvasRenderingContext2D, x: number, flip: boolean, meter: number) {
  const segW = (BAR_W - SEG_GAP) / 2, y = SEG_Y, h = SEG_H;
  // 两格位置镜像：第一格（0→50）永远贴在角色自己那侧的外沿，与血条的锚定方向一致
  const positions = flip ? [x + BAR_W - segW, x] : [x, x + segW + SEG_GAP];
  for (let i = 0; i < 2; i++) {
    const sx = positions[i];
    const charge = Math.min(50, Math.max(0, meter - i * 50));
    if (charge >= 50) {
      // 充满：不只是"更满"，换描边+发光整体变个状态，一眼认得出这一格解锁了
      ctx.save();
      ctx.shadowColor = INK.gamboge;
      ctx.shadowBlur = 12;
      ctx.fillStyle = INK.gamboge;
      ctx.fillRect(sx, y, segW, h);
      ctx.restore();
      ctx.strokeStyle = INK.paper;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, y, segW, h);
    } else {
      ctx.fillStyle = hexAlpha(INK.ink, 0.4);
      ctx.fillRect(sx, y, segW, h);
      // 石青不是平涂：上缘提亮一档，跟血条同一套"颜料有厚度"的画法
      const mg = ctx.createLinearGradient(0, y, 0, y + h);
      mg.addColorStop(0, mixC(INK.azurite, INK.paper, 0.28));
      mg.addColorStop(1, mixC(INK.azurite, INK.ink, 0.2));
      ctx.fillStyle = mg;
      ctx.fillRect(sx, y, segW * (charge / 50), h);
      ctx.strokeStyle = hexAlpha(INK.ink, 0.8);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, y, segW, h);
    }
    // 内框：与血条同一道印章细边，两行 HUD 读起来是一套东西
    ctx.strokeStyle = hexAlpha(INK.paper, 0.16);
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 2.5, y + 2.5, segW - 5, h - 5);
  }
}

/** visW：本帧实际可见的逻辑宽度（默认等于 LOGIC_W，不传时行为不变）。宽屏下 visW > LOGIC_W，
 * 血条要贴真实屏幕左右边缘（-offX / LOGIC_W+offX），不能停在 960 的边上——否则宽屏两侧会露出
 * 一截背景，血条挤在视觉中央 */
function drawBars(ctx: CanvasRenderingContext2D, b: Battle, visW = LOGIC_W) {
  // 只读，不推进：残影的推进挂在 GameCanvas 的逻辑 tick 上（见 tickDamageTrail）。这里的
  // reset 只是防御性兜底——万一某一渲染帧的 draw() 抢在这场新 Battle 的第一次 tick 之前
  // 跑到，不让上一局的残影露一帧脸
  resetTrailIfNewBattle(b);

  const offX = (visW - LOGIC_W) / 2;
  const leftEdge = -offX, rightEdge = LOGIC_W + offX;

  // 外侧留给角色名的余量按实际文字宽度算，而不是拍一个固定 margin——不然长一点的名字
  // 会被血条或屏幕左右边缘挤掉
  ctx.font = NAME_FONT;
  const margin = Math.max(ctx.measureText(b.p1.def.name).width, ctx.measureText(b.p2.def.name).width) + NAME_GAP + HUD_EDGE_MARGIN;

  healthBar(ctx, leftEdge + margin, false, b.p1, dmgTrail.p1, b.frame);
  healthBar(ctx, rightEdge - margin - BAR_W, true, b.p2, dmgTrail.p2, b.frame);
  meterBar(ctx, leftEdge + margin, false, b.p1.meter);
  meterBar(ctx, rightEdge - margin - BAR_W, true, b.p2.meter);
}
