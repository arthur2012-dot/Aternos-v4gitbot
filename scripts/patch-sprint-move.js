/**
 * Passive anti-idle: if standing still too long, sprint-walk a bit.
 * Also force allowSprinting on movements when possible.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) {
    console.warn('[patch-sprint-move] modes.js missing');
    return;
  }
  let src = readFileSync(p, 'utf8');
  if (src.includes('dream_keep_moving')) {
    console.log('[patch-sprint-move] already patched');
    return;
  }

  const modeBlock = `,
    {
        name: 'dream_keep_moving',
        description: 'If idle too long, sprint forward briefly so bot does not stand still (passive).',
        interrupts: [],
        on: true,
        active: false,
        last_move: 0,
        update: async function (agent) {
            if (Date.now() - this.last_move < 12000) return;
            if (!agent.isIdle()) return;
            const bot = agent.bot;
            if (!bot.entity) return;
            // don't interrupt combat recovery
            if (bot.lastDamageTime && Date.now() - bot.lastDamageTime < 4000) return;
            this.last_move = Date.now();
            execute(this, agent, async () => {
                try {
                    bot.setControlState('sprint', true);
                    bot.setControlState('forward', true);
                    await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
                    bot.setControlState('forward', false);
                    bot.setControlState('sprint', false);
                    // slight turn so it is not always same direction
                    const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.2;
                    await bot.look(yaw, bot.entity.pitch, true).catch(() => {});
                    if (skills && skills.moveAway) {
                        await skills.moveAway(bot, 4).catch(() => {});
                    }
                } catch (e) {
                    try {
                        bot.setControlState('forward', false);
                        bot.setControlState('sprint', false);
                    } catch (_) {}
                }
            });
        }
    }`;

  // Insert before cheat mode or at end of modes array-ish — before export default
  if (src.includes("name: 'cheat'")) {
    src = src.replace("name: 'cheat'", modeBlock.slice(1) + ",\n    {\n        name: 'cheat'");
    // that might break structure - safer insert before the cheat object more carefully
  }

  // Safer: find "name: 'cheat'" block start and insert before it
  const cheatIdx = src.indexOf("name: 'cheat'");
  if (cheatIdx !== -1) {
    // find the { before this name
    let brace = src.lastIndexOf('{', cheatIdx);
    if (brace !== -1) {
      src = src.slice(0, brace) + modeBlock.trim().replace(/^,/, '') + ',\n    ' + src.slice(brace);
      // fix double structure - actually modeBlock starts with comma and full object
    }
  } else if (src.includes('export const modes') || src.includes('const modes')) {
    // append before closing of array
    const last = src.lastIndexOf('];');
    if (last !== -1) {
      src = src.slice(0, last) + modeBlock + '\n' + src.slice(last);
    }
  }

  // Simpler reliable approach: if injection got messy, use unique marker append via replace of idle_staring section end
  if (!src.includes('dream_keep_moving')) {
    const anchor = "name: 'idle_staring'";
    const i = src.indexOf(anchor);
    if (i !== -1) {
      // find end of idle_staring object - next "}," after a reasonable chunk
      const after = src.indexOf('\n    },', i);
      if (after !== -1) {
        src = src.slice(0, after + 6) + modeBlock + src.slice(after + 6);
      }
    }
  }

  writeFileSync(p, src);
  console.log('[patch-sprint-move] modes patched');
}

function patchSkillsSprint() {
  const p = join(ROOT, 'src', 'agent', 'library', 'skills.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');
  if (src.includes('DreamBot force sprint goto')) return;
  // when goToGoal runs, enable sprint
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
  patchModes();
  patchSkillsSprint();
  console.log('[patch-sprint-move] done');
} catch (e) {
  console.warn('[patch-sprint-move]', e.message);
}
