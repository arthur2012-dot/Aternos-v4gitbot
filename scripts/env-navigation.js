/**
 * Auto-jump + block traversal. Respects bot._digLocked everywhere.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const PASSABLE = /air|cave_air|void_air|light|torch|sign|banner|rail|carpet|button|pressure|tripwire|flower|grass|fern|sapling|mushroom|vine|kelp|seagrass|bubble|snow$|ladder|scaffolding|water/;
const STEPABLE = /slab|stairs|carpet|snow|path|farmland|soul_sand|mud|honey|moss_carpet/;
const FENCE_LIKE = /fence|wall|gate|glass_pane|iron_bars/;
const SOFT = /dirt|grass|sand|gravel|clay|mud|snow|leaves|netherrack|tuff|andesite|granite|diorite|cobblestone|stone$|deepslate|planks|log|wood/;

function isAir(b) {
  return !b || PASSABLE.test(b.name || '') || b.boundingBox === 'empty';
}
function isSolid(b) {
  return b && b.boundingBox === 'block' && !PASSABLE.test(b.name || '');
}
function isLiquid(b) {
  return b && /water|lava/.test(b.name || '');
}

export function scanTerrain(bot, radius = 3) {
  if (!bot?.entity) return null;
  const origin = bot.entity.position.floored();
  const yaw = bot.entity.yaw;
  const fdx = Math.round(-Math.sin(yaw));
  const fdz = Math.round(-Math.cos(yaw));

  const cells = [];
  for (let y = -1; y <= 3; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const b = bot.blockAt(origin.offset(x, y, z));
        cells.push({
          x, y, z,
          name: b?.name || 'air',
          solid: isSolid(b),
          liquid: isLiquid(b),
          step: b ? STEPABLE.test(b.name || '') : false,
          fence: b ? FENCE_LIKE.test(b.name || '') : false,
        });
      }
    }
  }

  const ahead = [];
  for (let s = 1; s <= 4; s++) {
    const body = bot.blockAt(origin.offset(fdx * s, 0, fdz * s));
    const head = bot.blockAt(origin.offset(fdx * s, 1, fdz * s));
    const ground = bot.blockAt(origin.offset(fdx * s, -1, fdz * s));
    const above2 = bot.blockAt(origin.offset(fdx * s, 2, fdz * s));
    ahead.push({
      step: s,
      bodySolid: isSolid(body),
      headSolid: isSolid(head),
      groundSolid: isSolid(ground),
      above2Solid: isSolid(above2),
      bodyName: body?.name || 'air',
      gap: !isSolid(ground) && isAir(body),
      canStep1: isSolid(body) && !isSolid(head) && !isSolid(above2),
      wall: isSolid(body) && isSolid(head),
      fence: body ? FENCE_LIKE.test(body.name || '') : false,
      slab: body ? /slab/.test(body.name || '') : false,
    });
  }

  const under = bot.blockAt(bot.entity.position.offset(0, -0.2, 0));
  const feet = bot.blockAt(bot.entity.position);

  return {
    origin,
    forward: { dx: fdx, dz: fdz },
    ahead,
    onGround: !!bot.entity.onGround,
    inWater: !!bot.entity.isInWater,
    inLava: !!bot.entity.isInLava,
    underName: under?.name || 'air',
    feetName: feet?.name || 'air',
    cells,
  };
}

export function decideNavAction(scan) {
  if (!scan) return { action: 'none' };
  if (scan.inLava) return { action: 'none' };
  if (!scan.onGround && !scan.inWater) return { action: 'none' };

  const a0 = scan.ahead[0];
  const a1 = scan.ahead[1];
  if (!a0) return { action: 'sprint' };

  if (a0.canStep1) return { action: 'jump_step', reason: a0.bodyName };
  if (a0.slab && !a0.headSolid) return { action: 'jump_step', reason: 'slab' };
  if (a0.fence && !a0.headSolid) return { action: 'jump_fence', reason: a0.bodyName };

  if (a0.gap) {
    if (a1 && a1.groundSolid && !a1.headSolid) return { action: 'jump_gap', reason: 'gap1' };
    if (scan.ahead[2]?.groundSolid) return { action: 'jump_gap', reason: 'gap2' };
  }

  if (a0.wall && SOFT.test(a0.bodyName || '')) {
    return { action: 'dig_soft', reason: a0.bodyName };
  }

  if (!a0.bodySolid && !a0.headSolid) return { action: 'sprint' };
  return { action: 'none' };
}

export function enableAdvancedMovement(bot) {
  if (!bot || bot._dreamAdvMove) return;
  bot._dreamAdvMove = true;

  let lastJump = 0;
  let lastDig = 0;

  bot.on('physicsTick', () => {
    try {
      if (!bot.entity) return;
      if (bot._dreamPvpActive || bot._escapeBusy || bot._dangerBusy) return;
      // GLOBAL dig lock — do nothing that moves head
      if (bot._digLocked || bot.targetDigBlock) return;

      const moving =
        !!(bot.controlState.forward || bot.pathfinder?.isMoving?.() || bot._navBusy);

      if (moving && bot.entity.onGround && !bot.entity.isInWater && !bot.entity.isInLava) {
        bot.setControlState('sprint', true);
      }

      if (bot.entity.isInWater && moving) {
        bot.setControlState('jump', true);
        return;
      }

      if (!bot.entity.onGround) return;

      const scan = scanTerrain(bot, 2);
      const decision = decideNavAction(scan);
      bot._lastTerrain = { decision };
      const now = Date.now();

      if (decision.action === 'jump_step' || decision.action === 'jump_fence') {
        if (moving && now - lastJump > 280) {
          bot.setControlState('jump', true);
          lastJump = now;
          setTimeout(() => {
            try { bot.setControlState('jump', false); } catch {}
          }, 160);
        }
      } else if (decision.action === 'jump_gap') {
        if (moving && now - lastJump > 350) {
          bot.setControlState('sprint', true);
          bot.setControlState('jump', true);
          lastJump = now;
          setTimeout(() => {
            try { bot.setControlState('jump', false); } catch {}
          }, 180);
        }
      } else if (decision.action === 'dig_soft' && moving && now - lastDig > 2000) {
        lastDig = now;
        const yaw = bot.entity.yaw;
        const dx = -Math.sin(yaw);
        const dz = -Math.cos(yaw);
        const front = bot.blockAt(bot.entity.position.offset(dx * 0.95, 0, dz * 0.95));
        if (front && isSolid(front) && SOFT.test(front.name || '')) {
          bot._pendingFaceDig = front.position.clone();
        }
      }
    } catch {}
  });

  console.log('[NAV] advanced movement ON — dig-lock aware');
}

export async function processPendingFaceDig(bot) {
  if (!bot?._pendingFaceDig) return false;
  if (bot._digLocked) {
    bot._pendingFaceDig = null;
    return false;
  }
  const pos = bot._pendingFaceDig;
  bot._pendingFaceDig = null;
  try {
    const b = bot.blockAt(pos);
    if (!b || !isSolid(b)) return false;
    if (!SOFT.test(b.name || '')) return false;
    console.log('[NAV] dig soft path', b.name);

    // use dig lock
    bot._digLocked = true;
    bot._digLockPos = pos.clone();
    bot._digLockUntil = Date.now() + 12000;
    const center = pos.offset(0.5, 0.5, 0.5);

    try {
      const inv = bot.inventory.items();
      let tool =
        /_log$|planks|leaves/.test(b.name)
          ? inv.find((i) => /_axe$/.test(i.name))
          : /dirt|sand|gravel|grass|clay|mud|snow/.test(b.name)
            ? inv.find((i) => /_shovel$/.test(i.name))
            : inv.find((i) => /_pickaxe$/.test(i.name));
      if (tool) {
        try { await bot.equip(tool, 'hand'); } catch {}
      }
      await bot.lookAt(center, true);
      const lookIv = setInterval(() => {
        try { bot.lookAt(center, true).catch(() => {}); } catch {}
      }, 200);
      try {
        await Promise.race([
          bot.dig(b, true),
          new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 10000)),
        ]);
      } catch {
        try { bot.stopDigging(); } catch {}
      } finally {
        clearInterval(lookIv);
      }
      return true;
    } finally {
      bot._digLocked = false;
      bot._digLockPos = null;
      bot._digLockUntil = 0;
    }
  } catch {
    try { bot.stopDigging(); } catch {}
    bot._digLocked = false;
    bot._digLockPos = null;
    return false;
  }
}

export function startEnvNavigation(agent) {
  const bot = agent?.bot;
  if (!bot) return;
  if (bot.entity) enableAdvancedMovement(bot);
  else bot.once('spawn', () => enableAdvancedMovement(bot));
}
