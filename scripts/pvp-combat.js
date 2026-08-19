/**
 * DreamBot PvP v5 — human defensive only
 * - Never attacks first
 * - Fall / water / fire / cactus damage does NOT start a fight
 * - One light hit → look + step back (no full fight)
 * - 2+ hits in a few seconds → short defend, then stop
 * - Long cooldown so he doesn't stay "bravo"
 */
export function startPvpCombat(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamPvpV5) return;
  bot._dreamPvpV5 = true;

  let target = null;
  let fightUntil = 0;
  let lastSwing = 0;
  let lastJump = 0;
  let strafeDir = 1;
  let lastStrafeFlip = 0;
  let cooldownUntil = 0;
  let lastHealth = 20;
  let recentHits = 0;
  let hitWindowUntil = 0;
  let lastLookAt = null;

  const FIGHT_MS = 6500;
  const MAX_CHASE = 7;
  const REACH = 3.2;
  const COOLDOWN_MS = 9000;
  const SWING_MS = 700;
  const TAP_HITS_NEED = 2;

  const clearMove = () => {
    try {
      for (const c of ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'sneak']) {
        bot.setControlState(c, false);
      }
    } catch {}
  };

  const stop = (why) => {
    if (target) console.log('[PVP] end', why);
    target = null;
    fightUntil = 0;
    bot._dreamPvpActive = false;
    cooldownUntil = Date.now() + COOLDOWN_MS;
    clearMove();
    try { bot.pvp?.stop?.(); } catch {}
  };

  const bestWeapon = async () => {
    try {
      const items = bot.inventory.items();
      const weapons = items.filter((i) => /sword|axe/.test(i.name));
      if (!weapons.length) return;
      const score = (n) => {
        let s = /sword/.test(n) ? 10 : 5;
        if (/netherite/.test(n)) s += 50;
        else if (/diamond/.test(n)) s += 40;
        else if (/iron/.test(n)) s += 30;
        else if (/stone/.test(n)) s += 20;
        else s += 5;
        return s;
      };
      weapons.sort((a, b) => score(b.name) - score(a.name));
      await bot.equip(weapons[0], 'hand');
    } catch {}
  };

  const envDanger = () => {
    try {
      if (bot.entity.isInWater) return true;
      if (bot.entity.isInLava) return true;
      const under = bot.blockAt(bot.entity.position.offset(0, -0.2, 0));
      if (under && /lava|magma|fire|cactus|campfire|sweet_berry/.test(under.name || '')) return true;
      const feet = bot.blockAt(bot.entity.position);
      if (feet && /lava|fire|cactus/.test(feet.name || '')) return true;
      if (bot.entity.velocity && bot.entity.velocity.y < -0.6) return true;
    } catch {}
    return false;
  };

  const nearestPlayer = (maxD) => {
    let best = null;
    let bestD = maxD;
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity) continue;
      if (e.type !== 'player') continue;
      if (e.username === bot.username) continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  const softReact = async (player) => {
    if (!player) return;
    try {
      lastLookAt = player.username || player.id;
      await bot.lookAt(player.position.offset(0, player.height * 0.85, 0), true);
      bot.setControlState('sneak', true);
      await new Promise((r) => setTimeout(r, 280));
      bot.setControlState('sneak', false);
      bot.setControlState('back', true);
      await new Promise((r) => setTimeout(r, 350));
      bot.clearControlStates();
      console.log('[PVP] soft react (tap)', lastLookAt);
    } catch {
      try { bot.clearControlStates(); } catch {}
    }
  };

  bot.on('health', () => {
    try {
      const now = Date.now();
      const hp = bot.health;
      const lost = lastHealth - hp;
      lastHealth = hp;

      if (lost < 0.4) return;
      if (now < cooldownUntil && !target) return;
      if (envDanger()) return;

      const p = nearestPlayer(4.2);
      if (!p) return;

      if (now > hitWindowUntil) recentHits = 0;
      recentHits += 1;
      hitWindowUntil = now + 4000;

      if (recentHits < TAP_HITS_NEED && !target) {
        softReact(p);
        return;
      }

      target = p;
      fightUntil = now + FIGHT_MS;
      bot._dreamPvpActive = true;
      console.log('[PVP] defend', p.username || p.id, 'hits', recentHits);
      bestWeapon().catch(() => {});
    } catch {}
  });

  bot.on('spawn', () => {
    lastHealth = bot.health;
    recentHits = 0;
    stop('spawn');
  });
  bot.on('death', () => {
    recentHits = 0;
    stop('death');
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

      try {
        await bot.lookAt(target.position.offset(0, target.height * 0.85, 0), true);
      } catch {}

      clearMove();

      if (dist > 3.0) {
        bot.setControlState('forward', true);
        if (Math.random() < 0.4) bot.setControlState('sprint', true);
      } else if (dist < 1.6) {
        bot.setControlState('back', true);
      } else {
        if (Date.now() - lastStrafeFlip > 900) {
          strafeDir *= -1;
          lastStrafeFlip = Date.now();
        }
        bot.setControlState(strafeDir > 0 ? 'left' : 'right', true);
        if (Math.random() < 0.35) bot.setControlState('forward', true);
      }

      if (bot.health <= 8) {
        bot.setControlState('back', true);
        bot.setControlState('sprint', true);
        if (bot.health <= 6) {
          stop('lowhp');
          return;
        }
      }

      const now = Date.now();
      if (dist > REACH || now - lastSwing < SWING_MS) return;

      if (bot.entity.onGround && Math.random() < 0.35 && now - lastJump > 800) {
        bot.setControlState('jump', true);
        lastJump = now;
        setTimeout(() => {
          try {
            bot.setControlState('jump', false);
            bot.attack(target);
            lastSwing = Date.now();
          } catch {}
        }, 120);
      } else {
        try {
          bot.attack(target);
          lastSwing = now;
          bot.setControlState('forward', false);
          setTimeout(() => {
            try {
              if (target) bot.setControlState('forward', true);
            } catch {}
          }, 60);
        } catch {}
      }
    } catch (e) {
      console.warn('[PVP] tick', e.message);
    }
  }, 120);

  console.log('[PVP] v5 human defensive — 2 hits to engage, env dmg ignored');
}
