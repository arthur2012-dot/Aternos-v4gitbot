/**
 * DreamBot = Mindcraft + terrain adaptation + survival worker
 * Pathfinder digs/climbs; obstacle loop digs walls and jumps steps.
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
  // —— modes: never kill self-prompt; soft stuck ——
  let modes = read('src/agent/modes.js');
  modes = modes.replace(
    /if\s*\(\s*agent\.self_prompter\.isActive\(\)\s*\)\s*\n?\s*agent\.self_prompter\.stopLoop\(\);/,
    '// DreamBot: keep self-prompt'
  );
  modes = modes.replace(/max_stuck_time:\s*20/, 'max_stuck_time: 60');
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
        }, 5000);
      }
    } catch {}
    if (should_reprompt) {`
    );
  }
  write('src/agent/modes.js', modes);

  // —— skills: soft PathStopped + sprint + dig-friendly path ——
  let skills = read('src/agent/library/skills.js');
  if (!skills.includes('[DreamBot] soft PathStopped')) {
    skills = skills.replace(
      /try \{\s*await bot\.pathfinder\.goto\(goal\);\s*clearInterval\(doorCheckInterval\);\s*return true;\s*\} catch \(err\) \{\s*clearInterval\(doorCheckInterval\);\s*\/\/[^\n]*\n\s*throw err;\s*\}/,
      `try {
        try {
          const pf = await import('mineflayer-pathfinder');
          const Movements = pf.Movements || pf.default?.Movements;
          if (Movements && bot.pathfinder) {
            const m = new Movements(bot);
            m.canDig = true;
            m.allowSprinting = true;
            m.allowParkour = true;
            m.allow1by1towers = true;
            m.maxDropDown = 4;
            m.digCost = 1;
            m.placeCost = 1;
            try { m.canOpenDoors = true; } catch {}
            bot.pathfinder.setMovements(m);
          }
        } catch {}
        try { bot.setControlState('sprint', true); } catch {}
        await bot.pathfinder.goto(goal);
        clearInterval(doorCheckInterval);
        return true;
    } catch (err) {
        clearInterval(doorCheckInterval);
        // [DreamBot] soft PathStopped
        if (/PathStopped|NoPath|Timeout|path|GoalChanged/i.test(String(err?.message || err))) {
            console.warn('[DreamBot] PathStopped ok');
            return false;
        }
        throw err;
    }`
    );
  }
  // collectBlock: ignore PathStopped mid-collect
  if (!skills.includes('[DreamBot] collect soft')) {
    skills = skills.replace(
      /console\.log\(err\);\s*\/\/ log pathfinder errors for debugging/g,
      `// [DreamBot] collect soft
            if (/PathStopped|NoPath|Timeout|GoalChanged/i.test(String(err?.message || err))) {
                console.warn('[DreamBot] collect path interrupted, continue');
            } else {
                console.log(err);
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
                this.self_prompter.start('Survive: wood, craft, mine, food. Always end with !command.');
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

  // Terrain + survival worker
  if (!agent.includes('[DreamBot] terrain worker')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
            } catch {}
            try {
                const pf = await import('mineflayer-pathfinder');
                const Movements = pf.Movements || pf.default?.Movements;
                if (Movements) {
                    const m = new Movements(this.bot);
                    m.canDig = true;
                    m.allowSprinting = true;
                    m.allowParkour = true;
                    m.allow1by1towers = true;
                    m.maxDropDown = 4;
                    m.digCost = 1;
                    m.placeCost = 1;
                    try { m.canOpenDoors = true; } catch {}
                    this.bot.pathfinder.setMovements(m);
                    console.log('[DreamBot] pathfinder dig+parkour+sprint ON');
                }
            } catch (e) { console.warn('[DreamBot] pathfinder', e.message); }

            try {
                if (!this._homePos && this.bot.entity) {
                    this._homePos = this.bot.entity.position.clone();
                }
            } catch {}

            // TERRAIN ADAPTATION every 2.5s: dig wall, jump step, climb
            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    const pos = bot.entity.position;
                    const yaw = bot.entity.yaw;
                    const dx = -Math.sin(yaw);
                    const dz = -Math.cos(yaw);
                    const fx = Math.floor(pos.x + dx * 1.2);
                    const fz = Math.floor(pos.z + dz * 1.2);
                    const fy = Math.floor(pos.y);

                    const blockAt = (x, y, z) => {
                        try { return bot.blockAt(new bot.Vec3(x, y, z)); } catch { return null; }
                    };
                    // Vec3 may be on bot or via vec3 package
                    let Vec3 = bot.Vec3;
                    try { if (!Vec3) Vec3 = (await import('vec3')).default || (await import('vec3')).Vec3; } catch {}
                    if (!Vec3) return;

                    const feet = bot.blockAt(new Vec3(fx, fy, fz));
                    const head = bot.blockAt(new Vec3(fx, fy + 1, fz));
                    const aboveHead = bot.blockAt(new Vec3(fx, fy + 2, fz));
                    const step = bot.blockAt(new Vec3(fx, fy, fz));
                    const aboveStep = bot.blockAt(new Vec3(fx, fy + 1, fz));

                    const solid = (b) => b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air'
                        && !b.name.includes('water') && !b.name.includes('lava')
                        && b.boundingBox === 'block';

                    // Wall at head height → dig it (don't bash forever)
                    if (solid(head) && bot.canDigBlock?.(head) !== false) {
                        try {
                            console.log('[DreamBot] dig wall', head.name);
                            await bot.dig(head);
                            return;
                        } catch {}
                    }
                    // Block at feet blocking path, free above → jump over 1-block step
                    if (solid(feet) && !solid(aboveStep) && !solid(aboveHead)) {
                        try {
                            bot.setControlState('jump', true);
                            bot.setControlState('forward', true);
                            bot.setControlState('sprint', true);
                            setTimeout(() => {
                                try {
                                    bot.setControlState('jump', false);
                                    bot.setControlState('forward', false);
                                    bot.setControlState('sprint', false);
                                } catch {}
                            }, 400);
                            console.log('[DreamBot] jump step');
                            return;
                        } catch {}
                    }
                    // Tall wall: dig feet block too
                    if (solid(feet) && solid(head)) {
                        try {
                            if (bot.canDigBlock?.(feet) !== false) {
                                console.log('[DreamBot] dig obstacle', feet.name);
                                await bot.dig(feet);
                                return;
                            }
                        } catch {}
                    }
                    // Block above head while moving (ceiling) → dig
                    const ceil = bot.blockAt(new Vec3(Math.floor(pos.x), fy + 2, Math.floor(pos.z)));
                    if (solid(ceil) && bot.entity.velocity && Math.abs(bot.entity.velocity.y) > 0.05) {
                        try { await bot.dig(ceil); } catch {}
                    }
                } catch (e) {
                    // ignore
                }
            }, 2500);

            // If velocity ~0 for a bit while trying to move, dig forward or turn
            let stillTicks = 0;
            let lastPos = null;
            setInterval(() => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    const p = bot.entity.position;
                    if (lastPos && p.distanceTo(lastPos) < 0.15) {
                        stillTicks++;
                    } else {
                        stillTicks = 0;
                    }
                    lastPos = p.clone();
                    if (stillTicks >= 3) {
                        stillTicks = 0;
                        // turn a bit and jump+sprint
                        bot.look(bot.entity.yaw + (Math.random() > 0.5 ? 0.8 : -0.8), 0);
                        bot.setControlState('jump', true);
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        setTimeout(() => {
                            try {
                                bot.setControlState('jump', false);
                                bot.setControlState('forward', false);
                                bot.setControlState('sprint', false);
                            } catch {}
                        }, 500);
                        console.log('[DreamBot] unstick turn+jump');
                    }
                } catch {}
            }, 2000);

            // SURVIVAL WORKER every 12s
            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (this.actions?.executing) return;
                    if (bot.pathfinder?.isMoving?.()) return;
                    console.log('[DreamBot] survival worker');
                    try { bot.modes?.pause?.('unstuck'); } catch {}
                    const skills = await import('./library/skills.js');
                    const inv = bot.inventory.items();
                    const count = (n) => inv.filter(i => i.name === n).reduce((a, i) => a + i.count, 0);
                    const has = (n) => inv.some(i => i.name === n);
                    const logs = inv.filter(i => /_log$/.test(i.name)).reduce((a, i) => a + i.count, 0);
                    const planks = inv.filter(i => /_planks$/.test(i.name)).reduce((a, i) => a + i.count, 0);
                    const hasTable = has('crafting_table');
                    const hasPick = inv.some(i => /pickaxe/.test(i.name));
                    const sticks = count('stick');
                    const cobble = count('cobblestone') + count('stone');

                    if (logs < 8 && !hasPick) {
                        for (const k of ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log']) {
                            try {
                                if (await skills.collectBlock(bot, k, 4)) {
                                    console.log('[DreamBot] wood', k);
                                    return;
                                }
                            } catch {}
                        }
                        const log = bot.findBlock({ matching: b => b && /_log$/.test(b.name), maxDistance: 16 });
                        if (log) {
                            try {
                                // walk closer without long path if possible
                                if (log.position.distanceTo(bot.entity.position) > 4) {
                                    try { await skills.goToPosition(bot, log.position.x, log.position.y, log.position.z, 2); } catch {}
                                }
                                await bot.dig(log);
                                console.log('[DreamBot] dig log');
                                return;
                            } catch {}
                        }
                    }

                    if (logs >= 1 && planks < 8) {
                        try {
                            const wood = inv.find(i => /_log$/.test(i.name));
                            if (wood) {
                                const recipeName = wood.name.replace('_log', '_planks');
                                await skills.craftRecipe(bot, recipeName, 2);
                                console.log('[DreamBot] planks');
                                return;
                            }
                        } catch (e) { console.warn('[DreamBot] planks', e.message); }
                    }

                    if (!hasTable && planks >= 4) {
                        try {
                            await skills.craftRecipe(bot, 'crafting_table', 1);
                            console.log('[DreamBot] table');
                            return;
                        } catch (e) { console.warn('[DreamBot] table', e.message); }
                    }

                    if (sticks < 4 && planks >= 2) {
                        try { await skills.craftRecipe(bot, 'stick', 4); console.log('[DreamBot] sticks'); return; } catch {}
                    }

                    if (!hasPick && planks >= 3 && sticks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
                            await skills.equip(bot, 'wooden_pickaxe');
                            console.log('[DreamBot] wooden pickaxe');
                            return;
                        } catch (e) { console.warn('[DreamBot] pick', e.message); }
                    }

                    if (hasPick && cobble < 12) {
                        try {
                            if (await skills.collectBlock(bot, 'stone', 6)) {
                                console.log('[DreamBot] stone');
                                return;
                            }
                        } catch {}
                    }

                    if (cobble >= 3 && sticks >= 2 && !has('stone_pickaxe')) {
                        try {
                            await skills.craftRecipe(bot, 'stone_pickaxe', 1);
                            await skills.equip(bot, 'stone_pickaxe');
                            console.log('[DreamBot] stone pickaxe');
                            return;
                        } catch {}
                    }

                    if (bot.food < 14) {
                        try {
                            for (const mob of ['chicken', 'cow', 'pig', 'sheep']) {
                                try {
                                    if (await skills.attackNearest(bot, mob, true)) {
                                        console.log('[DreamBot] hunt', mob);
                                        return;
                                    }
                                } catch {}
                            }
                        } catch {}
                    }

                    try {
                        const t = bot.time?.timeOfDay;
                        if (t != null && (t > 13000 || t < 1000)) {
                            try { await skills.goToBed(bot); return; } catch {}
                        }
                    } catch {}

                    try {
                        await skills.moveAway(bot, 12);
                        console.log('[DreamBot] explore');
                    } catch {
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        bot.setControlState('jump', true);
                        setTimeout(() => {
                            try {
                                bot.setControlState('jump', false);
                                bot.setControlState('forward', false);
                                bot.setControlState('sprint', false);
                                bot.look(bot.entity.yaw + 1.0, 0);
                            } catch {}
                        }, 600);
                    }
                    try { bot.modes?.unpause?.('unstuck'); } catch {}
                } catch (e) {
                    if (!/PathStopped/i.test(String(e?.message || e)))
                        console.warn('[DreamBot] survival', e.message);
                }
            }, 12000);

            setInterval(() => {
                try {
                    if (!this.self_prompter) return;
                    if (this.self_prompter.isActive?.()) return;
                    this.self_prompter.start('Survive: wood tools stone food. Always !command.');
                } catch {}
            }, 45000);

            try {
                // original clearTimeout already attempted above
                if (false) clearTimeout(spawnTimeout);`
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
                    setTimeout(() => { try { this.start(this.prompt || 'Survive'); } catch {} }, 15000);`
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

  console.log('[fetch-base] terrain adaptation + survival applied');
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
  console.log('[fetch-base] Ready — dig walls, jump steps, climb, survival');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
