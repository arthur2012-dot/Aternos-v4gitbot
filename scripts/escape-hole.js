/**
 * Full 3D environment scan + ordered escape from 1-wide stone corridors.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;

const BUILD_RE = /dirt|cobblestone|netherrack|planks|stone$|andesite|granite|diorite|tuff|deepslate|gravel|sand/;
const SOFT_DIG = /dirt|grass|sand|gravel|clay|mud|snow|soul_sand|farmland|podzol|mycelium|rooted|leaves|netherrack|tuff|andesite|granite|diorite|cobblestone|stone$|deepslate|planks|log|wood/;
const HARD = /obsidian|bedrock|barrier|command|structure|end_portal|ancient_debris|crying_obsidian/;

function items(bot) {
  return bot.inventory.items();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isWaterName(n) {
  return n === 'water' || n === 'flowing_water' || (n && String(n).includes('water'));
}

function isAirName(n) {
  return !n || n === 'air' || n === 'cave_air' || n === 'void_air';
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

/** Hand dig of stone needs ~7.5s — allow 20s per try */
async function digHold(bot, block, tries = 5) {
  if (!block || isAirName(block.name)) return false;
  if (HARD.test(block.name || '')) return false;

  const targetPos = block.position.clone();
  const hasPick = items(bot).some((i) => /_pickaxe$/.test(i.name));
  const isStone = /stone|cobble|deepslate|granite|andesite|diorite|tuff/.test(block.name || '');
  const timeout = !hasPick && isStone ? 22000 : 12000;

  for (let t = 0; t < tries; t++) {
    try {
      try { bot.clearControlStates(); } catch {}
      try { bot.pathfinder?.setGoal?.(null); } catch {}
      try { bot.stopDigging(); } catch {}
      await sleep(40);

      const live = bot.blockAt(targetPos);
      if (!live || isAirName(live.name)) return true;

      await equipFor(bot, live);
      await bot.lookAt(live.position.offset(0.5, 0.5, 0.5), true);
      await sleep(50);

      await Promise.race([
        bot.dig(live, true),
        new Promise((_, rej) => setTimeout(() => rej(new Error('dig-timeout')), timeout)),
      ]);

      const after = bot.blockAt(targetPos);
      if (!after || isAirName(after.name)) return true;
    } catch {
      try { bot.stopDigging(); } catch {}
      await sleep(100);
    }
  }
  return false;
}

async function placePillar(bot) {
  const build = items(bot).find((i) => BUILD_RE.test(i.name));
  if (!build) return false;
  try {
    await bot.equip(build, 'hand');
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ref || ref.boundingBox !== 'block') return false;
    bot.setControlState('jump', true);
    await sleep(120);
    try {
      await bot.placeBlock(ref, new Vec3(0, 1, 0));
    } catch {
      const under = bot.blockAt(bot.entity.position.offset(0, -0.5, 0));
      if (under && under.boundingBox === 'block') {
        try { await bot.placeBlock(under, new Vec3(0, 1, 0)); } catch {}
      }
    }
    bot.setControlState('jump', false);
    await sleep(80);
    return true;
  } catch {
    bot.setControlState('jump', false);
    return false;
  }
}

export function scanEnvironment(bot, radius = 4, heightUp = 6, heightDown = 2) {
  const origin = bot.entity.position.floored();
  const cells = [];
  let solid = 0, air = 0, soft = 0, water = 0;
  let skyOpen = false;

  for (let y = -heightDown; y <= heightUp; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const pos = origin.offset(x, y, z);
        const b = bot.blockAt(pos);
        const name = b?.name || 'air';
        let kind = 'air';
        if (isWaterName(name)) { kind = 'water'; water++; }
        else if (isAirName(name)) { kind = 'air'; air++; }
        else if (HARD.test(name)) { kind = 'hard'; solid++; }
        else if (b && b.boundingBox === 'block') {
          if (SOFT_DIG.test(name) || !HARD.test(name)) { kind = 'soft'; soft++; }
          else { kind = 'solid'; solid++; }
        } else { kind = 'air'; air++; }
        cells.push({ x, y, z, abs: pos, name, kind });
      }
    }
  }

  for (let y = 2; y <= 12; y++) {
    const b = bot.blockAt(origin.offset(0, y, 0));
    if (!b || isAirName(b.name)) {
      if (y >= 5) skyOpen = true;
    } else break;
  }

  let walls = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = bot.blockAt(origin.offset(dx, 0, dz));
    if (b && b.boundingBox === 'block') walls++;
  }

  const head = bot.blockAt(origin.offset(0, 1, 0));
  const headBlocked = head && head.boundingBox === 'block';

  return { origin, cells, solid, soft, air, water, skyOpen, walls, headBlocked, wet: isWet(bot) };
}

