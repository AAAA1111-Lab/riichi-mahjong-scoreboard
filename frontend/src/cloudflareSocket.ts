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
    if (event === 'join-room' && args[0]?.roomId && args[0].roomId !== this.roomId) {
      this.switchRoom(String(args[0].roomId));
      return this;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, args }));
      if (event === 'leave-room') {
        window.setTimeout(() => this.switchRoom('default'), 250);
      }
    } else if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.pending.push(JSON.stringify({ event, args }));
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
      this.dispatch('connect');
      for (const queued of this.pending.splice(0)) {
        if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) break;
        ws.send(queued);
      }
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

  private switchRoom(roomId: string) {
    if (this.roomId === roomId && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.roomId = roomId;
    this.manuallyClosed = true;
    this.pending = [];
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.manuallyClosed = false;
    this.retry = 0;
    this.connect();
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
