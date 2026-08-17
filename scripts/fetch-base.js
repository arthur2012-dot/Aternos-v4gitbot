/**
 * Clone official mindcraft, apply DreamBot patches, disable heavy viewer/vision.
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

function writeStub(relPath, content) {
  const full = join(ROOT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log('[fetch-base] stub:', relPath);
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

  // settings re-export
  try {
    writeFileSync(
      join(ROOT, 'src', 'settings.js'),
      "import settings from '../settings.js';\nexport default settings;\n"
    );
    console.log('[fetch-base] src/settings.js re-export installed.');
  } catch (e) {
    console.warn('[fetch-base] could not write src/settings.js:', e.message);
  }

  // Vision stubs — MUST run after copy so they overwrite mindcraft files
  writeStub('src/agent/vision/browser_viewer.js', `
export function addBrowserViewer() {}
export function addViewer() {}
export default { addBrowserViewer, addViewer };
`);

  writeStub('src/agent/vision/camera.js', `
import { EventEmitter } from 'events';
export class Camera extends EventEmitter {
  constructor(bot, fp) {
    super();
    this.bot = bot;
    this.fp = fp;
    this.disabled = true;
    setImmediate(() => this.emit('ready'));
  }
  async capture() {
    console.log('[DreamBot] Camera capture skipped (vision disabled).');
    return null;
  }
}
`);

  writeStub('src/agent/vision/vision_interpreter.js', `
export class VisionInterpreter {
  constructor(agent, allow_vision) {
    this.agent = agent;
    this.allow_vision = false;
    this.fp = './bots/' + agent.name + '/screenshots/';
    this.camera = null;
    if (allow_vision) {
      console.log('[DreamBot] Vision requested but disabled in this deploy.');
    }
  }
  async lookAtPlayer() { return 'Vision is disabled.'; }
  async lookAtPosition() { return 'Vision is disabled.'; }
  getCenterBlockInfo() { return 'No block in center view'; }
  async analyzeImage() { return 'Vision is disabled.'; }
}
`);

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
