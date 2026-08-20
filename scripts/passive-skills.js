/**
 * PASSIVE PROGRESSION — pure code. Continuous dig + collectblock when available.
 * Stages: wood → planks → table → sticks → tools → stone → ore → explore
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';
import { dryFeet, escapeHole, isTrapped } from './escape-hole.js';
import { runAutobotSkills } from './autobot-skills.js';
import { maybeBuildHouse } from './house-builder.js';
import * as DP from './dig-place.js';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;
const Vec3 = require('vec3').Vec3;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];
const FOOD_RE = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries|cookie|pie|stew|mushroom_stew|rabbit/;
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

function canTryCraft(name) { return Date.now() >= (craftCooldown.get(name) || 0); }
function markCraftFail(name) { craftCooldown.set(name, Date.now() + 30000); }
function markCraftOk(name) { craftCooldown.delete(name); }
function clearToolCraftCooldown() {
  for (const k of [...craftCooldown.keys()]) {
    if (/pickaxe|axe|sword|shovel|hoe/.test(k)) craftCooldown.delete(k);
  }
}

async function goto(bot, x, y, z, r = 1.5) {
  try {
    try { bot.setControlState('sprint', true); } catch {}
    if (typeof bot.dreamGoto === 'function') {
      const ok = await bot.dreamGoto(x, y, z, r);
      try { bot.setControlState('sprint', false); } catch {}
      return ok;
    }
    await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, r)), 20000);
    try { bot.setControlState('sprint', false); } catch {}
    return true;
  } catch {
    try { bot.setControlState('sprint', false); } catch {}
    return false;
  }
}

/** Continuous hold dig via dig-place */
async function dig(bot, block) {
  return DP.digBlock(bot, block);
}

async function collect(bot, names, need, dist = 36) {
  let got = 0;
  for (let i = 0; i < need; i++) {
    const ok = await DP.collectNearby(bot, names, dist);
    if (!ok) break;
    got++;
  }
  return got > 0;
}

async function eatIfNeeded(bot) {
  if ((bot.food ?? 20) >= 16 && (bot.health ?? 20) >= 14) return false;
  const food = items(bot).find(i => FOOD_RE.test(i.name));
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await race(bot.consume(), 5000);
    console.log('[PASSIVE] EAT', food.name);
    return true;
  } catch { return false; }
}

