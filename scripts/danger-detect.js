/**
 * Automatic danger detection + reaction.
 * Priority: lethal env > low HP > hostile mob > (player fights = pvp module).
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

const HOSTILE_RE =
  /zombie|skeleton|creeper|spider|enderman|witch|phantom|drowned|husk|stray|pillager|vindicator|ravager|slime|magma_cube|blaze|ghast|piglin(?!_brute)|hoglin|wither_skeleton|guardian|elder_guardian|shulker|warden|vex|evoker|cave_spider|silverfish|endermite|zoglin|breeze/i;

const FOOD_RE =
  /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon|melon|sweet_berries|glow_berries|cookie|pie|stew|mushroom_stew|rabbit|tropical_fish|golden_apple|enchanted/;

const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|gravel|sand/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isPlayer(e) {
  return e && (e.type === 'player' || e.username);
}

function mobName(e) {
  return String(e?.name || e?.displayName || e?.mobType || '');
}

function isHostileMob(e) {
  if (!e || isPlayer(e)) return false;
  if (e.type === 'player') return false;
  if (/cow|pig|sheep|chicken|rabbit|horse|donkey|mule|cat|wolf|fox|villager|iron_golem|snow_golem|bat|squid|glow_squid|axolotl|turtle|dolphin|parrot|bee|allay|camel|sniffer|armadillo/i.test(mobName(e))) {
    return false;
  }
  return HOSTILE_RE.test(mobName(e)) || e.kind === 'Hostile mob' || e.type === 'mob';
}

export function scanDangers(bot, opts = {}) {
  const range = opts.range || 16;
  const pos = bot.entity?.position;
  if (!pos) return { level: 0, reasons: [], nearestHostile: null, env: null };

  const reasons = [];
  let level = 0;
  let nearestHostile = null;
  let nearestDist = range;

  try {
    if (bot.entity.isInLava) {
      reasons.push('in_lava');
      level = Math.max(level, 5);
    }
    if (bot.entity.isInWater && bot.health < 10) {
      reasons.push('drown_risk');
      level = Math.max(level, 3);
    }
    const under = bot.blockAt(pos.offset(0, -0.2, 0));
    const feet = bot.blockAt(pos);
    const head = bot.blockAt(pos.offset(0, 1, 0));
    for (const b of [under, feet, head]) {
      if (!b) continue;
      if (/lava/.test(b.name || '')) {
        reasons.push('lava_block');
        level = Math.max(level, 5);
      }
      if (/fire|magma|campfire/.test(b.name || '')) {
        reasons.push('fire');
        level = Math.max(level, 4);
      }
      if (/cactus|sweet_berry|wither_rose/.test(b.name || '')) {
        reasons.push('contact_hazard');
        level = Math.max(level, 2);
      }
    }
    if (bot.entity.velocity?.y < -0.7) {
      reasons.push('falling');
      level = Math.max(level, 3);
    }
    if (pos.y < 0) {
      reasons.push('void');
      level = Math.max(level, 5);
    }
  } catch {}

  if (bot.health <= 6) {
    reasons.push('critical_hp');
    level = Math.max(level, 4);
  } else if (bot.health <= 10) {
    reasons.push('low_hp');
    level = Math.max(level, 3);
  }
  if (bot.food <= 4) {
    reasons.push('starving');
    level = Math.max(level, 2);
  }

  try {
    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      if (!isHostileMob(e)) continue;
      const d = pos.distanceTo(e.position);
      if (d > range) continue;
      if (d < nearestDist) {
        nearestDist = d;
        nearestHostile = e;
      }
      if (/creeper/i.test(mobName(e)) && d < 5) {
        reasons.push('creeper_close');
        level = Math.max(level, 5);
      } else if (d < 4) {
        reasons.push('hostile_melee');
        level = Math.max(level, 4);
      } else if (d < 10) {
        reasons.push('hostile_near');
        level = Math.max(level, 3);
      } else {
        reasons.push('hostile_sight');
        level = Math.max(level, 1);
      }
    }
  } catch {}

  return {
    level,
    reasons: [...new Set(reasons)],
    nearestHostile,
    nearestDist: nearestHostile ? nearestDist : null,
    env: { inLava: !!bot.entity.isInLava, inWater: !!bot.entity.isInWater },
  };
}

async function equipWeapon(bot) {
  try {
    const items = bot.inventory.items();
    const weapons = items.filter((i) => /sword|axe/.test(i.name));
    if (!weapons.length) return;
    const score = (n) => {
      let s = /sword/.test(n) ? 10 : 5;
      if (/netherite/.test(n)) s += 50;
      else if (/diamond/.test(n)) s += 40;
      else if (/iron/.test(n)) s += 30;
      else if (/stone/.test(n)) s += 20;
      return s;
    };
    weapons.sort((a, b) => score(b.name) - score(a.name));
    await bot.equip(weapons[0], 'hand');
  } catch {}
}

async function tryEat(bot) {
  const food = bot.inventory.items().find((i) => FOOD_RE.test(i.name));
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log('[DANGER] ate', food.name);
    return true;
  } catch {
    return false;
  }
}

async function fleeFrom(bot, entity, ms = 1200) {
  if (!entity?.position) return;
  try {
    const pos = bot.entity.position;
    const dx = pos.x - entity.position.x;
    const dz = pos.z - entity.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(-dx / len, -dz / len);
    await bot.look(yaw, 0, true);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    bot.setControlState('jump', true);
    await sleep(ms);
    bot.clearControlStates();
  } catch {
    try { bot.clearControlStates(); } catch {}
  }
}

async function escapeLava(bot) {
  console.log('[DANGER] lava escape');
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  try {
    const build = bot.inventory.items().find((i) => BUILD_RE.test(i.name));
    if (build) {
      await bot.equip(build, 'hand');
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (ref) {
        try { await bot.placeBlock(ref, new Vec3(0, 1, 0)); } catch {}
      }
    }
  } catch {}
  await sleep(800);
  bot.clearControlStates();
}

export async function reactToDanger(bot, danger) {
  if (!bot?.entity || !danger || danger.level < 1) return false;
  if (bot._dreamPvpActive) return false;
  if (bot._dangerBusy) return false;
  bot._dangerBusy = true;

  try {
    const { level, reasons, nearestHostile } = danger;
    console.log('[DANGER] level=' + level, reasons.join(','), nearestHostile ? mobName(nearestHostile) : '');

    if (reasons.includes('in_lava') || reasons.includes('lava_block')) {
      await escapeLava(bot);
      return true;
    }
    if (reasons.includes('fire')) {
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      await sleep(600);
      bot.clearControlStates();
      return true;
    }

    if (reasons.includes('critical_hp') || reasons.includes('low_hp') || reasons.includes('starving')) {
      await tryEat(bot);
    }

    if (reasons.includes('creeper_close') && nearestHostile) {
      await fleeFrom(bot, nearestHostile, 1600);
      return true;
    }

    if (nearestHostile && (reasons.includes('hostile_melee') || reasons.includes('hostile_near'))) {
      const d = bot.entity.position.distanceTo(nearestHostile.position);
      if (bot.health <= 8 || /creeper/i.test(mobName(nearestHostile))) {
        await fleeFrom(bot, nearestHostile, 1400);
        return true;
      }
      if (d < 3.5) {
        await equipWeapon(bot);
        try {
          await bot.lookAt(nearestHostile.position.offset(0, nearestHostile.height * 0.8, 0), true);
          bot.attack(nearestHostile);
        } catch {}
        bot.setControlState('back', true);
        bot.setControlState('left', true);
        await sleep(400);
        bot.clearControlStates();
        return true;
      }
      if (d < 10 && level >= 3) {
        await fleeFrom(bot, nearestHostile, 900);
        return true;
      }
    }

    return false;
  } catch (e) {
    console.warn('[DANGER]', (e.message || '').slice(0, 40));
    return false;
  } finally {
    bot._dangerBusy = false;
  }
}

export function startDangerDetect(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamDangerDetect) return;
  bot._dreamDangerDetect = true;

  let lastReact = 0;

  const tick = async () => {
    try {
      if (!bot.entity) return;
      if (bot._dreamPvpActive) return;
      if (bot._escapeBusy || bot._dangerBusy) return;

      const danger = scanDangers(bot, { range: 18 });
      bot._lastDanger = danger;

      if (danger.level >= 2 && Date.now() - lastReact > 1200) {
        lastReact = Date.now();
        await reactToDanger(bot, danger);
      }
    } catch {}
  };

  setInterval(tick, 800);
  console.log('[DANGER] auto detect ON — mobs/lava/fire/hp');
}

export function getLastDanger(bot) {
  return bot?._lastDanger || { level: 0, reasons: [] };
}
