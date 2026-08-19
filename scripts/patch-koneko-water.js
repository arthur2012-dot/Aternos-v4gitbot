/**
 * Patch koneko: aggressive water escape + never attack players as mobs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const p = join(ROOT, 'src/agent/koneko-behaviors.js');
if (!existsSync(p)) process.exit(0);

let s = readFileSync(p, 'utf8');

if (!s.includes("e.type === 'player'")) {
  s = s.replace(
    "const mob = bot.nearestEntity(e => {\n        if (!e || e === bot.entity) return false;",
    "const mob = bot.nearestEntity(e => {\n        if (!e || e === bot.entity) return false;\n        if (e.type === 'player') return false;"
  );
}

const weak = `  // --- Dive / surface (Koneko DiveState) ---
  setInterval(() => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      const block = bot.blockAt(bot.entity.position);
      const inWater = block && /water/.test(block.name || '');
      if (!inWater) return;
      // surface if oxygen low
      if (bot.oxygenLevel != null && bot.oxygenLevel < 10) {
        bot.setControlState('jump', true); // swim up
        setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 400);
      }
    } catch {}
  }, 600);`;

const strong = `  // --- Water / current escape ---
  let waterStuck = 0;
  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      const block = bot.blockAt(bot.entity.position);
      const below = bot.blockAt(bot.entity.position.offset(0, -0.4, 0));
      const inWater =
        bot.entity.isInWater ||
        (block && /water/.test(block.name || '')) ||
        (below && /water/.test(below.name || ''));
      if (!inWater) { waterStuck = 0; return; }
      waterStuck++;
      bot.setControlState('jump', true);
      bot.setControlState('sprint', true);
      bot.setControlState('forward', true);
      let shore = null;
      const origin = bot.entity.position;
      for (let r = 2; r <= 10 && !shore; r++) {
        for (let dx = -r; dx <= r && !shore; dx++) {
          for (let dz = -r; dz <= r && !shore; dz++) {
            if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
            const under = bot.blockAt(origin.offset(dx, -1, dz));
            if (under && under.boundingBox === 'block' && under.name !== 'water' && under.name !== 'lava') {
              shore = origin.offset(dx, 0, dz);
            }
          }
        }
      }
      if (shore) { try { await bot.lookAt(shore.offset(0, 1, 0), true); } catch {} }
      if (waterStuck >= 3) {
        for (const oy of [1, 2]) {
          const up = bot.blockAt(bot.entity.position.offset(0, oy, 0));
          if (up && up.boundingBox === 'block' && !/bedrock|barrier/.test(up.name || '')) {
            try {
              await bot.lookAt(up.position.offset(0.5, 0.5, 0.5), true);
              await bot.dig(up);
              console.log('[KONEKO] dig water ceiling');
            } catch { try { bot.stopDigging(); } catch {} }
            break;
          }
        }
      }
      if (waterStuck >= 6) {
        try {
          const { placeUnderFeet } = await import('./dig-place.js');
          await placeUnderFeet(bot);
        } catch {}
        waterStuck = 0;
      }
      setTimeout(() => {
        try {
          if (!bot.entity?.isInWater) bot.clearControlStates();
        } catch {}
      }, 450);
    } catch {}
  }, 500);`;

if (s.includes('Dive / surface') && !s.includes('waterStuck')) {
  s = s.replace(weak, strong);
  console.log('[patch-koneko] water escape strong');
} else if (s.includes('waterStuck')) {
  console.log('[patch-koneko] already strong');
} else {
  console.log('[patch-koneko] pattern miss');
}

s = s.replace(
  "console.log('[KONEKO] behaviors ON — mob pvp, swim, fire→water, sleep');",
  "console.log('[KONEKO] behaviors ON — mobs only, water escape, fire, sleep');"
);

writeFileSync(p, s);
console.log('[patch-koneko] done');
