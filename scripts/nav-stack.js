/**
 * Navigation based on official plugins only:
 * - mineflayer-pathfinder (Movements canDig + scafoldingBlocks)
 * - @miner-org/mineflayer-baritone (ashfinder enableBreaking/Placing)
 * Custom dig only for RESOURCE mining (wood/stone), not pathfighting.
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const require = createRequire(import.meta.url);
const { Movements, goals } = pathfinder;

function inWater(bot) {
  try {
    if (bot.entity.isInWater) return true;
  } catch {}
  try {
    const n = bot.blockAt(bot.entity.position)?.name || '';
    return n.includes('water');
  } catch {
    return false;
  }
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

/** Official pathfinder Movements — dig/place during pathing */
function setupPrismarine(bot) {
  try {
    const mcData = require('minecraft-data')(bot.version);
    const m = new Movements(bot);

    m.canDig = true;
    m.digCost = 1;
    m.placeCost = 1;
    m.allowSprinting = true;
    m.allowParkour = true;
    m.allow1by1towers = true; // tower with scaffolding
    m.canOpenDoors = true;
    m.allowFreeMotion = true;
    m.maxDropDown = 4;
    m.dontMineUnderFallingBlock = true;

    // scaffolding = ITEM ids (official API)
    const scaffoldNames = [
      'dirt', 'cobblestone', 'stone', 'netherrack',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'cobbled_deepslate', 'tuff', 'andesite', 'diorite', 'granite',
    ];
    m.scafoldingBlocks = [];
    for (const name of scaffoldNames) {
      const id = mcData.itemsByName[name]?.id;
      if (id != null) m.scafoldingBlocks.push(id);
    }

    // avoid breaking valuables
    for (const name of ['crafting_table', 'chest', 'furnace', 'beacon', 'spawner']) {
      const id = mcData.blocksByName[name]?.id;
      if (id != null) m.blocksCantBreak.add(id);
    }

    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 8000;
    console.log('[NAV] pathfinder Movements: canDig+scaffold+tower');
  } catch (e) {
    console.warn('[NAV] pathfinder setup', e.message);
  }
}

/** Official ashfinder (mineflayer-baritone) */
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
    console.log('[NAV] ashfinder ON');
    return !!bot.ashfinder;
  } catch (e) {
    console.warn('[NAV] ashfinder', (e.message || '').slice(0, 60));
    return false;
  }
}

function configAsh(bot) {
  const af = bot.ashfinder;
  if (!af) return;
  try {
    // Official helpers
    af.enableBreaking?.();
    af.enablePlacing?.();
    const c = af.config || {};
    c.breakBlocks = true;
    c.placeBlocks = true;
    c.parkour = true;
    c.swimming = true;
    c.proParkour = false;
    c.maxFallDist = 4;
    c.thinkTimeout = 45000;
    c.stuckTimeout = 6000;
    c.disposableBlocks = [
      'dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
      'netherrack', 'oak_planks', 'spruce_planks', 'birch_planks',
      'cobbled_deepslate', 'tuff', 'sand',
    ];
    c.blocksToAvoid = [
      'lava', 'fire', 'magma_block', 'cactus',
      'crafting_table', 'chest', 'furnace',
    ];
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

  /** Path with dig/place handled by the plugin, not custom code */
  bot.dreamGoto = async (x, y, z, range = 1) => {
    if (!bot.entity) return false;
    if (inWater(bot)) {
      for (let i = 0; i < 20; i++) {
        if (!inWater(bot)) break;
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 150));
      }
      bot.clearControlStates();
    }

    const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    // Prefer ashfinder (Baritone-style dig/place in path)
    if (bot.ashfinder) {
      try {
        configAsh(bot);
        const bar = await import('@miner-org/mineflayer-baritone');
        const g = bar.goals || bar.default?.goals;
        if (g?.GoalNear) {
          await withTimeout(bot.ashfinder.goto(new g.GoalNear(target, range)), 50000);
          return true;
        }
        if (g?.GoalExact) {
          await withTimeout(bot.ashfinder.goto(new g.GoalExact(target)), 50000);
          return true;
        }
      } catch (e) {
        console.warn('[NAV] ash goto', (e.message || '').slice(0, 40));
      }
    }

    // Fallback: prismarine pathfinder (Movements dig/scaffold)
    try {
      setupPrismarine(bot);
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)),
        40000
      );
      return true;
    } catch (e) {
      console.warn('[NAV] pf goto', (e.message || '').slice(0, 40));
      return false;
    }
  };

  bot.dreamGotoBlock = async (block, range = 2) => {
    if (!block?.position) return false;
    return bot.dreamGoto(block.position.x, block.position.y, block.position.z, range);
  };
}

