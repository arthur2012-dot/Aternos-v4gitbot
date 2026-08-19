/**
 * DreamBot PvP — DEFENSIVE ONLY, short fights, no "go crazy" after 1 hit.
 *
 * Rules:
 * - Only fights the player who actually hurt him (entityHurt)
 * - Max ~4 seconds of retaliation after LAST hit taken
 * - Does NOT extend fight just because player is nearby
 * - Cooldown 8s before re-engaging same player
 * - Stops if player walks away (>6 blocks) or bot is not taking hits
 * - Never starts fights, never chases far
 */
export function startPvpCombat(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamPvpFixed) return;
  bot._dreamPvpFixed = true;

  let combatTarget = null;
  let combatUntil = 0;
  let lastHitTaken = 0;
  let lastSwing = 0;
  let hitsGiven = 0;
  let cooldownUntil = 0;
  let lastTargetName = null;

  const MAX_FIGHT_MS = 4000;   // max 4s after last damage taken
  const MAX_HITS = 4;          // stop after a few swings
  const DISENGAGE_DIST = 6;
  const ATTACK_RANGE = 3.2;
  const COOLDOWN_MS = 8000;
  const SWING_CD = 700;

  const clearMove = () => {
    try {
      for (const c of ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'sneak']) {
        bot.setControlState(c, false);
      }
    } catch {}
  };

  const stopCombat = (why) => {
    if (combatTarget) {
      console.log('[DreamBot] PVP stop:', why);
      lastTargetName = combatTarget.username || null;
      cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    combatTarget = null;
    combatUntil = 0;
    hitsGiven = 0;
    bot._dreamPvpActive = false;
    clearMove();
    try { bot.pvp?.stop?.(); } catch {}
    try { agent._navBusy = false; agent._dreamLock = false; } catch {}
  };

  const equipSword = async () => {
    try {
      const swords = bot.inventory.items().filter(i => /sword/.test(i.name));
      if (!swords.length) return;
      const rank = (n) =>
        /netherite/.test(n) ? 6 : /diamond/.test(n) ? 5 : /iron/.test(n) ? 4 :
        /stone/.test(n) ? 3 : /gold/.test(n) ? 2 : 1;
      swords.sort((a, b) => rank(b.name) - rank(a.name));
      await bot.equip(swords[0], 'hand');
    } catch {}
  };

  // ONLY engage when WE take damage
  bot.on('entityHurt', (entity) => {
    try {
      if (entity !== bot.entity) return;
      if (Date.now() < cooldownUntil) return;

      const now = Date.now();
      lastHitTaken = now;

      // Prefer player holding a weapon / very close
      const players = Object.values(bot.entities).filter(e =>
        e.type === 'player' &&
        e.username !== bot.username &&
        e.position.distanceTo(bot.entity.position) < 5
      );
      if (!players.length) return;

      players.sort(
        (a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
      );

      const t = players[0];
      // Don't instantly re-aggro same person during cooldown window
      if (t.username === lastTargetName && now < cooldownUntil) return;

      combatTarget = t;
      combatUntil = now + MAX_FIGHT_MS;
      hitsGiven = 0;
      bot._dreamPvpActive = true;
      console.log('[DreamBot] PVP defend vs', t.username || t.id, '(max 4s)');
      equipSword().catch(() => {});
    } catch {}
  });

  // Combat tick — slower, calmer
  setInterval(() => {
    try {
      if (!bot.entity) return;

      if (!combatTarget || Date.now() > combatUntil) {
        if (combatTarget) stopCombat('time up');
        return;
      }

      // No new damage for 2.5s → stop (player stopped hitting)
      if (Date.now() - lastHitTaken > 2500 && hitsGiven >= 1) {
        stopCombat('player stopped hitting');
        return;
      }

      if (hitsGiven >= MAX_HITS) {
        stopCombat('hit limit');
        return;
      }

      const still = bot.entities[combatTarget.id];
      if (!still) {
        stopCombat('target gone');
        return;
      }
      combatTarget = still;

      const dist = bot.entity.position.distanceTo(combatTarget.position);
      if (dist > DISENGAGE_DIST) {
        stopCombat('target too far');
        return;
      }

      // Soft controls — no crazy circle strafe forever
      try {
        bot.pathfinder?.setGoal?.(null);
      } catch {}

      bot.lookAt(combatTarget.position.offset(0, 1.2, 0), true).catch(() => {});

      clearMove();
      if (dist > 3.0) {
        bot.setControlState('forward', true);
      } else if (dist < 1.8) {
        bot.setControlState('back', true);
      }

      const now = Date.now();
      if (dist <= ATTACK_RANGE && now - lastSwing >= SWING_CD) {
        try {
          bot.attack(combatTarget);
          lastSwing = now;
          hitsGiven++;
        } catch {}
      }

      // DO NOT extend combatUntil when near — that was the bug

    } catch (e) {
      console.warn('[DreamBot] PVP', e.message);
    }
  }, 200);

  console.log('[DreamBot] PVP fixed — short defensive only (4s / 4 hits max)');
}
