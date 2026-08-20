/**
 * Anti-freeze v8 — soft recovery only.
 * NEVER interrupts dig lock / active dig / pathfinder busy.
 * No random look: just forward nudge (direction decided by pure-survival Openness Scorer).
 */
export function startAntiFreeze(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamAntiFreeze) return;
  bot._dreamAntiFreeze = true;

  let still = 0;
  let lx = null, lz = null;

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive || bot._dreamBusy || bot._escapeBusy) return;
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

      if (lx != null && Math.abs(x - lx) < 0.06 && Math.abs(z - lz) < 0.06 && speed < 0.04) {
        still++;
      } else {
        still = 0;
      }
      lx = x;
      lz = z;

      if (still < 8) return;
      still = 0;

      console.log('[ANTI-FREEZE] soft forward nudge');
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      if (bot.entity.onGround) bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 500));
      bot.clearControlStates();
    } catch (e) {
      console.warn('[ANTI-FREEZE]', e.message);
    }
  }, 1600);

  console.log('[ANTI-FREEZE] v8 soft, no random look');
}
