/**
 * PASSIVE BRAIN — pure code, no LLM.
 * Above Altera Builder Bot + path toward beating the game (diamonds).
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;
const Vec3 = require('vec3').Vec3;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];
const FOOD_RE = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries/;
const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate/;

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
  return Date.now() >= (craftCooldown.get(name) || 0);
}
function markCraftFail(name) { craftCooldown.set(name, Date.now() + 45000); }
function markCraftOk(name) { craftCooldown.delete(name); }
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
    await race(bot.dig(block), 12000);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

async function placeAt(bot, refBlock, faceVec) {
  if (!refBlock) return false;
  try {
    const build = items(bot).find(i => BUILD_RE.test(i.name));
    if (!build) return false;
    await bot.equip(build, 'hand');
    await bot.lookAt(refBlock.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.placeBlock(refBlock, faceVec), 3500);
    return true;
  } catch { return false; }
}

async function bridgeGap(bot) {
  try {
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const feet = bot.entity.position.floored();
    const next = feet.offset(dx, -1, dz);
    const underNext = bot.blockAt(next);
    const airish = !underNext || underNext.name === 'air' || underNext.name === 'cave_air' || underNext.name === 'water';
    if (!airish) return false;
    const build = items(bot).find(i => BUILD_RE.test(i.name));
    if (!build || build.count < 1) return false;
    console.log('[PASSIVE] bridge gap');
    await bot.equip(build, 'hand');
    const edge = bot.blockAt(feet.offset(0, -1, 0));
    if (!edge) return false;
    await bot.lookAt(next.offset(0.5, 1, 0.5), true);
    bot.setControlState('sneak', true);
    await sleep(80);
    try {
      await race(bot.placeBlock(edge, new Vec3(dx, 0, dz)), 2500);
    } catch {
      try { await race(bot.placeBlock(edge, new Vec3(0, 1, 0)), 2000); } catch {}
    }
    bot.setControlState('sneak', false);
    bot.setControlState('forward', true);
    await sleep(200);
    bot.clearControlStates();
    return true;
  } catch {
    bot.clearControlStates();
    return false;
  }
}

function findBlock(bot, names, dist = 32) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    for (const name of names) {
      const id = mcData.blocksByName[name]?.id;
      if (id == null) continue;
      const found = bot.findBlocks({ matching: id, maxDistance: dist, count: 12 });
      for (const p of found) {
        const b = bot.blockAt(p);
        if (!b) continue;
        const under = bot.blockAt(p.offset(0, -1, 0));
        if (under && /lava/.test(under.name || '')) continue;
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
  if (!has(bot, 'crafting_table')) return null;
  try {
    const item = items(bot).find(i => i.name === 'crafting_table');
    await bot.equip(item, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref) return null;
    const yaw = bot.entity.yaw;
    const fx = Math.round(-Math.sin(yaw));
    const fz = Math.round(-Math.cos(yaw));
    const against = bot.blockAt(bot.entity.position.offset(fx, -1, fz)) || ref;
    await bot.lookAt(against.position.offset(0.5, 1, 0.5), true);
    await race(bot.placeBlock(against, new Vec3(0, 1, 0)), 4000);
    console.log('[PASSIVE] placed crafting_table');
    await sleep(400);
    return bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 4 });
  } catch (e) {
    console.warn('[PASSIVE] place table', (e.message || '').slice(0, 40));
    return null;
  }
}

async function craft(bot, recipeName, n = 1) {
  if (!canTryCraft(recipeName)) return false;
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[recipeName];
    if (!item) { markCraftFail(recipeName); return false; }
    const needsTable = !/planks$|^stick$|^torch$/.test(recipeName);
    let table = null;
    if (needsTable) {
      table = await ensureTableNearby(bot);
      if (!table && !has(bot, 'crafting_table')) {
        markCraftFail(recipeName);
        return false;
      }
      if (!table) table = await ensureTableNearby(bot);
    }
    const recipes = bot.recipesFor(item.id, null, 1, table || null);
    if (!recipes?.length) { markCraftFail(recipeName); return false; }
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
  try { await bot.equip(list[0], 'hand'); return true; } catch { return false; }
}

function almostBroken(bot, kindRe) {
  try {
    for (const it of items(bot).filter(i => kindRe.test(i.name))) {
      const max = it.maxDurability ?? it.durability ?? 0;
      const used = it.durabilityUsed ?? 0;
      if (max > 0 && (max - used) / max < 0.15) return true;
    }
  } catch {}
  return false;
}

async function replaceBrokenTools(bot) {
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const iron = count(bot, 'iron_ingot');
  const diamonds = count(bot, 'diamond');
  const anyPick = hasRe(bot, /pickaxe/);
  const anyAxe = hasRe(bot, /_axe$/);
  const anySword = hasRe(bot, /sword/);
  const ironPick = hasRe(bot, /iron_pickaxe/);
  const diaPick = hasRe(bot, /diamond_pickaxe/);

  if (!anyPick || !anyAxe || !anySword) clearToolCraftCooldown();

  if (!anyPick) {
    console.log('[PASSIVE] pickaxe BROKEN/missing → replace');
    if (diamonds >= 3 && sticks >= 2 && await craft(bot, 'diamond_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    if (iron >= 3 && sticks >= 2 && await craft(bot, 'iron_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    if (planks >= 3 && sticks >= 2 && await craft(bot, 'wooden_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    return false;
  }
  if (almostBroken(bot, /pickaxe/) && !diaPick) {
    if (iron >= 3 && sticks >= 2 && await craft(bot, 'iron_pickaxe', 1)) return true;
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_pickaxe', 1)) return true;
  }
  if (!anyAxe) {
    if (iron >= 3 && sticks >= 2 && await craft(bot, 'iron_axe', 1)) return true;
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_axe', 1)) return true;
    if (planks >= 3 && sticks >= 2 && await craft(bot, 'wooden_axe', 1)) return true;
  }
  if (!anySword) {
    if (iron >= 2 && sticks >= 1 && await craft(bot, 'iron_sword', 1)) return true;
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
    console.log('[PASSIVE] escape hole');
    if (headSolid) await dig(bot, head);
    if (aboveSolid) await dig(bot, above);
    for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const side = bot.blockAt(p.floored().offset(o[0], 0, o[1]));
      const sideUp = bot.blockAt(p.floored().offset(o[0], 1, o[1]));
      if (side?.boundingBox === 'block') await dig(bot, side);
      if (sideUp?.boundingBox === 'block') await dig(bot, sideUp);
    }
    const scaffold = items(bot).find(i => BUILD_RE.test(i.name));
    if (scaffold) {
      try {
        await bot.equip(scaffold, 'hand');
        bot.setControlState('jump', true);
        await sleep(200);
        const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (under) {
          await bot.lookAt(under.position.offset(0.5, 1, 0.5), true);
          try { await race(bot.placeBlock(under, new Vec3(0, 1, 0)), 2000); } catch {}
        }
        bot.setControlState('jump', false);
      } catch { bot.clearControlStates(); }
    }
    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    await sleep(400);
    bot.clearControlStates();
    return true;
  } catch { return false; }
}

async function buildShelter(bot, agent) {
  if (bot._dreamHomeBuilt || agent._dreamHomeBuilt) return false;
  const buildItems = items(bot).filter(i => BUILD_RE.test(i.name));
  const totalBlocks = buildItems.reduce((a, i) => a + i.count, 0);
  if (totalBlocks < 40) return false;
  const origin = bot.entity.position.floored();
  const ground = bot.blockAt(origin.offset(0, -1, 0));
  if (!ground || ground.boundingBox !== 'block') return false;

  console.log('[PASSIVE] building HOUSE 5x5');
  const size = 5;
  let placed = 0;

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const pos = origin.offset(x, -1, z);
      const b = bot.blockAt(pos);
      if (b && b.name !== 'air' && b.boundingBox === 'block') continue;
      const below = bot.blockAt(pos.offset(0, -1, 0));
      const ref = below && below.boundingBox === 'block' ? below : ground;
      if (bot.entity.position.distanceTo(pos) > 3.5) await goto(bot, pos.x, origin.y, pos.z, 2);
      if (await placeAt(bot, ref, new Vec3(0, 1, 0))) placed++;
      await sleep(50);
    }
  }

  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < size; x++) {
      for (const z of [0, size - 1]) {
        if (z === 0 && x === 2) continue;
        const pos = origin.offset(x, y, z);
        if (bot.blockAt(pos)?.boundingBox === 'block') continue;
        const ref = bot.blockAt(pos.offset(0, -1, 0));
        if (!ref || ref.boundingBox !== 'block') continue;
        if (bot.entity.position.distanceTo(pos) > 3.5) await goto(bot, pos.x, origin.y, pos.z, 2);
        if (await placeAt(bot, ref, new Vec3(0, 1, 0))) placed++;
        await sleep(40);
      }
    }
    for (let z = 1; z < size - 1; z++) {
      for (const x of [0, size - 1]) {
        const pos = origin.offset(x, y, z);
        if (bot.blockAt(pos)?.boundingBox === 'block') continue;
        const ref = bot.blockAt(pos.offset(0, -1, 0));
        if (!ref || ref.boundingBox !== 'block') continue;
        if (bot.entity.position.distanceTo(pos) > 3.5) await goto(bot, pos.x, origin.y, pos.z, 2);
        if (await placeAt(bot, ref, new Vec3(0, 1, 0))) placed++;
        await sleep(40);
      }
    }
  }

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const pos = origin.offset(x, 2, z);
      if (bot.blockAt(pos)?.boundingBox === 'block') continue;
      const ref = bot.blockAt(pos.offset(0, -1, 0));
      if (!ref || ref.boundingBox !== 'block') continue;
      if (bot.entity.position.distanceTo(pos) > 3.5) await goto(bot, pos.x, origin.y + 1, pos.z, 2);
      if (await placeAt(bot, ref, new Vec3(0, 1, 0))) placed++;
      await sleep(40);
    }
  }

  if (count(bot, 'torch') > 0) {
    try {
      const torch = items(bot).find(i => i.name === 'torch');
      if (torch) {
        await bot.equip(torch, 'hand');
        const wall = bot.blockAt(origin.offset(1, 1, 1));
        if (wall) {
          await bot.lookAt(wall.position.offset(0.5, 0.5, 0.5), true);
          try { await race(bot.placeBlock(wall, new Vec3(0, 0, 1)), 2000); } catch {}
        }
      }
    } catch {}
  }

  const home = origin.offset(2, 0, 2);
  bot._dreamHome = home;
  bot._dreamHomeBuilt = true;
  agent._dreamHomeBuilt = true;
  agent._dreamHome = home;
  console.log('[PASSIVE] HOUSE DONE placed~', placed, 'home', home.x, home.y, home.z);
  return true;
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
      const step = front && front.boundingBox === 'block' && (!frontUp || frontUp.boundingBox !== 'block');
      if (step && bot.entity.onGround) {
        bot.setControlState('jump', true);
        setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 120);
      }
    } catch {}
  });
  console.log('[PASSIVE] auto-jump ON');
}

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
  if (await bridgeGap(bot)) return;

  const logs = countRe(bot, /_log$/);
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const hasTableItem = has(bot, 'crafting_table');
  const tableNear = !!bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 6 });
  const anyPick = hasRe(bot, /pickaxe/);
  const stonePick = hasRe(bot, /stone_pickaxe/);
  const ironPick = hasRe(bot, /iron_pickaxe/);
  const diaPick = hasRe(bot, /diamond_pickaxe/);
  const iron = count(bot, 'iron_ingot');
  const rawIron = count(bot, 'raw_iron');
  const diamonds = count(bot, 'diamond');
  const coal = count(bot, 'coal') + count(bot, 'charcoal');
  const hasFurnace = has(bot, 'furnace');
  const buildCount = items(bot).filter(i => BUILD_RE.test(i.name)).reduce((a, i) => a + i.count, 0);

  if (await eatIfNeeded(bot)) return;
  if (await replaceBrokenTools(bot)) return;

  if (logs < 10) {
    console.log('[PASSIVE] need wood');
    if (await collect(bot, WOOD, 3, 40)) return;
  }

  if (logs >= 1 && planks < 32) {
    const logItem = items(bot).find(i => /_log$/.test(i.name));
    if (logItem) {
      const recipe = logItem.name.replace('_log', '_planks');
      if (await craft(bot, recipe, Math.min(4, logs))) return;
    }
  }

  if (!hasTableItem && !tableNear && planks >= 4) {
    if (await craft(bot, 'crafting_table', 1)) return;
  }
  if (hasTableItem && !tableNear) await ensureTableNearby(bot);

  if (sticks < 16 && planks >= 2) {
    if (await craft(bot, 'stick', 4)) return;
  }

  if (planks >= 3 && sticks >= 2 && !anyPick && canTryCraft('wooden_pickaxe')) {
    if (await craft(bot, 'wooden_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }

  if (anyPick && cobble < 32) {
    console.log('[PASSIVE] mine stone');
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['stone', 'cobblestone', 'deepslate'], 6, 28)) return;
  }

  if (cobble >= 3 && sticks >= 2 && !stonePick && !ironPick && !diaPick && canTryCraft('stone_pickaxe')) {
    if (await craft(bot, 'stone_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }

  if (cobble >= 8 && !hasFurnace && canTryCraft('furnace')) {
    if (await craft(bot, 'furnace', 1)) return;
  }

  if (stonePick || ironPick || diaPick) {
    if (coal < 10 && await collect(bot, ['coal_ore', 'deepslate_coal_ore'], 2, 24)) return;
    if (rawIron + iron < 8 && await collect(bot, ['iron_ore', 'deepslate_iron_ore'], 2, 24)) return;
  }

  if (iron >= 3 && sticks >= 2 && !ironPick && !diaPick && canTryCraft('iron_pickaxe')) {
    if (await craft(bot, 'iron_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }
  if (iron >= 2 && sticks >= 1 && !hasRe(bot, /iron_sword/) && canTryCraft('iron_sword')) {
    if (await craft(bot, 'iron_sword', 1)) return;
  }

  // DIAMONDS — path toward zerar (3 IAs short style)
  if (ironPick || diaPick) {
    if (diamonds < 5) {
      console.log('[PASSIVE] hunt diamonds');
      await equipBest(bot, 'pickaxe');
      // prefer deep levels: go down if high
      if (bot.entity.position.y > 20) {
        const below = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
        if (below && /stone|deepslate|dirt|grass/.test(below.name)) {
          // strip mine style: dig forward at y~12 if possible later
        }
      }
      if (await collect(bot, ['diamond_ore', 'deepslate_diamond_ore'], 1, 40)) return;
    }
  }

  if (diamonds >= 3 && sticks >= 2 && !diaPick && canTryCraft('diamond_pickaxe')) {
    if (await craft(bot, 'diamond_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      console.log('[PASSIVE] DIAMOND PICK');
      return;
    }
  }
  if (diamonds >= 2 && sticks >= 1 && !hasRe(bot, /diamond_sword/) && canTryCraft('diamond_sword')) {
    if (await craft(bot, 'diamond_sword', 1)) return;
  }

  if (coal >= 1 && sticks >= 1 && count(bot, 'torch') < 20 && canTryCraft('torch')) {
    if (await craft(bot, 'torch', 4)) return;
  }

  if (!bot._dreamHomeBuilt && buildCount >= 40 && anyPick) {
    if (await buildShelter(bot, agent)) return;
  }

  const time = bot.time?.timeOfDay ?? 0;
  if (bot._dreamHome && (time > 12000 || bot.health < 10)) {
    const h = bot._dreamHome;
    console.log('[PASSIVE] return home');
    await goto(bot, h.x, h.y, h.z, 2);
    return;
  }

  // Cave explore when iron+ (look for diamonds)
  if (ironPick || diaPick) {
    console.log('[PASSIVE] cave explore');
    const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.2;
    try { await bot.look(yaw, 0.15, true); } catch {}
    await bridgeGap(bot);
    const ty = Math.max(8, bot.entity.position.y - (Math.random() > 0.6 ? 2 : 0));
    const tx = bot.entity.position.x - Math.sin(yaw) * 12;
    const tz = bot.entity.position.z - Math.cos(yaw) * 12;
    await goto(bot, tx, ty, tz, 2);
    return;
  }

  console.log('[PASSIVE] explore');
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 0.7 : -0.7);
  try { await bot.look(yaw, 0, true); } catch {}
  await bridgeGap(bot);
  const tx = bot.entity.position.x - Math.sin(yaw) * 10;
  const tz = bot.entity.position.z - Math.cos(yaw) * 10;
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
  console.log('[PASSIVE] BRAIN ON — house + diamonds + combo path (above 3 IAs early game)');
}
