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
copy('scripts/anti-freeze.js', 'src/agent/anti-freeze.js');
copy('scripts/task-guard.js', 'src/agent/task-guard.js');

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) process.exit(0);

let agent = readFileSync(agentPath, 'utf8');

// Suppress auto-prompt stop spam in chat
if (!agent.includes('[DreamBot] suppressed')) {
  agent = agent.replace(
    /async openChat\(message\) \{/,
    `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/não usou o comando|nao usou o comando|solicita[cç][aã]o autom[aá]tica|auto-prompt|did not use command|Parando a solicita|40 prompts/i.test(__m)) {
            console.warn('[DreamBot] suppressed stop-msg');
            return;
        }
        if (/groq|rate.?limit|api key|exiting|hello world|PathStopped|replaceAll|model_not_found/i.test(__m)) {
            console.warn('[DreamBot] suppressed:', __m.slice(0, 40));
            return;
        }`
  );
}

// Force inject full passive stack once on spawn
if (!agent.includes('[DreamBot] FULL STACK')) {
  const block = `
            // [DreamBot] FULL STACK — passive first
            try {
                const { startPassiveSkills } = await import('./passive-skills.js');
                startPassiveSkills(this);
            } catch (e) { console.warn('[DreamBot] passive', e.message); }
            try {
                const { startNavStack } = await import('./nav-stack.js');
                await startNavStack(this);
            } catch (e) {
                try {
                    const { startBaritoneNav } = await import('./baritone-nav.js');
                    await startBaritoneNav(this);
                } catch (e2) { console.warn('[DreamBot] nav', e2.message); }
            }
            try {
                const { startPvpCombat } = await import('./pvp-combat.js');
                startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp', e.message); }
            try {
                const { startAntiFreeze } = await import('./anti-freeze.js');
                startAntiFreeze(this);
            } catch (e) { console.warn('[DreamBot] anti-freeze', e.message); }
            try {
                const { startTaskGuard } = await import('./task-guard.js');
                startTaskGuard(this);
            } catch (e) { console.warn('[DreamBot] task-guard', e.message); }
            // Keep body moving even if LLM dies
            setInterval(() => {
                try {
                    if (!this.bot?.entity) return;
                    if (this.bot._dreamPvpActive) return;
                    if (this.actions?.executing) return;
                    if (this.bot.pathfinder?.isMoving?.()) return;
                    const v = this.bot.entity.velocity;
                    const spd = Math.sqrt(v.x*v.x + v.z*v.z);
                    if (spd < 0.02) {
                        this.bot.setControlState('forward', true);
                        this.bot.setControlState('sprint', true);
                        this.bot.setControlState('jump', true);
                        setTimeout(() => {
                            try {
                                this.bot.clearControlStates();
                                this.bot.look(this.bot.entity.yaw + 1, 0);
                            } catch {}
                        }, 700);
                    }
                } catch {}
            }, 10000);
`;
  if (agent.includes("this.bot.once('spawn'")) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{/,
      `this.bot.once('spawn', async () => {${block}`
    );
    writeFileSync(agentPath, agent);
    console.log('[post-wire] FULL STACK injected');
  } else {
    writeFileSync(agentPath, agent);
    console.warn('[post-wire] no spawn hook found');
  }
} else {
  writeFileSync(agentPath, agent);
  console.log('[post-wire] stack already present');
}
