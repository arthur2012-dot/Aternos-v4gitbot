/**
 * Anti-freeze — only when truly idle (NOT while pathing, digging, or acting).
 * Players nearby must NOT cancel tasks.
 */
export function startAntiFreeze(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamAntiFreeze) return;
  bot._dreamAntiFreeze = true;

  let lastX = null;
  let lastZ = null;
  let stillCount = 0;
  let unlocking = false;

  const isBusy = () => {
    try {
      if (bot._dreamPvpActive) return true;
      if (agent.actions?.executing) return true;
      if (bot.pathfinder?.isMoving?.()) return true;
      if (bot.targetDigBlock) return true;
      if (bot._navBusy) return true;
      if (agent._dreamLock && Date.now() < (agent._dreamLockUntil || 0)) return true;
    } catch {}
    return false;
  };

  const clearAll = () => {
    try {
      bot.clearControlStates();
    } catch {
      try {
        for (const c of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
          bot.setControlState(c, false);
        }
      } catch {}
    }
  };

  const forceMove = async (reason) => {
    if (unlocking || !bot.entity || isBusy()) return;
    unlocking = true;
    console.log('[ANTI-FREEZE]', reason);
    try {
      try { bot.ashfinder?.stop?.(); } catch {}
      try {
        bot.pathfinder?.setGoal?.(null);
        bot.pathfinder?.stop?.();
      } catch {}
      clearAll();

      const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 1.0 : -1.0);
      try {
        await bot.look(yaw, 0, true);
      } catch {}

      bot.setControlState('jump', true);
      bot.setControlState('sprint', true);
      bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 350));
      bot.setControlState('jump', false);
      await new Promise(r => setTimeout(r, 500));
      clearAll();

      try {
        const { goals } = require('mineflayer-pathfinder');
        const p = bot.entity.position;
        bot.pathfinder.setGoal(
          new goals.GoalNear(p.x + Math.sin(yaw) * 5, p.y, p.z + Math.cos(yaw) * 5, 1)
        );
      } catch {}
    } catch (e) {
      console.warn('[ANTI-FREEZE]', e.message);
    } finally {
      unlocking = false;
      stillCount = 0;
    }
  };

  setInterval(() => {
    try {
      if (!bot.entity) return;
      // Critical: do not interrupt real work
      if (isBusy()) {
        stillCount = 0;
        lastX = bot.entity.position.x;
        lastZ = bot.entity.position.z;
        return;
      }

      const x = bot.entity.position.x;
      const z = bot.entity.position.z;
      const v = bot.entity.velocity;
      const speed = Math.sqrt(v.x * v.x + v.z * v.z);

      if (lastX == null) {
        lastX = x;
        lastZ = z;
        return;
      }

      const dx = Math.abs(x - lastX);
      const dz = Math.abs(z - lastZ);
      lastX = x;
      lastZ = z;

      if (dx < 0.06 && dz < 0.06 && speed < 0.04) stillCount++;
      else stillCount = 0;

      // ~3.5s truly idle
      if (stillCount >= 5) forceMove('idle statue');
    } catch {}
  }, 700);

  console.log('[DreamBot] anti-freeze ON (skips while pathing/acting)');
}
