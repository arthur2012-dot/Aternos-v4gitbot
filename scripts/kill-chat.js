/**
 * Kill Thinking/Chatting lock. Dig out of 1-wide stone corridors.
 * NEVER overwrite agent.isIdle (must stay a function).
 */
import { escapeHole, isTrapped } from './escape-hole.js';
import { digBlock } from './dig-place.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clearChatLock(agent) {
  try { agent.self_prompter?.stopLoop?.(); } catch {}
  try { agent.self_prompter?.stop?.(); } catch {}
  try {
    if (agent.self_prompter) {
      agent.self_prompter.loop_active = false;
      agent.self_prompter.active = false;
    }
  } catch {}
  try {
    if (typeof agent.actions?.stop === 'function') agent.actions.stop();
  } catch {}
  try { agent.coder?.stop?.(); } catch {}
  try {
    if (agent.is_processing) agent.is_processing = false;
  } catch {}
  try {
    if (agent.thoughts) agent.thoughts = [];
  } catch {}
}

async function digStoneCorridor(bot) {
  if (!bot?.entity) return false;
  console.log('[KILLCHAT] dig STONE CORRIDOR out');
  try { bot.clearControlStates(); } catch {}
  try { bot.pathfinder?.setGoal?.(null); } catch {}

  const pos = bot.entity.position;
  const pf = pos.floored();

  // 1) Ceiling + head first (path out upward)
  for (let y = 1; y <= 4; y++) {
    const b = bot.blockAt(pf.offset(0, y, 0));
    if (b && b.boundingBox === 'block' && !/bedrock|barrier|command/.test(b.name || '')) {
      console.log('[KILLCHAT] dig ceiling', b.name, 'y+' + y);
      await digBlock(bot, b, { maxMs: 22000, retries: 4 });
    }
  }

  // 2) All 4 horizontal walls at body + head
  for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const oy of [0, 1]) {
      const b = bot.blockAt(pf.offset(o[0], oy, o[1]));
      if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name || '')) {
        console.log('[KILLCHAT] dig wall', b.name, o[0], oy, o[1]);
        await digBlock(bot, b, { maxMs: 22000, retries: 3 });
      }
    }
  }

  // 3) Face direction dig
  const yaw = bot.entity.yaw;
  const dx = Math.round(-Math.sin(yaw));
  const dz = Math.round(-Math.cos(yaw));
  for (const oy of [0, 1, 2]) {
    const b = bot.blockAt(pf.offset(dx, oy, dz));
    if (b && b.boundingBox === 'block' && !/bedrock|barrier/.test(b.name || '')) {
      await digBlock(bot, b, { maxMs: 22000, retries: 3 });
    }
  }

  // 4) Sprint + jump out
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  bot.setControlState('jump', true);
  await sleep(1000);
  bot.clearControlStates();
  return true;
}

export function startKillChat(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamKillChat) return;
  bot._dreamKillChat = true;

  let lastEsc = 0;
  let lastPosKey = '';
  let stillCount = 0;

  // Clear Thinking every 800ms
  setInterval(() => {
    try { clearChatLock(agent); } catch {}
  }, 800);

  setInterval(async () => {
    try {
      clearChatLock(agent);
      if (!bot.entity) return;
      if (bot._dreamPvpActive || bot._escapeBusy || bot._killChatEscaping) return;

      const pos = bot.entity.position;
      const key = Math.floor(pos.x) + ',' + Math.floor(pos.y) + ',' + Math.floor(pos.z);
      if (key === lastPosKey) stillCount++;
      else {
        stillCount = 0;
        lastPosKey = key;
      }

      const pf = pos.floored();
      let walls = 0;
      for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = bot.blockAt(pf.offset(o[0], 0, o[1]));
        if (b && b.boundingBox === 'block') walls++;
      }
      const head = bot.blockAt(pf.offset(0, 1, 0));
      const headBlocked = head && head.boundingBox === 'block';
      const trapped = walls >= 2 || headBlocked || stillCount >= 3;

      if (trapped && Date.now() - lastEsc > 2500) {
        lastEsc = Date.now();
        bot._killChatEscaping = true;
        try {
          console.log('[KILLCHAT] trapped walls=' + walls + ' still=' + stillCount);
          clearChatLock(agent);
          if (typeof isTrapped === 'function' && isTrapped(bot)) {
            await escapeHole(bot);
          }
          await digStoneCorridor(bot);
          stillCount = 0;
        } finally {
          bot._killChatEscaping = false;
        }
      }
    } catch (e) {
      console.warn('[KILLCHAT]', (e.message || '').slice(0, 50));
      bot._killChatEscaping = false;
    }
  }, 1200);

  console.log('[KILLCHAT] ON — anti-Thinking + stone corridor dig');
}
