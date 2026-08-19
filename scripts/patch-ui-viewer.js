/**
 * Fix Mindcraft UI: iframe was http://localhost:3000 which fails on phone.
 * Replace with same-origin /viewer (proxied to prismarine-viewer).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'src', 'mindcraft', 'public', 'index.html');
if (!existsSync(file)) {
  console.warn('[ui-viewer] index.html missing');
  process.exit(0);
}

let html = readFileSync(file, 'utf8');

if (html.includes('DREAMBOT_VIEWER_SRC')) {
  console.log('[ui-viewer] already patched');
  process.exit(0);
}

// Main iframe src in renderAgentCard
html = html.replace(
  /src="http:\/\/localhost:\$\{viewerPort\}"/g,
  'src="/viewer" /* DREAMBOT_VIEWER_SRC */'
);

html = html.replace(
  /src='http:\/\/localhost:\$\{viewerPort\}'/g,
  "src='/viewer' /* DREAMBOT_VIEWER_SRC */"
);

// Any remaining localhost viewer links
html = html.replace(
  /http:\/\/localhost:\$\{viewerPort\}/g,
  '/viewer'
);
html = html.replace(
  /http:\/\/localhost:3000/g,
  '/viewer'
);
html = html.replace(
  /http:\/\/localhost:3001/g,
  '/viewer'
);

// Force show viewer container when in game even if settings lag
// (optional: keep render_bot_view check)

writeFileSync(file, html);
console.log('[ui-viewer] iframe -> /viewer (mobile OK)');
