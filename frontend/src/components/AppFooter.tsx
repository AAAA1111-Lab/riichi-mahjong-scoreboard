import React, { useState, useRef, useEffect } from 'react';
import type { Theme } from '../types';

export interface AppFooterProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
  leftAction?: {
    label: string;
    onClick: () => void;
    title?: string;
  } | null;
  dangerAction?: {
    label: string;
    onClick: () => void;
    title?: string;
  } | null;
}

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'rexx', label: 'REXX' },
  { id: 'electronic', label: '电子' },
  { id: 'majsoul', label: '类魂' }
];

export const AppFooter: React.FC<AppFooterProps> = ({
  theme,
  onThemeChange,
  onOpenSettings,
  onOpenShare,
  leftAction,
  dangerAction
}) => {
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const themeContainerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
  });

  const [isFsSupported, setIsFsSupported] = useState<boolean>(true);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const doc = document as any;
    const docEl = doc.documentElement;
    const supported = !!(
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled ||
      docEl?.requestFullscreen ||
      docEl?.webkitRequestFullscreen ||
      docEl?.mozRequestFullScreen ||
      docEl?.msRequestFullscreen
    );
    setIsFsSupported(supported);

    const handleFsChange = () => {
      const fsNow = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
      setIsFullscreen(fsNow);
      if (fsNow) {
        doc.documentElement.classList.add('is-fullscreen');
      } else {
        doc.documentElement.classList.remove('is-fullscreen');
      }
    };
    handleFsChange();

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    document.addEventListener('mozfullscreenchange', handleFsChange);
    document.addEventListener('MSFullscreenChange', handleFsChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      document.removeEventListener('mozfullscreenchange', handleFsChange);
      document.removeEventListener('MSFullscreenChange', handleFsChange);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      const doc = document as any;
      const docEl = doc.documentElement as any;
      const isFs = !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      );

      if (!isFs) {
        doc.documentElement.classList.add('is-fullscreen');
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          await docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          await docEl.msRequestFullscreen();
        }
      } else {
        doc.documentElement.classList.remove('is-fullscreen');
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  useEffect(() => {
    if (!isThemeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (themeContainerRef.current && !themeContainerRef.current.contains(e.target as Node)) {
        setIsThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isThemeOpen]);

  return (
    <footer className="app-footer">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {leftAction && (
          <span
            onClick={leftAction.onClick}
            style={{
              cursor: 'pointer',
              textDecoration: 'underline',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem'
            }}
            title={leftAction.title || leftAction.label}
          >
            {leftAction.label}
          </span>
        )}
        {dangerAction && (
          <span
            onClick={dangerAction.onClick}
            style={{
              cursor: 'pointer',
              textDecoration: 'underline',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              marginLeft: leftAction ? '10px' : '0'
            }}
            title={dangerAction.title || dangerAction.label}
          >
            {dangerAction.label}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {onOpenShare && (
          <button
            type="button"
            className="btn"
            style={{
              width: '64px',
              height: '30px',
              padding: '6px 0',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box'
            }}
            onClick={onOpenShare}
            title="对局分享二维码"
          >
            分享
          </button>
        )}
        {onOpenSettings && (
          <button
            type="button"
            className="btn"
            style={{
              width: '64px',
              height: '30px',
              padding: '6px 0',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box'
            }}
            onClick={onOpenSettings}
            title="对局规则设置"
          >
            设置
          </button>
        )}

        {/* Modern Floating Popover Theme Selector */}
        <div ref={themeContainerRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className={`btn theme-trigger-btn ${isThemeOpen ? 'is-open' : ''}`}
            onClick={() => setIsThemeOpen(prev => !prev)}
            title="选择界面主题"
          >
            <span>主题</span>
          </button>

          {isThemeOpen && (
            <div className="theme-picker-card">
              {THEME_OPTIONS.map((t) => {
                const isSelected = t.id === theme;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-picker-item ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      onThemeChange(t.id);
                      setIsThemeOpen(false);
                    }}
                  >
                    <span>{t.label}</span>
                    {isSelected && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}

              {isFsSupported && (
                <>
                  <div
                    style={{
                      height: '1px',
                      backgroundColor: 'var(--border-color)',
                      margin: '4px 0',
                      opacity: 0.8
                    }}
                  />
                  <button
                    type="button"
                    className="theme-picker-item"
                    onClick={() => {
                      handleToggleFullscreen();
                      setIsThemeOpen(false);
                    }}
                    title={isFullscreen ? '退出全屏模式' : '进入全屏模式'}
                  >
                    <span>{isFullscreen ? '退出全屏' : '全屏显示'}</span>
                    {isFullscreen ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ opacity: 0.8 }}
                      >
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ opacity: 0.8 }}
                      >
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      </svg>
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
};
