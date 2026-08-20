/**
 * SUPER NAV TREE — pure code
 * - DIG LOCK: keep looking at block until broken
 * - DIR COMMIT: pick best direction once and KEEP it (no random spin)
 * - Only re-pick direction when truly stuck for several ticks
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

const HARD = /obsidian|bedrock|barrier|command|structure|end_portal|ancient_debris|crying_obsidian|reinforced/;
const SOFT = /dirt|grass_block|grass|sand|gravel|clay|mud|snow|soul_sand|farmland|podzol|mycelium|rooted|leaves|netherrack|tuff|andesite|granite|diorite|cobblestone|stone$|deepslate|planks|log|wood|terracotta|concrete|bricks|moss/;
const BUILD = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|gravel|sand/;
const AIR = /^(air|cave_air|void_air)$/;
const WATER = /water|flowing_water/;
const LAVA = /lava|flowing_lava/;
const PASSABLE = /air|cave_air|void_air|torch|sign|banner|rail|carpet|button|pressure|tripwire|flower|fern|sapling|mushroom|vine|kelp|seagrass|bubble|snow$|ladder|scaffolding/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAir(b) {
  return !b || AIR.test(b.name || '') || b.boundingBox === 'empty' || PASSABLE.test(b.name || '');
}
function isSolid(b) {
  return b && b.boundingBox === 'block' && !PASSABLE.test(b.name || '') && !WATER.test(b.name || '');
}
function isSoft(b) {
  return b && SOFT.test(b.name || '') && !HARD.test(b.name || '');
}
function isHard(b) {
  return b && HARD.test(b.name || '');
}
function isWater(b) {
  return b && WATER.test(b.name || '');
}
function isLava(b) {
  return b && LAVA.test(b.name || '');
}

function items(bot) {
  try {
    return bot.inventory.items();
  } catch {
    return [];
  }
}

function hasPick(bot) {
  return items(bot).some((i) => /_pickaxe$/.test(i.name));
}
function hasBuild(bot) {
  return items(bot).some((i) => BUILD.test(i.name) && !/ore|ingot|sword|pick|axe|shovel|hoe/.test(i.name));
}

async function equipFor(bot, block) {
  const inv = items(bot);
  const n = block?.name || '';
  let tool =
    /_log$|planks|leaves|bamboo/.test(n)
      ? inv.find((i) => /_axe$/.test(i.name))
      : /dirt|sand|gravel|grass|clay|mud|snow|soul_sand|farmland/.test(n)
        ? inv.find((i) => /_shovel$/.test(i.name))
        : inv.find((i) => /_pickaxe$/.test(i.name));
  if (!tool) tool = inv.find((i) => /_shovel$|_pickaxe$|_axe$/.test(i.name));
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
    } catch {}
  }
}

async function digHold(bot, block) {
  if (!block || isAir(block) || isHard(block)) return false;
  const pos = block.position.clone();
  const center = pos.offset(0.5, 0.5, 0.5);
  const stone = /stone|cobble|deepslate|granite|andesite|diorite|tuff/.test(block.name || '');
  const timeout = !hasPick(bot) && stone ? 24000 : 16000;

  bot._digLocked = true;
  bot._digLockPos = pos.clone();
  bot._digLockUntil = Date.now() + timeout + 2000;

  try {
    bot.pathfinder?.stop?.();
  } catch {}
  try {
    bot.pathfinder?.setGoal?.(null);
  } catch {}
  try {
    bot.clearControlStates();
  } catch {}

  try {
    for (let t = 0; t < 5; t++) {
      const live = bot.blockAt(pos);
      if (!live || isAir(live)) {
        console.log('[NAVTREE] dig DONE', pos.x, pos.y, pos.z);
        return true;
      }

      await equipFor(bot, live);
      try {
        await bot.lookAt(center, true);
      } catch {}

      const lookIv = setInterval(() => {
        try {
          if (!bot.entity) return;
          bot.lookAt(center, true).catch(() => {});
        } catch {}
      }, 200);

      try {
        await Promise.race([
          bot.dig(live, true),
          new Promise((_, rej) => setTimeout(() => rej(new Error('t')), timeout)),
        ]);
      } catch {
        try {
          bot.stopDigging();
        } catch {}
      } finally {
        clearInterval(lookIv);
      }

      try {
        await bot.lookAt(center, true);
      } catch {}

      const after = bot.blockAt(pos);
      if (!after || isAir(after)) {
        console.log('[NAVTREE] dig DONE', pos.x, pos.y, pos.z);
        return true;
      }
      await sleep(100);
    }
    return false;
  } finally {
    bot._digLocked = false;
    bot._digLockPos = null;
    bot._digLockUntil = 0;
  }
}

async function placePillar(bot) {
  if (bot._digLocked) return false;
  const build = items(bot).find(
    (i) => BUILD.test(i.name) && !/ore|ingot|sword|pick|axe|shovel|hoe/.test(i.name)
  );
  if (!build) return false;
  try {
    await bot.equip(build, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref || !isSolid(ref)) return false;
    bot.setControlState('jump', true);
    await sleep(110);
    try {
      await bot.placeBlock(ref, new Vec3(0, 1, 0));
    } catch {
      try {
        const under = bot.blockAt(bot.entity.position.offset(0, -0.5, 0));
        if (under && isSolid(under)) await bot.placeBlock(under, new Vec3(0, 1, 0));
      } catch {}
    }
    bot.setControlState('jump', false);
    await sleep(70);
    return true;
  } catch {
    bot.setControlState('jump', false);
    return false;
  }
}

async function placeBridge(bot, dx, dz) {
  if (bot._digLocked) return false;
  const build = items(bot).find(
    (i) => BUILD.test(i.name) && !/ore|ingot|sword|pick|axe|shovel|hoe/.test(i.name)
  );
  if (!build) return false;
  try {
    await bot.equip(build, 'hand');
    const feet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!feet || !isSolid(feet)) return false;
    bot.setControlState('sneak', true);
    await sleep(40);
    await bot.lookAt(feet.position.offset(0.5 + dx * 0.5, 1, 0.5 + dz * 0.5), true);
    await bot.placeBlock(feet, new Vec3(dx, 0, dz));
    bot.clearControlStates();
    return true;
  } catch {
    bot.clearControlStates();
    return false;
  }
}

/** Face a direction (dx,dz) once and keep that yaw */
async function faceDir(bot, dx, dz) {
  const yaw = Math.atan2(-dx, -dz);
  try {
    await bot.look(yaw, 0, true);
  } catch {}
}

