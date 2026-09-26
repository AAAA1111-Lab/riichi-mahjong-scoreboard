import React, { useState, useEffect } from 'react';
import type { GameState, Theme } from '../types';
import { AppFooter } from './AppFooter';

interface LanClaimSeatStageProps {
  gameState: GameState;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onConfirm: (playerId: number, name: string) => void;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
}

export type ClaimSeatStageProps = LanClaimSeatStageProps;

const YONMA_SEAT_WINDS = ['东家', '南家', '西家', '北家'];
const SANMA_SEAT_WINDS = ['东家', '南家', '西家'];

// 默认选手名（选手 1/2/3/4）：不作为自定义名称预填/持久化，跟随风位
const isDefaultPlayerName = (name: string): boolean => /^(?:玩家|选手)\s*[1-4]$/.test(name.trim());

export const LanClaimSeatStage: React.FC<LanClaimSeatStageProps> = ({
  gameState,
  theme,
  onThemeChange,
  onConfirm,
  onOpenSettings,
  onOpenShare
}) => {
  const [selectedSeat, setSelectedSeat] = useState<number>(0);
  const [playerName, setPlayerName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const { connectedPlayers, players, gameMode } = gameState;
  const isSanma = gameMode === 'sanma' || players.length === 3;
  const seatWinds = isSanma ? SANMA_SEAT_WINDS : YONMA_SEAT_WINDS;

  // Auto initialize device bound player name and seat
  useEffect(() => {
    const count = isSanma ? 3 : 4;
    const freeSeats = Array.from({ length: count }, (_, i) => i).filter(i => !connectedPlayers[i]);
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
        setPlayerName(`选手 ${initSeat + 1}`);
      }
    }
  }, []);

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
        setPlayerName(`选手 ${idx + 1}`);
      }
    }
  };

  // 随机摸风：直接选定随机可用风位进入
  const randomSeat = () => {
    const count = isSanma ? 3 : 4;
    const freeSeats = Array.from({ length: count }, (_, i) => i).filter(i => !connectedPlayers[i]);
    if (freeSeats.length === 0) {
      setErrorMessage('当前所有风位均已连线，无法加入');
      return;
    }
    setErrorMessage('');
    const pickedSeat = freeSeats[Math.floor(Math.random() * freeSeats.length)];
    const savedName = localStorage.getItem('mahjong-player-name');
    const customName = playerName.trim();
    const finalName = customName || (savedName && !isDefaultPlayerName(savedName) ? savedName : '') || players[pickedSeat]?.name || `选手 ${pickedSeat + 1}`;

    if (customName && !isDefaultPlayerName(customName)) {
      localStorage.setItem('mahjong-player-name', customName);
    } else if (!customName && savedName && !isDefaultPlayerName(savedName)) {
      // keep
    } else {
      localStorage.removeItem('mahjong-player-name');
    }

    onConfirm(pickedSeat, finalName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const savedName = localStorage.getItem('mahjong-player-name');
    const customName = playerName.trim();
    const finalName = customName || (savedName && !isDefaultPlayerName(savedName) ? savedName : '') || `选手 ${selectedSeat + 1}`;

    if (customName && !isDefaultPlayerName(customName)) {
      localStorage.setItem('mahjong-player-name', customName);
    } else if (!customName && savedName && !isDefaultPlayerName(savedName)) {
      // keep
    } else {
      localStorage.removeItem('mahjong-player-name');
    }

    onConfirm(selectedSeat, finalName);
  };

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
            <p className="claim-stage-subtitle">选择席位加入对局（名称与设备绑定）</p>
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
              onClick={randomSeat}
            >
              随机摸风
            </button>

            <div className="claim-stage-seats-grid">
              {players.slice(0, isSanma ? 3 : 4).map((p, idx) => {
                const isClaimed = connectedPlayers[idx];
                const isSelected = selectedSeat === idx;
                const windLabel = seatWinds[idx];

                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isClaimed && !isSelected}
                    className={`claim-seat-btn ${isSelected ? 'selected' : ''} ${isClaimed && !isSelected ? 'occupied' : ''}`}
                    onClick={() => {
                      setErrorMessage('');
                      handleSeatSelect(idx);
                    }}
                  >
                    <div className="claim-seat-btn-left">
                      <span className="claim-seat-wind">{windLabel}</span>
                      <span className="claim-seat-player-name">{p.name || `选手 ${idx + 1}`}</span>
                    </div>
                    <span className={`claim-seat-tag ${isClaimed ? 'tag-claimed' : 'tag-free'}`}>
                      {isClaimed ? '占用' : '空闲'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label" style={{ fontWeight: 600 }}>选手名称</label>
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

            <button
              type="submit"
              className="btn btn-primary claim-stage-submit-btn"
            >
              认领 {seatWinds[selectedSeat]} 并进入对局
            </button>
          </form>
        </div>
      </main>

      {/* Footer Status Bar */}
      <AppFooter
        theme={theme}
        onThemeChange={onThemeChange}
        onOpenSettings={onOpenSettings}
        onOpenShare={onOpenShare}
      />
    </div>
  );
};

export { LanClaimSeatStage as ClaimSeatStage };
