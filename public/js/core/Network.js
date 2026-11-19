/** Socket.IO client wrapper. Only connection + latency for now; multiplayer hooks go here later. */
export class Network {
  constructor(onStatus) {
    this.socket = null;
    if (typeof window.io === 'undefined') { onStatus({ online: false }); return; }
    this.socket = window.io();
    this.socket.on('connect', () => { onStatus({ online: true, ping: null }); this.ping(onStatus); });
    this.socket.on('disconnect', () => onStatus({ online: false }));
    setInterval(() => this.socket.connected && this.ping(onStatus), 4000);
  }
  ping(onStatus) {
    const t = performance.now();
    this.socket.emit('client:ping', t, () => onStatus({ online: true, ping: Math.round(performance.now() - t) }));
  }
}
