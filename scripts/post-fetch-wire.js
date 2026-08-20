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
copy('scripts/escape-hole.js', 'src/agent/escape-hole.js');
copy('scripts/autobot-skills.js', 'src/agent/autobot-skills.js');
copy('scripts/house-builder.js', 'src/agent/house-builder.js');
copy('scripts/danger-detect.js', 'src/agent/danger-detect.js');
copy('scripts/env-navigation.js', 'src/agent/env-navigation.js');
copy('scripts/kill-chat.js', 'src/agent/kill-chat.js');
copy('scripts/groq-heartbeat.js', 'src/agent/groq-heartbeat.js');
copy('scripts/nav-stack.js', 'src/agent/nav-stack.js');
copy('scripts/baritone-nav.js', 'src/agent/baritone-nav.js');
copy('scripts/anti-freeze.js', 'src/agent/anti-freeze.js');
copy('scripts/task-guard.js', 'src/agent/task-guard.js');
copy('scripts/dig-place.js', 'src/agent/dig-place.js');
copy('scripts/koneko-behaviors.js', 'src/agent/koneko-behaviors.js');
copy('scripts/mobile-viewer.js', 'src/agent/mobile-viewer.js');

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) process.exit(0);

let agent = readFileSync(agentPath, 'utf8');

if (!agent.includes('[DreamBot] suppressed') && agent.includes('async openChat')) {
  agent = agent.replace(
    /async openChat\(message\) \{/,
    `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/não usou o comando|nao usou o comando|solicita[cç][aã]o autom[aá]tica|auto-prompt|did not use command|Parando a solicita|40 prompts/i.test(__m)) {
            console.warn('[DreamBot] suppressed stop-msg');
            return;
        }
        if (/groq|rate.?limit|api key|exiting|hello world|PathStopped|model_not_found/i.test(__m)) {
            console.warn('[DreamBot] suppressed:', __m.slice(0, 40));
            return;
        }`
  );
}

agent = agent.replace(
  /setInterval\(\(\) => \{[\s\S]*?spd < 0\.02[\s\S]*?\}, 10000\);/g,
  '/* no random anti-AFK */'
);

if (!agent.includes('[DreamBot] FULL STACK')) {
  const block = `
            // [DreamBot] FULL STACK
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
                const { startDangerDetect } = await import('./danger-detect.js');
                startDangerDetect(this);
            } catch (e) { console.warn('[DreamBot] danger', e.message); }
            try {
                const { startEnvNavigation } = await import('./env-navigation.js');
                startEnvNavigation(this);
            } catch (e) { console.warn('[DreamBot] env-nav', e.message); }
            try {
                const { startKillChat } = await import('./kill-chat.js');
                startKillChat(this);
            } catch (e) { console.warn('[DreamBot] killchat', e.message); }
            try {
                const { startGroqHeartbeat } = await import('./groq-heartbeat.js');
                startGroqHeartbeat(this);
            } catch (e) { console.warn('[DreamBot] groq-hb', e.message); }
            try {
                const { startKonekoBehaviors } = await import('./koneko-behaviors.js');
                await startKonekoBehaviors(this);
            } catch (e) { console.warn('[DreamBot] koneko', e.message); }
            try {
                const { startAntiFreeze } = await import('./anti-freeze.js');
                startAntiFreeze(this);
            } catch (e) { console.warn('[DreamBot] anti-freeze', e.message); }
            try {
                const { startTaskGuard } = await import('./task-guard.js');
                startTaskGuard(this);
            } catch (e) { console.warn('[DreamBot] task-guard', e.message); }
            try {
                const { startMobileViewer } = await import('./mobile-viewer.js');
                await startMobileViewer(this.bot);
            } catch (e) { console.warn('[DreamBot] viewer', e.message); }
`;
  if (agent.includes("this.bot.once('spawn'")) {
    agent = agent.replace(
      /this\.bot\.once\('spawn', async \(\) => \{/,
      `this.bot.once('spawn', async () => {${block}`
    );
  }
}

if (agent.includes('[DreamBot] FULL STACK') && !agent.includes('startDangerDetect')) {
  agent = agent.replace(
    /startPvpCombat\(this\);\s*\} catch \(e\) \{ console\.warn\('\[DreamBot\] pvp', e\.message\); \}/,
    `startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp', e.message); }
            try {
                const { startDangerDetect } = await import('./danger-detect.js');
                startDangerDetect(this);
            } catch (e) { console.warn('[DreamBot] danger', e.message); }`
  );
}

if (agent.includes('[DreamBot] FULL STACK') && !agent.includes('startEnvNavigation')) {
  agent = agent.replace(
    /startDangerDetect\(this\);\s*\} catch \(e\) \{ console\.warn\('\[DreamBot\] danger', e\.message\); \}/,
    `startDangerDetect(this);
            } catch (e) { console.warn('[DreamBot] danger', e.message); }
            try {
                const { startEnvNavigation } = await import('./env-navigation.js');
                startEnvNavigation(this);
            } catch (e) { console.warn('[DreamBot] env-nav', e.message); }`
  );
}

if (agent.includes('[DreamBot] FULL STACK') && !agent.includes('startKillChat')) {
  agent = agent.replace(
    /startEnvNavigation\(this\);\s*\} catch \(e\) \{ console\.warn\('\[DreamBot\] env-nav', e\.message\); \}/,
    `startEnvNavigation(this);
            } catch (e) { console.warn('[DreamBot] env-nav', e.message); }
            try {
                const { startKillChat } = await import('./kill-chat.js');
                startKillChat(this);
            } catch (e) { console.warn('[DreamBot] killchat', e.message); }`
  );
}

if (agent.includes('[DreamBot] FULL STACK') && !agent.includes('startGroqHeartbeat')) {
  agent = agent.replace(
    /startKillChat\(this\);\s*\} catch \(e\) \{ console\.warn\('\[DreamBot\] killchat', e\.message\); \}/,
    `startKillChat(this);
            } catch (e) { console.warn('[DreamBot] killchat', e.message); }
            try {
                const { startGroqHeartbeat } = await import('./groq-heartbeat.js');
                startGroqHeartbeat(this);
            } catch (e) { console.warn('[DreamBot] groq-hb', e.message); }`
  );
}

writeFileSync(agentPath, agent);
console.log('[post-wire] full stack + groq-heartbeat');
