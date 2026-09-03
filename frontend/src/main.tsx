import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 统一本地化字体库导入 (100% 离线可用，零远程依赖)
import '@fontsource/long-cang/400.css'
import '@fontsource/ma-shan-zheng/400.css'
import '@fontsource/klee-one/600.css'
import '@fontsource/michroma/400.css'
import './index.css'
import App from './App.tsx'

// 浏览器端字体首屏全量预热/预加载 (Font Preloading & Warmup)
// 提前加载日麻核心字符集，彻底消除切换到雀魂/电子/REXX主题时的字体闪烁 (FOUT)
const preloadCustomFonts = () => {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    const mahjongCoreSample = '东南西北局本场地和自摸立直得分玩家一二三四五六七八九十点庄闲0123456789';
    Promise.all([
      document.fonts.load('400 16px "Long Cang"', mahjongCoreSample),
      document.fonts.load('400 16px "Ma Shan Zheng"', mahjongCoreSample),
      document.fonts.load('600 16px "Klee One"', mahjongCoreSample),
      document.fonts.load('400 16px "Michroma"', '01234567891ST2ND3RD4TH')
    ]).catch(() => {
      // Ignore font loading errors if any
    });
  }
};

preloadCustomFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
