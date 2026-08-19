/**
 * Anti-freeze SAFE — only unstuck when truly trapped.
 * NOT anti-AFK. Does NOT random-sprint into water/lava/cliffs.
 * Purposeful movement = passive-skills, not this module.
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
      // deep drop
      if ((!down || n(down) === 'air') && (!down2 || n(down2) === 'air')) return true;
      if (/water/.test(n(feet)) && /water/.test(n(down))) return true;
    } catch {}
    return false;
  };

  const safeUnstuck = async () => {
    if (unlocking || !bot.entity || isBusy()) return;
    unlocking = true;
    console.log('[ANTI-FREEZE] safe unstuck (not anti-AFK)');
    try {
      // 1) Prefer dig block trapping head/feet
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const candidates = [
        bot.blockAt(pos.offset(0, 1, 0)),
        bot.blockAt(pos.offset(fx, 1, fz)),
        bot.blockAt(pos.offset(fx, 0, fz)),
        bot.blockAt(pos.offset(0, 2, 0)),
      ];
      for (const b of candidates) {
        if (!b || b.boundingBox !== 'block') continue;
        if (/bedrock|barrier|obsidian/.test(b.name)) continue;
        try {
          await Promise.race([
            bot.dig(b),
            new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 3500)),
          ]);
          console.log('[ANTI-FREEZE] dug', b.name);
          stillCount = 0;
          return;
        } catch {
          try { bot.stopDigging(); } catch {}
        }
      }

      // 2) Turn around only (no long sprint)
      const newYaw = yaw + Math.PI; // 180°
      try {
        await bot.look(newYaw, 0, true);
      } catch {}

      if (dangerAhead()) {
        // step carefully one block, no jump into void
        bot.setControlState('sneak', true);
        bot.setControlState('back', true);
        await new Promise(r => setTimeout(r, 400));
        bot.clearControlStates();
        return;
      }

      // 3) Short hop forward only if safe
      bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 350));
      bot.clearControlStates();
    } catch (e) {
      console.warn('[ANTI-FREEZE]', e.message);
    } finally {
      unlocking = false;
      stillCount = 0;
    }
  };

  // Check every 1.5s — need ~9s truly still before acting
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

      // ~9 seconds frozen (6 * 1.5s)
      if (stillCount >= 6) safeUnstuck();
    } catch {}
  }, 1500);

  // NO periodic random nudge — that was the anti-AFK that almost killed him
  console.log('[DreamBot] anti-freeze SAFE (no random anti-AFK)');
}
