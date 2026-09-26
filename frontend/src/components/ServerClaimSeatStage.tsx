import React, { useState, useEffect } from 'react';
import type { GameState, Theme } from '../types';
import { AppFooter } from './AppFooter';

interface LobbyState {
  roomId?: string;
  locked?: boolean;
  started?: boolean;
  confirmedSeatIds?: number[];
  members?: { seatId: number | null; isHost: boolean }[];
  allConfirmed?: boolean;
}

interface ServerClaimSeatStageProps {
  gameState: GameState;
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
  onConfirm: (playerId: number, name: string) => void;
  roomId?: string;
  onBackToPortal?: () => void;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
  isHost?: boolean;
  onDisbandRoom?: () => void;
  lobby?: LobbyState | null;
  onStartGame?: (playerName: string, seatId?: number) => void;
  onMoveMember?: (fromSeat: number, toSeat: number) => void;
  onKickPlayer?: (playerId: number) => void;
  onSwapSeats?: (seatA: number, seatB: number) => void;
  onReleaseSeat?: () => void;
  deviceToken?: string;
}

const YONMA_SEAT_WINDS = ['东家', '南家', '西家', '北家'];
const SANMA_SEAT_WINDS = ['东家', '南家', '西家'];

const isDefaultPlayerName = (name: string): boolean => /^(?:玩家|选手)\s*[1-4]$/.test(name.trim());

/**
 * Server Edition First-Join Stage (Server 版选座准备阶段)
 *
 * 样式：完全复用 LAN 版 App.css 设计体系（claim-stage-* / claim-seat-* / app-header /
 * app-footer / btn / form-* 与主题变量），与 LAN 界面视觉一致。
 *
 * 权限模型（multi-room server 模式）：
 * - 成员：经房间号/URL 加入 → 选择席位（随机选座仅选中）→ 点"确认"完成选座准备；确认后可更改选座
 * - 房主：同成员流程可提前"锁定"自己的席位并可更改锁定；拥有移出成员（kick）权限；
 *   全员确认后"开始对局"（服务端校验全员确认并锁房，所有成员同步进入对局）
 */
