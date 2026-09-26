


// CLI Arguments Parsing & Environment Normalization
const cliArgs = process.argv.slice(2);
for (const arg of cliArgs) {
  if (arg.startsWith('--target=')) {
    process.env.TARGET_ENV = arg.split('=')[1];
  } else if (arg === '--target-lan' || arg === '--lan') {
    process.env.TARGET_ENV = 'lan';
  } else if (arg === '--target-server' || arg === '--server') {
    process.env.TARGET_ENV = 'server';
  } else if (arg === '--no-modules' || arg === '--modules=false' || arg === '--disable-modules') {
    process.env.ENABLE_MODULES = 'false';
  } else if (arg === '--no-security' || arg === '--security=false') {
    process.env.ENABLE_SECURITY_GUARD = 'false';
  } else if (arg === '--no-server-extension' || arg === '--server-extension=false') {
    process.env.ENABLE_SERVER_MODULE = 'false';
  } else if (arg === '--multi-room' || arg === '--multi-room=true') {
    process.env.ENABLE_MULTI_ROOM = 'true';
  } else if (arg === '--multi-room=false' || arg === '--no-multi-room') {
    process.env.ENABLE_MULTI_ROOM = 'false';
  }
}

// Default TARGET_ENV to 'lan' if unspecified
if (!process.env.TARGET_ENV) {
  process.env.TARGET_ENV = 'lan';
}

function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function detectNetworkStatus() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let firstValidIp = '';
  let standard192Ip = '';
  let hotspotIp = '';
  let cellularPrivateIp = '';
  let fallbackIp = '';

  for (const devName in interfaces) {
    const lowerDev = devName.toLowerCase();
    // 过滤虚拟网卡、容器网桥、虚拟机和VPN隧道接口
    if (
      lowerDev.includes('docker') || 
      lowerDev.includes('vethernet') || 
      lowerDev.includes('vbox') || 
      lowerDev.includes('wsl') || 
      lowerDev.includes('dummy') ||
      lowerDev.includes('vmnet') ||
      lowerDev.includes('vmware') ||
      lowerDev.includes('tun') ||
      lowerDev.includes('tap') ||
      lowerDev.includes('singbox') ||
      lowerDev.includes('tailscale') ||
      lowerDev.includes('zerotier')
    ) {
      continue;
    }

    const iface = interfaces[devName];
    if (!iface) continue;

    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        const addr = alias.address;
        // 手机/系统热点网段顶格优先检测:
        // Android 个人热点通常为 192.168.43.x (主机 192.168.43.1)
        // Windows 移动热点通常为 192.168.137.x (主机 192.168.137.1)
        // iOS 个人热点通常为 172.20.10.x (主机 172.20.10.1)
        if (addr.startsWith('192.168.43.') || addr.startsWith('192.168.137.') || addr.startsWith('172.20.10.')) {
          hotspotIp = addr;
          break;
        }

        // 热点虚拟网卡命名 (Android ap0, softap, wlan1, tethering 等)
        if (
          lowerDev.startsWith('ap') || 
          lowerDev.includes('softap') || 
          lowerDev.includes('hotspot') || 
          lowerDev.includes('tether')
        ) {
          hotspotIp = addr;
          break;
        }

        // 移动蜂窝网络标识 (Android rmnet, ccmni, pdp, cellular, wwan 等)
        if (
          lowerDev.includes('rmnet') ||
          lowerDev.includes('ccmni') ||
          lowerDev.includes('pdp') ||
          lowerDev.includes('wwan') ||
          lowerDev.includes('cellular')
        ) {
          // 若手机在移动网络下分配了私网 IP（如 10.x.x.x / 192.168.x.x），开启热点时其他设备可通过此 IP 直连
          if (isPrivateIp(addr)) {
            if (!cellularPrivateIp) cellularPrivateIp = addr;
          } else if (!fallbackIp) {
            fallbackIp = addr;
          }
          continue;
        }

        // 常规局域网 Wi-Fi / 有线连接 (192.168.x.x 或 10.x.x.x / 172.x.x.x)
        if (addr.startsWith('192.168.')) {
          if (!standard192Ip) standard192Ip = addr;
        } else if (isPrivateIp(addr)) {
          if (!firstValidIp) firstValidIp = addr;
        } else if (!fallbackIp) {
          fallbackIp = addr;
        }
      }
    }
    if (hotspotIp) break;
  }

  // 优先级 1: 具有明确热点特征的 IP (192.168.43.x, 192.168.137.x, ap0 等)
  if (hotspotIp) {
    return { ip: hotspotIp, isWifi: false };
  }

  // 优先级 2: 常规 Wi-Fi / 有线私网 IP (192.168.x.x 或 10.x.x.x / 172.x.x.x)
  const wifiIp = standard192Ip || firstValidIp;
  if (wifiIp) {
    return { ip: wifiIp, isWifi: true };
  }

  // 优先级 3: 移动网络设备分配的私网 IP (如 Android rmnet 上的 10.108.165.92)
  // 当开启热点时其他连入设备可直连该 IP 加入对局，判定为非 WiFi 环境
  if (cellularPrivateIp) {
    return { ip: cellularPrivateIp, isWifi: false };
  }

  // 优先级 4: 运营商 CGNAT（100.64.x.x）或公网 IP
  if (fallbackIp) {
    return { ip: fallbackIp, isWifi: false };
  }

  // 优先级 5: 仅本地回环
  return { ip: '127.0.0.1', isWifi: false };
}

function getRealWifiLanIp() {
  return detectNetworkStatus().ip;
}

const PORT = process.env.PORT || 32000;

function getRealWifiLanUrl() {
  return `http://${getRealWifiLanIp()}:${PORT}`;
}

const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const cors = require('cors');
let securityGuard = null;
let serverExtension = null;

const isServerMode = process.env.TARGET_ENV === 'server' && process.env.ENABLE_MODULES !== 'false';
const isSecurityEnabled = isServerMode && process.env.ENABLE_SECURITY_GUARD !== 'false';
const isExtensionEnabled = isServerMode && process.env.ENABLE_SERVER_MODULE !== 'false';

if (isSecurityEnabled) {
  try {
    securityGuard = require('./security-guard');
  } catch (e) {
    console.warn('[WARN] security-guard.js not loaded:', e.message);
  }
}
if (isExtensionEnabled) {
  try {
    serverExtension = require('./server-extension');
  } catch (e) {
    console.warn('[WARN] server-extension.js not loaded:', e.message);
  }
}

