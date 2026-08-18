/**
 * Clean fetch-base: restore core files from mindcraft, apply unified patches only.
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
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from, 'utf8'));
}

function ensureMindcraftTree() {
  if (existsSync(NEEDLE) && existsSync(join(TMP, 'src', 'agent', 'agent.js'))) {
    console.log('[fetch-base] mindcraft tree present');
    return;
  }
  console.log('[fetch-base] Cloning mindcraft...');
  rmSync(TMP, { recursive: true, force: true });
  run('git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "' + TMP + '"');
  for (const part of ['src', 'profiles', 'bots']) {
    const from = join(TMP, part);
    const to = join(ROOT, part);
    if (!existsSync(from)) continue;
    mkdirSync(to, { recursive: true });
    try { run('cp -rn "' + from + '/." "' + to + '/" 2>/dev/null || true'); } catch (_) {}
  }
  if (!existsSync(join(ROOT, 'main.js'))) {
    cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
  }
}

function refreshCoreFromUpstream() {
  if (!existsSync(join(TMP, 'src', 'agent', 'agent.js'))) {
    rmSync(TMP, { recursive: true, force: true });
    run('git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "' + TMP + '"');
  }
  for (const rel of [
    'src/agent/agent.js',
    'src/agent/modes.js',
    'src/agent/library/skills.js',
    'src/agent/self_prompter.js',
  ]) {
    const from = join(TMP, rel);
    const to = join(ROOT, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    console.log('[fetch-base] restored', rel);
  }
}

function applyPatches() {
  const patchDir = join(ROOT, 'patches');
  // order matters: base agent patch first, then silence openChat
  const list = [
    'agent.js.patch',
    'openchat-silence.patch',
    'modes.js.patch',
    'skills.js.patch',
    'self_prompter.js.patch',
    'mcdata-version.patch',
    'mcdata.js.patch',
  ];
  for (const name of list) {
    const patchFile = join(patchDir, name);
    if (!existsSync(patchFile)) continue;
    try {
      run('cd "' + ROOT + '" && patch -N -r - -p0 < "' + patchFile + '"');
      console.log('[fetch-base] applied', name);
    } catch (e) {
      console.warn('[fetch-base] patch skip:', name, e.message);
    }
  }
}

function forceMcVersion() {
  const mcPath = join(ROOT, 'src', 'utils', 'mcdata.js');
  if (!existsSync(mcPath)) return;
  let src = readFileSync(mcPath, 'utf8');
  if (src.includes('DreamBot: NEVER delete version')) return;
  const replaced = src.replace(
    /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*["']auto["']\s*\)\s*\{[^}]*delete\s+options\.version;[^}]*\}/m,
    `// DreamBot: NEVER delete version\n    options.version = options.version || '${FORCED_VERSION}';\n    console.log('[DreamBot] Connecting with version:', options.version);`
  );
  if (replaced !== src) writeFileSync(mcPath, replaced);
}

try {
  try {
    run('npm install --omit=dev --no-save mineflayer@latest minecraft-protocol@latest minecraft-data@latest');
  } catch (e) {
    console.warn('[fetch-base] protocol bump failed:', e.message);
  }

  ensureMindcraftTree();
  refreshCoreFromUpstream();
  applyPatches();
  forceMcVersion();

  writeFileSync(join(ROOT, 'src', 'settings.js'), "import settings from '../settings.js';\nexport default settings;\n");

  writeStub(
    'src/agent/settings.js',
    [
      'let settings = {};',
      'export default settings;',
      'export function setSettings(new_settings) {',
      '    Object.keys(settings).forEach(key => delete settings[key]);',
      '    Object.assign(settings, new_settings);',
      "    if (!settings.minecraft_version || settings.minecraft_version === 'auto' || settings.minecraft_version === false) {",
      "        settings.minecraft_version = process.env.MC_VERSION || '1.21.11';",
      '    }',
      '}',
      '',
    ].join('\n')
  );

  writeStub('src/agent/vision/browser_viewer.js', 'export function addBrowserViewer() {}\nexport function addViewer() {}\nexport default { addBrowserViewer, addViewer };\n');
  writeStub('src/agent/vision/camera.js', "import { EventEmitter } from 'events';\nexport class Camera extends EventEmitter {\n  constructor(bot, fp) { super(); this.bot = bot; this.fp = fp; this.disabled = true; setImmediate(() => this.emit('ready')); }\n  async capture() { return null; }\n}\n");
  writeStub('src/agent/vision/vision_interpreter.js', "export class VisionInterpreter {\n  constructor(agent) { this.agent = agent; this.allow_vision = false; this.camera = null; }\n  async lookAtPlayer() { return 'Vision disabled'; }\n  async lookAtPosition() { return 'Vision disabled'; }\n  getCenterBlockInfo() { return 'No block'; }\n  async analyzeImage() { return 'Vision disabled'; }\n}\n");

  copyStub('stubs/math.js', 'src/utils/math.js');
  copyStub('stubs/examples.js', 'src/utils/examples.js');
  copyStub('stubs/agent_process.js', 'src/process/agent_process.js');

  const ms = join(ROOT, 'scripts', 'patch-mindserver.js');
  if (existsSync(ms)) {
    try { run('node "' + ms + '"'); } catch (e) {
      console.warn('[fetch-base] mindserver', e.message);
    }
  }

  console.log('[fetch-base] Ready (clean).', FORCED_VERSION);
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
