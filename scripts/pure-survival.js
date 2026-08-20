/**
 * pure-survival.js — stack completa, 1 ação por vez
 * Plugins via plugin-stack + ensure local
 * Prioridade: sobreviver > combate > abrigo noite > craft > coletar > explorar
 */

import pathfinderPkg from 'mineflayer-pathfinder';
const { goals: pfGoals, Movements, pathfinder } = pathfinderPkg;
import collectBlockPlugin from 'mineflayer-collectblock';
import pvpPlugin from 'mineflayer-pvp';
import { Vec3 } from 'vec3';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper',
  'spider', 'cave_spider', 'enderman', 'witch', 'phantom',
  'pillager', 'vindicator', 'evoker', 'ravager', 'warden',
  'blaze', 'ghast', 'piglin_brute', 'hoglin', 'zoglin',
]);

const WOOD_LOG = /_(log|stem)$/;
const ORE = /(iron|gold|diamond|coal|copper|lapis|redstone|emerald)_ore|deepslate_.*_ore/;
const FOOD = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function items(bot) {
  try { return bot.inventory.items(); } catch { return []; }
}

function countItem(bot, re) {
  return items(bot).filter((i) => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

function findItem(bot, re) {
  return items(bot).find((i) => re.test(i.name));
}

function ensurePlugins(bot) {
  // prefer full stack loader
  try {
    const { loadAllPlugins } = require('./plugin-stack.js');
    if (typeof loadAllPlugins === 'function') loadAllPlugins(bot);
  } catch {
    try {
      // dynamic import not sync — fallback inline
    } catch {}
  }

  try {
    if (!bot.pathfinder) bot.loadPlugin(pathfinder);
    const mv = new Movements(bot);
    mv.canDig = true;
    mv.allowSprinting = true;
    mv.allowParkour = true;
    bot.pathfinder.setMovements(mv);
  } catch (e) {
    console.warn('[PURE] pathfinder', e.message);
  }

  try {
    if (!bot.ashfinder) {
      const baritone = require('@miner-org/mineflayer-baritone');
      const loader = baritone.loader || baritone.default?.loader || baritone;
      if (typeof loader === 'function') {
        bot.loadPlugin(loader);
        console.log('[PURE] ashfinder ON');
      }
    }
    if (bot.ashfinder?.config) {
      bot.ashfinder.config.parkour = true;
      bot.ashfinder.config.swimming = true;
    }
  } catch (e) {
    console.warn('[PURE] baritone skip', String(e.message || e).slice(0, 50));
  }

  try {
    const plug = collectBlockPlugin.plugin || collectBlockPlugin;
    if (!bot.collectBlock) bot.loadPlugin(plug);
  } catch (e) {
    console.warn('[PURE] collectblock', e.message);
  }

  try {
    const plug = pvpPlugin.plugin || pvpPlugin;
    if (!bot.pvp) bot.loadPlugin(plug);
  } catch (e) {
    console.warn('[PURE] pvp', e.message);
  }

  try {
    if (!bot.tool) {
      const tool = require('mineflayer-tool').plugin || require('mineflayer-tool');
      bot.loadPlugin(tool);
    }
  } catch (e) {
    console.warn('[PURE] tool', e.message);
  }
}

function isPlayable(bot) {
  try {
    const gm = bot.game?.gameMode;
    if (gm === 'adventure' || gm === 'spectator') return false;
  } catch {}
  return true;
}

function isNight(bot) {
  try {
    const t = bot.time?.timeOfDay ?? bot.time?.age ?? 0;
    return t > 13000 && t < 23000;
  } catch {
    return false;
  }
}

async function gotoNear(bot, x, y, z, range = 2) {
  try {
    if (bot.ashfinder?.goto) {
      const baritone = require('@miner-org/mineflayer-baritone');
      const G = baritone.goals || {};
      if (G.GoalNear) {
        await bot.ashfinder.goto(new G.GoalNear(new Vec3(x, y, z), range));
        return true;
      }
      if (G.GoalExact) {
        await bot.ashfinder.goto(new G.GoalExact(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))));
        return true;
      }
    }
  } catch (e) {
    console.warn('[PURE] ashfinder', String(e.message || e).slice(0, 40));
  }
  try {
    await bot.pathfinder.goto(new pfGoals.GoalNear(x, y, z, range));
    return true;
  } catch {
    try {
      bot.pathfinder.setGoal(new pfGoals.GoalNear(x, y, z, range));
      await sleep(2500);
      bot.pathfinder.setGoal(null);
    } catch {}
    return false;
  }
}