// Multi-Room optional capability (server mode only; requires server-extension for room routing)
const isMultiRoom = isServerMode && process.env.ENABLE_MULTI_ROOM === 'true' && Boolean(serverExtension);
if (process.env.ENABLE_MULTI_ROOM === 'true' && !isMultiRoom) {
  console.warn('[WARN] ENABLE_MULTI_ROOM requires server mode with server-extension enabled; multi-room disabled.');
}
let roomStore = null;
if (isMultiRoom) {
  const { createRoomStore } = require('./multi-room');
  roomStore = createRoomStore({
    getInitialState: (settings, gameMode) => getInitialState(settings, gameMode || settings?.gameMode || 'yonma'),
    onDestroy: (room, reason) => {
      io.to(room.roomId).emit('force-clear-seats');
      let msg = '房间空闲超时，已自动解散';
      if (reason === 'game-timeout') {
        msg = '对局时间已达 5 小时上限，房间已自动解散';
      } else if (reason === 'finished-timeout') {
        msg = '对局已结束并超过 5 分钟保留时间，房间已自动解散';
      } else if (reason === 'idle-timeout') {
        msg = '房间未开局且超过 5 分钟保留时间，已自动解散';
      }
      io.to(room.roomId).emit('room-disbanded', { message: msg });
      if (serverExtension && typeof serverExtension.removeRoom === 'function') {
        serverExtension.removeRoom(room.roomId);
      }
    },
    onGameTimeWarning: (room, remainingMinutes) => {
      io.to(room.roomId).emit('game-time-warning', {
        roomId: room.roomId,
        remainingMinutes,
        message: `本局对局已进行 4 小时，剩余保留时间 ${remainingMinutes} 分钟，超时将自动解散房间，请尽快完成对局。`
      });
    }
  });
  roomStore.startSweep();
  if (serverExtension && typeof serverExtension.setRoomStore === 'function') {
    serverExtension.setRoomStore(roomStore);
  }
  console.log(`[MULTI-ROOM] Enabled: maxRooms=${roomStore.opts.maxRooms}, idleDestroy=${roomStore.opts.idleDestroyMinutes}min, finishedDestroy=${roomStore.opts.finishedDestroyMinutes}min, gameDestroy=${roomStore.opts.gameDestroyMinutes}min, gameWarning=${roomStore.opts.gameWarningMinutes}min`);
}

const app = express();
app.use(cors());
app.use(express.json());

// [PROVISION] 云端部署与反向代理支持 (Nginx, Cloudflare, Railway, Render 等)
app.set('trust proxy', 1);

// 1. 完全前置的中间件管道 (网络安全过滤 -> URL子域名/路径房间解析)
if (securityGuard && typeof securityGuard.securityMiddleware === 'function') {
  app.use(securityGuard.securityMiddleware);
}
if (serverExtension && typeof serverExtension.onPreMiddleware === 'function') {
  serverExtension.onPreMiddleware(app);
}

// Disable caching for development and production testing
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// 2. 完全前置的路由管道 (管理面板 /admin -> 服务器特化首页 /)
if (serverExtension && typeof serverExtension.onRoutes === 'function') {
  serverExtension.onRoutes(app);
}

// [PROVISION] 预留健康检查与多房间查询 API (暂未开启多房间模式)
app.get('/api/health', (req, res) => {
  const activeFeatures = [];
  if (securityGuard) activeFeatures.push('security');
  if (serverExtension) activeFeatures.push('server-extension');
  res.json({
    status: 'ok',
    version: 'v3.20',
    timestamp: Date.now(),
    multiRoomEnabled: isMultiRoom,
    ...(isMultiRoom ? { multiRoom: { roomCount: roomStore.count, maxRooms: roomStore.opts.maxRooms } } : {}),
    activeModules: activeFeatures,
    activeFeatures,
    nodeEnv: process.env.NODE_ENV || 'production'
  });
});

app.get('/api/rooms', (req, res) => {
  if (!isMultiRoom) {
    if (process.env.ENABLE_MULTI_ROOM !== 'true') {
      return res.json({ enabled: false, message: 'Multi-room mode is disabled. Running in single-room mode.' });
    }
    return res.json({ enabled: false, message: 'Multi-room unavailable: server-extension is disabled.' });
  }
  res.json({
    enabled: true,
    roomCount: roomStore.count,
    maxRooms: roomStore.opts.maxRooms,
    rooms: roomStore.listRooms().filter(r => /^\d{5}$/.test(r.roomId))
  });
});

app.get('/api/lan-ip', (req, res) => {
  const status = detectNetworkStatus();
  res.json({
    ip: status.ip,
    port: PORT,
    url: `http://${status.ip}:${PORT}`,
    isWifi: status.isWifi
  });
});

// Serve static files from frontend build directory (supports both frontend/dist and dist)
const staticDir = fs.existsSync(path.join(__dirname, 'frontend/dist'))
  ? path.join(__dirname, 'frontend/dist')
  : path.join(__dirname, 'dist');
app.use(express.static(staticDir, { index: false }));

