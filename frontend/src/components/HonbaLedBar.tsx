import React from 'react';

interface HonbaLedBarProps {
  honba: number;
  height?: number;
}

export const HonbaLedBar: React.FC<HonbaLedBarProps> = ({ honba }) => {
  // 5 颗长方形 LED 状态算法 (索引 0~3 为黄色，索引 4 为红色)
  const lit = [false, false, false, false, false];
  const currentHonba = honba % 10;

  if (currentHonba >= 1 && currentHonba <= 4) {
    for (let i = 0; i < currentHonba; i++) {
      lit[i] = true;
    }
  } else if (currentHonba === 5) {
    lit[4] = true;
  } else if (currentHonba >= 6 && currentHonba <= 9) {
    lit[4] = true; // 红灯亮
    const yellowCount = currentHonba - 5; // 6->1, 7->2, 8->3, 9->4
    for (let i = 0; i < yellowCount; i++) {
      lit[3 - i] = true; // 从右向左反向亮起 (索引 3, 2, 1, 0)
    }
  }

  // LED 短边长为 11px，长边为 23px，间距 4px
  const shortSide = 11; // LED 短边长 (宽度) & 序号字高 1:1
  const longSide = 23;  // LED 长边长 (高度)
  const colGap = 4;

  return (
    <div
      className="honba-flat-panel"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        padding: '2px 4px',
        margin: '0 4px'
      }}
      title={`${honba} 本场 (${honba} 棒)`}
    >
      {/* 上排序号：1 2 3 4 (字号高度精准 11px，字体调细 fontWeight: 500) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: `${colGap}px`,
          marginBottom: '2px',
          fontSize: `${shortSide}px`,
          height: `${shortSide}px`,
          fontWeight: 500, // 调细字重
          lineHeight: `${shortSide}px`,
          color: 'var(--text-secondary, #a1a1aa)',
          opacity: 0.8
        }}
      >
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>3</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>4</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, opacity: 0 }}>-</span>
      </div>

      {/* 中排：5 颗短边 11px x 长边 23px 的标准矩形 LED (前 4 黄，第 5 红) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: `${colGap}px` }}>
        {lit.map((isLit, idx) => {
          const isRed = idx === 4;

          // 高明度发光与暗态背景
          let bg = isRed ? (isLit ? '#ff4d4d' : '#290808') : (isLit ? '#fde047' : '#272005');
          // 恒定钛灰色边框 (#52525b)
          let border = '#52525b';
          // 槽内收敛小辉光
          let shadow = isLit
            ? isRed
              ? '0 0 4px rgba(255, 77, 77, 0.55)'
              : '0 0 4px rgba(253, 224, 71, 0.55)'
            : 'none';

          return (
            <div
              key={idx}
              style={{
                width: `${shortSide}px`,
                height: `${longSide}px`,
                background: bg,
                border: `1.5px solid ${border}`,
                borderRadius: '2px',
                boxShadow: shadow,
                transition: 'all 0.2s ease',
                boxSizing: 'border-box'
              }}
            />
          );
        })}
      </div>

      {/* 下排序号：9 8 7 6 5 (字号高度精准 11px，字体调细 fontWeight: 500) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: `${colGap}px`,
          marginTop: '2px',
          fontSize: `${shortSide}px`,
          height: `${shortSide}px`,
          fontWeight: 500, // 调细字重
          lineHeight: `${shortSide}px`,
          color: 'var(--text-secondary, #a1a1aa)',
          opacity: 0.8
        }}
      >
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>9</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>8</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>7</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>6</span>
        <span style={{ width: `${shortSide}px`, height: `${shortSide}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>5</span>
      </div>
    </div>
  );
};
