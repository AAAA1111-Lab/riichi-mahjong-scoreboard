// 区分“快照干净”与“历史干净”：列出每个远端 ref 的完整历史中 promo 提交数
const { execSync } = require('child_process');
const g = 'C:/Users/Gjy_2/AppData/Local/Programs/MinGit/mingw64/bin/git.exe';
const refs = ['origin/main', 'origin/release', 'origin/release-server'];
for (const r of refs) {
  const log = execSync(`${g} log ${r} --oneline -- assets/promo-video.mp4 scripts/build_promo_video.js assets/video_materials`).toString().split('\n').filter(Boolean);
  console.log(r, '-> 历史中 promo 提交数:', log.length, log.length ? '(' + log.join(', ') + ')' : '');
}
// tags 的历史
for (const t of ['v0.0.0', 'v3.20.0']) {
  const log = execSync(`${g} log ${t} --oneline -- assets/promo-video.mp4 scripts/build_promo_video.js`).toString().split('\n').filter(Boolean);
  console.log(t, '-> 历史中 promo 提交数:', log.length);
}
