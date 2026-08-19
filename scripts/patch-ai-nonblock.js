/**
 * Soft AI non-block — never inject broken try/catch into agent.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const spPath = join(ROOT, 'src/agent/self_prompter.js');

if (!existsSync(spPath)) {
  console.warn('[ai-nonblock] no self_prompter');
  process.exit(0);
}

let sp = readFileSync(spPath, 'utf8');

// Never kill physical actions when pausing
sp = sp.replace(
  /await this\.agent\.actions\.stop\(\);/g,
  '/* [DreamBot] no actions.stop on AI pause */ void 0;'
);

sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 40');
sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');

writeFileSync(spPath, sp);
console.log('[ai-nonblock] self_prompter soft-pause OK');