/** Resource dig only — standard bot.dig, not path override */
async function resourceDig(bot, block) {
  if (!block) return false;
  try {
    const items = bot.inventory.items();
    const n = block.name || '';
    let tool = null;
    if (/_log$|planks|leaves/.test(n)) tool = items.find(i => /_axe$/.test(i.name));
    else if (/dirt|sand|gravel|grass/.test(n)) tool = items.find(i => /_shovel$/.test(i.name));
    else tool = items.find(i => /_pickaxe$/.test(i.name));
    if (tool) await bot.equip(tool, 'hand');
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await withTimeout(bot.dig(block), 8000);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

function startPassiveResource(bot, agent) {
  if (bot._dreamPassiveRes) return;
  bot._dreamPassiveRes = true;
  let run = false;

  const find = (names, dist) => {
    try {
      const mcData = require('minecraft-data')(bot.version);
      for (const name of names) {
        const id = mcData.blocksByName[name]?.id;
        if (id == null) continue;
        const blocks = bot.findBlocks({ matching: id, maxDistance: dist, count: 4 });
        if (blocks[0]) return bot.blockAt(blocks[0]);
      }
    } catch {}
    return null;
  };

  setInterval(async () => {
    if (run || !bot.entity || bot._dreamPvpActive) return;
    if (agent?.actions?.executing) return;
    if (bot.pathfinder?.isMoving?.()) return;
    if (bot.ashfinder?.path?.length) return;
    run = true;
    try {
      const inv = bot.inventory.items();
      const logs = inv.filter(i => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0);
      const pick = inv.some(i => /pickaxe/.test(i.name));
      const cobble = inv.filter(i => /cobblestone|^stone$/.test(i.name)).reduce((s, i) => s + i.count, 0);

      let b = null;
      if (logs < 8) {
        b = find(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log'], 36);
      } else if (pick && cobble < 16) {
        b = find(['stone', 'cobblestone', 'deepslate'], 24);
      }
      if (!b) return;

      console.log('[NAV] resource', b.name);
      // goto uses pathfinder/ash dig-place for obstacles
      await bot.dreamGoto(b.position.x, b.position.y, b.position.z, 2);
      await resourceDig(bot, b);
    } catch (e) {
      console.warn('[NAV] resource', e.message);
    } finally {
      run = false;
    }
  }, 12000);

  console.log('[NAV] passive resource via pathfinder/ash');
}

/** Minimal unstuck: only ask pathfinder to move away, no custom dig war */
function startUnstuck(bot, agent) {
  if (bot._dreamUnstuck) return;
  bot._dreamUnstuck = true;
  let still = 0;
  let lx = null, lz = null;

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (bot.pathfinder?.isMoving?.()) {
        still = 0;
        return;
      }
      const x = bot.entity.position.x;
      const z = bot.entity.position.z;
      if (lx != null && Math.abs(x - lx) + Math.abs(z - lz) < 0.08) still++;
      else still = 0;
      lx = x;
      lz = z;

      if (still < 6) return; // ~9s
      still = 0;
      console.log('[NAV] unstuck → pathfinder GoalNear offset');
      const yaw = bot.entity.yaw;
      const tx = bot.entity.position.x - Math.sin(yaw) * 4;
      const tz = bot.entity.position.z - Math.cos(yaw) * 4;
      const ty = bot.entity.position.y;
      try {
        await bot.dreamGoto(tx, ty, tz, 1);
      } catch {}
    } catch {}
  }, 1500);
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
    startPassiveResource(bot, agent);
    startUnstuck(bot, agent);
    console.log('[NAV] READY — dig/place = pathfinder + ashfinder');
  };

  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 600));
}

export async function startBaritoneNav(agent) {
  return startNavStack(agent);
}
