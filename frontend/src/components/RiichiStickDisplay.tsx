import React from 'react';

interface RiichiStickDisplayProps {
  count: number;
}

export const RiichiStickDisplay: React.FC<RiichiStickDisplayProps> = ({ count }) => {
  return (
    <div
      className="riichi-stick-display"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        userSelect: 'none',
        padding: '0 2px'
      }}
      title={`场上立直棒: ${count} 根 (${count * 1000} 点)`}
    >
      {count === 0 ? (
        // 0 根立直棒时显示 1 根暗态契合轮廓槽 (48px x 10px)
        <div
          style={{
            width: '48px',
            height: '10px',
            borderRadius: '2.5px',
            border: '1px solid #334155',
            background: 'rgba(15, 23, 42, 0.35)',
            opacity: 0.3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              width: '3.5px',
              height: '3.5px',
              borderRadius: '50%',
              background: '#475569'
            }}
          />
        </div>
      ) : count <= 4 ? (
        // 1~4 根以内：垂直向下美观堆叠 1~4 根实体宝蓝银点立直棒 (48px x 10px)
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2.5px',
            alignItems: 'center'
          }}
        >
          {Array.from({ length: count }).map((_, idx) => (
            <div
              key={idx}
              style={{
                width: '48px',
                height: '10px',
                borderRadius: '2.5px',
                background: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
                border: '1px solid #1e40af',
                borderBottom: '1.5px solid #172554',
                boxShadow: '0 1.5px 3px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}
            >
              {/* 居中 1 个立体发光银点 */}
              <div
                style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, #ffffff 0%, #cbd5e1 60%, #94a3b8 100%)',
                  boxShadow: '0 0 2px rgba(255, 255, 255, 0.9)'
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        // 超出 4 根 (count > 4)：只显示 1 根图形 + 右侧数字乘数 Tag (x5, x6...)
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <div
            style={{
              width: '48px',
              height: '10px',
              borderRadius: '2.5px',
              background: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
              border: '1px solid #1e40af',
              borderBottom: '1.5px solid #172554',
              boxShadow: '0 1.5px 3px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}
          >
            {/* 居中 1 个立体发光银点 */}
            <div
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, #ffffff 0%, #cbd5e1 60%, #94a3b8 100%)',
                boxShadow: '0 0 2px rgba(255, 255, 255, 0.9)'
              }}
            />
          </div>

          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#3b82f6',
              letterSpacing: '0.5px',
              lineHeight: 1
            }}
          >
            x{count}
          </span>
        </div>
      )}
    </div>
  );
};
