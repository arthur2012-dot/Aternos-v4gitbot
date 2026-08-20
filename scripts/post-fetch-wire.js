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

copy('scripts/dig-place.js', 'src/agent/dig-place.js');
copy('scripts/mindcraft-skills.js', 'src/agent/mindcraft-skills.js');
copy('scripts/mindcraft-core.js', 'src/agent/mindcraft-core.js');
copy('scripts/pure-survival.js', 'src/agent/pure-survival.js');
copy('scripts/plugin-stack.js', 'src/agent/plugin-stack.js');
copy('scripts/simple-shelter.js', 'src/agent/simple-shelter.js');
copy('scripts/pvp-combat.js', 'src/agent/pvp-combat.js');
copy('scripts/multiplayer-social.js', 'src/agent/multiplayer-social.js');
copy('scripts/kill-chat.js', 'src/agent/kill-chat.js');
copy('scripts/groq-heartbeat.js', 'src/agent/groq-heartbeat.js');
copy('scripts/mobile-viewer.js', 'src/agent/mobile-viewer.js');

function aliasToSkills(name, exportMap) {
  const dst = join(ROOT, 'src/agent', name);
  mkdirSync(dirname(dst), { recursive: true });
  const lines = Object.entries(exportMap)
    .map(
      ([exp, real]) =>
        `export async function ${exp}(agent) {
  const mod = await import('./mindcraft-skills.js');
  if (mod.${real}) return mod.${real}(agent);
  if (mod.startMindcraftSkills) return mod.startMindcraftSkills(agent);
}
`
    )
    .join('\n');
  writeFileSync(dst, `/** Alias → mindcraft-skills */\n${lines}`);
}

aliasToSkills('nav-tree.js', { startNavTree: 'startMindcraftUnstuck' });
aliasToSkills('nav-stack.js', { startNavStack: 'startMindcraftSkills' });
aliasToSkills('baritone-nav.js', { startBaritoneNav: 'startMindcraftSkills' });
aliasToSkills('env-navigation.js', { startEnvNavigation: 'startMindcraftUnstuck' });
aliasToSkills('anti-freeze.js', { startAntiFreeze: 'startMindcraftUnstuck' });
aliasToSkills('passive-skills.js', { startPassiveSkills: 'startMindcraftSkills' });
aliasToSkills('escape-hole.js', { startEscapeHole: 'startMindcraftUnstuck' });
aliasToSkills('task-guard.js', { startTaskGuard: 'startMindcraftSkills' });

function aliasToCore(name, exportName) {
  const dst = join(ROOT, 'src/agent', name);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(
    dst,
    `export async function ${exportName}(agent) {
  const { startMindcraftCore } = await import('./mindcraft-core.js');
  return startMindcraftCore(agent);
}
`
  );
}
aliasToCore('koneko-behaviors.js', 'startKonekoBehaviors');
aliasToCore('autobot-skills.js', 'startAutobotSkills');
aliasToCore('danger-detect.js', 'startDangerDetect');
aliasToCore('voyager-skills.js', 'startVoyagerCurriculum');

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) process.exit(0);

let agent = readFileSync(agentPath, 'utf8');

if (!agent.includes('LoginGuard') && agent.includes('async openChat')) {
  agent = agent.replace(
    /async openChat\(message\) \{/,
    `async openChat(message) {
        const __m = String(message || '');
        if (!__m.trim()) return;
        if (/LoginGuard|Disconnected:\\s*\\[object|não usou o comando|nao usou o comando|auto-prompt|did not use command|Parando a solicita|40 prompts/i.test(__m)) {
            console.warn('[DreamBot] suppressed');
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

if (!agent.includes('[DreamBot] MINDCRAFT STACK')) {
  const block = `
            // [DreamBot] MINDCRAFT STACK — plugins first, then pure sequential
            try {
                const { startKillChat } = await import('./kill-chat.js');
                startKillChat(this);
            } catch (e) { console.warn('[DreamBot] killchat', e.message); }
            try {
                const { startPluginStack } = await import('./plugin-stack.js');
                startPluginStack(this);
            } catch (e) { console.warn('[DreamBot] stack', e.message); }
            try {
                const { startSimpleShelter } = await import('./simple-shelter.js');
                startSimpleShelter(this);
            } catch (e) { console.warn('[DreamBot] shelter', e.message); }
            try {
                const { startPureSurvival } = await import('./pure-survival.js');
                startPureSurvival(this);
            } catch (e) { console.warn('[DreamBot] pure', e.message); }
            try {
                const { startMindcraftSkills } = await import('./mindcraft-skills.js');
                startMindcraftSkills(this);
            } catch (e) { console.warn('[DreamBot] skills', e.message); }
            try {
                const { startMindcraftCore } = await import('./mindcraft-core.js');
                startMindcraftCore(this);
            } catch (e) { console.warn('[DreamBot] mc-core', e.message); }
            try {
                const { startPvpCombat } = await import('./pvp-combat.js');
                startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp', e.message); }
            try {
                const { startMultiplayerSocial } = await import('./multiplayer-social.js');
                startMultiplayerSocial(this);
            } catch (e) { console.warn('[DreamBot] mp', e.message); }
            try {
                const { startGroqHeartbeat } = await import('./groq-heartbeat.js');
                startGroqHeartbeat(this);
            } catch (e) { console.warn('[DreamBot] groq-hb', e.message); }
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

writeFileSync(agentPath, agent);
console.log('[post-wire] FULL STACK: plugins + pure + mindcraft');
