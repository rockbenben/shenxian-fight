import { expect, test } from 'vitest';
import { Help } from '../src/ui/screens';
import screensSrc from '../src/ui/screens.tsx?raw';
import indexHtml from '../index.html?raw';

// 帮助页曾经把「返回」按钮挤出屏幕：进阶系统这几轮加到十几项，三栏在 568x320（SE 横屏）
// 下折行，内容底部实测顶到 391px（视口只有 320），按钮跑到屏幕外——按不到就出不去这一页。
//
// 项目没装 jsdom，量不了真实像素（那部分是拿浏览器 iframe 逐个分辨率实测的）。
// 这里守的是**结构**：说明区自己滚动，而「返回」在滚动区之外。
// 只要这条成立，说明区再长也只会滚，不会把按钮推走。

type El = { type: unknown; props?: Record<string, unknown> };
const isEl = (n: unknown): n is El =>
  typeof n === 'object' && n !== null && 'type' in n && 'props' in n;

function find(node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { for (const n of node) find(n, pred, out); return out; }
  if (!isEl(node)) return out;
  if (pred(node)) out.push(node);
  find(node.props?.children, pred, out);
  return out;
}

const tree = Help({ onBack: () => {} });
const style = (e: El) => (e.props?.style ?? {}) as React.CSSProperties;
const textOf = (n: unknown): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isEl(n)) return textOf(n.props?.children);
  return '';
};

const panes = find(tree, e => style(e).overflowY === 'auto');
const pane = panes[0];
// pane 提到模块级是为了不用查四遍，但它一旦是 undefined，下面几条会**静静地空过**
//（find(undefined, …) 返回 []，于是「返回不在滚动区里」这条在根本没有滚动区时也绿）
// 或者抛一个没有信息量的 TypeError。就地拦下来，让失败带着话说。
if (!pane) throw new Error('说明区（overflowY: auto 那一块）不见了，下面几条断言全部失去意义');

test('说明区可以自己滚动——内容再多也不会把页面撑高', () => {
  expect(panes.length, '找不到可滚动的说明区').toBe(1);
  // minHeight: 0 是 flex/grid 子项能真正收缩的前提，漏了它滚动条永远不出现
  expect(style(pane).minHeight, '说明区没写 minHeight: 0，在网格里收缩不了').toBe(0);
});

test('「返回」在滚动区之外——说明再长也推不走它', () => {
  // 返回是 <Ghost label="返回">，文字在 prop 上而不在 children 里——只走 children 找不到它
  const isBack = (e: El) => e.props?.label === '返回' || textOf(e.props?.children).trim() === '返回';
  const anywhere = find(tree, isBack);
  expect(anywhere.length, '整页找不到返回按钮').toBeGreaterThan(0);
  const inPane = find(pane, isBack);
  expect(inPane.length, '返回按钮被放进了滚动区，内容一长就会被推到屏幕外').toBe(0);
});

test('说明覆盖了这几轮加的系统——玩家找不到的系统等于不存在', () => {
  const all = textOf(tree) + find(tree, () => true).map(e => String(e.props?.label ?? '')).join('');
  for (const k of ['蹲防', '连段取消', '反击命中', '爆气', '投技解脱', '下段扫堂']) {
    expect(all.includes(k), `操作说明里没有「${k}」`).toBe(true);
  }
  // 三处曾经描述的是已经不存在的游戏，别再退回去
  expect(all.includes('按住 S + L'), '蓄气的输入早就从 蹲+防 改成了 防+大招键').toBe(false);
  expect(all.includes('被投时按着'), '投技解脱已经改成边沿判定，按住不放无效').toBe(false);
});

// 说明区自己垫一张暗底。MenuBackdrop 那轮月亮画在固定的逻辑坐标上，844x390 / 932x430 下
// 正好落在「进攻」栏头两行背后——宣纸色的字压在宣纸色的月面上，「先行输入」「连段取消」
// 两行实测读不出来。S.full 那道 textShadow 兜得住亮山脊，兜不住这么大一块亮面。
test('说明区有自己的暗底——月亮正好画在这一屏的字后面', () => {
  // background 与 backgroundColor 两种写法都算：这一条要验的是"有没有暗底"，
  // 不是"用哪个属性名写的"。只认 background 的话，改成等价的 backgroundColor
  // 会以「说明区没有底色」这条假消息报红
  const s2 = style(pane);
  expect(s2.background ?? s2.backgroundColor,
    '说明区没有底色，文字会被 MenuBackdrop 的月亮压掉').toBeTruthy();
});

// 「下面还有」的记号。这一页在窄屏上藏的比露的还多（568x320 实测视口内 235px、
// 底下压着 258px），而手机上的滚动条是 overlay 的，静止时一条都看不见，
// 「返回」又常驻在底部——整栏「防守」从来没有被人看见过。
// 渐隐（index.html 的 .sx-more）由 ref 回调按滚动位置挂/摘；写成 ref 回调而不是 hook，
// 是为了这个文件能继续把 Help 当纯函数直接调用（上面那三条断言都靠这一点）。
// 这一条只是**防删**：它证明不了渐隐真的会开关（那要真实滚动，得开浏览器量），
// 只保证那个开关还挂在说明区上。别把它当行为断言读。
test('说明区还挂着渐隐开关（防删，不验行为）', () => {
  expect(typeof pane.props?.ref, '说明区没挂 ref——"下面还有"的渐隐就没人开关了').toBe('function');
});

// 「下面还有」那道渐隐现在是**跨文件**的：类名在 screens.tsx 里挂，渐变写在 index.html 的
// 内联样式里。两头对不上不会有任何报错——tsc 过、测试过、check-anchors 也看不见，
// 而后果正是这个功能要治的那个 bug（窄屏上整栏「防守」重新消失）。
test('渐隐的类名两头对得上——这是一处跨文件耦合', () => {
  expect(indexHtml.includes('.sx-more'), 'index.html 里没有 .sx-more 规则，渐隐没了').toBe(true);
  expect(/\.sx-more\s*\{[^}]*mask-image/.test(indexHtml), '.sx-more 已经不是渐隐了').toBe(true);
  expect(screensSrc.includes("'sx-more'"), 'screens.tsx 不再挂 sx-more 这个类').toBe(true);
});
