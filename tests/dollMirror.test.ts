// 纸偶/旧管线角色**换边时的镜像对称性**回归测试。
//
// 守的是一条几何不变量：**同一个角色、同一个姿势，fc=-1 画出来的东西必须恰好是
// fc=+1 的水平镜像**（以身体中轴 x 为镜面）。
//
// 这条不变量为什么值钱：它一坏，画面上不会「某个零件不见了」，而是**整块身子挪了**。
// 2026-10-26 真的踩过一次——躯干那一块的挂点在朝左时多搬了一次中轴，偏的量是
// （整宽 − 2×挂点）：猪八戒 15.5、红孩儿 15.0、二郎 12.2 个逻辑单位（身高才 154）。
// 读作「角色在右侧时头和手臂明显右移」：头、近肩、后肩都是按中轴摆的（那几处乘 fc 是对的），
// 只有躯干偏到了左边，衬着偏掉的躯干看，头和手臂就像甩到了身体右边。
// 猪八戒那张尤其明显：躯干整个是一块方板，左边切得笔直，头浮在右上方，近臂与躯干之间裂开一道缝。
//
// 怎么量：不靠眼睛，也不靠"整张图差多少像素"（那只会给一个总数，说不清错在哪）。
// 这里在渲染器画每一件时记下它的几何与当时的变换矩阵，换算到设备坐标，
// 再逐件断言「它的左右边界正好是换边前那一件镜像过来的」。
//
// 覆盖范围：
//   · **全部 motion 的全部采样帧**（姿势去重后）——姿势一换（lean/crouch），几何就换，
//     某些错位只在特定姿势下才显形；
//   · **两条画法**：纸偶（默认）与旧管线（?doll=0）。旧的条是「头与躯干是画的、
//     四肢是程序化圆柱」，两边并存，镜像不变量对两条都得成立。
//   · **两种几何**：贴图（drawImage 的目标矩形）与程序化笔触（描边路径的点）。
//
// 这条测试守的是**调用点**上的事（drawDollLimbs 里那一句 anchorOff），
// 不是渲染公式的近似值——量的是真渲染器画出来的真几何。
import { expect, test } from 'vitest';
import { drawLimbs } from '../src/render/renderer';
import { CHARACTERS } from '../src/data/characters/index';
import { MOTIONS } from '../src/data/motions';
import { samplePose } from '../src/render/motion';
import type { Pose } from '../src/render/motion';
import type { PartImage, PartImages } from '../src/render/parts';

// ── 变换矩阵（与 canvas 的 post-multiply 语义一致：CTM = CTM · T/R/S）────────
// x' = a·x + c·y + e ; y' = b·x + d·y + f
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
function mMul(m: Mat, n: Mat): Mat {
  const [a, b, c, d, e, f] = m, [a2, b2, c2, d2, e2, f2] = n;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}
const mTranslate = (m: Mat, x: number, y: number): Mat => mMul(m, [1, 0, 0, 1, x, y]);
const mRotate = (m: Mat, a: number): Mat => { const c = Math.cos(a), s = Math.sin(a); return mMul(m, [c, s, -s, c, 0, 0]); };
const mScale = (m: Mat, sx: number, sy: number): Mat => mMul(m, [sx, 0, 0, sy, 0, 0]);
const mApply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 一件东西在设备坐标里的横向范围 [minX, maxX]。 */
interface Piece { tag: string; minX: number; maxX: number }

/**
 * 两组几何按「镜像后应当一一相等」比对。
 *
 * **为什么不能按第 i 件配第 i 件**：换边时有些**成对**的几何会互换位置——
 * 比如火尖枪那两缕火缨（s=±1），朝左时 s=-1 的那一缕正好是朝右时 s=+1 的镜像。
 * 按序号配对会把这种正常的互换误报成错位。正确的判据是**多重集合相等**：
 * 换边那一组逐件镜像回去，与原来那一组应当能一一对上（顺序不限）。
 *
 * 返回对不上的件（两边都没配上）。
 */
