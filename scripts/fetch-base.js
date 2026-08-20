/**
 * DreamBot — FULL mindcraft sync
 * Clones https://github.com/mindcraft-bots/mindcraft.git and copies EVERYTHING
 * into the project, then applies DreamBot overlays (settings, pure-survival, stubs, fixes).
 *
 * Env:
 *   FORCE_MINDCRAFT_REFRESH=1  → always re-clone
 *   MC_VERSION                 → default 1.21.11
 */
import { execSync } from 'child_process';
import {
  existsSync,
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname, relative } from 'path';

const ROOT = process.cwd();
const TMP = join(ROOT, '.mindcraft-base');
const REPO = 'https://github.com/mindcraft-bots/mindcraft.git';
const VER = process.env.MC_VERSION || '1.21.11';
const FORCE = process.env.FORCE_MINDCRAFT_REFRESH === '1';

// DreamBot-owned paths that must NEVER be overwritten by upstream
const PRESERVE = new Set([
  'settings.js',
  'main.js',
  'package.json',
  'Dockerfile',
  'railway.toml',
  'nixpacks.toml',
  'keys.json',
  'DEPLOY_VERSION.txt',
  'README.md',
  '.gitignore',
  'profiles/dream.json',
]);

const PRESERVE_PREFIX = [
  'scripts/',
  'stubs/',
  'patches/', // DreamBot patches (agent.js.patch etc.)
];

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: true, cwd: ROOT });
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function write(rel, content) {
  const full = join(ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writeStub(rel, content) {
  write(rel, content);
  console.log('[fetch-base] stub', rel);
}

function shouldPreserve(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (PRESERVE.has(norm)) return true;
  return PRESERVE_PREFIX.some((p) => norm.startsWith(p));
}

function walkFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, base, out);
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

function cloneMindcraft() {
  const marker = join(TMP, 'src', 'agent', 'agent.js');
  if (!FORCE && existsSync(marker)) {
    console.log('[fetch-base] .mindcraft-base present (set FORCE_MINDCRAFT_REFRESH=1 to re-clone)');
    return;
  }
  console.log('[fetch-base] cloning FULL mindcraft from', REPO);
  rmSync(TMP, { recursive: true, force: true });
  run('git clone --depth 1 "' + REPO + '" "' + TMP + '"');
}

/**
 * Copy entire mindcraft tree into ROOT, skipping DreamBot-owned files.
 */
function copyEverything() {
  const parts = [
    'src',
    'profiles',
    'bots',
    'tasks',
    'services',
    'patches', // upstream patch-package patches
  ];

  // also copy useful root files if missing
  const rootFiles = [
    'FAQ.md',
    'LICENSE',
    'minecollab.md',
    'keys.example.json',
    'eslint.config.js',
    'docker-compose.yml',
    'andy.json',
    'requirements.txt',
  ];

  let copied = 0;
  let skipped = 0;

  for (const part of parts) {
    const fromRoot = join(TMP, part);
    if (!existsSync(fromRoot)) {
      console.log('[fetch-base] skip missing upstream dir', part);
      continue;
    }
    const files = walkFiles(fromRoot);
    for (const rel of files) {
      const destRel = join(part, rel).replace(/\\/g, '/');
      if (shouldPreserve(destRel)) {
        skipped++;
        continue;
      }
      // never overwrite profiles/dream.json
      if (destRel === 'profiles/dream.json') {
        skipped++;
        continue;
      }
      const src = join(fromRoot, rel);
      const dst = join(ROOT, destRel);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
      copied++;
    }
    console.log('[fetch-base] synced dir', part);
  }

  for (const f of rootFiles) {
    const src = join(TMP, f);
    if (!existsSync(src)) continue;
    if (shouldPreserve(f)) continue;
    const dst = join(ROOT, f);
    // only copy if not present, or always refresh non-preserve
    cpSync(src, dst);
    copied++;
  }

  console.log('[fetch-base] copied', copied, 'files, preserved', skipped);
}

function applyDreamBotFixes() {
  // prompter safeReplace
  try {
    let prompter = read('src/models/prompter.js');
    if (!prompter.includes('[DreamBot] safeReplace') && prompter.includes('async replaceStrings')) {
      const safeMethod = [
        '// [DreamBot] safeReplace',
        '    _safeReplaceAll(str, search, repl) {',
        "        const s = (str == null) ? '' : String(str);",
        "        if (typeof s.replaceAll === 'function') {",
        '            try { return s.replaceAll(search, repl); } catch {}',
        '        }',
        "        const esc = String(search).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');",
        "        return s.replace(new RegExp(esc, 'g'), repl == null ? '' : String(repl));",
        '    }',
        '    async replaceStrings(',
      ].join('\n');
      prompter = prompter.replace(/async replaceStrings\s*\(/, safeMethod);
      prompter = prompter.replace(/prompt\s*=\s*prompt\.replaceAll\(/g, 'prompt = this._safeReplaceAll(prompt, ');
      write('src/models/prompter.js', prompter);
      console.log('[fetch-base] prompter safeReplace');
    }
  } catch (e) {
    console.warn('[fetch-base] prompter', e.message);
  }

  // modes: keep self-prompt, longer stuck, no cleanKill
  try {
    let modes = read('src/agent/modes.js');
    modes = modes.replace(
      /if\s*\(\s*agent\.self_prompter\.isActive\(\)\s*\)\s*\n?\s*agent\.self_prompter\.stopLoop\(\);/g,
      '// DreamBot: keep self-prompt'
    );
    modes = modes.replace(/max_stuck_time:\s*\d+/g, 'max_stuck_time: 90');
    modes = modes.replace(
      /agent\.cleanKill\(["']Got stuck[^"']*["']\)/g,
      "console.warn('[DreamBot] stuck — stay online')"
    );
    write('src/agent/modes.js', modes);
    console.log('[fetch-base] modes fixes');
  } catch (e) {
    console.warn('[fetch-base] modes', e.message);
  }

  // skills: softer PathStopped
  try {
    let skills = read('src/agent/library/skills.js');
    if (!skills.includes('[DreamBot] collect continue')) {
      skills = skills.replace(
        /console\.log\(err\);\s*\/\/ log pathfinder errors for debugging/g,
        "if (/PathStopped|NoPath|Timeout|GoalChanged/i.test(String(err?.message || err))) {\n" +
          "                console.warn('[DreamBot] collect continue');\n" +
          '            } else console.log(err);'
      );
      write('src/agent/library/skills.js', skills);
      console.log('[fetch-base] skills PathStopped soft');
    }
  } catch {}

  // agent chat suppress + no hello world exit spam
  try {
    let agent = read('src/agent/agent.js');
    if (agent.includes('Hello world! I am')) {
      agent = agent.replace(
        /this\.openChat\(["']Hello world! I am ["']\s*\+\s*this\.name\);/,
        "try {\n            if (this.self_prompter && !this.self_prompter.isActive()) {\n" +
          "                this.self_prompter.start('Survive. Always !command. Keep moving.');\n" +
          '            }\n        } catch {}'
      );
    }
    if (!agent.includes('[DreamBot] suppressed')) {
      agent = agent.replace(
        /async openChat\(message\) \{/,
        'async openChat(message) {\n' +
          "        const __m = String(message || '');\n" +
          '        if (!__m.trim()) return;\n' +
          "        if (/groq|rate.?limit|brain disconnected|api key|restarting|exiting|hello world|PathStopped|passivo|cooldown|replaceAll|key not found|LoginGuard/i.test(__m)) {\n" +
          "            console.warn('[DreamBot] suppressed:', __m.slice(0, 40));\n" +
          '            return;\n        }'
      );
    }
    agent = agent.replace(
      /this\.bot\.chat\(code > 1 \? 'Restarting\.': 'Exiting\.'\);/g,
      '/* no Exiting chat */'
    );
    write('src/agent/agent.js', agent);
    console.log('[fetch-base] agent chat fixes');
  } catch (e) {
    console.warn('[fetch-base] agent', e.message);
  }

  // self_prompter softer
  try {
    let sp = read('src/agent/self_prompter.js');
    sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, '/* no stop */ void 0;');
    sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 40');
    sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');
    write('src/agent/self_prompter.js', sp);
    console.log('[fetch-base] self_prompter soft');
  } catch {}

  // mcdata: never delete version
  try {
    let mc = read('src/utils/mcdata.js');
    if (!mc.includes('DreamBot: NEVER delete version')) {
      mc = mc.replace(
        /if\s*\(\s*!mc_version\s*\|\|\s*mc_version\s*===\s*["']auto["']\s*\)\s*\{[\s\S]*?delete\s+options\.version;[\s\S]*?\}/m,
        "// DreamBot: NEVER delete version\n    options.version = options.version || '" +
          VER +
          "';\n    console.log('[DreamBot] version', options.version);"
      );
      write('src/utils/mcdata.js', mc);
      console.log('[fetch-base] mcdata version lock');
    }
  } catch {}
}

function installOverlays() {
  // settings bridge
  write(
    'src/settings.js',
    "import settings from '../settings.js';\nexport default settings;\n"
  );

  writeStub(
    'src/agent/settings.js',
    'let settings = {};\n' +
      'export default settings;\n' +
      'export function setSettings(new_settings) {\n' +
      '    Object.keys(settings).forEach(k => delete settings[k]);\n' +
      '    Object.assign(settings, new_settings);\n' +
      "    if (!settings.minecraft_version || settings.minecraft_version === 'auto' || settings.minecraft_version === false) {\n" +
      "        settings.minecraft_version = process.env.MC_VERSION || '1.21.11';\n" +
      '    }\n' +
      '    settings.allow_vision = true;\n' +
      '    settings.render_bot_view = true;\n' +
      '    settings.show_bot_views = true;\n' +
      '}\n'
  );

  // optional stubs if present
  const stubs = [
    ['stubs/math.js', 'src/utils/math.js'],
    ['stubs/examples.js', 'src/utils/examples.js'],
    ['stubs/agent_process.js', 'src/process/agent_process.js'],
    ['stubs/coder.js', 'src/agent/coder.js'],
  ];
  for (const [from, to] of stubs) {
    if (existsSync(join(ROOT, from))) {
      write(to, readFileSync(join(ROOT, from), 'utf8'));
      console.log('[fetch-base] overlay', to);
    }
  }

  // light vision if script exists
  const lightPath = join(ROOT, 'scripts', 'light-vision.js');
  if (existsSync(lightPath)) {
    writeStub(
      'src/agent/vision/browser_viewer.js',
      '// Light vision stub\n' +
        'export function addBrowserViewer() {}\n' +
        'export function addViewer() {}\n' +
        'export default { addBrowserViewer, addViewer };\n'
    );
  }
}

try {
  console.log('[fetch-base] FULL mindcraft sync starting...');
  cloneMindcraft();
  copyEverything();
  applyDreamBotFixes();
  installOverlays();
  console.log('[fetch-base] Ready — full mindcraft + DreamBot overlays');
} catch (e) {
  console.error('[fetch-base]', e.message);
  process.exit(0);
}
