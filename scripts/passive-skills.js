/**
 * DreamBot passive skills — inspired by JesseRWeigel/minecraft-agent-swarm
 * (tech-tree curriculum, craft_gear, smelt, house, farm, light, drop collect, watchdogs)
 * Runs WITHOUT LLM so passive mode matches active progression.
 */

const WOOD_LOGS = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];

function inv(bot) { return bot.inventory.items(); }
function count(bot, name) {
  return inv(bot).filter(i => i.name === name).reduce((a, i) => a + i.count, 0);
}
function has(bot, name) { return inv(bot).some(i => i.name === name); }
function countMatch(bot, re) {
  return inv(bot).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

async function withTimeout(promise, ms, label = 'op') {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' timeout')), ms); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

async function safeDig(bot, block, ms = 5000) {
  if (!block) return false;
  try {
    await withTimeout(bot.dig(block), ms, 'dig');
    return true;
  } catch {
    try { bot.stopDigging?.(); } catch {}
    return false;
  }
}

async function collectNearbyDrops(bot, radius = 4) {
  try {
    const drops = Object.values(bot.entities).filter(e =>
      e.name === 'item' && e.position.distanceTo(bot.entity.position) < radius
    );
    for (const d of drops.slice(0, 6)) {
      try {
        bot.lookAt(d.position);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 400));
        bot.setControlState('forward', false);
      } catch {}
    }
  } catch {}
}

async function equipBest(bot, kind) {
  const items = inv(bot).filter(i => new RegExp(kind).test(i.name));
  if (!items.length) return false;
  const rank = (n) => {
    if (/netherite/.test(n)) return 6;
    if (/diamond/.test(n)) return 5;
    if (/iron/.test(n)) return 4;
    if (/stone/.test(n)) return 3;
    if (/golden|gold/.test(n)) return 2;
    if (/wooden|wood/.test(n)) return 1;
    return 0;
  };
  items.sort((a, b) => rank(b.name) - rank(a.name));
  try {
    await bot.equip(items[0], 'hand');
    return true;
  } catch { return false; }
}

/** Tech stage from inventory (swarm curriculum idea) */
export function techStage(bot) {
  const logs = countMatch(bot, /_log$/);
  const planks = countMatch(bot, /_planks$/);
  const sticks = count(bot, 'stick');
  const table = has(bot, 'crafting_table');
  const woodPick = inv(bot).some(i => /wooden_pickaxe/.test(i.name));
  const stonePick = inv(bot).some(i => /stone_pickaxe/.test(i.name));
  const ironPick = inv(bot).some(i => /iron_pickaxe/.test(i.name));
  const furnace = has(bot, 'furnace');
  const iron = count(bot, 'iron_ingot') + count(bot, 'raw_iron');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  const food = inv(bot).some(i => /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton/.test(i.name));

  if (ironPick) return { stage: 'iron', next: 'armor_or_explore' };
  if (iron >= 3 && furnace) return { stage: 'smelt_iron', next: 'iron_tools' };
  if (stonePick && cobble >= 8) return { stage: 'stone', next: 'furnace_and_iron' };
  if (woodPick) return { stage: 'wood_tools', next: 'mine_stone' };
  if (table && sticks >= 2 && planks >= 3) return { stage: 'ready_tools', next: 'craft_pickaxe' };
  if (table) return { stage: 'table', next: 'sticks_and_tools' };
  if (planks >= 4) return { stage: 'planks', next: 'crafting_table' };
  if (logs >= 1) return { stage: 'logs', next: 'planks' };
  if (!food && bot.food < 16) return { stage: 'hungry', next: 'food' };
  return { stage: 'start', next: 'wood' };
}

async function craft(skills, bot, name, n = 1) {
  try {
    await withTimeout(skills.craftRecipe(bot, name, n), 20000, 'craft');
    console.log('[DreamBot] craft', name);
    return true;
  } catch (e) {
    console.warn('[DreamBot] craft fail', name, e.message);
    return false;
  }
}

