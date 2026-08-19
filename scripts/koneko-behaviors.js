/**
 * Koneko-inspired survival + player-like water escape
 * Water: swim up, dig ceiling, dig staircase, place under feet, dig path to shore
 */

const HOSTILE = /zombie|skeleton|creeper|spider|enderman|witch|phantom|drowned|husk|stray|pillager|vindicator|ravager|slime|magma|blaze|ghast|piglin|hoglin|wither_skeleton|guardian|shulker|warden/i;

function isWaterBlock(b) {
  if (!b) return false;
  const n = b.name || '';
  return n === 'water' || n === 'flowing_water' || n.includes('water');
}

function inWater(bot) {
  try {
    if (bot.entity?.isInWater) return true;
  } catch {}
  try {
    const p = bot.entity.position;
    const feet = bot.blockAt(p);
    const head = bot.blockAt(p.offset(0, 1, 0));
    const below = bot.blockAt(p.offset(0, -0.3, 0));
    return isWaterBlock(feet) || isWaterBlock(head) || isWaterBlock(below);
  } catch {
    return false;
  }
}

function solidBlock(b) {
  if (!b) return false;
  if (b.boundingBox !== 'block') return false;
  const n = b.name || '';
  if (/air|water|lava|cave_air|void_air|light|torch|sign|banner|rail|carpet|button|pressure|tripwire|flower|grass|fern|sapling|mushroom|vine|kelp|seagrass|bubble/.test(n)) return false;
  if (/bedrock|barrier|command|structure|end_portal/.test(n)) return false;
  return true;
}

