# APEX DRIVE – 3D multiplayer racing

```
npm install
npm start      # http://localhost:3000  (open it in two tabs to test multiplayer)
npm test       # physics, room logic and socket wiring checks (no network needed)
```

**Controls:** W accelerate · S brake/reverse · A/D steer · SPACE handbrake · SHIFT nitro · R reset · M minimap · ESC pause

## Cars
Pick one with the **Car** button on the main menu (remembered; other players see your car's shape online).

| Car | Speed | Accel | Turn | Brake | Character |
|---|---|---|---|---|---|
| Apex GT | 6 | 6 | 6 | 6 | the all-rounder |
| Velocity | 9 | 5 | 6 | 5 | top speed, wins on the Speedway |
| Blaze | 5 | 8 | 6 | 4 | explosive launch, long stopping distance |
| Zenith | 5 | 5 | 9 | 3 | sharpest in corners, wins on Frostbite Pass |
| Bulldog | 6 | 6 | 6 | 8 | shortest stopping distance, very stable |
| Phantom | 7 | 5 | 7 | 5 | fast and nimble, soft on launch and brakes |

**Balance:** stat points are not equal-sum; instead `tests/cars.test.mjs` runs an AI driver through the real vehicle physics on every map and requires the mean lap times of all cars to stay within 1.2% of each other (currently about 0.6%). Each car is fastest somewhere and slowest somewhere else. `node tests/balance.mjs` prints the full lap-time table. To add a car, add an entry to `public/js/vehicle/cars.js`, then re-run the tests and nudge its stats until the spread is small.

## Maps
Pick one with the **Map** button on the main menu (your choice is remembered).

| Map | Length | Feel |
|---|---|---|
| Sunset Circuit | 2.0 km | the original golden-hour city loop |
| Neon Harbor | 1.9 km | night street circuit, container stacks, cranes, neon |
| Dune Canyon | 2.5 km | wide, fast desert sweepers, rocks and cacti |
| Frostbite Pass | 2.5 km | snowy mountain hairpins, fog, falling snow |
| Grand Speedway | 1.9 km | huge 22 m wide oval with grandstands |

**Minimap** (top-left): *Follow* (rotating, zooms out with speed), *Full track*, or off. Press **M**, click it, or use Settings.

**Adding a map:** add an entry to `public/js/world/maps.js` (control points + theme + props). The menu, minimap, server validation and `npm test` (track radius / self-clearance checks) pick it up automatically. New props go in `world/Scenery.js`.

## Multiplayer
Enter a driver name and an optional room code on the menu, then press Play. Everyone using the same code shares a track.
A room uses the map of whoever created it; joiners are switched to it. Blank code = the public room of the map you picked (each map has its own). Up to 12 drivers per room. Each client runs its own physics and sends its car state 20×/s;
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
- `public/js/vehicle/` – `cars.js` (car catalogue + stat→physics scaling, shared with the server), car mesh, `RemoteCar` (interpolated networked cars), smoke
- `public/js/world/` – `maps.js` (map catalogue, shared with the server), track, procedural scenery (`World.js`, `Scenery.js`), canvas textures
- `public/js/core/` – input, camera rig, audio, settings, UI, `Network` (join/leave/state sync, auto-rejoin), `Minimap.js` + `minimapMath.js`
- `public/js/main.js` – game loop and state machine (menu / playing / paused)
