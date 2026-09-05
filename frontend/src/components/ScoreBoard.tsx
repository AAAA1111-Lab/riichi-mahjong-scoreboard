import { LedDigitDisplay, SignLedDisplay, RankLamp } from './LedDigitDisplay';
import type { Theme, GameState, Player } from '../types';
import React from 'react';

// 雀魂手绘线稿同款非平行令牌底板与边框 (底边水平，顶边斜向右上方抬升，左右两边斜率严格一致平行)
export const MajsoulTokenBg: React.FC<{ type: 'riichi' | 'tsumo' | 'ron'; isActive?: boolean }> = ({ type, isActive = false }) => {
  let fillColor = '#c25e1a'; // 橙褐赤金底板
  let frameColor = '#eb7422'; // 亮橙外半框

  if (type === 'riichi') {
    if (isActive) {
      fillColor = '#45484f'; // 撤销立直（实机跳过灰黑底板）
      frameColor = '#7a808a'; // 银灰外半框
    } else {
      fillColor = '#c25e1a'; // 实机图2：橙褐赤金
      frameColor = '#eb7422'; // 亮橙外半框
    }
  } else if (type === 'tsumo') {
    fillColor = '#942046'; // 实机提取：深紫红/洋红酒红底色
    frameColor = '#b8336a'; // 洋红外半框
  } else if (type === 'ron') {
    fillColor = '#a62828'; // 实机图1：深赤红底色
    frameColor = '#e63939'; // 鲜亮赤红外半框
  }

  return (
    <svg
      className="majsoul-token-bg-svg"
      viewBox="0 0 100 36"
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 雀魂外半框：锁死中间条带间隔 + 左线左上至右下渐细 + 下线左至右渐细 */}
      <polygon
        points="13,13.4 -4.4,16.4 7.8,37.4 47,36.5 47,36 9,36 -1,18 13,14"
        fill={frameColor}
        stroke={frameColor}
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id={`token-shadow-grad-${type}-${isActive ? 'act' : 'inact'}`} x1="10%" y1="0%" x2="25%" y2="100%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <stop offset="35%" stopColor="#000000" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      {/* 按钮主体多边形 */}
      <polygon
        points="4,20 82,0 100,33 11,33"
        fill={fillColor}
        stroke="none"
      />
      {/* 按钮切面柔和微阴影：分界线 (7.1, 25.7) -> (85.1, 5.7) 与上边界严格平行，采用零硬边平滑渐变 */}
      <polygon
        points="7.1,25.7 85.1,5.7 100,33 11,33"
        fill={`url(#token-shadow-grad-${type}-${isActive ? 'act' : 'inact'})`}
        stroke="none"
      />
    </svg>
  );
};

