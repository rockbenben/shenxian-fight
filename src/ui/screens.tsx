import { useEffect, useRef, useState } from 'react';
import { fmtTime } from './records';
import { CHARACTERS } from '../data/characters';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../data/stages';
import { traitOf } from '../data/traits';
import { isMuted, setMuted, unlockAudio } from '../render/sfx';
import { drawPortrait, onPartsLoaded, preloadParts } from '../render/renderer';
import { goFullscreen } from './fullscreen';
import { LEFT_OF_CLUSTER, skillSlotFor } from './TouchLayer';
import { cn, SAFE, SERIF, T, VERTICAL } from './theme';
import type { CharacterDef, Dir, Fighter, InputFrame } from '../engine/types';
import { ARENA_MAX, ARENA_MIN } from '../engine/types';
import type { Battle } from '../engine/battle';
import { NULL_INPUT } from '../engine/types';

export const S: Record<string, React.CSSProperties> = {
  full: {
    // 不再刷底色：MenuBackdrop 在 z-index 1/2 画夜景与压暗罩，这三块面板浮在它上面。
    // 之前这里是不透明的 T.ground，等于把背景整个盖掉。
    position: 'fixed', inset: 0, color: T.paper,
    // 夜景中段没有压暗罩，文字可能压在较亮的山脊上——一层极淡的投影兜底，肉眼看不出是投影
    textShadow: '0 1px 10px rgba(4,9,16,.85)',
    fontFamily: 'system-ui', zIndex: 10, display: 'grid', placeItems: 'center', ...SAFE,
  },
};

/** 朱砂印：本设计唯一的"重笔"，只给主行动用（开始闯关 / 下一关 / 再战）。
 * 形制照画布里超必杀那枚印——方章、不倒角、印面内缩一圈细边。之前是圆角红色药丸按钮，
 * 跟画布里盖的印章毫无关系。 */
function Seal({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="sx-seal"
      onClick={onClick}
      style={{
        fontFamily: SERIF, fontSize: 'clamp(17px, min(4.6vh, 2.6vw), 34px)', letterSpacing: 3,
        color: T.paper, background: T.zhusha, border: 'none',
        padding: 'clamp(11px, 2.1vh, 16px) clamp(20px, 3.6vw, 32px)',
        // 印面内缩一圈边线：先留一圈朱砂余白，再压一道浅色细框。初版是贴边的 1px .34 细线，
        // 截图里根本看不出来，整颗读成一个普通红方块——印章的样子全靠这道内框
        boxShadow: 'inset 0 0 0 4px #C8443C, inset 0 0 0 5.5px rgba(237,227,210,.62)',
        cursor: 'pointer', appearance: 'none', borderRadius: 0,
      }}
    >{label}</button>
  );
}

/** 次级行动：只有一条细下划线，不与印章争分量 */
function Ghost({ label, onClick, style, className }: {
  label: string; onClick: () => void; style?: React.CSSProperties;
  /** 额外类名。目前只用来给陪练场那颗小号出口挂 sx-chip（撑开热区，不长高） */
  className?: string;
}) {
  return (
    <button
      className={className ? `sx-ghost ${className}` : 'sx-ghost'}
      onClick={onClick}
      style={{
        fontFamily: SERIF, fontSize: 'clamp(15px, min(3.9vh, 2.2vw), 29px)', letterSpacing: 3,
        color: T.faint, background: 'none', border: 'none',
        borderBottom: `1px solid ${T.hair}`, padding: '6px 4px 4px',
        cursor: 'pointer', appearance: 'none', borderRadius: 0, ...style,
      }}
    >{label}</button>
  );
}

/** 静音开关：标题页和战斗中共用同一份实现/状态（sfx.ts 里的模块级 `muted`）。
 * top/right 是相对安全区边缘的像素偏移，实际 CSS 值再叠加 env(safe-area-inset-*)。
 * 图标从 🔇/🔊 换成「音」/「静」：表情符号是另一套视觉语言，跟这版排印打架；两个字在
 * 中文界面里一眼可辨，还能进宋体子集。aria-label 说清按下去会发生什么，不是描述当前状态。 */
export function MuteButton({ top = 12, right = 12, style }: { top?: number; right?: number; style?: React.CSSProperties }) {
  const [muted, setLocalMuted] = useState(isMuted());
  return (
    <button
      aria-label={muted ? '打开声音' : '关闭声音'}
      title={muted ? '打开声音' : '关闭声音'}
      style={{
        position: 'fixed',
        top: `calc(${top}px + env(safe-area-inset-top, 0px))`,
        right: `calc(${right}px + env(safe-area-inset-right, 0px))`,
        // 40px：34 对拇指偏小。上限受顶部 HUD 中间空档约束——那条空档是血条+气槽从两侧
        // 向中间伸之后剩下的，**按画布像素实测**在 568x320 上是 x=250~318，只有 68px。
        // 早先这里写的「约 188px、还要再放下退出键 117」两处都不对：188 是估的（实测左半边
        // 只有 28px），而退出键已经并进 TrainingBar，不再分这条空档。40px 在 68 里居中放得下。
        width: 40, height: 40, lineHeight: '1', fontSize: 18, fontFamily: SERIF, boxSizing: 'border-box',
        background: 'rgba(14,20,28,.55)', color: muted ? T.faint : T.paper,
        border: `1px solid ${T.hair}`, borderRadius: 0, cursor: 'pointer', ...style,
      }}
      onClick={() => { const next = !muted; setMuted(next); setLocalMuted(next); }}
    >
      {muted ? '静' : '音'}
    </button>
  );
}

/** 回源码的入口。只挂标题页——它是「看一眼这东西怎么做的」，不是打的时候要用的东西。
 *
 * 固定在右下角，不排进右栏：320px 高的横屏里**竖向是稀缺的那根轴**，右栏已经有五行
 * （副标题/按钮/卖点/难度/记录），再加一行会把难度档和记录一起往下推。固定定位不占流。
 * 右上是静音键，这颗放右下，同一条边、同一组 12px 偏移，两颗对称。
 *
 * **用标识而不是文字。** 第一版写的是文字 `GitHub`，实测 568x320 上盒子只有 59x26——
 * 全站最矮的一颗（其余最低 32/34），得靠 sx-chip 外扩才够按；而且那行字在夜景上淡到
 * 几乎看不见（截图上一眼就看得出来）。换成 40x40 的标识框之后：与静音键同形同尺寸、
 * 右上右下两颗对称，热区天然够，也不再有任何文字——不挑语言，也不占字体子集。
 *
 * 这跟本项目「静音键从 🔇 换成「音」/「静」，因为表情符号是另一套视觉语言」那条不冲突：
 * 那条针对的是**彩色表情字体**，而 octocat 是单色矢量的品牌标识，且没有汉字对应形。 */
