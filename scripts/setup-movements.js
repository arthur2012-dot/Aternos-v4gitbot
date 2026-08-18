/**
 * Called after agent spawn patches — injected via fetch-base into agent.js
 * This file documents the movement setup; actual inject is in fetch-base.
 */
export function setupDreamBotMovements(bot) {
  try {
    const { Movements } = require('mineflayer-pathfinder');
    const moves = new Movements(bot);
    moves.allowSprinting = true;
    moves.allowParkour = true;
    moves.allow1by1towers = true;
    moves.canDig = true;
    moves.canOpenDoors = true;
    moves.maxDropDown = 4;
    bot.pathfinder.setMovements(moves);
    console.log('[DreamBot] pathfinder: sprint+parkour+jump towers ON');
  } catch (e) {
    console.warn('[DreamBot] movements setup failed', e.message);
  }
}
