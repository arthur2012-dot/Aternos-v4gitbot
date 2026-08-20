/**
 * DIG + PLACE — continuous HOLD dig with GLOBAL dig lock.
 * bot._digLocked prevents ALL other systems from turning the head.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function race(p, ms) {
  let t;
  try {
    return await Promise.race([p, new Promise((_, j) => { t = setTimeout(() => j(new Error('timeout')), ms); })]);
  } finally { if (t) clearTimeout(t); }
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
  let best = null;
  let bestTime = Infinity;
  for (const tool of inv) {
    try {
      const t = block.digTime(tool.type, false, false, false, [], bot.entity?.effects);
      if (t < bestTime) { bestTime = t; best = tool; }
    } catch {
      const n = block.name || '';
      if (/_log$|planks|leaves|bamboo/.test(n) && /_axe$/.test(tool.name)) best = best || tool;
      else if (/dirt|sand|gravel|grass|clay|mud|snow/.test(n) && /_shovel$/.test(tool.name)) best = best || tool;
      else if (/_pickaxe$/.test(tool.name)) best = best || tool;
    }
  }
  return best;
}

export async function equipBestTool(bot, block) {
  if (!bot || !block) return false;
  try {
    if (bot.tool?.equipForBlock) {
      await bot.tool.equipForBlock(block, { requireHarvest: false });
      return true;
    }
  } catch {}
  const tool = bestToolFor(bot, block);
  if (tool) {
    try { await bot.equip(tool, 'hand'); return true; } catch {}
  }
  return false;
}

/** Continuous dig until block is gone. Sets global dig lock. */
export async function digBlock(bot, block, opts = {}) {
  if (!bot?.entity || !block) return false;
  if (isUnbreakable(block.name)) return false;
  const maxMs = opts.maxMs || 18000;
  const retries = opts.retries ?? 4;
  const pos = block.position.clone();
  const center = pos.offset(0.5, 0.5, 0.5);

  bot._digLocked = true;
  bot._digLockPos = pos.clone();
  bot._digLockUntil = Date.now() + maxMs + 3000;

  try {
    try { bot.pathfinder?.setGoal?.(null); } catch {}
    try { bot.pathfinder?.stop?.(); } catch {}
    try { bot.ashfinder?.stop?.(); } catch {}
    try { bot.clearControlStates(); } catch {}

    await equipBestTool(bot, block);

    for (let attempt = 0; attempt < retries; attempt++) {
      const live = bot.blockAt(pos);
      if (!live || isAirName(live.name) || live.type === 0) return true;
      if (isUnbreakable(live.name)) return false;

      try { await bot.lookAt(center, true); } catch {}

      const lookIv = setInterval(() => {
        try {
          if (!bot.entity) return;
          bot.lookAt(center, true).catch(() => {});
        } catch {}
      }, 180);

      try {
        await race(bot.dig(live, true), maxMs);
      } catch {
        try { bot.stopDigging(); } catch {}
        await sleep(100);
      } finally {
        clearInterval(lookIv);
      }

      try { await bot.lookAt(center, true); } catch {}

      const after = bot.blockAt(pos);
      if (!after || isAirName(after.name) || after.type === 0) return true;
      await sleep(80);
    }
    return false;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  } finally {
    bot._digLocked = false;
    bot._digLockPos = null;
    bot._digLockUntil = 0;
  }
}

export async function digFrontWall(bot) {
  if (!bot?.entity) return false;
  if (bot._digLocked) return false;
  const yaw = bot.entity.yaw;
  const fx = Math.round(-Math.sin(yaw));
  const fz = Math.round(-Math.cos(yaw));
  const eye = bot.entity.position.offset(0, bot.entity.height * 0.85, 0);
  const targets = [
    bot.blockAt(eye.offset(fx, 0, fz)),
    bot.blockAt(eye.offset(fx, -1, fz)),
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
  const pref = [/dirt/, /cobblestone/, /netherrack/, /planks/, /stone$/, /andesite/, /granite/, /diorite/, /tuff/];
  const inv = bot.inventory.items();
  for (const re of pref) {
    const it = inv.find(i => re.test(i.name) && !/ore|ingot|sword|pick|axe|shovel|hoe/.test(i.name));
    if (it) return it;
  }
  return null;
}

export async function placeAt(bot, against, faceVec) {
  if (!bot?.entity || !against) return false;
  if (bot._digLocked) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    await bot.lookAt(against.position.offset(0.5 + faceVec.x * 0.5, 0.5 + faceVec.y * 0.5, 0.5 + faceVec.z * 0.5), true);
    await race(bot.placeBlock(against, faceVec), 2500);
    return true;
  } catch { return false; }
}

