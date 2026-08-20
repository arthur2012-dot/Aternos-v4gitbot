/**
 * DIG + PLACE — FAST player-like dig
 * Equip correct tool → look once → bot.dig once (mineflayer handles hold timing)
 * No mid-dig lookAt. No multi-minute packet loops.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function race(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, j) => {
        t = setTimeout(() => j(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function isUnbreakable(name) {
  return /bedrock|barrier|command_block|end_portal|end_gateway|structure|reinforced/.test(name || '');
}

function isAirName(n) {
  return !n || n === 'air' || n === 'cave_air' || n === 'void_air';
}

export function bestToolFor(bot, block) {
  if (!bot || !block) return null;
  const inv = bot.inventory.items();
  const n = block.name || '';

  // Prefer correct category first (player-like)
  if (/_log$|planks|leaves|bamboo|stem|hyphae/.test(n)) {
    return (
      inv.find((i) => /netherite_axe|diamond_axe/.test(i.name)) ||
      inv.find((i) => /iron_axe/.test(i.name)) ||
      inv.find((i) => /stone_axe/.test(i.name)) ||
      inv.find((i) => /_axe$/.test(i.name)) ||
      inv.find((i) => /_pickaxe$/.test(i.name))
    );
  }
  if (/dirt|sand|gravel|grass|clay|mud|snow|soul_sand/.test(n)) {
    return (
      inv.find((i) => /_shovel$/.test(i.name)) ||
      inv.find((i) => /_pickaxe$/.test(i.name))
    );
  }
  // stone / ore / deepslate
  return (
    inv.find((i) => /netherite_pickaxe|diamond_pickaxe/.test(i.name)) ||
    inv.find((i) => /iron_pickaxe/.test(i.name)) ||
    inv.find((i) => /stone_pickaxe/.test(i.name)) ||
    inv.find((i) => /_pickaxe$/.test(i.name))
  );
}

export async function equipBestTool(bot, block) {
  if (!bot || !block) return false;
  try {
    if (bot.tool?.equipForBlock) {
      await bot.tool.equipForBlock(block, { requireHarvest: false });
      // verify held is a tool if block is hard
      if (bot.heldItem && /pickaxe|axe|shovel/.test(bot.heldItem.name)) return true;
    }
  } catch {}
  const tool = bestToolFor(bot, block);
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
      return true;
    } catch {}
  }
  return false;
}

/** Max wait = digTime + small buffer. Stone+wood pick ~0.75s, hand stone ~7.5s */
function digTimeoutMs(bot, block) {
  try {
    const t = bot.digTime(block);
    if (Number.isFinite(t) && t > 0) return Math.min(Math.max(t + 500, 200), 12000);
  } catch {}
  try {
    const held = bot.heldItem;
    if (held && block.digTime) {
      const t = block.digTime(held.type);
      if (Number.isFinite(t) && t > 0) return Math.min(Math.max(t + 500, 200), 12000);
    }
  } catch {}
  const n = block.name || '';
  if (/_log$|dirt|grass|sand|gravel|leaves/.test(n)) return 2500;
  if (/stone|cobble|ore|deepslate/.test(n)) {
    // with pick should be fast; if hand, still cap so we don't wait 2 min
    return bot.heldItem && /pickaxe/.test(bot.heldItem.name) ? 3000 : 9000;
  }
  return 5000;
}

/**
 * FAST dig: equip → look once → bot.dig (native hold) → done
 * 1-2 retries max, each capped at digTime.
 */
export async function digBlock(bot, block, opts = {}) {
  if (!bot?.entity || !block) return false;
  if (isUnbreakable(block.name)) return false;
  if (bot._digLocked && bot._digLockPos && !bot._digLockPos.equals?.(block.position)) {
    return false;
  }

  const pos = block.position.clone();
  const retries = opts.retries ?? 2;

  bot._digLocked = true;
  bot._digLockPos = pos.clone();
  bot._digHoldActive = true;

  try {
    try {
      bot.pathfinder?.setGoal?.(null);
      bot.pathfinder?.stop?.();
    } catch {}
    try {
      bot.clearControlStates();
    } catch {}

    // range check — walk closer without long path
    const dist = bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5));
    if (dist > 4.5) {
      try {
        await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await sleep(Math.min(800, dist * 150));
        bot.clearControlStates();
      } catch {}
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      const live = bot.blockAt(pos);
      if (!live || isAirName(live.name) || live.type === 0) return true;
      if (isUnbreakable(live.name)) return false;

      await equipBestTool(bot, live);
      await sleep(50);

      // must have pick for stone or dig is painfully slow
      if (/stone|cobble|ore|deepslate|netherrack/.test(live.name)) {
        if (!bot.heldItem || !/pickaxe/.test(bot.heldItem.name)) {
          await equipBestTool(bot, live);
        }
      }

      const center = pos.offset(0.5, 0.5, 0.5);
      try {
        await bot.lookAt(center, true);
      } catch {}

      const maxMs = opts.maxMs || digTimeoutMs(bot, live);
      bot._digLockUntil = Date.now() + maxMs + 1000;

      const t0 = Date.now();
      try {
        // Native dig = continuous left-click hold until break
        await race(bot.dig(live, true), maxMs);
      } catch {
        try {
          bot.stopDigging();
        } catch {}
      }

      const after = bot.blockAt(pos);
      if (!after || isAirName(after.name) || after.type === 0) {
        console.log('[DIG] ok', live.name, (Date.now() - t0) + 'ms', bot.heldItem?.name || 'hand');
        return true;
      }

      // quick re-equip and one more try
      await sleep(80);
    }
    return false;
  } catch {
    try {
      bot.stopDigging();
    } catch {}
    return false;
  } finally {
    bot._digLocked = false;
    bot._digLockPos = null;
    bot._digLockUntil = 0;
    bot._digHoldActive = false;
    bot.targetDigBlock = null;
  }
}

