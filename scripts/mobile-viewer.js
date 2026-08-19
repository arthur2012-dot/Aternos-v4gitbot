/**
 * FORCE 3D — ultra lean prismarine-viewer for Railway + mobile.
 * viewDistance: 1 | firstPerson | prefix /viewer
 */
import http from 'http';

const VIEWER_PORT = Number(process.env.VIEWER_INTERNAL_PORT) || 3001;

function describeScene(bot) {
  if (!bot?.entity) return 'Aguardando spawn...';
  const pos = bot.entity.position;
  return [
    '=== DreamBot (fallback texto) ===',
    `Pos ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`,
    `HP ${bot.health} Fome ${bot.food}`,
  ].join('\n');
}

function startTextViewer(bot) {
  if (bot._dreamTextViewer) return;
  bot._dreamTextViewer = true;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta http-equiv="refresh" content="2"/><title>DreamBot</title></head><body style="background:#111;color:#eee;font-family:monospace;padding:12px"><pre>${describeScene(bot).replace(/</g,'<')}</pre></body></html>`);
  });
  server.on('error', () => {});
  server.listen(VIEWER_PORT, '127.0.0.1', () => console.log('[VIEWER] fallback texto :' + VIEWER_PORT));
}

export async function startMobileViewer(bot) {
  if (bot._dreamViewerStarted) return;
  bot._dreamViewerStarted = true;

  // Only skip 3D if explicitly disabled
  if (process.env.ENABLE_VIEWER === '0' || process.env.ENABLE_VIEWER === 'false') {
    console.log('[VIEWER] 3D off by ENABLE_VIEWER=0');
    startTextViewer(bot);
    return;
  }

  try {
    await import('canvas');
    const mod = await import('prismarine-viewer');
    const mineflayerViewer = mod.mineflayer || mod.default?.mineflayer;
    if (!mineflayerViewer) throw new Error('mineflayer export missing');

    // MAX OPTIMIZED for free Railway + phone
    mineflayerViewer(bot, {
      port: VIEWER_PORT,
      firstPerson: true,
      viewDistance: 1, // minimum chunks — least RAM/CPU
      prefix: '/viewer',
    });

    console.log('[VIEWER] *** 3D FORCED *** viewDistance=1 prefix=/viewer :' + VIEWER_PORT);
    console.log('[VIEWER] URL: https://aternos-v4gitbot-dream.up.railway.app/viewer/');
    return;
  } catch (e) {
    console.error('[VIEWER] 3D ERROR:', e.message || e);
    startTextViewer(bot);
  }
}

export default { startMobileViewer };
