/**
 * PASSIVE-FIRST survival — works with ZERO LLM.
 * Digs wood, crafts, mines, moves. Never idle for long.
 */

const WOOD_LOGS = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];

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
  try {
    bot.clearControlStates();
  } catch {
    for (const c of ['forward','back','left','right','jump','sprint','sneak']) {
      try { bot.setControlState(c, false); } catch {}
    }
  }
}

async function walkTo(bot, pos, seconds = 8) {
  try {
    const { goals } = require('mineflayer-pathfinder');
    const g = new goals.GoalNear(pos.x, pos.y, pos.z, 1);
    await withTimeout(bot.pathfinder.goto(g), seconds * 1000);
    return true;
  } catch {
    // manual walk
    try {
      await bot.lookAt(pos.offset(0, 1, 0), true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(Math.min(seconds * 400, 3000));
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
  console.log('[PASSIVE] goto dig', block.name, block.position);
  const d = bot.entity.position.distanceTo(block.position);
  if (d > 3.5) await walkTo(bot, block.position, 12);
  const ok = await digBlock(bot, block);
  // pickup
  bot.setControlState('forward', true);
  await sleep(400);
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
    console.warn('[PASSIVE] craft fail', itemName, (e.message || '').slice(0, 40));
    return false;
  }
}

async function forceMove(bot) {
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 1.2 : -1.2);
  try { await bot.look(yaw, 0, true); } catch {}
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await sleep(800);
  clearCtrl(bot);
  console.log('[PASSIVE] force move');
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

  console.log('[PASSIVE] tick logs=' + logs + ' planks=' + planks + ' sticks=' + sticks + ' cobble=' + cobble);

  // Eat
  if (bot.food < 15) {
    const food = inv(bot).find(i => /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton/.test(i.name));
    if (food) {
      try {
        await bot.equip(food, 'hand');
        await withTimeout(bot.consume(), 4000);
        console.log('[PASSIVE] ate');
        return;
      } catch {}
    }
  }

  // 1) Get wood
  if (logs < 10) {
    if (await findAndDig(bot, WOOD_LOGS, 40)) return;
  }

  // 2) Planks from logs
  if (logs >= 1 && planks < 20) {
    const w = inv(bot).find(i => /_log$/.test(i.name));
    if (w) {
      const recipe = w.name.replace('_log', '_planks');
      if (await tryCraft(bot, recipe, Math.min(3, logs))) return;
    }
  }

  // 3) Crafting table
  if (!hasTable && planks >= 4) {
    if (await tryCraft(bot, 'crafting_table', 1)) return;
  }

  // 4) Sticks
  if (sticks < 8 && planks >= 2) {
    if (await tryCraft(bot, 'stick', 4)) return;
  }

  // 5) Wooden tools
  if (planks >= 3 && sticks >= 2 && !hasPick) {
    if (await tryCraft(bot, 'wooden_pickaxe', 1)) return;
  }
  if (planks >= 3 && sticks >= 2 && !hasAxe) {
    if (await tryCraft(bot, 'wooden_axe', 1)) return;
  }
  if (planks >= 2 && sticks >= 1 && !inv(bot).some(i => /sword/.test(i.name))) {
    if (await tryCraft(bot, 'wooden_sword', 1)) return;
  }

  // 6) Stone
  if (hasPick && cobble < 20) {
    if (await findAndDig(bot, ['stone', 'cobblestone', 'deepslate'], 28)) return;
  }

  // 7) Stone tools
  if (cobble >= 3 && sticks >= 2 && !inv(bot).some(i => /stone_pickaxe/.test(i.name))) {
    if (await tryCraft(bot, 'stone_pickaxe', 1)) return;
  }

  // 8) Always move if nothing else
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
      // Allow even if pathfinder moving slowly — only skip if actively digging via actions
      if (agent.actions?.executing) return;

      agent._passiveRunning = true;
      await runPassiveSkillTick(agent);
    } catch (e) {
      console.warn('[PASSIVE]', e.message);
    } finally {
      agent._passiveRunning = false;
    }
  };

  // First tick soon, then every 9s
  setTimeout(tick, 4000);
  setInterval(tick, 9000);

  console.log('[PASSIVE] skills ON — acts without LLM');
}
