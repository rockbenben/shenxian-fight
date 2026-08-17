import { expect, test } from 'vitest';
import { Title } from '../src/ui/screens';

/**
 * 标题页右下角那个回源码的入口。
 *
 * 断言的是 **Title 真的渲染出它**，不是「screens.tsx 里搜得到这个字符串」——
 * 后者在把 JSX 删掉、只留一个常量的重构里照样绿（这个仓库刚因为源码文本断言
 * 吃过亏，见 DEVELOPMENT.md「七键并成五键」那节末尾）。
 *
 * 三件事各自会坏，各自守：
 *  · 链接在重构里被删掉 —— 树里找不到
 *  · URL 敲错 / 指向别的仓库 —— href 对不上
 *  · `rel` 被顺手删掉 —— target=_blank 少了 noopener 就是一个真实的安全口子
 */
type El = { type: unknown; props?: Record<string, unknown> };
const isEl = (n: unknown): n is El =>
  typeof n === 'object' && n !== null && 'type' in n && 'props' in n;

function walk(node: unknown, found: El[]) {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, found); return; }
  if (!isEl(node)) return;
  found.push(node);
  walk(node.props?.children, found);
}

test('标题页渲染出回源码的链接，且带 noopener', () => {
  const tree: El[] = [];
  walk(Title({ onStart() {}, onTraining() {}, onHelp() {} }), tree);

  // SourceLink 没有导出，按函数名找。**不能顺手把所有函数组件都调一遍**——
  // MuteButton 里有 useState，脱离 React 调用会直接抛。
  const holder = tree.find(e => typeof e.type === 'function' && (e.type as { name?: string }).name === 'SourceLink');
  expect(holder, 'Title 里找不到 <SourceLink />——它被删了，或者改了名（那这条断言的锚点也过时了）').toBeTruthy();

  const anchor: El[] = [];
  walk((holder!.type as (p: unknown) => unknown)(holder!.props), anchor);
  const a = anchor.find(e => e.type === 'a');
  expect(a, 'SourceLink 渲染出来的不是 <a>——不是原生链接就没法「在新标签打开」「复制链接地址」').toBeTruthy();

  expect(a!.props?.href, '源码链接指向的不是本仓库').toBe('https://github.com/rockbenben/shenxian-fight');
  expect(a!.props?.target, '外链要在新标签打开：这是个全屏 PWA 游戏，原地跳走等于把人踢出对局').toBe('_blank');
  expect(String(a!.props?.rel ?? ''), 'target=_blank 必须配 rel=noopener，否则新页面能通过 window.opener 操纵本页')
    .toContain('noopener');
});
