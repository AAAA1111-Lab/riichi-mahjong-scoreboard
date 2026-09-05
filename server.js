


function getRealWifiLanIp() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let firstValidIp = '';

  for (const devName in interfaces) {
    const lowerDev = devName.toLowerCase();
    // 过滤虚拟网卡
    if (lowerDev.includes('docker') || lowerDev.includes('vethernet') || lowerDev.includes('vbox') || lowerDev.includes('wsl') || lowerDev.includes('virtual') || lowerDev.includes('dummy')) {
      continue;
    }

    const iface = interfaces[devName];
    if (!iface) continue;

    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        // 优先 192.168.x.x (家庭 WiFi、手机热点 192.168.43.1 / 192.168.137.1)
        if (alias.address.startsWith('192.168.')) {
          return alias.address;
        }
        // 次选 10.x.x.x 或 172.16~31.x.x
        if (!firstValidIp) {
          firstValidIp = alias.address;
        }
      }
    }
  }
  return firstValidIp || '127.0.0.1';
}

const PORT = process.env.PORT || 32000;
const SERVER_LAN_IP = getRealWifiLanIp();
const SERVER_LAN_URL = `http://${SERVER_LAN_IP}:${PORT}`;

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const cors = require('cors');

const app = express();
app.use(cors());

// [PROVISION] 云端部署与反向代理支持 (Nginx, Cloudflare, Railway, Render 等)
app.set('trust proxy', 1);

// Disable caching for development and production testing
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// [PROVISION] 预留健康检查与多房间查询 API (暂未开启多房间模式)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v3.20',
    timestamp: Date.now(),
    multiRoomEnabled: process.env.ENABLE_MULTI_ROOM === 'true',
    nodeEnv: process.env.NODE_ENV || 'production'
  });
});

app.get('/api/rooms', (req, res) => {
  if (process.env.ENABLE_MULTI_ROOM !== 'true') {
    return res.json({ enabled: false, message: 'Multi-room mode is disabled. Running in single-room mode.' });
  }
  res.json({ enabled: true, rooms: [] });
});

// Serve static files from frontend build directory
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// For SPA routing, direct all requests to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 25000,
  pingInterval: 10000,
  connectTimeout: 30000,
  transports: ['websocket', 'polling']
});

// Initial game state
const getInitialState = (settings = null, mode = 'yonma') => {
  const isSanma = mode === 'sanma';
  const defaultStarting = isSanma ? 35000 : 25000;
  const defaultOka = isSanma ? 40000 : 30000;

  const finalSettings = {
    multiRonEnabled: settings?.multiRonEnabled ?? false,
    dobonEnabled: settings?.dobonEnabled ?? false,
    startingPoints: settings?.startingPoints ?? defaultStarting,
    okaPoints: settings?.okaPoints ?? defaultOka,
    westRoundEnabled: settings?.westRoundEnabled ?? true,
    agariYameEnabled: settings?.agariYameEnabled ?? true,
    kiriageManganEnabled: settings?.kiriageManganEnabled ?? true,
  };
  const initScore = finalSettings.startingPoints;
  const playerCount = isSanma ? 3 : 4;
  
  const players = [];
  const connectedPlayers = [];
  const initScoresRow = [];

  for (let i = 0; i < playerCount; i++) {
    players.push({ id: i, name: `玩家 ${i + 1}`, score: initScore, riichi: false, deviceId: `dev_seat_${i}` });
    connectedPlayers.push(false);
    initScoresRow.push(initScore);
  }

  return {
    gameMode: isSanma ? 'sanma' : 'yonma',
    players,
    connectedPlayers,
    dealerIndex: 0,
    wind: 'east',
    round: 1,
    honba: 0,
    riichiSticks: 0,
    lanUrl: SERVER_LAN_URL,
    isOver: false,
    settings: finalSettings,
    log: [`游戏已初始化 (${isSanma ? '三人麻将' : '四人麻将'})，初始点数 ${initScore} 点`],
    scoreHistory: [initScoresRow],
    roundHistory: ['起点']
  };
};

let currentState = getInitialState();
let historyStack = [];
let redoStack = [];
const socketToSeat = new Map(); // Maps socket.id -> playerId (0-3)

