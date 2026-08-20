/**
 * pure-survival v7 — stable + emergent
 * Goal: recover fast from freeze/hole/water without turning into a pure stage machine.
 * Reference: Emergent Garden "4 AIs Survive 10 Days" — natural recovery, variance, light chaos.
 */

import pathfinderPkg from 'mineflayer-pathfinder';
const { goals: pfGoals, Movements, pathfinder } = pathfinderPkg;
import collectBlockPlugin from 'mineflayer-collectblock';
import pvpPlugin from 'mineflayer-pvp';
import { Vec3 } from 'vec3';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// optional escape helpers (loaded lazily)
let escapeHoleFn = null;
let isTrappedFn = null;
try {
  const esc = await import('./escape-hole.js');
  escapeHoleFn = esc.escapeHole;
  isTrappedFn = esc.isTrapped;
} catch {}

const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper',
  'spider', 'cave_spider', 'enderman', 'witch', 'phantom',
  'pillager', 'vindicator', 'blaze', 'ghast', 'hoglin',
]);

const WOOD_LOG = /_(log|stem)$/;
const FOOD = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon/;
const SOFT_FACE = /dirt|grass|sand|gravel|clay|snow|podzol|mycelium|farmland|mud|rooted|leaves|netherrack|tuff/;

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
    mv.digCost = 1.0;
    mv.placeCost = 50;
    mv.liquidCost = 8;
    mv.allowSprinting = true;
    mv.allowParkour = true;
    mv.allow1by1towers = false;
    mv.canPlaceOn = new Set();
    mv.scaffoldingBlocks = [];
    mv.maxDropDown = 4;
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

function blockInFace(bot) {
  try {
    const p = bot.entity.position;
    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const eye = p.offset(dx * 0.85, 1.05, dz * 0.85);
    const b = bot.blockAt(eye.floored());
    if (b && b.boundingBox === 'block' && b.name !== 'air') return b;
    const chest = bot.blockAt(p.offset(dx * 0.85, 0.55, dz * 0.85).floored());
    if (chest && chest.boundingBox === 'block') return chest;
  } catch {}
  return null;
}

/**
 * Soft unstuck — dig soft face if present, otherwise varied turn + walk.
 * Keeps human-like variance (no fixed 180° spin every time).
 */
async function forceUnstuck(bot) {
  console.log('[PURE] UNSTUCK');
  await stopNav(bot);

  // if heavily trapped, prefer full escape planner
  if (isTrappedFn && isTrappedFn(bot) && escapeHoleFn) {
    try {
      const ok = await escapeHoleFn(bot);
      if (ok) return true;
    } catch (e) {
      console.warn('[PURE] escapeHole', (e.message || '').slice(0, 40));
    }
  }

  const face = blockInFace(bot);
  if (face && SOFT_FACE.test(face.name)) {
    try {
      const shovel = findItem(bot, /_shovel/) || findItem(bot, /_pickaxe|_axe/);
      if (shovel) await bot.equip(shovel, 'hand');
      await bot.lookAt(face.position.offset(0.5, 0.5, 0.5), true);
      await race(bot.dig(face, true), 5500);
      console.log('[PURE] dug face', face.name);
    } catch {
      try { bot.stopDigging(); } catch {}
    }
  }

  // varied yaw — not mechanical 180
  const delta = (Math.random() > 0.5 ? 1 : -1) * (0.9 + Math.random() * 1.4);
  try {
    await bot.look(bot.entity.yaw + delta, -0.15 + Math.random() * 0.1, true);
  } catch {}

  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  bot.setControlState('jump', true);
  await sleep(320 + Math.floor(Math.random() * 180));
  bot.setControlState('jump', false);
  await sleep(900 + Math.floor(Math.random() * 400));
  if (Math.random() < 0.6) {
    bot.setControlState('jump', true);
    await sleep(220);
    bot.setControlState('jump', false);
  }
  await sleep(500 + Math.floor(Math.random() * 300));
  bot.clearControlStates();

  return true;
}

