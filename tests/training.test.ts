import { expect, test } from 'vitest';
import { Battle, BLOCK_STUN } from '../src/engine/battle';
import { CHARACTERS } from '../src/data/characters';
import { createAi } from '../src/engine/ai';
import { STAGES } from '../src/data/stages';
import { dummyFrame, DUMMY_MODES, Select, TrainingBar } from '../src/ui/screens';
import { LEFT_OF_CLUSTER } from '../src/ui/TouchLayer';
import { NULL_INPUT, type Dir } from '../src/engine/types';

// 陪练场原来是一个站着不动的木桩。游戏现在有十几个系统，而上下段、反击命中、抓空挥
// 都要对手做点什么才练得出来——木桩只能练连段。四挡各对应一个练习目标。

test('每一挡都有对应的输入，对打交给陪练 AI', () => {
  expect(dummyFrame('idle')).toEqual(NULL_INPUT);
  expect(dummyFrame('stand')!.block, '站防挡没按防御').toBe(true);
  expect(dummyFrame('stand')!.crouch, '站防挡不该蹲着').toBe(false);
  expect(dummyFrame('crouch')!.block, '蹲防挡没按防御').toBe(true);
  expect(dummyFrame('crouch')!.crouch, '蹲防挡没蹲下').toBe(true);
  expect(dummyFrame('fight'), '对打挡应当返回 null，交给陪练 AI').toBeNull();
  // 挡位表与实现一一对应，加了挡位却忘了实现会在这里报红
  for (const m of DUMMY_MODES) {
    if (m.key !== 'fight') expect(dummyFrame(m.key), `${m.label} 没有对应输入`).not.toBeNull();
  }
});

test('站防挡真的挡得住上段、挡不住下段——这一挡是用来练扫堂的', () => {
  const c = CHARACTERS[0];
  const res: Record<string, boolean | null> = {};
  for (const [name, slot] of [['n1 上段', 'n1'], ['n2 下段', 'n2']] as const) {
    const b = new Battle(structuredClone(c), structuredClone(c));
    b.p2.x = b.p1.x + 60;
    let blocked: boolean | null = null;
    for (let f = 0; f < 30 && blocked === null; f++) {
      b.tick({ ...NULL_INPUT }, dummyFrame('stand')!);
      if (f === 0) { b.p1.move = c.moves[slot]; b.p1.state = 'attack'; b.p1.stateFrame = 0; }
      const h = b.events.find(e => e.type === 'hit');
      if (h && h.type === 'hit') blocked = h.blocked;
    }
    expect(blocked, `${name} 没打中，用例没成立`).not.toBeNull();
    res[name] = blocked;
  }
  expect(res['n1 上段'], '站防没挡住上段').toBe(true);
  expect(res['n2 下段'], '站防挡住了下段，那这一挡就练不了扫堂').toBe(false);
});

test('蹲防挡挡得住下段、挡不住跳跃攻击——这一挡是用来练中段的', () => {
  const c = CHARACTERS[0];
  const res: Record<string, boolean | null> = {};
  for (const [name, slot] of [['n2 下段', 'n2'], ['jA 中段', 'jA']] as const) {
    const b = new Battle(structuredClone(c), structuredClone(c));
    b.p2.x = b.p1.x + 60;
    let blocked: boolean | null = null;
    for (let f = 0; f < 30 && blocked === null; f++) {
      b.tick({ ...NULL_INPUT }, dummyFrame('crouch')!);
      if (f === 0) { b.p1.move = c.moves[slot]; b.p1.state = 'attack'; b.p1.stateFrame = 0; }
      const h = b.events.find(e => e.type === 'hit');
      if (h && h.type === 'hit') blocked = h.blocked;
    }
    expect(blocked, `${name} 没打中，用例没成立`).not.toBeNull();
    res[name] = blocked;
  }
  expect(res['n2 下段'], '蹲防没挡住下段').toBe(true);
  expect(res['jA 中段'], '蹲防挡住了跳跃攻击，那这一挡就练不了中段').toBe(false);
});


// 陪练场原来写死了哪吒打哪吒：既不能用自己那一位练，也不能挑对手。
// 四个角色打法差得远——练接二郎神的天眼光束和练接牛魔王的冲撞不是一回事。

type El = { type: unknown; props?: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'type' in n && 'props' in n;
function find(node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { for (const n of node) find(n, pred, out); return out; }
  if (!isEl(node)) return out;
  if (pred(node)) out.push(node);
  find(node.props?.children, pred, out);
  return out;
}
const textOf = (n: unknown): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isEl(n)) return textOf(n.props?.children);
  return '';
};

test('陪练场也走选人页，标题说清楚这是陪练不是闯关', () => {
  const normal = textOf(Select({ onPick: () => {}, onBack: () => {} }));
  const train = textOf(Select({ onPick: () => {}, onBack: () => {}, training: true }));
  expect(normal.includes('陪练'), '闯关入口不该提陪练').toBe(false);
  expect(train.includes('陪练'), '陪练入口没说明这是陪练场，玩家会以为按错了').toBe(true);
});

