/**
 * PASSIVE BRAIN — pure code, no LLM.
 * Fixes: infinite craft-fail loop, missing table for 3x3,
 * hole trap, auto-jump, skip failed recipes for a while.
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];
const FOOD_RE = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries/;

// Don't retry the same failed craft for 60s
const craftCooldown = new Map();

function items(bot) { return bot.inventory.items(); }
function count(bot, name) {
  return items(bot).filter(i => i.name === name).reduce((a, i) => a + i.count, 0);
}
function countRe(bot, re) {
  return items(bot).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}
function has(bot, name) { return items(bot).some(i => i.name === name); }
function hasRe(bot, re) { return items(bot).some(i => re.test(i.name)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function race(p, ms) {
  let t;
  try {
    return await Promise.race([p, new Promise((_, j) => { t = setTimeout(() => j(new Error('t')), ms); })]);
  } finally { if (t) clearTimeout(t); }
}

function canTryCraft(name) {
  const until = craftCooldown.get(name) || 0;
  return Date.now() >= until;
}
function markCraftFail(name) {
  craftCooldown.set(name, Date.now() + 60000); // skip 60s
}
function markCraftOk(name) {
  craftCooldown.delete(name);
}

async function goto(bot, x, y, z, r = 1) {
  try {
    if (typeof bot.dreamGoto === 'function') return await bot.dreamGoto(x, y, z, r);
    await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, r)), 20000);
    return true;
  } catch { return false; }
}

async function dig(bot, block) {
  if (!block || block.name === 'air' || block.name === 'cave_air') return false;
  try {
    const n = block.name || '';
    const inv = items(bot);
    let tool =
      /_log$|planks|leaves|bamboo/.test(n) ? inv.find(i => /_axe$/.test(i.name)) :
      /dirt|sand|gravel|grass|clay|mud|snow|soul_sand/.test(n) ? inv.find(i => /_shovel$/.test(i.name)) :
      inv.find(i => /_pickaxe$/.test(i.name));
    if (tool) { try { await bot.equip(tool, 'hand'); } catch {} }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block), 8000);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

function findBlock(bot, names, dist = 32) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    for (const name of names) {
      const id = mcData.blocksByName[name]?.id;
      if (id == null) continue;
      const found = bot.findBlocks({ matching: id, maxDistance: dist, count: 8 });
      for (const p of found) {
        const b = bot.blockAt(p);
        if (!b) continue;
        const under = bot.blockAt(p.offset(0, -1, 0));
        if (under && /water|lava/.test(under.name || '')) continue;
        return b;
      }
    }
  } catch {
    return bot.findBlock({ matching: b => b && names.includes(b.name), maxDistance: dist });
  }
  return null;
}

async function collect(bot, names, need, dist = 36) {
  let got = 0;
  while (got < need) {
    const b = findBlock(bot, names, dist);
    if (!b) break;
    const d = bot.entity.position.distanceTo(b.position);
    if (d > 3.2) await goto(bot, b.position.x, b.position.y, b.position.z, 2);
    if (await dig(bot, b)) {
      got++;
      // walk forward a bit to pick drops
      bot.setControlState('forward', true);
      await sleep(250);
      bot.clearControlStates();
    } else break;
  }
  return got > 0;
}

/** Ensure a crafting table is nearby for 3x3 recipes */
async function ensureTableNearby(bot) {
  const near = bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 4 });
  if (near) return near;

  // Place from inventory
  if (has(bot, 'crafting_table')) {
    try {
      const item = items(bot).find(i => i.name === 'crafting_table');
      await bot.equip(item, 'hand');
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (ref) {
        // place in front on ground
        const yaw = bot.entity.yaw;
        const fx = Math.round(-Math.sin(yaw));
        const fz = Math.round(-Math.cos(yaw));
        const against = bot.blockAt(bot.entity.position.offset(fx, -1, fz)) || ref;
        await bot.lookAt(against.position.offset(0.5, 1, 0.5), true);
        await race(bot.placeBlock(against, new (require('vec3').Vec3)(0, 1, 0)), 4000);
        console.log('[PASSIVE] placed crafting_table');
        await sleep(400);
        return bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 4 });
      }
    } catch (e) {
      console.warn('[PASSIVE] place table', (e.message || '').slice(0, 40));
    }
  }
  return null;
}

async function craft(bot, recipeName, n = 1) {
  if (!canTryCraft(recipeName)) return false;
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[recipeName];
    if (!item) {
      markCraftFail(recipeName);
      return false;
    }

    // 2x2 recipes (planks, sticks) — no table needed
    const needsTable = !/planks$|^stick$|^torch$/.test(recipeName);
    let table = null;
    if (needsTable) {
      table = await ensureTableNearby(bot);
      if (!table && !has(bot, 'crafting_table')) {
        // need to craft table first — don't spam pickaxe fails
        markCraftFail(recipeName);
        console.warn('[PASSIVE] no table for', recipeName);
        return false;
      }
      if (!table) table = await ensureTableNearby(bot);
    }

    const recipes = bot.recipesFor(item.id, null, 1, table || null);
    if (!recipes || !recipes.length) {
      console.warn('[PASSIVE] no recipe', recipeName);
      markCraftFail(recipeName);
      return false;
    }

    await race(bot.craft(recipes[0], n, table || null), 15000);
    markCraftOk(recipeName);
    console.log('[PASSIVE] craft OK', recipeName, 'x' + n);
    return true;
  } catch (e) {
    markCraftFail(recipeName);
    console.warn('[PASSIVE] craft fail', recipeName, (e.message || '').slice(0, 30));
    return false;
  }
}