async function ensureTableNearby(bot) {
  const near = bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 4 });
  if (near) return near;
  if (!has(bot, 'crafting_table')) return null;
  try {
    const item = items(bot).find(i => i.name === 'crafting_table');
    await bot.equip(item, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref || ref.name === 'air') return null;
    await bot.lookAt(ref.position.offset(0.5, 1, 0.5), true);
    await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 4000);
    console.log('[PASSIVE] placed crafting_table');
    await sleep(300);
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
      if (!table && !has(bot, 'crafting_table')) {
        if (countRe(bot, /_planks$/) >= 4) {
          await craft(bot, 'crafting_table', 1);
          table = await ensureTableNearby(bot);
        }
        if (!table) { markCraftFail(recipeName); return false; }
      }
    }
    const recipes = bot.recipesFor(item.id, null, 1, table || null);
    if (!recipes?.length) { markCraftFail(recipeName); return false; }
    await race(bot.craft(recipes[0], n, table || null), 15000);
    markCraftOk(recipeName);
    console.log('[PASSIVE] craft OK', recipeName);
    return true;
  } catch (e) {
    markCraftFail(recipeName);
    console.warn('[PASSIVE] craft fail', recipeName, (e.message || '').slice(0, 40));
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

async function replaceBrokenTools(bot) {
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const iron = count(bot, 'iron_ingot');
  const anyPick = hasRe(bot, /pickaxe/);
  if (!anyPick) clearToolCraftCooldown();
  if (!anyPick) {
    if (iron >= 3 && sticks >= 2 && await craft(bot, 'iron_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    if (planks >= 3 && sticks >= 2 && await craft(bot, 'wooden_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return true; }
    return false;
  }
  if (!hasRe(bot, /_axe$/)) {
    if (cobble >= 3 && sticks >= 2 && await craft(bot, 'stone_axe', 1)) return true;
    if (planks >= 3 && sticks >= 2 && await craft(bot, 'wooden_axe', 1)) return true;
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
      const moving = !!(bot.controlState?.forward || bot.pathfinder?.isMoving?.());
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

function killChatting(agent) {
  try { agent.self_prompter?.stopLoop?.(); } catch {}
  try { agent.self_prompter?.stop?.(); } catch {}
  try { if (agent.self_prompter) agent.self_prompter.loop_active = false; } catch {}
}

export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity || bot._dreamPvpActive) return;

  killChatting(agent);

  // Escape first if trapped
  try {
    if (isTrapped(bot)) {
      console.log('[PASSIVE] TRAPPED → escape');
      try { bot.clearControlStates(); } catch {}
      if (bot.entity.isInWater) await dryFeet(bot);
      await escapeHole(bot);
      return;
    }
  } catch {}

  try {
    const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    const wet = bot.entity.isInWater || (under && /water/.test(under.name || ''));
    let walls = 0;
    const pf = bot.entity.position.floored();
    for (const o of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const b = bot.blockAt(pf.offset(o[0], 0, o[1]));
      if (b && b.boundingBox === 'block') walls++;
    }
    if (wet || walls >= 2) {
      console.log('[PASSIVE] escape wet/walls');
      if (wet) await dryFeet(bot);
      await escapeHole(bot);
      return;
    }
  } catch {}

  // Dig face if looking at solid
  try {
    const look = bot.blockAtCursor?.(3.5);
    if (look && look.boundingBox === 'block' && !/bedrock|barrier/.test(look.name || '')) {
      if (/_log$|dirt|grass|stone|cobble|ore|sand|gravel/.test(look.name)) {
        console.log('[PASSIVE] dig face', look.name);
        await dig(bot, look);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await sleep(300);
        bot.clearControlStates();
        return;
      }
    }
  } catch {}

  try { if (await runAutobotSkills(bot)) return; } catch {}
  try { if (await maybeBuildHouse(bot)) return; } catch {}
  if (await eatIfNeeded(bot)) return;
  if (await replaceBrokenTools(bot)) return;

  const logs = countRe(bot, /_log$/);
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const anyPick = hasRe(bot, /pickaxe/);
  const stonePick = hasRe(bot, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/);
  const iron = count(bot, 'iron_ingot');
  const rawIron = count(bot, 'raw_iron');

  // === PROGRESSION TREE ===
  if (logs < 8 && planks < 16) {
    console.log('[PASSIVE] STAGE wood');
    if (await collect(bot, WOOD, 2, 48)) return;
  }
  if (logs >= 1 && planks < 24) {
    const logItem = items(bot).find(i => /_log$/.test(i.name));
    if (logItem) {
      const recipe = logItem.name.replace('_log', '_planks');
      console.log('[PASSIVE] STAGE planks');
      if (await craft(bot, recipe, Math.min(4, logs))) return;
    }
  }
  if (!has(bot, 'crafting_table') && planks >= 4) {
    console.log('[PASSIVE] STAGE table');
    if (await craft(bot, 'crafting_table', 1)) return;
  }
  if (has(bot, 'crafting_table')) await ensureTableNearby(bot);
  if (sticks < 8 && planks >= 2) {
    console.log('[PASSIVE] STAGE sticks');
    if (await craft(bot, 'stick', 4)) return;
  }
  if (!anyPick && planks >= 3 && sticks >= 2) {
    console.log('[PASSIVE] STAGE wooden_pickaxe');
    if (await craft(bot, 'wooden_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }
  if (!hasRe(bot, /_axe$/) && planks >= 3 && sticks >= 2) {
    if (await craft(bot, 'wooden_axe', 1)) return;
  }
  if (anyPick && cobble < 20 && !stonePick) {
    console.log('[PASSIVE] STAGE stone');
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['stone', 'cobblestone', 'deepslate'], 4, 32)) return;
  }
  if (cobble >= 3 && sticks >= 2 && !stonePick) {
    console.log('[PASSIVE] STAGE stone_pickaxe');
    if (await craft(bot, 'stone_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }
  if (cobble >= 8 && !has(bot, 'furnace')) {
    if (await craft(bot, 'furnace', 1)) return;
  }
  if (stonePick && rawIron + iron < 6) {
    console.log('[PASSIVE] STAGE iron ore');
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['iron_ore', 'deepslate_iron_ore', 'coal_ore', 'deepslate_coal_ore'], 2, 36)) return;
  }
  if (iron >= 3 && sticks >= 2 && !hasRe(bot, /iron_pickaxe|diamond_pickaxe/)) {
    if (await craft(bot, 'iron_pickaxe', 1)) { await equipBest(bot, 'pickaxe'); return; }
  }

  // explore
  console.log('[PASSIVE] STAGE explore');
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 0.8 : -0.8);
  try { await bot.look(yaw, 0, true); } catch {}
  await DP.bridgeForward(bot, 2).catch(() => {});
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  const tx = bot.entity.position.x - Math.sin(yaw) * 8;
  const tz = bot.entity.position.z - Math.cos(yaw) * 8;
  await goto(bot, tx, bot.entity.position.y, tz, 2);
  await DP.digFrontWall(bot);
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;
  const bot = agent.bot;

  setTimeout(() => {
    try {
      if (bot && !bot.collectBlock) {
        bot.loadPlugin(require('mineflayer-collectblock').plugin);
        console.log('[PASSIVE] mineflayer-collectblock LOADED');
      }
    } catch (e) { console.warn('[PASSIVE] collectblock', (e.message || '').slice(0, 40)); }
    try {
      if (bot && !bot.tool) {
        bot.loadPlugin(require('mineflayer-tool').plugin);
        console.log('[PASSIVE] mineflayer-tool LOADED');
      }
    } catch (e) { console.warn('[PASSIVE] tool plugin optional', (e.message || '').slice(0, 40)); }
  }, 2500);

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
  setTimeout(tick, 2000);
  setInterval(tick, 3500);
  console.log('[PASSIVE] PROGRESSION ON — hold dig + collectblock + stages');
}
