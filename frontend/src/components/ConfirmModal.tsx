import React, { useEffect } from 'react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  isDanger = false,
  showCancel = true,
  onConfirm,
  onCancel
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel} style={{ zIndex: 9999 }}>
      <div
        className="dialog-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="dialog-header">
          <h3 className="dialog-title">{title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="关闭"
          >
            &times;
          </button>
        </div>

        <div className="dialog-body">
          {typeof message === 'string' ? (
            <p className="dialog-message-text">{message}</p>
          ) : (
            message
          )}
        </div>

        <div className="dialog-footer">
          {showCancel && (
            <button
              type="button"
              className="btn btn-secondary dialog-btn"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'} dialog-btn`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
