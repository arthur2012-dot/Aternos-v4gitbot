import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();

function copy(from, to) {
  const src = join(ROOT, from);
  const dst = join(ROOT, to);
  if (!existsSync(src)) {
    console.warn('[post-wire] missing', from);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log('[post-wire] copied', to);
}

copy('scripts/pvp-combat.js', 'src/agent/pvp-combat.js');
copy('scripts/passive-skills.js', 'src/agent/passive-skills.js');
copy('scripts/nav-stack.js', 'src/agent/nav-stack.js');
copy('scripts/baritone-nav.js', 'src/agent/baritone-nav.js');
copy('scripts/voyager-skills.js', 'src/agent/voyager-skills.js');
copy('scripts/anti-freeze.js', 'src/agent/anti-freeze.js');
copy('scripts/task-guard.js', 'src/agent/task-guard.js');

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) process.exit(0);

let agent = readFileSync(agentPath, 'utf8');
let changed = false;

// Ensure NAV interval does not interrupt while pathing/acting
if (agent.includes('[DreamBot] NAV BRAIN') && !agent.includes('[DreamBot] skip if busy')) {
  agent = agent.replace(
    /setInterval\(async \(\) => \{\s*if \(this\._navBusy\) return;\s*try \{\s*const bot = this\.bot;\s*if \(!bot\?\.entity\) return;/
    ,
    `setInterval(async () => {
                if (this._navBusy) return;
                try {
                    const bot = this.bot;
                    if (!bot?.entity) return;
                    // [DreamBot] skip if busy — do NOT stop mid-task for player/terrain micro-nav
                    try {
                        if (this.actions?.executing) return;
                        if (bot.pathfinder?.isMoving?.()) return;
                        if (bot.targetDigBlock) return;
                        if (bot._dreamPvpActive) return;
                    } catch {}`
  );
  changed = true;
  console.log('[post-wire] NAV skip-if-busy');
}

if (!agent.includes('startTaskGuard')) {
  const inject = `
            try {
                const { startTaskGuard } = await import('./task-guard.js');
                startTaskGuard(this);
            } catch (e) { console.warn('[DreamBot] task-guard', e.message); }
            try {
                const { startAntiFreeze } = await import('./anti-freeze.js');
                startAntiFreeze(this);
            } catch (e) { console.warn('[DreamBot] anti-freeze', e.message); }
`;
  if (agent.includes("this.bot.once('spawn'")) {
    // append near other stack loads if missing anti-freeze
    if (!agent.includes('startAntiFreeze')) {
      agent = agent.replace(
        /this\.bot\.once\('spawn', async \(\) => \{/
        ,
        `this.bot.once('spawn', async () => {${inject}`
      );
      changed = true;
    } else if (!agent.includes('startTaskGuard')) {
      agent = agent.replace(
        /startAntiFreeze\(this\);/
        ,
        `startAntiFreeze(this);
            try {
                const { startTaskGuard } = await import('./task-guard.js');
                startTaskGuard(this);
            } catch (e) { console.warn('[DreamBot] task-guard', e.message); }`
      );
      changed = true;
    }
  }
}

if (changed) {
  writeFileSync(agentPath, agent);
  console.log('[post-wire] task continuity patched');
} else {
  console.log('[post-wire] task continuity ok');
}
