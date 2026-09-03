import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import type { Theme, GameState, Player } from './types';
import { ScoreBoard } from './components/ScoreBoard';
import { RenameModal } from './components/RenameModal';
import { HandInputModal } from './components/HandInputModal';
import { ClaimSeatModal } from './components/ClaimSeatModal';
import { HistoryLog } from './components/HistoryLog';
import { LedDigitDisplay } from './components/LedDigitDisplay';
import { HonbaLedBar } from './components/HonbaLedBar';
import { RiichiStickDisplay } from './components/RiichiStickDisplay';
import './App.css';

// Initialize WebSocket connection.
// In development mode, connect to backend at localhost:32000.
// In production (served by Express), connect to the page's host origin.
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:32000' : window.location.origin;
const socket: Socket = io(SOCKET_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity, // 无限重试，持续保活
  reconnectionDelay: 400, // 初始重连间隔缩短至 400ms (高频重试)
  reconnectionDelayMax: 1200, // 最大重连间隔控制在 1.2s 以内
  timeout: 4000, // 握手超时 4s
});

// 默认风位 ID 格式（玩家 1/2/3/4 或 dev_seat_N），不作为有效设备 ID
function isDefaultDeviceId(id: string): boolean {
  return id.startsWith('dev_seat_') || /^玩家\s*[1-4]$/.test(id);
}

// 默认玩家名格式（玩家 1/2/3/4）：不作为自定义昵称持久化/预填，跟随风位
function isDefaultPlayerName(name: string): boolean {
  return /^玩家\s*[1-4]$/.test(name.trim());
}