function planEscape(scan) {
  const plans = [];

  if (scan.skyOpen || scan.headBlocked) {
    plans.push({ type: 'up_column', score: scan.skyOpen ? 90 : 70, dir: { dx: 0, dz: 0 } });
  }

  const dirs = [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }];
  for (const d of dirs) {
    let softCount = 0, airAhead = 0, depth = 0;
    for (let step = 1; step <= 4; step++) {
      const body = scan.cells.find((c) => c.x === d.dx * step && c.y === 0 && c.z === d.dz * step);
      const head = scan.cells.find((c) => c.x === d.dx * step && c.y === 1 && c.z === d.dz * step);
      if (!body) continue;
      if (body.kind === 'air') airAhead++;
      if (body.kind === 'soft') softCount++;
      if (body.kind === 'hard') break;
      if (head && head.kind === 'soft') softCount++;
      if (head && head.kind === 'air') airAhead++;
      depth = step;
    }
    if (softCount > 0 || airAhead > 0) {
      plans.push({
        type: 'dig_dir',
        score: 40 + softCount * 12 + airAhead * 15 + depth * 5,
        dir: d,
        depth: Math.max(depth, 2),
      });
    }
  }

  for (const d of dirs) {
    let stairSoft = 0;
    for (let step = 1; step <= 3; step++) {
      for (let h = 0; h <= step; h++) {
        const c = scan.cells.find(
          (cell) => cell.x === d.dx * step && cell.y === h && cell.z === d.dz * step
        );
        if (c && c.kind === 'soft') stairSoft++;
        if (c && c.kind === 'air' && h >= 1) stairSoft += 2;
      }
    }
    if (stairSoft > 0) {
      plans.push({ type: 'stair_out', score: 50 + stairSoft * 8, dir: d });
    }
  }

  if (scan.walls >= 2) {
    plans.push({ type: 'pillar', score: 55 + scan.walls * 5, dir: { dx: 0, dz: 0 } });
    // force dig_dir even if all stone
    for (const d of dirs) {
      plans.push({ type: 'dig_dir', score: 45, dir: d, depth: 3 });
    }
  }

  if (scan.wet || scan.water > 3) {
    plans.push({ type: 'up_column', score: 95, dir: { dx: 0, dz: 0 } });
  }

  plans.sort((a, b) => b.score - a.score);
  return plans[0] || { type: 'up_column', score: 10, dir: { dx: 0, dz: 0 } };
}

async function digStaircase(bot, dx, dz, steps = 4) {
  const origin = bot.entity.position.floored();
  console.log('[ESCAPE] staircase', dx, dz, 'steps', steps);

  for (let s = 0; s < steps; s++) {
    const bodyPos = origin.offset(dx * (s + 1), s, dz * (s + 1));
    const headPos = origin.offset(dx * (s + 1), s + 1, dz * (s + 1));
    const ceilPos = origin.offset(0, s + 2, 0);

    for (const pos of [bodyPos, headPos, ceilPos]) {
      const b = bot.blockAt(pos);
      if (b && !isAirName(b.name) && !HARD.test(b.name || '')) {
        console.log('[ESCAPE] dig ordered', b.name);
        await digHold(bot, b);
      }
    }

    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    if (s > 0) bot.setControlState('jump', true);
    await sleep(280);
    bot.clearControlStates();
    await sleep(60);
  }
  return true;
}

async function digUpColumn(bot) {
  const origin = bot.entity.position.floored();
  console.log('[ESCAPE] up column');

  for (let y = 1; y <= 5; y++) {
    const pos = origin.offset(0, y, 0);
    const b = bot.blockAt(pos);
    if (b && !isAirName(b.name) && !HARD.test(b.name || '')) {
      console.log('[ESCAPE] dig up', b.name, 'y+' + y);
      await digHold(bot, b);
    }
  }

  for (let i = 0; i < 3; i++) {
    const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
    if (head && head.boundingBox === 'block') await digHold(bot, head);
    const above2 = bot.blockAt(bot.entity.position.offset(0, 2, 0));
    if (above2 && above2.boundingBox === 'block') await digHold(bot, above2);
    await placePillar(bot);
    bot.setControlState('jump', true);
    await sleep(200);
    bot.setControlState('jump', false);
  }

  const scan = scanEnvironment(bot, 3, 4, 1);
  const plan = planEscape(scan);
  if (plan.dir && (plan.dir.dx || plan.dir.dz)) {
    await digStaircase(bot, plan.dir.dx, plan.dir.dz, 3);
  } else {
    await digStaircase(bot, 0, -1, 3);
  }
  return true;
}