async function walkRaw(bot, seconds = 2.4, yawOffset = 0) {
  try {
    const yaw = bot.entity.yaw + yawOffset;
    await bot.look(yaw, 0, true);
  } catch {}
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (blockInFace(bot)) {
      bot.setControlState('jump', true);
      await sleep(180);
      bot.setControlState('jump', false);
      const f = blockInFace(bot);
      if (f && SOFT_FACE.test(f.name)) {
        bot.clearControlStates();
        try {
          await race(bot.dig(f, true), 3800);
        } catch {
          try { bot.stopDigging(); } catch {}
        }
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
      }
    }
    // human micro-variation
    if (Math.random() < 0.12 && bot.entity.onGround) {
      bot.setControlState('jump', true);
      await sleep(120 + Math.floor(Math.random() * 80));
      bot.setControlState('jump', false);
    }
    if (Math.random() < 0.08) {
      try {
        await bot.look(bot.entity.yaw + (Math.random() - 0.5) * 0.4, 0, true);
      } catch {}
    }
    await sleep(180 + Math.floor(Math.random() * 60));
  }
  bot.clearControlStates();
}

async function gotoNear(bot, x, y, z, range = 2) {
  const start = bot.entity.position.clone();
  try {
    await race(bot.pathfinder.goto(new pfGoals.GoalNear(x, y, z, range)), 9000);
    return true;
  } catch {
    await stopNav(bot);
    const dx = x - bot.entity.position.x;
    const dz = z - bot.entity.position.z;
    const yaw = Math.atan2(-dx, -dz);
    try {
      await bot.look(yaw, 0, true);
    } catch {}
    await walkRaw(bot, 2.3, 0);
    const moved = bot.entity.position.distanceTo(start);
    if (moved < 1.1) await forceUnstuck(bot);
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
      await sleep(1500);
      try { bot.deactivateItem(); } catch {}
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
    await sleep(700 + Math.floor(Math.random() * 300));
    return true;
  } catch {
    return false;
  }
}

async function digBlock(bot, block) {
  if (!block) return false;
  try {
    await stopNav(bot);
    if (bot.tool?.equipForBlock) {
      try { await bot.tool.equipForBlock(block); } catch {}
    } else {
      const tool =
        findItem(bot, /_pickaxe/) ||
        findItem(bot, /_axe/) ||
        findItem(bot, /_shovel/);
      if (tool) await bot.equip(tool, 'hand');
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block, true), 9500);
    console.log('[PURE] dug', block.name);
    return true;
  } catch (e) {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

async function doCollect(bot, block) {
  if (!block) return false;
  const start = bot.entity.position.clone();
  try {
    if (bot.pvp?.target) {
      try { await bot.pvp.stop(); } catch {}
    }
    await stopNav(bot);

    if (bot.collectBlock?.collect) {
      try {
        await race(bot.collectBlock.collect(block), 11000);
        console.log('[PURE] collectBlock', block.name);
        return true;
      } catch (e) {
        console.warn('[PURE] collect timeout/fail', String(e.message || e).slice(0, 40));
        await stopNav(bot);
      }
    }

    const ok = await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2);
    const still = bot.blockAt(block.position);
    if (still && still.name === block.name) {
      const dug = await digBlock(bot, still);
      if (dug) return true;
    }

    if (bot.entity.position.distanceTo(start) < 1.4) {
      await forceUnstuck(bot);
    }
    return false;
  } catch {
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
    const candidates = [
      feet.offset(1, -1, 0),
      feet.offset(-1, -1, 0),
      feet.offset(0, -1, 1),
      feet.offset(0, -1, -1),
      feet.offset(0, -1, 0),
    ];
    for (const pos of candidates) {
      const ref = bot.blockAt(pos);
      if (!ref || ref.boundingBox !== 'block') continue;
      const above = bot.blockAt(pos.offset(0, 1, 0));
      if (above && above.name !== 'air') continue;
      await bot.lookAt(pos.offset(0.5, 1.05, 0.5), true);
      await bot.placeBlock(ref, new Vec3(0, 1, 0));
      console.log('[PURE] placed crafting_table');
      return true;
    }
  } catch {}
  return false;
}

