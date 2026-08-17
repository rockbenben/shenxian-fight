import { expect, test } from 'vitest';
import { Select } from '../src/ui/screens';
import { CHARACTERS } from '../src/data/characters';

// Task：选人页四张角色卡曾经是纯 <div onClick>，键盘用户 Tab 不到、Enter/Space 按不动——
// 键盘玩家能打比赛却进不了比赛。这里不挂载真实 DOM（项目没装 jsdom/@testing-library），
// 直接调用 Select() 拿到 React element 树，走结构断言：找到的可交互节点必须是原生可
// 聚焦控件（<button>，或显式 role="button"+tabIndex 的等价物），且可访问名等于角色名。
// 把实现改回纯 <div onClick> 这条测试就会红。

type El = { type: unknown; props?: Record<string, unknown> };

function isEl(node: unknown): node is El {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node;
}

function walk(node: unknown, found: El[]) {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, found); return; }
  if (!isEl(node)) return; // 字符串/数字文本节点，textOf() 单独处理
  found.push(node);
  walk(node.props?.children, found);
}

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isEl(node)) return textOf(node.props?.children);
  return '';
}

function accessibleName(el: El): string {
  const ariaLabel = el.props?.['aria-label'];
  if (typeof ariaLabel === 'string' && ariaLabel.trim()) return ariaLabel.trim();
  return textOf(el.props?.children).trim();
}

function isNativelyFocusable(el: El): boolean {
  if (el.type === 'button') return true;
  // 等价物：role="button" 必须配 tabIndex 才真正 Tab 得到，两者缺一都不算
  return el.props?.role === 'button' && typeof el.props?.tabIndex === 'number';
}

test('每张角色卡都是键盘可达的控件，可访问名以角色名开头并带上定位', () => {
  const tree = Select({ onPick: () => {}, onBack: () => {} });
  const all: El[] = [];
  walk(tree, all);

  // 数的是**原生 <button> 的角色卡**。确定印与返回是 Seal/Ghost 组件元素，
  // 这个遍历器不渲染组件、只走元素树，所以看不到它们内部的 button（它们各自渲染 <button>，
  // 由下面那条"印章交出去的是谁"的断言从 props 一侧盯住）。
  // 卡面从"名号 + 四条属性 + 超必杀名"收成只剩名号：十二张卡各画四条属性条是读不完的
  const focusable = all.filter(isNativelyFocusable);
  expect(focusable).toHaveLength(CHARACTERS.length);

  // 卡面加了体力/身法比例条之后，可访问名不再等于角色名：那两条是纯视觉的，读屏取不到
  // 数值，不给 aria-label 就会念成「哪吒体力身法三头六臂」。断言因此从"等于角色名"改成
  // 两条更强的性质——① 以角色名开头（这张卡是谁，一开口就知道）② 带上该角色的超必杀名
  // （念的是卡面真实内容，不是一个光秃秃的标签）。改回纯 <div onClick>、去掉 aria-label
  // 或把卡面内容换掉，这条依然会红。
  const names = focusable.map(accessibleName);
  for (const c of CHARACTERS) {
    const hit = names.find(n => n.startsWith(c.name));
    expect(hit, `缺少角色「${c.name}」对应的键盘可达控件`).toBeTypeOf('string');
    // 卡面上现在只有名号，读屏至少要多念一句"他是什么打法"——那正是这一页要做的决定
    expect(hit, `「${c.name}」的可访问名没带上定位`).toContain(c.role);
  }
});

// 属性条本身是纯视觉的，读屏取不到数值。它们从卡上挪进详情面板之后，
// 那一组的 aria-label 就是四个数值**唯一**的读屏入口——丢了它，这四项对读屏用户等于不存在
test('详情面板的四项数值读屏念得出', () => {
  const tree = Select({ onPick: () => {}, onBack: () => {}, pick: 1 });
  const all: El[] = [];
  walk(tree, all);
  const label = all.map(accessibleName).find(n => n.includes('体力') && n.includes('攻程'));
  expect(label, '详情面板没有把四项数值念出来').toBeTypeOf('string');
  for (const k of ['体力', '身法', '力道', '攻程']) {
    expect(label, `读屏念不到「${k}」：${label}`).toContain(k);
  }
  expect(label, '念的不是当前选中那个人的数值').toContain(String(CHARACTERS[1].hp));
});

// 点卡只是**选中**，按印章才进场。四个人时"点一下就进去"也够用，
// 十二个人时玩家需要一个比较的动作——所以这条断言从"点卡即 onPick"改成两段：
// 点卡把选中位置交出去，印章用当前选中的人调用 onPick。
test('点卡是选中，按印章才进场', () => {
  const focused: number[] = [];
  const tree = Select({ onPick: () => {}, onBack: () => {}, onFocus: i => focused.push(i) });
  const all: El[] = [];
  walk(tree, all);
  const cards = all.filter(isNativelyFocusable)
    .filter(e => CHARACTERS.some(c => accessibleName(e).startsWith(c.name)));
  expect(cards.length, '找不到角色卡').toBe(CHARACTERS.length);
  for (const el of cards) {
    const onClick = el.props?.onClick as (() => void) | undefined;
    expect(onClick, `${accessibleName(el)} 缺少 onClick`).toBeTypeOf('function');
    onClick!();
  }
  expect(focused, '点卡没有把选中位置交出去').toEqual(CHARACTERS.map((_, i) => i));

  // 印章交出去的必须是**当前选中**那个人，不是永远第一个
  for (let i = 0; i < CHARACTERS.length; i++) {
    const picked: string[] = [];
    const t = Select({ onPick: c => picked.push(c.id), onBack: () => {}, pick: i });
    const seals = find2(t).filter(e => e.props?.label === '就是他' || e.props?.label === '进陪练场');
    expect(seals.length, '找不到确定印').toBe(1);
    (seals[0].props!.onClick as () => void)();
    expect(picked, `选中第 ${i} 个，印章交出去的却不是他`).toEqual([CHARACTERS[i].id]);
  }
});

function find2(node: unknown, out: El[] = []): El[] {
  walk(node, out);
  return out;
}

// 选人卡的名号是**竖排**的，高度余量按最长的名字算。这条断言守的是那个前提：
// 卡面字号只分「三字及以下」和「四字」两档（见 screens.tsx 里那段注释），
// 名册里冒出五个字的名字时，它会静默折成两列——而这个项目已经栽过两次
//（通关印挤掉「二郎神」→「神二／郎」；四字的「铁扇公主」→「铁扇／公主」），
// 两次都是单元测试全绿、打开浏览器才看见的。
test('没有角色的名号长到卡面排不下', () => {
  for (const c of CHARACTERS) {
    expect(c.name.length, `「${c.name}」有 ${c.name.length} 个字，竖排会折成两列——卡面只按到四字排版`)
      .toBeLessThanOrEqual(4);
  }
});
