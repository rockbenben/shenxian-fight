import { expect, test } from 'vitest';
import { BTN, IDLE_TIPS } from '../src/ui/TouchLayer';

/**
 * 屏幕上只有五颗键，而**没翻过帮助页的人**只能从提示条里知道它们是干什么的。
 * 一颗键在提示条里一次都没被提过，玩家多半整趟都不知道它做什么——
 * 「吹飞」此前正是这种：占着五分之一的操作区，轮播里一句没有，
 * 只在帮助页里躺着（而帮助页要主动去翻）。
 *
 * 这条断言不查"教得好不好"，只查**每颗键都被提到过**——那是最低要求。
 */

test('抽象的那几颗键，轮播里都提过——没翻帮助页的人也该知道它们干什么', () => {
  // 只查 slot === null 的键。带 slot 的两颗（普攻/技能）键面上直接写着**这个角色的招式名**
  //（见 BTN 的 slot 与 shortName），选人页也列了招式表，玩家看得见；
  // 而防御/大招/吹飞是三个抽象词，键上写什么就是什么，不说就没人知道。
  //
  // 也只查轮播，不算情境提示：情境提示讲的是**正在发生在你身上**的事
  //（「大招 / 吹飞 打倒的，只能躺满」讲的是挨打，不是教你去按那颗键）。
  // 第一版把两者合起来查，删掉轮播里的吹飞那句照样绿——正是被这句挨打的话蒙混过去的。
  const rotation = IDLE_TIPS.join('　');
  for (const b of BTN.filter(x => x.slot === null)) {
    expect(rotation.includes(b.fallback),
      `「${b.fallback}」这颗键在轮播里一次都没提过——玩家只能靠翻帮助页发现它`)
      .toBe(true);
  }
});

test('轮播里的每一句都读得完，也没有重复的', () => {
  for (const t of IDLE_TIPS) {
    expect(t.length, `「${t}」太长，提示条一行放不下`).toBeLessThanOrEqual(24);
    expect(t.length, `「${t}」短得没说清什么`).toBeGreaterThan(6);
  }
  expect(new Set(IDLE_TIPS).size, '轮播里有重复的句子').toBe(IDLE_TIPS.length);
});
