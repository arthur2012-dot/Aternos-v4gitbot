/**
 * V5: text viewer listens on :3001 at path /
 * Public URL /viewer → proxy rewrites to /
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
  console.log('[viewer-proxy] restored');
  return true;
}

if (!existsSync(file) && !restoreFromBase()) process.exit(0);

let src = readFileSync(file, 'utf8');

if (
  (src.includes('DREAMBOT_VIEWER_PROXY') && !src.includes('DREAMBOT_VIEWER_PROXY_V5')) ||
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

if (!src.includes('DREAMBOT_VIEWER_PROXY_V5')) {
  src = src.replace(/\n\s*\/\/ DREAMBOT_VIEWER_PROXY[\s\S]*?viewer proxy[\s\S]*?\n/g, '\n');

  const proxyBlock = `
    // DREAMBOT_VIEWER_PROXY_V5 — text viewer on :3001 root
    try {
        import('http-proxy-middleware').then(function (mod) {
            var createProxyMiddleware = mod.createProxyMiddleware;
            if (!createProxyMiddleware) return;
            var viewerTarget = 'http://127.0.0.1:' + (process.env.VIEWER_INTERNAL_PORT || 3001);
            var _vp = createProxyMiddleware({
                target: viewerTarget,
                changeOrigin: true,
                pathFilter: function (pathname) {
                    return pathname === '/viewer' || pathname.indexOf('/viewer/') === 0 || pathname === '/see';
                },
                pathRewrite: function (path) {
                    return '/';
                }
            });
            app.use(_vp);
            console.log('[DreamBot] /viewer → text viewer ' + viewerTarget);
        }).catch(function (e) {
            console.warn('[DreamBot] viewer proxy', e && e.message);
        });
        app.get('/see', function (req, res) { res.redirect(302, '/viewer'); });
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
  console.log('[viewer-proxy] V5 injected');
} else {
  writeFileSync(file, src);
  console.log('[viewer-proxy] V5 already present');
}

try {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    join(publicDir, 'mobile-view.html'),
    '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/viewer"></head><body>Abrindo visao...</body></html>'
  );
} catch {}
