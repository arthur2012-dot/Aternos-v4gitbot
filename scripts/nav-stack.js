/**
 * UNIFIED navigation — dig out 1-high traps, climb holes, fast dig
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
  if (/sign|torch|carpet|button|rail|flower|grass|fern|dead_bush|snow$/.test(n)) return false;
  return b.boundingBox === 'block';
}

function isWater(b) {
  if (!b) return false;
  return WATER.has(b.name) || (b.name || '').includes('water');
}

function diggable(b) {
  if (!solid(b)) return false;
  return !/bedrock|barrier|obsidian|command|spawner|end_portal|reinforced/.test(b.name || '');
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

async function fastDig(bot, block) {
  if (!block || !diggable(block)) return false;
  try {
    // equip best tool quickly
    const items = bot.inventory.items();
    const isWood = /_log$|planks|leaves/.test(block.name);
    const isDirt = /dirt|grass_block|sand|gravel|clay|mud/.test(block.name);
    let tool = null;
    if (isWood) tool = items.find(i => /_axe$/.test(i.name));
    else if (isDirt) tool = items.find(i => /_shovel$/.test(i.name));
    else tool = items.find(i => /_pickaxe$/.test(i.name));
    if (tool) {
      try { await bot.equip(tool, 'hand'); } catch {}
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await withTimeout(bot.dig(block, true), 6000); // forceLook
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

function scaffoldItem(bot) {
  return bot.inventory.items().find(i =>
    /dirt|cobblestone|stone$|andesite|diorite|granite|netherrack|_planks$|cobbled_deepslate|tuff|sand|gravel/.test(i.name)
  );
}

/** Place one block under feet or in front to climb out of hole */
async function placeScaffold(bot, offset) {
  const item = scaffoldItem(bot);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref) return false;
    // offset is Vec3 direction from feet
    const face = offset || new Vec3(0, 1, 0);
    // If placing under: sneak + place below while jumping
    if (face.y > 0) {
      bot.setControlState('sneak', true);
      bot.setControlState('jump', true);
      await new Promise(r => setTimeout(r, 80));
      try {
        await withTimeout(bot.placeBlock(ref, new Vec3(0, 1, 0)), 1500);
      } catch {}
      bot.clearControlStates();
      return true;
    }
    await withTimeout(bot.placeBlock(ref, face), 1500);
    return true;
  } catch {
    bot.clearControlStates();
    return false;
  }
}

/** Detect 1-block-high crawl / head stuck / pit */
function trapState(bot) {
  const pos = bot.entity.position;
  const head = bot.blockAt(pos.offset(0, 1, 0));
  const above = bot.blockAt(pos.offset(0, 2, 0));
  const below = bot.blockAt(pos.offset(0, -1, 0));
  const yaw = bot.entity.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const front = bot.blockAt(pos.offset(fx, 0, fz));
  const frontHead = bot.blockAt(pos.offset(fx, 1, fz));
  const frontDown = bot.blockAt(pos.offset(fx, -1, fz));

  const headSolid = solid(head);
  const aboveSolid = solid(above);
  const inPit =
    solid(below) &&
    solid(bot.blockAt(pos.offset(1, 0, 0))) &&
    solid(bot.blockAt(pos.offset(-1, 0, 0))) &&
    solid(bot.blockAt(pos.offset(0, 0, 1))) &&
    solid(bot.blockAt(pos.offset(0, 0, -1)));

  // 1-high: body in space where head block is solid (crouch height)
  const oneHigh = headSolid || (solid(front) && solid(frontHead));

  return { head, above, below, front, frontHead, frontDown, headSolid, aboveSolid, inPit, oneHigh, fx, fz, pos, yaw };
}

