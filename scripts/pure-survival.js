/**
 * pure-survival v5 — ÚNICO cérebro de survival
 * - 1 ação por vez
 * - NUNCA place de terra aleatório
 * - Progressão fixa: madeira → tábuas → sticks → mesa → picareta → pedra
 * - Sem pathfinder scaffolding (não coloca bloco no caminho)
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
  'pillager', 'vindicator', 'blaze', 'ghast', 'hoglin',
]);

const WOOD_LOG = /_(log|stem)$/;
const FOOD = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function race(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, j) => {
        t = setTimeout(() => j(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function items(bot) {
  try {
    return bot.inventory.items();
  } catch {
    return [];
  }
}

function countItem(bot, re) {
  return items(bot)
    .filter((i) => re.test(i.name))
    .reduce((a, i) => a + i.count, 0);
}

function findItem(bot, re) {
  return items(bot).find((i) => re.test(i.name));
}

function ensurePlugins(bot) {
  try {
    if (!bot.pathfinder) bot.loadPlugin(pathfinder);
    const mv = new Movements(bot);
    mv.canDig = true;
    mv.digCost = 1.2;
    mv.placeCost = 100; // quase proíbe place no path
    mv.liquidCost = 8;
    mv.allowSprinting = true;
    mv.allowParkour = true;
    mv.allow1by1towers = false; // NÃO torre de terra no path
    mv.canPlaceOn = new Set(); // sem scaffolding
    mv.scaffoldingBlocks = [];
    mv.maxDropDown = 3;
    bot.pathfinder.setMovements(mv);
  } catch (e) {
    console.warn('[PURE] pathfinder', e.message);
  }
  try {
    const plug = collectBlockPlugin.plugin || collectBlockPlugin;
    if (!bot.collectBlock) bot.loadPlugin(plug);
  } catch {}
  try {
    const plug = pvpPlugin.plugin || pvpPlugin;
    if (!bot.pvp) bot.loadPlugin(plug);
  } catch {}
  try {
    if (!bot.tool) {
      const tool = require('mineflayer-tool').plugin || require('mineflayer-tool');
      bot.loadPlugin(tool);
    }
  } catch {}
}

function isPlayable(bot) {
  try {
    const gm = bot.game?.gameMode;
    if (gm === 'adventure' || gm === 'spectator') return false;
  } catch {}
  return true;
}

async function stopNav(bot) {
  try {
    bot.pathfinder?.setGoal?.(null);
  } catch {}
  try {
    bot.clearControlStates?.();
  } catch {}
}

async function gotoNear(bot, x, y, z, range = 2) {
  try {
    await race(bot.pathfinder.goto(new pfGoals.GoalNear(x, y, z, range)), 18000);
    return true;
  } catch {
    try {
      bot.pathfinder.setGoal(new pfGoals.GoalNear(x, y, z, range));
      await sleep(3000);
      bot.pathfinder.setGoal(null);
    } catch {}
    return false;
  }
}

async function doEat(bot) {
  const food = findItem(bot, FOOD);
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    if (typeof bot.consume === 'function') await bot.consume();
    else {
      bot.activateItem();
      await sleep(1600);
      try {
        bot.deactivateItem();
      } catch {}
    }
    console.log('[PURE] ate', food.name);
    return true;
  } catch {
    return false;
  }
}

async function doFight(bot, entity) {
  if (!entity || !bot.pvp) return false;
  try {
    await stopNav(bot);
    const sword = findItem(bot, /sword|_axe$/);
    if (sword) await bot.equip(sword, 'hand');
    bot.pvp.attack(entity);
    await sleep(800);
    return true;
  } catch {
    return false;
  }
}

/** Dig HOLD real — 1 bloco, sem place */
async function digBlock(bot, block) {
  if (!block) return false;
  try {
    await stopNav(bot);
    if (bot.tool?.equipForBlock) {
      try {
        await bot.tool.equipForBlock(block);
      } catch {}
    } else {
      const tool =
        findItem(bot, /_pickaxe/) ||
        findItem(bot, /_axe/) ||
        findItem(bot, /_shovel/);
      if (tool) await bot.equip(tool, 'hand');
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block, true), 12000);
    console.log('[PURE] dug', block.name);
    return true;
  } catch (e) {
    try {
      bot.stopDigging();
    } catch {}
    console.warn('[PURE] dig fail', String(e.message || e).slice(0, 40));
    return false;
  }
}

