/**
 * Proxy /viewer → 127.0.0.1:3001
 * Express strips mount path; we put /viewer back (viewer uses prefix:'/viewer').
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

if (
  src.includes('DREAMBOT_VIEWER_PROXY') && !src.includes('DREAMBOT_VIEWER_PROXY_V3') ||
  !src.includes('createMindServer') ||
  src.split('(').length !== src.split(')').length
) {
  console.warn('[viewer-proxy] restore for V3');
  restoreFromBase();
  src = readFileSync(file, 'utf8');
}

if (/const host = ['"]localhost['"]/.test(src)) {
  src = src.replace(
    /const host = ['"]localhost['"];/g,
    "const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';"
  );
}

if (!src.includes('DREAMBOT_VIEWER_PROXY_V3')) {
  src = src.replace(/\n\s*\/\/ DREAMBOT_VIEWER_PROXY[\s\S]*?viewer proxy[\s\S]*?\}\s*\n/g, '\n');

  const proxyBlock = `
    // DREAMBOT_VIEWER_PROXY_V3
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
                // express.use('/viewer') strips prefix → put it back for prismarine prefix
                pathRewrite: function (path) {
                    if (!path || path === '/') return '/viewer/';
                    if (path.indexOf('/viewer') === 0) return path;
                    return '/viewer' + (path.charAt(0) === '/' ? path : '/' + path);
                }
            });
            app.use('/viewer', _vp);
            console.log('[DreamBot] /viewer proxy V3 → ' + viewerTarget);
            setTimeout(function () {
                try {
                    if (typeof server !== 'undefined' && server && typeof server.on === 'function') {
                        server.on('upgrade', function (req, socket, head) {
                            try {
                                if (req.url && String(req.url).indexOf('/viewer') === 0) {
                                    _vp.upgrade(req, socket, head);
                                }
                            } catch (e) {}
                        });
                        console.log('[DreamBot] /viewer WS upgrade hooked');
                    }
                } catch (e) {}
            }, 500);
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
  console.log('[viewer-proxy] V3 injected');
} else {
  writeFileSync(file, src);
  console.log('[viewer-proxy] V3 already present');
}

try {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    join(publicDir, 'mobile-view.html'),
    '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/viewer/"></head><body>Abrindo...</body></html>'
  );
} catch {}
