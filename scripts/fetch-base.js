/**
 * DreamBot fetch-base: clone Mindcraft, apply fixes in pure JS (no fragile .patch files).
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
    'src/models/cerebras.js',
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

/** Apply all DreamBot behavior fixes with string edits (reliable on Railway). */
function applyDreamBotFixes() {
  // ---- agent.js ----
  let agent = read('src/agent/agent.js');

  // 1) No Hello world; start self-prompt instead
  if (agent.includes('Hello world! I am')) {
    agent = agent.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/,
      `try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
                this.self_prompter.start('Survive: collect wood, craft tools, mine, place blocks. Never mention API.');
            }
        } catch (e) {}`
    );
    console.log('[fetch-base] agent: no Hello world + self-prompt');
  }

  // 2) openChat silence filter
  if (!agent.includes('[DreamBot] suppressed chat')) {
    agent = agent.replace(
      /async openChat\(message\) \{/,
      `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/groq|cerebras|rate.?limit|429|tarifa|indispon|passivo|passive|artesanato|did not use command|n[aã]o usou o comando|stopping auto|parando a solicita|brain disconnected|try again|api key|modo pass|continue passive|unavailable|continue passivo|restarting|exiting|hello world/i.test(__m)) {
            console.warn('[DreamBot] suppressed chat:', __m.slice(0, 100));
            return;
        }`
    );
    console.log('[fetch-base] agent: openChat silence');
  }

  // 3) cleanKill: no Exiting chat; soft-fail on stuck
  if (agent.includes("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.')")) {
    agent = agent.replace(
      /cleanKill\(msg='Killing agent process\.\.\.', code=1\) \{\s*this\.history\.add\('system', msg\);\s*this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);\s*this\.history\.save\(\);\s*process\.exit\(code\);\s*\}/,
      `cleanKill(msg='Killing agent process...', code=1) {
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', msg); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|not spawned/i.test(String(msg))) {
            console.warn('[DreamBot] soft fail — stay in game');
            return;
        }
        process.exit(code);
    }`
    );
    console.log('[fetch-base] agent: cleanKill fixed');
  }

  // 4) Passive survival loop on spawn (no AI needed)
  if (!agent.includes('[DreamBot] passive loop')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            // Passive survival without LLM
            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity || this.actions?.executing) return;
                    if (bot.lastDamageTime && Date.now() - bot.lastDamageTime < 3000) return;
                    const skills = await import('./library/skills.js');
                    try { await skills.pickupNearbyItems(bot); } catch (_) {}
                    if (bot.health < 10) {
                        try { await skills.defendSelf(bot, 8); } catch (_) {}
                        return;
                    }
                    const inv = bot.inventory.items();
                    const hasPick = inv.some(i => /pickaxe/i.test(i.name));
                    const logCount = inv.filter(i => /_log$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
                    if (!hasPick && logCount < 8) {
                        const kinds = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];
                        let done = false;
                        for (const k of kinds) {
                            try { await skills.collectBlock(bot, k, 2); done = true; break; } catch (_) {}
                        }
                        if (!done) {
                            try {
                                const block = bot.findBlock({ matching: (b) => b && /_log$/i.test(b.name), maxDistance: 16 });
                                if (block) { try { await bot.dig(block); } catch (_) {} }
                                else { try { await skills.moveAway(bot, 10); } catch (_) {} }
                            } catch (_) {}
                        }
                        return;
                    }
                    if (hasPick) {
                        try { await skills.collectBlock(bot, 'stone', 4); } catch (_) {
                            try { await skills.moveAway(bot, 8); } catch (_) {}
                        }
                        return;
                    }
                    try { await skills.moveAway(bot, 6); } catch (_) {}
                } catch (e) {
                    console.warn('[DreamBot] passive loop', e.message);
                }
            }, 12000);
            setInterval(() => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity || this.actions?.executing) return;
                    const v = bot.entity.velocity;
                    if (v && Math.abs(v.x) + Math.abs(v.z) > 0.04) return;
                    bot.setControlState('sprint', true);
                    bot.setControlState('forward', true);
                    setTimeout(() => {
                        try { bot.setControlState('forward', false); bot.setControlState('sprint', false); } catch (_) {}
                    }, 800);
                } catch (_) {}
            }, 15000);

            try {
                clearTimeout(spawnTimeout);`
    );
    console.log('[fetch-base] agent: passive survival loop');
  }

  write('src/agent/agent.js', agent);

  // ---- modes.js: unstuck must not kill process / chat Exiting ----
  let modes = read('src/agent/modes.js');
  if (modes.includes('Got stuck and could not recover')) {
    modes = modes.replace(
      /this\.agent\.cleanKill\([^)]*Got stuck[^)]*\)/g,
      `console.warn('[DreamBot] stuck recovery — not exiting'); try { this.agent.bot.setControlState('jump', true); setTimeout(() => { try { this.agent.bot.setControlState('jump', false); } catch(_){} }, 400); } catch(_){}`
    );
    console.log('[fetch-base] modes: unstuck no kill');
  }
  // also catch generic cleanKill from unstuck mode if different wording
  modes = modes.replace(
    /agent\.cleanKill\(['"][^'"]*stuck[^'"]*['"][^)]*\)/gi,
    `console.warn('[DreamBot] stuck — stay online')`
  );
  write('src/agent/modes.js', modes);

  // ---- skills.js: sprint on goto ----
  let skills = read('src/agent/library/skills.js');
  if (skills.includes('goToGoal') && !skills.includes('[DreamBot] sprint')) {
    skills = skills.replace(
      /(async function goToGoal\([^)]*\)\s*\{)/,
      `$1
    try { bot.setControlState('sprint', true); } catch (_) {} // [DreamBot] sprint
`
    );
    write('src/agent/library/skills.js', skills);
    console.log('[fetch-base] skills: sprint');
  }

  // ---- self_prompter: don't stop permanently ----
  let sp = read('src/agent/self_prompter.js');
  if (sp.includes('MAX_NO_COMMAND = 3')) {
    sp = sp.replace('MAX_NO_COMMAND = 3', 'MAX_NO_COMMAND = 20');
  }
  if (sp.includes('Stopping auto-prompting')) {
    sp = sp.replace(
      /let out = `Agent did not use command[\s\S]*?this\.state = STOPPED;/,
      `console.warn('[DreamBot] self-prompt pause (no chat)');
                    this.state = PAUSED;`
    );
  }
  write('src/agent/self_prompter.js', sp);
  console.log('[fetch-base] self_prompter softened');

  // ---- mcdata: force version ----
  let mc = read('src/utils/mcdata.js');
  if (!mc.includes('DreamBot: NEVER delete version')) {
    const forceBlock = `// DreamBot: NEVER delete version
    options.version = options.version || '${FORCED_VERSION}';
    console.log('[DreamBot] Connecting with version:', options.version, 'host:', options.host, 'port:', options.port);`;
    mc = mc.replace(
      /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*['"]auto['"]\s*\)\s*\{[\s\S]*?delete\s+options\.version;[\s\S]*?\}/m,
      forceBlock
    );
    // also if version is false
    if (mc.includes("mc_version === false") || mc.includes('mc_version === false')) {
      mc = mc.replace(
        /if\s*\([^)]*mc_version[^)]*\)\s*\{[\s\S]*?delete\s+options\.version;[\s\S]*?\}/m,
        forceBlock
      );
    }
    write('src/utils/mcdata.js', mc);
    console.log('[fetch-base] mcdata: force', FORCED_VERSION);
  }

  // ---- cerebras: silent errors (empty string, no chat spam) ----
  const cerebrasPath = join(ROOT, 'src/models/cerebras.js');
  if (existsSync(cerebrasPath)) {
    let cb = readFileSync(cerebrasPath, 'utf8');
    if (cb.includes('My brain disconnected')) {
      cb = cb.replace(
        /res = 'My brain disconnected, try again\.';/,
        `res = ''; console.warn('[DreamBot] Cerebras error — silent passive');`
      );
      write('src/models/cerebras.js', cb);
      console.log('[fetch-base] cerebras: silent errors');
    }
  }

  // Keep profile model as cerebras (don't overwrite user's dream.json from upstream)
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
  writeStub(
    'src/agent/vision/browser_viewer.js',
    'export function addBrowserViewer() {}\nexport function addViewer() {}\nexport default { addBrowserViewer, addViewer };\n'
  );
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

  const ms = join(ROOT, 'scripts', 'patch-mindserver.js');
  if (existsSync(ms)) {
    try {
      run('node "' + ms + '"');
    } catch (_) {}
  }

  console.log('[fetch-base] Ready. version=', FORCED_VERSION, 'AI=cerebras/gpt-oss-120b');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
