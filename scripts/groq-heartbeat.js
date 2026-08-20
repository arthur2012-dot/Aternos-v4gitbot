/**
 * Light Groq ping every 20 minutes — never blocks passive body.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const INTERVAL_MS = 20 * 60 * 1000;
const TIMEOUT_MS = 12000;

function loadGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
  if (process.env.GROQ_KEY) return process.env.GROQ_KEY.trim();
  try {
    const p = join(process.cwd(), 'keys.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (j.GROQ_API_KEY) return String(j.GROQ_API_KEY).trim();
      if (j.groq) return String(j.groq).trim();
    }
  } catch {}
  return null;
}

function loadModel() {
  try {
    const p = join(process.cwd(), 'profiles/dream.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (j.model?.model) return j.model.model;
    }
  } catch {}
  return 'openai/gpt-oss-20b';
}

async function pingGroq(bot) {
  const key = loadGroqKey();
  if (!key) {
    console.warn('[GROQ-HB] no API key — skip');
    return;
  }

  const model = loadModel();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let context = 'alive';
  try {
    if (bot?.entity) {
      const p = bot.entity.position;
      context = `hp=${bot.health} food=${bot.food} pos=${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)} inv=${bot.inventory.items().length}`;
    }
  } catch {}

  try {
    console.log('[GROQ-HB] ping…', model);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 40,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              'Resposta em 1 frase curta PT-BR. Voce e um player de Minecraft. Nao diga que e bot. Sem !comandos.',
          },
          {
            role: 'user',
            content: `Status rapido do jogo: ${context}. Uma dica curta de sobrevivencia (so texto).`,
          },
        ],
      }),
      signal: ctrl.signal,
    });

    clearTimeout(t);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[GROQ-HB] fail', res.status, txt.slice(0, 80));
      return;
    }

    const data = await res.json();
    const msg = data?.choices?.[0]?.message?.content?.trim() || '';
    console.log('[GROQ-HB] ok:', msg.slice(0, 100));

    if (msg && msg.length < 90 && bot?.chat && !/bot|ia|groq|api/i.test(msg)) {
      try {
        bot.chat(msg.slice(0, 80));
      } catch {}
    }
  } catch (e) {
    clearTimeout(t);
    console.warn('[GROQ-HB] error', (e.message || String(e)).slice(0, 60));
  }
}

export function startGroqHeartbeat(agent) {
  const bot = agent?.bot;
  if (!bot || bot._dreamGroqHb) return;
  bot._dreamGroqHb = true;

  const firstDelay = 2 * 60 * 1000;

  setTimeout(() => {
    pingGroq(bot).catch(() => {});
    setInterval(() => {
      pingGroq(bot).catch(() => {});
    }, INTERVAL_MS);
  }, firstDelay);

  console.log('[GROQ-HB] ON — ping every 20 min (non-blocking)');
}
