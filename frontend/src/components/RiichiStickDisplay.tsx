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
      title={`供托立直棒 ${count} 根`}
    >
      {count === 0 ? (
        // 0 根立直棒时显示 1 根暗态契合放置槽 (56px x 7px, 真实比例 8.1:1，带居中凹槽和灰点)
        <div
          style={{
            width: '56px',
            height: '7px',
            borderRadius: '2px',
            border: '1px solid #334155',
            background: 'rgba(15, 23, 42, 0.35)',
            opacity: 0.4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              width: '22px',
              height: '5px',
              borderRadius: '1px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                width: '2.5px',
                height: '2.5px',
                borderRadius: '50%',
                backgroundColor: '#64748b'
              }}
            />
          </div>
        </div>
      ) : count <= 4 ? (
        // 1~4 根以内：垂直向下堆叠实体扁平宝蓝立直棒 (56px x 7px, 真实比例 8.1:1，圆角矩形外框 + 微凹槽内框阴影 + 银色点，极低色差微凹槽)
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            alignItems: 'center'
          }}
        >
          {Array.from({ length: count }).map((_, idx) => (
            <div
              key={idx}
              style={{
                width: '56px',
                height: '7px',
                borderRadius: '2px',
                background: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                boxSizing: 'border-box'
              }}
            >
              {/* 居中内框阴影凹槽 (约占总长 38%，22px x 5px，极低色差微凹槽) */}
              <div
                style={{
                  width: '22px',
                  height: '5px',
                  borderRadius: '1px',
                  backgroundColor: 'transparent',
                  boxShadow: 'inset 0 0.5px 0.8px rgba(0, 0, 0, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {/* 银色点 */}
                <div
                  style={{
                    width: '2.5px',
                    height: '2.5px',
                    borderRadius: '50%',
                    backgroundColor: '#e2e8f0'
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        // 超出 4 根 (count > 4)：只显示 1 根扁平图形 + 右侧数字乘数 Tag (x5, x6...)
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <div
            style={{
              width: '56px',
              height: '7px',
              borderRadius: '2px',
              background: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              boxSizing: 'border-box'
            }}
          >
            {/* 居中内框阴影凹槽 (极低色差微凹槽) */}
            <div
              style={{
                width: '22px',
                height: '5px',
                borderRadius: '1px',
                backgroundColor: 'transparent',
                boxShadow: 'inset 0 0.5px 0.8px rgba(0, 0, 0, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {/* 银色点 */}
              <div
                style={{
                  width: '2.5px',
                  height: '2.5px',
                  borderRadius: '50%',
                  backgroundColor: '#e2e8f0'
                }}
              />
            </div>
          </div>

          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#0284c7',
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
