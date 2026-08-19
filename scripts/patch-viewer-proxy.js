/**
 * V4: do NOT mount at /viewer (that strips the path → Cannot GET /).
 * Use pathFilter so full /viewer/... reaches prismarine-viewer (prefix /viewer).
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
  console.log('[viewer-proxy] restored mindserver');
  return true;
}

if (!existsSync(file) && !restoreFromBase()) process.exit(0);

let src = readFileSync(file, 'utf8');

if (
  (src.includes('DREAMBOT_VIEWER_PROXY') && !src.includes('DREAMBOT_VIEWER_PROXY_V4')) ||
  !src.includes('createMindServer') ||
  src.split('(').length !== src.split(')').length
) {
  restoreFromBase();
  src = readFileSync(file, 'utf8');
}

if (/const host = ['"]localhost['"]/.test(src)) {
  src = src.replace(
    /const host = ['"]localhost['"];/g,
    "const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';"
  );
}

if (!src.includes('DREAMBOT_VIEWER_PROXY_V4')) {
  // strip any old proxy injects
  src = src.replace(/\n\s*\/\/ DREAMBOT_VIEWER_PROXY[\s\S]*?viewer proxy[\s\S]*?\n/g, '\n');

  const proxyBlock = `
    // DREAMBOT_VIEWER_PROXY_V4
    try {
        import('http-proxy-middleware').then(function (mod) {
            var createProxyMiddleware = mod.createProxyMiddleware;
            if (!createProxyMiddleware) return;
            var viewerTarget = 'http://127.0.0.1:' + (process.env.VIEWER_INTERNAL_PORT || 3001);
            var _vp = createProxyMiddleware({
                target: viewerTarget,
                changeOrigin: true,
                ws: true,
                xfwd: true,
                pathFilter: function (pathname) {
                    return pathname === '/viewer' || pathname.indexOf('/viewer/') === 0;
                }
            });
            app.use(_vp);
            console.log('[DreamBot] /viewer proxy V4 (pathFilter) → ' + viewerTarget);
            setTimeout(function () {
                try {
                    if (typeof server !== 'undefined' && server && server.on) {
                        server.on('upgrade', function (req, socket, head) {
                            try {
                                var u = String(req.url || '');
                                if (u.indexOf('/viewer') === 0) _vp.upgrade(req, socket, head);
                            } catch (e) {}
                        });
                        console.log('[DreamBot] /viewer WS V4 hooked');
                    }
                } catch (e) {}
            }, 800);
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
  }

  writeFileSync(file, src);
  console.log('[viewer-proxy] V4 injected');
} else {
  writeFileSync(file, src);
  console.log('[viewer-proxy] V4 already present');
}

try {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    join(publicDir, 'mobile-view.html'),
    '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/viewer/"></head><body>Abrindo visao 3D...</body></html>'
  );
} catch {}
