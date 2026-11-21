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

**Balance:** stat points are not equal-sum; instead `tests/cars.test.mjs` runs an AI driver through the real vehicle physics on every map and requires the mean lap times of all cars to stay within 1.2% of each other on the five original maps (currently about 0.6%). Across all 25 maps a looser 4% bound applies, because the near-straight layouts deliberately favour top speed (currently about 3%). Each car is fastest somewhere and slowest somewhere else. `node tests/balance.mjs` prints the full lap-time table. To add a car, add an entry to `public/js/vehicle/cars.js`, then re-run the tests and nudge its stats until the spread is small.

## Maps
Pick one with the **Map** button on the main menu (your choice is remembered).

| Map | Length | Feel |
|---|---|---|
| Sunset Circuit | 2.0 km | the original golden-hour city loop |
| Neon Harbor | 1.9 km | night street circuit, container stacks, cranes, neon |
| Dune Canyon | 2.5 km | wide, fast desert sweepers, rocks and cacti |
| Frostbite Pass | 2.5 km | snowy mountain hairpins, fog, falling snow |
| Grand Speedway | 1.9 km | huge 22 m wide oval with grandstands |
| Highway One | 2.1 km | barely any turns: two huge straights (*sunset* look) |
| Salt Flats | 2.7 km | barely any turns: enormous 26 m wide bowl (*dunes* look) |
| Glacier Oval | 2.0 km | barely any turns: wide frozen oval (*frost* look) |
| Dockside Drag | 2.3 km | barely any turns: long straights, one lazy kink each (*neon* look) |
| Tri-Oval | 2.6 km | barely any turns: wide rounded triangle (*speedway* look) |
| Coastal Sweep | 2.5 km | a few long, smooth curves (*sunset* look) |
| Teardrop Valley | 1.8 km | big sweeper into a tightening funnel (*dunes* look) |
| The D | 2.1 km | fast D shape, wiggle on the back straight (*speedway* look) |
| Downtown L | 2.1 km | L-shaped city blocks, hard 90s (*sunset* look) |
| Four Leaf | 2.9 km | four flowing lobes (*sunset* look) |
| Boomerang | 3.0 km | fast V with a tight elbow (*dunes* look) |
| Paperclip | 3.0 km | three straights joined by hairpins (*speedway* look) |
| Crosstown | 2.6 km | T-shaped street circuit, 8 corners (*neon* look) |
| Labyrinth | 3.4 km | street maze, nearly all corners (*neon* look) |
| Starburst | 2.5 km | five spiky points, ten bends (*neon* look) |
| Cobra | 3.2 km | snaking hairpin stack, long straight home (*dunes* look) |
| Avalanche Run | 2.3 km | diamond with two tight hairpins (*frost* look) |
| Fjord | 2.7 km | relentless twisty coast road (*frost* look) |
| Alpine Esses | 3.3 km | rows of S-bends (*frost* look) |
| Chicane Alley | 3.2 km | wall-to-wall chicanes (*speedway* look) |

The 20 newer maps reuse the five existing looks with brand-new track layouts; they range from near-straight ovals to turn-heavy mazes.

**Minimap** (top-left): *Follow* (rotating, zooms out with speed), *Full track*, or off. Press **M**, click it, or use Settings.

**Adding a map:** add an entry to `public/js/world/maps.js` (control points + theme + props). The menu, minimap, server validation and `npm test` (track radius / self-clearance checks) pick it up automatically. New props go in `world/Scenery.js`.

## Multiplayer
Enter a driver name and an optional room code on the menu, then press Play. Everyone using the same code shares a track.
A room uses the map of whoever created it; joiners are switched to it. Blank code = the public room of the map you picked (each map has its own). Up to 12 drivers per room. Each client runs its own physics and sends its car state 30×/s with a timestamp;
the server validates it, and broadcasts 30 snapshots/s per room. Remote cars are drawn ~100 ms in the past on the sender's own clock (no jitter), following a velocity-aware Hermite curve, and dead-reckon if packets are lost (`vehicle/NetBuffer.js`).
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


## Sound
All audio is synthesised (`public/js/core/Audio.js`, maths in `core/audioMath.js`): per-car engine voices (V10 scream, V8 burble, turbo four…), shift cuts, overrun crackle, turbo/blow-off, nitro, tyre squeal, road/gravel/wind, crashes, a small reverb, and positional engines (pan, distance, Doppler) for other players.

## Racing
- **Multiplayer Race → Host a race** creates a room you control (optional custom code, otherwise random). In the lobby the host sets the **map, laps (1–30), nitro on/off and max players**, then starts the race. Others use **Join room** with the code, or **Quick play** for the shared public room. Hosts hand over automatically if they leave.
- Everyone is placed on the grid, a 5-second countdown locks the controls, then the race starts at the same server-clock instant for all players.
- HUD: your **position (1st/8)**, lap counter, race timer, last/best lap, gap to the car ahead, a live standings list and a wrong-way warning. Crossing the line gives a finish banner; when the race ends (or 30 s after the winner finishes, the rest are DNF) a results table appears and the host sends everyone back to the lobby.
- **Solo Race** is the same thing offline against the clock.
- Rules run on the server (`public/js/race/RaceSession.js`, shared with the browser): laps are counted through ordered checkpoints, so cutting across the infield or reversing over the line never earns laps.
