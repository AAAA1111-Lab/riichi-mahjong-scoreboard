import React, { useState, useEffect } from 'react';

export interface FontPreset {
  name: string;
  category: string;
  desc: string;
  titleFont: string;
  hudFont: string;
  btnFont: string;
}

export const ALL_PRESETS: FontPreset[] = [
  {
    name: '1. Fontworks Reggae 丽雅体 (粗犷和风)',
    category: 'Fontworks原厂',
    desc: '雀魂御用大厂Fontworks力作，粗壮切面、二次元和风张力十足',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Reggae One', cursive, sans-serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '2. Fontworks RocknRoll 摇滚体 (粗圆手书)',
    category: 'Fontworks原厂',
    desc: 'Fontworks原厂粗手写，字形饱满敦厚、动感活泼',
    titleFont: "'Long Cang', cursive",
    hudFont: "'RocknRoll One', sans-serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '3. 青柳衡山·衡山毛笔行书 (Bakudai)',
    category: '日本毛笔',
    desc: '日本国宝级书法大师青柳衡山亲笔手书，雄浑古雅、纯正墨迹',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Bakudai', serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '4. 有次毛笔行草 (Yuji Boku)',
    category: '日本毛笔',
    desc: '桥本欣一纯正毛笔行草，浓墨沉雄、笔意连绵',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Yuji Boku', serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '5. 有次毛笔舞体 (Yuji Mai)',
    category: '日本毛笔',
    desc: '轻盈舒展飞舞行书，连笔牵丝细腻优美',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Yuji Mai', serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '6. 有次毛笔宿体 (Yuji Syuku)',
    category: '日本毛笔',
    desc: '厚重金石行楷，墨沉刀刻，横粗竖坚',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Yuji Syuku', serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '7. 禅红道手书 (Zen Kurenaido)',
    category: '和风手书',
    desc: '大平善道和风随性手写，行云流水、清爽写意',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Zen Kurenaido', sans-serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '8. 德拉极粗力量体 (Dela Gothic)',
    category: '极粗力量',
    desc: '现代街机特粗重字，极具视觉冲击力与压迫感',
    titleFont: "'Dela Gothic One', sans-serif",
    hudFont: "'Dela Gothic One', sans-serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '9. 志莽行书全景 (Zhi Mang Xing)',
    category: '名家行书',
    desc: '当代书法家韦志莽正统行书，沉雄开张、气势磅礴',
    titleFont: "'Zhi Mang Xing', cursive",
    hudFont: "'Bakudai', 'Zhi Mang Xing', cursive, serif",
    btnFont: "'Long Cang', cursive"
  },
  {
    name: '10. Fontworks Klee 克利和风楷 (官方正朔)',
    category: 'Fontworks原厂',
    desc: '雀魂原厂正版硬笔楷体，端肃挺拔、极具辨识度',
    titleFont: "'Long Cang', cursive",
    hudFont: "'Klee One', 'LXGW WenKai Screen', cursive, sans-serif",
    btnFont: "'Long Cang', cursive"
  }
];

