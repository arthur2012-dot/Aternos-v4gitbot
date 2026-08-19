/**
 * Koneko-inspired survival behaviors + mineflayer-pvp for hostiles.
 * Ideas from: AkagawaTsurunaki/KonekoMinecraftBot + PrismarineJS/mineflayer-pvp
 *
 * - Attack nearby hostiles (not players unless our PvP module engages)
 * - Swim / surface when drowning
 * - Seek water when on fire
 * - Auto-eat via control states when low (mineflayer-auto-eat if present)
 * - Sleep at night if bed nearby
 *
 * Carpet-PvP = Fabric SERVER mod → cannot run inside Railway bot.
 * FancyGamerP/bot = practice dummy → combo ideas already in pvp-combat.
 * mineflayer-bot-builder = visual GUI IDE → not for production deploy.
 */

const HOSTILE = /zombie|skeleton|creeper|spider|enderman|witch|phantom|drowned|husk|stray|pillager|vindicator|ravager|slime|magma|blaze|ghast|piglin|hoglin|wither_skeleton|guardian|shulker|warden/i;

export async function startKonekoBehaviors(agent) {
  const bot = agent.bot;
  if (!bot || bot._dreamKoneko) return;
  bot._dreamKoneko = true;

  // Load mineflayer-pvp if available
  try {
    const pvpMod = await import('mineflayer-pvp');
    const plugin = pvpMod.plugin || pvpMod.default?.plugin || pvpMod.default;
    if (plugin && !bot.pvp) {
      bot.loadPlugin(plugin);
      console.log('[KONEKO] mineflayer-pvp loaded');
    }
  } catch (e) {
    console.warn('[KONEKO] mineflayer-pvp skip', e.message?.slice(0, 40));
  }

  // Armor manager if present
  try {
    const armor = await import('mineflayer-armor-manager');
    const ap = armor.default || armor;
    if (typeof ap === 'function' && !bot.armorManager) {
      bot.loadPlugin(ap);
      console.log('[KONEKO] armor-manager loaded');
    }
  } catch {}

  // Auto-eat if present
  try {
    const ae = await import('mineflayer-auto-eat');
    const plug = ae.plugin || ae.default?.plugin || ae.default;
    if (plug && !bot.autoEat) {
      bot.loadPlugin(plug);
      if (bot.autoEat?.enable) bot.autoEat.enable();
      console.log('[KONEKO] auto-eat loaded');
    }
  } catch {}

  let lastMobAttack = 0;
  let lastFireSeek = 0;
  let lastSleepTry = 0;

  // --- Attack hostiles (Koneko AttackHostilesState) ---
  setInterval(() => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (Date.now() - lastMobAttack < 800) return;

      const mob = bot.nearestEntity(e => {
        if (!e || e === bot.entity) return false;
        if (e.type !== 'mob' && e.type !== 'hostile') {
          // some versions use name
          if (!e.name && !e.displayName) return false;
        }
        const n = String(e.name || e.displayName || '');
        if (!HOSTILE.test(n)) return false;
        if (n === 'Armor Stand') return false;
        const d = e.position.distanceTo(bot.entity.position);
        return d < 14;
      });

      if (!mob) {
        if (bot.pvp?.target && HOSTILE.test(String(bot.pvp.target.name || ''))) {
          try { bot.pvp.stop(); } catch {}
        }
        return;
      }

      lastMobAttack = Date.now();
      // equip sword/axe
      try {
        const w = bot.inventory.items().find(i => /sword|axe/.test(i.name));
        if (w) bot.equip(w, 'hand').catch(() => {});
      } catch {}

      if (bot.pvp?.attack) {
        bot.pvp.attack(mob);
        console.log('[KONEKO] mob fight', mob.name || mob.displayName);
      } else {
        // fallback melee
        bot.lookAt(mob.position.offset(0, mob.height * 0.8, 0), true).catch(() => {});
        if (mob.position.distanceTo(bot.entity.position) < 3.2) {
          bot.attack(mob);
        }
      }
    } catch {}
  }, 400);

  // --- Dive / surface (Koneko DiveState) ---
  setInterval(() => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      const block = bot.blockAt(bot.entity.position);
      const inWater = block && /water/.test(block.name || '');
      if (!inWater) return;
      // surface if oxygen low
      if (bot.oxygenLevel != null && bot.oxygenLevel < 10) {
        bot.setControlState('jump', true); // swim up
        setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 400);
      }
    } catch {}
  }, 600);

  // --- On fire → water (Koneko OnFireState) ---
  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (!bot.entity.onFire && bot.health > 8) return;
      if (Date.now() - lastFireSeek < 5000) return;
      if (!bot.entity.onFire) return;

      lastFireSeek = Date.now();
      console.log('[KONEKO] on fire → water');
      const water = bot.findBlock({
        matching: b => b && /water/.test(b.name || ''),
        maxDistance: 16,
      });
      if (water) {
        try {
          if (typeof bot.dreamGoto === 'function') {
            await bot.dreamGoto(water.position.x, water.position.y, water.position.z, 1);
          } else if (bot.pathfinder) {
            const { goals } = await import('mineflayer-pathfinder');
            await bot.pathfinder.goto(new goals.GoalNear(water.position.x, water.position.y, water.position.z, 1));
          }
        } catch {}
      } else {
        // panic jump
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        setTimeout(() => bot.clearControlStates(), 500);
      }
    } catch {}
  }, 1000);

  // --- Sleep at night (Koneko SleepState) ---
  setInterval(async () => {
    try {
      if (!bot.entity || bot._dreamPvpActive) return;
      if (Date.now() - lastSleepTry < 30000) return;
      const tod = bot.time?.timeOfDay ?? 0;
      if (tod < 12542 || tod > 23460) return; // not night-ish
      if (bot.isSleeping) return;

      const bed = bot.findBlock({
        matching: b => b && /_bed$|^bed$/.test(b.name || ''),
        maxDistance: 20,
      });
      if (!bed) return;

      lastSleepTry = Date.now();
      console.log('[KONEKO] try sleep');
      try {
        if (typeof bot.dreamGoto === 'function') {
          await bot.dreamGoto(bed.position.x, bed.position.y, bed.position.z, 2);
        }
        await bot.sleep(bed);
      } catch (e) {
        console.warn('[KONEKO] sleep fail', (e.message || '').slice(0, 30));
      }
    } catch {}
  }, 8000);

  console.log('[KONEKO] behaviors ON — mob pvp, swim, fire→water, sleep');
}
