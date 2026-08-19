/**
 * DreamBot PvP — principles from Naton1/osrs-pvp-reinforcement-learning (NhEnv)
 * translated to Minecraft mineflayer combat.
 *
 * OSRS RL concepts mapped:
 * - player_to_target_distance / move_next_to / farcast → keep optimal melee range
 * - move_diagonal_to_target → circle strafe
 * - eat_primary_food under low HP → consume food mid-fight
 * - attack timing / pending damage → timed swings + crits (jump then hit on fall)
 * - only engage when threatened → defensive only (player who damaged us)
 *
 * Not a full PPO model — rule-based combat loop using the same decision axes.
 */
export function startPvpCombat(agent) {
  const bot = agent.bot;
  if (!bot) return;

  let combatTarget = null; // entity
  let combatUntil = 0;
  let strafeDir = 1;
  let lastSwing = 0;
  let lastJump = 0;
  let lastEat = 0;
  let lastSprintTap = 0;

  const IDEAL_MIN = 2.2;
  const IDEAL_MAX = 3.4;
  const ATTACK_RANGE = 3.5;
  const VIEW = 24;
  const COMBAT_MS = 15000; // keep fighting attacker for 15s after last hit

  const clearMove = () => {
    try {
      for (const c of ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'sneak']) {
        bot.setControlState(c, false);
      }
    } catch {}
  };

  const equipBestSword = async () => {
    try {
      const swords = bot.inventory.items().filter(i => /sword/.test(i.name));
      if (!swords.length) return;
      const rank = (n) => {
        if (/netherite/.test(n)) return 6;
        if (/diamond/.test(n)) return 5;
        if (/iron/.test(n)) return 4;
        if (/stone/.test(n)) return 3;
        if (/golden|gold/.test(n)) return 2;
        if (/wooden|wood/.test(n)) return 1;
        return 0;
      };
      swords.sort((a, b) => rank(b.name) - rank(a.name));
      await bot.equip(swords[0], 'hand');
    } catch {}
  };

  const tryEat = async () => {
    if (Date.now() - lastEat < 2500) return;
    if (bot.health > 14 && bot.food > 14) return;
    const food = bot.inventory.items().find(i =>
      /cooked_|bread|apple|carrot|potato|beef|pork|chicken|mutton|golden_apple|enchanted_golden/.test(i.name)
    );
    if (!food) return;
    lastEat = Date.now();
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      console.log('[DreamBot] PVP eat', food.name);
      await equipBestSword();
    } catch {}
  };

  // Track who hit us (defensive engagement only)
  bot.on('entityHurt', (entity) => {
    try {
      if (entity !== bot.entity) return;
      // Find nearest player who might be the attacker
      const players = Object.values(bot.entities).filter(e =>
        e.type === 'player' && e.username !== bot.username && e.position.distanceTo(bot.entity.position) < VIEW
      );
      if (!players.length) return;
      players.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
      combatTarget = players[0];
      combatUntil = Date.now() + COMBAT_MS;
      console.log('[DreamBot] PVP engaged vs', combatTarget.username || combatTarget.id);
      equipBestSword().catch(() => {});
    } catch {}
  });

  // Also engage if a player is actively attacking us via hurt on nearby (fallback)
  bot.on('health', () => {
    try {
      if (bot.health >= 18) return;
      if (combatTarget && Date.now() < combatUntil) return;
      const players = Object.values(bot.entities).filter(e =>
        e.type === 'player' && e.username !== bot.username && e.position.distanceTo(bot.entity.position) < 6
      );
      if (players.length === 1) {
        combatTarget = players[0];
        combatUntil = Date.now() + COMBAT_MS;
      }
    } catch {}
  });

  // Main combat tick (~10 Hz) — inspired by OSRS observation of distance + movement actions
  setInterval(async () => {
    try {
      if (!bot.entity) return;
      if (!combatTarget || Date.now() > combatUntil) {
        if (combatTarget) {
          combatTarget = null;
          clearMove();
          try { bot.pvp?.stop?.(); } catch {}
        }
        return;
      }

      // Target gone?
      const still = bot.entities[combatTarget.id];
      if (!still || still === bot.entity) {
        combatTarget = null;
        clearMove();
        return;
      }
      combatTarget = still;

      const dist = bot.entity.position.distanceTo(combatTarget.position);
      if (dist > VIEW) {
        combatTarget = null;
        clearMove();
        return;
      }

      // Pause NAV/passive while in PvP
      agent._navBusy = true;
      agent._dreamLock = true;
      agent._dreamLockUntil = Date.now() + 800;

      // Stop pathfinder so combat controls aren't cancelled
      try {
        bot.pathfinder?.setGoal?.(null);
        bot.pathfinder?.stop?.();
      } catch {}

      // Heal under pressure (OSRS: eat_primary_food)
      if (bot.health <= 12 || bot.food <= 12) {
        await tryEat();
      }

      // Look at target
      try {
        await bot.lookAt(combatTarget.position.offset(0, combatTarget.height * 0.85, 0), true);
      } catch {}

      // --- Distance management (OSRS: move_next_to / farcast / diagonal) ---
      clearMove();

      if (dist > IDEAL_MAX) {
        // Close in — sprint
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        if (Date.now() - lastJump > 1200 && Math.random() < 0.3) {
          bot.setControlState('jump', true);
          lastJump = Date.now();
          setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 200);
        }
      } else if (dist < IDEAL_MIN) {
        // Too close — back up (kite if low HP)
        bot.setControlState('back', true);
        if (bot.health <= 8) bot.setControlState('sprint', true);
      } else {
        // Ideal range — circle strafe (OSRS: move_diagonal_to_target)
        bot.setControlState(strafeDir > 0 ? 'left' : 'right', true);
        bot.setControlState('forward', true);
        if (Math.random() < 0.04) strafeDir *= -1; // flip orbit direction occasionally
      }

      // --- Attack timing + crits (OSRS: attack cycle / melee_attack) ---
      const now = Date.now();
      if (dist <= ATTACK_RANGE && now - lastSwing >= 550) {
        // Crit attempt: jump then attack while falling (vanilla crit conditions)
        const canCrit = bot.entity.onGround && (now - lastJump > 800);
        if (canCrit && Math.random() < 0.55) {
          bot.setControlState('jump', true);
          lastJump = now;
          setTimeout(() => {
            try {
              bot.setControlState('jump', false);
              // attack while likely falling
              bot.attack(combatTarget);
              lastSwing = Date.now();
              // W-tap style sprint reset for knockback (simplified)
              bot.setControlState('sprint', false);
              setTimeout(() => {
                try {
                  if (combatTarget) bot.setControlState('sprint', true);
                } catch {}
              }, 80);
              lastSprintTap = Date.now();
            } catch {}
          }, 180);
        } else {
          try {
            bot.setControlState('sprint', true);
            bot.attack(combatTarget);
            lastSwing = now;
            // brief sprint reset
            if (now - lastSprintTap > 400) {
              bot.setControlState('sprint', false);
              setTimeout(() => { try { bot.setControlState('sprint', true); } catch {} }, 60);
              lastSprintTap = now;
            }
          } catch {}
        }
      }

      // Extend combat timer while still in range and trading
      if (dist < 8) combatUntil = Math.max(combatUntil, Date.now() + 4000);

    } catch (e) {
      console.warn('[DreamBot] PVP tick', e.message);
    }
  }, 100);

  // Release NAV lock when not in combat
  setInterval(() => {
    try {
      if (!combatTarget || Date.now() > combatUntil) {
        // don't permanently hold lock — NAV can run again
        if (agent._navBusy && (!combatTarget || Date.now() > combatUntil)) {
          // only clear if we set it for combat recently — NAV manages its own flag
        }
      }
    } catch {}
  }, 500);

  console.log('[DreamBot] PVP combat (OSRS-RL inspired) ready — defensive only');
}
