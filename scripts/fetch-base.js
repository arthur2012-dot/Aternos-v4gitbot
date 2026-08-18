/**
 * DreamBot fetch-base — PathStopped is NOT a crash; swallow it.
 * Unstuck less aggressive so collectBlocks can finish.
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
function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}
function write(rel, content) {
  writeFileSync(join(ROOT, rel), content);
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
  if (!existsSync(join(ROOT, 'main.js'))) cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
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
    'src/utils/mcdata.js',
  ]) {
    const from = join(TMP, rel);
    const to = join(ROOT, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    console.log('[fetch-base] restored', rel);
  }
}

function applyDreamBotFixes() {
  // MODES
  let modes = read('src/agent/modes.js');
  // never stopLoop
  if (modes.includes('agent.self_prompter.stopLoop()')) {
    modes = modes.replace(
      /if\s*\(\s*agent\.self_prompter\.isActive\(\)\s*\)\s*\n?\s*agent\.self_prompter\.stopLoop\(\);/,
      `// DreamBot: keep self-prompt alive\n    // stopLoop removed`
    );
    console.log('[fetch-base] modes: no stopLoop');
  }
  // softer unstuck: 45s before trigger (was 20)
  modes = modes.replace(/max_stuck_time:\s*20/, 'max_stuck_time: 45');
  // no cleanKill on stuck
  modes = modes.replace(
    /agent\.cleanKill\(["']Got stuck[^"']*["']\)/g,
    `console.warn('[DreamBot] stuck timeout — stay online')`
  );
  // resume self-prompt after mode
  if (!modes.includes('[DreamBot] resume self-prompt after mode')) {
    modes = modes.replace(
      /if\s*\(\s*should_reprompt\s*\)\s*\{/,
      `// [DreamBot] resume self-prompt after mode\n    try {\n      if (agent.self_prompter && !agent.self_prompter.isActive()) {\n        setTimeout(() => { try { agent.self_prompter.start(agent.self_prompter.prompt || 'Collect wood !collectBlocks'); } catch(_){} }, 4000);\n      }\n    } catch(_){}\n    if (should_reprompt) {`
    );
  }
  write('src/agent/modes.js', modes);

  // SKILLS: swallow PathStopped in goToGoal / goto
  let skills = read('src/agent/library/skills.js');
  if (!skills.includes('[DreamBot] PathStopped ok')) {
    // wrap common pathfinder failures
    skills = skills.replace(
      /async function goToGoal\(/,
      `async function goToGoal(`
    );
    // After goToGoal function starts, we inject try/catch around pathfinder.goto calls if present
    if (skills.includes('await bot.pathfinder.goto')) {
      skills = skills.replace(
        /await bot\.pathfinder\.goto\(([^)]+)\)/g,
        `await bot.pathfinder.goto($1).catch(e => { if (/PathStopped|NoPath|Timeout/i.test(String(e?.message||e))) { console.warn('[DreamBot] PathStopped ok'); return; } throw e; })`
      );
      console.log('[fetch-base] skills: PathStopped swallowed');
    }
    if (skills.includes('goToGoal') && !skills.includes('[DreamBot] sprint')) {
      skills = skills.replace(
        /(async function goToGoal\([^)]*\)\s*\{)/,
        `$1\n    try { bot.setControlState('sprint', true); } catch (_) {} // [DreamBot] sprint\n`
      );
    }
    write('src/agent/library/skills.js', skills);
  }

  // AGENT
  let agent = read('src/agent/agent.js');

  if (agent.includes('Hello world! I am')) {
    agent = agent.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/,
      `try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
                this.self_prompter.start('Collect wood with !collectBlocks. Always use a !command.');
            }
        } catch (e) {}`
    );
  }

  if (!agent.includes('[DreamBot] suppressed chat')) {
    agent = agent.replace(
      /async openChat\(message\) \{/,
      `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/groq|rate.?limit|brain disconnected|try again|api key|restarting|exiting|hello world|PathStopped|passivo/i.test(__m)) {
            console.warn('[DreamBot] suppressed chat:', __m.slice(0, 60));
            return;
        }`
    );
  }

  if (agent.includes("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.')")) {
    agent = agent.replace(
      /cleanKill\(msg='Killing agent process\.\.\.', code=1\) \{\s*this\.history\.add\('system', msg\);\s*this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);\s*this\.history\.save\(\);\s*process\.exit\(code\);\s*\}/,
      `cleanKill(msg='Killing agent process...', code=1) {
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', msg); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|not spawned|PathStopped/i.test(String(msg))) return;
        process.exit(code);
    }`
    );
  }

  if (!agent.includes('[DreamBot] idle worker')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            try {
                const pf = await import('mineflayer-pathfinder');
                const Movements = pf.Movements || pf.default?.Movements;
                if (Movements) {
                    const moves = new Movements(this.bot);
                    moves.allowSprinting = true;
                    moves.allowParkour = true;
                    moves.allow1by1towers = true;
                    moves.canDig = true;
                    moves.maxDropDown = 4;
                    this.bot.pathfinder.setMovements(moves);
                    console.log('[DreamBot] pathfinder OK');
                }
            } catch (e) { console.warn('[DreamBot] pathfinder', e.message); }

            // Ignore PathStopped globally so stack traces don't flood
            this.bot.on('path_update', () => {});
            const origEmit = this.bot.emit.bind(this.bot);
            // Idle worker: dig wood without LLM
            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (this.actions?.executing) return;
                    if (bot.pathfinder?.isMoving?.()) return;
                    console.log('[DreamBot] idle worker tick');
                    const skills = await import('./library/skills.js');
                    const kinds = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];
                    for (const k of kinds) {
                        try {
                            await skills.collectBlock(bot, k, 2);
                            console.log('[DreamBot] collected', k);
                            return;
                        } catch (e) {
                            if (!/PathStopped|NoPath/i.test(String(e?.message||e))) {
                                /* try next */
                            }
                        }
                    }
                    const log = bot.findBlock({ matching: b => b && /_log$/i.test(b.name), maxDistance: 12 });
                    if (log) {
                        try { await bot.dig(log); console.log('[DreamBot] dug log'); return; } catch (_) {}
                    }
                    bot.setControlState('forward', true);
                    bot.setControlState('sprint', true);
                    bot.setControlState('jump', true);
                    setTimeout(() => {
                        try {
                            bot.setControlState('jump', false);
                            bot.setControlState('forward', false);
                            bot.setControlState('sprint', false);
                            bot.look(bot.entity.yaw + 0.7, 0);
                        } catch (_) {}
                    }, 450);
                } catch (e) {
                    if (!/PathStopped/i.test(String(e?.message||e)))
                        console.warn('[DreamBot] idle worker', e.message);
                }
            }, 18000);

            setInterval(() => {
                try {
                    if (!this.self_prompter) return;
                    if (this.self_prompter.isActive && this.self_prompter.isActive()) return;
                    console.log('[DreamBot] restarting self-prompt');
                    this.self_prompter.start('Collect wood: !collectBlocks(\"oak_log\", 5)');
                } catch (_) {}
            }, 55000);

            try {
                clearTimeout(spawnTimeout);`
    );
    console.log('[fetch-base] agent: idle worker');
  }

  write('src/agent/agent.js', agent);

  let sp = read('src/agent/self_prompter.js');
  sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 30');
  if (sp.includes('Stopping auto-prompting')) {
    sp = sp.replace(
      /let out = `Agent did not use command[\s\S]*?this\.state = STOPPED;/,
      `console.warn('[DreamBot] self-prompt soft pause');\n                    this.state = PAUSED;\n                    setTimeout(() => { try { this.start(this.prompt || 'Collect wood'); } catch(_){} }, 20000);`
    );
  }
  sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');
  write('src/agent/self_prompter.js', sp);

  let mc = read('src/utils/mcdata.js');
  if (!mc.includes('DreamBot: NEVER delete version')) {
    mc = mc.replace(
      /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*["']auto["']\s*\)\s*\{[\s\S]*?delete\s+options\.version;[\s\S]*?\}/m,
      `// DreamBot: NEVER delete version\n    options.version = options.version || '${FORCED_VERSION}';\n    console.log('[DreamBot] Connecting with version:', options.version);`
    );
    write('src/utils/mcdata.js', mc);
  }

  console.log('[fetch-base] DreamBot fixes applied');
}

