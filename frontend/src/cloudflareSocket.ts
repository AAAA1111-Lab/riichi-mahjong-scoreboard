type Handler = (...args: any[]) => void;

/** Small Socket.IO-shaped client used only by the Cloudflare Workers build. */
export class CloudflareSocket {
  private listeners = new Map<string, Set<Handler>>();
  private pending: string[] = [];
  private ws: WebSocket | null = null;
  private roomId: string;
  private retry = 0;
  private retryTimer: number | undefined;
  private heartbeat: number | undefined;
  private manuallyClosed = false;
  private suppressNextJoinRoom: string | null = null;
  connected = false;

  constructor() {
    const match = window.location.pathname.match(/^\/(\d{5})\/?$/);
    this.roomId = match?.[1] || 'default';
    this.connect();
  }

  on(event: string, handler: Handler) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, set = new Set());
    set.add(handler);
    if (event === 'connect' && this.connected) queueMicrotask(handler);
    return this;
  }

  off(event: string, handler?: Handler) {
    if (!handler) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: any[]) {
    const serialized = JSON.stringify({ event, args });
    if (event === 'join-room' && args[0]?.roomId) {
      const targetRoomId = String(args[0].roomId);
      if (targetRoomId !== this.roomId) {
        // Changing the Durable Object URL is only half of joining: preserve the
        // join payload so the new room receives its device token after connect.
        this.switchRoom(targetRoomId, serialized);
        return this;
      }
      const signature = this.joinRoomSignature(args[0]);
      if (this.suppressNextJoinRoom === signature) {
        this.suppressNextJoinRoom = null;
        return this;
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);
      if (event === 'leave-room') {
        window.setTimeout(() => this.switchRoom('default'), 250);
      }
    } else if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.pending.push(serialized);
    }
    return this;
  }

  connect() {
    this.manuallyClosed = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return this;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${encodeURIComponent(this.roomId)}`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.connected = true;
      for (const queued of this.pending.splice(0)) {
        if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) break;
        ws.send(queued);
        try {
          const packet = JSON.parse(queued);
          if (packet?.event === 'join-room') {
            this.suppressNextJoinRoom = this.joinRoomSignature(packet.args?.[0]);
          }
        } catch {}
      }
      this.dispatch('connect');
      // The app's connect handler also requests the current room. If a queued
      // join already did that, suppress only this duplicate callback request.
      this.suppressNextJoinRoom = null;
      this.heartbeat = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: '__ping', args: [] }));
      }, 60_000);
    });
    ws.addEventListener('message', (message) => {
      if (this.ws !== ws) return;
      try {
        const packet = JSON.parse(String(message.data));
        if (packet?.event && packet.event !== '__pong') {
          this.dispatch(packet.event, ...(packet.args || []));
          if (['room-disbanded', 'room-disbanded-host', 'game-already-started', 'room-not-found', 'kicked'].includes(packet.event)) {
            this.switchRoom('default');
          }
        }
      } catch (error) {
        console.warn('Ignoring malformed room event', error);
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.dispatch('disconnect');
      if (!this.manuallyClosed) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => ws.close());
    return this;
  }

  disconnect() {
    this.manuallyClosed = true;
    this.pending = [];
    this.clearTimers();
    this.ws?.close();
    return this;
  }

  private switchRoom(roomId: string, joinPacket?: string) {
    if (this.roomId === roomId && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.roomId = roomId;
    this.manuallyClosed = true;
    this.pending = joinPacket ? [joinPacket] : [];
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.manuallyClosed = false;
    this.retry = 0;
    this.connect();
  }

  private joinRoomSignature(payload: any): string {
    return JSON.stringify([String(payload?.roomId ?? ''), String(payload?.deviceId ?? '')]);
  }

  private scheduleReconnect() {
    if (this.retryTimer !== undefined) return;
    const delay = Math.min(30_000, 800 * 2 ** Math.min(this.retry++, 6)) * (0.75 + Math.random() * 0.5);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearTimers() {
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat);
    this.retryTimer = undefined;
    this.heartbeat = undefined;
  }

  private dispatch(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach(handler => handler(...args));
  }
}

export function createCloudflareSocket() {
  return new CloudflareSocket();
}
