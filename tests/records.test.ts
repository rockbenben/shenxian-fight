import { expect, test } from 'vitest';
/** 空战绩：分档之后每份记录有三档，用例只关心标准档那一份 */
const E = { bestStage: 0, bestMs: null, cleared: [] as string[] };
import { find } from './helpers';
import { CHARACTERS } from '../src/data/characters';
import { Select } from '../src/ui/screens';
import appSrc from '../src/App.tsx?raw';
import { EMPTY, fmtTime, merge, summary, type Record, featOf, readRecord } from '../src/ui/records';
import { STAGES } from '../src/data/stages';
import { Title } from '../src/ui/screens';
import { DIFFICULTIES, HARDEST_DIFF } from '../src/data/stages';



// 闯关记录。通关一次和从没打过是一样的话，这一趟没留下任何东西。
// 只存两件：最远第几关、最快通关用时。不造分数——这个游戏没有得分体系，
// 硬编一个（连段数×伤害之类）只会是个假指标。

const LAST = STAGES.length - 1;

type El = { type: unknown; props?: Record2 };
type Record2 = { [k: string]: unknown };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'type' in n && 'props' in n;
const textOf = (n: unknown): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isEl(n)) return textOf((n.props as { children?: unknown })?.children);
  return '';
};

test('输了不记，赢了才把进度往前推', () => {
  let r: Record = EMPTY;
  r = merge(r, 0, false, 5000, LAST);
  expect(featOf(r, 1).bestStage, '输了也记了进度').toBe(0);
  r = merge(r, 0, true, 5000, LAST);
  expect(featOf(r, 1).bestStage).toBe(1);
  r = merge(r, 2, true, 5000, LAST);
  expect(featOf(r, 1).bestStage).toBe(3);
  // 回头重打第一关，不该把记录从 3 退回 1。
  //（第一版这里只打到第 1 关就回头重打，两种实现都给 1，红检时压根暴露不出来）
  r = merge(r, 0, true, 5000, LAST);
  expect(featOf(r, 1).bestStage, '重打前面的关把记录冲掉了').toBe(3);
});

test('只有打完最后一关才记时间——半途的用时没有可比性', () => {
  let r: Record = EMPTY;
  r = merge(r, 0, true, 9000, LAST);
  expect(featOf(r, 1).bestMs, '第一关就记了通关时间').toBeNull();
  r = merge(r, LAST, true, 240000, LAST);
  expect(featOf(r, 1).bestMs).toBe(240000);
  // 更快的一次才刷新
  r = merge(r, LAST, true, 300000, LAST);
  expect(featOf(r, 1).bestMs, '更慢的一次覆盖了最快记录').toBe(240000);
  r = merge(r, LAST, true, 180000, LAST);
  expect(featOf(r, 1).bestMs).toBe(180000);
});

test('通关之后显示"已通关"，而不是"最远 第四关"', () => {
  const mid = merge(EMPTY, 1, true, 0, LAST);
  expect(summary(mid, LAST)).toBe('最远 第二关');
  const done = merge(mid, LAST, true, 251000, LAST);
  expect(summary(done, LAST)).toContain('已通关');
  expect(summary(done, LAST)).toContain('4:11');
});

test('没有记录时不显示这一行——第一次进来不该看见一行空的', () => {
  expect(summary(EMPTY, LAST)).toBe('');
  const el = Title({ onStart: () => {}, onTraining: () => {}, onHelp: () => {}, record: '' });
  expect(textOf(el).includes('最远'), '没有记录时仍然画了记录行').toBe(false);
  const el2 = Title({ onStart: () => {}, onTraining: () => {}, onHelp: () => {}, record: '最远 第三关' });
  expect(textOf(el2), '有记录时标题页没画出来').toContain('最远 第三关');
});

test('时间格式：分:秒，超过一小时不显示成 73:20', () => {
  expect(fmtTime(0)).toBe('0:00');
  expect(fmtTime(65000)).toBe('1:05');
  expect(fmtTime(251000)).toBe('4:11');
  expect(fmtTime(3600 * 1000)).toBe('—');
});

// 通关一次之后"为什么还要再玩"，街机的经典答案是把每个人都通一遍。
// 此前记录只存最远关卡与最快用时，不知道你用谁通的，于是这条路根本不存在。

test('通关才记角色，半途赢下一关不记', () => {
  let r = EMPTY;
  r = merge(r, 1, true, 60_000, 3, 'nezha');          // 赢下第二关，不是最后一关
  expect(featOf(r, 1).cleared, '半途赢一关也记成通关了').toEqual([]);
  r = merge(r, 3, true, 240_000, 3, 'nezha');         // 通关
  expect(featOf(r, 1).cleared, '通关了却没记角色').toEqual(['nezha']);
});

