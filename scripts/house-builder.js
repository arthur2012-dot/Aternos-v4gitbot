/**
 * House builder — safe site pick + clean 5x5 cabin with interior.
 * Passive: builds once when materials are ready, remembers home.
 */
import { createRequire } from 'module';
import pathfinder from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);
const { goals } = pathfinder;
const Vec3 = require('vec3').Vec3;

const BUILD = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|blackstone/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function items(bot) {
  return bot.inventory.items();
}

function countRe(bot, re) {
  return items(bot).filter((i) => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

function has(bot, name) {
  return items(bot).some((i) => i.name === name);
}

async function gotoNear(bot, x, y, z, r = 2) {
  try {
    if (typeof bot.dreamGoto === 'function') return await bot.dreamGoto(x, y, z, r);
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, r));
    return true;
  } catch {
    return false;
  }
}

async function equipBuild(bot) {
  const pref = [
    (i) => /_planks$/.test(i.name),
    (i) => i.name === 'cobblestone' || i.name === 'stone',
    (i) => BUILD.test(i.name),
  ];
  for (const fn of pref) {
    const it = items(bot).find(fn);
    if (it && it.count > 0) {
      try {
        await bot.equip(it, 'hand');
        return it;
      } catch {}
    }
  }
  return null;
}

function isAir(b) {
  return !b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air';
}

function isSolid(b) {
  return b && b.boundingBox === 'block' && !/water|lava|leaves|log/.test(b.name || '');
}

function isWater(b) {
  return b && /water|lava/.test(b.name || '');
}

function scoreSite(bot, ox, oy, oz) {
  let score = 0;
  let solidFloor = 0;
  let airAbove = 0;
  let water = 0;
  const originY = bot.entity.position.y;

  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      const floor = bot.blockAt(new Vec3(ox + x, oy, oz + z));
      const above = bot.blockAt(new Vec3(ox + x, oy + 1, oz + z));
      const below = bot.blockAt(new Vec3(ox + x, oy - 1, oz + z));

      if (isWater(floor) || isWater(above) || isWater(below)) water++;
      if (isSolid(floor)) solidFloor++;
      if (isAir(above)) airAbove++;

      const sky = bot.blockAt(new Vec3(ox + x, oy + 8, oz + z));
      if (isAir(sky)) score += 1;
    }
  }

  if (water > 0) return -1000;
  if (solidFloor < 20) return -500;
  if (airAbove < 15) return -200;

  score += solidFloor * 3;
  score += airAbove;
  const sample = bot.blockAt(new Vec3(ox + 2, oy, oz + 2));
  if (sample && /grass|dirt|stone|sand/.test(sample.name || '')) score += 15;
  if (oy < 50) score -= 20;
  if (oy > 90) score -= 10;
  const d = bot.entity.position.distanceTo(new Vec3(ox + 2, oy, oz + 2));
  score -= d * 0.5;
  return score;
}

function findHouseSite(bot, radius = 24) {
  const origin = bot.entity.position.floored();
  let best = null;
  let bestScore = -999;

  for (let dx = -radius; dx <= radius; dx += 2) {
    for (let dz = -radius; dz <= radius; dz += 2) {
      for (let dy = -3; dy <= 4; dy++) {
        const ox = origin.x + dx;
        const oy = origin.y + dy - 1;
        const oz = origin.z + dz;
        const sc = scoreSite(bot, ox, oy, oz);
        if (sc > bestScore) {
          bestScore = sc;
          best = { x: ox, y: oy, z: oz, score: sc };
        }
      }
    }
  }
  if (!best || best.score < 10) return null;
  return best;
}

