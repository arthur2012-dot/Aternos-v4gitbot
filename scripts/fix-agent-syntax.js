/**
 * Fix broken try without catch in agent.js from old patches
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = process.cwd();
const agentPath = join(ROOT, 'src/agent/agent.js');

if (!existsSync(agentPath)) {
  console.warn('[fix-syntax] no agent.js');
  process.exit(0);
}

let src = readFileSync(agentPath, 'utf8');

// Remove broken llmBusy try inject
src = src.replace(
  /\/\/ \[DreamBot\] llmBusy[\s\S]{0,120}?this\._llmBusy = true;\s*try \{/g,
  'this._llmBusy = false;'
);
src = src.replace(/this\._llmBusy = true;\s*try \{/g, 'this._llmBusy = false;');

writeFileSync(agentPath, src);

const check = spawnSync(process.execPath, ['--check', agentPath], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('[fix-syntax] still invalid, restoring base agent.js');
  console.error((check.stderr || '').slice(0, 400));
  const tmp = join(ROOT, '.mindcraft-base/src/agent/agent.js');
  if (existsSync(tmp)) {
    copyFileSync(tmp, agentPath);
    console.warn('[fix-syntax] restored clean agent.js');
    spawnSync(process.execPath, [join(ROOT, 'scripts/patch-security.js')], { stdio: 'inherit' });
    spawnSync(process.execPath, [join(ROOT, 'scripts/patch-ai-nonblock.js')], { stdio: 'inherit' });
  }
} else {
  console.log('[fix-syntax] agent.js syntax OK');
}