export function fullScan(bot, R = 5, HU = 6, HD = 2) {
  if (!bot?.entity) return null;
  const origin = bot.entity.position.floored();
  const yaw = bot.entity.yaw;
  const fdx = Math.round(-Math.sin(yaw)) || 0;
  const fdz = Math.round(-Math.cos(yaw)) || -1;

  const grid = {};
  let solid = 0,
    soft = 0,
    air = 0,
    water = 0,
    lava = 0;

  for (let y = -HD; y <= HU; y++) {
    for (let x = -R; x <= R; x++) {
      for (let z = -R; z <= R; z++) {
        const b = bot.blockAt(origin.offset(x, y, z));
        const key = x + ',' + y + ',' + z;
        let kind = 'air';
        if (isLava(b)) {
          kind = 'lava';
          lava++;
        } else if (isWater(b)) {
          kind = 'water';
          water++;
        } else if (isHard(b)) {
          kind = 'hard';
          solid++;
        } else if (isSolid(b)) {
          kind = isSoft(b) ? 'soft' : 'solid';
          if (kind === 'soft') soft++;
          else solid++;
        } else {
          air++;
        }
        grid[key] = { x, y, z, name: b?.name || 'air', kind, block: b };
      }
    }
  }

  function cell(x, y, z) {
    return grid[x + ',' + y + ',' + z] || { kind: 'air', name: 'air' };
  }

  let walls = 0;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (cell(dx, 0, dz).kind === 'soft' || cell(dx, 0, dz).kind === 'solid' || cell(dx, 0, dz).kind === 'hard')
      walls++;
  }

  const head = cell(0, 1, 0);
  const headBlocked = head.kind === 'soft' || head.kind === 'solid' || head.kind === 'hard';

  let skyOpen = false;
  for (let y = 2; y <= 10; y++) {
    const c = cell(0, y, 0);
    if (c.kind === 'air') {
      if (y >= 4) skyOpen = true;
    } else break;
  }

  // score each cardinal for openness / diggability
  const dirs = [
    { dx: 1, dz: 0, name: 'east' },
    { dx: -1, dz: 0, name: 'west' },
    { dx: 0, dz: 1, name: 'south' },
    { dx: 0, dz: -1, name: 'north' },
  ];
  const dirScores = dirs.map((d) => {
    let softC = 0,
      airC = 0,
      hardC = 0,
      solidC = 0,
      depth = 0,
      openRun = 0;
    for (let s = 1; s <= 5; s++) {
      const body = cell(d.dx * s, 0, d.dz * s);
      const headC = cell(d.dx * s, 1, d.dz * s);
      const ground = cell(d.dx * s, -1, d.dz * s);
      if (body.kind === 'hard') {
        hardC++;
        break;
      }
      if (body.kind === 'air' && headC.kind === 'air') {
        airC += 2;
        openRun++;
        depth = s;
        // prefer solid ground
        if (ground.kind === 'soft' || ground.kind === 'solid') airC += 3;
        continue;
      }
      if (body.kind === 'soft') {
        softC += 2;
        depth = s;
      } else if (body.kind === 'solid') {
        solidC++;
        depth = s;
      }
      if (headC.kind === 'soft') softC++;
      if (headC.kind === 'air') airC++;
    }
    // higher = better path to commit to
    const score = airC * 20 + softRun * 15 + softC * 8 + depth * 5 - hardC * 40 - solidC * 5;
    return { ...d, softC, airC, hardC, solidC, depth, openRun, score };
  });

  // forward relative to current yaw
  const ahead = [];
  for (let s = 1; s <= 5; s++) {
    const body = cell(fdx * s, 0, fdz * s);
    const headC = cell(fdx * s, 1, fdz * s);
    const ground = cell(fdx * s, -1, fdz * s);
    const above2 = cell(fdx * s, 2, fdz * s);
    ahead.push({
      s,
      body,
      head: headC,
      ground,
      above2,
      gap: ground.kind === 'air' && body.kind === 'air',
      canStep:
        (body.kind === 'soft' || body.kind === 'solid') &&
        headC.kind === 'air' &&
        above2.kind === 'air',
      wall:
        (body.kind === 'soft' || body.kind === 'solid' || body.kind === 'hard') &&
        (headC.kind === 'soft' || headC.kind === 'solid' || headC.kind === 'hard'),
      softWall: body.kind === 'soft',
      open: body.kind === 'air' && headC.kind === 'air',
    });
  }

  return {
    origin,
    fdx,
    fdz,
    grid,
    cell,
    solid,
    soft,
    air,
    water,
    lava,
    walls,
    headBlocked,
    skyOpen,
    ahead,
    dirScores,
    onGround: !!bot.entity.onGround,
    inWater: !!bot.entity.isInWater || water > 0,
    inLava: !!bot.entity.isInLava || lava > 0,
    trapped: walls >= 2 || headBlocked,
  };
}