export async function placeUnderFeet(bot) {
  if (!bot?.entity) return false;
  if (bot._digLocked) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    const yaw = bot.entity.yaw;
    const fx = Math.round(-Math.sin(yaw));
    const fz = Math.round(-Math.cos(yaw));
    const candidates = [
      bot.blockAt(bot.entity.position.offset(0, -2, 0)),
      bot.blockAt(bot.entity.position.offset(fx, -1, fz)),
      bot.blockAt(bot.entity.position.offset(-fx, -1, -fz)),
      bot.blockAt(bot.entity.position.offset(0, -1, 0)),
    ].filter(Boolean);
    bot.setControlState('sneak', true);
    bot.setControlState('jump', true);
    await sleep(80);
    for (const against of candidates) {
      if (!against || isAirName(against.name) || against.name === 'water' || against.name === 'lava') continue;
      try {
        await bot.lookAt(against.position.offset(0.5, 1, 0.5), true);
        await race(bot.placeBlock(against, new Vec3(0, 1, 0)), 2000);
        bot.clearControlStates();
        return true;
      } catch {}
    }
    bot.clearControlStates();
    return false;
  } catch {
    try { bot.clearControlStates(); } catch {}
    return false;
  }
}

export async function placeFront(bot) {
  if (!bot?.entity) return false;
  if (bot._digLocked) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  const yaw = bot.entity.yaw;
  const fx = Math.round(-Math.sin(yaw));
  const fz = Math.round(-Math.cos(yaw));
  const feet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  try {
    await bot.equip(item, 'hand');
    bot.setControlState('sneak', true);
    await sleep(50);
    if (feet && !isAirName(feet.name) && feet.name !== 'water') {
      await bot.lookAt(feet.position.offset(0.5 + fx * 0.5, 1, 0.5 + fz * 0.5), true);
      await race(bot.placeBlock(feet, new Vec3(fx, 0, fz)), 2000);
      bot.clearControlStates();
      return true;
    }
    bot.clearControlStates();
    return false;
  } catch {
    try { bot.clearControlStates(); } catch {}
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
    await sleep(200);
    bot.clearControlStates();
    await sleep(60);
  }
  if (ok) console.log('[PLACE] bridge', ok);
  return ok > 0;
}

export async function collectNearby(bot, names, maxDist = 32) {
  if (!bot?.entity) return false;
  if (bot._digLocked) return false;
  const set = new Set(Array.isArray(names) ? names : [names]);
  const block = bot.findBlock({
    matching: (b) => b && set.has(b.name),
    maxDistance: maxDist,
  });
  if (!block) return false;

  try {
    if (bot.collectBlock?.collect) {
      await race(bot.collectBlock.collect(block, { ignoreNoPath: true }), 45000);
      console.log('[DIG] collectBlock', block.name);
      return true;
    }
  } catch (e) {
    console.warn('[DIG] collectBlock fail', (e.message || '').slice(0, 40));
  }

  try {
    if (typeof bot.dreamGoto === 'function') {
      await bot.dreamGoto(block.position.x, block.position.y, block.position.z, 2);
    } else if (bot.pathfinder) {
      const { goals } = require('mineflayer-pathfinder');
      await race(bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2)), 25000);
    }
  } catch {}

  const live = bot.blockAt(block.position);
  if (live && !isAirName(live.name)) await digBlock(bot, live);

  try {
    const drops = Object.values(bot.entities).filter(e =>
      e.name === 'item' && e.position.distanceTo(bot.entity.position) < 8
    );
    for (const d of drops.slice(0, 5)) {
      try {
        if (typeof bot.dreamGoto === 'function') await bot.dreamGoto(d.position.x, d.position.y, d.position.z, 1);
      } catch {}
    }
  } catch {}
  return true;
}
