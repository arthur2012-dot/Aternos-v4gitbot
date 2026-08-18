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

        this.groq = new Groq({ apiKey: getKey('GROQCLOUD_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = null) {
        const now = Date.now();
        if (now < this._cooldownUntil) {
            const wait = Math.ceil((this._cooldownUntil - now) / 1000);
            console.warn(`[Groq] Cooldown ${wait}s — silent passive.`);
            return '';
        }

        let messages = [{ role: 'system', content: systemMessage }].concat(turns);
        let res = null;

        try {
            console.log('Awaiting Groq response...', this.model_name);

            if (this.params.max_tokens) {
                this.params.max_completion_tokens = this.params.max_tokens;
                delete this.params.max_tokens;
            }
            if (!this.params.max_completion_tokens) {
                this.params.max_completion_tokens = 300;
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

            // Short cooldowns so bot recovers faster
            if (status === 429 || /rate limit/i.test(msg)) {
                this._cooldownUntil = Date.now() + 45000; // 45s
            } else if (status === 401 || status === 403) {
                this._cooldownUntil = Date.now() + 120000;
                console.error('[Groq] Key invalid — check GROQCLOUD_API_KEY');
            } else if (status === 404) {
                this._cooldownUntil = Date.now() + 60000;
            } else {
                this._cooldownUntil = Date.now() + 20000;
            }
            return '';
        }

        if (/groq|rate.?limit|passivo|passive|indispon|unavailable|api key|brain disconnected/i.test(res || '')) {
            return '';
        }
        return res || '';
    }

    async sendVisionRequest() {
        return '';
    }

    async embed() {
        return null;
    }
}
