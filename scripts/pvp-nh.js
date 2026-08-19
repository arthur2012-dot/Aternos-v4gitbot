/**
 * DreamBot PvP — inspired by OSRS NH RL principles (Naton1/osrs-pvp-reinforcement-learning)
 *
 * Transferable ideas from NhEnv (NOT a full PPO model — scripted policy on mineflayer):
 * - Distance bands: melee / mid / far (like melee vs farcast)
 * - Eat when HP low (food / brew priority)
 * - Movement: close-in, under/strafe, kite away when losing
 * - Attack only in melee band; chase when winning; disengage when dying
 * - Only fight players who attacked us first (defensive)
 *
 * Call: startPvpNh(agent) once after bot spawn.
 */

export function startPvpNh(agent) {
  const bot = agent.bot;
  if (!bot || agent._pvpNhStarted) return;
  agent._pvpNhStarted = true;

  let targetId = null;
  let engageUntil = 0;
  let lastHealth = bot.health;
  let strafeDir = 1;
  let lastStrafeSwitch = 0;
  let lastAttack = 0;
  let lastEat = 0;

  const MELEE = 3.0;
  const CLOSE = 1.4;
  const FAR = 8.0;
  const ENGAGE_MS = 18000;

  function log(...a) {
    console.log('[DreamBot][PvP]', ...a);
  }

  function findEntity(id) {
    if (id == null) return null;
    return bot.entities[id] || null;
  }

  function nearestHostilePlayer(maxDist = 10) {
    let best = null;
    let bestD = maxDist;
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity) continue;
      if (e.type !== 'player' && e.username == null) continue;
      if (e.username && e.username === bot.username) continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function equipBestWeapon() {
    try {
      const items = bot.inventory.items();
      const order = [
        /netherite_sword/,
        /diamond_sword/,
        /iron_sword/,
        /stone_sword/,
        /golden_sword/,
        /wooden_sword/,
        /netherite_axe/,
        /diamond_axe/,
        /iron_axe/,
        /sword/,
        /axe/,
      ];
      for (const re of order) {
        const it = items.find((i) => re.test(i.name));
        if (it) {
          bot.equip(it, 'hand').catch(() => {});
          return it.name;
        }
      }
    } catch {}
    return null;
  }

  function bestFood() {
    try {
      return bot.inventory.items().find((i) =>
        /golden_apple|enchanted_golden_apple|cooked_|bread|baked_potato|carrot|apple|beef|pork|chicken|mutton|rabbit|cod|salmon|pie|stew/.test(
          i.name
        )
      );
    } catch {
      return null;
    }
  }

  async function tryEat() {
    if (Date.now() - lastEat < 1600) return false;
    if (bot.food >= 18 && bot.health >= 14) return false;
    const food = bestFood();
    if (!food) return false;
    try {
      lastEat = Date.now();
      await bot.equip(food, 'hand');
      await bot.consume();
      log('eat', food.name, 'hp', bot.health, 'food', bot.food);
      equipBestWeapon();
      return true;
    } catch {
      equipBestWeapon();
      return false;
    }
  }

  function setEngage(entity, ms = ENGAGE_MS) {
    if (!entity) return;
    targetId = entity.id;
    engageUntil = Date.now() + ms;
    log('engage', entity.username || entity.name || entity.id);
  }

  // Took damage → lock nearest player as attacker (defensive only)
  bot.on('health', () => {
    try {
      if (bot.health < lastHealth - 0.2) {
        const p = nearestHostilePlayer(10);
        if (p) setEngage(p, ENGAGE_MS);
      }
      lastHealth = bot.health;
    } catch {}
  });

  // Someone swings near us while we're low — stay alert
  bot.on('entitySwingArm', (entity) => {
    try {
      if (!entity || entity === bot.entity) return;
      if (entity.type !== 'player' && !entity.username) return;
      const d = entity.position.distanceTo(bot.entity.position);
      if (d <= 4.5) setEngage(entity, ENGAGE_MS);
    } catch {}
  });

  // Main combat tick (~8 Hz) — NH-style distance policy
  setInterval(async () => {
    try {
      if (!bot.entity) return;
      if (Date.now() > engageUntil) {
        targetId = null;
        return;
      }
      let target = findEntity(targetId);
      if (!target || !target.isValid) {
        target = nearestHostilePlayer(8);
        if (target) targetId = target.id;
        else {
          targetId = null;
          return;
        }
      }

      // Pause passive survival while in PvP
      agent._dreamLockUntil = Math.max(agent._dreamLockUntil || 0, Date.now() + 1200);
      agent._navBusy = false;

      const dist = target.position.distanceTo(bot.entity.position);
      const hp = bot.health;
      const hpPct = hp / 20;

      // --- Food priority (OSRS: eat when low) ---
      if (hpPct < 0.55 || (hpPct < 0.75 && bot.food < 16)) {
        await tryEat();
      }

      // --- Losing hard: kite (farcast analogue) ---
      if (hpPct < 0.3 && dist < 5) {
        try {
          const yawAway =
            Math.atan2(
              bot.entity.position.x - target.position.x,
              bot.entity.position.z - target.position.z
            );
          await bot.look(yawAway, 0);
          bot.setControlState('sprint', true);
          bot.setControlState('forward', true);
          bot.setControlState('jump', true);
          setTimeout(() => {
            try {
              bot.setControlState('jump', false);
              bot.setControlState('forward', false);
            } catch {}
          }, 280);
          log('kite hp', hp.toFixed(1));
          return;
        } catch {}
      }

      equipBestWeapon();

      // Look at target
      try {
        await bot.lookAt(target.position.offset(0, target.height * 0.85, 0), true);
      } catch {}

      // --- Distance bands (NhEnv movement ideas) ---
      if (dist > FAR) {
        // too far: drop engage slowly
        return;
      }

      if (dist > MELEE) {
        // close in (move_next_to_target)
        bot.setControlState('sprint', true);
        bot.setControlState('forward', true);
        bot.setControlState('jump', dist > 4);
        setTimeout(() => {
          try {
            bot.setControlState('jump', false);
          } catch {}
        }, 200);
        return;
      }

      if (dist < CLOSE) {
        // too stacked: step back (space)
        bot.setControlState('back', true);
        bot.setControlState('sprint', false);
        setTimeout(() => {
          try {
            bot.setControlState('back', false);
          } catch {}
        }, 180);
      } else {
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
      }

      // Strafe (move_diagonal / under-target style lateral movement)
      if (Date.now() - lastStrafeSwitch > 700) {
        strafeDir *= -1;
        lastStrafeSwitch = Date.now();
      }
      bot.setControlState('left', strafeDir === 1);
      bot.setControlState('right', strafeDir === -1);
      bot.setControlState('sprint', true);

      // Crit jump occasionally when in melee
      if (dist <= MELEE && Date.now() - lastAttack > 550) {
        try {
          bot.setControlState('jump', true);
          setTimeout(() => {
            try {
              bot.setControlState('jump', false);
              bot.attack(target);
              lastAttack = Date.now();
            } catch {}
          }, 120);
        } catch {
          try {
            bot.attack(target);
            lastAttack = Date.now();
          } catch {}
        }
      } else if (dist <= MELEE && Date.now() - lastAttack > 400) {
        try {
          bot.attack(target);
          lastAttack = Date.now();
        } catch {}
      }

      // Extend engage while still close
      if (dist <= FAR) engageUntil = Math.max(engageUntil, Date.now() + 4000);
    } catch (e) {
      // ignore combat tick errors
    }
  }, 120);

  // Clear movement keys when leaving combat
  setInterval(() => {
    try {
      if (Date.now() <= engageUntil) return;
      if (targetId == null) return;
      targetId = null;
      for (const c of ['left', 'right', 'forward', 'back', 'jump', 'sprint']) {
        try {
          bot.setControlState(c, false);
        } catch {}
      }
      log('disengage');
    } catch {}
  }, 500);

  log('NH-style controller online (defensive only)');
}
