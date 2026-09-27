const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

// Helper: recursive copy with optional filter
function copyDirFiltered(srcDir, destDir, filterFn) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (filterFn && !filterFn(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath, filterFn);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Helper: cross-platform zip creation
function createZip(sourceDir, zipFilePath) {
  if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
  if (process.platform === 'win32') {
    execSync(`tar -a -cf "${zipFilePath}" -C "${sourceDir}" .`, { stdio: 'inherit' });
  } else {
    try {
      execSync(`(cd "${sourceDir}" && zip -r -q "${zipFilePath}" .) `, { stdio: 'inherit' });
    } catch (e) {
      execSync(`tar -a -cf "${zipFilePath}" -C "${sourceDir}" .`, { stdio: 'inherit' });
    }
  }
}

function packageTarget(target, keepDir = false) {
  const isServer = target === 'server';
  const targetLabel = isServer ? 'SERVER (Public Server Mode)' : 'LAN (Local Area Network Mode)';
  const zipFileName = isServer ? 'riichi-scoreboard-server-release.zip' : 'riichi-scoreboard-lan-release.zip';
  const zipFilePath = path.join(rootDir, zipFileName);
  const bundleDirName = isServer ? 'release-bundle-server' : 'release-bundle-lan';
  const bundleDir = path.join(rootDir, bundleDirName);

  console.log(`\n==================================================`);
  console.log(`[PACK] Building Clean Package: ${targetLabel}`);
  console.log(`==================================================`);

  // 1. Build frontend assets for this target
  console.log(`1. Compiling frontend assets for ${isServer ? 'server' : 'lan'}...`);
  const buildCmd = isServer
    ? 'npm run build:server --prefix frontend'
    : 'npm run build --prefix frontend';
  execSync(buildCmd, { cwd: rootDir, stdio: 'inherit' });

  // 2. Prepare clean bundle folder
  console.log(`2. Assembling clean runtime files into ${bundleDirName}...`);
  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
  fs.mkdirSync(bundleDir, { recursive: true });

  // 2.1 Backend runtime files
  const coreFiles = ['server.js', 'README.md'];
  if (isServer) {
    coreFiles.push('security-guard.js', 'server-extension.js', 'multi-room.js');
    coreFiles.push('start-server.bat', 'start-server.sh');
  } else {
    coreFiles.push('start-lan.bat', 'start-lan.sh');
  }

  for (const f of coreFiles) {
    const src = path.join(rootDir, f);
    if (fs.existsSync(src)) {
      const dest = path.join(bundleDir, f);
      fs.copyFileSync(src, dest);
      if (f.endsWith('.sh') && process.platform !== 'win32') {
        try { fs.chmodSync(dest, 0o755); } catch (e) {}
      }
    }
  }

  // 2.2 Entrypoint startup script (start.sh)
  const startShPath = path.join(bundleDir, 'start.sh');
  const targetScript = isServer ? './start-server.sh' : './start-lan.sh';
  const startShContent = `#!/bin/sh\n# Riichi Mahjong Scoreboard - Forwarder to ${isServer ? 'start-server.sh' : 'start-lan.sh'}\ncd "$(dirname "$0")" || exit 1\nexec ${targetScript} "$@"\n`;
  fs.writeFileSync(startShPath, startShContent, { mode: 0o755 });

  // 2.3 Assets folder (preview image for README)
  const assetsSrc = path.join(rootDir, 'assets');
  if (fs.existsSync(assetsSrc)) {
    copyDirFiltered(assetsSrc, path.join(bundleDir, 'assets'));
  }

  // 2.4 Streamlined production package.json
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const minimalPkg = {
    name: isServer ? 'riichi-mahjong-scoreboard-server' : 'riichi-mahjong-scoreboard-lan',
    version: rootPkg.version || '1.0.0',
    description: `Riichi Mahjong Scoreboard (${isServer ? 'Server Mode' : 'LAN Mode'})`,
    license: 'GPL-3.0',
    private: true,
    main: 'server.js',
    scripts: isServer
      ? {
          start: 'node server.js --target=server',
          'start:server': 'node server.js --target=server'
        }
      : {
          start: 'node server.js',
          'start:lan': 'node server.js'
        },
    dependencies: rootPkg.dependencies || {
      cors: '^2.8.5',
      express: '^4.21.2',
      'socket.io': '^4.8.1'
    }
  };
  fs.writeFileSync(path.join(bundleDir, 'package.json'), JSON.stringify(minimalPkg, null, 2) + '\n', 'utf8');

  // 2.5 Copy frontend/dist, filtering out .woff to keep package clean & lightweight
  const distSrc = path.join(rootDir, 'frontend', 'dist');
  const distDest = path.join(bundleDir, 'frontend', 'dist');
  copyDirFiltered(distSrc, distDest, (srcPath, entry) => {
    if (entry.name.endsWith('.woff')) return false;
    if (entry.name.startsWith('.target_')) return false;
    return true;
  });

  // Write exact target marker in bundle
  const markerName = isServer ? '.target_server' : '.target_lan';
  fs.writeFileSync(path.join(distDest, markerName), `${isServer ? 'server' : 'lan'}\n`, 'utf8');

  // 3. Create Zip Archive
  console.log(`3. Creating compressed archive: ${zipFileName}...`);
  createZip(bundleDir, zipFilePath);

  // 4. Cleanup if not keeping bundle directory
  if (!keepDir) {
    console.log(`4. Cleaning up temporary directory ${bundleDirName}...`);
    fs.rmSync(bundleDir, { recursive: true, force: true });
  } else {
    console.log(`4. Kept bundle directory: ${bundleDirName}`);
  }

  const stat = fs.statSync(zipFilePath);
  console.log(`[PACK COMPLETE] ${zipFileName} (${(stat.size / 1024 / 1024).toFixed(2)} MB)\n`);
}

function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find(a => a.startsWith('--target='));
  const rawTarget = targetArg ? targetArg.split('=')[1].toLowerCase() : (process.env.TARGET_ENV || 'all');
  const keepDir = args.includes('--keep-dir');

  if (rawTarget === 'lan' || rawTarget === 'standard') {
    packageTarget('lan', keepDir);
  } else if (rawTarget === 'server') {
    packageTarget('server', keepDir);
  } else {
    // Default or --target=all: build and package both!
    packageTarget('lan', keepDir);
    packageTarget('server', keepDir);
  }
}

main();
