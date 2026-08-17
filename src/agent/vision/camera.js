// DreamBot stub: no prismarine-viewer / canvas on Railway
import { EventEmitter } from 'events';

export class Camera extends EventEmitter {
  constructor(bot, fp) {
    super();
    this.bot = bot;
    this.fp = fp;
    this.disabled = true;
    setImmediate(() => this.emit('ready'));
  }

  async capture() {
    console.log('[DreamBot] Camera capture skipped (vision disabled).');
    return null;
  }
}
