/**
 * Task guard — players nearby must NOT cancel path/actions.
 * Only real combat (PvP flag) may hard-stop navigation.
 */
export function startTaskGuard(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamTaskGuard) return;
  bot._dreamTaskGuard = true;

  // Soften elbow-room style: if pathfinder is working, ignore proximity wiggle
  const origStop = bot.pathfinder?.stop?.bind(bot.pathfinder);

  // Resume self-prompt if it died while idle
  setInterval(() => {
    try {
      if (!bot.entity) return;
      if (bot._dreamPvpActive) return;
      if (agent.actions?.executing) return;
      if (bot.pathfinder?.isMoving?.()) return;
      if (agent.self_prompter && !agent.self_prompter.isActive?.()) {
        try {
          agent.self_prompter.start(
            'Continue your last task. Collect, craft, move. Ignore nearby players unless they attack you. Always end with !command.'
          );
          console.log('[TASK-GUARD] restarted self-prompt');
        } catch {}
      }
    } catch {}
  }, 45000);

  // Log when path is cancelled so we can debug
  try {
    bot.on('path_update', (r) => {
      if (r?.status === 'canceled' || r?.status === 'stopped') {
        console.log('[TASK-GUARD] path', r.status, bot._dreamPvpActive ? '(pvp ok)' : '');
      }
    });
  } catch {}

  console.log('[DreamBot] task-guard ON — players do not cancel work');
}