async function eatIfNeeded(bot) {
  if (bot.food >= 16 && bot.health >= 14) return false;
  const food = items(bot).find(i => FOOD_RE.test(i.name));
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await race(bot.consume(), 4000);
    console.log('[PASSIVE] eat');
    return true;
  } catch { return false; }
}

async function equipBest(bot, kind) {
  const rank = (n) => {
    if (/netherite/.test(n)) return 6;
    if (/diamond/.test(n)) return 5;
    if (/iron/.test(n)) return 4;
    if (/stone/.test(n)) return 3;
    if (/gold/.test(n)) return 2;
    if (/wood|wooden/.test(n)) return 1;
    return 0;
  };
  const list = items(bot).filter(i => new RegExp(kind).test(i.name));
  if (!list.length) return false;
  list.sort((a, b) => rank(b.name) - rank(a.name));
  try {
    await bot.equip(list[0], 'hand');
    return true;
  } catch { return false; }
}

/** Detect 1-block hole / head blocked — dig out or tower */
async function escapeHole(bot) {
  try {
    const p = bot.entity.position;
    const feet = bot.blockAt(p.floored());
    const head = bot.blockAt(p.floored().offset(0, 1, 0));
    const above = bot.blockAt(p.floored().offset(0, 2, 0));
    const ground = bot.blockAt(p.floored().offset(0, -1, 0));

    // Head or body blocked (1-high space)
    const headSolid = head && head.boundingBox === 'block';
    const aboveSolid = above && above.boundingBox === 'block';
    const inHole =
      headSolid ||
      (ground && ground.boundingBox === 'block' &&
        bot.entity.position.y - Math.floor(bot.entity.position.y) < 0.2 &&
        (() => {
          // surrounding walls at feet level
          let walls = 0;
          for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const b = bot.blockAt(p.floored().offset(o[0], 0, o[1]));
            if (b && b.boundingBox === 'block') walls++;
          }
          return walls >= 3;
        })());

    if (!inHole && !headSolid) return false;

    console.log('[PASSIVE] escape hole/1-high');

    // 1) Dig head if blocked
    if (headSolid) await dig(bot, head);
    if (aboveSolid) await dig(bot, above);

    // 2) Dig sides to open exit
    for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const side = bot.blockAt(p.floored().offset(o[0], 0, o[1]));
      const sideUp = bot.blockAt(p.floored().offset(o[0], 1, o[1]));
      if (side && side.boundingBox === 'block') await dig(bot, side);
      if (sideUp && sideUp.boundingBox === 'block') await dig(bot, sideUp);
    }

    // 3) Tower up with dirt/cobble if still trapped
    const scaffold = items(bot).find(i =>
      /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff/.test(i.name)
    );
    if (scaffold) {
      try {
        await bot.equip(scaffold, 'hand');
        bot.setControlState('jump', true);
        await sleep(200);
        const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (under) {
          await bot.lookAt(under.position.offset(0.5, 1, 0.5), true);
          try {
            await race(bot.placeBlock(under, new (require('vec3').Vec3)(0, 1, 0)), 2000);
          } catch {}
        }
        bot.setControlState('jump', false);
      } catch {
        bot.clearControlStates();
      }
    }

    // 4) Walk out
    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    await sleep(400);
    bot.clearControlStates();
    return true;
  } catch {
    return false;
  }
}

/** Auto-jump like a player when a 1-block step is ahead */
function enableAutoJump(bot) {
  if (bot._dreamAutoJump) return;
  bot._dreamAutoJump = true;
  bot.on('physicsTick', () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (bot.targetDigBlock) return;
      if (!bot.controlState.forward && !bot.pathfinder?.isMoving?.()) return;

      const yaw = bot.entity.yaw;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const front = bot.blockAt(bot.entity.position.offset(dx * 0.8, 0, dz * 0.8));
      const frontUp = bot.blockAt(bot.entity.position.offset(dx * 0.8, 1, dz * 0.8));
      const step =
        front && front.boundingBox === 'block' &&
        (!frontUp || frontUp.boundingBox !== 'block');

      if (step && bot.entity.onGround) {
        bot.setControlState('jump', true);
        setTimeout(() => {
          try { bot.setControlState('jump', false); } catch {}
        }, 120);
      }
    } catch {}
  });
  console.log('[PASSIVE] auto-jump ON (1-block steps)');
}

