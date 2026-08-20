/**
 * Chat OFF on init. Guard isIdle. Never overwrite isIdle function.
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
    // [DreamBot] CHAT INIT OFF
    console.log('[DreamBot] self_prompter.start blocked');
    this.loop_active = false;
    return;`
    );
  }
  if (!sp.includes('[DreamBot] self-prompt disabled')) {
    sp = sp.replace(
      /async startLoop\s*\(\s*\)\s*\{/,
      `async startLoop() {
    this.loop_active = false;
    return;`
    );
  }
  if (!sp.includes('[DreamBot] no auto self-prompt')) {
    sp = sp.replace(
      /update\s*\(\s*delta\s*\)\s*\{/,
      `update(delta) {
    return;`
    );
  }
  writeFileSync(spPath, sp);
  console.log('[ai-nonblock] self_prompter blocked');
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
    `console.log('[DreamBot] spawn silent');`
  );
  agent = agent.replace(/await this\.actions\.stop\(\);/g, 'void 0;');
  agent = agent.replace(/this\.actions\.stop\(\);/g, 'void 0;');
  writeFileSync(agentPath, agent);
  console.log('[ai-nonblock] agent init OFF');
}

for (const rel of ['settings.js', 'src/settings.js']) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  let t = readFileSync(p, 'utf8');
  const n = t.replace(/init_message:\s*["'][^"']*["']/, 'init_message: ""');
  if (n !== t) {
    writeFileSync(p, n);
    console.log('[ai-nonblock] wiped init_message', rel);
  }
}

for (const rel of ['profiles/dream.json']) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'));
    d.conversing = false;
    d.coding = false;
    writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
    console.log('[ai-nonblock] conversing=false', rel);
  } catch {}
}

// Guard modes.js isIdle — prevents TypeError after bad assignment
try {
  const modesPath = join(ROOT, 'src/agent/modes.js');
  if (existsSync(modesPath)) {
    let modes = readFileSync(modesPath, 'utf8');
    modes = modes.replace(
      /_agent\.isIdle\(\)/g,
      '(typeof _agent.isIdle === "function" ? _agent.isIdle() : true)'
    );
    modes = modes.replace(
      /(?<![_\w])agent\.isIdle\(\)/g,
      '(typeof agent.isIdle === "function" ? agent.isIdle() : true)'
    );
    writeFileSync(modesPath, modes);
    console.log('[ai-nonblock] modes isIdle guarded');
  }
} catch (e) {
  console.warn('[ai-nonblock] modes patch', e.message);
}
