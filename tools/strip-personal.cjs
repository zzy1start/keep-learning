#!/usr/bin/env node
/* ============================================================
 * strip-personal.cjs — 从 data/content 中移除个人导入内容（mine:true）
 *
 * 开源发布前必须做：data/content/*.json 里可能包含用户自己导入的真题/作文，
 * 这些内容不能随公开仓库分发。构建脚本 tools/build-android.cjs 只在打包时剔除，
 * 源码里仍在；本脚本直接清理源码，并把原文件备份到 work/personal-content-backup/。
 *
 * 用法：
 *   node tools/strip-personal.cjs --dry     只统计，不改文件
 *   node tools/strip-personal.cjs --apply   备份并清理
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'data', 'content');
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, 'work', 'personal-content-backup', stamp);

function filterNode(node, trail, removed) {
  if (Array.isArray(node)) {
    const out = [];
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      if (item && typeof item === 'object' && item.mine === true) {
        removed.push({ path: trail + '[' + i + ']', id: item.id, title: item.title || item.number || '' });
        continue;
      }
      out.push(filterNode(item, trail + '[' + i + ']', removed));
    }
    return out;
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = filterNode(v, trail + '.' + k, removed);
    return out;
  }
  return node;
}

if (!fs.existsSync(CONTENT)) {
  console.error('data/content 不存在');
  process.exit(1);
}
let totalRemoved = 0;
const files = fs.readdirSync(CONTENT).filter(f => f.endsWith('.json')).sort();
for (const name of files) {
  const fp = path.join(CONTENT, name);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (e) { console.error('跳过无法解析：' + name + '：' + e.message); continue; }
  const removed = [];
  const cleaned = filterNode(raw, '', removed);
  if (!removed.length) {
    console.log('  ' + name + '：无 mine:true');
    continue;
  }
  totalRemoved += removed.length;
  console.log('  ' + name + '：移除 ' + removed.length + ' 条');
  for (const r of removed.slice(0, 8)) console.log('    - ' + (r.id || r.path) + ' ' + (r.title || ''));
  if (removed.length > 8) console.log('    ... 其余 ' + (removed.length - 8) + ' 条');
  if (!DRY) {
    const bdir = path.join(BACKUP, name.replace(/\.json$/, ''));
    fs.mkdirSync(bdir, { recursive: true });
    fs.copyFileSync(fp, path.join(bdir, name + '.bak'));
    fs.writeFileSync(fp, JSON.stringify(cleaned, null, 2) + '\n');
  }
}
if (!totalRemoved) {
  console.log('没有需要清理的 mine:true 内容。');
  process.exit(0);
}
if (DRY) {
  console.log('\n[DRY] 共发现 ' + totalRemoved + ' 条；加 --apply 才会备份并清理。');
} else {
  console.log('\n[APPLY] 共清理 ' + totalRemoved + ' 条；备份目录：' + BACKUP);
}
