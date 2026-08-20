/**
 * MINDCRAFT-CORE v2 — real survival progression
 * Based on: Mindcraft skills, Minecraft-HRL skill vocab, mineflayer-speedrun phases
 *
 * NEVER farms dirt. Keeps ≤32 dirt for scaffold only.
 * Order: wood → planks → sticks → table → wood tools → stone → stone tools
 *         → coal → furnace → food → iron → iron tools → explore surface
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

function freeSlots(bot) {
  try {
    return bot.inventory.emptySlotCount();
  } catch {
    return 10;
  }
}

/** Toss excess dirt / junk so inventory can progress */
async function manageInventory(bot) {
  const items = inv(bot);
  const dirtN = count(items, /^(dirt|grass_block|coarse_dirt|rooted_dirt)$/);
  // keep max 32 dirt for scaffold
  if (dirtN > 32) {
    const dirt = items.find((i) => /^(dirt|grass_block)$/.test(i.name));
    if (dirt) {
      try {
        const drop = Math.min(dirt.count, dirtN - 32);
        await bot.toss(dirt.type, null, drop);
        console.log('[MC] toss dirt', drop);
      } catch {}
    }
  }
  // toss pure junk if almost full
  if (freeSlots(bot) < 3) {
    const junk = items.find((i) =>
      /dirt|gravel|andesite|diorite|granite|netherrack|cobbled_deepslate|seeds|rotten|poisonous/.test(i.name)
    );
    if (junk) {
      try {
        await bot.tossStack(junk);
        console.log('[MC] toss junk', junk.name);
      } catch {}
    }
  }
}

async function equipBest(bot, forWhat = 'pick') {
  const items = inv(bot);
  let tool = null;
  if (forWhat === 'axe') {
    tool =
      items.find((i) => /diamond_axe|netherite_axe/.test(i.name)) ||
      items.find((i) => /iron_axe/.test(i.name)) ||
      items.find((i) => /stone_axe/.test(i.name)) ||
      items.find((i) => /wooden_axe|golden_axe/.test(i.name));
  } else if (forWhat === 'sword') {
    tool =
      items.find((i) => /_sword$/.test(i.name) && /diamond|netherite|iron|stone/.test(i.name)) ||
      items.find((i) => /_sword$/.test(i.name));
  } else {
    tool =
      items.find((i) => /diamond_pickaxe|netherite_pickaxe/.test(i.name)) ||
      items.find((i) => /iron_pickaxe/.test(i.name)) ||
      items.find((i) => /stone_pickaxe/.test(i.name)) ||
      items.find((i) => /wooden_pickaxe|golden_pickaxe/.test(i.name));
  }
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
      return true;
    } catch {}
  }
  return false;
}

async function gotoNear(bot, x, y, z, range = 2) {
  try {
    if (typeof bot.dreamGoto === 'function') {
      await race(bot.dreamGoto(x, y, z, range), 18000);
      return true;
    }
  } catch {}
  try {
    const { goals, Movements } = require('mineflayer-pathfinder');
    if (bot.pathfinder) {
      const mcData = require('minecraft-data')(bot.version);
      const mov = new Movements(bot, mcData);
      mov.canDig = false;
      // only allow dig soft if path really needs — still prefer no dig
      bot.pathfinder.setMovements(mov);
      await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)), 18000);
      return true;
    }
  } catch {}
  // fallback walk
  try {
    await bot.lookAt({ x, y: y + 1, z }, true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await sleep(1500);
    bot.clearControlStates();
  } catch {}
  return false;
}

async function digOne(bot, block) {
  if (!block || busy(bot)) return false;
  // never dig dirt as intentional farm target from digOne callers for progress
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

async function collectType(bot, names, howMany = 1, toolHint = 'pick') {
  const set = new Set(names);
  let got = 0;
  await equipBest(bot, toolHint);

  for (let i = 0; i < howMany; i++) {
    if (busy(bot)) break;
    const block = bot.findBlock({
      matching: (b) => b && set.has(b.name),
      maxDistance: 48,
    });
    if (!block) {
      console.log('[MC] none nearby', names[0]);
      break;
    }

    try {
      if (bot.collectBlock?.collect) {
        await race(bot.collectBlock.collect(block, { ignoreNoPath: true }), 45000);
        got++;
        console.log('[MC] collect', block.name);
        continue;
      }
    } catch (e) {
      console.warn('[MC] collect fail', (e.message || '').slice(0, 40));
    }

    await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2);
    await equipBest(bot, toolHint);
    const live = bot.blockAt(block.position);
    if (live && live.name !== 'air') {
      if (await digOne(bot, live)) {
        got++;
        console.log('[MC] dig', live.name);
      }
    }
  }
  return got > 0;
}