async function stopNav(bot) {
  try { bot.pathfinder?.setGoal?.(null); } catch {}
  try { if (bot.ashfinder?.stop) await bot.ashfinder.stop(); } catch {}
}

async function doEat(bot) {
  const food = findItem(bot, FOOD);
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    if (typeof bot.consume === 'function') {
      await bot.consume();
    } else {
      bot.activateItem();
      await sleep(1600);
      try { bot.deactivateItem(); } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

async function doFight(bot, entity) {
  if (!entity || !bot.pvp) return false;
  try {
    await stopNav(bot);
    const sword = findItem(bot, /sword/);
    if (sword) await bot.equip(sword, 'hand');
    bot.pvp.attack(entity);
    await sleep(600);
    return true;
  } catch {
    return false;
  }
}

async function doCollect(bot, block) {
  if (!block) return false;
  try {
    if (bot.pvp?.target) { try { await bot.pvp.stop(); } catch {} }
    await stopNav(bot);
    if (bot.tool?.equipForBlock) {
      try { await bot.tool.equipForBlock(block); } catch {}
    }
    if (bot.collectBlock?.collect) {
      await bot.collectBlock.collect(block);
      return true;
    }
    await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2);
    const tool = findItem(bot, /_pickaxe|_axe|_shovel/);
    if (tool) await bot.equip(tool, 'hand');
    await bot.dig(block);
    return true;
  } catch (e) {
    console.warn('[PURE] collect', String(e.message || e).slice(0, 60));
    await stopNav(bot);
    return false;
  }
}

async function tryCraft(bot, itemName, qty = 1) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;
    const tableBlock = bot.findBlock({
      matching: mcData.blocksByName.crafting_table?.id,
      maxDistance: 16,
    });
    let recipes = bot.recipesFor(item.id, null, 1, tableBlock || null);
    if (!recipes?.length) recipes = bot.recipesFor(item.id, null, 1, true);
    if (!recipes?.length) return false;
    await bot.craft(recipes[0], qty, tableBlock || null);
    console.log('[PURE] craft', itemName, 'x' + qty);
    return true;
  } catch {
    return false;
  }
}

