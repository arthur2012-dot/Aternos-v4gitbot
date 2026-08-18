/**
 * Extra pass: kill any remaining Exiting chat + stuck cleanKill.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function patchFile(rel, fn) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  const next = fn(src);
  if (next !== src) {
    writeFileSync(p, next);
    console.log('[patch-unstuck] updated', rel);
  }
}

try {
  patchFile('src/agent/agent.js', (src) => {
    src = src.split("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');").join(
      '// DreamBot: no Exiting chat'
    );
    src = src.replace(
      /this\.bot\.chat\(\s*code\s*>\s*1\s*\?\s*['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\s*\)\s*;/g,
      '// DreamBot: no Exiting chat'
    );
    // any leftover Exiting. in bot.chat
    src = src.replace(/this\.bot\.chat\([^)]*Exiting[^)]*\)\s*;/g, '// DreamBot: blocked Exiting chat');
    src = src.replace(/this\.bot\.chat\([^)]*Restarting[^)]*\)\s*;/g, '// DreamBot: blocked Restarting chat');
    return src;
  });

  patchFile('src/agent/modes.js', (src) => {
    src = src.replace(
      /agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)/g,
      'console.warn("[DreamBot] stuck — stay")'
    );
    src = src.replace(/say\(agent,\s*['"]I\\?'m stuck!['"]\);/g, 'console.log("[DreamBot] unstuck");');
    src = src.replace(/say\(agent,\s*['"]I\\?'m free\.['"]\);/g, 'console.log("[DreamBot] free");');
    return src;
  });

  console.log('[patch-unstuck] done');
} catch (e) {
  console.warn('[patch-unstuck]', e.message);
}
