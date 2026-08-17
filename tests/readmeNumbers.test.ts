import { expect, test } from 'vitest';
import readme from '../README.md?raw';
import {
  COUNTER_DMG, COUNTER_STUN, DOWN_STUN, INPUT_BUFFER, MAX_COST, MAX_DMG,
  MAX_FRAMES, ROUND_TIME, TECH_WINDOW, THROW_ESCAPE_WINDOW,
} from '../src/engine/battle';
import { DESPERATE_HP } from '../src/engine/types';
import { STAGES } from '../src/data/stages';

/**
 * README 的「玩法」「进阶系统」两节报了二十来个写死的数字，此前**一个都没人守**。
 *
 * 而这轮门面重排刚刚证明过：没人守的数字会静默过期。同一次检查里抓到两处——
 * 「角色」一节少报了三分之二的名册（列四人、实际十二人），
 * 「后撤打三折」实际是 `DESPERATE_FLEE = 0.35`（三成半）。
 * 两处都不会有任何东西报错，只是读者照着一个不存在的游戏在理解。
 *
 * 所以：engine 里改一个常量、README 不跟着改，下面就红。
 * 名册那条在 `addCharDoc.test.ts`，两条各管一段。
 *
 * 这里只钉**导出的常量**。`RUN_MULT`/`MAX_BURST_INVULN`/`RUN_LEN`/`DESPERATE_FLEE`
 * 没有导出，就不在这条的覆盖内——与其去刮源码文本（那种正则漏一处不报错、
 * 只会让断言静默变弱），不如如实留个缺口。要补就先把它们 export 出来。
 */
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
// react 在类型上是可选的（数据里每一关都填了），窄一下才过 tsc；
// 顺带断言别筛空——筛空的话 Math.min() 会得到 Infinity，这条就变成永远绿的断言
const reacts = STAGES.map(s => s.ai.react).filter((n): n is number => typeof n === 'number');
if (!reacts.length) throw new Error('STAGES 里一个 ai.react 都没读到——这条断言的取数方式过时了');

/** [README 里必须出现的原文, 这是哪个数] */
const CLAIMS: [string, string][] = [
  [`每回合 **${ROUND_TIME / 60} 秒**`, 'ROUND_TIME 回合时长'],
  [`掉到${CN[Math.round(DESPERATE_HP * 10)]}成以下`, 'DESPERATE_HP 残血阈值'],
  [`记住 ${INPUT_BUFFER} 帧`, 'INPUT_BUFFER 先行输入窗口'],
  [`伤害 ×${COUNTER_DMG}、硬直 +${COUNTER_STUN} 帧`, 'COUNTER_DMG / COUNTER_STUN 反击'],
  [`倒地 ${TECH_WINDOW} 帧内`, 'TECH_WINDOW 受身窗口'],
  [`${DOWN_STUN} 帧干等`, 'DOWN_STUN 倒地硬直'],
  [`被投前 ${THROW_ESCAPE_WINDOW} 帧内`, 'THROW_ESCAPE_WINDOW 投技解脱窗口'],
  [`（${MAX_COST} 气）`, 'MAX_COST 防御取消耗气'],
  [`有 ${MAX_COST} 气时按下即**爆气**`, 'MAX_COST 爆气门槛'],
  [`之后 ${MAX_FRAMES / 60} 秒伤害 ×${MAX_DMG}`, 'MAX_FRAMES / MAX_DMG 爆气增益'],
  [`${Math.min(...reacts)}→${Math.max(...reacts)}`, 'STAGES 见招拆招概率区间'],
];

test.each(CLAIMS)('README 的数字跟常量对得上：%s', (claim, what) => {
  expect(readme.includes(claim), `README 里找不到「${claim}」——${what} 改了，README 没跟着改`).toBe(true);
});
