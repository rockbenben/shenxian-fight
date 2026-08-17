# 角色部件出图规格（已补齐，留作规格与复跑依据）

**当前状态：12 个角色全部有 `head.png`（128×128）+ `torso.png`（160×224）**
（刑天无头，只有 torso——「以乳为目，以脐为口」是他的本体，不是缺件）。
本文件从"缺件清单"转为**规格文件**：要复跑、要加角色、要排查画风漂移时照这里。

历史：起初只有 erlang / nezha / niumo / wukong 四个目录有图，另外八个整条走
程序化兜底（圆头 + 胶囊四肢），画面上是两类东西——四个画出来的、八个火柴人。
玩家原话：「新增神话人物的头像不该用默认」。

补 head/torso **不需要改代码**：`parts.ts` 是逐件挂载的，哪个字段有图就用哪张，
缺的字段各自独立回退。把文件放进 `public/chars/<id>/head.png` 就自动接上。

## 硬性规格（照着现有四个来，别改）

- `head.png` **128×128**，透明底 PNG；脸朝**右**（引擎按 facing 镜像）
- `torso.png` **160×224**，透明底 PNG；正身、不带头、不带四肢
- 风格：**厚描边扁平上色**（深色勾边 + 少量块面阴影），不是写实、不是像素画
- 每张图只画**一件**：head 只有头颈，torso 只有躯干（含衣甲），四肢与兵器由程序化那层画
- 配色跟着角色数据里的 `palette.main` / `palette.accent` 走，别自定
- 生成后跑 `node scripts/subset-font.mjs` 不需要；但要跑一次 `npm run verify`
  （`parts.test.ts` 里有一条真的读 `public/chars/` 的断言：目录名必须全小写、文件必须是
  `head.png`/`torso.png`，多出一件不在探测列表里的会报红——否则那张图放进去也不会被加载）

## 八个角色的画面要点

每一行的"标志"必须画进去——那是玩家认出他的唯一凭据（程序化那层的 `crown` 就是它的替身）。

| id | 名字 | 标志（务必画） | 配色基调 |
| --- | --- | --- | --- |
| `honghaier` | 红孩儿 | 童子面、头顶三簇火焰、赤红肚兜 | 朱红 / 橙金 |
| `tieshan` | 铁扇公主 | 高髻 + 一根玉簪、披帛、端庄妇人面 | 青碧 / 素白 |
| `baigu` | 白骨精 | 惨白骨相、眼窝深陷、素白骨甲 | 骨白 / 灰青 |
| `houyi` | 后羿 | 抹额、猎人短打、结实臂膀 | 赭褐 / 琥珀 |
| `leizhen` | 雷震子 | 青面尖喙、背后一对羽翅、雷纹 | 雷青 / 月白 |
| `zhongkui` | 钟馗 | 虬髯、幞头官帽、朱袍 | 绛紫 / 朱砂 |
| `xingtian` | 刑天 | **无头**：脖颈以上空无一物，胸口一对眼、腹上一张口 | 赤褐 / 古铜 |
| `bajie` | 猪八戒 | 猪首、大耳、憨相、僧袍 | 土褐 / 米黄 |

**刑天特别注意**：他的 `head.png` **不要生成**（`headless: true`，渲染层压根不画头）；
只出 `torso.png`，并且把那对眼睛和那张嘴画在躯干上。

## 生成流程

用 `ai-image-gen` skill（本机默认走单一 Gemini 网页渠道，质量优先）。
prompt 只写场景内容，风格前缀由脚本统一加；**人物面孔要显式写明族裔（中国／东亚）**，
不写默认西方脸。出一张记一张，断点续跑；出图与后处理解耦（先存 `_raw/` 再缩放）。

---

## 生成进度（出一张记一张，断点续跑）

基建已跑通，记下来省得下次重配：

- Chrome 副本必须**由用户在自己终端启动**（工具调用起的会被进程 job 回收）：
  `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir=D:\chrome-cdp-profile --remote-debugging-port=9222 --remote-allow-origins=* --no-first-run --no-default-browser-check`
