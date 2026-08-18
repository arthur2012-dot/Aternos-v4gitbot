import { readFileSync } from 'fs';

let keys = {};
try {
    keys = JSON.parse(readFileSync('./keys.json', 'utf8'));
} catch {
    console.warn('keys.json not found — using env only.');
}

export function getKey(name) {
    const aliases = {
        GROQCLOUD_API_KEY: ['GROQCLOUD_API_KEY', 'GROQ_API_KEY'],
        DEEPSEEK_API_KEY: ['DEEPSEEK_API_KEY'],
        CEREBRAS_API_KEY: ['CEREBRAS_API_KEY'],
        GEMINI_API_KEY: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        OPENROUTER_API_KEY: ['OPENROUTER_API_KEY'],
    };
    const names = aliases[name] || [name];
    for (const n of names) {
        if (process.env[n] && String(process.env[n]).trim()) return String(process.env[n]).trim();
    }
    for (const n of names) {
        const v = keys[n] && String(keys[n]).trim();
        if (v && !/^COLE_/i.test(v)) return v;
    }
    throw new Error(`API key "${name}" missing. Put GROQCLOUD_API_KEY in keys.json or Railway Variables.`);
}

export function hasKey(name) {
    try { getKey(name); return true; } catch { return false; }
}
