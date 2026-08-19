/**
 * Anti-freeze — when bot stands still like a statue (common pathfinder hang).
 * Runs every 0.7s in passive + active.
 */
export function startAntiFreeze(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamAntiFreeze) return;
  bot._dreamAntiFreeze = true;

  let lastX = null;
  let lastZ = null;
  let stillCount = 0;
  let unlocking = false;

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
    if (unlocking || !bot.entity) return;
    unlocking = true;
    console.log('[ANTI-FREEZE]', reason);
    try {
      // Kill stuck path
      try { bot.ashfinder?.stop?.(); } catch {}
      try {
        bot.pathfinder?.setGoal?.(null);
        bot.pathfinder?.stop?.();
      } catch {}
      clearAll();

      const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 1.1 : -1.1);
      try {
        await bot.look(yaw, 0, true);
      } catch {}

      // Jump + sprint forward (breaks "standing still on block")
      bot.setControlState('jump', true);
      bot.setControlState('sprint', true);
      bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 400));
      bot.setControlState('jump', false);

      // Sometimes dig block in front if head/feet blocked
      try {
        const pos = bot.entity.position;
        const fx = -Math.sin(bot.entity.yaw);
        const fz = -Math.cos(bot.entity.yaw);
        const head = bot.blockAt(pos.offset(fx, 1, fz));
        const foot = bot.blockAt(pos.offset(fx, 0, fz));
        for (const b of [head, foot]) {
          if (b && b.boundingBox === 'block' && !/bedrock|barrier|obsidian/.test(b.name)) {
            try {
              await Promise.race([
                bot.dig(b),
                new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 3000)),
              ]);
            } catch {
              try { bot.stopDigging(); } catch {}
            }
            break;
          }
        }
      } catch {}

      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await new Promise(r => setTimeout(r, 600));
      clearAll();

      // Nudge pathfinder to a nearby point so he doesn't idle
      try {
        const { goals } = require('mineflayer-pathfinder');
        const p = bot.entity.position;
        const nx = p.x + Math.sin(yaw) * 6;
        const nz = p.z + Math.cos(yaw) * 6;
        bot.pathfinder.setGoal(new goals.GoalNear(nx, p.y, nz, 1));
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
      if (bot._dreamPvpActive) {
        stillCount = 0;
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

      // Almost no movement
      if (dx < 0.08 && dz < 0.08 && speed < 0.05) {
        stillCount++;
      } else {
        stillCount = 0;
      }

      // ~2.1s frozen (3 * 0.7s)
      if (stillCount >= 3) {
        forceMove('standing still');
      }
    } catch {}
  }, 700);

  // Hard kick every 12s if still somehow idle
  setInterval(() => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      const v = bot.entity.velocity;
      const speed = Math.sqrt(v.x * v.x + v.z * v.z);
      if (speed < 0.03) forceMove('periodic nudge');
    } catch {}
  }, 12000);

  console.log('[DreamBot] anti-freeze ON (breaks statue standstill)');
}