- 判活**两步**：`/json/version` 有版本号 **且** `PUT /json/new?about:blank` 真能建出 tab（缺 `--remote-allow-origins=*` 时前者过、后者被拦，脚本全报 no-tab）
- 代理：3456 端口默认被 **web-access 那份**占着（`/health` 无 `endpoints[]`、无 `/enter`，对 Gemini 提交恒 no-op）。
  必须杀掉它，起 `~/.claude/skills/ai-image-gen/scripts/cdp-proxy.mjs`，`/health` 里要看得到 `POST /enter`
- 副本 profile 是干净的，需要在那个窗口里**登录一次 Google**
- `/eval` 的 body：`{"target":"<id>","expression":"..."}`，**字段是 `id` 不是 `targetId`**（`PUT /new` 返回里叫 `id`）；
  body 用文件传（`--data-binary @f.json`），命令行内联长 JSON 会被截断
- 提交：`/eval` 里用 `document.execCommand('insertText',...)` 填 `.ql-editor`，再 `POST /enter {selector:".ql-editor"}`

**十五件已全部落盘**（`public/chars/` 下现有 23 张部件图，覆盖十二个角色）。
中间产物留在本机的 `_raw/`——那个目录在 `.gitignore` 里，不进版本库；
要从整页截图重切用 `scripts/recut.py`，要把标签页上现成的图捡回来用 `scripts/rescue.py`。

提示词模板（红孩儿那条，照着换标志与配色即可）：
> Flat vector illustration, thick dark outline, cel shaded, Chinese mythology character portrait.
> Head and neck only of <角色>, East Asian face, <标志>, <配色> palette.
> Three-quarter view facing right. Plain flat solid magenta #FF00FF background.
> No text, no watermark, no body, no shoulders.

**风格风险已排除**：Gemini 侧栏留着 Nezha/Wukong/Niumo 的 torso 生成对话——现有四个角色的素材当初就是走同一条管线做的，不是引入第三种画风。

### torso 的「不带头、不带四肢」两条都被违反过，而且不会有任何报错

上面那条硬性规格里最容易被忽略的就是这两句，实测十二件里：

- **两件带着头**（`bajie`、`baigu`）。渲染层把躯干图**拉满肩→髋那根骨**（`drawBoneImg`），
  所以图里最上面那点会被对到肩关节上。图里画了头，头就顶在肩上、露在真正那颗头下面——
  屏幕上是"猪八戒的身子上还有个人头"。**同时**它把画出来的肩线往下推了整整一个头的高度，
  于是程序化画的胳膊从胸口中间冒出来，与衣服的肩袖对不上。**一个原因，两个症状。**
  已就地把头切掉重新铺满（`bajie` 切顶部 31%、`baigu` 切 24%，切完长宽比 0.77 / 0.69，
  仍在 0.45~0.78 带内）。在游戏里躯干只画到约 57px 宽，而素材有 160px，
  切完再放大回 224 这一步在屏幕上看不出来。
- **五件画了袖子**（`baigu`、`bajie`、`zhongkui`、`tieshan`、`leizhen`）。袖子就是四肢：
  素材里的袖子是**固定垂着**的，而胳膊是程序化的、跟着动作摆——两者只有在立正时才对得上，
  一出招就分家。切不掉（袖子和衣身连在一起），**已全部重出为无袖版**。

#### 重出这五件时踩的三个坑（都不在提示词本身）

1. **别写"袖孔是空的、能看见背景"**——模型会照字面在胸口和肩上**挖出真的品红窟窿**，
   透过去就是背景，切头也救不回来（leizhen/zhongkui 各废一张）。
   要正面描述：「衣服轮廓在肩线处自然结束……**不要在衣服上开洞**」。
   而同一版提示词下 bajie 却完全正常——说明挖洞是概率性副作用，不是必然。
2. **"No head" 大约只有一半命中率。** 九件重出里 zhongkui 两次都画了头，bajie/tieshan/
   baigu/leizhen 没画。别指望提示词解决，**带头就手工切颈线**：把候选切线按内容高的
   16~32% 画几条出来肉眼挑（切高了进脸、切低了进肩），bajie 31%、baigu 24%、zhongkui 21%。