function mirrorMismatches(a: Piece[], b: Piece[], axis: number, eps: number): { unmatched: string[]; worst: number } {
  // 换边那一组逐件镜像回去
  const expect = b.map(p => ({ tag: p.tag, minX: 2 * axis - p.maxX, maxX: 2 * axis - p.minX }));
  const A = [...a].sort((p, q) => p.minX - q.minX);
  const E = [...expect].sort((p, q) => p.minX - q.minX);
  const usedA = new Array<boolean>(A.length).fill(false);
  const unmatched: string[] = [];
  let worst = 0;

  let j = 0;
  for (const e of E) {
    while (j < A.length && A[j].minX < e.minX - eps) j++;
    let hit = -1;
    for (let k = j; k < A.length && A[k].minX <= e.minX + eps; k++) {
      if (!usedA[k] && Math.abs(A[k].minX - e.minX) <= eps && Math.abs(A[k].maxX - e.maxX) <= eps) { hit = k; break; }
    }
    if (hit >= 0) { usedA[hit] = true; continue; }
    // 对不上：把**最近的那一件**也报出来（差多少、是哪一件）
    let near = -1, nearD = Infinity;
    for (let k = 0; k < A.length; k++) {
      const d = Math.abs(A[k].minX - e.minX) + Math.abs(A[k].maxX - e.maxX);
      if (!usedA[k] && d < nearD) { nearD = d; near = k; }
    }
    const dev = near >= 0 ? nearD / 2 : Infinity;
    worst = Math.max(worst, dev);
    unmatched.push(`对不上：${e.tag} 期望 ${e.minX.toFixed(1)}~${e.maxX.toFixed(1)}`
      + (near >= 0 ? `，最接近的是 ${A[near].tag} ${A[near].minX.toFixed(1)}~${A[near].maxX.toFixed(1)}（差 ${dev.toFixed(1)}）` : ''));
  }
  return { unmatched, worst };
}

function recordingCtx(tags: Map<object, string>) {
  const pieces: Piece[] = [];
  let m: Mat = IDENT;
  const stack: Mat[] = [];
  // 当前正在攒的那一笔路径
  let path: number[] = [];
  const grad = { addColorStop() {} };

  function flushPath() {
    if (path.length >= 2) {
      let mn = Infinity, mx = -Infinity;
      for (const x of path) { if (x < mn) mn = x; if (x > mx) mx = x; }
      pieces.push({ tag: 'path', minX: mn, maxX: mx });
    }
    path = [];
  }
  const addPt = (x: number, y: number) => {
    const [dx] = mApply(m, x, y);
    path.push(dx);
  };

  const ctx = {
    save() { stack.push(m); },
    restore() { const s = stack.pop(); if (s) m = s; },
    translate(x: number, y: number) { m = mTranslate(m, x, y); },
    rotate(a: number) { m = mRotate(m, a); },
    scale(sx: number, sy: number) { m = mScale(m, sx, sy); },
    beginPath() { path = []; },
    closePath() {},
    stroke() { flushPath(); },
    fill() { flushPath(); },
    moveTo(x: number, y: number) { addPt(x, y); },
    lineTo(x: number, y: number) { addPt(x, y); },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) { addPt(cx, cy); addPt(x, y); },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      addPt(c1x, c1y); addPt(c2x, c2y); addPt(x, y);
    },
    arc(cx: number, cy: number, r: number, a0: number, a1: number) {
      // 弧按 9 个采样点取值——边界取全，角度范围也取全
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (a1 - a0) * (i / 8);
        addPt(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    },
    ellipse(cx: number, cy: number, rx: number, ry: number, rot: number) {
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        addPt(cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot));
      }
    },
    arcTo() {}, rect() {},
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    fillRect() {}, setTransform() {}, resetTransform() {},
    set globalCompositeOperation(_v: string) {}, set globalAlpha(_v: number) {},
    set fillStyle(_v: unknown) {}, set strokeStyle(_v: unknown) {}, set lineWidth(_v: number) {},
    drawImage(img: unknown, ...rest: number[]) {
      // 九参版：drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) —— rest 里正好 8 个数
      if (rest.length >= 8) {
        // rest = [sx, sy, sw, sh, dx, dy, dw, dh]
        const [, , , , dx, dy, dw, dh] = rest;
        const xs = [
          mApply(m, dx, dy)[0], mApply(m, dx + dw, dy)[0],
          mApply(m, dx + dw, dy + dh)[0], mApply(m, dx, dy + dh)[0],
        ];
        pieces.push({
          tag: tags.get(img as object) ?? '?',
          minX: Math.min(...xs), maxX: Math.max(...xs),
        });
      }
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, pieces };
}

/** 假的纸偶件：内容框按像素给，img 只当个标签用（桩 ctx 不读它的像素）。 */
function fakePart(tag: string, pxW: number, pxH: number, tags: Map<object, string>): PartImage {
  const img = { tag } as unknown as HTMLImageElement;
  tags.set(img, tag);
  return { img, top: 0, bottom: pxH, left: 0, right: pxW };
}

