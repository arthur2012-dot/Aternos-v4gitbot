/**
 * Pathfinder Movements otimizado (docs pathfinder + baritone practices)
 * - canDig + digCost moderado (prefere contornar se barato)
 * - liquidCost alto (evita água)
 * - scaffolding dirt/cobble
 * - maxDropDown seguro
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export function setupDreamBotMovements(bot) {
  if (!bot?.pathfinder) return false;
  try {
    const { Movements } = require('mineflayer-pathfinder');
    const mcData = require('minecraft-data')(bot.version);
    const moves = new Movements(bot, mcData);

    moves.canDig = true;
    moves.digCost = 1.4;
    moves.placeCost = 1.3;
    moves.liquidCost = 8;
    moves.entityCost = 1.5;
    moves.maxDropDown = 3;
    moves.allowSprinting = true;
    moves.allowParkour = true;
    moves.allow1by1towers = true;
    moves.dontCreateFlow = true;
    moves.dontMineUnderFallingBlock = true;

    // scaffolding preferidos
    try {
      const names = ['dirt', 'cobblestone', 'netherrack', 'cobbled_deepslate', 'stone'];
      for (const n of names) {
        const id = mcData.itemsByName[n]?.id;
        if (id != null && !moves.scafoldingBlocks.includes(id)) {
          moves.scafoldingBlocks.push(id);
        }
      }
    } catch {}

    // não quebrar baús / spawners / portal
    try {
      for (const n of ['chest', 'trapped_chest', 'spawner', 'ender_chest', 'bedrock', 'barrier']) {
        const b = mcData.blocksByName[n];
        if (b) moves.blocksCantBreak.add(b.id);
      }
    } catch {}

    bot.pathfinder.setMovements(moves);
    bot.pathfinder.thinkTimeout = 8000;
    console.log('[MOVE] pathfinder: dig+sprint+parkour liquidCost=8 maxDrop=3');
    return true;
  } catch (e) {
    console.warn('[MOVE] setup failed', e.message);
    return false;
  }
}

export default setupDreamBotMovements;
