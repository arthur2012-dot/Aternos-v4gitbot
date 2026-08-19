/**
 * SAFE anti-freeze only — no random anti-AFK
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
      if (agent._passiveRunning) return true;
      if (bot.pathfinder?.isMoving?.()) return true;
      if (bot.targetDigBlock) return true;
    } catch {}
    return false;
  };

  const dangerAhead = () => {
    try {
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const feet = bot.blockAt(pos.offset(fx, 0, fz));
      const down = bot.blockAt(pos.offset(fx, -1, fz));
      const down2 = bot.blockAt(pos.offset(fx, -2, fz));
      const n = (b) => (b?.name || '');
      if (/lava|fire|magma/.test(n(feet)) || /lava|fire|magma/.test(n(down))) return true;
      if ((!down || n(down) === 'air') && (!down2 || n(down2) === 'air')) return true;
      if (/water/.test(n(feet)) && /water/.test(n(down))) return true;
    } catch {}
    return false;
  };

  const safeUnstuck = async () => {
    if (unlocking || !bot.entity || isBusy()) return;
    unlocking = true;
    console.log('[ANTI-FREEZE] safe unstuck');
    try {
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const candidates = [
        bot.blockAt(pos.offset(0, 1, 0)),
        bot.blockAt(pos.offset(fx, 1, fz)),
        bot.blockAt(pos.offset(fx, 0, fz)),
      ];
      for (const b of candidates) {
        if (!b || b.boundingBox !== 'block') continue;
        if (/bedrock|barrier|obsidian/.test(b.name)) continue;
        try {
          await Promise.race([
            bot.dig(b),
            new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 3500)),
          ]);
          stillCount = 0;
          return;
        } catch {
          try { bot.stopDigging(); } catch {}
        }
      }
      try { await bot.look(yaw + Math.PI, 0, true); } catch {}
      if (dangerAhead()) {
        bot.setControlState('sneak', true);
        bot.setControlState('back', true);
        await new Promise(r => setTimeout(r, 400));
        bot.clearControlStates();
        return;
      }
      bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 300));
      bot.clearControlStates();
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
      if (dx < 0.05 && dz < 0.05 && speed < 0.03) stillCount++;
      else stillCount = 0;
      if (stillCount >= 8) safeUnstuck(); // ~12s truly stuck
    } catch {}
  }, 1500);

  console.log('[ANTI-FREEZE] SAFE mode (no random AFK)');
}
