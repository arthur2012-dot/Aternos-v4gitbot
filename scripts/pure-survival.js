/**
 * pure-survival v6 — anti-freeze de andar
 * Bug: bot olha parede de terra 40s sem mexer → pathfinder falhou e travou
 * Fix: se posição não muda 3.5s → cancela path, gira, anda/pula, diga parede se bloquear
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

/** Bloco na cara (olhos / peito) */
function blockInFace(bot) {
  try {
    const p = bot.entity.position;
    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const eye = p.offset(dx * 0.8, 1.0, dz * 0.8);
    const b = bot.blockAt(eye.floored());
    if (b && b.boundingBox === 'block' && b.name !== 'air') return b;
    const chest = bot.blockAt(p.offset(dx * 0.8, 0.5, dz * 0.8).floored());
    if (chest && chest.boundingBox === 'block') return chest;
  } catch {}
  return null;
}

/**
 * Se parado olhando parede: dig 1–2 blocos OU gira e anda
 */
async function forceUnstuck(bot) {
  console.log('[PURE] UNSTUCK — was frozen facing terrain');
  await stopNav(bot);

  const face = blockInFace(bot);
  if (face && /dirt|grass|sand|gravel|clay|snow/.test(face.name)) {
    try {
      const shovel = findItem(bot, /_shovel/) || findItem(bot, /_pickaxe|_axe/);
      if (shovel) await bot.equip(shovel, 'hand');
      await bot.lookAt(face.position.offset(0.5, 0.5, 0.5), true);
      await race(bot.dig(face, true), 6000);
      console.log('[PURE] dug face', face.name);
    } catch {
      try {
        bot.stopDigging();
      } catch {}
    }
  }

  // gira 90–180° e anda com jump
  const newYaw = bot.entity.yaw + (Math.random() > 0.5 ? 1.2 : -1.2) + Math.PI * 0.3;
  try {
    await bot.look(newYaw, -0.2, true);
  } catch {}

  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  bot.setControlState('jump', true);
  await sleep(400);
  bot.setControlState('jump', false);
  await sleep(1200);
  bot.setControlState('jump', true);
  await sleep(300);
  bot.setControlState('jump', false);
  await sleep(800);
  bot.clearControlStates();

  // sobe 1 bloco se tiver degrau na frente
  try {
    const p = bot.entity.position.floored();
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const step = bot.blockAt(p.offset(dx, 0, dz));
    const stepUp = bot.blockAt(p.offset(dx, 1, dz));
    if (step && step.boundingBox === 'block' && (!stepUp || stepUp.name === 'air')) {
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await sleep(500);
      bot.clearControlStates();
    }
  } catch {}

  return true;
}

/** Andar sem pathfinder (controles crus) — evita trava em Goal */
async function walkRaw(bot, seconds = 2.5, yawOffset = 0) {
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
      await sleep(200);
      bot.setControlState('jump', false);
      // se ainda parede, dig
      const f = blockInFace(bot);
      if (f && /dirt|grass|sand|gravel/.test(f.name)) {
        bot.clearControlStates();
        try {
          await race(bot.dig(f, true), 4000);
        } catch {
          try {
            bot.stopDigging();
          } catch {}
        }
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
      }
    }
    if (Math.random() < 0.15 && bot.entity.onGround) {
      bot.setControlState('jump', true);
      await sleep(150);
      bot.setControlState('jump', false);
    }
    await sleep(200);
  }
  bot.clearControlStates();
}

async function gotoNear(bot, x, y, z, range = 2) {
  const start = bot.entity.position.clone();
  try {
    await race(bot.pathfinder.goto(new pfGoals.GoalNear(x, y, z, range)), 10000);
    return true;
  } catch {
    await stopNav(bot);
    // path falhou — anda na direção aproximada com controles
    const dx = x - bot.entity.position.x;
    const dz = z - bot.entity.position.z;
    const yaw = Math.atan2(-dx, -dz);
    try {
      await bot.look(yaw, 0, true);
    } catch {}
    await walkRaw(bot, 2.5, 0);
    const moved = bot.entity.position.distanceTo(start);
    if (moved < 1.2) await forceUnstuck(bot);
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
    await race(bot.dig(block, true), 10000);
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

    // timeout CURTO — não ficar 25s olhando árvore inacessível
    if (bot.collectBlock?.collect) {
      try {
        await race(bot.collectBlock.collect(block), 12000);
        console.log('[PURE] collectBlock', block.name);
        return true;
      } catch (e) {
        console.warn('[PURE] collect timeout/fail', String(e.message || e).slice(0, 40));
        await stopNav(bot);
      }
    }

    const ok = await gotoNear(
      bot,
      block.position.x,
      block.position.y,
      block.position.z,
      2
    );
    const still = bot.blockAt(block.position);
    if (still && still.name === block.name) {
      const dug = await digBlock(bot, still);
      if (dug) return true;
    }

    if (bot.entity.position.distanceTo(start) < 1.5) {
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
      // sem árvore: anda com controles (não pathfinder eterno)
      console.log('[PURE] no log nearby — walkRaw search');
      await walkRaw(bot, 3, (Math.random() - 0.5) * 1.5);
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
      await walkRaw(bot, 2.5, (Math.random() - 0.5));
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
      if (hasPick) {
        const ore = bot.findBlock({
          matching: (b) =>
            b && /(iron|coal|copper|gold|diamond)_ore|deepslate_.*_ore/.test(b.name),
          maxDistance: 24,
        });
        if (ore) return await doCollect(bot, ore);
      }
      await walkRaw(bot, 3, (Math.random() - 0.5) * 2);
      return true;
    }
    default:
      return false;
  }
}

async function tossJunk(bot) {
  const dirt = items(bot).find((i) => /^(dirt|grass_block|coarse_dirt)$/.test(i.name));
  if (dirt && dirt.count > 16) {
    try {
      await bot.toss(dirt.type, null, Math.min(dirt.count - 16, 32));
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
  const DECISION_MS = 900;

  async function runOnce() {
    if (busy) return;
    if (!bot.entity) return;
    if (!isPlayable(bot)) {
      console.log('[PURE] not playable');
      return;
    }

    const pos = bot.entity.position;
    if (lastPos && pos.distanceTo(lastPos) < 0.4) {
      if (Date.now() - stillSince > 3500) {
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

  bot.once('end', () => clearInterval(timer));
  setTimeout(() => runOnce().catch(() => {}), 1500);

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

  console.log('[PURE] v6 ON — anti-freeze walk + dig face wall | stages');
}
