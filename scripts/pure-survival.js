/**
 * pure-survival.js — survival determinístico, 1 ação por vez
 * pathfinder + collectblock + pvp
 * Nunca empilha tarefas async.
 */

import pkg from 'mineflayer-pathfinder';
const { goals, Movements, pathfinder } = pkg;
import collectBlockPlugin from 'mineflayer-collectblock';
import pvpPlugin from 'mineflayer-pvp';

const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper',
  'spider', 'cave_spider', 'enderman', 'witch', 'phantom',
  'pillager', 'vindicator', 'evoker', 'ravager', 'warden',
  'blaze', 'ghast', 'piglin_brute', 'hoglin', 'zoglin',
]);

const WOOD_LOG = /_(log|stem)$/;
const ORE = /(iron|gold|diamond|coal|copper|lapis|redstone|emerald)_ore|deepslate_.*_ore/;
const FOOD = /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function items(bot) {
  try {
    return bot.inventory.items();
  } catch {
    return [];
  }
}

function countItem(bot, re) {
  return items(bot).filter((i) => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

function findItem(bot, re) {
  return items(bot).find((i) => re.test(i.name));
}

function ensurePlugins(bot) {
  try {
    if (!bot.pathfinder) bot.loadPlugin(pathfinder);
  } catch (e) {
    console.warn('[PURE] pathfinder', e.message);
  }
  try {
    const plug = collectBlockPlugin.plugin || collectBlockPlugin;
    if (!bot.collectBlock) bot.loadPlugin(plug);
  } catch (e) {
    console.warn('[PURE] collectblock', e.message);
  }
  try {
    const plug = pvpPlugin.plugin || pvpPlugin;
    if (!bot.pvp) bot.loadPlugin(plug);
  } catch (e) {
    console.warn('[PURE] pvp', e.message);
  }
  try {
    const mv = new Movements(bot);
    mv.canDig = true;
    mv.allowSprinting = true;
    mv.allowParkour = true;
    bot.pathfinder.setMovements(mv);
  } catch {}
}

function isPlayable(bot) {
  try {
    const gm = bot.game?.gameMode;
    if (gm === 'adventure' || gm === 'spectator') return false;
  } catch {}
  return true;
}

async function doEat(bot) {
  const food = findItem(bot, FOOD);
  if (!food) return false;
  try {
    await bot.equip(food, 'hand');
    bot.activateItem();
    await sleep(1600);
    try { bot.deactivateItem(); } catch {}
    return true;
  } catch {
    return false;
  }
}

async function doFight(bot, entity) {
  if (!entity || !bot.pvp) return false;
  try {
    const sword = findItem(bot, /sword/);
    if (sword) await bot.equip(sword, 'hand');
    bot.pvp.attack(entity);
    await sleep(500);
    return true;
  } catch {
    return false;
  }
}

async function doCollect(bot, block) {
  if (!block) return false;
  try {
    if (bot.pvp?.target) {
      try { await bot.pvp.stop(); } catch {}
    }
    if (bot.collectBlock?.collect) {
      await bot.collectBlock.collect(block);
      return true;
    }
    await bot.pathfinder.goto(
      new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2)
    );
    const tool = findItem(bot, /_pickaxe|_axe|_shovel/);
    if (tool) await bot.equip(tool, 'hand');
    await bot.dig(block);
    return true;
  } catch (e) {
    console.warn('[PURE] collect', String(e.message || e).slice(0, 60));
    try { bot.pathfinder?.setGoal?.(null); } catch {}
    return false;
  }
}

function pickCollectTarget(bot) {
  const woodCount = countItem(bot, WOOD_LOG);
  const cobble = countItem(bot, /cobblestone|^stone$/);
  const hasPick = !!findItem(bot, /_pickaxe/);
  const hasAxe = !!findItem(bot, /_axe/);

  if (woodCount < 20) {
    const log = bot.findBlock({
      matching: (b) => b && WOOD_LOG.test(b.name),
      maxDistance: 32,
    });
    if (log) return { block: log, reason: 'wood' };
  }

  if ((hasPick || hasAxe) && cobble < 40) {
    const stone = bot.findBlock({
      matching: (b) =>
        b &&
        /^(stone|cobblestone|deepslate|andesite|diorite|granite)$/.test(b.name),
      maxDistance: 24,
    });
    if (stone) return { block: stone, reason: 'stone' };
  }

  if (hasPick) {
    const ore = bot.findBlock({
      matching: (b) => b && ORE.test(b.name),
      maxDistance: 20,
    });
    if (ore) return { block: ore, reason: 'ore' };
  }

  return null;
}

async function doWander(bot) {
  try {
    const yaw = Math.random() * Math.PI * 2;
    const dist = 8 + Math.random() * 10;
    const x = bot.entity.position.x + Math.cos(yaw) * dist;
    const z = bot.entity.position.z + Math.sin(yaw) * dist;
    const y = bot.entity.position.y;
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));
    await sleep(2500);
    bot.pathfinder.setGoal(null);
  } catch {}
}

export function startPureSurvival(agent) {
  const bot = agent?.bot || agent;
  if (!bot || bot._pureSurvival) return;
  bot._pureSurvival = true;

  ensurePlugins(bot);

  let busy = false;
  let lastDecision = 0;
  const DECISION_MS = 600;

  async function runOnce() {
    if (busy) return;
    if (!bot.entity) return;
    if (!isPlayable(bot)) return;

    busy = true;
    bot._dreamBusy = true;
    try {
      // 1) comer
      if (bot.food < 14 || bot.health < 12) {
        if (await doEat(bot)) return;
      }

      // 2) combate hostil (nunca player)
      const enemy = bot.nearestEntity((e) => {
        if (!e?.position) return false;
        if (e.type === 'player') return false;
        const n = String(e.name || e.displayName || '')
          .toLowerCase()
          .replace(/\s+/g, '_');
        const host =
          HOSTILE.has(n) || e.type === 'hostile' || e.kind === 'Hostile mobs';
        if (!host) return false;
        return e.position.distanceTo(bot.entity.position) < 8;
      });
      if (enemy) {
        await doFight(bot, enemy);
        return;
      }
      if (bot.pvp?.target) {
        try { await bot.pvp.stop(); } catch {}
      }

      // 3) coletar UMA coisa
      const target = pickCollectTarget(bot);
      if (target?.block) {
        console.log('[PURE]', target.reason, target.block.name);
        await doCollect(bot, target.block);
        return;
      }

      // 4) wander
      await doWander(bot);
    } catch (e) {
      console.warn('[PURE]', String(e.message || e).slice(0, 80));
    } finally {
      busy = false;
      bot._dreamBusy = false;
    }
  }

  const timer = setInterval(() => {
    const now = Date.now();
    if (now - lastDecision < DECISION_MS) return;
    lastDecision = now;
    runOnce().catch(() => {});
  }, DECISION_MS);

  bot.once('end', () => clearInterval(timer));

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const m = String(message || '').trim().toLowerCase();
    if (m === 'pare' || m === 'stop') {
      try { bot.pathfinder?.setGoal?.(null); } catch {}
      try { bot.pvp?.stop?.(); } catch {}
      busy = false;
      bot._dreamBusy = false;
    }
    if (m === 'me siga' || m === 'follow') {
      const player = bot.players[username];
      if (player?.entity) {
        try {
          bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
        } catch {}
      }
    }
  });

  console.log('[PURE] survival ON — 1 ação (eat → fight → collect → wander)');
}
