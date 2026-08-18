/**
 * DreamBot: unstuck must NEVER call cleanKill (that causes "Exiting." and leave game).
 * Also softens agent.cleanKill chat spam.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) {
    console.warn('[patch-unstuck] modes.js missing');
    return;
  }
  let src = readFileSync(p, 'utf8');
  if (src.includes('DreamBot unstuck soft')) {
    console.log('[patch-unstuck] modes already patched');
    return;
  }

  // Replace the cleanKill timeout block inside unstuck
  const bad = /const crashTimeout = setTimeout\(\s*\(\)\s*=>\s*\{\s*agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)\s*\}\s*,\s*10000\s*\);\s*await skills\.moveAway\(bot,\s*5\);\s*clearTimeout\(crashTimeout\);\s*say\(agent,\s*["']I'm free\.["']\);/s;

  const good = `// DreamBot unstuck soft: never kill process
                    try {
                        bot.pathfinder && bot.pathfinder.stop && bot.pathfinder.stop();
                        bot.clearControlStates && bot.clearControlStates();
                        // dig block above head if buried / in 1-deep hole ceiling
                        try {
                            const above = bot.blockAt(bot.entity.position.offset(0, 1, 0));
                            if (above && above.name !== 'air' && above.name !== 'cave_air' && above.name !== 'void_air') {
                                await bot.dig(above).catch(() => {});
                            }
                        } catch (_) {}
                        // jump out of 1-block dips
                        bot.setControlState('jump', true);
                        await new Promise(r => setTimeout(r, 400));
                        bot.setControlState('jump', false);
                        bot.setControlState('forward', true);
                        await new Promise(r => setTimeout(r, 500));
                        bot.setControlState('forward', false);
                        if (skills && skills.moveAway) {
                            await skills.moveAway(bot, 5).catch(() => {});
                        }
                    } catch (e) {
                        console.warn('[DreamBot] unstuck recovery failed:', e.message || e);
                    }`;

  if (bad.test(src)) {
    src = src.replace(bad, good);
    writeFileSync(p, src);
    console.log('[patch-unstuck] replaced cleanKill unstuck path');
    return;
  }

  // Fallback: strip any cleanKill related to stuck
  if (src.includes("Got stuck and couldn't get unstuck")) {
    src = src.replace(
      /setTimeout\(\s*\(\)\s*=>\s*\{\s*agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)\s*\}\s*,\s*\d+\s*\)/g,
      'setTimeout(() => { console.warn("[DreamBot] still stuck, will retry later"); }, 10000)'
    );
    writeFileSync(p, src);
    console.log('[patch-unstuck] stripped stuck cleanKill');
  } else {
    console.warn('[patch-unstuck] unstuck pattern not found, manual note left');
  }
}

function patchAgent() {
  const p = join(ROOT, 'src', 'agent', 'agent.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  if (src.includes('DreamBot silent cleanKill')) return;

  src = src.replace(
    /cleanKill\(msg\s*=\s*['"]Killing agent process\.\.\.['"]\s*,\s*code\s*=\s*1\)\s*\{[^}]*process\.exit\(code\);\s*\}/s,
    `cleanKill(msg='Killing agent process...', code=1) {
        // DreamBot silent cleanKill: do not spam chat with Exiting.
        console.warn('[DreamBot] cleanKill:', msg, 'code', code);
        try { this.history.add('system', msg); this.history.save(); } catch (_) {}
        process.exit(code);
    }`
  );

  // Reduce max stuck sensitivity by commenting say I'm stuck if still present in agent - skip

  writeFileSync(p, src);
  console.log('[patch-unstuck] agent cleanKill silenced');
}

try {
  patchModes();
  patchAgent();
  console.log('[patch-unstuck] done');
} catch (e) {
  console.warn('[patch-unstuck] error:', e.message);
}
