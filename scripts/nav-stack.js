/**
 * UNIFIED navigation — ESM only (no bare require)
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const require = createRequire(import.meta.url);
const { Movements, goals } = pathfinder;

const AIR = new Set(['air', 'cave_air', 'void_air', 'light']);
const WATER = new Set(['water', 'flowing_water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

function solid(b) {
  if (!b) return false;
  const n = b.name || '';
  if (AIR.has(n) || WATER.has(n) || n.includes('water')) return false;
  if (/sign|torch|carpet|button|rail|flower|grass|fern|dead_bush/.test(n)) return false;
  return b.boundingBox === 'block';
}

function isWater(b) {
  if (!b) return false;
  return WATER.has(b.name) || (b.name || '').includes('water');
}

function diggable(b) {
  if (!solid(b)) return false;
  return !/bedrock|barrier|obsidian|command|spawner|end_portal/.test(b.name || '');
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
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error('timeout')), ms);
      }),
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
    m.allowFreeMotion = true;
    m.maxDropDown = 4;
    m.scafoldingBlocks = [
      'dirt', 'cobblestone', 'stone', 'netherrack',
      'oak_planks', 'spruce_planks', 'birch_planks',
      'cobbled_deepslate', 'tuff', 'andesite',
    ];
    if (typeof m.digCost === 'number') m.digCost = 4;
    if (typeof m.placeCost === 'number') m.placeCost = 3;
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 8000;
    console.log('[NAV-STACK] Prismarine pathfinder ON');
  } catch (e) {
    console.warn('[NAV-STACK] prismarine', e.message);
  }
}

async function setupAshfinder(bot) {
  if (bot.ashfinder) {
    configAsh(bot);
    return true;
  }
  try {
    const mod = await import('@miner-org/mineflayer-baritone');
    const loader = mod.loader || mod.default?.loader || mod.default;
    if (typeof loader !== 'function') return false;
    bot.loadPlugin(loader);
    configAsh(bot);
    console.log('[NAV-STACK] ashfinder ON');
    return !!bot.ashfinder;
  } catch (e) {
    console.warn('[NAV-STACK] ashfinder skip', (e.message || '').slice(0, 70));
    return false;
  }
}

function configAsh(bot) {
  const af = bot.ashfinder;
  if (!af) return;
  try {
    af.enableBreaking?.();
    af.enablePlacing?.();
    const c = af.config || {};
    c.parkour = true;
    c.proParkour = true;
    c.swimming = true;
    c.breakBlocks = true;
    c.placeBlocks = true;
    c.maxFallDist = 4;
    c.thinkTimeout = 50000;
  } catch {}
}

function installDreamGoto(bot) {
  bot.dreamStopNav = () => {
    try { bot.ashfinder?.stop?.(); } catch {}
    try {
      bot.pathfinder?.setGoal?.(null);
      bot.pathfinder?.stop?.();
    } catch {}
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
          await withTimeout(bot.ashfinder.goto(new g.GoalNear(target, range)), 55000);
          return true;
        }
      } catch (e) {
        console.warn('[NAV-STACK] ash fail', (e.message || '').slice(0, 40));
      }
    }

    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)),
        40000
      );
      return true;
    } catch (e) {
      console.warn('[NAV-STACK] path fail', (e.message || '').slice(0, 40));
      return false;
    }
  };

  bot.dreamGotoBlock = async (block, range = 2) => {
    if (!block?.position) return false;
    return bot.dreamGoto(block.position.x, block.position.y, block.position.z, range);
  };
}

async function escapeWater(bot) {
  if (!inWater(bot)) return true;
  console.log('[NAV-STACK] water escape');
  bot.dreamStopNav?.();
  for (let i = 0; i < 20; i++) {
    if (!inWater(bot)) break;
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    try { await bot.look(bot.entity.yaw, -0.55, true); } catch {}
    await new Promise(r => setTimeout(r, 180));
  }
  bot.clearControlStates();
  return !inWater(bot);
}

function startLocalLayer(bot, agent) {
  if (bot._dreamNavLocal) return;
  bot._dreamNavLocal = true;
  let busy = false;

  setInterval(async () => {
    if (busy || !bot.entity) return;
    if (isTaskBusy(bot, agent)) return;

    if (inWater(bot)) {
      busy = true;
      try { await escapeWater(bot); } finally { busy = false; }
      return;
    }
    busy = true;
    try {
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const at = (dx, dy, dz) => bot.blockAt(pos.offset(dx, dy, dz));
      const ff = at(fx, 0, fz);
      const fh = at(fx, 1, fz);
      const gap = at(fx, -1, fz);

      if (solid(ff) && !solid(fh)) {
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 280));
        bot.clearControlStates();
        return;
      }
      if (solid(ff) && solid(fh)) {
        for (const blk of [fh, ff]) {
          if (diggable(blk)) {
            try { await withTimeout(bot.dig(blk), 4000); } catch { try { bot.stopDigging(); } catch {} }
            return;
          }
        }
        try { await bot.look(yaw + 1.4, 0, true); } catch {}
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 350));
        bot.clearControlStates();
        return;
      }
      if (!solid(gap) && !solid(ff) && !isWater(gap)) {
        const item = bot.inventory.items().find(i => /dirt|cobble|planks|netherrack|stone/.test(i.name));
        if (item) {
          try {
            await bot.equip(item, 'hand');
            const ref = bot.blockAt(pos.offset(0, -1, 0));
            if (ref) await bot.placeBlock(ref, new Vec3(Math.round(fx), 0, Math.round(fz)));
          } catch {}
        }
      }
    } catch {
    } finally {
      busy = false;
    }
  }, 1400);
  console.log('[NAV-STACK] local layer ON');
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
        const blocks = bot.findBlocks({ matching: id, maxDistance: dist, count: 4 });
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
    if (run || !bot.entity) return;
    if (isTaskBusy(bot, agent)) return;
    if (inWater(bot)) return;
    run = true;
    try {
      const inv = bot.inventory.items();
      const logs = inv.filter(i => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0);
      const pick = inv.some(i => /pickaxe/.test(i.name));
      const cobble = inv.filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);

      let b = null;
      let label = '';
      if (logs < 8) {
        b = find(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log'], 36);
        label = 'wood';
      } else if (pick && cobble < 16) {
        b = find(['stone', 'cobblestone', 'deepslate'], 24);
        label = 'stone';
      }
      if (b) {
        console.log('[NAV-STACK] passive', label);
        if (await bot.dreamGotoBlock(b, 2)) {
          try {
            const tool = inv.find(i => label === 'wood' ? /axe/.test(i.name) : /pickaxe/.test(i.name));
            if (tool) await bot.equip(tool, 'hand');
            await withTimeout(bot.dig(b), 9000);
          } catch { try { bot.stopDigging(); } catch {} }
        }
      }
    } catch (e) {
      console.warn('[NAV-STACK] passive', e.message);
    } finally {
      run = false;
    }
  }, 16000);
  console.log('[NAV-STACK] passive goto ON');
}

export async function startNavStack(agent) {
  const bot = agent.bot;
  if (!bot) return;

  setupPrismarine(bot);
  await setupAshfinder(bot);
  installDreamGoto(bot);

  const boot = () => {
    setupPrismarine(bot);
    if (bot.ashfinder) configAsh(bot);
    startLocalLayer(bot, agent);
    startPassiveGoto(bot, agent);
    console.log('[NAV-STACK] READY');
  };

  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 800));
}

export async function startBaritoneNav(agent) {
  return startNavStack(agent);
}
