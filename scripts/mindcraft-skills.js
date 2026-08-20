/**
 * MINDCRAFT SKILLS — dig + cave escape + tight hole
 * RESPEITA bot._dreamBusy (não interrompe pure-survival)
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
  const dist = bot.entity.position.distanceTo(new Vec3(x, y, z));
  if (dist < 12) {
    try {
      await bot.lookAt(new Vec3(x, y + 1, z), true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(Math.min(1500, dist * 100));
      bot.clearControlStates();
      return true;
    } catch {}
  }
  try {
    const { goals, Movements } = require('mineflayer-pathfinder');
    const mcData = require('minecraft-data')(bot.version);
    if (!bot.pathfinder) return false;
    const mov = new Movements(bot, mcData);
    mov.canDig = true;
    mov.digCost = 3;
    mov.placeCost = 2;
    bot.pathfinder.setMovements(mov);
    await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, minDist)), 15000);
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
    const { digBlock } = await import('./dig-place.js');
    return await digBlock(bot, block);
  } catch {
    try {
      if (bot.tool?.equipForBlock) await bot.tool.equipForBlock(block, { requireHarvest: false });
      await race(bot.dig(block, true), 8000);
      return true;
    } catch {
      try { bot.stopDigging(); } catch {}
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
      maxDistance: 32,
    });
    if (!block) break;

    const d = bot.entity.position.distanceTo(block.position);
    if (d < 6 && bot.collectBlock?.collect) {
      try {
        await race(bot.collectBlock.collect(block, { ignoreNoPath: true }), 12000);
        collected++;
        console.log('[SKILL] collect', block.name);
        continue;
      } catch {}
    }

    await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
    if (await breakBlockAt(bot, block.position.x, block.position.y, block.position.z)) {
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
      (e) => e.name === 'item' && bot.entity.position.distanceTo(e.position) < 8
    );
  let item = getNear();
  let n = 0;
  while (item && n < 6) {
    try {
      await bot.lookAt(item.position, true);
      bot.setControlState('forward', true);
      await sleep(300);
      bot.clearControlStates();
    } catch {}
    await sleep(100);
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
    if (!item) return false;
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
    if (!recipes || !recipes.length) recipes = bot.recipesFor(item.id, null, 1, true);
    if (!recipes || !recipes.length) return false;
    await race(bot.craft(recipes[0], num, table || null), 10000);
    console.log('[SKILL] craft', itemName);
    return true;
  } catch (e) {
    console.warn('[SKILL] craft', itemName, (e.message || '').slice(0, 40));
    return false;
  }
}

export async function placeBlock(bot, blockType, x, y, z) {
  const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const item = bot.inventory.findInventoryItem(blockType);
  if (!item) return false;
  const empty = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'cave_air', 'void_air'];
  const at = bot.blockAt(target);
  if (at && !empty.includes(at.name)) {
    await breakBlockAt(bot, target.x, target.y, target.z);
  }
  const dirs = [
    new Vec3(0, -1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(0, 1, 0),
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
  if (!buildOff) return false;
  if (bot.entity.position.distanceTo(target) > 4.5) {
    await goToPosition(bot, target.x, target.y, target.z, 3);
  }
  try {
    await bot.equip(item, 'hand');
    await bot.lookAt(buildOff.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.placeBlock(buildOff, face), 2000);
    return true;
  } catch {
    return false;
  }
}

export async function escapeCave(bot) {
  if (!bot?.entity) return false;
  const startY = bot.entity.position.y;
  console.log('[SKILL] ESCAPE from y=' + startY.toFixed(0));

  try {
    const { escapeTight, pillarUp } = await import('./dig-place.js');
    await escapeTight(bot);
  } catch {}

  for (let step = 0; step < 30 && bot.entity && bot.entity.position.y < 70; step++) {
    if (bot._dreamPvpActive) break;
    const pf = bot.entity.position.floored();

    for (const dy of [1, 2]) {
      const b = bot.blockAt(pf.offset(0, dy, 0));
      if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name || '')) {
        await breakBlockAt(bot, b.position.x, b.position.y, b.position.z);
      }
    }

    try {
      const { pillarUp } = await import('./dig-place.js');
      await pillarUp(bot, 1);
    } catch {
      try {
        const { placeUnderFeet } = await import('./dig-place.js');
        await placeUnderFeet(bot);
        bot.setControlState('jump', true);
        await sleep(80);
        bot.setControlState('jump', false);
      } catch {}
    }

    if (step % 3 === 2) {
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const wall = bot.blockAt(pf.offset(dx, 1, dz));
        if (wall && wall.boundingBox === 'block' && !/bedrock|barrier/.test(wall.name || '')) {
          await breakBlockAt(bot, wall.position.x, wall.position.y, wall.position.z);
          break;
        }
      }
    }

    bot.setControlState('forward', true);
    await sleep(150);
    bot.clearControlStates();
  }

  console.log('[SKILL] escape done y=' + (bot.entity?.position.y ?? 0).toFixed(0));
  return bot.entity && bot.entity.position.y > startY + 1;
}

export async function unstuck(bot) {
  if (!bot?.entity || bot._digLocked || bot._dreamPvpActive) return false;
  if (bot._dreamBusy) return false;

  const pf = bot.entity.position.floored();
  let walls = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = bot.blockAt(pf.offset(dx, 0, dz));
    if (b && b.boundingBox === 'block') walls++;
  }
  const head = bot.blockAt(pf.offset(0, 1, 0));
  const headBlocked = head && head.boundingBox === 'block';

  if (walls < 2 && !headBlocked && bot.entity.position.y >= 62) return false;

  console.log('[SKILL] unstuck walls=' + walls + ' y=' + bot.entity.position.y.toFixed(0));

  try {
    const { escapeTight } = await import('./dig-place.js');
    if (await escapeTight(bot)) return true;
  } catch {}

  if (bot.entity.position.y < 62) {
    return escapeCave(bot);
  }

  if (headBlocked && head && !/bedrock|barrier/.test(head.name || '')) {
    await breakBlockAt(bot, head.position.x, head.position.y, head.position.z);
  }
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  bot.setControlState('sprint', true);
  await sleep(500);
  bot.clearControlStates();
  return true;
}

export async function moveAway(bot, dist = 8) {
  bot.look(bot.entity.yaw + Math.PI, 0, true);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await sleep(Math.min(dist * 150, 2500));
  bot.clearControlStates();
  return true;
}

export function startMindcraftUnstuck(agent) {
  const bot = agent?.bot;
  if (!bot || bot._mcUnstuck) return;
  bot._mcUnstuck = true;

  let lastPos = null;
  let still = 0;
  let running = false;

  setInterval(async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    // BUG FIX: não rouba o pure-survival no meio da coleta
    if (bot._dreamBusy) return;
    if (bot._digLocked) return;

    if (bot._digLockUntil && Date.now() > bot._digLockUntil) {
      bot._digLocked = false;
      try { bot.stopDigging(); } catch {}
    }

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

    const pf = bot.entity.position.floored();
    let walls = 0;
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const b = bot.blockAt(pf.offset(dx, 0, dz));
      if (b && b.boundingBox === 'block') walls++;
    }
    const head = bot.blockAt(pf.offset(0, 1, 0));
    const headBlocked = head && head.boundingBox === 'block';

    if (still >= 3 || walls >= 2 || headBlocked || bot.entity.position.y < 60) {
      running = true;
      bot._dreamBusy = true;
      try {
        console.log('[SKILL] force unstuck still=' + still + ' walls=' + walls);
        await unstuck(bot);
        still = 0;
      } catch (e) {
        console.warn('[SKILL] escape', (e.message || '').slice(0, 40));
      } finally {
        running = false;
        bot._dreamBusy = false;
      }
    }
  }, 2500);

  console.log('[SKILL] unstuck + tight escape ON (respects _dreamBusy)');
}

export function startMindcraftSkills(agent) {
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
    escapeCave: () => escapeCave(bot),
  };
  startMindcraftUnstuck(agent);
  console.log('[SKILL] Mindcraft skills FAST ON');
}
