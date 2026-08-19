/**
 * LLM must never block body. Self-prompt soft. Passive is primary.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const spPath = join(ROOT, 'src/agent/self_prompter.js');

if (!existsSync(spPath)) process.exit(0);

let sp = readFileSync(spPath, 'utf8');

sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, '/* passive owns body */ void 0;');
sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 999');
sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');

// Longer gap between auto-prompts so passive can work (less LLM spam)
if (sp.includes('setTimeout') || sp.includes('prompt_interval') || sp.includes('AUTO_PROMPT')) {
  sp = sp.replace(/prompt_interval\s*=\s*\d+/g, 'prompt_interval = 25000');
}

writeFileSync(spPath, sp);
console.log('[ai-nonblock] LLM soft; passive primary');
