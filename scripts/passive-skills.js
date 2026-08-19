/**
 * PASSIVE BRAIN — pure code, no LLM wait.
 * Inspired by: Voyager skill curriculum, minecraft-agent-swarm tech-tree,
 * mindcraft skills, classic AFK bots (mine + craft loop).
 * Goal: act every few seconds with clear priority — faster than active mode.
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;

const WOOD = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'];
const FOOD_RE = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries/;

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

async function goto(bot, x, y, z, r = 1) {
  try {
    if (typeof bot.dreamGoto === 'function') return await bot.dreamGoto(x, y, z, r);
    await race(bot.pathfinder.goto(new goals.GoalNear(x, y, z, r)), 20000);
    return true;
  } catch { return false; }
}

async function dig(bot, block) {
  if (!block) return false;
  try {
    const n = block.name || '';
    const inv = items(bot);
    let tool =
      /_log$|planks|leaves/.test(n) ? inv.find(i => /_axe$/.test(i.name)) :
      /dirt|sand|gravel|grass|clay|mud/.test(n) ? inv.find(i => /_shovel$/.test(i.name)) :
      inv.find(i => /_pickaxe$/.test(i.name));
    if (tool) { try { await bot.equip(tool, 'hand'); } catch {} }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block), 7000);
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
      const found = bot.findBlocks({ matching: id, maxDistance: dist, count: 6 });
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
    if (d > 3.5) await goto(bot, b.position.x, b.position.y, b.position.z, 2);
    if (await dig(bot, b)) {
      got++;
      bot.setControlState('forward', true);
      await sleep(200);
      bot.clearControlStates();
    } else break;
  }
  return got > 0;
}

async function craft(bot, recipeName, n = 1) {
  try {
    const skills = await import('./library/skills.js');
    await race(skills.craftRecipe(bot, recipeName, n), 12000);
    console.log('[PASSIVE] craft', recipeName, 'x' + n);
    return true;
  } catch (e) {
    console.warn('[PASSIVE] craft fail', recipeName);
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

/** Decision tree — always returns true if did something */
export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity || bot._dreamPvpActive) return;

  const logs = countRe(bot, /_log$/);
  const planks = countRe(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const hasTable = has(bot, 'crafting_table');
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

  // Priority 0 — survive
  if (await eatIfNeeded(bot)) return;

  // Priority 1 — wood stock
  if (logs < 12) {
    console.log('[PASSIVE] need wood');
    if (await collect(bot, WOOD, 4, 40)) return;
  }

  // Priority 2 — planks
  if (logs >= 1 && planks < 24) {
    const logItem = items(bot).find(i => /_log$/.test(i.name));
    if (logItem) {
      const recipe = logItem.name.replace('_log', '_planks');
      if (await craft(bot, recipe, Math.min(4, logs))) return;
    }
  }

  // Priority 3 — crafting table
  if (!hasTable && planks >= 4) {
    if (await craft(bot, 'crafting_table', 1)) return;
  }

  // Priority 4 — sticks
  if (sticks < 16 && planks >= 2) {
    if (await craft(bot, 'stick', 4)) return;
  }

  // Priority 5 — wooden tools
  if (planks >= 3 && sticks >= 2 && !woodPick && !stonePick && !ironPick) {
    if (await craft(bot, 'wooden_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }
  if (planks >= 3 && sticks >= 2 && !anyAxe) {
    if (await craft(bot, 'wooden_axe', 1)) return;
  }
  if (planks >= 2 && sticks >= 1 && !anySword) {
    if (await craft(bot, 'wooden_sword', 1)) return;
  }

  // Priority 6 — mine stone
  if (anyPick && cobble < 32) {
    console.log('[PASSIVE] mine stone');
    await equipBest(bot, 'pickaxe');
    if (await collect(bot, ['stone', 'cobblestone', 'deepslate'], 6, 28)) return;
  }

  // Priority 7 — stone tools
  if (cobble >= 3 && sticks >= 2 && !stonePick && !ironPick) {
    if (await craft(bot, 'stone_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }
  if (cobble >= 3 && sticks >= 2 && !hasRe(bot, /stone_axe/)) {
    if (await craft(bot, 'stone_axe', 1)) return;
  }
  if (cobble >= 2 && sticks >= 1 && !hasRe(bot, /stone_sword/)) {
    if (await craft(bot, 'stone_sword', 1)) return;
  }
  if (cobble >= 3 && sticks >= 2 && !hasRe(bot, /stone_shovel/)) {
    if (await craft(bot, 'stone_shovel', 1)) return;
  }

  // Priority 8 — furnace
  if (cobble >= 8 && !hasFurnace) {
    if (await craft(bot, 'furnace', 1)) return;
  }

  // Priority 9 — coal + iron ore
  if (stonePick || ironPick) {
    if (coal < 8) {
      if (await collect(bot, ['coal_ore', 'deepslate_coal_ore'], 3, 24)) return;
    }
    if (rawIron + iron < 6) {
      if (await collect(bot, ['iron_ore', 'deepslate_iron_ore'], 3, 24)) return;
    }
  }

  // Priority 10 — smelt
  if (hasFurnace && (rawIron > 0 || items(bot).some(i => /raw_|porkchop|beef|chicken|mutton|cod|salmon/.test(i.name)))) {
    try {
      const skills = await import('./library/skills.js');
      if (typeof skills.smeltItem === 'function') {
        const raw = items(bot).find(i => /raw_iron|porkchop|beef|chicken|mutton|cod|salmon/.test(i.name));
        if (raw) {
          await race(skills.smeltItem(bot, raw.name, 1), 60000);
          console.log('[PASSIVE] smelt', raw.name);
          return;
        }
      }
    } catch {}
  }

  // Priority 11 — iron pick
  if (iron >= 3 && sticks >= 2 && !ironPick) {
    if (await craft(bot, 'iron_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }

  // Priority 12 — torches
  if (coal >= 1 && sticks >= 1 && count(bot, 'torch') < 16) {
    if (await craft(bot, 'torch', 4)) return;
  }

  // Priority 13 — place table if in inv and none nearby
  if (has(bot, 'crafting_table')) {
    try {
      const near = bot.findBlock({ matching: b => b?.name === 'crafting_table', maxDistance: 8 });
      if (!near) {
        const skills = await import('./library/skills.js');
        if (typeof skills.placeBlock === 'function') {
          await skills.placeBlock(bot, 'crafting_table', bot.entity.position.offset(1, 0, 0));
          console.log('[PASSIVE] place table');
          return;
        }
      }
    } catch {}
  }

  // Priority 14 — explore move (always do something)
  console.log('[PASSIVE] explore');
  const yaw = bot.entity.yaw + (Math.random() > 0.5 ? 0.9 : -0.9);
  try { await bot.look(yaw, 0, true); } catch {}
  const tx = bot.entity.position.x - Math.sin(yaw) * 10;
  const tz = bot.entity.position.z - Math.cos(yaw) * 10;
  await goto(bot, tx, bot.entity.position.y, tz, 2);
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;

  let consecutive = 0;

  const tick = async () => {
    try {
      if (!agent.bot?.entity) return;
      if (agent._passiveRunning) return;
      if (agent.bot._dreamPvpActive) return;
      // Don't wait forever on actions — only skip if truly mid-dig from pathfinder
      if (agent.bot.targetDigBlock) return;

      agent._passiveRunning = true;
      consecutive++;
      await runPassiveSkillTick(agent);
    } catch (e) {
      console.warn('[PASSIVE]', e.message);
    } finally {
      agent._passiveRunning = false;
    }
  };

  // Fast: first action 2s, then every 5s (was 9s+)
  setTimeout(tick, 2000);
  setInterval(tick, 5000);

  console.log('[PASSIVE] BRAIN ON — pure code, 5s cycle, full tech tree');
}
