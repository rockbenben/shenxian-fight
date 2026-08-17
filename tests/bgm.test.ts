import { expect, test } from 'vitest';
import {
  bassAt, bpmOf, BARS, drumAt, freq, LOOP_STEPS, melodyAt, stepDur, STEPS_PER_BAR,
  themeOf, THEME_PLACES, MENU_BPM,
} from '../src/render/bgm';
import { HOME } from '../src/data/stages';
import appSrc from '../src/App.tsx?raw';

// 背景乐的乐句是纯函数（排程才碰 Web Audio），所以这一层能真的测。
// 守两件事：曲子是**确定的**（同一个地方每次听到同一句，不是随机生成），
// 以及每个音都落在五声音阶上（跑调一个音，整段就散了）。
//
// 曲子按**地方**分（每个人的主场就是一关），速度按**关卡进度**分。
// 此前两件事挤在一个 stage 序号上：只有四组主音、四档速度、外加一段全场共用的乐句，
// 再按 % 4 回绕——十二张手画的背景配四支曲子，第五关和第一关一个音不差。

const PENTA = [0, 2, 4, 7, 9];
const inScale = (semi: number, root: number) => PENTA.includes(((semi - root) % 12 + 12) % 12);
const loop = (p: string) => Array.from({ length: LOOP_STEPS }, (_, i) => melodyAt(p, i));

test('十二关一关不落，每个地方都有自己的曲子', () => {
  for (const id of Object.keys(HOME)) {
    expect(THEME_PLACES).toContain(id);
  }
  // 反过来也要成立：写了曲子却没有这个地方，说明键名打错了（回落到默认曲，静默）
  for (const p of THEME_PLACES) {
    expect(HOME[p], `写了 ${p} 的曲子，但 HOME 里没有这个地方——键名多半打错了`).toBeDefined();
  }
});

test('十二个地方各是各的调子——换关要听得出来', () => {
  const roots = THEME_PLACES.map(p => themeOf(p).root);
  expect(new Set(roots).size, '有两个地方主音相同').toBe(THEME_PLACES.length);
  // 主音不同还不够：乐句也得不同，否则只是同一首歌换了个调
  const tunes = THEME_PLACES.map(p => JSON.stringify(themeOf(p).phrase));
  expect(new Set(tunes).size, '有两个地方的乐句一模一样，只是调子不同').toBe(THEME_PLACES.length);
  // 合起来：整支曲子（调 + 句）互不相同
  const songs = THEME_PLACES.map(p => JSON.stringify(loop(p)));
  expect(new Set(songs).size, '有两个地方从头到尾听着一样').toBe(THEME_PLACES.length);
});

test('同一个地方每次生成同一句——旋律是写死的，不是随机的', () => {
  for (const p of THEME_PLACES) {
    expect(loop(p), `${HOME[p].name} 两次生成不一致`).toEqual(loop(p));
    // 循环要真的闭合：第二遍必须和第一遍逐音相同
    const second = Array.from({ length: LOOP_STEPS }, (_, i) => melodyAt(p, i + LOOP_STEPS));
    expect(second, `${HOME[p].name} 的循环没有闭合`).toEqual(loop(p));
  }
});

test('每个音都在五声音阶上——跑调一个音整段就散了', () => {
  for (const p of THEME_PLACES) {
    const root = themeOf(p).root;
    for (let i = 0; i < LOOP_STEPS; i++) {
      const m = melodyAt(p, i), b = bassAt(p, i);
      if (m !== null) expect(inScale(m, root), `${HOME[p].name} 第 ${i} 步的旋律音跑调了`).toBe(true);
      if (b !== null) expect(inScale(b, root), `${HOME[p].name} 第 ${i} 步的低音跑调了`).toBe(true);
    }
  }
});

test('鼓点踩在拍上，且每小节都有', () => {
  for (let bar = 0; bar < BARS; bar++) {
    const base = bar * STEPS_PER_BAR;
    expect(drumAt(base), '每小节第一步该是重击').toBe('heavy');
    expect(drumAt(base + 8), '每小节第三拍该是重击').toBe('heavy');
    expect(drumAt(base + 4), '第二拍该是轻击').toBe('light');
    for (const off of [1, 2, 3, 5, 6, 7]) expect(drumAt(base + off), `第 ${off} 步不该有鼓`).toBeNull();
  }
});

test('旋律是稀疏的——不是每一步都发音，否则听着像警报', () => {
  for (const p of THEME_PLACES) {
    const density = loop(p).filter(v => v !== null).length / LOOP_STEPS;
    const pct = Math.round(density * 100);
    expect(density, `${HOME[p].name} 旋律密度 ${pct}%，太密`).toBeLessThan(0.45);
    expect(density, `${HOME[p].name} 旋律密度 ${pct}%，太稀，听不出是句子`).toBeGreaterThan(0.15);
  }
});

