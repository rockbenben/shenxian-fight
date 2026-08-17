import { expect, test } from 'vitest';
import {
  Battle, ROLL_INVULN_FROM, ROLL_INVULN_TO, TECH_WINDOW, THROW_RANGE,
  THROW_ESCAPE_WINDOW, INPUT_BUFFER, COUNTER_DMG, COUNTER_STUN, MAX_FRAMES, MAX_COST,
} from '../src/engine/battle';
import { CHARACTERS } from '../src/data/characters';
import { NULL_INPUT, type InputFrame } from '../src/engine/types';
import helpSrc from '../src/ui/screens.tsx?raw';
import { KEYMAP, createHeld, toInputFrame } from '../src/ui/input';

// 帮助页是玩家发现这十几个系统的**唯一完整入口**。文档和实现对不上，比没文档更糟：
// 玩家照着按、没反应，得出的结论是"这个系统坏了"或"我手太笨"，而不是"说明写错了"。
// 这里逐条把帮助页的事实性说法拿去问引擎。

/** 帮助页里出现过这段文字（用来确认下面的断言还对着真正在显示的那句话） */
function saysIt(t: string) {
  expect(helpSrc.includes(t), `帮助页里已经找不到「${t}」——这条断言的锚点过时了`).toBe(true);
}

test('「轻点=小跳 按住=大跳」——两种高度确实拉得开', () => {
  saysIt('轻点=小跳 按住=大跳');
  const peak = (hold: boolean) => {
    const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
    let p = 0;
    for (let f = 0; f < 90; f++) {
      b.tick({ ...NULL_INPUT, jump: f === 0, jumpHeld: hold && f < 5 }, { ...NULL_INPUT });
      p = Math.max(p, b.p1.y);
      if (f > 5 && b.p1.y <= 0) break;
    }
    return p;
  };
  expect(peak(true), '按住跳不出更高的').toBeGreaterThan(peak(false) * 1.5);
});

test('「贴身按普攻键自动改投」——贴身确实出投技，离远了是普攻', () => {
  saysIt('贴身按普攻键自动改投');
  const tryAt = (gap: number) => {
    const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
    b.p1.x = 400; b.p2.x = 400 + gap;
    b.tick({ ...NULL_INPUT, attack: true }, { ...NULL_INPUT });
    return b.events.some(e => e.type === 'throw');
  };
  expect(tryAt(THROW_RANGE - 10), `贴到 ${THROW_RANGE - 10}px 没有改投`).toBe(true);
  expect(tryAt(THROW_RANGE + 40), '离得老远也改投了，说明「贴身」这个词是错的').toBe(false);
});

test('「出招键会记住 6 帧」——先行入力的窗口就是这个数', () => {
  saysIt('出招键会记住 6 帧');
  expect(INPUT_BUFFER, '帮助页写 6 帧，引擎不是 6').toBe(6);
});

test('「伤害 ×1.2、硬直 +6」——反击命中的两个数对得上', () => {
  saysIt('伤害 ×1.2、硬直 +6');
  expect(COUNTER_DMG).toBe(1.2);
  expect(COUNTER_STUN).toBe(6);
});

test('「够 50 气炸开：顶开 + 无敌，5 秒伤害提升」——三个说法逐条对', () => {
  saysIt('够 50 气炸开：顶开 + 无敌，5 秒伤害提升');
  expect(MAX_COST, '帮助页写 50 气').toBe(50);
  expect(MAX_FRAMES / 60, '帮助页写 5 秒').toBeCloseTo(5, 1);
  // 顶开 + 无敌：真按一次看结果
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  b.p1.meter = MAX_COST; b.p1.x = 400; b.p2.x = 450;
  const gap0 = Math.abs(b.p1.x - b.p2.x);
  for (let f = 0; f < 3; f++) b.tick({ ...NULL_INPUT, block: true, super: true }, { ...NULL_INPUT });
  expect(b.p1.maxMode, '按了防+大招没进 MAX').toBeGreaterThan(0);
  expect(Math.abs(b.p1.x - b.p2.x), '爆气没有把对手顶开').toBeGreaterThan(gap0);
  expect(b.p1.invuln, '爆气没有给无敌').toBeGreaterThan(0);
});

test('「中段无敌，收尾没有」——回避的无敌确实只在中段', () => {
  saysIt('中段无敌，收尾没有');
  expect(ROLL_INVULN_FROM, '回避一起手就无敌，与「中段无敌」不符').toBeGreaterThan(0);
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  const i: InputFrame = { ...NULL_INPUT, block: true, move: 1, roll: true };
  b.tick(i, { ...NULL_INPUT });
  expect(b.p1.state, '防+方向没有进入回避').toBe('roll');
  const seen: boolean[] = [];
  for (let f = 0; f < 30; f++) { seen.push(b.p1.invuln > 0); b.tick({ ...NULL_INPUT }, { ...NULL_INPUT }); }
  const last = seen.lastIndexOf(true);
  expect(last, '整段回避一帧无敌都没有').toBeGreaterThan(0);
  expect(seen.slice(last + 1).some(Boolean), '收尾段还有无敌').toBe(false);
  expect(last, `无敌一直持续到第 ${last} 帧，超过了 ROLL_INVULN_TO=${ROLL_INVULN_TO}`)
    .toBeLessThanOrEqual(ROLL_INVULN_TO + 2);
});