3. **脚本产出会把 Gemini 的输入框烤进素材**（底部约 46px 的"问问 Gemini / Flash / 麦克风"），
   一轮四张全中。**根因已修在 `gen-parts.py` 里**：它原来按 `<img>` 的
   `getBoundingClientRect()` 裁，而生成图常常比视口还高——`scrollIntoView` 居中之后
   `rect.y` 是负数、`rect.y+rect.h` 超出视口底，可截图只有视口那么大，于是下边界一路越界
   把页面 UI 圈了进来。改成**按截图里品红的实际范围裁**（品红是我们自己在提示词里要的背景，
   它的范围才是面板的真实范围）：实测面板 y 0..1170、截图高 1332，下方 162px 自然被排除。

   两个判据上的坑一并记下：
   - 找面板**不能**用"每行品红数 > 最大值的某比例"——主体占满画面的那些行品红本来就少，
     会被当成不是面板。那么写实测长宽比算出 1.106，整张裁飞。改用"每行品红数 ≥ 8"，
     那个 8 只是用来甩掉侧栏里零星品红单点的（选中态的对话条目就有）。
   - 抠图判据 `gen-parts.py` 一直是 `r>170 and b>170`，而 `recut.py` 早就改宽了并写明
     严判据漏掉偏暗的那种（"猪八戒那张整个粉底都留着"）。**同一条规则两份、修了一份**——
     已统一成一份 `is_magenta`。

   万一模型没上品红底，脚本退回按 rect 裁，但会把坐标**钳进截图范围内**，不再越界。

**验收**：五张逐一确认无头无袖、长宽比落在 0.45~0.78（0.58/0.52/0.63/0.69/0.66），
再进游戏实拍五个角色——程序化的胳膊成了唯一的胳膊，不再有画死的袖子跟它抢位置。

**查法**：把 `public/chars/*/torso.png` 逐张打开看一眼就行。别指望自动判据——
试过按"顶部窄段占内容高的比例"筛，`bajie` 53% 确实跳出来，但 `baigu` 22% 和
`tieshan` 27%（斗篷，正常）分不开，会误报。这一类还是肉眼最快。

**提示词要写死的两句**（现有模板已含前者，后者是这次补的）：
`No text, no watermark, no body, no shoulders.` 是给 **head** 用的；
**torso 那条必须写 `No head, no neck, no arms, no sleeves.`**——
只说 "torso only" 模型照样给你画头和袖子。

**后处理口径**（第一张试出来的）：/shot 落盘整页 → PIL 裁到品红面板**内侧**（圆角外的深色 UI 键不掉，bbox 收不紧）→ 键出品红 r>170 and b>170 and g<140 → getbbox 裁紧 → 等比缩到 122px 长边 → 贴进 128x128 透明画布居中。

## 复跑与限流

`python scripts/gen-parts.py` 断点续跑，已落盘的自动跳过；
`scripts/gen-loop.sh` 是它的循环外壳（轮间歇 10 分钟，每轮开头探一次代理活性，
凑够 23 张收工）。Chrome 副本（9222）与代理（3456）全程不动。

**分清"限流"和"触额"**，处置完全不同：对话标题是 `Image Generation Limit Reached`
才是真触额；标题正常、提交也进去了、却一直停在 `Creating your image` 十分钟不出图的，
是服务端过载（skill 里 1095 那一类），处置是**退避约 1 小时**——
不是改提示词，也不是加重试。这一条当初判错过一次。

**踩过并已修在脚本里的四个坑**（别走回头路）：

1. 判"出图完成"不能数大图数量——Gemini 会回收滚出视野的旧图，数量不单调递增；要盯最后一张图的 src
2. `/enter` 的回执会骗人：它返回 `entered` 成功，但焦点掉了就没提交，提示词原封不动躺在编辑器里；改成点发送按钮
3. 复用同一条对话会被卡住的那次生成堵死；每件开新对话
4. 白骨精那类词（skeletal / hollow eye sockets / bone）撞医学解剖过滤，页面回的是就医建议；改成戏曲扮相说法
