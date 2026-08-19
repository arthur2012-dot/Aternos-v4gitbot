/**
 * Mobile 3D viewer — prismarine-viewer optimized for Railway single-port.
 * Internal: 127.0.0.1:3001
 * Public:   https://SEU-APP.up.railway.app/viewer  (proxied by mindserver)
 *
 * viewDistance=2, firstPerson=true → less lag on phone + free tier.
 */

const VIEWER_PORT = Number(process.env.VIEWER_INTERNAL_PORT) || 3001;

export async function startMobileViewer(bot) {
  if (bot._dreamViewerStarted) return;
  bot._dreamViewerStarted = true;

  // Default ON for mobile request; set ENABLE_VIEWER=0 to disable
  if (process.env.ENABLE_VIEWER === '0' || process.env.ENABLE_VIEWER === 'false') {
    console.log('[VIEWER] disabled (ENABLE_VIEWER=0)');
    return;
  }

  try {
    const mod = await import('prismarine-viewer');
    const mineflayerViewer = mod.mineflayer || mod.default?.mineflayer;
    if (!mineflayerViewer) {
      console.warn('[VIEWER] prismarine-viewer API missing');
      return;
    }

    mineflayerViewer(bot, {
      port: VIEWER_PORT,
      firstPerson: true,
      viewDistance: 2, // super lean for phone + Railway RAM
    });

    console.log('[VIEWER] 3D ON internal :' + VIEWER_PORT + ' → public /viewer');
    console.log('[VIEWER] Abra no celular: https://SEU-DOMINIO.up.railway.app/viewer');
  } catch (e) {
    console.warn('[VIEWER] falhou (bot segue sem 3D):', (e.message || '').slice(0, 80));
    bot._dreamViewerStarted = false;
  }
}

export default { startMobileViewer };