// Helper to push history state (deep copy)
const pushHistory = (state) => {
  historyStack.push(JSON.parse(JSON.stringify(state)));
  if (historyStack.length > 50) {
    historyStack.shift(); // Limit to 50 undos
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
  
  // [PROVISION] 预留多房间加入与隔离接口 (未开启时默认加入全局 default 房间)
  socket.on('join-room', ({ roomId = 'default', playerName = '', deviceId = '' }) => {
    socket.join(roomId);
    socket.emit('room-joined', { success: true, roomId, message: `Joined room ${roomId}` });
    socket.emit('state-updated', currentState);
  });

  socket.on('create-room', ({ gameMode = 'yonma', settings = null }) => {
    // 预留随机 4 位数字房间码生成
    const generatedRoomId = Math.floor(1000 + Math.random() * 9000).toString();
    socket.emit('room-created', { success: true, roomId: generatedRoomId });
  });

  // Send the current game state to the newly connected client
  socket.emit('state-updated', currentState);
  socket.emit('history-info', { canUndo: historyStack.length > 0, canRedo: redoStack.length > 0 });

  // Handle client seat claim
  socket.on('claim-seat', ({ playerId, playerName, deviceId }) => {
    // Verify seat is not occupied by another active socket
    const isSeatOccupied = Array.from(socketToSeat.entries()).some(
      ([sid, pid]) => pid === playerId && sid !== socket.id
    );

    if (isSeatOccupied) {
      socket.emit('claim-seat-result', { success: false, reason: '该位置已被其他玩家占用，请重新选择' });
      return;
    }
    
    // 1. Release previous seat claimed by this socket
    if (socketToSeat.has(socket.id)) {
      const prevSeat = socketToSeat.get(socket.id);
      currentState.connectedPlayers[prevSeat] = false;
      currentState.players[prevSeat].name = `玩家 ${prevSeat + 1}`;
      currentState.players[prevSeat].deviceId = `dev_seat_${prevSeat}`;
    }
    
    // 2. Assign new seat
    socketToSeat.set(socket.id, playerId);
    currentState.connectedPlayers[playerId] = true;
    
    if (playerName) {
      currentState.players[playerId].name = playerName;
    }
    // 有有效设备 ID 用设备 ID；无 ID 设备按风位分配该座位默认 ID（dev_seat_{playerId}），覆盖残留
    currentState.players[playerId].deviceId = deviceId || `dev_seat_${playerId}`;
    
    socket.emit('claim-seat-result', { success: true, playerId });
    io.emit('state-updated', currentState);
  });

  // Handle client seat release (换座 / 释放玩家ID与席位)
  socket.on('release-seat', () => {
    if (socketToSeat.has(socket.id)) {
      const seatIdx = socketToSeat.get(socket.id);
      currentState.connectedPlayers[seatIdx] = false;
      currentState.players[seatIdx].name = `玩家 ${seatIdx + 1}`;
      currentState.players[seatIdx].deviceId = `dev_seat_${seatIdx}`;
      socketToSeat.delete(socket.id);
      io.emit('state-updated', currentState);
    }
  });

  // Update complete state
  // Update state without pushing into undo history (for renames)
  socket.on('update-state-no-history', (newState, logMsg) => {
    currentState = JSON.parse(JSON.stringify(newState));
    const activeSeats = Array.from(socketToSeat.values());
    currentState.connectedPlayers = [false, false, false, false];
    activeSeats.forEach(seatId => {
      if (seatId >= 0 && seatId < 4) {
        currentState.connectedPlayers[seatId] = true;
      }
    });

    if (logMsg) {
      if (!currentState.log) currentState.log = [];
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      currentState.log.push(`[${timestamp}] ${logMsg}`);
    }

    io.emit('state-changed', { gameState: currentState, logMsg });
  });

  socket.on('update-state', (newState, logMsg) => {
    pushHistory(currentState);
    
    // Process new state
    currentState = JSON.parse(JSON.stringify(newState));
    // Force preserve connection states from server memory
    const activeSeats = Array.from(socketToSeat.values());
    currentState.connectedPlayers = [false, false, false, false];
    activeSeats.forEach(seatIdx => {
      currentState.connectedPlayers[seatIdx] = true;
    });

    if (logMsg && typeof logMsg === 'string' && logMsg.trim() !== '') {
      if (!currentState.log) currentState.log = [];
      currentState.log.push(logMsg);
    }
    
    redoStack = []; // Clear redo stack on new action
    io.emit('state-updated', currentState);
    io.emit('history-info', { canUndo: historyStack.length > 0, canRedo: redoStack.length > 0 });
  });

  // Undo last action
  socket.on('undo-action', () => {
    if (historyStack.length > 0) {
      const prevConnected = currentState.connectedPlayers;
      
      // Push current state to redoStack before popping
      redoStack.push(JSON.parse(JSON.stringify(currentState)));
      if (redoStack.length > 50) {
        redoStack.shift();
      }

      currentState = historyStack.pop();
      currentState.connectedPlayers = prevConnected; // Preserve seat connections
      
      io.emit('state-updated', currentState);
      io.emit('history-info', { canUndo: historyStack.length > 0, canRedo: redoStack.length > 0 });
    }
  });

  // Redo action
  socket.on('redo-action', () => {
    if (redoStack.length > 0) {
      const prevConnected = currentState.connectedPlayers;
      
      // Push current state to historyStack
      pushHistory(currentState);

      currentState = redoStack.pop();
      currentState.connectedPlayers = prevConnected; // Preserve seat connections
      
      io.emit('state-updated', currentState);
      io.emit('history-info', { canUndo: historyStack.length > 0, canRedo: redoStack.length > 0 });
    }
  });

  // Reset game
  socket.on('reset-game', (payload) => {
    pushHistory(currentState);
    redoStack = []; // Clear redo stack on reset
    socketToSeat.clear(); // Clear all socket seat claims on game reset!
    
    let targetMode = currentState.gameMode || 'yonma';
    let customSettings = currentState.settings;

    if (payload && payload.gameMode) {
      targetMode = payload.gameMode;
      if (payload.settings) customSettings = payload.settings;
    }

    currentState = getInitialState(customSettings, targetMode);
    
    io.emit('force-clear-seats'); // Force all connected clients to clear their seat state
    io.emit('state-updated', currentState);
    io.emit('history-info', { canUndo: historyStack.length > 0, canRedo: false });
  });

  socket.on('disconnect', () => {
    if (socketToSeat.has(socket.id)) {
      const seatIdx = socketToSeat.get(socket.id);
      currentState.connectedPlayers[seatIdx] = false;
      socketToSeat.delete(socket.id);
      io.emit('state-updated', currentState);
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
