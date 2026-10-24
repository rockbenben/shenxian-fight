// 头身比回归测试。
//
// 这条测试守的是**量出来的结论**：十二个人共用同一副骨架（肩→髋 56、髋→地 62），
// 头贴图归一化之后，头占身高的比例必须一致——否则就是"头身比例不符合"。
//
// 新一版素材的契约是"头填满画幅"（scripts/head-art.json），于是**内容盒高就是头高**，
// 归一只剩一条锚：把头缩到同一个逻辑高度。脸仍然要量，但只管两件事：
// 脸在整幅里的横向位置（挂点：脸心要落在身体中轴上）与下巴到整幅底边的那一段
// （脖子要伸多远才够到下巴）。量出来的框写在各角色文件的 build.face 里
// （量法与工具见 scripts/measure-heads.py），素材或脸框一改，这条测试立刻响。
//
// 纯 JS（不是 .ts）：要用 node:fs/node:zlib，而项目没装 @types/node
// （tsconfig 的 types 只列了 vite/client），写成 .ts 会被 tsc --noEmit 卡住。
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { headScale, headMountDx, chinGapOf, torsoAnchors, headAnchor } from '../src/render/renderer.ts';
import { CHARACTERS } from '../src/data/characters/index.ts';

/** 头占身高的目标比例（百分数）。骨架共用，头就该是同一个大小。 */
const TARGET_PCT = 24.7;
/** 允许的离散度：头占身高的极差倍数。实测 1.17。 */
const MAX_PCT_SPREAD = 1.22;

/**
 * 读一张 PNG 的 alpha 内容包围盒（只处理 8bit RGBA、非隔行——public/chars 下的头图全是这种）。
 * 浏览器里这件事由 src/render/parts.ts 的 trimBox 做；测试环境没有 canvas，
 * 所以这里用 node:zlib 把 IDAT 解开后逐行反过滤，自己算。
 */
function alphaBox(file) {
  const buf = fs.readFileSync(file);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('不是 PNG: ' + file);
  let off = 8, w = 0, h = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || color !== 6 || interlace !== 0) {
        throw new Error(`不认识的 PNG 变体（depth=${depth} color=${color} interlace=${interlace}）: ${file}`);
      }
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  let prev = Buffer.alloc(stride);
  let top = -1, bottom = -1, left = w, right = 0;
  const row = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      row[i] = v & 0xff;
    }
    let rowLeft = -1, rowRight = -1;
    for (let x = 3; x < stride; x += 4) {
      if (row[x] > 10) { if (rowLeft < 0) rowLeft = x; rowRight = x; }
    }
    if (rowLeft >= 0) {
      if (top < 0) top = y;
      bottom = y;
      left = Math.min(left, rowLeft);
      right = Math.max(right, rowRight + 1);
    }
    prev = Buffer.from(row);
  }
  if (top < 0) throw new Error('整张图是透明的: ' + file);
  // 横向按**像素**换算：row 里每 4 个字节一个像素，alpha 在第 4 个
  return { top, bottom, left: left / bpp, right: right / bpp, w, h };
}

/** 颈点到脚的骨长（逻辑单位）：全员共用一副骨架，这个值对十二个人一样。 */
const LEG_TORSO = (() => {
  const { shX, shY } = torsoAnchors(0, 0, 0, 0, 1);   // feetY = 0
  const neckY = headAnchor(shX, shY, 0, 1).cy;
  return 0 - neckY;
})();

