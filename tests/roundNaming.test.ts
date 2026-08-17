import { expect, test } from 'vitest';
import { ROUND_NAMES, ROUNDS_TO_WIN, roundOutcome } from '../src/ui/screens';
import canvasSrc from '../src/ui/GameCanvas.tsx?raw';
import appSrc from '../src/App.tsx?raw';

/**
 * 回合名与三局两胜的配置**必须配套**。
 *
 * 这条守的不是"少一行字"这种小事：开场横幅的文字取到 undefined 时，
 * GameCanvas 那边是 `ready = stageName ? STAGE_HOLD_END : 0`——
 * 横幅没有，开场那段输入锁也一起没了，回合会在双方都能动的状态下直接开打。
 * 没有报错、没有空白，只是某一个回合忽然不喊开场也不给准备时间。
 *
 * 现在 need=2 恰好够用（平局给双方各记一分，只会加快不会拖长回合数），
 * 但这是**算出来刚好合适**，不是写死的保证：改成三胜就会漏到 ROUND_NAMES[3]。
 */

/** 穷举所有可能的胜负序列，返回一场比赛最多会打到第几个回合（下标） */
function maxRoundIndex(need: number): number {
  let worst = 0;
  const walk = (wins: [number, number], idx: number) => {
    if (idx > worst) worst = idx;
    if (idx > 12) throw new Error('回合数不收敛');       // 防呆：配置写坏时别死循环
    for (const winner of [0, 1, null] as const) {
      const r = roundOutcome(wins, winner, need);
      if (!r.done) walk(r.wins, idx + 1);
    }
  };
  walk([0, 0], 0);
  return worst;
}

test('每一个打得到的回合都有名字——取不到名字会连开场输入锁一起丢掉', () => {
  const worst = maxRoundIndex(ROUNDS_TO_WIN);
  expect(ROUND_NAMES.length, `${ROUNDS_TO_WIN} 胜制最多打到第 ${worst + 1} 回合，`
    + `而回合名只有 ${ROUND_NAMES.length} 个——第 ${ROUND_NAMES.length + 1} 回合会拿到 undefined`)
    .toBeGreaterThan(worst);
  for (const [i, n] of ROUND_NAMES.entries()) {
    expect(n, `第 ${i + 1} 个回合名是空的`).toBeTruthy();
  }
});

test('平局只会加快比赛，不会把回合拖长', () => {
  // roundOutcome 在平局时给**双方各记一分**。若改成"谁都不记"，两个只会跑的人
  // 就能把同一个回合无限重开——回合下标随之无上限，回合名必然不够用
  expect(roundOutcome([0, 0], null, 2), '平局没有给双方各记一分').toEqual({ done: false, wins: [1, 1] });
  expect(maxRoundIndex(2), '两胜制打到了第四回合').toBe(2);
});

// 这两条锁死上面那段推理依赖的两个事实：横幅决定输入锁、回合名按下标取。
// 任何一条被改写，上面的断言就不再是在守真正的那件事了。
test('开场输入锁确实挂在横幅上——这是"没名字"会变成"没准备时间"的原因', () => {
  expect(/ready\s*=\s*[^;]*stageName\s*\?\s*STAGE_HOLD_END\s*:\s*0/.test(canvasSrc),
    '开场输入锁不再由 stageName 决定，这组断言守的因果链断了').toBe(true);
});

test('回合名按回合下标取', () => {
  expect(/ROUND_NAMES\[round\]/.test(appSrc), '回合名不再按下标取').toBe(true);
});
