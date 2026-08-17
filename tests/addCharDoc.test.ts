import { expect, test } from 'vitest';
import guide from '../DEVELOPMENT.md?raw';
import readme from '../README.md?raw';
import { CHARACTERS } from '../src/data/characters';

/**
 * 「添加一个角色」那份清单，要跟得上角色数据真正需要什么。
 *
 * 本会话这件事**发生了两次**：先是台词从两句涨到四句（win/lose/taunt/intro）而清单还写着两句，
 * 后是加了 crown（头饰）而清单只字未提。两次的后果都不是"漏掉"——校验器和测试都会拦下来——
 * 而是**报错的时候看不懂**：照着清单加人的人不知道这个字段存在，更不知道它有什么约束。
 *
 * 所以把它变成会响的：下面这张表列的是"加一个新角色必须自己填的字段"，
 * 每一项都必须在清单那一节里被提到。加了新的必填字段就得同时加进这张表 —— 而那一步会逼着
 * 你去写清单。清单不写，这条就红。
 */

/** 段落：从 DEVELOPMENT.md 的「## 添加一个角色」到下一个 `## ` 标题之间 */
function guideSection(): string {
  const start = guide.indexOf('## 添加一个角色');
  expect(start, 'DEVELOPMENT.md 里找不到「添加一个角色」这一节——这条断言的锚点过时了').toBeGreaterThan(0);
  const rest = guide.slice(start + 8);
  const end = rest.indexOf(String.fromCharCode(10) + '## ');
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * 新角色必须自己填的东西。每一项给**若干可接受的写法**——清单是给人读的中文说明，
 * 不一定用字段名本身（它写"写满 8 招"而不是 moves、"兵器形制"而不是 weapon）。
 * 所以匹配的是"这件事被讲到了"，不是"这个标识符出现了"。
 *（第一版只认字段名，当场把 moves/weapon/role 全判成没写——那是断言的错，不是清单的错。）
 */
const MUST_DOCUMENT: [string, string[]][] = [
  ['招式表', ['moves', '8 招', '八招']],
  ['动作 id', ['motionId']],
  ['四句台词', ['quotes', '台词']],
  ['开场那句', ['intro', '开场']],
  ['配色', ['palette', '配色']],
  ['头饰', ['crown', '头饰']],
  ['兵器', ['weapon', '兵器']],
  ['格斗定位', ['role', '定位']],
];

test('「添加一个角色」清单覆盖了所有必填字段——加字段不写清单，这条就红', () => {
  const sec = guideSection();
  const missing = MUST_DOCUMENT.filter(([, forms]) => !forms.some(f => sec.includes(f))).map(([label]) => label);
  expect(missing, `这些东西是新角色必须填的，但清单里一个字都没提：${missing.join('、')}\n`
    + '（加了新的必填字段，就得同时写进那份清单——本会话已经因为没写栽过两次）').toEqual([]);
});

test('清单提到的约束跟数据对得上——别写一条做不到的规矩', () => {
  // 清单说头饰"十二个人不许有两个戴同一件"，那数据就得真的满足
  const kinds = CHARACTERS.filter(c => c.crown).map(c => c.crown!.kind);
  expect(new Set(kinds).size, '清单写着头饰互不相同，实际有人撞了').toBe(kinds.length);
  // 清单说无头角色不给头饰
  for (const c of CHARACTERS) {
    if (c.headless) expect(c.crown, `${c.name} 无头却有头饰，与清单里那条矛盾`).toBeUndefined();
  }
});

// ── README 的名册，得跟 CHARACTERS 对得上 ──────────────────────────────
// 「角色」一节曾经只列四个人，而名册早就是十二个——少报三分之二，没有任何东西会红。
// 工程笔记搬去 DEVELOPMENT.md 之后 README 一条守门都不剩了，正好是它新增断言的那一刻。
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];
test('README 里的名册跟 CHARACTERS 对得上——加人不改 README，这条就红', () => {
  const sec = readme.slice(readme.indexOf('## 角色'));
  expect(sec.length, 'README 里找不到「## 角色」这一节——这条断言的锚点过时了').toBeGreaterThan(0);
  const missing = CHARACTERS.filter(c => !sec.includes(c.name)).map(c => c.name);
  expect(missing, `名册里有、但 README「角色」一节没列：${missing.join('、')}`).toEqual([]);
  // 人数那两个中文数词也得跟着走，否则「十二位」会在名册涨到十三人之后静默过期
  const cn = CN[CHARACTERS.length];
  expect(cn, `名册涨到 ${CHARACTERS.length} 人，CN 表没跟上`).toBeTruthy();
  for (const w of [`${cn}位`, `${cn}人名册`]) {
    expect(readme.includes(w), `名册是 ${CHARACTERS.length} 人，README 里该出现「${w}」却没有`).toBe(true);
  }
});
