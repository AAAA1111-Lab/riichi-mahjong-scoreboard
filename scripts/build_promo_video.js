/**
 * Riichi Mahjong Scoreboard - Promotional Video Generator
 * 
 * Auto-generates a high-definition vertical promo video (1080x2340 @ 30fps)
 * featuring:
 * 1. Server Lobby with dynamic entrance and numeric keypad typing animation
 * 2. Room screen comparisons (LAN mode vs Server mode)
 * 3. Main scoreboard screen
 * 4. Hand input modal (荣和/自摸/满贯番符录入)
 * 5. Rule customization settings
 * 6. Quick QR Code sharing
 * 7. 5 Official Theme Showcases (Light, Dark, REXX, Electronic, MajSoul)
 * 8. End-game settlement table & point transition statistics
 * 
 * Designed for mobile vertical display with clean glassmorphic typography
 * and smooth cross-dissolve transitions. Audio is omitted by design.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(PROJECT_ROOT, 'scratch', 'video_temp');
const SLIDES_DIR = path.join(PROJECT_ROOT, 'scratch', 'rendered_slides');
const OUTPUT_VIDEO = path.join(PROJECT_ROOT, 'assets', 'promo-video.mp4');

// Scene Definitions
const SCENE_METADATA = [
  {
    id: '01_lobby_bg',
    badge: '01',
    title: '服务器模式 · 对局大厅',
    subtitle: '极简居中设计 · 5位房间号快速加入',
    isTemplateOnly: true
  },
  {
    id: '02a_room_lan',
    badge: '02',
    title: '局域网版 · 席位认领',
    subtitle: '轻量即开即用 · 自由选位与随机摸风',
    img: 'assets/video_materials/lan01.png',
    duration: 2.6
  },
  {
    id: '02b_room_server',
    badge: '02',
    title: '服务器版 · 专属房间',
    subtitle: '专属5位房间号 · 房主控场与准备锁定',
    img: 'assets/video_materials/server01.png',
    duration: 2.6
  },
  {
    id: '03_scoreboard',
    badge: '03',
    title: '对局主计分板',
    subtitle: '移动端专属适配 · 局况与四家点数实时同步',
    img: 'assets/video_materials/light01.png',
    duration: 3.0
  },
  {
    id: '04_hand_input',
    badge: '04',
    title: '快捷和牌录分',
    subtitle: '常见番符一键录入 · 自摸荣和变更实时预览',
    img: 'assets/video_materials/light02.png',
    duration: 3.0
  },
  {
    id: '05_settings',
    badge: '05',
    title: '规则全面自定义',
    subtitle: '四麻/三麻 · 半庄/东风 · 击飞与西入高级选项',
    img: 'assets/video_materials/light03.png',
    duration: 3.0
  },
  {
    id: '06_share',
    badge: '06',
    title: '扫码极速联机',
    subtitle: '局域网二维码即扫即入 · 自动识别本机地址',
    img: 'assets/video_materials/light05.png',
    duration: 3.0
  },
  {
    id: '07a_theme_light',
    badge: '07',
    title: '多主题 · 经典浅色',
    subtitle: '清爽直观 · 移动端标准视觉风格',
    img: 'assets/video_materials/light01.png',
    duration: 1.3
  },
  {
    id: '07b_theme_dark',
    badge: '07',
    title: '多主题 · 暗色护眼',
    subtitle: '暗色背景 · 沉浸专注不刺眼',
    img: 'assets/video_materials/dark01.png',
    duration: 1.3
  },
  {
    id: '07c_theme_rexx',
    badge: '07',
    title: '多主题 · 雀友REXX',
    subtitle: '硬核复古 · 还原线下实体数码管桌感',
    img: 'assets/video_materials/rexx01.png',
    duration: 1.3
  },
  {
    id: '07d_theme_electronic',
    badge: '07',
    title: '多主题 · 电子液晶',
    subtitle: '7段数码管发光字 · 实时排位指示',
    img: 'assets/video_materials/eletron01.png',
    duration: 1.3
  },
  {
    id: '07e_theme_majsoul',
    badge: '07',
    title: '多主题 · 雀魂和风',
    subtitle: '樱花落瓣纹饰 · 典雅和风书法设计',
    img: 'assets/video_materials/soul01.png',
    duration: 1.8
  },
  {
    id: '08_settlement',
    badge: '08',
    title: '对局终局结算',
    subtitle: '各家排位总览 · 各局点数推移明细一览',
    img: 'assets/video_materials/light06.png',
    duration: 3.5
  }
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function renderSlideFrames() {
  console.log('[1/4] Rendering composite slide frames with Playwright...');
  ensureDir(SLIDES_DIR);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1080, height: 2340 },
    deviceScaleFactor: 1
  });

  for (const scene of SCENE_METADATA) {
    const outImg = path.join(SLIDES_DIR, `${scene.id}.png`);
    if (fs.existsSync(outImg)) {
      console.log(`  Frame already exists: ${scene.id}.png`);
      continue;
    }

    console.log(`  Rendering frame: ${scene.id}...`);
    let imgTag = '';
    if (!scene.isTemplateOnly && scene.img) {
      const fullPath = path.join(PROJECT_ROOT, scene.img);
      const imgBase64 = fs.readFileSync(fullPath).toString('base64');
      const imgSrc = 'data:image/png;base64,' + imgBase64;
      imgTag = `<img class="device-img" src="${imgSrc}" />`;
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1080px;
      height: 2340px;
      overflow: hidden;
      background: radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 60%, #020617 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding-top: 48px;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
    }

    .header-bar {
      width: 980px;
      height: 140px;
      background: rgba(30, 41, 59, 0.72);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1.5px solid rgba(255, 255, 255, 0.14);
      border-radius: 24px;
      padding: 0 28px;
      display: flex;
      align-items: center;
      gap: 22px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      margin-bottom: 24px;
      flex-shrink: 0;
    }
    .badge {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #fff;
      font-size: 24px;
      font-weight: 800;
      padding: 8px 18px;
      border-radius: 14px;
      letter-spacing: 1px;
      box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .title {
      color: #f8fafc;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 21px;
      font-weight: 500;
    }

    .device-container {
      width: 980px;
      height: 2080px;
      position: relative;
      border-radius: 36px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(255, 255, 255, 0.1);
      background: #0f172a;
    }
    .device-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="badge">${scene.badge}</div>
    <div class="info">
      <div class="title">${scene.title}</div>
      <div class="subtitle">${scene.subtitle}</div>
    </div>
  </div>
  <div class="device-container">
    ${imgTag}
  </div>
</body>
</html>
    `;

    await page.setContent(html);
    await page.waitForTimeout(150);
    await page.screenshot({ path: outImg });
  }

  await browser.close();
  console.log('  All frames ready.');
}

async function prepareScene1Video() {
  console.log('[2/4] Preparing Scene 1 animated video...');
  ensureDir(TEMP_DIR);

  const clip01Path = path.join(TEMP_DIR, 'clip_01.mp4');
  if (fs.existsSync(clip01Path)) {
    console.log('  clip_01.mp4 already composited.');
    return { path: clip01Path, duration: 4.5 };
  }

  const rawLobbyMp4 = path.join(TEMP_DIR, '01_lobby_animated.mp4');
  if (!fs.existsSync(rawLobbyMp4)) {
    throw new Error('Missing 01_lobby_animated.mp4! Please record lobby first.');
  }

  const bgImg = path.join(SLIDES_DIR, '01_lobby_bg.png');
  const cmd = `ffmpeg -y -loop 1 -i "${bgImg}" -ss 00:00:00.5 -t 4.5 -i "${rawLobbyMp4}" -filter_complex "[1:v]scale=980:2080[vscaled];[0:v][vscaled]overlay=x=50:y=212:shortest=1[vout]" -map "[vout]" -c:v libx264 -pix_fmt yuv420p -r 30 "${clip01Path}"`;
  execSync(cmd, { stdio: 'inherit' });
  return { path: clip01Path, duration: 4.5 };
}

function renderStaticClips() {
  console.log('[3/4] Encoding scene clips to MP4...');
  ensureDir(TEMP_DIR);

  const clips = [];
  clips.push({ id: '01', path: path.join(TEMP_DIR, 'clip_01.mp4'), duration: 4.5 });

  for (const scene of SCENE_METADATA) {
    if (scene.isTemplateOnly) continue;
    const clipFile = path.join(TEMP_DIR, `clip_${scene.id}.mp4`);
    const slideImg = path.join(SLIDES_DIR, `${scene.id}.png`);

    if (!fs.existsSync(clipFile)) {
      console.log(`  Encoding ${clipFile} (${scene.duration}s)...`);
      const cmd = `ffmpeg -y -loop 1 -t ${scene.duration} -i "${slideImg}" -c:v libx264 -pix_fmt yuv420p -r 30 "${clipFile}"`;
      execSync(cmd, { stdio: 'pipe' });
    }
    clips.push({ id: scene.id, path: clipFile, duration: scene.duration });
  }

  return clips;
}

function concatWithXfade(clips) {
  console.log('[4/4] Stitching video with smooth cross-dissolve transitions...');
  const transitionDuration = 0.3; // 300ms dissolve

  // Build inputs
  const inputs = clips.map(c => `-i "${c.path}"`).join(' ');

  // Build filter_complex with xfade chain
  let filterStr = '';
  let currentOffset = clips[0].duration - transitionDuration;
  let lastStream = '[0:v]';

  for (let i = 1; i < clips.length; i++) {
    const nextStream = `[${i}:v]`;
    const outStream = i === clips.length - 1 ? '[vout]' : `[v${i}]`;
    const offsetSec = currentOffset.toFixed(2);

    filterStr += `${lastStream}${nextStream}xfade=transition=fade:duration=${transitionDuration}:offset=${offsetSec}${outStream};`;
    lastStream = outStream;
    currentOffset += clips[i].duration - transitionDuration;
  }

  // Remove trailing semicolon
  filterStr = filterStr.replace(/;$/, '');

  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterStr}" -map "[vout]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${OUTPUT_VIDEO}"`;
  console.log('Running FFmpeg rendering pipeline...');
  execSync(cmd, { stdio: 'inherit' });

  const totalDuration = currentOffset + transitionDuration;
  console.log(`Promotional video generated successfully: ${OUTPUT_VIDEO}`);
  console.log(`Total duration: ${totalDuration.toFixed(1)}s (1080x2340 vertical format, 30fps)`);
}

async function main() {
  console.log('==================================================');
  console.log('  Riichi Mahjong Scoreboard Promo Video Generator ');
  console.log('==================================================');

  await renderSlideFrames();
  await prepareScene1Video();
  const clips = renderStaticClips();
  concatWithXfade(clips);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
