import { spawn } from 'child_process';
import { logoutAgent } from '../mindcraft/mindserver.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * DreamBot agent process with anti-ban reconnect for Aternos.
 * - Never spams login (long exponential backoff)
 * - Detects ban / kick / rate-limit and waits much longer
 * - Caps attempts per hour
 * - Persists last disconnect reason
 */
const STATE_DIR = join(process.cwd(), 'bots');
const STATE_FILE = join(STATE_DIR, 'reconnect_state.json');

function loadState() {
    try {
        if (existsSync(STATE_FILE)) {
            return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (_) {}
    return { attempts: 0, lastBanAt: 0, lastFailAt: 0, lastReason: '' };
}

function saveState(state) {
    try {
        mkdirSync(STATE_DIR, { recursive: true });
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (_) {}
}

function classifyDisconnect(code, signal, recentLogs = '') {
    const text = String(recentLogs || '').toLowerCase();
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
        text.includes('rate') ||
        text.includes('throttl') ||
        text.includes('connection throttled')
    ) {
        return 'throttle';
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

export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
        this.restartAttempts = 0;
        this.shouldRun = true;
        this._restartTimer = null;
        this._startedAt = 0;
        this._recentStderr = '';
        // Aternos-friendly limits
        this.minBackoffMs = 60_000;      // 1 min minimum
        this.maxBackoffMs = 20 * 60_000; // 20 min max
        this.banCooldownMs = 60 * 60_000;    // 1 hour after ban-like kick
        this.throttlePauseMs = 15 * 60_000; // 15 min after throttle
        this.protocolPauseMs = 5 * 60_000;  // 5 min after protocol errors
        this.maxAttemptsPerHour = 8;
        this._attemptTimestamps = [];
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
            const left = Math.max(this.banPauseMs - (now - (state.lastBanAt || now)), this.banPauseMs);
            return left;
        }
        if (kind === 'throttle') return this.throttlePauseMs;
        if (kind === 'protocol') {
            // protocol errors: do not hammer the server
            return Math.max(
                this.protocolPauseMs,
                Math.min(this.minBackoffMs * Math.pow(1.8, Math.min(this.restartAttempts, 5)), this.maxBackoffMs)
            );
        }

        // generic: exponential backoff, min 1 min
        const exp = Math.min(
            this.minBackoffMs * Math.pow(1.7, Math.min(this.restartAttempts - 1, 8)),
            this.maxBackoffMs
        );
        return Math.max(this.minBackoffMs, exp);
    }

    start(load_memory = false, init_message = null, count_id = 0) {
        this.count_id = count_id;
        this.running = true;
        this.shouldRun = true;
        this._startedAt = Date.now();
        this._recentStderr = '';

        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }

        if (!this._canAttempt()) {
            const wait = 30 * 60_000; // 30 min cool-down
            console.log(
                `[DreamBot] Too many join attempts in the last hour (${this.maxAttemptsPerHour}). ` +
                    `Cooling down ${Math.round(wait / 60000)} min to avoid Aternos ban.`
            );
            this._restartTimer = setTimeout(() => {
                this._restartTimer = null;
                if (!this.shouldRun) return;
                this._attemptTimestamps = [];
                this.start(true, 'Agent reconnect after hourly cool-down.', this.count_id);
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

        console.log('[DreamBot] Starting agent process (anti-ban mode)...');
        const agentProcess = spawn(process.execPath || 'node', args, {
            stdio: ['ignore', 'inherit', 'pipe'],
        });

        // Capture stderr so we can classify ban / protocol errors
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

            // Mindcraft task exit codes > 1 = intentional stop
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
            saveState(state);

            // If it died in under 30s, treat as failed login (don't reset backoff)
            if (aliveMs > 120_000) {
                // survived 2+ minutes in-game → reset soft counter
                this.restartAttempts = Math.max(0, this.restartAttempts - 2);
            }

            let delay = this._delayFor(kind);

            if (kind === 'ban') {
                console.log(
                    '[DreamBot] Possible BAN/kick detected. ' +
                        `Waiting ${Math.round(delay / 60000)} min. ` +
                        'Check Aternos panel → Players / Bans and unban DreamBot if needed.'
                );
            } else if (kind === 'throttle') {
                console.log(
                    `[DreamBot] Rate-limit / throttle suspected. Waiting ${Math.round(delay / 60000)} min.`
                );
            } else if (kind === 'protocol') {
                console.log(
                    `[DreamBot] Protocol/version issue. Waiting ${Math.round(delay / 60000)} min before retry ` +
                        '(avoids Aternos join spam).'
                );
            } else {
                console.log(
                    `[DreamBot] Disconnect. Reconnecting in ${Math.round(delay / 1000)}s ` +
                        `(try ${this.restartAttempts}, kind=${kind}).`
                );
            }

            this._restartTimer = setTimeout(() => {
                this._restartTimer = null;
                if (!this.shouldRun) return;
                console.log('[DreamBot] Restarting agent now...');
                this.start(true, 'Agent reconnected after disconnect.', this.count_id);
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
                console.warn(`[DreamBot] Agent ${this.name} stuck; killing.`);
                try {
                    this.process.kill('SIGKILL');
                } catch (_) {}
            }, 8000);

            this.process.once('exit', () => {
                clearTimeout(restartTimeout);
                // Force restart still respects min delay
                setTimeout(() => {
                    this.start(true, 'Agent process force restarted.', this.count_id);
                }, this.minBackoffMs);
            });
            try {
                this.process.kill('SIGINT');
            } catch (_) {}
        } else {
            this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
