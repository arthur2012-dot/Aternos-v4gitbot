/**
 * Real dig + place + bridge helpers used by passive / unstuck.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');

const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|sand/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function race(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, j) => {
        t = setTimeout(() => j(new Error('t')), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function scaffoldItem(bot) {
  try {
    return bot.inventory.items().find((i) => BUILD_RE.test(i.name));
  } catch {
    return null;
  }
}

export async function digBlock(bot, block) {
  if (!bot?.entity || !block) return false;
  if (/bedrock|barrier|command|end_portal|reinforced/.test(block.name || '')) return false;
  try {
    const items = bot.inventory.items();
    const n = block.name || '';
    let tool = null;
    if (/_log$|planks|leaves/.test(n)) tool = items.find((i) => /_axe$/.test(i.name));
    else if (/dirt|sand|gravel|grass|clay|mud|snow/.test(n))
      tool = items.find((i) => /_shovel$/.test(i.name));
    else tool = items.find((i) => /_pickaxe$/.test(i.name));
    if (tool) {
      try {
        await bot.equip(tool, 'hand');
      } catch {}
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block), 9000);
    return true;
  } catch {
    try {
      bot.stopDigging();
    } catch {}
    return false;
  }
}

export async function digFrontWall(bot) {
  try {
    const look = bot.blockAtCursor?.(3.5);
    if (look && look.boundingBox === 'block') {
      return digBlock(bot, look);
    }
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const p = bot.entity.position.floored();
    for (const oy of [0, 1]) {
      const b = bot.blockAt(p.offset(dx, oy, dz));
      if (b && b.boundingBox === 'block') return digBlock(bot, b);
    }
  } catch {}
  return false;
}

export async function placeUnderFeet(bot) {
  const item = scaffoldItem(bot);
  if (!item || !bot.entity) return false;
  try {
    await bot.equip(item, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref || ref.name === 'air' || ref.name === 'water' || ref.name === 'lava') {
      const yaw = bot.entity.yaw;
      const dx = Math.round(-Math.sin(yaw));
      const dz = Math.round(-Math.cos(yaw));
      const side = bot.blockAt(bot.entity.position.offset(dx, -1, dz));
      if (side && side.boundingBox === 'block') {
        await bot.lookAt(side.position.offset(0.5, 1, 0.5), true);
        bot.setControlState('sneak', true);
        await sleep(50);
        await race(bot.placeBlock(side, new Vec3(0, 1, 0)), 2000);
        bot.setControlState('sneak', false);
        return true;
      }
      return false;
    }
    await bot.lookAt(ref.position.offset(0.5, 1, 0.5), true);
    bot.setControlState('sneak', true);
    await sleep(40);
    await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 2000);
    bot.setControlState('sneak', false);
    return true;
  } catch {
    try {
      bot.setControlState('sneak', false);
    } catch {}
    return false;
  }
}

export async function placeFront(bot) {
  const item = scaffoldItem(bot);
  if (!item || !bot.entity) return false;
  try {
    await bot.equip(item, 'hand');
    const yaw = bot.entity.yaw;
    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    const feet = bot.entity.position.floored();
    const edge = bot.blockAt(feet.offset(0, -1, 0));
    if (!edge) return false;
    bot.setControlState('sneak', true);
    await sleep(60);
    await bot.lookAt(feet.offset(dx, 0, dz).offset(0.5, 0.5, 0.5), true);
    try {
      await race(bot.placeBlock(edge, new Vec3(dx, 0, dz)), 2500);
    } catch {
      try {
        await race(bot.placeBlock(edge, new Vec3(0, 1, 0)), 2000);
      } catch {}
    }
    bot.setControlState('sneak', false);
    return true;
  } catch {
    try {
      bot.setControlState('sneak', false);
    } catch {}
    return false;
  }
}

export async function bridgeForward(bot, steps = 3) {
  if (!bot?.entity) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;
  let placed = 0;
  for (let i = 0; i < steps; i++) {
    const ok = await placeFront(bot);
    if (!ok) break;
    placed++;
    bot.setControlState('forward', true);
    await sleep(180);
    bot.clearControlStates();
  }
  if (placed > 0) console.log('[PLACE] bridge', placed);
  return placed > 0;
}

export async function placeAt() {
  return false;
}
