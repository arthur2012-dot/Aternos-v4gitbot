/**
 * Dig + Place + Pillar (human timing) — pure code, Mindcraft-compatible.
 * Jump → mid-air place under feet → optional dig above head.
 * Never yaw-spin while digging.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|cobbled/;
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
  try {
    const items = bot.inventory.items();
    const n = block.name || '';
    let tool = null;
    if (/_log$|planks|leaves/.test(n)) tool = items.find((i) => /_axe$/.test(i.name));
    else if (/dirt|sand|gravel|grass|clay|mud|snow/.test(n)) tool = items.find((i) => /_shovel$/.test(i.name));
    else tool = items.find((i) => /_pickaxe$/.test(i.name));
    if (tool) {
      try {
        await bot.equip(tool, 'hand');
      } catch {}
    }
    // ONE look only — never change yaw while digging
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block, true), 9000); // forceLook=true keeps head locked
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
 * Human pillar jump:
 * 1. Look straight down
 * 2. Jump
 * 3. While airborne (y velocity > 0 or not onGround), place block under feet FAST
 * 4. Land, repeat
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

  // Look straight down once
  try {
    await bot.look(bot.entity.yaw, Math.PI / 2, true);
  } catch {}

  for (let i = 0; i < times; i++) {
    if (!bot.entity) break;
    // Jump
    bot.setControlState('jump', true);
    await sleep(40); // ~2 ticks — become airborne
    bot.setControlState('jump', false);

    // Wait until we are clearly above the block we stand on
    const startY = bot.entity.position.y;
    let placed = false;
    for (let t = 0; t < 8; t++) {
      await sleep(25);
      if (!bot.entity) break;
      // Place when feet are high enough (human mid-air window)
      if (bot.entity.position.y > startY + 0.35 || !bot.entity.onGround) {
        const under = bot.blockAt(bot.entity.position.offset(0, -1, 0).floored());
        const ref =
          under && under.boundingBox === 'block'
            ? under
            : bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
        if (ref && ref.boundingBox === 'block') {
          try {
            // Prefer internal forceLook place (pathfinder-style)
            if (typeof bot._placeBlockWithOptions === 'function') {
              await race(
                bot._placeBlockWithOptions(ref, new Vec3(0, 1, 0), {
                  forceLook: true,
                  swingArm: 'right',
                }),
                800
              );
            } else {
              await race(bot.placeBlock(ref, new Vec3(0, 1, 0)), 800);
            }
            placed = true;
            break;
          } catch {}
        }
      }
    }
    // Land
    await sleep(180);
    if (!placed && i === 0) return false;
  }
  bot.clearControlStates();
  return true;
}

/**
 * Escape 1-high / tight hole like a player:
 * - Dig block above head (if solid)
 * - Dig face / walls if needed
 * - Pillar up with dirt (jump + mid-air place)
 * - Never random-yaw
 */
export async function escapeTight(bot) {
  if (!bot?.entity) return false;
  if (bot._digLocked || bot._dreamEscaping) return false;
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
    if (!tight && !headSolid) return false;

    console.log('[DIG] escapeTight walls=' + walls + ' head=' + (head?.name || 'air'));

    // 1) Dig ABOVE head first (priority — free vertical space)
    if (headSolid && !/bedrock|barrier/.test(head.name || '')) {
      await digBlock(bot, head);
    }
    if (above && above.boundingBox === 'block' && !/bedrock|barrier/.test(above.name || '')) {
      await digBlock(bot, above);
    }

    // 2) Dig face / adjacent walls (no turn — use current look + fixed offsets)
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
        if (dug >= 4) break;
      }
    }

    // 3) Pillar up 1–2 blocks (jump + mid-air place)
    const sc = scaffoldItem(bot);
    if (sc && sc.count > 0) {
      await pillarUp(bot, Math.min(2, sc.count));
    }

    // 4) Forward + single clean jump (no double-hop)
    bot.setControlState('forward', true);
    if (bot.entity.onGround) {
      bot.setControlState('jump', true);
      await sleep(100);
      bot.setControlState('jump', false);
    }
    await sleep(300);
    bot.clearControlStates();
    return true;
  } catch (e) {
    console.warn('[DIG] escape', (e.message || '').slice(0, 40));
    return false;
  } finally {
    bot._dreamEscaping = false;
    bot.clearControlStates();
  }
}

/** Place under feet (scaffold while standing) — used by pathfinder helpers */
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
export { scaffoldItem };
