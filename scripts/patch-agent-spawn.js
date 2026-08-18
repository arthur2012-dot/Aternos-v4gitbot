/**
 * Hard-silence Exiting/Restarting in chat; stay online on stuck; self-prompt craft.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const SELF_PROMPT =
  'Prioridade: collectBlocks log, craftRecipe crafting_table stick wooden_pickaxe. Depois stone tools explore. So caca se fome. Sempre !comando. Nunca diga bot. Nunca saia.';

function patchAgent() {
  const p = join(ROOT, 'src', 'agent', 'agent.js');
  if (!existsSync(p)) {
    console.warn('[patch-agent-spawn] agent.js missing');
    return;
  }
  let src = readFileSync(p, 'utf8');
  let changed = false;

  // 1) THE actual Exiting line in cleanKill (exact mindcraft source)
  if (src.includes("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.')")) {
    src = src.split("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');").join(
      "// DreamBot: silenced Exiting/Restarting chat"
    );
    changed = true;
    console.log('[patch-agent-spawn] silenced exact Exiting line');
  }
  // variants with spaces / double quotes
  src = src.replace(/this\.bot\.chat\(\s*code\s*>\s*1\s*\?\s*['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\s*\)\s*;/g, () => {
    changed = true;
    return '// DreamBot: silenced Exiting/Restarting chat';
  });

  // 2) Replace entire cleanKill to never chat and ignore stuck exits
  if (src.includes('cleanKill(msg=') && !src.includes('DreamBot hard cleanKill')) {
    const cleanKillRe =
      /cleanKill\s*\(\s*msg\s*=\s*['"]Killing agent process\.\.\.['"]\s*,\s*code\s*=\s*1\s*\)\s*\{[\s\S]*?process\.exit\(code\);\s*\}/;
    if (cleanKillRe.test(src)) {
      src = src.replace(
        cleanKillRe,
        `cleanKill(msg='Killing agent process...', code=1) {
        // DreamBot hard cleanKill: never spam chat; stay online on stuck
        console.warn('[DreamBot] cleanKill:', msg, 'code', code);
        try { this.history.add('system', String(msg)); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|Exiting/i.test(String(msg))) {
          console.warn('[DreamBot] ignoring stuck/exit cleanKill — stay in game');
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
      changed = true;
      console.log('[patch-agent-spawn] replaced cleanKill body');
    }
  }

  // 3) Hello world
  if (src.includes('Hello world! I am')) {
    src = src.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
      `try {
                if (this.self_prompter && !this.self_prompter.isActive()) {
                    this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                }
            } catch (e) { console.warn('[DreamBot] selfPrompt', e.message); }`
    );
    changed = true;
  }

  // 4) backup self-prompt on spawn
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
            }, 2500);`
    );
    changed = true;
  }

  if (changed) writeFileSync(p, src);
  console.log('[patch-agent-spawn] agent done');
}

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');

  // exact stuck cleanKill
  src = src.split('agent.cleanKill("Got stuck and couldn\'t get unstuck")').join(
    'console.warn("[DreamBot] stuck timeout — stay online")'
  );
  src = src.split("agent.cleanKill('Got stuck and couldn't get unstuck')").join(
    'console.warn("[DreamBot] stuck timeout — stay online")'
  );
  src = src.replace(
    /agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)/g,
    'console.warn("[DreamBot] stuck timeout — stay online")'
  );

  // don't say I'm stuck / I'm free in chat
  src = src.replace(/say\(agent,\s*'I\\'m stuck!'\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*"I'm stuck!"\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*'I\\'m free\.'\);/g, 'console.log("[DreamBot] free");');
  src = src.replace(/say\(agent,\s*"I'm free\."\);/g, 'console.log("[DreamBot] free");');

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