try {
  try {
    run('npm install --omit=dev --no-save mineflayer@latest minecraft-protocol@latest minecraft-data@latest');
  } catch (e) {
    console.warn('[fetch-base] protocol bump failed:', e.message);
  }
  ensureMindcraftTree();
  refreshCoreFromUpstream();
  applyDreamBotFixes();

  writeFileSync(join(ROOT, 'src', 'settings.js'), "import settings from '../settings.js';\nexport default settings;\n");
  writeStub('src/agent/settings.js', [
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
  ].join('\n'));
  writeStub('src/agent/vision/browser_viewer.js', 'export function addBrowserViewer() {}\nexport function addViewer() {}\nexport default { addBrowserViewer, addViewer };\n');
  writeStub('src/agent/vision/camera.js', "import { EventEmitter } from 'events';\nexport class Camera extends EventEmitter {\n  constructor(bot, fp) { super(); this.bot = bot; this.fp = fp; this.disabled = true; setImmediate(() => this.emit('ready')); }\n  async capture() { return null; }\n}\n");
  writeStub('src/agent/vision/vision_interpreter.js', "export class VisionInterpreter {\n  constructor(agent) { this.agent = agent; this.allow_vision = false; this.camera = null; }\n  async lookAtPlayer() { return 'Vision disabled'; }\n  async lookAtPosition() { return 'Vision disabled'; }\n  getCenterBlockInfo() { return 'No block'; }\n  async analyzeImage() { return 'Vision disabled'; }\n}\n");
  copyStub('stubs/math.js', 'src/utils/math.js');
  copyStub('stubs/examples.js', 'src/utils/examples.js');
  copyStub('stubs/agent_process.js', 'src/process/agent_process.js');
  const ms = join(ROOT, 'scripts', 'patch-mindserver.js');
  if (existsSync(ms)) { try { run('node "' + ms + '"'); } catch (_) {} }
  console.log('[fetch-base] Ready — PathStopped swallowed, soft unstuck');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
