/**
 * Ordered dig (player-like) + water current + tight hole escape.
 * Never random spray — always: face → column up → one-direction staircase.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;
const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|gravel|sand/;

function items(bot) {
  return bot.inventory.items();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isWaterName(n) {
  return n === 'water' || n === 'flowing_water' || (n && n.includes('water'));
}

function isWet(bot) {
  try {
    if (bot.entity?.isInWater) return true;
    const under = bot.blockAt(bot.entity.position.offset(0, -0.2, 0));
    const feet = bot.blockAt(bot.entity.position);
    const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
    if (under && isWaterName(under.name)) return true;
    if (feet && isWaterName(feet.name)) return true;
    if (head && isWaterName(head.name)) return true;
  } catch {}
  return false;
}

function forwardXZ(bot) {
  const yaw = bot.entity.yaw;
  return {
    dx: Math.round(-Math.sin(yaw)),
    dz: Math.round(-Math.cos(yaw)),
  };
}

async function equipFor(bot, block) {
  const n = block?.name || '';
  const inv = items(bot);
  let tool =
    /_log$|planks|leaves|bamboo|melon|pumpkin/.test(n)
      ? inv.find((i) => /_axe$/.test(i.name))
      : /dirt|sand|gravel|grass|clay|mud|snow|soul_sand|farmland|podzol|mycelium|rooted/.test(n)
        ? inv.find((i) => /_shovel$/.test(i.name))
        : inv.find((i) => /_pickaxe$/.test(i.name));
  if (!tool) tool = inv.find((i) => /_shovel$|_pickaxe$|_axe$/.test(i.name));
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
    } catch {}
  }
}

async function digHold(bot, block, tries = 3) {
  if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
    return false;
  }
  if (/bedrock|barrier|command_block|structure|end_portal/.test(block.name || '')) {
    return false;
  }

  const targetPos = block.position.clone();

  for (let t = 0; t < tries; t++) {
    try {
      try { bot.clearControlStates(); } catch {}
      try { bot.pathfinder?.setGoal?.(null); } catch {}
      try { bot.stopDigging(); } catch {}
      await sleep(40);

      const live = bot.blockAt(targetPos);
      if (!live || live.name === 'air' || live.name === 'cave_air') return true;

      await equipFor(bot, live);
      await bot.lookAt(live.position.offset(0.5, 0.5, 0.5), true);
      await sleep(50);

      const hardness = live.hardness ?? 1;
      const timeoutMs = Math.min(20000, Math.max(4000, 3000 + hardness * 4000));

      await Promise.race([
        bot.dig(live, true),
        new Promise((_, rej) => setTimeout(() => rej(new Error('dig_timeout')), timeoutMs)),
      ]);

      await sleep(80);
      const after = bot.blockAt(targetPos);
      if (!after || after.name === 'air' || after.name === 'cave_air' || after.name !== live.name) {
        return true;
      }
      console.log('[PASSIVE] dig retry', live.name, 'try', t + 1);
    } catch {
      try { bot.stopDigging(); } catch {}
      const after = bot.blockAt(targetPos);
      if (!after || after.name === 'air' || after.name === 'cave_air') return true;
      await sleep(100);
    }
  }
  return false;
}

async function digAt(bot, ox, oy, oz) {
  const pos = bot.entity.position.floored();
  const b = bot.blockAt(pos.offset(ox, oy, oz));
  if (!b || b.boundingBox !== 'block') return false;
  if (/bedrock|barrier/.test(b.name || '')) return false;
  console.log('[PASSIVE] dig ordered', b.name, '@' + ox + ',' + oy + ',' + oz);
  return digHold(bot, b, 3);
}

async function dryFeet(bot) {
  try {
    if (!isWet(bot)) return false;
    const scaffold = items(bot).find((i) => BUILD_RE.test(i.name));
    if (!scaffold) return false;
    await bot.equip(scaffold, 'hand');
    bot.setControlState('jump', true);
    await sleep(200);
    const offsets = [
      [0, -2, 0], [0, -1, 0],
      [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
    ];
    for (const [ox, oy, oz] of offsets) {
      const base = bot.blockAt(bot.entity.position.offset(ox, oy, oz));
      if (!base || base.boundingBox !== 'block') continue;
      if (isWaterName(base.name) || /lava|air|cave_air/.test(base.name || '')) continue;
      try {
        await bot.placeBlock(base, new Vec3(0, 1, 0));
        console.log('[PASSIVE] dry feet solid');
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

async function escapeCurrent(bot) {
  if (!isWet(bot)) return false;

  console.log('[PASSIVE] escape CURRENT ordered');
  const { dx, dz } = forwardXZ(bot);
  let steps = 0;

  while (isWet(bot) && steps < 10) {
    steps++;

    for (let oy = 1; oy <= 4; oy++) {
      await digAt(bot, 0, oy, 0);
    }

    await digAt(bot, dx, 0, dz);
    await digAt(bot, dx, 1, dz);
    await digAt(bot, dx, 2, dz);

    await dryFeet(bot);

    try {
      await bot.look(bot.entity.yaw, -0.4, true);
    } catch {}
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await sleep(500);
    bot.clearControlStates();
  }

  bot.clearControlStates();
  await dryFeet(bot);

  if (isWet(bot)) {
    const scaffold = items(bot).find((i) => BUILD_RE.test(i.name));
    if (scaffold) {
      try {
        await bot.equip(scaffold, 'hand');
        for (let i = 0; i < 4; i++) {
          bot.setControlState('jump', true);
          await sleep(250);
          const base =
            bot.blockAt(bot.entity.position.offset(0, -2, 0)) ||
            bot.blockAt(bot.entity.position.offset(0, -1, 0));
          if (base && base.boundingBox === 'block' && !isWaterName(base.name)) {
            try {
              await bot.placeBlock(base, new Vec3(0, 1, 0));
              console.log('[PASSIVE] pillar from water');
            } catch {}
          }
        }
      } catch {}
      bot.clearControlStates();
    }
  }

  console.log('[PASSIVE] current done wet=' + isWet(bot) + ' steps=' + steps);
  return true;
}

async function escapeHole(bot) {
  try {
    if (isWet(bot)) {
      return await escapeCurrent(bot);
    }

    const pos = bot.entity.position.floored();
    const head = bot.blockAt(pos.offset(0, 1, 0));
    let walls = 0;
    for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = bot.blockAt(pos.offset(o[0], 0, o[1]));
      if (b && b.boundingBox === 'block') walls++;
    }
    const headSolid = head && head.boundingBox === 'block';
    if (walls < 2 && !headSolid) return false;

    const startPos = bot.entity.position.clone();
    const { dx, dz } = forwardXZ(bot);
    console.log('[PASSIVE] escape tight walls=' + walls + ' dir=' + dx + ',' + dz);

    try {
      const look = bot.blockAtCursor?.(4);
      if (look && look.boundingBox === 'block' && !/bedrock|barrier/.test(look.name || '')) {
        console.log('[PASSIVE] dig face ordered', look.name);
        await digHold(bot, look, 3);
      }
    } catch {}

    await digAt(bot, dx, 0, dz);
    await digAt(bot, dx, 1, dz);
    await digAt(bot, 0, 1, 0);
    await digAt(bot, 0, 2, 0);
    await digAt(bot, dx, 2, dz);

    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    await sleep(400);
    bot.clearControlStates();

    let stillWalls = 0;
    const p = bot.entity.position.floored();
    for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = bot.blockAt(p.offset(o[0], 0, o[1]));
      if (b && b.boundingBox === 'block') stillWalls++;
    }

    if (stillWalls >= 2) {
      await digAt(bot, dx, 0, dz);
      await digAt(bot, dx, 1, dz);
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await sleep(400);
      bot.clearControlStates();
    }

    const moved =
      Math.abs(bot.entity.position.x - startPos.x) +
      Math.abs(bot.entity.position.z - startPos.z) +
      Math.abs(bot.entity.position.y - startPos.y);

    if (moved < 0.35) {
      const scaffold = items(bot).find((i) => BUILD_RE.test(i.name));
      if (scaffold) {
        try {
          await bot.equip(scaffold, 'hand');
          for (let i = 0; i < 3; i++) {
            bot.setControlState('jump', true);
            await sleep(220);
            const base =
              bot.blockAt(bot.entity.position.offset(0, -2, 0)) ||
              bot.blockAt(bot.entity.position.offset(0, -1, 0));
            if (base && base.boundingBox === 'block' && !isWaterName(base.name)) {
              try {
                await bot.placeBlock(base, new Vec3(0, 1, 0));
                console.log('[PASSIVE] pillar up');
              } catch {}
            }
            await sleep(100);
          }
          bot.clearControlStates();
        } catch {
          bot.clearControlStates();
        }
      } else {
        bot.entity.yaw += Math.PI / 2;
        try {
          await bot.look(bot.entity.yaw, 0, true);
        } catch {}
        console.log('[PASSIVE] still stuck → rotate 90°');
      }
    } else {
      console.log('[PASSIVE] escaped moved=' + moved.toFixed(1));
    }
    return true;
  } catch (e) {
    console.warn('[PASSIVE] escape err', (e.message || '').slice(0, 40));
    return false;
  }
}

export { dryFeet, escapeHole, digHold, isWet, escapeCurrent };
