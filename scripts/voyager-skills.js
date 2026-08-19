/**
 * Voyager-inspired automatic curriculum + skill library (MineDojo Voyager ideas).
 *
 * Real Voyager needs GPT-4 + embedding DB + code generation loop.
 * Here we ship a fixed skill library + curriculum that runs WITHOUT LLM (passive)
 * and guides the LLM when active.
 *
 * Skills mirror Voyager milestones: wood → tools → stone → iron → shelter → explore.
 */

const SKILL_LIBRARY = [
  { id: 'collect_wood', desc: 'Chop nearby logs', need: [], check: (inv) => count(inv, /_log$/) >= 8 },
  { id: 'craft_planks', desc: 'Craft planks from logs', need: ['collect_wood'], check: (inv) => count(inv, /_planks$/) >= 8 },
  { id: 'craft_table', desc: 'Craft and place crafting table', need: ['craft_planks'], check: (inv) => count(inv, 'crafting_table') >= 1 || true },
  { id: 'craft_sticks', desc: 'Craft sticks', need: ['craft_planks'], check: (inv) => count(inv, 'stick') >= 4 },
  { id: 'wooden_pickaxe', desc: 'Craft wooden pickaxe', need: ['craft_sticks'], check: (inv) => has(inv, /wooden_pickaxe|stone_pickaxe|iron_pickaxe/) },
  { id: 'mine_stone', desc: 'Mine cobblestone', need: ['wooden_pickaxe'], check: (inv) => count(inv, 'cobblestone') >= 12 },
  { id: 'stone_tools', desc: 'Craft stone pickaxe and sword', need: ['mine_stone'], check: (inv) => has(inv, /stone_pickaxe|iron_pickaxe/) },
  { id: 'furnace', desc: 'Craft furnace', need: ['mine_stone'], check: (inv) => count(inv, 'furnace') >= 1 },
  { id: 'food', desc: 'Get food and eat when hungry', need: [], check: () => true },
  { id: 'shelter', desc: 'Build simple shelter', need: ['stone_tools'], check: () => false },
  { id: 'explore', desc: 'Explore and gather iron', need: ['stone_tools'], check: (inv) => has(inv, /iron_/) },
];

function count(inv, pat) {
  const re = typeof pat === 'string' ? new RegExp('^' + pat + '$') : pat;
  return inv.filter(i => re.test(i.name)).reduce((s, i) => s + i.count, 0);
}
function has(inv, pat) {
  return inv.some(i => pat.test(i.name));
}

function nextSkill(bot) {
  const inv = bot.inventory.items();
  for (const sk of SKILL_LIBRARY) {
    if (sk.check(inv)) continue;
    const needsOk = sk.need.every(id => {
      const dep = SKILL_LIBRARY.find(s => s.id === id);
      return !dep || dep.check(inv);
    });
    if (needsOk) return sk;
  }
  return SKILL_LIBRARY[SKILL_LIBRARY.length - 1];
}

async function withTimeout(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function digNearby(bot, names, max = 6) {
  const mcData = require('minecraft-data')(bot.version);
  for (const name of names) {
    const id = mcData.blocksByName[name]?.id;
    if (id == null) continue;
    const blocks = bot.findBlocks({ matching: id, maxDistance: 16, count: 3 });
    for (const p of blocks) {
      const b = bot.blockAt(p);
      if (!b) continue;
      try {
        const tool = bot.inventory.items().find(i => i.name.includes('pickaxe') || i.name.includes('axe'));
        if (tool) await bot.equip(tool, 'hand');
        await withTimeout(bot.dig(b), 8000);
        console.log('[Voyager]', name, 'at', p.x, p.y, p.z);
        return true;
      } catch {
        try { bot.stopDigging(); } catch {}
      }
    }
  }
  return false;
}

async function tryCraft(bot, itemName, count = 1) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;
    const recipes = bot.recipesFor(item.id, null, 1, null);
    if (!recipes.length) return false;
    await withTimeout(bot.craft(recipes[0], count, null), 10000);
    console.log('[Voyager] craft', itemName);
    return true;
  } catch {
    return false;
  }
}

async function runSkill(bot, skill) {
  const inv = bot.inventory.items();
  switch (skill.id) {
    case 'collect_wood':
      return digNearby(bot, ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']);
    case 'craft_planks':
      return tryCraft(bot, 'oak_planks', 4) || tryCraft(bot, 'birch_planks', 4) || tryCraft(bot, 'spruce_planks', 4);
    case 'craft_table':
      if (count(inv, 'crafting_table') < 1) await tryCraft(bot, 'crafting_table', 1);
      return true;
    case 'craft_sticks':
      return tryCraft(bot, 'stick', 4);
    case 'wooden_pickaxe':
      return tryCraft(bot, 'wooden_pickaxe', 1) || tryCraft(bot, 'wooden_axe', 1);
    case 'mine_stone':
      return digNearby(bot, ['stone', 'cobblestone', 'deepslate']);
    case 'stone_tools':
      await tryCraft(bot, 'stone_pickaxe', 1);
      await tryCraft(bot, 'stone_sword', 1);
      return true;
    case 'furnace':
      return tryCraft(bot, 'furnace', 1);
    case 'food': {
      if (bot.food < 16) {
        const food = inv.find(i => /beef|pork|chicken|bread|apple|carrot|potato|mutton|cod|salmon/.test(i.name));
        if (food) {
          try { await bot.equip(food, 'hand'); await bot.consume(); } catch {}
        }
      }
      return true;
    }
    case 'shelter':
    case 'explore': {
      bot.setControlState('sprint', true);
      bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 1200));
      bot.clearControlStates();
      bot.look(bot.entity.yaw + 0.8, 0, true);
      return true;
    }
    default:
      return false;
  }
}

export function startVoyagerCurriculum(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamVoyager) return;
  bot._dreamVoyager = true;
  let running = false;

  const tick = async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    if (bot.pathfinder?.isMoving?.()) return;
    running = true;
    try {
      const skill = nextSkill(bot);
      console.log('[Voyager] next skill:', skill.id, '—', skill.desc);
      await runSkill(bot, skill);
    } catch (e) {
      console.warn('[Voyager]', e.message);
    } finally {
      running = false;
    }
  };

  setInterval(tick, 14000);
  setTimeout(tick, 5000);
  console.log('[DreamBot] Voyager curriculum + skill library ON (passive+active)');
}
