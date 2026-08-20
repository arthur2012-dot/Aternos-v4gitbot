/**
 * HUMAN-GRADE SURVIVAL CURRICULUM (pure code)
 * Based on Voyager automatic curriculum + real Minecraft player tech tree:
 *   wood → planks/sticks/table → wooden tools → stone → stone tools
 *   → furnace/coal → food → iron → iron tools → shelter → explore
 *
 * Runs independently of LLM. Respects bot._digLocked.
 * Sources: MineDojo Voyager tech tree, human early-game guides.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

function inv(bot) {
  try {
    return bot.inventory.items();
  } catch {
    return [];
  }
}

function count(items, pat) {
  const re = typeof pat === 'string' ? new RegExp('^' + pat + '$') : pat;
  return items.filter((i) => re.test(i.name)).reduce((s, i) => s + i.count, 0);
}

function has(items, pat) {
  const re = typeof pat === 'string' ? new RegExp(pat) : pat;
  return items.some((i) => re.test(i.name));
}

function bestPick(items) {
  return (
    items.find((i) => /diamond_pickaxe|netherite_pickaxe/.test(i.name)) ||
    items.find((i) => /iron_pickaxe/.test(i.name)) ||
    items.find((i) => /stone_pickaxe/.test(i.name)) ||
    items.find((i) => /wooden_pickaxe|golden_pickaxe/.test(i.name)) ||
    null
  );
}

function bestAxe(items) {
  return (
    items.find((i) => /_axe$/.test(i.name) && /diamond|netherite|iron|stone/.test(i.name)) ||
    items.find((i) => /_axe$/.test(i.name)) ||
    null
  );
}

function bestSword(items) {
  return (
    items.find((i) => /_sword$/.test(i.name) && /diamond|netherite|iron|stone/.test(i.name)) ||
    items.find((i) => /_sword$/.test(i.name)) ||
    null
  );
}

/* ─── curriculum stages (human order) ─── */
const STAGES = [
  {
    id: 'wood',
    label: 'Coletar madeira',
    done: (i) => count(i, /_log$/) >= 6 || count(i, /_planks$/) >= 12,
  },
  {
    id: 'planks',
    label: 'Craftar tábuas',
    done: (i) => count(i, /_planks$/) >= 8,
  },
  {
    id: 'sticks',
    label: 'Craftar sticks',
    done: (i) => count(i, 'stick') >= 4 || has(i, /_pickaxe|_axe|_sword|_shovel/),
  },
  {
    id: 'table',
    label: 'Crafting table',
    done: (i) => count(i, 'crafting_table') >= 1,
  },
  {
    id: 'wood_tools',
    label: 'Ferramentas de madeira',
    done: (i) => has(i, /wooden_pickaxe|stone_pickaxe|iron_pickaxe|diamond_pickaxe/),
  },
  {
    id: 'stone',
    label: 'Minerar pedra',
    done: (i) => count(i, /cobblestone|cobbled_deepslate/) >= 12 || has(i, /stone_pickaxe|iron_pickaxe/),
  },
  {
    id: 'stone_tools',
    label: 'Ferramentas de pedra',
    done: (i) => has(i, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/),
  },
  {
    id: 'furnace',
    label: 'Fornalha',
    done: (i) => count(i, 'furnace') >= 1 || has(i, /iron_ingot|iron_pickaxe/),
  },
  {
    id: 'fuel',
    label: 'Carvão / combustível',
    done: (i) => count(i, /coal|charcoal/) >= 4 || has(i, /iron_ingot|iron_pickaxe/),
  },
  {
    id: 'food',
    label: 'Comida',
    done: (i) => count(i, /beef|porkchop|chicken|mutton|bread|apple|carrot|potato|cod|salmon|cooked_/) >= 3,
  },
  {
    id: 'iron',
    label: 'Minério de ferro',
    done: (i) => count(i, /raw_iron|iron_ore|deepslate_iron_ore|iron_ingot/) >= 3 || has(i, /iron_pickaxe/),
  },
  {
    id: 'smelt_iron',
    label: 'Fundir ferro',
    done: (i) => count(i, 'iron_ingot') >= 3 || has(i, /iron_pickaxe/),
  },
  {
    id: 'iron_tools',
    label: 'Ferramentas de ferro',
    done: (i) => has(i, /iron_pickaxe|diamond_pickaxe/),
  },
  {
    id: 'shelter',
    label: 'Abrigo básico',
    done: (i, bot) => !!bot._dreamShelterDone,
  },
  {
    id: 'explore',
    label: 'Explorar / avançar',
    done: () => false, // never fully done — keeps exploring
  },
];

