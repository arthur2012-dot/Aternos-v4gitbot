/**
 * PASSIVE — uses dig-place helpers
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';
import { digBlock } from './dig-place.js';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];

function inv(bot) { return bot.inventory.items(); }
function countMatch(bot, re) {
  return inv(bot).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}
function count(bot, name) {
  return inv(bot).filter(i => i.name === name).reduce((a, i) => a + i.count, 0);
}
function has(bot, name) { return inv(bot).some(i => i.name === name); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withTimeout(p, ms) {
  let t;
  try {
    return await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('t')), ms); })]);
  } finally { if (t) clearTimeout(t); }
}

async function walkTo(bot, pos) {
  try {
    if (bot.dreamGoto) return bot.dreamGoto(pos.x, pos.y, pos.z, 1);
    await withTimeout(bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)), 12000);
    return true;
  } catch {
    try {
      await bot.lookAt(pos.offset(0, 1, 0), true);
      bot.setControlState('forward', true);
      await sleep(800);
      bot.clearControlStates();
    } catch {}
    return false;
  }
}

async function findAndDig(bot, names, dist = 32) {
  let block = null;
  try {
    const mcData = require('minecraft-data')(bot.version);
    for (const name of names) {
      const id = mcData.blocksByName[name]?.id;
      if (id == null) continue;
      const found = bot.findBlocks({ matching: id, maxDistance: dist, count: 4 });
      if (found.length) {
        block = bot.blockAt(found[0]);
        if (block) break;
      }
    }
  } catch {
    block = bot.findBlock({ matching: b => b && names.includes(b.name), maxDistance: dist });
  }
  if (!block) return false;
  console.log('[PASSIVE] dig', block.name);
  if (bot.entity.position.distanceTo(block.position) > 3.2) {
    await walkTo(bot, block.position);
  }
  const ok = await digBlock(bot, block);
  bot.setControlState('forward', true);
  await sleep(250);
  bot.clearControlStates();
  return ok;
}

async function tryCraft(bot, name, n = 1) {
  try {
    const skills = await import('./library/skills.js');
    await withTimeout(skills.craftRecipe(bot, name, n), 12000);
    console.log('[PASSIVE] craft', name);
    return true;
  } catch {
    return false;
  }
}

export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity || bot._dreamPvpActive) return;

  const logs = countMatch(bot, /_log$/);
  const planks = countMatch(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const hasPick = inv(bot).some(i => /pickaxe/.test(i.name));

  console.log('[PASSIVE] L=' + logs + ' P=' + planks + ' C=' + cobble);

  if (logs < 10 && (await findAndDig(bot, WOOD, 40))) return;
  if (logs >= 1 && planks < 20) {
    const w = inv(bot).find(i => /_log$/.test(i.name));
    if (w && (await tryCraft(bot, w.name.replace('_log', '_planks'), Math.min(3, logs)))) return;
  }
  if (!has(bot, 'crafting_table') && planks >= 4 && (await tryCraft(bot, 'crafting_table', 1))) return;
  if (sticks < 8 && planks >= 2 && (await tryCraft(bot, 'stick', 4))) return;
  if (planks >= 3 && sticks >= 2 && !hasPick && (await tryCraft(bot, 'wooden_pickaxe', 1))) return;
  if (hasPick && cobble < 20 && (await findAndDig(bot, ['stone', 'cobblestone', 'deepslate'], 28))) return;
  if (cobble >= 3 && sticks >= 2 && !inv(bot).some(i => /stone_pickaxe/.test(i.name))) {
    if (await tryCraft(bot, 'stone_pickaxe', 1)) return;
  }

  try {
    await bot.look(bot.entity.yaw + 1, 0, true);
    bot.setControlState('forward', true);
    await sleep(500);
    bot.clearControlStates();
  } catch {}
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;
  const tick = async () => {
    try {
      if (!agent.bot?.entity || agent._passiveRunning || agent.bot._dreamPvpActive) return;
      if (agent.actions?.executing) return;
      agent._passiveRunning = true;
      await runPassiveSkillTick(agent);
    } catch (e) {
      console.warn('[PASSIVE]', e.message);
    } finally {
      agent._passiveRunning = false;
    }
  };
  setTimeout(tick, 4000);
  setInterval(tick, 8500);
  console.log('[PASSIVE] ON');
}