async function doCollect(bot, block) {
  if (!block) return false;
  try {
    if (bot.pvp?.target) {
      try {
        await bot.pvp.stop();
      } catch {}
    }
    await stopNav(bot);
    // Prefer collectBlock plugin (path + dig + pickup) once
    if (bot.collectBlock?.collect) {
      try {
        await race(bot.collectBlock.collect(block), 25000);
        console.log('[PURE] collectBlock', block.name);
        return true;
      } catch (e) {
        console.warn('[PURE] collectBlock fail', String(e.message || e).slice(0, 40));
      }
    }
    await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2);
    return await digBlock(bot, bot.blockAt(block.position) || block);
  } catch (e) {
    await stopNav(bot);
    return false;
  }
}

async function placeCraftingTable(bot) {
  const tableItem = findItem(bot, /^crafting_table$/);
  if (!tableItem) return false;
  const already = bot.findBlock({
    matching: (b) => b?.name === 'crafting_table',
    maxDistance: 16,
  });
  if (already) return true;
  try {
    await bot.equip(tableItem, 'hand');
    const feet = bot.entity.position.floored();
    // ground under / in front
    const candidates = [
      feet.offset(0, -1, 0),
      feet.offset(1, -1, 0),
      feet.offset(-1, -1, 0),
      feet.offset(0, -1, 1),
      feet.offset(0, -1, -1),
    ];
    for (const pos of candidates) {
      const ref = bot.blockAt(pos);
      if (!ref || ref.boundingBox !== 'block') continue;
      const above = bot.blockAt(pos.offset(0, 1, 0));
      if (above && above.name !== 'air') continue;
      await bot.lookAt(pos.offset(0.5, 1.05, 0.5), true);
      await bot.placeBlock(ref, new Vec3(0, 1, 0));
      console.log('[PURE] placed crafting_table');
      await sleep(400);
      return true;
    }
  } catch (e) {
    console.warn('[PURE] place table', String(e.message || e).slice(0, 40));
  }
  return false;
}

async function tryCraft(bot, itemName, qty = 1) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;

    // 2x2 recipes don't need table; 3x3 need table nearby
    let tableBlock = bot.findBlock({
      matching: mcData.blocksByName.crafting_table?.id,
      maxDistance: 16,
    });

    if (!tableBlock && findItem(bot, /^crafting_table$/)) {
      await placeCraftingTable(bot);
      tableBlock = bot.findBlock({
        matching: mcData.blocksByName.crafting_table?.id,
        maxDistance: 16,
      });
    }

    let recipes = bot.recipesFor(item.id, null, 1, tableBlock || null);
    if (!recipes?.length) recipes = bot.recipesFor(item.id, null, 1, true);
    if (!recipes?.length) {
      console.log('[PURE] no recipe', itemName);
      return false;
    }
    await bot.craft(recipes[0], qty, tableBlock || null);
    console.log('[PURE] CRAFT OK', itemName, 'x' + qty);
    if (itemName === 'crafting_table') await placeCraftingTable(bot);
    return true;
  } catch (e) {
    console.warn('[PURE] craft fail', itemName, String(e.message || e).slice(0, 40));
    return false;
  }
}

/**
 * Stage machine — only advances when inventory proves it
 */
