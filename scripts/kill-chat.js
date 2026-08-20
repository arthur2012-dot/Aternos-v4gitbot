/**
 * Kill Thinking/Chatting lock ONLY.
 * Does NOT dig blocks (that was causing random break spam).
 */
function clearChatLock(agent) {
  try {
    agent.self_prompter?.stopLoop?.();
  } catch {}
  try {
    agent.self_prompter?.stop?.();
  } catch {}
  try {
    if (agent.self_prompter) {
      agent.self_prompter.loop_active = false;
      agent.self_prompter.active = false;
    }
  } catch {}
  try {
    if (typeof agent.actions?.stop === 'function') agent.actions.stop();
  } catch {}
  try {
    agent.coder?.stop?.();
  } catch {}
  try {
    if (agent.is_processing) agent.is_processing = false;
  } catch {}
}

export function startKillChat(agent) {
  if (!agent || agent._dreamKillChat) return;
  agent._dreamKillChat = true;

  setInterval(() => {
    try {
      clearChatLock(agent);
    } catch {}
  }, 1500);

  console.log('[KILLCHAT] ON — clear Thinking only (no dig)');
}
