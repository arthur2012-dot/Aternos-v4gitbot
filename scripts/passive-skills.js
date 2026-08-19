/**
 * PASSIVE BRAIN — pure code, no LLM.
 * Tool break: detect missing tools, clear craft cooldown, re-craft ASAP.
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];
const FOOD_RE = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries/;

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
  craftCooldown.set(name, Date.now() + 45000);
}
function markCraftOk(name) {
  craftCooldown.delete(name);
}
/** When a tool breaks, allow re-craft immediately */
function clearToolCraftCooldown() {
  for (const k of [...craftCooldown.keys()]) {
    if (/pickaxe|axe|sword|shovel|hoe/.test(k)) craftCooldown.delete(k);
  }
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
      bot.setControlState('forward', true);
      await sleep(250);
      bot.clearControlStates();
    } else break;
  }
  return got > 0;
}

async function ensureTableNearby(bot) {
  const near = bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 4 });
  if (near) return near;

  if (has(bot, 'crafting_table')) {
    try {
      const item = items(bot).find(i => i.name === 'crafting_table');
      await bot.equip(item, 'hand');
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (ref) {
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

    const needsTable = !/planks$|^stick$|^torch$/.test(recipeName);
    let table = null;
    if (needsTable) {
      table = await ensureTableNearby(bot);
      if (!table && !has(bot, 'crafting_table')) {
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

/** Tool almost broken? (durability < 15%) */
function almostBroken(bot, kindRe) {
  try {
    const list = items(bot).filter(i => kindRe.test(i.name));
    for (const it of list) {
      const max = it.maxDurability ?? it.durability ?? 0;
      const used = it.durabilityUsed ?? 0;
      if (max > 0 && (max - used) / max < 0.15) return true;
    }
  } catch {}
  return false;
}

/**
 * If pickaxe/axe/sword is missing (broke), clear cooldown and craft the best available.
 * Returns true if it started a replace craft.
 */
async function replaceBrokenTools(bot) {
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const iron = count(bot, 'iron_ingot');
  const anyPick = hasRe(bot, /pickaxe/);
  const anyAxe = hasRe(bot, /_axe$/);
  const anySword = hasRe(bot, /sword/);
  const stonePick = hasRe(bot, /stone_pickaxe/);
  const ironPick = hasRe(bot, /iron_pickaxe/);

  // Tool gone → allow craft again
  if (!anyPick || !anyAxe || !anySword) {
    clearToolCraftCooldown();
  }

  // Priority: pickaxe first (needed for stone)
  if (!anyPick) {
    console.log('[PASSIVE] pickaxe BROKEN/missing → replace');
    if (iron >= 3 && sticks >= 2) {
      if (await craft(bot, 'iron_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    }
    if (cobble >= 3 && sticks >= 2) {
      if (await craft(bot, 'stone_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    }
    if (planks >= 3 && sticks >= 2) {
      if (await craft(bot, 'wooden_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    }
    // No mats → gather wood first next ticks
    return false;
  }

  // Spare if almost broken
  if (almostBroken(bot, /pickaxe/) && !ironPick) {
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_pickaxe', 1)) {
      console.log('[PASSIVE] spare pickaxe (low durability)');
      return true;
    }
  }

  if (!anyAxe) {
    console.log('[PASSIVE] axe BROKEN/missing → replace');
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_axe', 1)) return true;
    if (planks >= 3 && sticks >= 2 && await craft(bot, 'wooden_axe', 1)) return true;
  }

  if (!anySword) {
    if (cobble >= 2 && sticks >= 1 && await craft(bot, 'stone_sword', 1)) return true;
    if (planks >= 2 && sticks >= 1 && await craft(bot, 'wooden_sword', 1)) return true;
  }

  return false;
}

async function escapeHole(bot) {
  try {
    const p = bot.entity.position;
    const head = bot.blockAt(p.floored().offset(0, 1, 0));
    const above = bot.blockAt(p.floored().offset(0, 2, 0));
    const ground = bot.blockAt(p.floored().offset(0, -1, 0));

    const headSolid = head && head.boundingBox === 'block';
    const aboveSolid = above && above.boundingBox === 'block';
    const inHole =
      headSolid ||
      (ground && ground.boundingBox === 'block' &&
        bot.entity.position.y - Math.floor(bot.entity.position.y) < 0.2 &&
        (() => {
          let walls = 0;
          for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const b = bot.blockAt(p.floored().offset(o[0], 0, o[1]));
            if (b && b.boundingBox === 'block') walls++;
          }
          return walls >= 3;
        })());

    if (!inHole && !headSolid) return false;

    console.log('[PASSIVE] escape hole/1-high');
    if (headSolid) await dig(bot, head);
    if (aboveSolid) await dig(bot, above);

    for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const side = bot.blockAt(p.floored().offset(o[0], 0, o[1]));
      const sideUp = bot.blockAt(p.floored().offset(o[0], 1, o[1]));
      if (side && side.boundingBox === 'block') await dig(bot, side);
      if (sideUp && sideUp.boundingBox === 'block') await dig(bot, sideUp);
    }

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

    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    await sleep(400);
    bot.clearControlStates();
    return true;
  } catch {
    return false;
  }
}

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
  console.log('[PASSIVE] auto-jump ON');
}

/** Watch inventory: tool disappeared → log + clear cooldown */
function watchToolBreak(bot) {
  if (bot._dreamToolWatch) return;
  bot._dreamToolWatch = true;
  let lastPicks = 0;
  setInterval(() => {
    try {
      if (!bot.entity) return;
      const picks = items(bot).filter(i => /pickaxe/.test(i.name)).length;
      if (lastPicks > 0 && picks === 0) {
        console.log('[PASSIVE] pickaxe broke!');
        clearToolCraftCooldown();
      }
      lastPicks = picks;
    } catch {}
  }, 2000);
}

export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity || bot._dreamPvpActive) return;

  if (await escapeHole(bot)) return;

  const logs = countRe(bot, /_log$/);
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const hasTableItem = has(bot, 'crafting_table');
  const tableNear = !!bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 6 });
  const anyPick = hasRe(bot, /pickaxe/);
  const stonePick = hasRe(bot, /stone_pickaxe/);
  const ironPick = hasRe(bot, /iron_pickaxe/);
  const iron = count(bot, 'iron_ingot');
  const rawIron = count(bot, 'raw_iron');
  const coal = count(bot, 'coal') + count(bot, 'charcoal');
  const hasFurnace = has(bot, 'furnace');

  if (await eatIfNeeded(bot)) return;

  // HIGH PRIORITY: replace broken tools before anything else
  if (await replaceBrokenTools(bot)) return;

  if (logs < 8) {
    console.log('[PASSIVE] need wood');
    if (await collect(bot, WOOD, 3, 40)) return;
  }

  if (logs >= 1 && planks < 20) {
    const logItem = items(bot).find(i => /_log$/.test(i.name));
    if (logItem) {
      const recipe = logItem.name.replace('_log', '_planks');
      if (await craft(bot, recipe, Math.min(4, logs))) return;
    }
  }

  if (!hasTableItem && !tableNear && planks >= 4) {
    if (await craft(bot, 'crafting_table', 1)) return;
  }
  if (hasTableItem && !tableNear) {
    await ensureTableNearby(bot);
  }

  if (sticks < 12 && planks >= 2) {
    if (await craft(bot, 'stick', 4)) return;
  }

  // Normal tool progression (only if still missing after replaceBrokenTools)
  if (planks >= 3 && sticks >= 2 && !anyPick && canTryCraft('wooden_pickaxe')) {
    if (await craft(bot, 'wooden_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }

  if (anyPick && cobble < 24) {
    console.log('[PASSIVE] mine stone');
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['stone', 'cobblestone', 'deepslate'], 5, 28)) return;
  }

  if (cobble >= 3 && sticks >= 2 && !stonePick && !ironPick && canTryCraft('stone_pickaxe')) {
    if (await craft(bot, 'stone_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }

  if (cobble >= 8 && !hasFurnace && canTryCraft('furnace')) {
    if (await craft(bot, 'furnace', 1)) return;
  }

  if (stonePick || ironPick) {
    if (coal < 6 && await collect(bot, ['coal_ore', 'deepslate_coal_ore'], 2, 24)) return;
    if (rawIron + iron < 5 && await collect(bot, ['iron_ore', 'deepslate_iron_ore'], 2, 24)) return;
  }

  if (iron >= 3 && sticks >= 2 && !ironPick && canTryCraft('iron_pickaxe')) {
    if (await craft(bot, 'iron_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }

  if (coal >= 1 && sticks >= 1 && count(bot, 'torch') < 12 && canTryCraft('torch')) {
    if (await craft(bot, 'torch', 4)) return;
  }

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
    if (bot.entity) {
      enableAutoJump(bot);
      watchToolBreak(bot);
    } else {
      bot.once('spawn', () => {
        enableAutoJump(bot);
        watchToolBreak(bot);
      });
    }
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

  console.log('[PASSIVE] BRAIN ON — tool break replace + fail cooldown + hole + auto-jump');
}
