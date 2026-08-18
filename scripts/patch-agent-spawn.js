/**
 * Progression-first, place blocks when stuck, no Exiting chat.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const SELF_PROMPT =
  'PROGRESSO obrigatorio agora: se tem log craft planks mesa stick wooden_pickaxe. Se tem pickaxe collectBlocks stone ou coal_ore. Se buraco placeBlock dirt ou cobblestone na frente (bridge). Se subida placeBlock no pe (pillar). equip tool certa. NAO so attack mob. 2-3 !comandos de progresso.';

function patchAgent() {
  const p = join(ROOT, 'src', 'agent', 'agent.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');

  src = src.split("this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');").join(
    '// DreamBot: no Exiting chat'
  );
  src = src.replace(
    /this\.bot\.chat\(\s*code\s*>\s*1\s*\?\s*['"]Restarting\.['"]\s*:\s*['"]Exiting\.['"]\s*\)\s*;/g,
    '// DreamBot: no Exiting chat'
  );
  src = src.replace(/this\.bot\.chat\([^)]*Exiting[^)]*\)\s*;/g, '// DreamBot: blocked Exiting');
  src = src.replace(/this\.bot\.chat\([^)]*Restarting[^)]*\)\s*;/g, '// DreamBot: blocked Restarting');

  if (src.includes('cleanKill(msg=') && !src.includes('DreamBot hard cleanKill')) {
    const cleanKillRe =
      /cleanKill\s*\(\s*msg\s*=\s*['"]Killing agent process\.\.\.['"]\s*,\s*code\s*=\s*1\s*\)\s*\{[\s\S]*?process\.exit\(code\);\s*\}/;
    if (cleanKillRe.test(src)) {
      src = src.replace(
        cleanKillRe,
        `cleanKill(msg='Killing agent process...', code=1) {
        // DreamBot hard cleanKill
        console.warn('[DreamBot] cleanKill:', msg, code);
        try { this.history.add('system', String(msg)); this.history.save(); } catch (_) {}
        if (/stuck|unstuck|Exiting|not spawned/i.test(String(msg))) {
          try {
            if (this.self_prompter && !this.self_prompter.isActive()) {
              this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
            }
          } catch (_) {}
          return;
        }
        process.exit(code);
    }`
      );
    }
  }

  if (src.includes('Hello world! I am')) {
    src = src.replace(
      /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/g,
      `try {
                if (this.self_prompter && !this.self_prompter.isActive()) {
                    this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                }
            } catch (e) {}
            setInterval(() => {
                try {
                    if (this.self_prompter && !this.self_prompter.isActive() && this.isIdle && this.isIdle()) {
                        this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                    }
                } catch (_) {}
            }, 45000);`
    );
  }

  if (!src.includes('DreamBot backup self-prompt') && /this\.bot\.once\(['"]spawn['"]/.test(src)) {
    src = src.replace(
      /this\.bot\.once\(['"]spawn['"]\s*,\s*async\s*\(\)\s*=>\s*\{/,
      `this.bot.once('spawn', async () => {
            // DreamBot backup self-prompt
            setTimeout(() => {
                try {
                    if (this.self_prompter && !this.self_prompter.isActive()) {
                        this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                    }
                } catch (_) {}
            }, 2000);
            setInterval(() => {
                try {
                    if (this.self_prompter && !this.self_prompter.isActive() && this.isIdle && this.isIdle()) {
                        this.self_prompter.start(${JSON.stringify(SELF_PROMPT)});
                    }
                } catch (_) {}
            }, 40000);`
    );
  }

  writeFileSync(p, src);
  console.log('[patch-agent-spawn] agent done');
}

function patchModes() {
  const p = join(ROOT, 'src', 'agent', 'modes.js');
  if (!existsSync(p)) return;
  let src = readFileSync(p, 'utf8');

  // never cleanKill on stuck
  src = src.replace(
    /agent\.cleanKill\(["']Got stuck and couldn't get unstuck["']\)/g,
    'console.warn("[DreamBot] stuck — place/bridge try")'
  );

  // Replace unstuck execute body to try placing a block (bridge/pillar) when stuck
  if (!src.includes('DreamBot unstuck place') && src.includes("I'm stuck")) {
    // inject place attempt before moveAway if we find the execute block
    const marker = 'await skills.moveAway(bot, 5)';
    if (src.includes(marker) && !src.includes('DreamBot unstuck place')) {
      src = src.replace(
        marker,
        `// DreamBot unstuck place: try pillar/bridge block then move
                    try {
                        const inv = bot.inventory.items();
                        const blockItem = inv.find(i =>
                            i.name.includes('dirt') || i.name.includes('cobble') ||
                            i.name.includes('planks') || i.name.includes('netherrack') ||
                            i.name === 'stone' || i.name.includes('log')
                        );
                        if (blockItem) {
                            await bot.equip(blockItem, 'hand').catch(() => {});
                            const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
                            if (ref) {
                                await bot.placeBlock(ref, new (await import('vec3')).Vec3(0, 1, 0)).catch(() => {});
                            }
                            const yaw = bot.entity.yaw;
                            const fx = -Math.sin(yaw);
                            const fz = -Math.cos(yaw);
                            const front = bot.blockAt(bot.entity.position.offset(Math.round(fx), -1, Math.round(fz)));
                            if (front) {
                                await bot.placeBlock(front, new (await import('vec3')).Vec3(0, 1, 0)).catch(() => {});
                            }
                        }
                        bot.setControlState('jump', true);
                        await new Promise(r => setTimeout(r, 300));
                        bot.setControlState('jump', false);
                    } catch (e) { console.warn('[DreamBot] unstuck place failed', e.message); }
                    await skills.moveAway(bot, 5)`
      );
      console.log('[patch-agent-spawn] unstuck place inject');
    }
  }

  src = src.replace(/say\(agent,\s*'I\\'m stuck!'\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*"I'm stuck!"\);/g, 'console.log("[DreamBot] unstuck");');
  src = src.replace(/say\(agent,\s*'I\\'m free\.'\);/g, 'console.log("[DreamBot] free");');
  src = src.replace(/say\(agent,\s*"I'm free\."\);/g, 'console.log("[DreamBot] free");');

  // Soften self_defense: don't interrupt if we can avoid — change interrupts from all if present
  // Keep defense but hunting already off in profile

  writeFileSync(p, src);
  console.log('[patch-agent-spawn] modes done');
}

try {
  patchAgent();
  patchModes();
  console.log('[patch-agent-spawn] done');
} catch (e) {
  console.warn('[patch-agent-spawn]', e.message);
}
