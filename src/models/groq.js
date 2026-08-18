import Groq from 'groq-sdk';
import { getKey } from '../utils/keys.js';

export class GroqCloudAPI {
    static prefix = 'groq';

    constructor(model_name, url, params) {
        this.model_name = model_name || 'openai/gpt-oss-20b';
        this.params = params || {};
        this._cooldownUntil = 0;
        if (this.params.tools) delete this.params.tools;
        this.groq = new Groq({ apiKey: getKey('GROQCLOUD_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = null) {
        if (Date.now() < this._cooldownUntil) {
            const wait = Math.ceil((this._cooldownUntil - Date.now()) / 1000);
            console.warn(`[Groq] Cooldown ${wait}s — silent.`);
            return '';
        }

        const messages = [{ role: 'system', content: systemMessage }].concat(turns);
        try {
            console.log('Awaiting Groq response...', this.model_name);
            if (this.params.max_tokens) {
                this.params.max_completion_tokens = this.params.max_tokens;
                delete this.params.max_tokens;
            }
            if (!this.params.max_completion_tokens) this.params.max_completion_tokens = 280;

            const request = {
                model: this.model_name,
                messages,
                stream: false,
                ...this.params,
            };
            if (stop_seq) request.stop = stop_seq;

            const completion = await this.groq.chat.completions.create(request);
            let res = completion.choices[0].message.content || '';
            res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            if (/groq|rate.?limit|brain disconnected|api key|passivo/i.test(res)) return '';
            return res;
        } catch (err) {
            const status = err?.status || err?.statusCode;
            console.error('Groq error:', status || '', err?.message || err);
            if (status === 429) this._cooldownUntil = Date.now() + 45000;
            else if (status === 401 || status === 403) this._cooldownUntil = Date.now() + 120000;
            else this._cooldownUntil = Date.now() + 20000;
            return '';
        }
    }

    async sendVisionRequest() { return ''; }
    async embed() { return null; }
}
