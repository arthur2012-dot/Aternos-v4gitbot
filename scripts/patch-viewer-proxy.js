/**
 * Inject reverse-proxy /viewer → 127.0.0.1:3001 into mindserver.js
 * so the phone can open the 3D view on the SAME Railway domain/port.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const file = join(ROOT, 'src', 'mindcraft', 'mindserver.js');
const publicDir = join(ROOT, 'src', 'mindcraft', 'public');

if (!existsSync(file)) {
  console.warn('[viewer-proxy] mindserver.js missing');
  process.exit(0);
}

let src = readFileSync(file, 'utf8');

if (src.includes('[DreamBot] viewer-proxy')) {
  console.log('[viewer-proxy] already patched');
} else {
  // Ensure imports
  if (!src.includes('http-proxy-middleware')) {
    src = src.replace(
      /(import .* from 'express';?)/,
      `$1
import { createProxyMiddleware } from 'http-proxy-middleware';`
    );
    // if no express import line matched, prepend
    if (!src.includes('http-proxy-middleware')) {
      src = `import { createProxyMiddleware } from 'http-proxy-middleware';\n` + src;
    }
  }

  const inject = `
    // [DreamBot] viewer-proxy — same public PORT for mobile 3D
    try {
        const viewerProxy = createProxyMiddleware({
            target: 'http://127.0.0.1:' + (process.env.VIEWER_INTERNAL_PORT || 3001),
            changeOrigin: true,
            ws: true,
            logLevel: 'silent',
            pathRewrite: (path) => path.replace(/^\\/viewer/, '') || '/',
        });
        app.use('/viewer', viewerProxy);
        app.get('/see', (req, res) => {
            res.redirect(302, '/viewer');
        });
        console.log('[DreamBot] /viewer and /see → internal prismarine-viewer');
    } catch (e) {
        console.warn('[DreamBot] viewer-proxy skip', e.message);
    }
`;

  // After express.static or after app = express
  if (src.includes('express.static')) {
    src = src.replace(
      /(app\.use\(express\.static\([^)]+\)\);?)/,
      `$1\n${inject}`
    );
  } else if (src.includes('const app = express()')) {
    src = src.replace(
      /(const app = express\(\);?)/,
      `$1\n${inject}`
    );
  } else {
    console.warn('[viewer-proxy] could not find inject point');
  }

  // WebSocket upgrade for socket.io of viewer
  if (!src.includes('viewerProxy') && src.includes('server.listen')) {
    // already in inject via ws:true when using same server — need:
  }
  if (src.includes('server.listen') && !src.includes('upgrade') && src.includes('viewerProxy')) {
    src = src.replace(
      /(server\.listen\([^)]*\([^)]*\)\s*=>\s*\{)/,
      `server.on('upgrade', (req, socket, head) => {
        try {
            if (req.url && req.url.startsWith('/viewer')) {
                // handled by proxy middleware if attached
            }
        } catch {}
    });
    $1`
    );
  }

  writeFileSync(file, src);
  console.log('[viewer-proxy] patched mindserver.js');
}

// Mobile landing page in public/
try {
  mkdirSync(publicDir, { recursive: true });
  const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
  <title>DreamBot View</title>
  <style>
    html,body{margin:0;height:100%;background:#111;color:#eee;font-family:sans-serif}
    .bar{padding:10px;background:#222;font-size:14px}
    a{color:#7f7}
    iframe{border:0;width:100%;height:calc(100% - 42px)}
  </style>
</head>
<body>
  <div class="bar">DreamBot 3D — se ficar preto, espere spawn do bot · <a href="/viewer">abrir viewer</a> · <a href="/">painel</a></div>
  <iframe src="/viewer" allow="fullscreen"></iframe>
</body>
</html>`;
  writeFileSync(join(publicDir, 'mobile-view.html'), html);
  console.log('[viewer-proxy] mobile-view.html OK');
} catch (e) {
  console.warn('[viewer-proxy] html', e.message);
}
