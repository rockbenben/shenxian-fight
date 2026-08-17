import { expect, test } from 'vitest';
import { Battle } from '../src/engine/battle';
import { createAi } from '../src/engine/ai';
import { CHARACTERS } from '../src/data/characters';
import { STAGES, BOSS_HP_SCALE, BOSS_DMG_SCALE } from '../src/data/stages';

// 这三条守的是"改一个数值，整盘平衡静默塌掉"这一类故障——它不报错、不崩溃，
// 只是让某个角色变成唯一正解，或者让某一关变成劝退墙，而其它测试全都照样绿。
//
// 实测发现的两次真实回归：
//   · 二郎神同时付三份代价（血最低+速度低+起手最慢），同档 AI 下总胜率 37%
//   · 牛魔王血 240 叠最高伤害，总胜率 70%，最后一关玩家胜率被压到 21%
// 引擎是确定性的，同一份种子必然回放出同一个结果，所以这些数字可以直接断言。

/** i 与 j 同档 AI 对打，返回 i 的胜场数。
 * 每个种子**两边各打一遍**（i 当先手、i 当后手），否则先手优势会混进角色强弱里读不出来：
 * 第一版只按 i 当先手统计，四个角色的"总胜率"全都落在 60~67%（合计 250%），
 * 那不是角色问题，是测量方法把先手优势算成了角色实力。 */
function duel(i: number, j: number, seeds: number): number {
  let w = 0;
  for (let seed = 0; seed < seeds; seed++) {
    for (const swap of [false, true]) {
      const [a, b2] = swap ? [j, i] : [i, j];
      const b = new Battle(structuredClone(CHARACTERS[a]), structuredClone(CHARACTERS[b2]));
      const a1 = createAi(STAGES[2].ai, seed * 13 + 1), a2 = createAi(STAGES[2].ai, seed * 7 + 3);
      for (let f = 0; f < 60 * 120 && b.winner === null; f++) b.tick(a1(b, 0), a2(b, 1));
      if (b.winner === (swap ? 1 : 0)) w++;
    }
  }
  return w;
}

test('没有角色是唯一正解，也没有角色是废牌', () => {
  const N = 10, n = CHARACTERS.length;
  const rate = CHARACTERS.map((_, i) => {
    let w = 0;
    for (let j = 0; j < n; j++) if (i !== j) w += duel(i, j, N);
    return w / (N * 2 * (n - 1)); // 每个种子打两遍
  });
  const report = CHARACTERS.map((c, i) => `${c.name} ${Math.round(rate[i] * 100)}%`).join('  ');
  // 单个角色的总胜率落在 35%~65% 内。克制关系（某个对位 70%+）是格斗游戏想要的，
  // 但"打谁都赢"或"打谁都输"不是。
  for (let i = 0; i < n; i++) {
    expect(rate[i], `${CHARACTERS[i].name} 总胜率越界　${report}`).toBeGreaterThan(0.35);
    expect(rate[i], `${CHARACTERS[i].name} 总胜率越界　${report}`).toBeLessThan(0.65);
  }
  // 名册长到八人之后这是 8×8=56 组对位（每组 10 种子 ×2 先后手），默认 5 秒不够。
  // 给显式时限而不是缩样本：样本量是这条断言的命根子
}, 600_000);

/** 固定水平的陪练玩家——**一把不会动的尺子**。
 *
 * 这里必须是写死的字面量，不能写成 STAGES[1].ai：那样一调第二关的参数，尺子本身就跟着变了，
 * 量出来的"难度变化"里混着"尺子变化"。同一个坑已经踩过三次——最早是 STAGES[min(si,2)].ai
 * （关卡越靠后陪练越强，把 58%→8% 那堵墙整个抹平），后来是 STAGES[1].ai（调关2 时尺子同步移动）。
 *
 * 数值取自当年的 lv2 中手档。它跟游戏里的哪一关都不再有关系，这正是它的价值：
 * 关卡怎么改，这把尺子都不动。 */
const PROXY = {
  name: 'proxy', decideEvery: 26, react: 0.3,
  near: { attack: 5, block: 2, retreat: 4, skill2: 1, backstep: 2 },
  mid: { approach: 3, skill1: 4, skill3: 1, jump: 1, dash: 2, retreat: 2 },
  far: { approach: 2, skill1: 4, dash: 3, charge: 2 },
};

