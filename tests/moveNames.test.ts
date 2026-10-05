import { expect, test } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { HOME, STAGES, RUN_LEN } from '../src/data/stages';
import { traitOf } from '../src/data/traits';
import { shortName } from '../src/ui/TouchLayer';

// batch3 的三条文字判据。都来自实拍里读出来的问题，不是"看起来该有"：
//   · 红孩儿的技能叫「三昧真火」、奥义叫「奥义·三昧真火」——横幅（banner.showMove）
//     是玩家唯一能看到"我刚放出去的是哪一招"的地方，两个名字几乎一样等于没说；
//   · 猪八戒的钩子把引擎数值印上屏（「投技够到 78（常规 52）」），没有单位也没有参照；
//   · 末关关名「积雷山·魔王真身」是 12 个里唯一一个"地名·非地名"，还和下面那行
//     「对手 · 牛魔王」把"魔王"说两遍。
// batch6 加了四条容量的判据（名字装不装得下、重名、占位式、大招前缀），
// 那一轮把 36 记必杀与 24 个大招改名成更长的说法，这几条是给改名之后兜底的。

/** 真正会被读到的那几招。范围取窄不是偷懒：
 *  · 横幅（GameCanvas 的 showMove）只报必杀与两档大招，n1–n3 内部直接忽略；
 *  · 键面上出现的是 n1 与三记必杀的截短名（大招键走通用词「大招/奥义/超必杀」）。
 *  所以「三段都叫火尖枪·X」是设计（同一件兵器的三段），不该被这条判成撞名。 */
const BANNER = ['s1', 's2', 's3', 'sp50', 'sp100'] as const;
const KEYFACE = ['n1', 's1', 's2', 's3'] as const;

/** 大招名里的前缀只是"哪一档"，玩家读的是后面那个专名 */
const core = (n: string) => n.replace(/^(奥义|超必杀)·/, '');

test('横幅与键面会读到的招式名，两两不相同', () => {
  for (const c of CHARACTERS) {
    // 比的是**去掉档位前缀之后**的专名：「三昧真火」与「奥义·三昧真火」全名不相等，
    // 但横幅先后打出来读起来就是同一招——第一版这条只比全名，把回退塞回去它都不红
    const full = BANNER.map(k => core(c.moves[k].name));
    const dup = full.filter((n, i) => full.indexOf(n) !== i);
    expect(dup, `${c.name} 横幅会先后打同一个词：${[...new Set(dup)].join('、')}`).toEqual([]);
    // 截短之后也不能撞：键面上显示的是 shortName 的结果
    const cut = KEYFACE.map(k => shortName(c.moves[k].name));
    const dupCut = cut.filter((n, i) => cut.indexOf(n) !== i);
    expect(dupCut, `${c.name} 键面上有两颗键显示同一个词：${[...new Set(dupCut)].join('、')}`).toEqual([]);
    // 近似撞也不行，但要挑对尺：「一扇之风 / 一扇之威」是一闪而过读不出区别，
    // 而「鬼卒 / 啖鬼」这种两个字的招名共用一个"鬼"字是这一族的典故连贯，不是撞。
    // 所以只管两种确凿的情形：等长且只差一个字（≥3 字），或一个是另一个的前缀（≥3 字）
    for (const [i, a] of full.entries()) {
      for (const b of full.slice(i + 1)) {
        if (Math.min(a.length, b.length) < 3) continue;
        if (a.length === b.length) {
          const d = [...a].filter((ch, j) => ch !== b[j]).length;
          expect(d, `${c.name} 两招名只差一个字：「${a}」与「${b}」`).toBeGreaterThan(1);
        } else {
          const [s, l] = a.length < b.length ? [a, b] : [b, a];
          expect(l.startsWith(s), `${c.name} 两招名一个是另一个的前缀：「${a}」与「${b}」`).toBe(false);
        }
      }
    }
  }
});

/** 每一招都会被写在某处：jA/n1 上键面，n2/n3 上代码与文档，s1-s3 上横幅 + 招式表，
 *  两档大招上竖排卷轴。名字写长了要先过容量，不是审美问题。 */