async function placeItem(bot, itemName) {
  const item = inv(bot).find((i) => i.name === itemName);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref) return false;
    const Vec3 = require('vec3').Vec3;
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw)) || 1;
    const dz = Math.round(-Math.cos(yaw));
    await bot.lookAt(ref.position.offset(0.5 + dx * 0.5, 1, 0.5 + dz * 0.5), true);
    await race(bot.placeBlock(ref, new Vec3(dx, 0, dz)), 3000);
    console.log('[MC] place', itemName);
    return true;
  } catch {
    try {
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      const Vec3 = require('vec3').Vec3;
      await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 3000);
      return true;
    } catch {
      return false;
    }
  }
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

    // place table if we have one in inv
    if (!table && count(inv(bot), 'crafting_table') >= 1) {
      await placeItem(bot, 'crafting_table');
      table = bot.findBlock({
        matching: mcData.blocksByName.crafting_table?.id,
        maxDistance: 8,
      });
    }

    let recipes = bot.recipesFor(item.id, null, 1, null);
    if ((!recipes || !recipes.length) && table) {
      if (bot.entity.position.distanceTo(table.position) > 3) {
        await gotoNear(bot, table.position.x, table.position.y, table.position.z, 2);
      }
      recipes = bot.recipesFor(item.id, null, 1, table);
    }
    if (!recipes || !recipes.length) {
      recipes = bot.recipesFor(item.id, null, 1, true);
    }
    if (!recipes || !recipes.length) {
      console.log('[MC] no recipe', itemName);
      return false;
    }
    await race(bot.craft(recipes[0], qty, table || null), 12000);
    console.log('[MC] craft', itemName, 'x' + qty);
    return true;
  } catch (e) {
    console.warn('[MC] craft fail', itemName, (e.message || '').slice(0, 30));
    return false;
  }
}

async function craftPlanks(bot) {
  for (const p of PLANKS) {
    if (await craft(bot, p, 4)) return true;
  }
  return false;
}

async function eat(bot) {
  if (bot.food >= 16) return false;
  const food = inv(bot).find((i) =>
    /beef|pork|chicken|mutton|bread|apple|carrot|potato|cod|salmon|cooked_|melon|berry/.test(i.name)
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
      e.position.distanceTo(bot.entity.position) < 20 &&
      /cow|pig|sheep|chicken/.test(e.name || '')
  );
  if (!prey) return false;
  await equipBest(bot, 'sword');
  await gotoNear(bot, prey.position.x, prey.position.y, prey.position.z, 2);
  for (let i = 0; i < 12; i++) {
    const live = bot.entities[prey.id];
    if (!live) break;
    try {
      await bot.lookAt(live.position.offset(0, 1, 0), true);
      await bot.attack(live);
    } catch {}
    await sleep(350);
  }
  console.log('[MC] hunt');
  return true;
}

async function goSurface(bot) {
  const y = bot.entity.position.y;
  if (y >= 60) return false;
  console.log('[MC] surface from y=' + y.toFixed(0));
  // dig up if ceiling
  const pf = bot.entity.position.floored();
  for (let dy = 1; dy <= 3; dy++) {
    const b = bot.blockAt(pf.offset(0, dy, 0));
    if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name)) {
      await equipBest(bot, 'pick');
      await digOne(bot, b);
    }
  }
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  await sleep(800);
  bot.clearControlStates();
  // pillar with dirt if we have
  try {
    const { placeUnderFeet } = await import('./dig-place.js');
    for (let i = 0; i < 4 && bot.entity.position.y < 60; i++) {
      await placeUnderFeet(bot);
      await sleep(200);
    }
  } catch {}
  return true;
}

