/**
 * SECURITY: Players must NEVER force Mindcraft !commands.
 * Only system / self-prompt / LLM output can run commands.
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

// Replace the user forced-command block
const oldBlock = /if \(!self_prompt && !from_other_bot\) \{ \/\/ from user, check for forced commands[\s\S]*?if \(user_command_name === '!newAction'\)[\s\S]*?\}\s*else \{[\s\S]*?return false;[\s\S]*?\}\s*\}/;

const newBlock = `if (!self_prompt && !from_other_bot) { // from user
            // [DreamBot] SECURITY block player commands — never execute ! from players
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                console.warn('[SECURITY] blocked player command from', source, ':', user_command_name);
                // Strip !command so it is treated as normal chat text only (no execute, no "does not exist")
                message = message.replace(/![a-zA-Z][\\w]*/g, '').trim();
                if (!message) return false;
            }
            // natural language continues below (LLM may reply, but cannot be forced)
        }`;

if (oldBlock.test(agent)) {
  agent = agent.replace(oldBlock, newBlock);
  console.log('[security] patched forced-command block');
} else {
  // Fallback: inject early in handleMessage after self_prompt definition
  if (agent.includes('const self_prompt = source ===') && !agent.includes('[DreamBot] SECURITY')) {
    agent = agent.replace(
      /const self_prompt = source === 'system' \|\| source === this\.name;/
      ,
      `const self_prompt = source === 'system' || source === this.name;
        // [DreamBot] SECURITY block player commands
        if (!self_prompt && source !== this.name) {
            const _inj = containsCommand(message);
            if (_inj) {
                console.warn('[SECURITY] blocked', source, _inj);
                message = String(message).replace(/![a-zA-Z][\\w]*/g, '').trim();
                if (!message) return false;
            }
        }`
    );
    console.log('[security] injected early guard');
  } else {
    console.warn('[security] could not find block — manual check needed');
  }
}

// Also suppress "Command does not exist" public replies if any remain
agent = agent.replace(
  /this\.routeResponse\(source, `Command '\$\{user_command_name\}' does not exist\.\`\);/g,
  `console.warn('[SECURITY] ignore unknown cmd'); return false;`
);
agent = agent.replace(
  /Command '\$\{user_command_name\}' does not exist\./g,
  ''
);

writeFileSync(agentPath, agent);
console.log('[security] agent hardened');
