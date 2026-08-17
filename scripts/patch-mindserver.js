/**
 * Force MindServer to listen on 0.0.0.0 so Railway public URL works.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const file = join(process.cwd(), 'src', 'mindcraft', 'mindserver.js');
if (!existsSync(file)) {
  console.warn('[patch-mindserver] file not found, skip');
  process.exit(0);
}

let src = readFileSync(file, 'utf8');

// Replace hard-coded localhost bind
src = src.replace(
  /if \(host_public\) \{[\s\S]*?\}\s*const host = 'localhost';/,
  `if (host_public) {
        console.log('Public hosting enabled (0.0.0.0).');
    }
    const host = host_public ? '0.0.0.0' : 'localhost';`
);

// Fallback if pattern differs
if (src.includes("const host = 'localhost'")) {
  src = src.replace(
    "const host = 'localhost';",
    "const host = (host_public || process.env.PORT) ? '0.0.0.0' : 'localhost';"
  );
}

writeFileSync(file, src);
console.log('[patch-mindserver] MindServer will bind to 0.0.0.0 when public/PORT is set.');
