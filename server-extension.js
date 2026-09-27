/**
 * Server Extension Module (服务器扩展与对局大厅/房间路由模块)
 * 
 * Implements:
 * 1. 5-digit pure numeric room routing: /12345 (完全前置)
 * 2. Room creation & verification APIs: /api/rooms/create, /api/rooms/verify/:roomId
 * 3. SPA direct passthrough for 5-digit room URLs
 * 4. Front-loaded Socket.io room coordination (extracts from referer / query / auth)
 * 5. Admin management panel (/admin)
 */

const fs = require('fs');
const path = require('path');

function isServerExtensionEnabled() {
  if (process.env.ENABLE_SERVER_MODULE === 'false') return false;
  if (process.env.ENABLE_SERVER_MODULE === 'true') return true;
  // Default to enabled only in server target environment; LAN mode is unmounted by default
  return process.env.TARGET_ENV === 'server';
}

// Active in-memory rooms store
const activeRooms = new Map();

// Multi-room container store (injected by server.js via setRoomStore when ENABLE_MULTI_ROOM is on)
let roomStoreRef = null;
// Per-IP creation rate limit for POST /api/rooms/create (multi-room only): 10 per hour
const createRate = new Map();

/**
 * Generate a random 5-digit room code (10000 - 99999)
 */
function generateFiveDigitRoomId() {
  let roomId;
  let attempts = 0;
  do {
    roomId = Math.floor(10000 + Math.random() * 90000).toString();
    attempts++;
  } while (activeRooms.has(roomId) && attempts < 100);
  return roomId;
}