/**
 * 另外两把同样冻死、但**打法不同**的尺子。
 *
 * 加它们是因为：阶梯的形状是尺子依赖的。用退型的 PROXY 量，关3→关4 是 52%→25%
 * 一大步；换一把均衡型的量，同一份代码是 55%→45%，看着像"最后一级是平的"。
 * 两把尺子都没错——它们量的是"这一关对**那种打法**有多难"。
 * 只用一把的话，守住的只是"阶梯对退型玩家是下坡"，别的打法可能踩空。
 *
 * 这两把只查形状（没有墙、没有倒挂），不查绝对值：绝对值的阈值是按 PROXY 标定的。
 */
const PROXY_RUSH = {
  name: 'rush', decideEvery: 26, react: 0.3,
  near: { attack: 7, block: 2, retreat: 1, skill2: 1 },
  mid: { approach: 5, dash: 3, skill1: 2, jump: 1 },
  far: { approach: 4, dash: 4, charge: 1 },
};
const PROXY_EVEN = {
  name: 'even', decideEvery: 26, react: 0.3,
  near: { attack: 6, block: 3, super: 2, retreat: 3, roll: 1 },
  mid: { approach: 3, skill1: 3, skill2: 3, jump: 2, dash: 2, retreat: 2 },
  far: { approach: 3, skill2: 3, skill3: 2, dash: 2, charge: 3 },
};

