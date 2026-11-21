import { isMap, DEFAULT_MAP } from '../world/maps.js';

/**
 * Race rules, shared by the server (online rooms) and the browser (solo race). Pure logic: no sockets, no Three.js.
 * Phases: lobby -> countdown -> racing -> results -> lobby.
 * Progress is tracked on a loop of SECTORS checkpoints: a car only advances by entering the *next* sector, so cutting
 * across the infield or driving backwards can't earn laps. A lap = crossing the start line (sector K-1 -> 0).
 */
export const MAX_LAPS = 30, COUNTDOWN_MS = 5000, DNF_GRACE_MS = 30000, RACE_CAP_MS = 20 * 60 * 1000, RESULTS_MS = 60000, SECTORS = 12;
export const DEFAULT_SETTINGS = { map: DEFAULT_MAP, laps: 3, nitro: true, maxPlayers: 12 };

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
/** Validate a settings patch; unknown / invalid fields are ignored. */
export function cleanSettings(patch, prev = DEFAULT_SETTINGS) {
  const p = patch && typeof patch === 'object' ? patch : {}, out = { ...prev };
  if (isMap(p.map)) out.map = p.map;
  const laps = int(p.laps, 1, MAX_LAPS); if (laps !== null) out.laps = laps;
  const mp = int(p.maxPlayers, 2, 12); if (mp !== null) out.maxPlayers = mp;
  if (typeof p.nitro === 'boolean') out.nitro = p.nitro;
  return out;
}

/** Where grid slot `slot` sits (shared by client spawn + tests): rows 11 m apart behind the line, alternating sides. */
export function gridPose(track, slot = 0) {
  const gap = Math.max(1, Math.round(11 / track.ds)), n = track.n, i = (((-slot * gap) % n) + n) % n, off = slot % 2 ? 3.2 : -3.2;
  return { x: track.px[i] - track.tz[i] * off, z: track.pz[i] + track.tx[i] * off, heading: Math.atan2(track.tx[i], track.tz[i]), index: i };
}

const wrap = (d, n) => ((d + n / 2) % n + n) % n - n / 2; // signed shortest difference on a loop of n

