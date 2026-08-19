/**
 * Runs after fetch-base.js — copies modules and injects passive skills + pvp if missing.
 */
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

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) {
  console.warn('[post-wire] no agent.js yet');
  process.exit(0);
}

let agent = readFileSync(agentPath, 'utf8');
let changed = false;

if (!agent.includes('[DreamBot] PASSIVE SKILLS')) {
  const inject = `
            // [DreamBot] PASSIVE SKILLS — swarm tech-tree (no LLM)
            try {
                const { startPassiveSkills } = await import('./passive-skills.js');
                startPassiveSkills(this);
            } catch (e) { console.warn('[DreamBot] passive skills', e.message); }
`;

  if (agent.includes("startPvpCombat(this)")) {
    agent = agent.replace(
      /startPvpCombat\(this\);\s*\} catch \(e\) \{ console\.warn\('\[DreamBot\] pvp load', e\.message\); \}/g,
      `startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp load', e.message); }${inject}`
    );
    changed = true;
  } else if (agent.includes("pathfinder dig+parkour+sprint")) {
    agent = agent.replace(
      /console\.log\('\[DreamBot\] pathfinder dig\+parkour\+sprint'\);/,
      `console.log('[DreamBot] pathfinder dig+parkour+sprint');
            try {
                const { startPvpCombat } = await import('./pvp-combat.js');
                startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp load', e.message); }${inject}`
    );
    changed = true;
  } else {
    // last resort: after first spawn once
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{/
      ,
      `this.bot.once('spawn', async () => {
            try {
                const { startPvpCombat } = await import('./pvp-combat.js');
                startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp load', e.message); }
            try {
                const { startPassiveSkills } = await import('./passive-skills.js');
                startPassiveSkills(this);
            } catch (e) { console.warn('[DreamBot] passive skills', e.message); }
`
    );
    changed = true;
  }
}

if (changed) {
  writeFileSync(agentPath, agent);
  console.log('[post-wire] agent.js updated with PASSIVE SKILLS');
} else {
  console.log('[post-wire] passive skills already present or no hook');
}
