import { expect, test } from 'vitest';
import screens from '../src/ui/screens.tsx?raw';
import touch from '../src/ui/TouchLayer.tsx?raw';
import canvas from '../src/ui/GameCanvas.tsx?raw';
import records from '../src/ui/records.ts?raw';
import traits from '../src/data/traits.ts?raw';
import stages from '../src/data/stages.ts?raw';

/**
 * 屏上不许再出现的工程词。batch1 修了「格挡 / 连击第二段 / 新按 / 训练场」，
 * batch3 修了「6 帧 / n1→n2」，batch4 修了「判定帧 / 挑空 / 收招 / MAX」——
 * 每一轮都是靠人 grep 一遍确认清零的，而"这一轮清完、下一轮加回来"没人守。
 * 这条把它变成闸。
 */
const BANNED = ['格挡中', '连击第二段', '新按', '训练场', '判定帧', '挑空', '收招', 'MAX', '起手帧'];
// 名单只管**说明性文字**，所以 SOURCES 里没有 data/characters/*：哪吒第三段的招式就叫
// 「火尖枪·挑空」，那是专名、横幅与键面都会显示它，不是这里要清的工程词。

/** 只取"会被画到屏上"的那部分：字符串字面量 + JSX 文本节点。
 *  注释里的工程词是给人看代码的，不算违规——所以必须先剥注释，
 *  否则这条闸会因为一句解释而红，人就会去把注释删掉而不是改代码。 */
function screenText(src: string): string {
  const noComments = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...noComments.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)]
    .map(m => m[1] ?? m[2] ?? m[3] ?? '');
  const jsxText = [...noComments.matchAll(/>([^<>{}]+)</g)].map(m => m[1]);
  return [...literals, ...jsxText].join('\n');
}

const SOURCES: [string, string][] = [
  ['screens.tsx', screens], ['TouchLayer.tsx', touch], ['GameCanvas.tsx', canvas],
  ['records.ts', records], ['traits.ts', traits], ['stages.ts', stages],
];

test('解析器认得屏上真有的那几句话（否则下面那条闸是空转的）', () => {
  const all = SOURCES.map(([, s]) => screenText(s)).join('\n');
  for (const known of ['普攻第二段是下段扫堂', '防御取消·回避', '开始闯关', '离线可玩', '爆气中']) {
    expect(all, `提取器没抓到屏上那句「${known}」——它的取法过时了，这条闸会在真违规时 also 报 0`).toContain(known);
  }
});

test('屏上文本不再出现工程词', () => {
  for (const [file, src] of SOURCES) {
    const text = screenText(src);
    for (const w of BANNED) {
      expect(text, `${file} 的屏上文本里还有「${w}」`).not.toContain(w);
    }
  }
});

// ── 台词那一层 ────────────────────────────────────────────────────────
// 名单只管渲染层，data/characters/* 是**故意**排除的：哪吒第三段就叫「火尖枪·挑空」，
// 那是专名。但整文件排除等于给台词开了个口子——谁把「霸体」「硬直」写进某人的胜后
// 那句，这里一声不响。台词是屏上最像"有人在说话"的一层，工程词一进去就出戏，
// 所以单独扫，而且**只取台词字段**，不碰招式名。
function spokenLines(src: string): string[] {
  const out: string[] = [];
  const q = /quotes:\s*\{([\s\S]*?)\}/.exec(src);
  if (q) out.push(...[...q[1].matchAll(/'([^']*)'/g)].map(m => m[1]));
  for (const key of ['vs', 'vsIntro', 'vsTaunt', 'vsLose']) {
    const r = new RegExp(key + ':\\s*\\{([\\s\\S]*?)\\n\\s*\\}').exec(src);
    if (r) out.push(...[...r[1].matchAll(/:\s*'([^']*)'/g)].map(m => m[1]));
  }
  for (const m of src.matchAll(/ending(?:Hard)?:\s*'([^']*)'/g)) out.push(m[1]);
  return out;
}
// 源码走 vite 的 ?raw，不引 node:fs（tsconfig 的 types 只有 vite/client，见 dangerBar 那条）
const CHAR_SRC = import.meta.glob('../src/data/characters/*.ts',
  { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const spoken = Object.entries(CHAR_SRC)
  .filter(([f]) => !f.endsWith('index.ts'))
  .map(([f, src]) => [f.replace(/^.*\//, ''), spokenLines(src)] as const);

test('台词解析器认得四种坑位（否则下面那条闸是空转的）', () => {
  const all = spoken.flatMap(([, v]) => v);
  // 每种各拿一句屏上真有的话：quotes.win / vs / vsIntro / endingHard
  for (const known of ['小辈，山可移，我不动。', '结拜时你叫大哥，翻脸也没改口。',
    '这里没有鬼。', '白虎岭上再没有樵夫和老妇出现过。山道空了，走过的人只觉得风比别处冷些。']) {
    expect(all, `提取器没抓到「${known}」——它的取法过时了，这条闸会在真违规时也报 0`).toContain(known);
  }
  expect(all.length, `只读到 ${all.length} 句台词，十二个人不该这么少`).toBeGreaterThan(150);
});

test('台词里不出现工程词——那是人在说话，不是系统在报状态', () => {
  // 台词层多一份词表，不与上面那份合并：「防御」「大招」写在按键上是对的，
  // 混进一张表迟早互相绑手；这里要挡的是**只有系统才会说出口**的那些字
  const ENGINE_WORDS = ['帧', '判定', '硬直', '冷却', '连段', '取消', '受身', '霸体', '气槽', '击飞', '伤害'];
  for (const [file, lines] of spoken) {
    for (const line of lines) for (const w of [...BANNED, ...ENGINE_WORDS]) {
      expect(line, `${file} 的台词「${line}」里出现了「${w}」`).not.toContain(w);
    }
  }
});
