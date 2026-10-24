/**
 * 全身角色图出图（Matrix 通道）：一个角色从头到脚一张，落到 _raw/<id>_full.png。
 *
 * 为什么要有这条：躯干画、四肢程序化圆柱 —— 两种画法并排，关节永远对不上
 * （这一路都在治它）。整人一张、之后在关节处切开，接缝由切的位置保证，
 * 两半也出自同一张画，风格天然一致。
 *
 * 提示词在 scripts/fullbody-prompts.json（由 design-preview/tools/make-fullbody-prompts.py
 * 从 scripts/char-art.json 的头/身描述合成，不另写一份）。
 *
 * 用法：node scripts/gen-fullbody-matrix.mjs [角色id...]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '_raw');
fs.mkdirSync(RAW, { recursive: true });

const { style, contract, items } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts', 'fullbody-prompts.json'), 'utf8'),
);

function mcode(args) {
  const quoted = args.map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return execFileSync('mcode-tools', quoted, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
  });
}

async function download(nodeId, destBase) {
  const urlJson = JSON.parse(mcode(['get_asset_url', nodeId]));
  if (!urlJson.download_url) throw new Error(`拿不到下载地址：${JSON.stringify(urlJson)}`);
  const res = await fetch(urlJson.download_url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  fs.writeFileSync(`${destBase}.png`, Buffer.from(await res.arrayBuffer()));
  return `${destBase}.png`;
}

const force = new Set(process.argv.slice(2));
const jobs = items.filter(i => force.has(i.id) || !fs.existsSync(path.join(RAW, `${i.id}_full.png`)));
if (!jobs.length) {
  console.log('要出的都已在 _raw/，没什么要出的');
  process.exit(0);
}
console.log(`待出 ${jobs.length} 张：${jobs.map(j => j.id).join(' ')}`);

const BATCH = 8;
const done = [];
for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  const payload = {
    requests: batch.map(j => ({
      prompt: `${style}${contract}${j.desc}`,
      aspect_ratio: '2:3',
      resolution: '2K',
      output_file: `${j.id}_full.png`,
    })),
  };
  const argsFile = path.join(RAW, `.args-full-${batch.map(j => j.id).join('-')}.json`);
  fs.writeFileSync(argsFile, JSON.stringify(payload), 'utf8');
  let out;
  try {
    out = mcode(['connector', 'call', 'connector__matrix__generate_image', '--args-file', argsFile]);
  } catch (e) {
    console.error(`第 ${i / BATCH + 1} 批失败：${e.message}`);
    console.error(`已出 ${done.length} 张：${done.join(' ')}`);
    process.exit(2);
  } finally {
    fs.rmSync(argsFile, { force: true });
  }
  let json;
  try { json = JSON.parse(out); } catch {
    throw new Error(`生成返回的不是 JSON：\n${out.slice(0, 500)}`);
  }
  if (json.code && json.code !== 0) {
    console.error(`生成报错 code=${json.code} message=${json.message}`);
    process.exit(2);
  }
  for (const it of json.success_items ?? []) {
    const stem = String(it.file_name ?? '').replace(/\.[^.]+$/, '');
    const job = batch.find(j => stem === `${j.id}_full`) ?? batch.find(j => (it.file_name ?? '').startsWith(j.id));
    if (!job) { console.warn(`对不上号的产物，跳过：${it.file_name}`); continue; }
    try {
      const dst = await download(it.node_id, path.join(RAW, `${job.id}_full`));
      done.push(job.id);
      console.log(`  ✓ ${job.id} → ${path.relative(ROOT, dst)}`);
    } catch (e) {
      console.error(`  ✗ ${job.id} 下载失败：${e.message}  node_id=${it.node_id}`);
    }
  }
}
console.log(`完成 ${done.length}/${jobs.length}：${done.join(' ')}`);
