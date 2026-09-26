/**
 * Multi-Room Engine (多房间容器隔离与房间治理)
 *
 * 可选项：仅在 server 模式且 `--multi-room` / ENABLE_MULTI_ROOM==='true' 时由 server.js 加载。
 * LAN 模式与默认 server 单房模式不加载本文件（零开销）。
 *
 * 职责：
 * 1. RoomStore：每房间一个容器 { roomId, state, historyStack, redoStack, socketToSeat }，
 *    惰性创建 + TTL 清扫（未开始房间自动销毁 / 已终局房间回收），全部为进程内存对象。
 * 2. 房间治理策略：
 *    - 房主（host）：首个 join-room 的设备 token（deviceId）成为房主；token 由前端 localStorage 缓存。
 *    - 锁房（locked）：对局开始（首次 update-state）后锁定，禁止新设备加入，仅已知 token 可重连/换座。
 *    - 踢人/解散：仅房主（按 token 鉴权，防止身份冒用）。
 * 3. 预留接口（env 可调，缺省即用）：
 *    - MULTI_ROOM_MAX_ROOMS               最大同时存在房间数（默认 200）
 *    - MULTI_ROOM_IDLE_DESTROY_MINUTES    未开局房间自动销毁时间（默认 5 分钟）
 *    - MULTI_ROOM_FINISHED_DESTROY_MINUTES 已终局房间保留时间（默认 5 分钟）
 *    - MULTI_ROOM_GAME_DESTROY_MINUTES    对局中房间最大保留时间（默认 300 分钟 / 5 小时）
 *    - MULTI_ROOM_GAME_WARNING_MINUTES   对局中剩余提醒时间（默认 60 分钟 / 1 小时）
 *    - MULTI_ROOM_SWEEP_INTERVAL_SECONDS  清扫周期（默认 60 秒）
 *
 * 依赖注入：server.js 传入 { getInitialState, onDestroy, onGameTimeWarning }；本文件不反向依赖宿主。
 */

function parseNumEnv(name, def) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

class RoomStore {
  constructor(deps = {}, opts = {}) {
    this.deps = deps;
    this.opts = {
      maxRooms: parseNumEnv('MULTI_ROOM_MAX_ROOMS', 200),
      idleDestroyMinutes: parseNumEnv('MULTI_ROOM_IDLE_DESTROY_MINUTES', 5),
      finishedDestroyMinutes: parseNumEnv('MULTI_ROOM_FINISHED_DESTROY_MINUTES', 5),
      gameDestroyMinutes: parseNumEnv('MULTI_ROOM_GAME_DESTROY_MINUTES', 300),
      gameWarningMinutes: parseNumEnv('MULTI_ROOM_GAME_WARNING_MINUTES', 60),
      sweepIntervalSeconds: parseNumEnv('MULTI_ROOM_SWEEP_INTERVAL_SECONDS', 60),
      logLimit: 200,
      ...opts
    };
    this.rooms = new Map();
  }

  isValidRoomId(id) {
    return /^\d{5}$/.test(String(id));
  }

  /**
   * 解析并惰性创建容器；'default' 与非法 roomId 归一到 'default' 容器。
   * 房间数达到上限时返回 null（调用方决定拒绝语义）。
   */
  resolve(roomId) {
    const id = this.isValidRoomId(roomId) ? String(roomId) : 'default';
    let room = this.rooms.get(id);
    if (!room) {
      if (id !== 'default' && this.rooms.size >= this.opts.maxRooms) return null;
      room = this.create(id);
    }
    room.lastActivity = Date.now();
    return room;
  }

  create(roomId, settings = null, gameMode = null) {
    const room = {
      roomId,
      state: this.deps.getInitialState ? this.deps.getInitialState(settings, gameMode) : null,
      historyStack: [],
      redoStack: [],
      socketToSeat: new Map(), // socket.id -> playerId (0-3)
      seatTokens: new Map(),   // playerId -> 身份 token（服务端权威，防客户端快照冲刷）
      seatNames: new Map(),    // playerId -> 显示名（服务端权威）
      hostDeviceId: null,      // 房主身份 token（deviceId，前端 localStorage 缓存）
      knownTokens: new Set(),  // 锁房前加入/入座玩家的 token 白名单（锁房后仅白名单可重连/选座）
      members: new Map(),      // token -> { seatId|null }（房间成员与其确认的席位）
      locked: false,           // 房主开始对局后锁定
      started: false,          // 对局是否已开始（game-started 已广播）
      createdAt: Date.now(),
      lastActivity: Date.now(),
      gameStartedAt: null,     // 对局开始时间戳
      finishedAt: null,        // 完场终局时间戳
      timeWarningEmitted: false // 是否已触发剩余 1 小时弹窗提醒
    };
    this.rooms.set(roomId, room);
    return room;
  }

  /** 房主绑定（服务端建房时由创建者 token 认定；优先于"首个加入者"兜底逻辑）。 */
  setHost(room, token) {
    if (token && room && !room.hostDeviceId) room.hostDeviceId = token;
  }