// 雀魂实机同款：五瓣樱花剪影图形 (绕中心顺时针旋转30度，支持按按钮配色)
export const FlatSakura: React.FC<{ size?: number; fill?: string; centerFill?: string }> = ({
  size = 13,
  fill = '#4a2612',
  centerFill = '#deb352',
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <g transform="translate(12, 12) rotate(30)" fill={fill}>
      {[0, 72, 144, 216, 288].map((angle, i) => (
        <path
          key={i}
          d="M0,0 C-2.4,-4.2 -4.8,-7.8 -1.2,-10.2 C-0.2,-9.2 0.2,-9.2 1.2,-10.2 C4.8,-7.8 2.4,-4.2 0,0 Z"
          transform={`rotate(${angle})`}
        />
      ))}
      <circle cx="0" cy="0" r="1.6" fill={centerFill} />
    </g>
  </svg>
);

export const AnimatedCounter: React.FC<{ value: number; duration?: number; isLed?: boolean; ledColor?: 'red' }> = ({ value, duration = 600, isLed = false, ledColor = 'red' }) => {
  const [displayValue, setDisplayValue] = React.useState(value);
  
  const displayValRef = React.useRef(value);
  const targetValRef = React.useRef(value);

  React.useEffect(() => {
    displayValRef.current = displayValue;
  }, [displayValue]);

  React.useEffect(() => {
    if (targetValRef.current === value) {
      return;
    }

    const start = displayValRef.current;
    const end = value;
    targetValRef.current = value;
    const startTime = performance.now();

    let animationFrameId: number;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = progress * (2 - progress);
      
      const currentValue = Math.round(start + (end - start) * easeProgress);
      setDisplayValue(currentValue);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, duration]);

  if (isLed) {
    return <LedDigitDisplay value={displayValue} color={ledColor} height={24} digits={5} />;
  }

  return <>{displayValue}</>;
};

interface ScoreBoardProps {
  theme?: Theme;
  showDiffMode?: boolean;
  gameState: GameState;
  mySeatId: number | null;
  onUpdateState: (newState: GameState, logMsg: string) => void;
  onTsumoClick: (player: Player) => void;
  onRonClick: (player: Player) => void;
  onRiichiClick?: (player: Player) => void;
  onRenameClick: (player: Player) => void;
  onUndoClick?: () => void;
  onScoreClick?: (player: Player) => void;
}

export const ScoreBoard: React.FC<ScoreBoardProps> = ({
  theme = 'dark',
  showDiffMode = false,
  gameState,
  mySeatId,
  onUpdateState: _onUpdateState,
  onTsumoClick,
  onRonClick,
  onRiichiClick,
  onRenameClick,
  onUndoClick: _onUndoClick,
  onScoreClick,
}) => {
  const { players, dealerIndex } = gameState;
  const isSanma = players.length === 3;
  const displayPlayers = players.slice(0, isSanma ? 3 : 4);

  // Calculate current rank (1位, 2位, 3位, 4位) sorted by score
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const getPlayerRank = (playerId: number) => {
    const rankIdx = sortedPlayers.findIndex(p => p.id === playerId);
    const ranks = ['一位', '二位', '三位', '四位'];
    return ranks[rankIdx] || `${rankIdx + 1}位`;
  };

  const getWindName = (idx: number) => {
    const winds = ['東', '南', '西', '北'];
    const count = isSanma ? 3 : 4;
    const relativeIdx = (idx - dealerIndex + count) % count;
    return winds[relativeIdx];
  };

  return (
    <div className="scoreboard-grid">
      {displayPlayers.map((player, idx) => {
        const isDealer = idx === dealerIndex;
        const isMySelf = mySeatId === player.id;
        const myPlayer = mySeatId !== null ? players.find(p => p.id === mySeatId) || null : null;
        const targetPlayer = myPlayer || (showDiffMode ? players[0] : null);
        const showDiff = targetPlayer !== null && player.id !== targetPlayer.id;
        const diffVal = targetPlayer ? targetPlayer.score - player.score : 0;
        const windName = getWindName(idx);
        const isEast = windName === '東';

        // In showDiffMode, replace player name with rank (1位, 2位, 3位...)
        const displayName = showDiffMode ? getPlayerRank(player.id) : player.name;

        return (
          <div
            key={player.id}
            className={`player-card ${isDealer ? 'is-dealer' : ''} ${isMySelf ? 'is-myself' : ''}`}
          >
            {/* Top row: Horizontally aligned Player Info (Left) and Score Display (Right) */}
            <div className="player-main-info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '8px' }}>
              <div className="player-header" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className={`player-wind ${isEast ? 'wind-east' : 'wind-other'}`}>
                  {windName}
                </span>
                <span
                  className={`player-name ${isMySelf ? 'is-self can-rename' : ''}`}
                  onClick={isMySelf ? () => onRenameClick(player) : undefined}
                  style={{ cursor: isMySelf ? 'pointer' : 'default' }}
                  title={isMySelf ? '点击修改自己设备的名字' : undefined}
                >
                  {displayName}
                </span>
                {isMySelf && theme === 'majsoul' && (
                  <span className="majsoul-jika-badge" title="自家">
                    <span className="majsoul-jika-badge-inner">自家</span>
                  </span>
                )}
              </div>

              <div className="player-score-container" style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                {theme === 'rexx' ? (
                  (() => {
                    // REXX 主题点数显示：省略后两位 00，4 位 LED，前导补 0
                    const scoreHundred = String(Math.floor(player.score / 100)).padStart(4, '0');
                    let scoreNode: React.ReactNode;
                    if (showDiffMode) {
                      if (isMySelf) {
                        // 点差模式自家显示总点数（不含场供）
                        const totalSum = gameState.players.reduce((sum, p) => sum + p.score, 0);
                        scoreNode = <LedDigitDisplay value={String(Math.floor(totalSum / 100)).padStart(4, '0')} color="red" height={28} digits={4} />;
                      } else {
                        const targetScore = myPlayer ? myPlayer.score : Math.max(...players.map(p => p.score));
                        const diff = player.score - targetScore;
                        const hundredDiff = Math.floor(diff / 100);
                        const isPos = diff >= 0;
                        const absVal = Math.abs(hundredDiff).toString().padStart(3, '0');
                        const diffStr = isPos ? 'P' + absVal : '-' + absVal;
                        scoreNode = <LedDigitDisplay value={diffStr} color="red" height={28} digits={4} />;
                      }
                    } else {
                      scoreNode = <LedDigitDisplay value={scoreHundred} color="red" height={28} digits={4} />;
                    }

                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isMySelf && <span className="jika-badge">自家</span>}
                        {scoreNode}
                      </div>
                    );
                  })()
                ) : theme === 'electronic' ? (
                  (() => {
                    const myPlayerE = mySeatId !== null ? players.find(p => p.id === mySeatId) || null : null;
                    const isMySelfE = mySeatId !== null && player.id === mySeatId;
                    const rankNum = sortedPlayers.findIndex(p => p.id === player.id) + 1;

                    const scoreLed = <LedDigitDisplay value={player.score} color="blue" height={24} digits={6} />;

                    // 点差 LED：1 位 +/- 灯管符号 + 5 位数字，放在分数正下方
                    let diffLed: React.ReactNode = null;
                    if (!isMySelfE && myPlayerE) {
                      const diff = player.score - myPlayerE.score;
                      diffLed = <SignLedDisplay value={diff} color="blue" height={14} />;
                    }

                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RankLamp rank={rankNum} height={22} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                          {scoreLed}
                          {diffLed}
                          {isMySelfE && <span className="jika-badge" style={{ marginTop: '1px' }}>自家</span>}
                        </div>
                      </div>
                    );
                  })()
                ) : theme === 'majsoul' ? (
                  (() => {
                    const isSelf = mySeatId !== null && player.id === mySeatId;
                    const targetPlayer = mySeatId !== null ? players.find(p => p.id === mySeatId) || players[0] : players[0];
                    if (showDiffMode && !isSelf) {
                      const diff = player.score - targetPlayer.score;
                      const diffStr = diff > 0 ? `-${diff}` : (diff < 0 ? `+${-diff}` : '0');
                      const cls = diff < 0 ? 'majsoul-diff-pos' : 'majsoul-diff-neg';
                      return (
                        <span
                          className={`player-score majsoul-diff ${cls}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => onScoreClick?.(player)}
                          title="点击恢复点数显示"
                        >
                          {diffStr}
                        </span>
                      );
                    }
                    return (
                      <span
                        className="player-score"
                        style={{ cursor: 'pointer' }}
                        onClick={() => onScoreClick?.(player)}
                        title="点击切换点差显示"
                      >
                        <AnimatedCounter value={player.score} />
                      </span>
                    );
                  })()
                ) : (
                  // Light & Dark Themes: Clean horizontal level alignment with Player Header
                  <>
                    <span className="player-score"><AnimatedCounter value={player.score} /></span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>点</span>
                    {showDiff && (
                      <span className={`player-diff-badge ${diffVal > 0 ? 'pos' : diffVal < 0 ? 'neg' : 'zero'}`}>
                        {diffVal > 0 ? '+' : ''}{diffVal}
                      </span>
                    )}
                    {isMySelf && (
                      <span className="jika-badge" style={{ alignSelf: 'center', marginLeft: '2px' }}>自家</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Bottom row: Action Buttons */}
            <div className="player-actions">
              <button
                type="button"
                className={`btn btn-riichi ${player.riichi ? 'btn-danger is-riichi-active' : ''}`}
                onClick={() => onRiichiClick?.(player)}
              >
                {theme === 'majsoul' && <MajsoulTokenBg type="riichi" isActive={player.riichi} />}
                {theme === 'majsoul' && (
                  <span className="majsoul-sakura-left">
                    <FlatSakura size={13} fill={player.riichi ? '#232529' : '#5c2005'} centerFill={player.riichi ? '#686d75' : '#be5b1a'} />
                  </span>
                )}
                {theme === 'majsoul' ? (
                  <span className="btn-text-wrapper">
                    <span className="btn-text-shadow">{player.riichi ? '撤销' : '立直'}</span>
                    <span className="btn-text">{player.riichi ? '撤销' : '立直'}</span>
                  </span>
                ) : (
                  (player.riichi ? '撤销' : '立直')
                )}
                {theme === 'majsoul' && (
                  <span className="majsoul-sakura-right">
                    <FlatSakura size={19} fill={player.riichi ? '#232529' : '#5c2005'} centerFill={player.riichi ? '#686d75' : '#be5b1a'} />
                  </span>
                )}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-tsumo"
                onClick={() => onTsumoClick(player)}
              >
                {theme === 'majsoul' && <MajsoulTokenBg type="tsumo" />}
                {theme === 'majsoul' && (
                  <span className="majsoul-sakura-left">
                    <FlatSakura size={13} fill="#4d081b" centerFill="#8c1638" />
                  </span>
                )}
                {theme === 'majsoul' ? (
                  <span className="btn-text-wrapper">
                    <span className="btn-text-shadow">自摸</span>
                    <span className="btn-text">自摸</span>
                  </span>
                ) : (
                  '自摸'
                )}
                {theme === 'majsoul' && (
                  <span className="majsoul-sakura-right">
                    <FlatSakura size={19} fill="#4d081b" centerFill="#8c1638" />
                  </span>
                )}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-ron"
                onClick={() => onRonClick(player)}
              >
                {theme === 'majsoul' && <MajsoulTokenBg type="ron" />}
                {theme === 'majsoul' && (
                  <span className="majsoul-sakura-left">
                    <FlatSakura size={13} fill="#4a0d0d" centerFill="#c23232" />
                  </span>
                )}
                {theme === 'majsoul' ? (
                  <span className="btn-text-wrapper">
                    <span className="btn-text-shadow">荣和</span>
                    <span className="btn-text">荣和</span>
                  </span>
                ) : (
                  '荣和'
                )}
                {theme === 'majsoul' && (
                  <span className="majsoul-sakura-right">
                    <FlatSakura size={19} fill="#4a0d0d" centerFill="#c23232" />
                  </span>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
