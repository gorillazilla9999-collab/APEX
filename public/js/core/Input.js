const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export class Input {
  constructor() {
    this.keys = new Set(); this.handlers = {};
    addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) { this.keys.add(e.code); this.handlers[e.code]?.(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  /** Register a one-shot handler for a key press (e.g. Escape, KeyR). */
  onPress(code, fn) { this.handlers[code] = fn; }
  has(...codes) { return codes.some((c) => this.keys.has(c)); }
  get state() {
    return {
      throttle: this.has('KeyW', 'ArrowUp'), brake: this.has('KeyS', 'ArrowDown'),
      steer: (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: this.has('Space'), nitro: this.has('ShiftLeft', 'ShiftRight'),
    };
  }
}
