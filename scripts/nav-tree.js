/**
 * SUPER NAV TREE + AREA SANITATION (pure code, zero LLM)
 * DIG LOCK: once a block is chosen, bot keeps looking at it until broken.
 * No turn / walk / random while dig is active.
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

/**
 * LOCKED dig: keeps looking at the SAME position until air.
 * Refuses to change yaw mid-break. Other systems see bot._digLocked.
 */
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
      depth = 0;
    for (let s = 1; s <= 4; s++) {
      const body = cell(d.dx * s, 0, d.dz * s);
      const headC = cell(d.dx * s, 1, d.dz * s);
      if (body.kind === 'hard') {
        hardC++;
        break;
      }
      if (body.kind === 'soft') softC++;
      if (body.kind === 'air') airC++;
      if (headC.kind === 'soft') softC++;
      if (headC.kind === 'air') airC++;
      depth = s;
    }
    return { ...d, softC, airC, hardC, depth, score: softC * 12 + airC * 18 + depth * 4 - hardC * 30 };
  });

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

function enumerateActions(scan, bot) {
  const acts = [];
  if (!scan) return acts;

  if (scan.inLava) {
    acts.push({ type: 'escape_lava', score: 1000 });
    return acts;
  }

  if (scan.inWater) {
    acts.push({ type: 'swim_up', score: 200 });
    if (scan.headBlocked && isSoft(scan.cell(0, 1, 0).block))
      acts.push({ type: 'dig_up', score: 220, y: 1 });
    acts.push({ type: 'pillar', score: 180 });
  }

  if (scan.trapped) {
    acts.push({ type: 'sanitize', score: 300 });
    acts.push({ type: 'dig_up', score: 250, y: 1 });
    acts.push({ type: 'dig_up', score: 240, y: 2 });
    for (const d of scan.dirScores) {
      acts.push({
        type: 'dig_dir',
        score: 200 + d.score,
        dx: d.dx,
        dz: d.dz,
        depth: Math.max(d.depth, 2),
      });
    }
    acts.push({ type: 'stair_out', score: 210 });
    acts.push({ type: 'pillar', score: 190 });
  }

  const a0 = scan.ahead[0];
  const a1 = scan.ahead[1];
  const a2 = scan.ahead[2];

  if (a0) {
    if (a0.open) acts.push({ type: 'walk', score: 80 });
    if (a0.canStep) acts.push({ type: 'jump_step', score: 90, reason: a0.body.name });
    if (a0.softWall) acts.push({ type: 'dig_front', score: 140, block: a0.body });
    if (a0.wall && a0.body.kind === 'soft') acts.push({ type: 'dig_front', score: 150, block: a0.body });
    if (a0.wall && a0.body.kind === 'solid' && scan.trapped)
      acts.push({ type: 'dig_front', score: 160, block: a0.body });
    if (a0.gap) {
      if (a1 && (a1.ground.kind === 'soft' || a1.ground.kind === 'solid') && a1.head.kind === 'air')
        acts.push({ type: 'jump_gap', score: 100 });
      else if (hasBuild(bot)) acts.push({ type: 'bridge', score: 110, dx: scan.fdx, dz: scan.fdz });
      else acts.push({ type: 'jump_gap', score: 70 });
    }
  }

  if (a1 && a1.gap && a2 && (a2.ground.kind === 'soft' || a2.ground.kind === 'solid')) {
    acts.push({ type: 'jump_gap', score: 85 });
  }

  for (const d of scan.dirScores) {
    if (d.airC >= 2) acts.push({ type: 'turn_walk', score: 55 + d.airC * 5, dx: d.dx, dz: d.dz });
    if (d.softC > 0 && d.score > 20)
      acts.push({ type: 'dig_dir', score: 70 + d.score, dx: d.dx, dz: d.dz, depth: 2 });
  }

  acts.push({ type: 'walk', score: 30 });
  acts.push({ type: 'turn_random', score: 8 });

  if (scan.skyOpen && hasBuild(bot)) acts.push({ type: 'pillar', score: 40 });

  acts.sort((a, b) => b.score - a.score);
  return acts;
}

