import { expect, test } from 'vitest';
import touchSrc from '../src/ui/TouchLayer.tsx?raw';
import appSrc from '../src/App.tsx?raw';
import screensSrc from '../src/ui/screens.tsx?raw';
import { BTN, CLUSTER_INSET, LEFT_OF_CLUSTER } from '../src/ui/TouchLayer';
import devSrc from '../DEVELOPMENT.md?raw';

// 触屏按键的坐标全是写死的，而别处（静音键、浮层的让位宽度）要按这张表算——
// 这种耦合一改就散：簇长大了，那些数不会跟着动，也不会有任何报错。
// 所以包围盒一律现算，不往注释里抄：源码里抄过两版，两版的数和归属都是错的。

interface Btn { k: string; s: number; r: number; b: number }
// 直接用导出的 BTN，不再拿正则去刮 TouchLayer.tsx 的源码文本：正则漏掉一颗键
// （换个写法、多个字段、拆行都会漏）不会报错，只会让下面每一条断言都少算一颗，
// 而"少算"看起来和"全过"一模一样。
function buttons(): Btn[] {
  return BTN.map(b => ({ k: b.key, s: b.size, r: b.right, b: b.bottom }));
}

test('按键两两不重叠——重叠的触摸目标必然误触', () => {
  const bs = buttons();
  expect(bs.length, `只解析出 ${bs.length} 颗按键，正则的锚点可能过时了`).toBe(5);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], c = bs[j];
    const dist = Math.hypot((a.r + a.s / 2) - (c.r + c.s / 2), (a.b + a.s / 2) - (c.b + c.s / 2));
    expect(dist, `${a.k} 和 ${c.k} 的圆形触摸区重叠了 ${((a.s + c.s) / 2 - dist).toFixed(0)}px`)
      .toBeGreaterThanOrEqual((a.s + c.s) / 2);
  }
});

// 「不重叠」远远不够：拇指的接触面直径通常 45-57px，两颗键**只隔 4px** 时误触是必然的。
// 七颗键那版实测最小间隙 4.1px（技三与大招之间），而按错的代价是最重的那种——
// 想放技三，按出大招，50-100 气当场蒸发。这条断言钉的是"不容易按错"，不是"没有重叠"。
test('键与键之间留得下一根拇指——间隙与键径都有下限', () => {
  const bs = buttons();
  let worst = { gap: Infinity, pair: '' };
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], c = bs[j];
    const gap = Math.hypot((a.r + a.s / 2) - (c.r + c.s / 2), (a.b + a.s / 2) - (c.b + c.s / 2))
      - (a.s + c.s) / 2;
    if (gap < worst.gap) worst = { gap, pair: `${a.k}/${c.k}` };
  }
  expect(worst.gap, `最挤的一对是 ${worst.pair}，只隔 ${worst.gap.toFixed(1)}px`).toBeGreaterThanOrEqual(10);
  const small = bs.filter(b => b.s < 56);
  expect(small.map(b => `${b.k}(${b.s}px)`), '有键小于 56px——拇指按不准').toEqual([]);
});

test('静音键在任何常见屏高下都不压到按键簇上', () => {
  const bs = buttons();
  const top = Number(/MuteButton[\s\S]{0,120}?top=\{(\d+)\}/.exec(appSrc)?.[1] ?? NaN);
  expect(Number.isFinite(top), 'App 里找不到 MuteButton 的 top——这条断言的锚点过时了').toBe(true);
  const MUTE = 40;                       // 见 screens.tsx 里那颗按钮的 width/height
  const clusterTopFromBottom = Math.max(...bs.map(b => b.b + b.s));   // 簇顶离屏底多远
  const clusterRight = Math.max(...bs.map(b => b.r + b.s));           // 簇最左边离屏右多远
  // 横屏手机到平板：高度 320~1024 都要成立
  for (let h = 320; h <= 1024; h += 2) {
    const clusterTopY = h - clusterTopFromBottom;
    const muteBottomY = top + MUTE;
    const verticalOverlap = clusterTopY < muteBottomY;
    // 只有当两者在水平方向也相交时才算真的压上（静音键贴右边缘，宽 40）
    const horizontalOverlap = clusterRight > 0 && MUTE + 12 > 0;   // 静音键 right=12，宽 40 → 覆盖 12~52
    const hitsCluster = verticalOverlap && horizontalOverlap && bs.some(b =>
      b.r < MUTE + 12 && h - (b.b + b.s) < muteBottomY);
    expect(hitsCluster, `屏高 ${h}px 时静音键压在按键簇上（簇顶 y=${clusterTopY}，静音键底 y=${muteBottomY}）`)
      .toBe(false);
  }
});

// 拇指从屏幕右下角（横屏时右手拇指的支点）能舒服够到的范围大致到半径 230px。
// 吹飞键原来放在圆心离角 288px 处——其余六颗都在 88~230 之间，只有它甩在簇外。
// 而键盘上的「攻击+防御同按」在触屏上做不到（拳键与格挡键隔着 160px，一根拇指按不到），
// 所以那颗键是 CD 在触屏上的唯一入口：够不到 = 这个系统在手机上不存在。
test('每颗按键都落在拇指够得到的半径内', () => {
  const bs = buttons();
  const REACH = 240;   // 230 的舒适半径 + 一点余量
  const far = bs
    .map(b => ({ k: b.k, d: Math.hypot(b.r + b.s / 2, b.b + b.s / 2) }))
    .filter(x => x.d > REACH);
  const show = bs.map(b => `${b.k} ${Math.round(Math.hypot(b.r + b.s / 2, b.b + b.s / 2))}`).join('  ');
  expect(far.map(x => `${x.k}(${Math.round(x.d)}px)`),
    `这些键在拇指够不到的地方：${far.map(x => x.k).join('、')}　全部距离：${show}`).toEqual([]);
});

