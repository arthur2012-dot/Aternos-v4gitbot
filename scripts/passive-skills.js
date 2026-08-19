/**
 * PASSIVE-FIRST — pure ESM, acts without LLM
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;

const WOOD_LOGS = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];

function inv(bot) { return bot.inventory.items(); }
function count(bot, name) {
  return inv(bot).filter(i => i.name === name).reduce((a, i) => a + i.count, 0);
}
function has(bot, name) { return inv(bot).some(i => i.name === name); }
function countMatch(bot, re) {
  return inv(bot).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function withTimeout(promise, ms) {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function clearCtrl(bot) {
  try { bot.clearControlStates(); } catch {
    for (const c of ['forward','back','left','right','jump','sprint','sneak']) {
      try { bot.setControlState(c, false); } catch {}
    }
  }
}

async function walkTo(bot, pos, seconds = 8) {
  try {
    if (bot.dreamGoto) {
      await bot.dreamGoto(pos.x, pos.y, pos.z, 1);
      return true;
    }
    await withTimeout(
      bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)),
      seconds * 1000
    );
    return true;
  } catch {
    try {
      await bot.lookAt(pos.offset(0, 1, 0), true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(Math.min(seconds * 400, 2500));
      clearCtrl(bot);
    } catch {}
    return false;
  }
}

async function digBlock(bot, block) {
  if (!block) return false;
  try {
    const tool = inv(bot).find(i =>
      /_log$/.test(block.name) ? /axe/.test(i.name) : /pickaxe/.test(i.name)
    );
    if (tool) await bot.equip(tool, 'hand');
    await withTimeout(bot.dig(block), 8000);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
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
      const found = bot.findBlocks({ matching: id, maxDistance: dist, count: 3 });
      if (found.length) {
        block = bot.blockAt(found[0]);
        if (block) break;
      }
    }
  } catch {
    block = bot.findBlock({
      matching: (b) => b && names.some(n => b.name === n),
      maxDistance: dist,
    });
  }
  if (!block) return false;
  console.log('[PASSIVE] dig', block.name);
  if (bot.entity.position.distanceTo(block.position) > 3.5) {
    await walkTo(bot, block.position, 12);
  }
  const ok = await digBlock(bot, block);
  bot.setControlState('forward', true);
  await sleep(350);
  clearCtrl(bot);
  return ok;
}

async function tryCraft(bot, itemName, n = 1) {
  try {
    const skills = await import('./library/skills.js');
    await withTimeout(skills.craftRecipe(bot, itemName, n), 15000);
    console.log('[PASSIVE] craft', itemName);
    return true;
  } catch (e) {
    console.warn('[PASSIVE] craft fail', itemName);
    return false;
  }
}

async function forceMove(bot) {
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 1.0 : -1.0);
  try { await bot.look(yaw, 0, true); } catch {}
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await sleep(600);
  clearCtrl(bot);
  console.log('[PASSIVE] move');
}

export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity) return;
  if (bot._dreamPvpActive) return;

  const logs = countMatch(bot, /_log$/);
  const planks = countMatch(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const hasPick = inv(bot).some(i => /pickaxe/.test(i.name));
  const hasAxe = inv(bot).some(i => /axe/.test(i.name));
  const hasTable = has(bot, 'crafting_table');

  console.log('[PASSIVE] tick L=' + logs + ' P=' + planks + ' S=' + sticks + ' C=' + cobble);

  if (bot.food < 15) {
    const food = inv(bot).find(i => /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton/.test(i.name));
    if (food) {
      try {
        await bot.equip(food, 'hand');
        await withTimeout(bot.consume(), 4000);
        return;
      } catch {}
    }
  }

  if (logs < 10) {
    if (await findAndDig(bot, WOOD_LOGS, 40)) return;
  }
  if (logs >= 1 && planks < 20) {
    const w = inv(bot).find(i => /_log$/.test(i.name));
    if (w) {
      if (await tryCraft(bot, w.name.replace('_log', '_planks'), Math.min(3, logs))) return;
    }
  }
  if (!hasTable && planks >= 4) {
    if (await tryCraft(bot, 'crafting_table', 1)) return;
  }
  if (sticks < 8 && planks >= 2) {
    if (await tryCraft(bot, 'stick', 4)) return;
  }
  if (planks >= 3 && sticks >= 2 && !hasPick) {
    if (await tryCraft(bot, 'wooden_pickaxe', 1)) return;
  }
  if (planks >= 3 && sticks >= 2 && !hasAxe) {
    if (await tryCraft(bot, 'wooden_axe', 1)) return;
  }
  if (hasPick && cobble < 20) {
    if (await findAndDig(bot, ['stone', 'cobblestone', 'deepslate'], 28)) return;
  }
  if (cobble >= 3 && sticks >= 2 && !inv(bot).some(i => /stone_pickaxe/.test(i.name))) {
    if (await tryCraft(bot, 'stone_pickaxe', 1)) return;
  }
  await forceMove(bot);
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;

  const tick = async () => {
    try {
      if (!agent.bot?.entity) return;
      if (agent._passiveRunning) return;
      if (agent.bot._dreamPvpActive) return;
      if (agent.actions?.executing) return;
      agent._passiveRunning = true;
      await runPassiveSkillTick(agent);
    } catch (e) {
      console.warn('[PASSIVE]', e.message);
    } finally {
      agent._passiveRunning = false;
    }
  };

  setTimeout(tick, 5000);
  setInterval(tick, 9000);
  console.log('[PASSIVE] skills ON — acts without LLM');
}