  /** 生成不与活跃房间冲突的 5 位房间号。 */
  generateUniqueRoomId() {
    let roomId;
    let attempts = 0;
    do {
      roomId = String(Math.floor(10000 + Math.random() * 90000));
      attempts++;
    } while (this.rooms.has(roomId) && attempts < 100);
    return roomId;
  }

  /** 房间 API 预建容器；达到上限返回 null。 */
  preload(roomId, settings = null, gameMode = null) {
    if (!this.isValidRoomId(roomId)) return null;
    if (this.rooms.has(roomId)) return this.rooms.get(roomId);
    if (this.rooms.size >= this.opts.maxRooms) return null;
    return this.create(String(roomId), settings, gameMode);
  }

  get(roomId) {
    return this.rooms.get(String(roomId)) || null;
  }

  has(roomId) {
    return this.rooms.has(String(roomId));
  }

  get count() {
    return this.rooms.size;
  }

  // ---- 房间治理（token 鉴权） ----

  isHostOf(room, deviceId) {
    return Boolean(deviceId && room.hostDeviceId && room.hostDeviceId === deviceId);
  }

  /** 首个 join-room 的设备成为房主（幂等）。 */
  claimHostIfNeeded(room, deviceId) {
    if (deviceId && !room.hostDeviceId) {
      room.hostDeviceId = deviceId;
      return true;
    }
    return false;
  }

  /** 记录成员 token（加入/入座时）。锁房后不再收录新 token。 */
  rememberToken(room, deviceId) {
    if (deviceId && !room.locked) room.knownTokens.add(deviceId);
  }

  isKnownToken(room, deviceId) {
    return Boolean(deviceId && room.knownTokens.has(deviceId));
  }

  /** 踢人后移除 token：锁定期间被踢者无法凭原 token 再加入。 */
  forgetToken(room, deviceId) {
    if (deviceId) room.knownTokens.delete(deviceId);
  }

  // ---- 房间成员（大厅阶段：加入 → 选座确认 → 房主开始对局） ----

  /** 加入房间即成为成员；重连时恢复其已确认席位。锁房后不再收录新成员。 */
  addMember(room, token) {
    if (!token) return;
    if (room.members.has(token)) return; // 重连：保留成员身份与已确认席位
    if (room.locked) return;             // 锁房后不再收录新成员
    let seatId = null;
    for (const [pid, t] of room.seatTokens) {
      if (t === token) { seatId = pid; break; }
    }
    room.members.set(token, { seatId });
  }

  setMemberSeat(room, token, seatId) {
    if (token && room.members.has(token)) room.members.get(token).seatId = seatId;
  }

  removeMember(room, token) {
    if (token) room.members.delete(token);
  }

  removeMemberByToken(room, token) {
    if (token) room.members.delete(token);
  }

  membersSnapshot(room) {
    return Array.from(room.members.entries()).map(([token, m]) => ({ token, seatId: m.seatId }));
  }

  unconfirmedMembers(room) {
    // 成员（不含房主——房主无需准备，开始对局时自动入座）
    return this.membersSnapshot(room).filter(m => m.token !== room.hostDeviceId && m.seatId === null);
  }

  /** 全员确认 = 除房主外每个成员都已确认席位（房主无需准备）。 */
  allConfirmed(room) {
    const members = this.membersSnapshot(room).filter(m => m.token !== room.hostDeviceId);
    return members.length > 0 && members.every(m => m.seatId !== null);
  }

  memberSeatOf(room, token) {
    const m = room.members.get(token);
    return m ? m.seatId : null;
  }

  swapMemberSeats(room, seatA, seatB) {
    for (const [, m] of room.members) {
      if (m.seatId === seatA) m.seatId = seatB;
      else if (m.seatId === seatB) m.seatId = seatA;
    }
  }

  /** 大厅阶段状态（不下发 token，保护身份隐私）。 */
  lobbyPayload(room) {
    return {
      roomId: room.roomId,
      locked: room.locked,
      started: room.started,
      confirmedSeatIds: [...room.seatTokens.keys()],
      members: this.membersSnapshot(room).map(m => ({ seatId: m.seatId, isHost: m.token === room.hostDeviceId })),
      allConfirmed: this.allConfirmed(room)
    };
  }

  /** 解散房间（房主 token 鉴权）。返回 { ok, reason? }。 */
  disband(roomId, deviceId) {
    const room = this.rooms.get(String(roomId));
    if (!room) return { ok: false, reason: '房间不存在或已解散' };
    if (!this.isHostOf(room, deviceId)) return { ok: false, reason: '仅房主可以解散房间' };
    this.destroy(roomId);
    return { ok: true };
  }

