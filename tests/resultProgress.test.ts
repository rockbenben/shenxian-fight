import { expect, test } from 'vitest';
import { Result } from '../src/ui/screens';
import { CN_NUM, cn } from '../src/ui/theme';

const textOf = (n: unknown): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  const e = n as { props?: { children?: unknown } };
  return e.props ? textOf(e.props.children) : '';
};

const base = {
  won: true, stage: 2, last: false, total: 6,
  stageName: '白虎岭', bossName: '白骨精',
  onNext: () => {}, onRetry: () => {}, onHome: () => {},
};

// 结算页那行进度曾经写死「共四关」。阶梯改成六关之后它还在说四——
// 和标题页那次「第undefined关」是同一类：**数量写进了文案里**。
test('总关数跟着阶梯走，不是写死的', () => {
  expect(textOf(Result({ ...base, total: 6 })), '六关阶梯却报四关').toContain('共六关');
  expect(textOf(Result({ ...base, total: 4 })), '四关阶梯却不报四关').toContain('共四关');
  expect(textOf(Result({ ...base, total: 6 }))).not.toContain('共四关');
});

// 六关的对手是随机抽的：不报下一关是谁，玩家按「下一关」就是在开盲盒。
// 街机连战本来就是靠"下一个是谁"往前推的。
test('赢了且不是最后一关时预告下一关', () => {
  const t = textOf(Result({ ...base, nextStageName: '酆都·鬼门关', nextBossName: '钟馗' }));
  expect(t, '没有预告下一关').toContain('下一关');
  expect(t, '预告里没有对手名').toContain('钟馗');
  expect(t, '预告里没有关卡名').toContain('酆都·鬼门关');
});

test('输了、或已是最后一关时不预告', () => {
  const lost = textOf(Result({ ...base, won: false, nextStageName: '酆都·鬼门关', nextBossName: '钟馗' }));
  expect(lost, '输了还在预告下一关').not.toContain('下一关');
  const fin = textOf(Result({ ...base, last: true, stage: 5, nextStageName: 'X', nextBossName: 'Y' }));
  expect(fin, '最后一关还在预告下一关').not.toContain('下一关');
});

// 中文序数表原来只到六、注释写着"多出两个是余量"——六关阶梯正好用光。
// 再加一关就会静默回落成阿拉伯数字（标题页已经踩过一次同类坑）
test('中文序数够用，且越界不崩', () => {
  expect(CN_NUM.length, '序数表长度不足以支撑六关阶梯的余量').toBeGreaterThanOrEqual(10);
  expect(cn(5)).toBe('六');
  expect(cn(9)).toBe('十');
  expect(cn(99), '越界应回落到阿拉伯数字而不是 undefined').toBe('100');
});
