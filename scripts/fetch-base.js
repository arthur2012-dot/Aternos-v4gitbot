/**
 * Clone official mindcraft, apply DreamBot patches.
 * Never hard-crash the whole npm install.
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TMP = join(ROOT, '.mindcraft-base');
const NEEDLE = join(ROOT, 'src', 'agent', 'library', 'skills.js');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
}

try {
  if (!existsSync(NEEDLE)) {
    console.log('[fetch-base] Cloning mindcraft-bots/mindcraft...');
    try {
      rmSync(TMP, { recursive: true, force: true });
      run(`git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "${TMP}"`);
    } catch (e) {
      console.error('[fetch-base] git clone failed:', e.message);
      console.error('[fetch-base] Make sure git is installed in the build image.');
      process.exit(0); // soft fail on install; prestart will try again
    }

    for (const part of ['src', 'profiles', 'bots']) {
      const from = join(TMP, part);
      const to = join(ROOT, part);
      if (!existsSync(from)) continue;
      console.log('[fetch-base] copying', part);
      mkdirSync(to, { recursive: true });
      try {
        run(`cp -rn "${from}/." "${to}/" 2>/dev/null || true`);
      } catch (_) {}
    }

    if (!existsSync(join(ROOT, 'main.js'))) {
      cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
    }
  } else {
    console.log('[fetch-base] Base sources already present.');
  }

  const patchDir = join(ROOT, 'patches');
  const patches = ['agent.js.patch', 'modes.js.patch', 'mcdata.js.patch'];
  if (existsSync(patchDir)) {
    for (const name of patches) {
      const patchFile = join(patchDir, name);
      if (!existsSync(patchFile)) continue;
      console.log('[fetch-base] applying', name);
      try {
        run(`cd "${ROOT}" && patch -N -r - -p0 < "${patchFile}"`);
      } catch (e) {
        console.warn('[fetch-base] patch skipped/already applied:', name);
      }
    }
  }

  console.log('[fetch-base] Ready.');
} catch (e) {
  console.error('[fetch-base] unexpected error:', e.message);
  process.exit(0);
}
