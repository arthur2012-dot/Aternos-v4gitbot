/**
 * Baritone-inspired navigation for DreamBot (mineflayer).
 *
 * Real Baritone (cabaletta) and Automatone are JAVA client/server mods —
 * they cannot run inside a Node/Railway bot. This module ports the useful ideas:
 * - Prefer walking over digging (cost model)
 * - Parkour, sprint, 1x1 towers, dig/place
 * - Optional @miner-org/mineflayer-baritone (ashfinder) when available
 * - Local obstacle reaction (step-up, dig wall, bridge, unstuck)
 *
 * Works in BOTH active and passive modes.
 */

const AIR = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'light']);

function solid(b) {
  if (!b) return false;
  const n = b.name || '';
  if (AIR.has(n)) return false;
  if (n.includes('sign') || n.includes('torch') || n.includes('carpet')) return false;
  return b.boundingBox === 'block';
}

function diggable(b) {
  if (!solid(b)) return false;
  const n = b.name || '';
  return !n.includes('bedrock') && !n.includes('barrier') && !n.includes('obsidian');
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

function setupPathfinderBaritoneStyle(bot) {
  try {
    const { Movements } = require('mineflayer-pathfinder');
    const m = new Movements(bot);
    // Baritone-like: dig/place allowed but costly so walking is preferred
    m.canDig = true;
    m.allowSprinting = true;
    m.allowParkour = true;
    m.allow1by1towers = true;
    m.canOpenDoors = true;
    m.maxDropDown = 4;
    m.scafoldingBlocks = ['dirt', 'cobblestone', 'netherrack', 'oak_planks', 'spruce_planks', 'birch_planks'];
    // Higher dig cost = prefer path around (Baritone philosophy)
    if (typeof m.digCost === 'number') m.digCost = 8;
    if (typeof m.placeCost === 'number') m.placeCost = 6;
    bot.pathfinder.setMovements(m);
    console.log('[DreamBot] pathfinder Baritone-style (dig costly, parkour, towers)');
  } catch (e) {
    console.warn('[DreamBot] pathfinder setup', e.message);
  }
}

async function tryLoadAshfinder(bot) {
  try {
    const mod = await import('@miner-org/mineflayer-baritone');
    const loader = mod.loader || mod.default?.loader;
    if (!loader) return false;
    bot.loadPlugin(loader);
    if (bot.ashfinder?.config) {
      bot.ashfinder.config.parkour = true;
      bot.ashfinder.config.swimming = true;
      bot.ashfinder.config.breakBlocks = true;
      bot.ashfinder.config.placeBlocks = true;
    }
    console.log('[DreamBot] mineflayer-baritone (ashfinder) loaded');
    return true;
  } catch (e) {
    console.warn('[DreamBot] ashfinder optional skip:', e.message?.slice(0, 80));
    return false;
  }
}

/** Local micro-navigation every ~1.5s — both modes */
function startLocalNav(bot) {
  if (bot._dreamBaritoneNav) return;
  bot._dreamBaritoneNav = true;
  let busy = false;

  const tick = async () => {
    if (busy || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    busy = true;
    try {
      const pos = bot.entity.position;
      const yaw = bot.entity.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const f = (dx, dy, dz) => bot.blockAt(pos.offset(dx, dy, dz));

      const frontFoot = f(fx, 0, fz);
      const frontHead = f(fx, 1, fz);
      const step = f(fx, 1, fz);
      const aboveStep = f(fx, 2, fz);
      const gap = f(fx, -1, fz);

      // 1-block step-up (Baritone ascend)
      if (solid(frontFoot) && !solid(frontHead) && !solid(aboveStep) && solid(step) === false) {
        // actually: solid at foot level in front, air at head = step
      }
      if (solid(frontFoot) && !solid(frontHead)) {
        bot.setControlState('sprint', true);
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 280));
        bot.clearControlStates();
        return;
      }

      // Wall: dig if diggable (Baritone break)
      if (solid(frontFoot) && solid(frontHead)) {
        try {
          bot.pathfinder?.setGoal?.(null);
        } catch {}
        for (const blk of [frontHead, frontFoot]) {
          if (diggable(blk)) {
            try {
              await withTimeout(bot.dig(blk), 4000);
            } catch {
              try { bot.stopDigging(); } catch {}
            }
            return;
          }
        }
        // Can't dig — turn (avoid infinite push)
        bot.look(yaw + Math.PI / 2, 0, true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 400));
        bot.clearControlStates();
        return;
      }

      // Gap bridge
      if (!solid(gap) && !solid(frontFoot)) {
        const placeable = bot.inventory.items().find(i =>
          /dirt|cobble|planks|netherrack|stone/.test(i.name)
        );
        if (placeable) {
          try {
            await bot.equip(placeable, 'hand');
            const ref = bot.blockAt(pos.offset(0, -1, 0));
            if (ref) {
              await bot.placeBlock(ref, { x: Math.round(fx), y: 0, z: Math.round(fz) });
            }
          } catch {}
          return;
        }
        bot.look(yaw + Math.PI, 0, true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 300));
        bot.clearControlStates();
        return;
      }

      // Stuck detector
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      if (!bot._navLastPos) bot._navLastPos = key;
      if (!bot._navStill) bot._navStill = 0;
      if (key === bot._navLastPos) bot._navStill++;
      else {
        bot._navLastPos = key;
        bot._navStill = 0;
      }
      if (bot._navStill > 5) {
        bot._navStill = 0;
        try { bot.pathfinder?.setGoal?.(null); } catch {}
        for (const d of [
          [0, 1, 0], [fx, 1, fz], [fx, 0, fz], [-fx, 0, -fz],
        ]) {
          const b = f(d[0], d[1], d[2]);
          if (diggable(b)) {
            try { await withTimeout(bot.dig(b), 3500); } catch { try { bot.stopDigging(); } catch {} }
            break;
          }
        }
        bot.look(yaw + Math.PI * 0.6, 0, true);
        bot.setControlState('jump', true);
        bot.setControlState('sprint', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 500));
        bot.clearControlStates();
      }
    } catch (e) {
      // ignore
    } finally {
      busy = false;
    }
  };

  setInterval(tick, 1500);
  console.log('[DreamBot] Baritone-style local NAV on (passive+active)');
}

export async function startBaritoneNav(agent) {
  const bot = agent.bot;
  if (!bot) return;
  setupPathfinderBaritoneStyle(bot);
  await tryLoadAshfinder(bot);
  const onSpawn = () => {
    setupPathfinderBaritoneStyle(bot);
    startLocalNav(bot);
  };
  if (bot.entity) onSpawn();
  else bot.once('spawn', onSpawn);
  bot.on('respawn', () => setTimeout(onSpawn, 800));
}
