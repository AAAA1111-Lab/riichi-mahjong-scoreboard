const ROOM_LIMIT = 100;
const IDLE_MS = 5 * 60_000;
const FINISHED_MS = 5 * 60_000;
const GAME_MS = 5 * 60 * 60_000;
const WS_MESSAGE_WINDOW_MS = 60_000;
const WS_MESSAGE_LIMIT = 120;
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
const validRoom = id => /^\d{5}$/.test(String(id));
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
const packet = (event, ...args) => JSON.stringify({ event, args });

async function enforceRateLimit(request, env, bindingName, message) {
  const limiter = env[bindingName];
  if (!limiter) return json({ success: false, message: '请求防护暂时不可用，请稍后再试' }, 503);
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key });
    return success ? null : json({ success: false, message }, 429, { 'retry-after': '60' });
  } catch {
    return json({ success: false, message: '请求防护暂时不可用，请稍后再试' }, 503);
  }
}

function initialState(settings = {}, mode = 'yonma') {
  const sanma = mode === 'sanma';
  const rules = {
    multiRonEnabled: settings.multiRonEnabled ?? true,
    dobonEnabled: settings.dobonEnabled ?? true,
    startingPoints: settings.startingPoints ?? (sanma ? 35000 : 25000),
    okaPoints: settings.okaPoints ?? (sanma ? 40000 : 30000),
    westRoundEnabled: settings.westRoundEnabled ?? true,
    agariYameEnabled: settings.agariYameEnabled ?? true,
    kiriageManganEnabled: settings.kiriageManganEnabled ?? true,
    gameLength: settings.gameLength ?? 'hanchan',
  };
  const count = sanma ? 3 : 4;
  const scores = Array(count).fill(rules.startingPoints);
  return {
    gameMode: sanma ? 'sanma' : 'yonma',
    players: scores.map((score, id) => ({ id, name: `选手 ${id + 1}`, score, riichi: false, deviceId: `dev_seat_${id}` })),
    connectedPlayers: Array(count).fill(false), dealerIndex: 0, wind: 'east', round: 1, honba: 0,
    riichiSticks: 0, lanUrl: '', isOver: false, settings: rules,
    log: [`[对局初始化] ${sanma ? '三人麻将' : '四人麻将'} · ${rules.gameLength === 'tonpuu' ? '东风战' : '半庄战'}，起始点数 ${rules.startingPoints} 点`],
    scoreHistory: [scores], roundHistory: ['起点'],
  };
}

function freshRoom(roomId, settings = {}, gameMode = 'yonma') {
  const now = Date.now();
  return {
    roomId, initialized: true, state: initialState(settings, gameMode), history: [], redo: [],
    seatTokens: {}, seatNames: {}, hostToken: '', knownTokens: [], members: {}, locked: false, started: false,
    createdAt: now, lastActivity: now, gameStartedAt: 0, finishedAt: 0, warningSent: false, settings, gameMode,
  };
}

function lobbyState(room) {
  const members = Object.entries(room.members).map(([token, m]) => ({ seatId: m.seatId ?? null, isHost: token === room.hostToken }));
  const waiting = members.filter(m => !m.isHost);
  return { roomId: room.roomId, locked: room.locked, started: room.started,
    confirmedSeatIds: Object.keys(room.seatTokens).map(Number), members,
    allConfirmed: waiting.length > 0 && waiting.every(m => m.seatId !== null) };
}
const historyInfo = room => ({ canUndo: room.history.length > 0, canRedo: room.redo.length > 0, historyCount: room.history.length });