async function digBlock(bot, block) {
  if (!block || !solidBlock(block)) return false;
  try {
    const inv = bot.inventory.items();
    const n = block.name || '';
    const shovel = inv.find((i) => /shovel/.test(i.name));
    const pick = inv.find((i) => /pickaxe/.test(i.name));
    const axe = inv.find((i) => /_axe$/.test(i.name));
    if (/dirt|grass|sand|gravel|clay|mud|soul_sand|snow/.test(n) && shovel) {
      try { await bot.equip(shovel, 'hand'); } catch {}
    } else if (/_log$|planks|leaves|wood/.test(n) && axe) {
      try { await bot.equip(axe, 'hand'); } catch {}
    } else if (pick) {
      try { await bot.equip(pick, 'hand'); } catch {}
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await Promise.race([
      bot.dig(block),
      new Promise((_, rej) => setTimeout(() => rej(new Error('dig timeout')), 7000)),
    ]);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

async function placeUnderFeet(bot) {
  try {
    const inv = bot.inventory.items();
    const placeable = inv.find((i) =>
      /dirt|cobble|stone|planks|netherrack|andesite|diorite|granite|tuff|deepslate|sand|gravel/.test(i.name) &&
      !/slab|stair|wall|fence|door|button|pressure/.test(i.name)
    );
    if (!placeable) return false;
    await bot.equip(placeable, 'hand');
    const { Vec3 } = await import('vec3');
    bot.setControlState('jump', true);
    await new Promise((r) => setTimeout(r, 150));

    const candidates = [
      bot.blockAt(bot.entity.position.offset(0, -2, 0)),
      bot.blockAt(bot.entity.position.offset(0, -1, 0)),
      bot.blockAt(bot.entity.position.offset(1, -1, 0)),
      bot.blockAt(bot.entity.position.offset(-1, -1, 0)),
      bot.blockAt(bot.entity.position.offset(0, -1, 1)),
      bot.blockAt(bot.entity.position.offset(0, -1, -1)),
      bot.blockAt(bot.entity.position.offset(1, 0, 0)),
      bot.blockAt(bot.entity.position.offset(-1, 0, 0)),
      bot.blockAt(bot.entity.position.offset(0, 0, 1)),
      bot.blockAt(bot.entity.position.offset(0, 0, -1)),
    ];
    for (const base of candidates) {
      if (!base || !solidBlock(base)) continue;
      try {
        await bot.placeBlock(base, new Vec3(0, 1, 0));
        console.log('[KONEKO] place under feet (pillar)');
        return true;
      } catch {
        try {
          await bot.placeBlock(base, new Vec3(1, 0, 0));
          console.log('[KONEKO] place side');
          return true;
        } catch {}
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    try { bot.setControlState('jump', false); } catch {}
  }
}

/**
 * Player-like water escape:
 * 1) hold jump + sprint toward shore
 * 2) dig ceiling if blocked
 * 3) dig staircase (forward+up) like a player climbing out
 * 4) place blocks under feet to pillar out
 * 5) dig side walls if current pins you
 */
async function escapeWater(bot) {
  if (!bot.entity || !inWater(bot)) return false;

  bot.setControlState('jump', true);
  bot.setControlState('sprint', true);

  const p = bot.entity.position;

  for (const oy of [1, 2, 3]) {
    const up = bot.blockAt(p.offset(0, oy, 0));
    if (solidBlock(up)) {
      console.log('[KONEKO] dig water ceiling', up.name);
      await digBlock(bot, up);
      bot.setControlState('jump', true);
      return true;
    }
  }

  const yaw = bot.entity.yaw;
  const fdx = Math.round(-Math.sin(yaw));
  const fdz = Math.round(-Math.cos(yaw));
  const stairOffsets = [
    [fdx, 1, fdz],
    [fdx, 0, fdz],
    [fdx, 2, fdz],
    [0, 1, 0],
    [0, 2, 0],
  ];
  for (const [ox, oy, oz] of stairOffsets) {
    const b = bot.blockAt(p.offset(ox, oy, oz));
    if (solidBlock(b)) {
      console.log('[KONEKO] dig stair', b.name, ox, oy, oz);
      await digBlock(bot, b);
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 200));
      return true;
    }
  }

  let shoreDir = null;
  for (let r = 1; r <= 8 && !shoreDir; r++) {
    for (let dx = -r; dx <= r && !shoreDir; dx++) {
      for (let dz = -r; dz <= r && !shoreDir; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const ground = bot.blockAt(p.offset(dx, -1, dz));
        const here = bot.blockAt(p.offset(dx, 0, dz));
        if (ground && solidBlock(ground) && (!here || !isWaterBlock(here) || here.name === 'air')) {
          shoreDir = { dx, dz };
        }
      }
    }
  }
  if (shoreDir) {
    try {
      await bot.lookAt(p.offset(shoreDir.dx, 1, shoreDir.dz), true);
    } catch {}
    bot.setControlState('forward', true);
    const stepX = Math.sign(shoreDir.dx) || 0;
    const stepZ = Math.sign(shoreDir.dz) || 0;
    for (const oy of [0, 1]) {
      const wall = bot.blockAt(p.offset(stepX, oy, stepZ));
      if (solidBlock(wall)) {
        console.log('[KONEKO] dig toward shore', wall.name);
        await digBlock(bot, wall);
        return true;
      }
    }
  } else {
    bot.setControlState('forward', true);
  }

  const below = bot.blockAt(p.offset(0, -1, 0));
  if (isWaterBlock(below) || (below && below.name === 'air')) {
    const placed = await placeUnderFeet(bot);
    if (placed) return true;
  }

  for (const [ox, oy, oz] of [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  ]) {
    const side = bot.blockAt(p.offset(ox, oy, oz));
    if (solidBlock(side)) {
      console.log('[KONEKO] dig side wall', side.name);
      await digBlock(bot, side);
      return true;
    }
  }

  return true;
}

export async function startKonekoBehaviors(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamKoneko) return;
  bot._dreamKoneko = true;

  try {
    const pvpMod = await import('mineflayer-pvp');
    const plugin = pvpMod.plugin || pvpMod.default?.plugin || pvpMod.default;
    if (plugin && !bot.pvp) {
      bot.loadPlugin(plugin);
      console.log('[KONEKO] mineflayer-pvp loaded');
    }
  } catch (e) {
    console.warn('[KONEKO] mineflayer-pvp skip', e.message?.slice(0, 40));
  }

  try {
    const armor = await import('mineflayer-armor-manager');
    const ap = armor.default || armor;
    if (typeof ap === 'function' && !bot.armorManager) {
      bot.loadPlugin(ap);
      console.log('[KONEKO] armor-manager loaded');
    }
  } catch {}

  try {
    const ae = await import('mineflayer-auto-eat');
    const plug = ae.plugin || ae.default?.plugin || ae.default;
    if (plug && !bot.autoEat) {
      bot.loadPlugin(plug);
      if (bot.autoEat?.enable) bot.autoEat.enable();
      console.log('[KONEKO] auto-eat loaded');
    }
  } catch {}

  let lastMobAttack = 0;
  let lastFireSeek = 0;
  let lastSleepTry = 0;
  let waterBusy = false;
  let waterTicks = 0;

  setInterval(() => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (Date.now() - lastMobAttack < 800) return;

      const mob = bot.nearestEntity((e) => {
        if (!e || e === bot.entity) return false;
        if (e.type === 'player') return false;
        const nm = String(e.name || e.displayName || e.username || '');
        if (!HOSTILE.test(nm)) return false;
        const d = e.position.distanceTo(bot.entity.position);
        return d < 12;
      });
      if (!mob) return;
      lastMobAttack = Date.now();
      try {
        if (bot.pvp?.attack) bot.pvp.attack(mob);
        else bot.attack(mob);
      } catch {}
    } catch {}
  }, 700);

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (waterBusy) return;
      if (!inWater(bot)) {
        waterTicks = 0;
        return;
      }
      waterTicks++;
      waterBusy = true;
      try {
        await escapeWater(bot);
        if (waterTicks >= 4) {
          await placeUnderFeet(bot);
        }
        if (waterTicks >= 8) {
          bot.entity.yaw += Math.PI / 2;
          try { await bot.look(bot.entity.yaw, 0, true); } catch {}
          waterTicks = 0;
        }
      } finally {
        waterBusy = false;
        setTimeout(() => {
          try {
            if (!inWater(bot)) bot.clearControlStates();
          } catch {}
        }, 300);
      }
    } catch {
      waterBusy = false;
    }
  }, 450);

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (!bot.entity.onFire) return;
      if (Date.now() - lastFireSeek < 5000) return;
      lastFireSeek = Date.now();
      console.log('[KONEKO] on fire → water');
      const water = bot.findBlock({
        matching: (b) => b && /water/.test(b.name || ''),
        maxDistance: 16,
      });
      if (water) {
        try {
          if (typeof bot.dreamGoto === 'function') {
            await bot.dreamGoto(water.position.x, water.position.y, water.position.z, 1);
          }
        } catch {}
      } else {
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        setTimeout(() => bot.clearControlStates(), 500);
      }
    } catch {}
  }, 1000);

  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (Date.now() - lastSleepTry < 30000) return;
      const tod = bot.time?.timeOfDay ?? 0;
      if (tod < 12542 || tod > 23460) return;
      if (bot.isSleeping) return;
      const bed = bot.findBlock({
        matching: (b) => b && /_bed$|^bed$/.test(b.name || ''),
        maxDistance: 20,
      });
      if (!bed) return;
      lastSleepTry = Date.now();
      console.log('[KONEKO] try sleep');
      try {
        if (typeof bot.dreamGoto === 'function') {
          await bot.dreamGoto(bed.position.x, bed.position.y, bed.position.z, 2);
        }
        await bot.sleep(bed);
      } catch (e) {
        console.warn('[KONEKO] sleep fail', (e.message || '').slice(0, 30));
      }
    } catch {}
  }, 8000);

  console.log('[KONEKO] behaviors ON — water dig/stair/place, mobs, fire, sleep');
}
