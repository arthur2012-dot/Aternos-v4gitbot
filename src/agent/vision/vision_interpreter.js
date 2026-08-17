// DreamBot stub-friendly vision interpreter (no heavy viewer deps required)
import { Vec3 } from 'vec3';

export class VisionInterpreter {
  constructor(agent, allow_vision) {
    this.agent = agent;
    this.allow_vision = false; // force off on Railway
    this.fp = './bots/' + agent.name + '/screenshots/';
    this.camera = null;
    if (allow_vision) {
      console.log('[DreamBot] Vision requested but disabled in this deploy (no canvas/GPU).');
    }
  }

  async lookAtPlayer(player_name, direction) {
    return 'Vision is disabled. Use other methods to describe the environment.';
  }

  async lookAtPosition(x, y, z) {
    return 'Vision is disabled. Use other methods to describe the environment.';
  }

  getCenterBlockInfo() {
    try {
      const bot = this.agent.bot;
      const targetBlock = bot.blockAtCursor(128);
      if (targetBlock) {
        return `Block at center view: ${targetBlock.name} at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z})`;
      }
    } catch (e) {}
    return 'No block in center view';
  }

  async analyzeImage() {
    return 'Vision is disabled.';
  }
}
