/**
 * pure-survival v9 — Wall-Push Killer
 * Bug: bot presses forward into solid block and freezes (clipping illusion).
 * Fix: high-frequency face+velocity check → clear controls instantly,
 * dig soft face or Openness Scorer turn. Never keep pushing into wall.
 */

import pathfinderPkg from 'mineflayer-pathfinder';
const { goals: pfGoals, Movements, pathfinder } = pathfinderPkg;
import collectBlockPlugin from 'mineflayer-collectblock';
import pvpPlugin from 'mineflayer-pvp';
import { Vec3 } from 'vec3';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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

function horizontalSpeed(bot) {
  try {
    const v = bot.entity.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  } catch {
    return 0;
  }
}

/**
 * Robust face check — eye + chest + slight body probe.
 * Catches the "pushing into block" case even when slightly off-center.
 */
function blockInFace(bot, yawOverride = null) {
  try {
    const p = bot.entity.position;
    const yaw = yawOverride != null ? yawOverride : bot.entity.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);

    const probes = [
      p.offset(dx * 0.7, 1.05, dz * 0.7),
      p.offset(dx * 0.9, 0.6, dz * 0.9),
      p.offset(dx * 0.55, 0.3, dz * 0.55),
    ];

    for (const pt of probes) {
      const b = bot.blockAt(pt.floored());
      if (b && b.boundingBox === 'block' && b.name !== 'air' && b.name !== 'cave_air') {
        return b;
      }
    }
  } catch {}
  return null;
}

function isPushingWall(bot) {
  if (!bot?.entity) return false;
  if (bot._digLocked || bot.targetDigBlock) return false;
  const face = blockInFace(bot);
  if (!face) return false;
  const spd = horizontalSpeed(bot);
  // low speed + solid in face = classic wall-push freeze
  return spd < 0.08;
}

