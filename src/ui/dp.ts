import { CHARACTERS } from '../data/characters';
import { DIFFICULTIES, RUN_LEN, buildRun } from '../data/stages';
import type { Stage } from '../data/stages';
import { EMPTY } from './records';
import type { Record } from './records';
import type { CharacterDef } from '../engine/types';

/**
 * 打磨稿（design preview）的取景口子：`?dp=<屏>` 直接落到任意一屏的任意一态。
 *
 * 出稿子要每一屏的实拍，而有几屏靠真打过去要几分钟——结算页是一趟六关每关都要看的常驻
 * 画面，陪练场要切六个挡位。DEV 下原本只有 `__battle` 一个句柄，能改血量但改不了场景。
 *
 * 三道闸，一道都不能少：
 * 1. `import.meta.env.DEV` 排在最前，生产构建里 vite 把它替成 false，整句连同参数解析
 *    一起裁掉（同 App 的 `__battle`、renderer 的判定帧叠加层）；
 * 2. 只认白名单屏名，认不出来返回 null，页面照常从标题页起——`?dp=` 打成别的字不该
 *    把玩家丢进一个空白屏；
 * 3. 夹具态不落盘、不出声：`dp.active` 为真时 App 跳过 `writeRecord` 与菜单音乐。
 *    稿子里的格子要真点控件（焦点可达性要发真 Tab、难度档要真按），
 *    按下去要是写进存档，实拍顺手改了这名玩家的通关记录。
 */

const VIEWS = ['title', 'help', 'select', 'fight', 'training', 'result'] as const;
export type DpView = (typeof VIEWS)[number];

/** 陪练挡位。与 screens.tsx 的 DummyMode 同串，这里不 import 那个类型：
 * dp.ts 被 App 引，App 又引 screens，绕回来只为一个字符串联合不值得 */
const DUMMY = ['idle', 'stand', 'crouch', 'jumpin', 'press', 'fight'] as const;
export type DpDummy = (typeof DUMMY)[number];

export interface Dp {
  view: DpView;
  /** 取景用的这一趟编排。固定种子：同一张格子重拍必须长一样 */
  run: Stage[];
  me: CharacterDef;
  /** 陪练场的对手；不传就用这一关本来的 BOSS */
  foeId?: string;
  /** 陪练挡位 */
  dummy?: DpDummy;
  stage: number;
  pick: number;
  diff: number;
  won: boolean;
  /** 选人/对局是否走陪练那一套（同一屏两种标题、两种顶栏） */
  training: boolean;
  /** 标题页/选人页的记录形态：none=没打过，part=通到中段，full=六关全通且过了几个人 */
  rec: 'none' | 'part' | 'full';
  /** 结算页那一行「用时」的取材 */
  elapsedMs: number;
  /** 夹具态下要写存档的出口一律跳过 */
  active: true;
}

/** 没给参数与给了 0 是两回事：`Number(null)` 是 0 而不是 NaN，所以必须先挡 null。
 *  早先没挡，`?dp=fight` 不带 `&diff=` 会静默落到**轻松档**，而游戏默认是标准档——
 *  所有那样拍出来的读数都不是玩家默认看到的那一屏。 */
const int = (raw: string | null, lo: number, hi: number, dflt: number): number => {
  if (raw === null || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

/** 取景用的战绩。不落盘，只喂给一次渲染 */
export function dpRecord(dp: Pick<Dp, 'rec' | 'diff'>): Record {
  const r = structuredClone(EMPTY);
  if (dp.rec === 'none') return r;
  const full = dp.rec === 'full';
  const f = {
    bestStage: full ? RUN_LEN : Math.max(1, RUN_LEN - 3),
    bestMs: full ? 274_000 : null,
    cleared: full ? CHARACTERS.slice(0, 4).map(c => c.id) : [],
  };
  r.byDiff = r.byDiff.map((x, i) => (i === dp.diff ? f : x));
  return r;
}

/** 解析 `?dp=`。非 DEV、无参数、屏名不在白名单，都返回 null */
export function parseDp(search: string, dev = import.meta.env.DEV): Dp | null {
  const q = new URLSearchParams(search);
  const view = q.get('dp') as DpView | null;
  if (!dev || !view || !VIEWS.includes(view)) return null;

  const diff = int(q.get('diff'), 0, DIFFICULTIES.length - 1, 1);
  const me = CHARACTERS.find(c => c.id === q.get('me')) ?? CHARACTERS[0];
  const recRaw = q.get('rec');
  const dummy = q.get('dummy') as DpDummy | null;
  // 关卡序号按**这一趟**的长度夹，不按 STAGES：STAGES 是四关时代留下的 AI 档位表，
  // 一趟却是 buildRun 编出来的六关（RUN_LEN）。拿 STAGES.length 夹会把「最终关」
  // 那几格夹回第四关——第一版实拍就是这么拍出来的。
  const run = buildRun(me.id, 1, CHARACTERS);
  return {
    view,
    active: true,
    run,
    me,
    foeId: CHARACTERS.some(c => c.id === q.get('foe')) ? (q.get('foe') as string) : undefined,
    dummy: dummy && DUMMY.includes(dummy) ? dummy : undefined,
    stage: int(q.get('stage'), 0, run.length - 1, 0),
    pick: int(q.get('pick'), 0, CHARACTERS.length - 1, 0),
    diff,
    won: q.get('won') === '1',
    training: view === 'training' || q.get('t') === '1',
    rec: recRaw === 'part' || recRaw === 'full' ? recRaw : 'none',
    elapsedMs: 274_000,
  };
}

let cached: Dp | null | undefined;
/** 一次会话只解析一次：场景、存档、音乐、存档写出四处要同一个判定，解析两遍会两遍不一致 */
export function dpFixture(): Dp | null {
  if (cached === undefined) cached = parseDp(typeof location === 'undefined' ? '' : location.search);
  return cached;
}

/** 测试用的复位口：夹具判定是模块级缓存，逐条断言要各自从干净的缓存开始 */
export const dpReset = () => { cached = undefined; };
