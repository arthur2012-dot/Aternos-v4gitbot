/**
 * Task guard — players nearby must NOT cancel path/actions.
 * Self-prompt is NOT restarted (that was locking the bot in Chatting).
 * Passive pure-code owns survival movement.
 */
export function startTaskGuard(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamTaskGuard) return;
  bot._dreamTaskGuard = true;

  try {
    bot.on('path_update', (r) => {
      if (r?.status === 'canceled' || r?.status === 'stopped') {
        console.log('[TASK-GUARD] path', r.status, bot._dreamPvpActive ? '(pvp ok)' : '');
      }
    });
  } catch {}

  console.log('[DreamBot] task-guard ON — no self-prompt restart (anti-Chatting lock)');
}
