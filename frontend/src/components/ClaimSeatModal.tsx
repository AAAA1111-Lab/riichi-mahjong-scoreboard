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
  const [selectedSeat, setSelectedSeat] = useState<number>(0);
  const [playerName, setPlayerName] = useState('');

  // Auto initialize device bound player name when modal opens
  useEffect(() => {
    if (isOpen) {
      // 默认选中东起位（座位 0）；若被占用则选第一个空闲座位
      const count = gameState.gameMode === 'sanma' || gameState.players.length === 3 ? 3 : 4;
      const freeSeats = Array.from({ length: count }, (_, i) => i).filter(i => !gameState.connectedPlayers[i]);
      setSelectedSeat(freeSeats[0] ?? 0);
      const savedName = localStorage.getItem('mahjong-player-name');
      if (savedName && savedName.trim() !== '' && !isDefaultPlayerName(savedName)) {
        setPlayerName(savedName.trim());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const { connectedPlayers, players, gameMode } = gameState;
  const isSanma = gameMode === 'sanma' || players.length === 3;
  const seatWinds = isSanma ? SANMA_SEAT_WINDS : YONMA_SEAT_WINDS;

  const handleSeatSelect = (idx: number) => {
    setSelectedSeat(idx);
    const savedName = localStorage.getItem('mahjong-player-name');
    if (savedName && savedName.trim() !== '' && !isDefaultPlayerName(savedName)) {
      setPlayerName(savedName.trim());
    } else {
      const currentSeatName = players[idx]?.name;
      if (currentSeatName && !currentSeatName.startsWith('玩家 ')) {
        setPlayerName(currentSeatName);
      } else {
        setPlayerName(`玩家 ${idx + 1}`);
      }
    }
  };

  // 随机摸风：在空闲座位中随机选一个
  const randomSeat = () => {
    const count = isSanma ? 3 : 4;
    const freeSeats = Array.from({ length: count }, (_, i) => i).filter(i => !connectedPlayers[i]);
    if (freeSeats.length > 0) {
      handleSeatSelect(freeSeats[Math.floor(Math.random() * freeSeats.length)]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const savedName = localStorage.getItem('mahjong-player-name');
    const finalName = playerName.trim() || savedName || `玩家 ${selectedSeat + 1}`;
    // 默认格式名字不持久化为自定义昵称，避免重置后残留上一局默认名
    if (!isDefaultPlayerName(finalName)) {
      localStorage.setItem('mahjong-player-name', finalName);
    } else {
      localStorage.removeItem('mahjong-player-name');
    }
    onConfirm(selectedSeat, finalName);
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h3 className="modal-title">首次加入：请认领您的风位 (${isSanma ? '三人麻将' : '四人麻将'})</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              请选择桌上的风位 (${isSanma ? '东/南/西' : '东/南/西/北'}) 加入对局。您的选手名称将跟随设备绑定。
            </p>
            
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', marginBottom: '8px', padding: '10px', fontSize: '0.85rem', fontWeight: 600 }}
              onClick={randomSeat}
            >
              随机摸风
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {players.slice(0, isSanma ? 3 : 4).map((p, idx) => {
                const isClaimed = connectedPlayers[idx];
                const isSelected = selectedSeat === idx;
                const windLabel = seatWinds[idx];
                
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isClaimed && !isSelected}
                    className={`btn ${isSelected ? 'btn-primary' : ''}`}
                    style={{ 
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      opacity: isClaimed && !isSelected ? 0.35 : 1,
                      border: isSelected ? '1px solid var(--color-accent)' : '1px solid #4a3a3a',
                      textAlign: 'left'
                    }}
                    onClick={() => handleSeatSelect(idx)}
                  >
                    <span>
                      <strong style={{ fontSize: '1.02rem', marginRight: '8px', color: 'var(--text-primary)' }}>
                        {windLabel}
                      </strong>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        ({p.name || `玩家 ${idx + 1}`})
                      </span>
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isClaimed ? 'var(--color-danger, #ff4d4f)' : 'var(--color-success, #2ec4b6)' }}>
                      {isClaimed ? '已连线' : '空闲'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label">输入或确认您的选手昵称 (绑定当前设备)</label>
              <input
                type="text"
                className="form-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder={`玩家 ${selectedSeat + 1}`}
                maxLength={10}
                required
                autoFocus
              />
            </div>
          </div>
          
          <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
            >
              认领 {seatWinds[selectedSeat]}，进入计分板
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