function SourceLink() {
  return (
    <a
      href="https://github.com/rockbenben/shenxian-fight"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="在 GitHub 上查看源码"
      title="在 GitHub 上查看源码"
      style={{
        position: 'fixed',
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        right: 'calc(12px + env(safe-area-inset-right, 0px))',
        // 与 MuteButton 同一组值：40x40、1px 细线、同一层夜色底。两颗一上一下，成对
        width: 40, height: 40, boxSizing: 'border-box',
        display: 'grid', placeItems: 'center',
        background: 'rgba(14,20,28,.55)', color: T.faint,
        border: `1px solid ${T.hair}`,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </a>
  );
}

export function Title({ onStart, onTraining, onHelp, record, diff = DEFAULT_DIFFICULTY, onDiff }: {
  onStart: () => void; onTraining: () => void; onHelp: () => void;
  /** 闯关记录那一行；没有记录时传空串，这一行就不渲染 */
  record?: string;
  /** 难度档。标准档的末关是 15%、六关连过 0.8%——那是给练熟了的人调的曲线，
   * 第一次上手的人会卡死在中段。街机厅有投币续关，手机上没有，就把这个选择交给玩家 */
  diff?: number; onDiff?: (i: number) => void;
}) {
  return (
    <div style={S.full}>
      <MuteButton />
      <SourceLink />
      {/* 横屏是宽而矮的：标题竖排放左、行动放右，各占一半，标题因此能给到足够字号；
          原来是竖向堆叠，在 320px 高的横屏手机上挤成一团 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'clamp(20px, 6vw, 56px)',
        padding: '0 clamp(16px, 5vw, 48px)',
      }}>
        <h1 style={{
          ...VERTICAL, margin: 0, fontFamily: SERIF, fontWeight: 500,
          fontSize: 'clamp(30px, min(14vh, 9vw), 104px)', letterSpacing: 'clamp(4px, 1.6vh, 12px)',
          lineHeight: 1,
        }}>神仙打架</h1>
        <div style={{ borderLeft: `1px solid ${T.hair}`, alignSelf: 'stretch' }} />
        <div style={{ display: 'grid', gap: 'clamp(10px, 2.6vh, 20px)', justifyItems: 'start' }}>
          <p style={{ margin: 0, fontSize: 'clamp(12px, min(2.4vh, 1.5vw), 21px)', letterSpacing: 4, color: T.faint }}>
            东方神话 · 街机格斗
          </p>
          {/* goFullscreen 与 unlockAudio 必须同处这一个同步 onClick 调用栈——两者都靠用户手势
              授权，一旦被 await 打断到微任务之后，浏览器会直接拒绝 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(14px, 4vw, 28px)' }}>
            <Seal label="开始闯关" onClick={() => { unlockAudio(); goFullscreen(); onStart(); }} />
            <Ghost label="训练场" onClick={() => { unlockAudio(); goFullscreen(); onTraining(); }} />
            <Ghost label="操作说明" onClick={onHelp} />
          </div>
          <p style={{ margin: 0, fontSize: 'clamp(11px, min(2.1vh, 1.3vw), 18px)', letterSpacing: 2, color: T.dim }}>
            六关连战 · 对手每趟不同 · 离线可玩
          </p>
          {/* 难度档：三颗小字并排，选中的一颗用朱砂描边。放在副标题下方、记录行上方——
              它是"开始之前要做的决定"，不该埋进操作说明里 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px, 1.4vw, 12px)' }}>
            {DIFFICULTIES.map((d, i) => (
              <button
                key={d.name}
                onClick={() => onDiff?.(i)}
                aria-pressed={i === diff}
                aria-label={`难度 ${d.name}：${d.hint}`}
                style={{
                  fontFamily: SERIF, fontSize: 'clamp(11px, min(2.1vh, 1.3vw), 18px)', letterSpacing: 2,
                  // 上下 3px 时整颗只有 48x24，是全站最小的触摸目标，而它是"开打之前要做的
                  // 那个决定"。这一行左右都空着，加高不挤任何东西
                  padding: '8px 10px', boxSizing: 'border-box',
                  background: i === diff ? 'rgba(178,58,45,.18)' : 'transparent',
                  color: i === diff ? T.paper : T.faint,
                  border: `1px solid ${i === diff ? T.zhusha : T.hair}`,
                  borderRadius: 0, cursor: 'pointer', appearance: 'none',
                }}
              >{d.name}</button>
            ))}
            <span style={{ fontSize: 'clamp(10px, min(1.9vh, 1.2vw), 16px)', color: T.faint, letterSpacing: 1 }}>
              {(DIFFICULTIES[diff] ?? DIFFICULTIES[DEFAULT_DIFFICULTY]).hint}
            </span>
          </div>
          {/* 有记录才画：第一次进来不该先看见一行空的"最远 第—关" */}
          {record && (
            <p style={{
              margin: 0, fontFamily: SERIF, fontSize: 'clamp(11px, min(2.1vh, 1.3vw), 18px)',
              letterSpacing: 3, color: T.tenghuang,
            }}>{record}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 属性条的长度：在四个人之间做**相对**比较，不是按绝对最大值归一。
 * 按最大值归一的话四条全挤在 86-100%，肉眼分不出谁快谁慢（体力 195-215、力道 75-87，
 * 本来差距就不大）。这里把最弱的一档定在 25%、最强的定在 100%，差别才读得出来——
 * 条的本意就是"谁更肉、谁更快"的比较，不是数值的等比例复刻。 */
function spread(vals: number[]) {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (v: number) => (hi === lo ? 1 : 0.25 + 0.75 * (v - lo) / (hi - lo));
}
/** 力道：三段普攻 + 三记必杀的伤害合计，按全员最高归一。
 * 不含大招——两档大招四个人差得很小（30-33 / 52-58），摊进去反而把差别抹平。
 *
 * 这条以前没画，于是卡面上哪吒是"和孙悟空同血（200）但更快（5.6 对 5.1）"，
 * 看起来严格占优；他真正的代价——全场最低伤害——玩家一点都看不到。 */
export const power = (c: CharacterDef) =>
  (['n1', 'n2', 'n3', 's1', 's2', 's3'] as const).reduce((n, k) => n + c.moves[k].damage, 0);
/**
 * 攻程：三记必杀里伸得最远的那一记，取 **x + w**（判定框相对身体中心的外沿）。
 *
 * 原来只取 w、不算偏移 x，量出来的排名是错的：卡面说哪吒 186 全场最短，
 * 而实测**它的最远命中距离是 376，全场第二**（二郎神 419 / 孙悟空 258 / 牛魔王 252）；
 * 牛魔王卡面第二（240），实测垫底。也就是说这根柱子在把玩家往错的方向推——
 * 而哪吒本来就是最终关最吃亏的那个角色。
 * 换成 x + w 之后是 340 / 260 / 240 / 240，与实测排名完全吻合。
 *
 * 这一项存在的理由不变：只画血/速/力三项的话，孙悟空在这三项上全面压过二郎神
 *（血更多、更快、力道相同），卡面等于在说"别选二郎神"。
 */
export const reach = (c: CharacterDef) => Math.max(...(['s1', 's2', 's3'] as const).map(k => {
  const m = c.moves[k];
  // **投射物要算进来**。原来只量近身判定框，于是后羿——三记必杀全是箭、全场唯一能整局
  // 不进近身距离的人——被量成攻程 134，全名册最短，卡面等于在说"这个远程角色够不着"。
  // 弹的攻程就是它飞得到的地方，按场地宽度封顶（再远也出界了）。
  // 三个人并列封顶（哪吒的乾坤圈、二郎神的光束、后羿的箭）是**真的**：他们都能从任何位置打到你。
  // 有弹 = 攻程拉满，**不按弹速×寿命排**。
  //
  // 按飞行距离排是错的，实测把它翻了过来：五个有投射物的角色实测最远命中是
  // 铁扇 465 / 钟馗 438 / 二郎神 435 / 后羿 409 / 哪吒 393——**最慢的两发反而最远**。
  // 道理也直白：慢弹在场上待得久，等对手退开了才撞上；快弹往往在两人还近的时候就打中了。
  // 而这五个人彼此只差 15%，近身派则集中在 209~348——真正的分界是"有没有弹"，
  // 不是弹有多快。卡面照这个分界画，秩相关从 0.59 升到 0.81。
  return m.projectile ? ARENA_MAX - ARENA_MIN : m.hitbox.x + m.hitbox.w;
}));
/**
 * 击退：六记地面招里把人推得最远的那一记（knockback.x）。
 *
 * 这一项是被**卡面不说谎**那条断言逼出来的，和当初加「攻程」是同一个理由：
 * 铁扇公主在血/速/力/程四项上被哪吒和孙悟空全面压过，卡面等于在说「别选她」——
 * 而她真正的立身之本（把人推开、拒绝贴身、破版边压制）四项里一项都没画。
 * 加上这一项之后，六个人里没有任何一个被全面压过。
 */
export const push = (c: CharacterDef) =>
  Math.max(...(['n1', 'n2', 'n3', 's1', 's2', 's3'] as const).map(k => c.moves[k].knockback.x));
/**
 * 上下段：这个角色有几招**必须选对防御姿势**才挡得住（guard 为 low/overhead 的招数）。
 *
 * 全名册里这一项长期是 2：跳跃攻击（中段）与连击第二段（下段）——也就是说所有人的
 * **必杀都不分上下段**，防御在必杀距离上根本不需要读招。白骨精把这件事翻过来：
 * 白骨爪贴地（必须蹲防）、骨刺升从上砸下（必须站防），两招起手同为 9 帧、判定框都从
 * 身前 30 开始，看起来一模一样。她因此是 4，别人是 2。
 *
 * 画成一根柱子的理由与「击退」相同：不画的话，她在血/速/力/程/击退 五项上被哪吒
 * 全面压过，卡面等于在说「别选她」——而她真正的本事一项都没画。
 * 五个人并列 2 也是有效信息：那说明他们同样好读。
 */
export const mixup = (c: CharacterDef) =>
  Object.values(c.moves).filter(m => m.guard).length;
const hpBar = spread(CHARACTERS.map(c => c.hp));
const spdBar = spread(CHARACTERS.map(c => c.speed));
const pwrBar = spread(CHARACTERS.map(power));
const rchBar = spread(CHARACTERS.map(reach));
const pushBar = spread(CHARACTERS.map(push));
const mixBar = spread(CHARACTERS.map(mixup));

/** 属性条：不发明"轻灵/迅猛"这类标签，直接把 hp/speed 按全员最大值归一画成两条。
 * 玩家要的是"谁更肉、谁更快"的比较，比一个生造的形容词准确。 */
function Stat({ label, ratio, color }: { label: string; ratio: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: 1, color: T.dim, flex: 'none' }}>{label}</span>
      <span style={{ flex: 1, height: 3, background: 'rgba(237,227,210,.14)' }}>
        <span style={{ display: 'block', width: `${ratio * 100}%`, height: '100%', background: color }} />
      </span>
    </div>
  );
}

/** 操作说明。跑/回避/受身/防御取消这些系统全在引擎里，键盘玩家此前没有任何入口能知道
 * 它们存在——触屏至少还有局势提示条。分两栏：左边是基础按键，右边是进阶系统。 */
/**
 * 说明区底边的渐隐＝「下面还有」。**这一页在窄屏上藏的比露的还多**：568x320 实测视口内
 * 只有 235px，底下还压着 258px（667x375 藏 211px、844x390 藏 31px、932x430 才刚好放得下）。
 * 而手机上的滚动条是 overlay 的——静止时一条都看不见（实测 offsetWidth-clientWidth === 0），
 * 「返回」又常驻在底部，整页读起来就是"到此为止"：整栏「防守」（受身、防御取消、投技解脱、
 * 爆气……）从来没有被人看见过。
 *
 * 渐隐本身写在 index.html 的 `.sx-more` 里，这里只开关那个类：滚到底就摘掉，
 * 免得把最后一行也吃掉半截。**不做成常驻的静态渐隐**——内容放得下时（932x430 实测
 * 一个像素都不用滚）那道渐隐就是一句假话，而这一条改动本来治的就是"页面谎报到此为止"。
 *
 * 写成 **ref 回调**而不是 useEffect/useState：`tests/help-layout.test.tsx` 把 `Help` 当纯函数
 * 直接调用来查结构，组件里一有 hook 就调用不了（同 App.tsx 里 Select 的 pick 提到外面的理由）。
 * ref 回调只是个 prop，直接调用 Help 时它压根不会跑。放模块级，免得每次渲染换个函数身份。
 */
const helpPaneRef = (el: HTMLDivElement | null) => {
  if (!el) return;
  // classList.toggle 带第二参数是幂等的：状态没变就什么都不写，不像逐帧重设 style 那样
  // 每个滚动事件都要重新解析一遍渐变字符串
  const check = () => el.classList.toggle('sx-more', el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  check();
  el.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check);
  return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
};

export function Help({ onBack }: { onBack: () => void }) {
  const row = (a: string, b: string) => (
    <div key={a} style={{ display: 'flex', gap: 10, fontSize: 'clamp(10px, min(1.9vh, 1.2vw), 15px)', lineHeight: 1.55 }}>
      {/* 7em = 防守栏里最长的那条标签。原来是 5.6em，那一行的说明会被顶得比同栏其余几行
          往右错开一截，读起来像排版没对齐。
          这里**刻意不把那条标签的字面量抄进注释**：guardCancelRoll 有一条断言正是
          `helpSrc.includes(<那条标签>)`，注释里再出现一次，锚点就从 1 处变成 2 处，
          真把那一行删了测试照样绿（check-anchors.mjs 查的就是这个）。 */}
      <span style={{ color: T.paper, minWidth: '7em', flex: 'none' }}>{a}</span>
      <span style={{ color: T.dim }}>{b}</span>
    </div>
  );
  // 每栏基准 330px，按可用宽度自动决定并排几栏：1200+ 三栏、600-1100 两栏、更窄一栏。
  // 260 试过，宽度不够时说明文字会逐字换行、一行变三行——实测 960x540 下三栏挤成一团，
  // 比两栏还难读。宁可少一栏，不要把字挤碎。
  const col = (title: string, rows: [string, string][]) => (
    <div key={title} style={{ display: 'grid', gap: 2, flex: '1 1 330px', minWidth: 0, alignContent: 'start' }}>
      <div style={{ color: T.faint, letterSpacing: 3, fontSize: 'clamp(9px, min(1.6vh, 1vw), 13px)', marginBottom: 2 }}>{title}</div>
      {rows.map(([a, b]) => row(a, b))}
    </div>
  );
  return (
    <div style={S.full}>
      {/* 三行网格：标题、可滚动的说明区、常驻的返回按钮。
          说明区自己滚动而不是把整页撑高——进阶系统这几轮加到了十几项，
          三栏在 568x320（SE 横屏）下会折行，内容底部实测顶到 391px，
          「返回」直接跑到屏幕外，按不到就出不去这一页。 */}
      <div style={{
        display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gap: 'clamp(6px, 1.6vh, 14px)', boxSizing: 'border-box', overflow: 'hidden',
        padding: 'clamp(10px, 3vh, 28px) clamp(12px, 4vw, 48px)', justifyItems: 'center',
        // S.full 是 placeItems:center 的网格——不写 stretch 的话这一块会被内容撑开再居中，
        // height:100% 根本约束不住它（实测 568x320 下说明区自己算出 407px 高，比视口还高）
        alignSelf: 'stretch', justifySelf: 'stretch', height: '100%', maxHeight: '100%',
      }}>
        <p style={{ margin: 0, fontFamily: SERIF, fontSize: 'clamp(15px, min(3vh, 2vw), 24px)', letterSpacing: 6 }}>操作</p>
        <div ref={helpPaneRef} style={{
          display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px, 3vw, 40px)',
          alignItems: 'flex-start', justifyContent: 'center',
          // 这一页是全项目字最密的一屏，而 MenuBackdrop 那轮月亮画在固定的逻辑坐标上，
          // 844x390 / 932x430 下正好落在「进攻」栏头两行背后——宣纸色的字压在宣纸色的月面上，
          // 「先行输入」「连段取消」两行实测读不出来。S.full 那道 textShadow 兜得住亮山脊，
          // 兜不住这么大一块亮面。给说明区自己垫一张暗底（同静音键/提示条那一族的夜色），
          // 标题与「返回」仍然浮在夜景上，不动整页的构图
          // 只加横向内边距：竖向再加一点，932x430 上本来刚好放得下的内容就又要滚 12px 了
          background: 'rgba(7,13,24,.72)',
          padding: '0 clamp(8px, 2vw, 18px)',
          // 底边那道"下面还有"的渐隐是 index.html 里的 .sx-more，由 helpPaneRef 按滚动位置挂摘
          // 折行之后 align-content 默认会把多余的竖向空间摊在行与行之间，
          // 实测 960x540 下第二行「防守」被推下去近百像素，看着像排版错位
          alignContent: 'flex-start',
          overflowY: 'auto', minHeight: 0, width: '100%', maxWidth: 1100,
          // 原生滚动条在这套水墨深色界面上是一条灰白粗带，667x375 实测比正文还抢眼。
          // 收细并染成 hair 那档——它本来就是"细线、分隔栏"用的色，与其他分隔线同源。
          scrollbarWidth: 'thin', scrollbarColor: `${T.hair} transparent`,
        }}>
          {/* 一律「先说手上怎么做，键盘补在末尾」。此前这三栏是混着写的：基本栏有四行直接
              以 A D / S、W、J、L 开头，进攻/防守栏里受身、防御取消、投技解脱、爆气、吹飞
              **只给了键盘字母**——而这是一个横屏手机游戏（桌面键盘按 spec 只是调试用的副产品）。
              拿着手机的人读到「倒地瞬间新按 J 或 L」，屏幕上没有 J 也没有 L。
              键位名也统一取界面自己的叫法（普攻键 / 技能键 / 大招键 / 防御键 / 吹飞键），
              这套叫法在「技能」「大招」两行本来就在用，只是没铺开。 */}
          {col('基本', [
            ['移动 / 蹲', '摇杆左右 / 下　键盘 A D / S'],
            ['跳', '摇杆上　轻点=小跳 按住=大跳　键盘 W'],
            ['普攻', '普攻键　三段连击（第二段是下段扫堂）　键盘 J'],
            // 一行说三件事（怎么出、去哪查、键盘是哪几个）在 667x375 下会顶到右边缘。
            // 拆成两行：先说怎么出，再说去哪查——后者是"需要时才找"的信息，不该和操作挤在一起。
            ['技能', '技能键 + 摇杆：中立 / 推方向 / 推下　三记必杀　键盘 U I O'],
            ['招式表', '选人页里每个人的四招都写着'],
            ['大招', '大招键　气 50 奥义 / 100 超必杀　键盘 K'],
            ['防御', '防御键　推下=蹲防　键盘 L'],
            ['投技', '贴身按普攻键自动改投'],
          ])}
          {col('进攻', [
            // 「先行入力」的入力是日文（输入）。这一屏只有它和「挑衅」不是简体中文写法
            ['先行输入', '硬直里提前按也算数——出招键会记住 6 帧'],
            ['连段取消', '普攻命中后再按一下普攻键，收招帧被下一段吃掉'],
            ['必杀取消', '普攻命中后按技能／大招；挑空前取消最赚'],
            ['大招取消', '必杀命中后按大招　n1→n2→必杀→大招 最赚'],
            ['反击命中', '打在对手起手/判定帧里　伤害 ×1.2、硬直 +6'],
            ['跑', '双击前进　可接跳/出招'],
            ['后跳', '双击后退　起跳无敌'],
            ['吹飞攻击', '吹飞键　打飞到版边，必倒且不能受身　键盘 H 或 J+L'],
            ['挑衅', '防御 + 上　削对手 10 气；只在对手倒地或离得远时出得来'],
          ])}
          {col('防守', [
            ['蹲防 / 站防', '站防挡不住下段，蹲防挡不住跳跃攻击'],
            ['紧急回避', '防御 + 左/右　穿过对手换边；中段无敌，收尾没有'],
            ['受身', '倒地瞬间新按普攻键或防御键；大招/投技/吹飞打倒的不能受身'],
            ['防御取消', '格挡中按普攻键（50 气）把对手顶开'],
            // 这里的 · 是**专名内部的间隔号**（同招式名「风火轮·升龙」）：它是防御取消的一个
            // 变体，不是并列的两件事。/ 在这一栏只表示「或 / 又叫」（蹲防 / 站防、爆气 / MAX）
            ['防御取消·回避', '格挡中新推方向（50 气）滚到对手背后；被逼到版边时用这个'],
            ['投技解脱', '被投前的一瞬新按普攻键（按住不放无效）'],
            // 蓄气那一半原来没写：按住不放是先攒气、够 50 才炸开，只说结果的话
            // 玩家不知道气不够时按着有没有用（对局里那条轮播提示反而说全了）
            ['爆气 / MAX', '防御 + 大招按住蓄气　够 50 气炸开：顶开 + 无敌，5 秒伤害提升　键盘 L + K'],
          ])}
        </div>
        <Ghost label="返回" onClick={onBack} />
      </div>
    </div>
  );
}

/** 陪练场的木桩行为。游戏现在有十几个系统，而上下段、反击命中、抓空挥**都要对手做点什么**
 * 才练得出来——一个站着不动的木桩只能练连段。四挡各有明确的练习目标，不做随机挡：
 * 随机会让玩家分不清"这次没打中"是自己错了还是骰子。 */
export type DummyMode = 'idle' | 'stand' | 'crouch' | 'jumpin' | 'press' | 'fight';

export const DUMMY_MODES: { key: DummyMode; label: string; hint: string }[] = [
  { key: 'idle', label: '木桩', hint: '不动　练连段与取消路线' },
  { key: 'stand', label: '站防', hint: '站着防　练下段（连击第二段是扫堂）' },
  { key: 'crouch', label: '蹲防', hint: '蹲着防　练中段（跳起来打）' },
  // 对空是这套系统里最新、也最难自己摸出来的一环：AI 现在会读起跳、会站防、会用必杀迎击，
  // 玩家跳进去有 57% 被挡下。可反过来"别人跳我怎么办"却没地方练——
  // 木桩/站防/蹲防都不会跳，对打挡的 AI 跳得又太随机。
  { key: 'jumpin', label: '跳入', hint: '不停跳过来　练对空（下落段迎击最稳）' },
  // 防御取消、投技解脱、受身这三样此前只能在「对打」挡碰运气——那一挡的 AI
  // 会退会防会放招，一分钟压不上来几次。这一挡只干一件事：贴上来连续出招。
  { key: 'press', label: '压制', hint: '贴身连打　练防御取消（格挡中按普攻/推方向）与投技解脱' },
  { key: 'fight', label: '对打', hint: '会还手　练反击命中与抓空挥' },
];

/** 一个回合打完之后：这一关分出胜负了没有。抽成纯函数是为了能测——
 * 判定埋在 onTick 的闭包里的话，"2-1 该不该结束"这种事只能靠肉眼在浏览器里凑。 */
/**
 * 三局两胜，以及每一回合开场报的名字。**两者必须配套**：
 * 开场横幅的文字若取到 undefined，GameCanvas 那边不只是少一行字——
 * `ready = stageName ? STAGE_HOLD_END : 0`，横幅没有就连开场的输入锁一起没了，
 * 回合会在双方都能动的状态下**直接开打**，而且不报任何错。
 * 现在 need=2 时回合下标最多到 2（平局给双方各记一分，只会加快不会拖长），刚好够用；
 * 改成三胜就会漏到 ROUND_NAMES[3]。roundNames 覆盖不到的配置由 roundNaming.test 挡住。
 */
export const ROUNDS_TO_WIN = 2;
export const ROUND_NAMES = ['第一回合', '第二回合', '最终回合'];

/**
 * 选人页的招式表怎么排。**方向→槽位这件事只有一处定义**（TouchLayer 的 skillSlotFor，
 * 触屏按下技能键时判的就是它），这里只给"按法怎么写"，槽位现问现取——
 * 两处各写一份迟早对不上（这个项目在规则漂移上栽过四次）。
 */
export const SKILL_ROWS = [
  { key: '技', say: '技能键', dir: { left: false, right: false, crouch: false } },
  { key: '←→ + 技', say: '推左右加技能键', dir: { left: true, right: false, crouch: false } },
  { key: '↓ + 技', say: '下蹲加技能键', dir: { left: false, right: false, crouch: true } },
] as const;

export function roundOutcome(
  wins: [number, number], winner: 0 | 1 | null, need: number,
): { done: true; playerWon: boolean } | { done: false; wins: [number, number] } {
  // winner === null 是读秒平局（时间到且双方血量比例完全相等）：双方各记一个回合。
  // 不记的话两个只会跑的人可以把同一个回合无限重开
  const next: [number, number] = [
    wins[0] + (winner !== 1 ? 1 : 0),
    wins[1] + (winner !== 0 ? 1 : 0),
  ];
  if (next[0] >= need || next[1] >= need) return { done: true, playerWon: next[0] >= need };
  return { done: false, wins: next };
}

/** 三局两胜的回合比分。摆在顶部居中的 HUD 空档里（血条从两侧向中间伸，中轴留着一条空档），
 * 和退出键、静音键、陪练挡位条同一条轴。 */
export function RoundScore({ wins, need, battle }: { wins: [number, number]; need: number; battle: Battle }) {
  const [, force] = useState(0);
  // 读秒只需要秒级刷新。计时本身在 battle.tick 的固定 1/60s 逻辑帧里递减，
  // 这个 interval 不推进任何量，换刷新率也不会改变读秒快慢（同 TouchLayer 的冷却扇形）
  useEffect(() => {
    const t = setInterval(() => force(v => v + 1), 200);
    return () => clearInterval(t);
  }, []);
  const sec = Math.ceil(battle.timeLeft / 60);
  const pip = (on: boolean) => (
    <span style={{
      width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
      background: on ? T.tenghuang : 'transparent',
      border: `1px solid ${on ? T.tenghuang : T.hair}`,
      boxShadow: on ? `0 0 6px ${T.tenghuang}` : 'none',
    }} />
  );
  const side = (n: number, flip: boolean) => {
    const dots = Array.from({ length: need }, (_, i) => <span key={i}>{pip(i < n)}</span>);
    return <span style={{ display: 'inline-flex', gap: 4 }}>{flip ? dots.reverse() : dots}</span>;
  };
  return (
    <div style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: 60, zIndex: 20,
      display: 'flex', gap: 12, alignItems: 'center', pointerEvents: 'none',
    }}>
      {/* 己方的点靠中轴那一侧先亮，读起来和血条一样是"从中间往外长" */}
      {side(wins[0], true)}
      {/* 读秒摆在两侧比分之间——经典格斗 HUD 就是这个位置。最后十秒转朱砂色 */}
      <span style={{
        fontFamily: SERIF, fontSize: 20, lineHeight: 1, minWidth: '2ch', textAlign: 'center',
        color: sec <= 10 ? T.zhusha : T.paper,
        textShadow: sec <= 10 ? `0 0 10px ${T.zhusha}` : 'none',
      }}>{sec}</span>
      {side(wins[1], false)}
    </div>
  );
}

/**
 * 挡位 → 木桩这一帧的输入。返回 null 表示这一挡交给陪练 AI（对打）。
 * 抽成纯函数是为了能测：TrainingBar 本体是组件，而"站防到底有没有按住防御"这件事
 * 正是这套陪练挡位的全部行为。
 *
 * ctx 只有「跳入」「压制」两挡用得上——它们需要知道自己的状态、对手在哪一侧、以及离多远。
 * 不传就退回原来的行为，其余四挡与此前逐帧一致。
 */
export function dummyFrame(mode: DummyMode, ctx?: { self: Fighter; toward: Dir; gap: number }): InputFrame | null {
  switch (mode) {
    case 'stand': return { ...NULL_INPUT, block: true };
    case 'crouch': return { ...NULL_INPUT, block: true, crouch: true };
    case 'fight': return null;
    case 'press': {
      if (!ctx) return NULL_INPUT;
      const { self, toward, gap } = ctx;
      // 够不着就走过去；贴上了就连打。节奏比乱按慢一点（每 9 帧一下），
      // 留出格挡硬直的窗口——连得太密的话玩家根本没有按防御取消的机会
      if (gap > 70) return { ...NULL_INPUT, move: toward };
      return { ...NULL_INPUT, attack: self.stateFrame % 9 === 0 };
    }
    case 'jumpin': {
      if (!ctx) return NULL_INPUT;
      const { self, toward } = ctx;
      // 空中：第 12 帧出手。小跳滞空 25 帧，这个时机让判定框停在弧线最低点上——
      // 也是实测最强的那一档（第 4/6/8 帧分别只有 1%/2%/4% 的通关概率，第 12 帧是 28%）。
      // 练对空就该拿最难防的那一种来练。
      if (self.state === 'jump') {
        return { ...NULL_INPUT, move: toward, attack: self.stateFrame === 12 };
      }
      // 落地后原地等一会儿再跳，给玩家留出反击和调整的时间——连着跳是压制不是陪练
      if (self.state !== 'idle' && self.state !== 'walk') return NULL_INPUT;
      return { ...NULL_INPUT, move: toward, jump: self.stateFrame >= 24 };
    }
    default: return NULL_INPUT;
  }
}

export function TrainingBar({ mode, onPick, foeId, onFoe, onExit }: {
  mode: DummyMode; onPick: (m: DummyMode) => void;
  /** 陪练对手。四个角色打法差得远——练接二郎神的天眼光束和练接牛魔王的冲撞不是一回事 */
  foeId: string; onFoe: (id: string) => void;
  /** 回主页。装好的全屏 PWA 里没有刷新入口，陪练场必须留一条肉眼可见的出口 */
  onExit: () => void;
}) {
  const cur = DUMMY_MODES.find(m => m.key === mode)!;
  const chip = (on: boolean): React.CSSProperties => ({
    font: 'inherit', fontSize: 12, letterSpacing: 1, padding: '3px 9px', cursor: 'pointer',
    color: on ? T.paper : T.dim,
    background: on ? 'rgba(237,227,210,.14)' : 'rgba(7,13,24,.55)',
    border: `1px solid ${on ? T.dim : T.hair}`,
  });
  return (
    <div style={{
      // 顶部、压在静音键那一行下面，并且**让开右下角那簇键**（LEFT_OF_CLUSTER，与提示条同一份）。
      // 按视口中线摆时，568x320 上十二张对手卡折成三行、整块伸到 x=426，直接压住「超必杀」
      // 和「吹飞」：实测「后羿」与超必杀重叠 18x24px、「猪八戒」与吹飞重叠 56x7px。
      // 而挡位条画在 TouchLayer 之后、盖在上面，于是被吃掉的是**按键的触摸区**——
      // 正在练大招的时候，按不出大招。
      // 试过左上角，直接盖住角色名与血条（截图上一眼就看得见）。
      ...LEFT_OF_CLUSTER,
      top: 60, zIndex: 20,
      display: 'grid', gap: 4, justifyItems: 'center', pointerEvents: 'auto',
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {DUMMY_MODES.map(m => (
          <button key={m.key} className="sx-chip" onClick={() => onPick(m.key)} aria-pressed={m.key === mode} style={chip(m.key === mode)}>
            {m.label}
          </button>
        ))}
      </div>
      {/* 对手行必须能折：十二个人排一行放不下，溢出不会有任何报错，按钮跑到屏幕外就是按不到。
          窄屏那一侧现在由 LEFT_OF_CLUSTER 那条带子管（568x320 实测带宽 308px，这一行被压到 308），
          所以 520 只在**宽屏**才吃紧——932x430 实测带宽 672、这一行正好停在 520。
          两个约束各管一头，都不能删：带子管"别压到按键"，520 管"别摊成一条太长的横排"。 */}
      {/* 折起来。名册从四人涨到十二人之后，这一行在 568x320 上折成**三行**，整条从
          y=168 长到 191——而木桩跳到峰值时头顶在屏幕 y≈150（跳高 46 逻辑单位，
          FLOOR_Y 460、身高约 160、LOGIC_H 540 映射到 320）。也就是说**「跳入」这一挡
          唯一要看的东西被自己的挡位条挡住了 41px**：那一挡就是练对空的，看不见来人
          就没得练。上面那句「再长就盖到人物头顶」是四人时代写的，当时它还是对的。
          用原生 <details> 而不是 useState：`tests/training.test.ts` 把 TrainingBar 当纯函数
          调用，组件里一旦有 hook 那几条断言当场全红（Select 上记过同一条）。
          顺带 <details> 本来就带键盘可达与展开语义，比自己搭一套省事。 */}
      <details
        style={{ maxWidth: 'min(520px, calc(100vw - 48px))' }}
        onClick={e => {
          // 点中某个对手就收起来：练的时候不该一直摊着三行。用 DOM 直接关，
          // 不引入 React 状态（理由同上）。点 summary 本身交给浏览器的默认行为。
          const t = e.target as HTMLElement;
          if (t.closest('button')) (e.currentTarget as HTMLDetailsElement).open = false;
        }}
      >
        <summary style={{ ...chip(false), listStyle: 'none', display: 'inline-block', userSelect: 'none' }}>
          换对手：{CHARACTERS.find(c => c.id === foeId)?.name ?? '—'}
        </summary>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', paddingTop: 4 }}>
          {CHARACTERS.map(c => (
            <button key={c.id} className="sx-chip" onClick={() => onFoe(c.id)} aria-pressed={c.id === foeId}
              aria-label={`陪练对手换成${c.name}`} style={chip(c.id === foeId)}>{c.name}</button>
          ))}
        </div>
      </details>
      {/* 出口跟挡位说明并排放在最后一行，不另起一行也不做成独立的固定元素：
          做成固定元素时它和这块控件带抢同一块地方（两者都从左沿 10px 起算，实测撞在一起），
          自己另起一行又要多吃约 28px——568x320 上这块已经压到 y=168，再长就盖到人物头顶。
          并排还顺带把它和挡位片隔开：紧挨着「木桩」的话，想换挡位却按出退出的代价太大。 */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: T.faint, letterSpacing: .5, whiteSpace: 'nowrap' }}>{cur.hint}</span>
        <Ghost label="退出训练场" onClick={onExit} className="sx-chip"
          style={{ fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, padding: '2px 2px 1px' }} />
      </div>
    </div>
  );
}

/**
 * 选人页的列数。四个人时一排四张（和以前一样），人多了就折成两排——
 * 十二张排成一行在 568px 宽的横屏手机上根本放不下（每张至少 88px，一行要 1100px+）。
 *
 * 两排是刻意的上限：三排的话每张卡会矮到名号竖排都排不下，而且拇指要够到屏幕上半部分。
 */
export function selectCols(n: number): number {
  return n <= 4 ? n : Math.ceil(n / 2);
}

/**
 * 选人卡上的立绘。画一次就完了（角色是静态的），所以用 ref + 一次性 effect，
 * 不进渲染循环——十二张卡各跑一个 60fps 画布，只为一屏选人，是纯浪费。
 *
 * dpr 要乘进去：不乘的话在高密度屏上这十二张立绘全是糊的，
 * 而选人页恰恰是玩家盯着看最久的一屏之一。
 */
function CardPortrait({ def }: { def: CharacterDef }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const paint = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.scale(dpr, dpr);
      // 往右让出名号那一列的宽度：人形本来画在正中，名号靠左之后两者仍会擦边。
      ctx.translate(r.width * 0.12, 0);
      drawPortrait(ctx, def, r.width, r.height);
    };
    paint();
    // 立绘只画一次，而部件是异步探测的——第一次画的时候素材通常还没到，
    // 画出来就是火柴人且永不更新（对局每帧重画，所以那边看不出这个问题）。
    // 所以主动发起探测，并在加载完成时补画一次。
    preloadParts(def.id);
    return onPartsLoaded(paint);
  }, [def]);
  return (
    <canvas
      ref={ref} aria-hidden
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        // 名号从居中挪到左边缘之后，立绘不必再让路——恢复全亮。
        // 压暗那一档是名号盖脸时代的补偿：那时卡面上是火柴人，盖住没什么损失；
        // 现在头是三分侧面的真脸、躯干是侧身贴图，压暗 + 遮挡等于把素材白做了。
        opacity: 1, pointerEvents: 'none',
      }}
    />
  );
}

