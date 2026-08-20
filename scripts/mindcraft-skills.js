/**
 * MINDCRAFT SKILLS — real ports from mindcraft-bots/mindcraft skills.js
 * collectBlock, breakBlockAt, goToPosition, craftRecipe, placeBlock, pickup, unstuck
 * Used by mindcraft-core and path systems — NOT noops.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

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

export async function goToPosition(bot, x, y, z, minDist = 2) {
  if (!bot?.entity) return false;
  try {
    const { goals, Movements } = require('mineflayer-pathfinder');
    const mcData = require('minecraft-data')(bot.version);
    if (!bot.pathfinder) return false;
    const mov = new Movements(bot, mcData);
    // Mindcraft: path can dig carefully for progress, not spam
    mov.canDig = true;
    mov.digCost = 8;
    mov.placeCost = 4;
    bot.pathfinder.setMovements(mov);
    await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, minDist)), 30000);
    return true;
  } catch (e) {
    console.warn('[SKILL] goTo', (e.message || '').slice(0, 40));
    return false;
  }
}

export async function breakBlockAt(bot, x, y, z) {
  const block = bot.blockAt(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)));
  if (!block || block.name === 'air' || block.name === 'water' || block.name === 'lava') return false;
  if (/bedrock|barrier|command/.test(block.name)) return false;

  if (bot.entity.position.distanceTo(block.position) > 4.5) {
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, 3);
  }

  try {
    if (bot.tool?.equipForBlock) {
      await bot.tool.equipForBlock(block, { requireHarvest: false });
    }
  } catch {}

  try {
    const { digBlock } = await import('./dig-place.js');
    return await digBlock(bot, block, { maxMs: 20000, retries: 4 });
  } catch {
    try {
      await race(bot.dig(block, true), 18000);
      console.log('[SKILL] breakBlockAt', block.name);
      return true;
    } catch {
      try {
        bot.stopDigging();
      } catch {}
      return false;
    }
  }
}

export async function collectBlock(bot, blockType, num = 1) {
  if (num < 1) return false;

  let types = [blockType];
  if (blockType === 'coal' || blockType === 'iron' || blockType === 'diamond') {
    types.push(blockType + '_ore', 'deepslate_' + blockType + '_ore');
  }
  if (blockType.endsWith('_ore')) types.push('deepslate_' + blockType);
  if (blockType === 'cobblestone') types.push('stone', 'deepslate');
  if (blockType === 'dirt') types.push('grass_block');
  if (blockType === 'log' || blockType === 'wood') {
    types = [
      'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
      'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    ];
  }

  let collected = 0;
  for (let i = 0; i < num; i++) {
    if (bot.interrupt_code) break;

    const block = bot.findBlock({
      matching: (b) => b && types.includes(b.name),
      maxDistance: 48,
    });
    if (!block) {
      if (collected === 0) console.log('[SKILL] no', blockType, 'nearby');
      break;
    }

    try {
      if (bot.tool?.equipForBlock) {
        await bot.tool.equipForBlock(block, { requireHarvest: false });
      }
    } catch {}

    try {
      if (bot.collectBlock?.collect) {
        await race(bot.collectBlock.collect(block, { ignoreNoPath: true }), 45000);
        collected++;
        console.log('[SKILL] collectBlock', block.name);
        continue;
      }
    } catch (e) {
      console.warn('[SKILL] collectBlock plugin', (e.message || '').slice(0, 40));
    }

    await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
    const ok = await breakBlockAt(bot, block.position.x, block.position.y, block.position.z);
    if (ok) {
      collected++;
      await pickupNearbyItems(bot);
    }
  }
  console.log('[SKILL] collected', collected, blockType);
  return collected > 0;
}

export async function pickupNearbyItems(bot) {
  const getNear = () =>
    bot.nearestEntity(
      (e) => e.name === 'item' && bot.entity.position.distanceTo(e.position) < 10
    );
  let item = getNear();
  let n = 0;
  while (item && n < 8) {
    try {
      await goToPosition(bot, item.position.x, item.position.y, item.position.z, 1);
    } catch {}
    await sleep(250);
    const prev = item;
    item = getNear();
    if (prev === item) break;
    n++;
  }
  return n > 0;
}

export async function craftRecipe(bot, itemName, num = 1) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) {
      console.log('[SKILL] unknown item', itemName);
      return false;
    }

    let table = bot.findBlock({
      matching: mcData.blocksByName.crafting_table?.id,
      maxDistance: 16,
    });

    let recipes = bot.recipesFor(item.id, null, 1, null);
    if ((!recipes || !recipes.length) && table) {
      if (bot.entity.position.distanceTo(table.position) > 4) {
        await goToPosition(bot, table.position.x, table.position.y, table.position.z, 2);
      }
      recipes = bot.recipesFor(item.id, null, 1, table);
    }
    if (!recipes || !recipes.length) {
      recipes = bot.recipesFor(item.id, null, 1, true);
    }
    if (!recipes || !recipes.length) {
      console.log('[SKILL] no recipe', itemName);
      return false;
    }

    await race(bot.craft(recipes[0], num, table || null), 15000);
    console.log('[SKILL] craft', itemName, 'x' + num);
    try {
      bot.armorManager?.equipAll?.();
    } catch {}
    return true;
  } catch (e) {
    console.warn('[SKILL] craft', itemName, (e.message || '').slice(0, 40));
    return false;
  }
}

export async function placeBlock(bot, blockType, x, y, z) {
  const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  let itemName = blockType;
  if (itemName === 'redstone_wire') itemName = 'redstone';

  const item = bot.inventory.findInventoryItem(itemName);
  if (!item) {
    console.log('[SKILL] no item to place', itemName);
    return false;
  }

  const empty = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern', 'cave_air', 'void_air'];
  const at = bot.blockAt(target);
  if (at && !empty.includes(at.name)) {
    await breakBlockAt(bot, target.x, target.y, target.z);
    await sleep(200);
  }

  const dirs = [
    new Vec3(0, -1, 0),
    new Vec3(0, 1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];
  let buildOff = null;
  let face = null;
  for (const d of dirs) {
    const b = bot.blockAt(target.plus(d));
    if (b && !empty.includes(b.name)) {
      buildOff = b;
      face = new Vec3(-d.x, -d.y, -d.z);
      break;
    }
  }
  if (!buildOff) {
    console.log('[SKILL] nothing to place on');
    return false;
  }

  if (bot.entity.position.distanceTo(target) > 4.5) {
    await goToPosition(bot, target.x, target.y, target.z, 3);
  }

  try {
    await bot.equip(item, 'hand');
    await bot.lookAt(buildOff.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.placeBlock(buildOff, face), 3000);
    console.log('[SKILL] place', blockType, 'at', target);
    return true;
  } catch (e) {
    console.warn('[SKILL] place fail', (e.message || '').slice(0, 40));
    return false;
  }
}

/** Mindcraft-style unstuck: only when truly boxed in */
export async function unstuck(bot) {
  if (!bot?.entity || bot._digLocked || bot._dreamPvpActive) return false;
  const pf = bot.entity.position.floored();
  let walls = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dz] of dirs) {
    const b = bot.blockAt(pf.offset(dx, 0, dz));
    if (b && b.boundingBox === 'block') walls++;
  }
  const head = bot.blockAt(pf.offset(0, 1, 0));
  const headBlocked = head && head.boundingBox === 'block';

  if (walls < 3 && !headBlocked) return false;

  console.log('[SKILL] unstuck walls=' + walls + ' head=' + headBlocked);

  // 1) dig ceiling first (Mindcraft escape)
  if (headBlocked && head && !/bedrock|barrier/.test(head.name)) {
    await breakBlockAt(bot, head.position.x, head.position.y, head.position.z);
  }
  const above = bot.blockAt(pf.offset(0, 2, 0));
  if (above && above.boundingBox === 'block' && !/bedrock|barrier/.test(above.name)) {
    await breakBlockAt(bot, above.position.x, above.position.y, above.position.z);
  }

  // 2) dig one forward wall only
  const yaw = bot.entity.yaw;
  const fx = Math.round(-Math.sin(yaw)) || 1;
  const fz = Math.round(-Math.cos(yaw));
  for (const oy of [0, 1]) {
    const b = bot.blockAt(pf.offset(fx, oy, fz));
    if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name)) {
      await breakBlockAt(bot, b.position.x, b.position.y, b.position.z);
    }
  }

  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  bot.setControlState('sprint', true);
  await sleep(800);
  bot.clearControlStates();
  return true;
}

