/**
 * DreamBot — Mindcraft base + fixes + LIGHT vision (no prismarine-viewer lag)
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const TMP = join(ROOT, '.mindcraft-base');
const NEEDLE = join(ROOT, 'src', 'agent', 'library', 'skills.js');
const VER = process.env.MC_VERSION || '1.21.11';

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: true });
}
function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }
function write(rel, content) {
  mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
  writeFileSync(join(ROOT, rel), content);
}
function writeStub(rel, content) {
  write(rel, content);
  console.log('[fetch-base] stub', rel);
}
function copyStub(fromRel, toRel) {
  if (!existsSync(join(ROOT, fromRel))) return;
  write(toRel, readFileSync(join(ROOT, fromRel), 'utf8'));
}

function ensureTree() {
  if (existsSync(NEEDLE) && existsSync(join(TMP, 'src', 'agent', 'agent.js'))) {
    console.log('[fetch-base] tree present');
    return;
  }
  console.log('[fetch-base] clone mindcraft...');
  rmSync(TMP, { recursive: true, force: true });
  run(`git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "${TMP}"`);
  for (const part of ['src', 'profiles', 'bots']) {
    const from = join(TMP, part);
    if (!existsSync(from)) continue;
    mkdirSync(join(ROOT, part), { recursive: true });
    try { run(`cp -rn "${from}/." "${join(ROOT, part)}/" 2>/dev/null || true`); } catch {}
  }
  if (!existsSync(join(ROOT, 'main.js'))) cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
}

function refresh() {
  if (!existsSync(join(TMP, 'src', 'agent', 'agent.js'))) {
    rmSync(TMP, { recursive: true, force: true });
    run(`git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "${TMP}"`);
  }
  for (const rel of [
    'src/agent/agent.js',
    'src/agent/modes.js',
    'src/agent/library/skills.js',
    'src/agent/self_prompter.js',
    'src/utils/mcdata.js',
    'src/models/prompter.js',
  ]) {
    const from = join(TMP, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
    cpSync(from, join(ROOT, rel));
    console.log('[fetch-base] restored', rel);
  }
}

function applyFixes() {
  try {
    let prompter = read('src/models/prompter.js');
    if (!prompter.includes('[DreamBot] safeReplace') && prompter.includes('async replaceStrings')) {
      prompter = prompter.replace(
        /async replaceStrings\s*\(/,
        `// [DreamBot] safeReplace
    _safeReplaceAll(str, search, repl) {
        const s = (str == null) ? '' : String(str);
        if (typeof s.replaceAll === 'function') {
            try { return s.replaceAll(search, repl); } catch {}
        }
        const esc = String(search).replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
        return s.replace(new RegExp(esc, 'g'), repl == null ? '' : String(repl));
    }
    async replaceStrings(`
      );
      prompter = prompter.replace(/prompt\s*=\s*prompt\.replaceAll\(/g, 'prompt = this._safeReplaceAll(prompt, ');
      write('src/models/prompter.js', prompter);
    }
  } catch {}

  let modes = read('src/agent/modes.js');
  modes = modes.replace(
    /if\s*\(\s*agent\.self_prompter\.isActive\(\)\s*\)\s*\n?\s*agent\.self_prompter\.stopLoop\(\);/g,
    '// DreamBot: keep self-prompt'
  );
  modes = modes.replace(/max_stuck_time:\s*20/g, 'max_stuck_time: 90');
  modes = modes.replace(
    /agent\.cleanKill\(["']Got stuck[^"']*["']\)/g,
    `console.warn('[DreamBot] stuck — stay online')`
  );
  write('src/agent/modes.js', modes);

  let skills = read('src/agent/library/skills.js');
  if (!skills.includes('[DreamBot] collect soft')) {
    skills = skills.replace(
      /console\.log\(err\);\s*\/\/ log pathfinder errors for debugging/g,
      `if (/PathStopped|NoPath|Timeout|GoalChanged/i.test(String(err?.message || err))) {
                console.warn('[DreamBot] collect continue');
            } else console.log(err);`
    );
  }
  write('src/agent/library/skills.js', skills);

  let agent = read('src/agent/agent.js');
  if (agent.includes('Hello world! I am')) {
    agent = agent.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/,
      `try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
                this.self_prompter.start('Survive. Always !command. Keep moving.');
            }
        } catch {}`
    );
  }
  if (!agent.includes('[DreamBot] suppressed chat')) {
    agent = agent.replace(
      /async openChat\(message\) \{/,
      `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/groq|rate.?limit|brain disconnected|api key|restarting|exiting|hello world|PathStopped|passivo|cooldown|replaceAll|key not found/i.test(__m)) {
            console.warn('[DreamBot] suppressed:', __m.slice(0, 40));
            return;
        }`
    );
  }
  agent = agent.replace(
    /this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);/g,
    `/* no Exiting chat */`
  );
  write('src/agent/agent.js', agent);

  try {
    let sp = read('src/agent/self_prompter.js');
    sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, '/* no stop */ void 0;');
    sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 40');
    sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');
    write('src/agent/self_prompter.js', sp);
  } catch {}

  let mc = read('src/utils/mcdata.js');
  if (!mc.includes('DreamBot: NEVER delete version')) {
    mc = mc.replace(
      /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*["']auto["']\s*\)\s*\{[\s\S]*?delete\s+options\.version;[\s\S]*?\}/m,
      `// DreamBot: NEVER delete version
    options.version = options.version || '${VER}';
    console.log('[DreamBot] version', options.version);`
    );
    write('src/utils/mcdata.js', mc);
  }

  copyStub('stubs/coder.js', 'src/agent/coder.js');
  console.log('[fetch-base] coder stub + fixes');
}

/** Install light vision (text scene) — same API as Mindcraft, no WebGL */
function installLightVision() {
  const lightPath = join(ROOT, 'scripts', 'light-vision.js');
  let light = '';
  if (existsSync(lightPath)) light = readFileSync(lightPath, 'utf8');

  writeStub('src/agent/vision/browser_viewer.js', `// Light vision: no prismarine-viewer (avoids Railway crash/lag)