/** One full passive progression tick — mirrors active goals without LLM */
export async function runPassiveSkillTick(agent) {
  const bot = agent.bot;
  if (!bot?.entity) return;

  let skills;
  try {
    skills = await import('./library/skills.js');
  } catch (e) {
    console.warn('[DreamBot] skills import', e.message);
    return;
  }

  const stage = techStage(bot);
  console.log('[DreamBot] tech', stage.stage, '→', stage.next);

  // 1) Survive: eat
  if (bot.food < 16 || bot.health < 14) {
    const food = inv(bot).find(i => /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|golden_apple/.test(i.name));
    if (food) {
      try {
        await bot.equip(food, 'hand');
        await withTimeout(bot.consume(), 5000, 'eat');
        console.log('[DreamBot] eat', food.name);
        return;
      } catch {}
    }
    // hunt passive mob if hungry
    if (bot.food < 14) {
      for (const mob of ['chicken', 'cow', 'pig', 'sheep']) {
        try {
          if (await skills.attackNearest(bot, mob, true)) {
            await collectNearbyDrops(bot, 5);
            console.log('[DreamBot] hunt', mob);
            return;
          }
        } catch {}
      }
    }
  }

  // 2) Wood
  if (stage.next === 'wood' || stage.next === 'planks' && countMatch(bot, /_log$/) < 1) {
    for (const k of WOOD_LOGS) {
      try {
        if (await withTimeout(skills.collectBlock(bot, k, 4), 45000, 'collect log')) {
          await collectNearbyDrops(bot);
          console.log('[DreamBot] wood', k);
          return;
        }
      } catch {}
    }
    const log = bot.findBlock({ matching: b => b && /_log$/.test(b.name), maxDistance: 24 });
    if (log) {
      try {
        if (log.position.distanceTo(bot.entity.position) > 3) {
          try { await withTimeout(skills.goToPosition(bot, log.position.x, log.position.y, log.position.z, 2), 20000, 'goto log'); } catch {}
        }
        await safeDig(bot, log);
        await collectNearbyDrops(bot);
        console.log('[DreamBot] dig log');
        return;
      } catch {}
    }
  }

  // 3) Planks
  const logs = countMatch(bot, /_log$/);
  const planks = countMatch(bot, /_planks$/);
  if (logs >= 1 && planks < 16) {
    const w = inv(bot).find(i => /_log$/.test(i.name));
    if (w) {
      const recipe = w.name.replace('_log', '_planks');
      if (await craft(skills, bot, recipe, Math.min(4, logs))) return;
    }
  }

  // 4) Crafting table
  if (!has(bot, 'crafting_table') && planks >= 4) {
    if (await craft(skills, bot, 'crafting_table', 1)) {
      try {
        // place table nearby
        await skills.placeBlock(bot, 'crafting_table', bot.entity.position.offset(1, 0, 0));
      } catch {
        try { await skills.placeHere?.(bot, 'crafting_table'); } catch {}
      }
      return;
    }
  }

  // 5) Sticks
  if (count(bot, 'stick') < 8 && planks >= 2) {
    if (await craft(skills, bot, 'stick', 4)) return;
  }

  // 6) craft_gear — wooden tools (swarm craft_gear idea)
  const sticks = count(bot, 'stick');
  if (planks >= 3 && sticks >= 2 && !inv(bot).some(i => /wooden_pickaxe/.test(i.name))) {
    if (await craft(skills, bot, 'wooden_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }
  if (planks >= 3 && sticks >= 2 && !inv(bot).some(i => /wooden_axe/.test(i.name))) {
    if (await craft(skills, bot, 'wooden_axe', 1)) return;
  }
  if (planks >= 2 && sticks >= 1 && !inv(bot).some(i => /wooden_sword/.test(i.name))) {
    if (await craft(skills, bot, 'wooden_sword', 1)) return;
  }

  // 7) Mine stone
  await equipBest(bot, 'pickaxe');
  const cobble = count(bot, 'cobblestone') + count(bot, 'stone');
  if (inv(bot).some(i => /pickaxe/.test(i.name)) && cobble < 20) {
    try {
      if (await withTimeout(skills.collectBlock(bot, 'stone', 8), 60000, 'mine stone')) {
        await collectNearbyDrops(bot);
        console.log('[DreamBot] stone');
        return;
      }
    } catch {}
  }

  // 8) Stone tools
  if (cobble >= 3 && sticks >= 2 && !inv(bot).some(i => /stone_pickaxe/.test(i.name))) {
    if (await craft(skills, bot, 'stone_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }
  if (cobble >= 3 && sticks >= 2 && !inv(bot).some(i => /stone_axe/.test(i.name))) {
    if (await craft(skills, bot, 'stone_axe', 1)) return;
  }
  if (cobble >= 2 && sticks >= 1 && !inv(bot).some(i => /stone_sword/.test(i.name))) {
    if (await craft(skills, bot, 'stone_sword', 1)) return;
  }

  // 9) Furnace + smelt (swarm smelt_ores)
  if (cobble >= 8 && !has(bot, 'furnace')) {
    if (await craft(skills, bot, 'furnace', 1)) return;
  }
  if (has(bot, 'furnace') && (count(bot, 'raw_iron') > 0 || count(bot, 'raw_copper') > 0 || count(bot, 'raw_gold') > 0)) {
    try {
      if (typeof skills.smeltItem === 'function') {
        const raw = inv(bot).find(i => /raw_iron|raw_copper|raw_gold|porkchop|beef|chicken|mutton|cod|salmon/.test(i.name));
        if (raw) {
          await withTimeout(skills.smeltItem(bot, raw.name, 1), 90000, 'smelt');
          console.log('[DreamBot] smelt', raw.name);
          return;
        }
      }
    } catch (e) { console.warn('[DreamBot] smelt', e.message); }
  }

  // 10) Torches (light_area)
  if (count(bot, 'coal') + count(bot, 'charcoal') >= 1 && sticks >= 1 && count(bot, 'torch') < 8) {
    if (await craft(skills, bot, 'torch', 4)) {
      try {
        if (typeof skills.placeBlock === 'function') {
          await skills.placeBlock(bot, 'torch', bot.entity.position.offset(0, 1, 1));
        }
      } catch {}
      return;
    }
  }

  // 11) Iron tools if have ingots
  const iron = count(bot, 'iron_ingot');
  if (iron >= 3 && sticks >= 2 && !inv(bot).some(i => /iron_pickaxe/.test(i.name))) {
    if (await craft(skills, bot, 'iron_pickaxe', 1)) {
      await equipBest(bot, 'pickaxe');
      return;
    }
  }

  // 12) Simple house 4x4 (swarm build_house simplified)
  if (!agent._houseDone && cobble + planks >= 20) {
    try {
      const base = bot.entity.position.floored();
      const blockName = has(bot, 'cobblestone') ? 'cobblestone' : (inv(bot).find(i => /_planks$/.test(i.name))?.name || 'dirt');
      // floor
      for (let x = 0; x < 4; x++) {
        for (let z = 0; z < 4; z++) {
          try {
            if (typeof skills.placeBlock === 'function') {
              await skills.placeBlock(bot, blockName, base.offset(x, -1, z));
            }
          } catch {}
        }
      }
      // walls height 2
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 4; x++) {
          for (const z of [0, 3]) {
            try { await skills.placeBlock?.(bot, blockName, base.offset(x, y, z)); } catch {}
          }
        }
        for (let z = 1; z < 3; z++) {
          for (const x of [0, 3]) {
            try { await skills.placeBlock?.(bot, blockName, base.offset(x, y, z)); } catch {}
          }
        }
      }
      agent._houseDone = true;
      console.log('[DreamBot] house shell');
      try {
        if (agent.memory_bank?.rememberPlace) {
          agent.memory_bank.rememberPlace('base', base.x, base.y, base.z);
        }
      } catch {}
      return;
    } catch (e) { console.warn('[DreamBot] house', e.message); }
  }

  // 13) Sleep at night
  try {
    const tod = bot.time?.timeOfDay;
    if (tod != null && (tod > 13000 && tod < 23000)) {
      if (typeof skills.goToBed === 'function') {
        await withTimeout(skills.goToBed(bot), 20000, 'bed');
        console.log('[DreamBot] sleep');
        return;
      }
    }
  } catch {}

  // 14) Explore / move
  try {
    await withTimeout(skills.moveAway(bot, 12), 15000, 'explore');
    console.log('[DreamBot] explore');
  } catch {
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    setTimeout(() => {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        bot.look(bot.entity.yaw + 0.8, 0);
      } catch {}
    }, 600);
  }
}

export function startPassiveSkills(agent) {
  if (agent._passiveSkillsStarted) return;
  agent._passiveSkillsStarted = true;
  agent._houseDone = false;

  setInterval(async () => {
    try {
      if (agent._navBusy) return;
      if (agent._dreamLock && Date.now() < (agent._dreamLockUntil || 0)) return;
      if (agent.actions?.executing) return;
      try {
        if (agent.bot.pathfinder?.isMoving?.()) return;
      } catch {}

      agent._dreamLock = true;
      agent._dreamLockUntil = Date.now() + 25000;
      await runPassiveSkillTick(agent);
    } catch (e) {
      console.warn('[DreamBot] passive skill', e.message);
    } finally {
      agent._dreamLock = false;
    }
  }, 16000);

  console.log('[DreamBot] passive skills (swarm tech-tree) ready');
}
