import type { CharacterDef } from '../engine/types';
import { CHARACTERS } from './characters';

/** 击退：六记地面招里把人推得最远的那一记。traitOf 要用，与 screens.tsx 里那份同源——
 * 这里是**数据层**的那一份，渲染层（banner）也要用，而渲染层不能引 React。 */
const push = (c: CharacterDef) =>
  Math.max(...(['n1', 'n2', 'n3', 's1', 's2', 's3'] as const).map(k => c.moves[k].knockback.x));

/**
 * 这个角色的**机制钩子**，一句话。
 *
 * 选人页此前只说定位（「霸体 · 硬吃」）与六根柱子，而定位是个形容词——
 * 挑刑天的人不会知道他的必杀起手能硬吃一下，挑后羿的人不会知道三记必杀全是箭。
 * 十二个人各有一处别人没有的机制，不说出来等于没做。
 *
 * **从数据推**而不是各写一句：写死的话数据一改它就开始骗人（这个项目在重复规则上栽过六次）。
 * 按"这个角色最特别的一件事"排优先级，取第一条命中的。
 */
export function traitOf(c: CharacterDef): string {
  if (c.grapple) return `投技够到 ${c.grapple.range}（常规 52），伤害更高、冷却更短`;
  const armored = Object.values(c.moves).filter(m => (m.armor ?? 0) > 0).length;
  if (armored > 0) return `${armored} 记必杀的起手带霸体：硬吃一下不进硬直`;
  const proj = (['s1', 's2', 's3'] as const).filter(k => c.moves[k].projectile).length;
  if (proj >= 2) return `${proj} 记必杀是飞行道具，可以整局不进近身距离`;
  const guarded = (['s1', 's2', 's3'] as const).filter(k => c.moves[k].guard).length;
  if (guarded >= 2) return '必杀也分上下段：看起来一样，得猜蹲还是站';
  const slowest = Math.min(...CHARACTERS.flatMap(x => (['s1', 's2', 's3'] as const)
    .map(k => x.moves[k].projectile?.vx ?? 99)));
  if ((['s1', 's2', 's3'] as const).some(k => c.moves[k].projectile?.vx === slowest)) {
    return '鬼卒比走路还慢：可以跟在它后面一起压上去';
  }
  if (c.jumpVel >= Math.max(...CHARACTERS.map(x => x.jumpVel))) return '起跳最高、滞空最久，主战场在空中';
  if (c.speed >= Math.max(...CHARACTERS.map(x => x.speed))) return '全场最快，普攻起手也最快';
  if (push(c) >= Math.max(...CHARACTERS.map(push))) return '击退最高：把人推回你要的距离';
  // 回旋兵器：全名册只有乾坤圈会飞回来（projectile.back），去和回各判一次
  if ((['s1', 's2', 's3'] as const).some(k => (c.moves[k].projectile?.back ?? 0) > 0)) {
    return '乾坤圈会飞回来，去和回各判一次';
  }
  // 近身攻程（不算飞行道具）最长的那一位
  const melee = (x: CharacterDef) =>
    Math.max(...(['s1', 's2', 's3'] as const).map(k => x.moves[k].hitbox.x + x.moves[k].hitbox.w));
  if (melee(c) >= Math.max(...CHARACTERS.map(melee))) return '近身攻程最长，够得着别人够不着的地方';
  if (c.hp >= Math.max(...CHARACTERS.map(x => x.hp))) return '血最厚，硬碰硬不吃亏';
  return '样样都有，样样不极端——没有短板就是他的长板';
}
