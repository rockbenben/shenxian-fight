import { INK } from '../render/palette';

/** 外壳（React 层）的设计令牌。
 *
 * 之前外壳是 #0b0b12 + system-ui + 圆角红按钮，而画布里是水墨描边 + 矿物重彩 + 竖排
 * 朱砂印——同一个游戏里两套互不相干的视觉。这里直接引 render/palette 的 INK，让外壳和
 * 画布用同一批颜料，颜色只有一个源头，改画布配色时外壳跟着走。 */
export const T = {
  /** 夜墨：比原来的 #0b0b12 偏蓝，与各关卡夜空渐变同色系，不是紫黑 */
  ground: '#0E141C',
  paper: INK.paper,
  zhusha: INK.cinnab,
  /** 印泥压深的一档，只给印章的**底**用。
   * 宣纸色的字压在 #C8443C 上是 3.80:1，17px 够不到 4.5——而这是四个屏的主操作。
   * 压深到 #B23A2D 之后 4.67:1；印框那一圈仍然用朱砂本色的 INK.cinnab，
   * 章还是那枚章，只是印泥厚了一点。画布里的印章与超必杀边框照旧用 zhusha，不受影响。 */
  zhushaDeep: '#B23A2D',
  tenghuang: INK.gamboge,
  shiqing: INK.azurite,
  /** 同一个宣纸色相拉三档透明度，避免再引入灰阶。
   * 分工要点：字号越小越需要更高对比，不是更低——初版把 11px 的小字给了 hair(.22)，
   * 在 #0E141C 上大约 1.8:1，实测截图里几乎看不见。hair 从此只用于线，不碰文字。 */
  hair: 'rgba(237,227,210,.22)',   // 细线、分隔栏、未就绪的描边
  faint: 'rgba(237,227,210,.55)',  // 次级文字（13–15px）
  dim: 'rgba(237,227,210,.74)',    // 小字（10–13px）：更小所以要更亮
};

/** 居中 + 字距的中文排印：字距是加在每个字**后面**的，末字后面那道空让整串看着往左偏。
 * 补一个等值的负右边距拉回光学居中。只给"居中的、带字距的"文本用——
 * 左对齐的那些年号/属性标签不补（那里尾部空本来就在行尾，看不出问题）。 */
export const lsFix = (ls: number): React.CSSProperties => ({ marginRight: -ls });

/** 展示字：自带的思源宋子集，只用于名字与标题这类"排印"文本。
 * 交互文案保持 system-ui——正是这份克制让宋体读起来是郑重的，全站铺开反而失去分量。 */
export const SERIF = "'ShenxianSerif','Songti SC','SimSun','Noto Serif CJK SC',serif";

/** 竖排：本作的结构性排版手法（画布里的超必杀名也是竖排），不是装饰。
 * 横屏手机竖向空间稀缺、横向富余，名字竖排恰好用在不缺的那根轴上。 */
export const VERTICAL: React.CSSProperties = { writingMode: 'vertical-rl', textOrientation: 'upright' };

/** 安全区内缩。index.html 是 viewport-fit=cover：横屏时刘海与圆角会啃掉左右两侧，
 * 此前只有 MuteButton 和 TouchLayer 处理过，五块全屏面板（标题/操作/选人/结算/竖屏挡板）
 * 都没有，真机横屏时标题与
 * 卡片会压在刘海底下。 */
export const SAFE: React.CSSProperties = {
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
};

/** 中文序数。正本在 `data/cn.ts`（数据层那句「三记必杀」也要用它），
 * 这里只是转发给界面层既有的 import 路径，别再抄第三份表。 */
export { CN_NUM, cn } from '../data/cn';
