import React, { useState, useEffect, useCallback } from 'react';

interface NumericRoomKeypadProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (roomId: string) => void;
}

export const NumericRoomKeypad: React.FC<NumericRoomKeypadProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [digits, setDigits] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Reset digits when reopened
  useEffect(() => {
    if (isOpen) {
      setDigits('');
      setError('');
    }
  }, [isOpen]);

  const handleInputDigit = useCallback((d: string) => {
    setDigits(prev => {
      if (prev.length >= 5) return prev;
      setError('');
      return prev + d;
    });
  }, []);

  const handleDeleteDigit = useCallback(() => {
    setDigits(prev => {
      setError('');
      return prev.slice(0, -1);
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setDigits('');
    setError('');
  }, []);

  const handleSubmit = useCallback(() => {
    if (digits.length !== 5) {
      setError('请输入完整的 5 位数字房间号');
      return;
    }
    setError('');
    onSubmit(digits);
  }, [digits, onSubmit]);

  // Physical keyboard listener for desktop users
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleInputDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteDigit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (digits.length === 5) {
          handleSubmit();
        } else {
          setError('请输入完整的 5 位数字房间号');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, digits, handleInputDigit, handleDeleteDigit, handleSubmit, onClose]);

  if (!isOpen) return null;

  return (
    <div className="numeric-keypad-overlay" onClick={onClose}>
      <div
        className="numeric-keypad-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="输入房间号"
      >
        {/* Grab indicator handle */}
        <div className="keypad-grab-bar" />

        {/* Sheet Header */}
        <div className="keypad-header">
          <h3 className="keypad-title">加入对局房间</h3>
          <button
            type="button"
            className="keypad-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            &times;
          </button>
        </div>

        {/* 5-digit PIN slots */}
        <div className="keypad-pin-container">
          {Array.from({ length: 5 }).map((_, idx) => {
            const char = digits[idx] || '';
            const isActive = idx === digits.length;
            return (
              <div
                key={idx}
                className={`keypad-pin-slot ${isActive ? 'is-active' : ''} ${char ? 'is-filled' : ''}`}
              >
                {char ? (
                  <span>{char}</span>
                ) : (
                  <span className="keypad-pin-placeholder" />
                )}
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {error ? (
          <div className="keypad-error-tip">{error}</div>
        ) : (
          <div className="keypad-hint-tip">输入 5 位数字房间号进入对局</div>
        )}

        {/* 3x4 Virtual Numeric Grid */}
        <div className="keypad-grid">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              className="keypad-key-btn"
              onClick={() => handleInputDigit(num)}
            >
              {num}
            </button>
          ))}

          {/* Bottom row: Clear, 0, Backspace */}
          <button
            type="button"
            className="keypad-key-btn keypad-func-btn"
            onClick={handleClearAll}
            title="清空"
          >
            清空
          </button>
          <button
            type="button"
            className="keypad-key-btn"
            onClick={() => handleInputDigit('0')}
          >
            0
          </button>
          <button
            type="button"
            className="keypad-key-btn keypad-func-btn"
            onClick={handleDeleteDigit}
            title="退格"
            aria-label="退格"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: 'block' }}
            >
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        </div>

        {/* Confirm Action Button */}
        <button
          type="button"
          disabled={digits.length !== 5}
          className="btn btn-primary keypad-submit-btn"
          onClick={handleSubmit}
        >
          进入对局房间
        </button>
      </div>
    </div>
  );
};
