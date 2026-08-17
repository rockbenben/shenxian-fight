import { expect, test } from 'vitest';
import { find } from './helpers';
import { STAGES } from '../src/data/stages';
import { createAi } from '../src/engine/ai';
import { Battle } from '../src/engine/battle';
import { CHARACTERS } from '../src/data/characters';
import { mixup, power, push, reach, Select } from '../src/ui/screens';

// 选人卡上画的四条属性。这一组测试守的是**卡面不说谎**：
// 只画血/速/力三项时，孙悟空在这三项上全面压过二郎神（血更多、更快、力道相同），
// 卡面等于在说"别选二郎神"——而二郎神真正的立身之本是攻程（260px，全场最长）。


const axes = (c: typeof CHARACTERS[number]) => [c.hp, c.speed, power(c), reach(c), push(c), mixup(c)];

test('卡面上没有任何角色被全面压过——每个人至少有一项领先', () => {
  for (const a of CHARACTERS) for (const b of CHARACTERS) {
    if (a === b) continue;
    const A = axes(a), B = axes(b);
    const dominates = A.every((v, i) => v >= B[i]) && A.some((v, i) => v > B[i]);
    expect(dominates, `${a.name} 在卡面画的每一项上都不输给 ${b.name}，卡面等于在说"别选${b.name}"`)
      .toBe(false);
  }
});

test('每个角色要么在某一项领先，要么哪一项都不唯一垫底（全能型）', () => {
  // 判据改过两次：
  //   ① 最初写"每个角色都必须在某一项排第一"，但孙悟空四项都不第一——
  //      他是全能型，那是正当定位不是缺陷，于是改成两条出路。
  //   ② "垫底"原来按 v > min 判，把**并列末位**也算成垫底。可屏幕上并列的柱子
  //      画出来一模一样，玩家看不出谁更差；攻程改成 x+w 之后孙悟空 240 与牛魔王 240
  //      并列，这条就误报了。真正要挡的是"唯一垫底"——只有他一个人比所有人都短。
  for (const c of CHARACTERS) {
    const a = axes(c);
    const leads = a.some((v, i) => v >= Math.max(...CHARACTERS.map(x => axes(x)[i])));
    const neverLast = a.every((v, i) =>
      v >= Math.min(...CHARACTERS.filter(x => x !== c).map(x => axes(x)[i])));
    expect(leads || neverLast,
      `${c.name} 既没有一项领先，又在某一项上唯一垫底——卡面上没有理由选他`).toBe(true);
  }
});

// 四条属性从每张卡上挪进了右侧详情面板：十二张卡各画四条是读不完的，
// 一次只读一个人的才读得动。所以这里数的是"选中那一个人的四条"，不是 4×N。
test('四条属性都画在详情里，读屏也念得出数值', () => {
  const tree = Select({ onPick: () => {}, onBack: () => {}, pick: 2 });
  const AXES = ['体力', '身法', '力道', '攻程', '击退', '上下段'];
  const labels = find(tree, e => typeof e.props?.label === 'string' && AXES.includes(e.props.label as string));
  expect(labels.length, `详情里画了 ${labels.length} 条属性，应当是 ${AXES.length} 条`).toBe(AXES.length);
  // 条本身没有文字，读屏只能靠这一组的 aria-label 拿到数值
  const group = find(tree, e => typeof e.props?.['aria-label'] === 'string'
    && String(e.props['aria-label']).includes('体力'));
  expect(group.length, '四条属性没有一个读屏入口').toBe(1);
  const label = String(group[0].props!['aria-label']);
  for (const k of AXES) {
    expect(label.includes(k), `读屏念不到「${k}」：${label}`).toBe(true);
  }
  expect(label, '念的不是选中那个人的数值').toContain(String(CHARACTERS[2].hp));
});

// 卡面上的数字必须和真实对局对得上，否则那几根柱子是在把玩家往错的方向推。
// 攻程原来只取判定框宽度 w、不算偏移 x，实测排名整个错位：
//   卡面 二郎神260 / 牛魔王240 / 孙悟空190 / 哪吒186
//   实测最远命中 二郎神419 / 哪吒376 / 孙悟空258 / 牛魔王252
// 卡面说哪吒全场最短，而它其实是第二长；牛魔王卡面第二，实测垫底。
test('攻程这根柱子的排名与真实对局里的最远命中距离一致', () => {
  const far = CHARACTERS.map(() => 0);
  // 这三重循环原来写死 a<4 / b<4：名册长到八人之后，后四位一场都没打过，
  // 实测最远命中恒为 0px，而断言照样在拿这个 0 去和卡面比排名——
  // 报出来的是"卡面骗人"，实际是**这条测量根本没跑到那几个人**。
  const N = CHARACTERS.length;
  for (let si = 0; si < 4; si++) for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (a === b) continue;
    const bt = new Battle(structuredClone(CHARACTERS[a]), structuredClone(CHARACTERS[b]));
    const a1 = createAi(STAGES[si].ai, si * 101 + a * 13 + 1), a2 = createAi(STAGES[si].ai, si * 57 + b * 7 + 3);
    for (let f = 0; f < 60 * 120 && bt.winner === null; f++) {
      bt.tick(a1(bt, 0), a2(bt, 1));
      const d = Math.abs(bt.p1.x - bt.p2.x);
      for (const e of bt.events) {
        if (e.type === 'hit' && !e.blocked) {
          const who = e.attacker === 0 ? a : b;
          far[who] = Math.max(far[who], d);
        }
      }
    }
  }
  expect(Math.min(...far), '有角色一次都没打中过——这条测量没覆盖到他').toBeGreaterThan(0);
  const rank = (v: number[]) => v.map((_, i) => v.filter(x => x > v[i]).length);
  const card = rank(CHARACTERS.map(reach)), real = rank(far);
  const show = CHARACTERS.map((c, i) => `${c.name} 卡面第${card[i] + 1}/实测第${real[i] + 1}（${Math.round(far[i])}px）`).join('  ');
  // 用**秩相关**判，不再要求"卡面第一必须等于实测第一"。
  //
  // 四个有投射物的角色实测最远命中挤在 409~436px（彼此差 6%），要求分出谁是第一，
  // 等于让这条断言去分辨比测量噪声还小的差别——这个项目在这类要求上反复报过假红。
  // 秩相关守的是"整体排序没有系统性倒错"，而那正是它当初要抓的东西：
  // 旧口径（只取判定框宽度 w、不算偏移 x）的 ρ 只有 0.2，一样会红。
  const n = CHARACTERS.length;
  const d2 = card.reduce((sum, v, i) => sum + (v - real[i]) ** 2, 0);
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  expect(rho, `攻程柱子与实测排名对不上（秩相关 ${rho.toFixed(2)}）　${show}`).toBeGreaterThan(0.6);
}, 900_000);