function nextStage(bot) {
  const items = inv(bot);
  for (const s of STAGES) {
    if (!s.done(items, bot)) return s;
  }
  return STAGES[STAGES.length - 1];
}

/* ─── actions ─── */

async function digBlocks(bot, names, maxDist = 24, limit = 4) {
  if (bot._digLocked) return false;
  const mcData = require('minecraft-data')(bot.version);
  let dug = 0;

  // try dig-place locked dig if available
  let digBlockFn = null;
  try {
    const mod = await import('./dig-place.js');
    digBlockFn = mod.digBlock;
  } catch {}

  for (const name of names) {
    const id = mcData.blocksByName[name]?.id;
    if (id == null) continue;
    let positions = [];
    try {
      positions = bot.findBlocks({ matching: id, maxDistance: maxDist, count: limit });
    } catch {
      continue;
    }
    for (const p of positions) {
      if (bot._digLocked) break;
      const b = bot.blockAt(p);
      if (!b) continue;

      // equip best tool
      const items = inv(bot);
      const isWood = /_log$|leaves/.test(name);
      const tool = isWood ? bestAxe(items) || bestPick(items) : bestPick(items) || bestAxe(items);
      if (tool) {
        try {
          await bot.equip(tool, 'hand');
        } catch {}
      }

      // approach if far
      try {
        if (bot.entity.position.distanceTo(b.position) > 3.5) {
          if (typeof bot.dreamGoto === 'function') {
            await bot.dreamGoto(b.position.x, b.position.y, b.position.z, 2);
          }
        }
      } catch {}

      try {
        if (digBlockFn) {
          const ok = await digBlockFn(bot, b, { maxMs: 16000 });
          if (ok) {
            dug++;
            console.log('[CURRICULUM] dig', name);
          }
        } else {
          await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true);
          await withTimeout(bot.dig(b, true), 14000);
          dug++;
          console.log('[CURRICULUM] dig', name);
        }
      } catch {
        try {
          bot.stopDigging();
        } catch {}
      }
      if (dug >= limit) return dug > 0;
    }
  }
  return dug > 0;
}

async function craftItem(bot, itemName, qty = 1) {
  if (bot._digLocked) return false;
  try {
    const mcData = require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return false;

    // try without table first, then with nearby table
    let recipes = bot.recipesFor(item.id, null, 1, null);
    let table = null;
    if (!recipes.length) {
      table = bot.findBlock({
        matching: mcData.blocksByName.crafting_table?.id,
        maxDistance: 16,
      });
      if (table) {
        try {
          if (bot.entity.position.distanceTo(table.position) > 3) {
            if (typeof bot.dreamGoto === 'function') {
              await bot.dreamGoto(table.position.x, table.position.y, table.position.z, 2);
            }
          }
        } catch {}
        recipes = bot.recipesFor(item.id, null, 1, table);
      }
    }
    if (!recipes.length) return false;

    await withTimeout(bot.craft(recipes[0], qty, table || null), 12000);
    console.log('[CURRICULUM] craft', itemName, 'x' + qty);
    return true;
  } catch (e) {
    console.warn('[CURRICULUM] craft fail', itemName, (e.message || '').slice(0, 40));
    return false;
  }
}

