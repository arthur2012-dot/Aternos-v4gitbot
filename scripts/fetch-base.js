/**
 * Clone official mindcraft, apply DreamBot patches, disable heavy viewer.
 * Never hard-crash the whole npm install.
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

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
      process.exit(0);
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

  // Re-export root settings at src/settings.js (mindcraft paths expect it)
  try {
    writeFileSync(
      join(ROOT, 'src', 'settings.js'),
      "import settings from '../settings.js';\nexport default settings;\n"
    );
    console.log('[fetch-base] src/settings.js re-export installed.');
  } catch (e) {
    console.warn('[fetch-base] could not write src/settings.js:', e.message);
  }

  // Always install a NO-OP browser viewer so prismarine-viewer is never required.
  const viewerPath = join(ROOT, 'src', 'agent', 'vision', 'browser_viewer.js');
  try {
    mkdirSync(dirname(viewerPath), { recursive: true });
    writeFileSync(
      viewerPath,
      `// DreamBot: stub — prismarine-viewer disabled on Railway (no canvas/GPU)\n` +
        `import settings from '../../../settings.js';\n\n` +
        `export function addBrowserViewer(bot, count_id) {\n` +
        `  if (settings.render_bot_view || settings.show_bot_views) {\n` +
        `    console.log('[DreamBot] Bot view requested but viewer is disabled in this deploy.');\n` +
        `  }\n` +
        `}\n` +
        `export function addViewer(bot, count_id) {\n` +
        `  return addBrowserViewer(bot, count_id);\n` +
        `}\n` +
        `export default { addBrowserViewer, addViewer };\n`
    );
    console.log('[fetch-base] browser_viewer.js stub installed (no prismarine-viewer).');
  } catch (e) {
    console.warn('[fetch-base] could not write viewer stub:', e.message);
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
