/**
 * Disable init Chatting completely.
 * Self-prompt never starts. Chat answers players only, never stops body.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const spPath = join(ROOT, 'src/agent/self_prompter.js');
const agentPath = join(ROOT, 'src/agent/agent.js');

if (existsSync(spPath)) {
  let sp = readFileSync(spPath, 'utf8');

  sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, 'void 0;');
  sp = sp.replace(/this\.agent\.actions\.stop\(\);/g, 'void 0;');
  sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 1');
  sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');

  if (!sp.includes('[DreamBot] CHAT INIT OFF')) {
    sp = sp.replace(
      /async start\s*\([^)]*\)\s*\{/,
      `async start(...args) {
    // [DreamBot] CHAT INIT OFF — no self-prompt ever
    console.log('[DreamBot] self_prompter.start blocked');
    this.loop_active = false;
    return;
    /* disabled */`
    );
  }
  if (!sp.includes('[DreamBot] self-prompt disabled')) {
    sp = sp.replace(
      /async startLoop\s*\(\s*\)\s*\{/,
      `async startLoop() {
    // [DreamBot] self-prompt disabled
    this.loop_active = false;
    return;`
    );
  }
  if (!sp.includes('[DreamBot] no auto self-prompt')) {
    sp = sp.replace(
      /update\s*\(\s*delta\s*\)\s*\{/,
      `update(delta) {
    // [DreamBot] no auto self-prompt
    return;`
    );
  }

  writeFileSync(spPath, sp);
  console.log('[ai-nonblock] self_prompter fully blocked');
}

if (existsSync(agentPath)) {
  let agent = readFileSync(agentPath, 'utf8');

  agent = agent.replace(
    /if\s*\(\s*this\.self_prompter\s*&&\s*!this\.self_prompter\.isActive\(\)\s*\)\s*\{\s*this\.self_prompter\.start\([^)]*\);\s*\}/gs,
    '/* no init chat */'
  );
  agent = agent.replace(/this\.self_prompter\.start\([^)]*\);/g, '/* no init chat */');

  agent = agent.replace(
    /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
    `console.log('[DreamBot] spawn silent — no init chat');`
  );

  agent = agent.replace(/await this\.actions\.stop\(\);/g, 'void 0;');
  agent = agent.replace(/this\.actions\.stop\(\);/g, 'void 0;');

  writeFileSync(agentPath, agent);
  console.log('[ai-nonblock] agent init chat OFF');
}

for (const rel of ['settings.js', 'src/settings.js']) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  let t = readFileSync(p, 'utf8');
  const n = t.replace(/init_message:\s*["'][^"']*["']/, 'init_message: ""');
  if (n !== t) {
    writeFileSync(p, n);
    console.log('[ai-nonblock] wiped init_message in', rel);
  }
}
