/**
 * DreamBot PvP — defensive + combo timing (Jazzghost-style rhythm).
 * Only fights when DAMAGED. Crit jump + land hit + W-tap + strafe.
 * Not infinite chase. Not aggressive first-hit.
 */
export function startPvpCombat(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamPvpV3) return;
  bot._dreamPvpV3 = true;

  let target = null;
  let fightUntil = 0;
  let lastSwing = 0;
  let lastJump = 0;
  let strafeDir = 1;
  let lastStrafeFlip = 0;
  let cooldownUntil = 0;
  let comboPhase = 0; // 0 idle, 1 jumped, 2 hit

  const FIGHT_WINDOW = 12000;
  const MAX_CHASE = 11;
  const IDEAL_MIN = 2.1;
  const IDEAL_MAX = 3.2;
  const REACH = 3.35;
  const COOLDOWN_AFTER = 2500;
  // Sword cooldown ~0.625s (10 ticks) — hit on cooldown for clean combos
  const SWING_MS = 625;

  const clearMove = () => {
    try {
      for (const c of ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'sneak']) {
        bot.setControlState(c, false);
      }
    } catch {}
  };

  const stop = (why) => {
    if (target) console.log('[DreamBot] PVP end:', why);
    target = null;
    fightUntil = 0;
    comboPhase = 0;
    bot._dreamPvpActive = false;
    cooldownUntil = Date.now() + COOLDOWN_AFTER;
    clearMove();
    try { bot.pvp?.stop?.(); } catch {}
    try {
      agent._navBusy = false;
      agent._dreamLock = false;
    } catch {}
  };

  const bestWeapon = async () => {
    try {
      const items = bot.inventory.items();
      const weapons = items.filter(i => /sword|axe/.test(i.name));
      if (!weapons.length) return;
      const score = (n) => {
        let s = /sword/.test(n) ? 10 : 5;
        if (/netherite/.test(n)) s += 50;
        else if (/diamond/.test(n)) s += 40;
        else if (/iron/.test(n)) s += 30;
        else if (/stone/.test(n)) s += 20;
        else if (/gold/.test(n)) s += 12;
        else s += 5;
        return s;
      };
      weapons.sort((a, b) => score(b.name) - score(a.name));
      await bot.equip(weapons[0], 'hand');
    } catch {}
  };

  const tryEat = async () => {
    if (bot.health > 11) return;
    const food = bot.inventory.items().find(i =>
      /golden_apple|cooked_|bread|apple|beef|pork|chicken|carrot|potato|mutton/.test(i.name)
    );
    if (!food) return;
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      await bestWeapon();
    } catch {}
  };

  // ONLY engage when we take damage (not on nearby swing)
  bot.on('entityHurt', (entity) => {
    try {
      if (entity !== bot.entity) return;
      if (Date.now() < cooldownUntil && !target) return;

      const players = Object.values(bot.entities).filter(e =>
        e.type === 'player' &&
        e.username !== bot.username &&
        e.position.distanceTo(bot.entity.position) <= 7
      );
      if (!players.length) return;

      players.sort(
        (a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
      );

      const now = Date.now();
      target = players[0];
      fightUntil = now + FIGHT_WINDOW;
      bot._dreamPvpActive = true;
      console.log('[DreamBot] PVP defend', target.username || target.id);
      bestWeapon().catch(() => {});
    } catch {}
  });

  setInterval(async () => {
    try {
      if (!bot.entity || !target) return;

      if (Date.now() > fightUntil) {
        stop('timer');
        return;
      }

      const ent = bot.entities[target.id];
      if (!ent) {
        stop('gone');
        return;
      }
      target = ent;

      const dist = bot.entity.position.distanceTo(target.position);
      if (dist > MAX_CHASE) {
        stop('fled');
        return;
      }

      try {
        bot.pathfinder?.setGoal?.(null);
        bot.pathfinder?.stop?.();
      } catch {}

      if (bot.health <= 9) await tryEat();

      try {
        await bot.lookAt(target.position.offset(0, target.height * 0.88, 0), true);
      } catch {}

      // --- Movement: circle + pressure ---
      clearMove();

      if (dist > IDEAL_MAX) {
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        // occasional hop while closing
        if (Date.now() - lastJump > 700 && bot.entity.onGround) {
          bot.setControlState('jump', true);
          lastJump = Date.now();
          setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 100);
        }
      } else if (dist < IDEAL_MIN) {
        bot.setControlState('back', true);
        if (bot.health <= 8) bot.setControlState('sprint', true);
      } else {
        // Ideal band: strafe circle (combo space)
        if (Date.now() - lastStrafeFlip > 650) {
          strafeDir *= -1;
          lastStrafeFlip = Date.now();
        }
        bot.setControlState(strafeDir > 0 ? 'left' : 'right', true);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
      }

      // --- Combo attack: crit on cooldown ---
      const now = Date.now();
      if (dist > REACH || now - lastSwing < SWING_MS) return;

      // Crit: jump then hit slightly after apex / on fall
      const doCrit =
        bot.entity.onGround &&
        now - lastJump > 550 &&
        Math.random() < 0.72;

      if (doCrit) {
        comboPhase = 1;
        bot.setControlState('jump', true);
        lastJump = now;
        setTimeout(() => {
          try {
            bot.setControlState('jump', false);
            // hit mid-air / landing for crit
            bot.attack(target);
            lastSwing = Date.now();
            comboPhase = 2;
            // W-tap: cancel sprint briefly for KB reset feel
            bot.setControlState('sprint', false);
            bot.setControlState('forward', false);
            setTimeout(() => {
              try {
                if (!target) return;
                bot.setControlState('sprint', true);
                bot.setControlState('forward', true);
                comboPhase = 0;
              } catch {}
            }, 90);
          } catch {}
        }, 145);
      } else {
        // Normal timed hit
        try {
          bot.setControlState('sprint', true);
          bot.attack(target);
          lastSwing = now;
          // micro W-tap
          bot.setControlState('forward', false);
          setTimeout(() => {
            try {
              if (target) bot.setControlState('forward', true);
            } catch {}
          }, 55);
        } catch {}
      }
    } catch (e) {
      console.warn('[DreamBot] PVP tick', e.message);
    }
  }, 100);

  console.log('[DreamBot] PVP v4 — combo crit + W-tap + strafe (defensive only)');
}
