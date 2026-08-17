import { expect, test } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { Result } from '../src/ui/screens';
import appSrc from '../src/App.tsx?raw';
import { DIFFICULTIES, HARDEST_DIFF } from '../src/data/stages';

// 四关打完此前只把结算页标题从「胜」换成「功德圆满」——四个角色的结局一模一样，
// 闯完整条阶梯没有任何专属的回报。用时也一样：记录系统本来就存着，
// 却只在标题页那一行出现过，通关的当下反而看不到。

const textOf = (node: unknown): string => {
  let s = '';
  const walk = (n: unknown) => {
    if (typeof n === 'string' || typeof n === 'number') { s += String(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') walk((n as { props?: { children?: unknown } }).props?.children);
  };
  walk(node);
  return s;
};

test('四个角色的收场白各不相同——否则通关和换个人通关没有分别', () => {
  const set = new Set(CHARACTERS.map(c => c.ending));
  expect(set.size, '有角色共用同一段收场白').toBe(CHARACTERS.length);
  for (const c of CHARACTERS) {
    expect(c.ending.length, `${c.name} 的收场白太短`).toBeGreaterThan(10);
    expect(c.ending, `${c.name} 的收场白和它的胜利台词是同一句`).not.toBe(c.quotes.win);
  }
});

test('通关时才显示收场白与用时，中途赢下一关不显示', () => {
  const c = CHARACTERS[0];
  const clear = Result({
total: 6, won: true, stage: 3, last: true, stageName: '积雷山', bossName: '牛魔王',
    ending: c.ending, clearMs: 4 * 60_000 + 37_000,
    onNext: () => {}, onRetry: () => {}, onHome: () => {},
  });
  const t = textOf(clear);
  expect(t.includes(c.ending), `通关页没有显示收场白：${t.slice(0, 80)}`).toBe(true);
  expect(t.includes('4:37'), `通关页没有显示用时：${t.slice(0, 120)}`).toBe(true);

  const mid = textOf(Result({
total: 6, won: true, stage: 1, last: false, stageName: '灌江口', bossName: '二郎神',
    ending: c.ending, clearMs: 60_000,
    onNext: () => {}, onRetry: () => {}, onHome: () => {},
  }));
  expect(mid.includes(c.ending), '中途赢下一关也显示了收场白').toBe(false);
  expect(mid.includes('用时'), '中途赢下一关也显示了用时').toBe(false);
});

test('App 把所选角色的收场白传下去了', () => {
  // 收场白现在分两档：修罗档取 endingHard，其余取 ending（见 CharacterDef.endingHard）
  expect(/ending=\{diff === HARDEST_DIFF/.test(appSrc), 'App 没有把角色的收场白传给结算页').toBe(true);
  expect(/scene\.me\.endingHard \?\? scene\.me\.ending/.test(appSrc),
    '修罗档没有回落——没写真结局的角色会显示 undefined').toBe(true);
  expect(/clearMs=\{Date\.now\(\) - runStart\.current\}/.test(appSrc), 'App 没有把整趟用时传下去').toBe(true);
});

// 三档难度的六关连过率是 轻松 19.8% / 标准 0.8% / 修罗 0.0%（见 stages 的注释），
// 而此前**最难那档通了也和标准档看到同一段字**——那条曲线不给任何额外回报。
// 街机的老规矩是最高难度才给真结局，这一条正是难度档要买的那份重玩理由。
test('十二个人都有真结局，而且和普通结局不是同一段', () => {
  for (const c of CHARACTERS) {
    expect(c.endingHard, `${c.name} 没有修罗档的真结局`).toBeTruthy();
    expect(c.endingHard, `${c.name} 的真结局和普通结局是同一段`).not.toBe(c.ending);
    expect(c.endingHard!.length, `${c.name} 的真结局太短，读起来不像个收场`).toBeGreaterThan(12);
  }
  // 十二段真结局互不相同——复制粘贴忘了改，等于十二个人共用一个结局
  const set = new Set(CHARACTERS.map(c => c.endingHard));
  expect(set.size, '有两个人的真结局一模一样').toBe(CHARACTERS.length);
});

test('真结局挂在最高难度档上，不是写死的档位序号', () => {
  // 档位增减时，写死的 2 与 DIFFICULTIES 的长度迟早对不上
  expect(HARDEST_DIFF, '最高难度档的下标不是从 DIFFICULTIES 推出来的')
    .toBe(DIFFICULTIES.length - 1);
  expect(appSrc.includes('HARDEST_DIFF'), 'App 里写死了档位序号而不是用 HARDEST_DIFF').toBe(true);
});