test('同一个角色通关两次只记一次，换人才增加', () => {
  let r = merge(EMPTY, 3, true, 240_000, 3, 'nezha');
  r = merge(r, 3, true, 200_000, 3, 'nezha');
  expect(featOf(r, 1).cleared, '同一个人通关两次记了两条').toEqual(['nezha']);
  r = merge(r, 3, true, 300_000, 3, 'wukong');
  expect(featOf(r, 1).cleared, '换人通关没有记上').toEqual(['nezha', 'wukong']);
});

test('输了不记，也不会把已有的抹掉', () => {
  const r = merge(merge(EMPTY, 3, true, 240_000, 3, 'nezha'), 3, false, 0, 3, 'wukong');
  expect(featOf(r, 1).cleared).toEqual(['nezha']);
});

test('通关之后标题页才报角色进度——没通关过的人不该看到 0/4', () => {
  const mid = merge(EMPTY, 1, true, 0, 3, 'nezha');    // 最远第二关
  expect(summary(mid, 3, 4), '还没通关就报了角色进度').not.toContain('人');
  const done = merge(mid, 3, true, 277_000, 3, 'nezha');
  const line = summary(done, 3, 4);
  expect(line, '通关后没报角色进度').toContain('还差 3 人');
  expect(line.match(/已通关/g)?.length, '「已通关」出现了两次，读起来别扭').toBe(1);
  expect(summary(merge(merge(merge(done, 3, true, 300_000, 3, 'wukong'), 3, true, 300_000, 3, 'erlang'), 3, true, 300_000, 3, 'niumo'), 3, 4), '四人全通了没报成就').toContain('4 人皆通');
  expect(line, '通关后丢了最快用时').toContain('4:37');
});

test('旧存档没有这个字段时回落成空数组，而不是丢掉整份记录', () => {
  // readRecord 走 localStorage，这里直接验形状：merge 对缺字段的旧记录不该崩
  const legacy = { byDiff: [E, { bestStage: 4, bestMs: 300_000, cleared: [] }, E], diff: 1 } as ReturnType<typeof merge>;
  const r = merge(legacy, 3, true, 250_000, 3, 'erlang');
  expect(featOf(r, 1).cleared).toEqual(['erlang']);
  expect(featOf(r, 1).bestMs, '更快的用时没有覆盖旧记录').toBe(250_000);
});

// 关序号的中文数字曾经写死成「一二三四」：阶梯加到六关之后，打到第五关的人
// 在标题页看到的是「最远 第undefined关」。单元测试全绿——是打开浏览器看见的。
test('关序号在任何关数下都念得出来，不会出 undefined', () => {
  for (let best = 1; best <= 12; best++) {
    const line = summary({ byDiff: [E, { bestStage: best, bestMs: null, cleared: [] }, E], diff: 1 }, 5, 12);
    expect(line, `bestStage=${best} 时标题页是「${line}」`).not.toContain('undefined');
    expect(line.length, `bestStage=${best} 时标题页是空的`).toBeGreaterThan(0);
  }
  // 六关阶梯下打到第五关，读出来要是「第五关」
  expect(summary({ byDiff: [E, { bestStage: 5, bestMs: null, cleared: [] }, E], diff: 1 }, 5, 12)).toContain('第五关');
});

// 标题页那行「已通关 N/4 人」看过就走，而做决定是在选人页——
// 「还差谁」要在玩家挑人的那一刻看得见。
test('选人页给通关过的角色盖印，没通关的不盖', () => {
  const tree = Select({ onPick: () => {}, onBack: () => {}, cleared: [CHARACTERS[0].id] });
  const seals = find(tree, e => e.props?.children === '通');
  expect(seals.length, `盖了 ${seals.length} 个印，应该只有 1 个`).toBe(1);
});

test('读屏也念得出通关状态——印是 aria-hidden 的方块，得靠卡的标签', () => {
  const tree = Select({ onPick: () => {}, onBack: () => {}, cleared: [CHARACTERS[1].id] });
  const cards = find(tree, e => typeof e.props?.['aria-label'] === 'string'
    && CHARACTERS.some(c => String(e.props!['aria-label']).startsWith(c.name + '，' + c.role)));
  expect(cards.length, '没找到角色卡').toBe(CHARACTERS.length);
  const done = cards.filter(e => String(e.props!['aria-label']).includes('已通关'));
  expect(done.length, '读屏标签里没有标出通关状态').toBe(1);
  expect(String(done[0].props!['aria-label']).startsWith(CHARACTERS[1].name),
    '通关标记盖在了错误的角色上').toBe(true);
});

