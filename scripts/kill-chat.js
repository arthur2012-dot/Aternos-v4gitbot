/**
 * Force-clear Mindcraft Chatting/Thinking lock every 1.5s.
 * Emergency dig-out when HP critical or trapped in corridor.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clearChatLock(agent) {
  try { agent.self_prompter?.stopLoop?.(); } catch {}
  try { agent.self_prompter?.stop?.(); } catch {}
  try {
    if (agent.self_prompter) {
      agent.self_prompter.loop_active = false;
      agent.self_prompter.state = 0;
    }
  } catch {}
  try { agent.actions?.stop?.(); } catch {}
  try { agent.coder?.stop?.(); } catch {}
  try { agent.isIdle = true; } catch {}
  try { agent.busy = false; } catch {}
}

async function emergencyEscape(bot) {
  if (!bot?.entity || bot._killChatEscaping) return;
  bot._killChatEscaping = true;
  try {
    console.log('[KILLCHAT] emergency escape hp=' + bot.health);
    bot.clearControlStates();

    const pos = bot.entity.position;
    for (let y = 1; y <= 3; y++) {
      const b = bot.blockAt(pos.offset(0, y, 0));
      if (b && b.boundingBox === 'block' && !/bedrock|barrier|command/.test(b.name || '')) {
        try {
          await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true);
          await Promise.race([
            bot.dig(b, true),
            new Promise((_, r) => setTimeout(() => r(new Error('t')), 6000)),
          ]);
        } catch {
          try { bot.stopDigging(); } catch {}
        }
      }
    }

    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (const oy of [0, 1]) {
      const b = bot.blockAt(pos.offset(dx * 0.95, oy, dz * 0.95));
      if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name || '')) {
        try {
          await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true);
          await Promise.race([
            bot.dig(b, true),
            new Promise((_, r) => setTimeout(() => r(new Error('t')), 5000)),
          ]);
        } catch {
          try { bot.stopDigging(); } catch {}
        }
      }
    }

    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    bot.setControlState('jump', true);
    await sleep(800);
    bot.clearControlStates();
  } catch (e) {
    console.warn('[KILLCHAT]', (e.message || '').slice(0, 40));
  } finally {
    bot._killChatEscaping = false;
  }
}

export function startKillChat(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamKillChat) return;
  bot._dreamKillChat = true;

  let lastEsc = 0;

  setInterval(async () => {
    try {
      clearChatLock(agent);
      if (!bot.entity) return;
      if (bot._dreamPvpActive || bot._escapeBusy) return;

      const hp = bot.health;
      const pos = bot.entity.position.floored();
      let walls = 0;
      for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = bot.blockAt(pos.offset(o[0], 0, o[1]));
        if (b && b.boundingBox === 'block') walls++;
      }
      const ceiling = bot.blockAt(pos.offset(0, 2, 0));
      const trappedLike =
        walls >= 2 ||
        (ceiling && ceiling.boundingBox === 'block') ||
        (bot._passiveStillTicks || 0) >= 3;

      if ((hp <= 6 || trappedLike) && Date.now() - lastEsc > 2500) {
        lastEsc = Date.now();
        await emergencyEscape(bot);
      }
    } catch {}
  }, 1500);

  bot.on('health', async () => {
    try {
      if (bot.health <= 4 && Date.now() - lastEsc > 2000) {
        lastEsc = Date.now();
        clearChatLock(agent);
        await emergencyEscape(bot);
      }
    } catch {}
  });

  console.log('[KILLCHAT] ON — force clear Chatting every 1.5s + emergency dig');
}
