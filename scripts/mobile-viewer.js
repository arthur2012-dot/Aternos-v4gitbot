/**
 * Default: lightweight TEXT live view on :3001 → /viewer (stable on Railway).
 * Optional 3D: set ENABLE_VIEWER=1 (may OOM / SIGTERM on free tier).
 */
import http from 'http';

const VIEWER_PORT = Number(process.env.VIEWER_INTERNAL_PORT) || 3001;

function describeScene(bot) {
  if (!bot?.entity) return 'Aguardando spawn do bot...';
  const pos = bot.entity.position;
  const lines = [];
  lines.push('=== VISÃO DO DREAMBOT ===');
  lines.push(`Posição: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
  lines.push(`Vida: ${bot.health}/20   Fome: ${bot.food}/20`);
  lines.push(`Dimensão: ${bot.game?.dimension || '?'}`);
  lines.push(`Hora do jogo: ${bot.time?.timeOfDay ?? '?'}`);
  try {
    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let mira = 'ar';
    for (let t = 1; t <= 6; t++) {
      const b = bot.blockAt(pos.offset(dx * t, 1.6, dz * t));
      if (b && b.boundingBox === 'block') {
        mira = `${b.name} (a ${t} blocos)`;
        break;
      }
    }
    lines.push(`Olhando para: ${mira}`);
    const chao = bot.blockAt(pos.offset(0, -1, 0));
    lines.push(`Chão: ${chao?.name || '?'}`);
  } catch {}
  try {
    const ents = [];
    for (const e of Object.values(bot.entities || {})) {
      if (!e || e === bot.entity) continue;
      const d = e.position.distanceTo(pos);
      if (d > 20) continue;
      ents.push(`${e.username || e.name || e.type || 'ent'} ${d.toFixed(1)}m`);
      if (ents.length >= 8) break;
    }
    lines.push(ents.length ? `Perto: ${ents.join(', ')}` : 'Perto: ninguém');
  } catch {}
  try {
    const inv = bot.inventory.items().slice(0, 15).map(i => `${i.name} x${i.count}`);
    lines.push(`Inventário: ${inv.join(', ') || 'vazio'}`);
  } catch {}
  lines.push('');
  lines.push('Atualiza a cada 2s · visão em texto (3D desligado = estável)');
  return lines.join('\n');
}

function startTextViewer(bot) {
  if (bot._dreamTextViewer) return;
  bot._dreamTextViewer = true;

  const server = http.createServer((req, res) => {
    // answer any path so proxy /viewer and /viewer/ both work
    const body = describeScene(bot);
    const html = `<!DOCTYPE html>
<html lang="pt"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<meta http-equiv="refresh" content="2"/>
<title>Visão DreamBot</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;padding:16px}
  h1{font-size:1.2rem;color:#58a6ff;margin:0 0 8px}
  pre{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.5}
  a{color:#3fb950}
  .hint{color:#8b949e;font-size:12px;margin-top:10px}
</style></head><body>
<h1>👁 Visão do DreamBot</h1>
<p><a href="/">← Painel Mindcraft</a></p>
<pre>${body.replace(/&/g,'&').replace(/</g,'<')}</pre>
<p class="hint">Se a vida estiver baixa, o modo passivo tenta achar comida sozinho.</p>
</body></html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  });

  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') console.warn('[VIEWER]', e.message);
  });

  server.listen(VIEWER_PORT, '127.0.0.1', () => {
    console.log('[VIEWER] texto ao vivo em :' + VIEWER_PORT + ' → abra /viewer/ no celular');
  });
}

export async function startMobileViewer(bot) {
  if (bot._dreamViewerStarted) return;
  bot._dreamViewerStarted = true;

  // 3D only if user explicitly enables (often kills free Railway)
  if (process.env.ENABLE_VIEWER === '1' || process.env.ENABLE_VIEWER === 'true') {
    try {
      await import('canvas');
      const mod = await import('prismarine-viewer');
      const mineflayerViewer = mod.mineflayer || mod.default?.mineflayer;
      if (mineflayerViewer) {
        mineflayerViewer(bot, {
          port: VIEWER_PORT,
          firstPerson: true,
          viewDistance: 2,
          prefix: '/viewer',
        });
        console.log('[VIEWER] 3D ON (ENABLE_VIEWER=1) — se o container cair, tire essa var');
        return;
      }
    } catch (e) {
      console.warn('[VIEWER] 3D falhou, texto:', (e.message || '').slice(0, 60));
    }
  }

  startTextViewer(bot);
}

export default { startMobileViewer };
