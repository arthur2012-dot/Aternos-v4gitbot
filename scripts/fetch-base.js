/**
 * DreamBot — Mindcraft base + crash fixes + aggressive local NAV
 * Fixes: prompt.replaceAll TypeError, stuck against walls, freeze on dig
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
  const defFrom = join(TMP, 'profiles', 'defaults');
  const defTo = join(ROOT, 'profiles', 'defaults');
  if (existsSync(defFrom)) {
    mkdirSync(defTo, { recursive: true });
    try { run(`cp -rn "${defFrom}/." "${defTo}/" 2>/dev/null || true`); } catch {}
  }
}

function applyFixes() {
  // ===== CRITICAL: prompter replaceAll crash =====
  // TypeError: prompt.replaceAll is not a function when prompt is not a string
  try {
    let prompter = read('src/models/prompter.js');
    if (!prompter.includes('[DreamBot] safeReplace')) {
      // Inject safe helper near top of class usage / before replaceStrings
      if (prompter.includes('async replaceStrings')) {
        prompter = prompter.replace(
          /async replaceStrings\s*\(/,
          `// [DreamBot] safeReplace — never call replaceAll on non-string
    _safeReplaceAll(str, search, repl) {
        const s = (str == null) ? '' : String(str);
        if (typeof s.replaceAll === 'function') {
            try { return s.replaceAll(search, repl); } catch {}
        }
        const esc = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return s.replace(new RegExp(esc, 'g'), repl == null ? '' : String(repl));
    }

    async replaceStrings(`
        );
        // Replace all prompt.replaceAll( with this._safeReplaceAll(prompt,
        prompter = prompter.replace(/prompt\s*=\s*prompt\.replaceAll\(/g, 'prompt = this._safeReplaceAll(prompt, ');
        // Also fix other .replaceAll on possibly non-strings in that function if any pattern like stats.replaceAll
        console.log('[fetch-base] prompter: safeReplace for replaceAll');
      }
      write('src/models/prompter.js', prompter);
    }
  } catch (e) {
    console.warn('[fetch-base] prompter patch', e.message);
  }

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
    modes = modes.replace(
      /(name:\s*['"]unstuck['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt */`
    );
    modes = modes.replace(
      /(name:\s*['"]hunting['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt */`
    );
    modes = modes.replace(
      /(name:\s*['"]item_collecting['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt */`
    );
    modes = modes.replace(
      /(name:\s*['"]torch_placing['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt */`
    );
    modes = modes.replace(
      /(name:\s*['"]elbow_room['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt */`
    );
    console.log('[fetch-base] soft interrupts');
  }
  write('src/agent/modes.js', modes);

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
  if (!skills.includes('[DreamBot] collect soft')) {
    skills = skills.replace(
      /console\.log\(err\);\s*\/\/ log pathfinder errors for debugging/g,
      `// [DreamBot] collect soft
            if (/PathStopped|NoPath|Timeout|GoalChanged/i.test(String(err?.message || err))) {
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
                this.self_prompter.start('Survive. Dig walls, jump steps, go around. Always !command.');
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
        if (/groq|rate.?limit|brain disconnected|api key|restarting|exiting|hello world|PathStopped|passivo|cooldown|replaceAll/i.test(__m)) {
            console.warn('[DreamBot] suppressed:', __m.slice(0, 40));
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
        if (/stuck|unstuck|not spawned|PathStopped|replaceAll/i.test(String(msg))) return;
        process.exit(code);
    }`
    );
  }

  if (!agent.includes('[DreamBot] NAV BRAIN v2')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            try { clearTimeout(spawnTimeout); } catch {}

            // [DreamBot] NAV BRAIN v2 — aggressive dig/jump/around, cancel path when stuck on block
            this._dreamLock = false;
            this._dreamLockUntil = 0;
            this._navBusy = false;

            const dreamBusy = () => this._dreamLock || Date.now() < (this._dreamLockUntil || 0);
            const dreamAcquire = (ms = 8000) => {
                if (dreamBusy()) return false;
                this._dreamLock = true;
                this._dreamLockUntil = Date.now() + ms;
                return true;
            };
            const dreamRelease = () => { this._dreamLock = false; this._dreamLockUntil = 0; };
            const isPathing = () => { try { return !!this.bot.pathfinder?.isMoving?.(); } catch { return false; } };
            const isActing = () => !!this.actions?.executing;

            const stopPath = () => {
                try {
                    if (this.bot.pathfinder) {
                        this.bot.pathfinder.setGoal(null);
                        this.bot.pathfinder.stop();
                    }
                } catch {}
            };
            const clearControls = () => {
                try {
                    const b = this.bot;
                    for (const c of ['jump','forward','back','left','right','sprint','sneak']) {
                        try { b.setControlState(c, false); } catch {}
                    }
                } catch {}
            };

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
                    console.log('[DreamBot] pathfinder dig+parkour+sprint');
                }
            } catch (e) { console.warn('[DreamBot] pf', e.message); }

            try {
                if (!this._homePos && this.bot.entity) this._homePos = this.bot.entity.position.clone();
            } catch {}

            // Aggressive local NAV every 1s — works while pathing (cancels path if wall-stuck)
            setInterval(async () => {
                if (this._navBusy) return;
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (this._dreamLock && Date.now() < (this._dreamLockUntil || 0) - 4000) return;

                    this._navBusy = true;
                    let Vec3;
                    try {
                        const v = await import('vec3');
                        Vec3 = v.default || v.Vec3;
                    } catch { this._navBusy = false; return; }

                    const solid = (b) => b && b.boundingBox === 'block'
                        && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air'
                        && !String(b.name).includes('water') && !String(b.name).includes('lava');
                    const air = (b) => !b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air'
                        || b.boundingBox === 'empty';

                    const pos = bot.entity.position;
                    const yaw = bot.entity.yaw;
                    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
                    const left = { x: Math.cos(yaw), z: -Math.sin(yaw) };
                    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };

                    const at = (ox, oy, oz) => {
                        try {
                            return bot.blockAt(new Vec3(
                                Math.floor(pos.x + ox),
                                Math.floor(pos.y + oy),
                                Math.floor(pos.z + oz)
                            ));
                        } catch { return null; }
                    };
                    const dirAt = (dir, dist, oy) => at(dir.x * dist, oy, dir.z * dist);

                    const fFeet = dirAt(fwd, 1, 0);
                    const fHead = dirAt(fwd, 1, 1);
                    const fAbove = dirAt(fwd, 1, 2);
                    const fDown = dirAt(fwd, 1, -1);
                    const f2Feet = dirAt(fwd, 2, 0);
                    const f2Head = dirAt(fwd, 2, 1);
                    const lFeet = dirAt(left, 1, 0);
                    const lHead = dirAt(left, 1, 1);
                    const rFeet = dirAt(right, 1, 0);
                    const rHead = dirAt(right, 1, 1);
                    const below = at(0, -1, 0);
                    const aboveHead = at(0, 2, 0);

                    const placeable = () => bot.inventory.items().find(i =>
                        /dirt|cobblestone|planks|netherrack|stone$|andesite|granite|diorite|deepslate|tuff|mossy/.test(i.name)
                    );

                    const finish = (ms = 0) => {
                        if (ms <= 0) { this._navBusy = false; return; }
                        setTimeout(() => { try { clearControls(); } catch {} this._navBusy = false; }, ms);
                    };

                    // 1) No floor
                    if (air(below)) {
                        stopPath();
                        const p = placeable();
                        if (p) {
                            try {
                                await bot.equip(p, 'hand');
                                for (const d of [fwd, left, right, { x: 0, z: 0 }]) {
                                    const ref = at(d.x, -1, d.z);
                                    if (solid(ref)) {
                                        await Promise.race([
                                            bot.placeBlock(ref, new Vec3(0, 1, 0)),
                                            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))
                                        ]);
                                        console.log('[DreamBot] NAV floor');
                                        finish(200);
                                        return;
                                    }
                                }
                            } catch {}
                        }
                        bot.setControlState('jump', true);
                        bot.setControlState('back', true);
                        finish(400);
                        console.log('[DreamBot] NAV edge');
                        return;
                    }

                    // 2) Gap → bridge or jump or turn
                    if (air(fDown) && air(fFeet)) {
                        stopPath();
                        const p = placeable();
                        if (p && solid(below)) {
                            try {
                                await bot.equip(p, 'hand');
                                const face = new Vec3(
                                    Math.abs(fwd.x) > Math.abs(fwd.z) ? (fwd.x > 0 ? 1 : -1) : 0,
                                    0,
                                    Math.abs(fwd.z) >= Math.abs(fwd.x) ? (fwd.z > 0 ? 1 : -1) : 0
                                );
                                await Promise.race([
                                    bot.placeBlock(below, face.x || face.z ? face : new Vec3(1, 0, 0)),
                                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))
                                ]);
                                console.log('[DreamBot] NAV bridge');
                                bot.setControlState('forward', true);
                                finish(350);
                                return;
                            } catch {}
                        }
                        const f2Down = dirAt(fwd, 2, -1);
                        if (solid(f2Down) && air(f2Feet)) {
                            bot.setControlState('sprint', true);
                            bot.setControlState('forward', true);
                            bot.setControlState('jump', true);
                            finish(450);
                            console.log('[DreamBot] NAV gap jump');
                            return;
                        }
                        bot.look(yaw + 1.3, 0);
                        bot.setControlState('forward', true);
                        finish(400);
                        console.log('[DreamBot] NAV avoid gap');
                        return;
                    }

                    // 3) Step up 1 block
                    if (solid(fFeet) && air(fHead) && air(fAbove)) {
                        stopPath();
                        bot.setControlState('jump', true);
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        finish(450);
                        console.log('[DreamBot] NAV jump step', fFeet?.name);
                        return;
                    }

                    // 4) Wall ahead — ALWAYS stop pathfinder first so we don't freeze hitting the block
                    if (solid(fHead) || (solid(fFeet) && solid(fHead))) {
                        stopPath();
                        const leftFree = air(lFeet) && air(lHead);
                        const rightFree = air(rFeet) && air(rHead);

                        if (leftFree && !rightFree) {
                            bot.look(yaw + Math.PI / 2, 0);
                            bot.setControlState('forward', true);
                            bot.setControlState('sprint', true);
                            finish(550);
                            console.log('[DreamBot] NAV left');
                            return;
                        }
                        if (rightFree && !leftFree) {
                            bot.look(yaw - Math.PI / 2, 0);
                            bot.setControlState('forward', true);
                            bot.setControlState('sprint', true);
                            finish(550);
                            console.log('[DreamBot] NAV right');
                            return;
                        }
                        if (leftFree && rightFree) {
                            bot.look(yaw + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2), 0);
                            bot.setControlState('forward', true);
                            bot.setControlState('sprint', true);
                            finish(500);
                            console.log('[DreamBot] NAV around');
                            return;
                        }

                        // Dig with timeout so dig never freezes the bot forever
                        const digSafe = async (block) => {
                            if (!block || !solid(block)) return;
                            try {
                                await Promise.race([
                                    bot.dig(block),
                                    new Promise((_, rej) => setTimeout(() => rej(new Error('dig timeout')), 4000))
                                ]);
                                console.log('[DreamBot] NAV dig', block.name);
                            } catch (e) {
                                console.warn('[DreamBot] dig fail', e.message);
                                try { bot.stopDigging?.(); } catch {}
                            }
                        };
                        if (solid(fHead)) await digSafe(fHead);
                        if (solid(fFeet)) await digSafe(fFeet);
                        // after dig, push forward briefly
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        finish(400);
                        return;
                    }

                    // 5) Ceiling
                    if (solid(aboveHead)) {
                        stopPath();
                        try {
                            await Promise.race([
                                bot.dig(aboveHead),
                                new Promise((_, rej) => setTimeout(() => rej(new Error('dig timeout')), 4000))
                            ]);
                            console.log('[DreamBot] NAV ceiling');
                        } catch { try { bot.stopDigging?.(); } catch {} }
                        finish(200);
                        return;
                    }

                    // 6) Obstacle 2 blocks ahead → early turn
                    if (solid(f2Feet) && solid(f2Head)) {
                        const lf = air(lFeet) && air(lHead);
                        const rf = air(rFeet) && air(rHead);
                        if (lf || rf) {
                            stopPath();
                            bot.look(yaw + (lf ? Math.PI / 3 : -Math.PI / 3), 0);
                            bot.setControlState('forward', true);
                            finish(400);
                            console.log('[DreamBot] NAV early turn');
                            return;
                        }
                    }

                    this._navBusy = false;
                } catch (e) {
                    try { clearControls(); } catch {}
                    this._navBusy = false;
                }
            }, 1000);

            // Stuck detector — stronger escape, always cancel path
            let still = 0;
            let lastP = null;
            setInterval(async () => {
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (this._navBusy) return;
                    const p = bot.entity.position;
                    if (lastP && p.distanceTo(lastP) < 0.1) still++;
                    else still = 0;
                    lastP = p.clone();
                    if (still < 4) return; // ~6s stuck
                    still = 0;
                    this._navBusy = true;
                    console.log('[DreamBot] NAV STUCK escape');
                    stopPath();
                    clearControls();

                    let Vec3;
                    try {
                        const v = await import('vec3');
                        Vec3 = v.default || v.Vec3;
                    } catch {}

                    if (Vec3) {
                        for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1],[0,2,0],[0,0,0]]) {
                            try {
                                const b = bot.blockAt(bot.entity.position.offset(ox, oy, oz));
                                if (b && b.boundingBox === 'block' && b.name !== 'air') {
                                    await Promise.race([
                                        bot.dig(b),
                                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))
                                    ]);
                                    console.log('[DreamBot] NAV dig out', b.name);
                                    break;
                                }
                            } catch { try { bot.stopDigging?.(); } catch {} }
                        }
                    }

                    const pl = bot.inventory.items().find(i => /dirt|cobblestone|planks|stone$/.test(i.name));
                    if (pl && Vec3) {
                        try {
                            await bot.equip(pl, 'hand');
                            const bel = bot.blockAt(bot.entity.position.offset(0, -1, 0));
                            if (bel) {
                                bot.setControlState('jump', true);
                                await new Promise(r => setTimeout(r, 180));
                                try { await bot.placeBlock(bel, new Vec3(0, 1, 0)); } catch {}
                                bot.setControlState('jump', false);
                                console.log('[DreamBot] NAV pillar');
                            }
                        } catch {}
                    }

                    bot.look(bot.entity.yaw + Math.PI * 0.7, 0);
                    bot.setControlState('jump', true);
                    bot.setControlState('forward', true);
                    bot.setControlState('sprint', true);
                    setTimeout(() => {
                        clearControls();
                        this._navBusy = false;
                    }, 800);
                } catch {
                    try { clearControls(); } catch {}
                    this._navBusy = false;
                }
            }, 1500);

            // PASSIVE survival progression
            setInterval(async () => {
                try {
                    if (dreamBusy() || this._navBusy || isPathing() || isActing()) return;
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (!dreamAcquire(18000)) return;
                    console.log('[DreamBot] PASSIVE tick');
                    const skills = await import('./library/skills.js');
                    const inv = () => bot.inventory.items();
                    const count = (n) => inv().filter(i => i.name === n).reduce((a, i) => a + i.count, 0);
                    const has = (n) => inv().some(i => i.name === n);
                    const logs = inv().filter(i => /_log$/.test(i.name)).reduce((a, i) => a + i.count, 0);
                    const planks = inv().filter(i => /_planks$/.test(i.name)).reduce((a, i) => a + i.count, 0);
                    const sticks = count('stick');
                    const cobble = count('cobblestone') + count('stone');
                    const hasTable = has('crafting_table');
                    const hasPick = inv().some(i => /pickaxe/.test(i.name));
                    const done = () => dreamRelease();

                    if (bot.food < 16) {
                        const food = inv().find(i => /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton/.test(i.name));
                        if (food) {
                            try { await bot.equip(food, 'hand'); await bot.consume(); console.log('[DreamBot] eat'); done(); return; } catch {}
                        }
                    }
                    if (logs < 8) {
                        for (const k of ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log']) {
                            try { if (await skills.collectBlock(bot, k, 4)) { console.log('[DreamBot] wood', k); done(); return; } } catch {}
                        }
                        const log = bot.findBlock({ matching: b => b && /_log$/.test(b.name), maxDistance: 16 });
                        if (log) {
                            try {
                                if (log.position.distanceTo(bot.entity.position) > 3) {
                                    try { await skills.goToPosition(bot, log.position.x, log.position.y, log.position.z, 2); } catch {}
                                }
                                await Promise.race([
                                    bot.dig(log),
                                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
                                ]);
                                console.log('[DreamBot] dig log');
                                done(); return;
                            } catch { try { bot.stopDigging?.(); } catch {} }
                        }
                    }
                    if (logs >= 1 && planks < 12) {
                        try {
                            const w = inv().find(i => /_log$/.test(i.name));
                            if (w) { await skills.craftRecipe(bot, w.name.replace('_log', '_planks'), 2); console.log('[DreamBot] planks'); done(); return; }
                        } catch (e) { console.warn('[DreamBot] planks', e.message); }
                    }
                    if (!hasTable && planks >= 4) {
                        try { await skills.craftRecipe(bot, 'crafting_table', 1); console.log('[DreamBot] table'); done(); return; } catch {}
                    }
                    if (sticks < 6 && planks >= 2) {
                        try { await skills.craftRecipe(bot, 'stick', 4); done(); return; } catch {}
                    }
                    if (!hasPick && planks >= 3 && sticks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
                            await skills.equip(bot, 'wooden_pickaxe');
                            console.log('[DreamBot] wooden pickaxe'); done(); return;
                        } catch {}
                    }
                    if (hasPick && cobble < 16) {
                        try { if (await skills.collectBlock(bot, 'stone', 6)) { console.log('[DreamBot] stone'); done(); return; } } catch {}
                    }
                    if (cobble >= 3 && sticks >= 2 && !has('stone_pickaxe')) {
                        try {
                            await skills.craftRecipe(bot, 'stone_pickaxe', 1);
                            await skills.equip(bot, 'stone_pickaxe');
                            console.log('[DreamBot] stone pickaxe'); done(); return;
                        } catch {}
                    }
                    if (bot.food < 15) {
                        for (const mob of ['chicken','cow','pig','sheep']) {
                            try { if (await skills.attackNearest(bot, mob, true)) { console.log('[DreamBot] hunt'); done(); return; } } catch {}
                        }
                    }
                    try { await skills.moveAway(bot, 10); console.log('[DreamBot] explore'); }
                    catch {
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        setTimeout(() => {
                            try { bot.setControlState('forward', false); bot.setControlState('sprint', false); bot.look(bot.entity.yaw + 0.7, 0); } catch {}
                        }, 500);
                    }
                    done();
                } catch (e) {
                    if (!/PathStopped/i.test(String(e?.message || e))) console.warn('[DreamBot] passive', e.message);
                    try { this._dreamLock = false; } catch {}
                }
            }, 14000);

            setInterval(() => {
                try {
                    if (dreamBusy() || this._navBusy || isPathing() || isActing()) return;
                    if (!this.self_prompter || this.self_prompter.isActive?.()) return;
                    this.self_prompter.start('Survive. Dig walls, jump, go around. Always !command.');
                } catch {}
            }, 90000);

            try {
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

  console.log('[fetch-base] replaceAll fix + NAV v2 applied');
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
  console.log('[fetch-base] Ready — replaceAll fixed + NAV dig timeout');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