async function placeNearby(bot, itemName) {
  if (bot._digLocked) return false;
  const item = inv(bot).find((i) => i.name === itemName);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref) return false;
    const Vec3 = require('vec3').Vec3;
    // place in front
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    await bot.lookAt(ref.position.offset(0.5 + dx * 0.5, 1, 0.5 + dz * 0.5), true);
    await withTimeout(bot.placeBlock(ref, new Vec3(dx, 0, dz)), 3000);
    console.log('[CURRICULUM] place', itemName);
    return true;
  } catch {
    try {
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      const Vec3 = require('vec3').Vec3;
      await withTimeout(bot.placeBlock(ref, new Vec3(0, 1, 0)), 3000);
      return true;
    } catch {
      return false;
    }
  }
}

async function smelt(bot, inputName, fuelName = 'coal') {
  if (bot._digLocked) return false;
  try {
    const mcData = require('minecraft-data')(bot.version);
    const furnaceBlock = bot.findBlock({
      matching: mcData.blocksByName.furnace?.id,
      maxDistance: 16,
    });
    if (!furnaceBlock) {
      // place furnace if we have one
      if (count(inv(bot), 'furnace') >= 1) {
        await placeNearby(bot, 'furnace');
      }
      return false;
    }
    try {
      if (bot.entity.position.distanceTo(furnaceBlock.position) > 3) {
        if (typeof bot.dreamGoto === 'function') {
          await bot.dreamGoto(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2);
        }
      }
    } catch {}

    const furnace = await bot.openFurnace(furnaceBlock);
    const input = inv(bot).find((i) => i.name === inputName || i.name.includes(inputName));
    const fuel =
      inv(bot).find((i) => i.name === fuelName) ||
      inv(bot).find((i) => /coal|charcoal|_log$|planks/.test(i.name));
    if (input) {
      try {
        await furnace.putInput(input.type, null, Math.min(input.count, 8));
      } catch {}
    }
    if (fuel) {
      try {
        await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 8));
      } catch {}
    }
    await sleep(2000);
    try {
      await furnace.takeOutput();
    } catch {}
    furnace.close();
    console.log('[CURRICULUM] smelt', inputName);
    return true;
  } catch (e) {
    console.warn('[CURRICULUM] smelt', (e.message || '').slice(0, 40));
    return false;
  }
}

async function huntFood(bot) {
  if (bot._digLocked) return false;
  try {
    const prey = Object.values(bot.entities).find(
      (e) =>
        e !== bot.entity &&
        e.position &&
        e.position.distanceTo(bot.entity.position) < 20 &&
        /cow|pig|sheep|chicken|cod|salmon/.test(e.name || '')
    );
    if (!prey) return false;

    const sword = bestSword(inv(bot));
    if (sword) {
      try {
        await bot.equip(sword, 'hand');
      } catch {}
    }

    try {
      if (typeof bot.dreamGoto === 'function') {
        await bot.dreamGoto(prey.position.x, prey.position.y, prey.position.z, 2);
      }
    } catch {}

    for (let i = 0; i < 12; i++) {
      const live = bot.entities[prey.id];
      if (!live || live.health <= 0) break;
      try {
        await bot.lookAt(live.position.offset(0, live.height * 0.8, 0), true);
        await bot.attack(live);
      } catch {}
      await sleep(400);
    }
    console.log('[CURRICULUM] hunt', prey.name);
    return true;
  } catch {
    return false;
  }
}

async function eatIfHungry(bot) {
  if (bot.food >= 16) return false;
  const food = inv(bot).find((i) =>
    /beef|pork|chicken|mutton|bread|apple|carrot|potato|cod|salmon|cooked_|melon|berry/.test(i.name)
  );
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log('[CURRICULUM] eat', food.name);
    return true;
  } catch {
    return false;
  }
}

