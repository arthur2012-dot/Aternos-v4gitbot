/**
 * Clone official mindcraft, apply DreamBot patches, force MC 1.21.11.
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const TMP = join(ROOT, '.mindcraft-base');
const NEEDLE = join(ROOT, 'src', 'agent', 'library', 'skills.js');
const FORCED_VERSION = process.env.MC_VERSION || '1.21.11';

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
}

function writeStub(relPath, content) {
  const full = join(ROOT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log('[fetch-base] stub:', relPath);
}

function copyStub(fromRel, toRel) {
  const from = join(ROOT, fromRel);
  const to = join(ROOT, toRel);
  if (!existsSync(from)) {
    console.warn('[fetch-base] missing stub source:', fromRel);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from, 'utf8'));
  console.log('[fetch-base] stub from file:', toRel);
}

try {
  try {
    console.log('[fetch-base] Ensuring latest mineflayer stack...');
    run('npm install --omit=dev --no-save mineflayer@latest minecraft-protocol@latest minecraft-data@latest');
  } catch (e) {
    console.warn('[fetch-base] could not bump protocol packages:', e.message);
  }

  if (!existsSync(NEEDLE)) {
    console.log('[fetch-base] Cloning mindcraft-bots/mindcraft...');
    try {
      rmSync(TMP, { recursive: true, force: true });
      run('git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "' + TMP + '"');
    } catch (e) {
      console.error('[fetch-base] git clone failed:', e.message);
      process.exit(0);
    }

    for (const part of ['src', 'profiles', 'bots']) {
      const from = join(TMP, part);
      const to = join(ROOT, part);
      if (!existsSync(from)) continue;
      console.log('[fetch-base] copying', part);
      mkdirSync(to, { recursive: true });
      try {
        run('cp -rn "' + from + '/." "' + to + '/" 2>/dev/null || true');
      } catch (_) {}
    }

    if (!existsSync(join(ROOT, 'main.js'))) {
      cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
    }
  } else {
    console.log('[fetch-base] Base sources already present.');
  }

  try {
    writeFileSync(
      join(ROOT, 'src', 'settings.js'),
      "import settings from '../settings.js';\nexport default settings;\n"
    );
  } catch (_) {}

  writeStub(
    'src/agent/settings.js',
    [
      'let settings = {};',
      'export default settings;',
      'export function setSettings(new_settings) {',
      '    Object.keys(settings).forEach(key => delete settings[key]);',
      '    Object.assign(settings, new_settings);',
      "    // DreamBot: never allow empty/auto version",
      "    if (!settings.minecraft_version || settings.minecraft_version === 'auto' || settings.minecraft_version === false) {",
      "        settings.minecraft_version = process.env.MC_VERSION || '1.21.11';",
      '    }',
      '}',
      ''
    ].join('\n')
  );

  writeStub('src/agent/vision/browser_viewer.js', 'export function addBrowserViewer() {}\nexport function addViewer() {}\nexport default { addBrowserViewer, addViewer };\n');
  writeStub(
    'src/agent/vision/camera.js',
    "import { EventEmitter } from 'events';\nexport class Camera extends EventEmitter {\n  constructor(bot, fp) { super(); this.bot = bot; this.fp = fp; this.disabled = true; setImmediate(() => this.emit('ready')); }\n  async capture() { return null; }\n}\n"
  );
  writeStub(
    'src/agent/vision/vision_interpreter.js',
    "export class VisionInterpreter {\n  constructor(agent) { this.agent = agent; this.allow_vision = false; this.camera = null; }\n  async lookAtPlayer() { return 'Vision disabled'; }\n  async lookAtPosition() { return 'Vision disabled'; }\n  getCenterBlockInfo() { return 'No block'; }\n  async analyzeImage() { return 'Vision disabled'; }\n}\n"
  );

  copyStub('stubs/math.js', 'src/utils/math.js');
  copyStub('stubs/examples.js', 'src/utils/examples.js');
  copyStub('stubs/agent_process.js', 'src/process/agent_process.js');

  const patchDir = join(ROOT, 'patches');
  const patches = ['agent.js.patch', 'modes.js.patch', 'mcdata.js.patch', 'mcdata-version.patch'];
  if (existsSync(patchDir)) {
    for (const name of patches) {
      const patchFile = join(patchDir, name);
      if (!existsSync(patchFile)) continue;
      console.log('[fetch-base] applying', name);
      try {
        run('cd "' + ROOT + '" && patch -N -r - -p0 < "' + patchFile + '"');
      } catch (e) {
        console.warn('[fetch-base] patch skipped/already applied:', name);
      }
    }
  }

  // Nuclear option: rewrite initBot version handling if patch failed
  try {
    const mcPath = join(ROOT, 'src', 'utils', 'mcdata.js');
    if (existsSync(mcPath)) {
      let src = readFileSync(mcPath, 'utf8');
      if (!src.includes('DreamBot: NEVER delete version') && !src.includes('FORCED_VERSION')) {
        src = src.replace(
          /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*["']auto["']\s*\)\s*\{[^}]*delete\s+options\.version;[^}]*\}/m,
          `// DreamBot: NEVER delete version\n    options.version = options.version || '${FORCED_VERSION}';\n    console.log('[DreamBot] Connecting with version:', options.version);`
        );
        writeFileSync(mcPath, src);
        console.log('[fetch-base] forced version in mcdata.js');
      }
    }
  } catch (e) {
    console.warn('[fetch-base] mcdata force failed:', e.message);
  }

  try {
    run('node "' + join(ROOT, 'scripts', 'patch-mindserver.js') + '"');
  } catch (e) {
    console.warn('[fetch-base] patch-mindserver failed:', e.message);
  }

  console.log('[fetch-base] Ready. Forced MC version:', FORCED_VERSION);
} catch (e) {
  console.error('[fetch-base] unexpected error:', e.message);
  process.exit(0);
}
