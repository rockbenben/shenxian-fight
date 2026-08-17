import { expect, test } from 'vitest';
import { Select, SKILL_ROWS } from '../src/ui/screens';
import { skillSlotFor } from '../src/ui/TouchLayer';
import { CHARACTERS } from '../src/data/characters';
import screensSrc from '../src/ui/screens.tsx?raw';

/**
 * 选人页的招式表。此前那里只报一个超必杀的名字——玩家选完人进场，
 * 手上有三记必杀却不知道是什么、也不知道怎么按（技能键要配方向选槽位）。
 * 十二个人 × 三记必杀全躺在数据里，选人页是唯一该说这件事的地方。
 */

test('三种按法各指一记必杀，不重不漏', () => {
  const slots = SKILL_ROWS.map(r => skillSlotFor(r.dir));
  expect(new Set(slots).size, `三种按法只指到 ${new Set(slots).size} 个槽位：${slots.join('/')}`).toBe(3);
  expect([...slots].sort(), '三种按法没有覆盖 s1/s2/s3').toEqual(['s1', 's2', 's3']);
});

test('十二个人的招式表都取得到名字——不能有空行', () => {
  for (const c of CHARACTERS) {
    for (const r of SKILL_ROWS) {
      const name = c.moves[skillSlotFor(r.dir)].name;
      expect(name, `${c.name} 的「${r.key}」取不到招式名`).toBeTruthy();
    }
    expect(c.moves.sp100.name, `${c.name} 没有超必杀名`).toBeTruthy();
  }
});

test('同一个人的三记必杀名字互不相同——否则表里三行看着一样', () => {
  for (const c of CHARACTERS) {
    const names = SKILL_ROWS.map(r => c.moves[skillSlotFor(r.dir)].name);
    expect(new Set(names).size, `${c.name} 的三记必杀里有重名：${names.join('/')}`).toBe(3);
  }
});

// 键位映射只有一处定义（TouchLayer 的 skillSlotFor，触屏判槽位用的就是它）。
// 选人页若自己另写一份 s1/s2/s3 的顺序，改了触屏那边这里不会跟着动，
// 玩家照着表按却出别的招——这个项目在"同一条规则写两份"上栽过四次。
test('选人页不自己写一份槽位顺序，现问 skillSlotFor', () => {
  expect(/skillSlotFor\(r\.dir\)/.test(screensSrc),
    '选人页不再问 skillSlotFor，键位说明可能与触屏实际判定漂开').toBe(true);
  const block = screensSrc.slice(screensSrc.indexOf('SKILL_ROWS = ['), screensSrc.indexOf('] as const;'));
  expect(/'s[123]'/.test(block), 'SKILL_ROWS 里写死了槽位名，那就是第二份规则').toBe(false);
});

// 帮助页曾经把这三记必杀叫「技一/二/三」——那是**引擎的槽位序号**，
// 玩家在任何地方都看不到它：键面上写的是这个角色的招式名（shortName），
// 选人页列的也是招式名。帮助页教一套 UI 里根本不存在的叫法，等于没教。
test('帮助页不用引擎的槽位序号称呼必杀', () => {
  for (const bad of ['技一', '技二', '技三', '技1', '技2', '技3']) {
    expect(screensSrc.includes(`= ${bad}`) || screensSrc.includes(`${bad}/`),
      `帮助页还在用「${bad}」这种槽位序号叫法，而玩家在 UI 里从没见过它`).toBe(false);
  }
  // 三种按法要说全，否则玩家只知道有必杀、不知道怎么选
  for (const form of ['中立', '推方向', '推下']) {
    expect(screensSrc.includes(form), `帮助页没说「${form}」这种按法`).toBe(true);
  }
});

// ── 从"扫源码"升级成"看真的渲染出什么" ──────────────────────────────
// 上面那条 `skillSlotFor(r.dir)` 的源码扫描有个洞：screens.tsx 里有**两处**用它——
// 无障碍标签一处、看得见的表格一处。只要留下任意一处，那条就绿。
// 也就是说"读屏念得对、屏幕上写错"这种情况它拦不住。
// 这里改成走 React 元素树，直接读**渲染出来的文字**（同 select-a11y 的做法，
// 项目没装 jsdom，靠结构断言）。

type El = { type: unknown; props?: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'type' in n && 'props' in n;

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isEl(node)) return textOf(node.props?.children);
  return '';
}

test('选人页**画面上**真的写着这个角色的三记必杀', () => {
  for (const c of CHARACTERS) {
    const idx = CHARACTERS.indexOf(c);
    const tree = Select({ onPick: () => {}, onBack: () => {}, pick: idx });
    const shown = textOf(tree);
    for (const r of SKILL_ROWS) {
      const name = c.moves[skillSlotFor(r.dir)].name;
      expect(shown.includes(name), `${c.name} 的选人页上没有「${name}」（${r.key}）`).toBe(true);
      expect(shown.includes(r.key), `${c.name} 的选人页上没写按法「${r.key}」`).toBe(true);
    }
    expect(shown.includes(c.moves.sp100.name.replace('超必杀·', '')),
      `${c.name} 的选人页上没有超必杀名`).toBe(true);
  }
});
