/**
 * DreamBot UNIFIED navigation stack
 *
 * | Source | Runnable here? |
 * |--------|----------------|
 * | PrismarineJS/mineflayer-pathfinder | YES — required by Mindcraft |
 * | miner-org/mineflayer-baritone (ashfinder) | YES — secondary goto |
 * | Minecraft-Pathfinding (@nxg-org/mineflayer-pathfinder) | OPTIONAL — experimental, can conflict |
 * | cabaletta/baritone | NO — Java client mod only |
 *
 * Priority for bot.dreamGoto:
 *   1) ashfinder (mineflayer-baritone)
 *   2) prismarine pathfinder (stable)
 *   3) local step/dig/bridge/unstuck always on
 */

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

/** PrismarineJS mineflayer-pathfinder — max settings */
function setupPrismarine(bot) {
  try {
    const { Movements } = require('mineflayer-pathfinder');
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
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'cobbled_deepslate', 'tuff', 'andesite', 'diorite', 'granite',
    ];
    if (typeof m.digCost === 'number') m.digCost = 4;
    if (typeof m.placeCost === 'number') m.placeCost = 3;
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 8000;
    console.log('[NAV-STACK] Prismarine pathfinder MAX');
  } catch (e) {
    console.warn('[NAV-STACK] prismarine', e.message);
  }
}

/** miner-org/mineflayer-baritone */
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
    console.log('[NAV-STACK] mineflayer-baritone (ashfinder) ON');
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
    c.maxWaterDist = 48;
    c.thinkTimeout = 50000;
    c.stuckTimeout = 5000;
    c.disposableBlocks = [
      'dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
      'netherrack', 'oak_planks', 'spruce_planks', 'birch_planks',
      'cobbled_deepslate', 'tuff', 'sand',
    ];
    c.blocksToAvoid = ['lava', 'fire', 'magma_block', 'cactus'];
  } catch {}
}

/**
 * @nxg-org/mineflayer-pathfinder (Minecraft-Pathfinding org)
 * HEAVY development — may overwrite bot.pathfinder. We do NOT load by default.
 * Set env DREAM_USE_NXG=1 to experiment (can break Mindcraft collect/goto).
 */
async function setupNxgOptional(bot) {
  if (process.env.DREAM_USE_NXG !== '1') {
    console.log('[NAV-STACK] nxg pathfinder OFF (set DREAM_USE_NXG=1 to try experimental)');
    return false;
  }
  try {
    // Backup prismarine reference
    bot._prismarinePathfinder = bot.pathfinder;
    const nxg = await import('@nxg-org/mineflayer-pathfinder');
    const plugin = nxg.default || nxg.pathfinder || nxg.plugin || nxg;
    if (typeof plugin === 'function') {
      plugin(bot);
      bot._nxgPathfinder = bot.pathfinder;
      // Restore Mindcraft pathfinder as primary
      if (bot._prismarinePathfinder) bot.pathfinder = bot._prismarinePathfinder;
      console.log('[NAV-STACK] nxg loaded as bot._nxgPathfinder (experimental)');
      return true;
    }
    console.warn('[NAV-STACK] nxg API unexpected');
    return false;
  } catch (e) {
    console.warn('[NAV-STACK] nxg skip', (e.message || '').slice(0, 70));
    return false;
  }
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

    const { Vec3 } = require('vec3');
    const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    // 1) ashfinder
    if (bot.ashfinder) {
      try {
        const { goals } = await import('@miner-org/mineflayer-baritone');
        const goal = goals.GoalNear
          ? new goals.GoalNear(target, range)
          : new goals.GoalExact(target);
        console.log('[NAV-STACK] ashfinder →', target.x, target.y, target.z);
        await withTimeout(bot.ashfinder.goto(goal), 55000);
        return true;
      } catch (e) {
        console.warn('[NAV-STACK] ashfinder fail', (e.message || '').slice(0, 40));
      }
    }

    // 2) prismarine
    try {
      const { goals } = require('mineflayer-pathfinder');
      const goal = new goals.GoalNear(target.x, target.y, target.z, range);
      console.log('[NAV-STACK] prismarine →', target.x, target.y, target.z);
      await withTimeout(bot.pathfinder.goto(goal), 40000);
      return true;
    } catch (e) {
      console.warn('[NAV-STACK] prismarine fail', (e.message || '').slice(0, 40));
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
    bot.setControlState('sprint', true);
    try { await bot.look(bot.entity.yaw, -0.55, true); } catch {}
    await new Promise(r => setTimeout(r, 180));
  }
  bot.clearControlStates();
  // swim to nearest shore
  const pos = bot.entity.position;
  let best = null;
  let bestD = 99;
  for (let dx = -10; dx <= 10; dx++) {
    for (let dz = -10; dz <= 10; dz++) {
      for (let dy = -1; dy <= 3; dy++) {
        const p = pos.offset(dx, dy, dz);
        const b = bot.blockAt(p);
        const a1 = bot.blockAt(p.offset(0, 1, 0));
        if (solid(b) && !solid(a1) && !isWater(a1)) {
          const d = Math.abs(dx) + Math.abs(dz);
          if (d > 0 && d < bestD) {
            bestD = d;
            best = p.offset(0, 1, 0);
          }
        }
      }
    }
  }
  if (best) {
    for (let i = 0; i < 30 && inWater(bot); i++) {
      try { await bot.lookAt(best, true); } catch {}
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 120));
    }
    bot.clearControlStates();
  }
  return !inWater(bot);
}

function startLocalLayer(bot) {
  if (bot._dreamNavLocal) return;
  bot._dreamNavLocal = true;
  let busy = false;

  setInterval(async () => {
    if (busy || !bot.entity || bot._dreamPvpActive) return;
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
        bot.setControlState('sprint', true);
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 280));
        bot.clearControlStates();
        return;
      }
      if (solid(ff) && solid(fh)) {
        bot.dreamStopNav();
        for (const blk of [fh, ff]) {
          if (diggable(blk)) {
            try { await withTimeout(bot.dig(blk), 4000); } catch { try { bot.stopDigging(); } catch {} }
            return;
          }
        }
        bot.look(yaw + 1.4, 0, true);
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
            if (ref) await bot.placeBlock(ref, { x: Math.round(fx), y: 0, z: Math.round(fz) });
          } catch {}
        }
      }
    } catch {
    } finally {
      busy = false;
    }
  }, 1200);
  console.log('[NAV-STACK] local layer ON');
}

function startPassiveGoto(bot) {
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
    if (run || !bot.entity || bot._dreamPvpActive) return;
    if (inWater(bot)) return;
    if (bot.pathfinder?.isMoving?.()) return;
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
  console.log('[NAV-STACK] passive resource goto ON');
}

export async function startNavStack(agent) {
  const bot = agent.bot;
  if (!bot) return;

  setupPrismarine(bot);
  const ash = await setupAshfinder(bot);
  await setupNxgOptional(bot);
  installDreamGoto(bot);

  const boot = () => {
    setupPrismarine(bot);
    if (bot.ashfinder) configAsh(bot);
    startLocalLayer(bot);
    startPassiveGoto(bot);
    console.log('[NAV-STACK] READY | prismarine=YES ashfinder=' + !!bot.ashfinder + ' baritone-java=NO nxg=' + !!bot._nxgPathfinder);
  };

  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 800));
}

// Back-compat alias used by post-wire
export async function startBaritoneNav(agent) {
  return startNavStack(agent);
}
