/**
 * Dig + Place + Pillar (human timing) — pure code, Mindcraft-compatible.
 * Jump → mid-air place under feet → dig above head.
 * Never yaw-spin while digging.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|cobbled|grass_block/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scaffoldItem(bot) {
  return bot.inventory.items().find((i) => BUILD_RE.test(i.name));
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

/** Hold dig (single look, no mid-dig turn) */
export async function digBlock(bot, block) {
  if (!bot?.entity || !block) return false;
  if (/bedrock|barrier|command|end_portal|reinforced/.test(block.name || '')) return false;
  if (bot._digLocked) return false;
  bot._digLocked = true;
  bot._digLockUntil = Date.now() + 10000;
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
    await race(bot.dig(block, true), 9000);
    return true;
  } catch {
    try {
      bot.stopDigging();
    } catch {}
    return false;
  } finally {
    bot._digLocked = false;
  }
}

/**
 * Human pillar:
 * look down → short jump → place under feet WHILE airborne → land
 * No double-hop, no random yaw.
 */
export async function pillarUp(bot, times = 1) {
  if (!bot?.entity) return false;
  const sc = scaffoldItem(bot);
  if (!sc || sc.count < 1) return false;
  try {
    await bot.equip(sc, 'hand');
  } catch {
    return false;
  }

  try {
    await bot.look(bot.entity.yaw, Math.PI / 2, true);
  } catch {}

  let anyOk = false;
  for (let i = 0; i < times; i++) {
    if (!bot.entity) break;

    // single short jump pulse
    bot.setControlState('jump', true);
    await sleep(50);
    bot.setControlState('jump', false);

    const startY = bot.entity.position.y;
    let placed = false;

    // mid-air window ~150-250ms after jump start
    for (let t = 0; t < 10; t++) {
      await sleep(20);
      if (!bot.entity) break;
      const risen = bot.entity.position.y > startY + 0.25;
      const airborne = !bot.entity.onGround;
      if (!risen && !airborne) continue;

      const feet = bot.entity.position.floored();
      let ref = bot.blockAt(feet.offset(0, -1, 0));
      if (!ref || ref.boundingBox !== 'block') {
        ref = bot.blockAt(feet.offset(0, -2, 0));
      }
      if (!ref || ref.boundingBox !== 'block') continue;

      try {
        if (typeof bot._placeBlockWithOptions === 'function') {
          await race(
            bot._placeBlockWithOptions(ref, new Vec3(0, 1, 0), {
              forceLook: true,
              swingArm: 'right',
            }),
            600
          );
        } else {
          await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 600);
        }
        placed = true;
        anyOk = true;
        break;
      } catch {
        try {
          bot.activateItem();
          await sleep(50);
        } catch {}
      }
    }

    await sleep(150);
    if (!placed && i === 0) break;
  }
  bot.clearControlStates();
  return anyOk;
}

/**
 * Escape tight 1x1 / hole:
 * dig head → dig above → dig walls → pillar → step forward
 */
export async function escapeTight(bot) {
  if (!bot?.entity) return false;
  if (bot._dreamEscaping) return false;
  bot._dreamEscaping = true;
  try {
    const p = bot.entity.position.floored();
    const head = bot.blockAt(p.offset(0, 1, 0));
    const above = bot.blockAt(p.offset(0, 2, 0));
    let walls = 0;
    for (const o of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const b = bot.blockAt(p.offset(o[0], 0, o[1]));
      if (b && b.boundingBox === 'block') walls++;
    }
    const headSolid = head && head.boundingBox === 'block';
    const tight = walls >= 2 || headSolid;
    if (!tight && bot.entity.position.y >= 62) return false;

    console.log('[DIG] escapeTight walls=' + walls + ' head=' + (head?.name || 'air') + ' y=' + bot.entity.position.y.toFixed(0));

    if (headSolid && !/bedrock|barrier/.test(head.name || '')) {
      await digBlock(bot, head);
    }
    if (above && above.boundingBox === 'block' && !/bedrock|barrier/.test(above.name || '')) {
      await digBlock(bot, above);
    }

    const cells = [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, 1, 0],
      [-1, 1, 0],
      [0, 1, 1],
      [0, 1, -1],
    ];
    let dug = 0;
    for (const [ox, oy, oz] of cells) {
      const b = bot.blockAt(p.offset(ox, oy, oz));
      if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name || '')) {
        if (await digBlock(bot, b)) dug++;
        if (dug >= 3) break;
      }
    }

    const sc = scaffoldItem(bot);
    if (sc && sc.count > 0) {
      await pillarUp(bot, Math.min(2, sc.count));
    }

    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    if (bot.entity.onGround) {
      bot.setControlState('jump', true);
      await sleep(80);
      bot.setControlState('jump', false);
    }
    await sleep(350);
    bot.clearControlStates();
    return true;
  } catch (e) {
    console.warn('[DIG] escape', (e.message || '').slice(0, 40));
    return false;
  } finally {
    bot._dreamEscaping = false;
    try {
      bot.clearControlStates();
    } catch {}
  }
}

export async function placeUnderFeet(bot) {
  if (!bot?.entity) return false;
  const sc = scaffoldItem(bot);
  if (!sc) return false;
  try {
    await bot.equip(sc, 'hand');
    await bot.look(bot.entity.yaw, Math.PI / 2, true);
    const ref = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
    if (!ref || ref.boundingBox !== 'block') return false;
    if (typeof bot._placeBlockWithOptions === 'function') {
      await race(
        bot._placeBlockWithOptions(ref, new Vec3(0, 1, 0), { forceLook: true, swingArm: 'right' }),
        1200
      );
    } else {
      await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 1200);
    }
    return true;
  } catch {
    return false;
  }
}

export async function placeAt() {
  return false;
}
export async function placeFront() {
  return false;
}
export async function digFrontWall() {
  return false;
}
export async function bridgeForward() {
  return false;
}
export async function collectNearby() {
  return false;
}
export { scaffoldItem };
