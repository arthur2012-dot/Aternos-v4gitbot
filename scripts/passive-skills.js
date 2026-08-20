/**
 * PASSIVE BRAIN — pure code + autobot + house. Kills Chatting lock.
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';
import { dryFeet, escapeHole } from './escape-hole.js';
import { runAutobotSkills } from './autobot-skills.js';
import { maybeBuildHouse } from './house-builder.js';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;
const Vec3 = require('vec3').Vec3;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];
const FOOD_RE = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries|cookie|pie|stew|mushroom_stew|rabbit|tropical_fish/;
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
    await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, r)), 15000);
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
    await race(bot.dig(block), 10000);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
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
      for (const pos of found) {
        const b = bot.blockAt(pos);
        if (!b) continue;
        const under = bot.blockAt(pos.offset(0, -1, 0));
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
      bot.setControlState('sprint', true);
      await sleep(250);
      bot.clearControlStates();
    } else break;
  }
  return got > 0;
}

async function eatIfNeeded(bot) {
  if (bot.food >= 18 && bot.health >= 16) return false;
  const food = items(bot).find(i => FOOD_RE.test(i.name));
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await race(bot.consume(), 5000);
    console.log('[PASSIVE] EAT', food.name);
    return true;
  } catch { return false; }
}

async function emergencyFood(bot) {
  if (bot.health > 8 && bot.food > 6) return false;
  console.log('[PASSIVE] EMERGENCY food');
  if (await eatIfNeeded(bot)) return true;
  return true;
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
    await bot.lookAt(ref.position.offset(0.5, 1, 0.5), true);
    await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 4000);
    console.log('[PASSIVE] placed crafting_table');
    await sleep(400);
    return bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 4 });
  } catch { return null; }
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
      if (!table && !has(bot, 'crafting_table')) { markCraftFail(recipeName); return false; }
      if (!table) table = await ensureTableNearby(bot);
    }
    const recipes = bot.recipesFor(item.id, null, 1, table || null);
    if (!recipes?.length) { markCraftFail(recipeName); return false; }
    await race(bot.craft(recipes[0], n, table || null), 15000);
    markCraftOk(recipeName);
    console.log('[PASSIVE] craft OK', recipeName);
    return true;
  } catch (e) {
    markCraftFail(recipeName);
    return false;
  }
}

async function equipBest(bot, kind) {
  const rank = (n) => /netherite/.test(n) ? 6 : /diamond/.test(n) ? 5 : /iron/.test(n) ? 4 : /stone/.test(n) ? 3 : /gold/.test(n) ? 2 : /wood|wooden/.test(n) ? 1 : 0;
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
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_axe', 1)) return true;
    if (planks >= 3 && sticks >= 2 && await craft(bot, 'wooden_axe', 1)) return true;
  }
  if (!anySword) {
    if (cobble >= 2 && sticks >= 1 && await craft(bot, 'stone_sword', 1)) return true;
    if (planks >= 2 && sticks >= 1 && await craft(bot, 'wooden_sword', 1)) return true;
  }
  return false;
}

function enableAutoJump(bot) {
  if (bot._dreamAutoJump) return;
  bot._dreamAutoJump = true;
  let lastJump = 0;
  bot.on('physicsTick', () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (bot.targetDigBlock) return;
      const moving = !!(bot.controlState.forward || bot.pathfinder?.isMoving?.());
      if (moving && bot.entity.onGround && !bot.entity.isInWater) bot.setControlState('sprint', true);
      const yaw = bot.entity.yaw;
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      const front = bot.blockAt(bot.entity.position.offset(dx * 0.9, 0, dz * 0.9));
      const frontUp = bot.blockAt(bot.entity.position.offset(dx * 0.9, 1, dz * 0.9));
      const blocked = front && front.boundingBox === 'block';
      const canStep = blocked && (!frontUp || frontUp.boundingBox !== 'block');
      const now = Date.now();
      if (canStep && bot.entity.onGround && moving && now - lastJump > 250) {
        bot.setControlState('jump', true);
        lastJump = now;
        setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 140);
      }
    } catch {}
  });
}

function watchToolBreak(bot) {
  if (bot._dreamToolWatch) return;
  bot._dreamToolWatch = true;
  let lastPicks = 0;
  setInterval(() => {
    try {
      if (!bot.entity) return;
      const picks = items(bot).filter(i => /pickaxe/.test(i.name)).length;
      if (lastPicks > 0 && picks === 0) clearToolCraftCooldown();
      lastPicks = picks;
    } catch {}
  }, 2000);
}

function killChatting(agent) {
  try { agent.self_prompter?.stopLoop?.(); } catch {}
  try { agent.self_prompter?.stop?.(); } catch {}
  try { if (agent.self_prompter) agent.self_prompter.loop_active = false; } catch {}
  try { agent.actions?.stop?.(); } catch {}
  try { agent.coder?.stop?.(); } catch {}
}

export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity || bot._dreamPvpActive) return;

  // Always free body from Chatting/Thinking lock
  killChatting(agent);

  try {
    const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    const wet = bot.entity.isInWater || (under && /water/.test(under.name || ''));
    let walls = 0;
    const pf = bot.entity.position.floored();
    for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const b = bot.blockAt(pf.offset(o[0], 0, o[1]));
      if (b && b.boundingBox === 'block') walls++;
    }
    const invCount = bot.inventory.items().reduce((a, i) => a + i.count, 0);
    const posKey = pf.x + ',' + pf.y + ',' + pf.z;
    if (!bot._passiveLastPos) bot._passiveLastPos = posKey;
    if (!bot._passiveStillTicks) bot._passiveStillTicks = 0;
    if (bot._passiveLastPos === posKey) bot._passiveStillTicks++;
    else { bot._passiveStillTicks = 0; bot._passiveLastPos = posKey; }
    const stuckIdle = bot._passiveStillTicks >= 2;

    if (wet || walls >= 2 || stuckIdle || invCount < 8) {
      try { bot.clearControlStates(); } catch {}
      if (wet || walls >= 2) {
        console.log('[PASSIVE] escape (wet/walls) — killed Chatting');
        if (wet) await dryFeet(bot);
        await escapeHole(bot);
        return;
      }
      if (stuckIdle) {
        console.log('[PASSIVE] stuck idle → dig + sprint (killed Chatting)');
        try {
          const look = bot.blockAtCursor?.(4);
          if (look && look.boundingBox === 'block' && !/bedrock|barrier/.test(look.name || '')) {
            await dig(bot, look);
          }
        } catch {}
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        bot.setControlState('jump', true);
        await sleep(600);
        bot.clearControlStates();
        bot._passiveStillTicks = 0;
        return;
      }
    }
  } catch {}

  if (bot._navBusy || bot.dreamIsNavigating?.()) {
    try {
      const look = bot.blockAtCursor?.(4);
      if (look && (/_log$/.test(look.name) || look.name === 'stone' || look.name === 'cobblestone' || /ore/.test(look.name))) {
        await dig(bot, look);
        return;
      }
    } catch {}
    if (await escapeHole(bot)) return;
    return;
  }

  if (await escapeHole(bot)) return;
  try { if (await runAutobotSkills(bot)) return; } catch (e) { console.warn('[AUTO]', (e.message || '').slice(0, 40)); }
  try { if (await maybeBuildHouse(bot)) return; } catch (e) { console.warn('[HOUSE]', (e.message || '').slice(0, 40)); }
  if (await emergencyFood(bot)) return;
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
  if (!has(bot, 'chest') && planks >= 8 && canTryCraft('chest')) {
    if (await craft(bot, 'chest', 1)) return;
  }
  if (stonePick || ironPick || diaPick) {
    if (coal < 10 && await collect(bot, ['coal_ore', 'deepslate_coal_ore'], 2, 24)) return;
    if (rawIron + iron < 8 && await collect(bot, ['iron_ore', 'deepslate_iron_ore'], 2, 24)) return;
  }
  if (iron >= 3 && sticks >= 2 && !ironPick && !diaPick && canTryCraft('iron_pickaxe')) {
    if (await craft(bot, 'iron_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }
  if ((ironPick || diaPick) && diamonds < 5) {
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['diamond_ore', 'deepslate_diamond_ore'], 1, 40)) return;
  }
  if (diamonds >= 3 && sticks >= 2 && !diaPick && canTryCraft('diamond_pickaxe')) {
    if (await craft(bot, 'diamond_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }
  if (coal >= 1 && sticks >= 1 && count(bot, 'torch') < 20 && canTryCraft('torch')) {
    if (await craft(bot, 'torch', 4)) return;
  }

  if (bot._navBusy) return;
  console.log('[PASSIVE] explore short');
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 0.9 : -0.9);
  try { await bot.look(yaw, 0, true); } catch {}
  await bridgeGap(bot);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  const tx = bot.entity.position.x - Math.sin(yaw) * 6;
  const tz = bot.entity.position.z - Math.cos(yaw) * 6;
  await goto(bot, tx, bot.entity.position.y, tz, 2);
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;
  const bot = agent.bot;
  if (bot) {
    if (bot.entity) { enableAutoJump(bot); watchToolBreak(bot); }
    else bot.once('spawn', () => { enableAutoJump(bot); watchToolBreak(bot); });
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
  setTimeout(tick, 1500);
  setInterval(tick, 2500);
  console.log('[PASSIVE] BRAIN ON — kills Chatting + house + autobot');
}
