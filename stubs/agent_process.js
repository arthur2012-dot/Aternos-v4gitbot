import { spawn } from 'child_process';
import { logoutAgent } from '../mindcraft/mindserver.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const STATE_DIR = join(process.cwd(), 'bots');
const STATE_FILE = join(STATE_DIR, 'reconnect_state.json');

function loadSettings() {
    return {
        host: process.env.MC_HOST || 'DarkFantasytxt.aternos.me',
        port: Number(process.env.MC_PORT) || 25831,
    };
}

function loadState() {
    try {
        if (existsSync(STATE_FILE)) {
            return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (_) {}
    return { attempts: 0, lastBanAt: 0, lastFailAt: 0, lastReason: '', offlineStreak: 0 };
}

function saveState(state) {
    try {
        mkdirSync(STATE_DIR, { recursive: true });
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (_) {}
}

function classifyDisconnect(code, signal, recentLogs = '') {
    const text = String(recentLogs || '').toLowerCase();

    // Groq API rate limit is NOT a Minecraft throttle / ban
    if (
        text.includes('groq error') ||
        text.includes('rate limit reached') ||
        text.includes('rate limited by groq') ||
        (text.includes('429') && text.includes('groq'))
    ) {
        return 'generic';
    }

    if (
        text.includes('banned') ||
        text.includes('banido') ||
        text.includes('you are banned') ||
        text.includes('ip banned') ||
        text.includes('permanently')
    ) {
        return 'ban';
    }
    if (
        text.includes('kicked') ||
        text.includes('too many') ||
        text.includes('connection throttled') ||
        text.includes('throttl')
    ) {
        return 'throttle';
    }
    if (
        text.includes('econnrefused') ||
        text.includes('enotfound') ||
        text.includes('etimedout') ||
        text.includes('ehostunreach') ||
        text.includes('connect econnrefused') ||
        text.includes('getaddrinfo') ||
        text.includes('server is offline') ||
        text.includes('unable to connect') ||
        text.includes('connection timed out')
    ) {
        return 'offline';
    }
    if (
        text.includes('unsupported protocol') ||
        text.includes('protocol version') ||
        text.includes('minecraftversion') ||
        text.includes('econnreset') ||
        text.includes('not spawned after')
    ) {
        return 'protocol';
    }
    if (code === 1) return 'fail';
    return 'generic';
}

function pingServer(host, port, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const timer = setTimeout(() => done({ online: false, reason: 'timeout' }), timeoutMs);

        try {
            const mc = require('minecraft-protocol');
            mc.ping({ host, port, closeTimeout: timeoutMs }, (err, result) => {
                clearTimeout(timer);
                if (err) {
                    done({ online: false, reason: err.code || err.message || 'ping_error' });
                    return;
                }
                done({
                    online: true,
                    version: result?.version?.name || 'unknown',
                    protocol: result?.version?.protocol,
                    players: result?.players,
                });
            });
        } catch (e) {
            clearTimeout(timer);
            done({ online: false, reason: e.message || 'no_minecraft_protocol' });
        }
    });
}

export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
        this.restartAttempts = 0;
        this.shouldRun = true;
        this._restartTimer = null;
        this._startedAt = 0;
        this._recentStderr = '';
        this._offlineStreak = 0;

        this.offlineWaitMs = 45_000;
        this.offlineWaitMaxMs = 90_000;
        this.minBackoffMs = 15_000;
        this.maxBackoffMs = 2 * 60_000;
        this.banPauseMs = 5 * 60_000;
        this.throttlePauseMs = 60_000;
        this.protocolPauseMs = 60_000;
        this.maxAttemptsPerHour = 25;
        this._attemptTimestamps = [];

        const s = loadSettings();
        this.mcHost = s.host;
        this.mcPort = s.port;
    }

    _pruneAttempts() {
        const hourAgo = Date.now() - 60 * 60_000;
        this._attemptTimestamps = this._attemptTimestamps.filter((t) => t > hourAgo);
    }

    _canAttempt() {
        this._pruneAttempts();
        return this._attemptTimestamps.length < this.maxAttemptsPerHour;
    }

    _delayFor(kind) {
        const state = loadState();
        const now = Date.now();

        if (kind === 'ban' || (state.lastBanAt && now - state.lastBanAt < this.banPauseMs)) {
            return Math.max(this.banPauseMs - (now - (state.lastBanAt || now)), 60_000);
        }
        if (kind === 'throttle') return this.throttlePauseMs;
        if (kind === 'offline') {
            const steps = Math.min(this._offlineStreak, 2);
            return Math.min(this.offlineWaitMs + steps * 15_000, this.offlineWaitMaxMs);
        }
        if (kind === 'protocol') {
            return Math.max(
                this.protocolPauseMs,
                Math.min(this.minBackoffMs * Math.pow(1.5, Math.min(this.restartAttempts, 4)), this.maxBackoffMs)
            );
        }
        // generic / fail after a short life: retry faster so it does not look "dead"
        const exp = Math.min(
            this.minBackoffMs * Math.pow(1.4, Math.min(this.restartAttempts - 1, 5)),
            this.maxBackoffMs
        );
        return Math.max(this.minBackoffMs, exp);
    }

    async waitUntilOnline() {
        while (this.shouldRun) {
            console.log(`[DreamBot] Checking server: ${this.mcHost}:${this.mcPort} ...`);
            const status = await pingServer(this.mcHost, this.mcPort);

            if (status.online) {
                this._offlineStreak = 0;
                console.log(`[DreamBot] Server ONLINE (${status.version || '?'}). Joining...`);
                return status;
            }

            this._offlineStreak += 1;
            const wait = this._delayFor('offline');
            console.log(
                `[DreamBot] Offline / starting (${status.reason || 'no response'}). ` +
                    `Next check in ${Math.round(wait / 1000)}s (#${this._offlineStreak})`
            );

            const state = loadState();
            state.lastReason = 'offline';
            state.offlineStreak = this._offlineStreak;
            state.lastFailAt = Date.now();
            saveState(state);

            await new Promise((r) => {
                this._restartTimer = setTimeout(() => {
                    this._restartTimer = null;
                    r();
                }, wait);
            });
        }
        return null;
    }

    start(load_memory = false, init_message = null, count_id = 0) {
        this.count_id = count_id;
        this.shouldRun = true;

        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }

        this.waitUntilOnline()
            .then((status) => {
                if (!this.shouldRun || !status) return;
                this._spawnAgent(load_memory, init_message, count_id);
            })
            .catch((e) => {
                console.error('[DreamBot] waitUntilOnline error:', e.message);
                const delay = this._delayFor('offline');
                this._restartTimer = setTimeout(() => {
                    this._restartTimer = null;
                    if (this.shouldRun) this.start(load_memory, init_message, count_id);
                }, delay);
            });
    }

    _spawnAgent(load_memory, init_message, count_id) {
        this.running = true;
        this._startedAt = Date.now();
        this._recentStderr = '';

        if (!this._canAttempt()) {
            const wait = 5 * 60_000;
            console.log(`[DreamBot] Many joins this hour — pause ${Math.round(wait / 60000)} min.`);
            this._restartTimer = setTimeout(() => {
                this._restartTimer = null;
                if (!this.shouldRun) return;
                this._attemptTimestamps = [];
                this.start(true, null, this.count_id);
            }, wait);
            return;
        }

        this._attemptTimestamps.push(Date.now());

        const args = [
            'src/process/init_agent.js',
            this.name,
            '-n',
            this.name,
            '-c',
            String(count_id),
            '-p',
            String(this.port),
        ];
        if (load_memory) args.push('-l', 'true');
        if (init_message) args.push('-m', init_message);

        console.log('[DreamBot] Starting agent...');
        const agentProcess = spawn(process.execPath || 'node', args, {
            stdio: ['ignore', 'inherit', 'pipe'],
        });

        if (agentProcess.stderr) {
            agentProcess.stderr.on('data', (chunk) => {
                const s = chunk.toString();
                process.stderr.write(s);
                this._recentStderr = (this._recentStderr + s).slice(-8000);
            });
        }

        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            try {
                logoutAgent(this.name);
            } catch (_) {}

            if (!this.shouldRun || signal === 'SIGINT' || signal === 'SIGTERM') {
                console.log('[DreamBot] Not restarting (stopped on purpose).');
                return;
            }

            if (code !== null && code > 1) {
                console.log(`[DreamBot] Task ended with code ${code}`);
                process.exit(code);
                return;
            }

            const aliveMs = Date.now() - this._startedAt;
            const kind = classifyDisconnect(code, signal, this._recentStderr);
            this.restartAttempts += 1;

            const state = loadState();
            state.attempts = this.restartAttempts;
            state.lastFailAt = Date.now();
            state.lastReason = kind;
            if (kind === 'ban') state.lastBanAt = Date.now();
            if (kind === 'offline') this._offlineStreak += 1;
            saveState(state);

            if (aliveMs > 120_000) {
                this.restartAttempts = Math.max(0, this.restartAttempts - 2);
            }

            const delay = this._delayFor(kind);
            console.log(
                `[DreamBot] ${kind} — retry in ${Math.round(delay / 1000)}s (try ${this.restartAttempts})`
            );

            this._restartTimer = setTimeout(() => {
                this._restartTimer = null;
                if (!this.shouldRun) return;
                this.start(true, null, this.count_id);
            }, delay);
        });

        agentProcess.on('error', (err) => {
            console.error('[DreamBot] Agent process error:', err);
        });

        this.process = agentProcess;
    }

    stop() {
        this.shouldRun = false;
        this.running = false;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        if (this.process && !this.process.killed) {
            try {
                this.process.kill('SIGINT');
            } catch (_) {}
        }
    }

    forceRestart() {
        this.shouldRun = true;
        if (this.running && this.process && !this.process.killed) {
            console.log(`[DreamBot] Force restart ${this.name}...`);
            const restartTimeout = setTimeout(() => {
                try {
                    this.process.kill('SIGKILL');
                } catch (_) {}
            }, 8000);
            this.process.once('exit', () => {
                clearTimeout(restartTimeout);
                setTimeout(() => {
                    this.start(true, null, this.count_id);
                }, this.minBackoffMs);
            });
            try {
                this.process.kill('SIGINT');
            } catch (_) {}
        } else {
            this.start(true, null, this.count_id);
        }
    }
}