// 风位 & HUD 局况 20+ 款候选字体库（按 4 大流派严密归类）
export const HUD_ALL_FONTS = [
  // 1. Fontworks 纯血和风与二次元原厂
  { group: '【Fontworks 原厂二次元和风】', label: 'Reggae One (丽雅体 - 粗犷切面和风)', value: "'Reggae One', cursive, sans-serif" },
  { group: '【Fontworks 原厂二次元和风】', label: 'RocknRoll One (摇滚体 - 粗圆手书)', value: "'RocknRoll One', sans-serif" },
  { group: '【Fontworks 原厂二次元和风】', label: 'Klee One (克利体 - 官方原厂硬笔楷)', value: "'Klee One', 'LXGW WenKai Screen', cursive, sans-serif" },
  { group: '【Fontworks 原厂二次元和风】', label: 'Stick (棒体 - 特色几何和风)', value: "'Stick', sans-serif" },
  
  // 2. 日本毛笔名家墨迹
  { group: '【日本毛笔名家墨迹】', label: 'Bakudai (青柳衡山·衡山毛笔行书 - 雄浑古雅)', value: "'Bakudai', serif" },
  { group: '【日本毛笔名家墨迹】', label: 'Yuji Boku (桥本欣一·有次毛笔草书 - 浓墨沉雄)', value: "'Yuji Boku', serif" },
  { group: '【日本毛笔名家墨迹】', label: 'Yuji Mai (桥本欣一·有次毛笔舞体 - 灵动舒展)', value: "'Yuji Mai', serif" },
  { group: '【日本毛笔名家墨迹】', label: 'Yuji Syuku (桥本欣一·有次毛笔宿体 - 金石厚重)', value: "'Yuji Syuku', serif" },
  { group: '【日本毛笔名家墨迹】', label: 'Zen Kurenaido (大平善道·禅红道手书 - 随性行云)', value: "'Zen Kurenaido', sans-serif" },

  // 3. 中国名家书法与正统行书
  { group: '【中国传世与名家书法】', label: 'Long Cang (龙藏体 - 苍劲飞白行草)', value: "'Long Cang', cursive" },
  { group: '【中国传世与名家书法】', label: 'Zhi Mang Xing (志莽行书 - 沉雄开张)', value: "'Bakudai', 'Zhi Mang Xing', cursive, serif" },
  { group: '【中国传世与名家书法】', label: 'Liu Jian Mao Cao (刘建毛草 - 险绝狂放)', value: "'Liu Jian Mao Cao', cursive" },
  { group: '【中国传世与名家书法】', label: 'Ma Shan Zheng (马善政楷书 - 刚健庄重)', value: "'Ma Shan Zheng', cursive" },
  { group: '【中国传世与名家书法】', label: 'LXGW WenKai (霞鹜文楷 - 清秀雅正)', value: "'LXGW WenKai Screen', 'Klee One', cursive, sans-serif" },

  // 4. 极粗力量与金石古典
  { group: '【极粗力量与金石古典】', label: 'Dela Gothic One (德拉极粗黑 - 街机压迫感)', value: "'Dela Gothic One', sans-serif" },
  { group: '【极粗力量与金石古典】', label: 'Zen Antique (禅古风金石印 - 古典雕琢)', value: "'Zen Antique', serif" },
  { group: '【极粗力量与金石古典】', label: 'Zen Antique Soft (禅古风柔印)', value: "'Zen Antique Soft', serif" },
  { group: '【极粗力量与金石古典】', label: 'Kaisei Tokumin (开成特民刻本明朝)', value: "'Kaisei Tokumin', serif" },
  { group: '【极粗力量与金石古典】', label: 'Kaisei Decol (开成和风装饰刻本)', value: "'Kaisei Decol', serif" },
  { group: '【极粗力量与金石古典】', label: 'Shippori Antique (志保利古印明朝)', value: "'Shippori Antique', serif" },
  { group: '【极粗力量与金石古典】', label: 'Hachi Maru Pop (八丸手写体)', value: "'Hachi Maru Pop', cursive" }
];

// 大标题 & 流局按钮候选
export const TITLE_ALL_FONTS = [
  { label: '【行草】龙藏体 (Long Cang) - 苍劲飞白', value: "'Long Cang', cursive" },
  { label: '【行书】志莽行书 (Zhi Mang Xing) - 沉雄开张', value: "'Zhi Mang Xing', cursive" },
  { label: '【行书】衡山毛笔行书 (Bakudai) - 雄浑古雅', value: "'Bakudai', cursive" },
  { label: '【和风】Reggae One (丽雅体 - 粗犷和风)', value: "'Reggae One', cursive" },
  { label: '【和风】RocknRoll One (摇滚体 - 粗手书)', value: "'RocknRoll One', sans-serif" },
  { label: '【行楷】霞鹜文楷 (LXGW WenKai) - 清秀文人', value: "'LXGW WenKai Screen', 'STKaiti', cursive" },
  { label: '【行草】刘建毛草 (Liu Jian Mao Cao) - 险绝狂放', value: "'Liu Jian Mao Cao', cursive" },
  { label: '【行楷】马善政楷书 (Ma Shan Zheng) - 庄重厚劲', value: "'Ma Shan Zheng', cursive" },
  { label: '【力量】Dela Gothic One (德拉极粗力量体)', value: "'Dela Gothic One', sans-serif" },
  { label: '【行楷】克利和风楷 (Klee One) - 原厂硬笔', value: "'Klee One', 'LXGW WenKai Screen', cursive" }
];