/**
 * 给一个角色造一套假件。
 *
 * 躯干那一块的**内容框宽度必须够宽**：挂点（torsoAnchorX = 身体中轴离件左缘多远）
 * 要落在框里。宽度取「中轴到右边」再加一段——真件的裁切框本来就要够宽
 * （身体与远臂之间那一段、裙摆的右边都得装得下）。
 */
function fakeParts(rig: NonNullable<NonNullable<typeof CHARACTERS[number]['build']>['rig']>, tags: Map<object, string>): PartImages {
  const k = rig.k;
  const axisPx = (rig.torsoAnchorX ?? 0) / k;      // 中轴离件左缘多少源像素
  const torsoW = Math.ceil(axisPx) + 200;
  return {
    doll: {
      torso: fakePart('torso', torsoW, 320, tags),
      head: fakePart('head', 170, 124, tags),
      armFU: fakePart('armFU', 60, 100, tags),
      armFL: fakePart('armFL', 55, 60, tags),
      handF: fakePart('handF', 50, 50, tags),
      legFU: fakePart('legFU', 55, 100, tags),
      legFL: fakePart('legFL', 50, 100, tags),
      footF: fakePart('footF', 60, 30, tags),
      // 兵器件也给它：生产环境十二个人都有画出来的兵器（chars/<id>/parts/weapon.png），
      // 纸偶路径走的是那一张。程序化兵器由旧管线那条测试覆盖。
      weapon: fakePart('weapon', 120, 40, tags),
    },
  };
}

/** 一条 motion 的采样帧：关键帧本身 + 均匀插值帧（照抄 tests/renderer.test.ts 的做法）。
 *  均匀帧取 11 个：lean 的真实峰值都落在关键帧上（关键帧的 t 已经全采了），
 *  均匀帧只为覆盖关键帧之间的插值。 */
function sampleFrames(m: (typeof MOTIONS)[string]): number[] {
  const uniform = Array.from({ length: 11 }, (_, i) => (i / 10) * m.frames);
  return [...uniform, ...m.keys.map(k => k.t)];
}

/** 全部 motion 的全部采样姿势，按值去重（同一个姿势在几百条 motion 里会重复出现） */
function allPoses(): Pose[] {
  const seen = new Map<string, Pose>();
  for (const [, m] of Object.entries(MOTIONS)) {
    for (const f of sampleFrames(m)) {
      const p = samplePose(m, f);
      const key = [p.lean, p.crouch, p.roll, p.squash, p.headTilt,
        ...p.armF, ...p.armB, ...p.legF, ...p.legB]
        .map(v => Math.round(v * 1e3)).join(',');
      if (!seen.has(key)) seen.set(key, p);
    }
  }
  return [...seen.values()];
}

const X = 300, FEET_Y = 400;
/** 容差：矩阵与三角函数都是双精度，误差在 1e-9 量级；给 1e-6 足够宽又不掩盖真实错位。 */
const EPS = 1e-6;

test('纸偶角色换边后整体是换边前的水平镜像（十二个人 × 全部姿势逐件核对）', () => {
  const poses = allPoses();
  const bad: string[] = [];
  let checked = 0;

  for (const def of CHARACTERS) {
    const rig = def.build?.rig;
    if (!rig) { bad.push(`${def.id}：没有 build.rig，这条测试够不着它`); continue; }
    const tags = new Map<object, string>();
    const parts = fakeParts(rig, tags);

    for (const pose of poses) {
      const a = recordingCtx(tags);
      drawLimbs(a.ctx, pose, X, FEET_Y, 1, parts, def.palette.main, def.palette.accent,
        false, def.weapon, 1, 0, def.headless, def.crown, def.build);
      const b = recordingCtx(tags);
      drawLimbs(b.ctx, pose, X, FEET_Y, -1, parts, def.palette.main, def.palette.accent,
        false, def.weapon, 1, 0, def.headless, def.crown, def.build);

      expect(a.pieces.length, `${def.id}：两次渲染画出的件数不一样`).toBe(b.pieces.length);
      const { unmatched, worst } = mirrorMismatches(a.pieces, b.pieces, X, EPS);
      checked += a.pieces.length;
      if (unmatched.length) {
        bad.push(`${def.id}（纸偶）：${unmatched.length} 件对不上，最大偏差 ${worst.toFixed(3)}｜`
          + unmatched.slice(0, 3).join('；')
          + `｜lean=${pose.lean.toFixed(2)} crouch=${pose.crouch.toFixed(2)}`);
      }
    }
  }
  console.log(`姿势 ${poses.length} 种 × ${CHARACTERS.length} 人，断言 ${checked} 条`);
  expect(bad, `换边不对称（${bad.length} 条，前 12 条）：\n${bad.slice(0, 12).join('\n')}`).toEqual([]);
});

