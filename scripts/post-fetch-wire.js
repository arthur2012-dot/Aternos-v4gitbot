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

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) {
  process.exit(0);
}

let agent = readFileSync(agentPath, 'utf8');

if (!agent.includes('startNavStack') && !agent.includes('startBaritoneNav')) {
  const block = `
            // [DreamBot] STACK LOAD
            try {
                const { startPvpCombat } = await import('./pvp-combat.js');
                startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp', e.message); }
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
                const { startVoyagerCurriculum } = await import('./voyager-skills.js');
                startVoyagerCurriculum(this);
            } catch (e) { console.warn('[DreamBot] voyager', e.message); }
            try {
                const { startAntiFreeze } = await import('./anti-freeze.js');
                startAntiFreeze(this);
            } catch (e) { console.warn('[DreamBot] anti-freeze', e.message); }
`;
  if (agent.includes("this.bot.once('spawn'")) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{/,
      `this.bot.once('spawn', async () => {${block}`
    );
    writeFileSync(agentPath, agent);
    console.log('[post-wire] full nav stack wired');
  }
} else if (!agent.includes('startAntiFreeze')) {
  agent = agent.replace(
    /startBaritoneNav\(this\);/,
    `startBaritoneNav(this);
            try {
                const { startAntiFreeze } = await import('./anti-freeze.js');
                startAntiFreeze(this);
            } catch (e) { console.warn('[DreamBot] anti-freeze', e.message); }`
  );
  writeFileSync(agentPath, agent);
  console.log('[post-wire] anti-freeze added');
} else {
  console.log('[post-wire] nav stack already wired');
}
