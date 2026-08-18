/**
 * DreamBot fetch-base: Mindcraft + reliable JS fixes (no broken .patch files).
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
  const full = join(ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
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
    try {
      run('cp -rn "' + from + '/." "' + to + '/" 2>/dev/null || true');
    } catch (_) {}
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
  let agent = read('src/agent/agent.js');

  // No Hello world → self-prompt
  if (agent.includes('Hello world! I am')) {
    agent = agent.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/,
      `try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
                this.self_prompter.start('Survive: wood, craft table, pickaxe, mine stone, place blocks if stuck. Never mention API.');
            }
        } catch (e) {}`
    );
    console.log('[fetch-base] agent: self-prompt start');
  }

  // openChat silence
  if (!agent.includes('[DreamBot] suppressed chat')) {
    agent = agent.replace(
      /async openChat\(message\) \{/,
      `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/groq|cerebras|deepseek|rate.?limit|429|tarifa|indispon|passivo|passive|artesanato|did not use command|n[aã]o usou o comando|stopping auto|parando|brain disconnected|try again|api key|modo pass|unavailable|restarting|exiting|hello world/i.test(__m)) {
            console.warn('[DreamBot] suppressed chat:', __m.slice(0, 80));
            return;
        }`
    );
    console.log('[fetch-base] agent: chat silence');
  }

  // cleanKill soft on stuck
  if (agent.includes("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.')")) {
    agent = agent.replace(
      /cleanKill\(msg='Killing agent process\.\.\.', code=1\) \{\s*this\.history\.add\('system', msg\);\s*this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);\s*this\.history\.save\(\);\s*process\.exit\(code\);\s*\}/,
      `cleanKill(msg='Killing agent process...', code=1) {
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', msg); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|not spawned/i.test(String(msg))) {
            console.warn('[DreamBot] soft fail — stay in game');
            try {
              if (this.self_prompter && !this.self_prompter.isActive()) {
                setTimeout(() => {
                  try { this.self_prompter.start('Unstuck then collect wood and craft tools.'); } catch(_){}
                }, 5000);
              }
            } catch(_){}
            return;
        }
        process.exit(code);
    }`
    );
    console.log('[fetch-base] agent: cleanKill soft');
  }

  // Spawn: passive loop + self-prompt watchdog + aggressive unstuck dig
  if (!agent.includes('[DreamBot] passive loop')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            // PASSIVE: dig/move without AI every 10s
            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity || this.actions?.executing) return;
                    if (bot.lastDamageTime && Date.now() - bot.lastDamageTime < 2500) return;
                    const skills = await import('./library/skills.js');
                    try { await skills.pickupNearbyItems(bot); } catch (_) {}
                    if (bot.health < 10) {
                        try { await skills.defendSelf(bot, 8); } catch (_) {}
                        return;
                    }
                    // Dig nearest log without long path (less stuck)
                    const log = bot.findBlock({ matching: (b) => b && /_log$/i.test(b.name), maxDistance: 12 });
                    if (log) {
                        try {
                          await bot.lookAt(log.position.offset(0.5, 0.5, 0.5));
                          await bot.dig(log);
                          return;
                        } catch (_) {}
                    }
                    const stone = bot.findBlock({ matching: (b) => b && (b.name === 'stone' || b.name === 'cobblestone'), maxDistance: 8 });
                    if (stone && bot.inventory.items().some(i => /pickaxe/i.test(i.name))) {
                        try { await bot.dig(stone); return; } catch (_) {}
                    }
                    // Unstuck: jump + dig block above head + move
                    try {
                      bot.setControlState('jump', true);
                      bot.setControlState('forward', true);
                      bot.setControlState('sprint', true);
                      const above = bot.blockAt(bot.entity.position.offset(0, 2, 0));
                      if (above && above.name !== 'air' && above.diggable !== false) {
                        try { await bot.dig(above); } catch (_) {}
                      }
                      setTimeout(() => {
                        try {
                          bot.setControlState('jump', false);
                          bot.setControlState('forward', false);
                          bot.setControlState('sprint', false);
                        } catch (_) {}
                      }, 600);
                    } catch (_) {}
                } catch (e) {
                    console.warn('[DreamBot] passive loop', e.message);
                }
            }, 10000);

            // Watchdog: if self-prompt died, restart every 40s
            setInterval(() => {
                try {
                    if (!this.self_prompter) return;
                    if (this.self_prompter.isActive && this.self_prompter.isActive()) return;
                    console.log('[DreamBot] restarting self-prompt');
                    this.self_prompter.start('Continue survival: collect wood nearby, craft tools, do not stop.');
                } catch (e) {
                    console.warn('[DreamBot] self-prompt restart', e.message);
                }
            }, 40000);

            try {
                clearTimeout(spawnTimeout);`
    );
    console.log('[fetch-base] agent: passive + watchdog');
  }

  write('src/agent/agent.js', agent);

  // modes: never kill on stuck
  let modes = read('src/agent/modes.js');
  modes = modes.replace(
    /this\.agent\.cleanKill\([^)]*[Ss]tuck[^)]*\)/g,
    `console.warn('[DreamBot] stuck recovery'); try { const b=this.agent.bot; b.setControlState('jump',true); b.setControlState('forward',true); setTimeout(()=>{try{b.setControlState('jump',false);b.setControlState('forward',false);}catch(_){}},500);}catch(_){}`
  );
  modes = modes.replace(
    /agent\.cleanKill\(['"][^'"]*stuck[^'"]*['"][^)]*\)/gi,
    `console.warn('[DreamBot] stuck — stay online')`
  );
  write('src/agent/modes.js', modes);
  console.log('[fetch-base] modes: unstuck');

  // skills sprint
  let skills = read('src/agent/library/skills.js');
  if (skills.includes('goToGoal') && !skills.includes('[DreamBot] sprint')) {
    skills = skills.replace(
      /(async function goToGoal\([^)]*\)\s*\{)/,
      `$1
    try { bot.setControlState('sprint', true); } catch (_) {} // [DreamBot] sprint
`
    );
    write('src/agent/library/skills.js', skills);
  }

  // self_prompter: almost never stop; auto-resume
  let sp = read('src/agent/self_prompter.js');
  sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 50');
  if (sp.includes('Stopping auto-prompting')) {
    sp = sp.replace(
      /let out = `Agent did not use command[\s\S]*?this\.state = STOPPED;/,
      `console.warn('[DreamBot] self-prompt soft pause');
                    this.state = PAUSED;
                    setTimeout(() => { try { if (this.state === PAUSED) this.start(this.prompt || 'Survive and collect wood.'); } catch(_){} }, 15000);`
    );
  }
  // if it sets STOPPED elsewhere on no command, soften
  sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED; /* DreamBot keep alive */');
  write('src/agent/self_prompter.js', sp);
  console.log('[fetch-base] self_prompter hardened');

  // mcdata version
  let mc = read('src/utils/mcdata.js');
  if (!mc.includes('DreamBot: NEVER delete version')) {
    const forceBlock = `// DreamBot: NEVER delete version
    options.version = options.version || '${FORCED_VERSION}';
    console.log('[DreamBot] Connecting with version:', options.version, 'host:', options.host, 'port:', options.port);`;
    mc = mc.replace(
      /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*['"]auto['"]\s*\)\s*\{[\s\S]*?delete\s+options\.version;[\s\S]*?\}/m,
      forceBlock
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
    try { run('node "' + ms + '"'); } catch (_) {}
  }

  console.log('[fetch-base] Ready. version=', FORCED_VERSION, 'AI=groq/gpt-oss-20b');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