export const ServerClaimSeatStage: React.FC<ServerClaimSeatStageProps> = ({
  gameState,
  theme,
  onThemeChange,
  onConfirm,
  roomId: propRoomId,
  onOpenSettings,
  onOpenShare,
  isHost,
  onDisbandRoom,
  lobby,
  onStartGame,
  onMoveMember,
  onKickPlayer,
  onSwapSeats,
  onReleaseSeat,
  deviceToken
}) => {
  const [selectedSeat, setSelectedSeat] = useState<number>(0);
  const [playerName, setPlayerName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const { connectedPlayers, players, gameMode, settings } = gameState;
  const isSanma = gameMode === 'sanma' || players.length === 3;
  const isTonpuu = (settings?.gameLength ?? 'hanchan') === 'tonpuu';
  const seatWinds = isSanma ? SANMA_SEAT_WINDS : YONMA_SEAT_WINDS;
  const seatCount = isSanma ? 3 : 4;

  // Extract room ID from prop, 5-digit pathname (/12345)
  const [roomId, setRoomId] = useState<string>(propRoomId || 'default');
  useEffect(() => {
    if (propRoomId) {
      setRoomId(propRoomId);
      return;
    }
    const pathMatch = window.location.pathname.match(/^\/(\d{5})\/?$/);
    if (pathMatch) {
      setRoomId(pathMatch[1]);
    }
  }, [propRoomId]);

  // 本设备已确认的席位：优先从 gameState.players 匹配本设备 token，次选 localStorage
  const mySeatRaw = typeof window !== 'undefined' ? localStorage.getItem(`mahjong-claimed-seat-${roomId}`) : null;
  const mySeatFromDevice = deviceToken
    ? players.findIndex((p, idx) => connectedPlayers[idx] && p.deviceId === deviceToken)
    : -1;
  const [movedSeat, setMovedSeat] = useState<number | null>(null);

  // 监听 seat-moved 自定义事件（由 App.tsx 触发）
  useEffect(() => {
    const handleSeatMoved = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail && typeof detail.seatId === 'number' && (!detail.roomId || detail.roomId === roomId)) {
        setMovedSeat(detail.seatId);
        setSelectedSeat(detail.seatId);
        localStorage.setItem(`mahjong-claimed-seat-${roomId}`, detail.seatId.toString());
      }
    };
    window.addEventListener('mahjong-seat-moved', handleSeatMoved);
    return () => window.removeEventListener('mahjong-seat-moved', handleSeatMoved);
  }, [roomId]);

  const mySeat = mySeatFromDevice !== -1
    ? mySeatFromDevice
    : (movedSeat !== null
        ? movedSeat
        : (mySeatRaw !== null && mySeatRaw !== '' ? parseInt(mySeatRaw, 10) : null));
  const mySeatConfirmed = mySeat !== null && (lobby?.confirmedSeatIds?.includes(mySeat) ?? connectedPlayers[mySeat] === true);

  // 当对端被房主交换席位且 mySeat 发生变更时，若当前不是房主，同步更新所选席位
  useEffect(() => {
    if (!isHost && mySeat !== null && mySeatConfirmed) {
      setSelectedSeat(mySeat);
      if (players[mySeat]?.name && !isDefaultPlayerName(players[mySeat].name)) {
        setPlayerName(players[mySeat].name);
      }
    }
  }, [isHost, mySeat, mySeatConfirmed, players]);

  useEffect(() => {
    const freeSeats = Array.from({ length: seatCount }, (_, i) => i).filter(i => !connectedPlayers[i]);
    const initSeat = freeSeats[0] ?? 0;
    setSelectedSeat(initSeat);

    const savedName = localStorage.getItem('mahjong-player-name');
    if (savedName && savedName.trim() !== '' && !isDefaultPlayerName(savedName)) {
      setPlayerName(savedName.trim());
    } else {
      const currentSeatName = players[initSeat]?.name;
      if (currentSeatName && !isDefaultPlayerName(currentSeatName)) {
        setPlayerName(currentSeatName);
      } else {
        setPlayerName('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 所选席位被他人确认占用时，自动改选首个空闲席位（仅限非房主，房主可选择占用席位进行交换或移出）
  useEffect(() => {
    if (!isHost && connectedPlayers[selectedSeat] && (!mySeatConfirmed || mySeat !== selectedSeat)) {
      const freeSeats = Array.from({ length: seatCount }, (_, i) => i).filter(i => !connectedPlayers[i]);
      if (freeSeats.length > 0) setSelectedSeat(freeSeats[0]);
    }
  }, [isHost, connectedPlayers, selectedSeat, seatCount, mySeatConfirmed, mySeat]);

  const handleSeatSelect = (idx: number) => {
    setSelectedSeat(idx);
    const savedName = localStorage.getItem('mahjong-player-name');
    if (savedName && savedName.trim() !== '' && !isDefaultPlayerName(savedName)) {
      setPlayerName(savedName.trim());
    } else {
      const currentSeatName = players[idx]?.name;
      if (currentSeatName && !isDefaultPlayerName(currentSeatName)) {
        setPlayerName(currentSeatName);
      } else {
        setPlayerName('');
      }
    }
  };

  // 随机选座：仅随机选中一个空闲席位，不确认（确认需点击下方"确认"按钮）
  const randomPick = () => {
    const freeSeats = Array.from({ length: seatCount }, (_, i) => i).filter(i => !connectedPlayers[i]);
    if (freeSeats.length === 0) {
      setErrorMessage('当前所有风位均已确认，无法再选择');
      return;
    }
    setErrorMessage('');
    setSelectedSeat(freeSeats[Math.floor(Math.random() * freeSeats.length)]);
  };

  const handleHostLockSeat = () => {
    const savedName = localStorage.getItem('mahjong-player-name');
    const customName = playerName.trim();
    const finalName = customName || (savedName && !isDefaultPlayerName(savedName) ? savedName : '') || `选手 ${selectedSeat + 1}`;

    if (customName && !isDefaultPlayerName(customName)) {
      localStorage.setItem('mahjong-player-name', customName);
    }

    // 若房主之前已锁定其他席位，先通知释放原席位，确保原席位恢复默认风位名称与未占用状态
    if (mySeatConfirmed && mySeat !== null && mySeat !== selectedSeat) {
      onReleaseSeat?.();
    }

    onConfirm(selectedSeat, finalName);
  };

  const handleHostUnlockSeat = () => {
    onReleaseSeat?.();
    localStorage.removeItem(`mahjong-claimed-seat-${roomId}`);
  };

  const handleSwapWithSeat = (targetSeat: number) => {
    if (mySeatConfirmed && mySeat !== null) {
      onSwapSeats?.(mySeat, targetSeat);
      localStorage.setItem(`mahjong-claimed-seat-${roomId}`, targetSeat.toString());
      setSelectedSeat(targetSeat);
    } else {
      const freeSeats = Array.from({ length: seatCount }, (_, i) => i).filter(i => !connectedPlayers[i] && i !== targetSeat);
      if (freeSeats.length > 0) {
        const destSeat = freeSeats[0];
        onMoveMember?.(targetSeat, destSeat);
        const savedName = localStorage.getItem('mahjong-player-name');
        const customName = playerName.trim();
        const finalName = customName || (savedName && !isDefaultPlayerName(savedName) ? savedName : '') || `选手 ${targetSeat + 1}`;
        if (customName && !isDefaultPlayerName(customName)) {
          localStorage.setItem('mahjong-player-name', customName);
        }
        onConfirm(targetSeat, finalName);
        setSelectedSeat(targetSeat);
      } else {
        setErrorMessage('当前无可用空闲席位进行交换');
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isHost) {
      handleHostLockSeat();
      return;
    }
    const savedName = localStorage.getItem('mahjong-player-name');
    const customName = playerName.trim();
    const finalName = customName || (savedName && !isDefaultPlayerName(savedName) ? savedName : '') || `选手 ${selectedSeat + 1}`;

    if (customName && !isDefaultPlayerName(customName)) {
      localStorage.setItem('mahjong-player-name', customName);
    }

    onConfirm(selectedSeat, finalName);
  };

  const handleSeatClick = (idx: number) => {
    const isOccupiedByOther = connectedPlayers[idx] && (!mySeatConfirmed || mySeat !== idx);
    if (!isHost && isOccupiedByOther) {
      return;
    }
    setErrorMessage('');
    handleSeatSelect(idx);
  };

  const isCurrentSelectionMyLockedSeat = Boolean(mySeatConfirmed && mySeat === selectedSeat);

  return (
    <div className="claim-stage-wrapper">
      {/* Header: Strictly locked 48px height across all themes, matches in-game layout, title text only */}
      <header
        className="app-header"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          width: '100%',
          height: '48px',
          minHeight: '48px',
          maxHeight: '48px',
          padding: '0 12px',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ gridColumn: 1, justifySelf: 'start', display: 'flex', alignItems: 'center', height: '30px' }}>
          {theme === 'electronic' && (
            <h1
              className="app-title"
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 800,
                height: '30px',
                lineHeight: '30px',
                display: 'inline-flex',
                alignItems: 'center',
                color: 'var(--color-accent)',
                letterSpacing: '0.5px'
              }}
            >
              日麻计分板
            </h1>
          )}
        </div>

        {theme !== 'electronic' && (
          <h1
            className="app-title"
            style={{
              gridColumn: 2,
              justifySelf: 'center',
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: 800,
              height: '30px',
              lineHeight: '30px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            日麻计分板
          </h1>
        )}

        <div style={{ gridColumn: 3, justifySelf: 'end', display: 'flex', alignItems: 'center', height: '30px' }} />
      </header>

      {/* Main Full-Screen Stage Body: No modal card boundaries, rendered directly on background */}
      <main className="claim-stage-main">
        <div className="claim-stage-content">
          <div className="claim-stage-heading">
            <h2 className="claim-stage-title">认领对局席位</h2>
            <p className="claim-stage-subtitle">
              {isHost
                ? (mySeatConfirmed
                    ? `已锁定 ${seatWinds[mySeat ?? 0]}，全员准备后点击"开始对局"`
                    : '选择席位并锁定，全员准备后点击"开始对局"')
                : (mySeatConfirmed
                    ? `已准备 ${seatWinds[mySeat ?? 0]}，等待房主开始对局`
                    : '选择席位并准备，等待房主开始对局')}
            </p>
            <div className="claim-stage-badge">
              {isSanma ? '三人麻将' : '四人麻将'} · {isTonpuu ? '东风战' : '半庄战'} · {roomId}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="claim-stage-form">
            {errorMessage && (
              <div className="claim-stage-error">
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              className="btn btn-secondary claim-stage-random-btn"
              onClick={randomPick}
            >
              随机摸风
            </button>

            <div className="claim-stage-seats-grid">
              {players.slice(0, seatCount).map((p, idx) => {
                const isConfirmed = connectedPlayers[idx];
                const isSelected = selectedSeat === idx;
                const isMyCurrentSeat = mySeatConfirmed && mySeat === idx;
                const isOccupiedByOther = isConfirmed && !isMyCurrentSeat;
                const windLabel = seatWinds[idx];

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    aria-disabled={!isHost && isOccupiedByOther}
                    className={`claim-seat-btn ${isSelected ? 'selected' : ''} ${!isHost && isOccupiedByOther ? 'occupied' : ''}`}
                    onClick={() => handleSeatClick(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSeatClick(idx);
                      }
                    }}
                  >
                    <div className="claim-seat-btn-left">
                      <span className="claim-seat-wind">{windLabel}</span>
                      <span className="claim-seat-player-name">
                        {p.name || `选手 ${idx + 1}`}
                        {isMyCurrentSeat && (isHost ? '（我 · 房主）' : '（我）')}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isMyCurrentSeat && isHost ? (
                        <span
                          className="claim-seat-tag tag-host-locked"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleHostUnlockSeat();
                          }}
                          title="点击解除锁定状态"
                        >
                          已锁定
                        </span>
                      ) : isConfirmed ? (
                        <span className="claim-seat-tag tag-claimed">已准备</span>
                      ) : (
                        <span className="claim-seat-tag tag-free">空闲</span>
                      )}
                    </div>

                    {/* 房主选择已被占用的席位时，弹出二级文本覆盖在选框上：左侧为交换席位，右侧为移出 */}
                    {isHost && isSelected && isOccupiedByOther && (
                      <div className="claim-seat-action-overlay">
                        <button
                          type="button"
                          className="claim-seat-overlay-action btn-swap"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSwapWithSeat(idx);
                          }}
                        >
                          交换席位
                        </button>
                        <div className="claim-seat-overlay-divider" />
                        <button
                          type="button"
                          className="claim-seat-overlay-action btn-kick"
                          onClick={(e) => {
                            e.stopPropagation();
                            onKickPlayer?.(idx);
                          }}
                        >
                          移出
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label" style={{ fontWeight: 600 }}>
                {isHost ? '房主名称' : '选手名称'}
              </label>
              <input
                type="text"
                className="form-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder={`选手 ${selectedSeat + 1}`}
                maxLength={10}
                required
              />
            </div>

            {isHost && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary claim-stage-submit-btn"
                  style={{ marginTop: 0 }}
                  onClick={isCurrentSelectionMyLockedSeat ? handleHostUnlockSeat : handleHostLockSeat}
                  disabled={Boolean(!isCurrentSelectionMyLockedSeat && connectedPlayers[selectedSeat])}
                >
                  {mySeatConfirmed
                    ? (isCurrentSelectionMyLockedSeat
                        ? '解除锁定'
                        : `更改锁定至 ${seatWinds[selectedSeat]}`)
                    : `锁定 ${seatWinds[selectedSeat]}`}
                </button>

                <button
                  type="button"
                  className="btn btn-primary claim-stage-submit-btn"
                  style={{ marginTop: 0 }}
                  onClick={() => onStartGame?.(playerName, mySeatConfirmed && mySeat !== null ? mySeat : selectedSeat)}
                  disabled={Boolean(!mySeatConfirmed && connectedPlayers[selectedSeat])}
                  title={!mySeatConfirmed && connectedPlayers[selectedSeat]
                    ? '所选席位已被成员占用，请更换座位或先锁定座位'
                    : '锁房并开始对局；未准备的成员将移回大厅'}
                >
                  开始对局
                </button>
              </div>
            )}

            {!isHost && (
              <button
                type="submit"
                className="btn btn-primary claim-stage-submit-btn"
                disabled={isCurrentSelectionMyLockedSeat || Boolean(!isCurrentSelectionMyLockedSeat && connectedPlayers[selectedSeat])}
              >
                {mySeatConfirmed
                  ? (selectedSeat !== mySeat ? `更改选座至 ${seatWinds[selectedSeat]}` : `已准备 (${seatWinds[selectedSeat]})`)
                  : `认领 ${seatWinds[selectedSeat]} 并准备`}
              </button>
            )}

            {!isHost && mySeatConfirmed && (
              <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                已准备 {seatWinds[mySeat ?? 0]} · 等待房主开始对局（可更改选座）
              </div>
            )}
          </form>
        </div>
      </main>

      {/* Footer Status Bar */}
      <AppFooter
        theme={theme || 'dark'}
        onThemeChange={onThemeChange || (() => {})}
        onOpenSettings={onOpenSettings}
        onOpenShare={onOpenShare}
        dangerAction={isHost && onDisbandRoom ? {
          label: '解散房间',
          onClick: onDisbandRoom,
          title: '房主解散当前房间'
        } : null}
      />
    </div>
  );
};
