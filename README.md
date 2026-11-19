# APEX DRIVE – 3D racing foundation

```
npm install
npm start      # http://localhost:3000
npm test       # headless physics/collision sanity checks
```

**Controls:** W accelerate · S brake/reverse · A/D steer · SPACE handbrake · SHIFT nitro · R reset · ESC pause

## Structure
- `server/` – Express static host + Socket.IO (connection/ping only, ready for multiplayer)
- `public/js/physics/` – pure-JS vehicle model + collision (no Three.js, unit-testable)
- `public/js/vehicle/` – car mesh, suspension visuals, smoke
- `public/js/world/` – track, procedural scenery, canvas textures
- `public/js/core/` – input, camera rig, audio, settings, UI, network
- `public/js/main.js` – game loop and state machine (menu / playing / paused)
