/**
 * Safe sprint helpers. Does NOT inject objects into modes.js (that caused SyntaxError).
 * Movement while idle is handled in agent self-prompt + pathfinder sprint.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();

function restoreModesIfBroken() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  const src = readFileSync(p, 'utf8');
  // Heuristic: broken injection left orphaned braces / duplicate name cheat weirdness
  const broken =
    src.includes('dream_keep_moving') ||
    (src.match(/name: 'cheat'/g) || []).length > 1 ||
    /\n\s*\{\s*\n\s*\{/.test(src);

  if (!broken) {
    // still try parse-ish: count braces roughly
    const opens = (src.match(/\{/g) || []).length;
    const closes = (src.match(/\}/g) || []).length;
    if (Math.abs(opens - closes) > 2) {
      // fall through to restore
    } else {
      console.log('[patch-sprint-move] modes.js looks OK');
      return false;
    }
  }

  console.warn('[patch-sprint-move] restoring modes.js from upstream mindcraft...');
  try {
    const tmp = join(ROOT, '.modes-restore');
    execSync('rm -rf "' + tmp + '" && git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "' + tmp + '"', {
      stdio: 'inherit',
      shell: true,
    });
    const good = readFileSync(join(tmp, 'src', 'agent', 'modes.js'), 'utf8');
    writeFileSync(p, good);
    execSync('rm -rf "' + tmp + '"', { shell: true });
    console.log('[patch-sprint-move] modes.js restored');
    return true;
  } catch (e) {
    console.warn('[patch-sprint-move] restore failed:', e.message);
    return false;
  }
}

function patchSkillsSprint() {
  const p = join(ROOT, 'src', 'agent', 'library', 'skills.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  if (src.includes('DreamBot force sprint goto')) return;
  if (src.includes('export async function goToGoal')) {
    src = src.replace(
      /export async function goToGoal\(bot, goal\)\s*\{/,
      `export async function goToGoal(bot, goal) {
    // DreamBot force sprint goto
    try { bot.setControlState('sprint', true); } catch (_) {}`
    );
    writeFileSync(p, src);
    console.log('[patch-sprint-move] skills sprint');
  }
}

try {
  restoreModesIfBroken();
  patchSkillsSprint();
  console.log('[patch-sprint-move] done (no modes inject)');
} catch (e) {
  console.warn('[patch-sprint-move]', e.message);
}
