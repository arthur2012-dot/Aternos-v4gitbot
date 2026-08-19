/**
 * Skills inspired by christopherthompson81/autobot:
 * - Ore vein mining (contiguous)
 * - Collect nearby item drops
 * - Full tree lumberjack
 * - Tool-aware ore priority
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;

const ORE_PRIORITY = [
  'diamond_ore', 'deepslate_diamond_ore',
  'ancient_debris',
  'emerald_ore', 'deepslate_emerald_ore',
  'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore',
  'iron_ore', 'deepslate_iron_ore',
  'copper_ore', 'deepslate_copper_ore',
  'coal_ore', 'deepslate_coal_ore',
  'lapis_ore', 'deepslate_lapis_ore',
  'redstone_ore', 'deepslate_redstone_ore',
  'nether_quartz_ore',
];

const LOG_NAMES = [
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function items(bot) {
  return bot.inventory.items();
}

async function equipBestFor(bot, blockName) {
  const inv = items(bot);
  let tool;
  if (/_log$|planks|leaves/.test(blockName)) {
    tool = inv.find((i) => /_axe$/.test(i.name));
  } else if (/dirt|sand|gravel|grass|clay|mud|snow/.test(blockName)) {
    tool = inv.find((i) => /_shovel$/.test(i.name));
  } else {
    const rank = (n) =>
      /netherite/.test(n) ? 6 : /diamond/.test(n) ? 5 : /iron/.test(n) ? 4 : /stone/.test(n) ? 3 : /gold/.test(n) ? 2 : /wood|wooden/.test(n) ? 1 : 0;
    const picks = inv.filter((i) => /pickaxe/.test(i.name));
    picks.sort((a, b) => rank(b.name) - rank(a.name));
    tool = picks[0];
  }
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
    } catch {}
  }
}

async function digBlock(bot, block) {
  if (!block || block.name === 'air' || block.name === 'cave_air') return false;
  if (/bedrock|barrier/.test(block.name || '')) return false;
  try {
    try {
      bot.clearControlStates();
    } catch {}
    await equipBestFor(bot, block.name);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await Promise.race([
      bot.dig(block, true),
      new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 12000)),
    ]);
    return true;
  } catch {
    try {
      bot.stopDigging();
    } catch {}
    return false;
  }
}

async function gotoNear(bot, x, y, z, r = 2) {
  try {
    if (typeof bot.dreamGoto === 'function') return await bot.dreamGoto(x, y, z, r);
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, r));
    return true;
  } catch {
    return false;
  }
}

function blockToVein(bot, startPos, maxSize = 24) {
  const start = bot.blockAt(startPos);
  if (!start || !ORE_PRIORITY.includes(start.name)) return [];
  const vein = [];
  const seen = new Set();
  const queue = [startPos.clone()];
  while (queue.length && vein.length < maxSize) {
    const p = queue.pop();
    const key = p.x + ',' + p.y + ',' + p.z;
    if (seen.has(key)) continue;
    seen.add(key);
    const b = bot.blockAt(p);
    if (!b || !ORE_PRIORITY.includes(b.name)) continue;
    vein.push(b);
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          queue.push(p.offset(x, y, z));
        }
      }
    }
  }
  return vein;
}

function harvestableOres(bot) {
  const inv = items(bot);
  const hasIronPlus = inv.some((i) => /iron_pickaxe|diamond_pickaxe|netherite_pickaxe/.test(i.name));
  const hasStonePlus = inv.some((i) => /stone_pickaxe|iron_pickaxe|diamond_pickaxe|netherite_pickaxe/.test(i.name));
  const hasAnyPick = inv.some((i) => /pickaxe/.test(i.name));
  return ORE_PRIORITY.filter((name) => {
    if (/diamond|emerald|gold|redstone|lapis/.test(name) && !hasIronPlus) return false;
    if (/iron|copper/.test(name) && !hasStonePlus) return false;
    if (!hasAnyPick) return false;
    return true;
  });
}

export async function mineOreVein(bot, maxDist = 32) {
  if (!bot?.entity) return false;
  const ores = harvestableOres(bot);
  if (!ores.length) return false;

  let best = null;
  let bestDist = maxDist;
  try {
    const mcData = require('minecraft-data')(bot.version);
    for (const name of ores) {
      const id = mcData.blocksByName[name]?.id;
      if (id == null) continue;
      const found = bot.findBlocks({ matching: id, maxDistance: maxDist, count: 8 });
      for (const pos of found) {
        const d = bot.entity.position.distanceTo(pos);
        if (d < bestDist) {
          bestDist = d;
          best = pos;
        }
      }
      if (best && bestDist < 12) break;
    }
  } catch {
    const b = bot.findBlock({
      matching: (bl) => bl && ores.includes(bl.name),
      maxDistance: maxDist,
    });
    best = b?.position;
  }

  if (!best) return false;

  const vein = blockToVein(bot, best);
  if (!vein.length) return false;

  console.log('[AUTO] mine vein', vein[0].name, 'size=' + vein.length);
  vein.sort(
    (a, b) =>
      bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
  );

  let dug = 0;
  for (const block of vein) {
    const live = bot.blockAt(block.position);
    if (!live || !ORE_PRIORITY.includes(live.name)) continue;
    const d = bot.entity.position.distanceTo(live.position);
    if (d > 4.5) {
      await gotoNear(bot, live.position.x, live.position.y, live.position.z, 2);
    }
    if (await digBlock(bot, live)) {
      dug++;
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(200);
      bot.clearControlStates();
    }
    if (dug >= 12) break;
  }

  await collectNearbyDrops(bot, 12);
  return dug > 0;
}

export async function collectNearbyDrops(bot, maxDist = 10) {
  if (!bot?.entity) return false;
  const drops = [];
  for (const id in bot.entities) {
    const e = bot.entities[id];
    if (!e || e === bot.entity) continue;
    const isItem =
      e.name === 'item' ||
      e.type === 'object' ||
      e.type === 'other';
    if (!isItem && e.name !== 'item') continue;
    const d = bot.entity.position.distanceTo(e.position);
    if (d <= maxDist) drops.push(e);
  }
  if (!drops.length) return false;

  drops.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
  console.log('[AUTO] collect drops', drops.length);
  let got = 0;
  for (const drop of drops.slice(0, 8)) {
    try {
      await gotoNear(bot, drop.position.x, drop.position.y, drop.position.z, 1);
      bot.setControlState('forward', true);
      await sleep(300);
      bot.clearControlStates();
      got++;
    } catch {}
  }
  return got > 0;
}

export async function chopTree(bot, maxDist = 32) {
  if (!bot?.entity) return false;

  let logPos = null;
  try {
    const mcData = require('minecraft-data')(bot.version);
    let bestD = maxDist;
    for (const name of LOG_NAMES) {
      const id = mcData.blocksByName[name]?.id;
      if (id == null) continue;
      const found = bot.findBlocks({ matching: id, maxDistance: maxDist, count: 6 });
      for (const pos of found) {
        const d = bot.entity.position.distanceTo(pos);
        if (d < bestD) {
          bestD = d;
          logPos = pos;
        }
      }
    }
  } catch {
    const b = bot.findBlock({
      matching: (bl) => bl && /_log$/.test(bl.name),
      maxDistance: maxDist,
    });
    logPos = b?.position;
  }
  if (!logPos) return false;

  const trunk = [];
  let bottom = logPos.clone();
  while (true) {
    const below = bot.blockAt(bottom.offset(0, -1, 0));
    if (below && /_log$/.test(below.name)) {
      bottom = below.position.clone();
    } else break;
  }
  let p = bottom.clone();
  for (let i = 0; i < 16; i++) {
    const b = bot.blockAt(p);
    if (!b || !/_log$/.test(b.name)) break;
    trunk.push(b);
    p = p.offset(0, 1, 0);
  }
  if (!trunk.length) return false;

  console.log('[AUTO] chop tree logs=' + trunk.length);
  let dug = 0;
  for (const log of trunk) {
    const live = bot.blockAt(log.position);
    if (!live || !/_log$/.test(live.name)) continue;
    const d = bot.entity.position.distanceTo(live.position);
    if (d > 4) await gotoNear(bot, live.position.x, live.position.y, live.position.z, 2);
    if (await digBlock(bot, live)) dug++;
  }
  await collectNearbyDrops(bot, 10);
  return dug > 0;
}

export async function runAutobotSkills(bot) {
  if (!bot?.entity || bot._dreamPvpActive) return false;

  if (await collectNearbyDrops(bot, 8)) return true;

  if (items(bot).some((i) => /pickaxe/.test(i.name))) {
    if (await mineOreVein(bot, 28)) return true;
  }

  const logs = items(bot)
    .filter((i) => /_log$/.test(i.name))
    .reduce((a, i) => a + i.count, 0);
  if (logs < 16) {
    if (await chopTree(bot, 36)) return true;
  }

  return false;
}

export function startAutobotSkills() {
  console.log('[AUTO] skills ready — vein mine, drops, trees');
}
