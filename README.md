# APEX DRIVE – 3D multiplayer racing

```
npm install
npm start      # http://localhost:3000  (open it in two tabs to test multiplayer)
npm test       # physics, room logic and socket wiring checks (no network needed)
```

**Controls:** W accelerate · S brake/reverse · A/D steer · SPACE handbrake · SHIFT nitro · R reset · ESC pause

## Multiplayer
Enter a driver name and an optional room code on the menu, then press Play. Everyone using the same code shares a track
(blank = the public room, up to 12 drivers per room). Each client runs its own physics and sends its car state 20×/s;
the server validates it, and broadcasts 20 snapshots/s per room. Remote cars are drawn ~120 ms in the past and interpolated.
Other cars are "ghosts" (no car-to-car collisions yet).

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render dashboard → **New → Blueprint** → pick the repo (it reads `render.yaml`).
   Or **New → Web Service** with Build `npm install`, Start `npm start`, Health check path `/healthz`.
3. Open the `https://<name>.onrender.com` URL. WebSockets work out of the box; no extra settings.

Free-tier services sleep after ~15 min idle, so the first visit can take 30-60 s to wake up.
Run a single instance: rooms live in server memory.

## Structure
- `server/` – Express static host, `rooms.js` (pure room/validation logic), `sockets.js` (Socket.IO wiring + 20 Hz snapshots)
- `public/js/physics/` – pure-JS vehicle model + collision (no Three.js, unit-testable)
- `public/js/vehicle/` – car mesh, `RemoteCar` (interpolated networked cars), smoke
- `public/js/world/` – track, procedural scenery, canvas textures
- `public/js/core/` – input, camera rig, audio, settings, UI, `Network` (join/leave/state sync, auto-rejoin)
- `public/js/main.js` – game loop and state machine (menu / playing / paused)
