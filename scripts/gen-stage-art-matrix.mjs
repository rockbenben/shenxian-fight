/**
 * 关卡远景出图（MiniMax Matrix 通道）：一次把十二张远景画完，落到 _raw/stages/<id>.png。
 *
 * 为什么有两个生成脚本：出图通道有两条，各有各的门槛。
 *  · 本脚本（Matrix）：一条命令就能跑，批量十张一次，但要账号有额度；
 *  · scripts/gen-stage-art.py（Gemini 网页）：走仓库既有的 CDP 管线，额度在 Google 账号上。
 * 两边出的是同一样东西——**提示词与关卡清单共用 scripts/stage-art.json**，不各写一份。
 * 后处理（裁切/羽化/压 webp）也共用 gen-stage-art.py 里的 postprocess()。
 *
 * 用法：
 *   node scripts/gen-stage-art-matrix.mjs           # 续跑（已存在跳过）
 *   node scripts/gen-stage-art-matrix.mjs nezha     # 点名重出
 *
 * 出图（烧额度）与后处理（可重跑）必须解耦：原生分辨率先落 _raw/，
 * 改裁切或改配色时重跑后处理即可，不该再出一张图。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '_raw', 'stages');
fs.mkdirSync(RAW, { recursive: true });

const { style, stages } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'stage-art.json'), 'utf8'));

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
    requests: batch.map(s => ({
      prompt: `${style} A ${s.place}. ${s.detail}.`,
      aspect_ratio: '16:9',
      resolution: '2K',
      output_file: `${s.id}.png`,
    })),
  };
  const argsFile = path.join(RAW, `.args-${batch.map(s => s.id).join('-')}.json`);
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

const force = new Set(process.argv.slice(2));
const todo = stages.filter(s => force.has(s.id) || !fs.existsSync(path.join(RAW, `${s.id}.png`)));
if (todo.length === 0) {
  console.log('十二张都已在 _raw/stages/，没什么要出的');
  process.exit(0);
}
console.log(`待出 ${todo.length} 张：${todo.map(s => s.id).join(' ')}`);

const BATCH = 10;
const done = [];
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  console.log(`--- 第 ${i / BATCH + 1} 批：${batch.map(s => s.id).join(' ')}`);
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
    const stage = batch.find(s => s.id === stem) ?? batch.find(s => (it.file_name ?? '').startsWith(s.id));
    if (!stage) { console.warn(`对不上号的产物，跳过：${it.file_name}`); continue; }
    try {
      const dest = await download(it.node_id, path.join(RAW, stage.id));
      const kb = Math.round(fs.statSync(dest).size / 1024);
      done.push(stage.id);
      console.log(`  ✓ ${stage.id} → ${path.relative(ROOT, dest)} (${kb}KB)`);
    } catch (e) {
      // **node_id 要打出来**：图已经生成、额度已经花了，下载失败只是本地这一步的问题。
      // 记下 node_id 就能用 `mcode-tools get_asset_url <node_id>` 单独重取，不必再出一张
      console.error(`  ✗ ${stage.id} 下载失败：${e.message}  node_id=${it.node_id}`);
    }
  }
}
console.log(`完成 ${done.length}/${todo.length}：${done.join(' ')}`);