test('「倒地瞬间新按普攻键或防御键」——按住不放无效，且硬直击倒受不了身', () => {
  saysIt('倒地瞬间新按普攻键或防御键');
  expect(TECH_WINDOW).toBeGreaterThan(0);
  // 一直按着攻击键：不该自动受身
  const held = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  held.p1.state = 'down'; held.p1.stateFrame = 0; held.p1.stun = 40; held.p1.techable = true;
  held.p1.techPrev = true;                       // 上一帧就按着
  let techedWhileHeld = false;
  for (let f = 0; f < TECH_WINDOW; f++) {
    held.tick({ ...NULL_INPUT, attack: true }, { ...NULL_INPUT });
    if (held.events.some(e => e.type === 'tech')) techedWhileHeld = true;
  }
  expect(techedWhileHeld, '一直按着也能受身——那「新按」两个字就是假的').toBe(false);
});

test('「被投前的一瞬新按普攻键（按住不放无效）」——解脱窗口存在且要边沿', () => {
  saysIt('被投前的一瞬新按普攻键（按住不放无效）');
  expect(THROW_ESCAPE_WINDOW).toBeGreaterThan(0);
});

// 键位这一类比数值更要命：按错了键什么都不会发生，而玩家没有任何线索去怀疑
// "是说明写错了"——他只会以为自己理解错了。所以帮助页写的每个字母都要真在映射表里，
// 而且映射表里每个能用的键也都要在帮助页出现过（否则那个功能等于没有键盘入口）。

/** 帮助页那三栏里出现的所有单字母按键。取「独立出现的大写字母」，避开中文与 J+L 这类组合里的字母 */
function keysInHelp(): Set<string> {
  const i = helpSrc.indexOf("['移动 / 蹲'");
  const j = helpSrc.indexOf("['爆气 / MAX'");
  expect(i, '帮助页的锚点找不到了').toBeGreaterThan(0);
  expect(j, '帮助页的锚点找不到了').toBeGreaterThan(i);
  const body = helpSrc.slice(i, j + 400);
  return new Set((body.match(/\b[A-Z]\b/g) ?? []));
}

test('帮助页写的每个键都真在键盘映射里', () => {
  const mapped = new Set(Object.keys(KEYMAP).map(k => k.replace('Key', '')));
  const bad = [...keysInHelp()].filter(k => !mapped.has(k));
  expect(bad, `帮助页写着这些键，但键盘映射里没有：${bad.join(' ')}`).toEqual([]);
});

test('映射里每个键都在帮助页写过——否则那个功能没有键盘入口', () => {
  const inHelp = keysInHelp();
  const missing = Object.keys(KEYMAP).map(k => k.replace('Key', '')).filter(k => !inHelp.has(k));
  expect(missing, `这些键能用但帮助页没写：${missing.join(' ')}`).toEqual([]);
});

/** 照玩家的实际按法合成一帧：先按住防御站稳，再新按一个方向。走 ui/input 的真实映射 */
function rollGesture(): InputFrame {
  const held = createHeld(), prev = createHeld();
  held.block = true;
  toInputFrame(held, prev);     // 第一帧：只按防御（此时还不该有回避）
  held.right = true;            // 第二帧：防御按着不放，新推方向
  return toInputFrame(held, prev);
}

test('帮助页说的每个动作，按它写的键真的能做出来', () => {
  const press = (keys: Partial<InputFrame>): InputFrame => ({ ...NULL_INPUT, ...keys });
  // 逐条：帮助页的说法 → 引擎该出现的状态
  const cases: [string, InputFrame, (b: Battle) => boolean, string][] = [
    ['摇杆左右 / 下　键盘 A D / S', press({ crouch: true }), b => b.p1.state === 'crouch', '按 S 没有蹲下'],
    ['防御键　推下=蹲防　键盘 L', press({ block: true }), b => b.p1.state === 'block', '按 L 没有进入防御'],
    ['防御键　推下=蹲防　键盘 L', press({ block: true, crouch: true }), b => b.p1.lowGuard, '按 L+S 不是蹲防'],
    ['摇杆上　轻点=小跳', press({ jump: true }), b => b.p1.state === 'jump', '按 W 没有起跳'],
    // 这一条**走真正的输入层**：帮助页承诺的是"防御 + 左/右"这个手势，不是引擎内部的 roll 位。
    // 手写 roll:true 只能证明引擎认这一位，证明不了玩家按出来的东西会变成这一位
    ['防御 + 左/右', rollGesture(), b => b.p1.state === 'roll', '防+方向没有回避'],
    ['H 或 J+L', press({ attack: true, block: true }), b => b.p1.move?.name === '吹飞攻击', 'J+L 没有出吹飞'],
    ['H 或 J+L', press({ blowback: true }), b => b.p1.move?.name === '吹飞攻击', 'H 没有出吹飞'],
  ];
  for (const [quote, input, ok, msg] of cases) {
    saysIt(quote);
    const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
    b.p1.x = 300; b.p2.x = 800;      // 拉开，免得贴身按攻击变成投技
    b.tick(input, { ...NULL_INPUT });
    expect(ok(b), `${msg}（帮助页写着「${quote}」）`).toBe(true);
  }
});