function chooseBestYaw(bot) {
  const base = bot.entity.yaw;
  // skip pure forward (0) first when already blocked — start from sides
  const offsets = [0.7, -0.7, 1.25, -1.25, 1.9, -1.9, Math.PI * 0.95, 0.35, -0.35];
  let bestYaw = base + 1.2;
  let bestScore = -999;

  for (const off of offsets) {
    const yaw = base + off;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let score = 0;

    for (let step = 1; step <= 3; step++) {
      const body = bot.blockAt(
        bot.entity.position.offset(dx * step, 0.25, dz * step).floored()
      );
      const head = bot.blockAt(
        bot.entity.position.offset(dx * step, 1.15, dz * step).floored()
      );

      const scoreBlock = (b) => {
        if (!b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air') return 14;
        if (b.boundingBox !== 'block') return 9;
        if (SOFT_FACE.test(b.name)) return 4;
        if (/water|lava/.test(b.name)) return -5;
        return -10;
      };

      score += scoreBlock(body) * (4 - step);
      score += scoreBlock(head) * (4 - step);
    }

    try {
      const interest = bot.findBlock({
        matching: (b) =>
          b &&
          (WOOD_LOG.test(b.name) ||
            /(iron|coal|copper)_ore|deepslate_.*_ore/.test(b.name)),
        maxDistance: 16,
      });
      if (interest) {
        const to = interest.position.offset(0.5, 0.5, 0.5).minus(bot.entity.position);
        const targetYaw = Math.atan2(-to.x, -to.z);
        let diff = Math.abs(((targetYaw - yaw + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (diff < 0.85) score += 5;
      }
    } catch {}

    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }

  return bestYaw;
}

/**
 * Instant wall-push recovery — the core fix.
 * 1) clear all movement
 * 2) dig soft face if diggable
 * 3) otherwise turn to best open yaw and step away
 */
async function breakWallPush(bot) {
  if (bot._wallBreakBusy) return false;
  bot._wallBreakBusy = true;
  try {
    console.log('[PURE] WALL-PUSH break');
    await stopNav(bot);
    try {
      bot.stopDigging?.();
    } catch {}

    const face = blockInFace(bot);
    if (face && SOFT_FACE.test(face.name)) {
      try {
        const tool =
          findItem(bot, /_shovel/) ||
          findItem(bot, /_pickaxe|_axe/) ||
          findItem(bot, /./);
        if (tool) await bot.equip(tool, 'hand');
        await bot.lookAt(face.position.offset(0.5, 0.5, 0.5), true);
        await race(bot.dig(face, true), 4500);
        console.log('[PURE] dug blocking', face.name);
        await sleep(80);
        return true;
      } catch {
        try {
          bot.stopDigging();
        } catch {}
      }
    }

    // hard wall or dig failed → turn to open space and step
    const best = chooseBestYaw(bot);
    try {
      await bot.look(best, -0.05, true);
    } catch {}

    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    bot.setControlState('jump', true);
    await sleep(280);
    bot.setControlState('jump', false);
    await sleep(450);
    bot.clearControlStates();

    // if still blocked after turn, one more hard stop
    if (isPushingWall(bot)) {
      await stopNav(bot);
      const alt = chooseBestYaw(bot);
      try {
        await bot.look(alt, 0, true);
      } catch {}
      bot.setControlState('back', true);
      await sleep(200);
      bot.clearControlStates();
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await sleep(350);
      bot.clearControlStates();
    }

    return true;
  } finally {
    bot._wallBreakBusy = false;
  }
}

async function forceUnstuck(bot) {
  console.log('[PURE] UNSTUCK');
  await stopNav(bot);

  if (isTrappedFn && isTrappedFn(bot) && escapeHoleFn) {
    try {
      const ok = await escapeHoleFn(bot);
      if (ok) return true;
    } catch (e) {
      console.warn('[PURE] escapeHole', (e.message || '').slice(0, 40));
    }
  }

  // prioritize wall-push kill
  if (isPushingWall(bot) || blockInFace(bot)) {
    return await breakWallPush(bot);
  }

  const best = chooseBestYaw(bot);
  try {
    await bot.look(best, -0.1, true);
  } catch {}

  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  bot.setControlState('jump', true);
  await sleep(300);
  bot.setControlState('jump', false);
  await sleep(900);
  bot.clearControlStates();
  return true;
}

async function walkRaw(bot, seconds = 2.4, yawOverride = null) {
  const yaw = yawOverride != null ? yawOverride : chooseBestYaw(bot);
  try {
    await bot.look(yaw, 0, true);
  } catch {}

  // never start walking into a wall
  if (blockInFace(bot, yaw)) {
    await breakWallPush(bot);
    return;
  }

  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  const end = Date.now() + seconds * 1000;

  while (Date.now() < end) {
    // CRITICAL: if pushing wall, abort forward immediately
    if (isPushingWall(bot) || (blockInFace(bot) && horizontalSpeed(bot) < 0.12)) {
      bot.clearControlStates();
      await breakWallPush(bot);
      // resume briefly in new direction
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(300);
      continue;
    }

    const f = blockInFace(bot);
    if (f) {
      if (SOFT_FACE.test(f.name)) {
        bot.clearControlStates();
        try {
          const tool = findItem(bot, /_shovel|_pickaxe|_axe/);
          if (tool) await bot.equip(tool, 'hand');
          await bot.lookAt(f.position.offset(0.5, 0.5, 0.5), true);
          await race(bot.dig(f, true), 3500);
        } catch {
          try {
            bot.stopDigging();
          } catch {}
        }
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
      } else {
        bot.clearControlStates();
        const better = chooseBestYaw(bot);
        try {
          await bot.look(better, 0, true);
        } catch {}
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
      }
    }

    if (bot.entity.onGround && Math.random() < 0.08) {
      bot.setControlState('jump', true);
      await sleep(120);
      bot.setControlState('jump', false);
    }
    await sleep(160);
  }
  bot.clearControlStates();
}

async function gotoNear(bot, x, y, z, range = 2) {
  const start = bot.entity.position.clone();
  try {
    await race(bot.pathfinder.goto(new pfGoals.GoalNear(x, y, z, range)), 8500);
    return true;
  } catch {
    await stopNav(bot);
    if (isPushingWall(bot)) {
      await breakWallPush(bot);
    }
    const dx = x - bot.entity.position.x;
    const dz = z - bot.entity.position.z;
    const yaw = Math.atan2(-dx, -dz);
    try {
      await bot.look(yaw, 0, true);
    } catch {}
    await walkRaw(bot, 2.2, yaw);
    const moved = bot.entity.position.distanceTo(start);
    if (moved < 1.0) await forceUnstuck(bot);
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
    await sleep(700);
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
    await race(bot.dig(block, true), 9000);
    console.log('[PURE] dug', block.name);
    return true;
  } catch (e) {
    try {
      bot.stopDigging();
    } catch {}
    return false;
  }
}

async function doCollect(bot, block) {
  if (!block) return false;
  const start = bot.entity.position.clone();
  try {
    if (bot.pvp?.target) {
      try {
        await bot.pvp.stop();
      } catch {}
    }
    await stopNav(bot);

    if (bot.collectBlock?.collect) {
      try {
        await race(bot.collectBlock.collect(block), 10000);
        console.log('[PURE] collectBlock', block.name);
        return true;
      } catch (e) {
        console.warn('[PURE] collect timeout/fail', String(e.message || e).slice(0, 40));
        await stopNav(bot);
      }
    }

    await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2);
    const still = bot.blockAt(block.position);
    if (still && still.name === block.name) {
      const dug = await digBlock(bot, still);
      if (dug) return true;
    }

    if (bot.entity.position.distanceTo(start) < 1.3 || isPushingWall(bot)) {
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
  const hasWoodPick = !!findItem(
    bot,
    /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/
  );
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
  if (stage !== 'explore' && Math.random() < 0.06) {
    await walkRaw(bot, 2.0);
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
      await walkRaw(bot, 2.8);
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
      if (stone) return await doCollect(bot, stone);
      await walkRaw(bot, 2.3);
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
      if (hasPick && Math.random() < 0.5) {
        const ore = bot.findBlock({
          matching: (b) =>
            b && /(iron|coal|copper|gold|diamond)_ore|deepslate_.*_ore/.test(b.name),
          maxDistance: 24,
        });
        if (ore) return await doCollect(bot, ore);
      }
      await walkRaw(bot, 2.7);
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
  const DECISION_MS = 800;

  // High-frequency wall-push watchdog (independent of main loop)
  const wallWatch = setInterval(async () => {
    try {
      if (!bot.entity || busy || bot._wallBreakBusy || bot._dreamPvpActive) return;
      if (bot._digLocked || bot.targetDigBlock) return;
      if (isPushingWall(bot)) {
        busy = true;
        bot._dreamBusy = true;
        try {
          await breakWallPush(bot);
        } finally {
          busy = false;
          bot._dreamBusy = false;
          stillSince = Date.now();
          if (bot.entity) lastPos = bot.entity.position.clone();
        }
      }
    } catch {}
  }, 400);

  async function runOnce() {
    if (busy) return;
    if (!bot.entity) return;
    if (!isPlayable(bot)) return;

    const pos = bot.entity.position;

    // faster still trigger when face is blocked
    const faceBlocked = !!blockInFace(bot);
    const stillLimit = faceBlocked ? 900 : 2600;

    if (lastPos && pos.distanceTo(lastPos) < 0.3) {
      if (Date.now() - stillSince > stillLimit) {
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

    // opportunistic wall check before any stage work
    if (isPushingWall(bot)) {
      busy = true;
      bot._dreamBusy = true;
      try {
        await breakWallPush(bot);
      } finally {
        busy = false;
        bot._dreamBusy = false;
      }
      return;
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
        try {
          await bot.pvp.stop();
        } catch {}
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

  bot.once('end', () => {
    clearInterval(timer);
    clearInterval(wallWatch);
  });
  setTimeout(() => runOnce().catch(() => {}), 1200);

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

  console.log('[PURE] v9 ON — wall-push killer + openness scorer');
}
