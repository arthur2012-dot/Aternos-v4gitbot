/**
 * Unstuck via pathfinder/ash goto only — no custom dig war
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
      if (agent.actions?.executing) {
        still = 0;
        return;
      }
      if (bot.pathfinder?.isMoving?.()) {
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

      if (still < 8) return; // ~12s
      still = 0;
      console.log('[ANTI-FREEZE] pathfinder unstuck');

      const yaw = bot.entity.yaw + Math.PI;
      const tx = x - Math.sin(yaw) * 5;
      const tz = z - Math.cos(yaw) * 5;
      if (typeof bot.dreamGoto === 'function') {
        await bot.dreamGoto(tx, bot.entity.position.y, tz, 1);
      }
    } catch (e) {
      console.warn('[ANTI-FREEZE]', e.message);
    }
  }, 1500);

  console.log('[ANTI-FREEZE] pathfinder-only unstuck');
}
