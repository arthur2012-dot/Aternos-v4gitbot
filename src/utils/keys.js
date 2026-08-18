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

    // 1) Railway / env
    for (const n of names) {
        if (process.env[n] && String(process.env[n]).trim()) {
            return String(process.env[n]).trim();
        }
    }
    // 2) keys.json no GitHub
    for (const n of names) {
        const v = keys[n] && String(keys[n]).trim();
        if (v && v !== 'COLE_SUA_KEY_AQUI') {
            return v;
        }
    }
    throw new Error(
        `API key "${name}" not found. Edit keys.json on GitHub and put your DeepSeek key in DEEPSEEK_API_KEY.`
    );
}

export function hasKey(name) {
    try {
        getKey(name);
        return true;
    } catch {
        return false;
    }
}
