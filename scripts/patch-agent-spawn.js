/**
 * Stay in game, craft-first self-prompt, no Hello/Exiting, soft unstuck.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const SELF_PROMPT =
  'Prioridade: collectBlocks log, craftRecipe crafting_table, stick, wooden_pickaxe, wooden_axe. Depois stone tools, explore, mine. So caca se fome e sem comida. Nunca so mate mob. Sempre uma acao !comando. Nunca diga bot. Nunca saia do server.';

function patchAgent() {
  const p = join(ROOT, 'src', 'agent', 'agent.js');
  if (!existsSync(p)) {
    console.warn('[patch-agent-spawn] agent.js missing');
    return;
  }
  let src = readFileSync(p, 'utf8');

  if (src.includes('Hello world! I am')) {
    src = src.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
      `// DreamBot: silent spawn + craft loop
            try {
                if (this.self_prompter && !this.self_prompter.isActive()) {
                    this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                }
            } catch (e) { console.warn('[DreamBot] selfPrompt start failed', e.message); }`
    );
    console.log('[patch-agent-spawn] removed Hello world');
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
            }, 2500);`
    );
    console.log('[patch-agent-spawn] backup self-prompt');
  }

  // Never chat Exiting/Restarting
  src = src.replace(
    /this\.bot\.chat\(code > 1 \? ['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\);/g,
    '// DreamBot: silent exit chat'
  );

  // soft cleanKill: log only if already not patched
  if (!src.includes('DreamBot stay online cleanKill') && src.includes('cleanKill')) {
    src = src.replace(
      /cleanKill\s*\(\s*msg\s*=\s*['"][^'"]*['"]\s*,\s*code\s*=\s*1\s*\)\s*\{([\s\S]*?)process\.exit\(code\);\s*\}/,
      `cleanKill(msg='Killing agent process...', code=1) {
        // DreamBot stay online cleanKill: prefer not to exit on soft stuck
        console.warn('[DreamBot] cleanKill requested:', msg, code);
        try { this.history.add('system', msg); this.history.save(); } catch (_) {}
        if (/stuck|couldn't get unstuck|Got stuck/i.test(String(msg))) {
          console.warn('[DreamBot] ignoring stuck cleanKill — stay in game');
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
    if (src.includes('DreamBot stay online cleanKill') || src.includes('ignoring stuck cleanKill')) {
      console.log('[patch-agent-spawn] stay-online cleanKill');
    }
  }

  writeFileSync(p, src);
}

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');

  // Never kill process on stuck
  src = src.replace(
    /setTimeout\(\s*\(\)\s*=>\s*\{\s*agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)\s*\}\s*,\s*\d+\s*\)/g,
    'setTimeout(() => { console.warn("[DreamBot] still stuck, stay online and retry"); }, 12000)'
  );
  src = src.replace(/say\(agent,\s*['"]I'm stuck!['"]\);/g, 'console.log("[DreamBot] unstuck triggered");');
  src = src.replace(/say\(agent,\s*['"]I'm free\.['"]\);/g, 'console.log("[DreamBot] unstuck move done");');

  writeFileSync(p, src);
  console.log('[patch-agent-spawn] modes unstuck stay online');
}

try {
  patchAgent();
  patchModes();
  console.log('[patch-agent-spawn] done');
} catch (e) {
  console.warn('[patch-agent-spawn]', e.message);
}
