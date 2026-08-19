/**
 * Thin wrappers only for RESOURCE dig (wood/ore).
 * Path dig/place is owned by pathfinder + ashfinder — do not fight them.
 */
export async function digBlock(bot, block) {
  if (!bot?.entity || !block) return false;
  if (/bedrock|barrier|command|end_portal|reinforced/.test(block.name || '')) return false;
  try {
    const items = bot.inventory.items();
    const n = block.name || '';
    let tool = null;
    if (/_log$|planks|leaves/.test(n)) tool = items.find(i => /_axe$/.test(i.name));
    else if (/dirt|sand|gravel|grass/.test(n)) tool = items.find(i => /_shovel$/.test(i.name));
    else tool = items.find(i => /_pickaxe$/.test(i.name));
    if (tool) {
      try { await bot.equip(tool, 'hand'); } catch {}
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await Promise.race([
      bot.dig(block),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    return true;
  } catch {
    try { bot.stopDigging(); } catch {}
    return false;
  }
}

/** Prefer pathfinder/ash for place — only equip scaffolding helper */
export async function placeAt() {
  return false; // intentionally disabled — use pathfinder Movements / ashfinder
}
export async function placeUnderFeet() { return false; }
export async function placeFront() { return false; }
export async function digFrontWall() { return false; }
export function scaffoldItem() { return null; }
