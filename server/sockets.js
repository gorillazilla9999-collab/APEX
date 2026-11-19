// Socket layer. Multiplayer is intentionally not implemented yet:
// this only establishes the connection + latency check so rooms,
// state sync and race logic can be added here later.
export function registerSockets(io) {
  io.on('connection', (socket) => {
    socket.emit('server:hello', { id: socket.id, serverTime: Date.now() });
    socket.on('client:ping', (t, ack) => typeof ack === 'function' && ack(t));
  });
}
