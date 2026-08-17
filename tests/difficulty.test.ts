import { expect, test } from 'vitest';
/** 空战绩：分档之后每份记录有三档，用例只关心标准档那一份 */
const E = { bestStage: 0, bestMs: null, cleared: [] as string[] };
import { applyDifficulty, DEFAULT_DIFFICULTY, DIFFICULTIES, buildRun } from '../src/data/stages';
import { CHARACTERS } from '../src/data/characters';
import { Title } from '../src/ui/screens';
import { find } from './helpers';
import { merge } from '../src/ui/records';

// 标准档的末关是 15%、六关连过 0.8%——那是给"练熟了再来"的人调的曲线，
// 第一次上手的人在中段就会卡死。街机厅有投币续关，手机上没有，
// 所以把这个选择交给玩家。三档实测（12 角色 × 4 种子、每关独立量）：
//   轻松 96/85/79/83/71/52（六关连过 19.8%）
//   标准 75/63/60/48/40/15（0.8%）
//   修罗 52/23/27/27/13/2 （0.0%）

test('三档难度真的分得开，且标准档是中间那档', () => {
  expect(DIFFICULTIES.length).toBe(3);
  const [easy, mid, hard] = DIFFICULTIES;
  expect(mid.reactOff, '标准档不该偏移——它就是调好的那条曲线').toBe(0);
  expect(mid.hp).toBe(1);
  expect(mid.dmg).toBe(1);
  // 单调：越往后越难
  expect(easy.reactOff).toBeLessThan(mid.reactOff);
  expect(hard.reactOff).toBeGreaterThan(mid.reactOff);
  expect(easy.hp).toBeLessThan(hard.hp);
  expect(easy.dmg).toBeLessThan(hard.dmg);
  expect(DIFFICULTIES[DEFAULT_DIFFICULTY].name, '默认不是标准档').toBe('标准');
});

// react 单动分不开档（実测 -0.12 也只把末关 15%→19%，对空饱和挡在那儿），
// 所以三个旋钮一起动——但 react 仍然必须夹在"还会猜错"的范围内
test('难度只挪 react，且两头都留得出猜错的余地', () => {
  const run = buildRun('nezha', 7, CHARACTERS);
  for (const d of DIFFICULTIES) {
    for (const st of run) {
      const out = applyDifficulty(st, d);
      expect(out.bossId, '难度档改到对手身上了').toBe(st.bossId);
      expect(out.bg, '难度档改到背景上了').toBe(st.bg);
      expect(out.ai.react!, `${d.name} 档把 react 推出了范围`).toBeGreaterThanOrEqual(0.05);
      expect(out.ai.react!).toBeLessThanOrEqual(0.95);
      // 权重表不动：难度只改"看得多清"，不改"他爱做什么"
      expect(out.ai.near, `${d.name} 档动了近身权重表`).toBe(st.ai.near);
    }
  }
});

test('标题页给得出三颗难度键，选中的那颗标出来', () => {
  const tree = Title({ onStart: () => {}, onTraining: () => {}, onHelp: () => {}, diff: 2 });
  const btns = find(tree, e => typeof e.props?.['aria-label'] === 'string'
    && String(e.props['aria-label']).startsWith('难度'));
  expect(btns.length, '标题页没有三颗难度键').toBe(3);
  const pressed = btns.filter(e => e.props?.['aria-pressed'] === true);
  expect(pressed.length, '选中态不是恰好一颗').toBe(1);
  expect(String(pressed[0].props!['aria-label']), '标出来的不是传进去的那一档').toContain('修罗');
});

// 难度提示语没有长度上限的话，下一句写长一点就会在 568px 的横屏上顶出去——
// 这个项目的界面溢出全是这么来的（帮助页、陪练条、选人页各栽过一次），
// 而溢出**不会有任何报错**：字跑到屏幕外就是看不见。
// 估算模型同 trainingBarLayout：fontSize 取 clamp 的下限
test('难度那一行在最窄的横屏上放得下', () => {
  const MIN_W = 568, MARGIN = 24;
  const CJK = 11, LS = 2, PAD = 10 * 2, BORDER = 2, GAP = 6;
  const chip = (label: string) => label.length * (CJK + LS) + PAD + BORDER;
  const row = DIFFICULTIES.reduce((n, d) => n + chip(d.name), 0) + GAP * DIFFICULTIES.length;
  const longest = Math.max(...DIFFICULTIES.map(d => d.hint.length)) * (10 + 1);
  const total = row + longest;
  expect(total, `难度行估宽 ${Math.round(total)}px（键 ${Math.round(row)} + 提示 ${Math.round(longest)}），放不进 ${MIN_W}px`)
    .toBeLessThan(MIN_W - MARGIN * 2);
});

// 选了轻松的人不该每次刷新都被丢回标准档
test('难度存进记录，且旧存档不会因此作废', () => {
  const r = merge({ byDiff: [E, { bestStage: 2, bestMs: null, cleared: [] }, E], diff: 0 }, 2, true, 0, 5, 'nezha');
  expect(r.diff, 'merge 把难度弄丢了').toBe(0);
});
