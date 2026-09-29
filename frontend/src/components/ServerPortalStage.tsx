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
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);

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

  const handleFeedbackSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendingFeedback) return;

    const message = feedbackText.trim();
    if (message.length < 5) {
      setFeedbackError('建议至少填写 5 个字');
      return;
    }

    setSendingFeedback(true);
    setFeedbackError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setFeedbackError(data?.message || '提交失败，请稍后再试');
        return;
      }
      setFeedbackSent(true);
      setFeedbackText('');
    } catch {
      setFeedbackError('提交失败，请检查网络后重试');
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <div className="lobby-stage-wrapper">
      {/* Top Header Divider Line preserved */}
      <header className="lobby-top-header">
        <a
          className="lobby-header-github"
          href="https://github.com/AAAA1111-Lab/riichi-mahjong-scoreboard"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开 GitHub 仓库（新标签页）"
          title="GitHub 仓库"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.33-3.8-1.33-.5-1.3-1.24-1.64-1.24-1.64-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 .72 2.52.5 3.13.38.1-.72.39-1.21.7-1.49-2.5-.28-5.14-1.25-5.14-5.57 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.13-1.45 3.07-1.15 3.07-1.15.61 1.55.23 2.7.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.33-2.64 5.28-5.15 5.56.4.35.75 1.03.75 2.08v3.08c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" />
          </svg>
        </a>

        <button
          type="button"
          className="lobby-header-feedback"
          onClick={() => {
            setFeedbackError('');
            setFeedbackSent(false);
            setIsFeedbackOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" />
            <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
          </svg>
          <span>匿名建议</span>
        </button>
      </header>

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

      {isFeedbackOpen && (
        <div
          className="lobby-feedback-backdrop"
          onClick={() => setIsFeedbackOpen(false)}
        >
          <section
            className="lobby-feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lobby-feedback-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="lobby-feedback-heading">
              <h2 id="lobby-feedback-title">匿名建议</h2>
              <button
                type="button"
                className="lobby-feedback-close"
                aria-label="关闭建议窗口"
                onClick={() => setIsFeedbackOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="lobby-feedback-note">无需填写身份信息。请勿在建议中留下联系方式或其他个人信息。</p>
            <form onSubmit={handleFeedbackSubmit}>
              <label className="lobby-feedback-label" htmlFor="lobby-feedback-message">你希望改进什么？</label>
              <textarea
                id="lobby-feedback-message"
                className="lobby-feedback-input"
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                maxLength={1000}
                minLength={5}
                rows={5}
                placeholder="描述你的想法或遇到的问题…"
                required
                disabled={feedbackSent}
              />
              <div className="lobby-feedback-form-footer">
                <span className="lobby-feedback-counter">{feedbackText.length}/1000</span>
                {!feedbackSent && (
                  <button type="submit" className="lobby-feedback-submit" disabled={sendingFeedback}>
                    {sendingFeedback ? '正在提交…' : '提交建议'}
                  </button>
                )}
              </div>
              {feedbackError && <p className="lobby-feedback-message error" role="alert">{feedbackError}</p>}
              {feedbackSent && <p className="lobby-feedback-message success" role="status">收到建议，谢谢！</p>}
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export { ServerPortalStage as RoomPortalStage };