export async function breakBlockAt(bot, x, y, z) {
  if (x == null || y == null || z == null) return false;
  const block = bot.blockAt(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)));
  if (!block || isAirName(block.name) || block.name === 'water' || block.name === 'lava') return false;
  return digBlock(bot, block);
}

export async function digFrontWall(bot) {
  if (!bot?.entity || bot._digLocked) return false;
  const yaw = bot.entity.yaw;
  const fx = Math.round(-Math.sin(yaw));
  const fz = Math.round(-Math.cos(yaw));
  const targets = [
    bot.blockAt(bot.entity.position.offset(fx, 1, fz)),
    bot.blockAt(bot.entity.position.offset(fx, 0, fz)),
  ];
  for (const b of targets) {
    if (b && !isAirName(b.name) && !isUnbreakable(b.name)) {
      if (await digBlock(bot, b)) return true;
    }
  }
  return false;
}

export function scaffoldItem(bot) {
  const pref = [/dirt/, /cobblestone/, /netherrack/, /planks/, /stone$/];
  const inv = bot.inventory.items();
  for (const re of pref) {
    const it = inv.find((i) => re.test(i.name) && !/ore|ingot|sword|pick|axe|shovel|hoe/.test(i.name));
    if (it) return it;
  }
  return null;
}

export async function placeAt(bot, against, faceVec) {
  if (!bot?.entity || !against || bot._digLocked) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    await bot.lookAt(
      against.position.offset(0.5 + faceVec.x * 0.5, 0.5 + faceVec.y * 0.5, 0.5 + faceVec.z * 0.5),
      true
    );
    await race(bot.placeBlock(against, faceVec), 2000);
    return true;
  } catch {
    return false;
  }
}

export async function placeUnderFeet(bot) {
  if (!bot?.entity || bot._digLocked) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    const against = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!against || isAirName(against.name)) return false;
    bot.setControlState('sneak', true);
    bot.setControlState('jump', true);
    await sleep(60);
    await bot.lookAt(against.position.offset(0.5, 1, 0.5), true);
    await race(bot.placeBlock(against, new Vec3(0, 1, 0)), 1500);
    bot.clearControlStates();
    return true;
  } catch {
    try {
      bot.clearControlStates();
    } catch {}
    return false;
  }
}

export async function placeFront(bot) {
  if (!bot?.entity || bot._digLocked) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  const yaw = bot.entity.yaw;
  const fx = Math.round(-Math.sin(yaw));
  const fz = Math.round(-Math.cos(yaw));
  const feet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  try {
    await bot.equip(item, 'hand');
    bot.setControlState('sneak', true);
    await sleep(40);
    if (feet && !isAirName(feet.name)) {
      await bot.lookAt(feet.position.offset(0.5 + fx * 0.5, 1, 0.5 + fz * 0.5), true);
      await race(bot.placeBlock(feet, new Vec3(fx, 0, fz)), 1500);
      bot.clearControlStates();
      return true;
    }
    bot.clearControlStates();
    return false;
  } catch {
    try {
      bot.clearControlStates();
    } catch {}
    return false;
  }
}

export async function bridgeForward(bot, steps = 3) {
  if (bot._digLocked) return false;
  let ok = 0;
  for (let i = 0; i < steps; i++) {
    if (await placeFront(bot)) ok++;
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await sleep(180);
    bot.clearControlStates();
  }
  return ok > 0;
}

export async function collectNearby(bot, names, maxDist = 32) {
  if (!bot?.entity || bot._digLocked) return false;
  const set = new Set(Array.isArray(names) ? names : [names]);
  const block = bot.findBlock({
    matching: (b) => b && set.has(b.name),
    maxDistance: maxDist,
  });
  if (!block) return false;

  try {
    if (bot.collectBlock?.collect) {
      await race(bot.collectBlock.collect(block, { ignoreNoPath: true }), 25000);
      return true;
    }
  } catch {}

  // fast approach + dig
  const dist = bot.entity.position.distanceTo(block.position);
  if (dist > 4) {
    try {
      await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(Math.min(1200, dist * 120));
      bot.clearControlStates();
    } catch {}
  }
  const live = bot.blockAt(block.position);
  if (live && !isAirName(live.name)) return digBlock(bot, live);
  return true;
}
