/**
 * Anti-freeze v7 — soft recovery only.
 * NEVER interrupts dig lock / active dig / pathfinder busy.
 * Inspired by Emergent Garden: nudge, don't seize control.
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

      // ~12-13s of near-zero movement before soft nudge
      if (still < 8) return;
      still = 0;

      console.log('[ANTI-FREEZE] soft forward nudge');
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      if (Math.random() < 0.55) bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 450 + Math.floor(Math.random() * 250)));
      bot.clearControlStates();

      // tiny random look so it doesn't feel robotic
      if (Math.random() < 0.4) {
        try {
          const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.7;
          await bot.look(yaw, bot.entity.pitch, true);
        } catch {}
      }
    } catch (e) {
      console.warn('[ANTI-FREEZE]', e.message);
    }
  }, 1600);

  console.log('[ANTI-FREEZE] v7 soft, dig-lock aware');
}
