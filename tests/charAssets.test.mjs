// 纯 JS（不是 .ts）：这个测试要 import node:fs/node:path，而项目没装 @types/node
// （tsconfig 的 types 只列了 vite/client），写成 .ts 会被 tsc --noEmit 卡住——
// 同 offlineAssets.test.mjs / font-coverage.test.mjs 的理由。这条约定我刚踩过一次。
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 上面 parts.test.ts 那几条全用假 Image，一个字节都不碰 public/——
// 而 docs/art-missing-parts.md 一直写着"跑一次 npm run verify（parts.test.ts 会检查挂载路径）"，
// 那句话此前是**假的**：素材名写错、放错目录、多出一件不被探测的部件，全都能安静通过。
// 这个文件把那句话变成真的。
//
// 尤其要守**多出来的部件**：探测列表收窄到 head/torso 之后，往 chars/<id>/ 放一张 armF.png
// 会被完全无视——没有 404、没有报错、画面上照旧是程序化的胳膊，加素材的人得不到任何反馈。
test('public/chars 里的每个文件都在探测列表内，且命名合规', () => {
  const PROBED = ['head', 'torso'];          // 与 src/render/parts.ts 的 NAMES 一致
  // 纸偶件那一套（整人一张画切出来的），放在 chars/<id>/doll/ 下，
  // 与 src/render/parts.ts 的 DOLL_NAMES + DOLL_BACK_NAMES 一致。
  // 远臂那三件（armBU/armBL/handB）只有画里两条胳膊都画全了的角色才有，
  // 按角色有没有（rig.backArm）来探——其余角色探了就是必然 404。
  const DOLL_PROBED = ['head', 'torso', 'armFU', 'armFL', 'handF', 'legFU', 'legFL', 'footF',
    'armBU', 'armBL', 'handB', 'tail', 'wing'];
  const root = 'public/chars';
  expect(fs.existsSync(root), 'public/chars 不见了').toBe(true);

  const stray = [];
  for (const id of fs.readdirSync(root)) {
    const dir = path.join(root, id);
    if (!fs.statSync(dir).isDirectory()) { stray.push(`${id} 不是目录`); continue; }
    if (!/^[a-z]+$/.test(id)) stray.push(`${dir} 目录名不是全小写字母（渲染层按 def.id 拼路径）`);
    for (const f of fs.readdirSync(dir)) {
      // 纸偶件那一套在自己的子目录里：chars/<id>/parts/<部件名>.png
      if (f === 'parts') {
        const ddir = path.join(dir, f);
        if (!fs.statSync(ddir).isDirectory()) { stray.push(`${ddir} 不是目录`); continue; }
        for (const df of fs.readdirSync(ddir)) {
          const dm = /^([a-zA-Z]+)\.png$/.exec(df);
          if (!dm) { stray.push(`${ddir}/${df} 不是 <部件名>.png`); continue; }
          if (!DOLL_PROBED.includes(dm[1])) {
            stray.push(`${ddir}/${df} 的部件名不在纸偶探测列表 [${DOLL_PROBED}] 内——`
              + '它永远不会被加载，要么改名，要么把这个名字加回 src/render/parts.ts 的 DOLL_NAMES');
          }
        }
        continue;
      }
      const m = /^([a-zA-Z]+)\.png$/.exec(f);
      if (!m) { stray.push(`${dir}/${f} 不是 <部件名>.png`); continue; }
      if (!PROBED.includes(m[1])) {
        stray.push(`${dir}/${f} 的部件名不在探测列表 [${PROBED}] 内——它永远不会被加载，`
          + '要么改名，要么把这个名字加回 src/render/parts.ts 的 NAMES');
      }
    }
  }
  expect(stray, `public/chars 里有挂不上的素材：\n${stray.join('\n')}`).toEqual([]);
});

// 远臂那三件（armBU/armBL/handB）**按角色有没有**来探（rig.backArm）。
// 两边对不上就是两种毛病：素材有而标记没有 → 永远不会被加载（画面上那条远臂是空的）；
// 标记有而素材没有 → 三个必然 404（选人页一次预载十二个人就是三十六个白跑的请求）。
test('远臂件与角色的 backArm 标记一一对应', () => {
  const BACK = ['armBU', 'armBL', 'handB'];
  const root = 'public/chars';
  const charsDir = 'src/data/characters';
  const bad = [];
  for (const id of fs.readdirSync(root)) {
    const dir = path.join(root, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const partsDir = path.join(dir, 'parts');
    const has = BACK.filter(n => fs.existsSync(path.join(partsDir, `${n}.png`)));
    const src = path.join(charsDir, `${id}.ts`);
    if (!fs.existsSync(src)) { bad.push(`${id}: 没有 src/data/characters/${id}.ts`); continue; }
    const flagged = /backArm:\s*true/.test(fs.readFileSync(src, 'utf8'));
    if (flagged && has.length !== BACK.length) {
      bad.push(`${id}: 标了 backArm 但远臂件只有 [${has}]（应为 ${BACK}）`);
    }
    if (!flagged && has.length) {
      bad.push(`${id}: 有远臂件 [${has}] 却没标 backArm——这些文件永远不会被加载`);
    }
  }
  expect(bad, `远臂件与 backArm 标记对不上：\n${bad.join('\n')}`).toEqual([]);
});
