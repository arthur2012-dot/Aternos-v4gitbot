/**
 * Manhunt-style: fast gear self-prompt, mobility, no Exiting.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const SELF_PROMPT =
  'Manhunt speedrun survival: 1 collect log 2 craft table stick wooden_pickaxe axe sword 3 stone tools furnace torch 4 placeBlock shelter 4x4 + rememberHere base 5 iron ore smelt. Bridge/pillar with placeBlock se gap. NAO idle. NAO so kill mob. equip tool certa. 2-4 !comandos agora.';

function patchAgent() {
  const p = join(ROOT, 'src', 'agent', 'agent.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');

  src = src.split("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');").join('// DreamBot: no Exiting');
  src = src.replace(
    /this\.bot\.chat\(\s*code\s*>\s*1\s*\?\s*['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\s*\)\s*;/g,
    '// DreamBot: no Exiting'
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
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', String(msg)); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|Exiting|not spawned/i.test(String(msg))) {
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

  const injectSelf = `try {
                if (this.self_prompter && !this.self_prompter.isActive()) {
                    this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                }
            } catch (e) {}
            setInterval(() => {
                try {
                    if (this.self_prompter && !this.self_prompter.isActive() && this.isIdle && this.isIdle()) {
                        this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                    }
                } catch (_) {}
            }, 35000);`;

  if (src.includes('Hello world! I am')) {
    src = src.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
      injectSelf
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
            }, 1500);
            setInterval(() => {
                try {
                    if (this.self_prompter && !this.self_prompter.isActive() && this.isIdle && this.isIdle()) {
                        this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                    }
                } catch (_) {}
            }, 35000);`
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
    'console.warn("[DreamBot] stuck — stay")'
  );
  src = src.replace(/say\(agent,\s*'I\\'m stuck!'\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*"I'm stuck!"\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*'I\\'m free\.'\);/g, 'console.log("[DreamBot] free");');
  src = src.replace(/say\(agent,\s*"I'm free\."\);/g, 'console.log("[DreamBot] free");');

  // Try inject place on unstuck moveAway
  if (src.includes('await skills.moveAway(bot, 5)') && !src.includes('DreamBot unstuck place')) {
    src = src.replace(
      'await skills.moveAway(bot, 5)',
      `// DreamBot unstuck place
                    try {
                        const inv = bot.inventory.items();
                        const blockItem = inv.find(i =>
                            /dirt|cobble|plank|netherrack|stone|log|dirt/.test(i.name)
                        );
                        if (blockItem) {
                            await bot.equip(blockItem, 'hand').catch(() => {});
                            const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
                            if (below) await bot.placeBlock(below, { x: 0, y: 1, z: 0 }).catch(() => {});
                        }
                        bot.setControlState('jump', true);
                        await new Promise(r => setTimeout(r, 280));
                        bot.setControlState('jump', false);
                    } catch (_) {}
                    await skills.moveAway(bot, 5)`
    );
  }

  writeFileSync(p, src);
  console.log('[patch-agent-spawn] modes done');
}

try {
  patchAgent();
  patchModes();
  console.log('[patch-agent-spawn] done');
} catch (e) {
  console.warn('[patch-agent-spawn]', e.message);
}
