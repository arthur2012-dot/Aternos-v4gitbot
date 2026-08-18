import { spawn } from 'child_process';
import { logoutAgent } from '../mindcraft/mindserver.js';

/**
 * DreamBot: always try to reconnect forever.
 * - On crash / disconnect: wait and restart
 * - No more "exited too quickly and will not be restarted"
 */
export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
        this.restartAttempts = 0;
        this.maxBackoffMs = 120000; // max 2 min between tries
    }

    start(load_memory = false, init_message = null, count_id = 0) {
        this.count_id = count_id;
        this.running = true;

        let args = ['src/process/init_agent.js', this.name];
        args.push('-n', this.name);
        args.push('-c', String(count_id));
        if (load_memory)
            args.push('-l', String(load_memory));
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', String(this.port));

        const agentProcess = spawn(process.execPath || 'node', args, {
            stdio: 'inherit',
            stderr: 'inherit',
        });

        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            try { logoutAgent(this.name); } catch (_) {}

            if (code > 1) {
                console.log(`Ending task (code ${code})`);
                process.exit(code);
            }

            // Always reconnect unless intentional stop (SIGINT)
            if (signal === 'SIGINT') {
                console.log('Agent stopped by SIGINT — not restarting.');
                return;
            }

            this.restartAttempts += 1;
            // backoff: 5s, 10s, 20s... capped at 2 min
            const delay = Math.min(
                5000 * Math.pow(2, Math.min(this.restartAttempts - 1, 5)),
                this.maxBackoffMs
            );
            console.log(`[DreamBot] Will reconnect in ${Math.round(delay / 1000)}s (attempt ${this.restartAttempts})...`);
            setTimeout(() => {
                if (this.running) return; // already started again somehow
                console.log('[DreamBot] Restarting agent...');
                this.start(true, 'Agent process restarted after disconnect.', this.count_id);
            }, delay);
        });

        agentProcess.on('error', (err) => {
            console.error('Agent process error:', err);
        });

        // Reset backoff after staying alive a bit
        setTimeout(() => {
            if (this.running) this.restartAttempts = 0;
        }, 60000);

        this.process = agentProcess;
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        if (this.process && !this.process.killed) {
            this.process.kill('SIGINT');
        }
    }

    forceRestart() {
        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);

            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000);

            this.process.once('exit', () => {
                clearTimeout(restartTimeout);
                console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop();
        } else {
            this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
