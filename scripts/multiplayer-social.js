/**
 * MULTIPLAYER SOCIAL — human-like player interaction
 * - Player memory (friendly / neutral / hostile score)
 * - Greeting when someone approaches
 * - Friendship gestures: crouch, jump, look, arm swing
 * - Short PT-BR chat (Dream style, no spam)
 * - Soft follow on request
 * - Occasional gift drop to friends
 * - Never attacks first (PvP module handles defense)
 * - Respects dig lock / PvP / curriculum busy
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isBusy(bot) {
  return !!(bot._digLocked || bot._dreamPvpActive || bot._escapeBusy || bot.targetDigBlock);
}

function nearestPlayers(bot, maxD = 24) {
  const list = [];
  for (const e of Object.values(bot.entities || {})) {
    if (!e || e === bot.entity) continue;
    if (e.type !== 'player') continue;
    if (e.username === bot.username) continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d <= maxD) list.push({ entity: e, dist: d, name: e.username || String(e.id) });
  }
  list.sort((a, b) => a.dist - b.dist);
  return list;
}

/** Short Dream-style PT-BR lines — no spam, no !!! */
const GREET = [
  'eae',
  'opa',
  'suave',
  'fala',
  'oi',
];
const ACK = [
  'blz',
  'tmj',
  'valeu',
  'ok',
  'show',
];
const BYE = [
  'flw',
  'até',
  'vlw',
];
const FOLLOW_OK = [
  'to indo',
  'ja vou',
  'perai',
];
const CONFUSED = [
  'hã',
  'o q',
  'como assim',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function startMultiplayerSocial(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamMpSocial) return;
  bot._dreamMpSocial = true;

  /** @type {Map<string, { score: number, lastSeen: number, greeted: boolean, lastGesture: number }> } */
  const memory = new Map();

  let lastChatAt = 0;
  let following = null; // username
  let followUntil = 0;
  let lastGiftAt = 0;
  let socialBusy = false;

  const CHAT_COOLDOWN = 12000; // min between bot chats
  const GESTURE_COOLDOWN = 8000;

  function mem(name) {
    if (!memory.has(name)) {
      memory.set(name, { score: 0, lastSeen: Date.now(), greeted: false, lastGesture: 0 });
    }
    return memory.get(name);
  }

  function safeChat(msg) {
    const now = Date.now();
    if (now - lastChatAt < CHAT_COOLDOWN) return;
    if (!msg || !String(msg).trim()) return;
    lastChatAt = now;
    try {
      // use agent openChat if available (respects suppress filters)
      if (typeof agent.openChat === 'function') {
        agent.openChat(String(msg).slice(0, 80));
      } else {
        bot.chat(String(msg).slice(0, 80));
      }
    } catch {}
  }

  async function lookAtPlayer(p) {
    try {
      await bot.lookAt(p.position.offset(0, (p.height || 1.6) * 0.9, 0), true);
    } catch {}
  }

  /** Friendship crouch spam (2-3 crouches) */
  async function gestureCrouch() {
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      bot.setControlState('sneak', true);
      await sleep(180 + Math.random() * 120);
      bot.setControlState('sneak', false);
      await sleep(120 + Math.random() * 100);
    }
  }

  async function gestureJump() {
    bot.setControlState('jump', true);
    await sleep(120);
    bot.setControlState('jump', false);
  }

  async function gestureWave() {
    try {
      bot.swingArm('right', true);
    } catch {}
    await sleep(200);
    try {
      bot.swingArm('right', true);
    } catch {}
  }

  async function doFriendlyGesture(playerEnt, name) {
    if (isBusy(bot) || socialBusy) return;
    const m = mem(name);
    if (Date.now() - m.lastGesture < GESTURE_COOLDOWN) return;
    m.lastGesture = Date.now();
    socialBusy = true;
    try {
      await lookAtPlayer(playerEnt);
      const roll = Math.random();
      if (roll < 0.45) await gestureCrouch();
      else if (roll < 0.75) {
        await gestureWave();
        await gestureCrouch();
      } else {
        await gestureJump();
        await sleep(100);
        await gestureCrouch();
      }
      console.log('[MP] gesture →', name);
    } catch {
    } finally {
      try {
        bot.clearControlStates();
      } catch {}
      socialBusy = false;
    }
  }

  async function tryGift(playerEnt, name) {
    if (isBusy(bot) || socialBusy) return;
    if (Date.now() - lastGiftAt < 90000) return;
    const m = mem(name);
    if (m.score < 2) return; // only friends

    const junk = bot.inventory.items().find((i) =>
      /dirt|cobblestone|cobbled|netherrack|gravel|sand|seeds|rotten|bone|string|stick/.test(i.name)
    );
    if (!junk || junk.count < 1) return;
    if (playerEnt.position.distanceTo(bot.entity.position) > 4) return;

    socialBusy = true;
    lastGiftAt = Date.now();
    try {
      await lookAtPlayer(playerEnt);
      await bot.toss(junk.type, null, 1);
      m.score += 1;
      console.log('[MP] gift', junk.name, '→', name);
      if (Math.random() < 0.4) safeChat(pick(ACK));
    } catch {
    } finally {
      socialBusy = false;
    }
  }

  // ── Chat reactions ──
  bot.on('chat', async (username, message) => {
    try {
      if (!username || username === bot.username) return;
      if (isBusy(bot)) return;

      const msg = String(message || '').toLowerCase().trim();
      if (!msg) return;

      // ignore system-ish / command injection
      if (/^!|\.\/|system prompt|ignore previous|jailbreak/i.test(msg)) return;

      const m = mem(username);
      m.lastSeen = Date.now();

      const botName = (bot.username || 'dreambot').toLowerCase();
      const mentioned =
        msg.includes(botName) ||
        msg.includes('dream') ||
        msg.includes('bot') ||
        /\boi\b|\beae\b|\bola\b|\bfala\b|\bsalve\b/.test(msg);

      // hostility in chat
      if (/kill|morre|lixo|noob|kys|mate|hack/.test(msg) && mentioned) {
        m.score = Math.max(m.score - 3, -10);
        return;
      }

      // friendly chat
      if (/\bobg\b|valeu|obrigad|tmj|gg|nice|top|bom|legal/.test(msg)) {
        m.score = Math.min(m.score + 2, 15);
        if (mentioned || Math.random() < 0.5) safeChat(pick(ACK));
        return;
      }

      // follow request
      if (/(vem|follow|me segue|vem ca|vem cá|aqui)/.test(msg) && (mentioned || true)) {
        const p = bot.players[username]?.entity;
        if (p) {
          following = username;
          followUntil = Date.now() + 45000;
          m.score = Math.min(m.score + 1, 15);
          safeChat(pick(FOLLOW_OK));
          console.log('[MP] follow', username);
        }
        return;
      }

      // stop follow
      if (/(para|stop|fica|sai|leave)/.test(msg) && mentioned) {
        following = null;
        followUntil = 0;
        try {
          bot.pathfinder?.setGoal?.(null);
        } catch {}
        safeChat(pick(ACK));
        return;
      }

      // greeting
      if (mentioned || /\boi\b|\beae\b|\bola\b|\bfala\b|\bsalve\b|\bopa\b/.test(msg)) {
        m.score = Math.min(m.score + 1, 15);
        safeChat(pick(GREET));
        const ent = bot.players[username]?.entity;
        if (ent) doFriendlyGesture(ent, username).catch(() => {});
        return;
      }

      // low chance react to random chat when nearby
      const ent = bot.players[username]?.entity;
      if (ent && ent.position.distanceTo(bot.entity.position) < 12 && Math.random() < 0.12) {
        safeChat(pick(ACK));
      }
    } catch {}
  });

  // ── Hurt by player → memory ──
  bot.on('entityHurt', (entity) => {
    try {
      if (entity !== bot.entity) return;
      // find closest player as likely attacker
      const near = nearestPlayers(bot, 5)[0];
      if (!near) return;
      const m = mem(near.name);
      m.score = Math.max(m.score - 2, -10);
      m.lastSeen = Date.now();
    } catch {}
  });

  // ── Periodic social awareness ──
  setInterval(async () => {
    try {
      if (!bot.entity || isBusy(bot) || socialBusy) return;

      // follow mode
      if (following && Date.now() < followUntil) {
        const pe = bot.players[following]?.entity;
        if (pe) {
          const d = pe.position.distanceTo(bot.entity.position);
          if (d > 3.5) {
            try {
              await lookAtPlayer(pe);
              bot.setControlState('forward', true);
              if (d > 6) bot.setControlState('sprint', true);
              await sleep(400);
              bot.clearControlStates();
            } catch {
              try {
                bot.clearControlStates();
              } catch {}
            }
          } else {
            await lookAtPlayer(pe);
            if (Math.random() < 0.2) await gestureCrouch();
          }
          return;
        }
      } else if (following && Date.now() >= followUntil) {
        following = null;
      }

      const players = nearestPlayers(bot, 16);
      if (!players.length) return;

      const closest = players[0];
      const m = mem(closest.name);
      m.lastSeen = Date.now();

      // first approach → greet + gesture
      if (!m.greeted && closest.dist < 10) {
        m.greeted = true;
        m.score = Math.min(m.score + 1, 15);
        if (Math.random() < 0.7) safeChat(pick(GREET));
        await doFriendlyGesture(closest.entity, closest.name);
        return;
      }

      // nearby friend → occasional gesture
      if (closest.dist < 6 && m.score >= 0 && Math.random() < 0.15) {
        await doFriendlyGesture(closest.entity, closest.name);
      }

      // gift to good friends
      if (closest.dist < 3.5 && m.score >= 3 && Math.random() < 0.08) {
        await tryGift(closest.entity, closest.name);
      }

      // hostile score → keep distance (look + step back once)
      if (m.score <= -4 && closest.dist < 4 && Math.random() < 0.3) {
        await lookAtPlayer(closest.entity);
        bot.setControlState('back', true);
        await sleep(400);
        bot.clearControlStates();
      }

      // glance at nearby players sometimes (human)
      if (closest.dist < 12 && Math.random() < 0.1 && !isBusy(bot)) {
        await lookAtPlayer(closest.entity);
      }
    } catch {}
  }, 3500);

  // reset greet on respawn so he can say hi again
  bot.on('spawn', () => {
    for (const m of memory.values()) m.greeted = false;
  });

  console.log('[MP] social ON — gestures, memory, chat, follow, gifts');
}