// Persistent Device ID:
// - 有自定义设备 ID → 绑定设备 ID，每次默认使用
// - 无 ID 或上局用的默认"玩家 N" ID → 清除，返回 null，重置时重新按风位分配
function getOrCreateDeviceId(): string | null {
  const devId = localStorage.getItem('mahjong-device-id');
  if (devId && !isDefaultDeviceId(devId)) {
    return devId;
  }
  if (devId) {
    localStorage.removeItem('mahjong-device-id'); // 清除默认格式旧 ID，下一把重新按风位分配
  }
  return null;
}

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);





  // Theme State (Supports 5 Official Themes: light, dark, rexx, electronic, majsoul)
  const savedRaw = localStorage.getItem('mahjong-theme');
  let initialTheme: Theme = 'rexx';
  if (savedRaw === 'light') initialTheme = 'light';
  if (savedRaw === 'dark') initialTheme = 'dark';
  if (savedRaw === 'rexx') initialTheme = 'rexx';
  if (savedRaw === 'electronic') initialTheme = 'electronic';
  if (savedRaw === 'majsoul') initialTheme = 'majsoul';
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [showDiffMode, setShowDiffMode] = useState<boolean>(false);

  // REXX Theme Diff Button Timers & Interaction State Handlers
  const [isDiffLocked, setIsDiffLocked] = useState<boolean>(false);
  const diffTimerRef = useRef<any>(null);
  const longPressTimerRef = useRef<any>(null);
  const isLongPressRef = useRef<boolean>(false);

  const handleDiffPressDown = () => {
    isLongPressRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    // 长按 2 秒触发判定
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true; // 标记已触发长按
      if (diffTimerRef.current) {
        clearTimeout(diffTimerRef.current);
        diffTimerRef.current = null;
      }
      setShowDiffMode(true);
      setIsDiffLocked(true); // 进入长按锁定保持模式
    }, 2000);
  };

  const handleDiffPressUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleDiffClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // 若本次 Click 属于长按 2s 后的松开，跳过短按逻辑
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }

    // 若当前处于【长按锁定保持模式】，再次单击退回正常得点显示
    if (isDiffLocked) {
      if (diffTimerRef.current) clearTimeout(diffTimerRef.current);
      diffTimerRef.current = null;
      setShowDiffMode(false);
      setIsDiffLocked(false);
      return;
    }

    // 短按逻辑：开启得点差展示，并触发/刷新 2 秒退出定时器
    setShowDiffMode(true);
    setIsDiffLocked(false);

    if (diffTimerRef.current) {
      clearTimeout(diffTimerRef.current);
    }

    diffTimerRef.current = setTimeout(() => {
      setShowDiffMode(false);
      setIsDiffLocked(false);
      diffTimerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-rexx', 'theme-electronic', 'theme-majsoul');
    root.classList.add(`theme-${theme}`);
    localStorage.setItem('mahjong-theme', theme);
    if (theme !== 'rexx' && theme !== 'majsoul') {
      setShowDiffMode(false);
      setIsDiffLocked(false);
      if (diffTimerRef.current) clearTimeout(diffTimerRef.current);
    }
  }, [theme]);

  // Claim Seat State
  const savedSeat = localStorage.getItem('mahjong-claimed-seat');
  const [mySeatId, setMySeatId] = useState<number | null>(savedSeat !== null ? parseInt(savedSeat, 10) : null);



  // Rename modal state
  const [renamingPlayer, setRenamingPlayer] = useState<Player | null>(null);

  // Settlement modal state
  const [settleMode, setSettleMode] = useState<'tsumo' | 'ron' | 'draw' | null>(null);
  const [settleWinnerId, setSettleWinnerId] = useState<number | null>(null);

  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  
  // HUD Edit modal state
  const [isHudModalOpen, setIsHudModalOpen] = useState<boolean>(false);
  const [tempWind, setTempWind] = useState<'east' | 'south' | 'west'>('east');
  const [tempRound, setTempRound] = useState<number>(1);
  const [tempHonba, setTempHonba] = useState<number>(0);
  const [tempRiichiSticks, setTempRiichiSticks] = useState<number>(0);
  const [tempGameMode, setTempGameMode] = useState<'yonma' | 'sanma'>('yonma');
  const [tempMultiRonEnabled, setTempMultiRonEnabled] = useState<boolean>(false);
  const [tempDobonEnabled, setTempDobonEnabled] = useState<boolean>(false);
  const [tempWestRoundEnabled, setTempWestRoundEnabled] = useState<boolean>(true);
  const [tempAgariYameEnabled, setTempAgariYameEnabled] = useState<boolean>(true);
  const [tempKiriageManganEnabled, setTempKiriageManganEnabled] = useState<boolean>(true);
  const [activeStatsPlayerId, setActiveStatsPlayerId] = useState<number>(0);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);


    const [serverLanUrl, setServerLanUrl] = useState<string>('');
  const getLanShareUrl = () => {
    let url = window.location.origin;
    if (gameState?.lanUrl && !gameState.lanUrl.includes('127.0.0.1') && !gameState.lanUrl.includes('localhost')) {
      url = gameState.lanUrl;
    } else if (serverLanUrl && !serverLanUrl.includes('127.0.0.1') && !serverLanUrl.includes('localhost')) {
      url = serverLanUrl;
    }
    return url.endsWith('/') ? url : url + '/';
  };
  const [tempStartingPoints, setTempStartingPoints] = useState<number>(25000);
  const [tempStartingPointsStr, setTempStartingPointsStr] = useState<string>('25000');
  const [tempOkaPoints, setTempOkaPoints] = useState<number>(30000);

  const openSettingsModal = () => {
    if (gameState?.settings) {
      setTempMultiRonEnabled(gameState.settings.multiRonEnabled ?? false);
      setTempDobonEnabled(gameState.settings.dobonEnabled);
      setTempStartingPoints(gameState.settings.startingPoints);
      setTempStartingPointsStr(gameState.settings.startingPoints.toString());
      setTempOkaPoints(gameState.settings.okaPoints);
      setTempWestRoundEnabled(gameState.settings.westRoundEnabled ?? false);
      setTempAgariYameEnabled(gameState.settings.agariYameEnabled ?? true);
      setTempKiriageManganEnabled(gameState.settings.kiriageManganEnabled ?? true);
    } else {
      const defaultStart = tempGameMode === 'sanma' ? 35000 : 25000;
      setTempMultiRonEnabled(false);
      setTempDobonEnabled(false);
      setTempStartingPoints(defaultStart);
      setTempStartingPointsStr(defaultStart.toString());
      setTempOkaPoints(defaultStart + 5000);
    }
    setIsSettingsModalOpen(true);
  };

  const handleSaveSettings = () => {
    // 统一的分数合法性检查 (大于0且为100的整数倍)
    if (!tempStartingPoints || isNaN(tempStartingPoints) || tempStartingPoints <= 0 || tempStartingPoints % 100 !== 0) {
      alert('起始点数必须大于 0 且为 100 的整数倍 (例如 25000)！');
      return;
    }

    const currentMode = gameState?.gameMode || (gameState?.players.length === 3 ? 'sanma' : 'yonma');
    const isModeChanged = tempGameMode !== currentMode;
    const currentStarting = gameState?.settings?.startingPoints ?? (currentMode === 'sanma' ? 35000 : 25000);
    const isStartingChanged = tempStartingPoints !== currentStarting;

    if (isModeChanged || isStartingChanged) {
      const confirmMsg = isModeChanged
        ? `确定要将模式从 ${currentMode === 'sanma' ? '三人麻将' : '四人麻将'} 切换为 ${tempGameMode === 'sanma' ? '三人麻将' : '四人麻将'} 吗？此操作将初始化并重置新对局，清空现有座次。`
        : `修改起始点数将会重置当前对局得分，确定要重置吗？`;

      if (window.confirm(confirmMsg)) {
        socket.emit('reset-game', {
          gameMode: tempGameMode,
          settings: {
            multiRonEnabled: tempMultiRonEnabled,
            dobonEnabled: tempDobonEnabled,
            startingPoints: tempStartingPoints,
            okaPoints: tempOkaPoints,
            westRoundEnabled: tempWestRoundEnabled,
            agariYameEnabled: tempAgariYameEnabled,
            kiriageManganEnabled: tempKiriageManganEnabled
          }
        });
        setIsSettingsModalOpen(false);
        return;
      } else {
        return;
      }
    }

    // Normal non-reset save
    const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
    if (!nextState.settings) {
      nextState.settings = {
        multiRonEnabled: tempMultiRonEnabled,
        dobonEnabled: tempDobonEnabled,
        startingPoints: tempStartingPoints,
        okaPoints: tempOkaPoints,
        westRoundEnabled: tempWestRoundEnabled,
        agariYameEnabled: tempAgariYameEnabled,
        kiriageManganEnabled: tempKiriageManganEnabled
      };
    } else {
      nextState.settings.multiRonEnabled = tempMultiRonEnabled;
      nextState.settings.dobonEnabled = tempDobonEnabled;
      nextState.settings.startingPoints = tempStartingPoints;
      nextState.settings.okaPoints = tempOkaPoints;
      nextState.settings.westRoundEnabled = tempWestRoundEnabled;
      nextState.settings.agariYameEnabled = tempAgariYameEnabled;
      nextState.settings.kiriageManganEnabled = tempKiriageManganEnabled;
    }

    const logMsg = `修改游戏规则: [一炮多响:${tempMultiRonEnabled ? '开' : '关'}] [击飞:${tempDobonEnabled ? '开' : '关'}] [西入:${tempWestRoundEnabled ? '开' : '关'}] [和止:${tempAgariYameEnabled ? '开' : '关'}] [切上满贯:${tempKiriageManganEnabled ? '开' : '关'}]`;
    handleUpdateState(nextState, logMsg);
    setIsSettingsModalOpen(false);
  };
  const [tempDealerIndex, setTempDealerIndex] = useState<number>(0);

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');

      // [PROVISION] 预留多房间加入调用 (默认房间 'default')
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room') || 'default';
      socket.emit('join-room', { roomId, deviceId: getOrCreateDeviceId() });

      // Request to re-claim cached seat on reconnect to verify availability
      const currentSavedSeat = localStorage.getItem('mahjong-claimed-seat');
      const currentSavedName = localStorage.getItem('mahjong-player-name') || '';
      if (currentSavedSeat !== null) {
        socket.emit('claim-seat', { 
          playerId: parseInt(currentSavedSeat, 10), 
          playerName: currentSavedName, 
          deviceId: getOrCreateDeviceId() 
        });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
    });

    socket.on('state-updated', (state: GameState) => {
      setGameState(state);
    });

    socket.on('history-info', (info: { canUndo: boolean; canRedo: boolean }) => {
      setCanUndo(info.canUndo);
      setCanRedo(info.canRedo);
    });

    socket.on('claim-seat-result', (res: { success: boolean; reason?: string; playerId?: number }) => {
      if (res.success) {
        setMySeatId(res.playerId!);
        localStorage.setItem('mahjong-claimed-seat', res.playerId!.toString());
      } else {
        alert(res.reason || '座位占领失败');
        setMySeatId(null);
        localStorage.removeItem('mahjong-claimed-seat');
      }
    });

    socket.on('force-clear-seats', () => {
      setMySeatId(null);
      localStorage.removeItem('mahjong-claimed-seat');
      alert('对局已重置，请重新选择您的位置连线');
    });

    void isHost;
  void setServerLanUrl;

  return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('state-updated');
      socket.off('history-info');
      socket.off('claim-seat-result');
      socket.off('force-clear-seats');
    };
  }, []);

  if (!gameState) {
    return (
      <div className="modal-overlay">
        <div style={{ textAlign: 'center' }}>
          <div className="status-dot disconnected" style={{ margin: '0 auto 16px', width: '20px', height: '20px' }}></div>
          <h2>正在连接计分服务器...</h2>
          <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>请确保设备与服务端处于同一局域网内</p>
        </div>
      </div>
    );
  }

  const { wind, round, honba, riichiSticks, dealerIndex } = gameState;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isHost = true; // window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Handle complete state updates (broadcasts to all devices)
  const handleUpdateState = (newState: GameState, logMsg: string) => {
    socket.emit('update-state', newState, logMsg);
  };

  // Rename player confirm
  const handleRenameConfirm = (playerId: number, newName: string) => {
    const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
    const player = nextState.players[playerId];
    const oldName = player.name;
    player.name = newName;

    // If this rename corresponds to my own claimed seat, update localStorage
    if (mySeatId === playerId) {
      // 默认格式（玩家 N）不保存为自定义昵称，避免重置后残留
      if (isDefaultPlayerName(newName)) {
        localStorage.removeItem('mahjong-player-name');
      } else {
        localStorage.setItem('mahjong-player-name', newName);
      }
      // Re-claim to notify server
      socket.emit('claim-seat', { playerId, playerName: newName, deviceId: getOrCreateDeviceId() });
    }

    const logMsg = `修改名字: [${oldName}] 更名为 [${newName}]`;
    handleUpdateState(nextState, logMsg);
  };

  // Undo and Reset trigger
  const handleUndo = () => {
    socket.emit('undo-action');
  };

  const handleRedo = () => {
    socket.emit('redo-action');
  };

  const handleReset = () => {
    socket.emit('reset-game');
  };

  // Open HUD Edit Modal
  const openHudModal = () => {
    setTempWind(wind);
    setTempRound(round);
    setTempHonba(honba);
    setTempRiichiSticks(riichiSticks);
    setTempDealerIndex(dealerIndex);
    setTempDobonEnabled(gameState?.settings?.dobonEnabled ?? false);
    setIsHudModalOpen(true);
  };

    // Confirm HUD Edit
  const handleHudConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
    nextState.wind = tempWind;
    nextState.round = tempRound;
    nextState.honba = tempHonba;
    nextState.riichiSticks = tempRiichiSticks;
    nextState.dealerIndex = tempDealerIndex;
    nextState.settings = {
      dobonEnabled: tempDobonEnabled,
      startingPoints: gameState?.settings?.startingPoints ?? 25000,
      okaPoints: gameState?.settings?.okaPoints ?? 30000,
    };

    const windName = tempWind === 'east' ? '东' : (tempWind === 'south' ? '南' : '西');
    const settingsMsg = tempDobonEnabled ? '开启击飞' : '关闭击飞';
    const logMsg = `修改局况为: ${windName}${tempRound}局, ${tempHonba}本场, 场存立直棒 ${tempRiichiSticks}根 (${settingsMsg}). 庄家为: [${nextState.players[tempDealerIndex].name}]`;
    
    handleUpdateState(nextState, logMsg);
    setIsHudModalOpen(false);
  };

  // Handle seat claim confirm from ClaimSeatModal
  const handleClaimSeat = (playerId: number, name: string) => {
    setMySeatId(playerId);
    localStorage.setItem('mahjong-claimed-seat', playerId.toString());
    // 默认格式（玩家 N）不保存为自定义昵称，避免重置后残留
    if (isDefaultPlayerName(name)) {
      localStorage.removeItem('mahjong-player-name');
    } else {
      localStorage.setItem('mahjong-player-name', name);
    }
    socket.emit('claim-seat', { playerId, playerName: name, deviceId: getOrCreateDeviceId() });
  };

  // Release/switch seats
  const handleReleaseSeat = () => {
    if (window.confirm('您确定要切换座位吗？释放后您需要重新选择座位连线。')) {
      localStorage.removeItem('mahjong-claimed-seat');
      // Preserve mahjong-player-name and mahjong-device-id so player name stays bound to device when switching seats!
      window.location.reload();
    }
  };

  // Dynamic Wind display name
  const windText = wind === 'east' ? '東' : (wind === 'south' ? '南' : '西');

  // Calculate total points currently held by players (excluding riichi sticks on table)
  const playersSum = gameState.players.reduce((sum, p) => sum + p.score, 0);
  // CHECK indicator turns ON only if total player scores === 100,000 AND no riichi sticks on table!
  const isBalanced = playersSum === 100000 && gameState.riichiSticks === 0;

  // Determine check dot state color class
  if (!isBalanced) {
  } else if (gameState.riichiSticks > 0) {
  }

  // Force show Claim Seat Modal if seat is not claimed
  const showClaimModal = mySeatId === null;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', width: '100%', padding: '8px 12px', minHeight: '44px' }}>
        {/* Left: Check Component (REXX) or Left-aligned Title (Electronic) */}
        <div style={{ gridColumn: 1, justifySelf: 'start', display: 'flex', alignItems: 'center', height: '30px' }}>
          {theme === 'electronic' && (
            <h1
              className="app-title"
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 800,
                height: '30px',
                lineHeight: '30px',
                display: 'inline-flex',
                alignItems: 'center',
                color: 'var(--color-accent)',
                letterSpacing: '0.5px'
              }}
            >
              日麻计分板
            </h1>
          )}
          {theme === 'rexx' && (
            <div
              className="check-indicator"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                height: '30px',
                fontWeight: 700,
                fontSize: '0.52rem',
                color: '#ffffff',
                cursor: 'default'
              }}
              title={isBalanced ? '全场点数正常（已对平）' : '全场点数异常（未对平）'}
            >
              <span style={{ color: '#a1a1aa', letterSpacing: '1px', lineHeight: 1, fontSize: '0.52rem' }}>CHECK</span>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isBalanced ? '#30d158' : '#2b3630',
                  boxShadow: isBalanced ? '0 0 4px #30d158, 0 0 8px #30d158' : 'none',
                  transition: 'all 0.3s ease',
                  display: 'inline-block'
                }}
              />
            </div>
          )}
        </div>

        {/* Center: Title (Height 30px centered) - 电子主题不显示 */}
        {theme !== 'electronic' && (
          <h1 className="app-title" style={{ justifySelf: 'center', margin: 0, fontSize: '1.25rem', fontWeight: 800, height: '30px', lineHeight: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            日麻计分板
          </h1>
        )}

        {/* Right: 电子主题 CHECK + REXX Diff Button (Height 30px aligned) */}
        <div style={{ gridColumn: 3, justifySelf: 'end', display: 'flex', alignItems: 'center', height: '30px' }}>
          {theme === 'electronic' && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px' }}
              title={isBalanced ? '全场点数正常（已对平）' : '全场点数异常（未对平）'}
            >
              <div className="rank-lamp" style={{ height: '26px', padding: '0 8px' }}>
                <span className="rank-lamp-char" style={{ fontSize: '0.68rem', letterSpacing: '1px' }}>CHECK</span>
              </div>
              <div style={{ transform: 'translateY(3px)' }}>
                <LedDigitDisplay value={playersSum} color="blue" height={18} digits={6} />
              </div>
            </div>
          )}
          {theme === 'rexx' && (
            <button
              type="button"
              className="btn"
              onMouseDown={handleDiffPressDown}
              onMouseUp={handleDiffPressUp}
              onMouseLeave={handleDiffPressUp}
              onTouchStart={handleDiffPressDown}
              onTouchEnd={handleDiffPressUp}
              onTouchCancel={handleDiffPressUp}
              onClick={handleDiffClick}
              style={{
                width: '76px',
                height: '20px',
                lineHeight: '20px',
                padding: 0,
                fontSize: '0.68rem',
                border: '1px solid rgba(255, 255, 255, 0.7)',
                borderRadius: '3.5px',
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box'
              }}
              title="单击展示得点差2s（多次单击刷新时间）；长按2s锁定展示，再次单击退出；按钮颜色保持不变"
            >
              顺位/得点差
            </button>
          )}
        </div>
      </header>

      {gameState.isOver ? (
        /* Game Over Panel */
        <section className="game-over-panel">
          <h2 className="game-over-title">🎉 对局完场 (半庄结束)</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            本半庄对局已全部结束。各家最终排名及得分如下：
          </p>
          <div className="rank-list">
            {[...gameState.players]
              .sort((a, b) => b.score - a.score)
              .map((p, idx) => (
                <div key={p.id} className={`rank-item rank-${idx + 1}`}>
                  <span style={{ fontWeight: 800, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="rank-badge">{idx + 1}位</span>
                    {p.name}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.2rem' }}>
                    {p.score} 点
                  </span>
                </div>
              ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px', fontSize: '1.05rem', marginTop: '12px' }}
            onClick={handleReset}
          >
            开始新半庄 🀄
          </button>

          {/* SVG Score History Line Chart */}
          {gameState.scoreHistory && gameState.scoreHistory.length > 1 && (
            <div className="score-chart-wrapper" style={{ marginTop: '20px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              {(() => {
                const totalRounds = gameState.scoreHistory ? gameState.scoreHistory.length - 1 : 0;
                const drawRounds = gameState.log.filter(line => line.includes('流局结算')).length;
                return (
                  <div style={{ marginBottom: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      总局数: <strong style={{ color: 'var(--text-primary)' }}>{totalRounds}</strong> 局 | 流局数: <strong style={{ color: 'var(--text-primary)' }}>{drawRounds}</strong> 局
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const history = gameState.scoreHistory;
                const allScores = history.flat();
                const minScore = Math.min(...allScores);
                const maxScore = Math.max(...allScores);
                const finalRange = maxScore - minScore || 10000;

                const width = 360;
                const height = 300; // Fixed tall height to ensure small score changes are scaled up and clearly visible
                const paddingLeft = 42;
                const paddingRight = 48;
                const paddingTop = 20;
                const paddingBottom = 25;

                const pointsCount = history.length;
                const getX = (index: number) => {
                  if (pointsCount <= 1) return paddingLeft;
                  return paddingLeft + (index / (pointsCount - 1)) * (width - paddingLeft - paddingRight);
                };
                const getY = (val: number) => {
                  return height - paddingBottom - ((val - minScore) / finalRange) * (height - paddingTop - paddingBottom);
                };

                const lineColors = ['#ff4d4d', '#2ecc71', '#00d2fc', '#f1c40f'];

                return (
                  <div>
                    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: `${height}px`, display: 'block' }} preserveAspectRatio="none">
                      <g>
                        {(() => {
                          const yGridCount = 4;
                          const gridLines = [];
                          for (let i = 0; i <= yGridCount; i++) {
                            const val = Math.round(minScore + (i / yGridCount) * finalRange);
                            const y = getY(val);
                            gridLines.push(
                              <g key={i}>
                                <line
                                  x1={paddingLeft}
                                  y1={y}
                                  x2={width - paddingRight}
                                  y2={y}
                                  stroke="var(--border-color)"
                                  strokeWidth={1}
                                  strokeDasharray="3 3"
                                />
                                <text
                                  x={paddingLeft - 6}
                                  y={y + 3}
                                  textAnchor="end"
                                  fontSize="0.55rem"
                                  fill="var(--text-secondary)"
                                  fontFamily="monospace"
                                >
                                  {val}
                                </text>
                              </g>
                            );
                          }
                          return gridLines;
                        })()}
                      </g>

                      {/* Vertical Grid Lines for each round */}
                      <g>
                        {history.map((_, idx) => {
                          const x = getX(idx);
                          return (
                            <line
                              key={`x-grid-${idx}`}
                              x1={x}
                              y1={paddingTop}
                              x2={x}
                              y2={height - paddingBottom}
                              stroke="var(--border-color)"
                              strokeWidth={1}
                              strokeDasharray="3 3"
                            />
                          );
                        })}
                      </g>

                      <g>
                        {history.map((_, idx) => {
                          const x = getX(idx);
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={height - 6}
                              textAnchor="middle"
                              fontSize="0.55rem"
                              fill="var(--text-secondary)"
                            >
                              {gameState.roundHistory && gameState.roundHistory[idx] 
                                ? gameState.roundHistory[idx] 
                                : (idx === 0 ? '起点' : (idx <= 4 ? `东${idx}` : (idx <= 8 ? `南${idx - 4}` : `西${idx - 8}`)))}
                            </text>
                          );
                        })}
                      </g>

                      {gameState.players.map((p, pIdx) => {
                        const points = history.map((roundScores, rIdx) => {
                          const score = roundScores[pIdx];
                          return `${getX(rIdx)},${getY(score)}`;
                        }).join(' ');

                        return (
                          <g key={p.id}>
                            <polyline
                              fill="none"
                              stroke={lineColors[pIdx]}
                              strokeWidth={2.5}
                              points={points}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </g>
                        );
                      })}

                      {/* Final Score Labels on the right side (anti-collision) */}
                      <g>
                        {(() => {
                          const endScores: { [score: number]: number[] } = {};
                          gameState.players.forEach((_, pIdx) => {
                            const score = history[history.length - 1][pIdx];
                            if (!endScores[score]) {
                              endScores[score] = [];
                            }
                            endScores[score].push(pIdx);
                          });

                          const labelItems: { score: number; y: number; color: string; key: string }[] = [];
                          Object.keys(endScores).forEach((scoreStr) => {
                            const score = parseInt(scoreStr, 10);
                            const playerIndices = endScores[score];
                            const y = getY(score);
                            const color = playerIndices.length === 1 ? lineColors[playerIndices[0]] : 'var(--text-secondary)';
                            labelItems.push({ score, y, color, key: `score-label-${score}-${playerIndices.join('-')}` });
                          });
                          
                          // Sort by target Y coordinate (ascending, which means from top to bottom)
                          labelItems.sort((a, b) => a.y - b.y);
                          
                          // Spacing correction pass 1: Top to Bottom
                          const minSpacing = 10;
                          for (let i = 1; i < labelItems.length; i++) {
                            if (labelItems[i].y < labelItems[i - 1].y + minSpacing) {
                              labelItems[i].y = labelItems[i - 1].y + minSpacing;
                            }
                          }
                          
                          // Spacing correction pass 2: Bottom to Top
                          for (let i = labelItems.length - 2; i >= 0; i--) {
                            if (labelItems[i].y > labelItems[i + 1].y - minSpacing) {
                              labelItems[i].y = labelItems[i + 1].y - minSpacing;
                            }
                          }
                          
                          // Clamp labels to chart vertical area
                          labelItems.forEach(item => {
                            item.y = Math.max(paddingTop + 3, Math.min(height - paddingBottom - 3, item.y));
                          });
                          
                          return labelItems.map((item) => (
                            <text
                              key={item.key}
                              x={width - paddingRight + 5}
                              y={item.y + 3}
                              fontSize="0.55rem"
                              fontWeight="bold"
                              fill={item.color}
                              textAnchor="start"
                            >
                              {item.score}
                            </text>
                          ));
                        })()}
                      </g>
                    </svg>

                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 12px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                      {gameState.players.map((p, pIdx) => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ display: 'inline-block', width: '10px', height: '4px', backgroundColor: lineColors[pIdx], borderRadius: '2px' }}></span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                            {p.name}: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{p.score}</span>
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Stats Table under Line Chart */}
                    <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', color: 'var(--text-secondary)' }}>
                            <th style={{ padding: '8px 4px', fontWeight: 600, textAlign: 'left', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>玩家</th>
                            <th style={{ padding: '8px 4px', fontWeight: 600, borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>立直</th>
                            <th style={{ padding: '8px 4px', fontWeight: 600, borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>和了</th>
                            <th style={{ padding: '8px 4px', fontWeight: 600, verticalAlign: 'middle' }}>放铳</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gameState.players.map((p) => {
                            const riichiCount = gameState.log.filter(line => line.includes(`${p.name} 宣告立直`)).length;
                            const winCount = gameState.log.filter(line => line.includes(`${p.name} 自摸和牌`) || line.includes(`${p.name} 荣和 `)).length;
                            const chongCount = gameState.log.filter(line => line.includes(`荣和 ${p.name} (`)).length;

                            return (
                              <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'left', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>{p.name}</td>
                                <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>{riichiCount} 回</td>
                                <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>{winCount} 回</td>
                                <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', verticalAlign: 'middle' }}>{chongCount} 回</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Options tab for individual player detail stats */}
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                        {gameState.players.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setActiveStatsPlayerId(p.id)}
                            style={{
                              flex: 1,
                              padding: '8px 4px',
                              background: 'none',
                              border: 'none',
                              borderBottom: activeStatsPlayerId === p.id ? '2px solid var(--color-accent, #ff4d4d)' : '2px solid transparent',
                              color: activeStatsPlayerId === p.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                              fontWeight: activeStatsPlayerId === p.id ? 'bold' : 'normal',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              transition: 'all 0.2s ease',
                              outline: 'none'
                            }}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                      
                      {(() => {
                        const targetPlayer = gameState.players.find(p => p.id === activeStatsPlayerId) || gameState.players[0];
                        const pIdx = targetPlayer.id;
                        const pName = targetPlayer.name;

                        const totalRounds = gameState.scoreHistory ? gameState.scoreHistory.length - 1 : 0;
                        const history = gameState.scoreHistory || [];

                        // Group log entries by rounds (1..totalRounds)
                        const roundLogs: { settlementLog: string; riichiLogs: string[] }[] = [];
                        let currentRiichis: string[] = [];

                        for (let i = 0; i < gameState.log.length; i++) {
                          const line = gameState.log[i];
                          if (line.includes('宣告立直')) {
                            currentRiichis.push(line);
                          } else if (line.includes('自摸和牌') || line.includes('荣和') || line.includes('流局结算')) {
                            roundLogs.push({
                              settlementLog: line,
                              riichiLogs: currentRiichis
                            });
                            currentRiichis = [];
                          }
                        }

                        let winCount = 0;
                        let tsumoWins = 0;
                        let totalWinPoints = 0;
                        let maxWin = 0;

                        let chongCount = 0;
                        let totalChongLoss = 0;
                        let maxChongLoss = 0;

                        let tsumoHitCount = 0;
                        let totalTsumoHitLoss = 0;

                        let riichiCount = 0;
                        let firstRiichiCount = 0;
                        let riichiWinCount = 0;
                        let riichiTotalEarnings = 0;

                        let drawCount = 0;
                        let drawTenpaiCount = 0;

                        for (let r = 1; r < history.length; r++) {
                          const rData = roundLogs[r - 1] || { settlementLog: '', riichiLogs: [] };
                          const settlementLog = rData.settlementLog;
                          const riichiLogs = rData.riichiLogs;
                          const diff = history[r][pIdx] - history[r - 1][pIdx];

                          // Check if target player declared Riichi in this round
                          const playerRiichiIndex = riichiLogs.findIndex(l => l.includes(`${pName} 宣告立直`));
                          if (playerRiichiIndex !== -1) {
                            riichiCount++;
                            riichiTotalEarnings += diff;
                            if (playerRiichiIndex === 0) {
                              firstRiichiCount++;
                            }
                            if (settlementLog.startsWith(pName) && (settlementLog.includes('自摸和牌') || settlementLog.includes('荣和'))) {
                              riichiWinCount++;
                            }
                          }

                          // Settlement parsing
                          if (settlementLog.includes('自摸和牌') || settlementLog.includes('荣和')) {
                            // Win path
                            if (settlementLog.startsWith(pName)) {
                              winCount++;
                              totalWinPoints += diff;
                              if (diff > maxWin) maxWin = diff;
                              if (settlementLog.includes('自摸和牌')) tsumoWins++;
                            }
                            // Chong path
                            if (settlementLog.includes('荣和') && settlementLog.includes(`荣和 ${pName} (`)) {
                              chongCount++;
                              const loss = -diff;
                              totalChongLoss += loss;
                              if (loss > maxChongLoss) maxChongLoss = loss;
                            }
                            // Tsumo hit path
                            if (settlementLog.includes('自摸和牌') && !settlementLog.startsWith(pName)) {
                              tsumoHitCount++;
                              totalTsumoHitLoss += (-diff);
                            }
                          } else if (settlementLog.includes('流局结算')) {
                            drawCount++;
                            if (diff > 0) {
                              drawTenpaiCount++;
                            } else if (diff === 0) {
                              if (settlementLog.includes('全部听牌')) {
                                drawTenpaiCount++;
                              }
                            }
                          }
                        }

                        // Offense Metrics
                        const winRate = totalRounds > 0 ? ((winCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                        const tsumoWinRatio = winCount > 0 ? ((tsumoWins / winCount) * 100).toFixed(1) + '%' : '0.0%';
                        const avgWinPoints = winCount > 0 ? Math.round(totalWinPoints / winCount) + ' 点' : '0 点';

                        // Defense Metrics
                        const chongRate = totalRounds > 0 ? ((chongCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                        const totalLossEvents = chongCount + tsumoHitCount;
                        const totalLossPoints = totalChongLoss + totalTsumoHitLoss;
                        const avgExpenditure = totalLossEvents > 0 ? Math.round(totalLossPoints / totalLossEvents) + ' 点' : '0 点';
                        const avgChongPoints = chongCount > 0 ? Math.round(totalChongLoss / chongCount) + ' 点' : '0 点';

                        // Part 3 Metrics
                        const riichiRate = totalRounds > 0 ? ((riichiCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                        const riichiWinRate = riichiCount > 0 ? ((riichiWinCount / riichiCount) * 100).toFixed(1) + '%' : '0.0%';
                        const firstRiichiRate = riichiCount > 0 ? ((firstRiichiCount / riichiCount) * 100).toFixed(1) + '%' : '0.0%';
                        const formattedRiichiEarnings = riichiTotalEarnings > 0 ? `+${riichiTotalEarnings} 点` : `${riichiTotalEarnings} 点`;
                        const globalDrawRate = totalRounds > 0 ? ((drawCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                        const drawTenpaiRate = drawCount > 0 ? ((drawTenpaiCount / drawCount) * 100).toFixed(1) + '%' : '0.0%';

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                            {/* Offense Category */}
                            <div>
                              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '6px', textAlign: 'left', borderLeft: '3px solid var(--border-color)', paddingLeft: '6px' }}>进攻能力指标</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>和了率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{winRate}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>自摸率 (和了中)</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{tsumoWinRatio}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>平均打点</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{avgWinPoints}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>最大打点</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{maxWin} 点</div>
                                </div>
                              </div>
                            </div>

                            {/* Defense Category */}
                            <div>
                              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '6px', textAlign: 'left', borderLeft: '3px solid var(--border-color)', paddingLeft: '6px' }}>防守与规避指标</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>放铳率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{chongRate}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>平均支出点数 (含被自摸)</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{avgExpenditure}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>平均铳点</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{avgChongPoints}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>最大铳失点</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{maxChongLoss} 点</div>
                                </div>
                              </div>
                            </div>

                            {/* Part 3 Category */}
                            <div>
                              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '6px', textAlign: 'left', borderLeft: '3px solid var(--border-color)', paddingLeft: '6px' }}>立直与局况综合</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>立直率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{riichiRate}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>立直和了率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{riichiWinRate}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>先制立直率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{firstRiichiRate}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>立直总收支</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{formattedRiichiEarnings}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>流局率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{globalDrawRate}</div>
                                </div>
                                <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>流听率</div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{drawTenpaiRate}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          

          

        </section>
      ) : (
        <>
          {/* HUD Info Panel */}
          {theme === 'rexx' ? (
            <section className="hud-panel rexx-hud-panel" style={{ height: '64px', minHeight: '64px' }}>
              {/* 格子 1 (25%): 局况文本 */}
              <div className="rexx-hud-col rexx-hud-col-1" onClick={openHudModal} style={{ cursor: 'pointer' }} title="点击修改局况/本场数">
                <div className="hud-item">
                  <span className="hud-label">局况</span>
                  <span className="hud-value dealer-round">
                    {windText}{round}局
                  </span>
                </div>
              </div>

              {/* 格子 2 (25%): 本场 5-LED 拟物组件 */}
              <div className="rexx-hud-col rexx-hud-col-2" onClick={openHudModal} style={{ cursor: 'pointer' }} title="点击修改局况/本场数">
                <HonbaLedBar honba={honba} />
              </div>

              {/* 格子 3 (25%): 宝蓝银点立直棒拟物组件 */}
              <div className="rexx-hud-col rexx-hud-col-3">
                <RiichiStickDisplay count={riichiSticks} />
              </div>

              {/* 格子 4 (25%): 荒牌流局按钮 */}
              <div className="rexx-hud-col rexx-hud-col-4">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSettleMode('draw');
                    setSettleWinnerId(null);
                  }}
                  style={{
                    width: '96px',
                    height: '32px',
                    lineHeight: '32px',
                    padding: 0,
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    borderRadius: '3.5px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box'
                  }}
                >
                  荒牌流局
                </button>
              </div>
            </section>
          ) : (
            <section className="hud-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '64px', minHeight: '64px', whiteSpace: 'nowrap' }}>
              <div className="hud-info" onClick={openHudModal} style={{ cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }} title="点击修改局况/本场数">
                <div className="hud-item" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <span className="hud-label" style={{ whiteSpace: 'nowrap' }}>局况</span>
                  <span className="hud-value dealer-round" style={{ whiteSpace: 'nowrap' }}>
                    {windText}{round}局
                  </span>
                </div>
                {theme === 'majsoul' ? (
                  /* 雀魂专属实机胶囊：调换顺序 (立直棒在前、本场棒在后)，竖立白棒 + 斜体白字，数值与点棒下对齐 */
                  <div className="majsoul-sticks-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* 1. 立直棒胶囊 (千点棒在前，竖棒高度 40px) */}
                    <div className="majsoul-stick-capsule" title="立直棒">
                      <svg width="9" height="40" viewBox="0 0 9 40" style={{ display: 'block', flexShrink: 0, height: '40px' }}>
                        <rect x="0.5" y="0.5" width="8" height="39" rx="4" fill="#ffffff" stroke="#c4c8d0" strokeWidth="0.9" />
                        <circle cx="4.5" cy="20" r="2.2" fill="#be353d" />
                      </svg>
                      <span className="stick-text">
                        <span className="stick-x">x</span>
                        <span className="stick-num">{riichiSticks}</span>
                      </span>
                    </div>

                    {/* 2. 本场棒胶囊 (百点棒在后，竖棒高度 40px) */}
                    <div className="majsoul-stick-capsule" title="本场棒">
                      <svg width="9" height="40" viewBox="0 0 9 40" style={{ display: 'block', flexShrink: 0, height: '40px' }}>
                        <rect x="0.5" y="0.5" width="8" height="39" rx="4" fill="#ffffff" stroke="#c4c8d0" strokeWidth="0.9" />
                        {[0, 1, 2, 3].map((r) => (
                          <g key={r}>
                            <circle cx="2.9" cy={14.75 + r * 3.5} r="1" fill="#1b253c" />
                            <circle cx="6.1" cy={14.75 + r * 3.5} r="1" fill="#1b253c" />
                          </g>
                        ))}
                      </svg>
                      <span className="stick-text">
                        <span className="stick-x">x</span>
                        <span className="stick-num">{honba}</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="hud-item">
                      <span className="hud-label">本场</span>
                      <span className="hud-value">{`${honba} 本场`}</span>
                    </div>
                    <div className="hud-item">
                      <span className="hud-label">立直棒</span>
                      <span className="hud-value">{`${riichiSticks} 根`}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="hud-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSettleMode('draw');
                    setSettleWinnerId(null);
                  }}
                  style={{ width: '96px', height: '32px', padding: 0, fontSize: '0.8rem', fontWeight: 700 }}
                >
                  荒牌流局
                </button>
              </div>
            </section>
          )}

          {/* Main Scoreboard Grid */}
          <ScoreBoard
            theme={theme}
            showDiffMode={showDiffMode}
            gameState={gameState}
            mySeatId={mySeatId}
            onUpdateState={handleUpdateState}
            onScoreClick={(_player) => {
              if (theme === 'majsoul') {
                setShowDiffMode(prev => !prev);
              }
            }}
            onTsumoClick={(player) => {
              setSettleMode('tsumo');
              setSettleWinnerId(player.id);
            }}
            onRonClick={(player) => {
              setSettleMode('ron');
              setSettleWinnerId(player.id);
            }}
            onRiichiClick={(player) => {
              const pIdx = gameState.players.findIndex(p => p.id === player.id);
              if (pIdx !== -1) {
                const targetPlayer = gameState.players[pIdx];
                if (!targetPlayer.riichi) {
                  if (targetPlayer.score < 1000) {
                    alert('点数不足 1000 点，无法立直！');
                    return;
                  }
                  const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
                  const p = nextState.players[pIdx];
                  p.score -= 1000;
                  p.riichi = true;
                  nextState.riichiSticks += 1;
                  handleUpdateState(nextState, `[${p.name}] 声明立直 (放置 1000 点立直棒)`);
                } else {
                  // 仅撤销该玩家自己的立直（取回立直棒），不影响其他玩家已立直/操作
                  const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
                  const p = nextState.players[pIdx];
                  p.riichi = false;
                  p.score += 1000;
                  nextState.riichiSticks = Math.max(0, nextState.riichiSticks - 1);

                  // 撤销立直时，同步删除对局记录里该玩家最近的一条立直声明记录，不重复刷屏
                  if (Array.isArray(nextState.log)) {
                    for (let i = nextState.log.length - 1; i >= 0; i--) {
                      const item = nextState.log[i];
                      if (typeof item === 'string' && item.includes(`[${p.name}]`) && item.includes('声明立直')) {
                        nextState.log.splice(i, 1);
                        break;
                      }
                    }
                  }

                  handleUpdateState(nextState, '');
                }
              }
            }}
            onRenameClick={(player) => setRenamingPlayer(player)}
            onUndoClick={handleUndo}
          />
        </>
      )}

      {/* History Log Section */}
      <HistoryLog
        gameState={gameState}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onReset={handleReset}
      />

      {/* Footer Status Bar */}
      <footer className="app-footer">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {mySeatId !== null && (
            <span 
              onClick={handleReleaseSeat}
              style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--text-secondary)', fontSize: '0.8rem' }}
              title="切换座位"
            >
              切换座位
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="btn"
            style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            onClick={openSettingsModal}
          >
            规则设置
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            onClick={() => setIsShareModalOpen(true)}
          >
            扫码
          </button>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as any)}
            className="theme-select bottom-theme-select"
            title="选择界面主题"
            style={{
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              padding: '4px 10px',
              borderRadius: 'var(--border-radius)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              outline: 'none'
            }}
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="rexx">REXX</option>
            <option value="electronic">电子</option>
            <option value="majsoul">雀魂</option>
          </select>
        </div>
      </footer>

      {/* First-time login claim seat modal */}
      <ClaimSeatModal
        isOpen={showClaimModal}
        gameState={gameState}
        onConfirm={handleClaimSeat}
      />

      {/* 1. Rename Modal */}
      <RenameModal
        isOpen={renamingPlayer !== null}
        onClose={() => setRenamingPlayer(null)}
        player={renamingPlayer}
        onConfirm={handleRenameConfirm}
      />

      {/* 2. Hand Settlement Modal */}
      <HandInputModal
        isOpen={settleMode !== null}
        onClose={() => {
          setSettleMode(null);
          setSettleWinnerId(null);
        }}
        gameState={gameState}
        onConfirm={handleUpdateState}
        mode={settleMode}
        initialWinnerId={settleWinnerId}
        theme={theme}
      />

      {/* 3. Share Room Modal (QR Code) */}
      {isShareModalOpen && (
        <div className="modal-overlay" onClick={() => setIsShareModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', textAlign: 'center' }}>
            <div className="modal-header" style={{ justifyContent: 'center', textAlign: 'center', position: 'relative' }}>
              <h3 className="modal-title" style={{ margin: '0 auto' }}>📱 手机扫码加入对局</h3>
              <button className="modal-close" onClick={() => setIsShareModalOpen(false)} style={{ position: 'absolute', right: '16px' }}>&times;</button>
            </div>
            <div className="qr-modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center', margin: '0 auto 12px auto' }}>
                请将需要同步记分的手机/平板连接到**同一个局域网 Wi-Fi**，然后扫描下方二维码：
              </p>
              <div className="qr-placeholder" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '8px auto', padding: '12px', backgroundColor: '#ffffff', borderRadius: '12px' }}>
                <QRCodeSVG value={getLanShareUrl()} size={220} level="M" includeMargin={true} />
              </div>
              <div className="form-group" style={{ width: '100%', textAlign: 'center', marginTop: '14px' }}>
                <span className="form-label" style={{ justifyContent: 'center', textAlign: 'center', display: 'flex', width: '100%', marginBottom: '4px' }}>在手机/平板浏览器中手动输入地址：</span>
                <div className="ip-list" style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.15rem', color: 'var(--color-accent)', textAlign: 'center', letterSpacing: '0.5px' }}>
                  {getLanShareUrl()}
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center', display: 'flex' }}>
              <button type="button" className="btn btn-primary" onClick={() => setIsShareModalOpen(false)}>我知道了</button>
            </div>
          </div>
        </div>
      )}

      {/* 4. HUD / Round Settings Edit Modal */}
      {isHudModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">修改局况与本场信息</h3>
              <button className="modal-close" onClick={() => setIsHudModalOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleHudConfirm}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">当前庄家</label>
                  <div className="player-selector-grid">
                    {gameState.players.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`player-select-btn ${tempDealerIndex === p.id ? 'selected' : ''}`}
                        onClick={() => setTempDealerIndex(p.id)}
                      >
                        {['东', '南', '西', '北'][idx]}家: {p.name || `玩家 ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">场风</label>
                  <div className="checkbox-grid">
                    <label className={`checkbox-label ${tempWind === 'east' ? 'checked' : ''}`}>
                      <input
                        type="radio"
                        name="tempWind"
                        checked={tempWind === 'east'}
                        onChange={() => setTempWind('east')}
                      />
                      东风场
                    </label>
                    <label className={`checkbox-label ${tempWind === 'south' ? 'checked' : ''}`}>
                      <input
                        type="radio"
                        name="tempWind"
                        checked={tempWind === 'south'}
                        onChange={() => setTempWind('south')}
                      />
                      南风场
                    </label>
                    <label className={`checkbox-label ${tempWind === 'west' ? 'checked' : ''}`}>
                      <input
                        type="radio"
                        name="tempWind"
                        checked={tempWind === 'west'}
                        onChange={() => setTempWind('west')}
                      />
                      西风场
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">当前局数 (1-4局)</label>
                  <div className="preset-grid">
                    {[1, 2, 3, 4].map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`btn ${tempRound === r ? 'btn-primary' : ''}`}
                        onClick={() => setTempRound(r)}
                      >
                        {r} 局
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">本场数</label>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    className="form-input"
                    value={tempHonba}
                    onChange={(e) => setTempHonba(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">场存立立直棒数</label>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    className="form-input"
                    value={tempRiichiSticks}
                    onChange={(e) => setTempRiichiSticks(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                </div>

                
              </div>


              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setIsHudModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">应用修改</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content settings-modal-box" style={{ maxWidth: '400px' }}>
            <div className="modal-header" style={{ justifyContent: "center", textAlign: "center", position: "relative", width: "100%" }}>
              <h3 className="modal-title" style={{ margin: "0 auto", textAlign: "center", width: "100%" }}>游戏规则与全局设置</h3>
              <button className="modal-close" onClick={() => setIsSettingsModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div className="form-group" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", width: "100%", margin: "0 auto" }}>
                <label className="form-label" style={{ fontWeight: "bold", justifyContent: "center", textAlign: "center", width: "100%", display: "flex", margin: "0 auto 6px auto" }}>对局模式</label>
                <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', width: '100%' }}>
                  <button
                    type="button"
                    className={`btn ${tempGameMode === 'yonma' ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setTempGameMode('yonma');
                      setTempStartingPoints(25000);
                      setTempOkaPoints(30000);
                    }}
                    style={{ padding: '8px 0', fontSize: '0.8rem', fontWeight: 'bold' }}
                  >
                    四人麻将
                  </button>
                  <button
                    type="button"
                    className={`btn ${tempGameMode === 'sanma' ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setTempGameMode('sanma');
                      setTempStartingPoints(35000);
                      setTempOkaPoints(40000);
                    }}
                    style={{ padding: '8px 0', fontSize: '0.8rem', fontWeight: 'bold' }}
                  >
                    三人麻将
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", width: "100%", margin: "0 auto" }}>
                <label className="form-label" style={{ fontWeight: "bold", justifyContent: "center", textAlign: "center", width: "100%", display: "flex", margin: "0 auto 6px auto" }}>起始点数</label>
                <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', width: '100%' }}>
                  {(tempGameMode === 'sanma' ? [30000, 35000, 40000] : [20000, 25000, 30000]).map((points) => (
                    <button
                      key={points}
                      type="button"
                      className={`btn ${tempStartingPoints === points ? 'btn-primary' : ''}`}
                      onClick={() => {
                        setTempStartingPoints(points);
                        setTempStartingPointsStr(points.toString());
                        setTempOkaPoints(points + 5000);
                      }}
                      style={{ padding: '8px 0', fontSize: '0.8rem' }}
                    >
                      {points} 点
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '10px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>或自定义起始点数</div>
                  {(() => {
                    const isEmpty = tempStartingPointsStr.trim() === '';
                    const parsedVal = parseInt(tempStartingPointsStr, 10);
                    const isInvalid = !isEmpty && (isNaN(parsedVal) || parsedVal <= 0 || parsedVal % 100 !== 0);

                    return (
                      <>
                        <input
                          type="number"
                          step="100"
                          min="100"
                          className={`form-input ${isInvalid ? 'form-input-invalid' : ''}`}
                          style={{
                            textAlign: 'center',
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '8px 12px',
                            fontSize: '0.85rem'
                          }}
                          placeholder="输入自定义起始点数 (如 25000)"
                          value={tempStartingPointsStr}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            setTempStartingPointsStr(valStr);
                            const val = parseInt(valStr, 10);
                            if (!isNaN(val) && val > 0 && val % 100 === 0) {
                              setTempStartingPoints(val);
                              setTempOkaPoints(val + 5000);
                            } else if (isNaN(val) || valStr.trim() === '') {
                              setTempStartingPoints(0);
                            }
                          }}
                        />
                        {isInvalid && (
                          <div className="validation-warning-text">
                            点数必须大于 0 且为 100 的整数倍
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="form-group" style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '12px', marginTop: '12px', width: '100%', alignItems: 'stretch', textAlign: 'left' }}>
                <label className="form-label" style={{ fontWeight: "bold", textAlign: "left", display: "block", width: "100%", margin: "0 0 8px 0" }}>可选规则</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'stretch' }}>
                  {/* 1. 开启一炮多响 (置于最顶上一项，默认关闭/头跳) */}
                  <label className={`checkbox-label ${tempMultiRonEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempMultiRonEnabled}
                      onChange={(e) => setTempMultiRonEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1 }}>开启一炮多响</span>
                  </label>

                  {/* 2. 开启击飞续行 */}
                  <label className={`checkbox-label ${tempDobonEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempDobonEnabled}
                      onChange={(e) => setTempDobonEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1 }}>开启击飞续行</span>
                  </label>

                  {/* 3. 开启切上满贯 */}
                  <label className={`checkbox-label ${tempKiriageManganEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempKiriageManganEnabled}
                      onChange={(e) => setTempKiriageManganEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1 }}>开启切上满贯</span>
                  </label>

                  {/* 4. 开启西入规则 */}
                  <label className={`checkbox-label ${tempWestRoundEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempWestRoundEnabled}
                      onChange={(e) => setTempWestRoundEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1 }}>开启西入规则</span>
                  </label>

                  {/* 5. 开启尾亲一位完场 */}
                  <label className={`checkbox-label ${tempAgariYameEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempAgariYameEnabled}
                      onChange={(e) => setTempAgariYameEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1 }}>开启尾亲一位完场</span>
                  </label>
                </div>
              </div>

              {/* Host-Only Dedicated Permission Control Bottom Tab */}
              
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setIsSettingsModalOpen(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={handleSaveSettings}>保存配置</button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Disconnection Alert Modal */}
      {!connected && (
        <div
          className="disconnect-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(8, 10, 15, 0.85)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '30px 24px 24px 24px',
              maxWidth: '340px',
              width: '90%',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.55)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              animation: 'warningFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div
              style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1.5px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ef4444'
              }}
            >
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                <line x1="12" y1="20" x2="12.01" y2="20"></line>
              </svg>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '0.3px', lineHeight: 1.3 }}>
                与服务器连接断开
              </h3>
              <p style={{ margin: 0, fontSize: '0.84rem', fontWeight: 500, color: 'var(--text-secondary)', lineHeight: 1.5, letterSpacing: '0.2px' }}>
                无法与主机通信，请检查网络连接
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '4px 0' }}>
              <div className="reconnecting-spinner"></div>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.2px' }}>
                正在自动尝试重连...
              </span>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '10px 16px',
                fontWeight: 700,
                fontSize: '0.88rem',
                borderRadius: '8px',
                letterSpacing: '0.5px'
              }}
              onClick={() => window.location.reload()}
            >
              重新连接
            </button>
          </div>
        </div>
      )}
      {/* Silent Custom Fonts Preloader (Guarantees zero-flash instant rendering for all themes) */}
      <div
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -9999
        }}
        aria-hidden="true"
      >
        <span style={{ fontFamily: 'Long Cang, cursive' }}>东南西北局本场地和自摸立直得分玩家一二三四五六七八九十点庄闲0123456789</span>
        <span style={{ fontFamily: 'Ma Shan Zheng, cursive' }}>东南西北局本场地和自摸立直得分玩家一二三四五六七八九十点庄闲0123456789</span>
        <span style={{ fontFamily: 'Klee One, sans-serif' }}>东南西北局本场地和自摸立直得分玩家一二三四五六七八九十点庄闲0123456789</span>
        <span style={{ fontFamily: 'Michroma, sans-serif' }}>0123456789 1ST 2ND 3RD 4TH</span>
      </div>
    </div>
  );
}

export default App;
