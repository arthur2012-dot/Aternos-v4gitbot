/**
 * On Railway/npm install: clone official mindcraft and merge, keeping our DreamBot overlays.
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TMP = '/tmp/mindcraft-base';
const NEEDLE = join(ROOT, 'src', 'agent', 'library', 'skills.js');

if (existsSync(NEEDLE)) {
  console.log('[fetch-base] Mindcraft sources already present, skip clone.');
  process.exit(0);
}

console.log('[fetch-base] Cloning mindcraft-bots/mindcraft...');
try {
  rmSync(TMP, { recursive: true, force: true });
  execSync(`git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git ${TMP}`, {
    stdio: 'inherit',
  });
} catch (e) {
  console.error('[fetch-base] clone failed', e.message);
  process.exit(1);
}

const parts = ['src', 'profiles', 'bots'];
for (const part of parts) {
  const from = join(TMP, part);
  const to = join(ROOT, part);
  if (!existsSync(from)) continue;
  console.log('[fetch-base] merging', part);
  mkdirSync(to, { recursive: true });
  execSync(`cp -rn ${from}/. ${to}/ 2>/dev/null || true`, { shell: true });
}

if (!existsSync(join(ROOT, 'main.js'))) {
  cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
}

console.log('[fetch-base] Done. DreamBot overlays preserved.');
