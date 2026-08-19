import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;
const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate/;

function items(bot) { return bot.inventory.items(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function race(p, ms) {
  let t;
  try {
    return await Promise.race([p, new Promise((_, j) => { t = setTimeout(() => j(new Error('t')), ms); })]);
  } finally { if (t) clearTimeout(t); }
}
async function dig(bot, block) {
  if (!block || block.name === 'air' || block.name === 'cave_air') return false;
  try {
    const n = block.name || '';
    const inv = items(bot);
    let tool =
      /_log$|planks|leaves|bamboo/.test(n) ? inv.find(i => /_axe$/.test(i.name)) :
      /dirt|sand|gravel|grass|clay|mud|snow|soul_sand/.test(n) ? inv.find(i => /_shovel$/.test(i.name)) :
      inv.find(i => /_pickaxe$/.test(i.name));
    if (tool) { try { await bot.equip(tool, 'hand'); } catch {} }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await race(bot.dig(block), 10000);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

async function dryFeet(bot) {
  try {
    const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    const feet = bot.blockAt(bot.entity.position);
    const wet =
      (under && /water/.test(under.name || '')) ||
      (feet && /water/.test(feet.name || '')) ||
      bot.entity.isInWater;
    if (!wet) return false;
    const scaffold = items(bot).find(i => BUILD_RE.test(i.name));
    if (!scaffold) return false;
    await bot.equip(scaffold, 'hand');
    bot.setControlState('jump', true);
    await sleep(180);
    const bases = [
      bot.blockAt(bot.entity.position.offset(0, -2, 0)),
      bot.blockAt(bot.entity.position.offset(1, -1, 0)),
      bot.blockAt(bot.entity.position.offset(-1, -1, 0)),
      bot.blockAt(bot.entity.position.offset(0, -1, 1)),
      bot.blockAt(bot.entity.position.offset(0, -1, -1)),
      bot.blockAt(bot.entity.position.offset(1, 0, 0)),
      bot.blockAt(bot.entity.position.offset(-1, 0, 0)),
      bot.blockAt(bot.entity.position.offset(0, 0, 1)),
      bot.blockAt(bot.entity.position.offset(0, 0, -1)),
    ];
    for (const base of bases) {
      if (!base || base.boundingBox !== 'block') continue;
      if (/water|lava|air|cave_air/.test(base.name || '')) continue;
      try {
        await race(bot.placeBlock(base, new Vec3(0, 1, 0)), 2500);
        console.log('[PASSIVE] dry feet — solid under');
        bot.clearControlStates();
        return true;
      } catch {
        try {
          await race(bot.placeBlock(base, new Vec3(1, 0, 0)), 1500);
          console.log('[PASSIVE] dry feet — side');
          bot.clearControlStates();
          return true;
        } catch {}
      }
    }
    bot.clearControlStates();
    return false;
  } catch {
    try { bot.clearControlStates(); } catch {}
    return false;
  }
}

async function escapeHole(bot) {
  try {
    const pos = bot.entity.position.floored();
    const head = bot.blockAt(pos.offset(0, 1, 0));
    let walls = 0;
    for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = bot.blockAt(pos.offset(o[0], 0, o[1]));
      if (b && b.boundingBox === 'block') walls++;
    }
    const headSolid = head && head.boundingBox === 'block';
    const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    const feetBlk = bot.blockAt(bot.entity.position);
    const wet =
      bot.entity.isInWater ||
      (under && /water/.test(under.name || '')) ||
      (feetBlk && /water/.test(feetBlk.name || ''));
    const tight = walls >= 2 || headSolid || wet;
    if (!tight) return false;

    const startPos = bot.entity.position.clone();
    console.log('[PASSIVE] escape tight walls=' + walls + (wet ? ' WET' : ''));

    const inv = items(bot);
    const shovel = inv.find(i => /shovel/.test(i.name));
    const pick = inv.find(i => /pickaxe/.test(i.name));
    const axe = inv.find(i => /_axe$/.test(i.name));
    if (shovel) { try { await bot.equip(shovel, 'hand'); } catch {} }
    else if (pick) { try { await bot.equip(pick, 'hand'); } catch {} }

    if (wet) await dryFeet(bot);

    try {
      const look = bot.blockAtCursor?.(4);
      if (look && look.boundingBox === 'block' && !/bedrock|barrier/.test(look.name || '')) {
        console.log('[PASSIVE] dig face', look.name);
        await dig(bot, look);
      }
    } catch {}

    const yaw = bot.entity.yaw;
    const dirs = [
      [Math.round(-Math.sin(yaw)), Math.round(-Math.cos(yaw))],
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [Math.round(-Math.sin(yaw + Math.PI / 2)), Math.round(-Math.cos(yaw + Math.PI / 2))],
    ];

    let dug = 0;
    for (const [fdx, fdz] of dirs) {
      for (const oy of [0, 1, 2]) {
        const b = bot.blockAt(pos.offset(fdx, oy, fdz));
        if (!b || b.boundingBox !== 'block') continue;
        if (/bedrock|barrier/.test(b.name || '')) continue;
        const n = b.name || '';
        if (/dirt|grass|sand|gravel|clay|mud/.test(n) && shovel) {
          try { await bot.equip(shovel, 'hand'); } catch {}
        } else if (/_log$|planks|leaves/.test(n) && axe) {
          try { await bot.equip(axe, 'hand'); } catch {}
        } else if (pick) {
          try { await bot.equip(pick, 'hand'); } catch {}
        }
        if (await dig(bot, b)) {
          dug++;
          console.log('[PASSIVE] dug', n, 'at', fdx, oy, fdz);
        }
        if (dug >= 6) break;
      }
      if (dug >= 6) break;
    }

    for (const oy of [1, 2, 3]) {
      const up = bot.blockAt(pos.offset(0, oy, 0));
      if (up && up.boundingBox === 'block' && !/bedrock|barrier/.test(up.name || '')) {
        if (await dig(bot, up)) {
          dug++;
          console.log('[PASSIVE] dug ceiling', up.name);
        }
      }
    }

    const scaffold = items(bot).find(i => BUILD_RE.test(i.name));
    if (scaffold) {
      try {
        await bot.equip(scaffold, 'hand');
        for (let i = 0; i < 4; i++) {
          bot.setControlState('jump', true);
          await sleep(220);
          const base =
            bot.blockAt(bot.entity.position.offset(0, -2, 0)) ||
            bot.blockAt(bot.entity.position.offset(0, -1, 0));
          if (base && base.boundingBox === 'block' && !/water/.test(base.name || '')) {
            try {
              await race(bot.placeBlock(base, new Vec3(0, 1, 0)), 2500);
              console.log('[PASSIVE] pillar up');
            } catch {}
          } else {
            await dryFeet(bot);
          }
          await sleep(120);
        }
        bot.clearControlStates();
      } catch {
        bot.clearControlStates();
      }
    }

    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    bot.setControlState('sprint', true);
    await sleep(700);
    bot.clearControlStates();

    const moved =
      Math.abs(bot.entity.position.x - startPos.x) +
      Math.abs(bot.entity.position.z - startPos.z) +
      Math.abs(bot.entity.position.y - startPos.y);
    if (moved < 0.4) {
      bot.entity.yaw += Math.PI / 2;
      try { await bot.look(bot.entity.yaw, 0, true); } catch {}
      console.log('[PASSIVE] still stuck → rotate 90° dug=' + dug);
    } else {
      console.log('[PASSIVE] escaped moved=' + moved.toFixed(1) + ' dug=' + dug);
    }
    return true;
  } catch (e) {
    console.warn('[PASSIVE] escape err', (e.message || '').slice(0, 40));
    return false;
  }
}

export { dryFeet, escapeHole };
