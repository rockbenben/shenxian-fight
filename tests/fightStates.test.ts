import { expect, test } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { Battle } from '../src/engine/battle';
import { LOGIC_H, LOGIC_W } from '../src/engine/types';
import { QUOTE_Y, WIN_QUOTE_X } from '../src/render/banner';
import { BTN, buttonView, outroOf } from '../src/ui/TouchLayer';

/**
 * batch2 落地的三条判据。都来自 568x320 的实拍，不是"看起来该有"：
 *  · 对手获胜的台词从右下按键簇身上穿过去（稿子 S-2）；
 *  · KO 之后到结算页之前那几秒，五颗键照常亮着、照常收事件（S-3）；
 *  · 冷却中的键只剩一瓣几乎看不见的扇形（U-3）。
 */

/** 画布逻辑坐标 → 屏幕 CSS 像素。与 GameCanvas 的 setTransform 同一套算法 */
const toScreen = (vw: number, vh: number) => {
  const scale = Math.min(vw / LOGIC_W, vh / LOGIC_H);
  const offX = (vw / scale - LOGIC_W) / 2;
  const offY = (vh / scale - LOGIC_H) / 2;
  return (lx: number, ly: number, lw = 0, lh = 0) => ({
    x: (lx + offX) * scale, y: (ly + offY) * scale, w: lw * scale, h: lh * scale,
  });
};

const VIEWS: [number, number][] = [[568, 320], [667, 375], [844, 390], [932, 430], [1280, 720]];
const QUOTE = '名字我已经记下了。';   // 9 个字，横幅里偏长的那一类
const FONT = 19;                      // drawWinQuote 的字号

test('胜利台词不与任何一颗触控键重叠（五档视口 × 两侧说话人）', () => {
  for (const [vw, vh] of VIEWS) {
    const map = toScreen(vw, vh);
    for (const who of [0, 1] as const) {
      const cx = LOGIC_W * WIN_QUOTE_X[who];
      const box = map(cx - QUOTE.length * FONT / 2, QUOTE_Y - FONT / 2, QUOTE.length * FONT, FONT);
      for (const b of BTN) {
        const key = { x: vw - b.right - b.size, y: vh - b.bottom - b.size, w: b.size, h: b.size };
        const hit = box.x < key.x + key.w && box.x + box.w > key.x
          && box.y < key.y + key.h && box.y + box.h > key.y;
        expect(hit, `${vw}x${vh} 谁=${who}：台词盒 [${Math.round(box.x)}..${Math.round(box.x + box.w)}]`
          + ` 与「${b.fallback}」键 [${key.x}..${key.x + key.w}] 相交`).toBe(false);
      }
    }
  }
});

test('回合打完的那一刻起，触控层不再吃事件', () => {
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  expect(outroOf(b), '刚开场就被判成演出了').toBe(false);
  b.winner = 1;
  expect(outroOf(b), 'KO 之后触控层还在收事件——那几秒的按键会被带进下一回合开头').toBe(true);
  const ko = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  ko.doubleKo = true;
  expect(outroOf(ko), '双双倒地也是演出').toBe(true);
  const up = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  up.timeUp = true;
  expect(outroOf(up), '读秒到点没有演出态').toBe(true);
});

test('冷却秒数与扇形读的是同一个剩余帧', () => {
  const btn = { key: 'skill1' as const, slot: null, fallback: '技能' };
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  const mv = b.p1.def.moves.s2;
  const left = Math.round(mv.cooldown * 0.5);
  b.p1.cooldowns[mv.id] = left;
  const v = buttonView(btn, b.p1, 's2');
  expect(v.cooling).toBeCloseTo(0.5, 1);
  expect(v.coolSec * 60, '秒数不是从 cooldowns 那个帧数推的').toBe(left);
  const idle = buttonView(btn, new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1])).p1, 's2');
  expect(idle.coolSec, '没冷却也给个秒数，键上会凭空多出「0s」').toBe(0);
});
