/**
 * Force MindServer to listen on 0.0.0.0 and serve the real Mindcraft UI.
 */
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const file = join(ROOT, 'src', 'mindcraft', 'mindserver.js');
const publicDir = join(ROOT, 'src', 'mindcraft', 'public');
const tmpPublic = join(ROOT, '.mindcraft-base', 'src', 'mindcraft', 'public');

// Ensure UI static files exist
if (!existsSync(join(publicDir, 'index.html')) && existsSync(tmpPublic)) {
  mkdirSync(publicDir, { recursive: true });
  try {
    cpSync(tmpPublic, publicDir, { recursive: true });
    console.log('[patch-mindserver] copied public UI from mindcraft base');
  } catch (e) {
    console.warn('[patch-mindserver] copy public', e.message);
  }
}

if (!existsSync(file)) {
  console.warn('[patch-mindserver] mindserver.js not found, skip');
  process.exit(0);
}

let src = readFileSync(file, 'utf8');

// Always bind 0.0.0.0 on Railway (PORT set)
src = src.replace(
  /if \(host_public\) \{[\s\S]*?console\.log\([^)]*[Pp]ublic[^)]*\);?[\s\S]*?\}\s*const host = ['"]localhost['"];/,
  `if (host_public) {
        console.log('Public hosting enabled (0.0.0.0).');
    }
    const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';`
);

if (src.includes("const host = 'localhost'")) {
  src = src.replace(
    /const host = 'localhost';/g,
    "const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';"
  );
}
if (src.includes('const host = "localhost"')) {
  src = src.replace(
    /const host = "localhost";/g,
    'const host = (host_public || process.env.PORT) ? "0.0.0.0" : "localhost";'
  );
}

// server.listen(port, host) patterns
if (!src.includes("0.0.0.0") && src.includes('server.listen')) {
  src = src.replace(
    /server\.listen\(\s*port\s*,\s*host\s*,/,
    "server.listen(port, (host_public || process.env.PORT) ? '0.0.0.0' : host,"
  );
}

writeFileSync(file, src);
console.log('[patch-mindserver] MindServer → 0.0.0.0 + UI public/');
if (existsSync(join(publicDir, 'index.html'))) {
  console.log('[patch-mindserver] index.html OK');
} else {
  console.warn('[patch-mindserver] WARNING: no index.html in public — UI may be blank');
}
