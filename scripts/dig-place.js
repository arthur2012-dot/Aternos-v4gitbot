/**
 * Reliable dig + place for mineflayer
 * - Equip correct tool
 * - Look at block center
 * - Valid place faces only
 * - Short timeouts, retry once
 */
import { Vec3 } from 'vec3';

const FACES = [
  new Vec3(0, -1, 0),
  new Vec3(0, 1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function withTimeout(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function pickTool(bot, block) {
  const items = bot.inventory.items();
  const n = block?.name || '';
  if (/_log$|planks|wood|leaves|bamboo|pumpkin|melon/.test(n)) {
    return items.find(i => /netherite_axe|diamond_axe|iron_axe|stone_axe|golden_axe|wooden_axe/.test(i.name));
  }
  if (/dirt|grass|sand|gravel|clay|mud|snow|soul_sand/.test(n)) {
    return items.find(i => /netherite_shovel|diamond_shovel|iron_shovel|stone_shovel|golden_shovel|wooden_shovel/.test(i.name));
  }
  if (/stone|cobble|ore|deepslate|netherrack|blackstone|basalt|obsidian|tuff|andesite|diorite|granite/.test(n)) {
    return items.find(i => /netherite_pickaxe|diamond_pickaxe|iron_pickaxe|stone_pickaxe|golden_pickaxe|wooden_pickaxe/.test(i.name));
  }
  // generic: any tool in hand order pickaxe > axe > shovel
  return (
    items.find(i => /_pickaxe$/.test(i.name)) ||
    items.find(i => /_axe$/.test(i.name)) ||
    items.find(i => /_shovel$/.test(i.name))
  );
}

export async function digBlock(bot, block) {
  if (!bot?.entity || !block) return false;
  if (block.boundingBox !== 'block' && block.name !== 'water') {
    // still try if hard block
  }
  if (/bedrock|barrier|command_block|end_portal|reinforced/.test(block.name || '')) return false;

  const dist = bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5));
  if (dist > 5.5) return false;

  try {
    const tool = pickTool(bot, block);
    if (tool) {
      try {
        await withTimeout(bot.equip(tool, 'hand'), 2000);
      } catch {}
    }

    // center of block
    const look = block.position.offset(0.5, 0.5, 0.5);
    try {
      await bot.lookAt(look, true);
    } catch {}

    // stop pathfinder so dig is not cancelled
    try {
      bot.pathfinder?.setGoal?.(null);
    } catch {}

    await withTimeout(bot.dig(block, true), 7000);
    return true;
  } catch (e) {
    try { bot.stopDigging(); } catch {}
    // one retry without forceLook race
    try {
      await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
      await withTimeout(bot.dig(block), 5000);
      return true;
    } catch {
      try { bot.stopDigging(); } catch {}
      return false;
    }
  }
}

function scaffoldItem(bot) {
  const order = [
    /cobblestone/,
    /dirt/,
    /grass_block/,
    /_planks$/,
    /stone$/,
    /netherrack/,
    /andesite|diorite|granite/,
    /cobbled_deepslate|tuff/,
    /sand|gravel/,
  ];
  const items = bot.inventory.items();
  for (const re of order) {
    const it = items.find(i => re.test(i.name));
    if (it) return it;
  }
  return null;
}

/**
 * Place a block against a solid reference on a free face.
 * targetPos = world position where we want the new block (block coords).
 */
export async function placeAt(bot, targetPos) {
  if (!bot?.entity) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;

  const tx = Math.floor(targetPos.x);
  const ty = Math.floor(targetPos.y);
  const tz = Math.floor(targetPos.z);

  // already solid?
  const existing = bot.blockAt(new Vec3(tx, ty, tz));
  if (existing && existing.boundingBox === 'block') return true;

  try {
    await withTimeout(bot.equip(item, 'hand'), 2000);
  } catch {
    return false;
  }

  // find solid neighbor + opposite face
  for (const face of FACES) {
    const refPos = new Vec3(tx - face.x, ty - face.y, tz - face.z);
    const ref = bot.blockAt(refPos);
    if (!ref || ref.boundingBox !== 'block') continue;
    if (/air|water|lava|fire/.test(ref.name)) continue;

    try {
      // look at face center
      const look = ref.position.offset(
        0.5 + face.x * 0.5,
        0.5 + face.y * 0.5,
        0.5 + face.z * 0.5
      );
      await bot.lookAt(look, true);
      await withTimeout(bot.placeBlock(ref, face), 2000);
      return true;
    } catch {
      // try next face
    }
  }
  return false;
}

/** Place under feet while jumping (MLG / tower) */
export async function placeUnderFeet(bot) {
  if (!bot?.entity) return false;
  const item = scaffoldItem(bot);
  if (!item) return false;

  try {
    await withTimeout(bot.equip(item, 'hand'), 1500);
  } catch {
    return false;
  }

  const feet = bot.entity.position.floored();
  // block we stand on
  const below = bot.blockAt(feet.offset(0, -1, 0));
  if (!below) return false;

  try {
    bot.setControlState('sneak', true);
    bot.setControlState('jump', true);
    await sleep(50);
    // place on top of below → under us after jump
    await bot.lookAt(below.position.offset(0.5, 1, 0.5), true);
    await withTimeout(bot.placeBlock(below, new Vec3(0, 1, 0)), 1800);
    bot.clearControlStates();
    return true;
  } catch {
    bot.clearControlStates();
    // fallback placeAt under feet
    return placeAt(bot, feet.offset(0, -1, 0));
  }
}

/** Place one block in front of feet (bridge) */
export async function placeFront(bot) {
  if (!bot?.entity) return false;
  const yaw = bot.entity.yaw;
  const fx = Math.round(-Math.sin(yaw));
  const fz = Math.round(-Math.cos(yaw));
  const feet = bot.entity.position.floored();
  const target = feet.offset(fx, -1, fz);
  return placeAt(bot, target);
}

export async function digFrontWall(bot) {
  if (!bot?.entity) return false;
  const yaw = bot.entity.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const pos = bot.entity.position;
  const head = bot.blockAt(pos.offset(fx, 1, fz));
  const body = bot.blockAt(pos.offset(fx, 0, fz));
  if (head && (await digBlock(bot, head))) return true;
  if (body && (await digBlock(bot, body))) return true;
  return false;
}

export { scaffoldItem, pickTool };
