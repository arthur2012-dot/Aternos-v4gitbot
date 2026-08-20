/**
 * Carrega plugins 1x + Movements otimizados
 */
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements } = pathfinderPkg;
import collectBlockPlugin from 'mineflayer-collectblock';
import pvpPlugin from 'mineflayer-pvp';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export function loadAllPlugins(bot) {
  if (!bot || bot._pluginsLoaded) return;
  bot._pluginsLoaded = true;

  try {
    if (!bot.pathfinder) bot.loadPlugin(pathfinder);
    console.log('[STACK] pathfinder');
  } catch (e) {
    console.warn('[STACK] pathfinder', e.message);
  }

  // Movements bons (docs pathfinder)
  try {
    const { setupDreamBotMovements } = require('./setup-movements.js');
    if (typeof setupDreamBotMovements === 'function') setupDreamBotMovements(bot);
    else throw new Error('no setup');
  } catch {
    try {
      const mcData = require('minecraft-data')(bot.version);
      const mv = new Movements(bot, mcData);
      mv.canDig = true;
      mv.digCost = 1.4;
      mv.liquidCost = 8;
      mv.allowSprinting = true;
      mv.allowParkour = true;
      mv.maxDropDown = 3;
      bot.pathfinder.setMovements(mv);
      console.log('[STACK] movements fallback');
    } catch (e) {
      console.warn('[STACK] movements', e.message);
    }
  }

  try {
    if (!bot.ashfinder) {
      const baritone = require('@miner-org/mineflayer-baritone');
      const loader = baritone.loader || baritone.default?.loader || baritone;
      if (typeof loader === 'function') bot.loadPlugin(loader);
    }
    if (bot.ashfinder?.config) {
      bot.ashfinder.config.parkour = true;
      bot.ashfinder.config.swimming = true;
      bot.ashfinder.config.breakBlocks = true;
      bot.ashfinder.config.placeBlocks = true;
    }
    if (bot.ashfinder) console.log('[STACK] ashfinder');
  } catch (e) {
    console.warn('[STACK] baritone', String(e.message || e).slice(0, 50));
  }

  try {
    const plug = collectBlockPlugin.plugin || collectBlockPlugin;
    if (!bot.collectBlock) bot.loadPlugin(plug);
    console.log('[STACK] collectblock');
  } catch (e) {
    console.warn('[STACK] collectblock', e.message);
  }

  try {
    const plug = pvpPlugin.plugin || pvpPlugin;
    if (!bot.pvp) bot.loadPlugin(plug);
    console.log('[STACK] pvp');
  } catch (e) {
    console.warn('[STACK] pvp', e.message);
  }

  try {
    if (!bot.tool) {
      const tool = require('mineflayer-tool').plugin || require('mineflayer-tool');
      bot.loadPlugin(tool);
    }
    console.log('[STACK] tool');
  } catch (e) {
    console.warn('[STACK] tool', e.message);
  }

  try {
    if (!bot.autoEat) {
      const autoEat =
        require('mineflayer-auto-eat').loader ||
        require('mineflayer-auto-eat').plugin ||
        require('mineflayer-auto-eat');
      if (typeof autoEat === 'function') bot.loadPlugin(autoEat);
    }
    if (bot.autoEat) {
      bot.autoEat.options = bot.autoEat.options || {};
      bot.autoEat.options.priority = 'foodPoints';
      bot.autoEat.options.startAt = 14;
      if (typeof bot.autoEat.enable === 'function') bot.autoEat.enable();
      console.log('[STACK] auto-eat');
    }
  } catch (e) {
    console.warn('[STACK] auto-eat', String(e.message || e).slice(0, 50));
  }

  try {
    const armor = require('mineflayer-armor-manager');
    const plug = armor.default || armor;
    if (typeof plug === 'function') bot.loadPlugin(plug);
    console.log('[STACK] armor');
  } catch (e) {
    console.warn('[STACK] armor', e.message);
  }

  try {
    if (!bot.builder) {
      const { builder } = require('mineflayer-builder');
      if (typeof builder === 'function') bot.loadPlugin(builder);
    }
    if (bot.builder) console.log('[STACK] builder');
  } catch (e) {
    console.warn('[STACK] builder', String(e.message || e).slice(0, 50));
  }

  console.log('[STACK] load complete');
}

export function startPluginStack(agent) {
  const bot = agent?.bot || agent;
  if (!bot) return;
  loadAllPlugins(bot);
}
