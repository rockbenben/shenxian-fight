import { expect, test } from 'vitest';
import { traitOf } from '../src/data/traits';
import { CHARACTERS } from '../src/data/characters';
import { BannerSystem } from '../src/render/banner';

// 选人页此前只说定位（「霸体 · 硬吃」）和六根柱子，而定位是个形容词——
// 挑刑天的人不会知道他的必杀起手能硬吃一下，挑后羿的人不会知道三记必杀全是箭。
// 十二个人各有一处别人没有的机制，不说出来等于没做。

test('每个人都说得出一句，且互不重复', () => {
  const lines = CHARACTERS.map(traitOf);
  for (const [i, l] of lines.entries()) {
    expect(l.length, `${CHARACTERS[i].name} 的机制钩子太短，说不清一件事：「${l}」`).toBeGreaterThan(8);
  }
  const dup = lines.filter((l, i) => lines.indexOf(l) !== i);
  expect(dup, `这些句子重复了：${dup.join('、')}——十二个人要有十二处不一样`).toEqual([]);
});

// **从数据推**而不是各写一句：写死的话数据一改它就开始骗人。
// 这几条钉住"说的和数据是同一件事"
test('说的就是数据里真有的那件事', () => {
  const by = (id: string) => traitOf(CHARACTERS.find(c => c.id === id)!);
  expect(by('bajie'), '投技型没提投技距离').toContain(String(CHARACTERS.find(c => c.id === 'bajie')!.grapple!.range));
  expect(by('xingtian'), '霸体型没提霸体').toContain('霸体');
  expect(by('houyi'), '三记弹的没提道具').toContain('道具');
  expect(by('baigu'), '上下段型没提上下段').toContain('上下段');
  expect(by('zhongkui'), '召唤型没提鬼卒').toContain('鬼卒');
  expect(by('leizhen'), '空中型没提滞空').toContain('滞空');
  expect(by('nezha'), '乾坤圈会飞回来这件事没说').toContain('飞回来');
  expect(by('erlang'), '长手没提攻程').toContain('攻程');
});

// 数据变了这句话要跟着变——这是"推"而不是"写死"的意义
test('改掉数据，句子跟着改', () => {
  const xt = structuredClone(CHARACTERS.find(c => c.id === 'xingtian')!);
  expect(traitOf(xt)).toContain('霸体');
  for (const m of Object.values(xt.moves)) delete (m as { armor?: number }).armor;
  expect(traitOf(xt), '霸体拿掉了，句子还在说霸体').not.toContain('霸体');
});

// 开场横幅的第三行。六关的对手是**随机抽的**：报了名字还不够——
// 玩家没打过刑天就不会知道他的必杀起手能硬吃一下，而那正是这一场要怎么打的关键。
test('开场横幅报得出对手的机制钩子', () => {
  const bn = new BannerSystem();
  const xt = CHARACTERS.find(c => c.id === 'xingtian')!;
  bn.showStage('常羊山', xt.name, traitOf(xt));
  expect(bn.activeCount(), '开场横幅没点着').toBeGreaterThan(0);
  // 不传第三行时也要能用（陪练场没有关卡概念，压根不调这一路）
  const bn2 = new BannerSystem();
  bn2.showStage('常羊山', xt.name);
  expect(bn2.activeCount()).toBeGreaterThan(0);
});

// 横幅是单行居中绘制、没有折行：句子太长会直接顶出 960 的逻辑宽度
test('机制钩子短到画得进开场横幅', () => {
  const LOGIC_W = 960, FONT = 13, MARGIN = 40;
  for (const c of CHARACTERS) {
    const w = traitOf(c).length * (FONT + 1);
    expect(w, `${c.name} 的机制钩子估宽 ${Math.round(w)}px，横幅画不下（单行不折）`)
      .toBeLessThan(LOGIC_W - MARGIN * 2);
  }
});