/** Pick best cardinal direction from scan */
function pickBestDir(scan, committed) {
  if (!scan?.dirScores?.length) return committed || { dx: 0, dz: -1 };
  const sorted = [...scan.dirScores].sort((a, b) => b.score - a.score);
  // if we have a commit and it's still decent, keep it
  if (committed) {
    const same = sorted.find((d) => d.dx === committed.dx && d.dz === committed.dz);
    if (same && same.score >= sorted[0].score - 25) return same;
  }
  return sorted[0];
}

async function executeAction(bot, act, scan) {
  if (!act || !bot?.entity) return false;
  if (bot._digLocked && !/^dig_/.test(act.type)) return false;

  try {
    if (!bot._digLocked) bot.clearControlStates();
  } catch {}

  switch (act.type) {
    case 'commit_walk': {
      // face committed dir then walk — NO random yaw
      await faceDir(bot, act.dx, act.dz);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(350);
      bot.clearControlStates();
      return true;
    }
    case 'commit_dig': {
      // dig the block directly in front of committed direction
      await faceDir(bot, act.dx, act.dz);
      const origin = bot.entity.position.floored();
      for (const oy of [0, 1]) {
        const b = bot.blockAt(origin.offset(act.dx, oy, act.dz));
        if (b && isSolid(b) && !isHard(b)) {
          console.log('[NAVTREE] commit_dig LOCK', b.name, b.position.x, b.position.y, b.position.z);
          await digHold(bot, b);
          return true;
        }
      }
      // nothing to dig — just walk
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(250);
      bot.clearControlStates();
      return true;
    }
    case 'jump_step': {
      await faceDir(bot, act.dx ?? scan.fdx, act.dz ?? scan.fdz);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      await sleep(220);
      bot.clearControlStates();
      return true;
    }
    case 'jump_gap': {
      await faceDir(bot, act.dx ?? scan.fdx, act.dz ?? scan.fdz);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(80);
      bot.setControlState('jump', true);
      await sleep(280);
      bot.clearControlStates();
      return true;
    }
    case 'dig_up': {
      const y = act.y || 1;
      const b = bot.blockAt(bot.entity.position.floored().offset(0, y, 0));
      if (b && isSolid(b) && !isHard(b)) {
        console.log('[NAVTREE] dig_up LOCK', b.name, 'y+' + y);
        return digHold(bot, b);
      }
      return false;
    }
    case 'sanitize': {
      console.log('[NAVTREE] SANITIZE');
      const pf = bot.entity.position.floored();
      const dx = act.dx ?? scan.fdx;
      const dz = act.dz ?? scan.fdz;
      await faceDir(bot, dx, dz);
      // ceiling then committed front then sides — one by one locked
      const order = [];
      for (let y = 1; y <= 3; y++) order.push([0, y, 0]);
      order.push([dx, 0, dz], [dx, 1, dz]);
      for (const [ox, oz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (ox === dx && oz === dz) continue;
        order.push([ox, 0, oz], [ox, 1, oz]);
      }
      for (const [ox, oy, oz] of order) {
        const b = bot.blockAt(pf.offset(ox, oy, oz));
        if (b && isSolid(b) && !isHard(b)) await digHold(bot, b);
      }
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      await sleep(450);
      bot.clearControlStates();
      return true;
    }
    case 'stair_out': {
      const dx = act.dx ?? scan.fdx;
      const dz = act.dz ?? scan.fdz;
      console.log('[NAVTREE] stair_out', dx, dz);
      await faceDir(bot, dx, dz);
      const origin = bot.entity.position.floored();
      for (let s = 0; s < 4; s++) {
        const body = bot.blockAt(origin.offset(dx * (s + 1), s, dz * (s + 1)));
        const head = bot.blockAt(origin.offset(dx * (s + 1), s + 1, dz * (s + 1)));
        if (body && isSolid(body) && !isHard(body)) await digHold(bot, body);
        if (head && isSolid(head) && !isHard(head)) await digHold(bot, head);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        if (s > 0) bot.setControlState('jump', true);
        await sleep(260);
        bot.clearControlStates();
      }
      return true;
    }
    case 'pillar': {
      console.log('[NAVTREE] pillar');
      for (let i = 0; i < 3; i++) {
        const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
        if (head && isSolid(head) && !isHard(head)) await digHold(bot, head);
        await placePillar(bot);
        bot.setControlState('jump', true);
        await sleep(180);
        bot.setControlState('jump', false);
      }
      return true;
    }
    case 'bridge': {
      const dx = act.dx ?? scan.fdx;
      const dz = act.dz ?? scan.fdz;
      console.log('[NAVTREE] bridge');
      await faceDir(bot, dx, dz);
      await placeBridge(bot, dx, dz);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(220);
      bot.clearControlStates();
      return true;
    }
    case 'swim_up': {
      bot.setControlState('jump', true);
      bot.setControlState('sprint', true);
      bot.setControlState('forward', true);
      await sleep(400);
      bot.clearControlStates();
      return true;
    }
    case 'escape_lava': {
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      await sleep(500);
      bot.clearControlStates();
      return true;
    }
    default:
      return false;
  }
}

/**
 * Decide next action based on committed direction + scan.
 * NEVER random-turn. Always dig/walk toward committed dir.
 */
function decide(scan, bot, committed) {
  if (!scan) return null;

  if (scan.inLava) return { type: 'escape_lava', score: 1000 };

  if (scan.inWater) {
    if (scan.headBlocked) return { type: 'dig_up', score: 220, y: 1 };
    return { type: 'swim_up', score: 200 };
  }

  const dir = pickBestDir(scan, committed);
  const dx = dir.dx;
  const dz = dir.dz;

  // trapped → sanitize toward best dir
  if (scan.trapped) {
    if (scan.headBlocked) return { type: 'dig_up', score: 250, y: 1, dx, dz };
    return { type: 'sanitize', score: 300, dx, dz };
  }

  // look at what's in the COMMITTED direction (not current yaw)
  const body = scan.cell(dx, 0, dz);
  const head = scan.cell(dx, 1, dz);
  const ground = scan.cell(dx, -1, dz);
  const above2 = scan.cell(dx, 2, dz);

  const open = body.kind === 'air' && head.kind === 'air';
  const softWall = body.kind === 'soft';
  const solidWall = body.kind === 'solid' || body.kind === 'hard';
  const canStep =
    (body.kind === 'soft' || body.kind === 'solid') && head.kind === 'air' && above2.kind === 'air';
  const gap = ground.kind === 'air' && body.kind === 'air';

  if (softWall || (solidWall && body.kind !== 'hard')) {
    return { type: 'commit_dig', score: 160, dx, dz };
  }
  if (canStep) return { type: 'jump_step', score: 100, dx, dz };
  if (gap) {
    if (hasBuild(bot)) return { type: 'bridge', score: 110, dx, dz };
    return { type: 'jump_gap', score: 90, dx, dz };
  }
  if (open) return { type: 'commit_walk', score: 80, dx, dz };

  // still blocked by hard? try dig up / stair / sanitize
  if (solidWall) {
    if (scan.headBlocked) return { type: 'dig_up', score: 200, y: 1, dx, dz };
    return { type: 'stair_out', score: 180, dx, dz };
  }

  // default: walk committed dir
  return { type: 'commit_walk', score: 50, dx, dz };
}

export function startNavTree(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamNavTree) return;
  bot._dreamNavTree = true;

  let busy = false;
  let lastPos = null;
  let stillTicks = 0;
  let lastLog = 0;

  // COMMITTED DIRECTION — persists across ticks
  let committed = null; // { dx, dz, name }
  let commitTicks = 0;
  const COMMIT_HOLD = 8; // keep same dir for ~7s before allowing re-pick

  const tick = async () => {
    if (!bot.entity || busy) return;
    if (bot._dreamPvpActive || bot._escapeBusy || bot._killChatEscaping) return;

    // dig lock: only keep looking, no other action
    if (bot._digLocked && bot._digLockPos) {
      try {
        await bot.lookAt(bot._digLockPos.offset(0.5, 0.5, 0.5), true);
      } catch {}
      return;
    }
    if (bot._digLockUntil && Date.now() > bot._digLockUntil) {
      bot._digLocked = false;
      bot._digLockPos = null;
    }

    busy = true;
    try {
      const pos = bot.entity.position;
      if (lastPos && pos.distanceTo(lastPos) < 0.25) stillTicks++;
      else stillTicks = 0;
      lastPos = pos.clone();

      const scan = fullScan(bot, 4, 5, 2);
      if (!scan) return;

      // (re)pick direction only if none OR stuck long enough
      if (!committed || stillTicks >= 5 || commitTicks >= COMMIT_HOLD) {
        const best = pickBestDir(scan, stillTicks >= 5 ? null : committed);
        if (!committed || best.dx !== committed.dx || best.dz !== committed.dz) {
          committed = { dx: best.dx, dz: best.dz, name: best.name, score: best.score };
          commitTicks = 0;
          console.log(
            '[NAVTREE] COMMIT dir=' +
              committed.name +
              ' score=' +
              Math.round(committed.score) +
              ' still=' +
              stillTicks
          );
        } else {
          commitTicks = 0; // refresh hold if same dir re-chosen
        }
      }

      commitTicks++;

      let act = decide(scan, bot, committed);

      // force sanitize when very stuck
      if (stillTicks >= 4 && scan.trapped) {
        act = { type: 'sanitize', score: 400, dx: committed.dx, dz: committed.dz };
      } else if (stillTicks >= 6) {
        // stuck but not trapped — dig toward commit
        act = { type: 'commit_dig', score: 300, dx: committed.dx, dz: committed.dz };
      }

      if (!act) return;

      if (Date.now() - lastLog > 3500) {
        console.log(
          '[NAVTREE]',
          act.type,
          'dir=' + (committed?.name || '?'),
          'still=' + stillTicks,
          'walls=' + scan.walls
        );
        lastLog = Date.now();
      }

      await executeAction(bot, act, scan);

      if (/dig|sanitize|stair/.test(act.type)) stillTicks = 0;
    } catch (e) {
      console.warn('[NAVTREE]', (e.message || '').slice(0, 50));
    } finally {
      busy = false;
    }
  };

  bot.on('physicsTick', () => {
    try {
      if (!bot.entity) return;
      if (bot._dreamPvpActive || bot._escapeBusy) return;

      if (bot._digLocked && bot._digLockPos) {
        try {
          bot.lookAt(bot._digLockPos.offset(0.5, 0.5, 0.5), true).catch(() => {});
        } catch {}
        return;
      }

      if (bot.targetDigBlock) return;

      const moving = !!(bot.controlState.forward || bot._navBusy);
      if (moving && bot.entity.onGround && !bot.entity.isInWater) {
        bot.setControlState('sprint', true);
      }
      if (bot.entity.isInWater) {
        bot.setControlState('jump', true);
      }

      // auto-jump step in committed direction only
      if (moving && bot.entity.onGround && committed) {
        const origin = bot.entity.position.floored();
        const body = bot.blockAt(origin.offset(committed.dx, 0, committed.dz));
        const head = bot.blockAt(origin.offset(committed.dx, 1, committed.dz));
        const above2 = bot.blockAt(origin.offset(committed.dx, 2, committed.dz));
        if (
          body &&
          isSolid(body) &&
          head &&
          isAir(head) &&
          (!above2 || isAir(above2))
        ) {
          bot.setControlState('jump', true);
          setTimeout(() => {
            try {
              bot.setControlState('jump', false);
            } catch {}
          }, 140);
        }
      }
    } catch {}
  });

  setInterval(tick, 900);
  console.log('[NAVTREE] ON — commit direction + dig lock (NO random turn)');
}