export function addBrowserViewer() {
  if (process.env.ENABLE_VIEWER === '1') {
    console.warn('[VISION] ENABLE_VIEWER ignored in light mode (no prismarine-viewer)');
  }
}
export function addViewer() {}
export default { addBrowserViewer, addViewer };
`);

  writeStub('src/agent/vision/camera.js', `import { EventEmitter } from 'events';
export class Camera extends EventEmitter {
  constructor(bot, fp) {
    super();
    this.bot = bot;
    this.fp = fp;
    this.disabled = false;
    this.mode = 'light-text';
    setImmediate(() => this.emit('ready'));
  }
  async capture() { return null; }
}
`);

  // vision_interpreter re-exports from light-vision if available, else inline minimal
  if (light) {
    write('src/agent/vision/vision_interpreter.js', light.replace(
      /export function addBrowserViewer[\s\S]*$/,
      ''
    ) + `
export default { VisionInterpreter, Camera, describeScene };
`);
    console.log('[fetch-base] LIGHT vision installed');
  } else {
    writeStub('src/agent/vision/vision_interpreter.js', `export class VisionInterpreter {
  constructor(agent) {
    this.agent = agent;
    this.allow_vision = true;
    this.camera = null;
    console.log('[VISION] minimal light');
  }
  getCenterBlockInfo() {
    try {
      const b = this.agent.bot.blockAtCursor?.(5);
      return b ? b.name + ' ' + b.position : 'nenhum';
    } catch { return 'nenhum'; }
  }
  async lookAtPlayer(n) { return 'Olhando ' + n + ' | ' + this.getCenterBlockInfo(); }
  async lookAtPosition(x,y,z) { return 'Olhando ' + x + ',' + y + ',' + z; }
  async analyzeImage() { return this.getCenterBlockInfo(); }
}
`);
  }
}

try {
  ensureTree();
  refresh();
  applyFixes();
  installLightVision();

  writeFileSync(join(ROOT, 'src', 'settings.js'), "import settings from '../settings.js';\nexport default settings;\n");
  writeStub('src/agent/settings.js', `let settings = {};
export default settings;
export function setSettings(new_settings) {
    Object.keys(settings).forEach(k => delete settings[k]);
    Object.assign(settings, new_settings);
    if (!settings.minecraft_version || settings.minecraft_version === 'auto' || settings.minecraft_version === false) {
        settings.minecraft_version = process.env.MC_VERSION || '1.21.11';
    }
    // force light vision flags
    settings.allow_vision = true;
    settings.render_bot_view = false;
    settings.show_bot_views = false;
}
`);
  copyStub('stubs/math.js', 'src/utils/math.js');
  copyStub('stubs/examples.js', 'src/utils/examples.js');
  copyStub('stubs/agent_process.js', 'src/process/agent_process.js');
  copyStub('stubs/coder.js', 'src/agent/coder.js');
  copyStub('scripts/pvp-combat.js', 'src/agent/pvp-combat.js');

  console.log('[fetch-base] Ready (light vision)');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