async function placeAt(bot, x, y, z) {
  const target = new Vec3(x, y, z);
  const existing = bot.blockAt(target);
  if (existing && existing.boundingBox === 'block') return true;

  const build = await equipBuild(bot);
  if (!build) return false;

  const faces = [
    [0, -1, 0],
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (const [fx, fy, fz] of faces) {
    const ref = bot.blockAt(target.offset(fx, fy, fz));
    if (!ref || ref.boundingBox !== 'block') continue;
    if (/water|lava|air/.test(ref.name || '')) continue;
    try {
      const d = bot.entity.position.distanceTo(target);
      if (d > 3.8) await gotoNear(bot, x, y, z, 2);
      await bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
      await bot.placeBlock(ref, new Vec3(-fx, -fy, -fz));
      await sleep(80);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function buildCabin(bot, site) {
  const { x: ox, y: oy, z: oz } = site;
  console.log('[HOUSE] building cabin at', ox, oy, oz, 'score=' + site.score);

  const mats = countRe(bot, BUILD);
  if (mats < 40) {
    console.log('[HOUSE] not enough blocks', mats);
    return false;
  }

  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      await placeAt(bot, ox + x, oy, oz + z);
    }
  }

  for (let h = 1; h <= 3; h++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        const edge = x === 0 || x === 4 || z === 0 || z === 4;
        if (!edge) continue;
        if (z === 4 && x === 2 && (h === 1 || h === 2)) continue;
        if (h === 2 && ((x === 0 || x === 4) && z === 2)) continue;
        if (h === 2 && (z === 0 && x === 2)) continue;
        await placeAt(bot, ox + x, oy + h, oz + z);
      }
    }
  }

  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      await placeAt(bot, ox + x, oy + 4, oz + z);
    }
  }

  await gotoNear(bot, ox + 2, oy + 1, oz + 2, 1);
  await sleep(300);
  await placeFurniture(bot, ox, oy, oz);
  await placeTorches(bot, ox, oy, oz);

  bot._dreamHome = {
    x: ox + 2,
    y: oy + 1,
    z: oz + 2,
    floorY: oy,
    builtAt: Date.now(),
  };
  console.log('[HOUSE] done — home set', bot._dreamHome);
  return true;
}

async function placeFurniture(bot, ox, oy, oz) {
  if (has(bot, 'crafting_table')) {
    try {
      const item = items(bot).find((i) => i.name === 'crafting_table');
      await bot.equip(item, 'hand');
      const ref = bot.blockAt(new Vec3(ox + 1, oy, oz + 1));
      if (ref && ref.boundingBox === 'block') {
        await bot.lookAt(ref.position.offset(0.5, 1.2, 0.5), true);
        await bot.placeBlock(ref, new Vec3(0, 1, 0));
        console.log('[HOUSE] crafting_table placed');
        await sleep(200);
      }
    } catch (e) {
      console.warn('[HOUSE] table', (e.message || '').slice(0, 40));
    }
  }

  if (has(bot, 'furnace')) {
    try {
      const item = items(bot).find((i) => i.name === 'furnace');
      await bot.equip(item, 'hand');
      const ref = bot.blockAt(new Vec3(ox + 3, oy, oz + 1));
      if (ref && ref.boundingBox === 'block') {
        await bot.lookAt(ref.position.offset(0.5, 1.2, 0.5), true);
        await bot.placeBlock(ref, new Vec3(0, 1, 0));
        console.log('[HOUSE] furnace placed');
        await sleep(200);
      }
    } catch (e) {
      console.warn('[HOUSE] furnace', (e.message || '').slice(0, 40));
    }
  }

  if (has(bot, 'chest')) {
    try {
      const item = items(bot).find((i) => i.name === 'chest');
      await bot.equip(item, 'hand');
      const ref = bot.blockAt(new Vec3(ox + 1, oy, oz + 3));
      if (ref && ref.boundingBox === 'block') {
        await bot.lookAt(ref.position.offset(0.5, 1.2, 0.5), true);
        await bot.placeBlock(ref, new Vec3(0, 1, 0));
        console.log('[HOUSE] chest placed');
        await sleep(200);
      }
    } catch (e) {
      console.warn('[HOUSE] chest', (e.message || '').slice(0, 40));
    }
  }

  const bed = items(bot).find((i) => /_bed$|^bed$/.test(i.name));
  if (bed) {
    try {
      await bot.equip(bed, 'hand');
      const ref = bot.blockAt(new Vec3(ox + 3, oy, oz + 3));
      if (ref && ref.boundingBox === 'block') {
        await bot.lookAt(ref.position.offset(0.5, 1.2, 0.5), true);
        await bot.placeBlock(ref, new Vec3(0, 1, 0));
        console.log('[HOUSE] bed placed');
        await sleep(200);
      }
    } catch (e) {
      console.warn('[HOUSE] bed', (e.message || '').slice(0, 40));
    }
  }
}

