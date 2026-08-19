/**
 * Boost passive brain at runtime (prestart) — dig dirt walls, faster ticks,
 * early tools, sprint, no dependency on full file rewrite.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const p = join(ROOT, 'src/agent/passive-skills.js');
if (!existsSync(p)) process.exit(0);

let s = readFileSync(p, 'utf8');
let n = 0;

// Dig dirt/grass in face
if (!s.includes('dirt|grass|sand|gravel|deepslate')) {
  s = s.replace(
    /if \(look && \(\/_log\$\/\.test\(look\.name\) \|\| look\.name === 'stone' \|\| look\.name === 'cobblestone' \|\| \/ore\/\.test\(look\.name\)\)\) \{/,
    `if (look && look.boundingBox === 'block' && (/_log$|stone|cobblestone|ore|dirt|grass|sand|gravel|deepslate|tuff|andesite/.test(look.name || ''))) {`
  );
  n++;
}

// Always try dig-in-face even when not navigating
if (!s.includes('[PASSIVE] dig wall face')) {
  const inject = `
  try {
    const look = bot.blockAtCursor?.(3.5);
    if (look && look.boundingBox === 'block') {
      const n = look.name || '';
      if (/_log$|stone|cobblestone|ore|dirt|grass|sand|gravel|deepslate/.test(n)) {
        console.log('[PASSIVE] dig wall face', n);
        await dig(bot, look);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await sleep(280);
        bot.clearControlStates();
        return;
      }
    }
  } catch {}
`;
  s = s.replace(
    'export async function runPassiveSkillTick(agent) {\n  const bot = agent.bot;\n  if (!bot?.entity || bot._dreamPvpActive) return;\n',
    'export async function runPassiveSkillTick(agent) {\n  const bot = agent.bot;\n  if (!bot?.entity || bot._dreamPvpActive) return;\n' + inject
  );
  n++;
}

s = s.replace('setInterval(tick, 7000);', 'setInterval(tick, 4000);');
s = s.replace('setTimeout(tick, 1500);', 'setTimeout(tick, 800);');
if (s.includes('setInterval(tick, 4000)')) n++;

// Early wooden axe
if (!s.includes("craft(bot, 'wooden_axe'")) {
  s = s.replace(
    "if (planks >= 3 && sticks >= 2 && !anyPick && canTryCraft('wooden_pickaxe'))",
    `if (planks >= 3 && sticks >= 2 && !hasRe(bot, /_axe$/) && canTryCraft('wooden_axe')) {
    if (await craft(bot, 'wooden_axe', 1)) { await equipBest(bot, 'axe'); return; }
  }
  if (planks >= 3 && sticks >= 2 && !anyPick && canTryCraft('wooden_pickaxe'))`
  );
  n++;
}

// Sprint on goto
if (!s.includes("setControlState('sprint', true)")) {
  s = s.replace(
    "if (typeof bot.dreamGoto === 'function') return await bot.dreamGoto(x, y, z, r);",
    `try { bot.setControlState('sprint', true); } catch {}
    if (typeof bot.dreamGoto === 'function') {
      const ok = await bot.dreamGoto(x, y, z, r);
      try { bot.setControlState('sprint', false); } catch {}
      return ok;
    }`
  );
  n++;
}

s = s.replace(
  /console\.log\('\[PASSIVE\] BRAIN ON[^']*'\);/,
  "console.log('[PASSIVE] BRAIN ON — pure code, dig walls, no LLM relembrar');"
);

writeFileSync(p, s);
console.log('[patch-passive-boost] applied', n, 'boosts');
