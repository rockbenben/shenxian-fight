/**
 * 角色部件重出（MiniMax Matrix 通道）：落到 _raw/<id>_<part>.png。
 *
 * 为什么有这条脚本：老管线（scripts/gen-parts.py，Gemini 网页）出的是**渐隐的半身像**——
 * 提示词明明写着"只要头和脖子"，模型还是给每张都画到了胸口再淡出。挂载时头贴图的下缘
 * 是那团淡出的肩胸，下巴与脖子之间始终隔着一段背景，头看着就浮在身上。
 * 同一批次的躯干也是旧的（另一个管线出的），头与躯干的精度对不齐。
 *
 * **素材契约**在 scripts/char-art.json 的 contracts 字段：
 *   头   —— 只到脖子、脖子处切干净末端淡出、配件不出画幅、脸不被遮、**头填满画幅**；
 *   躯干 —— 肩线贴上边、腰贴下边（填满画幅）、三分侧身朝右、无袖、绝不摊开。
 * 另有一条**逐个角色写死**的：面部毛发（谁有胡子、谁必须没有）与"设定相近的角色
 * 必须给互相不重叠的硬特征"（哪吒黑髻 vs 红孩儿火焰竖发）。
 *
 * 用法：
 *   node scripts/gen-char-art-matrix.mjs                 # 续跑（已存在跳过）
 *   node scripts/gen-char-art-matrix.mjs --part=head     # 只出头
 *   node scripts/gen-char-art-matrix.mjs nezha           # 点名重出（头与躯干都出）
 *   node scripts/gen-char-art-matrix.mjs nezha --part=torso
 *
 * 出图（烧额度）与后处理（可重跑）必须解耦：原生分辨率先落 _raw/，
 * 改裁切时重跑 scripts/recut-chars.py 即可，不该再出一张图。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '_raw');
fs.mkdirSync(RAW, { recursive: true });

const { style, contracts, heads, torsos } =
  JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'char-art.json'), 'utf8'));

/** 部件 → 画幅比例（头 1:1，躯干 2:3） */
const ASPECT = { head: '1:1', torso: '2:3' };

function mcode(args) {
  // Windows 上 mcode-tools 是 .cmd 包装器：execFileSync 不带 shell 找不到它（ENOENT），
  // 所以走 shell。参数自己带引号——仓库路径里有空格时 shell 会把参数拆开。
  const quoted = args.map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return execFileSync('mcode-tools', quoted, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
  });
}

/** 出图。返回成功项列表 */
function generate(batch) {
  const payload = {
    requests: batch.map(j => ({
      prompt: `${style}${contracts[j.part]} ${j.desc}`,
      aspect_ratio: ASPECT[j.part],
      resolution: '2K',
      output_file: `${j.id}_${j.part}.png`,
    })),
  };
  const argsFile = path.join(RAW, `.args-char-${batch.map(j => `${j.id}_${j.part}`).join('-')}.json`);
  fs.writeFileSync(argsFile, JSON.stringify(payload), 'utf8');
  const out = mcode(['connector', 'call', 'connector__matrix__generate_image', '--args-file', argsFile]);
  fs.rmSync(argsFile, { force: true });
  let json;
  try { json = JSON.parse(out); } catch {
    throw new Error(`生成返回的不是 JSON：\n${out.slice(0, 500)}`);
  }
  // 业务错误在顶层 code/message，逐项结果在 success_items/failed_items——
  // 只看 success_items 会把「0 成功 0 失败」误读成正常返回
  if (json.code && json.code !== 0) {
    throw new Error(`生成报错 code=${json.code} message=${json.message}`);
  }
  if (json.failed_items && json.failed_items.length) {
    for (const f of json.failed_items) console.warn(`  ! 失败：${JSON.stringify(f).slice(0, 200)}`);
  }
  return json.success_items ?? [];
}

async function download(nodeId, destBase) {
  const urlJson = JSON.parse(mcode(['get_asset_url', nodeId]));
  if (!urlJson.download_url) throw new Error(`拿不到下载地址：${JSON.stringify(urlJson)}`);
  const res = await fetch(urlJson.download_url);
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = `${destBase}.png`;
  fs.writeFileSync(dest, buf);
  return dest;
}

const args = process.argv.slice(2);
const partArg = args.find(a => a.startsWith('--part='));
const onlyPart = partArg ? partArg.slice('--part='.length) : null;
const force = new Set(args.filter(a => !a.startsWith('--')));

const jobs = [
  ...heads.map(h => ({ id: h.id, part: 'head', desc: h.desc })),
  ...torsos.map(t => ({ id: t.id, part: 'torso', desc: t.desc })),
].filter(j => !onlyPart || j.part === onlyPart)
 .filter(j => force.has(j.id) || !fs.existsSync(path.join(RAW, `${j.id}_${j.part}.png`)));

if (jobs.length === 0) {
  console.log('要出的都已在 _raw/，没什么要出的');
  process.exit(0);
}
console.log(`待出 ${jobs.length} 张：${jobs.map(j => `${j.id}_${j.part}`).join(' ')}`);

const BATCH = 8;
const done = [];
for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  console.log(`--- 第 ${i / BATCH + 1} 批：${batch.map(j => `${j.id}_${j.part}`).join(' ')}`);
  let items;
  try {
    items = generate(batch);
  } catch (e) {
    // 配额用尽（402）时整轮停：继续提交只会空转
    console.error(`第 ${i / BATCH + 1} 批失败：${e.message}`);
    console.error(`已出 ${done.length} 张：${done.join(' ')}`);
    process.exit(2);
  }
  // file_name 的扩展名不固定（.png/.jpg 混），按 stem 对回 id
  for (const it of items) {
    const stem = String(it.file_name ?? '').replace(/\.[^.]+$/, '');
    const job = batch.find(j => stem === `${j.id}_${j.part}`)
      ?? batch.find(j => (it.file_name ?? '').startsWith(j.id));
    if (!job) { console.warn(`对不上号的产物，跳过：${it.file_name}`); continue; }
    try {
      const dest = await download(it.node_id, path.join(RAW, `${job.id}_${job.part}`));
      const kb = Math.round(fs.statSync(dest).size / 1024);
      done.push(`${job.id}_${job.part}`);
      console.log(`  ✓ ${job.id}_${job.part} → ${path.relative(ROOT, dest)} (${kb}KB)`);
    } catch (e) {
      // **node_id 要打出来**：图已经生成、额度已经花了，下载失败只是本地这一步的问题。
      // 记下 node_id 就能用 `mcode-tools get_asset_url <node_id>` 单独重取，不必再出一张
      console.error(`  ✗ ${job.id}_${job.part} 下载失败：${e.message}  node_id=${it.node_id}`);
    }
  }
}
console.log(`完成 ${done.length}/${jobs.length}：${done.join(' ')}`);