test('陪练条能挑对手——四个角色一个不少', () => {
  const bar = TrainingBar({ mode: 'idle', onPick: () => {}, foeId: CHARACTERS[0].id, onFoe: () => {}, onExit: () => {} });
  const txt = textOf(bar);
  for (const c of CHARACTERS) {
    expect(txt.includes(c.name), `陪练条上挑不到 ${c.name}`).toBe(true);
  }
  // 当前对手要有选中态，否则四颗键长得一样，玩家不知道正在打谁
  const pressed = find(bar, e => e.props?.['aria-pressed'] === true);
  expect(pressed.length, '选中态标记数不对（应当是一个挡位 + 一个对手）').toBe(2);
});

// 出口从 App 的独立固定元素并进了这里（见 touchLayout 那条的注释）。这条按**渲染结果**查，
// 不是扫源码里有没有这四个字——装好的全屏 PWA 里没有刷新入口，出口没了就出不去陪练场。
test('挡位条里带着回主页的出口，并且整块让开了右下角按键簇', () => {
  let exited = false;
  const bar = TrainingBar({
    mode: 'idle', onPick: () => {}, foeId: CHARACTERS[0].id, onFoe: () => {},
    onExit: () => { exited = true; },
  });
  const exit = find(bar, e => e.props?.label === '退出训练场');
  expect(exit.length, '挡位条里找不到出口——全屏 PWA 出不去陪练场').toBe(1);
  (exit[0].props?.onClick as (() => void))();
  expect(exited, '出口按下去没有回主页').toBe(true);
  // 整块必须摆在"按键簇左边那条带子"里，否则十二张对手卡会压住超必杀/吹飞的触摸区
  const style = (bar as El).props?.style as React.CSSProperties;
  expect(style?.right, '挡位条的 right 不是 LEFT_OF_CLUSTER 那一份').toBe(LEFT_OF_CLUSTER.right);
});


// 陪练场的复位规则。原来只回木桩的血：练五分钟连段之后玩家永远卡在残血
// （血条一直红着、每一下看着都该死却死不了），而练一次大招要重攒 50-100 气，
// 攒的时间比练的时间还长。

/** 照 App.tsx 陪练场那段 onTick 复位 */
function trainTick(b: Battle) {
  b.p2.hp = b.p2.def.hp;
  b.p1.hp = b.p1.def.hp;
  b.p1.meter = 100;
  b.winner = null;
  b.doubleKo = false;
  b.timeUp = false;
}

test('陪练场里双方都不会被打死，气也一直是满的', () => {
  const me = CHARACTERS[0];
  const b = new Battle(structuredClone(me), structuredClone(CHARACTERS[3]));
  const spar = createAi(STAGES[1].ai, 31);
  let minHp = Infinity, minMeter = Infinity, supers = 0;
  for (let f = 0; f < 60 * 60; f++) {
    // 玩家纯挨打，每隔四秒试着放一次大招
    b.tick({ ...NULL_INPUT, super: f % 240 === 0 }, spar(b, 1));
    trainTick(b);
    minHp = Math.min(minHp, b.p1.hp);
    minMeter = Math.min(minMeter, b.p1.meter);
    for (const e of b.events) if (e.type === 'super' && e.who === 0) supers++;
  }
  expect(minHp, '玩家在陪练场里被打成了残血').toBe(me.hp);
  expect(minMeter, '陪练场里气不是常满的，练一次大招要重攒半天').toBe(100);
  expect(supers, '一分钟里一次大招都没放出来').toBeGreaterThan(5);
});

// 对空是这套系统里最新、也最难自己摸出来的一环（AI 现在会读起跳、会站防、会用必杀迎击，
// 玩家跳进去 57% 被挡下），可反过来"别人跳我怎么办"却没地方练：
// 木桩/站防/蹲防都不会跳，对打挡的 AI 跳得又太随机。

test('跳入挡的木桩真的会反复跳过来，而且在下落段出手', () => {
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  b.p1.x = 300; b.p2.x = 700;
  let jumps = 0, airAttacks = 0, wasAir = false;
  for (let f = 0; f < 60 * 20; f++) {
    const inp = dummyFrame('jumpin', {
      self: b.p2, toward: (b.p1.x >= b.p2.x ? 1 : -1) as Dir, gap: Math.abs(b.p1.x - b.p2.x),
    })!;
    b.tick({ ...NULL_INPUT, block: true }, inp);
    const air = b.p2.y > 0;
    if (air && !wasAir) jumps++;
    wasAir = air;
    for (const e of b.events) {
      if (e.type === 'moveStart' && e.who === 1 && e.move.slot === 'jA') airAttacks++;
    }
  }
  expect(jumps, `20 秒里只跳了 ${jumps} 次，练不了对空`).toBeGreaterThan(8);
  expect(airAttacks, `跳了 ${jumps} 次却一次空中攻击都没出，那只是在蹦`).toBeGreaterThan(5);
});

