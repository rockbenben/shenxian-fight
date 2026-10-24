// 腿部姿势回归测试。
//
// 守的是**角度约定**本身：骨段方向 = (sin a, cos a)，a=0 垂直向下、a>0 朝角色正面；
// Pose 里 legX = [大腿绝对角, 膝弯量]，小腿绝对角 = 大腿绝对角 − 膝弯量。
//
// 于是 **膝弯量 > 0 = 小腿相对大腿向后摆**（人膝唯一能弯的方向）；
// **膝弯量 < 0 = 小腿继续朝前摆 = 反向膝**，膝盖会朝前折，屏幕上读成一条反关节的腿。
//
// 这条测试照着真发生过的回归写的：跳跃与下蹲那几帧的前后腿膝弯量全是负的，
// 于是前腿伸直朝前像一记飞踢、后腿小腿往前甩把腿折成 Z；下蹲更离谱——
// 两脚横向拉开 94~100px（腿长才 64），整个读成横叉，蹲防的读法全没了。
import { expect, test } from 'vitest';
import { MOTIONS } from '../src/data/motions';
import { THIGH_LEN, SHIN_LEN, torsoAnchors } from '../src/render/renderer';
import type { Pose } from '../src/render/motion';

/** 一条腿在"脚踩在地面上"这件事上的复算：髋→膝→踝 */
function legFoot(pose: Pose, side: 'F' | 'B') {
  const [thighAbs, bend] = side === 'F' ? pose.legF : pose.legB;
  const { hipX, hipY } = torsoAnchors(0, 0, pose.lean, pose.crouch, 1);
  const kneeX = hipX + Math.sin(thighAbs) * THIGH_LEN;
  const kneeY = hipY + Math.cos(thighAbs) * THIGH_LEN;
  const shinAbs = thighAbs - bend;
  return {
    bend,
    hipY,
    kneeX,
    kneeY,
    ankleX: kneeX + Math.sin(shinAbs) * SHIN_LEN,
    ankleY: kneeY + Math.cos(shinAbs) * SHIN_LEN,
  };
}

/** 站在地上的动作：两脚都不能插进地里，两脚也不能劈得太开 */
const GROUNDED = ['idle', 'walk', 'crouch', 'block', 'run'] as const;

test('膝盖只会往后弯——全表没有反向膝', () => {
  const bad: string[] = [];
  // **全表** 462 个动作都过一遍。��前这条只查 idle/walk/crouch/block/run/jump 六条，
  // 于是大招的姿势词表从没人扫过：每个角色 13 个具名姿势（coil/lunge/impact/guard/
  // jabF/jabB/drive/launch/air/slam/finalWind/finalBurst）展开成上百段序列，
  // 实测**406 个动作**里有关键帧的膝盖是反着折的——蓄力、冲刺、空中追击、落地砸
  // 这些最显眼的段全中，画面上读成一张"椅子"（膝盖在下方、小腿平着朝前甩）。
  for (const [id, m] of Object.entries(MOTIONS)) {
    for (const k of m.keys) {
      for (const side of ['F', 'B'] as const) {
        const bend = side === 'F' ? k.pose.legF[1] : k.pose.legB[1];
        if (bend < -0.05) {
          bad.push(`${id}@${k.t} leg${side} 膝弯量 ${bend.toFixed(2)} —— 小腿朝前折，是反向膝`);
        }
        // 折得太过（>140°）腿会自己卷起来，也读不出来
        if (bend > 2.45) {
          bad.push(`${id}@${k.t} leg${side} 膝弯量 ${bend.toFixed(2)} —— 折过 140°，腿卷到自己身上`);
        }
      }
    }
  }
  expect(bad, `反向膝：\n${bad.join('\n')}`).toEqual([]);
});

test('站着的动作里脚不插进地里，也不劈叉', () => {
  const bad: string[] = [];
  for (const id of GROUNDED) {
    const m = MOTIONS[id];
    for (const k of m.keys) {
      const f = legFoot(k.pose, 'F');
      const b = legFoot(k.pose, 'B');
      // legFoot 用 feetY=0 复算，地面就是 y=0；y 向下为正，踝点 > 0 就是插进地里了
      if (f.ankleY > 1.5) bad.push(`${id}@${k.t} 前脚低于地面 ${f.ankleY.toFixed(1)}px`);
      if (b.ankleY > 1.5) bad.push(`${id}@${k.t} 后脚低于地面 ${b.ankleY.toFixed(1)}px`);
      const spread = Math.abs(f.ankleX - b.ankleX);
      if (spread > 56) {
        bad.push(`${id}@${k.t} 两脚横向间距 ${spread.toFixed(0)}px（腿长 ${THIGH_LEN + SHIN_LEN}）—— 读成劈叉`);
      }
    }
  }
  expect(bad, `脚的位置不对：\n${bad.join('\n')}`).toEqual([]);
});

test('跳跃动作覆盖整段滞空——下降过程不能冻在最后一帧', () => {
  // 初速 jumpVel 14~18（各角色）、重力 0.9（engine/types.ts 的 GRAVITY）：
  // 最大的滞空 = 2 × 18 / 0.9 = 40 帧。动作短于此，下降全程都停在同一个姿势上。
  const airtime = Math.ceil(2 * 18 / 0.9);
  expect(MOTIONS.jump.frames, `跳跃动作只有 ${MOTIONS.jump.frames} 帧，最长滞空 ${airtime} 帧`)
    .toBeGreaterThanOrEqual(airtime);
  // 关键帧要一路铺到动作末尾，不能中间断掉
  const last = MOTIONS.jump.keys[MOTIONS.jump.keys.length - 1].t;
  expect(last).toBeGreaterThanOrEqual(airtime - 6);
});

test('跳跃四帧的脚都在该在的位置：起跳踩实、最高点收腿、落地前伸腿', () => {
  const at = (t: number) => MOTIONS.jump.keys.find(k => k.t === t)!.pose;
  const peak = at(19);
  // 最高点是**收腿**：两脚都收在身前离地，后脚跟翘到屁股后面、脚尖离地。
  // （曾经做成"前腿平举、后腿往后平甩"，画面读出来是"一腿跪着、一腿往后蹬"，不像人在空中。）
  const pf = legFoot(peak, 'F');
  const pb = legFoot(peak, 'B');
  // 前腿：大腿朝前抬出去（膝盖在身前）、小腿折回来把脚收到身下 —— 收腿的形状
  expect(pf.kneeX, '最高点的前膝该抬到身前').toBeGreaterThan(15);
  expect(pf.kneeY, '最高点的前膝该高于前脚（腿折起来了）').toBeLessThan(pf.ankleY);
  expect(pf.ankleY, '最高点的前脚该收在身前、离地一段').toBeLessThan(-20);
  expect(Math.abs(pf.ankleX), '最高点的前脚该收在身下').toBeLessThan(12);
  // 后腿：脚跟翘到屁股后面、脚尖离地
  expect(pb.ankleY, '最高点的后脚该翘起来离地').toBeLessThan(-35);
  expect(pb.ankleX, '最高点的后腿要往身后收').toBeLessThan(-15);
  // 起跳那一帧两脚都踩在地面上（髋沉 14，地面就在髋下 48）
  const push = at(0);
  expect(legFoot(push, 'F').ankleY).toBeCloseTo(0, 0);
  expect(legFoot(push, 'B').ankleY).toBeCloseTo(0, 0);
});
