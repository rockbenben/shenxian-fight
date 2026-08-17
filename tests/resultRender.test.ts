import { expect, test } from 'vitest';
import { Result } from '../src/ui/screens';
import { CHARACTERS } from '../src/data/characters';
import { loseQuote } from '../src/data/quotes';
import { HARDEST_DIFF, DIFFICULTIES } from '../src/data/stages';

/**
 * 结算页**真的画出来什么**。此前守它的全是源码扫描（App 里有没有调 loseQuote、
 * 有没有按档取 ending），而源码扫描守不到"这些字最后有没有出现在屏幕上"——
 * 本会话已经吃过两次亏：锚点不唯一时守的是另一行代码。
 * 走 React 元素树读渲染结果（同 select-a11y / skillList 的做法，项目没装 jsdom）。
 */

type El = { type: unknown; props?: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'type' in n && 'props' in n;
function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isEl(node)) return textOf(node.props?.children);
  return '';
}

const NOOP = { onNext: () => {}, onRetry: () => {}, onHome: () => {} };
const render = (over: Partial<Parameters<typeof Result>[0]>) => textOf(Result({
  won: true, stage: 0, last: false, total: 6, stageName: '积雷山', bossName: '牛魔王', ...NOOP, ...over,
} as Parameters<typeof Result>[0]));

test('赢下一关：屏幕上写着对手认输那一句', () => {
  const niumo = CHARACTERS.find(c => c.id === 'niumo')!;
  const line = loseQuote(niumo, 'honghaier');            // 父子那一对
  expect(render({ quote: line }), '结算页没有把对手的败北台词画出来').toContain(line);
});

test('通关最后一关：收场白与用时都画出来了', () => {
  const nezha = CHARACTERS.find(c => c.id === 'nezha')!;
  const t = render({ last: true, won: true, ending: nezha.endingHard, clearMs: 277_000 });
  expect(t, '通关了却没画收场白').toContain(nezha.endingHard!);
  expect(t, '通关了却没画用时').toMatch(/4:37|277|分|:/);
});

test('赢了但还没打完：预告下一关是谁、在哪儿', () => {
  const t = render({ nextStageName: '花果山', nextBossName: '孙悟空' });
  expect(t, '没有预告下一关的地名').toContain('花果山');
  expect(t, '没有预告下一关的对手').toContain('孙悟空');
});

test('输了这一关：不该画出通关的收场白', () => {
  const nezha = CHARACTERS.find(c => c.id === 'nezha')!;
  const t = render({ won: false, last: true, ending: nezha.ending, quote: nezha.quotes.lose });
  expect(t, '输了却画了通关收场白').not.toContain(nezha.ending);
  expect(t, '输了没画自己的败北台词').toContain(nezha.quotes.lose);
});

test('修罗档的真结局与普通档的收场白确实是两段不同的字', () => {
  // 这条把"数据两段不同"和"页面画得出来"接在一起：两段都得真的渲染得出
  const c = CHARACTERS[0];
  const normal = render({ last: true, won: true, ending: c.ending });
  const hard = render({ last: true, won: true, ending: c.endingHard });
  expect(normal).toContain(c.ending);
  expect(hard).toContain(c.endingHard!);
  expect(normal).not.toContain(c.endingHard!);
  expect(DIFFICULTIES[HARDEST_DIFF].name, '最高难度档不叫修罗了？真结局的说法要跟着改').toBe('修罗');
});