test('四关是一条下坡，不是一堵墙', () => {
  // 48 局。24 局仍然不够：同一份参数下 24 局量出 关2 38% / 关3 46%（倒挂），
  // 48 局量出 44% / 40%（正常）——这条断言查的是单调性，噪声一大就会自己报红。
  // 逐关胜率这种量，N=12/24/48 能给出 83%/67%/75% 三个答案，别拿小样本下结论。
  // 每个角色都打同样多局，**不按 seed 轮转**。
  //
  // 轮转（seed % CHARACTERS.length）把两件事搅在一起：名册一变长，"谁在第几关出场"
  // 整个重排，量出来的难度曲线跟着跳——加红孩儿时 30 局那块被推过线，加铁扇公主时
  // 48 局这块又被推过线，两次都不是难度变了，是抽样变了。
  // 均匀分配之后，加人只会让估计更准，不会重排谁打谁；每关的样本量也仍是 N。
  const PER = Math.max(4, Math.round(48 / CHARACTERS.length));
  const N = PER * CHARACTERS.length;
  const rate = STAGES.map((st, si) => {
    let w = 0;
    for (let seed = 0; seed < N; seed++) {
      const me = structuredClone(CHARACTERS[Math.floor(seed / PER)]);
      const boss = structuredClone(CHARACTERS.find(c => c.id === st.bossId)!);
      boss.hp = Math.round(boss.hp * BOSS_HP_SCALE[si]);
      for (const m of Object.values(boss.moves)) m.damage = Math.round(m.damage * BOSS_DMG_SCALE[si]);
      const b = new Battle(me, boss);
      // 陪练必须**固定水平**。曾经写成 STAGES[min(si,2)].ai——关卡越靠后陪练也越强，
      // 正好抵消 BOSS 变强，量出来是一条平线，把"第二关到第三关 58%→8%"这堵墙完全遮住了。
      // 真人玩家的水平在四关里是恒定的，测量也必须如此。
      const a1 = createAi(PROXY, seed * 13 + 1), a2 = createAi(st.ai, seed * 7 + 3);
      for (let f = 0; f < 60 * 120 && b.winner === null; f++) b.tick(a1(b, 0), a2(b, 1));
      if (b.winner === 0) w++;
    }
    return w / N;
  });
  const report = rate.map((r, i) => `关${i + 1} ${Math.round(r * 100)}%`).join('  ');
  // 最后一关必须还能打得赢（曾经掉到 0%）
  expect(rate[3], `最终关成了劝退墙　${report}`).toBeGreaterThan(0.1);
  // 相邻两关：不能掉出一堵墙（>35 点），也不能反过来大幅倒挂（>10 点）。
  //
  // 这里**不要求严格单调**，是统计上的诚实：48 局、p≈0.45 时标准误约 7.2 点，
  // 要求相邻两关严格有序等于让这条断言去分辨比自身噪声还小的差别——它因此反复
  // 因为 6-8 点的抖动报红，而那些抖动跟游戏好不好玩没有关系。
  // 真正想守住的是三件事：没有墙、末关打得赢、整体是往下走的，都在下面。
  for (let i = 1; i < rate.length; i++) {
    expect(rate[i - 1] - rate[i], `关${i}→关${i + 1} 落差过大，是一堵墙　${report}`).toBeLessThanOrEqual(0.35);
    expect(rate[i] - rate[i - 1], `关${i + 1} 明显比关${i} 还容易　${report}`).toBeLessThanOrEqual(0.10);
  }
  // 整体往下走：末关必须明显难于首关（这一条噪声吃不掉）
  expect(rate[0] - rate[3], `首关到末关没有拉开差距　${report}`).toBeGreaterThan(0.25);

  // 换两种打法的尺子再看一遍形状。实测这三把量出来分别是
  // 68/48/42/32、75/48/48/37、77/68/43/37——都是干净的下坡，一处倒挂都没有。
  // 只查形状不查绝对值：绝对值的阈值是按 PROXY 标定的，换尺子就不成立了。
  // M 从 30 提到 48：这两把尺子只查形状，而 30 局时标准误约 9 点，
  // 拿它去判"落差有没有超过 35 点"等于让断言分辨比自身噪声还小的差别——
  // 名册从四人加到五人（角色轮转 seed%4 变成 seed%5）当场就把它推过了线，
  // 而那不是难度曲线变了，是抽样变了。48 局把标准误压到 7 点，与上面主块同一档。
  // 每关 ~90 局（标准误 5.3 点）。48 局那一档不够：九人名册下实测同一份代码，
  // M=45 量出关3→关4 落差 **38 点**（判为一堵墙），M=90 量出 22 点、M=144 量出 25 点——
  // 38 是抽样噪声，真值在 25 上下，离 35 那条线还远。
  // 这条断言此前因为名册变长报过三次假红，每一次的成因都是"样本量撑不住这个阈值"。
  const M_PER = Math.max(6, Math.round(90 / CHARACTERS.length));
  const M = M_PER * CHARACTERS.length;
  for (const [nm, proxy] of [['压上型', PROXY_RUSH], ['均衡型', PROXY_EVEN]] as const) {
    const r2 = STAGES.map((st, si) => {
      let w = 0;
      for (let seed = 0; seed < M; seed++) {
        const me = structuredClone(CHARACTERS[Math.floor(seed / M_PER)]);
        const boss = structuredClone(CHARACTERS.find(c => c.id === st.bossId)!);
        boss.hp = Math.round(boss.hp * BOSS_HP_SCALE[si]);
        for (const m of Object.values(boss.moves)) m.damage = Math.round(m.damage * BOSS_DMG_SCALE[si]);
        const b = new Battle(me, boss);
        const a1 = createAi(proxy, seed * 13 + 1), a2 = createAi(st.ai, seed * 7 + 3);
        for (let f = 0; f < 60 * 120 && b.winner === null; f++) b.tick(a1(b, 0), a2(b, 1));
        if (b.winner === 0) w++;
      }
      return w / M;
    });
    const rep2 = r2.map((r, i) => `关${i + 1} ${Math.round(r * 100)}%`).join('  ');
    for (let i = 1; i < r2.length; i++) {
      expect(r2[i - 1] - r2[i], `${nm}打法：关${i}→关${i + 1} 是一堵墙　${rep2}`).toBeLessThanOrEqual(0.35);
      // N=30 时标准误约 9 点，倒挂的容忍度比 PROXY 那一档放宽到 15
      expect(r2[i] - r2[i - 1], `${nm}打法：关${i + 1} 比关${i} 还容易　${rep2}`).toBeLessThanOrEqual(0.15);
    }
    expect(r2[0] - r2[3], `${nm}打法：首关到末关没有拉开　${rep2}`).toBeGreaterThan(0.15);
  }
  // 192 场对局，默认 5 秒不够（并行 worker 抢 CPU 时更紧）。铁扇公主进名册之后
  // 回合更长——推开型角色把对手推远，双方够不着的帧数变多——刚好把它推过默认线。
  // 给显式时限而不是缩样本：样本量是这条断言的命根子。
}, 600_000);
