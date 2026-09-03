import React from 'react';
import type { GameState } from '../types';

interface HistoryLogProps {
  gameState: GameState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
}

export const HistoryLog: React.FC<HistoryLogProps> = ({
  gameState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReset
}) => {
  const { log } = gameState;

  const handleResetConfirm = () => {
    if (window.confirm('您确定要重置当前对局吗？这将会清空所有分数并恢复初始状态。')) {
      onReset();
    }
  };

  return (
    <div className="history-section">
      <div className="history-header">
        <h4 className="history-title">对局变更记录</h4>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="btn btn-preset"
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销"
            style={{ padding: '6px 0', fontSize: '0.8rem', fontWeight: 'bold', width: '64px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            撤销
          </button>
          <button
            type="button"
            className="btn btn-preset"
            onClick={onRedo}
            disabled={!canRedo}
            title="重做"
            style={{ padding: '6px 0', fontSize: '0.8rem', fontWeight: 'bold', width: '64px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            重做
          </button>
          <button
            type="button"
            className="btn btn-preset btn-danger"
            onClick={handleResetConfirm}
            title="重置"
            style={{ padding: '6px 0', fontSize: '0.8rem', fontWeight: 'bold', width: '64px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            重置
          </button>
        </div>
      </div>
      <div className="history-list">
        {log && log.length > 0 ? (
          log.map((item, idx) => (
            <div key={idx} className="history-item">
              {item}
            </div>
          ))
        ) : (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '8px' }}>
            暂无记录
          </div>
        )}
      </div>
    </div>
  );
};
