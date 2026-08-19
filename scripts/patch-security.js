/**
 * SECURITY: block player !command injection without breaking agent.js syntax
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const agentPath = join(ROOT, 'src/agent/agent.js');

if (!existsSync(agentPath)) {
  console.warn('[security] no agent.js');
  process.exit(0);
}

let agent = readFileSync(agentPath, 'utf8');

if (agent.includes('[DreamBot] SECURITY block player commands')) {
  console.log('[security] already patched');
  process.exit(0);
}

// Safe injection: only after self_prompt const, no try without catch
const marker = /const self_prompt = source === 'system' \|\| source === this\.name;/;
if (marker.test(agent)) {
  agent = agent.replace(
    marker,
    `const self_prompt = source === 'system' || source === this.name;
        // [DreamBot] SECURITY block player commands
        if (!self_prompt && source !== this.name) {
            try {
                const _inj = containsCommand(message);
                if (_inj) {
                    console.warn('[SECURITY] blocked', source, _inj);
                    message = String(message).replace(/![a-zA-Z][\\w]*/g, '').trim();
                    if (!message) return false;
                }
            } catch (e) { console.warn('[SECURITY]', e.message); }
        }`
  );
  writeFileSync(agentPath, agent);
  console.log('[security] player !commands blocked');
} else {
  console.warn('[security] marker not found — skip');
}
