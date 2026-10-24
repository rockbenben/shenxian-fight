import { expect, test } from 'vitest';
import { headScale, headMountDx, chinGapOf } from '../src/render/renderer';
import type { PartImage } from '../src/render/parts';

const img = {} as HTMLImageElement;
const head = (w: number, h: number): PartImage =>
  ({ img, top: 0, bottom: h, left: 0, right: w });
/** 脸框：[x, y, 宽, 高]（整幅图的绝对坐标） */
const face = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x, y, w, h];

test('头的高度就是内容盒高——素材契约保证头填满画幅', () => {
  // 新一版素材的契约是"头填满画幅"，实测十一个人的内容盒高 123~124 像素。
  // 于是内容盒高**就是**头高，缩放只剩一条锚：把头缩到同一个逻辑高度。
  const s = headScale(head(120, 124));
  expect(124 * s).toBeCloseTo(40, 6);        // 目标：40 逻辑单位高
  expect(123 * s).toBeCloseTo(40 * 123 / 124, 6);   // 盒高差一像素，差值也只该是一像素级
});

test('同一张脸框、同一个内容盒 → 同一个尺度', () => {
  // 归一是纯函数：同样的输入必须给同样的输出，否则十二个人的头会各画各的。
  const a = headScale(head(120, 124));
  const b = headScale(head(120, 124));
  expect(a).toBe(b);
});

test('归一的是尺度，不是形状——宽脸仍然宽、长脸仍然长', () => {
  // 不能为了统一把每颗头都压成同一个方框——那正是最早"哪吒的脸被压扁"的做法。
  // 同一个内容盒下，脸框更宽的那颗，画出来仍然更宽。
  const h = head(120, 124);
  const wide = headMountDx(h, face(30, 30, 70, 50), headScale(h));
  const narrow = headMountDx(h, face(40, 30, 40, 50), headScale(h));
  expect(wide).toBeGreaterThan(narrow);
});

test('头的缩放与躯干素材无关——重切躯干不该改变任何人的头', () => {
  // 照着真发生的回归写的：为修躯干长宽比重切了一轮素材，
  // 躯干内容宽从 124 变成 108~156，全员的头尺寸跟着变了。
  // 切图脚本的裁切参数不该有改变头部尺寸的权力。
  expect(headScale.length).toBe(1);   // 签名里只有头贴图，没有躯干
});

test('挂点：脸在整幅右边时，整幅要往左挪——脸心才落在身体中轴上', () => {
  // 头贴图里的飘带/翎羽/帽翅都长在左边，脸心因此偏在整幅中心右边。
  // 不挪的话，脸被推到身体中轴右边 2~10 像素，**脖子接在耳朵那一侧**——
  // 头看着就不在身体上（哪吒那条飘带把整幅撑到 117 宽，脸心偏右 19.5 像素）。
  const h = head(117, 123);
  const f = face(54, 40, 58, 66);          // 脸在整幅的右侧
  const dx = headMountDx(h, f, headScale(h));
  expect(dx).toBeGreaterThan(0);            // 脸在右边 → 整幅要左挪
  // 渲染层把整幅画在 -dw/2 - dx：整幅中心落到局部 -dx，脸心在整幅里的偏移是
  // (faceCtr-boxCtr)×scale = dx，两者相消 ⇒ 脸心落在局部 0，也就是颈点上。
  const boxCtr = (h.left + h.right) / 2;
  const faceCtr = f[0] + f[2] / 2;
  const faceOffsetInBox = (faceCtr - boxCtr) * headScale(h);
  expect(-dx + faceOffsetInBox).toBeCloseTo(0, 6);
});

test('脖子要够到下巴——下巴到整幅底边的那一段', () => {
  // 头贴图是半身像，下缘渐隐，下巴在整幅底边之上好几像素。
  // 脖子原先只伸到固定高度，下巴与脖子之间就露出一截背景——头和颈看着是断开的两截。
  const h = head(117, 123);
  const f = face(54, 40, 58, 66);          // 脸底在 y=106
  const gap = chinGapOf(h, f, headScale(h));
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeCloseTo((123 - 106) * headScale(h), 6);
});

test('没有脸框就不挪——程序化圆头那条分支不受影响', () => {
  const h = head(120, 124);
  expect(headMountDx(h, undefined, headScale(h))).toBe(0);
  expect(chinGapOf(h, undefined, headScale(h))).toBe(0);
});
