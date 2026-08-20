/**
 * plugin-stack.js — carrega TODOS os plugins uma vez (sem lógica de task)
 * pathfinder, baritone, collectblock, pvp, tool, auto-eat, armor, builder
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

  // pathfinder (obrigatório para collect/builder)
  try {
    if (!bot.pathfinder) bot.loadPlugin(pathfinder);
    const mv = new Movements(bot);
    mv.canDig = true;
    mv.allowSprinting = true;
    mv.allowParkour = true;
    bot.pathfinder.setMovements(mv);
    console.log('[STACK] pathfinder');
  } catch (e) {
    console.warn('[STACK] pathfinder', e.message);
  }

  // mineflayer-baritone → bot.ashfinder
  try {
    if (!bot.ashfinder) {
      const baritone = require('@miner-org/mineflayer-baritone');
      const loader = baritone.loader || baritone.default?.loader || baritone;
      if (typeof loader === 'function') bot.loadPlugin(loader);
    }
    if (bot.ashfinder?.config) {
      bot.ashfinder.config.parkour = true;
      bot.ashfinder.config.swimming = true;
    }
    if (bot.ashfinder) console.log('[STACK] ashfinder/baritone');
  } catch (e) {
    console.warn('[STACK] baritone', String(e.message || e).slice(0, 50));
  }

  // collectblock
  try {
    const plug = collectBlockPlugin.plugin || collectBlockPlugin;
    if (!bot.collectBlock) bot.loadPlugin(plug);
    console.log('[STACK] collectblock');
  } catch (e) {
    console.warn('[STACK] collectblock', e.message);
  }

  // pvp
  try {
    const plug = pvpPlugin.plugin || pvpPlugin;
    if (!bot.pvp) bot.loadPlugin(plug);
    console.log('[STACK] pvp');
  } catch (e) {
    console.warn('[STACK] pvp', e.message);
  }

  // tool
  try {
    if (!bot.tool) {
      const tool = require('mineflayer-tool').plugin || require('mineflayer-tool');
      bot.loadPlugin(tool);
    }
    console.log('[STACK] tool');
  } catch (e) {
    console.warn('[STACK] tool', e.message);
  }

  // auto-eat
  try {
    if (!bot.autoEat) {
      const autoEat = require('mineflayer-auto-eat').loader || require('mineflayer-auto-eat').plugin || require('mineflayer-auto-eat');
      if (typeof autoEat === 'function') bot.loadPlugin(autoEat);
    }
    if (bot.autoEat) {
      bot.autoEat.options = bot.autoEat.options || {};
      bot.autoEat.options.priority = 'foodPoints';
      bot.autoEat.options.startAt = 14;
      bot.autoEat.options.bannedFood = [];
      if (typeof bot.autoEat.enable === 'function') bot.autoEat.enable();
      console.log('[STACK] auto-eat');
    }
  } catch (e) {
    console.warn('[STACK] auto-eat', String(e.message || e).slice(0, 50));
  }

  // armor-manager
  try {
    const armor = require('mineflayer-armor-manager');
    const plug = armor.default || armor;
    if (typeof plug === 'function') bot.loadPlugin(plug);
    console.log('[STACK] armor-manager');
  } catch (e) {
    console.warn('[STACK] armor', e.message);
  }

  // builder (precisa pathfinder já carregado)
  try {
    if (!bot.builder) {
      const { builder } = require('mineflayer-builder');
      if (typeof builder === 'function') bot.loadPlugin(builder);
    }
    if (bot.builder) console.log('[STACK] builder');
  } catch (e) {
    console.warn('[STACK] builder', String(e.message || e).slice(0, 50));
  }

  console.log('[STACK] all plugins load attempted');
}

export function startPluginStack(agent) {
  const bot = agent?.bot || agent;
  if (!bot) return;
  loadAllPlugins(bot);
}
