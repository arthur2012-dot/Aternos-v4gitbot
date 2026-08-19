/**
 * Advanced navigation for DreamBot (PASSIVE + ACTIVE)
 *
 * Sources:
 * - cabaletta/baritone → ideas (cost, dig/place, parkour) — JAVA only, NOT runnable here
 * - miner-org/mineflayer-baritone → @miner-org/mineflayer-baritone (ashfinder) in Node
 * - mineflayer-pathfinder → fallback always available (Mindcraft)
 *
 * Exposes:
 * - bot.dreamGoto(x,y,z, range) — prefer ashfinder, else pathfinder
 * - bot.dreamStopNav()
 * - local micro-NAV (step, dig wall, bridge, unstuck)
 * - passive long-range goals (wood, stone, explore)
 */

const AIR = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'light']);

function solid(b) {
  if (!b) return false;
  const n = b.name || '';
  if (AIR.has(n)) return false;
  if (n.includes('sign') || n.includes('torch') || n.includes('carpet') || n.includes('button')) return false;
  return b.boundingBox === 'block';
}

function diggable(b) {
  if (!solid(b)) return false;
  const n = b.name || '';
  return !/bedrock|barrier|obsidian|command|structure|end_portal|spawner/.test(n);
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
    bot.pathfinder.setMovements(m);
    console.log('[NAV] pathfinder fallback: dig+parkour+sprint+towers');
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
    c.thinkTimeout = 45000;
    c.stuckTimeout = 6000;
    c.disposableBlocks = [
      'dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
      'netherrack', 'oak_planks', 'spruce_planks', 'birch_planks',
      'cobbled_deepslate', 'tuff',
    ];
    c.blocksToAvoid = ['lava', 'fire', 'magma_block', 'cactus', 'sweet_berry_bush'];
    console.log('[NAV] ashfinder FULL: parkour+break+place+swim');
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
    if (typeof loader !== 'function') {
      console.warn('[NAV] ashfinder loader not found in package');
      return false;
    }
    bot.loadPlugin(loader);
    configureAshfinder(bot);
    console.log('[NAV] @miner-org/mineflayer-baritone LOADED');
    return !!bot.ashfinder;
  } catch (e) {
    console.warn('[NAV] ashfinder install/load failed:', (e.message || '').slice(0, 100));
    return false;
  }
}

/** Unified goto: ashfinder first, pathfinder second */
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
    const { Vec3 } = require('vec3');
    const target = new Vec3(
      Math.floor(x),Math.floor(y),Math.floor(z)
    );

    // 1) mineflayer-baritone
    if (bot.ashfinder) {
      try {
        const goals = (await import('@miner-org/mineflayer-baritone')).goals;
        const GoalNear = goals.GoalNear || goals.GoalExact;
        const goal = goals.GoalNear
          ? new goals.GoalNear(target, range)
          : new goals.GoalExact(target);
        console.log('[NAV] ashfinder goto', target.x, target.y, target.z);
        await withTimeout(bot.ashfinder.goto(goal), 60000);
        return true;
      } catch (e) {
        console.warn('[NAV] ashfinder goto fail → pathfinder', (e.message || '').slice(0, 60));
      }
    }

    // 2) mineflayer-pathfinder
    try {
      const { goals } = require('mineflayer-pathfinder');
      const goal = new goals.GoalNear(target.x, target.y, target.z, range);
      console.log('[NAV] pathfinder goto', target.x, target.y, target.z);
      await withTimeout(bot.pathfinder.goto(goal), 45000);
      return true;
    } catch (e) {
      console.warn('[NAV] pathfinder goto fail', (e.message || '').slice(0, 60));
      return false;
    }
  };

  bot.dreamGotoBlock = async (block, range = 2) => {
    if (!block?.position) return false;
    return bot.dreamGoto(block.position.x, block.position.y, block.position.z, range);
  };
}

/** Micro-navigation when path is stuck or no long goal */
function startLocalNav(bot) {
  if (bot._dreamLocalNav) return;
  bot._dreamLocalNav = true;
  let busy = false;

  setInterval(async () => {
    if (busy || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    // If ashfinder/pathfinder is actively moving far, only help when stuck
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

      // Step up 1 block
      if (solid(frontFoot) && !solid(frontHead)) {
        bot.setControlState('sprint', true);
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 300));
        bot.clearControlStates();
        return;
      }

      // Full wall → dig
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

      // Gap → bridge
      if (!solid(gap) && !solid(frontFoot)) {
        const placeable = bot.inventory.items().find(i =>
          /dirt|cobble|planks|netherrack|stone|tuff|deepslate/.test(i.name)
        );
        if (placeable) {
          try {
            await bot.equip(placeable, 'hand');
            const ref = bot.blockAt(pos.offset(0, -1, 0));
            if (ref) {
              const face = { x: Math.round(fx), y: 0, z: Math.round(fz) };
              await bot.placeBlock(ref, face);
              console.log('[NAV] bridge place');
            }
          } catch {}
          return;
        }
        bot.look(yaw + Math.PI, 0, true);
        bot.setControlState('back', true);
        await new Promise(r => setTimeout(r, 250));
        bot.clearControlStates();
        return;
      }

      // Stuck counter
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
        for (const d of [[0, 1, 0], [fx, 1, fz], [fx, 0, fz], [-Math.cos(yaw), 0, -Math.sin(yaw)]]) {
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

/** Passive: periodically path to resources with ashfinder/pathfinder */
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
        const blocks = bot.findBlocks({ matching: id, maxDistance: dist, count: 1 });
        if (blocks.length) return bot.blockAt(blocks[0]);
      }
    } catch {}
    return null;
  };

  const tick = async () => {
    if (running || !bot.entity) return;
    if (bot._dreamPvpActive) return;
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
        if (ok) {
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
        // Explore randomly with pathfinder/ashfinder
        const yaw = Math.random() * Math.PI * 2;
        const dist = 12 + Math.random() * 16;
        const p = bot.entity.position.offset(
          Math.sin(yaw) * dist,
          0,
          Math.cos(yaw) * dist
        );
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
  console.log('[NAV] passive long-range goals ON (ashfinder/pathfinder)');
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
    startLocalNav(bot);
    startPassiveGoals(bot);
    console.log('[NAV] READY — ashfinder:', hasAsh || !!bot.ashfinder, '| passive goals + local nav');
  };

  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 1000));
}