test('十二个人的头一样大——头占身高的比例是齐的', () => {
  // 素材契约保证"头填满画幅"，内容盒高就是头高 ⇒ 归一只剩一条锚。
  // 于是判据是**头占身高的比例**，而不是脸的大小（脸占头的比例是角色设计，
  // 猴王的脸小、小孩的脸大，那本来就该不一样）。
  const rows = [];
  for (const def of CHARACTERS) {
    const file = path.join('public', 'chars', def.id, 'head.png');
    if (!fs.existsSync(file)) continue;
    const box = alphaBox(file);
    const part = { img: {}, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    const scale = headScale(part) * (def.build?.head ?? 1);
    const headH = (box.bottom - box.top) * scale;
    const pct = headH / (LEG_TORSO + headH) * 100;
    rows.push({ id: def.id, headH, pct });
  }
  const pcts = rows.map(r => r.pct);
  const spread = Math.max(...pcts) / Math.min(...pcts);
  expect(spread, `头占身高的离散度 ${spread.toFixed(3)} 超过 ${MAX_PCT_SPREAD}：\n`
    + rows.map(r => `  ${r.id}: ${r.pct.toFixed(1)}%`).join('\n')).toBeLessThanOrEqual(MAX_PCT_SPREAD);
  const far = rows.filter(r => Math.abs(r.pct - TARGET_PCT) / TARGET_PCT > 0.16);
  expect(far, `这些角色的头占身高偏离太多：\n`
    + far.map(r => `  ${r.id}: ${r.pct.toFixed(1)}%（目标 ${TARGET_PCT}%）`).join('\n')).toEqual([]);
});

test('头填满画幅——内容盒高就是头高', () => {
  // 这是新素材契约的兑现：十一个人的内容盒高几乎一样（123~124），
  // 于是"内容盒高 = 头高"成立，归一才只剩一条锚。哪天素材不填满画幅了，
  // 这条测试会先响——头会突然比别人大一圈。
  const bad = [];
  for (const def of CHARACTERS) {
    const file = path.join('public', 'chars', def.id, 'head.png');
    if (!fs.existsSync(file)) continue;
    const box = alphaBox(file);
    const h = box.bottom - box.top;
    if (h < 110 || h > 128) bad.push(`${def.id}: 内容盒高 ${h}px（应为 123~128）`);
  }
  expect(bad, `素材没填满画幅：\n${bad.join('\n')}`).toEqual([]);
});

test('头按脸挂——脸心落在身体中轴上，头才在身体上', () => {
  // 头贴图里飘带/翎羽/帽翅都长在左边，脸心因此偏在整幅中心右边 6~31 像素。
  // 按整幅居中挂到颈点的话，脸被推到身体中轴右边 2~10 像素，**脖子接在耳朵那一侧**，
  // 头看着就不在身体上（玩家报的就是这个）。改按脸心对齐，装饰甩到身侧去。
  const bad = [];
  for (const def of CHARACTERS) {
    const file = path.join('public', 'chars', def.id, 'head.png');
    if (!fs.existsSync(file)) continue;          // 刑天无头
    const face = def.build?.face;
    expect(face, `${def.id} 没有登记脸的框`).toBeTruthy();
    const box = alphaBox(file);
    const part = { img: {}, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    const scale = headScale(part) * (def.build?.head ?? 1);
    // 渲染层用同一条式子算挂点：整幅中心相对颈点的偏移
    const dx = headMountDx(part, face, scale);
    const boxCtr = (part.left + part.right) / 2;
    const faceCtr = face[0] + face[2] / 2;        // face 是整幅图的绝对坐标
    // 渲染层把整幅画在 -dw/2 - dx：整幅中心落到局部 -dx，脸心在整幅里的偏移是
    // (faceCtr-boxCtr)×scale = dx，两者相消 ⇒ 脸心落在局部 0，也就是颈点上。
    const faceOffsetInBox = (faceCtr - boxCtr) * scale;
    const off = -dx + faceOffsetInBox;
    if (Math.abs(off) > 0.001) {
      bad.push(`${def.id}: 脸心离颈点 ${off.toFixed(2)}px（挂点 ${dx.toFixed(2)}）`);
    }
    // 顺带看一眼偏移的方向与大小：脸在整幅右边时整幅要左挪
    if (faceCtr > boxCtr && dx <= 0) bad.push(`${def.id}: 脸在整幅右边却没有左挪`);
  }
  expect(bad, `头没按脸挂：\n${bad.join('\n')}`).toEqual([]);
});

test('脖子要够到下巴——否则头和颈之间露出一截背景', () => {
  // 头贴图是半身像，下缘渐隐（哪吒那件从 0.34 淡到 0），下巴在整幅底边之上好几像素。
  // 脖子原先只伸到固定高度（肩上方 9），下巴与脖子之间就露出一截背景——
  // 头和颈看着是断开的两截。脖子要多伸 chinGap 这么长才够到下巴。
  const bad = [];
  for (const def of CHARACTERS) {
    const file = path.join('public', 'chars', def.id, 'head.png');
    if (!fs.existsSync(file)) continue;          // 刑天无头
    const face = def.build?.face;
    expect(face, `${def.id} 没有登记脸的框`).toBeTruthy();
    const box = alphaBox(file);
    const part = { img: {}, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    const scale = headScale(part) * (def.build?.head ?? 1);
    const gap = chinGapOf(part, face, scale);
    // 下巴在头贴图底边之上 gap（逻辑单位）处；脖子必须从颈点再往上伸 gap，才接得上
    const faceBottom = face[1] + face[3];
    const want = (box.bottom - faceBottom) * scale;
    if (Math.abs(gap - want) > 0.001) {
      bad.push(`${def.id}: chinGap 算错（${gap.toFixed(2)} vs ${want.toFixed(2)}）`);
    }
    if (gap <= 0) bad.push(`${def.id}: chinGap=${gap.toFixed(2)} —— 脸底已经贴着整幅底边，脖子伸不了也接不上`);
  }
  expect(bad, `头和颈接不上：\n${bad.join('\n')}`).toEqual([]);
});

test('每个有头贴图的角色都登记了脸框', () => {
  const missing = [];
  for (const def of CHARACTERS) {
    const file = path.join('public', 'chars', def.id, 'head.png');
    if (!fs.existsSync(file)) continue;
    const face = def.build?.face;                 // [x, y, 宽, 高]
    if (!Array.isArray(face) || face.length !== 4
      || !(face[2] > 4 && face[3] > 4 && face[2] < 200 && face[3] < 200)
      || !(face[0] >= 0 && face[1] >= 0)) {
      missing.push(`${def.id}: build.face=${JSON.stringify(face)} —— 素材带装饰的（飘带/天冠/高髻/头饰）`
        + '必须量出脸的框（x,y,宽,高），否则脸既会比别人小一截、又不在身体中轴上'
        + '（scripts/measure-heads.py）');
    }
  }
  expect(missing, `缺脸框：\n${missing.join('\n')}`).toEqual([]);
});