async function digDirection(bot, dx, dz, depth = 3) {
  console.log('[ESCAPE] dig dir', dx, dz, 'depth', depth);
  const origin = bot.entity.position.floored();

  for (let s = 1; s <= depth; s++) {
    const body = bot.blockAt(origin.offset(dx * s, 0, dz * s));
    const head = bot.blockAt(origin.offset(dx * s, 1, dz * s));
    if (body && !isAirName(body.name) && !HARD.test(body.name || '')) {
      console.log('[ESCAPE] dig wall face', body.name);
      await digHold(bot, body);
    }
    if (head && !isAirName(head.name) && !HARD.test(head.name || '')) {
      await digHold(bot, head);
    }
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    await sleep(250);
    bot.clearControlStates();
  }

  const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
  if (head && head.boundingBox === 'block') await digHold(bot, head);
  await digStaircase(bot, dx, dz, 2);
  return true;
}

export async function escapeHole(bot) {
  if (!bot?.entity) return false;
  if (bot._escapeBusy) return false;
  bot._escapeBusy = true;

  try {
    const scan = scanEnvironment(bot, 4, 6, 2);
    const trapped =
      scan.walls >= 2 ||
      scan.headBlocked ||
      scan.wet ||
      scan.water > 2 ||
      (scan.solid > 40 && scan.air < 30);

    if (!trapped && !scan.wet) return false;

    console.log(
      '[ESCAPE] scan walls=' + scan.walls +
        ' soft=' + scan.soft +
        ' solid=' + scan.solid +
        ' air=' + scan.air +
        ' wet=' + scan.wet +
        ' sky=' + scan.skyOpen +
        ' head=' + scan.headBlocked
    );

    const plan = planEscape(scan);
    console.log('[ESCAPE] plan', plan.type, 'score=' + plan.score);

    try {
      bot.clearControlStates();
      bot.pathfinder?.setGoal?.(null);
    } catch {}

    if (plan.type === 'up_column' || plan.type === 'pillar') {
      if (plan.type === 'pillar') {
        for (let i = 0; i < 4; i++) {
          const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
          if (head && head.boundingBox === 'block') await digHold(bot, head);
          await placePillar(bot);
          bot.setControlState('jump', true);
          await sleep(220);
          bot.setControlState('jump', false);
          await sleep(80);
        }
      }
      await digUpColumn(bot);
      return true;
    }

    if (plan.type === 'dig_dir' || plan.type === 'stair_out') {
      const { dx, dz } = plan.dir || { dx: 0, dz: -1 };
      if (plan.type === 'stair_out') {
        await digStaircase(bot, dx, dz, 4);
      } else {
        await digDirection(bot, dx, dz, plan.depth || 3);
      }
      return true;
    }

    const look = bot.blockAtCursor?.(5);
    if (look && look.boundingBox === 'block' && !HARD.test(look.name || '')) {
      console.log('[ESCAPE] dig face fallback', look.name);
      await digHold(bot, look);
    }
    await digUpColumn(bot);
    return true;
  } catch (e) {
    console.warn('[ESCAPE]', (e.message || '').slice(0, 50));
    return false;
  } finally {
    bot._escapeBusy = false;
  }
}

export async function dryFeet(bot) {
  if (!bot?.entity) return false;
  if (!isWet(bot)) return false;

  console.log('[ESCAPE] dryFeet — water escape');
  try { bot.clearControlStates(); } catch {}

  bot.setControlState('jump', true);
  bot.setControlState('sprint', true);

  for (let i = 0; i < 8; i++) {
    const above = bot.blockAt(bot.entity.position.offset(0, 1, 0));
    const above2 = bot.blockAt(bot.entity.position.offset(0, 2, 0));
    if (above && !isAirName(above.name) && !isWaterName(above.name) && !HARD.test(above.name || '')) {
      bot.setControlState('jump', false);
      await digHold(bot, above);
      bot.setControlState('jump', true);
    }
    if (above2 && !isAirName(above2.name) && !isWaterName(above2.name) && !HARD.test(above2.name || '')) {
      bot.setControlState('jump', false);
      await digHold(bot, above2);
      bot.setControlState('jump', true);
    }
    await sleep(200);
    if (!isWet(bot)) break;
  }

  bot.clearControlStates();

  for (let i = 0; i < 5 && isWet(bot); i++) {
    await placePillar(bot);
    bot.setControlState('jump', true);
    await sleep(250);
    bot.setControlState('jump', false);
  }

  if (isWet(bot) || scanEnvironment(bot, 2, 3, 1).walls >= 2) {
    await escapeHole(bot);
  }
  return true;
}

export function isTrapped(bot) {
  if (!bot?.entity) return false;
  const s = scanEnvironment(bot, 3, 4, 1);
  return s.walls >= 2 || s.headBlocked || s.wet || (s.solid > 35 && s.air < 25);
}
