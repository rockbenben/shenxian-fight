import { expect, test } from 'vitest';
import { DUMMY_MODES } from '../src/ui/screens';
import { CLUSTER_INSET } from '../src/ui/TouchLayer';
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
/** 这一整块挂在 LEFT_OF_CLUSTER 上：左边留 10，右边整段让给按键簇。
 *  所以能用的宽度**不是整屏宽**——原来三条判据都按 `MIN_W - 24*2 = 520` 算，
 *  比真实的 308 宽出 212px：一句 519px 长的说明会绿着从按键簇身上穿过去。
 *  （live 实测 568×320：带宽 308、挡位行右沿 312、最长那句说明估宽 299） */
const LEFT = 10;
const BAND = MIN_W - LEFT - CLUSTER_INSET;

test('挡位那一行放得下这条带子', () => {
  const w = rowWidth(DUMMY_MODES.map(m => m.label));
  expect(w, `挡位行估宽 ${w}px，放不进 ${BAND}px 宽的带子（带宽 = ${MIN_W} - 左 ${LEFT} - 按键簇 ${CLUSTER_INSET}）`)
    .toBeLessThan(BAND);
});

// 对手行会折行（flexWrap + maxWidth），所以判据不是"一行放得下"，而是
// **折出来的行数不能多到出屏**。568×320 live 实测：12 颗在这条 308px 的带里折成
// 三行，最深一颗底边 233，屏高 320 ✓ 在屏内。开着的时候它确实盖到跳起的木桩，
// 但点完就收（onClick 收起），所以判据是"别长到出屏"，不是"别挡住"。
// 原来这条按 520px 判、上限两行——两行是四人时代的名册，十二人早就不是了。
test('换对手那一格折完之后还在屏内', () => {
  let rows = 1, cur = 0;
  for (const name of CHARACTERS.map(c => c.name)) {
    const w = chipWidth(name);
    if (cur > 0 && cur + GAP + w > BAND) { rows++; cur = w; } else cur += (cur ? GAP : 0) + w;
  }
  expect(rows, `${CHARACTERS.length} 个对手在 ${BAND}px 的带里折成了 ${rows} 行`).toBeLessThanOrEqual(3);
  // 行高 31 + 行距 6，起点在挡位行与 summary 之下（live 量到第一行顶边 163）
  expect(163 + (rows - 1) * 35 + 31, `${rows} 行对手折到 ${163 + (rows - 1) * 35 + 31}px，出屏了`)
    .toBeLessThan(320);
  // 单个名字本身也不能宽过整条带，否则它自己就撑爆了
  for (const c of CHARACTERS) {
    expect(chipWidth(c.name), `「${c.name}」一个人就占 ${chipWidth(c.name)}px`).toBeLessThan(BAND);
  }
});

test('每个挡位的说明不会长到把带子撑爆', () => {
  // 说明那一行是 whiteSpace: 'nowrap'，长了不会折行，会从按键簇身上穿过去
  for (const m of DUMMY_MODES) {
    const w = m.hint.length * (11 + 0.5);   // fontSize 11, letterSpacing .5
    expect(w, `「${m.label}」的说明估宽 ${Math.round(w)}px，nowrap 之下放不进 ${BAND}px 的带子`)
      .toBeLessThan(BAND);
  }
});