async function executeAction(bot, act, scan) {
  if (!act || !bot?.entity) return false;
  if (bot._digLocked && !/^dig_/.test(act.type)) return false;

  try {
    if (!bot._digLocked) bot.clearControlStates();
  } catch {}

  switch (act.type) {
    case 'walk': {
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(280);
      bot.clearControlStates();
      return true;
    }
    case 'jump_step': {
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      await sleep(200);
      bot.clearControlStates();
      return true;
    }
    case 'jump_gap': {
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(80);
      bot.setControlState('jump', true);
      await sleep(280);
      bot.clearControlStates();
      return true;
    }
    case 'dig_front': {
      const b =
        act.block?.block ||
        bot.blockAt(bot.entity.position.floored().offset(scan.fdx, 0, scan.fdz));
      if (b && isSolid(b) && !isHard(b)) {
        console.log('[NAVTREE] dig_front LOCK', b.name, b.position.x, b.position.y, b.position.z);
        return digHold(bot, b);
      }
      return false;
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
    case 'dig_dir': {
      const { dx, dz, depth = 2 } = act;
      console.log('[NAVTREE] dig_dir', dx, dz, 'depth', depth);
      const origin = bot.entity.position.floored();
      try {
        await bot.look(Math.atan2(-dx, -dz), 0, true);
      } catch {}
      for (let s = 1; s <= depth; s++) {
        for (const oy of [0, 1]) {
          const b = bot.blockAt(origin.offset(dx * s, oy, dz * s));
          if (b && isSolid(b) && !isHard(b)) {
            await digHold(bot, b);
          }
        }
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await sleep(200);
        bot.clearControlStates();
      }
      return true;
    }
    case 'sanitize': {
      console.log('[NAVTREE] SANITIZE corridor');
      const pf = bot.entity.position.floored();
      const order = [];
      for (let y = 1; y <= 3; y++) order.push([0, y, 0]);
      for (const [dx, dz] of [
        [scan.fdx, scan.fdz],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        order.push([dx, 0, dz], [dx, 1, dz]);
      }
      for (const [ox, oy, oz] of order) {
        const b = bot.blockAt(pf.offset(ox, oy, oz));
        if (b && isSolid(b) && !isHard(b)) {
          await digHold(bot, b);
        }
      }
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      await sleep(500);
      bot.clearControlStates();
      return true;
    }
    case 'stair_out': {
      const best = (scan.dirScores || []).sort((a, b) => b.score - a.score)[0] || {
        dx: scan.fdx,
        dz: scan.fdz,
      };
      console.log('[NAVTREE] stair_out', best.dx, best.dz);
      try {
        await bot.look(Math.atan2(-best.dx, -best.dz), 0, true);
      } catch {}
      const origin = bot.entity.position.floored();
      for (let s = 0; s < 4; s++) {
        const body = bot.blockAt(origin.offset(best.dx * (s + 1), s, best.dz * (s + 1)));
        const head = bot.blockAt(origin.offset(best.dx * (s + 1), s + 1, best.dz * (s + 1)));
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
      console.log('[NAVTREE] bridge');
      await placeBridge(bot, act.dx || scan.fdx, act.dz || scan.fdz);
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
    case 'turn_walk': {
      if (bot._digLocked) return false;
      const yaw = Math.atan2(-act.dx, -act.dz);
      try {
        await bot.look(yaw, 0, true);
      } catch {}
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(300);
      bot.clearControlStates();
      return true;
    }
    case 'turn_random': {
      if (bot._digLocked) return false;
      try {
        bot.entity.yaw += (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
        await bot.look(bot.entity.yaw, 0, true);
      } catch {}
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(250);
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

export function startNavTree(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamNavTree) return;
  bot._dreamNavTree = true;

  let busy = false;
  let lastPos = null;
  let stillTicks = 0;
  let lastAction = '';
  let lastLog = 0;

  const tick = async () => {
    if (!bot.entity || busy) return;
    if (bot._dreamPvpActive || bot._escapeBusy || bot._killChatEscaping) return;

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
      if (lastPos && pos.distanceTo(lastPos) < 0.2) stillTicks++;
      else stillTicks = 0;
      lastPos = pos.clone();

      const scan = fullScan(bot, 4, 5, 2);
      if (!scan) return;

      if (stillTicks >= 3 || scan.trapped) {
        const acts = enumerateActions(scan, bot);
        for (const a of acts) {
          if (a.type === 'sanitize' || a.type === 'dig_dir' || a.type === 'dig_up' || a.type === 'stair_out' || a.type === 'dig_front')
            a.score += 100 + stillTicks * 20;
          if (a.type === 'turn_random' || a.type === 'turn_walk') a.score -= 50;
        }
        acts.sort((a, b) => b.score - a.score);
        const best = acts[0];
        if (best) {
          if (Date.now() - lastLog > 3000) {
            console.log(
              '[NAVTREE] still=' +
                stillTicks +
                ' walls=' +
                scan.walls +
                ' → ' +
                best.type +
                ' score=' +
                best.score
            );
            lastLog = Date.now();
          }
          lastAction = best.type;
          await executeAction(bot, best, scan);
          if (/^dig_|sanitize|stair/.test(best.type)) stillTicks = 0;
        }
        return;
      }

      const acts = enumerateActions(scan, bot);
      const best = acts[0];
      if (!best) return;

      if (best.type === lastAction && best.type === 'turn_random' && acts[1]) {
        await executeAction(bot, acts[1], scan);
        lastAction = acts[1].type;
      } else {
        if (Date.now() - lastLog > 5000 && best.score >= 80) {
          console.log('[NAVTREE]', best.type, 'score=' + best.score, 'walls=' + scan.walls);
          lastLog = Date.now();
        }
        lastAction = best.type;
        await executeAction(bot, best, scan);
      }
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

      if (moving && bot.entity.onGround) {
        const scan = fullScan(bot, 2, 2, 1);
        if (scan?.ahead?.[0]?.canStep) {
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
  console.log('[NAVTREE] ON — dig LOCK + no turn mid-break');
}