async function buildMiniShelter(bot) {
  if (bot._digLocked) return false;
  if (bot._dreamShelterDone) return true;
  try {
    // try house-builder if present
    try {
      const hb = await import('./house-builder.js');
      if (typeof hb.buildSimpleHouse === 'function') {
        await hb.buildSimpleHouse(bot);
        bot._dreamShelterDone = true;
        console.log('[CURRICULUM] shelter via house-builder');
        return true;
      }
      if (typeof hb.startHouseBuilder === 'function') {
        // just mark for later passive builder
        bot._dreamWantShelter = true;
      }
    } catch {}

    // fallback: 3x3 dirt platform + walls
    const build =
      inv(bot).find((i) => /dirt|cobblestone|planks|netherrack/.test(i.name) && i.count >= 8) ||
      null;
    if (!build) return false;
    await bot.equip(build, 'hand');
    const origin = bot.entity.position.floored();
    const Vec3 = require('vec3').Vec3;
    let placed = 0;
    for (const [ox, oz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      try {
        const under = bot.blockAt(origin.offset(ox, -1, oz));
        if (under && under.name !== 'air') {
          await bot.lookAt(under.position.offset(0.5, 1, 0.5), true);
          await withTimeout(bot.placeBlock(under, new Vec3(0, 1, 0)), 2000);
          placed++;
        }
      } catch {}
    }
    if (placed >= 4) {
      bot._dreamShelterDone = true;
      console.log('[CURRICULUM] mini shelter placed', placed);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function exploreNudge(bot) {
  if (bot._digLocked) return false;
  // walk forward committed direction — no random spin
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await sleep(1500);
  bot.clearControlStates();
  // dig any soft block ahead if blocked
  try {
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const front = bot.blockAt(bot.entity.position.floored().offset(dx, 0, dz));
    if (front && front.boundingBox === 'block' && !/bedrock|obsidian|barrier/.test(front.name)) {
      let digBlockFn = null;
      try {
        digBlockFn = (await import('./dig-place.js')).digBlock;
      } catch {}
      if (digBlockFn) await digBlockFn(bot, front);
    }
  } catch {}
  return true;
}

/* ─── stage executor ─── */

async function runStage(bot, stage) {
  const items = inv(bot);
  console.log('[CURRICULUM] →', stage.id, '—', stage.label);

  // always eat if starving
  if (bot.food < 12) await eatIfHungry(bot);

  switch (stage.id) {
    case 'wood':
      return digBlocks(
        bot,
        ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
        28,
        5
      );

    case 'planks': {
      // craft from whatever logs we have
      const log = items.find((i) => /_log$/.test(i.name));
      if (!log) return digBlocks(bot, ['oak_log', 'birch_log', 'spruce_log'], 24, 3);
      const plankName = log.name.replace('_log', '_planks').replace('stripped_', '');
      // oak_log → oak_planks etc; fallback try common
      const tries = [plankName, 'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks'];
      for (const p of tries) {
        if (await craftItem(bot, p, 4)) return true;
      }
      return false;
    }

    case 'sticks':
      return craftItem(bot, 'stick', 4);

    case 'table': {
      if (count(items, 'crafting_table') < 1) {
        await craftItem(bot, 'crafting_table', 1);
      }
      // place it so recipes work
      if (count(inv(bot), 'crafting_table') >= 1) {
        await placeNearby(bot, 'crafting_table');
      }
      return true;
    }

    case 'wood_tools': {
      await craftItem(bot, 'wooden_pickaxe', 1);
      await craftItem(bot, 'wooden_axe', 1);
      await craftItem(bot, 'wooden_sword', 1);
      await craftItem(bot, 'wooden_shovel', 1);
      return has(inv(bot), /wooden_pickaxe|stone_pickaxe/);
    }

    case 'stone':
      return digBlocks(bot, ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate'], 20, 8);

    case 'stone_tools': {
      await craftItem(bot, 'stone_pickaxe', 1);
      await craftItem(bot, 'stone_axe', 1);
      await craftItem(bot, 'stone_sword', 1);
      await craftItem(bot, 'stone_shovel', 1);
      return has(inv(bot), /stone_pickaxe|iron_pickaxe/);
    }

    case 'furnace': {
      if (count(items, 'furnace') < 1) await craftItem(bot, 'furnace', 1);
      if (count(inv(bot), 'furnace') >= 1) await placeNearby(bot, 'furnace');
      return true;
    }

    case 'fuel':
      // dig coal or make charcoal from logs
      if (await digBlocks(bot, ['coal_ore', 'deepslate_coal_ore'], 24, 4)) return true;
      // charcoal: smelt log
      if (count(items, /_log$/) >= 1) {
        await smelt(bot, items.find((i) => /_log$/.test(i.name))?.name || 'oak_log', items.find((i) => /_log$|planks/.test(i.name))?.name);
      }
      return count(inv(bot), /coal|charcoal/) >= 1;

    case 'food': {
      if (await eatIfHungry(bot)) return true;
      if (await huntFood(bot)) return true;
      // apples from leaves / break leaves near logs
      await digBlocks(bot, ['oak_leaves', 'birch_leaves', 'spruce_leaves'], 12, 3);
      return true;
    }

    case 'iron':
      return digBlocks(bot, ['iron_ore', 'deepslate_iron_ore'], 28, 5);

    case 'smelt_iron': {
      const raw = items.find((i) => /raw_iron|iron_ore/.test(i.name));
      if (!raw) return digBlocks(bot, ['iron_ore', 'deepslate_iron_ore'], 24, 3);
      return smelt(bot, raw.name, 'coal');
    }

    case 'iron_tools': {
      await craftItem(bot, 'iron_pickaxe', 1);
      await craftItem(bot, 'iron_sword', 1);
      await craftItem(bot, 'iron_axe', 1);
      return has(inv(bot), /iron_pickaxe/);
    }

    case 'shelter':
      return buildMiniShelter(bot);

    case 'explore':
      return exploreNudge(bot);

    default:
      return exploreNudge(bot);
  }
}

/* ─── main loop ─── */

export function startVoyagerCurriculum(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamCurriculum) return;
  bot._dreamCurriculum = true;

  let running = false;
  let lastStageId = '';
  let sameStageCount = 0;

  const tick = async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive || bot._digLocked || bot._escapeBusy) return;
    if (bot.pathfinder?.isMoving?.() && bot._navBusy) return;

    running = true;
    try {
      const stage = nextStage(bot);

      if (stage.id === lastStageId) sameStageCount++;
      else {
        sameStageCount = 0;
        lastStageId = stage.id;
        console.log('[CURRICULUM] stage unlocked focus:', stage.id, '—', stage.label);
      }

      // if stuck on same stage too long, force explore then retry
      if (sameStageCount > 8 && stage.id !== 'explore') {
        console.log('[CURRICULUM] stuck on', stage.id, '→ explore nudge');
        await exploreNudge(bot);
        sameStageCount = 0;
      }

      await runStage(bot, stage);

      // equip best tools always
      const items = inv(bot);
      const pick = bestPick(items);
      if (pick && bot.heldItem?.name !== pick.name) {
        try {
          await bot.equip(pick, 'hand');
        } catch {}
      }
    } catch (e) {
      console.warn('[CURRICULUM]', (e.message || '').slice(0, 50));
    } finally {
      running = false;
    }
  };

  setInterval(tick, 9000);
  setTimeout(tick, 4000);
  console.log('[CURRICULUM] ON — human tech tree wood→stone→iron→shelter (Voyager-style)');
}

// alias for older wire name
export function startVoyagerSkills(agent) {
  return startVoyagerCurriculum(agent);
}