test('跳入挡会朝玩家跳，不是原地蹦', () => {
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  b.p1.x = 300; b.p2.x = 800;
  const gap0 = Math.abs(b.p1.x - b.p2.x);
  for (let f = 0; f < 60 * 6; f++) {
    const inp = dummyFrame('jumpin', {
      self: b.p2, toward: (b.p1.x >= b.p2.x ? 1 : -1) as Dir, gap: Math.abs(b.p1.x - b.p2.x),
    })!;
    b.tick({ ...NULL_INPUT, block: true }, inp);
  }
  // 阈值按实测定：朝玩家跳时六秒后距离 500 → **40px**，完全原地蹦则纹丝不动（还是 500）。
  // 第一版写的是 `< gap0 - 100`（缩小 100 就算过），而红检只摘掉**地面分支**的移动时
  // 空中那半仍在推进，距离照样缩了一百多——那条线太松，正好放过去。
  expect(Math.abs(b.p1.x - b.p2.x), `六秒过去距离还有 ${Math.round(Math.abs(b.p1.x - b.p2.x))}，没有真的跳过来`)
    .toBeLessThan(100);   // 通过侧 40px（2.5 倍余量），故障侧 157px 也挡得住
  void gap0;
});

test('不传 ctx 时其余四挡与原来逐帧一致——新签名没动老行为', () => {
  expect(dummyFrame('idle')).toEqual(NULL_INPUT);
  expect(dummyFrame('stand')!.block).toBe(true);
  expect(dummyFrame('crouch')!.crouch).toBe(true);
  expect(dummyFrame('fight')).toBeNull();
});

// 防御取消、投技解脱、受身这三样此前只能在「对打」挡碰运气——那一挡的 AI 会退会防会放招，
// 一分钟压不上来几次。「压制」挡只干一件事：贴上来连续出招。

test('压制挡会贴上来连打，且留得出格挡硬直的窗口', () => {
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  b.p1.x = 300; b.p2.x = 800;
  let blockedHits = 0, blockstunFrames = 0;
  for (let f = 0; f < 60 * 15; f++) {
    const inp = dummyFrame('press', {
      self: b.p2, toward: (b.p1.x >= b.p2.x ? 1 : -1) as Dir, gap: Math.abs(b.p1.x - b.p2.x),
    })!;
    b.tick({ ...NULL_INPUT, block: true }, inp);   // 玩家一直站防
    if (b.p1.state === 'block' && b.p1.stun > 0) blockstunFrames++;
    for (const e of b.events) if (e.type === 'hit' && e.attacker === 1 && e.blocked) blockedHits++;
  }
  expect(blockedHits, `十五秒里只挡下了 ${blockedHits} 下，压不上来就练不了防御取消`).toBeGreaterThan(20);
  expect(blockstunFrames, '从没进过格挡硬直，防御取消的窗口根本不出现').toBeGreaterThan(60);
});

test('压制挡留得出反击空档，而且这不是靠节奏调出来的', () => {
  // 先记一件事：这条**用节奏改动破坏不了**。实测把连打收到每 3/5/7 帧，
  // 挡下的次数反而降到 13/13/17（按得越快，出招键在收招期被吞得越多），
  // 空档只会更大。所以下面第一条是在描述现象，不是守门。
  const b = new Battle(structuredClone(CHARACTERS[0]), structuredClone(CHARACTERS[1]));
  b.p1.x = 300; b.p2.x = 800;
  let free = 0, total = 0;
  for (let f = 0; f < 60 * 15; f++) {
    const inp = dummyFrame('press', {
      self: b.p2, toward: (b.p1.x >= b.p2.x ? 1 : -1) as Dir, gap: Math.abs(b.p1.x - b.p2.x),
    })!;
    b.tick({ ...NULL_INPUT, block: true }, inp);
    if (Math.abs(b.p1.x - b.p2.x) < 90) {
      total++;
      if (b.p1.state === 'block' && b.p1.stun <= 0) free++;
    }
  }
  expect(total, '用例没成立：从来没贴上来过').toBeGreaterThan(300);
  expect(free / total, `贴身的 ${total} 帧里只有 ${Math.round(100 * free / total)}% 能动`)
    .toBeGreaterThan(0.3);

  // 真正守着"总有空隙"的是**帧数**：普攻的收招必须长于格挡硬直。
  // 一旦反过来，连打就成了没有空隙的真连防——挨打方除了花 50 气的防御取消无路可走，
  // 而那是"贵重的出口"，不该变成"唯一的出口"。
  for (const c of CHARACTERS) {
    expect(c.moves.n1.recovery, `${c.name} 的普攻收招 ${c.moves.n1.recovery} 帧，不长于格挡硬直 ${BLOCK_STUN} 帧——连打会变成真连防`)
      .toBeGreaterThan(BLOCK_STUN);
  }
});
