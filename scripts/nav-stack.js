/**
 * Navigation + uses dig-place helpers
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { digBlock, placeAt, placeUnderFeet, placeFront, digFrontWall } from './dig-place.js';

const require = createRequire(import.meta.url);
const { Movements, goals } = pathfinder;

const WATER = new Set(['water', 'flowing_water', 'bubble_column']);

function solid(b) {
  if (!b) return false;
  const n = b.name || '';
  if (n === 'air' || n.includes('water') || WATER.has(n)) return false;
  if (/sign|torch|carpet|button|rail|flower|grass|fern|snow$/.test(n)) return false;
  return b.boundingBox === 'block';
}

function isWater(b) {
  if (!b) return false;
  return WATER.has(b.name) || (b.name || '').includes('water');
}

function inWater(bot) {
  try {
    if (bot.entity.isInWater) return true;
  } catch {}
  try {
    const p = bot.entity.position;
    return isWater(bot.blockAt(p)) || isWater(bot.blockAt(p.offset(0, 1, 0)));
  } catch {
    return false;
  }
}

function isTaskBusy(bot, agent) {
  try {
    if (bot._dreamPvpActive) return true;
    if (agent?.actions?.executing) return true;
    if (agent?._passiveRunning) return true;
    if (bot.pathfinder?.isMoving?.()) return true;
    if (bot.targetDigBlock) return true;
  } catch {}
  return false;
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

function setupPrismarine(bot) {
  try {
    const m = new Movements(bot);
    m.canDig = true;
    m.allowSprinting = true;
    m.allowParkour = true;
    m.allow1by1towers = true;
    m.canOpenDoors = true;
    m.maxDropDown = 4;
    m.scafoldingBlocks = ['dirt', 'cobblestone', 'stone', 'netherrack', 'oak_planks', 'cobbled_deepslate'];
    if (typeof m.digCost === 'number') m.digCost = 1;
    if (typeof m.placeCost === 'number') m.placeCost = 1;
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 5000;
    console.log('[NAV] Prismarine ON');
  } catch (e) {
    console.warn('[NAV] prismarine', e.message);
  }
}

async function setupAshfinder(bot) {
  if (bot.ashfinder) return true;
  try {
    const mod = await import('@miner-org/mineflayer-baritone');
    const loader = mod.loader || mod.default?.loader || mod.default;
    if (typeof loader !== 'function') return false;
    bot.loadPlugin(loader);
    try {
      bot.ashfinder?.enableBreaking?.();
      bot.ashfinder?.enablePlacing?.();
    } catch {}
    console.log('[NAV] ashfinder ON');
    return true;
  } catch {
    return false;
  }
}

function installDreamGoto(bot) {
  bot.dreamStopNav = () => {
    try { bot.ashfinder?.stop?.(); } catch {}
    try { bot.pathfinder?.setGoal?.(null); } catch {}
  };

  bot.dreamGoto = async (x, y, z, range = 1) => {
    if (!bot.entity) return false;
    if (inWater(bot)) await escapeWater(bot);
    const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    if (bot.ashfinder) {
      try {
        const bar = await import('@miner-org/mineflayer-baritone');
        const g = bar.goals || bar.default?.goals;
        if (g?.GoalNear) {
          await withTimeout(bot.ashfinder.goto(new g.GoalNear(target, range)), 40000);
          return true;
        }
      } catch {}
    }
    try {
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)), 30000);
      return true;
    } catch {
      return false;
    }
  };

  bot.dreamGotoBlock = async (block, range = 2) => {
    if (!block?.position) return false;
    return bot.dreamGoto(block.position.x, block.position.y, block.position.z, range);
  };

  bot.dreamDig = (block) => digBlock(bot, block);
  bot.dreamPlaceAt = (pos) => placeAt(bot, pos);
  bot.dreamTower = () => placeUnderFeet(bot);
  bot.dreamBridge = () => placeFront(bot);
}

async function escapeWater(bot) {
  if (!inWater(bot)) return true;
  bot.dreamStopNav?.();
  for (let i = 0; i < 25; i++) {
    if (!inWater(bot)) break;
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    try { await bot.look(bot.entity.yaw, -0.5, true); } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  bot.clearControlStates();
  return !inWater(bot);
}

async function escapeTrap(bot) {
  const pos = bot.entity.position;
  const yaw = bot.entity.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);

  console.log('[NAV] escapeTrap dig');
  // head then walls
  const targets = [
    bot.blockAt(pos.offset(0, 1, 0)),
    bot.blockAt(pos.offset(0, 2, 0)),
    bot.blockAt(pos.offset(fx, 1, fz)),
    bot.blockAt(pos.offset(fx, 0, fz)),
    bot.blockAt(pos.offset(1, 0, 0)),
    bot.blockAt(pos.offset(-1, 0, 0)),
    bot.blockAt(pos.offset(0, 0, 1)),
    bot.blockAt(pos.offset(0, 0, -1)),
  ];
  for (const b of targets) {
    if (b && solid(b) && (await digBlock(bot, b))) return true;
  }
  // tower 2x
  for (let i = 0; i < 2; i++) {
    if (await placeUnderFeet(bot)) {
      await new Promise(r => setTimeout(r, 180));
    }
  }
  try { await bot.look(yaw + 1.5, 0, true); } catch {}
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  await new Promise(r => setTimeout(r, 350));
  bot.clearControlStates();
  return false;
}

function startLocalLayer(bot, agent) {
  if (bot._dreamNavLocal) return;
  bot._dreamNavLocal = true;
  let busy = false;
  let stuck = 0;
  let lx = null, lz = null;

  setInterval(async () => {
    if (busy || !bot.entity) return;
    if (bot._dreamPvpActive) return;

    const pos = bot.entity.position;
    if (lx != null) {
      if (Math.abs(pos.x - lx) + Math.abs(pos.z - lz) < 0.1) stuck++;
      else stuck = 0;
    }
    lx = pos.x;
    lz = pos.z;

    if (inWater(bot)) {
      busy = true;
      try { await escapeWater(bot); } finally { busy = false; }
      return;
    }

    const head = bot.blockAt(pos.offset(0, 1, 0));
    const oneHigh = solid(head);
    if (oneHigh || stuck >= 5) {
      busy = true;
      try {
        await escapeTrap(bot);
        stuck = 0;
      } finally {
        busy = false;
      }
      return;
    }

    if (isTaskBusy(bot, agent)) return;

    busy = true;
    try {
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const ff = bot.blockAt(pos.offset(fx, 0, fz));
      const fh = bot.blockAt(pos.offset(fx, 1, fz));
      const gap = bot.blockAt(pos.offset(fx, -1, fz));

      if (solid(ff) && !solid(fh)) {
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await new Promise(r => setTimeout(r, 220));
        bot.clearControlStates();
        return;
      }
      if (solid(ff) || solid(fh)) {
        await digFrontWall(bot);
        return;
      }
      if (!solid(gap) && !isWater(gap)) {
        await placeFront(bot);
      }
    } catch {
    } finally {
      busy = false;
    }
  }, 650);

  console.log('[NAV] local dig/place ON');
}

function startPassiveGoto(bot, agent) {
  if (bot._dreamPassiveGoto) return;
  bot._dreamPassiveGoto = true;
  let run = false;

  const find = (names, dist) => {
    try {
      const mcData = require('minecraft-data')(bot.version);
      for (const name of names) {
        const id = mcData.blocksByName[name]?.id;
        if (id == null) continue;
        const blocks = bot.findBlocks({ matching: id, maxDistance: dist, count: 5 });
        for (const bp of blocks) {
          const below = bot.blockAt(bp.offset(0, -1, 0));
          if (below && isWater(below)) continue;
          const b = bot.blockAt(bp);
          if (b) return b;
        }
      }
    } catch {}
    return null;
  };

  setInterval(async () => {
    if (run || !bot.entity || bot._dreamPvpActive) return;
    if (agent?._passiveRunning) return;
    run = true;
    try {
      const inv = bot.inventory.items();
      const logs = inv.filter(i => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0);
      const pick = inv.some(i => /pickaxe/.test(i.name));
      const cobble = inv.filter(i => /cobblestone|stone$/.test(i.name)).reduce((s, i) => s + i.count, 0);
      let b = null;
      if (logs < 8) b = find(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log'], 36);
      else if (pick && cobble < 16) b = find(['stone', 'cobblestone', 'deepslate'], 24);
      if (b) {
        console.log('[NAV] dig target', b.name);
        await bot.dreamGotoBlock(b, 2);
        await digBlock(bot, b);
      }
    } catch (e) {
      console.warn('[NAV] passive', e.message);
    } finally {
      run = false;
    }
  }, 11000);
}

export async function startNavStack(agent) {
  const bot = agent.bot;
  if (!bot) return;
  setupPrismarine(bot);
  await setupAshfinder(bot);
  installDreamGoto(bot);
  const boot = () => {
    setupPrismarine(bot);
    startLocalLayer(bot, agent);
    startPassiveGoto(bot, agent);
    console.log('[NAV] READY');
  };
  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 500));
}

export async function startBaritoneNav(agent) {
  return startNavStack(agent);
}
