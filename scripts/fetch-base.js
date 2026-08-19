/**
 * DreamBot — Mindcraft base + fixes
 * Includes AI non-block: API wait must not kill tasks
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

function applyAiNonBlock() {
  const spPath = join(ROOT, 'src/agent/self_prompter.js');
  if (!existsSync(spPath)) return;
  let sp = readFileSync(spPath, 'utf8');

  // Never stop physical actions when pausing self-prompt (API lag)
  sp = sp.replace(
    /await this\.agent\.actions\.stop\(\);/g,
    `/* [DreamBot] AI wait: do not actions.stop() */ void 0;`
  );

  // Soft stop when no command from LLM
  sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 40');
  if (sp.includes('Stopping auto-prompting')) {
    sp = sp.replace(
      /Stopping auto-prompting[^`]*`/,
      `Soft pause (API empty). Passive keeps moving.` + '`'
    );
  }
  sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');

  writeFileSync(spPath, sp);
  console.log('[fetch-base] AI non-block: self_prompter never kills actions');
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
  if (!modes.includes('[DreamBot] soft interrupt')) {
    for (const name of ['unstuck', 'hunting', 'item_collecting', 'torch_placing', 'elbow_room']) {
      modes = modes.replace(
        new RegExp(`(name:\\s*['\"]${name}['\"][\\s\\S]*?interrupt:\\s*)(agent\\s*=>\\s*[^,\\n]+)`),
        `$1false /* [DreamBot] soft interrupt */`
      );
    }
  }
  write('src/agent/modes.js', modes);

  let skills = read('src/agent/library/skills.js');
  if (!skills.includes('[DreamBot] soft PathStopped')) {
    skills = skills.replace(
      /throw err;/g,
      (m, offset, str) => {
        // only near pathfinder goto - soft approach: already patched elsewhere
        return m;
      }
    );
  }
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
  if (agent.includes("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.')")) {
    agent = agent.replace(
      /this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);/g,
      `/* no Exiting chat */`
    );
  }
  write('src/agent/agent.js', agent);

  applyAiNonBlock();

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

  console.log('[fetch-base] fixes + AI non-block applied');
}

try {
  try {
    run('npm install --omit=dev --no-save mineflayer@latest minecraft-protocol@latest minecraft-data@latest');
  } catch (e) {
    console.warn('[fetch-base] protocol', e.message);
  }
  ensureTree();
  refresh();
  applyFixes();

  writeFileSync(join(ROOT, 'src', 'settings.js'), "import settings from '../settings.js';\nexport default settings;\n");
  writeStub('src/agent/settings.js', `let settings = {};
export default settings;
export function setSettings(new_settings) {
    Object.keys(settings).forEach(k => delete settings[k]);
    Object.assign(settings, new_settings);
    if (!settings.minecraft_version || settings.minecraft_version === 'auto' || settings.minecraft_version === false) {
        settings.minecraft_version = process.env.MC_VERSION || '1.21.11';
    }
}
`);
  writeStub('src/agent/vision/browser_viewer.js', 'export function addBrowserViewer() {}\nexport function addViewer() {}\nexport default { addBrowserViewer, addViewer };\n');
  writeStub('src/agent/vision/camera.js', `import { EventEmitter } from 'events';
export class Camera extends EventEmitter {
  constructor(bot, fp) { super(); this.bot = bot; this.fp = fp; this.disabled = true; setImmediate(() => this.emit('ready')); }
  async capture() { return null; }
}
`);
  writeStub('src/agent/vision/vision_interpreter.js', `export class VisionInterpreter {
  constructor(agent) { this.agent = agent; this.allow_vision = false; this.camera = null; }
  async lookAtPlayer() { return 'Vision disabled'; }
  async lookAtPosition() { return 'Vision disabled'; }
  getCenterBlockInfo() { return 'No block'; }
  async analyzeImage() { return 'Vision disabled'; }
}
`);
  copyStub('stubs/math.js', 'src/utils/math.js');
  copyStub('stubs/examples.js', 'src/utils/examples.js');
  copyStub('stubs/agent_process.js', 'src/process/agent_process.js');
  copyStub('scripts/pvp-combat.js', 'src/agent/pvp-combat.js');

  // Run AI non-block patch script if present
  const aiPatch = join(ROOT, 'scripts', 'patch-ai-nonblock.js');
  if (existsSync(aiPatch)) {
    try { run(`node "${aiPatch}"`); } catch (e) { console.warn('[fetch-base] ai-nonblock', e.message); }
  }

  const ms = join(ROOT, 'scripts', 'patch-mindserver.js');
  if (existsSync(ms)) { try { run(`node "${ms}"`); } catch {} }

  console.log('[fetch-base] Ready — API wait will not kill tasks');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
