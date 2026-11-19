/** Socket.IO client wrapper: connection status, latency, room join/leave, state send, event hooks. */
export class Network {
  constructor(onStatus) {
    this.socket = null; this.onStatus = onStatus; this.session = null; this.handlers = {};
    this.id = null; this.room = null; this.you = null;
    if (typeof window.io === 'undefined') { onStatus({ online: false }); return; }
    this.socket = window.io({ transports: ['websocket', 'polling'] });
    const s = this.socket;
    s.on('connect', () => { this.id = s.id; onStatus({ online: true, ping: null }); this.ping(); this._rejoin(); });
    s.on('disconnect', () => { onStatus({ online: false }); this.emit('disconnected'); });
    for (const ev of ['room:joined', 'room:left', 'room:snapshot']) s.on(ev, (d) => this.emit(ev, d));
    setInterval(() => s.connected && this.ping(), 4000);
  }
  get connected() { return !!this.socket?.connected; }
  get inRoom() { return !!this.session; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  emit(ev, d) { this.handlers[ev]?.(d); }
  ping() {
    const t = performance.now();
    this.socket.emit('client:ping', t, () => this.onStatus({ online: true, ping: Math.round(performance.now() - t) }));
  }
  /** Resolves { id, room, you, players } or rejects with an error string. */
  join(name, room) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject('OFFLINE');
      const t = setTimeout(() => reject('TIMEOUT'), 5000);
      this.socket.emit('room:join', { name, room }, (res) => {
        clearTimeout(t);
        if (!res || res.error) return reject(res?.error || 'JOIN FAILED');
        this.session = { name, room }; this.id = res.id; this.room = res.room; this.you = res.you;
        resolve(res);
      });
    });
  }
  /** After a dropped connection the server forgot us: join again and let the game resync. */
  _rejoin() {
    if (!this.session) return;
    this.join(this.session.name, this.session.room).then((res) => this.emit('rejoined', res), () => { this.session = null; this.emit('kicked'); });
  }
  leave() { this.session = null; this.room = null; if (this.connected) this.socket.emit('room:leave'); }
  sendState(s) { if (this.connected && this.session) this.socket.volatile.emit('player:state', s); }
}
