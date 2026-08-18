import Groq from 'groq-sdk';
import { getKey } from '../utils/keys.js';

export class GroqCloudAPI {
    static prefix = 'groq';

    constructor(model_name, url, params) {
        this.model_name = model_name || 'openai/gpt-oss-20b';
        this.url = url;
        this.params = params || {};
        this._cooldownUntil = 0;

        if (this.params.tools) delete this.params.tools;
        if (this.url) {
            console.warn('Groq Cloud has no implementation for custom URLs. Ignoring provided URL.');
        }

        this.groq = new Groq({ apiKey: getKey('GROQCLOUD_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = null) {
        const now = Date.now();
        if (now < this._cooldownUntil) {
            const wait = Math.ceil((this._cooldownUntil - now) / 1000);
            console.warn(`[Groq] Cooldown ${wait}s (rate limit). Passive mode.`);
            return 'Rate limited by Groq. Continuing in passive mode.';
        }

        let messages = [{ role: 'system', content: systemMessage }].concat(turns);
        let res = null;

        try {
            console.log('Awaiting Groq response...');

            if (this.params.max_tokens) {
                this.params.max_completion_tokens = this.params.max_tokens;
                delete this.params.max_tokens;
            }
            if (!this.params.max_completion_tokens) {
                this.params.max_completion_tokens = 400;
            }

            const request = {
                model: this.model_name,
                messages,
                stream: false,
                ...this.params,
            };
            if (stop_seq) request.stop = stop_seq;

            const completion = await this.groq.chat.completions.create(request);
            res = completion.choices[0].message.content || '';
            res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        } catch (err) {
            const status = err?.status || err?.statusCode;
            const msg = err?.message || String(err);
            console.error('Groq error:', status || '', msg);

            if (status === 429 || /rate limit/i.test(msg)) {
                this._cooldownUntil = Date.now() + 60000;
                return 'Rate limited by Groq. Continuing in passive mode.';
            }
            if (status === 401 || status === 403 || /invalid.*api.?key|incorrect.?api.?key/i.test(msg)) {
                return 'Groq API key invalid or revoked. Update GROQCLOUD_API_KEY in Railway Variables.';
            }
            res = 'Groq unavailable, continue passive: collect craft defend explore.';
        }

        return res || 'No response';
    }

    async sendVisionRequest() {
        return 'Vision is disabled in this deploy.';
    }

    async embed() {
        return null;
    }
}
