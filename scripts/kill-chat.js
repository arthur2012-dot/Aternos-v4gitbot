/**
 * HARD kill Thinking/Chatting lock
 * Mindcraft SelfPrompter states: STOPPED=0 ACTIVE=1 PAUSED=2
 */
function hardStopPrompter(agent) {
  const sp = agent.self_prompter;
  if (!sp) return;
  try { sp.interrupt = true; } catch {}
  try { sp.loop_active = false; } catch {}
  try { sp.active = false; } catch {}
  try { sp.state = 0; } catch {}
  try { sp.idle_time = 0; } catch {}
  try { if (typeof sp.stopLoop === 'function') sp.stopLoop(); } catch {}
  try { if (typeof sp.stop === 'function') sp.stop(false); } catch {}
}

function clearChatLock(agent) {
  hardStopPrompter(agent);
  try { agent.is_processing = false; } catch {}
  try { agent.busy = false; } catch {}
  try { if (typeof agent.actions?.stop === 'function') agent.actions.stop(); } catch {}
  try { agent.coder?.stop?.(); } catch {}
  try {
    if (agent.coder) agent.coder.executing = false;
  } catch {}
  try { agent.conversationManager?.endAllConversations?.(); } catch {}
  try {
    if (agent.conversationManager) {
      agent.conversationManager.activeConversation = null;
      agent.conversationManager.awaiting_response = false;
    }
  } catch {}
  try {
    if (agent.bot) agent.bot._dreamChatLock = false;
  } catch {}
}

export function startKillChat(agent) {
  if (!agent || agent._dreamKillChat) return;
  agent._dreamKillChat = true;
  setInterval(() => {
    try { clearChatLock(agent); } catch {}
  }, 800);
  setTimeout(() => clearChatLock(agent), 2000);
  setTimeout(() => clearChatLock(agent), 8000);
  console.log('[KILLCHAT] HARD ON — force STOPPED self_prompter');
}
