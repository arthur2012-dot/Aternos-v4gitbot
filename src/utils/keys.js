import { readFileSync } from 'fs';

let keys = {};
try {
    keys = JSON.parse(readFileSync('./keys.json', 'utf8'));
} catch (e) {
    console.warn('keys.json not found or invalid, using env vars only');
}

export function getKey(name) {
    if (process.env[name]) return process.env[name];
    if (keys[name]) return keys[name];
    // common aliases
    if (name === 'GROQCLOUD_API_KEY' && process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
    return null;
}

export function hasKey(name) {
    return !!getKey(name);
}
