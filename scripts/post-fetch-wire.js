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

// Keep essentials only
copy('scripts/dig-place.js', 'src/agent/dig-place.js');
copy('scripts/mindcraft-core.js', 'src/agent/mindcraft-core.js');
copy('scripts/pvp-combat.js', 'src/agent/pvp-combat.js');
copy('scripts/multiplayer-social.js', 'src/agent/multiplayer-social.js');
copy('scripts/kill-chat.js', 'src/agent/kill-chat.js');
copy('scripts/groq-heartbeat.js', 'src/agent/groq-heartbeat.js');
copy('scripts/mobile-viewer.js', 'src/agent/mobile-viewer.js');

// Neutralize bad systems so old FULL STACK cannot start them effectively
function writeNoop(name, exportName) {
  const dst = join(ROOT, 'src/agent', name);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(
    dst,
    `/** DISABLED — was causing random dig / conflicts. Replaced by mindcraft-core. */\nexport function ${exportName}() { console.log('[DISABLED] ${name}'); }\nexport default { ${exportName} };\n`
  );
  console.log('[post-wire] noop', name);
}

writeNoop('nav-tree.js', 'startNavTree');
writeNoop('nav-stack.js', 'startNavStack');
writeNoop('baritone-nav.js', 'startBaritoneNav');
writeNoop('env-navigation.js', 'startEnvNavigation');
writeNoop('anti-freeze.js', 'startAntiFreeze');
writeNoop('koneko-behaviors.js', 'startKonekoBehaviors');
writeNoop('passive-skills.js', 'startPassiveSkills');
writeNoop('autobot-skills.js', 'startAutobotSkills');
writeNoop('danger-detect.js', 'startDangerDetect');
writeNoop('task-guard.js', 'startTaskGuard');
writeNoop('escape-hole.js', 'startEscapeHole');
writeNoop('voyager-skills.js', 'startVoyagerCurriculum');
// also export alias
try {
  const p = join(ROOT, 'src/agent/voyager-skills.js');
  writeFileSync(
    p,
    `/** DISABLED — curriculum moved into mindcraft-core */\nexport function startVoyagerCurriculum() { console.log('[DISABLED] voyager'); }\nexport function startVoyagerSkills() { console.log('[DISABLED] voyager'); }\n`
  );
} catch {}

const agentPath = join(ROOT, 'src/agent/agent.js');
if (!existsSync(agentPath)) process.exit(0);

let agent = readFileSync(agentPath, 'utf8');

// Chat spam filter
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

// Inject CLEAN stack once
if (!agent.includes('[DreamBot] CLEAN STACK')) {
  const block = `
            // [DreamBot] CLEAN STACK — Mindcraft core only (viewer untouched)
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
                const { startKillChat } = await import('./kill-chat.js');
                startKillChat(this);
            } catch (e) { console.warn('[DreamBot] killchat', e.message); }
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

// If old FULL STACK exists, still ensure mindcraft-core starts
if (agent.includes('[DreamBot] FULL STACK') && !agent.includes('startMindcraftCore')) {
  agent = agent.replace(
    /\/\/ \[DreamBot\] FULL STACK/,
    `// [DreamBot] FULL STACK (legacy — noops disable junk)
            try {
                const { startMindcraftCore } = await import('./mindcraft-core.js');
                startMindcraftCore(this);
            } catch (e) { console.warn('[DreamBot] mc-core', e.message); }
            // [DreamBot] CLEAN note`
  );
}

writeFileSync(agentPath, agent);
console.log('[post-wire] CLEAN STACK — mindcraft-core + pvp + social + viewer');
