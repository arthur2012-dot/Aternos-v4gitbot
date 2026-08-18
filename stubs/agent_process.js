import { spawn } from 'child_process';
import { logoutAgent } from '../mindcraft/mindserver.js';

/**
 * DreamBot: reconnect forever when the Minecraft server is offline or the agent crashes.
 * Never prints "exited too quickly and will not be restarted".
 */
export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
        this.restartAttempts = 0;
        this.maxBackoffMs = 90000; // max 90s between tries
        this.shouldRun = true;
        this._restartTimer = null;
    }

    start(load_memory = false, init_message = null, count_id = 0) {
        this.count_id = count_id;
        this.running = true;
        this.shouldRun = true;

        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }

        const args = [
            'src/process/init_agent.js',
            this.name,
            '-n', this.name,
            '-c', String(count_id),
            '-p', String(this.port),
        ];
        if (load_memory) args.push('-l', 'true');
        if (init_message) args.push('-m', init_message);

        console.log('[DreamBot] Starting agent process...');
        const agentProcess = spawn(process.execPath || 'node', args, {
            stdio: 'inherit',
            stderr: 'inherit',
        });

        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            try { logoutAgent(this.name); } catch (_) {}

            // Intentional full shutdown of the parent only
            if (!this.shouldRun || signal === 'SIGINT' || signal === 'SIGTERM') {
                console.log('[DreamBot] Not restarting (stopped on purpose).');
                return;
            }

            // Tasks with special exit codes > 1 still stop (Mindcraft convention)
            if (code !== null && code > 1) {
                console.log(`[DreamBot] Task ended with code ${code}`);
                process.exit(code);
                return;
            }

            this.restartAttempts += 1;
            const delay = Math.min(
                8000 * Math.pow(1.6, Math.min(this.restartAttempts - 1, 6)),
                this.maxBackoffMs
            );
            console.log(`[DreamBot] Server offline or disconnect. Reconnecting in ${Math.round(delay / 1000)}s (try ${this.restartAttempts})...`);
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

        // After 45s alive, reset backoff so next crash reconnects quickly
        setTimeout(() => {
            if (this.running) this.restartAttempts = 0;
        }, 45000);

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
            try { this.process.kill('SIGINT'); } catch (_) {}
        }
    }

    forceRestart() {
        this.shouldRun = true;
        if (this.running && this.process && !this.process.killed) {
            console.log(`[DreamBot] Force restart ${this.name}...`);
            const restartTimeout = setTimeout(() => {
                console.warn(`[DreamBot] Agent ${this.name} stuck; killing.`);
                try { this.process.kill('SIGKILL'); } catch (_) {}
            }, 8000);

            this.process.once('exit', () => {
                clearTimeout(restartTimeout);
                this.start(true, 'Agent process force restarted.', this.count_id);
            });
            try { this.process.kill('SIGINT'); } catch (_) {}
        } else {
            this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
