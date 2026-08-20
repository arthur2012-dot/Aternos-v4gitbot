/**
 * Pathfinder movements — dig ok, place/scaffolding OFF (no random dirt towers)
 */
import pathfinderPkg from 'mineflayer-pathfinder';
const { Movements } = pathfinderPkg;

export function setupDreamBotMovements(bot) {
  if (!bot?.pathfinder) return null;
  try {
    const mv = new Movements(bot);
    mv.canDig = true;
    mv.digCost = 1.2;
    mv.placeCost = 100;
    mv.liquidCost = 8;
    mv.allowSprinting = true;
    mv.allowParkour = true;
    mv.allow1by1towers = false;
    mv.canPlaceOn = new Set();
    mv.scaffoldingBlocks = [];
    mv.maxDropDown = 3;
    try {
      // don't dig chests/spawners
      const bad = ['chest', 'trapped_chest', 'spawner', 'bedrock', 'barrier'];
      for (const name of bad) {
        const b = bot.registry?.blocksByName?.[name];
        if (b) mv.blocksCantBreak.add(b.id);
      }
    } catch {}
    bot.pathfinder.setMovements(mv);
    console.log('[MOVE] dig=ON place/scaffold=OFF towers=OFF');
    return mv;
  } catch (e) {
    console.warn('[MOVE]', e.message);
    return null;
  }
}
