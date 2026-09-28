const { execSync } = require('child_process');
const g = 'C:/Users/Gjy_2/AppData/Local/Programs/MinGit/mingw64/bin/git.exe';
// 孤儿分支重建：以当前 index（53 文件、无 promo）为全新 initial commit
execSync(`${g} checkout --orphan rebuilt-main`, { stdio: 'pipe' });
execSync(`${g} add -A`, { stdio: 'pipe' });
execSync(`${g} commit -m "feat: initial commit for riichi-mahjong-scoreboard"`, { stdio: 'pipe' });
console.log('orphan commit:', execSync(`${g} log --oneline -1`).toString().trim());
const rootFiles = execSync(`${g} ls-tree -r --name-only HEAD`).toString().split('\n').filter(Boolean);
console.log('files in new root:', rootFiles.length);
console.log('promo files in new root:', rootFiles.filter(f => /promo|video_materials/.test(f)).length);
