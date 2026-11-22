import { Rooms } from './rooms.js';

const TICK_MS = 33; // 30 Hz snapshots
const RACE_EVERY = 5; // standings go out every 5th tick (~6 Hz)

export function registerSockets(io) {
  const rooms = new Rooms();
  const pushState = (room) => io.to(room.code).emit('room:state', rooms.roomState(room));
  const pushResults = (room) => io.to(room.code).emit('race:results', { rows: room.race.results || [] });

  io.on('connection', (socket) => {
    socket.emit('server:hello', { id: socket.id, serverTime: Date.now() });
    socket.on('client:ping', (t, ack) => typeof ack === 'function' && ack(t, Date.now()));

    socket.on('room:join', (req, ack) => {
      if (typeof ack !== 'function') return;
      const mode = ['host', 'join', 'public'].includes(req?.mode) ? req.mode : undefined;
      const res = rooms.join(socket.id, req?.name, req?.room, Date.now(), req?.map, req?.car, mode);
      if (res.error) return ack({ error: res.error });
      const prev = [...socket.rooms].filter((r) => r !== socket.id); prev.forEach((r) => socket.leave(r));
      socket.join(res.room.code);
      socket.to(res.room.code).emit('room:joined', { id: socket.id, name: res.player.name, slot: res.player.slot, color: res.player.color, car: res.player.car });
      pushState(res.room);
      ack({ id: socket.id, room: res.room.label, map: res.room.map, host: res.room.host, phase: res.room.race.phase, settings: res.room.race.settings,
        you: { slot: res.player.slot, color: res.player.color, name: res.player.name, car: res.player.car }, players: res.players });
    });

    const leave = () => {
      const room = rooms.leave(socket.id);
      if (!room) return;
      socket.leave(room.code); io.to(room.code).emit('room:left', { id: socket.id });
      if (rooms.rooms.has(room.code)) { pushState(room); if (room.race.phase === 'results' && room.race.results) pushResults(room); }
    };
    socket.on('room:leave', leave);
    socket.on('disconnect', leave);

    socket.on('player:state', (s) => rooms.update(socket.id, s));

    // ---- racing (host controls) ----
    const reply = (ack, res) => typeof ack === 'function' && ack(res.error ? { error: res.error } : { ok: true });
    socket.on('race:setup', (patch, ack) => { const r = rooms.setSettings(socket.id, patch); if (!r.error) pushState(r.room); reply(ack, r); });
    socket.on('race:car', (carId, ack) => { const r = rooms.setCar(socket.id, carId); if (!r.error) pushState(r.room); reply(ack, r); });
    socket.on('race:start', (_d, ack) => {
      const r = rooms.startRace(socket.id);
      if (!r.error) { io.to(r.room.code).emit('race:started', { goAt: r.goAt, serverNow: r.serverNow, grid: r.grid, settings: r.settings }); pushState(r.room); }
      reply(ack, r);
    });
    socket.on('race:lobby', (_d, ack) => { const r = rooms.toLobby(socket.id); if (!r.error) pushState(r.room); reply(ack, r); });
  });

  let n = 0;
  setInterval(() => {
    const now = Date.now(); n++;
    for (const { room, phase } of rooms.tickRaces(now)) { if (phase === 'results') pushResults(room); pushState(room); }
    for (const room of rooms.rooms.values()) {
      if (room.players.size >= 2) io.to(room.code).volatile.emit('room:snapshot', { t: now, players: rooms.snapshot(room, now) });
      // reliable on purpose: a volatile packet right after the snapshot is dropped by socket.io while the transport is still busy writing it
      if (n % RACE_EVERY === 0 && room.race.phase !== 'lobby') io.to(room.code).emit('race:tick', room.race.tickPayload(now));
    }
  }, TICK_MS);
}
