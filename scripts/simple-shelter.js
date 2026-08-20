/**
 * simple-shelter.js — abrigo 3x3 de cobble/dirt SEM schematic
 * Roda só quando chamado e bot não está busy (1 ação).
 */

import { Vec3 } from 'vec3';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findScaffold(bot) {
  return bot.inventory.items().find((i) =>
    /cobblestone|dirt|netherrack|oak_planks|stone$/.test(i.name)
  );
}

/**
 * Coloca um anel simples em volta do bot (paredes baixas).
 * Retorna true se colocou pelo menos 1 bloco.
 */
export async function buildSimpleShelter(bot) {
  if (!bot?.entity) return false;
  const scaffold = findScaffold(bot);
  if (!scaffold || scaffold.count < 8) return false;

  try {
    await bot.equip(scaffold, 'hand');
  } catch {
    return false;
  }

  const origin = bot.entity.position.floored();
  const offsets = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  ];

  let placed = 0;
  for (const [dx, dy, dz] of offsets) {
    if (bot._dreamBusy === false && placed > 0 && placed % 4 === 0) {
      // yield ocasional — ainda dentro da mesma task
    }
    const pos = origin.offset(dx, dy, dz);
    const block = bot.blockAt(pos);
    if (block && block.name !== 'air' && block.name !== 'cave_air') continue;

    // face de referência: bloco abaixo ou ao lado
    const ref = bot.blockAt(pos.offset(0, -1, 0)) || bot.blockAt(origin);
    if (!ref || ref.name === 'air') continue;

    try {
      await bot.placeBlock(ref, new Vec3(dx === 0 && dz === 0 ? 0 : dx, dy === 0 ? 1 : dy, dx === 0 && dz === 0 ? 0 : dz));
      placed++;
      await sleep(200);
    } catch {
      // tenta place na face superior do ref se perto
      try {
        const under = bot.blockAt(pos.offset(0, -1, 0));
        if (under && under.boundingBox === 'block') {
          await bot.placeBlock(under, new Vec3(0, 1, 0));
          placed++;
          await sleep(200);
        }
      } catch {}
    }
    if (placed >= 12) break;
  }

  if (placed > 0) console.log('[SHELTER] placed', placed, 'blocks');
  return placed > 0;
}

export function startSimpleShelter(agent) {
  // só registra helper no bot; pure-survival chama quando noite/fome
  const bot = agent?.bot || agent;
  if (!bot || bot._shelterHelper) return;
  bot._shelterHelper = true;
  bot.dreamBuildShelter = () => buildSimpleShelter(bot);
  console.log('[SHELTER] helper ON (call bot.dreamBuildShelter)');
}