export class RoomHub {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url);
    const rooms = await this.ctx.storage.get('rooms') || {};
    if (request.method === 'POST' && url.pathname === '/feedback') {
      const body = await request.json().catch(() => null);
      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      const length = [...message].length;
      if (length < 5 || length > 1000) {
        return json({ success: false, message: '建议内容需为 5 到 1000 个字' }, 400);
      }

      await this.ctx.storage.transaction(async (transaction) => {
        const stored = await transaction.get('feedback:submissions');
        const submissions = Array.isArray(stored) ? stored : [];
        submissions.push({ createdAt: Date.now(), message });
        await transaction.put('feedback:submissions', submissions.slice(-100));
      });
      return json({ success: true }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/create') {
      const body = await request.json().catch(() => ({}));
      const now = Date.now(), ip = request.headers.get('CF-Connecting-IP') || 'unknown', key = `rate:${ip}`;
      const rate = await this.ctx.storage.get(key);
      if (!rate || now >= rate.resetAt) await this.ctx.storage.put(key, { count: 1, resetAt: now + 3_600_000 });
      else if (rate.count >= 10) return json({ success: false, message: '创建房间过于频繁，请稍后再试' }, 429);
      else await this.ctx.storage.put(key, { ...rate, count: rate.count + 1 });
      for (const [id, entry] of Object.entries(rooms)) if (now - entry.createdAt > GAME_MS + 60_000) delete rooms[id];
      if (Object.keys(rooms).length >= ROOM_LIMIT) { await this.ctx.storage.put('rooms', rooms); return json({ success: false, message: '房间数已达上限，请稍后再试' }, 503); }
      let roomId;
      for (let i = 0; i < 100; i++) { const candidate = String(10000 + Math.floor(Math.random() * 90000)); if (!rooms[candidate]) { roomId = candidate; break; } }
      if (!roomId) return json({ success: false, message: '暂时无法分配房间号，请重试' }, 503);
      rooms[roomId] = { createdAt: now }; await this.ctx.storage.put('rooms', rooms);
      await this.env.ROOMS.get(this.env.ROOMS.idFromName(roomId)).fetch('https://room.internal/init', {
        method: 'POST', body: JSON.stringify({ roomId, settings: body.settings || {}, gameMode: body.gameMode || 'yonma', token: body.token || '' }),
      });
      return json({ success: true, roomId, url: `/${roomId}`, message: `Room ${roomId} created successfully` });
    }
    const verify = url.pathname.match(/^\/verify\/(\d{5})$/);
    if (request.method === 'GET' && verify) {
      const roomId = verify[1];
      if (!rooms[roomId]) return json({ success: true, valid: true, roomId, exists: false });
      const result = await this.env.ROOMS.get(this.env.ROOMS.idFromName(roomId)).fetch('https://room.internal/meta');
      const exists = (await result.json()).exists;
      if (!exists) { delete rooms[roomId]; await this.ctx.storage.put('rooms', rooms); }
      return json({ success: true, valid: true, roomId, exists });
    }
    if (request.method === 'POST' && url.pathname === '/remove') {
      const { roomId } = await request.json().catch(() => ({}));
      if (rooms[roomId]) { delete rooms[roomId]; await this.ctx.storage.put('rooms', rooms); }
      return json({ success: true });
    }
    if (url.pathname === '/status') return json({ status: 'ready', target: 'server', activeRoomCount: Object.keys(rooms).length, rooms: Object.keys(rooms) });
    if (url.pathname === '/list') return json({ enabled: true, roomCount: Object.keys(rooms).length, maxRooms: ROOM_LIMIT, rooms: Object.keys(rooms).map(roomId => ({ roomId, createdAt: rooms[roomId].createdAt })) });
    return json({ success: false, message: 'Not found' }, 404);
  }
}

