import { audioCtx, isMuted } from './sfx';

/**
 * 战斗背景乐：程序化合成，不依赖任何音频文件（与音效同一条约束）。
 *
 * 分成两层：**乐句**是纯函数（下面的 phrase/step 系列，可测），**排程**才碰 Web Audio。
 * 一个街机格斗零音乐的时候，打得再好也像在静音里练招——但音乐做砸了比没有更糟，
 * 所以这里刻意克制：一条低音、一记鼓、一句稀疏的五声旋律，音量压在音效之下。
 *
 * 排程用 AudioContext.currentTime 而不是逻辑帧——这不违反本项目"按逻辑帧推进"的规矩：
 * 那条规矩管的是**游戏状态**（衰减、绽放、读秒），音频调度本来就属于墙钟域，
 * 挂逻辑帧反而会在掉帧时把节拍拖走。
 */

/** 五声音阶（宫商角徵羽）相对主音的半音偏移 */
const PENTA = [0, 2, 4, 7, 9];
/** 一小节 16 步，四小节一循环 */
export const STEPS_PER_BAR = 16;
export const BARS = 4;
export const LOOP_STEPS = STEPS_PER_BAR * BARS;

/**
 * 速度只跟**关卡进度**走：越往后越紧。名册十二人、一趟阶梯六关，所以六档。
 * 此前只有四档并按 `stage % 4` 回绕，第五关的速度会掉回第一关。
 */
const TIER_BPM = [92, 98, 104, 110, 116, 122];

export function bpmOf(tier: number): number {
  return TIER_BPM[Math.min(Math.max(tier, 0), TIER_BPM.length - 1)];
}

/** 一步的时长（秒）。16 步一小节 = 四拍，所以一步是十六分音符 */
export function stepDur(tier: number): number {
  return 60 / bpmOf(tier) / 4;
}

/** 半音偏移 → 频率。基准 A4=440，主音落在第 3 八度（低一点，给音效让出高频） */
export function freq(semitone: number): number {
  return 440 * Math.pow(2, (semitone - 21) / 12);
}

/** 鼓点：每小节的 0/8 步重击，4/12 步轻击。格斗的节拍要能踩得住 */
export function drumAt(step: number): 'heavy' | 'light' | null {
  const s = step % STEPS_PER_BAR;
  if (s === 0 || s === 8) return 'heavy';
  if (s === 4 || s === 12) return 'light';
  return null;
}

/** 低音：每小节头两拍各一记，走 主音 → 五度 → 主音 → 四度 的四小节走向 */
export function bassAt(place: string, step: number): number | null {
  const s = step % STEPS_PER_BAR;
  if (s !== 0 && s !== 8) return null;
  const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
  const degree = [0, 4, 0, 3][bar];          // 五声音阶里的第 1/5/1/4 音
  // -12：把低音压到 62-156Hz。第一版写的 +24 让低音跑到 523Hz——比旋律还高，
  // 两层挤在一起，听着糊成一团（测试按频段判，当场抓到）
  return themeOf(place).root + PENTA[degree] - 12;
}

/**
 * 每个地方一支曲子：主音 + 四小节乐句。**键是角色 id**（每个人的主场就是一关，
 * 见 data/stages 的 HOME），所以曲子跟着**地方**走，不跟着关卡序号走。
 *
 * 此前只有四组、按 `stage % 4` 回绕，而且乐句是全场共用的同一段——
 * 也就是说十二张手画的背景配四支曲子，第五关和第一关一个音都不差；
 * 更要命的是曲子绑在**阶梯位置**上：火焰山和白骨洞只要排在同一格就完全同声。
 *
 * 乐句是固定表而不是随机——随机旋律听两遍就露馅，而且引擎那边禁用随机的
 * 理由（可回放）在这里同样成立：同一个地方每次听到的是同一句。
 * 音级是五声音阶的度数（0 宫 1 商 2 角 3 徵 4 羽），-1 表示这一步不发音。
 */
