import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import type { Theme, GameState, Player } from './types';
import { ScoreBoard } from './components/ScoreBoard';
import { RenameModal } from './components/RenameModal';
import { HandInputModal } from './components/HandInputModal';
import { StageResolver, checkIsServerMode, getInitialRoomId } from './components/StageResolver';
import { HistoryLog } from './components/HistoryLog';
import { LedDigitDisplay } from './components/LedDigitDisplay';
import { HonbaLedBar } from './components/HonbaLedBar';
import { RiichiStickDisplay } from './components/RiichiStickDisplay';
import { ConfirmModal } from './components/ConfirmModal';
import { AppFooter } from './components/AppFooter';
import './App.css';

// Room-scoped seat storage helper
function getStoredSeatForRoom(roomId: string | null, serverMode: boolean): number | null {
  if (typeof window === 'undefined') return null;
  if (serverMode) {
    // Lobby (/home) NEVER has a claimed seat
    if (!roomId) return null;
    const saved = localStorage.getItem(`mahjong-claimed-seat-${roomId}`);
    return saved !== null ? parseInt(saved, 10) : null;
  }
  // LAN mode uses global single-table seat
  const saved = localStorage.getItem('mahjong-claimed-seat');
  return saved !== null ? parseInt(saved, 10) : null;
}

function saveSeatForRoom(roomId: string | null, serverMode: boolean, playerId: number | null) {
  if (typeof window === 'undefined') return;
  if (serverMode) {
    if (roomId) {
      if (playerId !== null) {
        localStorage.setItem(`mahjong-claimed-seat-${roomId}`, playerId.toString());
      } else {
        localStorage.removeItem(`mahjong-claimed-seat-${roomId}`);
      }
    }
  } else {
    if (playerId !== null) {
      localStorage.setItem('mahjong-claimed-seat', playerId.toString());
    } else {
      localStorage.removeItem('mahjong-claimed-seat');
    }
  }
}

// Initialize WebSocket connection.
// In development mode, connect to backend at localhost:32000.
// In production (served by Express), connect to the page's host origin.
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:32000' : window.location.origin;
const socket: Socket = io(SOCKET_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity, // 无限重试，持续保活
  reconnectionDelay: 500, // 重连间隔 500ms
  reconnectionDelayMax: 2000, // 最大重连间隔 2s
  timeout: 20000, // 移动端休眠唤醒握手宽容超时 20s
});

// Persistent Device Token (房间身份凭证):
// - 首次访问生成随机 token 并长期缓存于 localStorage；刷新/重连不变
// - 用于锁房期鉴权（已知 token 放行）、房主/成员权限判定，防止身份冒用
// - 旧版"风位派生 ID（dev_seat_N/玩家N）"不是有效 token，遇到即清除并重新生成
function isDefaultDeviceId(id: string): boolean {
  return id.startsWith('dev_seat_') || /^(?:玩家|选手)\s*[1-4]$/.test(id);
}

// 默认选手名格式（选手 1/2/3/4）：不作为自定义名称持久化/预填，跟随风位
function isDefaultPlayerName(name: string): boolean {
  return /^(?:玩家|选手)\s*[1-4]$/.test(name.trim());
}

