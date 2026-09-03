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
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3 className="modal-title">修改玩家姓名</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">请输入新的玩家姓名</label>
              <input
                type="text"
                className="form-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="玩家姓名"
                maxLength={10}
                required
                autoFocus
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary">确认修改</button>
          </div>
        </form>
      </div>
    </div>
  );
};
