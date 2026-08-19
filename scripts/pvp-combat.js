/**
 * DreamBot PvP — defensive, skilled, not crazy.
 *
 * - Only starts when a player damages him
 * - Each NEW hit he takes refreshes the fight timer (fair)
 * - Does NOT refresh just because you're nearby (that was the old bug)
 * - Strafe, sprint, crits, range control
 * - Stops if you run away or timer ends
 */
export function startPvpCombat(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamPvpV3) return;
  bot._dreamPvpV3 = true;

  let target = null;
  let fightUntil = 0;
  let lastDamageAt = 0;
  let lastSwing = 0;
  let lastJump = 0;
  let strafeDir = 1;
  let cooldownUntil = 0;

  // Balanced: good fight, not infinite
  const FIGHT_WINDOW = 10000;  // 10s after last damage taken
  const MAX_CHASE = 10;        // stop if player farther than this
  const IDEAL_MIN = 2.0;
  const IDEAL_MAX = 3.3;
  const REACH = 3.4;
  const SWING_MS = 580;        // roughly sword cooldown feel
  const COOLDOWN_AFTER = 3000; // 3s before re-engage same situation

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
    if (bot.health > 12) return;
    const food = bot.inventory.items().find(i =>
      /cooked_|bread|apple|golden_apple|beef|pork|chicken|carrot|potato|mutton/.test(i.name)
    );
    if (!food) return;
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      await bestWeapon();
    } catch {}
  };

  // Engage / refresh ONLY when we take damage
  bot.on('entityHurt', (entity) => {
    try {
      if (entity !== bot.entity) return;
      if (Date.now() < cooldownUntil && !target) return;

      const players = Object.values(bot.entities).filter(e =>
        e.type === 'player' &&
        e.username !== bot.username &&
        e.position.distanceTo(bot.entity.position) <= 6
      );
      if (!players.length) return;

      players.sort(
        (a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
      );

      const now = Date.now();
      lastDamageAt = now;
      target = players[0];
      // Refresh timer only on actual damage — fair and not infinite
      fightUntil = now + FIGHT_WINDOW;
      bot._dreamPvpActive = true;
      console.log('[DreamBot] PVP defend', target.username || target.id);
      bestWeapon().catch(() => {});
    } catch {}
  });

  setInterval(async () => {
    try {
      if (!bot.entity) return;
      if (!target) return;

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

      if (bot.health <= 10) await tryEat();

      try {
        await bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true);
      } catch {}

      clearMove();

      // Distance control
      if (dist > IDEAL_MAX) {
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
      } else if (dist < IDEAL_MIN) {
        bot.setControlState('back', true);
        if (bot.health <= 8) bot.setControlState('sprint', true);
      } else {
        // Circle strafe in ideal range
        bot.setControlState(strafeDir > 0 ? 'left' : 'right', true);
        bot.setControlState('forward', Math.random() > 0.35);
        if (Math.random() < 0.03) strafeDir *= -1;
      }

      const now = Date.now();
      if (dist <= REACH && now - lastSwing >= SWING_MS) {
        const wantCrit =
          bot.entity.onGround &&
          now - lastJump > 900 &&
          Math.random() < 0.45;

        if (wantCrit) {
          bot.setControlState('jump', true);
          lastJump = now;
          setTimeout(() => {
            try {
              bot.setControlState('jump', false);
              bot.attack(target);
              lastSwing = Date.now();
              // light W-tap
              bot.setControlState('sprint', false);
              setTimeout(() => {
                try {
                  if (target) bot.setControlState('sprint', true);
                } catch {}
              }, 70);
            } catch {}
          }, 160);
        } else {
          try {
            bot.setControlState('sprint', true);
            bot.attack(target);
            lastSwing = now;
          } catch {}
        }
      }
    } catch (e) {
      console.warn('[DreamBot] PVP tick', e.message);
    }
  }, 120);

  console.log('[DreamBot] PVP v3 — defensive, skilled, 10s window per hit taken');
}