export class RoomDO {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.room = null;
    this.ready = ctx.blockConcurrencyWhile(async () => { this.room = await ctx.storage.get('room') || null; });
  }
  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      const body = await request.json();
      if (!this.room) this.room = freshRoom(body.roomId, body.settings, body.gameMode);
      if (body.token && !this.room.hostToken) this.room.hostToken = body.token;
      await this.save(); return json({ success: true });
    }
    if (url.pathname === '/meta') return json({ exists: Boolean(this.room?.initialized) });
    if (url.pathname === '/destroy') { await this.destroy(); return json({ success: true }); }
    if (!url.pathname.startsWith('/ws/')) return json({ error: 'Not found' }, 404);
    if (!this.room && url.pathname !== '/ws/default') {
      const pair = new WebSocketPair(), client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.send(packet('room-not-found', { roomId: url.pathname.split('/').pop(), message: '该房间不存在，请返回大厅重新输入' }));
      server.close(1008, 'room not found'); return new Response(null, { status: 101, webSocket: client });
    }
    if (!this.room) this.room = freshRoom('default');
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    server.serializeAttachment({ id: crypto.randomUUID(), token: '', seatId: null, ip: request.headers.get('CF-Connecting-IP') || 'unknown' }); this.ctx.acceptWebSocket(server);
    server.send(packet('state-updated', this.room.state)); server.send(packet('history-info', historyInfo(this.room)));
    await this.touch(); return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    await this.ready;
    if (typeof raw !== 'string') return;
    if (raw.length > 2_000_000) {
      try { ws.close(1009, 'message too large'); } catch {}
      return;
    }
    let session = ws.deserializeAttachment() || { id: crypto.randomUUID(), token: '', seatId: null };
    const now = Date.now();
    if (!Number.isFinite(session.messageWindowEndsAt) || now >= session.messageWindowEndsAt) {
      session.messageWindowEndsAt = now + WS_MESSAGE_WINDOW_MS;
      session.messageCount = 0;
    }
    session.messageCount = (Number(session.messageCount) || 0) + 1;
    if (session.messageCount > WS_MESSAGE_LIMIT) {
      try { ws.close(1013, 'rate limit exceeded; try again later'); } catch {}
      return;
    }
    ws.serializeAttachment(session);
    let data; try { data = JSON.parse(raw); } catch { return; }
    if (data?.event === '__ping') { this.send(ws, '__pong'); return; }
    if (!this.room) return;
    const room = this.room, args = Array.isArray(data.args) ? data.args : [], p = args[0] || {};
    const emit = (e, ...a) => this.send(ws, e, ...a), all = (e, ...a) => this.broadcast(e, ...a);
    const host = token => Boolean(token && room.hostToken && token === room.hostToken);
    const gate = () => { if (room.locked) return false; emit('action-error', { message: '对局尚未开始，无法执行对局操作' }); return true; };
    const lobby = () => all('lobby-updated', lobbyState(room));
    const saveStackIdentity = seat => { for (const stack of [room.history, room.redo]) for (const state of stack) if (state.players?.[seat]) { state.players[seat].name = room.state.players[seat].name; state.players[seat].deviceId = room.state.players[seat].deviceId; } };
    const release = seat => {
      if (!Number.isInteger(seat) || !room.state.players[seat]) return;
      room.state.connectedPlayers[seat] = false; room.state.players[seat].name = `选手 ${seat + 1}`; room.state.players[seat].deviceId = `dev_seat_${seat}`;
      delete room.seatTokens[seat]; delete room.seatNames[seat];
      for (const stack of [room.history, room.redo]) for (const state of stack) if (state.players?.[seat]) { state.players[seat].name = `选手 ${seat + 1}`; state.players[seat].deviceId = `dev_seat_${seat}`; }
      for (const client of this.ctx.getWebSockets()) { const s = client.deserializeAttachment() || {}; if (s.seatId === seat) { s.seatId = null; client.serializeAttachment(s); } }
    };
    const connected = () => { room.state.connectedPlayers = room.state.players.map((_, i) => this.ctx.getWebSockets().some(client => client.deserializeAttachment()?.seatId === i)); };
    const identities = () => { for (const [i, token] of Object.entries(room.seatTokens)) if (room.state.players[i]) room.state.players[i].deviceId = token; for (const [i, name] of Object.entries(room.seatNames)) if (room.state.players[i]) room.state.players[i].name = name; };
    const history = () => { room.history.push(clone(room.state)); if (room.history.length > 50) room.history.shift(); };
    const state = () => all('state-updated', room.state), hist = () => all('history-info', historyInfo(room));
    switch (data.event) {
      case 'join-room': {
        const token = String(p.deviceId || '');
        if (room.started && (room.members[token]?.seatId == null)) { emit('game-already-started', { roomId: room.roomId, message: '该对局已开始，无法加入' }); break; }
        if (!room.hostToken && token) room.hostToken = token;
        if (token && !room.locked && !room.knownTokens.includes(token)) room.knownTokens.push(token);
        if (token && !room.locked && !room.members[token]) room.members[token] = { seatId: null };
        session.token = token; ws.serializeAttachment(session);
        emit('room-role', { roomId: room.roomId, isHost: host(token) }); lobby();
        if (room.started && room.members[token]?.seatId != null) {
          session.seatId = room.members[token].seatId; ws.serializeAttachment(session); room.state.connectedPlayers[session.seatId] = true;
          emit('claim-seat-result', { success: true, playerId: session.seatId, gameStarted: true }); state();
        }
        if (room.warningSent && !room.state.isOver) {
          const minutes = Math.max(1, Math.round((room.gameStartedAt + GAME_MS - Date.now()) / 60_000));
          emit('game-time-warning', { roomId: room.roomId, remainingMinutes: minutes, message: `本局对局已进行 4 小时，剩余保留时间 ${minutes} 分钟，超时将自动解散房间，请尽快完成对局。` });
        }
        emit('room-joined', { success: true, roomId: room.roomId, message: `Joined room ${room.roomId}` }); emit('state-updated', room.state); emit('history-info', historyInfo(room)); break;
      }
      case 'create-room': {
        let rate;
        try { rate = await this.env.CREATE_ROOM_LIMITER.limit({ key: session.ip || 'unknown' }); }
        catch { emit('room-created', { success: false, message: '创建房间失败，请稍后再试' }); break; }
        if (!rate.success) { emit('room-created', { success: false, message: '创建房间过于频繁，请稍后再试' }); break; }
        const response = await this.env.HUB.get(this.env.HUB.idFromName('global')).fetch('https://hub.internal/create', {
          method: 'POST', headers: { 'CF-Connecting-IP': session.ip || '' }, body: JSON.stringify(p),
        });
        emit('room-created', await response.json()); break;
      }
      case 'claim-seat': {
        const seat = p.playerId, token = String(p.deviceId || `dev_seat_${seat}`);
        if (!Number.isInteger(seat) || !room.state.players[seat]) break;
        if (room.locked) { emit('claim-seat-result', { success: false, reason: '对局已开始，无法更改选座' }); break; }
        if (room.seatTokens[seat] && room.seatTokens[seat] !== token) { emit('claim-seat-result', { success: false, reason: '该席位已被其他选手占用，请重新选择' }); break; }
        for (const [i, t] of Object.entries(room.seatTokens)) if (t === token && Number(i) !== seat) release(Number(i));
        if (session.seatId != null && session.seatId !== seat) release(session.seatId);
        room.seatTokens[seat] = token; room.state.connectedPlayers[seat] = true; session.token = token; session.seatId = seat; ws.serializeAttachment(session);
        if (p.playerName) { room.state.players[seat].name = String(p.playerName); room.seatNames[seat] = String(p.playerName); }
        room.state.players[seat].deviceId = token; saveStackIdentity(seat);
        if (!room.knownTokens.includes(token)) room.knownTokens.push(token);
        room.members[token] ||= { seatId: seat }; room.members[token].seatId = seat;
        emit('claim-seat-result', { success: true, playerId: seat, gameStarted: false }); emit('room-role', { roomId: room.roomId, isHost: host(p.deviceId || '') }); lobby(); state(); break;
      }
      case 'release-seat': {
        if (room.locked) { emit('action-error', { message: '对局已开始，无法释放席位' }); break; }
        const seat = session.seatId;
        if (seat != null) { release(seat); if (room.members[session.token]) room.members[session.token].seatId = null; session.seatId = null; ws.serializeAttachment(session); lobby(); state(); }
        break;
      }
      case 'rename-player': {
        if (gate()) break; const i = p.playerId, name = String(p.newName || '').trim();
        if (!name || !room.state.players[i]) break; room.state.players[i].name = name; room.seatNames[i] = name;
        for (const stack of [room.history, room.redo]) for (const s of stack) if (s.players?.[i]) s.players[i].name = name; state(); break;
      }
      case 'update-state-no-history':
      case 'update-state': {
        if (gate()) break; if (!args[0] || !Array.isArray(args[0].players)) break;
        if (data.event === 'update-state') history(); room.state = clone(args[0]); connected(); identities();
        if (room.state.isOver) room.finishedAt ||= Date.now(); else room.finishedAt = 0;
        if (typeof args[1] === 'string' && args[1].trim()) { room.state.log ||= []; room.state.log.push(data.event === 'update-state' ? args[1] : `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${args[1]}`); }
        if (data.event === 'update-state') { room.redo = []; state(); hist(); } else all('state-changed', { gameState: room.state, logMsg: args[1] }); break;
      }
      case 'cancel-riichi': {
        if (gate()) break; const i = p.playerId, player = room.state.players[i]; if (!player?.riichi) break;
        const previous = room.history.at(-1), direct = previous?.players?.[i] && !previous.players[i].riichi && previous.riichiSticks === room.state.riichiSticks - 1 && previous.players[i].score === player.score + 1000;
        if (direct) { room.state = room.history.pop(); room.redo = []; }
        else { player.riichi = false; player.score += 1000; room.state.riichiSticks = Math.max(0, room.state.riichiSticks - 1); const ix = room.state.log.findLastIndex(line => typeof line === 'string' && line.includes(`[${player.name}]`) && (line.includes('[立直]') || line.includes('宣告立直') || line.includes('声明立直'))); if (ix >= 0) room.state.log.splice(ix, 1); room.redo = []; }
        connected(); identities(); state(); hist(); break;
      }
      case 'undo-action':
        if (!gate() && room.history.length) { room.redo.push(clone(room.state)); if (room.redo.length > 50) room.redo.shift(); room.state = room.history.pop(); connected(); identities(); state(); hist(); }
        break;
      case 'rollback-to-history': {
        if (gate() || typeof p.targetLogIndex !== 'number') break;
        const steps = (room.state.log?.length ?? 1) - 1 - p.targetLogIndex;
        if (steps <= 0) break; if (steps > room.history.length) { emit('action-error', { message: '所选记录已超出可撤销历史步数上限' }); break; }
        for (let i = 0; i < steps; i++) { room.redo.push(clone(room.state)); if (room.redo.length > 50) room.redo.shift(); room.state = room.history.pop(); }
        connected(); identities(); state(); hist(); break;
      }
      case 'redo-action':
        if (!gate() && room.redo.length) { history(); room.state = room.redo.pop(); connected(); identities(); state(); hist(); }
        break;
      case 'reset-game': {
        room.history = []; room.redo = []; room.seatTokens = {}; room.seatNames = {};
        for (const member of Object.values(room.members)) member.seatId = null;
        for (const client of this.ctx.getWebSockets()) { const s = client.deserializeAttachment() || {}; s.seatId = null; client.serializeAttachment(s); }
        const mode = p.gameMode || room.state.gameMode || room.gameMode, settings = p.settings || room.state.settings || room.settings;
        room.state = initialState(settings, mode); room.locked = false; room.started = false; room.gameStartedAt = 0; room.finishedAt = 0; room.warningSent = false;
        all('force-clear-seats'); state(); hist(); lobby(); break;
      }
      case 'start-game': {
        if (!host(p.deviceId)) { emit('action-error', { message: '仅房主可以开始对局' }); break; }
        if (room.locked || room.started) { emit('action-error', { message: '对局已经开始' }); break; }
        const waiting = Object.entries(room.members).filter(([token, member]) => token !== room.hostToken && member.seatId == null).map(([token]) => token);
        for (const client of this.ctx.getWebSockets()) if (waiting.includes(client.deserializeAttachment()?.token)) this.send(client, 'game-already-started', { roomId: room.roomId, message: '对局已开始，未准备选手已移回大厅' });
        for (const token of waiting) delete room.members[token];
        const n = room.state.players.length;
        let seat = Number.isInteger(p.seatId) && p.seatId >= 0 && p.seatId < n && (!room.seatTokens[p.seatId] || room.seatTokens[p.seatId] === p.deviceId) ? p.seatId : -1;
        if (seat < 0) seat = room.state.players.findIndex((_, i) => !room.seatTokens[i] || room.seatTokens[i] === p.deviceId);
        if (seat < 0) { emit('action-error', { message: '席位已满，请先移出成员以便房主入座' }); break; }
        for (const [i, token] of Object.entries(room.seatTokens)) if (token === p.deviceId && Number(i) !== seat) release(Number(i));
        room.seatTokens[seat] = p.deviceId || ''; room.seatNames[seat] = String(p.playerName || '房主');
        room.state.players[seat].name = room.seatNames[seat]; room.state.players[seat].deviceId = p.deviceId || '';
        room.members[p.deviceId] ||= { seatId: null }; room.members[p.deviceId].seatId = seat; session.token = p.deviceId || ''; session.seatId = seat; ws.serializeAttachment(session);
        room.locked = true; room.started = true; room.gameStartedAt = Date.now(); room.warningSent = false; connected();
        emit('claim-seat-result', { success: true, playerId: seat, gameStarted: true }); all('game-started', { roomId: room.roomId }); state(); hist(); lobby(); break;
      }
      case 'swap-seats': {
        if (!host(p.deviceId)) { emit('action-error', { message: '仅房主可以交换座位' }); break; }
        const a = p.seatA, b = p.seatB;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || !room.seatTokens[a] || !room.seatTokens[b]) { emit('action-error', { message: '双方均已确认选座才能交换' }); break; }
        [room.seatTokens[a], room.seatTokens[b]] = [room.seatTokens[b], room.seatTokens[a]]; [room.seatNames[a], room.seatNames[b]] = [room.seatNames[b], room.seatNames[a]];
        [room.state.players[a].name, room.state.players[b].name] = [room.state.players[b].name, room.state.players[a].name]; [room.state.players[a].deviceId, room.state.players[b].deviceId] = [room.state.players[b].deviceId, room.state.players[a].deviceId];
        for (const client of this.ctx.getWebSockets()) { const s = client.deserializeAttachment() || {}; if (s.seatId === a) { s.seatId = b; client.serializeAttachment(s); this.send(client, 'seat-moved', { roomId: room.roomId, seatId: b }); } else if (s.seatId === b) { s.seatId = a; client.serializeAttachment(s); this.send(client, 'seat-moved', { roomId: room.roomId, seatId: a }); } }
        for (const member of Object.values(room.members)) { if (member.seatId === a) member.seatId = b; else if (member.seatId === b) member.seatId = a; }
        for (const stack of [room.history, room.redo]) for (const s of stack) if (s.players?.[a] && s.players?.[b]) { [s.players[a].name, s.players[b].name] = [s.players[b].name, s.players[a].name]; [s.players[a].deviceId, s.players[b].deviceId] = [s.players[b].deviceId, s.players[a].deviceId]; }
        state(); lobby(); break;
      }
      case 'move-member': {
        if (!host(p.deviceId)) { emit('action-error', { message: '仅房主可以调整成员座位' }); break; }
        if (room.locked || room.started) { emit('action-error', { message: '对局已开始，无法调整座位' }); break; }
        const from = p.fromSeat, to = p.toSeat; if (!Number.isInteger(from) || !Number.isInteger(to) || !room.seatTokens[from] || room.seatTokens[to] || !room.state.players[to]) break;
        const movedSockets = this.ctx.getWebSockets().filter(client => client.deserializeAttachment()?.seatId === from);
        const token = room.seatTokens[from], name = room.seatNames[from] || `选手 ${to + 1}`; release(from); room.seatTokens[to] = token; room.seatNames[to] = name;
        room.state.players[to].name = name; room.state.players[to].deviceId = token; if (room.members[token]) room.members[token].seatId = to;
        for (const client of movedSockets) { const s = client.deserializeAttachment() || {}; s.seatId = to; client.serializeAttachment(s); this.send(client, 'seat-moved', { roomId: room.roomId, seatId: to }); }
        for (const stack of [room.history, room.redo]) for (const s of stack) if (s.players?.[from] && s.players?.[to]) { s.players[from].name = `选手 ${from + 1}`; s.players[from].deviceId = `dev_seat_${from}`; s.players[to].name = name; s.players[to].deviceId = token; }
        state(); lobby(); break;
      }
      case 'kick-player': {
        if (!host(p.deviceId)) { emit('action-error', { message: '仅房主可以移除成员' }); break; }
        const seat = p.playerId, token = room.seatTokens[seat] || room.state.players[seat]?.deviceId;
        if (!room.state.players[seat] || token === p.deviceId) break;
        for (const client of this.ctx.getWebSockets()) if (client.deserializeAttachment()?.seatId === seat) this.send(client, 'kicked', { message: '您已被房主移出房间' });
        room.knownTokens = room.knownTokens.filter(x => x !== token); delete room.members[token]; release(seat); lobby(); state(); break;
      }
      case 'leave-room':
        if (session.seatId != null) release(session.seatId); delete room.members[session.token]; session.seatId = null; ws.serializeAttachment(session); state(); lobby(); break;
      case 'disband-room':
        if (!host(p.deviceId)) { emit('action-error', { message: '仅房主可以解散房间' }); break; }
        all('force-clear-seats'); all('room-disbanded', { message: '房间已被房主解散' }); emit('room-disbanded-host', { message: '房间已解散' }); await this.destroy(false); break;
      default: break;
    }
    if (this.room) { this.room.lastActivity = Date.now(); await this.save(); await this.schedule(); }
  }
  async webSocketClose(ws) {
    await this.ready; const session = ws.deserializeAttachment() || {};
    if (this.room && session.seatId != null) { this.room.state.connectedPlayers[session.seatId] = this.ctx.getWebSockets().some(client => client.deserializeAttachment()?.seatId === session.seatId); this.broadcast('state-updated', this.room.state); await this.save(); }
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  send(ws, event, ...args) { try { if (ws.readyState === WebSocket.OPEN) ws.send(packet(event, ...args)); } catch {} }
  broadcast(event, ...args) { for (const ws of this.ctx.getWebSockets()) this.send(ws, event, ...args); }
  async save() { if (this.room) await this.ctx.storage.put('room', this.room); }
  async touch() { if (this.room) { this.room.lastActivity = Date.now(); await this.save(); await this.schedule(); } }
  async schedule() {
    const r = this.room; if (!r) return;
    let due = r.state.isOver ? (r.finishedAt || r.lastActivity) + FINISHED_MS : (!r.locked && !r.started) ? r.lastActivity + IDLE_MS : (r.gameStartedAt || r.createdAt) + GAME_MS;
    if ((r.locked || r.started) && !r.state.isOver && !r.warningSent) due = Math.min(due, (r.gameStartedAt || r.createdAt) + 4 * 60 * 60_000);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, due));
  }
  async alarm() {
    await this.ready; const r = this.room; if (!r) return;
    const now = Date.now();
    if ((r.state.isOver && now >= (r.finishedAt || r.lastActivity) + FINISHED_MS) || (!r.locked && !r.started && now >= r.lastActivity + IDLE_MS) || ((r.locked || r.started) && now >= (r.gameStartedAt || r.createdAt) + GAME_MS)) return this.destroy();
    if ((r.locked || r.started) && !r.state.isOver && !r.warningSent && now >= (r.gameStartedAt || r.createdAt) + 4 * 60 * 60_000) {
      r.warningSent = true; const minutes = Math.max(1, Math.round(((r.gameStartedAt || r.createdAt) + GAME_MS - now) / 60_000));
      this.broadcast('game-time-warning', { roomId: r.roomId, remainingMinutes: minutes, message: `本局对局已进行 4 小时，剩余保留时间 ${minutes} 分钟，超时将自动解散房间，请尽快完成对局。` });
    }
    await this.save(); await this.schedule();
  }
  async destroy(notify = true) {
    const roomId = this.room?.roomId;
    if (notify) { this.broadcast('force-clear-seats'); this.broadcast('room-disbanded', { message: '房间已自动解散' }); }
    this.room = null; await this.ctx.storage.delete('room'); await this.ctx.storage.deleteAlarm();
    if (roomId) await this.env.HUB.get(this.env.HUB.idFromName('global')).fetch('https://hub.internal/remove', { method: 'POST', body: JSON.stringify({ roomId }) });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ws/')) {
      const roomId = decodeURIComponent(url.pathname.slice(4));
      if (roomId !== 'default' && !validRoom(roomId)) return new Response('Invalid room id', { status: 400 });
      const limited = await enforceRateLimit(request, env, 'WS_CONNECT_LIMITER', 'WebSocket 连接过于频繁，请稍后再试');
      if (limited) return limited;
      return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request);
    }
    const hub = env.HUB.get(env.HUB.idFromName('global'));
    if (url.pathname.startsWith('/api/')) {
      const bindingName = url.pathname === '/api/rooms/create' && request.method === 'POST'
        ? 'CREATE_ROOM_LIMITER'
        : url.pathname === '/api/feedback' && request.method === 'POST'
          ? 'FEEDBACK_RATE_LIMITER'
          : 'API_RATE_LIMITER';
      const limitMessage = bindingName === 'FEEDBACK_RATE_LIMITER'
        ? '建议提交过于频繁，请稍后再试'
        : '请求过于频繁，请稍后再试';
      const limited = await enforceRateLimit(request, env, bindingName, limitMessage);
      if (limited) return limited;
    }
    if (url.pathname === '/api/rooms/create' && request.method === 'POST') return hub.fetch('https://hub.internal/create', { method: 'POST', headers: { 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '' }, body: await request.text() });
    if (url.pathname === '/api/feedback') {
      if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed' }, 405, { allow: 'POST' });
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > 8192) return json({ success: false, message: '建议内容过长' }, 413);
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 8192) return json({ success: false, message: '建议内容过长' }, 413);
      return hub.fetch('https://hub.internal/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    }
    const verify = url.pathname.match(/^\/api\/rooms\/verify\/(\d{5})$/);
    if (verify) return hub.fetch(`https://hub.internal/verify/${verify[1]}`);
    if (url.pathname === '/api/health') return json({ status: 'ok', version: 'cloudflare-do', timestamp: Date.now(), multiRoomEnabled: true, activeFeatures: ['durable-objects', 'multi-room', 'websocket-hibernation'] });
    if (url.pathname === '/api/rooms') return hub.fetch('https://hub.internal/list');
    if (url.pathname === '/api/admin/status') return hub.fetch('https://hub.internal/status');
    if (url.pathname === '/admin') return new Response('<!doctype html><meta charset="utf-8"><title>麻将计分板管理</title><h1>Cloudflare Server Edition</h1><p>Durable Objects 多房间服务运行中。</p><pre id="status">读取状态中…</pre><script>fetch("/api/admin/status").then(r=>r.json()).then(d=>status.textContent=JSON.stringify(d,null,2))</script>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/') return Response.redirect(new URL('/home', url), 302);
    const isSpa = url.pathname === '/home' || /^\/\d{5}\/?$/.test(url.pathname);
    const assetRequest = isSpa ? new Request(new URL('/index.html', url), request) : request;
    const asset = await env.ASSETS.fetch(assetRequest);
    if (!isSpa || !asset.ok) return asset;
    const roomId = url.pathname.match(/^\/(\d{5})\/?$/)?.[1] || '';
    const html = (await asset.text()).replace('</head>', `<script>window.__TARGET_ENV__="server";window.__ROOM_ID__=${JSON.stringify(roomId)};</script></head>`);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
