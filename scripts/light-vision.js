/**
 * LIGHT VISION — Mindcraft-compatible, zero WebGL / prismarine-viewer.
 *
 * Instead of screenshots (heavy, crashes Railway), builds a rich TEXT scene
 * from mineflayer world data and feeds that to the LLM as "what I see".
 *
 * API mirrors Mindcraft vision_interpreter so agent code keeps working:
 *   lookAtPlayer, lookAtPosition, getCenterBlockInfo, analyzeImage
 */

function blockName(b) {
  if (!b) return 'air';
  return b.name || 'unknown';
}

function isSolid(b) {
  return b && b.boundingBox === 'block';
}

/** Sample blocks in a cone / grid in front of the bot */
function sampleView(bot, range = 6) {
  const lines = [];
  try {
    const pos = bot.entity.position;
    const yaw = bot.entity.yaw;
    const pitch = bot.entity.pitch || 0;
    const dx = -Math.sin(yaw) * Math.cos(pitch);
    const dz = -Math.cos(yaw) * Math.cos(pitch);
    const dy = -Math.sin(pitch);

    // center ray
    const hits = [];
    for (let t = 1; t <= range; t++) {
      const p = pos.offset(dx * t, dy * t + 1.6, dz * t);
      const b = bot.blockAt(p);
      if (isSolid(b)) {
        hits.push(`${blockName(b)} @ ${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)} (dist ${t})`);
        break;
      }
    }
    if (hits.length) lines.push('Frente (mira): ' + hits[0]);
    else lines.push('Frente (mira): ar / sem bloco solido perto');

    // feet / ground
    const under = bot.blockAt(pos.offset(0, -1, 0));
    lines.push('Chao: ' + blockName(under));

    // left / right / up
    const left = bot.blockAt(pos.offset(-Math.cos(yaw) * 2, 0, Math.sin(yaw) * 2));
    const right = bot.blockAt(pos.offset(Math.cos(yaw) * 2, 0, -Math.sin(yaw) * 2));
    const head = bot.blockAt(pos.offset(0, 1, 0));
    const above = bot.blockAt(pos.offset(0, 2, 0));
    lines.push(`Esquerda~: ${blockName(left)} | Direita~: ${blockName(right)}`);
    lines.push(`Cabeca: ${blockName(head)} | Acima: ${blockName(above)}`);

    // nearby interesting blocks
    const interesting = [];
    const names = [
      'oak_log', 'birch_log', 'spruce_log', 'crafting_table', 'furnace',
      'coal_ore', 'iron_ore', 'diamond_ore', 'deepslate_diamond_ore',
      'water', 'lava', 'chest', 'torch',
    ];
    for (const name of names) {
      try {
        const found = bot.findBlocks({ matching: bot.registry?.blocksByName?.[name]?.id ?? (() => false), maxDistance: 12, count: 1 });
        // fallback findBlock
      } catch {}
    }
    const nearby = bot.findBlocks({
      matching: (b) => b && (/_log$|_ore$|crafting_table|furnace|water|lava|chest/.test(b.name || '')),
      maxDistance: 10,
      count: 8,
    });
    if (nearby?.length) {
      for (const p of nearby.slice(0, 6)) {
        const b = bot.blockAt(p);
        if (b) interesting.push(`${b.name} (${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)})`);
      }
    }
    if (interesting.length) lines.push('Perto: ' + interesting.join(', '));
  } catch (e) {
    lines.push('(erro scan: ' + (e.message || '').slice(0, 40) + ')');
  }
  return lines;
}

function sampleEntities(bot) {
  const out = [];
  try {
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity) continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d > 16) continue;
      const label = e.username || e.name || e.displayName || e.type || 'entity';
      out.push(`${label} a ${d.toFixed(1)}m`);
      if (out.length >= 8) break;
    }
  } catch {}
  return out;
}

function inventorySummary(bot) {
  try {
    const items = bot.inventory.items();
    if (!items.length) return 'inventario vazio';
    return items
      .slice(0, 12)
      .map(i => `${i.name}x${i.count}`)
      .join(', ');
  } catch {
    return '?';
  }
}

export function describeScene(bot) {
  if (!bot?.entity) return 'Sem entidade do bot.';
  const pos = bot.entity.position;
  const lines = [
    `Posicao: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`,
    `Vida: ${bot.health?.toFixed?.(0) ?? bot.health} | Fome: ${bot.food ?? '?'} | Dim: ${bot.game?.dimension || 'overworld'}`,
    `Hora: ${bot.time?.timeOfDay ?? '?'}`,
  ];
  lines.push(...sampleView(bot));
  const ents = sampleEntities(bot);
  if (ents.length) lines.push('Entidades: ' + ents.join('; '));
  else lines.push('Entidades: nenhuma perto');
  lines.push('Inventario: ' + inventorySummary(bot));
  return lines.join('\n');
}

export class Camera {
  constructor(bot, fp) {
    this.bot = bot;
    this.fp = fp;
    this.disabled = false;
    this.mode = 'light-text';
    setImmediate(() => {
      try { this.emit?.('ready'); } catch {}
    });
  }
  on() {}
  once() {}
  emit() {}
  async capture() {
    // No image — return null; interpreter uses describeScene
    return null;
  }
}

export class VisionInterpreter {
  constructor(agent) {
    this.agent = agent;
    this.allow_vision = true;
    this.camera = agent?.bot ? new Camera(agent.bot) : null;
    console.log('[VISION] LIGHT mode ON (text scene, no WebGL)');
  }

  getCenterBlockInfo() {
    try {
      const bot = this.agent.bot;
      const b = bot.blockAtCursor?.(5) || null;
      if (!b) return 'Nenhum bloco na mira.';
      return `Bloco na mira: ${b.name} em ${b.position.x},${b.position.y},${b.position.z}`;
    } catch {
      return 'Nenhum bloco na mira.';
    }
  }

  async lookAtPlayer(playerName, direction) {
    const bot = this.agent.bot;
    try {
      const p = bot.players?.[playerName];
      if (p?.entity) {
        await bot.lookAt(p.entity.position.offset(0, p.entity.height * 0.9, 0), true);
      }
    } catch {}
    return this.analyzeScene(`Olhando para jogador ${playerName || '?'}`);
  }

  async lookAtPosition(x, y, z) {
    const bot = this.agent.bot;
    try {
      const Vec3 = (await import('vec3')).default || (await import('vec3')).Vec3;
      await bot.lookAt(new Vec3(Number(x), Number(y), Number(z)), true);
    } catch {}
    return this.analyzeScene(`Olhando para ${x},${y},${z}`);
  }

  async analyzeImage() {
    return this.analyzeScene('Analise visual');
  }

  async analyzeScene(prefix = '') {
    const bot = this.agent.bot;
    const scene = describeScene(bot);
    const center = this.getCenterBlockInfo();
    const text = [prefix, center, scene].filter(Boolean).join('\n');
    console.log('[VISION] scene\n' + text.slice(0, 200));
    return text;
  }
}

export function addBrowserViewer() {
  // Optional: only if ENABLE_VIEWER=1 and package exists (can lag Railway)
  if (process.env.ENABLE_VIEWER !== '1') {
    console.log('[VISION] browser viewer OFF (set ENABLE_VIEWER=1 to try)');
    return;
  }
  console.warn('[VISION] ENABLE_VIEWER set — may use CPU; prefer light text vision');
}

export function addViewer(bot, count_id) {
  addBrowserViewer(bot, count_id);
}

export default { VisionInterpreter, Camera, addBrowserViewer, addViewer, describeScene };