async function placeTorches(bot, ox, oy, oz) {
  if (!has(bot, 'torch')) return;
  const spots = [
    [ox + 1, oy + 2, oz + 1],
    [ox + 3, oy + 2, oz + 1],
    [ox + 1, oy + 2, oz + 3],
    [ox + 3, oy + 2, oz + 3],
  ];
  for (const [x, y, z] of spots) {
    if (!has(bot, 'torch')) break;
    try {
      const torch = items(bot).find((i) => i.name === 'torch');
      await bot.equip(torch, 'hand');
      const wall = bot.blockAt(new Vec3(x, y, z - 1));
      const floor = bot.blockAt(new Vec3(x, y - 1, z));
      const ref = wall && wall.boundingBox === 'block' && wall.name !== 'torch' ? wall : floor;
      if (!ref || ref.boundingBox !== 'block') continue;
      const face = ref === wall ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0);
      await bot.lookAt(ref.position.offset(0.5, 0.8, 0.5), true);
      await bot.placeBlock(ref, face);
      await sleep(150);
    } catch {}
  }
  console.log('[HOUSE] torches done');
}

export async function maybeBuildHouse(bot, opts = {}) {
  if (!bot?.entity || bot._dreamPvpActive) return false;
  if (bot._dreamHomeBuilding) return false;

  if (bot._dreamHome && bot._dreamHome.x != null) {
    const home = bot._dreamHome;
    const d = bot.entity.position.distanceTo(new Vec3(home.x, home.y, home.z));
    const invFull = bot.inventory.emptySlotCount() < 3;
    if (invFull && d > 40) {
      console.log('[HOUSE] return home (inventory full)');
      await gotoNear(bot, home.x, home.y, home.z, 2);
      return true;
    }
    return false;
  }

  const mats = countRe(bot, BUILD);
  const planks = countRe(bot, /_planks$/);
  if (mats < 45 && planks < 30) return false;

  try {
    const hostile = bot.nearestEntity(
      (e) =>
        e &&
        e.type === 'mob' &&
        /zombie|skeleton|creeper|spider|enderman|witch/.test(String(e.name || '')) &&
        e.position.distanceTo(bot.entity.position) < 16
    );
    if (hostile) return false;
  } catch {}

  const site = findHouseSite(bot, opts.radius || 20);
  if (!site) {
    console.log('[HOUSE] no good site nearby');
    return false;
  }

  bot._dreamHomeBuilding = true;
  try {
    await gotoNear(bot, site.x + 2, site.y + 1, site.z + 2, 2);
    await buildCabin(bot, site);
    return true;
  } catch (e) {
    console.warn('[HOUSE]', (e.message || '').slice(0, 50));
    return false;
  } finally {
    bot._dreamHomeBuilding = false;
  }
}

export async function goHome(bot) {
  if (!bot?._dreamHome) return false;
  const h = bot._dreamHome;
  console.log('[HOUSE] going home');
  return await gotoNear(bot, h.x, h.y, h.z, 2);
}

export function startHouseBuilder() {
  console.log('[HOUSE] builder ready — 5x5 cabin + interior');
}
