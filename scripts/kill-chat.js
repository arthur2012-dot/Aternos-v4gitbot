/**
 * HARD kill Thinking/Chatting lock
 * Mindcraft SelfPrompter states: STOPPED=0 ACTIVE=1 PAUSED=2
 * UI shows "Chatting" when self_prompter loop or conversation is active.
 */

function hardStopPrompter(agent) {
  const sp = agent.self_prompter;
  if (!sp) return;
  try {
    sp.interrupt = true;
  } catch {}
  try {
    sp.loop_active = false;
  } catch {}
  try {
    sp.active = false;
  } catch {}
  try {
    sp.state = 0; // STOPPED
  } catch {}
  try {
    sp.idle_time = 0;
  } catch {}
  try {
    if (typeof sp.stopLoop === 'function') sp.stopLoop();
  } catch {}
  try {
    if (typeof sp.stop === 'function') sp.stop(false);
  } catch {}
}

function clearChatLock(agent) {
  hardStopPrompter(agent);

  try {
    agent.is_processing = false;
  } catch {}
  try {
    agent.busy = false;
  } catch {}
  try {
    if (typeof agent.actions?.stop === 'function') agent.actions.stop();
  } catch {}
  try {
    agent.coder?.stop?.();
  } catch {}
  try {
    agent.coder?.executing = false;
  } catch {}

  // end any bot-bot conversation holding Chatting
  try {
    agent.conversationManager?.endAllConversations?.();
  } catch {}
  try {
    if (agent.conversationManager) {
      agent.conversationManager.activeConversation = null;
      agent.conversationManager.awaiting_response = false;
    }
  } catch {}

  // clear mode display if any
  try {
    if (agent.bot) {
      agent.bot._dreamChatLock = false;
    }
  } catch {}
}

export function startKillChat(agent) {
  if (!agent || agent._dreamKillChat) return;
  agent._dreamKillChat = true;

  // aggressive: every 800ms
  setInterval(() => {
    try {
      clearChatLock(agent);
    } catch {}
  }, 800);

  // also after spawn
  setTimeout(() => clearChatLock(agent), 2000);
  setTimeout(() => clearChatLock(agent), 8000);

  console.log('[KILLCHAT] HARD ON — force STOPPED self_prompter');
}
