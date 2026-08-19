import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import http from 'http';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();
if (args.profiles) {
    settings.profiles = args.profiles;
}
if (args.task_path) {
    let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (args.task_id) {
        settings.task = tasks[args.task_id];
        settings.task.task_id = args.task_id;
    }
    else {
        throw new Error('task_id is required when task_path is provided');
    }
}

if (process.env.MINECRAFT_PORT) {
    settings.port = process.env.MINECRAFT_PORT;
}
if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = process.env.MINDSERVER_PORT;
}
if (process.env.PROFILES && JSON.parse(process.env.PROFILES).length > 0) {
    settings.profiles = JSON.parse(process.env.PROFILES);
}
if (process.env.INSECURE_CODING) {
    settings.allow_insecure_coding = true;
}
if (process.env.BLOCKED_ACTIONS) {
    settings.blocked_actions = JSON.parse(process.env.BLOCKED_ACTIONS);
}
if (process.env.MAX_MESSAGES) {
    settings.max_messages = process.env.MAX_MESSAGES;
}
if (process.env.NUM_EXAMPLES) {
    settings.num_examples = process.env.NUM_EXAMPLES;
}
if (process.env.LOG_ALL) {
    settings.log_all_prompts = process.env.LOG_ALL;
}
if (process.env.SETTINGS_JSON) {
    try {
        Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));
    } catch (err) {
        console.error("Failed to parse environment variable for SETTINGS_JSON:", err);
    }
}

// Railway: always listen on PORT so domain is healthy even if MindServer shares port
const PUBLIC_PORT = Number(process.env.PORT) || Number(settings.mindserver_port) || 8080;
settings.mindserver_port = PUBLIC_PORT;

let healthServerStarted = false;
function ensureHealthServer() {
    if (healthServerStarted) return;
    healthServerStarted = true;
    try {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('DreamBot OK — light vision + passive + pvp\n');
        });
        server.on('error', (err) => {
            // Port in use by MindServer — that is fine, app still responds
            if (err.code === 'EADDRINUSE') {
                console.log('[DreamBot] PORT already in use (MindServer) — OK');
            } else {
                console.warn('[DreamBot] health', err.message);
            }
        });
        server.listen(PUBLIC_PORT, '0.0.0.0', () => {
            console.log('[DreamBot] health/UI on 0.0.0.0:' + PUBLIC_PORT);
        });
    } catch (e) {
        console.warn('[DreamBot] health skip', e.message);
    }
}

// host_public=true for Railway
try {
    Mindcraft.init(true, settings.mindserver_port, settings.auto_open_ui);
} catch (e) {
    console.warn('[DreamBot] Mindcraft.init', e.message);
    ensureHealthServer();
}

// If MindServer didn't bind, still expose health
setTimeout(ensureHealthServer, 2500);

for (let profile of settings.profiles) {
    try {
        const profile_json = JSON.parse(readFileSync(profile, 'utf8'));
        settings.profile = profile_json;
        Mindcraft.createAgent(settings);
    } catch (e) {
        console.error('[DreamBot] createAgent', e.message);
    }
}