/** Decision tree */
export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity || bot._dreamPvpActive) return;

  // Priority -1 — get out of hole BEFORE other tasks (prevents infinite stuck)
  if (await escapeHole(bot)) return;

  const logs = countRe(bot, /_log$/);
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const hasTableItem = has(bot, 'crafting_table');
  const tableNear = !!bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 6 });
  const woodPick = hasRe(bot, /wooden_pickaxe/);
  const stonePick = hasRe(bot, /stone_pickaxe/);
  const ironPick = hasRe(bot, /iron_pickaxe/);
  const anyPick = hasRe(bot, /pickaxe/);
  const anyAxe = hasRe(bot, /_axe$/);
  const anySword = hasRe(bot, /sword/);
  const iron = count(bot, 'iron_ingot');
  const rawIron = count(bot, 'raw_iron');
  const coal = count(bot, 'coal') + count(bot, 'charcoal');
  const hasFurnace = has(bot, 'furnace');

  if (await eatIfNeeded(bot)) return;

  // Wood
  if (logs < 8) {
    console.log('[PASSIVE] need wood');
    if (await collect(bot, WOOD, 3, 40)) return;
  }

  // Planks (2x2 — always works)
  if (logs >= 1 && planks < 20) {
    const logItem = items(bot).find(i => /_log$/.test(i.name));
    if (logItem) {
      const recipe = logItem.name.replace('_log', '_planks');
      if (await craft(bot, recipe, Math.min(4, logs))) return;
    }
  }

  // Crafting table item
  if (!hasTableItem && !tableNear && planks >= 4) {
    if (await craft(bot, 'crafting_table', 1)) return;
  }

  // Place table if we have it but none nearby
  if (hasTableItem && !tableNear) {
    await ensureTableNearby(bot);
  }

  // Sticks
  if (sticks < 12 && planks >= 2) {
    if (await craft(bot, 'stick', 4)) return;
  }

  // Wooden tools — only if no better pick AND canTry
  if (planks >= 3 && sticks >= 2 && !anyPick && canTryCraft('wooden_pickaxe')) {
    if (await craft(bot, 'wooden_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }
  if (planks >= 3 && sticks >= 2 && !anyAxe && canTryCraft('wooden_axe')) {
    if (await craft(bot, 'wooden_axe', 1)) return;
  }
  if (planks >= 2 && sticks >= 1 && !anySword && canTryCraft('wooden_sword')) {
    if (await craft(bot, 'wooden_sword', 1)) return;
  }

  // Mine stone
  if (anyPick && cobble < 24) {
    console.log('[PASSIVE] mine stone');
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['stone', 'cobblestone', 'deepslate'], 5, 28)) return;
  }

  // Stone tools — skip if already have or on cooldown
  if (cobble >= 3 && sticks >= 2 && !stonePick && !ironPick && canTryCraft('stone_pickaxe')) {
    if (await craft(bot, 'stone_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }
  if (cobble >= 3 && sticks >= 2 && !hasRe(bot, /stone_axe/) && canTryCraft('stone_axe')) {
    if (await craft(bot, 'stone_axe', 1)) return;
  }
  if (cobble >= 2 && sticks >= 1 && !hasRe(bot, /stone_sword/) && canTryCraft('stone_sword')) {
    if (await craft(bot, 'stone_sword', 1)) return;
  }

  // Furnace
  if (cobble >= 8 && !hasFurnace && canTryCraft('furnace')) {
    if (await craft(bot, 'furnace', 1)) return;
  }

  // Ore
  if (stonePick || ironPick) {
    if (coal < 6 && await collect(bot, ['coal_ore', 'deepslate_coal_ore'], 2, 24)) return;
    if (rawIron + iron < 5 && await collect(bot, ['iron_ore', 'deepslate_iron_ore'], 2, 24)) return;
  }

  // Iron pick
  if (iron >= 3 && sticks >= 2 && !ironPick && canTryCraft('iron_pickaxe')) {
    if (await craft(bot, 'iron_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }

  // Torches
  if (coal >= 1 && sticks >= 1 && count(bot, 'torch') < 12 && canTryCraft('torch')) {
    if (await craft(bot, 'torch', 4)) return;
  }

  // Explore — gentle, less anti-cheat spam
  console.log('[PASSIVE] explore');
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 0.7 : -0.7);
  try { await bot.look(yaw, 0, true); } catch {}
  const tx = bot.entity.position.x - Math.sin(yaw) * 8;
  const tz = bot.entity.position.z - Math.cos(yaw) * 8;
  await goto(bot, tx, bot.entity.position.y, tz, 2);
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;

  const bot = agent.bot;
  if (bot) {
    if (bot.entity) enableAutoJump(bot);
    else bot.once('spawn', () => enableAutoJump(bot));
  }

  const tick = async () => {
    try {
      if (!agent.bot?.entity) return;
      if (agent._passiveRunning) return;
      if (agent.bot._dreamPvpActive) return;
      if (agent.bot.targetDigBlock) return;

      agent._passiveRunning = true;
      await runPassiveSkillTick(agent);
    } catch (e) {
      console.warn('[PASSIVE]', e.message);
    } finally {
      agent._passiveRunning = false;
    }
  };

  setTimeout(tick, 2500);
  setInterval(tick, 6000);

  console.log('[PASSIVE] BRAIN ON — fail cooldown, table place, hole escape, auto-jump');
}
