import { useMemo, useRef, useState, useEffect } from 'react';
import { Battle, KO_OUTRO, ROUND_TIME, carryOverMeter } from './engine/battle';
import { aiSeed, createAi } from './engine/ai';
import { CHARACTERS } from './data/characters';
import { introQuote, loseQuote } from './data/quotes';
import { applyDifficulty, buildRun, DEFAULT_DIFFICULTY, DIFFICULTIES, HARDEST_DIFF, RUN_AI, RUN_DMG_SCALE, RUN_HP_SCALE } from './data/stages';
import type { Stage } from './data/stages';
import { GameCanvas } from './ui/GameCanvas';
import { loadSkeleton, preloadParts } from './render/renderer';
import { TouchLayer } from './ui/TouchLayer';
import { createHeld, keyboardBind, toInputFrame } from './ui/input';
import { mirrorLook } from './render/palette';
import { startBgm, startMenuBgm, stopBgm } from './render/bgm';
import { dummyFrame, Help, MuteButton, Result, RotateOverlay, ROUND_NAMES, roundOutcome, ROUNDS_TO_WIN, RoundScore, Select, Title, TrainingBar, type DummyMode } from './ui/screens';
import { MenuBackdrop } from './ui/MenuBackdrop';
import { featOf, merge, readRecord, summary, writeRecord } from './ui/records';
import { traitOf } from './data/traits';
import type { CharacterDef, InputFrame, Dir } from './engine/types';

type Scene = { s: 'title' } | { s: 'help' } | { s: 'select'; training?: boolean }
  // 陪练场也要能挑人：四个角色打法差得远，写死哪吒打哪吒等于没法练自己那一位
  | { s: 'fight'; me: CharacterDef; stage: number; training?: boolean }
  | { s: 'result'; won: boolean; me: CharacterDef; stage: number };

