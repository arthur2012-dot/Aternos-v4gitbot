/**
 * MINDCRAFT-CORE — one clean action loop (no competing systems)
 * Inspired by mindcraft skills: collectBlock, dig, craft, pathfinder only.
 * Does NOT random-break walls. Only digs for progression targets.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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

function inv(bot) {
  try {
    return bot.inventory.items();
  } catch {
    return [];
  }
}

function count(items, re) {
  const r = typeof re === 'string' ? new RegExp('^' + re + '$') : re;
  return items.filter((i) => r.test(i.name)).reduce((s, i) => s + i.count, 0);
}

function has(items, re) {
  const r = typeof re === 'string' ? new RegExp(re) : re;
  return items.some((i) => r.test(i.name));
}

function busy(bot) {
  return !!(bot._digLocked || bot._dreamPvpActive || bot._mcCoreBusy || bot.targetDigBlock);
}

async function gotoNear(bot, x, y, z, range = 2) {
  try {
    if (typeof bot.dreamGoto === 'function') {
      await race(bot.dreamGoto(x, y, z, range), 20000);
      return true;
    }
  } catch {}
  try {
    const { goals, Movements } = require('mineflayer-pathfinder');
    if (bot.pathfinder) {
      const mcData = require('minecraft-data')(bot.version);
      const mov = new Movements(bot, mcData);
      mov.canDig = false; // path without random mining
      bot.pathfinder.setMovements(mov);
      await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)), 20000);
      return true;
    }
  } catch {}
  return false;
}

async function digOne(bot, block) {
  if (!block || busy(bot)) return false;
  try {
    const { digBlock } = await import('./dig-place.js');
    return await digBlock(bot, block, { maxMs: 20000, retries: 4 });
  } catch {
    try {
      if (bot.tool?.equipForBlock) await bot.tool.equipForBlock(block, { requireHarvest: false });
      await race(bot.dig(block, true), 18000);
      return true;
    } catch {
      try {
        bot.stopDigging();
      } catch {}
      return false;
    }
  }
}

async function collectType(bot, names, howMany = 1) {
  const set = new Set(names);
  let got = 0;
  for (let i = 0; i < howMany; i++) {
    if (busy(bot)) break;
    const block = bot.findBlock({
      matching: (b) => b && set.has(b.name),
      maxDistance: 32,
    });
    if (!block) break;

    // Mindcraft path: collectBlock plugin first
    try {
      if (bot.collectBlock?.collect) {
        await race(bot.collectBlock.collect(block, { ignoreNoPath: true }), 40000);
        got++;
        console.log('[MC] collectBlock', block.name);
        continue;
      }
    } catch (e) {
      console.warn('[MC] collect fail', (e.message || '').slice(0, 40));
    }

    await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2);
    const live = bot.blockAt(block.position);
    if (live && live.name !== 'air') {
      if (await digOne(bot, live)) got++;
    }
  }
  return got > 0;
}

async function craft(bot, itemName, qty = 1) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;
    let table = bot.findBlock({
      matching: mcData.blocksByName.crafting_table?.id,
      maxDistance: 16,
    });
    let recipes = bot.recipesFor(item.id, null, 1, null);
    if (!recipes.length && table) {
      if (bot.entity.position.distanceTo(table.position) > 3) {
        await gotoNear(bot, table.position.x, table.position.y, table.position.z, 2);
      }
      recipes = bot.recipesFor(item.id, null, 1, table);
    }
    if (!recipes.length) {
      recipes = bot.recipesFor(item.id, null, 1, true);
    }
    if (!recipes.length) return false;
    await race(bot.craft(recipes[0], qty, table || null), 12000);
    console.log('[MC] craft', itemName);
    return true;
  } catch (e) {
    console.warn('[MC] craft', itemName, (e.message || '').slice(0, 30));
    return false;
  }
}

async function eat(bot) {
  if (bot.food >= 15) return false;
  const food = inv(bot).find((i) =>
    /beef|pork|chicken|mutton|bread|apple|carrot|potato|cod|salmon|cooked_/.test(i.name)
  );
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log('[MC] eat', food.name);
    return true;
  } catch {
    return false;
  }
}

async function hunt(bot) {
  const prey = Object.values(bot.entities).find(
    (e) =>
      e !== bot.entity &&
      e.position &&
      e.position.distanceTo(bot.entity.position) < 16 &&
      /cow|pig|sheep|chicken/.test(e.name || '')
  );
  if (!prey) return false;
  const sword = inv(bot).find((i) => /_sword$|_axe$/.test(i.name));
  if (sword) {
    try {
      await bot.equip(sword, 'hand');
    } catch {}
  }
  await gotoNear(bot, prey.position.x, prey.position.y, prey.position.z, 2);
  for (let i = 0; i < 10; i++) {
    const live = bot.entities[prey.id];
    if (!live) break;
    try {
      await bot.lookAt(live.position.offset(0, 1, 0), true);
      await bot.attack(live);
    } catch {}
    await sleep(400);
  }
  return true;
}

/** Next goal like Mindcraft curriculum — only dig what we need */
function nextGoal(bot) {
  const items = inv(bot);
  if (count(items, /_log$/) < 5 && count(items, /_planks$/) < 8)
    return { kind: 'collect', names: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'], n: 4, label: 'wood' };
  if (count(items, /_planks$/) < 8)
    return { kind: 'craft', item: 'oak_planks', n: 4, label: 'planks' };
  if (count(items, 'stick') < 4 && !has(items, /_pickaxe/))
    return { kind: 'craft', item: 'stick', n: 4, label: 'sticks' };
  if (count(items, 'crafting_table') < 1)
    return { kind: 'craft', item: 'crafting_table', n: 1, label: 'table' };
  if (!has(items, /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/))
    return { kind: 'craft', item: 'wooden_pickaxe', n: 1, label: 'wood_pick' };
  if (count(items, /cobblestone|cobbled_deepslate/) < 12 && !has(items, /stone_pickaxe|iron_pickaxe/))
    return { kind: 'collect', names: ['stone', 'cobblestone', 'deepslate'], n: 6, label: 'stone' };
  if (!has(items, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/))
    return { kind: 'craft', item: 'stone_pickaxe', n: 1, label: 'stone_pick' };
  if (bot.food < 14)
    return { kind: 'food', label: 'food' };
  if (!has(items, /iron_pickaxe|diamond_pickaxe/) && count(items, /raw_iron|iron_ore|iron_ingot/) < 3)
    return { kind: 'collect', names: ['iron_ore', 'deepslate_iron_ore'], n: 3, label: 'iron' };
  return { kind: 'explore', label: 'explore' };
}

async function explore(bot) {
  // walk forward only — NO digging walls
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await sleep(2000);
  bot.clearControlStates();
  // if blocked by 1 soft block in front, dig ONLY that one
  try {
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const front = bot.blockAt(bot.entity.position.floored().offset(dx, 0, dz));
    if (
      front &&
      front.boundingBox === 'block' &&
      !/bedrock|obsidian|barrier|water|lava/.test(front.name) &&
      /dirt|grass|sand|gravel|snow|leaves|_log$/.test(front.name)
    ) {
      await digOne(bot, front);
    }
  } catch {}
}

export function startMindcraftCore(agent) {
  const bot = agent?.bot;
  if (!bot || bot._mcCore) return;
  bot._mcCore = true;

  // Kill flags that other junk scripts might still set
  bot._dreamNavTreeOff = true;
  bot._dreamEnvNavOff = true;
  bot._dreamAntiFreezeOff = true;
  bot._dreamKonekoOff = true;
  bot._dreamPassiveOff = true;

  let running = false;

  const tick = async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive || bot._digLocked) return;
    running = true;
    bot._mcCoreBusy = true;
    try {
      await eat(bot);

      const goal = nextGoal(bot);
      console.log('[MC] goal', goal.label, goal.kind);

      if (goal.kind === 'collect') {
        await collectType(bot, goal.names, goal.n || 1);
      } else if (goal.kind === 'craft') {
        // try several plank types for wood stage
        if (goal.item === 'oak_planks') {
          for (const p of ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks']) {
            if (await craft(bot, p, goal.n || 1)) break;
          }
        } else {
          await craft(bot, goal.item, goal.n || 1);
        }
      } else if (goal.kind === 'food') {
        if (!(await eat(bot))) await hunt(bot);
      } else {
        await explore(bot);
      }
    } catch (e) {
      console.warn('[MC]', (e.message || '').slice(0, 50));
    } finally {
      bot._mcCoreBusy = false;
      running = false;
    }
  };

  setInterval(tick, 10000);
  setTimeout(tick, 5000);
  console.log('[MC] Mindcraft core ON — single loop, no random wall break');
}
