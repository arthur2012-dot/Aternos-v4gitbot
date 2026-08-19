/**
 * SAFE anti-freeze — uses same dig-out / tower logic, no random death sprint
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
      if (bot.targetDigBlock) return true;
    } catch {}
    return false;
  };

  const diggable = (b) => {
    if (!b || b.boundingBox !== 'block') return false;
    return !/bedrock|barrier|obsidian/.test(b.name || '');
  };

  const safeUnstuck = async () => {
    if (unlocking || !bot.entity) return;
    unlocking = true;
    console.log('[ANTI-FREEZE] dig-out / tower');
    try {
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);

      // Dig head / front / sides
      const blocks = [
        bot.blockAt(pos.offset(0, 1, 0)),
        bot.blockAt(pos.offset(0, 2, 0)),
        bot.blockAt(pos.offset(fx, 1, fz)),
        bot.blockAt(pos.offset(fx, 0, fz)),
        bot.blockAt(pos.offset(1, 0, 0)),
        bot.blockAt(pos.offset(-1, 0, 0)),
        bot.blockAt(pos.offset(0, 0, 1)),
        bot.blockAt(pos.offset(0, 0, -1)),
      ];
      for (const b of blocks) {
        if (!diggable(b)) continue;
        try {
          const items = bot.inventory.items();
          const tool =
            items.find(i => /_pickaxe$|_axe$|_shovel$/.test(i.name)) || null;
          if (tool) await bot.equip(tool, 'hand');
          await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true);
          await Promise.race([
            bot.dig(b, true),
            new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 4500)),
          ]);
          stillCount = 0;
          return;
        } catch {
          try { bot.stopDigging(); } catch {}
        }
      }

      // Tower with dirt/cobble
      const item = bot.inventory.items().find(i =>
        /dirt|cobblestone|stone|_planks|netherrack/.test(i.name)
      );
      if (item) {
        try {
          await bot.equip(item, 'hand');
          const ref = bot.blockAt(pos.offset(0, -1, 0));
          if (ref) {
            bot.setControlState('sneak', true);
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 100));
            const { Vec3 } = await import('vec3');
            await bot.placeBlock(ref, new Vec3(0, 1, 0));
          }
        } catch {}
        bot.clearControlStates();
        stillCount = 0;
        return;
      }

      try { await bot.look(yaw + Math.PI, 0, true); } catch {}
      bot.setControlState('jump', true);
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
      if (dx < 0.06 && dz < 0.06 && speed < 0.04) stillCount++;
      else stillCount = 0;
      // ~6s stuck
      if (stillCount >= 4) safeUnstuck();
    } catch {}
  }, 1500);

  console.log('[ANTI-FREEZE] SAFE dig-out/tower');
}
