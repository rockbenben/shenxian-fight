import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  /**
   * **base 必须保持相对**（同 025-kuafu）：同一份 gh-pages 产物要在两个前缀下都成立——
   * EdgeOne 把它挂在根域，而 GitHub Pages 同时把这个分支挂在子路径
   * （rockbenben.github.io/shenxian-fight/）。写成绝对的 '/' 会让后者整站 404。
   *
   * 与之配套的是**运行时拼出来的路径也要走 `import.meta.env.BASE_URL`**
   *（parts.ts 的 chars、sfx.ts 的 sfx、renderer.ts 的 skel）：vite 只重写 index.html 里的
   * 引用，运行时拼的字符串它一概不管。而那三条一旦 404 全是**静默兜底**——
   * 立绘拿不到就整体退回骨骼火柴人、采样音效拿不到就退回合成，控制台一句错都没有。
   */
  base: './',

  test: {
    /**
     * 默认 5 秒对这个仓库太短。**这里的测试大多在跑真实对局**——
     * 132 组配对 × 若干种子，单跑三五秒，全量并行时被挤到十秒是常事。
     * 于是会出现最坏的一种失败：**单跑绿、全量红**，而且报的是超时不是断言，
     * 看上去像某个机制坏了。本会话被这样咬过两次（cornerEscape、aiTaunt），
     * 两次都先去查机制、查了半天才发现是超时。
     *
     * 真跑挂死的用例仍然会失败，只是从 5 秒变成 30 秒——那点等待远比误报便宜。
     * 个别超重的用例仍在自己那一行写更大的值（如 900_000），这里只抬默认值。
     */
    testTimeout: 30_000,
  },

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // 默认 globPatterns 不含 woff2/ogg——Task 25 加了自带宋体子集、Task 26 加了大招
        // 重击/KO 的采样音效之后，不显式加上的话这些文件进得了 dist/ 却进不了 sw.js 的
        // precache 清单，离线首次访问时就拿不到：字体会落回系统回退栈，采样音效会一直
        // 走合成兜底（构建后必须实际打开 dist/sw.js 核实，不能只看文件在不在 dist/ 里）
        // png/json 是后补的：角色立绘（chars/<id>/head|torso.png，最早四人各两张）与
        // 骨骼动画（skel/<id>.json）都是**运行时才 fetch** 的可选增强，不在这张清单里
        // 就进不了 precache——标题页写着「离线可玩」，而离线时那四个人会悄悄退回
        // 没有立绘的程序化画法（正是刚补完五官的那条兜底）。
        // 这类东西坏得很安静：在线一切正常，只有断网才看得出来。
        globPatterns: ['**/*.{js,css,html,ico,woff2,ogg,png,json}'],
        // 上面那张清单是**按后缀**扫的，于是会把三样运行时根本不读的东西也塞进离线包：
        //   · edgeone.json —— 给 CDN 看的控制面文件，还必须**不能**被 SW 缓存
        //   · og.png（286KB）—— 只有抓取方会隔着网络取一次，玩家永远不会请求它
        //   · fonts/subset-chars.json —— 子集脚本与 font-coverage 测试的产物，构建期用
        // 合计约 297KB，占的是手机游戏的离线预算。按后缀扫看不出这三样的区别，只能点名排除。
        globIgnores: ['edgeone.json', 'og.png', 'fonts/subset-chars.json'],
      },
      manifest: {
        name: '神仙打架', short_name: '神仙打架',
        description: '东方神话街机格斗',
        display: 'fullscreen', orientation: 'landscape',
        // 取 palette.ts 的夜色，与 index.html 的 theme-color 一致
        background_color: '#0E141C', theme_color: '#0E141C',
        lang: 'zh-CN', dir: 'ltr',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // maskable：安卓会按自适应图标裁一刀，非 maskable 的方章会被切掉四角。
          // 印面本来就内缩一圈细边，安全区裕量够。
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