async function tryCraft(bot, itemName, qty = 1) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;
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
    if (!recipes?.length) return false;
    await bot.craft(recipes[0], qty, tableBlock || null);
    console.log('[PURE] CRAFT OK', itemName, 'x' + qty);
    if (itemName === 'crafting_table') await placeCraftingTable(bot);
    return true;
  } catch {
    return false;
  }
}

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
  // small chance to just wander even in early stages — keeps emergent feel
  if (stage !== 'explore' && Math.random() < 0.08) {
    console.log('[PURE] soft wander (emergent variance)');
    await walkRaw(bot, 2.0 + Math.random(), (Math.random() - 0.5) * 1.8);
    return true;
  }

  console.log('[PURE] STAGE', stage, 'y=' + bot.entity.position.y.toFixed(0));

  switch (stage) {
    case 'wood': {
      const log = bot.findBlock({
        matching: (b) => b && WOOD_LOG.test(b.name),
        maxDistance: 48,
      });
      if (log) {
        console.log('[PURE] target log', log.name);
        return await doCollect(bot, log);
      }
      console.log('[PURE] no log nearby — walkRaw search');
      await walkRaw(bot, 2.8 + Math.random(), (Math.random() - 0.5) * 1.6);
      return true;
    }
    case 'planks': {
      for (const p of [
        'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
        'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
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
      if (stone) return await doCollect(bot, stone);
      await walkRaw(bot, 2.4, (Math.random() - 0.5));
      return true;
    }
    case 'stone_pick':
      return await tryCraft(bot, 'stone_pickaxe', 1);
    case 'sword':
      return (
        (await tryCraft(bot, 'stone_sword', 1)) || (await tryCraft(bot, 'wooden_sword', 1))
      );
    case 'explore': {
      const hasPick = !!findItem(bot, /_pickaxe/);
      if (hasPick && Math.random() < 0.55) {
        const ore = bot.findBlock({
          matching: (b) =>
            b && /(iron|coal|copper|gold|diamond)_ore|deepslate_.*_ore/.test(b.name),
          maxDistance: 24,
        });
        if (ore) return await doCollect(bot, ore);
      }
      await walkRaw(bot, 2.6 + Math.random() * 1.2, (Math.random() - 0.5) * 2.2);
      return true;
    }
    default:
      return false;
  }
}

async function tossJunk(bot) {
  const dirt = items(bot).find((i) => /^(dirt|grass_block|coarse_dirt)$/.test(i.name));
  if (dirt && dirt.count > 18) {
    try {
      await bot.toss(dirt.type, null, Math.min(dirt.count - 16, 28));
    } catch {}
  }
}

export function startPureSurvival(agent) {
  const bot = agent?.bot || agent;
  if (!bot || bot._pureSurvival) return;
  bot._pureSurvival = true;
  bot._dreamPureOnly = true;

  ensurePlugins(bot);

  let busy = false;
  let lastPos = null;
  let stillSince = Date.now();
  let lastDecision = 0;
  const DECISION_MS = 850; // slightly faster recovery loop, still not frantic

  async function runOnce() {
    if (busy) return;
    if (!bot.entity) return;
    if (!isPlayable(bot)) {
      console.log('[PURE] not playable');
      return;
    }

    const pos = bot.entity.position;
    if (lastPos && pos.distanceTo(lastPos) < 0.35) {
      // 2.8s still → force recovery (was 3.5s)
      if (Date.now() - stillSince > 2800) {
        busy = true;
        bot._dreamBusy = true;
        try {
          await forceUnstuck(bot);
        } finally {
          busy = false;
          bot._dreamBusy = false;
          stillSince = Date.now();
          lastPos = bot.entity.position.clone();
        }
        return;
      }
    } else {
      lastPos = pos.clone();
      stillSince = Date.now();
    }

    busy = true;
    bot._dreamBusy = true;
    try {
      if (bot.food < 14 || bot.health < 12) {
        if (await doEat(bot)) return;
      }

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
        try { await bot.pvp.stop(); } catch {}
      }

      await tossJunk(bot);
      await runStage(bot, getStage(bot));
    } catch (e) {
      console.warn('[PURE]', String(e.message || e).slice(0, 80));
      await forceUnstuck(bot);
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
  setTimeout(() => runOnce().catch(() => {}), 1400);

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const m = String(message || '')
      .trim()
      .toLowerCase();
    if (m === 'pare' || m === 'stop') {
      stopNav(bot);
      try { bot.pvp?.stop?.(); } catch {}
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

  console.log('[PURE] v7 ON — stable recovery + emergent variance');
}
