// 双手持械的回归测试。
//
// 守的是**量出来的结论**：长杆兵器（棍/耙/长刀/枪/斧）现实中都是两只手分握杆上前后两处，
// 此前渲染层只有前手握兵器——兵器沿前臂方向画出去，后手是另画的一颗手，垂在身侧，
// 离杆子几十像素。画面上读起来是"拿着道具"，而且**头也不在双手中间**：
// 两只手一前一后摊开，头却只在身体中轴上，没有一个"双手夹着兵器"的整体。
//
// 弓是另一种：��手持弓一手拉弦，弦汇到拉弦的那只手上（弦拉成 V）。
// 剑与扇是单手兵器，后手垂着才对——不该被改成双手。
import { expect, test } from 'vitest';
import { backArmFor, backHandFor, weaponHold, headAnchor, torsoAnchors } from '../src/render/renderer';
import { MOTIONS } from '../src/data/motions';
import { CHARACTERS } from '../src/data/characters';
import type { WeaponDef } from '../src/engine/types';

/** 双手兵器：长杆类。剑/扇是单手，弓另算（一手持弓一手拉弦）。 */
const TWO_HANDED = new Set(['staff', 'rake', 'glaive', 'mace', 'spear', 'axe']);

/** 脚落地的 y（逻辑单位）——测量用，与渲染层同一套坐标。 */
const FEET_Y = 0;

