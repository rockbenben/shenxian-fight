import { expect, test } from 'vitest';
import { DUMMY_MODES } from '../src/ui/screens';
import { CHARACTERS } from '../src/data/characters';

// 陪练挡位从 4 个加到 6 个（补了「跳入」练对空、「压制」练防御取消），
// 而它们是顶部居中的**一行**。挡位再多下去这一行会溢出窄屏，而溢出不会有任何报错——
// 按钮跑到屏幕外就是按不到，和没有这个挡位是一回事（帮助页那次就是这么栽的）。
//
// 估算模型（与 screens.tsx 里 chip 的样式对应）：
//   fontSize 12 的中日韩字约占 12px 宽，letterSpacing 1，padding 左右各 9，边框各 1
//   行内 gap 4
const CJK = 12, LS = 1, PAD = 9 * 2, BORDER = 2, GAP = 4;
const chipWidth = (label: string) => label.length * (CJK + LS) + PAD + BORDER;
const rowWidth = (labels: string[]) =>
  labels.reduce((n, l) => n + chipWidth(l), 0) + GAP * (labels.length - 1);

/** 支持的最窄横屏。iPhone SE 横屏是 568×320 */
const MIN_W = 568;
/** 两侧留给血条与退出/静音键的余量 */
const MARGIN = 24;

test('挡位那一行放得下最窄的横屏', () => {
  const w = rowWidth(DUMMY_MODES.map(m => m.label));
  expect(w, `挡位行估宽 ${w}px，放不进 ${MIN_W}px 宽的屏幕（两侧各留 ${MARGIN}px）`)
    .toBeLessThan(MIN_W - MARGIN * 2);
});

// 对手行会折行（flexWrap + maxWidth），所以判据不是"一行放得下"，而是
// **折出来的行数不会多到把画面吃掉**：这一块顶在 top 60，下面还有说明行，
// 再往下就压到角色头顶了。两行是上限。
test('换对手那一行折行之后不超过两行', () => {
  const AVAIL = MIN_W - MARGIN * 2;
  let rows = 1, cur = 0;
  for (const name of CHARACTERS.map(c => c.name)) {
    const w = chipWidth(name);
    if (cur > 0 && cur + GAP + w > AVAIL) { rows++; cur = w; } else cur += (cur ? GAP : 0) + w;
  }
  expect(rows, `${CHARACTERS.length} 个对手在 ${AVAIL}px 里折成了 ${rows} 行`).toBeLessThanOrEqual(2);
  // 单个名字本身也不能宽过整行，否则它自己就撑爆了
  for (const c of CHARACTERS) {
    expect(chipWidth(c.name), `「${c.name}」一个人就占 ${chipWidth(c.name)}px`).toBeLessThan(AVAIL);
  }
});

test('每个挡位的说明不会长到把行撑爆', () => {
  // 说明那一行是 whiteSpace: 'nowrap'，长了会直接顶出屏幕而不是折行
  for (const m of DUMMY_MODES) {
    const w = m.hint.length * (11 + 0.5);   // fontSize 11, letterSpacing .5
    expect(w, `「${m.label}」的说明估宽 ${Math.round(w)}px，nowrap 之下会顶出 ${MIN_W}px 的屏幕`)
      .toBeLessThan(MIN_W - MARGIN * 2);
  }
});
