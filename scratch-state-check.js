const { execSync } = require('child_process');
const g = 'C:/Users/Gjy_2/AppData/Local/Programs/MinGit/mingw64/bin/git.exe';
const files = execSync(`${g} ls-files`).toString().split('\n').filter(Boolean);
console.log('index 文件数:', files.length);
console.log('promo 残留:', files.filter(f => /promo|video_materials|build_promo/.test(f)).length);
console.log('HEAD:', execSync(`${g} log --oneline -1`).toString().trim());
