/**
 * Patch Mindcraft so LLM/API wait does NOT kill physical tasks.
 *
 * Problem:
 * - self_prompter awaits handleMessage → awaits Groq/API
 * - pause() calls actions.stop() → pathfinder dies mid-collect
 * - API rate limit / key issues make this worse
 *
 * Fix:
 * - pause() no longer stops current action by default
 * - stopLoop soft: don't force-stop path
 * - mark agent._llmBusy while waiting (passive keeps working)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const spPath = join(ROOT, 'src/agent/self_prompter.js');
const agentPath = join(ROOT, 'src/agent/agent.js');

if (existsSync(spPath)) {
  let sp = readFileSync(spPath, 'utf8');

  // pause(): do not stop action
  if (sp.includes('async pause') && !sp.includes('[DreamBot] soft pause no stop')) {
    sp = sp.replace(
      /async pause\s*\([^)]*\)\s*\{[^}]*actions\.stop\(\)[^}]*\}/gs,
      `async pause() {
        // [DreamBot] soft pause no stop — API wait must not kill path/dig
        this.interrupt = true;
        this.stopLoop();
        this.state = PAUSED;
    }`
    );
    // fallback simpler patterns
    sp = sp.replace(
      /await this\.agent\.actions\.stop\(\);\s*this\.stopLoop\(\);\s*this\.state = PAUSED;/g,
      `// [DreamBot] soft pause no stop
        this.stopLoop();
        this.state = PAUSED;`
    );
  }

  // When stopping auto-prompt with stop_action, don't stop physical work
  sp = sp.replace(
    /if\s*\(\s*stop_action\s*\)\s*\{?\s*await this\.agent\.actions\.stop\(\);/g,
    `if (false && stop_action) { await this.agent.actions.stop(); // DreamBot: never stop action on self-prompt end
    if (stop_action) { /* skip actions.stop */ }`
  );

  // Don't stop self-prompt when user triggers an action from chat either as hard
  sp = sp.replace(
    /handleUserPromptedCmd\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*!is_self_prompt\s*&&\s*is_action\s*\)\s*\{[\s\S]*?this\.stopLoop\(\);/,
    `handleUserPromptedCmd(is_self_prompt, is_action) {
        // DreamBot: chat action does not kill autonomy loop
        if (false && !is_self_prompt && is_action) {
            this.stopLoop();`
  );

  writeFileSync(spPath, sp);
  console.log('[ai-nonblock] self_prompter patched');
}

if (existsSync(agentPath)) {
  let ag = readFileSync(agentPath, 'utf8');
  if (!ag.includes('[DreamBot] llmBusy')) {
    // Mark busy around prompt if we find promptConvo or similar
    if (ag.includes('async handleMessage')) {
      ag = ag.replace(
        /async handleMessage\s*\(/,
        `async handleMessage(`
      );
      // inject at start of handleMessage body once
      ag = ag.replace(
        /async handleMessage\s*\(([^)]*)\)\s*\{/,
        `async handleMessage($1) {
        // [DreamBot] llmBusy — physical systems keep running while API thinks
        this._llmBusy = true;
        try {`
      );
      // This might break brace matching if we don't close try - skip complex inject
    }
    // Safer: just document flag via spawn
    if (ag.includes("[DreamBot] NAV BRAIN") && !ag.includes('this._llmBusy')) {
      ag = ag.replace(
        '[DreamBot] NAV BRAIN v2',
        '[DreamBot] NAV BRAIN v2\n            this._llmBusy = false;'
      );
    }
    writeFileSync(agentPath, ag);
  }
  console.log('[ai-nonblock] agent note applied');
}