test('旧管线（?doll=0）同样满足镜像对称：头、躯干、兵器与程序化四肢都不能偏', () => {
  const poses = allPoses();
  const bad: string[] = [];
  let checked = 0;

  for (const def of CHARACTERS) {
    const rig = def.build?.rig;
    if (!rig) continue;
    const tags = new Map<object, string>();
    // 旧管线：只有 head/torso，**没有兵器件** —— public/chars/<id>/weapon.png 从来没有，
    // 所以旧管线一律走程序化兵器（drawWeapon）。没有它，这条测试就够不着程序化那半边。
    const parts: PartImages = {
      head: fakePart('head', 170, 124, tags),
      torso: fakePart('torso', 200, 320, tags),
    };

    for (const pose of poses) {
      const a = recordingCtx(tags);
      drawLimbs(a.ctx, pose, X, FEET_Y, 1, parts, def.palette.main, def.palette.accent,
        false, def.weapon, 1, 0, def.headless, def.crown, def.build);
      const b = recordingCtx(tags);
      drawLimbs(b.ctx, pose, X, FEET_Y, -1, parts, def.palette.main, def.palette.accent,
        false, def.weapon, 1, 0, def.headless, def.crown, def.build);

      expect(a.pieces.length, `${def.id}（旧管线）：两次渲染画出的件数不一样`).toBe(b.pieces.length);
      const { unmatched, worst } = mirrorMismatches(a.pieces, b.pieces, X, EPS);
      checked += a.pieces.length;
      if (unmatched.length) {
        bad.push(`${def.id}（旧管线）：${unmatched.length} 件对不上，最大偏差 ${worst.toFixed(3)}｜`
          + unmatched.slice(0, 3).join('；')
          + `｜lean=${pose.lean.toFixed(2)} crouch=${pose.crouch.toFixed(2)}`);
      }
    }
  }
  console.log(`旧管线：姿势 ${poses.length} 种 × ${CHARACTERS.length} 人，断言 ${checked} 条`);
  expect(bad, `旧管线换边不对称（${bad.length} 条，前 12 条）：\n${bad.slice(0, 12).join('\n')}`).toEqual([]);
});

test('躯干那一块的身体中轴必须落在挂载轴上（两个朝向都是）', () => {
  const bad: string[] = [];
  for (const def of CHARACTERS) {
    const rig = def.build?.rig;
    if (!rig) continue;
    const tags = new Map<object, string>();
    const parts = fakeParts(rig, tags);

    for (const fc of [1, -1] as const) {
      const rec = recordingCtx(tags);
      drawLimbs(rec.ctx, samplePose(MOTIONS.idle, 0), X, FEET_Y, fc, parts, def.palette.main, def.palette.accent,
        false, def.weapon, 1, 0, def.headless, def.crown, def.build);
      const torso = rec.pieces.find(p => p.tag === 'torso');
      if (!torso) { bad.push(`${def.id}：没找到躯干那一块的绘制`); continue; }
      // 躯干件贴在挂载轴上：内容摆在局部 x∈[-挂点, -挂点+整宽]，于是**身体中轴恰好落在
      // 局部 x=0**（= 挂载点）。整宽的中心相对挂点偏了「整宽/2 − 挂点」，
      // 朝向翻过来时这一项也跟着翻（内容被 scale(facing,1) 镜像）。
      // 静止姿势下躯干是竖的（lean=0 → 旋转为 0），于是设备坐标里的中心横坐标就是
      //     挂载点横坐标 + facing ×（整宽/2 − 挂点）
      const anchorOff = rig.torsoAnchorX ?? 0;
      const halfW = (torso.maxX - torso.minX) / 2;
      const center = (torso.minX + torso.maxX) / 2;
      const expected = X + fc * (halfW - anchorOff);
      if (Math.abs(center - expected) > 1e-6) {
        bad.push(`${def.id} 朝${fc > 0 ? '右' : '左'}：躯干中心在 ${center.toFixed(3)}，`
          + `应为 ${expected.toFixed(3)}（中轴没落在挂载轴上，偏了 ${(center - expected).toFixed(3)}）`);
      }
    }
  }
  expect(bad, `躯干中轴没挂在挂载轴上：\n${bad.join('\n')}`).toEqual([]);
});