// 浮层让开按键簇这件事，原来是**两处各写一遍字面量 250**（提示条一份、陪练挡位条一份），
// 而当时只有 TouchLayer 那一份被断言盯着——screens.tsx 那份完全没人守，键表一改它不会跟着动，
// 正好把这次修掉的那个 bug 原样放回来（挡位条吃掉超必杀/吹飞的触摸区）。
// 现在 CLUSTER_INSET 由 BTN 推出来、两个浮层共用 LEFT_OF_CLUSTER。
test('让位宽度从键表算出来，两个浮层都用同一份', () => {
  const bs = buttons();
  const clusterLeft = Math.max(...bs.map(b => b.r + b.s));   // 簇最左沿离屏幕右边缘多远
  // 写成精确关系而不是 `>=`：后者在 CLUSTER_INSET = clusterLeft + 10 时**恒真**，
  // 连键表读空了（clusterLeft 变 -Infinity）都照样绿，等于没断言
  expect(CLUSTER_INSET, 'CLUSTER_INSET 不再等于「簇最左沿 + 10」').toBe(clusterLeft + 10);
  // **正面**断言：两个浮层都必须用这份共享样式。
  // 反面写法（禁止出现手写的 `right: calc(Npx + env(...))`）试过，两头都不成立：
  // 它会误伤任何一个同样贴右边缘的无关元素（screens.tsx 里静音键就是这个形状，
  // 只因为写成模板字面量才侥幸躲过），又能被换引号、换反引号、少一个空格轻易绕开。
  for (const [name, src] of [['TouchLayer', touchSrc], ['screens', screensSrc]] as const) {
    expect(src.includes('...LEFT_OF_CLUSTER'),
      `${name} 里的浮层没有 spread LEFT_OF_CLUSTER，让位宽度多半又是手写的`).toBe(true);
  }
  // 共享的可变对象：谁不 spread、直接拿去改，就会同时挪走提示条和挡位条，
  // 而症状指向的地方离改坏它的文件很远
  expect(Object.isFrozen(LEFT_OF_CLUSTER), 'LEFT_OF_CLUSTER 没冻上').toBe(true);
});

// 陪练场的「退出训练场」曾经是 App 里一颗独立的固定元素，摆在顶部中线左侧的"空档"里，
// 而那个空档是估出来的、估错了：左侧 HUD（血条+气槽）的右沿实测 568x320 在 x=250、
// 667x375 在 294、844x390 在 306，中线减 6px 分别是 278/327/416——左半边真正空着的只有
// 28/33/110px，一颗五个字的键放不下，三档里有两档整个压在玩家血条上。
// 挪成 TrainingBar 内部的一行之后，排版交给同一个盒子，不会再有两个固定元素抢同一块空地。
//
// 出口**还在不在**由 tests/training.test.ts 按渲染结果验（那边本来就有树遍历的工具）。
// 这里只守 App 这一侧的反面，而且只认 `label="退出训练场"` 这一种写法：
// 它是**防手滑**（改回旧摆法时会红），不是防绕开——真要绕，换个写法就过去了。
test('App 里没有再冒出一颗独立的退出键', () => {
  expect(/label="退出训练场"/.test(appSrc),
    'App 里又出现了独立的退出键，会和挡位条抢同一块空地').toBe(false);
});

// 开发笔记「七键并成五键」一节报了两个数：最小间隙与最小键径。它旁边原来还写着"这两个数由
// `touchDoc` 那条测试跟 BTN 表对着"——**仓库里根本没有 touchDoc 这条测试**，
// 那句话是假的，而它恰好属于那份笔记自己总结的那一类（声称被守着、其实没人守）。
// 与其删掉那句话，不如让它变成真的：这条就是它说的那条。
//
// 必须钉在「**现在**……」那一句上：同一节讲七键旧版时也写了"最小间隙/最小键径"，
// 只按词去匹会命中旧版那组数（4.1/54），报出来的差值指向历史留档、不是当前布局。
// （这条锚点是从 addCharDoc.test.ts 里那条重复的守门并过来的——同一句话被两条
// 测试守着，等于没人对它负责。）
test('开发笔记报的最小间隙/键径与键表对得上', () => {
  const bs = buttons();
  let worst = Infinity;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], c = bs[j];
    worst = Math.min(worst, Math.hypot((a.r + a.s / 2) - (c.r + c.s / 2), (a.b + a.s / 2) - (c.b + c.s / 2)) - (a.s + c.s) / 2);
  }
  // 先切到那一节再匹：同一节里讲七键旧版也写了"最小间隙/最小键径"，全文匹会命中历史留档
  const sec = devSrc.slice(devSrc.indexOf('### 七键并成五键'));
  expect(sec.length, 'DEVELOPMENT.md 里找不到「### 七键并成五键」这一节——锚点过时了').toBeGreaterThan(0);
  const m = /现在最小间隙 \*\*([\d.]+)px\*\*、最小键径 (\d+)px/.exec(sec);
  expect(m, 'DEVELOPMENT.md 里那句「现在最小间隙…、最小键径…」找不到了——这条断言的锚点过时了').toBeTruthy();
  expect(Number(m![1]), '开发笔记写的最小间隙与 BTN 表算出来的对不上').toBeCloseTo(worst, 1);
  expect(Number(m![2]), '开发笔记写的最小键径与 BTN 表算出来的对不上').toBe(Math.min(...bs.map(b => b.s)));
});
