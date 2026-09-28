import React from 'react';

// 7-Segment Mapping table (A, B, C, D, E, F, G)
//  -- A --
// |       |
// F       B
// |-- G --|
// E       C
// |       |
//  -- D --
const SEGMENT_MAP: Record<string, boolean[]> = {
  '0': [true,  true,  true,  true,  true,  true,  false],
  '1': [false, true,  true,  false, false, false, false],
  '2': [true,  true,  false, true,  true,  false, true],
  '3': [true,  true,  true,  true,  false, false, true],
  '4': [false, true,  true,  false, false, true,  true],
  '5': [true,  false, true,  true,  false, true,  true],
  '6': [true,  false, true,  true,  true,  true,  true],
  '7': [true,  true,  true,  false, false, false, false],
  '8': [true,  true,  true,  true,  true,  true,  true],
  '9': [true,  true,  true,  true,  false, true,  true],
  'P': [true,  true,  false, false, true,  true,  true],
  '+': [false, false, false, false, true,  true,  true],
  '-': [false, false, false, false, false, false, true],
  ' ': [false, false, false, false, false, false, false],
};

interface SingleSegmentDigitProps {
  char: string;
}

// Vector SVG with wider 2.5px gap polygons for razor-sharp physical tube separation
const SingleSegmentDigit: React.FC<SingleSegmentDigitProps> = ({ char }) => {
  const activeSegs = SEGMENT_MAP[char] || SEGMENT_MAP[' '];

  return (
    <svg className="seg7-digit" viewBox="0 0 54 84" xmlns="http://www.w3.org/2000/svg">
      {/* Segment A (Top horizontal) */}
      <polygon
        points="9,9  14,4  40,4  45,9  39,14  15,14"
        className={activeSegs[0] ? 'seg-on' : 'seg-off'}
      />
      {/* Segment B (Top-Right vertical) */}
      <polygon
        points="46,11  51,16  51,36  46,41  41,36  41,16"
        className={activeSegs[1] ? 'seg-on' : 'seg-off'}
      />
      {/* Segment C (Bottom-Right vertical) */}
      <polygon
        points="46,43  51,48  51,68  46,73  41,68  41,48"
        className={activeSegs[2] ? 'seg-on' : 'seg-off'}
      />
      {/* Segment D (Bottom horizontal) */}
      <polygon
        points="9,75  15,70  39,70  45,75  40,80  14,80"
        className={activeSegs[3] ? 'seg-on' : 'seg-off'}
      />
      {/* Segment E (Bottom-Left vertical) */}
      <polygon
        points="8,43  13,48  13,68  8,73  3,68  3,48"
        className={activeSegs[4] ? 'seg-on' : 'seg-off'}
      />
      {/* Segment F (Top-Left vertical) */}
      <polygon
        points="8,11  13,16  13,36  8,41  3,36  3,16"
        className={activeSegs[5] ? 'seg-on' : 'seg-off'}
      />
      {/* Segment G (Middle horizontal) */}
      <polygon
        points="9,42  14,37  40,37  45,42  40,47  14,47"
        className={activeSegs[6] ? 'seg-on' : 'seg-off'}
      />
    </svg>
  );
};

interface LedDigitDisplayProps {
  value: string | number;
  color?: 'red' | 'blue';
  digits?: number;
  height?: number;
}

export const LedDigitDisplay: React.FC<LedDigitDisplayProps> = ({
  value,
  color = 'red',
  digits = 5,
  height = 28
}) => {
  const strVal = String(value);
  const padded = strVal.padStart(digits, ' ');
  const chars = padded.split('');

  return (
    <div className={`seg7-container seg7-${color}`}>
      {chars.map((ch, idx) => (
        <div key={idx} style={{ height: `${height}px`, width: `${Math.round(height * 0.64)}px` }}>
          <SingleSegmentDigit char={ch} />
        </div>
      ))}
    </div>
  );
};

interface SignLampProps {
  positive: boolean;
  color?: 'red' | 'blue';
  height?: number;
}

// +/- 符号灯管：两根灯管（一根水平 + 一根垂直），正号两盏亮，负号只亮水平
const SignLamp: React.FC<SignLampProps> = ({ positive, color = 'blue', height = 12 }) => {
  const width = Math.round(height * 0.64);
  const lit = color === 'blue' ? '#0c2a5c' : '#ff3b30';
  const dim = color === 'blue' ? 'rgba(12, 42, 92, 0.06)' : '#1e1212';
  return (
    <div style={{ height: `${height}px`, width: `${width}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 16 16" style={{ height: '100%', width: '100%', display: 'block', transform: 'skewX(-6deg)' }}>
        <rect x="1.5" y="7" width="13" height="2" rx="1" fill={lit} />
        <rect x="7" y="1.5" width="2" height="13" rx="1" fill={positive ? lit : dim} />
      </svg>
    </div>
  );
};

interface SignLedDisplayProps {
  value: number;
  color?: 'red' | 'blue';
  height?: number;
}

// 点差 LED：1 位 +/- 灯管符号 + 5 位数字（数字区右对齐）
export const SignLedDisplay: React.FC<SignLedDisplayProps> = ({
  value,
  color = 'red',
  height = 14
}) => {
  const positive = value >= 0;
  const numPart = String(Math.abs(value)).padStart(5, ' ');
  return (
    <div className={`seg7-container seg7-${color}`}>
      <SignLamp positive={positive} color={color} height={height} />
      {numPart.split('').map((ch, idx) => (
        <div key={idx} style={{ height: `${height}px`, width: `${Math.round(height * 0.64)}px` }}>
          <SingleSegmentDigit char={ch} />
        </div>
      ))}
    </div>
  );
};

interface RankLampProps {
  rank: number;
  height?: number;
}

const RANK_LABELS = ['1ST', '2ND', '3RD', '4TH'];

// 顺位灯牌：蓝色点亮的平行四边形，字符用 Michroma 几何直线字体（纯直线无曲线），界面底色不发光
export const RankLamp: React.FC<RankLampProps> = ({ rank, height = 22 }) => {
  const label = RANK_LABELS[rank - 1] || `${rank}TH`;
  const fontSize = Math.round(height * 0.62);
  return (
    <div className="rank-lamp" style={{ height: `${height}px` }}>
      {label.split('').map((ch, idx) => (
        <span key={idx} className="rank-lamp-char" style={{ fontSize }}>
          {ch}
        </span>
      ))}
    </div>
  );
};
