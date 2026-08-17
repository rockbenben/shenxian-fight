import { expect, test } from 'vitest';
import screensSrc from '../src/ui/screens.tsx?raw';
import appSrc from '../src/App.tsx?raw';
import fsSrc from '../src/ui/fullscreen.ts?raw';

/**
 * 竖屏遮罩。它盖住整屏（zIndex 99），而**唯一能强制横屏的入口**——
 * goFullscreen 里的 `screen.orientation.lock('landscape')`——此前只挂在标题页那两颗按钮上。
 *
 * 于是对**系统开了竖排方向锁**的人（手机上很常见）形成死锁：
 * 物理转手机转不过来 → 遮罩不消失 → 点不到标题页的按钮 → 那把锁永远调不到。
 * 「请你横屏」这句提示，自己挡住了唯一能横屏的路。
 *
 * 所以遮罩必须自带一个出口，而那一下点击同时也是 orientation.lock 需要的用户手势
 *（手势授权只在同步调用栈内有效，见 fullscreen.ts 的注释）。
 */

test('竖屏遮罩里有一个出口，不是只有一句"请横屏"', () => {
  // 这一条只能扫源码：组件靠 useState/useEffect + matchMedia 判竖屏，
  // 项目没装 jsdom，直接调它会触发 Invalid hook call；而竖屏那一支在测试环境永远走不到。
  // 锚点取得足够具体（按钮文案 + 紧跟其后的 goFullscreen 调用），不会误命中别处。
  expect(screensSrc.includes('仍要继续'), '竖屏遮罩没有任何出口——方向锁用户会被永久挡在外面')
    .toBe(true);
  expect(/仍要继续[\s\S]{0,80}goFullscreen\(\)/.test(screensSrc),
    '出口按钮没有调用 goFullscreen——那是唯一能强制横屏的入口').toBe(true);
});

test('强制横屏这件事只有一处实现，出口用的就是它', () => {
  // 若有人在遮罩里另写一份 orientation.lock，手势/全屏的次序约束会被复制走样
  //（必须全屏落定之后才允许 lock，见 fullscreen.ts）
  expect(/orientation as ScreenOrientation/.test(fsSrc), 'fullscreen.ts 不再负责锁横屏').toBe(true);
  expect(screensSrc.includes('screen.orientation'), 'screens.tsx 里又内联了一份锁横屏').toBe(false);
});

test('遮罩仍然盖住整屏——它不是提示条，是拦截层', () => {
  // 出口是给"转不过来"的人留的，不是把遮罩变成可无视的提示：
  // 正常能转的人应该照旧被拦住，直到真的横过来
  expect(appSrc.includes('<RotateOverlay />'), 'App 不再渲染竖屏遮罩').toBe(true);
  expect(/zIndex: 99/.test(screensSrc), '遮罩不再盖住整屏').toBe(true);
});
