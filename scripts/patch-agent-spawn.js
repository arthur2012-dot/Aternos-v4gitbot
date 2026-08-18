/**
 * Craft/mine/bridge self-prompt, no Exiting, stay online.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const SELF_PROMPT =
  'Use tools certo: pickaxe=minerar stone/ore, axe=log, sword=mob, shovel=dirt. Equip tool antes. collectBlocks log/stone/ore. craftRecipe mesa sticks pickaxe. placeBlock dirt/cobble pra BRIDGE e PILLAR se buraco ou subida. smeltItem se furnace. Nunca so caca. Sempre 1-3 !comandos. Nunca exit.';

function patchAgent() {
  const p = join(ROOT, 'src', 'agent', 'agent.js');
  if (!existsSync(p)) {
    console.warn('[patch-agent-spawn] agent.js missing');
    return;
  }
  let src = readFileSync(p, 'utf8');

  src = src.split("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');").join(
    '// DreamBot: no Exiting/Restarting chat'
  );
  src = src.replace(
    /this\.bot\.chat\(\s*code\s*>\s*1\s*\?\s*['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\s*\)\s*;/g,
    '// DreamBot: no Exiting/Restarting chat'
  );
  src = src.replace(/this\.bot\.chat\([^)]*Exiting[^)]*\)\s*;/g, '// DreamBot: blocked Exiting');
  src = src.replace(/this\.bot\.chat\([^)]*Restarting[^)]*\)\s*;/g, '// DreamBot: blocked Restarting');

  if (src.includes('cleanKill(msg=') && !src.includes('DreamBot hard cleanKill')) {
    const cleanKillRe =
      /cleanKill\s*\(\s*msg\s*=\s*['"]Killing agent process\.\.\.['"]\s*,\s*code\s*=\s*1\s*\)\s*\{[\s\S]*?process\.exit\(code\);\s*\}/;
    if (cleanKillRe.test(src)) {
      src = src.replace(
        cleanKillRe,
        `cleanKill(msg='Killing agent process...', code=1) {
        // DreamBot hard cleanKill
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', String(msg)); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|Exiting|not spawned/i.test(String(msg))) {
          console.warn('[DreamBot] soft fail — stay in game');
          try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
              this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
            }
          } catch (_) {}
          return;
        }
        process.exit(code);
    }`
      );
    }
  }

  if (src.includes('Hello world! I am')) {
    src = src.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
      `try {
                if (this.self_prompter && !this.self_prompter.isActive()) {
                    this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                }
            } catch (e) { console.warn('[DreamBot] selfPrompt', e.message); }`
    );
  }

  if (!src.includes('DreamBot backup self-prompt') && /this\.bot\.once\(['"]spawn['"]/.test(src)) {
    src = src.replace(
      /this\.bot\.once\(['"]spawn['"]\s*,\s*async\s*\(\)\s*=>\s*\{/,
      `this.bot.once('spawn', async () => {
            // DreamBot backup self-prompt
            setTimeout(() => {
                try {
                    if (this.self_prompter && !this.self_prompter.isActive()) {
                        this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                    }
                } catch (_) {}
            }, 2000);`
    );
  }

  writeFileSync(p, src);
  console.log('[patch-agent-spawn] agent done');
}

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  src = src.replace(
    /agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)/g,
    'console.warn("[DreamBot] stuck — stay online")'
  );
  src = src.replace(/say\(agent,\s*'I\\'m stuck!'\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*"I'm stuck!"\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*'I\\'m free\.'\);/g, 'console.log("[DreamBot] free");');
  src = src.replace(/say\(agent,\s*"I'm free\."\);/g, 'console.log("[DreamBot] free");');
  writeFileSync(p, src);
  console.log('[patch-agent-spawn] modes done');
}

function patchPathfinder() {
  // Ensure dig/place enabled for bridging when mcdata sets movements
  const p = join(ROOT, 'src', 'utils', 'mcdata.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  if (src.includes('DreamBot movements bridge')) return;
  if (src.includes('new pf.Movements') || src.includes('Movements(bot)')) {
    // soft inject after movements created if pattern exists
    src = src.replace(
      /(const movements = new (?:pf\.)?Movements\(bot\)\s*;)/,
      `$1
    // DreamBot movements bridge
    try {
      movements.canDig = true;
      movements.allow1by1towers = true;
      movements.allowParkour = true;
      movements.allowSprinting = true;
      if (bot.pathfinder) bot.pathfinder.setMovements(movements);
    } catch (_) {}
`
    );
    writeFileSync(p, src);
    console.log('[patch-agent-spawn] pathfinder dig/tower');
  }
}

try {
  patchAgent();
  patchModes();
  patchPathfinder();
  console.log('[patch-agent-spawn] done');
} catch (e) {
  console.warn('[patch-agent-spawn]', e.message);
}