async function escapeTrap(bot) {
  const t = trapState(bot);
  console.log('[NAV] escape trap oneHigh=' + t.oneHigh + ' pit=' + t.inPit);

  // 1) Dig head block if 1-high cage
  if (t.headSolid && diggable(t.head)) {
    if (await fastDig(bot, t.head)) return true;
  }
  if (t.aboveSolid && diggable(t.above)) {
    if (await fastDig(bot, t.above)) return true;
  }

  // 2) Dig front wall at eye level
  if (solid(t.frontHead) && diggable(t.frontHead)) {
    if (await fastDig(bot, t.frontHead)) return true;
  }
  if (solid(t.front) && diggable(t.front)) {
    if (await fastDig(bot, t.front)) return true;
  }

  // 3) Dig any side wall
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const side = bot.blockAt(t.pos.offset(dx, 0, dz));
    const sideH = bot.blockAt(t.pos.offset(dx, 1, dz));
    if (diggable(sideH) && (await fastDig(bot, sideH))) return true;
    if (diggable(side) && (await fastDig(bot, side))) return true;
  }

  // 4) Tower up with blocks (hole escape)
  if (scaffoldItem(bot)) {
    for (let i = 0; i < 3; i++) {
      const up = bot.blockAt(bot.entity.position.offset(0, 2, 0));
      if (solid(up) && diggable(up)) {
        await fastDig(bot, up);
      }
      const ok = await placeScaffold(bot, new Vec3(0, 1, 0));
      if (!ok) break;
      await new Promise(r => setTimeout(r, 200));
    }
    return true;
  }

  // 5) Turn and short move
  try {
    await bot.look(t.yaw + Math.PI / 2, 0, true);
  } catch {}
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  await new Promise(r => setTimeout(r, 400));
  bot.clearControlStates();
  return false;
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
      'cobbled_deepslate', 'tuff', 'andesite', 'dirt',
    ];
    if (typeof m.digCost === 'number') m.digCost = 2;
    if (typeof m.placeCost === 'number') m.placeCost = 2;
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 6000;
    console.log('[NAV-STACK] Prismarine ON');
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
    console.warn('[NAV-STACK] ashfinder skip', (e.message || '').slice(0, 60));
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
    c.swimming = true;
    c.breakBlocks = true;
    c.placeBlocks = true;
    c.maxFallDist = 4;
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
          await withTimeout(bot.ashfinder.goto(new g.GoalNear(target, range)), 45000);
          return true;
        }
      } catch {}
    }
    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)),
        35000
      );
      return true;
    } catch {
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
  for (let i = 0; i < 25; i++) {
    if (!inWater(bot)) break;
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    try { await bot.look(bot.entity.yaw, -0.5, true); } catch {}
    await new Promise(r => setTimeout(r, 160));
  }
  bot.clearControlStates();
  return !inWater(bot);
}

function startLocalLayer(bot, agent) {
  if (bot._dreamNavLocal) return;
  bot._dreamNavLocal = true;
  let busy = false;
  let stuckTicks = 0;
  let lx = null, lz = null;

  setInterval(async () => {
    if (busy || !bot.entity) return;
    // Allow trap escape even during passive — only skip heavy PvP
    if (bot._dreamPvpActive) return;

    const pos = bot.entity.position;
    if (lx != null) {
      const moved = Math.abs(pos.x - lx) + Math.abs(pos.z - lz);
      if (moved < 0.08) stuckTicks++;
      else stuckTicks = 0;
    }
    lx = pos.x;
    lz = pos.z;

    const t = trapState(bot);
    const needEscape = t.oneHigh || t.inPit || stuckTicks >= 4;

    if (inWater(bot)) {
      busy = true;
      try { await escapeWater(bot); } finally { busy = false; }
      return;
    }

    if (needEscape) {
      busy = true;
      try {
        await escapeTrap(bot);
        stuckTicks = 0;
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

      // step-up: jump
      if (solid(ff) && !solid(fh)) {
        bot.setControlState('sprint', true);
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await new Promise(r => setTimeout(r, 250));
        bot.clearControlStates();
        return;
      }
      // wall: dig fast
      if (solid(ff) && solid(fh)) {
        if (diggable(fh)) await fastDig(bot, fh);
        else if (diggable(ff)) await fastDig(bot, ff);
        else {
          try { await bot.look(yaw + 1.2, 0, true); } catch {}
          bot.setControlState('forward', true);
          await new Promise(r => setTimeout(r, 300));
          bot.clearControlStates();
        }
        return;
      }
      // gap: place bridge quickly
      if (!solid(gap) && !solid(ff) && !isWater(gap)) {
        await placeScaffold(bot, new Vec3(Math.round(fx), 0, Math.round(fz)));
      }
    } catch {
    } finally {
      busy = false;
    }
  }, 700); // faster loop

  console.log('[NAV-STACK] local layer ON (1-high + hole escape)');
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
    if (run || !bot.entity) return;
    if (bot._dreamPvpActive) return;
    if (agent?._passiveRunning) return;
    if (inWater(bot)) return;
    run = true;
    try {
      const inv = bot.inventory.items();
      const logs = inv.filter(i => /_log$/.test(i.name)).reduce((s, i) => s + i.count, 0);
      const pick = inv.some(i => /pickaxe/.test(i.name));
      const cobble = inv.filter(i => i.name === 'cobblestone' || i.name === 'stone').reduce((s, i) => s + i.count, 0);

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
        console.log('[NAV-STACK] dig', label);
        await bot.dreamGotoBlock(b, 2);
        await fastDig(bot, b);
      }
    } catch (e) {
      console.warn('[NAV-STACK] passive', e.message);
    } finally {
      run = false;
    }
  }, 12000);
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
  bot.on('respawn', () => setTimeout(boot, 600));
}

export async function startBaritoneNav(agent) {
  return startNavStack(agent);
}
