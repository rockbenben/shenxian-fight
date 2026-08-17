/**
 * 闯关记录。通关一次和从没打过是一样的话，这一趟就没有留下任何东西——
 * 街机游戏的记分板本来就是"再来一把"的理由。
 *
 * 只存两件事：**最远闯到第几关**，以及**最快的一次通关用时**。
 * 不做分数：这个游戏没有任何得分体系，硬造一个（连段数×伤害之类）只会是个假指标。
 *
 * 纯函数在下面（可测），读写 localStorage 的两个薄壳在最后。
 */

/** 一个难度档下的战绩。三档各存一份——理由见 Record 的注释 */
import { HARDEST_DIFF } from '../data/stages';

export interface Feat {
  /** 最远闯到第几关。0 = 还没赢过任何一关 */
  bestStage: number;
  /** 最快一次通关的总用时（毫秒）。null = 还没通关过 */
  bestMs: number | null;
  /**
   * 已经用来通关过的角色 id。
   *
   * 通关一次之后"为什么还要再玩"，街机的经典答案是把每个人都通一遍。
   */
  cleared: string[];
}

export interface Record {
  /**
   * **逐档战绩**。三档各存一份，不合并。
   *
   * 合着存是不诚实的：轻松档六关连过 19.8%、标准 0.8%、修罗 0.0%——
   * 三条曲线根本不是同一件事，而合并之后「已通关」「最快 4:37」「通了几个人」
   * 全都分不出是在哪一档拿的。分开存之后「在修罗档通关」才成为一个够得着的目标，
   * 这正是难度档要买的那份重玩理由。
   */
  byDiff: Feat[];
  /** 上次选的难度档。不存的话每次刷新都跳回标准档——
   * 选了轻松的人正是最不该被反复丢回默认值的那批 */
  diff: number;
}

const emptyFeat = (): Feat => ({ bestStage: 0, bestMs: null, cleared: [] });
export const EMPTY: Record = { byDiff: [emptyFeat(), emptyFeat(), emptyFeat()], diff: 1 };

/** 取某一档的战绩；越界回落到空战绩而不是崩 */
export const featOf = (r: Record, diff: number): Feat => r.byDiff[diff] ?? emptyFeat();

/** 合并一次战果。stage 是刚打完的关卡序号（0 起），won 是否取胜，
 * elapsedMs 只在通关最后一关时有意义（整趟的用时）。 */
export function merge(r: Record, stage: number, won: boolean, elapsedMs: number, lastStage: number,
                      charId?: string, diff = r.diff): Record {
  if (!won) return r;
  const cur = featOf(r, diff);
  const bestStage = Math.max(cur.bestStage, stage + 1);
  // 只有打完最后一关才记时间——半途的用时没有可比性
  const finished = stage === lastStage;
  const bestMs = finished && elapsedMs > 0
    ? (cur.bestMs === null ? elapsedMs : Math.min(cur.bestMs, elapsedMs))
    : cur.bestMs;
  // 通关才记角色，半途打赢一关不算
  const cleared = finished && charId && !cur.cleared.includes(charId)
    ? [...cur.cleared, charId] : cur.cleared;
  // 只动这一档，别的档原样带过去
  const byDiff = r.byDiff.map((f, i) => (i === diff ? { bestStage, bestMs, cleared } : f));
  return { byDiff, diff: r.diff };
}

/** 毫秒 → M:SS。超过一小时就不显示分秒了（不会发生，但别显示成 73:20 那样） */
export function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 标题页那一行。没有任何记录时返回空串，由调用方决定不渲染 */
export function summary(r: Record, lastStage: number, roster = 0, diff = r.diff,
                        diffName = ''): string {
  const cur = featOf(r, diff);
  if (cur.bestStage <= 0) return '';
  const done = cur.bestStage > lastStage;
  // 关序号的中文数字。**别再写死长度**：这串曾经只有「一二三四」，
  // 阶梯从四关加到六关之后，打到第五关的人在标题页看到的是「最远 第undefined关」——
  // 单元测试全绿，是打开浏览器看见的。取不到就退回阿拉伯数字，宁可朴素也不能出 undefined。
  const CN = '一二三四五六七八九十';
  const nth = CN[cur.bestStage - 1] ?? String(cur.bestStage);
  const stagePart = done ? '已通关' : `最远 第${nth}关`;
  // 档名跟在最前面：三档各存一份，不说是哪一档的话，「已通关」又变回一句分不出轻重的话
  const parts = [diffName ? `${diffName}档 ${stagePart}` : stagePart];
  if (cur.bestMs !== null) parts.push(`最快 ${fmtTime(cur.bestMs)}`);
  // 通关过之后才报进度：没通关过的人看到「0/4 人」只会觉得又多了一个没做完的清单。
  // 措辞避开第二个「已通关」——第一段就是它，连起来读是「已通关 · 最快 4:37 · 已通关 2/4 人」，
  // 截图上一眼就别扭。全通了报一句成就，没全通就报还差几个（那才是下一步该做什么）
  if (done && roster > 0) {
    const left = roster - cur.cleared.length;
    parts.push(left <= 0 ? `${roster} 人皆通` : `还差 ${left} 人`);
  }
  // 通了当前这一档、而它还不是最难那档时，才提一句修罗有专属收场。
  // **只对已经通过关的人说**：没通过的人看到"更高难度另有奖励"只是又一条做不到的清单，
  // 而通了的人正需要一个再来一趟的理由（真结局就是难度档要买的那份重玩理由，
  // 见 CharacterDef.endingHard）。没通关时一个字都不提。
  if (done && diff < HARDEST_DIFF) parts.push('修罗档另有收场');
  return parts.join(' · ');
}

const KEY = 'sx.record.v1';

export function readRecord(): Record {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const o = JSON.parse(raw) as Partial<Record> & Partial<Feat>;
    // 存档可能来自旧版本或被手改过：只接受形状对得上的值，其余回落到空记录
    const feat = (f: Partial<Feat> | undefined): Feat => ({
      bestStage: typeof f?.bestStage === 'number' && f.bestStage >= 0 ? Math.floor(f.bestStage) : 0,
      bestMs: typeof f?.bestMs === 'number' && f.bestMs > 0 ? f.bestMs : null,
      cleared: Array.isArray(f?.cleared) ? f.cleared.filter(x => typeof x === 'string') : [],
    });
    const diff = typeof o.diff === 'number' && o.diff >= 0 && o.diff <= 2 ? Math.floor(o.diff) : 1;
    // **旧存档迁移**：分档之前的战绩是一份平的（bestStage/bestMs/cleared 直接挂在根上），
    // 那时候只有一条曲线，也就是现在的标准档——所以整份并进 byDiff[1]，不丢也不误记到别档。
    const byDiff = Array.isArray(o.byDiff)
      ? [0, 1, 2].map(i => feat(o.byDiff![i]))
      : [emptyFeat(), feat(o), emptyFeat()];
    return { byDiff, diff };
  } catch {
    return EMPTY;   // 隐私模式 / 存档损坏：当作没有记录，不影响游戏
  }
}

export function writeRecord(r: Record): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // 隐私模式下写不进去：这一趟的记录不跨刷新保留，仅此而已
  }
}
