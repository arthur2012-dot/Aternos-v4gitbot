/**
 * Escape água/correnteza — NÃO place under feet while swimming (pathfinder #54)
 * Sobe + dig ceiling + anda pra terra
 */

import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function inWater(bot) {
  try {
    if (bot.entity.isInWater) return true;
    const feet = bot.blockAt(bot.entity.position.floored());
    const head = bot.blockAt(bot.entity.position.floored().offset(0, 1, 0));
    if (feet && /water|bubble_column|kelp/.test(feet.name)) return true;
    if (head && /water|bubble_column/.test(head.name)) return true;
  } catch {}
  return false;
}

export function isInWater(bot) {
  return inWater(bot);
}

export async function escapeWater(bot) {
  if (!bot?.entity || !inWater(bot)) return false;
  if (bot._waterEscaping) return false;
  bot._waterEscaping = true;
  console.log('[WATER] escaping y=' + bot.entity.position.y.toFixed(1));

  try {
    try {
      await bot.look(bot.entity.yaw, -Math.PI / 2, true);
    } catch {}
    bot.setControlState('jump', true);
    bot.setControlState('sprint', true);

    for (let i = 0; i < 30; i++) {
      if (!inWater(bot)) break;
      const p = bot.entity.position.floored();

      const above = bot.blockAt(p.offset(0, 2, 0)) || bot.blockAt(p.offset(0, 1, 0));
      if (above && above.boundingBox === 'block' && !/bedrock|barrier/.test(above.name || '')) {
        try {
          bot.setControlState('jump', false);
          const { digBlock } = await import('./dig-place.js');
          await digBlock(bot, above);
        } catch {
          try {
            await bot.dig(above, true);
          } catch {}
        }
        bot.setControlState('jump', true);
      }

      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
        const side = bot.blockAt(p.offset(dx, 0, dz));
        const sideUp = bot.blockAt(p.offset(dx, 1, dz));
        if (
          side &&
          side.boundingBox === 'block' &&
          !/water|lava/.test(side.name) &&
          (!sideUp || sideUp.name === 'air' || sideUp.boundingBox !== 'block')
        ) {
          try {
            await bot.lookAt(side.position.offset(0.5, 1.2, 0.5), true);
          } catch {}
          bot.setControlState('forward', true);
          await sleep(250);
          bot.setControlState('forward', false);
          break;
        }
      }
      await sleep(180);
    }

    bot.clearControlStates();

    if (inWater(bot) && bot.pathfinder) {
      try {
        const dry = bot.findBlock({
          matching: (b) => {
            if (!b || b.boundingBox !== 'block') return false;
            if (/water|lava|kelp|seagrass/.test(b.name)) return false;
            const up = bot.blockAt(b.position.offset(0, 1, 0));
            return !up || up.name === 'air' || up.boundingBox !== 'block';
          },
          maxDistance: 20,
        });
        if (dry) {
          bot.pathfinder.setGoal(
            new goals.GoalNear(dry.position.x, dry.position.y + 1, dry.position.z, 1)
          );
          await sleep(5000);
          bot.pathfinder.setGoal(null);
        }
      } catch {}
    }

    const ok = !inWater(bot);
    console.log('[WATER] done escaped=' + ok);
    return ok;
  } catch (e) {
    console.warn('[WATER]', String(e.message || e).slice(0, 50));
    return false;
  } finally {
    bot._waterEscaping = false;
    try {
      bot.clearControlStates();
    } catch {}
  }
}
