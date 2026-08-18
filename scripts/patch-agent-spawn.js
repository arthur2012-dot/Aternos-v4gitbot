/**
 * Remove Hello world on spawn, start selfPrompt, silence Exiting, soft unstuck.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

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
      `// DreamBot: no Hello world — start survival self-prompt
            try {
                if (this.self_prompter && !this.self_prompter.isActive()) {
                    this.self_prompter.start('Survive like a human: wood tools food explore mine. Pillar or bridge if stuck. Always next !command. Never say you are a bot.');
                }
            } catch (e) { console.warn('[DreamBot] selfPrompt start failed', e.message); }`
    );
    console.log('[patch-agent-spawn] removed Hello world');
  }

  if (/this\.bot\.chat\(code > 1 \? ['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\)/.test(src)) {
    src = src.replace(
      /this\.bot\.chat\(code > 1 \? ['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\);/g,
      '// DreamBot: silent exit chat'
    );
    console.log('[patch-agent-spawn] silenced Exiting');
  }

  writeFileSync(p, src);
}

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  if (src.includes("Got stuck and couldn't get unstuck")) {
    src = src.replace(
      /setTimeout\(\s*\(\)\s*=>\s*\{\s*agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)\s*\}\s*,\s*\d+\s*\)/g,
      'setTimeout(() => { console.warn("[DreamBot] still stuck, retry later"); }, 15000)'
    );
    src = src.replace(/say\(agent,\s*['"]I'm stuck!['"]\);/g, 'console.log("[DreamBot] unstuck triggered");');
    src = src.replace(/say\(agent,\s*['"]I'm free\.['"]\);/g, 'console.log("[DreamBot] unstuck move done");');
    writeFileSync(p, src);
    console.log('[patch-agent-spawn] unstuck no cleanKill');
  }
}

try {
  patchAgent();
  patchModes();
  console.log('[patch-agent-spawn] done');
} catch (e) {
  console.warn('[patch-agent-spawn]', e.message);
}