function getStage(bot) {
  const logs = countItem(bot, WOOD_LOG);
  const planks = countItem(bot, /_planks$/);
  const sticks = countItem(bot, /^stick$/);
  const hasWoodPick = !!findItem(bot, /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const hasStonePick = !!findItem(bot, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const cobble = countItem(bot, /cobblestone|cobbled_deepslate/);
  const hasTable =
    countItem(bot, /^crafting_table$/) >= 1 ||
    !!bot.findBlock({ matching: (b) => b?.name === 'crafting_table', maxDistance: 16 });

  if (logs < 5 && planks < 12) return 'wood';
  if (planks < 12) return 'planks';
  if (sticks < 4) return 'sticks';
  if (!hasTable) return 'table';
  if (!hasWoodPick) return 'wood_pick';
  if (cobble < 12 && !hasStonePick) return 'stone';
  if (!hasStonePick) return 'stone_pick';
  if (!findItem(bot, /_sword/)) return 'sword';
  return 'explore';
}

async function runStage(bot, stage) {
  console.log('[PURE] STAGE', stage, 'y=' + bot.entity.position.y.toFixed(0));

  switch (stage) {
    case 'wood': {
      const log = bot.findBlock({
        matching: (b) => b && WOOD_LOG.test(b.name),
        maxDistance: 48,
      });
      if (log) {
        console.log('[PURE] target log', log.name, log.position);
        return await doCollect(bot, log);
      }
      // walk toward higher ground / random to find trees
      const yaw = Math.random() * Math.PI * 2;
      const x = bot.entity.position.x + Math.cos(yaw) * 16;
      const z = bot.entity.position.z + Math.sin(yaw) * 16;
      await gotoNear(bot, x, bot.entity.position.y, z, 2);
      return true;
    }
    case 'planks': {
      for (const p of [
        'oak_planks',
        'birch_planks',
        'spruce_planks',
        'jungle_planks',
        'acacia_planks',
        'dark_oak_planks',
        'mangrove_planks',
        'cherry_planks',
      ]) {
        if (await tryCraft(bot, p, 4)) return true;
      }
      return false;
    }
    case 'sticks':
      return await tryCraft(bot, 'stick', 4);
    case 'table':
      return await tryCraft(bot, 'crafting_table', 1);
    case 'wood_pick':
      return await tryCraft(bot, 'wooden_pickaxe', 1);
    case 'stone': {
      const stone = bot.findBlock({
        matching: (b) =>
          b && /^(stone|cobblestone|deepslate|andesite|diorite|granite)$/.test(b.name),
        maxDistance: 32,
      });
      if (stone) {
        console.log('[PURE] target stone', stone.name);
        return await doCollect(bot, stone);
      }
      // dig down one if on dirt with stone under? skip — wander
      const yaw = Math.random() * Math.PI * 2;
      await gotoNear(
        bot,
        bot.entity.position.x + Math.cos(yaw) * 12,
        bot.entity.position.y,
        bot.entity.position.z + Math.sin(yaw) * 12,
        2
      );
      return true;
    }
    case 'stone_pick':
      return await tryCraft(bot, 'stone_pickaxe', 1);
    case 'sword':
      return (
        (await tryCraft(bot, 'stone_sword', 1)) || (await tryCraft(bot, 'wooden_sword', 1))
      );
    case 'explore': {
      // ore if pick ready
      const hasPick = !!findItem(bot, /_pickaxe/);
      if (hasPick) {
        const ore = bot.findBlock({
          matching: (b) =>
            b && /(iron|coal|copper|gold|diamond)_ore|deepslate_.*_ore/.test(b.name),
          maxDistance: 24,
        });
        if (ore) return await doCollect(bot, ore);
      }
      const yaw = Math.random() * Math.PI * 2;
      await gotoNear(
        bot,
        bot.entity.position.x + Math.cos(yaw) * 14,
        bot.entity.position.y,
        bot.entity.position.z + Math.sin(yaw) * 14,
        2
      );
      return true;
    }
    default:
      return false;
  }
}

/** Toss excess dirt — never farm dirt */
async function tossJunk(bot) {
  const dirt = items(bot).find((i) => /^(dirt|grass_block|coarse_dirt)$/.test(i.name));
  if (dirt && dirt.count > 16) {
    try {
      await bot.toss(dirt.type, null, Math.min(dirt.count - 16, 32));
      console.log('[PURE] tossed dirt');
    } catch {}
  }
}

export function startPureSurvival(agent) {
  const bot = agent?.bot || agent;
  if (!bot || bot._pureSurvival) return;
  bot._pureSurvival = true;
  bot._dreamPureOnly = true; // signal other loops to stay quiet

  ensurePlugins(bot);

  let busy = false;
  let lastDecision = 0;
  const DECISION_MS = 1200;

  async function runOnce() {
    if (busy) return;
    if (!bot.entity) return;
    if (!isPlayable(bot)) {
      console.log('[PURE] not playable (adventure/spectator?)');
      return;
    }

    busy = true;
    bot._dreamBusy = true;
    try {
      // 1) eat
      if (bot.food < 14 || bot.health < 12) {
        if (await doEat(bot)) return;
      }

      // 2) fight hostiles only
      const enemy = bot.nearestEntity((e) => {
        if (!e?.position || e.type === 'player') return false;
        const n = String(e.name || e.displayName || '')
          .toLowerCase()
          .replace(/\s+/g, '_');
        if (!HOSTILE.has(n) && e.type !== 'hostile') return false;
        return e.position.distanceTo(bot.entity.position) < 8;
      });
      if (enemy) {
        await doFight(bot, enemy);
        return;
      }
      if (bot.pvp?.target) {
        try {
          await bot.pvp.stop();
        } catch {}
      }

      await tossJunk(bot);

      // 3) stage progression — NO random dig/place
      const stage = getStage(bot);
      await runStage(bot, stage);
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

  // first tick soon
  setTimeout(() => runOnce().catch(() => {}), 2000);

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const m = String(message || '')
      .trim()
      .toLowerCase();
    if (m === 'pare' || m === 'stop') {
      stopNav(bot);
      try {
        bot.pvp?.stop?.();
      } catch {}
      busy = false;
      bot._dreamBusy = false;
    }
    if (m === 'me siga' || m === 'follow') {
      const player = bot.players[username];
      if (player?.entity) {
        try {
          bot.pathfinder.setGoal(new pfGoals.GoalFollow(player.entity, 2), true);
        } catch {}
      }
    }
  });

  console.log('[PURE] v5 ON — stages wood→pick→stone | NO random place | 1 action');
}
