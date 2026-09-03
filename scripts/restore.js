const fs = require('fs');
const path = require('path');

const targetSnapshot = process.argv[2];
if (!targetSnapshot) {
  console.error('❌ 请提供要还原的快照名称，例如: node scripts/restore.js v3.73_20260829_222346');
  process.exit(1);
}

const rootDir = 'c:\\Users\\Gjy_2\\Documents\\Project';
const snapshotsBase = path.join(rootDir, 'backups', 'snapshots');

let resolvedSnapshot = targetSnapshot;
let snapshotDir = path.join(snapshotsBase, targetSnapshot);

if (!fs.existsSync(snapshotDir) && fs.existsSync(snapshotsBase)) {
  const allSnapshots = fs.readdirSync(snapshotsBase);
  const matched = allSnapshots.filter(s => s === targetSnapshot || s.startsWith(targetSnapshot + '_') || s.startsWith(targetSnapshot));
  if (matched.length > 0) {
    resolvedSnapshot = matched[matched.length - 1]; // 取最新匹配
    snapshotDir = path.join(snapshotsBase, resolvedSnapshot);
  }
}

if (!fs.existsSync(snapshotDir)) {
  console.error(`❌ 快照目录不存在: ${snapshotDir}`);
  process.exit(1);
}

console.log(`[Restore] 正在从快照 ${resolvedSnapshot} 还原项目...`);

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const items = fs.readdirSync(src);
    for (const item of items) {
      if (item === 'node_modules' || item === 'dist' || item === '.git' || item === 'SNAPSHOT_META.md') continue;
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// 还原核心文件
const items = fs.readdirSync(snapshotDir);
for (const item of items) {
  if (item === 'SNAPSHOT_META.md') continue;
  const src = path.join(snapshotDir, item);
  const dest = path.join(rootDir, item);
  copyRecursive(src, dest);
  console.log(`  - 已还原: ${item}`);
}

console.log(`✅ 快照 ${targetSnapshot} 还原完成！`);
