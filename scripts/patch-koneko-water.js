/**
 * Ensure koneko-behaviors (player-like water escape) is loaded into src/
 */
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const src = join(ROOT, 'scripts/koneko-behaviors.js');
const dst = join(ROOT, 'src/agent/koneko-behaviors.js');

if (!existsSync(src)) {
  console.log('[patch-koneko] no scripts/koneko-behaviors.js');
  process.exit(0);
}

mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log('[patch-koneko] installed player-like water escape → src/agent/koneko-behaviors.js');