const THEME: Record<string, { root: number; phrase: number[][] }> = {
  // 东海之滨：快、往上走——他是全场最快的那个
  nezha: { root: 2, phrase: [
    [0, -1, 2, -1, -1, 3, -1, -1, 4, -1, -1, 3, -1, -1, 2, -1],
    [-1, 1, -1, 2, -1, -1, 3, -1, -1, 4, -1, -1, -1, 3, -1, -1],
    [2, -1, -1, 3, -1, 4, -1, -1, 3, -1, 2, -1, -1, 1, -1, -1],
    [-1, -1, 1, -1, 0, -1, -1, 1, -1, -1, 2, -1, -1, -1, 0, -1],
  ] },
  // 灌江口：端着的，音程拉得开，像列阵
  erlang: { root: 7, phrase: [
    [0, -1, -1, -1, 4, -1, -1, -1, 2, -1, -1, -1, 3, -1, -1, -1],
    [-1, -1, 3, -1, -1, -1, 1, -1, -1, -1, 4, -1, -1, -1, -1, -1],
    [2, -1, -1, -1, -1, 0, -1, -1, 4, -1, -1, -1, -1, 3, -1, -1],
    [-1, -1, -1, 1, -1, -1, 2, -1, -1, -1, -1, 0, -1, -1, -1, -1],
  ] },
  // 花果山：全场最跳脱的一支，音符最密
  wukong: { root: 4, phrase: [
    [0, -1, 1, 2, -1, -1, -1, 3, -1, 2, -1, -1, 4, -1, 3, -1],
    [-1, 2, -1, -1, 3, -1, 4, -1, 3, -1, -1, 2, -1, 1, -1, -1],
    [4, -1, 3, -1, -1, 2, -1, 3, -1, -1, 4, -1, -1, 3, -1, -1],
    [-1, -1, 1, -1, 2, -1, -1, 0, -1, 1, -1, -1, -1, 0, -1, -1],
  ] },
  // 积雷山：最低的调、最少的音，一步一步砸下来
  niumo: { root: 0, phrase: [
    [0, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1, -1, -1, -1, -1],
    [1, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, 2, -1, -1, -1],
    [3, -1, -1, -1, -1, -1, 4, -1, -1, -1, -1, -1, 3, -1, -1, -1],
    [0, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1, 0, -1, -1, -1],
  ] },
  // 火云洞：全踩在反拍上，像火苗跳
  honghaier: { root: 9, phrase: [
    [-1, 2, -1, -1, 3, -1, -1, 4, -1, -1, 3, -1, 2, -1, -1, -1],
    [-1, -1, 4, -1, 3, -1, -1, -1, 2, -1, -1, 3, -1, -1, 4, -1],
    [-1, 3, -1, 2, -1, -1, 1, -1, -1, 2, -1, -1, 3, -1, -1, -1],
    [-1, -1, 2, -1, -1, 1, -1, -1, 0, -1, -1, -1, 1, -1, -1, -1],
  ] },
  // 芭蕉洞：一上一下的连绵句子，像扇出来的风
  tieshan: { root: 5, phrase: [
    [0, -1, 1, -1, 2, -1, 3, -1, 4, -1, 3, -1, 2, -1, 1, -1],
    [-1, 0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 0, -1, -1],
    [2, -1, 3, -1, 4, -1, 3, -1, -1, 2, -1, -1, 1, -1, -1, -1],
    [-1, -1, 1, -1, 0, -1, -1, 1, -1, -1, 2, -1, -1, -1, 0, -1],
  ] },
  // 白骨洞：最高的调、最大的空隙，一路往下掉
  baigu: { root: 11, phrase: [
    [4, -1, -1, -1, 3, -1, -1, -1, -1, -1, 2, -1, -1, -1, -1, -1],
    [-1, -1, 1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, 1, -1],
    [-1, -1, -1, -1, 3, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1],
    [1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  ] },
  // 射日台：长久的静，然后一串泄下来——拉满弓才放的那一下
  houyi: { root: 6, phrase: [
    [0, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1],
    [-1, -1, -1, -1, 2, -1, 3, -1, 4, -1, -1, -1, -1, -1, -1, -1],
    [-1, -1, -1, -1, -1, -1, -1, -1, 4, 3, -1, 2, -1, 1, -1, 0],
    [-1, -1, -1, -1, 2, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1],
  ] },
  // 雷部：成对的短促重音，像连着劈两下
  leizhen: { root: 10, phrase: [
    [4, 4, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1, 4, -1, -1, -1],
    [-1, -1, 2, 2, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1, -1, -1],
    [4, -1, -1, 4, -1, -1, 3, -1, -1, -1, 2, 2, -1, -1, -1, -1],
    [-1, -1, 1, -1, -1, 1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1],
  ] },
  // 终南山：方步，一小节三下，不快不慢
  zhongkui: { root: 1, phrase: [
    [0, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1, 0, -1, -1, -1],
    [2, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1, 3, -1, -1, -1],
    [3, -1, -1, -1, -1, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1],
    [1, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, 1, -1, -1, -1],
  ] },
  // 常羊山：不停歇的锤击，两两一组砸下去
  xingtian: { root: 3, phrase: [
    [0, -1, -1, -1, 1, -1, 1, -1, 0, -1, -1, -1, 2, -1, 2, -1],
    [1, -1, -1, -1, 0, -1, 0, -1, 3, -1, -1, -1, 0, -1, 0, -1],
    [0, -1, -1, -1, 2, -1, 2, -1, 1, -1, -1, -1, 0, -1, 0, -1],
    [3, -1, -1, -1, 0, -1, 0, -1, 1, -1, -1, -1, 0, -1, -1, -1],
  ] },
  // 高老庄：晃悠悠的，一步三摇
  bajie: { root: 8, phrase: [
    [0, -1, -1, 2, -1, -1, 1, -1, -1, 3, -1, -1, 2, -1, -1, -1],
    [-1, -1, 1, -1, -1, 0, -1, -1, 2, -1, -1, 1, -1, -1, -1, -1],
    [3, -1, -1, 2, -1, -1, 4, -1, -1, 3, -1, -1, 2, -1, -1, -1],
    [-1, -1, 0, -1, -1, 1, -1, -1, 0, -1, -1, -1, 1, -1, -1, -1],
  ] },
};

/**
 * 菜单曲（标题／选人／帮助）。**故意不放进 THEME**：那张表的约定是"一关一支"，
 * 既有守门查的正是 THEME 与 HOME 的双向对应，塞一个不是关卡的键进去会把那条约定搅浑。
 * 曲子刻意写得比任何一关都空：长音、大间隔、只在宫商角上落脚——
 * 它垫在底下让人挑得下去，不该好听到抢戏。
 */
const MENU_THEME = { root: 4, phrase: [
  [0, -1, -1, -1, -1, -1, -1, -1, 2, -1, -1, -1, -1, -1, -1, -1],
  [-1, -1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1],
  [2, -1, -1, -1, -1, -1, 3, -1, -1, -1, -1, -1, 2, -1, -1, -1],
  [-1, -1, -1, -1, 1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1],
] };

/** 没写过曲子的地方回落到这一支，绝不静音（曲子少一支比没有音乐更难察觉） */
const FALLBACK = THEME.wukong;

/** 某个地方有没有自己的曲子。测试拿它核对十二关一关不漏 */
export function themeOf(place: string): { root: number; phrase: number[][] } {
  if (place === 'menu') return MENU_THEME;
  return THEME[place] ?? FALLBACK;
}
export const THEME_PLACES = Object.keys(THEME);

export function melodyAt(place: string, step: number): number | null {
  const t = themeOf(place);
  const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
  const d = t.phrase[bar][step % STEPS_PER_BAR];
  if (d < 0) return null;
  // 八度偏移只能用 12 的倍数。第一版写的 +9 是个大六度，把整条旋律移出了调
  //（与低音的音程关系全断了，测试按音阶判当场抓到）。+12 落在 262-830Hz，
  // 稳稳压在低音（62-208Hz）之上，又不吃掉音效的高频
  return t.root + PENTA[d] + 12;
}

// ── 排程 ───────────────────────────────────────────────────────────
/** 提前排多少秒的音符。太短会在主线程卡顿时断拍，太长则切歌不跟手 */
const LOOKAHEAD = 0.25;
const TICK_MS = 80;

let timer: ReturnType<typeof setInterval> | null = null;
let nextStep = 0;
let nextTime = 0;
let curPlace = '';
let curBpm = TIER_BPM[0];
let master: GainNode | null = null;

function voice(a: AudioContext, type: OscillatorType, f: number, at: number, dur: number, vol: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(g).connect(master ?? a.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function drum(a: AudioContext, at: number, heavy: boolean) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = 'sine';
  // 鼓：一次快速下滑的正弦，听感接近堂鼓
  osc.frequency.setValueAtTime(heavy ? 150 : 110, at);
  osc.frequency.exponentialRampToValueAtTime(heavy ? 42 : 55, at + 0.16);
  g.gain.setValueAtTime(heavy ? 0.34 : 0.16, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + (heavy ? 0.24 : 0.14));
  osc.connect(g).connect(master ?? a.destination);
  osc.start(at);
  osc.stop(at + 0.3);
}

function schedule() {
  const a = audioCtx();
  if (!a || !master) return;
  master.gain.value = isMuted() ? 0 : 1;
  const dur = 60 / curBpm / 4;
  while (nextTime < a.currentTime + LOOKAHEAD) {
    // 静音时也照常推进步进：不推的话解除静音会从半句接上，听着像卡带
    if (!isMuted()) {
      const d = drumAt(nextStep);
      if (d) drum(a, nextTime, d === 'heavy');
      const b = bassAt(curPlace, nextStep);
      if (b !== null) voice(a, 'triangle', freq(b), nextTime, dur * 3.4, 0.15);
      const m = melodyAt(curPlace, nextStep);
      if (m !== null) voice(a, 'square', freq(m), nextTime, dur * 1.8, 0.055);
    }
    nextTime += dur;
    nextStep = (nextStep + 1) % LOOP_STEPS;
  }
}

/**
 * 开始播放某一关的背景乐：place 决定曲子（谁的主场），tier 决定速度（打到第几关）。
 * 重复调用同一组不会重头开始（回合之间不该断拍）。
 */
export function startBgm(place: string, tier: number): void {
  const a = audioCtx();
  if (!a) return;
  if (!master) { master = a.createGain(); master.gain.value = 0.55; master.connect(a.destination); }
  if (timer && place === curPlace && bpmOf(tier) === curBpm) return;
  stopBgm();
  curPlace = place;
  curBpm = bpmOf(tier);
  nextStep = 0;
  nextTime = a.currentTime + 0.08;
  schedule();
  timer = setInterval(schedule, TICK_MS);
}

export function stopBgm(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** 菜单的速度。比最慢的一关（92）还慢——它垫在底下，不该催人 */
export const MENU_BPM = 74;

/**
 * 菜单音乐（标题／选人／帮助）。与关卡走同一套合成，只是换了曲子与速度。
 * 反复调用不会重头开始——在标题与选人之间来回切时不该断拍。
 */
export function startMenuBgm(): void {
  const a = audioCtx();
  if (!a) return;
  if (!master) { master = a.createGain(); master.gain.value = 0.55; master.connect(a.destination); }
  if (timer && curPlace === 'menu' && curBpm === MENU_BPM) return;
  stopBgm();
  curPlace = 'menu';
  curBpm = MENU_BPM;
  nextStep = 0;
  nextTime = a.currentTime + 0.08;
  schedule();
  timer = setInterval(schedule, TICK_MS);
}
