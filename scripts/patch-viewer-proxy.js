/**
 * Proxy /viewer → 127.0.0.1:3001 (prismarine-viewer with prefix /viewer)
 * Keeps path /viewer so socket.io is /viewer/socket.io (not MindServer /socket.io)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const file = join(ROOT, 'src', 'mindcraft', 'mindserver.js');
const base = join(ROOT, '.mindcraft-base', 'src', 'mindcraft', 'mindserver.js');
const publicDir = join(ROOT, 'src', 'mindcraft', 'public');

function restoreFromBase() {
  if (!existsSync(base)) return false;
  mkdirSync(join(ROOT, 'src', 'mindcraft'), { recursive: true });
  copyFileSync(base, file);
  console.log('[viewer-proxy] restored mindserver from base');
  return true;
}

if (!existsSync(file) && !restoreFromBase()) process.exit(0);

let src = readFileSync(file, 'utf8');

// Broken / old patch → restore
if (
  (src.includes('DREAMBOT_VIEWER_PROXY') && !src.includes('DREAMBOT_VIEWER_PROXY_V2')) ||
  !src.includes('createMindServer') ||
  src.split('(').length !== src.split(')').length
) {
  console.warn('[viewer-proxy] restore for clean V2 patch');
  restoreFromBase();
  src = readFileSync(file, 'utf8');
}

// 0.0.0.0 bind
if (/const host = ['"]localhost['"]/.test(src)) {
  src = src.replace(
    /const host = ['"]localhost['"];/g,
    "const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';"
  );
}

if (!src.includes('DREAMBOT_VIEWER_PROXY_V2')) {
  // Remove old inject fragments if any
  src = src.replace(/\n\s*\/\/ DREAMBOT_VIEWER_PROXY[\s\S]*?console\.warn\('\[DreamBot\] viewer proxy skip'[\s\S]*?\}\s*\}\s*\n/g, '\n');

  const proxyBlock = `
    // DREAMBOT_VIEWER_PROXY_V2
    try {
        import('http-proxy-middleware').then(function (mod) {
            var createProxyMiddleware = mod.createProxyMiddleware;
            if (!createProxyMiddleware) return;
            var viewerTarget = 'http://127.0.0.1:' + (process.env.VIEWER_INTERNAL_PORT || 3001);
            // Keep /viewer path (viewer uses prefix: '/viewer')
            var _vp = createProxyMiddleware({
                target: viewerTarget,
                changeOrigin: true,
                ws: true,
                xfwd: true,
                logLevel: 'warn'
            });
            app.use('/viewer', _vp);
            // Also proxy socket path if client requests it under /viewer
            console.log('[DreamBot] /viewer proxy V2 → ' + viewerTarget);
            if (typeof server !== 'undefined' && server && server.on) {
                server.on('upgrade', function (req, socket, head) {
                    try {
                        if (req.url && req.url.indexOf('/viewer') === 0) {
                            _vp.upgrade(req, socket, head);
                        }
                    } catch (e) {}
                });
            }
        }).catch(function (e) {
            console.warn('[DreamBot] viewer proxy', e && e.message);
        });
        app.get('/see', function (req, res) { res.redirect(302, '/viewer/'); });
    } catch (e) {
        console.warn('[DreamBot] viewer proxy', e && e.message);
    }
`;

  if (src.includes('express.static')) {
    src = src.replace(
      /app\.use\(\s*express\.static\([^\n]+\)\s*\);?/,
      (m) => m.replace(/;?\s*$/, ';') + '\n' + proxyBlock
    );
  } else {
    console.warn('[viewer-proxy] no static inject point');
  }

  writeFileSync(file, src);
  console.log('[viewer-proxy] V2 injected');
} else {
  writeFileSync(file, src);
  console.log('[viewer-proxy] V2 already present');
}

try {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    join(publicDir, 'mobile-view.html'),
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=/viewer/"></head><body>Abrindo visao...</body></html>'
  );
} catch {}