export function Select({ onPick, onBack, training, cleared = [], pick = 0, onFocus }: {
  onPick: (c: CharacterDef) => void; onBack: () => void;
  /** 陪练场入口也走这一页——标题换一句，免得玩家以为按错了进了闯关 */
  training?: boolean;
  /** 已经用来通关过的角色 id。选人时才是玩家真正需要知道"还差谁"的地方——
   * 标题页那行「已通关 N/4 人」看过就走，做决定却在这一页 */
  cleared?: string[];
  /** 当前选中第几个。**状态放在 App 而不是这里**：这一页的断言全靠"把组件当纯函数调用、
   * 对返回的元素树下断言"，组件里一旦有 hook 就调用不了（六条断言当场全红）。 */
  pick?: number;
  onFocus?: (i: number) => void;
}) {
  // 先选后定：点卡只是选中，右侧详情跟着换，再按印章才进场。
  // 四个人时"点一下就进去"也够用，但十二个人时玩家需要一个**比较**的动作——
  // 四条属性条 ×12 同屏是读不完的，一次只读一个人的才读得动。
  const cur = CHARACTERS[pick] ?? CHARACTERS[0];
  const cols = selectCols(CHARACTERS.length);
  return (
    <div style={{ ...S.full, placeItems: 'center' }}>
      <div style={{ display: 'grid', gap: 'clamp(8px, 2.2vh, 18px)', justifyItems: 'center' }}>
        <p style={{ margin: 0, fontSize: 'clamp(12px, min(2.4vh, 1.5vw), 21px)', letterSpacing: 6, color: T.faint }}>
          {/* 陪练那版不写「进陪练场」：底下那颗印章就叫这个名字，标题再说一遍等于把
              按钮的话抢着说了——标题说这一屏是干什么的，按钮说按下去会发生什么。
              顺带解决一处压字：MenuBackdrop 那轮月亮画在固定逻辑坐标上，九个字的标题在
              844x390 / 932x430 上会伸进月面（实测重叠 27x15 / 21x15px），而标题是
              T.faint 的浅色字压在宣纸色的月亮上。收到七个字之后两档都够不着了。 */}
          {training ? '选一位神仙陪练' : '选一位神仙'}
        </p>
        {/* 左边神仙谱、右边详情。横屏是宽而矮的，并排比上下堆叠省高度 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px, 2.4vw, 26px)' }}>
          {/* 神仙谱：栏序从左到右（简体界面、与战斗里 P1 在左一致），栏内名号竖排 */}
          <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${cols}, auto)`,
            gap: 'clamp(6px, 1.4vw, 12px)',
          }}>
            {CHARACTERS.map((c, i) => (
              <button
                key={c.id}
                className="char-card"
                onClick={() => onFocus?.(i)}
                aria-pressed={i === pick}
                aria-label={`${c.name}，${c.role}${cleared.includes(c.id) ? '，已通关' : ''}`}
                style={{
                  // 卡面只剩名号：十二张卡各画四条属性条是读不完的，属性挪到右侧详情。
                  // 高度按"两排也放得下"取：clamp 上限从 38vh 收到 26vh
                  width: 'auto', aspectRatio: '0.62',
                  height: 'clamp(84px, min(26vh, 13vw), 190px)',
                  // 名号靠**左边缘**，不再居中：居中时它正压在人形的脸和躯干上，
                  // 于是立绘只能压暗到 0.6 再配一圈墨晕，两边都读不清。
                  // 人物一律朝右、兵器往右伸，左侧那一条是空的，名号放这里谁也不挡。
                  display: 'grid', alignItems: 'center', justifyItems: 'start',
                  padding: 'clamp(5px, 1.2vh, 10px) clamp(4px, 0.9vw, 8px)',
                  background: `linear-gradient(${c.palette.main}${i === pick ? '66' : '2a'}, ${c.palette.main}${i === pick ? '66' : '2a'}), rgba(9,17,28,.95)`,
                  color: i === pick ? T.paper : T.dim,
                  // 选中那张用朱砂描边——十二张里一眼看得出光标在哪
                  border: `1px solid ${i === pick ? T.zhusha : T.hair}`,
                  borderRadius: 0, cursor: 'pointer', appearance: 'none', font: 'inherit', margin: 0,
                  position: 'relative',
                  // 立绘里的长兵器（如意棒 118、三尖两刃刀 104、九齿钉耙 100）比卡面还宽，
                  // 不裁的话会伸进隔壁那张卡里去。裁掉是对的：截断的立绘读作"取景"，
                  // 越界的兵器读作"画错了"。缩小整个人来迁就兵器则会把人缩成一粒。
                  overflow: 'hidden',
                }}
              >
                {/* 立绘垫在名号之下：十二张卡此前只有名号 + 一层配色，形状完全一样，
                    "新角色怎么都一样"最早就是在这一屏被看见的（比进对局还早）。
                    画的是对局里同一套骨骼，所以卡面上是谁，待会儿打的就是谁。 */}
                <CardPortrait def={c} />
                {/* 字号随名号长度收——四个字的「铁扇公主」按三字的字号排不下这张卡的高度，
                    竖排会折成两列，画面上读作「铁扇／公主」。
                    这是**第二次**栽在同一件事上：上一次是通关印挤掉名号高度、
                    三个字的「二郎神」被折成「神二／郎」。竖排名号的高度余量必须按最长的名字算。 */}
                <span style={{
                  // 定位过的元素才压得住上面那张 absolute 的立绘画布（同栈内按 DOM 顺序），
                  // 不加这一条名号会被立绘整个盖掉
                  position: 'relative',
                  // 墨色光晕：卡面垫了立绘之后，浅色竖排名号正好压在人形上，
                  // 没有这一圈就是"字和人糊成一团"。halo 比加底色好——
                  // 底色会切掉立绘的一条，光晕只在笔画周围一两像素内起作用
                  textShadow: '0 0 5px rgba(9,17,28,.98), 0 0 11px rgba(9,17,28,.92), 0 1px 2px rgba(9,17,28,1)',
                  ...VERTICAL, fontFamily: SERIF, fontWeight: 500,
                  fontSize: c.name.length >= 4
                    ? 'clamp(12px, min(2.5vh, 1.55vw), 24px)'
                    : 'clamp(15px, min(3.4vh, 2.1vw), 32px)',
                  letterSpacing: c.name.length >= 4 ? 1 : 2, lineHeight: 1,
                  // 竖排下 nowrap 才是"不许折成第二列"。只把字号调小是不够的——
                  // 实测四字的「铁扇公主」在小一档的字号下仍然折（差几个像素就折），
                  // 而折一次就读成两个词。宁可字小一点，也不能让名字断开。
                  whiteSpace: 'nowrap',
                }}>{c.name}</span>
                {/* 通关印绝对定位盖在角上，不占布局（占布局会挤掉三个字的名号，画面上读作「神二／郎」） */}
                {cleared.includes(c.id) && (
                  <span aria-hidden style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 'clamp(14px, 2.6vh, 20px)', height: 'clamp(14px, 2.6vh, 20px)',
                    display: 'grid', placeItems: 'center', boxSizing: 'border-box',
                    border: `1px solid ${T.zhusha}`, color: T.zhusha,
                    fontFamily: SERIF, fontSize: 'clamp(9px, 1.6vh, 13px)', lineHeight: 1,
                    background: 'rgba(178,58,45,.12)',
                  }}>通</span>
                )}
              </button>
            ))}
          </div>
          {/* 详情：一次只读一个人的四条属性，读得动 */}
          <div style={{
            display: 'grid', gap: 'clamp(6px, 1.6vh, 12px)', justifyItems: 'start',
            minWidth: 'clamp(120px, 22vw, 210px)',
          }}>
            <span style={{
              fontFamily: SERIF, fontSize: 'clamp(19px, min(4.4vh, 2.6vw), 40px)',
              letterSpacing: 3, lineHeight: 1, color: T.paper,
            }}>{cur.name}</span>
            <span style={{
              fontSize: 'clamp(11px, min(2.1vh, 1.3vw), 18px)', letterSpacing: 2, color: T.tenghuang,
            }}>{cur.role}</span>
            {/* 机制钩子：定位是形容词，这一行才说得出"他跟别人到底哪儿不一样" */}
            <span style={{
              fontSize: 'clamp(10px, min(1.85vh, 1.15vw), 16px)', letterSpacing: 1, color: T.dim,
              // textWrap: pretty 让浏览器避开孤行。实测 667x375（最窄的移动横屏）下
              // 哪吒那句「乾坤圈会飞回来，去和回各判一次」被 15em 断成「…各判 / 一次」，
              // 末行只剩两个字，读起来像句子断了。pretty 会回退一两个字重排，
              // 代价只是上一行短一点。这一格是十二个人里最长的一句，别人更不会溢出。
              lineHeight: 1.5, maxWidth: '15em', textWrap: 'pretty',
            }}>{traitOf(cur)}</span>
            <span
              aria-label={`体力 ${cur.hp}，身法 ${cur.speed}，力道 ${power(cur)}，攻程 ${reach(cur)}，击退 ${push(cur)}，上下段 ${mixup(cur)}`}
              style={{ display: 'grid', gap: 4, width: '100%' }}
            >
              <Stat label="体力" ratio={hpBar(cur.hp)} color={cur.palette.accent} />
              <Stat label="身法" ratio={spdBar(cur.speed)} color={cur.palette.accent} />
              <Stat label="力道" ratio={pwrBar(power(cur))} color={cur.palette.accent} />
              <Stat label="攻程" ratio={rchBar(reach(cur))} color={cur.palette.accent} />
              <Stat label="击退" ratio={pushBar(push(cur))} color={cur.palette.accent} />
              <Stat label="上下段" ratio={mixBar(mixup(cur))} color={cur.palette.accent} />
            </span>
            {/* 招式表。此前这里只报一个超必杀的名字——玩家选完人进场，
                手上有三记必杀却不知道是什么、也不知道怎么按（技能键要配方向选槽位）。
                十二个人 × 三记必杀全躺在数据里，选人页是唯一该说这件事的地方。
                键位不在这里另写一份：直接问 skillSlotFor，那是触屏那边判槽位的同一个函数 */}
            <span
              aria-label={`招式：${SKILL_ROWS.map(r => `${r.say} ${cur.moves[skillSlotFor(r.dir)].name}`).join('；')}；大招 ${cur.moves.sp100.name}`}
              style={{
                display: 'grid', gap: 3, width: '100%',
                fontFamily: SERIF, fontSize: 'clamp(9px, min(1.6vh, 1.05vw), 15px)',
                letterSpacing: 1, color: T.dim, lineHeight: 1.3,
              }}
            >
              {[...SKILL_ROWS.map(r => [r.key, cur.moves[skillSlotFor(r.dir)].name] as const),
                ['大招', cur.moves.sp100.name.replace('超必杀·', '')] as const,
              ].map(([k, v]) => (
                <span key={k} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>{k}</span>
                  <span style={{ color: cur.palette.accent, textAlign: 'right' }}>{v}</span>
                </span>
              ))}
            </span>
            {/* 「就是他」写死了男性代词，而名册里铁扇公主、白骨精是女性——十二人里两位，
                每六次选人就有一次把人叫错。不去加一个性别字段来分「他/她」：那是为了
                一颗按钮往角色数据里塞一个只有这里用得上的字段。
                「出战」两个字既没有代词，又比「就是他」更直说按下去会发生什么。 */}
            <Seal label={training ? '进陪练场' : '出战'} onClick={() => onPick(cur)} />
          </div>
        </div>
        <Ghost label="返回" onClick={onBack} />
      </div>
    </div>
  );
}

export function Result({ won, stage, last, total, stageName, bossName, nextStageName, nextBossName,
  quote, ending, clearMs, onNext, onRetry, onHome }: {
  won: boolean; stage: number; last: boolean; stageName: string; bossName: string;
  /** 一趟共几关。**别再写死**：这一行曾经是「共四关」，阶梯改六关之后它还在说四 */
  total: number;
  /** 下一关是谁、在哪儿。赢了且不是最后一关时才传——
   * 六关阶梯的对手是随机抽的，玩家在按「下一关」之前完全不知道要面对谁，
   * 而"接下来是谁"正是街机连战里最有期待感的一拍 */
  nextStageName?: string; nextBossName?: string;
  /** 对手这一战的台词：你赢了他就服软，你输了他就压你一句 */
  quote?: string;
  /** 通关最后一关时才传：所选角色的收场白 */
  ending?: string;
  /** 通关最后一关时才传：整趟用时（毫秒） */
  clearMs?: number;
  onNext: () => void; onRetry: () => void; onHome: () => void;
}) {
  const headline = won ? (last ? '功德圆满' : '胜') : '败';
  return (
    <div style={{ ...S.full, background: 'rgba(7,13,24,.74)' }}>
      <div style={{ display: 'grid', gap: 'clamp(10px, 2.6vh, 20px)', justifyItems: 'center', padding: '0 24px' }}>
        <h1 style={{
          margin: 0, fontFamily: SERIF, fontWeight: 500,
          fontSize: last && won ? 'clamp(30px, min(9vh, 6vw), 86px)' : 'clamp(42px, min(13vh, 8vw), 130px)',
          letterSpacing: last && won ? 10 : 0, lineHeight: 1,
          color: won ? T.paper : T.zhusha,
        }}>{headline}</h1>
        {/* 之前只有「第 N 关 · 胜」，输了连是谁打赢的都不说。四关连战却从没告诉玩家走到哪了 */}
        {/* 打的是哪一关、对手是谁，比"共四关"这条进度更要紧——初版把这行给了 faint、
            进度行给了更亮的 dim，层级正好反了 */}
        {/* 这三段之间用全角空格分组，不用「 · 」：十二个关名里有五个**自己就带间隔号**
            （酆都·鬼门关、昆仑·射日台、翠云山·芭蕉洞、积雷山·魔王真身、西岐·雷云崖），
            外层再用同一个符号就读成了四段并列——实测这一行显示为
            「第一关 · 酆都·鬼门关 · 钟馗」，分不清哪个点是关名的一部分。
            改完之后 · 在这一屏只有一个意思：专名内部的间隔号。下一关那一行本来就是全角空格分组。 */}
        <p style={{ margin: 0, fontSize: 'clamp(13px, min(2.6vh, 1.6vw), 22px)', letterSpacing: 3, color: T.paper }}>
          第{cn(stage)}关　{stageName}　{bossName}
        </p>
        {/* 对手的台词。四个对手打完只给一个「胜/败」的话，谁是谁完全没有分别；
            一句话就能把牛魔王和二郎神分开。引号用竖排书名号的观感，与整体排印一致 */}
        {quote && (
          <p style={{
            margin: 0, fontFamily: SERIF, fontSize: 'clamp(12px, min(2.2vh, 1.4vw), 19px)',
            letterSpacing: 2, color: won ? T.dim : T.tenghuang, maxWidth: '22em', textAlign: 'center',
          }}>「{quote}」</p>
        )}
        {/* 通关的收场白：四关打完只把标题换成「功德圆满」的话，四个角色的结局一模一样，
            闯完整条阶梯没有任何专属的回报。用时也在这里报——记录系统本来就存着，
            此前只在标题页那一行出现过 */}
        {/* 下一关是谁。六关的对手是随机抽的，不报的话玩家按「下一关」是在开盲盒；
            报了就有一拍期待——街机连战本来就是靠"下一个是谁"往前推的 */}
        {won && !last && nextBossName && (
          <p style={{
            margin: 0, fontSize: 'clamp(12px, min(2.2vh, 1.4vw), 19px)',
            letterSpacing: 3, color: T.tenghuang,
          }}>下一关　{nextStageName}　{nextBossName}</p>
        )}
        {last && won && ending && (
          <p style={{
            margin: 0, fontFamily: SERIF, fontSize: 'clamp(13px, min(2.4vh, 1.5vw), 21px)',
            letterSpacing: 2, color: T.paper, maxWidth: '26em', textAlign: 'center', lineHeight: 1.9,
          }}>{ending}</p>
        )}
        <p style={{ margin: 0, fontSize: 'clamp(11px, min(2vh, 1.3vw), 18px)', letterSpacing: 2, color: T.faint }}>
          共{cn(total - 1)}关 · {won ? `已过${cn(stage)}关` : `闯至第${cn(stage)}关`}
          {last && won && clearMs !== undefined && ` · 用时 ${fmtTime(clearMs)}`}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px, 5vw, 32px)', marginTop: 4 }}>
          {won && !last && <Seal label="下一关" onClick={onNext} />}
          {!won && <Seal label="再战" onClick={onRetry} />}
          <Ghost label="回主页" onClick={onHome} />
        </div>
      </div>
    </div>
  );
}

/** 竖屏挡板：原来是「请横屏游玩 📱↺」——用表情符号当说明，且没讲为什么。
 * 改成一个真的会转四分之一圈的手机轮廓（尊重 prefers-reduced-motion，见 index.html）＋
 * 一句给出理由的说明。 */
export function RotateOverlay() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const on = () => setPortrait(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (!portrait) return null;
  return (
    <div style={{ ...S.full, zIndex: 99, background: T.ground }}>
      <div style={{ display: 'grid', gap: 22, justifyItems: 'center', padding: '0 32px', textAlign: 'center' }}>
        <span className="sx-rotate" style={{
          width: 34, height: 56, border: `2px solid ${T.paper}`, borderRadius: 5, display: 'block',
        }} />
        <h2 style={{
          margin: 0, fontFamily: SERIF, fontWeight: 500,
          fontSize: 'clamp(19px, 3.4vh, 26px)', letterSpacing: 6,
        }}>把手机横过来</h2>
        <p style={{ margin: 0, fontSize: 13, letterSpacing: 2, color: T.faint, lineHeight: 1.7 }}>
          横屏才放得下擂台与左右手的操作区。<br />转过来就自动继续。
        </p>
        {/* 系统开了竖排方向锁的人，**物理转手机也转不过来**——这层遮罩盖住整屏（zIndex 99），
            连标题页那两颗按钮都点不到，而 goFullscreen 里的 orientation.lock 恰恰只挂在
            那两颗按钮上。结果是死锁：唯一能解锁横屏的入口，被"请你横屏"的提示自己挡住了。
            所以这里必须自带一个出口——它同时也是那次 lock 需要的用户手势。 */}
        <Seal label="仍要继续" onClick={() => { unlockAudio(); goFullscreen(); }} />
      </div>
    </div>
  );
}

export { Ghost, Seal };
