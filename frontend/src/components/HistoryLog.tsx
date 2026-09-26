import React, { useRef, useEffect, useState } from 'react';
import type { GameState } from '../types';
import { ConfirmModal } from './ConfirmModal';

interface HistoryLogProps {
  gameState: GameState;
  canUndo: boolean;
  canRedo: boolean;
  historyCount?: number;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onRollback: (targetLogIndex: number) => void;
}

export const HistoryLog: React.FC<HistoryLogProps> = ({
  gameState,
  canUndo,
  canRedo,
  historyCount = 50,
  onUndo,
  onRedo,
  onReset,
  onRollback
}) => {
  const currentLog = gameState.log || [];
  const [displayedLog, setDisplayedLog] = useState<string[]>(currentLog);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [revokingIndices, setRevokingIndices] = useState<number[]>([]);
  const rollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const prevLogLengthRef = useRef(currentLog.length);
  const isInitialMount = useRef(true);

  // Modals state
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<{ index: number; text: string; steps: number } | null>(null);

  const isResettingRef = useRef(false);

  // Sync log and trigger rollback or forward scroll
  useEffect(() => {
    const listEl = historyListRef.current;
    const prevLen = prevLogLengthRef.current;
    prevLogLengthRef.current = currentLog.length;

    if (isInitialMount.current) {
      setDisplayedLog(currentLog);
      isInitialMount.current = false;
      requestAnimationFrame(() => {
        if (historyListRef.current) {
          historyListRef.current.scrollTop = historyListRef.current.scrollHeight;
        }
      });
      return;
    }

    // 显式重置对局（由重置弹窗确认触发、对局模式切换或收到后端对局重置日志）：立即重置，清空旧日志并滚动至顶部
    const isExplicitReset = isResettingRef.current || 
      currentLog[0]?.includes('对局重置') || 
      (currentLog.length === 1 && displayedLog.length > 0 && currentLog[0] !== displayedLog[0]);

    if (isExplicitReset) {
      isResettingRef.current = false;
      if (rollbackTimerRef.current) {
        clearTimeout(rollbackTimerRef.current);
        rollbackTimerRef.current = null;
      }
      setIsRollingBack(false);
      setRevokingIndices([]);
      setDisplayedLog(currentLog);
      if (listEl) {
        listEl.scrollTop = 0;
      }
      return;
    }

    if (currentLog.length < prevLen) {
      // Rollback (撤销 / 回退 / 撤销立直): 同向但反向平滑向上回滚
      if (!listEl) {
        setDisplayedLog(currentLog);
        return;
      }

      // 计算哪些项正在被撤销以触发平滑移出动效
      const removed: number[] = [];
      let cIdx = 0;
      for (let dIdx = 0; dIdx < displayedLog.length; dIdx++) {
        if (cIdx < currentLog.length && displayedLog[dIdx] === currentLog[cIdx]) {
          cIdx++;
        } else {
          removed.push(dIdx);
        }
      }
      if (removed.length === 0) {
        for (let i = currentLog.length; i < displayedLog.length; i++) {
          removed.push(i);
        }
      }
      setRevokingIndices(removed);

      // 计算目标项底部精确相对滚动位置
      const targetIndex = currentLog.length - 1;
      const items = listEl.querySelectorAll('.history-item');
      let targetScrollTop = 0;
      if (targetIndex >= 0 && items[targetIndex]) {
        const listRect = listEl.getBoundingClientRect();
        const targetRect = (items[targetIndex] as HTMLElement).getBoundingClientRect();
        const targetBottomInContent = (targetRect.bottom - listRect.top) + listEl.scrollTop;
        targetScrollTop = Math.max(0, Math.round(targetBottomInContent - listEl.clientHeight));
      }

      setIsRollingBack(true);
      listEl.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });

      if (rollbackTimerRef.current) {
        clearTimeout(rollbackTimerRef.current);
      }

      // 动画完成即撤销日志显示，恢复交互
      rollbackTimerRef.current = setTimeout(() => {
        setDisplayedLog(currentLog);
        setRevokingIndices([]);
        setIsRollingBack(false);
        rollbackTimerRef.current = null;
      }, 300);
    } else if (currentLog.length > prevLen) {
      // 顺向增加新日志 (自动向下滚动)
      if (rollbackTimerRef.current) {
        clearTimeout(rollbackTimerRef.current);
        rollbackTimerRef.current = null;
        setIsRollingBack(false);
      }
      setRevokingIndices([]);
      setDisplayedLog(currentLog);
    } else {
      setDisplayedLog(currentLog);
    }
  }, [currentLog]);

  const prevDisplayedLogLengthRef = useRef(displayedLog.length);

  // 新日志渲染到 DOM 后执行平滑自动向下滚动（仅在新增日志时触发，撤销/回滚完成时严禁自动向下滚动）
  useEffect(() => {
    const prevLen = prevDisplayedLogLengthRef.current;
    prevDisplayedLogLengthRef.current = displayedLog.length;

    if (!isRollingBack && !isInitialMount.current && displayedLog.length > prevLen) {
      requestAnimationFrame(() => {
        if (historyListRef.current) {
          historyListRef.current.scrollTo({
            top: historyListRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      });
    }
  }, [displayedLog.length, isRollingBack]);

  // 回滚期间严格拦截滚轮与手势拖动，禁用手动滚动
  useEffect(() => {
    const listEl = historyListRef.current;
    if (!listEl || !isRollingBack) return;

    const preventScroll = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    listEl.addEventListener('wheel', preventScroll, { passive: false });
    listEl.addEventListener('touchmove', preventScroll, { passive: false });
    listEl.addEventListener('keydown', preventScroll, { passive: false });

    return () => {
      listEl.removeEventListener('wheel', preventScroll);
      listEl.removeEventListener('touchmove', preventScroll);
      listEl.removeEventListener('keydown', preventScroll);
    };
  }, [isRollingBack]);

  useEffect(() => {
    return () => {
      if (rollbackTimerRef.current) {
        clearTimeout(rollbackTimerRef.current);
      }
    };
  }, []);

  const handleLogItemClick = (idx: number, item: string) => {
    if (!displayedLog || isRollingBack) return;
    const currentLatestIdx = displayedLog.length - 1;
    if (idx === currentLatestIdx) return; // Already current state

    const steps = currentLatestIdx - idx;
    if (steps > historyCount) return; // Exceeds history stack

    setRollbackTarget({ index: idx, text: item, steps });
  };

  const handleConfirmRollback = () => {
    if (rollbackTarget !== null) {
      onRollback(rollbackTarget.index);
      setRollbackTarget(null);
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
            disabled={!canUndo || isRollingBack}
            title="撤销"
            style={{ padding: '6px 0', fontSize: '0.8rem', fontWeight: 'bold', width: '64px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            撤销
          </button>
          <button
            type="button"
            className="btn btn-preset"
            onClick={onRedo}
            disabled={!canRedo || isRollingBack}
            title="重做"
            style={{ padding: '6px 0', fontSize: '0.8rem', fontWeight: 'bold', width: '64px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            重做
          </button>
          <button
            type="button"
            className="btn btn-preset btn-danger"
            onClick={() => setIsResetConfirmOpen(true)}
            title="重置"
            style={{ padding: '6px 0', fontSize: '0.8rem', fontWeight: 'bold', width: '64px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            重置
          </button>
        </div>
      </div>

      <div className={`history-list ${isRollingBack ? 'is-rolling-back' : ''}`} ref={historyListRef}>
        {displayedLog && displayedLog.length > 0 ? (
          displayedLog.map((item, idx) => {
            const latestIndex = isRollingBack ? currentLog.length - 1 : displayedLog.length - 1;
            const isLatest = idx === latestIndex;
            const isCurrent = idx === displayedLog.length - 1;
            const steps = (displayedLog.length - 1) - idx;
            const canRollback = !isCurrent && steps <= historyCount && !isRollingBack;
            const isRevoking = isRollingBack && revokingIndices.includes(idx);
            const itemClasses = `history-item ${isLatest ? 'is-latest' : ''} ${canRollback ? 'history-item-clickable' : ''} ${isRevoking ? 'is-revoking' : ''}`;

            const isSettlement = /^\[[^\]]+\|[^\]]+\]\[(?:自摸|荣和|多家和了|放铳|荒牌流局|流局|流局满贯|诈和|立直)\]/.test(item);
            if (isSettlement) {
              const match = item.match(/^(\[[^\]]+\]\[[^\]]+\])\s*([\s\S]*)$/);
              if (match && match[2]) {
                return (
                  <div
                    key={idx}
                    className={`${itemClasses} history-item-multiline`}
                    onClick={() => canRollback && handleLogItemClick(idx, item)}
                  >
                    <div className="history-item-tags">
                      {match[1]}
                    </div>
                    <div className="history-item-details">
                      {match[2].trimStart()}
                    </div>
                  </div>
                );
              }
            }

            // Multiline logs (e.g. multi-item rule changes)
            if (item.includes('\n')) {
              const lines = item.split('\n');
              return (
                <div
                  key={idx}
                  className={`${itemClasses} history-item-multiline`}
                  onClick={() => canRollback && handleLogItemClick(idx, item)}
                >
                  <div className="history-item-tags">
                    {lines[0]}
                  </div>
                  <div className="history-item-details">
                    {lines.slice(1).join('\n')}
                  </div>
                </div>
              );
            }

            // 对局初始化日志：独占两行（标签独占一行，详细参数第二行），锁定标准双行高度
            if (item.startsWith('[对局初始化]')) {
              const initMatch = item.match(/^(\[对局初始化\])\s*([\s\S]*)$/);
              if (initMatch && initMatch[2]) {
                return (
                  <div
                    key={idx}
                    className={`${itemClasses} history-item-multiline`}
                    onClick={() => canRollback && handleLogItemClick(idx, item)}
                  >
                    <div className="history-item-tags">{initMatch[1]}</div>
                    <div className="history-item-details">{initMatch[2].trimStart()}</div>
                  </div>
                );
              }
            }

            // 其他单行文本日志改回单行内联格式
            const tagMatch = item.match(/^(\[[^\]]+\](?:\s*\[[^\]]+\])?)\s*([\s\S]*)$/);
            if (tagMatch && tagMatch[2]) {
              return (
                <div
                  key={idx}
                  className={`${itemClasses} history-item-single`}
                  onClick={() => canRollback && handleLogItemClick(idx, item)}
                >
                  <span className="history-item-inline-tag">{tagMatch[1]}</span>{' '}
                  <span className="history-item-inline-content">{tagMatch[2].trimStart()}</span>
                </div>
              );
            }

            return (
              <div
                key={idx}
                className={`${itemClasses} history-item-single`}
                onClick={() => canRollback && handleLogItemClick(idx, item)}
              >
                {item}
              </div>
            );
          })
        ) : (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '8px' }}>
            暂无记录
          </div>
        )}
      </div>

      {/* Reset Confirmation Modal */}
      <ConfirmModal
        isOpen={isResetConfirmOpen}
        title="重置对局"
        isDanger={true}
        confirmText="确认重置"
        cancelText="取消"
        message="当前对局的数据不会被保存"
        onConfirm={() => {
          isResettingRef.current = true;
          setIsResetConfirmOpen(false);
          onReset();
        }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />

      {/* Rollback Confirmation Modal */}
      {rollbackTarget && (
        <ConfirmModal
          isOpen={true}
          title="回退对局记录"
          confirmText="确认回退"
          cancelText="取消"
          message={
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                确定回退到此记录？后续记录将被清除
              </p>
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px',
                  borderLeft: '3px solid var(--color-accent)',
                  fontSize: '0.8rem',
                  lineHeight: 1.4,
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {rollbackTarget.text}
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                将撤销其后 <strong>{rollbackTarget.steps}</strong> 步操作
              </p>
            </div>
          }
          onConfirm={handleConfirmRollback}
          onCancel={() => setRollbackTarget(null)}
        />
      )}
    </div>
  );
};