test('App 把通关记录传给了选人页', () => {
  // 分档之后取的是**当前档**那一份：合着传就等于把轻松档的通关印盖到修罗档上
  expect(/cleared=\{featOf\(rec, diff\)\.cleared\}/.test(appSrc), 'App 没有把当前难度档的通关记录传给选人页').toBe(true);
});

// 三档合着存是不诚实的：轻松六关连过 19.8%、标准 0.8%、修罗 0.0%，
// 合并之后「已通关」「最快 4:37」「通了几个人」全都分不出是在哪一档拿的，
// 而「在修罗档通关」正是难度档要买的那份重玩理由。
test('战绩逐档分开记，互不串档', () => {
  let r: Record = EMPTY;
  r = merge(r, LAST, true, 200_000, LAST, 'nezha', 0);      // 轻松通关
  expect(featOf(r, 0).bestStage, '轻松档没记上').toBe(LAST + 1);
  expect(featOf(r, 1).bestStage, '轻松档的战绩串到了标准档').toBe(0);
  expect(featOf(r, 2).bestStage, '轻松档的战绩串到了修罗档').toBe(0);
  expect(featOf(r, 0).cleared).toEqual(['nezha']);
  expect(featOf(r, 1).cleared, '通关角色串档了').toEqual([]);

  r = merge(r, LAST, true, 300_000, LAST, 'wukong', 2);     // 修罗通关（更慢）
  expect(featOf(r, 2).bestMs, '修罗档没记上用时').toBe(300_000);
  expect(featOf(r, 0).bestMs, '修罗档的用时把轻松档冲掉了').toBe(200_000);
});

test('标题页那行说清是哪一档拿的', () => {
  let r: Record = EMPTY;
  r = merge(r, LAST, true, 200_000, LAST, 'nezha', 2);
  const line = summary(r, LAST, 12, 2, '修罗');
  expect(line, '没说是哪一档').toContain('修罗档');
  expect(line).toContain('已通关');
  // 没打过的那一档不该显示别档的战绩
  expect(summary(r, LAST, 12, 0, '轻松'), '轻松档没打过却报了战绩').toBe('');
});

// 分档之前的存档是一份平的（bestStage/bestMs/cleared 挂在根上），那时只有一条曲线，
// 也就是现在的标准档——迁移必须并进标准档，不能丢，也不能误记到别的档
test('旧存档并进标准档，不丢也不误记', () => {
  const legacy = { bestStage: 4, bestMs: 250_000, cleared: ['nezha', 'erlang'] };
  // 这套测试跑在没有 DOM 的环境里，readRecord 直接读 window.localStorage——
  // 塞一个最小的替身进去，测的是**迁移逻辑**而不是浏览器
  const store: { [k: string]: string } = { 'sx.record.v1': JSON.stringify(legacy) };
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: () => {} },
  };
  const r = readRecord();
  expect(featOf(r, 1).bestStage, '旧存档丢了').toBe(4);
  expect(featOf(r, 1).cleared).toEqual(['nezha', 'erlang']);
  expect(featOf(r, 0).bestStage, '旧存档被记到了轻松档').toBe(0);
  expect(featOf(r, 2).bestStage, '旧存档被记到了修罗档').toBe(0);
  delete (globalThis as { window?: unknown }).window;
});

// 真结局（CharacterDef.endingHard）只在修罗档给。可玩家怎么知道它存在？
// 难度选择那里写的是"对手更会读招，也更耐打"——只说了代价没说回报。
// 所以在战绩那一行提一句，但**只对已经通过关的人说**：
// 没通过的人看到"更高难度另有奖励"只是又一条做不到的清单。
test('通了低难度才提"修罗另有收场"，没通关时一个字都不提', () => {
  const cleared = (diff: number) => {
    const r = merge(EMPTY, LAST, true, 200_000, LAST, 'nezha', diff);   // 通关最后一关
    return summary(r, LAST, 12, diff, DIFFICULTIES[diff].name);
  };
  expect(cleared(0), '轻松档通关后没提修罗有专属收场').toContain('修罗档另有收场');
  expect(cleared(1), '标准档通关后没提修罗有专属收场').toContain('修罗档另有收场');
  // 修罗档自己通关了就不必再提——他已经看到了
  expect(cleared(HARDEST_DIFF), '修罗档通关后还在提修罗').not.toContain('修罗档另有收场');

  // 没通关的人不提：他看到的应该是"最远第几关"，不是又一条做不到的清单
  const half = merge(EMPTY, 2, true, 0, LAST, 'nezha', 0);   // 只赢到第三关
  expect(summary(half, LAST, 12, 0, '轻松'), '还没通关就提了修罗').not.toContain('修罗档另有收场');
});
