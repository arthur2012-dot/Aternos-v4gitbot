import { readFileSync } from 'fs';

let keys = {};
try {
    const data = readFileSync('./keys.json', 'utf8');
    keys = JSON.parse(data);
} catch (err) {
    console.warn('keys.json not found. Using environment variables only.');
}

export function getKey(name) {
    const aliases = {
        GROQCLOUD_API_KEY: ['GROQCLOUD_API_KEY', 'GROQ_API_KEY'],
        CEREBRAS_API_KEY: ['CEREBRAS_API_KEY'],
        GEMINI_API_KEY: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        OPENROUTER_API_KEY: ['OPENROUTER_API_KEY'],
        DEEPSEEK_API_KEY: ['DEEPSEEK_API_KEY'],
    };
    const names = aliases[name] || [name];

    for (const n of names) {
        if (process.env[n] && String(process.env[n]).trim()) {
            return String(process.env[n]).trim();
        }
    }
    for (const n of names) {
        if (keys[n] && String(keys[n]).trim()) {
            return String(keys[n]).trim();
        }
    }
    throw new Error(`API key "${name}" not found. Set DEEPSEEK_API_KEY in Railway Variables.`);
}

export function hasKey(name) {
    try {
        getKey(name);
        return true;
    } catch {
        return false;
    }
}
