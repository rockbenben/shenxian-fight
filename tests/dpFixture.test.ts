import { expect, test, vi } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, RUN_LEN } from '../src/data/stages';
import appSrc from '../src/App.tsx?raw';
import { dpFixture, dpRecord, dpReset, parseDp } from '../src/ui/dp';

/**
 * `?dp=` 是打磨稿的取景口子（见 ui/dp.ts 的三道闸）。
 * 它开在**产品代码**里，所以这三条不是"顺便测测"，而是它存在的前提。
 */

test('生产构建里这个口子恒为 null——参数解析排在 DEV 闸之后', () => {
  for (const v of ['title', 'help', 'select', 'fight', 'training', 'result']) {
    expect(parseDp(`?dp=${v}`, false), `dev=false 时 ?dp=${v} 必须解析不出来`).toBeNull();
  }
  // 反向对照：同一串参数在 DEV 下必须认，否则上面那六条是"因为解析器坏了所以全 null"
  for (const v of ['title', 'help', 'select', 'fight', 'training', 'result']) {
    expect(parseDp(`?dp=${v}`, true), `DEV 下 ?dp=${v} 应该认`).not.toBeNull();
  }
});

test('认不出来的屏名回落成"没有参数"，不是白屏', () => {
  expect(parseDp('?dp=', true)).toBeNull();
  expect(parseDp('?dp=result-win', true), '屏名要精确匹配，不做前缀猜').toBeNull();
  expect(parseDp('?dp=title&foo=1', true), '无关参数不该影响识别').not.toBeNull();
});

test('越界的序号夹到边界，认不出的角色回落到第一个', () => {
  const d = parseDp('?dp=result&stage=99&pick=-4&diff=7&me=nobody&won=1', true)!;
  expect(d.stage).toBe(RUN_LEN - 1);
  expect(d.pick).toBe(0);
  expect(d.diff).toBe(DIFFICULTIES.length - 1);
  expect(d.me.id).toBe(CHARACTERS[0].id);
  expect(d.won).toBe(true);
  // 夹完必须还在数组里：这些值一路喂给 run[stage]、CHARACTERS[pick]
  expect(d.run[d.stage]).toBeTruthy();
  expect(CHARACTERS[d.pick]).toBeTruthy();
  expect(DIFFICULTIES[d.diff]).toBeTruthy();
});

test('没给的数字参数用默认值，不是 0——「不给」与「给 0」是两回事', () => {
  // Number(null) === 0，所以少了这一步的话 `?dp=fight` 会静默落到**轻松档**，
  // 而游戏默认是标准档：那样拍出来的每一张图，都不是玩家默认看到的那一屏
  const d = parseDp('?dp=fight', true)!;
  expect(d.diff, '不带 &diff= 时夹具该落在游戏默认那一档').toBe(DEFAULT_DIFFICULTY);
  expect(d.stage).toBe(0);
  expect(d.pick).toBe(0);
  expect(parseDp('?dp=fight&diff=0', true)!.diff, '显式给了 0 就必须是 0，不能被默认值盖掉').toBe(0);
  expect(parseDp('?dp=fight&diff=2', true)!.diff).toBe(2);
  expect(parseDp('?dp=fight&diff=', true)!.diff, '空值按没给处理').toBe(DEFAULT_DIFFICULTY);
});

// 夹具的 `&foe=` 在**正式对局那一屏**也要生效。非陪练场原来只读 `stage.bossId`，
// 于是这个参数静默空转：指 zhongkui 拍出来的是这一关注定的那个人，画面看着完全正常。
// 取景拿错了对手，稿子上每一条读数都是别人的。
test('指定了对手就得用它——不只是陪练场认，正式对局那一屏也认', () => {
  const m = /const bossId = ([^;]+);/.exec(appSrc);
  expect(m, 'App 里找不到 bossId 那一行——这条断言的锚点过时了').toBeTruthy();
  expect(m![1], '对手又只看关卡注定的那一个了：&foe= 会静默空转').toContain('foeId');
  expect(m![1], '夹具那一支又被关卡盖掉（只有陪练场认 &foe=）').toContain('DP');
});

test('陪练那一套的两种入口都落到 training', () => {
  expect(parseDp('?dp=training', true)!.training).toBe(true);
  expect(parseDp('?dp=select&t=1', true)!.training, '选人页也有陪练版（标题与印章不同）').toBe(true);
  expect(parseDp('?dp=fight', true)!.training).toBe(false);
});

test('foe/dummy 只认在册的值，乱填等于不填', () => {
  const d = parseDp('?dp=training&foe=houyi&dummy=jumpin', true)!;
  expect(d.foeId).toBe('houyi');
  expect(d.dummy).toBe('jumpin');
  const bad = parseDp('?dp=training&foe=luobun&dummy=sleep', true)!;
  expect(bad.foeId, '不在名册的对手会让 TrainingBar 显示成 —').toBeUndefined();
  expect(bad.dummy, '不认识的挡位会喂给木桩一个 undefined 模式').toBeUndefined();
});

test('取景用的战绩只动选中的那一档', () => {
  const none = dpRecord({ rec: 'none', diff: 1 });
  expect(none.byDiff.every(f => f.bestStage === 0)).toBe(true);

  const part = dpRecord({ rec: 'part', diff: 0 });
  expect(part.byDiff[0].bestStage).toBeGreaterThan(0);
  expect(part.byDiff[0].bestMs, '没通关就不该有最快时间').toBeNull();
  expect(part.byDiff[1].bestStage, '别的档被一起改了，标题页那行会说谎').toBe(0);

  const full = dpRecord({ rec: 'full', diff: 2 });
  expect(full.byDiff[2].bestStage).toBe(RUN_LEN);
  expect(full.byDiff[2].cleared.length).toBeGreaterThan(0);
  // 标题页那句「已通关」正靠 bestStage > lastStage，取景要能召出这一态
  expect(full.byDiff[2].bestStage).toBeGreaterThan(RUN_LEN - 1);
});

test('一次会话只解析一次：三处判定共用同一个结果', () => {
  vi.stubGlobal('location', { search: '?dp=help' });
  dpReset();
  const first = dpFixture();
  expect(first?.view).toBe('help');
  vi.stubGlobal('location', { search: '?dp=result&won=1' });
  expect(dpFixture(), '缓存失效了——同一个页面会出现两遍不一致的夹具判定').toBe(first);
  dpReset();
  vi.unstubAllGlobals();
  expect(dpFixture(), '没有 location 就没有夹具态').toBeNull();
});
