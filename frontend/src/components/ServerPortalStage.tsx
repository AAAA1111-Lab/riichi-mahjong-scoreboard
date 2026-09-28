import React, { useState } from 'react';
import type { Theme } from '../types';
import { AppFooter } from './AppFooter';
import { NumericRoomKeypad } from './NumericRoomKeypad';

interface ServerPortalStageProps {
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
  onRoomSelect: (roomId: string) => void;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
  deviceToken?: string;
}

/**
 * Server Edition Lobby / Portal Stage (Server 版对局大厅)
 *
 * 极简居中设计：
 * - 顶部保留分割线
 * - 标题（日麻计分板）
 * - 扁平化立直棒标志（与标题严格等宽，象牙白柱体 + 居中赤红点，无发光）
 * - 首次加载从上至下级联缓入
 * - 创建房间、加入房间按钮（中间插入“或”字，间距适度放大）
 * - 底栏（仅保留主题选择器）
 * - 内建数字输入器（点击“加入房间”时拉起）
 */
export const ServerPortalStage: React.FC<ServerPortalStageProps> = ({
  theme,
  onThemeChange,
  onRoomSelect,
  deviceToken
}) => {
  const [errorMessage, setErrorMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [isKeypadOpen, setIsKeypadOpen] = useState(false);

  // 1. Create room via server (unique 5-digit id; creator token bound as host)
  const handleCreateRoom = async () => {
    if (creating) return;
    setCreating(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameMode: 'yonma', token: deviceToken || '' })
      });
      const data = await res.json();
      if (data && data.success && data.roomId) {
        onRoomSelect(String(data.roomId));
      } else {
        setErrorMessage((data && data.message) || '创建房间失败，请稍后再试');
      }
    } catch (e) {
      setErrorMessage('创建房间失败，请检查网络后重试');
    } finally {
      setCreating(false);
    }
  };

  // 2. Join room with 5-digit input from numeric keypad
  const handleJoinRoomSubmit = async (roomId: string) => {
    const cleanRoom = roomId.trim();
    if (!/^\d{5}$/.test(cleanRoom)) {
      setErrorMessage('房间号必须为 5 位纯数字（10000 - 99999）');
      return;
    }
    setErrorMessage('');
    try {
      const res = await fetch(`/api/rooms/verify/${cleanRoom}`);
      const data = await res.json();
      if (data && data.success && !data.exists) {
        setErrorMessage('该房间不存在，请检查房间号');
        return;
      }
      onRoomSelect(cleanRoom);
    } catch (e) {
      onRoomSelect(cleanRoom);
    }
  };

  return (
    <div className="lobby-stage-wrapper">
      {/* Top Header Divider Line preserved */}
      <header className="lobby-top-header" aria-hidden="true" />

      {/* Centered Main Stage Content with Cascade Fade-in */}
      <main className="lobby-stage-main">
        <div className="lobby-stage-center">
          {/* Brand block: Title + Riichi Stick (equal width) */}
          <div className="lobby-brand lobby-fade-in-1">
            <h1 className="lobby-title">日麻计分板</h1>
            <div className="lobby-riichi-stick" title="立直棒" aria-hidden="true">
              <div className="lobby-riichi-stick-groove">
                <div className="lobby-riichi-stick-dot" />
              </div>
            </div>
          </div>

          {/* Action buttons with relaxed gap & "或" divider */}
          <div className="lobby-actions lobby-fade-in-2">
            <button
              type="button"
              onClick={handleCreateRoom}
              disabled={creating}
              className="btn btn-primary lobby-btn"
            >
              {creating ? '正在创建房间…' : '创建房间'}
            </button>

            {/* "或" divider between buttons */}
            <div className="lobby-divider-or" aria-hidden="true">
              <span className="lobby-divider-line" />
              <span className="lobby-divider-text">或</span>
              <span className="lobby-divider-line" />
            </div>

            <button
              type="button"
              onClick={() => {
                setErrorMessage('');
                setIsKeypadOpen(true);
              }}
              className="btn lobby-btn lobby-btn-secondary"
            >
              加入房间
            </button>

            {errorMessage && (
              <div className="lobby-error-tip">{errorMessage}</div>
            )}
          </div>
        </div>
      </main>

      {/* Footer: Only Theme Selector */}
      <AppFooter
        theme={theme || 'light'}
        onThemeChange={onThemeChange || (() => {})}
      />

      {/* Built-in Numeric Keypad */}
      <NumericRoomKeypad
        isOpen={isKeypadOpen}
        onClose={() => setIsKeypadOpen(false)}
        onSubmit={(code) => {
          setIsKeypadOpen(false);
          handleJoinRoomSubmit(code);
        }}
      />
    </div>
  );
};

export { ServerPortalStage as RoomPortalStage };
