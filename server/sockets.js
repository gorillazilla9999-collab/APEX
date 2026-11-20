import { Rooms } from './rooms.js';

const TICK_MS = 50; // 20 Hz snapshots

export function registerSockets(io) {
  const rooms = new Rooms();

  io.on('connection', (socket) => {
    socket.emit('server:hello', { id: socket.id, serverTime: Date.now() });
    socket.on('client:ping', (t, ack) => typeof ack === 'function' && ack(t));

    socket.on('room:join', (req, ack) => {
      if (typeof ack !== 'function') return;
      const res = rooms.join(socket.id, req?.name, req?.room, Date.now(), req?.map, req?.car);
      if (res.error) return ack({ error: res.error });
      const prev = [...socket.rooms].filter((r) => r !== socket.id); prev.forEach((r) => socket.leave(r));
      socket.join(res.room.code);
      socket.to(res.room.code).emit('room:joined', { id: socket.id, name: res.player.name, slot: res.player.slot, color: res.player.color, car: res.player.car });
      ack({ id: socket.id, room: res.room.label, map: res.room.map, you: { slot: res.player.slot, color: res.player.color, name: res.player.name, car: res.player.car }, players: res.players });
    });

    const leave = () => {
      const room = rooms.leave(socket.id);
      if (room) { socket.leave(room.code); io.to(room.code).emit('room:left', { id: socket.id }); }
    };
    socket.on('room:leave', leave);
    socket.on('disconnect', leave);

    socket.on('player:state', (s) => rooms.update(socket.id, s));
  });

  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.rooms.values()) {
      if (room.players.size < 2) continue; // nobody to tell
      io.to(room.code).volatile.emit('room:snapshot', { t: now, players: rooms.snapshot(room, now) });
    }
  }, TICK_MS);
}