  /**
   * 释放容器内席位（不广播；调用方负责 state-updated）。
   * 同步清理历史与重做快照中的昵称/设备残留，并移除 socketToSeat 反向条目。
   */
  releaseSeat(room, seatIdx) {
    const defaultName = `选手 ${seatIdx + 1}`;
    const defaultDevId = `dev_seat_${seatIdx}`;
    room.state.connectedPlayers[seatIdx] = false;
    room.state.players[seatIdx].name = defaultName;
    room.state.players[seatIdx].deviceId = defaultDevId;
    if (room.seatTokens) room.seatTokens.delete(seatIdx);
    if (room.seatNames) room.seatNames.delete(seatIdx);
    room.historyStack.forEach(s => {
      if (s.players && s.players[seatIdx]) {
        s.players[seatIdx].name = defaultName;
        s.players[seatIdx].deviceId = defaultDevId;
      }
    });
    room.redoStack.forEach(s => {
      if (s.players && s.players[seatIdx]) {
        s.players[seatIdx].name = defaultName;
        s.players[seatIdx].deviceId = defaultDevId;
      }
    });
    for (const [sid, pid] of room.socketToSeat) {
      if (pid === seatIdx) room.socketToSeat.delete(sid);
    }
  }

  destroy(roomId) {
    this.rooms.delete(String(roomId));
  }

  listRooms() {
    return Array.from(this.rooms.values()).map(r => ({
      roomId: r.roomId,
      createdAt: r.createdAt,
      lastActivity: r.lastActivity,
      connectedSeats: r.state.connectedPlayers.filter(Boolean).length,
      locked: r.locked,
      isOver: r.state.isOver
    }));
  }

  /** 周期清扫：未开局 5 分钟、已终局 5 分钟、对局中 5 小时（剩余 1 小时弹窗提醒） */
  startSweep() {
    const timer = setInterval(() => this.sweep(), this.opts.sweepIntervalSeconds * 1000);
    if (timer.unref) timer.unref();
    return timer;
  }

  sweep() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (id === 'default') continue;

      // 1. 已终局房间：完场超过 finishedDestroyMinutes（默认 5 分钟）自动销毁
      if (room.state && room.state.isOver) {
        const finishedBase = room.finishedAt || room.lastActivity;
        const finishedMinutes = (now - finishedBase) / 60000;
        if (finishedMinutes >= this.opts.finishedDestroyMinutes) {
          this.destroy(id);
          if (this.deps.onDestroy) this.deps.onDestroy(room, 'finished-timeout');
          console.log(`[MULTI-ROOM] Room ${id} destroyed by sweep (finished timeout: ${finishedMinutes.toFixed(1)}min >= ${this.opts.finishedDestroyMinutes}min)`);
          continue;
        }
      }

      // 2. 未开局房间：未锁定/未开局且空闲超过 idleDestroyMinutes（默认 5 分钟）自动销毁
      if (!room.locked && !room.started) {
        const idleMinutes = (now - room.lastActivity) / 60000;
        if (idleMinutes >= this.opts.idleDestroyMinutes) {
          this.destroy(id);
          if (this.deps.onDestroy) this.deps.onDestroy(room, 'idle-timeout');
          console.log(`[MULTI-ROOM] Room ${id} destroyed by sweep (unstarted idle timeout: ${idleMinutes.toFixed(1)}min >= ${this.opts.idleDestroyMinutes}min)`);
          continue;
        }
      }

      // 3. 对局中房间：总时长限制（默认 5 小时 / 300 分钟），剩余 1 小时（<=60 分钟）弹窗提示
      if ((room.locked || room.started) && (!room.state || !room.state.isOver)) {
        const startBase = room.gameStartedAt || room.createdAt;
        const elapsedMinutes = (now - startBase) / 60000;
        const remainingMinutes = this.opts.gameDestroyMinutes - elapsedMinutes;

        // 剩余 <= 1 小时 (60 分钟) 且尚未发送过弹窗提示
        if (remainingMinutes <= this.opts.gameWarningMinutes && !room.timeWarningEmitted) {
          room.timeWarningEmitted = true;
          if (this.deps.onGameTimeWarning) {
            this.deps.onGameTimeWarning(room, Math.max(1, Math.round(remainingMinutes)));
          }
          console.log(`[MULTI-ROOM] Room ${id} game time warning triggered (elapsed=${elapsedMinutes.toFixed(1)}min, remaining=${remainingMinutes.toFixed(1)}min)`);
        }

        // 达到 5 小时上限，强制销毁房间
        if (elapsedMinutes >= this.opts.gameDestroyMinutes) {
          this.destroy(id);
          if (this.deps.onDestroy) this.deps.onDestroy(room, 'game-timeout');
          console.log(`[MULTI-ROOM] Room ${id} destroyed by sweep (game timeout: ${elapsedMinutes.toFixed(1)}min >= ${this.opts.gameDestroyMinutes}min)`);
          continue;
        }
      }
    }
  }
}

function createRoomStore(deps, opts) {
  return new RoomStore(deps, opts);
}

module.exports = { RoomStore, createRoomStore };
