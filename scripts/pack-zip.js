const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const bundleDir = path.join(rootDir, 'release-bundle-tmp');

// Parse target: --target=server | --target=lan | --target=standard (default: lan)
const args = process.argv.slice(2);
const targetArg = args.find(a => a.startsWith('--target='));
const rawTarget = targetArg ? targetArg.split('=')[1].toLowerCase() : (process.env.TARGET_ENV || 'lan');
const isServer = rawTarget === 'server';
const isLan = rawTarget === 'lan' || rawTarget === 'standard';

// Modular compile/packaging selections
const securityArg = args.find(a => a.startsWith('--security='));
const noSecurity = args.includes('--no-security') || (securityArg && securityArg.split('=')[1] === 'false');
const noModules = args.includes('--no-modules');

const zipFileName = isServer ? 'riichi-scoreboard-server-release.zip' : 'riichi-scoreboard-lan-release.zip';
const zipFile = path.join(rootDir, zipFileName);

console.log(`[PACK] Packaging target: ${isServer ? 'SERVER (public server extensions & security mounted)' : 'LAN (direct business throughput, modules decoupled)'}`);
if (noSecurity) console.log('[PACK] Security module: Physically EXCLUDED via flag');
if (noModules) console.log('[PACK] Modules directory: Physically EXCLUDED via flag');

console.log('1. Building frontend assets for target...');
const buildCmd = isServer ? 'npm run build:server --prefix frontend' : 'npm run build --prefix frontend';
execSync(buildCmd, { cwd: rootDir, stdio: 'inherit' });

console.log('2. Preparing streamlined bundle for release...');
if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
fs.mkdirSync(bundleDir, { recursive: true });

// 仅保留 Termux / Linux 测试必需的核心文件（排除 start.sh、Windows .bat、README 等无关文件）
const coreFiles = ['server.js'];
if (!noSecurity) {
  coreFiles.push('security-guard.js');
}
if (isServer && !noModules) {
  coreFiles.push('server-extension.js');
}
for (const f of coreFiles) {
  if (fs.existsSync(path.join(rootDir, f))) {
    fs.copyFileSync(path.join(rootDir, f), path.join(bundleDir, f));
  }
}

// 精简版 package.json (仅保留生产运行时依赖与启动命令，避免污染根目录)
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const minimalPkg = {
  name: rootPkg.name || 'riichi-mahjong-scoreboard',
  version: rootPkg.version || '1.0.0',
  private: true,
  main: 'server.js',
  scripts: {
    start: isServer
      ? "node -e \"process.env.TARGET_ENV='server'; require('./server.js');\""
      : 'node server.js'
  },
  dependencies: rootPkg.dependencies || {
    cors: '^2.8.5',
    express: '^4.21.2',
    'socket.io': '^4.8.1'
  }
};
fs.writeFileSync(path.join(bundleDir, 'package.json'), JSON.stringify(minimalPkg, null, 2) + '\n', 'utf8');

// 复制前端产物并过滤冗余旧格式字体（排除 .woff，保留现代全兼容的 .woff2）
function copyDistStreamlined(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDistStreamlined(srcPath, destPath);
    } else {
      if (entry.name.endsWith('.woff')) continue;
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const distSrc = path.join(rootDir, 'frontend', 'dist');
const distDest = path.join(bundleDir, 'frontend', 'dist');
copyDistStreamlined(distSrc, distDest);

console.log(`3. Creating zip archive: ${zipFileName}...`);
if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile);
execSync(`tar -a -cf ${zipFileName} -C release-bundle-tmp .`, { cwd: rootDir });

console.log('4. Cleaning up temporary bundle dir...');
fs.rmSync(bundleDir, { recursive: true, force: true });

const stat = fs.statSync(zipFile);
console.log('Finished! Output:', zipFile, 'Size:', (stat.size / 1024 / 1024).toFixed(2), 'MB');