const serverExtension = {
  name: 'server-extension',
  priority: 20,
  get enabled() {
    return isServerExtensionEnabled();
  },

  // Optional injection: multi-room container store (see multi-room.js). No-op when absent.
  setRoomStore(store) {
    roomStoreRef = store;
  },

  // Remove room from activeRooms map (e.g. on destroy/sweep or disband)
  removeRoom(roomId) {
    if (roomId) activeRooms.delete(String(roomId));
  },

  /**
   * 1. FRONT-LOADED HTTP PRE-MIDDLEWARE:
   * 5-digit path (/12345), URL Subdomain, and query-based room extraction.
   * Runs before all application routes and static assets.
   * 
   * @param {import('express').Application} app
   */
  onPreMiddleware(app) {
    app.use((req, res, next) => {
      let detectedRoomId = null;

      // 1. Match 5-digit pure numeric path: e.g. "/12345" or "/12345/"
      const pathMatch = req.path.match(/^\/(\d{5})\/?$/);
      if (pathMatch) {
        detectedRoomId = pathMatch[1];
      }

      // 2. Match subdomain: e.g. "room-12345.domain.com" or "12345.domain.com"
      if (!detectedRoomId) {
        const host = req.headers['x-forwarded-host'] || req.headers.host || '';
        // Skip IPv4 / IPv6 addresses
        if (!/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(host)) {
          const subdomainMatch = host.match(/^([a-zA-Z0-9_-]+)\.[^:]+/);
          if (subdomainMatch) {
            const sub = subdomainMatch[1].toLowerCase().replace(/^room-?/, '');
            if (/^\d{5}$/.test(sub)) {
              detectedRoomId = sub;
            }
          }
        }
      }

      // 3. Also support query param: ?room=12345
      if (!detectedRoomId && req.query && req.query.room) {
        detectedRoomId = String(req.query.room).trim();
      }

      // Attach detected room context to the request
      req.roomId = detectedRoomId || null;
      next();
    });

    console.log('[MODULE] Server-extension: 5-digit path & room router mounted.');
  },

  /**
   * 2. FRONT-LOADED ROUTES:
   * Room APIs, 5-digit SPA passthrough, and Admin panel.
   * 
   * @param {import('express').Application} app
   */
  onRoutes(app) {
    // 2.1 API: Create a new 5-digit room
    app.post('/api/rooms/create', (req, res) => {
      // Multi-room: global room cap + per-IP creation rate limit + container preload
      if (roomStoreRef) {
        if (roomStoreRef.count >= roomStoreRef.opts.maxRooms) {
          return res.status(503).json({ success: false, message: '房间数已达上限，请稍后再试' });
        }
        const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        const now = Date.now();
        const entry = createRate.get(ip);
        if (!entry || now > entry.resetAt) {
          createRate.set(ip, { count: 1, resetAt: now + 3600000 });
        } else if (entry.count >= 10) {
          return res.status(429).json({ success: false, message: '创建房间过于频繁，请稍后再试' });
        } else {
          entry.count++;
        }
      }
      // 5 位房间号唯一性：同时避开活跃容器（成员可直接经 URL 加入预建房间）
      let roomId = generateFiveDigitRoomId();
      if (roomStoreRef) {
        let attempts = 0;
        while (roomStoreRef.has(roomId) && attempts < 100) {
          roomId = generateFiveDigitRoomId();
          attempts++;
        }
      }
      activeRooms.set(roomId, {
        roomId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        settings: req.body?.settings || null,
        gameMode: req.body?.gameMode || 'yonma'
      });
      if (roomStoreRef && roomStoreRef.preload(roomId, req.body?.settings || null, req.body?.gameMode || null) === null) {
        return res.status(503).json({ success: false, message: '房间数已达上限，请稍后再试' });
      }
      // 创建者 token 绑定为房主（消除"首个加入者"时序歧义与同号撞房的两个房主问题）
      if (roomStoreRef && req.body?.token) {
        roomStoreRef.setHost(roomStoreRef.get(roomId), String(req.body.token));
      }
      console.log(`[MODULE] Room created: ${roomId}`);
      res.json({
        success: true,
        roomId,
        url: `/${roomId}`,
        message: `Room ${roomId} created successfully`
      });
    });

    // 2.2 API: Verify / check 5-digit room status
    app.get('/api/rooms/verify/:roomId', (req, res) => {
      const { roomId } = req.params;
      const isValidFormat = /^\d{5}$/.test(roomId);
      if (!isValidFormat) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: '房间号必须为5位纯数字'
        });
      }
      res.json({
        success: true,
        valid: true,
        roomId,
        exists: roomStoreRef ? Boolean(roomStoreRef.get(roomId)) : activeRooms.has(roomId)
      });
    });

    // 2.3 Direct SPA HTML passthrough with server environment injection
    // When mounted, these front-loaded routes intercept / and /12345 before static middleware.
    const staticDir = fs.existsSync(path.join(__dirname, 'frontend/dist'))
      ? path.join(__dirname, 'frontend/dist')
      : path.join(__dirname, 'dist');

    // 2.3.1 Root redirect: In server mode, root / redirects to /home
    app.get('/', (req, res) => {
      return res.redirect(302, '/home');
    });

    // 2.3.2 Server Portal / Lobby: /home
    app.get('/home', (req, res, next) => {
      const indexPath = path.join(staticDir, 'index.html');
      try {
        let html = fs.readFileSync(indexPath, 'utf8');
        const injection = '<script>window.__TARGET_ENV__ = "server";</script>';
        html = html.replace('<head>', '<head>' + injection);
        return res.type('html').send(html);
      } catch (e) {
        next();
      }
    });

    app.get(/^\/(\d{5})\/?$/, (req, res, next) => {
      const roomId = req.params[0];
      const indexPath = path.join(staticDir, 'index.html');
      try {
        let html = fs.readFileSync(indexPath, 'utf8');
        const injection = `<script>window.__TARGET_ENV__ = "server"; window.__ROOM_ID__ = "${roomId}";</script>`;
        html = html.replace('<head>', '<head>' + injection);
        return res.type('html').send(html);
      } catch (e) {
        next();
      }
    });

    // 2.4 Admin Panel & API Routes (前置管理控制台)
    app.get('/admin', (req, res) => {
      const roomList = roomStoreRef
        ? roomStoreRef.listRooms().filter(r => /^\d{5}$/.test(r.roomId)).map(r => r.roomId)
        : Array.from(activeRooms.keys());
      const roomListHtml = roomList.map(r => `<li>房间号: <strong>${r}</strong></li>`).join('') || '<li>暂无活跃房间</li>';
      res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>服务器管理控制台 - Riichi Scoreboard</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #12141a; color: #f0f0f0; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
    .card { background: #1c1f28; border: 1px solid #2e3342; border-radius: 12px; padding: 28px; max-width: 500px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.4); text-align: center; }
    h1 { font-size: 1.4rem; color: #e65100; margin-top: 0; }
    p { font-size: 0.9rem; color: #a0a5b5; line-height: 1.6; }
    .badge { display: inline-block; background: rgba(230, 81, 0, 0.15); color: #ff9800; padding: 4px 12px; border-radius: 16px; font-weight: bold; font-size: 0.8rem; margin-bottom: 16px; }
    ul { text-align: left; background: #151821; padding: 16px 28px; border-radius: 8px; color: #cfd3dc; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">SERVER EDITION · ADMIN PANEL</div>
    <h1>服务器管理面板</h1>
    <p>公网服务器运行状态正常，5位房间路由已挂载。</p>
    <div style="text-align: left; font-size: 0.85rem; color: #8a90a2; margin-top: 16px;">当前活跃对局房间：</div>
    <ul>${roomListHtml}</ul>
  </div>
</body>
</html>`);
    });

    app.get('/api/admin/status', (req, res) => {
      const currentRooms = roomStoreRef
        ? roomStoreRef.listRooms().filter(r => /^\d{5}$/.test(r.roomId)).map(r => r.roomId)
        : Array.from(activeRooms.keys());
      res.json({
        status: 'ready',
        target: 'server',
        module: 'server-extension',
        timestamp: Date.now(),
        activeRoomCount: currentRooms.length,
        rooms: currentRooms,
        features: ['security-filter', '5-digit-room-routing', 'room-portal-stage', 'admin-panel']
      });
    });

    console.log('[MODULE] Server-extension: 5-digit room routes, APIs and admin panel mounted.');
  },

  /**
   * 3. SOCKET.IO MIDDLEWARE:
   * Extracts 5-digit room from referer URL, query, or auth headers.
   * 
   * @param {import('socket.io').Server} io
   */
  onSocketMiddleware(io) {
    io.use((socket, next) => {
      let roomId = 'default';

      // 1. From handshake query or auth: roomId=12345
      const queryRoom = socket.handshake.query?.roomId || socket.handshake.auth?.roomId;
      if (queryRoom && /^\d{5}$/.test(String(queryRoom).trim())) {
        roomId = String(queryRoom).trim();
      }

      // 2. From referer header URL path: e.g. "http://1.1.1.1:32000/12345"
      if (roomId === 'default') {
        const referer = socket.handshake.headers.referer || '';
        const refererMatch = referer.match(/\/(\d{5})(?:[/?#]|$)/);
        if (refererMatch) {
          roomId = refererMatch[1];
        }
      }

      // 3. From subdomain
      if (roomId === 'default') {
        const host = socket.handshake.headers['x-forwarded-host'] || socket.handshake.headers.host || '';
        if (!/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(host)) {
          const subdomainMatch = host.match(/^([a-zA-Z0-9_-]+)\.[^:]+/);
          if (subdomainMatch) {
            const sub = subdomainMatch[1].toLowerCase().replace(/^room-?/, '');
            if (/^\d{5}$/.test(sub)) {
              roomId = sub;
            }
          }
        }
      }

      socket.targetRoomId = roomId;
      next();
    });

    console.log('[MODULE] Server-extension: socket.io 5-digit room coordination mounted.');
  },

  /**
   * 4. SOCKET CONNECTION HOOK:
   * Automatically joins assigned room namespace.
   * 
   * @param {import('socket.io').Server} io
   * @param {import('socket.io').Socket} socket
   */
  onSocketConnection(io, socket) {
    const roomId = socket.targetRoomId || 'default';
    socket.join(roomId);
    if (roomId !== 'default') {
      console.log(`[MODULE] Socket ${socket.id} joined 5-digit room: ${roomId}`);
    }

    // [PROVISION] 预留离开房间与解散房间的协同处理接口
    socket.on('leave-room', ({ roomId: targetRoomId } = {}) => {
      const rId = targetRoomId || roomId;
      // Multi-room: release the socket's seat, remove membership (by device token), refresh lobby
      if (roomStoreRef) {
        const room = roomStoreRef.get(rId);
        if (room) {
          if (room.socketToSeat.has(socket.id)) {
            const seatIdx = room.socketToSeat.get(socket.id);
            roomStoreRef.releaseSeat(room, seatIdx);
          }
          roomStoreRef.removeMemberByToken(room, socket.deviceToken);
          io.to(rId).emit('state-updated', room.state);
          io.to(rId).emit('lobby-updated', roomStoreRef.lobbyPayload(room));
        }
      }
      socket.leave(rId);
      console.log(`[MODULE] Socket ${socket.id} left room: ${rId}`);
    });

    socket.on('disband-room', ({ roomId: targetRoomId, deviceId } = {}) => {
      const rId = targetRoomId || roomId;
      // Multi-room: host-token guarded disband through the container store
      if (roomStoreRef) {
        const result = roomStoreRef.disband(rId, deviceId);
        if (!result.ok) {
          socket.emit('action-error', { message: result.reason || '无法解散房间' });
          return;
        }
        io.to(rId).emit('force-clear-seats');
        io.to(rId).emit('room-disbanded', { message: '房间已被房主解散' });
        socket.emit('room-disbanded-host', { message: '房间已解散' });
        console.log(`[MODULE] Room disbanded (multi-room): ${rId}`);
        return;
      }
      if (activeRooms.has(rId)) {
        activeRooms.delete(rId);
        io.to(rId).emit('room-disbanded', { message: '房间已被房主解散' });
        socket.emit('room-disbanded-host', { message: '房间已解散' });
        console.log(`[MODULE] Room disbanded: ${rId}`);
      }
    });
  }
};

module.exports = serverExtension;