// For SPA routing: strict path gating based on module mounting status
app.get('*', (req, res) => {
  // Never serve HTML for missing static assets
  if (req.path.startsWith('/assets/')) {
    return res.status(404).end();
  }

  const isServer = Boolean(serverExtension);
  if (!isServer) {
    // Pure LAN Mode: ONLY '/' is allowed. Any other path (/home, /admin, /12345, etc.) is permanently redirected to '/'
    if (req.path !== '/') {
      return res.redirect(301, '/');
    }
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, 'utf8');
      const injection = '<script>window.__TARGET_ENV__ = "lan";</script>';
      html = html.replace('<head>', '<head>' + injection);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    return res.sendFile(indexPath);
  }

  // Server Mode: Any unmatched route that reaches fallback redirects to /home
  if (req.path !== '/home') {
    return res.redirect(302, '/home');
  }
  res.sendFile(path.join(staticDir, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 15000,
  connectTimeout: 45000,
  transports: ['websocket', 'polling']
});

// 3. 完全前置的 Socket.io 握手过滤与房间隔离中间件管道
if (securityGuard && typeof securityGuard.socketSecurityMiddleware === 'function') {
  io.use(securityGuard.socketSecurityMiddleware);
}
if (serverExtension && typeof serverExtension.onSocketMiddleware === 'function') {
  serverExtension.onSocketMiddleware(io);
}

// Initial game state
const getInitialState = (settings = null, mode = 'yonma') => {
  const isSanma = mode === 'sanma';
  const defaultStarting = isSanma ? 35000 : 25000;
  const defaultOka = isSanma ? 40000 : 30000;

  const finalSettings = {
    multiRonEnabled: settings?.multiRonEnabled ?? true,
    dobonEnabled: settings?.dobonEnabled ?? true,
    startingPoints: settings?.startingPoints ?? defaultStarting,
    okaPoints: settings?.okaPoints ?? defaultOka,
    westRoundEnabled: settings?.westRoundEnabled ?? true,
    agariYameEnabled: settings?.agariYameEnabled ?? true,
    kiriageManganEnabled: settings?.kiriageManganEnabled ?? true,
    gameLength: settings?.gameLength ?? 'hanchan',
  };
  const initScore = finalSettings.startingPoints;
  const playerCount = isSanma ? 3 : 4;
  
  const players = [];
  const connectedPlayers = [];
  const initScoresRow = [];

  for (let i = 0; i < playerCount; i++) {
    players.push({ id: i, name: `选手 ${i + 1}`, score: initScore, riichi: false, deviceId: `dev_seat_${i}` });
    connectedPlayers.push(false);
    initScoresRow.push(initScore);
  }

  const lengthText = finalSettings.gameLength === 'tonpuu' ? '东风战' : '半庄战';

  return {
    gameMode: isSanma ? 'sanma' : 'yonma',
    players,
    connectedPlayers,
    dealerIndex: 0,
    wind: 'east',
    round: 1,
    honba: 0,
    riichiSticks: 0,
    lanUrl: getRealWifiLanUrl(),
    isOver: false,
    settings: finalSettings,
    log: [`[对局初始化] ${isSanma ? '三人麻将' : '四人麻将'} · ${lengthText}，起始点数 ${initScore} 点`],
    scoreHistory: [initScoresRow],
    roundHistory: ['起点']
  };
};

// ---- Game engine containers ----
// Multi-room OFF (default): a single 'default' container preserves legacy single-room behavior.
// Multi-room ON: roomStore lazily creates one container per 5-digit room (see multi-room.js).
const createContainer = (roomId, settings = null) => ({
  roomId,
  state: getInitialState(settings),
  historyStack: [],
  redoStack: [],
  socketToSeat: new Map(), // Maps socket.id -> playerId (0-3)
  seatTokens: new Map(),   // playerId -> identity token (server-authoritative)
  seatNames: new Map(),    // playerId -> display name (server-authoritative)
  hostDeviceId: null,
  knownTokens: new Set(),
  members: new Map(),      // token -> { seatId|null } (lobby-stage membership)
  locked: false,
  started: false,
  gameStartedAt: null,
  finishedAt: null,
  timeWarningEmitted: false
});
const defaultRoom = createContainer('default');

// Room-scoped broadcast: multi-room targets the room channel, single-room keeps global semantics.
const roomTarget = isMultiRoom
  ? (room) => io.to(room.roomId)
  : (room) => io;
const emitToRoom = (room, event, payload) => roomTarget(room).emit(event, payload);

// Lobby-stage state broadcast (multi-room only; no tokens leaked to clients)
const broadcastLobby = (room) => {
  if (!isMultiRoom || !roomStore || !roomStore.isValidRoomId(room.roomId)) return;
  emitToRoom(room, 'lobby-updated', roomStore.lobbyPayload(room));
};

// Helper to push history state (deep copy, room-scoped)
const pushHistory = (room, state) => {
  room.historyStack.push(JSON.parse(JSON.stringify(state)));
  if (room.historyStack.length > 50) {
    room.historyStack.shift(); // Limit to 50 undos
  }
};

// Helper to extract clean client IPv4 address
function getClientIp(socket) {
  let ip = socket.handshake.headers['x-forwarded-for'] || 
           socket.handshake.address || 
           socket.conn.remoteAddress || 
           '127.0.0.1';
  if (typeof ip === 'string') {
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    else if (ip === '::1') ip = '127.0.0.1';
  }
  return ip;
}

io.on('connection', (socket) => {
  const clientIp = getClientIp(socket);
  socket.clientIp = clientIp;
  console.log(`[INFO] Client connected ${clientIp}`);

  // Default socket.io room membership (idempotent; also covers LAN mode where extension is absent)
  socket.join(socket.targetRoomId || 'default');

  // Apply socket connection hooks (room routing, etc.)
  if (serverExtension && typeof serverExtension.onSocketConnection === 'function') {
    serverExtension.onSocketConnection(io, socket);
  }

  // Resolve the room container for this socket.
  // Multi-room ON: payload roomId wins (authoritative rebind), else handshake-resolved targetRoomId.
  // Multi-room OFF: always the single default container (legacy behavior).
  const getSocketRoom = (payloadRoomId) => {
    if (!isMultiRoom) return defaultRoom;
    if (payloadRoomId && roomStore.isValidRoomId(payloadRoomId) && payloadRoomId !== socket.targetRoomId) {
      switchRoom(socket, payloadRoomId);
    }
    return roomStore.resolve(socket.targetRoomId || 'default') || defaultRoom;
  };

  // Switch room: release this socket's seat in the old container, then rebind membership.
  const switchRoom = (sock, newRoomId) => {
    const oldRoom = roomStore.get(sock.targetRoomId || 'default');
    if (oldRoom && oldRoom.socketToSeat.has(sock.id)) {
      releaseSeatInRoom(oldRoom, oldRoom.socketToSeat.get(sock.id));
      roomStore.setMemberSeat(oldRoom, sock.deviceToken || '', null);
      emitToRoom(oldRoom, 'state-updated', oldRoom.state);
      broadcastLobby(oldRoom);
    }
    sock.leave(oldRoom ? oldRoom.roomId : (sock.targetRoomId || 'default'));
    sock.targetRoomId = newRoomId;
    sock.join(newRoomId);
  };

  // Release a seat inside a container (shared by release-seat / kick / room switch / leave-room)
  const releaseSeatInRoom = (room, seatIdx) => {
    room.state.connectedPlayers[seatIdx] = false;
    room.state.players[seatIdx].name = `选手 ${seatIdx + 1}`;
    room.state.players[seatIdx].deviceId = `dev_seat_${seatIdx}`;
    room.seatTokens.delete(seatIdx);
    room.seatNames.delete(seatIdx);
    room.historyStack.forEach(s => {
      if (s.players && s.players[seatIdx]) {
        s.players[seatIdx].name = `选手 ${seatIdx + 1}`;
        s.players[seatIdx].deviceId = `dev_seat_${seatIdx}`;
      }
    });
    room.redoStack.forEach(s => {
      if (s.players && s.players[seatIdx]) {
        s.players[seatIdx].name = `选手 ${seatIdx + 1}`;
        s.players[seatIdx].deviceId = `dev_seat_${seatIdx}`;
      }
    });
    for (const [sid, pid] of room.socketToSeat) {
      if (pid === seatIdx) room.socketToSeat.delete(sid);
    }
  };

  // 严格阶段管理：未开始对局时，拒绝一切对局内请求（对局内信息与操作）
  const gateInGame = (target) => {
    if (isMultiRoom && !target.locked) {
      socket.emit('action-error', { message: '对局尚未开始，无法执行对局操作' });
      return true;
    }
    return false;
  };

  // Multi-room: authoritative room binding event (payload roomId wins; handshake referer only seeds it)
  socket.on('join-room', ({ roomId = 'default', playerName = '', deviceId = '' } = {}) => {
    const isFiveDigit = isMultiRoom && roomStore && roomStore.isValidRoomId(roomId);
    if (isFiveDigit && !roomStore.get(roomId)) {
      const referer = socket.handshake?.headers?.referer || '';
      const isBrowserDirectUrl = referer.includes(`/${roomId}`);
      if (isBrowserDirectUrl) {
        socket.emit('room-not-found', { roomId, message: '该房间不存在，请返回大厅重新输入' });
        return;
      }
    }
    const room = getSocketRoom(roomId);
    if (isMultiRoom) {
      roomStore.claimHostIfNeeded(room, deviceId);
      // 锁房前的加入者 token 进入白名单；锁房后不再收录（迟到者无法获得成员身份）
      roomStore.rememberToken(room, deviceId);
      // 加入即成为房间成员（大厅阶段选座确认的对象）
      roomStore.addMember(room, deviceId);
      socket.deviceToken = deviceId || '';
      socket.emit('room-role', { roomId: room.roomId, isHost: roomStore.isHostOf(room, deviceId) });
      broadcastLobby(room);
      // 严格阶段管理：对局已开始时，join-room 本身即为白名单成员的重连重绑
      // （凭 token 找回已确认席位并自动进入对局），不再走前置阶段的 claim-seat
      if (room.started) {
        const memberSeat = roomStore.memberSeatOf(room, deviceId);
        if (memberSeat !== null && memberSeat !== undefined) {
          if (!room.socketToSeat.has(socket.id)) {
            room.socketToSeat.set(socket.id, memberSeat);
            room.state.connectedPlayers[memberSeat] = true;
          }
          socket.emit('claim-seat-result', { success: true, playerId: memberSeat, gameStarted: true });
          emitToRoom(room, 'state-updated', room.state);
        } else {
          // 未经准备的白名单成员 / 陌生 token：对局已开始，禁止进入选座阶段（不返回该界面）
          socket.leave(room.roomId);
          socket.emit('game-already-started', { roomId: room.roomId, message: '该对局已开始，无法加入' });
          console.log(`[MULTI-ROOM] Room ${room.roomId} join rejected (already started): ${deviceId || 'anonymous'}`);
        }
      }
      if (room.timeWarningEmitted && (!room.state || !room.state.isOver)) {
        const startBase = room.gameStartedAt || room.createdAt;
        const elapsedMinutes = (Date.now() - startBase) / 60000;
        const rem = Math.max(1, Math.round(roomStore.opts.gameDestroyMinutes - elapsedMinutes));
        socket.emit('game-time-warning', {
          roomId: room.roomId,
          remainingMinutes: rem,
          message: `本局对局已进行 4 小时，剩余保留时间 ${rem} 分钟，超时将自动解散房间，请尽快完成对局。`
        });
      }
    }
    socket.emit('room-joined', { success: true, roomId: room.roomId, message: `Joined room ${room.roomId}` });
    room.state.lanUrl = getRealWifiLanUrl();
    socket.emit('state-updated', room.state);
  });

  socket.on('create-room', ({ gameMode = 'yonma', settings = null, token = '' } = {}) => {
    // 服务端建房：唯一 5 位房间号 + 预建容器 + 创建者 token 绑定为房主（消除本地随机撞号与房主歧义）
    let generatedRoomId = roomStore
      ? roomStore.generateUniqueRoomId()
      : String(Math.floor(10000 + Math.random() * 90000));
    if (isMultiRoom) {
      if (roomStore.preload(generatedRoomId, settings, gameMode) === null) {
        socket.emit('room-created', { success: false, message: '房间数已达上限' });
        return;
      }
      roomStore.setHost(roomStore.get(generatedRoomId), token);
    }
    socket.emit('room-created', { success: true, roomId: generatedRoomId });
  });

  const emitHistoryInfo = (room, target = io) => {
    target.emit('history-info', {
      canUndo: room.historyStack.length > 0,
      canRedo: room.redoStack.length > 0,
      historyCount: room.historyStack.length
    });
  };

  // Send the current game state to the newly connected client
  const initialRoom = getSocketRoom();
  socket.emit('state-updated', initialRoom.state);
  emitHistoryInfo(initialRoom, socket);

  // Handle client seat claim
  socket.on('claim-seat', ({ roomId, playerId, playerName, deviceId } = {}) => {
    const room = getSocketRoom(roomId);
    if (typeof playerId !== 'number' || !room.state.players[playerId]) return; // 越界/非法席位（含三麻越界）直接忽略
    const rawToken = deviceId || '';
    const effectiveToken = rawToken || `dev_seat_${playerId}`;

    // Multi-room strict stage management: after the game starts, seat confirmation
    // (前置阶段) is closed — rebind happens automatically via join-room instead.
    if (isMultiRoom && room.locked) {
      socket.emit('claim-seat-result', { success: false, reason: '对局已开始，无法更改选座' });
      return;
    }
    if (isMultiRoom) {
      roomStore.claimHostIfNeeded(room, rawToken);
    }

    // Verify seat is not occupied by another active socket
    const existingEntry = Array.from(room.socketToSeat.entries()).find(
      ([sid, pid]) => pid === playerId && sid !== socket.id
    );

    if (existingEntry) {
      const [existingSid] = existingEntry;
      const seatDeviceId = room.state.players[playerId]?.deviceId;
      const isSameDevice = rawToken && seatDeviceId && rawToken === seatDeviceId;

      if (isSameDevice) {
        // Same device reconnecting: evict lingering stale socket
        room.socketToSeat.delete(existingSid);
        const oldSock = io.sockets.sockets.get(existingSid);
        if (oldSock) {
          oldSock.disconnect(true);
        }
      } else {
        socket.emit('claim-seat-result', { success: false, reason: '该席位已被其他选手占用，请重新选择' });
        return;
      }
    }

    // 1. Release previous seat claimed by this socket or by this device token (prevent duplicate seats/names)
    for (const [sIdx, tok] of Array.from(room.seatTokens.entries())) {
      if ((tok === effectiveToken || (room.socketToSeat.has(socket.id) && room.socketToSeat.get(socket.id) === sIdx)) && sIdx !== playerId) {
        releaseSeatInRoom(room, sIdx);
        if (isMultiRoom) {
          roomStore.setMemberSeat(room, tok, null);
        }
      }
    }
    if (room.socketToSeat.has(socket.id) && room.socketToSeat.get(socket.id) !== playerId) {
      const prevSeat = room.socketToSeat.get(socket.id);
      releaseSeatInRoom(room, prevSeat);
      if (isMultiRoom) {
        roomStore.setMemberSeat(room, socket.deviceToken || '', null);
      }
    }

    // 2. Assign new seat
    room.socketToSeat.set(socket.id, playerId);
    room.seatTokens.set(playerId, effectiveToken);
    room.state.connectedPlayers[playerId] = true;

    if (playerName) {
      room.state.players[playerId].name = playerName;
      room.seatNames.set(playerId, playerName);
      // Sync to all history and redo snapshots so historical states retain the active player name
      room.historyStack.forEach(s => {
        if (s.players && s.players[playerId]) s.players[playerId].name = playerName;
      });
      room.redoStack.forEach(s => {
        if (s.players && s.players[playerId]) s.players[playerId].name = playerName;
      });
    }
    // 有有效 token 用 token；无 token 设备按风位分配该座位默认 ID（dev_seat_{playerId}），覆盖残留
    room.state.players[playerId].deviceId = effectiveToken;
    room.historyStack.forEach(s => {
      if (s.players && s.players[playerId]) s.players[playerId].deviceId = effectiveToken;
    });
    room.redoStack.forEach(s => {
      if (s.players && s.players[playerId]) s.players[playerId].deviceId = effectiveToken;
    });

    if (isMultiRoom) {
      roomStore.rememberToken(room, effectiveToken);
      // 认领席位 = 大厅阶段"确认选座"（成员准备），不进入对局；对局由房主 start-game 统一开始
      roomStore.setMemberSeat(room, rawToken, playerId);
      socket.deviceToken = effectiveToken;
    }
    socket.emit('claim-seat-result', { success: true, playerId, gameStarted: room.locked });
    if (isMultiRoom) {
      socket.emit('room-role', { roomId: room.roomId, isHost: roomStore.isHostOf(room, rawToken) });
      broadcastLobby(room);
    }
    emitToRoom(room, 'state-updated', room.state);
  });

  // Handle client seat release (换座 / 释放玩家ID与席位)
  socket.on('release-seat', ({ roomId } = {}) => {
    const room = getSocketRoom(roomId);
    // 严格阶段管理：对局开始后释放席位属于前置阶段请求，予以拒绝（成员退出走 leave-room）
    if (isMultiRoom && room.locked) {
      socket.emit('action-error', { message: '对局已开始，无法释放席位' });
      return;
    }
    let seatIdx = room.socketToSeat.get(socket.id);
    if (seatIdx === undefined && socket.deviceToken) {
      for (const [s, tok] of room.seatTokens) {
        if (tok === socket.deviceToken) {
          seatIdx = s;
          break;
        }
      }
    }
    if (seatIdx !== undefined) {
      releaseSeatInRoom(room, seatIdx);
      if (isMultiRoom) {
        roomStore.setMemberSeat(room, socket.deviceToken || '', null);
        broadcastLobby(room);
      }
      room.socketToSeat.delete(socket.id);
      emitToRoom(room, 'state-updated', room.state);
    }
  });

  // Handle player rename (completely decoupled from logs, history stack, and undo/redo)
  socket.on('rename-player', ({ playerId, newName } = {}) => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    if (typeof playerId !== 'number' || !room.state.players || !room.state.players[playerId]) return;
    const trimmed = (newName || '').trim();
    if (!trimmed) return;

    room.state.players[playerId].name = trimmed;
    room.seatNames.set(playerId, trimmed);
    // Sync to all history and redo snapshots so undo/redo never reverts player names
    room.historyStack.forEach(s => {
      if (s.players && s.players[playerId]) s.players[playerId].name = trimmed;
    });
    room.redoStack.forEach(s => {
      if (s.players && s.players[playerId]) s.players[playerId].name = trimmed;
    });

    emitToRoom(room, 'state-updated', room.state);
  });

  // Update complete state
  // Update state without pushing into undo history (for renames)
  socket.on('update-state-no-history', (newState, logMsg) => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    room.state = JSON.parse(JSON.stringify(newState));
    const activeSeats = Array.from(room.socketToSeat.values());
    room.state.connectedPlayers = [false, false, false, false];
    activeSeats.forEach(seatId => {
      if (seatId >= 0 && seatId < 4) {
        room.state.connectedPlayers[seatId] = true;
      }
    });
    reassertSeatIdentity(room);
    syncRoomFinishedState(room);

    if (logMsg) {
      if (!room.state.log) room.state.log = [];
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      room.state.log.push(`[${timestamp}] ${logMsg}`);
    }

    emitToRoom(room, 'state-changed', { gameState: room.state, logMsg });
  });

  // Re-assert server-authoritative seat identity (tokens + names) onto a client-supplied
  // state snapshot (stale client snapshots would otherwise wipe identity bindings & names)
  const reassertSeatIdentity = (room) => {
    room.seatTokens.forEach((token, pid) => {
      if (room.state.players[pid]) room.state.players[pid].deviceId = token;
    });
    room.seatNames.forEach((name, pid) => {
      if (room.state.players[pid]) room.state.players[pid].name = name;
    });
  };

  const syncRoomFinishedState = (room) => {
    if (room.state && room.state.isOver) {
      if (!room.finishedAt) room.finishedAt = Date.now();
    } else {
      room.finishedAt = null;
    }
  };

  socket.on('update-state', (newState, logMsg) => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    pushHistory(room, room.state);

    // Process new state
    room.state = JSON.parse(JSON.stringify(newState));
    // Force preserve connection states from server memory
    const activeSeats = Array.from(room.socketToSeat.values());
    room.state.connectedPlayers = [false, false, false, false];
    activeSeats.forEach(seatIdx => {
      room.state.connectedPlayers[seatIdx] = true;
    });
    reassertSeatIdentity(room);
    syncRoomFinishedState(room);

    if (logMsg && typeof logMsg === 'string' && logMsg.trim() !== '') {
      if (!room.state.log) room.state.log = [];
      room.state.log.push(logMsg);
    }

    room.redoStack = []; // Clear redo stack on new action
    emitToRoom(room, 'state-updated', room.state);
    emitHistoryInfo(room, roomTarget(room));
  });

  // Helper to preserve active player identity (names and deviceIds) and connections across undo/redo/rollback
  const preservePlayerIdentity = (oldState) => {
    const names = oldState.players ? oldState.players.map(p => p.name) : [];
    const deviceIds = oldState.players ? oldState.players.map(p => p.deviceId) : [];
    const connected = oldState.connectedPlayers;
    return (targetState) => {
      targetState.connectedPlayers = connected;
      if (targetState.players) {
        targetState.players.forEach((p, idx) => {
          if (names[idx]) p.name = names[idx];
          if (deviceIds[idx]) p.deviceId = deviceIds[idx];
        });
      }
    };
  };

  // Cancel riichi action (completely removes riichi from state & history without pollution)
  socket.on('cancel-riichi', ({ playerId } = {}) => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    if (typeof playerId !== 'number' || !room.state.players || !room.state.players[playerId]) return;
    const p = room.state.players[playerId];
    if (!p.riichi) return;

    // Check if the top of historyStack corresponds directly to before this riichi declaration
    const lastHistory = room.historyStack[room.historyStack.length - 1];
    const isDirectRiichiHistory = lastHistory &&
      lastHistory.players &&
      lastHistory.players[playerId] &&
      !lastHistory.players[playerId].riichi &&
      lastHistory.riichiSticks === room.state.riichiSticks - 1 &&
      lastHistory.players[playerId].score === room.state.players[playerId].score + 1000;

    if (isDirectRiichiHistory) {
      // Pop the state before riichi declaration, restoring clean state and history count
      const restoreIdentity = preservePlayerIdentity(room.state);
      room.state = room.historyStack.pop();
      restoreIdentity(room.state);
      room.redoStack = []; // Clear redo stack
    } else {
      // If other actions intervened, silently revert this player's riichi without pushing new history
      p.riichi = false;
      p.score += 1000;
      room.state.riichiSticks = Math.max(0, room.state.riichiSticks - 1);
      if (Array.isArray(room.state.log)) {
        for (let i = room.state.log.length - 1; i >= 0; i--) {
          const item = room.state.log[i];
          if (typeof item === 'string' && item.includes(`[${p.name}]`) && (item.includes('[立直]') || item.includes('宣告立直') || item.includes('声明立直'))) {
            room.state.log.splice(i, 1);
            break;
          }
        }
      }
      room.redoStack = [];
    }

    emitToRoom(room, 'state-updated', room.state);
    emitHistoryInfo(room, roomTarget(room));
  });

  // Undo last action
  socket.on('undo-action', () => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    if (room.historyStack.length > 0) {
      const restoreIdentity = preservePlayerIdentity(room.state);

      // Push current state to redoStack before popping
      room.redoStack.push(JSON.parse(JSON.stringify(room.state)));
      if (room.redoStack.length > 50) {
        room.redoStack.shift();
      }

      room.state = room.historyStack.pop();
      restoreIdentity(room.state); // Preserve seat connections, names, and device IDs
      syncRoomFinishedState(room);

      emitToRoom(room, 'state-updated', room.state);
      emitHistoryInfo(room, roomTarget(room));
    }
  });

  // Rollback to a specific history log entry (replacing multi-step undo)
  socket.on('rollback-to-history', ({ targetLogIndex } = {}) => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    if (typeof targetLogIndex !== 'number') return;
    const currentLatestIdx = (room.state.log?.length ?? 1) - 1;
    const steps = currentLatestIdx - targetLogIndex;

    if (steps <= 0) return; // Already current or invalid
    if (steps > room.historyStack.length) {
      socket.emit('action-error', { message: '所选记录已超出可撤销历史步数上限' });
      return;
    }

    const restoreIdentity = preservePlayerIdentity(room.state);

    // Push states into redoStack sequentially so player can still redo forward
    for (let i = 0; i < steps; i++) {
      room.redoStack.push(JSON.parse(JSON.stringify(room.state)));
      if (room.redoStack.length > 50) {
        room.redoStack.shift();
      }
      room.state = room.historyStack.pop();
    }

    restoreIdentity(room.state); // Preserve seat connections, names, and device IDs
    syncRoomFinishedState(room);

    emitToRoom(room, 'state-updated', room.state);
    emitHistoryInfo(room, roomTarget(room));
  });

  // Redo action
  socket.on('redo-action', () => {
    const room = getSocketRoom();
    if (gateInGame(room)) return;
    if (room.redoStack.length > 0) {
      const restoreIdentity = preservePlayerIdentity(room.state);

      // Push current state to historyStack
      pushHistory(room, room.state);

      room.state = room.redoStack.pop();
      restoreIdentity(room.state); // Preserve seat connections, names, and device IDs
      syncRoomFinishedState(room);

      emitToRoom(room, 'state-updated', room.state);
      emitHistoryInfo(room, roomTarget(room));
    }
  });

  // Reset game
  socket.on('reset-game', (payload) => {
    const room = getSocketRoom();
    room.historyStack = []; // Clear undo stack on reset
    room.redoStack = []; // Clear redo stack on reset
    room.socketToSeat.clear(); // Clear all socket seat claims on game reset!

    let targetMode = room.state.gameMode || 'yonma';
    let customSettings = room.state.settings;

    if (payload && payload.gameMode) {
      targetMode = payload.gameMode;
      if (payload.settings) customSettings = payload.settings;
    }

    room.state = getInitialState(customSettings, targetMode);
    if (isMultiRoom) {
      room.locked = false; // Fresh game: room re-opens for joins until the next score entry
      room.started = false;
      room.gameStartedAt = null;
      room.finishedAt = null;
      room.timeWarningEmitted = false;
      room.seatTokens.clear();
      room.seatNames.clear();
      room.members.forEach(m => { m.seatId = null; });
      broadcastLobby(room);
    }

    emitToRoom(room, 'force-clear-seats'); // Force all connected clients to clear their seat state
    emitToRoom(room, 'state-updated', room.state);
    emitHistoryInfo(room, roomTarget(room));
  });

  // Host-only: start the game (multi-room only).
  // 房主无需准备：可选座（seatId），开始时自动入座——优先选中席位，被占则回退首个空闲席。
  // 未准备的成员不阻塞开始：对局开始即向其弹窗并移回大厅。
  socket.on('start-game', ({ roomId, deviceId, playerName, seatId } = {}) => {
    if (!isMultiRoom) return;
    const room = getSocketRoom(roomId);
    if (!room || !roomStore.isValidRoomId(room.roomId)) return;
    if (!roomStore.isHostOf(room, deviceId)) {
      socket.emit('action-error', { message: '仅房主可以开始对局' });
      return;
    }
    if (room.locked || room.started) {
      socket.emit('action-error', { message: '对局已经开始' });
      return;
    }
    const unconfirmed = roomStore.unconfirmedMembers(room);
    const unpreparedTokens = new Set(unconfirmed.map(m => m.token));
    for (const [, s] of io.of('/').sockets) {
      if (s.rooms && s.rooms.has(room.roomId) && s.deviceToken && unpreparedTokens.has(s.deviceToken)) {
        s.leave(room.roomId);
        s.emit('game-already-started', { roomId: room.roomId, message: '对局已开始，未准备选手已移回大厅' });
        roomStore.removeMember(room, s.deviceToken);
        console.log(`[MULTI-ROOM] Unprepared member ${s.deviceToken} moved back to lobby (room ${room.roomId})`);
      }
    }
    // 房主入座：优先其选中/已锁定的席位（若该席位未被他人占用，即未被占或已被房主本人锁定），否则首个空闲席位；全满则拒绝
    const hostToken = deviceId || '';
    let hostSeat = -1;
    if (typeof seatId === 'number' && seatId >= 0 && seatId < room.state.players.length) {
      const currentToken = room.seatTokens.get(seatId);
      if (!currentToken || currentToken === hostToken) {
        hostSeat = seatId;
      }
    }
    if (hostSeat === -1) {
      hostSeat = room.state.players.findIndex((_, i) => {
        const t = room.seatTokens.get(i);
        return !t || t === hostToken;
      });
    }
    if (hostSeat === -1) {
      socket.emit('action-error', { message: '席位已满，请先移出成员以便房主入座' });
      return;
    }
    // 释放房主之前可能占用的其他席位，确保原席位恢复默认风位名称，防止重名
    for (const [sIdx, tok] of Array.from(room.seatTokens.entries())) {
      if (tok === hostToken && sIdx !== hostSeat) {
        releaseSeatInRoom(room, sIdx);
        if (isMultiRoom) {
          roomStore.setMemberSeat(room, tok, null);
        }
      }
    }
    const hostName = (playerName && String(playerName).trim()) || '房主';
    room.socketToSeat.set(socket.id, hostSeat);
    room.seatTokens.set(hostSeat, hostToken);
    room.seatNames.set(hostSeat, hostName);
    room.state.connectedPlayers[hostSeat] = true;
    room.state.players[hostSeat].name = hostName;
    room.state.players[hostSeat].deviceId = hostToken;
    roomStore.setMemberSeat(room, hostToken, hostSeat);
    room.locked = true; // 房主开始对局：锁房，禁止任何新加入与前置阶段请求
    room.started = true;
    room.gameStartedAt = Date.now();
    room.finishedAt = null;
    room.timeWarningEmitted = false;
    socket.emit('claim-seat-result', { success: true, playerId: hostSeat, gameStarted: true });
    emitToRoom(room, 'game-started', { roomId: room.roomId });
    emitToRoom(room, 'state-updated', room.state);
    emitHistoryInfo(room, roomTarget(room));
    broadcastLobby(room);
    console.log(`[MULTI-ROOM] Room ${room.roomId} game started by host (locked, host seat ${hostSeat})`);
  });

  // Host-only: swap two confirmed members' seats (multi-room only)
  socket.on('swap-seats', ({ roomId, seatA, seatB, deviceId } = {}) => {
    if (!isMultiRoom) return;
    const room = getSocketRoom(roomId);
    if (!room || !roomStore.isValidRoomId(room.roomId)) return;
    if (!roomStore.isHostOf(room, deviceId)) {
      socket.emit('action-error', { message: '仅房主可以交换座位' });
      return;
    }
    if (typeof seatA !== 'number' || typeof seatB !== 'number' || seatA === seatB) return;
    if (!room.state.players[seatA] || !room.state.players[seatB]) return;
    if (!room.seatTokens.has(seatA) || !room.seatTokens.has(seatB)) {
      socket.emit('action-error', { message: '双方均已确认选座才能交换' });
      return;
    }

    // Swap identity (name + token) between the two seats
    const a = room.state.players[seatA], b = room.state.players[seatB];
    const tmpName = a.name, tmpDev = a.deviceId;
    a.name = b.name; a.deviceId = b.deviceId;
    b.name = tmpName; b.deviceId = tmpDev;
    const tA = room.seatTokens.get(seatA), tB = room.seatTokens.get(seatB);
    room.seatTokens.set(seatA, tB);
    room.seatTokens.set(seatB, tA);
    const nA = room.seatNames.get(seatA), nB = room.seatNames.get(seatB);
    if (nA !== undefined) room.seatNames.set(seatB, nA); else room.seatNames.delete(seatB);
    if (nB !== undefined) room.seatNames.set(seatA, nB); else room.seatNames.delete(seatA);
    // Swap live socket bindings so each client keeps its own connection
    let sidA = null, sidB = null;
    for (const [sid, pid] of room.socketToSeat) {
      if (pid === seatA) sidA = sid;
      if (pid === seatB) sidB = sid;
    }
    if (sidA) room.socketToSeat.set(sidA, seatB);
    if (sidB) room.socketToSeat.set(sidB, seatA);
    roomStore.swapMemberSeats(room, seatA, seatB);
    // Keep undo/redo snapshots consistent: member identity follows the member
    [room.historyStack, room.redoStack].forEach(stack => stack.forEach(s => {
      if (s.players && s.players[seatA] && s.players[seatB]) {
        const n = s.players[seatA].name, d = s.players[seatA].deviceId;
        s.players[seatA].name = s.players[seatB].name;
        s.players[seatA].deviceId = s.players[seatB].deviceId;
        s.players[seatB].name = n;
        s.players[seatB].deviceId = d;
      }
    }));

    if (sidA) {
      const sockA = io.sockets.sockets.get(sidA);
      if (sockA) sockA.emit('seat-moved', { roomId: room.roomId, seatId: seatB });
    }
    if (sidB) {
      const sockB = io.sockets.sockets.get(sidB);
      if (sockB) sockB.emit('seat-moved', { roomId: room.roomId, seatId: seatA });
    }

    emitToRoom(room, 'state-updated', room.state);
    broadcastLobby(room);
    console.log(`[MULTI-ROOM] Seats ${seatA} <-> ${seatB} swapped in room ${room.roomId}`);
  });

  // Host-only: move a prepared member to another seat (选座阶段"与其交换座位"——
  // 成员移入房主选中的空闲席位，房主原选位释放；对局未开始时可用)
  socket.on('move-member', ({ roomId, deviceId, fromSeat, toSeat } = {}) => {
    if (!isMultiRoom) return;
    const room = getSocketRoom(roomId);
    if (!room || !roomStore.isValidRoomId(room.roomId)) return;
    if (!roomStore.isHostOf(room, deviceId)) {
      socket.emit('action-error', { message: '仅房主可以调整成员座位' });
      return;
    }
    if (room.locked || room.started) {
      socket.emit('action-error', { message: '对局已开始，无法调整座位' });
      return;
    }
    if (typeof fromSeat !== 'number' || !room.state.players[fromSeat] || !room.seatTokens.has(fromSeat)) return;
    if (typeof toSeat !== 'number' || toSeat < 0 || toSeat >= room.state.players.length) return;
    if (fromSeat === toSeat) return;
    if (room.seatTokens.has(toSeat)) {
      socket.emit('action-error', { message: '目标席位已被占用' });
      return;
    }
    const token = room.seatTokens.get(fromSeat);
    const name = room.seatNames.get(fromSeat) || `选手 ${toSeat + 1}`;
    releaseSeatInRoom(room, fromSeat);
    room.seatTokens.set(toSeat, token);
    room.seatNames.set(toSeat, name);
    room.state.connectedPlayers[toSeat] = true;
    room.state.players[toSeat].name = name;
    room.state.players[toSeat].deviceId = token;
    let memberSid = null;
    for (const [sid, pid] of room.socketToSeat) {
      if (pid === fromSeat) { memberSid = sid; break; }
    }
    if (memberSid) room.socketToSeat.set(memberSid, toSeat);
    roomStore.setMemberSeat(room, token, toSeat);
    // 历史/重做快照：成员身份跟随成员迁移
    room.historyStack.forEach(s => {
      if (s.players && s.players[fromSeat]) {
        s.players[fromSeat].name = `选手 ${fromSeat + 1}`;
        s.players[fromSeat].deviceId = `dev_seat_${fromSeat}`;
      }
      if (s.players && s.players[toSeat]) {
        s.players[toSeat].name = name;
        s.players[toSeat].deviceId = token;
      }
    });
    room.redoStack.forEach(s => {
      if (s.players && s.players[fromSeat]) {
        s.players[fromSeat].name = `选手 ${fromSeat + 1}`;
        s.players[fromSeat].deviceId = `dev_seat_${fromSeat}`;
      }
      if (s.players && s.players[toSeat]) {
        s.players[toSeat].name = name;
        s.players[toSeat].deviceId = token;
      }
    });
    if (memberSid) {
      const movedSock = io.sockets.sockets.get(memberSid);
      if (movedSock) movedSock.emit('seat-moved', { roomId: room.roomId, seatId: toSeat });
    }
    emitToRoom(room, 'state-updated', room.state);
    broadcastLobby(room);
    console.log(`[MULTI-ROOM] Member ${token} moved ${fromSeat} -> ${toSeat} in room ${room.roomId}`);
  });

  // Host-only: remove a member from the room (multi-room only; identity guarded by device token)
  socket.on('kick-player', ({ roomId, playerId, deviceId } = {}) => {
    if (!isMultiRoom) return;
    const room = getSocketRoom(roomId);
    if (!room || !roomStore.isValidRoomId(room.roomId)) return;
    if (!roomStore.isHostOf(room, deviceId)) {
      socket.emit('action-error', { message: '仅房主可以移除成员' });
      return;
    }
    if (typeof playerId !== 'number' || !room.state.players[playerId]) return;
    // Cannot kick the seat bound to the host's own token
    if (room.state.players[playerId].deviceId && room.state.players[playerId].deviceId === deviceId) return;

    let kickedSid = null;
    for (const [sid, pid] of room.socketToSeat) {
      if (pid === playerId) { kickedSid = sid; break; }
    }
    // Revoke the kicked member's token so they cannot re-join the locked room
    const kickedToken = room.seatTokens.get(playerId) || room.state.players[playerId].deviceId;
    releaseSeatInRoom(room, playerId);
    if (kickedToken) roomStore.forgetToken(room, kickedToken);
    roomStore.removeMember(room, kickedToken);
    broadcastLobby(room);
    emitToRoom(room, 'state-updated', room.state);
    if (kickedSid) {
      const kickedSock = io.sockets.sockets.get(kickedSid);
      if (kickedSock) kickedSock.emit('kicked', { message: '您已被房主移出房间' });
    }
    console.log(`[MULTI-ROOM] Player ${playerId} kicked from room ${room.roomId}`);
  });

  socket.on('disconnect', () => {
    const room = getSocketRoom();
    if (room.socketToSeat.has(socket.id)) {
      const seatIdx = room.socketToSeat.get(socket.id);
      room.state.connectedPlayers[seatIdx] = false;
      room.socketToSeat.delete(socket.id);
      emitToRoom(room, 'state-updated', room.state);
    }
    const clientIp = socket.clientIp || getClientIp(socket);
    console.log(`[INFO] Client disconnected ${clientIp}`);
  });
});

