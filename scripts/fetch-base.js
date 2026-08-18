/**
 * DreamBot — Mindcraft + FULL PASSIVE + mode coordination
 * Fixes: modes fighting each other (unstuck/defense/worker/pathfinder)
 * One lock, fewer interrupts, longer intervals
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

  // Never kill self-prompt when a mode runs
  modes = modes.replace(
    /if\s*\(\s*agent\.self_prompter\.isActive\(\)\s*\)\s*\n?\s*agent\.self_prompter\.stopLoop\(\);/g,
    '// DreamBot: keep self-prompt (no stopLoop)'
  );

  // Stuck: longer + no kill
  modes = modes.replace(/max_stuck_time:\s*20/g, 'max_stuck_time: 90');
  modes = modes.replace(
    /agent\.cleanKill\(["']Got stuck[^"']*["']\)/g,
    `console.warn('[DreamBot] stuck — stay online')`
  );

  // CRITICAL: only interrupt actions for combat/death threat — not hunting/unstuck/items
  // Mindcraft default interrupts too often → mode thrashing
  if (!modes.includes('[DreamBot] soft interrupt')) {
    // unstuck: do not interrupt current action (let it finish or pathfinder handle)
    modes = modes.replace(
      /(name:\s*['"]unstuck['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt: unstuck never interrupts */`
    );
    // hunting: do not interrupt
    modes = modes.replace(
      /(name:\s*['"]hunting['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt: hunting never interrupts */`
    );
    // item_collecting: do not interrupt
    modes = modes.replace(
      /(name:\s*['"]item_collecting['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt: items never interrupt */`
    );
    // torch_placing: do not interrupt
    modes = modes.replace(
      /(name:\s*['"]torch_placing['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt: torch never interrupts */`
    );
    // elbow_room: do not interrupt
    modes = modes.replace(
      /(name:\s*['"]elbow_room['"][\s\S]*?interrupt:\s*)(agent\s*=>\s*[^,\n]+)/,
      `$1false /* [DreamBot] soft interrupt: elbow never interrupts */`
    );
    console.log('[fetch-base] modes: soft interrupt (only defense may interrupt)');
  }

  if (!modes.includes('[DreamBot] resume after mode')) {
    modes = modes.replace(
      /if\s*\(\s*should_reprompt\s*\)\s*\{/,
      `// [DreamBot] resume after mode
    try {
      if (agent.self_prompter && !agent.self_prompter.isActive()) {
        setTimeout(() => {
          try {
            if (!agent._dreamLock) {
              agent.self_prompter.start(agent.self_prompter.prompt || 'Survive with !commands');
            }
          } catch {}
        }, 12000);
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
                this.self_prompter.start('Survive: wood, craft, mine, food, house. Always !command.');
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
        if (/groq|rate.?limit|brain disconnected|api key|restarting|exiting|hello world|PathStopped|passivo|cooldown/i.test(__m)) {
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

  // Coordinated passive + terrain (ONE lock — no mode thrashing)
  if (!agent.includes('[DreamBot] COORDINATED')) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{\s*try \{\s*clearTimeout\(spawnTimeout\);/,
      `this.bot.once('spawn', async () => {
            try { clearTimeout(spawnTimeout); } catch {}

            this._dreamLock = false; // global: only one dream action at a time
            this._dreamLockUntil = 0;

            const dreamBusy = () => this._dreamLock || Date.now() < (this._dreamLockUntil || 0);
            const dreamAcquire = (ms = 8000) => {
                if (dreamBusy()) return false;
                this._dreamLock = true;
                this._dreamLockUntil = Date.now() + ms;
                return true;
            };
            const dreamRelease = () => {
                this._dreamLock = false;
                this._dreamLockUntil = 0;
            };
            const isPathing = () => {
                try { return !!this.bot.pathfinder?.isMoving?.(); } catch { return false; }
            };
            const isActing = () => !!this.actions?.executing;

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

            // TERRAIN — only when idle (no path, no action, no lock)
            setInterval(async () => {
                try {
                    if (dreamBusy() || isPathing() || isActing()) return;
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (!dreamAcquire(3000)) return;
                    let Vec3;
                    try { Vec3 = (await import('vec3')).default || (await import('vec3')).Vec3; } catch { dreamRelease(); return; }
                    const pos = bot.entity.position;
                    const yaw = bot.entity.yaw;
                    const dx = -Math.sin(yaw);
                    const dz = -Math.cos(yaw);
                    const fx = Math.floor(pos.x + dx * 1.15);
                    const fz = Math.floor(pos.z + dz * 1.15);
                    const fy = Math.floor(pos.y);
                    const solid = (b) => b && b.boundingBox === 'block'
                        && b.name !== 'air' && !b.name.includes('water') && !b.name.includes('lava');
                    const feet = bot.blockAt(new Vec3(fx, fy, fz));
                    const head = bot.blockAt(new Vec3(fx, fy + 1, fz));
                    const above = bot.blockAt(new Vec3(fx, fy + 2, fz));

                    if (solid(head)) {
                        try { await bot.dig(head); console.log('[DreamBot] dig wall', head.name); } catch {}
                        dreamRelease();
                        return;
                    }
                    if (solid(feet) && !solid(head) && !solid(above)) {
                        bot.setControlState('jump', true);
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        setTimeout(() => {
                            try {
                                bot.setControlState('jump', false);
                                bot.setControlState('forward', false);
                                bot.setControlState('sprint', false);
                            } catch {}
                            dreamRelease();
                        }, 400);
                        console.log('[DreamBot] jump step');
                        return;
                    }
                    if (solid(feet) && solid(head)) {
                        try { await bot.dig(feet); console.log('[DreamBot] dig obstacle'); } catch {}
                        dreamRelease();
                        return;
                    }
                    const gap = bot.blockAt(new Vec3(fx, fy - 1, fz));
                    if (gap && (gap.name === 'air' || gap.name === 'cave_air' || gap.name.includes('water'))) {
                        const placeable = bot.inventory.items().find(i =>
                            /dirt|cobblestone|planks|netherrack|stone$|andesite|granite|diorite|deepslate/.test(i.name)
                        );
                        if (placeable) {
                            try {
                                await bot.equip(placeable, 'hand');
                                const ref = bot.blockAt(new Vec3(Math.floor(pos.x), fy - 1, Math.floor(pos.z)));
                                if (ref && solid(ref)) {
                                    const face = new Vec3(Math.sign(dx) || 0, 0, Math.sign(dz) || 0);
                                    await bot.placeBlock(ref, face);
                                    console.log('[DreamBot] bridge');
                                }
                            } catch {}
                        }
                    }
                    dreamRelease();
                } catch { try { this._dreamLock = false; } catch {} }
            }, 4000);

            // UNSTICK — only if truly idle and stuck long
            let stillTicks = 0;
            let lastPos = null;
            setInterval(() => {
                try {
                    if (dreamBusy() || isPathing() || isActing()) {
                        stillTicks = 0;
                        return;
                    }
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    const p = bot.entity.position;
                    if (lastPos && p.distanceTo(lastPos) < 0.1) stillTicks++;
                    else stillTicks = 0;
                    lastPos = p.clone();
                    if (stillTicks < 6) return; // ~12s still
                    stillTicks = 0;
                    if (!dreamAcquire(2000)) return;
                    bot.look(bot.entity.yaw + (Math.random() > 0.5 ? 1.0 : -1.0), 0);
                    bot.setControlState('jump', true);
                    bot.setControlState('forward', true);
                    bot.setControlState('sprint', true);
                    setTimeout(() => {
                        try {
                            bot.setControlState('jump', false);
                            bot.setControlState('forward', false);
                            bot.setControlState('sprint', false);
                        } catch {}
                        dreamRelease();
                    }, 500);
                    console.log('[DreamBot] unstick turn+jump');
                } catch { try { this._dreamLock = false; } catch {} }
            }, 2000);

            // FULL PASSIVE — only when completely idle
            setInterval(async () => {
                try {
                    if (dreamBusy() || isPathing() || isActing()) return;
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    if (!dreamAcquire(25000)) return;
                    console.log('[DreamBot] PASSIVE tick');
                    // DO NOT pause/unpause modes — that causes thrashing
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
                    const hasAxe = inv().some(i => /_axe$/.test(i.name) && !/pickaxe/.test(i.name));
                    const hasSword = inv().some(i => /sword/.test(i.name));
                    const buildBlocks = inv().filter(i =>
                        /dirt|cobblestone|planks|stone$|andesite|granite|diorite|deepslate|netherrack/.test(i.name)
                    ).reduce((a, i) => a + i.count, 0);

                    const done = () => { dreamRelease(); };

                    if (bot.food < 16) {
                        const food = inv().find(i =>
                            /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|cod|salmon/.test(i.name)
                        );
                        if (food) {
                            try {
                                await bot.equip(food, 'hand');
                                await bot.consume();
                                console.log('[DreamBot] eat', food.name);
                                done();
                                return;
                            } catch {}
                        }
                    }

                    if (logs < 10 && (!hasPick || logs < 4)) {
                        for (const k of ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log']) {
                            try {
                                if (await skills.collectBlock(bot, k, 4)) {
                                    console.log('[DreamBot] wood', k);
                                    done();
                                    return;
                                }
                            } catch {}
                        }
                        const log = bot.findBlock({ matching: b => b && /_log$/.test(b.name), maxDistance: 16 });
                        if (log) {
                            try {
                                if (log.position.distanceTo(bot.entity.position) > 3.5) {
                                    try { await skills.goToPosition(bot, log.position.x, log.position.y, log.position.z, 2); } catch {}
                                }
                                await bot.dig(log);
                                console.log('[DreamBot] dig log');
                                done();
                                return;
                            } catch {}
                        }
                    }

                    if (logs >= 1 && planks < 16) {
                        try {
                            const wood = inv().find(i => /_log$/.test(i.name));
                            if (wood) {
                                await skills.craftRecipe(bot, wood.name.replace('_log', '_planks'), 3);
                                console.log('[DreamBot] planks');
                                done();
                                return;
                            }
                        } catch (e) { console.warn('[DreamBot] planks', e.message); }
                    }

                    if (!hasTable && planks >= 4) {
                        try {
                            await skills.craftRecipe(bot, 'crafting_table', 1);
                            console.log('[DreamBot] table');
                            done();
                            return;
                        } catch (e) { console.warn('[DreamBot] table', e.message); }
                    }

                    if (hasTable && !this._tablePlaced) {
                        try {
                            await skills.placeBlock(bot, 'crafting_table', bot.entity.position.x + 1, bot.entity.position.y, bot.entity.position.z);
                            this._tablePlaced = true;
                            console.log('[DreamBot] place table');
                            done();
                            return;
                        } catch {}
                    }

                    if (sticks < 8 && planks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'stick', 4);
                            console.log('[DreamBot] sticks');
                            done();
                            return;
                        } catch {}
                    }

                    if (!hasPick && planks >= 3 && sticks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
                            await skills.equip(bot, 'wooden_pickaxe');
                            console.log('[DreamBot] wooden pickaxe');
                            done();
                            return;
                        } catch (e) { console.warn('[DreamBot] pick', e.message); }
                    }
                    if (!hasAxe && planks >= 3 && sticks >= 2) {
                        try {
                            await skills.craftRecipe(bot, 'wooden_axe', 1);
                            done();
                            return;
                        } catch {}
                    }
                    if (!hasSword && planks >= 2 && sticks >= 1) {
                        try {
                            await skills.craftRecipe(bot, 'wooden_sword', 1);
                            done();
                            return;
                        } catch {}
                    }

                    if (hasPick && cobble < 20) {
                        try {
                            const pick = inv().find(i => /pickaxe/.test(i.name));
                            if (pick) await skills.equip(bot, pick.name);
                        } catch {}
                        try {
                            if (await skills.collectBlock(bot, 'stone', 6)) {
                                console.log('[DreamBot] stone');
                                done();
                                return;
                            }
                        } catch {}
                    }

                    if (cobble >= 3 && sticks >= 2 && !has('stone_pickaxe')) {
                        try {
                            await skills.craftRecipe(bot, 'stone_pickaxe', 1);
                            await skills.equip(bot, 'stone_pickaxe');
                            console.log('[DreamBot] stone pickaxe');
                            done();
                            return;
                        } catch {}
                    }
                    if (cobble >= 8 && !has('furnace')) {
                        try {
                            await skills.craftRecipe(bot, 'furnace', 1);
                            console.log('[DreamBot] furnace');
                            done();
                            return;
                        } catch {}
                    }
                    if ((has('coal') || has('charcoal')) && sticks >= 1 && count('torch') < 4) {
                        try {
                            await skills.craftRecipe(bot, 'torch', 4);
                            done();
                            return;
                        } catch {}
                    }

                    if (bot.food < 16) {
                        for (const mob of ['chicken', 'cow', 'pig', 'sheep']) {
                            try {
                                if (await skills.attackNearest(bot, mob, true)) {
                                    console.log('[DreamBot] hunt', mob);
                                    done();
                                    return;
                                }
                            } catch {}
                        }
                    }

                    if (!this._houseDone && buildBlocks >= 20 && hasPick) {
                        try {
                            const base = this._homePos || bot.entity.position;
                            const bx = Math.floor(base.x);
                            const by = Math.floor(base.y);
                            const bz = Math.floor(base.z);
                            for (let x = 0; x < 4; x++) {
                                for (let z = 0; z < 4; z++) {
                                    try { await skills.placeBlock(bot, 'cobblestone', bx + x, by - 1, bz + z); }
                                    catch { try { await skills.placeBlock(bot, 'dirt', bx + x, by - 1, bz + z); } catch {} }
                                }
                            }
                            for (let y = 0; y < 2; y++) {
                                for (let i = 0; i < 4; i++) {
                                    for (const [ox, oz] of [[i, 0], [i, 3], [0, i], [3, i]]) {
                                        try { await skills.placeBlock(bot, 'cobblestone', bx + ox, by + y, bz + oz); }
                                        catch { try { await skills.placeBlock(bot, 'oak_planks', bx + ox, by + y, bz + oz); } catch {} }
                                    }
                                }
                            }
                            this._houseDone = true;
                            console.log('[DreamBot] house done');
                            done();
                            return;
                        } catch (e) { console.warn('[DreamBot] house', e.message); }
                    }

                    try {
                        const t = bot.time?.timeOfDay;
                        if (t != null && (t > 12500 || t < 500)) {
                            try {
                                await skills.goToBed(bot);
                                console.log('[DreamBot] sleep');
                                done();
                                return;
                            } catch {}
                        }
                    } catch {}

                    try {
                        await skills.moveAway(bot, 10);
                        console.log('[DreamBot] explore');
                    } catch {
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        setTimeout(() => {
                            try {
                                bot.setControlState('forward', false);
                                bot.setControlState('sprint', false);
                                bot.look(bot.entity.yaw + 0.8, 0);
                            } catch {}
                        }, 600);
                    }
                    done();
                } catch (e) {
                    if (!/PathStopped/i.test(String(e?.message || e)))
                        console.warn('[DreamBot] passive', e.message);
                    try { this._dreamLock = false; } catch {}
                }
            }, 15000);

            // Self-prompt rarely — passive already works; avoid fighting LLM vs passive
            setInterval(() => {
                try {
                    if (dreamBusy() || isPathing() || isActing()) return;
                    if (!this.self_prompter) return;
                    if (this.self_prompter.isActive?.()) return;
                    this.self_prompter.start('Survive: wood tools stone food house. Always !command.');
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

  console.log('[fetch-base] coordinated modes + passive');
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
  console.log('[fetch-base] Ready — no mode thrashing');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
