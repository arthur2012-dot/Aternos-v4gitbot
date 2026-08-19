/**
 * Advanced navigation for DreamBot (PASSIVE + ACTIVE)
 * + water escape (don't get stuck swimming in place)
 *
 * Baritone Java = not runnable. mineflayer-baritone ashfinder + pathfinder + local NAV.
 */

const AIR = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'light']);
const WATER = new Set([
  'water', 'flowing_water', 'bubble_column',
  'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass',
]);

function solid(b) {
  if (!b) return false;
  const n = b.name || '';
  if (AIR.has(n) || WATER.has(n)) return false;
  if (n.includes('sign') || n.includes('torch') || n.includes('carpet') || n.includes('button')) return false;
  return b.boundingBox === 'block';
}

function isWaterBlock(b) {
  if (!b) return false;
  const n = b.name || '';
  return WATER.has(n) || n.includes('water');
}

function diggable(b) {
  if (!solid(b)) return false;
  const n = b.name || '';
  return !/bedrock|barrier|obsidian|command|structure|end_portal|spawner/.test(n);
}

function inWater(bot) {
  try {
    if (bot.entity.isInWater) return true;
  } catch {}
  try {
    const p = bot.entity.position;
    const feet = bot.blockAt(p);
    const head = bot.blockAt(p.offset(0, 1, 0));
    return isWaterBlock(feet) || isWaterBlock(head);
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

function setupPathfinderFallback(bot) {
  try {
    const { Movements } = require('mineflayer-pathfinder');
    const m = new Movements(bot);
    m.canDig = true;
    m.allowSprinting = true;
    m.allowParkour = true;
    m.allow1by1towers = true;
    m.canOpenDoors = true;
    m.maxDropDown = 4;
    m.scafoldingBlocks = [
      'dirt', 'cobblestone', 'netherrack', 'stone',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    ];
    if (typeof m.digCost === 'number') m.digCost = 5;
    if (typeof m.placeCost === 'number') m.placeCost = 4;
    // Prefer not pathing through long water
    try {
      if (m.liquids) {
        // higher cost if API supports
      }
    } catch {}
    bot.pathfinder.setMovements(m);
    console.log('[NAV] pathfinder: dig+parkour+sprint+towers');
  } catch (e) {
    console.warn('[NAV] pathfinder setup', e.message);
  }
}

function configureAshfinder(bot) {
  const af = bot.ashfinder;
  if (!af) return false;
  try {
    if (typeof af.enableBreaking === 'function') af.enableBreaking();
    if (typeof af.enablePlacing === 'function') af.enablePlacing();
    const c = af.config || {};
    c.parkour = true;
    c.proParkour = true;
    c.swimming = true;
    c.breakBlocks = true;
    c.placeBlocks = true;
    c.maxFallDist = 4;
    c.maxWaterDist = 64;
    c.thinkTimeout = 45000;
    c.stuckTimeout = 5000;
    c.disposableBlocks = [
      'dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
      'netherrack', 'oak_planks', 'spruce_planks', 'birch_planks',
      'cobbled_deepslate', 'tuff',
    ];
    c.blocksToAvoid = ['lava', 'fire', 'magma_block', 'cactus', 'sweet_berry_bush'];
    console.log('[NAV] ashfinder: parkour+break+place+swim');
    return true;
  } catch (e) {
    console.warn('[NAV] ashfinder config', e.message);
    return false;
  }
}

async function tryLoadAshfinder(bot) {
  if (bot.ashfinder) {
    configureAshfinder(bot);
    return true;
  }
  try {
    const mod = await import('@miner-org/mineflayer-baritone');
    const loader = mod.loader || mod.default?.loader || mod.default;
    if (typeof loader !== 'function') return false;
    bot.loadPlugin(loader);
    configureAshfinder(bot);
    console.log('[NAV] mineflayer-baritone LOADED');
    return !!bot.ashfinder;
  } catch (e) {
    console.warn('[NAV] ashfinder skip:', (e.message || '').slice(0, 80));
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
    // If drowning in water, surface first
    if (inWater(bot)) {
      await escapeWater(bot);
    }
    const { Vec3 } = require('vec3');
    const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (bot.ashfinder) {
      try {
        const goals = (await import('@miner-org/mineflayer-baritone')).goals;
        const goal = goals.GoalNear
          ? new goals.GoalNear(target, range)
          : new goals.GoalExact(target);
        console.log('[NAV] ashfinder goto', target.x, target.y, target.z);
        await withTimeout(bot.ashfinder.goto(goal), 60000);
        return true;
      } catch (e) {
        console.warn('[NAV] ashfinder fail → pathfinder', (e.message || '').slice(0, 50));
      }
    }

    try {
      const { goals } = require('mineflayer-pathfinder');
      const goal = new goals.GoalNear(target.x, target.y, target.z, range);
      await withTimeout(bot.pathfinder.goto(goal), 45000);
      return true;
    } catch (e) {
      console.warn('[NAV] pathfinder fail', (e.message || '').slice(0, 50));
      return false;
    }
  };

  bot.dreamGotoBlock = async (block, range = 2) => {
    if (!block?.position) return false;
    return bot.dreamGoto(block.position.x, block.position.y, block.position.z, range);
  };
}

/** Swim up, find shore, get out */
async function escapeWater(bot) {
  if (!bot.entity || !inWater(bot)) return false;
  console.log('[NAV] WATER escape');
  bot.dreamStopNav?.();

  const pos = bot.entity.position;

  // 1) Swim to surface (hold jump/space)
  for (let i = 0; i < 25; i++) {
    if (!inWater(bot)) break;
    bot.setControlState('jump', true); // ascend in water
    bot.setControlState('sprint', true);
    bot.setControlState('forward', true);
    await new Promise(r => setTimeout(r, 200));
    // look slightly up
    try {
      await bot.look(bot.entity.yaw, -0.6, true);
    } catch {}
  }
  bot.clearControlStates();

  // 2) Find nearest solid shore block within 12
  let best = null;
  let bestD = 999;
  for (let dx = -12; dx <= 12; dx++) {
    for (let dz = -12; dz <= 12; dz++) {
      for (let dy = -2; dy <= 4; dy++) {
        const p = pos.offset(dx, dy, dz);
        const b = bot.blockAt(p);
        const above = bot.blockAt(p.offset(0, 1, 0));
        const above2 = bot.blockAt(p.offset(0, 2, 0));
        if (solid(b) && !solid(above) && !solid(above2) && !isWaterBlock(above)) {
          const d = Math.abs(dx) + Math.abs(dz);
          if (d < bestD && d > 0) {
            bestD = d;
            best = p.offset(0, 1, 0);
          }
        }
      }
    }
  }

  if (best) {
    try {
      await bot.lookAt(best, true);
    } catch {}
    // Swim toward shore
    for (let i = 0; i < 40; i++) {
      if (!inWater(bot) && bot.entity.onGround) break;
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      try {
        await bot.lookAt(best, true);
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    bot.clearControlStates();
  } else {
    // Random direction swim + jump
    bot.look(bot.entity.yaw + Math.PI / 2, -0.5, true);
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    await new Promise(r => setTimeout(r, 2000));
    bot.clearControlStates();
  }

  // 3) If still in water, place blocks under feet to pillar out (if has blocks)
  if (inWater(bot)) {
    const placeable = bot.inventory.items().find(i =>
      /dirt|cobble|planks|netherrack|stone|sand/.test(i.name)
    );
    if (placeable) {
      try {
        await bot.equip(placeable, 'hand');
        bot.setControlState('jump', true);
        await new Promise(r => setTimeout(r, 100));
        const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (ref) {
          await bot.placeBlock(ref, { x: 0, y: 1, z: 0 });
          console.log('[NAV] water pillar');
        }
      } catch {}
      bot.clearControlStates();
    }
  }

  return !inWater(bot);
}

function startWaterWatchdog(bot) {
  if (bot._dreamWaterWatch) return;
  bot._dreamWaterWatch = true;
  let escaping = false;

  setInterval(async () => {
    if (escaping || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    if (!inWater(bot)) {
      bot._waterTicks = 0;
      return;
    }
    bot._waterTicks = (bot._waterTicks || 0) + 1;
    // ~1.2s in water continuously → escape
    if (bot._waterTicks < 3) return;
    escaping = true;
    try {
      await escapeWater(bot);
      bot._waterTicks = 0;
    } catch (e) {
      console.warn('[NAV] water escape', e.message);
    } finally {
      escaping = false;
    }
  }, 400);

  console.log('[NAV] water watchdog ON');
}

function startLocalNav(bot) {
  if (bot._dreamLocalNav) return;
  bot._dreamLocalNav = true;
  let busy = false;

  setInterval(async () => {
    if (busy || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    if (inWater(bot)) return; // water watchdog handles this

    busy = true;
    try {
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const at = (dx, dy, dz) => bot.blockAt(pos.offset(dx, dy, dz));

      const frontFoot = at(fx, 0, fz);
      const frontHead = at(fx, 1, fz);
      const gap = at(fx, -1, fz);

      // Don't walk into deep water if we can avoid
      if (isWaterBlock(gap) && isWaterBlock(frontFoot)) {
        bot.look(yaw + Math.PI * 0.7, 0, true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 300));
        bot.clearControlStates();
        return;
      }

      if (solid(frontFoot) && !solid(frontHead)) {
        bot.setControlState('sprint', true);
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 300));
        bot.clearControlStates();
        return;
      }

      if (solid(frontFoot) && solid(frontHead)) {
        bot.dreamStopNav();
        for (const blk of [frontHead, frontFoot]) {
          if (diggable(blk)) {
            try {
              await withTimeout(bot.dig(blk), 4500);
            } catch {
              try { bot.stopDigging(); } catch {}
            }
            return;
          }
        }
        bot.look(yaw + Math.PI / 2.2, 0, true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 350));
        bot.clearControlStates();
        return;
      }

      if (!solid(gap) && !solid(frontFoot) && !isWaterBlock(gap)) {
        const placeable = bot.inventory.items().find(i =>
          /dirt|cobble|planks|netherrack|stone|tuff|deepslate/.test(i.name)
        );
        if (placeable) {
          try {
            await bot.equip(placeable, 'hand');
            const ref = bot.blockAt(pos.offset(0, -1, 0));
            if (ref) {
              await bot.placeBlock(ref, { x: Math.round(fx), y: 0, z: Math.round(fz) });
              console.log('[NAV] bridge');
            }
          } catch {}
          return;
        }
      }

      // Avoid stepping into water gap without blocks
      if (isWaterBlock(gap) || (gap && isWaterBlock(gap))) {
        bot.look(yaw + 2, 0, true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 280));
        bot.clearControlStates();
        return;
      }

      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      if (bot._navKey === key) bot._navStill = (bot._navStill || 0) + 1;
      else {
        bot._navKey = key;
        bot._navStill = 0;
      }
      if (bot._navStill >= 6) {
        bot._navStill = 0;
        console.log('[NAV] STUCK escape');
        bot.dreamStopNav();
        for (const d of [[0, 1, 0], [fx, 1, fz], [fx, 0, fz]]) {
          const b = at(d[0], d[1], d[2]);
          if (diggable(b)) {
            try { await withTimeout(bot.dig(b), 3500); } catch { try { bot.stopDigging(); } catch {} }
            break;
          }
        }
        bot.look(yaw + 1.2, 0, true);
        bot.setControlState('jump', true);
        bot.setControlState('sprint', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 550));
        bot.clearControlStates();
      }
    } catch {
      // ignore
    } finally {
      busy = false;
    }
  }, 1400);

  console.log('[NAV] local micro-nav ON');
}

