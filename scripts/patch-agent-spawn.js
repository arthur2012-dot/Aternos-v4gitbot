/**
 * Self-prompt movement, no Exiting, soft stuck. Re-apply safe modes fixes after restore.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const SELF_PROMPT =
  'SEMPRE se mexa com sprint. collectBlocks log/stone, craft tools, placeBlock se gap, goToNearestBlock ou goToSurface se parado. equip tool. NAO idle. NAO so attack. 2-4 !comandos.';

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

  // Idle movement: sprint walk if standing still (works passive-ish without modes inject)
  if (!src.includes('DreamBot idle sprint walker') && /this\.bot\.once\(['"]spawn['"]/.test(src)) {
    src = src.replace(
      /this\.bot\.once\(['"]spawn['"]\s*,\s*async\s*\(\)\s*=>\s*\{/,
      `this.bot.once('spawn', async () => {
            // DreamBot idle sprint walker
            setInterval(() => {
                try {
                    const bot = this.bot;
                    if (!bot || !bot.entity) return;
                    if (this.actions && this.actions.executing) return;
                    if (bot.lastDamageTime && Date.now() - bot.lastDamageTime < 5000) return;
                    const v = bot.entity.velocity;
                    const moving = v && (Math.abs(v.x) + Math.abs(v.z) > 0.05);
                    if (moving) return;
                    bot.setControlState('sprint', true);
                    bot.setControlState('forward', true);
                    setTimeout(() => {
                        try {
                            bot.setControlState('forward', false);
                            bot.setControlState('sprint', false);
                        } catch (_) {}
                    }, 900);
                } catch (_) {}
            }, 14000);`
    );
  }

  if (src.includes('Hello world! I am')) {
    src = src.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
      `try {
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
            }, 30000);`
    );
  }

  if (!src.includes('DreamBot backup self-prompt') && /this\.bot\.once\(['"]spawn['"]/.test(src)) {
    // may already have been partially replaced by idle walker
    if (!src.includes('DreamBot backup self-prompt')) {
      src = src.replace(
        /\/\/ DreamBot idle sprint walker/,
        `// DreamBot backup self-prompt
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
            }, 30000);
            // DreamBot idle sprint walker`
      );
    }
  }

  writeFileSync(p, src);
  console.log('[patch-agent-spawn] agent done');
}

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  // never inject new objects — only string replacements
  src = src.replace(
    /agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)/g,
    'console.warn("[DreamBot] stuck — stay")'
  );
  src = src.replace(/say\(agent,\s*'I\\'m stuck!'\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*"I'm stuck!"\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*'I\\'m free\.'\);/g, 'console.log("[DreamBot] free");');
  src = src.replace(/say\(agent,\s*"I'm free\."\);/g, 'console.log("[DreamBot] free");');
  writeFileSync(p, src);
  console.log('[patch-agent-spawn] modes safe fixes');
}

try {
  patchAgent();
  patchModes();
  console.log('[patch-agent-spawn] done');
} catch (e) {
  console.warn('[patch-agent-spawn]', e.message);
}
