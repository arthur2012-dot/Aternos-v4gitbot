/**
 * Disable self-prompt "relembrar" loop. Passive pure-code owns survival.
 * LLM only answers player chat — never auto-reminds identity/goals.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const spPath = join(ROOT, 'src/agent/self_prompter.js');
const agentPath = join(ROOT, 'src/agent/agent.js');

if (existsSync(spPath)) {
  let sp = readFileSync(spPath, 'utf8');

  // Never stop body for LLM
  sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, '/* passive owns body */ void 0;');

  // Don't kill loop hard — but we will not start it
  sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 2');
  sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');

  // Disable auto-restart on idle (the "relembrando" spam source)
  if (!sp.includes('[DreamBot] no auto self-prompt')) {
    sp = sp.replace(
      /update\s*\(\s*delta\s*\)\s*\{/,
      `update(delta) {
    // [DreamBot] no auto self-prompt — passive code handles survival
    return;`
    );
  }

  // startLoop becomes no-op
  if (!sp.includes('[DreamBot] self-prompt disabled')) {
    sp = sp.replace(
      /async startLoop\s*\(\s*\)\s*\{/,
      `async startLoop() {
    // [DreamBot] self-prompt disabled — pure passive brain
    console.log('[DreamBot] self-prompt skip (passive owns AI)');
    this.loop_active = false;
    return;
    /* original startLoop below disabled */`
    );
  }

  writeFileSync(spPath, sp);
  console.log('[ai-nonblock] self-prompt DISABLED — no relembrar');
}

if (existsSync(agentPath)) {
  let agent = readFileSync(agentPath, 'utf8');
  agent = agent.replace(
    /if\s*\(\s*this\.self_prompter\s*&&\s*!this\.self_prompter\.isActive\(\)\s*\)\s*\{\s*this\.self_prompter\.start\([^)]*\);\s*\}/gs,
    '/* DreamBot: no self-prompt start */'
  );
  agent = agent.replace(
    /this\.self_prompter\.start\([^)]*\);/g,
    '/* no self-prompt */'
  );
  writeFileSync(agentPath, agent);
  console.log('[ai-nonblock] agent self-prompt starts removed');
}