// Helper to get local network IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const interfaceName in interfaces) {
    const addressesForInterface = interfaces[interfaceName];
    for (const addressInfo of addressesForInterface) {
      // Filter out internal (loopback) and non-IPv4 addresses
      if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
        addresses.push(addressInfo.address);
      }
    }
  }
  return addresses;
}

function tryAutoOpenBrowser(port) {
  if (process.env.NO_OPEN === 'true') return;

  const url = `http://localhost:${port}`;
  const { exec } = require('child_process');

  const isTermux = Boolean(
    process.env.PREFIX?.includes('com.termux') || 
    process.env.TERMUX_VERSION ||
    process.platform === 'android'
  );

  if (isTermux) {
    exec(`termux-open-url "${url}" 2>/dev/null || am start -a android.intent.action.VIEW -d "${url}" 2>/dev/null`, () => {});
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log(' Riichi Mahjong Scoreboard Server');
  console.log(` Port ${PORT}`);
  console.log('==================================================');
  console.log(' Local');
  console.log(` http://localhost:${PORT}`);
  
  const localIPs = getLocalIPs();
  if (localIPs.length > 0) {
    console.log('\n LAN');
    localIPs.forEach(ip => {
      console.log(` http://${ip}:${PORT}`);
    });
  } else {
    console.log('\n No LAN IP detected. Please connect to Wi-Fi or hotspot.');
  }
  console.log('==================================================');

  tryAutoOpenBrowser(PORT);
});
