/**
 * Last-resort: if agent.js has bare try without catch/finally, comment it out
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = process.cwd();
const agentPath = join(ROOT, 'src/agent/agent.js');

if (!existsSync(agentPath)) process.exit(0);

let src = readFileSync(agentPath, 'utf8');

// Detect broken "this._llmBusy = true; try {" without matching catch from old patch
if (src.includes('this._llmBusy = true') && src.includes('try {')) {
  // Remove llmBusy try-open that was never closed
  src = src.replace(
    /\/\/ \[DreamBot\] llmBusy[\s\S]*?this\._llmBusy = true;\s*try \{/g,
    '// [DreamBot] llmBusy flag removed (syntax fix)\n        this._llmBusy = false;'
  );
  src = src.replace(
    /this\._llmBusy = true;\s*try \{/g,
    'this._llmBusy = false; // was broken try'
  );
}

// If still has "try {" right after handleMessage opening from bad inject
src = src.replace(
  /async handleMessage\(([^)]*)\) \{\s*\/\/ \[DreamBot\] llmBusy[^\n]*\n\s*this\._llmBusy = true;\s*try \{/,
  'async handleMessage($1) {
        this._llmBusy = false;'
);

writeFileSync(agentPath, src);

// Verify syntax with node --check
const check = spawnSync(process.execPath, ['--check', agentPath], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('[fix-syntax] agent.js still invalid:', check.stderr?.slice(0, 300));
  // Nuclear: restore from mindcraft tmp if available
  const tmp = join(ROOT, '.mindcraft-base/src/agent/agent.js');
  if (existsSync(tmp)) {
    const clean = readFileSync(tmp, 'utf8');
    writeFileSync(agentPath, clean);
    console.warn('[fix-syntax] restored clean agent.js from mindcraft base');
    // Re-apply only security (safe)
    try {
      await import('./patch-security.js');
    } catch {
      // run as process
      spawnSync(process.execPath, [join(ROOT, 'scripts/patch-security.js')], { stdio: 'inherit' });
    }
  }
} else {
  console.log('[fix-syntax] agent.js OK');
}
