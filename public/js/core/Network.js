/** Socket.IO client wrapper: connection status, latency + server clock, room join/leave, race host actions, state send, event hooks. */
export class Network {
  constructor(onStatus) {
    this.socket = null; this.onStatus = onStatus; this.session = null; this.handlers = {};
    this.id = null; this.room = null; this.you = null; this.offset = 0; this._synced = false;
    if (typeof window.io === 'undefined') { onStatus({ online: false }); return; }
    this.socket = window.io({ transports: ['websocket', 'polling'] });
    const s = this.socket;
    s.on('connect', () => { this.id = s.id; onStatus({ online: true, ping: null }); this.ping(); this._rejoin(); });
    s.on('disconnect', () => { onStatus({ online: false }); this.emit('disconnected'); });
    for (const ev of ['room:joined', 'room:left', 'room:snapshot', 'room:state', 'race:started', 'race:tick', 'race:results']) s.on(ev, (d) => this.emit(ev, d));
    setInterval(() => s.connected && this.ping(), 4000);
  }
  get connected() { return !!this.socket?.connected; }
  get inRoom() { return !!this.session; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  emit(ev, d) { this.handlers[ev]?.(d); }
  /** Estimated server clock in ms (same scale as the server's Date.now()). */
  serverNow() { return Date.now() + this.offset; }
  ping() {
    const t = performance.now();
    this.socket.emit('client:ping', t, (_t, serverNow) => {
      const rtt = performance.now() - t;
      if (Number.isFinite(serverNow) && rtt < 1000) { // clock offset, assuming the reply took half the round trip; smoothed
        const o = serverNow + rtt / 2 - Date.now();
        this.offset = this._synced ? this.offset * 0.7 + o * 0.3 : o; this._synced = true;
      }
      this.onStatus({ online: true, ping: Math.round(rtt), transport: this.socket.io?.engine?.transport?.name });
    });
  }
  /**
   * mode: 'host' (create a room you control) | 'join' (existing room code) | 'public' (shared lobby for the map).
   * Resolves { id, room, map, host, phase, settings, you, players } or rejects with an error string.
   */
  join(name, room, map, car, mode) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject('OFFLINE');
      const t = setTimeout(() => reject('TIMEOUT'), 5000);
      this.socket.emit('room:join', { name, room, map, car, mode }, (res) => {
        clearTimeout(t);
        if (!res || res.error) return reject(res?.error || 'JOIN FAILED');
        // a dropped connection rejoins the *same* room by its code, never creating a new one
        this.session = { name, room: res.room === 'PUBLIC' ? '' : res.room, map: res.map || map, car, mode: res.room === 'PUBLIC' ? 'public' : 'join' };
        this.id = res.id; this.room = res.room; this.you = res.you;
        resolve(res);
      });
    });
  }
  /** After a dropped connection the server forgot us: join again and let the game resync. */
  _rejoin() {
    if (!this.session) return;
    const s = this.session;
    this.join(s.name, s.room, s.map, s.car, s.mode).then((res) => this.emit('rejoined', res), () => { this.session = null; this.emit('kicked'); });
  }
  leave() { this.session = null; this.room = null; if (this.connected) this.socket.emit('room:leave'); }
  sendState(s) { if (this.connected && this.session) this.socket.volatile.emit('player:state', s); }
  // host actions (the server ignores them from anyone else)
  setup(patch) { this.socket?.emit('race:setup', patch, () => {}); }
  setCar(id) { if (this.session) this.session.car = id; this.socket?.emit('race:car', id, () => {}); }
  startRace() { this.socket?.emit('race:start', null, () => {}); }
  toLobby() { this.socket?.emit('race:lobby', null, () => {}); }
}
