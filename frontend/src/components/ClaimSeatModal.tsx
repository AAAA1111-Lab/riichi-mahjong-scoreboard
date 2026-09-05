import React, { useState, useEffect } from 'react';
import type { GameState } from '../types';

interface ClaimSeatModalProps {
  isOpen: boolean;
  gameState: GameState;
  onConfirm: (playerId: number, name: string) => void;
}

const YONMA_SEAT_WINDS = ['东家 (起亲)', '南家', '西家', '北家'];
const SANMA_SEAT_WINDS = ['东家 (起亲)', '南家', '西家'];

// 默认玩家名（玩家 1/2/3/4）：不作为自定义昵称预填/持久化，跟随风位
const isDefaultPlayerName = (name: string): boolean => /^玩家\s*[1-4]$/.test(name.trim());

export const ClaimSeatModal: React.FC<ClaimSeatModalProps> = ({
  isOpen,
  gameState,
  onConfirm
}) => {
  const [playerName, setPlayerName] = useState('');

  // Auto initialize device bound player name when modal opens
  useEffect(() => {
    if (isOpen) {
      const savedName = localStorage.getItem('mahjong-player-name');
      if (savedName && savedName.trim() !== '' && !isDefaultPlayerName(savedName)) {
        setPlayerName(savedName.trim());
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const { connectedPlayers, players, gameMode } = gameState;
  const isSanma = gameMode === 'sanma' || players.length === 3;
  const seatWinds = isSanma ? SANMA_SEAT_WINDS : YONMA_SEAT_WINDS;
  const seatCount = isSanma ? 3 : 4;

  const handleClaim = (seatIdx: number) => {
    if (connectedPlayers[seatIdx]) return;

    const savedName = localStorage.getItem('mahjong-player-name');
    const customName = playerName.trim();
    const finalName = customName || savedName || players[seatIdx]?.name || `玩家 ${seatIdx + 1}`;

    if (customName && !isDefaultPlayerName(customName)) {
      localStorage.setItem('mahjong-player-name', customName);
    } else if (!customName && savedName && !isDefaultPlayerName(savedName)) {
      // Keep savedName
    } else {
      localStorage.removeItem('mahjong-player-name');
    }

    onConfirm(seatIdx, finalName);
  };

  const hasFreeSeat = Array.from({ length: seatCount }, (_, i) => i).some(i => !connectedPlayers[i]);

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h3 className="modal-title">加入对局：选择风位 ({isSanma ? '三人麻将' : '四人麻将'})</h3>
        </div>
        <div className="modal-body">
          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label className="form-label" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              选手昵称 (选填，绑定当前设备)
            </label>
            <input
              type="text"
              className="form-input"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const firstFreeSeat = Array.from({ length: seatCount }, (_, i) => i).find(i => !connectedPlayers[i]);
                  if (firstFreeSeat !== undefined) {
                    handleClaim(firstFreeSeat);
                  }
                }
              }}
              placeholder="留空则默认为席位名称"
              maxLength={10}
              autoFocus
            />
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
            请直接选择可选风位进入：
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {players.slice(0, seatCount).map((p, idx) => {
              const isClaimed = connectedPlayers[idx];
              const windLabel = seatWinds[idx];

              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isClaimed}
                  className={`btn ${isClaimed ? '' : 'btn-primary'}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    opacity: isClaimed ? 0.38 : 1,
                    border: isClaimed ? '1px solid #3d3434' : '1px solid var(--color-accent)',
                    cursor: isClaimed ? 'not-allowed' : 'pointer',
                    textAlign: 'left'
                  }}
                  onClick={() => handleClaim(idx)}
                >
                  <span>
                    <strong style={{ fontSize: '1.02rem', marginRight: '8px', color: isClaimed ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                      {windLabel}
                    </strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      ({p.name || `玩家 ${idx + 1}`})
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 'bold',
                      color: isClaimed ? 'var(--color-danger, #ff4d4f)' : 'var(--color-success, #2ec4b6)'
                    }}
                  >
                    {isClaimed ? '已连线' : '点击进入'}
                  </span>
                </button>
              );
            })}
          </div>

          {!hasFreeSeat && (
            <p style={{ fontSize: '0.82rem', color: 'var(--color-danger, #ff4d4f)', marginTop: '12px', textAlign: 'center' }}>
              当前所有席位均已连线，无法加入
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
