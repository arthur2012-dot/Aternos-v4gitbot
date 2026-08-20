/**
 * DreamBot — FULL mindcraft sync (bulletproof)
 * Always clones mindcraft-bots/mindcraft and OVERWRITES src/ so modules exist.
 * Preserves only DreamBot-owned files (settings, main, scripts, dream profile).
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

const PRESERVE_PREFIX = ['scripts/', 'stubs/'];

const CRITICAL = [
  'src/agent/agent.js',
  'src/agent/modes.js',
  'src/agent/library/skills.js',
  'src/agent/library/world.js',
  'src/mindcraft/mindserver.js',
  'src/mindcraft/mcserver.js',
  'src/mindcraft/mindcraft.js',
  'src/models/prompter.js',
  'src/utils/mcdata.js',
  'src/process/agent_process.js',
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

function shouldPreserve(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (PRESERVE.has(norm)) return true;
  if (norm === 'profiles/dream.json') return true;
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
  console.log('[fetch-base] cloning FULL mindcraft from', REPO);
  rmSync(TMP, { recursive: true, force: true });
  run('git clone --depth 1 "' + REPO + '" "' + TMP + '"');
  if (!existsSync(join(TMP, 'src', 'agent', 'agent.js'))) {
    throw new Error('clone failed: agent.js missing in .mindcraft-base');
  }
}

function copyEverything() {
  const parts = ['src', 'profiles', 'bots', 'tasks', 'services'];
  let copied = 0;
  let skipped = 0;

  for (const part of parts) {
    const fromRoot = join(TMP, part);
    if (!existsSync(fromRoot)) continue;
    for (const rel of walkFiles(fromRoot)) {
      const destRel = join(part, rel).replace(/\\/g, '/');
      if (shouldPreserve(destRel)) {
        skipped++;
        continue;
      }
      const src = join(fromRoot, rel);
      const dst = join(ROOT, destRel);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst); // always overwrite
      copied++;
    }
    console.log('[fetch-base] synced', part);
  }

  // upstream patches (patch-package)
  const upPatches = join(TMP, 'patches');
  if (existsSync(upPatches)) {
    for (const rel of walkFiles(upPatches)) {
      // only copy upstream-named patches (contain +)
      if (!rel.includes('+')) continue;
      const destRel = join('patches', rel).replace(/\\/g, '/');
      mkdirSync(dirname(join(ROOT, destRel)), { recursive: true });
      cpSync(join(upPatches, rel), join(ROOT, destRel));
      copied++;
    }
  }

  console.log('[fetch-base] copied', copied, 'files, preserved', skipped);
}

function verifyCritical() {
  const missing = CRITICAL.filter((p) => !existsSync(join(ROOT, p)));
  if (missing.length) {
    throw new Error('CRITICAL modules missing after sync: ' + missing.join(', '));
  }
  console.log('[fetch-base] critical modules OK');
}

function applyDreamBotFixes() {
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
    }
  } catch (e) {
    console.warn('[fetch-base] prompter', e.message);
  }

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
  } catch (e) {
    console.warn('[fetch-base] modes', e.message);
  }

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
    }
  } catch {}

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
  } catch (e) {
    console.warn('[fetch-base] agent', e.message);
  }

  try {
    let sp = read('src/agent/self_prompter.js');
    sp = sp.replace(/await this\.agent\.actions\.stop\(\);/g, '/* no stop */ void 0;');
    sp = sp.replace(/MAX_NO_COMMAND = \d+/, 'MAX_NO_COMMAND = 40');
    sp = sp.replace(/this\.state = STOPPED;/g, 'this.state = PAUSED;');
    write('src/agent/self_prompter.js', sp);
  } catch {}

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
    }
  } catch {}
}

function installOverlays() {
  write('src/settings.js', "import settings from '../settings.js';\nexport default settings;\n");

  write(
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

  // ONLY apply stubs if upstream file is still missing (never overwrite real mindcraft)
  const stubs = [
    ['stubs/math.js', 'src/utils/math.js'],
    ['stubs/examples.js', 'src/utils/examples.js'],
  ];
  for (const [from, to] of stubs) {
    if (existsSync(join(ROOT, from)) && !existsSync(join(ROOT, to))) {
      write(to, readFileSync(join(ROOT, from), 'utf8'));
      console.log('[fetch-base] stub fill', to);
    }
  }
}

try {
  console.log('[fetch-base] FULL mindcraft sync starting...');
  cloneMindcraft();
  copyEverything();
  verifyCritical();
  applyDreamBotFixes();
  installOverlays();
  verifyCritical();
  console.log('[fetch-base] Ready — full mindcraft + DreamBot overlays');
} catch (e) {
  console.error('[fetch-base] FATAL', e.message);
  process.exit(1);
}
