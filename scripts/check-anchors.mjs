// 源码扫描式断言的锚点体检。
//
// 本会话连着三次栽在同一件事上：断言去源码里搜一段文字，而那段文字在目标文件里
// **不止一处**——于是守的是另一行代码，把真正想守的那一处摘掉照样绿。
//   · 选人页招式表：skillSlotFor(r.dir) 有两处（无障碍标签 + 看得见的表格）
//   · 结算页败北台词：vsLose?.[ 有两处（玩家赢 / 玩家输两条分支）
//   · 菜单音乐：scene.s !== 'fight' 有两处（音乐 + 菜单背景 MenuBackdrop）
//
// 跑法：node scripts/check-anchors.mjs
// 输出里 n>1 的要么收紧锚点、要么改成测渲染结果；n=0 的多半是"断言不存在"
//（.toBe(false)），那是正常的。
import fs from 'fs';
import path from 'path';
// .tsx 也要扫：漏掉它等于把带 JSX 的那几个测试文件整个排除在体检之外
// （help-layout.test.tsx 就是一个，它里头正有跨文件的字符串锚点）
const files = fs.readdirSync('tests').filter(f => /\.(ts|tsx|mjs)$/.test(f));
const rows = [];
for (const f of files) {
  const src = fs.readFileSync(path.join('tests', f), 'utf8');
  const vars = new Map();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'([^']+)\?raw'/g)) vars.set(m[1], m[2].replace(/^\.\.\//, ''));
  if (!vars.size) continue;
  const cache = new Map();
  const targetOf = (v) => {
    const rel = vars.get(v);
    if (!cache.has(rel)) cache.set(rel, fs.readFileSync(rel, 'utf8'));
    return cache.get(rel);
  };
  for (const line of src.split('\n')) {
    // 形式一：<var>.includes('X')
    for (const m of line.matchAll(/(\w+)\.includes\('([^']+)'\)/g)) {
      if (!vars.has(m[1])) continue;
      rows.push([targetOf(m[1]).split(m[2]).length - 1, f, `includes  ${m[2]}`]);
    }
    // 形式一之二：<var>.indexOf('X')  —— 切小节常用这个
    for (const m of line.matchAll(/(\w+)\.indexOf\('([^']+)'\)/g)) {
      if (!vars.has(m[1])) continue;
      rows.push([targetOf(m[1]).split(m[2]).length - 1, f, `indexOf   ${m[2]}`]);
    }
    // 形式二：/RE/.test(<var>) 与 /RE/.exec(<var>)
    // exec 尤其要盯：它命中多处时**静默返回第一处**，而 test 至少只回真假
    for (const m of line.matchAll(/\/(.+?)\/[gimsuy]*\.(?:test|exec)\((\w+)\)/g)) {
      if (!vars.has(m[2])) continue;
      let n = -1;
      try { n = (targetOf(m[2]).match(new RegExp(m[1], 'g')) ?? []).length; } catch {}
      rows.push([n, f, `regex     ${m[1].slice(0, 50)}`]);
    }
  }
}
rows.sort((a, b) => b[0] - a[0]);
const bad = rows.filter(r => r[0] !== 1);
for (const [n, f, what] of bad) console.log(`${String(n).padStart(3)}  ${f.padEnd(26)} ${what}`);
console.log(`--- 共 ${rows.length} 条，非唯一(或匹配 0/失败) ${bad.length} 条`);