// 操作按钮候选
export const BTN_ALL_FONTS = [
  { label: '【行草】龙藏体 (Long Cang) - 默认固定', value: "'Long Cang', cursive" },
  { label: '【和风】Reggae One (丽雅体)', value: "'Reggae One', cursive" },
  { label: '【行书】衡山毛笔行书 (Bakudai)', value: "'Bakudai', cursive" },
  { label: '【力量】Dela Gothic One (德拉黑体)', value: "'Dela Gothic One', sans-serif" },
  { label: '【行书】志莽行书 (Zhi Mang Xing)', value: "'Zhi Mang Xing', cursive" },
  { label: '【行草】刘建毛草 (Liu Jian Mao Cao)', value: "'Liu Jian Mao Cao', cursive" },
  { label: '【行楷】克利和风楷 (Klee One)', value: "'Klee One', cursive" }
];

export const FontStudioModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [titleFont, setTitleFont] = useState<string>(() => localStorage.getItem('majsoul-debug-font-title') || TITLE_ALL_FONTS[0].value);
  const [hudFont, setHudFont] = useState<string>(() => localStorage.getItem('majsoul-debug-font-hud') || HUD_ALL_FONTS[0].value);
  const [btnFont, setBtnFont] = useState<string>(() => localStorage.getItem('majsoul-debug-font-btn') || BTN_ALL_FONTS[0].value);
  const [copied, setCopied] = useState<boolean>(false);

  const applyFonts = (title: string, hud: string, btn: string) => {
    document.documentElement.style.setProperty('--majsoul-font-title', title);
    document.documentElement.style.setProperty('--majsoul-font-hud', hud);
    document.documentElement.style.setProperty('--majsoul-font-btn', btn);

    localStorage.setItem('majsoul-debug-font-title', title);
    localStorage.setItem('majsoul-debug-font-hud', hud);
    localStorage.setItem('majsoul-debug-font-btn', btn);
  };

  useEffect(() => {
    applyFonts(titleFont, hudFont, btnFont);
  }, [titleFont, hudFont, btnFont]);

  const handleSelectPreset = (preset: FontPreset) => {
    setTitleFont(preset.titleFont);
    setHudFont(preset.hudFont);
    setBtnFont(preset.btnFont);
  };

  const handleReset = () => {
    handleSelectPreset(ALL_PRESETS[0]);
  };

  const handleCopyCSS = () => {
    const cssCode = `/* 雀魂主题选定字体方案 */\n--majsoul-font-title: ${titleFont};\n--majsoul-font-hud: ${hudFont};\n--majsoul-font-btn: ${btnFont};`;
    navigator.clipboard.writeText(cssCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '94%',
        maxWidth: '480px',
        maxHeight: '88vh',
        backgroundColor: '#141d2e',
        border: '2px solid #e8af71',
        borderRadius: '16px',
        boxShadow: '0 16px 40px rgba(0,0,0,0.9), 0 0 28px rgba(232,175,113,0.4)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        color: '#f0f4fc',
        overflow: 'hidden',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          background: 'linear-gradient(180deg, #273656, #182236)',
          borderBottom: '1px solid #384a73'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '0.98rem', color: '#e8af71' }}>雀魂全量书法字库对比工作台</div>
            <div style={{ fontSize: '0.72rem', color: '#9ca5b4' }}>Fontworks原厂 · 衡山毛笔 · 4大流派20+款 · 即点即变</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#e8af71',
            fontSize: '1.4rem',
            cursor: 'pointer',
            padding: '2px 8px',
            lineHeight: 1
          }}
        >
          ✕
        </button>
      </div>

      {/* Body Container */}
      <div style={{ padding: '14px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        
        {/* Presets List */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#e8af71', marginBottom: '8px' }}>
            10 套流派一键预设方案 (点击即刻全局切换)：
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {ALL_PRESETS.map((preset, idx) => {
              const isSelected = titleFont === preset.titleFont && hudFont === preset.hudFont && btnFont === preset.btnFont;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelectPreset(preset)}
                  style={{
                    background: isSelected ? 'linear-gradient(135deg, #c25e1a, #e8af71)' : 'rgba(255,255,255,0.06)',
                    color: isSelected ? '#ffffff' : '#e0e6f0',
                    border: isSelected ? '1px solid #ffd285' : '1px solid #384a73',
                    borderRadius: '8px',
                    padding: '8px 8px',
                    fontSize: '0.74rem',
                    fontWeight: '600',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    lineHeight: '1.3'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem' }}>{preset.name.slice(0, 16)}</span>
                    <span style={{ fontSize: '0.58rem', padding: '1px 3px', borderRadius: '3px', background: isSelected ? 'rgba(0,0,0,0.3)' : '#243250', color: isSelected ? '#fff' : '#e8af71' }}>
                      {preset.category}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.64rem', opacity: 0.85, marginTop: '3px', fontWeight: 'normal' }}>
                    {preset.desc.slice(0, 18)}...
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '2px 0' }} />

        {/* Individual Calligraphy Selectors */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
          
          {/* 1. 风位 & HUD 局况 (核心重点) */}
          <div>
            <label style={{ fontSize: '0.8rem', color: '#ffd285', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
              风位指示器 & HUD 局况字体 (20+ 款中日名作全量)：
            </label>
            <select
              value={hudFont}
              onChange={(e) => setHudFont(e.target.value)}
              style={{
                width: '100%',
                background: '#0d131f',
                color: '#fff',
                border: '1.5px solid #e8af71',
                borderRadius: '6px',
                padding: '8px 8px',
                fontSize: '0.82rem',
                outline: 'none',
                fontWeight: 'bold'
              }}
            >
              {HUD_ALL_FONTS.map((f, i) => (
                <option key={i} value={f.value}>{f.group} {f.label}</option>
              ))}
            </select>
          </div>

          {/* 2. 大标题 & 流局按钮 */}
          <div>
            <label style={{ fontSize: '0.78rem', color: '#e8af71', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
              大标题 & 流局按钮书法 (原生收录简体「计」「荒牌流局」):
            </label>
            <select
              value={titleFont}
              onChange={(e) => setTitleFont(e.target.value)}
              style={{
                width: '100%',
                background: '#0d131f',
                color: '#fff',
                border: '1px solid #4a5d85',
                borderRadius: '6px',
                padding: '7px 8px',
                fontSize: '0.8rem',
                outline: 'none'
              }}
            >
              {TITLE_ALL_FONTS.map((f, i) => (
                <option key={i} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* 3. 操作按钮 */}
          <div>
            <label style={{ fontSize: '0.78rem', color: '#e8af71', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
              操作按钮书法 (立直/自摸/荣和/撤销，默认固定龙藏体):
            </label>
            <select
              value={btnFont}
              onChange={(e) => setBtnFont(e.target.value)}
              style={{
                width: '100%',
                background: '#0d131f',
                color: '#fff',
                border: '1px solid #4a5d85',
                borderRadius: '6px',
                padding: '7px 8px',
                fontSize: '0.8rem',
                outline: 'none'
              }}
            >
              {BTN_ALL_FONTS.map((f, i) => (
                <option key={i} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.08)',
              color: '#d0d8e8',
              border: '1px solid #384a73',
              borderRadius: '6px',
              padding: '8px',
              fontSize: '0.78rem',
              cursor: 'pointer'
            }}
          >
            ↺ 恢复方案 1
          </button>
          <button
            onClick={handleCopyCSS}
            style={{
              flex: 1.5,
              background: copied ? '#27ae60' : 'linear-gradient(135deg, #c25e1a, #e8af71)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px',
              fontSize: '0.78rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            {copied ? '已复制配置代码！' : '复制当前选定配置'}
          </button>
        </div>

      </div>
    </div>
  );
};
