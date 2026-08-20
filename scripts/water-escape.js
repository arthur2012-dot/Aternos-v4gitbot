/**
 * Escape de água / correnteza — sem place sob os pés enquanto nada
 * (pathfinder issue #54: place+jump na água trava)
 * Estratégia: nadar pra cima + dig do bloco acima se solid + sair pra terra
 */

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

export async function escapeWater(bot) {
  if (!bot?.entity || !inWater(bot)) return false;
  if (bot._waterEscaping) return false;
  bot._waterEscaping = true;

  console.log('[WATER] escaping y=' + bot.entity.position.y.toFixed(1));

  try {
    // 1) olhar pra cima e nadar
    try {
      await bot.look(bot.entity.yaw, -Math.PI / 2, true);
    } catch {}
    bot.setControlState('jump', true); // sobe na água
    bot.setControlState('sprint', true);

    for (let i = 0; i < 25; i++) {
      if (!inWater(bot)) break;

      const p = bot.entity.position.floored();
      // bloco sólido acima da cabeça → quebra (escada pra superfície)
      const above = bot.blockAt(p.offset(0, 2, 0)) || bot.blockAt(p.offset(0, 1, 0));
      if (above && above.boundingBox === 'block' && !/bedrock|barrier/.test(above.name || '')) {
        try {
          const { digBlock } = await import('./dig-place.js');
          bot.setControlState('jump', false);
          await digBlock(bot, above);
          bot.setControlState('jump', true);
        } catch {
          try {
            await bot.dig(above, true);
          } catch {}
        }
      }

      // tenta ir pra direção com terra
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const side = bot.blockAt(p.offset(dx, 0, dz));
        const sideUp = bot.blockAt(p.offset(dx, 1, dz));
        if (side && side.boundingBox === 'block' && (!sideUp || sideUp.boundingBox !== 'block')) {
          try {
            await bot.lookAt(side.position.offset(0.5, 1, 0.5), true);
          } catch {}
          bot.setControlState('forward', true);
          await sleep(200);
          bot.setControlState('forward', false);
          break;
        }
      }

      await sleep(200);
    }

    bot.clearControlStates();

    // 2) se ainda na água, path curto pra bloco seco
    if (inWater(bot) && bot.pathfinder) {
      try {
        const { goals } = require('mineflayer-pathfinder');
        const dry = bot.findBlock({
          matching: (b) =>
            b &&
            b.boundingBox === 'block' &&
            !/water|lava|kelp|seagrass/.test(b.name) &&
            bot.blockAt(b.position.offset(0, 1, 0))?.name === 'air',
          maxDistance: 16,
        });
        if (dry) {
          const { createRequire } = await import('module');
          // pathfinder GoalNear
          const pathfinder = await import('mineflayer-pathfinder');
          const g = pathfinder.goals || pathfinder.default?.goals;
          if (g?.GoalNear) {
            bot.pathfinder.setGoal(new g.GoalNear(dry.position.x, dry.position.y + 1, dry.position.z, 1));
            await sleep(4000);
            bot.pathfinder.setGoal(null);
          }
        }
      } catch {}
    }

    const ok = !inWater(bot);
    console.log('[WATER] done inWater=' + !ok);
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

export function isInWater(bot) {
  return inWater(bot);
}
