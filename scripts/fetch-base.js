/**
 * Clone official mindcraft, apply DreamBot patches and overlay configs.
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TMP = '/tmp/mindcraft-base';
const NEEDLE = join(ROOT, 'src', 'agent', 'library', 'skills.js');

if (!existsSync(NEEDLE)) {
  console.log('[fetch-base] Cloning mindcraft-bots/mindcraft...');
  try {
    rmSync(TMP, { recursive: true, force: true });
    execSync(`git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git ${TMP}`, { stdio: 'inherit' });
  } catch (e) {
    console.error('[fetch-base] clone failed:', e.message);
    process.exit(1);
  }
  for (const part of ['src', 'profiles', 'bots']) {
    const from = join(TMP, part);
    const to = join(ROOT, part);
    if (!existsSync(from)) continue;
    console.log('[fetch-base] copying', part);
    mkdirSync(to, { recursive: true });
    execSync(`cp -rn "${from}/." "${to}/" 2>/dev/null || true`, { shell: true });
  }
  if (!existsSync(join(ROOT, 'main.js'))) {
    cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
  }
} else {
  console.log('[fetch-base] Base sources already present.');
}

const patchDir = join(ROOT, 'patches');
const patchMap = {
  'agent.js.patch': 'src/agent/agent.js',
  'modes.js.patch': 'src/agent/modes.js',
  'mcdata.js.patch': 'src/utils/mcdata.js',
};

if (existsSync(patchDir)) {
  for (const name of Object.keys(patchMap)) {
    const patchFile = join(patchDir, name);
    if (!existsSync(patchFile)) continue;
    console.log('[fetch-base] applying', name);
    try {
      execSync(`cd "${ROOT}" && patch -N -r - -p0 < "${patchFile}"`, { shell: true, stdio: 'inherit' });
    } catch (e) {
      console.warn('[fetch-base] patch may already be applied:', name);
    }
  }
}

console.log('[fetch-base] Ready.');