async function doCraftProgress(bot) {
  const logs = countItem(bot, WOOD_LOG);
  const planks = countItem(bot, /_planks$/);
  const sticks = countItem(bot, /^stick$/);
  const hasWoodPick = !!findItem(bot, /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const hasStonePick = !!findItem(bot, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const cobble = countItem(bot, /cobblestone|cobbled_deepslate/);
  const hasTable =
    countItem(bot, /^crafting_table$/) >= 1 ||
    !!bot.findBlock({ matching: (b) => b?.name === 'crafting_table', maxDistance: 12 });

  if (logs >= 1 && planks < 8) {
    for (const p of ['oak_planks','birch_planks','spruce_planks','jungle_planks','acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks']) {
      if (await tryCraft(bot, p, 4)) return true;
    }
  }
  if (planks >= 2 && sticks < 4) {
    if (await tryCraft(bot, 'stick', 4)) return true;
  }
  if (planks >= 4 && !hasTable) {
    if (await tryCraft(bot, 'crafting_table', 1)) return true;
  }
  if (planks >= 3 && sticks >= 2 && !hasWoodPick) {
    if (await tryCraft(bot, 'wooden_pickaxe', 1)) return true;
  }
  if (cobble >= 3 && sticks >= 2 && !hasStonePick && hasWoodPick) {
    if (await tryCraft(bot, 'stone_pickaxe', 1)) return true;
  }
  if (cobble >= 2 && sticks >= 1 && !findItem(bot, /_sword/)) {
    if (await tryCraft(bot, 'stone_sword', 1)) return true;
  }
  return false;
}

function pickCollectTarget(bot) {
  const woodCount = countItem(bot, WOOD_LOG);
  const cobble = countItem(bot, /cobblestone|^stone$/);
  const hasPick = !!findItem(bot, /_pickaxe/);

  if (woodCount < 16) {
    const log = bot.findBlock({
      matching: (b) => b && WOOD_LOG.test(b.name),
      maxDistance: 32,
    });
    if (log) return { block: log, reason: 'wood' };
  }
  if (hasPick && cobble < 32) {
    const stone = bot.findBlock({
      matching: (b) => b && /^(stone|cobblestone|deepslate|andesite|diorite|granite)$/.test(b.name),
      maxDistance: 24,
    });
    if (stone) return { block: stone, reason: 'stone' };
  }
  if (hasPick) {
    const ore = bot.findBlock({
      matching: (b) => b && ORE.test(b.name),
      maxDistance: 20,
    });
    if (ore) return { block: ore, reason: 'ore' };
  }
  return null;
}

async function doWander(bot) {
  const yaw = Math.random() * Math.PI * 2;
  const dist = 10 + Math.random() * 14;
  const x = bot.entity.position.x + Math.cos(yaw) * dist;
  const z = bot.entity.position.z + Math.sin(yaw) * dist;
  const y = bot.entity.position.y;
  try { await bot.look(yaw, 0, true); } catch {}
  await gotoNear(bot, x, y, z, 2);
}

async function humanIdle(bot) {
  try {
    const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.2;
    const pitch = (Math.random() - 0.5) * 0.4;
    await bot.look(yaw, pitch, true);
  } catch {}
}

export function startPureSurvival(agent) {
  const bot = agent?.bot || agent;
  if (!bot || bot._pureSurvival) return;
  bot._pureSurvival = true;

  ensurePlugins(bot);

  let busy = false;
  let lastDecision = 0;
  let lastShelter = 0;
  const DECISION_MS = 700;

  async function runOnce() {
    if (busy) return;
    if (!bot.entity) return;
    if (!isPlayable(bot)) return;

    busy = true;
    bot._dreamBusy = true;
    try {
      if (bot.food < 14 || bot.health < 12) {
        if (await doEat(bot)) return;
      }

      const enemy = bot.nearestEntity((e) => {
        if (!e?.position) return false;
        if (e.type === 'player') return false;
        const n = String(e.name || e.displayName || '').toLowerCase().replace(/\s+/g, '_');
        const host = HOSTILE.has(n) || e.type === 'hostile' || e.kind === 'Hostile mobs';
        if (!host) return false;
        return e.position.distanceTo(bot.entity.position) < 8;
      });
      if (enemy) {
        await doFight(bot, enemy);
        return;
      }
      if (bot.pvp?.target) {
        try { await bot.pvp.stop(); } catch {}
      }

      // abrigo à noite (no máximo 1x a cada 3 min)
      if (isNight(bot) && Date.now() - lastShelter > 180000) {
        if (typeof bot.dreamBuildShelter === 'function') {
          const ok = await bot.dreamBuildShelter();
          lastShelter = Date.now();
          if (ok) return;
        }
      }

      if (await doCraftProgress(bot)) return;

      const target = pickCollectTarget(bot);
      if (target?.block) {
        console.log('[PURE]', target.reason, target.block.name);
        await doCollect(bot, target.block);
        return;
      }

      await humanIdle(bot);
      await doWander(bot);
    } catch (e) {
      console.warn('[PURE]', String(e.message || e).slice(0, 80));
    } finally {
      busy = false;
      bot._dreamBusy = false;
    }
  }

  const timer = setInterval(() => {
    const now = Date.now();
    if (now - lastDecision < DECISION_MS) return;
    lastDecision = now;
    runOnce().catch(() => {});
  }, DECISION_MS);

  bot.once('end', () => clearInterval(timer));

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const m = String(message || '').trim().toLowerCase();
    if (m === 'pare' || m === 'stop') {
      stopNav(bot);
      try { bot.pvp?.stop?.(); } catch {}
      busy = false;
      bot._dreamBusy = false;
    }
    if (m === 'me siga' || m === 'follow') {
      const player = bot.players[username];
      if (player?.entity) {
        (async () => {
          busy = true;
          bot._dreamBusy = true;
          try {
            bot.pathfinder.setGoal(new pfGoals.GoalFollow(player.entity, 2), true);
          } catch {}
          await sleep(8000);
          busy = false;
          bot._dreamBusy = false;
        })();
      }
    }
    if (m === 'casa' || m === 'shelter') {
      (async () => {
        if (busy) return;
        busy = true;
        bot._dreamBusy = true;
        try {
          if (bot.dreamBuildShelter) await bot.dreamBuildShelter();
        } finally {
          busy = false;
          bot._dreamBusy = false;
        }
      })();
    }
  });

  console.log('[PURE] FULL stack — baritone + collect + pvp + tool + craft + shelter | 1 ação');
}
