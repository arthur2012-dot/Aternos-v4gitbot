/**
 * Navigation: pathfinder + ashfinder with LOCK (one goal at a time).
 * GoalChanged is normal when unstuck cancels a path — never treat as fatal.
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
    const mcData = require('minecraft-data')(bot.version);
    const m = new Movements(bot);
    m.canDig = true;
    m.digCost = 1.2;
    m.placeCost = 1.0;
    m.allowSprinting = true;
    m.allowParkour = true;
    m.allow1by1towers = true;
    m.canOpenDoors = true;
    m.allowFreeMotion = false;
    m.maxDropDown = 3;
    m.dontMineUnderFallingBlock = true;

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
    for (const name of ['crafting_table', 'chest', 'furnace', 'beacon', 'spawner']) {
      const id = mcData.blocksByName[name]?.id;
      if (id != null) m.blocksCantBreak.add(id);
    }
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 10000;
    console.log('[NAV] pathfinder dig+scaffold+tower');
  } catch (e) {
    console.warn('[NAV] pathfinder setup', e.message);
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
    af.enableBreaking?.();
    af.enablePlacing?.();
    const c = af.config || {};
    c.breakBlocks = true;
    c.placeBlocks = true;
    c.parkour = true;
    c.swimming = true;
    c.proParkour = false;
    c.maxFallDist = 3;
    c.thinkTimeout = 45000;
    c.stuckTimeout = 8000;
    c.disposableBlocks = [
      'dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
      'netherrack', 'oak_planks', 'spruce_planks', 'birch_planks',
      'cobbled_deepslate', 'tuff', 'sand',
    ];
  } catch {}
}

function installDreamGoto(bot) {
  bot._navBusy = false;
  bot._navSince = 0;

  bot.dreamStopNav = () => {
    try {
      bot.ashfinder?.stop?.();
    } catch {}
    try {
      // stop() first — setGoal(null) alone throws GoalChanged on active goto
      bot.pathfinder?.stop?.();
    } catch {}
    try {
      bot.pathfinder?.setGoal?.(null);
    } catch (e) {
      const m = String(e?.message || e || '');
      if (!/GoalChanged|PathStopped|No path/i.test(m)) {
        console.warn('[NAV] stop', m.slice(0, 40));
      }
    }
    bot._navBusy = false;
  };

  bot.dreamGoto = async (x, y, z, range = 1) => {
    if (!bot.entity) return false;

    if (bot._navBusy) {
      const age = Date.now() - (bot._navSince || 0);
      if (age < 25000) {
        return false;
      }
      bot.dreamStopNav();
    }

    bot._navBusy = true;
    bot._navSince = Date.now();

    try {
      if (inWater(bot)) {
        for (let i = 0; i < 30; i++) {
          if (!inWater(bot)) break;
          bot.setControlState('jump', true);
          bot.setControlState('forward', true);
          await new Promise((r) => setTimeout(r, 100));
        }
        bot.clearControlStates();
      }

      const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

      try {
        setupPrismarine(bot);
        await withTimeout(
          bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)),
          40000
        );
        return true;
      } catch (e) {
        const msg = (e.message || e.name || '').slice(0, 60);
        if (!/GoalChanged|goal was changed|PathStopped|cancel|No path|Timeout|timeout/i.test(msg)) {
          console.warn('[NAV] pf', msg);
        }
      }

      if (bot.ashfinder) {
        try {
          configAsh(bot);
          const bar = await import('@miner-org/mineflayer-baritone');
          const g = bar.goals || bar.default?.goals;
          if (g?.GoalNear) {
            await withTimeout(bot.ashfinder.goto(new g.GoalNear(target, range)), 40000);
            return true;
          }
        } catch (e) {
          const msg = (e.message || '').slice(0, 50);
          if (!/Already navigating|stop|GoalChanged/i.test(msg)) {
            console.warn('[NAV] ash', msg);
          }
        }
      }
      return false;
    } finally {
      bot._navBusy = false;
    }
  };

  bot.dreamGotoBlock = async (block, range = 2) => {
    if (!block?.position) return false;
    return bot.dreamGoto(block.position.x, block.position.y, block.position.z, range);
  };

  bot.dreamIsNavigating = () =>
    !!bot._navBusy ||
    !!bot.pathfinder?.isMoving?.() ||
    !!bot.targetDigBlock;
}

async function digEscapeTight(bot) {
  if (!bot.entity) return false;
  const p = bot.entity.position.floored();
  const inv = bot.inventory.items();
  const pick = inv.find((i) => /pickaxe/.test(i.name));
  const axe = inv.find((i) => /_axe$/.test(i.name));
  const shovel = inv.find((i) => /shovel/.test(i.name));

  try {
    const look = bot.blockAtCursor?.(3.5);
    if (look && look.boundingBox === 'block' && !/bedrock|barrier/.test(look.name || '')) {
      const n = look.name || '';
      if (/dirt|grass|sand|gravel|clay|mud/.test(n) && shovel) await bot.equip(shovel, 'hand');
      else if (/_log$|leaves|planks/.test(n) && axe) await bot.equip(axe, 'hand');
      else if (pick) await bot.equip(pick, 'hand');
      await bot.lookAt(look.position.offset(0.5, 0.5, 0.5), true);
      await withTimeout(bot.dig(look), 8000);
      console.log('[NAV] dig face', n);
    }
  } catch { try { bot.stopDigging(); } catch {} }

  const yaw = bot.entity.yaw;
  const fdx = Math.round(-Math.sin(yaw));
  const fdz = Math.round(-Math.cos(yaw));
  const facing = [[fdx, 0, fdz], [fdx, 1, fdz], [0, 1, 0], [0, 2, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

  let dug = 0;
  for (const [ox, oy, oz] of facing) {
    try {
      const b = bot.blockAt(p.offset(ox, oy, oz));
      if (!b || b.name === 'air' || b.name === 'cave_air' || b.name === 'water') continue;
      if (b.boundingBox !== 'block') continue;
      if (/bedrock|barrier|command/.test(b.name)) continue;
      const n = b.name || '';
      if (/dirt|grass|sand|gravel/.test(n) && shovel) { try { await bot.equip(shovel, 'hand'); } catch {} }
      else if (/_log$|planks|leaves/.test(n) && axe) { try { await bot.equip(axe, 'hand'); } catch {} }
      else if (pick) { try { await bot.equip(pick, 'hand'); } catch {} }
      await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true);
      await withTimeout(bot.dig(b), 8000);
      dug++;
      if (dug >= 5) break;
    } catch { try { bot.stopDigging(); } catch {} }
  }

  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  await new Promise((r) => setTimeout(r, 400));
  bot.entity.yaw += Math.PI / 2;
  try { await bot.look(bot.entity.yaw, 0, true); } catch {}
  await new Promise((r) => setTimeout(r, 400));
  bot.clearControlStates();
  if (dug > 0) console.log('[NAV] dug escape blocks:', dug);
  return dug > 0;
}

function startUnstuck(bot, agent) {
  if (bot._dreamUnstuck) return;
  bot._dreamUnstuck = true;
  let still = 0;
  let lx = null, ly = null, lz = null;

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (bot.targetDigBlock) {
        still = 0;
        return;
      }

      const x = bot.entity.position.x;
      const y = bot.entity.position.y;
      const z = bot.entity.position.z;
      if (lx != null && Math.abs(x - lx) + Math.abs(z - lz) + Math.abs(y - ly) < 0.15) still++;
      else still = 0;
      lx = x; ly = y; lz = z;

      // ~4.5s still before dig (was 3s — less GoalChanged spam mid-path)
      if (still >= 3) {
        still = 0;
        console.log('[NAV] STUCK → dig wall+face');
        try { bot.dreamStopNav(); } catch {}
        try { await digEscapeTight(bot); } catch (e) {
          console.warn('[NAV] dig escape', (e.message || '').slice(0, 40));
        }
        return;
      }
    } catch {}
  }, 1500);
}

export async function startNavStack(agent) {
  const bot = agent.bot;
  if (!bot) return;

  setupPrismarine(bot);
  await setupAshfinder(bot);
  installDreamGoto(bot);

  // Swallow pathfinder GoalChanged so Mindcraft does not print !!Code threw!!
  try {
    bot.on('path_update', () => {});
    const origEmit = bot.pathfinder?.emit?.bind(bot.pathfinder);
  } catch {}

  const boot = () => {
    setupPrismarine(bot);
    if (bot.ashfinder) configAsh(bot);
    startUnstuck(bot, agent);
    console.log('[NAV] READY — locked goto + soft GoalChanged');
  };

  if (bot.entity) boot();
  else bot.once('spawn', boot);
  bot.on('respawn', () => setTimeout(boot, 600));
}

export async function startBaritoneNav(agent) {
  return startNavStack(agent);
}
