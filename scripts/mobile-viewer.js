/**
 * Mobile view:
 * - Tries real 3D (prismarine-viewer) when canvas is installed (Dockerfile)
 * - Falls back to live TEXT view (always works on phone via /viewer)
 */
import http from 'http';

const VIEWER_PORT = Number(process.env.VIEWER_INTERNAL_PORT) || 3001;

function blockName(b) {
  if (!b) return 'ar';
  return b.name || '?';
}

function describeScene(bot) {
  if (!bot?.entity) return 'Bot ainda nao spawnou...';
  const pos = bot.entity.position;
  const lines = [];
  lines.push('=== DreamBot VIEW ===');
  lines.push(`Pos: ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`);
  lines.push(`HP: ${bot.health}  Fome: ${bot.food}  Dim: ${bot.game?.dimension || '?'}`);
  lines.push(`Hora: ${bot.time?.timeOfDay ?? '?'}`);
  try {
    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (let t = 1; t <= 5; t++) {
      const p = pos.offset(dx * t, 1.6, dz * t);
      const b = bot.blockAt(p);
      if (b && b.boundingBox === 'block') {
        lines.push(`Mira: ${b.name} (dist ${t})`);
        break;
      }
    }
    lines.push(`Chao: ${blockName(bot.blockAt(pos.offset(0, -1, 0)))}`);
  } catch {}
  try {
    const ents = [];
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity) continue;
      const d = e.position.distanceTo(pos);
      if (d > 16) continue;
      ents.push(`${e.username || e.name || e.type} ${d.toFixed(1)}m`);
      if (ents.length >= 8) break;
    }
    lines.push(ents.length ? 'Perto: ' + ents.join(', ') : 'Perto: ninguem');
  } catch {}
  try {
    const inv = bot.inventory.items().slice(0, 12).map(i => `${i.name}x${i.count}`);
    lines.push('Inv: ' + (inv.join(', ') || 'vazio'));
  } catch {}
  lines.push('');
  lines.push('(texto ao vivo — 3D se canvas OK)');
  return lines.join('\n');
}

function startTextViewer(bot) {
  if (bot._dreamTextViewer) return;
  bot._dreamTextViewer = true;

  const server = http.createServer((req, res) => {
    const body = describeScene(bot);
    const html = `<!DOCTYPE html>
<html lang="pt"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="2"/>
<title>DreamBot View</title>
<style>
body{margin:0;background:#0d1117;color:#c9d1d9;font-family:monospace;padding:12px;font-size:13px}
h1{font-size:16px;color:#58a6ff}
pre{background:#161b22;padding:12px;border-radius:8px;white-space:pre-wrap}
a{color:#3fb950}
</style></head><body>
<h1>DreamBot — visao</h1>
<p><a href="/">Painel</a></p>
<pre>${body.replace(/</g,'<')}</pre>
</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') console.warn('[VIEWER] text', e.message);
  });
  server.listen(VIEWER_PORT, '127.0.0.1', () => {
    console.log('[VIEWER] TEXT → /viewer');
  });
}

export async function startMobileViewer(bot) {
  if (bot._dreamViewerStarted) return;
  bot._dreamViewerStarted = true;

  if (process.env.ENABLE_VIEWER === '0' || process.env.ENABLE_VIEWER === 'false') {
    console.log('[VIEWER] 3D forced off');
    startTextViewer(bot);
    return;
  }

  // Try real 3D first (Dockerfile installs canvas + cairo)
  try {
    await import('canvas');
    const mod = await import('prismarine-viewer');
    const mineflayerViewer = mod.mineflayer || mod.default?.mineflayer;
    if (!mineflayerViewer) throw new Error('no mineflayer viewer export');

    mineflayerViewer(bot, {
      port: VIEWER_PORT,
      firstPerson: true,
      viewDistance: 2,
    });
    console.log('[VIEWER] *** 3D ON *** abra /viewer no celular');
    return;
  } catch (e) {
    console.warn('[VIEWER] 3D indisponivel:', (e.message || '').slice(0, 70));
    console.warn('[VIEWER] usando texto ao vivo');
  }

  startTextViewer(bot);
}

export default { startMobileViewer };