export class RaceTracker {
  constructor(track, sectors = SECTORS) { this.t = track; this.K = sectors; this.sl = track.n / sectors; this.ready = false; this.crossings = 0; this.cp = 0; this.idx = 0; this.dist = 0; }
  _nearest(x, z, from, win) {
    const { n, px, pz } = this.t; let best = 1e18, bi = 0;
    if (from == null) { for (let i = 0; i < n; i++) { const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2; if (d < best) { best = d; bi = i; } } }
    else for (let k = -win; k <= win; k++) { const i = (from + k + n) % n, d = (px[i] - x) ** 2 + (pz[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    return { i: bi, d: Math.sqrt(best) };
  }
  sector(i) { return Math.min(this.K - 1, Math.floor(i / this.sl)); }
  /** Called on the grid: remember which sector we start in (the pole sits right on the line, so it starts "behind" it). */
  init(x, z) {
    const { i } = this._nearest(x, z, null), s = this.sector(i);
    this.idx = i; this.cp = i < this.t.n / 2 ? this.K - 1 : s; this.crossings = 0; this.ready = true;
  }
  /** Feed a car position. Returns 'lap' when the start line was crossed forwards. */
  update(x, z) {
    if (!this.ready) { this.init(x, z); return null; }
    const win = Math.ceil(120 / this.t.ds);
    let c = this._nearest(x, z, this.idx, win);
    if (c.d > 100) c = this._nearest(x, z, null);
    const s = this.sector(c.i), K = this.K; let ev = null;
    if (s === this.cp) this.idx = c.i;
    else if (s === (this.cp + 1) % K) { this.cp = s; this.idx = c.i; if (s === 0) { this.crossings++; ev = 'lap'; } }
    else if (s === (this.cp + K - 1) % K) { if (this.cp === 0) this.crossings--; this.cp = s; this.idx = c.i; }
    this.dist = c.d;
    return ev;
  }
  /** Distance driven in track samples (monotonic along the lap; used for ranking). */
  get score() { return (this.crossings - 1) * this.t.n + this.cp * this.sl + Math.max(0, wrap(this.idx - this.cp * this.sl, this.t.n)); }
}

export class RaceSession {
  /** trackFor(mapId) -> {n, ds, px, pz} */
  constructor(trackFor) { this.trackFor = trackFor; this.settings = { ...DEFAULT_SETTINGS }; this.reset(); }
  reset() { this.phase = 'lobby'; this.racers = new Map(); this.goAt = 0; this.finished = 0; this.firstFinish = 0; this.results = null; this.resultsAt = 0; }

  /** Lobby only. Returns true if anything changed. */
  setSettings(patch) {
    if (this.phase !== 'lobby') return false;
    const next = cleanSettings(patch, this.settings), changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    this.settings = next; return changed;
  }

  /** entries = [{id, name}] in grid order. Everyone starts together after the countdown. */
  start(entries, now) {
    if (this.phase !== 'lobby' || !entries.length) return null;
    const track = this.trackFor(this.settings.map), grid = {};
    this.racers = new Map(); this.finished = 0; this.firstFinish = 0; this.results = null;
    entries.forEach((e, i) => {
      grid[e.id] = i;
      this.racers.set(e.id, { id: e.id, name: e.name, tracker: new RaceTracker(track), lapStart: 0, lapTimes: [], best: null, last: null, finishMs: 0, place: 0, score: 0, speed: 0, dnf: false });
    });
    this.phase = 'countdown'; this.goAt = now + COUNTDOWN_MS; this.raceStart = this.goAt;
    return { goAt: this.goAt, grid, settings: this.settings };
  }

  /** A car position report. */
  update(id, x, z, speed, now) {
    const r = this.racers.get(id); if (!r) return;
    r.speed = speed;
    if (this.phase === 'countdown') { if (!r.tracker.ready) r.tracker.init(x, z); return; }
    if (this.phase !== 'racing' || r.finishMs) return;
    const ev = r.tracker.update(x, z); r.score = r.tracker.score;
    if (ev !== 'lap') return;
    const c = r.tracker.crossings;
    if (c === 1) { r.lapStart = now; return; }            // first crossing = start line, not a lap
    const lt = now - r.lapStart; r.lapStart = now; r.lapTimes.push(lt); r.last = lt; r.best = r.best == null ? lt : Math.min(r.best, lt);
    if (c - 1 >= this.settings.laps) { r.finishMs = now - this.raceStart; r.place = ++this.finished; if (!this.firstFinish) this.firstFinish = now; }
  }

  /** A driver left mid-race. */
  remove(id, now) { this.racers.delete(id); if (this.phase === 'racing' || this.phase === 'countdown') this._maybeEnd(now); }

  /** Advance the clock. Returns the new phase if it changed. */
  tick(now) {
    if (this.phase === 'countdown' && now >= this.goAt) { this.phase = 'racing'; return 'racing'; }
    if (this.phase === 'racing') return this._maybeEnd(now);
    if (this.phase === 'results' && now >= this.resultsAt) { this.toLobby(); return 'lobby'; }
    return null;
  }
  _maybeEnd(now) {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return null;
    const live = [...this.racers.values()].filter((r) => !r.finishMs);
    const timeout = this.phase === 'racing' && ((this.firstFinish && now - this.firstFinish > DNF_GRACE_MS) || now - this.raceStart > RACE_CAP_MS);
    if (live.length && !timeout) return null;
    if (!this.racers.size) { this.toLobby(); return 'lobby'; }
    this.phase = 'results'; this.resultsAt = now + RESULTS_MS;
    const rows = [...this.racers.values()];
    live.forEach((r) => { r.dnf = true; });
    rows.sort((a, b) => (a.finishMs && b.finishMs ? a.place - b.place : a.finishMs ? -1 : b.finishMs ? 1 : b.score - a.score));
    this.results = rows.map((r, i) => ({ id: r.id, name: r.name, place: i + 1, totalMs: r.finishMs || null, bestMs: r.best, laps: r.dnf ? Math.max(0, r.tracker.crossings - 1) : this.settings.laps, dnf: r.dnf }));
    return 'results';
  }
  toLobby() { this.phase = 'lobby'; this.racers = new Map(); this.results = null; this.goAt = 0; this.finished = 0; this.firstFinish = 0; }

  /** Live order: finishers first (by place), then by distance driven. */
  order() {
    return [...this.racers.values()].sort((a, b) => (a.finishMs && b.finishMs ? a.place - b.place : a.finishMs ? -1 : b.finishMs ? 1 : b.score - a.score));
  }
  /** Compact standings for the HUD: rows = [id, lapsDone, finishMs, gapSeconds, lastLapMs, bestLapMs] in rank order. */
  tickPayload(now) {
    const ord = this.order(), n = ord[0]?.tracker.t.n || 1, ds = ord[0]?.tracker.t.ds || 1;
    const rows = ord.map((r, i) => {
      const ahead = ord[i - 1], gap = !r.finishMs && ahead && !ahead.finishMs ? Math.max(0, ((ahead.score - r.score) * ds) / Math.max(r.speed, 10)) : null;
      return [r.id, r.finishMs ? this.settings.laps : Math.max(0, r.tracker.crossings - 1), r.finishMs, gap == null ? null : Math.round(gap * 10) / 10, r.last, r.best];
    });
    void n;
    return { ph: this.phase, t: this.phase === 'racing' || this.phase === 'results' ? Math.max(0, now - this.raceStart) : 0, rows };
  }
}
