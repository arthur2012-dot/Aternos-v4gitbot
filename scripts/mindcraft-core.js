/**
 * MINDCRAFT-CORE v4 — fast dig + PRIORITY leave cave
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const LOGS = [
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
];
const PLANKS = [
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function freeSlots(bot) {
  try {
    return bot.inventory.emptySlotCount();
  } catch {
    return 10;
  }
}

async function manageInventory(bot) {
  const items = inv(bot);
  const dirtN = count(items, /^(dirt|grass_block|coarse_dirt|rooted_dirt)$/);
  if (dirtN > 32) {
    const dirt = items.find((i) => /^(dirt|grass_block)$/.test(i.name));
    if (dirt) {
      try {
        await bot.toss(dirt.type, null, Math.min(dirt.count, dirtN - 32));
      } catch {}
    }
  }
  if (freeSlots(bot) < 3) {
    const junk = items.find((i) =>
      /dirt|gravel|andesite|diorite|granite|netherrack|seeds|rotten/.test(i.name)
    );
    if (junk) {
      try {
        await bot.tossStack(junk);
      } catch {}
    }
  }
}

async function equipBest(bot, forWhat = 'pick') {
  const items = inv(bot);
  let tool =
    forWhat === 'axe'
      ? items.find((i) => /netherite_axe|diamond_axe|iron_axe|stone_axe|wooden_axe/.test(i.name))
      : forWhat === 'sword'
        ? items.find((i) => /_sword$/.test(i.name))
        : items.find((i) =>
            /netherite_pickaxe|diamond_pickaxe|iron_pickaxe|stone_pickaxe|wooden_pickaxe/.test(i.name)
          );
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
      return true;
    } catch {}
  }
  return false;
}

async function collectType(bot, names, howMany = 1, toolHint = 'pick') {
  await equipBest(bot, toolHint);
  if (bot.mc?.collectBlock) {
    let type = names[0];
    if (names.some((n) => n.includes('_log'))) type = 'log';
    if (names.includes('stone') || names.includes('cobblestone')) type = 'cobblestone';
    if (names.some((n) => n.includes('iron_ore'))) type = 'iron_ore';
    if (names.some((n) => n.includes('coal'))) type = 'coal_ore';
    if (await bot.mc.collectBlock(type, howMany)) return true;
  }
  const set = new Set(names);
  let got = 0;
  for (let i = 0; i < howMany; i++) {
    if (bot._digLocked) break;
    const block = bot.findBlock({ matching: (b) => b && set.has(b.name), maxDistance: 32 });
    if (!block) break;
    if (bot.mc?.goToPosition) await bot.mc.goToPosition(block.position.x, block.position.y, block.position.z, 2);
    if (bot.mc?.breakBlockAt) {
      if (await bot.mc.breakBlockAt(block.position.x, block.position.y, block.position.z)) got++;
    }
  }
  return got > 0;
}

async function craft(bot, itemName, qty = 1) {
  if (bot.mc?.craftRecipe && (await bot.mc.craftRecipe(itemName, qty))) return true;
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;
    let table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 16 });
    let recipes = bot.recipesFor(item.id, null, 1, table || null);
    if (!recipes?.length) recipes = bot.recipesFor(item.id, null, 1, true);
    if (!recipes?.length) return false;
    await bot.craft(recipes[0], qty, table || null);
    console.log('[MC] craft', itemName);
    return true;
  } catch {
    return false;
  }
}

async function craftPlanks(bot) {
  for (const p of PLANKS) {
    if (await craft(bot, p, 4)) return true;
  }
  return false;
}

async function placeItem(bot, itemName) {
  if (bot.mc?.placeBlock) {
    const p = bot.entity.position.floored();
    return bot.mc.placeBlock(itemName, p.x + 1, p.y, p.z);
  }
  return false;
}

async function eat(bot) {
  if (bot.food >= 16) return false;
  const food = inv(bot).find((i) =>
    /beef|pork|chicken|mutton|bread|apple|carrot|potato|cooked_/.test(i.name)
  );
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
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
      e.position.distanceTo(bot.entity.position) < 20 &&
      /cow|pig|sheep|chicken/.test(e.name || '')
  );
  if (!prey) return false;
  await equipBest(bot, 'sword');
  if (bot.mc?.goToPosition) await bot.mc.goToPosition(prey.position.x, prey.position.y, prey.position.z, 2);
  for (let i = 0; i < 10; i++) {
    const live = bot.entities[prey.id];
    if (!live) break;
    try {
      await bot.lookAt(live.position.offset(0, 1, 0), true);
      await bot.attack(live);
    } catch {}
    await sleep(300);
  }
  return true;
}

function nextGoal(bot) {
  const items = inv(bot);
  const y = bot.entity.position.y;

  // PRIORITY #1: leave cave — never stay underground for hours
  if (y < 55) {
    return { kind: 'surface', label: 'ESCAPE_CAVE' };
  }

  const logs = count(items, /_log$/);
  const planks = count(items, /_planks$/);
  const sticks = count(items, 'stick');
  const cobble = count(items, /cobblestone|cobbled_deepslate/);
  const hasWoodPick = has(items, /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const hasStonePick = has(items, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const hasIronPick = has(items, /iron_pickaxe|diamond_pickaxe/);
  const hasTable =
    count(items, 'crafting_table') >= 1 ||
    !!bot.findBlock({ matching: (b) => b && b.name === 'crafting_table', maxDistance: 16 });

  if (logs < 6 && planks < 12) return { kind: 'collect', names: LOGS, n: 5, tool: 'axe', label: 'wood' };
  if (planks < 12) return { kind: 'planks', label: 'planks' };
  if (sticks < 8 && !hasWoodPick) return { kind: 'craft', item: 'stick', n: 4, label: 'sticks' };
  if (!hasTable) return { kind: 'craft', item: 'crafting_table', n: 1, label: 'table' };
  if (!hasWoodPick) return { kind: 'craft', item: 'wooden_pickaxe', n: 1, label: 'wood_pick' };
  if (!has(items, /_axe$/)) return { kind: 'craft', item: hasStonePick ? 'stone_axe' : 'wooden_axe', n: 1, label: 'axe' };
  if (cobble < 20 && !hasStonePick)
    return { kind: 'collect', names: ['stone', 'cobblestone', 'deepslate'], n: 8, tool: 'pick', label: 'stone' };
  if (!hasStonePick) return { kind: 'craft', item: 'stone_pickaxe', n: 1, label: 'stone_pick' };
  if (!has(items, /stone_sword|iron_sword/)) return { kind: 'craft', item: 'stone_sword', n: 1, label: 'sword' };
  if (count(items, /coal|charcoal/) < 3 && !hasIronPick)
    return { kind: 'collect', names: ['coal_ore', 'deepslate_coal_ore'], n: 4, tool: 'pick', label: 'coal' };
  if (count(items, 'furnace') < 1 && !has(items, /iron_ingot|iron_pickaxe/) && cobble >= 8)
    return { kind: 'craft', item: 'furnace', n: 1, label: 'furnace' };
  if (bot.food < 14) return { kind: 'food', label: 'food' };
  if (!hasIronPick && count(items, /raw_iron|iron_ore|iron_ingot/) < 3)
    return { kind: 'collect', names: ['iron_ore', 'deepslate_iron_ore'], n: 4, tool: 'pick', label: 'iron' };
  return { kind: 'explore', label: 'explore' };
}

async function explore(bot) {
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  if (Math.random() < 0.4) bot.setControlState('jump', true);
  await sleep(1800);
  bot.clearControlStates();
}

export function startMindcraftCore(agent) {
  const bot = agent?.bot;
  if (!bot || bot._mcCore) return;
  bot._mcCore = true;

  let running = false;

  const tick = async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive || bot._digLocked) return;
    running = true;
    bot._mcCoreBusy = true;
    try {
      await manageInventory(bot);
      await eat(bot);
      const goal = nextGoal(bot);
      console.log('[MC] goal', goal.label, 'y=' + bot.entity.position.y.toFixed(0));

      switch (goal.kind) {
        case 'surface':
          if (bot.mc?.escapeCave) await bot.mc.escapeCave();
          else if (bot.mc?.unstuck) await bot.mc.unstuck();
          break;
        case 'collect':
          await collectType(bot, goal.names, goal.n || 1, goal.tool || 'pick');
          break;
        case 'planks':
          await craftPlanks(bot);
          break;
        case 'craft':
          await craft(bot, goal.item, goal.n || 1);
          if (goal.item === 'crafting_table' || goal.item === 'furnace') await placeItem(bot, goal.item);
          break;
        case 'food':
          if (!(await eat(bot))) await hunt(bot);
          break;
        default:
          await explore(bot);
      }
    } catch (e) {
      console.warn('[MC]', (e.message || '').slice(0, 50));
    } finally {
      bot._mcCoreBusy = false;
      running = false;
    }
  };

  // faster loop when needs to escape; always 4s
  setInterval(tick, 4000);
  setTimeout(tick, 2000);
  console.log('[MC] core v4 ON — fast dig + priority cave escape');
}