export async function moveAway(bot, dist = 8) {
  const yaw = bot.entity.yaw + Math.PI;
  bot.look(yaw, 0, true);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await sleep(Math.min(dist * 200, 3000));
  bot.clearControlStates();
  return true;
}

/** Background unstuck watcher — real, not noop */
export function startMindcraftUnstuck(agent) {
  const bot = agent?.bot;
  if (!bot || bot._mcUnstuck) return;
  bot._mcUnstuck = true;

  let lastPos = null;
  let still = 0;
  let running = false;

  setInterval(async () => {
    if (running || !bot.entity) return;
    if (bot._digLocked || bot._dreamPvpActive || bot._mcCoreBusy) return;

    const key =
      Math.floor(bot.entity.position.x) +
      ',' +
      Math.floor(bot.entity.position.y) +
      ',' +
      Math.floor(bot.entity.position.z);
    if (key === lastPos) still++;
    else {
      still = 0;
      lastPos = key;
    }

    if (still < 5) return;
    running = true;
    try {
      console.log('[SKILL] still=' + still + ' → unstuck');
      await unstuck(bot);
      still = 0;
    } catch (e) {
      console.warn('[SKILL] unstuck', (e.message || '').slice(0, 40));
    } finally {
      running = false;
    }
  }, 2500);

  console.log('[SKILL] Mindcraft unstuck ON');
}

export function startMindcraftSkills(agent) {
  // expose helpers on bot for other modules
  const bot = agent?.bot;
  if (!bot || bot._mcSkills) return;
  bot._mcSkills = true;
  bot.mc = {
    goToPosition: (x, y, z, d) => goToPosition(bot, x, y, z, d),
    collectBlock: (t, n) => collectBlock(bot, t, n),
    breakBlockAt: (x, y, z) => breakBlockAt(bot, x, y, z),
    craftRecipe: (i, n) => craftRecipe(bot, i, n),
    placeBlock: (t, x, y, z) => placeBlock(bot, t, x, y, z),
    pickupNearbyItems: () => pickupNearbyItems(bot),
    unstuck: () => unstuck(bot),
  };
  startMindcraftUnstuck(agent);
  console.log('[SKILL] Mindcraft skills API ON');
}
