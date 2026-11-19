import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { registerSockets } from './sockets.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Three.js is served straight from node_modules (importmap in index.html points here).
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.use(express.static(path.join(root, 'public')));

registerSockets(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`APEX DRIVE running at http://localhost:${PORT}`));
