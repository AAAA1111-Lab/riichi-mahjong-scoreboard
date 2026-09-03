const fs = require('fs');
const path = require('path');

/**
 * 自动化代码版本备份脚本
 * 用法: node scripts/backup.js [版本号] [版本描述]
 * 示例: node scripts/backup.js v2.91 "REXX结算拟物椭圆LED与HUD局况栏对齐"
 */

const rootDir = path.resolve(__dirname, '..');
const backupsDir = path.join(rootDir, 'backups');
const snapshotsDir = path.join(backupsDir, 'snapshots');
const indexFile = path.join(backupsDir, 'BACKUP_INDEX.md');

// 获取版本号与描述
const args = process.argv.slice(2);
const version = args[0] || 'v2.91';
const description = args[1] || '当前稳定版本代码全量快照归档';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const snapshotName = `${version}_${dateStr}`;
const targetDir = path.join(snapshotsDir, snapshotName);

console.log(`[Backup] 正在为版本 ${version} 创建代码快照...`);
console.log(`[Backup] 目标目录: ${targetDir}`);

// 确保目录存在
fs.mkdirSync(targetDir, { recursive: true });

// 需要备份的关键文件/目录列表
const itemsToBackup = [
  { src: 'server.js', isDir: false },
  { src: 'package.json', isDir: false },
  { src: 'package-lock.json', isDir: false },
  { src: 'start-server.bat', isDir: false },
  { src: '.gitignore', isDir: false },
  { src: 'frontend/package.json', isDir: false },
  { src: 'frontend/index.html', isDir: false },
  { src: 'frontend/vite.config.ts', isDir: false },
  { src: 'frontend/tsconfig.json', isDir: false },
  { src: 'frontend/tsconfig.node.json', isDir: false },
  { src: 'frontend/src', isDir: true }
];

// 递归复制目录
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

let backedUpCount = 0;

for (const item of itemsToBackup) {
  const fullSrc = path.join(rootDir, item.src);
  const fullDest = path.join(targetDir, item.src);

  if (fs.existsSync(fullSrc)) {
    if (item.isDir) {
      copyDirRecursive(fullSrc, fullDest);
    } else {
      const destDir = path.dirname(fullDest);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(fullSrc, fullDest);
    }
    backedUpCount++;
  } else {
    console.warn(`[Backup] 提示: 文件或目录不存在，已跳过: ${item.src}`);
  }
}

console.log(`[Backup] 核心文件复制完成，共备份 ${backedUpCount} 项。`);

// 创建快照专属的元数据说明文件
const metaContent = `# 版本快照元数据 (Snapshot Metadata)
- **版本号**: ${version}
- **快照时间**: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
- **快照目录**: ${snapshotName}
- **变更描述**: ${description}

## 恢复指南 (Restore Instructions)
如需将项目回滚至本版本，请将本目录下的所有文件直接覆盖至项目根目录即可。
`;

fs.writeFileSync(path.join(targetDir, 'SNAPSHOT_META.md'), metaContent, 'utf-8');

// 更新或创建 BACKUP_INDEX.md
let indexHeader = `# 计分板历史版本存档备份清单 (Backup Archive Index)

本文档记录了从建立备份机制起的所有历史版本快照归档信息，以便随时查阅、追溯与一键恢复。

---

| 版本号 (Version) | 归档时间 (Timestamp) | 快照目录 (Snapshot Path) | 变更说明 (Description) |
| :--- | :--- | :--- | :--- |
`;

let currentLog = `| **${version}** | ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} | [\`${snapshotName}\`](./snapshots/${snapshotName}/) | ${description} |\n`;

if (!fs.existsSync(indexFile)) {
  fs.writeFileSync(indexFile, indexHeader + currentLog, 'utf-8');
} else {
  const existingContent = fs.readFileSync(indexFile, 'utf-8');
  if (existingContent.includes(snapshotName)) {
    console.log('[Backup] 索引已存在该快照，无需重复追加。');
  } else {
    fs.appendFileSync(indexFile, currentLog, 'utf-8');
  }
}

console.log(`[Backup] 归档索引更新成功: ${indexFile}`);
console.log(`[Backup] ✅ 版本 ${version} 存档备份已全部完成！`);
