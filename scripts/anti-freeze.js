/**
 * Unstuck via pathfinder only — NEVER interrupts dig lock / active dig.
 */
export function startAntiFreeze(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamAntiFreeze) return;
  bot._dreamAntiFreeze = true;

  let still = 0;
  let lx = null, lz = null;

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      // respect dig lock + active dig + nav tree busy
      if (bot._digLocked || bot.targetDigBlock) {
        still = 0;
        return;
      }
      if (agent.actions?.executing) {
        still = 0;
        return;
      }
      if (bot.pathfinder?.isMoving?.() || bot._navBusy) {
        still = 0;
        return;
      }

      const x = bot.entity.position.x;
      const z = bot.entity.position.z;
      const v = bot.entity.velocity;
      const speed = Math.sqrt(v.x * v.x + v.z * v.z);

      if (lx != null && Math.abs(x - lx) < 0.05 && Math.abs(z - lz) < 0.05 && speed < 0.03) {
        still++;
      } else {
        still = 0;
      }
      lx = x;
      lz = z;

      if (still < 10) return; // ~15s — less aggressive
      still = 0;

      // walk FORWARD in current facing — no reverse spin
      console.log('[ANTI-FREEZE] nudge forward (no spin)');
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 600));
      bot.clearControlStates();
    } catch (e) {
      console.warn('[ANTI-FREEZE]', e.message);
    }
  }, 1500);

  console.log('[ANTI-FREEZE] dig-lock aware, no reverse turn');
}