function getOrCreateDeviceId(): string {
  let devId = localStorage.getItem('mahjong-device-id');
  if (!devId || isDefaultDeviceId(devId)) {
    const bytes = new Uint8Array(6);
    (window.crypto || (window as any).msCrypto).getRandomValues(bytes);
    devId = 'dev_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('mahjong-device-id', devId);
  }
  return devId;
}

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const [historyCount, setHistoryCount] = useState<number>(50);

  // Viewport height tracker: Android Chrome 进入/退出全屏时都不重算 100vh/100dvh
  //（也不触发 resize）。策略：**仅在全屏期间**用 --app-height 覆盖（dvh 失效才需要
  // JS 兜底，进入后短时高频刷新捕获异步的 innerHeight 变化）；退出全屏立即移除变量，
  // 回落到原生 100dvh——非全屏滚动到底时日志贴着工具栏、仅隔一条分隔线（error2.png
  // 的目标状态），缝隙最小。
  useEffect(() => {
    const root = document.documentElement;
    const isFs = () => !!(
      (document as any).fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
    const apply = () => {
      if (isFs()) root.style.setProperty('--app-height', `${window.innerHeight}px`);
      else root.style.removeProperty('--app-height');
    };
    // Keep the same viewport-height model as automatic browser fullscreen, while avoiding
    // redundant style writes during the browser's fullscreen/viewport transition.
    const applyIfChanged = () => {
      const next = isFs() ? `${window.innerHeight}px` : '';
      if (root.style.getPropertyValue('--app-height') !== next) apply();
    };
    let burstTimer: number | undefined;
    let burstCount = 0;
    const startBurst = () => {
      applyIfChanged();
      if (burstTimer !== undefined) window.clearInterval(burstTimer);
      burstCount = 0;
      burstTimer = window.setInterval(() => {
        applyIfChanged();
        if (++burstCount >= 12) {
          window.clearInterval(burstTimer);
          burstTimer = undefined;
        }
      }, 50);
    };
    startBurst();
    window.addEventListener('resize', startBurst, { passive: true });
    window.addEventListener('orientationchange', startBurst, { passive: true });
    document.addEventListener('fullscreenchange', startBurst);
    document.addEventListener('webkitfullscreenchange', startBurst);
    const vv = window.visualViewport as VisualViewport | undefined;
    vv?.addEventListener('resize', startBurst);
    return () => {
      window.removeEventListener('resize', startBurst);
      window.removeEventListener('orientationchange', startBurst);
      document.removeEventListener('fullscreenchange', startBurst);
      document.removeEventListener('webkitfullscreenchange', startBurst);
      vv?.removeEventListener('resize', startBurst);
      if (burstTimer !== undefined) window.clearInterval(burstTimer);
      root.style.removeProperty('--app-height');
    };
  }, []);

  // Global In-App Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    showCancel?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const showAlert = (message: React.ReactNode, title = '提示') => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmText: '我知道了',
      showCancel: false,
      onConfirm: () => setConfirmDialog(null)
    });
  };





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

  // Mode detection
  const isServer = checkIsServerMode();

  // Route & Room State
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return typeof window !== 'undefined' ? window.location.pathname : '/';
  });
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
    return getInitialRoomId();
  });
  // Ref 镜像当前房间号：socket 监听器（空依赖挂载）内读取最新值，
  // 修复闭包捕获过期房间号导致 game-started 时从错误缓存键读席位、卡在校验层的问题
  const activeRoomIdRef = useRef<string | null>(activeRoomId);
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  // Claim Seat State (strictly room-scoped in Server mode)
  // Server 严格阶段管理：席位进入完全由服务端事件驱动（claim-seat-result.gameStarted /
  // game-started），不从 localStorage 缓存直接置位——同浏览器第二标签页无法绕过大厅直进对局
  const [mySeatId, setMySeatId] = useState<number | null>(() => {
    if (checkIsServerMode()) return null;
    const initialRoom = getInitialRoomId();
    return getStoredSeatForRoom(initialRoom, false);
  });

  // Room host flag (multi-room server mode; server-side token-guarded, delivered via room-role event)
  const [isHost, setIsHost] = useState<boolean>(false);

  // Lobby-stage state (multi-room server mode): seat confirmations, all-confirmed flag, lock state
  const [lobby, setLobby] = useState<{
    roomId: string;
    locked: boolean;
    started: boolean;
    confirmedSeatIds: number[];
    members: { seatId: number | null; isHost: boolean }[];
    allConfirmed: boolean;
  } | null>(null);

  // Browser Navigation Listener (PopState)
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const newRoom = getInitialRoomId();
      setCurrentPath(path);
      setActiveRoomId(newRoom);
      activeRoomIdRef.current = newRoom;
      if (isServer) {
        // Server 严格阶段管理：阶段由服务端事件驱动；换房/回房重新 join-room，
        // 对局已开始则由服务端按 token 自动重绑（claim-seat-result.gameStarted）
        setMySeatId(null);
        setLobby(null);
        if (newRoom) {
          socket.emit('join-room', { roomId: newRoom, deviceId: getOrCreateDeviceId() });
        }
      } else {
        setMySeatId(getStoredSeatForRoom(newRoom, false));
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isServer]);

  // Route Navigation Handlers
  const handleNavigateToRoom = (roomId: string) => {
    window.history.pushState(null, '', `/${roomId}`);
    setCurrentPath(`/${roomId}`);
    setActiveRoomId(roomId);
    activeRoomIdRef.current = roomId;
    const seat = getStoredSeatForRoom(roomId, isServer);
    setMySeatId(seat);
    setIsHost(false); // Re-evaluated via room-role after join-room binding
    setLobby(null); // Fresh lobby state arrives via lobby-updated after join-room
    setMySeatId(isServer ? null : getStoredSeatForRoom(roomId, false)); // Server: stage entry is event-driven only
    socket.emit('join-room', { roomId, deviceId: getOrCreateDeviceId() });
    if (seat !== null) {
      const currentSavedName = localStorage.getItem('mahjong-player-name') || '';
      socket.emit('claim-seat', { 
        roomId,
        playerId: seat, 
        playerName: currentSavedName, 
        deviceId: getOrCreateDeviceId() 
      });
    }
  };

  const handleBackToPortal = () => {
    window.history.pushState(null, '', '/home');
    setCurrentPath('/home');
    setActiveRoomId(null);
    activeRoomIdRef.current = null;
    setMySeatId(null);
  };



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
  const [tempGameMode, setTempGameMode] = useState<'yonma' | 'sanma'>('yonma');
  const lastKnownGameModeRef = useRef<string | null>(null);

  useEffect(() => {
    const currentMode = gameState?.gameMode || (gameState?.players?.length === 3 ? 'sanma' : gameState?.players?.length === 4 ? 'yonma' : null);
    if (currentMode && lastKnownGameModeRef.current !== currentMode) {
      lastKnownGameModeRef.current = currentMode;
      setTempGameMode(currentMode);
    }
  }, [gameState?.gameMode, gameState?.players?.length]);
  const [tempGameLength, setTempGameLength] = useState<'hanchan' | 'tonpuu'>('hanchan');
  const [tempMultiRonEnabled, setTempMultiRonEnabled] = useState<boolean>(true);
  const [tempDobonEnabled, setTempDobonEnabled] = useState<boolean>(true);
  const [tempWestRoundEnabled, setTempWestRoundEnabled] = useState<boolean>(true);
  const [tempAgariYameEnabled, setTempAgariYameEnabled] = useState<boolean>(true);
  const [tempKiriageManganEnabled, setTempKiriageManganEnabled] = useState<boolean>(true);
  const [activeStatsPlayerId, setActiveStatsPlayerId] = useState<number>(0);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);


  const [serverLanUrl, setServerLanUrl] = useState<string>('');
  const [isWifi, setIsWifi] = useState<boolean>(true);

  useEffect(() => {
    if (isShareModalOpen) {
      const updateNetwork = () => {
        fetch('/api/lan-ip')
          .then((res) => res.json())
          .then((data) => {
            if (data && data.url) {
              setServerLanUrl(data.url);
            }
            const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
            const clientType = conn?.type;
            const isClientCellular = clientType === 'cellular' || clientType === 'mobile';

            if (isClientCellular) {
              setIsWifi(false);
            } else if (data && typeof data.isWifi === 'boolean') {
              setIsWifi(data.isWifi);
            } else if (data && data.networkType) {
              setIsWifi(data.networkType === 'wifi');
            }
          })
          .catch(() => {});
      };

      updateNetwork();

      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn && conn.addEventListener) {
        conn.addEventListener('change', updateNetwork);
        return () => {
          conn.removeEventListener('change', updateNetwork);
        };
      }
    }
  }, [isShareModalOpen]);

  const getLanShareUrl = () => {
    const origin = window.location.origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    // 若通过公网域名、HTTPS 隧道反代或已解析好的 IP 访问，直接使用当前浏览器 origin
    if (!isLocalhost) {
      return origin.endsWith('/') ? origin : origin + '/';
    }

    // 主机以 localhost/127.0.0.1 本地访问时，优先使用服务端动态探测出的真实局域网/热点 IP
    if (serverLanUrl && !serverLanUrl.includes('127.0.0.1') && !serverLanUrl.includes('localhost')) {
      return serverLanUrl.endsWith('/') ? serverLanUrl : serverLanUrl + '/';
    }
    if (gameState?.lanUrl && !gameState.lanUrl.includes('127.0.0.1') && !gameState.lanUrl.includes('localhost')) {
      return gameState.lanUrl.endsWith('/') ? gameState.lanUrl : gameState.lanUrl + '/';
    }
    return origin.endsWith('/') ? origin : origin + '/';
  };
  // 分享链接：server 版由前端构造并带房间号（/房间号），确保直达对局；LAN 版保持原逻辑
  const getShareUrl = () => {
    const base = getLanShareUrl();
    if (isServer && activeRoomId) {
      return base.replace(/\/$/, '') + '/' + activeRoomId;
    }
    return base;
  };
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const handleCopyUrl = () => {
    const url = getShareUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      }).catch(() => {});
    }
  };
  const [tempStartingPoints, setTempStartingPoints] = useState<number>(25000);
  const [tempStartingPointsStr, setTempStartingPointsStr] = useState<string>('25000');
  const [tempOkaPoints, setTempOkaPoints] = useState<number>(30000);
  const [tempOkaPointsStr, setTempOkaPointsStr] = useState<string>('30000');

  const openSettingsModal = () => {
    const currentMode = gameState?.gameMode || (gameState?.players?.length === 3 ? 'sanma' : 'yonma');
    const isPreselectedMode = tempGameMode !== currentMode;

    if (gameState?.settings) {
      setTempGameLength(gameState.settings.gameLength ?? 'hanchan');
      setTempMultiRonEnabled(gameState.settings.multiRonEnabled ?? true);
      setTempDobonEnabled(gameState.settings.dobonEnabled ?? true);

      if (isPreselectedMode) {
        const defaultStart = tempGameMode === 'sanma' ? 35000 : 25000;
        const defaultOka = tempGameMode === 'sanma' ? 40000 : 30000;
        setTempStartingPoints(defaultStart);
        setTempStartingPointsStr(defaultStart.toString());
        setTempOkaPoints(defaultOka);
        setTempOkaPointsStr(defaultOka.toString());
      } else {
        setTempStartingPoints(gameState.settings.startingPoints);
        setTempStartingPointsStr(gameState.settings.startingPoints.toString());
        setTempOkaPoints(gameState.settings.okaPoints ?? (tempGameMode === 'sanma' ? 40000 : 30000));
        setTempOkaPointsStr((gameState.settings.okaPoints ?? (tempGameMode === 'sanma' ? 40000 : 30000)).toString());
      }

      setTempWestRoundEnabled(gameState.settings.westRoundEnabled ?? true);
      setTempAgariYameEnabled(gameState.settings.agariYameEnabled ?? true);
      setTempKiriageManganEnabled(gameState.settings.kiriageManganEnabled ?? true);
    } else {
      const defaultStart = tempGameMode === 'sanma' ? 35000 : 25000;
      const defaultOka = tempGameMode === 'sanma' ? 40000 : 30000;
      setTempGameLength('hanchan');
      setTempMultiRonEnabled(true);
      setTempDobonEnabled(true);
      setTempStartingPoints(defaultStart);
      setTempStartingPointsStr(defaultStart.toString());
      setTempOkaPoints(defaultOka);
      setTempOkaPointsStr(defaultOka.toString());
      setTempWestRoundEnabled(true);
      setTempAgariYameEnabled(true);
      setTempKiriageManganEnabled(true);
    }
    setIsSettingsModalOpen(true);
  };

  const handleSaveSettings = () => {
    // 统一的分数合法性检查 (最小单位为100且符合最小值要求)
    if (!tempStartingPoints || isNaN(tempStartingPoints) || tempStartingPoints <= 0 || tempStartingPoints % 100 !== 0) {
      showAlert('起始点数须为100的倍数且不低于100', '参数设置提示');
      return;
    }
    const minOka = tempStartingPoints > 0 ? tempStartingPoints : (tempGameMode === 'sanma' ? 35000 : 25000);
    if (tempWestRoundEnabled && (!tempOkaPoints || isNaN(tempOkaPoints) || tempOkaPoints < minOka || tempOkaPoints % 100 !== 0)) {
      showAlert(`1位必要点数须为100的倍数且不低于${minOka}`, '参数设置提示');
      return;
    }

    const safeOkaPoints = (tempOkaPoints && !isNaN(tempOkaPoints) && tempOkaPoints >= minOka && tempOkaPoints % 100 === 0)
      ? tempOkaPoints
      : (tempStartingPoints + 5000);

    const currentMode = gameState?.gameMode || (gameState?.players.length === 3 ? 'sanma' : 'yonma');
    const isModeChanged = tempGameMode !== currentMode;
    const currentStarting = gameState?.settings?.startingPoints ?? (currentMode === 'sanma' ? 35000 : 25000);
    const isStartingChanged = tempStartingPoints !== currentStarting;
    const currentLength = gameState?.settings?.gameLength ?? 'hanchan';
    const isLengthChanged = tempGameLength !== currentLength;

    if (isModeChanged || isStartingChanged || isLengthChanged) {
      const changes: { tag: string; content: string }[] = [];
      if (isModeChanged) {
        changes.push({
          tag: '[对局模式]',
          content: `${currentMode === 'sanma' ? '三人麻将' : '四人麻将'} → ${tempGameMode === 'sanma' ? '三人麻将' : '四人麻将'}`
        });
      }
      if (isLengthChanged) {
        changes.push({
          tag: '[局数]',
          content: `${currentLength === 'tonpuu' ? '东风' : '半庄'} → ${tempGameLength === 'tonpuu' ? '东风' : '半庄'}`
        });
      }
      if (isStartingChanged) {
        changes.push({
          tag: '[起始点数]',
          content: `${currentStarting} 点 → ${tempStartingPoints} 点`
        });
      }

      setConfirmDialog({
        isOpen: true,
        title: '对局重置提示',
        message: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
              {changes.map((item, idx) => (
                <div
                  key={idx}
                  className="history-item history-item-single is-latest"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderLeft: '3px solid var(--color-accent)',
                    borderRadius: '6px',
                    padding: '7px 10px',
                    fontSize: '0.84rem',
                    lineHeight: 1.4,
                    boxSizing: 'border-box',
                    textAlign: 'left'
                  }}
                >
                  <span className="history-item-inline-tag">{item.tag}</span>{' '}
                  <span className="history-item-inline-content">{item.content}</span>
                </div>
              ))}
            </div>
            <p className="dialog-message-text" style={{ margin: 0, textAlign: 'center', lineHeight: 1.55 }}>确定更改以上设置？此操作将重置对局</p>
          </div>
        ),
        confirmText: '确认重置并应用',
        cancelText: '取消',
        isDanger: true,
        onConfirm: () => {
          socket.emit('reset-game', {
            gameMode: tempGameMode,
            settings: {
              multiRonEnabled: tempMultiRonEnabled,
              dobonEnabled: tempDobonEnabled,
              startingPoints: tempStartingPoints,
              okaPoints: safeOkaPoints,
              westRoundEnabled: tempWestRoundEnabled,
              agariYameEnabled: tempAgariYameEnabled,
              kiriageManganEnabled: tempKiriageManganEnabled,
              gameLength: tempGameLength
            }
          });
          setIsSettingsModalOpen(false);
          setConfirmDialog(null);
        }
      });
      return;
    }

    // Normal non-reset save
    const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
    if (!nextState.settings) {
      nextState.settings = {
        multiRonEnabled: tempMultiRonEnabled,
        dobonEnabled: tempDobonEnabled,
        startingPoints: tempStartingPoints,
        okaPoints: safeOkaPoints,
        westRoundEnabled: tempWestRoundEnabled,
        agariYameEnabled: tempAgariYameEnabled,
        kiriageManganEnabled: tempKiriageManganEnabled,
        gameLength: tempGameLength
      };
    } else {
      nextState.settings.multiRonEnabled = tempMultiRonEnabled;
      nextState.settings.dobonEnabled = tempDobonEnabled;
      nextState.settings.startingPoints = tempStartingPoints;
      nextState.settings.okaPoints = safeOkaPoints;
      nextState.settings.westRoundEnabled = tempWestRoundEnabled;
      nextState.settings.agariYameEnabled = tempAgariYameEnabled;
      nextState.settings.kiriageManganEnabled = tempKiriageManganEnabled;
      nextState.settings.gameLength = tempGameLength;
    }

    const prevSettings = gameState?.settings;
    const changes: string[] = [];
    if (tempGameLength !== (prevSettings?.gameLength ?? 'hanchan')) {
      const from = (prevSettings?.gameLength ?? 'hanchan') === 'tonpuu' ? '东风' : '半庄';
      const to = tempGameLength === 'tonpuu' ? '东风' : '半庄';
      changes.push(`[局数 ${from}→${to}]`);
    }
    if (tempMultiRonEnabled !== (prevSettings?.multiRonEnabled ?? true)) {
      const from = (prevSettings?.multiRonEnabled ?? true) ? '开' : '关';
      const to = tempMultiRonEnabled ? '开' : '关';
      changes.push(`[多家和了 ${from}→${to}]`);
    }
    if (tempDobonEnabled !== (prevSettings?.dobonEnabled ?? true)) {
      const from = (prevSettings?.dobonEnabled ?? true) ? '开' : '关';
      const to = tempDobonEnabled ? '开' : '关';
      changes.push(`[击飞 ${from}→${to}]`);
    }
    if (tempWestRoundEnabled !== (prevSettings?.westRoundEnabled ?? true)) {
      const extName = (tempGameLength === 'tonpuu' || prevSettings?.gameLength === 'tonpuu') ? '南入' : '西入';
      const from = (prevSettings?.westRoundEnabled ?? true) ? '开' : '关';
      const to = tempWestRoundEnabled ? '开' : '关';
      changes.push(`[${extName} ${from}→${to}]`);
    }
    if (tempAgariYameEnabled !== (prevSettings?.agariYameEnabled ?? true)) {
      const from = (prevSettings?.agariYameEnabled ?? true) ? '开' : '关';
      const to = tempAgariYameEnabled ? '开' : '关';
      changes.push(`[和了即止 ${from}→${to}]`);
    }
    if (tempKiriageManganEnabled !== (prevSettings?.kiriageManganEnabled ?? true)) {
      const from = (prevSettings?.kiriageManganEnabled ?? true) ? '开' : '关';
      const to = tempKiriageManganEnabled ? '开' : '关';
      changes.push(`[切上满贯 ${from}→${to}]`);
    }
    if (tempWestRoundEnabled && safeOkaPoints !== (prevSettings?.okaPoints ?? (currentMode === 'sanma' ? 40000 : 30000))) {
      const from = prevSettings?.okaPoints ?? (currentMode === 'sanma' ? 40000 : 30000);
      changes.push(`[1位必要点数 ${from} 点→ ${safeOkaPoints} 点]`);
    }

    let logMsg = '';
    if (changes.length === 1) {
      logMsg = `[修改对局规则] ${changes[0]}`;
    } else if (changes.length > 1) {
      logMsg = `[修改对局规则]\n${changes.join('\n')}`;
    }
    handleUpdateState(nextState, logMsg);
    setIsSettingsModalOpen(false);
  };

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');

      // Join room (server mode: 对局已开始时服务端按 token 自动重绑并下发 gameStarted)
      const targetRoom = isServer ? activeRoomId : 'default';
      if (targetRoom) {
        socket.emit('join-room', { roomId: targetRoom, deviceId: getOrCreateDeviceId() });
      }

      // LAN legacy: re-claim cached seat on reconnect (server mode uses strict stage flow)
      if (!isServer) {
        const currentSavedSeat = getStoredSeatForRoom(null, false);
        const currentSavedName = localStorage.getItem('mahjong-player-name') || '';
        if (currentSavedSeat !== null) {
          socket.emit('claim-seat', {
            playerId: currentSavedSeat,
            playerName: currentSavedName,
            deviceId: getOrCreateDeviceId()
          });
        }
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
    });

    socket.on('state-updated', (state: GameState) => {
      setGameState(state);
    });

    socket.on('history-info', (info: { canUndo: boolean; canRedo: boolean; historyCount?: number }) => {
      setCanUndo(info.canUndo);
      setCanRedo(info.canRedo);
      if (typeof info.historyCount === 'number') {
        setHistoryCount(info.historyCount);
      }
    });

    socket.on('claim-seat-result', (res: { success: boolean; reason?: string; playerId?: number; gameStarted?: boolean }) => {
      if (res.success) {
        saveSeatForRoom(activeRoomIdRef.current, isServer, res.playerId!);
        // Server lobby flow: claim = 确认选座，mySeatId 待 game-started 统一置位；
        // gameStarted=true（重连时对局已开始）则直接进入对局。LAN 流程保持原样。
        if (!isServer || res.gameStarted) {
          setMySeatId(res.playerId!);
        }
      } else {
        showAlert(res.reason || '席位认领失败', '席位认领提示');
        setMySeatId(null);
        saveSeatForRoom(activeRoomIdRef.current, isServer, null);
      }
    });

    socket.on('force-clear-seats', () => {
      setMySeatId(null);
      saveSeatForRoom(activeRoomIdRef.current, isServer, null);
    });

    socket.on('room-disbanded', (data?: { message?: string }) => {
      setMySeatId(null);
      saveSeatForRoom(activeRoomIdRef.current, isServer, null);
      if (isHost) {
        handleBackToPortal();
        return;
      }
      showAlert(data?.message || '房间已被解散，正在返回大厅...', '房间解散提示');
      setTimeout(() => {
        handleBackToPortal();
      }, 1500);
    });

    socket.on('room-disbanded-host', () => {
      setMySeatId(null);
      saveSeatForRoom(activeRoomIdRef.current, isServer, null);
      handleBackToPortal();
    });

    socket.on('lobby-updated', (data?: { roomId?: string }) => {
      setLobby((data as any) || null);
    });

    socket.on('game-started', () => {
      // 房主开始对局：所有已确认选座的成员同步进入对局
      const seat = getStoredSeatForRoom(activeRoomIdRef.current, isServer);
      if (seat !== null) {
        setMySeatId(seat);
      }
    });

    socket.on('room-not-found', (data?: { message?: string }) => {
      showAlert(data?.message || '该房间不存在，请返回大厅重新输入', '房间不存在');
      handleBackToPortal();
    });

    socket.on('game-already-started', (data?: { message?: string }) => {
      // URL 访问已开始的对局：不进入选座阶段，弹现有弹窗样式后返回大厅
      showAlert(data?.message || '该对局已开始，无法加入', '对局开始提示');
      handleBackToPortal();
    });

    socket.on('seat-moved', (data?: { roomId?: string; seatId?: number }) => {
      // 房主交换/移动成员席位：更新本设备的房间域席位缓存
      if (data && typeof data.seatId === 'number') {
        saveSeatForRoom(activeRoomIdRef.current, isServer, data.seatId);
        window.dispatchEvent(new CustomEvent('mahjong-seat-moved', { detail: { roomId: activeRoomIdRef.current, seatId: data.seatId } }));
      }
    });

    socket.on('action-error', (data?: { message?: string }) => {
      showAlert(data?.message || '操作失败', '提示');
    });

    socket.on('game-time-warning', (data?: { message?: string; remainingMinutes?: number }) => {
      showAlert(
        data?.message || '本局对局已进行 4 小时，剩余保留时间 1 小时，超时将自动解散房间，请尽快完成对局。',
        '对局时间提醒'
      );
    });

    socket.on('room-role', (data?: { roomId?: string; isHost?: boolean }) => {
      setIsHost(Boolean(data?.isHost));
    });

    socket.on('kicked', (data?: { message?: string }) => {
      setMySeatId(null);
      saveSeatForRoom(activeRoomIdRef.current, isServer, null);
      showAlert(data?.message || '您已被移出房间，正在返回大厅...', '移出提示');
      setTimeout(() => {
        handleBackToPortal();
      }, 1500);
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        socket.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      socket.off('connect');
      socket.off('disconnect');
      socket.off('state-updated');
      socket.off('history-info');
      socket.off('claim-seat-result');
      socket.off('force-clear-seats');
      socket.off('room-role');
      socket.off('room-disbanded-host');
      socket.off('kicked');
      socket.off('lobby-updated');
      socket.off('game-started');
      socket.off('room-not-found');
      socket.off('game-already-started');
      socket.off('seat-moved');
      socket.off('action-error');
      socket.off('game-time-warning');
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

  const { wind, round, honba, riichiSticks } = gameState;

  // Handle complete state updates (broadcasts to all devices)
  const handleUpdateState = (newState: GameState, logMsg: string) => {
    socket.emit('update-state', newState, logMsg);
  };

  // Rename player confirm (completely decoupled from logs and undo/redo history)
  const handleRenameConfirm = (playerId: number, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    // If this rename corresponds to my own claimed seat, update localStorage
    if (mySeatId === playerId) {
      // 默认格式（玩家 N）不保存为自定义昵称，避免重置后残留
      if (isDefaultPlayerName(trimmed)) {
        localStorage.removeItem('mahjong-player-name');
      } else {
        localStorage.setItem('mahjong-player-name', trimmed);
      }
    }

    socket.emit('rename-player', { playerId, newName: trimmed });
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

  const handleRollback = (targetLogIndex: number) => {
    socket.emit('rollback-to-history', { targetLogIndex });
  };

  // Open HUD Edit Modal
  const openHudModal = () => {
    setTempWind(wind);
    setTempRound(round);
    setTempHonba(honba);
    setTempDobonEnabled(gameState?.settings?.dobonEnabled ?? true);
    setIsHudModalOpen(true);
  };

    // Confirm HUD Edit
  const handleHudConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
    const playerCount = gameState.players.length || 4;
    const computedDealerIndex = (tempRound - 1) % playerCount;

    nextState.wind = tempWind;
    nextState.round = tempRound;
    nextState.honba = tempHonba;
    nextState.riichiSticks = gameState.riichiSticks;
    nextState.dealerIndex = computedDealerIndex;
    nextState.settings = {
      ...(gameState?.settings ?? {}),
      dobonEnabled: tempDobonEnabled,
      startingPoints: gameState?.settings?.startingPoints ?? 25000,
      okaPoints: gameState?.settings?.okaPoints ?? 30000,
      westRoundEnabled: gameState?.settings?.westRoundEnabled ?? true,
      agariYameEnabled: gameState?.settings?.agariYameEnabled ?? true,
      kiriageManganEnabled: gameState?.settings?.kiriageManganEnabled ?? true,
      multiRonEnabled: gameState?.settings?.multiRonEnabled ?? true,
    };

    const windName = tempWind === 'east' ? '东' : (tempWind === 'south' ? '南' : '西');
    const dobonChanged = tempDobonEnabled !== (gameState?.settings?.dobonEnabled ?? true);
    const dobonMsg = dobonChanged ? (tempDobonEnabled ? ' [击飞 关→开]' : ' [击飞 开→关]') : '';
    const logMsg = `[修改局况] [${windName}${tempRound}局|${tempHonba}本场] 庄:[${nextState.players[computedDealerIndex].name}] 供托:${gameState.riichiSticks}根${dobonMsg}`;
    
    handleUpdateState(nextState, logMsg);
    setIsHudModalOpen(false);
  };

  // Handle seat claim confirm from ClaimSeatModal / ServerClaimSeatStage
  const handleClaimSeat = (playerId: number, name: string) => {
    // Server lobby flow: claim = 确认选座（不进入对局，等待房主 start-game）
    // LAN flow: mySeatId 由 claim-seat-result 回包驱动
    saveSeatForRoom(activeRoomId, isServer, playerId);
    // 默认格式（玩家 N）不保存为自定义昵称，避免重置后残留
    if (isDefaultPlayerName(name)) {
      localStorage.removeItem('mahjong-player-name');
    } else {
      localStorage.setItem('mahjong-player-name', name);
    }
    const targetRoom = isServer ? (activeRoomId || 'default') : 'default';
    socket.emit('claim-seat', { roomId: targetRoom, playerId, playerName: name, deviceId: getOrCreateDeviceId() });
  };

  // Release/switch seats (LAN Mode)
  const handleReleaseSeat = () => {
    setConfirmDialog({
      isOpen: true,
      title: '切换席位确认',
      message: '确定切换席位？释放后需重新选择席位。',
      confirmText: '确认释放',
      cancelText: '取消',
      isDanger: true,
      onConfirm: () => {
        socket.emit('release-seat', { roomId: 'default' });
        setMySeatId(null);
        saveSeatForRoom(null, false, null);
        localStorage.removeItem('mahjong-player-name');
        setConfirmDialog(null);
      }
    });
  };

  // Exit/disband room (Server Mode)
  const handleExitRoom = () => {
    setConfirmDialog({
      isOpen: true,
      title: '退出房间确认',
      message: '确定退出当前房间并返回大厅吗？',
      confirmText: '退出房间',
      cancelText: '取消',
      isDanger: true,
      onConfirm: () => {
        if (socket && activeRoomId) {
          if (mySeatId !== null && !lobby?.started) {
            socket.emit('release-seat', { roomId: activeRoomId, playerId: mySeatId });
          }
          // [PROVISION] 预留离开房间 / 解散房间协同事件
          socket.emit('leave-room', { roomId: activeRoomId, playerId: mySeatId });
        }
        setMySeatId(null);
        saveSeatForRoom(activeRoomId, true, null);
        localStorage.removeItem('mahjong-player-name');
        setConfirmDialog(null);
        handleBackToPortal();
      }
    });
  };

  // Disband room (host only, multi-room server mode; server validates the host device token)
  const handleDisbandRoom = () => {
    setConfirmDialog({
      isOpen: true,
      title: '解散房间确认',
      message: '确定解散房间？所有成员将移回大厅。',
      confirmText: '解散房间',
      cancelText: '取消',
      isDanger: true,
      onConfirm: () => {
        if (socket && activeRoomId) {
          socket.emit('disband-room', { roomId: activeRoomId, deviceId: getOrCreateDeviceId() });
        }
        setConfirmDialog(null);
      }
    });
  };

  // Kick a member from the room (host only, multi-room server mode)
  const handleKickPlayer = (playerId: number) => {
    const target = gameState.players.find(p => p.id === playerId);
    setConfirmDialog({
      isOpen: true,
      title: '移出成员确认',
      message: `确定将 [${target?.name || `选手 ${playerId + 1}`}] 移出房间吗？`,
      confirmText: '移出',
      cancelText: '取消',
      isDanger: true,
      onConfirm: () => {
        if (socket && activeRoomId) {
          socket.emit('kick-player', { roomId: activeRoomId, playerId, deviceId: getOrCreateDeviceId() });
        }
        setConfirmDialog(null);
      }
    });
  };

  // Host starts the game (multi-room server mode): server validates all-prepared & locks the room;
  // 房主无需准备——可先选座，服务端按 seatId 入座（被占则回退首个空闲席）
  const handleStartGame = (hostName: string, seatId?: number) => {
    setConfirmDialog({
      isOpen: true,
      title: '开始对局确认',
      message: '确定要开始对局吗？房间将被锁定。',
      confirmText: '开始对局',
      cancelText: '取消',
      isDanger: false,
      onConfirm: () => {
        if (socket && activeRoomId) {
          socket.emit('start-game', { roomId: activeRoomId, deviceId: getOrCreateDeviceId(), playerName: hostName, seatId });
        }
        setConfirmDialog(null);
      }
    });
  };

  // Host moves a prepared member to the host's selected (free) seat (multi-room server mode)
  const handleMoveMember = (fromSeat: number, toSeat: number) => {
    if (socket && activeRoomId) {
      socket.emit('move-member', { roomId: activeRoomId, deviceId: getOrCreateDeviceId(), fromSeat, toSeat });
    }
  };

  // Host swaps two confirmed seats (multi-room server mode)
  const handleSwapSeats = (seatA: number, seatB: number) => {
    if (socket && activeRoomId) {
      socket.emit('swap-seats', { roomId: activeRoomId, seatA, seatB, deviceId: getOrCreateDeviceId() });
      if (mySeatId === seatA) {
        saveSeatForRoom(activeRoomId, true, seatB);
        setMySeatId(seatB);
      } else if (mySeatId === seatB) {
        saveSeatForRoom(activeRoomId, true, seatA);
        setMySeatId(seatA);
      }
    }
  };

  // Host releases their locked seat in server mode
  const handleHostReleaseSeat = () => {
    if (socket && activeRoomId) {
      socket.emit('release-seat', { roomId: activeRoomId });
      saveSeatForRoom(activeRoomId, true, null);
      setMySeatId(null);
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

  // Stage resolution:
  // - Server Mode: /home strictly routes to RoomPortalStage; /12345 routes to ServerClaimSeatStage (unclaimed) or GameBoard (claimed)
  // - LAN Mode: strictly stays at / (ClaimSeatStage when unclaimed, GameBoard when claimed)
  const isHomeRoute = isServer && (!activeRoomId || currentPath === '/home' || currentPath === '/home/');
  const shouldRenderStage = isHomeRoute || mySeatId === null;
  // 严格阶段管理：带房间号的页面在 join-room 校验完成前（lobby 未到达），
  // 不渲染 ServerClaimSeatStage——渲染连接等待层；房间已锁定同样不渲染（等弹窗/回大厅）
  const lobbyPending = isServer && !isHomeRoute && activeRoomId && mySeatId === null && lobby === null;
  const roomLockedForMe = isServer && !isHomeRoute && mySeatId === null && lobby?.locked === true;
  const stageBlocked = Boolean(lobbyPending || roomLockedForMe);

  return (
    <div className={`app-container ${shouldRenderStage && !stageBlocked ? 'claim-stage-container' : ''}`}>
      {stageBlocked ? (
        <div className="modal-overlay">
          <div style={{ textAlign: 'center' }}>
            <div className="status-dot disconnected" style={{ margin: '0 auto 16px', width: '20px', height: '20px' }}></div>
            <h2>正在校验房间状态...</h2>
            <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>请确保设备与服务端处于同一局域网内</p>
          </div>
        </div>
      ) : shouldRenderStage ? (
        <StageResolver
          gameState={gameState}
          theme={theme}
          onThemeChange={setTheme}
          onConfirm={handleClaimSeat}
          currentRoomId={activeRoomId}
          onRoomSelect={handleNavigateToRoom}
          onBackToPortal={handleBackToPortal}
          onOpenSettings={openSettingsModal}
          onOpenShare={() => setIsShareModalOpen(true)}
          isHost={isServer && isHost}
          onDisbandRoom={handleDisbandRoom}
          lobby={isServer ? lobby : null}
          onStartGame={handleStartGame}
          onMoveMember={handleMoveMember}
          onKickPlayer={handleKickPlayer}
          onSwapSeats={handleSwapSeats}
          onReleaseSeat={handleHostReleaseSeat}
          deviceToken={getOrCreateDeviceId()}
        />
      ) : (
        <>
          {/* Header (Strictly locked 48px height across all themes) */}
          <header className="app-header" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', width: '100%', height: '48px', minHeight: '48px', maxHeight: '48px', padding: '0 12px', boxSizing: 'border-box' }}>
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
          <h1 className="app-title" style={{ gridColumn: 2, justifySelf: 'center', margin: 0, fontSize: '1.25rem', fontWeight: 800, height: '30px', lineHeight: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
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
              <div style={{ display: 'flex', alignItems: 'center' }}>
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
                height: '26px',
                lineHeight: '24px',
                padding: '0 9px',
                fontSize: '0.72rem',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#f4f4f5',
                boxShadow: 'none',
                borderRadius: '4px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box'
              }}
              title="单击展示得点差2s（多次单击刷新时间）；长按2s锁定展示，再次单击退出"
            >
              顺位/得点差
            </button>
          )}
        </div>
      </header>

      {gameState.isOver ? (
        /* Game Over Panel */
        <>
          <section className="game-over-panel">
            <h2 className="game-over-title">{gameState.settings?.gameLength === 'tonpuu' ? '东风终局' : '半庄终局'}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              本{gameState.settings?.gameLength === 'tonpuu' ? '东风' : '半庄'}对局已终局。各家最终顺位及点数如下：
            </p>
            <div className="rank-list">
              {[...gameState.players]
                .sort((a, b) => b.score - a.score)
                .map((p, idx) => {
                  const origSeatIdx = gameState.players.findIndex(origP => origP.id === p.id);
                  const origWind = ['东', '南', '西', '北'][origSeatIdx >= 0 ? origSeatIdx : 0];
                  return (
                    <div key={p.id} className={`rank-item rank-${idx + 1}`}>
                      <span style={{ fontWeight: 800, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="rank-badge">{idx + 1}位</span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{origWind}家</span>
                        {p.name}
                        {mySeatId !== null && p.id === mySeatId && (
                          theme === 'majsoul' ? (
                            <span className="majsoul-jika-badge" title="自家">
                              <span className="majsoul-jika-badge-inner">自家</span>
                            </span>
                          ) : (
                            <span className="jika-badge" title="自家">自家</span>
                          )
                        )}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.2rem' }}>
                        {p.score} 点
                      </span>
                    </div>
                  );
                })}
            </div>
          </section>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px', fontSize: '1.05rem' }}
            onClick={handleReset}
          >
            开始新{gameState.settings?.gameLength === 'tonpuu' ? '东风' : '半庄'}
          </button>

          {/* Score History Table & Stats */}
          {gameState.scoreHistory && gameState.scoreHistory.length > 1 && (
            <div className="score-chart-wrapper" style={{ marginTop: '20px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              {(() => {
                const totalRounds = gameState.scoreHistory ? gameState.scoreHistory.length - 1 : 0;
                const drawRounds = gameState.log.filter(line => line.includes('流局')).length;
                return (
                  <div style={{ marginBottom: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      总局数: <strong style={{ color: 'var(--text-primary)' }}>{totalRounds}</strong> 局 | 流局数: <strong style={{ color: 'var(--text-primary)' }}>{drawRounds}</strong> 局
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const history = gameState.scoreHistory || [];

                // Group log entries by rounds (1..totalRounds)
                const roundLogs: { settlementLog: string; riichiLogs: string[] }[] = [];
                let currentRiichis: string[] = [];

                for (let i = 0; i < gameState.log.length; i++) {
                  const line = gameState.log[i];
                  if (line.includes('[立直]') || line.includes('宣告立直')) {
                    currentRiichis.push(line);
                  } else if (line.includes('自摸') || line.includes('荣和') || line.includes('多家和了') || line.includes('放铳') || line.includes('流局') || line.includes('诈和')) {
                    roundLogs.push({
                      settlementLog: line,
                      riichiLogs: currentRiichis
                    });
                    currentRiichis = [];
                  }
                }

                return (
                  <div>
                    {/* 各局点数推移表格 (替代原有折线图) */}
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, margin: '4px 0 10px 0', color: 'var(--text-primary)', textAlign: 'center' }}>
                      各局点数推移
                    </div>

                    <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '14px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'center', tableLayout: 'fixed' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(128, 128, 128, 0.06)', color: 'var(--text-secondary)' }}>
                            <th style={{ width: '48px', minWidth: '44px', padding: '8px 2px', fontWeight: 600, borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>
                              局况
                            </th>
                            {gameState.players.map((p, pIdx) => (
                              <th
                                key={p.id}
                                style={{
                                  padding: '8px 2px',
                                  fontWeight: 600,
                                  borderRight: pIdx < gameState.players.length - 1 ? '1px solid var(--border-color)' : 'none',
                                  verticalAlign: 'middle'
                                }}
                              >
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '64px', margin: '0 auto' }} title={p.name}>
                                  {p.name}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((roundScores, rIdx) => {
                            let roundLabel = rIdx === 0 ? '起点' : (gameState.roundHistory?.[rIdx] || `第${rIdx}局`);
                            let roundTooltip = '';
                            if (rIdx > 0 && roundLogs[rIdx - 1]?.settlementLog) {
                              roundTooltip = roundLogs[rIdx - 1].settlementLog;
                              const match = roundLogs[rIdx - 1].settlementLog.match(/\[([东南西北]\d+局?)\/(\d+)本场\]/);
                              if (match) {
                                const windNum = match[1].replace('局', '');
                                const honba = parseInt(match[2], 10);
                                roundLabel = honba > 0 ? `${windNum}-${honba}` : windNum;
                              }
                            }

                            const isEven = rIdx % 2 === 0;
                            const isLastRound = rIdx === history.length - 1;

                            return (
                              <tr
                                key={rIdx}
                                title={roundTooltip || undefined}
                                style={{
                                  borderBottom: rIdx < history.length - 1 ? '1px solid var(--border-color)' : 'none',
                                  backgroundColor: isLastRound
                                    ? 'rgba(128, 128, 128, 0.09)'
                                    : (isEven ? 'rgba(128, 128, 128, 0.03)' : 'transparent')
                                }}
                              >
                                <td
                                  style={{
                                    padding: '6px 2px',
                                    fontWeight: isLastRound ? 800 : 600,
                                    color: isLastRound ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    borderRight: '1px solid var(--border-color)',
                                    verticalAlign: 'middle',
                                    fontFamily: 'monospace',
                                    fontSize: '0.72rem'
                                  }}
                                >
                                  {roundLabel}
                                </td>
                                {gameState.players.map((p, pIdx) => {
                                  const score = roundScores[pIdx];
                                  const prevScore = rIdx > 0 ? history[rIdx - 1][pIdx] : score;
                                  const diff = rIdx > 0 ? score - prevScore : 0;

                                  return (
                                    <td
                                      key={p.id}
                                      style={{
                                        padding: '5px 2px',
                                        borderRight: pIdx < gameState.players.length - 1 ? '1px solid var(--border-color)' : 'none',
                                        verticalAlign: 'middle'
                                      }}
                                    >
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.15 }}>
                                        <span
                                          style={{
                                            fontFamily: 'monospace',
                                            fontWeight: isLastRound ? 800 : 700,
                                            fontSize: '0.78rem',
                                            color: 'var(--text-primary)'
                                          }}
                                        >
                                          {score}
                                        </span>
                                        {rIdx > 0 ? (
                                          diff !== 0 ? (
                                            <span
                                              style={{
                                                fontFamily: 'monospace',
                                                fontSize: '0.62rem',
                                                fontWeight: 600,
                                                marginTop: '1px',
                                                color: diff > 0 ? 'var(--color-success, #2ecc71)' : 'var(--color-danger, #ff4d4d)'
                                              }}
                                            >
                                              {diff > 0 ? `+${diff}` : diff}
                                            </span>
                                          ) : (
                                            <span style={{ fontSize: '0.62rem', marginTop: '1px', opacity: 0.35, color: 'var(--text-secondary)' }}>
                                              -
                                            </span>
                                          )
                                        ) : null}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Stats Table under Line Chart */}
                    {(() => {
                      // 解析单局结算与立直信息辅助函数（严格基于风位与座位索引，免疫重名或更名）
                      const parseRoundEvents = (
                        settlementLog: string,
                        riichiLogs: string[],
                        _pIdx: number,
                        pWind: string,
                        pDiff: number,
                        isTargetDealer: boolean
                      ) => {
                        // 立直判定：优先按本局该玩家风位 (风位) 匹配
                        const targetRiichiIdx = riichiLogs.findIndex(l => {
                          return l.includes(`(${pWind})`) || l.includes(`(${pWind}家)`);
                        });
                        const isDeclaredRiichi = targetRiichiIdx !== -1;
                        const isFirstRiichi = targetRiichiIdx === 0;

                        let isWin = false;
                        let isTsumoWin = false;
                        let winPoints = 0;

                        let isChong = false;
                        let chongLoss = 0;

                        let isTsumoHit = false;
                        let tsumoHitLoss = 0;

                        let isDraw = false;
                        let isDrawTenpai = false;

                        if (settlementLog.includes('[自摸]')) {
                          // 自摸判定：该玩家风位自摸，或 pDiff > 0
                          const isSelfTsumo =
                            settlementLog.includes(`(${pWind}) 自摸`) ||
                            settlementLog.includes(`(${pWind}家) 自摸`) ||
                            (settlementLog.includes(`(${pWind})`) && !settlementLog.includes('荣和')) ||
                            (pDiff > 0);

                          if (isSelfTsumo) {
                            isWin = true;
                            isTsumoWin = true;
                            if (pDiff > 0) {
                              winPoints = pDiff;
                            } else {
                              const mPts = settlementLog.match(/自摸\s+([^\s点]+)\s*点/);
                              if (mPts) {
                                const ptsStr = mPts[1];
                                const plusIdx = ptsStr.indexOf('+');
                                const riichiSupply = plusIdx !== -1 ? (parseInt(ptsStr.substring(plusIdx + 1), 10) || 0) : 0;
                                const basePart = plusIdx !== -1 ? ptsStr.substring(0, plusIdx) : ptsStr;
                                const effectivePart = basePart.includes('·') ? basePart.split('·')[1] : basePart;
                                if (effectivePart.includes('all')) {
                                  const koPay = parseInt(effectivePart.replace('all', ''), 10) || 0;
                                  winPoints = koPay * (isSanma ? 2 : 3) + riichiSupply;
                                } else if (effectivePart.includes('/')) {
                                  const parts = effectivePart.split('/');
                                  const koPay = parseInt(parts[0], 10) || 0;
                                  const oyaPay = parseInt(parts[1], 10) || 0;
                                  winPoints = isSanma ? (koPay + oyaPay + riichiSupply) : (koPay * 2 + oyaPay + riichiSupply);
                                }
                              }
                            }
                            winPoints = Math.max(0, winPoints);
                          } else {
                            // 非自摸获胜者为被自摸者
                            isTsumoHit = true;
                            if (pDiff < 0) {
                              tsumoHitLoss = -pDiff;
                            } else {
                              const mPts = settlementLog.match(/自摸\s+([^\s点]+)\s*点/);
                              if (mPts) {
                                const ptsStr = mPts[1];
                                const plusIdx = ptsStr.indexOf('+');
                                const basePart = plusIdx !== -1 ? ptsStr.substring(0, plusIdx) : ptsStr;
                                const effectivePart = basePart.includes('·') ? basePart.split('·')[1] : basePart;
                                if (effectivePart.includes('all')) {
                                  tsumoHitLoss = parseInt(effectivePart.replace('all', ''), 10) || 0;
                                } else if (effectivePart.includes('/')) {
                                  const parts = effectivePart.split('/');
                                  const koPay = parseInt(parts[0], 10) || 0;
                                  const oyaPay = parseInt(parts[1], 10) || 0;
                                  tsumoHitLoss = isTargetDealer ? oyaPay : koPay;
                                }
                              }
                            }
                            tsumoHitLoss = Math.max(0, tsumoHitLoss);
                          }
                        } else if (settlementLog.includes('[荣和]') || settlementLog.includes('[多家和了]')) {
                          const lines = settlementLog.split('\n');
                          for (const l of lines) {
                            const rMatch = l.match(/\[[^\]]+\]\s*(?:\(([^)]+)\))?\s*荣和\s*\[[^\]]+\]\s*(?:\(([^)]+)\))?\s*([^\s点]+)\s*点/);
                            if (rMatch) {
                              const rWinnerWind = rMatch[1] || '';
                              const rLoserWind = rMatch[2] || '';
                              const ptsStr = rMatch[3];

                              const plusIdx = ptsStr.indexOf('+');
                              const riichiSupply = plusIdx !== -1 ? (parseInt(ptsStr.substring(plusIdx + 1), 10) || 0) : 0;
                              const basePart = plusIdx !== -1 ? ptsStr.substring(0, plusIdx) : ptsStr;
                              const effectivePart = basePart.includes('·') ? basePart.split('·')[1] : basePart;
                              const paidNumber = parseInt(effectivePart, 10) || 0;

                              const ptsGain = paidNumber + riichiSupply;
                              const ptsLoss = paidNumber;

                              const isLineWinner = rWinnerWind === pWind || rWinnerWind.includes(pWind);
                              const isLineLoser = rLoserWind === pWind || rLoserWind.includes(pWind);

                              if (isLineWinner) {
                                isWin = true;
                                winPoints += ptsGain;
                              }
                              if (isLineLoser) {
                                isChong = true;
                                chongLoss += ptsLoss;
                              }
                            }
                          }
                          if (isWin && winPoints === 0 && pDiff > 0) {
                            winPoints = pDiff;
                          }
                          if (isChong && chongLoss === 0 && pDiff < 0) {
                            chongLoss = -pDiff;
                          }
                          winPoints = Math.max(0, winPoints);
                          chongLoss = Math.max(0, chongLoss);
                        } else if (settlementLog.includes('流局满贯')) {
                          isDraw = true;
                          if (pDiff > 0) {
                            isDrawTenpai = true;
                          } else if (isTargetDealer && settlementLog.includes('连庄')) {
                            isDrawTenpai = true;
                          }
                        } else if (settlementLog.includes('[荒牌流局]') || settlementLog.includes('流局')) {
                          isDraw = true;
                          if (pDiff > 0) {
                            isDrawTenpai = true;
                          } else if (settlementLog.includes('全员听牌')) {
                            isDrawTenpai = true;
                          } else if (settlementLog.includes('全员不听') || settlementLog.includes('中途流局')) {
                            isDrawTenpai = false;
                          } else {
                            if (settlementLog.includes(`(${pWind}) 听牌`) || settlementLog.includes(`(${pWind}家) 听牌`)) {
                              isDrawTenpai = true;
                            }
                          }
                        }

                        return {
                          isDeclaredRiichi,
                          isFirstRiichi,
                          isWin,
                          isTsumoWin,
                          winPoints: Math.max(0, winPoints),
                          isChong,
                          chongLoss: Math.max(0, chongLoss),
                          isTsumoHit,
                          tsumoHitLoss: Math.max(0, tsumoHitLoss),
                          isDraw,
                          isDrawTenpai
                        };
                      };

                      // 提取所有对局日志及立直记录
                      const totalRounds = gameState.scoreHistory ? gameState.scoreHistory.length - 1 : 0;
                      const history = gameState.scoreHistory || [];
                      const isSanma = gameState.gameMode === 'sanma' || gameState.players.length === 3;
                      const numSeats = isSanma ? 3 : 4;
                      const windNames = ['东', '南', '西', '北'];

                      const roundLogs: { settlementLog: string; riichiLogs: string[] }[] = [];
                      let currentRiichis: string[] = [];

                      for (let i = 0; i < gameState.log.length; i++) {
                        const line = gameState.log[i];
                        if (line.includes('[立直]') || line.includes('宣告立直')) {
                          currentRiichis.push(line);
                        } else if (line.includes('自摸') || line.includes('荣和') || line.includes('多家和了') || line.includes('放铳') || line.includes('流局') || line.includes('诈和')) {
                          roundLogs.push({
                            settlementLog: line,
                            riichiLogs: currentRiichis
                          });
                          currentRiichis = [];
                        }
                      }

                      // 为每个玩家统计全部轮次的基础指标（基于选手 ID 与席位索引，避免选手名重名或改名干扰）
                      const playerStatsMap: Record<number, {
                        riichiCount: number;
                        firstRiichiCount: number;
                        riichiWinCount: number;
                        riichiTotalEarnings: number;
                        winCount: number;
                        tsumoWins: number;
                        totalWinPoints: number;
                        maxWin: number;
                        chongCount: number;
                        totalChongLoss: number;
                        maxChongLoss: number;
                        tsumoHitCount: number;
                        totalTsumoHitLoss: number;
                        drawCount: number;
                        drawTenpaiCount: number;
                      }> = {};

                      gameState.players.forEach(p => {
                        playerStatsMap[p.id] = {
                          riichiCount: 0,
                          firstRiichiCount: 0,
                          riichiWinCount: 0,
                          riichiTotalEarnings: 0,
                          winCount: 0,
                          tsumoWins: 0,
                          totalWinPoints: 0,
                          maxWin: 0,
                          chongCount: 0,
                          totalChongLoss: 0,
                          maxChongLoss: 0,
                          tsumoHitCount: 0,
                          totalTsumoHitLoss: 0,
                          drawCount: 0,
                          drawTenpaiCount: 0
                        };
                      });

                      for (let r = 1; r < history.length; r++) {
                        const rData = roundLogs[r - 1] || { settlementLog: '', riichiLogs: [] };
                        const settlementLog = rData.settlementLog;
                        const riichiLogs = rData.riichiLogs;

                        // 从本局标准日志 [东1局|0本场] 解析当前小局的场风与局数，精准推算本局庄家与各玩家风位
                        const roundMatch = settlementLog.match(/\[([东南西北])(\d+)局/);
                        let roundDealerIdx = (r - 1) % numSeats;
                        if (roundMatch) {
                          const roundNumber = parseInt(roundMatch[2], 10);
                          if (!isNaN(roundNumber) && roundNumber >= 1) {
                            roundDealerIdx = (roundNumber - 1) % numSeats;
                          }
                        }

                        gameState.players.forEach((p, pIdx) => {
                          const pDiff = history[r] && history[r - 1] ? (history[r][pIdx] - history[r - 1][pIdx]) : 0;
                          const pRoundWind = windNames[(pIdx - roundDealerIdx + numSeats) % numSeats];
                          const isDealer = (pIdx === roundDealerIdx) || settlementLog.includes(`(${pRoundWind}家)`);
                          const ev = parseRoundEvents(settlementLog, riichiLogs, pIdx, pRoundWind, pDiff, isDealer);
                          const st = playerStatsMap[p.id];

                          if (ev.isDeclaredRiichi) {
                            st.riichiCount++;
                            st.riichiTotalEarnings += pDiff;
                            if (ev.isFirstRiichi) st.firstRiichiCount++;
                            if (ev.isWin) st.riichiWinCount++;
                          }

                          if (ev.isWin) {
                            st.winCount++;
                            st.totalWinPoints += Math.max(0, ev.winPoints);
                            if (ev.winPoints > st.maxWin) st.maxWin = ev.winPoints;
                            if (ev.isTsumoWin) st.tsumoWins++;
                          }

                          if (ev.isChong) {
                            st.chongCount++;
                            st.totalChongLoss += Math.max(0, ev.chongLoss);
                            if (ev.chongLoss > st.maxChongLoss) st.maxChongLoss = ev.chongLoss;
                          }

                          if (ev.isTsumoHit) {
                            st.tsumoHitCount++;
                            st.totalTsumoHitLoss += Math.max(0, ev.tsumoHitLoss);
                          }

                          if (ev.isDraw) {
                            st.drawCount++;
                            if (ev.isDrawTenpai) st.drawTenpaiCount++;
                          }
                        });
                      }

                      const targetPlayer = gameState.players.find(p => p.id === activeStatsPlayerId) || gameState.players[0];
                      const activeSt = playerStatsMap[targetPlayer.id] || {
                        riichiCount: 0,
                        firstRiichiCount: 0,
                        riichiWinCount: 0,
                        riichiTotalEarnings: 0,
                        winCount: 0,
                        tsumoWins: 0,
                        totalWinPoints: 0,
                        maxWin: 0,
                        chongCount: 0,
                        totalChongLoss: 0,
                        maxChongLoss: 0,
                        tsumoHitCount: 0,
                        totalTsumoHitLoss: 0,
                        drawCount: 0,
                        drawTenpaiCount: 0
                      };

                      // Offense Metrics
                      const winRate = totalRounds > 0 ? ((activeSt.winCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                      const tsumoWinRatio = activeSt.winCount > 0 ? ((activeSt.tsumoWins / activeSt.winCount) * 100).toFixed(1) + '%' : '0.0%';
                      const avgWinPoints = activeSt.winCount > 0 ? Math.max(0, Math.round(activeSt.totalWinPoints / activeSt.winCount)) + ' 点' : '0 点';

                      // Defense Metrics
                      const chongRate = totalRounds > 0 ? ((activeSt.chongCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                      const totalLossEvents = activeSt.chongCount + activeSt.tsumoHitCount;
                      const totalLossPoints = activeSt.totalChongLoss + activeSt.totalTsumoHitLoss;
                      const avgExpenditure = totalLossEvents > 0 ? Math.max(0, Math.round(totalLossPoints / totalLossEvents)) + ' 点' : '0 点';
                      const avgChongPoints = activeSt.chongCount > 0 ? Math.max(0, Math.round(activeSt.totalChongLoss / activeSt.chongCount)) + ' 点' : '0 点';

                      // Part 3 Metrics
                      const riichiRate = totalRounds > 0 ? ((activeSt.riichiCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                      const riichiWinRate = activeSt.riichiCount > 0 ? ((activeSt.riichiWinCount / activeSt.riichiCount) * 100).toFixed(1) + '%' : '0.0%';
                      const firstRiichiRate = activeSt.riichiCount > 0 ? ((activeSt.firstRiichiCount / activeSt.riichiCount) * 100).toFixed(1) + '%' : '0.0%';
                      const formattedRiichiEarnings = activeSt.riichiTotalEarnings > 0 ? `+${activeSt.riichiTotalEarnings} 点` : `${activeSt.riichiTotalEarnings} 点`;
                      const globalDrawRate = totalRounds > 0 ? ((activeSt.drawCount / totalRounds) * 100).toFixed(1) + '%' : '0.0%';
                      const drawTenpaiRate = activeSt.drawCount > 0 ? ((activeSt.drawTenpaiCount / activeSt.drawCount) * 100).toFixed(1) + '%' : '0.0%';

                      return (
                        <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '8px 4px', fontWeight: 600, textAlign: 'left', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>选手</th>
                                <th style={{ padding: '8px 4px', fontWeight: 600, borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>立直</th>
                                <th style={{ padding: '8px 4px', fontWeight: 600, borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>和了</th>
                                <th style={{ padding: '8px 4px', fontWeight: 600, verticalAlign: 'middle' }}>放铳</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gameState.players.map((p, pIdx) => {
                                const st = playerStatsMap[p.id] || { riichiCount: 0, winCount: 0, chongCount: 0 };
                                const seatWind = windNames[pIdx];
                                return (
                                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'left', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '4px' }}>{seatWind}家</span>
                                      {p.name}
                                      {mySeatId !== null && p.id === mySeatId && (
                                        theme === 'majsoul' ? (
                                          <span className="majsoul-jika-badge" title="自家" style={{ marginLeft: '6px' }}>
                                            <span className="majsoul-jika-badge-inner">自家</span>
                                          </span>
                                        ) : (
                                          <span className="jika-badge" title="自家" style={{ marginLeft: '6px' }}>自家</span>
                                        )
                                      )}
                                    </td>
                                    <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>{st.riichiCount} 回</td>
                                    <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)', verticalAlign: 'middle' }}>{st.winCount} 回</td>
                                    <td style={{ padding: '8px 4px', fontWeight: 700, color: 'var(--text-primary)', verticalAlign: 'middle' }}>{st.chongCount} 回</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {/* Options tab for individual player detail stats */}
                          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                              {gameState.players.map((p, pIdx) => {
                                const seatWind = windNames[pIdx];
                                return (
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
                                    {seatWind}家 · {p.name}
                                  </button>
                                );
                              })}
                            </div>

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
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>自摸率</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{tsumoWinRatio}</div>
                                  </div>
                                  <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>平均打点</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{avgWinPoints}</div>
                                  </div>
                                  <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>最大打点</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{activeSt.maxWin} 点</div>
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
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>平均支出点数</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{avgExpenditure}</div>
                                  </div>
                                  <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>平均铳点</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{avgChongPoints}</div>
                                  </div>
                                  <div style={{ backgroundColor: 'rgba(255,255,255,0.01)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '3px' }}>最大铳失点</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{activeSt.maxChongLoss} 点</div>
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
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          )}

          

          

        </>
      ) : (
        <>
          {/* HUD Info Panel */}
          {theme === 'rexx' ? (
            (() => {
              const currentRoundRiichiCount = gameState.players.filter(p => p.riichi).length;
              const rexxTableRiichiSticks = Math.max(0, riichiSticks - currentRoundRiichiCount);
              return (
                <section className="hud-panel rexx-hud-panel">
                  {/* 格子 1: 局况文本 (与其他主题保持一致) */}
                  <div className="rexx-hud-col rexx-hud-col-1" onClick={openHudModal} style={{ cursor: 'pointer' }} title="点击修改局况/本场数">
                    <div className="hud-item">
                      <span className="hud-label">局况</span>
                      <span className="hud-value dealer-round">
                        {windText}{round}局
                      </span>
                    </div>
                  </div>

                  {/* 格子 2: 本场 5-LED 拟物组件 */}
                  <div className="rexx-hud-col rexx-hud-col-2" onClick={openHudModal} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="点击修改局况/本场数">
                    <HonbaLedBar honba={honba} />
                  </div>

                  {/* 格子 3: 宝蓝银点立直棒 (对局中仅显示前局积存棒，流局后本局立直棒移入上方) */}
                  <div className="rexx-hud-col rexx-hud-col-3">
                    <RiichiStickDisplay count={rexxTableRiichiSticks} />
                  </div>

                  {/* 格子 4: 荒牌流局按钮 (与其他主题保持一致) */}
                  <div className="rexx-hud-col rexx-hud-col-4">
                    <button
                      type="button"
                      className="btn btn-primary btn-draw"
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
              );
            })()
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
                  (() => {
                    const isTwoDigits = riichiSticks >= 10 || honba >= 10;
                    return (
                      /* 雀魂专属实机胶囊：两个供托区单数字锁定间距，两位数时自适应间距 */
                      <div className="majsoul-sticks-container" style={{ display: 'flex', alignItems: 'center', gap: isTwoDigits ? '8px' : '12px' }}>
                        {/* 1. 立直棒胶囊 (千点棒在前，竖棒高度 40px) */}
                        <div
                          className="majsoul-stick-capsule"
                          title="立直棒"
                          style={{
                            width: riichiSticks >= 10 ? 'auto' : '44px',
                            minWidth: riichiSticks >= 10 ? '50px' : '44px',
                            justifyContent: 'flex-start'
                          }}
                        >
                          <svg width="9" height="40" viewBox="0 0 9 40" style={{ display: 'block', flexShrink: 0, height: '40px' }}>
                            <rect x="0.5" y="0.5" width="8" height="39" rx="4" fill="#ffffff" stroke="#c4c8d0" strokeWidth="0.9" />
                            <circle cx="4.5" cy="20" r="2.2" fill="#be353d" />
                          </svg>
                          <span className="stick-text">
                            <span className="stick-x">x</span>
                            <span
                              className="stick-num"
                              style={{
                                display: 'inline-block',
                                minWidth: riichiSticks >= 10 ? 'auto' : '14px',
                                fontVariantNumeric: 'tabular-nums',
                                textAlign: 'left'
                              }}
                            >
                              {riichiSticks}
                            </span>
                          </span>
                        </div>

                        {/* 2. 本场棒胶囊 (百点棒在后，竖棒高度 40px) */}
                        <div
                          className="majsoul-stick-capsule"
                          title="本场棒"
                          style={{
                            width: honba >= 10 ? 'auto' : '44px',
                            minWidth: honba >= 10 ? '50px' : '44px',
                            justifyContent: 'flex-start'
                          }}
                        >
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
                            <span
                              className="stick-num"
                              style={{
                                display: 'inline-block',
                                minWidth: honba >= 10 ? 'auto' : '14px',
                                fontVariantNumeric: 'tabular-nums',
                                textAlign: 'left'
                              }}
                            >
                              {honba}
                            </span>
                          </span>
                        </div>
                      </div>
                    );
                  })()
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
                  className="btn btn-primary btn-draw"
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
                  const dobonEnabled = gameState.settings?.dobonEnabled ?? true;
                  if (dobonEnabled && targetPlayer.score < 1000) {
                    showAlert('点数不足 1000 点，无法立直', '立直提示');
                    return;
                  }
                  const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
                  const p = nextState.players[pIdx];
                  p.score -= 1000;
                  p.riichi = true;
                  nextState.riichiSticks += 1;
                  const winds = ['东', '南', '西', '北'];
                  const playerCount = gameState.players.length;
                  const pWind = winds[(pIdx - gameState.dealerIndex + playerCount) % playerCount];
                  const windChar = gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西');
                  const roundPrefix = `[${windChar}${gameState.round}局|${gameState.honba}本场]`;
                  handleUpdateState(nextState, `${roundPrefix}[立直][${p.name}] (${pWind}) 立直，支付 1000 点供托`);
                } else {
                  // 撤销立直：通知服务端原子弹出立直快照，完全不留日志与虚假重做历史
                  socket.emit('cancel-riichi', { playerId: pIdx });
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
        historyCount={historyCount}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onReset={handleReset}
        onRollback={handleRollback}
      />

      {/* Footer Status Bar */}
      <AppFooter
        theme={theme}
        onThemeChange={setTheme}
        onOpenSettings={openSettingsModal}
        onOpenShare={isServer ? undefined : () => setIsShareModalOpen(true)}
        leftAction={mySeatId !== null ? (!isServer ? {
          label: "切换席位",
          onClick: handleReleaseSeat,
          title: "切换席位"
        } : (!isHost ? {
          label: "退出房间",
          onClick: handleExitRoom,
          title: "退出房间并返回对局大厅"
        } : null)) : null}
        dangerAction={isServer && isHost ? {
          label: '解散房间',
          onClick: handleDisbandRoom,
          title: '房主解散当前房间'
        } : null}
      />
        </>
      )}



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
        <div className="dialog-overlay" onClick={() => setIsShareModalOpen(false)}>
          <div className="dialog-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px', textAlign: 'center' }}>
            <div
              className="dialog-header"
              style={{
                display: 'grid',
                gridTemplateColumns: '28px 1fr 28px',
                alignItems: 'center',
                padding: '0 16px',
                margin: '-18px -18px 0 -18px',
                borderBottom: '1px solid var(--border-color)',
                boxSizing: 'border-box'
              }}
            >
              <div style={{ width: '28px', height: '28px' }} aria-hidden="true" />
              <h3 className="dialog-title" style={{ margin: 0, textAlign: 'center', height: '30px', lineHeight: '30px', fontSize: '1.05rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>加入对局</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsShareModalOpen(false)}
                style={{
                  width: '28px',
                  height: '28px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  margin: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  justifySelf: 'end'
                }}
                aria-label="关闭"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 2px 0' }}>
              <div style={{ width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '11px' }}>
                
                {/* 1. Wi-Fi / Hotspot Status Box */}
                {!isServer && (
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: '46px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* 固定位置图标容器：与卡片左边界与右侧文字各留 10px 等宽空隙 */}
                  <div
                    style={{
                      width: '18px',
                      height: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: '10px',
                      flexShrink: 0
                    }}
                  >
                    {isWifi ? (
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="2.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                        <line x1="12" y1="20" x2="12.01" y2="20" />
                      </svg>
                    ) : (
                      /* 两个环相扣的热点图标 */
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="2.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    )}
                  </div>

                  {/* 文字区域：严格左对齐且有充足宽度无溢出 */}
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      textAlign: 'left',
                      lineHeight: 1.42,
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)'
                    }}
                  >
                    {isWifi ? (
                      <div>请将需要加入对局的设备连接到同一Wi-Fi</div>
                    ) : (
                      <>
                        <div>当前未连接Wi-Fi，若使用热点模式，</div>
                        <div>请将需要加入对局的设备连接到本机热点</div>
                      </>
                    )}
                  </div>
                </div>
                )}

                {/* 2. QR Code Section with Prompt */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', textAlign: 'left', paddingLeft: '2px', fontWeight: 600 }}>
                    扫描二维码加入：
                  </span>
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#ffffff',
                      borderRadius: '12px',
                      padding: '16px 0',
                      border: '1px solid var(--border-color)',
                      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.05)',
                      boxSizing: 'border-box'
                    }}
                  >
                    <QRCodeSVG value={getShareUrl()} size={200} level="M" includeMargin={false} />
                  </div>
                </div>

                {/* 3. Manual Address Section with Prompt */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', textAlign: 'left', paddingLeft: '2px', fontWeight: 600 }}>
                    或手动输入网址：
                  </span>
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: 'var(--bg-secondary)',
                      border: copiedUrl ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '5px 6px 5px 12px',
                      gap: '8px',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.2s ease'
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        color: 'var(--color-accent)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        userSelect: 'all'
                      }}
                    >
                      {getShareUrl().replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleCopyUrl}
                      style={{
                        padding: '3px 12px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        minWidth: '52px',
                        height: '28px',
                        borderRadius: '6px',
                        flexShrink: 0
                      }}
                    >
                      {copiedUrl ? '已复制' : '复制'}
                    </button>
                  </div>
                </div>

                {/* 4. Close Button */}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsShareModalOpen(false)}
                  style={{ width: '100%', padding: '9px 0', fontSize: '0.86rem', fontWeight: 600, borderRadius: '8px', marginTop: '2px' }}
                >
                  关闭
                </button>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. HUD / Round Settings Edit Modal */}
      {isHudModalOpen && (() => {
        const isSanma = gameState.gameMode === 'sanma' || gameState.players.length === 3;
        const isTonpuu = (gameState.settings?.gameLength ?? 'hanchan') === 'tonpuu';
        const availableRounds = isSanma ? [1, 2, 3] : [1, 2, 3, 4];

        return (
          <div className="dialog-overlay" onClick={() => setIsHudModalOpen(false)}>
            <div className="dialog-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px', maxHeight: '90vh', overflowY: 'auto' }}>
              <div className="dialog-header">
                <h3 className="dialog-title">修改局况信息</h3>
                <button type="button" className="modal-close" onClick={() => setIsHudModalOpen(false)}>&times;</button>
              </div>
              <form onSubmit={handleHudConfirm}>
                <div className="dialog-body">
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>场风</label>
                    <div className="player-selector-grid" style={{ gridTemplateColumns: `repeat(${isTonpuu ? 2 : 3}, 1fr)` }}>
                      <button
                        type="button"
                        className={`player-select-btn ${tempWind === 'east' ? 'selected' : ''}`}
                        onClick={() => setTempWind('east')}
                      >
                        东风场
                      </button>
                      <button
                        type="button"
                        className={`player-select-btn ${tempWind === 'south' ? 'selected' : ''}`}
                        onClick={() => setTempWind('south')}
                      >
                        南风场
                      </button>
                      {!isTonpuu && (
                        <button
                          type="button"
                          className={`player-select-btn ${tempWind === 'west' ? 'selected' : ''}`}
                          onClick={() => setTempWind('west')}
                        >
                          西风场
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>局数</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        庄家: {gameState.players[(tempRound - 1) % (gameState.players.length || 4)]?.name || `选手 ${((tempRound - 1) % (gameState.players.length || 4)) + 1}`}
                      </span>
                    </label>
                    <div className="preset-grid" style={{ gridTemplateColumns: `repeat(${availableRounds.length}, 1fr)` }}>
                      {availableRounds.map((r) => (
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
                    <label className="form-label" style={{ fontWeight: 600 }}>本场数</label>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      className="form-input"
                      value={tempHonba}
                      onChange={(e) => setTempHonba(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    />
                  </div>
                </div>

                <div className="dialog-footer">
                  <button type="button" className="btn btn-secondary dialog-btn" onClick={() => setIsHudModalOpen(false)}>取消</button>
                  <button type="submit" className="btn btn-primary dialog-btn">应用修改</button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content settings-modal-box">
            <div
              className="modal-header app-header"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                width: 'calc(100% - 24px)',
                margin: '0 12px',
                height: '60px',
                minHeight: '60px',
                maxHeight: '60px',
                padding: '12px 12px 0 12px',
                boxSizing: 'border-box',
                borderBottom: '1px solid var(--border-color)'
              }}
            >
              <div style={{ gridColumn: 1, justifySelf: 'start', display: 'flex', alignItems: 'center', height: '30px' }} aria-hidden="true" />
              <h1
                className="app-title"
                style={{
                  gridColumn: 2,
                  justifySelf: 'center',
                  margin: 0,
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  height: '30px',
                  lineHeight: '30px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                对局设置
              </h1>
              <div style={{ gridColumn: 3, justifySelf: 'end', display: 'flex', alignItems: 'center', height: '30px' }}>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setIsSettingsModalOpen(false)}
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    margin: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)'
                  }}
                  aria-label="关闭"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '14px 12px' }}>
              
              <div className="form-group" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", width: "100%", margin: "0 auto" }}>
                <label className="form-label" style={{ fontWeight: "bold", justifyContent: "center", textAlign: "center", width: "100%", display: "flex", margin: "0 auto 6px auto" }}>对局模式</label>
                <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', width: '100%' }}>
                  <button
                    type="button"
                    className={`btn ${tempGameMode === 'yonma' ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setTempGameMode('yonma');
                      setTempStartingPoints(25000);
                      setTempStartingPointsStr('25000');
                      setTempOkaPoints(30000);
                      setTempOkaPointsStr('30000');
                    }}
                    style={{ height: '38px', minHeight: '38px', padding: '0', fontSize: '0.85rem', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    四人麻将
                  </button>
                  <button
                    type="button"
                    className={`btn ${tempGameMode === 'sanma' ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setTempGameMode('sanma');
                      setTempStartingPoints(35000);
                      setTempStartingPointsStr('35000');
                      setTempOkaPoints(40000);
                      setTempOkaPointsStr('40000');
                    }}
                    style={{ height: '38px', minHeight: '38px', padding: '0', fontSize: '0.85rem', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    三人麻将
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", width: "100%", margin: "0 auto" }}>
                <label className="form-label" style={{ fontWeight: "bold", justifyContent: "center", textAlign: "center", width: "100%", display: "flex", margin: "0 auto 6px auto" }}>局数</label>
                <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', width: '100%' }}>
                  <button
                    type="button"
                    className={`btn ${tempGameLength === 'hanchan' ? 'btn-primary' : ''}`}
                    onClick={() => setTempGameLength('hanchan')}
                    style={{ height: '38px', minHeight: '38px', padding: '0', fontSize: '0.85rem', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    半庄
                  </button>
                  <button
                    type="button"
                    className={`btn ${tempGameLength === 'tonpuu' ? 'btn-primary' : ''}`}
                    onClick={() => setTempGameLength('tonpuu')}
                    style={{ height: '38px', minHeight: '38px', padding: '0', fontSize: '0.85rem', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    东风
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ width: '100%', alignItems: 'stretch', textAlign: 'left', margin: '0 auto' }}>
                <label className="form-label" style={{ fontWeight: "bold", textAlign: "left", display: "block", width: "100%", margin: "0 0 6px 0" }}>高级设置</label>
                
                {/* 高级设置统一网格容器：纵向严格等距 (gap: 14px 8px) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 8px', width: '100%' }}>
                  {/* (1, 1) 开启多家和了 */}
                  <label className={`checkbox-label ${tempMultiRonEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempMultiRonEnabled}
                      onChange={(e) => setTempMultiRonEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1, whiteSpace: 'nowrap' }}>开启多家和了</span>
                  </label>

                  {/* (1, 2) 开启切上满贯 */}
                  <label className={`checkbox-label ${tempKiriageManganEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempKiriageManganEnabled}
                      onChange={(e) => setTempKiriageManganEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1, whiteSpace: 'nowrap' }}>开启切上满贯</span>
                  </label>

                  {/* (2, 1) 开启和了即止 */}
                  <label className={`checkbox-label ${tempAgariYameEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempAgariYameEnabled}
                      onChange={(e) => setTempAgariYameEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1, whiteSpace: 'nowrap' }}>开启和了即止</span>
                  </label>

                  {/* (2, 2) 开启击飞 */}
                  <label className={`checkbox-label ${tempDobonEnabled ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={tempDobonEnabled}
                      onChange={(e) => setTempDobonEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1, whiteSpace: 'nowrap' }}>开启击飞</span>
                  </label>

                  {/* 第5项 开启西入/南入 (全宽) */}
                  <label className={`checkbox-label ${tempWestRoundEnabled ? 'checked' : ''}`} style={{ gridColumn: '1 / -1', width: '100%' }}>
                    <input
                      type="checkbox"
                      checked={tempWestRoundEnabled}
                      onChange={(e) => setTempWestRoundEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', flexGrow: 1 }}>
                      {tempGameLength === 'tonpuu' ? '开启南入' : '开启西入'}
                    </span>
                  </label>
                </div>
              </div>

              {/* 1位必要点数设定 (仅开启西入/南入时显示，无动态动画效果) */}
              {tempWestRoundEnabled && (
                <div className="form-group" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", width: "100%", margin: "0 auto" }}>
                  <label className="form-label" style={{ fontWeight: "bold", justifyContent: "center", textAlign: "center", width: "100%", display: "flex", margin: "0 auto 6px auto" }}>1位必要点数</label>
                  {(() => {
                    const minOka = tempStartingPoints > 0 ? tempStartingPoints : (tempGameMode === 'sanma' ? 35000 : 25000);
                    const presets = tempGameMode === 'sanma' ? [35000, 40000, 45000] : [25000, 30000, 35000];

                    const isEmpty = tempOkaPointsStr.trim() === '';
                    const parsedVal = parseInt(tempOkaPointsStr, 10);
                    const isInvalid = !isEmpty && (isNaN(parsedVal) || parsedVal < minOka || parsedVal % 100 !== 0);

                    return (
                      <>
                        <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', width: '100%' }}>
                          {presets.map((points) => (
                            <button
                              key={points}
                              type="button"
                              className={`btn ${tempOkaPoints === points ? 'btn-primary' : ''}`}
                              onClick={() => {
                                setTempOkaPoints(points);
                                setTempOkaPointsStr(points.toString());
                              }}
                              style={{ height: '38px', minHeight: '38px', padding: '0', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              {points}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop: '8px', width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', width: '100%', alignItems: 'center' }}>
                            <label className="form-label custom-input-label" style={{ gridColumn: '1', margin: 0, fontSize: '0.8rem', fontWeight: 700, height: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                              自定义1位必要点数
                            </label>
                            <input
                              type="number"
                              step="100"
                              min={minOka}
                              className={`form-input ${isInvalid ? 'form-input-invalid' : ''}`}
                              style={{
                                gridColumn: '2 / span 2',
                                height: '38px',
                                minHeight: '38px',
                                textAlign: 'center',
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '0 8px',
                                fontSize: '0.85rem'
                              }}
                              placeholder={`如 ${minOka + 5000}`}
                              value={tempOkaPointsStr}
                              onChange={(e) => {
                                const valStr = e.target.value;
                                setTempOkaPointsStr(valStr);
                                const val = parseInt(valStr, 10);
                                if (!isNaN(val)) {
                                  setTempOkaPoints(val);
                                } else {
                                  setTempOkaPoints(0);
                                }
                              }}
                            />
                          </div>
                          {isInvalid && (
                            <div className="validation-warning-text">
                              输入的最小单位为100且最小值为{minOka}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* 起始点数设定 */}
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
                        setTempOkaPointsStr((points + 5000).toString());
                      }}
                      style={{ height: '38px', minHeight: '38px', padding: '0', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {points}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '8px', width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', width: '100%', alignItems: 'center' }}>
                    <label className="form-label custom-input-label" style={{ gridColumn: '1', margin: 0, fontSize: '0.8rem', fontWeight: 700, height: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                      自定义起始点数
                    </label>
                    {(() => {
                      const isEmpty = tempStartingPointsStr.trim() === '';
                      const parsedVal = parseInt(tempStartingPointsStr, 10);
                      const isInvalid = !isEmpty && (isNaN(parsedVal) || parsedVal <= 0 || parsedVal % 100 !== 0);

                      return (
                        <input
                          type="number"
                          step="100"
                          min="100"
                          className={`form-input ${isInvalid ? 'form-input-invalid' : ''}`}
                          style={{
                            gridColumn: '2 / span 2',
                            height: '38px',
                            minHeight: '38px',
                            textAlign: 'center',
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '0 8px',
                            fontSize: '0.85rem'
                          }}
                          placeholder="如 25000"
                          value={tempStartingPointsStr}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            setTempStartingPointsStr(valStr);
                            const val = parseInt(valStr, 10);
                            if (!isNaN(val)) {
                              setTempStartingPoints(val);
                            } else {
                              setTempStartingPoints(0);
                            }
                          }}
                        />
                      );
                    })()}
                  </div>
                  {(() => {
                    const isEmpty = tempStartingPointsStr.trim() === '';
                    const parsedVal = parseInt(tempStartingPointsStr, 10);
                    const isInvalid = !isEmpty && (isNaN(parsedVal) || parsedVal <= 0 || parsedVal % 100 !== 0);

                    return isInvalid ? (
                      <div className="validation-warning-text">
                        输入的最小单位为100且最小值为100
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Host-Only Dedicated Permission Control Bottom Tab */}
              
            </div>
            <div className="modal-footer" style={{ padding: '14px 12px 28px', display: 'flex', gap: '12px' }}>
              <button type="button" className="btn btn-secondary dialog-btn" onClick={() => setIsSettingsModalOpen(false)} style={{ flex: 1 }}>取消</button>
              <button type="button" className="btn btn-primary dialog-btn" onClick={handleSaveSettings} style={{ flex: 1 }}>保存配置</button>
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
        height: 'var(--app-height, 100vh)',
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
        <span style={{ fontFamily: 'Long Cang, cursive' }}>东南西北局本场地和自摸立直得分玩家选手一二三四五六七八九十点庄闲0123456789</span>
        <span style={{ fontFamily: 'Ma Shan Zheng, cursive' }}>东南西北局本场地和自摸立直得分玩家选手一二三四五六七八九十点庄闲0123456789</span>
        <span style={{ fontFamily: 'Klee One, sans-serif' }}>东南西北局本场地和自摸立直得分玩家选手一二三四五六七八九十点庄闲0123456789</span>
        <span style={{ fontFamily: 'Michroma, sans-serif' }}>0123456789 1ST 2ND 3RD 4TH</span>
      </div>

      {/* Global In-App Confirm/Alert Modal */}
      {confirmDialog && (
        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          isDanger={confirmDialog.isDanger}
          showCancel={confirmDialog.showCancel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

export default App;