test('逐关提速，六关的速度都在能踩住的范围内', () => {
  // 一趟阶梯六关（见 stages 的 RUN_LEN），所以六档速度都要有，而且一档比一档快
  const bpms = [0, 1, 2, 3, 4, 5].map(bpmOf);
  for (let i = 1; i < bpms.length; i++) {
    expect(bpms[i], `第 ${i + 1} 关没有比上一关更快（${bpms[i - 1]} → ${bpms[i]}）`)
      .toBeGreaterThan(bpms[i - 1]);
  }
  for (const b of bpms) { expect(b).toBeGreaterThan(70); expect(b).toBeLessThan(150); }
  // 一步是十六分音符：一小节四拍，四小节一循环
  expect(stepDur(0)).toBeCloseTo(60 / bpms[0] / 4, 6);
  // 越界不该回绕成"第五关又变回第一关的速度"，而是停在最快那一档
  expect(bpmOf(99), '关卡序号超出档位时速度回绕了').toBe(bpms[bpms.length - 1]);
});

test('频率换算：主音落在给音效让路的低八度上', () => {
  expect(freq(21)).toBeCloseTo(440, 6);      // 基准
  expect(freq(33)).toBeCloseTo(880, 6);      // 高八度
  // 低音层不该低到听不见，旋律层不该高到压住音效——十二个调都要成立，
  // 主音铺开到 0~11 之后这条不再是"检查一个调"，而是检查整个音域没有越界
  for (const p of THEME_PLACES) for (let i = 0; i < LOOP_STEPS; i++) {
    const b = bassAt(p, i), m = melodyAt(p, i);
    if (b !== null) {
      expect(freq(b), `${HOME[p].name} 低音低到听不见`).toBeGreaterThan(60);
      expect(freq(b), `${HOME[p].name} 低音顶到旋律区`).toBeLessThan(260);
    }
    if (m !== null) {
      expect(freq(m), `${HOME[p].name} 旋律掉进低音区`).toBeGreaterThan(200);
      expect(freq(m), `${HOME[p].name} 旋律高到压住音效`).toBeLessThan(900);
    }
  }
});

// 标题／选人／帮助此前是**全静音**的：startBgm 只在战斗里调，
// 而选人页正是玩家待得最久的地方之一（十二个人要翻一遍）。
// 菜单曲故意不进 THEME——那张表的约定是"一关一支"，上面两条守的就是这个对应关系，
// 塞一个不是关卡的键进去会把约定搅浑。
test('菜单有自己的曲子，而且不混进关卡表里', () => {
  const menu = themeOf('menu');
  expect(menu, '菜单没有曲子').toBeDefined();
  expect(THEME_PLACES, '菜单被塞进了关卡表，会破坏"一关一支"的对应关系').not.toContain('menu');
  // 它得和十二关都不一样，否则等于随便挑了一关的曲子当菜单曲
  const menuTune = JSON.stringify(menu.phrase);
  for (const p of THEME_PLACES) {
    expect(JSON.stringify(themeOf(p).phrase), `菜单曲和 ${p} 的一模一样`).not.toBe(menuTune);
  }
});

test('菜单曲比任何一关都空、都慢——它是垫底的，不该抢戏', () => {
  const menuNotes = Array.from({ length: LOOP_STEPS }, (_, i) => melodyAt('menu', i)).filter(v => v !== null);
  for (const p of THEME_PLACES) {
    const n = Array.from({ length: LOOP_STEPS }, (_, i) => melodyAt(p, i)).filter(v => v !== null);
    expect(menuNotes.length, `菜单曲(${menuNotes.length} 音)不比 ${p}(${n.length} 音)空`)
      .toBeLessThan(n.length);
  }
  // 速度也要比最慢的一关更慢
  expect(MENU_BPM, '菜单比第一关还快').toBeLessThan(bpmOf(0));
});

test('菜单曲同样落在五声音阶上，音域也不越界', () => {
  const root = themeOf('menu').root;
  for (let i = 0; i < LOOP_STEPS; i++) {
    const m = melodyAt('menu', i), b = bassAt('menu', i);
    if (m !== null) {
      expect(inScale(m, root), `菜单曲第 ${i} 步跑调了`).toBe(true);
      expect(freq(m)).toBeGreaterThan(200);
      expect(freq(m)).toBeLessThan(900);
    }
    if (b !== null) expect(inScale(b, root), `菜单曲低音第 ${i} 步跑调了`).toBe(true);
  }
});

// 曲子写好了不接上去等于没写。菜单那三屏由 App 起音乐（战斗里由 Fight 自己的 startBgm 接管），
// 摘掉那一行只会得到一个"未使用的 import"警告，没有任何测试会红——所以钉在这里。
test('菜单音乐真的接在菜单场景上', () => {
  expect(/startMenuBgm\(\)/.test(appSrc), 'App 不再启动菜单音乐，那三屏会退回全静音').toBe(true);
  // 覆盖范围按"不是战斗"取反，而不是逐屏点名——漏一屏就是那一屏静音，
  // 而结算页恰恰最容易被漏掉（它紧接 KO 演出出现，一屏死寂比一直没音乐更突兀）。
  //
  // 必须锚到 inMenu 那一行本身：只搜 `scene.s !== 'fight'` 是不够的，
  // App 里早就有一处同样的写法（菜单背景 MenuBackdrop 的显示条件），
  // 搜得到的是那一处——第一版正是这么写的，把 inMenu 改回逐屏点名照样绿。
  expect(/const inMenu = scene\.s !== 'fight'/.test(appSrc),
    '菜单音乐按屏点名而不是取反，漏掉的那一屏会静音（结算页最容易漏）').toBe(true);
});
