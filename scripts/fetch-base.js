/**
 * Clone official mindcraft, apply DreamBot patches, disable heavy viewer/vision.
 * Never hard-crash the whole npm install.
 */
import { execSync } from 'child_process';
import { existsSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const TMP = join(ROOT, '.mindcraft-base');
const NEEDLE = join(ROOT, 'src', 'agent', 'library', 'skills.js');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
}

function writeStub(relPath, content) {
  const full = join(ROOT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log('[fetch-base] stub:', relPath);
}

try {
  if (!existsSync(NEEDLE)) {
    console.log('[fetch-base] Cloning mindcraft-bots/mindcraft...');
    try {
      rmSync(TMP, { recursive: true, force: true });
      run(`git clone --depth 1 https://github.com/mindcraft-bots/mindcraft.git "${TMP}"`);
    } catch (e) {
      console.error('[fetch-base] git clone failed:', e.message);
      console.error('[fetch-base] Make sure git is installed in the build image.');
      process.exit(0);
    }

    for (const part of ['src', 'profiles', 'bots']) {
      const from = join(TMP, part);
      const to = join(ROOT, part);
      if (!existsSync(from)) continue;
      console.log('[fetch-base] copying', part);
      mkdirSync(to, { recursive: true });
      try {
        run(`cp -rn "${from}/." "${to}/" 2>/dev/null || true`);
      } catch (_) {}
    }

    if (!existsSync(join(ROOT, 'main.js'))) {
      cpSync(join(TMP, 'main.js'), join(ROOT, 'main.js'));
    }
  } else {
    console.log('[fetch-base] Base sources already present.');
  }

  // settings re-export at src/settings.js (root settings for main.js)
  try {
    writeFileSync(
      join(ROOT, 'src', 'settings.js'),
      "import settings from '../settings.js';\nexport default settings;\n"
    );
    console.log('[fetch-base] src/settings.js re-export installed.');
  } catch (e) {
    console.warn('[fetch-base] could not write src/settings.js:', e.message);
  }

  // Official agent settings shape (must export setSettings)
  writeStub('src/agent/settings.js', `
let settings = {};
export default settings;
export function setSettings(new_settings) {
    Object.keys(settings).forEach(key => delete settings[key]);
    Object.assign(settings, new_settings);
}
`);

  // Vision stubs
  writeStub('src/agent/vision/browser_viewer.js', `
export function addBrowserViewer() {}
export function addViewer() {}
export default { addBrowserViewer, addViewer };
`);

  writeStub('src/agent/vision/camera.js', `
import { EventEmitter } from 'events';
export class Camera extends EventEmitter {
  constructor(bot, fp) {
    super();
    this.bot = bot;
    this.fp = fp;
    this.disabled = true;
    setImmediate(() => this.emit('ready'));
  }
  async capture() {
    console.log('[DreamBot] Camera capture skipped (vision disabled).');
    return null;
  }
}
`);

  writeStub('src/agent/vision/vision_interpreter.js', `
export class VisionInterpreter {
  constructor(agent, allow_vision) {
    this.agent = agent;
    this.allow_vision = false;
    this.fp = './bots/' + agent.name + '/screenshots/';
    this.camera = null;
    if (allow_vision) {
      console.log('[DreamBot] Vision requested but disabled in this deploy.');
    }
  }
  async lookAtPlayer() { return 'Vision is disabled.'; }
  async lookAtPosition() { return 'Vision is disabled.'; }
  getCenterBlockInfo() { return 'No block in center view'; }
  async analyzeImage() { return 'Vision is disabled.'; }
}
`);

  // Safe math.js — Groq has no embeddings, null vectors were crashing the agent on chat
  writeStub('src/utils/math.js', `
export function cosineSimilarity(a, b) {
    if (!a || !b || !Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
        return 0;
    }
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += Math.pow(a[i], 2);
        magnitudeB += Math.pow(b[i], 2);
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
}
`);

  // Safe examples.js — fall back to word-overlap if embed is null/fails
  writeStub('src/utils/examples.js', `
import { cosineSimilarity } from './math.js';
import { stringifyTurns, wordOverlapScore } from './text.js';

export class Examples {
    constructor(model, select_num=2) {
        this.examples = [];
        this.model = model;
        this.select_num = select_num;
        this.embeddings = {};
    }

    turnsToText(turns) {
        let messages = '';
        for (let turn of turns) {
            if (turn.role !== 'assistant')
                messages += turn.content.substring(turn.content.indexOf(':')+1).trim() + '\n';
        }
        return messages.trim();
    }

    async load(examples) {
        this.examples = examples;
        if (!this.model) return;
        if (this.select_num === 0) return;

        try {
            const embeddingPromises = examples.map(example => {
                const turn_text = this.turnsToText(example);
                return this.model.embed(turn_text)
                    .then(embedding => {
                        if (embedding) this.embeddings[turn_text] = embedding;
                    })
                    .catch(() => {});
            });
            await Promise.all(embeddingPromises);
            if (Object.keys(this.embeddings).length === 0) {
                console.warn('[DreamBot] No embeddings available, using word-overlap.');
                this.model = null;
            }
        } catch (err) {
            console.warn('Error with embedding model, using word-overlap instead.');
            this.model = null;
        }
    }

    async getRelevant(turns) {
        if (this.select_num === 0)
            return [];

        let turn_text = this.turnsToText(turns);
        try {
            if (this.model !== null) {
                let embedding = await this.model.embed(turn_text);
                if (!embedding) {
                    this.model = null;
                } else {
                    this.examples.sort((a, b) => {
                        const eb = this.embeddings[this.turnsToText(b)];
                        const ea = this.embeddings[this.turnsToText(a)];
                        return cosineSimilarity(embedding, eb) - cosineSimilarity(embedding, ea);
                    });
                }
            }
            if (this.model === null) {
                this.examples.sort((a, b) =>
                    wordOverlapScore(turn_text, this.turnsToText(b)) -
                    wordOverlapScore(turn_text, this.turnsToText(a))
                );
            }
        } catch (e) {
            console.warn('[DreamBot] getRelevant failed, returning empty examples:', e.message);
            return [];
        }
        let selected = this.examples.slice(0, this.select_num);
        return JSON.parse(JSON.stringify(selected));
    }

    async createExampleMessage(turns) {
        let selected_examples = await this.getRelevant(turns);

        console.log('selected examples:');
        for (let example of selected_examples) {
            console.log('Example:', example[0]?.content)
        }

        let msg = 'Examples of how to respond:\n';
        for (let i=0; i<selected_examples.length; i++) {
            let example = selected_examples[i];
            msg += `Example ${i+1}:\n${stringifyTurns(example)}\n\n`;
        }
        return msg;
    }
}
`);

  const patchDir = join(ROOT, 'patches');
  const patches = ['agent.js.patch', 'modes.js.patch', 'mcdata.js.patch'];
  if (existsSync(patchDir)) {
    for (const name of patches) {
      const patchFile = join(patchDir, name);
      if (!existsSync(patchFile)) continue;
      console.log('[fetch-base] applying', name);
      try {
        run(`cd "${ROOT}" && patch -N -r - -p0 < "${patchFile}"`);
      } catch (e) {
        console.warn('[fetch-base] patch skipped/already applied:', name);
      }
    }
  }

  // Bind MindServer publicly for Railway domain
  try {
    run(`node "${join(ROOT, 'scripts', 'patch-mindserver.js')}"`);
  } catch (e) {
    console.warn('[fetch-base] patch-mindserver failed:', e.message);
  }

  console.log('[fetch-base] Ready.');
} catch (e) {
  console.error('[fetch-base] unexpected error:', e.message);
  process.exit(0);
}