const ALL_SLOTS = ['jA', 'n1', 'n2', 'n3', 's1', 's2', 's3', 'sp50', 'sp100'] as const;

test('招式名装得下它要显示的那几个地方', () => {
  for (const c of CHARACTERS) {
    for (const k of ALL_SLOTS) {
      const n = c.moves[k].name;
      const head = [...n.split('·')[0]].length;
      // 键面显示的是间隔号前那一段，超过 4 字 shortName 会砍成 3 个字——
      // 砍完多半不再是词（「筋斗云十万八千里」→「筋斗云」是运气，「泰山压顶人趴下」→「泰山压」不是）
      expect(head, `${c.name} ${k}「${n}」的头占 ${head} 字，键面会截成「${n.slice(0, 3)}」`).toBeLessThanOrEqual(4);
      // 竖排卷轴逐字 38px、起于 y=120：8 字时印章底边到 472，第 9 个字会把它推到 510
      //（画布高 540、地平线 460；568x320 的屏上 510 落在左下摇杆那块）。
      // 名字里那个「·」也占一格，所以这个数算的是整串
      expect([...n].length, `${c.name} ${k}「${n}」有 ${[...n].length} 字，竖排放不下`).toBeLessThanOrEqual(8);
    }
  }
});

test('一个角色身上的招式名字两两不相同', () => {
  // 只比"会上屏的那几招"是旧范围，n2/n3 与 jA 一直在数据与文档里被人读；
  // 铁扇的普攻与空中招一度同名「扇底风」，就是这条范围漏的
  for (const c of CHARACTERS) {
    const names = ALL_SLOTS.map(k => c.moves[k].name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup, `${c.name} 有两招重名：${[...new Set(dup)].join('、')}`).toEqual([]);
  }
});

test('普攻第一段不叫「名词 + 击」', () => {
  // 「钉耙击 / 棍击 / 斧击 / 弓身击」这种名字是占位：它只说"用某件东西打一下"，
  // 而键面恰好显示的就是这一段。成套的「如意棒·击」不算——点号那侧带着三段同族的语气
  for (const c of CHARACTERS) {
    const n = c.moves.n1.name;
    expect(/^(.{1,3})击$/.test(n), `${c.name} 的普攻第一段「${n}」是"名词+击"的占位名`).toBe(false);
  }
});

test('大招名的前缀就是它那一档', () => {
  // 招式表那两行是把前缀剪掉显示的（行名已经写着「奥义」「超必杀」）。
  // 名字里少了前缀不会报错，只会让那一行把档位说出来两遍
  for (const c of CHARACTERS) {
    expect(c.moves.sp50.name, `${c.name} 的 50 气档叫「${c.moves.sp50.name}」，招式表剪不掉前缀`).toMatch(/^奥义·/);
    expect(c.moves.sp100.name, `${c.name} 的 100 气档叫「${c.moves.sp100.name}」，招式表剪不掉前缀`).toMatch(/^超必杀·/);
  }
});

test('机制钩子不把引擎数值印上屏', () => {
  for (const c of CHARACTERS) {
    const line = traitOf(c);
    expect(line, `${c.name} 的钩子里出现了数字：「${line}」——数值留在数据与测试里，屏上给比较`).not.toMatch(/\d/);
  }
});

test('关名是地名或「地名·地名」，且十二个互不相同', () => {
  const names = Object.values(HOME).map(h => h.name);
  expect(new Set(names).size, '有两个角色共用一个关名').toBe(names.length);
  for (const n of names) {
    expect(n, `关名「${n}」带间隔号却不像地名`).toMatch(/^[^·]{2,4}(·[^·]{2,4})?$/);
    expect(n, `关名「${n}」里混了数字`).not.toMatch(/\d/);
  }
  // 一趟六关是从这十二个主场里抽的，STAGES 那张四关时代的表不能反过来当关名全集用
  expect(names.length).toBeGreaterThanOrEqual(RUN_LEN);
  expect(STAGES.length, 'STAGES 是 AI 档位表，不是关卡全集——别拿它的长度当阶梯长度').toBeLessThan(names.length);
});
