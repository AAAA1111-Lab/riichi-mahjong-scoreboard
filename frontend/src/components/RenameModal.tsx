import React, { useState, useEffect } from 'react';
import type { Player } from '../types';

interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  player: Player | null;
  onConfirm: (playerId: number, newName: string) => void;
}

export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  onClose,
  player,
  onConfirm
}) => {
  const [playerName, setPlayerName] = useState('');

  useEffect(() => {
    if (player) {
      setPlayerName(player.name);
    }
  }, [player, isOpen]);

  if (!isOpen || !player) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerName.trim()) {
      onConfirm(player.id, playerName.trim());
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3 className="dialog-title">修改选手名称</h3>
          <button type="button" className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ padding: '8px 0' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>输入新名称（最多10字）</label>
              <input
                type="text"
                className="form-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="请输入选手名称"
                maxLength={10}
                required
              />
            </div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary dialog-btn" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary dialog-btn">确认</button>
          </div>
        </form>
      </div>
    </div>
  );
};
