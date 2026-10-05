// Task 28：手机端全屏。地址栏 + 底部导航栏吃掉近 1/5 的屏，横持时那一截正是打斗的舞台。
//
// 做法照抄同系列 025-kuafu 的 goFullscreen()——那个项目已经踩过这坑，注释里记了原因，这里
// 复述以免走样：
//
// - 必须在**用户手势的同步调用栈里**发起，不能等一次 await——手势授权只在同步调用栈内有效，
//   一旦跨了微任务边界再调 requestFullscreen 会被浏览器直接拒。所以这个函数从头到尾没有
//   await：内部的 .then()/.catch() 只是挂后续动作，不阻塞调用方的同步返回。
// - 全屏 document.documentElement 而不是 canvas：TouchLayer（虚拟摇杆 + 六个操作按钮）是
//   canvas 的**兄弟节点**、不在 canvas 内部（见 App.tsx 的 Fight），只全屏 canvas 会把全部
//   触控键一起挡在屏外，人还在，摸不到。
// - 全屏落定后才锁横屏：screen.orientation.lock 只在全屏态下被浏览器允许，必须等
//   requestFullscreen 的 promise resolve 之后再调用。这是「请横屏游玩」提示的正解——系统
//   开了竖排方向锁的用户，物理转手机也转不过来，此前只能一直盯着 RotateOverlay 干瞪眼。
// - lock 在 TS 的 lib.dom 里没收录（Safari 不实现，故未纳入标准），就地窄化类型，不为一个
//   API 单开一份 .d.ts。
// - iPhone Safari 不实现元素全屏（只有 <video> 有非标准的 webkitEnterFullscreen），那里
//   requestFullscreen 调用即报错、静默退回非全屏，属**预期行为**，不为它写兜底 hack——
//   iOS 的全屏路径是「添加到主屏幕」，PWA manifest 已经是 display: 'fullscreen'。
/** 指针是"手指"还是"鼠标"。竖屏挡板拿它决定失败时该说什么话 */
export const isCoarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** 现在真的是横屏了吗。锁没锁成不能只看 promise 有没有 resolve——
 * iOS 的 orientation.lock 根本不存在（可选调用直接跳过），Safari 也不实现元素全屏 */
const isLandscape = () => (screen.orientation?.type ?? '').startsWith('landscape');

/** 挂在标题页「开始闯关」/「陪练场」按钮的 onClick 里，与 unlockAudio() 同处一个同步调用栈。
 * 桌面端（isCoarsePointer=false）直接跳过，不打扰鼠标+键盘玩家。已在全屏内则空转。
 *
 * 返回"这一按之后是不是真的横过来了"。此前它什么都不回，两个 catch 把失败咽得干干净净——
 * 于是竖屏挡板上那颗「仍要继续」按下去毫无反应（系统开了方向锁的人、iOS 上的 Safari），
 * 而同一屏上那句「转过来就自动继续」此刻正是假的。调用方要用这个结果说一句可操作的话。 */
export function goFullscreen(): Promise<boolean> {
  if (!isCoarsePointer) return Promise.resolve(false);
  const entered = document.fullscreenElement
    ? Promise.resolve()
    : (document.documentElement.requestFullscreen?.() ?? Promise.reject());
  return Promise.resolve(entered)
    .then(() => {
      const so = screen.orientation as ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };
      return so.lock?.('landscape') ?? Promise.resolve();
    })
    .catch(() => {})
    .then(() => isLandscape());
}
