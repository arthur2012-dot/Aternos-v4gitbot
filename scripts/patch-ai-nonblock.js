/**
 * Never permanently stop self-prompt; never kill actions on pause.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const spPath = join(ROOT, 'src/agent/self_prompter.js');

if (!existsSync(spPath)) process.exit(0);

let sp = readFileSync(spPath, 'utf8');

sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, '/* no actions.stop */ void 0;');
sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 999');
sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');

// Restart self-prompt instead of stopping forever
if (sp.includes('Stopping auto-prompting') || sp.includes('did not use command')) {
  sp = sp.replace(
    /let out = `Agent did not use command[\s\S]*?this\.state = PAUSED;/,
    `console.warn('[DreamBot] LLM no command — passive continues, restart prompt soon');
                    this.state = PAUSED;
                    setTimeout(() => {
                        try { this.start(this.prompt || 'Survive. Use !collectBlocks or !craftRecipe.'); } catch {}
                    }, 30000);`
  );
}

writeFileSync(spPath, sp);
console.log('[ai-nonblock] self_prompter never permanent-stop');