function startPassiveGoals(bot) {
  if (bot._dreamPassiveGoals) return;
  bot._dreamPassiveGoals = true;
  let running = false;

  const findBlock = (names, dist = 32) => {
    try {
      const mcData = require('minecraft-data')(bot.version);
      for (const name of names) {
        const id = mcData.blocksByName[name]?.id;
        if (id == null) continue;
        const blocks = bot.findBlocks({ matching: id, maxDistance: dist, count: 5 });
        // Prefer blocks NOT over deep water
        for (const bp of blocks) {
          const below = bot.blockAt(bp.offset(0, -1, 0));
          if (below && isWaterBlock(below)) continue;
          const b = bot.blockAt(bp);
          if (b) return b;
        }
        if (blocks.length) return bot.blockAt(blocks[0]);
      }
    } catch {}
    return null;
  };

  const tick = async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    if (inWater(bot)) {
      await escapeWater(bot);
      return;
    }
    if (bot.pathfinder?.isMoving?.()) return;
    running = true;
    try {
      const inv = bot.inventory.items();
      const logs = inv.filter(i => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0);
      const hasPick = inv.some(i => /pickaxe/.test(i.name));
      const cobble = inv.filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);

      let block = null;
      let label = '';

      if (logs < 8) {
        block = findBlock([
          'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
          'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
        ], 40);
        label = 'wood';
      } else if (hasPick && cobble < 16) {
        block = findBlock(['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate'], 28);
        label = 'stone';
      }

      if (block) {
        console.log('[NAV passive] goal', label, block.position);
        const ok = await bot.dreamGotoBlock(block, 2);
        if (ok && !inWater(bot)) {
          try {
            const tool = inv.find(i =>
              label === 'wood' ? /axe/.test(i.name) : /pickaxe/.test(i.name)
            );
            if (tool) await bot.equip(tool, 'hand');
            await withTimeout(bot.dig(block), 10000);
            console.log('[NAV passive] dug', label);
          } catch {
            try { bot.stopDigging(); } catch {}
          }
        }
      } else if (logs >= 8 && hasPick) {
        const yaw = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * 14;
        const p = bot.entity.position.offset(Math.sin(yaw) * dist, 0, Math.cos(yaw) * dist);
        // Don't explore into water column
        const destBlock = bot.blockAt(p);
        if (destBlock && isWaterBlock(destBlock)) return;
        console.log('[NAV passive] explore');
        await bot.dreamGoto(p.x, bot.entity.position.y, p.z, 2);
      }
    } catch (e) {
      console.warn('[NAV passive]', e.message);
    } finally {
      running = false;
    }
  };

  setInterval(tick, 18000);
  setTimeout(tick, 8000);
  console.log('[NAV] passive goals ON');
}

export async function startBaritoneNav(agent) {
  const bot = agent.bot;
  if (!bot) return;

  setupPathfinderFallback(bot);
  const hasAsh = await tryLoadAshfinder(bot);
  installDreamGoto(bot);

  const boot = () => {
    setupPathfinderFallback(bot);
    if (bot.ashfinder) configureAshfinder(bot);
    startWaterWatchdog(bot);
    startLocalNav(bot);
    startPassiveGoals(bot);
    console.log('[NAV] READY ashfinder=', hasAsh || !!bot.ashfinder, '+ water escape');
  };

  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 1000));
}
