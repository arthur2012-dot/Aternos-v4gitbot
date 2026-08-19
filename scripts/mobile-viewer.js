/**
 * Mobile 3D viewer — prefix /viewer so Socket.IO works on same Railway domain.
 */
import http from 'http';

const VIEWER_PORT = Number(process.env.VIEWER_INTERNAL_PORT) || 3001;

function describeScene(bot) {
  if (!bot?.entity) return 'Bot ainda nao spawnou...';
  const pos = bot.entity.position;
  const lines = [
    '=== DreamBot VIEW (texto) ===',
    `Pos: ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`,
    `HP: ${bot.health}  Fome: ${bot.food}`,
  ];
  try {
    const inv = bot.inventory.items().slice(0, 10).map(i => `${i.name}x${i.count}`);
    lines.push('Inv: ' + (inv.join(', ') || 'vazio'));
  } catch {}
  return lines.join('\n');
}

function startTextViewer(bot) {
  if (bot._dreamTextViewer) return;
  bot._dreamTextViewer = true;
  const server = http.createServer((req, res) => {
    const body = describeScene(bot);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta http-equiv="refresh" content="2"/><title>DreamBot</title>
<style>body{margin:0;background:#111;color:#ddd;font-family:monospace;padding:12px}a{color:#6f6}</style></head>
<body><h1>DreamBot</h1><p><a href="/">Painel</a></p><pre>${body.replace(/</g,'<')}</pre></body></html>`);
  });
  server.on('error', () => {});
  server.listen(VIEWER_PORT, '127.0.0.1', () => console.log('[VIEWER] TEXT on :' + VIEWER_PORT));
}

export async function startMobileViewer(bot) {
  if (bot._dreamViewerStarted) return;
  bot._dreamViewerStarted = true;

  if (process.env.ENABLE_VIEWER === '0' || process.env.ENABLE_VIEWER === 'false') {
    startTextViewer(bot);
    return;
  }

  try {
    await import('canvas');
    const mod = await import('prismarine-viewer');
    const mineflayerViewer = mod.mineflayer || mod.default?.mineflayer;
    if (!mineflayerViewer) throw new Error('no mineflayer export');

    // prefix /viewer → assets + socket.io em /viewer/socket.io (proxy Railway)
    mineflayerViewer(bot, {
      port: VIEWER_PORT,
      firstPerson: true,
      viewDistance: 2,
      prefix: '/viewer',
    });
    console.log('[VIEWER] *** 3D ON *** prefix=/viewer port=' + VIEWER_PORT);
    console.log('[VIEWER] celular: https://aternos-v4gitbot-dream.up.railway.app/viewer/');
    return;
  } catch (e) {
    console.warn('[VIEWER] 3D fail:', (e.message || '').slice(0, 80));
  }
  startTextViewer(bot);
}

export default { startMobileViewer };