export function App() {
  // 闯关记录与本趟开始时刻。开始时刻用墙钟：它量的是"玩家花了多久"，不是游戏内的帧数
  const [rec, setRec] = useState(readRecord);
  /** 选人页选中第几个。放在这里而不是 Select 里：那一页的断言把组件当纯函数调用，
   * 组件内有 hook 就调用不了 */
  const [pick, setPick] = useState(0);
  /** 难度档。整趟固定：中途换档会让"闯到第几关"这条记录失去意义 */
  const [diff, setDiff] = useState(() => readRecord().diff ?? DEFAULT_DIFFICULTY);
  /** 改档立刻写回存档：选了轻松的人不该每次刷新都被丢回标准档 */
  const chooseDiff = (i: number) => {
    setDiff(i);
    const next = { ...rec, diff: i };
    setRec(next); writeRecord(next);
  };
  const runStart = useRef(0);
  /** 这一趟的对手编排。种子在**点下角色的那一刻**定，整趟不再变——
   * 刷新页面、重打同一关都必须是同一批对手（buildRun 是纯函数，种子一样结果就一样）。
   * 放 state 而不是 ref：它要参与渲染（关卡名、对手名都从这里取）。 */
  const [run, setRun] = useState(() => buildRun('', 1, CHARACTERS));
  const [scene, setScene] = useState<Scene>(
    location.hash === '#training' ? { s: 'select', training: true } : { s: 'title' },
  );
  /** 进入对局的次数，AI 种子的第二个输入（见 aiSeed）。三个入口——开打、下一关、
   * 重打——必须都从这里走：漏掉哪一个，那条路进去的对局就退回"每次都一样的开局"，
   * 而这种漏法不会报任何错。所以不在三处各写一遍 setScene，收成这一个口子。 */
  const attempt = useRef(0);
  const goFight = (me: CharacterDef, stage: number, training?: boolean) => {
    attempt.current++;
    setScene({ s: 'fight', me, stage, training });
  };
  // 菜单音乐：标题／选人／帮助此前是全静音的，而选人页正是玩家待得最久的地方之一
  //（十二个人要翻一遍）。进战斗时由 Fight 自己的 startBgm 接管，这里只管菜单那三屏。
  // 战斗之外的每一屏都该有声音。结算页尤其：它紧接在 KO 演出之后出现，
  // 而 Fight 一卸载就 stopBgm——刚才还在打，翻页就是死寂，那一下比一直没有音乐更突兀。
  // 一趟六关要看六次结算页，它不是过场是常驻画面。
  const inMenu = scene.s !== 'fight';
  useEffect(() => {
    if (!inMenu) return;
    startMenuBgm();
    return stopBgm;
  }, [inMenu]);
  // 冷加载之外，hash 改成 #training 也要能进训练场——之前只在 useState 初始化时读一次。
  // 直接 setScene 换场景（而非 location.reload()）：Fight 卸载走的是既有的 useEffect 清理路径
  // （keyboardBind 的 cleanup 解绑监听，TouchLayer 卸载时清空它持有的 Held 标志），不会在切换
  // 时把按键状态卡在 true 上，也不用付一次整页重载的代价
  useEffect(() => {
    const onHashChange = () => {
      if (location.hash === '#training') setScene({ s: 'select', training: true });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return (
    <>
      <RotateOverlay />
      {/* 菜单四页（标题/操作/选人/结算）共用的动态夜景。只在非对局场景挂载：对局时已经有 GameCanvas 那块
          画布，再压一块只会白烧一份 60fps 的绘制 */}
      {scene.s !== 'fight' && <MenuBackdrop />}
      {scene.s === 'title' && <Title onStart={() => setScene({ s: 'select' })} onTraining={() => setScene({ s: 'select', training: true })} onHelp={() => setScene({ s: 'help' })} record={summary(rec, run.length - 1, CHARACTERS.length, diff, DIFFICULTIES[diff]?.name ?? '')}
        diff={diff} onDiff={chooseDiff} />}
      {scene.s === 'help' && <Help onBack={() => setScene({ s: 'title' })} />}
      {scene.s === 'select' && (
        <Select
          training={scene.training}
          cleared={featOf(rec, diff).cleared}
          pick={pick}
          onFocus={setPick}
          onPick={me => {
            runStart.current = Date.now();
            // 每按一次「就是他」都重新编一趟：这是"再来一趟"真正不一样的地方
            if (!scene.training) setRun(buildRun(me.id, (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0, CHARACTERS));
            goFight(me, 0, scene.training);
          }}
          onBack={() => setScene({ s: 'title' })}
        />
      )}
      {scene.s === 'fight' && (
        <Fight
          key={`${scene.me.id}-${scene.stage}-${scene.training}`}
          attempt={attempt.current}
          scene={scene}
          run={run}
          diff={diff}
          onEnd={won => {
            if (!scene.training) {
              const next = merge(rec, scene.stage, won, Date.now() - runStart.current, run.length - 1, scene.me.id, diff);
              setRec(next);
              writeRecord(next);
            }
            setScene({ s: 'result', won, me: scene.me, stage: scene.stage });
          }}
          onExit={() => setScene({ s: 'title' })}
        />
      )}
      {scene.s === 'result' && (
        <Result
          won={scene.won} stage={scene.stage} last={scene.stage === run.length - 1}
          total={run.length}
          nextStageName={run[scene.stage + 1]?.name}
          nextBossName={CHARACTERS.find(c => c.id === run[scene.stage + 1]?.bossId)?.name}
          stageName={run[scene.stage].name}
          bossName={CHARACTERS.find(c => c.id === run[scene.stage].bossId)!.name}
          // 赢了放**对手的 lose**（他服软），输了放**自己的 lose**（你认栽）。
          // 输的时候原来放的是对手的 win——可胜利姿势已经让对手把那一句说过一遍了
          //（见 GameCanvas 里 showWinQuote 的触发），结算页再显示同一行就是重复。
          // 换成自己的 lose 之后两边各说一句，赢/输两条路都是"对手一句 + 自己一句"。
          // 败北台词也按对手取（同胜利台词的 vs）：胜者那句在摆造型时说、
          // 败者这句在结算页说，两句凑起来才是一段对话。缺了就回落到通用那句。
          quote={scene.won
            ? loseQuote(CHARACTERS.find(c => c.id === run[scene.stage].bossId)!, scene.me.id)
            : loseQuote(scene.me, run[scene.stage].bossId)}
          // 只有真通关（赢下最后一关）才给收场白与用时；Result 内部也再判一次 last && won
          // 修罗档给真结局：三档的六关连过率是 19.8% / 0.8% / 0.0%，
          // 而此前最难那档通了也和标准档看到同一段字——那条曲线不给任何额外回报
          ending={diff === HARDEST_DIFF ? (scene.me.endingHard ?? scene.me.ending) : scene.me.ending}
          clearMs={Date.now() - runStart.current}
          onNext={() => goFight(scene.me, scene.stage + 1)}
          onRetry={() => goFight(scene.me, scene.stage)}
          onHome={() => setScene({ s: 'title' })}
        />
      )}
    </>
  );
}

// KO 结算延迟：盖住「击杀那一帧 → 演出（hold + 暗场淡出）彻底放完」这段区间。
// 从数据推导而不是手填常数——大招帧数一改（Task 39 把哪吒 sp100 从 64 拉到 160），
// 手填的 80 就会让结算画面在屏幕还全黑、镜头还锁着的时候弹出来，而且不会有任何测试报错。
// 推导：freeze 那 30 帧发生在角色掉血之前（battle.tick 整帧跳过，stateFrame 不推进），
// 而 checkHit 要求 stateFrame >= startup 才可能命中，所以命中最早发生在 stateFrame==startup。
// 此刻 cine.hold（= 招式总帧数）还剩 active+recovery；随后 100 级暗场从 1 按每帧 0.06
// 衰减到 0 要 17 帧。取全角色最大值再留 20 帧余量（含 cine.slow 把这段拉成慢镜的富余）。
const DARK_FADE_FRAMES = Math.ceil(1 / 0.06);
const KO_SETTLE_DELAY = Math.max(
  // KO 现在在终结一击落地那一刻就宣布（不再等出招者收完势），所以这里只需要盖住
  // 「宣布之后还要播多久」：出招者的收势 + 落幕帧（被击飞者走完弧线、砸地、塌下去）
  // + 暗场淡出。此前是按整个 active+recovery 算的，那是宣布时机改之前的账，现在会让
  // 结算画面对着一个早已演完的静止场面干等约 8 秒。
  ...CHARACTERS.flatMap(c => [c.moves.sp100, c.moves.sp50].map(m => m.recovery)),
) + KO_OUTRO + DARK_FADE_FRAMES + 20;


/** 三局两胜。街机格斗都这么打，理由不是拉长时间，是**一次失误不该直接断关**：
 * 输了第一回合还有调整的机会，第三回合的残血翻盘也是这类游戏最好看的部分。
 * 单回合胜率 p 换算到整关是 p²(3-2p)：实测的 79/46/42/29 变成 89/44/38/20，
 * 首关更宽松、末关更紧，仍是单调下坡。 */

function Fight({ scene, run, diff, attempt, onEnd, onExit }: {
  scene: Extract<Scene, { s: 'fight' }>; run: Stage[]; diff: number; attempt: number;
  onEnd: (won: boolean) => void; onExit: () => void;
}) {
  // 难度档套在关卡上：改的是 BOSS 的反应率（AI）与血量/伤害（下面两处 scale）
  const d = DIFFICULTIES[diff] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
  const stage = applyDifficulty(run[scene.stage], d);
  const [round, setRound] = useState(0);
  /** 上一回合结束时双方剩下的气。放 ref 不放 state：它只在建下一场时读一次，
   * 用 state 会多一次重渲染，还得小心和 round 的更新次序 */
  const carried = useRef<[number, number]>([0, 0]);
  const [wins, setWins] = useState<[number, number]>([0, 0]);
  // 陪练场的对手可以换。正式对局里对手是关卡定死的，这个 state 不会动
  const [foeId, setFoeId] = useState(stage.bossId);
  const battle = useMemo(() => {
    const boss = structuredClone(CHARACTERS.find(c => c.id === (scene.training ? foeId : stage.bossId))!);
    boss.hp = Math.round(boss.hp * RUN_HP_SCALE[scene.stage] * d.hp);
    // 镜像战换色：选牛魔王时末关正是他本人（buildRun 只滤掉玩家与 BOSS 其中之一，
    // 而末关固定是 FINAL_BOSS），陪练场也能选到同一个人。两边配色一模一样时，
    // 紧急回避一穿过去就分不清谁是谁了——转色相，形还是那个形，颜色不再撞
    if (boss.id === scene.me.id) mirrorLook(boss);   // 整套外观一起换，不只是身体配色
    for (const m of Object.values(boss.moves)) m.damage = Math.round(m.damage * RUN_DMG_SCALE[scene.stage] * d.dmg);
    const b = new Battle(structuredClone(scene.me), boss);
    // 气槽跨回合保留（同 KOF97）。血量与位置仍然复位——保留的只有气。
    // 不保留的话一局峰值平均才 79，超必杀几乎见不到（见 carryOverMeter 的注释）
    b.p1.meter = carryOverMeter(carried.current[0]);
    b.p2.meter = carryOverMeter(carried.current[1]);
    // 截图/调参用：DEV 下把当前对局挂到 window，浏览器里能直接改血量、把回合推到结算页
    //（结算页是每趟要看六次的常驻画面，靠真打过去截一次要几分钟）。生产构建里整句裁掉，
    // 同 renderer.ts 里那层判定帧叠加。每回合重建 battle，所以挂在这里而不是挂一次
    if (import.meta.env.DEV) (window as unknown as { __battle?: Battle }).__battle = b;
    return b;
  }, [round, foeId]);   // 每个回合（或陪练场换对手）重建一场——血量与位置复位，气槽带过去
  const held = useMemo(createHeld, []);
  const prevHeld = useMemo(createHeld, []);
  const ai = useMemo(() => createAi(stage.ai, aiSeed(scene.stage, attempt)), []);
  // 对打挡用中手档，不用 stage.ai——陪练场的关卡索引恒为 0，那是最弱的 lv1（几乎不出招），
  // 拿它练反击命中和抓空挥根本练不出东西
  const sparAi = useMemo(() => createAi(RUN_AI[1], 31), []);
  // 陪练场的木桩行为。放在 ref 里而不是 state：getP2 每逻辑帧都要读，
  // 用 state 会让每次切挡都重建 GameCanvas 的回调
  const [dummy, setDummy] = useState<DummyMode>('idle');
  const dummyRef = useRef<DummyMode>('idle');
  dummyRef.current = dummy;
  const dummyInput = (): InputFrame => dummyFrame(dummyRef.current, {
    self: battle.p2,
    toward: (battle.p1.x >= battle.p2.x ? 1 : -1) as Dir,
    gap: Math.abs(battle.p1.x - battle.p2.x),
  }) ?? sparAi(battle, 1);
  const endTimer = useRef(-1);
  useEffect(() => keyboardBind(held), [held]);
  // 战斗背景乐：进关开、离开关。陪练场也开——那里待的时间往往比正式对局还长
  // 曲子跟**对手的主场**走（每个人的主场就是一关），速度跟**关卡进度**走。
  // 陪练场没有关卡序号，但一样有对手，所以这里取 p2 而不是 run[scene.stage]
  useEffect(() => { startBgm(battle.p2.def.id, scene.stage); return stopBgm; },
    [battle.p2.def.id, scene.stage]);
  // 美术部件是可选增强：探测请求 fire-and-forget，没有 public/chars/ 时静默回退到骨骼胶囊
  useEffect(() => { preloadParts(battle.p1.def.id); preloadParts(battle.p2.def.id); }, [battle]);
  // 外部骨骼动画同样是可选增强：探测 public/skel/<id>.json，没有就一直走程序化动作
  useEffect(() => { loadSkeleton(battle.p1.def.id); loadSkeleton(battle.p2.def.id); }, [battle]);
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <GameCanvas
        battle={battle}
        getP1={() => toInputFrame(held, prevHeld)}
        getP2={() => (scene.training ? dummyInput() : ai(battle, 1))}
        stage={stage.bg}
        key={round}
        stageName={scene.training ? undefined : (round === 0 ? stage.name : ROUND_NAMES[round])}
        // 只在第一回合的开场横幅上标「最终关」：第二三回合那一行写的是「第二回合／最终回合」，
        // 再压一个「最终关」上去就是两个「最终」叠着，读起来别扭
        finalStage={!scene.training && round === 0 && scene.stage === run.length - 1}
        opponentName={scene.training ? undefined : battle.p2.def.name}
        opponentTrait={scene.training ? undefined : traitOf(battle.p2.def)}
        // 开场那一句**只在第一回合说**。GameCanvas 挂在 key={round} 上、每回合整体重挂载，
        // 不加这个闸的话三局两胜里同一句话要说两三遍——开场白说第二遍就不是开场白了。
        // 同 finalStage 那一行的分寸（那里也是只认 round === 0）。
        opponentIntro={scene.training || round !== 0 ? undefined : introQuote(battle.p2.def, scene.me.id)}
        onTick={b => {
          if (scene.training) {
            b.p2.hp = b.p2.def.hp;
            // 玩家这一侧也回满血、气常满。原来只回木桩：练五分钟连段之后人就永远卡在
            // 残血（血条一直红着、每一下看着都该死却死不了），而练一次大招要重攒 50-100 气，
            // 攒的时间比练的时间还长。陪练场是用来练招的，不是用来存活的。
            b.p1.hp = b.p1.def.hp;
            b.p1.meter = 100;
            b.winner = null;
            b.doubleKo = false;
            b.timeLeft = ROUND_TIME;   // 陪练场不读秒
            b.timeUp = false;
            b.events = b.events.filter(ev => ev.type !== 'ko'); // 陪练场打空木桩血条不触发 KO 演出
            return;
          }
          // 读秒平局时 winner 仍是 null，只有 timeUp 为真——不看它的话这个回合永远不结束
          if ((b.winner !== null || b.timeUp || b.doubleKo) && endTimer.current === -1) endTimer.current = KO_SETTLE_DELAY; // KO 慢镜看完再结算
          if (endTimer.current > 0 && --endTimer.current === 0) {
            // 一个回合结束：记分。谁先拿满 ROUNDS_TO_WIN 才算这一关分出胜负
            carried.current = [b.p1.meter, b.p2.meter];   // 结算前记下，下一回合带过去
            const r = roundOutcome(wins, b.winner, ROUNDS_TO_WIN);
            if (r.done) { onEnd(r.playerWon); return; }
            setWins(r.wins);
            setRound(n => n + 1);   // battle 与 GameCanvas 都挂在 round 上，会整体复位
            endTimer.current = -1;
          }
        }}
      />
      <TouchLayer held={held} battle={battle} training={scene.training} />
      {scene.training
        ? <TrainingBar mode={dummy} onPick={setDummy} foeId={foeId} onFoe={setFoeId} onExit={onExit} />
        : <RoundScore wins={wins} need={ROUNDS_TO_WIN} battle={battle} />}
      {/* TouchLayer 的兄弟节点，不是它的子元素：外层 div 的 onPointerDown 只在这层 DOM
          子树内才会因事件冒泡而触发取摇杆逻辑，兄弟节点上的点击天然到不了那里，不需要
          stopPropagation。
          位置从「右上 top=168」改到「顶部居中」：原方案只躲开了 HUD（往下压到血条下方），
          没算右下角按键簇是从底边往上长的——大招键 bottom 120 + size 88，上沿在
          viewport_h-208；viewport 只要矮于约 410px，它就和 top=168 的这颗按钮撞在一起。
          844×390 的实测截图里两者确实叠住了，320 高的机型上叠得更狠。两边都要躲、又分别
          从顶边和底边量起，任何一个固定值都救不了。
          顶部居中是 HUD 唯一留着的空档（血条+气槽从两侧向中间伸），实测 568x320 上是
          x=250~318（68px），这颗 40px 的键放得下。训练场与闯关都摆在正中——退出键已经并进
          TrainingBar，不再有第二个固定元素来分这条空档。 */}
      <MuteButton
        top={10}
        style={{ zIndex: 20, right: 'auto', left: '50%', transform: 'translateX(-50%)' }}
      />
      {/* 「退出训练场」以前是这里的一颗独立固定元素，摆在顶部中线左侧的"空档"里——
          而那个空档是估出来的、估错了。左侧 HUD 的右沿（血条+气槽，取画布像素实测）
          在 568x320 是 x=250、667x375 是 294、844x390 是 306、932x430 是 337，而中线减 6px
          分别是 278/327/416/460：左半边真正空着的只有 **28 / 33 / 110 / 123px**。
          一颗写着五个字的键最窄也要 75px，前两档整个压在玩家血条上，缩字号治不了。
          （空档比预想的小，是因为 drawBars 的 margin 按**最长的那个名字**留白，
            四个字的「铁扇公主」把两侧血条一起往中间推。）
          现在它并进 TrainingBar 最后一行，跟挡位说明并排——那块控件带本来就占着这片地方，
          交给同一个盒子排版，就不会再有两个固定元素抢同一块空地。 */}
    </div>
  );
}
