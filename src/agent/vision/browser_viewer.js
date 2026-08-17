// DreamBot: stub — prismarine-viewer disabled on Railway (no canvas/GPU)
import settings from '../../settings.js';

export function addBrowserViewer(bot, count_id) {
  if (settings.render_bot_view || settings.show_bot_views) {
    console.log('[DreamBot] Bot view requested but viewer is disabled in this deploy.');
  }
}
export function addViewer(bot, count_id) {
  return addBrowserViewer(bot, count_id);
}
export default { addBrowserViewer, addViewer };