test('站姿时后手握在兵器杆上，不是垂在身侧', () => {
  const bad: string[] = [];
  for (const def of CHARACTERS) {
    const w = def.weapon;
    if (!w || !TWO_HANDED.has(w.kind)) continue;
    const p = MOTIONS.idle.keys[0].pose;
    const { hand, elbow } = weaponHold(p, 0, FEET_Y, 1);
    const bh = backHandFor(p, 0, FEET_Y, 1, w);
    const dx = hand[0] - elbow[0], dy = hand[1] - elbow[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const vx = bh[0] - hand[0], vy = bh[1] - hand[1];
    const along = vx * ux + vy * uy;
    const perp = Math.abs(vx * -uy + vy * ux);
    if (perp > 6) bad.push(`${def.id}: 后手离杆 ${perp.toFixed(1)}px`);
    if (along > 2) bad.push(`${def.id}: 后手跑到前手前面去了（沿杆 ${along.toFixed(1)}）`);
    if (along < -w.len * w.grip - 2) bad.push(`${def.id}: 后手越过杆尾（沿杆 ${along.toFixed(1)}）`);
  }
  expect(bad, `站姿时后手没握在兵器上：\n${bad.join('\n')}`).toEqual([]);
});

test('全程的关键帧里，后手要么握在杆上、要么干脆放开——不能握到一半', () => {
  // 手臂伸到最远时后手够不到杆尾，那就**放开**（后臂用姿势里原来的角度）。
  // 不许出现"手在杆边但没握上"这种半吊子状态。
  const bad: string[] = [];
  let gripped = 0, released = 0;
  for (const def of CHARACTERS) {
    const w = def.weapon;
    if (!w || !TWO_HANDED.has(w.kind)) continue;
    for (const [mid, m] of Object.entries(MOTIONS)) {
      if (!mid.startsWith(def.id) && !['idle', 'walk', 'run', 'block', 'crouch', 'jump'].includes(mid)) continue;
      for (const k of m.keys) {
        const p = k.pose;
        const solved = backArmFor(p, 0, FEET_Y, 1, w);
        const { hand, elbow } = weaponHold(p, 0, FEET_Y, 1);
        const bh = backHandFor(p, 0, FEET_Y, 1, w);
        if (!solved) { released++; continue; }        // 放开：后臂回到姿势里的角度
        gripped++;
        const dx = hand[0] - elbow[0], dy = hand[1] - elbow[1];
        const L = Math.hypot(dx, dy) || 1;
        const vx = bh[0] - hand[0], vy = bh[1] - hand[1];
        const perp = Math.abs(vx * -dy / L + vy * dx / L);
        if (perp > 6) bad.push(`${def.id}/${mid}@${k.t}: 握上了却离杆 ${perp.toFixed(1)}px`);
      }
    }
  }
  expect(bad, `半吊子握法：\n${bad.slice(0, 15).join('\n')}`
    + (bad.length > 15 ? `\n…共 ${bad.length} 处` : '')).toEqual([]);
  expect(gripped, '一把都没握上——IK 根本没生效').toBeGreaterThan(50);
  expect(released, '一次都没放开过——伸到最远时也硬掰，胳膊会被拉断').toBeGreaterThan(0);
});

test('单手兵器不乱伸手——剑与扇的后手仍垂在身侧', () => {
  const bad: string[] = [];
  for (const def of CHARACTERS) {
    const w = def.weapon;
    if (!w || TWO_HANDED.has(w.kind) || w.kind === 'bow') continue;
    const p = MOTIONS.idle.keys[0].pose;
    // 判据一：单手兵器**不许**解算后手去握杆——解了就成了双手持械。
    // 这条以前是靠"后手离前手 26px 以上"来代理的，现在不用了：
    // 后肩挪到**远侧**（画面右边，背向镜头的那一边）之后，远侧的手垂下来时
    // 与前手在屏幕上只差十来像素——那是几何的必然，不是"伸手去握兵器"。
    if (backArmFor(p, 0, FEET_Y, 1, w) !== null) bad.push(`${def.id}: 单手兵器却把后手解到了杆上`);
    // 判据二：后手从**远肩**垂下，不许横穿到近侧去。
    // 这条是真的几何：后肩在远侧（见 backArmAnchor），手臂自然垂在身体的后边。
    // 旧几何里后肩偏在近侧（-17），后手垂下来跑到身体的另一头——正是"躯干和手臂分离"的
    // 那一侧。远肩挪到 +14 之后，后手必须仍在身体中轴的远侧。
    const { shX } = torsoAnchors(0, FEET_Y, p.lean, p.crouch, 1);
    const bh = backHandFor(p, 0, FEET_Y, 1, w);
    if (bh[0] <= shX) bad.push(`${def.id}: 后手横穿到了近侧（${bh[0].toFixed(1)}）`);
  }
  expect(bad, `单手兵器不该被改成双手：\n${bad.join('\n')}`).toEqual([]);
});

test('头在双手中间——站姿时头不能偏出双手之间', () => {
  // 这条要换判据范围：以前十二个人都查，是因为旧几何里**后手垂在近侧**（身体另一边），
  // 于是单手兵器的两只手也天然分居身体两侧，头夹在中间。
  // 后肩挪到远侧之后，单手兵器的后手垂在背后，与前手同侧——这条对单手兵器不再成立，
  // 而它本来也不是单手兵器该有的样子（那是"双手夹着兵器"的副产品）。
  // 现在只查**双手兵器**：那才是"头在双手之间"这个说法的出处。
  const bad: string[] = [];
  for (const def of CHARACTERS) {
    const w = def.weapon;
    if (!w || !TWO_HANDED.has(w.kind)) continue;
    const p = MOTIONS.idle.keys[0].pose;
    const { shX, shY } = torsoAnchors(0, FEET_Y, p.lean, p.crouch, 1);
    const head = headAnchor(shX, shY, p.lean, 1);
    const { hand } = weaponHold(p, 0, FEET_Y, 1);
    const bh = backHandFor(p, 0, FEET_Y, 1, w);
    const lo = Math.min(hand[0], bh[0]), hi = Math.max(hand[0], bh[0]);
    if (head.cx < lo - 6 || head.cx > hi + 6) {
      bad.push(`${def.id}: 头 ${head.cx.toFixed(1)} 不在双手之间（${lo.toFixed(1)}~${hi.toFixed(1)}）`);
    }
  }
  expect(bad, `头没在双手中间：\n${bad.join('\n')}`).toEqual([]);
});

test('后臂的角度是解出来的，不是姿势里写死的', () => {
  const w: WeaponDef = { kind: 'staff', len: 118, grip: 0.5, shaft: '#c9862b', edge: '#ffd23f' };
  const p = MOTIONS.idle.keys[0].pose;
  const a = backArmFor(p, 0, FEET_Y, 1, w);
  const b = backArmFor(p, 0, FEET_Y, 1, w);
  expect(a).not.toBeNull();
  expect(a).toEqual(b);
  // 单手兵器没有后手解算
  expect(backArmFor(p, 0, FEET_Y, 1, { kind: 'sword', len: 54, grip: 0.12, shaft: '#c9c3b2', edge: '#e8e4d6' }))
    .toBeNull();
});
