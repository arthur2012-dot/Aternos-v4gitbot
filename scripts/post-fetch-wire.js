/**
 * post-fetch-wire — pure-survival as MAIN brain; core only if pure missing
 * NO random dig/place modules fighting each other
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();

function copy(from, to) {
  const src = join(ROOT, from);
  const dst = join(ROOT, to);
  if (!existsSync(src)) {
    console.warn('[post-wire] missing', from);
    return false;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log('[post-wire] copied', to);
  return true;
}

const REAL = [
  ['scripts/pure-survival.js', 'src/agent/pure-survival.js'],
  ['scripts/setup-movements.js', 'src/agent/setup-movements.js'],
  ['scripts/plugin-stack.js', 'src/agent/plugin-stack.js'],
  ['scripts/dig-place.js', 'src/agent/dig-place.js'],
  ['scripts/water-escape.js', 'src/agent/water-escape.js'],
  ['scripts/pvp-combat.js', 'src/agent/pvp-combat.js'],
  ['scripts/kill-chat.js', 'src/agent/kill-chat.js'],
  ['scripts/mobile-viewer.js', 'src/agent/mobile-viewer.js'],
  ['scripts/mindcraft-skills.js', 'src/agent/mindcraft-skills.js'],
];

for (const [from, to] of REAL) copy(from, to);

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

if (!agent.includes('[DreamBot] PURE v5 STACK')) {
  const block = `
            // [DreamBot] PURE v5 STACK — one brain only
            try {
                const { startKillChat } = await import('./kill-chat.js');
                startKillChat(this);
            } catch (e) { console.warn('[DreamBot] killchat', e.message); }
            try {
                const { startPluginStack } = await import('./plugin-stack.js');
                startPluginStack(this);
            } catch (e) { console.warn('[DreamBot] stack', e.message); }
            try {
                const { startPureSurvival } = await import('./pure-survival.js');
                startPureSurvival(this);
            } catch (e) { console.warn('[DreamBot] pure', e.message); }
            try {
                const { startPvpCombat } = await import('./pvp-combat.js');
                startPvpCombat(this);
            } catch (e) { console.warn('[DreamBot] pvp', e.message); }
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
console.log('[post-wire] PURE v5 only — no multi-loop fight');
