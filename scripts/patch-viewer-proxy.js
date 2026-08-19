/**
 * Safe viewer proxy patch:
 * 1) Restore mindserver.js from mindcraft base if broken
 * 2) Inject /viewer proxy WITHOUT breaking syntax
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const file = join(ROOT, 'src', 'mindcraft', 'mindserver.js');
const base = join(ROOT, '.mindcraft-base', 'src', 'mindcraft', 'mindserver.js');
const publicDir = join(ROOT, 'src', 'mindcraft', 'public');

function restoreFromBase() {
  if (!existsSync(base)) {
    console.warn('[viewer-proxy] no base mindserver to restore');
    return false;
  }
  mkdirSync(join(ROOT, 'src', 'mindcraft'), { recursive: true });
  copyFileSync(base, file);
  console.log('[viewer-proxy] restored mindserver.js from base');
  return true;
}

if (!existsSync(file)) {
  if (!restoreFromBase()) process.exit(0);
}

let src = readFileSync(file, 'utf8');

// If previous bad patch broke the file, restore
if (
  src.includes('[DreamBot] viewer-proxy') ||
  !src.includes('createMindServer') ||
  src.split('(').length !== src.split(')').length
) {
  console.warn('[viewer-proxy] mindserver looks bad or old patch — restore');
  restoreFromBase();
  src = readFileSync(file, 'utf8');
}

// Re-apply 0.0.0.0 bind (patch-mindserver may have run before restore)
if (src.includes("const host = 'localhost'") || src.includes('const host = "localhost"')) {
  src = src.replace(
    /const host = ['"]localhost['"];/g,
    "const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';"
  );
  console.log('[viewer-proxy] host 0.0.0.0');
}

// Inject proxy only once, after static files line, as a clean block
if (!src.includes('DREAMBOT_VIEWER_PROXY')) {
  const proxyBlock = `
    // DREAMBOT_VIEWER_PROXY
    try {
        const { createProxyMiddleware } = await import('http-proxy-middleware').catch(() => ({ createProxyMiddleware: null }));
        if (createProxyMiddleware) {
            const _vp = createProxyMiddleware({
                target: 'http://127.0.0.1:' + (process.env.VIEWER_INTERNAL_PORT || 3001),
                changeOrigin: true,
                ws: true,
                pathRewrite: function (p) { return p.replace(/^\\/viewer/, '') || '/'; }
            });
            app.use('/viewer', _vp);
            app.get('/see', function (req, res) { res.redirect(302, '/viewer'); });
            console.log('[DreamBot] /viewer proxy ready');
        }
    } catch (e) {
        console.warn('[DreamBot] viewer proxy skip', e && e.message);
    }
`;

  // mindserver is NOT async function usually — await import at top level of createMindServer is ok if createMindServer is async
  // Safer: use createRequire / dynamic import without await at top of sync function
  const proxyBlockSync = `
    // DREAMBOT_VIEWER_PROXY
    try {
        import('http-proxy-middleware').then(function (mod) {
            var createProxyMiddleware = mod.createProxyMiddleware;
            if (!createProxyMiddleware) return;
            var _vp = createProxyMiddleware({
                target: 'http://127.0.0.1:' + (process.env.VIEWER_INTERNAL_PORT || 3001),
                changeOrigin: true,
                ws: true,
                pathRewrite: function (p) { return (p || '').replace(/^\\/viewer/, '') || '/'; }
            });
            app.use('/viewer', _vp);
            console.log('[DreamBot] /viewer proxy ready');
        }).catch(function (e) {
            console.warn('[DreamBot] viewer proxy skip', e && e.message);
        });
        app.get('/see', function (req, res) { res.redirect(302, '/viewer'); });
    } catch (e) {
        console.warn('[DreamBot] viewer proxy skip', e && e.message);
    }
`;

  if (src.includes("express.static")) {
    // Match full static line carefully
    src = src.replace(
      /app\.use\(\s*express\.static\([^\n]+\)\s*\);?/,
      (match) => match.replace(/;?\s*$/, ';') + '\n' + proxyBlockSync
    );
  } else {
    console.warn('[viewer-proxy] no express.static line');
  }

  writeFileSync(file, src);
  console.log('[viewer-proxy] injected clean proxy');
} else {
  writeFileSync(file, src);
  console.log('[viewer-proxy] proxy already present (after restore check)');
}

// Mobile HTML
try {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    join(publicDir, 'mobile-view.html'),
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>DreamBot</title></head><body style="margin:0;background:#111"><iframe src="/viewer" style="border:0;width:100%;height:100vh"></iframe></body></html>'
  );
  console.log('[viewer-proxy] mobile-view.html OK');
} catch (e) {
  console.warn('[viewer-proxy] html', e.message);
}
