/**
 * DreamBot = Mindcraft + survival progression worker (techtree-like without task system)
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
  ]) {
    const from = join(TMP, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
    cpSync(from, join(ROOT, rel));
    console.log('[fetch-base] restored', rel);
  }
  const defFrom = join(TMP, 'profiles', 'defaults');
  const defTo = join(ROOT, 'profiles', 'defaults');
  if (existsSync(defFrom)) {
    mkdirSync(defTo, { recursive: true });
    try { run(`cp -rn "${defFrom}/." "${defTo}/" 2>/dev/null || true`); } catch {}
  }
}

function applyFixes() {
  let modes = read('src/agent/modes.js');
  modes = modes.replace(
    /if\s*\(\s*agent\.self_prompter\.isActive\(\)\s*\)\s*\n?\s*agent\.self_prompter\.stopLoop\(\);/,
    '// DreamBot: keep self-prompt'
  );
  modes = modes.replace(/max_stuck_time:\s*20/, 'max_stuck_time: 55');
  modes = modes.replace(
    /agent\.cleanKill\(["']Got stuck[^"']*["']\)/g,
    `console.warn('[DreamBot] stuck — stay online')`
  );
  if (!modes.includes('[DreamBot] resume after mode')) {
    modes = modes.replace(
      /if\s*\(\s*should_reprompt\s*\)\s*\{/,
      `// [DreamBot] resume after mode
    try {
      if (agent.self_prompter && !agent.self_prompter.isActive()) {
        setTimeout(() => {
          try { agent.self_prompter.start(agent.self_prompter.prompt || 'Survive with !commands'); } catch {}
        }, 6000);
      }
    } catch {}
    if (should_reprompt) {`
    );
  }
  write('src/agent/modes.js', modes);

  let skills = read('src/agent/library/skills.js');
  if (!skills.includes('[DreamBot] soft PathStopped')) {
    skills = skills.replace(
      /try \{\s*await bot\.pathfinder\.goto\(goal\);\s*clearInterval\(doorCheckInterval\);\s*return true;\s*\} catch \(err\) \{\s*clearInterval\(doorCheckInterval\);\s*\/\/[^\n]*\n\s*throw err;\s*\}/,
      `try {
        try { bot.setControlState('sprint', true); } catch {}
        await bot.pathfinder.goto(goal);
        clearInterval(doorCheckInterval);
        return true;
    } catch (err) {
        clearInterval(doorCheckInterval);
        // [DreamBot] soft PathStopped
        if (/PathStopped|NoPath|Timeout|path/i.test(String(err?.message || err))) {
            console.warn('[DreamBot] PathStopped ok');
            return false;
        }
        throw err;
    }`
    );
  }
  write('src/agent/library/skills.js', skills);

  let agent = read('src/agent/agent.js');
  if (agent.includes('Hello world! I am')) {
    agent = agent.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/,
      `try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
                this.self_prompter.start('Survive: wood, craft tools, mine, food, shelter. Always !command.');
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
        if (/groq|rate.?limit|brain disconnected|api key|restarting|exiting|hello world|PathStopped|passivo/i.test(__m)) {
            console.warn('[DreamBot] suppressed:', __m.slice(0, 50));
            return;
        }`
    );
  }
  if (agent.includes("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.')")) {
    agent = agent.replace(
      /cleanKill\(msg='Killing agent process\.\.\.', code=1\) \{\s*this\.history\.add\('system', msg\);\s*this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);\s*this\.history\.save\(\);\s*process\.exit\(code\);\s*\}/,
      `cleanKill(msg='Killing agent process...', code=1) {
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', msg); this.history.save(); } catch {}
        if (/stuck|unstuck|not spawned|PathStopped/i.test(String(msg))) return;
        process.exit(code);
    }`
    );
  }

  // FULL survival progression worker (Mindcraft techtree-like, no LLM required)
  if (!agent.includes('[DreamBot] survival worker')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            try {
                const pf = await import('mineflayer-pathfinder');
                const Movements = pf.Movements || pf.default?.Movements;
                if (Movements) {
                    const m = new Movements(this.bot);
                    m.allowSprinting = true;
                    m.allowParkour = true;
                    m.allow1by1towers = true;
                    m.canDig = true;
                    m.maxDropDown = 4;
                    this.bot.pathfinder.setMovements(m);
                    console.log('[DreamBot] pathfinder ON');
                }
            } catch (e) { console.warn('[DreamBot] pathfinder', e.message); }

            // Save home on first spawn
            try {
                if (!this._homePos && this.bot.entity) {
                    this._homePos = this.bot.entity.position.clone();
                    console.log('[DreamBot] home set', this._homePos);
                }
            } catch {}

            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity || this.actions?.executing) return;
                    if (bot.pathfinder?.isMoving?.()) return;
                    console.log('[DreamBot] survival worker');
                    try { bot.modes?.pause?.('unstuck'); } catch {}
                    const skills = await import('./library/skills.js');
                    const inv = bot.inventory.items();
                    const count = (n) => inv.filter(i => i.name === n || (n.endsWith('_log') && /_log$/.test(i.name))).reduce((a,i)=>a+i.count,0);
                    const has = (n) => inv.some(i => i.name === n || (typeof n === 'object' && n.test?.(i.name)));
                    const logs = inv.filter(i => /_log$/.test(i.name)).reduce((a,i)=>a+i.count,0);
                    const planks = inv.filter(i => /_planks$/.test(i.name)).reduce((a,i)=>a+i.count,0);
                    const hasTable = has('crafting_table');
                    const hasPick = inv.some(i => /pickaxe/.test(i.name));
                    const hasAxe = inv.some(i => /_axe$/.test(i.name) && !/pickaxe/.test(i.name));
                    const sticks = count('stick');
                    const cobble = count('cobblestone') + count('stone');

                    // 1) Need wood
                    if (logs < 6 && !hasPick) {
                        for (const k of ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log']) {
                            try { if (await skills.collectBlock(bot, k, 3)) { console.log('[DreamBot] wood', k); return; } } catch {}
                        }
                        const log = bot.findBlock({ matching: b => b && /_log$/.test(b.name), maxDistance: 12 });
                        if (log) { try { await bot.dig(log); return; } catch {} }
                    }

                    // 2) Planks
                    if (logs >= 1 && planks < 8) {
                        try {
                            const wood = inv.find(i => /_log$/.test(i.name));
                            if (wood) {
                                const name = wood.name.replace('_log','_planks').replace('log', 'planks');
                                // oak_log -> oak_planks
                                const recipeName = wood.name.includes('log') ? wood.name.replace('_log','_planks') : 'oak_planks';
                                await skills.craftRecipe(bot, recipeName, 2);
                                console.log('[DreamBot] crafted planks');
                                return;
                            }
                        } catch (e) { console.warn('[DreamBot] planks', e.message); }
                    }

                    // 3) Crafting table
                    if (!hasTable && planks >= 4) {
                        try {
                            await skills.craftRecipe(bot, 'crafting_table', 1);
                            console.log('[DreamBot] crafted table');
                            return;
                        } catch (e) { console.warn('[DreamBot] table', e.message); }
                    }

                    // 4) Sticks
                    if (sticks < 4 && planks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'stick', 4);
                            console.log('[DreamBot] sticks');
                            return;
                        } catch {}
                    }

                    // 5) Wooden tools
                    if (!hasPick && planks >= 3 && sticks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
                            await skills.equip(bot, 'wooden_pickaxe');
                            console.log('[DreamBot] wooden pickaxe');
                            return;
                        } catch (e) { console.warn('[DreamBot] pick', e.message); }
                    }
                    if (!hasAxe && planks >= 3 && sticks >= 2) {
                        try { await skills.craftRecipe(bot, 'wooden_axe', 1); return; } catch {}
                    }

                    // 6) Mine stone
                    if (hasPick && cobble < 12) {
                        try {
                            if (await skills.collectBlock(bot, 'stone', 5)) {
                                console.log('[DreamBot] stone');
                                return;
                            }
                        } catch {}
                        try {
                            if (await skills.collectBlock(bot, 'cobblestone', 5)) return;
                        } catch {}
                    }

                    // 7) Stone tools
                    if (cobble >= 3 && sticks >= 2 && !inv.some(i => i.name === 'stone_pickaxe')) {
                        try {
                            await skills.craftRecipe(bot, 'stone_pickaxe', 1);
                            await skills.equip(bot, 'stone_pickaxe');
                            console.log('[DreamBot] stone pickaxe');
                            return;
                        } catch {}
                    }

                    // 8) Food: hunt via skill if hungry
                    if (bot.food < 16) {
                        try {
                            for (const mob of ['chicken','cow','pig','sheep']) {
                                try {
                                    if (await skills.attackNearest(bot, mob, true)) {
                                        console.log('[DreamBot] hunted', mob);
                                        return;
                                    }
                                } catch {}
                            }
                        } catch {}
                    }

                    // 9) Night: try bed
                    try {
                        const t = bot.time?.timeOfDay;
                        if (t != null && (t > 13000 || t < 1000)) {
                            try { await skills.goToBed(bot); console.log('[DreamBot] slept'); return; } catch {}
                        }
                    } catch {}

                    // 10) Explore
                    try { await skills.moveAway(bot, 10); console.log('[DreamBot] explore'); } catch {
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        bot.setControlState('jump', true);
                        setTimeout(() => {
                            try {
                                bot.setControlState('jump', false);
                                bot.setControlState('forward', false);
                                bot.setControlState('sprint', false);
                                bot.look(bot.entity.yaw + 0.9, 0);
                            } catch {}
                        }, 500);
                    }
                    try { bot.modes?.unpause?.('unstuck'); } catch {}
                } catch (e) {
                    if (!/PathStopped/i.test(String(e?.message||e)))
                        console.warn('[DreamBot] survival', e.message);
                }
            }, 14000);

            setInterval(() => {
                try {
                    if (!this.self_prompter) return;
                    if (this.self_prompter.isActive?.()) return;
                    console.log('[DreamBot] self-prompt restart');
                    this.self_prompter.start('Survive: wood tools stone food shelter. Use !commands.');
                } catch {}
            }, 50000);

            try {
                clearTimeout(spawnTimeout);`
    );
  }
  write('src/agent/agent.js', agent);

  let sp = read('src/agent/self_prompter.js');
  sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 30');
  if (sp.includes('Stopping auto-prompting')) {
    sp = sp.replace(
      /let out = `Agent did not use command[\s\S]*?this\.state = STOPPED;/,
      `console.warn('[DreamBot] soft pause');
                    this.state = PAUSED;
                    setTimeout(() => { try { this.start(this.prompt || 'Survive'); } catch {} }, 20000);`
    );
  }
  sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');
  write('src/agent/self_prompter.js', sp);

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

  console.log('[fetch-base] Mindcraft + survival progression applied');
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
  const ms = join(ROOT, 'scripts', 'patch-mindserver.js');
  if (existsSync(ms)) { try { run(`node "${ms}"`); } catch {} }
  console.log('[fetch-base] Ready — survival techtree worker');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