/** Strict tech tree — mirrors HRL / Voyager milestones */
function nextGoal(bot) {
  const items = inv(bot);
  const logs = count(items, /_log$/);
  const planks = count(items, /_planks$/);
  const sticks = count(items, 'stick');
  const cobble = count(items, /cobblestone|cobbled_deepslate/);
  const hasWoodPick = has(items, /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const hasStonePick = has(items, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const hasIronPick = has(items, /iron_pickaxe|diamond_pickaxe/);
  const hasTable = count(items, 'crafting_table') >= 1 || !!bot.findBlock({
    matching: (b) => b && b.name === 'crafting_table',
    maxDistance: 16,
  });

  // 1 wood
  if (logs < 6 && planks < 12) {
    return { kind: 'collect', names: LOGS, n: 5, tool: 'axe', label: 'wood' };
  }
  // 2 planks
  if (planks < 12) {
    return { kind: 'planks', label: 'planks' };
  }
  // 3 sticks
  if (sticks < 8 && !hasWoodPick) {
    return { kind: 'craft', item: 'stick', n: 4, label: 'sticks' };
  }
  // 4 table
  if (!hasTable) {
    return { kind: 'craft', item: 'crafting_table', n: 1, label: 'table' };
  }
  // 5 wood tools
  if (!hasWoodPick) {
    return { kind: 'craft', item: 'wooden_pickaxe', n: 1, label: 'wood_pick' };
  }
  // also axe if missing
  if (!has(items, /_axe$/) && hasWoodPick) {
    return { kind: 'craft', item: hasStonePick ? 'stone_axe' : 'wooden_axe', n: 1, label: 'axe' };
  }
  // 6 stone
  if (cobble < 20 && !hasStonePick) {
    return { kind: 'collect', names: ['stone', 'cobblestone', 'deepslate'], n: 8, tool: 'pick', label: 'stone' };
  }
  // 7 stone tools
  if (!hasStonePick) {
    return { kind: 'craft', item: 'stone_pickaxe', n: 1, label: 'stone_pick' };
  }
  if (!has(items, /stone_sword|iron_sword/)) {
    return { kind: 'craft', item: 'stone_sword', n: 1, label: 'sword' };
  }
  // 8 coal for furnace
  if (count(items, /coal|charcoal/) < 3 && !hasIronPick) {
    return { kind: 'collect', names: ['coal_ore', 'deepslate_coal_ore'], n: 4, tool: 'pick', label: 'coal' };
  }
  // 9 furnace
  if (count(items, 'furnace') < 1 && !has(items, /iron_ingot|iron_pickaxe/) && cobble >= 8) {
    return { kind: 'craft', item: 'furnace', n: 1, label: 'furnace' };
  }
  // 10 food
  if (bot.food < 14 || count(items, /beef|pork|chicken|mutton|bread|cooked_/) < 2) {
    return { kind: 'food', label: 'food' };
  }
  // 11 iron
  if (!hasIronPick && count(items, /raw_iron|iron_ore|iron_ingot/) < 3) {
    return { kind: 'collect', names: ['iron_ore', 'deepslate_iron_ore'], n: 4, tool: 'pick', label: 'iron' };
  }
  // 12 surface if buried
  if (bot.entity.position.y < 50 && !hasIronPick) {
    return { kind: 'surface', label: 'surface' };
  }
  // 13 explore for more
  return { kind: 'explore', label: 'explore' };
}

async function explore(bot) {
  // NEVER dig dirt as farming — only soft obstacle in front once
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  if (Math.random() < 0.3) bot.setControlState('jump', true);
  await sleep(2200);
  bot.clearControlStates();

  try {
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const front = bot.blockAt(bot.entity.position.floored().offset(dx, 0, dz));
    // only leaves/log — NOT dirt (dirt was filling inventory)
    if (front && /leaves|_log$/.test(front.name)) {
      await digOne(bot, front);
    } else if (front && front.boundingBox === 'block' && /dirt|grass|sand/.test(front.name)) {
      // jump over instead of dig
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      await sleep(400);
      bot.clearControlStates();
    }
  } catch {}
}

export function startMindcraftCore(agent) {
  const bot = agent?.bot;
  if (!bot || bot._mcCore) return;
  bot._mcCore = true;

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
      await manageInventory(bot);
      await eat(bot);

      const goal = nextGoal(bot);
      console.log('[MC] goal', goal.label, goal.kind, 'y=' + bot.entity.position.y.toFixed(0));

      switch (goal.kind) {
        case 'collect':
          await collectType(bot, goal.names, goal.n || 1, goal.tool || 'pick');
          break;
        case 'planks':
          await craftPlanks(bot);
          break;
        case 'craft':
          await craft(bot, goal.item, goal.n || 1);
          if (goal.item === 'crafting_table') await placeItem(bot, 'crafting_table');
          if (goal.item === 'furnace') await placeItem(bot, 'furnace');
          break;
        case 'food':
          if (!(await eat(bot))) await hunt(bot);
          break;
        case 'surface':
          await goSurface(bot);
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

  setInterval(tick, 8000);
  setTimeout(tick, 4000);
  console.log('[MC] survival core v2 ON — no dirt farm, full tech tree');
}
